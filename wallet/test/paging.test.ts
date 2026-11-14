// An address with more transactions than Esplora lists at once.
//
// What the practice network does was measured (e2e/fixtures/address-lists.json):
// GET /address/<a>/txs lists 50 at most, the unconfirmed ones first, then the
// confirmed ones, newest first. The older confirmed ones come from
// GET /address/<a>/txs/chain/<txid>, 25 after the one named, and an empty list
// is the end. The stand-in server in helpers.ts hands out pages the same way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Esplora,
  EsploraError,
  deriveAddress,
  ownAddresses,
  scanWallet,
  viewTx,
  walletHistory,
  watchOnlyAccount,
  type EsploraTx,
  type FetchLike,
} from '../src/index.ts';
import { V, coinAt, fakeEsplora, stateOf, tooManyUtxos } from './helpers.ts';

const watch = watchOnlyAccount(V.abandon.xpub);
/** The busy address, and a quiet one beside it. */
const BUSY = deriveAddress(watch, 0, 0).address;
const QUIET = deriveAddress(watch, 0, 1).address;
const ELSEWHERE = V.prf.wallet.receive[0] as string;

const idOf = (n: number): string => n.toString(16).padStart(64, '0');
const numberOf = (tx: { txid: string }): number => Number.parseInt(tx.txid, 16);

/** Payment number n to an address: 600 sats from somebody else. In a block at `height`, or unconfirmed. */
function payment(n: number, height: number | undefined, to = BUSY): EsploraTx {
  return {
    txid: idOf(n),
    version: 2,
    locktime: 0,
    vin: [
      {
        txid: idOf(1_000_000 + n),
        vout: 0,
        prevout: { scriptpubkey: `0014${'00'.repeat(20)}`, scriptpubkey_address: ELSEWHERE, value: 1_000 },
        is_coinbase: false,
        sequence: 4294967293,
      },
    ],
    vout: [{ scriptpubkey: `0014${'11'.repeat(20)}`, scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: to, value: 600 }],
    size: 110,
    weight: 437,
    fee: 400,
    status: height === undefined ? { confirmed: false } : { confirmed: true, block_height: height, block_time: 1_794_000_000 + height * 30 },
  };
}

/** The whole numbers from `from` to `to`, both included, counting up or down. */
function range(from: number, to: number): number[] {
  const step = from <= to ? 1 : -1;
  return Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => from + i * step);
}

/**
 * An address's list as the server keeps it: the unconfirmed ones in the order
 * they arrived, then the confirmed ones, newest first. Payment 1 is the
 * oldest. The confirmed ones sit one to a block, from height 101.
 */
function listed(confirmed: number, unconfirmed: number): EsploraTx[] {
  return [
    ...(unconfirmed === 0 ? [] : range(confirmed + 1, confirmed + unconfirmed)).map((n) => payment(n, undefined)),
    ...(confirmed === 0 ? [] : range(confirmed, 1)).map((n) => payment(n, 100 + n)),
  ];
}

const txsPath = `GET /address/${BUSY}/txs`;
const chainPath = (after?: number): string => `GET /address/${BUSY}/txs/chain${after === undefined ? '' : `/${idOf(after)}`}`;

test('addressTxsAll: a list that fits the first page costs one request', async () => {
  for (const [confirmed, unconfirmed] of [[0, 0], [1, 0], [0, 1], [20, 5], [49, 0], [0, 49], [24, 25]] as const) {
    const { esplora, calls } = fakeEsplora({ [BUSY]: { txs: listed(confirmed, unconfirmed) } });
    const all = await esplora.addressTxsAll(BUSY);
    assert.deepEqual(all, listed(confirmed, unconfirmed), `${confirmed} confirmed, ${unconfirmed} unconfirmed`);
    assert.deepEqual(calls, [txsPath], `${confirmed} confirmed, ${unconfirmed} unconfirmed`);
  }
});

test('addressTxsAll: as the practice network was measured, 30 unconfirmed and 30 confirmed are 50, then 10', async () => {
  const { esplora, calls } = fakeEsplora({ [BUSY]: { txs: listed(30, 30) } });
  // The first page alone, as before: all 30 unconfirmed, and the newest 20 of the confirmed.
  assert.deepEqual((await esplora.addressTxs(BUSY)).map(numberOf), [...range(31, 60), ...range(30, 11)]);
  calls.length = 0;

  const all = await esplora.addressTxsAll(BUSY);
  assert.deepEqual(all.map(numberOf), [...range(31, 60), ...range(30, 1)], 'all 60, each once, in the order Esplora lists them');
  // The page was full, so the older ones are asked for by the last confirmed one on it: payment 11.
  assert.deepEqual(calls, [txsPath, chainPath(11)]);
  assert.deepEqual(all, listed(30, 30), 'each transaction as the server gave it');
});

