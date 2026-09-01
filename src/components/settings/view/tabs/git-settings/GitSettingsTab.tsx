import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useGitSettings } from '../../../hooks/useGitSettings';
import { Button, Input } from '../../../../../shared/view/ui';
import SettingsCard from '../../SettingsCard';
import SettingsSection from '../../SettingsSection';

type IdentityFieldProps = {
  id: string;
  type: 'email' | 'text';
  value: string;
  placeholder: string;
  label: string;
  help: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
};

function IdentityField({
  id,
  type,
  value,
  placeholder,
  label,
  help,
  disabled,
  onValueChange,
}: IdentityFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-foreground">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={({ target }) => onValueChange(target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full"
      />
      <p className="mt-1 text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

export default function GitSettingsTab() {
  const { t } = useTranslation('settings');
  const {
    gitName,
    setGitName,
    gitEmail,
    setGitEmail,
    isLoading,
    isSaving,
    saveStatus,
    saveGitConfig,
  } = useGitSettings();
  const isIdentityComplete = gitName.trim() !== '' && gitEmail.trim() !== '';
  const saveDisabled = isSaving || !isIdentityComplete;

  return (
    <div className="space-y-8">
      <SettingsSection title={t('git.title')} description={t('git.description')}>
        <SettingsCard className="p-4">
          <div className="space-y-4">
            <IdentityField
              id="settings-git-name"
              type="text"
              value={gitName}
              placeholder="John Doe"
              label={t('git.name.label')}
              help={t('git.name.help')}
              disabled={isLoading}
              onValueChange={setGitName}
            />
            <IdentityField
              id="settings-git-email"
              type="email"
              value={gitEmail}
              placeholder="john@example.com"
              label={t('git.email.label')}
              help={t('git.email.help')}
              disabled={isLoading}
              onValueChange={setGitEmail}
            />
            <div className="flex items-center gap-2">
              <Button onClick={saveGitConfig} disabled={saveDisabled}>
                {isSaving ? t('git.actions.saving') : t('git.actions.save')}
              </Button>
              {saveStatus === 'success' ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="h-4 w-4" />
                  {t('git.status.success')}
                </div>
              ) : null}
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
