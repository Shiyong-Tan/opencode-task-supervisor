export function waitMode(value) {
    if (value === undefined)
        return 'until_attention';
    if (value === 'until_attention' || value === 'checkpoint')
        return value;
    throw new Error('Invalid wait mode');
}
