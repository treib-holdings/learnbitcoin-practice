// Where a "Do it" step stands: which of its parts are ticked, which one the
// reader can do now, and what is missing when they cannot.
//
// A step is a short ordered list of parts. A part is ticked at the first
// moment its condition holds while every part before it is ticked and the
// step is started; the tick is written to the step's note at once and stays
// (advance.ts and progress.ts see to that). So this file never has to ask
// whether an old tick still holds. Live facts decide one thing only: the
// first part that is not ticked. That part is in one of three states:
//
//   now      the reader can do it
//   blocked  something is missing first, and `reason` says what
//   unknown  the facts it rests on are not known yet, and `reason` says why.
//            A part whose facts are not known is never "blocked": the page
//            must not say "no coins" while it is still looking them up
//
// Every part after it is "later". A step is done when its last part is
// ticked, and a done step shows every part ticked.
//
// Everything here is pure: the same world gives the same answer, nothing is
// read from the page, nothing is stored and nothing is asked of the network.
// The world is handed in: what the wallet publishes, the note, the clock.
// judge() looks at what is so, never at what just happened: the payment
// this page last sent and the count of times the words were shown are
// advance.ts's business, and the type of what judge() is handed does not
// even hold them.

import { spendableCoins, type TxView } from '@learnbitcoin/practice-wallet';
import { parseSats } from '../format.ts';
import type { Route } from '../router.ts';
import type { WalletApi, WalletStatus, WordsAtResult } from '../wallet-api.ts';
import type { Progress, StepNote } from './progress.ts';
import { STEP_DEFS, partDef, type Fact, type StepId } from './steps.ts';

// -- the world ----------------------------------------------------------------

/**
 * What judge() looks at: the wallet as it stands, the note, and the clock.
 *
 * `wallet` holds the values of the wallet's own properties at one moment.
 * Each of those is replaced whole when it changes and never altered in
 * place, so holding them is holding a picture of that moment.
 */
export interface Seen {
  wallet: Pick<WalletApi, 'status' | 'record' | 'unlocked' | 'chain' | 'history' | 'historyError'>;
  /** The note as it stands in storage. Empty when nothing is stored, when it cannot be read, and under a newer note. */
  note: Progress;
  /**
   * Whether progress can be written here.
   *   yes    it can
   *   no     the browser refuses to store anything (wallet.canStore is false, or a write was refused)
   *   newer  a note written by a newer version of this page is stored: this page writes nothing
   */
  kept: 'yes' | 'no' | 'newer';
  /** The time, in ms since 1970. */
  now: number;
  /**
   * When the wallet's list of transactions was last read, in ms since 1970,
   * where the page knows. The wallet reads the list on the screens that
   * show it and on a step's own screen, and on no other. So on the Send
   * screen, say, the list can be older than the payment a step waits for:
   * such a list cannot hold the payment, and says nothing about it. Left
   * out (or null), the list is taken as read just now.
   */
  listAt?: number | null;
}

/**
 * The whole world at one moment, as advance() compares two of them: what
 * judge() looks at, the screen that is open, and the two things that say
 * what happened in this page (the payment it last sent, and how often it
 * has put the 12 words on screen).
 */
export interface World extends Seen {
  route: Route;
  wallet: Seen['wallet'] & Pick<WalletApi, 'lastSent' | 'wordsShown'>;
}

/** The wallet's part of a world, taken now: one value for each property the steps look at. */
export function walletFacts(wallet: World['wallet']): World['wallet'] {
  return {
    status: wallet.status,
    record: wallet.record,
    unlocked: wallet.unlocked,
    chain: wallet.chain,
    history: wallet.history,
    historyError: wallet.historyError,
    lastSent: wallet.lastSent,
    wordsShown: wallet.wordsShown,
  };
}

// -- what a part can be -------------------------------------------------------

