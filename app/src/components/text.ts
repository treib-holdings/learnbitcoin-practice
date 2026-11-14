// Small decisions about text that the pieces make, as plain functions so
// that "node --test" can check them.

import type { Lang } from '@learnbitcoin/practice-contract';

// A sentence ends at a full stop that is followed by a space and a capital
// letter. "bcrt1." or "0.1 sat/vB" inside a sentence does not end it. In
// Spanish a sentence can also start with an accented capital or with an
// inverted question mark: the escapes below are A, E, I, O and U with an
// acute accent, N with a tilde, and that mark.
const SENTENCE_END = /\.(?= [A-Z\u00C1\u00C9\u00CD\u00D3\u00DA\u00D1\u00BF])/g;

/** Where the full stop of each sentence but the last is, counted from the start of the text. */
function sentenceEnds(text: string): number[] {
  return [...text.matchAll(SENTENCE_END)].map((hit) => hit.index);
}

/**
 * An error sentence from the string tables, split into its cause and its
 * way out: the first sentence, then the rest. Every sentence in
 * strings/errors.ts is written in that order, so a notice can set the cause
 * in bold and the way out under it. A text of one sentence comes back whole,
 * with an empty rest.
 */
export function splitLead(text: string): { lead: string; rest: string } {
  const first = sentenceEnds(text)[0];
  if (first === undefined) return { lead: text, rest: '' };
  return { lead: text.slice(0, first + 1), rest: text.slice(first + 2) };
}

/**
 * A text without its last sentence. A text of one sentence comes back
 * whole. It is for the one place that shows an error sentence and does by
 * itself what the sentence's last part tells the reader to do (frame.ts).
 */
export function withoutLastSentence(text: string): string {
  const last = sentenceEnds(text).at(-1);
  return last === undefined ? text : text.slice(0, last + 1);
}

/** What a countdown shows: whole seconds under a minute, whole minutes from there. */
export interface TimeLeft {
  unit: 'second' | 'minute';
  count: number;
}

/**
 * The time from `now` until `to`, both in milliseconds since 1970, rounded
 * up: a reader told "1 second" still has that second. Past the time it
 * stays at 0 seconds.
 */
export function timeLeft(to: number, now: number): TimeLeft {
  const seconds = Math.max(0, Math.ceil((to - now) / 1000));
  if (seconds < 60) return { unit: 'second', count: seconds };
  return { unit: 'minute', count: Math.ceil(seconds / 60) };
}

/** The key, in strings/common.ts, of the text for a time left: "timeSecond" for 1 second, "timeSeconds" for any other count. */
export function timeLeftKey(left: TimeLeft): 'timeSecond' | 'timeSeconds' | 'timeMinute' | 'timeMinutes' {
  if (left.unit === 'second') return left.count === 1 ? 'timeSecond' : 'timeSeconds';
  return left.count === 1 ? 'timeMinute' : 'timeMinutes';
}

/**
 * The main site's home page in the language of the page that links to it.
 * The site keeps its Spanish edition under /es, as this app does, and
 * `siteUrl` comes without a slash at its end (the contract says so).
 */
export function siteHome(siteUrl: string, lang: Lang): string {
  return lang === 'es' ? `${siteUrl}/es` : siteUrl;
}
