// The "Do it" runner at work in one page (src/lib/doit/runner.ts): what it
// writes and when, what it counts and when, and what it tells the screens.
//
// The runner is handed a storage, the wallet's picture of itself, a clock
// and a counter. Here the storage is a Map, the wallet is a variable the
// test changes, and the clock moves when the test says so. "Another tab" is
// a second runner on the same storage.
//
// The rules of a single change (what a tick is, when an event counts) are
// advance.ts's and are tested there. This file holds the runner to what
// only it can get wrong: the order of things, and what it remembers
// between one change and the next.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StepId } from '@learnbitcoin/practice-contract';
import { judge, LOST_MS, type Seen, type World } from '../src/lib/doit/judge.ts';
import { PROGRESS_KEY, readProgress, type Progress } from '../src/lib/doit/progress.ts';
import { makeRunner, type Shown } from '../src/lib/doit/runner.ts';
import type { Route } from '../src/lib/router.ts';
import { RECORD_KEY } from '../src/lib/keystore.ts';
import { FP, NOW, chain, noWallet, record, state, tx, txid, world } from './doit-worlds.ts';
import { BlockedStorage, FullStorage, MemoryStorage } from './engine-fakes.ts';

const HOME: Route = { name: 'home' };
const LIST: Route = { name: 'do' };
const SEND: Route = { name: 'send' };
const COINS: Route = { name: 'coins' };
const step = (id: StepId): Route => ({ name: 'step', id });

/** A page: a runner over a storage, with a wallet, a clock and a visibility the test can change. */
function page(options: { storage?: MemoryStorage; wallet?: World['wallet']; canStore?: boolean } = {}) {
  const storage = options.storage ?? new MemoryStorage();
  const it = {
    storage,
    wallet: options.wallet ?? noWallet().wallet,
    canStore: options.canStore ?? true,
    now: NOW,
    visible: true,
    counted: [] as StepId[],
    published: [] as Shown[],
  };
  const runner = makeRunner({
    local: storage as Storage,
    wallet: () => it.wallet,
    canStore: () => it.canStore,
    now: () => it.now,
    visible: () => it.visible,
    count: (id) => it.counted.push(id),
    publish: (shown) => it.published.push(shown),
  });
  /** The note as it is stored. */
  const note = (): Progress => readProgress(storage as Storage).progress;
  /** What judge() makes of a step, from what the runner shows. */
  const view = (id: StepId) => {
    const shown = runner.shown();
    const seen: Seen = { wallet: it.wallet, note: shown.progress, kept: shown.kept, now: it.now, listAt: shown.listAt };
    return judge(id, seen);
  };
  const states = (id: StepId): string[] =>
    view(id).parts.map((part) => (part.state === 'blocked' || part.state === 'unknown' ? `${part.state}: ${part.reason}` : part.state));
  /** The wallet publishes something new. */
  const publish = (wallet: Partial<World['wallet']>): void => {
    it.wallet = { ...it.wallet, ...wallet };
    runner.changed();
  };
  return Object.assign(it, { runner, note, view, states, publish });
}

/** The sample wallet with one confirmed coin, and the list of transactions read: the coin's own transaction. */
function funded(): World['wallet'] {
  return world({ chain: chain(state([{ tx: 'c1', sats: 50_000 }])), history: [tx({ tx: 'c1', direction: 'received' })] }).wallet;
}

// -- nothing is written until a step's screen is opened ---------------------------------

test('Home, the list and the wallet\'s own screens write nothing while no step is started', () => {
  const p = page({ wallet: funded() });
  p.runner.watch(HOME, '');
  p.runner.watch(LIST, '');
  p.runner.watch(COINS, '');
  p.publish({ wordsShown: 1 });
  p.publish({ lastSent: { txid: txid('a1'), toPot: true, at: NOW } });
  p.runner.visible();
  p.runner.stop('hold-some');
  p.runner.follow('hold-some');
  p.runner.sendAnother('pass-it-on');
  assert.equal(p.runner.answer('the-seed'), false);
  assert.equal(p.runner.recheck(), false);
  assert.equal(p.storage.writes, 0, 'nothing was written');
  assert.deepEqual([...p.storage.map.keys()], []);
  assert.equal(p.runner.shown().read, 'none');
  assert.deepEqual(p.counted, []);
});

test('before the first screen is named, a change of the wallet is not looked at', () => {
  const p = page({ wallet: funded() });
  p.runner.changed();
  p.runner.visible();
  assert.deepEqual(p.published, []);
  assert.equal(p.storage.reads, 0);
});

// -- opening a step ---------------------------------------------------------------------------

