// keystore.ts against fake storage.
//
// The stand-ins for localStorage: one that keeps its values in a Map, one
// that refuses every write (a private window, a full disk), one that drops
// writes without a word, and one that cannot be touched at all. Two tabs
// are two callers sharing one of them.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { accountFromMnemonic } from '@learnbitcoin/practice-wallet';
import {
  RECORD_KEY,
  canStore,
  judgeUnlock,
  judgeWords,
  loadRecord,
  makeRecord,
  publicRecord,
  removeUnreadable,
  removeWallet,
  replaceRecord,
  saveRecordIfNone,
  wordsMatchRecord,
} from '../src/lib/keystore.ts';
import type { UnlockVerdict, WalletRecord } from '../src/lib/keystore.ts';
import { tagFromUserId } from '../src/lib/passkey.ts';

interface VectorWallet {
  mnemonic: string;
  masterFingerprint: string;
  xpub: string;
  receive: string[];
  change: string[];
}

const vectors = JSON.parse(readFileSync(new URL('../../wallet/test/vectors.json', import.meta.url), 'utf8')) as {
  abandon: VectorWallet;
  prf: { wallet: VectorWallet };
};

/** Two wallets with frozen values: A and B. */
const A = vectors.abandon;
const B = vectors.prf.wallet;

/** A wallet's first receive address, m/84'/1'/0'/0/0. */
function firstOf(wallet: VectorWallet): string {
  const address = wallet.receive[0];
  assert.ok(address);
  return address;
}

const NOW = 1_700_000_000_000;
const PASSKEY_A = { credentialId: 'Y3JlZGVudGlhbC1B', tag: '9F6D' };
const PASSKEY_B = { credentialId: 'Y3JlZGVudGlhbC1C', tag: 'CDFH' };

const wordsRecord = (wallet: VectorWallet = A): WalletRecord => makeRecord('words', wallet.mnemonic, NOW);
const passkeyRecord = (wallet: VectorWallet = A, passkey = PASSKEY_A): WalletRecord =>
  makeRecord('passkey', wallet.mnemonic, NOW, passkey);

// -- fake storage ---------------------------------------------------------------

/** localStorage for one origin, kept in a Map. It counts every call that changes something. */
class MemoryStorage {
  readonly map = new Map<string, string>();
  writes = 0;
  cleared = 0;
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.cleared += 1;
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.writes += 1;
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.writes += 1;
    this.map.set(key, String(value));
  }
}

