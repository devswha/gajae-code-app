import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

import type { MainContentProps } from '../types/types';
import { usePaletteOpsRegister } from '../../../stores/usePaletteOpsStore';
import { SessionStatusProvider } from '../../../contexts/SessionStatusContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useFileOpenResolver } from '../../../hooks/useFileOpenResolver';
import { useProjectPermissions } from '../../../hooks/useProjectPermissions';
import { useWorkspacePanel } from '../../workspace/hooks/useWorkspacePanel';
import { api } from '../../../utils/api';

import MainContentHeader from './MainContentHeader';
import MainContentStateView from './MainContentStateView';
import ErrorBoundary from './ErrorBoundary';

const ChatInterface = lazy(() => import('../../chat/view/ChatInterface'));
const WorkspacePanel = lazy(() => import('../../workspace/view/WorkspacePanel'));

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
  onSessionEstablished,
  onShowSettings,
  newSessionTrigger,
}: MainContentProps) {
  const { showImagePreviews, toolOutputDensity, sendByCtrlEnter } = useUiPreferences().preferences;
  const panel = useWorkspacePanel({ isMobile });
  const { closePanel, containerRef, expanded, handleResizeKeyDown, handleResizeStart, isOpen, resizeHandleRef, setTab, tab, toggleExpanded, togglePanel, width } = panel;
  const [pendingBrowserNavigation, setPendingBrowserNavigation] = useState<{ id: number; url: string } | null>(null);
  const navigationSequence = useRef(0);
  const { permissions: projectPermissions } = useProjectPermissions(selectedProject?.projectId);

  const revealFile = useCallback((path: string) => {
    void api.system.openFile(path).catch((error) => {
      console.error('Failed to open file in the system editor:', error);
    });
  }, []);

  const resolveFile = useFileOpenResolver(selectedProject, revealFile);

  useEffect(() => {
    if (activeTab === 'shell' || activeTab === 'git' || activeTab === 'files') {
      setActiveTab('chat');
    }
  }, [activeTab, setActiveTab]);

  usePaletteOpsRegister({
    openFile: revealFile,
    openFileInEditor: resolveFile,
    openBrowser: (address: string) => {
      navigationSequence.current += 1;
      setPendingBrowserNavigation({ id: navigationSequence.current, url: address });
      setTab('browser');
    },
  });

  if (isLoading) {
    return (
      <MainContentStateView
        mode="loading"
        isMobile={isMobile}
        onMenuClick={onMenuClick}
      />
    );
  }

  if (!selectedProject) {
    return (
      <MainContentStateView
        mode="empty"
        isMobile={isMobile}
        onMenuClick={onMenuClick}
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
        workspaceOpen={isOpen}
        onToggleWorkspace={togglePanel}
      />

      <SessionStatusProvider>
      <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className={`flex min-h-0 min-w-50 flex-1 flex-col overflow-hidden ${expanded ? 'hidden' : ''}`}>
          <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
            <ErrorBoundary showDetails>
              <Suspense fallback={null}>
                <ChatInterface
                  selectedProject={selectedProject}
                  selectedSession={selectedSession}
                  ws={ws}
                  sendMessage={sendMessage}
                  onFileOpen={revealFile}
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

        {isOpen && (
          <Suspense fallback={null}>
            <WorkspacePanel
              tab={tab}
              width={width}
              expanded={expanded}
              isMobile={isMobile}
              projectName={selectedProject.displayName}
              projectPath={selectedProject.path}
              projectId={selectedProject.projectId}
              permissionMode={projectPermissions?.mode ?? null}
              automationSessionId={selectedSession?.id ?? `project-${selectedProject.projectId}`}
              browserNavigation={pendingBrowserNavigation}
              onBrowserNavigationHandled={() => setPendingBrowserNavigation(null)}
              resizeHandleRef={resizeHandleRef}
              onTabChange={setTab}
              onResizeStart={handleResizeStart}
              onResizeKeyDown={handleResizeKeyDown}
              onToggleExpand={toggleExpanded}
              onClose={closePanel}
            />
          </Suspense>
        )}
      </div>
      </SessionStatusProvider>
    </div>
  );
}

export default MainContent;