test('opening a step is the first write, and what the wallet already satisfies ticks in the same call', () => {
  const p = page({ wallet: funded() });
  p.runner.watch(HOME, '');
  p.runner.watch(step('hold-some'), '?from=/journey/what-bitcoin-actually-is');
  // Started, followed, with the way back; a wallet is here, it has seen coins, one is confirmed.
  assert.deepEqual(p.note(), {
    v: 1,
    following: 'hold-some',
    followedAt: NOW,
    steps: { 'hold-some': { started: true, from: '/journey/what-bitcoin-actually-is', parts: { 1: true, 2: true, 3: true } } },
  });
  assert.deepEqual(p.states('hold-some'), ['ticked', 'ticked', 'ticked', 'now']);
  // Only the note's key was written, and the wallet's record was not touched.
  assert.deepEqual([...p.storage.map.keys()], [PROGRESS_KEY]);
  assert.equal(p.storage.map.has(RECORD_KEY), false);
  // The screens were told once, after everything was written.
  assert.equal(p.published.at(-1)?.read, 'kept');
  assert.deepEqual(p.published.at(-1)?.progress, p.note());
});

test('a way back that is not the step\'s own chapter is ignored without a word, and a later opening without one keeps the earlier one', () => {
  const p = page();
  // Another host, another page of the main site, and another step's chapter: none is kept, and nothing of the address is stored.
  for (const search of ['?from=//evil.example/x', '?from=/newsletter', '?from=/journey/how-bitcoin-works', '?from=/journey/what-bitcoin-actually-is/']) {
    p.runner.watch(HOME, '');
    p.runner.watch(step('hold-some'), search);
    assert.equal(p.note().steps['hold-some']?.from, undefined, search);
    assert.doesNotMatch(p.storage.map.get(PROGRESS_KEY) ?? '', /evil|newsletter|how-bitcoin-works|from/, search);
  }
  p.runner.watch(HOME, '');
  p.runner.watch(step('hold-some'), '?from=/journey/what-bitcoin-actually-is');
  assert.equal(p.note().steps['hold-some']?.from, '/journey/what-bitcoin-actually-is');
  p.runner.watch(HOME, '');
  p.runner.watch(step('hold-some'), '');
  assert.equal(p.note().steps['hold-some']?.from, '/journey/what-bitcoin-actually-is');
  // One that is refused does not take its place either.
  p.runner.watch(HOME, '');
  p.runner.watch(step('hold-some'), '?from=/journey/be-your-own-bank');
  assert.equal(p.note().steps['hold-some']?.from, '/journey/what-bitcoin-actually-is');
  // The same address names the way back of the step it opens, and of no other: chapter 4's page is "The seed"'s own.
  p.runner.watch(step('the-seed'), '?from=/journey/be-your-own-bank');
  assert.equal(p.note().steps['the-seed']?.from, '/journey/be-your-own-bank');
  assert.equal(p.note().steps['hold-some']?.from, '/journey/what-bitcoin-actually-is');
});

test('the same screen named again (the other language) is no new opening; another step is', () => {
  const p = page();
  p.runner.watch(step('hold-some'), '');
  const writes = p.storage.writes;
  p.now += 60_000;
  // The switch to the other language keeps the address's query string, and may name the chapter's other page.
  p.runner.watch(step('hold-some'), '?from=/es/recorrido/que-es-bitcoin-en-realidad');
  assert.equal(p.storage.writes, writes, 'nothing was written for the same screen');
  assert.equal(p.note().followedAt, NOW);
  assert.equal(p.note().steps['hold-some']?.from, undefined, 'and its way back is as it was: none');
  p.runner.watch(step('the-seed'), '');
  assert.deepEqual([p.note().following, p.note().followedAt], ['the-seed', NOW + 60_000]);
  assert.equal(p.note().steps['hold-some']?.started, true, 'the first step stays started');
});

// -- events count only for the followed step, and only as a change --------------------------------

test('a payment sent while the step is followed ticks; this page\'s last payment from before does not', () => {
  const p = page({ wallet: { ...funded(), lastSent: { txid: txid('a1'), toPot: true, at: NOW - 60_000 } } });
  p.runner.watch(HOME, '');
  // The payment to the pot was sent before the step was opened.
  p.runner.watch(step('waiting-room'), '');
  assert.deepEqual(p.states('waiting-room'), ['now', 'later', 'later']);
  p.runner.watch(SEND, '');
  p.now += 5_000;
  p.publish({ lastSent: { txid: txid('b2'), toPot: false, at: p.now } });
  assert.deepEqual(p.note().steps['waiting-room'], { started: true, tx: txid('b2'), sentAt: p.now, parts: { 1: true } });
});

test('an event on a page\'s first world ticks nothing: the Coins screen was not "opened" by a page that loaded on it', () => {
  const storage = new MemoryStorage();
  const first = page({ storage, wallet: funded() });
  first.runner.watch(step('no-balances'), '');
  // A page load on the Coins screen: a new runner on the same storage, whose first world already shows the coins.
  const second = page({ storage, wallet: { ...funded(), history: [tx({ tx: 'p1' }), tx({ tx: 'c1', direction: 'received' })] } });
  second.runner.watch(COINS, '');
  assert.equal(second.note().steps['no-balances']?.parts, undefined);
  // Opened from another screen, it counts.
  second.runner.watch(HOME, '');
  second.runner.watch(COINS, '');
  assert.deepEqual(second.note().steps['no-balances']?.parts, { 1: true });
});

