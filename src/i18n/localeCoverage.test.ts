import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { LANGUAGE_BUNDLES as bundles } from './config.js';
import { languages } from './languages.js';

const LANGUAGE_BUNDLES: Record<string, (() => Promise<unknown>) | undefined> = bundles;

const LOCALES_DIR = path.join(process.cwd(), 'src/i18n/locales');
const NAMESPACES = ['chat', 'common', 'settings', 'sidebar'];

/*
 * French was listed in the language selector and never registered with i18next,
 * so choosing it served English with no error anywhere. A language the user can
 * pick has to be a language that loads.
 */
test('every language the selector offers can actually be loaded', () => {
  for (const { value } of languages) {
    if (value === 'en') continue; // Bundled as the fallback, not lazy-loaded.
    assert.equal(
      typeof LANGUAGE_BUNDLES[value],
      'function',
      `${value} is offered in the selector but has no bundle to load`,
    );
  }
});

test('every registered language has all four namespaces on disk', () => {
  for (const value of Object.keys(LANGUAGE_BUNDLES)) {
    for (const namespace of NAMESPACES) {
      const file = path.join(LOCALES_DIR, value, `${namespace}.json`);
      assert.equal(existsSync(file), true, `${value} is missing ${namespace}.json`);
    }
    assert.equal(
      existsSync(path.join(LOCALES_DIR, value, 'index.js')),
      true,
      `${value} has no barrel, so its namespaces would each become their own request`,
    );
  }
});

test('no translated language is left unreachable on disk', () => {
  const onDisk = readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const value of onDisk) {
    assert.equal(
      value === 'en' || value in LANGUAGE_BUNDLES,
      true,
      `${value} is translated but nothing can load it`,
    );
    assert.equal(
      languages.some((language) => language.value === value),
      true,
      `${value} is translated and loadable but the selector never offers it`,
    );
  }
});
