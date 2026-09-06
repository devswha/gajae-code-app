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

export type ServerEvent = { kind?: string; type?: string; sessionId?: string; seq?: number; replayGeneration?: string | null; [key: string]: unknown };
type JobSubscription = {
  jobId: string;
  getCursor: () => number;
  onSubscribed: (snapshot: JobSnapshot) => void;
  applyReplayChunk: (events: JobProjectionEvent[]) => boolean;
  applyLiveEvent: (event: JobProjectionEvent) => boolean;
  onError: (code: JobProjectionErrorCode | 'protocol_violation') => void;
};
type JobIntent = JobSubscription & { owners: number; subscriptionId: string | null; watermark: number | null; generation: number };
type ServerEventListener = (event: ServerEvent) => void;
type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: unknown) => boolean;
  subscribe: (listener: ServerEventListener) => () => void;
  registerJobSubscription: (subscription: JobSubscription) => () => void;
  latestMessage: ServerEvent | null;
  isConnected: boolean;
  isServerDraining: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const connection = useContext(WebSocketContext);
  if (!connection) throw new Error('useWebSocket must be used within a WebSocketProvider');
  return connection;
};

export const isServerDrainingCloseEvent = (event: Pick<CloseEvent, 'code' | 'reason'>) => event.code === 1001 && event.reason === 'server-draining';

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

