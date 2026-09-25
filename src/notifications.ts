import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { bounded } from './clock.ts';
import type { Supervisor } from './supervisor.ts';
import type { Identity, Snapshot } from './types.ts';
import type { Execution } from './executions.ts';

export interface CompletionNotice extends Identity {
  execution?: Execution;
  eventId: string;
  notificationId: string;
  messageId: string;
  delivery: 'queued' | 'submitting' | 'submitted' | 'unknown' | 'received';
  progress: 'not_observed' | 'activity_observed' | 'result_read';
  createdAt: number;
  submittedAt?: number;
  receivedAt?: number;
  activityObservedAt?: number;
  resultReadMessageId?: string;
  escalated?: string;
  idleSince?: number;
  baseline: Set<string>;
}

export class Notifications {
  private readonly notices = new Map<string, CompletionNotice>();
  private readonly inFlight = new Set<string>();
  constructor(readonly supervisor: Supervisor, readonly recoveryMs = 30_000, readonly idleSettleMs = 250,
    private readonly beforeSubmit?: (notice: Readonly<CompletionNotice>) => Promise<void>) {}

  enqueue(taskId: string, owner: string): CompletionNotice | undefined {
    const task = this.supervisor.registry.get(taskId, owner);
    if (task.delivery === 'inline') return;
    if (task.phase !== 'terminal' || !task.result || !task.childSessionId) return;
    if (this.all().some(n => n.taskId === taskId && n.attemptId === task.attemptId && n.execution)) return;
    const eventId = createHash('sha256').update(JSON.stringify([
      task.taskId, task.attemptId, owner, task.childSessionId, task.result.sourceEventId ?? task.result.messageId, task.result.outcome,
    ])).digest('hex');
    const prior = this.notices.get(eventId);
    if (prior) return prior;
    const notice: CompletionNotice = {
      taskId, attemptId: task.attemptId, parentSessionId: owner, childSessionId: task.childSessionId,
      eventId, notificationId: randomUUID(), messageId: '', delivery: 'queued', progress: 'not_observed',
      createdAt: this.supervisor.clock.now(), baseline: new Set(),
    };
    this.notices.set(eventId, notice);
    return notice;
  }
  all(): CompletionNotice[] { return [...this.notices.values()]; }
  enqueueCancellation(execution: Execution): CompletionNotice | undefined {
    if (this.supervisor.registry.current(execution)?.delivery === 'inline') return;
    if (!this.supervisor.registry.current(execution) || !execution.cancelRequested || execution.phase !== 'stopped' ||
      execution.cancelOutcomeUnknown || !execution.sample?.ownedProcessesStopped || execution.sample.coverageUnknown) return;
    const eventId = createHash('sha256').update(JSON.stringify(['execution-stopped', execution.taskId,
      execution.attemptId, execution.parentSessionId, execution.childSessionId, execution.executionId])).digest('hex');
    const prior = this.notices.get(eventId); if (prior) return prior;
    const notice: CompletionNotice = { taskId: execution.taskId, attemptId: execution.attemptId,
      parentSessionId: execution.parentSessionId, childSessionId: execution.childSessionId,
      execution: structuredClone(execution), eventId, notificationId: randomUUID(), messageId: '',
      delivery: 'queued', progress: 'not_observed', createdAt: this.supervisor.clock.now(), baseline: new Set() };
    this.notices.set(eventId, notice); return notice;
  }
  forTask(taskId: string, owner: string): CompletionNotice | undefined {
    const task = this.supervisor.registry.get(taskId, owner);
    return this.all().find(n => n.taskId === taskId && n.attemptId === task.attemptId && n.parentSessionId === owner);
  }
  readResult(taskId: string, owner: string, messageId: string, notificationId?: string): void {
    this.supervisor.registry.get(taskId, owner);
    const notice = this.all().find(n => n.taskId === taskId && n.parentSessionId === owner && n.notificationId === notificationId && this.supervisor.registry.current(n));
    if (!notice || notice.escalated || !notificationId || notificationId !== notice.notificationId || !messageId)
      return;
    if (notice.submittedAt === undefined) return;
    notice.progress = 'result_read';
    notice.activityObservedAt ??= this.supervisor.clock.now();
    notice.resultReadMessageId ??= messageId;
    // Reading the result is evidence, never a claim of successful downstream work.
  }
  private safe(snapshot: Snapshot) {
    return snapshot.status === 'idle' && snapshot.pendingTools === 0 && snapshot.permissionIds.length === 0;
  }
  async check(notice: CompletionNotice): Promise<void> {
    if (this.notices.get(notice.eventId) !== notice) throw new Error('Unknown completion event');
    if (notice.escalated || (notice.progress === 'result_read' && notice.delivery === 'received') || this.inFlight.has(notice.parentSessionId)) return;
    if (!this.supervisor.registry.current(notice)) return;
    this.inFlight.add(notice.parentSessionId);
    const { clock, api, requestMs } = this.supervisor;
    try {
      if (clock.now() - (notice.submittedAt ?? notice.createdAt) >= this.recoveryMs) {
        notice.escalated = 'Parent did not read the child result before the recovery deadline; no further prompts will be sent';
        return;
      }
      const snapshot = await bounded(clock, requestMs, signal => api.observe(notice.parentSessionId, signal));
      if (!this.supervisor.registry.current(notice)) return;
      if (notice.submittedAt !== undefined) {
        if (snapshot.messageIds?.includes(notice.messageId)) {
          notice.delivery = 'received'; notice.receivedAt ??= clock.now();
          if (snapshot.assistantActivity.some(key => !notice.baseline.has(key))) {
            notice.activityObservedAt ??= clock.now();
            if (notice.progress !== 'result_read') notice.progress = 'activity_observed';
          }
        }
        return; // Includes unknown submission: never blindly send a second prompt.
      }
      if (!this.safe(snapshot)) { notice.idleSince = undefined; return; }
      notice.idleSince ??= clock.now();
      if (clock.now() - notice.idleSince < this.idleSettleMs) return;
      const confirmation = await bounded(clock, requestMs, signal => api.observe(notice.parentSessionId, signal));
      if (!this.safe(confirmation)) { notice.idleSince = undefined; return; }
      if (!this.supervisor.registry.current(notice)) return;
      if (clock.now() - notice.createdAt >= this.recoveryMs) {
        notice.escalated = 'Parent notification deadline elapsed during safety checks; no prompt sent';
        return;
      }
      notice.baseline = new Set(confirmation.assistantActivity);
      notice.messageId ||= `msg_${(BigInt(Date.now()) * 4096n).toString(16).slice(-12).padStart(12, '0')}${randomBytes(7).toString('hex')}`;
      if (this.beforeSubmit) {
        try { await bounded(clock, requestMs, () => this.beforeSubmit!(structuredClone(notice))); }
        catch {
          notice.escalated = 'Notification identity persistence failed or timed out; no prompt sent';
          return;
        }
        if (!this.supervisor.registry.current(notice)) return;
        if (clock.now() - notice.createdAt >= this.recoveryMs) {
          notice.escalated = 'Notification deadline elapsed while persisting identity; no prompt sent';
          return;
        }
        // Persistence is another asynchronous boundary. Recheck parent safety.
        const afterPersistence = await bounded(clock, requestMs, signal => api.observe(notice.parentSessionId, signal));
        if (!this.safe(afterPersistence)) {
          notice.idleSince = undefined;
          return;
        }
        if (!this.supervisor.registry.current(notice)) return;
        if (clock.now() - notice.createdAt >= this.recoveryMs) {
          notice.escalated = 'Notification deadline elapsed after identity persistence; no prompt sent';
          return;
        }
        notice.baseline = new Set(afterPersistence.assistantActivity);
      }
      notice.delivery = 'submitting'; notice.submittedAt = clock.now();
      const task = this.supervisor.registry.get(notice.taskId, notice.parentSessionId);
      const text = notice.execution ?
        `Supervisor managed cancellation notification ${notice.notificationId}. Event ${notice.eventId}. ` +
        JSON.stringify({ kind: 'managed_execution_stopped', taskId: notice.taskId, attemptId: notice.attemptId,
          parentSessionId: notice.parentSessionId, childSessionId: notice.childSessionId,
          executionId: notice.execution.executionId, toolCallId: notice.execution.toolCallId,
          reason: 'Explicit laboratory cancellation', lastActivityAt: notice.execution.lastActivityAt,
          observedAt: notice.execution.sample?.observedAt, rootExited: notice.execution.sample?.rootExited,
          ownedProcessesStopped: notice.execution.sample?.ownedProcessesStopped, coverageUnknown: notice.execution.sample?.coverageUnknown,
          exitCode: notice.execution.sample?.exitCode, artifactPaths: notice.execution.artifactPaths,
          limits: 'Only local Job members stopped; side effects not rolled back; child agent may still be active; no automatic retry.' }) +
        ` Call managed_result with executionId="${notice.execution.executionId}" and notificationId="${notice.notificationId}"; ` +
        'then managed_artifact to inspect the recorded test artifact before deciding the next step. Do not create replacement tasks.' :
        `Supervisor completion notification ${notice.notificationId}. Event ${notice.eventId}. ` +
        `Task ${notice.taskId}, attempt ${notice.attemptId}, child ${notice.childSessionId}, outcome ${task.outcome}. ` +
        `Call supervisor_result with taskId="${notice.taskId}" and notificationId="${notice.notificationId}". ` +
        'Read the existing result and perform the previously requested next step. Do not dispatch another child or loop on wait.';
      await bounded(clock, requestMs, signal => api.notify(notice.parentSessionId, text, signal, notice.messageId));
      notice.delivery = 'submitted';
    } catch {
      if (notice.submittedAt !== undefined) notice.delivery = 'unknown';
      // Query failures before submission are retryable reads, not successful progress.
    } finally { this.inFlight.delete(notice.parentSessionId); }
  }
  async tick(): Promise<void> {
    for (const task of this.supervisor.registry.all()) this.enqueue(task.taskId, task.parentSessionId);
    await Promise.all(this.all().map(notice => this.check(notice)));
  }
}

export function noticeReport(notice: CompletionNotice) {
  const { baseline: _, idleSince: __, ...value } = notice;
  return { ...value, closedLoop: 'not_verified_by_supervisor' };
}
