import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WebSocket, WebSocketServer } from 'ws';

import { closeConnection, initializeDatabase, projectPermissionsDb, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

type OutboundFrame = {
  readonly kind: string;
  readonly [key: string]: unknown;
};

function isOutboundFrame(value: unknown): value is OutboundFrame {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'kind' in value &&
    typeof value.kind === 'string'
  );
}

function parseOutboundFrame(raw: string): OutboundFrame {
  const parsed: unknown = JSON.parse(raw);
  if (!isOutboundFrame(parsed)) {
    throw new Error(`Expected an outbound websocket frame, received ${raw}`);
  }

  return parsed;
}
class FakeWebSocket extends EventEmitter {
  readyState = 1;
  sent: OutboundFrame[] = [];

  send(value: string): void {
    this.sent.push(parseOutboundFrame(value));
  }
}

const flushMessages = () => new Promise<void>((resolve) => setImmediate(resolve));

test('chat.subscribe recovers GJC approvals from the app session scope', async () => {
  const originalConnection = new FakeWebSocket();
  const reconnectingSocket = new FakeWebSocket();
  const requestedScopes: string[] = [];

  try {
    const run = chatRunRegistry.startRun({
      appSessionId: 'app-gjc-approval',
      provider: 'gjc',
      providerSessionId: 'provider-native-id',
      connection: originalConnection as unknown as WebSocket,
      userId: 'user-1',
    });
    assert.ok(run);

    handleChatConnection(
      reconnectingSocket as unknown as WebSocket,
      { user: { id: 'user-1' } } as never,
      {
        spawnFns: {} as never,
        abortFns: {} as never,
        resolveToolApproval() {},
        getPendingApprovalsForSession: (scope) => {
          requestedScopes.push(scope);
          return [{ requestId: 'approval-1', sessionId: scope, toolName: 'browser' }];
        },
      },
    );

    reconnectingSocket.emit('message', JSON.stringify({
      type: 'chat.subscribe',
      sessions: [{ sessionId: 'app-gjc-approval' }],
    }));
    await flushMessages();

    assert.deepEqual(requestedScopes, ['app-gjc-approval']);
    const subscribed = reconnectingSocket.sent.find((frame) => frame.kind === 'chat_subscribed');
    assert.ok(subscribed);
    assert.deepEqual(subscribed.pendingPermissions, [{
      requestId: 'approval-1',
      sessionId: 'app-gjc-approval',
      toolName: 'browser',
    }]);
  } finally {
    reconnectingSocket.emit('close');
    chatRunRegistry.clearAll();
    connectedClients.clear();
  }
});


async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-websocket-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('chat.send carries the project\'s stored permission policy and ignores what the browser sends', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('policy-session', 'gjc', '/workspace/policy-project');
    projectPermissionsDb.addAllowAlways('/workspace/policy-project', 'bash');
    const socket = new FakeWebSocket();
    let receivedOptions: Record<string, unknown> | undefined;

    handleChatConnection(socket as unknown as WebSocket, { user: { id: 'user-1' } } as never, {
      spawnFns: {
        gjc: (_command, options, writer) => {
          receivedOptions = options;
          (writer as { sendComplete(options: { exitCode: number }): void }).sendComplete({ exitCode: 0 });
          return Promise.resolve();
        },
      },
      abortFns: { gjc: async () => false },
      resolveToolApproval() {},
      getPendingApprovalsForSession: () => [],
      resolveSessionModel: async () => undefined,
    });

    socket.emit('message', JSON.stringify({
      type: 'chat.send',
      sessionId: 'policy-session',
      content: 'run it',
      // A browser cannot widen the policy from the request.
      options: { model: 'default', skipPermissions: true, permissions: { mode: 'bypass', allowAlways: ['eval'] } },
    }));
    await flushMessages();
    await flushMessages();

    assert.deepEqual(receivedOptions?.permissions, { mode: 'ask', allowAlways: ['bash'] });
    assert.equal('skipPermissions' in (receivedOptions ?? {}), false);
    socket.emit('close');
  });
});

