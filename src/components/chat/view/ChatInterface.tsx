import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownIcon } from 'lucide-react';

import { useWebSocket } from '../../../contexts/WebSocketContext';
import PermissionContext from '../../../contexts/PermissionContext';
import { QuickSettingsPanel } from '../../quick-settings-panel';
import type { ChatInterfaceProps } from '../types/types';
import type { ProjectSession } from '../../../types/app';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import { useSessionStore } from '../../../stores/useSessionStore';
import { useOAuthLogin } from '../hooks/useOAuthLogin';
import OAuthLoginDialog from '../OAuthLoginDialog';

import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import CommandResultModal from './subcomponents/CommandResultModal';
import type { ReasoningEffort } from './subcomponents/ReasoningEffortPicker';

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  'default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
]);

export function isHistoricalNonGjcReadOnlySession(selectedSession: ProjectSession | null): boolean {
  const provider = selectedSession?.provider ?? selectedSession?.__provider;
  return Boolean(provider && provider !== 'gjc');
}

function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  onFileOpen,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  showRawParameters,
  showThinking,
  showImagePreviews,
  sendByCtrlEnter,
  externalMessageUpdate,
  newSessionTrigger,
}: ChatInterfaceProps) {
  const { subscribe } = useWebSocket();
  const { t } = useTranslation('chat');

  const sessionStore = useSessionStore();
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  // When each session's `chat.subscribe` was last sent; idle acks older than
  // a later local request are discarded as stale.
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  // Highest live `seq` observed per session. Written by the realtime handler
  // on every sequenced frame, read whenever a `chat.subscribe` is sent so the
  // server replays only the events this client actually missed.
  const lastSeqRef = useRef(new Map<string, number>());

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    accumulatedStreamRef.current = '';
  }, []);
  const provider = 'gjc' as const;

  const {
    gjcModel,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    providerModelCatalog,
    providerModelCacheCatalog,
    providerModelsRefreshing,
    providerModelsLoading,
    hardRefreshProviderModels,
    selectProviderModel,
  } = useChatProviderState({
    selectedSession,
    selectedProject,
  });
  const oauthLogin = useOAuthLogin();
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('default');
  const reasoningSessionRef = useRef<string | null>(selectedSession?.id ?? null);

  useEffect(() => {
    if (oauthLogin.attempt?.phase === 'completed') {
      void hardRefreshProviderModels();
    }
  }, [hardRefreshProviderModels, oauthLogin.attempt?.phase]);


  const {
    chatMessages,
    addMessage,
    sessionActivity,
    isProcessing,
    canAbortSession,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isUserScrolledUp,
    hasNewMessagesBelow,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    sessionState,
    setSessionState,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    externalMessageUpdate,
    newSessionTrigger,
    processingSessions,
    onSessionIdle,
    resetStreamingState,
    statusCheckSentAtRef,
    lastSeqRef,
    sessionStore,
    showImagePreviews,
  });

  // Brand-new conversation: the composer allocated a stable session id via
  // the session gateway before the first send. Record it locally and put it
  // in the URL — this id never changes again, so there is no later handoff.
  const handleSessionEstablished = useCallback<NonNullable<ChatInterfaceProps['onSessionEstablished']>>((sessionId, context) => {
    setCurrentSessionId(sessionId);
    onSessionEstablished?.(sessionId, context);
    onNavigateToSession?.(sessionId);
  }, [setCurrentSessionId, onSessionEstablished, onNavigateToSession]);

  const {
    input,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    skillCommands,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    showFileDropdown,
    filteredFiles,
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
    openImagePicker,
    handleSubmit,
    modelPickerTrigger,
    queuedDraft,
    editQueuedDraft,
    deleteQueuedDraft,
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
    handleAbortSession,
    handlePermissionDecision,
    handleInputFocusChange,
    isInputFocused,
    commandModalPayload,
    closeCommandModal,
    showCostModal,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId,
    gjcModel,
    reasoningEffort,
    isLoading: isProcessing,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onSessionProcessing,
    onSessionEstablished: handleSessionEstablished,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    scrollToBottom,
    onLogin: oauthLogin.openLogin,
    addMessage,
    setIsUserScrolledUp,
    setPendingPermissionRequests,
  });

  useEffect(() => {
    const previousSessionId = reasoningSessionRef.current;
    const nextSessionId = selectedSession?.id ?? null;
    // A brand-new chat transitions from no selected row to its freshly
    // allocated session id after the first send. Preserve the effort chosen
    // in the landing composer across that handoff.
    if (previousSessionId && previousSessionId !== nextSessionId) {
      setReasoningEffort('default');
    }
    reasoningSessionRef.current = nextSessionId;
  }, [selectedSession?.id]);

  useEffect(() => {
    const reported = sessionState?.thinkingLevel;
    if (typeof reported === 'string' && REASONING_EFFORTS.has(reported as ReasoningEffort)) {
      setReasoningEffort(reported as ReasoningEffort);
    }
  }, [sessionState?.thinkingLevel]);

  // On WebSocket reconnect, re-fetch the current session's messages from the
  // server so missed streaming events are shown, then re-subscribe — the
  // `chat_subscribed` ack restores or clears the activity indicator, replays
  // missed live events, and re-attaches a still-running stream to this socket.
  const handleWebSocketReconnect = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    await sessionStore.refreshFromServer(selectedSession.id);
    statusCheckSentAtRef.current.set(selectedSession.id, Date.now());
    sendMessage({
      type: 'chat.subscribe',
      sessions: [{
        sessionId: selectedSession.id,
        lastSeq: lastSeqRef.current.get(selectedSession.id) ?? 0,
      }],
    });
  }, [selectedProject, selectedSession, sendMessage, sessionStore]);


  useChatRealtimeHandlers({
    subscribe,
    provider,
    selectedSession,
    currentSessionId,
    setTokenBudget,
    setSessionState,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    streamTimerRef,
    accumulatedStreamRef,
    lastSeqRef,
    statusCheckSentAtRef,
    onSessionProcessing,
    onSessionIdle,
    onWebSocketReconnect: handleWebSocketReconnect,
    sessionStore,
  });

  useEffect(() => {
    if (!canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  const permissionContextValue = useMemo(() => ({
    pendingPermissionRequests,
    handlePermissionDecision,
  }), [pendingPermissionRequests, handlePermissionDecision]);

  // Mirrors ChatComposer's own visibility check so the message pane can
  // reserve enough bottom space to keep the floating status tab from
  // overlapping the last message.
  const hasActivityIndicator = Boolean(sessionActivity && pendingPermissionRequests.length === 0);

  const isReadOnlyHistoricalSession = isHistoricalNonGjcReadOnlySession(selectedSession);

  // Codex-style landing: with a project selected but no session yet, the
  // composer moves to a centered hero instead of sitting at the bottom of an
  // empty message pane.
  const isNewSessionLanding =
    !isReadOnlyHistoricalSession
    && !selectedSession
    && !currentSessionId
    && chatMessages.length === 0;

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: 'Gajae Code',
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }

  const composerNode = (
    <ChatComposer
      pendingPermissionRequests={pendingPermissionRequests}
      handlePermissionDecision={handlePermissionDecision}
      activity={sessionActivity}
      isLoading={isProcessing}
      onAbortSession={handleAbortSession}
      tokenBudget={tokenBudget}
      sessionState={sessionState}
      onShowTokenUsage={showCostModal}
      onSubmit={handleSubmit}
      isDragActive={isDragActive}
      queuedDraft={queuedDraft}
      onEditQueuedDraft={editQueuedDraft}
      onDeleteQueuedDraft={deleteQueuedDraft}
      pendingCommandGate={pendingCommandGate}
      onConfirmCommandGate={confirmCommandGate}
      onCancelCommandGate={cancelCommandGate}
      attachedImages={attachedImages}
      onRemoveImage={(index) =>
        setAttachedImages((previous) =>
          previous.filter((_, currentIndex) => currentIndex !== index),
        )
      }
      uploadingImages={uploadingImages}
      imageErrors={imageErrors}
      showFileDropdown={showFileDropdown}
      filteredFiles={filteredFiles}
      selectedFileIndex={selectedFileIndex}
      onSelectFile={selectFile}
      filteredCommands={filteredCommands}
      skillCommands={skillCommands}
      selectedCommandIndex={selectedCommandIndex}
      onCommandSelect={handleCommandSelect}
      onCloseCommandMenu={resetCommandMenuState}
      isCommandMenuOpen={showCommandMenu}
      frequentCommands={commandQuery ? [] : frequentCommands}
      getRootProps={getRootProps}
      getInputProps={getInputProps}
      openImagePicker={openImagePicker}
      inputHighlightRef={inputHighlightRef}
      renderInputWithMentions={renderInputWithMentions}
      textareaRef={textareaRef}
      input={input}
      onVoiceTranscript={handleVoiceTranscript}
      onInputChange={handleInputChange}
      onTextareaClick={handleTextareaClick}
      onTextareaKeyDown={handleKeyDown}
      onTextareaPaste={handlePaste}
      onTextareaScrollSync={syncInputOverlayScroll}
      onTextareaInput={handleTextareaInput}
      isInputFocused={isInputFocused}
      onInputFocusChange={handleInputFocusChange}
      placeholder={t('input.placeholder', { provider: 'Gajae Code' })}
      isTextareaExpanded={isTextareaExpanded}
      sendByCtrlEnter={sendByCtrlEnter}
      modelPreset={gjcModel}
      modelPresetOptions={providerModelCatalog.gjc?.OPTIONS ?? []}
      modelPresetsLoading={providerModelsLoading}
      modelPickerOpenTrigger={modelPickerTrigger}
      onSelectModelPreset={(model) => selectProviderModel(
        'gjc',
        model,
        currentSessionId || selectedSession?.id || null,
      )}
      reasoningEffort={reasoningEffort}
      onSelectReasoningEffort={setReasoningEffort}
    />
  );

  return (
    <PermissionContext.Provider value={permissionContextValue}>
      <div className="flex h-full min-h-0 flex-col">
        {isNewSessionLanding ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-[10vh] sm:px-6">
            <div className="w-full max-w-[46rem]">
              <h1 className="text-center text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {t('newSession.greeting', { defaultValue: 'What are we building today?' })}
              </h1>
              <p className="mb-8 mt-2 text-center text-sm text-muted-foreground">
                {t('newSession.subtitle', {
                  project: selectedProject.displayName,
                  defaultValue: 'Gajae Code is ready to work in {{project}}.',
                })}
              </p>
              {composerNode}
            </div>
          </div>
        ) : (
          <>
            <ChatMessagesPane
              scrollContainerRef={scrollContainerRef}
              onWheel={handleScroll}
              onTouchMove={handleScroll}
              isLoadingSessionMessages={isLoadingSessionMessages}
              isProcessing={isProcessing}
              hasActivityIndicator={hasActivityIndicator}
              chatMessages={chatMessages}
              selectedSession={selectedSession}
              currentSessionId={currentSessionId}
              provider="gjc"
              isLoadingMoreMessages={isLoadingMoreMessages}
              hasMoreMessages={hasMoreMessages}
              totalMessages={totalMessages}
              sessionMessagesCount={chatMessages.length}
              visibleMessageCount={visibleMessageCount}
              visibleMessages={visibleMessages}
              loadEarlierMessages={loadEarlierMessages}
              loadAllMessages={loadAllMessages}
              allMessagesLoaded={allMessagesLoaded}
              isLoadingAllMessages={isLoadingAllMessages}
              loadAllJustFinished={loadAllJustFinished}
              showLoadAllOverlay={showLoadAllOverlay}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              showImagePreviews={showImagePreviews}
              selectedProject={selectedProject}
            />

            <div className="relative flex-shrink-0">
              {isUserScrolledUp && chatMessages.length > 0 && (
                <div className="pointer-events-none absolute -top-11 left-0 right-0 z-20 flex justify-center">
                  <button
                    type="button"
                    onClick={scrollToBottomAndReset}
                    aria-label={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
                    title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
                    className={
                      hasNewMessagesBelow
                        ? 'pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border border-primary/30 bg-primary px-3 text-xs font-medium text-primary-foreground shadow-md transition-all duration-200 hover:brightness-110'
                        : 'pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-foreground'
                    }
                  >
                    {hasNewMessagesBelow && (
                      <span>{t('input.newMessages', { defaultValue: '새 메시지' })}</span>
                    )}
                    <ArrowDownIcon className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              )}

              {!isReadOnlyHistoricalSession && composerNode}
            </div>
          </>
        )}
      </div>

      <QuickSettingsPanel />

      <CommandResultModal
        payload={commandModalPayload}
        onClose={closeCommandModal}
        providerModelCatalog={providerModelCatalog}
        providerModelCacheCatalog={providerModelCacheCatalog}
        providerModelsRefreshing={providerModelsRefreshing}
        onHardRefreshProviderModels={hardRefreshProviderModels}
        currentSessionId={currentSessionId || selectedSession?.id || null}
        onSelectProviderModel={selectProviderModel}
      />
      <OAuthLoginDialog
        open={oauthLogin.isOpen}
        providers={oauthLogin.providers}
        isLoadingProviders={oauthLogin.isLoadingProviders}
        isStarting={oauthLogin.isStarting}
        attempt={oauthLogin.attempt}
        failure={oauthLogin.failure}
        onSelectProvider={oauthLogin.startProvider}
        onSubmitValue={oauthLogin.submitValue}
        onDismiss={oauthLogin.closeLogin}
        onRetry={oauthLogin.retry}
      />
    </PermissionContext.Provider>
  );
}

export default React.memo(ChatInterface);
