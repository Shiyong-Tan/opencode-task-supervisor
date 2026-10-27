import { parseOpenCodeVersion } from './opencode-version.ts';
import { snapshotFromV2 } from './v2-observation.ts';
import type { Snapshot } from './types.ts';
import { resolve } from 'node:path';

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid V2 response object');
  return value as RecordValue;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid V2 response array');
  return value;
}

/** Read-only monitoring side of the native V2 port; mutations belong to the V2 plugin entrypoint. */
export class V2ObservationApi {
  private readonly origin: string;
  constructor(readonly options: { baseUrl: string; directory: string; authorization: string;
    isCurrent(): boolean; fetch?: typeof fetch }) {
    const url = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Expected selected V2 loopback origin');
    this.origin = url.origin;
  }
  private current(signal: AbortSignal) {
    signal.throwIfAborted();
    if (!this.options.isCurrent()) throw new Error('V2 service generation superseded');
  }
  protected async request(path: string, signal: AbortSignal, method: 'GET' | 'POST' = 'GET', body?: unknown, timeoutMs = 5000): Promise<unknown> {
    this.current(signal);
    if (!path.startsWith('/api/') || path.includes('#') || new URL(path, this.origin).origin !== this.origin) throw new Error('Invalid V2 request scope');
    const bound = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const response = await (this.options.fetch ?? fetch)(new URL(path, this.origin), {
      method, signal: bound, cache: 'no-store', redirect: 'error',
      headers: { Authorization: this.options.authorization, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    try { this.current(signal); } catch (error) { void response.body?.cancel().catch(() => undefined); throw error; }
    if (response.status === 204) return undefined;
    if (!response.ok || !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
      void response.body?.cancel().catch(() => undefined); throw new Error(`V2 monitoring response unavailable: HTTP ${response.status}`);
    }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    const abort = () => { void reader.cancel().catch(() => undefined); };
    bound.addEventListener('abort', abort, { once: true });
    try {
      while (true) {
        bound.throwIfAborted(); this.current(signal);
        const item = await reader.read(); bound.throwIfAborted(); this.current(signal);
        if (item.done) break;
        size += item.value.byteLength;
        if (size > 8 * 1024 * 1024) throw new Error('V2 monitoring response bound exceeded');
        chunks.push(item.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally { bound.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  protected read(path: string, signal: AbortSignal): Promise<unknown> { return this.request(path, signal); }
  async verifyVersion(signal: AbortSignal): Promise<string> {
    const info = record(await this.read('/api/info', signal));
    if (!Number.isSafeInteger(info.pid) || Number(info.pid) < 0 || !Array.isArray(info.urls) ||
      info.urls.some(item => typeof item !== 'string') || typeof record(info.paths).tmp !== 'string') throw new Error('Invalid V2 identity');
    return parseOpenCodeVersion(info.version);
  }
  protected matchesWorkspace(directory: unknown): boolean {
    const key = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
    return typeof directory === 'string' && key(directory) === key(this.options.directory);
  }
  async observe(sessionId: string, signal: AbortSignal): Promise<Snapshot> {
    if (!/^ses_[A-Za-z0-9_-]{1,240}$/.test(sessionId)) throw new Error('Invalid V2 observation session');
    const path = `/api/session/${encodeURIComponent(sessionId)}`;
    const session = record(record(await this.read(path, signal)).data);
    if (session.id !== sessionId) throw new Error('V2 session identity mismatch');
    const directory = record(session.location).directory;
    if (!this.matchesWorkspace(directory)) throw new Error('V2 session workspace mismatch');
    const messages: unknown[] = [], seen = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= 128) throw new Error('V2 transcript exceeds observation pagination bound');
      const query = new URLSearchParams({ limit: '200' });
      if (cursor === undefined) query.set('order', 'asc'); else query.set('cursor', cursor);
      const response = record(await this.read(`${path}/message?${query}`, signal));
      messages.push(...list(response.data));
      const next = record(response.cursor).next;
      if (next === undefined || next === null) break;
      if (typeof next !== 'string' || !next || seen.has(next)) throw new Error('Invalid V2 transcript cursor');
      seen.add(next); cursor = next;
    }
    const [active, permissions, forms, inbox] = await Promise.all([
      this.read('/api/session/active', signal), this.read(`${path}/permission`, signal), this.read(`${path}/form`, signal), this.read(`${path}/inbox`, signal),
    ]);
    this.current(signal);
    const snapshot = snapshotFromV2(sessionId, messages, record(active).data, record(permissions).data, record(forms).data);
    const queued = list(record(inbox).data);
    for (const value of queued) {
      const item = record(value);
      if (item.sessionID !== sessionId || typeof item.id !== 'string' || !item.id.startsWith('msg_') || !['queue', 'steer'].includes(String(item.delivery))) throw new Error('Invalid native inbox ownership');
    }
    if (queued.length) {
      snapshot.pendingTools += queued.length; snapshot.terminal = undefined; snapshot.result = undefined; snapshot.executionStopConfirmed = false;
    }
    return snapshot;
  }
}