test('chat.permission-response with always remembers the provider\'s tool for the project', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('always-session', 'gjc', '/workspace/always-project');
    const socket = new FakeWebSocket();
    const decisions: Array<{ requestId: string; decision: Record<string, unknown> }> = [];

    const run = chatRunRegistry.startRun({
      appSessionId: 'always-session', provider: 'gjc', providerSessionId: null,
      connection: socket as unknown as WebSocket, userId: 'user-1',
    });
    assert.ok(run);
    handleChatConnection(socket as unknown as WebSocket, { user: { id: 'user-1' } } as never, {
      spawnFns: {} as never,
      abortFns: {} as never,
      resolveToolApproval: (requestId, decision) => { decisions.push({ requestId, decision }); },
      getPendingApprovalsForSession: () => [],
    });

    // A second tab on the same session sees the cards too and must see them close.
    const viewer = new FakeWebSocket();
    chatRunRegistry.attachConnection('always-session', viewer as unknown as WebSocket);

    run.writer.send({ kind: 'permission_request', provider: 'gjc', sessionId: 'always-session', requestId: 'perm-1', toolName: 'bash', input: { command: 'ls' } });
    run.writer.send({ kind: 'permission_request', provider: 'gjc', sessionId: 'always-session', requestId: 'perm-2', toolName: 'eval', input: {} });
    assert.equal(chatRunRegistry.listRunningRuns()[0]?.awaitingInput, true);

    // The browser's own tool name is not trusted; the server uses the one it recorded.
    socket.emit('message', JSON.stringify({ type: 'chat.permission-response', requestId: 'perm-1', allow: true, always: true, toolName: 'rm' }));
    // "Always" with a denial stores nothing, but it is forwarded: the runtime
    // answers reject_always and stops asking for the rest of the run.
    socket.emit('message', JSON.stringify({ type: 'chat.permission-response', requestId: 'perm-2', allow: false, always: true }));
    await flushMessages();

    assert.deepEqual(projectPermissionsDb.get('/workspace/always-project').allow_always, ['bash']);
    assert.deepEqual(decisions.map(({ requestId, decision }) => [requestId, decision.allow, decision.always]), [
      ['perm-1', true, true],
      ['perm-2', false, true],
    ]);
    assert.equal(chatRunRegistry.listRunningRuns()[0]?.awaitingInput, false);
    const closedFor = (frames: OutboundFrame[]) => frames.filter((frame) => frame.kind === 'permission_cancelled').map((frame) => frame.requestId);
    assert.deepEqual(closedFor(viewer.sent), ['perm-1', 'perm-2']);
    assert.deepEqual(closedFor(socket.sent), ['perm-1', 'perm-2']);
    socket.emit('close');
  });
});

test('chat.send prefers the session\'s persisted model choice over the client\'s global default', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('model-override-session', 'gjc', '/workspace/model-project');
    let receivedOptions: Record<string, unknown> | undefined;
    let resolverArgs: unknown[] = [];

    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    try {
      await once(server, 'listening');
      server.on('connection', (socket, request) => {
        handleChatConnection(
          socket,
          Object.assign(request, { user: { id: 'test-user' } }),
          {
            spawnFns: {
              gjc: (_command, options, writer) => {
                receivedOptions = options;
                (writer as { sendComplete(options: { exitCode: number }): void }).sendComplete({ exitCode: 0 });
                return Promise.resolve();
              },
            },
            abortFns: { gjc: async () => false },
            resolveToolApproval() {},
            getPendingApprovalsForSession: () => [],
            resolveSessionModel: async (...args: unknown[]) => {
              resolverArgs = args;
              return 'anthropic/claude-opus-5';
            },
          },
        );
      });

      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected the websocket test server to bind a TCP port.');
      }

      const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
      try {
        await once(client, 'open');
        const completed = new Promise<void>((resolve, reject) => {
          client.on('message', (raw) => {
            try {
              if (parseOutboundFrame(String(raw)).kind === 'complete') resolve();
            } catch (error) {
              reject(error);
            }
          });
        });

        client.send(JSON.stringify({
          type: 'chat.send',
          sessionId: 'model-override-session',
          content: 'use my session model',
          options: { model: 'default' },
        }));
        await completed;

        // A session with no provider id yet is on its first turn, and the resolver is told so.
        assert.deepEqual(resolverArgs, ['gjc', 'model-override-session', 'default', { firstTurn: true }]);
        assert.equal(receivedOptions?.model, 'anthropic/claude-opus-5');
      } finally {
        client.terminate();
      }
    } finally {
      for (const client of server.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});

