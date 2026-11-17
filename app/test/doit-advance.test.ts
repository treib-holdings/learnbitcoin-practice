// What to write and what to count when the world changes
// (src/lib/doit/advance.ts), on pairs of worlds: the world a moment ago and
// the world now.
//
// Some tests look at the changes advance() answers with. Others play them
// the way the glue will: each change goes through the one write function
// into a storage (a Map), and the next world holds the note as it stands
// there. So what is proved is what ends up stored.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STEPS, type StepId } from '@learnbitcoin/practice-contract';
import { advance, answered, counted, rechecked } from '../src/lib/doit/advance.ts';
import { answerCoins, judge, type World } from '../src/lib/doit/judge.ts';
import { applyChange, emptyProgress, readProgress, writeProgress, type Change, type Progress, type StepNote } from '../src/lib/doit/progress.ts';
import { STEP_DEFS, partCount } from '../src/lib/doit/steps.ts';
import type { LastSent } from '../src/lib/wallet-api.ts';
import { FP, NOW, OTHER_FP, TIP, chain, change, frozen, noWallet, note, record, started, state, ticks, tx, txid, world, type WorldSpec } from './doit-worlds.ts';
import { MemoryStorage } from './engine-fakes.ts';

const tick = (step: StepId, part: number, at = NOW, extra: Partial<Extract<Change, { kind: 'tick' }>> = {}): Change => ({ kind: 'tick', step, part, at, ...extra });

/** The changes advance() answers with, and nothing else of its answer. */
const changes = (before: World | null, after: World): Change[] => advance(before, after).changes;

/** A note after these changes, applied one on top of the other. */
const after = (progress: Progress, ...list: Change[]): Progress => list.reduce(applyChange, progress);

/** A payment this page sent. */
const paid = (tag: string, toPot = false, at = NOW - 1_000): LastSent => ({ txid: txid(tag), toPot, at });

/**
 * The glue, played: a page with a storage. see() is told the world as it is
 * now (everything but the note, which is read from the storage), asks
 * advance() what follows from the change, and writes it.
 */
function page(storage = new MemoryStorage()) {
  let before: World | null = null;
  const countedSteps: StepId[] = [];
  const read = (): Progress => readProgress(storage as Storage).progress;
  /** One change through the one write. What it finishes is counted. */
  const write = (one: Change): void => {
    const result = writeProgress(storage as Storage, one);
    assert.ok(result.ok, JSON.stringify(one));
    countedSteps.push(...counted(result.read, result.progress));
  };
  return {
    storage,
    counted: countedSteps,
    note: read,
    step: (id: StepId): StepNote | undefined => read().steps[id],
    write,
    /** The reader opens a step's screen. */
    open(id: StepId, at = NOW): void {
      write({ kind: 'open', step: id, at, from: null });
    },
    /** The world changed. Returns what advance() said to write. */
    see(spec: WorldSpec): Change[] {
      const now = world({ ...spec, note: read() });
      const plan = advance(before, now);
      for (const one of plan.changes) write(one);
      // What the page holds as "the world before" is the world it just saw, with the note as it now stands.
      before = { ...now, note: read() };
      return plan.changes;
    },
    /** The world as the page last saw it. */
    last: (): World => {
      assert.ok(before);
      return before;
    },
  };
}

const FUNDED = chain(state([{ tx: 'c1', sats: 100_000, height: 150 }]));
const RECEIVED = [tx({ tx: 'c1', direction: 'received', height: 150 })];

// -- nothing to do ------------------------------------------------------------------------

test('while no step is started, no change of the world writes anything', () => {
  const worlds: World[] = [
    noWallet(),
    world(),
    world({ chain: chain(state([{ tx: 'c1', sats: 100_000, height: null }])) }),
    world({ chain: FUNDED, history: RECEIVED, route: { name: 'coins' } }),
    world({ chain: FUNDED, history: [tx({ tx: 'a1' }), ...RECEIVED], route: { name: 'tx', txid: txid('a1') }, lastSent: paid('a1', true), wordsShown: 4 }),
    noWallet({ route: { name: 'do' } }),
    world({ status: 'unreadable', record: null }),
    world({ status: 'blocked', record: null }),
  ];
  for (const before of [null, ...worlds]) {
    for (const now of worlds) assert.deepEqual(advance(before, now), { changes: [], waited: {} });
  }
  // A step that is done, and one whose way back alone is noted, are not started either.
  const kept = note({ 'hold-some': started(3, { doneAt: NOW }), 'the-seed': { from: '/journey/be-your-own-bank' } }, 'hold-some');
  for (const before of [null, ...worlds]) {
    for (const now of worlds) assert.deepEqual(changes(before === null ? null : { ...before, note: kept }, { ...now, note: kept }), []);
  }
});

test('where nothing can be written, nothing is ticked: a refusing browser, and a newer version\'s note', () => {
  const started4 = note({ 'hold-some': started(0), 'waiting-room': started(0) }, 'waiting-room');
  const before = world({ note: started4 });
  const now = world({ note: started4, chain: FUNDED, history: RECEIVED, lastSent: paid('a1') });
  assert.ok(changes(before, now).length > 0, 'here there is something to tick');
  for (const kept of ['no', 'newer'] as const) {
    assert.deepEqual(advance(before, { ...now, kept }), { changes: [], waited: {} }, kept);
    assert.deepEqual(advance(null, { ...now, kept }), { changes: [], waited: {} }, kept);
    assert.equal(answered('hold-some', { ...now, kept }), null);
    assert.equal(rechecked({ ...now, kept }), null);
  }
});

// -- states -------------------------------------------------------------------------------

test('states tick in order, as many as hold, in one go: a step opened on a wallet that already has a confirmed coin', () => {
  const p = page();
  p.open('hold-some');
  // The page's first world: no world before it. States are judged all the same.
  const written = p.see({ chain: FUNDED, history: RECEIVED, route: { name: 'step', id: 'hold-some' } });
  assert.deepEqual(written, [tick('hold-some', 1), tick('hold-some', 2), tick('hold-some', 3)]);
  // The three states are the whole step: the last of them finishes it, at the moment of that look, and the
  // write that put the moment into the note is the one the step is counted by.
  assert.deepEqual(p.step('hold-some'), started(3, { doneAt: NOW }));
  assert.deepEqual(p.counted, ['hold-some']);
  // Nothing is left for the reader to answer, and a later look writes and counts nothing more.
  assert.equal(answered('hold-some', p.last()), null);
  assert.deepEqual(p.see({ chain: FUNDED, history: RECEIVED }), []);
  assert.deepEqual(p.counted, ['hold-some']);
  // On another screen, with the list of transactions not read at all, it is the same: no part of the step
  // rests on the list.
  const q = page();
  q.open('hold-some');
  assert.deepEqual(q.see({ chain: FUNDED, history: null, route: { name: 'receive' } }), [tick('hold-some', 1), tick('hold-some', 2), tick('hold-some', 3)]);
  assert.deepEqual(q.step('hold-some'), started(3, { doneAt: NOW }));
  assert.deepEqual(q.counted, ['hold-some']);
});

test('each state of the wallet ticks at the first change in which it holds, with no move and no reload', () => {
  const p = page();
  const here: WorldSpec = { route: { name: 'step', id: 'hold-some' } };
  p.open('hold-some');
  assert.deepEqual(p.see({ ...here, status: 'none', record: null }), []);
  // A wallet is made.
  assert.deepEqual(p.see({ ...here, chain: chain(null), history: null }), [tick('hold-some', 1)]);
  // Its first look finds nothing; then a coin arrives and waits.
  assert.deepEqual(p.see({ ...here }), []);
  assert.deepEqual(p.see({ ...here, chain: chain(state([{ tx: 'c1', sats: 100_000, height: null }])) }), [tick('hold-some', 2)]);
  // Only an unconfirmed coin: the third part stays open, however often the world changes.
  for (let round = 0; round < 3; round++) {
    assert.deepEqual(p.see({ ...here, chain: chain(state([{ tx: 'c1', sats: 100_000, height: null }]), { checkedAt: NOW + round }), now: NOW + round }), []);
  }
  assert.deepEqual(p.step('hold-some'), started(2));
  assert.deepEqual(p.counted, []);
  // A block takes it in: the third tick, which finishes the step at that moment.
  assert.deepEqual(p.see({ ...here, chain: FUNDED, history: RECEIVED, now: NOW + 30_000 }), [tick('hold-some', 3, NOW + 30_000)]);
  assert.deepEqual(p.step('hold-some'), started(3, { doneAt: NOW + 30_000 }));
  assert.deepEqual(p.counted, ['hold-some']);
  // Nothing more by itself, and nothing twice.
  assert.deepEqual(p.see({ ...here, chain: FUNDED, history: RECEIVED, now: NOW + 60_000 }), []);
});

