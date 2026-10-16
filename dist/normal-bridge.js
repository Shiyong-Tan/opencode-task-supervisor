import { pluginVersion } from "./plugin-version.js";
import { randomBytes } from 'node:crypto';
import { open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { startReadonlyBridge } from "./readonly-bridge.js";
import { bridgeBearer, connectionProof, signConnectionLease, verifyConnectionLease } from "./normal-connection-protocol.js";
/** Owns only its bridge and discovery lease, never the OpenCode process or tasks. */
export async function startNormalBridge(options) {
    const now = options.now ?? Date.now;
    const instanceId = options.instanceId ?? randomBytes(32).toString('hex');
    // Validate all supplied identity fields before using a service ID in a filename.
    const token = bridgeBearer(options.launchKey, options.binding, instanceId);
    if (!isAbsolute(options.directory) || await realpath(options.directory) !== resolve(options.directory)) {
        throw new Error('Invalid supervisor private directory');
    }
    const file = join(options.directory, `${options.binding.serviceId}.json`);
    const reservationPath = `${file}.owner`;
    const reservation = await open(reservationPath, 'wx', 0o600);
    let bridge;
    let current;
    let closed = false;
    let writes = Promise.resolve();
    const temporary = `${file}.${instanceId}.tmp`;
    const renew = () => {
        const operation = writes.then(async () => {
            if (closed)
                return;
            if (current) {
                const previous = verifyConnectionLease(JSON.parse(await readFile(file, 'utf8')), options.binding, options.launchKey, current.issuedAt);
                if (previous.instanceId !== instanceId)
                    throw new Error('Supervisor lease ownership changed');
            }
            const issuedAt = now();
            const lease = { schemaVersion: 1, kind: 'normal-gui', ...options.binding,
                instanceId, bridgeOrigin: bridge.endpoint, opencodeVersion: options.openCodeVersion, pluginVersion,
                issuedAt, expiresAt: issuedAt + 60_000 };
            const signed = signConnectionLease(lease, options.launchKey);
            const handle = await open(temporary, 'wx', 0o600);
            try {
                await handle.writeFile(JSON.stringify(signed));
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            await rename(temporary, file);
            current = lease;
        });
        writes = operation.catch(() => undefined);
        return operation;
    };
    try {
        // Refuse crash residue or foreign discovery records rather than taking them over.
        const initial = await open(file, 'wx', 0o600);
        await initial.close();
        bridge = await startReadonlyBridge({ token, snapshot: async (parent, signal) => {
                if (!current || closed || now() < current.issuedAt || now() >= current.expiresAt)
                    throw new Error('Lease unavailable');
                return options.snapshot(parent, signal);
            }, identity: challenge => {
                if (!current || closed || now() < current.issuedAt || now() >= current.expiresAt)
                    throw new Error('Lease unavailable');
                return { lease: signConnectionLease(current, options.launchKey), proof: connectionProof(options.launchKey, current, challenge) };
            } });
        await renew();
    }
    catch (error) {
        await bridge?.close();
        await reservation.close();
        await unlink(reservationPath);
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
    let closing;
    return {
        instanceId, file,
        /** Plugin tick calls this; there is no second service manager or background timer. */
        renew,
        close() {
            return closing ??= (async () => {
                closed = true;
                await bridge.close();
                await writes;
                try {
                    const raw = JSON.parse(await readFile(file, 'utf8'));
                    // Verify at issue time to allow cleanup of our own expired lease.
                    const parsed = verifyConnectionLease(raw, options.binding, options.launchKey, current.issuedAt);
                    if (parsed.instanceId === instanceId)
                        await unlink(file);
                }
                catch { /* Foreign, corrupt or missing records are never removed. */ }
                await reservation.close();
                await unlink(reservationPath);
                await unlink(temporary).catch(() => undefined);
            })();
        },
    };
}
