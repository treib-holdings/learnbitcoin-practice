// Where a "Do it" step stands (src/lib/doit/judge.ts): every part of every
// step in every state it can be in, the two number questions, the three
// words, and the rules that hold for all of them: ticks come from the note,
// live facts decide only the first part that is not ticked, and facts that
// are not known are "unknown", never "blocked".
//
// The worlds are made in doit-worlds.ts: the gallery's sample wallet, a note,
// and a clock that stands still.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STEPS, type StepId } from '@learnbitcoin/practice-contract';
import type { TxView } from '@learnbitcoin/practice-wallet';
import {
  LOST_MS,
  SIX_BLOCKS,
  WORD_CHECKS,
  answerBlock,
  answerCoins,
  firstOpen,
  isWalletTrouble,
  judge,
  pickPositions,
  seedWallet,
  stepState,
  troubleOf,
  verdictOf,
  waitedFor,
  walletFacts,
  wordsPassed,
  type BlockedReason,
  type PartView,
  type Seen,
  type WalletTrouble,
  type World,
} from '../src/lib/doit/judge.ts';
import { emptyProgress, type StepNote } from '../src/lib/doit/progress.ts';
import { STEP_DEFS, partCount } from '../src/lib/doit/steps.ts';
import type { WalletStatus } from '../src/lib/wallet-api.ts';
import { FP, NOW, OTHER_FP, TIP, chain, change, frozen, noWallet, note, record, started, state, tx, txid, world, type WorldSpec } from './doit-worlds.ts';

const TICKED: PartView = { state: 'ticked', waited: null };
const LATER: PartView = { state: 'later' };
const DO: PartView = { state: 'now', txid: null, waiting: null, confirmations: null, unlock: false };
const blocked = (reason: Extract<PartView, { state: 'blocked' }>['reason']): PartView => ({ state: 'blocked', reason });
const unknown = (reason: Extract<PartView, { state: 'unknown' }>['reason']): PartView => ({ state: 'unknown', reason });

/**
 * The wallet's own trouble: every status in which no wallet can be used here, with the reason judge() gives
 * for it. Something stored that cannot be used is "trouble". A browser the wallet cannot run in is "broken":
 * nothing was read there and no wallet can have been made, so it is never told as "the stored wallet". A
 * storage the page was not let read is "unread": whether a wallet is here is not known, so it is never told
 * as "no wallet".
 */
const TROUBLE: [WalletStatus, WalletTrouble][] = [
  ['unreadable', 'trouble'],
  ['newer', 'trouble'],
  ['broken', 'broken'],
  ['blocked', 'unread'],
];

/** A world in which `id` is started with its first `done` parts ticked, and is the step followed. */
function at(id: StepId, done: number, spec: WorldSpec = {}, extra: StepNote = {}, others: Parameters<typeof note>[0] = {}): World {
  return world({ ...spec, note: note({ ...others, [id]: started(done, extra) }, id) });
}

/** The state of the part of `id` that is not ticked yet, in a world: the one live facts decide. */
function open(id: StepId, seen: Seen): PartView | undefined {
  const view = judge(id, seen);
  return view.at === null ? undefined : view.parts[view.at - 1];
}

/** A wallet whose first look at its coins is still running, and one whose first look failed. */
const LOOKING = { chain: chain(null), history: null };
const SCAN_FAILED = { chain: chain(null, { error: 'network' as const, retryAt: NOW + 15_000 }), history: null };

// -- the rules that hold for every step -----------------------------------------------------

test('a step that was never opened: nothing is judged for it', () => {
  const worlds = [
    world(),
    noWallet(),
    world({ chain: chain(state([{ tx: 'c1', sats: 100_000 }])), history: [tx({ tx: 'c1', direction: 'received' })] }),
    world({ status: 'broken', record: null }),
    world({ status: 'blocked', record: null }),
  ];
  for (const id of STEPS) {
    for (const seen of worlds) {
      assert.deepEqual(judge(id, seen), { id, state: 'not-started', parts: STEP_DEFS[id].parts.map((): PartView => LATER), at: null }, id);
    }
    // Another step's note does not start this one.
    const other = STEPS.find((each) => each !== id) ?? 'hold-some';
    assert.equal(judge(id, world({ note: note({ [other]: started(1) }, other) })).state, 'not-started');
  }
});

test('a done step shows every part ticked, whatever the wallet is doing now', () => {
  const after: WorldSpec[] = [
    {},
    // After "Send all": no coin is left. After Remove: no wallet. And every kind of trouble.
    { chain: chain(state()) },
    { status: 'none', record: null },
    ...TROUBLE.map(([status]): WorldSpec => ({ status, record: null })),
    LOOKING,
    SCAN_FAILED,
    { kept: 'no' },
  ];
  for (const id of STEPS) {
    for (const spec of after) {
      const seen = world({ ...spec, note: note({ [id]: started(partCount(id), { doneAt: NOW - 1000 }) }) });
      assert.deepEqual(judge(id, seen), { id, state: 'done', parts: STEP_DEFS[id].parts.map((): PartView => TICKED), at: null }, `${id} ${JSON.stringify(spec.status ?? spec.kept ?? 'ready')}`);
    }
    // Done is what the note says, by the moment it was done.
    assert.equal(judge(id, world({ note: note({ [id]: { started: true, doneAt: NOW } }) })).state, 'done');
  }
});

test('ticks come from the note and stay: live facts decide only the first part that is not ticked', () => {
  // hold-some with three ticks, and nothing left of what they were ticked for: no wallet at all.
  const gone = judge('hold-some', noWallet({ note: note({ 'hold-some': started(3) }) }));
  assert.deepEqual(gone, { id: 'hold-some', state: 'started', parts: [TICKED, TICKED, TICKED, blocked('no-wallet')], at: 4 });
  // pass-it-on after "Send all": nothing can be spent any more, and part 1 stays ticked.
  const spent = at('pass-it-on', 2, { chain: chain(state()), history: [tx({ tx: 'a1', height: null })] }, { tx: txid('a1'), sentAt: NOW - 20_000 });
  assert.deepEqual(judge('pass-it-on', spent).parts.map((part) => part.state), ['ticked', 'ticked', 'now']);
  // Everything after the first open part is "later", whatever the wallet says about it.
  const funded = world({ chain: chain(state([{ tx: 'c1', sats: 100_000 }])), note: note({ 'hold-some': started(0) }) });
  assert.deepEqual(judge('hold-some', funded).parts.map((part) => part.state), ['now', 'later', 'later', 'later'], 'its ticks are not in the note yet');
  // A tick further on that the note should not have (edited by hand) is honoured when its turn comes, not before.
  const odd = world({ note: note({ 'the-seed': { started: true, parts: { 2: true } } }) });
  assert.deepEqual(judge('the-seed', odd).parts.map((part) => part.state), ['now', 'later', 'later']);
  assert.equal(firstOpen('the-seed', odd.note.steps['the-seed']), 1);
  assert.equal(firstOpen('the-seed', { started: true, parts: { 1: true, 2: true } }), 3);
  assert.equal(firstOpen('the-seed', started(3)), null);
  assert.equal(firstOpen('the-seed', undefined), 1);
});

test('the state of a step, from its note alone: never opened, under way, done', () => {
  assert.equal(stepState(undefined), 'not-started');
  assert.equal(stepState({}), 'not-started');
  assert.equal(stepState({ from: '/journey/what-bitcoin-actually-is' }), 'not-started');
  assert.equal(stepState({ started: true }), 'started');
  assert.equal(stepState(started(2)), 'started');
  assert.equal(stepState(started(3, { doneAt: NOW })), 'done');
});

