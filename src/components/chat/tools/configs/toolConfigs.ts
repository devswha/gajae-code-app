export interface ToolDisplayConfig {
  input: {
    type: 'one-line' | 'collapsible' | 'plan' | 'hidden';
    icon?: string; label?: string; getValue?: (input: any) => string; getSecondary?: (input: any) => string | undefined; action?: 'copy' | 'open-file' | 'jump-to-results' | 'none'; style?: string; wrapText?: boolean;
    colorScheme?: { primary?: string; secondary?: string; background?: string; border?: string; icon?: string };
    title?: string | ((input: any) => string); defaultOpen?: boolean; contentType?: 'diff' | 'markdown' | 'file-list' | 'todo-list' | 'text' | 'task' | 'question-answer'; getContentProps?: (input: any, helpers?: any) => any; actionButton?: 'file-button' | 'none';
  };
  result?: { hidden?: boolean; hideOnSuccess?: boolean; type?: 'one-line' | 'collapsible' | 'plan' | 'special'; title?: string | ((result: any) => string); defaultOpen?: boolean; contentType?: 'markdown' | 'file-list' | 'todo-list' | 'text' | 'success-message' | 'task' | 'question-answer'; getMessage?: (result: any) => string; getContentProps?: (result: any) => any };
}

type TodoOp = { op?: string; list?: { phase?: string; items?: string[] }[]; task?: string; phase?: string; items?: string[]; text?: string };

const neutralColors = { primary: 'text-gray-700 dark:text-gray-300', secondary: 'text-gray-500 dark:text-gray-400', background: '', border: 'border-gray-400 dark:border-gray-500', icon: 'text-gray-500 dark:text-gray-400' };
const readColors = { primary: 'text-gray-700 dark:text-gray-300', background: '', border: 'border-gray-300 dark:border-gray-600', icon: 'text-gray-500 dark:text-gray-400' };
const skillColors = { primary: 'text-blue-600 dark:text-blue-400 font-medium', secondary: 'text-gray-500 dark:text-gray-400', background: '', border: 'border-blue-400 dark:border-blue-500', icon: 'text-blue-500 dark:text-blue-400' };
const planInput = { type: 'plan' as const, title: 'Implementation plan', defaultOpen: true, contentType: 'markdown' as const, getContentProps: (input: any) => ({ content: input.plan?.replace(/\\n/g, '\n') || input.plan }) };

function todoEntries(ops: unknown): TodoOp[] { return Array.isArray(ops) ? ops as TodoOp[] : []; }

function todoTitle(ops: unknown): string {
  const entries = todoEntries(ops);
  if (!entries.length) return 'Todos';
  const first = entries[0];
  if (entries.length > 1) return `${entries.length} todo updates`;
  if (first.op === 'init') {
    const count = (first.list ?? []).reduce((sum, group) => sum + (group.items?.length ?? 0), 0);
    return `Task list, ${count} ${count === 1 ? 'task' : 'tasks'}`;
  }
  const subject = first.task || first.phase || first.text || '';
  return subject ? `${first.op ?? 'todo'}: ${subject}` : String(first.op ?? 'Todos');
}

function todoMarkdown(ops: unknown): string {
  const output: string[] = [];
  for (const entry of todoEntries(ops)) {
    if (entry.op === 'init') {
      for (const group of entry.list ?? []) { if (group.phase) output.push(`**${group.phase}**`); for (const item of group.items ?? []) output.push(`- [ ] ${item}`); }
    } else if (entry.op === 'append') {
      if (entry.phase) output.push(`**${entry.phase}**`);
      for (const item of entry.items ?? []) output.push(`- [ ] ${item}`);
    } else if (entry.op === 'start') output.push(`- > ${entry.task ?? ''}`);
    else if (entry.op === 'done') output.push(`- [x] ${entry.task ?? ''}`);
    else if (entry.op === 'rm' || entry.op === 'drop') output.push(`- ~~${entry.task ?? entry.phase ?? ''}~~`);
    else if (entry.op === 'note') output.push(`> ${entry.text ?? ''}`);
    else if (entry.op) output.push(`- ${entry.op} ${entry.task ?? entry.phase ?? ''}`.trimEnd());
  }
  return output.join('\n');
}

function computerSummary(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const action = input as { action?: string; actions?: unknown[]; text?: string; keys?: unknown };
  if (action.action === 'batch') {
    const children = (Array.isArray(action.actions) ? action.actions : []).map(computerSummary).filter(Boolean);
    return children.length ? `batch: ${children.join(', ')}` : 'batch';
  }
  const detail = action.text || (Array.isArray(action.keys) ? action.keys.join('+') : '');
  return [action.action, detail].filter(Boolean).join(' ');
}

const outputAsCode = (result: any) => ({ content: String(result?.content || ''), format: 'code' });
const outputAsText = (result: any) => ({ content: String(result?.content || ''), format: 'plain' });
const leafName = (input: any) => input.path?.split('/').pop() || input.path || 'file';
const callOnly = (label: string, getValue: (input: any) => string, colors = neutralColors): ToolDisplayConfig => ({ input: { type: 'one-line', label, getValue, action: 'none', colorScheme: colors } });

