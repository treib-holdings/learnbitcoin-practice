// session.ts against stand-ins for everything it is handed.
//
// The passkey calls are the real ones of passkey.ts, run against a stand-in
// password manager; the storage is a Map; "another tab" is a second session
// on the same storage, or a write made behind this one's back. The chain
// engine is a stand-in that notes what it was told, except in the last
// section, where the three modules run together as makeEngine() wires them.
//
// What is proved here: every rule about keys, storage and other tabs that
// wallet-api.ts promises a screen, each answer of each action, and that the
// 12 words never appear in anything the session shows or counts, nor stay
// where a regular expression keeps the last text it matched (in this file's
// code and in the code the app's build makes of it).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Lang } from '@learnbitcoin/practice-contract';
import {
  accountFromMnemonic,
  normalizeMnemonic,
  ownAddresses,
  signPayment,
  viewPayment,
  type PaymentRequest,
} from '@learnbitcoin/practice-wallet';
import { RECORD_KEY, loadRecord, makeRecord, type WalletRecord } from '../src/lib/keystore.ts';
import { tagFromUserId, type PasskeyOutcome } from '../src/lib/passkey.ts';
import { makeApi } from '../src/lib/api.ts';
import { makeEngine, makeSession, passkeyPort, type PasskeyPort, type Session } from '../src/lib/session.ts';
import {
  BlockedStorage,
  FakeChain,
  FakeClock,
  FullStorage,
  MemoryStorage,
  SOMEONE,
  START_MS,
  SwitchedStorage,
  VirtualAuthenticator,
  coinsState,
  flush,
  recorder,
  test,
  testEngine,
} from './engine-fakes.ts';

interface VectorWallet {
  mnemonic: string;
  masterFingerprint: string;
  xpub: string;
  receive: string[];
  receiveDescriptor: string;
  changeDescriptor: string;
}

const vectors = JSON.parse(readFileSync(new URL('../../wallet/test/vectors.json', import.meta.url), 'utf8')) as {
  abandon: VectorWallet;
  prf: { wallet: VectorWallet };
};

/** Two wallets with frozen values. */
const A = vectors.abandon;
const B = vectors.prf.wallet;
const firstOf = (wallet: VectorWallet): string => wallet.receive[0] ?? '';

// -- one tab ----------------------------------------------------------------------

interface StartOptions {
  storage?: MemoryStorage;
  auth?: VirtualAuthenticator;
  passkeys?: PasskeyPort;
  selfTest?: () => boolean;
  /** The words createWithWords() makes. Default: wallet A's. */
  newMnemonic?: () => string;
  persist?: () => Promise<boolean | null>;
  now?: () => number;
}

/** A session on stand-ins: one tab of the app. */
function start(options: StartOptions = {}) {
  const clock = new FakeClock();
  const chain = new FakeChain();
  const auth = options.auth ?? new VirtualAuthenticator();
  const storage = options.storage ?? new MemoryStorage();
  const counted = recorder();
  const page = { lang: 'en' as Lang, persistAsked: 0 };
  const session = makeSession({
    local: storage as Storage,
    passkeys: options.passkeys ?? passkeyPort(auth.env()),
    chain,
    now: options.now ?? clock.now,
    track: counted.track,
    persist:
      options.persist ??
      (async () => {
        page.persistAsked += 1;
        return true;
      }),
    lang: () => page.lang,
    selfTest: options.selfTest ?? (() => true),
    newMnemonic: options.newMnemonic ?? (() => A.mnemonic),
  });
  return { session, chain, auth, storage, clock, page, events: counted.events, unlisted: counted.unlisted, view: () => session.view() };
}

type Tab = ReturnType<typeof start>;

/** The text stored under the wallet's key, or null. */
const stored = (storage: MemoryStorage): string | null => storage.map.get(RECORD_KEY) ?? null;

/** Puts a record in storage the way another tab would: behind this session's back. */
function put(storage: MemoryStorage, record: unknown): void {
  storage.map.set(RECORD_KEY, typeof record === 'string' ? record : JSON.stringify(record));
}

/** A passkey that exists in the password manager already, and the record of its wallet. */
function passkeyWallet(auth: VirtualAuthenticator, seed = 1) {
  const passkey = auth.add(seed);
  const words = auth.wordsOf(auth.passkeys.indexOf(passkey));
  const tag = tagFromUserId(passkey.userId);
  const record = makeRecord('passkey', words, START_MS - 86_400_000, { credentialId: passkey.idText, tag });
  return { passkey, words, tag, record, account: accountFromMnemonic(words) };
}

/** A tab that opens on a stored passkey wallet, locked. */
function lockedTab(options: StartOptions = {}) {
  const auth = options.auth ?? new VirtualAuthenticator();
  const storage = options.storage ?? new MemoryStorage();
  const wallet = passkeyWallet(auth);
  put(storage, wallet.record);
  return { ...start({ ...options, auth, storage }), wallet };
}

/**
 * Storage in which another tab writes at the worst moment: after this page
 * has read the record a given number of times more, something else is there.
 */
class RacingStorage extends MemoryStorage {
  private countdown = 0;
  private next: string | null = null;
  /** After `reads` more reads of the record, it is `record` (null: removed). */
  swapAfter(reads: number, record: unknown): void {
    this.countdown = reads;
    this.next = record === null ? null : JSON.stringify(record);
  }
  override getItem(key: string): string | null {
    const value = super.getItem(key);
    if (key === RECORD_KEY && this.countdown > 0) {
      this.countdown -= 1;
      if (this.countdown === 0) {
        if (this.next === null) this.map.delete(RECORD_KEY);
        else this.map.set(RECORD_KEY, this.next);
      }
    }
    return value;
  }
}

/** A passkey port whose every call answers the same thing: for outcomes the stand-in manager cannot produce. */
function answering(outcome: unknown): PasskeyPort {
  const answer = async () => outcome as PasskeyOutcome;
  return { offered: async () => true, create: answer, finish: answer, get: answer, signalUnknown: () => {}, end: () => {} };
}

// -- starting up ------------------------------------------------------------------------

test('a failed self-test: status "broken", every way to a wallet answers "broken", and storage is never touched', async () => {
  for (const selfTest of [() => false, () => { throw new Error('no crypto here'); }, (() => 'yes') as unknown as () => boolean]) {
    const storage = new MemoryStorage();
    put(storage, makeRecord('words', A.mnemonic, START_MS));
    const t = start({ storage, selfTest });
    assert.deepEqual(t.view(), {
      status: 'broken',
      record: null,
      unlocked: false,
      passkeyOffered: null,
      canStore: true,
      persisted: null,
      setup: null,
      created: null,
      createdName: null,
      pendingSwitch: null,
      pendingRestore: false,
      openedEmpty: false,
      wordsShown: 0,
    });

    assert.deepEqual(await t.session.createWithPasskey(), { kind: 'broken' });
    assert.deepEqual(await t.session.createWithWords(), { kind: 'broken' });
    assert.deepEqual(await t.session.finishSetup(), { kind: 'broken' });
    assert.deepEqual(await t.session.openWithPasskey(), { kind: 'broken' });
    assert.deepEqual(await t.session.unlock(), { kind: 'broken' });
    assert.deepEqual(await t.session.unlock('picker'), { kind: 'broken' });
    assert.equal(t.session.unlockWithWords(A.mnemonic), 'broken');
    assert.deepEqual(await t.session.restore(A.mnemonic), { kind: 'broken' });
    assert.deepEqual(await t.session.restore('not words'), { kind: 'broken' }, 'whatever was typed');
    assert.equal(t.session.removeWallet(), 'gone');
    assert.equal(t.session.revealWords(), null);
    assert.equal(t.session.descriptors(), null);
    assert.deepEqual(t.session.sign({ to: SOMEONE, amount: 1_000n, feeRate: 2n }), { ok: false, reason: 'locked' });
    t.session.storageChanged(RECORD_KEY);
    t.session.beforeBotCheck();
    t.session.lock();

    // Nothing was read, written, prompted for, scanned or counted.
    assert.deepEqual([storage.reads, storage.writes], [0, 0]);
    assert.deepEqual(t.auth.calls, []);
    assert.deepEqual([t.chain.opened, t.chain.probed], [[], []]);
    assert.deepEqual(t.events, []);
    assert.equal(t.view().status, 'broken');
  }
});

test('the wallet package\'s own self-test passes, and runs when none is handed in', () => {
  const chain = new FakeChain();
  const session = makeSession({
    local: new MemoryStorage() as Storage,
    passkeys: passkeyPort(new VirtualAuthenticator().env()),
    chain,
    now: () => START_MS,
    track: recorder().track,
    persist: async () => true,
    lang: () => 'en',
  });
  assert.equal(session.view().status, 'none');
});

test('what is stored decides the status: nothing, a wallet, something unreadable, or a newer version\'s record', () => {
  // Nothing.
  const none = start();
  assert.deepEqual(none.view(), {
    status: 'none',
    record: null,
    unlocked: false,
    passkeyOffered: null,
    canStore: true,
    persisted: null,
    setup: null,
    created: null,
    createdName: null,
    pendingSwitch: null,
    pendingRestore: false,
    openedEmpty: false,
    wordsShown: 0,
  });
  assert.equal(none.chain.opened.length, 0);
  assert.equal(none.session.descriptors(), null);

  // A wallet made without a passkey: unlocked at once, with no prompt, and its first scan starts.
  const wordsStorage = new MemoryStorage();
  put(wordsStorage, makeRecord('words', A.mnemonic, START_MS));
  const words = start({ storage: wordsStorage });
  assert.deepEqual([words.view().status, words.view().unlocked], ['ready', true]);
  assert.deepEqual(words.view().record, {
    v: 1,
    kind: 'words',
    fingerprint: A.masterFingerprint,
    xpub: A.xpub,
    firstAddress: firstOf(A),
    createdAt: START_MS,
  });
  assert.deepEqual(words.session.revealWords(), A.mnemonic.split(' '));
  assert.deepEqual(words.chain.opened, [{ xpub: A.xpub, seeded: false }]);
  assert.deepEqual(words.auth.calls, []);
  assert.equal(words.view().persisted, null, 'not asked in this page');

  // A passkey wallet: here, and locked. Looking needs no key.
  const locked = lockedTab();
  assert.deepEqual([locked.view().status, locked.view().unlocked], ['ready', false]);
  assert.deepEqual(locked.view().record, locked.wallet.record);
  assert.equal(locked.session.revealWords(), null);
  assert.deepEqual(locked.chain.opened, [{ xpub: locked.wallet.account.xpub, seeded: false }]);
  assert.deepEqual(locked.auth.calls, [], 'no prompt on load');

  // Unreadable, and written by a newer version: no wallet is shown, and nothing is scanned.
  for (const [text, status] of [
    ['{"v":1,"kind":"words"', 'unreadable'],
    ['"a string"', 'unreadable'],
    [JSON.stringify({ ...makeRecord('words', A.mnemonic, START_MS), firstAddress: firstOf(B) }), 'unreadable'],
    [JSON.stringify({ v: 2, kind: 'vault', anything: true }), 'newer'],
  ] as const) {
    const storage = new MemoryStorage();
    put(storage, text);
    const t = start({ storage });
    assert.deepEqual([t.view().status, t.view().record, t.view().unlocked], [status, null, false], text);
    assert.deepEqual(t.chain.opened, [], text);
    assert.equal(t.session.revealWords(), null, text);
    assert.equal(stored(storage), text, 'nothing is repaired');
  }
});

test('a record written by a newer version is never removed or overwritten by anything this page does', async () => {
  const storage = new MemoryStorage();
  const newer = JSON.stringify({ v: 2, kind: 'vault' });
  put(storage, newer);
  const t = start({ storage });

  assert.equal(t.session.removeWallet(), 'gone');
  assert.deepEqual(await t.session.createWithWords(), { kind: 'exists' });
  assert.deepEqual(await t.session.createWithPasskey(), { kind: 'exists' });
  assert.deepEqual(await t.session.openWithPasskey(), { kind: 'exists' });
  assert.deepEqual(await t.session.restore(A.mnemonic), { kind: 'exists' });
  assert.deepEqual(await t.session.unlock(), { kind: 'gone' });
  assert.equal(t.session.unlockWithWords(A.mnemonic), 'gone');
  assert.equal(t.session.keepRestored(), 'nothing-pending');
  assert.equal(t.session.confirmSwitch(), 'nothing-pending');
  t.session.storageChanged(RECORD_KEY);

  assert.equal(stored(storage), newer);
  assert.equal(t.view().status, 'newer');
  assert.deepEqual(t.auth.calls, []);
});

test('an unreadable record stays until the reader removes it, and Remove deletes that and nothing else', async () => {
  const storage = new MemoryStorage();
  put(storage, 'not json at all');
  storage.map.set('someone-elses-key', 'kept');
  const t = start({ storage });

  assert.deepEqual(await t.session.createWithWords(), { kind: 'exists' });
  assert.deepEqual(await t.session.restore(A.mnemonic), { kind: 'exists' });
  assert.deepEqual(await t.session.unlock(), { kind: 'gone' });
  assert.equal(stored(storage), 'not json at all');

  assert.equal(t.session.removeWallet(), 'removed');
  assert.equal(stored(storage), null);
  assert.equal(storage.map.get('someone-elses-key'), 'kept');
  assert.equal(t.view().status, 'none');
  assert.deepEqual(t.events, [], 'there is no knowing what kind of wallet it was');
  assert.equal(t.session.removeWallet(), 'gone', 'nothing is here to remove');

  // Another tab stored a sound wallet in its place meanwhile: that is not deleted.
  put(storage, 'broken again');
  const u = start({ storage });
  assert.equal(u.view().status, 'unreadable');
  put(storage, makeRecord('words', A.mnemonic, START_MS));
  assert.equal(u.session.removeWallet(), 'gone');
  assert.equal(loadRecord(storage as Storage) !== null, true);
  assert.deepEqual([u.view().status, u.view().record?.fingerprint], ['ready', A.masterFingerprint], 'and this page shows it');
});

test('canStore, persisted and passkeyOffered are shown as they are found out', async () => {
  // A browser that refuses to store anything: said from the start.
  const full = start({ storage: new FullStorage() });
  assert.deepEqual([full.view().status, full.view().canStore], ['none', false]);
  // A browser that will not let the page look at all: it stores nothing either, and that is not "no wallet".
  const blocked = start({ storage: new BlockedStorage() });
  assert.deepEqual([blocked.view().status, blocked.view().canStore], ['blocked', false]);
  assert.equal(start().view().canStore, true);

  // Whether passkeys are offered is unknown until the settings name the host.
  const t = start();
  assert.equal(t.view().passkeyOffered, null);
  await t.session.learnPasskeys('localhost');
  assert.equal(t.view().passkeyOffered, true);
  await t.session.learnPasskeys('practice.learnbitcoin.com');
  assert.equal(t.view().passkeyOffered, true, 'localhost is always allowed');
  t.auth.offersPrf = false;
  await t.session.learnPasskeys('localhost');
  assert.equal(t.view().passkeyOffered, false);
  // On another host than the one the settings name: no.
  const elsewhere = makeSession({
    local: new MemoryStorage() as Storage,
    passkeys: passkeyPort(new VirtualAuthenticator().env('preview.example')),
    chain: new FakeChain(),
    now: () => START_MS,
    track: recorder().track,
    persist: async () => true,
    lang: () => 'en',
    selfTest: () => true,
  });
  await elsewhere.learnPasskeys('practice.learnbitcoin.com');
  assert.equal(elsewhere.view().passkeyOffered, false);
  // A check that fails is a "no".
  const failing = start({ passkeys: { ...answering(null), offered: () => Promise.reject(new Error('no')) } });
  await failing.session.learnPasskeys('localhost');
  assert.equal(failing.view().passkeyOffered, false);
});

// -- create ---------------------------------------------------------------------------

test('create refuses before any passkey is made, in this order: broken, reload, exists, no-storage, busy', async () => {
  const withRecord = (): FullStorage => {
    const storage = new FullStorage();
    put(storage, makeRecord('words', A.mnemonic, START_MS));
    return storage;
  };

  // Everything at once: broken wins.
  const broken = start({ storage: withRecord(), selfTest: () => false });
  broken.session.beforeBotCheck();
  assert.deepEqual(await broken.session.createWithPasskey(), { kind: 'broken' });

  // A record here, storage full, the bot check loaded: reload.
  const reload = start({ storage: withRecord() });
  reload.session.beforeBotCheck();
  for (const create of [reload.session.createWithPasskey, reload.session.createWithWords, reload.session.finishSetup]) {
    assert.deepEqual(await create(), { kind: 'reload' });
  }
  assert.deepEqual(await reload.session.openWithPasskey(), { kind: 'reload' });

  // A record here, storage full: exists.
  const exists = start({ storage: withRecord() });
  for (const create of [exists.session.createWithPasskey, exists.session.createWithWords, exists.session.finishSetup]) {
    assert.deepEqual(await create(), { kind: 'exists' });
  }
  assert.deepEqual(await exists.session.openWithPasskey(), { kind: 'exists' });

  // Storage refuses while a prompt is open: no-storage. Storage fine again: busy.
  const storage = new FullStorage();
  storage.full = false;
  const busy = start({ storage });
  const release = busy.auth.hold();
  const first = busy.session.createWithPasskey();
  storage.full = true;
  assert.deepEqual(await busy.session.createWithPasskey(), { kind: 'no-storage' });
  assert.deepEqual(await busy.session.createWithWords(), { kind: 'no-storage' });
  assert.deepEqual(await busy.session.openWithPasskey(), { kind: 'no-storage' });
  assert.equal(busy.view().canStore, false);
  storage.full = false;
  assert.deepEqual(await busy.session.createWithPasskey(), { kind: 'busy' });
  assert.deepEqual(await busy.session.createWithWords(), { kind: 'busy' });
  assert.deepEqual(await busy.session.openWithPasskey(), { kind: 'busy' });
  assert.deepEqual(await busy.session.finishSetup(), { kind: 'busy' });
  assert.equal(busy.view().canStore, true);
  release();
  assert.deepEqual(await first, { kind: 'created' });

  // In all of that, one passkey prompt: the one that was open.
  assert.deepEqual([broken.auth.calls, reload.auth.calls, exists.auth.calls, busy.auth.calls], [[], [], [], ['create']]);
});

test('createWithPasskey: the words come from the passkey, the record is stored without them, the keys are loaded', async () => {
  const t = start();
  assert.deepEqual(await t.session.createWithPasskey(), { kind: 'created' });

  const words = t.auth.wordsOf(0);
  const account = accountFromMnemonic(words);
  const passkey = t.auth.passkeys[0];
  assert.ok(passkey);
  const tag = tagFromUserId(passkey.userId);
  const record: WalletRecord = {
    v: 1,
    kind: 'passkey',
    fingerprint: account.masterFingerprint,
    xpub: account.xpub,
    firstAddress: t.view().record?.firstAddress ?? '',
    createdAt: START_MS,
    credentialId: passkey.idText,
    tag,
  };
  // Stored: the public key and which passkey to ask. Not a word.
  assert.deepEqual(JSON.parse(stored(t.storage) ?? ''), record);
  assert.deepEqual(loadRecord(t.storage as Storage), record);
  for (const word of new Set(words.split(' '))) assert.ok(!(stored(t.storage) ?? '').includes(`"${word}`), word);

  assert.deepEqual(t.view(), {
    status: 'ready',
    record,
    unlocked: true,
    passkeyOffered: null,
    canStore: true,
    persisted: null,
    setup: null,
    created: 'passkey',
    // The name as this page wrote it into the passkey a moment ago.
    createdName: `Practice wallet ${tag} (no real money)`,
    pendingSwitch: null,
    pendingRestore: false,
    openedEmpty: false,
    wordsShown: 0,
  });
  // The "Wallet made" step shows the words with no second prompt.
  assert.deepEqual(t.session.revealWords(), words.split(' '));
  assert.deepEqual(t.auth.calls, ['create']);
  // The first scan has started, with the public key.
  assert.deepEqual(t.chain.opened, [{ xpub: account.xpub, seeded: false }]);
  assert.deepEqual(t.events, ['Passkey: ok', 'Wallet created: passkey', 'Words shown: passkey']);
  assert.equal(t.page.persistAsked, 0, 'nothing secret is stored, so nothing asks the browser to keep it');

  // The passkey's name carries the tag, in the language of the page.
  assert.equal(passkey.name, `Practice wallet ${tag} (no real money)`);
  // And that very name is what the "Wallet made" step is handed: the one the password manager holds.
  assert.equal(t.view().createdName, passkey.name);

  t.session.ackCreated();
  assert.equal(t.view().created, null);
  assert.equal(t.view().createdName, null, 'the name goes with the step: from here on only the tag is known');
  assert.equal(t.view().unlocked, true);
});

