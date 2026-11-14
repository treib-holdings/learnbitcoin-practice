// Planning, building and signing a payment.
//
// A payment spends whole coins. The wallet picks coins worth at least the
// amount plus the fee, pays the recipient, and sends what is left back to
// itself at a fresh change address. Every input signals BIP125 replace-by-fee
// so a stuck payment can be bumped later.
//
// It happens in two steps, so that a reader sees what a payment will cost
// before any key is touched:
//   planPayment   chooses the coins and works out the fee. It needs only the
//                 account's public key, so it runs while the wallet is locked.
//   signPayment   makes the same choice again, builds the transaction and
//                 signs it. It needs the private account key.
// Both run the same choose() below, so the plan a reader agreed to is the
// payment that gets signed. Nothing here broadcasts anything.

import { hex } from '@scure/base';
import type { HDKey } from '@scure/bip32';
import { Transaction, selectUTXO } from '@scure/btc-signer';
import type { SelectionStrategy } from '@scure/btc-signer/utxo.js';
import { addressScript, checkAddress, dustLimit } from './address.ts';
import { type Chain, deriveAddress, privateKeyAt } from './keys.ts';
import { RBF_SEQUENCE, REGTEST } from './network.ts';
import { type Coin, type WalletAddress, type WalletState, coinTotals, isSpendable } from './scan.ts';

export type { SelectionStrategy };

export interface PaymentRequest {
  /** Recipient address on the practice network (bcrt1...). */
  to: string;
  /** In satoshis, or 'all': spend every spendable coin and send the recipient what is left after the fee. */
  amount: bigint | 'all';
  /** Fee rate in sat/vB (whole numbers, 1 or more; anything under 1 is refused as 'bad-fee'). */
  feeRate: bigint;
  /** Coin-selection strategy; see the coin-selection rabbit hole. Default: 'default'. Not used with 'all'. */
  strategy?: SelectionStrategy;
  /** Spend only these coins (coin control). Default: any coin in the wallet. */
  coins?: Coin[];
}

export interface PaymentOutput {
  address: string;
  amount: bigint;
  isChange: boolean;
  /** The output's position in the transaction. */
  vout: number;
}

export interface SignedPayment {
  txid: string;
  hex: string;
  /** In satoshis. */
  fee: bigint;
  vsize: number;
  /** Actual fee rate in sat/vB, after signing. */
  feeRate: number;
  /** The coins spent, in transaction order. */
  inputs: Coin[];
  /** In transaction order. */
  outputs: PaymentOutput[];
  /** The change index used, if any; applyPayment marks it used after broadcast. */
  changeIndex: number | null;
}

/**
 * Why a payment cannot be made. The reasons are looked for in this order,
 * and the first that fits is the answer:
 *   bad-fee            the fee rate is under 1 sat/vB. That limit is this
 *                      wallet's own: it takes whole numbers from 1 up. The
 *                      practice network's node relays lower rates as well
 *   nothing-spendable  the wallet (or the coin-control list) holds no coins
 *   unconfirmed-only   it holds coins, but all are payments still waiting for a block
 *   bad-address        `to` is not a practice-network address: it is mistyped,
 *                      or it is an address of another network
 *   below-dust         the amount is under the smallest the network relays to that address
 *   too-much           the coins cannot cover the amount plus the fee
 *   too-small          the address is a good one and the coins are enough, but
 *                      the transaction would be too small to relay (see
 *                      MIN_RELAY_SIZE). Rare: one coin in, no change, and an
 *                      address that stands for a script of only 4 bytes
 */
export type PlanFailure =
  | 'nothing-spendable'
  | 'unconfirmed-only'
  | 'too-much'
  | 'below-dust'
  | 'bad-address'
  | 'too-small'
  | 'bad-fee';

