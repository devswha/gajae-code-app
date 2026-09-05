import assert from 'node:assert/strict';
import test from 'node:test';

import { SessionManager } from '@gajae-code/coding-agent/session/session-manager';

import { assignTranscriptTurns, type TranscriptTurnRecord } from './modules/providers/list/gjc/gjc-transcript-turns.js';

test('turn boundaries follow messages appended by the pinned SDK', () => {
  const manager = SessionManager.inMemory('/tmp/gjc-turn-contract');
  const prompt = (text: string) => manager.appendMessage({
    role: 'user', content: [{ type: 'text', text }], timestamp: Date.now(),
  });
  const answer = (stopReason: 'stop' | 'toolUse') => manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: stopReason }],
    api: 'openai-responses', provider: 'openai', model: 'fixture',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason, timestamp: Date.now(),
  });

  const firstPrompt = prompt('first turn');
  const firstAnswer = answer('stop');
  const secondPrompt = prompt('second turn');
  answer('toolUse');
  manager.appendThinkingLevelChange('high');
  const steer = prompt('steer the running turn');
  const secondAnswer = answer('stop');

  const entries = manager.getEntries();
  assert.equal(entries.find((entry) => entry.id === secondPrompt)?.parentId, firstAnswer,
    'the SDK links a new prompt to the previous answer');

  const records: TranscriptTurnRecord[] = entries.map((entry) => ({
    id: entry.id,
    parentId: entry.parentId,
    ...(entry.type === 'message' ? {
      role: entry.message.role as TranscriptTurnRecord['role'],
      stopReason: entry.message.role === 'assistant' ? entry.message.stopReason : undefined,
    } : {}),
  }));
  const turns = assignTranscriptTurns(records);

  assert.equal(turns.get(firstAnswer)?.turnId, firstPrompt);
  assert.equal(turns.get(secondAnswer)?.turnId, secondPrompt);
  assert.equal(turns.get(steer)?.turnId, secondPrompt);
  assert.equal(turns.get(firstPrompt)?.status, 'completed');
  assert.equal(turns.get(secondPrompt)?.status, 'completed');
});
