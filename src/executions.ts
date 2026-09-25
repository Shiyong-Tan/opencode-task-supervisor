import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Clock, Identity } from './types.ts';
import type { Registry } from './registry.ts';
import type { JobSample, JobTransport } from './job-client.ts';
import { bounded } from './clock.ts';

export interface ExecutionIdentity extends Identity { childSessionId: string; executionId: string; toolCallId: string }
export interface Execution extends ExecutionIdentity {
  displayName?: string; startedAt?: number; finishedAt?: number; cpuPercent?: number;
  phase: 'waiting_permission' | 'starting' | 'running' | 'stopped' | 'start_failed' | 'permission_denied';
  health: 'waiting_permission' | 'running' | 'suspect' | 'unknown' | 'stopped';
  createdAt: number; lastActivityAt: number; lastObservedAt?: number;
  sample?: JobSample; cpuDelta100ns?: string; readDeltaBytes?: string; writeDeltaBytes?: string;
  reason?: string; cancelRequested: boolean; cancelOutcomeUnknown: boolean;
  artifactPaths: string[]; safeToRetry: false;
}
type Entry = { view: Execution; transport?: JobTransport; poll?: Promise<Execution>; cancel?: Promise<Execution>; generation: number };
export class Executions {
  private readonly entries = new Map<string, Entry>();
  private disposed = false;
  constructor(private readonly registry: Registry, private readonly clock: Clock,
    private readonly factory: (executionId: string) => JobTransport, readonly suspectMs = 300_000,
    private readonly multiple = false) {}
  private current(entry: Entry) { return !this.disposed && !!this.registry.current(entry.view); }
  private owned(id: string, session: string) {
    const entry = this.entries.get(id);
    if (!entry || ![entry.view.parentSessionId, entry.view.childSessionId].includes(session) || !this.current(entry))
      throw new Error('Execution not owned by the current task/attempt/session');
    return entry;
  }
  private copy(entry: Entry): Execution { return structuredClone(entry.view); }
  all(): Execution[] { return [...this.entries.values()].map(e => this.copy(e)); }
  status(id: string, session: string): Execution { return this.copy(this.owned(id, session)); }
  async start(childSessionId: string, toolCallId: string, command: { executable: string; args: string[]; cwd: string; artifactPaths: string[] },
    permission: () => Promise<void>, abort?: AbortSignal): Promise<Execution> {
    if (this.disposed || !toolCallId) throw new Error('Execution owner unavailable');
    const tasks = this.registry.all().filter(t => t.childSessionId === childSessionId && t.phase !== 'terminal');
    if (tasks.length !== 1) throw new Error('Only a currently registered child may launch a managed command');
    const task = tasks[0]!;
    if (task.cancellation !== 'none') throw new Error('Cancelled or uncertain task cannot launch a new command');
    const duplicate = [...this.entries.values()].find(e => e.view.childSessionId === childSessionId && e.view.toolCallId === toolCallId);
    if (duplicate) return this.copy(duplicate);
    if (!this.multiple && [...this.entries.values()].some(e => e.view.taskId === task.taskId)) throw new Error('One execution per logical task; recovery is not enabled');
    if (this.entries.size >= 128) throw new Error('Execution capacity reached; no process started');
    const view: Execution = { taskId: task.taskId, attemptId: task.attemptId, parentSessionId: task.parentSessionId,
      childSessionId, executionId: randomUUID(), toolCallId, phase: 'waiting_permission', health: 'waiting_permission',
      createdAt: this.clock.now(), lastActivityAt: this.clock.now(), artifactPaths: [...command.artifactPaths],
      displayName: basename(command.executable).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || 'Process',
      cancelRequested: false, cancelOutcomeUnknown: false, safeToRetry: false };
    const entry: Entry = { view, generation: 0 }; this.entries.set(view.executionId, entry);
    try { await bounded(this.clock, 30_000, () => permission(), abort); }
    catch { view.phase = 'permission_denied'; view.health = 'unknown'; view.reason = 'Permission denied, aborted, or timed out; no process started'; return this.copy(entry); }
    if (!this.current(entry) || task.phase === 'terminal' || task.cancellation !== 'none' || abort?.aborted) {
      view.phase = 'start_failed'; view.health = 'unknown'; view.reason = 'Task no longer permits launch; no process started'; return this.copy(entry);
    }
    view.phase = 'starting'; view.health = 'unknown'; view.startedAt = this.clock.now();
    try {
      entry.transport = this.factory(view.executionId);
      const sample = await bounded(this.clock, 5000, () => entry.transport!.call('start', command), abort);
      if (!this.current(entry)) { await entry.transport.close(); return this.copy(entry); }
      this.apply(entry, sample);
      if (entry.view.phase === 'stopped') await entry.transport.close();
    } catch {
      view.phase = 'start_failed'; view.health = 'unknown'; view.cancelOutcomeUnknown = true;
      view.reason = 'Start/identity registration failed; helper closed, independent stop evidence unavailable';
      await entry.transport?.close();
    }
    return this.copy(entry);
  }
  private apply(entry: Entry, sample: JobSample) {
    const v = entry.view, previous = v.sample;
    if (!this.current(entry) || v.phase === 'stopped') return;
    if (sample.executionId !== v.executionId || !Number.isSafeInteger(sample.sequence) || sample.sequence <= 0 ||
      !Number.isSafeInteger(sample.rootPid) || sample.rootPid <= 0 || !/^\d+$/.test(sample.rootCreationFileTime) ||
      (previous && (sample.rootPid !== previous.rootPid || sample.rootCreationFileTime !== previous.rootCreationFileTime)))
      throw new Error('Untrusted process identity');
    if (previous && sample.sequence <= previous.sequence) return;
    for (const value of [sample.cpu100ns, sample.readBytes, sample.writeBytes]) if (!/^\d+$/.test(value)) throw new Error('Invalid counters');
    if (sample.ownedProcessesStopped && (!sample.rootExited || sample.activeProcesses !== 0)) throw new Error('Contradictory stop evidence');
    const counters = ['cpu100ns', 'readBytes', 'writeBytes'] as const;
    const deltas = counters.map(k => previous ? BigInt(sample[k]) - BigInt(previous[k]) : 0n);
    if (deltas.some(d => d < 0n)) throw new Error('Regressed process accounting');
    const interval = v.lastObservedAt === undefined ? 0 : this.clock.now() - v.lastObservedAt;
    v.cpuPercent = previous && interval > 0 && !sample.coverageUnknown ? Number(deltas[0]) / (interval * 100) : undefined;
    v.cpuDelta100ns = deltas[0]!.toString(); v.readDeltaBytes = deltas[1]!.toString(); v.writeDeltaBytes = deltas[2]!.toString();
    const outputActivity = previous && (sample.stdout.totalBytes > previous.stdout.totalBytes || sample.stderr.totalBytes > previous.stderr.totalBytes);
    if (!sample.coverageUnknown && (deltas.some(d => d > 0n) || outputActivity)) v.lastActivityAt = this.clock.now();
    v.sample = structuredClone(sample); v.lastObservedAt = this.clock.now();
    v.cancelOutcomeUnknown = v.cancelRequested && (!sample.ownedProcessesStopped || sample.coverageUnknown);
    if (sample.ownedProcessesStopped && !sample.coverageUnknown) { v.phase = 'stopped'; v.health = 'stopped'; v.reason = undefined; v.finishedAt = this.clock.now(); }
    else if (sample.coverageUnknown) { v.phase = 'running'; v.health = 'unknown'; v.reason = 'Job member observation incomplete'; }
    else { v.phase = 'running'; v.health = this.clock.now() - v.lastActivityAt >= this.suspectMs ? 'suspect' : 'running';
      v.reason = v.health === 'suspect' ? 'No new CPU/I/O/output activity; sleep/GPU/I/O wait may be valid. No automatic cancellation.' : undefined; }
  }
  private unknown(entry: Entry, reason: string) {
    if (!this.current(entry) || entry.view.phase === 'stopped') return;
    entry.view.health = 'unknown'; entry.view.reason = reason;
    entry.view.cancelOutcomeUnknown = entry.view.cancelRequested;
  }
  async observe(id: string, session: string): Promise<Execution> {
    const entry = this.owned(id, session);
    if (!entry.transport || entry.view.phase === 'stopped') return this.copy(entry);
    if (entry.poll) return entry.poll;
    const generation = entry.generation;
    entry.poll = (async () => {
      try { const sample = await bounded(this.clock, 5000, () => entry.transport!.call('sample'));
        if (generation === entry.generation) {
          this.apply(entry, sample);
          if (entry.view.phase === 'stopped') await entry.transport!.close();
        }
      } catch { if (generation === entry.generation) this.unknown(entry, 'Query failed or process identity mismatch; no stop proof'); }
      return this.copy(entry);
    })().finally(() => { entry.poll = undefined; });
    return entry.poll;
  }
  async cancel(id: string, session: string): Promise<Execution> {
    const entry = this.owned(id, session), v = entry.view;
    if (!entry.transport || v.phase === 'stopped') return this.copy(entry);
    if (entry.cancel) return entry.cancel;
    if (v.cancelRequested) return this.observe(id, session); // Never resend an ambiguous cancel.
    v.cancelRequested = true; v.cancelOutcomeUnknown = true; entry.generation++;
    entry.cancel = (async () => {
      try { const sample = await bounded(this.clock, 5000, () => entry.transport!.call('cancel')); this.apply(entry, sample); }
      catch { this.unknown(entry, 'Cancel failed/timed out; request acceptance and stop outcome unknown'); }
      return this.copy(entry);
    })().finally(() => { entry.cancel = undefined; });
    return entry.cancel;
  }
  async dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) if (entry.view.phase !== 'stopped' && entry.transport) {
      entry.view.health = 'unknown'; entry.view.cancelOutcomeUnknown = true;
      entry.view.reason = 'Owner disposed; process observation unavailable; no post-close stop evidence';
    }
    await Promise.allSettled([...this.entries.values()].map(e => e.transport?.close()));
  }
}
