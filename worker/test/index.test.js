import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import worker from '../src/webhook.js';

const SECRET = 'A'.repeat(43);
const workflow = readFileSync(new URL('../../.github/workflows/backup.yml', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

function workflowStep(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `Missing workflow step: ${name}`);
  const end = workflow.indexOf('\n      - name:', start + 1);
  return workflow.slice(start, end === -1 ? undefined : end);
}

function event(type, id, extra = {}) {
  return type === 'result-deleted'
    ? { data: { type, result_id: id } }
    : { data: { type, result: { id, user_id: 1, ...extra } } };
}

async function deliver(t, payload, options = {}) {
  const dispatches = [];
  const logs = [];
  const gate = {
    idFromName: (name) => name,
    get: () => ({
      dispatch: async (...args) => {
        dispatches.push(args);
        return options.outcome ?? 'accepted';
      }
    })
  };
  t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
  t.mock.method(console, 'warn', (...args) => logs.push(args.join(' ')));
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));

  const env = {
    WEBHOOK_SECRET: SECRET,
    GITHUB_PAT: 'test-pat',
    WEBHOOK_GATE: gate,
    ...options.env
  };
  const response = await worker.fetch(
    new Request(options.url ?? `https://example.test/webhook/${SECRET}`, {
      method: options.method ?? 'POST',
      body: options.body ?? JSON.stringify(payload)
    }), env
  );
  return { response, dispatches, logs };
}

for (const [type, id] of [
  ['result-added', 123], ['result-updated', 456], ['result-deleted', 789]
]) {
  test(`accepts the documented ${type} envelope`, async (t) => {
    const { response, dispatches } = await deliver(t, event(type, id));
    assert.equal(response.status, 200);
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0][0], type);
    assert.equal(dispatches[0][1], id);
    assert.match(dispatches[0][2], /^[a-f0-9]{64}$/);
  });
}

for (const id of ['$(echo injected)', '123; echo injected', '123', 0, -1, 1.5,
  Number.MAX_SAFE_INTEGER + 1, null]) {
  test(`rejects invalid result ID ${JSON.stringify(id)} before dispatch`, async (t) => {
    const { response, dispatches } = await deliver(t, event('result-added', id));
    assert.equal(response.status, 400);
    assert.equal(dispatches.length, 0);
  });
}

test('rejects an injected deleted result ID', async (t) => {
  const { response, dispatches } = await deliver(t, event('result-deleted', '$(echo injected)'));
  assert.equal(response.status, 400);
  assert.equal(dispatches.length, 0);
});

test('fails closed when authentication or state binding is missing', async (t) => {
  for (const missing of ['WEBHOOK_SECRET', 'GITHUB_PAT', 'WEBHOOK_GATE']) {
    const { response, dispatches } = await deliver(t, event('result-added', 1), {
      env: { [missing]: undefined }
    });
    assert.equal(response.status, 503);
    assert.equal(dispatches.length, 0);
  }
});

test('rejects a short configured secret', async (t) => {
  const { response, dispatches } = await deliver(t, event('result-added', 1), {
    env: { WEBHOOK_SECRET: 'guessable' }
  });
  assert.equal(response.status, 503);
  assert.equal(dispatches.length, 0);
});

test('rejects wrong secret before reading the payload', async (t) => {
  const { response, dispatches } = await deliver(t, null, {
    url: 'https://example.test/webhook/wrong', body: '{not json'
  });
  assert.equal(response.status, 401);
  assert.equal(dispatches.length, 0);
});

test('rejects an oversized event before dispatch', async (t) => {
  const { response, dispatches } = await deliver(t, event('result-added', 1, {
    comments: 'x'.repeat(65_536)
  }));
  assert.equal(response.status, 413);
  assert.equal(dispatches.length, 0);
});

for (const payload of [
  { type: 'result-added', result: { id: 1 } },
  { data: { type: 'unknown', result: { id: 1 } } },
  { data: { type: 'result-deleted', result_id: 1, result: { id: 1 } } },
  { data: { type: 'result-added', result: { id: 1 }, result_id: 1 } },
  { data: [] },
  null
]) {
  test(`rejects malformed envelope ${JSON.stringify(payload)}`, async (t) => {
    const { response, dispatches } = await deliver(t, payload);
    assert.equal(response.status, 400);
    assert.equal(dispatches.length, 0);
  });
}

test('does not log the secret or personal webhook fields', async (t) => {
  const privateText = 'private workout comment';
  const { response, logs } = await deliver(t, event('result-added', 42, {
    comments: privateText, user_id: 987654
  }));
  assert.equal(response.status, 200);
  const output = logs.join('\n');
  assert.doesNotMatch(output, /private workout comment|987654|test-pat/);
  assert.ok(!output.includes(SECRET));
  assert.match(output, /result-added, result 42/);
});

test('passes both untrusted workflow IDs only through environment variables', () => {
  for (const [name, source] of [
    ['Download single activity (repository dispatch)', 'github.event.client_payload.result_id'],
    ['Download single activity (manual trigger)', 'github.event.inputs.result_id']
  ]) {
    const step = workflowStep(name);
    assert.ok(step.includes(`RESULT_ID: \${{ ${source} }}`));
    assert.match(step, /if ! \[\[ "\$RESULT_ID" =~ \^\[1-9\]\[0-9\]\*\$ \]\]; then/);
    assert.match(step, /uv run download_single\.py "\$RESULT_ID"/);
    assert.doesNotMatch(step.slice(step.indexOf('        run: |')), /\$\{\{/);
  }

  const commit = workflowStep('Commit changes');
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
