// Backup and Settings: the 12 words on screen and off it again, the practice
// sheet on paper and its one card on screen, the wallet's facts and
// descriptors, Remove, what another tab can do to both screens, and a
// passkey wallet's lock and unlock.
//
// A wallet kept with its 12 words can be put in a page's storage before the
// app starts. A passkey wallet cannot (a virtual authenticator's secret
// cannot be set from outside), and the Create screen is another part's. So
// the passkey scenarios here make a passkey themselves and open its wallet
// through the gate's "Open with my passkey" (openPasskeyWallet below): the
// wallet engine, the unlock step and both screens are then the real ones.
// What still waits for scenarios that start at the Create screen is the
// "Wallet made" step, which only a create leads to.

import assert from 'node:assert/strict';
import { accountDescriptor } from '@learnbitcoin/practice-wallet';
import { RECORD_KEY } from '../../app/src/lib/keystore.ts';
import { siteHost } from '../../app/src/screens/keys/card-form.ts';
import { REMOVE_SETTLE_MS } from '../../app/src/screens/keys/taps.ts';
import { strings } from '../../app/src/strings/index.ts';
import { mainSays, named } from './doit-helpers.ts';
import { OTHER_WORDS, scenario, testRecord, type OpenedPage, type Scenario } from './helpers.ts';

const byTestId = (testid: string): string => `[data-testid="${testid}"]`;

/** True when an element with this test hook is in the page. */
const has = async (page: OpenedPage, testid: string): Promise<boolean> => (await page.page.$(byTestId(testid))) !== null;

/** Waits until the Remove question takes an answer: it takes none in the first moment after it opens. */
const untilAnswersCount = (): Promise<void> => new Promise((wake) => setTimeout(wake, REMOVE_SETTLE_MS + 150));

// Presses that must fall within the first moment after the Remove question opens are made inside the
// page, one after the other, with two frames between them for the page to draw what the last press set
// going. Made one by one from the scenario, they would depend on the machine: on a busy one the
// scenario's own trips to the page and back can take longer than that moment, and the press would count.

/**
 * True when the element with this test hook is whole on the screen and
 * nothing lies over it: its top and bottom edges are inside the window, and
 * a tap on either would reach it (not the sticky banner, say).
 */
const wholeOnScreen = (page: OpenedPage, testid: string): Promise<boolean> =>
  page.page.$eval(byTestId(testid), (element) => {
    const box = element.getBoundingClientRect();
    const middle = box.left + box.width / 2;
    const reached = (y: number): boolean => element.contains(document.elementFromPoint(middle, y));
    return box.top >= 0 && box.bottom <= window.innerHeight && reached(box.top + 2) && reached(box.bottom - 2);
  });

/** How many times the page's main part says "(passkey)", the English word a Spanish screen adds once. */
const glosses = (page: OpenedPage, within = 'main'): Promise<number> =>
  page.page.$eval(within, (element) => (element as HTMLElement).innerText.split('(passkey)').length - 1);

/**
 * Puts a passkey wallet in the page, on the real wallet engine. The page
 * must have been opened on a wallet route with `passkey: 'prf'` and nothing
 * stored, so that the gate stands there. The scenario makes a passkey as the
 * app's own Create would (kept by the device, with the secret a wallet is
 * made from, the reader verified), and the gate's "Open with my passkey"
 * then adopts its wallet: unlocked, and still empty.
 */
async function openPasskeyWallet(page: OpenedPage): Promise<{ tag: string; fingerprint: string; credentialId: string }> {
  // Chrome makes no passkey for a page that is not in front.
  await page.page.bringToFront();
  await page.waitFor('open-passkey');
  await page.page.evaluate(async () => {
    await navigator.credentials.create({
      publicKey: {
        rp: { id: location.hostname, name: 'scenario' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'a practice passkey', displayName: 'a practice passkey' },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        attestation: 'none',
        extensions: { prf: {} },
      },
    });
  });
  await page.click('open-passkey');
  await page.waitFor('lock');
  const stored = JSON.parse((await page.stored())!) as { kind: string; tag: string; fingerprint: string; credentialId: string; mnemonic?: string };
  assert.equal(stored.kind, 'passkey');
  assert.equal(stored.mnemonic, undefined, 'a passkey wallet stores no words');
  return stored;
}

/**
 * Matches three of the 12 words standing next to each other, with or without
 * space between them. A leak of the words holds them in a row. One word alone
 * proves nothing: the wallet's words are random, and "wallet", "page", "key"
 * and "print" are all on the word list and on these screens.
 */
const inARow = (words: string[]): RegExp =>
  new RegExp(words.slice(0, -2).map((word, i) => `${word}\\s*${words[i + 1]}\\s*${words[i + 2]}`).join('|'));

/** The lock line of a passkey wallet, as the wallet frame words it. */
const LOCKED = /^Looking and receiving need no passkey\./;

/** The text of the screen's heading. */
const heading = (page: OpenedPage): Promise<string> =>
  page.page.$eval('main h1', (h1) => (h1.textContent ?? '').trim());

/** What a reader sees of the page: its text as drawn, without what is hidden. */
const seenText = (page: OpenedPage): Promise<string> => page.page.evaluate(() => document.body.innerText);

/** The test hook of the element that has keyboard focus, or its tag when it has none. */
const focused = (page: OpenedPage): Promise<string> =>
  page.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? '');

/**
 * What the last regular expression that matched in the page ran on. A
 * pattern keeps that text where every script in the page can read it, so
 * the 12 words must never be found there.
 *
 * What this can and cannot see: it reads the one text the page's latest
 * match ran on, at the moment it is asked. The page matches other texts all
 * the time (its own title, for one), so a pattern run over the words inside
 * a screen would be overwritten before a scenario could look. The rule that
 * no pattern meets the words in these screens is held by the source test in
 * app/test/keys-text.test.ts. Here it is a check on the moment only: nothing
 * has left the words lying there when the scenario looks.
 */
const lastMatched = (page: OpenedPage): Promise<string> => page.page.evaluate(() => String(RegExp.input));

/** A click on one of the wallet's section links: a move inside the app, with no page load. */
async function toSection(page: OpenedPage, path: string): Promise<void> {
  await page.page.locator(`main nav a[href="${path}"]`).click();
}

/** The events of one name that reached the Worker, once the page and the Worker have gone quiet. */
async function counted(s: Scenario, page: OpenedPage, name: string): Promise<unknown[]> {
  await page.settle();
  await s.stack.settled();
  return s.stack.events.map((recorded) => recorded.event).filter((event) => event.name === name);
}

// -- the practice sheet ------------------------------------------------------------------

/** A length the page gives in CSS pixels, in points: 96 pixels and 72 points make an inch. */
const points = (px: number): number => px * 0.75;

/** The numbers of a card's rows: "1" to "12". */
const ROW_NUMBERS = Array.from({ length: 12 }, (_, index) => String(index + 1));

/** A box as the page measures it, in CSS pixels. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** One card of the practice sheet, as it is drawn at the moment it is looked at. */
interface DrawnCard {
  /** Its text as a reader would see it, with runs of white space as one space. */
  text: string;
  box: Box;
  /** The title, and the PRACTICE stamp that follows it. */
  title: Box;
  stamp: Box;
  /** The picture that holds the rows. */
  picture: Box;
  rows: {
    number: string;
    top: number;
    /** The circle, in the picture's own units (points): its width and height. */
    circle: { width: number; height: number };
    /** The middle of the box's outline, in the picture's own units. */
    outline: { left: number; right: number; height: number };
    /** Where the dashed lines stand, in the picture's own units. */
    lines: number[];
  }[];
  /** The corners that have a pair of crop marks drawn, each pair's box. */
  marks: Box[];
  restores: string;
}

/** What is drawn of the practice sheet, and of the rest of the screen, at the moment it is looked at. */
interface DrawnSheet {
  sheet: Box;
  /** The sheet's heading, when it is drawn: its text, and how many pictures it holds. */
  heading: { text: string; pictures: number }[];
  cards: DrawnCard[];
  /** How many of the 12 words are drawn, and how many the page holds. */
  words: number;
  wordsInPage: number;
  /** The rest of the screen: the banner, the header, the headings, the section links, every button and link, the footer. */
  around: number;
  /** Everything a reader would see, with runs of white space as one space. */
  text: string;
  /** What the sheet says to a screen reader: "true" when it is hidden from one. */
  hidden: string | null;
}

