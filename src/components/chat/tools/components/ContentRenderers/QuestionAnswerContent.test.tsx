import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { QuestionAnswerContent } from './QuestionAnswerContent';

const renderQuestionAnswers = (questions: unknown, answers: unknown) => renderToStaticMarkup(
  React.createElement(QuestionAnswerContent, { questions: questions as never, answers: answers as never }),
);

test('AskUserQuestion transcript data tolerates invalid question shapes', async (suite) => {
  await suite.test('object payloads are ignored', () => {
    assert.doesNotThrow(() => renderQuestionAnswers({ 0: { question: 'q?', options: [{ label: 'a' }] } }, {}));
  });

  await suite.test('a prompt can omit options', () => {
    assert.doesNotThrow(() => renderQuestionAnswers([{ question: 'Pick one?', header: 'H' }], { 'Pick one?': 'X' }));
  });

  await suite.test('invalid option entries do not interrupt rendering', () => {
    assert.doesNotThrow(() => renderQuestionAnswers(
      [{ question: 'Pick one?', options: [null, 'oops', { label: 'A' }] }],
      { 'Pick one?': 'A, Custom' },
    ));
  });

  await suite.test('invalid entries alongside a question are skipped', () => {
    assert.doesNotThrow(() => renderQuestionAnswers(
      [null, 'oops', { question: 'Ok?', options: [{ label: 'A' }] }],
      {},
    ));
  });
});

test('AskUserQuestion output remains resilient and visible', () => {
  assert.doesNotThrow(() => renderQuestionAnswers(
    [{ question: 'Pick one?', options: [{ label: 'A' }] }],
    { 'Pick one?': { unexpected: true } },
  ));

  const markup = renderQuestionAnswers(
    [{ question: 'Pick one?', header: 'H', options: [{ label: 'A' }, { label: 'B' }] }],
    { 'Pick one?': 'A' },
  );
  assert.match(markup, /Pick one\?/);
});