/**
 * What is missing, for a part the reader cannot do yet.
 *
 *   no-wallet               no practice wallet is in this browser: its storage was read, and holds none
 *   no-coins                the wallet holds no coin (or none that the part can use)
 *   not-spendable-yet       a coin is here, and can be spent once a block has taken it in
 *   nothing-sent            the part needs a payment of this wallet's own, and there is none
 *   came-back-with-passkey  the wallet returned through its passkey, which proves the passkey and not the paper
 *   another-wallet          the wallet in this browser is not the one the step named
 *   storage                 progress cannot be written here, so nothing more can be ticked
 *   trouble                 something is stored for the wallet that cannot be used: it cannot be
 *                           read, or it was written by a newer version of the page
 *   broken                  the page's self-test failed: no wallet can run in this browser. Nothing
 *                           was read and none can have been made, so this is never told as
 *                           "the stored wallet"
 *   unread                  the browser did not let this page read its storage: whether a wallet
 *                           is here is not known. Never told as "no wallet"
 *
 * The last three are the wallet's own trouble (WalletTrouble): the step's
 * screen shows the wallet's piece for them (StoredTrouble), not a sentence
 * of its own.
 */
export type BlockedReason =
  | 'no-wallet'
  | 'no-coins'
  | 'not-spendable-yet'
  | 'nothing-sent'
  | 'came-back-with-passkey'
  | 'another-wallet'
  | 'storage'
  | 'trouble'
  | 'broken'
  | 'unread';

/** The reasons that are the wallet's own trouble, whatever the step: what the wallet's own piece speaks for. */
export type WalletTrouble = Extract<BlockedReason, 'trouble' | 'broken' | 'unread'>;

/** True for a reason that is the wallet's own trouble. */
export function isWalletTrouble(reason: BlockedReason): reason is WalletTrouble {
  return reason === 'trouble' || reason === 'broken' || reason === 'unread';
}

/**
 * The wallet's own trouble for each status, or null where there is none: a
 * wallet is here, or the storage was read and holds none. Every status is
 * named, so one added to the wallet later does not build until it has a
 * line here.
 */
export function troubleOf(status: WalletStatus): WalletTrouble | null {
  switch (status) {
    case 'unreadable':
    case 'newer':
      return 'trouble';
    case 'broken':
      return 'broken';
    case 'blocked':
      return 'unread';
    case 'none':
    case 'ready':
      return null;
  }
}

/**
 * Why the facts are not known.
 *
 *   looking      the wallet's first look at its coins is still running
 *   scan-failed  that first look failed, and no coins have been read at all
 *   history      the list of transactions has not been read yet, or could not be
 */
export type UnknownReason = 'looking' | 'scan-failed' | 'history';

/** A part that waits for a block: which payment, when it was sent, and whether the network has lost it. */
export interface Waiting {
  /** The payment that is waited for, when the step knows which. */
  txid: string | null;
  /** When it was sent, in ms since 1970, when the note says. */
  sentAt: number | null;
  /**
   * The network does not know this payment, two minutes after it was sent
   * (the practice chain can be started again). The part says so and offers
   * "Send another", which clears the payment from the note.
   */
  lost: boolean;
}

/** How a wait ended: the block that took the payment in, and how long that took. */
export interface Waited {
  height: number;
  /**
   * Whole seconds from the payment being sent to its block, or null when
   * that cannot be said. (A block carries a time of its own, and it can be
   * off: one that says the block came before the payment, or after now, is
   * not used.)
   */
  seconds: number | null;
}

export type PartView =
  /** `waited` is set for a part that waited for a block, while the note still holds that payment. */
  | { state: 'ticked'; waited: Waited | null }
  | {
      state: 'now';
      /** The transaction the part is about: the one to open, to look up on the explorer, or to wait for. */
      txid: string | null;
      /** Set when what the reader has to do now is wait for a block. */
      waiting: Waiting | null;
      /** For the part that counts blocks: how many the payment has, from 0 to 5. */
      confirmations: number | null;
      /** The part checks three of the 12 words, and this wallet's keys are not loaded: the unlock step comes first. */
      unlock: boolean;
    }
  | { state: 'later' }
  | { state: 'blocked'; reason: BlockedReason }
  | { state: 'unknown'; reason: UnknownReason };

export interface StepView {
  id: StepId;
  /** Whether the step's screen was ever opened, and whether its last part is ticked. */
  state: 'not-started' | 'started' | 'done';
  /** One for each part of the step, in order. */
  parts: PartView[];
  /** The number (from 1) of the part that is now, blocked or unknown. Null when there is none: done, or not started. */
  at: number | null;
}

