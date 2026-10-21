import type { OpenCodeVersion } from './opencode-version.ts';
import type { Registry } from './registry.ts';
import type { Execution } from './executions.ts';
import type { CompletionNotice } from './notifications.ts';
import type { Clock } from './types.ts';
import { type SupervisorView } from './view-protocol.ts';
import type { NotificationIdentity } from './notification-identities.ts';
/** A read projection, never a second owner or an observer that changes task state. */
export declare class ViewProjection {
    private readonly registry;
    private readonly clock;
    private readonly versions;
    private readonly executions;
    private readonly notifications;
    private readonly wallNow;
    private readonly identities;
    readonly instanceId: string;
    private revision;
    private fingerprint;
    constructor(registry: Registry, clock: Clock, versions: {
        pluginVersion: string;
        openCodeVersion: OpenCodeVersion;
        isolationId: string;
    }, executions?: () => Execution[], notifications?: () => CompletionNotice[], wallNow?: () => Date, identities?: (parentSessionId: string) => NotificationIdentity[], instanceId?: string);
    get openCodeVersion(): OpenCodeVersion;
    snapshot(parentSessionId: string): SupervisorView;
}
