import type { Snapshot } from './types.ts';
/** Project a complete ascending native V2 transcript. No clock or polling timestamp is progress.
 * The caller must finish pagination; a partial page is not a terminal observation. */
export declare function snapshotFromV2(sessionId: string, messagesValue: unknown, activeValue: unknown, permissionsValue: unknown, formsValue: unknown): Snapshot;
