import type { JobSample } from './job-client.ts';
export interface ProcessReviewPlan {
    estimatedDurationMs?: number;
    estimateReason?: string;
    checkAfterMs?: number;
    progressExpectation?: string;
}
export interface ProcessReview {
    estimatedDurationMs?: number;
    estimateReason: string;
    progressExpectation: string;
    dueAt: number;
    count: number;
    lastDecision?: string;
    needed: boolean;
}
export declare function reviewDelay(value: number): number;
export declare function reviewText(value: string): string;
export declare function reviewPlan(plan: ProcessReviewPlan, now: number): ProcessReview;
/** Tiny polling CPU and read-only filesystem probes are not useful progress.
 * CPU is accumulated from the last useful sample so short real work still counts.
 * These are activity signals, never proof of business progress. */
export declare function usefulActivity(sample: JobSample, baseline: JobSample): boolean;
