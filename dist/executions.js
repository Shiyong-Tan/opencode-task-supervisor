import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { bounded } from "./clock.js";
import { reviewPlan, reviewDelay, reviewText, usefulActivity } from "./process-review.js";
export class Executions {
    registry;
    clock;
    factory;
    suspectMs;
    multiple;
    entries = new Map();
    disposed = false;
    constructor(registry, clock, factory, suspectMs = 300_000, multiple = false) {
        this.registry = registry;
        this.clock = clock;
        this.factory = factory;
        this.suspectMs = suspectMs;
        this.multiple = multiple;
    }
    current(entry) { return !this.disposed && !!this.registry.current(entry.view); }
    owned(id, session) {
        const entry = this.entries.get(id);
        if (!entry || ![entry.view.parentSessionId, entry.view.childSessionId].includes(session) || !this.current(entry))
            throw new Error('Execution not owned by the current task/attempt/session');
        return entry;
    }
    copy(entry) { return structuredClone(entry.view); }
    all() { return [...this.entries.values()].map(e => this.copy(e)); }
    status(id, session) { return this.copy(this.owned(id, session)); }
    async start(childSessionId, toolCallId, command, permission, abort) {
        if (this.disposed || !toolCallId)
            throw new Error('Execution owner unavailable');
        const tasks = this.registry.all().filter(t => t.childSessionId === childSessionId && t.phase !== 'terminal');
        if (tasks.length !== 1)
            throw new Error('Only a currently registered child may launch a managed command');
        const task = tasks[0];
        if (task.cancellation !== 'none')
            throw new Error('Cancelled or uncertain task cannot launch a new command');
        const duplicate = [...this.entries.values()].find(e => e.view.childSessionId === childSessionId && e.view.toolCallId === toolCallId);
        if (duplicate)
            return this.copy(duplicate);
        if (!this.multiple && [...this.entries.values()].some(e => e.view.taskId === task.taskId))
            throw new Error('One execution per logical task; recovery is not enabled');
        const plan = command.reviewPlan === undefined ? undefined : reviewPlan(command.reviewPlan, this.clock.now());
        const view = { review: plan, taskId: task.taskId, attemptId: task.attemptId, parentSessionId: task.parentSessionId,
            childSessionId, executionId: randomUUID(), toolCallId, phase: 'waiting_permission', health: 'waiting_permission',
            createdAt: this.clock.now(), lastActivityAt: this.clock.now(), artifactPaths: [...command.artifactPaths],
            displayName: basename(command.executable).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || 'Process',
            cancelRequested: false, cancelOutcomeUnknown: false, safeToRetry: false };
        const entry = { view, generation: 0 };
        this.entries.set(view.executionId, entry);
        try {
            await bounded(this.clock, 30_000, () => permission(), abort);
        }
        catch {
            view.phase = 'permission_denied';
            view.health = 'unknown';
            view.reason = 'Permission denied, aborted, or timed out; no process started';
            return this.copy(entry);
        }
        if (!this.current(entry) || task.phase === 'terminal' || task.cancellation !== 'none' || abort?.aborted) {
            view.phase = 'start_failed';
            view.health = 'unknown';
            view.reason = 'Task no longer permits launch; no process started';
            return this.copy(entry);
        }
        view.phase = 'starting';
        view.health = 'unknown';
        view.startedAt = this.clock.now();
        if (view.review && command.reviewPlan)
            view.review = reviewPlan(command.reviewPlan, view.startedAt);
        try {
            entry.transport = this.factory(view.executionId);
            const { reviewPlan: _plan, ...launch } = command;
            const sample = await bounded(this.clock, 5000, () => entry.transport.call('start', launch), abort);
            if (!this.current(entry)) {
                await entry.transport.close();
                return this.copy(entry);
            }
            this.apply(entry, sample);
            if (entry.view.phase === 'stopped')
                await entry.transport.close();
        }
        catch {
            view.phase = 'start_failed';
            view.health = 'unknown';
            view.cancelOutcomeUnknown = true;
            view.reason = 'Start/identity registration failed; helper closed, independent stop evidence unavailable';
            await entry.transport?.close();
        }
        return this.copy(entry);
    }
    apply(entry, sample) {
        const v = entry.view, previous = v.sample;
        if (!this.current(entry) || v.phase === 'stopped')
            return;
        if (sample.executionId !== v.executionId || !Number.isSafeInteger(sample.sequence) || sample.sequence <= 0 ||
            !Number.isSafeInteger(sample.rootPid) || sample.rootPid <= 0 || !/^\d+$/.test(sample.rootCreationFileTime) ||
            (previous && (sample.rootPid !== previous.rootPid || sample.rootCreationFileTime !== previous.rootCreationFileTime)))
            throw new Error('Untrusted process identity');
        if (previous && sample.sequence <= previous.sequence)
            return;
        for (const value of [sample.cpu100ns, sample.readBytes, sample.writeBytes])
            if (!/^\d+$/.test(value))
                throw new Error('Invalid counters');
        if (sample.ownedProcessesStopped && (!sample.rootExited || sample.activeProcesses !== 0))
            throw new Error('Contradictory stop evidence');
        const counters = ['cpu100ns', 'readBytes', 'writeBytes'];
        const deltas = counters.map(k => previous ? BigInt(sample[k]) - BigInt(previous[k]) : 0n);
        if (deltas.some(d => d < 0n))
            throw new Error('Regressed process accounting');
        const interval = v.lastObservedAt === undefined ? 0 : this.clock.now() - v.lastObservedAt;
        v.cpuPercent = previous && interval > 0 && !sample.coverageUnknown ? Number(deltas[0]) / (interval * 100) : undefined;
        v.cpuDelta100ns = deltas[0].toString();
        v.readDeltaBytes = deltas[1].toString();
        v.writeDeltaBytes = deltas[2].toString();
        if (!entry.progressBaseline)
            entry.progressBaseline = structuredClone(sample);
        if (!sample.coverageUnknown && usefulActivity(sample, entry.progressBaseline)) {
            v.lastActivityAt = this.clock.now();
            entry.progressBaseline = structuredClone(sample);
        }
        if (v.review)
            v.review.needed = this.clock.now() >= v.review.dueAt;
        v.sample = structuredClone(sample);
        v.lastObservedAt = this.clock.now();
        v.cancelOutcomeUnknown = v.cancelRequested && (!sample.ownedProcessesStopped || sample.coverageUnknown);
        if (sample.ownedProcessesStopped && !sample.coverageUnknown) {
            v.phase = 'stopped';
            v.health = 'stopped';
            v.reason = undefined;
            v.finishedAt = this.clock.now();
        }
        else if (sample.coverageUnknown) {
            v.phase = 'running';
            v.health = 'unknown';
            v.reason = 'Job member observation incomplete';
        }
        else {
            v.phase = 'running';
            v.health = v.review?.needed || (this.clock.now() - v.lastActivityAt >= this.suspectMs && this.clock.now() >= (entry.quietReviewedUntil ?? 0)) ? 'suspect' : 'running';
            v.reason = v.review?.needed ? 'Scheduled process review due. Inspect expected progress now; justify a bounded extension or decide recovery. Do not blindly wait again.' :
                v.health === 'suspect' ? 'No useful CPU/write/output activity; read probes and tiny polling CPU do not establish progress. Inspect waiting/input/locks; no automatic cancellation.' : undefined;
        }
    }
    async extendReview(id, session, afterMs, reason) {
        const delay = reviewDelay(afterMs), decision = reviewText(reason);
        await this.observe(id, session);
        const entry = this.owned(id, session), v = entry.view;
        if (v.phase !== 'running' || v.health === 'unknown' || v.cancelRequested)
            throw new Error('Cannot extend an uncertain, cancelled or stopped execution');
        if (!v.review)
            throw new Error('Execution has no review plan');
        v.review.dueAt = this.clock.now() + delay;
        v.review.count++;
        v.review.lastDecision = decision;
        v.review.needed = false;
        // A bounded reviewed wait does not change the actual last activity timestamp.
        entry.quietReviewedUntil = v.review.dueAt;
        v.health = 'running';
        v.reason = 'Bounded wait explicitly reviewed; see review.lastDecision';
        return this.copy(entry);
    }
    unknown(entry, reason) {
        if (!this.current(entry) || entry.view.phase === 'stopped')
            return;
        entry.view.health = 'unknown';
        entry.view.reason = reason;
        entry.view.cancelOutcomeUnknown = entry.view.cancelRequested;
    }
    async observe(id, session) {
        const entry = this.owned(id, session);
        if (!entry.transport || entry.view.phase === 'stopped')
            return this.copy(entry);
        if (entry.poll)
            return entry.poll;
        const generation = entry.generation;
        entry.poll = (async () => {
            try {
                const sample = await bounded(this.clock, 5000, () => entry.transport.call('sample'));
                if (generation === entry.generation) {
                    this.apply(entry, sample);
                    if (entry.view.phase === 'stopped')
                        await entry.transport.close();
                }
            }
            catch {
                if (generation === entry.generation)
                    this.unknown(entry, 'Query failed or process identity mismatch; no stop proof');
            }
            return this.copy(entry);
        })().finally(() => { entry.poll = undefined; });
        return entry.poll;
    }
    async cancel(id, session) {
        const entry = this.owned(id, session), v = entry.view;
        if (!entry.transport || v.phase === 'stopped')
            return this.copy(entry);
        if (entry.cancel)
            return entry.cancel;
        if (v.cancelRequested)
            return this.observe(id, session); // Never resend an ambiguous cancel.
        v.cancelRequested = true;
        v.cancelOutcomeUnknown = true;
        entry.generation++;
        entry.cancel = (async () => {
            try {
                const sample = await bounded(this.clock, 5000, () => entry.transport.call('cancel'));
                this.apply(entry, sample);
            }
            catch {
                this.unknown(entry, 'Cancel failed/timed out; request acceptance and stop outcome unknown');
            }
            return this.copy(entry);
        })().finally(() => { entry.cancel = undefined; });
        return entry.cancel;
    }
    async dispose() {
        this.disposed = true;
        for (const entry of this.entries.values())
            if (entry.view.phase !== 'stopped' && entry.transport) {
                entry.view.health = 'unknown';
                entry.view.cancelOutcomeUnknown = true;
                entry.view.reason = 'Owner disposed; process observation unavailable; no post-close stop evidence';
            }
        await Promise.allSettled([...this.entries.values()].map(e => e.transport?.close()));
    }
}
