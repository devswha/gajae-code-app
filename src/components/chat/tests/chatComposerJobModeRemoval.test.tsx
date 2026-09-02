import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement, type FormEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DropzoneInputProps, DropzoneRootProps } from 'react-dropzone';

import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';
import {
  useChatComposerState,
  type PendingCommandGate,
  type QueuedDraft,
} from '../hooks/useChatComposerState';
import ChatComposer from '../view/ChatComposer';

const selectedProject: Project = {
  projectId: 'project-1',
  displayName: 'Project one',
  fullPath: '/repos/project-one',
  origin: 'explicit',
};

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  },
  configurable: true,
});

const submitEvent: FormEvent<HTMLFormElement> = {
  preventDefault: () => undefined,
} as FormEvent<HTMLFormElement>;

const baseComposerProps = {
  pendingPermissionRequests: [],
  handlePermissionDecision: () => undefined,
  activity: null,
  isLoading: false,
  onAbortSession: () => undefined,
  sessionState: null,
  onShowTokenUsage: () => undefined,
  onSubmit: () => undefined,
  onSteer: () => undefined,
  isDragActive: false,
  sessionPinnedModel: null as string | null,
  queuedDrafts: [] as QueuedDraft[],
  onEditQueuedDraft: () => undefined,
  onDeleteQueuedDraft: () => undefined,
  onMoveQueuedDraft: () => undefined,
  pendingCommandGate: null as PendingCommandGate | null,
  onConfirmCommandGate: () => undefined,
  onCancelCommandGate: () => undefined,
  attachedImages: [],
  onRemoveImage: () => undefined,
  uploadingImages: new Map<string, number>(),
  imageErrors: new Map<string, string>(),
  showFileDropdown: false,
  filteredFiles: [],
  selectedFileIndex: 0,
  onSelectFile: () => undefined,
  filteredCommands: [],
  skillCommands: [{
    name: '/skill:ralplan',
    description: 'Plan with consensus',
    type: 'skill',
    metadata: { skillName: 'ralplan' },
  }],
  selectedCommandIndex: 0,
  onCommandSelect: () => undefined,
  onCloseCommandMenu: () => undefined,
  isCommandMenuOpen: false,
  frequentCommands: [],
  getRootProps: <T extends DropzoneRootProps>(props?: T) => props ?? ({} as T),
  getInputProps: <T extends DropzoneInputProps>(props?: T) => props ?? ({} as T),
  openImagePicker: () => undefined,
  inputHighlightRef: { current: null },
  renderInputWithMentions: (text: string) => text,
  textareaRef: { current: null },
  input: 'normal message',
  onInputChange: () => undefined,
  onTextareaClick: () => undefined,
  onTextareaKeyDown: () => undefined,
  onTextareaPaste: () => undefined,
  onTextareaScrollSync: () => undefined,
  onTextareaInput: () => undefined,
  placeholder: 'Message Gajae Code',
  isTextareaExpanded: false,
  sendByCtrlEnter: false,
  modelPreset: 'current',
  modelPresetOptions: [{ value: 'current', label: 'Current' }],
  reasoningEffort: 'high' as const,
  onSelectReasoningEffort: () => undefined,
};

test('normal chat submit sends one chat message and never creates a GJC job', async () => {
  const sentMessages: unknown[] = [];
  const addedMessages: unknown[] = [];
  let createCalls = 0;
  let composer: ReturnType<typeof useChatComposerState> | undefined;
  const originalCreate = api.gjcJobs.create;

  function Capture() {
    composer = useChatComposerState({
      selectedProject,
      selectedSession: null,
      currentSessionId: 'session-1',
      gjcModel: 'gpt-test',
      isLoading: false,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sentMessages.push(message); },
      scrollToBottom: () => undefined,
      addMessage: (message) => { addedMessages.push(message); },
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    });
    return null;
  }

  api.gjcJobs.create = async () => {
    createCalls += 1;
    return new Response(JSON.stringify({ data: { jobId: 'job-1' } }), { status: 201 });
  };

  try {
    renderToStaticMarkup(createElement(Capture));
    assert.ok(composer);

    composer.handleVoiceTranscript('normal message');
    await composer.handleSubmit(submitEvent);

    assert.equal(createCalls, 0);
    assert.equal(sentMessages.length, 1);
    assert.deepEqual(sentMessages[0], {
      type: 'chat.send',
      sessionId: 'session-1',
      content: 'normal message',
      // No permission fields: the project's stored policy is applied by the
      // server, so the browser has nothing to say about it here.
      options: {
        model: 'gpt-test',
        effort: 'default',
        sessionSummary: 'normal message',
        images: [],
      },
    });
    assert.equal(addedMessages.length, 1);
  } finally {
    api.gjcJobs.create = originalCreate;
  }
});
test('/login opens the app login flow without sending a chat message', async () => {
  const sentMessages: unknown[] = [];
  const loginProviderIds: Array<string | undefined> = [];
  let composer: ReturnType<typeof useChatComposerState> | undefined;

  function Capture() {
    composer = useChatComposerState({
      selectedProject,
      selectedSession: null,
      currentSessionId: 'session-1',
      gjcModel: 'gpt-test',
      isLoading: false,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sentMessages.push(message); },
      onLogin: (providerId) => { loginProviderIds.push(providerId); },
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    });
    return null;
  }

  renderToStaticMarkup(createElement(Capture));
  assert.ok(composer);
  composer.handleVoiceTranscript('/login openai');
  await composer.handleSubmit(submitEvent);

  assert.deepEqual(loginProviderIds, ['openai']);
  assert.deepEqual(sentMessages, []);
});

