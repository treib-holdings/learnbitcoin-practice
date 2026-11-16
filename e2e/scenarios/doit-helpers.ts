// What the scenarios of the "Do it" steps stand on (doit-*.test.ts), beside
// scenario() itself and the journeys' tools (journey-helpers.ts).
//
// A step is a short list of parts that the reader carries out in their own
// practice wallet, and that the page checks against the practice chain. A
// scenario of a step therefore asks, again and again, the same few things,
// and this file holds the tools for them:
//
//   - Where does the step stand? The parts of a step's screen say so
//     themselves (data-state on each): partsOf(), and untilParts() for a
//     part that ticks by itself when a block comes.
//   - What does the strip say on the wallet's own screens? stripOf().
//   - What does this browser keep of it? The one note of the steps, as it
//     is stored: noteOf(), noteText().
//   - What was counted, exactly? Every scenario here ends with the whole
//     list (ends()), and with the look for anything private in what was
//     counted, logged or stored. For the stored note that look is
//     storedIsPublic(): the note may name a wallet by its wallet
//     fingerprint and a payment by its ID, and nothing else of a wallet.
//
// How a scenario starts matters: what the app counts in its first moment
// (the first screen view) is over before a page that has just been opened
// can be watched. So begin() opens a page of the app's origin that is not
// the app, sets the watch up there, and only then loads the app.
//
// A scenario that pays a wallet from the stand-in, makes a block, or asks
// the faucet (the bot check is the stand-in's own) is local only, and says
// so where it is registered. Each file says which of its scenarios could
// run against a real practice network as they are.

import assert from 'node:assert/strict';
import type { EventBody, Lang, StepId } from '@learnbitcoin/practice-contract';
import { ENGLISH_WORDS } from '@learnbitcoin/practice-wallet';
import { PROGRESS_KEY, type Progress } from '../../app/src/lib/doit/progress.ts';
import { CHAPTERS, STEPS, partCount, partKey, stepDef } from '../../app/src/lib/doit/steps.ts';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import type { OpenOptions, OpenedPage, Scenario } from './helpers.ts';
import {
  arrivesAt,
  attributeOf,
  countOf,
  countedBy,
  countedExactly,
  heldBy,
  hook,
  loads,
  nothingPrivate,
  pairsOf,
  sentBy,
  sentTxid,
  standBy,
  toSection,
  typeWords,
  until,
  untilAnswersCount,
  watchEventRequests,
  type EventRequest,
  type Secrets,
} from './journey-helpers.ts';

export { PROGRESS_KEY };
export type { Progress };

// -- starting ---------------------------------------------------------------------------------

/** One page of a scenario, with every request it sends to be counted. */
export interface Reader {
  page: OpenedPage;
  /** What the page has sent to /p/event so far, in the order it sent it, page loads included. */
  requests: () => EventRequest[];
}

/**
 * Opens the app at `path` with the watch for what is counted already in
 * place. Waits here are given 30 seconds: a part that waits for a block is
 * ticked at the wallet's next look at the chain, which can be 15 seconds away.
 */
export async function begin(s: Scenario, path: string, options: Omit<OpenOptions, 'path'> = {}): Promise<Reader> {
  const page = await standBy(s, { timeout: 30_000, ...options });
  const requests = watchEventRequests(page);
  await page.goto(path);
  return { page, requests };
}

// -- words ----------------------------------------------------------------------------------------

const DOIT = { en: strings.doit.en, es: strings.doit.es } as const;

/** A step's title in a language. */
export const titleOf = (id: StepId, lang: Lang = 'en'): string => DOIT[lang][stepDef(id).title];

/** A part's name in a language. `part` counts from 1. */
export const partName = (id: StepId, part: number, lang: Lang = 'en'): string => DOIT[lang][partKey(id, part) as keyof typeof strings.doit.en];

/** What the status region says when a part is ticked on the step's own screen. */
export const saidTicked = (id: StepId, part: number, lang: Lang = 'en'): string =>
  fill(DOIT[lang].saidTicked, { n: String(part), m: String(partCount(id)), part: partName(id, part, lang) });

/** What the status region says when a step is done. */
export const saidDone = (id: StepId, lang: Lang = 'en'): string => fill(DOIT[lang].saidDone, { step: titleOf(id, lang) });

// -- a step's screen ----------------------------------------------------------------------------------

