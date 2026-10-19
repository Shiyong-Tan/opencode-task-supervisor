import type { Execution } from './executions.ts';

/** Bounded display evidence only: no output, command arguments or environment. */
export function processProgress(value: Execution, now: number): string {
  const parts: string[] = [];
  if (value.startedAt !== undefined) {
    const seconds = Math.floor(Math.max(0, (value.finishedAt ?? now) - value.startedAt) / 1000);
    parts.push(`Elapsed ${Math.floor(seconds / 60)}m ${seconds % 60}s`);
  }
  const fresh = value.lastObservedAt !== undefined && now >= value.lastObservedAt && now - value.lastObservedAt <= 5000;
  if (!fresh || value.health === 'unknown' || value.sample?.coverageUnknown) parts.push('Observation uncertain');
  else if (value.phase === 'stopped') parts.push(`Exited ${value.sample?.exitCode ?? 'unknown'}`);
  else {
    if (value.cpuPercent !== undefined && Number.isFinite(value.cpuPercent)) parts.push(`CPU ${value.cpuPercent.toFixed(1)}%`);
    if (value.sample) parts.push(`${value.sample.activeProcesses} live processes`);
    if (value.health === 'suspect') parts.push(value.review?.needed ? 'Review due' : 'No useful progress');
  }
  return parts.join(' · ');
}
