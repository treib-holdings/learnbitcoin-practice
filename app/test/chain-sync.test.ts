// chain-sync.ts against a small stand-in network and a clock driven by hand.
//
// What is proved here: when the engine reads the network and when it does
// not (every request is counted), what it shows before, during and after a
// read, what it does when a read fails, and that nothing of a read that
// failed, or that belongs to a wallet no longer in the page, is ever shown.
// The same code runs against the Worker's real handler and the stand-in
// practice network in e2e/test/engine.test.ts.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  accountFromMnemonic,
  applyPayment,
  deriveAddress,
  planPayment,
  signPayment,
  watchOnlyAccount,
  type PaymentRequest,
  type SignedPayment,
  type WalletState,
} from '@learnbitcoin/practice-wallet';
import { makeApi } from '../src/lib/api.ts';
import { FAUCET_REQUEST_MS, REQUEST_MS, makeBoard, makeChainSync, withDeadline, type ChainSync } from '../src/lib/chain-sync.ts';
import { CONFIG_RETRY_MS, DEFAULT_CONFIG, loadConfig } from '../src/lib/config.ts';
import type { TxLookup } from '../src/lib/wallet-api.ts';
import {
  CHAIN_PAGE,
  FIRST_PAGE,
  FakeClock,
  FakeNetwork,
  FakeTimers,
  POT,
  SOMEONE,
  flush,
  giveUpOn,
  recorder,
  test,
  type Failure,
} from './engine-fakes.ts';

interface VectorWallet {
  mnemonic: string;
  xpub: string;
}

const vectors = JSON.parse(readFileSync(new URL('../../wallet/test/vectors.json', import.meta.url), 'utf8')) as {
  abandon: VectorWallet;
  prf: { wallet: VectorWallet };
};

/** The wallet most tests watch, and a second one for "another wallet arrived". */
const A = accountFromMnemonic(vectors.abandon.mnemonic);
const B = accountFromMnemonic(vectors.prf.wallet.mnemonic);
const watchA = watchOnlyAccount(A.xpub);
const receive = (index: number): string => deriveAddress(watchA, 0, index).address;
const change = (index: number): string => deriveAddress(watchA, 1, index).address;

const TIP = /GET \/api\/esplora\/blocks\/tip\/height$/;
const ADDRESS = /GET \/api\/esplora\/address\/[a-z0-9]+$/;
const UTXO = /\/utxo$/;
const TXS = /\/txs$/;
const BROADCAST = /POST \/api\/esplora\/tx$/;

/**
 * A chain engine on the stand-ins, with nothing else around it. With
 * `deadline`, its requests have the app's time limit, counted on the test's
 * clock: the client as wallet.svelte.ts builds it.
 */
function watching(net: FakeNetwork = new FakeNetwork(), options: { deadline?: boolean } = {}) {
  const clock = new FakeClock();
  const timers = new FakeTimers(clock);
  const counted = recorder();
  const page = { visible: true, blockSeconds: 30 };
  const chain = makeChainSync({
    api: makeApi(options.deadline ? withDeadline(net.fetch, giveUpOn(timers)) : net.fetch),
    now: clock.now,
    timers,
    visible: () => page.visible,
    track: counted.track,
    blockSeconds: () => page.blockSeconds,
  });
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 3; round++) {
      await flush();
      await chain.idle();
    }
    await flush();
  };
  return {
    chain,
    net,
    clock,
    timers,
    page,
    events: counted.events,
    unlisted: counted.unlisted,
    settle,
    advance: (ms: number) => timers.advance(ms, settle),
    show(visible: boolean): void {
      page.visible = visible;
      chain.visibilityChanged();
    },
    /** Forgets the requests counted so far. */
    reset(): void {
      net.requests.length = 0;
    },
    view: () => chain.view().chain,
  };
}

/** A watched wallet whose first scan has finished. `fund` runs first, to put coins on the chain. */
async function opened(fund?: (net: FakeNetwork) => void) {
  const w = watching();
  fund?.(w.net);
  const first = w.chain.open(A.xpub);
  await w.settle();
  w.reset();
  return { ...w, first };
}

function stateOf(chain: ChainSync): WalletState {
  const state = chain.state();
  assert.ok(state, 'the first scan has finished');
  return state;
}

/** A payment signed with the wallet's own key, as session.ts would sign it. */
function signed(chain: ChainSync, request: PaymentRequest): SignedPayment {
  return signPayment(A.key, stateOf(chain), request);
}

/** Every notice the engine shows from now on, in order: "1: payment-sent", "2: coins-arrived 5000". */
function noticesOf(chain: ChainSync): string[] {
  const notices: string[] = [];
  chain.subscribe(() => {
    const notice = chain.view().notice;
    if (notice === null) return;
    const text = notice.kind === 'coins-arrived' ? `${notice.id}: ${notice.kind} ${notice.sats}` : `${notice.id}: ${notice.kind}`;
    if (notices.at(-1) !== text) notices.push(text);
  });
  return notices;
}

/** A few turns of the event loop, for tests in which a request gets no answer: chain.idle() would wait for it. */
async function turns(): Promise<void> {
  for (let turn = 0; turn < 12; turn++) await flush();
}

// -- how state is shown ---------------------------------------------------------

test('a board tells its listeners only when a field really changed, and one that throws does not stop the rest', () => {
  const board = makeBoard({ count: 0, list: ['a'] });
  const heard: number[] = [];
  board.subscribe(() => {
    throw new Error('a listener of its own mind');
  });
  const stop = board.subscribe(() => heard.push(board.view().count));

  const before = board.view();
  board.set({ count: 0, list: before.list });
  assert.equal(board.view(), before, 'the same values: the same snapshot, and nobody is told');
  assert.deepEqual(heard, []);

  board.set({ count: 1 });
  assert.deepEqual(heard, [1]);
  assert.notEqual(board.view(), before, 'a change is a new snapshot');
  assert.equal(before.count, 0, 'and the old one is left as it was');
  assert.equal(board.view().list, before.list, 'a part that did not change is the same object');

  stop();
  board.set({ count: 2 });
  assert.deepEqual(heard, [1]);
});

// -- the first scan -------------------------------------------------------------

test('the first scan: nothing is shown until it has finished, and never a total of zero in its place', async () => {
  const w = watching();
  assert.deepEqual(w.chain.view(), {
    wallet: 0,
    chain: { state: null, scanning: false, error: null, checkedAt: null, retryAt: null, tip: null, slow: false },
    history: null,
    historyError: null,
    receive: null,
    notice: null,
    lastSent: null,
  });

  const first = w.chain.open(A.xpub);
  // Under way: no coins yet, and nothing that could be taken for an empty wallet.
  assert.deepEqual(w.view(), { state: null, scanning: true, error: null, checkedAt: null, retryAt: null, tip: null, slow: false });
  assert.equal(w.chain.view().wallet, 1);
  assert.equal(w.chain.state(), null);
  assert.equal(w.chain.view().receive, null);

  await w.settle();
  const state = stateOf(w.chain);
  assert.equal(w.view().state, state);
  assert.deepEqual([state.confirmed, state.unconfirmed, state.coins.length], [0n, 0n, 0]);
  assert.deepEqual(
    { ...w.view(), state: null },
    { state: null, scanning: false, error: null, checkedAt: w.clock.ms, retryAt: null, tip: 100, slow: false },
  );
  // The Receive screen's address: the first one nobody has paid.
  assert.deepEqual(w.chain.view().receive, { address: receive(0), index: 0, arrived: 0n });
  assert.deepEqual(await first, { history: false });
  // The height, then 20 unused addresses on each chain, with the public key alone.
  assert.equal(w.net.requests.length, 41);
  assert.equal(w.net.count(TIP), 1);
  assert.equal(w.net.count(ADDRESS), 40);
  // A first scan is not news.
  assert.equal(w.chain.view().notice, null);
});

test('the first scan of a wallet with history: its coins, and the first unused address after the gaps', async () => {
  const w = watching();
  w.net.pay(receive(0), 100_000, { confirmed: true });
  w.net.pay(receive(2), 25_000, { confirmed: true });
  w.net.pay(change(0), 40_000);
  const first = w.chain.open(A.xpub);
  await w.settle();

  const state = stateOf(w.chain);
  assert.deepEqual([state.confirmed, state.unconfirmed], [125_000n, 40_000n]);
  assert.deepEqual([state.nextReceiveIndex, state.nextChangeIndex], [3, 1]);
  assert.deepEqual(await first, { history: true });
  // Index 1 was skipped over and is still unused: it is the one to show.
  assert.deepEqual(w.chain.view().receive, { address: receive(1), index: 1, arrived: 0n });
  assert.equal(w.view().tip, 102);
  assert.equal(w.chain.view().notice, null, 'what a first scan finds did not "arrive"');
});

test('a failed first scan: the reason, no coins, and another try after 15 s, 30 s, then every 60 s', async () => {
  const w = watching();
  w.net.down = 'network';
  void w.chain.open(A.xpub);
  w.chain.watch('wallet');
  await w.settle();
  assert.deepEqual(w.view(), {
    state: null,
    scanning: false,
    error: 'network',
    checkedAt: null,
    retryAt: w.clock.ms + 15_000,
    tip: null,
    slow: false,
  });
  assert.deepEqual(w.timers.dueIn(), [15_000], 'one timer, set for the moment shown');

  const tries = () => w.net.count(TIP);
  assert.equal(tries(), 1);
  await w.advance(14_999);
  assert.equal(tries(), 1, 'not before its time');
  await w.advance(1);
  assert.equal(tries(), 2);
  assert.equal(w.view().retryAt, w.clock.ms + 30_000);

  await w.advance(30_000);
  assert.equal(tries(), 3);
  assert.equal(w.view().retryAt, w.clock.ms + 60_000);
  await w.advance(60_000);
  assert.equal(tries(), 4);
  assert.equal(w.view().retryAt, w.clock.ms + 60_000, 'every 60 s from then on');
  assert.equal(w.view().state, null);
  assert.equal(w.chain.view().receive, null);

  // The network is back: the next try works, and says so.
  w.net.down = null;
  await w.advance(60_000);
  assert.deepEqual(
    { ...w.view(), state: null },
    { state: null, scanning: false, error: null, checkedAt: w.clock.ms, retryAt: null, tip: 100, slow: false },
  );
  assert.equal(stateOf(w.chain).confirmed, 0n);
  assert.deepEqual(w.timers.dueIn(), [15_000], 'the tries are over: what is set now is the poll');
});

test('each way a read can fail has its own word', async () => {
  const cases: [Failure, string][] = [
    ['network', 'network'],
    ['limit', 'limit'],
    ['unavailable', 'unavailable'],
    ['page', 'unavailable'],
    ['forbidden', 'forbidden'],
  ];
  for (const [down, word] of cases) {
    const w = watching();
    w.net.down = down;
    void w.chain.open(A.xpub);
    await w.settle();
    assert.equal(w.view().error, word, down);
    assert.equal(w.view().state, null, down);
  }
});

test('refresh() tries at once, and resolves when the scan has finished or failed', async () => {
  const w = watching();
  w.net.down = 'limit';
  void w.chain.open(A.xpub);
  w.chain.watch('wallet');
  await w.settle();
  assert.equal(w.view().error, 'limit');

  // Still failing: the answer is in `chain`, and the back-off goes on from where it was.
  // While the try is under way no other is waiting, and no moment for one is shown.
  const release = w.net.hold();
  const trying = w.chain.refresh();
  assert.deepEqual([w.timers.dueIn(), w.view().retryAt, w.view().scanning, w.view().error], [[], null, true, 'limit']);
  release();
  await trying;
  assert.deepEqual([w.view().error, w.view().retryAt], ['limit', w.clock.ms + 30_000]);
  assert.deepEqual(w.timers.dueIn(), [30_000]);

  w.net.down = null;
  await w.chain.refresh();
  assert.deepEqual([w.view().error, w.view().retryAt, w.view().checkedAt], [null, null, w.clock.ms]);
  assert.equal(stateOf(w.chain).coins.length, 0);
  assert.deepEqual(w.timers.dueIn(), [15_000], 'the retry that was waiting is gone: this is the poll');

  // With no wallet there is nothing to scan.
  w.chain.close();
  w.reset();
  await w.chain.refresh();
  assert.equal(w.net.requests.length, 0);
});

test('one scan at a time: a second asker waits for the scan already under way', async () => {
  const w = watching();
  const release = w.net.hold();
  void w.chain.open(A.xpub);
  const again = w.chain.refresh();
  const andAgain = w.chain.refresh();
  release();
  await Promise.all([again, andAgain]);
  await w.settle();
  assert.equal(w.net.count(TIP), 1);
  assert.equal(w.net.requests.length, 41, 'one scan, not three');
  assert.equal(stateOf(w.chain).coins.length, 0);
});

test('a scan of a wallet that has left the page shows nothing', async () => {
  // Closed while its first scan was on its way.
  const w = watching();
  w.net.pay(receive(0), 100_000, { confirmed: true });
  let release = w.net.hold();
  const first = w.chain.open(A.xpub);
  w.chain.close();
  release();
  await w.settle();
  assert.equal(await first, null);
  assert.deepEqual(w.chain.view(), {
    wallet: 2,
    chain: { state: null, scanning: false, error: null, checkedAt: null, retryAt: null, tip: null, slow: false },
    history: null,
    historyError: null,
    receive: null,
    notice: null,
    lastSent: null,
  });

  // Replaced by another wallet while its scan was on its way: only the new wallet's coins are shown.
  release = w.net.hold();
  const old = w.chain.open(A.xpub);
  const next = w.chain.open(B.xpub);
  release();
  await w.settle();
  assert.equal(await old, null);
  assert.deepEqual(await next, { history: false });
  assert.equal(stateOf(w.chain).coins.length, 0, 'wallet A has a coin; wallet B, the one here, has none');
  assert.equal(w.chain.view().receive?.address, deriveAddress(watchOnlyAccount(B.xpub), 0, 0).address);

  // The same with a scan that fails after the wallet has left: its failure is nobody's.
  w.net.down = 'network';
  release = w.net.hold();
  void w.chain.open(A.xpub);
  w.chain.close();
  release();
  await w.settle();
  assert.equal(w.view().error, null);
  assert.deepEqual(w.timers.dueIn(), []);
});

