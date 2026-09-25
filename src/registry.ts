import { randomUUID } from 'node:crypto';
import type { Clock, Identity, Snapshot, Task } from './types.ts';

export class Registry {
  private readonly tasks = new Map<string, Task>();
  private readonly children = new Set<string>();
  constructor(private readonly clock: Clock, readonly staleMs = 300_000) {}

  register(parentSessionId: string, taskId: string = randomUUID()): Task {
    if (!parentSessionId || this.tasks.has(taskId)) throw new Error('Invalid parent or duplicate canonical task');
    const task: Task = { taskId, attemptId: randomUUID(), parentSessionId, phase: 'registered',
      health: 'running', delivery: 'notification', createdAt: this.clock.now(), lastProgressAt: this.clock.now(),
      dispatch: 'not_sent', cancellation: 'none', process: 'unknown', seen: new Set() };
    this.tasks.set(taskId, task);
    return task;
  }
  get(taskId: string, owner: string): Task {
    const task = this.tasks.get(taskId);
    if (!task || task.parentSessionId !== owner) throw new Error('Task not owned by this parent');
    return task;
  }
  all(): Task[] { return [...this.tasks.values()]; }
  current(id: Identity): Task | undefined {
    const task = this.tasks.get(id.taskId);
    return task && task.attemptId === id.attemptId && task.parentSessionId === id.parentSessionId &&
      task.childSessionId === id.childSessionId ? task : undefined;
  }
  attach(task: Task, child: string): void {
    if (task.phase !== 'dispatching' || task.childSessionId || this.children.has(child) || child === task.parentSessionId)
      throw new Error('Child ownership conflict');
    task.childSessionId = child;
    this.children.add(child);
  }
  apply(id: Identity, snapshot: Snapshot): void {
    const task = this.current(id);
    if (!task || task.phase === 'terminal' || snapshot.sessionId !== task.childSessionId) return;
    task.lastCheckedAt = this.clock.now();
    task.permissions = snapshot.permissions ? structuredClone(snapshot.permissions) : undefined;
    task.permissionObservation = 'current';
    const evidence = [...snapshot.activity, ...(snapshot.processActivity ? [`process:${snapshot.processActivity}`] : [])];
    if (evidence.some(key => !task.seen.has(key))) task.lastProgressAt = this.clock.now();
    evidence.forEach(key => task.seen.add(key));
    task.process = snapshot.process;
    task.reason = undefined;
    // Completion requires final assistant evidence and idle, with no unresolved tools/permissions.
    if (snapshot.terminal && snapshot.status === 'idle' && !snapshot.pendingTools && !snapshot.permissionIds.length && task.cancellation === 'none') {
      task.phase = 'terminal'; task.health = 'ended'; task.outcome = snapshot.terminal;
      task.result = snapshot.result ? { ...snapshot.result } : undefined;
      return;
    }
    if (task.cancellation !== 'none') {
      task.health = 'cancel_unknown'; task.reason = 'Cancellation does not establish process-tree termination'; return;
    }
    if (snapshot.permissionIds.length) {
      task.health = 'waiting_permission';
      task.reason = snapshot.permissionIds.includes('managed-command-permission') ? 'Registered command is awaiting permission; inspect permission requests' :
        'OpenCode reports unresolved permission requests; inspect permissions for request ID, owning session, tool and scope';
      return;
    }
    if (snapshot.process === 'active') { task.health = 'running'; return; }
    if (this.clock.now() - task.lastProgressAt >= this.staleMs) {
      task.health = 'suspected_stall';
      task.reason = snapshot.pendingTools && snapshot.status === 'idle' ? 'Idle with unresolved tool records' :
        'No new observable activity; process liveness unknown or inactive; inspect before recovery';
    } else task.health = 'running';
  }
  queryFailed(id: Identity, reason: string): void {
    const task = this.current(id);
    if (!task || task.phase === 'terminal') return;
    task.lastCheckedAt = this.clock.now();
    task.permissionObservation = 'unavailable';
    task.health = task.cancellation === 'none' ? 'unreachable' : 'cancel_unknown';
    task.reason = reason;
  }
}

export function report(task: Task) {
  const { seen: _, result: __, monitorAlert: ___, ...view } = task;
  return { ...view, recovery: 'Parent must inspect results and verify old execution stopped; no automatic redispatch.' };
}
