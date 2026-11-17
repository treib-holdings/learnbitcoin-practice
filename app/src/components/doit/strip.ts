// What the strip says, as plain functions so that "node --test" can check
// them. The strip is the slim line under the header that keeps a reader
// oriented while they follow a "Do it" step through the wallet's own
// screens (Strip.svelte).
//
// Whether there is a strip at all, and for which step, is the note's to
// say (stripStep in lib/doit/progress.ts: the step that is followed, for 24
// hours after it was last followed). Where that step stands is judge()'s.
// This file turns the two into words, and says which links the strip
// carries: "Back to the step" always, and "Back to the chapter" beside it
// once the step is done, and all along for a reader who came to the step
// from a chapter (stripOffersChapter).

import type { Lang } from '@learnbitcoin/practice-contract';
import type { BlockedReason, StepView } from '../../lib/doit/judge.ts';
import { cameFromChapter, type Progress } from '../../lib/doit/progress.ts';
import { STEP_DEFS, partCount, partDef, partKey, type StepId } from '../../lib/doit/steps.ts';
import { fill, formatElapsed } from '../../lib/format.ts';
import { strings } from '../../strings/index.ts';

/**
 * What the strip says in the place of the part's name:
 *   part     the part's own name: the reader can do it, or the page does
 *            not know enough here to say more
 *   need     what is missing first
 *   unknown  the coins are still being looked up
 *   failed   the look at the coins failed
 *   waiting  the part waits for a block; `sentAt` is when the payment was sent, if the note says
 *   lost     the network does not know the payment
 *   done     the step is done
 */
export type StripSays =
  | { kind: 'part' }
  | { kind: 'need'; reason: BlockedReason }
  | { kind: 'unknown' }
  | { kind: 'failed' }
  | { kind: 'waiting'; sentAt: number | null }
  | { kind: 'lost' }
  | { kind: 'done' };

export interface StripView {
  step: StepId;
  /** The number of the part the strip is about, from 1. Null for a done step. */
  part: number | null;
  /** How many parts the step has. */
  parts: number;
  says: StripSays;
}

/** What the wallet keeps reading on the screen the strip stands on (readsCoins and readsTransactions in lib/router.ts). */
export interface StripLive {
  /** The wallet's coins. */
  coins: boolean;
  /** Its list of transactions. */
  list: boolean;
}

const EVERYTHING: StripLive = { coins: true, list: true };

/**
 * True for a need that judge() reads off the wallet's list of transactions
 * and off nothing else: that the wallet has sent no payment of its own
 * (every part of "There are no balances" rests on one). `part` is the
 * number of the part that is open, from 1.
 */
function readOffList(id: StepId, part: number, reason: BlockedReason): boolean {
  const fact = partDef(id, part)?.on;
  return (fact === 'coins-opened' || fact === 'coin-count' || fact === 'payment-read') && reason === 'nothing-sent';
}

/**
 * What the strip shows for the step it follows, from where that step stands.
 *
 * "Waiting for a block" is read from the wallet's coins (a coin that waits
 * for its first block) or from its list of transactions (a payment that
 * does). On a screen where that reading is not kept up, the strip would go
 * on saying it, and counting the seconds, after the block had come: there
 * it says which part is next, and no more. `live` says which readings the
 * screen keeps up.
 *
 * The same holds for a need that is read off the list of transactions. On
 * a screen that does not keep the list read, the list the page holds can
 * be older than what the reader has just done there: on Send a payment
 * goes out, and a list read before it was sent still holds no payment of
 * the wallet's own. The strip would then say "first: send a payment" over
 * the very payment. So such a need is said only where the list is kept
 * read. Elsewhere the strip names the part.
 */
