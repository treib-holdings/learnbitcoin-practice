<script lang="ts">
  // A link back to the main site: to the chapter a "Do it" step belongs to.
  //
  // It is the one kind of link in the app that leaves this site in the
  // same tab. A reader comes here from a chapter's card to do a step, and
  // goes back to where they were: a new tab for the way back would leave
  // them with two copies of the chapter.
  //
  // It sends no referrer, like every other request this page makes: the
  // page's own policy is "no-referrer" (public/_headers), and this link is
  // no exception to it. So the request for the chapter's page carries no
  // Referer header, and the page it leads to finds document.referrer
  // empty. That is all "no referrer" means, and all that is said of it.
  //
  // It does not mean that the main site learns nothing of where the reader
  // was. A browser adds a header of its own to the request, which no page
  // can switch off: "Sec-Fetch-Site: same-site" (and "Sec-Fetch-User: ?1"
  // for a link the reader pressed), because the wallet's host and the main
  // site's are two hosts of one site. It tells the main site's server that
  // the reader followed a link on some host of that site. It names no
  // host and no page. (And the mark in the address says as much anyway.)
  // e2e/scenarios/doit-chapter.test.ts follows the link to a stand-in on
  // the same site, and reads that header there.
  //
  // What the link itself carries is its address and nothing else: a
  // chapter's page and, on "Back to the chapter", the mark that names the
  // step and says whether it is done (chapterLink in lib/doit/progress.ts).
  // About says so to the reader, and test/info-text.test.ts holds that
  // sentence to this file.
  //
  //   link     a link in a line of text
  //   heading  a chapter's name as a heading of the list of steps: the
  //            heading's own colour, underlined so that it reads as a link
  //   primary  the main button of a step that is done
  //   strip    a small link in the strip under the header

  import type { Snippet } from 'svelte';
  import { BUTTON, FOCUS, LINK } from '../styles.ts';

  interface Props {
    /** The whole address, as chapterLink() built and checked it. */
    href: string;
    look?: 'link' | 'heading' | 'primary' | 'strip';
    class?: string;
    children: Snippet;
    [key: `data-${string}`]: string | undefined;
  }

  let { href, look = 'link', class: extra = '', children, ...rest }: Props = $props();

  const LOOK = {
    link: LINK,
    heading: `rounded-sm underline decoration-ink-300 underline-offset-4 hover:text-orange-600 hover:decoration-orange-400 ${FOCUS}`,
    // As Button draws a link that looks like a button: never wider than what holds it.
    primary: `inline-block max-w-full text-center ${BUTTON.primary} ${FOCUS}`,
    strip: `rounded-sm font-semibold text-ink-800 underline underline-offset-2 hover:text-orange-700 ${FOCUS}`,
  } as const;
</script>

<a {...rest} {href} class={[LOOK[look], extra]}>{@render children()}</a>
