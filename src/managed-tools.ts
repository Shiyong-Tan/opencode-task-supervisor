import { tool } from '@opencode-ai/plugin';
import { isAbsolute, relative, resolve } from 'node:path';
import { open, realpath } from 'node:fs/promises';
import { JobClient } from './job-client.ts';
import { Executions } from './executions.ts';
import type { Supervisor } from './supervisor.ts';
import type { Notifications } from './notifications.ts';

export interface ManagedLabOptions {
  enabled: true; helper: string; workspace: string;
  suspectMs?: number;
  profiles: Record<string, { executable: string; args: string[]; cwd: string; artifactPaths: string[] }>;
}
export async function managedTools(supervisor: Supervisor, notifications: Notifications | undefined, options: ManagedLabOptions,
  audit: (event: Record<string, unknown>) => Promise<void>) {
  if (options.enabled !== true || !isAbsolute(options.helper) || !isAbsolute(options.workspace)) throw new Error('Explicit isolated managed laboratory configuration required');
  const workspace = await realpath(options.workspace);
  const suspectMs = options.suspectMs ?? 300_000;
  if (!Number.isFinite(suspectMs) || suspectMs <= 0) throw new Error('suspectMs must be positive and finite');
  const within = (path: string) => { const rel = relative(workspace, path); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };
  const profiles = structuredClone(options.profiles);
  for (const profile of Object.values(profiles)) {
    if (!isAbsolute(profile.executable) || !Array.isArray(profile.args) || profile.args.some(a => typeof a !== 'string')) throw new Error('Invalid laboratory command profile');
    profile.cwd = await realpath(profile.cwd);
    if (!within(profile.cwd) || profile.artifactPaths.some(p => !isAbsolute(p) || !within(resolve(p)))) throw new Error('Laboratory path escapes workspace');
  }
  const executions = new Executions(supervisor.registry, supervisor.clock,
    id => new JobClient(options.helper, id, workspace), suspectMs);
  // before-hook identity is supplied by OpenCode, never by the model's arguments.
  const invocations = new WeakMap<object, { sessionId: string; callId: string }>();
  const profileOwners = new Map<string, string>(); // Lab-wide cap cannot be reset by a new taskId.
  const args = { executionId: tool.schema.string().min(1) };
  supervisor.processEvidence = id => {
    const e = executions.all().find(e => e.taskId === id.taskId && e.attemptId === id.attemptId && e.childSessionId === id.childSessionId);
    if (!e) return;
    const active = e.lastActivityAt > e.createdAt && supervisor.clock.now() - e.lastActivityAt < 5000;
    return { process: e.health === 'unknown' ? 'unknown' : active ? 'active' : 'inactive',
      processActivity: active && e.sample ? `${e.executionId}:${e.sample.cpu100ns}:${e.sample.readBytes}:${e.sample.writeBytes}:${e.sample.stdout.totalBytes}:${e.sample.stderr.totalBytes}` : undefined,
      pending: !['stopped', 'permission_denied'].includes(e.phase), permission: e.phase === 'waiting_permission' };
  };
  return {
    executions,
    before(input: { tool: string; sessionID: string; callID: string }, output: { args: unknown }) {
      if (input.tool === 'managed_start' && output.args && typeof output.args === 'object')
        invocations.set(output.args, { sessionId: input.sessionID, callId: input.callID });
    },
    async tick() {
      await Promise.all(executions.all().map(async e => {
        if (!supervisor.registry.current(e)) return;
        const view = await executions.observe(e.executionId, e.parentSessionId);
        if (view.cancelRequested) notifications?.enqueueCancellation(view);
      }));
    },
    dispose: () => executions.dispose(),
    tools: {
      managed_start: tool({
        description: 'ISOLATED LAB ONLY: launch one allowlisted finite command for your registered child task. Requires command permission; returns promptly. Never accepts arbitrary commands or PID.',
        args: { profile: tool.schema.string() },
        async execute(args, ctx) {
          const invocation = invocations.get(args); invocations.delete(args);
          if (!invocation || invocation.sessionId !== ctx.sessionID || !invocation.callId) throw new Error('Missing trusted OpenCode tool-call identity');
          const profile = Object.hasOwn(profiles, args.profile) ? profiles[args.profile] : undefined;
          if (!profile) throw new Error('Command profile not in isolated allowlist');
          const logicalOwner = `${ctx.sessionID}:${invocation.callId}`;
          if (profileOwners.has(args.profile) && profileOwners.get(args.profile) !== logicalOwner)
            throw new Error('Laboratory profile already consumed; new taskId cannot authorize recovery');
          profileOwners.set(args.profile, logicalOwner);
          const value = await executions.start(ctx.sessionID, invocation.callId, profile, () => ctx.ask({
            permission: 'bash', patterns: [`supervisor-lab:${args.profile}`], always: [],
            metadata: { laboratory: true, profile: args.profile, scope: 'finite allowlisted command only' },
          }), ctx.abort);
          await audit({ type: 'execution_start', ...value, callerMessageId: ctx.messageID });
          return JSON.stringify(value);
        },
      }),
      managed_status: tool({ description: 'Read owned managed execution status. No activity or root exit alone does not prove all processes stopped.', args,
        async execute(args, ctx) { return JSON.stringify(executions.status(args.executionId, ctx.sessionID)); } }),
      managed_output: tool({ description: 'Read bounded stdout/stderr tails of an owned execution; truncated flags and total byte counts are included.', args,
        async execute(args, ctx) { const v = executions.status(args.executionId, ctx.sessionID); return JSON.stringify({ executionId: v.executionId, stdout: v.sample?.stdout ?? null, stderr: v.sample?.stderr ?? null }); } }),
      managed_cancel: tool({ description: 'ISOLATED LAB ONLY: explicitly request cancellation of your owned Job. Inspect later evidence; request acceptance is not proof of stop.', args,
        async execute(args, ctx) { const value = await executions.cancel(args.executionId, ctx.sessionID); notifications?.enqueueCancellation(value);
          await audit({ type: 'execution_cancel', ...value, callerMessageId: ctx.messageID }); return JSON.stringify(value); } }),
      managed_result: tool({ description: 'Read managed cancellation and stop evidence. This is not permission to retry; inspect artifacts next.',
        args: { ...args, notificationId: tool.schema.string() },
        async execute(args, ctx) { const value = executions.status(args.executionId, ctx.sessionID);
          if (ctx.sessionID !== value.parentSessionId) throw new Error('Cancellation result consumption belongs to parent');
          if (value.phase === 'stopped' && !value.cancelOutcomeUnknown) notifications?.readResult(value.taskId, ctx.sessionID, ctx.messageID, args.notificationId);
          await audit({ type: 'execution_result_read', executionId: value.executionId, taskId: value.taskId, attemptId: value.attemptId,
            parentSessionId: ctx.sessionID, childSessionId: value.childSessionId, callerMessageId: ctx.messageID, notificationId: args.notificationId });
          return JSON.stringify(value); } }),
      managed_artifact: tool({ description: 'Read at most 16KiB of the predefined test artifact after inspecting execution result. Does not roll back effects or retry.',
        args: { ...args, index: tool.schema.number().int().min(0).default(0) },
        async execute(args, ctx) { const e = executions.status(args.executionId, ctx.sessionID);
          if (ctx.sessionID !== e.parentSessionId) throw new Error('Artifact inspection belongs to parent');
          // V1 validates plugin args but does not apply the schema's default transform.
          const path = e.artifactPaths[args.index ?? 0]; if (!path) throw new Error('Unknown predefined artifact');
          const canonical = await realpath(path); if (!within(canonical)) throw new Error('Artifact escapes laboratory workspace');
          const file = await open(canonical, 'r');
          try { const stat = await file.stat(); if (!stat.isFile()) throw new Error('Artifact must be a regular file');
            const buffer = Buffer.alloc(16384), { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
            const result = { executionId: e.executionId, path, text: buffer.subarray(0, bytesRead).toString('utf8'), truncated: stat.size > bytesRead };
            await audit({ type: 'execution_artifact_read', executionId: e.executionId, parentSessionId: ctx.sessionID, callerMessageId: ctx.messageID, path });
            return JSON.stringify(result);
          } finally { await file.close(); }
        } }),
    },
  };
}
