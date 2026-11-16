// "What just happened": a transaction read out in plain sentences.
//
// The transaction screen shows a transaction as it is: inputs, outputs, a
// fee. This file says what that means for this wallet, in three to five
// sentences worked out from the transaction itself and from nothing else,
// always in the same order: what was spent, what went where, the change,
// the fee, and where the transaction stands.
//
// It writes no sentence. It answers with keys and slots: which sentence,
// and the amounts, counts and addresses that go into it. The string table
// holds each sentence in both languages, and the screen puts the two
// together. So nothing is fetched, nothing is guessed, and a figure on
// screen is always one that was computed here:
//
//   - A sentence about change is only ever about this wallet's own change.
//     A wallet knows which outputs are its own; of anybody else's outputs
//     it can only say that they are not, and the sentence says no more.
//   - The fee is given first the way chapter 3 gives it, with the figures:
//     what went in, less what came out. Then as a rate, the fee divided by
//     the size. When that does not divide evenly the sentence says "about":
//     no product that does not multiply out is ever shown.
//
// Pure: the same transaction gives the same sentences.

import type { TxPart, TxView } from '@learnbitcoin/practice-wallet';

/**
 * The terms a newcomer meets in these sentences, by the name of their entry
 * in the map of glossary entries the read screens keep (screens/read/read.ts):
 *
 *   utxo     a coin
 *   change   change
 *   fee      the fee
 *   block    a block
 *   mempool  the waiting room
 *
 * Each has an entry in the main site's glossary in both languages.
 */
export const EXPLAIN_TERMS = ['utxo', 'change', 'fee', 'block', 'mempool'] as const;
export type ExplainTerm = (typeof EXPLAIN_TERMS)[number];

/**
 * Every sentence there is, with the slots it takes. A slot's name says what
 * kind of value it holds (Slots, below). The string table has one text for
 * each key, with exactly these slots.
 *
 * What was spent:
 *   explain_spentOne      one coin of this wallet's was spent: {amount}
 *   explain_spentMany     {count} coins of this wallet's were spent, {amount} in all
 *   explain_theirsOne     the one coin spent ({amount}) was not this wallet's
 *   explain_theirsMany    the {count} coins spent ({amount} in all) were not this wallet's
 *   explain_newCoins      nothing was spent: these are new coins, made by the block itself
 * What went where:
 *   explain_paid          {amount} went to {address}, the address paid
 *   explain_paidOdd       {amount} went to an output that has no address
 *   explain_paidMany      {amount} went to {count} outputs that are not this wallet's
 *   explain_got           {amount} came to this wallet, at its address {address}
 *   explain_gotMany       {amount} came to this wallet, in {count} outputs
 *   explain_other         {amount} went to an address that is not this wallet's, most likely the
 *                         sender's own change. A wallet knows its own change and can only guess
 *                         at someone else's. (Never "there was no change".)
 *   explain_otherMany     the same, for {count} such outputs and {amount} in all
 *   explain_selfOne       all of it, {amount}, came back to this wallet in one output
 *   explain_selfMany      all of it, {amount}, came back to this wallet in {count} outputs
 * The change:
 *   explain_change        {amount} came back as change, to {address}, a fresh address of this wallet
 *   explain_back          {amount} came back to this wallet (more than one output, or not on its change chain)
 *   explain_noChange      no change came back: the payment and the fee used up everything the coins
 *                         held (either everything was sent, or what was left over was too small to
 *                         be a coin and went to the fee)
 * The fee ({in} what went in, {out} what came out, {fee} = {in} - {out}, {size} in vB, {rate} in sat/vB):
 *   explain_fee           a coin of this wallet's was spent, and the rate is a whole number: {fee} = {rate} x {size}
 *   explain_feeAbout      the same, and the rate is not whole: it is said with "about"
 *   explain_feeTheirs     no coin of this wallet's was spent: the sender paid the fee
 *   explain_feeTheirsAbout
 * Where it stands:
 *   explain_waiting       it is not in a block yet: it waits in the waiting room
 *   explain_inBlock       block {height} took it in
 *   explain_confirmed     a block took it in (which one is not known)
 */
