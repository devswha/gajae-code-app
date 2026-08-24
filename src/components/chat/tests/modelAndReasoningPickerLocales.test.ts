import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const LOCALES_DIR = path.join(process.cwd(), 'src/i18n/locales');
const REQUIRED_KEYS = {
  modelReasoning: [
    'label',
    'providerTitle',
    'modelTitle',
    'reasoningTitle',
    'defaultModel',
    'currentConfiguration',
  ],
  agentConfiguration: ['label', 'title', 'description', 'search', 'noMatches'],
} as const;

test('every locale translates the composer model controls', () => {
  const locales = readdirSync(LOCALES_DIR)
    .filter((name) => statSync(path.join(LOCALES_DIR, name)).isDirectory())
    .sort();

  for (const locale of locales) {
    const chat = JSON.parse(readFileSync(path.join(LOCALES_DIR, locale, 'chat.json'), 'utf8')) as {
      input?: Record<string, Record<string, unknown>>;
    };
    for (const [surface, requiredKeys] of Object.entries(REQUIRED_KEYS)) {
      const translations = chat.input?.[surface];
      assert.ok(translations, `${locale} is missing input.${surface}`);
      assert.deepEqual(Object.keys(translations).sort(), [...requiredKeys].sort(), `${locale} input.${surface} has the wrong keys`);
      for (const key of requiredKeys) {
        assert.equal(typeof translations[key], 'string', `${locale} input.${surface}.${key} is not text`);
        assert.ok(String(translations[key]).trim(), `${locale} input.${surface}.${key} is empty`);
      }
    }
  }
});
