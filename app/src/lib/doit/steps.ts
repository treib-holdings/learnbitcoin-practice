// The six "Do it" steps, as data.
//
// Some chapters of the site's Journey have steps: things the reader does in
// their own practice wallet. A step is a short list of parts, each of which
// the reader carries out there, and each of which the page checks. This
// file says what the steps are: which chapter a step belongs to, and for
// every part what kind of proof it takes and the one fact it rests on. It
// also holds the table of chapters, the one place in the repository where a
// chapter's number and its title are written. It decides nothing. judge.ts
// reads a fact off the wallet, advance.ts notices the moment one comes true,
// and the screens say it all in words.
//
// The four kinds of part:
//
//   state   something that is so in the wallet (a wallet is here, a coin is
//           confirmed, a payment is in a block). Looked at whenever anything
//           changes, on any screen, for every step that is started.
//   event   something that happens (a payment is sent, a screen is opened,
//           the 12 words are put on screen, the wallet is removed). It
//           counts only for the step the reader is following at that moment.
//   ask     a question the reader answers on the step's own screen.
//   say-so  a box the reader ticks, for what no page can check.
//
// Plain data with no Svelte and no browser objects in it, so "node --test"
// reads it as it is.

import { STEPS, type Lang, type StepId } from '@learnbitcoin/practice-contract';

export { STEPS };
export type { StepId };

export type PartKind = 'state' | 'event' | 'ask' | 'say-so';

/**
 * The one fact a part rests on. Each is spelled out where it is judged
 * (judge.ts); the short version:
 *
 *   wallet-here          a wallet is in this browser
 *   coins-seen           the wallet has seen coins arrive: it holds a coin, or one of its receive addresses was used
 *   coin-confirmed       the wallet holds a confirmed coin
 *   block-height         asked: the number of the block that took the wallet's first coin in
 *   spendable            the wallet has coins it may spend now
 *   sent-to-pot          this wallet sent a payment to an address the pot handed out
 *   sent                 this wallet sent a payment, to any address
 *   payment-confirmed    the list of transactions holds the step's noted payment, in a block
 *   six-blocks           that payment has six confirmations
 *   coins-opened         the Coins screen was opened while the wallet held a coin
 *   coin-count           asked: how many separate coins the wallet holds
 *   payment-read         the transaction screen was opened for a payment this wallet sent
 *   words-shown          the wallet's 12 words were put on screen
 *   written              said: the 12 words are written on paper
 *   three-words          asked: three of the 12 words, by their place
 *   wallet-removed       the wallet the step names was removed from this browser
 *   restored-from-words  that same wallet is here again, kept with its words (so it came back through Restore)
 *   coins-found          its coins are known, and there are some
 */
export type Fact =
  | 'wallet-here'
  | 'coins-seen'
  | 'coin-confirmed'
  | 'block-height'
  | 'spendable'
  | 'sent-to-pot'
  | 'sent'
  | 'payment-confirmed'
  | 'six-blocks'
  | 'coins-opened'
  | 'coin-count'
  | 'payment-read'
  | 'words-shown'
  | 'written'
  | 'three-words'
  | 'wallet-removed'
  | 'restored-from-words'
  | 'coins-found';

/** One part of a step. Its place in the step's list is its number, counted from 1. */
export interface PartDef {
  kind: PartKind;
  /** What it rests on. */
  on: Fact;
}

/** What the code knows a chapter by. A key is never shown, stored or sent, and it never changes. */
export type ChapterKey = 'bitcoin' | 'payment' | 'keys';

/**
 * A chapter of the main site's Journey that has steps, as the code sees it:
 * its key, and its page in each language. Its number and its title are not
 * part of this type on purpose. They are for showing only, and a sentence
 * takes them from chapterSlots().
 */
export interface Chapter {
  key: ChapterKey;
  /**
   * The page's path on the main site, by language, as the main site itself
   * writes its address: with no slash at the end. For a step of this
   * chapter these two paths are the only ways back there are (validFrom in
   * progress.ts): a "from" in a step's address counts only when it is one
   * of them, character for character.
   */
  path: Readonly<Record<Lang, string>>;
}

