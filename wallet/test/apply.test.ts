import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hex } from '@scure/base';
import { Transaction } from '@scure/btc-signer';
import {
  accountFromMnemonic,
  applyPayment,
  coinTotals,
  deriveAddress,
  planPayment,
  refreshWallet,
  scanWallet,
  signPayment,
  spendableCoins,
  watchOnlyAccount,
  type Coin,
  type SignedPayment,
  type WalletState,
} from '../src/index.ts';
import { V, coinAt, copyOf, fakeEsplora, stateOf } from './helpers.ts';

const account = accountFromMnemonic(V.abandon.mnemonic).key;
const watch = watchOnlyAccount(V.abandon.xpub);
const recipient = V.prf.wallet.receive[0] as string;
const r = (index: number) => deriveAddress(watch, 0, index).address;
const c = (index: number) => deriveAddress(watch, 1, index).address;

/** The chain as a wallet with three coins sees it: 100,000 and 25,000 sats confirmed at receive 0 and 2, 40,000 of unconfirmed change at change 0. */
function chain() {
  return fakeEsplora({
    [r(0)]: { txCount: 1, utxos: [{ txid: 'aa'.repeat(32), vout: 0, value: 100_000, height: 120 }] },
    [r(2)]: { txCount: 2, utxos: [{ txid: 'bb'.repeat(32), vout: 1, value: 25_000, height: 121 }] },
    [c(0)]: { mempoolTxCount: 1, utxos: [{ txid: 'cc'.repeat(32), vout: 1, value: 40_000 }] },
  });
}

/** That wallet, scanned. */
async function wallet(): Promise<WalletState> {
  return scanWallet(watch, chain().esplora);
}

const ids = (coins: Coin[]) => coins.map((coin) => `${coin.txid.slice(0, 2)}:${coin.vout}`).sort();

/** Each new coin must be the output the signed transaction really has at that position. */
function assertRealOutputs(payment: SignedPayment, coins: Coin[]): void {
  const tx = Transaction.fromRaw(hex.decode(payment.hex));
  for (const coin of coins.filter((x) => x.txid === payment.txid)) {
    const output = tx.getOutput(coin.vout);
    assert.equal(output.amount, coin.value);
    assert.deepEqual(output.script, coin.script);
  }
}

test('after a payment: its inputs are gone, the change is a new unconfirmed coin, the change address is used', async () => {
  const state = await wallet();
  const before = copyOf(state);
  const payment = signPayment(account, state, { to: recipient, amount: 110_000n, feeRate: 2n });
  assert.deepEqual(ids(payment.inputs), ['aa:0', 'cc:1']);
  assert.equal(payment.changeIndex, 1);

  const next = applyPayment(state, payment);

  // The 25,000 sat coin was not touched; the change is new; the recipient's output is not the wallet's.
  const change = payment.outputs.find((o) => o.isChange)!;
  assert.deepEqual(change, { address: c(1), amount: 140_000n - 110_000n - 418n, isChange: true, vout: 0 });
  assert.equal(next.coins.length, 2);
  assert.deepEqual(next.coins[0], state.coins.find((coin) => coin.txid === 'bb'.repeat(32)));
  assert.deepEqual(next.coins[1], {
    txid: payment.txid,
    vout: 0,
    value: 29_582n,
    status: { confirmed: false },
    chain: 1,
    index: 1,
    address: c(1),
    script: deriveAddress(watch, 1, 1).script,
  });
  assertRealOutputs(payment, next.coins);

  // The change address is used now, and the next payment gets a fresh one.
  assert.equal(next.change[1]!.used, true);
  assert.equal(next.nextChangeIndex, 2);
  assert.deepEqual(next.change.filter((a) => a.used).map((a) => a.index), [0, 1]);
  assert.deepEqual(next.receive, state.receive);
  assert.equal(next.nextReceiveIndex, 3);

  // Totals are counted again from the coins.
  assert.deepEqual([next.confirmed, next.unconfirmed], [25_000n, 29_582n]);
  assert.deepEqual(coinTotals(next.coins), { confirmed: 25_000n, unconfirmed: 29_582n });

  // The state passed in is exactly as it was.
  assert.deepEqual(state, before);
  assert.equal(state.change[1]!.used, false);
  assert.notEqual(next, state);

  // The wallet's own change can be spent at once, to a new change address.
  assert.deepEqual(spendableCoins(next), next.coins);
  const again = signPayment(account, next, { to: recipient, amount: 20_000n, feeRate: 2n });
  assert.deepEqual(again.inputs.map((coin) => coin.txid), [payment.txid]);
  assert.equal(again.changeIndex, 2);
  assert.equal(again.outputs.find((o) => o.isChange)!.address, c(2));
});

