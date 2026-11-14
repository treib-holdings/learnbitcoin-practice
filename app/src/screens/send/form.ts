// What the Send form makes of what the reader typed, as plain functions so
// that "node --test" can check every one: which kind of address the "To"
// field holds, what a pasted payment link fills in, whether the amount and
// the fee rate can be used, the payment request the three fields stand
// for once all of them are good, and a signed payment in the form's own terms.
//
// The form checks its own fields first and asks the wallet for a plan only
// when all three are good (SPEC section 7). So a plan is never asked for
// with an address of another network, an amount with a period in it or a
// fee rate outside what this wallet takes.

import {
  isSpendable,
  parsePaymentInput,
  type PaymentRequest,
  type SignedPayment,
  type TxView,
  type WalletState,
} from '@learnbitcoin/practice-wallet';
import { formatSats, parseSats } from '../../lib/format.ts';

// -- the address ------------------------------------------------------------------

/**
 * What the "To" field holds:
 *   empty               nothing typed yet: nothing is wrong, and nothing can be planned
 *   practice            an address the practice network pays. `address` is its tidy spelling
 *   other-test-network  a tb1 address: the same address written for another test
 *                       network. `practiceAddress` is how the practice network writes it
 *   mainnet             an address of Bitcoin's real network: refused, always
 *   invalid             anything else: not an address
 */
export type ToRead =
  | { kind: 'empty' }
  | { kind: 'practice'; address: string }
  | { kind: 'other-test-network'; practiceAddress: string }
  | { kind: 'mainnet' }
  | { kind: 'invalid' };

/** Reads the "To" field: a bare address, or a "bitcoin:" payment link that carries one. */
export function readTo(input: string): ToRead {
  if (input.trim() === '') return { kind: 'empty' };
  return parsePaymentInput(input).address;
}

/** What a payment link puts into the form. */
export interface LinkFill {
  /** The link's address in its tidy spelling, when it is a practice address. Null: the field stays as typed. */
  to: string | null;
  /** The link's amount as the amount field writes it ("100,000"), when it names one above 0. */
  amount: string | null;
}

/**
 * A "bitcoin:" payment link in the "To" field: what it fills in, or null
 * for text that is no such link. A link whose address is no address at all
 * fills in nothing, its amount included: an amount that came with a broken
 * address is not one to trust.
 */
export function readLink(input: string): LinkFill | null {
  const text = input.trim();
  if (!/^bitcoin:/i.test(text)) return null;
  const { address, amountSats } = parsePaymentInput(text);
  if (address.kind === 'invalid') return { to: null, amount: null };
  return {
    to: address.kind === 'practice' ? address.address : null,
    // A link may say "amount=0": that is no amount to fill in.
    amount: amountSats !== null && amountSats > 0n ? formatSats(amountSats) : null,
  };
}

// -- the amount -------------------------------------------------------------------

/**
 * What the amount field holds:
 *   empty    nothing typed yet
 *   all      "Send all" is switched on: the field is not read
 *   sats     a whole number of sats (0 included: the planner then says it is too small)
 *   period   the text has a period in it. Sats are whole, so that is refused, with the reason
 *   invalid  anything else
 */
export type AmountRead =
  | { kind: 'empty' }
  | { kind: 'all' }
  | { kind: 'sats'; sats: bigint }
  | { kind: 'period' }
  | { kind: 'invalid' };

export function readAmount(input: string, sendAll: boolean): AmountRead {
  if (sendAll) return { kind: 'all' };
  const read = parseSats(input);
  return typeof read === 'bigint' ? { kind: 'sats', sats: read } : { kind: read };
}

// -- the fee rate -----------------------------------------------------------------

/**
 * The fee rates the form takes, in sat/vB: whole numbers from `min` to
 * `max`, and `start` in the field when the screen opens. The limits are
 * this wallet's own. The practice network's node relays lower rates as
 * well, so no text may say that the network refuses them.
 */
export const FEE_RATE = { min: 1n, max: 1_000n, start: 2n } as const;

