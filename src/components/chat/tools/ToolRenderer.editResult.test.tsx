import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ToolRenderer } from './ToolRenderer';

/*
 * An apply_patch call (the edit tool under its GPT-5 wire name) used to render
 * as raw Parameters: its input is an envelope with no path, and the edit card
 * only knew the replace-mode input. The card now reads the runtime's result
 * details, which every edit mode reports the same way.
 */

const createDiff = (oldStr: string, newStr: string) => [
  ...oldStr.split('\n').map((content) => ({ type: 'removed', content, lineNum: 0 })),
  ...newStr.split('\n').map((content) => ({ type: 'added', content, lineNum: 0 })),
];

const details = {
  diff: '+1|hello\n-3|gone',
  perFileResults: [
    { path: 'src/new.ts', diff: '+1|hello', op: 'create' },
    { path: 'src/from.ts', diff: '-3|gone', op: 'update', move: 'src/to.ts' },
  ],
};

const render = (toolName: string, toolInput: unknown, toolResult: unknown) => renderToStaticMarkup(createElement(ToolRenderer, {
  toolName,
  toolInput,
  toolResult,
  toolId: 'call-1',
  mode: 'input',
  createDiff,
  density: 'detailed',
}));

test('an apply_patch call renders one diff per file the runtime reports, titled by the count', () => {
  const html = render('apply_patch', { input: '*** Begin Patch\n*** Add File: src/new.ts\n+hello\n*** End Patch' }, { content: 'ok', isError: false, toolUseResult: details });

  assert.match(html, /2 files/);
  assert.match(html, /data-testid="edit-result-diffs"/);
  assert.match(html, /src\/new\.ts[\s\S]*?>New</);
  assert.match(html, /src\/to\.ts[\s\S]*?>Renamed</);
  assert.match(html, /hello/);
  assert.match(html, /gone/);
  assert.doesNotMatch(html, /Begin Patch/, 'the envelope is not dumped as parameters');
  assert.match(html, /data-testid="diff-stats"[\s\S]*?\+1[\s\S]*?−1/, 'the folded row still counts the runtime diff');
});

test('a replace-mode edit with details shows the runtime diff, and without them the input pair', () => {
  const input = { path: 'src/a.ts', edits: [{ old_text: 'x = 1', new_text: 'x = 2' }] };
  const withDetails = render('edit', input, { content: 'ok', isError: false, toolUseResult: { path: '/repo/src/a.ts', diff: ' 4|before\n-5|x = 1\n+5|x = 2' } });
  assert.match(withDetails, /data-testid="edit-result-diffs"/);
  assert.match(withDetails, /before/, 'context the runtime kept is shown');

  const running = render('edit', input, undefined);
  assert.doesNotMatch(running, /data-testid="edit-result-diffs"/);
  assert.match(running, /x = 1[\s\S]*x = 2/, 'the proposed replacement is shown while the call runs');
});
