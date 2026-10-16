import test from 'node:test';
import assert from 'node:assert/strict';
import { processEnvironment } from '../src/process-environment.ts';

test('per-child overrides retain Unicode, empty strings and do not mutate service environment', () => {
  const before = process.env.TMP;
  const input = { TMP: 'project/临时', EMPTY: '' };
  assert.deepEqual(processEnvironment(input), input);
  assert.notEqual(processEnvironment(input), input);
  assert.equal(process.env.TMP, before);
  assert.equal(processEnvironment(undefined), undefined);
});
test('invalid environment names, NUL, private bootstrap and oversized overrides fail before launch', () => {
  for (const input of [null, [], { 'A=B': 'x' }, { KEY: 'x\0' }, { OPENCODE_GUI_SUPERVISOR_BINDING: 'x' },
    { KEY: 7 }, { KEY: 'x'.repeat(8193) }, Object.fromEntries(Array.from({ length: 33 }, (_, i) => ['K' + i, 'x']))])
    assert.throws(() => processEnvironment(input));
  if (process.platform === 'win32') assert.throws(() => processEnvironment({ TMP: 'a', tmp: 'b' }));
});
