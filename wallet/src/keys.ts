// Keys for the practice wallet.
//
// Two ways to get the 12 words:
//   1. From a passkey: the WebAuthn PRF extension returns 32 secret bytes for
//      a fixed input (PRF_INPUT_V1). HKDF turns them into 16 bytes of BIP39
//      entropy, which encode as 12 words. The same passkey always gives the
//      same words, so the passkey can rebuild the wallet on any device it
//      syncs to.
//   2. Without a passkey: 16 random bytes from the browser.
//
// Either way the result is an ordinary BIP39 seed and a BIP84 account, so
// the same words restore the same wallet in Sparrow or Bitcoin Core.

import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { p2wpkh } from '@scure/btc-signer';
import type { BTC_NETWORK } from '@scure/btc-signer/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { ACCOUNT_PATH, REGTEST, TEST_VERSIONS } from './network.ts';

/**
 * The input every practice-wallet passkey is asked to evaluate (version 1).
 * Frozen: changing a single byte gives every reader a different wallet.
 */
export const PRF_INPUT_V1: Uint8Array = sha256(utf8ToBytes('LearnBitcoin practice wallet v1'));

const HKDF_INFO_V1 = utf8ToBytes('learnbitcoin-practice/bip39-entropy/v1');

/** 16 bytes of BIP39 entropy from a 32-byte passkey PRF output (HKDF-SHA256, no salt). */
export function entropyFromPrf(prfOutput: Uint8Array): Uint8Array {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length !== 32) {
    throw new Error('A passkey PRF output must be exactly 32 bytes');
  }
  return hkdf(sha256, prfOutput, undefined, HKDF_INFO_V1, 16);
}

/** 12 English BIP39 words for 16 bytes of entropy. */
export function mnemonicFromEntropy(entropy: Uint8Array): string {
  if (entropy.length !== 16) throw new Error('The practice wallet uses 16 bytes of entropy (12 words)');
  return entropyToMnemonic(entropy, wordlist);
}

/** 12 words from the browser's random number generator (the no-passkey path). */
export function newMnemonic(): string {
  return generateMnemonic(wordlist, 128);
}

/** Lower-case, single spaces, no stray whitespace: how people type words back in. */
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().split(/\s+/).join(' ');
}

/** True for a valid 12-word English BIP39 phrase (checksum included). */
export function isValidMnemonic(mnemonic: string): boolean {
  const words = normalizeMnemonic(mnemonic);
  return words.split(' ').length === 12 && validateMnemonic(words, wordlist);
}

/** A BIP84 account: the private account key plus what can be shown or exported safely. */
export interface Account {
  /** BIP32 fingerprint of the master key, 8 hex characters (e.g. "73c5da0a"). */
  masterFingerprint: string;
  /** Account-level extended public key (tpub...), m/84'/1'/0'. */
  xpub: string;
  /** Account-level extended private key. Never leaves the browser. */
  key: HDKey;
}

/** BIP32 fingerprints are 32-bit numbers; show them as 8 hex characters. */
export function fingerprintHex(fingerprint: number): string {
  return (fingerprint >>> 0).toString(16).padStart(8, '0');
}

/** The practice account (m/84'/1'/0') for a 12-word phrase and optional passphrase. */
export function accountFromMnemonic(mnemonic: string, passphrase = ''): Account {
  const words = normalizeMnemonic(mnemonic);
  if (!isValidMnemonic(words)) throw new Error('Not a valid 12-word phrase');
  const master = HDKey.fromMasterSeed(mnemonicToSeedSync(words, passphrase), TEST_VERSIONS);
  const key = master.derive(ACCOUNT_PATH);
  return { masterFingerprint: fingerprintHex(master.fingerprint), xpub: key.publicExtendedKey, key };
}

/** A watch-only view of an account from its tpub: can list addresses, cannot sign. */
export function watchOnlyAccount(xpub: string): HDKey {
  return HDKey.fromExtendedKey(xpub, TEST_VERSIONS);
}

/** 0 = receive addresses, 1 = change addresses (BIP44 "change" level). */
export type Chain = 0 | 1;

export interface DerivedAddress {
  chain: Chain;
  index: number;
  address: string;
  /** The output script (scriptPubKey) this address pays to. */
  script: Uint8Array;
  publicKey: Uint8Array;
  /** Full path from the master key, e.g. m/84'/1'/0'/0/3. */
  path: string;
}

/** Native segwit (P2WPKH) address at chain/index below an account key. */
export function deriveAddress(account: HDKey, chain: Chain, index: number, network: BTC_NETWORK = REGTEST): DerivedAddress {
  const child = account.deriveChild(chain).deriveChild(index);
  if (!child.publicKey) throw new Error('Key derivation failed');
  const payment = p2wpkh(child.publicKey, network);
  if (!payment.address) throw new Error('Address encoding failed');
  return {
    chain,
    index,
    address: payment.address,
    script: payment.script,
    publicKey: child.publicKey,
    path: `${ACCOUNT_PATH}/${chain}/${index}`,
  };
}

/** The private key for chain/index. Needs the private account key. */
export function privateKeyAt(account: HDKey, chain: Chain, index: number): Uint8Array {
  const child = account.deriveChild(chain).deriveChild(index);
  if (!child.privateKey) throw new Error('This account is watch-only and cannot sign');
  return child.privateKey;
}