// -- counting ---------------------------------------------------------------------------------------

/** A wallet with a confirmed coin whose block the reader can name: the last part of "Hold some" is a question. */
function answerHoldSome(p: ReturnType<typeof page>): boolean {
  return p.runner.answer('hold-some');
}

test('a finished step is counted by the write that finished it, once, and not before counts are released', () => {
  const p = page({ wallet: funded() });
  p.runner.watch(step('hold-some'), '');
  assert.equal(answerHoldSome(p), true);
  assert.equal(p.note().steps['hold-some']?.doneAt, NOW);
  assert.deepEqual(p.counted, [], 'held back: the settings have not arrived');
  p.runner.release();
  assert.deepEqual(p.counted, ['hold-some']);
  // Released once, it stays released, and nothing is counted twice.
  p.runner.release();
  p.runner.changed();
  assert.equal(answerHoldSome(p), false, 'a done step has no open question');
  assert.deepEqual(p.counted, ['hold-some']);
});

test('two tabs that both see the last part tick count the step once between them', () => {
  const storage = new MemoryStorage();
  const sent = { txid: txid('a1'), toPot: true, at: NOW - 30_000 };
  const waiting = { ...funded(), history: [tx({ tx: 'a1', height: null }), tx({ tx: 'c1', direction: 'received' })] };
  const a = page({ storage, wallet: waiting });
  const b = page({ storage, wallet: waiting });
  a.runner.release();
  b.runner.release();
  a.runner.watch(step('pass-it-on'), '');
  // The payment went out in the first tab, while the step was followed.
  a.publish({ lastSent: sent });
  assert.deepEqual(a.note().steps['pass-it-on']?.parts, { 1: true, 2: true });
  b.runner.watch(HOME, '');
  // The block comes: both tabs read the list and see the payment in it.
  const confirmed = [tx({ tx: 'a1' }), tx({ tx: 'c1', direction: 'received' })];
  a.publish({ history: confirmed });
  b.publish({ history: confirmed });
  assert.equal(a.note().steps['pass-it-on']?.doneAt, NOW);
  assert.deepEqual([a.counted, b.counted], [['pass-it-on'], []]);
});

test('under a newer version\'s note nothing is written, ticked or counted', () => {
  const storage = new MemoryStorage();
  const newer = JSON.stringify({ v: 2, following: 'hold-some', steps: { 'hold-some': { started: true } } });
  storage.map.set(PROGRESS_KEY, newer);
  const p = page({ storage, wallet: funded() });
  p.runner.release();
  p.runner.watch(step('hold-some'), '');
  assert.equal(answerHoldSome(p), false);
  p.runner.restart('hold-some');
  p.runner.stop('hold-some');
  assert.equal(p.runner.forget(), false, 'a newer note is never deleted by this version');
  assert.equal(storage.map.get(PROGRESS_KEY), newer);
  assert.equal(storage.writes, 0);
  assert.deepEqual(p.counted, []);
  assert.deepEqual([p.runner.shown().read, p.runner.shown().kept], ['newer', 'newer']);
  // The parts show as the wallet stands, and the first that needs a tick is blocked.
  assert.deepEqual(p.states('hold-some'), ['ticked', 'ticked', 'ticked', 'blocked: storage']);
});

test('every started step is done and none is followed: no look writes, and the first visit to a step\'s screen takes out of the storage what a read dropped', () => {
  // Left by a hand, another program or a build that was never deployed: ways back that are not the steps' own
  // chapters. A read drops them, and no screen is ever shown them.
  const planted = {
    v: 1,
    following: null,
    steps: {
      'hold-some': { started: true, doneAt: NOW - 9, from: '/u/reader-4f1c9a7e/campaign-77', parts: { 1: true, 2: true, 3: true, 4: true } },
      'pass-it-on': { started: true, doneAt: NOW - 9, from: '/newsletter', parts: { 1: true, 2: true, 3: true } },
    },
  };
  const text = JSON.stringify(planted);
  const hostile = /reader-4f1c9a7e|campaign|newsletter/;
  const storage = new MemoryStorage();
  storage.map.set(PROGRESS_KEY, text);
  const p = page({ storage, wallet: funded() });
  p.runner.release();

  // The page loads, and the reader looks around: Home, the list, About, the wallet's own screens, the tab
  // hidden and shown again, the wallet publishing. Reading never writes: the stored text is as it was planted.
  for (const route of [HOME, LIST, { name: 'about' } as Route, COINS, SEND, { name: 'settings' } as Route]) {
    p.runner.watch(route, '');
    p.runner.visible();
    p.publish({ wordsShown: p.wallet.wordsShown + 1 });
  }
  assert.deepEqual([storage.writes, storage.map.get(PROGRESS_KEY)], [0, text]);
  // What the screens were shown all along is the note without those fields.
  assert.deepEqual(p.runner.shown().progress.steps['hold-some'], { started: true, doneAt: NOW - 9, parts: { 1: true, 2: true, 3: true, 4: true } });
  assert.equal(p.runner.shown().progress.steps['pass-it-on']?.from, undefined);

  // The reader opens a done step's screen. Opening a step's screen has always been what writes; for a done
  // step nothing of the note changes. It is a write all the same, and the dropped text leaves with it.
  p.runner.watch(step('hold-some'), '');
  const after = storage.map.get(PROGRESS_KEY) ?? '';
  assert.equal(storage.writes, 1);
  assert.doesNotMatch(after, hostile);
  assert.deepEqual(JSON.parse(after), {
    v: 1,
    following: null,
    steps: {
      'hold-some': { started: true, doneAt: NOW - 9, parts: { 1: true, 2: true, 3: true, 4: true } },
      'pass-it-on': { started: true, doneAt: NOW - 9, parts: { 1: true, 2: true, 3: true } },
    },
  });
  // Nothing was done again by that write: no step is counted a second time, and none is followed.
  assert.deepEqual(p.counted, []);
  assert.equal(p.note().following, null);
  // And it happens once: the same visit again, and the other done step's screen, write nothing more.
  p.runner.watch(HOME, '');
  p.runner.watch(step('hold-some'), '');
  p.runner.watch(step('pass-it-on'), '');
  p.runner.visible();
  assert.deepEqual([storage.writes, storage.map.get(PROGRESS_KEY)], [1, after]);
});

