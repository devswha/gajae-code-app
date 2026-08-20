import React, { lazy, Suspense, useCallback, useEffect } from 'react';

import type { MainContentProps } from '../types/types';
import type { CodeEditorDiffInfo } from '../../code-editor/types/types';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import { SessionStatusProvider } from '../../../contexts/SessionStatusContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useFileOpenResolver } from '../../../hooks/useFileOpenResolver';
import { useEditorFile } from '../../code-editor/hooks/useEditorFile';
import { useWorkspacePanel } from '../../workspace/hooks/useWorkspacePanel';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
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
  externalMessageUpdate,
  newSessionTrigger,
}: MainContentProps) {
  const { preferences } = useUiPreferences();
  const { showRawParameters, showThinking, showImagePreviews, sendByCtrlEnter } = preferences;

  const workspace = useWorkspacePanel({ isMobile });

  const { editingFile, handleFileOpen, handleCloseEditor } = useEditorFile({ selectedProject });

  // Opening a file is a request to see it, so the panel comes along with it.
  const openFileInWorkspace = useCallback(
    (filePath: string, diffInfo: CodeEditorDiffInfo | null = null, options: { projectId?: string } = {}) => {
      handleFileOpen(filePath, diffInfo, options);
      workspace.setTab('editor');
    },
    [handleFileOpen, workspace],
  );

  // Resolves bare/partial file references (e.g. links inside chat messages) to
  // real project files before opening them in the in-app editor.
  const resolvedFileOpen = useFileOpenResolver(selectedProject, openFileInWorkspace);

  useEffect(() => {
    // Shell/Git/Files tabs were removed; a persisted selection would render a
    // blank main area, so bounce it back to chat (Files lives in the Workspace
    // panel).
    if (activeTab === 'shell' || activeTab === 'git' || activeTab === 'files') {
      setActiveTab('chat');
    }
  }, [activeTab, setActiveTab]);

  usePaletteOpsRegister({
    openFile: (filePath: string) => {
      openFileInWorkspace(filePath);
    },
    // Opens the file in the Workspace editor tab, keeping the chat in place.
    openFileInEditor: (filePath: string) => {
      resolvedFileOpen(filePath);
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
        workspaceOpen={workspace.isOpen}
        onToggleWorkspace={workspace.togglePanel}
      />

      <SessionStatusProvider>
      <div ref={workspace.containerRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className={`flex min-h-0 min-w-[200px] flex-1 flex-col overflow-hidden ${workspace.expanded ? 'hidden' : ''}`}>
          <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
            <ErrorBoundary showDetails>
              <Suspense fallback={null}>
                <ChatInterface
                  selectedProject={selectedProject}
                  selectedSession={selectedSession}
                  ws={ws}
                  sendMessage={sendMessage}
                  onFileOpen={openFileInWorkspace}
                  onInputFocusChange={onInputFocusChange}
                  onSessionProcessing={onSessionProcessing}
                  onSessionIdle={onSessionIdle}
                  processingSessions={processingSessions}
                  onNavigateToSession={onNavigateToSession}
                  onSessionEstablished={onSessionEstablished}
                  onShowSettings={onShowSettings}
                  showRawParameters={showRawParameters}
                  showThinking={showThinking}
                  showImagePreviews={showImagePreviews}
                  sendByCtrlEnter={sendByCtrlEnter}
                  externalMessageUpdate={externalMessageUpdate}
                  newSessionTrigger={newSessionTrigger}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>

        {workspace.isOpen && (
          <Suspense fallback={null}>
            <WorkspacePanel
              tab={workspace.tab}
              width={workspace.width}
              expanded={workspace.expanded}
              isMobile={isMobile}
              editingFile={editingFile}
              projectName={selectedProject.displayName}
              projectPath={selectedProject.path}
              projectId={selectedProject.projectId}
              automationSessionId={selectedSession?.id ?? `project-${selectedProject.projectId}`}
              resizeHandleRef={workspace.resizeHandleRef}
              onTabChange={workspace.setTab}
              onResizeStart={workspace.handleResizeStart}
              onResizeKeyDown={workspace.handleResizeKeyDown}
              onToggleExpand={workspace.toggleExpanded}
              onClose={workspace.closePanel}
              onFileOpen={(filePath, projectId) => openFileInWorkspace(filePath, null, { projectId })}
              onCloseEditor={handleCloseEditor}
            />
          </Suspense>
        )}
      </div>
      </SessionStatusProvider>
    </div>
  );
}

export default React.memo(MainContent);