const inlineToolNames = new Set(['bash', 'Bash', 'search', 'find', 'ast_grep', 'skill', 'lsp', 'web_search', 'browser', 'computer']);
const commandToolNames = new Set(['bash', 'Bash']);
export function rendersResultInline(toolName: string): boolean { return inlineToolNames.has(toolName); }
export function rendersCommandRow(toolName: string): boolean { return commandToolNames.has(toolName); }

const questions: ToolDisplayConfig = {
  input: {
    type: 'collapsible',
    title: (input: any) => {
      const count = input.questions?.length || 0;
      const answered = input.answers && Object.keys(input.answers).length > 0;
      if (count === 1) { const header = input.questions[0]?.header || 'Question'; return answered ? `${header} — answered` : header; }
      return answered ? `${count} questions — answered` : `${count} questions`;
    },
    defaultOpen: true, contentType: 'question-answer', getContentProps: (input: any) => ({ questions: input.questions || [], answers: input.answers || {} }),
  }, result: { hideOnSuccess: true },
};

export const TOOL_CONFIGS: Record<string, ToolDisplayConfig> = {
  bash: { input: { type: 'hidden' }, result: { type: 'collapsible', contentType: 'text', getContentProps: outputAsCode } },
  read: { input: { type: 'one-line', label: 'Read', getValue: (input) => input.path || '', action: 'open-file', colorScheme: readColors }, result: { hidden: true } },
  write: { input: { type: 'collapsible', title: leafName, defaultOpen: false, contentType: 'text', actionButton: 'file-button', getContentProps: (input) => ({ content: input.content ?? '', format: 'code' }) }, result: { hideOnSuccess: true } },
  search: { input: { type: 'one-line', label: 'Search', getValue: (input) => input.pattern || '', getSecondary: (input) => { const paths = Array.isArray(input.paths) ? input.paths : []; return paths.length ? `in ${paths.join(', ')}` : undefined; }, action: 'none', colorScheme: neutralColors } },
  find: callOnly('Find', (input) => Array.isArray(input.paths) ? input.paths.join(', ') : ''),
  ast_grep: callOnly('AST Grep', (input) => input.pat || ''),
  skill: { input: { type: 'one-line', label: 'Skill', getValue: (input) => input.name ? `/skill:${input.name}` : '', getSecondary: (input) => input.args || undefined, action: 'none', colorScheme: skillColors } },
  todo_write: { input: { type: 'collapsible', title: (input) => todoTitle(input.ops), defaultOpen: false, contentType: 'markdown', getContentProps: (input) => ({ content: todoMarkdown(input.ops) }) }, result: { hideOnSuccess: true } },
  edit: { input: { type: 'collapsible', title: leafName, defaultOpen: false, contentType: 'diff', actionButton: 'file-button', getContentProps: (input) => { const edits = Array.isArray(input.edits) ? input.edits : []; return { filePath: input.path || '', oldContent: edits.map((edit: any) => String(edit?.old_text ?? '')).join('\n'), newContent: edits.map((edit: any) => String(edit?.new_text ?? '')).join('\n') }; } }, result: { hideOnSuccess: true } },
  lsp: callOnly('LSP', (input) => [input.action, input.symbol || input.query || input.file].filter(Boolean).join(' ')),
  web_search: { input: { type: 'one-line', label: 'Web Search', getValue: (input) => input.query || '', getSecondary: (input) => input.recency ? `past ${input.recency}` : undefined, action: 'none', colorScheme: neutralColors } },
  computer: callOnly('Computer', computerSummary),
  browser: callOnly('Browser', (input) => [input.action, input.url || input.name || input.app].filter(Boolean).join(' ')),
  AskUserQuestion: questions,
  exit_plan_mode: { input: planInput, result: { hidden: true } },
  ExitPlanMode: { input: planInput, result: { hidden: true } },
  Default: { input: { type: 'collapsible', title: 'Parameters', defaultOpen: false, contentType: 'text', getContentProps: (input) => ({ content: typeof input === 'string' ? input : JSON.stringify(input, null, 2), format: 'code' }) }, result: { type: 'collapsible', contentType: 'text', getContentProps: outputAsText } },
};

TOOL_CONFIGS.ask = TOOL_CONFIGS.AskUserQuestion as ToolDisplayConfig;
export function getToolConfig(toolName: string): ToolDisplayConfig { return TOOL_CONFIGS[toolName] || TOOL_CONFIGS.Default; }
export function getToolResultConfig(toolName: string): ToolDisplayConfig['result'] { return getToolConfig(toolName).result ?? TOOL_CONFIGS.Default.result; }
export function shouldHideToolResult(toolName: string, toolResult: any): boolean {
  const result = getToolConfig(toolName).result;
  if (!result || toolResult?.isError) return false;
  return Boolean(result.hidden || (result.hideOnSuccess && toolResult));
}
