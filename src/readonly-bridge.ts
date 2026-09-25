import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Transport only. The owner supplies a validated, redacted protocol projection. */
export interface ReadonlyBridgeOptions {
  snapshot(parentSessionId: string, signal: AbortSignal): Promise<unknown>;
  /** Normal integration supplies a derived token; labs retain a fresh random token. */
  token?: string;
  identity?(challenge: string): unknown;
  deadlineMs?: number;
  maxConcurrent?: number;
  maxResponseBytes?: number;
}

export interface ReadonlyBridge {
  /** Privileged discovery only: never forward this descriptor to a Webview. */
  endpoint: string;
  token: string;
  close(): Promise<void>;
}

export async function startReadonlyBridge(options: ReadonlyBridgeOptions): Promise<ReadonlyBridge> {
  const deadlineMs = options.deadlineMs ?? 2_000;
  const maxConcurrent = options.maxConcurrent ?? 4;
  const maxResponseBytes = options.maxResponseBytes ?? 262_144;
  for (const value of [deadlineMs, maxConcurrent, maxResponseBytes]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid bridge bound');
  }
  const token = options.token ?? randomBytes(32).toString('hex');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid bridge token');
  const expected = Buffer.from(`Bearer ${token}`);
  const pending = new Set<AbortController>();
  let closing = false;
  let authority = '';
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const finish = (status: number, body = '') => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(body);
    };
    // No browser origin, cookies, CORS, URL credentials, redirects, or production auth.
    if (closing) return finish(503);
    if (request.headers.host !== authority || request.headers.origin !== undefined) return finish(403);
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return finish(401);
    if (request.method !== 'GET') return finish(405);
    if (!request.url?.startsWith('/')) return finish(400);
    const url = new URL(request.url, `http://${authority}`);
    if (url.pathname === '/v1/identity' && options.identity) {
      const challenge = url.searchParams.get('challenge');
      if ([...url.searchParams.keys()].length !== 1 || !challenge || !/^[a-f0-9]{64}$/.test(challenge)) return finish(400);
      try {
        const body = JSON.stringify(options.identity(challenge));
        if (body === undefined || Buffer.byteLength(body) > maxResponseBytes) return finish(502);
        return finish(200, body);
      } catch { return finish(502); }
    }
    if (url.pathname !== '/v1/snapshot') return finish(404);
    const keys = [...url.searchParams.keys()];
    const parent = url.searchParams.get('parentSessionId');
    if (keys.length !== 1 || keys[0] !== 'parentSessionId' || !parent || !/^ses_[A-Za-z0-9_-]{1,160}$/.test(parent)) {
      return finish(400);
    }
    if (pending.size >= maxConcurrent) return finish(429);
    const controller = new AbortController();
    pending.add(controller);
    const timer = setTimeout(() => {
      controller.abort();
      finish(504);
    }, deadlineMs);
    timer.unref();
    const onClose = () => controller.abort();
    response.once('close', onClose);
    try {
      const snapshot = await options.snapshot(parent, controller.signal);
      if (controller.signal.aborted || closing) return;
      const body = JSON.stringify(snapshot);
      if (body === undefined || Buffer.byteLength(body) > maxResponseBytes) return finish(502);
      finish(200, body);
    } catch {
      // Owner errors may contain command text or credentials; never echo them.
      finish(502);
    } finally {
      clearTimeout(timer);
      response.off('close', onClose);
      pending.delete(controller);
    }
    // A provider ignoring abort keeps its concurrency slot until settled. A timeout
    // must not permit unlimited detached work behind apparently bounded HTTP calls.
  });
  server.headersTimeout = Math.max(1_000, deadlineMs);
  server.requestTimeout = Math.max(1_000, deadlineMs);
  server.keepAliveTimeout = 1_000;
  server.maxHeadersCount = 16;
  server.maxConnections = maxConcurrent + 8;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  authority = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  let closePromise: Promise<void> | undefined;
  return {
    endpoint: `http://${authority}`,
    token,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const controller of pending) controller.abort();
      closePromise = new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      return closePromise;
    },
  };
}
