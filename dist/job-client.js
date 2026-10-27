import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
/** One client owns one helper and its unnamed Job. Never attaches to a PID. */
export class JobClient {
    executionId;
    timeoutMs;
    observeOnly;
    host;
    pending = new Map();
    serial = 0;
    buffer = '';
    closed = false;
    exited;
    constructor(helper, executionId, tempDirectory, timeoutMs = 5000, observeOnly = false, runtime) {
        this.executionId = executionId;
        this.timeoutMs = timeoutMs;
        this.observeOnly = observeOnly;
        const env = observeOnly ? { ...process.env } : { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
            TEMP: tempDirectory, TMP: tempDirectory };
        const flags = observeOnly ? ['--observe'] : [];
        this.host = spawn(runtime ?? resolve(helper), runtime ? [resolve(helper), ...flags] : flags, { env, detached: observeOnly, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        this.exited = new Promise(done => {
            this.host.once('exit', () => { this.fail('Helper exited; stop coverage requires independent evidence'); done(); });
            this.host.once('error', () => { this.fail('Helper launch failed'); done(); });
        });
        this.host.stdin.on('error', () => this.fail('Helper input unavailable'));
        this.host.stderr.resume(); // Never persist native diagnostics or inherited sensitive text.
        this.host.stdout.setEncoding('utf8');
        this.host.stdout.on('data', (chunk) => {
            this.buffer += chunk;
            if (this.buffer.length > 1_000_000) {
                this.fail('Helper response exceeds bound');
                this.buffer = '';
                if (this.observeOnly)
                    void this.close();
                else
                    this.host.kill();
                return;
            }
            let index;
            while ((index = this.buffer.indexOf('\n')) >= 0) {
                const line = this.buffer.slice(0, index);
                this.buffer = this.buffer.slice(index + 1);
                try {
                    const reply = JSON.parse(line), pending = this.pending.get(reply.id);
                    if (!pending)
                        continue; // Expired responses never become current evidence.
                    clearTimeout(pending.timer);
                    this.pending.delete(reply.id);
                    if (!reply.ok) {
                        pending.reject(new Error(`Job operation rejected: ${reply.error}; API ${reply.api ?? 'unknown'}; Win32 ${reply.win32}`));
                        continue;
                    }
                    if (reply.result?.executionId !== executionId) {
                        pending.reject(new Error('Execution identity mismatch'));
                        continue;
                    }
                    pending.resolve(reply.result);
                }
                catch {
                    this.fail('Invalid helper protocol');
                    this.buffer = '';
                    if (this.observeOnly)
                        void this.close();
                    else
                        this.host.kill();
                    return;
                }
            }
        });
    }
    fail(reason) {
        this.closed = true;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(reason));
        }
        this.pending.clear();
    }
    call(op, args = {}) {
        if (this.closed)
            return Promise.reject(new Error('Helper unavailable'));
        if (this.pending.size >= 8)
            return Promise.reject(new Error('Too many pending Job requests'));
        const id = ++this.serial;
        const request = JSON.stringify({ ...args, id, op, executionId: this.executionId });
        if (request.length > 32768)
            return Promise.reject(new Error('Job request exceeds bound'));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Job request timed out; outcome unknown'));
                if (op === 'start')
                    void this.close(); // Lab closes its Job; observation mode detaches with an unknown outcome.
            }, this.timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.host.stdin.write(request + '\n');
        });
    }
    async close() {
        this.fail('Job client closed; no automatic recovery');
        this.host.stdin.end();
        if (this.observeOnly) {
            this.host.stdout.destroy();
            this.host.stderr.destroy();
            this.host.unref();
            return false; // Detached drainer exits when its own Job completes; no stop claim.
        }
        let timer;
        await Promise.race([this.exited, new Promise(done => { timer = setTimeout(done, 1000); })]);
        clearTimeout(timer);
        if (this.host.exitCode === null && this.host.signalCode === null) {
            if (!this.observeOnly)
                this.host.kill(); // Only the handle created by this client. Job kill-on-close applies.
            await Promise.race([this.exited, new Promise(done => { timer = setTimeout(done, 1000); })]);
            clearTimeout(timer);
        }
        return this.host.exitCode !== null || this.host.signalCode !== null;
    }
}
