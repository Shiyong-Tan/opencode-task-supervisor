import { test } from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../src/plugin.ts';
import { canonicalWorkspace, signConnectionLease, verifyConnectionLease, type ConnectionLease } from '../src/normal-connection-protocol.ts';
import { supportsProcessTracking } from '../src/platform-capabilities.ts';

test('POSIX signed bindings preserve case and reject alias/traversal paths', () => {
  assert.equal(canonicalWorkspace('/Users/A/Work/'), '/Users/A/Work');
  assert.equal(canonicalWorkspace('/'), '/');
  assert.equal(canonicalWorkspace('D:/Trial'), 'd:/trial');
  for (const path of ['relative', '//server/share', '/a/../b', '/a//b', '/a/./b']) assert.throws(() => canonicalWorkspace(path));
  const lease: ConnectionLease = { schemaVersion: 1, kind: 'normal-gui', integrationId: '11'.repeat(32), serviceId: '22'.repeat(32), workspace: '/Users/A/Work', serviceOrigin: 'http://127.0.0.1:42001', instanceId: '33'.repeat(32), bridgeOrigin: 'http://127.0.0.1:42002', opencodeVersion: '1.18.31', pluginVersion: '0.1.0', issuedAt: 1000, expiresAt: 2000 };
  const signed = signConnectionLease(lease, '44'.repeat(32));
  assert.deepEqual(verifyConnectionLease(signed, lease, '44'.repeat(32), 1500), lease);
  assert.throws(() => verifyConnectionLease(signed, { ...lease, workspace: '/users/a/work' }, '44'.repeat(32), 1500));
});

test('Linux and macOS retain task tools without initializing native process tools', async () => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  try {
    for (const platform of ['linux', 'darwin'] as const) {
      Object.defineProperty(process, 'platform', { ...original, value: platform });
      assert.equal(supportsProcessTracking(platform), false);
      const runtime = await plugin({ directory: '/nonexistent/no-native-helper', serverUrl: new URL('http://127.0.0.1:42001') } as Parameters<typeof plugin>[0], {});
      try {
        for (const name of ['supervisor_register', 'supervisor_dispatch', 'supervisor_status', 'supervisor_wait', 'supervisor_result']) assert.ok(runtime.tool?.[name]);
        for (const name of ['supervisor_run', 'supervisor_process_status', 'supervisor_process_wait']) assert.equal(runtime.tool?.[name], undefined);
      } finally { await (runtime as typeof runtime & { dispose(): Promise<void> }).dispose(); }
    }
  } finally { Object.defineProperty(process, 'platform', original); }
  assert.equal(supportsProcessTracking('win32'), true);
});
