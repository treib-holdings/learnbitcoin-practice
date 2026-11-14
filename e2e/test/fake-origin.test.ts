// The stand-in origin, driven the way its users drive it: through fetch, with
// the wallet package on the other end.
//
// Wherever the real origin's answer was recorded, the stand-in's answer is
// compared with the recording itself (e2e/fixtures/origin-samples.json and
// worker/test/fixtures/broadcast-refusals.json), not with a copy typed here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';
import { bech32, bech32m } from '@scure/base';
import { Address, RawTx, Transaction, p2tr } from '@scure/btc-signer';
import {
  Esplora,
  EsploraError,
  RBF_SEQUENCE,
  REGTEST,
  accountFromMnemonic,
  addressScript,
  buildPayment,
  deriveAddress,
  privateKeyAt,
  scanWallet,
} from '@learnbitcoin/practice-wallet';
import { FAKE_BOTS_TOKEN, makeFakeOrigin, type FakeOrigin, type FakeOriginOptions } from '../src/fake-origin.ts';

// -- the recordings -----------------------------------------------------------

interface Recorded {
  what: string;
  request: string;
  status: number;
  contentType: string | null;
  body: any;
}

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const samples: Recorded[] = readJson('../fixtures/origin-samples.json').samples;
const refusals: Recorded[] = readJson('../../worker/test/fixtures/broadcast-refusals.json').refusals;

/**
 * A recording, by its name. Two of the names end in a size that can differ by
 * a byte from one recording session to the next, so the start of a name will
 * do when it is the only name that starts that way.
 */
function recorded(list: Recorded[], what: string): Recorded {
  const exact = list.filter((entry) => entry.what === what);
  const found = exact.length > 0 ? exact : list.filter((entry) => entry.what.startsWith(what));
  assert.equal(found.length, 1, `exactly one recording should be named "${what}"`);
  return found[0]!;
}

// -- a wallet, and a stand-in to point it at ------------------------------------

const account = accountFromMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about').key;
const receive = (index: number) => deriveAddress(account, 0, index);
const change = (index: number) => deriveAddress(account, 1, index);
/** An address of some other wallet (wallet/test/vectors.json, the passkey vector's first address). */
const SOMEONE = 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6';
/** A taproot address, for the second dust limit. */
const TAPROOT_OUTPUT = p2tr(receive(6).publicKey.slice(1), undefined, REGTEST);
const TAPROOT = TAPROOT_OUTPUT.address!;

const BASE = 'http://origin.test';
/** A fixed moment. These tests supply the clock, so the real one is never read. */
const START_MS = 1_800_000_000_000;
const START = START_MS / 1000;

function standIn(options: FakeOriginOptions = {}) {
  const clock = { ms: START_MS };
  const origin = makeFakeOrigin({ clock: () => clock.ms, ...options });
  return { origin, clock, esplora: new Esplora(`${BASE}/esplora`, origin.fetch) };
}

interface Got {
  status: number;
  contentType: string | null;
  body: any;
}

