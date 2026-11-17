// What the "Do it" screens decide, as plain functions so that "node --test"
// can check them: which words a part gets in each state, where its one
// action leads, what is missing when it cannot be done and where that is
// put right, and which glossary entries a part links. (What the strip says
// is in components/doit/strip.ts: the strip is the shell's.)
//
// A screen draws; what to draw for which state is worked out here. Where a
// step stands is not decided here either: that is judge() in
// lib/doit/judge.ts, and everything below starts from what it answers.

import type { AppConfig, Lang } from '@learnbitcoin/practice-contract';
import { fill, formatSats, slotNames } from '../../lib/format.ts';
import { SIX_BLOCKS, type BlockedReason, type PartView, type StepView, type Waited, type WalletTrouble } from '../../lib/doit/judge.ts';
import { cameFromChapter, ledBackTo, type Progress, type Read } from '../../lib/doit/progress.ts';
import { STEP_DEFS, chapterSlots, nextStep, partCount, partDef, partKey, type Chapter, type Fact, type StepId } from '../../lib/doit/steps.ts';
import type { Route } from '../../lib/router.ts';
import { strings } from '../../strings/index.ts';
import type { GlossaryTerm } from '../read/read.ts';

/** A key of the "Do it" string table. */
export type DoitKey = keyof typeof strings.doit.en;

/** A value for every slot a sentence of these screens can have. */
export type SlotValues = Readonly<Record<string, string>>;

/**
 * The values a sentence takes from `values`, which may hold more than the
 * sentence asks for: each screen has one list of the facts it knows (the
 * seconds between blocks, two wallet fingerprints), and a sentence takes
 * the ones it names.
 */
export function slotsFor(template: string, values: SlotValues): Record<string, string> {
  const slots: Record<string, string> = {};
  for (const name of slotNames(template)) {
    const value = values[name];
    if (value !== undefined) slots[name] = value;
  }
  return slots;
}

/**
 * A sentence from the table with its slots filled from `values`. A slot
 * with no value still throws, as fill() does: that is a screen and its
 * text drifting apart.
 */
export function fillFrom(template: string, values: SlotValues): string {
  return fill(template, slotsFor(template, values));
}

/**
 * A sentence of a string table with the chapters it names filled in from the
 * table of chapters (lib/doit/steps.ts). `own` is the chapter the sentence is
 * shown for, for a sentence that has {number} or {title}. It throws, as
 * fill() does, for a slot the table of chapters does not fill: that is a
 * screen and its text drifting apart.
 */
export function withChapters(template: string, lang: Lang, own?: Chapter): string {
  return fillFrom(template, chapterSlots(lang, own));
}

// -- whether anything is kept -----------------------------------------------------------

/**
 * True when a note of the steps is stored in this browser: this version's,
 * or one a newer version wrote. Removing the wallet leaves the note where
 * it is, so the screens that speak of what this browser keeps (Settings,
 * the question before a wallet is removed, Home after one was) say so
 * while there is one. Something stored under the note's key that is no note
 * names no wallet and no payment, and does not count. Nor does a storage
 * the page was not let read ("blocked"): nobody knows then whether a note
 * is there, and those screens say nothing of one.
 */
export function progressKept(read: Read['state']): boolean {
  return read === 'kept' || read === 'newer';
}

// -- the pot's count under a done "Pass it on" ----------------------------------------

/**
 * Whether the card of a done step asks the Worker for the pot's counts: for
 * "Pass it on" alone, and only when the Worker's settings say that the
 * counts can be had (`potCounts`, from GET /api/config).
 *
 * The settings the page carries built in say that they cannot, and the
 * Worker's take their place only when they have arrived. So nothing is
 * asked before then. And where the Worker says no, which is how it ships,
 * nothing is asked at all: the line is left out, no request for the counts
 * leaves the page, and so none can show in a console or in a log.
 *
 * Only `true` counts as a yes.
 */
export function asksPotCount(id: StepId, config: Pick<AppConfig, 'potCounts'>): boolean {
  return id === 'pass-it-on' && config.potCounts === true;
}

// -- a step's keys in the table -------------------------------------------------------