/** Where each part of the step on screen stands, in order: ticked, now, blocked, unknown or later. */
export const partsOf = (page: OpenedPage): Promise<string[]> =>
  page.page.$$eval(hook('step-part'), (parts) => parts.map((part) => part.getAttribute('data-state') ?? ''));

/** The one or two words each part says of itself: "Checked", "Opened", "Your word", "Now", "Later", "Not yet". */
export const partWords = (page: OpenedPage): Promise<string[]> => page.texts('step-part-state');

/**
 * Waits until the parts stand as `wanted`: for a part that ticks by itself.
 * A part that waits for a block ticks at the wallet's next look at the
 * chain's height, and it looks every 15 seconds, so the wait may take that
 * long and a little more.
 */
export async function untilParts(page: OpenedPage, wanted: readonly string[], ms = 40_000): Promise<void> {
  let last: string[] = [];
  await until(
    async () => {
      // The page may be between two documents: then there is nothing to read yet.
      last = await partsOf(page).catch(() => []);
      return last.join() === wanted.join();
    },
    `the parts stand as ${wanted.join()}`,
    ms,
  ).catch((error: unknown) => {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; they stand as ${last.join()}`);
  });
}

/** Opens a step's screen by its address, as a page load, and waits for its parts. */
export async function loadStep(page: OpenedPage, id: StepId, options: { prefix?: string; query?: string } = {}): Promise<void> {
  await page.goto(`${options.prefix ?? ''}/do/${id}${options.query ?? ''}`);
  await page.waitFor('step-parts');
}

/** Loads the page that is showing again, as a reader's reload does, and waits for a step's parts. */
export async function reloadStep(page: OpenedPage): Promise<void> {
  await page.page.reload({ waitUntil: 'load' });
  await page.waitFor('step-parts');
}

/**
 * The step's screen, marked: the returned function says whether the same
 * screen in the same document is still showing. A page load makes a new
 * document, and a move to another screen and back makes a new list of
 * parts; either way the mark is gone. For "the part ticked while the
 * screen stayed open, with no move and no reload".
 */
export async function marked(page: OpenedPage): Promise<() => Promise<boolean>> {
  const mark = `stays-${Date.now()}`;
  await page.page.evaluate(
    (selector, value) => {
      (window as unknown as { __doitMark?: string }).__doitMark = value;
      document.querySelector(selector)?.setAttribute('data-mark', value);
    },
    hook('step-parts'),
    mark,
  );
  const path = await page.page.evaluate(() => location.pathname);
  return () =>
    page.page.evaluate(
      (selector, value, wanted) =>
        (window as unknown as { __doitMark?: string }).__doitMark === value &&
        document.querySelector(selector)?.getAttribute('data-mark') === value &&
        location.pathname === wanted,
      hook('step-parts'),
      mark,
      path,
    );
}

/** The address a link with this test hook leads to. */
export const hrefOf = (page: OpenedPage, id: string): Promise<string | null> => attributeOf(page, id, 'href');

/**
 * Types the three words a step's screen asks for. The fields say which
 * places of the phrase they want (data-place, counted from 1); `words` is
 * the wallet's 12 words, or what the scenario wants typed in their place.
 * Gives the places that were asked for.
 */
export async function typeThree(page: OpenedPage, words: readonly string[]): Promise<number[]> {
  await page.waitFor('step-word');
  const fields = await page.page.$$(hook('step-word'));
  assert.equal(fields.length, 3, 'three fields');
  const places: number[] = [];
  for (const field of fields) {
    const place = Number(await field.evaluate((input) => input.getAttribute('data-place')));
    assert.ok(Number.isInteger(place) && place >= 1 && place <= 12, `a place from 1 to 12, not ${place}`);
    places.push(place);
    await field.type(words[place - 1] ?? '');
  }
  assert.equal(new Set(places).size, 3, 'three different places');
  return places;
}

/** What the three word fields hold right now. */
export const wordFields = (page: OpenedPage): Promise<string[]> =>
  page.page.$$eval(hook('step-word'), (fields) => fields.map((field) => (field as HTMLInputElement).value));

/** The places of the phrase (from 1) the three fields ask for, in the order of the fields. */
export const placesAsked = (page: OpenedPage): Promise<number[]> =>
  page.page.$$eval(hook('step-word'), (fields) => fields.map((field) => Number(field.getAttribute('data-place'))));

/** Types one text into each of the three fields, in the order of the fields, exactly as given. */
export async function typeFields(page: OpenedPage, typed: readonly string[]): Promise<void> {
  await page.waitFor('step-word');
  const fields = await page.page.$$(hook('step-word'));
  assert.equal(fields.length, 3, 'three fields');
  for (const [at, field] of fields.entries()) await field.type(typed[at] ?? '');
}

/** The sentences under the fields after a check that found a wrong word: one for each wrong place, then the way on. */
export const wrongLines = (page: OpenedPage): Promise<string[]> =>
  page.page.$$eval(`${hook('step-words-wrong')} p`, (lines) => lines.map((line) => (line.textContent ?? '').replace(/\s+/g, ' ').trim()));

/** The place (from 1) of the word field that has the keyboard's focus, or null when none has. */
export const focusedPlace = (page: OpenedPage): Promise<number | null> =>
  page.page.evaluate(() => {
    const active = document.activeElement;
    return active?.getAttribute('data-testid') === 'step-word' ? Number(active.getAttribute('data-place')) : null;
  });

/** A word of the wallets' own word list that is none of these: a real word, and the wrong one. */
export function strangerTo(words: readonly string[]): string {
  const stranger = ENGLISH_WORDS.find((word) => !words.includes(word));
  assert.ok(stranger !== undefined);
  return stranger;
}

/**
 * What a field for seed words must carry, and must not (SPEC section 12),
 * read off the three fields on screen: no spell check, no autocomplete, no
 * autocorrect, no capitals, never translated, no name, no form around it,
 * and never on paper.
 */
export const wordFieldRules = (page: OpenedPage): Promise<Record<string, string | boolean | null>[]> =>
  page.page.$$eval(hook('step-word'), (fields) =>
    fields.map((field) => ({
      spellcheck: field.getAttribute('spellcheck'),
      autocomplete: field.getAttribute('autocomplete'),
      autocorrect: field.getAttribute('autocorrect'),
      autocapitalize: field.getAttribute('autocapitalize'),
      translate: field.getAttribute('translate'),
      name: field.getAttribute('name'),
      inForm: field.closest('form') !== null,
      onPaper: field.closest('[data-print="never"]') === null,
    })),
  );

/** What wordFieldRules() must give for each of the three fields. */
export const WORD_FIELD_RULES = {
  spellcheck: 'false',
  autocomplete: 'off',
  autocorrect: 'off',
  autocapitalize: 'none',
  translate: 'no',
  name: null,
  inForm: false,
  onPaper: false,
} as const;

// -- the strip ------------------------------------------------------------------------------------------

export interface StripSeen {
  /** The step it is for. */
  step: string;
  /** What it says in the place of the part's name: part, need, unknown, failed, waiting, lost or done. */
  says: string;
  /** Its words, where it shows them: the part's name, the need, or that the step is done. */
  words: string;
  /** The whole line as it is drawn, links and all: what a narrow screen leaves out is not in it. */
  text: string;
}

/** The strip under the header, or null when the screen has none. */
export const stripOf = (page: OpenedPage): Promise<StripSeen | null> =>
  page.page.evaluate(() => {
    const strip = document.querySelector('[data-testid="strip"]');
    if (strip === null) return null;
    const tidy = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
    return {
      step: strip.getAttribute('data-step') ?? '',
      says: strip.getAttribute('data-says') ?? '',
      words: tidy(strip.querySelector('[data-testid="strip-says"]')?.textContent),
      text: tidy((strip as HTMLElement).innerText),
    };
  });

/** Waits until the strip is for this step and says this kind of thing. */
export async function untilStrip(page: OpenedPage, step: StepId, says: string, ms = 40_000): Promise<StripSeen> {
  let last: StripSeen | null = null;
  await until(
    async () => {
      last = await stripOf(page).catch(() => null);
      return last !== null && last.step === step && last.says === says;
    },
    `the strip says "${says}" for ${step}`,
    ms,
  ).catch((error: unknown) => {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; it is ${JSON.stringify(last)}`);
  });
  return last!;
}

