import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createTestHarness } from 'wrangler';

const SECRET = 'A'.repeat(43);
const DISPATCH_URL = 'https://api.github.com/repos/AEliu/concept2-backup/dispatches';
const network = setupServer();
const harness = createTestHarness({
  workers: [{
    configPath: './wrangler.toml',
    secrets: { WEBHOOK_SECRET: SECRET, GITHUB_PAT: 'test-pat' }
  }]
});

before(async () => {
  network.listen({ onUnhandledRequest: 'error' });
  await harness.listen();
});

afterEach(async () => {
  network.resetHandlers();
  await harness.reset();
});

after(async () => {
  network.close();
  await harness.close();
});

async function deliver(data) {
  return harness.fetch(`/webhook/${SECRET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data })
  });
}

function acceptDispatches() {
  const dispatches = [];
  network.use(http.post(DISPATCH_URL, async ({ request }) => {
    assert.equal(request.headers.get('Authorization'), 'Bearer test-pat');
    dispatches.push(await request.json());
    return new HttpResponse(null, { status: 204 });
  }));
  return dispatches;
}

test('dispatches all documented event shapes through the configured Durable Object', async () => {
  const dispatches = acceptDispatches();
  for (const data of [
    { type: 'result-added', result: { id: 1, user_id: 2 } },
    { type: 'result-updated', result: { id: 2, user_id: 2 } },
    { type: 'result-deleted', result_id: 3 }
  ]) {
    const response = await deliver(data);
    assert.equal(response.status, 200);
  }
  assert.deepEqual(dispatches.map((item) => item.client_payload), [
    { result_id: 1, event_type: 'result-added' },
    { result_id: 2, event_type: 'result-updated' },
    { result_id: 3, event_type: 'result-deleted' }
  ]);
});

test('rejects an unauthenticated request before parsing or dispatching', async () => {
  const dispatches = acceptDispatches();
  const response = await harness.fetch('/webhook/incorrect', {
    method: 'POST', body: '{not json'
  });
  assert.equal(response.status, 401);
  assert.equal(dispatches.length, 0);
});

test('deduplicates replayed events despite JSON key order changes', async () => {
  const dispatches = acceptDispatches();
  const first = await deliver({ type: 'result-updated', result: { id: 4, comments: 'safe' } });
  assert.equal(first.status, 200);
  const replay = await deliver({ result: { comments: 'safe', id: 4 }, type: 'result-updated' });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).duplicate, true);
  assert.equal(dispatches.length, 1);

  const changed = await deliver({ type: 'result-updated', result: { id: 4, comments: 'changed' } });
  assert.equal(changed.status, 200);
  assert.equal(dispatches.length, 2);
});

test('holds a concurrent duplicate while its first dispatch is pending', async () => {
  let dispatchCount = 0;
  let signalStarted;
  let releaseDispatch;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const release = new Promise((resolve) => { releaseDispatch = resolve; });
  network.use(http.post(DISPATCH_URL, async () => {
    dispatchCount += 1;
    signalStarted();
    await release;
    return new HttpResponse(null, { status: 204 });
  }));

  const data = { type: 'result-added', result: { id: 5 } };
  const first = deliver(data);
  try {
    await started;
    const duplicate = await deliver(data);
    assert.equal(duplicate.status, 503);
    assert.equal(duplicate.headers.get('Retry-After'), '10');
    assert.equal(dispatchCount, 1);
  } finally {
    releaseDispatch();
  }
  assert.equal((await first).status, 200);
});

test('limits distinct events to ten per rolling minute', async () => {
  const dispatches = acceptDispatches();
  for (let id = 1; id <= 10; id += 1) {
    const response = await deliver({ type: 'result-added', result: { id } });
    assert.equal(response.status, 200);
  }
  const blocked = await deliver({ type: 'result-added', result: { id: 11 } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal(dispatches.length, 10);
});

test('releases a failed dispatch so a valid retry can succeed', async () => {
  let calls = 0;
  network.use(http.post(DISPATCH_URL, () => {
    calls += 1;
    return new HttpResponse(null, { status: calls === 1 ? 503 : 204 });
  }));
  const data = { type: 'result-added', result: { id: 12 } };
  assert.equal((await deliver(data)).status, 502);
  assert.equal((await deliver(data)).status, 200);
  assert.equal(calls, 2);
});

test('logs contain no secret or personal event fields', async () => {
  acceptDispatches();
  const comment = 'private workout comment';
  assert.equal((await deliver({ type: 'result-added', result: {
    id: 13, user_id: 987654, comments: comment
  } })).status, 200);
  const logs = JSON.stringify(harness.getLogs());
  assert.ok(!logs.includes(SECRET));
  assert.ok(!logs.includes('test-pat'));
  assert.ok(!logs.includes(comment));
  assert.ok(!logs.includes('987654'));
});
