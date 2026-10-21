import { isAbsolute } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { canonicalWorkspace, serviceAuthenticationProof } from "./normal-connection-protocol.js";
const keys = ['schemaVersion', 'kind', 'binding', 'launchKey', 'identityKey', 'privateDirectory', 'authenticationProof'];
const bindingKeys = ['integrationId', 'serviceId', 'workspace', 'serviceOrigin'];
function invalid() { throw new Error('Invalid supervisor launch metadata'); }
function exact(value, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return invalid();
    const record = value;
    if (Object.keys(record).length !== fields.length || fields.some(key => !Object.prototype.hasOwnProperty.call(record, key)))
        return invalid();
    return record;
}
/** Caller supplies actual realpath, plugin server origin and ordinary service auth. */
export function parseNormalLaunch(serialized, realWorkspace, serviceOrigin, authorization) {
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 16_384)
        return invalid();
    let raw;
    try {
        raw = exact(JSON.parse(serialized), keys);
    }
    catch {
        return invalid();
    }
    const owner = exact(raw.binding, bindingKeys);
    if (raw.schemaVersion !== 1 || raw.kind !== 'normal-gui-launch'
        || typeof raw.privateDirectory !== 'string' || raw.privateDirectory.length > 4096 || !isAbsolute(raw.privateDirectory)
        || [raw.launchKey, raw.identityKey, raw.authenticationProof, owner.integrationId, owner.serviceId]
            .some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
        || owner.workspace !== canonicalWorkspace(realWorkspace) || owner.serviceOrigin !== serviceOrigin)
        return invalid();
    const binding = owner;
    const launchKey = raw.launchKey;
    let proof;
    try {
        proof = serviceAuthenticationProof(launchKey, binding, authorization);
    }
    catch {
        return invalid();
    }
    if (!timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(raw.authenticationProof, 'hex')))
        return invalid();
    return { schemaVersion: 1, kind: 'normal-gui-launch', binding: { ...binding }, launchKey,
        identityKey: raw.identityKey, privateDirectory: raw.privateDirectory, authenticationProof: proof };
}