/**
 * "Back to the step", on the strip. The page is taken to its top first, as
 * a reader would: further down, the sticky PRACTICE banner lies over the
 * strip. Once the bot check's script has been in the page the move is a
 * page load (`load`).
 */
export async function stripBack(page: OpenedPage, step: StepId, options: { prefix?: string; load?: boolean } = {}): Promise<void> {
  await page.page.evaluate(() => window.scrollTo(0, 0));
  if (options.load) await loads(page, () => page.click('strip-back'));
  else await page.click('strip-back');
  await arrivesAt(page, `${options.prefix ?? ''}/do/${step}`);
  await page.waitFor('step-parts');
}

/** The step's one action: a link into the wallet. Waits for the screen it leads to. */
export async function act(page: OpenedPage, path: string, options: { load?: boolean; hook?: string } = {}): Promise<void> {
  const id = options.hook ?? 'step-action';
  if (options.load) await loads(page, () => page.click(id));
  else await page.click(id);
  await arrivesAt(page, path);
}

// -- the wallet's own screens, as a step sends the reader through them ------------------------------------------

/** A payment made on the Send screen. */
export interface Paid {
  txid: string;
  /** The address that was paid. */
  to: string;
}

/**
 * On the Send screen: a payment, from the form to the sent view. `to` is an
 * address, or "pot" for the "Pass it on" helper, which fills in an address
 * the pot hands out. `amount` is typed as given ("30,000"), or "all" for
 * the "Send all" button.
 */
