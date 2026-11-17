// What the wallet's four looking screens decide, as plain functions so that
// "node --test" can check them: the Overview, Coins, Activity and the screen
// of one transaction. None of them needs a key, so none of this ever asks
// for a passkey.
//
// A screen draws; what to draw for which answer is worked out here.

import type { Lang } from '@learnbitcoin/practice-contract';
import type { TxView } from '@learnbitcoin/practice-wallet';
import type { ApiFailure } from '../../lib/api.ts';
import type { CeremonyFailure, TxLookup, UnlockResult } from '../../lib/wallet-api.ts';

// -- the Overview -------------------------------------------------------------------

/** How many coins the Overview lists before it points to the Coins screen. */
export const OVERVIEW_COINS = 3;

/** How many transactions the Overview lists before it points to the Activity screen. */
export const OVERVIEW_TXS = 3;

/** The first `count` of a list, as a new list. The wallet's own lists are never changed in place. */
export function firstFew<T>(list: readonly T[], count: number): T[] {
  return list.slice(0, Math.max(0, count));
}

/**
 * What stands where the Overview lists coins, once the coins are known:
 *   coins     the first few of them
 *   no-coins  "No coins yet." and the way to the faucet
 *   causes    a wallet just opened with a passkey that has no history: the
 *             likely causes, each with its way out, in place of the bare
 *             empty line (SPEC section 6)
 * A wallet that holds a coin is never explained away, whatever else is said.
 */
export function overviewBody(wallet: { coins: number; openedEmpty: boolean }): 'coins' | 'no-coins' | 'causes' {
  if (wallet.coins > 0) return 'coins';
  return wallet.openedEmpty ? 'causes' : 'no-coins';
}

// -- the list of transactions (Overview and Activity) -------------------------------

/**
 * What a list of the wallet's transactions shows:
 *   loading  the list has not been read yet
 *   unread   it could not be read, and there is no older list to show
 *   empty    the wallet has no transactions
 *   rows     the transactions
 * `failure` is why the latest read failed. Beside "empty" and "rows" it
 * means that what is shown is the list as it was last read: the old list
 * stays, and the cause and "Try again" stand above it (activityNotice
 * says whose they are).
 */
export interface ActivityShows {
  list: 'loading' | 'unread' | 'empty' | 'rows';
  failure: ApiFailure | null;
}

export function activityShows(history: readonly unknown[] | null, failure: ApiFailure | null): ActivityShows {
  if (history === null) return { list: failure === null ? 'loading' : 'unread', failure };
  return { list: history.length === 0 ? 'empty' : 'rows', failure };
}

/**
 * Who says that the list could not be read. `failure` is why the list's
 * latest read failed, `chainError` why the latest look at the coins did.
 *   none   nobody: no read of the list has failed
 *   list   the list itself: the cause, what the page does about it by
 *          itself, and "Try again"
 *   frame  the wallet frame. It already says that the practice network
 *          could not be read, with a "Try again" of its own, and that
 *          button has the list read again too. The same cause a second
 *          time, over a second button, would leave the reader to choose
 *          between two of a kind.
 */
export function activityNotice(failure: ApiFailure | null, chainError: ApiFailure | null): 'none' | 'list' | 'frame' {
  if (failure === null) return 'none';
  return chainError === null ? 'list' : 'frame';
}


// -- another passkey, from the Overview of a wallet that was opened empty -----------

/**
 * What the Overview does with each answer to "Choose another passkey":
 *   same      the reader chose the passkey this browser already holds
 *   tampered  the same passkey, but what this browser had saved was wrong and
 *             has been rebuilt: the wallet frame tells the reader
 *   question  another passkey answered: the reader is asked before this
 *             browser is switched to its wallet
 *   changed   the stored passkey now gives a wallet that fits nothing saved here
 *   gone      the wallet was removed or replaced in another tab
 *   passkey   the passkey step did not finish; `failure` says how
 */
export type ChooseOutcome =
  | { show: 'same' }
  | { show: 'tampered' }
  | { show: 'question' }
  | { show: 'changed' }
  | { show: 'gone' }
  | { show: 'passkey'; failure: CeremonyFailure };

/** The outcomes that are told in a notice of this part's own (read/ChooseAnswer.svelte). */
export type ChooseTold = Extract<ChooseOutcome, { show: 'same' | 'changed' | 'gone' | 'passkey' }>;

/**
 * The outcomes this part's own notice must still tell when the list of
 * causes has left the screen by the time the passkey answers. That happens
 * when what this browser has stored was changed behind the page: the
 * wallet reads the storage again before it opens the prompt, and what it
 * then shows is no longer a wallet "just opened". Both are warnings the
 * reader has to get, so the Overview, which stays, draws them. (A third
 * answer to such a change, the record rebuilt from the keys, is told by
 * the wallet frame's own note.)
 */
export type ChooseLate = Extract<ChooseOutcome, { show: 'changed' | 'gone' }>;