// -- a done step is let go once it was seen on its own screen ------------------------------------------

test('done on its own screen: the step is let go at once', () => {
  const p = page({ wallet: funded() });
  p.runner.watch(step('hold-some'), '');
  assert.equal(answerHoldSome(p), true);
  assert.equal(p.note().following, null);
  assert.equal(p.note().followedAt, undefined);
});

test('done on another screen: the step stays followed until its screen is opened, or the strip is closed', () => {
  const sent = { txid: txid('a1'), toPot: true, at: NOW - 30_000 };
  const p = page({ wallet: { ...funded(), history: [tx({ tx: 'a1', height: null }), tx({ tx: 'c1', direction: 'received' })] } });
  p.runner.watch(step('pass-it-on'), '');
  p.runner.watch(SEND, '');
  p.publish({ lastSent: sent });
  p.runner.watch({ name: 'tx', txid: txid('a1') }, '');
  p.publish({ history: [tx({ tx: 'a1' }), tx({ tx: 'c1', direction: 'received' })] });
  assert.equal(p.note().steps['pass-it-on']?.doneAt, NOW);
  assert.equal(p.note().following, 'pass-it-on', 'still followed: the strip has to say that it is done');
  // The reader opens the step: seen.
  p.runner.watch(step('pass-it-on'), '');
  assert.equal(p.note().following, null);
});

test('done while the tab is hidden: let go only when the tab is in view again', () => {
  const storage = new MemoryStorage();
  const sent = { txid: txid('a1'), toPot: true, at: NOW - 30_000 };
  const before = { ...funded(), history: [tx({ tx: 'a1', height: null }), tx({ tx: 'c1', direction: 'received' })] };
  const hidden = page({ storage, wallet: before });
  hidden.runner.watch(step('pass-it-on'), '');
  hidden.publish({ lastSent: sent });
  hidden.visible = false;
  hidden.publish({ history: [tx({ tx: 'a1' }), tx({ tx: 'c1', direction: 'received' })] });
  assert.equal(hidden.note().steps['pass-it-on']?.doneAt, NOW);
  assert.equal(hidden.note().following, 'pass-it-on');
  hidden.visible = true;
  hidden.runner.visible();
  assert.equal(hidden.note().following, null);
});

// -- the tab comes back into view -------------------------------------------------------------------------

test('back in view on a step\'s screen, the step is followed again; on any other screen nothing is written', () => {
  const p = page();
  p.runner.watch(step('hold-some'), '');
  p.runner.stop('hold-some');
  assert.equal(p.note().following, null);
  p.now += 9_000;
  p.runner.visible();
  assert.deepEqual([p.note().following, p.note().followedAt], ['hold-some', NOW + 9_000]);
  p.runner.watch(HOME, '');
  const writes = p.storage.writes;
  p.now += 9_000;
  p.runner.visible();
  assert.equal(p.storage.writes, writes);
});