test('a state ticks on any screen, for every started step, whether or not it is the one followed', () => {
  const p = page();
  p.open('pass-it-on');
  p.open('hold-some');
  p.open('the-seed');
  assert.equal(p.note().following, 'the-seed');
  // On the Receive screen, with a wallet that holds nothing yet: hold-some's first part, though the-seed is the one followed.
  assert.deepEqual(p.see({ route: { name: 'receive' } }), [tick('hold-some', 1)]);
  // A coin arrives and confirms: hold-some and pass-it-on tick, neither of them followed.
  const written = p.see({ route: { name: 'receive' }, chain: FUNDED });
  // In the contract's order of steps, each step's parts in their own order.
  assert.deepEqual(written, [tick('hold-some', 2), tick('hold-some', 3), tick('pass-it-on', 1)]);
  // "Hold some" is done by that, on the Receive screen, while another step is the one followed.
  assert.deepEqual(p.step('hold-some'), started(3, { doneAt: NOW }));
  assert.deepEqual(p.counted, ['hold-some']);
  assert.deepEqual(p.step('pass-it-on'), started(1));
  assert.equal(p.note().following, 'the-seed', 'and the followed step is still the followed step');
  // The time it was followed moves only with a tick of the followed step.
  assert.equal(p.note().followedAt, NOW);
});

test('trouble with the stored wallet, and facts that are not known, tick nothing', () => {
  const begun = note({ 'hold-some': started(0), 'pass-it-on': started(0), 'prove-the-backup': started(2, { wallet: FP, was: 'words' }) }, 'hold-some');
  // The last of the four: the browser stopped letting the page read its storage. Nothing is known of the wallet then.
  for (const spec of [{ status: 'unreadable', record: null }, { status: 'newer', record: null }, { status: 'broken', record: null }, { status: 'blocked', record: null }] as WorldSpec[]) {
    assert.deepEqual(changes(world({ note: begun }), world({ ...spec, note: begun })), [], String(spec.status));
  }
  // The first look is still running, or failed: a wallet is here (hold-some part 1), and nothing is known of its coins.
  for (const coins of [chain(null), chain(null, { error: 'network' })]) {
    assert.deepEqual(changes(null, world({ note: begun, chain: coins, history: null })), [tick('hold-some', 1), tick('prove-the-backup', 3)]);
  }
});

// -- events: a payment --------------------------------------------------------------------

test('pass-it-on: a payment to the pot, sent while the step is followed, is noted with its ID and its moment', () => {
  const p = page();
  p.open('pass-it-on');
  p.see({ chain: FUNDED, route: { name: 'step', id: 'pass-it-on' } });
  assert.deepEqual(p.step('pass-it-on'), started(1));

  // On the Send screen, "Pass it on" and Broadcast. The coins are spent; what is left is change that waits.
  const spent = chain(state([{ tx: 'a1', sats: 79_718, change: true, height: null }]));
  const sent = paid('a1', true, NOW + 40_000);
  const written = p.see({ chain: spent, route: { name: 'send' }, lastSent: sent, now: NOW + 40_001 });
  assert.deepEqual(written, [tick('pass-it-on', 2, NOW + 40_001, { tx: txid('a1'), sentAt: NOW + 40_000 })]);
  assert.deepEqual(p.step('pass-it-on'), started(2, { tx: txid('a1'), sentAt: NOW + 40_000 }));
  assert.equal(p.note().followedAt, NOW + 40_001, 'a part of the followed step was ticked');

  // The list shows it, still waiting: nothing. Then a block takes it in: the last part, and the step is done.
  assert.deepEqual(p.see({ chain: spent, lastSent: sent, history: [tx({ tx: 'a1', height: null })], route: { name: 'step', id: 'pass-it-on' }, now: NOW + 45_000 }), []);
  const confirmed = [tx({ tx: 'a1', height: TIP + 1, time: (NOW + 62_000) / 1000 })];
  const plan = advance(p.last(), world({ note: p.note(), chain: spent, lastSent: sent, history: confirmed, now: NOW + 70_000 }));
  assert.deepEqual(plan.changes, [tick('pass-it-on', 3, NOW + 70_000)]);
  // Kept for the page's memory, and never written: how long it waited, by the block's own time.
  assert.deepEqual(plan.waited, { 'pass-it-on': { height: TIP + 1, seconds: 22 } });
  p.see({ chain: spent, lastSent: sent, history: confirmed, now: NOW + 70_000 });
  // Done at that moment. The payment and its moment are deleted from the note.
  assert.deepEqual(p.step('pass-it-on'), { started: true, doneAt: NOW + 70_000, parts: ticks(1, 2, 3) });
  assert.deepEqual(p.counted, ['pass-it-on']);
  // It stays done after "Send all", a removal and whatever else.
  for (const spec of [{ chain: chain(state()) }, { status: 'none', record: null }, { lastSent: paid('b2', true), chain: FUNDED }] as WorldSpec[]) {
    assert.deepEqual(p.see(spec), []);
  }
  assert.deepEqual(p.counted, ['pass-it-on'], 'counted once');
});

test('pass-it-on with "Send all": no coin is left to spend, and the step still gets done', () => {
  const p = page();
  p.open('pass-it-on');
  p.see({ chain: FUNDED });
  // Everything went to the pot: no change, no coin, nothing spendable.
  const empty = chain(state([], 1));
  p.see({ chain: empty, lastSent: paid('a1', true), route: { name: 'send' } });
  assert.deepEqual(p.step('pass-it-on'), started(2, { tx: txid('a1'), sentAt: NOW - 1_000 }));
  p.see({ chain: empty, lastSent: paid('a1', true), history: [tx({ tx: 'a1' })] });
  assert.equal(p.step('pass-it-on')?.doneAt, NOW);
});

test('a payment that is not to the pot does nothing for pass-it-on, and a payment counts only for the step that is followed', () => {
  const begun = note({ 'pass-it-on': started(1), 'waiting-room': started(0) }, 'pass-it-on');
  const before = world({ note: begun, chain: FUNDED });
  // To an address that is not the pot's.
  assert.deepEqual(changes(before, change(before, { lastSent: paid('a1', false) })), []);
  // To the pot: pass-it-on, the followed step, and not waiting-room, which is only started.
  assert.deepEqual(changes(before, change(before, { lastSent: paid('a1', true) })), [tick('pass-it-on', 2, NOW, { tx: txid('a1'), sentAt: NOW - 1_000 })]);

  // The other way round: waiting-room is followed, and takes any payment. pass-it-on gets nothing, to the pot or not.
  const other: World = { ...before, note: { ...begun, following: 'waiting-room' } };
  for (const toPot of [true, false]) {
    assert.deepEqual(changes(other, change(other, { lastSent: paid('a1', toPot) })), [tick('waiting-room', 1, NOW, { tx: txid('a1'), sentAt: NOW - 1_000 })], String(toPot));
  }
  // No step is followed (the reader pressed "Stop following"): a payment is nobody's.
  const nobody: World = { ...before, note: { ...begun, following: null } };
  assert.deepEqual(changes(nobody, change(nobody, { lastSent: paid('a1', true) })), []);
  // A step that was never opened is followed by nobody's note: not started, nothing.
  const stray: World = { ...before, note: { v: 1, following: 'waiting-room', steps: {} } };
  assert.deepEqual(changes(stray, change(stray, { lastSent: paid('a1', true) })), []);
});