export function afterChoose(result: UnlockResult): ChooseOutcome {
  switch (result.kind) {
    case 'unlocked':
      return { show: 'same' };
    case 'tampered':
      return { show: 'tampered' };
    case 'other-passkey':
      return { show: 'question' };
    case 'changed':
      return { show: 'changed' };
    case 'gone':
      return { show: 'gone' };
    case 'cancelled':
    case 'no-prf':
    case 'error':
    case 'busy':
    case 'reload':
    case 'broken':
      return { show: 'passkey', failure: result };
  }
}

// -- links that leave the app -------------------------------------------------------

/**
 * Entries of the main site's glossary, by the last part of their address in
 * each language. The Spanish glossary lives under /es/glosario and names its
 * entries itself; every one of these exists in both languages (each was
 * looked up in the site's content, English and Spanish, before it was put
 * here). "What just happened" on the transaction screen links the five
 * terms a newcomer meets there: a coin (utxo), change, the fee, a block and
 * the waiting room (mempool). The first "Do it" step, which explains each
 * new thing itself, links three more: a wallet, an address and the 12
 * words (the seed phrase). It links a block as well, which is in the map
 * already.
 */
const GLOSSARY = {
  utxo: { en: 'utxo-unspent-transaction-output', es: 'utxo' },
  rbf: { en: 'replace-fee-rbf', es: 'rbf' },
  change: { en: 'change-output', es: 'salida-de-cambio' },
  fee: { en: 'transaction-fee', es: 'comision-de-transaccion' },
  block: { en: 'block', es: 'bloque' },
  mempool: { en: 'mempool', es: 'mempool' },
  wallet: { en: 'wallet', es: 'billetera' },
  address: { en: 'address', es: 'direccion' },
  seed: { en: 'seed-phrase', es: 'frase-semilla' },
} as const;

export type GlossaryTerm = keyof typeof GLOSSARY;

/** The address of a glossary entry on the main site, in the page's language. `siteUrl` has no slash at its end. */
export function glossaryUrl(siteUrl: string, lang: Lang, term: GlossaryTerm): string {
  const folder = lang === 'es' ? '/es/glosario/' : '/glossary/';
  return `${siteUrl}${folder}${GLOSSARY[term][lang]}`;
}

/**
 * The glossary's entry for a faucet. It exists in English only, so it is
 * not in the map above, whose entries all have both languages. A Spanish
 * page links the English entry and says so in the link's words, as the main
 * site does for a page it has in English only: no address is ever made up
 * for an entry that is not there.
 */
export function faucetGlossaryUrl(siteUrl: string): string {
  return `${siteUrl}/glossary/bitcoin-faucet`;
}

/** The address of a transaction on the practice explorer. `explorerUrl` has no slash at its end. */
export function explorerTxUrl(explorerUrl: string, txid: string): string {
  return `${explorerUrl}/tx/${txid}`;
}

// -- one transaction: asking for it -------------------------------------------------

/** How long the screen waits between two looks for a transaction the network does not list yet, in ms. */
export const WAIT_STEP_MS = 3000;

/** How long it goes on looking before it says the transaction is not there, in ms. */
export const WAIT_LIMIT_MS = 120_000;

/**
 * What the transaction's screen shows:
 *   asking     the first answer is not in yet
 *   found      the transaction
 *   waiting    the faucet or a payment of this page returned the ID a moment
 *              ago, and the practice network does not list it yet
 *   not-found  the network has no such transaction. `waited` is true when
 *              the screen waited for it first, and the two minutes a new
 *              transaction is given to show up ran out
 *   failed     the look itself failed; `reason` says why
 */
export type TxShows =
  | { kind: 'asking' }
  | { kind: 'found'; view: TxView }
  | { kind: 'waiting' }
  | { kind: 'not-found'; waited: boolean }
  | { kind: 'failed'; reason: ApiFailure };

/** What an answer leads to: what to show, what the screen keeps for the next look, and when to ask again. */
export interface TxStep {
  shows: TxShows;
  /** When the first "waiting" answer for this transaction came, in ms since 1970, or null. */
  waitingSince: number | null;
  /** True once a wait for this transaction has run out, until the transaction turns up. */
  waitedOut: boolean;
  /** Ask again after this many ms, or null: nothing more is asked until something changes. */
  askAgainIn: number | null;
}

/**
 * The step after one answer of wallet.lookupTx(). `waitingSince` is what the
 * step before gave (null at the start, and after the reader asks by hand);
 * `now` is in ms since 1970; `waitedOut` is true when a wait for this same
 * transaction has already run out on this screen.
 *
 * A transaction the network does not list yet is asked for again every few
 * seconds. Two clocks can end that wait:
 *   - the wallet's. It says "waiting" for two minutes from the moment the
 *     faucet or a broadcast handed it the ID, and "not found" after that.
 *     That moment lies before the screen's first look, so in practice this
 *     is the clock that ends a wait: a "not found" that follows "waiting";
 *   - the screen's own two minutes, counted from its first "waiting"
 *     answer, so that no answer can keep it asking for ever.
 * Either way the reader is told that the wait ran out, which is another
 * thing than an ID the network has never heard of.
 *
 * Once a wait has run out, "not found" goes on saying so for that
 * transaction, when the reader tries again and when a new block makes the
 * screen look again, until the transaction turns up.
 */
