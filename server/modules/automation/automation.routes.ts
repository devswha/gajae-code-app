import { Router, type Request, type Response } from 'express';

import { safeSessionId, type BrowserCommand, type BrowserInput } from './browser-protocol.js';
import { isCuaSafeTool } from './cua-client.js';
import { automationService } from './automation.service.js';
import { discoverLocalDevelopmentUrls } from './local-sites.js';

const router = Router();

function errorResponse(response: Response, error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Automation request failed.';
  const status = /not installed|download_required/iu.test(message)
    ? 409
    : /not found/iu.test(message)
      ? 404
      : /not available|unsupported/iu.test(message)
        ? 501
        : 400;
  return response.status(status).json({ error: message });
}

function sessionId(request: Request, response: Response): string | null {
  const value = request.params.sessionId;
  if (!safeSessionId(value)) {
    response.status(400).json({ error: 'Invalid automation session id.' });
    return null;
  }
  return value;
}

router.get('/status', async (_request, response) => {
  try {
    response.json(await automationService.status());
  } catch (error) {
    errorResponse(response, error);
  }
});

router.get('/local-sites', async (request, response) => {
  try {
    const localPort = request.socket.localPort;
    response.json({
      urls: await discoverLocalDevelopmentUrls(new Set(localPort ? [localPort] : [])),
    });
  } catch (error) {
    errorResponse(response, error);
  }
});

router.post('/browser/:sessionId/open', async (request, response) => {
  const id = sessionId(request, response);
  if (!id) return;
  try {
    response.json(await automationService.openBrowser(id, {
      ...(typeof request.body?.url === 'string' ? { url: request.body.url } : {}),
      allowDownload: request.body?.allowDownload === true,
      ...(typeof request.body?.waitUntil === 'string' ? { waitUntil: request.body.waitUntil } : {}),
    }));
  } catch (error) {
    errorResponse(response, error);
  }
});

router.post('/browser/:sessionId/command', async (request, response) => {
  const id = sessionId(request, response);
  if (!id) return;
  try {
    response.json(await automationService.commandBrowser(id, request.body?.command as BrowserCommand));
  } catch (error) {
    errorResponse(response, error);
  }
});

router.post('/browser/:sessionId/input', async (request, response) => {
  const id = sessionId(request, response);
  if (!id) return;
  try {
    response.json(await automationService.inputBrowser(id, request.body?.input as BrowserInput));
  } catch (error) {
    errorResponse(response, error);
  }
});

router.delete('/browser/:sessionId', async (request, response) => {
  const id = sessionId(request, response);
  if (!id) return;
  try {
    response.json(await automationService.stopSession(id));
  } catch (error) {
    errorResponse(response, error);
  }
});

router.post('/computer/:sessionId/call', async (request, response) => {
  const id = sessionId(request, response);
  if (!id) return;
  if (!isCuaSafeTool(request.body?.tool)) {
    response.status(400).json({ error: 'Unsupported CUA Driver tool.' });
    return;
  }
  try {
    response.json(await automationService.callComputer(id, request.body.tool, request.body?.arguments ?? {}));
  } catch (error) {
    errorResponse(response, error);
  }
});

router.get('/grants', (request, response) => {
  const id = typeof request.query.sessionId === 'string' && safeSessionId(request.query.sessionId)
    ? request.query.sessionId
    : undefined;
  response.json(automationService.grants.list(id));
});

router.post('/grants', (request, response) => {
  const { kind, value, scope, sessionId: requestedSessionId } = request.body ?? {};
  if ((kind !== 'origin' && kind !== 'application') || (scope !== 'session' && scope !== 'always')
      || typeof value !== 'string' || !value || value.length > 512
      || (scope === 'session' && !safeSessionId(requestedSessionId))) {
    response.status(400).json({ error: 'Invalid automation grant.' });
    return;
  }
  try {
    automationService.grant({ kind, value, scope, ...(scope === 'session' ? { sessionId: requestedSessionId } : {}) });
    response.json(automationService.grants.list(scope === 'session' ? requestedSessionId : undefined));
  } catch (error) {
    errorResponse(response, error);
  }
});

router.delete('/grants', (request, response) => {
  automationService.grants.revoke(request.body ?? {});
  response.json(automationService.grants.list(typeof request.body?.sessionId === 'string' ? request.body.sessionId : undefined));
});

export default router;
