import type { OpenCodeApi } from './opencode-api.ts';

export interface PermissionRule { permission: string; pattern: string; action: 'allow' | 'ask' | 'deny' }
export interface AgentDispatch {
  agent: string;
  model: { providerID: string; modelID: string };
  variant?: string;
  permission: PermissionRule[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid agent dispatch response');
  return value as Record<string, unknown>;
}
function rules(value: unknown): PermissionRule[] {
  if (!Array.isArray(value)) throw new Error('Invalid agent permission rules');
  return value.map(item => {
    const rule = record(item);
    if (typeof rule.permission !== 'string' || typeof rule.pattern !== 'string' ||
      !['allow', 'ask', 'deny'].includes(String(rule.action))) throw new Error('Invalid agent permission rule');
    return { permission: rule.permission, pattern: rule.pattern, action: rule.action as PermissionRule['action'] };
  });
}
function model(value: unknown): AgentDispatch['model'] {
  const item = record(value);
  if (typeof item.providerID !== 'string' || !item.providerID || typeof item.modelID !== 'string' || !item.modelID) {
    throw new Error('Agent dispatch model unavailable');
  }
  return { providerID: item.providerID, modelID: item.modelID };
}

/** Read-only preparation. The plugin must additionally call ctx.ask(task, agent)
 * before handing this plan to the task owner. No kernel internals or config writes. */
export async function prepareAgentDispatch(api: OpenCodeApi, parentSessionId: string, messageId: string,
  callerAgent: string, agent: string, signal: AbortSignal): Promise<AgentDispatch> {
  if (!agent || agent.length > 180 || agent.trim() !== agent || /[\x00-\x1f]/.test(agent)) throw new Error('Invalid agent name');
  const agents: unknown = await api.request('/agent', 'GET', signal);
  if (!Array.isArray(agents)) throw new Error('Agent catalog unavailable');
  const matches = agents.map(record).filter(item => item.name === agent);
  if (matches.length !== 1) throw new Error('Unknown or ambiguous agent');
  const selected = matches[0]!;
  if (selected.mode !== 'subagent' && selected.mode !== 'all') throw new Error('Agent is not available for subagent dispatch');
  const agentRules = rules(selected.permission);
  const config = record(await api.request('/config', 'GET', signal));
  const limit = config.subagent_depth ?? 1;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) throw new Error('Invalid subagent depth limit');
  let currentId = parentSessionId;
  let depth = 0;
  let parent: Record<string, unknown> | undefined;
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(currentId)) throw new Error('Cyclic session ancestry');
    visited.add(currentId);
    const session = record(await api.request(`/session/${encodeURIComponent(currentId)}`, 'GET', signal));
    if (session.id !== currentId) throw new Error('Parent session identity mismatch');
    parent ??= session;
    if (!session.parentID) break;
    if (typeof session.parentID !== 'string') throw new Error('Invalid session ancestry');
    if (++depth >= limit) throw new Error('Subagent depth limit reached');
    currentId = session.parentID;
  }
  const message = record(await api.request(`/session/${encodeURIComponent(parentSessionId)}/message/${encodeURIComponent(messageId)}`, 'GET', signal));
  const info = record(message.info);
  if (info.id !== messageId || info.sessionID !== parentSessionId || info.role !== 'assistant' || info.agent !== callerAgent) {
    throw new Error('Dispatch caller message identity mismatch');
  }
  const selectedModel = selected.model === undefined ? model(info) : model(selected.model);
  const permission = rules(parent.permission ?? []).filter(rule => rule.action === 'deny' || rule.permission === 'external_directory');
  // Match the native task defaults; role permissions are applied by OpenCode.
  for (const name of ['todowrite', 'task']) {
    if (!agentRules.some(rule => rule.permission === name)) permission.push({ permission: name, pattern: '*', action: 'deny' });
  }
  const primaryTools = config.experimental === undefined ? [] : record(config.experimental).primary_tools ?? [];
  if (!Array.isArray(primaryTools) || primaryTools.some(name => typeof name !== 'string')) throw new Error('Invalid primary tool restrictions');
  for (const name of primaryTools as string[]) permission.push({ permission: name, pattern: '*', action: 'deny' });
  // A custom dispatch tool must not bypass the native nested-task guard.
  permission.push({ permission: 'supervisor_dispatch', pattern: '*', action: 'deny' });
  const variant = selected.model === undefined && typeof info.variant === 'string' ? info.variant : undefined;
  return { agent, model: selectedModel, ...(variant ? { variant } : {}), permission };
}
