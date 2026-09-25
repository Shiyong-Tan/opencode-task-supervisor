import { parseOpenCodeVersion, type OpenCodeVersion } from './opencode-version.ts';
import { createHash } from 'node:crypto';
import type { AgentDispatch } from './agent-dispatch.ts';
import type { Api, Snapshot, TaskResult } from './types.ts';

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unexpected OpenCode response object');
  return value as ObjectValue;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Unexpected OpenCode response array');
  return value;
}
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function statusesFrom(value: unknown): ObjectValue {
  const statuses = object(value);
  for (const item of Object.values(statuses)) {
    if (!['busy', 'retry', 'idle'].includes(String(object(item).type))) throw new Error('Incompatible OpenCode /session/status response');
  }
  return statuses;
}
function permissionsFrom(value: unknown): ObjectValue[] {
  return array(value).map(item => {
    const permission = object(item);
    if (typeof permission.id !== 'string' || !permission.id || typeof permission.sessionID !== 'string' || !permission.sessionID)
      throw new Error('Incompatible OpenCode /permission response');
    return permission;
  });
}

export function snapshotFrom(sessionId: string, messagesValue: unknown, statusesValue: unknown, permissionsValue: unknown): Snapshot {
  const statuses = statusesFrom(statusesValue);
  const rawStatus = statuses[sessionId] === undefined ? 'idle' : object(statuses[sessionId]).type;
  if (!['busy', 'retry', 'idle'].includes(String(rawStatus))) throw new Error('Unsupported session status');
  const activity: string[] = [], assistantActivity: string[] = [];
  let pendingTools = 0;
  let terminal: Snapshot['terminal'];
  let latestAssistantCreated = -1;
  let latestUserCreated = -1;
  let terminalCreated = -1;
  let result: TaskResult | undefined;
  const messageIds: string[] = [];
  const toolStates = new Map<string, { tool: string; input: string; status: string; aborted: boolean }>();
  for (const entry of array(messagesValue)) {
    const message = object(entry), info = object(message.info), time = object(info.time);
    const parts = array(message.parts).map(object);
    if (typeof info.id !== 'string' || !info.id || !['user', 'assistant'].includes(String(info.role)) ||
      typeof time.created !== 'number' || !Number.isFinite(time.created) ||
      (time.completed !== undefined && (typeof time.completed !== 'number' || !Number.isFinite(time.completed))))
      throw new Error('Incompatible OpenCode message metadata');
    if (info.sessionID !== sessionId) throw new Error('Cross-session message response');
    if (typeof info.id === 'string') messageIds.push(info.id);
    const key = fingerprint({ info, parts });
    activity.push(key);
    const created = Number(time.created);
    if (info.role === 'user') latestUserCreated = Math.max(latestUserCreated, created);
    if (info.role === 'assistant') {
      latestAssistantCreated = Math.max(latestAssistantCreated, created);
      // Empty assistant placeholders and user notification messages are not recovery evidence.
      const output = parts.filter(p => (['text', 'reasoning'].includes(String(p.type)) && typeof p.text === 'string' && p.text.length > 0) || p.type === 'tool');
      if (output.length) assistantActivity.push(fingerprint({ id: info.id, output }));
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
        const state = object(part.state);
        if (typeof part.callID === 'string') toolStates.set(`${info.id}:${part.callID}`, {
          tool: String(part.tool ?? ''), input: JSON.stringify(state.input ?? {}).slice(0, 2048),
          status: String(state.status), aborted: !!info.error,
        });
        if (!['pending', 'running', 'completed', 'error'].includes(String(state.status)))
          throw new Error('Incompatible OpenCode tool state');
        if (['pending', 'running'].includes(String(state.status))) pendingTools++;
      }
    }
  }
  if (terminalCreated < latestAssistantCreated || terminalCreated < latestUserCreated) { terminal = undefined; result = undefined; }
  const permissions: NonNullable<Snapshot['permissions']> = permissionsFrom(permissionsValue).filter(p => p.sessionID === sessionId).map(p => {
    const ref = p.tool && typeof p.tool === 'object' ? object(p.tool) : {};
    const messageId = typeof ref.messageID === 'string' ? ref.messageID : undefined;
    const callId = typeof ref.callID === 'string' ? ref.callID : undefined;
    const tool = messageId && callId ? toolStates.get(`${messageId}:${callId}`) : undefined;
    return { requestId: String(p.id), sessionId, permission: String(p.permission ?? ''),
      patterns: Array.isArray(p.patterns) ? p.patterns.filter((v): v is string => typeof v === 'string').slice(0, 32).map(v => v.slice(0, 2048)) : [],
      messageId, callId, tool: tool?.tool, input: tool?.input,
      state: tool?.aborted || ['completed', 'error'].includes(tool?.status ?? '') ? 'expired' : tool ? 'pending' : 'unknown' };
  });
  const permissionIds = permissions.filter(p => p.state !== 'expired').map(p => p.requestId);
  return { sessionId, status: rawStatus as Snapshot['status'], activity, assistantActivity,
    permissionIds, permissions, pendingTools, terminal, process: 'unknown', messageIds, result };
}

