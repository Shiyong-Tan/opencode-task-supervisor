import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Publish compiled Git payloads without touching the source repository's index.
const repository = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const archive = resolve(process.argv[2] || '');
if (basename(archive) !== `opencode-task-supervisor-${manifest.version}.tgz`) throw new Error('Matching npm-pack archive required');
const root = await realpath(await mkdtemp(join(tmpdir(), 'supervisor-distribution-')));
try {
  const members = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
  if (members.some(name => !name.startsWith('package/') || name.includes('\\') || name.split('/').includes('..'))) throw new Error('Unexpected package paths');
  execFileSync('tar', ['-xf', archive, '-C', root]);
  const worktree = join(root, 'package'), packageFile = join(worktree, 'package.json');
  const runtime = JSON.parse(await readFile(packageFile, 'utf8'));
  if (runtime.version !== manifest.version || runtime.exports?.['./server'] !== './dist/plugin-v2.js') throw new Error('Native package identity mismatch');
  // Native Git installation must not try to rebuild an already compiled package.
  delete runtime.scripts; delete runtime.devDependencies;
  await writeFile(packageFile, JSON.stringify(runtime, null, 2) + '\n');
  const gitDirectory = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: repository, encoding: 'utf8' }).trim();
  const git = args => execFileSync('git', [`--git-dir=${gitDirectory}`, `--work-tree=${worktree}`, '-c', 'core.autocrlf=false', ...args], {
    cwd: worktree, env: { ...process.env, GIT_INDEX_FILE: join(root, 'index') }, encoding: 'utf8',
  }).trim();
  git(['read-tree', '--empty']); git(['add', '--force', '--all', '--', '.']);
  const tree = git(['write-tree']);
  const identity = process.env.GITHUB_ACTIONS ? ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'] : [];
  const commit = git([...identity, 'commit-tree', tree, '-m', `Distribute compiled Supervisor ${manifest.version}`]);
  const tag = `package-v${manifest.version}`;
  git(['tag', tag, commit]); // Existing tags are never replaced.
  if (process.argv.includes('--push')) git(['push', 'origin', `refs/tags/${tag}`]);
  console.log(JSON.stringify({ nativeCommit: commit, nativePackage: `git+https://github.com/Shiyong-Tan/opencode-task-supervisor.git#${tag}`, tag }));
} finally {
  const base = await realpath(tmpdir());
  if (!root.startsWith(base + sep) || !basename(root).startsWith('supervisor-distribution-')) throw new Error('Invalid temporary cleanup root');
  await rm(root, { recursive: true, force: true });
}
