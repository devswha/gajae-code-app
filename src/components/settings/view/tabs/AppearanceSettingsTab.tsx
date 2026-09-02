import { useTranslation } from 'react-i18next';

import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import { DarkModeToggle } from '../../../../shared/view/ui';
import LanguageSelector from '../../../../shared/view/ui/LanguageSelector';
import ToolOutputDensityPicker from '../../../chat/view/ToolOutputDensityPicker';
import type { InterfaceFontSize, ProjectSortOrder } from '../../types/types';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

type AppearanceSettingsTabProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  interfaceFontSize: InterfaceFontSize;
  onInterfaceFontSizeChange: (value: InterfaceFontSize) => void;
};

const selectClass = 'w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary';

type PreferenceToggleProps = {
  checked: boolean;
  label: string;
  change: (value: boolean) => void;
};

function PreferenceToggle({ checked, label, change }: PreferenceToggleProps) {
  return <SettingsToggle checked={checked} onChange={change} ariaLabel={label} />;
}

export default function AppearanceSettingsTab(input: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');
  const { preferences, setPreference } = useUiPreferences();

  return (
    <div className="space-y-8">
      <SettingsSection title={t('appearanceSettings.darkMode.label')}>
        <SettingsCard divided>
          <SettingsRow label={t('appearanceSettings.darkMode.label')} description={t('appearanceSettings.darkMode.description')}>
            <DarkModeToggle ariaLabel={t('appearanceSettings.darkMode.label')} />
          </SettingsRow>
          <SettingsRow label={t('appearanceSettings.interfaceFontSize.label')} description={t('appearanceSettings.interfaceFontSize.description')}>
            <select
              value={input.interfaceFontSize}
              onChange={(event) => input.onInterfaceFontSizeChange(event.target.value as InterfaceFontSize)}
              className={`${selectClass} sm:w-28`}
            >
              <option value="small">{t('appearanceSettings.interfaceFontSize.small')}</option>
              <option value="medium">{t('appearanceSettings.interfaceFontSize.medium')}</option>
              <option value="large">{t('appearanceSettings.interfaceFontSize.large')}</option>
            </select>
          </SettingsRow>
          <SettingsRow label={t('appearanceSettings.imagePreviews.label')} description={t('appearanceSettings.imagePreviews.description')}>
            <PreferenceToggle
              checked={preferences.showImagePreviews}
              change={(value) => setPreference('showImagePreviews', value)}
              label={t('appearanceSettings.imagePreviews.label')}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('mainTabs.appearance')}>
        <SettingsCard><LanguageSelector /></SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('preferences.sections.toolDisplay')}>
        <SettingsCard>
          <SettingsRow
            label={t('preferences.toolOutputDensity.label')}
            description={t('preferences.toolOutputDensity.description')}
            className="flex-col items-stretch gap-3 sm:flex-row sm:items-center"
          >
            <ToolOutputDensityPicker
              value={preferences.toolOutputDensity}
              onChange={(value) => setPreference('toolOutputDensity', value)}
              ariaLabel={t('preferences.toolOutputDensity.label')}
            />
          </SettingsRow>
          <p className="px-4 pb-4 text-xs text-muted-foreground" aria-live="polite">
            {t(`preferences.toolOutputDensity.${preferences.toolOutputDensity}Description`)}
          </p>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('preferences.sections.inputSettings')}>
        <SettingsCard>
          <SettingsRow label={t('preferences.sendByCtrlEnter')} description={t('preferences.sendByCtrlEnterDescription')}>
            <PreferenceToggle checked={preferences.sendByCtrlEnter} change={(value) => setPreference('sendByCtrlEnter', value)} label={t('preferences.sendByCtrlEnter')} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.projectSorting.label')}>
        <SettingsCard>
          <SettingsRow label={t('appearanceSettings.projectSorting.label')} description={t('appearanceSettings.projectSorting.description')}>
            <select
              value={input.projectSortOrder}
              onChange={(event) => input.onProjectSortOrderChange(event.target.value as ProjectSortOrder)}
              className={`${selectClass} sm:w-36`}
            >
              <option value="name">{t('appearanceSettings.projectSorting.alphabetical')}</option>
              <option value="date">{t('appearanceSettings.projectSorting.recentActivity')}</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

    </div>
  );
}
