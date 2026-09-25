import type { OpenCodeVersion } from './opencode-version.ts';
import { randomUUID } from 'node:crypto';
import type { Registry } from './registry.ts';
import type { Execution } from './executions.ts';
import type { CompletionNotice } from './notifications.ts';
import type { Clock } from './types.ts';
import { parseSupervisorView, type SupervisorView } from './view-protocol.ts';
import type { NotificationIdentity } from './notification-identities.ts';

/** A read projection, never a second owner or an observer that changes task state. */
export class ViewProjection {
  readonly instanceId: string;
  private revision = 0;
  private fingerprint = '';
  constructor(private readonly registry: Registry, private readonly clock: Clock,
    private readonly versions: { pluginVersion: string; openCodeVersion: OpenCodeVersion; isolationId: string },
    private readonly executions: () => Execution[] = () => [],
    private readonly notifications: () => CompletionNotice[] = () => [],
    private readonly wallNow: () => Date = () => new Date(),
    private readonly identities: (parentSessionId: string) => NotificationIdentity[] = () => [],
    instanceId: string = randomUUID()) { this.instanceId = instanceId; }

  get openCodeVersion(): OpenCodeVersion { return this.versions.openCodeVersion; }

  snapshot(parentSessionId: string): SupervisorView {
    const now = this.clock.now();
    const age = (at: number | undefined) => at === undefined ? null : Math.max(0, now - at);
    const ownedTasks = this.registry.all();
    const ownedExecutions = this.executions().filter(e => this.registry.current(e));
    const ownedNotices = this.notifications().filter(n => this.registry.current(n));
    // Whitelist before fingerprinting, too: output, error text and artifact paths
    // must not be retained in this read cache. Wall-clock passage is not a revision.
    const project = (parent: string) => ({
      tasks: ownedTasks.filter(t => t.parentSessionId === parent).map(t => ({
        taskId: t.taskId, attemptId: t.attemptId, parentSessionId: parent, childSessionId: t.childSessionId ?? null,
        title: t.title ?? null, phase: t.phase, health: t.health, outcome: t.outcome ?? null,
        lastObservationAgeMs: age(t.lastCheckedAt), lastProgressAgeMs: age(t.lastProgressAt),
      })),
      executions: ownedExecutions.filter(e => e.parentSessionId === parent).map(e => ({
        taskId: e.taskId, attemptId: e.attemptId, parentSessionId: parent, childSessionId: e.childSessionId,
        executionId: e.executionId, toolCallId: e.toolCallId, phase: e.phase, health: e.health,
        lastObservationAgeMs: age(e.lastObservedAt), lastActivityAgeMs: age(e.lastActivityAt),
        displayName: e.displayName ?? null, rootPid: e.sample?.rootPid ?? null,
        activeProcesses: e.sample?.activeProcesses ?? null,
        durationMs: e.startedAt === undefined ? null : Math.max(0, (e.finishedAt ?? now) - e.startedAt),
        cpuPercent: e.health === 'running' ? e.cpuPercent ?? null : null,
        workingSetBytes: e.sample?.workingSetBytes ?? null, exitCode: e.sample?.exitCode ?? null,
        rootExited: e.sample?.rootExited ?? null,
        ownedProcessesStopped: e.sample && !e.sample.coverageUnknown && !e.cancelOutcomeUnknown ? e.sample.ownedProcessesStopped : null,
        cpu100ns: e.sample?.cpu100ns ?? null, cpuDelta100ns: e.cpuDelta100ns ?? null,
        readBytes: e.sample?.readBytes ?? null, writeBytes: e.sample?.writeBytes ?? null,
        readDeltaBytes: e.readDeltaBytes ?? null, writeDeltaBytes: e.writeDeltaBytes ?? null,
        cancelRequested: e.cancelRequested,
        requestAccepted: e.cancelRequested && e.sample?.requestAccepted ? true : null,
        cancelOutcomeUnknown: e.cancelOutcomeUnknown, coverageUnknown: e.sample?.coverageUnknown ?? true,
        safeToRetry: false as const,
      })),
      notifications: ownedNotices.filter(n => n.parentSessionId === parent).map(n => ({
        taskId: n.taskId, attemptId: n.attemptId, parentSessionId: parent, childSessionId: n.childSessionId,
        notificationId: n.notificationId, eventId: n.eventId, messageId: n.messageId || null,
        delivery: n.delivery, progress: n.progress, escalated: n.escalated !== undefined,
        queueAgeMs: Math.max(0, (n.submittedAt ?? now) - n.createdAt),
        activityWaitAgeMs: n.submittedAt === undefined ? null : Math.max(0, (n.activityObservedAt ?? now) - n.submittedAt),
      })),
      notificationIdentities: this.identities(parent),
    });
    const parents = [...new Set(ownedTasks.map(t => t.parentSessionId))].sort();
    const next = JSON.stringify({
      views: parents.map(parent => project(parent)),
      taskTimes: ownedTasks.map(t => [t.taskId, t.lastCheckedAt ?? null, t.lastProgressAt]),
      executionTimes: ownedExecutions.map(e => [e.executionId, e.lastObservedAt ?? null, e.lastActivityAt]),
      noticeTimes: ownedNotices.map(n => [n.notificationId, n.submittedAt ?? null, n.activityObservedAt ?? null]),
    }, (key, value: unknown) => key.endsWith('AgeMs') || key === 'durationMs' ? undefined : value);
    if (next !== this.fingerprint) { this.fingerprint = next; this.revision++; }
    return parseSupervisorView({
      schemaVersion: 1, instanceId: this.instanceId, revision: this.revision,
      ...this.versions, observedAt: this.wallNow().toISOString(),
      parentSessionId, scope: 'isolated_allowlisted_commands', ...project(parentSessionId),
    });
  }
}
