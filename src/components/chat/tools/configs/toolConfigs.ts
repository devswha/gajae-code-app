/**
 * Centralized tool configuration registry
 * Defines display behavior for all tool types 
 */

export interface ToolDisplayConfig {
  input: {
    type: 'one-line' | 'collapsible' | 'plan' | 'hidden';
    // One-line config
    icon?: string;
    label?: string;
    getValue?: (input: any) => string;
    getSecondary?: (input: any) => string | undefined;
    action?: 'copy' | 'open-file' | 'jump-to-results' | 'none';
    style?: string;
    wrapText?: boolean;
    colorScheme?: {
      primary?: string;
      secondary?: string;
      background?: string;
      border?: string;
      icon?: string;
    };
    // Collapsible config
    title?: string | ((input: any) => string);
    defaultOpen?: boolean;
    contentType?: 'diff' | 'markdown' | 'file-list' | 'todo-list' | 'text' | 'task' | 'question-answer';
    getContentProps?: (input: any, helpers?: any) => any;
    actionButton?: 'file-button' | 'none';
  };
  result?: {
    hidden?: boolean;
    hideOnSuccess?: boolean;
    type?: 'one-line' | 'collapsible' | 'plan' | 'special';
    title?: string | ((result: any) => string);
    defaultOpen?: boolean;
    // Special result handlers
    contentType?: 'markdown' | 'file-list' | 'todo-list' | 'text' | 'success-message' | 'task' | 'question-answer';
    getMessage?: (result: any) => string;
    getContentProps?: (result: any) => any;
  };
}

type TodoOp = {
  op?: string;
  list?: { phase?: string; items?: string[] }[];
  task?: string;
  phase?: string;
  items?: string[];
  text?: string;
};

const asTodoOps = (ops: unknown): TodoOp[] => (Array.isArray(ops) ? ops as TodoOp[] : []);

/** Title for a `todo_write` batch: what it did, not what tool did it. */
function summarizeTodoOps(ops: unknown): string {
  const list = asTodoOps(ops);
  if (list.length === 0) return 'Todos';

  const first = list[0];
  if (list.length === 1) {
    if (first.op === 'init') {
      const tasks = (first.list ?? []).reduce((total, phase) => total + (phase.items?.length ?? 0), 0);
      return `Task list, ${tasks} ${tasks === 1 ? 'task' : 'tasks'}`;
    }
    const subject = first.task || first.phase || first.text || '';
    return subject ? `${first.op ?? 'todo'}: ${subject}` : String(first.op ?? 'Todos');
  }

  return `${list.length} todo updates`;
}

/** The batch as markdown, one line per operation, checkboxes where they mean something. */
function formatTodoOps(ops: unknown): string {
  const lines: string[] = [];

  for (const entry of asTodoOps(ops)) {
    switch (entry.op) {
      case 'init':
        for (const phase of entry.list ?? []) {
          if (phase.phase) lines.push(`**${phase.phase}**`);
          for (const item of phase.items ?? []) lines.push(`- [ ] ${item}`);
        }
        break;
      case 'append':
        if (entry.phase) lines.push(`**${entry.phase}**`);
        for (const item of entry.items ?? []) lines.push(`- [ ] ${item}`);
        break;
      case 'start':
        lines.push(`- > ${entry.task ?? ''}`);
        break;
      case 'done':
        lines.push(`- [x] ${entry.task ?? ''}`);
        break;
      case 'rm':
      case 'drop':
        lines.push(`- ~~${entry.task ?? entry.phase ?? ''}~~`);
        break;
      case 'note':
        lines.push(`> ${entry.text ?? ''}`);
        break;
      default:
        if (entry.op) lines.push(`- ${entry.op} ${entry.task ?? entry.phase ?? ''}`.trimEnd());
    }
  }

  return lines.join('\n');
}

/**
 * `computer` actions, including the batch form the tool bridge actually gets
 * through: a top-level `keys` array is mangled on the way in, so real keypress
 * work arrives nested inside `{ action: 'batch', actions: [...] }`. Rendering
 * only the discriminant would print "batch" and drop everything it did.
 */
function describeComputerAction(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const step = input as { action?: string; actions?: unknown[]; text?: string; keys?: unknown };

  if (step.action === 'batch') {
    const steps = (Array.isArray(step.actions) ? step.actions : [])
      .map(describeComputerAction)
      .filter(Boolean);
    return steps.length > 0 ? `batch: ${steps.join(', ')}` : 'batch';
  }

  const detail = step.text || (Array.isArray(step.keys) ? step.keys.join('+') : '');
  return [step.action, detail].filter(Boolean).join(' ');
}

/**
 * Tools whose call and result belong on one row, as the runtime's TUI merges
 * them: the command with its output folded underneath, inside the same block.
 * `bash` is the runtime's name for it; `Bash` is the same tool in a stored
 * Claude/Codex transcript, and both are replayed through this UI.
 */
const COMMAND_ROW_TOOLS = new Set(['bash', 'Bash']);

export function rendersCommandRow(toolName: string): boolean {
  return COMMAND_ROW_TOOLS.has(toolName);
}

