// Small decisions the coin and transaction pieces make, as plain functions
// so that "node --test" can check them: how a fee rate is written, when a
// transaction is said to have happened, what marks an input or an output,
// and when a transaction owes the reader a word about its missing change.

import type { TxPart, TxView } from '@learnbitcoin/practice-wallet';
import { formatSats } from '../../lib/format.ts';

/**
 * A fee rate in sat/vB, to two decimal places at most: "2", "2.01", "1,000".
 * Written out by hand like every number in the app, so it reads the same in
 * every browser and in both languages.
 */
export function feeRateText(rate: number): string {
  if (!Number.isFinite(rate) || rate < 0) return '0';
  const hundredths = Math.round(rate * 100);
  const whole = Math.floor(hundredths / 100);
  const rest = hundredths % 100;
  const digits = formatSats(whole);
  if (rest === 0) return digits;
  // "2.5" and not "2.50"; "2.05" keeps its zero.
  return `${digits}.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

/** How a row says when a transaction happened. */
export type TxWhen =
  /** Not in a block yet. */
  | { kind: 'unconfirmed' }
  /** In a block whose time is not known. */
  | { kind: 'confirmed' }
  /** In a block less than a day ago: said as elapsed time. `seconds` is never below 0. */
  | { kind: 'ago'; seconds: number }
  /** In a block a day ago or more: said as a date. `time` is in seconds since 1970. */
  | { kind: 'date'; time: number };

const DAY = 86_400;

/** When a transaction happened, seen at `nowMs` (milliseconds since 1970). */
export function txWhen(view: Pick<TxView, 'confirmed' | 'time'>, nowMs: number): TxWhen {
  if (!view.confirmed) return { kind: 'unconfirmed' };
  if (view.time === null) return { kind: 'confirmed' };
  // A block's time and the reader's clock never agree exactly: a block
  // "from the future" happened just now.
  const seconds = Math.max(0, Math.floor(nowMs / 1000) - view.time);
  return seconds < DAY ? { kind: 'ago', seconds } : { kind: 'date', time: view.time };
}

/**
 * What marks one input or one output:
 *   change  an output that brings the rest of the spent coins back to this wallet
 *   mine    any other input or output of this wallet's
 *   none    somebody else's
 * An input that spends one of the wallet's change coins is just "mine":
 * "change" says where an output goes, and an input goes nowhere.
 */
export function partMark(part: Pick<TxPart, 'mine' | 'change'>, side: 'input' | 'output'): 'change' | 'mine' | 'none' {
  if (!part.mine) return 'none';
  return side === 'output' && part.change ? 'change' : 'mine';
}

/**
 * What stands where an input's or an output's address would:
 *   address    it has one
 *   new-coins  an input with no address and no value: the first transaction
 *              of a block, which spends nothing and makes the block's new coins
 *   none       a script that has no address form
 */
export function partPlace(part: Pick<TxPart, 'address' | 'value'>, side: 'input' | 'output'): 'address' | 'new-coins' | 'none' {
  if (part.address !== null) return 'address';
  return side === 'input' && part.value === 0n ? 'new-coins' : 'none';
}

/**
 * True when this wallet spent coins in the transaction and none of the
 * outputs is its change. The reader is then told why: a payment without
 * change looks like a mistake until it is explained.
 */
export function lacksChange(view: Pick<TxView, 'inputs' | 'outputs'>): boolean {
  return view.inputs.some((part) => part.mine) && !view.outputs.some((part) => part.mine && part.change);
}