test('the wallet\'s own trouble blocks the open part of every step, whichever part it is, and each kind under its own reason', () => {
  for (const [status, reason] of TROUBLE) {
    for (const id of STEPS) {
      for (let done = 0; done < partCount(id); done++) {
        const seen = at(id, done, { status, record: null }, { wallet: FP, tx: txid('a1'), sentAt: NOW });
        const view = judge(id, seen);
        assert.equal(view.at, done + 1, `${status} ${id} ${done}`);
        assert.deepEqual(view.parts[done], blocked(reason), `${status} ${id} part ${done + 1}`);
        assert.ok(view.parts.every((part) => part.state !== 'now'), 'no part is "now"');
      }
    }
  }
});

test('a browser that failed the self-test is never "the stored wallet", and a storage the page could not read is never "no wallet"', () => {
  // Which status is which trouble. Every status has a line, and the two without trouble say so.
  const all: Record<WalletStatus, WalletTrouble | null> = { none: null, ready: null, unreadable: 'trouble', newer: 'trouble', broken: 'broken', blocked: 'unread' };
  for (const [status, reason] of Object.entries(all) as [WalletStatus, WalletTrouble | null][]) assert.equal(troubleOf(status), reason, status);
  // The three reasons that are the wallet's own, and no other.
  const reasons: Record<BlockedReason, boolean> = {
    'no-wallet': false,
    'no-coins': false,
    'not-spendable-yet': false,
    'nothing-sent': false,
    'came-back-with-passkey': false,
    'another-wallet': false,
    storage: false,
    trouble: true,
    broken: true,
    unread: true,
  };
  for (const [reason, own] of Object.entries(reasons) as [BlockedReason, boolean][]) assert.equal(isWalletTrouble(reason), own, reason);

  for (const id of STEPS) {
    for (let done = 0; done < partCount(id); done++) {
      const extra = { wallet: FP, tx: txid('a1'), sentAt: NOW };
      // The self-test failed. Nothing was read and no wallet can have been made: "trouble" is the reason for a
      // wallet that IS stored and cannot be used, and the strip would say "the stored wallet cannot be used".
      const broken = open(id, at(id, done, { status: 'broken', record: null }, extra));
      assert.deepEqual(broken, blocked('broken'), `${id} part ${done + 1}`);
      // The storage could not be read. "no-wallet" would have the step say "there is none", and offer to make
      // one beside a wallet that may still be stored.
      const unread = open(id, at(id, done, { status: 'blocked', record: null }, extra));
      assert.deepEqual(unread, blocked('unread'), `${id} part ${done + 1}`);
      // And the same step with a storage that was read and holds no wallet is another thing altogether.
      const none = open(id, at(id, done, { status: 'none', record: null }, extra));
      assert.notDeepEqual(none, unread, `${id} part ${done + 1}`);
      assert.notDeepEqual(none, broken, `${id} part ${done + 1}`);
    }
  }
  // "Make a practice wallet" is the one part that no wallet does not block: the reader can make one now. Not so
  // where the page could not look: nothing is made beside a wallet nobody can see.
  assert.deepEqual(open('hold-some', at('hold-some', 0, { status: 'none', record: null })), DO);
  assert.deepEqual(open('hold-some', at('hold-some', 0, { status: 'blocked', record: null })), blocked('unread'));
  // The drill's restore, with nothing here, is "now" (restore from the paper). Not where the page could not look.
  const drill = { wallet: FP, was: 'words' as const };
  assert.equal(open('prove-the-backup', at('prove-the-backup', 2, { status: 'none', record: null }, drill))?.state, 'now');
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 2, { status: 'blocked', record: null }, drill)), blocked('unread'));
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 2, { status: 'broken', record: null }, drill)), blocked('broken'));
  // A done "The seed" names no wallet of this browser in either state: it says nothing of what is here now.
  const seed = note({ 'the-seed': started(3, { doneAt: NOW, wallet: FP }) });
  for (const status of ['broken', 'blocked'] as const) assert.equal(seedWallet(world({ note: seed, status, record: null })), 'none', status);
});

test('facts that are not known yet are "unknown", never "blocked": the page does not say "no coins" while it is still looking', () => {
  // Every part that rests on the wallet's coins, as the first open part of its step.
  const needCoins: [StepId, number, StepNote][] = [
    ['hold-some', 1, {}],
    ['hold-some', 2, {}],
    ['hold-some', 3, {}],
    ['pass-it-on', 0, {}],
    ['pass-it-on', 1, {}],
    ['pass-it-on', 2, { tx: txid('a1'), sentAt: NOW }],
    ['no-balances', 0, {}],
    ['no-balances', 1, {}],
    ['no-balances', 2, {}],
    ['waiting-room', 0, {}],
    ['waiting-room', 1, { tx: txid('a1'), sentAt: NOW }],
    ['waiting-room', 2, { tx: txid('a1'), sentAt: NOW }],
    ['prove-the-backup', 0, {}],
    ['prove-the-backup', 3, { wallet: FP }],
  ];
  for (const [id, done, extra] of needCoins) {
    assert.deepEqual(open(id, at(id, done, LOOKING, extra)), unknown('looking'), `${id} part ${done + 1}`);
    assert.deepEqual(open(id, at(id, done, SCAN_FAILED, extra)), unknown('scan-failed'), `${id} part ${done + 1}`);
    // Whatever the cause of the failed look.
    assert.deepEqual(open(id, at(id, done, { chain: chain(null, { error: 'unavailable' }), history: null }, extra)), unknown('scan-failed'));
  }
  // Every part that rests on the list of transactions: the coins are known, the list is not (yet, or it could not be read).
  const needList: [StepId, number, StepNote][] = [
    ['hold-some', 3, {}],
    ['pass-it-on', 2, { tx: txid('a1'), sentAt: NOW }],
    ['no-balances', 0, {}],
    ['no-balances', 1, {}],
    ['no-balances', 2, {}],
    ['waiting-room', 1, { tx: txid('a1'), sentAt: NOW }],
    ['waiting-room', 2, { tx: txid('a1'), sentAt: NOW }],
  ];
  const coins = chain(state([{ tx: 'c1', sats: 100_000 }]));
  for (const [id, done, extra] of needList) {
    assert.deepEqual(open(id, at(id, done, { chain: coins, history: null }, extra)), unknown('history'), `${id} part ${done + 1}`);
    assert.deepEqual(open(id, at(id, done, { chain: coins, history: null, historyError: 'network' }, extra)), unknown('history'), `${id} part ${done + 1}: the read failed`);
  }
  // A later read that failed leaves the last values standing, and they are still the facts.
  const stale = at('hold-some', 2, { chain: chain(state([{ tx: 'c1', sats: 100_000, height: null }]), { error: 'network', retryAt: NOW + 15_000 }) });
  assert.equal(open('hold-some', stale)?.state, 'now');
  const oldList = at('pass-it-on', 2, { chain: coins, history: [tx({ tx: 'a1' })], historyError: 'network' }, { tx: txid('a1'), sentAt: NOW });
  // (Its condition holds: until the tick is written it is the part that is now, and never "blocked".)
  assert.deepEqual(open('pass-it-on', oldList), DO);
});

// -- hold-some ---------------------------------------------------------------------------------