export async function pay(page: OpenedPage, to: 'pot' | string, amount: string, prefix = ''): Promise<Paid> {
  await page.waitFor('send-spendable');
  if (to === 'pot') {
    await page.click('pass-it-on');
    await page.waitFor('send-to-pot');
  } else {
    await page.fill('send-to', to);
  }
  const address = await heldBy(page, 'send-to');
  if (amount === 'all') await page.click('send-all');
  else await page.fill('send-amount', amount);
  await page.waitFor('send-plan');
  await page.click('send-continue');
  await page.waitFor('send-review');
  await page.click('send-broadcast');
  const txid = await sentTxid(page, prefix);
  await page.waitFor('send-sent');
  return { txid, to: address };
}

/**
 * On the Settings screen: takes the wallet out of this browser. The
 * question takes no answer in its first moment (components/taps.ts), so
 * the answer waits that long. Ends on Home.
 */
export async function removeHere(page: OpenedPage, prefix = ''): Promise<void> {
  await page.click('remove-wallet');
  await page.waitFor('remove-confirm');
  await untilAnswersCount();
  await page.click('remove-confirm');
  await arrivesAt(page, prefix === '' ? '/' : prefix);
}

/** On the Restore screen: types the 12 words, says that they are practice words, and restores. Ends on the Overview. */
export async function restoreHere(page: OpenedPage, words: readonly string[], prefix = ''): Promise<void> {
  await typeWords(page, words);
  await page.click('restore-check');
  await page.click('restore-go');
  await arrivesAt(page, `${prefix}/wallet`);
}

// -- what this browser keeps --------------------------------------------------------------------------------------

/** The note of the steps as it is stored, or null when there is none. */
export const noteText = (page: OpenedPage): Promise<string | null> => page.stored(PROGRESS_KEY);

/** The stored note, read. Null when nothing is stored. */
export async function noteOf(page: OpenedPage): Promise<Progress | null> {
  const text = await noteText(page);
  return text === null ? null : (JSON.parse(text) as Progress);
}

/** A stored note, as text: for a scenario that starts in the middle of a step. */
export const noteFor = (progress: Omit<Progress, 'v'>): string => JSON.stringify({ v: 1, ...progress });

/** The fields a stored note may have, and the fields of one step in it (SPEC-A3 section 4). */
const NOTE_FIELDS = ['v', 'following', 'followedAt', 'steps'];
const STEP_FIELDS = ['started', 'doneAt', 'from', 'wallet', 'was', 'tx', 'sentAt', 'parts'];

/** The words of a text, in lower case: runs of letters, with everything else as their borders. */
const tokensOf = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^a-z]+/).filter((token) => token !== ''));

/** Every word a note is made of by its own shape: its field names, the six steps, the two ways a wallet is kept, the chapters' paths. */
const NOTE_WORDS = tokensOf(
  [...NOTE_FIELDS, ...STEP_FIELDS, ...STEPS, 'passkey', 'words', 'true', 'null', ...CHAPTERS.flatMap((chapter) => Object.values(chapter.path))].join(' '),
);

const isTime = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * A stored note holds public things only: ticks, times, which of a
 * chapter's two pages the reader came from, a wallet fingerprint, a
 * transaction ID. Never a word of the 12, never a key, never an address,
 * never an answer, and no text of anybody's choosing.
 *
 * The note is held to its closed shape first: the listed fields and no
 * others, each of the kind it must be. A shape that has no field for an
 * answer or an address keeps none. A step's way back (`from`) is the
 * English or the Spanish page of the step's own chapter, character for
 * character, or it is not there: whatever a scenario's address said after
 * "from=", nothing else may have reached the note. Then, all the same, its
 * text is searched: for anything that looks like an address or a key, for
 * a transaction ID anywhere but in a step's `tx`, for every secret the
 * scenario knows by value, and for the 12 words (two in a row never; one
 * alone only where the note's own shape has that very word, as "wallet"
 * and "seed" are on the word list and in the field names).
 */
