import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountDescriptor, descriptorChecksum, withChecksum } from '../src/index.ts';

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));

test('BIP380 checksum vector', () => {
  assert.equal(withChecksum('raw(deadbeef)'), 'raw(deadbeef)#89f8spxm');
});

test('account descriptors match the frozen vectors (checksums confirmed by Bitcoin Core)', () => {
  for (const w of [V.abandon, V.prf.wallet]) {
    assert.equal(accountDescriptor(w.masterFingerprint, w.xpub, 0), w.receiveDescriptor);
    assert.equal(accountDescriptor(w.masterFingerprint, w.xpub, 1), w.changeDescriptor);
  }
});

test('descriptor input is validated', () => {
  assert.throws(() => descriptorChecksum('wpkh(é)'), /not allowed/);
  assert.throws(() => accountDescriptor('73C5DA0A', V.abandon.xpub, 0), /lower-case/);
});

test('Electrum script hash: the protocol documentation example', async () => {
  const { NETWORK } = await import('@scure/btc-signer');
  const { electrumScripthash } = await import('../src/index.ts');
  // From the Electrum protocol docs ("Script Hashes"): the genesis-block address.
  assert.equal(
    electrumScripthash('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', NETWORK),
    '8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161',
  );
});
