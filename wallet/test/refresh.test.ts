import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Esplora,
  EsploraError,
  LOOKAHEAD,
  accountFromMnemonic,
  coinTotals,
  deriveAddress,
  inBatches,
  isSpendable,
  ownAddresses,
  refreshWallet,
  scanWallet,
  spendableCoins,
  watchOnlyAccount,
  type WalletState,
} from '../src/index.ts';
import { V, coinAt, copyOf, fakeEsplora, stateOf, type FakeAddress } from './helpers.ts';

const account = accountFromMnemonic(V.abandon.mnemonic).key;
// Everything here works from the public account key alone.
const watch = watchOnlyAccount(V.abandon.xpub);
const r = (index: number) => deriveAddress(watch, 0, index).address;
const c = (index: number) => deriveAddress(watch, 1, index).address;

/**
 * A wallet that has been paid at receive addresses 0 and 2 and holds
 * unconfirmed change at change address 0. Returns the chain and the scanned state.
 */
async function scanned(extra: Record<string, FakeAddress> = {}) {
  const chain = fakeEsplora({
    [r(0)]: { txCount: 1, utxos: [{ txid: 'aa'.repeat(32), vout: 0, value: 100_000, height: 120 }] },
    [r(2)]: { txCount: 2, utxos: [{ txid: 'bb'.repeat(32), vout: 1, value: 25_000, height: 121 }] },
    [c(0)]: { mempoolTxCount: 1, utxos: [{ txid: 'cc'.repeat(32), vout: 1, value: 40_000 }] },
    ...extra,
  });
  const state = await scanWallet(watch, chain.esplora);
  chain.calls.length = 0;
  return { ...chain, state };
}

const coinIds = (state: WalletState) => state.coins.map((coin) => `${coin.txid.slice(0, 2)}:${coin.vout}`).sort();

test('a light refresh reads the coins of every used address and looks at the skipped and the next five unused on each chain', async () => {
  const { esplora, calls, state } = await scanned();
  assert.equal(LOOKAHEAD, 5);
  assert.equal(state.nextReceiveIndex, 3);
  assert.equal(state.nextChangeIndex, 1);
  const before = copyOf(state);

  const { state: fresh, rescan } = await refreshWallet(watch, esplora, state);

  assert.deepEqual(
    [...calls].sort(),
    [
      // coins of the three addresses in use
      `GET /address/${r(0)}/utxo`,
      `GET /address/${r(2)}/utxo`,
      `GET /address/${c(0)}/utxo`,
      // a look at receive 1, which was skipped over and can still be paid ...
      `GET /address/${r(1)}`,
      // ... and at receive 3 to 7 and change 1 to 5
      ...[3, 4, 5, 6, 7].map((i) => `GET /address/${r(i)}`),
      ...[1, 2, 3, 4, 5].map((i) => `GET /address/${c(i)}`),
    ].sort(),
  );
  assert.equal(rescan, false);
  assert.deepEqual(fresh, state, 'nothing happened on the chain, so nothing changed');
  assert.notEqual(fresh, state, 'but the answer is a new object');
  assert.deepEqual(state, before, 'and the previous state is untouched');
});

test('fresh coins and totals: spent coins go, new ones arrive, unconfirmed ones confirm', async () => {
  const { esplora, known, state } = await scanned();
  assert.deepEqual(coinIds(state), ['aa:0', 'bb:1', 'cc:1']);
  assert.deepEqual([state.confirmed, state.unconfirmed], [125_000n, 40_000n]);
  const before = copyOf(state);

  known[r(0)]!.utxos = []; // spent
  known[c(0)]!.utxos = [{ txid: 'cc'.repeat(32), vout: 1, value: 40_000, height: 122 }]; // confirmed
  known[r(2)]!.utxos!.push({ txid: 'dd'.repeat(32), vout: 0, value: 7_000 }); // paid again, not yet confirmed

  const { state: fresh, rescan } = await refreshWallet(watch, esplora, state);
  assert.equal(rescan, false);
  assert.deepEqual(coinIds(fresh), ['bb:1', 'cc:1', 'dd:0']);
  assert.deepEqual([fresh.confirmed, fresh.unconfirmed], [65_000n, 7_000n]);
  assert.deepEqual(coinTotals(fresh.coins), { confirmed: 65_000n, unconfirmed: 7_000n });
  const arrived = fresh.coins.find((coin) => coin.txid === 'dd'.repeat(32))!;
  assert.deepEqual(
    { chain: arrived.chain, index: arrived.index, address: arrived.address, value: arrived.value, status: arrived.status },
    { chain: 0, index: 2, address: r(2), value: 7_000n, status: { confirmed: false } },
  );
  assert.deepEqual(arrived.script, deriveAddress(watch, 0, 2).script);
  assert.equal(fresh.coins.find((coin) => coin.txid === 'cc'.repeat(32))!.status.confirmed, true);

  // The address book is the previous one: only a full scan rewrites it.
  assert.equal(fresh.receive, state.receive);
  assert.equal(fresh.change, state.change);
  assert.deepEqual([fresh.nextReceiveIndex, fresh.nextChangeIndex], [3, 1]);
  assert.deepEqual(state, before, 'the previous state is untouched');
});