test('the note forgotten in another tab under an open step: the step is opened again when its tab is back in view, and not before', () => {
  const storage = new MemoryStorage();
  const first = page({ storage, wallet: funded() });
  first.runner.watch(step('pass-it-on'), '?from=/journey/how-bitcoin-works');
  assert.deepEqual(first.states('pass-it-on'), ['ticked', 'now', 'later']);
  // Another tab comes to the front, and the reader forgets the lot there.
  first.visible = false;
  const second = page({ storage, wallet: funded() });
  second.runner.watch(LIST, '');
  assert.equal(second.runner.forget(), true);
  // The first tab hears of it (a "storage" event). Nobody is looking at it: it does not undo what the reader has just chosen.
  const writes = storage.writes;
  first.runner.changed();
  assert.equal(storage.writes, writes);
  assert.equal(storage.map.has(PROGRESS_KEY), false);
  assert.deepEqual(first.states('pass-it-on'), ['later', 'later', 'later'], 'a step that is not started: nothing on its screen can be done');
  // Back on the step's screen: that is what starts a step. It is started and followed again, with the way back
  // the address still names, and what the wallet already meets ticks in the same call.
  first.visible = true;
  first.now += 5_000;
  first.runner.visible();
  assert.deepEqual(first.note(), {
    v: 1,
    following: 'pass-it-on',
    followedAt: NOW + 5_000,
    steps: { 'pass-it-on': { started: true, from: '/journey/how-bitcoin-works', parts: { 1: true } } },
  });
  assert.deepEqual(first.states('pass-it-on'), ['ticked', 'now', 'later']);
  // On any other screen coming back into view still writes nothing, note or no note.
  const elsewhere = page({ wallet: funded() });
  elsewhere.runner.watch(COINS, '');
  elsewhere.runner.visible();
  assert.equal(elsewhere.storage.writes, 0);
  // And under a newer version's note the step's screen writes nothing either.
  const newer = new MemoryStorage();
  const old = page({ storage: newer, wallet: funded() });
  old.runner.watch(step('pass-it-on'), '');
  newer.map.set(PROGRESS_KEY, JSON.stringify({ v: 2, following: null, steps: {} }));
  const before = newer.writes;
  old.runner.visible();
  assert.equal(newer.writes, before);
  assert.equal(newer.map.get(PROGRESS_KEY), JSON.stringify({ v: 2, following: null, steps: {} }));
});

// -- what the reader does to the progress itself ------------------------------------------------------------

test('"Stop following" and the step\'s action link: only the followed step changes', () => {
  const p = page();
  p.runner.watch(step('hold-some'), '');
  p.runner.stop('the-seed');
  assert.equal(p.note().following, 'hold-some', 'another step\'s stop changes nothing');
  p.runner.stop('hold-some');
  assert.equal(p.note().following, null);
  p.now += 1_000;
  p.runner.follow('hold-some');
  assert.deepEqual([p.note().following, p.note().followedAt], ['hold-some', NOW + 1_000]);
  // A step that was never started is not followed by a link.
  p.runner.follow('the-seed');
  assert.equal(p.note().following, 'hold-some');
});

test('a detour is written through the one write, and not under a newer note or a storage that refuses', () => {
  const CARD = '?from=/journey/how-bitcoin-works';
  // A reader with no wallet arrives on "Pass it on" by its card in chapter 3, and presses the link of its need,
  // which leads to "Hold some".
  const p = page();
  p.runner.release();
  p.runner.watch(step('pass-it-on'), CARD);
  const writes = p.storage.writes;
  const told = p.published.length;
  p.runner.detour('hold-some', 'pass-it-on');
  assert.equal(
    p.storage.map.get(PROGRESS_KEY),
    '{"v":1,"following":"pass-it-on","followedAt":1800000000000,"steps":{"hold-some":{"cameFor":"pass-it-on"},"pass-it-on":{"started":true,"from":"/journey/how-bitcoin-works"}}}',
  );
  assert.equal(p.storage.writes, writes + 1, 'one write, of the one value');
  assert.deepEqual([...p.storage.map.keys()], [PROGRESS_KEY]);
  // The world was looked at again, so the screens are told of the note as it now stands.
  assert.ok(p.published.length > told);
  assert.deepEqual(p.published.at(-1)?.progress.steps['hold-some'], { cameFor: 'pass-it-on' });
  assert.deepEqual(p.runner.shown().progress, p.note());
  // The same press again writes nothing.
  p.runner.detour('hold-some', 'pass-it-on');
  assert.equal(p.storage.writes, writes + 1);
  // The link is followed: "Hold some" opens, is started and followed, and keeps what the press noted.
  p.now += 1_000;
  p.runner.watch(step('hold-some'), '');
  assert.deepEqual(p.note().steps['hold-some'], { started: true, cameFor: 'pass-it-on' });
  assert.deepEqual([p.note().following, p.note().followedAt], ['hold-some', NOW + 1_000]);
  // Nothing of it is counted: no step was finished.
  assert.deepEqual(p.counted, []);

  // A reader who opened "Pass it on" from the wallet's own list: the press is no change, and nothing is written.
  const listed = page();
  listed.runner.watch(step('pass-it-on'), '');
  const before = listed.storage.writes;
  listed.runner.detour('hold-some', 'pass-it-on');
  assert.equal(listed.storage.writes, before);
  assert.deepEqual(listed.note().steps, { 'pass-it-on': { started: true } });

  // Under a newer version's note nothing is written, as for every change.
  const kept = new MemoryStorage();
  const newer = JSON.stringify({ v: 2, following: 'pass-it-on', steps: { 'pass-it-on': { started: true, from: '/journey/how-bitcoin-works' } } });
  kept.map.set(PROGRESS_KEY, newer);
  const n = page({ storage: kept });
  n.runner.release();
  n.runner.watch(step('pass-it-on'), CARD);
  n.runner.detour('hold-some', 'pass-it-on');
  assert.equal(kept.map.get(PROGRESS_KEY), newer);
  assert.equal(kept.writes, 0);
  assert.equal(n.runner.shown().kept, 'newer');

  // A browser that refuses the write: the stored note is as it was, and the page says that progress cannot be kept here.
  const full = new FullStorage();
  full.full = false;
  const f = page({ storage: full });
  f.runner.release();
  f.runner.watch(step('pass-it-on'), CARD);
  const stored = full.map.get(PROGRESS_KEY);
  assert.equal(f.runner.shown().kept, 'yes');
  full.full = true;
  f.runner.detour('hold-some', 'pass-it-on');
  assert.equal(full.map.get(PROGRESS_KEY), stored);
  assert.equal(f.runner.shown().kept, 'no');
  // A storage that cannot be read at all: nothing is read, nothing is written, and nothing throws.
  const blocked = page({ storage: new BlockedStorage() });
  blocked.runner.release();
  blocked.runner.watch(step('pass-it-on'), CARD);
  blocked.runner.detour('hold-some', 'pass-it-on');
  assert.deepEqual([blocked.runner.shown().read, blocked.runner.shown().kept], ['blocked', 'no']);
  // And in none of them was anything counted.
  assert.deepEqual([listed.counted, n.counted, f.counted, blocked.counted], [[], [], [], []]);
});

