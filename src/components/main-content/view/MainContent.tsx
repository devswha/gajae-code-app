import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MainContentProps } from '../types/types';
import { usePaletteOpsRegister } from '../../../stores/usePaletteOpsStore';
import { SessionStatusProvider } from '../../../contexts/SessionStatusContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useFileOpenResolver } from '../../../hooks/useFileOpenResolver';
import { useSessionStore } from '../../../stores/useSessionStore';
import { useAgentSidebar } from '../../agent-sidebar/hooks/useAgentSidebar';
import { MIN_AGENT_SIDEBAR_CHAT_WIDTH } from '../../agent-sidebar/agentSidebarState';
import { api } from '../../../utils/api';
import { openBrowserUrl } from '../../../utils/externalLink';
import { builtinBrowserFailure, hasBuiltinBrowserBridge, openBuiltinBrowser, type BuiltinBrowserFailure } from '../../../utils/builtinBrowser';
import { useSessionLocation } from '../../chat/hooks/useSessionLocation';

import MainContentHeader from './MainContentHeader';
import MainContentStateView from './MainContentStateView';
import ErrorBoundary from './ErrorBoundary';

const ChatInterface = lazy(() => import('../../chat/view/ChatInterface'));
const AgentSidebar = lazy(() => import('../../agent-sidebar/view/AgentSidebar'));

function MainContent({
  selectedProject,
  selectedSession,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  isMobile,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  processingSessions,
  onNavigateToSession,
  onNewSession,
  onSessionEstablished,
  onShowSettings,
  newSessionTrigger,
}: MainContentProps) {
  const { t } = useTranslation(['common', 'settings']);
  const { showImagePreviews, toolOutputDensity, sendByCtrlEnter } = useUiPreferences().preferences;
  const sessionStore = useSessionStore();
  // The agent sidebar is the one right-hand surface; its hook owns the only
  // right-rail state left, a persisted open/closed record.
  const agentSidebar = useAgentSidebar();
  const sessionLocation = useSessionLocation(selectedSession?.id);
  // Where the selected session runs (its worktree, once known) or, with no
  // session, the project itself. The sidebar's Environment block reads git
  // from here.
  const executionPath = selectedSession ? sessionLocation.data?.cwd ?? undefined : selectedProject?.fullPath;
  const automationSessionId = selectedProject
    ? selectedSession?.id ?? `project-${selectedProject.projectId}`
    : undefined;
  const automationSessionIdRef = useRef(automationSessionId);
  automationSessionIdRef.current = automationSessionId;
  const [browserFailure, setBrowserFailure] = useState<{ kind: BuiltinBrowserFailure; sessionId: string } | null>(null);

  const revealFile = useCallback((path: string) => {
    void api.system.openFile(path).catch((error) => {
      console.error('Failed to open file in the system editor:', error);
    });
  }, []);

  const resolveFile = useFileOpenResolver(selectedProject, revealFile, selectedSession?.id, sessionLocation.data?.cwd);

  useEffect(() => {
    if (activeTab === 'shell' || activeTab === 'git' || activeTab === 'files') {
      setActiveTab('chat');
    }
  }, [activeTab, setActiveTab]);

  usePaletteOpsRegister({
    openFile: revealFile,
    openFileInEditor: resolveFile,
    openBrowser: (address: string) => {
      if (!hasBuiltinBrowserBridge() || !automationSessionId) {
        void openBrowserUrl(address);
        return;
      }
      const requestSessionId = automationSessionId;
      setBrowserFailure(null);
      void openBuiltinBrowser(requestSessionId, address).catch((error) => {
        console.error('Failed to open the built-in browser:', error);
        if (automationSessionIdRef.current === requestSessionId) {
          setBrowserFailure({ kind: builtinBrowserFailure(error), sessionId: requestSessionId });
        }
      });
    },
  });

  const visibleBrowserFailure = browserFailure?.sessionId === automationSessionId ? browserFailure : null;
  const browserFailureNotice = visibleBrowserFailure ? (
    <p className="mx-3 mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
      {t(`automation.builtinBrowser.errors.${visibleBrowserFailure.kind}`, { ns: 'settings' })}
    </p>
  ) : null;

  if (isLoading) {
    return (
      <>
        {browserFailureNotice}
        <MainContentStateView
          mode="loading"
          isMobile={isMobile}
          onMenuClick={onMenuClick}
          onNewSession={onNewSession}
        />
      </>
    );
  }

  if (!selectedProject) {
    return (
      <MainContentStateView
        mode="empty"
        isMobile={isMobile}
        onMenuClick={onMenuClick}
        onNewSession={onNewSession}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MainContentHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
        sidebarOpen={agentSidebar.isOpen}
        onToggleSidebar={agentSidebar.toggle}
      />
      {browserFailureNotice}

      <SessionStatusProvider>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div style={{ minWidth: MIN_AGENT_SIDEBAR_CHAT_WIDTH }} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
            <ErrorBoundary showDetails>
              <Suspense fallback={null}>
                <ChatInterface
                  sessionStore={sessionStore}
                  selectedProject={selectedProject}
                  selectedSession={selectedSession}
                  ws={ws}
                  sendMessage={sendMessage}
                  onFileOpen={resolveFile}
                  onInputFocusChange={onInputFocusChange}
                  onSessionProcessing={onSessionProcessing}
                  onSessionIdle={onSessionIdle}
                  processingSessions={processingSessions}
                  onNavigateToSession={onNavigateToSession}
                  onSessionEstablished={onSessionEstablished}
                  onShowSettings={onShowSettings}
                  toolOutputDensity={toolOutputDensity}
                  showImagePreviews={showImagePreviews}
                  sendByCtrlEnter={sendByCtrlEnter}
                  newSessionTrigger={newSessionTrigger}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>

        {agentSidebar.isOpen && (
          <Suspense fallback={null}>
            <AgentSidebar
              isMobile={isMobile}
              projectId={selectedProject.projectId}
              projectPath={executionPath}
              sessionId={selectedSession?.id}
              sessionStore={sessionStore}
              onClose={agentSidebar.close}
            />
          </Suspense>
        )}
      </div>
      </SessionStatusProvider>
    </div>
  );
}

export default MainContent;