export function noteIsPublic(text: string, secrets: Secrets): void {
  const note: unknown = JSON.parse(text);
  assert.ok(typeof note === 'object' && note !== null && !Array.isArray(note), text);
  const top = note as Record<string, unknown>;
  for (const field of Object.keys(top)) assert.ok(NOTE_FIELDS.includes(field), `the note has a field "${field}"`);
  assert.equal(top.v, 1);
  assert.ok(top.following === null || STEPS.includes(top.following as StepId), text);
  assert.ok(top.followedAt === undefined || isTime(top.followedAt), text);
  const steps = (top.steps ?? {}) as Record<string, Record<string, unknown>>;
  for (const [id, step] of Object.entries(steps)) {
    assert.ok(STEPS.includes(id as StepId), `the note has a step "${id}"`);
    for (const field of Object.keys(step)) assert.ok(STEP_FIELDS.includes(field), `the note of ${id} has a field "${field}"`);
    assert.ok(step.started === undefined || step.started === true, text);
    assert.ok(step.doneAt === undefined || isTime(step.doneAt), text);
    assert.ok(step.sentAt === undefined || isTime(step.sentAt), text);
    assert.ok(step.from === undefined || Object.values(stepDef(id as StepId).chapter.path).includes(step.from as string), `the note of ${id} names a way back that is not its own chapter: ${JSON.stringify(step.from)}`);
    assert.ok(step.wallet === undefined || (typeof step.wallet === 'string' && /^[0-9a-f]{8}$/.test(step.wallet)), text);
    assert.ok(step.was === undefined || step.was === 'passkey' || step.was === 'words', text);
    assert.ok(step.tx === undefined || (typeof step.tx === 'string' && /^[0-9a-f]{64}$/.test(step.tx)), text);
    const parts = (step.parts ?? {}) as Record<string, unknown>;
    for (const [number, tick] of Object.entries(parts)) {
      assert.ok(/^[1-4]$/.test(number) && tick === true, `the note of ${id} has a tick ${number}: ${JSON.stringify(tick)}`);
    }
  }

  // The search. A transaction ID belongs in a step's `tx` and nowhere else: those are taken out first.
  const searched = text.replace(/"tx":"[0-9a-f]{64}"/g, '"tx":""');
  assert.doesNotMatch(searched, /bcrt1|tb1q|tpub|tprv|[0-9a-f]{64}/i, 'the note holds what looks like an address, a key or a transaction ID out of its place');
  const values = [
    ...secrets.records.flatMap((record) => (record === null ? [] : [record.xpub, record.firstAddress, record.credentialId, record.tag])),
    ...secrets.addresses,
  ].filter((value): value is string => typeof value === 'string' && value !== '');
  for (const value of values) assert.ok(!text.includes(value), `the note holds ${value}`);
  const allowed = NOTE_WORDS;
  const tokens = tokensOf(text);
  for (const words of secrets.words) {
    for (const pair of pairsOf(words)) assert.ok(!text.toLowerCase().includes(pair), 'the note holds two of the 12 words in a row');
    for (const word of words) assert.ok(!tokens.has(word) || allowed.has(word), `the note holds "${word}", one of the 12 words, and its shape has no such word`);
  }
}

/**
 * What this origin keeps in the browser, held against what it may keep:
 * the wallet's record and the note of the steps, under their two keys, and
 * nothing else anywhere (no other key, nothing in sessionStorage, no
 * cookie). The note, when there is one, holds public things only
 * (noteIsPublic). `others` names keys the scenario put there itself.
 * `untouched` is for a note the scenario itself stored and the page must
 * not have changed (one written by a newer version of the page): the
 * stored text has to be exactly that, to the last character.
 */
export interface KeptOptions {
  others?: readonly string[];
  untouched?: string;
}

