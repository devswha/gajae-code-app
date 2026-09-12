import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { useState, type ReactNode } from 'react';

import type { ServerEvent } from '../../../contexts/WebSocketContext';
import { observeOutgoingChatMessage, useSessionAttentionSync } from '../../../hooks/useSessionAttentionSync';
import type { SessionActivityMap } from '../../../hooks/useSessionProtection';
import enCommon from '../../../i18n/locales/en/common.json';
import enChat from '../../../i18n/locales/en/chat.json';
import koCommon from '../../../i18n/locales/ko/common.json';
import { useSessionAttentionStore } from '../../../stores/useSessionAttentionStore';
import type { NormalizedMessage, SessionStore } from '../../../stores/useSessionStore';
import type { PendingPermissionRequest, PermissionDecision } from '../../chat/types/types';
import PermissionRequestsBanner from '../../chat/view/PermissionRequestsBanner';

import AgentSidebarActionRequired from './AgentSidebarActionRequired';
import AgentSidebar from './AgentSidebar';

const state = () => useSessionAttentionStore.getState();
const emptyMessages: NormalizedMessage[] = [];
const sessionStore = { getMessages: () => emptyMessages, subscribeSession: () => () => {} } as unknown as SessionStore;
const originalScroll = HTMLElement.prototype.scrollIntoView;
let scrolled: HTMLElement[] = [];

beforeEach(() => {
  useSessionAttentionStore.setState({ pendingInput: {}, outcomes: {}, lastViewedAt: {} });
  scrolled = [];
  HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this); };
});

afterEach(() => {
  cleanup();
  useSessionAttentionStore.setState({ pendingInput: {}, outcomes: {}, lastViewedAt: {} });
  localStorage.removeItem('session-attention-v1');
  HTMLElement.prototype.scrollIntoView = originalScroll;
});

const approval = { requestId: 'sdk-permission:1', sessionId: 'one', toolName: 'bash', input: { command: 'npm test' } } satisfies PendingPermissionRequest;
const question = {
  requestId: 'sdk-ask:2', sessionId: 'one', toolName: 'ask',
  input: { questions: [{ header: 'Target', question: 'Which target?', options: [{ label: 'Desktop', description: 'macOS' }, { label: 'Server', description: 'Self-host' }] }] },
} satisfies PendingPermissionRequest;

