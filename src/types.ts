import type { AgentDispatch } from './agent-dispatch.ts';
export type Phase = 'registered' | 'dispatching' | 'active' | 'terminal';
export type Health = 'running' | 'waiting_permission' | 'suspected_stall' | 'unreachable' | 'ended' | 'cancel_unknown';
export interface Identity { taskId: string; attemptId: string; parentSessionId: string; childSessionId?: string }
export interface TaskResult {
  messageId: string;
  text: string;
  outcome: 'completed' | 'failed';
  error?: string;
  sourceEventId?: string;
}
export interface Snapshot {
  permissions?: PermissionEvidence[];
  sessionId: string;
  status: 'busy' | 'retry' | 'idle';
  // Stable content fingerprints, not polling timestamps.
  activity: string[];
  assistantActivity: string[];
  permissionIds: string[];
  pendingTools: number;
  terminal?: 'completed' | 'failed';
  process: 'unknown' | 'active' | 'inactive';
  processActivity?: string;
  messageIds?: string[];
  result?: TaskResult;
}
export interface Task extends Identity {
  permissions?: PermissionEvidence[];
  permissionObservation?: 'current' | 'unavailable';
  agent?: string;
  title?: string;
  delivery: 'inline' | 'notification';
  /** Last health alert returned to the parent; repeated waits do not busy-loop. */
  monitorAlert?: Health;
  phase: Phase;
  health: Health;
  createdAt: number;
  lastProgressAt: number;
  lastCheckedAt?: number;
  process: Snapshot['process'];
  outcome?: 'completed' | 'failed';
  reason?: string;
  dispatch: 'not_sent' | 'pending' | 'accepted' | 'unknown';
  cancellation: 'none' | 'requested' | 'acknowledged' | 'unknown';
  seen: Set<string>;
  result?: TaskResult;
}
export interface PermissionEvidence {
  requestId: string; sessionId: string; permission: string; patterns: string[];
  tool?: string; callId?: string; messageId?: string; input?: string;
  state: 'pending' | 'expired' | 'unknown';
}
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
export interface Api {
  create(parentSessionId: string, title: string, signal: AbortSignal, selection?: AgentDispatch): Promise<string>;
  dispatch(childSessionId: string, prompt: string, signal: AbortSignal, selection?: AgentDispatch): Promise<void>;
  observe(sessionId: string, signal: AbortSignal): Promise<Snapshot>;
  abort(sessionId: string, signal: AbortSignal): Promise<void>;
  notify(sessionId: string, text: string, signal: AbortSignal, messageId?: string): Promise<void>;
}
