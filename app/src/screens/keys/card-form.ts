// The measures of the main site's 12-word backup form, as far as the
// practice card draws them, and the few sums made from them.
//
// The form is a PDF: one sheet with three cards, each with twelve numbered
// rows of eight letter cells. Its text is stored as drawings and there is
// no design file, so every number here was measured on the PDF itself, in
// points (1/72 inch). The card (PracticeCard.svelte) draws its rows in a
// picture whose unit is one point, so a number here is a length on paper.
//
// Plain constants and functions, so that "node --test" can check them.

/**
 * The letter cells of one row. The 12 words come from the BIP39 list, whose
 * words have three to eight letters: a row has a cell for every letter of
 * the longest.
 */
export const CELLS = 8;

/** The cards on one printed sheet, side by side, as on the form. */
export const COPIES = 3;

/** One row of the form: a numbered circle, a short line, and a box of letter cells. */
export const ROW = {
  /** The circle, across. The box is as tall. */
  circle: 14,
  /** The line that joins the circle to the box: its length, its width, and how far under the row's top it runs. */
  link: { length: 5.59, width: 0.65, y: 6.675 },
  /** One letter cell, a square: its side. */
  cell: 14,
  /** The box's outline, which lies inside the box's edge: its width, and the radius of the box's corners. */
  outline: 0.65,
  corner: 4,
  /** The dashed lines between the cells: their width, and the length of a dash (a gap is as long). */
  dash: { width: 0.5, length: 1 },
  /** The number in the circle: the size of its type, and how far under the row's top its baseline is. */
  number: { size: 7.5, baseline: 9.73 },
  /** From the top of one row to the top of the next. */
  pitch: 18,
  /** The rows stand in groups of this many, with this much more between two groups. */
  group: 6,
  groupGap: 8,
} as const;

/** Keeps a sum of the lengths above to hundredths of a point: 19.59, not 19.590000000000003. */
const tidy = (length: number): number => Math.round(length * 100) / 100;

/** Where a row's box starts, from the row's left edge: after the circle and the line. */
export const BOX_LEFT = tidy(ROW.circle + ROW.link.length);

/** How wide a row's box is: its cells, side by side. */
export const BOX_WIDTH = CELLS * ROW.cell;

/** One row of a card: its number, and how far its top is under the top of row 1. */
export interface FormRow {
  number: number;
  top: number;
}

/**
 * The rows of a card that takes `count` words, row 1 first. They run down
 * the card, one row to a word, in groups of six with a wider step between
 * two groups, as on the form.
 */
export function formRows(count: number): FormRow[] {
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    top: index * ROW.pitch + Math.floor(index / ROW.group) * ROW.groupGap,
  }));
}

/**
 * Where the dashed lines of a row's box stand, from the row's left edge.
 * One line less than there are cells: seven lines part eight cells. The
 * box's own outline closes the first cell and the last.
 */
export function cellLines(): number[] {
  return Array.from({ length: CELLS - 1 }, (_, index) => tidy(BOX_LEFT + (index + 1) * ROW.cell));
}

/**
 * The size of the picture that holds the rows of a card that takes `count`
 * words: as wide as one row, and as tall as all of them with the steps
 * between them.
 */
export function rowsPicture(count: number): { width: number; height: number } {
  const last = formRows(count).at(-1);
  return { width: tidy(BOX_LEFT + BOX_WIDTH), height: last === undefined ? 0 : tidy(last.top + ROW.circle) };
}

/**
 * The main site's name as its form prints it: the site's host, without a
 * "www." in front. `siteUrl` is the app's own setting for the main site
 * ("https://www.learnbitcoin.com"); a text that is no address is given
 * back as it came.
 */
export function siteHost(siteUrl: string): string {
  let host: string;
  try {
    host = new URL(siteUrl).host;
  } catch {
    return siteUrl;
  }
  return host.startsWith('www.') ? host.slice('www.'.length) : host;
}
