import { Archive, Check, ChevronRight, Edit3, Folder, Plus, Star, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { useContextMenu } from '../../../shared/view/ui/ContextMenu';
import { cn } from '../../../utils/cn';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionActivityMap } from '../../../hooks/useSessionProtection';
import { needsAttention } from '../../../stores/sessionStatusModel';
import type { SessionStatusResolver } from '../hooks/useSessionStatusResolver';
import type { SessionWithProvider } from '../types/types';

import SidebarProjectSessions from './SidebarProjectSessions';

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  /** The open conversation is highlighted in Work instead, so its tree row stays plain. */
  selectionShownInWork?: boolean;
  isExpanded: boolean;
  isMobile: boolean;
  showSessions: boolean;
  isArchiving: boolean;
  isStarred: boolean;
  editingProject: string | null;
  editingName: string;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingMoreSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingNameChange: (name: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onArchiveProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (projectName: string, sessionId: string, sessionTitle: string, provider: LLMProvider) => void;
  onLoadMoreSessions: (projectId: string) => void;
  activeSessions: SessionActivityMap;
  getSessionStatus: SessionStatusResolver;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onToggleSessionStar?: (sessionId: string) => void;
  onArchiveSession?: (sessionId: string) => void;
  onRegenerateTitle?: (sessionId: string) => void;
  onExportSession?: (sessionId: string) => void;
  onCopyDebugInfo?: (sessionId: string) => void;
  t: TFunction;
};

