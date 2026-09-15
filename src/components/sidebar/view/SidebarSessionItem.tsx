import { useEffect, useRef } from 'react';
import { Archive, Bug, Check, Download, Edit2, MoreHorizontal, Pin, RefreshCw, Trash2, X, type LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';

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
  /**
   * Set only where one list mixes conversations from several projects, which
   * is the work list. Rows nested under their own project header already know
   * where they live and must not repeat it.
   */
  projectLabel?: string;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onToggleSessionStar?: (sessionId: string) => void;
  /** Hides the conversation without touching its transcript; the archive screen brings it back. */
  onArchiveSession?: (sessionId: string) => void;
  onRegenerateTitle?: (sessionId: string) => void;
  onExportSession?: (sessionId: string) => void;
  /** Assembles the session's debug bundle into the clipboard, for a bug report. */
  onCopyDebugInfo?: (sessionId: string) => void;
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
 * <1m, Xm, Xh, Xd.
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
    return `${diffInHours}h`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d`;
};

/**
 * Quick actions collapse to nothing until the row is hovered or a child takes
 * focus, so a resting row is only its title and its age. They keep their width
 * at zero rather than `display:none` so the keyboard can still reach them, and
 * drop pointer events while invisible: a button you cannot see must not be a
 * button you can click.
 */
const COLLAPSED_ACTION =
  'pointer-events-none w-0 opacity-0 group-hover:pointer-events-auto group-hover:w-6 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:w-6 group-focus-within:opacity-100';

const ACTION_BUTTON =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity duration-150 hover:bg-accent hover:text-foreground';

type RowActionProps = {
  icon: LucideIcon;
  label: string;
  /** Stays on screen at rest; used for the marker a pinned row must keep showing. */
  pinnedOpen: boolean;
  iconClassName?: string;
  className?: string;
  onSelect: () => void;
};

function RowAction({ icon: Icon, label, pinnedOpen, iconClassName, className, onSelect }: RowActionProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(ACTION_BUTTON, !pinnedOpen && COLLAPSED_ACTION, className)}
      onClick={(event) => {
        // The row itself is a link stretched under this button.
        event.preventDefault();
        event.stopPropagation();
        onSelect();
      }}
    >
      <Icon className={cn('h-3.5 w-3.5', iconClassName)} />
    </button>
  );
}

type SessionActionOptions = {
  sessionId: string;
  sessionName: string;
  isProcessing: boolean;
  t: TFunction;
  onRegenerateTitle?: (sessionId: string) => void;
  onExportSession?: (sessionId: string) => void;
  onCopyDebugInfo?: (sessionId: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onDeleteSession: () => void;
};

/**
 * The row's overflow menu: what is left once pin and archive moved onto the
 * row itself.
 *
 * Optional entries are driven by whether the host wired a handler: a menu item
 * that silently does nothing is worse than one that is absent. Exported so the
 * rule can be tested without opening a dropdown, whose contents only exist once
 * it is open.
 */
export function buildSessionActions({
  sessionId,
  sessionName,
  isProcessing,
  t,
  onRegenerateTitle,
  onExportSession,
  onCopyDebugInfo,
  onStartEditingSession,
  onDeleteSession,
}: SessionActionOptions): ActionMenuItem[] {
  return [
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
    ...(onCopyDebugInfo ? [{
      key: 'copy-debug-info',
      label: t('sessions.copyDebugInfo'),
      icon: Bug,
      onSelect: () => onCopyDebugInfo(sessionId),
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
  projectLabel,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onToggleSessionStar,
  onArchiveSession,
  onRegenerateTitle,
  onExportSession,
  onCopyDebugInfo,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  t,
}: SidebarSessionItemProps) {
  const sessionView = createSessionViewModel(session, currentTime, t);
  const isSelected = selectedSession?.id === session.id;
  const isEditing = editingSession === session.id;
  const sessionAge = formatCompactSessionAge(sessionView.sessionTime, currentTime);
  const editingContainerRef = useRef<HTMLDivElement>(null);
  const isBusy = status === 'running' || status === 'needs_input';
  // The glyph takes the age's slot; `ready` keeps the age and speaks through
  // the leading dot alone.
  const showsGlyph = status !== 'idle' && status !== 'ready';
  const isStarred = Boolean(session.isStarred);
  // Touch has no hover to reveal anything, so the row shows its actions.
  const actionsStayOpen = isMobile;

  // While editing, dismiss only when the user clicks outside the panel
  // (matches Escape / cancel-button behaviour).
  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const container = editingContainerRef.current;
      if (!container || !container.contains(event.target as Node)) {
        onCancelEditingSession();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isEditing, onCancelEditingSession]);

  // Sessions are owned by a project identified by `projectId` (DB primary key)
  // after the projectName → projectId migration.
  const selectSession = () => {
    onProjectSelect(project);
    onSessionSelect(session, project.projectId);
  };

  const saveEditedSession = () => {
    onSaveEditingSession(project.projectId, session.id, editingSessionName, session.__provider);
  };

  const requestDeleteSession = () => {
    onDeleteSession(project.projectId, session.id, sessionView.sessionName, session.__provider);
  };

  // Renaming takes the row over as an input with its own buttons, on every
  // device: a rename panel that only existed on desktop made the menu item a
  // silent no-op on touch.
  if (isEditing) {
    return (
      <div className="group relative" data-session-status={status}>
        <SessionStatusDot status={status} t={t} />
        <div
          ref={editingContainerRef}
          className="my-0.5 flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1"
        >
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
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-0.5 text-sm focus:ring-1 focus:ring-primary focus:outline-hidden"
            autoFocus
          />
          <button
            type="button"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10 hover:bg-primary/20"
            onClick={saveEditedSession}
            title={t('tooltips.save')}
          >
            <Check className="h-3.5 w-3.5 text-primary" />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted hover:bg-accent"
            onClick={onCancelEditingSession}
            title={t('tooltips.cancel')}
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
    );
  }

  const sessionActions = buildSessionActions({
    sessionId: session.id,
    sessionName: sessionView.sessionName,
    isProcessing,
    t,
    onRegenerateTitle,
    onExportSession,
    onCopyDebugInfo,
    onStartEditingSession,
    onDeleteSession: requestDeleteSession,
  });

  // The whole row is the target. It is a stretched link rather than a wrapper
  // so the quick actions can sit in the flow beside the title instead of
  // covering it - buttons cannot be nested inside an anchor.
  const rowTarget = isMobile ? (
    <button
      type="button"
      className="absolute inset-0 rounded-md"
      aria-label={sessionView.sessionName}
      onClick={selectSession}
    />
  ) : (
    <a
      href={`/session/${session.id}`}
      className="absolute inset-0 rounded-md"
      aria-label={sessionView.sessionName}
      // Left-click keeps in-app navigation; Ctrl/Cmd/middle-click and the
      // native right-click menu use the href to open a new tab/window.
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onSessionSelect(session, project.projectId);
      }}
    />
  );

  return (
    <div
      className={cn(
        'group relative my-0.5 flex h-8 items-center gap-1 rounded-md border border-transparent px-2 transition-colors duration-150',
        isSelected
          ? 'bg-accent text-accent-foreground'
          : isBusy || sessionView.isActive
            ? 'bg-muted/30 hover:bg-muted/40'
            : 'hover:bg-accent/70',
      )}
      data-session-status={status}
    >
      {rowTarget}
      {/* After the stretched link so the dot keeps its own tooltip. */}
      <SessionStatusDot status={status} t={t} />

      <span className="min-w-0 flex-1 truncate text-sm font-normal text-foreground">
        {sessionView.sessionName}
      </span>

      {projectLabel && (
        // Capped so a long project name can never crowd out the title it
        // qualifies; it truncates on its own.
        <span data-slot="session-project" className="max-w-[40%] min-w-0 shrink truncate text-[11px] text-muted-foreground">
          {projectLabel}
        </span>
      )}

      <div className="relative flex shrink-0 items-center gap-0.5">
        {onToggleSessionStar && (
          <RowAction
            icon={Pin}
            label={t(isStarred ? 'sessions.unpin' : 'sessions.pin')}
            // A pinned row has to say so while nobody is pointing at it.
            pinnedOpen={actionsStayOpen || isStarred}
            className={cn(isStarred && 'text-primary')}
            iconClassName={cn(isStarred && 'fill-current')}
            onSelect={() => onToggleSessionStar(session.id)}
          />
        )}
        {/* Archiving a live run would drop it out of the sidebar mid-turn. */}
        {onArchiveSession && !isProcessing && (
          <RowAction
            icon={Archive}
            label={t('sessions.archiveSession', 'Archive conversation')}
            pinnedOpen={actionsStayOpen}
            onSelect={() => onArchiveSession(session.id)}
          />
        )}
        <ActionMenu
          label=""
          ariaLabel={t('tooltips.sessionActions')}
          items={sessionActions}
          icon={MoreHorizontal}
          variant="ghost"
          size="icon"
          className={cn(
            !actionsStayOpen && COLLAPSED_ACTION,
            // The open menu has to outlive the hover that revealed it and paint
            // over the rows below, which otherwise steal its clicks.
            'has-aria-expanded:pointer-events-auto has-aria-expanded:z-50 has-aria-expanded:w-6 has-aria-expanded:opacity-100',
          )}
          triggerClassName="h-6 w-6 rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        />
      </div>

      {/* One slot on the trailing edge: the age, or the glyph that replaces it.
          It stays out of the pointer's way so the stretched link keeps the
          whole width of the row. */}
      <span className="flex w-8 shrink-0 justify-end text-[11px] text-muted-foreground">
        {showsGlyph ? <SessionStatusGlyph status={status} t={t} /> : sessionAge}
      </span>
    </div>
  );
}
