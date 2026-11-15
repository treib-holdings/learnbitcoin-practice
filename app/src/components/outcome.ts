// What the screen that has just closed did, for the screen that opens next.
//
// Two things a reader does end by leaving the screen they were done on.
// "Remove it" on Settings goes Home, and a restore goes to the Overview. The
// new screen then looked like any other visit to it: Home read as a first
// visit ("This browser has none right now. It may have erased its copy..."),
// and nothing on the page or in the status region said that the wallet had
// just been removed, or restored.
//
// So the screen that leaves says what it did, and the screen that opens
// takes that word, shows it for that one visit and has it read out. Only
// the very next screen can take it: a reader who went somewhere else first
// is told nothing stale later. The app's count of screens says which
// screen is the next one (screen-count.ts).
//
// The word is a name from a short list and never holds anything of the
// wallet. It lives in this page's memory only: a page load forgets it.

import { screenNumber } from './screen-count.ts';

/**
 * removed   the wallet was removed from this browser (Settings, then Home)
 * restored  a wallet was restored from its 12 words, which this browser now
 *           keeps (Restore, then the Overview)
 */
export type Outcome = 'removed' | 'restored';

/** What the last screen to leave said, and which screen that was. */
let left: { outcome: Outcome; screen: number } | null = null;

/** Call just before the move to the next screen, on the screen that did it. */
export function leaveOutcome(outcome: Outcome): void {
  left = { outcome, screen: screenNumber() };
}

/**
 * Call once, while the screen is being set up. True when the screen before
 * this one left exactly this outcome. Whatever was left is taken away, so
 * it is said on one screen and for one visit.
 */
export function takeOutcome(outcome: Outcome): boolean {
  const mine = left !== null && left.outcome === outcome && screenNumber() === left.screen + 1;
  left = null;
  return mine;
}
