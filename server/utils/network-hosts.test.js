import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAllowedHosts } from '../../shared/networkHosts.js';

/*
 * ALLOWED_HOSTS feeds Vite's DNS-rebinding protection. Getting this wrong is
 * quiet in both directions: too strict and a tailnet/reverse-proxy hostname is
 * refused with a blank page, too loose and any website can drive the dev
 * server through the visitor's browser.
 */

test('an unset or empty value keeps Vite\'s default', () => {
  for (const value of [undefined, '', '   ', ',', ' , , ']) {
    assert.equal(parseAllowedHosts(value), undefined, `value: ${JSON.stringify(value)}`);
  }
});

test('a single hostname becomes a one-entry allowlist', () => {
  assert.deepEqual(
    parseAllowedHosts('macbookpro.tail1e211e.ts.net'),
    ['macbookpro.tail1e211e.ts.net'],
  );
});

test('entries are split and trimmed, and blanks dropped', () => {
  assert.deepEqual(
    parseAllowedHosts(' app.example.com , .tail1e211e.ts.net ,, gjc.local '),
    ['app.example.com', '.tail1e211e.ts.net', 'gjc.local'],
  );
});

test('a leading dot is preserved so a whole tailnet can be covered', () => {
  // Vite reads ".domain" as "this domain and any subdomain"; stripping the dot
  // would silently narrow it to the apex only.
  assert.deepEqual(parseAllowedHosts('.ts.net'), ['.ts.net']);
});

test('a bare * opts into Vite allow-all', () => {
  assert.equal(parseAllowedHosts('*'), true);
});

test('* anywhere in the list wins, since the list can no longer constrain', () => {
  assert.equal(parseAllowedHosts('app.example.com,*'), true);
  assert.equal(parseAllowedHosts('*, .ts.net'), true);
});

test('a hostname merely containing an asterisk is not allow-all', () => {
  // Only the exact "*" token disables the check; "*.ts.net" is not Vite's
  // wildcard syntax and must stay a literal entry rather than opening
  // everything up by accident.
  assert.deepEqual(parseAllowedHosts('*.ts.net'), ['*.ts.net']);
});
