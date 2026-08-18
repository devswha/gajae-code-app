import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangleIcon, InfoIcon, OctagonAlertIcon } from 'lucide-react';

import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type {
  ChatMessage,
  Provider,
  ToolResult,
} from '../../types/types';
import type { CodeEditorDiffInfo } from '../../../code-editor/types/types';
import { formatUsageLimitText } from '../../utils/chatFormatting';
import type { Project } from '../../../../types/app';
import { ToolRenderer, shouldHideToolResult } from '../../tools';
import { Reasoning, ReasoningTrigger, ReasoningContent } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';

import ChatMessageImages from './ChatMessageImages';
import { Markdown } from './Markdown';
import MessageCopyControl from './MessageCopyControl';
import MessageSpeakControl from './MessageSpeakControl';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

type MessageComponentProps = {
  message: ChatMessage;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileOpen?: (filePath: string, diffInfo?: CodeEditorDiffInfo | null) => void;
  onShowSettings?: () => void;
  showRawParameters?: boolean;
  showThinking?: boolean;
  showImagePreviews?: boolean;
  selectedProject?: Project | null;
  provider: Provider | string;
};

type InteractiveOption = {
  number: string;
  text: string;
  isSelected: boolean;
};

const COPY_HIDDEN_TOOL_NAMES = new Set(['Bash', 'Edit', 'Write', 'ApplyPatch']);

/**
 * System notices sit between chat turns as a quiet record of something the agent
 * did to the run itself — an interrupted response, a model fallback, a
 * compaction that rewrote history. They are deliberately calmer than an `error`
 * row (which means the turn failed) but must stay legible at a glance.
 */
