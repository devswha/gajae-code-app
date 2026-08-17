import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, MutableRefObject } from 'react';
import { Activity, FileCode2, FolderTree, PanelRightClose, X, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PillBar, Pill } from '../../../shared/view/ui';
import type { CodeEditorFile } from '../../code-editor/types/types';
import { useSessionStatus } from '../../../contexts/SessionStatusContext';
import {
  MIN_WORKSPACE_PANEL_WIDTH,
  WORKSPACE_TABS,
  workspaceTabForKey,
  type WorkspaceTab,
} from '../workspacePanelState';

const FilesPanel = lazy(() => import('./FilesPanel'));
const WorkspaceStatusTab = lazy(() => import('./WorkspaceStatusTab'));
const CodeEditor = lazy(() => import('../../code-editor/view/CodeEditor'));

const TAB_ICONS: Record<WorkspaceTab, LucideIcon> = {
  status: Activity,
  files: FolderTree,
  editor: FileCode2,
};

export type WorkspacePanelProps = {
  tab: WorkspaceTab;
  width: number;
  expanded: boolean;
  isMobile: boolean;
  editingFile: CodeEditorFile | null;
  projectName?: string;
  projectPath?: string;
  projectId?: string;
  resizeHandleRef: MutableRefObject<HTMLDivElement | null>;
  onTabChange: (tab: WorkspaceTab) => void;
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onToggleExpand: () => void;
  onClose: () => void;
  onFileOpen: (filePath: string, projectId: string) => void;
  onCloseEditor: () => void;
};

const tabId = (tab: WorkspaceTab) => `workspace-tab-${tab}`;
const tabPanelId = (tab: WorkspaceTab) => `workspace-tabpanel-${tab}`;

/**
 * The single right-hand surface: one column, one width, one close control, with
 * Files and Editor as tabs inside it. Chat keeps the rest of the row, so
 * switching tools never reflows the conversation.
 */
