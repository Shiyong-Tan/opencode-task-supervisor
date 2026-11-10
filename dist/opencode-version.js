export function isOpenCodeVersion(value) {
    return typeof value === 'string' && value.length <= 128 && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z._+-]+)?$/.test(value);
}
export function parseOpenCodeVersion(value) {
    if (!isOpenCodeVersion(value))
        throw new Error('Invalid OpenCode health version label');
    return value;
}
