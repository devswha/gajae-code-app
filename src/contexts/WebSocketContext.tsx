import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  GJC_JOB_PROJECTION_PROTOCOL_VERSION,
  isJobProjectionInboundFrame,
  isJobProjectionOutboundFrame,
  type JobProjectionErrorCode,
  type JobProjectionEvent,
  type JobProjectionInboundFrame,
  type JobSnapshot,
} from '../../shared/gjc-job-projection-protocol';
import { useAuth } from '../components/auth/context/AuthContext';

/**
 * One frame received from the chat websocket. The server guarantees every
 * frame carries a `kind` (provider message kinds plus gateway kinds such as
 * `chat_subscribed`, `session_upserted`, `loading_progress`, and
 * `protocol_error`). The synthetic `websocket_reconnected` kind is injected
 * client-side when the socket re-opens after a drop.
 */
export type ServerEvent = {
  kind?: string;
  type?: string;
  sessionId?: string;
  seq?: number;
  [key: string]: unknown;
};


type JobSubscription = {
  jobId: string;
  getCursor: () => number;
  onSubscribed: (snapshot: JobSnapshot) => void;
  applyReplayChunk: (events: JobProjectionEvent[]) => boolean;
  applyLiveEvent: (event: JobProjectionEvent) => boolean;
  onError: (code: JobProjectionErrorCode | 'protocol_violation') => void;
};

type JobSubscriptionIntent = JobSubscription & { owners: number; subscriptionId: string | null; watermark: number | null; generation: number };
type ServerEventListener = (event: ServerEvent) => void;

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  subscribe: (listener: ServerEventListener) => () => void;
  registerJobSubscription: (subscription: JobSubscription) => () => void;
  latestMessage: ServerEvent | null;
  isConnected: boolean;
  isServerDraining: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) throw new Error('useWebSocket must be used within a WebSocketProvider');
  return context;
};
export const isServerDrainingCloseEvent = ({ code, reason }: Pick<CloseEvent, 'code' | 'reason'>) =>
  code === 1001 && reason === 'server-draining';

export const ServerDrainingOverlay = ({ isServerDraining }: { isServerDraining: boolean }) => {
  if (!isServerDraining) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="server-draining-title"
      aria-describedby="server-draining-description"
      aria-live="assertive"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        display: 'grid',
        placeItems: 'center',
        padding: '1.5rem',
        background: 'rgba(0, 0, 0, 0.72)',
      }}
    >
      <section
        style={{
          maxWidth: '32rem',
          padding: '2rem',
          borderRadius: '0.75rem',
          background: 'var(--background, #fff)',
          color: 'var(--foreground, #111)',
          boxShadow: '0 1rem 3rem rgba(0, 0, 0, 0.35)',
        }}
      >
        <h1 id="server-draining-title">Server is shutting down</h1>
        <p id="server-draining-description">
          The server is cleaning up active work. Your job state is preserved and will be available when the server returns.
        </p>
      </section>
    </div>
  );
};

const buildWebSocketUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const socketGenerationRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const hasConnectedRef = useRef(false);
  const listenersRef = useRef(new Set<ServerEventListener>());
  const jobIntentsRef = useRef(new Map<string, JobSubscriptionIntent>());
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [latestMessage, setLatestMessage] = useState<ServerEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { user } = useAuth();
  const authenticatedUserRef = useRef(user);
  const isServerDrainingRef = useRef(false);
  const [isServerDraining, setIsServerDraining] = useState(false);

  const dispatch = useCallback((event: ServerEvent) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    }
    setLatestMessage(event);
  }, []);

  const clearReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const sendJobFrame = useCallback((frame: JobProjectionInboundFrame) => {
    if (!isJobProjectionInboundFrame(frame)) return;
    const activeSocket = wsRef.current;
    if (activeSocket?.readyState === WebSocket.OPEN) activeSocket.send(JSON.stringify(frame));
  }, []);
  const subscribeJobsForGeneration = useCallback((generation: number) => {
    for (const intent of jobIntentsRef.current.values()) {
      intent.generation = generation;
      intent.subscriptionId = null;
      intent.watermark = null;
      sendJobFrame({
        protocolVersion: GJC_JOB_PROJECTION_PROTOCOL_VERSION,
        type: 'gjc.job.subscribe',
        jobId: intent.jobId,
        after: intent.getCursor(),
      });
    }
  }, [sendJobFrame]);

  const connect = useCallback((generation: number, isAuthenticated: boolean) => {
    if (unmountedRef.current || socketGenerationRef.current !== generation || !isAuthenticated) return;
    const wsUrl = buildWebSocketUrl();

    try {
      const websocket = new WebSocket(wsUrl);
      // Claim ownership before any asynchronous browser callback can fire.
      wsRef.current = websocket;
      setSocket(websocket);

      const isCurrentSocket = () =>
        !unmountedRef.current && socketGenerationRef.current === generation && wsRef.current === websocket;

      websocket.onopen = () => {
        if (!isCurrentSocket()) return;
        setIsConnected(true);
        if (hasConnectedRef.current) dispatch({ kind: 'websocket_reconnected', timestamp: Date.now() });
        hasConnectedRef.current = true;
        subscribeJobsForGeneration(generation);
      };

      websocket.onmessage = (event) => {
        if (!isCurrentSocket()) return;
        try {
          const message: unknown = JSON.parse(event.data);
          if (isJobProjectionOutboundFrame(message)) {
            const intent = typeof message.jobId === 'string' ? jobIntentsRef.current.get(message.jobId) : undefined;
            if (message.kind === 'gjc_job_subscribed' && intent && intent.generation === generation && intent.subscriptionId === null) {
              intent.subscriptionId = message.subscriptionId;
              intent.watermark = message.watermark;
              intent.onSubscribed(message.snapshot);
              sendJobFrame({
                protocolVersion: GJC_JOB_PROJECTION_PROTOCOL_VERSION,
                type: 'gjc.job.replay',
                jobId: intent.jobId,
                subscriptionId: message.subscriptionId,
                after: intent.getCursor(),
              });
            } else if (intent && intent.generation === generation && intent.subscriptionId === message.subscriptionId) {
              if (message.kind === 'gjc_job_replay_chunk') {
                if (intent.watermark !== message.watermark) {
                  intent.onError('protocol_violation');
                } else {
                  const applied = intent.applyReplayChunk(message.events);
                  if (applied && !message.done && message.nextCursor !== null) {
                    sendJobFrame({
                      protocolVersion: GJC_JOB_PROJECTION_PROTOCOL_VERSION,
                      type: 'gjc.job.replay',
                      jobId: intent.jobId,
                      subscriptionId: message.subscriptionId,
                      after: message.nextCursor,
                    });
                  }
                }
              } else if (message.kind === 'gjc_job_event') {
                intent.applyLiveEvent(message.event);
              } else if (message.kind === 'gjc_job_error') {
                intent.onError(message.code);
              }
            }
          }
          dispatch(message as ServerEvent);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = (event) => {
        if (!isCurrentSocket()) return;
        setIsConnected(false);
        wsRef.current = null;
        setSocket(null);
        clearReconnect();
        if (isServerDrainingCloseEvent(event)) {
          isServerDrainingRef.current = true;
          setIsServerDraining(true);
          return;
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (unmountedRef.current || socketGenerationRef.current !== generation || isServerDrainingRef.current) return;
          connect(generation, isAuthenticated);
        }, 3000);
      };

      websocket.onerror = (event) => {
        if (isCurrentSocket()) console.error('WebSocket error:', event);
      };
    } catch (error) {
      if (socketGenerationRef.current === generation && !unmountedRef.current) {
        console.error('Error creating WebSocket connection:', error);
      }
    }
  }, [clearReconnect, dispatch, sendJobFrame, subscribeJobsForGeneration]);

  useEffect(() => {
    const previousUser = authenticatedUserRef.current;
    const previousUserIdentity = previousUser?.id ?? previousUser?.username ?? null;
    const userIdentity = user?.id ?? user?.username ?? null;
    const isNewAuthenticatedLifecycle = userIdentity !== null && userIdentity !== previousUserIdentity;

    if (previousUser !== user) {
      jobIntentsRef.current.clear();
      authenticatedUserRef.current = user;
    }
    if (isNewAuthenticatedLifecycle) {
      isServerDrainingRef.current = false;
      setIsServerDraining(false);
    }
  }, [user]);
  useEffect(() => {
    unmountedRef.current = false;
    const generation = socketGenerationRef.current + 1;
    socketGenerationRef.current = generation;
    clearReconnect();

    const previousSocket = wsRef.current;
    wsRef.current = null;
    setSocket(null);
    setIsConnected(false);
    previousSocket?.close();
    if (!isServerDrainingRef.current) connect(generation, Boolean(user));

    return () => {
      if (socketGenerationRef.current !== generation) return;
      socketGenerationRef.current += 1;
      clearReconnect();
      const activeSocket = wsRef.current;
      wsRef.current = null;
      setSocket(null);
      setIsConnected(false);
      activeSocket?.close();
    };
  }, [clearReconnect, connect, user]);

  useEffect(() => () => {
    unmountedRef.current = true;
  }, []);

  const sendMessage = useCallback((message: unknown) => {
    const activeSocket = wsRef.current;
    if (activeSocket?.readyState === WebSocket.OPEN) activeSocket.send(JSON.stringify(message));
    else console.warn('WebSocket not connected');
  }, []);

  const subscribe = useCallback((listener: ServerEventListener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);
  const registerJobSubscription = useCallback((subscription: JobSubscription) => {
    const existing = jobIntentsRef.current.get(subscription.jobId);
    if (existing) {
      existing.owners += 1;
      Object.assign(existing, subscription);
    } else {
      jobIntentsRef.current.set(subscription.jobId, {
        ...subscription,
        owners: 1,
        subscriptionId: null,
        watermark: null,
        generation: socketGenerationRef.current,
      });
    }
    const intent = jobIntentsRef.current.get(subscription.jobId)!;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      intent.subscriptionId = null;
      intent.watermark = null;
      sendJobFrame({
        protocolVersion: GJC_JOB_PROJECTION_PROTOCOL_VERSION,
        type: 'gjc.job.subscribe',
        jobId: intent.jobId,
        after: intent.getCursor(),
      });
    }
    return () => {
      const current = jobIntentsRef.current.get(subscription.jobId);
      if (!current) return;
      current.owners -= 1;
      if (current.owners === 0) {
        if (current.subscriptionId) {
          sendJobFrame({
            protocolVersion: GJC_JOB_PROJECTION_PROTOCOL_VERSION,
            type: 'gjc.job.unsubscribe',
            jobId: current.jobId,
            subscriptionId: current.subscriptionId,
          });
        }
        jobIntentsRef.current.delete(subscription.jobId);
      }
    };
  }, [sendJobFrame]);

  return useMemo(() => ({
    ws: socket,
    sendMessage,
    subscribe,
    registerJobSubscription,
    latestMessage,
    isConnected,
    isServerDraining,
  }), [isConnected, isServerDraining, latestMessage, registerJobSubscription, sendMessage, socket, subscribe]);
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();
  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
      <ServerDrainingOverlay isServerDraining={webSocketData.isServerDraining} />
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