test('a scan that fails part of the way shows nothing of what it had read', async () => {
  const w = watching();
  w.net.pay(receive(0), 100_000, { confirmed: true });
  // The addresses answer; the coins of the one that was paid do not.
  w.net.down = 'page';
  w.net.downFor = UTXO;
  void w.chain.open(A.xpub);
  await w.settle();
  assert.ok(w.net.count(ADDRESS) >= 20, 'it got as far as reading addresses');
  assert.deepEqual([w.view().state, w.view().error, w.view().tip], [null, 'unavailable', null]);
  assert.equal(w.chain.view().receive, null);

  w.net.down = null;
  await w.chain.refresh();
  assert.equal(stateOf(w.chain).confirmed, 100_000n);
});

test('a public key that cannot be read: there is nothing to watch, and nothing is asked', async () => {
  const w = watching();
  assert.equal(await w.chain.open('not a public key'), null);
  assert.equal(await w.chain.open(A.key.privateExtendedKey), null, 'a private key is not taken for one');
  assert.deepEqual(await w.chain.probe(A.key.privateExtendedKey), { ok: false, reason: 'unavailable' });
  await w.settle();
  assert.equal(w.net.requests.length, 0);
  assert.equal(w.view().state, null);
});

// -- polling ----------------------------------------------------------------------

test('nothing polls unless the tab is in view and a wallet screen is open', async () => {
  const w = await opened();

  // No screen told yet, then screens that show no wallet.
  await w.advance(60_000);
  // (The list of "Do it" steps is one of them: it shows no coin and no payment.)
  for (const screen of ['home', 'new', 'restore', 'sparrow', 'about', 'do', 'not-found'] as const) {
    w.chain.watch(screen);
    await w.advance(60_000);
    assert.deepEqual(w.timers.dueIn(), [], screen);
  }
  assert.equal(w.net.requests.length, 0);

  // Every wallet screen polls the height, every 15 s. So does a step of "Do it", while a wallet is here.
  for (const screen of ['wallet', 'coins', 'send', 'activity', 'tx', 'backup', 'settings', 'step'] as const) {
    w.chain.watch(null);
    w.chain.watch(screen);
    await w.settle();
    // This wallet has never seen a coin: a step's screen also looks at its receive address, as Receive does, until one comes.
    assert.deepEqual(w.timers.dueIn(), screen === 'step' ? [5_000, 15_000] : [15_000], screen);
  }
  w.chain.watch(null);
  await w.settle();
  assert.deepEqual(w.timers.dueIn(), []);
});

test('on a wallet screen: one look at once, then the height every 15 s, and the coins only when it has moved', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  const state = stateOf(w.chain);

  // Coming from a screen that reads nothing: a look straight away.
  w.chain.watch('coins');
  await w.settle();
  assert.deepEqual(w.net.requests, ['GET /api/esplora/blocks/tip/height']);
  // Moving between wallet screens is not a reason to ask again.
  w.chain.watch('send');
  w.chain.watch('settings');
  w.chain.watch('coins');
  await w.settle();
  assert.equal(w.net.requests.length, 1);

  await w.advance(14_999);
  assert.equal(w.net.requests.length, 1);
  await w.advance(1);
  assert.equal(w.net.requests.length, 2);
  await w.advance(45_000);
  assert.equal(w.net.count(TIP), 5);
  assert.equal(w.net.requests.length, 5, 'the height has not moved, so nothing else was read');
  assert.equal(w.view().checkedAt, w.clock.ms);

  // A new block: a light refresh. One address is in use (its coins) and five on each chain are watched.
  w.reset();
  w.net.mine();
  await w.advance(15_000);
  assert.equal(w.net.count(TIP), 1);
  assert.equal(w.net.count(UTXO), 1);
  assert.equal(w.net.count(ADDRESS), 10);
  assert.equal(w.net.requests.length, 12);
  assert.equal(w.view().tip, 102);
  assert.equal(w.chain.state(), state, 'the same coins: the same object, so nothing is drawn again');
  assert.equal(w.chain.view().notice, null, 'a poll that finds nothing new announces nothing');
});

test('a light refresh that finds a payment at an unused address is followed by a full scan', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('wallet');
  await w.settle();
  w.reset();

  w.net.pay(receive(1), 5_000);
  w.net.mine();
  await w.advance(15_000);
  const state = stateOf(w.chain);
  assert.deepEqual([state.confirmed, state.nextReceiveIndex], [105_000n, 2]);
  assert.deepEqual(state.receive.filter((address) => address.used).map((address) => address.index), [0, 1]);
  assert.equal(w.net.count(TIP), 2, 'the poll, then the scan');
  assert.ok(w.net.requests.length > 12 + 41, 'a light refresh and a full scan');
  assert.deepEqual(w.chain.view().notice, { id: 1, kind: 'coins-arrived', sats: 5_000n });
  assert.deepEqual(w.timers.dueIn(), [15_000], 'and the poll goes on');
});

test('a step of "Do it" reads the chain and the list as a wallet screen does, and the list of steps reads nothing', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));

  // The list of steps: nothing, however long it stays open. It shows no coin and no payment.
  w.chain.watch('do');
  await w.advance(120_000);
  assert.equal(w.net.requests.length, 0);
  assert.deepEqual(w.timers.dueIn(), []);
  assert.equal(w.chain.view().history, null, 'the list of transactions is not read for it either');

  // One step: a look at once, as on entering a wallet screen, and the list of transactions,
  // in which a step looks for the payment it waits for.
  w.chain.watch('step');
  await w.settle();
  assert.deepEqual([w.net.count(TIP), w.net.count(TXS), w.net.requests.length], [1, 1, 2], 'the height, and the list of the one address in use');
  assert.deepEqual(w.chain.view().history?.map((tx) => [tx.direction, tx.confirmed]), [['received', true]]);
  assert.deepEqual(w.timers.dueIn(), [15_000]);

  // What a step costs while nothing happens: four reads of the height a minute, and nothing else.
  w.reset();
  await w.advance(60_000);
  assert.deepEqual([w.net.count(TIP), w.net.requests.length], [4, 4]);

  // A payment arrives and waits; nothing is asked about it until the chain grows. Then, for that
  // block: one light refresh (the coins of the address in use, and a look at the five next
  // addresses of each chain) and one read of the list.
  w.net.pay(receive(0), 5_000);
  w.reset();
  await w.advance(15_000);
  assert.deepEqual([w.net.count(TIP), w.net.requests.length], [1, 1], 'the height has not moved');
  w.net.mine();
  w.reset();
  await w.advance(15_000);
  assert.deepEqual([w.net.count(TIP), w.net.count(UTXO), w.net.count(ADDRESS), w.net.count(TXS)], [1, 1, 10, 1]);
  assert.equal(w.net.requests.length, 13);
  assert.deepEqual(w.chain.view().history?.map((tx) => [tx.net, tx.confirmed]), [
    [5_000n, true],
    [100_000n, true],
  ]);
  assert.deepEqual(w.chain.view().notice, { id: 1, kind: 'coins-arrived', sats: 5_000n });
  // A block that changes nothing for this wallet: the light refresh, and no read of the list.
  w.net.mine();
  w.reset();
  await w.advance(15_000);
  assert.deepEqual([w.net.count(TIP), w.net.count(UTXO), w.net.count(ADDRESS), w.net.count(TXS)], [1, 1, 10, 0]);

  // A payment of the wallet's own that waits: the block that takes it in has the list read again, once.
  const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  w.net.willTake(payment);
  assert.equal((await w.chain.broadcast(payment)).ok, true);
  await w.settle();
  assert.deepEqual(w.chain.view().history?.map((tx) => [tx.txid === payment.txid, tx.confirmed])[0], [true, false]);
  w.net.mine();
  w.reset();
  await w.advance(15_000);
  assert.equal(w.chain.view().history?.find((tx) => tx.txid === payment.txid)?.confirmed, true, 'seen with no move and no reload');
  // Two addresses hold the wallet's history now, the one it was paid at and its change address: each list is read once.
  assert.equal(w.net.count(TXS), 2);
  assert.equal(w.net.count(TIP), 1);

  // A read that fails is tried again by itself, as on a wallet screen: after 15 seconds.
  w.net.down = 'network';
  await w.advance(15_000);
  assert.deepEqual([w.view().error, w.view().retryAt, w.timers.dueIn()], ['network', w.clock.ms + 15_000, [15_000]]);
  w.net.down = null;
  await w.advance(15_000);
  assert.deepEqual([w.view().error, w.timers.dueIn()], [null, [15_000]]);

  // Hidden: nothing. Back in view: one look, at once.
  w.show(false);
  w.reset();
  await w.advance(120_000);
  assert.equal(w.net.requests.length, 0);
  w.show(true);
  await w.settle();
  assert.deepEqual(w.net.requests, ['GET /api/esplora/blocks/tip/height']);

  // From the step to its list of steps and back: the list reads nothing, the step looks at once.
  w.chain.watch('do');
  w.reset();
  await w.advance(60_000);
  assert.equal(w.net.requests.length, 0);
  w.chain.watch('step');
  await w.settle();
  assert.deepEqual(w.net.requests, ['GET /api/esplora/blocks/tip/height']);
});

test('a step of "Do it" reads nothing while no wallet is here, and begins when one arrives', async () => {
  // The first step is "make a wallet": its screen is open in a browser that has none.
  const w = watching();
  w.chain.watch('step');
  await w.advance(120_000);
  assert.equal(w.net.requests.length, 0);
  assert.deepEqual(w.timers.dueIn(), []);
  w.show(false);
  w.show(true);
  await w.settle();
  assert.equal(w.net.requests.length, 0, 'not on coming back into view either');
  assert.deepEqual(await w.chain.refresh(), undefined);
  assert.equal(w.net.requests.length, 0);

  // A wallet arrives (made in this page, or in another tab): its first scan, then the polls.
  w.net.pay(receive(0), 100_000, { confirmed: true });
  void w.chain.open(A.xpub);
  await w.settle();
  assert.equal(stateOf(w.chain).confirmed, 100_000n);
  assert.equal(w.chain.view().history?.length, 1, 'and the list, for the step that is open');
  assert.deepEqual(w.timers.dueIn(), [15_000]);

  // It leaves again (removed here or elsewhere): everything stops, with the step still open.
  w.chain.close();
  w.reset();
  await w.advance(120_000);
  assert.equal(w.net.requests.length, 0);
  assert.deepEqual(w.timers.dueIn(), []);
});

test('a step of "Do it" watches the receive address while the wallet has never seen a coin, and stops at the first one', async () => {
  // The reader is back on "Hold some" straight from the faucet, and the chain's index has not listed the payment yet.
  const w = await opened();
  const shown = w.chain.view().receive;
  assert.ok(shown);
  const SHOWN = new RegExp(`GET /api/esplora/address/${shown.address}$`);
  w.chain.watch('step');
  await w.settle();
  w.reset();
  assert.deepEqual(w.timers.dueIn(), [5_000, 15_000], 'the address, as on Receive, beside the height');
  // Nothing yet: one small request every five seconds.
  await w.advance(15_000);
  assert.deepEqual([w.net.count(SHOWN), w.net.count(TIP), w.net.requests.length], [3, 1, 4]);

  // The payment is listed, unconfirmed, and no block has come. Five seconds later the wallet has the coin:
  // the step can tick "coins arrived", and show the coin waiting for its block.
  w.reset();
  w.net.pay(shown.address, 100_000);
  await w.advance(5_000);
  const state = stateOf(w.chain);
  assert.deepEqual([state.confirmed, state.unconfirmed, state.coins.length, w.view().tip], [0n, 100_000n, 1, 100]);
  assert.equal(w.net.count(TIP) > 0 && w.net.count(UTXO) > 0, true, 'a look at the coins followed');

  // From the first coin on, the step costs what any step costs: the height four times a minute, and no address.
  assert.equal(w.timers.dueIn().length, 1);
  w.reset();
  await w.advance(60_000);
  assert.deepEqual([w.net.count(TIP), w.net.requests.length], [4, 4]);

  // The list of steps reads nothing for a wallet that waits for its first coin, either.
  const list = await opened();
  list.chain.watch('do');
  await list.advance(60_000);
  assert.equal(list.net.requests.length, 0);
  // And while the tab is hidden, the step's screen asks nothing.
  list.chain.watch('step');
  await list.settle();
  list.show(false);
  list.reset();
  await list.advance(60_000);
  assert.equal(list.net.requests.length, 0);

  // A wallet that had a coin and spent it whole holds none, and is not waiting for its first: its address was paid.
  const spent = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  const all = signed(spent.chain, { to: SOMEONE, amount: 'all', feeRate: 2n });
  spent.net.willTake(all);
  assert.equal((await spent.chain.broadcast(all)).ok, true);
  await spent.settle();
  spent.net.mine();
  spent.chain.watch('step');
  await spent.settle();
  assert.equal(stateOf(spent.chain).coins.length, 0);
  spent.reset();
  await spent.advance(60_000);
  assert.equal(spent.net.count(ADDRESS), 0, 'no address is read while nothing moves');
});

