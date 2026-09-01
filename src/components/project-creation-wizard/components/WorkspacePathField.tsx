import { useCallback, useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../shared/view/ui';
import { browseFilesystemFolders } from '../data/workspaceApi';
import type { FolderSuggestion } from '../types';
import { getSuggestionRootPath } from '../utils/pathUtils';

import FolderBrowserModal from './FolderBrowserModal';

type WorkspacePathFieldProps = {
  value: string;
  disabled?: boolean;
  onChange: (path: string) => void;
  onAdvanceToConfirm: () => void;
};

const matchingPaths = (input: string, folders: FolderSuggestion[]) => {
  const enteredPath = input.toLowerCase();
  return folders.filter(({ path }) => {
    const candidate = path.toLowerCase();
    return candidate.startsWith(enteredPath) && candidate !== enteredPath;
  }).slice(0, 5);
};

export default function WorkspacePathField({
  value,
  disabled = false,
  onChange,
  onAdvanceToConfirm,
}: WorkspacePathFieldProps) {
  const { t } = useTranslation();
  const [pathSuggestions, setPathSuggestions] = useState<FolderSuggestion[]>([]);
  const [showPathDropdown, setShowPathDropdown] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  useEffect(() => {
    if (value.trim().length <= 2) {
      setPathSuggestions([]);
      setShowPathDropdown(false);
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      const loadSuggestions = async () => {
        try {
          const response = await browseFilesystemFolders(getSuggestionRootPath(value));
          const suggestions = matchingPaths(value, response.suggestions);
          setPathSuggestions(suggestions);
          setShowPathDropdown(suggestions.length !== 0);
        } catch (reason) {
          console.error('Failed to load path suggestions:', reason);
        }
      };
      void loadSuggestions();
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [value]);

  const selectSuggestion = useCallback((suggestion: FolderSuggestion) => {
    onChange(suggestion.path);
    setShowPathDropdown(false);
  }, [onChange]);

  const selectFolder = useCallback((selectedPath: string, advanceToConfirm: boolean) => {
    onChange(selectedPath);
    setShowFolderBrowser(false);
    if (advanceToConfirm) {
      onAdvanceToConfirm();
    }
  }, [onAdvanceToConfirm, onChange]);

  return (
    <>
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <Input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t('projectWizard.step2.existingPlaceholder')}
            className="w-full"
            disabled={disabled}
          />

          {showPathDropdown && pathSuggestions.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl">
              {pathSuggestions.map((suggestion) => (
                <button
                  key={suggestion.path}
                  type="button"
                  onClick={() => selectSuggestion(suggestion)}
                  className="w-full rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                >
                  <div className="text-foreground">{suggestion.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{suggestion.path}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => setShowFolderBrowser(true)}
          className="px-3"
          title={t('projectWizard.folderBrowser.browseFolders')}
          aria-label={t('projectWizard.folderBrowser.browseFolders')}
          disabled={disabled}
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>

      <FolderBrowserModal
        isOpen={showFolderBrowser}
        autoAdvanceOnSelect={false}
        onClose={() => setShowFolderBrowser(false)}
        onFolderSelected={selectFolder}
      />
    </>
  );
}
