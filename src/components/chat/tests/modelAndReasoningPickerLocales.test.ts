import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const LOCALES_DIR = path.join(process.cwd(), 'src/i18n/locales');
const REQUIRED_KEYS = [
  'label',
  'modelTitle',
  'modelDescription',
  'defaultModel',
  'currentConfiguration',
  'reasoningTitle',
  'reasoningDescription',
] as const;

test('every locale translates the combined model and reasoning picker', () => {
  const locales = readdirSync(LOCALES_DIR)
    .filter((name) => statSync(path.join(LOCALES_DIR, name)).isDirectory())
    .sort();

  for (const locale of locales) {
    const chat = JSON.parse(readFileSync(path.join(LOCALES_DIR, locale, 'chat.json'), 'utf8')) as {
      input?: { modelReasoning?: Record<string, unknown> };
    };
    const translations = chat.input?.modelReasoning;
    assert.ok(translations, `${locale} is missing input.modelReasoning`);
    assert.deepEqual(Object.keys(translations).sort(), [...REQUIRED_KEYS].sort(), `${locale} has the wrong picker keys`);
    for (const key of REQUIRED_KEYS) {
      assert.equal(typeof translations[key], 'string', `${locale} input.modelReasoning.${key} is not text`);
      assert.ok(String(translations[key]).trim(), `${locale} input.modelReasoning.${key} is empty`);
    }
  }
});
