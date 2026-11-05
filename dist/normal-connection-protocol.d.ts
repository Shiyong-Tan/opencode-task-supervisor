import { type OpenCodeVersion } from './opencode-version.ts';
/** Normal GUI protocol. Deliberately separate from isolated lab descriptors. */
export interface ServiceBinding {
    integrationId: string;
    serviceId: string;
    workspace: string;
    serviceOrigin: string;
}
export interface ConnectionLease extends ServiceBinding {
    schemaVersion: 1;
    kind: 'normal-gui';
    instanceId: string;
    bridgeOrigin: string;
    opencodeVersion: OpenCodeVersion;
    pluginVersion: string;
    issuedAt: number;
    expiresAt: number;
}
export interface SignedConnectionLease {
    payload: ConnectionLease;
    signature: string;
}
export declare const MAX_LEASE_MS = 60000;
/** Caller must resolve realpath first. This is canonical spelling, not a filesystem proof. */
export declare function canonicalWindowsWorkspace(realPath: string): string;
/** Preserve POSIX case and literal backslashes; never collapse distinct workspaces. */
export declare function canonicalWorkspace(realPath: string): string;
/** The private launch key never appears in the returned discovery record. */
export declare function signConnectionLease(payload: ConnectionLease, launchKey: string): SignedConnectionLease;
export declare function verifyConnectionLease(input: unknown, expected: ServiceBinding, launchKey: string, now: number): ConnectionLease;
/** Domain separation prevents a recorded lease or proof from being used as a bearer. */
export declare function bridgeBearer(launchKey: string, owner: ServiceBinding, instanceId: string): string;
export declare function connectionProof(launchKey: string, lease: ConnectionLease, challenge: string): string;
export declare function verifyConnectionProof(proof: unknown, launchKey: string, lease: ConnectionLease, challenge: string): boolean;
/** Binds private launch metadata to the ordinary transport authentication. */
export declare function serviceAuthenticationProof(launchKey: string, owner: ServiceBinding, authorization: string): string;
