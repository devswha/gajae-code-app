import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MainContentProps } from '../types/types';
import { usePaletteOpsRegister } from '../../../stores/usePaletteOpsStore';
import { SessionStatusProvider } from '../../../contexts/SessionStatusContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useFileOpenResolver } from '../../../hooks/useFileOpenResolver';
import { useProjectPermissions } from '../../../hooks/useProjectPermissions';
import { useSessionStore } from '../../../stores/useSessionStore';
import { useWorkspacePanel } from '../../workspace/hooks/useWorkspacePanel';
import { MIN_WORKSPACE_CHAT_WIDTH } from '../../workspace/workspacePanelState';
import { useAgentSidebar } from '../../agent-sidebar/hooks/useAgentSidebar';
import { MIN_AGENT_SIDEBAR_CHAT_WIDTH } from '../../agent-sidebar/agentSidebarState';
import { api } from '../../../utils/api';
import { openBrowserUrl } from '../../../utils/externalLink';
import { builtinBrowserFailure, hasBuiltinBrowserBridge, openBuiltinBrowser, type BuiltinBrowserFailure } from '../../../utils/builtinBrowser';
import { useSessionLocation } from '../../chat/hooks/useSessionLocation';

import MainContentHeader from './MainContentHeader';
import MainContentStateView from './MainContentStateView';
import MainContentRightRail from './MainContentRightRail';
import ErrorBoundary from './ErrorBoundary';

const ChatInterface = lazy(() => import('../../chat/view/ChatInterface'));

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
  const { showImagePreviews, toolOutputDensity, sendByCtrlEnter, agentSidebarV2 } = useUiPreferences().preferences;
  const sessionStore = useSessionStore();
  const panel = useWorkspacePanel({ isMobile });
  // Both rails keep their own state; only the selected one renders.
  const agentSidebar = useAgentSidebar();
  const composerInsertRef = useRef<((text: string) => void) | null>(null);
  const handleComposerInsert = useCallback((text: string) => {
    const insert = composerInsertRef.current;
    if (!insert) return false;
    insert(text);
    return true;
  }, []);
  const { closePanel, containerRef, expanded, handleResizeKeyDown, handleResizeStart, isOpen, resizeHandleRef, setTab, tab, toggleExpanded, togglePanel, width } = panel;
  const rightRailOpen = agentSidebarV2 ? agentSidebar.isOpen : isOpen;
  const toggleRightRail = agentSidebarV2 ? agentSidebar.toggle : togglePanel;
  // The legacy expanded mode must not hide the chat while the experiment is on.
  const chatHidden = !agentSidebarV2 && expanded;
  const { permissions: projectPermissions } = useProjectPermissions(selectedProject?.projectId);
  const sessionLocation = useSessionLocation(selectedSession?.id);
  // Where the selected session runs (its worktree, once known) or, with no
  // session, the project itself. Both rails read git and files from here.
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
        workspaceOpen={rightRailOpen}
        onToggleWorkspace={toggleRightRail}
        rightRail={agentSidebarV2 ? 'agentSidebar' : 'workspace'}
      />
      {browserFailureNotice}

      <SessionStatusProvider>
      <div ref={agentSidebarV2 ? undefined : containerRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div style={{ minWidth: agentSidebarV2 ? MIN_AGENT_SIDEBAR_CHAT_WIDTH : MIN_WORKSPACE_CHAT_WIDTH }} className={`flex min-h-0 flex-1 flex-col overflow-hidden ${chatHidden ? 'hidden' : ''}`}>
          <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
            <ErrorBoundary showDetails>
              <Suspense fallback={null}>
                <ChatInterface
                  sessionStore={sessionStore}
                  composerInsertRef={composerInsertRef}
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

        <MainContentRightRail
          agentSidebarV2={agentSidebarV2}
          open={rightRailOpen}
          workspace={{
            sessionStore,
            tab,
            width,
            expanded,
            isMobile,
            projectName: selectedProject.displayName,
            projectPath: executionPath,
            projectId: selectedProject.projectId,
            sessionId: selectedSession?.id,
            onComposerInsert: handleComposerInsert,
            permissionMode: projectPermissions?.mode ?? null,
            resizeHandleRef,
            onTabChange: setTab,
            onResizeStart: handleResizeStart,
            onResizeKeyDown: handleResizeKeyDown,
            onToggleExpand: toggleExpanded,
            onClose: closePanel,
          }}
          agentSidebar={{
            isMobile,
            projectId: selectedProject.projectId,
            projectPath: executionPath,
            sessionId: selectedSession?.id,
            sessionStore,
            onClose: agentSidebar.close,
          }}
        />
      </div>
      </SessionStatusProvider>
    </div>
  );
}

export default MainContent;
