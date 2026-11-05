import type { OpenCodeVersion } from './opencode-version.ts';
import { type ServiceBinding } from './normal-connection-protocol.ts';
export interface NormalBridgeOptions {
    instanceId?: string;
    openCodeVersion: OpenCodeVersion;
    binding: ServiceBinding;
    launchKey: string;
    /** Existing private directory created by the GUI's service launch owner. */
    directory: string;
    snapshot(parentSessionId: string, signal: AbortSignal): Promise<unknown>;
    now?(): number;
    /** Atomic publication boundary; defaults to the filesystem rename primitive. */
    replaceFile?(source: string, destination: string): Promise<void>;
}
/** Owns only its bridge and discovery lease, never the OpenCode process or tasks. */
export declare function startNormalBridge(options: NormalBridgeOptions): Promise<{
    instanceId: string;
    file: string;
    /** Renew only this bridge lease; never owns OpenCode or task execution. */
    renew: () => Promise<void>;
    close(): Promise<void>;
}>;