/** One request, written as the recordings write it ("GET /esplora/..."), and the answer in the recordings' form. */
async function ask(origin: FakeOrigin, request: string, options: { body?: string; token?: string } = {}): Promise<Got> {
  const [method = 'GET', path = '/'] = request.split(' ');
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`;
  const response = await origin.fetch(`${BASE}${path}`, { method, headers, body: options.body });
  const text = await response.text();
  const contentType = response.headers.get('content-type');
  return { status: response.status, contentType, body: contentType === 'application/json' ? JSON.parse(text) : text };
}

const faucet = (origin: FakeOrigin, address: unknown) =>
  ask(origin, 'POST /bots/faucet', { token: origin.token, body: JSON.stringify({ address }) });
const potAddress = async (origin: FakeOrigin): Promise<string> => (await ask(origin, 'GET /bots/pot/address', { token: origin.token })).body.address;
const send = (origin: FakeOrigin, hex: string) => ask(origin, 'POST /esplora/tx', { body: hex });

/** The stand-in's answer is the recorded one. `edit` first puts this run's IDs and addresses into the recording. */
function assertRecorded(got: Got, record: Recorded, edit: (body: any) => unknown = (body) => body): void {
  const expected = { status: record.status, contentType: record.contentType, body: edit(structuredClone(record.body)) };
  assert.deepEqual(got, expected, record.what);
}

/** The keys of a JSON value, in their order, with the type of each leaf. Two answers of one shape differ only in their values. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value !== null && typeof value === 'object') return Object.entries(value).map(([key, inner]) => [key, shape(inner)]);
  return value === null ? 'null' : typeof value;
}

function assertShape(got: Got, record: Recorded): void {
  assert.equal(got.status, record.status, record.what);
  assert.equal(got.contentType, record.contentType, record.what);
  assert.deepEqual(shape(got.body), shape(record.body), record.what);
}

interface Spendable {
  txid: string;
  vout: number;
  value: bigint;
  chain: 0 | 1;
  index: number;
}

/** One input (or several), any outputs, signed, and no checks at all: this is how the refused transactions are made. */
function rawTx(spend: Spendable | Spendable[], outputs: { address: string; amount: bigint }[]): { hex: string; txid: string; vsize: number } {
  const coins = Array.isArray(spend) ? spend : [spend];
  // Outputs go in by their script: the signing library has no name for some kinds of address the wallet can pay.
  const tx = new Transaction({ allowUnknownOutputs: true });
  for (const coin of coins) {
    const from = deriveAddress(account, coin.chain, coin.index);
    tx.addInput({ txid: coin.txid, index: coin.vout, witnessUtxo: { script: from.script, amount: coin.value }, sequence: RBF_SEQUENCE });
  }
  for (const output of outputs) tx.addOutput({ script: addressScript(output.address), amount: output.amount });
  coins.forEach((coin, i) => tx.signIdx(privateKeyAt(account, coin.chain, coin.index), i));
  tx.finalize();
  return { hex: tx.hex, txid: tx.id, vsize: tx.vsize };
}

/** A stand-in where receive address 0 holds one confirmed faucet coin: where the recording's wallet stood before it spent. */
async function withFaucetCoin(options: FakeOriginOptions = {}) {
  const made = standIn(options);
  const paid = await faucet(made.origin, receive(0).address);
  assert.equal(paid.status, 200);
  made.origin.mine();
  const [utxo] = await made.esplora.addressUtxos(receive(0).address);
  assert.ok(utxo);
  const coin: Spendable = { txid: utxo.txid, vout: utxo.vout, value: BigInt(utxo.value), chain: 0, index: 0 };
  return { ...made, coin, faucetTxid: paid.body.txid as string };
}

// -- the recording, replayed ----------------------------------------------------

test('replaying the recording session: every answer is the one the real origin gave', async () => {
  const { origin, esplora } = standIn();
  const seen = new Set<string>();
  const tick = (record: Recorded) => (seen.add(record.what), record);
  const sample = (what: string) => tick(recorded(samples, what));
  const refusal = (what: string) => tick(recorded(refusals, what));
  const me = receive(0).address;

  // Before the wallet has any history.
  assertRecorded(await ask(origin, 'GET /esplora/blocks/tip/height'), sample('tip height'), () => String(origin.height()));
  for (const what of [
    'an address with no history',
    'coins of an address with no history',
    'transactions of an address with no history',
    'a transaction nobody has seen',
    'not an address',
    'a mainnet address',
    'a path the app never uses',
    'pot address without the token',
  ]) {
    const record = sample(what);
    assertRecorded(await ask(origin, record.request), record);
  }

  // The bots.
  const pot = await potAddress(origin);
  assert.match(pot, /^bcrt1q[02-9ac-hj-np-z]{38}$/);
  for (const what of ['pot address', 'pot address, asked again']) {
    assertRecorded(await ask(origin, 'GET /bots/pot/address', { token: origin.token }), sample(what), () => ({ address: pot }));
  }
  assertRecorded(await faucet(origin, 'tb1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjpupg53'), sample('faucet: not a practice address'));
  assertRecorded(await faucet(origin, pot), sample("faucet: the network's own address"));
  assertRecorded(await ask(origin, 'POST /bots/faucet', { token: origin.token, body: 'x' }), sample('faucet: malformed body'));
  const paid = await faucet(origin, me);
  const faucetTxid: string = paid.body.txid;
  assert.match(faucetTxid, /^[0-9a-f]{64}$/);
  assertRecorded(paid, sample('faucet: paid'), (body) => ({ ...body, txid: faucetTxid }));
  assertRecorded(await faucet(origin, me), sample('faucet: the same address again'));

  // The faucet payment, waiting. It is the same kind of transaction as the
  // recorded one (one coin in, change and the payment out), so it has the
  // same fields and the same size, weight and fee.
  const waiting = await ask(origin, `GET /esplora/tx/${faucetTxid}`);
  const theirs = sample('a transaction in the mempool');
  assertShape(waiting, theirs);
  for (const key of ['version', 'size', 'weight', 'sigops', 'fee']) assert.equal(waiting.body[key], theirs.body[key], key);
  assert.equal(waiting.body.locktime, origin.height(), 'as Bitcoin Core sets it: the height when it was made');
  assert.equal(waiting.body.vin[0].sequence, theirs.body.vin[0].sequence);
  assert.deepEqual([waiting.body.vout[1].scriptpubkey_address, waiting.body.vout[1].value], [me, 100_000]);
  assertRecorded(await ask(origin, `GET /esplora/address/${me}`), sample('an address with an unconfirmed payment'), (body) => ({ ...body, address: me }));
  assertRecorded(await ask(origin, `GET /esplora/address/${me}/utxo`), sample('coins of an address, unconfirmed'), ([coin]) => [{ ...coin, txid: faucetTxid }]);

  // In a block.
  origin.mine();
  const confirmed = await ask(origin, `GET /esplora/tx/${faucetTxid}`);
  assertShape(confirmed, sample('a confirmed transaction'));
  assert.deepEqual(confirmed.body.status, { confirmed: true, block_height: origin.height(), block_hash: confirmed.body.status.block_hash, block_time: START + 30 });
  assert.match(confirmed.body.status.block_hash, /^[0-9a-f]{64}$/);
  assertShape(await ask(origin, `GET /esplora/address/${me}/utxo`), sample('coins of an address, confirmed'));
  assertShape(await ask(origin, `GET /esplora/address/${me}/txs`), sample('transactions of an address'));

  // What the node refused, made the way the recording made it.
  const [utxo] = await esplora.addressUtxos(me);
  assert.ok(utxo);
  const c0: Spendable = { txid: utxo.txid, vout: utxo.vout, value: BigInt(utxo.value), chain: 0, index: 0 };
  assert.equal(c0.value, 100_000n);
  const refused = async (what: string, tx: { hex: string; txid?: string }) => {
    // A refused replacement names the transaction that was refused: this run's, not the recording's.
    assertRecorded(await send(origin, tx.hex), refusal(what), (body: string) => body.replace(/(rejecting replacement )[0-9a-f]{64}/, `$1${tx.txid}`));
  };
  const withDust = (address: string, amount: bigint) =>
    rawTx(c0, [{ address, amount }, { address: change(0).address, amount: c0.value - amount - 400n }]);
  await refused('dust: a 200 sat output', withDust(receive(1).address, 200n));
  await refused('dust: a 293 sat output (one below the limit)', withDust(receive(1).address, 293n));
  await refused('dust: a 329 sat taproot output (one below its limit)', withDust(TAPROOT, 329n));
  const lowFee = rawTx(c0, [{ address: change(0).address, amount: c0.value - 5n }]);
  await refused('fee too low: 5 sats for', lowFee);
  await refused('fee too low: no fee at all', rawTx(c0, [{ address: change(0).address, amount: c0.value }]));
  await refused('not a transaction', { hex: '00' });
  await refused('half a transaction', { hex: lowFee.hex.slice(0, 80) });

  // The node relays from 0.1 sat/vB, so a payment with a fee of 50 sats gets in.
  const cheap = rawTx(c0, [{ address: change(0).address, amount: c0.value - 50n }]);
  assertRecorded(await send(origin, cheap.hex), sample('broadcast accepted at under 1 sat/vB'), () => cheap.txid);

  // A payment of the same coin, with one output at each dust limit and ten times the fee, replaces
  // the cheap one. It is accepted, and accepted again while it waits.
  const t1 = rawTx(c0, [
    { address: receive(1).address, amount: 20_000n },
    { address: change(0).address, amount: c0.value - 20_000n - 294n - 330n - 500n },
    { address: receive(4).address, amount: 294n },
    { address: TAPROOT, amount: 330n },
  ]);
  const accepted = sample('broadcast accepted: a payment with a 294 sat segwit output and a 330 sat taproot output (the dust limits), replacing the cheaper one');
  assertRecorded(await send(origin, t1.hex), accepted, () => t1.txid);
  assertRecorded(await send(origin, t1.hex), sample('broadcast: the same transaction again, still unconfirmed'), () => t1.txid);

  await refused(
    'coin already being spent: a second payment from the same coin, same fee',
    rawTx(c0, [{ address: receive(2).address, amount: 20_000n }, { address: change(0).address, amount: c0.value - 20_000n - 500n }]),
  );
  await refused(
    'coin already being spent: a second payment from the same coin, lower fee',
    rawTx(c0, [{ address: receive(2).address, amount: 20_000n }, { address: change(0).address, amount: c0.value - 20_000n - 150n }]),
  );

  // A long chain of waiting payments, each spending the change of the one before. The 65th is one too many.
  let last: Spendable = { txid: t1.txid, vout: 1, value: c0.value - 20_000n - 294n - 330n - 500n, chain: 1, index: 0 };
  for (let i = 1; i <= 64; i++) {
    const next = rawTx(last, [{ address: change(i).address, amount: last.value - 250n }]);
    if (i === 64) {
      await refused('unconfirmed chain: payment 65 in a row', next);
    } else {
      assert.equal((await send(origin, next.hex)).status, 200, `payment ${i + 1} in a row`);
      last = { txid: next.txid, vout: 0, value: last.value - 250n, chain: 1, index: i };
    }
  }

  origin.mine();
  await refused('already in a block: the same transaction sent again', t1);
  await refused('coin already spent in a block', rawTx(c0, [{ address: receive(3).address, amount: c0.value - 300n }]));

  // The address that received and spent: newest first, and the totals to the sat.
  const history = await ask(origin, `GET /esplora/address/${me}/txs`);
  const theirHistory = sample('transactions of an address that received and spent');
  assertShape(history, theirHistory);
  assert.deepEqual(history.body.map((tx: any) => tx.txid), [t1.txid, faucetTxid]);
  const kinds = (body: any) => body[0].vout.map((output: any) => [output.scriptpubkey_type, output.value]);
  assert.deepEqual(kinds(history.body), kinds(theirHistory.body));
  assert.equal(history.body[0].fee, theirHistory.body[0].fee);
  assertRecorded(await ask(origin, `GET /esplora/address/${me}`), sample('an address that received and spent'), (body) => ({ ...body, address: me }));
  assertRecorded(await ask(origin, 'GET /esplora/blocks/tip/height'), sample('tip height, later'), () => String(origin.height()));

  // Nothing that was recorded has been left out.
  assert.deepEqual(
    [...samples, ...refusals].map((entry) => entry.what).filter((what) => !seen.has(what)),
    [],
  );
});

// -- the wallet on the other end --------------------------------------------------

test('scanWallet finds funded coins, confirmed and waiting', async () => {
  const { origin, esplora } = standIn();
  const funded = [
    origin.fund(receive(0).address, 100_000n),
    origin.fund(receive(2).address, 25_000), // a plain number does as well
    origin.fund(change(0).address, 40_000n, { confirmed: false }),
  ];

  const state = await scanWallet(account, esplora);
  assert.equal(state.confirmed, 125_000n);
  assert.equal(state.unconfirmed, 40_000n);
  assert.equal(state.nextReceiveIndex, 3);
  assert.equal(state.nextChangeIndex, 1);
  assert.deepEqual(state.receive.filter((address) => address.used).map((address) => address.index), [0, 2]);
  assert.deepEqual(state.coins.map((coin) => coin.txid).sort(), [...funded].sort());
  for (const coin of state.coins) {
    const tx = await esplora.tx(coin.txid);
    assert.deepEqual([tx.vout[coin.vout]?.scriptpubkey_address, tx.vout[coin.vout]?.value], [coin.address, Number(coin.value)]);
    assert.ok(tx.fee >= 2 * Math.ceil(tx.weight / 4), 'the stand-in pays 2 sat/vB, as the bots do');
  }
});

test('a payment built by the wallet broadcasts, shows as waiting, and confirms after mine()', async () => {
  const { origin, esplora } = standIn();
  origin.fund(receive(0).address, 100_000n);
  const payment = buildPayment(account, await scanWallet(account, esplora), { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  assert.equal(await esplora.broadcast(payment.hex), payment.txid);

  // Waiting: known, not in a block, with the fee and size the wallet worked out.
  const waiting = await esplora.tx(payment.txid);
  assert.deepEqual(waiting.status, { confirmed: false });
  assert.equal(BigInt(waiting.fee), payment.fee);
  assert.equal(Math.ceil(waiting.weight / 4), payment.vsize);
  const paidOut = (list: [string | undefined, bigint][]) => list.sort(([a], [b]) => String(a).localeCompare(String(b)));
  assert.deepEqual(
    paidOut(waiting.vout.map((output) => [output.scriptpubkey_address, BigInt(output.value)])),
    paidOut(payment.outputs.map((output) => [output.address, output.amount])),
  );
  const theirCoin = waiting.vout.findIndex((output) => output.scriptpubkey_address === SOMEONE);
  assert.deepEqual(waiting.vin.map((input) => [input.prevout?.scriptpubkey_address, input.prevout?.value]), [[receive(0).address, 100_000]]);

  // The coin it spends leaves the sender's list at once. What it pays shows as unconfirmed.
  assert.deepEqual(await esplora.addressUtxos(receive(0).address), []);
  assert.deepEqual(await esplora.addressUtxos(SOMEONE), [{ txid: payment.txid, vout: theirCoin, status: { confirmed: false }, value: 60_000 }]);
  const sender = await esplora.address(receive(0).address);
  assert.deepEqual(
    [sender.chain_stats.funded_txo_sum, sender.chain_stats.spent_txo_count, sender.mempool_stats.spent_txo_sum, sender.mempool_stats.tx_count],
    [100_000, 0, 100_000, 1],
  );
  const during = await scanWallet(account, esplora);
  assert.deepEqual([during.confirmed, during.unconfirmed], [0n, 40_000n - payment.fee]);

  // Sent again while it waits: accepted again, the same ID.
  assert.equal(await esplora.broadcast(payment.hex), payment.txid);

  const height = origin.mine();
  assert.deepEqual((await esplora.tx(payment.txid)).status, {
    confirmed: true,
    block_height: height,
    block_hash: (await esplora.addressUtxos(SOMEONE))[0]?.status.block_hash,
    block_time: START + 60,
  });
  const after = await scanWallet(account, esplora);
  assert.deepEqual([after.confirmed, after.unconfirmed], [40_000n - payment.fee, 0n]);
  assert.deepEqual((await esplora.address(receive(0).address)).chain_stats, {
    funded_txo_count: 1,
    funded_txo_sum: 100_000,
    spent_txo_count: 1,
    spent_txo_sum: 100_000,
    tx_count: 2,
  });

  // Sent again once it is in a block: refused.
  await assert.rejects(
    esplora.broadcast(payment.hex),
    (error: unknown) => error instanceof EsploraError && error.status === 400 && error.message.includes('Transaction outputs already in utxo set'),
  );
});

test('transactions of an address: the waiting ones first as they arrived, then newest first, 50 at most', async () => {
  const { origin, esplora } = standIn();
  const address = receive(0).address;
  const first = origin.fund(address, 1_000n);
  const second = origin.fund(address, 2_000n);
  const third = origin.fund(address, 3_000n, { confirmed: false });
  const fourth = origin.fund(address, 4_000n, { confirmed: false });
  assert.deepEqual((await esplora.addressTxs(address)).map((tx) => tx.txid), [third, fourth, second, first]);
  // Coins: those in blocks first.
  assert.deepEqual((await esplora.addressUtxos(address)).map((coin) => coin.value), [1_000, 2_000, 3_000, 4_000]);

  const more: string[] = [];
  for (let i = 0; i < 49; i++) more.push(origin.fund(address, 5_000n, { confirmed: false }));
  const listed = (await esplora.addressTxs(address)).map((tx) => tx.txid);
  assert.equal(listed.length, 50);
  assert.deepEqual(listed, [third, fourth, ...more.slice(0, 48)], '51 wait: the list is full before any confirmed one fits');
  origin.mine();
  const later = origin.fund(address, 6_000n, { confirmed: false });
  const now = (await esplora.addressTxs(address)).map((tx) => tx.txid);
  assert.equal(now.length, 50);
  assert.deepEqual(now.slice(0, 3), [later, more[48], more[47]], 'one waits; then the newest of the block, last in first');
});

// -- a long list, page by page ----------------------------------------------------

/** One list the practice network gave, as tools/integration/address-lists.ts wrote it down. */
interface RecordedList {
  /** "GET /esplora/address/<target>/txs/chain/<txid>": the address and the ID are left as names. */
  request: string;
  status: number;
  count: number;
  unconfirmed: number;
  confirmedCount: number;
  /** Where each listed transaction stands in the order the 60 payments were sent: 1 is the first. */
  sentOrder: number[];
  note?: string;
}
interface RecordedStep {
  state: string;
  /** The address's own count of its transactions: in blocks, and waiting. */
  stats?: { chain: number; mempool: number };
  lists: RecordedList[];
  reachedByChainPages?: number;
}
const addressLists: { steps: RecordedStep[] } = readJson('../fixtures/address-lists.json');

test('replaying the recording of a long list: an address with 60 transactions is listed page by page as the practice network listed it', async () => {
  // As the recording was made: one faucet coin, then 60 small payments to one of the wallet's own
  // addresses, each spending the change of the one before. 30 of them, a block, 30 more, a block.
  const { origin, esplora, coin: faucetCoin } = await withFaucetCoin();
  const target = receive(1).address;
  const changeAddress = change(0).address;
  let coin = faucetCoin;
  /** The payments' IDs, oldest first. */
  const sent: string[] = [];
  const payTarget = async (count: number): Promise<void> => {
    for (let n = 0; n < count; n++) {
      const left = coin.value - 600n - 200n;
      const tx = rawTx(coin, [{ address: target, amount: 600n }, { address: changeAddress, amount: left }]);
      assert.equal((await send(origin, tx.hex)).status, 200, `payment ${sent.length + 1}`);
      sent.push(tx.txid);
      coin = { txid: tx.txid, vout: 1, value: left, chain: 1, index: 0 };
    }
  };
  const order = (list: { txid: string }[]) => list.map((tx) => sent.indexOf(tx.txid) + 1);

  // The requests of the recording that the stand-in has no answer for. The Worker carries none of
  // them, so the app cannot ask them: a list of the waiting ones alone, and two ways to page that
  // go by a query string. The stand-in reads no query string, and says so: it refuses such a
  // question in its own words, where the practice network gave a list.
  const notCarried = new Set<string>();
  let replayed = 0;
  let refusedOutLoud = 0;

  /** Asks every list of one recorded step, and holds each answer to the recording: how many, of which kind, in which order. */
  const replay = async (step: RecordedStep): Promise<void> => {
    if (step.stats) {
      const stats = await esplora.address(target);
      assert.deepEqual({ chain: stats.chain_stats.tx_count, mempool: stats.mempool_stats.tx_count }, { chain: step.stats.chain, mempool: step.stats.mempool }, step.state);
    }
    /** The last ID of the page of confirmed ones asked for last: what the recording's next "<txid>" stands for. */
    let lastOfPage: string | undefined;
    const reached = new Set<number>();
    for (const list of step.lists) {
      const what = `${step.state}: ${list.request}${list.note ? ` (${list.note})` : ''}`;
      if (list.request.includes('?')) {
        // Asked all the same, with an ID that is one of the address's own: no list comes back
        // that could be taken for the practice network's.
        const question = list.request.replace('<target>', target).replace('<txid>', lastOfPage ?? sent[0]!);
        assert.doesNotMatch(question, /[<>]/, what);
        const got = await ask(origin, question);
        assert.deepEqual(
          got,
          {
            status: 400,
            contentType: 'text/plain',
            body: `stand-in origin: the stand-in reads no query string, and was asked ${JSON.stringify(question.split(' ')[1])}`,
          },
          what,
        );
        assert.equal(list.status, 200, `${what}: the practice network answered it`);
        refusedOutLoud += 1;
      }
      if (list.request.includes('?') || list.request.endsWith('/txs/mempool')) {
        notCarried.add(list.request);
        continue;
      }
      const paged = list.request.includes('/txs/chain');
      if (list.request.endsWith('/<txid>')) assert.ok(lastOfPage, `${what}: the page before it gave an ID to ask by`);
      const request = list.request
        .replace('<target>', target)
        .replace('<change>', changeAddress)
        .replace('<txid>', lastOfPage ?? '');
      assert.doesNotMatch(request, /[<>]/, what);

      const got = await ask(origin, request);
      assert.equal(got.status, list.status, what);
      assert.equal(got.contentType, 'application/json', what);
      const rows = got.body as { txid: string; status: { confirmed: boolean } }[];
      assert.equal(rows.length, list.count, what);
      assert.equal(rows.filter((row) => !row.status.confirmed).length, list.unconfirmed, what);
      assert.equal(rows.filter((row) => row.status.confirmed).length, list.confirmedCount, what);
      assert.deepEqual(order(rows), list.sentOrder, what);
      replayed += 1;
      if (paged) {
        lastOfPage = rows.at(-1)?.txid;
        for (const n of order(rows)) reached.add(n);
      }
    }
    if (step.reachedByChainPages !== undefined) assert.equal(reached.size, step.reachedByChainPages, `${step.state}: reached page by page`);
  };

  const [a, b, c, changeStep] = addressLists.steps;
  assert.ok(a && b && c && changeStep);
  assert.deepEqual(addressLists.steps.map((step) => step.state), ['30 unconfirmed', '30 confirmed, 30 unconfirmed', '60 confirmed', 'the change address, in all 60']);

  // A: 30 payments wait.
  await payTarget(30);
  await replay(a);
  assert.deepEqual(order(await esplora.addressTxsAll(target)), a.lists[0]!.sentOrder, 'all 30, in one answer');

  // B: a block takes them, and 30 more wait. The first page is full at 50: the 30 that wait,
  // then only the newest 20 of the 30 in the block.
  origin.mine();
  await payTarget(30);
  await replay(b);
  const first = b.lists[0]!;
  assert.deepEqual([first.count, first.unconfirmed, first.confirmedCount], [50, 30, 20]);
  // The wallet's client reads on from the last confirmed one of that page, and has all 60.
  const sixty = Array.from({ length: 60 }, (_, i) => i + 1);
  const requestsBefore = origin.requests().length;
  assert.deepEqual(order(await esplora.addressTxsAll(target)), [...sixty.slice(30), ...sixty.slice(0, 30).reverse()]);
  assert.deepEqual(
    origin.requests().slice(requestsBefore).map((request) => request.path),
    [`/esplora/address/${target}/txs`, `/esplora/address/${target}/txs/chain/${sent[10]}`],
    'two requests: the first page, then what comes after payment 11',
  );

  // C: another block. All 60 are in blocks, and the first page is the newest 50 of them.
  origin.mine();
  await replay(c);
  assert.deepEqual(order(await esplora.addressTxsAll(target)), [...sixty].reverse());

  // The change address took part in all 60 as well: paid by each, and spent from by all but the first.
  await replay(changeStep);
  assert.deepEqual(order(await esplora.addressTxsAll(changeAddress)), [...sixty].reverse());

  // Every list of the recording was either replayed or is one the stand-in does not carry.
  assert.equal(replayed, 12);
  assert.equal(replayed + [...addressLists.steps].flatMap((step) => step.lists).filter((list) => notCarried.has(list.request)).length, 18);
  assert.deepEqual([...notCarried].sort(), [
    'GET /esplora/address/<target>/txs/mempool',
    'GET /esplora/address/<target>/txs?after_txid=<txid>',
    'GET /esplora/address/<target>/txs?max_txs=100',
  ]);
  // What the practice network answered to the four questions with a query string, as recorded:
  // the part of the list after a given ID (10 of the 60, and then none), and a longer page (all
  // 60 at once). So the real server does have more to give than its first 50. The stand-in
  // refused each of the four.
  assert.deepEqual(
    addressLists.steps.flatMap((step) => step.lists.filter((list) => list.request.includes('?')).map((list) => [step.state, list.request.split('?')[1], list.status, list.count])),
    [
      ['30 confirmed, 30 unconfirmed', 'after_txid=<txid>', 200, 10],
      ['30 confirmed, 30 unconfirmed', 'max_txs=100', 200, 60],
      ['60 confirmed', 'after_txid=<txid>', 200, 10],
      ['60 confirmed', 'after_txid=<txid>', 200, 0],
    ],
  );
  assert.equal(refusedOutLoud, 4);
  assert.deepEqual(await ask(origin, `GET /esplora/address/${target}/txs/mempool`), {
    status: 404,
    contentType: 'text/plain',
    body: 'endpoint does not exist "/address/' + target + '/txs/mempool"',
  });
});

test('the older pages of a list: 25 confirmed ones at a time, newest first, after the transaction named; an empty list at the end', async () => {
  const { origin, esplora } = standIn();
  const address = receive(0).address;
  const ids = (list: { txid: string }[]) => list.map((tx) => tx.txid);
  const page = async (after?: string) => ids((await ask(origin, `GET /esplora/address/${address}/txs/chain${after === undefined ? '' : `/${after}`}`)).body);

  // No history: both shapes answer an empty list, as the address's first page does.
  assert.deepEqual(await ask(origin, `GET /esplora/address/${address}/txs/chain`), { status: 200, contentType: 'application/json', body: [] });
  assert.deepEqual(await page('ab'.repeat(32)), []);

  // 130 payments: 100 in blocks (five blocks of 20), then 30 that wait. Oldest first.
  const paid: string[] = [];
  for (let block = 0; block < 5; block++) {
    for (let n = 0; n < 20; n++) paid.push(origin.fund(address, 1_000n, { confirmed: false }));
    origin.mine();
  }
  const confirmed = paid.slice(0, 100).reverse(); // newest first: the last block first and, inside a block, the last arrival first
  for (let n = 0; n < 30; n++) paid.push(origin.fund(address, 1_000n, { confirmed: false }));
  const waiting = paid.slice(100);

  // The first page: the 30 that wait, then the newest 20 in blocks.
  assert.deepEqual(ids(await esplora.addressTxs(address)), [...waiting, ...confirmed.slice(0, 20)]);
  // The confirmed ones alone, from the top: 25. The waiting ones are never among them.
  assert.deepEqual(await page(), confirmed.slice(0, 25));
  // After any one of them: the next 25 in the same order, or as many as are left.
  assert.deepEqual(await page(confirmed[24]), confirmed.slice(25, 50));
  assert.deepEqual(await page(confirmed[19]), confirmed.slice(20, 45), 'by the last confirmed one of the first page');
  assert.deepEqual(await page(confirmed[0]), confirmed.slice(1, 26));
  assert.deepEqual(await page(confirmed[74]), confirmed.slice(75, 100));
  assert.deepEqual(await page(confirmed[89]), confirmed.slice(90, 100), 'a short page: the last one');
  assert.deepEqual(await page(confirmed[98]), [confirmed[99]]);
  assert.deepEqual(await page(confirmed[99]), [], 'after the oldest: an empty list');
  // Every transaction comes as the address's first page gives it: the same fields, a block and its time.
  const [whole] = (await ask(origin, `GET /esplora/address/${address}/txs/chain/${confirmed[18]}`)).body as { txid: string; status: { confirmed: boolean } }[];
  assert.equal(whole?.txid, confirmed[19]);
  assert.equal(whole?.status.confirmed, true);
  assert.deepEqual(whole, (await esplora.addressTxs(address))[49]);

  // An ID that is not in the list gives nothing: one nobody knows, one that still waits, and
  // one of another address. (From the server's source: it looks down the list for the ID.)
  const elsewhere = origin.fund(SOMEONE, 1_000n);
  for (const other of ['ab'.repeat(32), waiting[0]!, elsewhere]) assert.deepEqual(await page(other), [], other);
  // An ID in capitals is the same ID. Text that is no ID is read as none: the first page.
  assert.deepEqual(await page(confirmed[24]!.toUpperCase()), confirmed.slice(25, 50));
  for (const text of ['abc', 'x'.repeat(64), `${confirmed[24]}0`, '']) assert.deepEqual(await page(text), confirmed.slice(0, 25), JSON.stringify(text));
  // The address is checked as in every other shape, and nothing may follow the ID.
  assert.deepEqual(await ask(origin, 'GET /esplora/address/bcrt1qnotanaddress/txs/chain'), { status: 400, contentType: 'text/plain', body: 'Invalid Bitcoin address' });
  assert.equal((await ask(origin, `GET /esplora/address/${address}/txs/chain/${confirmed[24]}/more`)).status, 404);
  assert.equal((await ask(origin, `POST /esplora/address/${address}/txs/chain`)).status, 404);

  // The wallet's client puts the pages together: all 130, each once, the waiting ones first.
  const before = origin.requests().length;
  assert.deepEqual(ids(await esplora.addressTxsAll(address)), [...waiting, ...confirmed]);
  assert.deepEqual(
    origin.requests().slice(before).map((request) => request.path.slice(`/esplora/address/${address}`.length)),
    ['/txs', `/txs/chain/${confirmed[19]}`, `/txs/chain/${confirmed[44]}`, `/txs/chain/${confirmed[69]}`, `/txs/chain/${confirmed[94]}`],
    'five requests: 50, 25, 25, 25 and the last 5',
  );

  // A block takes the 30. A page asked for by the same ID as before holds what it held: what is new goes on top.
  origin.mine();
  assert.deepEqual(await page(confirmed[24]), confirmed.slice(25, 50));
  assert.deepEqual(await page(), [...waiting].reverse().slice(0, 25));
  assert.deepEqual(ids(await esplora.addressTxsAll(address)), [...[...waiting].reverse(), ...confirmed]);
});

test('a question to Esplora that carries a query string is refused out loud, at both doors: the stand-in reads none', async () => {
  const { origin, esplora } = standIn();
  const address = receive(0).address;
  const paid: string[] = [];
  for (let n = 0; n < 60; n++) paid.push(origin.fund(address, 1_000n, { confirmed: false }));
  origin.mine();
  const newestFirst = [...paid].reverse();
  const refusal = (question: string) => ({
    status: 400,
    contentType: 'text/plain',
    body: `stand-in origin: the stand-in reads no query string, and was asked ${JSON.stringify(question)}`,
  });

  // The first page as it is: 50 of the 60.
  assert.equal((await ask(origin, `GET /esplora/address/${address}/txs`)).body.length, 50);
  // The real server reads a query string. Asked for what comes after the last ID of that page
  // it lists the other 10, and asked for 100 at once it lists all 60 (the recording). The
  // stand-in knows neither. It used to drop the query and answer with the first 50 again: a
  // list that looks right and is not. Now each such question fails where it is asked.
  const questions = [
    `/esplora/address/${address}/txs?after_txid=${newestFirst[49]}`,
    `/esplora/address/${address}/txs?max_txs=100`,
    `/esplora/address/${address}/txs/chain?max_txs=100`,
    `/esplora/address/${address}/txs/chain/${newestFirst[24]}?max_txs=1`,
    `/esplora/address/${address}/utxo?x`,
    `/esplora/address/${address}?after_txid=${newestFirst[0]}`,
    `/esplora/tx/${paid[0]}?x=1`,
    '/esplora/blocks/tip/height?x=1',
    '/esplora/nothing?x=1',
  ];
  for (const question of questions) assert.deepEqual(await ask(origin, `GET ${question}`), refusal(question), question);
  // A broadcast as well: the node is not shown the transaction.
  origin.fund(receive(1).address, 5_000n);
  const coin = (await esplora.addressUtxos(receive(1).address))[0]!;
  const payment = rawTx({ txid: coin.txid, vout: coin.vout, value: BigInt(coin.value), chain: 0, index: 1 }, [{ address: SOMEONE, amount: 4_000n }]);
  assert.deepEqual(await ask(origin, 'POST /esplora/tx?x=1', { body: payment.hex }), refusal('/esplora/tx?x=1'));
  assert.equal((await ask(origin, `GET /esplora/tx/${payment.txid}`)).status, 404, 'the node was not shown it');
  // The same transaction, sent without the query string, is taken.
  assert.equal((await send(origin, payment.hex)).status, 200);

  // A question mark with nothing after it is no query string, to the real server either.
  assert.equal((await ask(origin, 'GET /esplora/blocks/tip/height?')).body, String(origin.height()));
  // The bots are another matter. The real ones cut a query string off and answer as if it had
  // not been there (bots/practice_bots/server.py), and so does the stand-in.
  assert.equal((await ask(origin, 'GET /bots/health?x=1')).status, 200);
  // requests() goes on listing the path alone.
  assert.deepEqual(origin.requests().at(-1), { method: 'GET', path: '/bots/health' });
  assert.ok(origin.requests().some((request) => request.path === `/esplora/address/${address}/txs` && request.method === 'GET'));
  assert.ok(origin.requests().every((request) => !request.path.includes('?')));

  // Over a socket: the same refusal, and the same answer without the query string.
  const { url, close } = await origin.listen();
  try {
    for (const question of questions.slice(0, 2)) {
      const response = await fetch(`${url}${question}`);
      assert.deepEqual(
        { status: response.status, contentType: response.headers.get('content-type'), body: await response.text() },
        refusal(question),
        question,
      );
    }
    const plain = await fetch(`${url}/esplora/address/${address}/txs`);
    assert.equal(((await plain.json()) as unknown[]).length, 50);
  } finally {
    await close();
  }

  // Nothing changes for the wallet's client, which asks without one: all 60, in two requests.
  assert.equal((await esplora.addressTxsAll(address)).length, 60);
});

// -- broadcasts the recording does not cover ----------------------------------------

/** What Esplora answers when the node refuses a transaction with these words. */
const refusedWith = (message: string): Got => ({
  status: 400,
  contentType: 'text/plain',
  body: `sendrawtransaction RPC error: {"code":-26,"message":"${message}"}`,
});

test('a replacement that pays enough pushes out what it replaces, and whatever spends from that', async () => {
  const { origin, esplora, coin, faucetTxid } = await withFaucetCoin();
  origin.fund(receive(3).address, 50_000n);
  const [utxo] = await esplora.addressUtxos(receive(3).address);
  assert.ok(utxo);
  const another: Spendable = { txid: utxo.txid, vout: utxo.vout, value: 50_000n, chain: 0, index: 3 };

  // Two payments wait. The faucet coin goes to our next address. From there it goes on to someone else,
  // together with a second coin of ours.
  const original = rawTx(coin, [{ address: receive(1).address, amount: coin.value - 500n }]);
  const itsCoin: Spendable = { txid: original.txid, vout: 0, value: coin.value - 500n, chain: 0, index: 1 };
  const child = rawTx([itsCoin, another], [{ address: SOMEONE, amount: itsCoin.value + another.value - 4_900n }]);
  assert.equal((await send(origin, original.hex)).status, 200);
  assert.equal((await send(origin, child.hex)).status, 200);
  assert.deepEqual(await esplora.addressUtxos(receive(3).address), [], 'the second coin is being spent');

  // Another payment of the faucet coin would push both out, so the fees of both count: 500 and 4,900 sats.
  const paying = (fee: bigint) => rawTx(coin, [{ address: receive(2).address, amount: coin.value - fee }]);
  const tooLittle = async (tx: { hex: string; txid: string }, why: string) =>
    assert.deepEqual(await send(origin, tx.hex), refusedWith(`insufficient fee, rejecting replacement ${tx.txid}, ${why}`));
  await tooLittle(paying(5_399n), 'less fees than conflicting txs; 0.00005399 < 0.000054');
  // It has to pay for its own size on top, at 0.1 sat/vB: 11 sats for its 110 vB.
  assert.equal(paying(5_411n).vsize, 110);
  await tooLittle(paying(5_400n), 'not enough additional fees to relay; 0.00 < 0.00000011');
  await tooLittle(paying(5_410n), 'not enough additional fees to relay; 0.0000001 < 0.00000011');
  assert.equal((await esplora.tx(child.txid)).status.confirmed, false, 'a refused replacement pushes nothing out');

  // With 11 sats more it is in, and the two it replaces are gone, as if they had never been sent.
  const richer = paying(5_411n);
  assert.deepEqual(await send(origin, richer.hex), { status: 200, contentType: 'text/plain', body: richer.txid });
  const unseen = recorded(samples, 'a transaction nobody has seen');
  assertRecorded(await ask(origin, `GET /esplora/tx/${original.txid}`), unseen);
  assertRecorded(await ask(origin, `GET /esplora/tx/${child.txid}`), unseen);
  assert.deepEqual(await esplora.addressTxs(SOMEONE), []);
  assert.deepEqual(await esplora.addressUtxos(receive(1).address), []);
  assert.deepEqual(await esplora.addressUtxos(receive(3).address), [utxo], 'the second coin is free again');
  assert.deepEqual(await esplora.addressUtxos(receive(2).address), [{ txid: richer.txid, vout: 0, status: { confirmed: false }, value: 100_000 - 5_411 }]);
  assert.deepEqual((await esplora.addressTxs(receive(0).address)).map((tx) => tx.txid), [richer.txid, faucetTxid]);
  assert.deepEqual((await esplora.address(receive(0).address)).mempool_stats, {
    funded_txo_count: 0,
    funded_txo_sum: 0,
    spent_txo_count: 1,
    spent_txo_sum: 100_000,
    tx_count: 1,
  });

  // Now the first payment is the one that would have to outbid, and the second spends a coin that is not there.
  await tooLittle(original, 'less fees than conflicting txs; 0.000005 < 0.00005411');
  assertRecorded(await send(origin, child.hex), recorded(refusals, 'coin already spent in a block'));
  origin.mine();
  assert.equal((await esplora.tx(richer.txid)).status.confirmed, true);
  assertRecorded(await send(origin, original.hex), recorded(refusals, 'coin already spent in a block'));
});

test('a replacement cannot spend a coin of a transaction it would push out', async () => {
  const { origin, esplora, coin } = await withFaucetCoin();
  const original = rawTx(coin, [{ address: receive(1).address, amount: coin.value - 500n }]);
  const itsCoin: Spendable = { txid: original.txid, vout: 0, value: coin.value - 500n, chain: 0, index: 1 };
  const child = rawTx(itsCoin, [{ address: receive(2).address, amount: itsCoin.value - 500n }]);
  const childsCoin: Spendable = { txid: child.txid, vout: 0, value: itsCoin.value - 500n, chain: 0, index: 2 };
  assert.equal((await send(origin, original.hex)).status, 200);
  assert.equal((await send(origin, child.hex)).status, 200);

  // Two coins in: the faucet coin, which the first payment already spends, and a coin
  // that is there only because of that payment. The fee is far more than enough.
  // The node names the rival: the payment that spends the same coin. So it does when the coin is one step further down.
  for (const second of [itsCoin, childsCoin]) {
    const tx = rawTx([coin, second], [{ address: SOMEONE, amount: coin.value }]);
    assert.deepEqual(await send(origin, tx.hex), refusedWith(`bad-txns-spends-conflicting-tx, ${tx.txid} spends conflicting transaction ${original.txid}`));
  }
  assert.equal((await esplora.tx(child.txid)).status.confirmed, false, 'nothing was pushed out');
});

test('what a replacement pushes out no longer counts toward the 64 that may hang together', async () => {
  const { origin, coin } = await withFaucetCoin();
  // One waiting payment makes two coins, and a chain of 63 payments hangs from the first of them: 64 in all.
  const parent = rawTx(coin, [
    { address: receive(1).address, amount: 60_000n },
    { address: receive(2).address, amount: 39_000n },
  ]);
  assert.equal((await send(origin, parent.hex)).status, 200);
  const first: Spendable = { txid: parent.txid, vout: 0, value: 60_000n, chain: 0, index: 1 };
  let last = first;
  for (let i = 1; i <= 63; i++) {
    const next = rawTx(last, [{ address: change(i).address, amount: last.value - 250n }]);
    assert.equal((await send(origin, next.hex)).status, 200, `payment ${i} of the chain`);
    last = { txid: next.txid, vout: 0, value: last.value - 250n, chain: 1, index: i };
  }
  // So the second coin has to wait for a block.
  const second = rawTx({ txid: parent.txid, vout: 1, value: 39_000n, chain: 0, index: 2 }, [{ address: SOMEONE, amount: 38_500n }]);
  assertRecorded(await send(origin, second.hex), recorded(refusals, 'unconfirmed chain: payment 65 in a row'));

  // A replacement of the chain's first payment is asked about its fee before anything else: the chain paid 63 times 250 sats.
  const stingy = rawTx(first, [{ address: receive(3).address, amount: first.value - 15_000n }]);
  assert.deepEqual(
    await send(origin, stingy.hex),
    refusedWith(`insufficient fee, rejecting replacement ${stingy.txid}, less fees than conflicting txs; 0.00015 < 0.0001575`),
  );
  // One that outbids the whole chain takes its place. Two hang together now, and there is room for the second coin's payment.
  const bid = rawTx(first, [{ address: receive(3).address, amount: first.value - 20_000n }]);
  assert.deepEqual(await send(origin, bid.hex), { status: 200, contentType: 'text/plain', body: bid.txid });
  assert.deepEqual(await send(origin, second.hex), { status: 200, contentType: 'text/plain', body: second.txid });
});

test('a bcrt1q coin has to be spent with the key of its address; the signature itself is taken on trust', async () => {
  const { origin, esplora, coin } = await withFaucetCoin();
  const outputs = [{ address: SOMEONE, amount: coin.value - 500n }];
  // The node's words for a coin spent the wrong way, as Bitcoin Core 31 puts them together. (They are not in the recording.)
  const refusal = (fault: string, tx: { hex: string; txid: string }) => {
    const once = createHash('sha256').update(Buffer.from(tx.hex, 'hex')).digest();
    const wtxid = createHash('sha256').update(once).digest().reverse().toString('hex');
    return refusedWith(`mempool-script-verify-flag-failed (${fault}), input 0 of ${tx.txid} (wtxid ${wtxid}), spending ${coin.txid}:${coin.vout}`);
  };

  // The coin is receive address 0's. This payment is signed as if it were receive address 1's.
  const wrong = rawTx({ ...coin, index: 1 }, outputs);
  assert.deepEqual(await send(origin, wrong.hex), refusal('Script failed an OP_EQUALVERIFY operation', wrong));

  // No signature and no key at all; a signature with no key beside it; and the two with a third thing.
  const good = rawTx(coin, outputs);
  const parts = RawTx.decode(Buffer.from(good.hex, 'hex'));
  const [signature, key] = parts.witnesses?.[0] ?? [];
  assert.ok(signature && key);
  for (const change of [{ segwitFlag: false, witnesses: [] }, { witnesses: [[signature]] }, { witnesses: [[signature, key, key]] }]) {
    const tx = { hex: Buffer.from(RawTx.encode({ ...parts, ...change })).toString('hex'), txid: good.txid };
    assert.deepEqual(await send(origin, tx.hex), refusal('Witness program hash mismatch', tx));
  }
  assert.equal((await esplora.address(SOMEONE)).mempool_stats.tx_count, 0, 'nothing got in');

  // Signed with the key of its own address, it is accepted.
  assert.deepEqual(await send(origin, good.hex), { status: 200, contentType: 'text/plain', body: good.txid });

  // A coin of any other kind is not looked at. This taproot coin is spent with no signature at all.
  const funded = origin.fund(TAPROOT, 10_000n);
  const [taprootCoin] = await esplora.addressUtxos(TAPROOT);
  assert.ok(taprootCoin);
  const unsigned = RawTx.encode({
    version: 2,
    segwitFlag: false,
    inputs: [{ txid: Buffer.from(funded, 'hex'), index: taprootCoin.vout, finalScriptSig: new Uint8Array(0), sequence: RBF_SEQUENCE }],
    outputs: [{ amount: 9_500n, script: addressScript(SOMEONE) }],
    witnesses: [],
    lockTime: 0,
  });
  assert.equal((await send(origin, Buffer.from(unsigned).toString('hex'))).status, 200);
});

test('a hand-made transaction cannot make coins from nothing', async () => {
  const { origin, coin } = await withFaucetCoin();
  // The signing library refuses to make either of these, so a good payment is
  // altered after it was signed. (Its signature no longer fits. Nobody checks.)
  const good = RawTx.decode(Buffer.from(rawTx(coin, [{ address: SOMEONE, amount: coin.value - 500n }]).hex, 'hex'));
  const [input] = good.inputs;
  const [output] = good.outputs;
  const [witness] = good.witnesses ?? [];
  assert.ok(input && output && witness);
  const altered = (change: Partial<typeof good>) => send(origin, Buffer.from(RawTx.encode({ ...good, ...change })).toString('hex'));

  // More out than in.
  const tooMuch = await altered({ outputs: [{ ...output, amount: coin.value + 1n }] });
  assert.equal(tooMuch.status, 400);
  assert.match(tooMuch.body, /bad-txns-in-belowout, value in \(0\.001\) < value out \(0\.00100001\)/);

  // The same coin spent twice in one transaction, to pay out nearly twice its worth.
  const doubled = await altered({ inputs: [input, input], witnesses: [witness, witness], outputs: [{ ...output, amount: coin.value * 2n - 500n }] });
  assert.equal(doubled.status, 400);
  assert.match(doubled.body, /bad-txns-inputs-duplicate/);

  // Nothing got in.
  assert.deepEqual((await ask(origin, `GET /esplora/address/${SOMEONE}`)).body.mempool_stats.tx_count, 0);

  // An output nobody can spend (OP_RETURN) may hold nothing at all: it has no dust limit, and no address.
  const note = await altered({ outputs: [output, { amount: 0n, script: Uint8Array.of(0x6a, 0x02, 0x68, 0x69) }] });
  assert.equal(note.status, 200);
  assert.deepEqual((await ask(origin, `GET /esplora/tx/${note.body}`)).body.vout[1], {
    scriptpubkey: '6a026869',
    scriptpubkey_asm: 'OP_RETURN OP_PUSHBYTES_2 6869',
    scriptpubkey_type: 'op_return',
    value: 0,
  });
});

test('each kind of address has its own dust limit, to the sat', async () => {
  const { origin, esplora } = standIn();
  const dust = recorded(refusals, 'dust: a 200 sat output');
  const filled = (length: number) => new Uint8Array(length).fill(7);
  const address = Address(REGTEST);
  // The limits of Bitcoin Core's rule at 3 sat/vB. The first three were measured on the live node.
  const kinds: [address: string, limit: bigint, type: string, asm: string][] = [
    [receive(9).address, 294n, 'v0_p2wpkh', `OP_0 OP_PUSHBYTES_20 ${Buffer.from(receive(9).script.subarray(2)).toString('hex')}`],
    [address.encode({ type: 'wsh', hash: filled(32) }), 330n, 'v0_p2wsh', `OP_0 OP_PUSHBYTES_32 ${'07'.repeat(32)}`],
    [TAPROOT, 330n, 'v1_p2tr', `OP_PUSHNUM_1 OP_PUSHBYTES_32 ${Buffer.from(TAPROOT_OUTPUT.script.subarray(2)).toString('hex')}`],
    [address.encode({ type: 'pkh', hash: filled(20) }), 546n, 'p2pkh', `OP_DUP OP_HASH160 OP_PUSHBYTES_20 ${'07'.repeat(20)} OP_EQUALVERIFY OP_CHECKSIG`],
    [address.encode({ type: 'sh', hash: filled(20) }), 540n, 'p2sh', `OP_HASH160 OP_PUSHBYTES_20 ${'07'.repeat(20)} OP_EQUAL`],
    // Later versions of segwit, which the wallet lets a reader pay as well. Esplora has an address for each
    // and a name of its own for few: none for this version 2 address, "anchor" for the output anyone can spend.
    [bech32m.encode('bcrt', [2, ...bech32m.toWords(filled(20))]), 294n, 'unknown', `OP_PUSHNUM_2 OP_PUSHBYTES_20 ${'07'.repeat(20)}`],
    [bech32m.encode('bcrt', [1, ...bech32m.toWords(Uint8Array.of(0x4e, 0x73))]), 240n, 'anchor', 'OP_PUSHNUM_1 OP_PUSHBYTES_2 4e73'],
  ];
  for (const [index, [to, limit, type, asm]] of kinds.entries()) {
    origin.fund(receive(index).address, 50_000n);
    const [utxo] = await esplora.addressUtxos(receive(index).address);
    assert.ok(utxo);
    const coin: Spendable = { txid: utxo.txid, vout: utxo.vout, value: 50_000n, chain: 0, index: index as 0 };
    const pay = (amount: bigint) => rawTx(coin, [{ address: to, amount }, { address: change(0).address, amount: coin.value - amount - 400n }]);

    assertRecorded(await send(origin, pay(limit - 1n).hex), dust);
    const atLimit = pay(limit);
    assert.deepEqual(await send(origin, atLimit.hex), { status: 200, contentType: 'text/plain', body: atLimit.txid }, type);

    // Esplora knows the coin by its address, and names the kind of script.
    assert.deepEqual(await esplora.addressUtxos(to), [{ txid: atLimit.txid, vout: 0, status: { confirmed: false }, value: Number(limit) }], type);
    const output = (await ask(origin, `GET /esplora/tx/${atLimit.txid}`)).body.vout[0];
    assert.deepEqual([output.scriptpubkey_type, output.scriptpubkey_asm, output.scriptpubkey_address], [type, asm, to]);
    // The faucet pays every kind that has a bcrt1 address, and no other.
    assert.equal((await faucet(origin, to)).status, to.startsWith('bcrt1') ? 200 : 400, type);
  }
});

test('a transaction of under 65 bytes, counted without its witnesses, is refused as "tx-size-small"', async () => {
  const { origin, esplora, coin } = await withFaucetCoin();
  // The recording holds no such refusal. The words are the node's, and the code is the one it gives every refusal by its own rules.
  const tooSmall: Got = { status: 400, contentType: 'text/plain', body: 'sendrawtransaction RPC error: {"code":-26,"message":"tx-size-small"}' };
  const segwit = (version: number, program: number[]) => bech32m.encode('bcrt', [version, ...bech32m.toWords(Uint8Array.from(program))]);
  /** One coin in, one output and no change, and the bytes of that transaction without its witnesses. */
  const paidInFull = (from: Spendable, to: string, fee = 500n) => {
    const tx = rawTx(from, [{ address: to, amount: from.value - fee }]);
    const stripped = Transaction.fromRaw(Buffer.from(tx.hex, 'hex'), { allowUnknownOutputs: true }).toBytes(true, false).length;
    return { ...tx, stripped };
  };

  // One coin in and one output are 60 bytes and the output's script. An address whose program
  // is 2 bytes stands for a script of 4: pay-to-anchor is one, and any later version can have one.
  const anchor = segwit(1, [0x4e, 0x73]);
  for (const to of [anchor, segwit(16, [1, 2])]) {
    const small = paidInFull(coin, to);
    assert.equal(small.stripped, 64, to);
    assert.deepEqual(await send(origin, small.hex), tooSmall, to);
  }
  // The node asks this early: before it looks for the coin, and long before it weighs the fee.
  assert.deepEqual(await send(origin, paidInFull({ ...coin, txid: 'ab'.repeat(32) }, anchor).hex), tooSmall, 'a coin that never was');
  assert.deepEqual(await send(origin, paidInFull(coin, anchor, 0n).hex), tooSmall, 'no fee at all');
  assert.deepEqual(await esplora.addressUtxos(anchor), [], 'nothing got in');

  // One byte more in the script is one byte more in the transaction, and 65 are enough.
  const enough = paidInFull(coin, segwit(1, [1, 2, 3]));
  assert.equal(enough.stripped, 65);
  assert.deepEqual(await send(origin, enough.hex), { status: 200, contentType: 'text/plain', body: enough.txid });
  // Esplora reports the size with the witnesses and the weight. The bytes outside the witnesses weigh 4 each, the rest 1.
  const seen = (await ask(origin, `GET /esplora/tx/${enough.txid}`)).body;
  assert.equal((seen.weight - seen.size) / 3, 65);
});

test('a coin that never was, and a dust output on a payment with no fee', async () => {
  const { origin, coin } = await withFaucetCoin();
  const gone = recorded(refusals, 'coin already spent in a block');
  const pay = (from: Spendable) => rawTx(from, [{ address: SOMEONE, amount: from.value - 500n }]);
  assertRecorded(await send(origin, pay({ ...coin, txid: 'ab'.repeat(32) }).hex), gone);
  assertRecorded(await send(origin, pay({ ...coin, vout: 7 }).hex), gone);
  // A coinbase spends nothing, so its "coin" is not there either.
  const coinbase = RawTx.encode({
    version: 2,
    segwitFlag: false,
    inputs: [{ txid: new Uint8Array(32), index: 0xffffffff, finalScriptSig: Uint8Array.of(1, 101, 0), sequence: 0xffffffff }],
    outputs: [{ amount: 5_000_000_000n, script: receive(0).script }],
    witnesses: [],
    lockTime: 0,
  });
  assertRecorded(await send(origin, Buffer.from(coinbase).toString('hex')), gone);

  // The dust rule's own words say it spares a payment with no fee. The fee rule then stops it.
  const free = rawTx(coin, [{ address: SOMEONE, amount: 200n }, { address: change(0).address, amount: coin.value - 200n }]);
  const answer = await send(origin, free.hex);
  assert.deepEqual([answer.status, answer.body], [400, 'sendrawtransaction RPC error: {"code":-26,"message":"min relay fee not met, 0 < 15"}']);

  // Bytes that read as a transaction with nothing in it; and hex in capitals, which is hex all the same.
  assertRecorded(await send(origin, '02000000000000000000'), recorded(refusals, 'not a transaction'));
  const good = pay(coin);
  assert.deepEqual(await send(origin, good.hex.toUpperCase()), { status: 200, contentType: 'text/plain', body: good.txid });
});

test('a confirmed payment sent again: "already in utxo set" until a block has spent every output', async () => {
  const { origin, coin } = await withFaucetCoin();
  const first = rawTx(coin, [{ address: receive(1).address, amount: coin.value - 500n }]);
  assert.equal((await send(origin, first.hex)).status, 200);
  origin.mine();
  const inTheSet = recorded(refusals, 'already in a block: the same transaction sent again');
  assertRecorded(await send(origin, first.hex), inTheSet);

  // Its one output is spent by a payment that only waits: the node's set of coins still holds it.
  const second = rawTx({ txid: first.txid, vout: 0, value: coin.value - 500n, chain: 0, index: 1 }, [{ address: SOMEONE, amount: coin.value - 1_000n }]);
  assert.equal((await send(origin, second.hex)).status, 200);
  assertRecorded(await send(origin, first.hex), inTheSet);

  // Once that payment is in a block, nothing of the first is left in the set. All the node
  // sees now is a transaction whose coin is gone (Bitcoin Core's order of checks; not in the recording).
  origin.mine();
  assertRecorded(await send(origin, first.hex), recorded(refusals, 'coin already spent in a block'));
});

test('Esplora answers for IDs and paths that are not well formed', async () => {
  const { origin } = standIn();
  const txid = origin.fund(SOMEONE, 1_000n);
  assert.deepEqual(await ask(origin, 'GET /esplora/tx/abc'), { status: 400, contentType: 'text/plain', body: 'Invalid hex hash' });
  assert.deepEqual(await ask(origin, 'GET /esplora/address/'), { status: 400, contentType: 'text/plain', body: 'Invalid Bitcoin address' });
  // An ID in capitals is the same ID.
  assert.equal((await ask(origin, `GET /esplora/tx/${txid.toUpperCase()}`)).body.txid, txid);
  // The real server knows more paths than the wallet uses. The stand-in knows only those.
  for (const request of [
    'GET /esplora/tx',
    `GET /esplora/tx/${txid}/hex`,
    'GET /esplora/blocks/tip/height/',
    `GET /esplora/address/${SOMEONE}/nothing`,
    'POST /esplora/blocks/tip/height',
  ]) {
    const path = request.split(' ')[1]!.slice('/esplora'.length);
    assert.deepEqual(await ask(origin, request), { status: 404, contentType: 'text/plain', body: `endpoint does not exist "${path}"` }, request);
  }
  // A test-network address written the old way is good on regtest too: the two share their version bytes.
  assert.equal((await ask(origin, 'GET /esplora/address/mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).status, 200);
  // And so is one written the new way, with testnet's "tb" in front: the same script as its bcrt1 twin,
  // and the twin's answers, under the name it was asked by.
  const twin = bech32.encode('tb', bech32.decode(SOMEONE).words);
  assert.match(twin, /^tb1q/);
  const theirs = await ask(origin, `GET /esplora/address/${SOMEONE}`);
  assert.equal(theirs.body.chain_stats.funded_txo_sum, 1_000);
  assert.deepEqual(await ask(origin, `GET /esplora/address/${twin}`), { ...theirs, body: { ...theirs.body, address: twin } });
  for (const list of ['utxo', 'txs']) {
    const answer = await ask(origin, `GET /esplora/address/${twin}/${list}`);
    assert.equal(answer.body.length, 1, list);
    assert.deepEqual(answer, await ask(origin, `GET /esplora/address/${SOMEONE}/${list}`), list);
  }
});

// -- the faucet -------------------------------------------------------------------

test('the faucet asks for the token and a small JSON body', async () => {
  const { origin } = standIn();
  const body = JSON.stringify({ address: receive(0).address });
  const unauthorized = { status: 401, contentType: 'application/json', body: { error: 'unauthorized', code: 'unauthorized' } };
  assert.deepEqual(await ask(origin, 'POST /bots/faucet', { body }), unauthorized);
  assert.deepEqual(await ask(origin, 'POST /bots/faucet', { body, token: 'wrong' }), unauthorized);
  assert.deepEqual(await ask(origin, 'GET /bots/pot/address', { token: 'wrong' }), unauthorized);
  assert.equal(origin.token, FAKE_BOTS_TOKEN);

  const small = { status: 400, contentType: 'application/json', body: { error: 'Send a small JSON body with an address', code: 'bad_request' } };
  assert.deepEqual(await ask(origin, 'POST /bots/faucet', { token: origin.token }), small);
  assert.deepEqual(await ask(origin, 'POST /bots/faucet', { token: origin.token, body: JSON.stringify({ address: 'x'.repeat(1024) }) }), small);
  for (const notAnObject of ['[]', '"bcrt1"', 'null', '{']) {
    assert.equal((await ask(origin, 'POST /bots/faucet', { token: origin.token, body: notAnObject })).body.code, 'bad_request', notAnObject);
  }
  // A body sent as a stream has no Content-Length, and the bots read only as much as that says.
  const streamed = { method: 'POST', headers: { Authorization: `Bearer ${origin.token}` }, body: new Blob([body]).stream(), duplex: 'half' };
  const answer = await origin.fetch(`${BASE}/bots/faucet`, streamed as RequestInit);
  assert.deepEqual([answer.status, await answer.json()], [small.status, small.body]);

  // Other paths and methods, as the bots' server answers them.
  const notFound = { status: 404, contentType: 'application/json', body: { error: 'not found', code: 'not_found' } };
  assert.deepEqual(await ask(origin, 'GET /bots/faucet', { token: origin.token }), notFound);
  assert.deepEqual(await ask(origin, 'POST /bots/pot/address', { token: origin.token, body }), notFound);

  // A token of the caller's choosing.
  const other = standIn({ token: 'another' }).origin;
  assert.equal(other.token, 'another');
  assert.equal((await ask(other, 'POST /bots/faucet', { body, token: FAKE_BOTS_TOKEN })).status, 401);
  assert.equal((await faucet(other, receive(0).address)).status, 200);
});

test('the faucet checks the address, then pays each address once in 24 hours', async () => {
  const { origin, clock, esplora } = standIn();
  const bad = (error: string) => ({ status: 400, contentType: 'application/json', body: { error, code: 'bad_address' } });
  assert.deepEqual(await ask(origin, 'POST /bots/faucet', { token: origin.token, body: '{}' }), bad('Send a practice-network address'));
  assert.deepEqual(await faucet(origin, 'bcrt1q'.padEnd(101, 'q')), bad('Send a practice-network address'));
  const notOurs = bad('That is not a practice-network address (they start with bcrt1)');
  assert.deepEqual(await faucet(origin, 'bcrt1qnotanaddress'), notOurs);
  assert.deepEqual(await faucet(origin, 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), notOurs);
  assert.deepEqual(await faucet(origin, 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn'), notOurs, 'good on regtest, but not a bcrt1 address');
  assert.deepEqual(await faucet(origin, 12345), notOurs);
  // Only text can be an address. A list that holds a good address is not one, and neither is a thing
  // that JavaScript cannot make text of at all (the bots are written in Python, which can).
  assert.deepEqual(await faucet(origin, [receive(0).address]), notOurs);
  assert.deepEqual(await faucet(origin, { toString: 1 }), notOurs);
  assert.deepEqual(await faucet(origin, null), notOurs);

  const address = receive(0).address;
  const paid = await faucet(origin, `  ${address}\n`); // white space around it is dropped, as bots.py drops it
  assert.deepEqual(paid, { status: 200, contentType: 'application/json', body: { txid: paid.body.txid, amount_sats: 100_000, pot_coin: null } });
  assert.deepEqual(await esplora.addressUtxos(address), [{ txid: paid.body.txid, vout: 1, status: { confirmed: false }, value: 100_000 }]);

  // The faucet's own change address is one of the network's own.
  const changeAddress = (await esplora.tx(paid.body.txid)).vout[0]?.scriptpubkey_address;
  assert.deepEqual(await faucet(origin, changeAddress), {
    status: 400,
    contentType: 'application/json',
    body: { error: "That address belongs to the practice network's own wallets", code: 'own_address' },
  });

  const already = { status: 429, contentType: 'application/json', body: { error: 'This address already got practice coins today', code: 'already_paid' } };
  assert.deepEqual(await faucet(origin, address), already);
  clock.ms += 24 * 3600 * 1000 - 1000;
  assert.deepEqual(await faucet(origin, address), already, 'one second short of a day');
  clock.ms += 1000;
  const again = await faucet(origin, address);
  assert.equal(again.status, 200);
  assert.notEqual(again.body.txid, paid.body.txid);
  // Another address is paid at any time, and the next payment has its coin at the other position.
  assert.equal((await faucet(origin, receive(1).address)).status, 200);
  assert.deepEqual((await esplora.addressUtxos(receive(1).address)).map((coin) => coin.vout), [1]);
  assert.deepEqual((await esplora.addressUtxos(address)).map((coin) => coin.vout), [1, 0]);

  // What it pays is the caller's to set.
  const half = standIn({ faucetSats: 50_000 });
  assert.equal((await faucet(half.origin, address)).body.amount_sats, 50_000);
  assert.equal((await half.esplora.addressUtxos(address))[0]?.value, 50_000);
});

test('setFaucet: busy, refilling and failed, after the address checks', async () => {
  const { origin } = standIn();
  const address = receive(0).address;
  assert.equal((await faucet(origin, receive(1).address)).status, 200);

  const modes = [
    ['busy', 429, 'The faucet is busy; try again in a minute'],
    ['refilling', 503, 'The faucet is refilling; try again in a minute'],
    ['failed', 500, 'The faucet could not finish that payment'],
  ] as const;
  for (const [mode, status, error] of modes) {
    origin.setFaucet(mode);
    assert.deepEqual(await faucet(origin, address), { status, contentType: 'application/json', body: { error, code: mode } });
    // The checks that come first in bots.py still come first.
    assert.equal((await faucet(origin, 'nonsense')).body.code, 'bad_address');
    assert.equal((await faucet(origin, receive(1).address)).body.code, 'already_paid');
    // Nothing else is touched.
    assert.equal((await ask(origin, 'GET /bots/pot/address', { token: origin.token })).status, 200);
    assert.equal((await ask(origin, 'GET /esplora/blocks/tip/height')).status, 200);
  }
  assert.equal((await ask(origin, `GET /esplora/address/${address}`)).body.mempool_stats.tx_count, 0, 'a refusal pays nothing');

  origin.setFaucet('ok');
  assert.equal((await faucet(origin, address)).status, 200);
  assert.throws(() => origin.setFaucet('bussy' as never), /no such mode/);
});

test('setFaucet("down"): the bots are stopped, and the chain goes on answering', async () => {
  const { origin, esplora } = standIn();
  const address = receive(0).address;
  origin.setFaucet('down');

  // The router finds nobody to pass a bots request on to, and answers for itself: 502, a page, its own header.
  const body = JSON.stringify({ address });
  for (const route of ['POST /bots/faucet', 'GET /bots/pot/address', 'GET /bots/pot/stats', 'GET /bots/health', 'GET /bots/nothing']) {
    const answer = await ask(origin, route, { token: origin.token, body: route.startsWith('POST') ? body : undefined });
    assert.deepEqual([answer.status, answer.contentType], [502, 'text/html'], route);
    assert.match(answer.body, /<title>502 Bad Gateway<\/title>/, route);
  }
  assert.equal((await origin.fetch(`${BASE}/bots/health`)).headers.get('x-robots-tag'), 'noindex, nofollow');
  // The router's own rules still come first.
  assert.equal((await ask(origin, 'DELETE /bots/faucet')).status, 403);

  // The chain is not the bots'. Esplora answers, blocks come, and a coin can still arrive.
  assert.equal(await esplora.tipHeight(), 101);
  assert.deepEqual(await esplora.addressUtxos(address), [], 'the faucet paid nothing');
  const arrived = origin.fund(address, 100_000n, { confirmed: false });
  assert.equal(origin.mine(), 102);
  assert.deepEqual((await esplora.addressUtxos(address)).map((coin) => [coin.txid, coin.status.block_height]), [[arrived, 102]]);

  // Started again, the bots answer as before, and the address has not had its turn.
  origin.setFaucet('ok');
  assert.equal((await ask(origin, 'GET /bots/health')).status, 200);
  assert.equal((await faucet(origin, address)).status, 200);
});

// -- the pot ----------------------------------------------------------------------

test('the pot address stays the same until a transaction pays it', async () => {
  const { origin, esplora } = standIn();
  const first = await potAddress(origin);
  assert.equal(await potAddress(origin), first);
  origin.mine(3);
  assert.equal(await potAddress(origin), first, 'blocks do not change it');

  // A learner passes coins on. The payment only waits, and the address has already had its turn.
  origin.fund(receive(0).address, 100_000n);
  const gift = buildPayment(account, await scanWallet(account, esplora), { to: first, amount: 30_000n, feeRate: 1n });
  await esplora.broadcast(gift.hex);
  const second = await potAddress(origin);
  assert.notEqual(second, first);
  assert.equal(await potAddress(origin), second);
  // Both are the network's own, to the faucet.
  assert.equal((await faucet(origin, first)).body.code, 'own_address');
  assert.equal((await faucet(origin, second)).body.code, 'own_address');
});

test('the faucet spends the oldest confirmed pot coin first, and says which', async () => {
  const { origin, esplora } = standIn();
  const stats = async () => (await ask(origin, 'GET /bots/pot/stats')).body;
  assert.deepEqual(await stats(), { learners_passed_on: 0, sats_received: 0, coins_waiting: 0, coins_passed_to_newcomers: 0, faucet_payments: 0 });

  // A learner passes on 30,000 sats.
  origin.fund(receive(0).address, 100_000n);
  const pot = await potAddress(origin);
  const gift = buildPayment(account, await scanWallet(account, esplora), { to: pot, amount: 30_000n, feeRate: 1n });
  await esplora.broadcast(gift.hex);

  // While the gift waits for a block, it is not the faucet's to spend.
  assert.equal((await faucet(origin, receive(10).address)).body.pot_coin, null);
  assert.deepEqual(await stats(), { learners_passed_on: 0, sats_received: 0, coins_waiting: 0, coins_passed_to_newcomers: 0, faucet_payments: 1 });

  origin.mine();
  // A second, bigger gift, one block later: 150,000 sats to the pot's next address.
  const bigGift = origin.fund(await potAddress(origin), 150_000n);
  assert.deepEqual(await stats(), { learners_passed_on: 2, sats_received: 180_000, coins_waiting: 2, coins_passed_to_newcomers: 0, faucet_payments: 1 });

  // The older coin goes first. It is too small to pay 100,000 sats, so the faucet adds a coin of its own after it.
  const older = await faucet(origin, receive(11).address);
  const giftOutput = (await esplora.tx(gift.txid)).vout.findIndex((output) => output.scriptpubkey_address === pot);
  assert.deepEqual(older.body.pot_coin, { txid: gift.txid, vout: giftOutput, sats: 30_000 });
  const passedOn = await esplora.tx(older.body.txid);
  assert.equal(passedOn.status.confirmed, false, 'a new waiting transaction');
  assert.deepEqual([passedOn.vin[0]?.txid, passedOn.vin[0]?.vout, passedOn.vin[0]?.prevout?.scriptpubkey_address], [gift.txid, giftOutput, pot]);
  assert.equal(passedOn.vin.length, 2);
  assert.ok(passedOn.vout.some((output) => output.scriptpubkey_address === receive(11).address && output.value === 100_000));

  // Then the newer one, which is enough by itself: one coin in, the payment and the change out.
  const newer = await faucet(origin, receive(12).address);
  assert.equal(newer.body.pot_coin.txid, bigGift);
  assert.equal(newer.body.pot_coin.sats, 150_000);
  const alone = await esplora.tx(newer.body.txid);
  assert.deepEqual(alone.vin.map((input) => input.txid), [bigGift]);
  assert.deepEqual(alone.vout.map((output) => output.value).sort((a, b) => a - b), [150_000 - 100_000 - alone.fee, 100_000]);

  // No pot coin is left: the next payment is the faucet's own money again.
  assert.equal((await faucet(origin, receive(13).address)).body.pot_coin, null);
  assert.deepEqual(await stats(), { learners_passed_on: 2, sats_received: 180_000, coins_waiting: 0, coins_passed_to_newcomers: 2, faucet_payments: 4 });

  const health = await ask(origin, 'GET /bots/health');
  assert.deepEqual(Object.keys(health.body), ['height', 'block_age_seconds', 'esplora_height', 'faucet_sats', 'faucet_pending_sats', 'disk_used_pct']);
  assert.deepEqual([health.body.height, health.body.esplora_height, health.body.block_age_seconds], [origin.height(), origin.height(), 0]);

  // A pot coin that would leave change too small to be a coin: the change goes to the fee.
  origin.fund(await potAddress(origin), 100_300n);
  const exact = await esplora.tx((await faucet(origin, receive(14).address)).body.txid);
  assert.deepEqual([exact.vin.length, exact.vout.map((output) => output.value), exact.fee], [1, [100_000], 300]);
});

// -- the controls -----------------------------------------------------------------

test('mine(): every waiting transaction goes in the first block, and each block moves time on 30 seconds', async () => {
  const { origin, clock, esplora } = standIn({ height: 500 });
  assert.equal(origin.height(), 500);
  assert.equal(await esplora.tipHeight(), 500);
  const a = origin.fund(receive(0).address, 10_000n, { confirmed: false });
  const b = origin.fund(receive(1).address, 20_000n, { confirmed: false });

  assert.equal(origin.mine(), 501);
  assert.equal(origin.mine(3), 504);
  assert.equal(await esplora.tipHeight(), 504);
  for (const txid of [a, b]) {
    const { status } = await esplora.tx(txid);
    assert.deepEqual([status.confirmed, status.block_height, status.block_time], [true, 501, START + 30]);
  }
  // Four blocks, 30 seconds each, on a clock that stood still: the faucet's day runs on the same time.
  const late = origin.fund(receive(2).address, 30_000n);
  assert.deepEqual((await esplora.tx(late)).status.block_time, START + 5 * 30);
  assert.equal((await ask(origin, 'GET /bots/health')).body.block_age_seconds, 0);

  // The clock moves on an hour, and the chain's time with it. The 150 seconds that mining added stay added.
  clock.ms += 3_600_000;
  assert.equal((await ask(origin, 'GET /bots/health')).body.block_age_seconds, 3_600);
  // A block that is due carries the time it was made. One asked for straight after it comes 30 seconds later.
  const due = origin.fund(receive(5).address, 5_000n, { confirmed: false });
  origin.mine();
  assert.equal((await esplora.tx(due)).status.block_time, START + 5 * 30 + 3_600);
  const next = origin.fund(receive(3).address, 40_000n);
  assert.equal((await esplora.tx(next)).status.block_time, START + 5 * 30 + 3_600 + 30);

  // Mining alone lets a day pass for the faucet.
  assert.equal((await faucet(origin, receive(4).address)).status, 200);
  origin.mine(2 * 60 * 24 - 1);
  assert.equal((await faucet(origin, receive(4).address)).body.code, 'already_paid');
  origin.mine();
  assert.equal((await faucet(origin, receive(4).address)).status, 200);

  // And a day on the caller's clock is a day for the faucet, however far mining has moved the time on.
  clock.ms += 24 * 3600 * 1000 - 1000;
  assert.equal((await faucet(origin, receive(4).address)).body.code, 'already_paid', 'one second short of a day');
  clock.ms += 1000;
  assert.equal((await faucet(origin, receive(4).address)).status, 200);
});

test('setEsploraLag(): Esplora hears of a faucet payment some seconds after the faucet has answered', async () => {
  const { origin, clock, esplora } = standIn();
  const me = receive(0).address;
  // A coin of the stand-in's own wallet, to watch: the change of a payment made before there was any lag.
  const earlier = await esplora.tx(origin.fund(receive(5).address, 50_000n));
  const own = earlier.vout.find((output) => output.scriptpubkey_address !== receive(5).address)?.scriptpubkey_address;
  assert.ok(own);
  assert.equal((await esplora.addressUtxos(own)).length, 1);

  origin.setEsploraLag(5);
  const paid = await faucet(origin, me);
  assert.equal(paid.status, 200);

  // The faucet has answered and Esplora has not heard yet. To Esplora this is a transaction
  // nobody has seen, the address has no history, and the coin the faucet spent is still there.
  const unheard = async (txid: string, address: string) => {
    assertRecorded(await ask(origin, `GET /esplora/tx/${txid}`), recorded(samples, 'a transaction nobody has seen'));
    assertRecorded(await ask(origin, `GET /esplora/address/${address}`), recorded(samples, 'an address with no history'), (body) => ({ ...body, address }));
    assertRecorded(await ask(origin, `GET /esplora/address/${address}/utxo`), recorded(samples, 'coins of an address with no history'));
    assertRecorded(await ask(origin, `GET /esplora/address/${address}/txs`), recorded(samples, 'transactions of an address with no history'));
  };
  await unheard(paid.body.txid, me);
  assert.equal((await esplora.addressUtxos(own)).length, 1);
  // The bots ask the node, not Esplora: to them the payment is made.
  assert.equal((await faucet(origin, me)).body.code, 'already_paid');
  assert.equal((await ask(origin, 'GET /bots/pot/stats')).body.faucet_payments, 1);

  clock.ms += 4_999;
  await unheard(paid.body.txid, me);
  clock.ms += 1;
  assert.deepEqual((await esplora.tx(paid.body.txid)).status, { confirmed: false });
  assertRecorded(await ask(origin, `GET /esplora/address/${me}`), recorded(samples, 'an address with an unconfirmed payment'), (body) => ({ ...body, address: me }));
  assert.deepEqual((await esplora.addressUtxos(me)).map((coin) => [coin.txid, coin.value, coin.status.confirmed]), [[paid.body.txid, 100_000, false]]);
  assert.deepEqual((await esplora.addressTxs(me)).map((tx) => tx.txid), [paid.body.txid]);
  assert.deepEqual(await esplora.addressUtxos(own), [], 'now Esplora knows the coin is spent');

  // A block ends the wait, however long it would have been, for the faucet's payments and for fund()'s waiting ones.
  origin.setEsploraLag(3_600);
  const second = await faucet(origin, receive(1).address);
  const third = origin.fund(receive(2).address, 30_000n, { confirmed: false });
  await unheard(second.body.txid, receive(1).address);
  await unheard(third, receive(2).address);
  const height = origin.mine();
  for (const txid of [second.body.txid, third]) assert.equal((await esplora.tx(txid)).status.block_height, height);
  // A funded coin that is confirmed has its block from the start.
  assert.equal((await esplora.tx(origin.fund(receive(3).address, 20_000n))).status.confirmed, true);
  origin.setEsploraLag(5);

  // What is sent through Esplora itself, Esplora knows at once.
  const payment = buildPayment(account, await scanWallet(account, esplora), { to: SOMEONE, amount: 60_000n, feeRate: 2n });
  assert.equal(await esplora.broadcast(payment.hex), payment.txid);
  assert.deepEqual((await esplora.tx(payment.txid)).status, { confirmed: false });
  assert.equal((await esplora.address(SOMEONE)).mempool_stats.tx_count, 1);

  // The lag is for payments made from now on, and can be set back.
  const fourth = await faucet(origin, receive(4).address);
  origin.setEsploraLag(0);
  await unheard(fourth.body.txid, receive(4).address);
  const fifth = await faucet(origin, receive(6).address);
  assert.deepEqual((await esplora.tx(fifth.body.txid)).status, { confirmed: false });
  clock.ms += 5_000;
  assert.deepEqual((await esplora.tx(fourth.body.txid)).status, { confirmed: false });

  for (const wrong of [-1, Number.NaN, Number.POSITIVE_INFINITY, '5']) {
    assert.throws(() => origin.setEsploraLag(wrong as never), /not a number of seconds/, String(wrong));
  }
});

test('fund(): a confirmed coin in a block of its own, or a waiting one', async () => {
  const { origin, esplora } = standIn();
  const waiting = origin.fund(receive(0).address, 70_000n, { confirmed: false });
  assert.equal(origin.height(), 101);
  assert.deepEqual((await esplora.tx(waiting)).status, { confirmed: false });

  const confirmed = origin.fund(receive(1).address, 80_000n);
  assert.equal(origin.height(), 102, 'a confirmed coin needs a block');
  assert.equal((await esplora.tx(confirmed)).status.block_height, 102);
  assert.deepEqual((await esplora.tx(waiting)).status, { confirmed: false }, 'the block holds nothing else');

  // An ordinary payment: a coin in, the amount to the address, a fee.
  const tx = await esplora.tx(confirmed);
  assert.equal(tx.vin[0]?.is_coinbase, false);
  assert.ok(tx.vout.some((output) => output.scriptpubkey_address === receive(1).address && output.value === 80_000));
  assert.ok(tx.fee > 0);
  // Where its coin came from can be followed back to a coinbase.
  const source = await esplora.tx(tx.vin[0]!.txid);
  assert.deepEqual([source.vin[0]?.is_coinbase, source.vin[0]?.prevout, source.status.confirmed], [true, null, true]);
  assert.equal('witness' in (source.vin[0] ?? {}), false, 'Esplora leaves the field out when an input has no witness');

  // Any kind of address, and far more than the stand-in's wallet starts with.
  assert.equal((await esplora.addressUtxos(TAPROOT)).length, 0);
  origin.fund(TAPROOT, 330n);
  origin.fund(TAPROOT, 2_100_000_000_000n);
  assert.deepEqual((await esplora.addressUtxos(TAPROOT)).map((coin) => coin.value), [330, 2_100_000_000_000]);

  assert.throws(() => origin.fund('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 1_000n), /Address on invalid network/);
  assert.throws(() => origin.fund(receive(0).address, 100n), /dust/, 'it goes through the same door as a broadcast');
});

test('setOrigin(): down, redirect and forbidden on every route, and back', async () => {
  const { origin } = standIn();
  const routes = [
    'GET /esplora/blocks/tip/height',
    `GET /esplora/address/${SOMEONE}`,
    'POST /esplora/tx',
    'GET /bots/health',
    'GET /bots/pot/address',
    'POST /bots/faucet',
    'GET /elsewhere',
  ];
  const expected = { down: 502, redirect: 302, forbidden: 403 } as const;
  for (const mode of ['down', 'redirect', 'forbidden'] as const) {
    origin.setOrigin(mode);
    for (const route of routes) {
      const answer = await ask(origin, route, { token: origin.token, body: route.startsWith('POST') ? '00' : undefined });
      assert.deepEqual([answer.status, answer.contentType], [expected[mode], 'text/html'], `${mode}: ${route}`);
    }
  }
  origin.setOrigin('redirect');
  const redirect = await origin.fetch(`${BASE}/esplora/blocks/tip/height`, { redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), 'https://login.invalid/cdn-cgi/access/login');

  origin.setOrigin('ok');
  assert.deepEqual(await ask(origin, 'GET /esplora/blocks/tip/height'), { status: 200, contentType: 'text/plain', body: '101' });
  assert.throws(() => origin.setOrigin('offline' as never), /no such mode/);

  // The router itself: two prefixes, GET and POST only.
  for (const outside of ['GET /elsewhere', 'GET /esplora', 'POST /botsfaucet']) {
    const answer = await ask(origin, outside);
    assert.deepEqual([answer.status, answer.contentType], [404, 'text/html'], outside);
  }
  assert.equal((await ask(origin, 'DELETE /esplora/blocks/tip/height')).status, 403);
  assert.equal((await origin.fetch(`${BASE}/bots/health`)).headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('setOrigin("slow"): no answer until the caller aborts', { timeout: 10_000 }, async () => {
  const { origin } = standIn();
  origin.setOrigin('slow');
  const controller = new AbortController();
  let settled = false;
  const pending = origin.fetch(`${BASE}/esplora/blocks/tip/height`, { signal: controller.signal }).finally(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settled, false);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });

  // The Worker's way of giving up is a time limit. A garbage collection in
  // the middle of the wait must not lose it. (It did once: the wait hung on
  // an object that nothing else held on to.)
  v8.setFlagsFromString('--expose-gc');
  const collectGarbage: () => void = vm.runInNewContext('gc');
  const limited = origin.fetch(`${BASE}/bots/health`, { signal: AbortSignal.timeout(100) });
  await new Promise((resolve) => setTimeout(resolve, 10));
  collectGarbage();
  await assert.rejects(limited, { name: 'TimeoutError' });
  // A signal that has already aborted never gets as far as the origin.
  const before = origin.requests().length;
  await assert.rejects(origin.fetch(`${BASE}/bots/health`, { signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.equal(origin.requests().length, before);

  origin.setOrigin('ok');
  assert.equal((await ask(origin, 'GET /bots/health')).status, 200);
});

test('requests(): the method and path of every request, for counting polls', async () => {
  const { origin, esplora } = standIn();
  assert.deepEqual(origin.requests(), []);
  for (let i = 0; i < 3; i++) await esplora.tipHeight();
  await esplora.address(SOMEONE);
  await faucet(origin, SOMEONE);
  origin.setOrigin('down');
  await ask(origin, 'GET /esplora/blocks/tip/height?x=1');
  assert.deepEqual(origin.requests(), [
    { method: 'GET', path: '/esplora/blocks/tip/height' },
    { method: 'GET', path: '/esplora/blocks/tip/height' },
    { method: 'GET', path: '/esplora/blocks/tip/height' },
    { method: 'GET', path: `/esplora/address/${SOMEONE}` },
    { method: 'POST', path: '/bots/faucet' },
    { method: 'GET', path: '/esplora/blocks/tip/height' },
  ]);
  assert.equal(origin.requests().filter((request) => request.path === '/esplora/blocks/tip/height').length, 4);
  // The list handed out is a copy.
  origin.requests().length = 0;
  assert.equal(origin.requests().length, 6);
});

test('the seed decides everything that looks random; the clock decides the time', async () => {
  const run = async (options: FakeOriginOptions) => {
    const { origin, esplora } = standIn(options);
    const pot = await potAddress(origin);
    const paid = await faucet(origin, receive(0).address);
    origin.mine();
    return { pot, txid: paid.body.txid as string, status: (await esplora.tx(paid.body.txid)).status };
  };
  const [one, same, other] = [await run({ seed: 'one' }), await run({ seed: 'one' }), await run({ seed: 'two' })];
  assert.deepEqual(one, same);
  assert.notEqual(one.pot, other.pot);
  assert.notEqual(one.txid, other.txid);
  assert.notEqual(one.status.block_hash, other.status.block_hash);
  assert.deepEqual(await run({}), await run({}), 'the default seed is a seed too');

  // With no clock supplied, and only then, the time is the real one.
  const before = Math.floor(Date.now() / 1000);
  const real = makeFakeOrigin();
  const txid = real.fund(receive(0).address, 1_000n);
  const blockTime = (await new Esplora(`${BASE}/esplora`, real.fetch).tx(txid)).status.block_time ?? 0;
  assert.ok(blockTime >= before + 30 && blockTime <= Math.floor(Date.now() / 1000) + 30, `block time ${blockTime}`);
});

// -- over a socket ----------------------------------------------------------------

test('listen(): the same answers over real HTTP', async () => {
  const { origin } = standIn();
  const { url, close } = await origin.listen();
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const tip = await fetch(`${url}/esplora/blocks/tip/height`);
    assert.deepEqual([tip.status, tip.headers.get('content-type'), await tip.text()], [200, 'text/plain', '101']);

    // The faucet with its token, then the wallet's own client with the real fetch.
    const address = receive(0).address;
    const post = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }) };
    assert.equal((await fetch(`${url}/bots/faucet`, post)).status, 401);
    const paid = await fetch(`${url}/bots/faucet`, { ...post, headers: { ...post.headers, Authorization: `Bearer ${origin.token}` } });
    assert.deepEqual([paid.status, paid.headers.get('content-type')], [200, 'application/json']);
    const { txid } = (await paid.json()) as { txid: string };
    origin.mine();
    // The same body as a stream: no Content-Length on the wire, so the bots do not read it.
    const streamed = { ...post, headers: { Authorization: `Bearer ${origin.token}` }, body: new Blob([post.body]).stream(), duplex: 'half' };
    const unread = await fetch(`${url}/bots/faucet`, streamed as RequestInit);
    assert.deepEqual([unread.status, ((await unread.json()) as { code: string }).code], [400, 'bad_request']);

    const esplora = new Esplora(`${url}/esplora`);
    const state = await scanWallet(account, esplora);
    assert.deepEqual([state.confirmed, state.coins.map((coin) => coin.txid)], [100_000n, [txid]]);
    const payment = buildPayment(account, state, { to: SOMEONE, amount: 10_000n, feeRate: 3n });
    assert.equal(await esplora.broadcast(payment.hex), payment.txid);
    assert.equal((await esplora.tx(payment.txid)).status.confirmed, false);

    // A refusal keeps its status, its content type and the node's words.
    const refused = await fetch(`${url}/esplora/tx`, { method: 'POST', body: '00' });
    const record = recorded(refusals, 'not a transaction');
    assert.deepEqual([refused.status, refused.headers.get('content-type'), await refused.text()], [record.status, record.contentType, record.body]);

    // The failures the Worker has to map.
    origin.setOrigin('redirect');
    const redirect = await fetch(`${url}/esplora/blocks/tip/height`, { redirect: 'manual' });
    assert.deepEqual([redirect.status, redirect.headers.get('location')], [302, 'https://login.invalid/cdn-cgi/access/login']);
    await redirect.arrayBuffer();
    origin.setOrigin('down');
    assert.equal((await fetch(`${url}/bots/health`)).status, 502);
    origin.setOrigin('slow');
    await assert.rejects(fetch(`${url}/esplora/blocks/tip/height`, { signal: AbortSignal.timeout(150) }), { name: 'TimeoutError' });
    origin.setOrigin('ok');

    assert.equal(origin.requests().filter((request) => request.path === '/esplora/blocks/tip/height').length, 3);
  } finally {
    await close();
  }
  await assert.rejects(fetch(`${url}/esplora/blocks/tip/height`), 'closed: nothing answers');
});
