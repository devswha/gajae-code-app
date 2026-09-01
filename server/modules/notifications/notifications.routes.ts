import express from 'express';

import { notificationChannelEndpointsDb, notificationPreferencesDb } from '@/modules/database/index.js';

const router = express.Router();

const trimmed = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

function userIdFrom(request: express.Request): number {
  const id = Number((request as { user?: { id?: unknown } }).user?.id);
  if (Number.isInteger(id) && id > 0) return id;
  throw new Error('Authenticated user is missing');
}

function publicEndpoint(row: any) {
  const { id, channel, endpoint_id: endpointId, label, metadata_json, enabled, last_seen_at, created_at, updated_at } = row;
  return {
    id,
    channel,
    endpointId,
    label,
    metadata: notificationChannelEndpointsDb.parseMetadata(metadata_json),
    enabled: Boolean(enabled),
    lastSeenAt: last_seen_at,
    createdAt: created_at,
    updatedAt: updated_at,
  };
}

function synchronizeChannelPreference(userId: number, channel: string): unknown {
  const preferences = notificationPreferencesDb.getPreferences(userId);
  const active = notificationChannelEndpointsDb.getEnabledEndpoints(userId, channel);
  return notificationPreferencesDb.updatePreferences(userId, {
    ...preferences,
    channels: { ...preferences.channels, [channel]: active.length !== 0 },
  });
}

function endpointFailure(
  response: express.Response,
  error: unknown,
  message: string,
  action: string,
): express.Response {
  console.error(message, error);
  return response.status(500).json({ error: action });
}

router.get('/endpoints', (request, response) => {
  const channel = trimmed(request.query.channel);
  if (!channel) return response.status(400).json({ error: 'channel is required' });

  try {
    const endpoints = notificationChannelEndpointsDb.getEndpoints(userIdFrom(request), channel).map(publicEndpoint);
    return response.json({ success: true, endpoints });
  } catch (error) {
    return endpointFailure(response, error, 'Error fetching notification endpoints:', 'Failed to fetch notification endpoints');
  }
});

router.post('/endpoints/current', (request, response) => {
  const body = request.body || {};
  const channel = trimmed(body.channel);
  const endpointId = trimmed(body.endpointId);
  if (!channel || !endpointId) {
    return response.status(400).json({ error: 'channel and endpointId are required' });
  }

  try {
    const userId = userIdFrom(request);
    const endpoint = notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel,
      endpointId,
      label: body.label,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      enabled: body.enabled !== false,
    });
    return response.json({
      success: true,
      endpoint: publicEndpoint(endpoint),
      preferences: synchronizeChannelPreference(userId, channel),
    });
  } catch (error) {
    return endpointFailure(response, error, 'Error registering notification endpoint:', 'Failed to register notification endpoint');
  }
});

router.patch('/endpoints/:channel/:endpointId', (request, response) => {
  if (typeof request.body?.enabled !== 'boolean') {
    return response.status(400).json({ error: 'enabled must be a boolean' });
  }

  try {
    const userId = userIdFrom(request);
    const { channel, endpointId } = request.params;
    if (!notificationChannelEndpointsDb.setEndpointEnabled(userId, channel, endpointId, request.body.enabled)) {
      return response.status(404).json({ error: 'Notification endpoint not found' });
    }
    const endpoint = notificationChannelEndpointsDb.getEndpoint(userId, channel, endpointId);
    return response.json({
      success: true,
      endpoint: endpoint ? publicEndpoint(endpoint) : null,
      preferences: synchronizeChannelPreference(userId, channel),
    });
  } catch (error) {
    return endpointFailure(response, error, 'Error updating notification endpoint:', 'Failed to update notification endpoint');
  }
});

router.delete('/endpoints/:channel/:endpointId', (request, response) => {
  try {
    const userId = userIdFrom(request);
    const { channel, endpointId } = request.params;
    if (!notificationChannelEndpointsDb.removeEndpoint(userId, channel, endpointId)) {
      return response.status(404).json({ error: 'Notification endpoint not found' });
    }
    return response.json({ success: true, preferences: synchronizeChannelPreference(userId, channel) });
  } catch (error) {
    return endpointFailure(response, error, 'Error removing notification endpoint:', 'Failed to remove notification endpoint');
  }
});

export default router;
