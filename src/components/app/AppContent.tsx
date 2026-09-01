import { useCallback, useEffect } from 'react';
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

import { hiddenKeyboardHeight } from './appContentUtils';
import { useRunningSessionsSync } from './useRunningSessionsSync';

export default function AppContent() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, subscribe } = useWebSocket();
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

  const startNewChat = useCallback(() => {
    if (selectedProject) handleNewSession(selectedProject);
  }, [handleNewSession, selectedProject]);

  const showSidebar = useCallback(() => {
    setSidebarOpen(true);
  }, [setSidebarOpen]);

  const navigateToSession = useCallback((targetSessionId: string, options?: { replace?: boolean }) => {
    navigate(`/session/${targetSessionId}`, { replace: options?.replace === true });
  }, [navigate]);

  const establishSession = useCallback<MainContentProps['onSessionEstablished']>((targetSessionId, context) => {
    registerOptimisticSession({ sessionId: targetSessionId, ...context });
  }, [registerOptimisticSession]);

  usePaletteOpsRegister({
    openSettings,
    refreshProjects: refreshProjectsSilently,
    startNewChat,
  });

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const syncKeyboardInset = () => {
      const documentHeight = document.documentElement.clientHeight;
      document.documentElement.style.setProperty(
        '--keyboard-height',
        `${hiddenKeyboardHeight(documentHeight, viewport.height)}px`,
      );
    };
    syncKeyboardInset();
    viewport.addEventListener('resize', syncKeyboardInset);
    return () => viewport.removeEventListener('resize', syncKeyboardInset);
  }, []);


  return (
    <div className="fixed inset-0 flex bg-background">
      {!isMobile ? (
        <div className="h-full shrink-0 border-r border-border/50">
          <Sidebar {...sidebarSharedProps} />
        </div>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
            }`}
        >
          <button
            className="fixed inset-0 bg-background/60 backdrop-blur-xs transition-opacity duration-150 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card transition-transform duration-150 ease-out sm:w-80 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar {...sidebarSharedProps} />
          </div>
        </div>
      )}

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
