import * as React from 'react';
import { useTranslation } from 'react-i18next';
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
import { useProjectPermissions } from '../../hooks/useProjectPermissions';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import { PERMISSION_MODE_ICONS, PERMISSION_MODES } from '../chat/utils/permissionMode';
import { TOOL_OUTPUT_DENSITIES } from '../chat/utils/toolOutputDensity';
import BypassConfirmDialog from '../chat/view/BypassConfirmDialog';
import { TOOL_OUTPUT_DENSITY_ICONS } from '../chat/view/ToolOutputDensityPicker';
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
  hint?: string;
};
type PaletteAction =
  | { type: 'change-visibility'; open: boolean }
  | { type: 'open-sessions' }
  | { type: 'toggle-visibility' }
  | { type: 'push-page'; page: Page }
  | { type: 'pop-page' }
  | { type: 'clear-closed' }
  | { type: 'set-query'; query: string };

// Search keywords stay English alongside the translated label so a user can
// match an action either way; the `value` is what cmdk filters on.
const NAV_TABS: Array<{ id: AppTab; labelKey: string; keywords: string }> = [
  { id: 'chat', labelKey: 'commandPalette.actions.goToChat', keywords: 'Go to Chat chat messages conversation' },
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
  hint,
}: ActionItemProps) {
  const trailing = disabledHint ?? hint;
  return (
    <CommandItem value={value} disabled={disabled} onSelect={onSelect}>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1">{label}</span>
      {trailing && <span className="text-xs text-muted-foreground">{trailing}</span>}
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
  const [confirmingBypass, setConfirmingBypass] = React.useState(false);
  const { toggleDarkMode } = useTheme();
  const { t } = useTranslation(['common', 'chat', 'settings']);
  const { preferences, setPreference } = useUiPreferences();
  const { openFile } = usePaletteOps();
  const navigate = useNavigate();
  const projectId = selectedProject?.projectId;
  const projectPermissions = useProjectPermissions(projectId);
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
  const pageLabel = (page: Page) => t(`commandPalette.pages.${page}`);
  const currentHint = t('commandPalette.current');
  const primaryActions: ActionItemProps[] = [
    {
      icon: MessageSquarePlus,
      label: t('commandPalette.actions.startNewChat'),
      value: `${t('commandPalette.actions.startNewChat')} Start new chat`,
      disabled: startNewChatDisabled,
      disabledHint: startNewChatDisabled ? t('commandPalette.actions.selectProjectFirst') : undefined,
      onSelect: () => {
        if (!selectedProject) return;
        runAfterDismissal(() => onStartNewChat(selectedProject));
      },
    },
    {
      icon: Settings,
      label: t('commandPalette.actions.openSettings'),
      value: `${t('commandPalette.actions.openSettings')} Open settings`,
      onSelect: () => runAfterDismissal(() => onOpenSettings()),
    },
    {
      icon: SunMoon,
      label: t('commandPalette.actions.toggleTheme'),
      value: `${t('commandPalette.actions.toggleTheme')} Toggle theme dark light mode`,
      onSelect: () => runAfterDismissal(toggleDarkMode),
    },
    ...TOOL_OUTPUT_DENSITIES.map((level): ActionItemProps => {
      const levelLabel = t(`chat:toolOutputDensity.${level}`);
      return {
        icon: TOOL_OUTPUT_DENSITY_ICONS[level],
        label: t('chat:toolOutputDensity.paletteAction', { level: levelLabel }),
        value: `Tool output density ${level} ${levelLabel}`,
        hint: preferences.toolOutputDensity === level ? currentHint : undefined,
        onSelect: () => runAfterDismissal(() => setPreference('toolOutputDensity', level)),
      };
    }),
    ...(projectId && projectPermissions.permissions ? PERMISSION_MODES.map((mode): ActionItemProps => {
      const modeLabel = t(`chat:permissionMode.modes.${mode}.label`);
      const current = projectPermissions.permissions?.mode === mode;
      return {
        icon: PERMISSION_MODE_ICONS[mode],
        label: t('chat:permissionMode.paletteAction', { mode: modeLabel }),
        value: `Permissions ${mode} ${modeLabel}`,
        hint: current ? currentHint : undefined,
        onSelect: () => runAfterDismissal(() => {
          if (current) return;
          // Bypass keeps its one-time warning even from the palette.
          if (mode === 'bypass' && !projectPermissions.permissions?.bypassAcknowledged) {
            setConfirmingBypass(true);
            return;
          }
          void projectPermissions.setMode({ mode }).catch(() => {});
        }),
      };
    }) : []),
  ];
  const gitActions: ActionItemProps[] = [
    {
      icon: RefreshCw,
      label: t('commandPalette.actions.gitFetch'),
      value: 'Git Fetch remote',
      onSelect: () => runAfterDismissal(() => { void fetchGit(); }),
    },
    {
      icon: ArrowDownToLine,
      label: t('commandPalette.actions.gitPull'),
      value: 'Git Pull merge upstream',
      onSelect: () => runAfterDismissal(() => { void pullGit(); }),
    },
    {
      icon: ArrowUpFromLine,
      label: t('commandPalette.actions.gitPush'),
      value: 'Git Push origin remote',
      onSelect: () => runAfterDismissal(() => { void pushGit(); }),
    },
  ];

  return (
    <Dialog open={palette.open} onOpenChange={(open) => dispatchPalette({ type: 'change-visibility', open })}>
      {/* Its own dialog; it opens after the palette has been dismissed. */}
      <BypassConfirmDialog
        open={confirmingBypass}
        onCancel={() => setConfirmingBypass(false)}
        onConfirm={() => {
          setConfirmingBypass(false);
          void projectPermissions.setMode({ mode: 'bypass', acknowledgeBypass: true }).catch(() => {});
        }}
      />
      <DialogContent className="max-w-xl overflow-hidden p-0">
        <DialogTitle>{t('commandPalette.title')}</DialogTitle>
        <Command label={t('commandPalette.title')} onKeyDown={handleKeyDown}>
          {currentPage && (
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                {pageLabel(currentPage)}
                <button
                  type="button"
                  onClick={leavePage}
                  aria-label={t('commandPalette.backToAll')}
                  className="ml-0.5 rounded-sm opacity-70 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
              <span className="text-xs text-muted-foreground">{t('commandPalette.backspaceHint')}</span>
            </div>
          )}
          <CommandInput
            placeholder={currentPage ? t(`commandPalette.search.${currentPage}`) : t('commandPalette.search.anything')}
            value={palette.query}
            onValueChange={(query) => dispatchPalette({ type: 'set-query', query })}
          />
          <CommandList>
            <CommandEmpty>{t('commandPalette.noResults')}</CommandEmpty>

            {actionsVisible && (
              <CommandGroup heading={pageLabel('actions')}>
                {primaryActions.map((action) => <PaletteActionItem key={action.value} {...action} />)}
              </CommandGroup>
            )}

            {actionsVisible && (
              <CommandGroup heading={t('commandPalette.groups.navigate')}>
                {NAV_TABS.map((tab) => (
                  <CommandItem
                    key={tab.id as string}
                    value={`${t(tab.labelKey)} ${tab.keywords}`}
                    onSelect={() => runAfterDismissal(() => onShowTab?.(tab.id))}
                  >
                    <span className="flex-1">{t(tab.labelKey)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {actionsVisible && projectId && (
              <CommandGroup heading={t('commandPalette.groups.git')}>
                {gitActions.map((action) => <PaletteActionItem key={action.value} {...action} />)}
              </CommandGroup>
            )}

            {actionsVisible && (
              <CommandGroup heading={t('commandPalette.groups.settings')}>
                {SETTINGS_MAIN_TABS.map(({ id, label, keywords, icon: Icon }) => {
                  const tabLabel = t(`settings:mainTabs.${id}`, { defaultValue: label });
                  return (
                    <CommandItem
                      key={id}
                      value={`Settings ${label} ${tabLabel} ${keywords}`}
                      onSelect={() => runAfterDismissal(() => onOpenSettings(id))}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="flex-1">{t('commandPalette.actions.settingsTab', { tab: tabLabel })}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {sessionsVisible && projectId && sessionsShown.length > 0 && (
              <CommandGroup heading={pageLabel('sessions')}>
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
                        {currentHint}
                      </span>
                    )}
                    {session.provider && (
                      <span className="text-xs text-muted-foreground">{session.provider}</span>
                    )}
                  </CommandItem>
                ))}
                {!currentPage && sessionRows.length > BROWSE_LIMIT && (
                  <BrowseAllItem label={t('commandPalette.browseAll.sessions', { total: sessionRows.length })} onSelect={() => enterPage('sessions')} />
                )}
              </CommandGroup>
            )}

            {filesVisible && projectId && filesShown.length > 0 && (
              <CommandGroup heading={pageLabel('files')}>
                {filesShown.map((file) => (
                  <CommandItem key={file.path} value={file.path} onSelect={() => runAfterDismissal(() => openFile(file.path))}>
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="flex-1 truncate">{file.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{file.path}</span>
                  </CommandItem>
                ))}
                {!currentPage && files.length > BROWSE_LIMIT && (
                  <BrowseAllItem label={t('commandPalette.browseAll.files', { total: files.length })} onSelect={() => enterPage('files')} />
                )}
              </CommandGroup>
            )}

            {commitsVisible && projectId && commitsShown.length > 0 && (
              <CommandGroup heading={pageLabel('commits')}>
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
                  <BrowseAllItem label={t('commandPalette.browseAll.commits', { total: commits.length })} onSelect={() => enterPage('commits')} />
                )}
              </CommandGroup>
            )}

            {branchesVisible && projectId && branchesShown.length > 0 && (
              <CommandGroup heading={pageLabel('branches')}>
                {branchesShown.map((branch) => (
                  <CommandItem
                    key={`branch-${branch.name}`}
                    value={branch.name}
                    onSelect={() => runAfterDismissal(() => { void checkoutBranch(branch.name); })}
                  >
                    <GitMerge className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="flex-1 truncate">{t('commandPalette.actions.switchToBranch', { branch: branch.name })}</span>
                  </CommandItem>
                ))}
                {!currentPage && branches.length > BROWSE_LIMIT && (
                  <BrowseAllItem label={t('commandPalette.browseAll.branches', { total: branches.length })} onSelect={() => enterPage('branches')} />
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