export async function storedIsPublic(page: OpenedPage, secrets: Secrets, options: KeptOptions = {}): Promise<void> {
  const kept = await page.page.evaluate(() => ({ local: Object.keys(localStorage).sort(), session: sessionStorage.length, cookie: document.cookie }));
  const known = ['lbp_wallet_v1', PROGRESS_KEY, ...(options.others ?? [])];
  for (const key of kept.local) assert.ok(known.includes(key), `this browser keeps something under "${key}"`);
  assert.deepEqual([kept.session, kept.cookie], [0, ''], 'nothing in sessionStorage, and no cookie');
  const text = await noteText(page);
  if (options.untouched !== undefined) assert.equal(text, options.untouched, 'the note the scenario stored is as it was');
  else if (text !== null) noteIsPublic(text, secrets);
}

// -- what was counted -----------------------------------------------------------------------------------------------

/** A screen view, as it is counted. */
export const view = (path: string): EventBody => ({ name: 'pageview', path });

/** A finished step, as it is counted: under the screen its last part was ticked on. */
export const doIt = (path: string, step: StepId): EventBody => ({ name: 'Do it', path, value: step });

/** How often each step was counted as done, by what the Worker passed on. A step that was never counted is not in it. */
export function stepsCounted(s: Scenario): Partial<Record<StepId, number>> {
  const counts: Partial<Record<StepId, number>> = {};
  for (const { event } of s.stack.events) {
    if (event.name !== 'Do it') continue;
    const step = event.value as StepId;
    counts[step] = (counts[step] ?? 0) + 1;
  }
  return counts;
}

/**
 * How every scenario of the steps ends: the exact list of what the page
 * counted, in order; nothing in what was counted, logged or sent that says
 * which wallet it was (nothingPrivate); and nothing private in what this
 * browser keeps (storedIsPublic).
 */
export async function ends(s: Scenario, reader: Reader, expected: EventBody[], secrets: Secrets, options: KeptOptions = {}): Promise<void> {
  await countedExactly(s, reader.page, reader.requests, expected);
  nothingPrivate({ events: s.stack.events, lines: s.stack.lines, requests: reader.requests() }, secrets);
  await storedIsPublic(reader.page, secrets, options);
}

/**
 * The same end for a scenario with two tabs on one browser: what each tab
 * sent, in its own order, and what the Worker passed on for both together.
 */
export async function endsTwo(s: Scenario, tabs: readonly { reader: Reader; expected: EventBody[] }[], secrets: Secrets, options: KeptOptions = {}): Promise<void> {
  const lineOf = (event: EventBody): string => [event.name, event.path, event.value].filter((part) => part !== undefined).join(' ');
  for (const [index, tab] of tabs.entries()) {
    const sent = await sentBy(tab.reader.page, tab.reader.requests, tab.expected.length);
    assert.deepEqual(sent, tab.expected, `what tab ${index + 1} sent to be counted, in the order it sent it`);
  }
  const passedOn = await countedBy(s, ...tabs.map((tab) => tab.reader.page));
  assert.deepEqual(passedOn.map(lineOf).sort(), tabs.flatMap((tab) => tab.expected).map(lineOf).sort(), 'what the Worker passed on');
  const requests = tabs.flatMap((tab) => tab.reader.requests());
  nothingPrivate({ events: s.stack.events, lines: s.stack.lines, requests }, secrets);
  await storedIsPublic(tabs[0]!.reader.page, secrets, options);
}

/** True when the screen shows an element with this test hook. */
export const shows = async (page: OpenedPage, id: string): Promise<boolean> => (await countOf(page, id)) > 0;

// -- moving about -----------------------------------------------------------------------------------------------------

/** On the list of steps: follows the link of one step, inside the app, and waits for its parts. */
export async function pickStep(page: OpenedPage, id: StepId, prefix = ''): Promise<void> {
  await page.page.locator(`${hook('do-step-link')}[data-step="${id}"]`).click();
  await arrivesAt(page, `${prefix}/do/${id}`);
  await page.waitFor('step-parts');
}

/** What the list of steps says of one step: not-started, started or done. Null under a note it shows no states for. */
export const listState = (page: OpenedPage, id: StepId): Promise<string | null> =>
  page.page.evaluate(
    (selector) => document.querySelector(selector)?.getAttribute('data-state') ?? null,
    `li[data-step="${id}"] ${hook('do-state')}`,
  );

/**
 * One of the wallet's section links, from the top of the page: a reader
 * who was taken down the page (to the faucet's card, say) scrolls up to
 * them, and further down the sticky PRACTICE banner lies over them. Once
 * the bot check's script has been in the page the move is a page load.
 */
export async function section(page: OpenedPage, path: string, options: { load?: boolean } = {}): Promise<void> {
  await page.page.evaluate(() => window.scrollTo(0, 0));
  await toSection(page, path, options);
}
