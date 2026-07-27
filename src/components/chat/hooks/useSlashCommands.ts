import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import { safeLocalStorage } from '../utils/chatStorage';
import type { LLMProvider, Project } from '../../../types/app';
import { APP_UI_COMMANDS, isAppUiCommand, isAppUsableCommand } from '../appUiCommands';

const COMMAND_QUERY_DEBOUNCE_MS = 150;

export interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: 'built-in' | 'custom' | 'skill' | 'provider' | string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface UseSlashCommandsOptions {
  selectedProject: Project | null;
  provider: LLMProvider;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  onExecuteCommand: (command: SlashCommand, rawInput?: string) => void | Promise<void>;
  onLoginCommand?: () => void;
  onAppCommand?: (command: SlashCommand) => void;
}

type ProviderSkill = {
  name: string;
  description?: string;
  command: string;
  scope: string;
  sourcePath?: string;
  pluginName?: string;
  pluginId?: string;
};

type ProviderSkillsResponse = {
  success?: boolean;
  data?: {
    skills?: ProviderSkill[];
  };
};

type ProviderCommandsResponse = {
  success?: boolean;
  data?: {
    commands?: SlashCommand[];
  };
};

const getCommandHistoryKey = (projectName: string) => `command_history_${projectName}`;

const readCommandHistory = (projectName: string): Record<string, number> => {
  const history = safeLocalStorage.getItem(getCommandHistoryKey(projectName));
  if (!history) {
    return {};
  }

  try {
    return JSON.parse(history);
  } catch (error) {
    console.error('Error parsing command history:', error);
    return {};
  }
};

const saveCommandHistory = (projectName: string, history: Record<string, number>) => {
  safeLocalStorage.setItem(getCommandHistoryKey(projectName), JSON.stringify(history));
};

const isPromiseLike = (value: unknown): value is Promise<unknown> =>
  Boolean(value) && typeof (value as Promise<unknown>).then === 'function';

const isInsertableProviderCommand = (command: SlashCommand) =>
  command.type === 'skill' ||
  command.type === 'provider' ||
  command.metadata?.type === 'skill';

const isLoginCommand = (command: SlashCommand) => command.name === '/login';

const dedupeProviderSkills = (skills: ProviderSkill[]): ProviderSkill[] => {
  const seenCommands = new Set<string>();

  return skills.filter((skill) => {
    // Multiple physical Claude plugin folders can expose the same invocation.
    // The slash menu should show each executable command only once.
    const key = skill.command;
    if (seenCommands.has(key)) {
      return false;
    }

    seenCommands.add(key);
    return true;
  });
};

const mapSkillToSlashCommand = (skill: ProviderSkill): SlashCommand => ({
  name: skill.command,
  description: skill.description,
  namespace: 'skill',
  path: skill.sourcePath,
  type: 'skill',
  metadata: {
    type: skill.scope,
    scope: skill.scope,
    sourcePath: skill.sourcePath,
    pluginName: skill.pluginName,
    pluginId: skill.pluginId,
    skillName: skill.name,
  },
});

const filterSlashCommands = (
  commands: SlashCommand[],
  query: string,
): SlashCommand[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return commands;
  }

  const commandPrefix = normalizedQuery.startsWith('/')
    ? normalizedQuery
    : `/${normalizedQuery}`;
  const namePrefixMatches = commands.filter((command) =>
    command.name.toLowerCase().startsWith(commandPrefix),
  );

  // Namespaced commands should behave like path completion. Once a provider
  // namespace is typed, only exact command-prefix matches should stay visible.
  if (normalizedQuery.includes(':') || namePrefixMatches.length > 0) {
    return namePrefixMatches;
  }

  const nameSubstringMatches = commands.filter((command) =>
    command.name.toLowerCase().includes(normalizedQuery),
  );
  if (nameSubstringMatches.length > 0) {
    return nameSubstringMatches;
  }

  return commands.filter((command) =>
    command.description?.toLowerCase().includes(normalizedQuery),
  );
};

