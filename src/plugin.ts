import { supportsProcessTracking, untrackedProcessGuidance } from './platform-capabilities.ts';
import { tool } from '@opencode-ai/plugin';
import type { Plugin } from '@opencode-ai/plugin';
import { clock, bounded } from './clock.ts';
import { OpenCodeApi } from './opencode-api.ts';
import { prepareAgentDispatch } from './agent-dispatch.ts';
import { Supervisor } from './supervisor.ts';
import { Notifications, noticeReport } from './notifications.ts';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { managedTools, type ManagedLabOptions } from './managed-tools.ts';
import { processTools, processGuidance } from './process-tools.ts';
import { prepareReadonlyLab, startReadonlyLab } from './readonly-lab.ts';
import { ViewProjection } from './view-projection.ts';
import { prepareNormalPlugin, startNormalPlugin } from './normal-plugin.ts';

const plugin: Plugin = async ({ serverUrl, directory }, options) => {
  const headers: Record<string, string> = {};
  if (process.env.OPENCODE_SERVER_PASSWORD) headers.authorization = `Basic ${Buffer.from(
    `${process.env.OPENCODE_SERVER_USERNAME ?? 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`,
  ).toString('base64')}`;
  const model = options?.model as { providerID: string; modelID: string } | undefined;
  if (model && (typeof model.providerID !== 'string' || typeof model.modelID !== 'string')) throw new Error('Invalid model option');
  const api = new OpenCodeApi({ baseUrl: serverUrl.toString(), directory, headers, model });
  const supervisor = new Supervisor(api, clock);
  if (options?.normalGui && (options.readonlyLab || options.managedLab)) throw new Error('Normal GUI cannot enable laboratory capabilities');
  const normal = options?.normalGui && process.env.OPENCODE_GUI_SUPERVISOR_BINDING ? await prepareNormalPlugin(options.normalGui, directory, serverUrl.origin,
    headers.authorization ?? '', process.env) : undefined;
  const readonlyLab = options?.readonlyLab ? await prepareReadonlyLab(options.readonlyLab, directory, process.env) : undefined;
  const identityOwner = normal?.identities ?? readonlyLab?.identities;
  const scopeId = normal?.launch.binding.integrationId ?? readonlyLab?.isolationId;
  let view: ViewProjection | undefined;
  const allowDispatch = options?.allowDispatch === true;
  const notifications = options?.allowNotifications === true ? new Notifications(supervisor, 30_000, 250,
    identityOwner ? async notice => {
      if (!view || !notice.childSessionId) throw new Error('Notification owner unavailable');
      await identityOwner.record({ schemaVersion: 1, isolationId: scopeId!, instanceId: view.instanceId,
        taskId: notice.taskId, attemptId: notice.attemptId, parentSessionId: notice.parentSessionId,
        childSessionId: notice.childSessionId, eventId: notice.eventId, notificationId: notice.notificationId, messageId: notice.messageId });
    } : undefined) : undefined;
  const audit = async (event: Record<string, unknown>) => {
    if (options?.recordEvidence === true)
      await appendFile(join(directory, '.supervisor-events.jsonl'), JSON.stringify({ at: Date.now(), ...event }) + '\n');
  };
  const managed = options?.managedLab ? await managedTools(supervisor, notifications, options.managedLab as ManagedLabOptions, audit) : undefined;
  const tracked = !managed && !readonlyLab && supportsProcessTracking(process.platform) ? await processTools(supervisor, directory) : undefined;
  const openCodeVersion = scopeId ? await api.verifyVersion(AbortSignal.timeout(5000)) : undefined;
  view = scopeId && openCodeVersion ? new ViewProjection(supervisor.registry, clock,
    { pluginVersion: '0.1.2', openCodeVersion, isolationId: scopeId },
    () => managed?.executions.all() ?? tracked?.executions.all() ?? [], () => notifications?.all() ?? [], () => new Date(),
    parent => identityOwner!.forParent(parent), normal ? randomBytes(32).toString('hex') : undefined) : undefined;
  const readonlyRuntime = readonlyLab && view ? await startReadonlyLab(readonlyLab, api, view) : undefined;
  const normalRuntime = normal && view ? await startNormalPlugin(normal, api, view) : undefined;
  let disposed = false, ticking = false;
  const reported = new Map<string, string>();
  const timer = setInterval(() => {
    if (disposed || ticking) return;
    ticking = true;
    void (async () => {
      await normalRuntime?.tick();
      await managed?.tick();
      await tracked?.tick();
      await supervisor.tick();
      await notifications?.tick();
      for (const notice of notifications?.all() ?? []) {
        const view = noticeReport(notice), signature = JSON.stringify(view);
        if (reported.get(notice.notificationId) !== signature) {
          reported.set(notice.notificationId, signature);
          await audit({ type: 'notification', ...view });
          if (notice.escalated) console.error(JSON.stringify({ source: 'OpenCodeTaskSupervisor', ...view }));
        }
      }
      for (const task of supervisor.registry.all()) {
        const signature = `${task.health}:${task.reason ?? ''}`;
        if (reported.get(task.taskId) === signature) continue;
        reported.set(task.taskId, signature);
        if (['suspected_stall', 'unreachable', 'cancel_unknown'].includes(task.health)) {
          console.error(JSON.stringify({ source: 'OpenCodeTaskSupervisor', escalation: 'user_review_required',
            taskId: task.taskId, attemptId: task.attemptId, parentSessionId: task.parentSessionId,
            childSessionId: task.childSessionId, health: task.health, reason: task.reason,
            action: 'Inspect results and old execution. If parent/service is unresponsive, use an external operator; this plugin cannot recover a blocked service.' }));
        }
      }
    })().catch(error => {
      console.error(JSON.stringify({ source: 'OpenCodeTaskSupervisor', escalation: 'monitor_failed', error: String(error) }));
    }).finally(() => { ticking = false; });
  }, 1000);
  timer.unref();
  const taskArgs = { taskId: tool.schema.string().min(1) };
  return {
    dispose: async () => { disposed = true; clearInterval(timer);
      try { await readonlyRuntime?.close(); await normalRuntime?.close(); } finally { await managed?.dispose(); await tracked?.dispose(); } },
    'tool.execute.before': async (input, output) => { managed?.before(input, output); tracked?.before(input, output); },
    event: async ({ event }) => {
      if (event.type !== 'session.error' || !event.properties.sessionID) return;
      const sessionId = event.properties.sessionID;
      const name = event.properties.error?.name ?? 'SessionError';
      const eventId = createHash('sha256').update(`${sessionId}:${name}`).digest('hex');
      supervisor.recordSessionError(sessionId, eventId, name);
      await audit({ type: 'session_error', childSessionId: sessionId, sourceEventId: eventId, error: name });
    },
    tool: {
      ...managed?.tools,
      ...tracked?.tools,
      supervisor_register: tool({
        description: 'Register a task owned by this parent session. Does not start a model.', args: {},
        async execute(_, ctx) {
          const value = supervisor.register(ctx.sessionID);
          await audit({ type: 'registered', ...value, callerMessageId: ctx.messageID });
          return JSON.stringify(value);
        },
      }),
      supervisor_dispatch: tool({
        description: 'Dispatch a new child and keep this tool running until completion, a monitoring checkpoint, or a new health alert. Supply agent for a configured role. At a checkpoint continue the same task with supervisor_wait; do not end the parent turn merely to wait. No completion wake-up prompt is sent. Requires allowDispatch; may incur model fees.',
        args: { ...taskArgs, prompt: tool.schema.string().min(1).max(32000),
          description: tool.schema.string().min(1).max(500).optional().describe('Short human-readable task name, e.g. Check remaining reconstruction processes. Supply this for the GUI subagent title; do not use IDs or the full prompt.'),
          waitMs: tool.schema.number().min(1000).max(120000).default(60000),
          agent: tool.schema.string().min(1).max(180).optional().describe('Exact configured subagent name. Omit only for legacy generic dispatch.') },
        async execute(args, ctx) {
          const start = performance.now();
          if (!allowDispatch) throw new Error('Dispatch disabled: enable allowDispatch only after authorizing model execution');
          const existing = supervisor.status(args.taskId, ctx.sessionID);
          if (existing.phase !== 'registered') {
            if (existing.agent !== args.agent) throw new Error('Task agent cannot change after dispatch');
            return JSON.stringify(await supervisor.waitForDecision(args.taskId, ctx.sessionID, args.waitMs, ctx.abort));
          }
          await bounded(clock, 5000, signal => api.verifyCompatibility(signal), ctx.abort);
          const selection = args.agent === undefined ? undefined : await bounded(clock, 5000,
            signal => prepareAgentDispatch(api, ctx.sessionID, ctx.messageID, ctx.agent, args.agent!, signal), ctx.abort);
          if (selection) await ctx.ask({ permission: 'task', patterns: [selection.agent], always: ['*'],
            metadata: { subagent_type: selection.agent, supervisorTaskId: args.taskId } });
          if (ctx.abort.aborted) throw new Error('Dispatch aborted before child creation');
          const value = supervisor.dispatch(args.taskId, ctx.sessionID, args.prompt + (tracked ? processGuidance : !managed && !readonlyLab ? untrackedProcessGuidance : ''), selection, 'inline', args.description);
          ctx.metadata({ title: value.title, metadata: { taskId: value.taskId, agent: value.agent } });
          await audit({ type: 'dispatch_started', ...value, callerMessageId: ctx.messageID, elapsedMs: performance.now() - start });
          return JSON.stringify(await supervisor.waitForDecision(args.taskId, ctx.sessionID, args.waitMs, ctx.abort));
        },
      }),
      supervisor_status: tool({
        description: 'Read cached owned task status. Unknown process state is not proof of a hang.', args: taskArgs,
        async execute(args, ctx) { return JSON.stringify(supervisor.status(args.taskId, ctx.sessionID)); },
      }),
      supervisor_result: tool({
        description: 'Read the final result of your owned child task. On a completion notification, supply its notificationId, then use the result for your requested next step. Does not start a model or retry work.',
        args: { ...taskArgs, notificationId: tool.schema.string().optional() },
        async execute(args, ctx) {
          const value = supervisor.result(args.taskId, ctx.sessionID);
          if (value.result) notifications?.readResult(args.taskId, ctx.sessionID, ctx.messageID, args.notificationId);
          await audit({ type: 'result_read', taskId: args.taskId, attemptId: value.attemptId,
            parentSessionId: ctx.sessionID, childSessionId: value.childSessionId, callerMessageId: ctx.messageID,
            notificationId: args.notificationId, resultMessageId: value.result?.messageId });
          return JSON.stringify(value);
        },
      }),
      supervisor_wait: tool({
        description: 'Keep waiting on the SAME task until completion, checkpoint or a new health alert. Polling is internal and does not invoke a model. Default 60000ms, maximum 120000ms. Inspect the returned evidence and continue work; do not finalize simply because work remains pending.',
        args: { ...taskArgs, waitMs: tool.schema.number().min(1000).max(120000).default(60000) },
        async execute(args, ctx) { return JSON.stringify(await supervisor.waitForDecision(args.taskId, ctx.sessionID, args.waitMs, ctx.abort)); },
      }),
      supervisor_cancel: tool({
        description: 'Explicitly request session abort for your own supervised child after inspecting a stall or other issue. Does not kill arbitrary processes or redispatch. HTTP acknowledgment does not prove tool-process termination; verify old execution stopped before any replacement.',
        args: taskArgs,
        async execute(args, ctx) {
          const value = await supervisor.cancel(args.taskId, ctx.sessionID, ctx.abort);
          await audit({ type: 'cancel_requested', ...value, result: undefined, callerMessageId: ctx.messageID });
          return JSON.stringify(value);
        },
      }),
    },
  };
};

export default plugin;