export const EXPLAIN_SLOTS = {
  explain_spentOne: ['amount'],
  explain_spentMany: ['count', 'amount'],
  explain_theirsOne: ['amount'],
  explain_theirsMany: ['count', 'amount'],
  explain_newCoins: [],
  explain_paid: ['amount', 'address'],
  explain_paidOdd: ['amount'],
  explain_paidMany: ['count', 'amount'],
  explain_got: ['amount', 'address'],
  explain_gotMany: ['count', 'amount'],
  explain_other: ['amount'],
  explain_otherMany: ['count', 'amount'],
  explain_selfOne: ['amount'],
  explain_selfMany: ['count', 'amount'],
  explain_change: ['amount', 'address'],
  explain_back: ['amount'],
  explain_noChange: [],
  explain_fee: ['in', 'out', 'fee', 'size', 'rate'],
  explain_feeAbout: ['in', 'out', 'fee', 'size', 'rate'],
  explain_feeTheirs: ['in', 'out', 'fee', 'size', 'rate'],
  explain_feeTheirsAbout: ['in', 'out', 'fee', 'size', 'rate'],
  explain_waiting: [],
  explain_inBlock: ['height'],
  explain_confirmed: [],
} as const satisfies Record<string, readonly (keyof Slots)[]>;

export type ExplainKey = keyof typeof EXPLAIN_SLOTS;

/**
 * The values a sentence takes, by slot. The screen formats each by its
 * kind: an amount in practice sats, an address as an address.
 */
export interface Slots {
  /** An amount, in sats. */
  amount?: bigint;
  /** The fee's figures, in sats: what went in, what came out, and the difference. */
  in?: bigint;
  out?: bigint;
  fee?: bigint;
  /** How many coins or outputs: 2 or more wherever a sentence takes it. */
  count?: number;
  /** A practice-network address. */
  address?: string;
  /** The transaction's size, in vB. */
  size?: number;
  /** The fee rate, in sat/vB. A whole number unless the sentence is an "about" one. */
  rate?: number;
  /** A block's height. */
  height?: number;
}

export interface Sentence {
  key: ExplainKey;
  /** Exactly the slots EXPLAIN_SLOTS lists for the key. */
  slots: Slots;
  /** The terms this sentence uses that a newcomer may not know, for links to the glossary. */
  terms: ExplainTerm[];
}

const sum = (parts: readonly TxPart[]): bigint => parts.reduce((total, part) => total + part.value, 0n);

/** An input that spends no coin: where a block's new coins come from. */
const isNewCoins = (part: TxPart): boolean => part.address === null && part.value === 0n;

/** What was spent, when at least one of the coins was this wallet's: its own coins, counted and added up. */
function spent(view: TxView): Sentence {
  const mine = view.inputs.filter((part) => part.mine);
  return mine.length === 1
    ? { key: 'explain_spentOne', slots: { amount: sum(mine) }, terms: ['utxo'] }
    : { key: 'explain_spentMany', slots: { count: mine.length, amount: sum(mine) }, terms: ['utxo'] };
}

/** What was spent, when none of it was this wallet's. */
function spentByOthers(view: TxView): Sentence {
  if (view.inputs.length === 0 || view.inputs.some(isNewCoins)) return { key: 'explain_newCoins', slots: {}, terms: ['block'] };
  return view.inputs.length === 1
    ? { key: 'explain_theirsOne', slots: { amount: sum(view.inputs) }, terms: ['utxo'] }
    : { key: 'explain_theirsMany', slots: { count: view.inputs.length, amount: sum(view.inputs) }, terms: ['utxo'] };
}

/**
 * The fee: first as what went in less what came out, then as a rate. Null
 * when the figures do not make that sum (a block's first transaction spends
 * nothing and pays no fee) or the size is not a size: a sentence whose
 * arithmetic does not hold is not said.
 */
