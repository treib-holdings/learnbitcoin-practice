// Shared by the tests: the frozen vectors, a stand-in Esplora server, coins
// made by hand, and a seeded random generator so that "a few hundred random
// cases" are the same few hundred on every run.

import { readFileSync } from 'node:fs';
import type { HDKey } from '@scure/bip32';
import {
  Esplora,
  deriveAddress,
  type Chain,
  type Coin,
  type EsploraTx,
  type FetchLike,
  type WalletState,
} from '../src/index.ts';

export const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));

/** A coin paying one of the account's own addresses. Confirmed unless told otherwise. */
export function coinAt(
  account: HDKey,
  chain: Chain,
  index: number,
  value: bigint,
  opts: { txid?: string; vout?: number; confirmed?: boolean } = {},
): Coin {
  const a = deriveAddress(account, chain, index);
  return {
    txid: opts.txid ?? `${chain}${index}`.padStart(2, '0').repeat(32).slice(0, 64),
    vout: opts.vout ?? 0,
    value,
    status: opts.confirmed === false ? { confirmed: false } : { confirmed: true, block_height: 101 },
    chain,
    index,
    address: a.address,
    script: a.script,
  };
}

/** A wallet state made by hand: just coins, with no scanned address lists. */
export function stateOf(coins: Coin[], nextChangeIndex = 0): WalletState {
  return {
    receive: [],
    change: [],
    coins,
    nextReceiveIndex: 0,
    nextChangeIndex,
    confirmed: coins.reduce((s, c) => (c.status.confirmed ? s + c.value : s), 0n),
    unconfirmed: coins.reduce((s, c) => (c.status.confirmed ? s : s + c.value), 0n),
  };
}

/** A deep copy, to prove afterwards that a function did not change what it was given. */
export function copyOf<T>(value: T): T {
  return structuredClone(value);
}

export interface FakeUtxo {
  txid: string;
  vout: number;
  value: number;
  /** Block height, or undefined while unconfirmed. */
  height?: number;
}

export interface FakeAddress {
  /** Confirmed transactions that touch the address. */
  txCount?: number;
  /** Unconfirmed transactions that touch the address. */
  mempoolTxCount?: number;
  utxos?: FakeUtxo[];
  txs?: EsploraTx[];
}

/**
 * An address's transactions as Esplora lists them (GET /address/<a>/txs): 50
 * at most, the unconfirmed ones first, then the confirmed ones. Each kind
 * stays in the order the test gave it.
 */
function firstPage(txs: EsploraTx[]): EsploraTx[] {
  const unconfirmed = txs.filter((tx) => !tx.status.confirmed).slice(0, 50);
  const confirmed = txs.filter((tx) => tx.status.confirmed).slice(0, 50 - unconfirmed.length);
  return [...unconfirmed, ...confirmed];
}

/**
 * The confirmed ones, 25 at a time (GET /address/<a>/txs/chain/<txid>):
 * those that come after the transaction `after`, or the first 25 when no ID
 * is given. An ID that is not among them gives an empty list.
 */
function chainPage(txs: EsploraTx[], after: string | undefined): EsploraTx[] {
  const confirmed = txs.filter((tx) => tx.status.confirmed);
  if (after === undefined) return confirmed.slice(0, 25);
  const at = confirmed.findIndex((tx) => tx.txid === after);
  return at === -1 ? [] : confirmed.slice(at + 1, at + 26);
}

/**
 * What the Esplora server answers, with a 400, for the unspent coins of an
 * address that holds more of them in blocks than its limit: its own words,
 * from its source. The limit there is 500 unless the server is started with
 * another.
 */
export const tooManyUtxos = (limit: number): string => `Too many unspent transaction outputs (>${limit}). Contact support to raise limits.`;

/**
 * A stand-in Esplora server that knows a handful of addresses. `known` may be
 * changed between calls, as a chain changes; `calls` records every request.
 * An address's transactions come in pages, as the practice network's do.
 *
 * With `utxosLimit`, the list of an address's unspent coins is refused when
 * the address holds more confirmed coins than that, as the Esplora server's
 * source has it. Without it any number is listed. (The limit was read, not
 * measured on the practice network, so it is something a test asks for.)
 */
export function fakeEsplora(known: Record<string, FakeAddress> = {}, opts: { utxosLimit?: number } = {}) {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const path = new URL(url).pathname.replace(/^\/api/, '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    const m = path.match(/^\/address\/([^/]+)(\/utxo|\/txs|\/txs\/chain(?:\/([0-9a-f]{64}))?)?$/);
    if (!m) return new Response('not found', { status: 404 });
    const address = decodeURIComponent(m[1]!);
    const f = known[address] ?? {};
    if (m[2] === '/utxo') {
      const inBlocks = (f.utxos ?? []).filter((u) => u.height !== undefined).length;
      if (opts.utxosLimit !== undefined && inBlocks > opts.utxosLimit) {
        return new Response(tooManyUtxos(opts.utxosLimit), { status: 400, headers: { 'Content-Type': 'text/plain' } });
      }
      return Response.json(
        (f.utxos ?? []).map((u) => ({
          txid: u.txid,
          vout: u.vout,
          value: u.value,
          status: u.height === undefined ? { confirmed: false } : { confirmed: true, block_height: u.height },
        })),
      );
    }
    if (m[2] === '/txs') return Response.json(firstPage(f.txs ?? []));
    if (m[2]?.startsWith('/txs/chain')) return Response.json(chainPage(f.txs ?? [], m[3]));
    const stats = (n: number) => ({ funded_txo_count: n, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: n });
    return Response.json({ address, chain_stats: stats(f.txCount ?? 0), mempool_stats: stats(f.mempoolTxCount ?? 0) });
  };
  return { esplora: new Esplora('https://example.test/api/', fetchFn), calls, known };
}

/** A small seeded random generator (mulberry32): the same seed gives the same numbers. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** A whole number from 0 up to, but not including, n. */
  const int = (n: number): number => Math.floor(next() * n);
  const bytes = (n: number): Uint8Array => Uint8Array.from({ length: n }, () => int(256));
  const pick = <T>(items: readonly T[]): T => items[int(items.length)]!;
  return { next, int, bytes, pick };
}