test('a passkey made on a Spanish page is named in Spanish', async () => {
  const t = start();
  t.page.lang = 'es';
  assert.deepEqual(await t.session.createWithPasskey(), { kind: 'created' });
  assert.equal(t.auth.passkeys[0]?.name, `Billetera de práctica ${t.view().record?.tag} (sin dinero de verdad)`);
  assert.equal(t.view().createdName, t.auth.passkeys[0]?.name);
});

test('createdName is the name as it was written at create(), whatever the page\'s language is by the time the wallet is made', async () => {
  // The language changes while the prompt is open. The name was written before that.
  const t = start();
  const release = t.auth.hold();
  const creating = t.session.createWithPasskey();
  t.page.lang = 'es';
  release();
  assert.deepEqual(await creating, { kind: 'created' });
  const made = t.auth.passkeys[0];
  assert.ok(made);
  assert.equal(made.name, `Practice wallet ${tagFromUserId(made.userId)} (no real money)`);
  assert.equal(t.view().createdName, made.name, 'the English name, on what is now a Spanish page');

  // "Finish setting up", pressed after the reader switched language: still the name written at create().
  const u = start();
  u.page.lang = 'es';
  u.auth.secretAtCreate = false;
  u.auth.refuseGet.push('NotAllowedError');
  assert.deepEqual(await u.session.createWithPasskey(), { kind: 'unfinished' });
  assert.equal(u.view().createdName, null, 'no wallet was made yet');
  u.page.lang = 'en';
  // Refused once more, and then it works.
  u.auth.refuseGet.push('NotAllowedError');
  assert.deepEqual(await u.session.finishSetup(), { kind: 'unfinished' });
  assert.equal(u.view().createdName, null);
  assert.deepEqual(await u.session.finishSetup(), { kind: 'created' });
  const finished = u.auth.passkeys[0];
  assert.ok(finished);
  assert.equal(finished.name, `Billetera de práctica ${tagFromUserId(finished.userId)} (sin dinero de verdad)`);
  assert.deepEqual([u.view().created, u.view().createdName], ['passkey', finished.name]);
});

test('createdName is set only beside created "passkey", and goes with everything that ends the step', async () => {
  // A wallet made without a passkey has no passkey to name.
  const w = start();
  assert.deepEqual(await w.session.createWithWords(), { kind: 'created' });
  assert.deepEqual([w.view().created, w.view().createdName], ['words', null]);

  // A wallet opened with a passkey was not made by this page: its name is not known here.
  const o = start();
  o.auth.add(1);
  assert.deepEqual(await o.session.openWithPasskey(), { kind: 'opened' });
  assert.deepEqual([o.view().created, o.view().createdName], [null, null]);

  // Another tab changes what is stored: the page starts again from it, and the step is over.
  const t = start();
  assert.deepEqual(await t.session.createWithPasskey(), { kind: 'created' });
  assert.notEqual(t.view().createdName, null);
  put(t.storage, makeRecord('words', A.mnemonic, START_MS));
  t.session.storageChanged(RECORD_KEY);
  assert.deepEqual([t.view().created, t.view().createdName], [null, null]);

  // Removed, and made again without a passkey: nothing of the first wallet's name is left.
  const r = start();
  assert.deepEqual(await r.session.createWithPasskey(), { kind: 'created' });
  assert.equal(r.session.removeWallet(), 'removed');
  assert.deepEqual([r.view().status, r.view().createdName], ['none', null]);
  assert.deepEqual(await r.session.createWithWords(), { kind: 'created' });
  assert.deepEqual([r.view().created, r.view().createdName], ['words', null]);

  // A passkey call that never asks for a name: the wallet is made, and no name is claimed.
  const port = passkeyPort(new VirtualAuthenticator().env());
  const silent = makeSession({
    local: new MemoryStorage() as Storage,
    passkeys: { ...port, create: () => port.create((tag) => `some name ${tag}`) },
    chain: new FakeChain(),
    now: () => START_MS,
    track: () => {},
    persist: async () => null,
    lang: () => 'en',
  });
  assert.deepEqual(await silent.createWithPasskey(), { kind: 'created' });
  assert.deepEqual([silent.view().created, silent.view().createdName], ['passkey', null]);
});

test('createWithPasskey: a provider that gives the secret only at the follow-up prompt', async () => {
  const t = start();
  t.auth.secretAtCreate = false;
  assert.deepEqual(await t.session.createWithPasskey(), { kind: 'created' });
  assert.deepEqual(t.auth.calls, ['create', `get ${t.auth.passkeys[0]?.idText}`]);
  assert.deepEqual(t.session.revealWords(), t.auth.wordsOf(0).split(' '));
  assert.deepEqual(t.events, ['Passkey: ok-at-get', 'Wallet created: passkey', 'Words shown: passkey']);
});

test('createWithPasskey: if the save fails after the passkey was made, the passkey is given up and the keys are dropped', async () => {
  // Another tab stored a wallet while the prompt was open.
  const t = start();
  let release = t.auth.hold();
  let creating = t.session.createWithPasskey();
  const other = makeRecord('words', A.mnemonic, START_MS);
  put(t.storage, other);
  release();
  assert.deepEqual(await creating, { kind: 'exists' });
  assert.deepEqual(t.auth.forgotten, [t.auth.passkeys[0]?.idText], 'the new passkey has no wallet here');
  assert.deepEqual(JSON.parse(stored(t.storage) ?? ''), other, 'the other tab\'s wallet is untouched');
  // This page now shows that wallet, and holds nothing of the passkey's.
  assert.deepEqual([t.view().status, t.view().record?.fingerprint, t.view().created], ['ready', A.masterFingerprint, null]);
  assert.deepEqual(t.session.revealWords(), A.mnemonic.split(' '));
  assert.deepEqual(t.events, ['Passkey: ok', 'Words shown: words'], 'no wallet was created here');

  // The browser stopped storing while the prompt was open.
  const storage = new FullStorage();
  storage.full = false;
  const f = start({ storage });
  release = f.auth.hold();
  creating = f.session.createWithPasskey();
  storage.full = true;
  release();
  assert.deepEqual(await creating, { kind: 'no-storage' });
  assert.deepEqual(f.auth.forgotten, [f.auth.passkeys[0]?.idText]);
  assert.equal(stored(storage), null);
  assert.deepEqual([f.view().status, f.view().unlocked, f.view().canStore, f.view().created], ['none', false, false, null]);
  assert.equal(f.session.revealWords(), null);
  assert.deepEqual(f.chain.opened, []);
});

test('an unfinished setup: the tag is shown, finishSetup() asks the same passkey again', async () => {
  const t = start();
  t.auth.secretAtCreate = false;
  t.auth.refuseGet.push('NotAllowedError');
  assert.deepEqual(await t.session.createWithPasskey(), { kind: 'unfinished' });
  const passkey = t.auth.passkeys[0];
  assert.ok(passkey);
  const tag = tagFromUserId(passkey.userId);
  assert.deepEqual([t.view().status, t.view().setup, t.view().unlocked], ['none', { tag }, false]);
  assert.equal(stored(t.storage), null, 'nothing is stored for a passkey that has given no secret');
  assert.deepEqual(t.events, ['Passkey: unfinished']);

  // Refused again: still unfinished, the same passkey.
  t.auth.refuseGet.push('NotAllowedError');
  const before = t.view().setup;
  assert.deepEqual(await t.session.finishSetup(), { kind: 'unfinished' });
  assert.equal(t.view().setup, before);

  assert.deepEqual(await t.session.finishSetup(), { kind: 'created' });
  assert.deepEqual(t.auth.calls, ['create', `get ${passkey.idText}`, `get ${passkey.idText}`, `get ${passkey.idText}`]);
  assert.deepEqual([t.view().status, t.view().setup, t.view().created, t.view().record?.tag], ['ready', null, 'passkey', tag]);
  assert.deepEqual(t.session.revealWords(), t.auth.wordsOf(0).split(' '));
  assert.deepEqual(t.events, ['Passkey: unfinished', 'Passkey: unfinished', 'Passkey: finished', 'Wallet created: passkey', 'Words shown: passkey']);
  assert.deepEqual(t.auth.forgotten, [], 'the passkey has its wallet');

  // Nothing to finish.
  assert.deepEqual(await start().session.finishSetup(), { kind: 'error', name: 'NothingToFinish' });
});

test('an unfinished passkey is given up when a wallet arrives in this browser some other way', async () => {
  const t = start();
  t.auth.secretAtCreate = false;
  t.auth.refuseGet.push('NotAllowedError');
  assert.deepEqual(await t.session.createWithPasskey(), { kind: 'unfinished' });
  assert.deepEqual(await t.session.createWithWords(), { kind: 'created' });
  assert.deepEqual(t.auth.forgotten, [t.auth.passkeys[0]?.idText]);
  assert.equal(t.view().setup, null);
  assert.deepEqual(await t.session.finishSetup(), { kind: 'exists' });

  // The same when another tab stores one.
  const u = start();
  u.auth.secretAtCreate = false;
  u.auth.refuseGet.push('NotAllowedError');
  await u.session.createWithPasskey();
  put(u.storage, makeRecord('words', B.mnemonic, START_MS));
  u.session.storageChanged(RECORD_KEY);
  assert.deepEqual([u.view().status, u.view().setup], ['ready', null]);
  assert.deepEqual(u.auth.forgotten, [u.auth.passkeys[0]?.idText]);
});

test('an unfinished passkey is kept when the wallet that arrives is its own', async () => {
  // The reader leaves "Finish setting up" alone and taps "Open with my passkey". The picker offers
  // the passkey that was just made, and this time it hands its secret over.
  const t = start();
  t.auth.secretAtCreate = false;
  t.auth.refuseGet.push('NotAllowedError');
  assert.deepEqual(await t.session.createWithPasskey(), { kind: 'unfinished' });
  const passkey = t.auth.passkeys[0];
  assert.ok(passkey);
  assert.deepEqual(await t.session.openWithPasskey(), { kind: 'opened' });
  assert.equal(t.view().record?.credentialId, passkey.idText);
  assert.deepEqual(t.auth.forgotten, [], 'the password manager is never told to drop the passkey of the wallet that is here');
  assert.equal(t.view().setup, null, 'and nothing is left to finish');
  // So it still unlocks its wallet. (This stand-in manager drops a passkey it is told to forget, as Chrome's does.)
  t.session.lock();
  assert.deepEqual(await t.session.unlock(), { kind: 'unlocked' });
  assert.deepEqual(t.session.revealWords(), t.auth.wordsOf(0).split(' '));

  // Two tabs: the setup is left unfinished in one, and the wallet is opened with that passkey in the other.
  const storage = new MemoryStorage();
  const auth = new VirtualAuthenticator();
  auth.secretAtCreate = false;
  auth.refuseGet.push('NotAllowedError');
  const one = start({ storage, auth });
  assert.deepEqual(await one.session.createWithPasskey(), { kind: 'unfinished' });
  const two = start({ storage, auth });
  assert.deepEqual(await two.session.openWithPasskey(), { kind: 'opened' });
  one.session.storageChanged(RECORD_KEY);
  assert.deepEqual(auth.forgotten, []);
  assert.deepEqual([one.view().status, one.view().setup, one.view().record?.credentialId], ['ready', null, auth.passkeys[0]?.idText]);
  assert.deepEqual(await one.session.unlock(), { kind: 'unlocked' });

  // The same when the first tab learns of it only by asking: "Finish setting up" finds the wallet there.
  const s2 = new MemoryStorage();
  const a2 = new VirtualAuthenticator();
  a2.secretAtCreate = false;
  a2.refuseGet.push('NotAllowedError');
  const first = start({ storage: s2, auth: a2 });
  await first.session.createWithPasskey();
  await start({ storage: s2, auth: a2 }).session.openWithPasskey();
  assert.deepEqual(await first.session.finishSetup(), { kind: 'exists' });
  assert.deepEqual([a2.forgotten, first.view().setup, first.view().record?.credentialId], [[], null, a2.passkeys[0]?.idText]);

  // And when its wallet is stored by another tab while "Finish setting up" has its prompt open here.
  const r = start();
  r.auth.secretAtCreate = false;
  r.auth.refuseGet.push('NotAllowedError');
  await r.session.createWithPasskey();
  const own = r.auth.passkeys[0];
  assert.ok(own);
  const release = r.auth.hold();
  const finishing = r.session.finishSetup();
  put(r.storage, makeRecord('passkey', r.auth.wordsOf(0), START_MS, { credentialId: own.idText, tag: tagFromUserId(own.userId) }));
  release();
  assert.deepEqual(await finishing, { kind: 'exists' });
  assert.deepEqual(r.auth.forgotten, []);
  assert.deepEqual([r.view().status, r.view().setup, r.view().record?.credentialId], ['ready', null, own.idText]);
  assert.deepEqual(await r.session.unlock(), { kind: 'unlocked' });

  // A storage that stops answering the moment the wallet is in it: the page still knows whose wallet it holds.
  class FadingStorage extends MemoryStorage {
    private readsLeft = Infinity;
    override setItem(key: string, value: string): void {
      super.setItem(key, value);
      // One more read works: the one that checks the write.
      if (key === RECORD_KEY) this.readsLeft = 1;
    }
    override getItem(key: string): string | null {
      if (key === RECORD_KEY && this.readsLeft-- <= 0) throw new DOMException('The operation is insecure.', 'SecurityError');
      return super.getItem(key);
    }
  }
  const fading = start({ storage: new FadingStorage() });
  fading.auth.secretAtCreate = false;
  fading.auth.refuseGet.push('NotAllowedError');
  assert.deepEqual(await fading.session.createWithPasskey(), { kind: 'unfinished' });
  assert.deepEqual(await fading.session.openWithPasskey(), { kind: 'opened' });
  assert.deepEqual([fading.auth.forgotten, fading.view().setup], [[], null]);

  // Another passkey's wallet is not its own: the unfinished one is given up, and the other is left alone.
  const d = start();
  const older = passkeyWallet(d.auth);
  d.auth.secretAtCreate = false;
  d.auth.refuseGet.push('NotAllowedError');
  assert.deepEqual(await d.session.createWithPasskey(), { kind: 'unfinished' });
  d.auth.pick = 0;
  assert.deepEqual(await d.session.openWithPasskey(), { kind: 'opened' });
  assert.equal(d.view().record?.credentialId, older.passkey.idText);
  assert.deepEqual(d.auth.forgotten, [d.auth.passkeys[1]?.idText]);
  assert.equal(d.view().setup, null);
});

test('an unfinished passkey and something stored that cannot be read: nothing is hinted, and the setup goes on waiting', async () => {
  // Nobody can tell whose wallet a damaged record was, or one written by a newer version of the page.
  for (const [arrived, status] of [['{"v":1,"kind":"passkey"', 'unreadable'], [{ v: 2, kind: 'passkey' }, 'newer']] as const) {
    const t = start();
    t.auth.secretAtCreate = false;
    t.auth.refuseGet.push('NotAllowedError');
    assert.deepEqual(await t.session.createWithPasskey(), { kind: 'unfinished' });
    const waiting = t.view().setup;
    put(t.storage, arrived);
    t.session.storageChanged(RECORD_KEY);
    assert.deepEqual([t.view().status, t.view().setup, t.auth.forgotten], [status, waiting, []], status);
    assert.deepEqual(await t.session.finishSetup(), { kind: 'exists' }, status);
    assert.deepEqual([t.view().setup, t.auth.forgotten, t.auth.calls.length], [waiting, [], 2], `${status}: no prompt, no hint`);
    if (status !== 'unreadable') continue;
    // The reader removes what cannot be read: the setup can be finished after all.
    assert.equal(t.session.removeWallet(), 'removed');
    assert.deepEqual(await t.session.finishSetup(), { kind: 'created' });
    assert.deepEqual([t.view().status, t.view().setup, t.auth.forgotten], ['ready', null, []]);
  }
});

test('a wallet arrives while the create prompt is open, and the prompt ends "unfinished": no setup is left behind', async () => {
  const t = start();
  t.auth.secretAtCreate = false;
  t.auth.refuseGet.push('NotAllowedError');
  const release = t.auth.hold();
  const creating = t.session.createWithPasskey();
  await flush();
  // Another tab makes a wallet without a passkey meanwhile, and this tab hears of it.
  put(t.storage, makeRecord('words', A.mnemonic, START_MS));
  t.session.storageChanged(RECORD_KEY);
  release();
  assert.deepEqual(await creating, { kind: 'exists' });
  assert.deepEqual([t.view().status, t.view().record?.kind, t.view().setup], ['ready', 'words', null]);
  assert.deepEqual(t.auth.forgotten, [t.auth.passkeys[0]?.idText], 'the passkey that was made has no wallet here, and cannot get one');
  assert.deepEqual(t.events, ['Passkey: unfinished']);
  assert.deepEqual(await t.session.finishSetup(), { kind: 'exists' });

  // The same when this tab has not heard of the other one's wallet yet.
  const u = start();
  u.auth.secretAtCreate = false;
  u.auth.refuseGet.push('NotAllowedError');
  const open = u.auth.hold();
  const making = u.session.createWithPasskey();
  await flush();
  put(u.storage, makeRecord('words', B.mnemonic, START_MS));
  open();
  assert.deepEqual(await making, { kind: 'exists' });
  assert.deepEqual([u.view().status, u.view().record?.fingerprint, u.view().setup], ['ready', B.masterFingerprint, null]);
  assert.deepEqual(u.auth.forgotten, [u.auth.passkeys[0]?.idText]);

  // What arrives while the prompt is open cannot be read. Nobody can tell whose it is: "exists", and no hint.
  for (const secretAtCreate of [false, true]) {
    const x = start();
    x.auth.secretAtCreate = secretAtCreate;
    if (!secretAtCreate) x.auth.refuseGet.push('NotAllowedError');
    const gate = x.auth.hold();
    const pending = x.session.createWithPasskey();
    await flush();
    put(x.storage, '{"v":1,"kind":"passkey"');
    gate();
    assert.deepEqual(await pending, { kind: 'exists' }, `secret at create: ${secretAtCreate}`);
    assert.deepEqual([x.view().status, x.view().setup, x.view().unlocked, x.auth.forgotten], ['unreadable', null, false, []]);
  }

  // "Finish setting up" that ends unfinished again, with a wallet stored meanwhile: the setup is over too.
  const v = start();
  v.auth.secretAtCreate = false;
  v.auth.refuseGet.push('NotAllowedError');
  await v.session.createWithPasskey();
  v.auth.refuseGet.push('NotAllowedError');
  const held = v.auth.hold();
  const finishing = v.session.finishSetup();
  await flush();
  put(v.storage, makeRecord('words', A.mnemonic, START_MS));
  held();
  assert.deepEqual(await finishing, { kind: 'exists' });
  assert.deepEqual([v.view().status, v.view().setup, v.auth.forgotten], ['ready', null, [v.auth.passkeys[0]?.idText]]);
});

