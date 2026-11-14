// The 12 words must not be left where a regular expression keeps them.
//
// When a regular expression matches, the JavaScript engine keeps the text it
// ran on: RegExp.input holds the whole text, RegExp.lastMatch the part that
// matched, RegExp.leftContext and RegExp.rightContext what stood before and
// after it. They stay until the next match, and any script in the page can
// read them. So no function of this package that takes or gives the 12 words
// may run a regular expression over them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToBytes } from '@noble/hashes/utils.js';
import {
  SELF_TEST_VECTOR,
  accountFromMnemonic,
  entropyFromPrf,
  isValidMnemonic,
  mnemonicFromEntropy,
  newMnemonic,
  normalizeMnemonic,
  selfTest,
  unknownWords,
} from '../src/index.ts';
import * as keys from '../src/keys.ts';
import { V } from './helpers.ts';

/** What stands in the engine's memory before each call: a text that holds no word of any phrase used here. */
const BEFORE = '1 2 3';

/** The four things the engine keeps of the last match, by the names a script reads them under. */
function remembered(): Record<string, string> {
  return {
    'RegExp.input': RegExp.input,
    'RegExp.lastMatch': RegExp.lastMatch,
    'RegExp.leftContext': RegExp.leftContext,
    'RegExp.rightContext': RegExp.rightContext,
  };
}

/** Fills the engine's memory with BEFORE, so that whatever is found there later was put there by the call under test. */
function fill(): void {
  assert.ok(/2/.test(BEFORE));
  assert.deepEqual(remembered(), {
    'RegExp.input': BEFORE,
    'RegExp.lastMatch': '2',
    'RegExp.leftContext': '1 ',
    'RegExp.rightContext': ' 3',
  });
}

/**
 * Not one word of `phrase` stands in what the engine remembers. The phrase
 * is taken apart here without a regular expression: one that matched would
 * replace the very thing being looked at.
 */
function assertForgotten(phrase: string, after: string): void {
  const words = phrase.toLowerCase().split(' ').filter((word) => word !== '');
  assert.ok(words.length >= 12, 'a whole phrase to look for');
  for (const [name, text] of Object.entries(remembered())) {
    const lower = text.toLowerCase();
    for (const word of words) {
      assert.ok(!lower.includes(word), `after ${after}, ${name} holds the word "${word}"`);
    }
  }
}

/** As a reader types them back in: capitals, a tab, a line break and stray spaces. */
function asTyped(phrase: string): string {
  return `  ${phrase.toUpperCase().split(' ').join('  \t ')} \n`;
}

// Three phrases with frozen values: the passkey vector's, the BIP39 test
// phrase for the bytes 7f..7f, and one with a word that is in no list.
const PHRASE = V.prf.wallet.mnemonic as string;
const LEGAL = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const MISSPELLED = 'legal winner thank year wave sausagee worth useful legal winner thank yellow';
const BAD_CHECKSUM = 'legal winner thank year wave sausage worth useful legal winner thank thank';

test('the check can tell: a regular expression that runs over the words does leave them behind', () => {
  fill();
  assertForgotten(PHRASE, 'nothing at all');
  // What normalizeMnemonic used to do.
  const tidied = asTyped(PHRASE).trim().toLowerCase().split(/\s+/).join(' ');
  const input = RegExp.input;
  // The whole text the expression ran on is there, all 12 words of it.
  for (const word of PHRASE.split(' ')) assert.ok(input.includes(word), word);
  let caught: unknown;
  try {
    assertForgotten(PHRASE, 'a split with a regular expression');
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof assert.AssertionError);
  assert.ok(caught.message.startsWith('after a split with a regular expression, RegExp.input holds the word'), caught.message);
  assert.equal(tidied, PHRASE);
  // The next match takes its place.
  fill();
  assertForgotten(PHRASE, 'the next match');
});

test('every exported function that takes or gives the 12 words leaves none of them in RegExp.input, lastMatch, leftContext or rightContext', () => {
  const entropy = entropyFromPrf(hexToBytes(V.prf.prfOutput));
  const calls: Array<[name: string, phrases: string[], call: () => unknown]> = [
    ['mnemonicFromEntropy', [PHRASE], () => mnemonicFromEntropy(entropy)],
    ['normalizeMnemonic', [PHRASE], () => normalizeMnemonic(asTyped(PHRASE))],
    ['normalizeMnemonic, words already tidy', [LEGAL], () => normalizeMnemonic(LEGAL)],
    ['isValidMnemonic', [PHRASE], () => isValidMnemonic(asTyped(PHRASE))],
    ['isValidMnemonic, a bad checksum', [BAD_CHECKSUM], () => isValidMnemonic(asTyped(BAD_CHECKSUM))],
    ['isValidMnemonic, a word that is in no list', [MISSPELLED], () => isValidMnemonic(asTyped(MISSPELLED))],
    ['isValidMnemonic, 24 words', [PHRASE, LEGAL], () => isValidMnemonic(`${PHRASE} ${LEGAL}`)],
    ['unknownWords', [PHRASE], () => unknownWords(asTyped(PHRASE))],
    ['unknownWords, a word that is in no list', [MISSPELLED], () => unknownWords(asTyped(MISSPELLED))],
    ['accountFromMnemonic', [PHRASE], () => accountFromMnemonic(asTyped(PHRASE))],
    ['accountFromMnemonic, with a passphrase', [LEGAL], () => accountFromMnemonic(LEGAL, 'TREZOR')],
    [
      'accountFromMnemonic, refused',
      [BAD_CHECKSUM, MISSPELLED],
      () => {
        assert.throws(() => accountFromMnemonic(asTyped(BAD_CHECKSUM)));
        assert.throws(() => accountFromMnemonic(asTyped(MISSPELLED)));
      },
    ],
    // The frozen example's own words: public, but the same road as anybody's.
    ['selfTest', [mnemonicFromEntropy(entropyFromPrf(hexToBytes(SELF_TEST_VECTOR.prfOutput)))], () => assert.equal(selfTest(), true)],
  ];
  for (const [name, phrases, call] of calls) {
    fill();
    call();
    for (const phrase of phrases) assertForgotten(phrase, name);
  }

  // newMnemonic gives words nobody knows beforehand: they are looked for once it has given them.
  fill();
  const fresh = newMnemonic();
  assertForgotten(fresh, 'newMnemonic');
  assert.ok(isValidMnemonic(fresh));
  assertForgotten(fresh, 'isValidMnemonic of new words');

  // The answers are still the ones the frozen vectors hold.
  assert.equal(normalizeMnemonic(asTyped(PHRASE)), PHRASE);
  assert.equal(accountFromMnemonic(asTyped(PHRASE)).xpub, V.prf.wallet.xpub);
  assert.deepEqual(unknownWords(asTyped(MISSPELLED)), [5]);
});

test('the list above is every function of keys.ts that takes or gives the words', () => {
  // A function added to keys.ts shows up here. If it handles the words, it
  // belongs in the test above; if not, in `others`.
  const handlesWords = ['accountFromMnemonic', 'isValidMnemonic', 'mnemonicFromEntropy', 'newMnemonic', 'normalizeMnemonic', 'selfTest', 'unknownWords'];
  const others = ['deriveAddress', 'entropyFromPrf', 'fingerprintHex', 'privateKeyAt', 'watchOnlyAccount'];
  const functions = Object.entries(keys)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(functions, [...handlesWords, ...others].sort());
});