export default function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  selectionShownInWork = false,
  isExpanded,
  isMobile,
  showSessions,
  isArchiving,
  isStarred,
  editingProject,
  editingName,
  sessions,
  initialSessionsLoaded,
  isLoadingMoreSessions,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onArchiveProject,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  activeSessions,
  getSessionStatus,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onToggleSessionStar,
  onArchiveSession,
  onRegenerateTitle,
  onExportSession,
  onCopyDebugInfo,
  t,
}: SidebarProjectItemProps) {
  const isSelected = selectedProject?.projectId === project.projectId;
  // Like a folder in Finder, the workspace row is highlighted only when it is
  // itself the selection (a new conversation), not whenever one of its
  // conversations is open - that painted a second selected row above it.
  const isCurrent = isSelected && !selectedSession;
  const isEditing = editingProject === project.projectId;
  const statuses = sessions.map((session) => getSessionStatus(session.id));
  const attentionCount = statuses.filter(needsAttention).length;
  const hasBlocked = statuses.includes('blocked');
  const attentionLabel = t('status.projectAttentionCount', { count: attentionCount });

  const selectProject = () => {
    if (!isSelected) onProjectSelect(project);
    if (showSessions) onToggleProject(project.projectId);
  };

  const saveProjectName = () => onSaveProjectName(project.projectId);

  // The hover toolbar's actions, reachable by a secondary click as well.
  const contextMenu = useContextMenu([
    { key: 'new', label: t('tooltips.createSession'), icon: Plus, onSelect: () => onNewSession(project) },
    {
      key: 'star',
      label: isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites'),
      icon: Star,
      onSelect: () => onToggleStarProject(project.projectId),
    },
    { key: 'rename', label: t('tooltips.renameProject'), icon: Edit3, onSelect: () => onStartEditingProject(project) },
    { key: 'archive', label: t('tooltips.archiveProject'), icon: Archive, onSelect: () => onArchiveProject(project), showDividerBefore: true },
  ], project.displayName);

  return (
    <div className={cn('space-y-1', isArchiving && 'pointer-events-none opacity-50')}>
      <div className="group/project relative" onContextMenu={isEditing ? undefined : contextMenu.onContextMenu}>
        {contextMenu.menu}
        {isEditing ? (
          <div className="flex items-center gap-1 px-1.5 py-1">
            <input
              type="text"
              value={editingName}
              onChange={(event) => onEditingNameChange(event.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-hidden focus:ring-1 focus:ring-ring"
              placeholder={t('projects.projectNamePlaceholder')}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveProjectName();
                if (event.key === 'Escape') onCancelEditingProject();
              }}
            />
            <button className="flex size-8 items-center justify-center rounded-md text-success hover:bg-accent" onClick={saveProjectName} aria-label={t('tooltips.save')}>
              <Check className="size-3.5" />
            </button>
            <button className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent" onClick={onCancelEditingProject} aria-label={t('tooltips.cancel')}>
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className={cn(
                'flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 pr-9 text-left text-sm outline-hidden transition-colors hover:bg-accent/70 focus-visible:ring-1 focus-visible:ring-ring',
                isCurrent && 'bg-accent text-accent-foreground',
                contextMenu.isOpen && 'ring-1 ring-ring/60',
              )}
              onClick={selectProject}
              title={project.fullPath}
              aria-expanded={showSessions ? isExpanded : undefined}
            >
              <Folder className={cn('stroke-1.7 size-4 shrink-0 text-muted-foreground', isCurrent && 'text-foreground')} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{project.displayName}</span>
              {attentionCount > 0 && (
                <span
                  role="status"
                  aria-label={attentionLabel}
                  title={attentionLabel}
                  className={cn(
                    'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[0.6875rem] font-medium tabular-nums transition-opacity group-hover/project:opacity-0',
                    hasBlocked ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary',
                  )}
                >
                  {attentionCount}
                </span>
              )}
              {showSessions && (
                <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} aria-hidden />
              )}
            </button>

            <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center rounded-md bg-accent/95 opacity-0 shadow-xs transition-opacity group-focus-within/project:opacity-100 group-hover/project:opacity-100">
              <button
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => onNewSession(project)}
                aria-label={t('tooltips.createSession')}
                title={t('tooltips.createSession')}
              >
                <Plus className="size-3.5" />
              </button>
              <button
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => onToggleStarProject(project.projectId)}
                aria-label={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                title={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
              >
                <Star className={cn('size-3.5', isStarred && 'fill-favorite text-favorite')} />
              </button>
              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground" onClick={() => onStartEditingProject(project)} aria-label={t('tooltips.renameProject')} title={t('tooltips.renameProject')}>
                <Edit3 className="size-3.5" />
              </button>
              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground" onClick={() => onArchiveProject(project)} aria-label={t('tooltips.archiveProject')} title={t('tooltips.archiveProject')}>
                <Archive className="size-3.5" />
              </button>
            </div>
          </>
        )}
      </div>

      {showSessions && (
        <SidebarProjectSessions
          project={project}
          isExpanded={isExpanded}
          isMobile={isMobile}
          sessions={sessions}
          selectedSession={selectionShownInWork ? null : selectedSession}
          initialSessionsLoaded={initialSessionsLoaded}
          hasMoreSessions={Boolean(project.sessionMeta?.hasMore)}
          isLoadingMoreSessions={isLoadingMoreSessions}
          activeSessions={activeSessions}
          getSessionStatus={getSessionStatus}
          currentTime={currentTime}
          editingSession={editingSession}
          editingSessionName={editingSessionName}
          onEditingSessionNameChange={onEditingSessionNameChange}
          onStartEditingSession={onStartEditingSession}
          onCancelEditingSession={onCancelEditingSession}
          onSaveEditingSession={onSaveEditingSession}
          onToggleSessionStar={onToggleSessionStar}
          onArchiveSession={onArchiveSession}
          onRegenerateTitle={onRegenerateTitle}
          onExportSession={onExportSession}
          onCopyDebugInfo={onCopyDebugInfo}
          onProjectSelect={onProjectSelect}
          onSessionSelect={onSessionSelect}
          onDeleteSession={onDeleteSession}
          onLoadMoreSessions={onLoadMoreSessions}
          t={t}
        />
      )}
    </div>
  );
}
