import { useCallback, useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Input } from '../../../shared/view/ui';
import { browseFilesystemFolders } from '../data/workspaceApi';
import { getSuggestionRootPath } from '../utils/pathUtils';
import type { FolderSuggestion } from '../types';

import FolderBrowserModal from './FolderBrowserModal';

type WorkspacePathFieldProps = {
  value: string;
  disabled?: boolean;
  onChange: (path: string) => void;
  onAdvanceToConfirm: () => void;
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
      return;
    }

    // Debounce path lookup to avoid firing a request for every keystroke.
    const timerId = window.setTimeout(async () => {
      try {
        const directoryPath = getSuggestionRootPath(value);
        const result = await browseFilesystemFolders(directoryPath);
        const normalizedInput = value.toLowerCase();

        const matchingSuggestions = result.suggestions
          .filter((suggestion) => {
            const normalizedSuggestion = suggestion.path.toLowerCase();
            return (
              normalizedSuggestion.startsWith(normalizedInput) &&
              normalizedSuggestion !== normalizedInput
            );
          })
          .slice(0, 5);

        setPathSuggestions(matchingSuggestions);
        setShowPathDropdown(matchingSuggestions.length > 0);
      } catch (error) {
        console.error('Failed to load path suggestions:', error);
      }
    }, 200);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [value]);

  const handleSuggestionSelect = useCallback(
    (suggestion: FolderSuggestion) => {
      onChange(suggestion.path);
      setShowPathDropdown(false);
    },
    [onChange],
  );

  const handleFolderSelected = useCallback(
    (selectedPath: string, advanceToConfirm: boolean) => {
      onChange(selectedPath);
      setShowFolderBrowser(false);
      if (advanceToConfirm) {
        onAdvanceToConfirm();
      }
    },
    [onAdvanceToConfirm, onChange],
  );

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
                  onClick={() => handleSuggestionSelect(suggestion)}
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
        onFolderSelected={handleFolderSelected}
      />
    </>
  );
}