test('hold-some: make a wallet, see coins arrive, see them confirm, read the block from outside', () => {
  // 1. A wallet is in this browser. Without one, making it is the thing to do.
  assert.deepEqual(open('hold-some', noWallet({ note: note({ 'hold-some': started(0) }) })), DO);
  assert.equal(verdictOf('hold-some', 1, world()).is, 'met');

  // 2. The wallet has seen coins arrive: it holds a coin, or one of its receive addresses was used.
  assert.deepEqual(open('hold-some', at('hold-some', 1)), DO, 'none yet: ask the faucet');
  assert.deepEqual(open('hold-some', noWallet({ note: note({ 'hold-some': started(1) }) })), blocked('no-wallet'), 'the wallet was removed since');
  for (const coins of [state([{ tx: 'c1', sats: 100_000, height: null }]), state([{ tx: 'c1', sats: 100_000 }]), state([], 1), state([{ tx: 'c2', sats: 500, change: true, height: null }], 0)]) {
    assert.equal(verdictOf('hold-some', 2, world({ chain: chain(coins) })).is, 'met');
  }
  assert.equal(verdictOf('hold-some', 2, world({ chain: chain(state([], 0)) })).is, 'now');

  // 3. The wallet holds a confirmed coin.
  const waiting = at('hold-some', 2, { chain: chain(state([{ tx: 'c1', sats: 100_000, height: null }])) });
  assert.deepEqual(open('hold-some', waiting), { ...DO, txid: txid('c1'), waiting: { txid: txid('c1'), sentAt: null, lost: false } }, 'a coin is here and waits for its block');
  assert.deepEqual(open('hold-some', at('hold-some', 2, { chain: chain(state([], 1)) })), blocked('no-coins'), 'the coins that came are gone again');
  assert.equal(verdictOf('hold-some', 3, world({ chain: chain(state([{ tx: 'c1', sats: 100_000 }])) })).is, 'met');
  assert.equal(verdictOf('hold-some', 3, world({ chain: chain(state([{ tx: 'c1', sats: 1, height: null }, { tx: 'c2', sats: 1, index: 1 }])) })).is, 'met', 'one confirmed coin is enough');

  // 4. The question: the block that took the wallet's first coin in. The part names that coin's transaction.
  const coins = chain(state([{ tx: 'c1', sats: 100_000, height: 150 }]));
  const asked = at('hold-some', 3, { chain: coins, history: [tx({ tx: 'c1', direction: 'received', height: 150 })] });
  assert.deepEqual(judge('hold-some', asked), { id: 'hold-some', state: 'started', parts: [TICKED, TICKED, TICKED, { ...DO, txid: txid('c1') }], at: 4 });
  // The oldest confirmed transaction the wallet only received, however the list is ordered and whatever else is in it.
  const many = [
    tx({ tx: 'e5', direction: 'received', height: null }),
    tx({ tx: 'd4', direction: 'sent', height: 160 }),
    tx({ tx: 'c3', direction: 'received', height: 155 }),
    tx({ tx: 'b2', direction: 'internal', height: 140 }),
    tx({ tx: 'a1', direction: 'received', height: 150 }),
    tx({ tx: 'a0', direction: 'other', height: 100 }),
  ];
  assert.equal(open('hold-some', at('hold-some', 3, { chain: coins, history: many }))?.state === 'now' && (open('hold-some', at('hold-some', 3, { chain: coins, history: many })) as { txid: string }).txid, txid('a1'));
  assert.equal((open('hold-some', at('hold-some', 3, { chain: coins, history: [...many].reverse() })) as { txid: string }).txid, txid('a1'));
  // No confirmed coin was ever received (the list shows only one that still waits): there is no block to ask about.
  assert.deepEqual(open('hold-some', at('hold-some', 3, { chain: coins, history: [tx({ tx: 'c1', direction: 'received', height: null })] })), blocked('no-coins'));
  assert.deepEqual(open('hold-some', at('hold-some', 3, { chain: coins, history: [] })), blocked('no-coins'));
  assert.deepEqual(open('hold-some', noWallet({ note: note({ 'hold-some': started(3) }) })), blocked('no-wallet'));
});

test('hold-some, the block question: right only for the number of that block; digits and commas', () => {
  const coins = chain(state([{ tx: 'c1', sats: 100_000, height: 1_234 }]));
  const history = [tx({ tx: 'c9', direction: 'received', height: 2_000 }), tx({ tx: 'c1', direction: 'received', height: 1_234 })];
  const asked = at('hold-some', 3, { chain: coins, history });
  assert.equal(answerBlock(asked, '1234'), 'right');
  assert.equal(answerBlock(asked, '1,234'), 'right');
  assert.equal(answerBlock(asked, ' 1234 '), 'right');
  for (const wrong of ['1233', '1235', '2000', '2,000', '0', '100000', '12340', '123']) assert.equal(answerBlock(asked, wrong), 'wrong', wrong);
  assert.equal(answerBlock(asked, ''), 'empty');
  assert.equal(answerBlock(asked, '   '), 'empty');
  assert.equal(answerBlock(asked, '1.234'), 'period');
  for (const odd of ['1 234', '12,34', '-1234', '+1234', '1234 blocks', 'block 1234', '0x4d2', '1e3', '\u0661\u0662\u0663\u0664']) assert.equal(answerBlock(asked, odd), 'invalid', odd);

  // The question is not open: its part is not the one that is now, or its facts are not there.
  const closed: World[] = [
    at('hold-some', 2, { chain: coins, history }),
    world({ chain: coins, history, note: note({ 'hold-some': started(4, { doneAt: NOW }) }) }),
    world({ chain: coins, history }),
    at('hold-some', 3, { chain: coins, history: null }),
    at('hold-some', 3, LOOKING),
    at('hold-some', 3, { chain: coins, history: [] }),
    at('hold-some', 3, { status: 'none', record: null }),
    at('hold-some', 3, { chain: coins, history, kept: 'no' }),
    at('hold-some', 3, { chain: coins, history, kept: 'newer' }),
  ];
  for (const seen of closed) assert.equal(answerBlock(seen, '1234'), 'not-now');
});

// -- pass-it-on --------------------------------------------------------------------------------

test('pass-it-on: coins that can be spent, a payment to the pot, its first confirmation', () => {
  // 1. The spendable amount is above 0.
  assert.deepEqual(open('pass-it-on', at('pass-it-on', 0)), blocked('no-coins'));
  assert.deepEqual(open('pass-it-on', noWallet({ note: note({ 'pass-it-on': started(0) }) })), blocked('no-wallet'));
  // A coin somebody else sent cannot be spent before it is in a block.
  assert.deepEqual(open('pass-it-on', at('pass-it-on', 0, { chain: chain(state([{ tx: 'c1', sats: 100_000, height: null }])) })), blocked('not-spendable-yet'));
  assert.equal(verdictOf('pass-it-on', 1, world({ chain: chain(state([{ tx: 'c1', sats: 100_000 }])) })).is, 'met');
  // The wallet's own change can be spent while it still waits.
  assert.equal(verdictOf('pass-it-on', 1, world({ chain: chain(state([{ tx: 'c2', sats: 500, change: true, height: null }])) })).is, 'met');

  // 2. The payment itself is an event: nothing the wallet holds makes it so. What is judged is whether one can be sent.
  const funded = chain(state([{ tx: 'c1', sats: 100_000 }]));
  assert.deepEqual(open('pass-it-on', at('pass-it-on', 1, { chain: funded })), DO);
  assert.equal(verdictOf('pass-it-on', 2, world({ chain: funded })).is, 'now', 'never "met" by a state');
  assert.deepEqual(open('pass-it-on', at('pass-it-on', 1)), blocked('no-coins'), 'the coins went elsewhere in the meantime');
  assert.deepEqual(open('pass-it-on', at('pass-it-on', 1, { chain: chain(state([{ tx: 'c1', sats: 5, height: null }])) })), blocked('not-spendable-yet'));

  // 3. The list holds that payment, confirmed.
  const sent = { tx: txid('a1'), sentAt: NOW - 20_000 };
  const waits = at('pass-it-on', 2, { history: [tx({ tx: 'a1', height: null })] }, sent);
  assert.deepEqual(judge('pass-it-on', waits), {
    id: 'pass-it-on',
    state: 'started',
    parts: [TICKED, TICKED, { ...DO, txid: txid('a1'), waiting: { txid: txid('a1'), sentAt: NOW - 20_000, lost: false } }],
    at: 3,
  });
  assert.equal(verdictOf('pass-it-on', 3, at('pass-it-on', 2, { history: [tx({ tx: 'a1' })] }, sent)).is, 'met');
  // Another payment in a block is not that payment.
  assert.equal(verdictOf('pass-it-on', 3, at('pass-it-on', 2, { history: [tx({ tx: 'b2' }), tx({ tx: 'a1', height: null })] }, sent)).is, 'now');
  assert.deepEqual(open('pass-it-on', noWallet({ note: note({ 'pass-it-on': started(2, sent) }) })), blocked('no-wallet'));
});

