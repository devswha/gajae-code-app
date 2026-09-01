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
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onExecuteCommand: (command: SlashCommand, rawInput?: string) => void | Promise<void>;
  onLoginCommand?: () => void;
  onAppCommand?: (command: SlashCommand) => void;
}

type ProviderSkill = { name: string; description?: string; command: string; scope: string; sourcePath?: string; pluginName?: string; pluginId?: string; };
type ProviderSkillsResponse = { success?: boolean; data?: { skills?: ProviderSkill[] } };
type ProviderCommandsResponse = { success?: boolean; data?: { commands?: SlashCommand[] } };

const historyKey = (projectId: string) => `command_history_${projectId}`;
const getHistory = (projectId: string): Record<string, number> => {
  const stored = safeLocalStorage.getItem(historyKey(projectId));
  if (!stored) return {};
  try {
    return JSON.parse(stored);
  } catch (error) {
    console.error('Error parsing command history:', error);
    return {};
  }
};
const saveHistory = (projectId: string, history: Record<string, number>) => safeLocalStorage.setItem(historyKey(projectId), JSON.stringify(history));
const isPromise = (value: unknown): value is Promise<unknown> => Boolean(value) && typeof (value as Promise<unknown>).then === 'function';
const needsInsertion = (command: SlashCommand) => command.type === 'skill' || command.type === 'provider' || command.metadata?.type === 'skill';
const isLogin = (command: SlashCommand) => command.name === '/login';

const skillCommands = (skills: ProviderSkill[]) => {
  const names = new Set<string>();
  const unique = skills.filter((skill) => {
    if (names.has(skill.command)) return false;
    names.add(skill.command);
    return true;
  });
  return unique.map((skill): SlashCommand => ({
    name: skill.command,
    description: skill.description,
    namespace: 'skill',
    path: skill.sourcePath,
    type: 'skill',
    metadata: { type: skill.scope, scope: skill.scope, sourcePath: skill.sourcePath, pluginName: skill.pluginName, pluginId: skill.pluginId, skillName: skill.name },
  }));
};

const matchCommands = (commands: SlashCommand[], query: string) => {
  const term = query.trim().toLowerCase();
  if (!term) return commands;
  const prefix = term.startsWith('/') ? term : `/${term}`;
  const leading = commands.filter((command) => command.name.toLowerCase().startsWith(prefix));
  if (term.includes(':') || leading.length) return leading;
  const containing = commands.filter((command) => command.name.toLowerCase().includes(term));
  return containing.length ? containing : commands.filter((command) => command.description?.toLowerCase().includes(term));
};