test('"Start this step again" unticks the step, keeps its way back, and forgets the wait this page remembered', () => {
  const sent = { txid: txid('a1'), toPot: false, at: NOW - 20_000 };
  const p = page({ wallet: { ...funded(), history: [tx({ tx: 'a1', height: null }), tx({ tx: 'c1', direction: 'received' })] } });
  p.runner.watch(step('waiting-room'), '?from=/journey/how-bitcoin-works');
  p.publish({ lastSent: sent });
  p.publish({ history: [tx({ tx: 'a1', height: 199, time: Math.floor((NOW - 8_000) / 1000) }), tx({ tx: 'c1', direction: 'received' })] });
  assert.deepEqual(p.runner.shown().waited['waiting-room'], { height: 199, seconds: 12 });
  assert.deepEqual(p.note().steps['waiting-room']?.parts, { 1: true, 2: true });
  p.now += 1_000;
  assert.equal(p.runner.restart('waiting-room'), true);
  assert.deepEqual(p.note().steps['waiting-room'], { started: true, from: '/journey/how-bitcoin-works' });
  assert.equal(p.runner.shown().waited['waiting-room'], undefined);
  // The payment from before the restart does not count for the new try.
  p.runner.changed();
  assert.deepEqual(p.states('waiting-room'), ['now', 'later', 'later']);
});

test('"Forget my progress" deletes the note and nothing else, and what happened before it counts for nothing later', () => {
  const storage = new MemoryStorage();
  storage.map.set(RECORD_KEY, 'the wallet');
  const p = page({ storage, wallet: { ...funded(), lastSent: { txid: txid('a1'), toPot: false, at: NOW } } });
  p.runner.watch(step('waiting-room'), '');
  assert.equal(p.runner.forget(), true);
  assert.deepEqual([...storage.map.keys()], [RECORD_KEY]);
  assert.deepEqual(p.published.at(-1), { read: 'none', progress: { v: 1, following: null, steps: {} }, kept: 'yes', waited: {}, listAt: NOW });
  // Nothing is written again until a step's screen is opened.
  p.runner.changed();
  p.runner.watch(HOME, '');
  assert.deepEqual([...storage.map.keys()], [RECORD_KEY]);
  p.runner.watch(step('waiting-room'), '');
  assert.deepEqual(p.states('waiting-room'), ['now', 'later', 'later']);
});

test('"Send another" clears the noted payment, and the next one sent while the step is followed takes its place', () => {
  const p = page({ wallet: funded() });
  p.runner.watch(step('waiting-room'), '');
  p.publish({ lastSent: { txid: txid('a1'), toPot: false, at: NOW } });
  p.runner.sendAnother('waiting-room');
  assert.deepEqual(p.note().steps['waiting-room'], { started: true, parts: { 1: true } });
  assert.deepEqual(p.states('waiting-room'), ['ticked', 'blocked: nothing-sent', 'later']);
  p.now += 4_000;
  p.publish({ lastSent: { txid: txid('b2'), toPot: false, at: p.now } });
  assert.deepEqual(p.note().steps['waiting-room'], { started: true, tx: txid('b2'), sentAt: p.now, parts: { 1: true } });
});

// -- questions and the reader's word ---------------------------------------------------------------------------

