// Bringing something on screen. On a phone the Receive screen is two or
// three screens tall, and what a tap changes is often not where the tap was:
// the faucet answers under its button, and a new address appears above the
// button that asked for it. Without this the reader taps and sees nothing
// happen.

/**
 * How an element of `height` pixels is scrolled to, on a screen `screen`
 * pixels tall whose top `covered` pixels lie under the sticky banner:
 *   nearest  it fits: the page moves just far enough to show all of it, and
 *            not at all when it is on screen already
 *   start    it is taller than the room there is: from its first line,
 *            where a failure's cause stands
 */
export function scrollBlock(height: number, screen: number, covered: number): 'nearest' | 'start' {
  return height <= screen - covered ? 'nearest' : 'start';
}

/** A length the browser has worked out ("56px"), as a number of pixels. Anything else is 0. */
function pixels(length: string): number {
  return Number.parseFloat(length) || 0;
}

/** Brings `element` on screen. Nothing moves when all of it is there already. */
export function bringIntoView(element: HTMLElement): void {
  // The banner at the top of the screen covers a strip of it: index.html
  // sets that much aside (scroll-padding-top), and the browser keeps what
  // it scrolls to out from under it. An element can ask for more room above
  // or below itself (a scroll-mt or scroll-mb class): for a heading that
  // belongs to it, or so as not to end flush with the screen's edge.
  const own = getComputedStyle(element);
  const covered =
    pixels(getComputedStyle(document.documentElement).scrollPaddingTop) +
    pixels(own.scrollMarginTop) +
    pixels(own.scrollMarginBottom);
  element.scrollIntoView({ block: scrollBlock(element.getBoundingClientRect().height, window.innerHeight, covered) });
}
