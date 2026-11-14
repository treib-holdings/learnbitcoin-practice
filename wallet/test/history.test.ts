import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountFromMnemonic,
  applyPayment,
  deriveAddress,
  ownAddresses,
  scanWallet,
  signPayment,
  viewPayment,
  viewTx,
  walletHistory,
  watchOnlyAccount,
  type EsploraTx,
  type TxView,
} from '../src/index.ts';
import { V, coinAt, fakeEsplora, stateOf } from './helpers.ts';

const account = accountFromMnemonic(V.abandon.mnemonic).key;
const watch = watchOnlyAccount(V.abandon.xpub);
const r = (index: number) => deriveAddress(watch, 0, index).address;
const c = (index: number) => deriveAddress(watch, 1, index).address;
const sets = (receive: string[], change: string[] = []) => ({ receive: new Set(receive), change: new Set(change) });

// Two transactions as the practice network's Esplora really reported them
// (recorded in e2e/fixtures/origin-samples.json; only the fields the wallet
// reads are kept). FAUCET pays a new wallet 100,000 sats. SPEND is that
// wallet paying 330 sats to a taproot address, 20,000 and 294 sats to two of
// its own receive addresses, with the rest as change.
const LEARNER = {
  receive0: 'bcrt1q2wadxlegdsclflzslfa4xtppanqr8me0dq2sl8',
  receive1: 'bcrt1q3hlyrqsdtw7rmd72wc4g47rs2c8u85sxqppdqt',
  receive4: 'bcrt1q2cjwsygcf0sjhecz7070dxuc6kddye8kfs8dph',
  change0: 'bcrt1qyt85vd6w8zkm9thmr3sauz5fv5xfrkrv2y7w8h',
};
const FAUCET_WALLET = { coin: 'bcrt1q9d02jq9k2n3z6shtrtlfc2qqlllpfghff9r0w3', change: 'bcrt1qpawpljn8m85mc8dxx6ckgtd24hv8vs36nqqepv' };
const TAPROOT = 'bcrt1p99ccp7w0edt9ccvrhjtrshy3ugwkw0azfcrpeyux2vq336zrpz5qvm2nyd';

const FAUCET: EsploraTx = {
  txid: '2bfbd6c40dbd2ed74b3b180fb96a83a0c0c97cfc4b5d4fe788b99347127a2287',
  version: 2,
  locktime: 6326,
  vin: [
    {
      txid: '9b21f54c3dcdb1fd6f64278c318143b2b5e7c79bdaec80c8656796c2d4e4db90',
      vout: 1,
      prevout: { scriptpubkey: '00142b5ea900b654e22d42eb1afe9c2800fffe14a2e9', scriptpubkey_address: FAUCET_WALLET.coin, value: 49_548_322 },
      is_coinbase: false,
      sequence: 4294967293,
    },
  ],
  vout: [
    { scriptpubkey: '00140f5c1fca67d9e9bc1da636b1642daaadd876423a', scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: FAUCET_WALLET.change, value: 49_448_040 },
    { scriptpubkey: '001453bad37f286c31f4fc50fa7b532c21ecc033ef2f', scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: LEARNER.receive0, value: 100_000 },
  ],
  size: 222,
  weight: 561,
  fee: 282,
  status: { confirmed: true, block_height: 6327, block_hash: '0b36ba8a31bc7034c09b09c1c5137c76bebcbce0404946e7425564dbd1dd75fd', block_time: 1794636256 },
};

