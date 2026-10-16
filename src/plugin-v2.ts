import { acquireNativeRuntime } from './native-runtime.ts';
import { tool, type ToolDefinition, type ToolContext } from '@opencode-ai/plugin/tool';
import { realpath } from 'node:fs/promises';
import { clock, bounded } from './clock.ts';
import { processTools, processGuidance } from './process-tools.ts';
import { supportsProcessTracking, untrackedProcessGuidance } from './platform-capabilities.ts';
import { prepareNormalPlugin } from './normal-plugin.ts';
import legacyPlugin from './plugin.ts';

interface Registration { dispose(): Promise<void> }
interface NativeToolContext { sessionID: string; messageID: string; id: string; agent: string; signal: AbortSignal; progress(value: Record<string, unknown>): Promise<void> }
interface NativeTool { name: string; description: string; input: unknown; options: { codemode: false };
  execute(input: unknown, context: NativeToolContext): Promise<{ content: string; metadata?: Record<string, unknown> }> }
interface NativeContext {
  app: { version: string }; location: { directory: string }; options: Record<string, unknown>;
  tool: { transform(callback: (editor: { add(tool: NativeTool): void }) => void): Promise<Registration> };
  event?: { subscribe(options: { signal: AbortSignal }): AsyncIterable<unknown> };
}
// OpenCode may dispose/recreate a location within the same service process.
// Keep the authenticated bootstrap private; never restore it to tool environments.
let serviceBootstrap: string | undefined;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native Supervisor input');
  return value as Record<string, unknown>;
};
const taskId = (value: Record<string, unknown>) => { if (typeof value.taskId !== 'string' || !value.taskId) throw new Error('Task ID required'); return value.taskId; };
const waitMs = (value: Record<string, unknown>) => { const ms = value.waitMs ?? 60000; if (typeof ms !== 'number' || ms < 1000 || ms > 120000) throw new Error('Invalid wait duration'); return ms; };

/** Native V2 plugin object. The old package's tool subpath is only its Zod schema helper;
 * no V1 loader, SDK client, event hook or permission context is used here. */