/** A text as a reader would see it: runs of white space as one space, and none at its ends. */
const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Looks at the practice sheet as the page draws it right now, on screen or
 * (under print media) on paper. The page hands its texts over as they are,
 * and they are tidied here: a pattern run inside the page would leave the
 * text it ran on, which can hold the 12 words, where the page's scripts can
 * read it (lastMatched above).
 */
async function drawnSheet(page: OpenedPage): Promise<DrawnSheet> {
  const seen = await page.page.evaluate(() => {
    const drawn = (selector: string, within: ParentNode = document): Element[] =>
      [...within.querySelectorAll(selector)].filter((element) => element.getClientRects().length > 0);
    const said = (element: Element): string => (element as HTMLElement).innerText;
    const box = (element: Element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    const sheet = document.querySelector('[data-testid="practice-sheet"]')!;
    return {
      sheet: box(sheet),
      heading: drawn('[data-testid="sheet-heading"]').map((heading) => ({ text: said(heading), pictures: drawn('img', heading).length })),
      cards: drawn('[data-testid="practice-card"]').map((card) => {
        const title = card.querySelector('p')!;
        const picture = card.querySelector('[data-testid="card-row"]')!.closest('svg')!;
        return {
          text: said(card),
          box: box(card),
          title: box(title),
          stamp: box(title.nextElementSibling!),
          picture: box(picture),
          rows: drawn('[data-testid="card-row"]', card).map((row) => {
            const circle = row.querySelector('circle')!.getBBox();
            const outline = (row.querySelector('[data-testid="card-box"]') as SVGRectElement).getBBox();
            return {
              number: row.querySelector('text')?.textContent ?? '',
              top: row.getBoundingClientRect().top,
              circle: { width: circle.width, height: circle.height },
              outline: { left: outline.x, right: outline.x + outline.width, height: outline.height },
              lines: drawn('[data-testid="card-cell-line"]', row).map((line) => (line as SVGLineElement).getBBox().x),
            };
          }),
          // The marks are drawn in the card's place on the sheet, around the card.
          marks: drawn('[data-testid="crop-mark"]', card.parentElement!).map(box),
          restores: said(card.querySelector('[data-testid="card-restores"]')!),
        };
      }),
      words: drawn('[data-testid="word"]').length,
      wordsInPage: document.querySelectorAll('[data-testid="word"]').length,
      around: drawn('[role="note"], header, main h1, main h2, main nav, main button, main a, footer').length,
      text: document.body.innerText,
      hidden: sheet.getAttribute('aria-hidden'),
    };
  });
  return {
    ...seen,
    heading: seen.heading.map((heading) => ({ ...heading, text: tidy(heading.text) })),
    cards: seen.cards.map((card) => ({
      ...card,
      text: tidy(card.text),
      restores: tidy(card.restores),
      rows: card.rows.map((row) => ({ ...row, number: tidy(row.number) })),
    })),
    text: tidy(seen.text),
  };
}

/** The same look under print media: what a sheet of paper would carry. */
async function onPaper(page: OpenedPage): Promise<DrawnSheet> {
  await page.page.emulateMediaType('print');
  try {
    return await drawnSheet(page);
  } finally {
    await page.page.emulateMediaType();
  }
}

/**
 * Two lengths that are the same, to a twentieth of a point (or of a pixel).
 * The page keeps a place to 1/64 of a pixel, and a place that is a sum of
 * a few lengths can be a few of those off.
 */
const same = (a: number, b: number): boolean => Math.abs(a - b) < 0.05;

/** On screen the card is drawn a third larger than it prints (PracticeCard.svelte says why). */
const ON_SCREEN = 1.3333;

/**
 * Holds one card to the form: twelve rows numbered 1 to 12, each under the
 * one before; in every row a circle, and a box that seven dashed lines part
 * into eight cells of the same width; the card's own width, in points.
 * `scale` is how much larger than on paper the card is drawn: 1 on paper.
 */
function assertIsTheForm(card: DrawnCard, what: string, scale = 1): void {
  /** A length of the page, as the points it is on paper. */
  const real = (px: number): number => points(px) / scale;
  // The form's card is 148 points wide, and the rows fill it between its two margins of 8 points.
  assert.ok(same(real(card.box.width), 148), `${what}: ${real(card.box.width)} points wide`);
  assert.ok(same(real(card.picture.left - card.box.left), 8), `${what}: the rows start 8 points in`);
  assert.ok(same(real(card.picture.width), 131.59) && same(real(card.picture.height), 220), `${what}: the rows' picture`);
  assert.deepEqual(card.rows.map((row) => row.number), ROW_NUMBERS, what);
  card.rows.forEach((row, index) => {
    const where = `${what}, row ${index + 1}`;
    if (index > 0) assert.ok(row.top > card.rows[index - 1]!.top, `${where} stands under the row before it`);
    assert.ok(same(row.circle.width, 14) && same(row.circle.height, 14), `${where}: the circle is 14 points across`);
    // Seven lines and the box's two ends: eight cells, each 14 points wide. (The outline is measured on
    // its middle, a third of a point inside the box's edge.)
    assert.equal(row.lines.length, 7, where);
    const edges = [row.outline.left, ...row.lines, row.outline.right];
    const cells = edges.slice(1).map((edge, i) => edge - edges[i]!);
    assert.equal(cells.length, 8, where);
    for (const [i, width] of cells.entries()) {
      const outer = i === 0 || i === cells.length - 1;
      assert.ok(Math.abs(width - (outer ? 14 - 0.325 : 14)) < 0.01, `${where}: cell ${i + 1} is ${width} wide`);
    }
    assert.ok(same(row.outline.height, 14 - 0.65), where);
  });
  // From row to row 18 points, and 26 from row 6 to row 7.
  const steps = card.rows.slice(1).map((row, i) => Math.round(real(row.top - card.rows[i]!.top) * 10) / 10);
  assert.deepEqual(steps, [18, 18, 18, 18, 18, 26, 18, 18, 18, 18, 18], what);
}

scenario('Backup: the 12 words show only when asked for, are the stored wallet\'s, and leave the screen again', async (s) => {
  const record = testRecord();
  const words = record.mnemonic!.split(' ');
  // A passkey provider is there and stays unused: a wallet made without a passkey never asks for one.
  const page = await s.open('/wallet/backup', { record, width: 375, passkey: 'prf' });

  // Before anything is asked: no word on the page, and the reader is told why this page is the exception.
  await page.waitFor('reveal-words');
  assert.equal(await heading(page), 'Backup');
  assert.deepEqual(await page.texts('word'), []);
  assert.doesNotMatch(await seenText(page), /abandon/);
  // The whole paragraph, and the link under it. Both name the keys chapter by the number the app's table of
  // chapters gives (doit-helpers.ts, named), with no slot left on screen.
  assert.ok((await page.text('backup-exception')).startsWith(named(strings.backup.en.exception)));
  assert.doesNotMatch(await page.text('backup-exception'), /[{}]/);
  assert.equal(
    await page.page.$eval(`${byTestId('backup-exception')} a`, (link) => (link.textContent ?? '').replace(/\s+/g, ' ').trim()),
    `${named(strings.backup.en.chapterLink)} ${strings.common.en.opensNewTab}`,
  );
  assert.match(await page.text('spoken-aloud'), /A screen reader will read the 12 words aloud/);
  // That warning is for a screen reader alone: it is in the page and is not drawn. It takes up a single point.
  assert.deepEqual(
    await page.page.$eval(byTestId('spoken-aloud'), (line) => {
      const box = line.getBoundingClientRect();
      return [Math.round(box.width), Math.round(box.height)];
    }),
    [1, 1],
  );
  // Tab passes over that warning, so the button carries it as its description: a screen reader says it
  // when the button takes focus.
  assert.match(
    await page.page.$eval(byTestId('reveal-words'), (button) => document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ?? ''),
    /^A screen reader will read the 12 words aloud\./,
  );
  // The second click of a double tap never shows the words: its first click may have been on "Hide them".
  await page.page.$eval(byTestId('reveal-words'), (button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })));
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await heading(page), 'Backup');
  // No lock line: this wallet was made without a passkey.
  assert.equal(await page.page.$(byTestId('lock-state')), null);

  // Asked for, they are the words in the stored record, in order.
  await page.click('reveal-words');
  await page.waitFor('word');
  assert.deepEqual(await page.texts('word'), words);
  assert.deepEqual(await page.texts('word'), (JSON.parse((await page.stored())!) as { mnemonic: string }).mnemonic.split(' '));
  // What to do with the words stands under "Hide them", and the sentence on the rehearsal straight after it.
  assert.equal(await page.text('write-down'), strings.backup.en.writeDown);
  assert.ok(
    (await page.page.$eval(byTestId('hide-words'), (button) => button.getBoundingClientRect().bottom)) <=
      (await page.page.$eval(byTestId('write-down'), (line) => line.getBoundingClientRect().top)),
    'the sentence on what to do with the words stands under the row of "Hide them"',
  );
  assert.ok((await seenText(page)).replace(/\s+/g, ' ').includes(`${strings.backup.en.writeDown} ${strings.backup.en.after}`));
  // The step swapped in place: its heading says so and has the focus.
  assert.equal(await heading(page), 'Your 12 words');
  assert.equal(await focused(page), 'H1');
  assert.match(await page.text('never-real-money'), /Never put real money on these 12 words/);
  // On a phone's width the words and everything around them fit the screen.
  assert.equal(await page.sidewaysScroll(), 0);
  // The PRACTICE stamp stands right above the words, so a picture of them carries the marker.
  assert.equal(
    await page.page.$eval(byTestId('word'), (item) => (item.closest('[data-print="never"]')?.previousElementSibling?.textContent ?? '').trim()),
    'Practice',
  );
  // Under the words, the card to write them on: the main site's backup form, with its rows numbered
  // 1 to 12 down the card, one row to a word, eight letter cells to a row. One card shows on screen.
  const below = await drawnSheet(page);
  assert.equal(below.cards.length, 1);
  assertIsTheForm(below.cards[0]!, 'the card on screen', ON_SCREEN);
  assert.ok(below.cards[0]!.box.top > (await page.page.$eval(byTestId('hide-words'), (button) => button.getBoundingClientRect().bottom)));

  // The list as SPEC section 12 wants it: ordered, English, not to be translated, corrected, completed or kept.
  const list = await page.page.$eval(byTestId('word'), (item) => {
    const ol = item.parentElement!;
    const attribute = (name: string) => ol.getAttribute(name);
    return {
      tag: ol.tagName,
      items: ol.children.length,
      lang: attribute('lang'),
      translate: attribute('translate'),
      spellcheck: attribute('spellcheck'),
      autocomplete: attribute('autocomplete'),
      autocorrect: attribute('autocorrect'),
      autocapitalize: attribute('autocapitalize'),
      named: ol.hasAttribute('name') || item.hasAttribute('name'),
      inForm: ol.closest('form') !== null,
      // No control to copy or download the words, in the list or beside it.
      controls: document.querySelectorAll('[data-print="never"] button, [data-print="never"] a, main [download], main [data-testid^="copy"]').length,
    };
  });
  assert.deepEqual(list, {
    tag: 'OL',
    items: 12,
    lang: 'en',
    translate: 'no',
    spellcheck: 'false',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'none',
    named: false,
    inForm: false,
    controls: 0,
  });
  assert.doesNotMatch(await lastMatched(page), /abandon|about/);

  // The second click of a double tap does not hide them again: its first click was on "Show the 12 words".
  await page.page.$eval(byTestId('hide-words'), (button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })));
  assert.deepEqual(await page.texts('word'), words);

  // "Hide them" takes them off the page, not just out of sight.
  await page.click('hide-words');
  await page.waitForGone('word');
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await heading(page), 'Backup');
  assert.equal(await focused(page), 'H1');
  assert.doesNotMatch(await page.page.evaluate(() => document.body.textContent ?? ''), /abandon/);

  // From the keyboard, and a second time: the same words.
  await page.page.focus(byTestId('reveal-words'));
  await page.page.keyboard.press('Enter');
  await page.waitFor('word');
  assert.deepEqual(await page.texts('word'), words);

  // Leaving the screen drops them: back on Backup, nothing is shown until it is asked for again.
  await toSection(page, '/wallet/settings');
  await page.waitFor('wallet-fingerprint');
  assert.deepEqual(await page.texts('word'), []);
  assert.doesNotMatch(await page.page.evaluate(() => document.body.textContent ?? ''), /abandon/);
  await toSection(page, '/wallet/backup');
  await page.waitFor('reveal-words');
  assert.deepEqual(await page.texts('word'), []);
  assert.doesNotMatch(await lastMatched(page), /abandon|about/);

  // Shown twice, counted once: the event says which kind of wallet, and nothing else.
  assert.deepEqual(await counted(s, page, 'Words shown'), [{ name: 'Words shown', path: '/wallet/backup', value: 'words' }]);
  // Nothing was announced (the words are never spoken by the page itself), nothing was stored or changed,
  // and the passkey provider was never asked.
  assert.deepEqual(page.statusLog(), []);
  assert.equal(await page.stored(), JSON.stringify(record));
  assert.deepEqual(await page.passkey!.credentials(), []);
});

