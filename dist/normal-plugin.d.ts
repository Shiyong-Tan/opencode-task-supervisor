import { NotificationIdentities } from './notification-identities.ts';
import type { OpenCodeApi } from './opencode-api.ts';
import type { ViewProjection } from './view-projection.ts';
export declare function prepareNormalPlugin(option: unknown, directory: string, serviceOrigin: string, authorization: string, env: NodeJS.ProcessEnv): Promise<{
    launch: import("./normal-launch-protocol.ts").NormalLaunch;
    identities: NotificationIdentities;
}>;
export declare function startNormalPlugin(normal: Awaited<ReturnType<typeof prepareNormalPlugin>>, api: Pick<OpenCodeApi, 'verifyVersion' | 'verifyCompatibility'>, view: ViewProjection): Promise<{
    tick(): Promise<void>;
    close: () => Promise<void>;
}>;
