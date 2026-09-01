import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useSettingsController } from '../hooks/useSettingsController';
import { Button } from '../../../shared/view/ui';
import type { SettingsProps } from '../types/types';

import SettingsSidebar from './SettingsSidebar';
import AboutTab from './tabs/AboutTab';
import AppearanceSettingsTab from './tabs/AppearanceSettingsTab';
import AutomationSettingsTab from './tabs/AutomationSettingsTab';
import GitSettingsTab from './tabs/git-settings/GitSettingsTab';
import NotificationsSettingsTab from './tabs/NotificationsSettingsTab';
import VoiceSettingsTab from './tabs/VoiceSettingsTab';

type DesktopNotificationState = {
  enabled: boolean;
  supported: boolean;
  connectedCount?: number;
  targetCount?: number;
  lastError?: string | null;
};
type DesktopNotificationSnapshot = { desktopNotifications?: DesktopNotificationState };
type DesktopNotificationBridge = {
  getState: () => Promise<DesktopNotificationSnapshot | null | undefined>;
  onStateUpdated?: (handler: (state: DesktopNotificationSnapshot | null | undefined) => void) => (() => void) | undefined;
  update: (settings: Pick<DesktopNotificationState, 'enabled'>) => Promise<DesktopNotificationSnapshot | null | undefined>;
};
type DesktopNotificationWindow = Window & { gajaeAppDesktopNotifications?: DesktopNotificationBridge };

function findDesktopNotificationBridge(): DesktopNotificationBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as DesktopNotificationWindow).gajaeAppDesktopNotifications ?? null;
}

function Settings({ isOpen, onClose, initialTab = 'appearance' }: SettingsProps) {
  const { t } = useTranslation('settings');
  const bridge = useMemo(findDesktopNotificationBridge, []);
  const [desktopState, setDesktopState] = useState<DesktopNotificationState | null>(null);
  const controller = useSettingsController({ isOpen, initialTab });
  const {
    activeTab,
    setActiveTab,
    saveStatus,
    projectSortOrder,
    setProjectSortOrder,
    interfaceFontSize,
    setInterfaceFontSize,
    codeEditorSettings,
    updateCodeEditorSetting,
    notificationPreferences,
    setNotificationPreferences,
  } = controller;

  useEffect(() => {
    if (!bridge) return undefined;
    let listening = true;
    const receiveState = (snapshot: DesktopNotificationSnapshot | null | undefined) => {
      if (listening) setDesktopState(snapshot?.desktopNotifications ?? null);
    };
    bridge.getState().then(receiveState).catch(() => {
      // The native bridge can be unavailable during startup.
    });
    const unsubscribe = bridge.onStateUpdated?.(receiveState);
    return () => {
      listening = false;
      unsubscribe?.();
    };
  }, [bridge]);

  const setDesktopNotificationsEnabled = async (enabled: boolean) => {
    if (!bridge) return;
    const snapshot = await bridge.update({ enabled });
    setDesktopState(snapshot?.desktopNotifications ?? null);
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, desktop: enabled },
    });
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop fixed inset-0 z-9999 flex items-center justify-center bg-background/80 backdrop-blur-xs md:p-4">
      <div className="flex h-full w-full flex-col overflow-hidden border border-border bg-background shadow-2xl md:h-[90vh] md:max-w-4xl md:rounded-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 md:px-5">
          <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
          <div className="flex items-center gap-2">
            {saveStatus === 'success' && (
              <span className="animate-in fade-in text-xs text-muted-foreground">{t('saveStatus.success')}</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-10 w-10 touch-manipulation p-0 text-muted-foreground hover:text-foreground active:bg-accent/50"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <SettingsSidebar activeTab={activeTab} onChange={setActiveTab} />
          <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div key={activeTab} className="min-w-0 settings-content-enter space-y-6 overflow-x-hidden p-4 pb-safe-area-inset-bottom md:space-y-8 md:p-6">
              {activeTab === 'appearance' && (
                <AppearanceSettingsTab
                  projectSortOrder={projectSortOrder}
                  onProjectSortOrderChange={setProjectSortOrder}
                  interfaceFontSize={interfaceFontSize}
                  onInterfaceFontSizeChange={setInterfaceFontSize}
                  codeEditorSettings={codeEditorSettings}
                  onCodeEditorWordWrapChange={(value) => updateCodeEditorSetting('wordWrap', value)}
                  onCodeEditorShowMinimapChange={(value) => updateCodeEditorSetting('showMinimap', value)}
                  onCodeEditorLineNumbersChange={(value) => updateCodeEditorSetting('lineNumbers', value)}
                  onCodeEditorFontSizeChange={(value) => updateCodeEditorSetting('fontSize', value)}
                />
              )}
              {activeTab === 'git' && <GitSettingsTab />}
              {activeTab === 'notifications' && (
                <NotificationsSettingsTab
                  notificationPreferences={notificationPreferences}
                  onNotificationPreferencesChange={setNotificationPreferences}
                  isDesktop={Boolean(bridge)}
                  desktopNotifications={desktopState}
                  onEnableDesktopNotifications={() => setDesktopNotificationsEnabled(true)}
                  onDisableDesktopNotifications={() => setDesktopNotificationsEnabled(false)}
                />
              )}
              {activeTab === 'voice' && <VoiceSettingsTab />}
              {activeTab === 'automation' && <AutomationSettingsTab />}
              {activeTab === 'about' && <AboutTab />}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default Settings;