/** The key of a step's title in the "Do it" string table: "title_hold-some". */
export type TitleKey = `title_${StepId}`;

/** The key of a part's name in the "Do it" string table: "part_hold-some_1". */
export type PartKey = `part_${StepId}_${number}`;

export interface StepDef {
  id: StepId;
  /** Where the step's title is in the string table. (The table is the screens' business: this is only the key.) */
  title: TitleKey;
  chapter: Chapter;
  /** The parts, in the order they are done. */
  parts: readonly PartDef[];
}

// -- the chapters -------------------------------------------------------------
//
// THE TABLE. A chapter's number and its title are written here, and nowhere
// else in the repository: no string table, no screen, no test and no scenario
// holds one. When the main site renumbers or retitles its chapters, the
// `number` and `title` lines below are the whole edit: the `en` half of a line
// when the English chapters change, the `es` half when the Spanish ones do.
// A chapter's `key` and its two paths never change: the code tells chapters
// apart by the key, and readers' browsers hold the paths (progress.ts).

/** A row of the table: a chapter with what a reader is shown of it. Not exported: chapterSlots() alone reads the two fields. */
interface ChapterRow extends Chapter {
  /** Its number in the Journey, by language: the number the main site prints on that language's page of the chapter. */
  number: Readonly<Record<Lang, number>>;
  /**
   * Its title, by language, as the main site prints it. Written in the string
   * tables' alphabet: a plain apostrophe, quotation mark or hyphen where the
   * main site prints a typographic one.
   */
  title: Readonly<Record<Lang, string>>;
}

const BITCOIN: ChapterRow = {
  key: 'bitcoin',
  number: { en: 2, es: 2 },
  title: { en: 'What Bitcoin Actually Is', es: 'Qué es Bitcoin en realidad' },
  path: { en: '/journey/what-bitcoin-actually-is', es: '/es/recorrido/que-es-bitcoin-en-realidad' },
};
const PAYMENT: ChapterRow = {
  key: 'payment',
  number: { en: 3, es: 3 },
  title: { en: 'How Bitcoin Works', es: 'Cómo funciona Bitcoin' },
  path: { en: '/journey/how-bitcoin-works', es: '/es/recorrido/como-funciona-bitcoin' },
};
const KEYS: ChapterRow = {
  key: 'keys',
  number: { en: 4, es: 4 },
  title: { en: 'Be Your Own Bank', es: 'Sé tu propio banco' },
  path: { en: '/journey/be-your-own-bank', es: '/es/recorrido/se-tu-propio-banco' },
};

/** The rows, in reading order. */
const TABLE: readonly ChapterRow[] = [BITCOIN, PAYMENT, KEYS];

/** The chapters that have steps, in reading order. */
export const CHAPTERS: readonly Chapter[] = TABLE;

/** The same rows by key. The compiler refuses a key that has no row here. */
const BY_KEY: Readonly<Record<ChapterKey, ChapterRow>> = { bitcoin: BITCOIN, payment: PAYMENT, keys: KEYS };

/** A chapter by its key. */
export function chapterOf(key: ChapterKey): Chapter {
  return BY_KEY[key];
}

/**
 * What a sentence may take from the table to name a chapter, in one language:
 * "<key>Number" and "<key>Title" for every chapter ("keysNumber", "keysTitle"),
 * and "number" and "title" for `own`, when one is handed in: the chapter the
 * sentence is shown for (a step's own, or the one a heading names). This is
 * the one function that reads a chapter's number or its title.
 */
export function chapterSlots(lang: Lang, own?: Chapter): Record<string, string> {
  const slots: Record<string, string> = {};
  for (const row of TABLE) {
    slots[`${row.key}Number`] = String(row.number[lang]);
    slots[`${row.key}Title`] = row.title[lang];
  }
  if (own !== undefined) {
    const row = BY_KEY[own.key];
    slots.number = String(row.number[lang]);
    slots.title = row.title[lang];
  }
  return slots;
}

// -- the steps ----------------------------------------------------------------

const part = (kind: PartKind, on: Fact): PartDef => ({ kind, on });

