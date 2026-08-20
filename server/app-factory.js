import http from 'node:http';

import cors from 'cors';
import express from 'express';

import { createDesktopAuth, DESKTOP_BOOTSTRAP_PATH } from './middleware/desktop-auth.js';
import { createWebSocketServer } from './modules/websocket/index.js';
import { createGjcJobsRouter } from './routes/gjc-jobs.js';

/**
 * Builds the production GJC HTTP and WebSocket composition with explicit
 * dependencies so integration tests exercise the same route and gateway.
 */
export function createGjcAppFactory({
  authority,
  orchestrator,
  gitService,
  projection,
  terminalNotificationAdapter,
  authenticateWebSocket,
  authenticateGjcRoute,
  validateApiKey,
  chat,
  shell,
  browser = undefined,
}) {
  orchestrator.deps.broadcast = (jobId, event) => {
    try { projection.publish(jobId, event); } catch { /* Durable replay recovers isolated websocket fan-out failures. */ }
    try { terminalNotificationAdapter?.onCommittedEvent(jobId, event); } catch { /* Notification delivery is isolated from durable job state. */ }
  };
  void terminalNotificationAdapter?.startupCatchUp().catch(() => {});

  const app = express();
  app.set('trust proxy', 1);
  const server = http.createServer(app);
  const desktopAuth = createDesktopAuth({ server });
  const wss = createWebSocketServer(server, {
    verifyClient: { authenticateWebSocket, desktopAuth },
    chat,
    shell,
    browser,
  });
  app.locals.wss = wss;
  app.use(cors(desktopAuth.corsOptions ?? undefined));
  if (desktopAuth.enabled) {
    app.get(DESKTOP_BOOTSTRAP_PATH, desktopAuth.bootstrap);
    app.use((request, response, next) => {
      if (request.path === '/health') {
        return next();
      }
      return request.path === '/api' || request.path.startsWith('/api/')
        ? desktopAuth.authenticateHttp(request, response, next)
        : desktopAuth.authenticatePage(request, response, next);
    });
  }
  app.use(express.json({
    limit: '50mb',
    type: (req) => {
      const contentType = req.headers['content-type'] || '';
      return !contentType.includes('multipart/form-data') && contentType.includes('json');
    },
  }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use('/api', validateApiKey);
  app.use('/api/gjc', authenticateGjcRoute, createGjcJobsRouter({ authority, orchestrator, gitService }));

  return { app, server, wss };
}
