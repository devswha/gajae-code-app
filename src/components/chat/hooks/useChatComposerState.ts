import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, Dispatch, FormEvent, KeyboardEvent, MouseEvent, MutableRefObject, RefObject, SetStateAction, TouchEvent } from 'react';
import { useDropzone } from 'react-dropzone';

import { usePaletteOps } from '../../../stores/usePaletteOpsStore';
import type { MarkSessionProcessing } from '../../../hooks/useSessionProtection';
import type { CodeEditorDiffInfo, ChatMessage, PendingPermissionRequest, PermissionDecision, SessionEstablishedContext  } from '../types/types';
import type { LLMProvider, Project, ProjectSession, ProviderModelsCacheInfo } from '../../../types/app';
import { authenticatedFetch } from '../../../utils/api';
import { classifyCommandInput, isAutoSendable } from '../commandDispatchPolicy';
import { findAppUiCommand, getLocalCommandNotice, isAppUiCommand, resolveCommandAlias, runAppUiCommand, type AppUiCommand } from '../appUiCommands';
import { gateForCommand, type CommandGate } from '../commandGatePolicy';
import { escapeRegExp } from '../utils/chatFormatting';
import { clearQueuedMessages, draftInputKey, draftKeysToClear, readQueuedMessages, reorderQueue, safeLocalStorage, writeQueuedMessages, type QueuedSendOptions } from '../utils/chatStorage';
import { decideQueueFlush } from '../utils/queueFlush';

import { useFileMentions } from './useFileMentions';
import { type SlashCommand, useSlashCommands } from './useSlashCommands';

interface UseChatComposerStateArgs { selectedProject: Project | null; selectedSession: ProjectSession | null; currentSessionId: string | null; gjcModel: string; reasoningEffort?: string; isLoading: boolean; canAbortSession: boolean; tokenBudget: Record<string, unknown> | null; sendMessage: (message: unknown) => void; sendByCtrlEnter?: boolean; onSessionProcessing?: MarkSessionProcessing; onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void; onInputFocusChange?: (focused: boolean) => void; onCommandGateChange?: (gate: PendingCommandGate | null) => void; onFileOpen?: (filePath: string, diffInfo?: CodeEditorDiffInfo | null) => void; onShowSettings?: () => void; onLogin?: (providerId?: string) => void; scrollToBottom: () => void; addMessage: (msg: ChatMessage) => void; setIsUserScrolledUp: (isScrolledUp: boolean) => void; setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>; }
interface MentionableFile { name: string; path: string; }
interface CommandExecutionResult { type: 'builtin' | 'custom'; action?: string; data?: any; content?: string; hasBashCommands?: boolean; hasFileIncludes?: boolean; }
export type ModelCommandData = { current?: { provider?: string; providerLabel?: string; model?: string }; available?: Partial<Record<LLMProvider, string[]>>; availableModels?: string[]; availableOptions?: Array<{ value: string; label?: string; description?: string }>; defaultModel?: string; cache?: ProviderModelsCacheInfo; };
export type CostCommandData = { tokenUsage?: { used?: number; total?: number }; tokenBreakdown?: { input?: number; output?: number }; provider?: string; model?: string; };
export type StatusCommandData = { version?: string; packageName?: string; uptime?: string; model?: string; provider?: string; nodeVersion?: string; platform?: string; pid?: number; memoryUsage?: { rssMb?: number; heapUsedMb?: number; heapTotalMb?: number }; };
export type HelpCommandData = { content?: string; format?: string; commands?: Array<{ name: string; description?: string; namespace?: string }>; };
type CommandModalKind = 'help' | 'models' | 'cost' | 'status';
export type CommandModalPayload = { kind: CommandModalKind; data: HelpCommandData | ModelCommandData | CostCommandData | StatusCommandData; };
export type QueuedDraft = { content: string; images: File[]; options?: QueuedSendOptions; pendingSteer?: boolean; };
export type PendingCommandGate = CommandGate & { text: string };

