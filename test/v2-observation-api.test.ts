import test from 'node:test';
import assert from 'node:assert/strict';
import { V2ObservationApi, V2ResponseBoundError } from '../src/v2-observation-api.ts';

const data = (value: unknown) => Response.json({ data: value });
const signal = () => new AbortController().signal;
const info = { id: 'ses_child', location: { directory: '/fixture' } };
const msg = (id: string, type: string, more = {}) => ({ id, type, time: { created: 1 }, ...more });
function harness(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []; let current = true;
  const api = new V2ObservationApi({ baseUrl: 'http://127.0.0.1:42000', directory: '/fixture', authorization: 'Basic fixture', isCurrent: () => current,
    fetch: async (input, init) => {
      assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error');
      const url = new URL(String(input)); calls.push(url.pathname + url.search);
      const value = overrides[url.pathname + url.search] ?? overrides[url.pathname];
      if (typeof value === 'function') return (value as () => Response)();
      if (value instanceof Response) return value.clone();
      if (value !== undefined) return Response.json(value);
      if (url.pathname === '/api/session/ses_child') return data(info);
      if (url.pathname.endsWith('/message')) return Response.json({ data: [], cursor: { next: null, previous: null } });
      if (url.pathname.endsWith('/active')) return data({});
      return data([]);
    } });
  return { api, calls, replace: () => { current = false; } };
}
test('V2 observation reads exact session, native pending requests and all pages without model calls', async () => {
  const f = harness({
    '/api/session/ses_child/message?limit=200&order=asc': { data: [msg('msg_A', 'assistant', { content: [{ type: 'text', text: 'Result' }] })], cursor: { next: 'opaque' } },
    '/api/session/ses_child/message?limit=200&cursor=opaque': { data: [msg('msg_idle', 'idle', { outcome: 'succeeded' })], cursor: { next: null } },
  });
  assert.equal((await f.api.observe('ses_child', signal())).result?.text, 'Result');
  assert.ok(f.calls.includes('/api/session/ses_child/message?limit=200&cursor=opaque'));
  assert.ok(!f.calls.some(path => path.includes('prompt')));
});
test('unknown cursor cycle and HTML fallback cannot become an empty successful observation', async () => {
  for (const overrides of [
    { '/api/session/ses_child/message': { data: [], cursor: { next: 'repeat' } } },
    { '/api/session/ses_child': new Response('<html>SPA</html>', { headers: { 'content-type': 'text/html' } }) },
  ]) await assert.rejects(harness(overrides).api.observe('ses_child', signal()));
});
test('foreign session identity and workspace are rejected before reading transcript', async () => {
  for (const session of [{ ...info, id: 'ses_foreign' }, { ...info, location: { directory: '/foreign' } }]) {
    const f = harness({ '/api/session/ses_child': { data: session } });
    await assert.rejects(f.api.observe('ses_child', signal())); assert.equal(f.calls.length, 1);
  }
});
test('authentication failure does not change credentials, ports or retry', async () => {
  const f = harness({ '/api/session/ses_child': new Response(null, { status: 401 }) });
  await assert.rejects(f.api.observe('ses_child', signal())); assert.equal(f.calls.length, 1);
});
test('superseded and pre-cancelled monitoring never sends requests', async () => {
  const f = harness(); f.replace(); await assert.rejects(f.api.observe('ses_child', signal())); assert.equal(f.calls.length, 0);
  const g = harness(), controller = new AbortController(); controller.abort();
  await assert.rejects(g.api.observe('ses_child', controller.signal)); assert.equal(g.calls.length, 0);
});
test('identity accepts a future release only when native V2 fields validate', async () => {
  const f = harness({ '/api/info': { version: '2.99.8', pid: 10, urls: [], paths: { tmp: '/tmp' }, extra: true } });
  assert.equal(await f.api.verifyVersion(signal()), '2.99.8');
  await assert.rejects(harness({ '/api/info': { version: '2.99.8' } }).api.verifyVersion(signal()));
});

test('queued native input blocks terminal and safe cancellation evidence after interrupt', async () => {
  const f = harness({
    '/api/session/ses_child/message': { data: [msg('msg_idle', 'idle', { outcome: 'interrupted' })], cursor: {} },
    '/api/session/ses_child/inbox': { data: [{ id: 'msg_queued', sessionID: 'ses_child', delivery: 'queue', type: 'user' }] },
  });
  const snapshot = await f.api.observe('ses_child', signal());
  assert.equal(snapshot.terminal, undefined); assert.equal(snapshot.result, undefined);
  assert.equal(snapshot.executionStopConfirmed, false); assert.equal(snapshot.pendingTools, 1);
});

test('a foreign inbox row never establishes cancellation safety', async () => {
  const f = harness({ '/api/session/ses_child/inbox': { data: [{ id: 'msg_foreign', sessionID: 'ses_other', delivery: 'queue' }] } });
  await assert.rejects(f.api.observe('ses_child', signal()), /ownership/);
});


test('oversized monitoring pages shrink at the same cursor without replaying accepted messages', async () => {
  const pages: { cursor: string | null; limit: number }[] = [];
  const api = new V2ObservationApi({ baseUrl: 'http://127.0.0.1:42000', directory: '/fixture', authorization: 'Basic fixture', isCurrent: () => true,
    fetch: async (input, init) => {
      assert.equal(init?.method, 'GET');
      const url = new URL(String(input));
      if (url.pathname === '/api/session/ses_child') return data(info);
      if (url.pathname.endsWith('/message')) {
        const cursor = url.searchParams.get('cursor'), limit = Number(url.searchParams.get('limit')); pages.push({ cursor, limit });
        if (limit > (cursor ? 25 : 50)) return new Response(' '.repeat(8 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } });
        return Response.json({ data: cursor ? [msg('msg_idle', 'idle', { outcome: 'succeeded' })] :
          [msg('msg_answer', 'assistant', { content: [{ type: 'text', text: 'One complete answer' }] })], cursor: { next: cursor ? null : 'opaque' } });
      }
      return data(url.pathname.endsWith('/active') ? {} : []);
    } });
  const result = await api.observe('ses_child', signal());
  assert.equal(result.result?.text, 'One complete answer');
  assert.deepEqual(pages, [{ cursor: null, limit: 200 }, { cursor: null, limit: 100 }, { cursor: null, limit: 50 },
    { cursor: 'opaque', limit: 50 }, { cursor: 'opaque', limit: 25 }]);
});

test('one oversized record retains a hard bound and redacted endpoint diagnostics rather than partial success', async () => {
  const f = harness({ '/api/session/ses_child/message': () => new Response(' '.repeat(8 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(f.api.observe('ses_child', signal()), error => error instanceof V2ResponseBoundError
    && error.method === 'GET' && /GET \/api\/session\/:session\/message/.test(error.message) && !error.message.includes('ses_child'));
  assert.deepEqual(f.calls.filter(path => path.includes('/message')).map(path => new URL(path, 'http://fixture').searchParams.get('limit')),
    ['200', '100', '50', '25', '12', '6', '3', '1']);
  assert.ok(!f.calls.some(path => path.endsWith('/active')));
});
