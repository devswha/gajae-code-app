import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../../../i18n/config';
import type { ChatMessage } from '../types/types';
import ChatMessagesPane from '../view/ChatMessagesPane';

function renderCount(loaded: number, persistedTotal: number, extra: Partial<ComponentProps<typeof ChatMessagesPane>> = {}) {
  const messages: ChatMessage[] = Array.from({ length: loaded }, (_, index) => ({
    type: 'assistant', content: `Message ${index}`, timestamp: new Date(index * 1000).toISOString(),
  }));
  const visibleMessages = messages.slice(-20);
  return renderToStaticMarkup(createElement(ChatMessagesPane, {
    scrollContainerRef: { current: null }, onWheel() {}, onTouchMove() {},
    isLoadingSessionMessages: false, chatMessages: messages,
    selectedSession: { id: 'session', provider: 'gjc' }, currentSessionId: 'session', provider: 'gjc',
    isLoadingMoreMessages: false, hasMoreMessages: true, totalMessages: persistedTotal,
    visibleMessageCount: 20, visibleMessages,
    loadEarlierMessages() {}, loadAllMessages() {}, allMessagesLoaded: false,
    isLoadingAllMessages: false, loadAllJustFinished: false, showLoadAllOverlay: true,
    createDiff: () => [], selectedProject: { projectId: 'project', fullPath: '/project', displayName: 'Project' },
    ...extra,
  }));
}

test('realtime rows beyond the persisted total do not show stale totals', () => {
  const html = renderCount(81, 64);
  assert.doesNotMatch(html, /Displaying 81 of|Loaded messages:|\(64\)|\(81\)|Scroll upward for more/);
  assert.match(html, /<button[^>]*>[\s\S]*?Get all messages[\s\S]*?<\/button>/);
});

test('a usable persisted total remains on the explicit load-all control only', () => {
  for (const total of [81, 100]) {
    const html = renderCount(81, total);
    assert.doesNotMatch(html, /Displaying|Scroll upward for more|Loaded messages:/);
    assert.match(html, new RegExp(`\\(${total}\\)`));
  }
});

test('an unknown persisted total does not add an idle pagination notice', () => {
  const html = renderCount(3, 0);
  assert.doesNotMatch(html, /Loaded messages:|Scroll upward for more| of 0 messages|\(0\)/);
});

test('loading and finished pagination retain their existing counter visibility', () => {
  const loading = renderCount(81, 64, { isLoadingMoreMessages: true });
  assert.match(loading, /Retrieving earlier messages/);
  assert.doesNotMatch(loading, /Loaded messages:|Scroll upward for more/);
  const finished = renderCount(81, 64, { allMessagesLoaded: true });
  assert.doesNotMatch(finished, /Loaded messages:|Scroll upward for more/);
});

test('locally hidden rows retain the earlier and all-message controls without server pagination', () => {
  const html = renderCount(81, 64, { hasMoreMessages: false });
  assert.doesNotMatch(html, /Displaying the latest/);
  assert.match(html, /Get earlier messages/);
  assert.match(html, /Get all messages/);
});
