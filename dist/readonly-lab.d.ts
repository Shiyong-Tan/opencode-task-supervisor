import type { OpenCodeApi } from './opencode-api.ts';
import { NotificationIdentities } from './notification-identities.ts';
import type { ViewProjection } from './view-projection.ts';
/** No production fallback. All paths must agree with the explicit isolated launcher. */
export declare function prepareReadonlyLab(value: unknown, directory: string, env: NodeJS.ProcessEnv): Promise<{
    root: string;
    state: string;
    identities: NotificationIdentities;
    isolationId: string;
    workspace: string;
}>;
export declare function startReadonlyLab(lab: Awaited<ReturnType<typeof prepareReadonlyLab>>, api: OpenCodeApi, view: ViewProjection): Promise<{
    close(): Promise<void>;
}>;
