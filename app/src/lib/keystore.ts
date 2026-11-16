// The wallet's record: the one thing this app keeps in the browser.
//
// READ THIS BEFORE BORROWING FROM THIS FILE.
// This way of storing a wallet is acceptable for play money and for nothing else.
//
// The record is one JSON value in localStorage, under the key "lbp_wallet_v1".
//
// The two kinds of record go by how this browser keeps the wallet, not by
// how the wallet was made.
//
// For a wallet this browser opens with a passkey (kind "passkey") it holds
// nothing secret: the account's public key (enough to list the wallet's
// addresses and coins, not enough to spend them), the wallet fingerprint,
// and which passkey to ask. Such a record never holds the 12 words. They
// exist in memory after an unlock and are gone when the page is reloaded.
//
// For a wallet kept with its 12 words (kind "words": one made WITHOUT a
// passkey, or any wallet restored in this browser from its words, whatever
// it was made with) the record also holds the 12 words, as plain text, with
// no encryption. Whoever reads the words owns the wallet, and localStorage
// can be read by:
//   - every script that runs on this origin: this app's own code, every
//     library built into it and every script the page loads;
//   - browser extensions that are allowed to act on the page;
//   - anyone who can open this browser profile, and any backup or sync that
//     copies it.
// One bug that lets a stranger's script run on this page would hand that
// script the words.
//
// The app narrows that risk (a strict Content-Security-Policy, and no
// third-party code except the bot check that guards the faucet). Narrowed is
// not safe. Encrypting the words with a key that the same page can read would
// only look safer. The risk is accepted here for one reason: these are
// practice coins on a private practice network. They have no value, and the
// app says so on every screen. The most a thief can take is a practice
// session.
//
// A wallet for real money must not do this. Real seed words do not belong in
// web storage, and are never typed into a web page, this one included. They
// belong on paper or steel, with the keys in a device made to hold them.
//
// The rules this file keeps:
//   - One wallet per browser, under one key. Nothing else is kept: the test
//     value that canStore() writes is removed again at once.
//   - A record that cannot be read is never repaired and never overwritten.
//     The reader decides what happens to it.
//   - Other tabs share this storage. So every change reads the storage again,
//     inside the call, and stops unless it still holds what this tab expects.
//   - A passkey wallet's record never holds the words. It has no field for
//     them, and the two fields that name its passkey take an ID and a tag
//     and nothing else. That is checked where a record is made, where it is
//     read and where it is written.

import type { Account } from '@learnbitcoin/practice-wallet';
import {
  accountFromMnemonic,
  deriveAddress,
  normalizeMnemonic,
  watchOnlyAccount,
} from '@learnbitcoin/practice-wallet';

/** Where the record lives in localStorage. "v1" is the format's version, like the record's own `v`. */
export const RECORD_KEY = 'lbp_wallet_v1';

/** A key that canStore() writes and removes again at once. Never the record's key. */
const PROBE_KEY = 'lbp_storage_test';

export interface WalletRecord {
  /**
   * The format's version. A higher one was written by a newer app: this
   * version does not read it, and never repairs or overwrites it.
   */
  v: 1;
  /** Where the keys come from: a passkey (nothing secret is stored), or the words stored here. */
  kind: 'passkey' | 'words';
  /** The wallet fingerprint: 8 hex characters that name the wallet's master key. */
  fingerprint: string;
  /** The account's public key (tpub...), m/84'/1'/0'. It lists addresses and cannot spend. */
  xpub: string;
  /** The first receive address, m/84'/1'/0'/0/0: a check that the public key is whole and read as it was written. */
  firstAddress: string;
  /** When the record was made, in ms since 1970. */
  createdAt: number;
  /** Passkey wallets only: which passkey to ask, as base64url text. */
  credentialId?: string;
  /** Passkey wallets only: the tag in the passkey's name. */
  tag?: string;
  /** "words" wallets only: the 12 words, in plain text. See the top of this file. */
  mnemonic?: string;
}

// -- deriving -----------------------------------------------------------------

