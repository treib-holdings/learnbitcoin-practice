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
