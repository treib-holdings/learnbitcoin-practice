// Records what the practice network's origin really answers, so the Worker's
// tests and the end-to-end stand-in are built on real bodies, not guesses:
//
//   worker/test/fixtures/broadcast-refusals.json   the node's words when it refuses a transaction
//   e2e/fixtures/origin-samples.json               one sample of every answer shape the app relies on
//
// It makes a throwaway wallet, takes one faucet payment and spends it. Run it
// through run-live.sh (which supplies ESPLORA_URL, BOTS_URL and BOTS_API_TOKEN):
//
//   PRACTICE_SSH=<alias> tools/integration/run-live.sh tools/integration/origin-samples.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  Esplora,
  RBF_SEQUENCE,
  REGTEST,
  accountFromMnemonic,
  deriveAddress,
  newMnemonic,
  privateKeyAt,
  scanWallet,
} from '../../wallet/src/index.ts';

const requireFromWallet = createRequire(new URL('../../wallet/package.json', import.meta.url));
const { Transaction, p2tr } = (await import(requireFromWallet.resolve('@scure/btc-signer'))) as typeof import('@scure/btc-signer');

const { ESPLORA_URL, BOTS_URL, BOTS_API_TOKEN } = process.env;
if (!ESPLORA_URL || !BOTS_URL || !BOTS_API_TOKEN) throw new Error('Set ESPLORA_URL, BOTS_URL and BOTS_API_TOKEN');
const esplora = new Esplora(ESPLORA_URL);
const root = new URL('../../', import.meta.url);

