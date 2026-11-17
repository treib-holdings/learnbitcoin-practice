// What the questions of the "Do it" steps keep in the page, and what they
// say to an answer. Plain functions, so that "node --test" can check them.
//
// A step asks two kinds of question: a number (how many coins the wallet
// holds) and three of the 12 words. Whether an answer is right is judged
// elsewhere (answerCoins and wordsPassed in lib/doit/judge.ts, and the
// wallet itself for the words). This file holds the two small things
// around that:
//
//   - which three places of the 12 words a check asks for. They are chosen
//     at random when the question first opens and kept until it has been
//     answered right, so that a reader who gets one wrong, or leaves the
//     screen and comes back, is asked for the same three. A question that
//     moved on after every wrong try could be passed by guessing at
//     whichever words the reader happens to remember. They are kept in the
//     page's memory only: places are no secret, but nothing about the words
//     belongs in storage.
//   - which sentence answers a count of coins that was not right. None of
//     them ever says what the number is.

import { pickPositions, type Answer } from '../../lib/doit/judge.ts';
import type { DoitKey } from './view.ts';

/** The places asked for, by question. A page load forgets them, and the next opening picks afresh. */
const asked = new Map<string, readonly number[]>();

/**
 * The three places (from 0) the question named `key` asks for: the ones it
 * asked for before, or three new ones if it has not asked yet. `random` is
 * for tests; the app leaves it out.
 */
export function positionsFor(key: string, random?: () => number): readonly number[] {
  const kept = asked.get(key);
  if (kept !== undefined) return kept;
  const picked = pickPositions(random);
  asked.set(key, picked);
  return picked;
}

/** The question named `key` was answered right: the next time it opens, it asks for three new places. */
export function positionsAnswered(key: string): void {
  asked.delete(key);
}

/**
 * The sentence for an answer to "How many separate coins does this wallet
 * hold?" that did not tick the part, or null for one that did. "not-now"
 * means the question closed under the reader: another tab answered it, or
 * the wallet changed.
 */
export function answerKey(answer: Answer): DoitKey | null {
  switch (answer) {
    case 'right':
      return null;
    case 'wrong':
      return 'coinsWrong';
    case 'total':
      return 'coinsTotal';
    case 'empty':
      return 'answerEmpty';
    case 'period':
      return 'answerPeriod';
    case 'invalid':
      return 'answerInvalid';
    case 'not-now':
      return 'answerClosed';
  }
}