// -- constants ------------------------------------------------------------------

/** How long a noted payment may be unknown to the network before the part says it is lost, in ms. */
export const LOST_MS = 120_000;

/**
 * How far ahead of the clock a payment's noted time may lie and still be
 * taken as it stands, in ms. The pieces of a page do not all read the clock
 * at the same moment (the strip looks at it twice a minute), so a time a
 * little ahead of "now" is an ordinary thing. Further ahead than this, it
 * is not a time this page noted while its clock said what it says now.
 */
export const AHEAD_MS = 120_000;

/** How many confirmations "six blocks on top" asks for. */
export const SIX_BLOCKS = 6;

/** How many of the 12 words the paper check asks for. */
export const WORD_CHECKS = 3;

// -- one fact -------------------------------------------------------------------

/**
 * What a fact comes to in a world.
 *
 *   met      it holds. For a part that is a state of the wallet, that is its tick
 *   now      it does not hold yet, and the reader can do what it takes
 *   blocked, unknown  as in PartView
 */
export type Verdict =
  | { is: 'met' }
  | { is: 'now'; txid: string | null; waiting: Waiting | null; confirmations: number | null; unlock: boolean }
  | { is: 'blocked'; reason: BlockedReason }
  | { is: 'unknown'; reason: UnknownReason };

const MET: Verdict = { is: 'met' };
const blocked = (reason: BlockedReason): Verdict => ({ is: 'blocked', reason });
const unknown = (reason: UnknownReason): Verdict => ({ is: 'unknown', reason });
const now = (extra: { txid?: string | null; waiting?: Waiting | null; confirmations?: number | null; unlock?: boolean } = {}): Verdict => ({
  is: 'now',
  txid: extra.txid ?? extra.waiting?.txid ?? null,
  waiting: extra.waiting ?? null,
  confirmations: extra.confirmations ?? null,
  unlock: extra.unlock ?? false,
});

/**
 * What stands in the way when a part needs a wallet in this browser, or
 * null when one is here. "no-wallet" is said only of a storage that was
 * read: where the page could not look, or the wallet cannot run at all,
 * the reason is the wallet's own trouble.
 */
function noWallet(seen: Seen): Verdict | null {
  const { status, record } = seen.wallet;
  const trouble = troubleOf(status);
  if (trouble !== null) return blocked(trouble);
  if (status !== 'ready' || record === null) return blocked('no-wallet');
  return null;
}

/** The same, for a part that needs the wallet's coins: they must have been read at least once. */
function noCoins(seen: Seen): Verdict | null {
  const missing = noWallet(seen);
  if (missing !== null) return missing;
  const { chain } = seen.wallet;
  // No coins read yet. With a reason, the first look failed; without one, it is still running.
  if (chain.state === null) return unknown(chain.error !== null ? 'scan-failed' : 'looking');
  return null;
}

/** The same, for a part that needs the list of transactions: it must have been read at least once. */
function noList(seen: Seen): Verdict | null {
  const missing = noCoins(seen);
  if (missing !== null) return missing;
  // An older list that a later read could not replace is still a list (the screen says it is old).
  return seen.wallet.history === null ? unknown('history') : null;
}

/** The wallet's payments of its own in the list: the ones it sent, to somebody else or to itself. Newest first. */
function ownPayments(history: readonly TxView[]): TxView[] {
  return history.filter((tx) => tx.direction === 'sent' || tx.direction === 'internal');
}

/** What the wallet's coins that a payment may spend now add up to. */
function spendableSats(seen: Seen): bigint {
  const state = seen.wallet.chain.state;
  return state === null ? 0n : spendableCoins(state).reduce((sum, coin) => sum + coin.value, 0n);
}

/** Whether a payment can be made now: some coin can be spent. The same answer serves the part that waits for one. */
function canSpend(seen: Seen): Verdict | null {
  const missing = noCoins(seen);
  if (missing !== null) return missing;
  if (spendableSats(seen) > 0n) return null;
  // Nothing to spend: either there is no coin at all, or the ones here wait for their block.
  return blocked((seen.wallet.chain.state?.coins.length ?? 0) === 0 ? 'no-coins' : 'not-spendable-yet');
}