const websocketAddress = () => `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
const jobFrame = (type: JobProjectionInboundFrame['type'], jobId: string, extras: Record<string, unknown>) => ({ protocolVersion: GJC_JOB_PROJECTION_PROTOCOL_VERSION, type, jobId, ...extras }) as JobProjectionInboundFrame;

const useWebSocketConnection = (): WebSocketContextType => {
  const currentSocket = useRef<WebSocket | null>(null);
  const generation = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmounted = useRef(false);
  const previouslyOpened = useRef(false);
  const eventListeners = useRef(new Set<ServerEventListener>());
  const subscriptions = useRef(new Map<string, JobIntent>());
  const { user } = useAuth();
  const lastUser = useRef(user);
  const draining = useRef(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [latestMessage, setLatestMessage] = useState<ServerEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isServerDraining, setIsServerDraining] = useState(false);

  const publish = useCallback((message: ServerEvent) => {
    eventListeners.current.forEach((listener) => {
      try {
        listener(message);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    });
    setLatestMessage(message);
  }, []);

  const cancelReconnect = useCallback(() => {
    if (reconnectTimer.current !== null) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }, []);

  const sendFrame = useCallback((frame: JobProjectionInboundFrame) => {
    if (!isJobProjectionInboundFrame(frame)) return;
    const socket = currentSocket.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }, []);

  const subscribeJobs = useCallback((socketGeneration: number) => {
    subscriptions.current.forEach((intent) => {
      intent.generation = socketGeneration;
      intent.subscriptionId = null;
      intent.watermark = null;
      sendFrame(jobFrame('gjc.job.subscribe', intent.jobId, { after: intent.getCursor() }));
    });
  }, [sendFrame]);

  const processJobFrame = useCallback((message: unknown, socketGeneration: number) => {
    if (!isJobProjectionOutboundFrame(message)) return;
    const intent = typeof message.jobId === 'string' ? subscriptions.current.get(message.jobId) : undefined;
    if (!intent || intent.generation !== socketGeneration) return;

    if (message.kind === 'gjc_job_subscribed' && intent.subscriptionId === null) {
      intent.subscriptionId = message.subscriptionId;
      intent.watermark = message.watermark;
      intent.onSubscribed(message.snapshot);
      sendFrame(jobFrame('gjc.job.replay', intent.jobId, { subscriptionId: message.subscriptionId, after: intent.getCursor() }));
      return;
    }
    if (intent.subscriptionId !== message.subscriptionId) return;
    if (message.kind === 'gjc_job_replay_chunk') {
      if (intent.watermark !== message.watermark) {
        intent.onError('protocol_violation');
      } else if (intent.applyReplayChunk(message.events) && !message.done && message.nextCursor !== null) {
        sendFrame(jobFrame('gjc.job.replay', intent.jobId, { subscriptionId: message.subscriptionId, after: message.nextCursor }));
      }
    } else if (message.kind === 'gjc_job_event') {
      intent.applyLiveEvent(message.event);
    } else if (message.kind === 'gjc_job_error') {
      intent.onError(message.code);
    }
  }, [sendFrame]);

  const connect = useCallback((socketGeneration: number, authenticated: boolean) => {
    if (isUnmounted.current || generation.current !== socketGeneration || !authenticated) return;
    try {
      const socket = new WebSocket(websocketAddress());
      currentSocket.current = socket;
      setWs(socket);
      const ownsSocket = () => !isUnmounted.current && generation.current === socketGeneration && currentSocket.current === socket;

      socket.onopen = () => {
        if (!ownsSocket()) return;
        setIsConnected(true);
        if (previouslyOpened.current) publish({ kind: 'websocket_reconnected', timestamp: Date.now() });
        previouslyOpened.current = true;
        subscribeJobs(socketGeneration);
      };
      socket.onmessage = (event) => {
        if (!ownsSocket()) return;
        try {
          const message: unknown = JSON.parse(event.data);
          processJobFrame(message, socketGeneration);
          publish(message as ServerEvent);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      socket.onclose = (event) => {
        if (!ownsSocket()) return;
        setIsConnected(false);
        currentSocket.current = null;
        setWs(null);
        cancelReconnect();
        if (isServerDrainingCloseEvent(event)) {
          draining.current = true;
          setIsServerDraining(true);
          return;
        }
        reconnectTimer.current = setTimeout(() => {
          reconnectTimer.current = null;
          if (!isUnmounted.current && generation.current === socketGeneration && !draining.current) connect(socketGeneration, authenticated);
        }, 3000);
      };
      socket.onerror = (event) => {
        if (ownsSocket()) console.error('WebSocket error:', event);
      };
    } catch (error) {
      if (generation.current === socketGeneration && !isUnmounted.current) console.error('Error creating WebSocket connection:', error);
    }
  }, [cancelReconnect, processJobFrame, publish, subscribeJobs]);

  useEffect(() => {
    const oldIdentity = lastUser.current?.id ?? lastUser.current?.username ?? null;
    const newIdentity = user?.id ?? user?.username ?? null;
    if (lastUser.current !== user) {
      subscriptions.current.clear();
      lastUser.current = user;
    }
    if (newIdentity !== null && newIdentity !== oldIdentity) {
      draining.current = false;
      setIsServerDraining(false);
    }
  }, [user]);

  useEffect(() => {
    isUnmounted.current = false;
    const socketGeneration = generation.current + 1;
    generation.current = socketGeneration;
    cancelReconnect();
    const oldSocket = currentSocket.current;
    currentSocket.current = null;
    setWs(null);
    setIsConnected(false);
    oldSocket?.close();
    if (!draining.current) connect(socketGeneration, Boolean(user));

    return () => {
      if (generation.current !== socketGeneration) return;
      generation.current += 1;
      cancelReconnect();
      const socket = currentSocket.current;
      currentSocket.current = null;
      setWs(null);
      setIsConnected(false);
      socket?.close();
    };
  }, [cancelReconnect, connect, user]);

  useEffect(() => () => {
    isUnmounted.current = true;
  }, []);

  const sendMessage = useCallback((message: unknown) => {
    const socket = currentSocket.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('WebSocket send failed:', error);
      return false;
    }
  }, []);

  const subscribe = useCallback((listener: ServerEventListener) => {
    eventListeners.current.add(listener);
    return () => eventListeners.current.delete(listener);
  }, []);

  const registerJobSubscription = useCallback((subscription: JobSubscription) => {
    const prior = subscriptions.current.get(subscription.jobId);
    if (prior) {
      prior.owners += 1;
      Object.assign(prior, subscription);
    } else {
      subscriptions.current.set(subscription.jobId, { ...subscription, owners: 1, subscriptionId: null, watermark: null, generation: generation.current });
    }
    const intent = subscriptions.current.get(subscription.jobId)!;
    if (currentSocket.current?.readyState === WebSocket.OPEN) {
      intent.subscriptionId = null;
      intent.watermark = null;
      sendFrame(jobFrame('gjc.job.subscribe', intent.jobId, { after: intent.getCursor() }));
    }
    return () => {
      const active = subscriptions.current.get(subscription.jobId);
      if (!active) return;
      active.owners -= 1;
      if (active.owners !== 0) return;
      if (active.subscriptionId) sendFrame(jobFrame('gjc.job.unsubscribe', active.jobId, { subscriptionId: active.subscriptionId }));
      subscriptions.current.delete(subscription.jobId);
    };
  }, [sendFrame]);

  return useMemo(() => ({ ws, sendMessage, subscribe, registerJobSubscription, latestMessage, isConnected, isServerDraining }), [isConnected, isServerDraining, latestMessage, registerJobSubscription, sendMessage, subscribe, ws]);
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const value = useWebSocketConnection();
  return (
    <WebSocketContext.Provider value={value}>
      {children}
      <ServerDrainingOverlay isServerDraining={value.isServerDraining} />
    </WebSocketContext.Provider>
  );
};