/**
 * What the fee field holds:
 *   rate       a whole number the form takes
 *   empty      the reader cleared the field
 *   low        a whole number under the lowest
 *   high       a whole number over the highest
 *   not-whole  a period, or anything else that is not a whole number
 */
export type FeeRead =
  | { kind: 'rate'; rate: bigint }
  | { kind: 'empty' }
  | { kind: 'low' }
  | { kind: 'high' }
  | { kind: 'not-whole' };

export function readFee(input: string): FeeRead {
  // The same reading as an amount: digits, with commas only where "1,000" has one.
  const read = parseSats(input);
  if (read === 'empty') return { kind: 'empty' };
  if (typeof read !== 'bigint') return { kind: 'not-whole' };
  if (read < FEE_RATE.min) return { kind: 'low' };
  if (read > FEE_RATE.max) return { kind: 'high' };
  return { kind: 'rate', rate: read };
}

// -- the request ------------------------------------------------------------------

/**
 * The payment the form stands for, once all three fields are good, and null
 * until then. The amount is passed on as typed: it is never cut down to what
 * "Send all" would deliver, which can be less than an ordinary payment can.
 */
export function requestOf(to: ToRead, amount: AmountRead, fee: FeeRead): PaymentRequest | null {
  if (to.kind !== 'practice' || fee.kind !== 'rate') return null;
  if (amount.kind === 'all') return { to: to.address, amount: 'all', feeRate: fee.rate };
  if (amount.kind === 'sats') return { to: to.address, amount: amount.sats, feeRate: fee.rate };
  return null;
}

// -- what can be spent ------------------------------------------------------------

export interface Funds {
  /** How many coins the wallet holds, spendable or not. */
  coins: number;
  /** What a payment may spend now: confirmed coins, and the wallet's own unconfirmed change. */
  spendable: bigint;
  /** Unconfirmed coins somebody else sent: they cannot be spent until they are in a block. */
  waiting: bigint;
}

/** The wallet's coins as the form names them: what can be spent now, and what cannot yet. */
export function fundsOf(state: WalletState): Funds {
  let spendable = 0n;
  let waiting = 0n;
  for (const coin of state.coins) {
    if (isSpendable(coin)) spendable += coin.value;
    else waiting += coin.value;
  }
  return { coins: state.coins.length, spendable, waiting };
}

// -- a signed payment, in the form's own terms --------------------------------------

export interface PaymentFacts {
  /** The address that is paid. */
  to: string;
  /** What that address gets. */
  amount: bigint;
  fee: bigint;
  /** What comes back to the wallet, or null when the payment has no change. */
  change: bigint | null;
  /**
   * The amount and the fee together: what the payment takes out of the
   * wallet's coins. Not always what leaves the wallet: paid to one of its
   * own addresses, the amount comes back (paysOwn).
   */
  total: bigint;
}

/**
 * The same five facts the plan showed, read back from the payment as it
 * was signed, so that the review can set them beside the transaction's
 * inputs and outputs. Null for something that is not one of this wallet's
 * payments (it has no output that is not change).
 */
export function factsOf(payment: SignedPayment): PaymentFacts | null {
  const paid = payment.outputs.find((output) => !output.isChange);
  if (paid === undefined) return null;
  const change = payment.outputs.find((output) => output.isChange);
  return {
    to: paid.address,
    amount: paid.amount,
    fee: payment.fee,
    change: change === undefined ? null : change.amount,
    total: paid.amount + payment.fee,
  };
}

/**
 * True when the address a signed payment pays is one of this wallet's own:
 * the address the Receive screen shows, say, or the address of one of its
 * coins. `view` is the same payment as the wallet sees it (SignResult.view),
 * which marks every output that is the wallet's. The amount then comes
 * back to the wallet, and only the fee leaves it.
 */
export function paysOwn(payment: SignedPayment, view: TxView): boolean {
  const paid = payment.outputs.find((output) => !output.isChange);
  if (paid === undefined) return false;
  return view.outputs.some((output) => output.address === paid.address && output.mine);
}
