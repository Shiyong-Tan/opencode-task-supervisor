import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { parseNormalLaunch } from "./normal-launch-protocol.js";
import { NotificationIdentities } from "./notification-identities.js";
import { normalIdentityCodec } from "./normal-identity-protocol.js";
import { startNormalBridge } from "./normal-bridge.js";
import { encodeNormalView } from "./normal-view-protocol.js";
export async function prepareNormalPlugin(option, directory, serviceOrigin, authorization, env) {
    if (!option || typeof option !== 'object' || option.enabled !== true) {
        throw new Error('Explicit normal GUI plugin configuration required');
    }
    const serialized = env.OPENCODE_GUI_SUPERVISOR_BINDING;
    // Consume before tools can inherit this private bootstrap. The GUI retains its
    // own copy in SecretStorage for reload; no model tools need this environment key.
    delete env.OPENCODE_GUI_SUPERVISOR_BINDING;
    if (!serialized)
        throw new Error('GUI-owned service launch binding unavailable');
    const launch = parseNormalLaunch(serialized, await realpath(directory), serviceOrigin, authorization);
    if (await realpath(launch.privateDirectory) !== launch.privateDirectory)
        throw new Error('Supervisor private directory redirects');
    const identityDirectory = join(launch.privateDirectory, 'identities');
    await mkdir(identityDirectory, { recursive: true });
    if (await realpath(identityDirectory) !== identityDirectory)
        throw new Error('Supervisor identity directory redirects');
    const identities = await NotificationIdentities.load(identityDirectory, launch.binding.integrationId, normalIdentityCodec(launch.binding.integrationId, launch.identityKey));
    return { launch, identities };
}
export async function startNormalPlugin(normal, api, view) {
    const openCodeVersion = await api.verifyVersion(AbortSignal.timeout(5000));
    if (view.openCodeVersion !== openCodeVersion)
        throw new Error('Supervisor projection version mismatch');
    const { launch } = normal;
    const bridge = await startNormalBridge({ binding: launch.binding, launchKey: launch.launchKey,
        instanceId: view.instanceId, openCodeVersion, directory: launch.privateDirectory,
        snapshot: async (parent, signal) => {
            if (signal.aborted)
                throw new Error('Aborted');
            // Probe after plugin initialization, never recursively during instance startup.
            if (await api.verifyCompatibility(signal) !== openCodeVersion)
                throw new Error('OpenCode service identity changed');
            return encodeNormalView(view.snapshot(parent), launch.binding.serviceId);
        } });
    let renewedAt = Date.now();
    return {
        async tick() {
            const now = Date.now();
            if (now - renewedAt < 20_000 && now >= renewedAt)
                return;
            await bridge.renew();
            renewedAt = now;
        },
        close: () => bridge.close(),
    };
}