test('a hidden tab reads nothing; back in view it looks once, at once', async () => {
  const w = await opened();
  w.chain.watch('receive');
  await w.settle();
  w.reset();
  assert.deepEqual(w.timers.dueIn(), [5_000, 15_000]);

  w.show(false);
  assert.deepEqual(w.timers.dueIn(), [], 'every timer stops');
  await w.advance(120_000);
  assert.equal(w.net.requests.length, 0);

  w.show(true);
  await w.settle();
  assert.deepEqual(w.net.requests, ['GET /api/esplora/blocks/tip/height']);
  assert.deepEqual(w.timers.dueIn(), [5_000, 15_000]);

  // Hidden while a look was on its way: when its answer comes, no timer is set again. Nor by a change of screen.
  const release = w.net.hold();
  await w.timers.advance(15_000, flush);
  w.show(false);
  release();
  await w.settle();
  assert.deepEqual(w.timers.dueIn(), []);
  w.chain.watch('coins');
  w.chain.watch('receive');
  assert.deepEqual(w.timers.dueIn(), []);
  w.reset();
  await w.advance(120_000);
  assert.equal(w.net.requests.length, 0);
  w.show(true);
  await w.settle();
  assert.deepEqual(w.timers.dueIn(), [5_000, 15_000]);

  // Hidden while the first scan keeps failing: the retry waits too, and runs when the tab is back.
  const f = watching();
  f.net.down = 'network';
  void f.chain.open(A.xpub);
  f.chain.watch('wallet');
  await f.settle();
  f.show(false);
  assert.deepEqual(f.timers.dueIn(), []);
  await f.advance(300_000);
  assert.equal(f.net.count(TIP), 1);
  f.net.down = null;
  f.show(true);
  await f.settle();
  assert.equal(f.view().error, null);
  assert.equal(stateOf(f.chain).coins.length, 0);
});

test('Receive: the address on screen is read every 5 s, and on no other screen of the wallet', async () => {
  const w = await opened();
  const shown = w.chain.view().receive;
  assert.ok(shown);
  const SHOWN = new RegExp(`GET /api/esplora/address/${shown.address}$`);

  w.chain.watch('coins');
  await w.settle();
  w.reset();
  await w.advance(15_000);
  assert.deepEqual(w.net.requests, ['GET /api/esplora/blocks/tip/height'], 'no address is read on any other screen');

  w.chain.watch('receive');
  w.reset();
  await w.advance(4_999);
  assert.equal(w.net.requests.length, 0);
  await w.advance(1);
  assert.deepEqual(w.net.requests, [`GET /api/esplora/address/${shown.address}`]);
  await w.advance(10_000);
  assert.equal(w.net.count(SHOWN), 3);
  assert.equal(w.net.count(TIP), 1);
  assert.equal(w.net.requests.length, 4, 'one request for each look, while nothing changes');

  // A payment arrives, unconfirmed. Five seconds later the wallet has it.
  w.reset();
  w.net.pay(shown.address, 100_000);
  await w.advance(5_000);
  const state = stateOf(w.chain);
  assert.deepEqual([state.confirmed, state.unconfirmed, state.nextReceiveIndex], [0n, 100_000n, 1]);
  assert.equal(w.net.count(SHOWN), 1 + 1 + 1, 'the look, the light refresh, the full scan');
  assert.equal(w.net.count(UTXO), 1 + 1, 'the refresh and the scan each read its coins');
  assert.deepEqual(w.chain.view().notice, { id: 1, kind: 'coins-arrived', sats: 100_000n });
  // The address stays, although it has been paid, and says what arrived.
  assert.deepEqual(w.chain.view().receive, { address: shown.address, index: 0, arrived: 100_000n });

  // The block that confirms it is seen by the 15-second poll.
  w.net.mine();
  await w.advance(15_000);
  assert.equal(stateOf(w.chain).confirmed, 100_000n);
  assert.deepEqual(w.chain.view().notice, { id: 2, kind: 'confirmed' });
  assert.deepEqual(w.chain.view().receive, { address: shown.address, index: 0, arrived: 100_000n });

  // A second payment to the same address adds to what arrived there.
  w.net.pay(shown.address, 2_000);
  await w.advance(5_000);
  assert.deepEqual(w.chain.view().receive, { address: shown.address, index: 0, arrived: 102_000n });
  assert.deepEqual(w.chain.view().notice, { id: 3, kind: 'coins-arrived', sats: 2_000n });
});

test('a later refresh that fails keeps the last coins, says when they were checked, and backs off the same way', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('wallet');
  await w.settle();
  const state = stateOf(w.chain);
  const checked = w.clock.ms;

  w.net.down = 'unavailable';
  await w.advance(15_000);
  assert.deepEqual(w.view(), {
    state,
    scanning: false,
    error: 'unavailable',
    checkedAt: checked,
    retryAt: w.clock.ms + 15_000,
    tip: 101,
    slow: false,
  });
  assert.deepEqual(w.timers.dueIn(), [15_000], 'the polls rest while the retry waits');

  await w.advance(15_000);
  assert.equal(w.view().retryAt, w.clock.ms + 30_000);
  await w.advance(30_000);
  assert.equal(w.view().retryAt, w.clock.ms + 60_000);
  await w.advance(60_000);
  assert.equal(w.view().retryAt, w.clock.ms + 60_000);
  assert.equal(w.view().state, state);
  assert.equal(w.view().checkedAt, checked);

  // Hidden while it waits to try again, and back: it tries at once, and goes on waiting when that fails too.
  w.show(false);
  assert.deepEqual(w.timers.dueIn(), []);
  w.reset();
  w.show(true);
  await w.settle();
  assert.equal(w.net.count(TIP), 1);
  assert.deepEqual([w.view().error, w.view().retryAt], ['unavailable', w.clock.ms + 60_000]);
  assert.deepEqual(w.timers.dueIn(), [60_000]);

  // Back: the retry reads the coins whatever the height says, and the poll takes over again.
  w.net.down = null;
  w.reset();
  await w.advance(60_000);
  assert.deepEqual([w.view().error, w.view().retryAt, w.view().checkedAt], [null, null, w.clock.ms]);
  assert.equal(w.net.count(UTXO), 1, 'a light refresh, although the height has not moved');
  assert.equal(w.view().state, state);
  assert.deepEqual(w.timers.dueIn(), [15_000]);

  // A failed look at the address on the Receive screen is a failure like any other.
  w.chain.watch('receive');
  await w.settle();
  w.net.down = 'network';
  w.net.downFor = ADDRESS;
  await w.advance(5_000);
  assert.deepEqual([w.view().error, w.view().retryAt], ['network', w.clock.ms + 15_000]);
  assert.equal(w.view().state, state);
});

test('after a failure, too, nothing is read unless a wallet screen is open', async () => {
  // The first scan fails while the page shows a screen without a wallet.
  const w = watching();
  w.net.pay(receive(0), 100_000, { confirmed: true });
  w.net.down = 'network';
  void w.chain.open(A.xpub);
  w.chain.watch('home');
  await w.settle();
  assert.deepEqual([w.view().error, w.view().state, w.net.requests.length], ['network', null, 1]);
  assert.deepEqual(w.timers.dueIn(), [], 'no try is set');
  await w.advance(600_000);
  w.show(false);
  w.show(true);
  await w.settle();
  assert.equal(w.net.requests.length, 1, 'ten minutes on Home, the tab left and come back to: nothing more was asked');

  // The reader opens the wallet. The try that has been due all that time runs at once.
  w.net.down = null;
  w.chain.watch('wallet');
  assert.deepEqual(w.timers.dueIn(), [0]);
  await w.advance(0);
  assert.deepEqual([w.view().error, w.view().retryAt], [null, null]);
  const state = stateOf(w.chain);
  assert.equal(state.confirmed, 100_000n);

  // A later read fails, and the reader goes to About: the tries stop there.
  w.net.down = 'unavailable';
  await w.advance(15_000);
  assert.deepEqual([w.view().error, w.timers.dueIn()], ['unavailable', [15_000]]);
  w.chain.watch('about');
  assert.deepEqual(w.timers.dueIn(), []);
  w.reset();
  await w.advance(3_600_000);
  w.show(false);
  w.show(true);
  await w.settle();
  assert.equal(w.net.requests.length, 0, 'an hour on About with the network down: nothing was asked');
  assert.equal(w.view().state, state, 'the last coins stay');

  // Back on a wallet screen: the try is long overdue, so it runs now, and reads the coins whatever the height says.
  w.net.down = null;
  w.chain.watch('coins');
  assert.deepEqual(w.timers.dueIn(), [0]);
  await w.advance(0);
  assert.deepEqual([w.view().error, w.view().retryAt, w.view().checkedAt], [null, null, w.clock.ms]);
  assert.equal(w.net.count(UTXO), 1);
  assert.deepEqual(w.timers.dueIn(), [15_000], 'and the poll takes over');

  // A try that is not due yet keeps its moment, whichever wallet screen is open by then.
  w.net.down = 'unavailable';
  await w.advance(15_000);
  assert.equal(w.view().retryAt, w.clock.ms + 15_000);
  w.chain.watch('about');
  await w.advance(5_000);
  w.chain.watch('settings');
  assert.deepEqual(w.timers.dueIn(), [10_000]);
  w.reset();
  await w.advance(9_999);
  assert.equal(w.net.requests.length, 0);
  await w.advance(1);
  assert.equal(w.net.count(TIP), 1);
  assert.equal(w.view().retryAt, w.clock.ms + 30_000);
});

test('a look that fails is not followed at once by the look that waited behind it', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('send');
  await w.settle();
  const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  w.net.willTake(payment);
  w.reset();

  // The 15-second poll's read of the height is on its way, and will get no answer.
  w.net.down = 'network';
  w.net.downFor = TIP;
  const release = w.net.hold(TIP);
  await w.timers.advance(15_000, flush);
  assert.equal(w.net.count(TIP), 1);
  // Meanwhile a payment goes out. The look it asks for has to wait for the one under way.
  assert.deepEqual(await w.chain.broadcast(payment), { ok: true, txid: payment.txid });
  release();
  await w.settle();
  // One failed read, and the first wait: not a second read straight away, counted as a second failure.
  assert.equal(w.net.count(TIP), 1);
  assert.deepEqual([w.view().error, w.view().retryAt], ['network', w.clock.ms + 15_000]);
  assert.deepEqual(w.timers.dueIn(), [15_000]);

  // The try that follows reads the coins, as the look that waited would have.
  w.net.down = null;
  await w.advance(15_000);
  assert.deepEqual([w.view().error, w.net.count(UTXO)], [null, 2]);
});

test('the practice network counts as slow once the chain has not grown for four block intervals', async () => {
  const w = await opened();
  w.page.blockSeconds = 10;
  w.chain.watch('wallet');
  await w.settle();
  assert.equal(w.view().slow, false);
  await w.advance(30_000);
  assert.equal(w.view().slow, false, '30 s without a block is not yet four intervals of 10 s');
  await w.advance(15_000);
  assert.equal(w.view().slow, true);
  assert.equal(w.view().error, null, 'slow is not a failure');

  w.net.mine();
  await w.advance(15_000);
  assert.deepEqual([w.view().slow, w.view().tip], [false, 101]);

  // The interval is read each time, so the settings can arrive late.
  w.page.blockSeconds = 30;
  await w.advance(105_000);
  assert.equal(w.view().slow, false);
  await w.advance(15_000);
  assert.equal(w.view().slow, true);
});

// -- the address to receive at -----------------------------------------------------

test('the receive address moves only when asked, to the next unused one, and not while it is held', async () => {
  const w = await opened((net) => {
    net.pay(receive(0), 10_000, { confirmed: true });
    net.pay(receive(2), 10_000, { confirmed: true });
  });
  const at = () => w.chain.view().receive;
  assert.deepEqual(at(), { address: receive(1), index: 1, arrived: 0n });

  // Index 2 is in use: the next unused one is 3.
  w.chain.newReceiveAddress();
  assert.deepEqual(at(), { address: receive(3), index: 3, arrived: 0n });

  // While the faucet has been asked to pay the address on screen, it stays.
  w.chain.holdReceive(true);
  w.chain.newReceiveAddress();
  assert.equal(at()?.index, 3);
  w.chain.holdReceive(false);
  w.chain.newReceiveAddress();
  assert.equal(at()?.index, 4);

  // Never past the addresses a light refresh watches (five from the first one after the last used):
  // after the last of them, the first again.
  assert.equal(stateOf(w.chain).nextReceiveIndex, 3);
  for (let presses = 0; presses < 3; presses++) w.chain.newReceiveAddress();
  assert.equal(at()?.index, 7);
  w.chain.newReceiveAddress();
  assert.deepEqual(at(), { address: receive(1), index: 1, arrived: 0n });

  // A new address starts counting from nothing.
  w.chain.watch('receive');
  await w.settle();
  w.net.pay(receive(1), 700);
  await w.advance(5_000);
  assert.equal(at()?.arrived, 700n);
  w.chain.newReceiveAddress();
  assert.deepEqual(at(), { address: receive(3), index: 3, arrived: 0n });

  // Before the first scan there is no address to move from.
  const early = watching();
  void early.chain.open(A.xpub);
  early.chain.newReceiveAddress();
  assert.equal(early.chain.view().receive, null);
});