/** Whole seconds from a payment being sent to its block, when the block's own time can be used for that. */
function secondsWaited(sentAt: number | undefined, time: number | null, at: number): number | null {
  if (sentAt === undefined || time === null) return null;
  const block = time * 1000;
  return block >= sentAt && block <= at ? Math.round((block - sentAt) / 1000) : null;
}

/**
 * How the wait for a step's noted payment ended, or null: the payment is
 * not noted any more (a done step keeps none), is not in the list, or is
 * not in a block yet.
 */
export function waitedFor(id: StepId, seen: Seen): Waited | null {
  const note = seen.note.steps[id];
  if (note?.tx === undefined) return null;
  const tx = seen.wallet.history?.find((each) => each.txid === note.tx);
  if (tx === undefined || !tx.confirmed || tx.height === null) return null;
  return { height: tx.height, seconds: secondsWaited(note.sentAt, tx.time, seen.now) };
}

/** The step's noted payment in the list, with what is said of it while it waits. */
function notedPayment(note: StepNote | undefined, seen: Seen): { tx: TxView | null; waiting: Waiting } | Verdict {
  const gone = noWallet(seen);
  if (gone !== null) return gone;
  // After "Send another" the note holds no payment: the next one sent takes its place.
  if (note?.tx === undefined) return blocked('nothing-sent');
  const missing = noList(seen);
  if (missing !== null) return missing;
  const tx = seen.wallet.history?.find((each) => each.txid === note.tx) ?? null;
  // A time that lies far ahead of the clock (the clock was set back, or the note was edited by
  // hand) says nothing: taken as it stands, every list would count as read "before" the payment,
  // and the part would never get past "not known yet". It is treated as a time that is not known.
  const sentAt = note.sentAt !== undefined && note.sentAt - seen.now <= AHEAD_MS ? note.sentAt : null;
  // What the list can say depends on when it was read. One read before the payment was sent
  // cannot hold it: nothing is known of the payment yet, and it is neither waiting nor lost.
  const readAt = seen.listAt ?? seen.now;
  if (tx === null && sentAt !== null && readAt < sentAt) return unknown('history');
  // Not in a list read since. For two minutes that is a payment the network has not listed yet.
  // In a list read later than that, it is one the network has lost.
  const lost = tx === null && (sentAt === null || readAt - sentAt > LOST_MS);
  return { tx, waiting: { txid: note.tx, sentAt, lost } };
}

/**
 * What one fact comes to for one step in one world. `id` says whose note
 * the fact is read against (two steps wait for "the noted payment", each
 * for its own).
 */
