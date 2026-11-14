// The small decisions behind the fields for typing the 12 words, as plain
// functions so that "node --test" can check them: how a pasted text becomes
// words, where those words land in the fields, and which fields hold a word
// that is not on the list.
//
// The words themselves are never judged here. Whether a word is on the
// BIP39 list, and whether twelve of them pass their checksum, is the
// wallet's answer (WalletApi.checkWords), handed in as a function.

import type { WordsCheck } from '../../lib/wallet-api.ts';

/** A practice wallet has twelve words, and so the piece has twelve fields. */
export const WORD_COUNT = 12;

/**
 * The words in a text that was typed or pasted, in order, in lower case.
 * Words are told apart by white space, commas and semicolons. A number in
 * front of a word, as in a list copied from a note ("1. abandon" or
 * "2) ability"), is dropped, and so is a full stop after it.
 */
export function splitWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((token) => token.replace(/^[0-9]+[.):-]?/, '').replace(/\.+$/, ''))
    .filter((word) => word !== '');
}

/**
 * Puts `words` into the fields, one word to a field, starting at field `at`
 * (counted from 0). A whole phrase of twelve always starts at the first
 * field, wherever it was pasted. Words past the last field are dropped.
 * Returns the new fields, and the field the reader goes on from: the one
 * after the last word placed, or the last field.
 */
export function placeWords(
  fields: readonly string[],
  at: number,
  words: readonly string[],
): { fields: string[]; next: number } {
  const out = [...fields];
  if (words.length === 0) {
    // Only spaces were typed: the field is empty again, and the reader stays in it.
    if (at >= 0 && at < out.length) out[at] = '';
    return { fields: out, next: at };
  }
  const start = words.length >= out.length ? 0 : at;
  let last = start;
  words.forEach((word, offset) => {
    const index = start + offset;
    if (index >= out.length) return;
    out[index] = word;
    last = index;
  });
  return { fields: out, next: Math.min(last + 1, out.length - 1) };
}

/** What the twelve fields hold, as the piece needs to know it. */
export interface FieldsCheck {
  /** The words as one text, in order, single spaces between: what the wallet is given. */
  text: string;
  /** The fields (from 0) that hold a word that is not on the list. */
  unknown: number[];
  /** The fields (from 0) that are empty. */
  empty: number[];
  /** Every field holds a word on the list, and the twelve pass their checksum. */
  valid: boolean;
}

/**
 * Asks `check` (WalletApi.checkWords) about what the fields hold, and turns
 * its answer back into fields. The wallet counts the words it was given, so
 * with an empty field in the middle its positions are not the fields'
 * numbers: this is where they are matched up again.
 */
export function checkFields(fields: readonly string[], check: (text: string) => WordsCheck): FieldsCheck {
  const filled: number[] = [];
  const empty: number[] = [];
  const words: string[] = [];
  fields.forEach((value, index) => {
    const word = value.trim();
    if (word === '') {
      empty.push(index);
      return;
    }
    filled.push(index);
    // One field, one word. A field that still holds two (it never should)
    // is given to the wallet as a word no list has, so it counts as one
    // unknown word and the positions after it stay right.
    words.push(/\s/.test(word) ? '?' : word);
  });
  const text = words.join(' ');
  const answer = check(text);
  const unknown = answer.unknown
    .map((position) => filled[position])
    .filter((index): index is number => index !== undefined);
  return { text, unknown, empty, valid: empty.length === 0 && unknown.length === 0 && answer.valid };
}
