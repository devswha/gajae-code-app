import assert from 'node:assert/strict';
import test from 'node:test';

import { CUA_SAFE_TOOLS, isCuaSafeTool } from './cua-client.js';

test('CUA allowlist includes reviewed inspection and action tools only', () => {
  assert.equal(isCuaSafeTool('get_window_state'), true);
  assert.equal(isCuaSafeTool('set_window_frame'), true);
  assert.equal(isCuaSafeTool('kill_app'), false);
  assert.equal(isCuaSafeTool('clipboard_read'), false);
  assert.equal(isCuaSafeTool('start_recording'), false);
  assert.equal(new Set(CUA_SAFE_TOOLS).size, CUA_SAFE_TOOLS.length);
});