/** The key of a step's lede. */
export function ledeKey(id: StepId): DoitKey {
  return `lede_${id}`;
}

/** The key of the two or three sentences a done step says about what just happened. */
export function doneKey(id: StepId): DoitKey {
  return `done_${id}`;
}

/** A chapter's heading: the word for a chapter, its number and its title, as the string table arranges them. */
export function chapterHeading(chapter: Chapter, lang: Lang): string {
  return withChapters(strings.doit[lang].chapterHeading, lang, chapter);
}

/**
 * The address of a chapter on the main site, in the page's language, or
 * null when the settings give no site to build it from. `siteUrl` comes
 * without a slash at its end. (The link back from a step, whose address
 * also names a step and says whether it is done, is chapterLink() in
 * lib/doit/progress.ts.)
 */
export function chapterUrl(siteUrl: string, chapter: Chapter, lang: Lang): string | null {
  try {
    const site = new URL(siteUrl);
    if (site.protocol !== 'https:' && site.protocol !== 'http:') return null;
    const address = `${siteUrl.replace(/\/+$/, '')}${chapter.path[lang]}`;
    return new URL(address).origin === site.origin ? address : null;
  } catch {
    return null;
  }
}

// -- a part: its name, and the words for its state ----------------------------------

/** The key of a part's name. `part` is its number, from 1. */
export function partNameKey(id: StepId, part: number): DoitKey {
  return partKey(id, part) as DoitKey;
}

/**
 * What kind of proof a ticked part is:
 *   checked  the page checked it against the wallet or the chain, or the
 *            reader answered a question right
 *   opened   a screen was opened, or the 12 words were put on screen: the
 *            page saw that, and cannot see whether anything was read
 *   said     the reader's own word, for what no page can check
 */
export type Proof = 'checked' | 'opened' | 'said';

const OPENED: readonly Fact[] = ['coins-opened', 'payment-read', 'words-shown'];

export function proofOf(id: StepId, part: number): Proof {
  const def = partDef(id, part);
  if (def === undefined) return 'checked';
  if (def.kind === 'say-so') return 'said';
  return OPENED.includes(def.on) ? 'opened' : 'checked';
}

const PROOF_KEYS = { checked: 'proofChecked', opened: 'proofOpened', said: 'proofSaid' } as const satisfies Record<Proof, DoitKey>;

/** The key of the one or two words that say where a part stands. */
export function stateKey(id: StepId, part: number, view: PartView): DoitKey {
  switch (view.state) {
    case 'ticked':
      return PROOF_KEYS[proofOf(id, part)];
    case 'now':
      return 'partNow';
    case 'later':
      return 'partLater';
    case 'blocked':
      return 'partBlocked';
    case 'unknown':
      return 'partUnknown';
  }
}

/**
 * The key of the guidance for the part that is open. One part has three
 * forms: six practice blocks take minutes, one minute or seconds, by how
 * often the practice network makes a block, and a sentence is never glued
 * together from a number and a unit.
 */
export function guideKey(id: StepId, part: number, blockSeconds: number): DoitKey {
  if (id === 'waiting-room' && part === 3) {
    const six = sixBlocks(blockSeconds);
    if (six.unit === 'seconds') return 'guide_waiting-room_3_seconds';
    return six.count === 1 ? 'guide_waiting-room_3_minute' : 'guide_waiting-room_3';
  }
  return `guide_${id}_${part}` as DoitKey;
}

/** How long six practice blocks take: whole seconds under a minute, whole minutes from there. */
export function sixBlocks(blockSeconds: number): { unit: 'seconds' | 'minutes'; count: number } {
  const seconds = Math.max(0, Math.round(SIX_BLOCKS * blockSeconds));
  return seconds < 60 ? { unit: 'seconds', count: seconds } : { unit: 'minutes', count: Math.round(seconds / 60) };
}

// -- the one action of the part that is open ------------------------------------------

/** A link into the wallet: the words on it, the screen it opens, and the part of that screen it asks for. */
export interface Action {
  label: DoitKey;
  route: Route;
  /** What follows "#" in the address: the faucet on Receive. */
  part?: string;
}

