// The taps that must not count on the Backup and Settings screens
// (src/screens/keys/taps.ts): the second click of a double tap, and any
// answer to the Remove question in the first moment after it has opened.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REMOVE_SETTLE_MS, isRepeatTap, answerCounts } from '../src/screens/keys/taps.ts';

test('isRepeatTap: the second click of a double tap, and any later one, by the count the browser gives', () => {
  // A single click, by mouse or by touch.
  assert.equal(isRepeatTap({ detail: 1 }), false);
  // The keyboard: Enter or Space on the button.
  assert.equal(isRepeatTap({ detail: 0 }), false);
  // The second and the third click at one point.
  assert.equal(isRepeatTap({ detail: 2 }), true);
  assert.equal(isRepeatTap({ detail: 3 }), true);
});

test('answerCounts: the Remove question takes no answer until it has been on screen for a moment', () => {
  const single = { detail: 1 };
  assert.equal(answerCounts(0, single), false);
  assert.equal(answerCounts(REMOVE_SETTLE_MS - 1, single), false);
  assert.equal(answerCounts(REMOVE_SETTLE_MS, single), true);
  assert.equal(answerCounts(60_000, single), true);
  // The same from the keyboard.
  assert.equal(answerCounts(REMOVE_SETTLE_MS - 1, { detail: 0 }), false);
  assert.equal(answerCounts(REMOVE_SETTLE_MS, { detail: 0 }), true);
});

test('answerCounts: the second click of a double tap never answers, however late it comes', () => {
  assert.equal(answerCounts(0, { detail: 2 }), false);
  assert.equal(answerCounts(REMOVE_SETTLE_MS, { detail: 2 }), false);
  assert.equal(answerCounts(60_000, { detail: 2 }), false);
});

test('the moment is longer than a double tap and far shorter than reading the question', () => {
  // Browsers count two clicks as a double one when they are up to about half a second apart.
  assert.ok(REMOVE_SETTLE_MS >= 500, String(REMOVE_SETTLE_MS));
  assert.ok(REMOVE_SETTLE_MS <= 1000, String(REMOVE_SETTLE_MS));
});
