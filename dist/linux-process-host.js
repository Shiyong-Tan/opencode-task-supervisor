import { spawn, execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { constants } from 'node:os';
import { processEnvironment } from "./process-environment.js";
// Linux evidence covers the newly created process group, not a Windows-style containment boundary.
const hz = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
const pageSize = Number(execFileSync('getconf', ['PAGESIZE'], { encoding: 'utf8' }).trim());
if (!Number.isSafeInteger(hz) || hz <= 0 || !Number.isSafeInteger(pageSize))
    throw new Error('Invalid Linux accounting units');
export function parseStat(value) {
    const end = value.lastIndexOf(')');
    const fields = value.slice(end + 2).trim().split(/\s+/);
    if (end < 0 || fields.length < 22)
        throw new Error('Invalid proc stat');
    return { state: fields[0], group: Number(fields[2]), start: fields[19],
        cpu: (BigInt(fields[11]) + BigInt(fields[12])) * 10000000n / BigInt(hz), memory: BigInt(fields[21]) * BigInt(pageSize) };
}
let child;
let executionId = '', creation = '', rootExited = false, exitCode = null, sequence = 0;
let inputClosed = false, stdoutEnded = false, stderrEnded = false;
const accounting = new Map();
const output = () => ({ text: '', totalBytes: 0, retainedBytes: 0, truncated: false });
const stdout = output(), stderr = output();
function append(target, chunk) {
    target.totalBytes += chunk.length;
    const retained = Buffer.concat([Buffer.from(target.text), chunk]).subarray(-65536);
    target.text = retained.toString('utf8');
    target.retainedBytes = retained.length;
    target.truncated = target.totalBytes > target.retainedBytes;
}
async function sample() {
    if (!child?.pid)
        throw new Error('No owned process');
    let incomplete = !creation, memory = 0n;
    const members = [];
    for (const name of await readdir('/proc')) {
        if (!/^\d+$/.test(name))
            continue;
        try {
            const stat = parseStat(await readFile(`/proc/${name}/stat`, 'utf8'));
            if (stat.group !== child.pid)
                continue;
            if (Number(name) === child.pid && creation && stat.start !== creation) {
                incomplete = true;
                continue;
            }
            const key = `${name}:${stat.start}`;
            const prior = accounting.get(key) ?? { cpu: 0n, read: 0n, write: 0n };
            let read = prior.read, write = prior.write;
            try {
                const io = await readFile(`/proc/${name}/io`, 'utf8');
                read = BigInt(io.match(/^read_bytes:\s*(\d+)/m)?.[1] ?? '0');
                write = BigInt(io.match(/^write_bytes:\s*(\d+)/m)?.[1] ?? '0');
            }
            catch {
                incomplete = true;
            }
            accounting.set(key, { cpu: stat.cpu > prior.cpu ? stat.cpu : prior.cpu, read: read > prior.read ? read : prior.read, write: write > prior.write ? write : prior.write });
            if (stat.state !== 'Z' && stat.state !== 'X') {
                memory += stat.memory;
                members.push({ pid: Number(name), creationFileTime: stat.start, alive: true, cpu100ns: stat.cpu.toString() });
            }
        }
        catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ESRCH')
                incomplete = true;
        }
    }
    // Open inherited output pipes after group disappearance can indicate an escaped descendant.
    if (rootExited && !members.length && (!stdoutEnded || !stderrEnded))
        incomplete = true;
    const totals = [...accounting.values()].reduce((sum, value) => ({ cpu: sum.cpu + value.cpu, read: sum.read + value.read, write: sum.write + value.write }), { cpu: 0n, read: 0n, write: 0n });
    return { executionId, sequence: ++sequence, observedAt: new Date().toISOString(), rootPid: child.pid,
        rootCreationFileTime: creation || '0', rootExited, exitCode, activeProcesses: members.length, members,
        cpu100ns: totals.cpu.toString(), readBytes: totals.read.toString(), writeBytes: totals.write.toString(), workingSetBytes: memory.toString(),
        requestAccepted: false, ownedProcessesStopped: rootExited && !members.length && !incomplete,
        coverageUnknown: incomplete, cancelOutcomeUnknown: false, stdout: { ...stdout }, stderr: { ...stderr },
        scope: 'linux_owned_process_group; descendants that leave the group are not contained; never infer safe retry' };
}
async function start(args) {
    if (child || typeof args.executable !== 'string' || typeof args.cwd !== 'string' || !Array.isArray(args.args) || !args.args.every(arg => typeof arg === 'string'))
        throw new Error('Invalid or duplicate launch');
    executionId = String(args.executionId);
    child = spawn(args.executable, args.args, { cwd: args.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...processEnvironment(args.env) } });
    child.stdout.on('data', chunk => append(stdout, chunk));
    child.stderr.on('data', chunk => append(stderr, chunk));
    child.stdout.on('end', () => { stdoutEnded = true; });
    child.stderr.on('end', () => { stderrEnded = true; });
    child.stdin.on('error', () => { });
    child.stdin.end();
    child.once('exit', (code, signal) => { rootExited = true; exitCode = code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : null); });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    try {
        creation = parseStat(await readFile(`/proc/${child.pid}/stat`, 'utf8')).start;
    }
    catch { /* Fast exit has incomplete birth evidence. */ }
    return sample();
}
let chain = Promise.resolve();
const input = createInterface({ input: process.stdin });
input.on('line', line => {
    chain = chain.then(async () => {
        let id;
        try {
            if (line.length > 32768)
                throw new Error('Request exceeds bound');
            const request = JSON.parse(line);
            id = request.id;
            if (child && request.executionId !== executionId)
                throw new Error('Execution identity mismatch');
            const result = request.op === 'start' ? await start(request) : request.op === 'sample' ? await sample() : undefined;
            if (!result)
                throw new Error('Linux transport is observation-only; cancellation is unavailable');
            if (!inputClosed)
                process.stdout.write(JSON.stringify({ id, ok: true, result }) + '\n');
        }
        catch {
            if (!inputClosed)
                process.stdout.write(JSON.stringify({ id, ok: false, error: 'Linux process operation failed' }) + '\n');
        }
    });
});
input.on('close', () => { inputClosed = true; if (!child?.pid)
    process.exit(0); });
// Keep draining after plugin disposal. Do not kill or orphan pipe writers by closing their output.
setInterval(() => {
    if (inputClosed)
        chain = chain.then(async () => {
            try {
                const current = await sample();
                if (rootExited && current.activeProcesses === 0 && stdoutEnded && stderrEnded)
                    process.exit(0);
            }
            catch { /* Unknown means keep observing, never kill. */ }
        });
}, 1000);