test('a noted payment the network does not list: it waits for two minutes, and is lost after that', () => {
  assert.equal(LOST_MS, 120_000);
  for (const id of ['pass-it-on', 'waiting-room'] as const) {
    const done = id === 'pass-it-on' ? 2 : 1;
    const lostAt = (age: number): boolean => {
      const part = open(id, at(id, done, { history: [] }, { tx: txid('a1'), sentAt: NOW - age }));
      assert.ok(part?.state === 'now' && part.waiting !== null, `${id} ${age}`);
      assert.deepEqual([part.txid, part.waiting.txid, part.waiting.sentAt], [txid('a1'), txid('a1'), NOW - age]);
      return part.waiting.lost;
    };
    // Esplora hears of a payment a moment after the node does: not in the list is "not yet".
    assert.equal(lostAt(0), false);
    assert.equal(lostAt(LOST_MS), false);
    assert.equal(lostAt(LOST_MS + 1), true);
    assert.equal(lostAt(3_600_000), true);
    // In the list, however old: it only waits.
    const old = open(id, at(id, done, { history: [tx({ tx: 'a1', height: null })] }, { tx: txid('a1'), sentAt: NOW - 3_600_000 }));
    assert.ok(old?.state === 'now' && old.waiting?.lost === false);
    // A note with the payment and no moment (edited by hand): nothing says it is recent.
    const undated = open(id, at(id, done, { history: [] }, { tx: txid('a1') }));
    assert.ok(undated?.state === 'now' && undated.waiting?.lost === true && undated.waiting.sentAt === null);

    // After "Send another" the note holds no payment: the part waits for one to be sent.
    assert.deepEqual(open(id, at(id, done, { history: [] })), blocked('nothing-sent'), id);
    assert.deepEqual(open(id, at(id, done, { chain: chain(state([{ tx: 'c1', sats: 9 }])), history: null })), blocked('nothing-sent'), 'before the list is even asked for');
  }
});

// -- no-balances -------------------------------------------------------------------------------

test('no-balances: it needs a payment this wallet has sent; then open the coins, count them, read a payment', () => {
  const coins = chain(state([{ tx: 'c1', sats: 70_000 }, { tx: 'a1', sats: 29_718, change: true }]));
  const received = [tx({ tx: 'c1', direction: 'received' })];
  // The need stands in front of every part: without a payment there is no coin used up whole and no change to see.
  for (let done = 0; done < 3; done++) {
    assert.deepEqual(open('no-balances', at('no-balances', done, { chain: coins, history: received })), blocked('nothing-sent'), `part ${done + 1}`);
    assert.deepEqual(open('no-balances', at('no-balances', done, { chain: coins, history: [] })), blocked('nothing-sent'));
    assert.deepEqual(open('no-balances', at('no-balances', done, { chain: coins, history: [tx({ tx: 'x1', direction: 'other' })] })), blocked('nothing-sent'));
    assert.deepEqual(open('no-balances', noWallet({ note: note({ 'no-balances': started(done) }) })), blocked('no-wallet'));
  }
  // A payment to somebody else, or one the wallet made to itself, meets it.
  for (const direction of ['sent', 'internal'] as const) {
    const history = [tx({ tx: 'a1', direction }), ...received];
    // 1. The Coins screen: an event, so what is judged is whether there is a coin to open it for.
    assert.deepEqual(open('no-balances', at('no-balances', 0, { chain: coins, history })), DO);
    assert.equal(verdictOf('no-balances', 1, world({ chain: coins, history })).is, 'now');
    assert.deepEqual(open('no-balances', at('no-balances', 0, { chain: chain(state([], 1)), history })), blocked('no-coins'), 'everything was sent: there are no rows to open');
    // 2. The count.
    assert.deepEqual(open('no-balances', at('no-balances', 1, { chain: coins, history })), DO);
    assert.deepEqual(open('no-balances', at('no-balances', 1, { chain: chain(state([], 1)), history })), blocked('no-coins'));
    // 3. A payment of the wallet's own to read: the part names the newest one. It needs no coin.
    const read = open('no-balances', at('no-balances', 2, { chain: chain(state([], 1)), history: [tx({ tx: 'r9', direction: 'received' }), tx({ tx: 'b2', direction }), tx({ tx: 'a1', direction: 'sent' })] }));
    assert.deepEqual(read, { ...DO, txid: txid('b2') });
  }
});

test('no-balances, the count: right for the number of rows, its own answer for the total in sats, and never the number', () => {
  // Three coins: one confirmed, one unconfirmed, one change. 100,000 sats in all.
  const coins = chain(state([{ tx: 'c1', sats: 60_000 }, { tx: 'c2', sats: 10_282, height: null, index: 1 }, { tx: 'a1', sats: 29_718, change: true }]));
  const asked = at('no-balances', 1, { chain: coins, history: [tx({ tx: 'a1' })] });
  assert.equal(coins.state?.confirmed, 89_718n);
  assert.equal(answerCoins(asked, '3'), 'right');
  assert.equal(answerCoins(asked, ' 3 '), 'right');
  // What the coins add up to is the answer to another question.
  assert.equal(answerCoins(asked, '100000'), 'total');
  assert.equal(answerCoins(asked, '100,000'), 'total');
  for (const wrong of ['0', '1', '2', '4', '30', '89718', '60000', '99999']) assert.equal(answerCoins(asked, wrong), 'wrong', wrong);
  assert.equal(answerCoins(asked, ''), 'empty');
  assert.equal(answerCoins(asked, '3.0'), 'period');
  for (const odd of ['three', '3 coins', '03x', '-3', '1,00']) assert.equal(answerCoins(asked, odd), 'invalid', odd);
  // The answers are words. None of them holds the count or the total.
  for (const typed of ['3', '100000', '7', '', 'x']) assert.doesNotMatch(answerCoins(asked, typed), /[0-9]/);

  // One coin that is worth one sat: the count wins.
  const one = at('no-balances', 1, { chain: chain(state([{ tx: 'c1', sats: 1 }])), history: [tx({ tx: 'a1' })] });
  assert.equal(answerCoins(one, '1'), 'right');

  // Judged only while the coins are known, the need is met and the part is the one that is now.
  const closed: World[] = [
    at('no-balances', 1, LOOKING),
    at('no-balances', 1, { chain: coins, history: null }),
    at('no-balances', 1, { chain: coins, history: [tx({ tx: 'c1', direction: 'received' })] }),
    at('no-balances', 1, { chain: chain(state([], 1)), history: [tx({ tx: 'a1' })] }),
    at('no-balances', 0, { chain: coins, history: [tx({ tx: 'a1' })] }),
    at('no-balances', 2, { chain: coins, history: [tx({ tx: 'a1' })] }),
    world({ chain: coins, history: [tx({ tx: 'a1' })] }),
    at('no-balances', 1, { chain: coins, history: [tx({ tx: 'a1' })], kept: 'no' }),
    at('no-balances', 1, { status: 'none', record: null }),
  ];
  for (const seen of closed) assert.equal(answerCoins(seen, '3'), 'not-now');
});

