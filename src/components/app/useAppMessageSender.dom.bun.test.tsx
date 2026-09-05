import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, useState, type ReactNode } from 'react';

import { AuthProvider } from '../auth/context/AuthContext';
import { useChatComposerState } from '../chat/hooks/useChatComposerState';
import type { ChatMessage, PendingPermissionRequest } from '../chat/types/types';
import { draftInputKey } from '../chat/utils/chatStorage';
import { useWebSocket, WebSocketProvider } from '../../contexts/WebSocketContext';
import { resetSessionAttentionStore, useSessionAttentionStore } from '../../stores/useSessionAttentionStore';

import { useAppMessageSender } from './useAppMessageSender';

const originalSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;
const sockets: TestSocket[] = [];
class TestSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage = null;
  onerror = null;
  beforeSend: (() => void) | null = null;
  sent: unknown[] = [];
  constructor() { sockets.push(this); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }); }
  send(value: string) { this.beforeSend?.(); this.sent.push(JSON.parse(value)); }
}
const pending: PendingPermissionRequest = { requestId: 'request-a', toolName: 'bash', input: { command: 'pwd' } };
const project = { projectId: 'project-a', displayName: 'A', fullPath: '/repo/a', origin: 'explicit' as const };

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalSocket;
  sockets.length = 0;
  localStorage.clear();
  resetSessionAttentionStore();
});

async function mount() {
  globalThis.WebSocket = TestSocket as unknown as typeof WebSocket;
  globalThis.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith('/api/auth/user') ? { user: { id: 'owner', username: 'owner' } } : []));
  const messages: ChatMessage[] = [];
  const processing: string[] = [];
  const view = renderHook(() => {
    const sendMessage = useAppMessageSender(useWebSocket().sendMessage);
    const [pendingPermissionRequests, setPendingPermissionRequests] = useState([pending]);
    const composer = useChatComposerState({
      selectedProject: project, selectedSession: { id: 'a', __provider: 'gjc' }, currentSessionId: 'a', gjcModel: 'test-model',
      isLoading: false, canAbortSession: false, tokenBudget: null, sendMessage,
      scrollToBottom: () => undefined, addMessage: (message) => { messages.push(message); },
      setIsUserScrolledUp: () => undefined, setPendingPermissionRequests,
      onSessionProcessing: (id) => { if (id) processing.push(id); },
    });
    return { composer, sendMessage, pendingPermissionRequests };
  }, { wrapper: ({ children }: { children: ReactNode }) => createElement(AuthProvider, null, createElement(WebSocketProvider, null, children)) });
  await waitFor(() => assert.equal(sockets.length, 1));
  return { ...view, messages, processing };
}

test('AppContent sender preserves offline drafts and sidebar outcomes through the real socket context', async () => {
  const view = await mount();
  useSessionAttentionStore.getState().recordOutcome('a', { kind: 'ready', at: 100 });
  act(() => view.result.current.composer.handleInputChange({ target: { value: 'keep this draft', selectionStart: 15 } } as never));
  await act(async () => view.result.current.composer.handleSubmit({ preventDefault() {} } as never));
  assert.equal(view.result.current.composer.input, 'keep this draft');
  assert.equal(localStorage.getItem(draftInputKey(project.projectId, 'a')), 'keep this draft');
  assert.deepEqual(view.processing, []);
  assert.equal(view.messages.some((message) => message.type === 'user'), false);
  assert.deepEqual(useSessionAttentionStore.getState().outcomes.a, { kind: 'ready', at: 100 });
  assert.equal(view.result.current.sendMessage({ type: 'chat.send', sessionId: 'a' }), false);
});

test('AppContent sender keeps offline approvals in both composer and sidebar until accepted', async () => {
  const view = await mount();
  useSessionAttentionStore.getState().addPendingInput('a', pending.requestId);
  act(() => view.result.current.composer.handlePermissionDecision(pending.requestId, { allow: true }));
  assert.equal(view.result.current.pendingPermissionRequests.length, 1);
  assert.deepEqual(useSessionAttentionStore.getState().pendingInput.a?.requestIds, [pending.requestId]);
  assert.deepEqual(sockets[0].sent, []);

  act(() => { sockets[0].readyState = TestSocket.OPEN; sockets[0].onopen?.(); });
  sockets[0].beforeSend = () => assert.deepEqual(useSessionAttentionStore.getState().pendingInput.a?.requestIds, [pending.requestId]);
  act(() => view.result.current.composer.handlePermissionDecision(pending.requestId, { allow: true }));
  assert.deepEqual(view.result.current.pendingPermissionRequests, []);
  assert.equal(useSessionAttentionStore.getState().pendingInput.a, undefined);
  assert.equal(sockets[0].sent.length, 1);
});

test('AppContent sender returns success and updates outcome only after the socket accepts the frame', async () => {
  const view = await mount();
  useSessionAttentionStore.getState().recordOutcome('a', { kind: 'blocked', at: 200 });
  act(() => { sockets[0].readyState = TestSocket.OPEN; sockets[0].onopen?.(); });
  sockets[0].beforeSend = () => assert.deepEqual(useSessionAttentionStore.getState().outcomes.a, { kind: 'blocked', at: 200 });
  assert.equal(view.result.current.sendMessage({ type: 'chat.send', sessionId: 'a', content: 'retry' }), true);
  assert.equal(useSessionAttentionStore.getState().outcomes.a, undefined);
});
