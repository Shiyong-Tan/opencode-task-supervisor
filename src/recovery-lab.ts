import { bounded } from './clock.ts';
import type { Supervisor } from './supervisor.ts';

export interface Notice {
  key: string; parent: string; state: 'queued' | 'submitted' | 'unknown' | 'progress_observed' | 'escalated';
  createdAt: number; submittedAt?: number; baseline: Set<string>; reason?: string;
}

// Never exposed as plugin tools. The isolated harness must supply IDs it just created.
export class RecoveryLab {
  private readonly notices = new Map<string, Notice>();
  private readonly busy = new Set<string>();
  constructor(readonly supervisor: Supervisor, private readonly isolatedSessions: ReadonlySet<string>, readonly recoveryMs = 10_000) {}
  private assertIsolated(id: string) {
    if (!this.isolatedSessions.has(id)) throw new Error('Recovery action refused outside isolated session allowlist');
  }
  async cancel(taskId: string, owner: string) {
    const task = this.supervisor.registry.get(taskId, owner);
    if (!task.childSessionId) throw new Error('No known child');
    this.assertIsolated(owner); this.assertIsolated(task.childSessionId);
    if (task.cancellation !== 'none' || task.phase === 'terminal') return;
    task.cancellation = 'requested'; task.health = 'cancel_unknown';
    const attemptId = task.attemptId;
    try {
      await bounded(this.supervisor.clock, this.supervisor.requestMs, signal => this.supervisor.api.abort(task.childSessionId!, signal));
      if (task.attemptId === attemptId) task.cancellation = 'acknowledged';
    } catch { if (task.attemptId === attemptId) task.cancellation = 'unknown'; }
    task.reason = 'No process-tree stop certificate; parent must verify old execution before retry';
  }
  enqueue(taskId: string, owner: string): Notice {
    const task = this.supervisor.registry.get(taskId, owner);
    this.assertIsolated(owner);
    const key = `${task.taskId}:${task.attemptId}:${owner}`;
    const existing = this.notices.get(key);
    if (existing) return existing;
    const notice: Notice = { key, parent: owner, state: 'queued', createdAt: this.supervisor.clock.now(), baseline: new Set() };
    this.notices.set(key, notice);
    return notice;
  }
  async check(notice: Notice): Promise<void> {
    if (this.notices.get(notice.key) !== notice) throw new Error('Unknown notice');
    if (this.busy.has(notice.parent) || ['progress_observed', 'escalated'].includes(notice.state)) return;
    this.busy.add(notice.parent);
    const { api, clock, requestMs } = this.supervisor;
    try {
      const snapshot = await bounded(clock, requestMs, signal => api.observe(notice.parent, signal));
      if (notice.submittedAt !== undefined && snapshot.assistantActivity.some(key => !notice.baseline.has(key))) {
        notice.state = 'progress_observed'; return;
      }
      if (clock.now() - (notice.submittedAt ?? notice.createdAt) >= this.recoveryMs) {
        notice.state = 'escalated'; notice.reason = 'Parent has not shown new assistant/tool activity; user intervention required'; return;
      }
      if (notice.state !== 'queued' || snapshot.status !== 'idle' || snapshot.pendingTools || snapshot.permissionIds.length) return;
      notice.baseline = new Set(snapshot.assistantActivity);
      notice.state = 'unknown'; // Reserve before mutation; ambiguous delivery is never resent automatically.
      notice.submittedAt = clock.now();
      await bounded(clock, requestMs, signal => api.notify(notice.parent, `Supervisor report ${notice.key}. Inspect existing child results and stop evidence before deciding recovery.`, signal));
      notice.state = 'submitted';
    } catch (error) {
      notice.reason = String(error);
      if (clock.now() - notice.createdAt >= this.recoveryMs) notice.state = 'escalated';
    } finally { this.busy.delete(notice.parent); }
  }
}
