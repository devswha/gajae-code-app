import { useTranslation } from 'react-i18next';

import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import { DarkModeToggle } from '../../../../shared/view/ui';
import LanguageSelector from '../../../../shared/view/ui/LanguageSelector';
import type { CodeEditorSettingsState, InterfaceFontSize, ProjectSortOrder } from '../../types/types';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

type AppearanceSettingsTabProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  interfaceFontSize: InterfaceFontSize;
  onInterfaceFontSizeChange: (value: InterfaceFontSize) => void;
  codeEditorSettings: CodeEditorSettingsState;
  onCodeEditorWordWrapChange: (value: boolean) => void;
  onCodeEditorShowMinimapChange: (value: boolean) => void;
  onCodeEditorLineNumbersChange: (value: boolean) => void;
  onCodeEditorFontSizeChange: (value: string) => void;
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
  const editor = input.codeEditorSettings;

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
        <SettingsCard divided>
          <SettingsRow label={t('preferences.showThinking')}>
            <PreferenceToggle checked={preferences.showThinking} change={(value) => setPreference('showThinking', value)} label={t('preferences.showThinking')} />
          </SettingsRow>
          <SettingsRow label={t('preferences.showRawParameters')}>
            <PreferenceToggle checked={preferences.showRawParameters} change={(value) => setPreference('showRawParameters', value)} label={t('preferences.showRawParameters')} />
          </SettingsRow>
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

      <SettingsSection title={t('appearanceSettings.codeEditor.title')}>
        <SettingsCard divided>
          <SettingsRow label={t('appearanceSettings.codeEditor.wordWrap.label')} description={t('appearanceSettings.codeEditor.wordWrap.description')}>
            <PreferenceToggle checked={editor.wordWrap} change={input.onCodeEditorWordWrapChange} label={t('appearanceSettings.codeEditor.wordWrap.label')} />
          </SettingsRow>
          <SettingsRow label={t('appearanceSettings.codeEditor.showMinimap.label')} description={t('appearanceSettings.codeEditor.showMinimap.description')}>
            <PreferenceToggle checked={editor.showMinimap} change={input.onCodeEditorShowMinimapChange} label={t('appearanceSettings.codeEditor.showMinimap.label')} />
          </SettingsRow>
          <SettingsRow label={t('appearanceSettings.codeEditor.lineNumbers.label')} description={t('appearanceSettings.codeEditor.lineNumbers.description')}>
            <PreferenceToggle checked={editor.lineNumbers} change={input.onCodeEditorLineNumbersChange} label={t('appearanceSettings.codeEditor.lineNumbers.label')} />
          </SettingsRow>
          <SettingsRow label={t('appearanceSettings.codeEditor.fontSize.label')} description={t('appearanceSettings.codeEditor.fontSize.description')}>
            <select value={editor.fontSize} onChange={(event) => input.onCodeEditorFontSizeChange(event.target.value)} className={`${selectClass} sm:w-28`}>
              <option value="10">10px</option><option value="11">11px</option><option value="12">12px</option>
              <option value="13">13px</option><option value="14">14px</option><option value="15">15px</option>
              <option value="16">16px</option><option value="18">18px</option><option value="20">20px</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