export function stripView(view: StepView, live: StripLive = EVERYTHING): StripView {
  const parts = partCount(view.id);
  // "Done" is said of a step that is done, and of no other. A step with no part to name (it was
  // never started: a note edited by hand follows it) has nothing to say, and the strip stays away.
  if (view.state === 'done') return { step: view.id, part: null, parts, says: { kind: 'done' } };
  if (view.at === null) return { step: view.id, part: null, parts, says: { kind: 'part' } };
  const open = view.parts[view.at - 1];
  let says: StripSays = { kind: 'part' };
  if (open?.state === 'blocked') {
    if (live.list || !readOffList(view.id, view.at, open.reason)) says = { kind: 'need', reason: open.reason };
  } else if (open?.state === 'unknown') {
    // The list of transactions is read on the screens that show it and on a step's own, and
    // the strip stands on all the others. Where the list is not there, or is older than the
    // payment the step waits for, the strip knows only which part is next, and says that.
    if (open.reason === 'looking') says = { kind: 'unknown' };
    else if (open.reason === 'scan-failed') says = { kind: 'failed' };
  }
  else if (open?.state === 'now' && open.waiting !== null) {
    if (open.waiting.lost) says = { kind: 'lost' };
    // A payment that is in a block and is counting its six is past its wait: the part's own name says what goes on.
    else if ((open.confirmations ?? 0) === 0 && (partDef(view.id, view.at)?.on === 'coin-confirmed' ? live.coins : live.list)) {
      says = { kind: 'waiting', sentAt: open.waiting.sentAt };
    }
  }
  return { step: view.id, part: view.at, parts, says };
}

/** False for a strip that has neither a part to name nor a done step to report: it is not drawn. */
export function stripShows(strip: StripView): boolean {
  return strip.part !== null || strip.says.kind === 'done';
}

/**
 * Whether the strip carries the link back to the chapter beside "Back to
 * the step". It does once the step is done, for every reader. And it does
 * all along for a step that came from a chapter: the reader pressed its
 * card there, or a need of another step sent them here on a road that
 * began at a card. That reader is on the wallet's own screens to do one
 * thing a chapter asked for, and the way back to the chapter must be in
 * view there, not two presses away. A reader who opened the step from the
 * wallet's own list did not come from a chapter: for them the strip of a
 * step under way has the one link.
 */
export function stripOffersChapter(progress: Progress, step: StepId): boolean {
  return progress.steps[step]?.doneAt !== undefined || cameFromChapter(progress, step);
}

/**
 * Whether the narrow form of the strip says its words in the place of
 * "2 of 3". On a phone there is room for the step and how far it is, and
 * that is all the strip shows while the reader can simply go on. It gives
 * that room to the words when they are what the reader has to know on the
 * very screen they are on: something is missing first, the part waits for a
 * block, or the network has lost the payment. And for the one part that is
 * done with no wallet in the browser, the drill's restore: the screens a
 * reader with no wallet is on (Home, Create) offer to make a new one, and
 * the strip says on each of them that the step goes on with a restore.
 * (Home says so itself in that state, and so does the gate that stands in
 * for a wallet screen: each puts the restore first, as its main button, and
 * names the step under it.)
 */
export function stripSpeaks(strip: StripView): boolean {
  const { kind } = strip.says;
  if (kind === 'need' || kind === 'waiting' || kind === 'lost') return true;
  return kind === 'part' && strip.part !== null && partDef(strip.step, strip.part)?.on === 'restored-from-words';
}

/** The step's title, in the page's language. */
export function stepTitle(step: StepId, lang: Lang): string {
  return strings.doit[lang][STEP_DEFS[step].title];
}

/**
 * The words the strip puts where the part's name would be: the part's
 * name, or what stands in its way ("first: get practice coins", "waiting
 * for a block, sent 12 seconds ago"). `now` is in ms since 1970.
 */
export function stripText(strip: StripView, lang: Lang, now: number): string {
  const t = strings.doit[lang];
  const { says } = strip;
  switch (says.kind) {
    case 'part':
      return strip.part === null ? '' : t[partKey(strip.step, strip.part) as keyof typeof t];
    case 'need':
      return t[`stripNeed_${says.reason}`];
    case 'unknown':
      return t.stripUnknown;
    case 'failed':
      return t.stripFailed;
    case 'waiting':
      if (says.sentAt === null) return t.stripWaitingBlock;
      return fill(t.stripWaiting, { ago: formatElapsed(Math.max(0, (now - says.sentAt) / 1000), lang) });
    case 'lost':
      return t.stripLost;
    case 'done':
      return fill(t.stripDone, { step: stepTitle(strip.step, lang) });
  }
}

/** "part 2 of 3", and its short form for a narrow screen, "2 of 3". Empty for a done step. */
export function stripCount(strip: StripView, lang: Lang): { long: string; short: string } {
  if (strip.part === null) return { long: '', short: '' };
  const t = strings.doit[lang];
  const slots = { n: String(strip.part), m: String(strip.parts) };
  return { long: fill(t.stripPart, slots), short: fill(t.stripShort, slots) };
}
