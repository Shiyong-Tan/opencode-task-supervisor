export function reviewDelay(value) {
    if (!Number.isSafeInteger(value) || value < 1000 || value > 86_400_000)
        throw new Error('Review interval must be 1000..86400000 ms');
    return value;
}
export function reviewText(value) {
    if (!value.trim() || value.length > 1000 || value.includes('\0'))
        throw new Error('Review explanation must be nonempty and at most 1000 characters');
    return value.trim();
}
export function reviewPlan(plan, now) {
    const estimate = plan.estimatedDurationMs === undefined ? undefined : reviewDelay(plan.estimatedDurationMs);
    if (estimate !== undefined && !plan.estimateReason)
        throw new Error('Estimated duration requires estimateReason');
    return { estimatedDurationMs: estimate,
        estimateReason: plan.estimateReason ? reviewText(plan.estimateReason) : 'Unknown; inspect at the default ten-minute checkpoint',
        progressExpectation: plan.progressExpectation ? reviewText(plan.progressExpectation) : 'Inspect output, owned process tree and task-specific progress before extending',
        dueAt: now + Math.min(estimate ?? Infinity, reviewDelay(plan.checkAfterMs ?? 600_000)), count: 0, needed: false };
}
/** Tiny polling CPU and read-only filesystem probes are not useful progress.
 * CPU is accumulated from the last useful sample so short real work still counts.
 * These are activity signals, never proof of business progress. */
export function usefulActivity(sample, baseline) {
    return BigInt(sample.cpu100ns) - BigInt(baseline.cpu100ns) >= 10000000n ||
        BigInt(sample.writeBytes) > BigInt(baseline.writeBytes) ||
        sample.stdout.totalBytes > baseline.stdout.totalBytes || sample.stderr.totalBytes > baseline.stderr.totalBytes;
}
