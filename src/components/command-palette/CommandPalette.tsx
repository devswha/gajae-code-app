import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  FileText,
  GitCommit,
  GitMerge,
  MessageSquare,
  MessageSquarePlus,
  RefreshCw,
  Settings,
  SunMoon,
  X,
} from 'lucide-react';

import { useTheme } from '../../contexts/ThemeContext';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogTitle,
} from '../../shared/view/ui';
import { usePaletteOps, usePaletteOpsRegister } from '../../stores/usePaletteOpsStore';
import type { AppTab, Project } from '../../types/app';
import { SETTINGS_MAIN_TABS } from '../settings/constants/constants';

import { useBranchesSource } from './sources/useBranchesSource';
import { useCommitsSource } from './sources/useCommitsSource';
import { useFilesSource } from './sources/useFilesSource';
import { useGitActions } from './sources/useGitActions';
import { useSessionMessageSearch } from './sources/useSessionMessageSearch';
import { useSessionsSource } from './sources/useSessionsSource';

type Page = 'actions' | 'files' | 'sessions' | 'commits' | 'branches';
type CommandPaletteProps = {
  selectedProject: Project | null;
  currentSessionId?: string;
  onStartNewChat: (project: Project) => void;
  onOpenSettings: (tab?: string) => void;
  onShowTab?: (tab: AppTab) => void;
};
type SessionRow = { id: string; label: string; provider?: string; snippet?: string };
type PaletteState = { open: boolean; query: string; history: Page[] };

const PAGE_LABELS: Record<Page, string> = {
  actions: 'Actions',
  files: 'Files',
  sessions: 'Sessions',
  commits: 'Commits',
  branches: 'Branches',
};
const NAV_TABS: Array<{ id: AppTab; label: string; keywords: string }> = [
  { id: 'chat', label: 'Go to Chat', keywords: 'chat messages conversation' },
];
const BROWSE_LIMIT = 5;

function sectionIsActive(section: Page, selected: Page | undefined): boolean {
  return !selected || selected === section || (section === 'branches' && selected === 'actions');
}

function combineSessions(
  sessions: Array<{ id: string; label: string; provider?: string }>,
  messages: Array<{ sessionId: string; label: string; provider: string; snippet: string }>,
  include: boolean,
): SessionRow[] {
  if (!include) return [];
  const rows = new Map<string, SessionRow>(sessions.map((session) => [session.id, { ...session }]));
  for (const message of messages) {
    const known = rows.get(message.sessionId);
    if (known) known.snippet = message.snippet;
    else rows.set(message.sessionId, {
      id: message.sessionId,
      label: message.label,
      provider: message.provider,
      snippet: message.snippet,
    });
  }
  return [...rows.values()];
}

function visibleItems<T>(items: T[], page: Page | undefined, section: Page): T[] {
  return page === section ? items : items.slice(0, BROWSE_LIMIT);
}

