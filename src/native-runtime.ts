import { SessionTodos } from './todos.ts';
import { randomBytes } from 'node:crypto';
import { OpenCodeV2Api } from './opencode-v2-api.ts';
import { Supervisor } from './supervisor.ts';
import { clock } from './clock.ts';
import { processTools } from './process-tools.ts';
import { supportsProcessTracking } from './platform-capabilities.ts';
import { ViewProjection } from './view-projection.ts';
import { prepareNormalPlugin, startNormalPlugin } from './normal-plugin.ts';
import { pluginVersion } from './plugin-version.ts';
import { parseOpenCodeVersion } from './opencode-version.ts';

type Normal = Awaited<ReturnType<typeof prepareNormalPlugin>>;
const owners = new Map<string, Promise<Awaited<ReturnType<typeof createRuntime>>>>();

async function createRuntime(normal: Normal, directory: string, origin: string, authorization: string, version: string) {
  let disposed = false, work: Promise<void> | undefined;
  const api = new OpenCodeV2Api({ baseUrl: origin, directory, authorization, isCurrent: () => !disposed });
  const supervisor = new Supervisor(api, clock);
  const todos = await SessionTodos.create(normal.launch.privateDirectory);
  const tracked = supportsProcessTracking(process.platform) ? await processTools(supervisor, directory) : undefined;
  const view = new ViewProjection(supervisor.registry, clock, { pluginVersion, openCodeVersion: parseOpenCodeVersion(version),
    isolationId: normal.launch.binding.integrationId }, () => tracked?.executions.all() ?? [], () => [], () => new Date(),
    parent => normal.identities.forParent(parent), randomBytes(32).toString('hex'));
  let bridge: Awaited<ReturnType<typeof startNormalPlugin>> | undefined;
  const timer = setInterval(() => {
    if (disposed || work) return;
    work = (async () => {
      bridge ??= await startNormalPlugin(normal, api, view, todos);
      await bridge.tick(); await tracked?.tick(); await supervisor.tick();
    })().catch(error => console.error(JSON.stringify({ source: 'OpenCodeTaskSupervisor', kind: 'v2-monitor-failure', error: String(error) })))
      .finally(() => { work = undefined; });
  }, 1000);
  timer.unref();
  return { api, supervisor, tracked, todos, view, references: 0,
    async dispose() { disposed = true; clearInterval(timer); await work; await Promise.allSettled([bridge?.close(), tracked?.dispose()]); } };
}

/** One registry, process owner and bridge for an authenticated physical workspace.
 * Native location aliases still register their own tools, using this shared owner. */
export async function acquireNativeRuntime(normal: Normal, directory: string, origin: string, authorization: string, version: string) {
  const key = JSON.stringify([normal.launch.binding.serviceId, normal.launch.binding.workspace]);
  let pending = owners.get(key);
  if (!pending) {
    pending = createRuntime(normal, directory, origin, authorization, version);
    owners.set(key, pending);
    void pending.catch(() => { if (owners.get(key) === pending) owners.delete(key); });
  }
  const runtime = await pending;
  runtime.references++;
  let released = false;
  return { ...runtime, async release() {
    if (released) return; released = true;
    if (--runtime.references === 0) {
      if (owners.get(key) === pending) owners.delete(key);
      await runtime.dispose();
    }
  } };
}
