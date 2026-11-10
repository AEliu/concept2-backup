import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import worker from '../src/webhook.js';

const SECRET = 'A'.repeat(43);
const workflow = readFileSync(new URL('../../.github/workflows/backup.yml', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

function event(type, id, extra = {}) {
  return type === 'result-deleted'
    ? { data: { type, result_id: id } }
    : { data: { type, result: { id, user_id: 1, ...extra } } };
}

function setup(t, options = {}) {
  const dispatches = [];
  const logs = [];
  const totalKeys = [];
  const eventKeys = [];
  const eventCounts = new Map();
  let totalCount = 0;

  t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url, 'https://api.github.com/repos/AEliu/concept2-backup/dispatches');
    assert.equal(request.headers.Authorization, 'Bearer test-pat');
    dispatches.push(JSON.parse(request.body));
    return new Response(null, { status: options.dispatchStatuses?.shift() ?? 204 });
  });
  for (const level of ['log', 'warn', 'error']) {
    t.mock.method(console, level, (...args) => logs.push(args.join(' ')));
  }

  const env = {
    WEBHOOK_SECRET: SECRET,
    GITHUB_PAT: 'test-pat',
    WEBHOOK_RATE_LIMIT: {
      limit: async ({ key }) => {
        totalKeys.push(key);
        totalCount += 1;
        return { success: totalCount <= (options.totalLimit ?? 10) };
      }
    },
    WEBHOOK_EVENT_LIMIT: {
      limit: async ({ key }) => {
        eventKeys.push(key);
        const count = (eventCounts.get(key) ?? 0) + 1;
        eventCounts.set(key, count);
        return { success: count <= 1 };
      }
    },
    ...options.env
  };
  async function deliver(payload, requestOptions = {}) {
    return worker.fetch(new Request(requestOptions.url ?? `https://example.test/webhook/${SECRET}`, {
      method: 'POST',
      body: requestOptions.body ?? JSON.stringify(payload)
    }), env);
  }
  return { deliver, dispatches, logs, totalKeys, eventKeys, eventCounts };
}

for (const [type, id] of [
  ['result-added', 123], ['result-updated', 456], ['result-deleted', 789]
]) {
  test(`accepts documented ${type} event`, async (t) => {
    const { deliver, dispatches } = setup(t);
    assert.equal((await deliver(event(type, id))).status, 200);
    assert.deepEqual(dispatches, [{
      event_type: 'c2_new_activity',
      client_payload: { result_id: id, event_type: type }
    }]);
  });
}

for (const id of ['$(echo injected)', '123; echo injected', '123', 0, -1, 1.5,
  Number.MAX_SAFE_INTEGER + 1, null]) {
  test(`rejects invalid result ID ${JSON.stringify(id)}`, async (t) => {
    const { deliver, dispatches, totalKeys } = setup(t);
    assert.equal((await deliver(event('result-added', id))).status, 400);
    assert.equal(dispatches.length, 0);
    assert.equal(totalKeys.length, 0);
  });
}

test('rejects an injected deleted result ID', async (t) => {
  const { deliver, dispatches } = setup(t);
  assert.equal((await deliver(event('result-deleted', '$(echo injected)'))).status, 400);
  assert.equal(dispatches.length, 0);
});

for (const missing of ['WEBHOOK_SECRET', 'GITHUB_PAT', 'WEBHOOK_RATE_LIMIT', 'WEBHOOK_EVENT_LIMIT']) {
  test(`fails closed when ${missing} is missing`, async (t) => {
    const { deliver, dispatches } = setup(t, { env: { [missing]: undefined } });
    assert.equal((await deliver(event('result-added', 1))).status, 503);
    assert.equal(dispatches.length, 0);
  });
}

test('rejects invalid configured or supplied secret before parsing', async (t) => {
  const { deliver, dispatches } = setup(t, { env: { WEBHOOK_SECRET: 'guessable' } });
  assert.equal((await deliver(event('result-added', 1))).status, 503);
  assert.equal(dispatches.length, 0);
});

test('rejects wrong secret before reading malformed JSON', async (t) => {
  const { deliver, dispatches } = setup(t);
  const response = await deliver(null, { url: 'https://example.test/webhook/wrong', body: '{not json' });
  assert.equal(response.status, 401);
  assert.equal(dispatches.length, 0);
});

test('rejects oversized body', async (t) => {
  const { deliver, dispatches } = setup(t);
  const response = await deliver(event('result-added', 1, { comments: 'x'.repeat(65_536) }));
  assert.equal(response.status, 413);
  assert.equal(dispatches.length, 0);
});

for (const payload of [
  { type: 'result-added', result: { id: 1 } },
  { data: { type: 'unknown', result: { id: 1 } } },
  { data: { type: 'result-deleted', result_id: 1, result: { id: 1 } } },
  { data: { type: 'result-added', result: { id: 1 }, result_id: 1 } },
  { data: [] }, null
]) {
  test(`rejects malformed envelope ${JSON.stringify(payload)}`, async (t) => {
    const { deliver, dispatches } = setup(t);
    assert.equal((await deliver(payload)).status, 400);
    assert.equal(dispatches.length, 0);
  });
}

