import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

// Invoke on the concrete npm-pack artifact after tests; never uploads or publishes.
const artifact = process.argv[2];
const nativeCommit = process.argv[3];
if (!artifact) throw new Error('Supply the npm pack .tgz artifact');
if (!nativeCommit || !/^[a-f0-9]{40}$/.test(nativeCommit)) throw new Error('Supply the published native distribution commit');
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const name = `opencode-task-supervisor-${manifest.version}.tgz`;
if (basename(artifact) !== name || manifest.exports?.['./server'] !== './dist/plugin-v2.js') throw new Error('Unexpected release artifact or native entrypoint');
const bytes = await readFile(artifact), sha256 = createHash('sha256').update(bytes).digest('hex');
const output = join(dirname(resolve(artifact)), `opencode-task-supervisor-${manifest.version}.protocols.json`);
await writeFile(output, JSON.stringify({ schemaVersion: 1, version: manifest.version, protocols: ['v1', 'v2'],
    nativePackage: `git+https://github.com/Shiyong-Tan/opencode-task-supervisor.git#package-v${manifest.version}`, nativeCommit,
    packageUrl: `https://github.com/Shiyong-Tan/opencode-task-supervisor/releases/download/v${manifest.version}/${name}`, sha256 }, null, 2) + '\n');
console.log(JSON.stringify({ artifact: resolve(artifact), manifest: output, sha256 }));