test('an address that was shown still works: a payment to it is found by the polls, whatever is on screen by then', async () => {
  // Every address the reader can be shown, as far as "Show a new address" goes.
  const tour = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  const offered = [tour.chain.view().receive?.index];
  for (let presses = 0; presses < 5; presses++) {
    tour.chain.newReceiveAddress();
    offered.push(tour.chain.view().receive?.index);
  }
  assert.deepEqual(offered, [1, 2, 3, 4, 5, 1], 'five addresses, and then the first of them again');

  for (const index of [1, 2, 3, 4, 5]) {
    // The reader is shown it, copies it, and leaves Receive for the overview. Then somebody pays it.
    const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
    w.chain.watch('receive');
    await w.settle();
    for (let presses = 1; presses < index; presses++) w.chain.newReceiveAddress();
    assert.equal(w.chain.view().receive?.index, index);
    w.chain.watch('wallet');
    await w.settle();
    w.net.pay(receive(index), 33_000);
    w.net.mine();
    await w.advance(15_000);
    const state = stateOf(w.chain);
    assert.deepEqual([state.confirmed, state.nextReceiveIndex], [133_000n, index + 1], `address ${index}`);
    assert.deepEqual(w.chain.view().notice, { id: 1, kind: 'coins-arrived', sats: 33_000n }, `address ${index}`);
  }

  // The same when the reader stayed on Receive and moved on to another address before the payment came.
  const moved = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  moved.chain.watch('receive');
  await moved.settle();
  for (let presses = 0; presses < 3; presses++) moved.chain.newReceiveAddress();
  assert.equal(moved.chain.view().receive?.index, 4);
  moved.chain.newReceiveAddress();
  moved.net.pay(receive(4), 33_000);
  moved.net.mine();
  await moved.advance(15_000);
  assert.equal(stateOf(moved.chain).confirmed, 133_000n);
  assert.deepEqual(moved.chain.view().receive, { address: receive(5), index: 5, arrived: 0n }, 'the address on screen stays');
});

test('the address on screen is paid and the scan that should mark it used fails: the next try makes up for it', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('receive');
  await w.settle();
  for (let presses = 0; presses < 4; presses++) w.chain.newReceiveAddress();
  assert.equal(w.chain.view().receive?.index, 5);

  // The look at the address sees the payment and the light refresh reads its coin. The full scan
  // that follows gets no answer for an address only a full scan reads.
  w.net.pay(receive(5), 7_000);
  w.net.down = 'network';
  w.net.downFor = new RegExp(`/address/${receive(25)}$`);
  await w.advance(5_000);
  assert.deepEqual([w.view().error, w.view().retryAt], ['network', w.clock.ms + 15_000]);
  assert.deepEqual([stateOf(w.chain).unconfirmed, stateOf(w.chain).nextReceiveIndex], [7_000n, 1], 'the coin is there; the address still counts as unused');

  // The network is back. The try reads the coins, finds the address paid and still unmarked, and scans again.
  w.net.down = null;
  await w.advance(15_000);
  assert.equal(w.view().error, null);
  assert.equal(stateOf(w.chain).nextReceiveIndex, 6);
  assert.deepEqual(stateOf(w.chain).receive.filter((address) => address.used).map((address) => address.index), [0, 5]);
  assert.deepEqual(w.chain.view().receive, { address: receive(5), index: 5, arrived: 7_000n });
});

test('an address on screen that no light refresh watches: the scan it asks for when paid is asked again until one works', async () => {
  // Rare, and still to be got right. Address 3 is paid by a transaction that is waiting, so the
  // wallet counts on from 4. The reader is shown address 8. Then the network drops that
  // transaction: after the next full scan the wallet counts on from 1 again, and a light refresh
  // looks at addresses 1 to 5 only. Address 8 stays on screen.
  const w = watching();
  w.net.pay(receive(0), 100_000, { confirmed: true });
  const waiting = w.net.pay(receive(3), 2_000);
  void w.chain.open(A.xpub);
  w.chain.watch('receive');
  await w.settle();
  for (let presses = 0; presses < 6; presses++) w.chain.newReceiveAddress();
  assert.deepEqual([w.chain.view().receive?.index, stateOf(w.chain).nextReceiveIndex], [8, 4]);
  w.net.drop(waiting);
  await w.chain.refresh();
  assert.deepEqual([w.chain.view().receive?.index, stateOf(w.chain).nextReceiveIndex], [8, 1]);

  // Somebody pays address 8. The look at it every 5 s sees that; the light refresh does not read
  // it; so a full scan is asked for. That scan fails.
  w.net.pay(receive(8), 9_000);
  w.net.down = 'network';
  w.net.downFor = new RegExp(`/address/${receive(25)}$`);
  await w.advance(5_000);
  assert.deepEqual([w.view().error, stateOf(w.chain).unconfirmed], ['network', 0n]);

  // The next try looks, and asks for the scan again: it was never made good.
  w.net.down = null;
  await w.advance(15_000);
  assert.deepEqual([w.view().error, stateOf(w.chain).unconfirmed, stateOf(w.chain).nextReceiveIndex], [null, 9_000n, 9]);
  assert.deepEqual(w.chain.view().receive, { address: receive(8), index: 8, arrived: 9_000n });
  assert.deepEqual(w.chain.view().notice, { id: 1, kind: 'coins-arrived', sats: 9_000n });
  // Once a scan has worked, the looks that follow are light again.
  w.reset();
  await w.advance(15_000);
  assert.equal(w.net.count(ADDRESS) < 40, true, 'no further full scan');
});

// -- the list of transactions --------------------------------------------------------

test('history is read when a screen that shows activity is open, and again after the coins change', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  assert.equal(w.chain.view().history, null);

  // Screens that show no activity do not cost the request.
  for (const screen of ['coins', 'receive', 'send', 'backup', 'settings', 'about'] as const) w.chain.watch(screen);
  await w.settle();
  assert.equal(w.net.count(TXS), 0);
  assert.equal(w.chain.view().history, null);

  w.chain.watch('activity');
  await w.settle();
  assert.equal(w.net.count(TXS), 1, 'one address is in use');
  const first = w.chain.view().history;
  assert.deepEqual(first?.map((tx) => [tx.direction, tx.net, tx.confirmed]), [['received', 100_000n, true]]);

  // Nothing changed: the list is not read again, whichever activity screen is opened.
  w.chain.watch('wallet');
  w.chain.watch('tx');
  await w.advance(30_000);
  assert.equal(w.net.count(TXS), 1);
  assert.equal(w.chain.view().history, first);

  // New coins: the list follows.
  w.net.pay(receive(1), 5_000);
  w.net.mine();
  await w.advance(15_000);
  assert.deepEqual(w.chain.view().history?.map((tx) => tx.net), [5_000n, 100_000n]);

  // The coins change while a screen without activity is open: the list waits until one is.
  w.chain.watch('coins');
  w.reset();
  w.net.pay(receive(2), 600);
  w.net.mine();
  await w.advance(15_000);
  assert.equal(stateOf(w.chain).confirmed, 105_600n);
  assert.equal(w.net.count(TXS), 0);
  w.chain.watch('wallet');
  await w.settle();
  assert.deepEqual(w.chain.view().history?.map((tx) => tx.net), [600n, 5_000n, 100_000n]);
});

test('history is loaded once the first scan has finished, if its screen was opened before that', async () => {
  const w = watching();
  w.net.pay(receive(0), 100_000, { confirmed: true });
  void w.chain.open(A.xpub);
  w.chain.watch('wallet');
  assert.equal(w.chain.view().history, null);
  await w.settle();
  assert.equal(w.chain.view().history?.length, 1);
});

test('a failed history read keeps the old list and says why, and is tried again after 15 s, 30 s, then every 60 s', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('activity');
  await w.settle();
  const old = w.chain.view().history;
  assert.equal(old?.length, 1);

  // The coins can still be read. The list cannot: the Worker says the page is asking too fast.
  w.net.pay(receive(1), 5_000);
  w.net.mine();
  w.net.down = 'limit';
  w.net.downFor = TXS;
  w.reset();
  await w.advance(15_000);
  assert.equal(stateOf(w.chain).confirmed, 105_000n, 'the coins were read');
  assert.equal(w.chain.view().historyError, 'limit');
  assert.equal(w.chain.view().history, old, 'the old list stays');
  assert.equal(w.view().error, null, 'the coins are fine: this failure is the list\'s own');

  // One try reads the list of each of the two addresses in use. The polls go on meanwhile, every
  // 15 s, and none of them reads the list: it waits its own turn.
  const tries = () => w.net.count(TXS) / 2;
  assert.equal(tries(), 1);
  // Moving between the screens that show the list is no reason to ask sooner.
  w.chain.watch('wallet');
  w.chain.watch('tx');
  w.chain.watch('activity');
  await w.settle();
  assert.equal(tries(), 1);
  for (const [wait, made] of [[15_000, 2], [30_000, 3], [60_000, 4], [60_000, 5]] as const) {
    await w.advance(wait - 1);
    assert.equal(tries(), made - 1, `not before ${wait / 1000} s are over`);
    await w.advance(1);
    assert.equal(tries(), made, `after ${wait / 1000} s`);
    assert.equal(w.chain.view().historyError, 'limit');
  }
  assert.equal(w.net.count(TIP) > 10, true, 'the height was read all along');
  assert.equal(w.view().error, null);

  // While no screen shows the list, it is not tried. Back on one, with the try overdue, it is read at once.
  w.chain.watch('coins');
  await w.advance(300_000);
  assert.equal(tries(), 5);
  w.net.down = null;
  w.chain.watch('wallet');
  await w.settle();
  assert.equal(w.chain.view().historyError, null);
  assert.equal(w.chain.view().history?.length, 2);
  assert.equal(tries(), 6);
  // And that is the end of the tries.
  await w.advance(300_000);
  assert.equal(tries(), 6);

  // The wait is the list's own, counted from its failure, not from the polls. Here the list fails
  // 7 s after a poll: it is tried again 15 s after that, 8 s before the poll that would have been next.
  const p = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  p.chain.watch('activity');
  await p.settle();
  assert.deepEqual(p.timers.dueIn(), [15_000], 'the polls run from here');
  await p.advance(7_000);
  p.net.down = 'network';
  p.net.downFor = TXS;
  await p.chain.refresh();
  await p.settle();
  assert.equal(p.chain.view().historyError, 'network');
  p.reset();
  await p.advance(14_999);
  assert.deepEqual([p.net.count(TIP), p.net.count(TXS)], [1, 0], 'a poll has run meanwhile, and left the list alone');
  await p.advance(1);
  assert.equal(p.net.count(TXS), 1);

  // refresh() reads the list again too, also when the coins turn out unchanged, and without waiting
  // for the list's own turn: the reader asked.
  w.net.down = 'network';
  w.net.downFor = TXS;
  w.net.pay(receive(2), 100);
  await w.chain.refresh();
  await w.settle();
  assert.equal(w.chain.view().historyError, 'network');
  w.net.down = null;
  await w.chain.refresh();
  await w.settle();
  assert.deepEqual([w.chain.view().historyError, w.chain.view().history?.length], [null, 3]);
});

test('a payment that leaves no coin behind is still shown as confirmed once a block has it', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('activity');
  await w.settle();
  const payment = signed(w.chain, { to: SOMEONE, amount: 'all', feeRate: 2n });
  w.net.willTake(payment);
  assert.deepEqual(await w.chain.broadcast(payment), { ok: true, txid: payment.txid });
  await w.settle();
  assert.deepEqual(w.chain.view().history?.map((tx) => [tx.direction, tx.confirmed]), [
    ['sent', false],
    ['received', true],
  ]);
  assert.equal(stateOf(w.chain).coins.length, 0);

  // The block changes nothing in the wallet, which holds no coin. The list is read again all the same.
  w.net.mine();
  await w.advance(15_000);
  assert.deepEqual(w.chain.view().history?.map((tx) => [tx.direction, tx.confirmed]), [
    ['sent', true],
    ['received', true],
  ]);
});

test('a block that confirms a waiting coin: the list is read again once, not twice', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000));
  w.chain.watch('activity');
  await w.settle();
  assert.deepEqual(w.chain.view().history?.map((tx) => tx.confirmed), [false]);
  w.reset();

  // The new height and the newly confirmed coin are both reasons to read the list. One read serves both.
  w.net.mine();
  await w.advance(15_000);
  assert.deepEqual(w.chain.view().history?.map((tx) => tx.confirmed), [true]);
  assert.equal(w.net.count(TXS), 1);
  assert.deepEqual(w.chain.view().notice, { id: 1, kind: 'confirmed' });

  // Every entry is confirmed now: further blocks are no reason to read it again.
  w.reset();
  w.net.mine();
  await w.advance(15_000);
  assert.equal(w.net.count(TXS), 0);
});

test('"Send all" while Esplora lags: once a read has caught up the list shows the payment, although the coins compare equal', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('activity');
  await w.settle();
  // Esplora hears of what the node takes only later.
  w.net.lag = true;
  const payment = signed(w.chain, { to: SOMEONE, amount: 'all', feeRate: 2n });
  w.net.willTake(payment);
  assert.deepEqual(await w.chain.broadcast(payment), { ok: true, txid: payment.txid });
  await w.settle();
  // The wallet is empty at once. The list was read while Esplora did not know the payment yet.
  assert.equal(stateOf(w.chain).coins.length, 0);
  assert.deepEqual(w.chain.view().history?.map((tx) => tx.direction), ['received']);

  // Polls that are still behind change nothing, and do not read the list.
  w.reset();
  await w.advance(15_000);
  assert.equal(stateOf(w.chain).coins.length, 0);
  assert.equal(w.net.count(TXS), 0);
  assert.deepEqual(w.chain.view().history?.map((tx) => tx.direction), ['received']);

  // Esplora catches up, with no new block. The coins it reports are the ones the page already
  // holds (none before, none after), so the coins alone would be no reason to read the list.
  w.net.hear(payment.txid);
  await w.advance(15_000);
  assert.equal(stateOf(w.chain).coins.length, 0);
  assert.deepEqual(w.chain.view().history?.map((tx) => [tx.direction, tx.confirmed]), [
    ['sent', false],
    ['received', true],
  ]);
  // Once, and then the list rests again.
  w.reset();
  await w.advance(15_000);
  assert.equal(w.net.count(TXS), 0);
});

