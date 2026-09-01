import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { ArrowDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import PermissionContext from '../../../contexts/PermissionContext';
import { readSessionFacts, readTokenTotals, type SessionStatusSnapshot } from '../../../contexts/sessionStatusSnapshot';
import { usePublishSessionStatus } from '../../../contexts/SessionStatusContext';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import { useSessionStore } from '../../../stores/useSessionStore';
import type { ProjectSession } from '../../../types/app';
import { useChatComposerState } from '../hooks/useChatComposerState';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useOAuthLogin } from '../hooks/useOAuthLogin';
import type { ChatInterfaceProps } from '../types/types';
import OAuthLoginDialog from '../OAuthLoginDialog';

import ChatComposer from './ChatComposer';
import ChatMessagesPane from './ChatMessagesPane';
import CommandResultModal from './CommandResultModal';
import type { ReasoningEffort } from './reasoningEffort';

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  'default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
]);

function ComposerSurface(props: ComponentProps<typeof ChatComposer>) {
  return <ChatComposer {...props} />;
}

function ProjectSelectionNotice({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center text-muted-foreground">
        <p className="text-sm">{text}</p>
      </div>
    </div>
  );
}

export function isHistoricalNonGjcReadOnlySession(selectedSession: ProjectSession | null): boolean {
  const sourceProvider = selectedSession?.provider ?? selectedSession?.__provider;
  return Boolean(sourceProvider && sourceProvider !== 'gjc');
}