test('rescan is true when a look-ahead address has a transaction, confirmed or not', async () => {
  // An unconfirmed payment to the next receive address: the coin is in the answer at once.
  {
    const { esplora, calls, known, state } = await scanned();
    known[r(3)] = { mempoolTxCount: 1, utxos: [{ txid: 'ee'.repeat(32), vout: 0, value: 100_000 }] };
    const before = copyOf(state);
    const { state: fresh, rescan } = await refreshWallet(watch, esplora, state);
    assert.equal(rescan, true);
    assert.ok(calls.includes(`GET /address/${r(3)}/utxo`));
    assert.deepEqual(coinIds(fresh), ['aa:0', 'bb:1', 'cc:1', 'ee:0']);
    const coin = fresh.coins.find((x) => x.txid === 'ee'.repeat(32))!;
    assert.deepEqual([coin.chain, coin.index, coin.address, coin.value], [0, 3, r(3), 100_000n]);
    assert.equal(fresh.unconfirmed, 140_000n);
    // The markers stay where they were until scanWallet moves them.
    assert.equal(fresh.nextReceiveIndex, 3);
    assert.equal(fresh.receive[3]!.used, false);
    assert.deepEqual(state, before);
    // And the full scan the caller then runs does move them.
    const rescanned = await scanWallet(watch, esplora);
    assert.equal(rescanned.nextReceiveIndex, 4);
    assert.deepEqual(coinIds(rescanned), coinIds(fresh));
  }
  // A confirmed transaction on the fifth and last look-ahead address.
  {
    const { esplora, known, state } = await scanned();
    known[r(7)] = { txCount: 1, utxos: [{ txid: 'ee'.repeat(32), vout: 2, value: 5_000, height: 130 }] };
    const { state: fresh, rescan } = await refreshWallet(watch, esplora, state);
    assert.equal(rescan, true);
    assert.equal(fresh.confirmed, 130_000n);
  }
  // One address further is outside the window: a light refresh does not see it.
  {
    const { esplora, known, state } = await scanned();
    known[r(8)] = { txCount: 1, utxos: [{ txid: 'ee'.repeat(32), vout: 2, value: 5_000, height: 130 }] };
    const { state: fresh, rescan } = await refreshWallet(watch, esplora, state);
    assert.equal(rescan, false);
    assert.deepEqual(coinIds(fresh), ['aa:0', 'bb:1', 'cc:1']);
  }
  // The change chain is watched the same way.
  {
    const { esplora, known, state } = await scanned();
    known[c(1)] = { mempoolTxCount: 1, utxos: [{ txid: 'ee'.repeat(32), vout: 1, value: 9_000 }] };
    const { state: fresh, rescan } = await refreshWallet(watch, esplora, state);
    assert.equal(rescan, true);
    assert.deepEqual(coinIds(fresh), ['aa:0', 'bb:1', 'cc:1', 'ee:1']);
  }
  // Paid and already spent again: a transaction count, but no coin.
  {
    const { esplora, known, state } = await scanned();
    known[r(4)] = { txCount: 2, utxos: [] };
    const { state: fresh, rescan } = await refreshWallet(watch, esplora, state);
    assert.equal(rescan, true);
    assert.deepEqual(coinIds(fresh), ['aa:0', 'bb:1', 'cc:1']);
  }
});