function fee(view: TxView, theirs: boolean): Sentence | null {
  const went = sum(view.inputs);
  const came = sum(view.outputs);
  const size = view.vsize;
  if (went - came !== view.fee || view.fee < 0n || !Number.isSafeInteger(size) || size <= 0) return null;
  // A whole rate is one the reader can multiply back: {rate} x {size} = {fee}. Anything else is "about".
  const whole = view.fee % BigInt(size) === 0n;
  const rate = whole ? Number(view.fee / BigInt(size)) : Number(view.fee) / size;
  const key: ExplainKey = theirs ? (whole ? 'explain_feeTheirs' : 'explain_feeTheirsAbout') : whole ? 'explain_fee' : 'explain_feeAbout';
  return { key, slots: { in: went, out: came, fee: view.fee, size, rate }, terms: ['fee'] };
}

/** Where the transaction stands: in the waiting room, or in a block. */
function standing(view: TxView): Sentence {
  if (!view.confirmed) return { key: 'explain_waiting', slots: {}, terms: ['mempool'] };
  return view.height === null
    ? { key: 'explain_confirmed', slots: {}, terms: ['block'] }
    : { key: 'explain_inBlock', slots: { height: view.height }, terms: ['block'] };
}

/**
 * The sentences for one transaction, in the order they are read. Empty for
 * a transaction that does not touch this wallet: there is nothing to say
 * about it from here.
 */
export function explain(view: TxView): Sentence[] {
  if (view.direction === 'other') return [];
  const sentences: Sentence[] = [];
  const mine = view.outputs.filter((part) => part.mine);
  // An output that carries nothing (a note written into the transaction) went nowhere.
  const others = view.outputs.filter((part) => !part.mine && part.value > 0n);
  const spentOwn = view.inputs.some((part) => part.mine);

  // 1. What was spent.
  sentences.push(spentOwn ? spent(view) : spentByOthers(view));

  // 2. What went where, and 3. the change.
  if (view.direction === 'internal') {
    // The wallet paid itself: every output is its own, so "payment" and "change" are one thing here.
    sentences.push(
      mine.length === 1
        ? { key: 'explain_selfOne', slots: { amount: sum(mine) }, terms: [] }
        : { key: 'explain_selfMany', slots: { count: mine.length, amount: sum(mine) }, terms: [] },
    );
  } else if (view.direction === 'sent') {
    const [only] = others;
    if (others.length === 1 && only !== undefined) {
      sentences.push(
        only.address === null
          ? { key: 'explain_paidOdd', slots: { amount: only.value }, terms: [] }
          : { key: 'explain_paid', slots: { amount: only.value, address: only.address }, terms: [] },
      );
    } else if (others.length > 1) {
      sentences.push({ key: 'explain_paidMany', slots: { count: others.length, amount: sum(others) }, terms: [] });
    }
    // The change: what came back to this wallet, or why nothing did.
    const [back] = mine;
    if (mine.length === 0) {
      sentences.push({ key: 'explain_noChange', slots: {}, terms: ['change'] });
    } else if (mine.length === 1 && back !== undefined && back.change && back.address !== null) {
      sentences.push({ key: 'explain_change', slots: { amount: back.value, address: back.address }, terms: ['change'] });
    } else {
      sentences.push({ key: 'explain_back', slots: { amount: sum(mine) }, terms: ['change'] });
    }
  } else {
    // Received. What came to this wallet, and to which of its addresses.
    const [got] = mine;
    if (mine.length === 1 && got !== undefined && got.address !== null) {
      sentences.push({ key: 'explain_got', slots: { amount: got.value, address: got.address }, terms: [] });
    } else if (mine.length > 0) {
      sentences.push({ key: 'explain_gotMany', slots: { count: mine.length, amount: sum(mine) }, terms: [] });
    }
    // Of any other output, only this: it is not this wallet's. Whose change it is can be guessed, not known.
    const [other] = others;
    if (others.length === 1 && other !== undefined) {
      sentences.push({ key: 'explain_other', slots: { amount: other.value }, terms: ['change'] });
    } else if (others.length > 1) {
      sentences.push({ key: 'explain_otherMany', slots: { count: others.length, amount: sum(others) }, terms: ['change'] });
    }
  }

  // 4. The fee, and 5. where the transaction stands.
  const paid = fee(view, !spentOwn);
  if (paid !== null) sentences.push(paid);
  sentences.push(standing(view));
  return sentences;
}
