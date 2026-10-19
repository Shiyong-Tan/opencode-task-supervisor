import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewPlan, usefulActivity } from '../src/process-review.ts';
import type { JobSample } from '../src/job-client.ts';

test('review deadline uses estimate or first check, whichever comes first; unknown gets a bounded default', () => {
  assert.equal(reviewPlan({}, 100).dueAt, 600100);
  assert.equal(reviewPlan({ estimatedDurationMs: 2000, estimateReason: 'Measured prior run', checkAfterMs: 9000 }, 100).dueAt, 2100);
  assert.equal(reviewPlan({ estimatedDurationMs: 9000, estimateReason: 'Measured prior run', checkAfterMs: 2000 }, 100).dueAt, 2100);
  assert.throws(() => reviewPlan({ estimatedDurationMs: 2000 }, 0), /estimateReason/);
  for (const checkAfterMs of [NaN, Infinity, 0, 1000.5, 86400001]) assert.throws(() => reviewPlan({ checkAfterMs }, 0));
});

test('CPU threshold accumulates; output/write activity counts but liveness and read probes do not', () => {
  const base = { cpu100ns: '0', writeBytes: '0', readBytes: '0', stdout: { totalBytes: 0 }, stderr: { totalBytes: 0 } } as JobSample;
  assert.equal(usefulActivity({ ...base, readBytes: '999999', cpu100ns: '9999999' }, base), false);
  assert.equal(usefulActivity({ ...base, cpu100ns: '10000000' }, base), true);
  assert.equal(usefulActivity({ ...base, writeBytes: '1' }, base), true);
  assert.equal(usefulActivity({ ...base, stdout: { ...base.stdout, totalBytes: 1 } }, base), true);
});
