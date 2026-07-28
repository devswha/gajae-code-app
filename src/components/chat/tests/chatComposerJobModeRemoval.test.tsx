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
import ChatComposer from '../view/subcomponents/ChatComposer';

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
  tokenBudget: null,
  sessionState: null,
  onShowTokenUsage: () => undefined,
  slashCommandsCount: 2,
  onToggleCommandMenu: () => undefined,
  hasInput: true,
  onClearInput: () => undefined,
  onSubmit: () => undefined,
  isDragActive: false,
  queuedDraft: null as QueuedDraft | null,
  onEditQueuedDraft: () => undefined,
  onDeleteQueuedDraft: () => undefined,
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
      options: {
        model: 'gpt-test',
        effort: 'default',
        permissionMode: 'default',
        toolsSettings: {
          allowedTools: [],
          disallowedTools: [],
          skipPermissions: false,
        },
        skipPermissions: false,
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

test('chat composer renders normal tools without background Job controls', () => {
  const html = renderToStaticMarkup(createElement(ChatComposer, baseComposerProps));

  assert.doesNotMatch(html, /Background job/i);
  assert.doesNotMatch(html, /Delegate background job/i);
  assert.doesNotMatch(html, /Back to chat/i);
  assert.match(html, /lucide-image/);
  assert.match(html, /lucide-message-square/);
});
