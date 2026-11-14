// Proves the workspace is wired: a test in app/ can import the wallet and the
// contract packages by name, and Node runs their TypeScript as it is.
//
// The wallet half re-derives the frozen passkey vector from the wallet's own
// test data. If this fails while the wallet's tests pass, the fault is in how
// the packages are linked, not in the wallet.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { API, eventPath } from '@learnbitcoin/practice-contract';
import {
  accountFromMnemonic,
  deriveAddress,
  entropyFromPrf,
  mnemonicFromEntropy,
} from '@learnbitcoin/practice-wallet';

interface Vectors {
  prf: {
    /** What the passkey returned, as hex (32 bytes). */
    prfOutput: string;
    wallet: { mnemonic: string; receive: string[] };
  };
}

const vectors = JSON.parse(
  readFileSync(new URL('../../wallet/test/vectors.json', import.meta.url), 'utf8'),
) as Vectors;

test('the wallet package: a passkey secret gives the frozen words and first address', () => {
  const prfOutput = Uint8Array.from(Buffer.from(vectors.prf.prfOutput, 'hex'));
  const words = mnemonicFromEntropy(entropyFromPrf(prfOutput));
  assert.equal(words, vectors.prf.wallet.mnemonic);

  const first = deriveAddress(accountFromMnemonic(words).key, 0, 0);
  assert.equal(first.address, vectors.prf.wallet.receive[0]);
  assert.equal(first.address, 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6');
  assert.equal(first.path, "m/84'/1'/0'/0/0");
});

test('the contract package: paths are the ones the Worker answers', () => {
  assert.equal(API.config, '/api/config');
  assert.equal(API.event, '/p/event');
  assert.equal(eventPath('receive', 'es'), '/es/wallet/receive');
});
