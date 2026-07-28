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
    input: {
      type: 'one-line',
      icon: 'terminal',
      getValue: (input) => input.command,
      getSecondary: (input) => (input.cwd ? `in ${input.cwd}` : undefined),
      action: 'copy',
      style: 'terminal',
      wrapText: true,
      colorScheme: {
        primary: 'text-green-400 font-mono',
        secondary: 'text-gray-400',
        background: '',
        border: 'border-green-500 dark:border-green-400',
        icon: 'text-green-500 dark:text-green-400'
      }
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
    input: {
      type: 'collapsible',
      title: (input) => input.phase || 'Task list',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (input) => ({
        content: Array.isArray(input.items)
          ? input.items.map((item: string) => `- ${item}`).join('\n')
          : (input.task ?? ''),
        format: 'markdown'
      })
    }
  },

  // `edit` is deliberately absent. Its parameter shape changes with the
  // active edit mode (apply_patch and hashline use different fields), so a
  // fixed accessor would render an empty diff for two of the three. Default
  // shows the real arguments until the modes are handled explicitly.


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
