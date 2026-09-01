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
  type LucideIcon,
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
type CommandPaletteProps = { selectedProject: Project | null; currentSessionId?: string; onStartNewChat: (project: Project) => void; onOpenSettings: (tab?: string) => void; onShowTab?: (tab: AppTab) => void };
type SessionRow = { id: string; label: string; provider?: string; snippet?: string };
type PaletteState = { open: boolean; query: string; history: Page[] };
type ActionItemProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  onSelect: () => void;
  disabled?: boolean;
  disabledHint?: string;
};
type PaletteAction =
  | { type: 'change-visibility'; open: boolean }
  | { type: 'open-sessions' }
  | { type: 'toggle-visibility' }
  | { type: 'push-page'; page: Page }
  | { type: 'pop-page' }
  | { type: 'clear-closed' }
  | { type: 'set-query'; query: string };

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

function paletteReducer(previous: PaletteState, action: PaletteAction): PaletteState {
  switch (action.type) {
    case 'change-visibility':
      return { ...previous, open: action.open };
    case 'open-sessions':
      return { open: true, query: '', history: ['sessions'] };
    case 'toggle-visibility':
      return { ...previous, open: !previous.open };
    case 'push-page':
      return { ...previous, query: '', history: [...previous.history, action.page] };
    case 'pop-page':
      return { ...previous, query: '', history: previous.history.slice(0, -1) };
    case 'set-query':
      return { ...previous, query: action.query };
    case 'clear-closed':
      return !previous.open && (previous.query || previous.history.length > 0)
        ? { ...previous, query: '', history: [] }
        : previous;
  }
}

function shouldRenderGroup(page: Page, activePage: Page | undefined): boolean {
  return activePage === undefined || activePage === page || (activePage === 'actions' && page === 'branches');
}

function mergeSessionResults(
  sessions: Array<{ id: string; label: string; provider?: string }>,
  messages: Array<{ sessionId: string; label: string; provider: string; snippet: string }>,
  enabled: boolean,
): SessionRow[] {
  if (!enabled) return [];

  const rows = new Map<string, SessionRow>(sessions.map((session) => [session.id, { ...session }]));
  for (const match of messages) {
    const saved = rows.get(match.sessionId);
    rows.set(match.sessionId, saved
      ? { ...saved, snippet: match.snippet }
      : { id: match.sessionId, label: match.label, provider: match.provider, snippet: match.snippet });
  }
  return [...rows.values()];
}

function browseItems<T>(entries: T[], page: Page | undefined, target: Page): T[] {
  return page === target ? entries : entries.slice(0, BROWSE_LIMIT);
}

function opensPalette(event: KeyboardEvent) {
  const modifierPressed = event.metaKey || event.ctrlKey;
  return modifierPressed && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k';
}

function PaletteActionItem({
  icon: Icon,
  label,
  value,
  onSelect,
  disabled,
  disabledHint,
}: ActionItemProps) {
  return (
    <CommandItem value={value} disabled={disabled} onSelect={onSelect}>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1">{label}</span>
      {disabledHint && <span className="text-xs text-muted-foreground">{disabledHint}</span>}
    </CommandItem>
  );
}