test('addressTxsAll: 60 confirmed are 50, then 10; and 130 are 50, 25, 25, 25, then 5', async () => {
  const sixty = fakeEsplora({ [BUSY]: { txs: listed(60, 0) } });
  assert.deepEqual((await sixty.esplora.addressTxsAll(BUSY)).map(numberOf), range(60, 1));
  assert.deepEqual(sixty.calls, [txsPath, chainPath(11)]);

  const many = fakeEsplora({ [BUSY]: { txs: listed(130, 0) } });
  assert.deepEqual((await many.esplora.addressTxsAll(BUSY)).map(numberOf), range(130, 1));
  // Each page is asked for by the last transaction of the page before.
  assert.deepEqual(many.calls, [txsPath, chainPath(81), chainPath(56), chainPath(31), chainPath(6)]);

  // With some of them unconfirmed, the confirmed ones are still paged from the last confirmed one of the first page.
  const mixed = fakeEsplora({ [BUSY]: { txs: listed(100, 30) } });
  assert.deepEqual((await mixed.esplora.addressTxsAll(BUSY)).map(numberOf), [...range(101, 130), ...range(100, 1)]);
  assert.deepEqual(mixed.calls, [txsPath, chainPath(81), chainPath(56), chainPath(31), chainPath(6)]);
});

test('addressTxsAll: a page that is exactly full is followed by one more question, answered with an empty list', async () => {
  // 50 in all: the first page is full, so there may be more. There are none.
  const fifty = fakeEsplora({ [BUSY]: { txs: listed(50, 0) } });
  assert.deepEqual((await fifty.esplora.addressTxsAll(BUSY)).map(numberOf), range(50, 1));
  assert.deepEqual(fifty.calls, [txsPath, chainPath(1)]);

  // 75: the second page is full as well.
  const more = fakeEsplora({ [BUSY]: { txs: listed(75, 0) } });
  assert.deepEqual((await more.esplora.addressTxsAll(BUSY)).map(numberOf), range(75, 1));
  assert.deepEqual(more.calls, [txsPath, chainPath(26), chainPath(1)]);

  // One short of a full first page: nothing more is asked.
  const short = fakeEsplora({ [BUSY]: { txs: listed(49, 0) } });
  assert.equal((await short.esplora.addressTxsAll(BUSY)).length, 49);
  assert.deepEqual(short.calls, [txsPath]);
});

test('addressTxsAll: a first page of 50 unconfirmed holds no confirmed one to ask by, so the confirmed ones are read from the top', async () => {
  const { esplora, calls } = fakeEsplora({ [BUSY]: { txs: listed(40, 50) } });
  const all = await esplora.addressTxsAll(BUSY);
  assert.deepEqual(all.map(numberOf), [...range(41, 90), ...range(40, 1)]);
  assert.deepEqual(calls, [txsPath, chainPath(), chainPath(16)]);

  // 50 unconfirmed and nothing confirmed at all: one more question, and its answer is empty.
  const none = fakeEsplora({ [BUSY]: { txs: listed(0, 50) } });
  assert.deepEqual((await none.esplora.addressTxsAll(BUSY)).map(numberOf), range(1, 50));
  assert.deepEqual(none.calls, [txsPath, chainPath()]);

  // More than 50 unconfirmed: the first page lists the first 50, and the further pages asked for
  // here hold confirmed ones only. (The Esplora server gives more of a list to a question with a
  // query string, "?after_txid=" or "?max_txs=". The app's server passes on no such question.)
  // The 51st and later are not seen until a block holds them (see addressTxsAll in esplora.ts).
  const flood = fakeEsplora({ [BUSY]: { txs: listed(10, 55) } });
  assert.deepEqual((await flood.esplora.addressTxsAll(BUSY)).map(numberOf), [...range(11, 60), ...range(10, 1)]);
});