test('limits valid deliveries before dispatch', async (t) => {
  const { deliver, dispatches, totalKeys, eventKeys } = setup(t, { totalLimit: 2 });
  assert.equal((await deliver(event('result-added', 1))).status, 200);
  assert.equal((await deliver(event('result-added', 2))).status, 200);
  const blocked = await deliver(event('result-added', 3));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal(dispatches.length, 2);
  assert.deepEqual(totalKeys, Array(3).fill('concept2-webhooks'));
  assert.equal(eventKeys.length, 2);
});

test('defers replayed canonical payload with retry response', async (t) => {
  const { deliver, dispatches, eventKeys } = setup(t);
  assert.equal((await deliver(event('result-updated', 4, { comments: 'safe' }))).status, 200);
  const replay = await deliver({ data: { result: { comments: 'safe', user_id: 1, id: 4 }, type: 'result-updated' } });
  assert.equal(replay.status, 503);
  assert.equal(replay.headers.get('Retry-After'), '60');
  assert.equal(eventKeys[0], eventKeys[1]);
  assert.match(eventKeys[0], /^[a-f0-9]{64}$/);
  assert.equal(dispatches.length, 1);
  assert.equal((await deliver(event('result-updated', 4, { comments: 'changed' }))).status, 200);
  assert.equal(dispatches.length, 2);
});

test('failed GitHub dispatch remains retryable after the limiter window', async (t) => {
  const { deliver, dispatches, eventCounts } = setup(t, { dispatchStatuses: [503, 204] });
  const payload = event('result-added', 12);
  const failed = await deliver(payload);
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('Retry-After'), '60');
  assert.equal((await deliver(payload)).status, 503);
  assert.equal(dispatches.length, 1);
  eventCounts.clear(); // Simulate expiry of the Cloudflare limiter window.
  const retry = await deliver(payload);
  assert.equal(retry.status, 200);
  assert.equal(dispatches.length, 2);
});

test('logs omit secret, token, and personal event fields', async (t) => {
  const { deliver, logs } = setup(t);
  assert.equal((await deliver(event('result-added', 42, {
    comments: 'private workout comment', user_id: 987654
  }))).status, 200);
  const output = logs.join('\n');
  assert.doesNotMatch(output, /private workout comment|987654|test-pat/);
  assert.ok(!output.includes(SECRET));
  assert.match(output, /accepted, result-added, result 42/);
});

test('untrusted workflow IDs never enter shell source directly', () => {
  for (const [name, source] of [
    ['Download single activity (repository dispatch)', 'github.event.client_payload.result_id'],
    ['Download single activity (manual trigger)', 'github.event.inputs.result_id']
  ]) {
    const start = workflow.indexOf(`      - name: ${name}\n`);
    assert.notEqual(start, -1);
    const end = workflow.indexOf('\n      - name:', start + 1);
    const step = workflow.slice(start, end === -1 ? undefined : end);
    assert.ok(step.includes(`RESULT_ID: \${{ ${source} }}`));
    assert.match(step, /if ! \[\[ "\$RESULT_ID" =~ \^\[1-9\]\[0-9\]\*\$ \]\]; then/);
    assert.match(step, /uv run download_single\.py "\$RESULT_ID"/);
    assert.doesNotMatch(step.slice(step.indexOf('        run: |')), /\$\{\{/);
  }

  const start = workflow.indexOf('      - name: Commit changes\n');
  assert.notEqual(start, -1);
  const end = workflow.indexOf('\n      - name:', start + 1);
  const commit = workflow.slice(start, end === -1 ? undefined : end);
  assert.ok(commit.includes('RESULT_ID: \${{ github.event.client_payload.result_id }}'));
  assert.match(commit, /git commit -m "Add activity \$\{RESULT_ID\}/);
  assert.doesNotMatch(commit.slice(commit.indexOf('        run: |')), /\$\{\{/);
});

test('deletion dispatch never calls Concept2 and rejects unknown event types', () => {
  const dispatch = workflowStep('Download single activity (repository dispatch)');
  assert.ok(dispatch.includes('EVENT_TYPE: ${{ github.event.client_payload.event_type }}'));
  assert.match(dispatch, /case "\$EVENT_TYPE" in/);
  assert.match(dispatch, /result-added\)\s+uv run download_single\.py "\$RESULT_ID"/);
  assert.match(dispatch, /result-updated\)\s+uv run download_single\.py "\$RESULT_ID" --update/);
  assert.match(dispatch, /result-deleted\)\s+uv run record_deleted\.py "\$RESULT_ID"/);
  assert.match(dispatch, /\*\)\s+echo "Invalid event type" >&2\s+exit 1/);
  assert.doesNotMatch(dispatch.slice(dispatch.indexOf('        run: |')), /\$\{\{/);

  for (const name of [
    'Configure environment',
    'Validate Concept2 Access Token',
    'Generate Activity Heatmap (Static)'
  ]) {
    assert.match(workflowStep(name), /if: github\.event_name != 'repository_dispatch' \|\| github\.event\.client_payload\.event_type != 'result-deleted'/);
  }
});

test('rate limiter configuration requires no Durable Object migration', () => {
  assert.match(wrangler, /name = "WEBHOOK_RATE_LIMIT"[\s\S]*?limit = 10\s+period = 60/);
  assert.match(wrangler, /name = "WEBHOOK_EVENT_LIMIT"[\s\S]*?limit = 1\s+period = 60/);
  assert.doesNotMatch(wrangler, /durable_objects|migrations|WebhookGate/);
});
