// Measures how the practice network's Esplora server lists an address with
// many transactions: how many it returns at once, in what order, and how the
// rest is reached. Also asks the node whether it relays payments to a
// pay-to-anchor output and to a later witness version.
//
// It makes a throwaway wallet, takes one faucet payment and sends 60 small
// payments to one of its own addresses, in two runs with a block between.
//
//   PRACTICE_SSH=<alias> tools/integration/run-live.sh tools/integration/address-lists.ts [out.json]
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { RBF_SEQUENCE, REGTEST, accountFromMnemonic, deriveAddress, newMnemonic, privateKeyAt } from '../../wallet/src/index.ts';

const requireFromWallet = createRequire(new URL('../../wallet/package.json', import.meta.url));
const { Transaction } = (await import(requireFromWallet.resolve('@scure/btc-signer'))) as typeof import('../../wallet/node_modules/@scure/btc-signer/index.js');
const { hex } = (await import(requireFromWallet.resolve('@scure/base'))) as typeof import('../../wallet/node_modules/@scure/base/index.js');

const { ESPLORA_URL, BOTS_URL, BOTS_API_TOKEN } = process.env;
if (!ESPLORA_URL || !BOTS_URL || !BOTS_API_TOKEN) throw new Error('Set ESPLORA_URL, BOTS_URL and BOTS_API_TOKEN');
const out = process.argv[2] ?? new URL('../../e2e/fixtures/address-lists.json', import.meta.url).pathname;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(path: string): Promise<{ status: number; type: string | null; text: string; ms: number }> {
  const t = Date.now();
  const res = await fetch(`${ESPLORA_URL}${path}`, { redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, type: res.headers.get('content-type'), text, ms: Date.now() - t };
}
async function post(hexTx: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`${ESPLORA_URL}/tx`, { method: 'POST', body: hexTx, headers: { 'Content-Type': 'text/plain' } });
  return { status: res.status, text: (await res.text()).trim() };
}
async function until<T>(what: string, seconds: number, probe: () => Promise<T | undefined>): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < seconds * 1000) {
    const v = await probe().catch(() => undefined);
    if (v !== undefined) {
      console.log(`  ${what} after ${((Date.now() - start) / 1000).toFixed(1)} s`);
      return v;
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for: ${what}`);
}
const confirmed = (txid: string) =>
  until(`confirmed ${txid.slice(0, 8)}`, 150, async () => {
    const r = await get(`/tx/${txid}/status`);
    return r.status === 200 && JSON.parse(r.text).confirmed ? true : undefined;
  });

const account = accountFromMnemonic(newMnemonic());
const key = account.key;
const first = deriveAddress(key, 0, 0);
const target = deriveAddress(key, 0, 1).address;
const changeAt = deriveAddress(key, 1, 0);

interface Coin { txid: string; vout: number; value: bigint; chain: 0 | 1; index: number }

function spend(coin: Coin, outputs: { address?: string; script?: Uint8Array; amount: bigint }[]): { hex: string; txid: string; vsize: number } {
  const from = deriveAddress(key, coin.chain, coin.index);
  const tx = new Transaction({ allowUnknownOutputs: true });
  tx.addInput({ txid: coin.txid, index: coin.vout, witnessUtxo: { script: from.script, amount: coin.value }, sequence: RBF_SEQUENCE });
  for (const o of outputs) {
    if (o.script) tx.addOutput({ script: o.script, amount: o.amount });
    else tx.addOutputAddress(o.address!, o.amount, REGTEST);
  }
  tx.signIdx(privateKeyAt(key, coin.chain, coin.index), 0);
  tx.finalize();
  return { hex: tx.hex, txid: tx.id, vsize: tx.vsize };
}

// -- one faucet payment --------------------------------------------------------
const faucet = await fetch(`${BOTS_URL}/faucet`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${BOTS_API_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ address: first.address }),
});
const paid = (await faucet.json()) as { txid?: string; amount_sats?: number; code?: string };
if (!paid.txid) throw new Error(`faucet refused: ${JSON.stringify(paid)}`);
console.log(`faucet paid ${paid.amount_sats} sats`);
await confirmed(paid.txid);
const utxos = JSON.parse((await get(`/address/${first.address}/utxo`)).text) as { txid: string; vout: number; value: number }[];
let coin: Coin = { txid: utxos[0]!.txid, vout: utxos[0]!.vout, value: BigInt(utxos[0]!.value), chain: 0, index: 0 };

const sent: string[] = []; // our payments to the target, oldest first
async function payTarget(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const fee = 200n;
    const amount = 600n;
    const tx = spend(coin, [
      { address: target, amount },
      { address: changeAt.address, amount: coin.value - amount - fee },
    ]);
    const r = await post(tx.hex);
    if (r.status !== 200) throw new Error(`payment ${sent.length + 1} refused: ${r.status} ${r.text}`);
    sent.push(tx.txid);
    coin = { txid: tx.txid, vout: 1, value: coin.value - amount - fee, chain: 1, index: 0 };
  }
}

interface ListFacts {
  request: string;
  status: number;
  ms: number;
  count: number | null;
  unconfirmed: number | null;
  confirmedCount: number | null;
  /** Where each listed transaction sits in the order we sent them (1 = first sent). */
  sentOrder: number[] | null;
  note?: string;
}
async function list(path: string, note?: string): Promise<ListFacts & { last: string | null }> {
  const r = await get(path);
  let rows: { txid: string; status: { confirmed: boolean } }[] | null = null;
  try {
    const parsed = JSON.parse(r.text);
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    // not a list
  }
  const facts: ListFacts = {
    request: `GET /esplora${path.replace(target, '<target>').replace(changeAt.address, '<change>').replace(/[0-9a-f]{64}/g, '<txid>')}`,
    status: r.status,
    ms: r.ms,
    count: rows ? rows.length : null,
    unconfirmed: rows ? rows.filter((t) => !t.status.confirmed).length : null,
    confirmedCount: rows ? rows.filter((t) => t.status.confirmed).length : null,
    sentOrder: rows ? rows.map((t) => sent.indexOf(t.txid) + 1) : null,
  };
  if (note) facts.note = note;
  if (!rows) facts.note = `${note ? note + '; ' : ''}body: ${r.text.slice(0, 160)}`;
  console.log(`  ${facts.request} -> ${facts.status}, ${facts.count} listed (${facts.unconfirmed} unconfirmed, ${facts.confirmedCount} confirmed), ${facts.ms} ms`);
  return { ...facts, last: rows && rows.length ? rows[rows.length - 1]!.txid : null };
}
const stats = async (label: string) => {
  const r = await get(`/address/${target}`);
  const a = JSON.parse(r.text) as { chain_stats: { tx_count: number }; mempool_stats: { tx_count: number } };
  console.log(`  ${label}: chain tx_count ${a.chain_stats.tx_count}, mempool tx_count ${a.mempool_stats.tx_count}`);
  return { label, chain: a.chain_stats.tx_count, mempool: a.mempool_stats.tx_count };
};
const strip = <T extends { last: string | null }>(f: T) => {
  const { last: _last, ...rest } = f;
  return rest;
};

const record: Record<string, unknown> = {};
const steps: unknown[] = [];

// -- A: 30 unconfirmed ---------------------------------------------------------
console.log('A: 30 unconfirmed payments to one address');
await payTarget(30);
await sleep(3000);
steps.push({ state: '30 unconfirmed', stats: await stats('A'), lists: [strip(await list(`/address/${target}/txs`)), strip(await list(`/address/${target}/txs/mempool`)), strip(await list(`/address/${target}/txs/chain`))] });

// -- B: 30 confirmed + 30 unconfirmed --------------------------------------------
console.log('B: a block, then 30 more');
await confirmed(sent[29]!);
await payTarget(30);
await sleep(3000);
{
  const all = await list(`/address/${target}/txs`);
  const lists = [strip(all), strip(await list(`/address/${target}/txs/mempool`))];
  const chain = await list(`/address/${target}/txs/chain`);
  lists.push(strip(chain));
  if (chain.last) lists.push(strip(await list(`/address/${target}/txs/chain/${chain.last}`, 'the next page, by the last ID of /txs/chain')));
  if (all.last) lists.push(strip(await list(`/address/${target}/txs?after_txid=${all.last}`, 'the next page, by the last ID of /txs')));
  lists.push(strip(await list(`/address/${target}/txs?max_txs=100`, 'asking for 100 at once')));
  steps.push({ state: '30 confirmed, 30 unconfirmed', stats: await stats('B'), lists });
}

// -- C: 60 confirmed -----------------------------------------------------------
console.log('C: another block: 60 confirmed');
await confirmed(sent[59]!);
await sleep(2000);
{
  const lists: unknown[] = [];
  const all = await list(`/address/${target}/txs`);
  lists.push(strip(all));
  // Walk the whole history both ways and count what each way reaches.
  let seen = new Set<string>();
  let page = await list(`/address/${target}/txs/chain`);
  lists.push(strip(page));
  let pages = 1;
  while (page.count && page.last && pages < 10) {
    const before = seen.size;
    for (const n of page.sentOrder ?? []) seen.add(String(n));
    if (seen.size === before && pages > 1) break;
    page = await list(`/address/${target}/txs/chain/${page.last}`, `page ${pages + 1} of /txs/chain`);
    lists.push(strip(page));
    pages++;
  }
  for (const n of page.sentOrder ?? []) seen.add(String(n));
  const byChain = seen.size;
  seen = new Set<string>();
  page = all;
  pages = 1;
  while (page.count && page.last && pages < 10) {
    const before = seen.size;
    for (const n of page.sentOrder ?? []) seen.add(String(n));
    if (seen.size === before && pages > 1) break;
    page = await list(`/address/${target}/txs?after_txid=${page.last}`, `page ${pages + 1} by after_txid`);
    lists.push(strip(page));
    pages++;
  }
  for (const n of page.sentOrder ?? []) seen.add(String(n));
  steps.push({ state: '60 confirmed', stats: await stats('C'), lists, reachedByChainPages: byChain, reachedByAfterTxid: seen.size });
  console.log(`  reached ${byChain} of 60 by /txs/chain pages, ${seen.size} of 60 by after_txid`);
}
// The change address took part in all 60 as well (spent from and paid to).
steps.push({ state: 'the change address, in all 60', lists: [strip(await list(`/address/${changeAt.address}/txs`)), strip(await list(`/address/${changeAt.address}/utxo`))] });

// -- relay of two unusual outputs ------------------------------------------------
console.log('D: unusual outputs');
const relay: unknown[] = [];
async function tryOutput(what: string, script: Uint8Array, amount: bigint, withChange: boolean): Promise<void> {
  const fee = 300n;
  const outputs: { address?: string; script?: Uint8Array; amount: bigint }[] = [{ script, amount }];
  if (withChange) outputs.push({ address: changeAt.address, amount: coin.value - amount - fee });
  let tx;
  try {
    tx = spend(coin, outputs);
  } catch (e) {
    relay.push({ what, built: false, error: String(e).slice(0, 200) });
    console.log(`  ${what}: could not build: ${String(e).slice(0, 120)}`);
    return;
  }
  const r = await post(tx.hex);
  relay.push({ what, amount: Number(amount), vsize: tx.vsize, status: r.status, body: r.status === 200 ? '<txid>' : r.text });
  console.log(`  ${what}: ${r.status} ${r.status === 200 ? 'accepted' : r.text.slice(0, 140)}`);
  if (r.status === 200 && withChange) coin = { txid: tx.txid, vout: 1, value: coin.value - amount - fee, chain: 1, index: 0 };
}
const anchor = hex.decode('51024e73');
const v2 = hex.decode('5220' + '11'.repeat(32));
await tryOutput('pay-to-anchor, 239 sats, with change', anchor, 239n, true);
await tryOutput('pay-to-anchor, 240 sats, with change', anchor, 240n, true);
await tryOutput('witness version 2 (32 bytes), 329 sats, with change', v2, 329n, true);
await tryOutput('witness version 2 (32 bytes), 330 sats, with change', v2, 330n, true);
// Last: every remaining sat to a pay-to-anchor output and no change (65 bytes without witnesses is the node's floor).
await tryOutput('pay-to-anchor only, no change (the whole coin less the fee)', anchor, coin.value - 300n, false);

record.measured = new Date().toISOString().slice(0, 10);
record.what = 'How the practice network lists an address with 60 transactions, and whether the node relays two unusual outputs. sentOrder: 1 is the first payment sent, 60 the last, 0 a transaction that is not one of the 60.';
record.steps = steps;
record.relay = relay;
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(`wrote ${out}`);