/** The first receive address of an account public key. Throws unless `xpub` is a test-network public key. */
function firstAddressOf(xpub: string): string {
  // "tpub" only. The same kind of text can carry a private key ("tprv"), and
  // that must never pass as a record's public key.
  if (!xpub.startsWith('tpub')) throw new Error('Not an account public key');
  return deriveAddress(watchOnlyAccount(xpub), 0, 0).address;
}

/** The account that 12 words give, or null when they are not a valid phrase. */
function accountOf(mnemonic: string): Account | null {
  try {
    return accountFromMnemonic(mnemonic);
  } catch {
    return null;
  }
}

/**
 * Makes the record for a wallet from its 12 words. The wallet fingerprint,
 * the public key and the first address all come from the words, through the
 * wallet package. A "words" record keeps the words. A "passkey" record never
 * does: it keeps the passkey's ID and tag instead.
 *
 * Throws for words that are not a valid phrase, for a time that is not one,
 * and for a passkey wallet without its passkey, or with an ID or a tag that
 * passkey.ts could not have written. All are faults in the caller, not
 * things a reader can do. So whatever this makes can be stored and read back.
 */
export function makeRecord(
  kind: 'passkey' | 'words',
  mnemonic: string,
  now: number,
  passkey?: { credentialId: string; tag: string | null },
): WalletRecord {
  const account = accountFromMnemonic(mnemonic);
  if (!isTime(now)) throw new Error('Not a time');
  const shared = {
    v: 1 as const,
    kind,
    fingerprint: account.masterFingerprint,
    xpub: account.xpub,
    firstAddress: firstAddressOf(account.xpub),
    createdAt: now,
  };
  if (kind === 'words') return { ...shared, mnemonic: normalizeMnemonic(mnemonic) };
  if (!passkey) throw new Error('A passkey wallet needs the ID of its passkey');
  // The messages never quote what was handed in: it might be the words.
  if (!isCredentialId(passkey.credentialId)) throw new Error('Not a passkey ID');
  if (passkey.tag !== null && !isTag(passkey.tag)) throw new Error('Not a passkey tag');
  const record: WalletRecord = { ...shared, credentialId: passkey.credentialId };
  if (passkey.tag !== null) record.tag = passkey.tag;
  return record;
}

// -- checking -----------------------------------------------------------------

const FINGERPRINT = /^[0-9a-f]{8}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The 64 characters of base64url, each at the place of the number it stands for: "A" is 0 and "_" is 63. */
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A passkey's tag: four characters of the alphabet tags are written in
 * (tagFromUserId in passkey.ts). That alphabet is frozen, so this is too.
 */
const TAG = /^[23456789CDFHJKMNPQRTVWXY]{4}$/;

/**
 * The longest passkey ID, as text. WebAuthn allows an ID 1023 bytes, which
 * base64url writes in 1364 characters, and passkey.ts names none longer.
 */
const CREDENTIAL_ID_MAX = 1364;

/** The last moment a date can hold, in ms since 1970: day 100,000,000. */
const TIME_MAX = 8_640_000_000_000_000;

/**
 * A passkey's ID as passkey.ts writes it: base64url text that can be turned
 * back into bytes, in the one spelling those bytes have.
 *
 * A character of base64 carries six bits, so four characters hold three
 * bytes. Text one character over a multiple of four is the base64 of no
 * bytes at all, so a passkey with such an ID could never be asked for. Text
 * two characters over holds one more byte and four bits to spare, and text
 * three over holds two more bytes and two bits to spare. passkey.ts writes
 * the spare bits as zeros: the last character is then one of "AQgw", or one
 * of "AEIMQUYcgkosw048".
 *
 * Text with anything else in those bits is not an ID. A browser that turns
 * it back into bytes drops the spare bits without a word, so it would ask
 * for the very same passkey. That passkey answers under its ID as it is
 * really written, and judgeUnlock, which compares the two texts, would
 * take the stored passkey for a different one. A record altered in storage
 * could use that to slip past "tampered" and "changed".
 */
function isCredentialId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > CREDENTIAL_ID_MAX || !BASE64URL.test(value)) return false;
  const over = value.length % 4;
  if (over === 1) return false;
  if (over === 0) return true;
  // The number the last character stands for. Its lowest bits are the spare ones: four of them, or two.
  const last = BASE64URL_ALPHABET.indexOf(value.charAt(value.length - 1));
  return last % (over === 2 ? 16 : 4) === 0;
}

