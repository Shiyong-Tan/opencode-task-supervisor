/** Per-child overrides only; never mutate the service/helper environment. */
export function processEnvironment(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid process environment');
  const entries = Object.entries(value), seen = new Set<string>();
  if (entries.length > 32 || JSON.stringify(value).length > 8192) throw new Error('Process environment exceeds bound');
  for (const [key, item] of entries) {
    const identity = process.platform === 'win32' ? key.toUpperCase() : key;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof item !== 'string' || item.includes('\0') ||
      key.toUpperCase().startsWith('OPENCODE_GUI_') || seen.has(identity)) throw new Error('Invalid process environment entry');
    seen.add(identity);
  }
  return Object.fromEntries(entries);
}