export function useSlashCommands({ selectedProject, provider, input, setInput, textareaRef, onExecuteCommand, onLoginCommand, onAppCommand }: UseSlashCommandsOptions) {
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const [slashPosition, setSlashPosition] = useState(-1);
  const queryTimer = useRef<number | null>(null);

  const cancelPendingQuery = useCallback(() => {
    if (queryTimer.current === null) return;
    window.clearTimeout(queryTimer.current);
    queryTimer.current = null;
  }, []);
  const resetCommandMenuState = useCallback(() => {
    setShowCommandMenu(false);
    setSlashPosition(-1);
    setCommandQuery('');
    setSelectedCommandIndex(-1);
    cancelPendingQuery();
  }, [cancelPendingQuery]);

  useEffect(() => {
    let current = true;
    const requestCommands = async () => {
      if (!selectedProject) {
        setSlashCommands([]);
        setFilteredCommands([]);
        return;
      }
      try {
        const params = new URLSearchParams();
        if (selectedProject.projectId) params.set('projectId', selectedProject.projectId);
        const query = params.toString();
        const endpoint = `/api/providers/${encodeURIComponent(provider)}`;
        const [commandsResponse, skillsResponse] = await Promise.all([
          authenticatedFetch(`${endpoint}/commands${query ? `?${query}` : ''}`),
          authenticatedFetch(`${endpoint}/skills${query ? `?${query}` : ''}`),
        ]);
        const commandPayload = commandsResponse.ok ? await commandsResponse.json() as ProviderCommandsResponse : null;
        const skillPayload = skillsResponse.ok ? await skillsResponse.json() as ProviderSkillsResponse : null;
        const app = APP_UI_COMMANDS.map((command): SlashCommand => ({ ...command }));
        const appNames = new Set(app.map((command) => command.name));
        const candidates = [
          ...app,
          ...(commandPayload?.data?.commands || []).filter((command) => !appNames.has(command.name)),
          ...skillCommands(skillPayload?.data?.skills || []),
        ].filter((command) => isAppUsableCommand(command.name));
        const history = getHistory(selectedProject.projectId);
        candidates.sort((left, right) => (history[right.name] || 0) - (history[left.name] || 0));
        if (current) setSlashCommands(candidates);
      } catch (error) {
        console.error('Error fetching slash commands:', error);
        if (current) setSlashCommands([]);
      }
    };
    void requestCommands();
    return () => { current = false; };
  }, [selectedProject, provider]);

  useEffect(() => { if (!showCommandMenu) setSelectedCommandIndex(-1); }, [showCommandMenu]);
  useEffect(() => { setFilteredCommands(matchCommands(slashCommands, commandQuery)); }, [commandQuery, slashCommands]);
  useEffect(() => () => cancelPendingQuery(), [cancelPendingQuery]);

  const frequentCommands = useMemo(() => {
    if (!selectedProject || !slashCommands.length) return [];
    const history = getHistory(selectedProject.projectId);
    return slashCommands.map((command) => ({ ...command, usageCount: history[command.name] || 0 }))
      .filter((command) => command.usageCount > 0)
      .sort((left, right) => right.usageCount - left.usageCount)
      .slice(0, 5);
  }, [selectedProject, slashCommands]);

  const recordUse = useCallback((command: SlashCommand) => {
    if (!selectedProject) return;
    const history = getHistory(selectedProject.projectId);
    history[command.name] = (history[command.name] || 0) + 1;
    saveHistory(selectedProject.projectId, history);
  }, [selectedProject]);

  const placeCommand = useCallback((command: SlashCommand) => {
    const textarea = textareaRef.current;
    const start = slashPosition >= 0 ? slashPosition : textarea?.selectionStart ?? input.length;
    const before = input.slice(0, start);
    const fromStart = input.slice(start);
    const firstSpace = fromStart.indexOf(' ');
    const after = slashPosition >= 0 && firstSpace !== -1 ? fromStart.slice(firstSpace).trimStart() : input.slice(textarea?.selectionEnd ?? start);
    const gap = before && !/\s$/.test(before) ? ' ' : '';
    setInput(`${before}${gap}${command.name}${after ? ` ${after}` : ' '}`);
    resetCommandMenuState();
    window.requestAnimationFrame(() => {
      textarea?.focus();
      const position = `${before}${gap}${command.name} `.length;
      textarea?.setSelectionRange(position, position);
    });
  }, [input, resetCommandMenuState, setInput, slashPosition, textareaRef]);

  const removeTypedCommand = useCallback(() => {
    if (slashPosition < 0) return;
    const textarea = textareaRef.current;
    const before = input.slice(0, slashPosition);
    const fromMarker = input.slice(slashPosition);
    const firstSpace = fromMarker.indexOf(' ');
    const after = firstSpace < 0 ? '' : fromMarker.slice(firstSpace).trimStart();
    setInput(`${before}${after}`);
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(before.length, before.length);
    });
  }, [input, setInput, slashPosition, textareaRef]);

  const invoke = useCallback((command: SlashCommand, countUsage: boolean) => {
    if (isLogin(command)) {
      onLoginCommand?.();
      resetCommandMenuState();
      return;
    }
    if (countUsage) recordUse(command);
    if (isAppUiCommand(command)) {
      removeTypedCommand();
      resetCommandMenuState();
      onAppCommand?.(command);
      return;
    }
    if (needsInsertion(command)) {
      placeCommand(command);
      return;
    }
    const result = onExecuteCommand(command);
    if (isPromise(result)) {
      result.then(resetCommandMenuState, resetCommandMenuState);
    } else {
      resetCommandMenuState();
    }
  }, [onAppCommand, onExecuteCommand, onLoginCommand, placeCommand, recordUse, removeTypedCommand, resetCommandMenuState]);

  const handleCommandSelect = useCallback((command: SlashCommand | null, index: number, isHover: boolean) => {
    if (!command || !selectedProject) return;
    if (isHover) {
      setSelectedCommandIndex(index);
      return;
    }
    invoke(command, !isLogin(command));
  }, [invoke, selectedProject]);

  const handleToggleCommandMenu = useCallback(() => {
    const opening = !showCommandMenu;
    setShowCommandMenu(opening);
    setCommandQuery('');
    setSelectedCommandIndex(-1);
    if (opening) setFilteredCommands(slashCommands);
    textareaRef.current?.focus();
  }, [showCommandMenu, slashCommands, textareaRef]);

  const handleCommandInputChange = useCallback((newValue: string, cursorPos: number) => {
    if (!newValue.trim()) {
      resetCommandMenuState();
      return;
    }
    const prefix = newValue.slice(0, cursorPos);
    if ((prefix.match(/```/g) || []).length % 2) {
      resetCommandMenuState();
      return;
    }
    const match = /(?:^|\s)(\/\S*)$/.exec(prefix);
    if (!match) {
      resetCommandMenuState();
      return;
    }
    const token = match[1];
    setSlashPosition(match.index! + match[0].length - token.length);
    setShowCommandMenu(true);
    setSelectedCommandIndex(-1);
    cancelPendingQuery();
    queryTimer.current = window.setTimeout(() => setCommandQuery(token.slice(1)), COMMAND_QUERY_DEBOUNCE_MS);
  }, [cancelPendingQuery, resetCommandMenuState]);

  const handleCommandMenuKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!showCommandMenu) return false;
    if (!filteredCommands.length) {
      if (event.key !== 'Escape') return false;
      event.preventDefault();
      resetCommandMenuState();
      return true;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedCommandIndex((index) => index < filteredCommands.length - 1 ? index + 1 : 0);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedCommandIndex((index) => index > 0 ? index - 1 : filteredCommands.length - 1);
      return true;
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      invoke(filteredCommands[selectedCommandIndex >= 0 ? selectedCommandIndex : 0], false);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      resetCommandMenuState();
      return true;
    }
    return false;
  }, [filteredCommands, invoke, resetCommandMenuState, selectedCommandIndex, showCommandMenu]);

  return { slashCommands, slashCommandsCount: slashCommands.length, filteredCommands, frequentCommands, commandQuery, showCommandMenu, selectedCommandIndex, resetCommandMenuState, handleCommandSelect, handleToggleCommandMenu, handleCommandInputChange, handleCommandMenuKeyDown };
}