interface Sample {
  what: string;
  request: string;
  status: number;
  contentType: string | null;
  body: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sample(what: string, base: string, path: string, init: RequestInit = {}, auth = false): Promise<Sample> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (auth) headers.Authorization = `Bearer ${BOTS_API_TOKEN}`;
  const res = await fetch(`${base}${path}`, { ...init, headers, redirect: 'manual' });
  const text = await res.text();
  const contentType = res.headers.get('content-type');
  let body: unknown = text;
  if (contentType?.includes('json')) {
    try {
      body = JSON.parse(text);
    } catch {
      // keep the text
    }
  }
  const label = base === ESPLORA_URL ? '/esplora' : '/bots';
  return { what, request: `${init.method ?? 'GET'} ${label}${path}`, status: res.status, contentType, body };
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

interface Spendable {
  txid: string;
  vout: number;
  value: bigint;
  chain: 0 | 1;
  index: number;
}

const account = accountFromMnemonic(newMnemonic());
const key = account.key;
const receive = (i: number) => deriveAddress(key, 0, i);
const change = (i: number) => deriveAddress(key, 1, i);
/** A taproot address of ours (key path only), to test the dust limit of a second output type. */
const taproot = p2tr(receive(6).publicKey.slice(1), undefined, REGTEST).address!;

/** One input, any outputs, signed. No checks: this is how the refused shapes get made. */
function rawTx(coin: Spendable, outputs: { address: string; amount: bigint }[]): { hex: string; txid: string; vsize: number } {
  const from = deriveAddress(key, coin.chain, coin.index);
  const tx = new Transaction();
  tx.addInput({ txid: coin.txid, index: coin.vout, witnessUtxo: { script: from.script, amount: coin.value }, sequence: RBF_SEQUENCE });
  for (const o of outputs) tx.addOutputAddress(o.address, o.amount, REGTEST);
  tx.signIdx(privateKeyAt(key, coin.chain, coin.index), 0);
  tx.finalize();
  return { hex: tx.hex, txid: tx.id, vsize: tx.vsize };
}

const broadcast = (what: string, hex: string) =>
  sample(what, ESPLORA_URL, '/tx', { method: 'POST', body: hex, headers: { 'Content-Type': 'text/plain' } });

const samples: Sample[] = [];
const refusals: (Sample & { expect: string })[] = [];

/** The code the Worker must turn each refusal into (the contract's BROADCAST_REFUSALS). */
function expectedCode(what: string): string {
  if (what.startsWith('dust:')) return 'dust';
  if (what.startsWith('fee too low:')) return 'fee_too_low';
  if (what.startsWith('coin already')) return 'coin_spent';
  if (what.startsWith('already in a block')) return 'already_sent';
  return 'refused';
}
const refused = (r: Sample) => {
  if (r.status === 200) throw new Error(`expected a refusal: ${r.what}`);
  refusals.push({ ...r, expect: expectedCode(r.what) });
};

// -- shapes before the wallet has any history ---------------------------------
const unused = receive(5).address;
samples.push(await sample('tip height', ESPLORA_URL, '/blocks/tip/height'));
samples.push(await sample('an address with no history', ESPLORA_URL, `/address/${unused}`));
samples.push(await sample('coins of an address with no history', ESPLORA_URL, `/address/${unused}/utxo`));
samples.push(await sample('transactions of an address with no history', ESPLORA_URL, `/address/${unused}/txs`));
samples.push(await sample('a transaction nobody has seen', ESPLORA_URL, `/tx/${'ab'.repeat(32)}`));
samples.push(await sample('not an address', ESPLORA_URL, '/address/bcrt1qnotanaddress'));
samples.push(await sample('a mainnet address', ESPLORA_URL, '/address/bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'));
samples.push(await sample('a path the app never uses', ESPLORA_URL, '/nothing/here'));

// -- the bots -----------------------------------------------------------------
samples.push(await sample('pot address without the token', BOTS_URL, '/pot/address'));
const pot1 = await sample('pot address', BOTS_URL, '/pot/address', {}, true);
const pot2 = await sample('pot address, asked again', BOTS_URL, '/pot/address', {}, true);
samples.push(pot1, pot2);
if ((pot1.body as any).address !== (pot2.body as any).address) throw new Error('the pot address changed between two calls');
const faucetBody = (address: string) => ({ method: 'POST', body: JSON.stringify({ address }), headers: { 'Content-Type': 'application/json' } });
samples.push(await sample('faucet: not a practice address', BOTS_URL, '/faucet', faucetBody('tb1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjpupg53'), true));
samples.push(await sample('faucet: the network\'s own address', BOTS_URL, '/faucet', faucetBody((pot1.body as any).address), true));
samples.push(await sample('faucet: malformed body', BOTS_URL, '/faucet', { method: 'POST', body: 'x', headers: { 'Content-Type': 'application/json' } }, true));

let paid: Sample | undefined;
for (let attempt = 0; attempt < 12 && !paid; attempt++) {
  const r = await sample('faucet: paid', BOTS_URL, '/faucet', faucetBody(receive(0).address), true);
  if (r.status === 200) paid = r;
  else if (r.status === 503 || (r.body as any)?.code === 'busy') {
    samples.push({ ...r, what: `faucet: ${(r.body as any)?.code}` });
    await sleep(15000);
  } else throw new Error(`faucet answered ${r.status}: ${JSON.stringify(r.body)}`);
}
if (!paid) throw new Error('the faucet stayed busy');
samples.push(paid);
samples.push(await sample('faucet: the same address again', BOTS_URL, '/faucet', faucetBody(receive(0).address), true));
const faucetTxid = (paid.body as any).txid as string;
console.log(`wallet ${account.masterFingerprint} got ${(paid.body as any).amount_sats} sats: ${faucetTxid}`);

await until('the faucet payment shows in Esplora', 60, () => esplora.tx(faucetTxid));
samples.push(await sample('a transaction in the mempool', ESPLORA_URL, `/tx/${faucetTxid}`));
samples.push(await sample('an address with an unconfirmed payment', ESPLORA_URL, `/address/${receive(0).address}`));
samples.push(await sample('coins of an address, unconfirmed', ESPLORA_URL, `/address/${receive(0).address}/utxo`));

const state = await until('the faucet coin confirms', 150, async () => {
  const s = await scanWallet(key, esplora);
  return s.confirmed >= 100_000n ? s : undefined;
});
samples.push(await sample('a confirmed transaction', ESPLORA_URL, `/tx/${faucetTxid}`));
samples.push(await sample('coins of an address, confirmed', ESPLORA_URL, `/address/${receive(0).address}/utxo`));
samples.push(await sample('transactions of an address', ESPLORA_URL, `/address/${receive(0).address}/txs`));

const c0coin = state.coins[0]!;
const c0: Spendable = { txid: c0coin.txid, vout: c0coin.vout, value: c0coin.value, chain: 0, index: 0 };

// -- transactions the node refuses ----------------------------------------------
refused(await broadcast('dust: a 200 sat output', rawTx(c0, [
  { address: receive(1).address, amount: 200n },
  { address: change(0).address, amount: c0.value - 200n - 400n },
]).hex));
refused(await broadcast('dust: a 293 sat output (one below the limit)', rawTx(c0, [
  { address: receive(1).address, amount: 293n },
  { address: change(0).address, amount: c0.value - 293n - 400n },
]).hex));
refused(await broadcast('dust: a 329 sat taproot output (one below its limit)', rawTx(c0, [
  { address: taproot, amount: 329n },
  { address: change(0).address, amount: c0.value - 329n - 400n },
]).hex));
const lowFee = rawTx(c0, [{ address: change(0).address, amount: c0.value - 5n }]);
refused(await broadcast(`fee too low: 5 sats for ${lowFee.vsize} vB`, lowFee.hex));
refused(await broadcast('fee too low: no fee at all', rawTx(c0, [{ address: change(0).address, amount: c0.value }]).hex));
refused(await broadcast('not a transaction', '00'));
refused(await broadcast('half a transaction', lowFee.hex.slice(0, 80)));

// The node relays from 0.1 sat/vB (Bitcoin Core's default since version 30), so this one is accepted.
const cheap = rawTx(c0, [{ address: change(0).address, amount: c0.value - 50n }]);
const cheapSent = await broadcast(`accepted: 50 sats for ${cheap.vsize} vB, under 1 sat/vB`, cheap.hex);
if (cheapSent.status !== 200) throw new Error(`the cheap payment was refused: ${JSON.stringify(cheapSent)}`);
samples.push({ ...cheapSent, what: `broadcast accepted at under 1 sat/vB (50 sats for ${cheap.vsize} vB)` });

// The first good payment replaces the cheap one (it pays more): 20,000 sats to ourselves,
// plus one output at exactly the dust limit of each output type the wallet can pay to.
const t1 = rawTx(c0, [
  { address: receive(1).address, amount: 20_000n },
  { address: change(0).address, amount: c0.value - 20_000n - 294n - 330n - 500n },
  { address: receive(4).address, amount: 294n },
  { address: taproot, amount: 330n },
]);
const sent = await broadcast('accepted', t1.hex);
if (sent.status !== 200) throw new Error(`the good payment was refused: ${JSON.stringify(sent)}`);
samples.push({ ...sent, what: 'broadcast accepted: a payment with a 294 sat segwit output and a 330 sat taproot output (the dust limits), replacing the cheaper one' });
samples.push({ ...(await broadcast('sent again while still in the mempool', t1.hex)), what: 'broadcast: the same transaction again, still unconfirmed' });

refused(await broadcast('coin already being spent: a second payment from the same coin, same fee', rawTx(c0, [
  { address: receive(2).address, amount: 20_000n },
  { address: change(0).address, amount: c0.value - 20_000n - 500n },
]).hex));
refused(await broadcast('coin already being spent: a second payment from the same coin, lower fee', rawTx(c0, [
  { address: receive(2).address, amount: 20_000n },
  { address: change(0).address, amount: c0.value - 20_000n - 150n },
]).hex));

// A long chain of unconfirmed payments, each spending the last one's change.
let tip: Spendable = { txid: t1.txid, vout: 1, value: c0.value - 20_000n - 294n - 330n - 500n, chain: 1, index: 0 };
let chained = 0;
for (let i = 1; i <= 70; i++) {
  const next = rawTx(tip, [{ address: change(i).address, amount: tip.value - 250n }]);
  const r = await broadcast(`unconfirmed chain: payment ${i + 1} in a row`, next.hex);
  if (r.status !== 200) {
    refused(r);
    break;
  }
  chained = i;
  tip = { txid: next.txid, vout: 0, value: tip.value - 250n, chain: 1, index: i };
}
console.log(`chained ${chained} unconfirmed payments after the first`);

await until('the first payment confirms', 150, async () => ((await esplora.tx(t1.txid)).status.confirmed ? true : undefined));
refused(await broadcast('already in a block: the same transaction sent again', t1.hex));
refused(await broadcast('coin already spent in a block', rawTx(c0, [{ address: receive(3).address, amount: c0.value - 300n }]).hex));
samples.push(await sample('transactions of an address that received and spent', ESPLORA_URL, `/address/${receive(0).address}/txs`));
samples.push(await sample('an address that received and spent', ESPLORA_URL, `/address/${receive(0).address}`));
samples.push(await sample('tip height, later', ESPLORA_URL, '/blocks/tip/height'));

mkdirSync(new URL('worker/test/fixtures/', root), { recursive: true });
mkdirSync(new URL('e2e/fixtures/', root), { recursive: true });
const note = 'Recorded from the practice network by tools/integration/origin-samples.ts. Do not edit by hand: run it again.';
writeFileSync(new URL('worker/test/fixtures/broadcast-refusals.json', root), `${JSON.stringify({ note, refusals }, null, 2)}\n`);
writeFileSync(new URL('e2e/fixtures/origin-samples.json', root), `${JSON.stringify({ note, samples }, null, 2)}\n`);
console.log(`${refusals.length} refusals, ${samples.length} samples`);
for (const r of refusals) {
  const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  console.log(`  ${r.status}  ${r.expect.padEnd(12)} ${r.what}\n        ${text.slice(0, 200)}`);
}
