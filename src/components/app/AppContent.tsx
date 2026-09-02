import { type SyntheticEvent, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
import type { MainContentProps } from '../main-content/types/types';
import CommandPalette from '../command-palette/CommandPalette';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { usePaletteOpsRegister } from '../../stores/usePaletteOpsStore';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { useQueuedMessageAutoSend } from '../../hooks/useQueuedMessageAutoSend';
import { observeOutgoingChatMessage, useSessionAttentionSync } from '../../hooks/useSessionAttentionSync';

import { hiddenKeyboardHeight } from './appContentUtils';
import { useRunningSessionsSync } from './useRunningSessionsSync';

type SidebarLayerProps = {
  isMobile: boolean;
  isOpen: boolean;
  onClose: () => void;
  closeLabel: string;
  sidebarProps: Parameters<typeof Sidebar>[0];
};

function SidebarLayer({ isMobile, isOpen, onClose, closeLabel, sidebarProps }: SidebarLayerProps) {
  if (!isMobile) {
    return (
      <div className="h-full shrink-0 border-r border-border/50">
        <Sidebar {...sidebarProps} />
      </div>
    );
  }

  const overlayClass = `fixed inset-0 z-50 flex transition-all duration-150 ease-out ${isOpen ? 'visible opacity-100' : 'invisible opacity-0'}`;
  const panelClass = `relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card transition-transform duration-150 ease-out sm:w-80 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`;
  const stopBubble = (event: SyntheticEvent) => event.stopPropagation();
  const closeFromClick = (event: SyntheticEvent) => {
    event.stopPropagation();
    onClose();
  };
  const closeFromTouch = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <div className={overlayClass}>
      <button
        className="fixed inset-0 bg-background/60 backdrop-blur-xs transition-opacity duration-150 ease-out"
        onClick={closeFromClick}
        onTouchStart={closeFromTouch}
        aria-label={closeLabel}
      />
      <div
        className={panelClass}
        onClick={stopBubble}
        onTouchStart={stopBubble}
      >
        <Sidebar {...sidebarProps} />
      </div>
    </div>
  );
}

export default function AppContent() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage: sendToServer, subscribe } = useWebSocket();
  // Answering an approval and starting a run are facts the sidebar's status
  // model needs, and they only ever appear on the outgoing side of the socket.
  const sendMessage = useCallback((message: unknown) => {
    observeOutgoingChatMessage(message);
    sendToServer(message);
  }, [sendToServer]);
  const {
    processingSessions,
    markSessionProcessing: markProcessing,
    markSessionIdle: markIdle,
    syncProcessingSessions,
  } = useSessionProtection();

  const {
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    newSessionTrigger,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    openSettings,
    refreshProjectsSilently,
    registerOptimisticSession,
    sidebarSharedProps,
    handleNewSession,
  } = useProjectsState({
    sessionId,
    navigate,
    subscribe,
    isMobile,
    activeSessions: processingSessions,
  });

  const activeSessionId = selectedSession ? selectedSession.id : (sessionId ?? null);
  useQueuedMessageAutoSend({
    processingSessions,
    activeSessionId,
    ws,
    sendMessage,
    markSessionProcessing: markProcessing,
  });

  useRunningSessionsSync(syncProcessingSessions);
  useSessionAttentionSync({ subscribe, viewedSessionId: activeSessionId, processingSessions });

  const showSidebar = useCallback(() => setSidebarOpen(true), [setSidebarOpen]);
  const hideSidebar = useCallback(() => setSidebarOpen(false), [setSidebarOpen]);
  const startNewChat = useCallback(
    () => selectedProject && handleNewSession(selectedProject),
    [handleNewSession, selectedProject],
  );
  const navigateToSession = useCallback(
    (targetSessionId: string, options?: { replace?: boolean }) => {
      navigate(`/session/${targetSessionId}`, { replace: options?.replace === true });
    },
    [navigate],
  );
  const establishSession = useCallback<MainContentProps['onSessionEstablished']>(
    (targetSessionId, context) => registerOptimisticSession({ ...context, sessionId: targetSessionId }),
    [registerOptimisticSession],
  );

  usePaletteOpsRegister({
    openSettings,
    refreshProjects: refreshProjectsSilently,
    startNewChat,
  });

  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === null) return;

    const writeInset = () => {
      const root = document.documentElement;
      root.style.setProperty('--keyboard-height', `${hiddenKeyboardHeight(root.clientHeight, viewport.height)}px`);
    };
    writeInset();
    viewport.addEventListener('resize', writeInset);
    return () => viewport.removeEventListener('resize', writeInset);
  }, []);

  return (
    <div className="fixed inset-0 flex bg-background">
      <SidebarLayer
        isMobile={isMobile}
        isOpen={sidebarOpen}
        onClose={hideSidebar}
        closeLabel={t('versionUpdate.ariaLabels.closeSidebar')}
        sidebarProps={sidebarSharedProps}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <MainContent
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ws={ws}
          sendMessage={sendMessage}
          isMobile={isMobile}
          onMenuClick={showSidebar}
          isLoading={isLoadingProjects}
          onInputFocusChange={setIsInputFocused}
          onSessionProcessing={markProcessing}
          onSessionIdle={markIdle}
          processingSessions={processingSessions}
          onNavigateToSession={navigateToSession}
          onSessionEstablished={establishSession}
          onShowSettings={openSettings}
          newSessionTrigger={newSessionTrigger}
        />
      </div>

      <CommandPalette
        selectedProject={selectedProject}
        currentSessionId={sessionId}
        onStartNewChat={handleNewSession}
        onOpenSettings={() => openSettings()}
        onShowTab={setActiveTab}
      />
    </div>
  );
}