/** A tag as passkey.ts writes it. The app shows the tag, so nothing else may pass as one. */
function isTag(value: unknown): value is string {
  return typeof value === 'string' && TAG.test(value);
}

/** A time a record can carry: whole ms since 1970 that a date can hold, so it can always be shown. */
function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= TIME_MAX;
}

/**
 * The record in `value` if it is a sound version-1 record, otherwise null.
 *
 * Sound means: the right shape; a public key that really gives the stored
 * first address; and fields that fit the kind. A passkey record has its
 * passkey's ID and no words. A "words" record has words, no passkey, and
 * those words give its fingerprint and public key. And every field holds
 * only what this app writes there: the time is a time, the ID an ID, the
 * tag a tag.
 *
 * The answer is a fresh object with the known fields only, so nothing
 * unchecked travels on into the app or back into storage.
 */
function soundRecord(value: unknown): WalletRecord | null {
  try {
    if (typeof value !== 'object' || value === null) return null;
    const fields = value as Record<string, unknown>;
    const { v, kind, fingerprint, xpub, firstAddress, createdAt, credentialId, tag, mnemonic } = fields;
    if (v !== 1) return null;
    if (typeof fingerprint !== 'string' || !FINGERPRINT.test(fingerprint)) return null;
    if (typeof xpub !== 'string' || typeof firstAddress !== 'string') return null;
    if (!isTime(createdAt)) return null;
    if (firstAddressOf(xpub) !== firstAddress) return null;

    if (kind === 'passkey') {
      if (mnemonic !== undefined) return null;
      if (!isCredentialId(credentialId)) return null;
      if (tag !== undefined && !isTag(tag)) return null;
      const record: WalletRecord = { v, kind, fingerprint, xpub, firstAddress, createdAt, credentialId };
      if (tag !== undefined) record.tag = tag;
      return record;
    }
    if (kind === 'words') {
      if (credentialId !== undefined || tag !== undefined) return null;
      if (typeof mnemonic !== 'string') return null;
      const account = accountOf(mnemonic);
      if (account === null || account.xpub !== xpub || account.masterFingerprint !== fingerprint) return null;
      return { v, kind, fingerprint, xpub, firstAddress, createdAt, mnemonic: normalizeMnemonic(mnemonic) };
    }
    return null;
  } catch {
    return null;
  }
}

// -- reading ------------------------------------------------------------------

/**
 * The text stored under RECORD_KEY: null when there is none, undefined when
 * the browser will not let this page read its storage at all.
 */
function storedText(local: Storage): string | null | undefined {
  try {
    const text = local.getItem(RECORD_KEY);
    return typeof text === 'string' ? text : null;
  } catch {
    return undefined;
  }
}

/**
 * The wallet in this browser: its record, null when nothing is stored,
 * "blocked" when the browser will not let this page read its storage at
 * all, "newer" when what is stored says it was written by a later version
 * of this app (a whole number above 1 as its `v`), or "unreadable" when it
 * is anything else that is not a sound version-1 record (damaged, or edited
 * by hand). Never throws and never writes.
 *
 * "blocked" is not null. A browser that is told to block a site's data
 * refuses the page every look at its storage and deletes nothing: a wallet
 * made before, with its 12 words if it was kept with them, is still on the
 * disk and is back the moment the block is lifted. So a page that could not
 * look does not know whether a wallet is here, and must not say that none is.
 *
 * "unreadable" and "newer" are kept apart because they end differently. An
 * unreadable record stays as it is until the reader chooses Reload or
 * Remove. A newer record may be a good wallet, met by a tab that was opened
 * before an update: this version never removes it, and the only way out it
 * offers is Reload.
 */
export function loadRecord(local: Storage): WalletRecord | null | 'unreadable' | 'newer' | 'blocked' {
  const text = storedText(local);
  if (text === undefined) return 'blocked';
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return 'unreadable';
  }
  if (isNewer(value)) return 'newer';
  return soundRecord(value) ?? 'unreadable';
}

