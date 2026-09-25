import { bounded } from './clock.ts';
import { Registry, report } from './registry.ts';
import type { Api, Clock, Identity, Task } from './types.ts';
import type { Snapshot } from './types.ts';
import type { AgentDispatch } from './agent-dispatch.ts';
import { taskTitle } from './task-title.ts';

export class Supervisor {
  readonly registry: Registry;
  private readonly dispatches = new Map<string, Promise<void>>();
  private readonly observations = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, { attemptId: string; eventId: string; name: string }>();
  processEvidence?: (id: Identity) => { process: Snapshot['process']; processActivity?: string; pending: boolean; permission: boolean } | undefined;
  constructor(readonly api: Api, readonly clock: Clock, readonly requestMs = 5000, staleMs = 300_000) {
    this.registry = new Registry(clock, staleMs);
  }
  register(parent: string, taskId?: string) { return report(this.registry.register(parent, taskId)); }
  dispatch(taskId: string, owner: string, prompt: string, selection?: AgentDispatch, delivery: Task['delivery'] = 'notification', description?: string) {
    const task = this.registry.get(taskId, owner);
    if (task.cancellation !== 'none') throw new Error('Cancelled or uncertain task cannot be dispatched again');
    if (task.phase !== 'registered' && task.agent !== selection?.agent) throw new Error('Task agent cannot change after dispatch');
    if (task.phase !== 'registered') return report(task); // Idempotent: no retry after ambiguous submission.
    const selected = selection ? structuredClone(selection) : undefined;
    task.agent = selected?.agent;
    task.title = taskTitle(description, selected?.agent);
    task.delivery = delivery;
    task.phase = 'dispatching'; task.dispatch = 'pending';
    const pending = this.start(task, prompt, selected).finally(() => this.dispatches.delete(task.taskId));
    this.dispatches.set(taskId, pending);
    return report(task); // Return control without waiting for model execution or network.
  }
  private async start(task: Task, prompt: string, selection?: AgentDispatch): Promise<void> {
    try {
      const child = await bounded(this.clock, this.requestMs, signal => this.api.create(task.parentSessionId,
        task.title!, signal, selection));
      this.registry.attach(task, child);
      if (task.cancellation !== 'none') return;
      await bounded(this.clock, this.requestMs, signal => this.api.dispatch(child, prompt, signal, selection));
      task.dispatch = 'accepted';
      if (task.phase !== 'terminal') task.phase = 'active';
    } catch (error) {
      task.dispatch = 'unknown';
      if (task.phase === 'terminal') return;
      task.health = 'unreachable';
      task.reason = `Dispatch uncertain; do not retry automatically: ${String(error)}`;
    }
  }
  async observe(taskId: string, owner: string, timeout = this.requestMs): Promise<void> {
    const task = this.registry.get(taskId, owner);
    if (!task.childSessionId || task.phase === 'terminal') return;
    const existing = this.observations.get(taskId);
    if (existing) return existing;
    const id: Identity = { taskId, attemptId: task.attemptId, parentSessionId: owner, childSessionId: task.childSessionId };
    const pending = (async () => {
      try {
        const snapshot = await bounded(this.clock, timeout, signal => this.api.observe(id.childSessionId!, signal));
        const process = this.processEvidence?.(id);
        if (process) {
          snapshot.process = process.process; snapshot.processActivity = process.processActivity;
          if (process.pending) { snapshot.pendingTools++; snapshot.terminal = undefined; snapshot.result = undefined; }
          if (process.permission) snapshot.permissionIds.push('managed-command-permission');
        }
        const failure = this.failures.get(id.childSessionId!);
        if (!snapshot.terminal && failure?.attemptId === id.attemptId && snapshot.status === 'idle' && !snapshot.pendingTools && !snapshot.permissionIds.length) {
          snapshot.terminal = 'failed';
          snapshot.result = { messageId: '', text: '', outcome: 'failed', error: failure.name, sourceEventId: failure.eventId };
        }
        this.registry.apply(id, snapshot);
      } catch (error) { this.registry.queryFailed(id, String(error)); }
    })().finally(() => this.observations.delete(taskId));
    this.observations.set(taskId, pending);
    return pending;
  }
  status(taskId: string, owner: string) { return report(this.registry.get(taskId, owner)); }
  recordSessionError(childSessionId: string, eventId: string, name: string): void {
    const task = this.registry.all().find(t => t.childSessionId === childSessionId);
    if (!task || task.phase === 'terminal' || task.cancellation !== 'none') return;
    this.failures.set(childSessionId, { attemptId: task.attemptId, eventId, name });
  }
  result(taskId: string, owner: string) {
    const task = this.registry.get(taskId, owner);
    return { ...report(task), result: task.result ? { ...task.result } : null };
  }
  /** Keeps the tool open, not the model generating. HTTP polling consumes no model calls. */
  async waitForDecision(taskId: string, owner: string, waitMs = 60_000, signal?: AbortSignal) {
    if (!Number.isFinite(waitMs) || waitMs < 1000 || waitMs > 120_000) throw new Error('waitMs must be between 1000 and 120000');
    const task = this.registry.get(taskId, owner);
    const attention = () => task.health !== 'running' && task.health !== 'ended';
    const ready = () => task.phase === 'terminal' || task.phase === 'registered' ||
      (attention() && task.monitorAlert !== task.health);
    if (!ready()) {
      try {
        await bounded(this.clock, waitMs, async inner => {
          while (!inner.aborted) {
            await this.observe(taskId, owner);
            inner.throwIfAborted();
            if (!attention()) task.monitorAlert = undefined;
            if (ready()) return;
            await this.clock.sleep(1000, inner);
          }
        }, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        if (!(error instanceof Error) || error.message !== 'deadline_exceeded') throw error;
      }
    }
    signal?.throwIfAborted();
    const event = task.phase === 'terminal' ? 'completed' : task.phase === 'registered' ? 'not_dispatched' :
      attention() ? 'attention' : 'checkpoint';
    if (attention()) task.monitorAlert = task.health;
    return { ...this.result(taskId, owner), event,
      lastObservationAgeMs: task.lastCheckedAt === undefined ? null : Math.max(0, this.clock.now() - task.lastCheckedAt),
      lastProgressAgeMs: Math.max(0, this.clock.now() - task.lastProgressAt),
      safeToRetry: false,
      next: event === 'completed' ? 'Read and assess this result, then continue the original request. Finalize only when the overall work is complete.' :
        event === 'not_dispatched' ? 'This task is only registered; dispatch it once before waiting.' :
        'This is a monitoring checkpoint, not completion. Inspect health and activity evidence. Continue with supervisor_wait for the same task (default 60000ms), or decide whether to request supervisor_cancel. Do not finalize merely because a child is pending. Never start overlapping replacement work without verified old-execution stop evidence.' };
  }

  /** Explicit, parent-owned session abort. Acknowledgment is never a process-tree certificate. */
  async cancel(taskId: string, owner: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const task = this.registry.get(taskId, owner);
    if (task.cancellation === 'none' && task.phase !== 'terminal') {
      task.cancellation = 'requested'; task.health = 'cancel_unknown';
      try {
        // Fence a not-yet-submitted prompt before aborting the known child.
        const pending = this.dispatches.get(taskId);
        if (pending) await bounded(this.clock, this.requestMs * 2 + 1000, async () => { await pending; }, signal);
        if (!task.childSessionId) throw new Error('No known child to abort');
        await bounded(this.clock, this.requestMs, inner => this.api.abort(task.childSessionId!, inner), signal);
        task.cancellation = 'acknowledged';
      } catch { task.cancellation = 'unknown'; }
      task.reason = 'Session abort does not prove tools or external processes stopped. Verify old execution and partial changes before replacement.';
    }
    return { ...this.result(taskId, owner), requestAccepted: task.cancellation === 'acknowledged',
      ownedProcessesStopped: null, safeToRetry: false,
      next: 'Inspect the existing child, attributable process-stop evidence and partial changes before deciding on a new registration. No cancellation acknowledgment, idle state or silence alone authorizes an overlapping retry.' };
  }
  async wait(taskId: string, owner: string, waitMs: number, signal?: AbortSignal) {
    if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error('waitMs must be finite and nonnegative');
    const budget = Math.min(waitMs, 2000);
    if (budget === 0) return this.status(taskId, owner);
    try {
      await bounded(this.clock, budget, async inner => {
        while (!inner.aborted) {
          await this.observe(taskId, owner, Math.min(this.requestMs, budget));
          const task = this.registry.get(taskId, owner);
          if (task.phase === 'terminal' || ['waiting_permission', 'unreachable', 'cancel_unknown'].includes(task.health)) return;
          await this.clock.sleep(Math.min(100, budget), inner);
        }
      }, signal);
    } catch (error) { if (signal?.aborted) throw error; }
    return this.status(taskId, owner);
  }
  async tick(): Promise<void> {
    // Bounded concurrency avoids a failed child starving all others.
    const tasks = this.registry.all();
    for (let offset = 0; offset < tasks.length; offset += 4)
      await Promise.all(tasks.slice(offset, offset + 4).map(task => this.observe(task.taskId, task.parentSessionId)));
  }
  async settledDispatches(): Promise<void> { await Promise.all(this.dispatches.values()); }
}
