// Taps that must not count, on the Backup and Settings screens: the second
// click of a double tap on "Show the 12 words", "Hide them" and "Print the
// card", and any answer to the Remove question in the first moment after
// it has opened.
//
// The rules themselves are the app's own (components/taps.ts), and the
// shared piece that asks before it removes an unreadable record keeps them
// too. They are handed on here under the names these screens and their
// scenarios know them by.

export { ANSWER_SETTLE_MS as REMOVE_SETTLE_MS, answerCounts, isRepeatTap } from '../../components/taps.ts';
