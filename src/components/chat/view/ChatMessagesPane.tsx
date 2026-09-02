import { useTranslation } from 'react-i18next';
import { memo, useCallback, useMemo } from 'react';
import type { RefObject } from 'react';

import type { ChatMessage, CodeEditorDiffInfo  } from '../types/types';
import type {
  Project,
  ProjectSession,
  LLMProvider,
} from '../../../types/app';
import { getIntrinsicMessageKey } from '../utils/messageKeys';
import type { LiveActivity } from '../utils/toolActivity';
import { isToolGroupItem } from '../utils/toolGrouping';
import { DEFAULT_TOOL_OUTPUT_DENSITY, toolOutputDensityRules } from '../utils/toolOutputDensity';
import type { ToolOutputDensity } from '../utils/toolOutputDensity';
import { buildPaneList, isPendingWorkBlock, isTurnWorkBlockItem } from '../utils/turnWork';
import type { PaneListItem } from '../utils/turnWork';

import GroupedMessageList from './GroupedMessageList';
import ProviderSelectionEmptyState from './ProviderSelectionEmptyState';
import RunningActivityRow from './RunningActivityRow';
import TurnWorkBlock from './TurnWorkBlock';
import LoadAllMessagesOverlay from './LoadAllMessagesOverlay';

/** The transcript message a list item ends with, so the next row knows what preceded it; null for an empty block. */
function lastMessageOf(item: PaneListItem): ChatMessage | null {
  if (isTurnWorkBlockItem(item) || isToolGroupItem(item)) return item.messages[item.messages.length - 1] ?? null;
  return item;
}

interface ChatMessagesPaneProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onWheel: () => void;
  onTouchMove: () => void;
  isLoadingSessionMessages: boolean;
  /** True while the viewed session has an active provider run in flight. */
  isProcessing?: boolean;
  /** What the in-flight run is doing now; the running turn's work block (or bare running row) shows it. */
  liveActivity?: LiveActivity | null;
  /** When the in-flight run started (client clock), for the running row's elapsed time. */
  runStartedAt?: number | null;
  chatMessages: ChatMessage[];
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: LLMProvider;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  totalMessages: number;
  sessionMessagesCount: number;
  visibleMessageCount: number;
  visibleMessages: ChatMessage[];
  loadEarlierMessages: () => void;
  loadAllMessages: () => void;
  allMessagesLoaded: boolean;
  isLoadingAllMessages: boolean;
  loadAllJustFinished: boolean;
  showLoadAllOverlay: boolean;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: CodeEditorDiffInfo | null) => void;
  onShowSettings?: () => void;
  density?: ToolOutputDensity;
  showImagePreviews?: boolean;
  selectedProject: Project;
}

