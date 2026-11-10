import { parseOpenCodeVersion } from "./opencode-version.js";
import { createHash } from 'node:crypto';
import { withoutProcessWaitPresentation } from "./process-progress-observation.js";
function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Unexpected OpenCode response object');
    return value;
}
function array(value) {
    if (!Array.isArray(value))
        throw new Error('Unexpected OpenCode response array');
    return value;
}
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function statusesFrom(value) {
    const statuses = object(value);
    for (const item of Object.values(statuses)) {
        if (!['busy', 'retry', 'idle'].includes(String(object(item).type)))
            throw new Error('Incompatible OpenCode /session/status response');
    }
    return statuses;
}
function permissionsFrom(value) {
    return array(value).map(item => {
        const permission = object(item);
        if (typeof permission.id !== 'string' || !permission.id || typeof permission.sessionID !== 'string' || !permission.sessionID)
            throw new Error('Incompatible OpenCode /permission response');
        return permission;
    });
}
export function snapshotFrom(sessionId, messagesValue, statusesValue, permissionsValue, questionsValue = []) {
    const statuses = statusesFrom(statusesValue);
    const rawStatus = statuses[sessionId] === undefined ? 'idle' : object(statuses[sessionId]).type;
    if (!['busy', 'retry', 'idle'].includes(String(rawStatus)))
        throw new Error('Unsupported session status');
    const activity = [], assistantActivity = [];
    let pendingTools = 0;
    let terminal;
    let latestAssistantCreated = -1;
    let latestUserCreated = -1;
    let terminalCreated = -1;
    let result;
    const messageIds = [];
    const toolStates = new Map();
    const observedTools = [];
    for (const entry of array(messagesValue)) {
        const message = object(entry), info = object(message.info), time = object(info.time);
        const parts = array(message.parts).map(object);
        if (typeof info.id !== 'string' || !info.id || !['user', 'assistant'].includes(String(info.role)) ||
            typeof time.created !== 'number' || !Number.isFinite(time.created) ||
            (time.completed !== undefined && (typeof time.completed !== 'number' || !Number.isFinite(time.completed))))
            throw new Error('Incompatible OpenCode message metadata');
        if (info.sessionID !== sessionId)
            throw new Error('Cross-session message response');
        if (typeof info.id === 'string')
            messageIds.push(info.id);
        const key = fingerprint({ info, parts: parts.map(withoutProcessWaitPresentation) });
        activity.push(key);
        const created = Number(time.created);
        if (info.role === 'user')
            latestUserCreated = Math.max(latestUserCreated, created);
        if (info.role === 'assistant') {
            latestAssistantCreated = Math.max(latestAssistantCreated, created);
            // Empty assistant placeholders and user notification messages are not recovery evidence.
            const output = parts.filter(p => (['text', 'reasoning'].includes(String(p.type)) && typeof p.text === 'string' && p.text.length > 0) || p.type === 'tool');
            if (output.length)
                assistantActivity.push(fingerprint({ id: info.id, output: output.map(withoutProcessWaitPresentation) }));
            if (time.completed && (info.error || ['stop', 'end_turn'].includes(String(info.finish))) && created >= terminalCreated) {
                terminalCreated = created;
                terminal = info.error ? 'failed' : 'completed';
                result = { messageId: String(info.id), outcome: terminal,
                    text: parts.filter(p => p.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n'),
                    ...(info.error ? { error: String(object(info.error).name ?? 'AssistantError') } : {}) };
            }
        }
        for (const part of parts) {
            if (part.type === 'tool') {
                observedTools.push(String(part.tool ?? ''));
                const state = object(part.state);
                if (typeof part.callID === 'string')
                    toolStates.set(`${info.id}:${part.callID}`, {
                        tool: String(part.tool ?? ''), input: JSON.stringify(state.input ?? {}).slice(0, 2048),
                        status: String(state.status), aborted: !!info.error,
                    });
                if (!['pending', 'running', 'completed', 'error'].includes(String(state.status)))
                    throw new Error('Incompatible OpenCode tool state');
                if (['pending', 'running'].includes(String(state.status)))
                    pendingTools++;
            }
        }
    }
    if (terminalCreated < latestAssistantCreated || terminalCreated < latestUserCreated) {
        terminal = undefined;
        result = undefined;
    }
    const questionIds = permissionsFrom(questionsValue).filter(q => {
        if (q.sessionID !== sessionId)
            return false;
        const tool = q.tool && typeof q.tool === 'object' ? object(q.tool) : {};
        const state = toolStates.get(`${tool.messageID}:${tool.callID}`);
        return !state || (!state.aborted && ['pending', 'running'].includes(state.status));
    }).map(q => String(q.id));
    const permissions = permissionsFrom(permissionsValue).filter(p => p.sessionID === sessionId).map(p => {
        const ref = p.tool && typeof p.tool === 'object' ? object(p.tool) : {};
        const messageId = typeof ref.messageID === 'string' ? ref.messageID : undefined;
        const callId = typeof ref.callID === 'string' ? ref.callID : undefined;
        const tool = messageId && callId ? toolStates.get(`${messageId}:${callId}`) : undefined;
        return { requestId: String(p.id), sessionId, permission: String(p.permission ?? ''),
            patterns: Array.isArray(p.patterns) ? p.patterns.filter((v) => typeof v === 'string').slice(0, 32).map(v => v.slice(0, 2048)) : [],
            messageId, callId, tool: tool?.tool, input: tool?.input,
            state: tool?.aborted || ['completed', 'error'].includes(tool?.status ?? '') ? 'expired' : tool ? 'pending' : 'unknown' };
    });
    const permissionIds = permissions.filter(p => p.state !== 'expired').map(p => p.requestId);
    const untrackedExecutionPossible = observedTools.some(name => !['read', 'glob', 'grep', 'list', 'todowrite', 'todoread', 'question', 'supervisor_run', 'supervisor_process_status', 'supervisor_process_wait', 'supervisor_process_review'].includes(name));
    // Even completed native commands may leave descendants; never infer safety from tool completion.
    const registeredExecution = observedTools.includes('supervisor_run');
    return { untrackedExecutionPossible, executionStopConfirmed: !untrackedExecutionPossible && !registeredExecution,
        questionIds, sessionId, status: rawStatus, activity, assistantActivity,
        permissionIds, permissions, pendingTools, terminal, process: 'unknown', messageIds, result };
}
export class OpenCodeApi {
    options;
    constructor(options) {
        this.options = options;
        const url = new URL(options.baseUrl);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
            throw new Error('Phase-one adapter requires loopback server');
    }
    async request(path, method, signal, body) {
        const response = await (this.options.fetch ?? fetch)(new URL(path, this.options.baseUrl), {
            method, signal, headers: { ...this.options.headers, 'content-type': 'application/json', 'x-opencode-directory': this.options.directory },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok)
            throw new Error(`OpenCode ${method} ${path}: HTTP ${response.status}`);
        return response.status === 204 ? undefined : response.json();
    }
    async verifyVersion(signal) {
        const health = object(await this.request('/global/health', 'GET', signal));
        return parseOpenCodeVersion(health.version);
    }
    /** Read-only probe. Effectful operations are validated only when explicitly requested. */
    async verifyCompatibility(signal) {
        const version = await this.verifyVersion(signal);
        const [statuses, permissions] = await Promise.all([
            this.request('/session/status', 'GET', signal), this.request('/permission', 'GET', signal),
        ]);
        statusesFrom(statuses);
        permissionsFrom(permissions);
        return version;
    }
    async create(parentSessionId, title, signal, selection) {
        const session = object(await this.request('/session', 'POST', signal, { parentID: parentSessionId, title,
            ...(selection ? { agent: selection.agent, permission: selection.permission } : {}) }));
        if (typeof session.id !== 'string' || session.parentID !== parentSessionId)
            throw new Error('Invalid child creation response');
        return session.id;
    }
    async dispatch(childSessionId, prompt, signal, selection) {
        await this.request(`/session/${encodeURIComponent(childSessionId)}/prompt_async`, 'POST', signal, {
            parts: [{ type: 'text', text: prompt }], model: selection?.model ?? this.options.model, noReply: this.options.noReply,
            ...(selection ? { agent: selection.agent, variant: selection.variant } : {}),
        });
    }
    async observe(sessionId, signal) {
        // Existence query is essential: idle sessions are absent from /session/status.
        const session = object(await this.request(`/session/${encodeURIComponent(sessionId)}`, 'GET', signal));
        if (session.id !== sessionId)
            throw new Error('Session identity mismatch');
        const [messages, statuses, permissions, questions] = await Promise.all([
            this.request(`/session/${encodeURIComponent(sessionId)}/message`, 'GET', signal),
            this.request('/session/status', 'GET', signal), this.request('/permission', 'GET', signal), this.request('/question', 'GET', signal),
        ]);
        return snapshotFrom(sessionId, messages, statuses, permissions, questions);
    }
    async abort(sessionId, signal) {
        const result = await this.request(`/session/${encodeURIComponent(sessionId)}/abort`, 'POST', signal);
        if (result !== true)
            throw new Error('Abort not acknowledged');
    }
    async notify(sessionId, text, signal, messageId) {
        await this.request(`/session/${encodeURIComponent(sessionId)}/prompt_async`, 'POST', signal, {
            messageID: messageId, parts: [{ type: 'text', text }], model: this.options.model, noReply: this.options.noReply,
        });
    }
}
