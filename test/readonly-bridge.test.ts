import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startReadonlyBridge } from '../src/readonly-bridge.ts';

test('real authenticated identity endpoint validates challenge and never exposes owner errors', async () => {
  const token = 'ab'.repeat(32);
  const challenge = 'cd'.repeat(32);
  let calls = 0;
  const bridge = await startReadonlyBridge({ token, snapshot: async () => ({}), identity: received => {
    calls++;
    if (calls > 1) throw new Error('secret owner error');
    return { challenge: received };
  } });
  try {
    const endpoint = `${bridge.endpoint}/v1/identity?challenge=${challenge}`;
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(endpoint)).status, 401);
    assert.equal((await fetch(endpoint, { headers, method: 'POST' })).status, 405);
    assert.equal((await fetch(endpoint, { headers: { ...headers, Origin: 'null' } })).status, 403);
    assert.equal((await fetch(`${endpoint}&challenge=${challenge}`, { headers })).status, 400);
    assert.equal((await fetch(`${bridge.endpoint}/v1/identity?challenge=bad`, { headers })).status, 400);
    assert.deepEqual(await (await fetch(endpoint, { headers })).json(), { challenge });
    const failed = await fetch(endpoint, { headers });
    assert.equal(failed.status, 502);
    assert.equal(await failed.text(), '');
    assert.equal(calls, 2);
  } finally { await bridge.close(); }
  await assert.rejects(startReadonlyBridge({ token: 'bad', snapshot: async () => ({}) }));
});

test('real loopback bridge authenticates, scopes reads and rejects write/browser requests', async () => {
  const parents: string[] = [];
  const bridge = await startReadonlyBridge({ snapshot: async parent => {
    parents.push(parent);
    return { parentSessionId: parent };
  } });
  try {
    const endpoint = `${bridge.endpoint}/v1/snapshot?parentSessionId=ses_A`;
    const headers = { Authorization: `Bearer ${bridge.token}` };
    assert.equal((await fetch(endpoint)).status, 401);
    assert.equal((await fetch(endpoint, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(endpoint, { headers: { ...headers, Origin: 'https://example.test' } })).status, 403);
    assert.equal((await fetch(endpoint, { headers, method: 'POST' })).status, 405);
    assert.equal((await fetch(`${endpoint}&parentSessionId=ses_B`, { headers })).status, 400);
    assert.equal((await fetch(`${endpoint}&token=forbidden`, { headers })).status, 400);
    const response = await fetch(endpoint, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { parentSessionId: 'ses_A' });
    assert.deepEqual(parents, ['ses_A']);
  } finally { await bridge.close(); }
  await bridge.close();
  await assert.rejects(fetch(bridge.endpoint));
});

test('deadline discards late results and retains capacity for an uncooperative provider', async () => {
  let release!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  const bridge = await startReadonlyBridge({ deadlineMs: 30, maxConcurrent: 1, snapshot: async (_parent, received) => {
    signal = received;
    return new Promise(resolve => { release = resolve; });
  } });
  const endpoint = `${bridge.endpoint}/v1/snapshot?parentSessionId=ses_A`;
  const headers = { Authorization: `Bearer ${bridge.token}` };
  try {
    assert.equal((await fetch(endpoint, { headers })).status, 504);
    assert.equal(signal?.aborted, true);
    assert.equal((await fetch(endpoint, { headers })).status, 429);
    release({ late: true });
  } finally { await bridge.close(); }
});

test('response bounds and owner errors never expose error details', async () => {
  for (const snapshot of [async () => 'x'.repeat(100), async () => { throw new Error('secret command'); }]) {
    const bridge = await startReadonlyBridge({ maxResponseBytes: 20, snapshot });
    try {
      const response = await fetch(`${bridge.endpoint}/v1/snapshot?parentSessionId=ses_A`, {
        headers: { Authorization: `Bearer ${bridge.token}` },
      });
      assert.equal(response.status, 502);
      assert.equal(await response.text(), '');
    } finally { await bridge.close(); }
  }
});