test('the followed step changed, the last payment did not: waiting-room is not ticked by the payment pass-it-on was done with', () => {
  const p = page();
  p.open('pass-it-on');
  p.see({ chain: FUNDED });
  const sent = paid('a1', true);
  const left = chain(state([{ tx: 'a1', sats: 79_718, change: true }]));
  p.see({ chain: left, lastSent: sent });
  p.see({ chain: left, lastSent: sent, history: [tx({ tx: 'a1' })] });
  assert.equal(p.step('pass-it-on')?.doneAt, NOW);

  // In the same page, with no new payment, the reader opens waiting-room: the step followed is another
  // one now, and the page's last payment is the same payment it was.
  p.open('waiting-room', NOW + 5_000);
  assert.equal(p.note().following, 'waiting-room');
  const written = p.see({ chain: left, lastSent: sent, history: [tx({ tx: 'a1' })], route: { name: 'step', id: 'waiting-room' }, now: NOW + 5_000 });
  assert.deepEqual(written, []);
  assert.deepEqual(p.step('waiting-room'), { started: true });
  // However the world goes on changing around that same payment.
  for (const route of [{ name: 'send' }, { name: 'tx', txid: txid('a1') }, { name: 'step', id: 'waiting-room' }] as World['route'][]) {
    assert.deepEqual(p.see({ chain: left, lastSent: sent, history: [tx({ tx: 'a1' })], route, now: NOW + 9_000 }), []);
  }
  // The pair of worlds itself, said plainly: the note's followed step differs, lastSent is one and the same object.
  const one = world({ chain: left, lastSent: sent, note: note({ 'pass-it-on': started(3, { doneAt: NOW }), 'waiting-room': started(0) }, 'pass-it-on') });
  const two: World = { ...one, note: { ...one.note, following: 'waiting-room' } };
  assert.equal(one.wallet.lastSent, two.wallet.lastSent);
  assert.deepEqual(changes(one, two), []);
  // And a copy of it with the same ID is still the same payment.
  assert.deepEqual(changes(one, change(two, { lastSent: { ...sent } })), []);
  assert.deepEqual(changes(one, change(two, { lastSent: { ...sent, at: NOW + 1 } })), []);

  // A new payment, sent now: that one counts.
  const next = paid('b2', false, NOW + 20_000);
  assert.deepEqual(p.see({ chain: left, lastSent: next, now: NOW + 20_001 }), [tick('waiting-room', 1, NOW + 20_001, { tx: txid('b2'), sentAt: NOW + 20_000 })]);
});

test('a payment made before the page was loaded, or before the step was followed, never counts', () => {
  const begun = note({ 'waiting-room': started(0), 'pass-it-on': started(1) }, 'waiting-room');
  // A page's first world has no world before it: whatever it holds did not happen "now".
  assert.deepEqual(changes(null, world({ note: begun, chain: FUNDED, lastSent: paid('a1', true) })), []);
  // The payment was there in the world before, when another step was followed.
  const earlier = world({ note: { ...begun, following: 'pass-it-on' }, chain: FUNDED, lastSent: paid('a1') });
  assert.deepEqual(changes(earlier, { ...earlier, note: begun }), []);
  // The wallet in the page changed, and with it the last payment went: no payment is not a payment.
  const sentBefore = world({ note: begun, chain: FUNDED, lastSent: paid('a1') });
  assert.deepEqual(changes(sentBefore, change(sentBefore, { lastSent: null })), []);
});

test('waiting-room: a payment, its block, and six blocks on top, each ticked when the world shows it', () => {
  const p = page();
  const here: WorldSpec = { route: { name: 'step', id: 'waiting-room' } };
  p.open('waiting-room');
  p.see({ ...here, chain: FUNDED });
  const left = chain(state([{ tx: 'a1', sats: 79_718, change: true, height: null }]));
  const sent = paid('a1', false, NOW + 1_000);
  assert.deepEqual(p.see({ chain: left, lastSent: sent, route: { name: 'send' }, now: NOW + 1_000 }), [tick('waiting-room', 1, NOW + 1_000, { tx: txid('a1'), sentAt: NOW + 1_000 })]);

  // Waiting. The step's screen stays open, and the world changes around it: a look every 15 seconds.
  const list = (height: number | null) => [tx({ tx: 'a1', height, time: height === null ? null : (NOW + 31_000) / 1000 }), ...RECEIVED];
  for (const now of [NOW + 15_000, NOW + 30_000]) assert.deepEqual(p.see({ ...here, chain: left, lastSent: sent, history: list(null), now }), []);
  // The block comes: height 201.
  const one = chain(state([{ tx: 'a1', sats: 79_718, change: true, height: TIP + 1 }]), { tip: TIP + 1 });
  const plan = advance(p.last(), world({ ...here, note: p.note(), chain: one, lastSent: sent, history: list(TIP + 1), now: NOW + 45_000 }));
  assert.deepEqual(plan, { changes: [tick('waiting-room', 2, NOW + 45_000)], waited: { 'waiting-room': { height: TIP + 1, seconds: 30 } } });
  p.see({ ...here, chain: one, lastSent: sent, history: list(TIP + 1), now: NOW + 45_000 });
  assert.deepEqual(p.step('waiting-room'), started(2, { tx: txid('a1'), sentAt: NOW + 1_000 }));
  // The step is not done, so the note still holds the payment, and the part's line can be read from it.
  assert.deepEqual(judge('waiting-room', p.last()).parts[1], { state: 'ticked', waited: { height: TIP + 1, seconds: 30 } });

  // Blocks on top, one after another. The list is not read again for them: the height alone moves.
  for (let blocks = 2; blocks <= 5; blocks++) {
    const tip = TIP + blocks;
    assert.deepEqual(p.see({ ...here, chain: { ...one, tip }, lastSent: sent, history: list(TIP + 1), now: NOW + 45_000 + blocks * 30_000 }), [], `${blocks} confirmations`);
    const part = judge('waiting-room', p.last()).parts[2];
    assert.ok(part?.state === 'now' && part.confirmations === blocks);
  }
  // The sixth.
  const done = p.see({ ...here, chain: { ...one, tip: TIP + 6 }, lastSent: sent, history: list(TIP + 1), now: NOW + 300_000 });
  assert.deepEqual(done, [tick('waiting-room', 3, NOW + 300_000)]);
  assert.deepEqual(p.step('waiting-room'), { started: true, doneAt: NOW + 300_000, parts: ticks(1, 2, 3) });
  assert.deepEqual(p.counted, ['waiting-room']);
});

test('a payment that confirmed while no page was looking: the block and the six on top tick together when one looks', () => {
  const begun = note({ 'waiting-room': started(1, { tx: txid('a1'), sentAt: NOW - 3_600_000 }) }, 'waiting-room');
  const seen = world({ note: begun, chain: chain(state(), { tip: TIP }), history: [tx({ tx: 'a1', height: TIP - 40, time: (NOW - 3_570_000) / 1000 })] });
  const plan = advance(null, seen);
  assert.deepEqual(plan.changes, [tick('waiting-room', 2), tick('waiting-room', 3)]);
  assert.deepEqual(plan.waited, { 'waiting-room': { height: TIP - 40, seconds: 30 } });
  assert.deepEqual(after(begun, ...plan.changes).steps['waiting-room'], { started: true, doneAt: NOW, parts: ticks(1, 2, 3) });
});

