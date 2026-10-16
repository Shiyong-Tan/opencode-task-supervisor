import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

// Invoke on the concrete npm-pack artifact after tests; never uploads or publishes.
const artifact = process.argv[2];
if (!artifact) throw new Error('Supply the npm pack .tgz artifact');
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const name = `opencode-task-supervisor-${manifest.version}.tgz`;
if (basename(artifact) !== name || manifest.exports?.['./server'] !== './dist/plugin-v2.js') throw new Error('Unexpected release artifact or native entrypoint');
const bytes = await readFile(artifact), sha256 = createHash('sha256').update(bytes).digest('hex');
const output = join(dirname(resolve(artifact)), `opencode-task-supervisor-${manifest.version}.protocols.json`);
await writeFile(output, JSON.stringify({ schemaVersion: 1, version: manifest.version, protocols: ['v1', 'v2'],
    packageUrl: `https://github.com/Shiyong-Tan/opencode-task-supervisor/releases/download/v${manifest.version}/${name}`, sha256 }, null, 2) + '\n');
console.log(JSON.stringify({ artifact: resolve(artifact), manifest: output, sha256 }));
