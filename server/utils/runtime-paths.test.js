import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { getBundledExecutablePath } from './runtime-paths.js';

test('bundled executables use Windows suffixes in source and packaged server layouts', () => {
  const root = path.resolve('app with spaces');
  for (const source of ['server/gjc-worker-client.ts', 'dist-server/server/gjc-worker-client.js',
    'server/modules/automation/browser-sidecar-client.ts', 'dist-server/server/modules/automation/browser-sidecar-client.js']) {
    const url = pathToFileURL(path.join(root, source)).href;
    assert.equal(getBundledExecutablePath(url, 'bun', 'win32'), path.join(root, 'dist-native', 'bun.exe'));
    assert.equal(getBundledExecutablePath(url, 'gajae-core', 'win32'), path.join(root, 'dist-native', 'gajae-core.exe'));
    assert.equal(getBundledExecutablePath(url, 'bun', 'linux'), path.join(root, 'dist-native', 'bun'));
    assert.equal(getBundledExecutablePath(url, 'bun', 'darwin'), path.join(root, 'dist-native', 'bun'));
  }
});