test('addressTxsAll: each transaction once; if a block arrives between two answers, the confirmed copy is kept', async () => {
  // 50 unconfirmed, 30 confirmed. After the first answer a block takes the 50: the second answer
  // lists the newest 25 of them as confirmed, and the third the other 25, and so on down.
  const chain = fakeEsplora({ [BUSY]: { txs: listed(30, 50) } });
  const answer = chain.esplora.addressTxs.bind(chain.esplora);
  chain.esplora.addressTxs = async (address) => {
    const first = await answer(address);
    chain.known[BUSY]!.txs = listed(80, 0); // the block: all 80 are confirmed now, one to a block as listed() has them
    return first;
  };
  const all = await chain.esplora.addressTxsAll(BUSY);
  assert.deepEqual(all.map(numberOf), range(80, 1), 'all 80, each once, as the later answers list them');
  assert.ok(all.every((tx) => tx.status.confirmed), 'the confirmed copies');
  assert.deepEqual(chain.calls, [txsPath, chainPath(), chainPath(56), chainPath(31), chainPath(6)]);

  // The other way about never happens on a chain that only grows, but a copy that says less is not preferred either.
  const odd = fakeEsplora({});
  const pages: EsploraTx[][] = [
    listed(50, 0),
    [...range(49, 26).map((n) => payment(n, undefined)), payment(25, 125)],
    [],
  ];
  const fetchFn: FetchLike = async () => Response.json(pages.shift() ?? []);
  const kept = await new Esplora(odd.esplora.baseUrl, fetchFn).addressTxsAll(BUSY);
  assert.deepEqual(kept.map(numberOf), range(50, 1));
  assert.ok(kept.every((tx) => tx.status.confirmed));
});

test('addressTxsAll: at most 40 answers are read for one address, which is its newest 1,025 transactions', async () => {
  const { esplora, calls } = fakeEsplora({ [BUSY]: { txs: listed(2_000, 0) } });
  const all = await esplora.addressTxsAll(BUSY);
  assert.equal(calls.length, 40);
  assert.equal(all.length, 50 + 39 * 25);
  assert.deepEqual(all.map(numberOf), range(2_000, 976), 'the newest ones: what is left out is the oldest');
  assert.equal(new Set(calls).size, 40, 'no page was asked for twice');

  // One fewer than that limit holds is read to its end, with the last answer a short one.
  const under = fakeEsplora({ [BUSY]: { txs: listed(1_024, 0) } });
  assert.equal((await under.esplora.addressTxsAll(BUSY)).length, 1_024);
  assert.equal(under.calls.length, 40);
  const exactly = fakeEsplora({ [BUSY]: { txs: listed(1_025, 0) } });
  assert.equal((await exactly.esplora.addressTxsAll(BUSY)).length, 1_025);
  assert.equal(exactly.calls.length, 40, 'the empty page that would end it is not asked for');

  // A server that answers every question with a full page of the same transactions cannot keep the wallet asking.
  let asked = 0;
  const stuck: FetchLike = async () => {
    asked += 1;
    return Response.json(listed(50, 0));
  };
  assert.equal((await new Esplora('https://example.test/api', stuck).addressTxsAll(BUSY)).length, 50);
  assert.equal(asked, 40);
});

test('addressTxsAll: only the three shapes are asked for, and a page that fails fails the whole call', async () => {
  const { esplora, calls } = fakeEsplora({ [BUSY]: { txs: listed(90, 20) } });
  await esplora.addressTxsAll(BUSY);
  assert.ok(calls.length > 2);
  for (const call of calls) assert.match(call, /^GET \/address\/bcrt1[0-9a-z]+\/txs(\/chain(\/[0-9a-f]{64})?)?$/);

  // The second page is refused: half a list is never handed back as if it were whole.
  let asked = 0;
  const failing: FetchLike = async (url) => {
    asked += 1;
    return url.endsWith('/txs') ? Response.json(listed(60, 0).slice(0, 50)) : new Response('{"error":"limit"}', { status: 429 });
  };
  await assert.rejects(
    new Esplora('https://example.test/api', failing).addressTxsAll(BUSY),
    (error: unknown) => error instanceof EsploraError && error.status === 429 && error.message.includes(`/address/${BUSY}/txs/chain/${idOf(11)}`),
  );
  assert.equal(asked, 2);
});