async function setup(lng = 'en') {
  const i18n = createInstance();
  await i18n.init({ lng, fallbackLng: 'en', resources: { en: { common: enCommon, chat: enChat }, ko: { common: koCommon } }, defaultNS: 'common', interpolation: { escapeValue: false } });
  const listeners = new Set<(event: ServerEvent) => void>();
  const subscribe = (listener: (event: ServerEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const processingSessions: SessionActivityMap = new Map();
  const decisions: Array<[string | string[], PermissionDecision]> = [];
  let shown = 0;
  function Sync({ children }: { children: ReactNode }) {
    useSessionAttentionSync({ subscribe, viewedSessionId: null, processingSessions });
    return children;
  }
  function Harness({ sessionId = 'one', requests = [], mobile = false }: { sessionId?: string; requests?: PendingPermissionRequest[]; mobile?: boolean }) {
    const [open, setOpen] = useState(true);
    return <I18nextProvider i18n={i18n}><Sync>
      {mobile
        ? open && <AgentSidebar isMobile sessionId={sessionId} sessionStore={sessionStore} onClose={() => setOpen(false)} />
        : <AgentSidebarActionRequired sessionId={sessionId} onRequestShown={() => { shown += 1; }} />}
      <PermissionRequestsBanner pendingPermissionRequests={requests} handlePermissionDecision={(ids, decision) => { decisions.push([ids, decision]); }} />
    </Sync></I18nextProvider>;
  }
  return {
    Harness, decisions, shown: () => shown,
    emit(event: ServerEvent) { act(() => { listeners.forEach((listener) => listener(event)); }); },
  };
}

const region = () => screen.queryByRole('region', { name: 'Action required' });

test('idle, running text, completed and failed outcomes never invent a request', async () => {
  const { Harness, emit } = await setup();
  render(<Harness />);
  assert.equal(region(), null);
  emit({ kind: 'status', sessionId: 'one', text: 'Waiting for permission' });
  assert.equal(region(), null);
  for (const success of [true, false]) {
    emit({ kind: 'complete', sessionId: 'one', success });
    assert.equal(region(), null);
  }
});

for (const request of [approval, question, { ...question, toolName: 'AskUserQuestion' }, { ...approval, toolName: 'task' }]) {
  test(`${request.toolName} request links to its existing card without deciding or focusing an input`, async () => {
    const { Harness, emit, decisions, shown } = await setup();
    render(<Harness requests={[request]} />);
    emit({ kind: 'permission_request', ...request });
    assert.ok(region());
    const view = within(region()!).getByRole('button', { name: 'View request' });
    view.focus();
    fireEvent.click(view);
    assert.equal(document.activeElement?.getAttribute('data-permission-request-id'), request.requestId);
    assert.equal(scrolled.length, 1);
    assert.equal(shown(), 1);
    assert.deepEqual(decisions, []);
    assert.notEqual(document.activeElement?.tagName, 'INPUT');
    if (request.toolName === 'bash') {
      fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
      assert.deepEqual(decisions, [[request.requestId, { allow: true }]]);
    }
  });
}

test('only the selected session can show Action required, including after navigation', async () => {
  const { Harness, emit } = await setup();
  const view = render(<Harness />);
  emit({ kind: 'permission_request', sessionId: 'two', requestId: 'other', toolName: 'ask' });
  assert.equal(region(), null);
  view.rerender(<Harness sessionId="two" />);
  assert.ok(region());
  view.rerender(<Harness sessionId="one" />);
  assert.equal(region(), null);
  view.rerender(<Harness sessionId="" />);
  assert.equal(region(), null);
});

test('poll-only input waits for restored request ids; chat_subscribed makes the original card reachable', async () => {
  const { Harness, emit } = await setup();
  render(<Harness requests={[question]} />);
  act(() => { state().reconcilePendingInput('one', true); });
  assert.ok(region());
  assert.equal((screen.getByRole('button', { name: 'Loading request…' }) as HTMLButtonElement).disabled, true);
  emit({ kind: 'chat_subscribed', sessionId: 'one', pendingPermissions: [question] });
  fireEvent.click(screen.getByRole('button', { name: 'View request' }));
  assert.equal(document.activeElement?.getAttribute('data-permission-request-id'), question.requestId);
});

test('answer, cancellation, completion and protocol failure clear the section through existing events', async () => {
  const { Harness, emit } = await setup();
  render(<Harness />);
  for (const end of [
    () => act(() => { observeOutgoingChatMessage({ type: 'chat.permission-response', requestId: approval.requestId }); }),
    () => emit({ kind: 'permission_cancelled', ...approval }),
    () => emit({ kind: 'complete', sessionId: 'one', success: true }),
    () => emit({ kind: 'complete', sessionId: 'one', aborted: true }),
    () => emit({ kind: 'protocol_error', sessionId: 'one' }),
  ]) {
    emit({ kind: 'permission_request', ...approval });
    assert.ok(region());
    end();
    assert.equal(region(), null);
  }
});

test('several requests share one section and the next remaining card is reachable', async () => {
  const { Harness, emit } = await setup();
  const view = render(<Harness requests={[approval, question]} />);
  emit({ kind: 'chat_subscribed', sessionId: 'one', pendingPermissions: [approval, question] });
  assert.equal(screen.getAllByRole('region', { name: 'Action required' }).length, 1);
  fireEvent.click(screen.getByRole('button', { name: 'View request' }));
  assert.equal(document.activeElement?.getAttribute('data-permission-request-id'), approval.requestId);
  view.rerender(<Harness requests={[question]} />);
  emit({ kind: 'permission_cancelled', ...approval });
  fireEvent.click(screen.getByRole('button', { name: 'View request' }));
  assert.equal(document.activeElement?.getAttribute('data-permission-request-id'), question.requestId);
});

test('a stale request never focuses another card or dismisses the drawer', async () => {
  const { Harness, emit, shown } = await setup();
  render(<Harness requests={[{ ...approval, requestId: 'unrelated' }]} />);
  emit({ kind: 'permission_request', ...approval });
  fireEvent.click(screen.getByRole('button', { name: 'View request' }));
  assert.equal(shown(), 0);
  assert.equal(scrolled.length, 0);
});

test('the mobile drawer closes after revealing the original question and keeps focus out of text inputs', async () => {
  const { Harness, emit, decisions } = await setup();
  render(<Harness mobile requests={[question]} />);
  emit({ kind: 'permission_request', ...question });
  assert.ok(screen.getByRole('complementary', { name: 'Agent' }));
  fireEvent.click(screen.getByRole('button', { name: 'View request' }));
  assert.equal(screen.queryByRole('complementary'), null);
  assert.equal(document.activeElement?.getAttribute('data-permission-request-id'), question.requestId);
  assert.deepEqual(decisions, []);
});

test('request ids are compared literally, including selector metacharacters', async () => {
  const { Harness, emit } = await setup();
  const request = { ...approval, requestId: 'request:"][data-other="value' };
  render(<Harness requests={[request]} />);
  emit({ kind: 'permission_request', ...request });
  fireEvent.click(screen.getByRole('button', { name: 'View request' }));
  assert.equal(document.activeElement?.getAttribute('data-permission-request-id'), request.requestId);
});

test('plan exits retain the existing attention policy and do not become a second approval UI', async () => {
  const { Harness, emit } = await setup();
  render(<Harness />);
  for (const toolName of ['exit_plan_mode', 'ExitPlanMode']) emit({ kind: 'permission_request', sessionId: 'one', requestId: toolName, toolName });
  assert.equal(region(), null);
});

test('Korean labels render without untranslated keys', async () => {
  const { Harness, emit } = await setup('ko');
  render(<Harness />);
  emit({ kind: 'permission_request', ...approval });
  assert.ok(screen.getByRole('region', { name: '응답 필요' }));
  assert.ok(screen.getByRole('button', { name: '요청 보기' }));
  assert.ok(screen.getByText('응답을 기다리고 있습니다'));
});