export const TOOL_CONFIGS: Record<string, ToolDisplayConfig> = {
  // ============================================================================
  // COMMAND TOOLS
  // ============================================================================

  // ==========================================================================
  // GJC RUNTIME TOOLS
  //
  // Keyed by the tool's own `name`, which is what `tool_execution_start`
  // carries. The entries here used to be Claude Code's names — Bash, Read,
  // Grep, Glob, TodoWrite — so every GJC tool call missed the registry and
  // fell through to `Default`, rendering as a raw JSON parameter dump.
  //
  // Only `input` is configured. Result shapes are not pinned down per tool
  // yet, and a title that reads a field the runtime never sends would print
  // something confidently wrong ("Found 0 files") where `Default` at least
  // shows the truth.
  // ==========================================================================

  bash: {
    // Rendered by BashCommandDisplay, not from this entry: the command on one
    // row with its output folded into the same row, which is how the runtime's
    // own TUI shows it (`mergeCallAndResult`). `rendersCommandRow` suppresses
    // the generic result section so the output does not appear twice.
    input: { type: 'hidden' },
    // Deliberately not `hidden`. The suppression above only applies when the
    // command row was actually rendered, which needs the call's arguments; a
    // stored row that lost them would otherwise have its output swallowed
    // entirely, which is the exact failure this tool already had once.
    result: {
      type: 'collapsible',
      contentType: 'text',
      getContentProps: (result) => ({
        content: String(result?.content || ''),
        format: 'code'
      })
    }
  },

  read: {
    input: {
      type: 'one-line',
      label: 'Read',
      getValue: (input) => input.path || '',
      action: 'open-file',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        background: '',
        border: 'border-gray-300 dark:border-gray-600',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    },
    result: {
      // The file content is already in the model's context; echoing it into
      // the transcript buries the conversation.
      hidden: true
    }
  },

  write: {
    input: {
      type: 'collapsible',
      title: (input) => input.path?.split('/').pop() || input.path || 'file',
      defaultOpen: false,
      contentType: 'text',
      actionButton: 'file-button',
      getContentProps: (input) => ({
        content: input.content ?? '',
        format: 'code'
      })
    }
  },

  search: {
    input: {
      type: 'one-line',
      label: 'Search',
      getValue: (input) => input.pattern || '',
      getSecondary: (input) => {
        const paths = Array.isArray(input.paths) ? input.paths : [];
        return paths.length > 0 ? `in ${paths.join(', ')}` : undefined;
      },
      action: 'jump-to-results',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        secondary: 'text-gray-500 dark:text-gray-400',
        background: '',
        border: 'border-gray-400 dark:border-gray-500',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    }
  },

  find: {
    input: {
      type: 'one-line',
      label: 'Find',
      getValue: (input) => (Array.isArray(input.paths) ? input.paths.join(', ') : ''),
      action: 'jump-to-results',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        secondary: 'text-gray-500 dark:text-gray-400',
        background: '',
        border: 'border-gray-400 dark:border-gray-500',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    }
  },

  ast_grep: {
    input: {
      type: 'one-line',
      label: 'AST Grep',
      getValue: (input) => input.pat || '',
      action: 'jump-to-results',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        secondary: 'text-gray-500 dark:text-gray-400',
        background: '',
        border: 'border-gray-400 dark:border-gray-500',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    }
  },

  skill: {
    input: {
      type: 'one-line',
      label: 'Skill',
      getValue: (input) => (input.name ? `/skill:${input.name}` : ''),
      getSecondary: (input) => input.args || undefined,
      action: 'none',
      colorScheme: {
        primary: 'text-blue-600 dark:text-blue-400 font-medium',
        secondary: 'text-gray-500 dark:text-gray-400',
        background: '',
        border: 'border-blue-400 dark:border-blue-500',
        icon: 'text-blue-500 dark:text-blue-400'
      }
    }
  },

  todo_write: {
    // The runtime sends `{ ops: [...] }` — one call is a batch of operations,
    // not a list. Reading `phase`/`items`/`task` off the top level, as this
    // entry used to, matched nothing the tool ever sends: every call rendered
    // as an empty card titled "Task list".
    input: {
      type: 'collapsible',
      title: (input) => summarizeTodoOps(input.ops),
      defaultOpen: false,
      contentType: 'markdown',
      getContentProps: (input) => ({
        content: formatTodoOps(input.ops)
      })
    },
    result: {
      hideOnSuccess: true
    }
  },

  edit: {
    // One shape, from the runtime's schema: `{ path, edits: [{ old_text,
    // new_text, all? }] }`. The replacements are stacked into a single
    // before/after pair so one call renders as one diff, the way the TUI
    // renders an edit; the result receipt adds nothing the diff does not
    // already show, so it is kept for failures only.
    input: {
      type: 'collapsible',
      title: (input) => input.path?.split('/').pop() || input.path || 'file',
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'file-button',
      getContentProps: (input) => {
        const edits = Array.isArray(input.edits) ? input.edits : [];
        return {
          filePath: input.path || '',
          oldContent: edits.map((edit: any) => String(edit?.old_text ?? '')).join('\n'),
          newContent: edits.map((edit: any) => String(edit?.new_text ?? '')).join('\n')
        };
      }
    },
    result: {
      hideOnSuccess: true
    }
  },

  lsp: {
    input: {
      type: 'one-line',
      label: 'LSP',
      getValue: (input) => [input.action, input.symbol || input.query || input.file]
        .filter(Boolean)
        .join(' '),
      action: 'jump-to-results',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        secondary: 'text-gray-500 dark:text-gray-400',
        background: '',
        border: 'border-gray-400 dark:border-gray-500',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    }
  },

  web_search: {
    input: {
      type: 'one-line',
      label: 'Web Search',
      getValue: (input) => input.query || '',
      getSecondary: (input) => (input.recency ? `past ${input.recency}` : undefined),
      action: 'jump-to-results',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        secondary: 'text-gray-500 dark:text-gray-400',
        background: '',
        border: 'border-gray-400 dark:border-gray-500',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    }
  },

  computer: {
    // The runtime's schema is a union, one member per action plus a batch, so
    // the generated catalog flattens to no properties at all. `action` is the
    // discriminant every member carries; `text`/`keys` are what the typing
    // actions add, and `actions` is the batch's payload.
    input: {
      type: 'one-line',
      label: 'Computer',
      getValue: (input) => describeComputerAction(input),
      action: 'none',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        secondary: 'text-gray-500 dark:text-gray-400',
        background: '',
        border: 'border-gray-400 dark:border-gray-500',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    }
  },

  browser: {
    input: {
      type: 'one-line',
      label: 'Browser',
      getValue: (input) => [input.action, input.url || input.name || input.app]
        .filter(Boolean)
        .join(' '),
      action: 'jump-to-results',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        secondary: 'text-gray-500 dark:text-gray-400',
        background: '',
        border: 'border-gray-400 dark:border-gray-500',
        icon: 'text-gray-500 dark:text-gray-400'
      }
    }
  },


  // ============================================================================
  // INTERACTIVE TOOLS
  // ============================================================================

  // The worker labels questions `ask`; the bridge labels them
  // `AskUserQuestion`. Both share one config, aliased after this object.
  AskUserQuestion: {
    input: {
      type: 'collapsible',
      title: (input: any) => {
        const count = input.questions?.length || 0;
        const hasAnswers = input.answers && Object.keys(input.answers).length > 0;
        if (count === 1) {
          const header = input.questions[0]?.header || 'Question';
          return hasAnswers ? `${header} — answered` : header;
        }
        return hasAnswers ? `${count} questions — answered` : `${count} questions`;
      },
      defaultOpen: true,
      contentType: 'question-answer',
      getContentProps: (input: any) => ({
        questions: input.questions || [],
        answers: input.answers || {}
      }),
    },
    result: {
      hideOnSuccess: true
    }
  },

  // ============================================================================
  // PLAN TOOLS
  // ============================================================================

  exit_plan_mode: {
    input: {
      type: 'plan',
      title: 'Implementation plan',
      defaultOpen: true,
      contentType: 'markdown',
      getContentProps: (input) => ({
        content: input.plan?.replace(/\\n/g, '\n') || input.plan
      })
    },
    result: {
      hidden: true
    }
  },

  // Also register as ExitPlanMode (the actual tool name used by Claude)
  ExitPlanMode: {
    input: {
      type: 'plan',
      title: 'Implementation plan',
      defaultOpen: true,
      contentType: 'markdown',
      getContentProps: (input) => ({
        content: input.plan?.replace(/\\n/g, '\n') || input.plan
      })
    },
    result: {
      hidden: true
    }
  },

  // ============================================================================
  // DEFAULT FALLBACK
  // ============================================================================

  Default: {
    input: {
      type: 'collapsible',
      title: 'Parameters',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (input) => ({
        content: typeof input === 'string' ? input : JSON.stringify(input, null, 2),
        format: 'code'
      })
    },
    result: {
      type: 'collapsible',
      contentType: 'text',
      getContentProps: (result) => ({
        content: String(result?.content || ''),
        format: 'plain'
      })
    }
  }
};

/**
 * `ask` is the worker's label for the same question payload the bridge sends
 * as `AskUserQuestion`. Aliased rather than duplicated so the two can never
 * drift into rendering questions differently.
 */
TOOL_CONFIGS.ask = TOOL_CONFIGS.AskUserQuestion as ToolDisplayConfig;

/**
 * Get configuration for a tool, with fallback to default
 */
export function getToolConfig(toolName: string): ToolDisplayConfig {
  return TOOL_CONFIGS[toolName] || TOOL_CONFIGS.Default;
}

/**
 * Check if a tool result should be hidden
 */
export function shouldHideToolResult(toolName: string, toolResult: any): boolean {
  const config = getToolConfig(toolName);

  if (!config.result) return false;

  // Hidden/success-only configs suppress noisy successful output, but errors
  // still need to be visible so failed tool calls are diagnosable.
  if (toolResult?.isError) return false;

  // Always hidden
  if (config.result.hidden) return true;

  // Hide on success only
  if (config.result.hideOnSuccess && toolResult) {
    return true;
  }

  return false;
}
