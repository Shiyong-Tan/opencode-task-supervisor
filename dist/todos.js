import { mkdir, realpath, open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseTodoState } from "./todo-protocol.js";
/** One serialized persistent owner per authenticated workspace runtime. */
export class SessionTodos {
    directory;
    pending = new Map();
    constructor(directory) {
        this.directory = directory;
    }
    static async create(privateDirectory) {
        const directory = join(privateDirectory, 'todos');
        await mkdir(directory, { recursive: true, mode: 0o700 });
        if (await realpath(directory) !== directory)
            throw new Error('Todo storage redirects');
        return new SessionTodos(directory);
    }
    path(sessionId) {
        parseTodoState({ sessionId, revision: 0, items: [] });
        return join(this.directory, `${sessionId}.json`);
    }
    async load(sessionId) {
        let file;
        try {
            const target = this.path(sessionId);
            if (await realpath(target) !== target)
                throw new Error('Todo file redirects');
            file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return { sessionId, revision: 0, items: [] };
            throw error;
        }
        try {
            if (!(await file.stat()).isFile() || (await file.stat()).size > 262144)
                throw new Error('Invalid todo file');
            const state = parseTodoState(JSON.parse(await file.readFile('utf8')));
            if (state.sessionId !== sessionId)
                throw new Error('Foreign todo session');
            return state;
        }
        finally {
            await file.close();
        }
    }
    serial(sessionId, operation) {
        this.path(sessionId);
        const work = (this.pending.get(sessionId) ?? Promise.resolve()).catch(() => undefined).then(operation);
        this.pending.set(sessionId, work);
        void work.finally(() => { if (this.pending.get(sessionId) === work)
            this.pending.delete(sessionId); }).catch(() => undefined);
        return work;
    }
    read(sessionId) { return this.serial(sessionId, () => this.load(sessionId)); }
    write(sessionId, expectedRevision, items) {
        const next = parseTodoState({ sessionId, revision: expectedRevision + 1, items });
        return this.serial(sessionId, async () => {
            const current = await this.load(sessionId);
            if (expectedRevision !== current.revision)
                throw new Error('Todo revision conflict; read the current list before updating');
            const target = this.path(sessionId), temporary = `${target}.${randomUUID()}.tmp`;
            const file = await open(temporary, 'wx', 0o600);
            try {
                await file.writeFile(JSON.stringify(next));
                await file.sync();
                await file.close();
                await rename(temporary, target);
            }
            catch (error) {
                await file.close().catch(() => undefined);
                await unlink(temporary).catch(() => undefined);
                throw error;
            }
            return next;
        });
    }
}