test('how long a payment waited: by the block\'s own time where that can be used, otherwise by what this page saw', () => {
  const begun = note({ 'pass-it-on': started(2, { tx: txid('a1'), sentAt: NOW - 50_000 }) }, 'pass-it-on');
  const waitedWith = (time: number | null): unknown => advance(null, world({ note: begun, history: [tx({ tx: 'a1', height: 190, time })] })).waited;
  assert.deepEqual(waitedWith((NOW - 20_000) / 1000), { 'pass-it-on': { height: 190, seconds: 30 } });
  // A block dated ahead of the clock, or before the payment, or with no time: from sending to this page seeing it in a block.
  for (const time of [(NOW + 60_000) / 1000, (NOW - 900_000) / 1000, null]) {
    assert.deepEqual(waitedWith(time), { 'pass-it-on': { height: 190, seconds: 50 } }, String(time));
  }
  // A payment with no moment in the note: the block alone.
  const undated = note({ 'pass-it-on': started(2, { tx: txid('a1') }) });
  assert.deepEqual(advance(null, world({ note: undated, history: [tx({ tx: 'a1', height: 190, time: null })] })).waited, { 'pass-it-on': { height: 190, seconds: null } });
  // Nothing of it is in what is written.
  const plan = advance(null, world({ note: begun, history: [tx({ tx: 'a1', height: 190 })] }));
  assert.deepEqual(Object.keys(plan.changes[0] ?? {}).sort(), ['at', 'kind', 'part', 'step']);
  // Other ticks say nothing about waiting.
  assert.deepEqual(advance(null, world({ note: note({ 'hold-some': started(0) }), chain: FUNDED })).waited, {});
});

test('after "Send another", the next payment sent while the step is followed takes the lost one\'s place', () => {
  for (const [id, part, toPot] of [['pass-it-on', 2, true], ['waiting-room', 1, false]] as const) {
    const p = page();
    p.open(id);
    p.see({ chain: FUNDED });
    p.see({ chain: FUNDED, lastSent: paid('a1', toPot, NOW) });
    assert.deepEqual(p.step(id), started(part, { tx: txid('a1'), sentAt: NOW }));
    // The practice chain was started again: the network knows nothing of the payment. The reader presses "Send another".
    p.write({ kind: 'send-another', step: id });
    assert.deepEqual(p.step(id), started(part));
    // The same payment is still this page's last one: it is not noted again.
    assert.deepEqual(p.see({ chain: FUNDED, lastSent: paid('a1', toPot, NOW), history: [] }), []);
    // A new one is.
    const again = p.see({ chain: FUNDED, lastSent: paid('b2', toPot, NOW + 9_000), history: [], now: NOW + 9_001 });
    assert.deepEqual(again, [{ kind: 'payment', step: id, tx: txid('b2'), sentAt: NOW + 9_000 }]);
    assert.deepEqual(p.step(id), started(part, { tx: txid('b2'), sentAt: NOW + 9_000 }));
    // And the step goes on from it.
    p.see({ chain: FUNDED, lastSent: paid('b2', toPot, NOW + 9_000), history: [tx({ tx: 'b2', height: TIP })], now: NOW + 40_000 });
    assert.equal(p.step(id)?.parts?.[part + 1], true);
  }
  // Not for a payment that does not fit the step, and not while another step is followed.
  const cleared = note({ 'pass-it-on': started(2), 'the-seed': started(0) }, 'pass-it-on');
  const before = world({ note: cleared, chain: FUNDED });
  assert.deepEqual(changes(before, change(before, { lastSent: paid('b2', false) })), [], 'not to the pot');
  const elsewhere: World = { ...before, note: { ...cleared, following: 'the-seed' } };
  assert.deepEqual(changes(elsewhere, change(elsewhere, { lastSent: paid('b2', true) })), []);
  assert.deepEqual(changes(null, change(before, { lastSent: paid('b2', true) })), []);
});

// -- events: a screen opened ----------------------------------------------------------------

test('no-balances: the Coins screen opened with a coin on it, the count, and a payment of the wallet\'s own read', () => {
  const coins = chain(state([{ tx: 'c1', sats: 60_000 }, { tx: 'a1', sats: 29_718, change: true }]));
  const history = [tx({ tx: 'a1' }), ...RECEIVED];
  const p = page();
  p.open('no-balances');
  p.see({ chain: coins, history, route: { name: 'step', id: 'no-balances' } });
  assert.deepEqual(p.step('no-balances'), { started: true });

  // 1. The reader opens the Coins screen.
  assert.deepEqual(p.see({ chain: coins, history, route: { name: 'coins' } }), [tick('no-balances', 1)]);
  // Staying there, or coming back to it, writes nothing more.
  assert.deepEqual(p.see({ chain: coins, history, route: { name: 'coins' }, now: NOW + 1 }), []);

  // 2. The count, on the step's screen. A wrong answer writes nothing; the right one ticks.
  p.see({ chain: coins, history, route: { name: 'step', id: 'no-balances' } });
  assert.equal(answerCoins(p.last(), '89718'), 'total');
  assert.equal(answerCoins(p.last(), '3'), 'wrong');
  assert.equal(answerCoins(p.last(), '2'), 'right');
  const counted2 = answered('no-balances', p.last());
  assert.deepEqual(counted2, tick('no-balances', 2));
  p.write(counted2 as Change);

  // 3. A transaction the wallet only received is not one of its payments.
  assert.deepEqual(p.see({ chain: coins, history, route: { name: 'tx', txid: txid('c1') } }), []);
  assert.deepEqual(p.see({ chain: coins, history, route: { name: 'activity' } }), []);
  // One it sent: done.
  assert.deepEqual(p.see({ chain: coins, history, route: { name: 'tx', txid: txid('a1') }, now: NOW + 7 }), [tick('no-balances', 3, NOW + 7)]);
  assert.deepEqual(p.step('no-balances'), { started: true, doneAt: NOW + 7, parts: ticks(1, 2, 3) });
  assert.deepEqual(p.counted, ['no-balances']);
});

test('the Coins screen counts only when it is opened on a coin, while the step is followed', () => {
  const begun = note({ 'no-balances': started(0), 'the-seed': started(0) }, 'no-balances');
  const coins = chain(state([{ tx: 'c1', sats: 60_000 }]));
  const elsewhere = world({ note: begun, chain: coins, route: { name: 'wallet' } });
  const onCoins = world({ note: begun, chain: coins, route: { name: 'coins' } });
  assert.deepEqual(changes(elsewhere, onCoins), [tick('no-balances', 1)]);
  // With no coin on it: nothing to open it for.
  for (const empty of [chain(state()), chain(state([], 1))]) {
    assert.deepEqual(changes(elsewhere, world({ note: begun, chain: empty, route: { name: 'coins' } })), []);
  }
  // A page loaded on the Coins screen: the coins become known while it is open, and that is the moment.
  const loading = world({ note: begun, chain: chain(null), history: null, route: { name: 'coins' } });
  assert.deepEqual(changes(null, loading), []);
  assert.deepEqual(changes(loading, onCoins), [tick('no-balances', 1)]);
  // The first coin arrives while the screen is open.
  assert.deepEqual(changes(world({ note: begun, route: { name: 'coins' } }), onCoins), [tick('no-balances', 1)]);
  // It was open already, in the world before: nothing was opened. (Another tab made the step the followed one.)
  const other: World = { ...onCoins, note: { ...begun, following: 'the-seed' } };
  assert.deepEqual(changes(other, onCoins), []);
  assert.deepEqual(changes(onCoins, onCoins), []);
  // Opened while another step is followed, or none.
  assert.deepEqual(changes({ ...elsewhere, note: other.note }, other), []);
  const nobody: World = { ...onCoins, note: { ...begun, following: null } };
  assert.deepEqual(changes({ ...elsewhere, note: nobody.note }, nobody), []);
  // A page's first world, already on Coins with its coins known (only a stand-in wallet starts so): nothing happened yet.
  assert.deepEqual(changes(null, onCoins), []);
  // No wallet in the browser.
  assert.deepEqual(changes(elsewhere, noWallet({ note: begun, route: { name: 'coins' } })), []);
});