// -- waiting-room ------------------------------------------------------------------------------

test('waiting-room: a payment, the block that takes it in, and six blocks on top', () => {
  const funded = chain(state([{ tx: 'c1', sats: 100_000 }]));
  // 1. Send a payment: an event. Judged: can one be sent.
  assert.deepEqual(open('waiting-room', at('waiting-room', 0, { chain: funded })), DO);
  assert.deepEqual(open('waiting-room', at('waiting-room', 0)), blocked('no-coins'));
  assert.deepEqual(open('waiting-room', at('waiting-room', 0, { chain: chain(state([{ tx: 'c1', sats: 100_000, height: null }])) })), blocked('not-spendable-yet'));
  assert.equal(verdictOf('waiting-room', 1, world({ chain: funded })).is, 'now');

  // 2. A block takes it in.
  const sent = { tx: txid('a1'), sentAt: NOW - 20_000 };
  const waits = open('waiting-room', at('waiting-room', 1, { history: [tx({ tx: 'a1', height: null })] }, sent));
  assert.deepEqual(waits, { ...DO, txid: txid('a1'), waiting: { txid: txid('a1'), sentAt: NOW - 20_000, lost: false } });
  assert.equal(verdictOf('waiting-room', 2, at('waiting-room', 1, { history: [tx({ tx: 'a1', height: TIP })] }, sent)).is, 'met');

  // 3. Six blocks on top, as a count. The block that holds it is the first.
  assert.equal(SIX_BLOCKS, 6);
  for (let confirmations = 1; confirmations <= 8; confirmations++) {
    const height = TIP - confirmations + 1;
    const seen = at('waiting-room', 2, { history: [tx({ tx: 'a1', height })] }, sent);
    const part = open('waiting-room', seen);
    if (confirmations >= 6) {
      assert.equal(verdictOf('waiting-room', 3, seen).is, 'met', String(confirmations));
    } else {
      assert.deepEqual(part, { ...DO, txid: txid('a1'), waiting: { txid: txid('a1'), sentAt: NOW - 20_000, lost: false }, confirmations }, String(confirmations));
    }
  }
  // The height the page holds is older than the payment's block (the list was read after it): still one confirmation.
  const ahead = open('waiting-room', at('waiting-room', 2, { history: [tx({ tx: 'a1', height: TIP + 2 })] }, sent));
  assert.ok(ahead?.state === 'now' && ahead.confirmations === 1);
  // The height is not known at all: the count cannot be made.
  const noTip = at('waiting-room', 2, { chain: chain(state(), { tip: null }), history: [tx({ tx: 'a1', height: 150 })] }, sent);
  assert.deepEqual(open('waiting-room', noTip), unknown('looking'));
  // Back in the waiting room (the chain was started again), or gone from the list: no confirmations, and lost after two minutes.
  const back = open('waiting-room', at('waiting-room', 2, { history: [tx({ tx: 'a1', height: null })] }, sent));
  assert.ok(back?.state === 'now' && back.confirmations === 0 && back.waiting?.lost === false);
  const gone = open('waiting-room', at('waiting-room', 2, { history: [] }, { tx: txid('a1'), sentAt: NOW - LOST_MS - 1 }));
  assert.ok(gone?.state === 'now' && gone.confirmations === 0 && gone.waiting?.lost === true);
  assert.deepEqual(open('waiting-room', at('waiting-room', 2, { history: [] })), blocked('nothing-sent'));
});

test('once the block has come: how long the payment waited, and which block took it in', () => {
  const sentAt = NOW - 45_000;
  const noted = { tx: txid('a1'), sentAt };
  // The block's own time: 30 seconds after the payment was sent.
  const taken = at('waiting-room', 2, { history: [tx({ tx: 'a1', height: 196, time: (sentAt + 30_000) / 1000 })] }, noted);
  assert.deepEqual(waitedFor('waiting-room', taken), { height: 196, seconds: 30 });
  assert.deepEqual(judge('waiting-room', taken).parts[1], { state: 'ticked', waited: { height: 196, seconds: 30 } });
  // Rounded to whole seconds.
  const odd = at('waiting-room', 2, { history: [tx({ tx: 'a1', height: 196, time: Math.floor((sentAt + 30_600) / 1000) })] }, noted);
  assert.equal(waitedFor('waiting-room', odd)?.seconds, 30);

  // A block's time can be off. One that says the block came before the payment, or after now, is not used.
  for (const time of [sentAt / 1000 - 1, NOW / 1000 + 1, NOW / 1000 + 600, null]) {
    const off = at('waiting-room', 2, { history: [tx({ tx: 'a1', height: 196, time })] }, noted);
    assert.deepEqual(waitedFor('waiting-room', off), { height: 196, seconds: null }, String(time));
  }
  // At the edges it is used: sent in the block's own second, and a block dated this very moment.
  assert.equal(waitedFor('waiting-room', at('waiting-room', 2, { history: [tx({ tx: 'a1', height: 196, time: sentAt / 1000 })] }, noted))?.seconds, 0);
  assert.equal(waitedFor('waiting-room', at('waiting-room', 2, { history: [tx({ tx: 'a1', height: 196, time: NOW / 1000 })] }, noted))?.seconds, 45);

  // Nothing to say: not in a block yet, not in the list, the list not read, or the note holds the payment no longer.
  assert.equal(waitedFor('waiting-room', at('waiting-room', 1, { history: [tx({ tx: 'a1', height: null })] }, noted)), null);
  assert.equal(waitedFor('waiting-room', at('waiting-room', 2, { history: [] }, noted)), null);
  assert.equal(waitedFor('waiting-room', at('waiting-room', 2, { chain: chain(state()), history: null }, noted)), null);
  assert.equal(waitedFor('waiting-room', at('waiting-room', 2, { history: [tx({ tx: 'a1', height: 196 })] })), null);
  assert.equal(waitedFor('hold-some', taken), null, 'each step for its own payment');
  // A done step has let go of its payment, so its ticked parts carry no such line any more.
  const done = world({ history: [tx({ tx: 'a1', height: 150 })], note: note({ 'pass-it-on': started(3, { doneAt: NOW }) }) });
  assert.deepEqual(judge('pass-it-on', done).parts, [TICKED, TICKED, TICKED]);
  // A payment without its moment in the note: the block, and no seconds.
  assert.deepEqual(waitedFor('waiting-room', at('waiting-room', 2, { history: [tx({ tx: 'a1', height: 196 })] }, { tx: txid('a1') })), { height: 196, seconds: null });
});

// -- the-seed ----------------------------------------------------------------------------------

test('the-seed: show the words, write them down, check three of them', () => {
  // 1. An event. With a wallet here the reader can go and look.
  assert.deepEqual(open('the-seed', at('the-seed', 0)), DO);
  assert.deepEqual(open('the-seed', at('the-seed', 0, { record: record('passkey'), unlocked: false })), DO, 'a locked wallet too: Backup unlocks it');
  assert.equal(verdictOf('the-seed', 1, world({ wordsShown: 5 })).is, 'now', 'never "met" by a state');
  // 2. The reader's own word.
  assert.deepEqual(open('the-seed', at('the-seed', 1)), DO);
  // 3. The question. A passkey wallet whose keys are not loaded goes through the unlock step first.
  assert.deepEqual(open('the-seed', at('the-seed', 2)), DO);
  assert.deepEqual(open('the-seed', at('the-seed', 2, { record: record('passkey'), unlocked: false })), { ...DO, unlock: true });
  assert.deepEqual(open('the-seed', at('the-seed', 2, { record: record('passkey'), unlocked: true })), DO);
  // It needs no coins, and does not wait for the wallet's first look at them.
  for (const spec of [LOOKING, SCAN_FAILED]) {
    for (let done = 0; done < 3; done++) assert.deepEqual(open('the-seed', at('the-seed', done, spec)), DO);
  }
  // Every part needs a wallet in this browser.
  for (let done = 0; done < 3; done++) {
    assert.deepEqual(open('the-seed', noWallet({ note: note({ 'the-seed': started(done) }) })), blocked('no-wallet'), `part ${done + 1}`);
  }
});