/** The papers the sheet has to fit, each with its width in points. */
const PAPERS = [
  { format: 'Letter', width: 8.5 * 72 },
  { format: 'A4', width: (210 / 25.4) * 72 },
] as const;
/** Half an inch on every side: Firefox's margin when the reader changes nothing. Chrome's default for a PDF is 1 cm, which is less. */
const HALF_INCH = { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' } as const;

/** How many pages a PDF has. */
const pagesOf = (pdf: Uint8Array): number => Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;

/**
 * Holds what print media draws to the sheet: the sheet alone, with its
 * heading and three cards side by side in real sizes, every card the form
 * with the stamp and the "restores" line, each inside its crop marks, and
 * not one of the 12 words. `expected` is the sheet's text in the page's
 * language.
 */
function assertSheetOnPaper(paper: DrawnSheet, expected: { heading: string; card: string; restores: string }, wordsInPage: number): void {
  // The sheet and nothing else: no word, and nothing of the screen around it.
  assert.deepEqual([paper.cards.length, paper.heading.length, paper.words, paper.wordsInPage, paper.around], [3, 1, 0, wordsInPage, 0]);
  // The heading: the logo (its mark and its name, two picture files), the stamp, the site's name, the
  // title, and the short form of the exception paragraph.
  assert.equal(paper.heading[0]!.text, expected.heading);
  assert.equal(paper.heading[0]!.pictures, 2);
  // Three cards, each the same: the title, the stamp, the two warnings, the twelve numbers, the line
  // that says where the words restore, and the site's name.
  for (const [index, card] of paper.cards.entries()) {
    const what = `card ${index + 1} on paper`;
    assert.equal(card.text, expected.card, what);
    assert.equal(card.restores, expected.restores, what);
    assertIsTheForm(card, what);
    assert.ok(same(card.box.height, paper.cards[0]!.box.height), `${what} is as tall as the first`);
  }
  assert.equal(paper.text, [expected.heading, expected.card, expected.card, expected.card].join(' '));

  // Side by side, on one line, with the gap the crop marks need: 22 points between two cards, and 16
  // points of room at the sheet's two ends.
  const [first, second, third] = paper.cards.map((card) => card.box) as [Box, Box, Box];
  assert.ok(same(first.top, second.top) && same(second.top, third.top), 'the three cards stand on one line');
  assert.ok(same(points(second.left - first.right), 22) && same(points(third.left - second.right), 22), 'the gaps between the cards');
  assert.ok(same(points(first.left - paper.sheet.left), 16) && same(points(paper.sheet.right - third.right), 16), "the room at the sheet's ends");
  // The sheet is 520 points wide: it fits the narrower paper, A4, inside half-inch margins.
  assert.ok(same(points(paper.sheet.width), 520));
  for (const { format, width } of PAPERS) assert.ok(points(paper.sheet.width) <= width - 72, format);

  // Crop marks at the four corners of every card: each pair reaches 16 points out from its corner, along
  // both edges, and stops 4 points short of it. (A hairline is a quarter of a point wide; the page
  // measures a pair with its lines' width, so a third of a point either way is still the corner.)
  for (const [index, card] of paper.cards.entries()) {
    assert.equal(card.marks.length, 4, `card ${index + 1}`);
    /** Two places of the page that are a third of a point apart at most. */
    const near = (a: number, b: number): boolean => Math.abs(points(a - b)) < 0.34;
    const [topLeft, topRight, bottomLeft, bottomRight] = card.marks as [Box, Box, Box, Box];
    assert.ok(near(topLeft.right, card.box.left) && near(topLeft.bottom, card.box.top), `card ${index + 1}: top left`);
    assert.ok(near(topRight.left, card.box.right) && near(topRight.bottom, card.box.top), `card ${index + 1}: top right`);
    assert.ok(near(bottomLeft.right, card.box.left) && near(bottomLeft.top, card.box.bottom), `card ${index + 1}: bottom left`);
    assert.ok(near(bottomRight.left, card.box.right) && near(bottomRight.top, card.box.bottom), `card ${index + 1}: bottom right`);
    for (const mark of card.marks) {
      assert.ok(Math.abs(points(mark.width) - 16) < 0.34 && Math.abs(points(mark.height) - 16) < 0.34, `card ${index + 1}: a pair reaches 16 points`);
    }
  }
}

scenario('Backup: on paper the practice sheet shows alone, three cards under its heading, and no word does, shown or not', async (s) => {
  const page = await s.open('/wallet/backup', { record: testRecord(), width: 1280 });
  await page.waitFor('practice-card');
  const site = siteHost(s.stack.config.siteUrl);
  assert.equal(site, 'learnbitcoin.com');

  // The form's own words, and the two things a practice card adds: the stamp and the last line.
  const expected = {
    // The short form of the exception paragraph, as the table has it.
    heading: `PRACTICE ${site} Recovery Seed Phrases ${strings.wallet.en.wordsException}`,
    card: `Recovery Seed Phrases PRACTICE Don't make digital copies Never share with anyone ${ROW_NUMBERS.join(' ')} Restores only on the practice network. ${site}`,
    restores: 'Restores only on the practice network.',
  };

  // With the words hidden.
  const hidden = await onPaper(page);
  assertSheetOnPaper(hidden, expected, 0);
  // In English the stamp fits on the title's line: it stands at the title's right, level with it.
  for (const card of hidden.cards) {
    assert.ok(card.stamp.left > card.title.right, 'the stamp stands at the right of the title');
    assert.ok(card.stamp.top >= card.title.top && card.stamp.bottom <= card.title.bottom, "the stamp is on the title's line");
    assert.ok(same(points(card.stamp.right - card.box.left), 148 - 8), "the stamp ends at the card's right margin");
  }

  // With the words on screen: twelve in the page, none on paper, and the same sheet to the point.
  await page.click('reveal-words');
  await page.waitFor('word');
  const shown = await onPaper(page);
  assertSheetOnPaper(shown, expected, 12);
  assert.doesNotMatch(shown.text, /abandon/);
  assert.deepEqual(shown.cards.map((card) => [card.box.width, card.box.height]), hidden.cards.map((card) => [card.box.width, card.box.height]));
  // Back on screen they are still there: only paper leaves them out.
  assert.equal((await page.texts('word')).length, 12);

  // The sheet itself, as Chrome prints it: one page, on US Letter and on A4, inside half-inch margins
  // and with none at all.
  for (const { format } of PAPERS) {
    assert.equal(pagesOf(await page.page.pdf({ format, margin: HALF_INCH })), 1, `${format}, half-inch margins`);
    assert.equal(pagesOf(await page.page.pdf({ format })), 1, `${format}, no margins`);
  }

  // "Print the sheet" asks the browser to print, once: also for a double click, which is two clicks.
  await page.page.evaluate(() => {
    const counter = window as unknown as { printed: number };
    counter.printed = 0;
    window.print = () => {
      counter.printed += 1;
    };
  });
  assert.equal(await page.text('print-card'), 'Print the sheet');
  await page.click('print-card');
  assert.equal(await page.page.evaluate(() => (window as unknown as { printed: number }).printed), 1);
  await page.page.click(byTestId('print-card'), { count: 2 });
  assert.equal(await page.page.evaluate(() => (window as unknown as { printed: number }).printed), 2);
});

scenario('Backup in Spanish: on paper the sheet is the same form in the site\'s Spanish terms, with the stamp under the longer title', async (s) => {
  const page = await s.open('/es/wallet/backup', { record: testRecord(), lang: 'es', width: 1280 });
  await page.waitFor('practice-card');
  const site = siteHost(s.stack.config.siteUrl);

  await page.click('reveal-words');
  await page.waitFor('word');
  const paper = await onPaper(page);
  assertSheetOnPaper(
    paper,
    {
      heading: `PRÁCTICA ${site} Frases semilla de recuperación ${strings.wallet.es.wordsException}`,
      card: `Frases semilla de recuperación PRÁCTICA No hagas copias digitales No las compartas con nadie ${ROW_NUMBERS.join(' ')} Solo se restaura en la red de práctica. ${site}`,
      restores: 'Solo se restaura en la red de práctica.',
    },
    12,
  );
  assert.doesNotMatch(paper.text, /abandon/);
  // The Spanish title is too long to share its line with the stamp: the stamp stands under it, at the left.
  for (const card of paper.cards) {
    assert.ok(card.stamp.top >= card.title.bottom, 'the stamp stands under the title');
    assert.ok(same(card.stamp.left, card.title.left), 'the stamp starts where the title does');
    assert.ok(card.title.height < card.stamp.height * 2, 'the title is on one line');
  }
  // The card is taller by the stamp's line, and the sheet is still one page on both papers.
  for (const { format } of PAPERS) assert.equal(pagesOf(await page.page.pdf({ format, margin: HALF_INCH })), 1, `${format}, half-inch margins`);
  assert.equal(await page.text('print-card'), 'Imprimir la hoja');
});

scenario('Backup on a phone 320 px wide: one card shows, as a picture of what prints, and nothing scrolls sideways', async (s) => {
  for (const lang of ['en', 'es'] as const) {
    const page = await s.open(lang === 'es' ? '/es/wallet/backup' : '/wallet/backup', { record: testRecord(), lang, width: 320 });
    await page.waitFor('practice-card');
    assert.equal(await page.sidewaysScroll(), 0, lang);

    const screen = await drawnSheet(page);
    // One card of the three, with no heading and no crop marks: those are for paper.
    assert.deepEqual([screen.cards.length, screen.heading.length, screen.cards[0]!.marks.length], [1, 0, 0], lang);
    assert.equal(await page.page.$$eval(byTestId('practice-card'), (cards) => cards.length), 3, lang);
    // The card is the form, a third larger than it prints, and whole inside the screen.
    const card = screen.cards[0]!;
    assertIsTheForm(card, `the card on a phone (${lang})`, ON_SCREEN);
    assert.ok(card.box.left >= 0 && card.box.right <= 320, lang);
    // It is a picture: a screen reader is told nothing by it. The sentence above it says what the sheet
    // is, how many cards it prints, and that the words are never printed.
    assert.equal(screen.hidden, 'true', lang);
    const lead = await page.page.$eval(byTestId('practice-sheet'), (sheet) => (sheet.previousElementSibling?.textContent ?? '').trim());
    assert.match(
      lead,
      lang === 'en'
        ? /^This is LearnBitcoin's 12-word backup form, marked for practice\. The sheet prints 3 blank cards: .+ never printed, whether they are showing or not\.$/
        : /^Este es el formulario de respaldo de 12 palabras de LearnBitcoin, marcado para práctica\. La hoja imprime 3 tarjetas en blanco: .+ nunca se imprimen, se estén mostrando o no\.$/,
    );
    // The stamp: on the title's line in English, under the title in Spanish, whose title is longer.
    if (lang === 'en') {
      assert.ok(card.stamp.left > card.title.right && card.stamp.top >= card.title.top && card.stamp.bottom <= card.title.bottom);
    } else {
      assert.ok(card.stamp.top >= card.title.bottom && same(card.stamp.left, card.title.left));
    }
  }
});

scenario('Settings: the wallet fingerprint the record holds, and the descriptors the wallet package gives for it', async (s) => {
  const record = testRecord();
  const page = await s.open('/wallet/settings', { record, width: 375 });
  await page.waitFor('wallet-fingerprint');
  assert.equal(await heading(page), 'Settings');

  // The wallet in this browser: how this browser opens it, its wallet fingerprint, the day it has been
  // here since, its first address. Nothing about how it was made: the record does not know (a wallet
  // made with a passkey and restored from its 12 words is stored exactly like this one).
  assert.equal(await page.text('wallet-kind'), 'Opens without a passkey');
  assert.equal(await page.text('wallet-fingerprint'), record.fingerprint);
  assert.equal(await page.text('wallet-fingerprint'), '73c5da0a');
  assert.equal(await page.text('wallet-since'), 'November 1, 2026');
  assert.equal(await page.page.$eval(byTestId('wallet-since'), (value) => value.closest('div')?.querySelector('dt')?.textContent), 'In this browser since');
  assert.doesNotMatch(await page.page.$eval('main', (main) => (main as HTMLElement).innerText), /Made (on|with|without)\b|has no passkey/);
  assert.equal(await page.text('first-address'), record.firstAddress);
  assert.match(await seenText(page), /A wallet fingerprint is eight characters worked out from a wallet's keys\./);
  // No passkey, so no tag and no lock line.
  assert.equal(await page.page.$(byTestId('passkey-tag')), null);
  assert.equal(await page.page.$(byTestId('lock-state')), null);
  // A long address and two long descriptors, and the page still fits a phone's width.
  assert.equal(await page.sidewaysScroll(), 0);

  // What this browser keeps: the public key, and for this kind of wallet the 12 words.
  assert.match(await page.text('keeps-public'), /public key.+anyone who uses this browser can see the wallet\./);
  assert.equal(await page.text('keeps-words'), 'The 12 words, not encrypted. So anyone who uses this browser can also spend its coins.');
  assert.equal(await page.page.$(byTestId('keeps-no-words')), null);
  // On a later visit the browser is not asked again whether it keeps this page's data, so the screen does not say.
  assert.equal(await page.page.$(byTestId('keeps-persisted')), null);
  assert.equal(await page.page.$(byTestId('keeps-not-persisted')), null);
  assert.equal(await page.text('keeps-promise'), 'There is no account, and we set no cookies. The 12 words never leave this browser.');
  // The words themselves are nowhere on this screen.
  assert.doesNotMatch(await page.page.evaluate(() => document.body.textContent ?? ''), /abandon/);

  // The descriptors are the wallet package's own for this record, never translated, with a link to the Sparrow page.
  const receive = accountDescriptor(record.fingerprint, record.xpub, 0);
  const change = accountDescriptor(record.fingerprint, record.xpub, 1);
  assert.equal(await page.text('descriptor-receive'), receive);
  assert.equal(await page.text('descriptor-change'), change);
  assert.match(receive, /^wpkh\(\[73c5da0a\/84h\/1h\/0h\]tpub[0-9A-Za-z]+\/0\/\*\)#[0-9a-z]{8}$/);
  assert.equal(await page.page.$eval(byTestId('descriptor-receive'), (block) => block.getAttribute('translate')), 'no');
  // Each is shown whole: it wraps onto several lines inside the screen and nothing of it is cut off or
  // scrolled out of sight. The two differ only near their ends, which are therefore on screen too.
  for (const hook of ['descriptor-receive', 'descriptor-change']) {
    const shown = await page.page.$eval(byTestId(hook), (value) => {
      const box = value.getBoundingClientRect();
      const frame = value.parentElement!;
      return {
        lines: Math.round(box.height / Number.parseFloat(getComputedStyle(value).lineHeight)),
        inside: box.left >= 0 && box.right <= window.innerWidth,
        cut: frame.scrollWidth > frame.clientWidth || value.scrollWidth > value.clientWidth,
      };
    });
    assert.ok(shown.lines >= 3, `${hook} wraps: ${shown.lines} lines`);
    assert.deepEqual([shown.inside, shown.cut], [true, false], hook);
  }
  // The two copy buttons say which descriptor each one copies.
  assert.equal(await page.text('copy-descriptor-receive'), 'Copy receive descriptor');
  assert.equal(await page.text('copy-descriptor-change'), 'Copy change descriptor');
  assert.equal(await page.page.$eval('main a[href="/sparrow"]', (link) => (link.textContent ?? '').trim()), 'Practice network in Sparrow');

  // Copy: the whole descriptor is handed to the clipboard, and the status region says which one. The
  // clipboard here is a stand-in that keeps what it is given, so a run never touches the clipboard of the
  // machine it runs on.
  await page.page.evaluate(() => {
    const kept: string[] = [];
    (window as unknown as { copies: string[] }).copies = kept;
    navigator.clipboard.writeText = async (text: string) => {
      if (text.includes('/1/*)')) throw new DOMException('Write permission denied.', 'NotAllowedError');
      kept.push(text);
    };
  });
  await page.click('copy-descriptor-receive');
  assert.equal(await page.waitForStatus('copied'), 'Receive descriptor copied');
  assert.deepEqual(await page.page.evaluate(() => (window as unknown as { copies: string[] }).copies), [receive]);
  assert.equal(await page.text('copy-descriptor-receive'), 'Copied');
  assert.equal(await page.page.$(byTestId('copy-failed')), null);
  // A browser that refuses (here: for the change descriptor) is not passed over in silence.
  await page.click('copy-descriptor-change');
  assert.match(await page.waitForStatus('did not let the page copy'), /Select the text and copy it by hand\.$/);
  assert.match(await page.text('copy-failed'), /^This browser did not let the page copy\./);
  assert.deepEqual(await page.page.evaluate(() => (window as unknown as { copies: string[] }).copies), [receive]);

  // Looking needed no keys and changed nothing.
  assert.equal(await page.stored(), JSON.stringify(record));
  assert.deepEqual(await counted(s, page, 'Words shown'), []);
});

scenario('Remove asks first; "Keep it" keeps; "Remove it" deletes the wallet\'s key and nothing else, and goes Home', async (s) => {
  const record = testRecord();
  const others = { lb_progress_v1: '{"kept":"by another page"}', another_key: 'stays' };
  const page = await s.open('/wallet/settings', { record, storage: others, width: 375 });
  await page.waitFor('remove-wallet');
  // Why anyone would do this: it is the first half of the keys chapter's drill, named by the number the app's
  // table of chapters gives.
  assert.ok(await mainSays(page, named(strings.settings.en.removeDrill)), named(strings.settings.en.removeDrill));
  const keys = (): Promise<string[]> => page.page.evaluate(() => Object.keys(localStorage).sort());
  assert.deepEqual(await keys(), ['another_key', 'lb_progress_v1', 'lbp_wallet_v1']);

  // The button alone removes nothing: it opens a question. And an answer given in the moment the
  // question opens does not count, "Remove it" or "Keep it": nobody can have read the question yet.
  assert.equal(await page.page.$(byTestId('remove-confirm')), null);
  assert.equal(await page.page.$eval(byTestId('remove-wallet'), (button) => button.getAttribute('aria-expanded')), 'false');
  const early = await page.page.evaluate(async () => {
    const drawn = (): Promise<void> => new Promise((frame) => requestAnimationFrame(() => requestAnimationFrame(() => frame())));
    const press = (hook: string): void => document.querySelector<HTMLElement>(`[data-testid="${hook}"]`)?.click();
    const there = (hook: string): boolean => document.querySelector(`[data-testid="${hook}"]`) !== null;
    press('remove-wallet');
    await drawn();
    const opened = there('remove-confirm');
    press('remove-confirm');
    await drawn();
    const afterRemoveIt = there('remove-confirm');
    press('remove-keep');
    await drawn();
    return { opened, afterRemoveIt, afterKeepIt: there('remove-confirm'), path: location.pathname };
  });
  assert.deepEqual(early, { opened: true, afterRemoveIt: true, afterKeepIt: true, path: '/wallet/settings' });
  await page.waitFor('remove-confirm');
  assert.equal(await page.page.$eval(byTestId('remove-wallet'), (button) => button.getAttribute('aria-expanded')), 'true');
  assert.equal(await page.stored(), JSON.stringify(record));
  // The question is read out (it has the focus), and names what brings this wallet back: its 12 words,
  // or its passkey if it was made with one, which this browser cannot know of a wallet it keeps this way.
  assert.equal(await page.page.evaluate(() => document.activeElement?.textContent), 'Remove this wallet from this browser?');
  assert.equal(
    await page.text('remove-back'),
    'This erases the 12 words from this browser. The wallet comes back with its 12 words, or with its passkey if it was made with one. Without the words on paper and without a passkey, its practice coins are out of reach for good.',
  );
  assert.equal(await page.text('remove-confirm'), 'Remove it');
  assert.equal(await page.text('remove-keep'), 'Keep it');
  // Tab passes over that paragraph, so "Remove it" carries it as its description.
  assert.equal(
    await page.page.$eval(byTestId('remove-confirm'), (button) => document.getElementById(button.getAttribute('aria-describedby') ?? '')?.getAttribute('data-testid')),
    'remove-back',
  );

  // Once the question has stood for a moment its answers count.
  await untilAnswersCount();

  // From the keyboard: the link to the words, "Remove it", then "Keep it", which keeps the wallet.
  await page.page.keyboard.press('Tab');
  assert.equal(await page.page.evaluate(() => document.activeElement?.getAttribute('href')), '/wallet/backup');
  await page.page.keyboard.press('Tab');
  assert.equal(await focused(page), 'remove-confirm');
  await page.page.keyboard.press('Tab');
  assert.equal(await focused(page), 'remove-keep');
  await page.page.keyboard.press('Enter');
  await page.waitForGone('remove-confirm');
  assert.equal(await focused(page), 'remove-wallet');
  assert.equal(await page.stored(), JSON.stringify(record));
  assert.deepEqual(await keys(), ['another_key', 'lb_progress_v1', 'lbp_wallet_v1']);
  assert.deepEqual(await counted(s, page, 'Wallet removed'), []);

  // Asked again and answered "Remove it": the wallet's key is gone, the other keys are as they were.
  await page.page.evaluate(() => {
    (window as unknown as { samePage: boolean }).samePage = true;
  });
  await page.click('remove-wallet');
  await page.waitFor('remove-confirm');
  await untilAnswersCount();
  await page.click('remove-confirm');
  await page.page.waitForFunction(() => location.pathname === '/');
  assert.equal(await page.stored(), null);
  assert.deepEqual(await keys(), ['another_key', 'lb_progress_v1']);
  assert.equal(await page.stored('lb_progress_v1'), others.lb_progress_v1);
  assert.equal(await page.stored('another_key'), others.another_key);
  // Home, reached inside the app: no page was loaded on the way.
  assert.equal(await page.page.evaluate(() => (window as unknown as { samePage?: boolean }).samePage), true);
  assert.equal(await page.page.title(), 'Practice wallet | LearnBitcoin');

  // Counted once, with the kind of wallet and nothing that says which wallet.
  assert.deepEqual(await counted(s, page, 'Wallet removed'), [{ name: 'Wallet removed', path: '/wallet/settings', value: 'words' }]);
  for (const { event } of s.stack.events) {
    assert.doesNotMatch(JSON.stringify(event), new RegExp(`${record.fingerprint}|${record.firstAddress}|tpub`));
  }

  // The wallet is out of this browser: a wallet screen now says so.
  await page.goto('/wallet/settings');
  assert.equal(await heading(page), 'This browser has no practice wallet.');
  assert.equal(await page.page.$(byTestId('remove-wallet')), null);
});

scenario('the Spanish routes: Backup and Settings in Spanish, with the 12 words still English', async (s) => {
  const record = testRecord();
  const page = await s.open('/es/wallet/backup', { record, lang: 'es', width: 375 });
  await page.waitFor('reveal-words');
  assert.equal(await page.page.evaluate(() => document.documentElement.lang), 'es');
  assert.equal(await heading(page), 'Respaldo');
  assert.equal(await page.page.title(), 'Práctica: Respaldo | LearnBitcoin');
  assert.equal(await page.text('reveal-words'), 'Mostrar las 12 palabras');
  assert.ok((await page.text('backup-exception')).startsWith(named(strings.backup.es.exception, 'es')));
  assert.doesNotMatch(await page.text('backup-exception'), /[{}]/);
  assert.equal(
    await page.page.$eval(`${byTestId('backup-exception')} a`, (link) => (link.textContent ?? '').replace(/\s+/g, ' ').trim()),
    `${named(strings.backup.es.chapterLink, 'es')} ${strings.common.es.opensNewTab}`,
  );
  assert.match(await page.text('spoken-aloud'), /Un lector de pantalla va a leer las 12 palabras en voz alta/);
  // The chapter the paragraph answers is linked in its Spanish edition.
  assert.equal(
    await page.page.$eval(`${byTestId('backup-exception')} a`, (link) => link.getAttribute('href')),
    `${s.stack.config.siteUrl}/es/recorrido/se-tu-propio-banco`,
  );

  // The words are English on purpose, the list says it is English, and the page says to copy them exactly.
  await page.click('reveal-words');
  await page.waitFor('word');
  assert.equal(await heading(page), 'Tus 12 palabras');
  assert.deepEqual(await page.texts('word'), record.mnemonic!.split(' '));
  assert.equal(await page.page.$eval(byTestId('word'), (item) => item.parentElement!.getAttribute('lang')), 'en');
  assert.match(await seenText(page), /Las 12 palabras están en inglés a propósito: salen de una lista fija\. Cópialas tal como están, sin traducirlas\./);
  assert.equal(await page.text('hide-words'), 'Ocultarlas');
  // The card, in Spanish: the form's words in the site's Spanish terms, with the marker's own Spanish
  // word, the twelve numbers, and the site's name at its foot.
  assert.equal(
    await page.text('practice-card'),
    `Frases semilla de recuperación Práctica No hagas copias digitales No las compartas con nadie ${ROW_NUMBERS.join('')} Solo se restaura en la red de práctica. ${siteHost(s.stack.config.siteUrl)}`,
  );
  assert.equal(await page.text('print-card'), 'Imprimir la hoja');

  // The section links stay in Spanish, and Settings follows.
  await toSection(page, '/es/wallet/settings');
  await page.waitFor('wallet-fingerprint');
  assert.equal(await heading(page), 'Configuración');
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await page.text('wallet-kind'), 'Se abre sin llave de acceso (passkey)');
  assert.equal(await page.text('wallet-fingerprint'), record.fingerprint);
  assert.equal(await page.text('wallet-since'), '1 de noviembre de 2026');
  assert.equal(await page.page.$eval(byTestId('wallet-since'), (value) => value.closest('div')?.querySelector('dt')?.textContent), 'En este navegador desde el');
  assert.match(await seenText(page), /La huella de la billetera son ocho caracteres/);
  // Descriptors are the same in every language.
  assert.equal(await page.text('descriptor-receive'), accountDescriptor(record.fingerprint, record.xpub, 0));
  assert.equal(await page.page.$eval('main a[href="/es/sparrow"]', (link) => (link.textContent ?? '').trim()), 'La red de práctica en Sparrow');

  // Remove asks in Spanish, and "Conservarla" keeps the wallet.
  await page.click('remove-wallet');
  await page.waitFor('remove-keep');
  assert.equal(await page.page.evaluate(() => document.activeElement?.textContent), '¿Quitar esta billetera de este navegador?');
  assert.match(await page.text('remove-back'), /La billetera vuelve con sus 12 palabras, o con su llave de acceso si se creó con una\./);
  assert.equal(await page.text('remove-confirm'), 'Quitarla');
  assert.equal(await page.text('remove-keep'), 'Conservarla');
  // The English word for a passkey stands once on the screen, at its first mention, with the question open too.
  assert.equal(await glosses(page), 1);
  assert.match(await page.text('wallet-kind'), /\(passkey\)$/);
  await untilAnswersCount();
  await page.click('remove-keep');
  await page.waitForGone('remove-keep');
  assert.equal(await page.stored(), JSON.stringify(record));

  // The language switch keeps the reader on the same screen, in English, with no page load.
  await page.click('lang-switch');
  await page.page.waitForFunction(() => location.pathname === '/wallet/settings');
  assert.equal(await heading(page), 'Settings');
  assert.equal(await page.text('wallet-since'), 'November 1, 2026');

  // What was counted is filed under the Spanish screens it happened on.
  assert.deepEqual(await counted(s, page, 'Words shown'), [{ name: 'Words shown', path: '/es/wallet/backup', value: 'words' }]);
  assert.deepEqual(await counted(s, page, 'Wallet removed'), []);
});

scenario('Remove on a phone: the question opens whole, with both answers on screen, and a double tap removes nothing', async (s) => {
  const record = testRecord();
  // A small phone. The button is brought to the foot of the screen, where the question has to open
  // below the fold: the place where it once came up with "Remove it" under the finger and "Keep it" cut off.
  const page = await s.open('/wallet/settings', { record, width: 375, height: 667 });
  await page.waitFor('remove-wallet');
  const point = await page.page.$eval(byTestId('remove-wallet'), (button) => {
    const before = button.getBoundingClientRect();
    window.scrollBy(0, before.bottom - (window.innerHeight - 16));
    const box = button.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, onScreen: box.top >= 0 && box.bottom <= window.innerHeight };
  });
  assert.equal(point.onScreen, true, 'the button stands at the foot of the screen');

  // Two taps at one point, with nothing between them but the page's own redrawing: the second lands on
  // whatever the opening question has put under the finger. (They are made inside the page, as above.)
  const taps = await page.page.evaluate(async ({ x, y }) => {
    const drawn = (): Promise<void> => new Promise((frame) => requestAnimationFrame(() => requestAnimationFrame(() => frame())));
    const under = (): HTMLElement | null => document.elementFromPoint(x, y)?.closest<HTMLElement>('button, a') ?? null;
    const first = under();
    first?.click();
    await drawn();
    const second = under();
    second?.click();
    await drawn();
    return { first: first?.getAttribute('data-testid') ?? null, second: second?.getAttribute('data-testid') ?? second?.tagName ?? null };
  }, point);
  assert.equal(taps.first, 'remove-wallet');
  await page.waitFor('remove-confirm');
  // The question has the focus, so it is read out.
  assert.equal(await page.page.evaluate(() => document.activeElement?.textContent), 'Remove this wallet from this browser?');

  // Nothing was removed, and the question still stands, whatever the second tap landed on.
  assert.equal(await page.stored(), JSON.stringify(record));
  assert.equal(await page.page.evaluate(() => location.pathname), '/wallet/settings');
  assert.equal(await has(page, 'remove-question'), true);
  assert.equal(await has(page, 'remove-gone'), false);
  // The whole question is on screen: what it asks, and both answers, each within reach. Taking the
  // focus did not carry it to the middle of the screen, or under the banner.
  assert.equal(await wholeOnScreen(page, 'remove-question'), true, 'the question');
  assert.equal(await wholeOnScreen(page, 'remove-confirm'), true, '"Remove it"');
  assert.equal(await wholeOnScreen(page, 'remove-keep'), true, '"Keep it"');

  // The same with a real double click (the browser counts it as one, and says so in the second click).
  await untilAnswersCount();
  await page.click('remove-keep');
  await page.waitForGone('remove-confirm');
  const again = await page.page.$eval(byTestId('remove-wallet'), (button) => {
    const before = button.getBoundingClientRect();
    window.scrollBy(0, before.bottom - (window.innerHeight - 16));
    const box = button.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await page.page.mouse.click(again.x, again.y, { count: 2 });
  await page.waitFor('remove-confirm');
  assert.equal(await page.stored(), JSON.stringify(record));
  assert.equal(await wholeOnScreen(page, 'remove-confirm'), true);
  assert.equal(await wholeOnScreen(page, 'remove-keep'), true);

  // Once the question has stood for a moment, "Remove it" removes.
  await untilAnswersCount();
  await page.click('remove-confirm');
  await page.page.waitForFunction(() => location.pathname === '/');
  assert.equal(await page.stored(), null);
});

scenario('Backup, two tabs: when another tab puts another wallet here, the words leave the screen and the page says why', async (s) => {
  const record = testRecord();
  const other = testRecord(OTHER_WORDS);
  const first = await s.open('/wallet/backup', { record, width: 375 });
  await first.click('reveal-words');
  await first.waitFor('word');
  assert.deepEqual(await first.texts('word'), record.mnemonic!.split(' '));

  // A second tab on the same storage replaces the wallet in one write.
  const second = await s.open('/wallet/settings', { context: first.context, width: 375 });
  await second.waitFor('wallet-fingerprint');
  await second.store(RECORD_KEY, JSON.stringify(other));
  // The reader comes back to the first tab. (A click waits for a tab that is in front.)
  await first.page.bringToFront();

  // In the first tab the words are gone from the page, not just out of sight, and the page says why:
  // on screen where the words were, and as an alert for a screen reader.
  await first.waitFor('words-withdrawn');
  assert.deepEqual(await first.texts('word'), []);
  assert.doesNotMatch(await first.page.evaluate(() => document.body.textContent ?? ''), /abandon/);
  assert.match(await first.text('words-withdrawn'), /^The wallet in this browser changed in another tab, so the 12 words were taken off the screen\./);
  assert.equal(await first.page.$eval(byTestId('words-withdrawn'), (notice) => notice.getAttribute('role')), 'alert');
  assert.equal(await heading(first), 'Backup');
  assert.equal(await focused(first), 'H1');
  // The words of the wallet that is here now are not shown unasked.
  assert.doesNotMatch(await first.page.evaluate(() => document.body.textContent ?? ''), /sausage/);

  // Asked again, the words are the new wallet's, and the notice has gone.
  await first.click('reveal-words');
  await first.waitFor('word');
  assert.deepEqual(await first.texts('word'), OTHER_WORDS.split(' '));
  assert.equal(await has(first, 'words-withdrawn'), false);
  assert.equal(await first.stored(), JSON.stringify(other));
});

scenario('Settings, two tabs: a Remove question that is open when another tab changes the wallet closes, and nothing is removed', async (s) => {
  const record = testRecord();
  const other = testRecord(OTHER_WORDS);
  const first = await s.open('/wallet/settings', { record, width: 375 });
  await first.click('remove-wallet');
  await first.waitFor('remove-confirm');
  assert.equal(await first.text('wallet-fingerprint'), record.fingerprint);

  const second = await s.open('/wallet/settings', { context: first.context, width: 375 });
  await second.waitFor('wallet-fingerprint');
  await second.store(RECORD_KEY, JSON.stringify(other));
  // The reader comes back to the first tab. (A click waits for a tab that is in front.)
  await first.page.bringToFront();

  // The reader said yes to nothing yet, and can no longer say yes to the wrong wallet.
  await first.waitFor('remove-gone');
  assert.equal(await has(first, 'remove-confirm'), false);
  assert.equal(await has(first, 'remove-question'), false);
  assert.match(await first.text('remove-gone'), /^The wallet in this browser changed in another tab while this page was open, so nothing was removed\./);
  assert.equal(await focused(first), 'remove-wallet');
  // The wallet the other tab put here is untouched, and it is the one this screen now shows.
  assert.equal(await first.stored(), JSON.stringify(other));
  assert.equal(await first.text('wallet-fingerprint'), other.fingerprint);
  assert.notEqual(other.fingerprint, record.fingerprint);
  assert.deepEqual(await counted(s, first, 'Wallet removed'), []);

  // Asked again, the question is about the wallet that is here, and "Remove it" removes that one.
  await first.click('remove-wallet');
  await first.waitFor('remove-confirm');
  assert.equal(await has(first, 'remove-gone'), false);
  await untilAnswersCount();
  await first.click('remove-confirm');
  await first.page.waitForFunction(() => location.pathname === '/');
  assert.equal(await first.stored(), null);
});

scenario('a passkey wallet: the words come only after the unlock step, Lock takes them off the screen, and Settings says what is kept', async (s) => {
  const page = await s.open('/wallet/backup', { width: 375, passkey: 'prf' });
  const wallet = await openPasskeyWallet(page);
  const uses = async (): Promise<number> => (await page.passkey!.credentials()).find((each) => each.id === wallet.credentialId)?.uses ?? -1;

  // Locked: looking needs no passkey, and no word is on the page.
  await page.click('lock');
  await page.page.waitForFunction((hook) => document.querySelector(hook)?.textContent?.startsWith('Looking and receiving'), {}, byTestId('lock-state'));
  assert.match(await page.text('lock-state'), LOCKED);
  await page.waitFor('reveal-words');
  assert.equal(await has(page, 'unlock-step'), false, 'the unlock step comes only when the words are asked for');
  const before = await uses();

  // Asked for, the words do not come: the unlock step does.
  await page.click('reveal-words');
  await page.waitFor('unlock-step');
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await uses(), before, 'no prompt yet');
  assert.match(await page.text('unlock-step'), /Showing the 12 words needs the keys of this wallet, and your passkey loads them\./);

  // One prompt, and the words are on screen under their own heading.
  await page.click('unlock');
  await page.waitFor('word');
  const words = await page.texts('word');
  assert.equal(words.length, 12);
  assert.equal(await uses(), before + 1, 'exactly one prompt');
  assert.equal(await heading(page), 'Your 12 words');
  assert.doesNotMatch((await page.stored())!, inARow(words), 'the words are not in storage');
  assert.doesNotMatch(await lastMatched(page), inARow(words));

  // Lock takes them off the page at once, and the next ask goes through the unlock step again.
  // (From the top of the page, as a reader would: where the page stands now, the sticky PRACTICE
  // banner lies over the Lock button, and a click there would land on the banner.)
  await page.page.evaluate(() => window.scrollTo(0, 0));
  await page.click('lock');
  await page.waitForGone('word');
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await heading(page), 'Backup');
  assert.match(await page.text('lock-state'), LOCKED);
  assert.equal(await has(page, 'words-withdrawn'), false, 'a lock is the reader\'s own doing: nothing to explain');
  assert.doesNotMatch(await page.page.evaluate(() => document.body.textContent ?? ''), inARow(words));
  assert.doesNotMatch(await lastMatched(page), inARow(words));
  await page.click('reveal-words');
  await page.waitFor('unlock-step');
  assert.deepEqual(await page.texts('word'), []);
  await page.click('unlock');
  await page.waitFor('word');
  assert.deepEqual(await page.texts('word'), words, 'the same passkey gives the same words');
  assert.equal(await uses(), before + 2);

  // Settings, with the wallet unlocked: how this browser opens it, the tag beside the wallet fingerprint,
  // and that the 12 words are not kept.
  await toSection(page, '/wallet/settings');
  await page.waitFor('wallet-fingerprint');
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await page.text('wallet-kind'), 'Opens with a passkey');
  assert.equal(await page.text('passkey-tag'), wallet.tag);
  assert.equal(await page.text('wallet-fingerprint'), wallet.fingerprint);
  assert.match(await page.text('keeps-no-words'), /^Not the 12 words\./);
  assert.equal(await has(page, 'keeps-words'), false);
  // Remove names the passkey and the 12 words, and promises no passkey.
  await page.click('remove-wallet');
  await page.waitFor('remove-confirm');
  assert.match(await page.text('remove-back'), /^This wallet can come back with its passkey, .+ A passkey can fail, so the 12 words are the sure way back\./);
  // In Spanish the English word for a passkey stands once in the screen's own text, at its first mention.
  await page.click('lang-switch');
  await page.page.waitForFunction(() => location.pathname === '/es/wallet/settings');
  assert.equal(await page.text('wallet-kind'), 'Se abre con llave de acceso (passkey)');
  assert.equal((await glosses(page)) - (await glosses(page, byTestId('lock-state'))), 1);
  await untilAnswersCount();
  await page.click('remove-keep');
  await page.waitForGone('remove-confirm');
  assert.equal(JSON.parse((await page.stored())!).fingerprint, wallet.fingerprint);

  // Shown twice, counted once, under the screen it happened on.
  assert.deepEqual(await counted(s, page, 'Words shown'), [{ name: 'Words shown', path: '/wallet/backup', value: 'passkey' }]);
});