test('the transaction screen counts for a payment this wallet sent, once the list says so', () => {
  const begun = note({ 'no-balances': started(2) }, 'no-balances');
  const coins = chain(state([{ tx: 'c1', sats: 60_000 }]));
  const base = world({ note: begun, chain: coins, history: [tx({ tx: 'a1' }), tx({ tx: 'b2', direction: 'internal' }), ...RECEIVED] });
  const on = (id: string, wallet: Partial<World['wallet']> = {}): World => change(base, wallet, { route: { name: 'tx', txid: txid(id) } });
  assert.deepEqual(changes(base, on('a1')), [tick('no-balances', 3)]);
  // A payment the wallet made to itself is one of its payments.
  assert.deepEqual(changes(base, on('b2')), [tick('no-balances', 3)]);
  // One it only received, one that is not its own at all, and one the list does not hold.
  assert.deepEqual(changes(base, on('c1')), []);
  assert.deepEqual(changes(base, on('x9', { history: [tx({ tx: 'x9', direction: 'other' })] })), []);
  assert.deepEqual(changes(base, on('ff')), []);
  // From one transaction's screen to another's: the second one is what was opened.
  assert.deepEqual(changes(on('c1'), on('a1')), [tick('no-balances', 3)]);
  // A page loaded on the payment's own screen: it counts when the list arrives and names it the wallet's payment.
  const loading = on('a1', { chain: chain(null), history: null });
  assert.deepEqual(changes(null, loading), []);
  const scanned = on('a1', { history: null });
  assert.deepEqual(changes(loading, scanned), []);
  assert.deepEqual(changes(scanned, on('a1')), [tick('no-balances', 3)]);
  // Already open in the world before: nothing was opened.
  assert.deepEqual(changes(on('a1'), on('a1')), []);
  // Not the step followed.
  const other: World = { ...on('a1'), note: { ...begun, following: null } };
  assert.deepEqual(changes({ ...base, note: other.note }, other), []);
});

// -- events: the 12 words, and the wallet removed ------------------------------------------------

test('the-seed: the words put on screen while the step is followed, the reader\'s word, three words checked', () => {
  const p = page();
  p.open('the-seed');
  // The words were shown before, in this page (straight after Create, say): that does not count.
  p.see({ wordsShown: 1, route: { name: 'step', id: 'the-seed' } });
  assert.deepEqual(p.step('the-seed'), { started: true });
  // On Backup, they are put on screen.
  assert.deepEqual(p.see({ wordsShown: 2, route: { name: 'backup' } }), [tick('the-seed', 1)]);
  // Shown again: nothing more.
  assert.deepEqual(p.see({ wordsShown: 3, route: { name: 'backup' } }), []);

  // "I wrote the 12 words on paper, in order." The box is the reader's own word.
  p.see({ wordsShown: 3, route: { name: 'step', id: 'the-seed' } });
  const said = answered('the-seed', p.last());
  assert.deepEqual(said, tick('the-seed', 2));
  p.write(said as Change);
  // Three words, checked inside the wallet and passed. The note keeps the wallet they were checked for.
  p.see({ wordsShown: 3, route: { name: 'step', id: 'the-seed' }, now: NOW + 60_000 });
  const passed = answered('the-seed', p.last());
  assert.deepEqual(passed, tick('the-seed', 3, NOW + 60_000, { wallet: FP }));
  p.write(passed as Change);
  assert.deepEqual(p.step('the-seed'), { started: true, doneAt: NOW + 60_000, wallet: FP, parts: ticks(1, 2, 3) });
  assert.deepEqual(p.counted, ['the-seed']);
});

test('the words shown count only as a change, only for the followed step, and only with a wallet here', () => {
  const begun = note({ 'the-seed': started(0), 'hold-some': started(3, { doneAt: NOW }) }, 'the-seed');
  const before = world({ note: begun, wordsShown: 2 });
  assert.deepEqual(changes(before, change(before, { wordsShown: 3 })), [tick('the-seed', 1)]);
  assert.deepEqual(changes(before, change(before, { wordsShown: 7 })), [tick('the-seed', 1)]);
  // The same count, or a lower one (it never goes down in one page; a world from another page might).
  assert.deepEqual(changes(before, before), []);
  assert.deepEqual(changes(before, change(before, { wordsShown: 1 })), []);
  // A page's first world.
  assert.deepEqual(changes(null, world({ note: begun, wordsShown: 5 })), []);
  // Straight after Create, without opening Backup: the count went up before the step was followed, in an earlier pair.
  const created = world({ note: { ...begun, following: null }, wordsShown: 1 });
  assert.deepEqual(changes(world({ note: created.note }), created), []);
  assert.deepEqual(changes(created, { ...created, note: begun }), [], 'following it afterwards does not bring the moment back');
  // No wallet in the page any more.
  assert.deepEqual(changes(before, noWallet({ note: begun, wordsShown: 3 })), []);
  // The step is done already, or its first part is ticked.
  const later = note({ 'the-seed': started(1) }, 'the-seed');
  assert.deepEqual(changes(world({ note: later, wordsShown: 2 }), world({ note: later, wordsShown: 3 })), []);
});

test('prove-the-backup, start to end: the paper checked, the wallet removed, restored from the words, the coins found', () => {
  for (const was of ['passkey', 'words'] as const) {
    const p = page();
    const mine = record(was);
    p.open('prove-the-backup');
    p.see({ record: mine, unlocked: true, chain: FUNDED, route: { name: 'step', id: 'prove-the-backup' } });
    // 1. Three words, right: the wallet that is here, and how this browser keeps it.
    const passed = answered('prove-the-backup', p.last());
    assert.deepEqual(passed, tick('prove-the-backup', 1, NOW, { wallet: FP, was }));
    p.write(passed as Change);

    // 2. On Settings, Remove. Until then nothing: "before any removal" the step stays where it is.
    assert.deepEqual(p.see({ record: mine, unlocked: true, chain: FUNDED, route: { name: 'settings' } }), []);
    assert.deepEqual(p.see({ status: 'none', record: null, route: { name: 'settings' }, now: NOW + 1 }), [tick('prove-the-backup', 2, NOW + 1)]);
    // Home says it was removed. Nothing more happens while no wallet is here.
    assert.deepEqual(p.see({ status: 'none', record: null, route: { name: 'home' }, now: NOW + 2 }), []);

    // 3. and 4. Restore from the 12 words: this browser now keeps the wallet with its words, and the
    // coins the restore found are there at once.
    const back = p.see({ record: record('words'), unlocked: true, chain: FUNDED, route: { name: 'restore' }, now: NOW + 90_000 });
    assert.deepEqual(back, [tick('prove-the-backup', 3, NOW + 90_000), tick('prove-the-backup', 4, NOW + 90_000)]);
    // Done. The wallet it named is deleted from the note; how it was kept stays, for what the screen says has changed.
    assert.deepEqual(p.step('prove-the-backup'), { started: true, doneAt: NOW + 90_000, was, parts: ticks(1, 2, 3, 4) });
    assert.deepEqual(p.counted, ['prove-the-backup']);
  }
});

