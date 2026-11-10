import type { Clock } from './types.ts';
export declare const clock: Clock;
export declare function bounded<T>(clock: Clock, ms: number, operation: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T>;
