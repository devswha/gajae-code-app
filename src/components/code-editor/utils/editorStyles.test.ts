import assert from 'node:assert/strict';
import test from 'node:test';

import { getEditorFontSizeTheme } from './editorStyles';

test('code editor font-size setting reaches editor content and gutters', () => {
  assert.deepEqual(getEditorFontSizeTheme(18), {
    '&': { fontSize: '18px' },
    '.cm-content': { fontSize: 'inherit' },
    '.cm-gutters': { fontSize: 'inherit' },
  });
});
