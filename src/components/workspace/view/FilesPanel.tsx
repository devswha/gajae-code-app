import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';
import HomeDirInput from '../../../shared/view/HomeDirInput';
import FileTree from '../../file-tree/view/FileTree';

type FilesPanelProps = {
  onFileOpen: (filePath: string, projectId: string) => void;
};

const ROOT_STORAGE_KEY = 'files-panel-root';
const DEFAULT_ROOT = 'workspace';

/** Why the root could not be opened. Held as a reason, not as prose, so the
 * message is translated where it is rendered rather than where it is raised. */
type PanelError = 'homeUnavailable' | 'openFailed';

type PanelState =
  | { kind: 'loading'; root: string }
  | { kind: 'ready'; root: string; project: Project }
  | { kind: 'error'; root: string; reason: PanelError };

function readStoredRoot(): string {
  try {
    return localStorage.getItem(ROOT_STORAGE_KEY) || DEFAULT_ROOT;
  } catch {
    return DEFAULT_ROOT;
  }
}

/**
 * VS Code-style file browser rooted at a FIXED, user-configured folder
 * (home-relative, persisted in localStorage) — deliberately NOT tied to the
 * selected session/project. It is the Files tab of the Workspace panel, which
 * owns the panel width and the close control. Files open in the editor via
 * `onFileOpen(path, projectId)`; the projectId belongs to the root's own
 * project row (find-or-create through /create-project, including its 409 response), so
 * content read/save stays correctly scoped.
 */
export default function FilesPanel({ onFileOpen }: FilesPanelProps) {
  const { t } = useTranslation();
  const initialRootRef = useRef(readStoredRoot());
  const [state, setState] = useState<PanelState>({ kind: 'loading', root: initialRootRef.current });
  const [draftRoot, setDraftRoot] = useState('');
  const [editingRoot, setEditingRoot] = useState(false);
  const rootRequestIdRef = useRef(0);
  const root = state.root;

  const resolveRoot = useCallback(async (relativeRoot: string) => {
    const requestId = ++rootRequestIdRef.current;
    const publishIfCurrent = (nextState: PanelState) => {
      if (requestId === rootRequestIdRef.current) {
        setState(nextState);
      }
    };

    setState({ kind: 'loading', root: relativeRoot });
    try {
      // The dir-suggestions endpoint also reports the absolute HOME path.
      const homeResponse = await api.dirSuggestions('');
      const homeBody = await homeResponse.json();
      const home: string = homeBody?.data?.home ?? '';
      if (!home) {
        publishIfCurrent({ kind: 'error', root: relativeRoot, reason: 'homeUnavailable' });
        return;
      }
      const absolutePath = `${home}/${relativeRoot.replace(/\/+$/, '')}`;

      const toProject = (row: Record<string, unknown>): Project => ({
        projectId: String(row.project_id ?? row.projectId ?? ''),
        path: String(row.project_path ?? row.path ?? absolutePath),
        fullPath: String(row.project_path ?? row.fullPath ?? absolutePath),
        displayName: String(row.custom_project_name ?? row.displayName ?? relativeRoot),
      } as unknown as Project);

      const createResponse = await api.createProject({ path: absolutePath });
      if (createResponse.ok) {
        const body = await createResponse.json();
        const row = body?.project ?? body?.data?.project;
        if (row) {
          publishIfCurrent({ kind: 'ready', root: relativeRoot, project: toProject(row) });
          return;
        }
      } else if (createResponse.status === 409) {
        const body = await createResponse.json();
        const row = body?.error?.details?.project;
        if (row) {
          publishIfCurrent({ kind: 'ready', root: relativeRoot, project: toProject(row) });
          return;
        }
      }
      publishIfCurrent({ kind: 'error', root: relativeRoot, reason: 'openFailed' });
    } catch {
      publishIfCurrent({ kind: 'error', root: relativeRoot, reason: 'openFailed' });
    }
  }, []);

  useEffect(() => {
    void resolveRoot(initialRootRef.current);
  }, [resolveRoot]);

  const applyDraftRoot = () => {
    const next = draftRoot.trim().replace(/\/+$/, '');
    if (!next) return;
    try {
      localStorage.setItem(ROOT_STORAGE_KEY, next);
    } catch {
      // storage errors are non-fatal
    }
    setEditingRoot(false);
    void resolveRoot(next);
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-xs font-semibold text-foreground" title={`~/${root}`}>~/{root}</span>
          <button
            type="button"
            onClick={() => {
              setDraftRoot(root);
              setEditingRoot((previous) => !previous);
            }}
            title={t('workspace.filesTab.changeRoot')}
            aria-label={t('workspace.filesTab.changeRoot')}
            className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      </div>

      {editingRoot && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
          <div className="min-w-0 flex-1">
            <HomeDirInput
              value={draftRoot}
              onChange={setDraftRoot}
              onSubmit={applyDraftRoot}
              placeholder={t('workspace.filesTab.rootPlaceholder')}
            />
          </div>
          <button
            type="button"
            onClick={applyDraftRoot}
            disabled={!draftRoot.trim()}
            className="shrink-0 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('workspace.filesTab.apply')}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {state.kind === 'loading' && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t('workspace.filesTab.opening')}</div>
        )}
        {state.kind === 'error' && (
          <div className="px-4 py-8 text-center text-sm text-red-500">{t(`workspace.filesTab.${state.reason}`)}</div>
        )}
        {state.kind === 'ready' && (
          <FileTree
            selectedProject={state.project}
            onFileOpen={(filePath) => onFileOpen(filePath, state.project.projectId)}
          />
        )}
      </div>
    </div>
  );
}
