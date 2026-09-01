import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ProjectSession } from '../../../types/app';
import type { ChatMessage } from '../types/types';
import { isHistoricalNonGjcReadOnlySession } from '../view/ChatInterface';
import MessageComponent from '../view/MessageComponent';
import ProviderSelectionEmptyState from '../view/ProviderSelectionEmptyState';

const historicalSessions = [
  {
    id: 'historic-claude-session',
    title: 'Claude transcript',
    provider: 'claude',
  },
  {
    id: 'historic-codex-session',
    title: 'Codex transcript',
    provider: 'codex',
  },
] as const satisfies readonly ProjectSession[];

const createDiff = () => [];

function renderHistoricalMessage(message: ChatMessage, provider: ProjectSession['provider']) {
  return renderToStaticMarkup(createElement(MessageComponent, {
    message,
    prevMessage: null,
    createDiff,
    provider: provider ?? 'claude',
  }));
}
test('historical non-GJC sessions are classified as read-only before rendering the composer', () => {
  const cases: ReadonlyArray<{
    name: string;
    session: ProjectSession | null;
    readOnly: boolean;
  }> = [
    {
      name: 'Claude provider',
      session: { id: 'claude-provider', provider: 'claude' },
      readOnly: true,
    },
    {
      name: 'Codex provider',
      session: { id: 'codex-provider', provider: 'codex' },
      readOnly: true,
    },
    {
      name: 'GJC provider',
      session: { id: 'gjc-provider', provider: 'gjc' },
      readOnly: false,
    },
    {
      name: 'missing selected session',
      session: null,
      readOnly: false,
    },
    {
      name: 'Claude __provider',
      session: { id: 'claude-internal-provider', __provider: 'claude' },
      readOnly: true,
    },
    {
      name: 'Codex __provider',
      session: { id: 'codex-internal-provider', __provider: 'codex' },
      readOnly: true,
    },
    {
      name: 'GJC __provider',
      session: { id: 'gjc-internal-provider', __provider: 'gjc' },
      readOnly: false,
    },
    {
      name: 'explicit GJC provider overrides a legacy __provider',
      session: { id: 'provider-precedence', provider: 'gjc', __provider: 'claude' },
      readOnly: false,
    },
  ];

  for (const { name, session, readOnly } of cases) {
    assert.equal(
      isHistoricalNonGjcReadOnlySession(session),
      readOnly,
      `${name} has the expected composer visibility classification`,
    );
  }
});

test('provider state and composer remain GJC-only at the static boundary', () => {
  const providerStateSource = readFileSync(
    new URL('../hooks/useChatProviderState.ts', import.meta.url),
    'utf8',
  );
  const composerSource = readFileSync(
    new URL('../hooks/useChatComposerState.ts', import.meta.url),
    'utf8',
  );
  const source = `${providerStateSource}\n${composerSource}`;

  assert.match(providerStateSource, /\/api\/providers\/gjc\/models/);
  assert.match(
    composerSource,
    /body:\s*JSON\.stringify\(\{\s*provider:\s*'gjc',\s*projectPath:/,
  );
  assert.match(
    composerSource,
    /sendMessage\(\{\s*type:\s*'chat\.send',\s*sessionId:\s*\w+,\s*content:\s*\w+,\s*options:\s*\{/,
  );

  for (const provider of ['claude', 'codex', 'cursor', 'opencode']) {
    assert.doesNotMatch(source, new RegExp(`/api/providers/${provider}/models`, 'i'));
    assert.doesNotMatch(source, new RegExp(`/api/providers/${provider}/capabilities`, 'i'));
  }
  assert.doesNotMatch(source, /\/api\/providers\/(?:\$\{[^}]+\}|[^/'"`]+)\/capabilities/i);
  assert.doesNotMatch(source, /\b(?:providerEfforts?|providerEffortTable|PROVIDER_EFFORTS?|ProviderEffort(?:Table)?)\b/);
  // Bounded to one line: an unanchored [^'"]* spans newlines, which turned any
  // later use of the word "effort" (e.g. the reasoningEffort passthrough) into
  // a false positive. The guard's target is effort-table module imports only.
  assert.doesNotMatch(source, /^import[^\n]*['"][^'"\n]*effort[^'"\n]*['"]/im);
  assert.doesNotMatch(
    source,
    /\b(?:providerModels|modelCatalog|modelsByProvider)\s*\[[^\]]+\]\s*\?\?/,
  );
  assert.doesNotMatch(providerStateSource, /\/api\/providers\/\$\{[^}]+\}\/models/);
});

test('SSR new-session entry is Gajae Code ready without a provider, model, effort, or permission control', () => {
  const html = renderToStaticMarkup(createElement(ProviderSelectionEmptyState, {
    selectedSession: null,
    currentSessionId: null,
  }));

  assert.match(html, /Gajae Code/);
  assert.match(html, /Ready to help with your project\./);
  assert.doesNotMatch(html, /\b(Claude|Codex|Cursor|OpenCode)\b/i);
  assert.doesNotMatch(html, /\b(provider|model|effort|permission)\b/i);
  assert.doesNotMatch(html, /<(button|select|input)\b/i);
});

test('SSR historical MessageComponent renderer preserves Claude and Codex plain transcript output', () => {
  const plainMessages: readonly ChatMessage[] = [
    {
      type: 'assistant',
      content: 'Claude stored response: preserved implementation notes.',
      timestamp: '2026-07-20T10:00:00.000Z',
    },
    {
      type: 'assistant',
      content: 'Codex stored response: preserved review notes.',
      timestamp: '2026-07-20T10:01:00.000Z',
    },
  ];

  for (const [index, session] of historicalSessions.entries()) {
    let html = '';
    assert.doesNotThrow(
      () => {
        html = renderHistoricalMessage(plainMessages[index], session.provider);
      },
      `${session.title} plain message renders through the real historical message renderer`,
    );

    assert.match(html, new RegExp(session.provider === 'claude' ? 'Claude stored response' : 'Codex stored response'));
    assert.match(html, new RegExp(`aria-label="${session.provider === 'claude' ? 'Claude' : 'Codex'}"`));
  }
});

test('SSR historical MessageComponent renderer preserves Claude and Codex tool transcript output', () => {
  const toolMessages: readonly ChatMessage[] = [
    {
      type: 'tool',
      displayText: 'Claude ran a stored command.',
      timestamp: '2026-07-20T10:02:00.000Z',
      isToolUse: true,
      toolName: 'Bash',
      toolId: 'claude-historical-bash',
      toolInput: { command: 'git status --short' },
      toolResult: { content: ' M src/example.ts' },
    },
    {
      type: 'tool',
      displayText: 'Codex ran a stored command.',
      timestamp: '2026-07-20T10:03:00.000Z',
      isToolUse: true,
      toolName: 'Bash',
      toolId: 'codex-historical-bash',
      toolInput: { command: 'git diff --stat' },
      toolResult: { content: ' src/example.ts | 1 +' },
    },
  ];

  for (const [index, session] of historicalSessions.entries()) {
    let html = '';
    assert.doesNotThrow(
      () => {
        html = renderHistoricalMessage(toolMessages[index], session.provider);
      },
      `${session.title} Bash message renders through MessageComponent; ChatMessagesPane keeps tool groups collapsed under SSR`,
    );

    assert.match(html, new RegExp(session.provider === 'claude' ? 'Claude ran a stored command' : 'Codex ran a stored command'));
    assert.match(html, new RegExp(index === 0 ? 'git status --short' : 'git diff --stat'));
  }
});