export interface HttpOptions {
  baseUrl: string;
  directory: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  model?: { providerID: string; modelID: string };
  noReply?: boolean;
}

export class OpenCodeApi implements Api {
  constructor(readonly options: HttpOptions) {
    const url = new URL(options.baseUrl);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Phase-one adapter requires loopback server');
  }
  async request(path: string, method: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await (this.options.fetch ?? fetch)(new URL(path, this.options.baseUrl), {
      method, signal, headers: { ...this.options.headers, 'content-type': 'application/json', 'x-opencode-directory': this.options.directory },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`OpenCode ${method} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  }
  async verifyVersion(signal: AbortSignal): Promise<OpenCodeVersion> {
    const health = object(await this.request('/global/health', 'GET', signal));
    return parseOpenCodeVersion(health.version);
  }
  /** Read-only probe. Effectful operations are validated only when explicitly requested. */
  async verifyCompatibility(signal: AbortSignal): Promise<OpenCodeVersion> {
    const version = await this.verifyVersion(signal);
    const [statuses, permissions] = await Promise.all([
      this.request('/session/status', 'GET', signal), this.request('/permission', 'GET', signal),
    ]);
    statusesFrom(statuses); permissionsFrom(permissions);
    return version;
  }
  async create(parentSessionId: string, title: string, signal: AbortSignal, selection?: AgentDispatch): Promise<string> {
    const session = object(await this.request('/session', 'POST', signal, { parentID: parentSessionId, title,
      ...(selection ? { agent: selection.agent, permission: selection.permission } : {}) }));
    if (typeof session.id !== 'string' || session.parentID !== parentSessionId) throw new Error('Invalid child creation response');
    return session.id;
  }
  async dispatch(childSessionId: string, prompt: string, signal: AbortSignal, selection?: AgentDispatch): Promise<void> {
    await this.request(`/session/${encodeURIComponent(childSessionId)}/prompt_async`, 'POST', signal, {
      parts: [{ type: 'text', text: prompt }], model: selection?.model ?? this.options.model, noReply: this.options.noReply,
      ...(selection ? { agent: selection.agent, variant: selection.variant } : {}),
    });
  }
  async observe(sessionId: string, signal: AbortSignal): Promise<Snapshot> {
    // Existence query is essential: idle sessions are absent from /session/status.
    const session = object(await this.request(`/session/${encodeURIComponent(sessionId)}`, 'GET', signal));
    if (session.id !== sessionId) throw new Error('Session identity mismatch');
    const [messages, statuses, permissions] = await Promise.all([
      this.request(`/session/${encodeURIComponent(sessionId)}/message`, 'GET', signal),
      this.request('/session/status', 'GET', signal), this.request('/permission', 'GET', signal),
    ]);
    return snapshotFrom(sessionId, messages, statuses, permissions);
  }
  async abort(sessionId: string, signal: AbortSignal): Promise<void> {
    const result = await this.request(`/session/${encodeURIComponent(sessionId)}/abort`, 'POST', signal);
    if (result !== true) throw new Error('Abort not acknowledged');
  }
  async notify(sessionId: string, text: string, signal: AbortSignal, messageId?: string): Promise<void> {
    await this.request(`/session/${encodeURIComponent(sessionId)}/prompt_async`, 'POST', signal, {
      messageID: messageId, parts: [{ type: 'text', text }], model: this.options.model, noReply: this.options.noReply,
    });
  }
}