test('chat.send dispatches a non-Git GJC session directly in its persisted project directory', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('non-git-session', 'gjc', '/workspace/non-git-project');
    let receivedCommand = '';
    let receivedOptions: Record<string, unknown> | undefined;

    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    try {
      await once(server, 'listening');
      server.on('connection', (socket, request) => {
        handleChatConnection(
          socket,
          Object.assign(request, { user: { id: 'test-user' } }),
          {
            spawnFns: {
              gjc: (command, options, writer) => {
                receivedCommand = command;
                receivedOptions = options;
                const chatWriter = writer as {
                  send(message: unknown): void;
                  sendComplete(options: { exitCode: number }): void;
                };
                chatWriter.send({
                  kind: 'assistant',
                  provider: 'gjc',
                  sessionId: 'direct-worker-session',
                  content: 'streamed directly',
                });
                chatWriter.sendComplete({ exitCode: 0 });
                return Promise.resolve();
              },
            },
            abortFns: { gjc: async () => false },
            resolveToolApproval() {},
            getPendingApprovalsForSession: () => [],
          },
        );
      });

      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected the websocket test server to bind a TCP port.');
      }

      const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
      try {
        await once(client, 'open');
        const frames: OutboundFrame[] = [];
        const completed = new Promise<void>((resolve, reject) => {
          client.on('message', (raw) => {
            try {
              const frame = parseOutboundFrame(String(raw));
              frames.push(frame);
              if (frame.kind === 'complete') {
                resolve();
              }
            } catch (error) {
              reject(error);
            }
          });
        });

        client.send(JSON.stringify({
          type: 'chat.send',
          sessionId: 'non-git-session',
          content: 'run directly',
          options: {
            cwd: '/client-controlled-directory',
            projectPath: '/client-controlled-project',
          },
        }));
        await completed;

        assert.equal(receivedCommand, 'run directly');
        assert.equal(receivedOptions?.cwd, '/workspace/non-git-project');
        assert.equal(receivedOptions?.projectPath, '/workspace/non-git-project');
        assert.deepEqual(
          frames.map((frame) => frame.kind),
          ['assistant', 'complete'],
        );
        assert.equal(frames[0]?.content, 'streamed directly');
        assert.equal(frames[0]?.sessionId, 'non-git-session');
        assert.equal(frames[1]?.success, true);
      } finally {
        client.terminate();
      }
    } finally {
      for (const client of server.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});

