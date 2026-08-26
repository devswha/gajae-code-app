import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOL_CONFIGS, getToolConfig, rendersCommandRow, shouldHideToolResult } from './toolConfigs';

/*
 * These configs are the app's half of a contract with the runtime: the keys are
 * tool names the runtime sends, and the accessors read parameters from its
 * schemas. `server/gjc-tool-configs.bun.test.ts` checks that half against the
 * live catalog; this file checks that what the accessors build is actually
 * what the renderers need.
 */

test('a shell call is one row, whatever the transcript calls the tool', () => {
  assert.equal(rendersCommandRow('bash'), true);
  assert.equal(rendersCommandRow('Bash'), true);
  assert.equal(rendersCommandRow('read'), false);

  // The command row already carries the output, so the generic result section
  // must not print a second copy of it underneath.
  assert.equal(shouldHideToolResult('bash', { content: 'ok', isError: false }), true);
  // A failure still has to be visible somewhere.
  assert.equal(shouldHideToolResult('bash', { content: 'boom', isError: true }), false);
});

test('an edit renders as a diff of what it replaced', () => {
  const props = TOOL_CONFIGS.edit.input.getContentProps?.({
    path: 'src/app/main.ts',
    edits: [
      { old_text: 'const a = 1;', new_text: 'const a = 2;' },
      { old_text: 'let b;', new_text: 'let b = 0;' },
    ],
  });

  assert.equal(props.filePath, 'src/app/main.ts');
  assert.equal(props.oldContent, 'const a = 1;\nlet b;');
  assert.equal(props.newContent, 'const a = 2;\nlet b = 0;');
  assert.equal(TOOL_CONFIGS.edit.input.contentType, 'diff');
  // The receipt says nothing the diff does not; the failure still shows.
  assert.equal(shouldHideToolResult('edit', { content: 'Successfully replaced' }), true);
  assert.equal(shouldHideToolResult('edit', { content: 'not found', isError: true }), false);
});

test('an edit with no replacements does not pretend to be a diff', () => {
  const props = TOOL_CONFIGS.edit.input.getContentProps?.({ path: 'a.ts' });

  assert.equal(props.oldContent, '');
  assert.equal(props.newContent, '');
});

const titleOf = (tool: string, input: unknown): string => {
  const title = TOOL_CONFIGS[tool].input.title;
  return typeof title === 'function' ? title(input) : String(title);
};

test('a todo batch is titled by what it did and listed by operation', () => {
  const init = {
    ops: [{
      op: 'init',
      list: [
        { phase: 'Audit', items: ['Compare names', 'Compare shapes'] },
        { phase: 'Fix', items: ['Route bash'] },
      ],
    }],
  };

  assert.equal(titleOf('todo_write', init), 'Task list, 3 tasks');
  assert.equal(
    TOOL_CONFIGS.todo_write.input.getContentProps?.(init).content,
    '**Audit**\n- [ ] Compare names\n- [ ] Compare shapes\n**Fix**\n- [ ] Route bash',
  );

  const progress = { ops: [{ op: 'done', task: 'Route bash' }, { op: 'note', text: 'covered by a test' }] };
  assert.equal(titleOf('todo_write', progress), '2 todo updates');
  assert.equal(
    TOOL_CONFIGS.todo_write.input.getContentProps?.(progress).content,
    '- [x] Route bash\n> covered by a test',
  );

  // A single operation says which one, rather than the tool's name.
  assert.equal(titleOf('todo_write', { ops: [{ op: 'start', task: 'Audit configs' }] }), 'start: Audit configs');
});

test('a malformed todo payload renders empty instead of throwing', () => {
  assert.equal(titleOf('todo_write', {}), 'Todos');
  assert.equal(TOOL_CONFIGS.todo_write.input.getContentProps?.({}).content, '');
});

test('the tools that only had a JSON dump now say what they were asked for', () => {
  assert.equal(TOOL_CONFIGS.web_search.input.getValue?.({ query: 'tailwind v4' }), 'tailwind v4');
  assert.equal(TOOL_CONFIGS.browser.input.getValue?.({ action: 'open', url: 'https://example.com' }), 'open https://example.com');
  assert.equal(TOOL_CONFIGS.lsp.input.getValue?.({ action: 'references', symbol: 'ToolRenderer' }), 'references ToolRenderer');
  assert.equal(TOOL_CONFIGS.computer.input.getValue?.({ action: 'keypress', keys: ['cmd', 'k'] }), 'keypress cmd+k');
  // Unregistered tools still fall back rather than crash.
  assert.equal(getToolConfig('no_such_tool'), TOOL_CONFIGS.Default);
});
