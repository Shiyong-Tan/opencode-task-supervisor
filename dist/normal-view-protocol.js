import { parseSupervisorView } from "./view-protocol.js";
import { parseNotificationIdentity } from "./notification-identity-protocol.js";
function invalid() { throw new Error('Invalid normal supervisor view'); }
/** Wire adapter only; task and round state still have their existing owners. */
export function encodeNormalView(view, serviceId) {
    const { schemaVersion: _schema, isolationId, scope: _scope, notificationIdentities, ...fields } = parseSupervisorView(view);
    return { schemaVersion: 2, kind: 'normal-gui-view', integrationId: isolationId, serviceId,
        scope: 'registered_tasks_only', ...fields, notificationIdentities: notificationIdentities.map(identity => {
            const { schemaVersion: _version, isolationId: integrationId, ...rest } = identity;
            return { schemaVersion: 2, integrationId, ...rest };
        }) };
}
export function parseNormalView(value, integrationId, serviceId) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return invalid();
    const raw = value;
    if (raw.schemaVersion !== 2 || raw.kind !== 'normal-gui-view' || raw.integrationId !== integrationId
        || raw.serviceId !== serviceId || raw.scope !== 'registered_tasks_only'
        || Object.prototype.hasOwnProperty.call(raw, 'isolationId') || !Array.isArray(raw.notificationIdentities)
        || raw.notificationIdentities.length > 1024)
        return invalid();
    const identities = raw.notificationIdentities.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return invalid();
        const { schemaVersion, integrationId: scope, ...fields } = value;
        if (schemaVersion !== 2 || scope !== integrationId || Object.prototype.hasOwnProperty.call(fields, 'isolationId'))
            return invalid();
        return parseNotificationIdentity({ ...fields, schemaVersion: 1, isolationId: scope });
    });
    return parseSupervisorView({ ...raw, schemaVersion: 1, isolationId: integrationId,
        scope: 'isolated_allowlisted_commands', notificationIdentities: identities });
}
