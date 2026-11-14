// Showing a transaction the way the wallet sees it.
//
// A transaction is a list of coins going in and a list of outputs coming
// out. On its own it does not say "you paid 30,000 sats": that reading comes
// from knowing which of those addresses are the wallet's. viewTx marks each
// part as mine or not, change or not, and adds up what the wallet gained or
// lost. The review of a payment that is signed but not sent yet (viewPayment)
// uses the same shape, so the reader sees it then as they will see it later.

import type { Esplora, EsploraTx } from './esplora.ts';
import { RBF_SEQUENCE } from './network.ts';
import { type WalletState, inBatches, ownAddresses } from './scan.ts';
import type { SignedPayment } from './send.ts';

type Own = ReturnType<typeof ownAddresses>;

/** One input or one output of a transaction. */
export interface TxPart {
  /** Null when the script has no address form, and for a coinbase input. */
  address: string | null;
  /** In satoshis. */
  value: bigint;
  /** The address is one of the wallet's. */
  mine: boolean;
  /** The address is on the wallet's change chain. */
  change: boolean;
}

export interface TxView {
  txid: string;
  confirmed: boolean;
  /** Block height, or null while unconfirmed. */
  height: number | null;
  /** Block time in seconds since 1970, or null while unconfirmed. */
  time: number | null;
  inputs: TxPart[];
  outputs: TxPart[];
  /** In satoshis. */
  fee: bigint;
  vsize: number;
  /** fee / vsize, in sat/vB. */
  feeRate: number;
  /** What the wallet gained (above 0) or lost (below 0), fee included, in satoshis. */
  net: bigint;
  /**
   * received  the wallet was paid
   * sent      the wallet paid somebody else
   * internal  every input and every output is the wallet's: it paid itself, and lost only the fee
   * other     no input and no output is the wallet's
   */
  direction: 'received' | 'sent' | 'internal' | 'other';
  /** Some input signals replace-by-fee (BIP125). */
  rbf: boolean;
}

function part(address: string | null, value: bigint, own: Own): TxPart {
  const change = address !== null && own.change.has(address);
  const mine = change || (address !== null && own.receive.has(address));
  return { address, value, mine, change };
}

/** Add what only the wallet can know: the net amount and which way the money went. */
function finish(tx: Omit<TxView, 'net' | 'direction'>): TxView {
  const sumMine = (parts: TxPart[]) => parts.reduce((total, p) => (p.mine ? total + p.value : total), 0n);
  const net = sumMine(tx.outputs) - sumMine(tx.inputs);
  const all = [...tx.inputs, ...tx.outputs];
  let direction: TxView['direction'];
  if (!all.some((p) => p.mine)) direction = 'other';
  else if (all.every((p) => p.mine)) direction = 'internal';
  else if (tx.inputs.some((p) => p.mine) && net <= 0n) direction = 'sent';
  else direction = 'received';
  return { ...tx, net, direction };
}

/** A transaction as Esplora reports it, seen from the wallet that owns these addresses. */
export function viewTx(tx: EsploraTx, own: Own): TxView {
  const fee = BigInt(tx.fee);
  const vsize = Math.ceil(tx.weight / 4);
  return finish({
    txid: tx.txid,
    confirmed: tx.status.confirmed,
    height: tx.status.block_height ?? null,
    time: tx.status.block_time ?? null,
    // A coinbase input spends no coin: it is where a block's new coins come from.
    inputs: tx.vin.map((input) =>
      input.is_coinbase || !input.prevout
        ? { address: null, value: 0n, mine: false, change: false }
        : part(input.prevout.scriptpubkey_address ?? null, BigInt(input.prevout.value), own),
    ),
    outputs: tx.vout.map((output) => part(output.scriptpubkey_address ?? null, BigInt(output.value), own)),
    fee,
    vsize,
    feeRate: Number(fee) / vsize,
    // BIP125: any input with a sequence number below 0xfffffffe opts in.
    rbf: tx.vin.some((input) => input.sequence <= RBF_SEQUENCE),
  });
}

/** A payment that is signed but not sent yet, in the same shape viewTx gives once the network has it. */
export function viewPayment(payment: SignedPayment, own: Own): TxView {
  // The payment's coins and its change are the wallet's by construction,
  // whether or not the list of scanned addresses has reached them yet.
  const receive = new Set(own.receive);
  const change = new Set(own.change);
  for (const coin of payment.inputs) (coin.chain === 1 ? change : receive).add(coin.address);
  for (const output of payment.outputs) if (output.isChange) change.add(output.address);
  const known: Own = { receive, change };
  return finish({
    txid: payment.txid,
    confirmed: false,
    height: null,
    time: null,
    inputs: payment.inputs.map((coin) => part(coin.address, coin.value, known)),
    outputs: [...payment.outputs].sort((a, b) => a.vout - b.vout).map((output) => part(output.address, output.amount, known)),
    fee: payment.fee,
    vsize: payment.vsize,
    feeRate: payment.feeRate,
    // signPayment sets the replace-by-fee sequence number on every input.
    rbf: true,
  });
}

/**
 * Newest first: unconfirmed transactions, then by block from the tip down.
 * Inside one block, and among the unconfirmed, a transaction that spends
 * another's output is the newer of the two, so it comes first.
 */
function newestFirst(txs: EsploraTx[]): EsploraTx[] {
  const byId = new Map(txs.map((tx) => [tx.txid, tx]));
  const rank = (tx: EsploraTx) => (tx.status.confirmed ? (tx.status.block_height ?? 0) : Number.MAX_SAFE_INTEGER);
  const depths = new Map<string, number>();
  const depth = (tx: EsploraTx): number => {
    const seen = depths.get(tx.txid);
    if (seen !== undefined) return seen;
    depths.set(tx.txid, 0);
    let d = 0;
    for (const input of tx.vin) {
      const parent = byId.get(input.txid);
      if (parent && rank(parent) === rank(tx)) d = Math.max(d, depth(parent) + 1);
    }
    depths.set(tx.txid, d);
    return d;
  };
  return [...txs].sort((a, b) => rank(b) - rank(a) || depth(b) - depth(a) || (a.txid < b.txid ? -1 : 1));
}

/**
 * The wallet's transactions, newest first, one entry each however many of the
 * wallet's addresses a transaction touches.
 *
 * Esplora lists at most 50 of an address's transactions in one answer and
 * gives the older ones 25 at a time. Every page is read (addressTxsAll in
 * esplora.ts, which also says where the reading stops: far beyond what an
 * address of a practice wallet comes to). For most addresses the first
 * answer is the whole list, so this costs one request for each address in
 * use.
 */
export async function walletHistory(state: WalletState, esplora: Esplora): Promise<TxView[]> {
  const own = ownAddresses(state);
  // Addresses with history: the ones marked used, and any that holds a coin.
  const addresses = new Set([...state.receive, ...state.change].filter((a) => a.used).map((a) => a.address));
  for (const coin of state.coins) addresses.add(coin.address);

  const lists = await inBatches([...addresses], 10, (address) => esplora.addressTxsAll(address));
  const byId = new Map<string, EsploraTx>();
  for (const tx of lists.flat()) {
    // If a block arrived between two answers, keep the confirmed copy.
    if (!byId.has(tx.txid) || tx.status.confirmed) byId.set(tx.txid, tx);
  }
  return newestFirst([...byId.values()]).map((tx) => viewTx(tx, own));
}
