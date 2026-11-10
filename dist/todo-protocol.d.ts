export interface TodoItem {
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'high' | 'medium' | 'low';
}
export interface TodoState {
    sessionId: string;
    revision: number;
    items: TodoItem[];
}
export declare function parseTodoState(value: unknown): TodoState;
