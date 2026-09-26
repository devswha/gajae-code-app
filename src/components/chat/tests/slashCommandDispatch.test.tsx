import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement, type FormEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { resetAppShellStore, useAppShellStore } from '../../../stores/useAppShellStore';
import type { Project } from '../../../types/app';
import { useChatComposerState } from '../hooks/useChatComposerState';

/*
 * Runtime slash commands run the moment they are sent, exactly as they do in
 * the GJC CLI: no confirmation card sits between the user and `/compact`,
 * `/clear`, `/skill:<name>` or a command a newer runtime added.
 */

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

async function submit(text: string) {
  storage.clear();
  const sentMessages: unknown[] = [];
  const addedMessages: unknown[] = [];
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
  composer.handleVoiceTranscript(text);
  await composer.handleSubmit(submitEvent);
  return { sentMessages, addedMessages };
}

test('runtime slash commands dispatch at once, destructive or not', async () => {
  for (const text of [
    '/clear',
    '/compact focus on the parser',
    '/session delete',
    '/memory clear',
    '/logout',
    '/ssh rm e2e-host',
    '/contribute-pr',
    '/skill:ralplan',
    '/dump',
    '/session info',
  ]) {
    const { sentMessages, addedMessages } = await submit(text);

    assert.equal(sentMessages.length, 1, `${text} must dispatch exactly one frame`);
    assert.equal((sentMessages[0] as { content: string }).content, text);
    assert.deepEqual(addedMessages.filter((message) => (message as { type?: string }).type === 'assistant'), [], `${text} must not be answered locally`);
  }
});

test('a command the app does not know yet still reaches the runtime', async () => {
  const { sentMessages } = await submit('/some-future-command with args');

  assert.equal(sentMessages.length, 1);
  assert.equal((sentMessages[0] as { content: string }).content, '/some-future-command with args');
});

test('a handoff marks the session so the app follows the runtime into the new one', async () => {
  resetAppShellStore();
  const { sentMessages } = await submit('/handoff');

  assert.equal(sentMessages.length, 1);
  assert.equal(useAppShellStore.getState().pendingHandoff?.fromSessionId, 'session-1');
  resetAppShellStore();
});

test('prose is sent as it always was', async () => {
  const { sentMessages } = await submit('please refactor the parser');

  assert.equal(sentMessages.length, 1);
  assert.equal((sentMessages[0] as { content: string }).content, 'please refactor the parser');
});