/**
 * Where the open part's one action leads, or null when the part has none:
 * a question and the reader's word are answered on the step's own screen,
 * and a part that waits for a block needs nothing done.
 */
export function actionOf(id: StepId, part: number, view: Extract<PartView, { state: 'now' }>): Action | null {
  if (view.waiting !== null) return null;
  switch (partDef(id, part)?.on) {
    case 'wallet-here':
      return { label: 'actCreate', route: { name: 'new' } };
    case 'coins-seen':
      return { label: 'actFaucet', route: { name: 'receive' }, part: 'faucet' };
    case 'sent-to-pot':
    case 'sent':
      return { label: 'actSend', route: { name: 'send' } };
    case 'coins-opened':
      return { label: 'actCoins', route: { name: 'coins' } };
    case 'payment-read':
      // The payment to read is the wallet's newest one of its own. Without one to name, the list of them all.
      return view.txid === null
        ? { label: 'actActivity', route: { name: 'activity' } }
        : { label: 'actPayment', route: { name: 'tx', txid: view.txid } };
    case 'words-shown':
      return { label: 'actBackup', route: { name: 'backup' } };
    case 'wallet-removed':
      return { label: 'actSettings', route: { name: 'settings' } };
    case 'restored-from-words':
      // With no wallet here the one way on is Restore, never Create.
      return { label: 'actRestore', route: { name: 'restore' } };
    default:
      return null;
  }
}

/** The questions and the box: what the open part asks of the reader on the step's own screen. */
export type Ask = 'coins' | 'words' | 'said' | null;

export function askOf(id: StepId, part: number): Ask {
  switch (partDef(id, part)?.on) {
    case 'coin-count':
      return 'coins';
    case 'three-words':
      return 'words';
    case 'written':
      return 'said';
    default:
      return null;
  }
}

// -- what is missing ----------------------------------------------------------------------

/** Where a need is put right: a screen of the wallet, or another step. */
export type NeedLink = { kind: 'screen'; action: Action } | { kind: 'step'; step: StepId } | null;

/** One more sentence with a plain link of its own, for a reader the main link does not fit. */
export interface Aside {
  text: DoitKey;
  action: Action;
}

export interface Need {
  /** The sentence that says what is missing. */
  text: DoitKey;
  /** A second sentence under it: the ways on. */
  more: DoitKey | null;
  link: NeedLink;
  /** Under the link, where the link leads a reader who has a wallet already to making a new one. */
  also?: Aside;
}

const FAUCET: Action = { label: 'actFaucet', route: { name: 'receive' }, part: 'faucet' };
const SEND: Action = { label: 'actSend', route: { name: 'send' } };
const SETTINGS: Action = { label: 'actSettings', route: { name: 'settings' } };
const HOME: Action = { label: 'actHome', route: { name: 'home' } };
const CREATE: Action = { label: 'actCreate', route: { name: 'new' } };
const BACKUP: Action = { label: 'actBackup', route: { name: 'backup' } };

/**
 * For a reader who made a wallet before and finds none here (it is on
 * paper, behind a passkey, or the browser erased it): Home is where a wallet
 * is opened or restored. Said under a link that leads to making a new
 * wallet: the link to "Hold some", whose first part is "make one", and the
 * link to Create that a step from a chapter has at its first part.
 */
const HAD_ONE: Aside = { text: 'needHadOne', action: { label: 'needHadOneLink', route: { name: 'home' } } };

/** True when the step's note says it is done. */
function isDone(note: Progress, id: StepId): boolean {
  return note.steps[id]?.doneAt !== undefined;
}

/** The step whose reader removes the wallet and brings it back from the 12 words. */
const DRILL: StepId = 'prove-the-backup';

/**
 * True when the note says that the drill's wallet is out of the browser for the drill: "Prove the backup" is
 * under way, its removal is ticked and its restore is not. From the note alone. With no wallet in the browser
 * that is the state awaitsRestore() names for the drill's own view: the wallet that was removed is the one to
 * bring back, and a new wallet would leave the drill with "another wallet".
 */
