// A sentence from the string tables, cut where a value has to be drawn in
// its own way. Plain functions, so that "node --test" can hold them to
// their rules.
//
// Most slots are filled as text: an amount, a count, a day. Two kinds of
// value are not running text. An address and a wallet fingerprint are
// compared character by character: they are set in the monospace font,
// break wherever the line ends, and are marked so that a translating
// browser leaves them alone. So the sentence is cut at those slots, and the
// screen draws the value between the two halves (Sentence.svelte).

import { fill, slotNames } from '../../lib/format.ts';

/** A run of words with its plain slots filled in, or a value to draw in the monospace font. */
export type Bit = { kind: 'text'; text: string } | { kind: 'mono'; text: string };

/**
 * The bits of a sentence, in order. `slots` holds a value for every slot of
 * `template`, and `mono` names the slots whose values are drawn apart. Put
 * end to end, the bits are the sentence a reader sees.
 *
 * Like fill(), it throws when the sentence and its values have drifted
 * apart: a slot with no value, or a value with no slot.
 */
export function sentenceBits(template: string, slots: Readonly<Record<string, string>>, mono: readonly string[] = []): Bit[] {
  const names = slotNames(template);
  for (const name of names) {
    if (!Object.hasOwn(slots, name)) throw new Error(`bits: no value for {${name}} in "${template}"`);
  }
  for (const name of Object.keys(slots)) {
    if (!names.includes(name)) throw new Error(`bits: the text has no {${name}}: "${template}"`);
  }
  const apart = names.filter((name) => mono.includes(name));
  // The plain slots of a run of words: the ones it names that are not drawn apart.
  const plain = (words: string): string =>
    fill(words, Object.fromEntries(slotNames(words).map((name) => [name, slots[name] ?? ''])));
  let bits: Bit[] = [{ kind: 'text', text: template }];
  for (const name of apart) {
    bits = bits.flatMap((bit): Bit[] => {
      if (bit.kind !== 'text') return [bit];
      const out: Bit[] = [];
      bit.text.split(`{${name}}`).forEach((words, index) => {
        if (index > 0) out.push({ kind: 'mono', text: slots[name] ?? '' });
        if (words !== '') out.push({ kind: 'text', text: words });
      });
      return out;
    });
  }
  return bits.map((bit) => (bit.kind === 'text' ? { kind: 'text', text: plain(bit.text) } : bit));
}

/** The sentence as a reader sees it: what the bits say, end to end. */
export function bitsText(bits: readonly Bit[]): string {
  return bits.map((bit) => bit.text).join('');
}
