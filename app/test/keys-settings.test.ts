// What the Settings screen decides (src/screens/keys/settings-flow.ts):
// which lines say what this browser keeps, which sentence says what brings
// a removed wallet back, whether the wallet the reader was asked about is
// still the one here, what follows each answer of Remove, and the day the
// wallet has been in this browser since.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  afterRemove,
  hereSince,
  keepsLines,
  removeBackKey,
  sameWallet,
  type KeepsLine,
} from '../src/screens/keys/settings-flow.ts';
import { strings } from '../src/strings/index.ts';

// -- what this browser keeps ------------------------------------------------------

test('keepsLines: the public key always, and the 12 words only for a wallet made without a passkey', () => {
  for (const persisted of [true, false, null]) {
    const passkey = keepsLines('passkey', persisted);
    assert.equal(passkey[0], 'public');
    assert.ok(passkey.includes('no-words') && !passkey.includes('words'), String(persisted));
    const words = keepsLines('words', persisted);
    assert.equal(words[0], 'public');
    assert.ok(words.includes('words') && !words.includes('no-words'), String(persisted));
  }
});

test('keepsLines: what the browser said about keeping the data is shown only where it is known', () => {
  assert.deepEqual(keepsLines('words', true), ['public', 'words', 'persisted']);
  assert.deepEqual(keepsLines('words', false), ['public', 'words', 'not-persisted']);
  // Not asked, or no answer yet: the screen says nothing, and never guesses.
  assert.deepEqual(keepsLines('words', null), ['public', 'words']);
});

test('keepsLines: a passkey wallet is never said to be kept or not kept, whatever the answer', () => {
  // Its words are not in this browser, and it comes back from its passkey whatever the browser erases.
  for (const persisted of [true, false, null]) {
    assert.deepEqual(keepsLines('passkey', persisted), ['public', 'no-words'], String(persisted));
  }
});

test('keepsLines: never both answers about keeping, and never one twice', () => {
  for (const kind of ['passkey', 'words'] as const) {
    for (const persisted of [true, false, null]) {
      const lines: KeepsLine[] = keepsLines(kind, persisted);
      assert.equal(new Set(lines).size, lines.length);
      assert.ok(!(lines.includes('persisted') && lines.includes('not-persisted')));
    }
  }
});

// -- remove ---------------------------------------------------------------------------

test('removeBackKey: each kind of wallet has its own sentence on what brings it back', () => {
  assert.equal(removeBackKey('passkey'), 'removeBackPasskey');
  assert.equal(removeBackKey('words'), 'removeBackWords');
  // The keys are in the table, in both languages.
  for (const kind of ['passkey', 'words'] as const) {
    assert.ok(strings.settings.en[removeBackKey(kind)].length > 40, kind);
    assert.ok(strings.settings.es[removeBackKey(kind)].length > 40, kind);
  }
});

test('sameWallet: "Remove it" only ever removes the wallet the reader was asked about', () => {
  assert.equal(sameWallet('tpubA', 'tpubA'), true);
  // Replaced in another tab while the question was open.
  assert.equal(sameWallet('tpubA', 'tpubB'), false);
  // Removed in another tab.
  assert.equal(sameWallet('tpubA', null), false);
  // No wallet was there when the question was asked: nothing to say yes to.
  assert.equal(sameWallet(null, null), false);
  assert.equal(sameWallet(null, 'tpubA'), false);
});

test('afterRemove: a removed wallet sends the reader Home; "gone" stays and says so', () => {
  assert.equal(afterRemove('removed'), 'home');
  assert.equal(afterRemove('gone'), 'say-gone');
});

// -- the day the wallet has been in this browser since -----------------------------------

test('hereSince: the day in each language, from the milliseconds a record keeps', () => {
  const noon = Date.UTC(2026, 10, 1, 12);
  assert.equal(hereSince(noon, 'en', 'utc'), 'November 1, 2026');
  assert.equal(hereSince(noon, 'es', 'utc'), '1 de noviembre de 2026');
  // The last millisecond of a day is still that day.
  assert.equal(hereSince(Date.UTC(2026, 10, 14, 23, 59, 59, 999), 'en', 'utc'), 'November 14, 2026');
  // Without a zone it is the reader's own calendar: the same call formatDate makes.
  assert.match(hereSince(noon, 'en'), /^(October 31|November [12]), 2026$/);
});
