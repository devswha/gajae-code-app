import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement, type FormEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Project } from '../../../types/app';
import {
  APP_UI_COMMANDS,
  TUI_ONLY_COMMAND_HINTS,
  findAppUiCommand,
  getTuiOnlyCommandNotice,
  runAppUiCommand,
} from '../appUiCommands';
import { useChatComposerState } from '../hooks/useChatComposerState';
import CommandMenu from '../view/subcomponents/CommandMenu';

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

test('app command registry is well-formed and disjoint from TUI-only notices', () => {
  const names = APP_UI_COMMANDS.map((command) => command.name);

  assert.ok(names.length > 0);
  for (const name of names) {
    assert.match(name, /^\/[a-z-]+$/);
  }
  assert.equal(new Set(names).size, names.length, 'app command names must be unique');

  for (const noticeName of Object.keys(TUI_ONLY_COMMAND_HINTS)) {
    assert.match(noticeName, /^\/[a-z-]+$/);
    assert.equal(
      findAppUiCommand(noticeName),
      undefined,
      `${noticeName} cannot be both an app command and a TUI-only notice`,
    );
  }

  // The canonical entry this feature exists for.
  assert.equal(findAppUiCommand('/resume')?.actionId, 'open-session-picker');
});

test('runAppUiCommand dispatches each action id to its action', () => {
  const calls: string[] = [];
  const actions = {
    openSessionPicker: () => { calls.push('open-session-picker'); },
    startNewChat: () => { calls.push('start-new-chat'); },
    openSettings: () => { calls.push('open-settings'); },
    openModelPicker: () => { calls.push('open-model-picker'); },
  };

  for (const command of APP_UI_COMMANDS) {
    runAppUiCommand(command, actions);
  }

  assert.deepEqual(calls, APP_UI_COMMANDS.map((command) => command.actionId));
});

test('getTuiOnlyCommandNotice covers /retry and skips app/unknown commands', () => {
  assert.match(getTuiOnlyCommandNotice('/retry') ?? '', /not available in the app/);
  assert.equal(getTuiOnlyCommandNotice('/resume'), null);
  assert.equal(getTuiOnlyCommandNotice('/definitely-not-a-command'), null);
});

function captureComposer(sentMessages: unknown[], addedMessages: unknown[]) {
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
      scrollToBottom: () => undefined,
      addMessage: (message) => { addedMessages.push(message); },
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    });
    return null;
  }

  renderToStaticMarkup(createElement(Capture));
  assert.ok(composer);
  return composer;
}

test('typed /resume is intercepted as an app command and never sent to the model', async () => {
  const sentMessages: unknown[] = [];
  const addedMessages: unknown[] = [];
  const composer = captureComposer(sentMessages, addedMessages);

  composer.handleVoiceTranscript('/resume');
  await composer.handleSubmit(submitEvent);

  assert.deepEqual(sentMessages, []);
  assert.deepEqual(addedMessages, []);
});

test('typed TUI-only command gets a local notice instead of a model prompt', async () => {
  const sentMessages: unknown[] = [];
  const addedMessages: unknown[] = [];
  const composer = captureComposer(sentMessages, addedMessages);

  composer.handleVoiceTranscript('/retry');
  await composer.handleSubmit(submitEvent);

  assert.deepEqual(sentMessages, []);
  assert.equal(addedMessages.length, 1);
  const notice = addedMessages[0] as { type: string; content: string };
  assert.equal(notice.type, 'assistant');
  assert.match(notice.content, /`\/retry`/);
  assert.match(notice.content, /not available in the app/);
});

test('unknown slash commands still fall through to a normal chat send', async () => {
  const sentMessages: unknown[] = [];
  const addedMessages: unknown[] = [];
  const composer = captureComposer(sentMessages, addedMessages);

  composer.handleVoiceTranscript('/not-a-real-command hello');
  await composer.handleSubmit(submitEvent);

  assert.equal(sentMessages.length, 1);
  const sent = sentMessages[0] as { type: string; content: string };
  assert.equal(sent.type, 'chat.send');
  assert.equal(sent.content, '/not-a-real-command hello');
});

test('bare /model is intercepted to open the app model picker, not sent to the model', async () => {
  const sentMessages: unknown[] = [];
  const addedMessages: unknown[] = [];
  const composer = captureComposer(sentMessages, addedMessages);

  composer.handleVoiceTranscript('/model');
  await composer.handleSubmit(submitEvent);

  assert.deepEqual(sentMessages, []);
  assert.deepEqual(addedMessages, []);
});

test('/model with arguments flows through to the provider text runtime', async () => {
  // interceptWithArgs:false — "/model gpt-x" must reach GJC so direct model
  // switching keeps working exactly like the TUI.
  const sentMessages: unknown[] = [];
  const addedMessages: unknown[] = [];
  const composer = captureComposer(sentMessages, addedMessages);

  composer.handleVoiceTranscript('/model gpt-test-2');
  await composer.handleSubmit(submitEvent);

  assert.equal(sentMessages.length, 1);
  const sent = sentMessages[0] as { type: string; content: string };
  assert.equal(sent.type, 'chat.send');
  assert.equal(sent.content, '/model gpt-test-2');
  assert.deepEqual(addedMessages.filter((m) => (m as { type: string }).type === 'error'), []);
});

test('command menu groups app commands under the App Commands heading', () => {
  const html = renderToStaticMarkup(
    createElement(CommandMenu, {
      commands: [
        ...APP_UI_COMMANDS.map((command) => ({ ...command })),
        // Group headings only render when more than one namespace is present,
        // matching the real menu where provider builtins are always fetched.
        { name: '/model', description: 'Show current model selection', namespace: 'builtin', type: 'provider' },
      ],
      isOpen: true,
      onClose: () => undefined,
      position: { top: 0, left: 0 },
    }),
  );

  assert.match(html, /App Commands/);
  assert.match(html, /\/resume/);
  assert.match(html, /session picker/);
});