function verdictOn(fact: Fact, id: StepId, seen: Seen): Verdict {
  const note = seen.note.steps[id];
  const { status, record, chain, history, unlocked } = seen.wallet;

  switch (fact) {
    case 'wallet-here': {
      const missing = noWallet(seen);
      // No wallet is exactly what this part is there to mend: the reader can make one now.
      return missing === null ? MET : missing.is === 'blocked' && missing.reason === 'no-wallet' ? now() : missing;
    }

    case 'coins-seen': {
      const missing = noCoins(seen);
      if (missing !== null) return missing;
      const state = chain.state;
      // A coin, or a receive address that has been paid: coins that came and were spent again still came.
      return state !== null && (state.coins.length > 0 || state.receive.some((address) => address.used)) ? MET : now();
    }

    case 'coin-confirmed': {
      const missing = noCoins(seen);
      if (missing !== null) return missing;
      const coins = chain.state?.coins ?? [];
      if (coins.some((coin) => coin.status.confirmed)) return MET;
      const waiting = coins.find((coin) => !coin.status.confirmed);
      // A coin is here and waits for its block. No coin at all: there is nothing to wait for.
      return waiting === undefined ? blocked('no-coins') : now({ waiting: { txid: waiting.txid, sentAt: null, lost: false } });
    }

    case 'spendable':
      return canSpend(seen) ?? MET;

    // Two events: nothing in the world makes them "met". What is judged is whether the reader can send now.
    case 'sent-to-pot':
    case 'sent':
      return canSpend(seen) ?? now();

    case 'payment-confirmed': {
      const noted = notedPayment(note, seen);
      if ('is' in noted) return noted;
      return noted.tx?.confirmed === true ? MET : now({ waiting: noted.waiting });
    }

    case 'six-blocks': {
      const noted = notedPayment(note, seen);
      if ('is' in noted) return noted;
      const { tx, waiting } = noted;
      if (tx === null || !tx.confirmed || tx.height === null) return now({ waiting, confirmations: 0 });
      // The height of the chain is read with the coins; until it is, the count cannot be made.
      if (chain.tip === null) return unknown('looking');
      // The block that holds it is the first confirmation, and each block on top is one more.
      const confirmations = Math.max(1, chain.tip - tx.height + 1);
      return confirmations >= SIX_BLOCKS ? MET : now({ waiting, confirmations });
    }

    case 'coins-opened':
    case 'coin-count':
    case 'payment-read': {
      const missing = noList(seen);
      if (missing !== null) return missing;
      // The whole step needs a payment this wallet has sent: without one no coin
      // was used up whole, and there is no change to see.
      const sent = ownPayments(history ?? []);
      if (sent.length === 0) return blocked('nothing-sent');
      if (fact === 'payment-read') return now({ txid: sent[0]?.txid ?? null });
      // Coins to open, and coins to count.
      return (chain.state?.coins.length ?? 0) === 0 ? blocked('no-coins') : now();
    }

    case 'words-shown':
    case 'written':
      return noWallet(seen) ?? now();

    case 'three-words': {
      const locked = record?.kind === 'passkey' && !unlocked;
      if (id !== 'prove-the-backup') return noWallet(seen) ?? now({ unlock: locked });
      // The drill needs a wallet that holds coins: finding them again is its last part.
      const missing = noCoins(seen);
      if (missing !== null) return missing;
      if ((chain.state?.coins.length ?? 0) === 0) return blocked('no-coins');
      // Already checked, in the-seed, for this very wallet: the paper copy is the same paper.
      const seed = seen.note.steps['the-seed'];
      const checked = seed?.wallet !== undefined && seed.wallet === record?.fingerprint && seed.parts?.[STEP_DEFS['the-seed'].parts.length] === true;
      return checked ? MET : now({ unlock: locked });
    }

    case 'wallet-removed': {
      const missing = noWallet(seen);
      // No wallet here, and this part not ticked: it was not removed while the step was followed.
      if (missing !== null) return missing;
      // The wallet to remove is the one whose words were checked. Any other one is not it.
      return note?.wallet !== undefined && record?.fingerprint === note.wallet ? now() : blocked('another-wallet');
    }

    case 'restored-from-words': {
      const trouble = troubleOf(status);
      if (trouble !== null) return blocked(trouble);
      // Nothing here: the one thing to do is restore, from the paper.
      if (status !== 'ready' || record === null) return now();
      if (note?.wallet === undefined || record.fingerprint !== note.wallet) return blocked('another-wallet');
      // Kept with its words: only a restore from the 12 words writes that for this wallet.
      // Kept with a passkey: it came back through the passkey, which proves the passkey.
      return record.kind === 'words' ? MET : blocked('came-back-with-passkey');
    }

    case 'coins-found': {
      const missing = noCoins(seen);
      if (missing !== null) return missing;
      if (note?.wallet !== undefined && record?.fingerprint !== note.wallet) return blocked('another-wallet');
      const state = chain.state;
      return state !== null && state.confirmed + state.unconfirmed > 0n ? MET : blocked('no-coins');
    }
  }
}

/**
 * What a part of a step comes to in a world, whatever its ticks say. `part`
 * is its number, from 1. advance.ts ticks a part that is a state of the
 * wallet when this says "met".
 */
export function verdictOf(id: StepId, part: number, seen: Seen): Verdict {
  const def = partDef(id, part);
  return def === undefined ? blocked('trouble') : verdictOn(def.on, id, seen);
}

// -- one step -------------------------------------------------------------------

/** The number (from 1) of the first part of a step that is not ticked in its note, or null when every part is. */
export function firstOpen(id: StepId, note: StepNote | undefined): number | null {
  for (let part = 1; part <= STEP_DEFS[id].parts.length; part++) if (note?.parts?.[part] !== true) return part;
  return null;
}

