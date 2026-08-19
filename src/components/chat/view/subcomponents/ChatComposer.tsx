import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  RefObject,
  ReactNode,
  TouchEvent,
} from 'react';
import type { DropzoneInputProps, DropzoneRootProps } from 'react-dropzone';
import { PlusIcon, Loader2, ArrowUpIcon, ForwardIcon } from 'lucide-react';

import { classifyCommandInput, isAutoSendable } from '../../commandDispatchPolicy';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoiceAvailable } from '../../hooks/useVoiceAvailable';
import type { PendingCommandGate, QueuedDraft } from '../../hooks/useChatComposerState';
import type { SessionActivity } from '../../../../hooks/useSessionProtection';
import type { PendingPermissionRequest } from '../../types/types';
import type { ProviderModelOption } from '../../../../types/app';
import {
  PromptInput,
  PromptInputHeader,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from '../../../../shared/view/ui';

import CommandMenu from './CommandMenu';
import ActivityIndicator from './ActivityIndicator';
import ImageAttachment from './ImageAttachment';
import VoiceInputButton from './VoiceInputButton';
import PermissionRequestsBanner from './PermissionRequestsBanner';
import TokenUsageSummary from './TokenUsageSummary';
import QueuedMessageCard from './QueuedMessageCard';
import CommandGateCard from './CommandGateCard';
import AgentConfigurationPicker from './AgentConfigurationPicker';
import ModelAndReasoningPicker from './ModelAndReasoningPicker';
import ContextUsageBadge from './ContextUsageBadge';
import type { ReasoningEffort } from './reasoningEffort';
import SkillPicker from './SkillPicker';

interface MentionableFile {
  name: string;
  path: string;
}

interface SlashCommand {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ChatComposerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; updatedInput?: unknown },
  ) => void;
  activity: SessionActivity | null;
  isLoading: boolean;
  onAbortSession: () => void;
  tokenBudget: Record<string, unknown> | null;
  sessionState: Record<string, unknown> | null;
  onShowTokenUsage: () => void;
  onSubmit: (
    event: FormEvent<HTMLFormElement>
      | MouseEvent<HTMLButtonElement>
      | TouchEvent<HTMLButtonElement>
      | KeyboardEvent<HTMLTextAreaElement>,
  ) => void;
  onSteer: (event: MouseEvent<HTMLButtonElement>) => void;
  isDragActive: boolean;
  /** Model pinned to this session, if any; outranks the last-run model. */
  sessionPinnedModel?: string | null;
  queuedDrafts: QueuedDraft[];
  onEditQueuedDraft: (index: number) => void;
  onDeleteQueuedDraft: (index: number) => void;
  onMoveQueuedDraft: (from: number, to: number) => void;
  pendingCommandGate: PendingCommandGate | null;
  onConfirmCommandGate: () => void;
  onCancelCommandGate: () => void;
  attachedImages: File[];
  onRemoveImage: (index: number) => void;
  uploadingImages: Map<string, number>;
  imageErrors: Map<string, string>;
  showFileDropdown: boolean;
  filteredFiles: MentionableFile[];
  selectedFileIndex: number;
  onSelectFile: (file: MentionableFile) => void;
  filteredCommands: SlashCommand[];
  skillCommands: SlashCommand[];
  selectedCommandIndex: number;
  onCommandSelect: (command: SlashCommand, index: number, isHover: boolean) => void;
  onCloseCommandMenu: () => void;
  isCommandMenuOpen: boolean;
  frequentCommands: SlashCommand[];
  getRootProps: <T extends DropzoneRootProps>(props?: T) => T;
  getInputProps: <T extends DropzoneInputProps>(props?: T) => T;
  openImagePicker: () => void;
  inputHighlightRef: RefObject<HTMLDivElement>;
  renderInputWithMentions: (text: string) => ReactNode;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  onVoiceTranscript?: (text: string, send?: boolean) => void;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextareaClick: (event: MouseEvent<HTMLTextAreaElement>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaScrollSync: (target: HTMLTextAreaElement) => void;
  onTextareaInput: (event: FormEvent<HTMLTextAreaElement>) => void;
  isInputFocused?: boolean;
  onInputFocusChange?: (focused: boolean) => void;
  placeholder: string;
  isTextareaExpanded: boolean;
  sendByCtrlEnter?: boolean;
  modelPreset?: string;
  modelPresetOptions?: ProviderModelOption[];
  modelOptions?: ProviderModelOption[];
  modelPresetsLoading?: boolean;
  /** Monotonic signal: each increment opens the model preset popup. */
  modelPickerOpenTrigger?: number;
  onSelectModelPreset?: (value: string) => Promise<unknown> | unknown;
  reasoningEffort?: ReasoningEffort;
  onSelectReasoningEffort?: (value: ReasoningEffort) => void;
}

