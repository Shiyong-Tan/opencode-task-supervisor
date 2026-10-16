import { mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import { pluginVersion } from "./plugin-version.js";
import { isAbsolute, join, resolve } from 'node:path';
import { NotificationIdentities } from "./notification-identities.js";
import { startReadonlyBridge } from "./readonly-bridge.js";
/** No production fallback. All paths must agree with the explicit isolated launcher. */
export async function prepareReadonlyLab(value, directory, env) {
    if (!value || typeof value !== 'object')
        throw new Error('Explicit readonly laboratory configuration required');
    const option = value;
    if (option.enabled !== true || typeof option.root !== 'string' || !isAbsolute(option.root) ||
        typeof option.isolationId !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(option.isolationId))
        throw new Error('Invalid readonly laboratory options');
    const root = await realpath(option.root);
    const expected = {
        HOME: 'home', USERPROFILE: 'home', OPENCODE_TEST_HOME: 'home',
        XDG_CONFIG_HOME: 'config', XDG_DATA_HOME: 'data', XDG_CACHE_HOME: 'cache', XDG_STATE_HOME: 'state',
        APPDATA: 'config', LOCALAPPDATA: 'data', TEMP: 'tmp', TMP: 'tmp',
    };
    for (const [key, suffix] of Object.entries(expected)) {
        if (!env[key] || await realpath(env[key]) !== join(root, suffix))
            throw new Error('Laboratory environment mismatch');
    }
    if (await realpath(directory) !== join(root, 'work') ||
        resolve(env.OPENCODE_DB ?? '') !== join(root, 'data', 'opencode.db') ||
        env.OPENCODE_DISABLE_PROJECT_CONFIG !== '1' || env.OPENCODE_DISABLE_DEFAULT_PLUGINS !== '1' ||
        env.OPENCODE_DISABLE_AUTOUPDATE !== '1' || env.OPENCODE_DISABLE_MODELS_FETCH !== '1')
        throw new Error('Laboratory isolation incomplete');
    const marker = JSON.parse(await readFile(join(root, 'isolation.json'), 'utf8'));
    if (marker.schemaVersion !== 1 || marker.isolationId !== option.isolationId)
        throw new Error('Laboratory marker mismatch');
    const state = join(root, 'state', 'supervisor');
    await mkdir(state, { recursive: true });
    if (await realpath(state) !== state)
        throw new Error('Laboratory state redirects outside declared path');
    const identityDirectory = join(state, 'identities');
    await mkdir(identityDirectory, { recursive: true });
    if (await realpath(identityDirectory) !== identityDirectory)
        throw new Error('Laboratory identity directory redirects outside declared path');
    const identities = await NotificationIdentities.load(identityDirectory, option.isolationId);
    return { root, state, identities, isolationId: option.isolationId, workspace: await realpath(directory) };
}
export async function startReadonlyLab(lab, api, view) {
    const service = new URL(api.options.baseUrl);
    if (service.protocol !== 'http:' || service.hostname !== '127.0.0.1' || !service.port || service.username || service.password || service.search || service.hash) {
        throw new Error('Explicit IPv4 loopback laboratory service required');
    }
    const openCodeVersion = await api.verifyVersion(AbortSignal.timeout(5000));
    if (view.openCodeVersion !== openCodeVersion)
        throw new Error('Supervisor projection version mismatch');
    const authorization = api.options.headers?.authorization;
    if (!authorization?.startsWith('Basic '))
        throw new Error('Isolated service authentication required');
    const descriptorPath = join(lab.state, 'connection.json');
    // Refuse an existing descriptor, including one left by a crash. No lock takeover.
    const descriptor = await open(descriptorPath, 'wx', 0o600);
    let bridge;
    try {
        bridge = await startReadonlyBridge({ snapshot: async (parent, signal) => {
                if (signal.aborted)
                    throw new Error('Aborted');
                // Probe after plugin initialization, never recursively during instance startup.
                if (await api.verifyCompatibility(signal) !== openCodeVersion)
                    throw new Error('OpenCode service identity changed');
                return view.snapshot(parent);
            } });
        await descriptor.writeFile(JSON.stringify({ schemaVersion: 1, isolationId: lab.isolationId,
            instanceId: view.instanceId, workspace: lab.workspace, openCodeVersion, pluginVersion,
            service: { endpoint: service.origin, authorization }, bridge: { endpoint: bridge.endpoint, token: bridge.token },
        }), 'utf8');
        await descriptor.sync();
    }
    catch (error) {
        await bridge?.close();
        await descriptor.close();
        await unlink(descriptorPath);
        throw error;
    }
    await descriptor.close();
    let closePromise;
    return {
        async close() {
            return closePromise ??= (async () => {
                await bridge.close();
                // Only remove a descriptor still identifying our own instance.
                const current = JSON.parse(await readFile(descriptorPath, 'utf8'));
                if (current.instanceId === view.instanceId && current.isolationId === lab.isolationId)
                    await unlink(descriptorPath);
            })();
        },
    };
}