export default function WorkspacePanel({
  tab,
  width,
  expanded,
  isMobile,
  editingFile,
  projectName,
  projectPath,
  projectId,
  resizeHandleRef,
  onTabChange,
  onResizeStart,
  onResizeKeyDown,
  onToggleExpand,
  onClose,
  onFileOpen,
  onCloseEditor,
}: WorkspacePanelProps) {
  const { t } = useTranslation();
  const sessionStatus = useSessionStatus();
  const tabRefs = useRef<Partial<Record<WorkspaceTab, HTMLButtonElement | null>>>({});
  const [poppedOut, setPoppedOut] = useState(false);

  useEffect(() => {
    if (!editingFile) {
      setPoppedOut(false);
    }
  }, [editingFile]);

  const handleTabKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const next = workspaceTabForKey(tab, event.key);
    if (!next) {
      return;
    }
    event.preventDefault();
    onTabChange(next);
    tabRefs.current[next]?.focus();
  }, [onTabChange, tab]);

  const header = (
    <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5">
      <PillBar role="tablist" aria-label={t('workspace.title')}>
        {WORKSPACE_TABS.map((candidate) => {
          const Icon = TAB_ICONS[candidate];
          const isActive = candidate === tab;
          return (
            <Pill
              key={candidate}
              id={tabId(candidate)}
              role="tab"
              ariaSelected={isActive}
              ariaControls={tabPanelId(candidate)}
              tabIndex={isActive ? 0 : -1}
              buttonRef={(element) => {
                tabRefs.current[candidate] = element;
              }}
              isActive={isActive}
              onClick={() => onTabChange(candidate)}
              onKeyDown={handleTabKeyDown}
              className="px-2.5 py-[5px] text-xs"
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
              <span>{t(`workspace.tabs.${candidate}`)}</span>
            </Pill>
          );
        })}
      </PillBar>

      <div className="flex flex-shrink-0 items-center gap-0.5">
        {!isMobile && (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-pressed={expanded}
            title={expanded ? t('workspace.collapse') : t('workspace.expand')}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <PanelRightClose className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title={t('workspace.close')}
          aria-label={t('workspace.close')}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  const body = (
    <div
      role="tabpanel"
      id={tabPanelId(tab)}
      aria-labelledby={tabId(tab)}
      className="min-h-0 flex-1 overflow-hidden"
    >
      <Suspense fallback={null}>
        {tab === 'status' && (
          <WorkspaceStatusTab
            status={sessionStatus}
            projectName={projectName}
            projectPath={projectPath}
            projectId={projectId}
            active
          />
        )}
        {tab === 'files' && <FilesPanel onFileOpen={onFileOpen} />}
        {tab === 'editor' && (
          <WorkspaceEditorTab
            editingFile={editingFile}
            projectPath={projectPath}
            isMobile={isMobile}
            expanded={expanded}
            poppedOut={poppedOut}
            emptyTitle={t('workspace.editorEmpty.title')}
            emptyDescription={t('workspace.editorEmpty.description')}
            onCloseEditor={onCloseEditor}
            onToggleExpand={onToggleExpand}
            onPopOut={() => setPoppedOut(true)}
            onPopIn={() => setPoppedOut(false)}
          />
        )}
      </Suspense>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          aria-label={t('workspace.close')}
          onClick={onClose}
          className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm"
        />
        <aside
          aria-label={t('workspace.title')}
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[85vw] flex-col border-l border-border/60 bg-background shadow-xl"
        >
          {header}
          {body}
        </aside>
      </>
    );
  }

  return (
    <div
      className={`flex min-h-0 ${expanded ? 'flex-1' : 'flex-shrink-0'}`}
      style={expanded ? undefined : { width: `${width}px`, minWidth: `${MIN_WORKSPACE_PANEL_WIDTH}px` }}
    >
      {!expanded && (
        <div
          ref={resizeHandleRef}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('workspace.resize')}
          aria-valuenow={Math.round(width)}
          aria-valuemin={MIN_WORKSPACE_PANEL_WIDTH}
          tabIndex={0}
          onMouseDown={onResizeStart}
          onKeyDown={onResizeKeyDown}
          title={t('workspace.resize')}
          className="group relative w-1 flex-shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary focus-visible:bg-primary focus-visible:outline-none"
        >
          <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-primary opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      )}

      <aside
        aria-label={t('workspace.title')}
        className="flex min-w-0 flex-1 flex-col border-l border-border/60 bg-background"
      >
        {header}
        {body}
      </aside>
    </div>
  );
}

type WorkspaceEditorTabProps = {
  editingFile: CodeEditorFile | null;
  projectPath?: string;
  isMobile: boolean;
  expanded: boolean;
  poppedOut: boolean;
  emptyTitle: string;
  emptyDescription: string;
  onCloseEditor: () => void;
  onToggleExpand: () => void;
  onPopOut: () => void;
  onPopIn: () => void;
};

function WorkspaceEditorTab({
  editingFile,
  projectPath,
  isMobile,
  expanded,
  poppedOut,
  emptyTitle,
  emptyDescription,
  onCloseEditor,
  onToggleExpand,
  onPopOut,
  onPopIn,
}: WorkspaceEditorTabProps) {
  if (!editingFile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
        <FileCode2 className="h-6 w-6 text-muted-foreground/60" aria-hidden />
        <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
        <p className="text-xs text-muted-foreground">{emptyDescription}</p>
      </div>
    );
  }

  // A phone has no room for a docked editor, and the pop-out button asks for
  // the same modal on purpose; both take the full-screen editor.
  if (isMobile || poppedOut) {
    return (
      <CodeEditor
        file={editingFile}
        onClose={() => {
          onPopIn();
          onCloseEditor();
        }}
        projectPath={projectPath}
        isSidebar={false}
      />
    );
  }

  return (
    <CodeEditor
      file={editingFile}
      onClose={onCloseEditor}
      projectPath={projectPath}
      isSidebar
      isExpanded={expanded}
      onToggleExpand={onToggleExpand}
      onPopOut={onPopOut}
    />
  );
}