test('prove-the-backup stays where it is: back through the passkey, another wallet restored, a removal that is not the one', () => {
  const noted = { wallet: FP, was: 'passkey' as const };
  const removed = note({ 'prove-the-backup': started(2, noted) }, 'prove-the-backup');
  const gone = noWallet({ note: removed });
  // The wallet returns through "Open with my passkey": that proves the passkey, not the paper.
  const viaPasskey = world({ note: removed, record: record('passkey'), unlocked: true, chain: FUNDED });
  assert.deepEqual(changes(gone, viaPasskey), []);
  assert.deepEqual(changes(viaPasskey, change(viaPasskey, { chain: { ...FUNDED, tip: TIP + 1 } })), []);
  // Another wallet is restored from its words, or made new.
  for (const kind of ['words', 'passkey'] as const) {
    assert.deepEqual(changes(gone, world({ note: removed, record: record(kind, OTHER_FP), chain: FUNDED })), [], kind);
  }
  // The right wallet, from its words, with no coin found: part 3, and part 4 waits for coins.
  const empty = world({ note: removed, record: record('words') });
  assert.deepEqual(changes(gone, empty), [tick('prove-the-backup', 3)]);
  // The restore's coins are still being looked up: part 3 alone, and part 4 when they are known.
  const looking = world({ note: removed, record: record('words'), chain: chain(null), history: null });
  assert.deepEqual(changes(gone, looking), [tick('prove-the-backup', 3)]);
  const third = after(removed, tick('prove-the-backup', 3));
  assert.deepEqual(changes({ ...looking, note: third }, world({ note: third, record: record('words'), chain: FUNDED })), [tick('prove-the-backup', 4)]);

  // Before any removal: the wallet is simply here, with its words kept, as a wallet made without a
  // passkey is. That is not a restore: the removal has to come first.
  const checked = note({ 'prove-the-backup': started(1, { wallet: FP, was: 'words' }) }, 'prove-the-backup');
  const here = world({ note: checked, chain: FUNDED });
  assert.deepEqual(changes(null, here), []);
  assert.deepEqual(changes(here, change(here, { chain: { ...FUNDED, tip: TIP + 3 } })), []);
  // The removal counts only when the wallet the note names was here and now none is.
  assert.deepEqual(changes(here, noWallet({ note: checked })), [tick('prove-the-backup', 2)]);
  assert.deepEqual(changes(world({ note: checked, record: record('words', OTHER_FP) }), noWallet({ note: checked })), [], 'another wallet was removed');
  assert.deepEqual(changes(here, world({ note: checked, record: record('words', OTHER_FP) })), [], 'another tab put another wallet in its place');
  assert.deepEqual(changes(here, world({ note: checked, status: 'unreadable', record: null })), [], 'what is stored became unreadable: not a removal');
  // The browser stopped letting the page read its storage (site data blocked): the wallet is still on the disk.
  // A page that can no longer see it has not seen it removed.
  assert.deepEqual(changes(here, world({ note: checked, status: 'blocked', record: null })), [], 'the storage can no longer be read: not a removal');
  assert.deepEqual(changes(null, noWallet({ note: checked })), [], 'a page that loads with no wallet saw nothing removed');
  assert.deepEqual(changes(noWallet({ note: checked }), noWallet({ note: checked })), []);
  // Not while another step is followed, or none.
  for (const following of [null, 'the-seed'] as const) {
    const other: Progress = { ...checked, following, steps: { ...checked.steps, 'the-seed': started(0) } };
    assert.deepEqual(changes({ ...here, note: other }, noWallet({ note: other })), [], String(following));
  }
  // And with no wallet named at all (a note edited by hand), no removal is "the" removal.
  const nameless = note({ 'prove-the-backup': started(1) }, 'prove-the-backup');
  assert.deepEqual(changes(world({ note: nameless, chain: FUNDED }), noWallet({ note: nameless })), []);
});

test('prove-the-backup: the paper check is already passed when the-seed checked this same wallet', () => {
  const seedDone = { 'the-seed': started(3, { doneAt: NOW - 5_000, wallet: FP }) };
  const begun = note({ ...seedDone, 'prove-the-backup': started(0) }, 'prove-the-backup');
  // It ticks by itself, with the wallet and how it is kept, whatever screen is open.
  for (const kind of ['passkey', 'words'] as const) {
    const seen = world({ note: begun, record: record(kind), chain: FUNDED });
    assert.deepEqual(changes(null, seen), [tick('prove-the-backup', 1, NOW, { wallet: FP, was: kind })], kind);
  }
  // Not for another wallet, not for a wallet without coins, and not before the-seed's own check.
  assert.deepEqual(changes(null, world({ note: begun, record: record('words', OTHER_FP), chain: FUNDED })), []);
  assert.deepEqual(changes(null, world({ note: begun })), []);
  const unchecked = note({ 'the-seed': started(2), 'prove-the-backup': started(0) }, 'prove-the-backup');
  assert.deepEqual(changes(null, world({ note: unchecked, chain: FUNDED })), []);
  // the-seed's last answer, given just now, lets the drill's first part tick in the next breath.
  const p = page();
  p.open('the-seed');
  p.open('prove-the-backup');
  p.open('the-seed', NOW + 1);
  p.see({ chain: FUNDED, wordsShown: 0 });
  p.see({ chain: FUNDED, wordsShown: 1 });
  p.write(answered('the-seed', p.last()) as Change);
  p.see({ chain: FUNDED, wordsShown: 1, now: NOW + 2 });
  p.write(answered('the-seed', p.last()) as Change);
  assert.equal(p.step('the-seed')?.doneAt, NOW + 2);
  assert.deepEqual(p.see({ chain: FUNDED, wordsShown: 1, now: NOW + 3 }), [tick('prove-the-backup', 1, NOW + 3, { wallet: FP, was: 'words' })]);
});

// -- what the reader ticks ----------------------------------------------------------------------

test('answered(): the tick of a question or of the reader\'s word, and only while that part is the one that is now', () => {
  const history = [tx({ tx: 'a1' }), ...RECEIVED];
  // The four parts a reader ticks.
  const asks: [StepId, number, WorldSpec, Change][] = [
    ['no-balances', 1, { chain: FUNDED, history }, tick('no-balances', 2)],
    ['the-seed', 1, {}, tick('the-seed', 2)],
    ['the-seed', 2, {}, tick('the-seed', 3, NOW, { wallet: FP })],
    ['prove-the-backup', 0, { chain: FUNDED, record: record('passkey'), unlocked: true }, tick('prove-the-backup', 1, NOW, { wallet: FP, was: 'passkey' })],
  ];
  for (const [id, done, spec, expected] of asks) {
    const seen = world({ ...spec, note: note({ [id]: started(done) }, id) });
    assert.deepEqual(answered(id, seen), expected, `${id} part ${done + 1}`);
    // Whether or not the step is the one followed: the reader is on its screen.
    assert.deepEqual(answered(id, { ...seen, note: { ...seen.note, following: null } }), expected);
    // Not when the wallet has gone, or is in trouble.
    assert.equal(answered(id, noWallet({ note: seen.note })), null, id);
    assert.equal(answered(id, world({ ...spec, status: 'unreadable', record: null, note: seen.note })), null, id);
    assert.equal(answered(id, world({ ...spec, status: 'blocked', record: null, note: seen.note })), null, id);
  }
  // A part that is not a question: the world ticks those, never the reader.
  for (const id of STEPS) {
    for (let done = 0; done < partCount(id); done++) {
      const kind = STEP_DEFS[id].parts[done]?.kind;
      const seen = world({ chain: FUNDED, history, note: note({ [id]: started(done, { tx: txid('a1'), sentAt: NOW, wallet: FP }) }, id) });
      if (kind === 'state' || kind === 'event') assert.equal(answered(id, seen), null, `${id} part ${done + 1}`);
    }
    // A step that is done, or was never opened.
    assert.equal(answered(id, world({ chain: FUNDED, history, note: note({ [id]: started(partCount(id), { doneAt: NOW }) }) })), null, id);
    assert.equal(answered(id, world({ chain: FUNDED, history })), null, id);
  }
  // The question is there, and blocked or unknown: no tick.
  assert.equal(answered('no-balances', world({ chain: FUNDED, history: null, note: note({ 'no-balances': started(1) }) })), null);
  assert.equal(answered('no-balances', world({ chain: FUNDED, history: RECEIVED, note: note({ 'no-balances': started(1) }) })), null);
  // "Hold some" has nothing the reader ticks, at any of its parts or with all of them ticked.
  for (let done = 0; done <= 3; done++) {
    assert.equal(answered('hold-some', world({ chain: FUNDED, history, note: note({ 'hold-some': started(done) }, 'hold-some') })), null, `hold-some ${done}`);
  }
  assert.equal(answered('prove-the-backup', world({ note: note({ 'prove-the-backup': started(0) }) })), null, 'no coins');
  // Another tab got there first: the part is ticked, and the next one is not the reader's to tick.
  const ticked = world({ chain: FUNDED, history, note: note({ 'no-balances': started(2) }) });
  assert.equal(answered('no-balances', ticked), null);

  // What it answers with is what the question was judged against in the same world.
  const count = world({ chain: FUNDED, history, note: note({ 'no-balances': started(1) }) });
  assert.equal(answerCoins(count, '1'), 'right');
  assert.deepEqual(after(count.note, answered('no-balances', count) as Change).steps['no-balances'], started(2));
  // And the reader's last tick of a step finishes it at that moment.
  const words = world({ note: note({ 'the-seed': started(2) }) });
  assert.equal(after(words.note, answered('the-seed', words) as Change).steps['the-seed']?.doneAt, NOW);
});