const SPEND: EsploraTx = {
  txid: '17fc56db8a195c692262c95f7df5c28cdf1aefc7581c459da0cf81ea906beb91',
  version: 2,
  locktime: 0,
  vin: [
    {
      txid: FAUCET.txid,
      vout: 1,
      prevout: { scriptpubkey: '001453bad37f286c31f4fc50fa7b532c21ecc033ef2f', scriptpubkey_address: LEARNER.receive0, value: 100_000 },
      is_coinbase: false,
      sequence: 4294967293,
    },
  ],
  vout: [
    { scriptpubkey: '00148dfe41820d5bbc3db7ca762a8af870560fc3d206', scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: LEARNER.receive1, value: 20_000 },
    { scriptpubkey: '001422cf46374e38adb2aefb1c61de0a89650c91d86c', scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: LEARNER.change0, value: 78_876 },
    { scriptpubkey: '00145624e811184be12be702f3fcf69b98d59ad264f6', scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: LEARNER.receive4, value: 294 },
    { scriptpubkey: '5120297180f9cfcb565c6183bc96385c91e21d673fa24e061c9386530118e84308a8', scriptpubkey_type: 'v1_p2tr', scriptpubkey_address: TAPROOT, value: 330 },
  ],
  size: 296,
  weight: 857,
  fee: 500,
  status: { confirmed: true, block_height: 6328, block_hash: '70a08b90b77f54e411b5f124cceb86b7e04ffadc671f49cd223d84b98de851a8', block_time: 1794636286 },
};

const learner = sets([LEARNER.receive0, LEARNER.receive1, LEARNER.receive4], [LEARNER.change0]);

test('viewTx: a payment received', () => {
  assert.deepEqual(viewTx(FAUCET, learner), {
    txid: FAUCET.txid,
    confirmed: true,
    height: 6327,
    time: 1794636256,
    inputs: [{ address: FAUCET_WALLET.coin, value: 49_548_322n, mine: false, change: false }],
    outputs: [
      { address: FAUCET_WALLET.change, value: 49_448_040n, mine: false, change: false },
      { address: LEARNER.receive0, value: 100_000n, mine: true, change: false },
    ],
    fee: 282n,
    vsize: 141,
    feeRate: 2,
    net: 100_000n,
    direction: 'received',
    rbf: true,
  } satisfies TxView);
});

test('viewTx: the same transaction seen from the wallet that sent it, and from a bystander', () => {
  const faucet = viewTx(FAUCET, sets([FAUCET_WALLET.coin], [FAUCET_WALLET.change]));
  assert.equal(faucet.direction, 'sent');
  assert.equal(faucet.net, -100_282n, 'the amount and the fee');
  assert.deepEqual(faucet.inputs, [{ address: FAUCET_WALLET.coin, value: 49_548_322n, mine: true, change: false }]);
  assert.deepEqual(faucet.outputs[0], { address: FAUCET_WALLET.change, value: 49_448_040n, mine: true, change: true });

  const bystander = viewTx(FAUCET, sets([r(0)], [c(0)]));
  assert.equal(bystander.direction, 'other');
  assert.equal(bystander.net, 0n);
  assert.ok([...bystander.inputs, ...bystander.outputs].every((part) => !part.mine && !part.change));
});

test('viewTx: a payment sent, with change and two outputs back to the wallet itself', () => {
  const view = viewTx(SPEND, learner);
  assert.deepEqual(view.inputs, [{ address: LEARNER.receive0, value: 100_000n, mine: true, change: false }]);
  assert.deepEqual(view.outputs, [
    { address: LEARNER.receive1, value: 20_000n, mine: true, change: false },
    { address: LEARNER.change0, value: 78_876n, mine: true, change: true },
    { address: LEARNER.receive4, value: 294n, mine: true, change: false },
    { address: TAPROOT, value: 330n, mine: false, change: false },
  ]);
  assert.equal(view.direction, 'sent');
  assert.equal(view.net, -830n, '330 sats to somebody else and 500 sats of fee left the wallet');
  assert.deepEqual([view.fee, view.vsize, view.feeRate], [500n, 215, 500 / 215]);
  assert.deepEqual([view.confirmed, view.height, view.time, view.rbf], [true, 6328, 1794636286, true]);
});

test('viewTx: internal when every input and output is the wallet\'s', () => {
  const view = viewTx(SPEND, sets([LEARNER.receive0, LEARNER.receive1, LEARNER.receive4, TAPROOT], [LEARNER.change0]));
  assert.equal(view.direction, 'internal');
  assert.equal(view.net, -500n, 'only the fee is lost');
  // One output to somebody else is enough to make it a payment sent.
  assert.equal(viewTx(SPEND, learner).direction, 'sent');
});

