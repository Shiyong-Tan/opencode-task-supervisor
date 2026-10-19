import { SessionTodos } from "./todos.js";
import { randomBytes } from 'node:crypto';
import { OpenCodeV2Api } from "./opencode-v2-api.js";
import { Supervisor } from "./supervisor.js";
import { clock } from "./clock.js";
import { processTools } from "./process-tools.js";
import { supportsProcessTracking } from "./platform-capabilities.js";
import { ViewProjection } from "./view-projection.js";
import { prepareNormalPlugin, startNormalPlugin } from "./normal-plugin.js";
import { pluginVersion } from "./plugin-version.js";
import { parseOpenCodeVersion } from "./opencode-version.js";
const owners = new Map();
async function createRuntime(normal, directory, origin, authorization, version) {
    let disposed = false, work;
    const api = new OpenCodeV2Api({ baseUrl: origin, directory, authorization, isCurrent: () => !disposed });
    const supervisor = new Supervisor(api, clock);
    const todos = await SessionTodos.create(normal.launch.privateDirectory);
    const tracked = supportsProcessTracking(process.platform) ? await processTools(supervisor, directory) : undefined;
    const view = new ViewProjection(supervisor.registry, clock, { pluginVersion, openCodeVersion: parseOpenCodeVersion(version),
        isolationId: normal.launch.binding.integrationId }, () => tracked?.executions.all() ?? [], () => [], () => new Date(), parent => normal.identities.forParent(parent), randomBytes(32).toString('hex'));
    let bridge;
    const timer = setInterval(() => {
        if (disposed || work)
            return;
        work = (async () => {
            bridge ??= await startNormalPlugin(normal, api, view, todos);
            await bridge.tick();
            await tracked?.tick();
            await supervisor.tick();
        })().catch(error => console.error(JSON.stringify({ source: 'OpenCodeTaskSupervisor', kind: 'v2-monitor-failure', error: String(error) })))
            .finally(() => { work = undefined; });
    }, 1000);
    timer.unref();
    return { api, supervisor, tracked, todos, view, references: 0,
        async dispose() { disposed = true; clearInterval(timer); await work; await Promise.allSettled([bridge?.close(), tracked?.dispose()]); } };
}
/** One registry, process owner and bridge for an authenticated physical workspace.
 * Native location aliases still register their own tools, using this shared owner. */
export async function acquireNativeRuntime(normal, directory, origin, authorization, version) {
    const key = JSON.stringify([normal.launch.binding.serviceId, normal.launch.binding.workspace]);
    let pending = owners.get(key);
    if (!pending) {
        pending = createRuntime(normal, directory, origin, authorization, version);
        owners.set(key, pending);
        void pending.catch(() => { if (owners.get(key) === pending)
            owners.delete(key); });
    }
    const runtime = await pending;
    runtime.references++;
    let released = false;
    return { ...runtime, async release() {
            if (released)
                return;
            released = true;
            if (--runtime.references === 0) {
                if (owners.get(key) === pending)
                    owners.delete(key);
                await runtime.dispose();
            }
        } };
}
