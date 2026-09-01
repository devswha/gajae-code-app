import type { InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import { useVoiceConfig } from '../../../../hooks/useVoiceConfig';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

type VoiceInputProps = InputHTMLAttributes<HTMLInputElement> & { label: string };

function VoiceInput({ label, ...input }: VoiceInputProps) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:outline-hidden"
        {...input}
      />
    </label>
  );
}

export default function VoiceSettingsTab() {
  const { t } = useTranslation('settings');
  const { preferences: ui, setPreference: setUiPreference } = useUiPreferences();
  const { config: voice, update: updateVoice } = useVoiceConfig();

  const backend = (
    <SettingsSection title={t('voiceSettings.backendTitle')} description={t('voiceSettings.backendDescription')}>
      <div className="space-y-4">
        <VoiceInput label={t('voiceSettings.baseUrl')} placeholder="https://api.openai.com/v1" value={voice.baseUrl} onChange={(event) => updateVoice({ baseUrl: event.target.value })} />
        <VoiceInput label={t('voiceSettings.apiKey')} type="password" autoComplete="off" placeholder="sk-…" value={voice.apiKey} onChange={(event) => updateVoice({ apiKey: event.target.value })} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <VoiceInput label={t('voiceSettings.sttModel')} placeholder="whisper-1" value={voice.sttModel} onChange={(event) => updateVoice({ sttModel: event.target.value })} />
          <VoiceInput label={t('voiceSettings.ttsModel')} placeholder="tts-1" value={voice.ttsModel} onChange={(event) => updateVoice({ ttsModel: event.target.value })} />
          <VoiceInput label={t('voiceSettings.voice')} placeholder="alloy" value={voice.ttsVoice} onChange={(event) => updateVoice({ ttsVoice: event.target.value })} />
          <VoiceInput label={t('voiceSettings.format')} placeholder="mp3" value={voice.ttsFormat} onChange={(event) => updateVoice({ ttsFormat: event.target.value })} />
        </div>
        <p className="text-xs text-muted-foreground">{t('voiceSettings.note')}</p>
      </div>
    </SettingsSection>
  );

  return (
    <div className="space-y-8">
      <SettingsSection title={t('voiceSettings.title')} description={t('voiceSettings.description')}>
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="pr-3">
            <div className="text-sm font-medium text-foreground">{t('voiceSettings.enable')}</div>
            <div className="text-xs text-muted-foreground">{t('voiceSettings.enableDescription')}</div>
          </div>
          <SettingsToggle
            checked={ui.voiceEnabled}
            onChange={(enabled) => setUiPreference('voiceEnabled', enabled)}
            ariaLabel={t('voiceSettings.enable')}
          />
        </div>
      </SettingsSection>
      {ui.voiceEnabled && backend}
    </div>
  );
}
