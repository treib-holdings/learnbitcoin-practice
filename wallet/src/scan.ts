// Finding the wallet's coins on the practice chain.
//
// A wallet doesn't store a balance. It derives its addresses in order and
// asks the network which of them have been used, stopping after GAP_LIMIT
// unused addresses in a row (the "gap limit" every HD wallet uses). The
// coins are the unspent outputs paying to those addresses.

import type { HDKey } from '@scure/bip32';
import type { Esplora, TxStatus } from './esplora.ts';
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
        for (const u of utxoLists[i]!) {
          coins.push({
            txid: u.txid,
            vout: u.vout,
            value: BigInt(u.value),
            status: u.status,
            chain,
            index: derived.index,
            address: derived.address,
            script: derived.script,
          });
        }
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
  let confirmed = 0n;
  let unconfirmed = 0n;
  for (const c of coins) {
    if (c.status.confirmed) confirmed += c.value;
    else unconfirmed += c.value;
  }
  return {
    receive: receive.addresses,
    change: change.addresses,
    coins,
    nextReceiveIndex: receive.next,
    nextChangeIndex: change.next,
    confirmed,
    unconfirmed,
  };
}
