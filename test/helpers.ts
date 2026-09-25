import type { Api, Clock, Snapshot } from '../src/types.ts';

export class FakeClock implements Clock {
  time = 0;
  timers: { at: number; resolve: () => void }[] = [];
  now() { return this.time; }
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      const entry = { at: this.time + ms, resolve: () => { signal?.removeEventListener('abort', abort); resolve(); } };
      const abort = () => { this.timers = this.timers.filter(t => t !== entry); reject(signal?.reason); };
      signal?.addEventListener('abort', abort, { once: true });
      this.timers.push(entry);
    });
  }
  async advance(ms: number) {
    this.time += ms;
    for (const timer of [...this.timers]) {
      if (timer.at <= this.time) { this.timers = this.timers.filter(t => t !== timer); timer.resolve(); }
    }
    await flush();
  }
}
export const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
export const snapshot = (sessionId: string, changes: Partial<Snapshot> = {}): Snapshot => ({
  sessionId, status: 'busy', activity: [], assistantActivity: [], permissionIds: [], pendingTools: 0,
  process: 'unknown', ...changes,
});
export class FakeApi implements Api {
  creates = 0; dispatches = 0; aborts = 0; notifications = 0;
  snapshots = new Map<string, Snapshot>();
  async create() { return `child-${++this.creates}`; }
  async dispatch() { this.dispatches++; }
  async observe(id: string) {
    const result = this.snapshots.get(id);
    if (!result) throw new Error('query failed');
    return result;
  }
  async abort() { this.aborts++; }
  async notify() { this.notifications++; }
}