/** Whether `value` says it was written by a later version of the format: an object whose `v` is a whole number above 1. */
function isNewer(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = (value as Record<string, unknown>).v;
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 1;
}

/**
 * The record without the 12 words: the part that may be shown, and may be
 * kept where a screen can read it. The answer is a copy with the words
 * taken out. A type that leaves the field out is not enough: the type hides
 * the words from the compiler and leaves them in the object. Use this
 * before a "words" wallet's record goes anywhere a screen can reach.
 */
export function publicRecord(record: WalletRecord): Omit<WalletRecord, 'mnemonic'> {
  const copy: WalletRecord = { ...record };
  delete copy.mnemonic;
  return copy;
}

// -- writing ------------------------------------------------------------------

/**
 * Writes a record and reads it back. False if the record is not sound (so
 * nothing unreadable, and no passkey wallet's words, can ever be written),
 * or if the browser refuses the write: a private window or a full disk
 * makes setItem throw.
 */
function writeRecord(local: Storage, record: WalletRecord): boolean {
  const sound = soundRecord(record);
  if (sound === null) return false;
  const text = JSON.stringify(sound);
  try {
    local.setItem(RECORD_KEY, text);
    return local.getItem(RECORD_KEY) === text;
  } catch {
    return false;
  }
}

/**
 * Stores a new wallet's record, unless something is stored already. False
 * means nothing was written: a record appeared meanwhile (another tab made
 * a wallet), something unreadable is in its place, or the browser refused
 * the write.
 *
 * The check and the write are two steps, and another tab could in theory
 * slip between them. localStorage offers nothing closer to one step.
 */
export function saveRecordIfNone(local: Storage, record: WalletRecord): boolean {
  if (storedText(local) !== null) return false;
  return writeRecord(local, record);
}

/**
 * Puts `record` in place of the stored one, but only if the stored one is
 * still the wallet this tab loaded (`expectFingerprint`). False means nothing
 * was written: another tab removed or changed the wallet, or the browser
 * refused the write.
 */
export function replaceRecord(local: Storage, expectFingerprint: string, record: WalletRecord): boolean {
  const stored = loadRecord(local);
  if (stored === null || typeof stored === 'string' || stored.fingerprint !== expectFingerprint) return false; // nothing, unreadable, newer or blocked
  return writeRecord(local, record);
}

/** Deletes RECORD_KEY and nothing else. Never clear(): other keys on this origin are not ours to delete. */
function deleteRecord(local: Storage): boolean {
  try {
    local.removeItem(RECORD_KEY);
    return local.getItem(RECORD_KEY) === null;
  } catch {
    return false;
  }
}

/**
 * Removes the wallet from this browser, but only if the stored record is
 * still the wallet this tab loaded (`expectFingerprint`). False means
 * nothing was deleted: the record is already gone, or it is another wallet now.
 */
export function removeWallet(local: Storage, expectFingerprint: string): boolean {
  const stored = loadRecord(local);
  if (stored === null || typeof stored === 'string' || stored.fingerprint !== expectFingerprint) return false; // nothing, unreadable, newer or blocked
  return deleteRecord(local);
}

/**
 * Removes a record that cannot be read: the "Remove" beside "Reload" when
 * loadRecord answers "unreadable". Such a record has no fingerprint to
 * expect, so the rule is the other way round: false, and nothing deleted,
 * if what is stored now is nothing at all or a sound wallet (one that
 * another tab made in the meantime).
 *
 * A record written by a newer version of this app is not "unreadable" (see
 * loadRecord): it may be a good wallet, so this answers false and leaves it
 * where it is.
 */
export function removeUnreadable(local: Storage): boolean {
  if (loadRecord(local) !== 'unreadable') return false;
  return deleteRecord(local);
}

/**
 * Whether this browser will keep a wallet: a real write, read back, about
 * the size of a record, then removed again. Asked before a wallet or a
 * passkey is made, so that neither is made in a browser that would forget it.
 */
export function canStore(local: Storage): boolean {
  const probe = 'x'.repeat(512);
  try {
    local.setItem(PROBE_KEY, probe);
    const kept = local.getItem(PROBE_KEY) === probe;
    local.removeItem(PROBE_KEY);
    return kept;
  } catch {
    try {
      local.removeItem(PROBE_KEY);
    } catch {
      // Nothing was written, or nothing can be cleaned up.
    }
    return false;
  }
}