test('a runtime that reported its own failure does not get a second error bubble', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('failing-session', 'gjc', '/workspace/failing-project');

    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    try {
      await once(server, 'listening');
      server.on('connection', (socket, request) => {
        handleChatConnection(
          socket,
          Object.assign(request, { user: { id: 'test-user' } }),
          {
            spawnFns: {
              // This is what the GJC supervisor does on a failed run: forward
              // the error and the terminal complete, then reject the promise.
              gjc: (_command, _options, writer) => {
                const chatWriter = writer as {
                  send(message: unknown): void;
                  sendComplete(options: { exitCode: number }): void;
                };
                chatWriter.send({
                  kind: 'error',
                  provider: 'gjc',
                  sessionId: 'failing-session',
                  content: 'GJC worker failed.',
                });
                chatWriter.sendComplete({ exitCode: 1 });
                return Promise.reject(new Error('GJC worker failed.'));
              },
            },
            abortFns: { gjc: async () => false },
            resolveToolApproval() {},
            getPendingApprovalsForSession: () => [],
          },
        );
      });

      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected the websocket test server to bind a TCP port.');
      }

      const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
      try {
        await once(client, 'open');
        const frames: OutboundFrame[] = [];
        const completed = new Promise<void>((resolve, reject) => {
          client.on('message', (raw) => {
            try {
              const frame = parseOutboundFrame(String(raw));
              frames.push(frame);
              if (frame.kind === 'complete') {
                resolve();
              }
            } catch (error) {
              reject(error);
            }
          });
        });

        client.send(JSON.stringify({
          type: 'chat.send',
          sessionId: 'failing-session',
          content: 'fail please',
          options: {},
        }));
        await completed;
        // The rejection is handled after the terminal frame, so give the
        // catch branch a turn before asserting nothing else arrived.
        await flushMessages();
        await flushMessages();

        assert.deepEqual(frames.map((frame) => frame.kind), ['error', 'complete']);
        assert.equal(frames[0]?.content, 'GJC worker failed.');
      } finally {
        client.terminate();
      }
    } finally {
      for (const client of server.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});

test('chat.abort uses the direct GJC run handle before the app session id', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('abort-session', 'gjc', '/workspace/non-git-project');
    const abortHandles: string[] = [];
    let startRun: (() => void) | undefined;
    let resolveRun: (() => void) | undefined;
    const providerRun = new Promise<void>((resolve) => {
      resolveRun = resolve;
    }) as Promise<void> & { abortHandle: string };
    providerRun.abortHandle = 'run-transient-handle';

    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    try {
      await once(server, 'listening');
      server.on('connection', (socket, request) => {
        handleChatConnection(
          socket,
          Object.assign(request, { user: { id: 'test-user' } }),
          {
            spawnFns: {
              gjc: () => {
                startRun?.();
                return providerRun;
              },
            },
            abortFns: {
              gjc: async (abortHandle) => {
                abortHandles.push(abortHandle);
                return true;
              },
            },
            resolveToolApproval() {},
            getPendingApprovalsForSession: () => [],
          },
        );
      });

      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected the websocket test server to bind a TCP port.');
      }

      const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
      try {
        await once(client, 'open');
        const spawned = new Promise<void>((resolve) => {
          startRun = resolve;
        });
        client.send(JSON.stringify({
          type: 'chat.send',
          sessionId: 'abort-session',
          content: 'start direct run',
        }));
        await spawned;

        const completed = new Promise<OutboundFrame>((resolve, reject) => {
          client.on('message', (raw) => {
            try {
              const frame = parseOutboundFrame(String(raw));
              if (frame.kind === 'complete') {
                resolve(frame);
              }
            } catch (error) {
              reject(error);
            }
          });
        });
        client.send(JSON.stringify({ type: 'chat.abort', sessionId: 'abort-session' }));
        const complete = await completed;

        assert.deepEqual(abortHandles, ['run-transient-handle']);
        assert.equal(complete.aborted, true);
      } finally {
        resolveRun?.();
        client.terminate();
      }
    } finally {
      for (const client of server.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});

