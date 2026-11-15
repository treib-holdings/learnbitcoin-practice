// Taps that must not count.
//
// A double tap is two clicks at one point. The first one can swap what is
// on screen, and the second then lands on whatever the swap put under the
// reader's finger. "Show the 12 words" gives way to "Hide them", so the
// words would come and go in one double tap. A question that a "Remove"
// button opens can put "Remove it" where that button stood, so a wallet
// would be removed with the question never read. The controls that could
// be hit that way do not take the second click of a double tap, and the
// answers to such a question take no press at all in the first moment
// after it has opened.
//
// (The router keeps the same rule for links: the second click of a double
// tap follows none. See lib/navigation.ts.)

/**
 * True for a click that is the second, or a later one, of several made in
 * quick succession at one point. The browser counts them and says so in
 * the click's `detail`: 1 for a single click, 2 for the second of a double
 * one, by mouse and by touch alike. A press from the keyboard says 0.
 */
export function isRepeatTap(click: { detail: number }): boolean {
  return click.detail > 1;
}

/**
 * How long a question that cannot be taken back takes no answer after it
 * has opened, in milliseconds. It is longer than the slowest double tap a
 * browser still counts as one, and far shorter than reading the question
 * takes. The count in `detail` alone is not enough where one answer cannot
 * be undone: a browser may count two taps a little apart as two single ones.
 */
export const ANSWER_SETTLE_MS = 600;

/**
 * Whether a press on one of such a question's answers counts: not the
 * second click of a double tap, and not one that comes sooner after the
 * question opened than a reader could have seen it. `sinceAskedMs` is how
 * long ago the question opened. It holds for the answer that changes
 * nothing too: that one does no harm, but a question that closes under the
 * tap that opened it was never seen either.
 */
export function answerCounts(sinceAskedMs: number, click: { detail: number }): boolean {
  return !isRepeatTap(click) && sinceAskedMs >= ANSWER_SETTLE_MS;
}
