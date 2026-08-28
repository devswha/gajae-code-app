import { Check, ChevronRight, Edit3, Folder, Plus, Star, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '../../../utils/cn';
import type { Project, ProjectSession, LLMProvider } from '../../../types/app';
import type { SessionActivityMap } from '../../../hooks/useSessionProtection';
import type { SessionWithProvider } from '../types/types';

import SidebarProjectSessions from './SidebarProjectSessions';

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  showSessions: boolean;
  isDeleting: boolean;
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
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (projectName: string, sessionId: string, sessionTitle: string, provider: LLMProvider) => void;
  onLoadMoreSessions: (projectId: string) => void;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
  onNewSession: (project: Project) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onToggleSessionStar?: (sessionId: string) => void;
  onExportSession?: (sessionId: string) => void;
  t: TFunction;
};

export default function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  showSessions,
  isDeleting,
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
  onDeleteProject,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  activeSessions,
  attentionSessionIds,
  onNewSession,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onToggleSessionStar,
  onExportSession,
  t,
}: SidebarProjectItemProps) {
  const isSelected = selectedProject?.projectId === project.projectId;
  const isEditing = editingProject === project.projectId;
  const sessionCount = Number(project.sessionMeta?.total ?? sessions.length);

  const selectProject = () => {
    if (!isSelected) onProjectSelect(project);
    if (showSessions) onToggleProject(project.projectId);
  };

  const saveProjectName = () => onSaveProjectName(project.projectId);

  return (
    <div className={cn('space-y-1', isDeleting && 'pointer-events-none opacity-50')}>
      <div className="group/project relative">
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
            <button className="flex size-8 items-center justify-center rounded-md text-emerald-600 hover:bg-accent" onClick={saveProjectName} aria-label={t('tooltips.save')}>
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
                isSelected && 'bg-accent text-accent-foreground',
              )}
              onClick={selectProject}
              title={project.fullPath}
              aria-expanded={showSessions ? isExpanded : undefined}
            >
              <Folder className={cn('stroke-1.7 size-4 shrink-0 text-muted-foreground', isSelected && 'text-foreground')} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{project.displayName}</span>
              <span className="text-[0.6875rem] text-muted-foreground tabular-nums transition-opacity group-hover/project:opacity-0">{sessionCount}</span>
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
                <Star className={cn('size-3.5', isStarred && 'fill-amber-400 text-amber-500')} />
              </button>
              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground" onClick={() => onStartEditingProject(project)} aria-label={t('tooltips.renameProject')} title={t('tooltips.renameProject')}>
                <Edit3 className="size-3.5" />
              </button>
              <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive" onClick={() => onDeleteProject(project)} aria-label={t('tooltips.deleteProject')} title={t('tooltips.deleteProject')}>
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </>
        )}
      </div>

      {showSessions && (
        <SidebarProjectSessions
          project={project}
          isExpanded={isExpanded}
          sessions={sessions}
          selectedSession={selectedSession}
          initialSessionsLoaded={initialSessionsLoaded}
          hasMoreSessions={Boolean(project.sessionMeta?.hasMore)}
          isLoadingMoreSessions={isLoadingMoreSessions}
          activeSessions={activeSessions}
          attentionSessionIds={attentionSessionIds}
          currentTime={currentTime}
          editingSession={editingSession}
          editingSessionName={editingSessionName}
          onEditingSessionNameChange={onEditingSessionNameChange}
          onStartEditingSession={onStartEditingSession}
          onCancelEditingSession={onCancelEditingSession}
          onSaveEditingSession={onSaveEditingSession}
          onToggleSessionStar={onToggleSessionStar}
          onExportSession={onExportSession}
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
