import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { MarkSessionIdle, SessionActivityMap } from '../../../hooks/useSessionProtection';
import type { LLMProvider, Project, ProjectSession } from '../../../types/app';
import type { NormalizedMessage, SessionStore } from '../../../stores/useSessionStore';
import type { ChatMessage } from '../types/types';
import { createCachedDiffCalculator, type DiffCalculator } from '../utils/messageTransforms';

import { normalizedToChatMessages } from './useChatMessages';

const PAGE_SIZE = 20;
const FIRST_VISIBLE_COUNT = 100;
const NO_MESSAGES: NormalizedMessage[] = [];

type Props = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  newSessionTrigger?: number;
  processingSessions?: SessionActivityMap;
  onSessionIdle?: MarkSessionIdle;
  resetStreamingState: () => void;
  statusCheckSentAtRef: MutableRefObject<Map<string, number>>;
  lastSeqRef: MutableRefObject<Map<string, number>>;
  sessionStore: SessionStore;
  showImagePreviews?: boolean;
};

type ScrollSnapshot = { height: number; top: number };
type SearchRequest = { timestamp?: string; uuid?: string; snippet?: string };

export function shouldRefreshCachedImageWindow(
  previousSessionKey: string | null,
  previousEnabled: boolean,
  nextSessionKey: string,
  nextEnabled: boolean,
  hasCachedSession: boolean,
): boolean {
  return hasCachedSession && nextEnabled && !previousEnabled && previousSessionKey === nextSessionKey;
}

function normalizeLocalMessage(message: ChatMessage, sessionId: string): NormalizedMessage {
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = message.timestamp instanceof Date
    ? message.timestamp.toISOString()
    : typeof message.timestamp === 'number'
      ? new Date(message.timestamp).toISOString()
      : String(message.timestamp);
  const common = { id, sessionId, timestamp, provider: 'gjc' as LLMProvider };

  if (message.isToolUse) {
    return { ...common, kind: 'tool_use', toolName: message.toolName, toolInput: message.toolInput, toolId: message.toolId || id };
  }
  if (message.isThinking) return { ...common, kind: 'thinking', content: message.content || '' };
  if (message.isInteractivePrompt) return { ...common, kind: 'interactive_prompt', content: message.content || '' };
  if ((message as { isTaskNotification?: boolean }).isTaskNotification) {
    const task = message as ChatMessage & { taskStatus?: string };
    return { ...common, kind: 'task_notification', status: task.taskStatus || 'completed', summary: message.content || '' };
  }
  if (message.type === 'error') return { ...common, kind: 'error', content: message.content || '' };
  return {
    ...common,
    kind: 'text',
    role: message.type === 'user' ? 'user' : 'assistant',
    content: message.content || '',
    images: Array.isArray(message.images) && message.images.length ? message.images : undefined,
  };
}

function clearTimer(timer: MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  if (timer.current) clearTimeout(timer.current);
  timer.current = null;
}

