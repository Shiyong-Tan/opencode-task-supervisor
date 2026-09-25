/** Human presentation only. Ownership stays in task/attempt/session IDs. */
export function taskTitle(description?: string, agent?: string): string {
  const clean = description?.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  const characters = Array.from(clean || 'Supervised task');
  const label = characters.length > 120 ? characters.slice(0, 119).join('') + '…' : characters.join('');
  return label + (agent ? ` (@${agent} subagent)` : '');
}