test('a payment to an address that was skipped over is seen, and asks for a rescan', async () => {
  // Receive showed address 0, the reader asked for another, and the faucet paid address 1.
  const { esplora, calls, known } = fakeEsplora({
    [r(1)]: { txCount: 1, utxos: [{ txid: 'aa'.repeat(32), vout: 0, value: 100_000, height: 120 }] },
  });
  const state = await scanWallet(watch, esplora);
  assert.equal(state.nextReceiveIndex, 2);
  assert.deepEqual(state.receive.filter((a) => a.used).map((a) => a.index), [1]);

  // Nothing new: one look at the skipped address, and that is all it costs.
  calls.length = 0;
  const quiet = await refreshWallet(watch, esplora, state);
  assert.equal(quiet.rescan, false);
  assert.deepEqual(quiet.state, state);
  assert.equal(calls.filter((call) => call === `GET /address/${r(0)}`).length, 1);
  assert.ok(!calls.includes(`GET /address/${r(0)}/utxo`));

  // Later somebody pays the address that was shown first. "The old one still works."
  known[r(0)] = { mempoolTxCount: 1, utxos: [{ txid: 'bb'.repeat(32), vout: 0, value: 50_000 }] };
  const before = copyOf(state);
  const { state: fresh, rescan } = await refreshWallet(watch, esplora, state);
  assert.equal(rescan, true);
  assert.deepEqual(coinIds(fresh), ['aa:0', 'bb:0']);
  const coin = fresh.coins.find((x) => x.txid === 'bb'.repeat(32))!;
  assert.deepEqual([coin.chain, coin.index, coin.address, coin.value, coin.status], [0, 0, r(0), 50_000n, { confirmed: false }]);
  assert.deepEqual([fresh.confirmed, fresh.unconfirmed], [100_000n, 50_000n]);
  // The address book waits for the full scan, as with any look-ahead address.
  assert.equal(fresh.receive[0]!.used, false);
  assert.equal(fresh.nextReceiveIndex, 2);
  assert.deepEqual(state, before);

  // That scan marks the address used. From then on its coins are read like any other's, with no rescan.
  const rescanned = await scanWallet(watch, esplora);
  assert.deepEqual(rescanned.receive.filter((a) => a.used).map((a) => a.index), [0, 1]);
  assert.equal(rescanned.nextReceiveIndex, 2);
  assert.deepEqual(coinIds(rescanned), coinIds(fresh));
  calls.length = 0;
  const settled = await refreshWallet(watch, esplora, rescanned);
  assert.equal(settled.rescan, false);
  assert.deepEqual(coinIds(settled.state), ['aa:0', 'bb:0']);
  assert.ok(calls.includes(`GET /address/${r(0)}/utxo`) && !calls.includes(`GET /address/${r(0)}`));

  // Paid and spent again before any refresh: a transaction count, no coin, and still a rescan.
  {
    const { esplora: other, known: chain, state: wallet } = await scanned();
    chain[r(1)] = { txCount: 2, utxos: [] };
    const { state: after, rescan: again } = await refreshWallet(watch, other, wallet);
    assert.equal(again, true);
    assert.deepEqual(coinIds(after), ['aa:0', 'bb:1', 'cc:1']);
  }
  // The change chain is watched the same way: change 0 skipped, change 1 in use.
  {
    const { esplora: other, known: chain } = fakeEsplora({
      [r(0)]: { txCount: 1, utxos: [{ txid: 'aa'.repeat(32), vout: 0, value: 100_000, height: 120 }] },
      [c(1)]: { txCount: 1, utxos: [{ txid: 'cc'.repeat(32), vout: 1, value: 40_000, height: 121 }] },
    });
    const wallet = await scanWallet(watch, other);
    assert.equal(wallet.nextChangeIndex, 2);
    chain[c(0)] = { mempoolTxCount: 1, utxos: [{ txid: 'dd'.repeat(32), vout: 0, value: 9_000 }] };
    const { state: after, rescan: again } = await refreshWallet(watch, other, wallet);
    assert.equal(again, true);
    assert.deepEqual(coinIds(after), ['aa:0', 'cc:1', 'dd:0']);
    assert.deepEqual([after.coins.at(-1)!.chain, after.coins.at(-1)!.index], [1, 0]);
  }
});

test('the look-ahead can be made shorter or longer', async () => {
  const { esplora, calls, known, state } = await scanned();
  known[r(5)] = { txCount: 1, utxos: [{ txid: 'ee'.repeat(32), vout: 0, value: 5_000, height: 130 }] };

  const two = await refreshWallet(watch, esplora, state, { lookahead: 2 });
  assert.equal(two.rescan, false, 'receive 5 is the third unused address');
  assert.deepEqual(
    calls.filter((call) => !call.endsWith('/utxo')).sort(),
    // Receive 1 was skipped over: it is looked at whatever the look-ahead.
    [`GET /address/${r(1)}`, `GET /address/${r(3)}`, `GET /address/${r(4)}`, `GET /address/${c(1)}`, `GET /address/${c(2)}`].sort(),
  );

  calls.length = 0;
  const none = await refreshWallet(watch, esplora, state, { lookahead: 0 });
  assert.equal(none.rescan, false);
  assert.deepEqual(
    [...calls].sort(),
    [`GET /address/${r(0)}/utxo`, `GET /address/${r(2)}/utxo`, `GET /address/${c(0)}/utxo`, `GET /address/${r(1)}`].sort(),
    'only the three used addresses and the skipped one',
  );

  const eight = await refreshWallet(watch, esplora, state, { lookahead: 8 });
  assert.equal(eight.rescan, true);
  assert.equal(eight.state.confirmed, 130_000n);
});

