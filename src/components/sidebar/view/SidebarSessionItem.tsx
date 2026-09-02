import { useEffect, useRef } from 'react';
import { Check, Download, Edit2, MoreHorizontal, RefreshCw, Star, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Badge, buttonVariants } from '../../../shared/view/ui';
import ActionMenu, { type ActionMenuItem } from '../../../shared/view/ui/ActionMenu';
import type { SessionStatus } from '../../../stores/sessionStatusModel';
import { cn } from '../../../utils/cn';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionWithProvider } from '../types/types';
import { createSessionViewModel } from '../utils/utils';

import { SessionStatusDot, SessionStatusGlyph } from './SidebarSessionStatus';

type SidebarSessionItemProps = {
  project: Project;
  session: SessionWithProvider;
  selectedSession: ProjectSession | null;
  isProcessing: boolean;
  status: SessionStatus;
  /**
   * Picks the one layout the row renders. Rendering both and letting CSS hide
   * one doubled the DOM and gave assistive tech two "Conversation actions"
   * buttons per row, one of them display:none.
   */
  isMobile: boolean;
  showProjectName?: boolean;
  compact?: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onToggleSessionStar?: (sessionId: string) => void;
  onRegenerateTitle?: (sessionId: string) => void;
  onExportSession?: (sessionId: string) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  t: TFunction;
};

/**
 * Compact relative time for sidebar rows:
 * <1m, Xm, Xhr, Xd.
 */
const formatCompactSessionAge = (dateString: string, currentTime: Date): string => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diffInMinutes = Math.floor(Math.max(0, currentTime.getTime() - date.getTime()) / (1000 * 60));
  if (diffInMinutes < 1) {
    return '<1m';
  }

  if (diffInMinutes < 60) {
    return `${diffInMinutes}m`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}hr`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d`;
};