test('"Try again" after a payment made while Esplora lagged: the list shows the payment, and is read once', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('activity');
  await w.settle();
  w.net.lag = true;
  const payment = signed(w.chain, { to: SOMEONE, amount: 'all', feeRate: 2n });
  w.net.willTake(payment);
  assert.deepEqual(await w.chain.broadcast(payment), { ok: true, txid: payment.txid });
  await w.settle();
  assert.deepEqual(w.chain.view().history?.map((tx) => tx.direction), ['received']);

  // The tab goes out of view, Esplora catches up, and the next read fails: after a failure the
  // page reads everything again, from the start.
  w.show(false);
  w.net.hear(payment.txid);
  w.net.down = 'unavailable';
  w.show(true);
  await w.settle();
  assert.equal(w.view().error, 'unavailable');
  w.net.down = null;
  // The reader's own "Try again" is a full scan. It finds the wallet as empty as the page shows it.
  w.reset();
  await w.chain.refresh();
  assert.equal(stateOf(w.chain).coins.length, 0);
  assert.deepEqual(w.chain.view().history?.map((tx) => tx.direction), ['sent', 'received']);
  // One read of the list did it: the scan's own, with no second one for the reader's asking.
  assert.equal(w.net.count(TXS), 1, 'one read, of the one address that was ever used');
});

test('refresh() resolves when the list has been read again, or that read has failed: not before', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('activity');
  await w.settle();
  const old = w.chain.view().history;
  assert.equal(old?.length, 1);

  // The list's answer is held back: the coins are read again, and the list is still on its way.
  w.reset();
  let release = w.net.hold(TXS);
  let done = false;
  let refreshing = w.chain.refresh().then(() => {
    done = true;
  });
  await turns();
  assert.equal(w.view().scanning, false, 'the coins have been read again');
  assert.equal(w.net.count(TXS), 1, 'and the list has been asked for');
  assert.equal(done, false, 'the reader is still waiting');
  release();
  await refreshing;
  assert.equal(done, true);
  assert.notEqual(w.chain.view().history, old, 'another list, read after the scan');
  assert.equal(w.chain.view().historyError, null);

  // A read that fails: the reason is there the moment refresh() resolves, with nothing else waited for.
  w.net.down = 'limit';
  w.net.downFor = TXS;
  await w.chain.refresh();
  assert.equal(w.chain.view().historyError, 'limit');
  // It fails again, for the same reason. Nothing a screen can see has changed, and still the
  // caller knows that its try is over: that is what the wait is for.
  const failed = w.chain.view();
  w.reset();
  await w.chain.refresh();
  assert.equal(w.net.count(TXS), 1, 'the list was tried again, although its own next try was not due');
  assert.equal(w.chain.view().historyError, 'limit');
  assert.equal(w.chain.view().history, failed.history);
  // And then it works.
  w.net.down = null;
  await w.chain.refresh();
  assert.deepEqual([w.chain.view().historyError, w.chain.view().history?.length], [null, 1]);

  // The coins could not be read: the list is not tried at all, and nothing is waited for.
  w.net.down = 'unavailable';
  w.net.downFor = null;
  w.reset();
  await w.chain.refresh();
  assert.equal(w.view().error, 'unavailable');
  assert.equal(w.net.count(TXS), 0);
  w.net.down = null;
  await w.chain.refresh();

  // No screen that shows the list is open: nothing is read, and refresh() does not wait for a list.
  w.chain.watch('coins');
  w.reset();
  await w.chain.refresh();
  assert.equal(w.net.count(TXS), 0);

  // The wallet leaves the page while its list is on the way: the wait ends all the same.
  w.chain.watch('activity');
  release = w.net.hold(TXS);
  done = false;
  refreshing = w.chain.refresh().then(() => {
    done = true;
  });
  await turns();
  assert.equal(done, false);
  w.chain.close();
  await refreshing;
  assert.equal(done, true);
  release();
  await w.settle();
  assert.equal(w.chain.view().history, null);
});

test('the stand-in network lists an address\'s transactions in pages, as the practice network does', async () => {
  const net = new FakeNetwork();
  const esplora = makeApi(net.fetch).esplora;
  // 60 confirmed payments to one address, each in a block of its own, and 3 that are still waiting.
  const confirmed: string[] = [];
  for (let n = 0; n < 60; n++) confirmed.push(net.pay(receive(0), 1_000 + n, { confirmed: true }));
  const waiting = [net.pay(receive(0), 7), net.pay(receive(0), 8), net.pay(receive(0), 9)];
  const newestFirst = [...confirmed].reverse();

  // The first answer: 50 in all, the waiting ones first, then the newest confirmed ones.
  const first = await esplora.addressTxs(receive(0));
  assert.equal(first.length, FIRST_PAGE);
  assert.deepEqual(first.map((tx) => tx.txid), [...waiting, ...newestFirst.slice(0, FIRST_PAGE - waiting.length)]);

  // The older ones, 25 at a time, each page asked for by the last ID of the one before.
  const second = await esplora.addressTxsChain(receive(0), first.at(-1)!.txid);
  assert.deepEqual(second.map((tx) => tx.txid), newestFirst.slice(47, 60));
  assert.ok(second.length < CHAIN_PAGE, 'a short page: the end');
  // With no ID: the newest 25 confirmed ones.
  assert.deepEqual((await esplora.addressTxsChain(receive(0))).map((tx) => tx.txid), newestFirst.slice(0, CHAIN_PAGE));
  // After the oldest, after an ID the address does not have, and after one that is still waiting: nothing.
  assert.deepEqual(await esplora.addressTxsChain(receive(0), newestFirst.at(-1)), []);
  assert.deepEqual(await esplora.addressTxsChain(receive(0), 'ab'.repeat(32)), []);
  assert.deepEqual(await esplora.addressTxsChain(receive(0), waiting[0]), []);
  // Every page, as the wallet reads them: each transaction once.
  const all = await esplora.addressTxsAll(receive(0));
  assert.deepEqual(all.map((tx) => tx.txid), [...waiting, ...newestFirst]);
  assert.deepEqual(net.requests.slice(-2).map((request) => request.replace(/[0-9a-f]{64}$/, '<txid>')), [
    `GET /api/esplora/address/${receive(0)}/txs`,
    `GET /api/esplora/address/${receive(0)}/txs/chain/<txid>`,
  ]);

  // An address with exactly 50: the first page is full, so one more question is asked, and answered with nothing.
  const exact = new FakeNetwork();
  for (let n = 0; n < FIRST_PAGE; n++) exact.pay(receive(1), 500, { confirmed: true });
  assert.equal((await makeApi(exact.fetch).esplora.addressTxsAll(receive(1))).length, FIRST_PAGE);
  assert.equal(exact.count(/\/txs\/chain\/[0-9a-f]{64}$/), 1);
});

test('the list of a wallet whose address has more than 50 transactions is read whole', async () => {
  // The practice network lists 50 at most in its first answer. A wallet that read only that
  // answer would show a busy address's newest 50 and lose the rest without a word.
  const w = watching();
  const paid: string[] = [];
  for (let n = 0; n < 58; n++) paid.push(w.net.pay(receive(0), 100 + n, { confirmed: true }));
  void w.chain.open(A.xpub);
  w.chain.watch('activity');
  await w.settle();
  assert.equal(stateOf(w.chain).coins.length, 58);
  const history = w.chain.view().history;
  assert.equal(history?.length, 58);
  assert.deepEqual(new Set(history?.map((tx) => tx.txid)), new Set(paid));
  // The first page, then the older ones by the last ID of that page.
  assert.equal(w.net.count(TXS), 1);
  assert.equal(w.net.count(/\/txs\/chain\/[0-9a-f]{64}$/), 1);
});

// -- one transaction -----------------------------------------------------------------

test('lookupTx: from the list when it is there, else from the network', async () => {
  const w = await opened();
  const mine = w.net.pay(receive(0), 100_000, { confirmed: true });
  const theirs = w.net.pay(SOMEONE, 9_000);
  await w.chain.refresh();
  w.chain.watch('activity');
  await w.settle();
  w.reset();

  // In the list: no request.
  const held = await w.chain.lookupTx(mine);
  assert.ok(held.kind === 'found');
  assert.equal(held.view, w.chain.view().history?.[0]);
  assert.equal(w.net.requests.length, 0);

  // Not the wallet's: asked of the network, and read as the wallet sees it.
  const other = await w.chain.lookupTx(theirs);
  assert.ok(other.kind === 'found');
  assert.deepEqual([other.view.txid, other.view.direction, other.view.net], [theirs, 'other', 0n]);
  assert.deepEqual(w.net.requests, [`GET /api/esplora/tx/${theirs}`]);

  // Unknown to the network, and nothing this page sent: not found.
  assert.deepEqual(await w.chain.lookupTx('ab'.repeat(32)), { kind: 'not-found' });
  // Not a transaction ID at all: the Worker has no such path.
  assert.deepEqual(await w.chain.lookupTx('nonsense'), { kind: 'not-found' });

  // A failure is not "not found".
  w.net.down = 'limit';
  assert.deepEqual(await w.chain.lookupTx(theirs), { kind: 'failed', reason: 'limit' });
  w.net.down = 'network';
  assert.deepEqual(await w.chain.lookupTx(theirs), { kind: 'failed', reason: 'network' });
});

test('lookupTx: a transaction the network was just given is "waiting" for two minutes, then "not found"', async () => {
  const w = await opened();
  w.net.lag = true;
  const promised = w.net.pay(receive(0), 100_000);
  const never = 'cd'.repeat(32);
  w.chain.rememberTx(promised);
  w.chain.rememberTx(never);

  assert.deepEqual(await w.chain.lookupTx(promised), { kind: 'waiting' });
  w.clock.ms += 120_000;
  assert.deepEqual(await w.chain.lookupTx(promised), { kind: 'waiting' }, 'two minutes exactly is still waiting');
  assert.deepEqual(await w.chain.lookupTx('ab'.repeat(32)), { kind: 'not-found' }, 'only the remembered ones');

  // Esplora catches up with one of them. The other never arrives.
  w.net.hear(promised);
  const found = await w.chain.lookupTx(promised);
  assert.ok(found.kind === 'found');
  assert.deepEqual([found.view.direction, found.view.net], ['received', 100_000n]);
  w.clock.ms += 1;
  assert.deepEqual(await w.chain.lookupTx(never), { kind: 'not-found' });
});

test('lookupTx asked while the first scan is still running waits for it, and then knows what is the wallet\'s', async () => {
  // A page loaded on a transaction's own screen: the wallet opens, the screen is watched, and the screen asks at once.
  const w = watching();
  const txid = w.net.pay(receive(0), 100_000, { confirmed: true });
  const release = w.net.hold(ADDRESS);
  void w.chain.open(A.xpub);
  w.chain.watch('tx');
  const answers: TxLookup[] = [];
  void w.chain.lookupTx(txid).then((answer) => answers.push(answer));
  for (let turn = 0; turn < 8; turn++) await flush();
  assert.equal(w.net.count(new RegExp(`GET /api/esplora/tx/${txid}$`)), 1, 'the transaction itself has been read');
  assert.equal(answers.length, 0, 'and still no answer: whose its outputs are is not known before the scan is done');

  release();
  await w.settle();
  const [found] = answers;
  assert.ok(found?.kind === 'found');
  assert.deepEqual([found.view.direction, found.view.net, found.view.outputs.map((output) => output.mine)], ['received', 100_000n, [true]]);

  // The first scan fails: so does the lookup, with the scan's reason. It never says "found, and none of it yours".
  const f = watching();
  const paid = f.net.pay(receive(0), 100_000, { confirmed: true });
  f.net.down = 'limit';
  f.net.downFor = ADDRESS;
  const hold = f.net.hold(ADDRESS);
  void f.chain.open(A.xpub);
  f.chain.watch('tx');
  const early = f.chain.lookupTx(paid);
  hold();
  assert.deepEqual(await early, { kind: 'failed', reason: 'limit' });
  // The same between two tries, when no scan is running and none has worked yet.
  await f.settle();
  assert.equal(f.view().scanning, false);
  assert.deepEqual(await f.chain.lookupTx(paid), { kind: 'failed', reason: 'limit' });
  // Asked again once a scan has worked, it is found.
  f.net.down = null;
  await f.chain.refresh();
  const late = await f.chain.lookupTx(paid);
  assert.ok(late.kind === 'found');
  assert.deepEqual([late.view.direction, late.view.net], ['received', 100_000n]);

  // "Not found" needs no scan: it is the same answer for any wallet.
  const n = watching();
  const stop = n.net.hold(ADDRESS);
  void n.chain.open(A.xpub);
  assert.deepEqual(await n.chain.lookupTx('ab'.repeat(32)), { kind: 'not-found' });
  stop();
  await n.settle();
});

// -- outcomes worth announcing -------------------------------------------------------