test('createWithPasskey: no secret, a cancel, a timeout and a fault each have their answer', async () => {
  // The provider cannot give the secret: say so, hint it to drop the passkey.
  const noPrf = start();
  noPrf.auth.hasSecret = false;
  const answer = await noPrf.session.createWithPasskey();
  const passkey = noPrf.auth.passkeys[0];
  assert.ok(passkey);
  assert.deepEqual(answer, { kind: 'no-prf', tag: tagFromUserId(passkey.userId) });
  assert.deepEqual(noPrf.auth.forgotten, [passkey.idText]);
  assert.deepEqual([noPrf.view().status, noPrf.view().setup, stored(noPrf.storage)], ['none', null, null]);
  assert.deepEqual(noPrf.events, ['Passkey: no-prf']);

  const cancelled = start();
  cancelled.auth.refuseCreate.push('NotAllowedError');
  assert.deepEqual(await cancelled.session.createWithPasskey(), { kind: 'cancelled', timedOut: false });
  assert.deepEqual(cancelled.events, ['Passkey: cancelled']);
  assert.deepEqual(cancelled.auth.forgotten, []);

  const timedOut = start({ passkeys: answering({ kind: 'cancelled', timedOut: true }) });
  assert.deepEqual(await timedOut.session.createWithPasskey(), { kind: 'cancelled', timedOut: true });
  assert.deepEqual(timedOut.events, ['Passkey: timed-out']);

  const fault = start();
  fault.auth.refuseCreate.push('SecurityError');
  assert.deepEqual(await fault.session.createWithPasskey(), { kind: 'error', name: 'SecurityError' });
  assert.deepEqual(fault.events, ['Passkey: error']);

  // passkey.ts's own "another prompt is open" is the same "busy" a screen already knows.
  const busy = start({ passkeys: answering({ kind: 'error', name: 'Busy' }) });
  assert.deepEqual(await busy.session.createWithPasskey(), { kind: 'busy' });
  assert.deepEqual(await busy.session.openWithPasskey(), { kind: 'busy' });
  assert.deepEqual(busy.events, []);

  for (const t of [noPrf, cancelled, timedOut, fault, busy]) {
    assert.deepEqual([t.view().status, t.view().unlocked, t.view().created], ['none', false, null]);
    assert.deepEqual(t.chain.opened, []);
  }
});

test('createWithWords: random words, kept in this browser, and the browser is asked once to keep its data', async () => {
  const t = start();
  assert.deepEqual(await t.session.createWithWords(), { kind: 'created' });
  // Here the record is the wallet: it holds the words.
  assert.deepEqual(loadRecord(t.storage as Storage), makeRecord('words', A.mnemonic, START_MS));
  assert.deepEqual(t.view().record, {
    v: 1,
    kind: 'words',
    fingerprint: A.masterFingerprint,
    xpub: A.xpub,
    firstAddress: firstOf(A),
    createdAt: START_MS,
  });
  assert.deepEqual([t.view().status, t.view().unlocked, t.view().created, t.view().persisted], ['ready', true, 'words', null]);
  assert.deepEqual(t.chain.opened, [{ xpub: A.xpub, seeded: false }]);
  assert.deepEqual(t.auth.calls, []);
  await flush();
  assert.equal(t.view().persisted, true);
  assert.equal(t.page.persistAsked, 1);
  assert.deepEqual(t.events, ['Wallet created: words']);

  t.session.ackCreated();
  assert.equal(t.view().created, null);

  // A second wallet without a passkey in the same page: the browser is not asked again, the answer is shown again.
  assert.equal(t.session.removeWallet(), 'removed');
  assert.equal(t.view().persisted, null);
  assert.deepEqual(await t.session.createWithWords(), { kind: 'created' });
  await flush();
  assert.deepEqual([t.view().persisted, t.page.persistAsked], [true, 1]);

  // The real word generator, when none is handed in: 12 words that are a wallet.
  const real = makeSession({
    local: new MemoryStorage() as Storage,
    passkeys: passkeyPort(new VirtualAuthenticator().env()),
    chain: new FakeChain(),
    now: () => START_MS,
    track: recorder().track,
    persist: async () => false,
    lang: () => 'en',
    selfTest: () => true,
  });
  assert.deepEqual(await real.createWithWords(), { kind: 'created' });
  const made = real.revealWords();
  assert.equal(made?.length, 12);
  assert.equal(accountFromMnemonic((made ?? []).join(' ')).xpub, real.view().record?.xpub);
  await flush();
  assert.equal(real.view().persisted, false);
});

test('a browser that cannot say whether it keeps data, or fails to: persisted stays null', async () => {
  for (const persist of [async () => null, () => Promise.reject(new Error('no')), () => { throw new Error('no'); }, (async () => 'yes') as unknown as () => Promise<boolean>]) {
    const t = start({ persist });
    assert.deepEqual(await t.session.createWithWords(), { kind: 'created' });
    await flush();
    assert.equal(t.view().persisted, null);
  }
});

// -- open ---------------------------------------------------------------------------------

test('openWithPasskey: the reader picks a passkey, its wallet is adopted, and an empty one is flagged until coins are seen', async () => {
  const t = start();
  const wallet = passkeyWallet(t.auth);
  assert.deepEqual(await t.session.openWithPasskey(), { kind: 'opened' });
  assert.deepEqual(t.auth.calls, ['get (picker)'], 'no credential ID: the browser shows its picker');

  const record = { ...wallet.record, createdAt: START_MS };
  assert.deepEqual(loadRecord(t.storage as Storage), record);
  assert.deepEqual([t.view().status, t.view().unlocked, t.view().created, t.view().openedEmpty], ['ready', true, null, false]);
  assert.deepEqual(t.view().record, record);
  assert.deepEqual(t.session.revealWords(), wallet.words.split(' '));
  assert.deepEqual(t.chain.opened, [{ xpub: wallet.account.xpub, seeded: false }]);
  assert.deepEqual(t.events, ['Words shown: passkey'], 'what kind of opening it was is not known before the first scan');

  // The first scan finds no history: say so, until coins are seen.
  t.chain.finishFirstScan(coinsState());
  await flush();
  assert.equal(t.view().openedEmpty, true);
  assert.deepEqual(t.events, ['Words shown: passkey', 'Unlock: opened-empty']);
  t.chain.setCoins(coinsState());
  assert.equal(t.view().openedEmpty, true);
  t.chain.setCoins(coinsState([{ txid: 'a'.repeat(64), vout: 0, value: 5n, status: { confirmed: false }, chain: 0, index: 0, address: SOMEONE, script: new Uint8Array() }]));
  assert.equal(t.view().openedEmpty, false);
  // Spent again: the explanation does not come back.
  t.chain.setCoins(coinsState());
  assert.equal(t.view().openedEmpty, false);
});

test('openWithPasskey: a wallet with history is "opened", and one that leaves before its scan is not counted', async () => {
  const t = start();
  passkeyWallet(t.auth);
  assert.deepEqual(await t.session.openWithPasskey(), { kind: 'opened' });
  t.chain.finishFirstScan(coinsState([], true));
  await flush();
  assert.deepEqual([t.view().openedEmpty, t.events], [false, ['Unlock: opened']]);

  const gone = start();
  passkeyWallet(gone.auth);
  assert.deepEqual(await gone.session.openWithPasskey(), { kind: 'opened' });
  assert.equal(gone.session.removeWallet(), 'removed');
  await flush();
  assert.deepEqual(gone.events, ['Wallet removed: passkey']);
  assert.equal(gone.view().openedEmpty, false);
});

test('openWithPasskey: no passkey here, no secret, a record that appeared meanwhile', async () => {
  // Nothing to pick, or the reader said no: the browser does not say which.
  const none = start();
  assert.deepEqual(await none.session.openWithPasskey(), { kind: 'cancelled', timedOut: false });
  assert.deepEqual(none.events, ['Unlock: cancelled']);

  // The passkey answers without its secret. It is the reader's own passkey: nothing hints to forget it.
  const noPrf = start();
  const wallet = passkeyWallet(noPrf.auth);
  noPrf.auth.hasSecret = false;
  assert.deepEqual(await noPrf.session.openWithPasskey(), { kind: 'no-prf', tag: wallet.tag });
  assert.deepEqual([noPrf.events, noPrf.auth.forgotten], [['Unlock: no-prf'], []]);

  const fault = start();
  fault.auth.refuseGet.push('InvalidStateError');
  assert.deepEqual(await fault.session.openWithPasskey(), { kind: 'error', name: 'InvalidStateError' });
  assert.deepEqual(fault.events, ['Unlock: error']);

  for (const t of [none, noPrf, fault]) {
    assert.deepEqual([t.view().status, stored(t.storage), t.chain.opened.length], ['none', null, 0]);
  }

  // Another tab stored a wallet while the picker was open: that one stays, and this passkey is left alone.
  const raced = start();
  passkeyWallet(raced.auth);
  const release = raced.auth.hold();
  const opening = raced.session.openWithPasskey();
  const other = makeRecord('words', A.mnemonic, START_MS);
  put(raced.storage, other);
  release();
  assert.deepEqual(await opening, { kind: 'exists' });
  assert.deepEqual(JSON.parse(stored(raced.storage) ?? ''), other);
  assert.deepEqual(raced.auth.forgotten, []);
  assert.equal(raced.view().record?.fingerprint, A.masterFingerprint);
});

// -- unlock -------------------------------------------------------------------------------

test('unlock("stored") asks the one passkey this browser remembers; the same wallet loads its keys', async () => {
  const t = lockedTab();
  assert.deepEqual(await t.session.unlock(), { kind: 'unlocked' });
  assert.deepEqual(t.auth.calls, [`get ${t.wallet.passkey.idText}`]);
  assert.equal(t.view().unlocked, true);
  assert.deepEqual(t.session.revealWords(), t.wallet.words.split(' '));
  assert.deepEqual(t.events, ['Unlock: same', 'Words shown: passkey']);
  assert.deepEqual(t.chain.announced, ['unlocked']);
  assert.deepEqual(t.chain.opened.length, 1, 'the coins already read stay');
  assert.deepEqual(JSON.parse(stored(t.storage) ?? ''), t.wallet.record, 'nothing is written');

  // Unlocked already: no second prompt.
  assert.deepEqual(await t.session.unlock('stored'), { kind: 'unlocked' });
  assert.equal(t.auth.calls.length, 1);
});

test('unlock("picker") lets the reader choose; choosing the stored passkey is the same wallet', async () => {
  const t = lockedTab();
  assert.deepEqual(await t.session.unlock('picker'), { kind: 'unlocked' });
  assert.deepEqual(t.auth.calls, ['get (picker)']);
  assert.equal(t.view().unlocked, true);
  // Asked again while unlocked: the picker opens, because the reader asked to choose.
  assert.deepEqual(await t.session.unlock('picker'), { kind: 'unlocked' });
  assert.deepEqual(t.auth.calls, ['get (picker)', 'get (picker)']);
});

test('unlock: a wallet made without a passkey answers "unlocked" at once, and no wallet answers "gone"', async () => {
  const storage = new MemoryStorage();
  put(storage, makeRecord('words', A.mnemonic, START_MS));
  const words = start({ storage });
  assert.deepEqual(await words.session.unlock(), { kind: 'unlocked' });
  assert.deepEqual(await words.session.unlock('picker'), { kind: 'unlocked' });
  assert.deepEqual([words.auth.calls, words.events, words.chain.announced], [[], [], []]);

  const none = start();
  assert.deepEqual(await none.session.unlock(), { kind: 'gone' });
  assert.deepEqual(none.auth.calls, []);
});

test('unlock: another passkey answers. Nothing changes until the reader confirms the switch', async () => {
  const t = lockedTab();
  const other = passkeyWallet(t.auth, 2);
  t.auth.pick = 1;
  const before = stored(t.storage);

  assert.deepEqual(await t.session.unlock('picker'), { kind: 'other-passkey', tag: other.tag, fingerprint: other.account.masterFingerprint });
  assert.deepEqual(t.view().pendingSwitch, { tag: other.tag, fingerprint: other.account.masterFingerprint });
  assert.deepEqual([t.view().unlocked, t.view().record?.fingerprint], [false, t.wallet.account.masterFingerprint]);
  assert.equal(t.session.revealWords(), null, 'the other wallet\'s words wait where no screen can reach them');
  assert.equal(stored(t.storage), before);
  assert.deepEqual(t.chain.opened.length, 1);
  assert.deepEqual(t.events, ['Unlock: other-passkey']);

  // Confirmed: that wallet is this browser's wallet now, unlocked, and scanned from nothing.
  assert.equal(t.session.confirmSwitch(), 'switched');
  assert.deepEqual(loadRecord(t.storage as Storage), { ...other.record, createdAt: START_MS });
  assert.deepEqual([t.view().pendingSwitch, t.view().unlocked, t.view().record?.fingerprint], [null, true, other.account.masterFingerprint]);
  assert.deepEqual(t.session.revealWords(), other.words.split(' '));
  assert.deepEqual(t.chain.opened.map((opened) => opened.xpub), [t.wallet.account.xpub, other.account.xpub]);
  assert.deepEqual(t.chain.announced, ['unlocked']);
  assert.equal(t.session.confirmSwitch(), 'nothing-pending');
});

test('unlock: a pending switch is dropped by cancel, by lock, by asking again, and when another tab changes the wallet', async () => {
  const pending = async () => {
    const t = lockedTab();
    passkeyWallet(t.auth, 2);
    t.auth.pick = 1;
    assert.equal((await t.session.unlock('picker')).kind, 'other-passkey');
    return t;
  };

  const cancelled = await pending();
  const before = stored(cancelled.storage);
  cancelled.session.cancelSwitch();
  assert.equal(cancelled.view().pendingSwitch, null);
  assert.equal(cancelled.session.confirmSwitch(), 'nothing-pending');
  assert.equal(stored(cancelled.storage), before);

  const locked = await pending();
  locked.session.lock();
  assert.equal(locked.view().pendingSwitch, null);
  assert.equal(locked.session.confirmSwitch(), 'nothing-pending');

  // Asking the stored passkey again, and cancelling that prompt: the old offer is over all the same.
  const again = await pending();
  again.auth.refuseGet.push('NotAllowedError');
  assert.deepEqual(await again.session.unlock(), { kind: 'cancelled', timedOut: false });
  assert.equal(again.view().pendingSwitch, null);
  assert.equal(again.session.confirmSwitch(), 'nothing-pending');

  // Another tab replaced the wallet before the reader confirmed: nothing is written over it.
  const replaced = await pending();
  const theirs = makeRecord('words', A.mnemonic, START_MS);
  put(replaced.storage, theirs);
  assert.equal(replaced.session.confirmSwitch(), 'gone');
  assert.deepEqual(JSON.parse(stored(replaced.storage) ?? ''), theirs);
  assert.deepEqual([replaced.view().pendingSwitch, replaced.view().record?.fingerprint], [null, A.masterFingerprint]);

  // Another tab removed it.
  const removed = await pending();
  removed.storage.map.delete(RECORD_KEY);
  assert.equal(removed.session.confirmSwitch(), 'gone');
  assert.deepEqual([stored(removed.storage), removed.view().status], [null, 'none']);

  // The browser stops storing: the offer stays, and can be confirmed once it stores again.
  const storage = new FullStorage();
  storage.full = false;
  const full = lockedTab({ storage });
  const other = passkeyWallet(full.auth, 2);
  full.auth.pick = 1;
  await full.session.unlock('picker');
  storage.full = true;
  assert.equal(full.session.confirmSwitch(), 'no-storage');
  assert.notEqual(full.view().pendingSwitch, null);
  assert.equal(full.view().canStore, false);
  storage.full = false;
  assert.equal(full.session.confirmSwitch(), 'switched');
  assert.equal(full.view().record?.fingerprint, other.account.masterFingerprint);
});

test('unlock: the stored passkey gives a wallet that fits nothing stored. Never opened, never overwritten', async () => {
  const t = lockedTab();
  // The same passkey now answers with another secret.
  t.wallet.passkey.secret = Uint8Array.from({ length: 32 }, (_, i) => 200 - i);
  const before = stored(t.storage);
  assert.deepEqual(await t.session.unlock(), { kind: 'changed' });
  assert.deepEqual([t.view().unlocked, t.view().pendingSwitch], [false, null]);
  assert.equal(t.session.revealWords(), null);
  assert.equal(stored(t.storage), before);
  assert.deepEqual([t.chain.opened.length, t.chain.announced], [1, []]);
  assert.deepEqual(t.events, ['Unlock: changed']);

  // The whole record replaced by another wallet's, under the same passkey ID: the same answer.
  const u = lockedTab();
  const forged = { ...u.wallet.record, fingerprint: B.masterFingerprint, xpub: B.xpub, firstAddress: firstOf(B) };
  put(u.storage, forged);
  u.session.storageChanged(RECORD_KEY);
  assert.equal(u.view().record?.xpub, B.xpub, 'until an unlock, the page can only show what is stored');
  assert.deepEqual(await u.session.unlock(), { kind: 'changed' });
  assert.deepEqual(JSON.parse(stored(u.storage) ?? ''), forged);
  assert.equal(u.view().unlocked, false);
});

test('unlock: a record altered in one of its two parts is rebuilt from the keys, and the wallet is scanned from nothing', async () => {
  const alterations: [string, (record: WalletRecord) => WalletRecord][] = [
    ['the public key', (record) => ({ ...record, xpub: B.xpub, firstAddress: firstOf(B) })],
    ['the wallet fingerprint', (record) => ({ ...record, fingerprint: 'deadbeef' })],
  ];
  for (const [what, alter] of alterations) {
    // Altered before the page loaded.
    const auth = new VirtualAuthenticator();
    const storage = new MemoryStorage();
    const wallet = passkeyWallet(auth);
    put(storage, alter(wallet.record));
    const t = start({ auth, storage });
    assert.equal(t.view().status, 'ready', what);

    assert.deepEqual(await t.session.unlock(), { kind: 'tampered' }, what);
    assert.deepEqual(loadRecord(storage as Storage), wallet.record, what);
    assert.deepEqual(t.view().record, wallet.record, what);
    assert.equal(t.view().unlocked, true, what);
    assert.deepEqual(t.session.revealWords(), wallet.words.split(' '), what);
    // Whatever was read for the altered record is dropped: the wallet is opened again by its real key.
    assert.equal(t.chain.opened.length, 2, what);
    assert.deepEqual(t.chain.opened.at(-1), { xpub: wallet.account.xpub, seeded: false }, what);
    assert.deepEqual(t.events, ['Unlock: tampered', 'Words shown: passkey'], what);
    assert.deepEqual(t.chain.announced, ['unlocked'], what);

    // The next unlock is an ordinary one.
    t.session.lock();
    assert.deepEqual(await t.session.unlock(), { kind: 'unlocked' }, what);
  }

  // Altered while the page was open, with no storage event: the unlock reads the storage itself.
  const t = lockedTab();
  put(t.storage, { ...t.wallet.record, fingerprint: 'deadbeef' });
  assert.deepEqual(await t.session.unlock(), { kind: 'tampered' });
  assert.deepEqual(loadRecord(t.storage as Storage), t.wallet.record);

  // The record cannot be written again (the browser stopped storing): the keys are not loaded on top of
  // a record that is known to be wrong.
  const storage = new FullStorage();
  storage.full = false;
  const stuck = lockedTab({ storage });
  const altered = { ...stuck.wallet.record, xpub: B.xpub, firstAddress: firstOf(B) };
  put(storage, altered);
  storage.full = true;
  assert.deepEqual(await stuck.session.unlock(), { kind: 'error', name: 'StorageError' });
  assert.deepEqual(JSON.parse(stored(storage) ?? ''), altered);
  assert.equal(stuck.view().unlocked, false);
  assert.equal(stuck.session.revealWords(), null);
});

test('unlock: a passkey that answers without its secret, a cancel, a fault, a prompt already open', async () => {
  const noPrf = lockedTab();
  noPrf.auth.hasSecret = false;
  assert.deepEqual(await noPrf.session.unlock(), { kind: 'no-prf', tag: null });
  assert.deepEqual(await noPrf.session.unlock('picker'), { kind: 'no-prf', tag: noPrf.wallet.tag });
  assert.deepEqual(noPrf.events, ['Unlock: no-prf', 'Unlock: no-prf']);
  assert.deepEqual(noPrf.auth.forgotten, []);

  const cancelled = lockedTab();
  cancelled.auth.refuseGet.push('NotAllowedError');
  assert.deepEqual(await cancelled.session.unlock(), { kind: 'cancelled', timedOut: false });
  assert.deepEqual(cancelled.events, ['Unlock: cancelled']);

  const timedOut = lockedTab({ passkeys: answering({ kind: 'cancelled', timedOut: true }) });
  assert.deepEqual(await timedOut.session.unlock(), { kind: 'cancelled', timedOut: true });
  assert.deepEqual(timedOut.events, ['Unlock: timed-out']);

  const fault = lockedTab();
  fault.auth.refuseGet.push('UnknownError');
  assert.deepEqual(await fault.session.unlock(), { kind: 'error', name: 'UnknownError' });
  assert.deepEqual(fault.events, ['Unlock: error']);

  const busy = lockedTab();
  const release = busy.auth.hold();
  const first = busy.session.unlock();
  assert.deepEqual(await busy.session.unlock(), { kind: 'busy' });
  assert.deepEqual(await busy.session.unlock('picker'), { kind: 'busy' });
  release();
  assert.deepEqual(await first, { kind: 'unlocked' });
  assert.deepEqual(busy.auth.calls.length, 1);

  for (const t of [noPrf, cancelled, timedOut, fault]) {
    assert.equal(t.view().unlocked, false);
    assert.equal(t.session.revealWords(), null);
    assert.deepEqual(t.chain.announced, []);
  }
});