test('a running turn queues Enter submissions and only steers through the explicit action', async () => {
  const sentMessages: unknown[] = [];
  let composer: ReturnType<typeof useChatComposerState> | undefined;

  function Capture() {
    composer = useChatComposerState({
      selectedProject,
      selectedSession: null,
      currentSessionId: 'session-1',
      gjcModel: 'gpt-test',
      isLoading: true,
      canAbortSession: true,
      tokenBudget: null,
      sendMessage: (message) => { sentMessages.push(message); },
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    });
    return null;
  }

  renderToStaticMarkup(createElement(Capture));
  assert.ok(composer);

  composer.handleVoiceTranscript('send this after the answer');
  await composer.handleSubmit(submitEvent);
  assert.deepEqual(sentMessages, []);

  composer.handleVoiceTranscript('adjust the answer now');
  composer.handleSteer(submitEvent);
  assert.deepEqual(sentMessages, [{
    type: 'chat.steer',
    sessionId: 'session-1',
    content: 'adjust the answer now',
  }]);
  composer.resolveSteerResult('adjust the answer now', true);
});

test('chat composer renders normal tools without background Job controls', () => {
  const html = renderToStaticMarkup(createElement(ChatComposer, baseComposerProps));

  assert.doesNotMatch(html, /Background job/i);
  assert.doesNotMatch(html, /Delegate background job/i);
  assert.doesNotMatch(html, /Back to chat/i);
  assert.match(html, /lucide-plus/);
  assert.match(html, /input\.agentConfiguration\.label/);
  assert.match(html, /aria-label="input\.modelReasoning\.label"/);
  assert.match(html, />High</);
  assert.doesNotMatch(html, /Reasoning effort 선택/);
  assert.match(html, /aria-label="input\.skills\.label"/);
  assert.match(html, /lucide-arrow-up/);
  assert.doesNotMatch(html, /lucide-image/);
  assert.doesNotMatch(html, /lucide-x/);
});

test('a running composer queues by default and offers steering as a separate action', () => {
  const html = renderToStaticMarkup(createElement(ChatComposer, {
    ...baseComposerProps,
    isLoading: true,
    input: 'adjust the current answer',
  }));

  assert.match(html, /aria-label="input\.queue\.sendNext"/);
  assert.match(html, /aria-label="input\.queue\.steerNow"/);
  assert.match(html, /lucide-forward/);
});

test('commands cannot bypass their normal pipeline through the steering action', () => {
  const html = renderToStaticMarkup(createElement(ChatComposer, {
    ...baseComposerProps,
    isLoading: true,
    input: '/help',
  }));

  assert.match(html, /aria-label="input\.queue\.sendNext"/);
  assert.doesNotMatch(html, /aria-label="input\.queue\.steerNow"/);
});

test('the composer shows context fullness as the single token-related control', () => {
  const html = renderToStaticMarkup(createElement(ChatComposer, {
    ...baseComposerProps,
    sessionState: {
      contextPercent: 42,
      contextWindow: 128_000,
      contextTokens: 53_760,
    },
  }));

  assert.match(html, /aria-label="workspace\.statusTab\.context 42%"/);
  assert.match(html, />42%<\/span>/);
  assert.doesNotMatch(html, /Show token usage/);
  assert.doesNotMatch(html, />tokens<\/span>/);
});

test('the composer tools row wraps instead of clipping its trailing controls', () => {
  // This row holds attach, voice, two model controls, skills and context
  // usage. It used to carry `overflow-hidden`, so a narrow viewport cut the
  // trailing controls off with nothing indicating they were there. Layout
  // cannot be measured in a static render, so the guard is on the two classes
  // that decide it: clipping must stay gone and wrapping must stay on.
  const html = renderToStaticMarkup(createElement(ChatComposer, {
    ...baseComposerProps,
  }));

  const toolsRow = /<div[^>]*data-slot="prompt-input-tools"[^>]*>/.exec(html)?.[0];
  assert.ok(toolsRow, 'the composer no longer renders a tools row');
  assert.doesNotMatch(toolsRow, /overflow-hidden/);
  assert.match(toolsRow, /flex-wrap/);
});