test('a payment to one of the wallet\'s own addresses: every output that is the wallet\'s becomes a coin with its real position', async () => {
  const state = await wallet();
  const before = copyOf(state);
  const payment = signPayment(account, state, { to: r(3), amount: 30_000n, feeRate: 2n });
  assert.deepEqual(payment.outputs, [
    { address: r(3), amount: 30_000n, isChange: false, vout: 0 },
    { address: c(1), amount: 100_000n - 30_000n - 282n, isChange: true, vout: 1 },
  ]);

  const next = applyPayment(state, payment);
  assert.deepEqual(ids(next.coins), ['bb:1', 'cc:1', `${payment.txid.slice(0, 2)}:0`, `${payment.txid.slice(0, 2)}:1`].sort());
  const [paid, change] = next.coins.filter((coin) => coin.txid === payment.txid);
  assert.deepEqual([paid!.vout, paid!.value, paid!.chain, paid!.index, paid!.address], [0, 30_000n, 0, 3, r(3)]);
  assert.deepEqual([change!.vout, change!.value, change!.chain, change!.index, change!.address], [1, 69_718n, 1, 1, c(1)]);
  assert.deepEqual([paid!.status, change!.status], [{ confirmed: false }, { confirmed: false }]);
  assertRealOutputs(payment, next.coins);

  // Both addresses count as used, so neither is handed out again.
  assert.equal(next.receive[3]!.used, true);
  assert.equal(next.nextReceiveIndex, 4);
  assert.equal(next.change[1]!.used, true);
  assert.equal(next.nextChangeIndex, 2);
  assert.deepEqual([next.confirmed, next.unconfirmed], [25_000n, 40_000n + 30_000n + 69_718n]);

  // The change may be spent at once. The coin on the receive chain waits for a block, like any payment received.
  assert.deepEqual(ids(spendableCoins(next)), ['bb:1', 'cc:1', `${payment.txid.slice(0, 2)}:1`].sort());
  assert.deepEqual(state, before);
});

test('after "send all" nothing spendable is left and no address is used up', async () => {
  const state = await wallet();
  const before = copyOf(state);
  const payment = signPayment(account, state, { to: recipient, amount: 'all', feeRate: 2n });
  assert.equal(payment.inputs.length, 3);
  assert.equal(payment.changeIndex, null);

  const next = applyPayment(state, payment);
  assert.deepEqual(next.coins, []);
  assert.deepEqual([next.confirmed, next.unconfirmed], [0n, 0n]);
  assert.deepEqual(next.receive, state.receive);
  assert.deepEqual(next.change, state.change);
  assert.deepEqual([next.nextReceiveIndex, next.nextChangeIndex], [3, 1]);
  assert.equal(planPayment(watch, next, { to: recipient, amount: 'all', feeRate: 2n }).ok, false);
  assert.deepEqual(state, before);
});

test('applyPayment works on a state with no address list, and applying a payment twice adds nothing', () => {
  const state = stateOf([coinAt(account, 0, 0, 50_000n), coinAt(account, 0, 1, 7_000n, { confirmed: false })], 4);
  const before = copyOf(state);
  const payment = signPayment(account, state, { to: recipient, amount: 20_000n, feeRate: 1n });
  const next = applyPayment(state, payment);

  assert.equal(next.coins.length, 2);
  assert.equal(next.coins[0], state.coins[1], 'the coin that was not spent is the same coin');
  const change = next.coins[1]!;
  assert.deepEqual(
    { txid: change.txid, value: change.value, chain: change.chain, index: change.index, address: change.address, status: change.status },
    { txid: payment.txid, value: 50_000n - 20_000n - 141n, chain: 1, index: 4, address: c(4), status: { confirmed: false } },
  );
  assert.deepEqual(change.script, deriveAddress(watch, 1, 4).script);
  assertRealOutputs(payment, next.coins);
  assert.equal(next.nextChangeIndex, 5);
  assert.deepEqual([next.confirmed, next.unconfirmed], [0n, 7_000n + 29_859n]);

  assert.deepEqual(applyPayment(next, payment), next);
  assert.deepEqual(state, before);
});

