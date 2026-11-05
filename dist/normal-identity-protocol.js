import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseNotificationIdentity } from "./notification-identity-protocol.js";
function invalid() { throw new Error('Invalid signed supervisor identity'); }
export function normalIdentityCodec(integrationId, identityKey) {
    if (![integrationId, identityKey].every(value => /^[a-f0-9]{64}$/.test(value)))
        return invalid();
    const normalize = (value) => {
        const parsed = parseNotificationIdentity(value);
        if (parsed.isolationId !== integrationId)
            return invalid();
        return parsed;
    };
    const wire = (value) => {
        const { schemaVersion: _version, isolationId, ...fields } = normalize(value);
        return { schemaVersion: 2, integrationId: isolationId, ...fields };
    };
    const signature = (value) => createHmac('sha256', Buffer.from(identityKey, 'hex'))
        .update('supervisor/normal-notification/v2\0').update(JSON.stringify(value)).digest('hex');
    return {
        encode(value) {
            const payload = wire(value);
            return { payload, signature: signature(payload) };
        },
        decode(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value))
                return invalid();
            const envelope = value;
            if (Object.keys(envelope).length !== 2 || !envelope.payload || typeof envelope.payload !== 'object'
                || Array.isArray(envelope.payload) || typeof envelope.signature !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.signature))
                return invalid();
            const { schemaVersion, integrationId: scope, ...fields } = envelope.payload;
            if (schemaVersion !== 2 || scope !== integrationId || Object.prototype.hasOwnProperty.call(fields, 'isolationId'))
                return invalid();
            const parsed = normalize(parseNotificationIdentity({ schemaVersion: 1, isolationId: scope, ...fields }));
            const expected = signature(wire(parsed));
            if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(envelope.signature, 'hex')))
                return invalid();
            return parsed;
        },
    };
}