function drillWalletOut(note: Progress): boolean {
  const drill = note.steps[DRILL];
  if (drill?.started !== true || drill.doneAt !== undefined) return false;
  const parts = STEP_DEFS[DRILL].parts;
  const removal = parts.findIndex((each) => each.on === 'wallet-removed') + 1;
  const restore = parts.findIndex((each) => each.on === 'restored-from-words') + 1;
  return removal > 0 && restore > 0 && drill.parts?.[removal] === true && drill.parts?.[restore] !== true;
}

/**
 * What is missing for a part that cannot be done yet, and the step or the
 * screen that meets it. The wallet's own trouble has no sentence here: for
 * a stored wallet that cannot be used, a wallet that cannot run in this
 * browser and a storage the page was not let read, the screen shows the
 * wallet's own piece.
 *
 * Where a wallet or coins are missing, the way on depends on how the reader
 * came to the step (cameFromChapter in lib/doit/progress.ts).
 *
 * A step that came from a chapter (the reader pressed its card, or a need
 * of another step sent them here on a road that began at a card) is never
 * sent to "Hold some". That reader came to do this one step, so the wallet
 * takes its own short road, and every stop on it leads back here:
 *
 *   no wallet, at the step's first part   Create, and under it the line for
 *                                         a reader who has a wallet already
 *   no wallet, at a later part            Home: a wallet was here when the
 *                                         earlier parts ticked, so the way
 *                                         on is to open or restore it
 *   no coins                              the faucet, on Receive
 *
 * One thing in the note can say, at another step's first part, that this
 * reader had a wallet: the drill, between its removal and its restore
 * (drillWalletOut). The wallet that was removed for it has to come back, so
 * the step leads to Home then, as at a later part, and not to Create.
 *
 * A step from the wallet's own list points to "Hold some" for either,
 * because a wallet and coins are what that step gives and it explains each
 * of them; once "Hold some" is done the reader has been through it, and is
 * sent straight to the screen that helps (Home, the faucet).
 *
 * For every reader "There are no balances" points to "Pass it on" for the
 * payment it needs, until that step is done.
 */
export function needOf(id: StepId, part: number, reason: Exclude<BlockedReason, WalletTrouble>, note: Progress, kept: 'yes' | 'no' | 'newer'): Need {
  const fact = partDef(id, part)?.on;
  const via = (step: StepId, otherwise: Action): NeedLink =>
    step !== id && !isDone(note, step) ? { kind: 'step', step } : { kind: 'screen', action: otherwise };
  /** The reader came to do this step, from a chapter: no need of it leads through "Hold some". */
  const direct = cameFromChapter(note, id);
  switch (reason) {
    case 'storage':
      return { text: kept === 'newer' ? 'needNewer' : 'need_storage', more: null, link: null };
    case 'no-wallet': {
      // The drill: nothing was removed while the step was followed, and nothing is here to remove.
      if (fact === 'wallet-removed') return { text: 'needRemovedElsewhere', more: null, link: { kind: 'screen', action: HOME } };
      if (direct) {
        // At the first part nothing says that this reader ever had a wallet: they make one, and one who has a wallet
        // already is told where it comes back. At a later part a wallet was here before, and Home brings it back.
        // So it does at the first part of another step while the drill's wallet is out of the browser for the
        // drill: the note names the wallet that has to come back, and making a new one here would stand in the
        // drill's way.
        const wasHere = part > 1 || (id !== DRILL && drillWalletOut(note));
        return wasHere
          ? { text: 'need_no-wallet', more: null, link: { kind: 'screen', action: HOME } }
          : { text: 'need_no-wallet', more: null, link: { kind: 'screen', action: CREATE }, also: HAD_ONE };
      }
      const link = via('hold-some', HOME);
      // "Hold some" would have this reader make a wallet. One who has a wallet already is told where it comes back.
      return link?.kind === 'step' ? { text: 'need_no-wallet', more: null, link, also: HAD_ONE } : { text: 'need_no-wallet', more: null, link };
    }
    case 'no-coins':
      if (fact === 'coins-found') return { text: 'needCoinsAgain', more: null, link: { kind: 'screen', action: FAUCET } };
      return { text: 'need_no-coins', more: null, link: direct ? { kind: 'screen', action: FAUCET } : via('hold-some', FAUCET) };
    case 'not-spendable-yet':
      return { text: 'need_not-spendable-yet', more: null, link: null };
    case 'nothing-sent':
      // The whole of "There are no balances" rests on a payment the wallet has sent.
      if (id === 'no-balances') return { text: 'needSentOnce', more: null, link: via('pass-it-on', SEND) };
      return { text: 'need_nothing-sent', more: null, link: { kind: 'screen', action: SEND } };
    case 'came-back-with-passkey':
      return { text: 'need_came-back-with-passkey', more: null, link: { kind: 'screen', action: SETTINGS } };
    case 'another-wallet':
      // Before the removal: the wallet here is not the one whose words were checked. Starting again checks this one's.
      if (fact === 'wallet-removed') return { text: 'needNotChecked', more: null, link: null };
      return { text: 'need_another-wallet', more: 'needAnotherWays', link: { kind: 'screen', action: SETTINGS } };
  }
}

