interface Registration {
    dispose(): Promise<void>;
}
interface NativeToolContext {
    sessionID: string;
    messageID: string;
    id: string;
    agent: string;
    signal: AbortSignal;
    progress(value: Record<string, unknown>): Promise<void>;
}
interface NativeTool {
    name: string;
    description: string;
    input: unknown;
    options: {
        codemode: false;
    };
    execute(input: unknown, context: NativeToolContext): Promise<{
        content: string;
        metadata?: Record<string, unknown>;
    }>;
}
interface NativeContext {
    app: {
        version: string;
    };
    location: {
        directory: string;
    };
    options: Record<string, unknown>;
    tool: {
        transform(callback: (editor: {
            add(tool: NativeTool): void;
        }) => void): Promise<Registration>;
    };
    event?: {
        subscribe(options: {
            signal: AbortSignal;
        }): AsyncIterable<unknown>;
    };
}
/** Native V2 plugin object. The old package's tool subpath is only its Zod schema helper;
 * no V1 loader, SDK client, event hook or permission context is used here. */
declare const _default: {
    id: string;
    server: import("@opencode-ai/plugin").Plugin;
    setup(context: NativeContext): Promise<() => Promise<void>>;
};
export default _default;
