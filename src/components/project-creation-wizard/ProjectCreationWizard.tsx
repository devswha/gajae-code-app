import { useState } from 'react';
import { FolderPlus, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../shared/view/ui';

import ErrorBanner from './components/ErrorBanner';
import WorkspacePathField from './components/WorkspacePathField';
import { createProjectRequest } from './data/workspaceApi';

type ProjectCreationWizardProps = {
  onClose: () => void;
  onProjectCreated?: (project?: Record<string, unknown>) => void;
};

export default function ProjectCreationWizard({
  onClose,
  onProjectCreated,
}: ProjectCreationWizardProps) {
  const { t } = useTranslation();
  const [workspacePath, setWorkspacePath] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createProject = async () => {
    const path = workspacePath.trim();
    if (path === '') {
      setError(t('projectWizard.errors.providePath'));
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const project = await createProjectRequest({ path });
      onProjectCreated?.(project);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('projectWizard.errors.failedToCreate'));
    } finally {
      setIsCreating(false);
    }
  };

  const pathIsEmpty = !workspacePath.trim();

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-background/80 p-4 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-project-title"
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
              <FolderPlus className="size-4" />
            </div>
            <div className="min-w-0">
              <h2 id="add-project-title" className="text-base font-semibold text-foreground">
                {t('projectWizard.addProject', { defaultValue: 'Add project' })}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('projectWizard.addProjectDescription', { defaultValue: 'Choose a local folder to use as a project.' })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isCreating}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t('projectWizard.buttons.cancel')}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {error && <ErrorBanner message={error} />}
          <label className="block text-xs font-medium text-foreground">
            {t('projectWizard.step2.existingPath')}
          </label>
          <WorkspacePathField
            value={workspacePath}
            disabled={isCreating}
            onChange={setWorkspacePath}
            onAdvanceToConfirm={() => {}}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-muted/20 px-5 py-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isCreating}>
            {t('projectWizard.buttons.cancel')}
          </Button>
          <Button type="button" onClick={createProject} disabled={pathIsEmpty || isCreating}>
            {isCreating && <Loader2 className="mr-2 size-4 animate-spin" />}
            {isCreating
              ? t('projectWizard.buttons.creating')
              : t('projectWizard.addButton', { defaultValue: 'Add' })}
          </Button>
        </div>
      </div>
    </div>
  );
}
