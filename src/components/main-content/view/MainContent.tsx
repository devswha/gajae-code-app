import React, { lazy, Suspense, useEffect, useState } from 'react';

import type { MainContentProps } from '../types/types';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useFileOpenResolver } from '../../../hooks/useFileOpenResolver';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import ErrorBoundary from './ErrorBoundary';

const ChatInterface = lazy(() => import('../../chat/view/ChatInterface'));
const EditorSidebar = lazy(() => import('../../code-editor/view/EditorSidebar'));
const FilesPanel = lazy(() => import('./subcomponents/FilesPanel'));

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

  const [filesPanelOpen, setFilesPanelOpen] = useState(() => {
    try {
      return localStorage.getItem('files-panel-open') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('files-panel-open', String(filesPanelOpen));
    } catch {
      // storage errors are non-fatal
    }
  }, [filesPanelOpen]);


  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  // Resolves bare/partial file references (e.g. links inside chat messages) to
  // real project files before opening them in the in-app editor.
  const resolvedFileOpen = useFileOpenResolver(selectedProject, handleFileOpen);

  useEffect(() => {
    // Shell/Git/Files tabs were removed; a persisted selection would render a
    // blank main area, so bounce it back to chat (Files lives in FilesPanel).
    if (activeTab === 'shell' || activeTab === 'git' || activeTab === 'files') {
      setActiveTab('chat');
    }
  }, [activeTab, setActiveTab]);

  usePaletteOpsRegister({
    openFile: (filePath: string) => {
      setActiveTab('files');
      handleFileOpen(filePath);
    },
    // Opens the editor side panel in place, keeping the current tab (e.g. chat).
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
        filesPanelOpen={filesPanelOpen}
        onToggleFilesPanel={() => setFilesPanelOpen((previous) => !previous)}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className={`flex min-h-0 min-w-[200px] flex-col overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}>
          <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
            <ErrorBoundary showDetails>
              <Suspense fallback={null}>
                <ChatInterface
                  selectedProject={selectedProject}
                  selectedSession={selectedSession}
                  ws={ws}
                  sendMessage={sendMessage}
                  onFileOpen={handleFileOpen}
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

        {filesPanelOpen && (
          <div className="w-80 max-w-[85vw] flex-shrink-0 border-l border-border/60 bg-background md:w-72">
            <Suspense fallback={null}>
              <FilesPanel
                onFileOpen={(filePath, projectId) => handleFileOpen(filePath, null, { projectId })}
                onClose={() => setFilesPanelOpen(false)}
              />
            </Suspense>
          </div>
        )}

        {editingFile && (
          <Suspense fallback={null}>
            <EditorSidebar
              editingFile={editingFile}
              isMobile={isMobile}
              editorExpanded={editorExpanded}
              editorWidth={editorWidth}
              hasManualWidth={hasManualWidth}
              resizeHandleRef={resizeHandleRef}
              onResizeStart={handleResizeStart}
              onCloseEditor={handleCloseEditor}
              onToggleEditorExpand={handleToggleEditorExpand}
              projectPath={selectedProject.path}
              fillSpace={false}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default React.memo(MainContent);