export function useChatSessionState({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  newSessionTrigger,
  processingSessions,
  onSessionIdle: _onSessionIdle,
  resetStreamingState,
  statusCheckSentAtRef,
  lastSeqRef,
  sessionStore,
  showImagePreviews = true,
}: Props) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<Record<string, unknown> | null>(null);
  const [sessionState, setSessionState] = useState<Record<string, unknown> | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(FIRST_VISIBLE_COUNT);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const [isLoadingAllMessages, setIsLoadingAllMessages] = useState(false);
  const [loadAllJustFinished, setLoadAllJustFinished] = useState(false);
  const [showLoadAllOverlay, setShowLoadAllOverlay] = useState(false);
  const [viewHiddenCount, setViewHiddenCount] = useState(0);
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessage | null>(null);
  const [searchTarget, setSearchTarget] = useState<SearchRequest | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeSession = selectedSession?.id || currentSessionId || null;
  const activeSessionRef = useRef(activeSession);
  activeSessionRef.current = activeSession;
  const activityMapRef = useRef(processingSessions);
  activityMapRef.current = processingSessions;
  const storeSessionRef = useRef<string | null>(null);
  const pendingEchoRef = useRef<ChatMessage | null>(null);
  const messageLengthRef = useRef(0);
  const priorContentRef = useRef({ count: 0, size: 0 });
  const previousTriggerRef = useRef(newSessionTrigger ?? 0);
  const imageStateRef = useRef({ sessionKey: null as string | null, enabled: showImagePreviews });
  const loadedKeyRef = useRef<string | null>(null);
  const initialScrollRef = useRef(true);
  const searchInProgressRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const loadedAllRef = useRef(false);
  const topRequestLockRef = useRef(false);
  const nearTopRef = useRef(false);
  const restoreScrollRef = useRef<ScrollSnapshot | null>(null);
  const scrollBeforeRenderRef = useRef<ScrollSnapshot>({ height: 0, top: 0 });
  const ignoredOffsetRef = useRef(0);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createDiff = useMemo<DiffCalculator>(createCachedDiffCalculator, []);

  const resetPagination = useCallback((resetVisibility: boolean) => {
    ignoredOffsetRef.current = 0;
    loadedAllRef.current = false;
    topRequestLockRef.current = false;
    nearTopRef.current = false;
    restoreScrollRef.current = null;
    setHasMoreMessages(false);
    setTotalMessages(0);
    setAllMessagesLoaded(false);
    setIsLoadingAllMessages(false);
    setLoadAllJustFinished(false);
    setShowLoadAllOverlay(false);
    if (resetVisibility) setVisibleMessageCount(FIRST_VISIBLE_COUNT);
    clearTimer(overlayTimerRef);
    clearTimer(finishedTimerRef);
  }, []);

  useEffect(() => {
    const incoming = newSessionTrigger ?? 0;
    if (incoming === previousTriggerRef.current) return;
    previousTriggerRef.current = incoming;
    resetStreamingState();
    setCurrentSessionId(null);
    setPendingUserMessage(null);
    setTokenBudget(null);
    setSessionState(null);
    setViewHiddenCount(0);
    setSearchTarget(null);
    initialScrollRef.current = true;
    searchInProgressRef.current = false;
    loadedKeyRef.current = null;
    imageStateRef.current = { sessionKey: null, enabled: showImagePreviews };
    resetPagination(true);
  }, [_onSessionIdle, newSessionTrigger, resetPagination, resetStreamingState, showImagePreviews]);

  const sessionActivity = activeSession ? processingSessions?.get(activeSession) || null : null;
  const isProcessing = sessionActivity !== null;
  const canAbortSession = Boolean(isProcessing && sessionActivity.canInterrupt);

  if (storeSessionRef.current !== activeSession) {
    storeSessionRef.current = activeSession;
    sessionStore.setActiveSession(activeSession);
  }
  const storedMessages = activeSession ? sessionStore.getMessages(activeSession) : NO_MESSAGES;
  if (messageLengthRef.current !== storedMessages.length) {
    messageLengthRef.current = storedMessages.length;
    if (viewHiddenCount) setViewHiddenCount(0);
  }

  useEffect(() => {
    if (!pendingUserMessage) {
      pendingEchoRef.current = null;
      return;
    }
    if (!activeSession || pendingEchoRef.current === pendingUserMessage) return;
    sessionStore.appendRealtime(activeSession, normalizeLocalMessage(pendingUserMessage, activeSession));
    pendingEchoRef.current = pendingUserMessage;
    setPendingUserMessage(null);
  }, [activeSession, pendingUserMessage, sessionStore]);

  const chatMessages = useMemo(() => {
    const converted = normalizedToChatMessages(storedMessages);
    if (!converted.length && pendingUserMessage) return [pendingUserMessage];
    return viewHiddenCount > 0 && viewHiddenCount < converted.length
      ? converted.slice(0, converted.length - viewHiddenCount)
      : converted;
  }, [pendingUserMessage, storedMessages, viewHiddenCount]);

  const addMessage = useCallback((message: ChatMessage) => {
    if (!activeSessionRef.current) {
      setPendingUserMessage(message);
      return;
    }
    const id = activeSessionRef.current;
    sessionStore.appendRealtime(id, normalizeLocalMessage(message, id));
  }, [sessionStore]);
  const clearMessages = useCallback(() => {
    if (activeSessionRef.current) sessionStore.clearRealtime(activeSessionRef.current);
  }, [sessionStore]);
  const rewindMessages = useCallback((count: number) => setViewHiddenCount(count), []);
  const scrollToBottom = useCallback(() => {
    const node = scrollContainerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);
  const isNearBottom = useCallback(() => {
    const node = scrollContainerRef.current;
    return Boolean(node && node.scrollHeight - node.scrollTop - node.clientHeight < 50);
  }, []);
  const scrollToBottomAndReset = useCallback(() => {
    scrollToBottom();
    setHasNewMessagesBelow(false);
    if (allMessagesLoaded) {
      loadedAllRef.current = false;
      setAllMessagesLoaded(false);
      setVisibleMessageCount(FIRST_VISIBLE_COUNT);
    }
  }, [allMessagesLoaded, scrollToBottom]);

  const loadOlderMessages = useCallback(async (node: HTMLDivElement) => {
    if (loadingMoreRef.current || isLoadingMoreMessages || loadedAllRef.current || !hasMoreMessages || !selectedSession || !selectedProject) return false;
    loadingMoreRef.current = true;
    setIsLoadingMoreMessages(true);
    const old = { height: node.scrollHeight, top: node.scrollTop };
    try {
      const page = await sessionStore.fetchMore(selectedSession.id, { limit: PAGE_SIZE, includeImages: showImagePreviews });
      if (!page) return false;
      if (!page.serverMessages.length) {
        if (!page.hasMore) {
          loadedAllRef.current = true;
          setAllMessagesLoaded(true);
          setHasMoreMessages(false);
          clearTimer(overlayTimerRef);
          setShowLoadAllOverlay(false);
        }
        return false;
      }
      restoreScrollRef.current = old;
      setHasMoreMessages(page.hasMore);
      setTotalMessages(page.total);
      setVisibleMessageCount(value => value + PAGE_SIZE);
      if (!page.hasMore) {
        loadedAllRef.current = true;
        setAllMessagesLoaded(true);
        clearTimer(overlayTimerRef);
        setShowLoadAllOverlay(false);
      }
      return true;
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMoreMessages(false);
    }
  }, [hasMoreMessages, isLoadingMoreMessages, selectedProject, selectedSession, sessionStore, showImagePreviews]);

  const handleScroll = useCallback(async () => {
    const node = scrollContainerRef.current;
    if (!node) return;
    const bottom = isNearBottom();
    setIsUserScrolledUp(!bottom);
    if (bottom) setHasNewMessagesBelow(false);
    const atTop = node.scrollTop < 100;
    if (atTop && hasMoreMessages && !loadedAllRef.current) {
      if (!nearTopRef.current) {
        nearTopRef.current = true;
        clearTimer(overlayTimerRef);
        setShowLoadAllOverlay(true);
        overlayTimerRef.current = setTimeout(() => {
          setShowLoadAllOverlay(false);
          overlayTimerRef.current = null;
        }, 2500);
      }
    } else if (!atTop) {
      nearTopRef.current = false;
    }
    if (loadedAllRef.current) return;
    if (!atTop) {
      topRequestLockRef.current = false;
      return;
    }
    if (topRequestLockRef.current) {
      if (node.scrollTop > 20) topRequestLockRef.current = false;
      return;
    }
    if (await loadOlderMessages(node)) topRequestLockRef.current = true;
  }, [hasMoreMessages, isNearBottom, loadOlderMessages]);

  useLayoutEffect(() => {
    const saved = restoreScrollRef.current;
    const node = scrollContainerRef.current;
    if (!saved || !node) return;
    node.scrollTop = saved.top + Math.max(node.scrollHeight - saved.height, 0);
    restoreScrollRef.current = null;
  }, [chatMessages.length]);

  useEffect(() => {
    if (!searchInProgressRef.current) {
      initialScrollRef.current = true;
      setVisibleMessageCount(FIRST_VISIBLE_COUNT);
    }
    topRequestLockRef.current = false;
    restoreScrollRef.current = null;
    nearTopRef.current = false;
    setIsUserScrolledUp(false);
  }, [selectedProject?.projectId, selectedSession?.id]);

  useEffect(() => {
    if (!initialScrollRef.current || isLoadingSessionMessages || !scrollContainerRef.current) return;
    if (!chatMessages.length || searchInProgressRef.current) {
      initialScrollRef.current = false;
      return;
    }
    const node = scrollContainerRef.current;
    let frames = 0;
    let unchanged = 0;
    let height = 0;
    let frameId = 0;
    const settle = () => {
      if (!initialScrollRef.current || !scrollContainerRef.current) return;
      node.scrollTop = node.scrollHeight;
      if (node.scrollHeight === height) unchanged += 1;
      else {
        height = node.scrollHeight;
        unchanged = 0;
      }
      frames += 1;
      if (unchanged < 3 && frames < 60) frameId = requestAnimationFrame(settle);
      else initialScrollRef.current = false;
    };
    frameId = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frameId);
  }, [chatMessages.length, isLoadingSessionMessages]);

  useEffect(() => {
    if (!selectedProject || !selectedSession) {
      if (currentSessionId && activityMapRef.current?.has(currentSessionId)) return;
      resetStreamingState();
      setCurrentSessionId(null);
      setTokenBudget(null);
      setSessionState(null);
      ignoredOffsetRef.current = 0;
      setHasMoreMessages(false);
      setTotalMessages(0);
      loadedKeyRef.current = null;
      imageStateRef.current = { sessionKey: null, enabled: showImagePreviews };
      return;
    }
    const sessionId = selectedSession.id;
    const key = `${sessionId}:${selectedProject.projectId}`;
    const oldImageState = imageStateRef.current;
    const refreshImages = shouldRefreshCachedImageWindow(oldImageState.sessionKey, oldImageState.enabled, key, showImagePreviews, sessionStore.has(sessionId));
    imageStateRef.current = { sessionKey: key, enabled: showImagePreviews };
    const subscribe = () => {
      if (!ws) return;
      statusCheckSentAtRef.current.set(sessionId, Date.now());
      sendMessage({ type: 'chat.subscribe', sessions: [{ sessionId, lastSeq: lastSeqRef.current.get(sessionId) ?? 0 }] });
    };
    if (loadedKeyRef.current === key && sessionStore.has(sessionId) && !sessionStore.isStale(sessionId)) {
      subscribe();
      if (refreshImages) void sessionStore.refreshFromServer(sessionId, { includeImages: true });
      return;
    }
    const changed = currentSessionId !== null && currentSessionId !== sessionId;
    if (changed) resetStreamingState();
    resetPagination(true);
    setViewHiddenCount(0);
    if (changed) {
      setTokenBudget(null);
      setSessionState(null);
    }
    setCurrentSessionId(sessionId);
    subscribe();
    loadedKeyRef.current = key;
    setIsLoadingSessionMessages(true);
    sessionStore.fetchFromServer(sessionId, { limit: PAGE_SIZE, offset: 0, includeImages: showImagePreviews })
      .then(window => {
        if (window) {
          setHasMoreMessages(window.hasMore);
          setTotalMessages(window.total);
          if (window.tokenUsage) setTokenBudget(window.tokenUsage as Record<string, unknown>);
        }
        setIsLoadingSessionMessages(false);
      })
      .catch(() => setIsLoadingSessionMessages(false));
  }, [currentSessionId, lastSeqRef, resetPagination, resetStreamingState, selectedProject, selectedSession, sendMessage, sessionStore, showImagePreviews, statusCheckSentAtRef, ws]);

  useEffect(() => {
    const session = selectedSession as (ProjectSession & { __searchTargetSnippet?: unknown; __searchTargetTimestamp?: unknown }) | null;
    if (typeof session?.__searchTargetSnippet !== 'string' || !session.__searchTargetSnippet) return;
    searchInProgressRef.current = true;
    setSearchTarget({ snippet: session.__searchTargetSnippet, timestamp: typeof session.__searchTargetTimestamp === 'string' ? session.__searchTargetTimestamp : undefined });
  }, [selectedSession]);

  useEffect(() => {
    if (!searchTarget || !chatMessages.length || isLoadingSessionMessages) return;
    const request = searchTarget;
    setSearchTarget(null);
    const findElement = (node: HTMLDivElement): Element | null => {
      if (request.snippet) {
        const phrase = request.snippet.replace(/^\.{3}/, '').replace(/\.{3}$/, '').trim().slice(0, 80).toLowerCase();
        if (phrase.length >= 10) {
          for (const element of node.querySelectorAll('.chat-message')) {
            if ((element.textContent || '').toLowerCase().includes(phrase)) return element;
          }
        }
      }
      if (!request.timestamp) return null;
      const targetTime = new Date(request.timestamp).getTime();
      let match: Element | null = null;
      let distance = Infinity;
      for (const element of node.querySelectorAll('[data-message-timestamp]')) {
        const value = element.getAttribute('data-message-timestamp');
        if (!value) continue;
        const candidate = Math.abs(new Date(value).getTime() - targetTime);
        if (candidate < distance) {
          distance = candidate;
          match = element;
        }
      }
      return match;
    };
    const navigate = async () => {
      if (!loadedAllRef.current && selectedSession && selectedProject) {
        try {
          const window = await sessionStore.fetchFromServer(selectedSession.id, { limit: null, offset: 0, includeImages: showImagePreviews });
          if (window) {
            setHasMoreMessages(false);
            setTotalMessages(window.total);
            ignoredOffsetRef.current = window.total;
            setVisibleMessageCount(Infinity);
            setAllMessagesLoaded(true);
            loadedAllRef.current = true;
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        } catch {
          // The currently rendered message window remains searchable.
        }
      }
      setVisibleMessageCount(Infinity);
      const attempt = (remaining: number) => {
        const node = scrollContainerRef.current;
        if (!node) return;
        const element = findElement(node);
        if (element) {
          element.scrollIntoView({ block: 'center', behavior: 'smooth' });
          element.classList.add('search-highlight-flash');
          setTimeout(() => element.classList.remove('search-highlight-flash'), 4000);
          searchInProgressRef.current = false;
        } else if (remaining) {
          setTimeout(() => attempt(remaining - 1), 200);
        } else searchInProgressRef.current = false;
      };
      setTimeout(() => attempt(15), 150);
    };
    void navigate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages.length, isLoadingSessionMessages, searchTarget]);

  useEffect(() => {
    if (!selectedProject || !selectedSession?.id) {
      setTokenBudget(null);
      setSessionState(null);
      return;
    }
    const loadUsage = async () => {
      try {
        const response = await authenticatedFetch(`/api/projects/${selectedProject.projectId}/sessions/${selectedSession.id}/token-usage`);
        if (response.ok) setTokenBudget(await response.json());
        else {
          setTokenBudget(null);
          setSessionState(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };
    void loadUsage();
  }, [selectedProject, selectedSession?.id]);

  const visibleMessages = useMemo(() => chatMessages.length <= visibleMessageCount ? chatMessages : chatMessages.slice(-visibleMessageCount), [chatMessages, visibleMessageCount]);

  useEffect(() => {
    const node = scrollContainerRef.current;
    if (node) scrollBeforeRenderRef.current = { height: node.scrollHeight, top: node.scrollTop };
  });
  useEffect(() => {
    const node = scrollContainerRef.current;
    if (!node || !chatMessages.length || loadingMoreRef.current || isLoadingMoreMessages || restoreScrollRef.current || searchInProgressRef.current) return;
    if (!isUserScrolledUp) {
      setTimeout(scrollToBottom, 50);
      return;
    }
    const previous = scrollBeforeRenderRef.current;
    const difference = node.scrollHeight - previous.height;
    if (difference > 0 && previous.top > 0) node.scrollTop = previous.top + difference;
  }, [chatMessages.length, isLoadingMoreMessages, isUserScrolledUp, scrollToBottom]);

  const lastMessage = chatMessages[chatMessages.length - 1];
  const finalMessageSize = typeof lastMessage?.content === 'string' ? lastMessage.content.length : 0;
  useEffect(() => {
    const before = priorContentRef.current;
    const advanced = chatMessages.length > before.count || finalMessageSize > before.size;
    priorContentRef.current = { count: chatMessages.length, size: finalMessageSize };
    if (!chatMessages.length || !advanced || loadingMoreRef.current || isLoadingMoreMessages || restoreScrollRef.current || searchInProgressRef.current) return;
    if (isUserScrolledUp) setHasNewMessagesBelow(true);
    else scrollToBottom();
  }, [chatMessages.length, finalMessageSize, isLoadingMoreMessages, isUserScrolledUp, scrollToBottom]);
  useEffect(() => {
    setHasNewMessagesBelow(false);
    priorContentRef.current = { count: 0, size: 0 };
  }, [activeSession]);
  useEffect(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    node.addEventListener('scroll', handleScroll);
    return () => node.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const loadAllMessages = useCallback(async () => {
    if (!selectedProject || !selectedSession || isLoadingAllMessages) return;
    const requestId = selectedSession.id;
    loadedAllRef.current = true;
    loadingMoreRef.current = true;
    setIsLoadingAllMessages(true);
    setShowLoadAllOverlay(true);
    clearTimer(overlayTimerRef);
    const node = scrollContainerRef.current;
    const previous = node ? { height: node.scrollHeight, top: node.scrollTop } : null;
    try {
      const window = await sessionStore.fetchFromServer(requestId, { limit: null, offset: 0, includeImages: showImagePreviews });
      if (currentSessionId !== requestId) return;
      if (!window) {
        loadedAllRef.current = false;
        setShowLoadAllOverlay(false);
        return;
      }
      if (previous) restoreScrollRef.current = previous;
      setHasMoreMessages(false);
      setTotalMessages(window.total);
      ignoredOffsetRef.current = window.total;
      setVisibleMessageCount(Infinity);
      setAllMessagesLoaded(true);
      setLoadAllJustFinished(true);
      clearTimer(finishedTimerRef);
      finishedTimerRef.current = setTimeout(() => {
        setLoadAllJustFinished(false);
        setShowLoadAllOverlay(false);
        finishedTimerRef.current = null;
      }, 2500);
    } catch (error) {
      console.error('Error loading all messages:', error);
      loadedAllRef.current = false;
      setShowLoadAllOverlay(false);
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingAllMessages(false);
    }
  }, [currentSessionId, isLoadingAllMessages, selectedProject, selectedSession, sessionStore, showImagePreviews]);
  const loadEarlierMessages = useCallback(() => setVisibleMessageCount(count => count + 100), []);

  return {
    chatMessages,
    addMessage,
    clearMessages,
    rewindMessages,
    sessionActivity,
    isProcessing,
    canAbortSession,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isUserScrolledUp,
    hasNewMessagesBelow,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    sessionState,
    setSessionState,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    isNearBottom,
    handleScroll,
  };
}