function ChatInterface({
  selectedProject, selectedSession, ws, sendMessage, onFileOpen, onInputFocusChange,
  onSessionProcessing, onSessionIdle, processingSessions, onNavigateToSession,
  onSessionEstablished, onShowSettings, showRawParameters, showThinking,
  showImagePreviews, sendByCtrlEnter, newSessionTrigger,
}: ChatInterfaceProps) {
  const { subscribe } = useWebSocket();
  const { t } = useTranslation('chat');
  const sessionStore = useSessionStore();
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  const lastSeqRef = useRef(new Map<string, number>());

  const clearStreaming = useCallback(() => {
    const timer = streamTimerRef.current;
    if (timer) clearTimeout(timer);
    streamTimerRef.current = null;
    accumulatedStreamRef.current = '';
  }, []);

  const {
    gjcModel, sessionPinnedModel, pendingPermissionRequests, setPendingPermissionRequests,
    providerModelCatalog, providerModelCacheCatalog, providerModelsRefreshing,
    providerModelsLoading, hardRefreshProviderModels, selectProviderModel,
  } = useChatProviderState({ selectedSession, selectedProject });
  const oauthLogin = useOAuthLogin();
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('default');
  const reasoningSessionRef = useRef<string | null>(selectedSession?.id ?? null);

  useEffect(() => {
    if (oauthLogin.attempt?.phase === 'completed') void hardRefreshProviderModels();
  }, [hardRefreshProviderModels, oauthLogin.attempt?.phase]);

  const session = useChatSessionState({
    selectedProject, selectedSession, ws, sendMessage, newSessionTrigger, processingSessions,
    onSessionIdle, resetStreamingState: clearStreaming, statusCheckSentAtRef, lastSeqRef,
    sessionStore, showImagePreviews,
  });

  const { setCurrentSessionId } = session;
  const establishSession = useCallback<NonNullable<ChatInterfaceProps['onSessionEstablished']>>((id, context) => {
    setCurrentSessionId(id);
    onSessionEstablished?.(id, context);
    onNavigateToSession?.(id);
  }, [onNavigateToSession, onSessionEstablished, setCurrentSessionId]);

  const composer = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId: session.currentSessionId,
    gjcModel,
    reasoningEffort,
    isLoading: session.isProcessing,
    canAbortSession: session.canAbortSession,
    tokenBudget: session.tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onSessionProcessing,
    onSessionEstablished: establishSession,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    scrollToBottom: session.scrollToBottom,
    onLogin: oauthLogin.openLogin,
    addMessage: session.addMessage,
    setIsUserScrolledUp: session.setIsUserScrolledUp,
    setPendingPermissionRequests,
  });

  useEffect(() => {
    const prior = reasoningSessionRef.current;
    const selected = selectedSession?.id ?? null;
    if (prior && prior !== selected) setReasoningEffort('default');
    reasoningSessionRef.current = selected;
  }, [selectedSession?.id]);

  useEffect(() => {
    const serverValue = session.sessionState?.thinkingLevel;
    if (typeof serverValue === 'string' && REASONING_EFFORTS.has(serverValue as ReasoningEffort)) {
      setReasoningEffort(serverValue as ReasoningEffort);
    }
  }, [session.sessionState?.thinkingLevel]);

  const reconnectChat = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    await sessionStore.refreshFromServer(selectedSession.id);
    statusCheckSentAtRef.current.set(selectedSession.id, Date.now());
    sendMessage({
      type: 'chat.subscribe',
      sessions: [{ sessionId: selectedSession.id, lastSeq: lastSeqRef.current.get(selectedSession.id) ?? 0 }],
    });
  }, [selectedProject, selectedSession, sendMessage, sessionStore]);

  useChatRealtimeHandlers({
    subscribe,
    provider: 'gjc',
    selectedSession,
    currentSessionId: session.currentSessionId,
    setTokenBudget: session.setTokenBudget,
    setSessionState: session.setSessionState,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    streamTimerRef,
    accumulatedStreamRef,
    lastSeqRef,
    statusCheckSentAtRef,
    onSessionProcessing,
    onSessionIdle,
    onWebSocketReconnect: reconnectChat,
    onSteerResult: composer.resolveSteerResult,
    sessionStore,
  });

  const { handleAbortSession } = composer;
  useEffect(() => {
    if (!session.canAbortSession) return undefined;
    const interceptEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) return;
      event.preventDefault();
      handleAbortSession();
    };
    document.addEventListener('keydown', interceptEscape, { capture: true });
    return () => document.removeEventListener('keydown', interceptEscape, { capture: true });
  }, [handleAbortSession, session.canAbortSession]);

  useEffect(() => clearStreaming, [clearStreaming]);

  const permissionContextValue = useMemo(() => ({
    pendingPermissionRequests,
    handlePermissionDecision: composer.handlePermissionDecision,
  }), [composer.handlePermissionDecision, pendingPermissionRequests]);

  const sessionStatusSnapshot = useMemo<SessionStatusSnapshot>(() => {
    const reported = readSessionFacts(session.sessionState);
    const fallbackModel = gjcModel && gjcModel !== 'default' ? gjcModel : undefined;
    return {
      ...reported,
      sessionId: session.currentSessionId ?? selectedSession?.id ?? null,
      modelId: sessionPinnedModel ?? reported.modelId ?? fallbackModel,
      thinkingLevel: reported.thinkingLevel ?? reasoningEffort,
      tokens: readTokenTotals(session.tokenBudget),
      activity: {
        running: session.isProcessing,
        statusText: typeof session.sessionActivity?.statusText === 'string' ? session.sessionActivity.statusText : null,
        queued: composer.queuedDrafts.length,
      },
    };
  }, [
    composer.queuedDrafts.length, gjcModel, reasoningEffort, selectedSession?.id,
    session.currentSessionId, session.isProcessing, session.sessionActivity?.statusText,
    session.sessionState, session.tokenBudget, sessionPinnedModel,
  ]);
  usePublishSessionStatus(sessionStatusSnapshot);

  const historicalSession = isHistoricalNonGjcReadOnlySession(selectedSession);
  const showLanding = !historicalSession
    && !selectedSession
    && !session.currentSessionId
    && session.chatMessages.length === 0;
  const showActivity = Boolean(session.sessionActivity && pendingPermissionRequests.length === 0);

  if (!selectedProject) {
    return <ProjectSelectionNotice text={t('projectSelection.startChatWithProvider', {
      provider: 'Gajae Code',
      defaultValue: 'Select a project to start chatting with {{provider}}',
    })} />;
  }

  const composerNode = (
    <ComposerSurface
      pendingPermissionRequests={pendingPermissionRequests}
      handlePermissionDecision={composer.handlePermissionDecision}
      activity={session.sessionActivity}
      isLoading={session.isProcessing}
      onAbortSession={composer.handleAbortSession}
      sessionState={session.sessionState}
      onShowTokenUsage={composer.showCostModal}
      onSubmit={composer.handleSubmit}
      onSteer={composer.handleSteer}
      isDragActive={composer.isDragActive}
      sessionPinnedModel={sessionPinnedModel}
      queuedDrafts={composer.queuedDrafts}
      onEditQueuedDraft={composer.editQueuedDraft}
      onDeleteQueuedDraft={composer.deleteQueuedDraft}
      onMoveQueuedDraft={composer.moveQueuedDraft}
      pendingCommandGate={composer.pendingCommandGate}
      onConfirmCommandGate={composer.confirmCommandGate}
      onCancelCommandGate={composer.cancelCommandGate}
      attachedImages={composer.attachedImages}
      onRemoveImage={(index) => composer.setAttachedImages((images) => images.filter((_, imageIndex) => imageIndex !== index))}
      uploadingImages={composer.uploadingImages}
      imageErrors={composer.imageErrors}
      showFileDropdown={composer.showFileDropdown}
      filteredFiles={composer.filteredFiles}
      selectedFileIndex={composer.selectedFileIndex}
      onSelectFile={composer.selectFile}
      filteredCommands={composer.filteredCommands}
      skillCommands={composer.skillCommands}
      selectedCommandIndex={composer.selectedCommandIndex}
      onCommandSelect={composer.handleCommandSelect}
      onCloseCommandMenu={composer.resetCommandMenuState}
      isCommandMenuOpen={composer.showCommandMenu}
      frequentCommands={composer.commandQuery ? [] : composer.frequentCommands}
      getRootProps={composer.getRootProps}
      getInputProps={composer.getInputProps}
      openImagePicker={composer.openImagePicker}
      inputHighlightRef={composer.inputHighlightRef}
      renderInputWithMentions={composer.renderInputWithMentions}
      textareaRef={composer.textareaRef}
      input={composer.input}
      onVoiceTranscript={composer.handleVoiceTranscript}
      onInputChange={composer.handleInputChange}
      onTextareaClick={composer.handleTextareaClick}
      onTextareaKeyDown={composer.handleKeyDown}
      onTextareaPaste={composer.handlePaste}
      onTextareaScrollSync={composer.syncInputOverlayScroll}
      onTextareaInput={composer.handleTextareaInput}
      isInputFocused={composer.isInputFocused}
      onInputFocusChange={composer.handleInputFocusChange}
      placeholder={t('input.placeholder', { provider: 'Gajae Code' })}
      isTextareaExpanded={composer.isTextareaExpanded}
      sendByCtrlEnter={sendByCtrlEnter}
      modelPreset={gjcModel}
      modelPresetOptions={providerModelCatalog.gjc?.OPTIONS ?? []}
      modelOptions={providerModelCatalog.gjc?.MODELS ?? []}
      modelPresetsLoading={providerModelsLoading}
      modelPickerOpenTrigger={composer.modelPickerTrigger}
      onSelectModelPreset={(model) => selectProviderModel('gjc', model, session.currentSessionId || selectedSession?.id || null)}
      reasoningEffort={reasoningEffort}
      onSelectReasoningEffort={setReasoningEffort}
    />
  );

  return (
    <PermissionContext.Provider value={permissionContextValue}>
      <div className="flex h-full min-h-0 flex-col">
        {showLanding ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-[10vh] sm:px-6">
            <div className="w-full max-w-184">
              <h1 className="text-center text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {t('newSession.greeting', { defaultValue: 'What are we building today?' })}
              </h1>
              <p className="mt-2 mb-8 text-center text-sm text-muted-foreground">
                {t('newSession.subtitle', { project: selectedProject.displayName, defaultValue: 'Gajae Code is ready to work in {{project}}.' })}
              </p>
              {composerNode}
            </div>
          </div>
        ) : (
          <>
            <ChatMessagesPane
              scrollContainerRef={session.scrollContainerRef}
              onWheel={session.handleScroll}
              onTouchMove={session.handleScroll}
              isLoadingSessionMessages={session.isLoadingSessionMessages}
              isProcessing={session.isProcessing}
              hasActivityIndicator={showActivity}
              chatMessages={session.chatMessages}
              selectedSession={selectedSession}
              currentSessionId={session.currentSessionId}
              provider="gjc"
              isLoadingMoreMessages={session.isLoadingMoreMessages}
              hasMoreMessages={session.hasMoreMessages}
              totalMessages={session.totalMessages}
              sessionMessagesCount={session.chatMessages.length}
              visibleMessageCount={session.visibleMessageCount}
              visibleMessages={session.visibleMessages}
              loadEarlierMessages={session.loadEarlierMessages}
              loadAllMessages={session.loadAllMessages}
              allMessagesLoaded={session.allMessagesLoaded}
              isLoadingAllMessages={session.isLoadingAllMessages}
              loadAllJustFinished={session.loadAllJustFinished}
              showLoadAllOverlay={session.showLoadAllOverlay}
              createDiff={session.createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              showImagePreviews={showImagePreviews}
              selectedProject={selectedProject}
            />
            <div className="relative shrink-0">
              {session.isUserScrolledUp && session.chatMessages.length > 0 && (
                <div className="pointer-events-none absolute -top-11 right-0 left-0 z-20 flex justify-center">
                  <button
                    type="button"
                    onClick={session.scrollToBottomAndReset}
                    aria-label={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
                    title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
                    className={session.hasNewMessagesBelow
                      ? 'pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border border-primary/30 bg-primary px-3 text-xs font-medium text-primary-foreground shadow-md transition-all duration-200 hover:brightness-110'
                      : 'pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground shadow-xs transition-all duration-200 hover:bg-accent hover:text-foreground'}
                  >
                    {session.hasNewMessagesBelow && <span>{t('input.newMessages', { defaultValue: '새 메시지' })}</span>}
                    <ArrowDownIcon className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              )}
              {!historicalSession && composerNode}
            </div>
          </>
        )}
      </div>
      <CommandResultModal
        payload={composer.commandModalPayload}
        onClose={composer.closeCommandModal}
        providerModelCatalog={providerModelCatalog}
        providerModelCacheCatalog={providerModelCacheCatalog}
        providerModelsRefreshing={providerModelsRefreshing}
        onHardRefreshProviderModels={hardRefreshProviderModels}
        currentSessionId={session.currentSessionId || selectedSession?.id || null}
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