test('notices: coins that arrive, a first confirmation, and what the session asks to have said; each with a new id', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('wallet');
  await w.settle();
  assert.equal(w.chain.view().notice, null);

  // Two payments seen in one look are one notice, with their sum.
  w.net.pay(receive(1), 5_000);
  w.net.pay(receive(2), 300);
  w.net.mine();
  await w.advance(15_000);
  assert.deepEqual(w.chain.view().notice, { id: 1, kind: 'coins-arrived', sats: 5_300n });

  // A coin of the change chain that turns up is what a payment made elsewhere left behind: not an arrival.
  w.net.pay(change(0), 40_000);
  w.net.mine();
  await w.advance(15_000);
  assert.equal(stateOf(w.chain).confirmed, 145_300n);
  assert.deepEqual(w.chain.view().notice, { id: 1, kind: 'coins-arrived', sats: 5_300n });

  // An unconfirmed coin gets its block.
  w.chain.watch('receive');
  const shown = w.chain.view().receive;
  assert.ok(shown);
  w.net.pay(shown.address, 1_000);
  await w.advance(5_000);
  assert.deepEqual(w.chain.view().notice, { id: 2, kind: 'coins-arrived', sats: 1_000n });
  w.net.mine();
  await w.advance(15_000);
  assert.deepEqual(w.chain.view().notice, { id: 3, kind: 'confirmed' });

  // Polls that find nothing new say nothing: the notice is the very same object.
  const last = w.chain.view().notice;
  w.net.mine();
  await w.advance(60_000);
  assert.equal(w.chain.view().notice, last);

  w.chain.announce('unlocked');
  assert.deepEqual(w.chain.view().notice, { id: 4, kind: 'unlocked' });
  w.chain.announce('locked');
  assert.deepEqual(w.chain.view().notice, { id: 5, kind: 'locked' });
});

// -- sending ---------------------------------------------------------------------------

test('plan() never throws: with no coins read yet, and for anything it is asked, it answers', async () => {
  const w = watching();
  const request: PaymentRequest = { to: SOMEONE, amount: 1_000n, feeRate: 2n };
  const nothing = { ok: false, reason: 'nothing-spendable', maxSendable: 0n, dust: null };
  assert.deepEqual(w.chain.plan(request), nothing, 'no wallet');
  void w.chain.open(A.xpub);
  assert.deepEqual(w.chain.plan(request), nothing, 'the first scan is still running');
  await w.settle();
  assert.deepEqual(w.chain.plan(request), nothing, 'an empty wallet');

  w.net.pay(receive(0), 100_000, { confirmed: true });
  await w.chain.refresh();
  const state = stateOf(w.chain);
  // What the wallet package says, with the public key alone.
  assert.deepEqual(w.chain.plan(request), planPayment(watchA, state, request));
  assert.equal(w.chain.plan(request).ok, true);
  for (const [bad, reason] of [
    [{ ...request, amount: 100_000n }, 'too-much'],
    [{ ...request, amount: 293n }, 'below-dust'],
    [{ ...request, to: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' }, 'bad-address'],
  ] as const) {
    const plan = w.chain.plan(bad);
    assert.deepEqual([plan.ok, plan.ok ? null : plan.reason], [false, reason]);
  }
  // What no form should send: still an answer, never a throw.
  for (const odd of [
    { ...request, feeRate: 0n },
    { ...request, feeRate: -1n },
    { ...request, amount: -5n },
    { ...request, to: '' },
    null,
    undefined,
    {},
    { to: 5, amount: 'most', feeRate: 'fast' },
  ]) {
    const plan = w.chain.plan(odd as never);
    assert.equal(plan.ok, false, JSON.stringify(odd, (_, value) => (typeof value === 'bigint' ? `${value}n` : value)));
  }
});

test('broadcast: applied at once, then a light refresh, a notice, and the ID remembered', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('coins');
  await w.settle();
  const before = stateOf(w.chain);
  const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  w.net.willTake(payment);
  w.reset();

  assert.deepEqual(await w.chain.broadcast(payment), { ok: true, txid: payment.txid });
  // At once: the coin is spent and the change is there, before the network has been asked again.
  const applied = stateOf(w.chain);
  assert.deepEqual(applied, applyPayment(before, payment));
  assert.deepEqual([applied.confirmed, applied.unconfirmed], [0n, 100_000n - 60_000n - payment.fee]);
  assert.deepEqual(w.chain.view().notice, { id: 1, kind: 'payment-sent' });
  assert.deepEqual(w.events, ['Payment: sent']);
  assert.equal(w.net.count(BROADCAST), 1);
  assert.equal(w.net.count(UTXO), 0, 'the refresh has only just begun');

  // The light refresh agrees with what was applied: the very same state stays.
  await w.settle();
  assert.equal(w.net.count(UTXO), 2, 'the address that was spent from, and the change address');
  assert.equal(w.chain.state(), applied);
  assert.deepEqual(w.chain.view().notice, { id: 1, kind: 'payment-sent' }, 'the change is not a coin that "arrived"');

  // Remembered: if Esplora has not heard of it yet, that is "waiting", not "not found".
  w.net.unhear(payment.txid);
  assert.deepEqual(await w.chain.lookupTx(payment.txid), { kind: 'waiting' });

  // Its block: the change confirms.
  w.net.mine();
  await w.advance(15_000);
  assert.deepEqual([stateOf(w.chain).confirmed, stateOf(w.chain).unconfirmed], [applied.unconfirmed, 0n]);
  assert.deepEqual(w.chain.view().notice, { id: 2, kind: 'confirmed' });
});

test('a payment to one of the wallet\'s own addresses is a payment sent, not coins that arrived', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('coins');
  await w.settle();
  // To the wallet's own next receive address: both outputs come back to the wallet.
  const payment = signed(w.chain, { to: receive(1), amount: 30_000n, feeRate: 2n });
  w.net.willTake(payment);
  assert.deepEqual(await w.chain.broadcast(payment), { ok: true, txid: payment.txid });
  // One notice, and it is about the payment. The coin at the receive address is the wallet's own doing.
  assert.deepEqual(w.chain.view().notice, { id: 1, kind: 'payment-sent' });
  await w.settle();
  assert.deepEqual(w.chain.view().notice, { id: 1, kind: 'payment-sent' });
  const state = stateOf(w.chain);
  assert.deepEqual([state.confirmed, state.unconfirmed, state.coins.length], [0n, 100_000n - payment.fee, 2]);
  assert.equal(state.nextReceiveIndex, 2, 'the address it paid counts as used');
});

test('a refresh that was on its way when a payment was applied does not put the old coins back', async () => {
  const w = await opened((net) => {
    net.pay(receive(0), 100_000, { confirmed: true });
    net.pay(receive(1), 5_000);
  });
  w.chain.watch('coins');
  await w.settle();
  const notices: string[] = [];
  w.chain.subscribe(() => {
    const notice = w.chain.view().notice;
    const text = notice === null ? '' : `${notice.id}: ${notice.kind}`;
    if (text !== '' && notices.at(-1) !== text) notices.push(text);
  });
  // Spends the confirmed coin. (The other one is somebody's payment still waiting for a block.)
  const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  w.net.willTake(payment);

  // A block confirms the waiting coin. The poll sees the new height and reads the coins: a read that is slow to answer.
  w.net.mine();
  const release = w.net.hold(UTXO);
  w.reset();
  await w.timers.advance(15_000, flush);
  assert.equal(w.net.count(UTXO), 2, 'the refresh is on its way');

  // Meanwhile the payment goes out and is applied.
  assert.deepEqual(await w.chain.broadcast(payment), { ok: true, txid: payment.txid });
  const applied = stateOf(w.chain);
  const change = 100_000n - 60_000n - payment.fee;
  assert.deepEqual([applied.confirmed, applied.unconfirmed], [0n, 5_000n + change]);

  // The slow answer arrives. It still lists the coin that has just been spent, and it is dropped:
  // nothing "arrives" that the wallet has just paid away. The coins are then read again.
  release();
  await w.settle();
  const state = stateOf(w.chain);
  assert.deepEqual([state.confirmed, state.unconfirmed, state.coins.length], [5_000n, change, 2]);
  assert.equal(state.nextChangeIndex, 1);
  assert.deepEqual(notices, ['1: payment-sent', '2: confirmed']);
});

test('a full scan that was on its way when a payment was applied does not put the old coins back either', async () => {
  // The scan had read the coin before the payment went out, and lands after it.
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('send');
  await w.settle();
  const notices = noticesOf(w.chain);
  const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  w.net.willTake(payment);
  const change = 100_000n - 60_000n - payment.fee;

  // The reader asks for a refresh. Its last answers are slow: by then it has read the coin, as it was.
  w.reset();
  const release = w.net.hold(new RegExp(`/address/${receive(25)}$`));
  const refreshed = w.chain.refresh();
  for (let turn = 0; turn < 8; turn++) await flush();
  assert.deepEqual([w.view().scanning, w.net.count(UTXO)], [true, 1], 'the scan is under way, and has read the coin');
  assert.deepEqual(await w.chain.broadcast(payment), { ok: true, txid: payment.txid });
  const applied = stateOf(w.chain);
  assert.deepEqual([applied.confirmed, applied.unconfirmed], [0n, change]);

  release();
  await refreshed;
  await w.settle();
  // What that scan read is older than what is shown: none of it is used, and the wallet is read again.
  assert.equal(w.net.count(TIP) >= 2, true, 'a second scan');
  const settled = stateOf(w.chain);
  assert.deepEqual(settled.coins, applied.coins, 'the second scan agrees with what was applied');
  assert.deepEqual([settled.confirmed, settled.unconfirmed, settled.nextChangeIndex], [0n, change, 1]);
  assert.deepEqual(notices, ['1: payment-sent'], 'the coin that was spent did not "arrive"');
  assert.equal(w.view().scanning, false);
  const next = w.chain.plan({ to: SOMEONE, amount: 10_000n, feeRate: 2n });
  assert.ok(next.ok);
  assert.deepEqual(next.inputs.map((coin) => coin.txid), [payment.txid], 'the next payment spends the change, not the coin that is gone');

  // A scan that straddles the payment: it asked about the addresses before, and reads the coins after.
  // Taken as it comes, it would show a wallet with no coins at all.
  const s = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  s.chain.watch('send');
  await s.settle();
  const news = noticesOf(s.chain);
  const second = signed(s.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  s.net.willTake(second);
  const slow = s.net.hold(ADDRESS);
  const scanning = s.chain.refresh();
  await flush();
  assert.deepEqual(await s.chain.broadcast(second), { ok: true, txid: second.txid });
  slow();
  await scanning;
  await s.settle();
  const state = stateOf(s.chain);
  assert.deepEqual([state.confirmed, state.unconfirmed, state.coins.length, state.nextChangeIndex], [0n, change, 1, 1]);
  assert.deepEqual(news, ['1: payment-sent']);

  // The scan nobody asked for: the one that follows a payment the poll found at an unused address.
  const p = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  p.chain.watch('send');
  await p.settle();
  const heard = noticesOf(p.chain);
  const third = signed(p.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  p.net.willTake(third);
  p.net.pay(receive(1), 7_000);
  p.net.mine();
  const late = p.net.hold(new RegExp(`/address/${receive(25)}$`));
  await p.timers.advance(15_000, flush);
  for (let turn = 0; turn < 8; turn++) await flush();
  assert.equal(p.view().scanning, true, 'the poll found the payment, and its scan is under way');
  assert.deepEqual(await p.chain.broadcast(third), { ok: true, txid: third.txid });
  late();
  await p.settle();
  const after = stateOf(p.chain);
  assert.deepEqual([after.confirmed, after.unconfirmed, after.nextReceiveIndex], [7_000n, change, 2]);
  assert.deepEqual(heard, ['1: coins-arrived 7000', '2: payment-sent']);
});

test('Esplora lists a payment a moment after the node has it: a read in between does not bring the spent coin back', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  w.chain.watch('send');
  await w.settle();
  const notices = noticesOf(w.chain);
  const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  w.net.willTake(payment);
  const change = 100_000n - 60_000n - payment.fee;

  // The node takes the payment. Esplora has not heard of it: it still lists the coin, and no change.
  w.net.lag = true;
  w.reset();
  assert.deepEqual(await w.chain.broadcast(payment), { ok: true, txid: payment.txid });
  const applied = stateOf(w.chain);
  await w.settle();
  assert.equal(w.net.count(UTXO), 2, 'the light refresh straight after the payment has read the coins of both addresses in use');
  assert.equal(w.chain.state(), applied, 'and what it read was dropped: it is older than what is shown');
  assert.deepEqual([applied.confirmed, applied.unconfirmed], [0n, change]);
  assert.deepEqual(notices, ['1: payment-sent']);
  assert.equal(w.view().error, null, 'being a moment behind is not a failure');
  const plan = w.chain.plan({ to: SOMEONE, amount: 10_000n, feeRate: 2n });
  assert.ok(plan.ok);
  assert.deepEqual(plan.inputs.map((coin) => coin.txid), [payment.txid], 'the coin that was spent is not offered again');

  // A full scan the reader asks for meanwhile is no better informed, and is dropped the same way.
  await w.chain.refresh();
  assert.equal(w.chain.state(), applied);
  assert.deepEqual(notices, ['1: payment-sent']);

  // The next poll reads the coins again although the height has not moved. Esplora has caught up.
  w.net.hear(payment.txid);
  w.reset();
  await w.advance(15_000);
  assert.deepEqual([w.net.count(TIP), w.net.count(UTXO)], [1, 2], 'the height, and the coins of both addresses in use');
  assert.equal(w.chain.state(), applied, 'the network now says what was applied');
  // And from then on a poll reads the coins only when the height has moved, as always.
  w.reset();
  await w.advance(15_000);
  assert.deepEqual(w.net.requests, ['GET /api/esplora/blocks/tip/height']);
  assert.deepEqual(notices, ['1: payment-sent']);

  // A payment the network never comes to know (dropped, or replaced) gives its coin back: after
  // two minutes a read that still lists the coin is believed.
  const d = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  d.chain.watch('send');
  await d.settle();
  const lost = signed(d.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  d.net.willTake(lost);
  d.net.lag = true;
  assert.equal((await d.chain.broadcast(lost)).ok, true);
  await d.advance(120_000);
  assert.equal(stateOf(d.chain).unconfirmed, change, 'two minutes: still the wallet as the payment left it');
  await d.advance(15_000);
  assert.deepEqual([stateOf(d.chain).confirmed, stateOf(d.chain).unconfirmed], [100_000n, 0n]);
});

test('broadcast is single-flight: the same payment again gets the first one\'s answer, and another payment waits its turn', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  // Another payment, made from the same coin: the node will not have both.
  const other = signed(w.chain, { to: SOMEONE, amount: 10_000n, feeRate: 2n });
  w.net.willTake(payment);
  w.net.refusing.set(other.hex, { code: 'coin_spent', detail: 'bad-txns-inputs-missingorspent' });
  w.reset();

  const release = w.net.hold();
  const first = w.chain.broadcast(payment);
  const second = w.chain.broadcast(payment);
  const third = w.chain.broadcast(other);
  await flush();
  assert.equal(w.net.count(BROADCAST), 1, 'one request is out');
  release();
  const answers = await Promise.all([first, second, third]);
  assert.deepEqual(answers[0], { ok: true, txid: payment.txid });
  assert.equal(answers[1], answers[0], 'a second tap: the very same answer');
  // The other payment is not the first one. It went out in its turn and has its own answer:
  // "sent", with the first one's ID, would have been false for it.
  assert.deepEqual(answers[2], { ok: false, reason: 'coin_spent', detail: 'bad-txns-inputs-missingorspent' });
  assert.equal(w.net.count(BROADCAST), 2);
  assert.deepEqual(w.events, ['Payment: sent', 'Payment: refused']);
  await w.settle();

  // Once it has answered, the next call is a new request. The node takes a waiting payment a second
  // time. It is one payment all the same: not applied, announced or counted again.
  const applied = stateOf(w.chain);
  const notice = w.chain.view().notice;
  assert.deepEqual(notice, { id: 1, kind: 'payment-sent' });
  assert.deepEqual(await w.chain.broadcast(payment), { ok: true, txid: payment.txid });
  assert.equal(w.net.count(BROADCAST), 3);
  await w.settle();
  assert.equal(w.chain.state(), applied);
  assert.equal(w.chain.view().notice, notice);
  assert.deepEqual(w.events, ['Payment: sent', 'Payment: refused']);

  // The same once it is in a block, when the node answers "already sent" and the page reads that as sent.
  w.chain.watch('coins');
  await w.settle();
  w.net.mine();
  await w.advance(15_000);
  const confirmed = stateOf(w.chain);
  assert.deepEqual([confirmed.confirmed, confirmed.unconfirmed], [100_000n - 60_000n - payment.fee, 0n]);
  assert.deepEqual(w.chain.view().notice, { id: 2, kind: 'confirmed' });
  assert.deepEqual(await w.chain.broadcast(payment), { ok: true, txid: payment.txid });
  await w.settle();
  assert.equal(w.chain.state(), confirmed, 'the confirmed change does not turn unconfirmed again');
  assert.deepEqual(w.chain.view().notice, { id: 2, kind: 'confirmed' });
  assert.deepEqual(w.events, ['Payment: sent', 'Payment: refused']);

  // Things that are not payments at all, handed in together: each is answered for itself, and nothing hangs.
  const odd = await Promise.all([w.chain.broadcast(null as never), w.chain.broadcast({} as never), w.chain.broadcast(undefined as never)]);
  assert.deepEqual(odd.map((answer) => answer.ok), [false, false, false]);
});

test('broadcast: a payment to an address the pot handed out here is counted as passed on', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  // To the same address before the pot handed it out: an ordinary payment.
  const early = signed(w.chain, { to: POT, amount: 1_000n, feeRate: 2n });
  w.net.willTake(early);
  assert.equal((await w.chain.broadcast(early)).ok, true);
  await w.settle();

  assert.deepEqual(await w.chain.potAddress(), { ok: true, address: POT });
  const gift = signed(w.chain, { to: POT, amount: 20_000n, feeRate: 2n });
  w.net.willTake(gift);
  assert.equal((await w.chain.broadcast(gift)).ok, true);
  assert.deepEqual(w.events, ['Payment: sent', 'Payment: sent-to-pot']);

  w.net.down = 'limit';
  assert.deepEqual(await w.chain.potAddress(), { ok: false, reason: 'limit' });
  w.net.down = 'network';
  assert.deepEqual(await w.chain.potAddress(), { ok: false, reason: 'network' });
  w.net.down = 'garbage';
  assert.deepEqual(await w.chain.potAddress(), { ok: false, reason: 'unavailable' });
});

