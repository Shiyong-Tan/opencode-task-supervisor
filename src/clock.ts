import { setTimeout as delay } from 'node:timers/promises';
import type { Clock } from './types.ts';

export const clock: Clock = {
  now: () => performance.now(),
  sleep: async (ms, signal) => { await delay(ms, undefined, { signal }); },
};

// The deadline also bounds transports that ignore AbortSignal. Late outcomes are not applied.
export async function bounded<T>(clock: Clock, ms: number, operation: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error('Deadline must be positive and finite');
  outer?.throwIfAborted();
  const controller = new AbortController();
  const timer = new AbortController();
  const abort = () => controller.abort(outer?.reason);
  outer?.addEventListener('abort', abort, { once: true });
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  try {
    return await Promise.race([
      operation(controller.signal), cancelled,
      clock.sleep(ms, timer.signal).then(() => { throw new Error('deadline_exceeded'); }),
    ]);
  } finally {
    timer.abort();
    controller.abort(new Error('operation_finished'));
    outer?.removeEventListener('abort', abort);
  }
}