test('answer(): ticks the open question or box, and nothing when the open part is something else', () => {
  const p = page({ wallet: world({ wordsShown: 0 }).wallet });
  p.runner.watch(step('the-seed'), '');
  // The open part is "show the 12 words", which no answer ticks.
  assert.equal(p.runner.answer('the-seed'), false);
  p.runner.watch({ name: 'backup' }, '');
  p.publish({ wordsShown: 1 });
  p.runner.watch(step('the-seed'), '');
  // The box, then the three words: each answer ticks one part, and the last one notes the wallet.
  assert.equal(p.runner.answer('the-seed'), true);
  assert.deepEqual(p.note().steps['the-seed']?.parts, { 1: true, 2: true });
  assert.equal(p.runner.answer('the-seed'), true);
  assert.deepEqual(p.note().steps['the-seed'], { started: true, doneAt: NOW, wallet: FP, parts: { 1: true, 2: true, 3: true } });
  // Checked again for the wallet that is here: the note names it.
  assert.equal(p.runner.recheck(), true);
  p.publish({ status: 'none', record: null });
  assert.equal(p.runner.recheck(), false, 'no wallet is here to check for');
});

// -- a browser that refuses ---------------------------------------------------------------------------------------

test('a refused write: progress cannot be kept here, and is kept again once a write goes through', () => {
  const storage = new FullStorage();
  const p = page({ storage, wallet: funded() });
  p.runner.release();
  p.runner.watch(step('hold-some'), '');
  assert.equal(storage.map.size, 0);
  assert.deepEqual([p.runner.shown().read, p.runner.shown().kept], ['none', 'no']);
  // As the wallet stands: three states hold, and the question cannot be ticked.
  assert.deepEqual(p.states('hold-some'), ['ticked', 'ticked', 'ticked', 'blocked: storage']);
  assert.equal(answerHoldSome(p), false);
  assert.deepEqual(p.counted, []);
  // The browser takes writes again: the next opening is written, and so is what the wallet satisfies.
  storage.full = false;
  p.runner.watch(HOME, '');
  p.runner.watch(step('hold-some'), '');
  assert.equal(p.runner.shown().kept, 'yes');
  assert.deepEqual(p.note().steps['hold-some']?.parts, { 1: true, 2: true, 3: true });
});

test('a browser that will not store anything, or whose storage cannot be read: nothing is written', () => {
  const none = page({ wallet: funded(), canStore: false });
  none.runner.watch(step('hold-some'), '');
  // The opening itself is still tried: only the browser can say no. Nothing else is.
  assert.equal(none.runner.shown().kept, 'no');
  const blocked = page({ storage: new BlockedStorage(), wallet: funded() });
  blocked.runner.watch(step('hold-some'), '');
  assert.deepEqual([blocked.runner.shown().read, blocked.runner.shown().kept], ['blocked', 'no']);
  assert.equal(blocked.runner.forget(), false);
  assert.deepEqual(blocked.states('hold-some'), ['ticked', 'ticked', 'ticked', 'blocked: storage']);
});

// -- another tab ------------------------------------------------------------------------------------------------------

test('a payment sent in a second tab is ticked by that tab, and the tab with the step open learns of it', () => {
  const storage = new MemoryStorage();
  const stepTab = page({ storage, wallet: funded() });
  const sendTab = page({ storage, wallet: funded() });
  stepTab.runner.watch(step('waiting-room'), '');
  sendTab.runner.watch(SEND, '');
  sendTab.now += 3_000;
  sendTab.publish({ lastSent: { txid: txid('a1'), toPot: false, at: sendTab.now } });
  assert.deepEqual(sendTab.note().steps['waiting-room']?.parts, { 1: true });
  // The storage event reaches the first tab: it reads the note again, and shows the tick.
  assert.deepEqual(stepTab.runner.shown().progress.steps['waiting-room']?.parts, { 1: true });
  const told = stepTab.published.length;
  stepTab.runner.changed();
  assert.equal(stepTab.published.length, told + 1);
  assert.deepEqual(stepTab.published.at(-1)?.progress.steps['waiting-room'], { started: true, tx: txid('a1'), sentAt: NOW + 3_000, parts: { 1: true } });
});

// -- the list of transactions, and when it was read -----------------------------------------------------------------------

test('a list read before the payment was sent says nothing about the payment: not waiting, not lost', () => {
  // The step's screen read the list; the reader went to Send, where the wallet does not read it, and paid.
  const p = page({ wallet: funded() });
  p.runner.watch(step('waiting-room'), '');
  assert.equal(p.runner.shown().listAt, NOW);
  p.runner.watch(SEND, '');
  p.now += 10_000;
  p.publish({ lastSent: { txid: txid('a1'), toPot: false, at: p.now } });
  const sentAt = p.now;
  assert.deepEqual(p.states('waiting-room'), ['ticked', 'unknown: history', 'later']);
  // Three minutes on, still on Send, with the same old list: still not "lost".
  p.now += LOST_MS + 60_000;
  p.runner.changed();
  assert.deepEqual(p.states('waiting-room'), ['ticked', 'unknown: history', 'later']);
  // Back on the step's screen the wallet reads the list again. It holds the payment, in a block: ticked.
  p.runner.watch(step('waiting-room'), '');
  p.publish({ history: [tx({ tx: 'a1', height: 199 }), tx({ tx: 'c1', direction: 'received' })] });
  assert.equal(p.runner.shown().listAt, p.now);
  assert.deepEqual(p.note().steps['waiting-room']?.parts, { 1: true, 2: true });
  assert.ok(sentAt < p.now);
});