test('viewTx: a coinbase input, an output without an address, and no replace-by-fee signal', () => {
  const coinbase: EsploraTx = {
    txid: 'c0'.repeat(32),
    version: 2,
    locktime: 0,
    vin: [{ txid: '00'.repeat(32), vout: 4294967295, prevout: null, is_coinbase: true, sequence: 4294967295 }],
    vout: [
      { scriptpubkey: '0014d0c4a3ef09e997b6e99e397e518fe3e41a118ca1', scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: r(0), value: 5_000_000_000 },
      { scriptpubkey: '6a24aa21a9ed' + '00'.repeat(32), scriptpubkey_type: 'op_return', value: 0 },
    ],
    size: 168,
    weight: 564,
    fee: 0,
    status: { confirmed: true, block_height: 1, block_time: 1794000000 },
  };
  const view = viewTx(coinbase, sets([r(0)]));
  assert.deepEqual(view.inputs, [{ address: null, value: 0n, mine: false, change: false }]);
  assert.deepEqual(view.outputs, [
    { address: r(0), value: 5_000_000_000n, mine: true, change: false },
    { address: null, value: 0n, mine: false, change: false },
  ]);
  assert.deepEqual([view.direction, view.net, view.fee, view.feeRate, view.rbf], ['received', 5_000_000_000n, 0n, 0, false]);

  // 0xfffffffe does not signal replace-by-fee; 0xfffffffd and anything lower does (BIP125).
  const final = { ...FAUCET, vin: [{ ...FAUCET.vin[0]!, sequence: 0xfffffffe }] };
  assert.equal(viewTx(final, learner).rbf, false);
  assert.equal(viewTx({ ...FAUCET, vin: [{ ...FAUCET.vin[0]!, sequence: 0 }] }, learner).rbf, true);
  // Unconfirmed: no height and no time yet.
  const pending = viewTx({ ...FAUCET, status: { confirmed: false } }, learner);
  assert.deepEqual([pending.confirmed, pending.height, pending.time], [false, null, null]);
});