test('broadcast: "already sent", "coin spent", "could not answer" and no answer are a success when the network knows the transaction', async () => {
  // "unavailable" is what the Worker says when it has waited for the practice network as long as
  // it will. The node may have taken the payment in that time, as after no answer at all.
  for (const how of ['already_sent', 'coin_spent', 'unavailable', 'network'] as const) {
    const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
    const before = stateOf(w.chain);
    const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
    // It reached the node once already (the answer was lost on the way back, say).
    w.net.willTake(payment);
    assert.equal(await makeApi(w.net.fetch).esplora.broadcast(payment.hex), payment.txid);
    if (how === 'network') {
      w.net.down = 'network';
      w.net.downFor = BROADCAST;
    } else {
      w.net.refusing.set(payment.hex, { code: how, detail: 'the node has its reasons' });
    }
    w.reset();

    assert.deepEqual(await w.chain.broadcast(payment), { ok: true, txid: payment.txid }, how);
    assert.equal(w.net.count(new RegExp(`GET /api/esplora/tx/${payment.txid}$`)), 1, how);
    assert.deepEqual(stateOf(w.chain), applyPayment(before, payment), how);
    assert.deepEqual(w.chain.view().notice, { id: 1, kind: 'payment-sent' }, how);
    assert.deepEqual(w.events, ['Payment: sent'], how);
  }
});

test('broadcast: a refusal comes back with its code and the node\'s own words, and changes nothing', async () => {
  const cases = [
    { code: 'coin_spent', detail: 'bad-txns-inputs-missingorspent', counted: true },
    { code: 'already_sent', detail: 'Transaction outputs already in utxo set', counted: true },
    { code: 'fee_too_low', detail: 'min relay fee not met, 5 < 11', counted: true },
    { code: 'dust', detail: 'dust, tx with dust output must be 0-fee', counted: true },
    { code: 'refused', detail: 'too-large-cluster', counted: true },
    // Not the node's doing: the payment never reached it, so nothing was "refused".
    { code: 'limit', detail: undefined, counted: false },
    { code: 'unavailable', detail: undefined, counted: false },
    { code: 'forbidden', detail: undefined, counted: false },
  ] as const;
  for (const { code, detail, counted } of cases) {
    const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
    const state = stateOf(w.chain);
    const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
    w.net.refusing.set(payment.hex, { code, detail });
    const expected = code === 'forbidden' ? 'unavailable' : code;
    assert.deepEqual(await w.chain.broadcast(payment), { ok: false, reason: expected, detail: detail ?? null }, code);
    assert.equal(w.chain.state(), state, code);
    assert.equal(w.chain.view().notice, null, code);
    assert.deepEqual(w.events, counted ? ['Payment: refused'] : [], code);
    // An unknown transaction was looked for only where that could change the answer: after the
    // answers a payment can also get when it did reach the node. ("forbidden" reads as "unavailable".)
    const looked = w.net.count(new RegExp(`GET /api/esplora/tx/${payment.txid}$`));
    assert.equal(looked, expected === 'coin_spent' || expected === 'already_sent' || expected === 'unavailable' ? 1 : 0, code);
  }

  // No answer, and the network does not know the transaction either: not sent, and not "refused".
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  w.net.down = 'network';
  assert.deepEqual(await w.chain.broadcast(payment), { ok: false, reason: 'network', detail: null });
  assert.deepEqual(w.events, []);
});

test('lastSent: the payment this page last sent, whether it went to the pot, and when; gone when another wallet is here', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  assert.equal(w.chain.view().lastSent, null);
  /** Each view in which the last payment changed, with the notice that stood beside it. */
  const seen: string[] = [];
  let last = w.chain.view().lastSent;
  w.chain.subscribe(() => {
    const now = w.chain.view();
    if (now.lastSent !== last) seen.push(`${now.lastSent?.txid.slice(0, 8) ?? 'null'} beside ${now.notice?.kind ?? 'nothing'}`);
    last = now.lastSent;
  });

  // An ordinary payment. Noted at the moment it is counted, with the page's clock.
  w.clock.ms += 7_000;
  const first = signed(w.chain, { to: SOMEONE, amount: 10_000n, feeRate: 2n });
  w.net.willTake(first);
  assert.equal((await w.chain.broadcast(first)).ok, true);
  assert.deepEqual(w.chain.view().lastSent, { txid: first.txid, toPot: false, at: w.clock.ms });
  assert.deepEqual(w.events, ['Payment: sent']);
  await w.settle();
  const noted = w.chain.view().lastSent;

  // A refused payment was not sent: nothing changes.
  const refused = signed(w.chain, { to: SOMEONE, amount: 2_000n, feeRate: 2n });
  w.net.refusing.set(refused.hex, { code: 'dust', detail: 'dust' });
  assert.equal((await w.chain.broadcast(refused)).ok, false);
  assert.equal(w.chain.view().lastSent, noted, 'the very same object: nothing is drawn again');
  // No answer, and the network does not know it: not sent either.
  w.net.down = 'network';
  assert.equal((await w.chain.broadcast(refused)).ok, false);
  w.net.down = null;
  assert.equal(w.chain.view().lastSent, noted);
  // The same payment handed in again is one payment: the note keeps its first moment.
  w.clock.ms += 60_000;
  assert.deepEqual(await w.chain.broadcast(first), { ok: true, txid: first.txid });
  assert.equal(w.chain.view().lastSent, noted);

  // To an address the pot handed out in this page: "Pass it on".
  assert.deepEqual(await w.chain.potAddress(), { ok: true, address: POT });
  w.clock.ms += 5_000;
  const gift = signed(w.chain, { to: POT, amount: 20_000n, feeRate: 2n });
  w.net.willTake(gift);
  assert.equal((await w.chain.broadcast(gift)).ok, true);
  assert.deepEqual(w.chain.view().lastSent, { txid: gift.txid, toPot: true, at: w.clock.ms });
  assert.deepEqual(w.events, ['Payment: sent', 'Payment: refused', 'Payment: sent-to-pot']);
  await w.settle();
  // Polls, blocks and a full scan leave it alone.
  w.chain.watch('wallet');
  w.net.mine();
  await w.advance(30_000);
  await w.chain.refresh();
  assert.deepEqual(w.chain.view().lastSent, { txid: gift.txid, toPot: true, at: w.clock.ms - 30_000 });

  // It is shown in the same change as the "payment sent" notice: whoever reads one has the other.
  assert.deepEqual(seen, [`${first.txid.slice(0, 8)} beside payment-sent`, `${gift.txid.slice(0, 8)} beside payment-sent`]);

  // Another wallet in the page: its "last sent" is not the wallet's before it. And no wallet: none.
  void w.chain.open(B.xpub);
  assert.equal(w.chain.view().lastSent, null);
  await w.settle();
  assert.equal(w.chain.view().lastSent, null);
  void w.chain.open(A.xpub);
  await w.settle();
  assert.equal(w.chain.view().lastSent, null, 'back again, it is still gone: it lived in memory, for that one stay');
  const again = signed(w.chain, { to: SOMEONE, amount: 3_000n, feeRate: 2n });
  w.net.willTake(again);
  assert.equal((await w.chain.broadcast(again)).ok, true);
  assert.equal(w.chain.view().lastSent?.txid, again.txid);
  w.chain.close();
  assert.equal(w.chain.view().lastSent, null);
  assert.deepEqual(w.unlisted, []);
});

test('lastSent: a payment that goes out as the wallet leaves the page is not noted for the wallet that comes', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  w.net.willTake(payment);
  const release = w.net.hold();
  const sending = w.chain.broadcast(payment);
  // Another wallet is put in its place while the payment is on its way.
  void w.chain.open(B.xpub);
  release();
  assert.deepEqual(await sending, { ok: true, txid: payment.txid });
  await w.settle();
  assert.deepEqual(w.events, ['Payment: sent'], 'it was sent, and counted');
  assert.equal(w.chain.view().lastSent, null, 'but it is not the last payment of the wallet that is here now');
});

