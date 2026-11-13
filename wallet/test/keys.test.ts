import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { NETWORK } from '@scure/btc-signer';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  PRF_INPUT_V1,
  accountFromMnemonic,
  deriveAddress,
  entropyFromPrf,
  isValidMnemonic,
  mnemonicFromEntropy,
  newMnemonic,
  normalizeMnemonic,
  privateKeyAt,
  watchOnlyAccount,
} from '../src/index.ts';

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const ABANDON = V.abandon.mnemonic as string;

test('BIP39: 16 zero bytes encode as "abandon ... about"', () => {
  assert.equal(mnemonicFromEntropy(new Uint8Array(16)), ABANDON);
});

test('BIP84 published mainnet vectors anchor the derivation code', () => {
  // From BIP84's test vectors. Mainnet appears only here, to prove the
  // path/child/P2WPKH code against a published source.
  const account = HDKey.fromMasterSeed(mnemonicToSeedSync(ABANDON)).derive("m/84'/0'/0'");
  assert.equal(deriveAddress(account, 0, 0, NETWORK).address, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  assert.equal(deriveAddress(account, 0, 1, NETWORK).address, 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
  assert.equal(deriveAddress(account, 1, 0, NETWORK).address, 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el');
});

test('practice account (m/84\'/1\'/0\') matches the frozen regtest vectors', () => {
  for (const w of [V.abandon, V.prf.wallet]) {
    const a = accountFromMnemonic(w.mnemonic);
    assert.equal(a.masterFingerprint, w.masterFingerprint);
    assert.equal(a.xpub, w.xpub);
    w.receive.forEach((addr: string, i: number) => assert.equal(deriveAddress(a.key, 0, i).address, addr));
    w.change.forEach((addr: string, i: number) => assert.equal(deriveAddress(a.key, 1, i).address, addr));
  }
  assert.equal(V.abandon.masterFingerprint, '73c5da0a'); // the well-known fingerprint of "abandon ... about"
});

test('addresses are regtest only (bcrt1q)', () => {
  const a = accountFromMnemonic(ABANDON);
  for (let i = 0; i < 5; i++) assert.match(deriveAddress(a.key, 0, i).address, /^bcrt1q[02-9ac-hj-np-z]{38}$/);
  assert.equal(deriveAddress(a.key, 0, 0).path, "m/84'/1'/0'/0/0");
});

test('passkey PRF output -> entropy -> words is frozen (v1)', () => {
  assert.equal(bytesToHex(PRF_INPUT_V1), V.prfInputV1);
  const entropy = entropyFromPrf(hexToBytes(V.prf.prfOutput));
  assert.equal(bytesToHex(entropy), V.prf.entropy); // also checked against Python's hmac/hashlib HKDF
  assert.equal(mnemonicFromEntropy(entropy), V.prf.wallet.mnemonic);
});

test('PRF outputs must be exactly 32 bytes', () => {
  assert.throws(() => entropyFromPrf(new Uint8Array(31)));
  assert.throws(() => entropyFromPrf(new Uint8Array(33)));
});

test('typed-in words are normalized and checked', () => {
  assert.equal(normalizeMnemonic(`  ${ABANDON.toUpperCase().replaceAll(' ', '   ')}\n`), ABANDON);
  assert.ok(isValidMnemonic(ABANDON.toUpperCase()));
  assert.ok(!isValidMnemonic(ABANDON.replace(/about$/, 'abandon')), 'bad checksum word');
  assert.ok(!isValidMnemonic(`${ABANDON} ${ABANDON}`), '24 words are not a practice phrase');
  assert.throws(() => accountFromMnemonic('not a real phrase at all'));
});

test('a passphrase opens a different wallet', () => {
  assert.notEqual(accountFromMnemonic(ABANDON, 'TREZOR').xpub, accountFromMnemonic(ABANDON).xpub);
});

test('new phrases are random, valid and 12 words', () => {
  const a = newMnemonic();
  const b = newMnemonic();
  assert.notEqual(a, b);
  assert.ok(isValidMnemonic(a));
  assert.equal(a.split(' ').length, 12);
});

test('watch-only account derives the same addresses but cannot sign', () => {
  const a = accountFromMnemonic(ABANDON);
  const w = watchOnlyAccount(a.xpub);
  assert.equal(deriveAddress(w, 0, 3).address, deriveAddress(a.key, 0, 3).address);
  assert.throws(() => privateKeyAt(w, 0, 0), /watch-only/);
});