// -- judging ------------------------------------------------------------------

/**
 * True only when the words give exactly the record's public key. Words that
 * are not a valid phrase give false. It says nothing about the record's
 * wallet fingerprint: to decide whether typed words unlock the wallet that
 * is here, the app asks judgeWords, below.
 */
export function wordsMatchRecord(record: WalletRecord, mnemonic: string): boolean {
  const account = accountOf(mnemonic);
  return account !== null && account.xpub === record.xpub;
}

/**
 * same      the words give the record's public key and its wallet fingerprint:
 *           they are this wallet's words
 * tampered  they give exactly one of the two: the record was altered
 * other     they give neither (or are no valid phrase): another wallet's words
 */
export type WordsVerdict = 'same' | 'tampered' | 'other';

/**
 * Decides what typed words mean for the wallet in this browser, by the same
 * pair judgeUnlock goes by: the stored public key and the stored wallet
 * fingerprint. Both come from the same 12 words, so words that fit one and
 * not the other show that the record was altered. Going by the public key
 * alone would miss an altered fingerprint, and would turn the reader's own
 * words away as "another wallet's" when it was the public key that had been
 * swapped.
 */
export function judgeWords(record: WalletRecord, mnemonic: string): WordsVerdict {
  const account = accountOf(mnemonic);
  if (account === null) return 'other';
  const sameKey = account.xpub === record.xpub;
  const sameFingerprint = account.masterFingerprint === record.fingerprint;
  if (sameKey && sameFingerprint) return 'same';
  return sameKey || sameFingerprint ? 'tampered' : 'other';
}

/**
 * adopt          this browser has no record: take the wallet the passkey gave
 * same           the stored passkey gave the stored wallet: load its keys
 * other-passkey  a different passkey answered: ask before switching wallets
 * tampered       the stored passkey gave a wallet that fits exactly one of
 *                the two things the record says about it (its public key,
 *                its wallet fingerprint): the record was altered; rebuild it
 * changed        the stored passkey gave a wallet that fits neither: never
 *                open it, never overwrite the record
 */
export type UnlockVerdict = 'adopt' | 'same' | 'other-passkey' | 'changed' | 'tampered';

/**
 * Decides what a passkey's answer means for the wallet in this browser.
 * `credentialId` is the passkey that answered and `mnemonic` the 12 words
 * its secret gives.
 *
 * The stored public key is what the app has been showing addresses from,
 * and the stored fingerprint is what names the wallet. "same" needs both to
 * be exactly what the words give. One right and one wrong cannot come from
 * a passkey (both come from the same 12 words), so the record was altered:
 * "tampered". The keys are the wallet, so the record is rebuilt from them.
 * With the public key wrong, the addresses shown since the last unlock were
 * another wallet's; with only the fingerprint wrong they were this one's.
 * The text for "tampered" has to be true in both cases.
 *
 * Nothing in a passkey record vouches for either field: whoever can write
 * this browser's storage can change both. When neither fits, nothing here
 * can tell a record that was replaced whole from a passkey that really
 * gives another wallet (some do, over a phone's QR code). Both are
 * "changed": nothing is opened and nothing is overwritten. So the text for
 * "changed" has to allow for a record that was altered, and must not say
 * that the addresses shown so far were this wallet's.
 */
export function judgeUnlock(record: WalletRecord | null, credentialId: string, mnemonic: string): UnlockVerdict {
  if (record === null) return 'adopt';
  // Whatever the words give: another passkey is another wallet's business.
  if (record.credentialId !== credentialId) return 'other-passkey';
  const account = accountOf(mnemonic);
  // Words that give no wallet at all cannot be this one. The safe answer is the one that opens nothing.
  if (account === null) return 'changed';
  const sameKey = account.xpub === record.xpub;
  const sameFingerprint = account.masterFingerprint === record.fingerprint;
  if (sameKey && sameFingerprint) return 'same';
  return sameKey || sameFingerprint ? 'tampered' : 'changed';
}
