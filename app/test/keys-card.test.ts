// The measures of the practice card (src/screens/keys/card-form.ts): the
// rows as the main site's 12-word backup form has them, the letter cells of
// a row, the picture that holds the rows, and the site's name at the card's
// foot. And two things the card's own file leans on: the sheet's width on
// paper, and the two picture files its logo is shown from.
//
// These are tests of plain numbers and of source text. Whether the card
// looks like the form, and what a browser puts on paper, is for the browser
// scenarios (e2e/scenarios/keys.test.ts) and for a pair of eyes.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ENGLISH_WORDS } from '@learnbitcoin/practice-wallet';
import { WORD_COUNT } from '../src/components/wallet/words.ts';
import { DEFAULT_CONFIG } from '../src/lib/config.ts';
import { BOX_LEFT, BOX_WIDTH, CELLS, COPIES, ROW, cellLines, formRows, rowsPicture, siteHost } from '../src/screens/keys/card-form.ts';

const card = readFileSync(new URL('../src/screens/keys/PracticeCard.svelte', import.meta.url), 'utf8');

// -- the rows ------------------------------------------------------------------------------

test('twelve rows, numbered 1 to 12 in order, each under the one before', () => {
  const rows = formRows(WORD_COUNT);
  assert.deepEqual(
    rows.map((row) => row.number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i]!.top > rows[i - 1]!.top, `row ${i + 1} is under row ${i}`);
});

test('the rows are 18 points apart, in two groups of six with 26 points from row 6 to row 7, as on the form', () => {
  const tops = formRows(WORD_COUNT).map((row) => row.top);
  assert.deepEqual(tops, [0, 18, 36, 54, 72, 90, 116, 134, 152, 170, 188, 206]);
  const steps = tops.slice(1).map((top, i) => top - tops[i]!);
  assert.deepEqual(steps, [18, 18, 18, 18, 18, 26, 18, 18, 18, 18, 18]);
  // A row is 14 points tall, so 4 points of paper lie between two rows and 12 between the groups.
  assert.equal(ROW.pitch - ROW.circle, 4);
  assert.equal(ROW.pitch + ROW.groupGap - ROW.circle, 12);
  // No rows, one row: nothing to space.
  assert.deepEqual(formRows(0), []);
  assert.deepEqual(formRows(1), [{ number: 1, top: 0 }]);
});

// -- the cells -----------------------------------------------------------------------------

test('a row has eight letter cells, and eight is the longest word on the BIP39 list', () => {
  assert.equal(ENGLISH_WORDS.length, 2048);
  const lengths = ENGLISH_WORDS.map((word) => word.length);
  // Every word fits its row, and no cell is one too many.
  assert.equal(Math.max(...lengths), CELLS);
  assert.equal(Math.min(...lengths), 3);
  assert.equal(CELLS, 8);
});

test('seven dashed lines part a box into eight cells of the same width', () => {
  const lines = cellLines();
  assert.equal(lines.length, CELLS - 1);
  const edges = [BOX_LEFT, ...lines, BOX_LEFT + BOX_WIDTH];
  const widths = edges.slice(1).map((edge, i) => Math.round((edge - edges[i]!) * 100) / 100);
  assert.deepEqual(widths, [14, 14, 14, 14, 14, 14, 14, 14]);
  // The box starts where the line from the circle ends, and a cell is as tall as it is wide.
  assert.equal(BOX_LEFT, 19.59);
  assert.equal(BOX_WIDTH, 112);
  assert.equal(ROW.cell, ROW.circle);
  // The lines are written to hundredths of a point, with no stray digits from the sums.
  for (const x of lines) assert.match(String(x), /^[0-9]+\.59$/);
});

test('the dashed lines end under the box\'s outline, half a dash at each end', () => {
  // A line is one cell tall and starts half a dash in: half a dash, then gaps and dashes in turn.
  const period = 2 * ROW.dash.length;
  assert.equal(ROW.cell % period, 0, 'a whole number of dash-and-gap pairs');
  // The half dash at each end is shorter than the outline is wide, so the outline covers it.
  assert.ok(ROW.dash.length / 2 < ROW.outline);
  assert.match(card, /stroke-dasharray=\{ROW\.dash\.length\}\s+stroke-dashoffset=\{ROW\.dash\.length \/ 2\}/);
});

// -- the picture of the rows ---------------------------------------------------------------

test('the picture of the rows is as wide as one row and as tall as all twelve with their steps', () => {
  assert.deepEqual(rowsPicture(WORD_COUNT), { width: 131.59, height: 220 });
  // It fits between the card's two margins: the card is 148 points wide, with 8 points at each side.
  assert.ok(rowsPicture(WORD_COUNT).width <= 148 - 2 * 8);
  assert.deepEqual(rowsPicture(1), { width: 131.59, height: 14 });
  assert.deepEqual(rowsPicture(0), { width: 131.59, height: 0 });
  // The card draws it with one unit to the point: the same numbers for the picture's units and its size on paper.
  assert.match(card, /<svg viewBox="0 0 \{PICTURE\.width\} \{PICTURE\.height\}" width="\{PICTURE\.width\}pt" height="\{PICTURE\.height\}pt"/);
});

// -- the sheet on paper --------------------------------------------------------------------