test('rechecked(): a the-seed that is checked, checked again for the wallet that is here now', () => {
  const done = note({ 'the-seed': started(3, { doneAt: NOW, wallet: FP }) });
  const other = world({ note: done, record: record('words', OTHER_FP) });
  assert.deepEqual(rechecked(other), { kind: 'checked', step: 'the-seed', wallet: OTHER_FP });
  assert.equal(after(done, rechecked(other) as Change).steps['the-seed']?.wallet, OTHER_FP);
  // For the same wallet it changes nothing when written.
  assert.deepEqual(after(done, rechecked(world({ note: done })) as Change), done);
  // Nothing to renew: no wallet here, or the step's words were never checked.
  assert.equal(rechecked(noWallet({ note: done })), null);
  assert.equal(rechecked(world({ note: note({ 'the-seed': started(2) }) })), null);
  assert.equal(rechecked(world()), null);
});

// -- what to count ------------------------------------------------------------------------------

test('"Do it" is counted for the write that put the moment a step was done into the note, and for no other', () => {
  const before = note({ 'the-seed': started(2), 'hold-some': started(3, { doneAt: NOW - 9 }) });
  const done = after(before, tick('the-seed', 3, NOW, { wallet: FP }));
  assert.deepEqual(counted(before, done), ['the-seed']);
  // A write that changes something else, or nothing.
  assert.deepEqual(counted(before, after(before, { kind: 'open', step: 'pass-it-on', at: NOW, from: null })), []);
  assert.deepEqual(counted(before, before), []);
  assert.deepEqual(counted(done, done), [], 'the note that was read already said so: another tab was first');
  assert.deepEqual(counted(emptyProgress(), emptyProgress()), []);
  // Two steps cannot finish in one write, but the count would hold both, in the contract's order.
  assert.deepEqual(counted(emptyProgress(), done), ['hold-some', 'the-seed']);

  // Two tabs see the same block take the same payment in. Both ask to write the last tick; one write puts
  // the moment there, and the other reads a note that has it.
  const storage = new MemoryStorage();
  const one = page(storage);
  const two = page(storage);
  one.open('pass-it-on');
  for (const tab of [one, two]) tab.see({ chain: FUNDED });
  one.see({ chain: FUNDED, lastSent: paid('a1', true) });
  two.see({ chain: FUNDED });
  for (const tab of [one, two]) tab.see({ chain: FUNDED, lastSent: tab === one ? paid('a1', true) : null, history: [tx({ tx: 'a1' })], now: NOW + 30_000 });
  assert.deepEqual([one.counted, two.counted], [['pass-it-on'], []]);
  assert.equal(readProgress(storage as Storage).progress.steps['pass-it-on']?.doneAt, NOW + 30_000);
  // "Forget my progress" starts the count again: the step can be done, and counted, once more.
  storage.map.clear();
  one.open('pass-it-on', NOW + 40_000);
  one.see({ chain: FUNDED, lastSent: paid('a1', true), now: NOW + 40_000 });
  one.see({ chain: FUNDED, lastSent: paid('b2', true, NOW + 50_000), now: NOW + 50_000 });
  one.see({ chain: FUNDED, lastSent: paid('b2', true, NOW + 50_000), history: [tx({ tx: 'b2' })], now: NOW + 80_000 });
  assert.deepEqual(one.counted, ['pass-it-on', 'pass-it-on']);
});

test('a payment sent in a second tab: the tab that sent it notes it, and the tab with the step open ticks the rest', () => {
  const storage = new MemoryStorage();
  const stepTab = page(storage);
  const sendTab = page(storage);
  stepTab.open('waiting-room');
  for (const tab of [stepTab, sendTab]) tab.see({ chain: FUNDED });
  // Only the page that sent the payment knows it as "the payment this page last sent".
  const sent = paid('a1', false, NOW + 2_000);
  assert.deepEqual(sendTab.see({ chain: FUNDED, lastSent: sent, route: { name: 'send' }, now: NOW + 2_000 }).length, 1);
  assert.deepEqual(stepTab.see({ chain: FUNDED, route: { name: 'step', id: 'waiting-room' }, now: NOW + 2_100 }), [], 'the note it reads already has the tick');
  assert.deepEqual(stepTab.step('waiting-room'), started(1, { tx: txid('a1'), sentAt: NOW + 2_000 }));
  // The step's tab sees the block, and the six on top.
  const listed = [tx({ tx: 'a1', height: TIP + 1 })];
  stepTab.see({ chain: { ...FUNDED, tip: TIP + 1 }, history: listed, route: { name: 'step', id: 'waiting-room' }, now: NOW + 30_000 });
  stepTab.see({ chain: { ...FUNDED, tip: TIP + 6 }, history: listed, route: { name: 'step', id: 'waiting-room' }, now: NOW + 180_000 });
  assert.equal(stepTab.step('waiting-room')?.doneAt, NOW + 180_000);
  assert.deepEqual([stepTab.counted, sendTab.counted], [['waiting-room'], []]);
});

// -- the rules of the function itself --------------------------------------------------------------

test('a note that has every tick and no moment of being done is finished at the next change', () => {
  const edited = note({ 'the-seed': started(3, { wallet: FP }), 'pass-it-on': started(3, { tx: txid('a1'), sentAt: NOW }) });
  const plan = advance(null, world({ note: edited }));
  assert.deepEqual(plan.changes, [tick('pass-it-on', 3), tick('the-seed', 3)]);
  const finished = after(edited, ...plan.changes);
  assert.deepEqual(finished.steps, { 'pass-it-on': { started: true, doneAt: NOW, parts: ticks(1, 2, 3) }, 'the-seed': { started: true, doneAt: NOW, wallet: FP, parts: ticks(1, 2, 3) } });
  assert.deepEqual(counted(edited, finished), ['pass-it-on', 'the-seed']);
  assert.deepEqual(changes(null, world({ note: finished })), []);

  // "Hold some" as an earlier version of this page left it in a browser: its three states ticked, and a
  // question still open that the step no longer has. That is such a note. It is finished at the next change,
  // whichever comes first: with the wallet here or gone, with its coins read or not, on whatever screen. The
  // moment is that change's own (the note keeps no time for a tick), the step is counted once, and the time
  // it was last followed is not renewed.
  const left: Progress = { ...note({ 'hold-some': started(3) }, 'hold-some'), followedAt: NOW - 3_600_000 };
  const later = NOW + 500;
  const meets: World[] = [
    world({ note: left, chain: FUNDED, history: RECEIVED, now: later, route: { name: 'step', id: 'hold-some' } }),
    world({ note: left, now: later, route: { name: 'wallet' } }),
    world({ note: left, chain: chain(null), history: null, now: later, route: { name: 'about' } }),
    noWallet({ note: left, now: later }),
    world({ note: left, status: 'unreadable', record: null, now: later, route: { name: 'do' } }),
  ];
  for (const seen of meets) {
    const label = `${seen.wallet.status} ${seen.route.name}`;
    const first = advance(null, seen);
    assert.deepEqual(first.changes, [tick('hold-some', 3, later)], label);
    const done = after(left, ...first.changes);
    assert.deepEqual(done, { v: 1, following: 'hold-some', followedAt: NOW - 3_600_000, steps: { 'hold-some': { started: true, doneAt: later, parts: ticks(1, 2, 3) } } }, label);
    assert.deepEqual(counted(left, done), ['hold-some'], label);
    // Once: the next look has nothing to add, and counts nothing.
    assert.deepEqual(changes(seen, { ...seen, note: done, now: later + 1 }), [], label);
    assert.deepEqual(counted(done, done), [], label);
  }
  // Two of its ticks are no such note: the step goes on at its third part, and is done when the block comes.
  const two = note({ 'hold-some': started(2) }, 'hold-some');
  assert.deepEqual(changes(null, world({ note: two, chain: chain(state([{ tx: 'c1', sats: 100_000, height: null }])) })), []);
  assert.deepEqual(changes(null, world({ note: two, chain: FUNDED })), [tick('hold-some', 3)]);
  // Where nothing can be written it stays as it is: not done, and not counted.
  for (const kept of ['no', 'newer'] as const) assert.deepEqual(changes(null, world({ note: left, chain: FUNDED, kept })), [], kept);
});