test('a list read after the payment was sent, without it: waiting for two minutes, and lost in a list read later than that', () => {
  const p = page({ wallet: funded() });
  p.runner.watch(step('waiting-room'), '');
  p.publish({ lastSent: { txid: txid('a1'), toPot: false, at: p.now } });
  // Read a moment later, and the network has not listed the payment yet.
  p.now += 2_000;
  p.publish({ history: [tx({ tx: 'c1', direction: 'received' })] });
  assert.deepEqual(p.view('waiting-room').parts[1], { state: 'now', txid: txid('a1'), waiting: { txid: txid('a1'), sentAt: NOW, lost: false }, confirmations: null, unlock: false });
  // The clock alone does not lose a payment: that list was read two seconds after it was sent.
  p.now += LOST_MS + 60_000;
  p.runner.changed();
  assert.equal((p.view('waiting-room').parts[1] as { waiting: { lost: boolean } }).waiting.lost, false);
  // A list read now, without it, does.
  p.publish({ history: [tx({ tx: 'c1', direction: 'received' })] });
  assert.equal((p.view('waiting-room').parts[1] as { waiting: { lost: boolean } }).waiting.lost, true);
});

test('a noted payment whose time lies far ahead of the clock is not waited for: the part says so, and offers "Send another"', () => {
  // A note edited by hand, or a clock that was set back since: taken as it stands, every list
  // would count as read "before" the payment, and the part would stay at "not known yet" for good.
  const ahead = (by: number) => ({
    v: 1 as const,
    following: 'waiting-room' as const,
    steps: { 'waiting-room': { started: true as const, tx: txid('a1'), sentAt: NOW + by, parts: { 1: true as const } } },
  });
  const coins = chain(state([{ tx: 'c1', sats: 50_000 }]));
  const hour = world({ chain: coins, history: [], note: ahead(3_600_000) });
  assert.deepEqual(judge('waiting-room', { ...hour, listAt: NOW - 5_000 }).parts[1], {
    state: 'now',
    txid: txid('a1'),
    waiting: { txid: txid('a1'), sentAt: null, lost: true },
    confirmations: null,
    unlock: false,
  });
  // In the list after all, it is waited for like any payment; only the moment it was sent is not said.
  const listed = world({ chain: coins, history: [tx({ tx: 'a1', height: null })], note: ahead(3_600_000) });
  assert.deepEqual(judge('waiting-room', listed).parts[1], { state: 'now', txid: txid('a1'), waiting: { txid: txid('a1'), sentAt: null, lost: false }, confirmations: null, unlock: false });
  // A little ahead is ordinary: the strip reads its clock twice a minute, and a payment sent since
  // its last look is no lost one. It is "not known yet" until a list is read after it was sent.
  const moment = world({ chain: coins, history: [], note: ahead(20_000) });
  assert.deepEqual(judge('waiting-room', { ...moment, listAt: NOW - 5_000 }).parts[1], { state: 'unknown', reason: 'history' });
  assert.deepEqual(judge('waiting-room', { ...moment, now: NOW + 25_000, listAt: NOW + 21_000 }).parts[1], {
    state: 'now',
    txid: txid('a1'),
    waiting: { txid: txid('a1'), sentAt: NOW + 20_000, lost: false },
    confirmations: null,
    unlock: false,
  });
});

test('judge(): with nobody saying when the list was read, it is taken as read just now', () => {
  const note = { v: 1 as const, following: 'waiting-room' as const, steps: { 'waiting-room': { started: true as const, tx: txid('a1'), sentAt: NOW - LOST_MS - 1, parts: { 1: true as const } } } };
  const seen = world({ chain: chain(state([{ tx: 'c1', sats: 50_000 }])), history: [], note });
  assert.deepEqual(judge('waiting-room', seen).parts[1], { state: 'now', txid: txid('a1'), waiting: { txid: txid('a1'), sentAt: NOW - LOST_MS - 1, lost: true }, confirmations: null, unlock: false });
  // Told that the list is older than the payment, it knows nothing of it.
  assert.deepEqual(judge('waiting-room', { ...seen, listAt: NOW - LOST_MS - 2 }).parts[1], { state: 'unknown', reason: 'history' });
  // Read at the very moment the payment was sent, it may hold it: the payment is waiting.
  assert.equal(judge('waiting-room', { ...seen, listAt: NOW - LOST_MS - 1 }).parts[1]?.state, 'now');
  assert.equal(record().fingerprint, FP);
});