test('gjc.job.resume is rejected as an unknown message type', async () => {
  await withIsolatedDatabase(async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    try {
      await once(server, 'listening');
      server.on('connection', (socket, request) => {
        handleChatConnection(
          socket,
          Object.assign(request, { user: { id: 'test-user' } }),
          {
            spawnFns: { gjc: async () => undefined },
            abortFns: { gjc: async () => false },
            resolveToolApproval() {},
            getPendingApprovalsForSession: () => [],
          },
        );
      });

      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected the websocket test server to bind a TCP port.');
      }

      const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
      try {
        await once(client, 'open');
        const protocolError = new Promise<OutboundFrame>((resolve, reject) => {
          client.on('message', (raw) => {
            try {
              const frame = parseOutboundFrame(String(raw));
              if (frame.kind === 'protocol_error') {
                resolve(frame);
              }
            } catch (error) {
              reject(error);
            }
          });
        });
        client.send(JSON.stringify({
          type: 'gjc.job.resume',
          sessionId: 'ignored',
          content: 'resume',
        }));
        const frame = await protocolError;

        assert.equal(frame.code, 'UNKNOWN_MESSAGE_TYPE');
      } finally {
        client.terminate();
      }
    } finally {
      for (const client of server.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
test('OAuth websocket requests and events use the global supervisor without exposing submitted values', async () => {
  const socket = new FakeWebSocket();
  const calls: Array<{ method: string; attemptId?: string; value?: string }> = [];
  let emitOAuth: ((event: { method: 'oauth.phase'; payload: Record<string, unknown> }) => void) | undefined;
  handleChatConnection(
    socket as unknown as WebSocket,
    { user: { id: 'oauth-user' } } as never,
    {
      spawnFns: {} as never,
      abortFns: {} as never,
      resolveToolApproval() {},
      getPendingApprovalsForSession: () => [],
      oauthSupervisor: {
        oauthProviders: async () => ({
          ok: true,
          result: { providers: [{ id: 'openai', name: 'OpenAI', available: true, authenticated: false }] },
        }),
        oauthStatus: async () => ({ ok: true, result: { activeAttempt: null } }),
        oauthStart: async (providerId) => {
          calls.push({ method: 'start', value: providerId });
          return { ok: true, result: { attemptId: 'attempt-1', providerId, phase: 'starting' } };
        },
        oauthSubmit: async (attemptId, value) => {
          calls.push({ method: 'submit', attemptId, value });
          return { ok: true, result: { attemptId, providerId: 'openai', phase: 'persisting' } };
        },
        oauthCancel: async (attemptId) => {
          calls.push({ method: 'cancel', attemptId });
          return { ok: true, result: { attemptId, providerId: 'openai', phase: 'cancelled' } };
        },
        subscribeOAuth(listener) {
          emitOAuth = listener as typeof emitOAuth;
          return () => {
            emitOAuth = undefined;
          };
        },
      },
    },
  );

  socket.emit('message', JSON.stringify({ type: 'oauth.providers' }));
  socket.emit('message', JSON.stringify({ type: 'oauth.start', providerId: 'openai' }));
  await flushMessages();
  socket.emit('message', JSON.stringify({
    type: 'oauth.submit',
    attemptId: 'attempt-1',
    value: 'secret-callback-value',
  }));
  await flushMessages();

  emitOAuth?.({
    method: 'oauth.phase',
    payload: { attemptId: 'attempt-1', providerId: 'openai', phase: 'completed' },
  });

  assert.equal(socket.sent[0]?.kind, 'oauth.providers');
  assert.equal(socket.sent[1]?.kind, 'oauth.start');
  assert.equal(socket.sent[2]?.kind, 'oauth.submit');
  assert.equal(socket.sent[3]?.kind, 'oauth.phase');
  assert.deepEqual(calls, [
    { method: 'start', value: 'openai' },
    { method: 'submit', attemptId: 'attempt-1', value: 'secret-callback-value' },
  ]);
  assert.equal(JSON.stringify(socket.sent).includes('secret-callback-value'), false);

  socket.emit('close');
  assert.equal(emitOAuth, undefined);
});
test('OAuth attempt control and phase events are isolated to the authenticated owner', async () => {
  const owner = new FakeWebSocket();
  const otherUser = new FakeWebSocket();
  let submitCalls = 0;
  const listeners = new Set<(event: { method: 'oauth.phase'; payload: Record<string, unknown> }) => void>();
  const oauthSupervisor = {
    oauthProviders: async () => ({ ok: true, result: { providers: [] } }),
    oauthStatus: async () => ({
      ok: true,
      result: {
        providers: [],
        attempt: { attemptId: 'owned-attempt', providerId: 'openai', phase: 'awaiting_input' },
      },
    }),
    oauthStart: async () => ({
      ok: true,
      result: { attemptId: 'owned-attempt', providerId: 'openai', phase: 'starting' },
    }),
    oauthSubmit: async () => {
      submitCalls += 1;
      return { ok: true };
    },
    oauthCancel: async () => ({ ok: true }),
    subscribeOAuth(listener: (event: { method: 'oauth.phase'; payload: Record<string, unknown> }) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const dependencies = {
    spawnFns: {} as never,
    abortFns: {} as never,
    resolveToolApproval() {},
    getPendingApprovalsForSession: () => [],
    oauthSupervisor,
  };

  handleChatConnection(owner as unknown as WebSocket, { user: { id: 'owner' } } as never, dependencies);
  handleChatConnection(otherUser as unknown as WebSocket, { user: { id: 'other' } } as never, dependencies);
  owner.emit('message', JSON.stringify({ type: 'oauth.start', providerId: 'openai' }));
  await flushMessages();

  otherUser.emit('message', JSON.stringify({
    type: 'oauth.submit',
    attemptId: 'owned-attempt',
    value: 'must-not-cross-owner-boundary',
  }));
  otherUser.emit('message', JSON.stringify({ type: 'oauth.status' }));
  await flushMessages();
  for (const listener of listeners) {
    listener({
      method: 'oauth.phase',
      payload: { attemptId: 'owned-attempt', providerId: 'openai', phase: 'completed' },
    });
  }

  assert.equal(submitCalls, 0);
  assert.equal((otherUser.sent[0]?.payload as Record<string, unknown>).error instanceof Object, true);
  assert.equal((((otherUser.sent[0]?.payload as Record<string, unknown>).error) as Record<string, unknown>).code, 'oauth_attempt_not_owner');
  assert.equal(((otherUser.sent[1]?.payload as Record<string, unknown>).result as Record<string, unknown>).attempt, undefined);
  assert.equal(otherUser.sent.some((frame) => frame.kind === 'oauth.phase'), false);
  assert.equal(owner.sent.some((frame) => frame.kind === 'oauth.phase'), true);
  assert.equal(JSON.stringify(otherUser.sent).includes('must-not-cross-owner-boundary'), false);

  owner.emit('close');
  otherUser.emit('close');
});

test('raw login commands are rejected before a provider run starts', async () => {
  const socket = new FakeWebSocket();
  let spawned = false;
  handleChatConnection(
    socket as unknown as WebSocket,
    { user: { id: 'oauth-user' } } as never,
    {
      spawnFns: {
        gjc: async () => {
          spawned = true;
        },
      } as never,
      abortFns: {} as never,
      resolveToolApproval() {},
      getPendingApprovalsForSession: () => [],
      oauthSupervisor: {
        oauthProviders: async () => ({ ok: true }),
        oauthStatus: async () => ({ ok: true }),
        oauthStart: async () => ({ ok: true }),
        oauthSubmit: async () => ({ ok: true }),
        oauthCancel: async () => ({ ok: true }),
        subscribeOAuth: () => () => {},
      },
    },
  );

  socket.emit('message', JSON.stringify({
    type: 'chat.send',
    sessionId: 'missing-session-is-never-resolved',
    content: '/login openai',
  }));
  await flushMessages();

  assert.equal(spawned, false);
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0]?.kind, 'protocol_error');
  assert.equal(socket.sent[0]?.code, 'LOGIN_UI_REQUIRED');
});