/**
 * The six definitions. The compiler holds the table to the contract's list
 * of steps: a step added there has no screen until it has its parts here.
 */
export const STEP_DEFS: Readonly<Record<StepId, StepDef>> = {
  // The bitcoin chapter: the first coin. The step explains a wallet, an address and the faucet itself.
  'hold-some': {
    id: 'hold-some',
    title: 'title_hold-some',
    chapter: BITCOIN,
    parts: [
      part('state', 'wallet-here'),
      part('state', 'coins-seen'),
      part('state', 'coin-confirmed'),
      part('ask', 'block-height'),
    ],
  },
  // The payment chapter, the send button: a payment to the pot, and its first confirmation.
  'pass-it-on': {
    id: 'pass-it-on',
    title: 'title_pass-it-on',
    chapter: PAYMENT,
    parts: [part('state', 'spendable'), part('event', 'sent-to-pot'), part('state', 'payment-confirmed')],
  },
  // The payment chapter, "there are no balances": coins, counted one by one, and what a payment did to them.
  'no-balances': {
    id: 'no-balances',
    title: 'title_no-balances',
    chapter: PAYMENT,
    parts: [part('event', 'coins-opened'), part('ask', 'coin-count'), part('event', 'payment-read')],
  },
  // The payment chapter, the waiting room and confirmations: one payment, watched from sent to six blocks deep.
  'waiting-room': {
    id: 'waiting-room',
    title: 'title_waiting-room',
    chapter: PAYMENT,
    parts: [part('event', 'sent'), part('state', 'payment-confirmed'), part('state', 'six-blocks')],
  },
  // The keys chapter: the 12 words, on paper, and checked.
  'the-seed': {
    id: 'the-seed',
    title: 'title_the-seed',
    chapter: KEYS,
    parts: [part('event', 'words-shown'), part('say-so', 'written'), part('ask', 'three-words')],
  },
  // The keys chapter: the drill. The wallet is removed and comes back from the paper copy alone.
  'prove-the-backup': {
    id: 'prove-the-backup',
    title: 'title_prove-the-backup',
    chapter: KEYS,
    parts: [
      part('ask', 'three-words'),
      part('event', 'wallet-removed'),
      part('state', 'restored-from-words'),
      part('state', 'coins-found'),
    ],
  },
};

/** A step's definition. */
export function stepDef(id: StepId): StepDef {
  return STEP_DEFS[id];
}

/** Every step, in the contract's order. */
export function allSteps(): StepDef[] {
  return STEPS.map((id) => STEP_DEFS[id]);
}

/** How many parts a step has. */
export function partCount(id: StepId): number {
  return STEP_DEFS[id].parts.length;
}

/** A part of a step by its number, counted from 1, or undefined when the step has no such part. */
export function partDef(id: StepId, part: number): PartDef | undefined {
  return Number.isInteger(part) && part >= 1 ? STEP_DEFS[id].parts[part - 1] : undefined;
}

/** The key of a part's name in the "Do it" string table. `part` is its number, counted from 1. */
export function partKey(id: StepId, part: number): PartKey {
  return `part_${id}_${part}`;
}

/** The steps of one chapter, in order: what the list of steps shows under the chapter's name. */
export function stepsOf(chapter: ChapterKey): StepId[] {
  return STEPS.filter((id) => STEP_DEFS[id].chapter.key === chapter);
}

/**
 * The step a done step's screen offers next: the one after it, but only
 * when that one belongs to the same chapter. A reader who has just finished
 * a chapter's last step has not read the next chapter yet.
 */
export function nextStep(id: StepId): StepId | null {
  const next = STEPS[STEPS.indexOf(id) + 1];
  return next !== undefined && STEP_DEFS[next].chapter.key === STEP_DEFS[id].chapter.key ? next : null;
}

/**
 * The number (from 1) of the part in which the step notes a payment of the
 * wallet's own, or null when the step waits for none. The note keeps that
 * payment's ID and the moment it was sent until the step is done.
 */
export function sendPart(id: StepId): number | null {
  const at = STEP_DEFS[id].parts.findIndex((each) => each.on === 'sent-to-pot' || each.on === 'sent');
  return at === -1 ? null : at + 1;
}