export default function CommandPalette({
  selectedProject,
  currentSessionId,
  onStartNewChat,
  onOpenSettings,
  onShowTab,
}: CommandPaletteProps) {
  const [palette, dispatchPalette] = React.useReducer(paletteReducer, { open: false, query: '', history: [] });
  const { toggleDarkMode } = useTheme();
  const { openFile } = usePaletteOps();
  const navigate = useNavigate();
  const projectId = selectedProject?.projectId;
  const currentPage = palette.history[palette.history.length - 1];
  const actionsVisible = shouldRenderGroup('actions', currentPage);
  const sessionsVisible = shouldRenderGroup('sessions', currentPage);
  const filesVisible = shouldRenderGroup('files', currentPage);
  const commitsVisible = shouldRenderGroup('commits', currentPage);
  const branchesVisible = shouldRenderGroup('branches', currentPage);

  const openCommandPalette = React.useCallback(() => {
    dispatchPalette({ type: 'change-visibility', open: true });
  }, []);
  const openSessionPicker = React.useCallback(() => {
    dispatchPalette({ type: 'open-sessions' });
  }, []);
  usePaletteOpsRegister({ openCommandPalette, openSessionPicker });

  React.useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!opensPalette(event)) return;
      event.preventDefault();
      dispatchPalette({ type: 'toggle-visibility' });
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  React.useEffect(() => {
    if (palette.open) return;
    dispatchPalette({ type: 'clear-closed' });
  }, [palette.open]);

  const sessions = useSessionsSource(projectId, palette.open && sessionsVisible);
  const messageMatches = useSessionMessageSearch(projectId, palette.query, palette.open && sessionsVisible);
  const files = useFilesSource(projectId, palette.open && filesVisible);
  const commits = useCommitsSource(projectId, palette.open && commitsVisible);
  const branches = useBranchesSource(projectId, palette.open && branchesVisible);
  const { fetch: fetchGit, pull: pullGit, push: pushGit, checkout: checkoutBranch } = useGitActions(projectId);
  const sessionRows = mergeSessionResults(sessions, messageMatches, sessionsVisible);

  const runAfterDismissal = React.useCallback((action: () => void) => {
    dispatchPalette({ type: 'change-visibility', open: false });
    action();
  }, []);
  const enterPage = React.useCallback((page: Page) => {
    dispatchPalette({ type: 'push-page', page });
  }, []);
  const leavePage = React.useCallback(() => {
    dispatchPalette({ type: 'pop-page' });
  }, []);
  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Backspace' || palette.query || palette.history.length === 0) return;
    event.preventDefault();
    leavePage();
  }, [leavePage, palette.history.length, palette.query]);

  const startNewChatDisabled = selectedProject === null;
  const filesShown = browseItems(files, currentPage, 'files');
  const commitsShown = browseItems(commits, currentPage, 'commits');
  const sessionsShown = browseItems(sessionRows, currentPage, 'sessions');
  const branchesShown = browseItems(branches, currentPage, 'branches');
  const primaryActions: ActionItemProps[] = [
    {
      icon: MessageSquarePlus,
      label: 'Start new chat',
      value: 'Start new chat',
      disabled: startNewChatDisabled,
      disabledHint: startNewChatDisabled ? 'Select a project first' : undefined,
      onSelect: () => {
        if (!selectedProject) return;
        runAfterDismissal(() => onStartNewChat(selectedProject));
      },
    },
    {
      icon: Settings,
      label: 'Open settings',
      value: 'Open settings',
      onSelect: () => runAfterDismissal(() => onOpenSettings()),
    },
    {
      icon: SunMoon,
      label: 'Toggle theme',
      value: 'Toggle theme dark light mode',
      onSelect: () => runAfterDismissal(toggleDarkMode),
    },
  ];
  const gitActions: ActionItemProps[] = [
    {
      icon: RefreshCw,
      label: 'Git: Fetch',
      value: 'Git Fetch remote',
      onSelect: () => runAfterDismissal(() => { void fetchGit(); }),
    },
    {
      icon: ArrowDownToLine,
      label: 'Git: Pull',
      value: 'Git Pull merge upstream',
      onSelect: () => runAfterDismissal(() => { void pullGit(); }),
    },
    {
      icon: ArrowUpFromLine,
      label: 'Git: Push',
      value: 'Git Push origin remote',
      onSelect: () => runAfterDismissal(() => { void pushGit(); }),
    },
  ];

  return (
    <Dialog open={palette.open} onOpenChange={(open) => dispatchPalette({ type: 'change-visibility', open })}>
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
            onValueChange={(query) => dispatchPalette({ type: 'set-query', query })}
          />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>

            {actionsVisible && (
              <CommandGroup heading="Actions">
                {primaryActions.map((action) => <PaletteActionItem key={action.value} {...action} />)}
              </CommandGroup>
            )}

            {actionsVisible && (
              <CommandGroup heading="Navigate">
                {NAV_TABS.map((tab) => (
                  <CommandItem
                    key={tab.id as string}
                    value={`${tab.label} ${tab.keywords}`}
                    onSelect={() => runAfterDismissal(() => onShowTab?.(tab.id))}
                  >
                    <span className="flex-1">{tab.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {actionsVisible && projectId && (
              <CommandGroup heading="Git">
                {gitActions.map((action) => <PaletteActionItem key={action.value} {...action} />)}
              </CommandGroup>
            )}

            {actionsVisible && (
              <CommandGroup heading="Settings">
                {SETTINGS_MAIN_TABS.map(({ id, label, keywords, icon: Icon }) => (
                  <CommandItem
                    key={id}
                    value={`Settings ${label} ${keywords}`}
                    onSelect={() => runAfterDismissal(() => onOpenSettings(id))}
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
                    onSelect={() => runAfterDismissal(() => navigate(`/session/${session.id}`))}
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
                  <CommandItem key={file.path} value={file.path} onSelect={() => runAfterDismissal(() => openFile(file.path))}>
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
                    onSelect={() => runAfterDismissal(() => {})}
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
                    onSelect={() => runAfterDismissal(() => { void checkoutBranch(branch.name); })}
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