export type PaymentPlan =
  | {
      ok: true;
      /** What the recipient gets, in satoshis. */
      amount: bigint;
      /** Exactly the fee the signed payment will pay. */
      fee: bigint;
      /**
       * The size the signed payment will have, in vbytes. Never more. Now and
       * then a vbyte or two less, when signatures come out shorter than usual.
       */
      vsize: number;
      /**
       * fee / vsize, in sat/vB: the rate the payment will really pay. With
       * "send all" it is the rate asked for. With change it is a hair above
       * (the fee allows one spare byte per signature). Well above when a
       * leftover too small for change went to the fee.
       */
      feeRate: number;
      /** The coins the payment will spend, in transaction order. */
      inputs: Coin[];
      /** The change that comes back, or null when there is none. */
      change: bigint | null;
      /**
       * What "send all" would deliver to this address at this fee rate, or 0
       * when "send all" cannot be made. Nearly always that is also the most
       * any payment can deliver. There are two exceptions, both rare. A coin
       * that costs more to spend than it is worth (an input takes about 68
       * vbytes, so any coin of less than 68 times the fee rate) is spent by
       * "send all" all the same, and a payment that leaves it behind can
       * deliver more than this. And where "send all" would be too small a
       * transaction to relay (see MIN_RELAY_SIZE), a payment that has change
       * still goes through.
       */
      maxSendable: bigint;
    }
  | {
      ok: false;
      reason: PlanFailure;
      /**
       * The same figure as in a plan, with the same two exceptions: what
       * "send all" would deliver at this fee rate, or 0 when "send all"
       * cannot be made. With 'bad-fee' there is no fee rate to work it out
       * from, so it is 0 then too.
       */
      maxSendable: bigint;
      /** For 'below-dust': the smallest amount this address can be sent. Otherwise null. */
      dust: bigint | null;
    };

export class InsufficientFundsError extends Error {
  constructor() {
    super('Not enough coins to pay this amount plus the fee');
    this.name = 'InsufficientFundsError';
  }
}

function coinKey(coin: { txid: string; vout: number }): string {
  return `${coin.txid}:${coin.vout}`;
}

function sum(coins: Coin[]): bigint {
  return coins.reduce((total, c) => total + c.value, 0n);
}

// -- the shape of a transaction ------------------------------------------------

interface DraftOutput {
  address: string;
  script: Uint8Array;
  amount: bigint;
  isChange: boolean;
}

/** A payment worked out but not signed: enough to quote it, and enough to build it. */
interface Draft {
  inputs: Coin[];
  pay: DraftOutput;
  change: DraftOutput | null;
  fee: bigint;
}

/** How many bytes Bitcoin's "compact size" needs to write a count or a length. */
function compactSize(n: number): number {
  return n < 253 ? 1 : n <= 0xffff ? 3 : 5;
}

/**
 * The size in bytes, without witnesses, of a transaction that spends this
 * many of the wallet's coins to these output scripts.
 */
function strippedSize(inputs: number, outputScripts: Uint8Array[]): number {
  // The version (4 bytes), the two counts and the lock time (4 bytes) ...
  let size = 4 + compactSize(inputs) + compactSize(outputScripts.length) + 4;
  // ... each input: the coin it spends (32 + 4 bytes), an empty script (1) and a sequence number (4) ...
  size += inputs * 41;
  // ... and each output: an amount (8 bytes) and a script with its length.
  for (const script of outputScripts) size += 8 + compactSize(script.length) + script.length;
  return size;
}

/**
 * The size in vbytes of that transaction, worked out before anything is
 * signed. Fees are paid per virtual byte, and a virtual byte is 4 weight
 * units.
 *
 * Signatures vary a little in length. This wallet signs the way Bitcoin Core
 * does (see lowR below), which makes a signature 71 bytes at most and nearly
 * always exactly 71: about one in 128 comes out a byte shorter. So the
 * signed transaction is this size, or now and then a vbyte or two smaller,
 * and never larger: a fee worked out from it never falls short of the rate
 * asked for.
 */