export default function CommandPalette({
  selectedProject,
  currentSessionId,
  onStartNewChat,
  onOpenSettings,
  onShowTab,
}: CommandPaletteProps) {
  const [palette, setPalette] = React.useState<PaletteState>({ open: false, query: '', history: [] });
  const { toggleDarkMode } = useTheme();
  const { openFile } = usePaletteOps();
  const navigate = useNavigate();
  const projectId = selectedProject?.projectId;
  const currentPage = palette.history.at(-1);
  const actionsVisible = sectionIsActive('actions', currentPage);
  const sessionsVisible = sectionIsActive('sessions', currentPage);
  const filesVisible = sectionIsActive('files', currentPage);
  const commitsVisible = sectionIsActive('commits', currentPage);
  const branchesVisible = sectionIsActive('branches', currentPage);

  const openCommandPalette = React.useCallback(() => {
    setPalette((state) => ({ ...state, open: true }));
  }, []);
  const openSessionPicker = React.useCallback(() => {
    setPalette((state) => ({ ...state, open: true, query: '', history: ['sessions'] }));
  }, []);
  usePaletteOpsRegister({ openCommandPalette, openSessionPicker });

  React.useEffect(() => {
    const toggleWithShortcut = (event: KeyboardEvent) => {
      const shortcut = (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k';
      if (!shortcut) return;
      event.preventDefault();
      setPalette((state) => ({ ...state, open: !state.open }));
    };
    document.addEventListener('keydown', toggleWithShortcut);
    return () => document.removeEventListener('keydown', toggleWithShortcut);
  }, []);

  React.useEffect(() => {
    if (palette.open) return;
    setPalette((state) => state.query || state.history.length > 0
      ? { ...state, query: '', history: [] }
      : state);
  }, [palette.open]);

  const sessions = useSessionsSource(projectId, palette.open && sessionsVisible);
  const messageMatches = useSessionMessageSearch(projectId, palette.query, palette.open && sessionsVisible);
  const files = useFilesSource(projectId, palette.open && filesVisible);
  const commits = useCommitsSource(projectId, palette.open && commitsVisible);
  const branches = useBranchesSource(projectId, palette.open && branchesVisible);
  const { fetch: fetchGit, pull: pullGit, push: pushGit, checkout: checkoutBranch } = useGitActions(projectId);
  const sessionRows = combineSessions(sessions, messageMatches, sessionsVisible);

  const dismissThen = React.useCallback((operation: () => void) => {
    setPalette((state) => ({ ...state, open: false }));
    operation();
  }, []);
  const enterPage = React.useCallback((nextPage: Page) => {
    setPalette((state) => ({ ...state, query: '', history: [...state.history, nextPage] }));
  }, []);
  const leavePage = React.useCallback(() => {
    setPalette((state) => ({ ...state, query: '', history: state.history.slice(0, -1) }));
  }, []);
  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Backspace' || palette.query || palette.history.length === 0) return;
    event.preventDefault();
    leavePage();
  }, [leavePage, palette.history.length, palette.query]);

  const startNewChatDisabled = !selectedProject;
  const filesShown = visibleItems(files, currentPage, 'files');
  const commitsShown = visibleItems(commits, currentPage, 'commits');
  const sessionsShown = visibleItems(sessionRows, currentPage, 'sessions');
  const branchesShown = visibleItems(branches, currentPage, 'branches');

  return (
    <Dialog open={palette.open} onOpenChange={(open) => setPalette((state) => ({ ...state, open }))}>
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogTitle>Command palette</DialogTitle>
        <Command label="Command palette" onKeyDown={handleKeyDown}>
          {currentPage && (
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                {PAGE_LABELS[currentPage]}
                <button
                  type="button"
                  onClick={leavePage}
                  aria-label="Back to all"
                  className="ml-0.5 rounded-sm opacity-70 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
              <span className="text-xs text-muted-foreground">Backspace to go back</span>
            </div>
          )}
          <CommandInput
            placeholder={currentPage ? `Search ${PAGE_LABELS[currentPage].toLowerCase()}…` : 'Type to search anything…'}
            value={palette.query}
            onValueChange={(query) => setPalette((state) => ({ ...state, query }))}
          />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>

            {actionsVisible && (
              <CommandGroup heading="Actions">
                <CommandItem
                  value="Start new chat"
                  disabled={startNewChatDisabled}
                  onSelect={() => {
                    if (!selectedProject) return;
                    dismissThen(() => onStartNewChat(selectedProject));
                  }}
                >
                  <MessageSquarePlus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1">Start new chat</span>
                  {startNewChatDisabled && (
                    <span className="text-xs text-muted-foreground">Select a project first</span>
                  )}
                </CommandItem>
                <CommandItem value="Open settings" onSelect={() => dismissThen(() => onOpenSettings())}>
                  <Settings className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1">Open settings</span>
                </CommandItem>
                <CommandItem value="Toggle theme dark light mode" onSelect={() => dismissThen(toggleDarkMode)}>
                  <SunMoon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1">Toggle theme</span>
                </CommandItem>
              </CommandGroup>
            )}

            {actionsVisible && (
              <CommandGroup heading="Navigate">
                {NAV_TABS.map((tab) => (
                  <CommandItem
                    key={tab.id as string}
                    value={`${tab.label} ${tab.keywords}`}
                    onSelect={() => dismissThen(() => onShowTab?.(tab.id))}
                  >
                    <span className="flex-1">{tab.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {actionsVisible && projectId && (
              <CommandGroup heading="Git">
                <CommandItem value="Git Fetch remote" onSelect={() => dismissThen(() => { void fetchGit(); })}>
                  <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1">Git: Fetch</span>
                </CommandItem>
                <CommandItem value="Git Pull merge upstream" onSelect={() => dismissThen(() => { void pullGit(); })}>
                  <ArrowDownToLine className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1">Git: Pull</span>
                </CommandItem>
                <CommandItem value="Git Push origin remote" onSelect={() => dismissThen(() => { void pushGit(); })}>
                  <ArrowUpFromLine className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1">Git: Push</span>
                </CommandItem>
              </CommandGroup>
            )}

            {actionsVisible && (
              <CommandGroup heading="Settings">
                {SETTINGS_MAIN_TABS.map(({ id, label, keywords, icon: Icon }) => (
                  <CommandItem
                    key={id}
                    value={`Settings ${label} ${keywords}`}
                    onSelect={() => dismissThen(() => onOpenSettings(id))}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="flex-1">Settings: {label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {sessionsVisible && projectId && sessionsShown.length > 0 && (
              <CommandGroup heading="Sessions">
                {sessionsShown.map((session) => (
                  <CommandItem
                    key={session.id}
                    value={`${session.label} ${session.snippet ?? ''} ${session.id}`.trim()}
                    onSelect={() => dismissThen(() => navigate(`/session/${session.id}`))}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{session.label}</span>
                      {session.snippet && (
                        <span className="truncate text-xs text-muted-foreground">{session.snippet}</span>
                      )}
                    </div>
                    {session.id === currentSessionId && (
                      <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                        Current
                      </span>
                    )}
                    {session.provider && (
                      <span className="text-xs text-muted-foreground">{session.provider}</span>
                    )}
                  </CommandItem>
                ))}
                {!currentPage && sessionRows.length > BROWSE_LIMIT && (
                  <BrowseAllItem label={`Browse all sessions (${sessionRows.length})`} onSelect={() => enterPage('sessions')} />
                )}
              </CommandGroup>
            )}

            {filesVisible && projectId && filesShown.length > 0 && (
              <CommandGroup heading="Files">
                {filesShown.map((file) => (
                  <CommandItem key={file.path} value={file.path} onSelect={() => dismissThen(() => openFile(file.path))}>
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="flex-1 truncate">{file.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{file.path}</span>
                  </CommandItem>
                ))}
                {!currentPage && files.length > BROWSE_LIMIT && (
                  <BrowseAllItem label={`Browse all files (${files.length})`} onSelect={() => enterPage('files')} />
                )}
              </CommandGroup>
            )}

            {commitsVisible && projectId && commitsShown.length > 0 && (
              <CommandGroup heading="Commits">
                {commitsShown.map((commit) => (
                  <CommandItem
                    key={commit.hash}
                    value={`${commit.message} ${commit.author} ${commit.shortHash}`}
                    onSelect={() => dismissThen(() => {})}
                  >
                    <GitCommit className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="font-mono text-xs text-muted-foreground">{commit.shortHash}</span>
                    <span className="flex-1 truncate">{commit.message}</span>
                    <span className="truncate text-xs text-muted-foreground">{commit.author}</span>
                  </CommandItem>
                ))}
                {!currentPage && commits.length > BROWSE_LIMIT && (
                  <BrowseAllItem label={`Browse all commits (${commits.length})`} onSelect={() => enterPage('commits')} />
                )}
              </CommandGroup>
            )}

            {branchesVisible && projectId && branchesShown.length > 0 && (
              <CommandGroup heading="Branches">
                {branchesShown.map((branch) => (
                  <CommandItem
                    key={`branch-${branch.name}`}
                    value={branch.name}
                    onSelect={() => dismissThen(() => { void checkoutBranch(branch.name); })}
                  >
                    <GitMerge className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="flex-1 truncate">Switch to: {branch.name}</span>
                  </CommandItem>
                ))}
                {!currentPage && branches.length > BROWSE_LIMIT && (
                  <BrowseAllItem label={`Browse all branches (${branches.length})`} onSelect={() => enterPage('branches')} />
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function BrowseAllItem({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <CommandItem value={label} onSelect={onSelect}>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1 text-muted-foreground">{label}</span>
    </CommandItem>
  );
}
