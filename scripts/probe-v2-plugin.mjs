import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, writeFile, cp, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { canonicalWorkspace, serviceAuthenticationProof, verifyConnectionLease, bridgeBearer } from '../dist/normal-connection-protocol.js';

const binary = process.argv[2];
if (!binary || !isAbsolute(binary)) throw new Error('Supply the absolute isolated V2 executable');
const root = await realpath(await mkdtemp(join(tmpdir(), 'supervisor-v2-probe-')));
for (const name of ['workspace', 'home', 'config', 'data', 'cache', 'state', 'tmp', 'private']) await mkdir(join(root, name));
const directory = await realpath(join(root, 'workspace')), privateDirectory = await realpath(join(root, 'private'));
const configDirectory = join(root, 'config', 'opencode'); await mkdir(configDirectory);
const pluginDirectory = join(root, 'plugin'); await mkdir(pluginDirectory);
await cp(fileURLToPath(new URL('../dist', import.meta.url)), join(pluginDirectory, 'dist'), { recursive: true });
await cp(fileURLToPath(new URL('../server.js', import.meta.url)), join(pluginDirectory, 'server.js'));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await writeFile(join(pluginDirectory, 'package.json'), JSON.stringify({ ...manifest, main: './dist/plugin-v2.js', exports: './dist/plugin-v2.js' }));
await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(pluginDirectory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
await writeFile(join(configDirectory, 'opencode.json'), JSON.stringify({ plugins: [{
    package: pathToFileURL(pluginDirectory).href,
    options: { allowDispatch: false, allowNotifications: false, normalGui: { enabled: true } },
}] }));
const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const password = randomBytes(32).toString('hex'), authorization = 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64');
const binding = { integrationId: randomBytes(32).toString('hex'), serviceId: randomBytes(32).toString('hex'),
    workspace: canonicalWorkspace(directory), serviceOrigin: `http://127.0.0.1:${port}` };
const launchKey = randomBytes(32).toString('hex');
const launch = { schemaVersion: 1, kind: 'normal-gui-launch', binding, launchKey, identityKey: randomBytes(32).toString('hex'),
    privateDirectory, authenticationProof: serviceAuthenticationProof(launchKey, binding, authorization) };
const env = { ...process.env };
for (const name of Object.keys(env)) if (/^OPENCODE_|TOKEN|SECRET|API_KEY|PASSWORD|CREDENTIAL|^AWS_/i.test(name)) delete env[name];
Object.assign(env, { OPENCODE_TEST_HOME: join(root, 'home'), OPENCODE_CONFIG_DIR: configDirectory,
    XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'),
    TMPDIR: join(root, 'tmp'), TEMP: join(root, 'tmp'), TMP: join(root, 'tmp'), OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_GUI_SUPERVISOR_BINDING: JSON.stringify(launch), OPENCODE_DISABLE_AUTOUPDATE: 'true' });
const child = spawn(binary, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
    cwd: directory, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '', spawnError;
const capture = bytes => { logs = (logs + bytes.toString()).slice(-65536); };
child.stdout.on('data', capture); child.stderr.on('data', capture); child.once('error', error => { spawnError = error; });
const ended = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
try {
    const deadline = Date.now() + 25000; let lease;
    while (Date.now() < deadline && child.exitCode === null && !spawnError) {
        // V2 loads a location lazily; a server listener alone does not initialize its plugins.
        try { await fetch(`${binding.serviceOrigin}/api/agent?directory=${encodeURIComponent(directory)}`, {
            headers: { Authorization: authorization }, signal: AbortSignal.timeout(1000),
        }); } catch { /* Only the new isolated service is probed. */ }
        try { lease = verifyConnectionLease(JSON.parse(await readFile(join(privateDirectory, `${binding.serviceId}.json`), 'utf8')), binding, launchKey, Date.now()); break; }
        catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    if (!lease) {
        await writeFile(join(root, 'startup.log'), logs.replaceAll(password, '[fixture password]').replace(/server password \S+/g, 'server password [redacted]'), { mode: 0o600 });
        throw new Error(`V2 plugin lease was not published. Isolated startup evidence: ${join(root, 'startup.log')}`);
    }
    const token = bridgeBearer(launchKey, binding, lease.instanceId);
    const response = await fetch(`${lease.bridgeOrigin}/v1/snapshot?parentSessionId=ses_fixture`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Native plugin snapshot HTTP ${response.status}`);
    const snapshot = await response.json();
    if (JSON.stringify(snapshot).includes(password)) throw new Error('Credentials appeared in plugin projection');
    console.log(JSON.stringify({ verified: true, opencodeVersion: lease.opencodeVersion, pluginVersion: lease.pluginVersion,
        modelCalls: 0, leaseAndSnapshot: true, isolatedProfile: root }));
} finally { if (child.exitCode === null && !spawnError) child.kill(); await ended; }
