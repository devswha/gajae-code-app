import { Bell, BellOff, BellRing, Play, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/view/ui';
import { playChatCompletionSound } from '../../../../utils/notificationSound';
import type { NotificationPreferencesState } from '../../types/types';

type NotificationsSettingsTabProps = {
  notificationPreferences: NotificationPreferencesState;
  onNotificationPreferencesChange: (value: NotificationPreferencesState) => void;
  isDesktop?: boolean;
  desktopNotifications?: { enabled: boolean; supported: boolean; connectedCount?: number; targetCount?: number; lastError?: string | null } | null;
  onEnableDesktopNotifications?: () => void;
  onDisableDesktopNotifications?: () => void;
};
type EventName = keyof NotificationPreferencesState['events'];

function EventCheckbox({ event, label, preferences, onChange }: {
  event: EventName;
  label: string;
  preferences: NotificationPreferencesState;
  onChange: (value: NotificationPreferencesState) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={preferences.events[event]}
        onChange={(input) => onChange({
          ...preferences,
          events: { ...preferences.events, [event]: input.target.checked },
        })}
        className="h-4 w-4"
      />
      {label}
    </label>
  );
}

export default function NotificationsSettingsTab(props: NotificationsSettingsTabProps) {
  const { t } = useTranslation('settings');
  const { notificationPreferences: preferences, onNotificationPreferencesChange: changePreferences } = props;
  const desktopEnabled = props.desktopNotifications?.enabled;
  const toggleDesktop = () => {
    if (desktopEnabled) {
      props.onDisableDesktopNotifications?.();
    } else {
      props.onEnableDesktopNotifications?.();
    }
  };

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-medium text-foreground">{t('notifications.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('notifications.description')}</p>
      </div>

      {props.isDesktop ? (
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          <h4 className="font-medium text-foreground">
            {t('notifications.desktop.title', { defaultValue: 'Notify this desktop app' })}
          </h4>
          {props.desktopNotifications?.supported === false ? (
            <p className="text-sm text-muted-foreground">
              {t('notifications.desktop.unsupported', { defaultValue: 'Desktop notifications are not supported on this system.' })}
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleDesktop}
                  className={desktopEnabled
                    ? 'inline-flex items-center gap-2 rounded-md bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20'
                    : 'inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'}
                >
                  {desktopEnabled ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
                  {desktopEnabled
                    ? t('notifications.desktop.disable', { defaultValue: 'Disable desktop notifications' })
                    : t('notifications.desktop.enable', { defaultValue: 'Enable desktop notifications' })}
                </button>
                {desktopEnabled && (
                  <span className="text-sm text-muted-foreground">
                    {t('notifications.desktop.enabled', { defaultValue: 'Desktop notifications are enabled' })}
                  </span>
                )}
              </div>
              {props.desktopNotifications?.lastError && (
                <p className="text-sm text-destructive">{props.desktopNotifications.lastError}</p>
              )}
            </div>
          )}
        </div>
      ) : null}

      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-primary" />
              <h4 className="font-medium text-foreground">{t('notifications.sound.title', { defaultValue: 'Sound' })}</h4>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('notifications.sound.description', { defaultValue: 'Play a short tone when a chat run finishes.' })}
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={preferences.channels.sound}
              onChange={(input) => changePreferences({
                ...preferences,
                channels: { ...preferences.channels, sound: input.target.checked },
              })}
              className="h-4 w-4"
            />
            {t('notifications.sound.enabled', { defaultValue: 'Enabled' })}
          </label>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => { void playChatCompletionSound({ force: true }); }}>
          <Play className="h-4 w-4" />
          {t('notifications.sound.test', { defaultValue: 'Test sound' })}
        </Button>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <h4 className="font-medium text-foreground">{t('notifications.events.title')}</h4>
        <div className="space-y-3">
          <EventCheckbox event="actionRequired" label={t('notifications.events.actionRequired')} preferences={preferences} onChange={changePreferences} />
          <EventCheckbox event="stop" label={t('notifications.events.stop')} preferences={preferences} onChange={changePreferences} />
          <EventCheckbox event="error" label={t('notifications.events.error')} preferences={preferences} onChange={changePreferences} />
        </div>
      </div>
    </div>
  );
}
