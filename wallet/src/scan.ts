// Finding the wallet's coins on the practice chain.
//
// A wallet doesn't store a balance. It derives its addresses in order and
// asks the network which of them have been used, stopping after GAP_LIMIT
// unused addresses in a row (the "gap limit" every HD wallet uses). The
// coins are the unspent outputs paying to those addresses.
//
// That full scan asks about every address, so it runs when the wallet opens.
// In between, refreshWallet asks again only where something can have
// changed: the addresses already in use, the few after them, and any that
// were skipped over on the way.

import type { HDKey } from '@scure/bip32';
import type { Esplora, EsploraUtxo, TxStatus } from './esplora.ts';
import { type Chain, type DerivedAddress, deriveAddress } from './keys.ts';
import { GAP_LIMIT } from './network.ts';

export interface WalletAddress extends DerivedAddress {
  used: boolean;
}

/** One unspent output the wallet can spend: a "coin". */
export interface Coin {
  txid: string;
  vout: number;
  /** In satoshis. */
  value: bigint;
  status: TxStatus;
  chain: Chain;
  index: number;
  address: string;
  script: Uint8Array;
}

export interface WalletState {
  receive: WalletAddress[];
  change: WalletAddress[];
  coins: Coin[];
  /** First receive index after the last used one: the next address to hand out. */
  nextReceiveIndex: number;
  nextChangeIndex: number;
  confirmed: bigint;
  unconfirmed: bigint;
}

/** An unspent output reported by Esplora, as a coin of the wallet's address it pays. */
function toCoin(utxo: EsploraUtxo, address: DerivedAddress): Coin {
  return {
    txid: utxo.txid,
    vout: utxo.vout,
    value: BigInt(utxo.value),
    status: utxo.status,
    chain: address.chain,
    index: address.index,
    address: address.address,
    script: address.script,
  };
}

/** What a list of coins adds up to, confirmed and not yet confirmed, in satoshis. */
export function coinTotals(coins: Coin[]): { confirmed: bigint; unconfirmed: bigint } {
  let confirmed = 0n;
  let unconfirmed = 0n;
  for (const c of coins) {
    if (c.status.confirmed) confirmed += c.value;
    else unconfirmed += c.value;
  }
  return { confirmed, unconfirmed };
}

async function scanChain(
  account: HDKey,
  esplora: Esplora,
  chain: Chain,
  gap: number,
  batch: number,
): Promise<{ addresses: WalletAddress[]; coins: Coin[]; next: number }> {
  const addresses: WalletAddress[] = [];
  const coins: Coin[] = [];
  let unusedRun = 0;
  let next = 0;
  let index = 0;
  while (unusedRun < gap) {
    const window = Array.from({ length: batch }, (_, i) => deriveAddress(account, chain, index + i));
    const stats = await Promise.all(window.map((a) => esplora.address(a.address)));
    const usedFlags = stats.map((s) => s.chain_stats.tx_count + s.mempool_stats.tx_count > 0);
    const utxoLists = await Promise.all(
      window.map((a, i) => (usedFlags[i] ? esplora.addressUtxos(a.address) : Promise.resolve([]))),
    );
    for (let i = 0; i < window.length && unusedRun < gap; i++) {
      const derived = window[i]!;
      const used = usedFlags[i]!;
      addresses.push({ ...derived, used });
      if (used) {
        unusedRun = 0;
        next = derived.index + 1;
        for (const u of utxoLists[i]!) coins.push(toCoin(u, derived));
      } else {
        unusedRun++;
      }
    }
    index += batch;
  }
  return { addresses, coins, next };
}

/** Scan receive and change addresses and collect the wallet's coins. */
export async function scanWallet(
  account: HDKey,
  esplora: Esplora,
  opts: { gap?: number; batch?: number } = {},
): Promise<WalletState> {
  const gap = opts.gap ?? GAP_LIMIT;
  const batch = opts.batch ?? 10;
  const [receive, change] = await Promise.all([
    scanChain(account, esplora, 0, gap, batch),
    scanChain(account, esplora, 1, gap, batch),
  ]);
  const coins = [...receive.coins, ...change.coins];
  return {
    receive: receive.addresses,
    change: change.addresses,
    coins,
    nextReceiveIndex: receive.next,
    nextChangeIndex: change.next,
    ...coinTotals(coins),
  };
}

/**
 * Every address known to be the wallet's, by chain. A screen uses it to tell
 * "mine" from "theirs" and change from payment when it shows a transaction.
 * A coin's address counts even if the address list has not caught up with it.
 */
export function ownAddresses(state: WalletState): { receive: ReadonlySet<string>; change: ReadonlySet<string> } {
  const receive = new Set(state.receive.map((a) => a.address));
  const change = new Set(state.change.map((a) => a.address));
  for (const c of state.coins) (c.chain === 1 ? change : receive).add(c.address);
  return { receive, change };
}