test('advance is pure: it changes neither world, asks no clock, and the same pair gives the same answer', () => {
  const begun = note({ 'hold-some': started(0), 'pass-it-on': started(1), 'no-balances': started(0), 'waiting-room': started(1, { tx: txid('a1'), sentAt: NOW - 9_000 }), 'the-seed': started(0), 'prove-the-backup': started(2, { wallet: FP, was: 'words' }) }, 'pass-it-on');
  const before = frozen(world({ note: begun, status: 'none', record: null }));
  const now = frozen(
    world({ note: begun, chain: FUNDED, history: [tx({ tx: 'a1', height: TIP - 9 }), ...RECEIVED], lastSent: paid('b2', true), wordsShown: 1, route: { name: 'coins' }, now: NOW + 123 }),
  );
  const first = advance(before, now);
  assert.deepEqual(advance(before, now), first);
  assert.notEqual(advance(before, now), first);
  // Every time it writes is the world's own, or the moment a payment says it was sent.
  for (const one of first.changes) {
    if ('at' in one) assert.equal(one.at, NOW + 123, one.kind);
  }
  assert.deepEqual(
    first.changes.map((one) => (one.kind === 'tick' ? `${one.step} ${one.part}` : one.kind)),
    ['hold-some 1', 'hold-some 2', 'hold-some 3', 'pass-it-on 2', 'waiting-room 2', 'waiting-room 3', 'prove-the-backup 3', 'prove-the-backup 4'],
    'every step that has something to tick, in the order of the steps, each part in its turn',
  );
  // What it asks to be written holds a transaction ID, times and ticks, and nothing of the wallet beyond its fingerprint.
  const text = JSON.stringify(first.changes);
  assert.doesNotMatch(text, /bcrt1|tpub|mnemonic|abandon/);
  // Applied, the changes leave a note that the next look has nothing to add to.
  const settled = after(begun, ...first.changes);
  assert.deepEqual(changes(now, { ...now, note: settled }), []);
  assert.deepEqual(counted(begun, settled), ['hold-some', 'waiting-room', 'prove-the-backup']);
});

// -- found by breaking advance.ts on purpose, one line at a time ---------------------------------
//
// Each test below pins a line that could be changed without any other test noticing.

test('how long a payment waited, seen by this page: to the nearest whole second, never below zero, however long', () => {
  // The block's own time cannot be used here (it has none), so the page's own clock says how long.
  const seenAfter = (ms: number): unknown => {
    const begun = note({ 'pass-it-on': started(2, { tx: txid('a1'), sentAt: NOW - ms }) }, 'pass-it-on');
    return advance(null, world({ note: begun, history: [tx({ tx: 'a1', height: 190, time: null })] })).waited['pass-it-on'];
  };
  assert.deepEqual(seenAfter(23_400), { height: 190, seconds: 23 });
  assert.deepEqual(seenAfter(23_600), { height: 190, seconds: 24 });
  assert.deepEqual(seenAfter(400), { height: 190, seconds: 0 });
  assert.deepEqual(seenAfter(0), { height: 190, seconds: 0 });
  // A payment the note dates after now (a clock that was set back): no wait below zero is ever said.
  assert.deepEqual(seenAfter(-5_000), { height: 190, seconds: 0 });
  assert.deepEqual(seenAfter(7_200_000), { height: 190, seconds: 7_200 });
});

test('how long a payment waited is told by the tick of its block, and by no later tick of the step', () => {
  // Six blocks deep, with "A block takes it in" ticked long ago: the tick of "Six blocks on top" says nothing of the wait.
  const deep = world({
    note: note({ 'waiting-room': started(2, { tx: txid('a1'), sentAt: NOW - 400_000 }) }, 'waiting-room'),
    history: [tx({ tx: 'a1', height: TIP - 5, time: null })],
  });
  const plan = advance(null, deep);
  assert.deepEqual(plan.changes, [tick('waiting-room', 3)]);
  assert.deepEqual(plan.waited, {});
  // Both at once (nobody was looking while the blocks came): told once, for the block.
  const both = advance(null, world({ ...deep, note: note({ 'waiting-room': started(1, { tx: txid('a1'), sentAt: NOW - 400_000 }) }, 'waiting-room'), history: deep.wallet.history }));
  assert.deepEqual(both.changes, [tick('waiting-room', 2), tick('waiting-room', 3)]);
  assert.deepEqual(both.waited, { 'waiting-room': { height: TIP - 5, seconds: 400 } });
});

test('a world whose clock is no time writes nothing: a change that would not apply is not handed on', () => {
  // The one write function refuses a tick whose moment is not a time. advance() does not offer such a change at all.
  const begun = note({ 'hold-some': started(0), 'pass-it-on': started(0) }, 'hold-some');
  for (const now of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
    const plan = advance(null, world({ note: begun, chain: FUNDED, now }));
    assert.deepEqual(plan, { changes: [], waited: {} }, String(now));
  }
  // The same world with a clock ticks as usual.
  assert.deepEqual(changes(null, world({ note: begun, chain: FUNDED })).length, 4);
});

test('rechecked() offers nothing where nothing can be kept, or where the world holds half a wallet', () => {
  const done = note({ 'the-seed': started(3, { doneAt: NOW, wallet: FP }) });
  const other = record('words', OTHER_FP);
  assert.deepEqual(rechecked(world({ note: done, record: other })), { kind: 'checked', step: 'the-seed', wallet: OTHER_FP });
  for (const kept of ['no', 'newer'] as const) assert.equal(rechecked(world({ note: done, record: other, kept })), null, kept);
  // A record with a status that is not "ready", or "ready" with no record: no wallet is here.
  assert.equal(rechecked(world({ note: done, status: 'none', record: other })), null);
  assert.equal(rechecked(world({ note: done, status: 'ready', record: null })), null);
  // The same goes for a question answered right: nothing is ticked where nothing can be kept.
  const asked = world({ note: note({ 'the-seed': started(1) }, 'the-seed') });
  assert.deepEqual(answered('the-seed', asked), tick('the-seed', 2));
  for (const kept of ['no', 'newer'] as const) assert.equal(answered('the-seed', { ...asked, kept }), null, kept);
});

test('the transaction screen counts only while a wallet is here, whatever list the page still holds', () => {
  // For a moment after a wallet is removed a page can still hold its list: the session has said
  // "no wallet", and the chain has not yet dropped what it knew. That moment opens nothing.
  const noted = note({ 'no-balances': started(2) }, 'no-balances');
  const coins = chain(state([{ tx: 'c1', sats: 50_000 }]));
  const onPayment: WorldSpec = { chain: coins, history: [tx({ tx: 'a1' })], note: noted, route: { name: 'tx', txid: txid('a1') } };
  const gone = world({ ...onPayment, status: 'none', record: null });
  assert.deepEqual(changes(change(gone, {}, { route: { name: 'settings' } }), gone), []);
  // With the wallet here, the same move is the payment being read.
  const here = world({ ...onPayment });
  assert.deepEqual(changes(change(here, {}, { route: { name: 'settings' } }), here), [tick('no-balances', 3)]);
  // And a wallet that comes into a page already on that screen is a change like any other.
  assert.deepEqual(changes(gone, here), [tick('no-balances', 3)]);
});
