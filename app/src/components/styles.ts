// The class strings the pieces share.
//
// They are the main site's reviewed recipes: dark text on the orange button,
// the darker orange for small orange text, field edges a reader can see, and
// one dark focus outline on everything that takes focus. A screen that needs
// a look no piece gives takes its strings from here, so the app keeps one
// look.
//
// Tailwind reads this file as plain text and makes a rule for every whole
// class name in it. So a name is always written out in full, never glued
// together from parts.

/**
 * The one focus outline, on everything that can take keyboard focus. It is
 * dark, so it reads on white, on the grey panels and on the orange button
 * alike; an orange outline would vanish on the button.
 */
export const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900';

/** A link inside a sentence. */
export const LINK = `rounded-sm text-orange-600 underline hover:text-orange-700 ${FOCUS}`;

/** A link in a line of small print (the footer), which keeps the colour of the text around it. */
export const QUIET_LINK = `rounded-sm underline hover:text-orange-600 ${FOCUS}`;

/**
 * What a link that leaves this site carries. It opens in a new tab, with
 * no referrer (noreferrer: the request has no Referer header, and the page
 * it opens finds document.referrer empty) and no handle on this tab
 * (noopener). That is not the same as telling the other site nothing: a
 * browser marks the request with a header of its own, Sec-Fetch-Site,
 * which says whether it comes from the same site, and the main site and
 * the practice explorer are hosts of this page's own site. That header
 * names no host and no page. Each click opens a tab of its own. A named
 * tab that every such link shared would not be shared after all: with
 * noopener a browser never reuses a named tab.
 */
export const OUTSIDE = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * For a small link that stands by itself, such as a chip or the language
 * switch: the link looks as it does, and the area that takes a tap is 44 px
 * tall, centred on it. An unseen box laid over the link (its ::after) does
 * it, so nothing around the link moves.
 *
 * The link must be a box of its own: give it "inline-block" or
 * "inline-flex" as well. Lines of such links need 44 px from the middle of
 * one to the middle of the next, or their areas overlap. It is not for a
 * link inside a sentence: its area would cover the lines above and below.
 */
export const TAP = 'relative after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2';

/** The look of each kind of button. Button.svelte adds the focus outline and the states. */
export const BUTTON = {
  /**
   * The one thing this step is for. 50 px tall. (The main site's string
   * starts with "shrink-0". Not here: in a row of buttons on a phone, a long
   * Spanish label must be free to wrap onto two lines, or it pushes the
   * page wider than the screen.)
   */
  primary:
    'rounded-md border border-orange-600 bg-orange-400 px-5 py-3 text-base font-semibold text-ink-900 transition hover:bg-orange-300 motion-reduce:transition-none',
  /** The same, at the size of a button inside a card. 34 px tall. */
  primarySmall:
    'rounded-md border border-orange-600 bg-orange-400 px-3 py-1.5 text-sm font-semibold text-ink-900 hover:bg-orange-300',
  /** The other way on, or the way back. As tall as the primary button. */
  secondary:
    'rounded-md border border-ink-200 px-6 py-3 text-base font-semibold text-ink-700 transition hover:border-orange-400 hover:text-orange-600 motion-reduce:transition-none',
  /** A small action beside something: Copy, Lock, Show a new address. 34 px tall. */
  quiet: 'rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-orange-400',
} as const;

/** A text field. 16 px text: under that, Safari on a phone zooms the page when the field takes focus. */
export const FIELD = `w-full rounded-md border border-ink-400 bg-white px-3 py-2 text-base text-ink-800 disabled:border-ink-200 disabled:bg-ink-50 disabled:text-ink-500 ${FOCUS}`;

/** The small orange line above a heading, or at the top of a card. */
export const EYEBROW = 'text-xs font-semibold uppercase tracking-widest text-orange-600';