test('walletHistory reads every page: an address in 130 transactions shows all 130, each once, beside the rest of the wallet', async () => {
  const account = watch;
  const busy = listed(100, 30);
  // One of the 130 also pays the quiet address, and the quiet address has a payment of its own.
  const shared = busy.find((tx) => numberOf(tx) === 7)!;
  shared.vout.push({ scriptpubkey: `0014${'22'.repeat(20)}`, scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: QUIET, value: 300 });
  const own = payment(500, 300, QUIET);
  const chain = fakeEsplora({ [BUSY]: { txs: busy }, [QUIET]: { txs: [own, shared] } });
  const state = stateOf([coinAt(account, 0, 0, 600n, { txid: idOf(1) }), coinAt(account, 0, 1, 600n, { txid: idOf(500) })]);

  const history = await walletHistory(state, chain.esplora);
  assert.equal(history.length, 131);
  assert.equal(new Set(history.map((view) => view.txid)).size, 131, 'each transaction once');
  // Newest first: the unconfirmed ones (payments 101 to 130), then by block from the top down.
  assert.deepEqual(new Set(history.slice(0, 30).map(numberOf)), new Set(range(101, 130)));
  assert.ok(history.slice(0, 30).every((view) => !view.confirmed));
  assert.deepEqual(history.slice(30).map(numberOf), [500, ...range(100, 1)]);
  assert.ok(history.every((view) => view.direction === 'received'));
  assert.equal(history.find((view) => numberOf(view) === 7)?.net, 900n, 'the payment to both addresses is one entry, with both outputs counted');
  assert.deepEqual(history.at(-1), viewTx(busy.at(-1)!, ownAddresses(state)));

  assert.deepEqual(
    [...chain.calls].sort(),
    [txsPath, chainPath(81), chainPath(56), chainPath(31), chainPath(6), `GET /address/${QUIET}/txs`].sort(),
    'five answers for the busy address, one for the quiet one',
  );
});

test('the unspent coins are another list, with a limit of its own: an address refused it fails the whole scan, while its past payments still read', async () => {
  // The claim this pins: the coins and the total do not come from the list of transactions, so a
  // long list cannot hurt them. But the list they do come from (GET /address/<a>/utxo) has no
  // pages. By the Esplora server's source it is refused whole, with a 400, for an address that
  // holds more than 500 unspent coins in blocks. Read, not measured on the practice network: the
  // stand-in server here refuses only because this test asks it to.
  const coins = (count: number) => range(1, count).map((n) => ({ txid: idOf(n), vout: 0, value: 600, height: 100 + n }));
  const paidTimes = (count: number) => fakeEsplora({ [BUSY]: { txCount: count, txs: listed(count, 0), utxos: coins(count) } }, { utxosLimit: 500 });

  // 500 coins at one address: the scan reads them all, in one answer.
  const atLimit = paidTimes(500);
  const state = await scanWallet(watch, atLimit.esplora);
  assert.deepEqual([state.coins.length, state.confirmed], [500, 300_000n]);
  assert.equal(atLimit.calls.filter((call) => call.endsWith('/utxo')).length, 1, 'one request: the list has no pages');

  // The 501st: the list is refused, not cut short, and the scan fails as a whole. No coins and
  // no total come back, not even for the wallet's other addresses.
  const over = paidTimes(501);
  over.known[QUIET] = { txCount: 1, utxos: [{ txid: idOf(900), vout: 0, value: 5_000, height: 300 }] };
  await assert.rejects(
    scanWallet(watch, over.esplora),
    (error: unknown) =>
      error instanceof EsploraError && error.status === 400 && error.message.endsWith(`/address/${BUSY}/utxo failed (400): ${tooManyUtxos(500)}`),
  );
  assert.equal(tooManyUtxos(500), 'Too many unspent transaction outputs (>500). Contact support to raise limits.');

  // The address's past payments are untouched by that: all 501 are read, page by page (50, then 18 pages of 25, then 1).
  over.calls.length = 0;
  const history = await walletHistory(stateOf([coinAt(watch, 0, 0, 600n, { txid: idOf(1) })]), over.esplora);
  assert.equal(history.length, 501);
  assert.equal(over.calls.length, 20);
  assert.ok(over.calls.every((call) => call.includes('/txs')));

  // A coin that still waits for a block does not count toward the limit (the server adds those afterwards).
  const waiting = fakeEsplora(
    { [BUSY]: { txCount: 500, mempoolTxCount: 1, utxos: [...coins(500), { txid: idOf(501), vout: 0, value: 600 }] } },
    { utxosLimit: 500 },
  );
  assert.equal((await scanWallet(watch, waiting.esplora)).coins.length, 501);
});