/**
 * May a payment spend this coin now? Confirmed coins, yes. An unconfirmed
 * coin only if it sits on the change chain: then it is the wallet's own
 * change from a payment it made itself. An unconfirmed coin somebody else
 * sent can still be replaced or dropped by its sender, and a payment built
 * on it would vanish with it.
 */
export function isSpendable(coin: Coin): boolean {
  return coin.status.confirmed || coin.chain === 1;
}

/** The wallet's coins that a payment may spend now (see isSpendable). */
export function spendableCoins(state: WalletState): Coin[] {
  return state.coins.filter(isSpendable);
}

/** Ask about a list of things a few at a time, so one refresh never opens dozens of connections at once. */
export async function inBatches<T, R>(items: T[], size: number, ask: (item: T) => Promise<R>): Promise<R[]> {
  const answers: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    answers.push(...(await Promise.all(items.slice(i, i + size).map(ask))));
  }
  return answers;
}

/** How many unused addresses past the last used one a light refresh watches on each chain. */
export const LOOKAHEAD = 5;

async function refreshChain(
  account: HDKey,
  esplora: Esplora,
  chain: Chain,
  known: WalletAddress[],
  next: number,
  lookahead: number,
): Promise<{ coins: Coin[]; rescan: boolean }> {
  const at = (index: number): DerivedAddress => {
    const address = known[index];
    return address && address.index === index ? address : deriveAddress(account, chain, index);
  };
  // Addresses already in use: their coins can have been spent, confirmed or joined by new ones.
  const used: DerivedAddress[] = known.filter((a) => a.used);
  // A full scan leaves the list reaching 20 addresses past the last used one.
  // After that many payments in a row it ends before `next`, and the
  // addresses in between are in use too.
  const behind = known.length < next;
  for (let index = known.length; index < next; index++) used.push(at(index));
  // Unused addresses below `next`: ones that were skipped over. An address
  // the reader was shown and then moved on from still works, and somebody
  // may pay it yet. Most wallets have none or a few; each costs one request.
  const skipped: DerivedAddress[] = known.filter((a) => !a.used && a.index < next);
  // The next few unused addresses: where a new payment would arrive.
  const ahead = Array.from({ length: lookahead }, (_, i) => at(next + i));
  const unused = [...skipped, ...ahead];

  const [usedUtxos, unusedStats] = await Promise.all([
    inBatches(used, 10, (a) => esplora.addressUtxos(a.address)),
    inBatches(unused, 10, (a) => esplora.address(a.address)),
  ]);
  const paid = unused.filter((_, i) => {
    const stats = unusedStats[i]!;
    return stats.chain_stats.tx_count + stats.mempool_stats.tx_count > 0;
  });
  const paidUtxos = await inBatches(paid, 10, (a) => esplora.addressUtxos(a.address));

  const coins: Coin[] = [];
  used.forEach((a, i) => coins.push(...usedUtxos[i]!.map((u) => toCoin(u, a))));
  paid.forEach((a, i) => coins.push(...paidUtxos[i]!.map((u) => toCoin(u, a))));
  // An address that counted as unused has been paid, or the address list has
  // fallen behind: only a full scan puts that right.
  return { coins, rescan: paid.length > 0 || behind };
}

export interface Refreshed {
  /** The previous state with the coins and totals as the network reports them now. */
  state: WalletState;
  /** True when the address lists are out of date and the caller should run scanWallet. */
  rescan: boolean;
}

/**
 * A light refresh: read again the coins of every address in use, and look
 * at the unused addresses a payment can still arrive at: the next few on
 * each chain, and any below them that were skipped over. Much cheaper than
 * a full scan.
 *
 * `rescan` is true when one of those unused addresses has a transaction,
 * confirmed or not: the wallet has been paid somewhere new, and only
 * scanWallet marks that address used and moves the "next address" markers
 * on. The coins found there are already in the answer. (It is also true in
 * the rare case that the previous state's address list ends before its own
 * "next address" marker.)
 * `prev` is not changed.
 */
export async function refreshWallet(
  account: HDKey,
  esplora: Esplora,
  prev: WalletState,
  opts: { lookahead?: number } = {},
): Promise<Refreshed> {
  const lookahead = opts.lookahead ?? LOOKAHEAD;
  const [receive, change] = await Promise.all([
    refreshChain(account, esplora, 0, prev.receive, prev.nextReceiveIndex, lookahead),
    refreshChain(account, esplora, 1, prev.change, prev.nextChangeIndex, lookahead),
  ]);
  const coins = [...receive.coins, ...change.coins];
  return {
    state: { ...prev, coins, ...coinTotals(coins) },
    rescan: receive.rescan || change.rescan,
  };
}