export function useSlashCommands({
  selectedProject,
  provider,
  input,
  setInput,
  textareaRef,
  onExecuteCommand,
  onLoginCommand,
  onAppCommand,
}: UseSlashCommandsOptions) {
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const [slashPosition, setSlashPosition] = useState(-1);

  const commandQueryTimerRef = useRef<number | null>(null);

  const clearCommandQueryTimer = useCallback(() => {
    if (commandQueryTimerRef.current !== null) {
      window.clearTimeout(commandQueryTimerRef.current);
      commandQueryTimerRef.current = null;
    }
  }, []);

  const resetCommandMenuState = useCallback(() => {
    setShowCommandMenu(false);
    setSlashPosition(-1);
    setCommandQuery('');
    setSelectedCommandIndex(-1);
    clearCommandQueryTimer();
  }, [clearCommandQueryTimer]);

  useEffect(() => {
    let cancelled = false;

    const fetchCommands = async () => {
      if (!selectedProject) {
        setSlashCommands([]);
        setFilteredCommands([]);
        return;
      }

      try {
        const commandsParams = new URLSearchParams();
        const skillsParams = new URLSearchParams();
        if (selectedProject.projectId) {
          commandsParams.set('projectId', selectedProject.projectId);
          skillsParams.set('projectId', selectedProject.projectId);
        }
        const commandsRequest = authenticatedFetch(
          `/api/providers/${encodeURIComponent(provider)}/commands${commandsParams.toString() ? `?${commandsParams.toString()}` : ''}`,
        );
        const skillsRequest = authenticatedFetch(
          `/api/providers/${encodeURIComponent(provider)}/skills${skillsParams.toString() ? `?${skillsParams.toString()}` : ''}`,
        );
        const [commandsResponse, skillsResponse] = await Promise.all([commandsRequest, skillsRequest]);
        const commandsData = commandsResponse.ok
          ? ((await commandsResponse.json()) as ProviderCommandsResponse)
          : null;
        const skillsData = skillsResponse.ok
          ? ((await skillsResponse.json()) as ProviderSkillsResponse)
          : null;
        const skillCommands = dedupeProviderSkills(skillsData?.data?.skills || [])
          .map(mapSkillToSlashCommand);
        // App-level UI commands (e.g. /resume) take precedence over any
        // same-named provider command so the menu matches the typed-input
        // interception in useChatComposerState.
        const appCommands = APP_UI_COMMANDS.map((command): SlashCommand => ({ ...command }));
        const appCommandNames = new Set(appCommands.map((command) => command.name));
        const allCommands: SlashCommand[] = [
          ...appCommands,
          ...((commandsData?.data?.commands || []) as SlashCommand[])
            .filter((command) => !appCommandNames.has(command.name)),
          ...skillCommands,
        ]
          // Only offer what the app can actually run. Anything the composer
          // answers with a "not available in the app" notice (e.g. /skill:team,
          // which drives tmux panes the app cannot show) would otherwise be
          // advertised here and then refused on submit.
          .filter((command) => isAppUsableCommand(command.name));

        const parsedHistory = readCommandHistory(selectedProject.projectId);
        const sortedCommands = [...allCommands].sort((commandA, commandB) => {
          const commandAUsage = parsedHistory[commandA.name] || 0;
          const commandBUsage = parsedHistory[commandB.name] || 0;
          return commandBUsage - commandAUsage;
        });

        if (!cancelled) {
          setSlashCommands(sortedCommands);
        }
      } catch (error) {
        console.error('Error fetching slash commands:', error);
        if (!cancelled) {
          setSlashCommands([]);
        }
      }
    };

    fetchCommands();
    return () => {
      cancelled = true;
    };
  }, [selectedProject, provider]);

  useEffect(() => {
    if (!showCommandMenu) {
      setSelectedCommandIndex(-1);
    }
  }, [showCommandMenu]);

  useEffect(() => {
    setFilteredCommands(filterSlashCommands(slashCommands, commandQuery));
  }, [commandQuery, slashCommands]);

  const frequentCommands = useMemo(() => {
    if (!selectedProject || slashCommands.length === 0) {
      return [];
    }

    const parsedHistory = readCommandHistory(selectedProject.projectId);

    return slashCommands
      .map((command) => ({
        ...command,
        usageCount: parsedHistory[command.name] || 0,
      }))
      .filter((command) => command.usageCount > 0)
      .sort((commandA, commandB) => commandB.usageCount - commandA.usageCount)
      .slice(0, 5);
  }, [selectedProject, slashCommands]);

  const trackCommandUsage = useCallback(
    (command: SlashCommand) => {
      if (!selectedProject) {
        return;
      }

      const parsedHistory = readCommandHistory(selectedProject.projectId);
      parsedHistory[command.name] = (parsedHistory[command.name] || 0) + 1;
      saveCommandHistory(selectedProject.projectId, parsedHistory);
    },
    [selectedProject],
  );

  const insertCommandIntoInput = useCallback(
    (command: SlashCommand) => {
      const currentTextarea = textareaRef.current;
      const insertionStart = slashPosition >= 0
        ? slashPosition
        : currentTextarea?.selectionStart ?? input.length;
      const textBeforeCommand = input.slice(0, insertionStart);
      const textAfterCommandStart = input.slice(insertionStart);
      const spaceIndex = textAfterCommandStart.indexOf(' ');
      const textAfterCommand = slashPosition >= 0 && spaceIndex !== -1
        ? textAfterCommandStart.slice(spaceIndex).trimStart()
        : input.slice(currentTextarea?.selectionEnd ?? insertionStart);
      const separator = textBeforeCommand && !/\s$/.test(textBeforeCommand) ? ' ' : '';
      const newInput = `${textBeforeCommand}${separator}${command.name}${textAfterCommand ? ` ${textAfterCommand}` : ' '}`;

      setInput(newInput);
      resetCommandMenuState();

      window.requestAnimationFrame(() => {
        currentTextarea?.focus();
        const nextCursorPosition = `${textBeforeCommand}${separator}${command.name} `.length;
        currentTextarea?.setSelectionRange(nextCursorPosition, nextCursorPosition);
      });
    },
    [input, resetCommandMenuState, setInput, slashPosition, textareaRef],
  );

  // Strip the typed "/query" token (if any) after an app command runs its UI
  // action, so the leftover query is not sent as a chat message later.
  const removeCommandTokenFromInput = useCallback(
    () => {
      if (slashPosition < 0) {
        return;
      }
      const currentTextarea = textareaRef.current;
      const textBeforeCommand = input.slice(0, slashPosition);
      const textFromSlash = input.slice(slashPosition);
      const spaceIndex = textFromSlash.indexOf(' ');
      const textAfterCommand = spaceIndex !== -1 ? textFromSlash.slice(spaceIndex).trimStart() : '';
      setInput(`${textBeforeCommand}${textAfterCommand}`);

      window.requestAnimationFrame(() => {
        currentTextarea?.focus();
        currentTextarea?.setSelectionRange(textBeforeCommand.length, textBeforeCommand.length);
      });
    },
    [input, setInput, slashPosition, textareaRef],
  );

  const runAppCommand = useCallback(
    (command: SlashCommand) => {
      removeCommandTokenFromInput();
      resetCommandMenuState();
      onAppCommand?.(command);
    },
    [onAppCommand, removeCommandTokenFromInput, resetCommandMenuState],
  );

  const executeNonSkillCommand = useCallback(
    (command: SlashCommand) => {
      const executionResult = onExecuteCommand(command);
      if (isPromiseLike(executionResult)) {
        executionResult.then(
          () => {
            resetCommandMenuState();
          },
          () => {
            resetCommandMenuState();
            // Keep behavior silent; execution errors are handled by caller.
          },
        );
      } else {
        resetCommandMenuState();
      }
    },
    [onExecuteCommand, resetCommandMenuState],
  );

  const selectCommandFromKeyboard = useCallback(
    (command: SlashCommand) => {
      if (isLoginCommand(command)) {
        onLoginCommand?.();
        resetCommandMenuState();
        return;
      }
      if (isAppUiCommand(command)) {
        runAppCommand(command);
        return;
      }
      if (isInsertableProviderCommand(command)) {
        insertCommandIntoInput(command);
        return;
      }

      executeNonSkillCommand(command);
    },
    [executeNonSkillCommand, insertCommandIntoInput, onLoginCommand, resetCommandMenuState, runAppCommand],
  );

  const handleCommandSelect = useCallback(
    (command: SlashCommand | null, index: number, isHover: boolean) => {
      if (!command || !selectedProject) {
        return;
      }

      if (isHover) {
        setSelectedCommandIndex(index);
        return;
      }

      if (isLoginCommand(command)) {
        onLoginCommand?.();
        resetCommandMenuState();
        return;
      }
      trackCommandUsage(command);
      if (isAppUiCommand(command)) {
        runAppCommand(command);
        return;
      }
      if (isInsertableProviderCommand(command)) {
        insertCommandIntoInput(command);
        return;
      }

      executeNonSkillCommand(command);
    },
    [selectedProject, trackCommandUsage, insertCommandIntoInput, executeNonSkillCommand, onLoginCommand, resetCommandMenuState, runAppCommand],
  );

  const handleToggleCommandMenu = useCallback(() => {
    const isOpening = !showCommandMenu;
    setShowCommandMenu(isOpening);
    setCommandQuery('');
    setSelectedCommandIndex(-1);

    if (isOpening) {
      setFilteredCommands(slashCommands);
    }

    textareaRef.current?.focus();
  }, [showCommandMenu, slashCommands, textareaRef]);

  const handleCommandInputChange = useCallback(
    (newValue: string, cursorPos: number) => {
      if (!newValue.trim()) {
        resetCommandMenuState();
        return;
      }

      const textBeforeCursor = newValue.slice(0, cursorPos);
      const backticksBefore = (textBeforeCursor.match(/```/g) || []).length;
      const inCodeBlock = backticksBefore % 2 === 1;

      if (inCodeBlock) {
        resetCommandMenuState();
        return;
      }

      // Match / at start of input OR after whitespace, capturing the /word up to cursor.
      const slashPattern = /(?:^|\s)(\/\S*)$/;
      const match = textBeforeCursor.match(slashPattern);

      if (!match) {
        resetCommandMenuState();
        return;
      }

      // Compute actual position of / in the full input string.
      const slashPos = match.index! + (match[0].length - match[1].length);
      const query = match[1].slice(1); // strip leading /

      setSlashPosition(slashPos);
      setShowCommandMenu(true);
      setSelectedCommandIndex(-1);

      clearCommandQueryTimer();
      commandQueryTimerRef.current = window.setTimeout(() => {
        setCommandQuery(query);
      }, COMMAND_QUERY_DEBOUNCE_MS);
    },
    [resetCommandMenuState, clearCommandQueryTimer],
  );

  const handleCommandMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!showCommandMenu) {
        return false;
      }

      if (!filteredCommands.length) {
        if (event.key === 'Escape') {
          event.preventDefault();
          resetCommandMenuState();
          return true;
        }
        return false;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedCommandIndex((previousIndex) =>
          previousIndex < filteredCommands.length - 1 ? previousIndex + 1 : 0,
        );
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedCommandIndex((previousIndex) =>
          previousIndex > 0 ? previousIndex - 1 : filteredCommands.length - 1,
        );
        return true;
      }

      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        if (selectedCommandIndex >= 0) {
          selectCommandFromKeyboard(filteredCommands[selectedCommandIndex]);
        } else if (filteredCommands.length > 0) {
          selectCommandFromKeyboard(filteredCommands[0]);
        }
        return true;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        resetCommandMenuState();
        return true;
      }

      return false;
    },
    [showCommandMenu, filteredCommands, resetCommandMenuState, selectCommandFromKeyboard, selectedCommandIndex],
  );

  useEffect(
    () => () => {
      clearCommandQueryTimer();
    },
    [clearCommandQueryTimer],
  );

  return {
    slashCommands,
    slashCommandsCount: slashCommands.length,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    handleCommandInputChange,
    handleCommandMenuKeyDown,
  };
}