test('viewPayment and viewTx give the same view of the same transaction', async () => {
  // The frozen payment: the "abandon" wallet pays 60,000 sats from two coins.
  const frozen = V.payment;
  const { esplora } = fakeEsplora({
    [r(0)]: { txCount: 1, utxos: [{ txid: 'aa'.repeat(32), vout: 0, value: 50_000, height: 101 }] },
    [r(1)]: { txCount: 1, utxos: [{ txid: 'bb'.repeat(32), vout: 0, value: 30_000, height: 101 }] },
  });
  const state = await scanWallet(watch, esplora);
  const own = ownAddresses(state);
  const payment = signPayment(account, state, { to: frozen.to, amount: 60_000n, feeRate: 2n });
  assert.equal(payment.txid, frozen.txid);

  // The same transaction as Esplora would report it once it is in the mempool,
  // written out by hand. Size, weight and the output scripts come from reading
  // the raw bytes with an independent parser, not from this package.
  const reported: EsploraTx = {
    txid: '626bffa3d9c2ac1b47fc0c9b23cba6e55d2102daf813b2b9fb222b3004b3c341',
    version: 2,
    locktime: 0,
    vin: [
      {
        txid: 'aa'.repeat(32),
        vout: 0,
        prevout: { scriptpubkey: '0014d0c4a3ef09e997b6e99e397e518fe3e41a118ca1', scriptpubkey_address: 'bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk', value: 50_000 },
        is_coinbase: false,
        sequence: 4294967293,
      },
      {
        txid: 'bb'.repeat(32),
        vout: 0,
        prevout: { scriptpubkey: '00146fa016500a3c6a737ebb260e2ddca78ba9234558', scriptpubkey_address: 'bcrt1qd7spv5q28348xl4myc8zmh983w5jx32cs707jh', value: 30_000 },
        is_coinbase: false,
        sequence: 4294967293,
      },
    ],
    vout: [
      { scriptpubkey: '00142f34aa1cf00a53b055a291a03a7d45f0a6988b52', scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: 'bcrt1q9u62588spffmq4dzjxsr5l297znf3z6jkgnhsw', value: 19_582 },
      { scriptpubkey: '00140f9778b58bb18ac1d9781ce99181ed44848c55d2', scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6', value: 60_000 },
    ],
    size: 370,
    weight: 832,
    fee: 418,
    status: { confirmed: false },
  };

  const expected: TxView = {
    txid: frozen.txid,
    confirmed: false,
    height: null,
    time: null,
    inputs: [
      { address: r(0), value: 50_000n, mine: true, change: false },
      { address: r(1), value: 30_000n, mine: true, change: false },
    ],
    outputs: [
      { address: c(0), value: 19_582n, mine: true, change: true },
      { address: frozen.to, value: 60_000n, mine: false, change: false },
    ],
    fee: 418n,
    vsize: 208,
    feeRate: 418 / 208,
    net: -60_418n,
    direction: 'sent',
    rbf: true,
  };
  assert.deepEqual(viewPayment(payment, own), expected);
  assert.deepEqual(viewTx(reported, own), expected);
  assert.deepEqual(viewPayment(payment, own), viewTx(reported, own));

  // After the payment is applied the views do not change: the change address was already the wallet's.
  const after = ownAddresses(applyPayment(state, payment));
  assert.deepEqual(viewTx(reported, after), expected);
});

test('viewPayment: send all, a payment to itself, and a state with no address list', async () => {
  const { esplora } = fakeEsplora({
    [r(0)]: { txCount: 1, utxos: [{ txid: 'aa'.repeat(32), vout: 0, value: 50_000, height: 101 }] },
    [c(0)]: { txCount: 1, utxos: [{ txid: 'bb'.repeat(32), vout: 0, value: 30_000, height: 101 }] },
  });
  const state = await scanWallet(watch, esplora);
  const own = ownAddresses(state);

  const all = viewPayment(signPayment(account, state, { to: V.prf.wallet.receive[0], amount: 'all', feeRate: 1n }), own);
  assert.deepEqual(all.inputs, [
    { address: r(0), value: 50_000n, mine: true, change: false },
    { address: c(0), value: 30_000n, mine: true, change: true },
  ]);
  assert.deepEqual(all.outputs, [{ address: V.prf.wallet.receive[0], value: 80_000n - 177n, mine: false, change: false }]);
  assert.deepEqual([all.direction, all.net, all.fee, all.vsize, all.feeRate], ['sent', -80_000n, 177n, 177, 1]);

  const toItself = viewPayment(signPayment(account, state, { to: r(5), amount: 10_000n, feeRate: 1n }), own);
  assert.equal(toItself.direction, 'internal');
  assert.equal(toItself.net, -toItself.fee);
  assert.ok(toItself.outputs.every((part) => part.mine));
  assert.deepEqual(toItself.outputs.map((part) => part.change), [false, true]);

  // With no address list to go by, the payment's own coins and change are still known to be the wallet's.
  const bare = stateOf([coinAt(account, 0, 0, 50_000n)], 7);
  const view = viewPayment(signPayment(account, bare, { to: V.prf.wallet.receive[0], amount: 10_000n, feeRate: 1n }), ownAddresses(bare));
  assert.deepEqual(view.inputs, [{ address: r(0), value: 50_000n, mine: true, change: false }]);
  assert.deepEqual(view.outputs, [
    { address: V.prf.wallet.receive[0], value: 10_000n, mine: false, change: false },
    { address: c(7), value: 50_000n - 10_000n - 141n, mine: true, change: true },
  ]);
  assert.deepEqual([view.direction, view.net], ['sent', -10_141n]);
});

/** A transaction for the stand-in server: who paid in, who is paid, and where it sits. */
function tx(id: string, height: number | undefined, inputs: [string, number, string, number][], outputs: [string, number][]): EsploraTx {
  const paidIn = inputs.reduce((sum, input) => sum + input[3], 0);
  const paidOut = outputs.reduce((sum, output) => sum + output[1], 0);
  return {
    txid: id.repeat(32),
    version: 2,
    locktime: 0,
    vin: inputs.map(([txid, vout, address, value]) => ({
      txid: txid.repeat(32),
      vout,
      prevout: { scriptpubkey: '0014' + '00'.repeat(20), scriptpubkey_address: address, value },
      is_coinbase: false,
      sequence: 4294967293,
    })),
    vout: outputs.map(([address, value]) => ({ scriptpubkey: '0014' + '00'.repeat(20), scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: address, value })),
    size: 222,
    weight: 561,
    fee: paidIn - paidOut,
    status: height === undefined ? { confirmed: false } : { confirmed: true, block_height: height, block_time: 1794000000 + height * 30 },
  };
}

test('walletHistory: one entry per transaction, unconfirmed first, then newest block first', async () => {
  const elsewhere = V.prf.wallet.receive[0] as string;
  // Oldest to newest:
  const a = tx('0a', 100, [['f0', 0, elsewhere, 200_000]], [[r(0), 100_000], [elsewhere, 99_000]]); // the wallet is paid at receive 0
  const b = tx('0b', 101, [['f1', 0, elsewhere, 90_000]], [[r(0), 30_000], [r(2), 50_000], [elsewhere, 9_000]]); // paid at two of its addresses at once
  const d = tx('0d', 101, [['0b', 1, r(2), 50_000]], [[elsewhere, 20_000], [c(0), 29_000]]); // spends b's coin in the same block
  const e = tx('0e', undefined, [['0a', 0, r(0), 100_000]], [[elsewhere, 60_000], [c(1), 39_000]]); // unconfirmed
  const f = tx('0f', undefined, [['0e', 1, c(1), 39_000]], [[elsewhere, 38_000]]); // unconfirmed, spends e's change

  // Each address lists the transactions that touch it, as Esplora does.
  const chain = fakeEsplora({
    [r(0)]: { txCount: 2, mempoolTxCount: 1, txs: [e, b, a], utxos: [{ txid: b.txid, vout: 0, value: 30_000, height: 101 }] },
    [r(2)]: { txCount: 2, txs: [d, b] },
    [c(0)]: { txCount: 1, txs: [d], utxos: [{ txid: d.txid, vout: 1, value: 29_000, height: 101 }] },
    [c(1)]: { mempoolTxCount: 2, txs: [f, e] },
  });
  const state = await scanWallet(watch, chain.esplora);
  chain.calls.length = 0;

  const history = await walletHistory(state, chain.esplora);

  assert.deepEqual(
    history.map((view) => view.txid.slice(0, 2)),
    ['0f', '0e', '0d', '0b', '0a'],
    'unconfirmed first (the one that spends the other on top), then block 101 (the same way), then block 100',
  );
  assert.deepEqual([...chain.calls].sort(), [r(0), r(2), c(0), c(1)].map((address) => `GET /address/${address}/txs`).sort(), 'only addresses in use are asked');
  assert.deepEqual(history.map((view) => view.direction), ['sent', 'sent', 'sent', 'received', 'received']);
  assert.deepEqual(history.map((view) => view.net), [-39_000n, -61_000n, -21_000n, 80_000n, 100_000n]);
  assert.deepEqual(history.map((view) => view.height), [null, null, 101, 101, 100]);
  // b touches two of the wallet's addresses and is listed once, with both outputs marked.
  assert.deepEqual(history[3]!.outputs.map((part) => part.mine), [true, true, false]);
  // Each entry is exactly what viewTx gives for that transaction.
  assert.deepEqual(history[1], viewTx(e, ownAddresses(state)));

  // A block arrives between two answers: one list still says unconfirmed, the other confirmed. The confirmed copy wins.
  chain.known[c(1)]!.txs = [{ ...f, status: { confirmed: true, block_height: 102 } }, { ...e, status: { confirmed: true, block_height: 102 } }];
  const later = await walletHistory(state, chain.esplora);
  assert.deepEqual(later.map((view) => view.txid.slice(0, 2)), ['0f', '0e', '0d', '0b', '0a']);
  assert.deepEqual(later.map((view) => view.height), [102, 102, 101, 101, 100]);
  assert.deepEqual(await walletHistory(stateOf([]), chain.esplora), []);
});
