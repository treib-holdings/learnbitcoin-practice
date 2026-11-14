// A sentence of the Sparrow page, cut into the parts the screen draws in
// different ways. Three things in such a sentence are not running text:
//
//   - the menu arrow, "->". Left as text, a line may end between the
//     hyphen and the ">", and the arrow falls apart;
//   - a slot's value: the flag, the derivation path. It is typed exactly
//     as shown, so it is set as code, kept on one line, and marked so that
//     a translating browser leaves it alone;
//   - a label of Sparrow's, written between backticks in the table:
//     `File -> Settings`. A reader goes back and forth between this page
//     and Sparrow, and has to see where a label starts and ends. It is
//     English in every language, and is marked as such.
//
// Plain functions, so that "node --test" can hold them to their rules.
// Says.svelte draws what they give.

import { slotNames } from '../../lib/format.ts';

/** The menu arrow, as the tables write it. */
export const ARROW = '->';

/** The mark on each side of a label of Sparrow's, in the tables. */
export const LABEL_MARK = '`';

/** A run of plain words, or the menu arrow. */
export type Bit = { kind: 'text'; text: string } | { kind: 'arrow' };

/** One part of a sentence: plain words, the arrow, a slot's value, or a label made of words and arrows. */
export type Part = Bit | { kind: 'value'; text: string } | { kind: 'label'; bits: Bit[] };

/** Words with each arrow in them set apart. Empty runs are left out. */
function arrowBits(text: string): Bit[] {
  const bits: Bit[] = [];
  text.split(ARROW).forEach((words, index) => {
    if (index > 0) bits.push({ kind: 'arrow' });
    if (words !== '') bits.push({ kind: 'text', text: words });
  });
  return bits;
}

/** Words outside a label: each slot gives way to its value, each arrow is set apart. */
function plainParts(text: string, slots: Record<string, string>): Part[] {
  let parts: Part[] = [{ kind: 'text', text }];
  for (const name of slotNames(text)) {
    const value = slots[name] ?? '';
    parts = parts.flatMap((part): Part[] => {
      if (part.kind !== 'text') return [part];
      const out: Part[] = [];
      part.text.split(`{${name}}`).forEach((words, index) => {
        if (index > 0) out.push({ kind: 'value', text: value });
        if (words !== '') out.push({ kind: 'text', text: words });
      });
      return out;
    });
  }
  return parts.flatMap((part): Part[] => (part.kind === 'text' ? arrowBits(part.text) : [part]));
}

/**
 * The parts of a sentence, in order. Put end to end (a label without its
 * marks, a slot as its value) they are the sentence a reader sees.
 *
 * Like fill(), it throws when the sentence and its values have drifted
 * apart: a slot with no value, or a value with no slot. It also throws for
 * a label that is left open or empty, and for a slot inside a label: a
 * label is Sparrow's own words, and nothing of ours goes into it.
 */
export function sentenceParts(text: string, slots: Record<string, string> = {}): Part[] {
  const names = slotNames(text);
  for (const name of names) {
    if (!Object.hasOwn(slots, name)) throw new Error(`says: no value for {${name}} in "${text}"`);
  }
  for (const name of Object.keys(slots)) {
    if (!names.includes(name)) throw new Error(`says: the text has no {${name}}: "${text}"`);
  }
  // Every second piece stands between two marks: a label.
  const pieces = text.split(LABEL_MARK);
  if (pieces.length % 2 === 0) throw new Error(`says: a label is left open in "${text}"`);
  return pieces.flatMap((piece, index): Part[] => {
    if (index % 2 === 0) return plainParts(piece, slots);
    if (piece.trim() === '') throw new Error(`says: an empty label in "${text}"`);
    if (slotNames(piece).length > 0) throw new Error(`says: a slot inside a label in "${text}"`);
    return [{ kind: 'label', bits: arrowBits(piece) }];
  });
}

/** The sentence as a reader sees it: what the parts say, end to end. */
export function sentenceText(text: string, slots: Record<string, string> = {}): string {
  const said = (bit: Bit): string => (bit.kind === 'arrow' ? ARROW : bit.text);
  return sentenceParts(text, slots)
    .map((part) => (part.kind === 'label' ? part.bits.map(said).join('') : part.kind === 'value' ? part.text : said(part)))
    .join('');
}

/** True for a sentence that has to be drawn by Says: it holds a label, an arrow or a slot. */
export function needsSays(text: string): boolean {
  return text.includes(LABEL_MARK) || text.includes(ARROW) || slotNames(text).length > 0;
}
