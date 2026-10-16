import { type ServiceBinding } from './normal-connection-protocol.ts';
/** Privileged bootstrap passed only by the existing GUI service spawn owner. */
export interface NormalLaunch {
    schemaVersion: 1;
    kind: 'normal-gui-launch';
    binding: ServiceBinding;
    launchKey: string;
    identityKey: string;
    privateDirectory: string;
    authenticationProof: string;
}
/** Caller supplies actual realpath, plugin server origin and ordinary service auth. */
export declare function parseNormalLaunch(serialized: string, realWorkspace: string, serviceOrigin: string, authorization: string): NormalLaunch;
