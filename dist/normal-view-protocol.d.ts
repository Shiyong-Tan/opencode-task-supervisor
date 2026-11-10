import { type SupervisorView } from './view-protocol.ts';
/** Wire adapter only; task and round state still have their existing owners. */
export declare function encodeNormalView(view: SupervisorView, serviceId: string): unknown;
export declare function parseNormalView(value: unknown, integrationId: string, serviceId: string): SupervisorView;