test('a state whose address list has fallen behind is still read in full, and asks for a rescan', async () => {
  // A state made by hand: two coins, no address list, "next" markers past both.
  const { esplora, calls } = await scanned();
  const bare: WalletState = { ...stateOf([coinAt(account, 0, 0, 1n), coinAt(account, 1, 0, 1n)]), nextReceiveIndex: 3, nextChangeIndex: 1 };
  const { state: fresh, rescan } = await refreshWallet(watch, esplora, bare);
  assert.equal(rescan, true);
  assert.deepEqual(coinIds(fresh), ['aa:0', 'bb:1', 'cc:1']);
  assert.ok(calls.includes(`GET /address/${r(1)}/utxo`), 'every address below the marker is read');

  // After twenty payments in a row with no full scan in between, the change
  // marker passes the end of the scanned list (21 addresses here).
  const { esplora: again, calls: asked, state } = await scanned();
  assert.equal(state.change.length, 21);
  assert.equal((await refreshWallet(watch, again, { ...state, nextChangeIndex: 21 })).rescan, false);
  asked.length = 0;
  assert.equal((await refreshWallet(watch, again, { ...state, nextChangeIndex: 22 })).rescan, true);
  assert.ok(asked.includes(`GET /address/${c(21)}/utxo`), 'the address past the end of the list is still read');
});

test('a refresh that fails rejects and leaves the previous state alone', async () => {
  const { state } = await scanned();
  const before = copyOf(state);
  // A server that answers nothing but errors.
  const down = new Esplora('https://example.test/api', async () => new Response('busy', { status: 503 }));
  await assert.rejects(refreshWallet(watch, down, state), (e: unknown) => e instanceof EsploraError && e.status === 503);
  assert.deepEqual(state, before);
});

test('ownAddresses: every scanned address by chain, and the address of any coin', async () => {
  const { state } = await scanned();
  const own = ownAddresses(state);
  assert.equal(own.receive.size, 23); // 0 to 2, then 20 unused
  assert.equal(own.change.size, 21);
  assert.ok(own.receive.has(r(0)) && own.receive.has(r(1)) && own.receive.has(r(22)));
  assert.ok(!own.receive.has(r(23)) && !own.receive.has(c(0)));
  assert.ok(own.change.has(c(0)) && own.change.has(c(20)) && !own.change.has(c(21)));

  // A state made by hand has no address list, but its coins still say whose they are.
  const bare = ownAddresses(stateOf([coinAt(account, 0, 30, 5_000n), coinAt(account, 1, 40, 5_000n)]));
  assert.deepEqual([...bare.receive], [r(30)]);
  assert.deepEqual([...bare.change], [c(40)]);
});

test('spendableCoins: confirmed coins and unconfirmed change', () => {
  const confirmed = coinAt(account, 0, 0, 10_000n);
  const confirmedChange = coinAt(account, 1, 0, 20_000n);
  const unconfirmedChange = coinAt(account, 1, 1, 30_000n, { confirmed: false });
  const unconfirmedPayment = coinAt(account, 0, 1, 40_000n, { confirmed: false });
  const state = stateOf([confirmed, unconfirmedPayment, confirmedChange, unconfirmedChange]);
  assert.deepEqual(spendableCoins(state), [confirmed, confirmedChange, unconfirmedChange]);
  assert.deepEqual(state.coins.map(isSpendable), [true, false, true, true]);
  assert.deepEqual(spendableCoins(stateOf([])), []);
  assert.deepEqual(coinTotals(state.coins), { confirmed: 30_000n, unconfirmed: 70_000n });
});

test('inBatches asks a few at a time and keeps the answers in order', async () => {
  let running = 0;
  let most = 0;
  const answers = await inBatches(Array.from({ length: 25 }, (_, i) => i), 10, async (n) => {
    running++;
    most = Math.max(most, running);
    await new Promise((done) => setTimeout(done, 1));
    running--;
    return n * 2;
  });
  assert.equal(most, 10);
  assert.deepEqual(answers, Array.from({ length: 25 }, (_, i) => i * 2));
  assert.deepEqual(await inBatches([], 10, async (n: number) => n), []);
});
