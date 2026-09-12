import { Router, type Request, type Response } from 'express';

import { GJC_BROWSER_BACKENDS } from '@/gjc-engine.js';
import { asyncHandler } from '@/shared/utils.js';

import { safeSessionId, type BrowserCommand } from './browser-protocol.js';
import { isCuaSafeTool } from './cua-client.js';
import { automationService, type AutomationService } from './automation.service.js';
import { discoverLocalDevelopmentUrls } from './local-sites.js';
import { parseAutomationGrantFilter } from './automation-grants.js';

function errorResponse(response: Response, error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Automation request failed.';
  const status = /not installed|browser_in_use|browser_busy|observation_required|document_changed|binding_changed|stale/iu.test(message)
    ? 409
    : /not found/iu.test(message)
      ? 404
      : /not available|unavailable|unsupported/iu.test(message)
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

function registerBrowserRoutes(router: Router, prefix: string, service: AutomationService): void {
  router.get(`${prefix}/:sessionId`, asyncHandler(async (request, response) => {
    const id = sessionId(request, response);
    if (!id) return;
    try { response.json(await service.browser.state(id)); }
    catch (error) { errorResponse(response, error); }
  }));
  router.post(`${prefix}/:sessionId/open`, asyncHandler(async (request, response) => {
    const id = sessionId(request, response);
    if (!id) return;
    try {
      response.json(await service.openBrowser(id, {
        ...(typeof request.body?.url === 'string' ? { url: request.body.url } : {}),
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  }));

  router.post(`${prefix}/:sessionId/command`, asyncHandler(async (request, response) => {
    const id = sessionId(request, response);
    if (!id) return;
    try {
      response.json(await service.commandBrowser(id, request.body?.command as BrowserCommand, undefined, request.body?.expected));
    } catch (error) {
      errorResponse(response, error);
    }
  }));

  router.delete(`${prefix}/:sessionId`, asyncHandler(async (request, response) => {
    const id = sessionId(request, response);
    if (!id) return;
    try {
      response.json(await service.stopSession(id));
    } catch (error) {
      errorResponse(response, error);
    }
  }));
}

export function createBrowserAutomationRouter(service: AutomationService = automationService): Router {
  const router = Router();
  registerBrowserRoutes(router, '', service);
  return router;
}

export function createAutomationRouter(service: AutomationService = automationService): Router {
  const router = Router();
  router.get('/status', asyncHandler(async (_request, response) => {
    try {
      response.json(await service.status());
    } catch (error) {
      errorResponse(response, error);
    }
  }));

  // The browser backend GJC sessions start with. Stored as the app's own
  // setting; the worker hands it to the runtime's `browser.backend`.
  router.get('/browser-backend', asyncHandler((_request, response) => {
    response.json({ backend: service.browserBackend.get(), backends: GJC_BROWSER_BACKENDS });
  }));

  router.put('/browser-backend', asyncHandler((request, response) => {
    try {
      response.json({ backend: service.browserBackend.set(request.body?.backend), backends: GJC_BROWSER_BACKENDS });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : 'Invalid browser backend.' });
    }
  }));

  router.get('/local-sites', asyncHandler(async (request, response) => {
    try {
      const localPort = request.socket.localPort;
      response.json({
        urls: await discoverLocalDevelopmentUrls(new Set(localPort ? [localPort] : [])),
      });
    } catch (error) {
      errorResponse(response, error);
    }
  }));

  router.post('/computer/:sessionId/call', asyncHandler(async (request, response) => {
    const id = sessionId(request, response);
    if (!id) return;
    if (!isCuaSafeTool(request.body?.tool)) {
      response.status(400).json({ error: 'Unsupported CUA Driver tool.' });
      return;
    }
    try {
      response.json(await service.callComputer(id, request.body.tool, request.body?.arguments ?? {}));
    } catch (error) {
      errorResponse(response, error);
    }
  }));

  router.get('/grants', asyncHandler((request, response) => {
    const id = typeof request.query.sessionId === 'string' && safeSessionId(request.query.sessionId)
      ? request.query.sessionId
      : undefined;
    response.json(service.grants.list(id));
  }));

  router.post('/grants', asyncHandler((request, response) => {
    const { kind, value, scope, sessionId: requestedSessionId } = request.body ?? {};
    if ((kind !== 'origin' && kind !== 'application') || (scope !== 'session' && scope !== 'always')
        || typeof value !== 'string' || !value || value.length > 512
        || (scope === 'session' && !safeSessionId(requestedSessionId))) {
      response.status(400).json({ error: 'Invalid automation grant.' });
      return;
    }
    try {
      service.grant({ kind, value, scope, ...(scope === 'session' ? { sessionId: requestedSessionId } : {}) });
      response.json(service.grants.list(scope === 'session' ? requestedSessionId : undefined));
    } catch (error) {
      errorResponse(response, error);
    }
  }));

  router.delete('/grants', asyncHandler((request, response) => {
    try {
      const filter = parseAutomationGrantFilter(request.body ?? {});
      service.grants.revoke(filter);
      response.json(service.grants.list(filter.sessionId));
    } catch (error) {
      errorResponse(response, error);
    }
  }));

  return router;
}

export default createAutomationRouter();