/** Whether a step was never opened, is under way, or is done, from its note alone: what the list of steps shows. */
export function stepState(note: StepNote | undefined): StepView['state'] {
  if (note?.doneAt !== undefined) return 'done';
  return note?.started === true ? 'started' : 'not-started';
}

function partView(verdict: Verdict): PartView {
  switch (verdict.is) {
    // It holds, and its tick is not in the note (yet): until it is written, the part is not ticked.
    case 'met':
      return { state: 'now', txid: null, waiting: null, confirmations: null, unlock: false };
    case 'now':
      return { state: 'now', txid: verdict.txid, waiting: verdict.waiting, confirmations: verdict.confirmations, unlock: verdict.unlock };
    case 'blocked':
      return { state: 'blocked', reason: verdict.reason };
    case 'unknown':
      return { state: 'unknown', reason: verdict.reason };
  }
}

/**
 * Where a step stands in a world: every part's state, and the step's.
 *
 * A done step shows every part ticked. A step that was never started shows
 * every part as "later": nothing is judged for it (the list of steps shows
 * only its state).
 *
 * Where nothing can be written (`kept` is "no" or "newer") no tick can be
 * made, so the parts are shown as the wallet stands: a part that is a state
 * of the wallet counts as ticked while that state holds, one after another
 * from the first, and the first part that needs more than that (a question,
 * the reader's word, something to do while the step is followed) is
 * blocked with "storage". Ticks that are in the note are still honoured.
 */
export function judge(id: StepId, seen: Seen): StepView {
  const parts = STEP_DEFS[id].parts;
  const note = seen.note.steps[id];
  const state = stepState(note);
  if (state === 'done') return { id, state, parts: parts.map(() => ({ state: 'ticked', waited: null })), at: null };
  const live = seen.kept !== 'yes';
  if (state === 'not-started' && !live) return { id, state, parts: parts.map(() => ({ state: 'later' })), at: null };

  const views: PartView[] = [];
  let at: number | null = null;
  parts.forEach((part, index) => {
    const number = index + 1;
    if (at !== null) {
      views.push({ state: 'later' });
      return;
    }
    if (note?.parts?.[number] === true) {
      // The one line a part keeps once its block has come, while the note still names the payment.
      views.push({ state: 'ticked', waited: part.on === 'payment-confirmed' ? waitedFor(id, seen) : null });
      return;
    }
    const verdict = verdictOn(part.on, id, seen);
    if (live && part.kind === 'state' && verdict.is === 'met') {
      views.push({ state: 'ticked', waited: null });
      return;
    }
    at = number;
    // No tick can be written here: a part that needs one stops at that, unless the wallet itself is in trouble.
    const stuck = live && part.kind !== 'state' && !(verdict.is === 'blocked' && isWalletTrouble(verdict.reason));
    views.push(stuck ? { state: 'blocked', reason: 'storage' } : partView(verdict));
  });
  return { id, state, parts: views, at };
}

// -- the questions ----------------------------------------------------------------

/**
 * How an answer to the one question whose answer is a number is judged.
 *
 *   right    it is the number: the part can be ticked (advance.ts, answered)
 *   wrong    it is not
 *   total    the answer is what the wallet's coins add up to, in sats. The
 *            question was how many coins hold it
 *   empty, period, invalid   what was typed is no whole number (digits and
 *            commas; a period is refused, as on the Send screen)
 *   not-now  the question is not open: its part is not the one that is "now"
 *
 * No answer ever says what the number is.
 */
export type Answer = 'right' | 'wrong' | 'total' | 'empty' | 'period' | 'invalid' | 'not-now';

/** The number (from 1) of the step's part that rests on `fact`, when that part is the one that is "now". Otherwise null. */
function openPart(id: StepId, fact: Fact, seen: Seen): number | null {
  const view = judge(id, seen);
  if (view.at === null || partDef(id, view.at)?.on !== fact) return null;
  return view.parts[view.at - 1]?.state === 'now' ? view.at : null;
}

/**
 * no-balances, "How many separate coins does this wallet hold?". Right when
 * it equals the number of rows the Coins screen shows at that moment:
 * unconfirmed coins and change count.
 */
