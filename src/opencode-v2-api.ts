import { randomBytes, createHash } from 'node:crypto';
import { V2ObservationApi } from './v2-observation-api.ts';
import type { Api } from './types.ts';
import type { AgentDispatch, PermissionRule } from './agent-dispatch.ts';

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native V2 response');
  return value as ObjectValue;
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('Invalid native V2 list'); return value; }
function sid(value: string): string { if (!/^ses_[A-Za-z0-9_-]{1,240}$/.test(value)) throw new Error('Invalid native session'); return encodeURIComponent(value); }
const nativeRules = (value: unknown): PermissionRule[] => array(value).map(item => {
  const rule = object(item);
  if (typeof rule.action !== 'string' || typeof rule.resource !== 'string' || !['allow', 'ask', 'deny'].includes(String(rule.effect))) throw new Error('Invalid native permission rule');
  return { permission: rule.action, pattern: rule.resource, action: rule.effect as PermissionRule['action'] };
});

/** Native V2 mutations. The shared Supervisor remains the sole task/retry policy owner. */
export class OpenCodeV2Api extends V2ObservationApi implements Api {
  private readonly liveProgress = new Map<string, string>();
  private streamAvailable?: boolean;
  activityStreamAvailable(available: boolean): void { this.streamAvailable = available; }
  recordLive(value: unknown): void {
    const event = object(value), data = object(event.data);
    if (typeof event.id !== 'string' || !event.id.startsWith('evt_') || typeof data.sessionID !== 'string') return;
    const type = event.type;
    if ((type === 'session.text.delta' || type === 'session.reasoning.delta') && typeof data.delta === 'string' && data.delta.length)
      this.liveProgress.set(data.sessionID, event.id);
    else if (type === 'session.tool.progress') this.liveProgress.set(data.sessionID,
      createHash('sha256').update(JSON.stringify([data.assistantMessageID, data.id, data.metadata])).digest('hex'));
  }
  override async observe(sessionId: string, signal: AbortSignal) {
    const snapshot = await super.observe(sessionId, signal);
    if (this.streamAvailable === false && snapshot.status === 'busy') throw new Error('Native activity stream unavailable; progress cannot be verified');
    const progress = this.liveProgress.get(sessionId);
    if (progress) { snapshot.activity.push(progress); snapshot.assistantActivity?.push(progress); }
    return snapshot;
  }
  async verifyCompatibility(signal: AbortSignal): Promise<string> {
    const version = await this.verifyVersion(signal);
    const active = object(object(await this.read('/api/session/active', signal)).data);
    for (const state of Object.values(active)) if (object(state).type !== 'running') throw new Error('Unknown V2 execution state');
    const permissions = object(await this.read(`/api/permission/request?directory=${encodeURIComponent(this.options.directory)}`, signal));
    array(permissions.data);
    return version;
  }
  async create(parentSessionId: string, title: string, signal: AbortSignal, selection?: AgentDispatch): Promise<string> {
    if (!selection) throw new Error('V2 Supervisor requires an explicit configured agent');
    const session = object(object(await this.request('/api/session', signal, 'POST', {
      parentID: parentSessionId, title, location: { directory: this.options.directory }, agent: selection.agent,
      model: { providerID: selection.model.providerID, id: selection.model.modelID, ...(selection.variant ? { variant: selection.variant } : {}) },
      permissions: selection.permission.map(rule => ({ action: rule.permission, resource: rule.pattern, effect: rule.action })),
    })).data);
    if (typeof session.id !== 'string' || session.parentID !== parentSessionId) throw new Error('Ambiguous V2 child creation');
    sid(session.id); return session.id;
  }
  async dispatch(childSessionId: string, prompt: string, signal: AbortSignal): Promise<void> {
    const id = `msg_${Date.now().toString(36)}_${randomBytes(10).toString('hex')}`;
    const input = object(object(await this.request(`/api/session/${sid(childSessionId)}/prompt`, signal, 'POST', { id, text: prompt, delivery: 'steer' })).data);
    if (input.id !== id || input.sessionID !== childSessionId || input.type !== 'user' || input.delivery !== 'steer') throw new Error('Ambiguous V2 dispatch admission');
  }
  async abort(sessionId: string, signal: AbortSignal): Promise<void> {
    const result = object(await this.request(`/api/session/${sid(sessionId)}/interrupt?resume=false`, signal, 'POST'));
    if (typeof result.interrupted !== 'boolean') throw new Error('Ambiguous V2 interrupt acknowledgement');
  }
  async notify(): Promise<void> { throw new Error('V2 Supervisor uses inline waiting; notification wake-up dispatch is unavailable'); }
  async ask(context: { sessionID: string; messageID: string; id: string; agent: string; signal: AbortSignal },
    action: string, resources: string[], metadata: ObjectValue = {}): Promise<void> {
    const result = object(object(await this.request(`/api/session/${sid(context.sessionID)}/permission`, context.signal, 'POST', {
      action, resources, save: [], metadata, agent: context.agent,
      source: { type: 'tool', messageID: context.messageID, id: context.id },
    }, 600000)).data);
    if (result.effect !== 'allow') throw new Error('Permission rejected');
  }
  async prepare(parentSessionId: string, messageId: string, caller: string, agent: string, signal: AbortSignal): Promise<AgentDispatch> {
    const scoped = `?directory=${encodeURIComponent(this.options.directory)}`;
    const [catalogValue, configValue, parentValue] = await Promise.all([
      this.read('/api/agent' + scoped, signal), this.read('/api/config' + scoped, signal), this.read(`/api/session/${sid(parentSessionId)}`, signal),
    ]);
    const matches = array(object(catalogValue).data).map(object).filter(item => item.id === agent);
    if (matches.length !== 1 || !['subagent', 'all'].includes(String(matches[0]!.mode))) throw new Error('Unknown or unavailable subagent');
    const selected = matches[0]!, parent = object(object(parentValue).data);
    if (parent.id !== parentSessionId || !this.matchesWorkspace(object(parent.location).directory)) throw new Error('V2 parent scope mismatch');
    let experimental: ObjectValue = {};
    for (const entry of array(configValue).map(object)) if (entry.type === 'document') {
      const info = object(entry.info); if (info.experimental !== undefined) experimental = object(info.experimental);
    }
    const limit = experimental.subagent_depth ?? 1;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid native subagent depth');
    let current = parent, depth = 0; const visited = new Set<string>([parentSessionId]);
    while (current.parentID !== undefined) {
      if (++depth >= limit || typeof current.parentID !== 'string' || visited.has(current.parentID)) throw new Error('Subagent depth/ancestry rejected');
      const id = current.parentID; visited.add(id);
      current = object(object(await this.read(`/api/session/${sid(id)}`, signal)).data);
      if (current.id !== id) throw new Error('Native ancestor identity mismatch');
    }
    let cursor: string | undefined, callerMessage: ObjectValue | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 128; page++) {
      const query = new URLSearchParams({ limit: '200' }); if (cursor) query.set('cursor', cursor); else query.set('order', 'desc');
      const response = object(await this.read(`/api/session/${sid(parentSessionId)}/message?${query}`, signal));
      callerMessage = array(response.data).map(object).find(item => item.id === messageId);
      if (callerMessage) break;
      const next = object(response.cursor).next;
      if (next == null) break;
      if (typeof next !== 'string' || seen.has(next)) throw new Error('Invalid caller transcript cursor');
      seen.add(next); cursor = next;
    }
    if (!callerMessage || callerMessage.type !== 'assistant' || callerMessage.agent !== caller) throw new Error('Native caller identity mismatch');
    const ref = object(selected.model ?? callerMessage.model);
    if (typeof ref.providerID !== 'string' || typeof ref.id !== 'string' || ref.variant !== undefined && typeof ref.variant !== 'string') throw new Error('Invalid native child model');
    const models = array(object(await this.read('/api/model' + scoped, signal)).data).map(object);
    const available = models.find(item => item.providerID === ref.providerID && item.id === ref.id && item.enabled === true);
    if (!available || ref.variant !== undefined && !array(available.variants).map(object).some(item => item.id === ref.variant)) throw new Error('Native child model unavailable');
    const roleRules = nativeRules(selected.permissions), permission = nativeRules(parent.permissions ?? []).filter(rule => rule.action === 'deny' || rule.permission === 'external_directory');
    if (!roleRules.some(rule => rule.permission === 'subagent')) permission.push({ permission: 'subagent', pattern: '*', action: 'deny' });
    const primary = experimental.primary_tools ?? [];
    for (const name of array(primary)) { if (typeof name !== 'string') throw new Error('Invalid native primary tools'); permission.push({ permission: name, pattern: '*', action: 'deny' }); }
    permission.push({ permission: 'supervisor_dispatch', pattern: '*', action: 'deny' });
    return { agent, model: { providerID: ref.providerID, modelID: ref.id }, ...(typeof ref.variant === 'string' ? { variant: ref.variant } : {}), permission };
  }
}