export default {
  id: 'opencode-task-supervisor',
  // Recent 1.x package loaders also select ./server, but call server(), not setup().
  server: legacyPlugin,
  async setup(context: NativeContext): Promise<() => Promise<void>> {
    const directory = await realpath(context.location.directory), options = context.options;
    if (options.readonlyLab || options.managedLab) throw new Error('V2 normal plugin cannot enable laboratory mode');
    const bootstrap = process.env.OPENCODE_GUI_SUPERVISOR_BINDING ?? serviceBootstrap;
    delete process.env.OPENCODE_GUI_SUPERVISOR_BINDING;
    if (!bootstrap || Buffer.byteLength(bootstrap) > 16384) throw new Error('Native Supervisor requires the GUI service launch binding');
    // This untrusted hint is used only with the ordinary server credentials; prepareNormalPlugin
    // authenticates all launch fields before any bridge is created.
    const origin = record(record(JSON.parse(bootstrap)).binding).serviceOrigin;
    if (typeof origin !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin)) throw new Error('Invalid native Supervisor service origin');
    const authorization = process.env.OPENCODE_SERVER_PASSWORD ? 'Basic ' + Buffer.from(
      `${process.env.OPENCODE_SERVER_USERNAME ?? 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64') : '';
    let disposed = false;
    const normal = await prepareNormalPlugin(options.normalGui, directory, origin, authorization,
      { ...process.env, OPENCODE_GUI_SUPERVISOR_BINDING: bootstrap });
    serviceBootstrap = bootstrap;
    const runtime = await acquireNativeRuntime(normal, directory, origin, authorization, context.app.version);
    const { api, supervisor, tracked } = runtime;
    const taskSchema = { taskId: { type: 'string', minLength: 1 } };
    const schema = (properties: Record<string, unknown>, required: string[] = ['taskId']) => ({ type: 'object', properties, required, additionalProperties: false });
    const definitions: NativeTool[] = [];
    const add = (name: string, description: string, input: unknown, execute: (input: Record<string, unknown>, ctx: NativeToolContext) => Promise<unknown>) =>
      definitions.push({ name, description, input, options: { codemode: false }, execute: async (value, ctx) => ({ content: JSON.stringify(await execute(record(value), ctx)) }) });
    add('supervisor_register', 'Register one parent-owned task. Does not start a model.', schema({}, []), async (_input, ctx) => supervisor.register(ctx.sessionID));
    add('supervisor_dispatch', 'Dispatch a configured role and keep waiting until completion, checkpoint or a health alert. Continue the SAME task with supervisor_wait; do not finalize merely to wait. Requires explicit dispatch authorization and may incur model fees.',
      schema({ ...taskSchema, prompt: { type: 'string', minLength: 1, maxLength: 32000 }, agent: { type: 'string', minLength: 1, maxLength: 180 },
        description: { type: 'string', minLength: 1, maxLength: 500 }, waitMs: { type: 'number', minimum: 1000, maximum: 120000 } }, ['taskId', 'prompt', 'agent']), async (input, ctx) => {
        if (options.allowDispatch !== true) throw new Error('Dispatch disabled');
        const id = taskId(input), existing = supervisor.status(id, ctx.sessionID);
        if (typeof input.agent !== 'string' || typeof input.prompt !== 'string') throw new Error('Configured role and prompt required');
        if (existing.phase === 'registered') {
          const selection = await bounded(clock, 5000, signal => api.prepare(ctx.sessionID, ctx.messageID, ctx.agent, input.agent as string, signal), ctx.signal);
          await api.ask(ctx, 'subagent', [selection.agent], { supervisorTaskId: id });
          ctx.signal.throwIfAborted();
          const task = supervisor.dispatch(id, ctx.sessionID, input.prompt + (tracked ? processGuidance : untrackedProcessGuidance), selection, 'inline',
            typeof input.description === 'string' ? input.description : undefined);
          await ctx.progress({ title: task.title, taskId: task.taskId, agent: task.agent });
        } else if (existing.agent !== input.agent) throw new Error('Task agent cannot change after dispatch');
        return supervisor.waitForDecision(id, ctx.sessionID, waitMs(input), ctx.signal);
      });
    add('supervisor_status', 'Refresh an owned task. Unknown process state is not proof of termination.', schema(taskSchema), async (input, ctx) => {
      await supervisor.observe(taskId(input), ctx.sessionID); return supervisor.status(taskId(input), ctx.sessionID);
    });
    add('supervisor_wait', 'Wait on the SAME task until completion, checkpoint or health alert. Internal polling does not invoke a model. Continue work after checkpoints.',
      schema({ ...taskSchema, waitMs: { type: 'number', minimum: 1000, maximum: 120000 } }), async (input, ctx) => supervisor.waitForDecision(taskId(input), ctx.sessionID, waitMs(input), ctx.signal));
    add('supervisor_result', 'Read the owned child result without redispatching.', schema(taskSchema), async (input, ctx) => supervisor.result(taskId(input), ctx.sessionID));
    add('supervisor_cancel', 'Request child interruption. Acknowledgement does not prove tool/process termination; verify stop evidence before replacement.', schema(taskSchema),
      async (input, ctx) => supervisor.cancel(taskId(input), ctx.sessionID, ctx.signal));
    for (const [name, definition] of Object.entries(tracked?.tools ?? {})) {
      const legacy = definition as ToolDefinition;
      definitions.push({ name, description: legacy.description, input: tool.schema.object(legacy.args), options: { codemode: false }, execute: async (input, ctx) => {
        const args = record(input);
        tracked!.before({ tool: name, sessionID: ctx.sessionID, callID: ctx.id }, { args });
        const legacyContext: ToolContext = { sessionID: ctx.sessionID, messageID: ctx.messageID, agent: ctx.agent, directory, worktree: directory, abort: ctx.signal,
          metadata: value => { void ctx.progress(value).catch(() => undefined); },
          ask: value => api.ask(ctx, value.permission, value.patterns, value.metadata) };
        const result = await legacy.execute(args, legacyContext);
        return typeof result === 'string' ? { content: result } : { content: result.output, metadata: result.metadata };
      } });
    }
    let registration: Registration;
    try { registration = await context.tool.transform(editor => { for (const definition of definitions) editor.add(definition); }); }
    catch (error) { await runtime.release(); throw error; }
    const stream = new AbortController();
    const activity = (async () => {
      if (!context.event) return;
      while (!disposed) {
        try {
          api.activityStreamAvailable(true);
          for await (const raw of context.event.subscribe({ signal: stream.signal })) {
            const event = record(raw), data = record(event.data);
            if (supervisor.registry.all().some(task => task.childSessionId === data.sessionID && task.phase !== 'terminal')) api.recordLive(event);
          }
        } catch { /* Fresh history still settles completed runs; a missing live stream is unknown progress. */ }
        if (disposed) return;
        api.activityStreamAvailable(false);
        await clock.sleep(1000, stream.signal).catch(() => undefined);
      }
    })();
    return async () => { disposed = true; stream.abort();
      await Promise.allSettled([activity, registration.dispose()]);
      await runtime.release();
    };
  },
};