scenario('a passkey wallet: a prompt answered after the language was switched shows the words asked for, and leaves no unlock step waiting for the next lock', async (s) => {
  const page = await s.open('/wallet/backup', { width: 375, passkey: 'prf' });
  await openPasskeyWallet(page);
  await page.click('lock');
  await page.waitFor('reveal-words');

  // The reader asks for the words, and while the passkey prompt is open switches the page to Spanish.
  // The prompt's answer is held back here, as a device holds it until the reader has confirmed.
  await page.page.evaluate(() => {
    const real = navigator.credentials.get.bind(navigator.credentials);
    let release = (): void => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    (window as unknown as { answerPrompt: () => void }).answerPrompt = release;
    navigator.credentials.get = async (options) => {
      const answer = await real(options);
      await held;
      return answer;
    };
  });
  await page.click('reveal-words');
  await page.waitFor('unlock-step');
  await page.click('unlock');
  await page.page.waitForFunction((hook) => document.querySelector(hook)?.getAttribute('aria-busy') === 'true', {}, byTestId('unlock'));
  await page.click('lang-switch');
  await page.page.waitForFunction(() => location.pathname === '/es/wallet/backup');
  await page.page.evaluate(() => (window as unknown as { answerPrompt: () => void }).answerPrompt());

  // The keys are loaded, and the same screen is showing, in the other language: the reader asked it for
  // the words, and gets them, with no second press. (The unlock step once took the new address for
  // another screen, and the reader had to ask again.)
  await page.waitFor('word');
  assert.equal(await has(page, 'unlock-step'), false);
  assert.equal(await has(page, 'lock'), true);
  assert.equal((await page.texts('word')).length, 12);
  assert.equal(await heading(page), 'Tus 12 palabras');
  assert.equal(await page.text('hide-words'), 'Ocultarlas');
  // The step changed in place: its heading has focus, as after any unlock.
  assert.equal(await focused(page), 'H1');

  // Lock: the words leave with the keys, and the screen asks. The unlock step must not come up by
  // itself, from a wish made before.
  await page.click('lock');
  await page.waitForGone('lock');
  await page.waitFor('reveal-words');
  assert.equal(await page.text('reveal-words'), 'Mostrar las 12 palabras');
  assert.equal(await has(page, 'unlock-step'), false, 'nobody asked for the words since the lock');
  assert.deepEqual(await page.texts('word'), []);

  // Asked for now, it does come, and the words follow the unlock.
  await page.click('reveal-words');
  await page.waitFor('unlock-step');
  await page.click('unlock');
  await page.waitFor('word');
  assert.equal((await page.texts('word')).length, 12);
  // The button that was pressed went with the step (this screen shows the step only for a locked
  // wallet), and focus with it: the heading takes it, and is not left on the page itself.
  await page.page.waitForFunction(() => document.activeElement?.tagName === 'H1');
});

