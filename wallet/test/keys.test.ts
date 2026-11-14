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

test('normalizeMnemonic takes words apart at exactly the white space a regular expression would', () => {
  // The words are split without a regular expression (keys.ts says why).
  // This is the split it replaced, kept here to compare the two. No real
  // words go through it.
  const withPattern = (text: string): string => text.trim().toLowerCase().split(/\s+/).join(' ');

  // Every character there is in one UTF-16 unit, alone between two letters:
  // the two ways agree on which of them part words.
  const spaces: number[] = [];
  for (let code = 0; code <= 0xffff; code += 1) {
    const text = `a${String.fromCharCode(code)}b`;
    const tidy = normalizeMnemonic(text);
    assert.equal(tidy, withPattern(text), `U+${code.toString(16)}`);
    if (tidy === 'a b') spaces.push(code);
  }
  // A space, a tab, the line breaks, a no-break space, the wide and narrow spaces of typography, a byte-order mark.
  assert.deepEqual(
    spaces,
    [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff],
  );

  // Texts as people leave them, and texts nobody would type.
  const texts = [
    '',
    ' ',
    ' \t\n ',
    'word',
    ' Word ',
    'one two',
    'one  two\tthree\nfour\r\nfive',
    `\u00a0one\u3000two\u2003three\ufeff`,
    'UPPER lower MiXeD',
    `caf${String.fromCodePoint(0xc9)} ${String.fromCodePoint(0x130)}stanbul ${String.fromCodePoint(0x1f600)} ${String.fromCodePoint(0x1e9e)}`,
    `${String.fromCharCode(0xd83d)} a lone half ${String.fromCharCode(0xde00)} of a pair`,
    `  ${ABANDON.toUpperCase().replaceAll(' ', ' \t ')}\n`,
  ];
  for (const text of texts) assert.equal(normalizeMnemonic(text), withPattern(text), JSON.stringify(text));
  assert.equal(normalizeMnemonic(''), '');
  assert.equal(normalizeMnemonic(' \n\t '), '');

  // A few thousand made of letters and every kind of white space, the same ones on every run.
  let seed = 20261114;
  const below = (n: number): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 2 ** 32) * n);
  };
  const pieces = ['a', 'B', 'zoo', 'Legal', 'WINNER', ...spaces.map((code) => String.fromCharCode(code))];
  for (let n = 0; n < 3000; n += 1) {
    const text = Array.from({ length: below(30) }, () => pieces[below(pieces.length)]).join('');
    assert.equal(normalizeMnemonic(text), withPattern(text), JSON.stringify(text));
  }
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