// -- the paper copy the drill starts from ---------------------------------------------------

/**
 * "Prove the backup" opens with three words off the paper. A reader whose
 * wallet has no paper copy yet would be left with three fields and nothing
 * to read them from, so the part names where a paper copy is made: "The
 * seed", which shows the 12 words and has them written down. Once that
 * step is done it shows no words any more (it was done for another wallet,
 * or this part would be ticked), and the Backup screen is named instead.
 * Null for every other part.
 */
export function paperHelp(id: StepId, part: number, note: Progress): { text: DoitKey; link: Exclude<NeedLink, null> } | null {
  if (id !== 'prove-the-backup' || partDef(id, part)?.on !== 'three-words') return null;
  return isDone(note, 'the-seed')
    ? { text: 'paperNoneHere', link: { kind: 'screen', action: BACKUP } }
    : { text: 'paperNone', link: { kind: 'step', step: 'the-seed' } };
}

/**
 * True for the drill's paper check while the note of "The seed" says the
 * same: its three words were checked there, for the wallet the drill
 * names. The part then says where the check was made. A reader who opens
 * the drill after "The seed" finds this part ticked on arrival, and would
 * otherwise wonder what was checked, and when.
 */
export function checkedInSeed(id: StepId, part: number, note: Progress): boolean {
  if (id !== 'prove-the-backup' || partDef(id, part)?.on !== 'three-words') return false;
  const drill = note.steps[id];
  const seed = note.steps['the-seed'];
  if (drill?.parts?.[part] !== true || drill.wallet === undefined) return false;
  return seed?.wallet === drill.wallet && seed.parts?.[partCount('the-seed')] === true;
}

// -- a done step's ways on ---------------------------------------------------------------------

/** Where the card of a done step leads, beside the link back to the chapter and "All steps". */
export interface WaysOn {
  /** The step a need sent the reader here from, while it is not done: the card's main button leads back to it. */
  led: StepId | null;
  /** The next step of the same chapter, offered to a reader who opened this step from the wallet's own list. */
  next: StepId | null;
}

/**
 * The ways on from a done step, from the note alone (with a wallet in the
 * browser or without one). There are three cards:
 *
 *   in a detour        a need of another step sent the reader here, and
 *                      that step is not done: the main button leads back
 *                      to it, and the link back to the chapter is second.
 *                      No "Next step": where this step has a next one, it
 *                      is the step the reader came for, and the main
 *                      button names it already.
 *   reached by card    the main button is the link back to the chapter.
 *                      No "Next step": the reader came from the chapter to
 *                      do this one step, reads on there, and meets the
 *                      next card where the chapter has it.
 *   from the list      the link back to the chapter, then "Next step"
 *                      where the chapter has one.
 *
 * A step that was reached by card once and by a need later is in a detour:
 * the detour is the later road (progress.ts says why).
 */
export function waysOn(id: StepId, progress: Progress): WaysOn {
  return { led: ledBackTo(progress, id), next: cameFromChapter(progress, id) ? null : nextStep(id) };
}

// -- starting a step again --------------------------------------------------------------------

