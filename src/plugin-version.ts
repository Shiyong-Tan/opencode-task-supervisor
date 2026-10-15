import { readFileSync } from 'node:fs';

/** Package metadata is the single version owner for leases and task projections. */
export const pluginVersion: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
if (!/^0\.1\.\d+$/.test(pluginVersion)) throw new Error('Unsupported Supervisor protocol version');
