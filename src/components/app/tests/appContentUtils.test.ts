import assert from 'node:assert/strict';
import test from 'node:test';

import { hiddenKeyboardHeight } from '../appContentUtils';

test('Given matching viewports when no keyboard is open then the hidden height is zero', () => {
  assert.equal(hiddenKeyboardHeight(844, 844), 0);
});

test('Given a visual viewport larger than the layout viewport when zoomed then the hidden height never goes negative', () => {
  assert.equal(hiddenKeyboardHeight(844, 900), 0);
});

test('Given collapsible browser chrome gaps when they stay under the keyboard threshold then they are not treated as a keyboard', () => {
  // Android Chrome URL bar ~56px, iOS Safari bottom bar ~114px: the shell's
  // dynamic-viewport height already tracks these; counting them here would
  // subtract them twice and float the composer above the browser chrome.
  for (const chrome of [40, 56, 100, 114, 150]) {
    assert.equal(hiddenKeyboardHeight(844, 844 - chrome), 0, `chrome=${chrome}`);
  }
});

test('Given an overlay keyboard on iOS when the gap exceeds the threshold then the full gap is reported', () => {
  for (const keyboard of [151, 260, 336, 420]) {
    assert.equal(hiddenKeyboardHeight(844, 844 - keyboard), keyboard, `keyboard=${keyboard}`);
  }
});

test('Given a resized layout viewport on Android when the keyboard opens then the gap stays near zero and is not reported', () => {
  // interactive-widget=resizes-content shrinks documentElement.clientHeight
  // along with the visual viewport, so both read 508 with a 336px keyboard.
  assert.equal(hiddenKeyboardHeight(508, 508), 0);
});