test('the-seed, once checked: is the wallet in this browser the one its words were checked for', () => {
  const done = note({ 'the-seed': started(3, { doneAt: NOW, wallet: FP }) });
  assert.equal(seedWallet(world({ note: done })), 'same');
  assert.equal(seedWallet(world({ note: done, record: record('passkey') })), 'same', 'however this browser keeps it');
  assert.equal(seedWallet(world({ note: done, record: record('words', OTHER_FP) })), 'other');
  assert.equal(seedWallet(noWallet({ note: done })), 'none');
  assert.equal(seedWallet(world({ note: done, status: 'unreadable', record: null })), 'none');
  assert.equal(seedWallet(world()), 'none', 'nothing was checked');
  assert.equal(seedWallet(world({ note: note({ 'the-seed': started(2) }) })), 'none');
});

test('three places to ask for: all different, in rising order, from the whole phrase', () => {
  assert.equal(WORD_CHECKS, 3);
  // The same rolls give the same places. 0 always takes the first place that is left.
  assert.deepEqual(pickPositions(() => 0), [0, 1, 2]);
  assert.deepEqual(pickPositions(() => 0.999999), [9, 10, 11]);
  const rolls = [0.5, 0, 0.99];
  assert.deepEqual(pickPositions(() => rolls.shift() ?? 0), [0, 6, 11]);
  // Every place can come up, and no pick ever repeats a place or leaves the phrase.
  const seen = new Set<number>();
  let roll = 0;
  for (let round = 0; round < 500; round++) {
    const picked = pickPositions(() => {
      roll = (roll + 0.618_033_988_749) % 1;
      return roll;
    });
    assert.equal(picked.length, 3);
    assert.equal(new Set(picked).size, 3);
    assert.deepEqual(picked, [...picked].sort((a, b) => a - b));
    for (const place of picked) {
      assert.ok(Number.isInteger(place) && place >= 0 && place <= 11, String(place));
      seen.add(place);
    }
  }
  assert.equal(seen.size, 12);
  // With the browser's own source, and with one that gives nonsense: still three good places.
  assert.equal(new Set(pickPositions()).size, 3);
  for (const broken of [() => 1, () => -1, () => Number.NaN, () => 7, () => 'x' as unknown as number]) {
    assert.deepEqual(pickPositions(broken), [0, 1, 2]);
  }
});

test('a check of three words is passed only when the wallet compared three different places and none was wrong', () => {
  assert.equal(wordsPassed([0, 5, 11], { ok: true, wrong: [] }), true);
  assert.equal(wordsPassed([0, 5, 11], { ok: true, wrong: [5] }), false);
  assert.equal(wordsPassed([0, 5, 11], { ok: true, wrong: [0, 5, 11] }), false);
  for (const reason of ['locked', 'reload', 'gone'] as const) assert.equal(wordsPassed([0, 5, 11], { ok: false, reason }), false);
  // Nothing asked proves nothing; neither does less than three, more, the same place twice, or a place the phrase does not have.
  for (const places of [[], [3], [3, 4], [1, 2, 3, 4], [3, 3, 4], [0, 0, 0], [0, 5, 12], [-1, 5, 11], [0, 5.5, 11], [0, 5, Number.NaN]]) {
    assert.equal(wordsPassed(places, { ok: true, wrong: [] }), false, JSON.stringify(places));
  }
  // What pickPositions() gives always qualifies.
  for (let round = 0; round < 50; round++) assert.equal(wordsPassed(pickPositions(), { ok: true, wrong: [] }), true);
});

// -- prove-the-backup --------------------------------------------------------------------------

test('prove-the-backup: check the paper, remove the wallet, restore it from the 12 words, find the coins again', () => {
  const funded = chain(state([{ tx: 'c1', sats: 100_000 }]));
  // 1. The paper check, for a wallet that holds coins: finding them again is how the drill ends.
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 0, { chain: funded })), DO);
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 0, { chain: funded, record: record('passkey'), unlocked: false })), { ...DO, unlock: true });
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 0)), blocked('no-coins'));
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 0, { chain: chain(state([], 1)) })), blocked('no-coins'), 'coins it once had do not count');
  assert.deepEqual(open('prove-the-backup', noWallet({ note: note({ 'prove-the-backup': started(0) }) })), blocked('no-wallet'));
  assert.ok(open('prove-the-backup', at('prove-the-backup', 0, { chain: chain(state([{ tx: 'c1', sats: 100_000, height: null }])) }))?.state === 'now', 'a coin that still waits is a coin');
  // Already passed, in the-seed, for this same wallet: the condition holds without asking again.
  const checked = (wallet: string, parts = 3): Parameters<typeof note>[0] => ({ 'the-seed': started(parts, { wallet, ...(parts === 3 ? { doneAt: NOW } : {}) }) });
  assert.equal(verdictOf('prove-the-backup', 1, at('prove-the-backup', 0, { chain: funded }, {}, checked(FP))).is, 'met');
  assert.equal(verdictOf('prove-the-backup', 1, at('prove-the-backup', 0, { chain: funded }, {}, checked(OTHER_FP))).is, 'now', 'for another wallet: asked again');
  assert.equal(verdictOf('prove-the-backup', 1, at('prove-the-backup', 0, { chain: funded }, {}, checked(FP, 2))).is, 'now');
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 0, {}, {}, checked(FP))), blocked('no-coins'), 'and still only for a wallet that holds coins');

  // 2. Remove the wallet whose words were checked: an event. With that wallet here, the reader can.
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 1, { chain: funded }, { wallet: FP, was: 'words' })), DO);
  assert.equal(verdictOf('prove-the-backup', 2, at('prove-the-backup', 1, { status: 'none', record: null }, { wallet: FP })).is, 'blocked', 'never "met" by a state');
  // Another wallet is here: removing that one proves nothing about the paper that was checked.
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 1, { record: record('words', OTHER_FP) }, { wallet: FP, was: 'words' })), blocked('another-wallet'));
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 1, {}, {})), blocked('another-wallet'), 'the note names no wallet at all');
  // No wallet here, and the part not ticked: it was not removed while the step was followed.
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 1, { status: 'none', record: null }, { wallet: FP, was: 'words' })), blocked('no-wallet'));

  // 3. Restore it from the 12 words. With no wallet here, that is the thing to do.
  const removed = { wallet: FP, was: 'passkey' as const };
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 2, { status: 'none', record: null }, removed)), DO);
  // Back through its passkey: that proves the passkey, not the paper.
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 2, { record: record('passkey'), unlocked: true }, removed)), blocked('came-back-with-passkey'));
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 2, { record: record('passkey'), unlocked: false }, removed)), blocked('came-back-with-passkey'));
  // Another wallet, restored or made new, with its words or with a passkey.
  for (const kind of ['words', 'passkey'] as const) {
    assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 2, { record: record(kind, OTHER_FP) }, removed)), blocked('another-wallet'), kind);
  }
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 2, {}, { was: 'words' })), blocked('another-wallet'), 'no wallet is named');
  // The same wallet, kept with its words: only a restore from the 12 words writes that for it.
  assert.equal(verdictOf('prove-the-backup', 3, at('prove-the-backup', 2, {}, removed)).is, 'met');
  // It does not wait for the coins: the restore itself is the proof.
  assert.equal(verdictOf('prove-the-backup', 3, at('prove-the-backup', 2, LOOKING, removed)).is, 'met');

  // 4. Its coins are known and their total is above 0.
  assert.equal(verdictOf('prove-the-backup', 4, at('prove-the-backup', 3, { chain: funded }, removed)).is, 'met');
  assert.equal(verdictOf('prove-the-backup', 4, at('prove-the-backup', 3, { chain: chain(state([{ tx: 'c1', sats: 100_000, height: null }])) }, removed)).is, 'met', 'a total above 0, confirmed or not');
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 3, {}, removed)), blocked('no-coins'));
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 3, LOOKING, removed)), unknown('looking'));
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 3, { chain: funded, record: record('words', OTHER_FP) }, removed)), blocked('another-wallet'));
  assert.deepEqual(open('prove-the-backup', at('prove-the-backup', 3, { status: 'none', record: null }, removed)), blocked('no-wallet'));
});

