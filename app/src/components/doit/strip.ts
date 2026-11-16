// What the strip says, as plain functions so that "node --test" can check
// them. The strip is the slim line under the header that keeps a reader
// oriented while they follow a "Do it" step through the wallet's own
// screens (Strip.svelte).
//
// Whether there is a strip at all, and for which step, is the note's to
// say (stripStep in lib/doit/progress.ts: the step that is followed, for 24
// hours after it was last followed). Where that step stands is judge()'s.
// This file turns the two into words.

import type { Lang } from '@learnbitcoin/practice-contract';
import type { BlockedReason, StepView } from '../../lib/doit/judge.ts';
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
 * What the strip shows for the step it follows, from where that step stands.
 *
 * "Waiting for a block" is read from the wallet's coins (a coin that waits
 * for its first block) or from its list of transactions (a payment that
 * does). On a screen where that reading is not kept up, the strip would go
 * on saying it, and counting the seconds, after the block had come: there
 * it says which part is next, and no more. `live` says which readings the
 * screen keeps up.
 */
export function stripView(view: StepView, live: StripLive = EVERYTHING): StripView {
  const parts = partCount(view.id);
  // "Done" is said of a step that is done, and of no other. A step with no part to name (it was
  // never started: a note edited by hand follows it) has nothing to say, and the strip stays away.
  if (view.state === 'done') return { step: view.id, part: null, parts, says: { kind: 'done' } };
  if (view.at === null) return { step: view.id, part: null, parts, says: { kind: 'part' } };
  const open = view.parts[view.at - 1];
  let says: StripSays = { kind: 'part' };
  if (open?.state === 'blocked') says = { kind: 'need', reason: open.reason };
  else if (open?.state === 'unknown') {
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
 * Whether the narrow form of the strip says its words in the place of
 * "2 of 3". On a phone there is room for the step and how far it is, and
 * that is all the strip shows while the reader can simply go on. It gives
 * that room to the words when they are what the reader has to know on the
 * very screen they are on: something is missing first, the part waits for a
 * block, or the network has lost the payment. And for the one part that is
 * done with no wallet in the browser, the drill's restore: the reader is
 * then on Home, whose main button makes a new wallet, and the strip is the
 * only thing on that screen that says "restore".
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