test('unlock: the wallet was removed or replaced in another tab while the prompt was open. "gone", and nothing is written', async () => {
  // Removed.
  const removed = lockedTab();
  let release = removed.auth.hold();
  let unlocking = removed.session.unlock();
  removed.storage.map.delete(RECORD_KEY);
  release();
  assert.deepEqual(await unlocking, { kind: 'gone' });
  assert.deepEqual([stored(removed.storage), removed.view().status, removed.view().unlocked], [null, 'none', false]);
  assert.equal(removed.session.revealWords(), null);
  assert.deepEqual(removed.events, []);

  // Replaced by another wallet.
  const replaced = lockedTab();
  release = replaced.auth.hold();
  unlocking = replaced.session.unlock();
  const theirs = makeRecord('words', A.mnemonic, START_MS);
  put(replaced.storage, theirs);
  release();
  assert.deepEqual(await unlocking, { kind: 'gone' });
  assert.deepEqual(JSON.parse(stored(replaced.storage) ?? ''), theirs);
  assert.equal(replaced.view().record?.fingerprint, A.masterFingerprint);
  assert.deepEqual(replaced.session.revealWords(), A.mnemonic.split(' '), 'the words in the record that is here now, not the passkey\'s');

  // Altered in another tab while the prompt was open: also not the record the reader was unlocking.
  const altered = lockedTab();
  release = altered.auth.hold();
  unlocking = altered.session.unlock();
  const forged = { ...altered.wallet.record, fingerprint: 'deadbeef' };
  put(altered.storage, forged);
  release();
  assert.deepEqual(await unlocking, { kind: 'gone' });
  assert.deepEqual(JSON.parse(stored(altered.storage) ?? ''), forged);
  assert.equal(altered.view().unlocked, false);
});

test('unlockWithWords: this wallet\'s words load its keys for this page, and nothing is stored', async () => {
  const t = lockedTab();
  const before = stored(t.storage);
  const writes = t.storage.writes;

  assert.equal(t.session.unlockWithWords('nonsense'), 'invalid');
  assert.equal(t.session.unlockWithWords(''), 'invalid');
  assert.equal(t.session.unlockWithWords(t.wallet.words.split(' ').slice(0, 11).join(' ')), 'invalid');
  assert.equal(t.session.unlockWithWords(null as never), 'invalid');
  // Valid words of another wallet.
  assert.equal(t.session.unlockWithWords(A.mnemonic), 'other-wallet');
  assert.equal(t.view().unlocked, false);
  assert.deepEqual(t.events, []);

  // As a reader types them: capitals, stray spaces.
  assert.equal(t.session.unlockWithWords(`  ${t.wallet.words.toUpperCase().replaceAll(' ', '   ')}\n`), 'unlocked');
  assert.equal(t.view().unlocked, true);
  assert.deepEqual(t.session.revealWords(), t.wallet.words.split(' '));
  assert.deepEqual(t.events, ['Unlock: words', 'Words shown: passkey']);
  assert.deepEqual(t.chain.announced, ['unlocked']);
  assert.deepEqual([stored(t.storage), t.storage.writes], [before, writes], 'the record is left alone');
  assert.deepEqual(t.auth.calls, []);

  // No wallet here.
  assert.equal(start().session.unlockWithWords(A.mnemonic), 'gone');
  // The wallet was removed in another tab.
  const gone = lockedTab();
  gone.storage.map.delete(RECORD_KEY);
  assert.equal(gone.session.unlockWithWords(gone.wallet.words), 'gone');
  assert.equal(gone.view().status, 'none');

  // A wallet made without a passkey has nothing to unlock: the words are only checked.
  const storage = new MemoryStorage();
  put(storage, makeRecord('words', A.mnemonic, START_MS));
  const words = start({ storage });
  assert.equal(words.session.unlockWithWords(A.mnemonic), 'unlocked');
  assert.equal(words.session.unlockWithWords(B.mnemonic), 'other-wallet');
  assert.deepEqual(words.events, []);
});

test('unlockWithWords: a record altered in one of its two parts is noticed, rebuilt from the words, and the reader is told', async () => {
  const alterations: [string, (record: WalletRecord) => WalletRecord][] = [
    ['the public key', (record) => ({ ...record, xpub: B.xpub, firstAddress: firstOf(B) })],
    ['the wallet fingerprint', (record) => ({ ...record, fingerprint: 'deadbeef' })],
  ];
  for (const [what, alter] of alterations) {
    // Altered before the page loaded.
    const auth = new VirtualAuthenticator();
    const storage = new MemoryStorage();
    const wallet = passkeyWallet(auth);
    put(storage, alter(wallet.record));
    const t = start({ auth, storage });
    assert.equal(t.view().status, 'ready', what);

    // The reader's own words: never refused as another wallet's, and never taken without a word about the record.
    assert.equal(t.session.unlockWithWords(wallet.words), 'tampered', what);
    // The record is the wallet's own again: the passkey's ID and tag kept, and nothing of the words in it.
    assert.deepEqual(loadRecord(storage as Storage), wallet.record, what);
    assert.ok(!(stored(storage) ?? '').includes(wallet.words.split(' ')[0] ?? 'no words'), what);
    assert.deepEqual(t.view().record, wallet.record, what);
    // And so are the descriptors, which carry both the wallet fingerprint and the public key.
    const own = `wpkh([${wallet.account.masterFingerprint}/84h/1h/0h]${wallet.account.xpub}/`;
    assert.ok(t.session.descriptors()?.receive.startsWith(`${own}0/*)`), what);
    assert.ok(t.session.descriptors()?.change.startsWith(`${own}1/*)`), what);
    assert.equal(t.view().unlocked, true, what);
    assert.deepEqual(t.session.revealWords(), wallet.words.split(' '), what);
    // Whatever was read for the altered record is dropped: the wallet is opened again by its real key.
    assert.equal(t.chain.opened.length, 2, what);
    assert.deepEqual(t.chain.opened.at(-1), { xpub: wallet.account.xpub, seeded: false }, what);
    assert.deepEqual(t.events, ['Unlock: tampered', 'Words shown: passkey'], what);
    assert.deepEqual(t.chain.announced, ['unlocked'], what);
    assert.deepEqual(auth.calls, [], 'no passkey was asked');

    // The next unlock with the words is an ordinary one, and writes nothing.
    t.session.lock();
    const writes = storage.writes;
    assert.equal(t.session.unlockWithWords(wallet.words), 'unlocked', what);
    assert.equal(storage.writes, writes, what);
  }

  // Both parts altered: nothing of the record says it is this wallet's, so the words are another wallet's.
  const both = lockedTab();
  const forged = { ...both.wallet.record, fingerprint: B.masterFingerprint, xpub: B.xpub, firstAddress: firstOf(B) };
  put(both.storage, forged);
  assert.equal(both.session.unlockWithWords(both.wallet.words), 'other-wallet');
  assert.deepEqual(JSON.parse(stored(both.storage) ?? ''), forged);
  assert.equal(both.view().unlocked, false);

  // Words that fit the altered fingerprint alone are judged the same way: one of the two fits, so the
  // record was altered, and it is rebuilt from the words that were typed.
  const half = lockedTab();
  put(half.storage, { ...half.wallet.record, fingerprint: A.masterFingerprint });
  assert.equal(half.session.unlockWithWords(A.mnemonic), 'tampered');
  assert.deepEqual([half.view().record?.xpub, half.view().record?.fingerprint], [A.xpub, A.masterFingerprint]);
  assert.equal(half.view().record?.credentialId, half.wallet.record.credentialId);

  // The record cannot be written again (the browser stopped storing): the keys are not loaded on top of
  // a record that is known to be wrong, and nothing is changed.
  const storage = new FullStorage();
  storage.full = false;
  const stuck = lockedTab({ storage });
  const altered = { ...stuck.wallet.record, xpub: B.xpub, firstAddress: firstOf(B) };
  put(storage, altered);
  storage.full = true;
  assert.equal(stuck.session.unlockWithWords(stuck.wallet.words), 'no-storage');
  assert.deepEqual(JSON.parse(stored(storage) ?? ''), altered);
  assert.equal(stuck.view().unlocked, false);
  assert.equal(stuck.session.revealWords(), null);
  assert.deepEqual(stuck.events, []);
});

// -- lock, reveal, remove ---------------------------------------------------------------

test('lock drops a passkey wallet\'s keys; a wallet made without a passkey stays unlocked', async () => {
  const t = lockedTab();
  await t.session.unlock();
  t.session.lock();
  assert.equal(t.view().unlocked, false);
  assert.equal(t.session.revealWords(), null);
  assert.deepEqual(t.session.sign({ to: SOMEONE, amount: 1_000n, feeRate: 2n }), { ok: false, reason: 'locked' });
  assert.deepEqual(t.chain.announced, ['unlocked', 'locked']);
  // Locked already: nothing to say.
  t.session.lock();
  assert.deepEqual(t.chain.announced, ['unlocked', 'locked']);
  // Looking still needs no key.
  assert.deepEqual(t.view().record, t.wallet.record);
  assert.equal(t.chain.opened.length, 1);

  const storage = new MemoryStorage();
  put(storage, makeRecord('words', A.mnemonic, START_MS));
  const words = start({ storage });
  words.session.lock();
  assert.equal(words.view().unlocked, true);
  assert.deepEqual(words.session.revealWords(), A.mnemonic.split(' '));
  assert.deepEqual(words.chain.announced, []);
});

test('revealWords: a fresh list each call, and counted once per wallet in a page\'s life', async () => {
  const t = lockedTab();
  assert.equal(t.session.revealWords(), null);
  assert.deepEqual(t.events, []);
  await t.session.unlock();

  const first = t.session.revealWords();
  const second = t.session.revealWords();
  assert.ok(first && second);
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
  // Whatever a screen does to its copy, the words kept here are untouched.
  first.length = 0;
  second[0] = 'changed';
  assert.deepEqual(t.session.revealWords(), t.wallet.words.split(' '));
  assert.deepEqual(t.events, ['Unlock: same', 'Words shown: passkey']);

  // Locked and unlocked again: the same wallet, not counted again.
  t.session.lock();
  await t.session.unlock();
  t.session.revealWords();
  assert.deepEqual(t.events, ['Unlock: same', 'Words shown: passkey', 'Unlock: same']);

  // Another wallet in the same page is counted for itself.
  assert.equal(t.session.removeWallet(), 'removed');
  await t.session.createWithWords();
  t.session.revealWords();
  t.session.revealWords();
  assert.deepEqual(t.events.slice(3), ['Wallet removed: passkey', 'Wallet created: words', 'Words shown: words']);
});

test('wordsShown: it goes up by one each time the words are handed out, and at no other time', async () => {
  const t = lockedTab();
  /** Every value the count has shown, from the page's start on. */
  const seen: number[] = [t.view().wordsShown];
  t.session.subscribe(() => {
    if (seen.at(-1) !== t.view().wordsShown) seen.push(t.view().wordsShown);
  });
  assert.equal(t.view().wordsShown, 0);
  // Locked: no words, so nothing was shown.
  assert.equal(t.session.revealWords(), null);
  assert.equal(t.view().wordsShown, 0);

  await t.session.unlock();
  assert.equal(t.view().wordsShown, 0, 'unlocking shows nothing');
  t.session.revealWords();
  assert.equal(t.view().wordsShown, 1);
  t.session.revealWords();
  t.session.revealWords();
  assert.equal(t.view().wordsShown, 3, 'each time, although the event is counted once for a wallet');
  assert.deepEqual(t.events, ['Unlock: same', 'Words shown: passkey']);

  // Nothing else moves it: locking, signing, checking words, descriptors, another tab's change.
  t.session.lock();
  assert.equal(t.session.revealWords(), null);
  await t.session.unlock();
  t.session.sign({ to: SOMEONE, amount: 1_000n, feeRate: 2n });
  t.session.checkWords(t.wallet.words);
  t.session.checkWordsAt([0], [t.wallet.words.split(' ')[0] ?? '']);
  t.session.descriptors();
  t.session.storageChanged('someone-elses-key');
  assert.equal(t.view().wordsShown, 3);

  // It counts for the page, whichever wallet is in it: another wallet's words go on from where it stood.
  assert.equal(t.session.removeWallet(), 'removed');
  assert.equal(t.view().wordsShown, 3, 'a removal does not start it again');
  await t.session.createWithWords();
  t.session.revealWords();
  assert.equal(t.view().wordsShown, 4);
  assert.deepEqual(seen, [0, 1, 2, 3, 4], 'and each step was shown as it happened');
  // A count, and nothing of the words.
  assert.equal(typeof t.view().wordsShown, 'number');

  // A new page starts at 0 again: it is kept in memory only.
  const reloaded = start({ storage: t.storage });
  assert.equal(reloaded.view().wordsShown, 0);
  assert.doesNotMatch(stored(t.storage) ?? '', /wordsShown/);
});

// -- checking a few of the 12 words -------------------------------------------------------

test('checkWordsAt: the positions whose word is wrong, and never a word', async () => {
  const storage = new MemoryStorage();
  put(storage, makeRecord('words', A.mnemonic, START_MS));
  const t = start({ storage });
  // Wallet A's phrase is "abandon" eleven times and then "about": position 11 is the telling one.
  const own = A.mnemonic.split(' ');
  assert.deepEqual([own[0], own[10], own[11]], ['abandon', 'abandon', 'about']);
  const writes = t.storage.writes;

  // All right: nothing is wrong.
  assert.deepEqual(t.session.checkWordsAt([0, 5, 11], ['abandon', 'abandon', 'about']), { ok: true, wrong: [] });
  // Each wrong word is named by the position it was asked for, in the order asked.
  assert.deepEqual(t.session.checkWordsAt([0, 5, 11], ['about', 'abandon', 'abandon']), { ok: true, wrong: [0, 11] });
  assert.deepEqual(t.session.checkWordsAt([11, 0], ['abandon', 'zebra']), { ok: true, wrong: [11, 0] });
  // The right word in the wrong place is wrong.
  assert.deepEqual(t.session.checkWordsAt([10], ['about']), { ok: true, wrong: [10] });
  assert.deepEqual(t.session.checkWordsAt([11], ['about']), { ok: true, wrong: [] });
  // Capitals, and spaces around a word, do not count against it. Two words in one field are not one word.
  assert.deepEqual(t.session.checkWordsAt([0, 11], ['  Abandon ', '\tABOUT\n']), { ok: true, wrong: [] });
  assert.deepEqual(t.session.checkWordsAt([10], ['abandon about']), { ok: true, wrong: [10] });
  assert.deepEqual(t.session.checkWordsAt([0], ['aban don']), { ok: true, wrong: [0] });
  // Nothing typed, or less typed than was asked for, is wrong.
  assert.deepEqual(t.session.checkWordsAt([0, 11], ['', '  ']), { ok: true, wrong: [0, 11] });
  assert.deepEqual(t.session.checkWordsAt([0, 11], ['abandon']), { ok: true, wrong: [11] });
  // A place the phrase does not have is wrong, whatever is typed for it.
  assert.deepEqual(t.session.checkWordsAt([12, -1, 1.5, 0], ['abandon', 'abandon', 'abandon', 'abandon']), { ok: true, wrong: [12, -1, 1.5] });
  // Nothing asked: nothing is wrong, and nothing is proved (the caller says what it asked for).
  assert.deepEqual(t.session.checkWordsAt([], []), { ok: true, wrong: [] });

  // It counts nothing, stores nothing, shows nothing new, and the words were not "shown".
  assert.deepEqual(t.events, []);
  assert.deepEqual(t.unlisted, []);
  assert.equal(t.storage.writes, writes);
  assert.equal(t.view().wordsShown, 0);
  assert.equal(t.view().unlocked, true);
});

test('checkWordsAt: a locked passkey wallet answers "locked", no wallet "gone", and a page the bot check is in "reload"', async () => {
  const t = lockedTab();
  const own = t.wallet.words.split(' ');
  const three = [own[2] ?? '', own[7] ?? '', own[9] ?? ''];
  assert.deepEqual(t.session.checkWordsAt([2, 7, 9], three), { ok: false, reason: 'locked' });
  assert.deepEqual(t.auth.calls, [], 'it never opens a prompt itself');

  await t.session.unlock();
  assert.deepEqual(t.session.checkWordsAt([2, 7, 9], three), { ok: true, wrong: [] });
  assert.deepEqual(t.session.checkWordsAt([2, 7, 9], [three[1] ?? '', three[0] ?? '', 'zebra']), {
    ok: true,
    wrong: [2, 7, 9].filter((position, at) => own[position] !== [three[1], three[0], 'zebra'][at]),
  });
  // Unlocked with the 12 words works as well as with the passkey.
  t.session.lock();
  assert.deepEqual(t.session.checkWordsAt([2], [own[2] ?? '']), { ok: false, reason: 'locked' });
  assert.equal(t.session.unlockWithWords(t.wallet.words), 'unlocked');
  assert.deepEqual(t.session.checkWordsAt([2], [own[2] ?? '']), { ok: true, wrong: [] });
  assert.deepEqual(t.events, ['Unlock: same', 'Unlock: words'], 'the checks themselves were not counted');

  // The bot check has been let into the page: nothing here takes typed words until a reload,
  // whatever kind of wallet is here and whether or not its keys are loaded.
  t.session.beforeBotCheck();
  assert.deepEqual(t.session.checkWordsAt([2], [own[2] ?? '']), { ok: false, reason: 'reload' });
  const storage = new MemoryStorage();
  put(storage, makeRecord('words', A.mnemonic, START_MS));
  const words = start({ storage });
  assert.deepEqual(words.session.checkWordsAt([11], ['about']), { ok: true, wrong: [] });
  words.session.beforeBotCheck();
  assert.deepEqual(words.session.checkWordsAt([11], ['about']), { ok: false, reason: 'reload' });
  assert.deepEqual(words.session.revealWords(), A.mnemonic.split(' '), 'though such a wallet still shows its words');

  // No wallet here.
  const none = start();
  assert.deepEqual(none.session.checkWordsAt([0], ['abandon']), { ok: false, reason: 'gone' });
  // A browser that failed the self-test has no wallet to check against either.
  const broken = start({ storage, selfTest: () => false });
  assert.deepEqual(broken.session.checkWordsAt([11], ['about']), { ok: false, reason: 'gone' });
  // Something stored that cannot be read, or a newer version's record: no wallet is here.
  for (const odd of ['not json', JSON.stringify({ v: 2, anything: true })]) {
    const s = new MemoryStorage();
    put(s, odd);
    assert.deepEqual(start({ storage: s }).session.checkWordsAt([0], ['abandon']), { ok: false, reason: 'gone' }, odd);
  }
});

test('checkWordsAt reads the storage again first: a wallet removed or replaced in another tab is not checked against', async () => {
  const storage = new MemoryStorage();
  put(storage, makeRecord('words', A.mnemonic, START_MS));
  const here = start({ storage });
  const elsewhere = start({ storage });
  assert.deepEqual(here.session.checkWordsAt([11], ['about']), { ok: true, wrong: [] });

  // Removed in the other tab, and this page has not heard yet.
  assert.equal(elsewhere.session.removeWallet(), 'removed');
  assert.deepEqual(here.session.checkWordsAt([11], ['about']), { ok: false, reason: 'gone' });
  assert.equal(here.view().status, 'none', 'and the page now shows what is stored');

  // Another wallet was put in its place: the check is against that one, not the one the page held.
  put(storage, makeRecord('words', B.mnemonic, START_MS));
  const second = B.mnemonic.split(' ');
  assert.deepEqual(here.session.checkWordsAt([11], ['about']), { ok: true, wrong: second[11] === 'about' ? [] : [11] });
  assert.deepEqual(here.session.checkWordsAt([0, 11], [second[0] ?? '', second[11] ?? '']), { ok: true, wrong: [] });
  assert.equal(here.view().record?.fingerprint, B.masterFingerprint);
});

