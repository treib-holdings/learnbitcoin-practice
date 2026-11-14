// The transaction screen's rules (src/screens/read/read.ts) played against
// the real chain engine, on the engine's own test stand-ins and a clock
// driven by hand. The helpers' own tests feed them answers written by hand;
// these feed them the answers the wallet really gives, in the order and at
// the times it gives them. Two things only show that way:
//
//   - which of the two clocks ends a wait (the wallet's, every time), and
//     what the reader is then told;
//   - that a block can confirm a transaction on screen without changing
//     the wallet's coins or its list, so the screen has to look again at
//     every block and not only when those two change.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountFromMnemonic, deriveAddress, watchOnlyAccount } from '@learnbitcoin/practice-wallet';
import { makeApi } from '../src/lib/api.ts';
import { makeChainSync } from '../src/lib/chain-sync.ts';
import { fill } from '../src/lib/format.ts';
import { WAIT_LIMIT_MS, afterLookup, type TxShows } from '../src/screens/read/read.ts';
import { strings } from '../src/strings/index.ts';
import { FakeClock, FakeNetwork, FakeTimers, SOMEONE, flush, recorder, test } from './engine-fakes.ts';

const vectors = JSON.parse(readFileSync(new URL('../../wallet/test/vectors.json', import.meta.url), 'utf8')) as {
  abandon: { mnemonic: string };
};
const A = accountFromMnemonic(vectors.abandon.mnemonic);
const receive = (index: number): string => deriveAddress(watchOnlyAccount(A.xpub), 0, index).address;

/** The chain engine with this wallet open and its first scan done. */
async function world() {
  const clock = new FakeClock();
  const timers = new FakeTimers(clock);
  const net = new FakeNetwork();
  const chain = makeChainSync({
    api: makeApi(net.fetch),
    now: clock.now,
    timers,
    visible: () => true,
    track: recorder().track,
    blockSeconds: () => 30,
  });
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 3; round++) {
      await flush();
      await chain.idle();
    }
    await flush();
  };
  return { chain, clock, timers, net, settle, advance: (ms: number) => timers.advance(ms, settle) };
}

/**
 * The screen's asking, as Tx.svelte's ask() does it: ask, take the step,
 * ask again after askAgainIn. It ends when nothing more is asked by itself.
 */
async function waitOut(w: Awaited<ReturnType<typeof world>>, txid: string): Promise<{ shows: TxShows; waitedOut: boolean; asks: number }> {
  let waitingSince: number | null = null;
  let waitedOut = false;
  let shows: TxShows = { kind: 'asking' };
  let asks = 0;
  for (;;) {
    const step = afterLookup(await w.chain.lookupTx(txid), waitingSince, w.clock.ms, waitedOut);
    asks += 1;
    waitingSince = step.waitingSince;
    waitedOut = step.waitedOut;
    shows = step.shows;
    if (step.askAgainIn === null) return { shows, waitedOut, asks };
    w.clock.ms += step.askAgainIn;
    assert.ok(asks < 200, 'the asking ends');
  }
}