scenario('a passkey wallet: a prompt answered after the reader left the screen and came back shows no words and counts none as shown', async (s) => {
  const page = await s.open('/wallet/backup', { width: 375, passkey: 'prf' });
  await openPasskeyWallet(page);
  await page.click('lock');
  await page.waitFor('reveal-words');

  // The reader asks for the words. The prompt's answer is held back, as a device holds it.
  await page.page.evaluate(() => {
    const real = navigator.credentials.get.bind(navigator.credentials);
    let release = (): void => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    (window as unknown as { answerPrompt: () => void }).answerPrompt = release;
    navigator.credentials.get = async (options) => {
      const answer = await real(options);
      await held;
      return answer;
    };
  });
  await page.click('reveal-words');
  await page.waitFor('unlock-step');
  await page.click('unlock');
  await page.page.waitForFunction((hook) => document.querySelector(hook)?.getAttribute('aria-busy') === 'true', {}, byTestId('unlock'));

  // With the prompt open: away to Send and back to Backup, by the wallet's own links. The address is
  // the one the reader asked at, but this is a new screen, and nobody has asked it for anything.
  await page.page.evaluate(() => document.querySelector<HTMLAnchorElement>('a[href="/wallet/send"]')!.click());
  await page.page.waitForFunction(() => location.pathname === '/wallet/send');
  await page.page.evaluate(() => document.querySelector<HTMLAnchorElement>('a[href="/wallet/backup"]')!.click());
  await page.page.waitForFunction(() => location.pathname === '/wallet/backup');
  await page.waitFor('reveal-words');
  assert.equal(await has(page, 'unlock-step'), false);
  await page.page.focus(byTestId('reveal-words'));

  // Now the prompt is approved. The keys are loaded, and that is all: the screen that asked is gone.
  await page.page.evaluate(() => (window as unknown as { answerPrompt: () => void }).answerPrompt());
  await page.waitFor('lock');
  await page.settle();
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await has(page, 'reveal-words'), true);
  assert.equal(await focused(page), 'reveal-words', 'focus stays where the reader is');
  // The old screen was not handed the words behind the reader's back: the wallet counted nothing as shown.
  assert.deepEqual(await counted(s, page, 'Words shown'), []);

  // Asked for now, the words come at once: the keys are there.
  await page.click('reveal-words');
  await page.waitFor('word');
  assert.deepEqual(await counted(s, page, 'Words shown'), [{ name: 'Words shown', path: '/wallet/backup', value: 'passkey' }]);
});