export default function ChatComposer({
  pendingPermissionRequests,
  handlePermissionDecision,
  activity,
  isLoading,
  onAbortSession,
  tokenBudget,
  sessionState,
  onShowTokenUsage,
  onSubmit,
  onSteer,
  isDragActive,
  sessionPinnedModel,
  queuedDrafts,
  onEditQueuedDraft,
  onDeleteQueuedDraft,
  onMoveQueuedDraft,
  pendingCommandGate,
  onConfirmCommandGate,
  onCancelCommandGate,
  attachedImages,
  onRemoveImage,
  uploadingImages,
  imageErrors,
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
  filteredCommands,
  skillCommands,
  selectedCommandIndex,
  onCommandSelect,
  onCloseCommandMenu,
  isCommandMenuOpen,
  frequentCommands,
  getRootProps,
  getInputProps,
  openImagePicker,
  inputHighlightRef,
  renderInputWithMentions,
  textareaRef,
  input,
  onVoiceTranscript,
  onInputChange,
  onTextareaClick,
  onTextareaKeyDown,
  onTextareaPaste,
  onTextareaScrollSync,
  onTextareaInput,
  isInputFocused = false,
  onInputFocusChange,
  placeholder,
  isTextareaExpanded,
  sendByCtrlEnter,
  modelPreset = 'default',
  modelPresetOptions = [],
  modelOptions = [],
  modelPresetsLoading,
  modelPickerOpenTrigger,
  onSelectModelPreset = () => {},
  reasoningEffort = 'default',
  onSelectReasoningEffort = () => {},
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const commandMenuPosition = useMemo(() => {
    if (!isCommandMenuOpen) {
      return { top: 0, left: 16, bottom: 90 };
    }
    const textareaRect = textareaRef.current?.getBoundingClientRect();
    return {
      top: textareaRect ? Math.max(16, textareaRect.top - 316) : 0,
      left: textareaRect ? textareaRect.left : 16,
      bottom: textareaRect ? window.innerHeight - textareaRect.top + 8 : 90,
    };
  }, [isCommandMenuOpen, textareaRef]);

  // Voice state is hosted here (not in the mic button) so the main Send button can stop
  // recording and send the transcript in one tap, the way the mic button drops it in the box.
  const voiceAvailable = useVoiceAvailable();
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleVoiceError = useCallback((msg: string) => {
    setVoiceError(msg);
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
    voiceErrorTimer.current = setTimeout(() => setVoiceError(null), 4000);
  }, []);
  useEffect(() => () => {
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
  }, []);
  const noopTranscript = useCallback(() => {}, []);
  const { state: voiceState, toggle: voiceToggle, stop: voiceStop } = useVoiceInput(
    onVoiceTranscript ?? noopTranscript,
    handleVoiceError,
  );
  const isRecording = voiceState === 'recording';
  const isTranscribing = voiceState === 'transcribing';

  // Detect if the AskUserQuestion interactive panel is active
  const hasQuestionPanel = pendingPermissionRequests.some(
    (r) => r.toolName === 'AskUserQuestion'
  );

  // Hide the thinking/status bar while any permission request is pending
  const hasPendingPermissions = pendingPermissionRequests.length > 0;
  const hasActivityIndicator = Boolean(activity && !hasPendingPermissions);
  const handleFormSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    onSubmit(event);
  }, [onSubmit]);

  // What the NEXT turn will run: a session's pinned model outranks the model
  // it last ran with, because the backend resolves the pin when dispatching.
  const reportedModel = typeof sessionState?.modelId === 'string' && sessionState.modelId.trim()
    ? sessionState.modelId.trim()
    : undefined;
  const displayedModel = sessionPinnedModel?.trim() || reportedModel;

  const canQueueDraft = isLoading && Boolean(input.trim());
  const canSteer = canQueueDraft
    && attachedImages.length === 0
    && isAutoSendable(classifyCommandInput(input));
  const submitHint = canQueueDraft
    ? t('input.hintText.queue')
    : sendByCtrlEnter
      ? t('input.hintText.ctrlEnter')
      : t('input.hintText.enter');
  const submitAriaLabel = canQueueDraft
    ? t('input.queue.sendNext')
    : isLoading
      ? t('input.stop')
      : t('input.send');

  return (
    <div className="chat-composer-shell relative flex-shrink-0 px-2 pb-2 pt-0 sm:px-4 sm:pb-4 md:px-4 md:pb-6">
      {!hasPendingPermissions && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 w-[calc(100%-1rem)] max-w-[54.25rem] -translate-x-1/2 translate-y-px bg-transparent sm:w-[calc(100%-2rem)]">
          <ActivityIndicator activity={activity} onAbort={onAbortSession} isInputFocused={isInputFocused} />
        </div>
      )}

      {pendingPermissionRequests.length > 0 && (
        <div className="mx-auto mb-3 max-w-[54.25rem]">
          <PermissionRequestsBanner
            pendingPermissionRequests={pendingPermissionRequests}
            handlePermissionDecision={handlePermissionDecision}
          />
        </div>
      )}

      {pendingCommandGate && (
        <CommandGateCard
          text={pendingCommandGate.text}
          summary={pendingCommandGate.summary}
          classified={pendingCommandGate.classified}
          onConfirm={onConfirmCommandGate}
          onCancel={onCancelCommandGate}
        />
      )}

      {queuedDrafts.map((draft, index) => (
        <QueuedMessageCard
          key={`${index}:${draft.content}`}
          content={draft.content}
          imageCount={draft.images.length}
          position={index + 1}
          total={queuedDrafts.length}
          onEdit={() => onEditQueuedDraft(index)}
          onDelete={() => onDeleteQueuedDraft(index)}
          onMoveUp={index > 0 ? () => onMoveQueuedDraft(index, index - 1) : undefined}
          onMoveDown={index < queuedDrafts.length - 1 ? () => onMoveQueuedDraft(index, index + 1) : undefined}
        />
      ))}

      {!hasQuestionPanel && <div className="relative mx-auto max-w-[54.25rem]">
        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-xl border border-border/50 bg-card/95 shadow-lg backdrop-blur-md">
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`cursor-pointer touch-manipulation border-b border-border/30 px-4 py-3 last:border-b-0 ${
                  index === selectedFileIndex
                    ? 'bg-primary/8 text-primary'
                    : 'text-foreground hover:bg-accent/50'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectFile(file);
                }}
              >
                <div className="text-sm font-medium">{file.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{file.path}</div>
              </div>
            ))}
          </div>
        )}

        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={onCommandSelect}
          onClose={onCloseCommandMenu}
          position={commandMenuPosition}
          isOpen={isCommandMenuOpen}
          frequentCommands={frequentCommands}
        />

        <PromptInput
          onSubmit={handleFormSubmit}
          status={isLoading ? 'streaming' : 'ready'}
          className={[
            isTextareaExpanded ? 'chat-input-expanded' : '',
            hasActivityIndicator ? 'rounded-t-none' : '',
          ].filter(Boolean).join(' ')}
          {...getRootProps()}
        >
          {isDragActive && (
            <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-primary/15">
              <div className="rounded-xl border border-border/30 bg-card p-4 shadow-lg">
                <svg className="mx-auto mb-2 h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <p className="text-sm font-medium">Drop images here</p>
              </div>
            </div>
          )}
          {attachedImages.length > 0 && (
            <PromptInputHeader>
              <div className="rounded-xl bg-muted/40 p-2">
                <div className="flex flex-wrap gap-2">
                  {attachedImages.map((file, index) => (
                    <ImageAttachment
                      key={index}
                      file={file}
                      onRemove={() => onRemoveImage(index)}
                      uploadProgress={uploadingImages.get(file.name)}
                      error={imageErrors.get(file.name)}
                    />
                  ))}
                </div>
              </div>
            </PromptInputHeader>
          )}

          <input {...getInputProps()} />

          <PromptInputBody>
            <div ref={inputHighlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
              <div className="chat-input-placeholder block w-full whitespace-pre-wrap break-words px-4 py-2 text-sm leading-6 text-transparent">
                {renderInputWithMentions(input)}
              </div>
            </div>

            <PromptInputTextarea
              ref={textareaRef}
              dir="auto"
              value={input}
              onChange={onInputChange}
              onClick={onTextareaClick}
              onKeyDown={onTextareaKeyDown}
              onPaste={onTextareaPaste}
              onScroll={(event) => onTextareaScrollSync(event.currentTarget)}
              onFocus={() => onInputFocusChange?.(true)}
              onBlur={() => onInputFocusChange?.(false)}
              onInput={onTextareaInput}
              placeholder={placeholder}
            />
        </PromptInputBody>

        <PromptInputFooter>
          <PromptInputTools className="min-w-0 overflow-hidden">

            <PromptInputButton
              tooltip={{ content: t('input.attachImages') }}
              onClick={openImagePicker}
            >
              <PlusIcon />
            </PromptInputButton>

            {onVoiceTranscript && voiceAvailable && (
              <VoiceInputButton state={voiceState} onToggle={voiceToggle} errorMsg={voiceError} />
            )}

            {modelPresetOptions.length > 0 && (
              <ModelAndReasoningPicker
                value={modelPreset}
                currentModel={displayedModel}
                presetOptions={modelPresetOptions}
                modelOptions={modelOptions}
                loading={modelPresetsLoading}
                onSelect={onSelectModelPreset}
                reasoningEffort={reasoningEffort}
                onSelectReasoningEffort={onSelectReasoningEffort}
              />
            )}

            {modelPresetOptions.length > 0 && (
              <AgentConfigurationPicker
                value={modelPreset}
                options={modelPresetOptions}
                loading={modelPresetsLoading}
                openTrigger={modelPickerOpenTrigger}
                iconOnly
                onSelect={onSelectModelPreset}
              />
            )}

            <SkillPicker
              skills={skillCommands}
              onSelect={(skill, index) => onCommandSelect(skill, index, false)}
            />

            <ContextUsageBadge sessionState={sessionState} />

            <div className="hidden sm:block">
              <TokenUsageSummary usage={tokenBudget} onClick={onShowTokenUsage} />
            </div>

          </PromptInputTools>

          <div className="flex shrink-0 items-center gap-2">
            {(canQueueDraft || sendByCtrlEnter) && (
              <div
                className={`hidden text-xs text-muted-foreground/50 transition-opacity duration-200 lg:block ${
                  input.trim() && !canQueueDraft ? 'opacity-0' : 'opacity-100'
                }`}
              >
                {submitHint}
              </div>
            )}
            {canSteer && (
              <PromptInputButton
                onClick={onSteer}
                tooltip={{ content: t('input.queue.steerNow') }}
                aria-label={t('input.queue.steerNow')}
                className="shrink-0 rounded-full border border-border/70 bg-background/70 text-muted-foreground hover:border-primary/30 hover:text-foreground"
              >
                <ForwardIcon />
              </PromptInputButton>
            )}
            <PromptInputSubmit
              onClick={
                canQueueDraft
                  ? (e: MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      onSubmit(e);
                    }
                    : isLoading
                    ? onAbortSession
                    : isRecording
                      ? (e: MouseEvent<HTMLButtonElement>) => {
                          e.preventDefault();
                          voiceStop({ send: true });
                        }
                      : undefined
              }
              disabled={isLoading ? false : isRecording ? false : isTranscribing ? true : !input.trim()}
              aria-label={submitAriaLabel}
              title={submitAriaLabel}
              className="h-10 w-10 sm:h-10 sm:w-10"
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUpIcon className="h-4 w-4" />
              )}
            </PromptInputSubmit>
          </div>
        </PromptInputFooter>
      </PromptInput>
      </div>}
    </div>
  );
}
