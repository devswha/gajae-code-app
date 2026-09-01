import { getConnection } from '@/modules/database/connection.js';

interface NotificationChannelEndpointRow { channel: string; created_at: string; enabled: number; endpoint_id: string; id: number; label: string | null; last_seen_at: string; metadata_json: string | null; updated_at: string; user_id: number }

interface UpsertNotificationChannelEndpointInput { channel: string; enabled?: boolean; endpointId: string; label?: string | null; metadata?: Record<string, unknown> | null; userId: number }

const ENDPOINT_COLUMN_LIST = [
  'id, user_id, channel, endpoint_id, label,',
  'metadata_json, enabled, last_seen_at, created_at, updated_at',
].join(' ');

function asTrimmedString(value: unknown): string {
  return (typeof value === 'string' ? value : '').trim();
}

function normalizeLabel(value: unknown): string | null {
  const text = asTrimmedString(value);
  return text.length > 0 ? text : null;
}

function serializeMetadata(value: Record<string, unknown> | null | undefined): string | null {
  if (value === null || value === undefined || typeof value !== 'object') {
    return null;
  }
  return JSON.stringify(value);
}

function parseMetadata(
  metadataJson: string | null,
): Record<string, unknown> {
  if (!metadataJson) {
    return {};
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(metadataJson);
  } catch {
    return {};
  }
  if (decoded === null || typeof decoded !== 'object') {
    return {};
  }
  return decoded as Record<string, unknown>;
}

function endpointKey(userId: number, channel: string, endpointId: string): [number, string, string] {
  return [userId, asTrimmedString(channel), asTrimmedString(endpointId)];
}

function queryEndpoints(
  whereClause: string,
  parameters: unknown[],
): NotificationChannelEndpointRow[] {
  const statement = getConnection().prepare(
    `SELECT ${ENDPOINT_COLUMN_LIST} FROM notification_channel_endpoints ${whereClause} ORDER BY last_seen_at DESC`,
  );
  return statement.all(...parameters) as NotificationChannelEndpointRow[];
}

function upsertEndpoint(input: UpsertNotificationChannelEndpointInput): NotificationChannelEndpointRow {
  const channel = asTrimmedString(input.channel);
  const endpointId = asTrimmedString(input.endpointId);
  if (channel.length === 0) {
    throw new Error('channel is required');
  }
  if (endpointId.length === 0) {
    throw new Error('endpointId is required');
  }

  getConnection()
    .prepare(`
      INSERT INTO notification_channel_endpoints
        (user_id, channel, endpoint_id, label, metadata_json, enabled, last_seen_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, channel, endpoint_id) DO UPDATE SET
        label = excluded.label,
        metadata_json = excluded.metadata_json,
        enabled = excluded.enabled,
        last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run(
      input.userId, channel, endpointId,
      normalizeLabel(input.label), serializeMetadata(input.metadata), input.enabled === false ? 0 : 1,
    );

  return getEndpoint(input.userId, channel, endpointId)!;
}

function getEndpoint(
  userId: number,
  channel: string,
  endpointId: string,
): NotificationChannelEndpointRow | null {
  const statement = getConnection().prepare(
    `SELECT ${ENDPOINT_COLUMN_LIST} FROM notification_channel_endpoints WHERE user_id = ? AND channel = ? AND endpoint_id = ?`,
  );
  const row = statement.get(...endpointKey(userId, channel, endpointId)) as
    | NotificationChannelEndpointRow
    | undefined;
  return row ?? null;
}

function getEndpoints(userId: number, channel: string): NotificationChannelEndpointRow[] {
  return queryEndpoints('WHERE user_id = ? AND channel = ?', [
    userId,
    asTrimmedString(channel),
  ]);
}

function getEnabledEndpoints(userId: number, channel: string): NotificationChannelEndpointRow[] {
  return queryEndpoints('WHERE user_id = ? AND channel = ? AND enabled = 1', [
    userId,
    asTrimmedString(channel),
  ]);
}

function setEndpointEnabled(
  userId: number,
  channel: string,
  endpointId: string,
  enabled: boolean,
): boolean {
  const outcome = getConnection()
    .prepare(`
      UPDATE notification_channel_endpoints
      SET enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND channel = ? AND endpoint_id = ?
    `)
    .run(enabled ? 1 : 0, ...endpointKey(userId, channel, endpointId));
  return outcome.changes > 0;
}

function removeEndpoint(userId: number, channel: string, endpointId: string): boolean {
  const outcome = getConnection()
    .prepare(
      'DELETE FROM notification_channel_endpoints WHERE user_id = ? AND channel = ? AND endpoint_id = ?',
    )
    .run(...endpointKey(userId, channel, endpointId));
  return outcome.changes > 0;
}

function touchEndpoint(userId: number, channel: string, endpointId: string): boolean {
  const outcome = getConnection()
    .prepare(`
      UPDATE notification_channel_endpoints
      SET last_seen_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND channel = ? AND endpoint_id = ?
    `)
    .run(...endpointKey(userId, channel, endpointId));
  return outcome.changes > 0;
}

export const notificationChannelEndpointsDb = {
  getEnabledEndpoints,
  getEndpoint,
  getEndpoints,
  parseMetadata,
  removeEndpoint,
  setEndpointEnabled,
  touchEndpoint,
  upsertEndpoint,
};