test('potStats: the pot\'s three counts, or why they could not be had; one request, and nothing kept', async () => {
  const w = await opened();
  w.net.potStats = { passedOn: 128, waiting: 3, handedOn: 125 };
  assert.deepEqual(await w.chain.potStats(), { ok: true, stats: { passedOn: 128, waiting: 3, handedOn: 125 } });
  assert.deepEqual(w.net.requests, ['GET /api/pot/stats']);
  // Asked again, it asks again: the wallet keeps no count.
  w.net.potStats = { passedOn: 129, waiting: 4, handedOn: 125 };
  assert.deepEqual(await w.chain.potStats(), { ok: true, stats: { passedOn: 129, waiting: 4, handedOn: 125 } });
  assert.equal(w.net.requests.length, 2);
  // It needs no wallet: the pot is everybody's.
  const none = watching();
  assert.deepEqual(await none.chain.potStats(), { ok: true, stats: { passedOn: 0, waiting: 0, handedOn: 0 } });

  const failures: [Failure, string][] = [
    ['limit', 'limit'],
    ['unavailable', 'unavailable'],
    ['network', 'network'],
    ['page', 'unavailable'],
    ['garbage', 'unavailable'],
    ['not_found', 'not_found'],
  ];
  for (const [down, reason] of failures) {
    w.net.down = down;
    assert.deepEqual(await w.chain.potStats(), { ok: false, reason }, down);
  }
  w.net.down = null;
  // Nothing of it is shown by the wallet, counted or announced.
  assert.deepEqual([w.chain.view().notice, w.events, w.unlisted], [null, [], []]);
});

test('broadcast: a payment sent as the wallet leaves the page is still reported sent, and applied to nothing', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  w.net.willTake(payment);
  const release = w.net.hold();
  const sending = w.chain.broadcast(payment);
  w.chain.close();
  release();
  assert.deepEqual(await sending, { ok: true, txid: payment.txid });
  await w.settle();
  assert.equal(w.chain.state(), null);
  assert.equal(w.chain.view().chain.state, null);
});

// -- requests that get no answer ----------------------------------------------------------

test('withDeadline: every request carries a signal that ends it, with more time for the faucet', async () => {
  const made: { input: string; init: RequestInit | undefined }[] = [];
  const limits: number[] = [];
  const signal = new AbortController().signal;
  const answering = async (input: string, init?: RequestInit): Promise<Response> => {
    made.push({ input, init });
    return new Response('ok');
  };
  const bounded = withDeadline(answering, (ms) => {
    limits.push(ms);
    return signal;
  });
  const post = { method: 'POST', body: '00', headers: { 'Content-Type': 'text/plain' } };
  await bounded('/api/esplora/blocks/tip/height');
  await bounded('/api/esplora/tx', post);
  await bounded('/api/faucet', { method: 'POST', body: '{}' });
  await bounded('/api/pot/address', { method: 'POST' });
  await bounded('/api/config');
  assert.deepEqual(limits, [20_000, 20_000, 40_000, 20_000, 20_000]);
  assert.deepEqual([REQUEST_MS, FAUCET_REQUEST_MS], [20_000, 40_000]);
  // What was asked for is passed on whole, with the signal added.
  assert.deepEqual(made[0], { input: '/api/esplora/blocks/tip/height', init: { signal } });
  assert.deepEqual(made[1], { input: '/api/esplora/tx', init: { ...post, signal } });
  assert.deepEqual(post, { method: 'POST', body: '00', headers: { 'Content-Type': 'text/plain' } }, 'the caller\'s own object is left alone');

  // A browser that cannot make such a signal: the request goes out as it always did.
  const plain = withDeadline(answering, () => {
    throw new TypeError('AbortSignal.timeout is not a function');
  });
  await plain('/api/config');
  await plain('/api/esplora/tx', post);
  assert.deepEqual(made.slice(-2), [
    { input: '/api/config', init: undefined },
    { input: '/api/esplora/tx', init: post },
  ]);

  // The settings are loaded through it too. With no answer the first try is given up after 20 s,
  // a second one follows a moment later, and when that is given up as well the built-in settings
  // stand, marked as not loaded.
  const net = new FakeNetwork();
  net.silent = true;
  const clock = new FakeClock();
  const timers = new FakeTimers(clock);
  const pause = (ms: number): Promise<void> => new Promise((resolve) => void timers.set(resolve, ms));
  let loaded: unknown = null;
  void loadConfig(withDeadline(net.fetch, giveUpOn(timers)), pause).then((answer) => {
    loaded = answer;
  });
  await timers.advance(19_999, turns);
  assert.equal(loaded, null);
  assert.equal(net.count(/^GET \/api\/config$/), 1);
  // Given up. Nothing is said yet: the second try is still to come.
  await timers.advance(1, turns);
  assert.equal(loaded, null);
  await timers.advance(CONFIG_RETRY_MS, turns);
  assert.equal(net.count(/^GET \/api\/config$/), 2);
  await timers.advance(19_999, turns);
  assert.equal(loaded, null);
  await timers.advance(1, turns);
  assert.deepEqual(loaded, { config: { ...DEFAULT_CONFIG }, loaded: false });
  assert.equal(net.count(/^GET \/api\/config$/), 2);
});

test('a request that gets no answer is given up after 20 s: nothing waits behind it for ever', async () => {
  // The first scan.
  const w = watching(new FakeNetwork(), { deadline: true });
  w.net.pay(receive(0), 100_000, { confirmed: true });
  w.net.silent = true;
  void w.chain.open(A.xpub);
  w.chain.watch('wallet');
  await w.timers.advance(19_999, turns);
  assert.deepEqual([w.view().scanning, w.view().error, w.view().state], [true, null, null]);
  await w.timers.advance(1, turns);
  assert.deepEqual([w.view().scanning, w.view().error, w.view().retryAt], [false, 'network', w.clock.ms + 15_000]);
  // "Try again", with the network answering: it is not stuck behind the request that got no answer.
  w.net.silent = false;
  await w.chain.refresh();
  assert.deepEqual([stateOf(w.chain).confirmed, w.view().error], [100_000n, null]);
  await w.settle();

  // One poll with no answer. The page says so, tries again by itself, and goes on polling.
  w.net.silent = true;
  await w.timers.advance(15_000, turns);
  await w.timers.advance(20_000, turns);
  assert.deepEqual([w.view().error, w.view().retryAt], ['network', w.clock.ms + 15_000]);
  w.net.silent = false;
  w.net.pay(receive(1), 5_000);
  w.net.mine();
  await w.advance(15_000);
  assert.deepEqual([w.view().error, stateOf(w.chain).confirmed], [null, 105_000n]);
  w.reset();
  await w.advance(30_000);
  assert.equal(w.net.count(TIP), 2, 'the poll runs again, every 15 s');

  // A broadcast with no answer: "network", once the request and the look for the transaction have both
  // been given up. The next one is a new request, not the old one's promise.
  const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  w.net.willTake(payment);
  w.net.silent = true;
  const answers: unknown[] = [];
  void w.chain.broadcast(payment).then((answer) => answers.push(answer));
  await w.timers.advance(39_999, turns);
  assert.deepEqual(answers, []);
  await w.timers.advance(1, turns);
  assert.deepEqual(answers, [{ ok: false, reason: 'network', detail: null }]);
  // Whatever else was asked meanwhile answers too.
  const others: unknown[] = [];
  void w.chain.potAddress().then((answer) => others.push(answer));
  void w.chain.lookupTx('ab'.repeat(32)).then((answer) => others.push(answer));
  void w.chain.probe(B.xpub).then((answer) => others.push(answer));
  await w.timers.advance(20_000, turns);
  assert.deepEqual(others, [
    { ok: false, reason: 'network' },
    { kind: 'failed', reason: 'network' },
    { ok: false, reason: 'network' },
  ]);
  w.net.silent = false;
  assert.deepEqual(await w.chain.broadcast(payment), { ok: true, txid: payment.txid });
});

test('broadcast: a payment that waited its turn while another wallet arrived is sent, and applied to neither wallet', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  const other = signed(w.chain, { to: SOMEONE, amount: 10_000n, feeRate: 2n });
  w.net.willTake(payment);
  w.net.willTake(other);

  // The first is with the node, which is slow to answer. The second waits its turn.
  const release = w.net.hold(BROADCAST);
  const first = w.chain.broadcast(payment);
  const second = w.chain.broadcast(other);
  // Meanwhile another wallet takes this one's place in the page, and its first scan finishes.
  void w.chain.open(B.xpub);
  for (let turn = 0; turn < 12; turn++) await flush();
  const theirs = stateOf(w.chain);
  assert.equal(w.chain.view().receive?.address, deriveAddress(watchOnlyAccount(B.xpub), 0, 1).address, 'the other wallet is here now');

  release();
  assert.deepEqual(await first, { ok: true, txid: payment.txid });
  assert.deepEqual(await second, { ok: true, txid: other.txid }, 'sent all the same: the reader asked for it');
  assert.equal(w.net.count(BROADCAST), 2);
  // Neither payment is this wallet's: its coins are as its own scan found them.
  assert.equal(w.chain.state(), theirs);
  await w.settle();
  assert.equal(w.chain.state(), theirs);
});

// -- faults in what the engine is handed ------------------------------------------------

test('whatever the network does, every action answers and none throws', async () => {
  const request: PaymentRequest = { to: SOMEONE, amount: 1_000n, feeRate: 2n };
  const fetches: [string, (input: string, init?: RequestInit) => Promise<Response>][] = [
    ['rejects', () => Promise.reject(new TypeError('fetch failed'))],
    ['throws before it returns', () => { throw new Error('no fetch here'); }],
    ['never a Response', () => Promise.resolve(undefined as unknown as Response)],
    ['an empty 200', () => Promise.resolve(new Response('', { status: 200 }))],
    ['JSON of the wrong shape', () => Promise.resolve(new Response('{"chain_stats":null}', { status: 200 }))],
    ['a 500 with nothing in it', () => Promise.resolve(new Response(null, { status: 500 }))],
  ];
  for (const [name, fetchFn] of fetches) {
    const clock = new FakeClock();
    const timers = new FakeTimers(clock);
    const chain = makeChainSync({
      api: makeApi(fetchFn),
      now: clock.now,
      timers,
      visible: () => true,
      track: recorder().track,
      blockSeconds: () => 30,
    });
    const settle = async () => {
      await flush();
      await chain.idle();
      await flush();
    };
    void chain.open(A.xpub);
    chain.watch('receive');
    await settle();
    assert.equal(chain.view().chain.state, null, name);
    assert.notEqual(chain.view().chain.error, null, name);
    await chain.refresh();
    await timers.advance(120_000, settle);
    assert.equal(chain.view().chain.state, null, name);

    assert.equal((await chain.lookupTx('ab'.repeat(32))).kind, 'failed', name);
    assert.equal((await chain.potAddress()).ok, false, name);
    assert.equal(chain.plan(request).ok, false, name);
    assert.equal((await chain.probe(A.xpub)).ok, false, name);
    assert.equal((await chain.probe('not a key')).ok, false, name);
    chain.newReceiveAddress();
    chain.visibilityChanged();
    chain.close();
    await settle();
  }
});

test('broadcast answers for anything it is handed', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  for (const odd of [null, undefined, {}, { txid: 'x' }, 'a payment']) {
    const answer = await w.chain.broadcast(odd as never);
    assert.equal(answer.ok, false, JSON.stringify(odd));
  }
  // A payment whose list of outputs is broken, but which the node takes: sent is sent.
  const payment = signed(w.chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  w.net.willTake(payment);
  const broken = { ...payment, outputs: null } as unknown as SignedPayment;
  assert.deepEqual(await w.chain.broadcast(broken), { ok: true, txid: payment.txid });
  // The wallet's own picture of it failed, so everything is read again.
  await w.settle();
  assert.equal(stateOf(w.chain).unconfirmed, 100_000n - 60_000n - payment.fee);
});

test('a clock, timers, a visibility check, a block interval and an event sender that all throw stop nothing', async () => {
  const net = new FakeNetwork();
  net.pay(receive(0), 100_000, { confirmed: true });
  const boom = (): never => {
    throw new Error('not today');
  };
  const chain = makeChainSync({
    api: makeApi(net.fetch),
    now: boom,
    timers: { set: boom, clear: boom },
    visible: boom,
    track: boom,
    blockSeconds: boom,
  });
  const settle = async () => {
    for (let round = 0; round < 3; round++) {
      await flush();
      await chain.idle();
    }
  };
  const first = chain.open(A.xpub);
  chain.watch('receive');
  chain.visibilityChanged();
  await settle();
  assert.deepEqual(await first, { history: true });
  assert.equal(stateOf(chain).confirmed, 100_000n);

  const payment = signed(chain, { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  net.willTake(payment);
  assert.deepEqual(await chain.broadcast(payment), { ok: true, txid: payment.txid });
  await settle();
  chain.rememberTx(payment.txid);
  assert.equal((await chain.lookupTx(payment.txid)).kind, 'found');
  await chain.refresh();
  chain.newReceiveAddress();
  chain.announce('locked');
  chain.close();

  // A clock that gives nonsense is read as zero, not passed on.
  const odd = makeChainSync({
    api: makeApi(net.fetch),
    now: () => Number.NaN,
    timers: new FakeTimers(new FakeClock()),
    visible: () => true,
    track: recorder().track,
    blockSeconds: () => Number.NaN,
  });
  void odd.open(A.xpub);
  await flush();
  await odd.idle();
  assert.equal(odd.view().chain.checkedAt, 0);
});

test('no event the chain engine counts is off the contract\'s list', async () => {
  const w = await opened((net) => net.pay(receive(0), 100_000, { confirmed: true }));
  await w.chain.potAddress();
  const gift = signed(w.chain, { to: POT, amount: 20_000n, feeRate: 2n });
  w.net.willTake(gift);
  await w.chain.broadcast(gift);
  await w.settle();
  const refused = signed(w.chain, { to: SOMEONE, amount: 1_000n, feeRate: 2n });
  w.net.refusing.set(refused.hex, { code: 'dust', detail: 'dust' });
  await w.chain.broadcast(refused);
  assert.deepEqual(w.events, ['Payment: sent-to-pot', 'Payment: refused']);
  assert.deepEqual(w.unlisted, []);
});
