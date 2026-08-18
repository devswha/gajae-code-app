import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SetStateAction,
  TouchEvent,
} from 'react';
import { useDropzone } from 'react-dropzone';

import { authenticatedFetch } from '../../../utils/api';
import { usePaletteOps } from '../../../contexts/PaletteOpsContext';
import type { MarkSessionProcessing } from '../../../hooks/useSessionProtection';
import type { CodeEditorDiffInfo } from '../../code-editor/types/types';
import { classifyCommandInput, isAutoSendable } from '../commandDispatchPolicy';
import { decideQueueFlush } from '../utils/queueFlush';
import {
  clearQueuedMessages,
  readQueuedMessages,
  reorderQueue,
  safeLocalStorage,
  writeQueuedMessages,
  type QueuedSendOptions,
} from '../utils/chatStorage';
import type {
  ChatMessage,
  PendingPermissionRequest,
  SessionEstablishedContext,
} from '../types/types';
import type { Project, ProjectSession, LLMProvider, ProviderModelsCacheInfo } from '../../../types/app';
import { escapeRegExp } from '../utils/chatFormatting';
import {
  findAppUiCommand,
  getLocalCommandNotice,
  isAppUiCommand,
  resolveCommandAlias,
  runAppUiCommand,
  type AppUiCommand,
} from '../appUiCommands';
import { gateForCommand, type CommandGate } from '../commandGatePolicy';

import { useFileMentions } from './useFileMentions';
import { type SlashCommand, useSlashCommands } from './useSlashCommands';

interface UseChatComposerStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  gjcModel: string;
  reasoningEffort?: string;
  isLoading: boolean;
  canAbortSession: boolean;
  tokenBudget: Record<string, unknown> | null;
  sendMessage: (message: unknown) => void;
  sendByCtrlEnter?: boolean;
  onSessionProcessing?: MarkSessionProcessing;
  /**
   * Invoked with the freshly allocated session id when the user sends the
   * first message of a brand-new conversation. The backend allocates the id
   * via POST /api/providers/sessions BEFORE the websocket send, so the id is
   * stable for the conversation's whole lifetime — the consumer navigates to
   * /session/:id and records it as the current session.
   */
  onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void;
  onInputFocusChange?: (focused: boolean) => void;
  /** Notified whenever a runtime form starts or stops waiting on confirmation. */
  onCommandGateChange?: (gate: PendingCommandGate | null) => void;
  onFileOpen?: (filePath: string, diffInfo?: CodeEditorDiffInfo | null) => void;
  onShowSettings?: () => void;
  onLogin?: (providerId?: string) => void;
  scrollToBottom: () => void;
  addMessage: (msg: ChatMessage) => void;
  setIsUserScrolledUp: (isScrolledUp: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
}

interface MentionableFile {
  name: string;
  path: string;
}

interface CommandExecutionResult {
  type: 'builtin' | 'custom';
  action?: string;
  data?: any;
  content?: string;
  hasBashCommands?: boolean;
  hasFileIncludes?: boolean;
}

export type ModelCommandData = {
  current?: {
    provider?: string;
    providerLabel?: string;
    model?: string;
  };
  available?: Partial<Record<LLMProvider, string[]>>;
  availableModels?: string[];
  availableOptions?: Array<{
    value: string;
    label?: string;
    description?: string;
  }>;
  defaultModel?: string;
  cache?: ProviderModelsCacheInfo;
};

export type CostCommandData = {
  tokenUsage?: {
    used?: number;
    total?: number;
  };
  tokenBreakdown?: {
    input?: number;
    output?: number;
  };
  provider?: string;
  model?: string;
};

export type StatusCommandData = {
  version?: string;
  packageName?: string;
  uptime?: string;
  model?: string;
  provider?: string;
  nodeVersion?: string;
  platform?: string;
  pid?: number;
  memoryUsage?: {
    rssMb?: number;
    heapUsedMb?: number;
    heapTotalMb?: number;
  };
};

export type HelpCommandData = {
  content?: string;
  format?: string;
  commands?: Array<{
    name: string;
    description?: string;
    namespace?: string;
  }>;
};

export type CommandModalKind = 'help' | 'models' | 'cost' | 'status';

export type CommandModalPayload = {
  kind: CommandModalKind;
  data: HelpCommandData | ModelCommandData | CostCommandData | StatusCommandData;
};

/**
 * How long a dispatched queue message gets to turn into a run before the queue
 * is allowed to move again. A real send marks the session processing in the
 * same tick, so this only ever expires for a submit that never started a turn.
 */
const DISPATCH_SETTLE_MS = 5000;

/**
 * How long a steer waits for the runtime's answer before the message is queued
 * instead. Only a lost connection ever reaches it; the answer is a local
 * round-trip.
 */
const STEER_ANSWER_TIMEOUT_MS = 5000;

const createFakeSubmitEvent = () => {
  return { preventDefault: () => undefined } as unknown as FormEvent<HTMLFormElement>;
};

export type QueuedDraft = {
  content: string;
  images: File[];
  /**
   * Send options snapshotted at queue time. Persisted with the draft so the
   * app-level auto-send can dispatch the message with the right model and
   * permission settings while another session is being viewed.
   */
  options?: QueuedSendOptions;
};

