import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/view/ui';
import SettingsSidebar from '../view/SettingsSidebar';
import AppearanceSettingsTab from '../view/tabs/AppearanceSettingsTab';
import VoiceSettingsTab from '../view/tabs/VoiceSettingsTab';
import GitSettingsTab from '../view/tabs/git-settings/GitSettingsTab';
import NotificationsSettingsTab from '../view/tabs/NotificationsSettingsTab';
import AboutTab from '../view/tabs/AboutTab';
import AutomationSettingsTab from '../view/tabs/AutomationSettingsTab';
import { useSettingsController } from '../hooks/useSettingsController';
import type { SettingsProps } from '../types/types';

type GajaeAppDesktopNotificationsState = {
  enabled: boolean;
  supported: boolean;
  connectedCount?: number;
  targetCount?: number;
  lastError?: string | null;
};

type GajaeAppDesktopNotificationsSnapshot = {
  desktopNotifications?: GajaeAppDesktopNotificationsState;
};

type GajaeAppDesktopNotificationsBridge = {
  getState: () => Promise<GajaeAppDesktopNotificationsSnapshot | null | undefined>;
  onStateUpdated?: (
    handler: (state: GajaeAppDesktopNotificationsSnapshot | null | undefined) => void,
  ) => (() => void) | undefined;
  update: (
    notificationSettings: Pick<GajaeAppDesktopNotificationsState, 'enabled'>,
  ) => Promise<GajaeAppDesktopNotificationsSnapshot | null | undefined>;
};

type GajaeAppWindow = Window & {
  gajaeAppDesktopNotifications?: GajaeAppDesktopNotificationsBridge;
};

function Settings({ isOpen, onClose, initialTab = 'appearance' }: SettingsProps) {
  const { t } = useTranslation('settings');
  const gajaeAppDesktopNotificationsBridge = useMemo<GajaeAppDesktopNotificationsBridge | null>(() => (
    typeof window === 'undefined'
      ? null
      : (window as GajaeAppWindow).gajaeAppDesktopNotifications ?? null
  ), []);
  const [gajaeAppDesktopNotificationsState, setGajaeAppDesktopNotificationsState] = useState<GajaeAppDesktopNotificationsState | null>(null);
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
  } = useSettingsController({
    isOpen,
    initialTab
  });

  useEffect(() => {
    if (!gajaeAppDesktopNotificationsBridge) return undefined;
    let mounted = true;
    gajaeAppDesktopNotificationsBridge.getState().then((state) => {
      if (mounted) {
        setGajaeAppDesktopNotificationsState(state?.desktopNotifications ?? null);
      }
    }).catch(() => {});
    const unsubscribe = gajaeAppDesktopNotificationsBridge.onStateUpdated?.((state) => {
      if (mounted) {
        setGajaeAppDesktopNotificationsState(state?.desktopNotifications ?? null);
      }
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [gajaeAppDesktopNotificationsBridge]);

  const handleEnableDesktopNotifications = async () => {
    if (!gajaeAppDesktopNotificationsBridge) return;
    const state = await gajaeAppDesktopNotificationsBridge.update({ enabled: true });
    setGajaeAppDesktopNotificationsState(state?.desktopNotifications ?? null);
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, desktop: true },
    });
  };

  const handleDisableDesktopNotifications = async () => {
    if (!gajaeAppDesktopNotificationsBridge) return;
    const state = await gajaeAppDesktopNotificationsBridge.update({ enabled: false });
    setGajaeAppDesktopNotificationsState(state?.desktopNotifications ?? null);
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, desktop: false },
    });
  };

  if (!isOpen) {
    return null;
  }


  return (
    <div className="modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm md:p-4">
      <div className="flex h-full w-full flex-col overflow-hidden border border-border bg-background shadow-2xl md:h-[90vh] md:max-w-4xl md:rounded-xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-3 md:px-5">
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

        {/* Body: sidebar + content */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <SettingsSidebar activeTab={activeTab} onChange={setActiveTab} />

          {/* Content */}
          <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div key={activeTab} className="settings-content-enter min-w-0 space-y-6 overflow-x-hidden p-4 pb-safe-area-inset-bottom md:space-y-8 md:p-6">
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
                  isDesktop={Boolean(gajaeAppDesktopNotificationsBridge)}
                  desktopNotifications={gajaeAppDesktopNotificationsState}
                  onEnableDesktopNotifications={handleEnableDesktopNotifications}
                  onDisableDesktopNotifications={handleDisableDesktopNotifications}
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