type SessionActionOptions = {
  sessionId: string;
  sessionName: string;
  isStarred: boolean;
  isProcessing: boolean;
  t: TFunction;
  onToggleSessionStar?: (sessionId: string) => void;
  onRegenerateTitle?: (sessionId: string) => void;
  onExportSession?: (sessionId: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onDeleteSession: () => void;
};

/**
 * The row's overflow menu.
 *
 * Optional entries are driven by whether the host wired a handler: a menu item
 * that silently does nothing is worse than one that is absent. Exported so the
 * rule can be tested without opening a dropdown, whose contents only exist once
 * it is open.
 */
export function buildSessionActions({
  sessionId,
  sessionName,
  isStarred,
  isProcessing,
  t,
  onToggleSessionStar,
  onRegenerateTitle,
  onExportSession,
  onStartEditingSession,
  onDeleteSession,
}: SessionActionOptions): ActionMenuItem[] {
  return [
    ...(onToggleSessionStar ? [{
      key: 'pin',
      label: t(isStarred ? 'sessions.unpin' : 'sessions.pin'),
      icon: Star,
      onSelect: () => onToggleSessionStar(sessionId),
    }] : []),
    {
      key: 'rename',
      label: t('sessions.renameSession'),
      icon: Edit2,
      onSelect: () => onStartEditingSession(sessionId, sessionName),
    },
    // Sits next to Rename because it is Rename's undo: the derived title, back.
    ...(onRegenerateTitle ? [{
      key: 'regenerate-title',
      label: t('sessions.regenerateTitle'),
      icon: RefreshCw,
      onSelect: () => onRegenerateTitle(sessionId),
    }] : []),
    ...(onExportSession ? [{
      key: 'export',
      label: t('sessions.exportSession'),
      icon: Download,
      onSelect: () => onExportSession(sessionId),
    }] : []),
    // A running session keeps its transcript: deleting it mid-run would race
    // the writer.
    ...(!isProcessing ? [{
      key: 'delete',
      label: t('sessions.deleteSession'),
      icon: Trash2,
      onSelect: onDeleteSession,
      isDanger: true,
      showDividerBefore: true,
    }] : []),
  ];
}

export default function SidebarSessionItem({
  project,
  session,
  selectedSession,
  isProcessing,
  status,
  isMobile,
  showProjectName = false,
  compact = false,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onToggleSessionStar,
  onRegenerateTitle,
  onExportSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const isEditing = editingSession === session.id;
  const compactSessionAge = formatCompactSessionAge(sessionView.sessionTime, currentTime);
  const editingContainerRef = useRef<HTMLDivElement>(null);
  const isBusy = status === 'running' || status === 'needs_input';
  // The glyph takes the age's slot; `ready` keeps the age and speaks through
  // the leading dot alone.
  const showsGlyph = status !== 'idle' && status !== 'ready';

  // The rename panel sits inside a group-hover opacity wrapper, so leaving the row
  // would visually hide it. While editing, dismiss only when the user clicks outside
  // the panel (matches Escape / cancel-button behaviour).
  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const container = editingContainerRef.current;
      // The touch layout has no rename panel, so any press ends the edit there.
      if (!container || !container.contains(event.target as Node)) {
        onCancelEditingSession();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isEditing, onCancelEditingSession]);

  // Sessions are owned by a project identified by `projectId` (DB primary key)
  // after the projectName → projectId migration.
  const selectMobileSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.projectId);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.projectId, session.id, editingSessionName, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.projectId, session.id, sessionView.sessionName, session.__provider);
  };
  const isStarred = Boolean(session.isStarred);
  const sessionActions = buildSessionActions({
    sessionId: session.id,
    sessionName: sessionView.sessionName,
    isStarred,
    isProcessing,
    t,
    onToggleSessionStar,
    onRegenerateTitle,
    onExportSession,
    onStartEditingSession,
    onDeleteSession: requestDeleteSession,
  });

  const renderSessionMenu = () => (
    <div
      className="flex"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label=""
        ariaLabel={t('tooltips.sessionActions')}
        items={sessionActions}
        icon={MoreHorizontal}
        variant="ghost"
        size="icon"
        triggerClassName="size-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      />
    </div>
  );

  const title = (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-normal text-foreground">
      {isStarred && <Star className="size-3 shrink-0 fill-current text-primary" aria-label={t('sessions.pin')} />}
      <span className="truncate">{sessionView.sessionName}</span>
    </div>
  );

  const renderSecondaryLine = () => (
    <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
      {showProjectName && <span className="truncate text-[11px] text-muted-foreground">{project.displayName}</span>}
      {!showProjectName && sessionView.messageCount > 0 && (
        <Badge variant="secondary" className="px-1 py-0 text-xs">
          {sessionView.messageCount}
        </Badge>
      )}
    </div>
  );

  if (isMobile) {
    // Touch rows keep the menu inline and always visible: there is no hover to
    // reveal it, and the whole row is the tap target.
    return (
      <div className="group relative" data-session-status={status}>
        <SessionStatusDot status={status} t={t} />
        <div
          className={cn(
            'active:scale-0.98 relative mx-0 my-0.5 rounded-lg border border-transparent bg-transparent p-2 transition-all duration-150',
            isSelected ? 'bg-accent text-accent-foreground' : '',
            !isSelected && isBusy
              ? 'bg-muted/30'
              : !isSelected && sessionView.isActive
              ? 'bg-muted/30'
              : 'hover:bg-accent/70',
          )}
          onClick={selectMobileSession}
        >
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {title}
                {showsGlyph ? (
                  <SessionStatusGlyph status={status} t={t} />
                ) : compactSessionAge && (
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{compactSessionAge}</span>
                )}
              </div>
              {renderSecondaryLine()}
            </div>

            {renderSessionMenu()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative" data-session-status={status}>
      <SessionStatusDot status={status} t={t} />
      <a
        href={`/session/${session.id}`}
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          compact
            ? 'h-8 min-h-8 w-full justify-start rounded-md border border-transparent bg-transparent px-2 py-1 text-left font-normal transition-colors duration-150'
            : 'h-auto min-h-9 w-full justify-start rounded-lg border border-transparent bg-transparent px-2.5 py-2 text-left font-normal transition-all duration-150',
          isSelected ? 'bg-accent text-accent-foreground' : '',
          !isSelected && isBusy
            ? 'bg-muted/30 hover:bg-muted/40'
            : !isSelected && sessionView.isActive
              ? 'bg-muted/30 hover:bg-muted/40'
              : 'hover:bg-accent/70',
        )}
        // Left-click keeps in-app navigation; Ctrl/Cmd/middle-click and the
        // native right-click menu use the href to open a new tab/window.
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onSessionSelect(session, project.projectId);
        }}
      >
        <div className={cn('flex w-full min-w-0 items-center', compact ? 'gap-1.5' : 'gap-2')}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {title}
              {showsGlyph ? (
                <SessionStatusGlyph
                  status={status}
                  t={t}
                  className={cn('transition-opacity duration-200', isEditing ? 'opacity-0' : 'group-hover:opacity-0')}
                />
              ) : compactSessionAge && (
                <span
                  className={cn(
                    'ml-auto shrink-0 text-[11px] text-muted-foreground transition-opacity duration-200',
                    isEditing ? 'opacity-0' : 'group-hover:opacity-0',
                  )}
                >
                  {compactSessionAge}
                </span>
              )}
            </div>
            {!compact && renderSecondaryLine()}
          </div>
        </div>
      </a>

      <div
        ref={editingContainerRef}
        className={cn(
          'absolute top-1/2 right-2 flex -translate-y-1/2 transform items-center gap-1 transition-all duration-200',
          // The translate transform makes this wrapper a stacking context, which
          // traps the action menu's z-50 inside it - without an explicit z-index
          // the NEXT session rows paint over the open menu and steal its clicks.
          // Keep the wrapper lifted and visible for exactly as long as the menu
          // is open (aria-expanded), which also survives browsers that do not
          // focus buttons on click (no group-focus-within there).
          'has-aria-expanded:z-50 has-aria-expanded:opacity-100',
          isEditing ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
        )}
      >
        {isEditing ? (
          <>
            <input
              type="text"
              value={editingSessionName}
              onChange={(event) => onEditingSessionNameChange(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  saveEditedSession();
                } else if (event.key === 'Escape') {
                  onCancelEditingSession();
                }
              }}
              onClick={(event) => event.stopPropagation()}
              className="w-32 rounded border border-border bg-background px-2 py-1 text-xs focus:ring-1 focus:ring-primary focus:outline-hidden"
              autoFocus
            />
            <button
              className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 hover:bg-primary/20"
              onClick={(event) => {
                event.stopPropagation();
                saveEditedSession();
              }}
              title={t('tooltips.save')}
            >
              <Check className="h-3 w-3 text-primary" />
            </button>
            <button
              className="flex h-6 w-6 items-center justify-center rounded bg-muted hover:bg-accent"
              onClick={(event) => {
                event.stopPropagation();
                onCancelEditingSession();
              }}
              title={t('tooltips.cancel')}
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          </>
        ) : (
          renderSessionMenu()
        )}
      </div>
    </div>
  );
}
