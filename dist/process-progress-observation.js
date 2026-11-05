/** A wait's display clock is not agent progress. Preserve all other evidence. */
export function withoutProcessWaitPresentation(part) {
    if (part.type !== 'tool' || (part.name ?? part.tool) !== 'supervisor_process_wait' ||
        !part.state || typeof part.state !== 'object' || Array.isArray(part.state))
        return part;
    const state = { ...part.state };
    delete state.title;
    if (state.metadata && typeof state.metadata === 'object' && !Array.isArray(state.metadata)) {
        const metadata = { ...state.metadata };
        delete metadata.title;
        if (Object.keys(metadata).length)
            state.metadata = metadata;
        else
            delete state.metadata;
    }
    return { ...part, state };
}
