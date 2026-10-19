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
}
/** Owns only its bridge and discovery lease, never the OpenCode process or tasks. */
export declare function startNormalBridge(options: NormalBridgeOptions): Promise<{
    instanceId: string;
    file: string;
    /** Plugin tick calls this; there is no second service manager or background timer. */
    renew: () => Promise<void>;
    close(): Promise<void>;
}>;
