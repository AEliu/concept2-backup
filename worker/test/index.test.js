import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import worker from '../src/index.js';

const workflow = readFileSync(new URL('../../.github/workflows/backup.yml', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

function workflowStep(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `Missing workflow step: ${name}`);
  const end = workflow.indexOf('\n      - name:', start + 1);
  return workflow.slice(start, end === -1 ? undefined : end);
}

async function deliver(t, payload) {
  const dispatches = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    dispatches.push(JSON.parse(options.body));
    return new Response(null, { status: 204 });
  });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  const response = await worker.fetch(
    new Request('https://example.test/webhook', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
    { GITHUB_PAT: 'test-pat' },
    {}
  );
  return { response, dispatches };
}

test('dispatches a positive integer result ID unchanged', async (t) => {
  const { response, dispatches } = await deliver(t, {
    type: 'result-added',
    result: { id: 123 }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(dispatches, [{
    event_type: 'c2_new_activity',
    client_payload: { result_id: 123, event_type: 'result-added' }
  }]);
});

test('accepts a positive integer for deleted events', async (t) => {
  const { response, dispatches } = await deliver(t, {
    type: 'result-deleted',
    result_id: 456
  });

  assert.equal(response.status, 200);
  assert.equal(dispatches[0].client_payload.result_id, 456);
});

test('accepts a positive integer for updated events', async (t) => {
  const { response, dispatches } = await deliver(t, {
    type: 'result-updated',
    result: { id: 789 }
  });

  assert.equal(response.status, 200);
  assert.equal(dispatches[0].client_payload.result_id, 789);
});

for (const id of ['$(echo injected)', '123; echo injected', '123', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null]) {
  test(`rejects invalid added result ID ${JSON.stringify(id)} before dispatch`, async (t) => {
    const { response, dispatches } = await deliver(t, {
      type: 'result-added',
      result: { id }
    });

    assert.equal(response.status, 400);
    assert.equal(dispatches.length, 0);
  });
}

test('rejects an injected deleted result ID before dispatch', async (t) => {
  const { response, dispatches } = await deliver(t, {
    type: 'result-deleted',
    result_id: '$(echo injected)'
  });

  assert.equal(response.status, 400);
  assert.equal(dispatches.length, 0);
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
