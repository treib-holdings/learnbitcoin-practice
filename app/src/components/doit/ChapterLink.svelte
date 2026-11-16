<script lang="ts">
  // A link back to the main site: to the chapter a "Do it" step belongs to.
  //
  // It is the one kind of link in the app that leaves this site in the
  // same tab. A reader comes here from a chapter's card to do a step, and
  // goes back to where they were: a new tab for the way back would leave
  // them with two copies of the chapter.
  //
  // The main site is told where the reader comes from, and no more than
  // the site's name (referrerpolicy="origin"): it may check that a "done"
  // mark in the address really comes from here. The page's own policy
  // sends no referrer at all, so this attribute is what lets that one fact
  // through, for this link alone. No path travels with it, and so no step,
  // no transaction ID and nothing the reader typed.
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

<a {...rest} {href} referrerpolicy="origin" class={[LOOK[look], extra]}>{@render children()}</a>
