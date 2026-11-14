// PublicRecord (wallet-api.ts) is the wallet's stored record as a screen may
// see it: without the 12 words. The compiler holds screens to that, and this
// file holds the compiler to it.
//
// A type that only leaves the words out would not do it. TypeScript lets an
// object with more fields stand in for a type with fewer, so a whole record,
// words and all, would pass for a public one. PublicRecord therefore says
// that the field must not be there at all. The proof is the two lines below
// that carry the compiler's "expect an error here" mark (ts-expect-error):
// each hands over a record that holds its words, and the compiler must
// refuse it. Should PublicRecord ever accept such a record again, those
// lines stop being errors, the marks are left with nothing to expect, and
// the app's check script fails on this file ("Unused '@ts-expect-error'
// directive").
//
// (node --test does not check types: under it this file only shows what the
// compiler is there to prevent, and that publicRecord() really takes the
// words out.)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { makeRecord, publicRecord } from '../src/lib/keystore.ts';
import type { WalletRecord } from '../src/lib/keystore.ts';
import type { PublicRecord } from '../src/lib/wallet-api.ts';

const vectors = JSON.parse(readFileSync(new URL('../../wallet/test/vectors.json', import.meta.url), 'utf8')) as {
  abandon: { mnemonic: string };
};
/** The BIP39 test phrase: words everybody knows, so nothing is given away here. */
const WORDS = vectors.abandon.mnemonic;
const NOW = 1_700_000_000_000;

test('a record that holds its words does not fit PublicRecord, and what publicRecord() gives does', () => {
  /** The record of a wallet made without a passkey, as it is stored: with its 12 words. */
  const stored: WalletRecord = makeRecord('words', WORDS, NOW);
  assert.equal(stored.mnemonic, WORDS);

  // A whole record, handed over as it is. This must not compile.
  // @ts-expect-error A WalletRecord can hold its words (mnemonic), so it is no PublicRecord.
  const handedOver: PublicRecord = stored;
  // Without that error, this is what a screen would be given:
  assert.equal((handedOver as WalletRecord).mnemonic, WORDS);

  // Nor does a record written out by hand, with the words among its fields.
  const { v, kind, fingerprint, xpub, firstAddress, createdAt } = stored;
  // @ts-expect-error The field "mnemonic" may not be given a value in a PublicRecord.
  const writtenOut: PublicRecord = { v, kind, fingerprint, xpub, firstAddress, createdAt, mnemonic: WORDS };
  assert.equal(Object.keys(writtenOut).includes('mnemonic'), true);

  // The one way through: publicRecord() makes a copy without the words, and its answer fits.
  const shown: PublicRecord = publicRecord(stored);
  assert.equal('mnemonic' in shown, false, 'the field is gone, not just hidden from the compiler');
  assert.deepEqual(shown, { v, kind, fingerprint, xpub, firstAddress, createdAt });
  assert.ok(!JSON.stringify(shown).includes(WORDS));
  // The stored record itself still holds them: only the copy went without.
  assert.equal(stored.mnemonic, WORDS);

  // A passkey wallet's record never held words, and goes the same way.
  const passkey: WalletRecord = makeRecord('passkey', WORDS, NOW, { credentialId: 'Y3JlZGVudGlhbC1B', tag: '9F6D' });
  assert.equal('mnemonic' in passkey, false);
  const shownPasskey: PublicRecord = publicRecord(passkey);
  assert.deepEqual(shownPasskey, passkey);
  assert.notEqual(shownPasskey, passkey, 'a copy, not the stored object');
});