/** A runtime form held at the confirmation card, plus the exact text to replay. */
export type PendingCommandGate = CommandGate & { text: string };

const restoreQueuedDrafts = (sessionKey: string): QueuedDraft[] =>
  // Image attachments can't survive a reload; only text and options persist.
  readQueuedMessages(sessionKey).map((saved) => ({ content: saved.content, images: [], options: saved.options }));

const getNotificationSessionSummary = (
  selectedSession: ProjectSession | null,
  fallbackInput: string,
): string | null => {
  const sessionSummary = selectedSession?.summary || selectedSession?.name || selectedSession?.title;
  if (typeof sessionSummary === 'string' && sessionSummary.trim()) {
    const normalized = sessionSummary.replace(/\s+/g, ' ').trim();
    return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
  }

  const normalizedFallback = fallbackInput.replace(/\s+/g, ' ').trim();
  if (!normalizedFallback) {
    return null;
  }

  return normalizedFallback.length > 80 ? `${normalizedFallback.slice(0, 77)}...` : normalizedFallback;
};

export function useChatComposerState({
  selectedProject,
  selectedSession,
  currentSessionId,
  gjcModel,
  reasoningEffort = 'default',
  isLoading,
  canAbortSession,
  tokenBudget,
  sendMessage,
  sendByCtrlEnter,
  onSessionProcessing,
  onSessionEstablished,
  onInputFocusChange,
  onCommandGateChange,
  onFileOpen,
  onShowSettings,
  onLogin,
  scrollToBottom,
  addMessage,
  setIsUserScrolledUp,
  setPendingPermissionRequests,
}: UseChatComposerStateArgs) {
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      // Draft inputs are keyed by the DB projectId so per-project drafts
      // survive display-name changes.
      return safeLocalStorage.getItem(`draft_input_${selectedProject.projectId}`) || '';
    }
    return '';
  });
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [uploadingImages, setUploadingImages] = useState<Map<string, number>>(new Map());
  const [imageErrors, setImageErrors] = useState<Map<string, string>>(new Map());
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [commandModalPayload, setCommandModalPayload] = useState<CommandModalPayload | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const textareaLineHeightRef = useRef<number | null>(null);
  const lastAutosizedInputRef = useRef<string | null>(null);
  const handleSubmitRef = useRef<
    ((event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>) => Promise<void>) | null
  >(null);
  const inputValueRef = useRef(input);
  const selectedProjectId = selectedProject?.projectId;
  // Prefer the stable backend-allocated id (selectedSession.id) but fall back
  // to currentSessionId for a just-established session that hasn't been
  // handed back to the parent's `selectedSession` prop yet.
  const sessionKey = selectedSession?.id || currentSessionId || null;

  const [queuedDrafts, setQueuedDrafts] = useState<QueuedDraft[]>(() => {
    if (typeof window === 'undefined' || !sessionKey) {
      return [];
    }
    return restoreQueuedDrafts(sessionKey);
  });
  // Which session the in-memory queue belongs to. On a session switch there is
  // one commit where `sessionKey` already points at the new session while
  // `queuedDrafts` still holds the old session's queue; the persistence effect
  // must not write across that gap.
  const queuedDraftSessionRef = useRef<string | null>(sessionKey);
  // Messages handed to a running turn, waiting for the runtime to say whether
  // it took them. Keyed by text: the answer echoes the content, and identical
  // texts resolve in the order they were sent.
  const pendingSteersRef = useRef(new Map<string, Array<{ draft: QueuedDraft; timer: ReturnType<typeof setTimeout> }>>());
  // Submitting captures this before the resolver below exists, and the resolver
  // changes identity with the session; the ref keeps the late call current.
  const resolveSteerRef = useRef<(content: string, steered: boolean) => void>(() => undefined);

  // A runtime form waiting on confirmation. Nothing has been sent while this is
  // set; the text is held here rather than in the input so an accidental Enter
  // cannot re-submit it. The ref lets the confirmed replay pass back through
  // handleSubmit exactly once without re-gating itself.
  const [pendingCommandGate, setPendingCommandGateState] = useState<PendingCommandGate | null>(null);
  const confirmedGateRef = useRef(false);
  // The single writer, so no transition can reach the state without also
  // reaching the observer.
  const pendingCommandGateRef = useRef<PendingCommandGate | null>(null);
  const setPendingCommandGate = useCallback((gate: PendingCommandGate | null) => {
    pendingCommandGateRef.current = gate;
    setPendingCommandGateState(gate);
    onCommandGateChange?.(gate);
  }, [onCommandGateChange]);

  const handleBuiltInCommand = useCallback(
    (result: CommandExecutionResult) => {
      const { action, data } = result;
      switch (action) {
        case 'help':
          setCommandModalPayload({
            kind: 'help',
            data: (data || {}) as HelpCommandData,
          });
          break;

        case 'models':
          setCommandModalPayload({
            kind: 'models',
            data: (data || {}) as ModelCommandData,
          });
          break;

        case 'cost': {
          setCommandModalPayload({
            kind: 'cost',
            data: (data || {}) as CostCommandData,
          });
          break;
        }

        case 'status': {
          setCommandModalPayload({
            kind: 'status',
            data: (data || {}) as StatusCommandData,
          });
          break;
        }

        case 'memory':
          if (data.error) {
            addMessage({
              type: 'assistant',
              content: `Warning: ${data.message}`,
              timestamp: Date.now(),
            });
          } else {
            addMessage({
              type: 'assistant',
              content: `${data.message}\n\nPath: \`${data.path}\``,
              timestamp: Date.now(),
            });
            if (data.exists && onFileOpen) {
              onFileOpen(data.path);
            }
          }
          break;

        case 'config':
          onShowSettings?.();
          break;

        default:
          console.warn('Unknown built-in command action:', action);
      }
    },
    [onFileOpen, onShowSettings, addMessage],
  );

  const closeCommandModal = useCallback(() => {
    setCommandModalPayload(null);
  }, []);

  const handleCustomCommand = useCallback(async (result: CommandExecutionResult) => {
    const { content, hasBashCommands } = result;

    if (hasBashCommands) {
      const confirmed = window.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?',
      );
      if (!confirmed) {
        addMessage({
          type: 'assistant',
          content: 'Command execution cancelled',
          timestamp: Date.now(),
        });
        return;
      }
    }

    const commandContent = content || '';
    setInput(commandContent);
    inputValueRef.current = commandContent;

    // Defer submit to next tick so the command text is reflected in UI before dispatching.
    setTimeout(() => {
      if (handleSubmitRef.current) {
        handleSubmitRef.current(createFakeSubmitEvent());
      }
    }, 0);
  }, [addMessage]);

  const executeCommand = useCallback(
    async (command: SlashCommand, rawInput?: string, options?: { preserveInput?: boolean }) => {
      if (!command || !selectedProject) {
        return;
      }

      try {
        const effectiveInput = rawInput ?? input;
        const commandMatch = effectiveInput.match(new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`));
        const args =
          commandMatch && commandMatch[1] ? commandMatch[1].trim().split(/\s+/) : [];

        // The server resolves this opaque project ID to its trusted filesystem
        // path instead of accepting a caller-controlled command root.
        const context = {
          projectId: selectedProject.projectId,
          sessionId: currentSessionId,
          provider: 'gjc',
          model: gjcModel,
          tokenUsage: tokenBudget,
        };

        const response = await authenticatedFetch('/api/commands/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            commandName: command.name,
            commandPath: command.path,
            args,
            context,
          }),
        });

        if (!response.ok) {
          let errorMessage = `Failed to execute command (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData?.message || errorData?.error || errorMessage;
          } catch {
            // Ignore JSON parse failures and use fallback message.
          }
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as CommandExecutionResult;
        if (result.type === 'builtin') {
          handleBuiltInCommand(result);
          if (!options?.preserveInput) {
            setInput('');
            inputValueRef.current = '';
          }
        } else if (result.type === 'custom') {
          await handleCustomCommand(result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error executing command:', error);
        addMessage({
          type: 'assistant',
          content: `Error executing command: ${message}`,
          timestamp: Date.now(),
        });
      }
    },
    [
      currentSessionId,
      gjcModel,
      handleBuiltInCommand,
      handleCustomCommand,
      input,
      selectedProject,
      addMessage,
      tokenBudget,
    ],
  );

  const handleLoginCommand = useCallback((providerId?: string) => {
    setInput('');
    inputValueRef.current = '';
    setAttachedImages([]);
    setUploadingImages(new Map());
    setImageErrors(new Map());
    setIsTextareaExpanded(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    if (selectedProject) {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.projectId}`);
    }
    onLogin?.(providerId);
  }, [onLogin, selectedProject]);

  const showCostModal = useCallback(() => {
    executeCommand(
      {
        name: '/cost',
        description: 'Display token usage information',
        namespace: 'builtin',
        metadata: { type: 'builtin' },
      } as SlashCommand,
      '/cost',
      { preserveInput: true },
    );
  }, [executeCommand]);

  // App-level slash commands (/resume, /sessions, /new, /settings) run local
  // UI actions instead of reaching the provider. Falls back to no-ops when no
  // PaletteOpsProvider is mounted (e.g. isolated tests).
  // Monotonic signal consumed by the composer's ModelPresetPicker: each bump
  // opens the picker popup (same pattern as newSessionTrigger).
  const [modelPickerTrigger, setModelPickerTrigger] = useState(0);
  const paletteOps = usePaletteOps();
  const runResolvedAppCommand = useCallback(
    (command: AppUiCommand) => {
      runAppUiCommand(command, {
        openSessionPicker: paletteOps.openSessionPicker,
        startNewChat: paletteOps.startNewChat,
        openSettings: () => {
          if (onShowSettings) {
            onShowSettings();
          } else {
            paletteOps.openSettings();
          }
        },
        openModelPicker: () => {
          setModelPickerTrigger((previous) => previous + 1);
        },
      });
    },
    [onShowSettings, paletteOps],
  );
  const handleAppCommand = useCallback(
    (command: SlashCommand) => {
      const appCommand = findAppUiCommand(command.name);
      if (appCommand) {
        runResolvedAppCommand(appCommand);
      }
    },
    [runResolvedAppCommand],
  );

  const {
    slashCommands,
    slashCommandsCount,
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
  } = useSlashCommands({
    selectedProject,
    provider: 'gjc',
    input,
    setInput,
    textareaRef,
    onExecuteCommand: executeCommand,
    onLoginCommand: handleLoginCommand,
    onAppCommand: handleAppCommand,
  });

  const {
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  } = useFileMentions({
    selectedProject,
    input,
    setInput,
    textareaRef,
  });

  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => {
    if (!inputHighlightRef.current || !target) {
      return;
    }
    inputHighlightRef.current.scrollTop = target.scrollTop;
    inputHighlightRef.current.scrollLeft = target.scrollLeft;
  }, []);

  const resizeTextarea = useCallback((target: HTMLTextAreaElement) => {
    target.style.height = 'auto';
    const nextHeight = Math.max(22, target.scrollHeight);
    target.style.height = `${nextHeight}px`;

    let lineHeight = textareaLineHeightRef.current;
    if (!lineHeight) {
      lineHeight = parseInt(window.getComputedStyle(target).lineHeight);
      textareaLineHeightRef.current = Number.isFinite(lineHeight) ? lineHeight : 24;
    }

    const expanded = nextHeight > (textareaLineHeightRef.current || 24) * 2;
    setIsTextareaExpanded((previous) => previous === expanded ? previous : expanded);
    lastAutosizedInputRef.current = target.value;
  }, []);

  const handleImageFiles = useCallback((files: File[]) => {
    const validFiles = files.filter((file) => {
      try {
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return false;
        }

        if (!file.type || !file.type.startsWith('image/')) {
          return false;
        }

        if (!file.size || file.size > 5 * 1024 * 1024) {
          const fileName = file.name || 'Unknown file';
          setImageErrors((previous) => {
            const next = new Map(previous);
            next.set(fileName, 'File too large (max 5MB)');
            return next;
          });
          return false;
        }

        return true;
      } catch (error) {
        console.error('Error validating file:', error, file);
        return false;
      }
    });

    if (validFiles.length > 0) {
      setAttachedImages((previous) => [...previous, ...validFiles].slice(0, 5));
    }
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData.items);

      items.forEach((item) => {
        if (!item.type.startsWith('image/')) {
          return;
        }
        const file = item.getAsFile();
        if (file) {
          handleImageFiles([file]);
        }
      });

      if (items.length === 0 && event.clipboardData.files.length > 0) {
        const files = Array.from(event.clipboardData.files);
        const imageFiles = files.filter((file) => file.type.startsWith('image/'));
        if (imageFiles.length > 0) {
          handleImageFiles(imageFiles);
        }
      }
    },
    [handleImageFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'],
    },
    maxSize: 5 * 1024 * 1024,
    maxFiles: 5,
    onDrop: handleImageFiles,
    noClick: true,
    noKeyboard: true,
  });

  // Snapshot of everything `chat.send` needs beyond the text itself. Built at
  // send time for immediate sends and at queue time for queued ones, so a
  // queued message keeps the provider settings it was composed under even if
  // it is later dispatched outside this composer (app-level auto-send).
  const buildSendOptions = useCallback((currentInput: string): QueuedSendOptions => {
    const getToolsSettings = () => {
      try {
        const settingsKey = 'gjc-tools-settings';
        const savedSettings = safeLocalStorage.getItem(settingsKey);
        if (savedSettings) {
          return JSON.parse(savedSettings);
        }
      } catch (error) {
        console.error('Error loading tools settings:', error);
      }

      return {
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: false,
      };
    };

    const toolsSettings = getToolsSettings();
    return {
      model: gjcModel,
      effort: reasoningEffort,
      permissionMode: 'default',
      toolsSettings,
      skipPermissions: toolsSettings?.skipPermissions || false,
      sessionSummary: getNotificationSessionSummary(selectedSession, currentInput),
    };
  }, [gjcModel, reasoningEffort, selectedSession]);

  const handleSubmit = useCallback(
    async (
      event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>,
    ) => {
      event.preventDefault();
      const currentInput = inputValueRef.current;
      if (!currentInput.trim() || !selectedProject) {
        return;
      }

      const loginMatch = /^\/login(?:\s+(.*))?$/.exec(currentInput.trim());
      if (loginMatch) {
        handleLoginCommand(loginMatch[1]?.trim() || undefined);
        resetCommandMenuState();
        return;
      }

      // A turn is already in flight: stash this message instead of sending it.
      // It's auto-flushed (re-running this same function) once the turn ends,
      // so it still goes through slash-command interception, image upload, etc.
      if (isLoading) {
        queuedDraftSessionRef.current = sessionKey;
        const draft: QueuedDraft = {
          content: currentInput,
          images: attachedImages,
          options: buildSendOptions(currentInput),
        };

        // Prose goes straight into the running turn; the runtime's own steering
        // queue is what makes that safe. A slash command needs this composer's
        // interception and an image needs the upload path, so both wait for a
        // turn of their own. Appended, not replaced: a second thought while the
        // turn runs is another follow-up, not a correction of the first one.
        const steerTarget = selectedSession?.id || currentSessionId || null;
        const canSteer = Boolean(steerTarget)
          && draft.images.length === 0
          && isAutoSendable(classifyCommandInput(currentInput));

        if (canSteer) {
          const waiting = pendingSteersRef.current.get(currentInput) ?? [];
          const timer = setTimeout(() => {
            // No answer came back; queue it rather than leave it in limbo.
            resolveSteerRef.current(currentInput, false);
          }, STEER_ANSWER_TIMEOUT_MS);
          waiting.push({ draft, timer });
          pendingSteersRef.current.set(currentInput, waiting);
          sendMessage({ type: 'chat.steer', sessionId: steerTarget, content: currentInput });
        } else {
          setQueuedDrafts((previous) => [...previous, draft]);
        }
        setInput('');
        inputValueRef.current = '';
        setAttachedImages([]);
        setUploadingImages(new Map());
        setImageErrors(new Map());
        resetCommandMenuState();
        setIsTextareaExpanded(false);
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
        // selectedProject is guaranteed by the guard at the top of handleSubmit.
        safeLocalStorage.removeItem(`draft_input_${selectedProject.projectId}`);
        return;
      }

      // Intercept slash commands only when "/" is the first input character.
      // Also accept exact "help" as a convenience alias for users who expect CLI-style help.
      const commandInput = currentInput.trimEnd();
      const isHelpAlias = commandInput.trim().toLowerCase() === 'help';
      if (commandInput.startsWith('/') || isHelpAlias) {
        const firstSpace = commandInput.indexOf(' ');
        const commandName = isHelpAlias
          ? '/help'
          : firstSpace > 0 ? commandInput.slice(0, firstSpace) : commandInput;

        const clearComposerInput = () => {
          setInput('');
          inputValueRef.current = '';
          setAttachedImages([]);
          setUploadingImages(new Map());
          setImageErrors(new Map());
          resetCommandMenuState();
          setIsTextareaExpanded(false);
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
          }
        };

        // App-level UI commands (checked against the static registry so they
        // work even when the provider command fetch failed). Commands marked
        // interceptWithArgs:false (e.g. /model) only intercept the bare form;
        // "/model gpt-x" flows through to the provider text runtime below.
        // Aliases resolve first, so "/models" behaves as "/model" does.
        const commandArgs = firstSpace > 0 ? commandInput.slice(firstSpace).trim() : '';
        const appCommand = findAppUiCommand(resolveCommandAlias(commandName));
        if (appCommand && (appCommand.interceptWithArgs !== false || !commandArgs)) {
          clearComposerInput();
          runResolvedAppCommand(appCommand);
          return;
        }

        // Commands the app answers locally: GJC TUI-only ones, and runtime
        // commands the app deliberately declines. Either way a notice beats
        // silently forwarding the text to the model as a plain prompt.
        const localNotice = getLocalCommandNotice(commandName, commandArgs);
        if (localNotice) {
          clearComposerInput();
          addMessage({
            type: 'assistant',
            content: localNotice,
            timestamp: Date.now(),
          });
          return;
        }

        // Destructive, auth-bearing, external or unclassified runtime forms
        // stop here. Nothing is sent until the user confirms, so the action
        // never starts — unlike the tool-approval banner, which asks about
        // work the server has already begun.
        if (!confirmedGateRef.current) {
          const gate = gateForCommand(resolveCommandAlias(commandName), commandArgs);
          if (gate) {
            clearComposerInput();
            setPendingCommandGate({ ...gate, text: commandInput });
            return;
          }
        }
        confirmedGateRef.current = false;
        const matchedCommand = slashCommands.find((cmd: SlashCommand) => cmd.name === commandName);
        if (
          matchedCommand &&
          !isAppUiCommand(matchedCommand) &&
          matchedCommand.type !== 'skill' &&
          matchedCommand.type !== 'provider'
        ) {
          executeCommand(matchedCommand, isHelpAlias ? '/help' : commandInput);
          clearComposerInput();
          return;
        }
      }

      const messageContent = currentInput;

      let uploadedImages: unknown[] = [];
      if (attachedImages.length > 0) {
        const formData = new FormData();
        attachedImages.forEach((file) => {
          formData.append('images', file);
        });

        try {
          const response = await authenticatedFetch('/api/assets/images', {
            method: 'POST',
            headers: {},
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Failed to upload images');
          }

          const result = await response.json();
          uploadedImages = result.images;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Image upload failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to upload images: ${message}`,
            timestamp: new Date(),
          });
          return;
        }
      }

      const resolvedProjectPath = selectedProject.fullPath || selectedProject.path || '';
      const sessionSummary = getNotificationSessionSummary(selectedSession, currentInput);

      // Historical sessions remain readable, but only an existing GJC session
      // may be resumed. Sending while viewing a legacy session starts a new GJC
      // session through the gateway.
      let targetSessionId = selectedSession
        ? (selectedSession.__provider === 'gjc' ? selectedSession.id : null)
        : currentSessionId;
      if (!targetSessionId) {
        try {
          const response = await authenticatedFetch('/api/providers/sessions', {
            method: 'POST',
            body: JSON.stringify({
              provider: 'gjc',
              projectPath: resolvedProjectPath,
            }),
          });
          if (!response.ok) {
            throw new Error(`Failed to create session (${response.status})`);
          }
          const body = await response.json();
          targetSessionId = body?.data?.sessionId || null;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error('Session creation failed:', error);
          addMessage({
            type: 'error',
            content: `Failed to start a new session: ${message}`,
            timestamp: new Date(),
          });
          return;
        }

        if (!targetSessionId) {
          addMessage({
            type: 'error',
            content: 'Failed to start a new session: no session id returned.',
            timestamp: new Date(),
          });
          return;
        }

        onSessionEstablished?.(targetSessionId, {
          provider: 'gjc',
          project: selectedProject,
          summary: sessionSummary,
        });
      }

      const userMessage: ChatMessage = {
        type: 'user',
        content: currentInput,
        images: uploadedImages as any,
        timestamp: new Date(),
      };

      addMessage(userMessage);
      // Mark this request as processing in the per-session activity map (the
      // single source of truth the indicator derives from). The id is always
      // concrete at this point — no pending placeholder exists anymore.
      onSessionProcessing?.(targetSessionId, {
        statusText: null,
        canInterrupt: true,
      });

      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);

      // The GJC session gateway owns provider and resume state; options carry
      // only GJC composer preferences.
      sendMessage({
        type: 'chat.send',
        sessionId: targetSessionId,
        content: messageContent,
        options: {
          ...buildSendOptions(messageContent),
          images: uploadedImages,
        },
      });

      setInput('');
      inputValueRef.current = '';
      resetCommandMenuState();
      setAttachedImages([]);
      setUploadingImages(new Map());
      setImageErrors(new Map());
      setIsTextareaExpanded(false);

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      safeLocalStorage.removeItem(`draft_input_${selectedProject.projectId}`);
    },
    [
      selectedSession,
      attachedImages,
      buildSendOptions,
      currentSessionId,
      executeCommand,
      handleLoginCommand,
      isLoading,
      onSessionProcessing,
      onSessionEstablished,
      resetCommandMenuState,
      runResolvedAppCommand,
      scrollToBottom,
      selectedProject,
      sendMessage,
      setPendingCommandGate,
      sessionKey,
      addMessage,
      setIsUserScrolledUp,
      slashCommands,
    ],
  );

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  // Once the in-flight turn ends, replay the queued draft through the normal
  // submit path (slash commands, image upload, etc. all still apply).
  const wasLoadingRef = useRef(isLoading);
  const flushSessionKeyRef = useRef(sessionKey);
  // A boolean rather than the text itself, so the flush effect re-runs when the
  // composer becomes empty instead of on every keystroke.
  const composerHasInput = Boolean(input.trim());
  // Set the moment a queued message is dispatched, cleared once that send has
  // actually put the session back into a run. Without it a multi-message queue
  // empties in one burst: the dispatch does not flip `isLoading` synchronously,
  // so the very next render would see an idle session and flush again.
  const awaitingDispatchedTurnRef = useRef(false);
  const dispatchSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Re-runs the flush effect after the settle window; nothing else can, because
  // the gate below is a ref rather than state.
  const [flushTick, setFlushTick] = useState(0);
  useEffect(() => {
    const wasLoading = wasLoadingRef.current;
    wasLoadingRef.current = isLoading;

    // A session switch changes which session `isLoading` describes, so this
    // transition says nothing about the queue's own session. Never flush across
    // it — the swap effect below replaces `queuedDrafts` with the new
    // session's saved queue right after this.
    const sessionSwitched = flushSessionKeyRef.current !== sessionKey;
    flushSessionKeyRef.current = sessionKey;

    if (isLoading) {
      // The dispatched message is running: the queue may move again when it ends.
      awaitingDispatchedTurnRef.current = false;
      if (dispatchSettleTimerRef.current) {
        clearTimeout(dispatchSettleTimerRef.current);
        dispatchSettleTimerRef.current = null;
      }
    }

    const head = queuedDrafts[0];
    const decision = decideQueueFlush({
      sessionSwitched,
      isLoading,
      wasLoading,
      queueLength: queuedDrafts.length,
      awaitingDispatchedTurn: awaitingDispatchedTurnRef.current,
      composerHasInput,
    });
    if (decision.action !== 'flush' || !head) {
      return;
    }

    const timer = setTimeout(() => {
      // Storage is the claim ticket shared with the app-level auto-send (which
      // handles sessions that finish while not viewed). If it already took this
      // head, adopt what is actually left instead of sending it twice.
      const stored = sessionKey ? readQueuedMessages(sessionKey) : [];
      if (sessionKey && stored.length < queuedDrafts.length) {
        setQueuedDrafts(stored.map((saved) => ({ content: saved.content, images: [], options: saved.options })));
        return;
      }
      awaitingDispatchedTurnRef.current = true;
      // A submit that never becomes a run — an app-level slash command, a
      // rejected upload — must not strand the rest of the queue forever.
      if (dispatchSettleTimerRef.current) clearTimeout(dispatchSettleTimerRef.current);
      dispatchSettleTimerRef.current = setTimeout(() => {
        dispatchSettleTimerRef.current = null;
        awaitingDispatchedTurnRef.current = false;
        setFlushTick((tick) => tick + 1);
      }, DISPATCH_SETTLE_MS);
      setQueuedDrafts((previous) => previous.slice(1));
      setInput(head.content);
      inputValueRef.current = head.content;
      setAttachedImages(head.images);
      setTimeout(() => {
        handleSubmitRef.current?.(createFakeSubmitEvent());
      }, 0);
    }, decision.delayMs);
    return () => clearTimeout(timer);
  }, [composerHasInput, flushTick, isLoading, queuedDrafts, sessionKey, setInput]);

  useEffect(() => () => {
    if (dispatchSettleTimerRef.current) clearTimeout(dispatchSettleTimerRef.current);
  }, []);

  /** Pulls one queued message back into the composer for editing. */
  const editQueuedDraft = useCallback((index: number) => {
    setQueuedDrafts((previous) => {
      const target = previous[index];
      if (!target) {
        return previous;
      }
      setInput(target.content);
      inputValueRef.current = target.content;
      setAttachedImages(target.images);
      textareaRef.current?.focus();
      return previous.filter((_, position) => position !== index);
    });
  }, [setInput]);

  /** Puts a draft at the back of the queue. */
  const enqueueDraft = useCallback((draft: QueuedDraft) => {
    queuedDraftSessionRef.current = sessionKey;
    setQueuedDrafts((previous) => [...previous, draft]);
  }, [sessionKey]);

  /**
   * Settles one steer attempt.
   *
   * A message the runtime took is rendered as sent, because the running turn
   * now has it. A refusal is queued instead — the turn settled first, or this
   * provider cannot steer — so nothing the user typed is ever dropped.
   */
  const resolveSteerResult = useCallback((content: string, steered: boolean) => {
    const waiting = pendingSteersRef.current.get(content);
    const pending = waiting?.shift();
    if (!pending) {
      return;
    }
    if (waiting && waiting.length === 0) pendingSteersRef.current.delete(content);
    clearTimeout(pending.timer);

    if (!steered) {
      enqueueDraft(pending.draft);
      return;
    }

    const targetSessionId = selectedSession?.id || currentSessionId || null;
    addMessage({
      type: 'user',
      content: pending.draft.content,
      timestamp: new Date(),
    } as never);
    if (targetSessionId) {
      onSessionProcessing?.(targetSessionId, { statusText: null, canInterrupt: true });
    }
    scrollToBottom?.();
  }, [addMessage, currentSessionId, enqueueDraft, onSessionProcessing, scrollToBottom, selectedSession?.id]);

  useEffect(() => {
    resolveSteerRef.current = resolveSteerResult;
  }, [resolveSteerResult]);

  // A closing composer must not leave steer timers running.
  useEffect(() => () => {
    for (const waiting of pendingSteersRef.current.values()) {
      for (const pending of waiting) clearTimeout(pending.timer);
    }
    pendingSteersRef.current.clear();
  }, []);

  const deleteQueuedDraft = useCallback((index: number) => {
    setQueuedDrafts((previous) => previous.filter((_, position) => position !== index));
  }, []);

  /** Reorders the queue, which is also the send order. */
  const moveQueuedDraft = useCallback((from: number, to: number) => {
    setQueuedDrafts((previous) => reorderQueue(previous, from, to));
  }, []);

  // Confirming replays the exact text through the normal submit path, so the
  // command takes the same route it would have taken without a gate.
  const confirmCommandGate = useCallback(() => {
    // Read through the ref: the caller may hold a handle from before the gate
    // was raised, and confirming has to act on what is actually pending.
    const gate = pendingCommandGateRef.current;
    if (!gate) {
      return;
    }
    setPendingCommandGate(null);
    confirmedGateRef.current = true;
    // handleSubmit reads inputValueRef, so seeding it makes the replay send the
    // held text verbatim. Called directly rather than through handleSubmitRef:
    // this is a click handler, not an effect dodging a dependency cycle.
    setInput(gate.text);
    inputValueRef.current = gate.text;
    void handleSubmit(createFakeSubmitEvent());
  }, [handleSubmit, setInput, setPendingCommandGate]);

  // Cancelling drops the text. Nothing was sent, so there is nothing to undo.
  const cancelCommandGate = useCallback(() => {
    setPendingCommandGate(null);
    confirmedGateRef.current = false;
  }, [setPendingCommandGate]);

  // A voice transcript either fills the input (to edit before sending) or, when the
  // user tapped "stop and send", is submitted straight away. Mirror the value into
  // inputValueRef synchronously so handleSubmit reads the new text, not the stale state.
  const handleVoiceTranscript = useCallback((text: string, send?: boolean) => {
    const base = inputValueRef.current.trim();
    const next = base ? `${base} ${text}` : text;
    setInput(next);
    inputValueRef.current = next;
    if (send) handleSubmitRef.current?.(createFakeSubmitEvent());
  }, [setInput]);

  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    const savedInput = safeLocalStorage.getItem(`draft_input_${selectedProjectId}`) || '';
    setInput((previous) => {
      const next = previous === savedInput ? previous : savedInput;
      inputValueRef.current = next;
      return next;
    });
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    if (input !== '') {
      safeLocalStorage.setItem(`draft_input_${selectedProjectId}`, input);
    } else {
      safeLocalStorage.removeItem(`draft_input_${selectedProjectId}`);
    }
  }, [input, selectedProjectId]);

  // Persist the queue under its session's key. Must be defined BEFORE the swap
  // effect below: on a session switch there is one commit where `sessionKey`
  // already points at the new session while `queuedDrafts` (and the owner ref)
  // still describe the old one — the ref mismatch makes this effect skip that
  // commit instead of writing/clearing across sessions.
  useEffect(() => {
    if (!sessionKey || queuedDraftSessionRef.current !== sessionKey) {
      return;
    }
    if (queuedDrafts.length > 0) {
      writeQueuedMessages(sessionKey, queuedDrafts.map(({ content, options }) => ({ content, options })));
    } else {
      clearQueuedMessages(sessionKey);
    }
  }, [queuedDrafts, sessionKey]);

  // Switching sessions swaps in that session's queue (image attachments can't
  // survive a reload, so only text and options restore).
  useEffect(() => {
    queuedDraftSessionRef.current = sessionKey;
    // A different session's run says nothing about this one's queue.
    awaitingDispatchedTurnRef.current = false;
    if (!sessionKey) {
      setQueuedDrafts([]);
      return;
    }
    setQueuedDrafts(restoreQueuedDrafts(sessionKey));
  }, [sessionKey]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }
    if (lastAutosizedInputRef.current === input) {
      return;
    }
    // Re-run for restored drafts and programmatic input changes. User typing is
    // already resized in onInput, so this avoids doing the same forced layout twice.
    resizeTextarea(textareaRef.current);
  }, [input, resizeTextarea]);

  useEffect(() => {
    if (!textareaRef.current || input.trim()) {
      return;
    }
    textareaRef.current.style.height = 'auto';
    setIsTextareaExpanded(false);
  }, [input]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value;
      const cursorPos = event.target.selectionStart;

      setInput(newValue);
      inputValueRef.current = newValue;
      setCursorPosition(cursorPos);

      if (!newValue.trim()) {
        event.target.style.height = 'auto';
        setIsTextareaExpanded(false);
        resetCommandMenuState();
        return;
      }

      handleCommandInputChange(newValue, cursorPos);
    },
    [handleCommandInputChange, resetCommandMenuState, setCursorPosition],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleCommandMenuKeyDown(event)) {
        return;
      }

      if (handleFileMentionsKeyDown(event)) {
        return;
      }


      if (event.key === 'Enter') {
        if (event.nativeEvent.isComposing) {
          return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          event.preventDefault();
          handleSubmit(event);
        } else if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !sendByCtrlEnter) {
          event.preventDefault();
          handleSubmit(event);
        }
      }
    },
    [
      handleCommandMenuKeyDown,
      handleFileMentionsKeyDown,
      handleSubmit,
      sendByCtrlEnter,
    ],
  );

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCursorPosition(event.currentTarget.selectionStart);
    },
    [setCursorPosition],
  );

  const handleTextareaInput = useCallback(
    (event: FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      resizeTextarea(target);
      setCursorPosition(target.selectionStart);
      syncInputOverlayScroll(target);
    },
    [resizeTextarea, setCursorPosition, syncInputOverlayScroll],
  );

  const handleClearInput = useCallback(() => {
    setInput('');
    inputValueRef.current = '';
    resetCommandMenuState();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    setIsTextareaExpanded(false);
  }, [resetCommandMenuState]);

  const handleAbortSession = useCallback(() => {
    if (!canAbortSession) {
      return;
    }

    const targetSessionId = selectedSession?.id || currentSessionId || null;
    if (!targetSessionId) {
      console.warn('Abort requested but no session ID is available.');
      return;
    }

    // The backend resolves the provider from the session row, so no provider
    // field is needed here.
    sendMessage({
      type: 'chat.abort',
      sessionId: targetSessionId,
    });
  }, [canAbortSession, currentSessionId, selectedSession?.id, sendMessage]);


  const handlePermissionDecision = useCallback(
    (
      requestIds: string | string[],
      decision: { allow?: boolean; message?: string; updatedInput?: unknown },
    ) => {
      const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
      const validIds = ids.filter(Boolean);
      if (validIds.length === 0) {
        return;
      }

      validIds.forEach((requestId) => {
        sendMessage({
          type: 'chat.permission-response',
          requestId,
          allow: Boolean(decision?.allow),
          updatedInput: decision?.updatedInput,
          message: decision?.message,
        });
      });

      setPendingPermissionRequests((previous) =>
        previous.filter((request) => !validIds.includes(request.requestId)),
      );
    },
    [sendMessage, setPendingPermissionRequests],
  );

  const [isInputFocused, setIsInputFocused] = useState(false);

  const handleInputFocusChange = useCallback(
    (focused: boolean) => {
      setIsInputFocused(focused);
      onInputFocusChange?.(focused);
    },
    [onInputFocusChange],
  );

  return {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    slashCommandsCount,
    skillCommands: slashCommands.filter((command) => command.type === 'skill'),
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles: filteredFiles as MentionableFile[],
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedImages,
    setAttachedImages,
    uploadingImages,
    imageErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openImagePicker: open,
    handleSubmit,
    modelPickerTrigger,
    queuedDrafts,
    editQueuedDraft,
    deleteQueuedDraft,
    moveQueuedDraft,
    resolveSteerResult,
    pendingCommandGate,
    confirmCommandGate,
    cancelCommandGate,
    handleVoiceTranscript,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handlePermissionDecision,
    handleInputFocusChange,
    isInputFocused,
    commandModalPayload,
    closeCommandModal,
    showCostModal,
  };
}