// However long after the ID was handed over the screen opens, the wallet's
// two minutes are up before the screen's own. The reader must then be told
// that the wait ran out, not that nobody knows the ID.
for (const opensAfter of [200, 2000, 30_000, 100_000]) {
  test(`a payment this page was promised and the network never lists, screen opened ${opensAfter} ms later: the wait runs out`, async () => {
    const w = await world();
    void w.chain.open(A.xpub);
    await w.settle();
    w.net.lag = true;
    const promised = w.net.pay(receive(0), 100_000);
    // What the faucet flow and a broadcast do with the ID they return.
    w.chain.rememberTx(promised);
    const handed = w.clock.ms;
    w.clock.ms += opensAfter;

    const first = afterLookup(await w.chain.lookupTx(promised), null, w.clock.ms);
    assert.equal(first.shows.kind, 'waiting');

    const end = await waitOut(w, promised);
    assert.deepEqual(end.shows, { kind: 'not-found', waited: true });
    // It was the wallet's clock that ended it: two minutes from the moment the ID was handed over.
    assert.ok(w.clock.ms - handed >= WAIT_LIMIT_MS && w.clock.ms - handed < WAIT_LIMIT_MS + 6000, `${w.clock.ms - handed} ms`);

    // What the reader reads is the text for a wait that ran out.
    const t = strings.wallet.en;
    const text = end.shows.kind === 'not-found' && end.shows.waited ? fill(t.txNotFoundWaited, { minutes: String(WAIT_LIMIT_MS / 60_000) }) : t.txNotFound;
    assert.match(text, /^After 2 minutes the practice network still does not list this transaction\./);

    // "Try again" (the screen forgets since when it waited), and the look a new block starts: the same cause.
    const again = afterLookup(await w.chain.lookupTx(promised), null, w.clock.ms, end.waitedOut);
    assert.deepEqual(again.shows, { kind: 'not-found', waited: true });
    assert.equal(again.askAgainIn, null);
  });
}

test('an ID nobody handed this page: not listed, and no wait is claimed', async () => {
  const w = await world();
  void w.chain.open(A.xpub);
  await w.settle();
  const end = await waitOut(w, 'ab'.repeat(32));
  assert.deepEqual(end.shows, { kind: 'not-found', waited: false });
  assert.equal(end.asks, 1);
});

test('a promised payment that the network lists during the wait is shown, and the wait is forgotten', async () => {
  const w = await world();
  void w.chain.open(A.xpub);
  await w.settle();
  w.net.lag = true;
  const promised = w.net.pay(receive(0), 100_000);
  w.chain.rememberTx(promised);
  let step = afterLookup(await w.chain.lookupTx(promised), null, w.clock.ms);
  assert.equal(step.shows.kind, 'waiting');
  w.clock.ms += 3000;
  w.net.hear(promised);
  step = afterLookup(await w.chain.lookupTx(promised), step.waitingSince, w.clock.ms, step.waitedOut);
  assert.equal(step.shows.kind, 'found');
  assert.deepEqual([step.waitingSince, step.waitedOut, step.askAgainIn], [null, false, null]);
});

test("another wallet's transaction confirms: the wallet's coins and its list stay the very same, only the height moves", async () => {
  const w = await world();
  // Every coin of this wallet is confirmed, so the next block changes nothing in the wallet itself.
  w.net.pay(receive(0), 100_000, { confirmed: true });
  const theirs = w.net.pay(SOMEONE, 5000);
  void w.chain.open(A.xpub);
  await w.settle();
  w.chain.watch('tx');
  await w.settle();

  const first = await w.chain.lookupTx(theirs);
  assert.ok(first.kind === 'found' && !first.view.confirmed && first.view.direction === 'other');
  const before = w.chain.view();
  assert.notEqual(before.chain.state, null);
  assert.notEqual(before.history, null);

  // A block, and the time in which the wallet reads the new height and looks at its coins again.
  w.net.mine();
  await w.advance(60_000);
  const after = w.chain.view();
  // Nothing the screen followed before has changed: not the coins, not the list.
  assert.equal(after.chain.state, before.chain.state);
  assert.equal(after.history, before.history);
  // The height has. That is what the screen's new look hangs on.
  assert.notEqual(after.chain.tip, before.chain.tip);
  const second = await w.chain.lookupTx(theirs);
  assert.ok(second.kind === 'found' && second.view.confirmed, 'a look after the block finds it confirmed');

  // And the screen does follow the height.
  const screen = readFileSync(new URL('../src/screens/Tx.svelte', import.meta.url), 'utf8');
  assert.match(screen, /let tip = \$derived\(wallet\.chain\.tip\);/);
  assert.match(screen, /void listed;\n\s+void tip;\n\s+untrack\(/);
});
