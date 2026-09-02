import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Every locale must speak the same keys. A missing key renders its own name
 * in one language and works in the others - a bug that only speakers of that
 * language can see, which is nobody who can fix it. This walks the locale
 * files exactly as i18next loads them and diffs key sets against `en`,
 * ignoring plural-form suffixes (`files_one`, `files_few`, ...), which each
 * language legitimately carries a different subset of.
 */

const localesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales');
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function locales() {
  return readdirSync(localesDirectory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function namespaceFiles(directory) {
  return readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
}

/** Dotted key paths of a parsed namespace, plural-form suffixes folded away. */
function keyPaths(value, prefix = '') {
  const keys = new Set();
  for (const [name, child] of Object.entries(value ?? {})) {
    const base = prefix ? `${prefix}.${name.replace(PLURAL_SUFFIX, '')}` : name.replace(PLURAL_SUFFIX, '');
    keys.add(base);
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      for (const nested of keyPaths(child, base)) keys.add(nested);
    }
  }
  return keys;
}

function namespaceKeys(locale, file) {
  const parsed = JSON.parse(readFileSync(path.join(localesDirectory, locale, file), 'utf8'));
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `${locale}/${file}: the namespace must be a JSON object`);
  return keyPaths(parsed);
}

test('every locale carries exactly the keys the English one does, in every namespace', () => {
  const all = locales();
  assert.ok(all.includes('en'), 'the reference locale "en" is missing');
  const namespaced = new Map(all.map((locale) => {
    const names = new Map(namespaceFiles(path.join(localesDirectory, locale)).map((file) => [file, namespaceKeys(locale, file)]));
    return [locale, names];
  }));

  const english = namespaced.get('en');
  for (const [locale, namespaces] of namespaced) {
    if (locale === 'en') continue;
    assert.deepEqual([...namespaces.keys()].sort(), [...english.keys()].sort(), `${locale}: namespace files differ from en`);
    for (const [file, keys] of namespaces) {
      const expected = english.get(file);
      const missing = [...expected].filter((key) => !keys.has(key));
      const extra = [...keys].filter((key) => !expected.has(key));
      assert.deepEqual(
        { missing, extra },
        { missing: [], extra: [] },
        `${locale}/${file}: key sets drift from en (missing ${missing.length}, extra ${extra.length})`,
      );
    }
  }
});

test('a plural-suffixed key counts as its base key, so legitimate per-language plural forms pass', () => {
  const base = keyPaths({ files_one: 1, files_other: 2, title: 3 });
  assert.deepEqual([...base].sort(), ['files', 'title']);
  assert.deepEqual([...keyPaths({ nested: { rows_few: 1 } })], ['nested', 'nested.rows']);
});