test('checkWordsAt answers for anything it is handed, and never throws', () => {
  const storage = new MemoryStorage();
  put(storage, makeRecord('words', A.mnemonic, START_MS));
  const t = start({ storage });
  const check = t.session.checkWordsAt as (positions: unknown, typed: unknown) => { ok: boolean; wrong?: unknown };
  // Not lists at all: nothing was asked.
  for (const odd of [undefined, null, 'abandon', 7, {}]) {
    assert.deepEqual(check(odd, odd), { ok: true, wrong: [] }, String(odd));
  }
  // A list of things that are not places or not words: each is wrong.
  assert.deepEqual(check([0, 11], undefined), { ok: true, wrong: [0, 11] });
  assert.deepEqual(check([0, 11], [7, null]), { ok: true, wrong: [0, 11] });
  assert.deepEqual(check(['0', null, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 40], ['abandon', 'abandon', 'abandon', 'abandon', 'abandon']).ok, true);
  assert.equal((check(['0', null], ['abandon', 'abandon']).wrong as unknown[]).length, 2);
  // What the object hands out is never a text.
  const answers = [check([0, 11], ['abandon', 'about']), check([0, 11], ['about', 'abandon']), check(['0'], ['abandon'])];
  for (const answer of answers) {
    for (const position of answer.wrong as unknown[]) assert.equal(typeof position, 'number');
    assert.doesNotMatch(JSON.stringify(answer), /abandon|about/);
  }
  // A list that throws when it is read: an answer all the same.
  const hostile = new Proxy([0], {
    get(target, key, receiver) {
      if (key === '0') throw new Error('no');
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  assert.deepEqual(check(hostile, ['abandon']), { ok: false, reason: 'reload' });
});

test('removeWallet deletes this wallet\'s record and nothing else, and only the wallet this page loaded', async () => {
  const t = lockedTab();
  t.storage.map.set('someone-elses-key', 'kept');
  await t.session.unlock();
  assert.equal(t.session.removeWallet(), 'removed');
  assert.deepEqual([...t.storage.map.keys()], ['someone-elses-key']);
  assert.deepEqual(t.view(), {
    status: 'none',
    record: null,
    unlocked: false,
    passkeyOffered: null,
    canStore: true,
    persisted: null,
    setup: null,
    created: null,
    createdName: null,
    pendingSwitch: null,
    pendingRestore: false,
    openedEmpty: false,
    wordsShown: 0,
  });
  assert.equal(t.session.revealWords(), null);
  assert.equal(t.session.descriptors(), null);
  assert.equal(t.chain.closed, 1, 'everything read from the chain is dropped');
  assert.deepEqual(t.events, ['Unlock: same', 'Wallet removed: passkey']);
  assert.equal(t.session.removeWallet(), 'gone');

  // Another tab switched this browser to another wallet: that one is not this page's to remove.
  const u = lockedTab();
  const theirs = makeRecord('words', A.mnemonic, START_MS);
  put(u.storage, theirs);
  assert.equal(u.session.removeWallet(), 'gone');
  assert.deepEqual(JSON.parse(stored(u.storage) ?? ''), theirs);
  assert.deepEqual([u.view().status, u.view().record?.fingerprint], ['ready', A.masterFingerprint]);
  assert.deepEqual(u.events, []);

  // A browser that will not delete: nothing was removed, and the wallet is still shown.
  const stuck = new FullStorage();
  put(stuck, makeRecord('words', A.mnemonic, START_MS));
  const s = start({ storage: stuck });
  assert.equal(s.session.removeWallet(), 'gone');
  assert.deepEqual([s.view().status, stored(stuck) !== null], ['ready', true]);
});

test('descriptors: the wallet\'s public descriptors, with no keys loaded', () => {
  const storage = new MemoryStorage();
  put(storage, makeRecord('passkey', B.mnemonic, START_MS, { credentialId: 'Y3JlZGVudGlhbC1C', tag: 'CDFH' }));
  const t = start({ storage });
  assert.equal(t.view().unlocked, false);
  assert.deepEqual(t.session.descriptors(), { receive: B.receiveDescriptor, change: B.changeDescriptor });
  assert.equal(start().session.descriptors(), null);
});

// -- restore ------------------------------------------------------------------------------

test('checkWords: normalised words, the unknown ones pointed at, and nothing kept', () => {
  const t = start();
  assert.deepEqual(t.session.checkWords(''), { words: [], unknown: [], valid: false });
  assert.deepEqual(t.session.checkWords('   '), { words: [], unknown: [], valid: false });
  assert.deepEqual(t.session.checkWords(` ${A.mnemonic.toUpperCase()} `), { words: A.mnemonic.split(' '), unknown: [], valid: true });
  assert.deepEqual(t.session.checkWords('abandon abandn  ABOUT zzz'), { words: ['abandon', 'abandn', 'about', 'zzz'], unknown: [1, 3], valid: false });
  // Twelve known words with a bad checksum.
  assert.deepEqual(t.session.checkWords(Array(12).fill('abandon').join(' ')), { words: Array(12).fill('abandon'), unknown: [], valid: false });
  assert.deepEqual(t.session.checkWords(null as never), { words: [], unknown: [], valid: false });
  assert.deepEqual([t.view().pendingRestore, t.storage.writes > 0 && stored(t.storage)], [false, null]);
  assert.deepEqual(t.chain.probed, []);
});

test('restore: the scan runs first, and nothing is written while it runs', async () => {
  const t = start();
  t.chain.probeAnswer = { ok: true, state: coinsState([], true) };
  const release = t.chain.holdProbe();
  const restoring = t.session.restore(`  ${A.mnemonic.toUpperCase()}  `);
  await flush();
  // Under way: the account is being scanned by its public key, and this browser holds nothing of it.
  assert.deepEqual(t.chain.probed, [A.xpub]);
  assert.equal(stored(t.storage), null);
  assert.deepEqual([t.view().status, t.view().pendingRestore, t.view().unlocked], ['none', false, false]);
  assert.deepEqual(t.chain.opened, []);

  release();
  assert.deepEqual(await restoring, { kind: 'restored' });
  // History was found: the words are stored (as the screen warned), and the wallet is open.
  assert.deepEqual(loadRecord(t.storage as Storage), makeRecord('words', A.mnemonic, START_MS));
  assert.deepEqual([t.view().status, t.view().unlocked, t.view().created, t.view().pendingRestore], ['ready', true, null, false]);
  assert.equal(t.view().record?.firstAddress, firstOf(A));
  assert.deepEqual(t.session.revealWords(), A.mnemonic.split(' '));
  // The scan that was just made is the wallet's first: it is not made twice.
  assert.deepEqual(t.chain.opened, [{ xpub: A.xpub, seeded: true }]);
  assert.deepEqual(t.events, ['Restore: found', 'Words shown: words']);
  await flush();
  assert.deepEqual([t.view().persisted, t.page.persistAsked], [true, 1]);
});

test('restore: no practice history. The words wait in memory for "keep" or "erase", and nothing is written before', async () => {
  const t = start();
  assert.deepEqual(await t.session.restore(A.mnemonic), { kind: 'empty' });
  assert.deepEqual([t.view().status, t.view().pendingRestore, t.view().unlocked], ['none', true, false]);
  assert.equal(stored(t.storage), null);
  assert.equal(t.session.revealWords(), null, 'the waiting words are not shown either');
  assert.deepEqual([t.chain.opened, t.events], [[], []]);

  // Erase: gone, and nothing was ever stored.
  t.session.eraseRestored();
  assert.equal(t.view().pendingRestore, false);
  assert.equal(t.session.keepRestored(), 'nothing-pending');
  assert.equal(stored(t.storage), null);
  assert.deepEqual(t.events, ['Restore: erased']);
  t.session.eraseRestored();
  assert.deepEqual(t.events, ['Restore: erased'], 'nothing to erase, nothing to count');

  // Keep: stored now, and the wallet is open.
  assert.deepEqual(await t.session.restore(A.mnemonic), { kind: 'empty' });
  assert.equal(t.session.keepRestored(), 'restored');
  assert.deepEqual(loadRecord(t.storage as Storage), makeRecord('words', A.mnemonic, START_MS));
  assert.deepEqual([t.view().status, t.view().pendingRestore, t.view().unlocked], ['ready', false, true]);
  assert.deepEqual(t.chain.opened, [{ xpub: A.xpub, seeded: false }]);
  assert.deepEqual(t.events, ['Restore: erased', 'Restore: kept']);
  assert.equal(t.session.keepRestored(), 'nothing-pending');
});

test('restore: invalid words, the same refusals as create, and a scan that fails', async () => {
  const t = start();
  for (const input of ['', 'abandon', Array(12).fill('abandon').join(' '), `${A.mnemonic} about`, null]) {
    assert.deepEqual(await t.session.restore(input as never), { kind: 'invalid' });
  }
  assert.deepEqual(t.chain.probed, []);

  // A scan that fails: the reason, and the words are dropped.
  t.chain.probeAnswer = { ok: false, reason: 'limit' };
  assert.deepEqual(await t.session.restore(A.mnemonic), { kind: 'failed', reason: 'limit' });
  assert.deepEqual([t.view().pendingRestore, stored(t.storage)], [false, null]);
  assert.equal(t.session.keepRestored(), 'nothing-pending');

  // A wallet is here already.
  const here = lockedTab();
  assert.deepEqual(await here.session.restore(A.mnemonic), { kind: 'exists' });
  assert.deepEqual(here.chain.probed, []);
  // The browser stores nothing.
  const full = start({ storage: new FullStorage() });
  assert.deepEqual(await full.session.restore(A.mnemonic), { kind: 'no-storage' });
  assert.deepEqual(full.chain.probed, [], 'refused before the scan');
  // Invalid words are said to be invalid before any of that.
  assert.deepEqual(await here.session.restore('nonsense'), { kind: 'invalid' });
  assert.deepEqual(await full.session.restore('nonsense'), { kind: 'invalid' });
});

test('restore: a wallet that arrives while the scan runs, and a save that fails', async () => {
  for (const found of [coinsState([], true), coinsState()]) {
    const t = start();
    t.chain.probeAnswer = { ok: true, state: found };
    const release = t.chain.holdProbe();
    const restoring = t.session.restore(A.mnemonic);
    await flush();
    const theirs = makeRecord('words', B.mnemonic, START_MS);
    put(t.storage, theirs);
    release();
    assert.deepEqual(await restoring, { kind: 'exists' });
    assert.deepEqual(JSON.parse(stored(t.storage) ?? ''), theirs);
    assert.deepEqual([t.view().pendingRestore, t.view().record?.fingerprint], [false, B.masterFingerprint]);
  }

  // The browser stops storing between the scan and the save.
  const storage = new FullStorage();
  storage.full = false;
  const t = start({ storage });
  t.chain.probeAnswer = { ok: true, state: coinsState([], true) };
  const release = t.chain.holdProbe();
  const restoring = t.session.restore(A.mnemonic);
  await flush();
  storage.full = true;
  release();
  assert.deepEqual(await restoring, { kind: 'no-storage' });
  assert.deepEqual([stored(storage), t.view().status, t.view().unlocked], [null, 'none', false]);

  // "Keep them anyway" when the browser will not: the words go on waiting, and can be kept once it will.
  storage.full = false;
  t.chain.probeAnswer = { ok: true, state: coinsState() };
  assert.deepEqual(await t.session.restore(A.mnemonic), { kind: 'empty' });
  storage.full = true;
  assert.equal(t.session.keepRestored(), 'no-storage');
  assert.equal(t.view().pendingRestore, true);
  storage.full = false;
  assert.equal(t.session.keepRestored(), 'restored');
  assert.equal(t.view().status, 'ready');

  // Kept when another tab has stored a wallet meanwhile: theirs stays.
  const u = start();
  assert.deepEqual(await u.session.restore(A.mnemonic), { kind: 'empty' });
  put(u.storage, makeRecord('words', B.mnemonic, START_MS));
  assert.equal(u.session.keepRestored(), 'exists');
  assert.deepEqual([u.view().pendingRestore, u.view().record?.fingerprint], [false, B.masterFingerprint]);
});

test('restore: one at a time. A second restore waits for the first and then answers for itself', async () => {
  const t = start();
  t.chain.probeAnswer = { ok: true, state: coinsState([], true) };
  const release = t.chain.holdProbe();
  const first = t.session.restore(A.mnemonic);
  const second = t.session.restore(B.mnemonic);
  await flush();
  assert.deepEqual(t.chain.probed, [A.xpub], 'the second has not begun');
  release();
  assert.deepEqual(await first, { kind: 'restored' });
  assert.deepEqual(await second, { kind: 'exists' }, 'by then a wallet is here');
  assert.deepEqual(t.chain.probed, [A.xpub]);

  // A new restore lets go of words that were still waiting from the one before.
  const u = start();
  assert.deepEqual(await u.session.restore(A.mnemonic), { kind: 'empty' });
  u.chain.probeAnswer = { ok: false, reason: 'network' };
  assert.deepEqual(await u.session.restore(B.mnemonic), { kind: 'failed', reason: 'network' });
  assert.equal(u.view().pendingRestore, false);
  assert.equal(u.session.keepRestored(), 'nothing-pending');
});

// -- other tabs ---------------------------------------------------------------------------

test('other tabs: a record made elsewhere stops Create here, before any passkey is made', async () => {
  const storage = new MemoryStorage();
  const here = start({ storage });
  const elsewhere = start({ storage });
  assert.deepEqual(await elsewhere.session.createWithWords(), { kind: 'created' });

  // No storage event has reached this tab yet. Create reads the storage itself.
  assert.equal(here.view().status, 'none');
  assert.deepEqual(await here.session.createWithPasskey(), { kind: 'exists' });
  assert.deepEqual(here.auth.calls, []);
  assert.deepEqual([here.view().status, here.view().record?.fingerprint], ['ready', A.masterFingerprint], 'and now shows the wallet');
  assert.deepEqual(await here.session.createWithWords(), { kind: 'exists' });
  assert.deepEqual(await here.session.restore(B.mnemonic), { kind: 'exists' });
  assert.deepEqual(await here.session.openWithPasskey(), { kind: 'exists' });

  // With the event: the same, at once.
  const third = start({ storage: new MemoryStorage() });
  put(third.storage, makeRecord('words', A.mnemonic, START_MS));
  third.session.storageChanged(RECORD_KEY);
  assert.deepEqual([third.view().status, third.view().unlocked], ['ready', true]);
  assert.deepEqual(third.chain.opened, [{ xpub: A.xpub, seeded: false }]);
});

test('other tabs: a wallet removed elsewhere locks and empties this page', async () => {
  const storage = new MemoryStorage();
  const auth = new VirtualAuthenticator();
  const wallet = passkeyWallet(auth);
  put(storage, wallet.record);
  const here = start({ storage, auth });
  const elsewhere = start({ storage, auth });
  assert.deepEqual(await here.session.unlock(), { kind: 'unlocked' });
  // A switch is waiting too.
  passkeyWallet(auth, 2);
  auth.pick = 1;
  assert.equal((await here.session.unlock('picker')).kind, 'other-passkey');
  assert.equal(here.view().unlocked, true);

  assert.equal(elsewhere.session.removeWallet(), 'removed');
  here.session.storageChanged(RECORD_KEY);
  assert.deepEqual(here.view(), {
    status: 'none',
    record: null,
    unlocked: false,
    passkeyOffered: null,
    canStore: true,
    persisted: null,
    setup: null,
    created: null,
    createdName: null,
    pendingSwitch: null,
    pendingRestore: false,
    openedEmpty: false,
    wordsShown: 0,
  });
  assert.equal(here.session.revealWords(), null);
  assert.equal(here.session.confirmSwitch(), 'nothing-pending');
  assert.equal(here.chain.closed, 1);
  assert.deepEqual(here.session.sign({ to: SOMEONE, amount: 1_000n, feeRate: 2n }), { ok: false, reason: 'locked' });
});

test('other tabs: a storage that was cleared counts; another key\'s change does not; a changed record starts this page again', async () => {
  const t = lockedTab();
  await t.session.unlock();

  // Some other key: nothing happens.
  t.session.storageChanged('lbp_storage_test');
  t.session.storageChanged('someone-elses-key');
  assert.deepEqual([t.view().unlocked, t.chain.opened.length, t.chain.closed], [true, 1, 0]);

  // The record changed (here: to the same wallet, stored again): keys are dropped and everything is read again.
  t.session.storageChanged(RECORD_KEY);
  assert.deepEqual([t.view().status, t.view().unlocked, t.chain.opened.length], ['ready', false, 2]);
  assert.equal(t.session.revealWords(), null);

  // Waiting restore words are dropped by a change, too.
  const r = start();
  assert.deepEqual(await r.session.restore(A.mnemonic), { kind: 'empty' });
  r.session.storageChanged(RECORD_KEY);
  assert.equal(r.view().pendingRestore, false);
  assert.equal(r.session.keepRestored(), 'nothing-pending');

  // clear(): the event's key is null.
  await t.session.unlock();
  t.storage.map.clear();
  t.session.storageChanged(null);
  assert.deepEqual([t.view().status, t.view().unlocked, t.chain.closed], ['none', false, 1]);
});

test('back in view: a page that heard no storage event reads the record again, and starts again only if it has changed', async () => {
  // A page the browser kept in its memory while the reader was on another site gets no "storage"
  // event. Brought back, it is told that it is in view again, and looks for itself.
  const t = lockedTab();
  await t.session.unlock();

  // What is stored is what this page loaded: nothing happens. The keys stay loaded and nothing is read again.
  t.session.backInView();
  assert.deepEqual([t.view().status, t.view().unlocked, t.chain.opened.length, t.chain.closed], ['ready', true, 1, 0]);
  assert.notEqual(t.session.revealWords(), null);

  // The wallet was removed meanwhile, and no event said so: the page starts again from what is stored.
  t.storage.map.delete(RECORD_KEY);
  assert.equal(t.view().status, 'ready', 'until it is told, the page remembers the wallet');
  t.session.backInView();
  assert.deepEqual([t.view().status, t.view().record, t.view().unlocked, t.chain.closed], ['none', null, false, 1]);
  assert.equal(t.session.revealWords(), null);

  // Another wallet in its place: taken up, and said as after a "storage" event.
  const u = lockedTab();
  put(u.storage, makeRecord('words', A.mnemonic, START_MS));
  u.session.backInView();
  assert.equal(u.view().record?.xpub, A.xpub);
  assert.deepEqual(u.chain.announced, ['replaced']);
  // Told again with nothing changed: nothing more is said or read.
  const opened = u.chain.opened.length;
  u.session.backInView();
  assert.deepEqual([u.chain.announced, u.chain.opened.length], [['replaced'], opened]);

  // A wallet that arrived where this page had none.
  const none = start();
  put(none.storage, makeRecord('words', A.mnemonic, START_MS));
  none.session.backInView();
  assert.deepEqual([none.view().status, none.view().record?.xpub], ['ready', A.xpub]);
});

test('other tabs: one wallet put in another\'s place is announced as "replaced", and nothing else is', async () => {
  const theirs = makeRecord('words', A.mnemonic, START_MS);

  // Another wallet where this page's wallet was: the screens are told, once.
  const t = lockedTab();
  put(t.storage, theirs);
  t.session.storageChanged(RECORD_KEY);
  assert.equal(t.view().record?.xpub, A.xpub);
  assert.deepEqual(t.chain.announced, ['replaced']);
  // The same event again, and a change that leaves the wallet what it is (the same record written again): nothing new to say.
  t.session.storageChanged(RECORD_KEY);
  put(t.storage, { ...theirs, createdAt: START_MS + 1000 });
  t.session.storageChanged(RECORD_KEY);
  assert.deepEqual(t.chain.announced, ['replaced']);

  // Found by an action of this page before the storage event came: said then, and not a second time when the event arrives.
  const u = lockedTab();
  put(u.storage, theirs);
  assert.deepEqual(await u.session.unlock(), { kind: 'unlocked' }, 'the wallet that is here now keeps its words in the record');
  assert.deepEqual(u.chain.announced, ['replaced']);
  u.session.storageChanged(RECORD_KEY);
  assert.deepEqual(u.chain.announced, ['replaced']);

  // A wallet removed elsewhere, one that arrives where there was none, and what cannot be read: not "replaced".
  const removed = lockedTab();
  removed.storage.map.delete(RECORD_KEY);
  removed.session.storageChanged(RECORD_KEY);
  put(removed.storage, theirs);
  removed.session.storageChanged(RECORD_KEY);
  put(removed.storage, 'not a record');
  removed.session.storageChanged(RECORD_KEY);
  assert.deepEqual(removed.chain.announced, []);

  // What this page does to its own wallet is never "replaced": a switch, a record rebuilt, a remove and a restore.
  const own = lockedTab();
  passkeyWallet(own.auth, 2);
  own.auth.pick = 1;
  assert.equal((await own.session.unlock('picker')).kind, 'other-passkey');
  assert.equal(own.session.confirmSwitch(), 'switched');
  assert.equal(own.session.removeWallet(), 'removed');
  assert.deepEqual(await own.session.restore(A.mnemonic), { kind: 'empty' });
  assert.equal(own.session.keepRestored(), 'restored');
  assert.ok(!own.chain.announced.includes('replaced'), own.chain.announced.join(' '));
  const rebuilt = lockedTab();
  put(rebuilt.storage, { ...rebuilt.wallet.record, xpub: B.xpub, firstAddress: firstOf(B) });
  rebuilt.session.storageChanged(RECORD_KEY);
  assert.deepEqual(rebuilt.chain.announced, ['replaced'], 'the altered record is another wallet to this page, until an unlock says otherwise');
  assert.deepEqual(await rebuilt.session.unlock(), { kind: 'tampered' });
  assert.deepEqual(rebuilt.chain.announced, ['replaced', 'unlocked']);
});

test('other tabs: a write that lands between this page\'s own look at the storage and its write is never written over', async () => {
  const theirs = makeRecord('words', A.mnemonic, START_MS);

  // A switch: this page has just seen its own wallet in storage when the other tab replaces it.
  const storage = new RacingStorage();
  const t = lockedTab({ storage });
  passkeyWallet(t.auth, 2);
  t.auth.pick = 1;
  assert.equal((await t.session.unlock('picker')).kind, 'other-passkey');
  storage.swapAfter(1, theirs);
  assert.equal(t.session.confirmSwitch(), 'gone');
  assert.deepEqual(JSON.parse(stored(storage) ?? ''), theirs);
  assert.deepEqual([t.view().record?.fingerprint, t.view().pendingSwitch], [A.masterFingerprint, null]);

  // A rebuild after tampering: the altered record is replaced by the other tab just before the rewrite.
  const rebuilding = new RacingStorage();
  const u = lockedTab({ storage: rebuilding });
  put(rebuilding, { ...u.wallet.record, fingerprint: 'deadbeef' });
  u.session.storageChanged(RECORD_KEY);
  const release = u.auth.hold();
  const unlocking = u.session.unlock();
  // After the prompt the session reads the record once to see that it is still the one it knew.
  rebuilding.swapAfter(1, theirs);
  release();
  assert.deepEqual(await unlocking, { kind: 'gone' });
  assert.deepEqual(JSON.parse(stored(rebuilding) ?? ''), theirs);
  assert.equal(u.view().record?.fingerprint, A.masterFingerprint);

  // A create: a wallet appears after the last look and before the save.
  const creating = new RacingStorage();
  const c = start({ storage: creating });
  // Create looks once before the prompt; the save looks again.
  creating.swapAfter(1, theirs);
  assert.deepEqual(await c.session.createWithWords(), { kind: 'exists' });
  assert.deepEqual(JSON.parse(stored(creating) ?? ''), theirs);
  assert.equal(c.view().record?.fingerprint, A.masterFingerprint);
  assert.deepEqual(c.events, []);
});

// -- the bot check ------------------------------------------------------------------------

test('beforeBotCheck drops a passkey wallet\'s keys and every waiting word, and from then on nothing loads keys or takes words', async () => {
  const t = lockedTab();
  await t.session.unlock();
  passkeyWallet(t.auth, 2);
  t.auth.pick = 1;
  assert.equal((await t.session.unlock('picker')).kind, 'other-passkey');
  const prompts = t.auth.calls.length;
  const before = stored(t.storage);

  t.session.beforeBotCheck();
  assert.deepEqual([t.view().unlocked, t.view().pendingSwitch], [false, null]);
  assert.deepEqual(t.chain.announced, ['unlocked', 'locked']);
  assert.equal(t.session.revealWords(), null);
  assert.deepEqual(t.session.sign({ to: SOMEONE, amount: 1_000n, feeRate: 2n }), { ok: false, reason: 'locked' });

  // Every way to keys or words answers "reload", or where its answers have no such word, "nothing-pending".
  assert.deepEqual(await t.session.unlock(), { kind: 'reload' });
  assert.deepEqual(await t.session.unlock('picker'), { kind: 'reload' });
  assert.equal(t.session.unlockWithWords(t.wallet.words), 'reload');
  assert.equal(t.session.unlockWithWords('nonsense'), 'reload');
  assert.deepEqual(await t.session.createWithPasskey(), { kind: 'reload' });
  assert.deepEqual(await t.session.createWithWords(), { kind: 'reload' });
  assert.deepEqual(await t.session.finishSetup(), { kind: 'reload' });
  assert.deepEqual(await t.session.openWithPasskey(), { kind: 'reload' });
  assert.deepEqual(await t.session.restore(A.mnemonic), { kind: 'reload' });
  assert.deepEqual(await t.session.restore('nonsense'), { kind: 'invalid' });
  assert.equal(t.session.confirmSwitch(), 'nothing-pending');
  assert.equal(t.session.keepRestored(), 'nothing-pending');
  assert.equal(t.auth.calls.length, prompts, 'and no prompt was opened');
  assert.deepEqual(t.chain.probed, []);
  assert.equal(stored(t.storage), before);

  // Looking goes on working.
  assert.deepEqual(t.view().record, t.wallet.record);
  assert.notEqual(t.session.descriptors(), null);
  assert.equal(t.view().status, 'ready');
  // It lasts as long as the page: a second call changes nothing, and nothing takes it back.
  t.session.beforeBotCheck();
  t.session.storageChanged(RECORD_KEY);
  assert.deepEqual(await t.session.unlock(), { kind: 'reload' });
  assert.deepEqual(t.chain.announced, ['unlocked', 'locked']);
});

test('beforeBotCheck: typed words that were waiting are dropped, with or without a wallet', async () => {
  const t = start();
  assert.deepEqual(await t.session.restore(A.mnemonic), { kind: 'empty' });
  t.session.beforeBotCheck();
  assert.equal(t.view().pendingRestore, false);
  assert.equal(t.session.keepRestored(), 'nothing-pending');
  assert.equal(stored(t.storage), null);
  assert.deepEqual(t.chain.announced, [], 'nothing was locked');
});

test('beforeBotCheck: a wallet made without a passkey can still show its words and sign', async () => {
  const storage = new MemoryStorage();
  put(storage, makeRecord('words', A.mnemonic, START_MS));
  const t = start({ storage });
  t.session.beforeBotCheck();
  // Its words are in storage, where the script could read them anyway.
  assert.equal(t.view().unlocked, true);
  assert.deepEqual(t.session.revealWords(), A.mnemonic.split(' '));
  assert.deepEqual(await t.session.unlock(), { kind: 'unlocked' });
  assert.deepEqual(t.chain.announced, []);
  // Signing is not refused as "locked": with no coins read in this stand-in, the plan's own answer comes back.
  assert.deepEqual(t.session.sign({ to: SOMEONE, amount: 1_000n, feeRate: 2n }), { ok: false, reason: 'nothing-spendable' });
  // Typed words are still not taken.
  assert.equal(t.session.unlockWithWords(A.mnemonic), 'reload');
});

test('the bot check arrives while a prompt is open: the prompt is ended, and what it gives afterwards is never read', async () => {
  // The stand-in manager does not listen when it is told to close a prompt: the worst provider there is.
  // So the prompt really is still open when the script comes, and is answered with the script in the page.
  const answered = async (release: () => void): Promise<void> => {
    release();
    await flush();
    await flush();
  };

  // An unlock.
  const t = lockedTab();
  let release = t.auth.hold();
  const unlocking = t.session.unlock();
  await flush();
  let reads = t.auth.secretReads;
  t.session.beforeBotCheck();
  // The prompt is told to close, and the call answers without waiting for the reader ...
  assert.equal(t.auth.signals.at(-1)?.aborted, true);
  assert.deepEqual(await unlocking, { kind: 'reload' });
  // ... so when the reader answers it after all, with the script in the page, the secret is never read.
  await answered(release);
  assert.equal(t.auth.secretReads, reads, 'the passkey answered after the bot check came, and the page read its secret');
  assert.equal(t.view().unlocked, false);
  assert.equal(t.session.revealWords(), null);
  assert.deepEqual(t.events, [], 'nothing is counted for a prompt the page ended');

  // A create: nothing is stored here, and nothing tells the provider to forget a passkey.
  // (If the provider made one all the same, "Open with my passkey" finds it after the reload.)
  const c = start();
  release = c.auth.hold();
  const creating = c.session.createWithPasskey();
  await flush();
  reads = c.auth.secretReads;
  c.session.beforeBotCheck();
  assert.equal(c.auth.signals.at(-1)?.aborted, true);
  assert.deepEqual(await creating, { kind: 'reload' });
  await answered(release);
  assert.equal(c.auth.secretReads, reads);
  assert.deepEqual([stored(c.storage), c.view().status, c.view().unlocked, c.auth.forgotten], [null, 'none', false, []]);
  assert.deepEqual(c.auth.calls, ['create'], 'no follow-up prompt was opened');

  // An open.
  const o = start();
  passkeyWallet(o.auth);
  release = o.auth.hold();
  const opening = o.session.openWithPasskey();
  await flush();
  reads = o.auth.secretReads;
  o.session.beforeBotCheck();
  assert.equal(o.auth.signals.at(-1)?.aborted, true);
  assert.deepEqual(await opening, { kind: 'reload' });
  await answered(release);
  assert.equal(o.auth.secretReads, reads);
  assert.deepEqual([stored(o.storage), o.view().status], [null, 'none']);

  // A port that cannot end a prompt (it throws) stops nothing: the keys are dropped all the same.
  const boom = start({ passkeys: { ...answering(null), end: () => { throw new Error('no'); } } });
  boom.session.beforeBotCheck();
  assert.deepEqual(await boom.session.openWithPasskey(), { kind: 'reload' });

  // A restore whose scan was running: the words are dropped and nothing is stored.
  const r = start();
  r.chain.probeAnswer = { ok: true, state: coinsState([], true) };
  const releaseProbe = r.chain.holdProbe();
  const restoring = r.session.restore(A.mnemonic);
  await flush();
  r.session.beforeBotCheck();
  releaseProbe();
  assert.deepEqual(await restoring, { kind: 'reload' });
  assert.deepEqual([stored(r.storage), r.view().pendingRestore, r.view().status], [null, false, 'none']);
});

// -- faults in what the session is handed ---------------------------------------------------

/** Every action of the session that WalletApi lists, with the answers each may give. */
async function everyAction(session: Session): Promise<void> {
  const request: PaymentRequest = { to: SOMEONE, amount: 1_000n, feeRate: 2n };
  const ceremony = ['cancelled', 'no-prf', 'error', 'busy', 'reload', 'broken'];
  const check = (name: string, answer: string, allowed: string[]): void => {
    assert.ok(allowed.includes(answer), `${name} answered "${answer}"`);
  };
  check('createWithPasskey', (await session.createWithPasskey()).kind, ['created', 'unfinished', 'exists', 'no-storage', ...ceremony]);
  check('finishSetup', (await session.finishSetup()).kind, ['created', 'unfinished', 'exists', 'no-storage', ...ceremony]);
  check('createWithWords', (await session.createWithWords()).kind, ['created', 'unfinished', 'exists', 'no-storage', ...ceremony]);
  check('openWithPasskey', (await session.openWithPasskey()).kind, ['opened', 'exists', 'no-storage', ...ceremony]);
  for (const how of ['stored', 'picker', undefined] as const) {
    check('unlock', (await session.unlock(how)).kind, ['unlocked', 'tampered', 'other-passkey', 'changed', 'gone', ...ceremony]);
  }
  check('unlockWithWords', session.unlockWithWords(A.mnemonic), ['unlocked', 'tampered', 'invalid', 'other-wallet', 'no-storage', 'gone', 'reload', 'broken']);
  check('confirmSwitch', session.confirmSwitch(), ['switched', 'gone', 'no-storage', 'nothing-pending']);
  session.cancelSwitch();
  assert.equal(typeof session.checkWords(A.mnemonic).valid, 'boolean');
  check('restore', (await session.restore(A.mnemonic)).kind, ['restored', 'empty', 'invalid', 'exists', 'no-storage', 'failed', 'reload', 'broken']);
  check('keepRestored', session.keepRestored(), ['restored', 'exists', 'no-storage', 'nothing-pending']);
  session.eraseRestored();
  session.ackCreated();
  session.lock();
  const words = session.revealWords();
  assert.ok(words === null || Array.isArray(words));
  const checked = session.checkWordsAt([0, 5, 11], ['abandon', 'abandon', 'about']);
  assert.ok(checked.ok ? Array.isArray(checked.wrong) : ['locked', 'reload', 'gone'].includes(checked.reason));
  const descriptors = session.descriptors();
  assert.ok(descriptors === null || typeof descriptors.receive === 'string');
  const signedPayment = session.sign(request);
  assert.equal(typeof signedPayment.ok, 'boolean');
  session.storageChanged(RECORD_KEY);
  session.storageChanged(null);
  await session.learnPasskeys('localhost');
  check('removeWallet', session.removeWallet(), ['removed', 'gone']);
  session.beforeBotCheck();
  check('unlock after the bot check', (await session.unlock()).kind, ['unlocked', 'gone', 'reload', 'broken']);
  await flush();
}

test('a storage that throws on every call: every action answers, and none throws', async () => {
  const t = start({ storage: new BlockedStorage() });
  assert.deepEqual([t.view().status, t.view().canStore], ['blocked', false]);
  assert.deepEqual(await t.session.createWithPasskey(), { kind: 'no-storage' });
  assert.deepEqual(await t.session.createWithWords(), { kind: 'no-storage' });
  assert.deepEqual(await t.session.openWithPasskey(), { kind: 'no-storage' });
  assert.deepEqual(await t.session.restore(A.mnemonic), { kind: 'no-storage' });
  assert.deepEqual(await t.session.unlock(), { kind: 'gone' });
  assert.equal(t.session.removeWallet(), 'gone');
  assert.deepEqual(t.auth.calls, [], 'no passkey is made in a browser that would forget its wallet');
  await everyAction(t.session);

  // A storage that takes writes and forgets them.
  class Forgetful extends MemoryStorage {
    override setItem(): void {
      this.writes += 1;
    }
  }
  const f = start({ storage: new Forgetful() });
  assert.equal(f.view().canStore, false);
  assert.deepEqual(await f.session.createWithWords(), { kind: 'no-storage' });
  await everyAction(f.session);

  // A storage that works until the wallet is in it, and throws from then on.
  const turning = new FullStorage();
  turning.full = false;
  const u = start({ storage: turning });
  assert.deepEqual(await u.session.createWithWords(), { kind: 'created' });
  turning.full = true;
  await everyAction(u.session);
});

test('a browser that will not let the page read its storage: the status is "blocked", never "none", and what was stored stays', async () => {
  // The state a reader gets to with one browser setting: a wallet is made, and then the browser is told to
  // block this site's data. It then refuses the page every look at its storage, and deletes nothing.
  const kinds: [string, (storage: SwitchedStorage, auth: VirtualAuthenticator) => WalletRecord][] = [
    ['kept with its 12 words', () => makeRecord('words', A.mnemonic, START_MS)],
    ['opened with a passkey', (_storage, auth) => passkeyWallet(auth).record],
  ];
  for (const [name, make] of kinds) {
    const storage = new SwitchedStorage();
    const auth = new VirtualAuthenticator();
    const record = make(storage, auth);
    put(storage, record);
    storage.map.set('lbp_progress_v1', '{"v":1,"following":null,"steps":{}}');
    const before = [...storage.map.entries()];
    storage.blocked = true;

    // A page loaded in that browser: it has seen nothing, and says so. Not "none": a wallet is on the disk.
    const t = start({ storage, auth });
    assert.deepEqual(
      [t.view().status, t.view().record, t.view().unlocked, t.view().canStore, t.view().pendingRestore],
      ['blocked', null, false, false, false],
      name,
    );
    assert.deepEqual(t.chain.opened, [], 'no wallet is watched');
    // Nothing can be made, opened, restored or removed here, and no passkey prompt is opened to find that out.
    assert.deepEqual(await t.session.createWithPasskey(), { kind: 'no-storage' }, name);
    assert.deepEqual(await t.session.createWithWords(), { kind: 'no-storage' }, name);
    assert.deepEqual(await t.session.finishSetup(), { kind: 'no-storage' }, name);
    assert.deepEqual(await t.session.openWithPasskey(), { kind: 'no-storage' }, name);
    assert.deepEqual(await t.session.restore(B.mnemonic), { kind: 'no-storage' }, name);
    assert.deepEqual(t.chain.probed, [], 'refused before the practice network is asked about the words');
    assert.deepEqual(await t.session.unlock(), { kind: 'gone' }, name);
    assert.equal(t.session.unlockWithWords(A.mnemonic), 'gone', name);
    assert.equal(t.session.removeWallet(), 'gone', name);
    assert.equal(t.session.revealWords(), null, name);
    assert.equal(t.session.descriptors(), null, name);
    assert.deepEqual(t.session.checkWordsAt([0, 1, 2], ['abandon', 'abandon', 'abandon']), { ok: false, reason: 'gone' }, name);
    assert.deepEqual(t.auth.calls, [], name);
    assert.deepEqual(t.auth.forgotten, [], name);
    assert.deepEqual(t.events, [], 'nothing is counted: no wallet was made, opened or removed');
    assert.equal(t.view().status, 'blocked', name);
    // "storage" events, the tab coming back into view, and the bot check change nothing while it stays so.
    t.session.storageChanged(RECORD_KEY);
    t.session.storageChanged(null);
    t.session.backInView();
    assert.deepEqual([t.view().status, t.view().record], ['blocked', null], name);
    // What the browser holds is exactly what it held: nothing was written, nothing removed.
    assert.deepEqual([...storage.map.entries()], before, name);
    assert.equal(storage.writes, 0, name);

    // The block is lifted, and the page is told it is in view again: the wallet is there, as it was.
    storage.blocked = false;
    t.session.backInView();
    assert.deepEqual([t.view().status, t.view().record?.fingerprint, t.view().record?.kind], ['ready', record.fingerprint, record.kind], name);
    // Whether the browser stores anything was asked again as well: "it stores nothing" is not left standing.
    assert.equal(t.view().canStore, true, name);
    assert.equal(storage.map.size, before.length, 'the test write left nothing behind');
    assert.equal(t.view().unlocked, record.kind === 'words', name);
    assert.equal(t.chain.opened.length, 1, name);
    assert.deepEqual(t.chain.announced, [], 'the same wallet as before the block: nothing was replaced');
    assert.deepEqual([...storage.map.entries()], before, name);
    // And the wallet can be removed again, as any wallet that is here.
    assert.equal(t.session.removeWallet(), 'removed', name);
    assert.deepEqual([t.view().status, stored(storage)], ['none', null], name);
  }

  // The other way round: the page holds a wallet, with its keys loaded, and the browser then stops letting it
  // look. Until the page is told, it remembers the wallet. Told, it drops what it knows, keys included, and
  // says "blocked": it has not seen the wallet removed, and "none" would say that it had.
  const u = lockedTab({ storage: new SwitchedStorage() });
  const storage = u.storage as SwitchedStorage;
  assert.deepEqual(await u.session.unlock(), { kind: 'unlocked' });
  storage.blocked = true;
  assert.deepEqual([u.view().status, u.view().unlocked], ['ready', true]);
  u.session.backInView();
  assert.deepEqual([u.view().status, u.view().record, u.view().unlocked, u.chain.closed], ['blocked', null, false, 1]);
  assert.equal(u.session.revealWords(), null);
  assert.equal(u.session.sign({ to: SOMEONE, amount: 1_000n, feeRate: 2n }).ok, false);
  assert.equal(stored(storage), JSON.stringify(u.wallet.record), 'the wallet is still stored');
  assert.deepEqual(u.events, ['Unlock: same'], 'and "Wallet removed" is never counted for it');
  storage.blocked = false;
  u.session.backInView();
  assert.deepEqual([u.view().status, u.view().record?.fingerprint, u.view().unlocked], ['ready', u.wallet.record.fingerprint, false]);
  assert.deepEqual(u.chain.announced, ['unlocked'], 'back as it was: no wallet took another\'s place');

  // The same found out by an action, with no word from the browser first: Remove removes nothing and the
  // page says "blocked"; an unlock opens no prompt.
  const v = lockedTab({ storage: new SwitchedStorage() });
  (v.storage as SwitchedStorage).blocked = true;
  assert.equal(v.session.removeWallet(), 'gone');
  assert.deepEqual([v.view().status, stored(v.storage)], ['blocked', JSON.stringify(v.wallet.record)]);
  assert.deepEqual(v.events, []);
  const w = lockedTab({ storage: new SwitchedStorage() });
  (w.storage as SwitchedStorage).blocked = true;
  assert.deepEqual(await w.session.unlock(), { kind: 'gone' });
  assert.deepEqual([w.view().status, w.auth.calls], ['blocked', []]);

  // A passkey that waits to be finished, and a browser that stops letting the page look meanwhile. Nobody can
  // tell whether a wallet is stored, or whose: nothing is hinted to the password manager, no prompt is
  // opened, and the setup goes on waiting for a storage that can be read.
  const x = start({ storage: new SwitchedStorage() });
  x.auth.secretAtCreate = false;
  x.auth.refuseGet.push('NotAllowedError');
  assert.deepEqual(await x.session.createWithPasskey(), { kind: 'unfinished' });
  const waiting = x.view().setup;
  const prompts = x.auth.calls.length;
  (x.storage as SwitchedStorage).blocked = true;
  assert.deepEqual(await x.session.finishSetup(), { kind: 'no-storage' });
  assert.deepEqual([x.view().status, x.view().setup, x.auth.forgotten, x.auth.calls.length], ['blocked', waiting, [], prompts]);
  (x.storage as SwitchedStorage).blocked = false;
  assert.deepEqual(await x.session.finishSetup(), { kind: 'created' });
  assert.deepEqual([x.view().status, x.view().setup, x.auth.forgotten], ['ready', null, []]);

  // The browser stops letting the page look while a prompt is open. What the prompt gives is not stored into
  // a storage nobody can look into: "no-storage", whichever way the prompt ended, and no hint.
  for (const secretAtCreate of [true, false]) {
    const y = start({ storage: new SwitchedStorage() });
    y.auth.secretAtCreate = secretAtCreate;
    if (!secretAtCreate) y.auth.refuseGet.push('NotAllowedError');
    const release = y.auth.hold();
    const creating = y.session.createWithPasskey();
    await flush();
    (y.storage as SwitchedStorage).blocked = true;
    release();
    assert.deepEqual(await creating, { kind: 'no-storage' }, `secret at create: ${secretAtCreate}`);
    assert.deepEqual([y.view().status, y.view().setup, y.view().unlocked, y.auth.forgotten, stored(y.storage)], ['blocked', null, false, [], null]);
  }
  // And while the practice network is asked about restored words: they are neither stored nor left waiting.
  const z = start({ storage: new SwitchedStorage() });
  const open = z.chain.holdProbe();
  const restoring = z.session.restore(A.mnemonic);
  await flush();
  (z.storage as SwitchedStorage).blocked = true;
  open();
  assert.deepEqual(await restoring, { kind: 'no-storage' });
  assert.deepEqual([z.view().status, z.view().pendingRestore, stored(z.storage)], ['blocked', false, null]);
  assert.equal(z.session.keepRestored(), 'nothing-pending');
});

test('passkey calls that throw, reject or answer nonsense: an "error" answer, and nothing is stored or loaded', async () => {
  const boom = (): never => {
    throw new Error('not today');
  };
  const ports: [string, PasskeyPort][] = [
    ['throws before it returns', { offered: boom, create: boom, finish: boom, get: boom, signalUnknown: boom, end: boom }],
    ['rejects', { ...answering(null), create: () => Promise.reject(new TypeError('x')), get: () => Promise.reject(new TypeError('x')) }],
    ['null', answering(null)],
    ['a string', answering('ok')],
    ['an unknown kind', answering({ kind: 'maybe' })],
    ['ok without its bytes', answering({ kind: 'ok', credentialId: 'abcd', tag: null, prfAt: 'create', prfEnabled: true })],
    ['ok with 31 bytes', answering({ kind: 'ok', prfOutput: new Uint8Array(31), credentialId: 'abcd', tag: null, prfAt: 'create', prfEnabled: true })],
    ['ok with bytes that are not bytes', answering({ kind: 'ok', prfOutput: Array(32).fill(1), credentialId: 'abcd', tag: null, prfAt: 'get', prfEnabled: null })],
    ['ok without an ID', answering({ kind: 'ok', prfOutput: new Uint8Array(32), tag: null, prfAt: 'create', prfEnabled: true })],
    ['ok with an ID no record can hold', answering({ kind: 'ok', prfOutput: new Uint8Array(32), credentialId: 'not base64 url!', tag: null, prfAt: 'create', prfEnabled: true })],
    ['ok with a tag no record can hold', answering({ kind: 'ok', prfOutput: new Uint8Array(32), credentialId: 'abcd', tag: 'the 12 words', prfAt: 'create', prfEnabled: true })],
    ['no-prf without an ID', answering({ kind: 'no-prf', tag: null })],
    ['an error without a name', answering({ kind: 'error' })],
  ];
  for (const [name, passkeys] of ports) {
    // With no wallet: create and open.
    const t = start({ passkeys });
    for (const answer of [await t.session.createWithPasskey(), await t.session.openWithPasskey()]) {
      assert.equal(answer.kind, 'error', name);
    }
    assert.deepEqual([t.view().status, t.view().unlocked, stored(t.storage), t.chain.opened.length], ['none', false, null, 0], name);
    await everyAction(t.session);

    // With a locked wallet: unlock.
    const u = lockedTab({ passkeys });
    const before = stored(u.storage);
    for (const answer of [await u.session.unlock(), await u.session.unlock('picker')]) {
      assert.equal(answer.kind, 'error', name);
    }
    assert.deepEqual([u.view().unlocked, stored(u.storage)], [false, before], name);
    assert.equal(u.session.revealWords(), null, name);
    await u.session.learnPasskeys('localhost');
    assert.equal(typeof u.view().passkeyOffered, 'boolean', name);
  }

  // A cancel with nothing else in it is still a cancel.
  const bare = start({ passkeys: answering({ kind: 'cancelled' }) });
  assert.deepEqual(await bare.session.createWithPasskey(), { kind: 'cancelled', timedOut: false });
});

test('a clock that gives no usable time, a word generator that gives no words: nothing is stored', async () => {
  for (const now of [() => 1.5, () => Number.NaN, () => -1, () => { throw new Error('no clock'); }]) {
    const t = start({ now });
    assert.equal((await t.session.createWithWords()).kind, 'error');
    assert.equal((await t.session.createWithPasskey()).kind, 'error');
    // The passkey that was made has no wallet here.
    assert.deepEqual(t.auth.forgotten, [t.auth.passkeys[0]?.idText]);
    assert.deepEqual(await t.session.restore(A.mnemonic), { kind: 'empty' });
    assert.equal(t.session.keepRestored(), 'no-storage');
    assert.deepEqual([stored(t.storage), t.view().status, t.view().unlocked], [null, 'none', false]);
  }
  for (const newMnemonic of [() => 'not twelve words', () => '', () => { throw new Error('no randomness'); }, (() => null) as unknown as () => string]) {
    const t = start({ newMnemonic });
    assert.equal((await t.session.createWithWords()).kind, 'error');
    assert.deepEqual([stored(t.storage), t.view().status], [null, 'none']);
  }
});

test('an event sender, a language reader and a chain engine that throw stop nothing', async () => {
  const boom = (): never => {
    throw new Error('not today');
  };
  const auth = new VirtualAuthenticator();
  const storage = new MemoryStorage();
  const session = makeSession({
    local: storage as Storage,
    passkeys: passkeyPort(auth.env()),
    chain: { open: boom, close: boom, probe: boom, state: boom, announce: boom, subscribe: boom },
    now: () => START_MS,
    track: boom,
    persist: boom,
    lang: boom,
    selfTest: () => true,
    newMnemonic: () => A.mnemonic,
  });
  assert.deepEqual(await session.createWithPasskey(), { kind: 'created' });
  assert.match(auth.passkeys[0]?.name ?? '', /^Practice wallet [2-9A-Z]{4} \(no real money\)$/, 'named in English when the language cannot be read');
  assert.deepEqual(session.revealWords(), auth.wordsOf(0).split(' '));
  session.lock();
  assert.deepEqual(await session.unlock(), { kind: 'unlocked' });
  assert.deepEqual(session.sign({ to: SOMEONE, amount: 1_000n, feeRate: 2n }), { ok: false, reason: 'nothing-spendable' });
  assert.equal(session.removeWallet(), 'removed');
  assert.deepEqual(await session.restore(A.mnemonic), { kind: 'failed', reason: 'unavailable' });
  assert.deepEqual(await session.createWithWords(), { kind: 'created' });
  await flush();
  assert.equal(session.view().persisted, null);
  await everyAction(session);
});

// -- what is never shown ----------------------------------------------------------------------

test('the 12 words are never in anything the session shows, counts or answers with', async () => {
  const shown: string[] = [];
  const text = (value: unknown): string => JSON.stringify(value, (_, part) => (typeof part === 'bigint' ? `${part}n` : part)) ?? '';
  const watch = (t: Tab): void => {
    shown.push(text(t.view()));
    t.session.subscribe(() => shown.push(text(t.view())));
  };
  const say = async (answer: unknown): Promise<void> => {
    shown.push(text(await answer));
  };

  // A wallet without a passkey, made and then loaded from storage.
  const storage = new MemoryStorage();
  const made = start({ storage });
  watch(made);
  await say(made.session.createWithWords());
  await flush();
  const loaded = start({ storage });
  watch(loaded);
  await say(loaded.session.unlock());
  await say(loaded.session.sign({ to: SOMEONE, amount: 1_000n, feeRate: 2n }));
  await say(loaded.session.unlockWithWords(B.mnemonic));
  await say(loaded.session.descriptors());
  // A check of three words, right and wrong: the answer is positions.
  await say(loaded.session.checkWordsAt([0, 10, 11], A.mnemonic.split(' ').slice(9)));
  await say(loaded.session.checkWordsAt([0, 1, 2], B.mnemonic.split(' ').slice(0, 3)));

  // A passkey wallet: created, locked, unlocked, switched, restored-and-waiting, removed.
  const t = start();
  watch(t);
  await say(t.session.createWithPasskey());
  const first = t.auth.wordsOf(0);
  t.session.lock();
  await say(t.session.unlock());
  await say(t.session.unlockWithWords(first));
  await say(t.session.checkWordsAt([3, 4, 5], first.split(' ').slice(3, 6)));
  await say(t.session.checkWordsAt([3, 4, 5], first.split(' ').slice(6, 9)));
  const other = passkeyWallet(t.auth, 2);
  t.auth.pick = 1;
  await say(t.session.unlock('picker'));
  await say(t.session.confirmSwitch());
  await say(t.session.removeWallet());
  await say(t.session.restore(A.mnemonic));
  await say(t.session.keepRestored());
  shown.push(text(t.events), text(made.events), text(loaded.events));

  assert.ok(shown.length > 30);
  for (const mnemonic of [A.mnemonic, B.mnemonic, first, other.words]) {
    const words = mnemonic.split(' ');
    for (const piece of shown) {
      assert.doesNotMatch(piece, /mnemonic/);
      // No two of its words side by side, as a text or as a list.
      for (let i = 0; i + 1 < words.length; i++) {
        assert.ok(!piece.includes(`${words[i]} ${words[i + 1]}`), piece);
        assert.ok(!piece.includes(`"${words[i]}","${words[i + 1]}"`), piece);
      }
    }
  }
  // A record that is shown is a copy without the words, never the stored object.
  assert.deepEqual(Object.keys(loaded.view().record ?? {}).sort(), ['createdAt', 'fingerprint', 'firstAddress', 'kind', 'v', 'xpub']);
  assert.deepEqual(t.unlisted.concat(made.unlisted, loaded.unlisted), [], 'every event is one the contract lists');
});

// -- what regular expressions remember ------------------------------------------------------------

/**
 * Everything the browser keeps of the last regular expression that matched:
 * RegExp.input and the rest of that family, as one text. Any script in the
 * page can read these.
 */
function regexpMemory(): string {
  const kept = RegExp as unknown as Record<string, unknown>;
  const names = ['input', '$_', 'lastMatch', '$&', 'leftContext', '$`', 'rightContext', "$'", 'lastParen', '$+', '$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9'];
  return names.map((name) => String(kept[name] ?? '')).join('\n');
}

/** The session module as a test is handed it: this file's own, or the one the app's build made of it. */
type SessionModule = Pick<typeof import('../src/lib/session.ts'), 'makeSession' | 'passkeyPort'>;

/**
 * Every action that handles the 12 words, done once, on the session module
 * handed in. After each (and, for one that answers later, once its answer
 * is there) what regular expressions remember is looked at. Returns the
 * actions after which two words of some wallet stood there side by side.
 */
async function wordsLeftBehind(module: SessionModule): Promise<string[]> {
  const typed = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
  const badChecksum = 'legal winner thank year wave sausage worth useful legal winner thank thank';
  const secrets = new Set<string>([A.mnemonic, B.mnemonic, typed, badChecksum]);
  const left: string[] = [];
  const look = (after: string): void => {
    // Lower case and single spaces, as the words are compared. No regular expression here: one
    // that matched would replace the very thing being looked at.
    const memory = regexpMemory()
      .toLowerCase()
      .split('\n')
      .join(' ')
      .split(' ')
      .filter((piece) => piece !== '')
      .join(' ');
    for (const mnemonic of secrets) {
      const words = mnemonic.split(' ');
      if (words.some((word, i) => i > 0 && memory.includes(`${words[i - 1]} ${word}`))) {
        left.push(after);
        return;
      }
    }
  };
  const tab = (storage = new MemoryStorage(), auth = new VirtualAuthenticator()) => {
    const chain = new FakeChain();
    const session = module.makeSession({
      local: storage as Storage,
      passkeys: module.passkeyPort(auth.env()),
      chain,
      now: () => START_MS,
      track: recorder().track,
      persist: async () => true,
      lang: () => 'en',
      selfTest: () => true,
      newMnemonic: () => A.mnemonic,
    });
    return { session, chain, auth, storage };
  };
  const locked = () => {
    const auth = new VirtualAuthenticator();
    const storage = new MemoryStorage();
    const wallet = passkeyWallet(auth);
    secrets.add(wallet.words);
    put(storage, wallet.record);
    return { ...tab(storage, auth), wallet };
  };
  /** As a reader types them: capitals and stray spaces. */
  const asTyped = (words: string): string => `  ${words.toUpperCase().replaceAll(' ', '   ')}\n`;
  /**
   * After a check of a few words: not one of the words typed for it stands
   * in what regular expressions remember, and neither does anything that
   * stood there before the call. (The check for two words side by side,
   * above, cannot see these: they are handed over one to a field.)
   */
  const wordsAtLeft = (after: string, typedWords: string[]): void => {
    const memory = regexpMemory().toLowerCase();
    if (typedWords.some((word) => memory.includes(word.toLowerCase()))) left.push(after);
  };

  // A passkey wallet, unlocked with its 12 words: then locked, then the bot check.
  let t = locked();
  assert.equal(t.session.unlockWithWords(asTyped(t.wallet.words)), 'unlocked');
  look('unlockWithWords: unlocked');
  t.session.lock();
  look('unlockWithWords, then lock');
  t.session.beforeBotCheck();
  look('unlockWithWords, lock, then beforeBotCheck');
  t = locked();
  t.session.unlockWithWords(t.wallet.words);
  t.session.beforeBotCheck();
  look('unlockWithWords, then beforeBotCheck');
  t = locked();
  t.session.unlockWithWords(asTyped(t.wallet.words));
  t.session.revealWords();
  look('unlockWithWords, then revealWords');
  t.session.sign({ to: SOMEONE, amount: 1_000n, feeRate: 2n });
  look('sign');
  // Three words checked, as typed: right ones, wrong ones, and other wallets' words in their place.
  const three = t.wallet.words.split(' ').slice(4, 7);
  assert.deepEqual(t.session.checkWordsAt([4, 5, 6], three.map(asTyped)), { ok: true, wrong: [] });
  look('checkWordsAt: right');
  wordsAtLeft('checkWordsAt: right', three);
  const others = typed.split(' ').slice(0, 3);
  assert.equal(t.session.checkWordsAt([4, 5, 6], others.map(asTyped)).ok, true);
  look('checkWordsAt: wrong');
  wordsAtLeft('checkWordsAt: wrong', others);
  t.session.lock();
  assert.deepEqual(t.session.checkWordsAt([4, 5, 6], three.map(asTyped)), { ok: false, reason: 'locked' });
  wordsAtLeft('checkWordsAt: locked', three);
  t.session.beforeBotCheck();
  assert.deepEqual(t.session.checkWordsAt([4, 5, 6], three.map(asTyped)), { ok: false, reason: 'reload' });
  wordsAtLeft('checkWordsAt: reload', three);
  t = locked();
  assert.equal(t.session.unlockWithWords(asTyped(typed)), 'other-wallet');
  look('unlockWithWords: other-wallet');
  assert.equal(t.session.unlockWithWords(asTyped(badChecksum)), 'invalid');
  look('unlockWithWords: invalid');

  // The passkey's own ways: unlock, the picker, a switch, create, open.
  t = locked();
  assert.deepEqual(await t.session.unlock(), { kind: 'unlocked' });
  look('unlock');
  secrets.add(passkeyWallet(t.auth, 2).words);
  t.auth.pick = 1;
  assert.equal((await t.session.unlock('picker')).kind, 'other-passkey');
  look('unlock: other-passkey');
  assert.equal(t.session.confirmSwitch(), 'switched');
  look('confirmSwitch');
  assert.equal(t.session.removeWallet(), 'removed');
  look('removeWallet of a passkey wallet');
  let made = tab();
  assert.deepEqual(await made.session.createWithPasskey(), { kind: 'created' });
  secrets.add(made.auth.wordsOf(0));
  look('createWithPasskey');
  made = tab();
  secrets.add(passkeyWallet(made.auth).words);
  assert.deepEqual(await made.session.openWithPasskey(), { kind: 'opened' });
  look('openWithPasskey');

  // Restore: every keystroke is checked, the scan runs, the words wait, and are erased or kept.
  let r = tab();
  r.session.checkWords(asTyped(typed));
  look('checkWords');
  r.session.checkWords(asTyped(badChecksum));
  look('checkWords: a bad checksum');
  const release = r.chain.holdProbe();
  const restoring = r.session.restore(asTyped(typed));
  await flush();
  look('restore, while its scan runs');
  release();
  assert.deepEqual(await restoring, { kind: 'empty' });
  look('restore: empty');
  r.session.checkWords(typed);
  r.session.eraseRestored();
  look('checkWords, then eraseRestored');
  assert.deepEqual(await r.session.restore(typed), { kind: 'empty' });
  assert.equal(r.session.keepRestored(), 'restored');
  look('keepRestored');
  r = tab();
  r.chain.probeAnswer = { ok: true, state: coinsState([], true) };
  assert.deepEqual(await r.session.restore(asTyped(typed)), { kind: 'restored' });
  look('restore: restored');
  r = tab();
  r.chain.probeAnswer = { ok: false, reason: 'network' };
  assert.deepEqual(await r.session.restore(typed), { kind: 'failed', reason: 'network' });
  look('restore: failed');
  assert.deepEqual(await r.session.restore(badChecksum), { kind: 'invalid' });
  look('restore: invalid');
  // With the bot check in the page nothing takes words any more. What was handed in is still not left lying.
  r.session.beforeBotCheck();
  assert.deepEqual(await r.session.restore(typed), { kind: 'reload' });
  look('beforeBotCheck, then restore: reload');
  r.session.checkWords(typed);
  look('beforeBotCheck, then checkWords');

  // A wallet made without a passkey: made, read from storage by a new page, used, and removed here or in another tab.
  const w = tab();
  assert.deepEqual(await w.session.createWithWords(), { kind: 'created' });
  look('createWithWords');
  const again = tab(w.storage);
  look('a page that loads a wallet made without a passkey');
  again.session.revealWords();
  again.session.sign({ to: SOMEONE, amount: 1_000n, feeRate: 2n });
  again.session.unlockWithWords(A.mnemonic);
  look('revealWords, sign and unlockWithWords of that wallet');
  assert.deepEqual(again.session.checkWordsAt([0, 11], ['abandon', 'about'].map(asTyped)), { ok: true, wrong: [] });
  look('checkWordsAt of that wallet');
  wordsAtLeft('checkWordsAt of that wallet', ['abandon', 'about']);
  again.session.storageChanged(RECORD_KEY);
  look('storageChanged');
  assert.equal(w.session.removeWallet(), 'removed');
  look('removeWallet of a wallet made without a passkey');
  again.session.storageChanged(RECORD_KEY);
  look('storageChanged, the wallet removed in another tab');
  put(again.storage, makeRecord('words', B.mnemonic, START_MS));
  assert.deepEqual(await again.session.createWithPasskey(), { kind: 'exists' });
  look('create refused: a wallet made without a passkey is here');

  return left;
}

test('the 12 words are not left where a regular expression keeps them: after no action can a script read them back', async () => {
  // The check itself can tell: straight after a regular expression has run over words, they are there.
  assert.ok(/\s+/.test(` ${B.mnemonic} `));
  assert.ok(regexpMemory().includes(B.mnemonic), 'a regular expression that matched keeps its text');
  // The wallet package runs none over them (it did once, to tidy them): after it has handled
  // words, what a regular expression remembers holds neither phrase.
  assert.ok(/kept/.test('something kept from before'));
  accountFromMnemonic(` ${A.mnemonic} `);
  normalizeMnemonic(` ${B.mnemonic} `);
  assert.ok(!regexpMemory().includes(A.mnemonic) && !regexpMemory().includes(B.mnemonic));

  assert.deepEqual(await wordsLeftBehind({ makeSession, passkeyPort }), []);

  // Every action that is handed out wipes when it ends, whatever it did itself: what some
  // earlier code left for a regular expression to remember is gone after it, too.
  const t = lockedTab();
  const request: PaymentRequest = { to: SOMEONE, amount: 1_000n, feeRate: 2n };
  const actions: Record<Exclude<keyof Session, 'view' | 'subscribe'>, () => unknown> = {
    createWithPasskey: () => t.session.createWithPasskey(),
    finishSetup: () => t.session.finishSetup(),
    createWithWords: () => t.session.createWithWords(),
    ackCreated: () => t.session.ackCreated(),
    openWithPasskey: () => t.session.openWithPasskey(),
    unlock: () => t.session.unlock(),
    unlockWithWords: () => t.session.unlockWithWords('not the words'),
    confirmSwitch: () => t.session.confirmSwitch(),
    cancelSwitch: () => t.session.cancelSwitch(),
    checkWords: () => t.session.checkWords('zebra'),
    restore: () => t.session.restore('not the words'),
    keepRestored: () => t.session.keepRestored(),
    eraseRestored: () => t.session.eraseRestored(),
    lock: () => t.session.lock(),
    revealWords: () => t.session.revealWords(),
    checkWordsAt: () => t.session.checkWordsAt([0], ['zebra']),
    descriptors: () => t.session.descriptors(),
    sign: () => t.session.sign(request),
    learnPasskeys: () => t.session.learnPasskeys('localhost'),
    storageChanged: () => t.session.storageChanged(RECORD_KEY),
    backInView: () => t.session.backInView(),
    beforeBotCheck: () => t.session.beforeBotCheck(),
    removeWallet: () => t.session.removeWallet(),
  };
  for (const [name, act] of Object.entries(actions)) {
    assert.ok(/kept/.test('something kept from before'));
    assert.ok(regexpMemory().includes('something kept from before'));
    await act();
    assert.ok(!regexpMemory().includes('kept'), name);
  }
});

test('the built code wipes them too: the build has not dropped the match that does it as dead code', async () => {
  // session.ts and all it imports, through the app's own bundler and minifier (the tools "vite build" uses).
  const { build } = await import('vite');
  const built = await build({
    configFile: false,
    logLevel: 'silent',
    root: fileURLToPath(new URL('..', import.meta.url)),
    build: { write: false, modulePreload: false, rollupOptions: { input: 'src/lib/session.ts', preserveEntrySignatures: 'strict' } },
  });
  const files = [built].flat().flatMap((one) => ('output' in one ? one.output : []));
  const chunks = files.flatMap((file) => (file.type === 'chunk' ? [file] : []));
  assert.equal(chunks.length, 1, 'one file holds it all');
  const code = chunks[0]?.code ?? '';
  assert.ok(code.length > 50_000, 'the wallet package is in it');
  assert.ok(!code.includes('storedIsLoaded') && !code.includes('forgetPasskey'), 'and it went through the minifier: the names session.ts gives its own functions are gone');

  const module = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)) as SessionModule;
  assert.notEqual(module.makeSession, makeSession, 'the built module, not this file\'s');
  assert.deepEqual(await wordsLeftBehind(module), []);
});

// -- the three modules together -----------------------------------------------------------------

test('sign: locked, nothing read yet, what the plan says, and a payment that is exactly the wallet package\'s', async () => {
  const request: PaymentRequest = { to: SOMEONE, amount: 60_000n, feeRate: 2n };
  const t = testEngine({ newMnemonic: () => A.mnemonic });
  assert.deepEqual(t.session.sign(request), { ok: false, reason: 'locked' }, 'no wallet');
  assert.deepEqual(await t.session.createWithWords(), { kind: 'created' });
  // The first scan is still running: there is nothing to spend yet.
  assert.deepEqual(t.session.sign(request), { ok: false, reason: 'nothing-spendable' });
  await t.settle();
  assert.deepEqual(t.session.sign(request), { ok: false, reason: 'nothing-spendable' }, 'an empty wallet');

  const address = t.chain.view().receive?.address ?? '';
  t.net.pay(address, 100_000, { confirmed: true });
  await t.chain.refresh();
  const state = t.chain.state();
  assert.ok(state);

  // The plan's own reasons come back.
  for (const [bad, reason] of [
    [{ ...request, amount: 100_000n }, 'too-much'],
    [{ ...request, amount: 100n }, 'below-dust'],
    [{ ...request, to: 'nowhere' }, 'bad-address'],
  ] as const) {
    assert.deepEqual(t.session.sign(bad), { ok: false, reason });
  }
  // What no form should send is refused too, never thrown.
  for (const odd of [{ ...request, feeRate: 0n }, { ...request, amount: 0n }, { ...request, amount: -1n }, null, {}]) {
    assert.equal(t.session.sign(odd as never).ok, false);
  }

  const signedPayment = t.session.sign(request);
  assert.ok(signedPayment.ok);
  const key = accountFromMnemonic(A.mnemonic).key;
  const expected = signPayment(key, state, request);
  assert.deepEqual(signedPayment.payment, expected);
  assert.deepEqual(signedPayment.view, viewPayment(expected, ownAddresses(state)));
  // The plan the reader agreed to is the payment that was signed.
  const plan = t.chain.plan(request);
  assert.ok(plan.ok);
  assert.deepEqual([signedPayment.payment.fee, signedPayment.payment.vsize], [plan.fee, plan.vsize]);
  assert.equal(signedPayment.view.direction, 'sent');
  // Nothing was sent.
  assert.equal(t.net.count(/POST/), 0);
});

test('a passkey wallet signs only while unlocked, and never after the bot check', async () => {
  const request: PaymentRequest = { to: SOMEONE, amount: 60_000n, feeRate: 2n };
  const t = testEngine();
  assert.deepEqual(await t.session.createWithPasskey(), { kind: 'created' });
  await t.settle();
  t.net.pay(t.chain.view().receive?.address ?? '', 100_000, { confirmed: true });
  await t.chain.refresh();

  assert.equal(t.session.sign(request).ok, true);
  t.session.lock();
  assert.deepEqual(t.session.sign(request), { ok: false, reason: 'locked' });
  // Planning needs no key.
  assert.equal(t.chain.plan(request).ok, true);
  assert.deepEqual(await t.session.unlock(), { kind: 'unlocked' });
  assert.equal(t.session.sign(request).ok, true);
  assert.deepEqual(t.chain.view().notice?.kind, 'unlocked');

  t.session.beforeBotCheck();
  assert.deepEqual(t.session.sign(request), { ok: false, reason: 'locked' });
  assert.deepEqual(t.chain.view().notice?.kind, 'locked');
  // Looking, receiving and the faucet go on working.
  assert.equal(t.chain.plan(request).ok, true);
  t.chain.watch('receive');
  await t.settle();
  await t.faucet.ask(async () => 'a-token');
  assert.equal(t.faucet.view().phase, 'on-its-way');
  await t.advance(5_000);
  assert.equal(t.faucet.view().phase, 'arrived');
});

test('asking the faucet drops a passkey wallet\'s keys before the bot check runs, whether or not a screen called beforeBotCheck()', async () => {
  const request: PaymentRequest = { to: SOMEONE, amount: 60_000n, feeRate: 2n };
  const t = testEngine();
  assert.deepEqual(await t.session.createWithPasskey(), { kind: 'created' });
  await t.settle();
  t.net.pay(t.chain.view().receive?.address ?? '', 100_000, { confirmed: true });
  await t.chain.refresh();
  t.chain.watch('receive');
  await t.settle();
  assert.equal(t.session.sign(request).ok, true, 'unlocked since the create');

  // No beforeBotCheck() here: a screen that forgot to call it. The token source is where the bot check's code runs.
  const met: unknown[] = [];
  await t.faucet.ask(async () => {
    met.push(t.session.view().unlocked, t.session.revealWords(), t.session.sign(request));
    return 'a-token';
  });
  assert.deepEqual(met, [false, null, { ok: false, reason: 'locked' }]);
  assert.equal(t.faucet.view().phase, 'on-its-way', 'and the faucet was asked all the same');
  // From then on the page is as after beforeBotCheck(): nothing loads keys until it is reloaded.
  assert.deepEqual(t.chain.view().notice?.kind, 'locked');
  assert.deepEqual(await t.session.unlock(), { kind: 'reload' });
  assert.equal(t.session.unlockWithWords(t.auth.wordsOf(0)), 'reload');

  // Asked before there is an address to pay, the bot check does not run, and so nothing is dropped.
  const early = testEngine();
  assert.deepEqual(await early.session.createWithPasskey(), { kind: 'created' });
  let ran = false;
  await early.faucet.ask(async () => {
    ran = true;
    return 'a-token';
  });
  assert.deepEqual([ran, early.session.view().unlocked, early.faucet.view().phase], [false, true, 'idle']);
  await early.settle();
});

test('a request with no answer: restore, the faucet and the first scan each answer when it is given up, and none blocks the next', async () => {
  // Only turns of the event loop while requests hang: chain.idle() would wait for them.
  const turns = async (): Promise<void> => {
    for (let turn = 0; turn < 12; turn++) await flush();
  };

  // Restore: the scan of the typed words gets no answer.
  const t = testEngine({ deadline: true });
  t.net.pay(firstOf(A), 100_000, { confirmed: true });
  t.net.silent = true;
  const answers: unknown[] = [];
  void t.session.restore(A.mnemonic).then((answer) => answers.push(answer));
  // A second restore waits behind the first.
  void t.session.restore(A.mnemonic).then((answer) => answers.push(answer));
  await turns();
  // From here on the network answers again. What the first one asked stays without an answer.
  t.net.silent = false;
  await t.timers.advance(19_999, turns);
  assert.deepEqual(answers, []);
  await t.timers.advance(1, turns);
  // The first is given up after 20 s, and the one behind it runs.
  assert.deepEqual(answers, [{ kind: 'failed', reason: 'network' }, { kind: 'restored' }]);
  assert.equal(t.session.view().status, 'ready');
  await t.settle();

  // The faucet: its request gets no answer. Given up after 40 s, failed with "network", and the address is let go.
  t.chain.watch('receive');
  await t.settle();
  const address = t.chain.view().receive?.address;
  t.net.silent = true;
  t.net.silentFor = /POST \/api\/faucet$/;
  let done = false;
  void t.faucet.ask(async () => 'a-token').then(() => {
    done = true;
  });
  await t.timers.advance(39_999, turns);
  assert.deepEqual([done, t.faucet.view().phase], [false, 'asking']);
  t.chain.newReceiveAddress();
  assert.equal(t.chain.view().receive?.address, address, 'frozen while the request runs');
  await t.timers.advance(1, turns);
  assert.deepEqual([done, t.faucet.view()], [true, { phase: 'failed', payment: null, failure: 'network', retryAt: null }]);
  t.chain.newReceiveAddress();
  assert.notEqual(t.chain.view().receive?.address, address);
  // Asking again is a new request.
  t.net.silent = false;
  await t.faucet.ask(async () => 'a-token');
  assert.equal(t.faucet.view().phase, 'on-its-way');

  // A page that loads with a wallet while the network says nothing: the first scan fails with a reason, and is tried again.
  const storage = new MemoryStorage();
  put(storage, makeRecord('words', A.mnemonic, START_MS));
  const net = t.net;
  net.silentFor = null;
  net.silent = true;
  const page = testEngine({ deadline: true, storage, net });
  page.chain.watch('wallet');
  await page.timers.advance(20_000, turns);
  assert.deepEqual([page.chain.view().chain.scanning, page.chain.view().chain.error, page.chain.view().chain.state], [false, 'network', null]);
  net.silent = false;
  await page.advance(15_000);
  assert.deepEqual([page.chain.view().chain.error, page.chain.view().chain.state?.confirmed], [null, 100_000n]);
});

test('a wallet changed in another tab: the coins read for the old one are dropped, and the new one is scanned', async () => {
  const t = testEngine({ newMnemonic: () => A.mnemonic });
  await t.session.createWithWords();
  await t.settle();
  t.net.pay(t.chain.view().receive?.address ?? '', 100_000, { confirmed: true });
  await t.chain.refresh();
  t.chain.watch('activity');
  await t.settle();
  assert.equal(t.chain.view().chain.state?.confirmed, 100_000n);
  assert.equal(t.chain.view().history?.length, 1);
  await t.faucet.ask(async () => 'a-token');
  assert.equal(t.faucet.view().phase, 'on-its-way');

  // Another tab switches this browser to wallet B.
  (t.storage as MemoryStorage).map.set(RECORD_KEY, JSON.stringify(makeRecord('words', B.mnemonic, START_MS)));
  t.session.storageChanged(RECORD_KEY);
  // At once: nothing of wallet A is shown, and never a zero in its place.
  assert.equal(t.session.view().record?.fingerprint, B.masterFingerprint);
  assert.deepEqual([t.chain.view().chain.state, t.chain.view().chain.scanning], [null, true]);
  assert.deepEqual([t.chain.view().history, t.chain.view().receive], [null, null]);
  assert.equal(t.faucet.view().phase, 'idle');
  await t.settle();
  assert.equal(t.chain.view().chain.state?.confirmed, 0n);
  assert.equal(t.chain.view().receive?.address, firstOf(B));

  // Removed in another tab: nothing is scanned or polled any more.
  (t.storage as MemoryStorage).map.delete(RECORD_KEY);
  t.session.storageChanged(RECORD_KEY);
  assert.deepEqual([t.session.view().status, t.chain.view().chain.state, t.chain.view().receive], ['none', null, null]);
  t.net.requests.length = 0;
  await t.advance(120_000);
  assert.equal(t.net.requests.length, 0);
});

test('restore with the real scan: the coins found are shown at once, and the wallet is not scanned twice', async () => {
  const t = testEngine();
  const account = accountFromMnemonic(A.mnemonic);
  t.net.pay(firstOf(A), 100_000, { confirmed: true });
  assert.deepEqual(await t.session.restore(A.mnemonic), { kind: 'restored' });
  // No waiting: the scan that found the history is the wallet's first.
  assert.equal(t.chain.view().chain.state?.confirmed, 100_000n);
  assert.equal(t.chain.view().chain.scanning, false);
  assert.equal(t.session.view().record?.xpub, account.xpub);
  const scans = t.net.count(/address\/[a-z0-9]+$/);
  await t.settle();
  assert.equal(t.net.count(/address\/[a-z0-9]+$/), scans, 'no second scan');
  assert.equal(t.chain.view().chain.tip, 101, 'only the height was still to be read');

  // Unused words: empty, kept, and then scanned like any wallet.
  const u = testEngine();
  assert.deepEqual(await u.session.restore(B.mnemonic), { kind: 'empty' });
  assert.equal(u.chain.view().chain.state, null);
  assert.equal(u.session.keepRestored(), 'restored');
  await u.settle();
  assert.equal(u.chain.view().chain.state?.confirmed, 0n);
  assert.equal(u.session.view().openedEmpty, false, 'only a wallet opened with a passkey is flagged as unexpectedly empty');
});

test('open with a passkey and the real scan: empty until coins arrive', async () => {
  const t = testEngine();
  passkeyWallet(t.auth);
  assert.deepEqual(await t.session.openWithPasskey(), { kind: 'opened' });
  assert.equal(t.session.view().openedEmpty, false, 'not before the first scan has said so');
  await t.settle();
  assert.equal(t.session.view().openedEmpty, true);
  assert.deepEqual(t.events, ['Unlock: opened-empty']);

  t.chain.watch('receive');
  await t.settle();
  t.net.pay(t.chain.view().receive?.address ?? '', 5_000);
  await t.advance(5_000);
  assert.equal(t.chain.view().chain.state?.unconfirmed, 5_000n);
  assert.equal(t.session.view().openedEmpty, false);
  assert.deepEqual(t.unlisted, []);
});

test('the whole engine with everything around it failing: every action of WalletApi answers, and none throws', async () => {
  const boom = (): never => {
    throw new Error('not today');
  };
  const request: PaymentRequest = { to: SOMEONE, amount: 1_000n, feeRate: 2n };
  const engines = [
    // Nothing works at all.
    makeEngine({
      local: new BlockedStorage() as Storage,
      passkeys: { offered: boom, create: boom, finish: boom, get: boom, signalUnknown: boom, end: boom },
      api: makeApi(boom),
      now: boom,
      timers: { set: boom, clear: boom },
      visible: boom,
      track: boom,
      persist: boom,
      lang: boom,
      blockSeconds: boom,
      selfTest: () => true,
      newMnemonic: boom,
    }),
    // A wallet is here, and then the network and the storage give out.
    (() => {
      const t = testEngine({ storage: new FullStorage(), newMnemonic: () => A.mnemonic });
      (t.storage as FullStorage).full = false;
      void t.session.createWithWords();
      t.net.down = 'network';
      (t.storage as FullStorage).full = true;
      return t.engine;
    })(),
    // The self-test fails.
    testEngine({ selfTest: () => false }).engine,
  ];
  for (const engine of engines) {
    await flush();
    await everyAction(engine.session);
    for (const screen of ['wallet', 'receive', 'activity', 'about', null] as const) engine.chain.watch(screen);
    engine.chain.visibilityChanged();
    await engine.chain.refresh();
    assert.ok(['found', 'waiting', 'not-found', 'failed'].includes((await engine.chain.lookupTx('ab'.repeat(32))).kind));
    engine.chain.newReceiveAddress();
    assert.equal(typeof engine.chain.plan(request).ok, 'boolean');
    assert.equal(typeof (await engine.chain.broadcast({ txid: 'x', hex: '00' } as never)).ok, 'boolean');
    assert.equal(typeof (await engine.chain.potAddress()).ok, 'boolean');
    await engine.faucet.ask(async () => 'a-token');
    await engine.faucet.ask(boom);
    assert.ok(['idle', 'failed'].includes(engine.faucet.view().phase), engine.faucet.view().phase);
    await flush();
    await engine.chain.idle();
  }
});
