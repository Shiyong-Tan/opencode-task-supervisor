export function parseTodoState(value) {
    const fail = () => { throw new Error('Invalid Supervisor todo state'); };
    if (!value || typeof value !== 'object')
        return fail();
    const raw = value;
    if (typeof raw.sessionId !== 'string' || !/^ses_[A-Za-z0-9_-]{1,160}$/.test(raw.sessionId)
        || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || !Array.isArray(raw.items) || raw.items.length > 64)
        return fail();
    const ids = new Set();
    const items = raw.items.map((entry) => {
        if (!entry || typeof entry !== 'object')
            return fail();
        const item = entry;
        if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id)
            || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 500 || /[\x00-\x08\x0b-\x1f\x7f]/.test(item.content)
            || !['pending', 'in_progress', 'completed'].includes(String(item.status)) || !['high', 'medium', 'low'].includes(String(item.priority)))
            return fail();
        ids.add(item.id);
        return { id: item.id, content: item.content, status: item.status, priority: item.priority };
    });
    return { sessionId: raw.sessionId, revision: raw.revision, items };
}
