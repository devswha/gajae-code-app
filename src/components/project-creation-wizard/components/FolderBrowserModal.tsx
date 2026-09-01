import { useEffect, useState } from 'react';
import { ChevronRight, Eye, EyeOff, Folder, FolderOpen, Loader2, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../shared/view/ui';
import { browseFilesystemFolders, createFolderInFilesystem } from '../data/workspaceApi';
import type { FolderSuggestion } from '../types';
import { getParentPath, joinFolderPath } from '../utils/pathUtils';

type FolderBrowserModalProps = {
  isOpen: boolean;
  autoAdvanceOnSelect: boolean;
  onClose: () => void;
  onFolderSelected: (folderPath: string, advanceToConfirm: boolean) => void;
};

export default function FolderBrowserModal({
  isOpen,
  autoAdvanceOnSelect,
  onClose,
  onFolderSelected,
}: FolderBrowserModalProps) {
  const { t } = useTranslation();
  const [currentPath, setCurrentPath] = useState('~');
  const [folders, setFolders] = useState<FolderSuggestion[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [showHiddenFolders, setShowHiddenFolders] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDirectory = async (path: string) => {
    setLoadingFolders(true);
    setError(null);
    try {
      const contents = await browseFilesystemFolders(path);
      setCurrentPath(contents.path);
      setFolders(contents.suggestions);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('projectWizard.folderBrowser.failedToLoad'));
    } finally {
      setLoadingFolders(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const loadInitialDirectory = async () => {
      setLoadingFolders(true);
      setError(null);
      try {
        const contents = await browseFilesystemFolders('~');
        setCurrentPath(contents.path);
        setFolders(contents.suggestions);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('projectWizard.folderBrowser.failedToLoad'));
      } finally {
        setLoadingFolders(false);
      }
    };

    void loadInitialDirectory();
    return undefined;
  }, [isOpen, t]);

  const visibleFolders = folders
    .filter(({ name }) => showHiddenFolders || !name.startsWith('.'))
    .sort((first, second) => first.name.toLowerCase().localeCompare(second.name.toLowerCase()));
  const parentPath = getParentPath(currentPath);

  const clearFolderName = () => {
    setShowNewFolderInput(false);
    setNewFolderName('');
  };

  const closeModal = () => {
    setError(null);
    clearFolderName();
    onClose();
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) {
      return;
    }

    setCreatingFolder(true);
    setError(null);
    try {
      const newPath = await createFolderInFilesystem(joinFolderPath(currentPath, newFolderName));
      clearFolderName();
      await openDirectory(newPath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('projectWizard.folderBrowser.failedToCreate'));
    } finally {
      setCreatingFolder(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-background/80 p-4 backdrop-blur-xs">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <FolderOpen className="size-4 text-muted-foreground" />
            <h3 className="text-xs font-semibold">{t('projectWizard.folderBrowser.title')}</h3>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowHiddenFolders((previous) => !previous)}
              className={`rounded-md p-1.5 transition-colors ${
                showHiddenFolders
                  ? 'bg-accent/70 text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
              title={t(showHiddenFolders
                ? 'projectWizard.folderBrowser.hideHiddenFolders'
                : 'projectWizard.folderBrowser.showHiddenFolders')}
              aria-label={t(showHiddenFolders
                ? 'projectWizard.folderBrowser.hideHiddenFolders'
                : 'projectWizard.folderBrowser.showHiddenFolders')}
            >
              {showHiddenFolders ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => setShowNewFolderInput((previous) => !previous)}
              className={`rounded-md p-1.5 transition-colors ${
                showNewFolderInput
                  ? 'bg-accent/70 text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
              title={t('projectWizard.folderBrowser.createNewFolder')}
              aria-label={t('projectWizard.folderBrowser.createNewFolder')}
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              onClick={closeModal}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t('projectWizard.folderBrowser.close')}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {showNewFolderInput && (
          <div className="border-b border-border bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder={t('projectWizard.folderBrowser.newFolderName')}
                className="h-7 flex-1 text-xs"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    createFolder();
                  }
                  if (event.key === 'Escape') {
                    clearFolderName();
                  }
                }}
                autoFocus
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={createFolder}
                disabled={!newFolderName.trim() || creatingFolder}
                className="h-7 w-7 p-0"
                aria-label={t('projectWizard.folderBrowser.create')}
              >
                {creatingFolder ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearFolderName}
                className="h-7 w-7 p-0"
                aria-label={t('projectWizard.folderBrowser.cancel')}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="px-3 pt-2">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-1.5">
          {loadingFolders ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : (
            <div className="space-y-1">
              {parentPath && (
                <button
                  type="button"
                  onClick={() => openDirectory(parentPath)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">..</span>
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />
                </button>
              )}

              {visibleFolders.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {t('projectWizard.folderBrowser.noSubfolders')}
                </div>
              ) : (
                visibleFolders.map((folder) => (
                  <button
                    key={folder.path}
                    type="button"
                    onClick={() => openDirectory(folder.path)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-3 py-2">
            <span className="text-[11px] text-muted-foreground">
              {t('projectWizard.folderBrowser.path')}
            </span>
            <code className="flex-1 truncate font-mono text-xs text-foreground">
              {currentPath}
            </code>
          </div>
          <div className="flex items-center justify-end gap-2 px-3 py-2.5">
            <Button type="button" size="sm" variant="outline" onClick={closeModal}>
              {t('projectWizard.folderBrowser.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => onFolderSelected(currentPath, autoAdvanceOnSelect)}
            >
              {t('projectWizard.folderBrowser.useThisFolder')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