// -- where nothing can be written ----------------------------------------------------------------

test('where progress cannot be written, the parts are shown as the wallet stands, and the first that needs a tick says "storage"', () => {
  const funded = chain(state([{ tx: 'c1', sats: 100_000 }]));
  const history = [tx({ tx: 'c1', direction: 'received' })];
  for (const kept of ['no', 'newer'] as const) {
    // hold-some: three states of the wallet hold, one after another; the question cannot be kept.
    assert.deepEqual(judge('hold-some', world({ kept, chain: funded, history })), {
      id: 'hold-some',
      state: 'not-started',
      parts: [TICKED, TICKED, TICKED, blocked('storage')],
      at: 4,
    });
    // As far as the wallet stands, and what is missing next.
    assert.deepEqual(judge('hold-some', noWallet({ kept })).parts, [DO, LATER, LATER, LATER]);
    assert.deepEqual(judge('hold-some', world({ kept })).parts, [TICKED, DO, LATER, LATER]);
    assert.deepEqual(judge('hold-some', world({ kept, ...LOOKING })).parts, [TICKED, unknown('looking'), LATER, LATER]);
    assert.deepEqual(judge('hold-some', world({ kept, chain: chain(state([{ tx: 'c1', sats: 1, height: null }])) })).parts[2]?.state, 'now');
    // A step that begins with something to do, a question or the reader's word stops at once.
    assert.deepEqual(judge('pass-it-on', world({ kept, chain: funded })).parts, [TICKED, blocked('storage'), LATER]);
    assert.deepEqual(judge('pass-it-on', world({ kept })).parts, [blocked('no-coins'), LATER, LATER]);
    for (const id of ['no-balances', 'waiting-room', 'the-seed', 'prove-the-backup'] as const) {
      const view = judge(id, world({ kept, chain: funded, history }));
      assert.deepEqual([view.at, view.parts[0]], [1, blocked('storage')], id);
      assert.ok(view.parts.slice(1).every((part) => part.state === 'later'), id);
    }
    // Trouble with the wallet is said as trouble, not as storage: each kind under its own reason.
    for (const [status, reason] of TROUBLE) {
      assert.deepEqual(judge('the-seed', world({ kept, status, record: null })).parts[0], blocked(reason), status);
    }
    // No question is open, so no answer is taken.
    assert.equal(answerBlock(world({ kept, chain: funded, history }), '190'), 'not-now');
  }
  // Ticks that are in the note from better days are still honoured ("no": a browser that used to store).
  const earlier = world({ kept: 'no', chain: funded, history, note: note({ 'the-seed': started(2), 'pass-it-on': started(2, { tx: txid('a1'), sentAt: NOW }) }) });
  assert.deepEqual(judge('the-seed', earlier), { id: 'the-seed', state: 'started', parts: [TICKED, TICKED, blocked('storage')], at: 3 });
  // A state of the wallet that does not hold yet is what it is.
  assert.equal(judge('pass-it-on', earlier).parts[2]?.state, 'now');
});

// -- what judge is, and is not, given ----------------------------------------------------------------