function plannedVsize(inputs: number, outputScripts: Uint8Array[]): number {
  // Counted four times: everything but the witnesses.
  const base = strippedSize(inputs, outputScripts);
  // Counted once: the segwit marker and flag, and each input's witness. A
  // witness is an item count, a signature and a 33-byte public key, the last
  // two with a length byte each.
  const witness = 2 + inputs * (1 + 1 + 71 + 1 + 33);
  return Math.ceil((base * 4 + witness) / 4);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/**
 * BIP69: inputs and outputs go in a fixed order that says nothing about them.
 * Inputs by transaction ID, then output number.
 */
function inTransactionOrder(coins: Coin[]): Coin[] {
  return [...coins].sort((a, b) => (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : a.vout - b.vout));
}

/** Outputs by amount, then script. So the change is not always last, and its place gives nothing away. */
function outputsOf(draft: Draft): DraftOutput[] {
  const outputs = draft.change ? [draft.pay, draft.change] : [draft.pay];
  return outputs.sort((a, b) => (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : compareBytes(a.script, b.script)));
}

/**
 * Bitcoin Core relays no transaction of under 65 bytes, counted without its
 * witnesses (it answers "tx-size-small"). At exactly 64 bytes a transaction
 * is as long as two hashes side by side, and could be passed off as a
 * branch of a block's Merkle tree to a wallet that checks payments without
 * downloading blocks. So nodes refuse that size and everything below it.
 *
 * The wallet's payments are well clear of it, with one exception. One coin
 * paid on to one address like the wallet's own is 82 bytes. But an address
 * can stand for a script of only 4 bytes (pay-to-anchor, bcrt1pfeesnyr2tx,
 * is the one in use), and then one coin in, one output and no change come
 * to exactly 64.
 *
 * planPayment answers "too-small" for that payment, and signPayment does
 * not sign it. The same coin can still pay the same address where it has
 * room for change: a little less to the recipient, so that change comes
 * back, makes a transaction of 95 bytes. It has room when it covers the
 * amount (240 sats at the least for such an address), 294 sats of change
 * and the fee for two outputs, 123 vbytes. A coin of under 657 sats never
 * does, and the faucet's 100,000 sats do not from 809 sat/vB up. That one
 * coin can then pay such an address no amount at all: what helps is a
 * lower fee rate, or a second coin and an amount that takes both.
 */
const MIN_RELAY_SIZE = 65;

function tooSmallToRelay(draft: Draft): boolean {
  return strippedSize(draft.inputs.length, outputsOf(draft).map((o) => o.script)) < MIN_RELAY_SIZE;
}

// -- choosing coins --------------------------------------------------------------

type Choice =
  | { ok: true; draft: Draft; maxSendable: bigint }
  | { ok: false; reason: PlanFailure; maxSendable: bigint; dust: bigint | null };

/** What "send all" delivers: every coin goes in, one output comes out, and the fee is taken from the amount. */
function sweepAmount(coins: Coin[], script: Uint8Array, feeRate: bigint): bigint {
  return sum(coins) - feeRate * BigInt(plannedVsize(coins.length, [script]));
}

/**
 * The one place a payment is worked out. planPayment and signPayment both
 * call it with the same request and state, and it has no other input, so
 * they always arrive at the same coins and the same fee.
 */
function choose(account: HDKey, state: WalletState, req: PaymentRequest): Choice {
  const refuse = (reason: PlanFailure, maxSendable = 0n, dust: bigint | null = null): Choice => ({
    ok: false,
    reason,
    maxSendable,
    dust,
  });

  // The fee rate comes first, because every figure below is worked out from
  // it. A form can hand over a 0, so this is a reason like the others, not
  // an error. With no rate there is no figure: the most that can be sent is
  // given as 0.
  if (req.feeRate < 1n) return refuse('bad-fee');

  // What may be spent, in the order given (a coin listed twice counts once).
  const offered = req.coins ?? state.coins;
  const byKey = new Map(offered.filter(isSpendable).map((c) => [coinKey(c), c]));
  const pool = [...byKey.values()];
  if (pool.length === 0) return refuse(offered.length === 0 ? 'nothing-spendable' : 'unconfirmed-only');

  const change = deriveAddress(account, 1, state.nextChangeIndex);

  // Where to. Without a usable address there is no output to size, so what
  // "send all" would deliver is quoted for an address like the wallet's own.
  const to = checkAddress(req.to);
  if (to.kind !== 'practice') {
    const most = sweepAmount(pool, change.script, req.feeRate);
    return refuse('bad-address', most >= dustLimit(change.address) ? most : 0n);
  }
  const script = addressScript(to.address);
  const limit = dustLimit(to.address);
  const pay = (amount: bigint): DraftOutput => ({ address: to.address, script, amount, isChange: false });

  // How much. "Send all" is every coin in, no change, and whatever the
  // recipient does not get is the fee. It cannot be made when that leaves
  // the recipient less than the dust limit, or makes a transaction too small
  // to relay. (Nearly always it is also the most that can be sent: see
  // PaymentPlan.maxSendable.)
  const all = sweepAmount(pool, script, req.feeRate);
  const everything = (amount: bigint): Draft => ({
    inputs: inTransactionOrder(pool),
    pay: pay(amount),
    change: null,
    fee: sum(pool) - amount,
  });
  const maxSendable = all >= limit && !tooSmallToRelay(everything(all)) ? all : 0n;
  // Every payment leaves through here, so that one the network would not
  // relay is refused before anything is signed. The address is a good one
  // and the coins are enough: it is the transaction that would be too
  // small. So that has a reason of its own, and "bad-address" is only ever
  // said of text that is not a practice address.
  const accept = (draft: Draft): Choice =>
    tooSmallToRelay(draft) ? refuse('too-small', maxSendable) : { ok: true, maxSendable, draft };

  if (req.amount === 'all') return all >= limit ? accept(everything(all)) : refuse('below-dust', 0n, limit);
  if (req.amount < limit) return refuse('below-dust', maxSendable, limit);

  // An ordinary payment: the library picks the coins and prices the transaction.
  const picked = selectUTXO(
    pool.map((c) => ({
      txid: hex.decode(c.txid),
      index: c.vout,
      witnessUtxo: { script: c.script, amount: c.value },
      sequence: RBF_SEQUENCE,
    })),
    [{ script, amount: req.amount }],
    req.strategy ?? 'default',
    {
      feePerByte: req.feeRate,
      changeAddress: change.address,
      network: REGTEST,
      // Only the choice is wanted here. The wallet orders the transaction itself (BIP69, above).
      createTx: false,
      bip69: false,
      // Change is kept only when it is worth more than dust * dustRelayFeeRate
      // satoshis. One below the change address's dust limit turns that into
      // "at least the limit"; a smaller leftover goes to the fee instead.
      dust: dustLimit(change.address) - 1n,
      dustRelayFeeRate: 1n,
      // The recipient is given as a script the wallet built from a checked
      // address, which may be a kind the library has no name for yet.
      allowUnknownOutputs: true,
    },
  );
  if (!picked || picked.fee === undefined) {
    // The library allows one byte more per signature than this wallet's
    // signatures take, so within a few sats of what "send all" delivers it
    // says no where "send all" says yes. Then every coin goes in, and those
    // few sats are added to the fee.
    return req.amount <= all ? accept(everything(req.amount)) : refuse('too-much', maxSendable);
  }

  const inputs = inTransactionOrder(
    picked.inputs.map((input) => {
      const key = input.txid && input.index !== undefined ? coinKey({ txid: hex.encode(input.txid), vout: input.index }) : '';
      const coin = byKey.get(key);
      if (!coin) throw new Error('Selected an input the wallet does not own');
      return coin;
    }),
  );
  const left = sum(inputs) - req.amount - picked.fee;
  return accept({
    inputs,
    pay: pay(req.amount),
    change: picked.change ? { address: change.address, script: change.script, amount: left, isChange: true } : null,
    fee: picked.fee,
  });
}

// -- plan, sign, apply -----------------------------------------------------------

/**
 * What a payment would cost, or why it cannot be made. Needs no private key:
 * a watch-only account (watchOnlyAccount(xpub)) is enough. Never signs
 * anything. Whatever a form can hand over comes back as a plan or as a
 * reason, never as an error: any text for the address, any amount, and any
 * fee rate, one under 1 included.
 */
export function planPayment(account: HDKey, state: WalletState, req: PaymentRequest): PaymentPlan {
  const choice = choose(account, state, req);
  if (!choice.ok) return choice;
  const { draft, maxSendable } = choice;
  const vsize = plannedVsize(draft.inputs.length, outputsOf(draft).map((o) => o.script));
  return {
    ok: true,
    amount: draft.pay.amount,
    fee: draft.fee,
    vsize,
    feeRate: Number(draft.fee) / vsize,
    inputs: draft.inputs,
    change: draft.change ? draft.change.amount : null,
    maxSendable,
  };
}

/**
 * Choose coins exactly as planPayment does, build the transaction and sign
 * every input. Needs the private account key. Nothing is broadcast. Throws
 * where planPayment would have answered with a reason
 * (InsufficientFundsError when the coins do not cover the payment).
 */
export function signPayment(account: HDKey, state: WalletState, req: PaymentRequest): SignedPayment {
  if (req.amount !== 'all' && req.amount <= 0n) throw new Error('Amount must be positive');
  const choice = choose(account, state, req);
  if (!choice.ok) {
    if (choice.reason === 'bad-fee') throw new Error('Fee rate must be at least 1 sat/vB');
    if (choice.reason === 'bad-address') throw new Error('Not a practice-network address');
    if (choice.reason === 'too-small') throw new Error('This payment would make a transaction too small to relay');
    if (choice.reason === 'below-dust') throw new Error(`Amount is below the dust limit of ${choice.dust} sats`);
    // What is left: no coins, none that can be spent yet, or not enough of them.
    throw new InsufficientFundsError();
  }
  const { draft } = choice;
  const outputs = outputsOf(draft);

  // lowR: sign again, as Bitcoin Core does, until the signature's first
  // number fits in 32 bytes. That caps a signature at 71 bytes, the length
  // plannedVsize counts on.
  const tx = new Transaction({ lowR: true, allowUnknownOutputs: true });
  for (const coin of draft.inputs) {
    tx.addInput({
      txid: hex.decode(coin.txid),
      index: coin.vout,
      witnessUtxo: { script: coin.script, amount: coin.value },
      sequence: RBF_SEQUENCE,
    });
  }
  for (const output of outputs) tx.addOutput({ script: output.script, amount: output.amount });
  draft.inputs.forEach((coin, i) => tx.signIdx(privateKeyAt(account, coin.chain, coin.index), i));
  tx.finalize();

  // The reader agreed to the plan, so the signed transaction must match it.
  if (tx.fee !== draft.fee) throw new Error('The signed transaction does not pay the planned fee');

  return {
    txid: tx.id,
    hex: tx.hex,
    fee: tx.fee,
    vsize: tx.vsize,
    feeRate: Number(tx.fee) / tx.vsize,
    inputs: draft.inputs,
    outputs: outputs.map((o, vout) => ({ address: o.address, amount: o.amount, isChange: o.isChange, vout })),
    changeIndex: draft.change ? state.nextChangeIndex : null,
  };
}

/** The name the first version of this package used. The tools still call it. */
export const buildPayment = signPayment;

/**
 * The wallet as it stands once a payment has been broadcast, without waiting
 * for the network to report it: the coins it spent are gone, and every output
 * that pays one of the wallet's own addresses (the change, or a payment to
 * itself) is a new unconfirmed coin. Those addresses now count as used, so
 * the next payment gets a fresh change address. Returns a new state; the one
 * passed in is not changed.
 */
export function applyPayment(state: WalletState, payment: SignedPayment): WalletState {
  // Where each of the wallet's addresses sits: chain, index and script.
  const known = new Map<string, { chain: Chain; index: number; script: Uint8Array }>();
  for (const c of state.coins) known.set(c.address, c);
  for (const a of [...state.receive, ...state.change]) known.set(a.address, a);
  // The change address always belongs to the wallet, even if the list of
  // scanned addresses ends before it. It is noted before the outputs are
  // gone through, so that a payment to that same address counts as the
  // wallet's too, wherever in the transaction it stands.
  const change = payment.outputs.find((o) => o.isChange);
  if (change && payment.changeIndex !== null && !known.has(change.address)) {
    known.set(change.address, { chain: 1, index: payment.changeIndex, script: addressScript(change.address) });
  }

  const created: Coin[] = [];
  for (const output of payment.outputs) {
    const home = known.get(output.address);
    if (!home) continue;
    created.push({
      txid: payment.txid,
      vout: output.vout,
      value: output.amount,
      status: { confirmed: false },
      chain: home.chain,
      index: home.index,
      address: output.address,
      script: home.script,
    });
  }

  const gone = new Set([...payment.inputs, ...created].map(coinKey));
  const coins = [...state.coins.filter((c) => !gone.has(coinKey(c))), ...created];

  const markUsed = (list: WalletAddress[], chain: Chain): WalletAddress[] => {
    const paid = new Set(created.filter((c) => c.chain === chain).map((c) => c.index));
    return list.map((a) => (paid.has(a.index) && !a.used ? { ...a, used: true } : a));
  };
  const next = (current: number, chain: Chain): number =>
    created.filter((c) => c.chain === chain).reduce((n, c) => Math.max(n, c.index + 1), current);

  return {
    receive: markUsed(state.receive, 0),
    change: markUsed(state.change, 1),
    coins,
    nextReceiveIndex: next(state.nextReceiveIndex, 0),
    nextChangeIndex: next(state.nextChangeIndex, 1),
    ...coinTotals(coins),
  };
}
