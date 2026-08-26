import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOL_CONFIGS, getToolConfig, getToolResultConfig, rendersCommandRow, rendersResultInline, shouldHideToolResult } from './toolConfigs';

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

  // The command row carries the output, so the generic section is suppressed
  // by the row itself, not by hiding the result config: a call whose arguments
  // are missing renders no command row, and its output still has to land
  // somewhere rather than disappear.
  assert.equal(shouldHideToolResult('bash', { content: 'ok', isError: false }), false);
  assert.equal(TOOL_CONFIGS.bash.result?.hidden, undefined);
  assert.equal(
    TOOL_CONFIGS.bash.result?.getContentProps?.({ content: 'exit 0' }).content,
    'exit 0',
  );
});

test('the tools the runtime merges are the tools the app merges', () => {
  // Everything the runtime renders with mergeCallAndResult, minus the ones
  // whose block already shows the change and whose result is only a receipt.
  for (const tool of ['bash', 'search', 'find', 'ast_grep', 'skill', 'lsp', 'web_search', 'browser', 'computer']) {
    assert.equal(rendersResultInline(tool), true, `${tool} should fold its output into the call`);
  }

  // read echoes the file the model already has; write/edit/todo_write restate
  // a change the block above them shows, so they fold their receipt away
  // instead of folding it in.
  for (const tool of ['read', 'write', 'edit', 'todo_write']) {
    assert.equal(rendersResultInline(tool), false, `${tool} must not claim an inline output block`);
  }
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

test('a tool that describes only its call still shows the output it got', () => {
  // These entries configure `input` alone on purpose. Read as "no result
  // config, so render nothing", that dropped a search's matches and a web
  // search's hits entirely, and left the jump-to-results link pointing at an
  // empty anchor.
  for (const tool of ['search', 'find', 'skill', 'ast_grep', 'lsp', 'web_search', 'browser', 'computer']) {
    assert.equal(TOOL_CONFIGS[tool].result, undefined, `${tool} is expected to describe only its call`);
    assert.equal(getToolResultConfig(tool), TOOL_CONFIGS.Default.result, `${tool} would render its output nowhere`);
    assert.equal(shouldHideToolResult(tool, { content: 'output' }), false);
  }

  // Suppression stays something a config asks for, never something it forgets.
  assert.equal(getToolResultConfig('read')?.hidden, true);
  assert.equal(shouldHideToolResult('read', { content: 'file body' }), true);
  // A write receipt restates the block above it; a failed write does not.
  assert.equal(shouldHideToolResult('write', { content: 'Successfully wrote 12 bytes' }), true);
  assert.equal(shouldHideToolResult('write', { content: 'EACCES', isError: true }), false);
});

test('the tools that only had a JSON dump now say what they were asked for', () => {
  assert.equal(TOOL_CONFIGS.web_search.input.getValue?.({ query: 'tailwind v4' }), 'tailwind v4');
  assert.equal(TOOL_CONFIGS.browser.input.getValue?.({ action: 'open', url: 'https://example.com' }), 'open https://example.com');
  assert.equal(TOOL_CONFIGS.lsp.input.getValue?.({ action: 'references', symbol: 'ToolRenderer' }), 'references ToolRenderer');
  assert.equal(TOOL_CONFIGS.computer.input.getValue?.({ action: 'keypress', keys: ['cmd', 'k'] }), 'keypress cmd+k');
  // A top-level `keys` array does not survive the tool bridge, so real keypress
  // work arrives nested in a batch; the row has to say what the batch did.
  assert.equal(
    TOOL_CONFIGS.computer.input.getValue?.({
      action: 'batch',
      actions: [{ action: 'screenshot' }, { action: 'keypress', keys: ['cmd', 'q'] }],
    }),
    'batch: screenshot, keypress cmd+q',
  );
  // Unregistered tools still fall back rather than crash.
  assert.equal(getToolConfig('no_such_tool'), TOOL_CONFIGS.Default);
});