/**
 * Whether "Start this step again" is offered: on a step that is under way,
 * where its note can be written. With one exception. Once the drill has
 * seen its wallet removed and no wallet is in the browser, the note is all
 * that says which wallet has to come back, and starting again would erase
 * it: the step would then ask for "a wallet", and lead to making a new one
 * while the first waits on paper. In that state the one thing to do is
 * restore. (With another wallet here the step can be started again: that
 * is one of the two ways on it names.) The same while the page was not let
 * read its storage ("blocked"): it cannot see a wallet then, and the note
 * is still all that names the one that has to come back.
 */
export function canRestart(view: StepView, kept: 'yes' | 'no' | 'newer', status: string): boolean {
  if (view.state !== 'started' || kept !== 'yes') return false;
  const removal = STEP_DEFS[view.id].parts.findIndex((each) => each.on === 'wallet-removed');
  return !(removal !== -1 && view.parts[removal]?.state === 'ticked' && (status === 'none' || status === 'blocked'));
}

// -- the drill, between its removal and its restore ---------------------------------------------

/**
 * True when the step's open part is the one that brings the removed wallet
 * back, and the reader can do it now: the part rests on the restore from
 * the 12 words, and it is "now". It looks at the open part alone.
 *
 * With no wallet in the browser that is the drill between its removal and
 * its restore: the one state in which Home, whose usual main button makes a
 * new wallet, has to put the restore first (Home.svelte asks this of the
 * step the note follows, and only while no wallet is here). With the
 * drill's own wallet here through its passkey, or with another wallet, the
 * part is not "now": each is a need, said on the step's screen. (Once the
 * wallet is back from its words the part is "now" for one more moment,
 * until its tick is written: judge() never calls a part ticked before the
 * note says so.)
 *
 * Where nothing can be written it is false for a drill that was never
 * started (its first part stands in the way), and true for a note that
 * holds the removal: the restore is still what brings that reader's wallet
 * back. It is false for every other step, for a done step, and for a step
 * that was never started.
 */
export function awaitsRestore(view: StepView): boolean {
  if (view.at === null || partDef(view.id, view.at)?.on !== 'restored-from-words') return false;
  return view.parts[view.at - 1]?.state === 'now';
}

// -- the glossary -------------------------------------------------------------------------

/** An entry of the main site's glossary that these screens link: one of the map's (read/read.ts), or the faucet's. */
export type Term = GlossaryTerm | 'faucet';

/** The key of the words on a term's link. */
export function termKey(term: Term): DoitKey {
  return `term_${term}` as DoitKey;
}

/**
 * The new things each part of "Hold some" names, by their glossary entry.
 * The step explains each new thing itself, so the part that first says the
 * word links what it means. No other step links the glossary from its
 * parts.
 */
const PART_TERMS: Partial<Record<StepId, readonly (readonly Term[])[]>> = {
  'hold-some': [['wallet', 'seed'], ['address', 'faucet'], ['block']],
};

/** The glossary entries the open part links, in the order it names them. */
export function termsOf(id: StepId, part: number): readonly Term[] {
  return PART_TERMS[id]?.[part - 1] ?? [];
}

// -- a wait that is over ----------------------------------------------------------------------

/**
 * Which account of a wait the line under a part is made from.
 *
 * `noted` is judge()'s, from the note while it still names the payment: the
 * block, and the seconds where the block's own time can say them (a block's
 * time is its miner's clock, and may lie before the moment the payment was
 * sent). `remembered` is what this page kept from the moment it saw the
 * block come, with the seconds by its own clock. The note's account is the
 * one that outlives a page load, so it comes first; where it has the block
 * and not the seconds, and the page remembers that same block, the page's
 * seconds are said.
 */
export function waitedOf(noted: Waited | null, remembered: Waited | null): Waited | null {
  if (noted === null) return remembered;
  if (noted.seconds === null && remembered !== null && remembered.height === noted.height) return remembered;
  return noted;
}

/** The one line a part keeps once its block has come: how long it waited, and which block took it in. */
export function waitedText(waited: { height: number; seconds: number | null }, lang: Lang): string {
  const t = strings.doit[lang];
  const height = formatSats(waited.height);
  if (waited.seconds === null) return fill(t.waitedBlock, { height });
  if (waited.seconds === 1) return fill(t.waitedOne, { height });
  return fill(t.waited, { seconds: formatSats(waited.seconds), height });
}
