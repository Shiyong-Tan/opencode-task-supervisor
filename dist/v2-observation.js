import { createHash } from 'node:crypto';
const record = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid V2 observation object');
    return value;
};
const list = (value) => {
    if (!Array.isArray(value))
        throw new Error('Invalid V2 observation list');
    return value;
};
const text = (value) => {
    if (typeof value !== 'string')
        throw new Error('Invalid V2 observation text');
    return value;
};
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const readonlyTools = new Set(['read', 'glob', 'grep', 'list', 'todo', 'todowrite', 'todoread', 'question', 'form',
    'supervisor_process_status', 'supervisor_process_wait']);
/** Project a complete ascending native V2 transcript. No clock or polling timestamp is progress.
 * The caller must finish pagination; a partial page is not a terminal observation. */
export function snapshotFromV2(sessionId, messagesValue, activeValue, permissionsValue, formsValue) {
    if (!/^ses_[A-Za-z0-9_-]+$/.test(sessionId))
        throw new Error('Invalid V2 session identity');
    const active = record(activeValue);
    for (const [id, state] of Object.entries(active)) {
        if (!/^ses_[A-Za-z0-9_-]+$/.test(id) || record(state).type !== 'running')
            throw new Error('Unknown V2 active execution');
    }
    const status = active[sessionId] === undefined ? 'idle' : 'busy';
    const activity = [], assistantActivity = [], messageIds = [];
    const tools = new Map();
    let pendingTools = 0, untrackedExecutionPossible = false, registeredExecution = false;
    let lastIdle, lastAssistant;
    const seen = new Set();
    for (const value of list(messagesValue)) {
        const message = record(value), id = text(message.id), kind = text(message.type), time = record(message.time);
        if (!/^msg_[A-Za-z0-9_-]+$/.test(id) || seen.has(id) || typeof time.created !== 'number' || !Number.isFinite(time.created))
            throw new Error('Invalid V2 transcript identity');
        seen.add(id);
        messageIds.push(id);
        activity.push(fingerprint(message));
        if (kind === 'user' || kind === 'synthetic') {
            lastIdle = undefined;
            lastAssistant = undefined;
        }
        if (kind === 'assistant') {
            lastIdle = undefined;
            lastAssistant = message;
            const content = list(message.content).map(record), output = [];
            for (const part of content) {
                if (part.type === 'text' || part.type === 'reasoning') {
                    if (text(part.text).length)
                        output.push(part);
                }
                else if (part.type === 'tool') {
                    const state = record(part.state), callId = text(part.id), name = text(part.name), toolStatus = text(state.status);
                    const key = JSON.stringify([id, callId]);
                    if (!callId || tools.has(key) || !['streaming', 'running', 'completed', 'error'].includes(toolStatus))
                        throw new Error('Invalid V2 tool identity/state');
                    tools.set(key, { name, status: toolStatus, input: JSON.stringify(state.input ?? {}).slice(0, 2048) });
                    if (toolStatus === 'streaming' || toolStatus === 'running')
                        pendingTools++;
                    if (name === 'supervisor_run')
                        registeredExecution = true;
                    else if (!readonlyTools.has(name))
                        untrackedExecutionPossible = true;
                    output.push(part);
                }
                else {
                    // Unknown content is never evidence that execution coverage is complete.
                    untrackedExecutionPossible = true;
                }
            }
            if (output.length)
                assistantActivity.push(fingerprint({ id, output }));
        }
        if (kind === 'idle') {
            if (!['succeeded', 'failed', 'interrupted'].includes(text(message.outcome)))
                throw new Error('Unknown V2 execution outcome');
            lastIdle = message;
        }
        if (!['user', 'synthetic', 'assistant', 'idle', 'system', 'skill', 'compaction', 'agent-switched', 'model-switched', 'location-switched'].includes(kind))
            untrackedExecutionPossible = true;
    }
    const permissions = list(permissionsValue).map(value => {
        const request = record(value);
        if (request.sessionID !== sessionId)
            throw new Error('Foreign V2 permission owner');
        const requestId = text(request.id), resources = list(request.resources).map(text);
        if (!/^per[A-Za-z0-9_-]+$/.test(requestId))
            throw new Error('Invalid V2 permission identity');
        const source = request.source === undefined ? undefined : record(request.source);
        const messageId = source?.type === 'tool' ? text(source.messageID) : undefined;
        const callId = source?.type === 'tool' ? text(source.id) : undefined;
        const tool = messageId && callId ? tools.get(JSON.stringify([messageId, callId])) : undefined;
        return { requestId, sessionId, permission: text(request.action), patterns: resources.slice(0, 32).map(item => item.slice(0, 2048)),
            ...(messageId === undefined ? {} : { messageId }), ...(callId === undefined ? {} : { callId }),
            ...(tool ? { tool: tool.name, input: tool.input } : {}),
            state: tool && ['completed', 'error'].includes(tool.status) ? 'expired' : tool ? 'pending' : 'unknown' };
    });
    const questionIds = list(formsValue).map(value => {
        const form = record(value), id = text(form.id);
        if (form.sessionID !== sessionId || !/^frm_[A-Za-z0-9_-]+$/.test(id))
            throw new Error('Foreign/invalid V2 form');
        return id;
    });
    const permissionIds = permissions.filter(item => item.state !== 'expired').map(item => item.requestId);
    if (new Set(permissionIds).size !== permissionIds.length || new Set(questionIds).size !== questionIds.length)
        throw new Error('Duplicate V2 interaction identity');
    let terminal, result;
    if (status === 'idle' && lastIdle && !pendingTools && !permissionIds.length && !questionIds.length) {
        terminal = lastIdle.outcome === 'succeeded' ? 'completed' : 'failed';
        const output = lastAssistant ? list(lastAssistant.content).map(record).filter(part => part.type === 'text').map(part => text(part.text)).join('\n') : '';
        result = { messageId: text(lastAssistant?.id ?? lastIdle.id), text: output, outcome: terminal,
            ...(lastIdle.outcome === 'succeeded' ? {} : { error: lastIdle.outcome === 'interrupted' ? 'ExecutionInterrupted' : 'ExecutionFailed' }) };
    }
    return { sessionId, status, activity, assistantActivity, messageIds, permissions, permissionIds, questionIds, pendingTools,
        terminal, result, process: 'unknown', untrackedExecutionPossible,
        executionStopConfirmed: !untrackedExecutionPossible && !registeredExecution };
}