/** Reads work; every write throws, as in a private window of some browsers or on a full disk. */
class FullStorage extends MemoryStorage {
  setItem(): void {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  }
  removeItem(): void {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
}

/** Accepts writes and forgets them. */
class ForgetfulStorage extends MemoryStorage {
  setItem(): void {
    this.writes += 1;
  }
}

/** Storage the browser has switched off for this page: every call throws. */
class LockedStorage extends MemoryStorage {
  getItem(): string | null {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  setItem(): void {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  removeItem(): void {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
}

/** Writes would work, but nothing can be read: there is no telling what is stored. */
class BlindStorage extends MemoryStorage {
  getItem(): string | null {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
}

/** A storage that already holds `value` under the record's key (put there without counting as a write). */
function holding<S extends MemoryStorage>(storage: S, value: WalletRecord | string): S {
  storage.map.set(RECORD_KEY, typeof value === 'string' ? value : JSON.stringify(value));
  return storage;
}

const stored = (storage: MemoryStorage): string | undefined => storage.map.get(RECORD_KEY);

// -- makeRecord -----------------------------------------------------------------

test('the record lives under one documented key', () => {
  assert.equal(RECORD_KEY, 'lbp_wallet_v1');
});

test('makeRecord: fingerprint, public key and first address come from the words', () => {
  for (const wallet of [A, B]) {
    const record = wordsRecord(wallet);
    assert.deepEqual(record, {
      v: 1,
      kind: 'words',
      fingerprint: wallet.masterFingerprint,
      xpub: wallet.xpub,
      firstAddress: wallet.receive[0],
      createdAt: NOW,
      mnemonic: wallet.mnemonic,
    });
  }
  assert.equal(wordsRecord(A).fingerprint, '73c5da0a');
  assert.equal(wordsRecord(A).firstAddress, 'bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk');
  // Words as people type them are stored the way the wallet package writes them.
  const typed = `  ${A.mnemonic.toUpperCase().replaceAll(' ', '  ')}\n`;
  assert.deepEqual(makeRecord('words', typed, NOW), wordsRecord(A));
});

test('makeRecord: a words record holds the words; a passkey record never does', () => {
  const words = wordsRecord(A);
  assert.equal(words.mnemonic, A.mnemonic);
  assert.ok(!('credentialId' in words) && !('tag' in words));
  // A passkey handed in by mistake does not turn up in a words record.
  assert.deepEqual(makeRecord('words', A.mnemonic, NOW, PASSKEY_A), words);

  const passkey = passkeyRecord(A);
  assert.deepEqual(passkey, {
    v: 1,
    kind: 'passkey',
    fingerprint: A.masterFingerprint,
    xpub: A.xpub,
    firstAddress: A.receive[0],
    createdAt: NOW,
    credentialId: PASSKEY_A.credentialId,
    tag: PASSKEY_A.tag,
  });
  assert.ok(!('mnemonic' in passkey));
  assert.ok(!JSON.stringify(passkey).includes(A.mnemonic));

  // A passkey whose tag is not known: the record simply has none.
  const untagged = makeRecord('passkey', A.mnemonic, NOW, { credentialId: PASSKEY_A.credentialId, tag: null });
  assert.ok(!('tag' in untagged));
  assert.equal(untagged.credentialId, PASSKEY_A.credentialId);
});

test('makeRecord: refuses words that are not a wallet, and a passkey wallet without its passkey', () => {
  assert.throws(() => makeRecord('words', 'not a real phrase at all', NOW));
  assert.throws(() => makeRecord('words', A.mnemonic.replace(/about$/, 'abandon'), NOW), 'bad checksum');
  assert.throws(() => makeRecord('passkey', A.mnemonic, NOW));
});

test('makeRecord: refuses a passkey ID, a tag or a time that a record cannot hold', () => {
  const credentialId = PASSKEY_A.credentialId;

  // The two fields that name the passkey take an ID and a tag and nothing
  // else: not a sentence, and not the 12 words handed in by mistake. The
  // error never quotes what it was given.
  const notTags = ['', '9F6', '9F6D2', '9f6d', '9F6O', ' 9F6D', '9F6D\n', 'a tag', A.mnemonic];
  for (const tag of notTags) {
    assert.throws(
      () => makeRecord('passkey', A.mnemonic, NOW, { credentialId, tag }),
      /^Error: Not a passkey tag$/,
      JSON.stringify(tag),
    );
  }
  // "QR" and "QUJ" are "QQ" and "QUI" with a stray bit in the last character: see the spelling test below.
  const notIds = ['', 'A', 'AAAAA', 'not base64url!', 'Y3Jl+ZA==', A.mnemonic, 'A'.repeat(1366), 'QR', 'QUJ', '3q2-7wECAwQFBh'];
  for (const id of notIds) {
    assert.throws(
      () => makeRecord('passkey', A.mnemonic, NOW, { credentialId: id, tag: null }),
      /^Error: Not a passkey ID$/,
      id.slice(0, 40),
    );
  }

  // The time is whole milliseconds since 1970 that a date can hold.
  const notTimes = [Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5, NOW + 0.5, 8_640_000_000_000_001, 1e300];
  for (const now of notTimes) {
    assert.throws(() => makeRecord('words', A.mnemonic, now), /^Error: Not a time$/, String(now));
    assert.throws(() => makeRecord('passkey', A.mnemonic, now, PASSKEY_A), /^Error: Not a time$/, String(now));
  }
});

// -- round trips ----------------------------------------------------------------

test('round trip: what is saved is what is loaded, for both kinds of wallet', () => {
  const untagged = makeRecord('passkey', A.mnemonic, NOW, { credentialId: 'QQ', tag: null });
  for (const record of [wordsRecord(A), passkeyRecord(B, PASSKEY_B), untagged]) {
    const local = new MemoryStorage();
    assert.equal(loadRecord(local), null);
    assert.equal(saveRecordIfNone(local, record), true);
    assert.deepEqual(loadRecord(local), record);
    // One key, holding the record as JSON, fields in the documented order.
    assert.deepEqual([...local.map.keys()], [RECORD_KEY]);
    assert.equal(stored(local), JSON.stringify(record));
    assert.deepEqual(Object.keys(JSON.parse(stored(local) ?? '') as object).slice(0, 6), [
      'v',
      'kind',
      'fingerprint',
      'xpub',
      'firstAddress',
      'createdAt',
    ]);
  }
});

test('the edges of a sound record: the first and the last moment, the shortest and the longest passkey ID', () => {
  const LAST = 8_640_000_000_000_000; // the last millisecond a date can hold
  const longest = Buffer.from(new Uint8Array(1023)).toString('base64url');
  assert.equal(longest.length, 1364);
  const edges: WalletRecord[] = [
    makeRecord('words', A.mnemonic, 0),
    makeRecord('words', A.mnemonic, LAST),
    makeRecord('passkey', A.mnemonic, 0, PASSKEY_A),
    makeRecord('passkey', A.mnemonic, LAST, PASSKEY_A),
    makeRecord('passkey', A.mnemonic, NOW, { credentialId: 'QQ', tag: '2222' }),
    makeRecord('passkey', A.mnemonic, NOW, { credentialId: 'QUI', tag: 'YYYY' }),
    makeRecord('passkey', A.mnemonic, NOW, { credentialId: longest, tag: null }),
  ];
  for (const record of edges) {
    const local = new MemoryStorage();
    assert.equal(saveRecordIfNone(local, record), true);
    assert.deepEqual(loadRecord(local), record);
  }
  // Every time a record can carry is one a date can hold, so it can always be shown.
  assert.ok(!Number.isNaN(new Date(0).getTime()));
  assert.ok(!Number.isNaN(new Date(LAST).getTime()));
  assert.ok(Number.isNaN(new Date(LAST + 1).getTime()));
});

test('what passkey.ts writes is what a record takes: every tag, and an ID up to the longest', () => {
  const record = passkeyRecord(A);
  const takes = (fields: Partial<WalletRecord>): boolean =>
    loadRecord(holding(new MemoryStorage(), { ...record, ...fields })) !== 'unreadable';

  // Every character a tag is written in, in each of its four places ...
  const alphabet = new Set<string>();
  for (let byte = 0; byte < 256; byte++) alphabet.add(tagFromUserId(Uint8Array.from([byte])).charAt(0));
  assert.equal(alphabet.size, 24);
  for (const c of alphabet) {
    for (const tag of [`${c}222`, `2${c}22`, `22${c}2`, `222${c}`]) assert.equal(takes({ tag }), true, tag);
  }
  // ... and no other character in any of them.
  for (let code = 0x20; code < 0x7f; code++) {
    const c = String.fromCharCode(code);
    if (alphabet.has(c)) continue;
    for (const tag of [`${c}222`, `2${c}22`, `22${c}2`, `222${c}`]) {
      assert.equal(takes({ tag }), false, JSON.stringify(tag));
    }
  }
  // A real tag, from a real user.id.
  assert.equal(takes({ tag: tagFromUserId(Uint8Array.from([0x7f, 0x3a, 0xc4, 0x09])) }), true);

  // An ID is 1 to 1023 bytes, written as base64url. passkey.ts names nothing longer.
  for (const bytes of [1, 2, 3, 4, 5, 16, 20, 32, 64, 1022, 1023]) {
    const credentialId = Buffer.from(new Uint8Array(bytes).fill(0xfb)).toString('base64url');
    assert.equal(takes({ credentialId }), true, `${bytes} bytes`);
  }
  assert.equal(takes({ credentialId: Buffer.from(new Uint8Array(1024)).toString('base64url') }), false);
});

test('a passkey ID has one spelling: the spare bits of its last character are zeros', () => {
  const record = passkeyRecord(A);
  const takes = (credentialId: string): boolean => loadRecord(holding(new MemoryStorage(), { ...record, credentialId })) !== 'unreadable';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  assert.equal(new Set(alphabet).size, 64);
  /** The text passkey.ts would write for the bytes this text stands for. Reading drops the spare bits; writing puts zeros there. */
  const asWritten = (text: string): string => Buffer.from(text, 'base64url').toString('base64url');

  // Four characters hold three bytes, with no bit to spare: every character can end such an ID.
  // Two characters over a multiple of four hold one more byte and four spare bits; three over, two more bytes and two spare bits.
  const shapes: [name: string, start: string, endings: string][] = [
    ['a multiple of four', 'AAA', alphabet],
    ['a multiple of four', '-__-AAA', alphabet],
    ['two over', 'A', 'AQgw'],
    ['two over', '-__-P', 'AQgw'],
    ['three over', 'AA', 'AEIMQUYcgkosw048'],
    ['three over', '3q2-7wECAwQFBg', 'AEIMQUYcgkosw048'],
  ];
  for (const [name, start, endings] of shapes) {
    const taken: string[] = [];
    for (const last of alphabet) {
      const id = `${start}${last}`;
      const where = `${name}: ${id}`;
      const isTaken = takes(id);
      // Worked out here a second way: an ID is taken exactly when writing its bytes again gives the same text.
      assert.equal(isTaken, asWritten(id) === id, where);
      if (isTaken) {
        taken.push(last);
        continue;
      }
      // Refused, though it stands for the very bytes of an ID that is taken:
      // the same passkey under another spelling, different in the last character only.
      assert.deepEqual(Buffer.from(id, 'base64url'), Buffer.from(asWritten(id), 'base64url'), where);
      assert.equal(asWritten(id).slice(0, -1), start, where);
      assert.ok(endings.includes(asWritten(id).slice(-1)), where);
    }
    assert.equal(taken.join(''), endings, `${name}, after ${start}`);
  }
  // makeRecord goes by the same rule.
  assert.doesNotThrow(() => makeRecord('passkey', A.mnemonic, NOW, { credentialId: '3q2-7wECAwQFBg', tag: null }));
  for (const id of ['3q2-7wECAwQFBh', '3q2-7wECAwQFBv', '3q2-7wECAwQFBgB', '3q2-7wECAwQFBg_']) {
    assert.throws(() => makeRecord('passkey', A.mnemonic, NOW, { credentialId: id, tag: null }), /^Error: Not a passkey ID$/, id);
  }

  // Whatever passkey.ts hands over is spelled that way: bytes of every length, with every bit set in the last one.
  for (let length = 1; length <= 9; length++) {
    for (const lastByte of [0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff]) {
      const bytes = new Uint8Array(length).fill(0xa5);
      bytes[length - 1] = lastByte;
      assert.equal(takes(Buffer.from(bytes).toString('base64url')), true, `${length} bytes ending in ${lastByte}`);
    }
  }
});

test('a passkey wallet stores nothing secret; a words wallet stores its words', () => {
  const local = new MemoryStorage();
  saveRecordIfNone(local, passkeyRecord(B, PASSKEY_B));
  const text = stored(local) ?? '';
  assert.deepEqual(Object.keys(JSON.parse(text) as object), [
    'v',
    'kind',
    'fingerprint',
    'xpub',
    'firstAddress',
    'createdAt',
    'credentialId',
    'tag',
  ]);
  assert.ok(!text.includes(B.mnemonic));
  assert.ok(!text.includes('tprv'));

  const other = new MemoryStorage();
  saveRecordIfNone(other, wordsRecord(B));
  assert.ok((stored(other) ?? '').includes(B.mnemonic), 'for a words wallet the record is the wallet');
});

// -- loadRecord -----------------------------------------------------------------

test('loadRecord: null when nothing is stored; "blocked", and never null, when the storage cannot be read', () => {
  const empty = new MemoryStorage();
  empty.map.set('another_key', 'not ours');
  assert.equal(loadRecord(empty), null);
  assert.equal(empty.writes, 0);
  // A storage that refuses to be read is not an empty one: "null" would be taken as "no wallet here".
  assert.equal(loadRecord(new LockedStorage()), 'blocked');
  // The state a reader gets to: a wallet was made, and then the browser was told to block this site's data.
  // The browser refuses every look and deletes nothing: the record, with its 12 words, is still on the disk.
  for (const record of [wordsRecord(A), passkeyRecord(A)]) {
    const blind = holding(new BlindStorage(), record);
    assert.equal(loadRecord(blind), 'blocked', record.kind);
    assert.equal(stored(blind), JSON.stringify(record), 'what was stored is still stored');
    assert.equal(blind.writes, 0);
    const locked = holding(new LockedStorage(), record);
    assert.equal(loadRecord(locked), 'blocked', record.kind);
    assert.equal(stored(locked), JSON.stringify(record));
  }
  // And it is "blocked" whatever is stored: damaged text and a newer version's record cannot be told apart from
  // a sound wallet, or from nothing, by a page that cannot look.
  for (const text of ['not json', JSON.stringify({ v: 2 }), '']) assert.equal(loadRecord(holding(new BlindStorage(), text)), 'blocked', text);
});

test('loadRecord: unreadable for anything that is not a sound version-1 record', () => {
  const words = wordsRecord(A);
  const passkey = passkeyRecord(A);
  const privateKey = accountFromMnemonic(A.mnemonic).key.privateExtendedKey;
  const { credentialId: _id, ...passkeyWithoutId } = passkey;
  const { mnemonic: _words, ...wordsWithoutWords } = words;
  const notAPhrase = A.mnemonic.replace(/about$/, 'abandon'); // the last word breaks the checksum
  const damagedKey = `${A.xpub.slice(0, -1)}${A.xpub.endsWith('M') ? 'N' : 'M'}`;

  const cases: [name: string, value: unknown][] = [
    // Not JSON.
    ['empty text', ''],
    ['cut off', JSON.stringify(words).slice(0, 40)],
    ['plain text', 'lbp'],
    ['the word undefined', 'undefined'],
    // JSON of the wrong shape.
    ['null', 'null'],
    ['true', 'true'],
    ['a number', '42'],
    ['a string', '"lbp_wallet_v1"'],
    ['an array', '[]'],
    ['an array holding a record', [words]],
    ['an empty object', {}],
    // The version.
    ['version 0', { ...words, v: 0 }],
    ['the version as text', { ...words, v: '1' }],
    ['no version', { ...words, v: undefined }],
    // The kind.
    ['an unknown kind', { ...words, kind: 'hardware' }],
    ['no kind', { ...words, kind: undefined }],
    // Kind and fields that do not fit.
    ['a passkey record with words', { ...passkey, mnemonic: A.mnemonic }],
    ['a passkey record with an empty mnemonic', { ...passkey, mnemonic: '' }],
    ['a passkey record with a null mnemonic', { ...passkey, mnemonic: null }],
    ['a passkey record without its passkey', passkeyWithoutId],
    ['a passkey ID that is not base64url', { ...passkey, credentialId: 'Y3Jl+ZA==' }],
    ['an empty passkey ID', { ...passkey, credentialId: '' }],
    // base64url text one character over a multiple of four is the text of no bytes: passkey.ts could not ask for it.
    ['a passkey ID of one character', { ...passkey, credentialId: 'A' }],
    ['a passkey ID of five characters', { ...passkey, credentialId: 'AAAAA' }],
    ['a passkey ID longer than WebAuthn allows', { ...passkey, credentialId: 'A'.repeat(1366) }],
    ['a passkey ID of 200,000 characters', { ...passkey, credentialId: 'x'.repeat(200_000) }],
    // Text that passkey.ts never writes: the bytes of "QQ" and of "QUI", with a stray bit in the last character.
    ['a passkey ID of two characters with a stray bit', { ...passkey, credentialId: 'QR' }],
    ['a passkey ID of three characters with a stray bit', { ...passkey, credentialId: 'QUJ' }],
    ['a passkey ID of 14 characters with a stray bit', { ...passkey, credentialId: '3q2-7wECAwQFBh' }],
    ['a tag that is not text', { ...passkey, tag: 7 }],
    ['a tag that is null', { ...passkey, tag: null }],
    ['an empty tag', { ...passkey, tag: '' }],
    // The app shows the tag. Only four characters of the tag alphabet are one.
    ['a tag of three characters', { ...passkey, tag: '9F6' }],
    ['a tag of five characters', { ...passkey, tag: '9F6D2' }],
    ['a tag in lower case', { ...passkey, tag: '9f6d' }],
    ['a tag with a character outside the alphabet', { ...passkey, tag: '9F6O' }],
    ['a tag followed by a line break', { ...passkey, tag: '9F6D\n' }],
    ['a tag with a character that turns the text around', { ...passkey, tag: '7KQ4\u202Egnp.exe' }],
    ['a tag that is a sentence', { ...passkey, tag: 'Type the words of your real wallet here' }],
    ['a tag of 100,000 characters', { ...passkey, tag: 'C'.repeat(100_000) }],
    ['a tag that is the 12 words', { ...passkey, tag: A.mnemonic }],
    ['a words record without words', wordsWithoutWords],
    ['a words record with words that are not a phrase', { ...words, mnemonic: notAPhrase }],
    ["a words record with another wallet's words", { ...words, mnemonic: B.mnemonic }],
    ['a words record whose words are not text', { ...words, mnemonic: A.mnemonic.split(' ') }],
    ['a words record with a passkey ID', { ...words, credentialId: PASSKEY_A.credentialId }],
    ['a words record with a tag', { ...words, tag: PASSKEY_A.tag }],
    ['a words record under the passkey kind', { ...words, kind: 'passkey' }],
    ['a words record with a fingerprint its words do not give', { ...words, fingerprint: B.masterFingerprint }],
    // The first address is not the public key's first receive address.
    ['the second receive address', { ...passkey, firstAddress: A.receive[1] }],
    ['the first change address', { ...passkey, firstAddress: A.change[0] }],
    ["another wallet's first address", { ...passkey, firstAddress: B.receive[0] }],
    ["another wallet's public key", { ...passkey, xpub: B.xpub }],
    ["another wallet's public key, in a words record", { ...words, xpub: B.xpub, firstAddress: B.receive[0] }],
    ['no first address', { ...passkey, firstAddress: undefined }],
    // The public key.
    ['a private key in place of the public key', { ...passkey, xpub: privateKey }],
    ['a public key with a damaged checksum', { ...passkey, xpub: damagedKey }],
    ['a public key that is not text', { ...passkey, xpub: 5 }],
    ['no public key', { ...passkey, xpub: undefined }],
    // The fingerprint and the date.
    ['a fingerprint that is not 8 hex characters', { ...passkey, fingerprint: '73c5da0' }],
    ['a fingerprint in capitals', { ...passkey, fingerprint: '73C5DA0A' }],
    ['a fingerprint that is a number', { ...passkey, fingerprint: 73 }],
    ['a date as text', { ...passkey, createdAt: '2026' }],
    ['no date', { ...passkey, createdAt: null }],
    // A number that no date can hold or show, or that Date.now() never gives.
    ['a date before 1970', { ...passkey, createdAt: -1 }],
    ['a date with a fraction of a millisecond', { ...passkey, createdAt: NOW + 0.5 }],
    ['a date one millisecond past the last a date can hold', { ...passkey, createdAt: 8_640_000_000_000_001 }],
    ['a date that is only a very large number', { ...passkey, createdAt: 1e300 }],
    ['a very large negative date', { ...passkey, createdAt: -1e300 }],
    ['a very large date in a words record', { ...words, createdAt: 1e300 }],
  ];

  for (const [name, value] of cases) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const local = holding(new MemoryStorage(), text);
    assert.equal(loadRecord(local), 'unreadable', name);
    // Never repaired, never overwritten, never removed.
    assert.equal(stored(local), text, name);
    assert.equal(local.writes, 0, name);
  }
});

test('loadRecord: a sound record is returned as it was written, with nothing unchecked riding along', () => {
  const record = passkeyRecord(A);
  const local = holding(new MemoryStorage(), JSON.stringify({ ...record, note: 'not a field of the record' }));
  assert.deepEqual(loadRecord(local), record);
  assert.equal(local.writes, 0, 'loading never writes');

  // The public key cannot be checked against a passkey wallet's keys until
  // an unlock. A record altered so that it still agrees with itself loads;
  // judgeUnlock is what catches it (see "tampered" below).
  const altered: WalletRecord = { ...record, xpub: B.xpub, firstAddress: firstOf(B) };
  assert.deepEqual(loadRecord(holding(new MemoryStorage(), altered)), altered);
});

// -- publicRecord -----------------------------------------------------------------

test('publicRecord: the record without the 12 words, as a copy', () => {
  const words = wordsRecord(A);
  const open = publicRecord(words);
  // The words are gone from the object itself, not only hidden by its type.
  assert.ok(!('mnemonic' in open));
  assert.ok(!JSON.stringify(open).includes(A.mnemonic));
  assert.deepEqual(Object.keys(open), ['v', 'kind', 'fingerprint', 'xpub', 'firstAddress', 'createdAt']);
  // Everything else is as it was ...
  const { mnemonic: _words, ...rest } = words;
  assert.deepEqual(open, rest);
  // ... and the record it was made from still has its words.
  assert.notEqual(open, words);
  assert.equal(words.mnemonic, A.mnemonic);

  // A passkey record has no words to take out: an equal copy.
  const passkey = passkeyRecord(B, PASSKEY_B);
  assert.deepEqual(publicRecord(passkey), passkey);
  assert.notEqual(publicRecord(passkey), passkey);

  // What loadRecord gives for a words wallet holds the words, as it must.
  // This is the way to pass that record on.
  const loaded = loadRecord(holding(new MemoryStorage(), words));
  assert.ok(loaded !== null && typeof loaded !== 'string');
  assert.equal(loaded.mnemonic, A.mnemonic);
  assert.ok(!('mnemonic' in publicRecord(loaded)));
  assert.equal(loaded.mnemonic, A.mnemonic);
});

// -- the guards against other tabs ------------------------------------------------

test('saveRecordIfNone: stops when a record appeared meanwhile', () => {
  // Two tabs, one storage. Both saw no wallet; the other tab is first.
  const local = new MemoryStorage();
  const theirs = wordsRecord(B);
  const ours = passkeyRecord(A);
  assert.equal(saveRecordIfNone(local, theirs), true);
  assert.equal(saveRecordIfNone(local, ours), false);
  assert.deepEqual(loadRecord(local), theirs, 'their wallet, and its words, are untouched');

  // Something unreadable is in the way, or a record from a newer version: neither is overwritten.
  for (const text of ['damaged', '{"v":"2"}', '{"v":2}']) {
    const inTheWay = holding(new MemoryStorage(), text);
    assert.equal(saveRecordIfNone(inTheWay, ours), false, text);
    assert.equal(stored(inTheWay), text);
    assert.equal(inTheWay.writes, 0, text);
  }
});

test('a record that is not sound is never written', () => {
  const withWords = { ...passkeyRecord(A), mnemonic: A.mnemonic };
  const mismatched = { ...wordsRecord(A), mnemonic: B.mnemonic };
  const { mnemonic: _words, ...wordless } = wordsRecord(A);
  const newer = { ...passkeyRecord(A), v: 2 } as unknown as WalletRecord;
  // The words where the tag belongs: a passkey record has no place for them at all.
  const wordsAsTag = { ...passkeyRecord(A), tag: A.mnemonic };
  const sentenceAsTag = { ...passkeyRecord(A), tag: 'not a tag' };
  const unusableId = { ...passkeyRecord(A), credentialId: 'AAAAA' };
  const endlessId = { ...passkeyRecord(A), credentialId: 'A'.repeat(1366) };
  const respelledId = { ...passkeyRecord(A), credentialId: 'QUJ' };
  const noSuchTime = { ...passkeyRecord(A), createdAt: 1e300 };
  const halfTime = { ...wordsRecord(A), createdAt: NOW + 0.5 };
  const tagsAndIds = [wordsAsTag, sentenceAsTag, unusableId, endlessId, respelledId];
  for (const bad of [withWords, mismatched, wordless, newer, ...tagsAndIds, noSuchTime, halfTime]) {
    const empty = new MemoryStorage();
    assert.equal(saveRecordIfNone(empty, bad), false);
    assert.equal(empty.map.size, 0);

    const local = holding(new MemoryStorage(), passkeyRecord(A));
    assert.equal(replaceRecord(local, A.masterFingerprint, bad), false);
    assert.deepEqual(loadRecord(local), passkeyRecord(A));
  }
});

test('replaceRecord: only while the stored wallet is the one this tab loaded', () => {
  const ours = passkeyRecord(A);
  const next = passkeyRecord(B, PASSKEY_B);

  const local = holding(new MemoryStorage(), ours);
  assert.equal(replaceRecord(local, A.masterFingerprint, next), true);
  assert.deepEqual(loadRecord(local), next);

  // Rebuilding a record of the same wallet (after "tampered") is a replace too.
  const altered = holding(new MemoryStorage(), { ...ours, xpub: B.xpub, firstAddress: firstOf(B) });
  assert.equal(replaceRecord(altered, A.masterFingerprint, ours), true);
  assert.deepEqual(loadRecord(altered), ours);

  // Another tab switched to a different wallet meanwhile.
  const switched = holding(new MemoryStorage(), wordsRecord(B));
  assert.equal(replaceRecord(switched, A.masterFingerprint, next), false);
  assert.deepEqual(loadRecord(switched), wordsRecord(B));
  assert.equal(switched.writes, 0);

  // Another tab removed the wallet: a replace must not bring one back.
  const gone = new MemoryStorage();
  assert.equal(replaceRecord(gone, A.masterFingerprint, next), false);
  assert.equal(gone.map.size, 0);

  // What is stored cannot be read: it stays.
  const damaged = holding(new MemoryStorage(), 'damaged');
  assert.equal(replaceRecord(damaged, A.masterFingerprint, next), false);
  assert.equal(stored(damaged), 'damaged');
});

test('removeWallet: deletes the record only, and only the wallet this tab loaded', () => {
  const local = holding(new MemoryStorage(), wordsRecord(A));
  local.map.set('theme', 'dark');
  local.map.set('lbp_wallet_v2', 'a later format');
  assert.equal(removeWallet(local, A.masterFingerprint), true);
  assert.equal(loadRecord(local), null);
  assert.deepEqual([...local.map.entries()], [
    ['theme', 'dark'],
    ['lbp_wallet_v2', 'a later format'],
  ]);
  assert.equal(local.cleared, 0, 'never clear()');

  // Removed already (this tab or another): nothing to do.
  assert.equal(removeWallet(local, A.masterFingerprint), false);
  assert.equal(local.map.size, 2);

  // Another tab replaced the wallet meanwhile: theirs stays.
  const replaced = holding(new MemoryStorage(), wordsRecord(B));
  assert.equal(removeWallet(replaced, A.masterFingerprint), false);
  assert.deepEqual(loadRecord(replaced), wordsRecord(B));
  assert.equal(replaced.writes, 0);

  // An unreadable record has no fingerprint to match.
  const damaged = holding(new MemoryStorage(), 'damaged');
  assert.equal(removeWallet(damaged, A.masterFingerprint), false);
  assert.equal(removeWallet(damaged, ''), false);
  assert.equal(stored(damaged), 'damaged');
});

test('a record from a newer version is "newer": never read, never removed', () => {
  for (const value of [{ ...wordsRecord(A), v: 2 }, { ...passkeyRecord(A), v: 2 }, { v: 7 }, { v: 2, kind: 'unheard-of' }]) {
    const text = JSON.stringify(value);
    const local = holding(new MemoryStorage(), text);
    assert.equal(loadRecord(local), 'newer');
    assert.equal(removeUnreadable(local), false);
    assert.equal(removeWallet(local, A.masterFingerprint), false);
    assert.equal(saveRecordIfNone(local, wordsRecord(B)), false);
    assert.equal(replaceRecord(local, A.masterFingerprint, wordsRecord(B)), false);
    assert.equal(stored(local), text, 'left exactly as it was');
  }
  // Only a whole number above 1 says "newer". Anything else in `v` is damage.
  for (const v of [0, 1.5, -2, '2', null, 2 ** 60, [2]]) {
    assert.equal(loadRecord(holding(new MemoryStorage(), JSON.stringify({ ...wordsRecord(A), v }))), 'unreadable', String(v));
  }
  assert.equal(loadRecord(holding(new MemoryStorage(), JSON.stringify([{ v: 2 }]))), 'unreadable');
});

test('"newer" goes by the number as JSON reads it, however it is written, and by nothing else', () => {
  const record = wordsRecord(A);
  const words = JSON.stringify(record);
  assert.ok(words.startsWith('{"v":1,'));
  const newer = [
    '{"v":2}',
    '{"v":2.0}',
    '{"v":2e0}',
    '{"v":20e-1}',
    ' { "v" : 3 } ',
    // The largest whole number that can still be told from the one after it.
    '{"v":9007199254740991}',
    // A version-1 record in every other respect.
    words.replace('{"v":1,', '{"v":2,'),
    // The same field twice: JSON keeps the last.
    words.replace('{"v":1,', '{"v":1,"v":2,'),
  ];
  for (const text of newer) {
    const local = holding(new MemoryStorage(), text);
    local.map.set('theme', 'dark');
    const where = text.slice(0, 30);
    assert.equal(loadRecord(local), 'newer', where);
    // It may be a good wallet, so nothing this version can do touches it.
    assert.equal(removeUnreadable(local), false, where);
    assert.equal(removeWallet(local, A.masterFingerprint), false, where);
    assert.equal(replaceRecord(local, A.masterFingerprint, record), false, where);
    assert.equal(saveRecordIfNone(local, record), false, where);
    assert.equal(local.writes, 0, where);
    assert.equal(local.cleared, 0, where);
    assert.equal(stored(local), text, where);
    assert.equal(local.map.get('theme'), 'dark');
  }

  // Anything else is "unreadable": damage, which the reader may remove.
  const notNewer = [
    '{"v":"2"}',
    '{"v":true}',
    '{"v":[2]}',
    '{"v":{"v":2}}',
    '{"v":1.5}',
    '{"v":0}',
    '{"v":-2}',
    // Too large to be told from the next number, and too large to be a number at all.
    '{"v":9007199254740992}',
    '{"v":1e400}',
    // Not the record's own "v": another name, one level down, and inside a
    // field named __proto__, which JSON reads as a field like any other.
    '{"V":2}',
    '{"record":{"v":2}}',
    '{"__proto__":{"v":2}}',
    // The answer's own word, stored as text.
    '"newer"',
    'newer',
    // Not JSON.
    '{"v":2}x',
  ];
  for (const text of notNewer) {
    const local = holding(new MemoryStorage(), text);
    assert.equal(loadRecord(local), 'unreadable', text);
    assert.equal(stored(local), text, 'reading it changes nothing');
    assert.equal(removeUnreadable(local), true, text);
    assert.equal(stored(local), undefined, text);
  }

  // Where the last "v" is 1, the record is the version-1 record it says it is.
  assert.deepEqual(loadRecord(holding(new MemoryStorage(), words.replace('{"v":1,', '{"v":2,"v":1,'))), record);
});

test('a tab that saw damage does not remove the newer record that took its place', () => {
  // This tab read something it could not make sense of, and offers Reload
  // and Remove. Before the reader chooses, a tab running a newer version of
  // the page puts its wallet there. Remove reads the storage again, inside
  // the call, and leaves that wallet alone.
  const local = holding(new MemoryStorage(), 'damaged');
  assert.equal(loadRecord(local), 'unreadable');
  const theirs = JSON.stringify({ ...wordsRecord(B), v: 2 });
  local.map.set(RECORD_KEY, theirs);
  assert.equal(removeUnreadable(local), false);
  assert.equal(stored(local), theirs);
  assert.equal(local.writes, 0);

  // The other way round: the newer tab removes its wallet. Nothing is stored
  // now, so this tab may make one.
  local.map.delete(RECORD_KEY);
  assert.equal(loadRecord(local), null);
  assert.equal(removeUnreadable(local), false);
  assert.equal(saveRecordIfNone(local, wordsRecord(A)), true);
  assert.deepEqual(loadRecord(local), wordsRecord(A));
});

test('removeUnreadable: deletes only a record that cannot be read', () => {
  const damaged = holding(new MemoryStorage(), '{"v":"2","kind":"words"}');
  damaged.map.set('theme', 'dark');
  assert.equal(removeUnreadable(damaged), true);
  assert.deepEqual([...damaged.map.entries()], [['theme', 'dark']]);
  assert.equal(damaged.cleared, 0);
  assert.equal(removeUnreadable(damaged), false, 'nothing is stored any more');

  // Another tab made a sound wallet meanwhile: it is not ours to delete.
  const sound = holding(new MemoryStorage(), wordsRecord(A));
  assert.equal(removeUnreadable(sound), false);
  assert.deepEqual(loadRecord(sound), wordsRecord(A));
  assert.equal(sound.writes, 0);
});

// -- storage that refuses ---------------------------------------------------------

test('a storage that throws on write makes every change answer false, not throw', () => {
  const record = wordsRecord(A);
  const next = wordsRecord(B);

  assert.equal(saveRecordIfNone(new FullStorage(), record), false);
  assert.equal(canStore(new FullStorage()), false);

  const full = holding(new FullStorage(), record);
  assert.equal(replaceRecord(full, A.masterFingerprint, next), false);
  assert.equal(removeWallet(full, A.masterFingerprint), false);
  assert.deepEqual(loadRecord(full), record, 'the wallet that was there is still there');
  assert.equal(removeUnreadable(holding(new FullStorage(), 'damaged')), false);

  // Storage switched off altogether.
  const locked = new LockedStorage();
  assert.equal(loadRecord(locked), 'blocked');
  assert.equal(saveRecordIfNone(locked, record), false);
  assert.equal(replaceRecord(locked, A.masterFingerprint, next), false);
  assert.equal(removeWallet(locked, A.masterFingerprint), false);
  assert.equal(removeUnreadable(locked), false);
  assert.equal(canStore(locked), false);

  // A storage that cannot be read is not written blind: a wallet may be in it.
  const blind = holding(new BlindStorage(), next);
  assert.equal(loadRecord(blind), 'blocked');
  assert.equal(removeUnreadable(blind), false, 'nothing is removed unseen either');
  assert.equal(saveRecordIfNone(blind, record), false);
  assert.equal(replaceRecord(blind, B.masterFingerprint, record), false);
  assert.equal(removeWallet(blind, B.masterFingerprint), false);
  assert.equal(blind.writes, 0);
  assert.equal(stored(blind), JSON.stringify(next));

  // No storage object at all (some browsers throw on reaching for localStorage).
  const absent = undefined as unknown as Storage;
  assert.equal(loadRecord(absent), 'blocked');
  assert.equal(saveRecordIfNone(absent, record), false);
  assert.equal(canStore(absent), false);
});

test('a storage that forgets what it is given: a save is only a save if it can be read back', () => {
  const forgetful = new ForgetfulStorage();
  assert.equal(saveRecordIfNone(forgetful, wordsRecord(A)), false);
  assert.equal(canStore(forgetful), false);
});

test('canStore: a real test write that cleans up after itself', () => {
  const local = holding(new MemoryStorage(), wordsRecord(A));
  local.map.set('theme', 'dark');
  const before = [...local.map.entries()];

  assert.equal(canStore(local), true);
  assert.ok(local.writes >= 2, 'it wrote, and removed what it wrote');
  // The record and the other key are untouched, and nothing is left behind.
  assert.deepEqual([...local.map.entries()], before);

  const empty = new MemoryStorage();
  assert.equal(canStore(empty), true);
  assert.equal(empty.map.size, 0);
  assert.equal(empty.cleared, 0);
});

// -- judgeUnlock ------------------------------------------------------------------

test('judgeUnlock: all five verdicts', () => {
  const record = passkeyRecord(A);
  const mine = PASSKEY_A.credentialId;
  const another = PASSKEY_B.credentialId;

  // adopt: this browser has no record.
  assert.equal(judgeUnlock(null, mine, A.mnemonic), 'adopt');

  // same: the stored passkey, and words that give exactly the stored public key.
  assert.equal(judgeUnlock(record, mine, A.mnemonic), 'same');

  // other-passkey: a different passkey answered.
  assert.equal(judgeUnlock(record, another, B.mnemonic), 'other-passkey');

  // changed: the stored passkey gave a different wallet.
  assert.equal(judgeUnlock(record, mine, B.mnemonic), 'changed');

  // tampered: the stored passkey gave the stored fingerprint, but the stored public key is another one.
  const altered: WalletRecord = { ...record, xpub: B.xpub, firstAddress: firstOf(B) };
  assert.equal(judgeUnlock(altered, mine, A.mnemonic), 'tampered');
});

test('judgeUnlock: the edges between the verdicts', () => {
  const record = passkeyRecord(A);
  const mine = PASSKEY_A.credentialId;
  const another = PASSKEY_B.credentialId;

  // adopt comes first: with no record there is nothing to compare.
  assert.equal(judgeUnlock(null, another, B.mnemonic), 'adopt');
  assert.equal(judgeUnlock(null, '', 'not a phrase'), 'adopt');

  // same / other-passkey: the right words from the wrong passkey are still another passkey.
  assert.equal(judgeUnlock(record, another, A.mnemonic), 'other-passkey');
  // ... whatever the words give, a wallet or none.
  assert.equal(judgeUnlock(record, another, 'not a phrase'), 'other-passkey');
  assert.equal(judgeUnlock(record, `${mine}A`, A.mnemonic), 'other-passkey');
  assert.equal(judgeUnlock(record, mine.toLowerCase(), A.mnemonic), 'other-passkey', 'IDs are compared exactly');
  assert.equal(judgeUnlock(record, '', A.mnemonic), 'other-passkey');
  // A wallet made without a passkey has no passkey of its own: any passkey is another one.
  assert.equal(judgeUnlock(wordsRecord(A), mine, A.mnemonic), 'other-passkey');

  // same: the words as the wallet package reads them, not as text.
  assert.equal(judgeUnlock(record, mine, `  ${A.mnemonic.toUpperCase()} `), 'same');

  // same / tampered: the fingerprint fits, the public key is the edge.
  const wrongKey: WalletRecord = { ...record, xpub: B.xpub };
  assert.equal(judgeUnlock(wrongKey, mine, A.mnemonic), 'tampered');

  // same / tampered, the other way round: the public key fits and the fingerprint
  // does not. Not "same": the record no longer names the wallet the passkey gives.
  // Not "changed" either: the keys give the public key the record holds.
  const wrongFingerprint: WalletRecord = { ...record, fingerprint: '00000000' };
  assert.equal(judgeUnlock(wrongFingerprint, mine, A.mnemonic), 'tampered');

  // tampered / changed: one wrong is "tampered", both wrong is "changed".
  const bothWrong: WalletRecord = { ...record, fingerprint: '00000000', xpub: B.xpub };
  assert.equal(judgeUnlock(bothWrong, mine, A.mnemonic), 'changed');
  // The record of wallet B under passkey A's ID, asked with A's words: a different wallet.
  assert.equal(judgeUnlock(passkeyRecord(B, PASSKEY_A), mine, A.mnemonic), 'changed');

  // Words that give no wallet at all, from the stored passkey: nothing is opened, and nothing throws.
  assert.equal(judgeUnlock(record, mine, 'not a phrase'), 'changed');
  assert.equal(judgeUnlock(record, mine, ''), 'changed');
});

test('judgeUnlock: the pair decides, for either wallet and whatever the wrong value is', () => {
  const wallets: [own: VectorWallet, passkey: typeof PASSKEY_A, other: VectorWallet][] = [
    [A, PASSKEY_A, B],
    [B, PASSKEY_B, A],
  ];
  for (const [own, passkey, other] of wallets) {
    const record = passkeyRecord(own, passkey);
    const before = structuredClone(record);
    const id = passkey.credentialId;
    const otherKey = { xpub: other.xpub, firstAddress: firstOf(other) };
    // Another wallet's fingerprint, two made-up ones, and the wallet's own with its last character changed.
    const lastChanged = `${own.masterFingerprint.slice(0, 7)}${own.masterFingerprint.endsWith('0') ? '1' : '0'}`;
    const wrongFingerprints = [other.masterFingerprint, '00000000', 'ffffffff', lastChanged];

    // Both fit.
    assert.equal(judgeUnlock(record, id, own.mnemonic), 'same');
    // The fingerprint fits and the public key does not.
    assert.equal(judgeUnlock({ ...record, ...otherKey }, id, own.mnemonic), 'tampered');
    for (const fingerprint of wrongFingerprints) {
      assert.notEqual(fingerprint, own.masterFingerprint);
      // The public key fits and the fingerprint does not.
      assert.equal(judgeUnlock({ ...record, fingerprint }, id, own.mnemonic), 'tampered', fingerprint);
      // Neither fits.
      assert.equal(judgeUnlock({ ...record, ...otherKey, fingerprint }, id, own.mnemonic), 'changed', fingerprint);
    }
    // Neither fits, seen from the other side: a sound record, and a passkey that now gives another wallet.
    assert.equal(judgeUnlock(record, id, other.mnemonic), 'changed');

    // It only judges: the record it was handed is as it was.
    assert.deepEqual(record, before);
  }
});

test('a passkey record altered in storage still loads; the next unlock tells, and a "tampered" one is rebuilt', () => {
  const truth = passkeyRecord(A);
  const mine = PASSKEY_A.credentialId;
  const keyOfB = { xpub: B.xpub, firstAddress: firstOf(B) };
  // What someone who can write this browser's storage might do to the record.
  // Each result agrees with itself, so loadRecord has nothing to object to:
  // a passkey record holds nothing that vouches for its public key or its
  // fingerprint.
  const alterations: [name: string, fields: Partial<WalletRecord>, verdict: UnlockVerdict][] = [
    ['nothing', {}, 'same'],
    ['the public key, and the first address to match', keyOfB, 'tampered'],
    ['the fingerprint, to that of another wallet', { fingerprint: B.masterFingerprint }, 'tampered'],
    ['the fingerprint, to a made-up one', { fingerprint: '00000000' }, 'tampered'],
    ['both, to those of another wallet', { ...keyOfB, fingerprint: B.masterFingerprint }, 'changed'],
    ['both, the fingerprint made up', { ...keyOfB, fingerprint: 'ffffffff' }, 'changed'],
  ];
  for (const [name, fields, verdict] of alterations) {
    const altered: WalletRecord = { ...truth, ...fields };
    const text = JSON.stringify(altered);
    const local = holding(new MemoryStorage(), text);
    const loaded = loadRecord(local);
    assert.ok(loaded !== null && typeof loaded !== 'string', name);
    assert.deepEqual(loaded, altered, name);

    // The stored passkey answers, and its secret gives the 12 words of wallet A.
    assert.equal(judgeUnlock(loaded, mine, A.mnemonic), verdict, name);
    // Judging writes nothing. With "changed" that is all there is: the
    // wallet is not opened, and what is stored stays for the reader to
    // decide about.
    assert.equal(local.writes, 0, name);
    assert.equal(stored(local), text, name);
    if (verdict !== 'tampered') continue;

    // "tampered": the keys are the wallet, so the record is made again from
    // them. The replace is guarded by the fingerprint this tab loaded, and
    // that is the stored one, right or wrong.
    const rebuilt = makeRecord('passkey', A.mnemonic, loaded.createdAt, { credentialId: mine, tag: loaded.tag ?? null });
    assert.deepEqual(rebuilt, truth, name);
    assert.equal(replaceRecord(local, loaded.fingerprint, rebuilt), true, name);
    const now = loadRecord(local);
    assert.deepEqual(now, truth, name);
    assert.ok(now !== null && typeof now !== 'string');
    assert.equal(judgeUnlock(now, mine, A.mnemonic), 'same', name);
  }

  // The guard goes by what is stored. A record whose fingerprint was altered
  // no longer carries the true one, so a replace that expects the true one
  // is refused, and the altered record stays.
  const local = holding(new MemoryStorage(), { ...truth, fingerprint: '00000000' });
  assert.equal(replaceRecord(local, A.masterFingerprint, truth), false);
  assert.equal(local.writes, 0);
  assert.equal(replaceRecord(local, '00000000', truth), true);
  assert.deepEqual(loadRecord(local), truth);
});

test('a record whose passkey ID was respelled in storage is unreadable, and cannot pass for another passkey', () => {
  // Ten bytes are 14 characters of base64url, and the last one carries four
  // spare bits. The ID as passkey.ts writes it has zeros there. The altered
  // one has a 1 in the lowest of them, and nothing else is different.
  const idBytes = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
  const written = Buffer.from(idBytes).toString('base64url');
  const respelled = `${written.slice(0, -1)}h`;
  assert.deepEqual([written, respelled], ['3q2-7wECAwQFBg', '3q2-7wECAwQFBh']);
  // A browser turns both into the same bytes (passkey.ts reads an ID with
  // atob), so asked by either text the same passkey answers, and it answers
  // under the ID as written.
  const bytesOf = (text: string): string => atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  assert.equal(bytesOf(respelled), bytesOf(written));
  assert.equal(bytesOf(written), String.fromCharCode(...idBytes));

  const truth = makeRecord('passkey', A.mnemonic, NOW, { credentialId: written, tag: '9F6D' });
  const keyOfB = { xpub: B.xpub, firstAddress: firstOf(B) };
  const alterations: [name: string, fields: Partial<WalletRecord>, verdict: UnlockVerdict][] = [
    ['nothing else', {}, 'same'],
    ['the public key', keyOfB, 'tampered'],
    ['the fingerprint', { fingerprint: B.masterFingerprint }, 'tampered'],
    ['the public key and the fingerprint', { ...keyOfB, fingerprint: B.masterFingerprint }, 'changed'],
  ];
  for (const [name, fields, verdict] of alterations) {
    // With the ID as written, the record loads and the next unlock tells what was done to it.
    const asWritten = loadRecord(holding(new MemoryStorage(), { ...truth, ...fields }));
    assert.ok(asWritten !== null && typeof asWritten !== 'string', name);
    assert.equal(judgeUnlock(asWritten, written, A.mnemonic), verdict, name);

    // judgeUnlock compares the two IDs as text. Handed the respelled record,
    // it would take the stored passkey for a different one, whatever else
    // was altered: the reader would be asked whether to switch wallets, and
    // "tampered" and "changed" would never be said.
    const altered: WalletRecord = { ...truth, ...fields, credentialId: respelled };
    assert.equal(judgeUnlock(altered, written, A.mnemonic), 'other-passkey', name);

    // So such a record never gets that far. It is unreadable: nothing is
    // opened, nothing is written, and it stays until the reader removes it.
    const text = JSON.stringify(altered);
    const local = holding(new MemoryStorage(), text);
    assert.equal(loadRecord(local), 'unreadable', name);
    assert.equal(local.writes, 0, name);
    assert.equal(stored(local), text, name);
    assert.equal(replaceRecord(local, truth.fingerprint, truth), false, name);
    assert.equal(removeWallet(local, truth.fingerprint), false, name);
    assert.equal(stored(local), text, name);
    assert.equal(removeUnreadable(local), true, name);
    assert.equal(loadRecord(local), null, name);
  }
  // And no record is ever made with it.
  assert.throws(() => makeRecord('passkey', A.mnemonic, NOW, { credentialId: respelled, tag: '9F6D' }), /^Error: Not a passkey ID$/);
});

// -- wordsMatchRecord -------------------------------------------------------------

test('wordsMatchRecord: true only when the words give exactly the record\'s public key', () => {
  const passkey = passkeyRecord(A);
  assert.equal(wordsMatchRecord(passkey, A.mnemonic), true);
  assert.equal(wordsMatchRecord(wordsRecord(A), A.mnemonic), true);
  assert.equal(wordsMatchRecord(passkey, `${A.mnemonic.toUpperCase().replaceAll(' ', '   ')}\n`), true, 'as typed');

  // Another wallet's words.
  assert.equal(wordsMatchRecord(passkey, B.mnemonic), false);
  assert.equal(wordsMatchRecord(passkeyRecord(B, PASSKEY_B), A.mnemonic), false);
  // The public key decides: a record whose public key was swapped no longer matches its old words ...
  const swapped: WalletRecord = { ...passkey, xpub: B.xpub };
  assert.equal(wordsMatchRecord(swapped, A.mnemonic), false);
  // ... and matches the words of the key that was put there.
  assert.equal(wordsMatchRecord(swapped, B.mnemonic), true);

  // Not a valid phrase: false, never a throw.
  const notPhrases = [
    '',
    'abandon',
    A.mnemonic.replace(/about$/, 'abandon'), // 12 words, bad checksum
    `${A.mnemonic} about`, // 13 words
    A.mnemonic.split(' ').slice(0, 11).join(' '), // 11 words
  ];
  for (const typed of notPhrases) {
    assert.equal(wordsMatchRecord(passkey, typed), false, typed);
  }
});

// -- judgeWords -------------------------------------------------------------------

test('judgeWords: typed words are judged by the pair, the public key and the wallet fingerprint, as a passkey\'s answer is', () => {
  const passkey = passkeyRecord(A);
  // Both fit: this wallet's words, also as a reader types them, and for a wallet kept with its words.
  assert.equal(judgeWords(passkey, A.mnemonic), 'same');
  assert.equal(judgeWords(passkey, `${A.mnemonic.toUpperCase().replaceAll(' ', '   ')}\n`), 'same');
  assert.equal(judgeWords(wordsRecord(A), A.mnemonic), 'same');
  // Neither fits: another wallet's words.
  assert.equal(judgeWords(passkey, B.mnemonic), 'other');
  assert.equal(judgeWords(passkeyRecord(B, PASSKEY_B), A.mnemonic), 'other');

  // Exactly one fits: the record was altered. The public key swapped, and the reader's own words ...
  const keySwapped: WalletRecord = { ...passkey, xpub: B.xpub, firstAddress: B.receive[0] ?? '' };
  assert.equal(judgeWords(keySwapped, A.mnemonic), 'tampered');
  // ... and the words of the key that was put there, which wordsMatchRecord alone would take for this wallet's.
  assert.equal(wordsMatchRecord(keySwapped, B.mnemonic), true);
  assert.equal(judgeWords(keySwapped, B.mnemonic), 'tampered');
  // The wallet fingerprint altered, which wordsMatchRecord does not look at.
  const printAltered: WalletRecord = { ...passkey, fingerprint: 'deadbeef' };
  assert.equal(wordsMatchRecord(printAltered, A.mnemonic), true);
  assert.equal(judgeWords(printAltered, A.mnemonic), 'tampered');
  assert.equal(judgeWords({ ...passkey, fingerprint: B.masterFingerprint }, B.mnemonic), 'tampered');
  // Both altered together fit nothing of the reader's words: nothing here can tell that from another wallet.
  assert.equal(judgeWords({ ...keySwapped, fingerprint: B.masterFingerprint }, A.mnemonic), 'other');

  // It agrees with judgeUnlock for the stored passkey, verdict for verdict.
  const verdicts = { same: 'same', tampered: 'tampered', changed: 'other' } as const;
  for (const record of [passkey, keySwapped, printAltered, { ...keySwapped, fingerprint: B.masterFingerprint }]) {
    for (const typed of [A.mnemonic, B.mnemonic]) {
      const byPasskey = judgeUnlock(record, record.credentialId ?? '', typed);
      assert.equal(judgeWords(record, typed), verdicts[byPasskey as keyof typeof verdicts], `${record.fingerprint} ${typed.slice(0, 12)}`);
    }
  }

  // Not a valid phrase: "other", never a throw.
  for (const typed of ['', 'abandon', A.mnemonic.replace(/about$/, 'abandon'), `${A.mnemonic} about`]) {
    assert.equal(judgeWords(passkey, typed), 'other', typed);
  }
});
