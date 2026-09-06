import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ToolRenderer } from './ToolRenderer';

test('tool cards keep a running badge for metadata-only and nonempty partial results', () => {
  for (const content of ['', 'Already streamed output']) {
    const render = (isFinal: boolean) => renderToStaticMarkup(createElement(ToolRenderer, {
      toolName: 'bash', toolInput: { command: 'pwd' }, mode: 'input', density: 'detailed',
      toolResult: { content, isError: false, isFinal, toolUseResult: { terminalId: 'terminal-1' } },
    }));
    assert.match(render(false), />Running</);
    assert.doesNotMatch(render(true), />Running</);
  }
});