const TURN_START_GRACE = 5000;
const STEER_REPLY_GRACE = 5000;
const syntheticSubmit = () => ({ preventDefault() {} }) as unknown as FormEvent<HTMLFormElement>;
const storedQueue = (id: string): QueuedDraft[] => readQueuedMessages(id).map(({ content, options }) => ({ content, options, images: [] }));
const shorten = (text: string) => { const compact = text.replace(/\s+/g, ' ').trim(); return compact ? (compact.length > 80 ? `${compact.slice(0, 77)}...` : compact) : null; };
const sessionLabel = (session: ProjectSession | null, input: string) => shorten(String(session?.summary || session?.name || session?.title || '')) || shorten(input);
const resetBox = (setInput: (value: string) => void, value: MutableRefObject<string>, setImages: (files: File[]) => void, setUploads: (items: Map<string, number>) => void, setErrors: (items: Map<string, string>) => void, resetCommands: () => void, setExpanded: (open: boolean) => void, area: RefObject<HTMLTextAreaElement | null>) => { setInput(''); value.current = ''; setImages([]); setUploads(new Map()); setErrors(new Map()); resetCommands(); setExpanded(false); if (area.current) area.current.style.height = 'auto'; };

export function useChatComposerState(args: UseChatComposerStateArgs) {
  const { selectedProject, selectedSession, currentSessionId, gjcModel, reasoningEffort = 'default', isLoading, canAbortSession, tokenBudget, sendMessage, sendByCtrlEnter, onSessionProcessing, onSessionEstablished, onInputFocusChange, onCommandGateChange, onFileOpen, onShowSettings, onLogin, scrollToBottom, addMessage, setIsUserScrolledUp, setPendingPermissionRequests } = args;
  const projectId = selectedProject?.projectId;
  const conversation = selectedSession?.id || currentSessionId || null;
  const [input, setInput] = useState(() => projectId && typeof window !== 'undefined' ? safeLocalStorage.getItem(draftInputKey(projectId, conversation)) || '' : '');
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [uploadingImages, setUploadingImages] = useState<Map<string, number>>(new Map());
  const [imageErrors, setImageErrors] = useState<Map<string, string>>(new Map());
  const [isTextareaExpanded, setExpanded] = useState(false);
  const [isInputFocused, setFocused] = useState(false);
  const [commandModalPayload, setModal] = useState<CommandModalPayload | null>(null);
  const [modelPickerTrigger, setModelPickerTrigger] = useState(0);
  const [pendingCommandGate, setGateState] = useState<PendingCommandGate | null>(null);
  const [queuedDrafts, setQueuedDrafts] = useState<QueuedDraft[]>(() => conversation && typeof window !== 'undefined' ? storedQueue(conversation) : []);
  const [queuePulse, setQueuePulse] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputHighlightRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef(input);
  const lineHeight = useRef<number | null>(null);
  const resized = useRef<string | null>(null);
  const submitRef = useRef<((event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>) => Promise<void>) | null>(null);
  const queueOwner = useRef<string | null>(conversation);
  const queueInFlight = useRef(false);
  const dispatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priorLoading = useRef(isLoading);
  const priorConversation = useRef(conversation);
  const bypassGate = useRef(false);
  const gateRef = useRef<PendingCommandGate | null>(null);
  const steerAnswer = useRef<(content: string, accepted: boolean) => void>(() => undefined);
  const steerWaiting = useRef(new Map<string, Array<{ draft: QueuedDraft; timer: ReturnType<typeof setTimeout> }>>());

  const eraseDraft = useCallback((settled?: string | null) => { if (projectId) draftKeysToClear(projectId, conversation, settled).forEach((key) => safeLocalStorage.removeItem(key)); }, [conversation, projectId]);
  const announceGate = useCallback((gate: PendingCommandGate | null) => { gateRef.current = gate; setGateState(gate); onCommandGateChange?.(gate); }, [onCommandGateChange]);
  const showBuiltin = useCallback((result: CommandExecutionResult) => {
    const data = result.data || {};
    if (result.action === 'help' || result.action === 'models' || result.action === 'status') { setModal({ kind: result.action, data }); return; }
    if (result.action === 'memory') {
      if (data.error) addMessage({ type: 'assistant', content: `Warning: ${data.message}`, timestamp: Date.now() });
      else { addMessage({ type: 'assistant', content: `${data.message}\n\nPath: \`${data.path}\``, timestamp: Date.now() }); if (data.exists) onFileOpen?.(data.path); }
      return;
    }
    if (result.action === 'config') { onShowSettings?.(); return; }
    console.warn('Unknown built-in command action:', result.action);
  }, [addMessage, onFileOpen, onShowSettings]);

  const login = useCallback((provider?: string) => { resetBox(setInput, inputRef, setAttachedImages, setUploadingImages, setImageErrors, () => undefined, setExpanded, textareaRef); eraseDraft(); onLogin?.(provider); }, [eraseDraft, onLogin]);
  const palette = usePaletteOps();
  const showCostModal = useCallback(() => { const parts = tokenBudget?.breakdown && typeof tokenBudget.breakdown === 'object' ? tokenBudget.breakdown as Record<string, unknown> : {}; const inTokens = Number(tokenBudget?.inputTokens ?? parts.input); const outTokens = Number(tokenBudget?.outputTokens ?? parts.output); const used = Number(tokenBudget?.used); const total = Number(tokenBudget?.total); setModal({ kind: 'cost', data: { tokenUsage: { used: Number.isFinite(used) ? used : (Number.isFinite(inTokens) ? inTokens : 0) + (Number.isFinite(outTokens) ? outTokens : 0), total: Number.isFinite(total) ? total : 0 }, ...(Number.isFinite(inTokens) || Number.isFinite(outTokens) ? { tokenBreakdown: { input: Number.isFinite(inTokens) ? inTokens : 0, output: Number.isFinite(outTokens) ? outTokens : 0 } } : {}), provider: typeof tokenBudget?.provider === 'string' ? tokenBudget.provider : 'gjc', model: typeof tokenBudget?.model === 'string' ? tokenBudget.model : gjcModel } }); }, [gjcModel, tokenBudget]);
  const applyAppCommand = useCallback((command: AppUiCommand) => runAppUiCommand(command, { openSessionPicker: palette.openSessionPicker, startNewChat: palette.startNewChat, openSettings: () => onShowSettings ? onShowSettings() : palette.openSettings(), openModelPicker: () => setModelPickerTrigger((n) => n + 1), openCostModal: showCostModal }), [onShowSettings, palette, showCostModal]);

  const executeCommand = useCallback(async (command: SlashCommand, raw?: string, config?: { preserveInput?: boolean }) => {
    if (!selectedProject) return;
    try {
      const text = raw ?? inputRef.current;
      const found = text.match(new RegExp(`${escapeRegExp(command.name)}\\s*(.*)`));
      const response = await authenticatedFetch('/api/commands/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commandName: command.name, commandPath: command.path, args: found?.[1] ? found[1].trim().split(/\s+/) : [], context: { projectId: selectedProject.projectId, sessionId: currentSessionId, provider: 'gjc', model: gjcModel, tokenUsage: tokenBudget } }) });
      if (!response.ok) { let message = `Failed to execute command (${response.status})`; try { const body = await response.json(); message = body?.message || body?.error || message; } catch { /* Use HTTP status when the error body is not JSON. */ } throw new Error(message); }
      const result = await response.json() as CommandExecutionResult;
      if (result.type === 'builtin') { showBuiltin(result); if (!config?.preserveInput) { setInput(''); inputRef.current = ''; } }
      else if (result.hasBashCommands && !window.confirm('This command contains bash commands that will be executed. Do you want to proceed?')) addMessage({ type: 'assistant', content: 'Command execution cancelled', timestamp: Date.now() });
      else if (result.type === 'custom') { const content = result.content || ''; setInput(content); inputRef.current = content; setTimeout(() => void submitRef.current?.(syntheticSubmit()), 0); }
    } catch (error) { const message = error instanceof Error ? error.message : 'Unknown error'; console.error('Error executing command:', error); addMessage({ type: 'assistant', content: `Error executing command: ${message}`, timestamp: Date.now() }); }
  }, [addMessage, currentSessionId, gjcModel, selectedProject, showBuiltin, tokenBudget]);

  const { slashCommands, slashCommandsCount, filteredCommands, frequentCommands, commandQuery, showCommandMenu, selectedCommandIndex, resetCommandMenuState, handleCommandSelect, handleToggleCommandMenu, handleCommandInputChange, handleCommandMenuKeyDown } = useSlashCommands({ selectedProject, provider: 'gjc', input, setInput, textareaRef, onExecuteCommand: executeCommand, onLoginCommand: login, onAppCommand: (command) => { const app = findAppUiCommand(command.name); if (app) applyAppCommand(app); } });
  const { showFileDropdown, filteredFiles, selectedFileIndex, renderInputWithMentions, selectFile, setCursorPosition, handleFileMentionsKeyDown } = useFileMentions({ selectedProject, input, setInput, textareaRef });
  const clearComposer = useCallback(() => resetBox(setInput, inputRef, setAttachedImages, setUploadingImages, setImageErrors, resetCommandMenuState, setExpanded, textareaRef), [resetCommandMenuState]);

  // Permissions are deliberately absent here: the policy is the project's, read
  // by the server when the run starts, so nothing the browser sends can widen it.
  const optionsFor = useCallback((text: string): QueuedSendOptions => ({ model: gjcModel, effort: reasoningEffort, sessionSummary: sessionLabel(selectedSession, text) }), [gjcModel, reasoningEffort, selectedSession]);
  const upload = useCallback(async (files: File[]) => { if (!files.length) return []; const body = new FormData(); files.forEach((file) => body.append('images', file)); const response = await authenticatedFetch('/api/assets/images', { method: 'POST', headers: {}, body }); if (!response.ok) throw new Error('Failed to upload images'); return (await response.json()).images as unknown[]; }, []);
  const allocate = useCallback(async (summary: string | null) => { let id = selectedSession ? (selectedSession.__provider === 'gjc' ? selectedSession.id : null) : currentSessionId; if (id) return id; const response = await authenticatedFetch('/api/providers/sessions', { method: 'POST', body: JSON.stringify({ provider: 'gjc', projectPath: selectedProject?.fullPath || selectedProject?.path || '' }) }); if (!response.ok) throw new Error(`Failed to create session (${response.status})`); id = (await response.json())?.data?.sessionId || null; if (!id) throw new Error('no session id returned.'); onSessionEstablished?.(id, { provider: 'gjc', project: selectedProject!, summary }); return id; }, [currentSessionId, onSessionEstablished, selectedProject, selectedSession]);

  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault(); const text = inputRef.current; if (!text.trim() || !selectedProject) return;
    const signIn = /^\/login(?:\s+(.*))?$/.exec(text.trim()); if (signIn) { login(signIn[1]?.trim() || undefined); resetCommandMenuState(); return; }
    if (isLoading) { queueOwner.current = conversation; setQueuedDrafts((q) => [...q, { content: text, images: attachedImages, options: optionsFor(text) }]); clearComposer(); eraseDraft(); return; }
    const candidate = text.trimEnd(); const help = candidate.trim().toLowerCase() === 'help';
    if (candidate.startsWith('/') || help) { const gap = candidate.indexOf(' '); const name = help ? '/help' : gap > 0 ? candidate.slice(0, gap) : candidate; const commandArgs = gap > 0 ? candidate.slice(gap).trim() : ''; const app = findAppUiCommand(resolveCommandAlias(name)); if (app && (app.interceptWithArgs !== false || !commandArgs)) { clearComposer(); applyAppCommand(app); return; } const notice = getLocalCommandNotice(name, commandArgs); if (notice) { clearComposer(); addMessage({ type: 'assistant', content: notice, timestamp: Date.now() }); return; } if (!bypassGate.current) { const gate = gateForCommand(resolveCommandAlias(name), commandArgs); if (gate) { clearComposer(); announceGate({ ...gate, text: candidate }); return; } } bypassGate.current = false; const registered = slashCommands.find((item) => item.name === name); if (registered && !isAppUiCommand(registered) && registered.type !== 'skill' && registered.type !== 'provider') { void executeCommand(registered, help ? '/help' : candidate); clearComposer(); return; } }
    let images: unknown[]; try { images = await upload(attachedImages); } catch (error) { const message = error instanceof Error ? error.message : 'Unknown error'; console.error('Image upload failed:', error); addMessage({ type: 'error', content: `Failed to upload images: ${message}`, timestamp: new Date() }); return; }
    const summary = sessionLabel(selectedSession, text); let id: string; try { id = await allocate(summary); } catch (error) { const message = error instanceof Error ? error.message : 'Unknown error'; console.error('Session creation failed:', error); addMessage({ type: 'error', content: `Failed to start a new session: ${message}`, timestamp: new Date() }); return; }
    addMessage({ type: 'user', content: text, images: images as any, timestamp: new Date() }); onSessionProcessing?.(id, { statusText: null, canInterrupt: true }); setIsUserScrolledUp(false); setTimeout(scrollToBottom, 100); sendMessage({ type: 'chat.send', sessionId: id, content: text, options: { ...optionsFor(text), images } }); clearComposer(); eraseDraft(id);
  }, [addMessage, allocate, announceGate, applyAppCommand, attachedImages, clearComposer, conversation, eraseDraft, executeCommand, isLoading, login, onSessionProcessing, optionsFor, resetCommandMenuState, scrollToBottom, selectedProject, selectedSession, sendMessage, setIsUserScrolledUp, slashCommands, upload]);
  useEffect(() => { submitRef.current = handleSubmit; }, [handleSubmit]);

  const handleSteer = useCallback((event: FormEvent<HTMLFormElement> | MouseEvent | TouchEvent | KeyboardEvent<HTMLTextAreaElement>) => { event.preventDefault(); const text = inputRef.current; const id = selectedSession?.id || currentSessionId || null; if (!isLoading || !text.trim() || !selectedProject || !id || attachedImages.length || !isAutoSendable(classifyCommandInput(text))) return; const draft = { content: text, images: [], options: optionsFor(text) }; const timer = setTimeout(() => steerAnswer.current(text, false), STEER_REPLY_GRACE); const pending = steerWaiting.current.get(text) || []; pending.push({ draft, timer }); steerWaiting.current.set(text, pending); queueOwner.current = conversation; setQueuedDrafts((q) => [...q, { ...draft, pendingSteer: true }]); sendMessage({ type: 'chat.steer', sessionId: id, content: text }); clearComposer(); eraseDraft(id); }, [attachedImages.length, clearComposer, conversation, currentSessionId, eraseDraft, isLoading, optionsFor, selectedProject, selectedSession?.id, sendMessage]);
  const resolveSteerResult = useCallback((content: string, accepted: boolean) => { const list = steerWaiting.current.get(content); const pending = list?.shift(); if (!pending) return; if (!list?.length) steerWaiting.current.delete(content); clearTimeout(pending.timer); if (!accepted) { setQueuedDrafts((q) => { const at = q.findIndex((item) => item.pendingSteer && item.content === content); if (at < 0) return [...q, pending.draft]; const copy = q.slice(); copy[at] = { ...copy[at], pendingSteer: false }; return copy; }); return; } setQueuedDrafts((q) => { const at = q.findIndex((item) => item.pendingSteer && item.content === content); return at < 0 ? q : q.filter((_, index) => index !== at); }); addMessage({ type: 'user', content: pending.draft.content, timestamp: new Date() } as never); const id = selectedSession?.id || currentSessionId; if (id) onSessionProcessing?.(id, { statusText: null, canInterrupt: true }); scrollToBottom(); }, [addMessage, currentSessionId, onSessionProcessing, scrollToBottom, selectedSession?.id]);
  useEffect(() => { steerAnswer.current = resolveSteerResult; }, [resolveSteerResult]);
  useEffect(() => () => { for (const list of steerWaiting.current.values()) list.forEach(({ timer }) => clearTimeout(timer)); steerWaiting.current.clear(); }, []);

  useEffect(() => { const switched = priorConversation.current !== conversation; priorConversation.current = conversation; const wasBusy = priorLoading.current; priorLoading.current = isLoading; if (isLoading) { queueInFlight.current = false; if (dispatchTimer.current) clearTimeout(dispatchTimer.current); } const head = queuedDrafts[0]; const verdict = decideQueueFlush({ sessionSwitched: switched, isLoading, wasLoading: wasBusy, queueLength: queuedDrafts.length, awaitingDispatchedTurn: queueInFlight.current, composerHasInput: Boolean(input.trim()), headAwaitingSteer: Boolean(head?.pendingSteer) }); if (verdict.action !== 'flush' || !head) return; const timer = setTimeout(() => { const disk = conversation ? readQueuedMessages(conversation) : []; if (conversation && disk.length < queuedDrafts.length) { setQueuedDrafts(storedQueue(conversation)); return; } queueInFlight.current = true; if (dispatchTimer.current) clearTimeout(dispatchTimer.current); dispatchTimer.current = setTimeout(() => { queueInFlight.current = false; setQueuePulse((n) => n + 1); }, TURN_START_GRACE); setQueuedDrafts((q) => q.slice(1)); setInput(head.content); inputRef.current = head.content; setAttachedImages(head.images); setTimeout(() => void submitRef.current?.(syntheticSubmit()), 0); }, verdict.delayMs); return () => clearTimeout(timer); }, [conversation, input, isLoading, queuePulse, queuedDrafts]);
  useEffect(() => () => { if (dispatchTimer.current) clearTimeout(dispatchTimer.current); }, []);
  useEffect(() => { if (!projectId) return; const value = safeLocalStorage.getItem(draftInputKey(projectId, conversation)) || ''; setInput((old) => { inputRef.current = value; return old === value ? old : value; }); }, [conversation, projectId]);
  useEffect(() => { if (!projectId) return; const key = draftInputKey(projectId, conversation); if (input) safeLocalStorage.setItem(key, input); else safeLocalStorage.removeItem(key); }, [conversation, input, projectId]);
  useEffect(() => { if (conversation && queueOwner.current === conversation) { if (queuedDrafts.length) writeQueuedMessages(conversation, queuedDrafts.map(({ content, options }) => ({ content, options }))); else clearQueuedMessages(conversation); } }, [conversation, queuedDrafts]);
  useEffect(() => { queueOwner.current = conversation; queueInFlight.current = false; setQueuedDrafts(conversation ? storedQueue(conversation) : []); }, [conversation]);

  const resize = useCallback((target: HTMLTextAreaElement) => { target.style.height = 'auto'; const height = Math.max(22, target.scrollHeight); target.style.height = `${height}px`; if (!lineHeight.current) { const parsed = parseInt(window.getComputedStyle(target).lineHeight); lineHeight.current = Number.isFinite(parsed) ? parsed : 24; } setExpanded(height > lineHeight.current * 2); resized.current = target.value; }, []);
  useEffect(() => { if (textareaRef.current && resized.current !== input) resize(textareaRef.current); }, [input, resize]);
  const handleImageFiles = useCallback((files: File[]) => { const accepted = files.filter((file) => { try { if (!file || typeof file !== 'object') { console.warn('Invalid file object:', file); return false; } if (!file.type?.startsWith('image/')) return false; if (!file.size || file.size > 5 * 1024 * 1024) { setImageErrors((old) => new Map(old).set(file.name || 'Unknown file', 'File too large (max 5MB)')); return false; } return true; } catch (error) { console.error('Error validating file:', error, file); return false; } }); if (accepted.length) setAttachedImages((old) => [...old, ...accepted].slice(0, 5)); }, []);
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({ accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'] }, maxSize: 5 * 1024 * 1024, maxFiles: 5, onDrop: handleImageFiles, noClick: true, noKeyboard: true });
  const handleInputChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => { const value = event.target.value; const position = event.target.selectionStart; setInput(value); inputRef.current = value; setCursorPosition(position); if (!value.trim()) { event.target.style.height = 'auto'; setExpanded(false); resetCommandMenuState(); } else handleCommandInputChange(value, position); }, [handleCommandInputChange, resetCommandMenuState, setCursorPosition]);
  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => { const items = Array.from(event.clipboardData.items); items.forEach((item) => { if (item.type.startsWith('image/')) { const file = item.getAsFile(); if (file) handleImageFiles([file]); } }); if (!items.length && event.clipboardData.files.length) handleImageFiles(Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))); }, [handleImageFiles]);
  const syncInputOverlayScroll = useCallback((target: HTMLTextAreaElement) => { if (inputHighlightRef.current) { inputHighlightRef.current.scrollTop = target.scrollTop; inputHighlightRef.current.scrollLeft = target.scrollLeft; } }, []);
  const handleTextareaInput = useCallback((event: FormEvent<HTMLTextAreaElement>) => { resize(event.currentTarget); setCursorPosition(event.currentTarget.selectionStart); syncInputOverlayScroll(event.currentTarget); }, [resize, setCursorPosition, syncInputOverlayScroll]);
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => { if (handleCommandMenuKeyDown(event) || handleFileMentionsKeyDown(event) || event.key !== 'Enter' || event.nativeEvent.isComposing) return; if ((event.ctrlKey || event.metaKey) && !event.shiftKey || (!event.shiftKey && !event.ctrlKey && !event.metaKey && !sendByCtrlEnter)) { event.preventDefault(); void handleSubmit(event); } }, [handleCommandMenuKeyDown, handleFileMentionsKeyDown, handleSubmit, sendByCtrlEnter]);
  const handleVoiceTranscript = useCallback((text: string, send?: boolean) => { const next = inputRef.current.trim() ? `${inputRef.current.trim()} ${text}` : text; setInput(next); inputRef.current = next; if (send) void submitRef.current?.(syntheticSubmit()); }, []);
  const editQueuedDraft = useCallback((index: number) => setQueuedDrafts((q) => { const item = q[index]; if (!item) return q; setInput(item.content); inputRef.current = item.content; setAttachedImages(item.images); textareaRef.current?.focus(); return q.filter((_, position) => position !== index); }), []);
  const deleteQueuedDraft = useCallback((index: number) => setQueuedDrafts((q) => q.filter((_, position) => position !== index)), []);
  const moveQueuedDraft = useCallback((from: number, to: number) => setQueuedDrafts((q) => reorderQueue(q, from, to)), []);
  const confirmCommandGate = useCallback(() => { const gate = gateRef.current; if (!gate) return; announceGate(null); bypassGate.current = true; setInput(gate.text); inputRef.current = gate.text; void handleSubmit(syntheticSubmit()); }, [announceGate, handleSubmit]);
  const cancelCommandGate = useCallback(() => { announceGate(null); bypassGate.current = false; }, [announceGate]);
  const handleClearInput = useCallback(() => { clearComposer(); textareaRef.current?.focus(); }, [clearComposer]);
  // The Changes tab's line comments arrive here: one new paragraph with the
  // reference and the quote, focus moved to the composer, ready to send.
  const insertAtEnd = useCallback((text: string) => { if (!text.trim()) return; const next = inputRef.current.trim() ? `${inputRef.current.trimEnd()}\n\n${text}` : text; setInput(next); inputRef.current = next; textareaRef.current?.focus(); }, []);
  const handleAbortSession = useCallback(() => { if (!canAbortSession) return; const id = selectedSession?.id || currentSessionId; if (!id) { console.warn('Abort requested but no session ID is available.'); return; } sendMessage({ type: 'chat.abort', sessionId: id }); }, [canAbortSession, currentSessionId, selectedSession?.id, sendMessage]);
  const handlePermissionDecision = useCallback((requestIds: string | string[], decision: PermissionDecision) => { const ids = (Array.isArray(requestIds) ? requestIds : [requestIds]).filter(Boolean); ids.forEach((requestId) => sendMessage({ type: 'chat.permission-response', requestId, allow: Boolean(decision?.allow), ...(decision?.allow && decision?.always ? { always: true } : {}), updatedInput: decision?.updatedInput, message: decision?.message })); if (ids.length) setPendingPermissionRequests((requests) => requests.filter((request) => !ids.includes(request.requestId))); }, [sendMessage, setPendingPermissionRequests]);
  const handleInputFocusChange = useCallback((focused: boolean) => { setFocused(focused); onInputFocusChange?.(focused); }, [onInputFocusChange]);
  return { input, setInput, textareaRef, inputHighlightRef, isTextareaExpanded, slashCommandsCount, skillCommands: slashCommands.filter((command) => command.type === 'skill'), filteredCommands, frequentCommands, commandQuery, showCommandMenu, selectedCommandIndex, resetCommandMenuState, handleCommandSelect, handleToggleCommandMenu, showFileDropdown, filteredFiles: filteredFiles as MentionableFile[], selectedFileIndex, renderInputWithMentions, selectFile, attachedImages, setAttachedImages, uploadingImages, imageErrors, getRootProps, getInputProps, isDragActive, openImagePicker: open, handleSubmit, handleSteer, modelPickerTrigger, queuedDrafts, editQueuedDraft, deleteQueuedDraft, moveQueuedDraft, resolveSteerResult, pendingCommandGate, confirmCommandGate, cancelCommandGate, handleVoiceTranscript, insertAtEnd, handleInputChange, handleKeyDown, handlePaste, handleTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => setCursorPosition(event.currentTarget.selectionStart), handleTextareaInput, syncInputOverlayScroll, handleClearInput, handleAbortSession, handlePermissionDecision, handleInputFocusChange, isInputFocused, commandModalPayload, closeCommandModal: () => setModal(null), showCostModal };
}
