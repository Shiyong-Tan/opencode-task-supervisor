import { type TodoState } from './todo-protocol.ts';
/** One serialized persistent owner per authenticated workspace runtime. */
export declare class SessionTodos {
    private readonly directory;
    private readonly pending;
    private constructor();
    static create(privateDirectory: string): Promise<SessionTodos>;
    private path;
    private load;
    private serial;
    read(sessionId: string): Promise<TodoState>;
    write(sessionId: string, expectedRevision: number, items: unknown): Promise<TodoState>;
}