function ChatMessagesPane({
  scrollContainerRef,
  onWheel,
  onTouchMove,
  isLoadingSessionMessages,
  isProcessing = false,
  liveActivity = null,
  runStartedAt = null,
  chatMessages,
  selectedSession,
  currentSessionId,
  provider,
  isLoadingMoreMessages,
  hasMoreMessages,
  totalMessages,
  sessionMessagesCount,
  visibleMessageCount,
  visibleMessages,
  loadEarlierMessages,
  loadAllMessages,
  allMessagesLoaded,
  isLoadingAllMessages,
  loadAllJustFinished,
  showLoadAllOverlay,
  createDiff,
  onFileOpen,
  onShowSettings,
  density = DEFAULT_TOOL_OUTPUT_DENSITY,
  showImagePreviews = true,
  selectedProject,
}: ChatMessagesPaneProps) {
  const { t } = useTranslation('chat');
  const displayProvider = selectedSession?.provider ?? selectedSession?.__provider ?? provider;
  // The live turn has a block from the moment it starts (empty until its first
  // call), so the run's status has one place in the transcript. Where blocks
  // are off, a bare running row stands in that place instead.
  const paneItems = useMemo(
    () => buildPaneList(visibleMessages, density, { running: isProcessing }),
    [visibleMessages, density, isProcessing],
  );
  const showInlineRunningRow = isProcessing && !toolOutputDensityRules(density).workBlock;

  // Stable, deterministic keys for the messages rendered this pass.
  //
  // `normalizedToChatMessages` rebuilds fresh ChatMessage objects on every store
  // update, so caching keys by object identity (or via a cross-render allocation
  // Set) minted a brand-new key for the *same* logical message on each prepend —
  // remounting the whole list, which disconnects the scroll-restore anchor and
  // reflows heights, jumping the viewport to the bottom. Deriving keys purely
  // from this render's ordered messages (intrinsic key, disambiguated by
  // occurrence index on collision) yields the same key for the same message
  // order, so React preserves existing DOM nodes and component state on prepend.
  const messageKeyMap = useMemo(() => {
    const keys = new WeakMap<ChatMessage, string>();
    const occurrences = new Map<string, number>();
    const assign = (message: ChatMessage) => {
      const intrinsicKey = getIntrinsicMessageKey(message) ?? 'message-generated';
      const seen = occurrences.get(intrinsicKey) ?? 0;
      occurrences.set(intrinsicKey, seen + 1);
      keys.set(message, seen === 0 ? intrinsicKey : `${intrinsicKey}__${seen}`);
    };
    // Walked in transcript order, which is also the order inside every fold.
    visibleMessages.forEach(assign);
    return keys;
  }, [visibleMessages]);

  const getMessageKey = useCallback(
    (message: ChatMessage) =>
      messageKeyMap.get(message) ?? getIntrinsicMessageKey(message) ?? 'message-generated',
    [messageKeyMap],
  );

  return (
    <div
      ref={scrollContainerRef}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      className="chat-messages-pane relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-3 pb-3 sm:pt-4 sm:pb-4"
    >
      <div className="mx-auto w-full max-w-chat space-y-3 px-4 sm:space-y-4">
      {(isLoadingSessionMessages || isProcessing) && chatMessages.length === 0 ? (
        <div className="mt-8 text-center text-muted-foreground">
          <div className="flex items-center justify-center space-x-2">
            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-border" />
            <p>{t('session.loading.sessionMessages')}</p>
          </div>
        </div>
      ) : chatMessages.length === 0 ? (
        <ProviderSelectionEmptyState
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
        />
      ) : (
        <>
          {/* Loading indicator for older messages (hide when load-all is active) */}
          {isLoadingMoreMessages && !isLoadingAllMessages && !allMessagesLoaded && (
            <div className="py-3 text-center text-muted-foreground">
              <div className="flex items-center justify-center space-x-2">
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-border" />
                <p className="text-sm">{t('session.loading.olderMessages')}</p>
              </div>
            </div>
          )}

          {/* Indicator showing there are more messages to load (hide when all loaded) */}
          {hasMoreMessages && !isLoadingMoreMessages && !allMessagesLoaded && (
            <div className="border-b border-border py-2 text-center text-sm text-muted-foreground">
              {totalMessages > 0 && (
                <span>
                  {t('session.messages.showingOf', { shown: sessionMessagesCount, total: totalMessages })}{' '}
                  <span className="text-xs">{t('session.messages.scrollToLoad')}</span>
                </span>
              )}
            </div>
          )}

          <LoadAllMessagesOverlay
            showLoadAllOverlay={showLoadAllOverlay}
            isLoadingAllMessages={isLoadingAllMessages}
            loadAllJustFinished={loadAllJustFinished}
            totalMessages={totalMessages}
            onLoadAllMessages={loadAllMessages}
          />

          {/* Legacy message count indicator (for non-paginated view) */}
          {!hasMoreMessages && chatMessages.length > visibleMessageCount && (
            <div className="border-b border-border py-2 text-center text-sm text-muted-foreground">
              {t('session.messages.showingLast', { count: visibleMessageCount, total: chatMessages.length })} |
              <button className="ml-1 text-primary underline hover:text-primary" onClick={loadEarlierMessages}>
                {t('session.messages.loadEarlier')}
              </button>
              {' | '}
              <button
                className="text-primary underline hover:text-primary"
                onClick={loadAllMessages}
              >
                {t('session.messages.loadAll')}
              </button>
            </div>
          )}

          {paneItems.map((item, index) => {
            const before = index > 0 ? lastMessageOf(paneItems[index - 1]) : null;
            if (isTurnWorkBlockItem(item)) {
              return (
                <TurnWorkBlock
                  key={`work-${density}-${isPendingWorkBlock(item) ? 'pending' : getMessageKey(item.messages[0])}`}
                  block={item}
                  prevMessage={before}
                  running={isProcessing && item.isTail}
                  liveActivity={liveActivity}
                  runStartedAt={runStartedAt}
                  createDiff={createDiff}
                  getMessageKey={getMessageKey}
                  onFileOpen={onFileOpen}
                  onShowSettings={onShowSettings}
                  density={density}
                  showImagePreviews={showImagePreviews}
                  selectedProject={selectedProject}
                  provider={displayProvider}
                />
              );
            }
            return (
              <GroupedMessageList
                key={isToolGroupItem(item) ? `tool-group-${density}-${getMessageKey(item.messages[0])}` : getMessageKey(item)}
                items={[item]}
                prevMessage={before}
                createDiff={createDiff}
                getMessageKey={getMessageKey}
                onFileOpen={onFileOpen}
                onShowSettings={onShowSettings}
                density={density}
                showImagePreviews={showImagePreviews}
                selectedProject={selectedProject}
                provider={displayProvider}
              />
            );
          })}

          {showInlineRunningRow && (
            <RunningActivityRow liveActivity={liveActivity} runStartedAt={runStartedAt} variant="inline" />
          )}
        </>
      )}
      </div>
    </div>
  );
}

export default memo(ChatMessagesPane);