export function answerCoins(seen: Seen, typed: string): Answer {
  if (openPart('no-balances', 'coin-count', seen) === null) return 'not-now';
  const state = seen.wallet.chain.state;
  if (state === null) return 'not-now';
  const number = parseSats(typed);
  if (typeof number === 'string') return number;
  if (number === BigInt(state.coins.length)) return 'right';
  return number === state.confirmed + state.unconfirmed ? 'total' : 'wrong';
}

/**
 * Three places in the 12 words to ask for, counted from 0 as the wallet
 * counts them (wallet.checkWordsAt), all different, in rising order. Chosen
 * when the part opens, and kept by the screen until they are answered right.
 * `random` gives a number from 0 up to, not including, 1.
 */
export function pickPositions(random: () => number = Math.random): number[] {
  const left = Array.from({ length: 12 }, (_, place) => place);
  const picked: number[] = [];
  while (picked.length < WORD_CHECKS) {
    const roll = random();
    // A source that gives something else than a number in range still ends: the first place left is taken.
    const at = Number.isFinite(roll) && roll >= 0 && roll < 1 ? Math.floor(roll * left.length) : 0;
    picked.push(...left.splice(at, 1));
  }
  return picked.sort((a, b) => a - b);
}

/**
 * Whether a check of three words was passed: the wallet compared them
 * (wallet.checkWordsAt) and none was wrong, and what was asked really was
 * three different places of the phrase. A check that asked for nothing, or
 * for one place three times, proves nothing.
 */
export function wordsPassed(positions: readonly number[], result: WordsAtResult): boolean {
  if (!result.ok || result.wrong.length > 0) return false;
  if (positions.length !== WORD_CHECKS || new Set(positions).size !== WORD_CHECKS) return false;
  return positions.every((place) => Number.isInteger(place) && place >= 0 && place < 12);
}

/**
 * For the-seed, once its three words are checked: is the wallet in this
 * browser the one they were checked for?
 *
 *   same   yes
 *   other  another wallet is here: the screen says so, and offers the check again for it
 *   none   no wallet is known to be here (or none was noted): the screen then says nothing
 *          of the wallet in this browser, which is right also where the page could not look
 */
export function seedWallet(seen: Seen): 'same' | 'other' | 'none' {
  const checked = seen.note.steps['the-seed']?.wallet;
  const { status, record } = seen.wallet;
  if (checked === undefined || status !== 'ready' || record === null) return 'none';
  return record.fingerprint === checked ? 'same' : 'other';
}

/**
 * For the card of a done "Hold some": a coin that was paid to the wallet in
 * this browser and is in a block, with the number of that block. Null when
 * the wallet's latest look at its coins shows none.
 *
 * It is read from that look alone (`chain.state`), never from the note: the
 * note of "Hold some" names no wallet, no coin and no block. So the answer
 * is about the wallet that is here now, whichever wallet the step was done
 * with, and it is the same whatever the note holds.
 *
 * Only a coin on the receive chain counts (`coin.chain` is 0): one that
 * somebody paid to an address the wallet showed. The change of a payment
 * the wallet made itself is passed over, in whichever block it is: the card
 * speaks of coins the reader got, and change is what was left of a payment
 * they sent. Of the coins that count, the one in the lowest block is given
 * and, among several in that block, the first in the wallet's list. A coin
 * that is said to be in a block whose number was not read is passed over
 * too: there is no number to show for it.
 *
 * A look that failed after an earlier one had worked leaves the earlier
 * reading in place (`chain.error` beside `chain.state`), and the answer is
 * then made from that reading: what a block did stays so. Before the first
 * look has ended, and after a first look that failed, there is no reading
 * and the answer is null.
 */
export function coinInBlock(seen: Seen): { txid: string; height: number } | null {
  const { status, record, chain } = seen.wallet;
  if (status !== 'ready' || record === null || chain.state === null) return null;
  let found: { txid: string; height: number } | null = null;
  for (const coin of chain.state.coins) {
    if (coin.chain !== 0 || coin.status.confirmed !== true) continue;
    const height = coin.status.block_height;
    if (height === undefined || !Number.isSafeInteger(height) || height < 0) continue;
    // The lowest block. A later coin of the same block does not take the first one's place.
    if (found === null || height < found.height) found = { txid: coin.txid, height };
  }
  return found;
}