export function afterLookup(answer: TxLookup, waitingSince: number | null, now: number, waitedOut = false): TxStep {
  switch (answer.kind) {
    case 'found':
      return { shows: { kind: 'found', view: answer.view }, waitingSince: null, waitedOut: false, askAgainIn: null };
    case 'waiting': {
      const since = waitingSince ?? now;
      if (now - since >= WAIT_LIMIT_MS) {
        return { shows: { kind: 'not-found', waited: true }, waitingSince: since, waitedOut: true, askAgainIn: null };
      }
      return { shows: { kind: 'waiting' }, waitingSince: since, waitedOut, askAgainIn: WAIT_STEP_MS };
    }
    case 'not-found': {
      const waited = waitingSince !== null || waitedOut;
      return { shows: { kind: 'not-found', waited }, waitingSince: null, waitedOut: waited, askAgainIn: null };
    }
    case 'failed':
      // The wait, if there was one, is not over: the next answer may say "waiting" again.
      return { shows: { kind: 'failed', reason: answer.reason }, waitingSince, waitedOut, askAgainIn: null };
  }
}

/**
 * What the screen shows after a look, given what it showed before it. A
 * look that fails takes nothing off the screen: the transaction that is
 * shown stays, because nothing about it has changed (SPEC section 3: after
 * a later read that fails, the last values stay). The wallet frame says
 * when the practice network cannot be reached. Every other answer is shown
 * as it comes. `txid` is the transaction the screen is about.
 */
export function keepShown(shown: TxShows, next: TxShows, txid: string): TxShows {
  return next.kind === 'failed' && shown.kind === 'found' && shown.view.txid === txid ? shown : next;
}

// -- one transaction: saying what it is ---------------------------------------------

/**
 * Which way the coins went, with the amount the sentence names:
 *   received  what the wallet gained
 *   sent      what left the wallet in all, the fee included
 *   internal  the wallet paid itself: what left it is the fee
 *   other     the transaction does not touch this wallet; no amount
 */
export interface TxSummary {
  kind: TxView['direction'];
  /** In sats, never below 0. */
  sats: bigint;
}

export function txSummary(view: Pick<TxView, 'direction' | 'net'>): TxSummary {
  if (view.direction === 'other') return { kind: 'other', sats: 0n };
  return { kind: view.direction, sats: view.net < 0n ? -view.net : view.net };
}

/** A sentence that names an amount, in the pieces a screen draws it from. Put end to end they are the sentence. */
export interface AmountSentence {
  /** The words before the amount. */
  before: string;
  /** The number: "30,282". Empty when the sentence names no amount. */
  number: string;
  /** The unit: "practice sats". Empty when the sentence names no amount. */
  unit: string;
  /** The words after the amount. */
  after: string;
}

/**
 * Cuts a sentence at its amount, so that the unit can be drawn in one
 * piece: "practice sats" must never break in two at the end of a line (the
 * number may part from it there, as it may in the wallet's lists).
 * `template` holds the slot {amount}; `amount` is the number, a space and
 * the unit, as satsText() gives it. A template without the slot, or an
 * empty amount, is a sentence that names none.
 */
export function amountSentence(template: string, amount: string): AmountSentence {
  const slot = '{amount}';
  const at = template.indexOf(slot);
  const cut = amount.indexOf(' ');
  if (at < 0 || cut < 0) return { before: template, number: '', unit: '', after: '' };
  return {
    before: template.slice(0, at),
    number: amount.slice(0, cut),
    unit: amount.slice(cut + 1),
    after: template.slice(at + slot.length),
  };
}

/**
 * Where a transaction stands:
 *   unconfirmed  not in a block yet
 *   block-date   in the block at `height`, on the day of `time` (seconds since 1970)
 *   block        in the block at `height`; the block's time is not known
 *   confirmed    in a block, and which one is not known
 */
export type TxStatus =
  | { kind: 'unconfirmed' }
  | { kind: 'block-date'; height: number; time: number }
  | { kind: 'block'; height: number }
  | { kind: 'confirmed' };

export function txStatus(view: Pick<TxView, 'confirmed' | 'height' | 'time'>): TxStatus {
  if (!view.confirmed) return { kind: 'unconfirmed' };
  if (view.height === null) return { kind: 'confirmed' };
  return view.time === null ? { kind: 'block', height: view.height } : { kind: 'block-date', height: view.height, time: view.time };
}

/**
 * Whether a transaction can still be replaced by another version of itself
 * that pays a higher fee:
 *   no       it is in a block
 *   signals  it is unconfirmed and says itself that it may be replaced (BIP 125)
 *   silent   it is unconfirmed and does not say so. Nodes take a replacement
 *            that pays more either way, so the answer is still yes
 */
export function txReplaceable(view: Pick<TxView, 'confirmed' | 'rbf'>): 'no' | 'signals' | 'silent' {
  if (view.confirmed) return 'no';
  return view.rbf ? 'signals' : 'silent';
}