test('a payment to the wallet\'s own next change address: both outputs become coins, with or without an address list', async () => {
  // The recipient and the change are the same address here, so the payment has two outputs to change address 0.
  const expected = [
    { address: c(0), amount: 20_000n, isChange: false, vout: 0 },
    { address: c(0), amount: 100_000n - 20_000n - 282n, isChange: true, vout: 1 },
  ];
  const coin = coinAt(account, 0, 0, 100_000n, { txid: 'aa'.repeat(32) });
  // A state made by hand has no address list, so nothing in it says that change address 0 is the wallet's ...
  const bare = stateOf([coin]);
  // ... and a scanned one lists it, unused.
  const scanned = await scanWallet(watch, fakeEsplora({ [r(0)]: { txCount: 1, utxos: [{ txid: 'aa'.repeat(32), vout: 0, value: 100_000, height: 101 }] } }).esplora);
  assert.deepEqual([bare.change.length, scanned.change.length, scanned.nextChangeIndex], [0, 20, 0]);

  for (const state of [bare, scanned]) {
    const before = copyOf(state);
    const payment = signPayment(account, state, { to: c(0), amount: 20_000n, feeRate: 2n });
    assert.deepEqual(payment.outputs, expected);
    assert.equal(payment.changeIndex, 0);

    const next = applyPayment(state, payment);
    assert.deepEqual(
      next.coins.map((x) => [x.txid, x.vout, x.value, x.chain, x.index, x.address, x.status.confirmed]),
      [
        [payment.txid, 0, 20_000n, 1, 0, c(0), false],
        [payment.txid, 1, 79_718n, 1, 0, c(0), false],
      ],
    );
    for (const x of next.coins) assert.deepEqual(x.script, deriveAddress(watch, 1, 0).script);
    assertRealOutputs(payment, next.coins);
    assert.deepEqual([next.confirmed, next.unconfirmed], [0n, 99_718n]);
    assert.equal(next.nextChangeIndex, 1);
    // Both sit on the change chain, so both can be spent at once.
    assert.deepEqual(spendableCoins(next), next.coins);

    // Applying the same payment again changes nothing.
    assert.deepEqual(applyPayment(next, payment), next);
    assert.deepEqual(state, before);
  }
});

test('applyPayment gives the state the network reports a moment later: a light refresh changes nothing', async () => {
  const { esplora, known } = chain();
  const state = await scanWallet(watch, esplora);
  const payment = signPayment(account, state, { to: recipient, amount: 110_000n, feeRate: 2n });
  const applied = applyPayment(state, payment);

  // The network after the broadcast: the two coins are spent, the change sits unconfirmed at change address 1.
  known[r(0)]!.utxos = [];
  known[r(0)]!.mempoolTxCount = 1;
  known[c(0)]!.utxos = [];
  known[c(0)]!.mempoolTxCount = 2;
  known[c(1)] = { mempoolTxCount: 1, utxos: [{ txid: payment.txid, vout: 0, value: 29_582 }] };

  // Refreshed from the applied state: the same coins and totals, and no rescan is asked for.
  const fromApplied = await refreshWallet(watch, esplora, applied);
  assert.equal(fromApplied.rescan, false);
  assert.deepEqual(ids(fromApplied.state.coins), ids(applied.coins));
  assert.deepEqual(fromApplied.state.coins.find((coin) => coin.txid === payment.txid), applied.coins.find((coin) => coin.txid === payment.txid));
  assert.deepEqual([fromApplied.state.confirmed, fromApplied.state.unconfirmed], [applied.confirmed, applied.unconfirmed]);

  // Refreshed from the state before the payment, the change shows up as news on an unused address: rescan.
  const fromOld = await refreshWallet(watch, esplora, state);
  assert.equal(fromOld.rescan, true);
  assert.deepEqual(ids(fromOld.state.coins), ids(applied.coins));

  // And the full scan agrees with applyPayment about what is used and what comes next.
  const scanned = await scanWallet(watch, esplora);
  assert.deepEqual(ids(scanned.coins), ids(applied.coins));
  assert.deepEqual([scanned.nextReceiveIndex, scanned.nextChangeIndex], [applied.nextReceiveIndex, applied.nextChangeIndex]);
  assert.deepEqual(scanned.change.filter((a) => a.used).map((a) => a.index), applied.change.filter((a) => a.used).map((a) => a.index));
});