test('three cards, their gaps and their crop marks fit US Letter and A4 inside half-inch margins', () => {
  /** A length the card's file gives in points, found by the class that carries it. */
  const points = (pattern: RegExp): number => {
    const hit = card.match(pattern);
    assert.ok(hit?.[1], `${pattern} is not in the card's file`);
    return Number(hit[1]);
  };
  const cardWidth = points(/class="w-\[([0-9.]+)pt\] bg-white /);
  const sheetWidth = points(/print:w-\[([0-9.]+)pt\]/);
  // On paper a card stands in a place with room for its crop marks on every side. Two places overlap,
  // each by `lap` at each side, and the line of places is set in from the sheet's ends by as much.
  const room = points(/print:p-\[([0-9.]+)pt\]/);
  const lap = points(/print:-mx-\[([0-9.]+)pt\]/);
  assert.equal(points(/print:px-\[([0-9.]+)pt\]/), lap);
  assert.equal(cardWidth, 148, "the form's card");
  // The crop marks reach 16 points out from a card: 4 clear of its corner, and 12 long.
  assert.equal(room, 16);
  assert.match(card, /lines: 'M16 0v12M0 16h12'/);
  // The least there can be between two cards: enough for the marks of both to lie between them
  // without reaching into the other card.
  const least = 2 * room - 2 * lap;
  assert.equal(least, 20);
  assert.ok(least >= room);
  // The cards of a sheet fit on one line of it, with something to spare: a line that fits to the
  // last hundredth of a point would break in two over a rounding.
  const line = COPIES * cardWidth + (COPIES - 1) * least + 2 * room;
  assert.ok(line + 2 <= sheetWidth, `the line of cards is ${line} points, the sheet ${sheetWidth}`);
  // What is to spare goes between the cards: 22 points from one card to the next.
  assert.equal(least + (sheetWidth - line) / (COPIES - 1), 22);
  // The narrower sheet decides: A4 is 210 mm wide, US Letter 8.5 inches. Half an inch at each side
  // is Firefox's margin when the reader changes nothing; Chrome's default for a PDF is 1 cm, which is less.
  const a4 = (210 / 25.4) * 72;
  const letter = 8.5 * 72;
  const margins = 2 * 0.5 * 72;
  assert.ok(sheetWidth <= a4 - margins, `the sheet is ${sheetWidth} points wide, and A4 leaves ${(a4 - margins).toFixed(2)}`);
  assert.ok(sheetWidth <= letter - margins);
});

// -- the site's name, and the logo ---------------------------------------------------------

test("siteHost: the main site's name as the form prints it", () => {
  assert.equal(siteHost('https://www.learnbitcoin.com'), 'learnbitcoin.com');
  assert.equal(siteHost(DEFAULT_CONFIG.siteUrl), 'learnbitcoin.com');
  assert.equal(siteHost('https://learnbitcoin.com'), 'learnbitcoin.com');
  // Only a "www." in front is dropped. A port stays; a path does not show.
  assert.equal(siteHost('https://staging.example.org/es'), 'staging.example.org');
  assert.equal(siteHost('http://www.example.org:8080'), 'example.org:8080');
  assert.equal(siteHost('https://wwwx.example.org'), 'wwwx.example.org');
  // A text that is no address comes back as it was, and nothing throws.
  assert.equal(siteHost('learnbitcoin.com'), 'learnbitcoin.com');
  assert.equal(siteHost(''), '');
});

test('the logo on paper: the favicon is the very picture inside the logo file, and the name is the rest of that file', () => {
  const logo = readFileSync(new URL('../public/logo.svg', import.meta.url), 'utf8');
  const favicon = readFileSync(new URL('../public/favicon.png', import.meta.url));
  // The logo file is 163 by 30. Its mark is a square at the left that a picture fills.
  assert.match(logo, /<svg width="163" height="30" viewBox="0 0 163 30"/);
  assert.match(logo, /<rect width="30" height="30" fill="url\(#pattern[^)]*\)"\/>/);
  const inside = logo.match(/<image [^>]*href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/)?.[1];
  assert.ok(inside, 'the logo file holds a PNG picture');
  // That picture and the favicon are one and the same, byte for byte: the card may show the mark from either.
  assert.ok(Buffer.from(inside, 'base64').equals(favicon), 'favicon.png is no longer the picture inside logo.svg');
  // The name starts 38 across, after the mark and a gap of 8. The card shows the file from there to its right edge.
  const starts = [...logo.matchAll(/<path d="M([0-9.]+) /g)].map((hit) => Number(hit[1]));
  assert.equal(Math.min(...starts), 38);
  assert.match(card, /<img src="\/favicon\.png" alt="" width="256" height="256" class="h-\[1em\] w-\[1em\]" \/>/);
  assert.match(card, /<img src="\/logo\.svg#svgView\(viewBox\(38,0,125,30\)\)" alt=\{c\.siteName\} width="125" height="30" class="h-\[1em\] w-\[4\.167em\]" \/>/);
  assert.equal(38 + 125, 163);
  // In units of the logo's height: the gap is 8 of 30, the name 125 of 30.
  assert.match(card, /gap-\[0\.267em\]/);
  assert.equal((8 / 30).toFixed(3), '0.267');
  assert.equal((125 / 30).toFixed(3), '4.167');
});
