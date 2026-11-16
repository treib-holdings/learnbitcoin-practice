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
  // no exception to it. So the main site is not told by the browser where
  // the reader comes from. What the link carries is its address and
  // nothing else: a chapter's page and, on "Back to the chapter", the mark
  // that names the step and says whether it is done (chapterLink in
  // lib/doit/progress.ts). About says so to the reader, and
  // test/info-text.test.ts holds that sentence to this file.
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
