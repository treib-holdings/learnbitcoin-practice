import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import {
  ENGLISH_WORDS,
  SELF_TEST_VECTOR,
  accountFromMnemonic,
  deriveAddress,
  selfTest,
  unknownWords,
  watchOnlyAccount,
  type HDKey,
} from '../src/index.ts';
import { V } from './helpers.ts';

const ABANDON = V.abandon.mnemonic as string;

test('the word list is the 2048 English BIP39 words, in order', () => {
  assert.equal(ENGLISH_WORDS.length, 2048);
  assert.equal(ENGLISH_WORDS[0], 'abandon');
  assert.equal(ENGLISH_WORDS[3], 'about');
  assert.equal(ENGLISH_WORDS[2047], 'zoo');
  assert.deepEqual([...ENGLISH_WORDS], wordlist);
  // It is a copy, and it cannot be written to: the list phrases are made from stays as it is.
  assert.notEqual(ENGLISH_WORDS, wordlist);
  assert.throws(() => (ENGLISH_WORDS as string[]).push('bitcoin'), TypeError);
});

test('unknownWords points at the words that are not in the list, counting from 0', () => {
  assert.deepEqual(unknownWords(ABANDON), []);
  assert.deepEqual(unknownWords(ABANDON.replace(/about$/, 'abuot')), [11]);
  assert.deepEqual(unknownWords('abandn abandon zebra zzz'), [0, 3]);
  // Typed the way people type: capitals, extra spaces, a line break.
  assert.deepEqual(unknownWords('  Abandon   ABOUT\nwallett  '), [2]);
  assert.deepEqual(unknownWords(''), []);
  assert.deepEqual(unknownWords('   \n '), []);
  // A word can be in the list and the phrase still be wrong: that is the checksum's job, not this one's.
  assert.deepEqual(unknownWords(ABANDON.replace(/about$/, 'abandon')), []);
});

test('selfTest re-derives the frozen passkey example', () => {
  assert.equal(selfTest(), true);
  // The values built into keys.ts are the ones in vectors.json, which Bitcoin Core confirmed.
  assert.deepEqual(
    { ...SELF_TEST_VECTOR },
    {
      prfOutput: V.prf.prfOutput,
      masterFingerprint: V.prf.wallet.masterFingerprint,
      firstAddress: V.prf.wallet.receive[0],
    },
  );
  assert.ok(Object.isFrozen(SELF_TEST_VECTOR));
});

test('selfTest answers false, and never throws, on any mismatch', () => {
  const good = { ...SELF_TEST_VECTOR };
  assert.equal(selfTest(good), true);
  assert.equal(selfTest({ ...good, masterFingerprint: '73c5da0a' }), false, 'another wallet fingerprint');
  assert.equal(selfTest({ ...good, firstAddress: V.prf.wallet.receive[1] }), false, 'another address');
  assert.equal(selfTest({ ...good, prfOutput: '02'.repeat(32) }), false, 'another passkey output');
  assert.equal(selfTest({ ...good, prfOutput: '01'.repeat(31) }), false, 'a passkey output of the wrong length');
  assert.equal(selfTest({ ...good, prfOutput: 'not hex' }), false, 'a passkey output that is not hex');
  assert.equal(selfTest(null as never), false, 'no vector at all');
});

test('the account key type is exported for code that holds one', () => {
  const full: HDKey = accountFromMnemonic(ABANDON).key;
  const watch: HDKey = watchOnlyAccount(V.abandon.xpub);
  assert.equal(deriveAddress(watch, 0, 0).address, deriveAddress(full, 0, 0).address);
});