const NOTICE_STYLES = {
  info: {
    Icon: InfoIcon,
    container: 'border-border/60 bg-muted/40 text-muted-foreground',
    icon: 'text-muted-foreground',
  },
  warning: {
    Icon: AlertTriangleIcon,
    container: 'border-amber-300/60 bg-amber-50/60 text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/20 dark:text-amber-100',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  error: {
    Icon: OctagonAlertIcon,
    container: 'border-red-300/60 bg-red-50/60 text-red-900 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-100',
    icon: 'text-red-600 dark:text-red-400',
  },
} as const;

const MessageComponent = memo(({ message, prevMessage, createDiff, onFileOpen, showRawParameters, showThinking, showImagePreviews = true, selectedProject, provider }: MessageComponentProps) => {
  // A transcript stored by another agent still needs its name; the live GJC
  // session does not, because every turn in it comes from the same agent.
  const isForeignProviderTurn = provider !== 'gjc' && message.type !== 'tool';
  const { t } = useTranslation('chat');
  const isGrouped = prevMessage && prevMessage.type === message.type &&
    ((prevMessage.type === 'assistant') ||
      (prevMessage.type === 'user') ||
      (prevMessage.type === 'tool') ||
      (prevMessage.type === 'error'));
  const messageRef = useRef<HTMLDivElement | null>(null);
  const userCopyContent = String(message.content || '');
  const formattedMessageContent = useMemo(
    () => formatUsageLimitText(String(message.content || '')),
    [message.content]
  );
  const assistantCopyContent = message.isToolUse
    ? String(message.displayText || message.content || '')
    : formattedMessageContent;
  const isCommandOrFileEditToolResponse = Boolean(
    message.isToolUse && COPY_HIDDEN_TOOL_NAMES.has(String(message.toolName || ''))
  );
  const shouldShowUserCopyControl = message.type === 'user' && userCopyContent.trim().length > 0;
  const shouldShowAssistantCopyControl = message.type === 'assistant' &&
    assistantCopyContent.trim().length > 0 &&
    !isCommandOrFileEditToolResponse &&
    !message.isThinking;


  const formattedTime = useMemo(() => new Date(message.timestamp).toLocaleTimeString(), [message.timestamp]);
  const shouldHideThinkingMessage = Boolean(message.isThinking && !showThinking);

  const [fullToolResult, setFullToolResult] = useState<ToolResult | null>(null);
  const [isLoadingFullToolResult, setIsLoadingFullToolResult] = useState(false);
  const [fullToolResultError, setFullToolResultError] = useState(false);
  useEffect(() => {
    setFullToolResult(null);
    setIsLoadingFullToolResult(false);
    setFullToolResultError(false);
  }, [message.sessionId, message.toolId]);
  const effectiveToolResult = fullToolResult ?? message.toolResult;

  const loadFullToolResult = async () => {
    if (!message.sessionId || !message.toolId || isLoadingFullToolResult) return;
    setIsLoadingFullToolResult(true);
    setFullToolResultError(false);
    try {
      const params = new URLSearchParams({ toolId: message.toolId });
      const response = await authenticatedFetch(
        `/api/providers/sessions/${encodeURIComponent(message.sessionId)}/tool-result?${params}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const data = body?.data ?? body;
      const result = data.toolResult as ToolResult | null | undefined;
      if (!result) {
        throw new Error('Missing tool result');
      }
      const content = typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content ?? '', null, 2);
      setFullToolResult({ ...result, content });
    } catch {
      setFullToolResultError(true);
    } finally {
      setIsLoadingFullToolResult(false);
    }
  };

  if (shouldHideThinkingMessage) {
    return null;
  }

  return (
    <div
      ref={messageRef}
      data-message-timestamp={message.timestamp || undefined}
      className={`chat-message group/turn ${message.type} ${isGrouped ? 'grouped' : ''} ${message.type === 'user' ? 'flex justify-end px-3 sm:px-0' : 'px-3 sm:px-0'}`}
    >
      {message.type === 'user' ? (
        /* User turn on the right. No avatar: one column of blue bubbles on the
           right already says who is speaking, and the badge only pushed the
           bubble inward on every desktop row. */
        <div className="flex w-full items-end sm:w-auto sm:max-w-[85%] md:max-w-md lg:max-w-lg xl:max-w-xl">
          <div className="flex min-w-0 flex-1 flex-col items-end gap-2 sm:flex-initial">
            {showImagePreviews && message.images && message.images.length > 0 && (
              <ChatMessageImages
                images={message.images}
                projectId={selectedProject?.projectId}
              />
            )}
            {userCopyContent.trim().length > 0 || !message.images?.length ? (
              <div className="group max-w-full rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-white shadow-sm sm:px-4">
                <div dir="auto" className="whitespace-pre-wrap break-words font-serif text-sm">
                  {message.content}
                </div>
                <div className="mt-1 flex items-center justify-end gap-1 text-xs text-blue-100 opacity-0 transition-opacity focus-within:opacity-100 group-hover/turn:opacity-100">
                  {shouldShowUserCopyControl && (
                    <MessageCopyControl content={userCopyContent} messageType="user" />
                  )}
                  <span>{formattedTime}</span>
                </div>
              </div>
            ) : (
              /* Image-only turn: no text bubble, but the timestamp still shows */
              <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                <span>{formattedTime}</span>
              </div>
            )}
          </div>
        </div>
      ) : message.isSystemNotice ? (
        /* Run-level record (interrupt, fallback, compaction) between turns */
        (() => {
          const { Icon, container, icon } = NOTICE_STYLES[message.noticeLevel ?? 'info'];
          return (
            <div className="w-full py-0.5">
              <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${container}`} role="note">
                <Icon className={`mt-px h-3.5 w-3.5 flex-shrink-0 ${icon}`} aria-hidden="true" />
                <span className="sr-only">{t(`messageTypes.notice.${message.noticeLevel ?? 'info'}`)}</span>
                <span dir="auto" className="min-w-0 whitespace-pre-wrap break-words">{message.content}</span>
              </div>
            </div>
          );
        })()
      ) : message.isTaskNotification ? (
        /* Compact task notification on the left */
        <div className="w-full">
          <div className="flex items-center gap-2 py-0.5">
            <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${message.taskStatus === 'completed' ? 'bg-green-400 dark:bg-green-500' : 'bg-amber-400 dark:bg-amber-500'}`} />
            <span className="text-xs text-gray-500 dark:text-gray-400">{message.content}</span>
          </div>
        </div>
      ) : (
        /* Claude/Error/Tool messages on the left */
        <div className="w-full">
          {!isGrouped && (message.type === 'error' || isForeignProviderTurn) && (
            /* An error announces itself, and a stored transcript from another
               agent says which agent it was. A live GJC answer does neither: it
               is already identified by being prose on the left, opposite the
               user's blue bubbles, so its name and logo were a label nobody
               needed to read on every turn. */
            <div className="mb-2 flex items-center space-x-3">
              {message.type === 'error' ? (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-sm text-white">
                  !
                </div>
              ) : (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full p-1 text-sm text-foreground">
                  <SessionProviderLogo provider={provider} className="h-full w-full" />
                </div>
              )}
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {message.type === 'error'
                  ? t('messageTypes.error')
                  : provider === 'cursor'
                    ? t('messageTypes.cursor')
                    : provider === 'codex'
                      ? t('messageTypes.codex')
                      : provider === 'opencode'
                        ? t('messageTypes.opencode', { defaultValue: 'OpenCode' })
                        : t('messageTypes.claude')}
              </div>
            </div>
          )}

          <div className="w-full">

            {message.isToolUse ? (
              <>
                <div className="flex flex-col">
                  <div className="flex flex-col">
                    <Markdown className="prose prose-sm max-w-none font-serif dark:prose-invert">
                      {String(message.displayText || '')}
                    </Markdown>
                  </div>
                </div>

                {message.toolInput && (
                  <ToolRenderer
                    toolName={message.toolName || 'UnknownTool'}
                    toolInput={message.toolInput}
                    toolResult={effectiveToolResult}
                    toolId={message.toolId}
                    mode="input"
                    onFileOpen={onFileOpen}
                    createDiff={createDiff}
                    selectedProject={selectedProject}
                    showRawParameters={showRawParameters}
                    rawToolInput={typeof message.toolInput === 'string' ? message.toolInput : undefined}
                    isSubagentContainer={message.isSubagentContainer}
                    subagentState={message.subagentState}
                  />
                )}

                {/* Tool Result Section — Bash renders its output inside the command row above. */}
                {effectiveToolResult && message.toolName !== 'Bash' && !shouldHideToolResult(message.toolName || 'UnknownTool', effectiveToolResult) && (
                  effectiveToolResult.isError ? (
                    // Error results - red error box with content
                    <div
                      id={`tool-result-${message.toolId}`}
                      className="relative mt-2 scroll-mt-4 rounded border border-red-200/60 bg-red-50/50 p-3 dark:border-red-800/40 dark:bg-red-950/10"
                    >
                      <div className="relative mb-2 flex items-center gap-1.5">
                        <svg className="h-4 w-4 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span className="text-xs font-medium text-red-700 dark:text-red-300">{t('messageTypes.error')}</span>
                      </div>
                      <div className="relative text-sm text-red-900 dark:text-red-100">
                        <Markdown className="prose prose-sm prose-red max-w-none font-serif dark:prose-invert">
                          {String(effectiveToolResult.content || '')}
                        </Markdown>
                      </div>
                    </div>
                  ) : (
                    // Non-error results - route through ToolRenderer (single source of truth)
                    <div id={`tool-result-${message.toolId}`} className="scroll-mt-4">
                      <ToolRenderer
                        toolName={message.toolName || 'UnknownTool'}
                        toolInput={message.toolInput}
                        toolResult={effectiveToolResult}
                        toolId={message.toolId}
                        mode="result"
                        onFileOpen={onFileOpen}
                        createDiff={createDiff}
                        selectedProject={selectedProject}
                      />
                    </div>
                  )
                )}
                {message.toolResultTruncated && !fullToolResult && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      className="rounded border border-border bg-muted/40 px-2.5 py-1 text-foreground hover:bg-muted disabled:opacity-60"
                      onClick={loadFullToolResult}
                      disabled={isLoadingFullToolResult}
                    >
                      {isLoadingFullToolResult
                        ? t('session.messages.loadingFullToolOutput')
                        : t('session.messages.loadFullToolOutput')}
                    </button>
                    {message.toolResultBytes && (
                      <span className="text-muted-foreground">
                        {(message.toolResultBytes / 1024).toFixed(0)} KB
                      </span>
                    )}
                    {fullToolResultError && (
                      <span className="text-red-600 dark:text-red-400">
                        {t('session.messages.fullToolOutputFailed')}
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : message.isInteractivePrompt ? (
              // Special handling for interactive prompts
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-500">
                    <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="mb-3 text-base font-semibold text-amber-900 dark:text-amber-100">
                      {t('interactive.title')}
                    </h4>
                    {(() => {
                      const lines = (message.content || '').split('\n').filter((line) => line.trim());
                      const questionLine = lines.find((line) => line.includes('?')) || lines[0] || '';
                      const options: InteractiveOption[] = [];

                      // Parse the menu options
                      lines.forEach((line) => {
                        // Match lines like "❯ 1. Yes" or "  2. No"
                        const optionMatch = line.match(/[❯\s]*(\d+)\.\s+(.+)/);
                        if (optionMatch) {
                          const isSelected = line.includes('❯');
                          options.push({
                            number: optionMatch[1],
                            text: optionMatch[2].trim(),
                            isSelected
                          });
                        }
                      });

                      return (
                        <>
                          <p className="mb-4 text-sm text-amber-800 dark:text-amber-200">
                            {questionLine}
                          </p>

                          {/* Option buttons */}
                          <div className="mb-4 space-y-2">
                            {options.map((option) => (
                              <button
                                key={option.number}
                                className={`w-full rounded-lg border-2 px-4 py-3 text-left transition-all ${option.isSelected
                                  ? 'border-amber-600 bg-amber-600 text-white shadow-md dark:border-amber-700 dark:bg-amber-700'
                                  : 'border-amber-300 bg-white text-amber-900 dark:border-amber-700 dark:bg-gray-800 dark:text-amber-100'
                                  } cursor-not-allowed opacity-75`}
                                disabled
                              >
                                <div className="flex items-center gap-3">
                                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${option.isSelected
                                    ? 'bg-white/20'
                                    : 'bg-amber-100 dark:bg-amber-800/50'
                                    }`}>
                                    {option.number}
                                  </span>
                                  <span className="flex-1 text-sm font-medium sm:text-base">
                                    {option.text}
                                  </span>
                                  {option.isSelected && (
                                    <span className="text-lg">❯</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>

                          <div className="rounded-lg bg-amber-100 p-3 dark:bg-amber-800/30">
                            <p className="mb-1 text-sm font-medium text-amber-900 dark:text-amber-100">
                              {t('interactive.waiting')}
                            </p>
                            <p className="text-xs text-amber-800 dark:text-amber-200">
                              {t('interactive.instruction')}
                            </p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : message.isThinking ? (
              /* Thinking messages — Reasoning component (ai-elements pattern) */
              <Reasoning defaultOpen={false}>
                <ReasoningTrigger />
                <ReasoningContent>
                  <Markdown className="prose prose-sm prose-gray max-w-none font-serif dark:prose-invert">
                    {message.content}
                  </Markdown>
                  <div className="mt-3 flex items-center text-[11px]">
                    <MessageCopyControl content={String(message.content || '')} messageType="assistant" />
                  </div>
                </ReasoningContent>
              </Reasoning>
            ) : (
              <div dir="auto" className="text-sm text-gray-700 dark:text-gray-300">
                {/* Reasoning accordion */}
                {showThinking && message.reasoning && (
                  <Reasoning className="mb-3" defaultOpen={false}>
                    <ReasoningTrigger />
                    <ReasoningContent>
                      <div className="whitespace-pre-wrap">
                        {message.reasoning}
                      </div>
                    </ReasoningContent>
                  </Reasoning>
                )}

                {(() => {
                  const content = formattedMessageContent;

                  // Detect if content is pure JSON (starts with { or [)
                  const trimmedContent = content.trim();
                  if ((trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) &&
                    (trimmedContent.endsWith('}') || trimmedContent.endsWith(']'))) {
                    try {
                      const parsed = JSON.parse(trimmedContent);
                      const formatted = JSON.stringify(parsed, null, 2);

                      return (
                        <div className="my-2">
                          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <span className="font-medium">{t('json.response')}</span>
                          </div>
                          <div className="overflow-hidden rounded-lg border border-border bg-muted">
                            <pre className="overflow-x-auto p-4">
                              <code className="block whitespace-pre font-mono text-sm text-foreground">
                                {formatted}
                              </code>
                            </pre>
                          </div>
                        </div>
                      );
                    } catch {
                      // Not valid JSON, fall through to normal rendering
                    }
                  }

                  // Normal rendering for non-JSON content
                  return message.type === 'assistant' ? (
                    <Markdown className="prose prose-sm prose-gray max-w-none font-serif dark:prose-invert">
                      {content}
                    </Markdown>
                  ) : (
                    <div className="whitespace-pre-wrap">
                      {content}
                    </div>
                  );
                })()}
              </div>
            )}

            {(shouldShowAssistantCopyControl || !isGrouped) && (
              // Copy, speak and the timestamp are things you reach for, not
              // things you read. They stay out of the transcript until the turn
              // is hovered or something in the row takes focus.
              <div className="mt-1 flex w-full items-center gap-2 text-[11px] text-gray-400 opacity-0 transition-opacity focus-within:opacity-100 group-hover/turn:opacity-100 dark:text-gray-500">
                {shouldShowAssistantCopyControl && (
                  <MessageCopyControl content={assistantCopyContent} messageType="assistant" />
                )}
                {shouldShowAssistantCopyControl && (
                  <MessageSpeakControl content={assistantCopyContent} />
                )}
                {!isGrouped && <span>{formattedTime}</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default MessageComponent;