test('judge never looks at what just happened: not the payment this page last sent, not the count of words shown, not the screen', () => {
  // A world whose three "what happened" things cannot be read at all.
  const guarded = (base: World): World => {
    const wallet = new Proxy(base.wallet, {
      get(target, key, receiver) {
        if (key === 'lastSent' || key === 'wordsShown') throw new Error(`judge read ${String(key)}`);
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    return new Proxy({ ...base, wallet }, {
      get(target, key, receiver) {
        if (key === 'route') throw new Error('judge read the route');
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
  };
  const funded = chain(state([{ tx: 'c1', sats: 60_000 }, { tx: 'a1', sats: 29_718, change: true }]));
  const history = [tx({ tx: 'a1', height: null }), tx({ tx: 'c1', direction: 'received' })];
  const paid = { txid: txid('a1'), toPot: true, at: NOW - 5_000 };
  for (const id of STEPS) {
    for (let done = 0; done <= partCount(id); done++) {
      const extra: StepNote = { tx: txid('a1'), sentAt: NOW - 5_000, wallet: FP, ...(done === partCount(id) ? { doneAt: NOW } : {}) };
      const base = at(id, done, { chain: funded, history, lastSent: paid, wordsShown: 3, route: { name: 'coins' } }, extra);
      const view = judge(id, guarded(base));
      // And the same world with nothing having happened, on another screen, is judged the same.
      const quiet = change(base, { lastSent: null, wordsShown: 0 }, { route: { name: 'step', id } });
      assert.deepEqual(judge(id, quiet), view, `${id} ${done}`);
      for (let part = 1; part <= partCount(id); part++) assert.deepEqual(verdictOf(id, part, guarded(base)), verdictOf(id, part, quiet));
    }
  }
  const asked = at('no-balances', 1, { chain: funded, history, lastSent: paid, wordsShown: 3 });
  assert.equal(answerCoins(guarded(asked), '2'), 'right');
  assert.equal(seedWallet(guarded(asked)), 'none');
  assert.equal(waitedFor('waiting-room', guarded(asked)), null);
});

test('judge is pure: it changes nothing it is handed, and the same world gives the same answer', () => {
  const funded = chain(state([{ tx: 'c1', sats: 60_000 }, { tx: 'c2', sats: 500, height: null, index: 1 }]));
  const history = [tx({ tx: 'a1', height: null }), tx({ tx: 'c1', direction: 'received', height: 150 })];
  for (const id of STEPS) {
    for (let done = 0; done < partCount(id); done++) {
      const seen = frozen(at(id, done, { chain: funded, history }, { tx: txid('a1'), sentAt: NOW - 1000, wallet: FP }));
      const first = judge(id, seen);
      assert.deepEqual(judge(id, seen), first, `${id} ${done}`);
      assert.notEqual(judge(id, seen), first, 'a fresh answer each time');
      assert.equal(first.parts.length, partCount(id));
      assert.equal(first.id, id);
    }
  }
  // A part number the step does not have is never "met".
  for (const part of [0, 5, 1.5, -1]) assert.notEqual(verdictOf('the-seed', part, world()).is, 'met', String(part));
});

test('the wallet\'s part of a world is a picture of one moment: one value for each property the steps look at', () => {
  const live = { ...world({ lastSent: { txid: txid('a1'), toPot: false, at: NOW }, wordsShown: 2 }).wallet, config: 'not looked at', notice: null };
  const facts = walletFacts(live);
  assert.deepEqual(Object.keys(facts).sort(), ['chain', 'history', 'historyError', 'lastSent', 'record', 'status', 'unlocked', 'wordsShown']);
  for (const key of Object.keys(facts) as (keyof typeof facts)[]) assert.equal(facts[key], live[key], key);
  assert.notEqual(facts, live);
  // An empty note is a note.
  assert.deepEqual(judge('hold-some', { wallet: facts, note: emptyProgress(), kept: 'yes', now: NOW }).state, 'not-started');
});

// -- found by breaking judge.ts on purpose, one line at a time ---------------------------------
//
// Each test below pins a line that could be changed without any other test noticing.

test('how long a payment waited is said to the nearest whole second, however long it was', () => {
  // The block's own time is in whole seconds. The moment the payment was sent is not.
  const block = Math.floor(NOW / 1000) - 30;
  const waitedAfter = (ms: number): number | null | undefined =>
    waitedFor('pass-it-on', at('pass-it-on', 2, { history: [tx({ tx: 'a1', height: 196, time: block })] }, { tx: txid('a1'), sentAt: block * 1000 - ms }))?.seconds;
  assert.equal(waitedAfter(23_400), 23);
  assert.equal(waitedAfter(23_600), 24, 'to the nearest second, not cut off');
  assert.equal(waitedAfter(499), 0);
  assert.equal(waitedAfter(500), 1);
  // Two hours and a day, to the second: a thousand ms to the second, exactly.
  assert.equal(waitedAfter(7_200_000), 7_200);
  assert.equal(waitedAfter(86_400_000), 86_400);
  // A block with no time of its own says nothing of the wait, whatever moment the note holds (the very first one included).
  for (const sentAt of [0, 1, NOW - 60_000]) {
    const untimed = at('pass-it-on', 2, { history: [tx({ tx: 'a1', height: 196, time: null })] }, { tx: txid('a1'), sentAt });
    assert.deepEqual(waitedFor('pass-it-on', untimed), { height: 196, seconds: null }, String(sentAt));
  }
});

test('a transaction said to be in a block whose number is not known is not counted as in one', () => {
  // The list never holds such a transaction (the network gives the block with the confirmation).
  // Should it ever, nothing is asked about it, nothing is said of its wait, and it is never six blocks deep.
  const unplaced = (tag: string, direction: 'sent' | 'received' = 'sent'): TxView => ({ ...tx({ tx: tag, direction }), height: null });
  const coins = chain(state([{ tx: 'c1', sats: 50_000 }]));

  // hold-some: there is no block to ask about.
  assert.deepEqual(open('hold-some', at('hold-some', 3, { chain: coins, history: [unplaced('c1', 'received')] })), blocked('no-coins'));
  assert.equal(answerBlock(at('hold-some', 3, { chain: coins, history: [unplaced('c1', 'received')] }), String(TIP - 10)), 'not-now');

  // waiting-room: the noted payment counts no blocks, and has no "It waited" line.
  const noted = { tx: txid('a1'), sentAt: NOW - 60_000 };
  const waiting = at('waiting-room', 2, { chain: coins, history: [unplaced('a1')] }, noted);
  assert.equal(waitedFor('waiting-room', waiting), null);
  assert.deepEqual(judge('waiting-room', waiting).parts, [
    TICKED,
    TICKED,
    { state: 'now', txid: txid('a1'), waiting: { txid: txid('a1'), sentAt: NOW - 60_000, lost: false }, confirmations: 0, unlock: false },
  ]);
  assert.equal(verdictOf('waiting-room', 3, waiting).is, 'now');
});

test('the first coin is the oldest transaction the wallet received: of two in one block, the one listed later', () => {
  const coins = chain(state([{ tx: 'c1', sats: 50_000 }]));
  // The list is newest first, so of two transactions in one block the later entry is the older one.
  const twins = [tx({ tx: 'r2', direction: 'received', height: 150 }), tx({ tx: 'r1', direction: 'received', height: 150 })];
  assert.deepEqual(open('hold-some', at('hold-some', 3, { chain: coins, history: twins })), { ...DO, txid: txid('r1') });
  // And a newer one never takes its place, wherever it stands in the list.
  const mixed = [tx({ tx: 'r3', direction: 'received', height: 160 }), ...twins, tx({ tx: 'r4', direction: 'received', height: 155 })];
  assert.deepEqual(open('hold-some', at('hold-some', 3, { chain: coins, history: mixed })), { ...DO, txid: txid('r1') });
  for (const [typed, answer] of [['150', 'right'], ['160', 'wrong'], ['155', 'wrong']] as const) {
    assert.equal(answerBlock(at('hold-some', 3, { chain: coins, history: mixed }), typed), answer, typed);
  }
});

test('a part that waits for a payment says "no wallet" before it says "nothing sent"', () => {
  // After "Send another" the note holds no payment. With no wallet here either, the wallet is what is missing first.
  for (const [id, done] of [['pass-it-on', 2], ['waiting-room', 1], ['waiting-room', 2]] as const) {
    assert.deepEqual(open(id, at(id, done, { status: 'none', record: null })), blocked('no-wallet'), id);
    for (const [status, reason] of TROUBLE) assert.deepEqual(open(id, at(id, done, { status, record: null })), blocked(reason), `${id} ${status}`);
    // A wallet is here: then it is the payment that is missing.
    assert.deepEqual(open(id, at(id, done, { chain: chain(state([{ tx: 'c1', sats: 50_000 }])) })), blocked('nothing-sent'), id);
  }
});

test('a wallet is here only when the status says "ready" and there is a record: a world that says half of that holds no wallet', () => {
  // The wallet publishes a record exactly when its status is "ready". Should the two ever disagree, no step reads a wallet into it.
  const coins = chain(state([{ tx: 'c1', sats: 50_000 }]));
  const history = [tx({ tx: 'c1', direction: 'received' })];
  const halves: WorldSpec[] = [
    { status: 'ready', record: null, chain: coins, history },
    { status: 'none', record: record(), chain: coins, history },
  ];
  for (const half of halves) {
    const label = `${half.status}, ${half.record === null ? 'no record' : 'a record'}`;
    // hold-some: its first part is still to do, and is not taken as met.
    assert.equal(verdictOf('hold-some', 1, at('hold-some', 0, half)).is, 'now', label);
    assert.deepEqual(judge('hold-some', at('hold-some', 0, half)).parts, [DO, LATER, LATER, LATER], label);
    assert.deepEqual(open('pass-it-on', at('pass-it-on', 0, half)), blocked('no-wallet'), label);
    assert.deepEqual(open('the-seed', at('the-seed', 0, half)), blocked('no-wallet'), label);
    // The drill, after the removal: nothing is here, so the one thing to do is restore. Never "restored".
    const drill = at('prove-the-backup', 2, half, { wallet: FP, was: 'words' });
    assert.deepEqual(verdictOf('prove-the-backup', 3, drill), { is: 'now', txid: null, waiting: null, confirmations: null, unlock: false }, label);
    assert.equal(seedWallet(world({ ...half, note: note({ 'the-seed': started(3, { doneAt: NOW, wallet: FP }) }) })), 'none', label);
  }
});

test('a step whose note says it is done shows every part ticked, even where the note holds fewer ticks than parts', () => {
  // A note changed by hand, or by a later version that adds a part to a step: done stays done.
  for (const id of STEPS) {
    const some = note({ [id]: { started: true, doneAt: NOW - 1_000, parts: { 1: true } } });
    const view = judge(id, noWallet({ note: some }));
    assert.deepEqual(view, { id, state: 'done', parts: Array.from({ length: partCount(id) }, (): PartView => TICKED), at: null }, id);
  }
});
