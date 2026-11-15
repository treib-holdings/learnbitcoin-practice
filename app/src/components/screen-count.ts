// Which screen is on the page, as a number: it goes up by one each time
// the app puts a screen there.
//
// Some work outlives the screen that began it. A passkey prompt stays open
// for as long as the reader takes, and its answer comes back to the piece
// that asked, wherever the reader has gone since. That piece has to know
// whether the screen it stood on is still the one on the page. The address
// cannot tell it: a reader who went away and came back is at the same
// address, on a new screen that asked for nothing. And the piece cannot
// ask as it is taken off the page either: while Svelte tears a piece down,
// a read of the app's state is answered with the value from before the
// change that caused the teardown, so the address still looks like the
// old one.
//
// So the app counts, in plain numbers that nothing redraws for. The marker
// that stands in front of every screen (ScreenChange.svelte, placed by
// App.svelte) calls screenPutOnPage() as its screen is put on the page. A
// piece notes screenNumber() when it is made, and compares when its answer
// comes: another number, another screen.
//
// The same screen in the other language is the same screen: the app does
// not put a new one on the page for it, and the number stays.

let count = 0;

/** The app has put a screen on the page. Only the marker in front of a screen calls this. */
export function screenPutOnPage(): void {
  count += 1;
}

/** The number of the screen that is on the page now. */
export function screenNumber(): number {
  return count;
}
