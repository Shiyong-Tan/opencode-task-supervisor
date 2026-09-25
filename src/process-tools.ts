import { tool } from '@opencode-ai/plugin';
import { realpath, access } from 'node:fs/promises';
import { isAbsolute, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobClient, type JobTransport } from './job-client.ts';
import { Executions } from './executions.ts';
import type { Supervisor } from './supervisor.ts';

export const processGuidance = `\n\nProcess tracking for this supervised task:
Use supervisor_run for long-running computation, builds and tests. Supply the absolute executable path, argument array and working directory; a shell script requires an explicit shell executable. Command permission is checked before launch.
The tool returns an executionId, NOT completion. Continue supervisor_process_wait on that SAME execution until it stops or needs review; read its bounded output and exit code. Never finalize merely because a command was started.
Simple reads may use ordinary tools; ordinary shell processes are not tracked. If tracking is unavailable, report it. Never relaunch an uncertain execution or silently fall back to another launch tool. Quiet/GPU/waiting processes are not proven dead. No automatic termination or retry.`;

/** Only this module installs normal-mode process evidence; laboratory mode stays separate. */
export async function processTools(supervisor: Supervisor, directory: string,
  factory?: (id: string) => JobTransport) {
  const workspace = await realpath(directory);
  const helper = fileURLToPath(new URL('../dist/native/JobHost.exe', import.meta.url));
  const executions = new Executions(supervisor.registry, supervisor.clock,
    factory ?? (id => new JobClient(helper, id, workspace, 5000, true)), 300_000, true);
  const invocations = new WeakMap<object, { sessionId: string; callId: string }>();
  const pending = (e: ReturnType<Executions['all']>[number]) =>
    e.phase !== 'stopped' && e.phase !== 'permission_denied' && (e.phase !== 'start_failed' || e.cancelOutcomeUnknown);
  supervisor.processEvidence = id => {
    const all = executions.all().filter(e => e.taskId === id.taskId && e.attemptId === id.attemptId && e.childSessionId === id.childSessionId);
    if (!all.length) return;
    const live = all.filter(pending);
    const active = live.filter(e => e.health !== 'unknown' && e.lastActivityAt > e.createdAt && supervisor.clock.now() - e.lastActivityAt < 5000);
    return { process: active.length ? 'active' : live.some(e => e.health === 'unknown') ? 'unknown' : 'inactive',
      processActivity: active.length ? active.map(e => `${e.executionId}:${e.sample?.cpu100ns}:${e.sample?.readBytes}:${e.sample?.writeBytes}:${e.sample?.stdout.totalBytes}:${e.sample?.stderr.totalBytes}`).join('|') : undefined,
      pending: live.length > 0, permission: live.some(e => e.phase === 'waiting_permission') };
  };
  const executionArgs = { executionId: tool.schema.string().min(1) };
  return {
    executions,
    before(input: { tool: string; sessionID: string; callID: string }, output: { args: unknown }) {
      if (input.tool === 'supervisor_run' && output.args && typeof output.args === 'object')
        invocations.set(output.args, { sessionId: input.sessionID, callId: input.callID });
    },
    async tick() {
      await Promise.all(executions.all().filter(e => supervisor.registry.current(e) && pending(e))
        .map(e => executions.observe(e.executionId, e.parentSessionId)));
    },
    dispose: () => executions.dispose(),
    tools: {
      supervisor_run: tool({
        description: 'Launch and register a process for your current supervised child task. Requires explicit command permission. Returns promptly, not completion; continue supervisor_process_wait with the returned executionId. Does not cancel, retry or attach to existing processes.',
        args: { executable: tool.schema.string().min(1).max(4096), args: tool.schema.array(tool.schema.string().max(16000)).max(128),
          cwd: tool.schema.string().min(1).max(4096) },
        async execute(args, ctx) {
          const invocation = invocations.get(args); invocations.delete(args);
          if (!invocation || invocation.sessionId !== ctx.sessionID || !invocation.callId) throw new Error('Missing trusted OpenCode tool-call identity');
          if (!factory && process.platform !== 'win32') throw new Error('Process tracking currently requires Windows');
          if (!isAbsolute(args.executable) || !isAbsolute(args.cwd) || [...args.args, args.cwd, args.executable].some(v => v.includes('\0')))
            throw new Error('Absolute executable/cwd and NUL-free arguments required');
          if (JSON.stringify(args).length > 24000) throw new Error('Command exceeds tracking request bound');
          const executable = await realpath(args.executable), cwd = await realpath(args.cwd);
          if (extname(executable).toLowerCase() !== '.exe') throw new Error('Use an explicit .exe interpreter for scripts');
          if (!factory) await access(helper);
          const value = await executions.start(ctx.sessionID, invocation.callId, { executable, args: [...args.args], cwd, artifactPaths: [] }, async () => {
            const rel = relative(workspace, cwd);
            if (isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../'))
              await ctx.ask({ permission: 'external_directory', patterns: [cwd], always: [], metadata: { cwd } });
            // A dedicated exact-command permission avoids pretending to implement the native shell parser.
            await ctx.ask({ permission: 'supervisor_run', patterns: [JSON.stringify({ executable, args: args.args, cwd })], always: [],
              metadata: { executable, args: args.args, cwd, scope: 'Launch this command and observe its local process tree; no termination or retry' } });
          }, ctx.abort);
          return JSON.stringify(value);
        },
      }),
      supervisor_process_status: tool({
        description: 'Read tracked process evidence and bounded output for your tasks. Omit executionId to list owned executions. Unknown/quiet does not mean dead; root exit does not mean descendants stopped.',
        args: { executionId: tool.schema.string().min(1).optional() },
        async execute(args, ctx) {
          if (args.executionId) return JSON.stringify(executions.status(args.executionId, ctx.sessionID));
          return JSON.stringify(executions.all().filter(e => supervisor.registry.current(e) && [e.parentSessionId, e.childSessionId].includes(ctx.sessionID))
            .map(e => ({ executionId: e.executionId, taskId: e.taskId, attemptId: e.attemptId, displayName: e.displayName,
              phase: e.phase, health: e.health, reason: e.reason, rootPid: e.sample?.rootPid,
              activeProcesses: e.sample?.activeProcesses, exitCode: e.sample?.exitCode,
              ownedProcessesStopped: e.sample?.ownedProcessesStopped, lastActivityAt: e.lastActivityAt })));
        },
      }),
      supervisor_process_wait: tool({
        description: 'Wait on the SAME tracked execution, then inspect status, output and exit code. Continue waiting if still running; do not finalize on a checkpoint. Abort only stops waiting, never the process.',
        args: { ...executionArgs, waitMs: tool.schema.number().int().min(1000).max(60000).default(30000) },
        async execute(args, ctx) {
          const waitMs = args.waitMs ?? 30000;
          if (!Number.isFinite(waitMs) || waitMs < 1000 || waitMs > 60000) throw new Error('Invalid wait duration');
          const deadline = supervisor.clock.now() + waitMs;
          let value = executions.status(args.executionId, ctx.sessionID);
          while (pending(value) && value.health === 'running' && supervisor.clock.now() < deadline) {
            await supervisor.clock.sleep(Math.min(1000, deadline - supervisor.clock.now()), ctx.abort);
            value = await executions.observe(args.executionId, ctx.sessionID);
          }
          return JSON.stringify(value);
        },
      }),
    },
  };
}
