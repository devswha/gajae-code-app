import { getConnection } from '@/modules/database/connection.js';

interface NotificationEventToggles { actionRequired: boolean; error: boolean; stop: boolean }

interface NotificationPreferences {
  channels: { [key: string]: boolean; desktop: boolean; inApp: boolean; sound: boolean };
  events: NotificationEventToggles;
}

const BUILT_IN_CHANNEL_NAMES: readonly string[] = ['desktop', 'inApp', 'sound'];

function createDefaultPreferences(): NotificationPreferences {
  return {
    channels: { desktop: false, inApp: false, sound: true },
    events: { actionRequired: true, error: true, stop: true },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizePreferences(value: unknown): NotificationPreferences {
  const source = asRecord(value);
  const rawChannels = asRecord(source.channels);
  const rawEvents = asRecord(source.events);

  const channels: NotificationPreferences['channels'] = {
    desktop: rawChannels.desktop === true,
    inApp: rawChannels.inApp === true,
    sound: rawChannels.sound !== false,
  };
  for (const [name, flag] of Object.entries(rawChannels)) {
    if (typeof flag === 'boolean' && !BUILT_IN_CHANNEL_NAMES.includes(name)) {
      channels[name] = flag;
    }
  }

  const events: NotificationEventToggles = {
    actionRequired: rawEvents.actionRequired !== false,
    error: rawEvents.error !== false,
    stop: rawEvents.stop !== false,
  };

  return { channels, events };
}

function readStoredRow(userId: number): { preferences_json: string } | undefined {
  const statement = getConnection().prepare(
    'SELECT preferences_json FROM user_notification_preferences WHERE user_id = ?',
  );
  return statement.get(userId) as { preferences_json: string } | undefined;
}

function decodeStoredPreferences(json: string): NotificationPreferences {
  try {
    return normalizePreferences(JSON.parse(json));
  } catch {
    return normalizePreferences(createDefaultPreferences());
  }
}

function persistPreferences(userId: number, preferences: NotificationPreferences): void {
  const statement = getConnection().prepare(`
    INSERT INTO user_notification_preferences (user_id, preferences_json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      preferences_json = excluded.preferences_json,
      updated_at = CURRENT_TIMESTAMP
  `);
  statement.run(userId, JSON.stringify(preferences));
}

function getNotificationPreferences(userId: number): NotificationPreferences {
  const stored = readStoredRow(userId);
  if (stored !== undefined) {
    return decodeStoredPreferences(stored.preferences_json);
  }

  const defaults = normalizePreferences(createDefaultPreferences());
  getConnection()
    .prepare(
      'INSERT INTO user_notification_preferences (user_id, preferences_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
    )
    .run(userId, JSON.stringify(defaults));
  return defaults;
}

function updateNotificationPreferences(
  userId: number,
  preferences: unknown,
): NotificationPreferences {
  const normalized = normalizePreferences(preferences);
  persistPreferences(userId, normalized);
  return normalized;
}

export const notificationPreferencesDb = {
  getNotificationPreferences,
  updateNotificationPreferences,
  getPreferences: getNotificationPreferences,
  updatePreferences: updateNotificationPreferences,
};
