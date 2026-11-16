<script lang="ts">
  // A link that leaves this site: the main site, the explorer, the source
  // code. It opens in a new tab (each click a tab of its own), so the
  // wallet's tab (and a passkey wallet's unlock) stays as it is, and it
  // sends no referrer: the other site is not sent the address of the page
  // the reader was on (styles.ts, OUTSIDE, says what a browser still
  // sends). A small arrow marks it, and a screen reader is told that a new
  // tab opens: hidden words after the link's own say so. A link whose own
  // words already say that it opens a new tab (the footer's link to the
  // main site) sets `saysNewTab`, and the hidden words are left out: a
  // screen reader would say it twice.
  //
  //   <OutLink href={url} text={t.chapterLink} />
  //
  // Hand the link's words in as `text` wherever they are plain words. The
  // arrow then never stands alone at the start of a line: the last word and
  // the arrow are kept together, and the line breaks before that word.
  // Words given between the tags are drawn as they come, and there the
  // arrow can be left alone on a line when the words just fill the one
  // before it: keep that form for what is not plain words, such as an
  // address that has to break anywhere.
  //
  // `quiet` is for a line of small print, where the link keeps the colour
  // of the text around it. `plain` is for a row of navigation links, which
  // all look alike: no underline and no colour of its own, so the row's own
  // classes (handed in as `class`) decide. Other attributes pass through. On a Spanish page
  // a link to a page that exists in English only says so at the end of its
  // text (as linkSource does in the Spanish table of strings/common.ts) and
  // carries hreflang="en".

  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';
  import { FOCUS, LINK, OUTSIDE, QUIET_LINK } from './styles.ts';

  interface Props extends Omit<HTMLAnchorAttributes, 'class' | 'children' | 'href' | 'target' | 'rel'> {
    href: string;
    /** The link's words. With them, the last word and the arrow stay on one line. */
    text?: string;
    quiet?: boolean;
    /** For a row of navigation links: no underline and no colour of its own. */
    plain?: boolean;
    /** The link's own words say that it opens a new tab: the hidden words that say so to a screen reader are left out. */
    saysNewTab?: boolean;
    class?: string;
    /** The link's words, for what `text` cannot carry. */
    children?: Snippet;
  }

  let { href, text, quiet = false, plain = false, saysNewTab = false, class: extra = '', children, ...rest }: Props = $props();

  let t = $derived(strings.common[router.lang]);

  /** Where the last word of `text` starts: after its last space, or at the start of a text of one word. */
  let cut = $derived(text === undefined ? 0 : text.lastIndexOf(' ') + 1);
</script>

<!-- The arrow. An <svg> in the run of text could be moved to the next line by
     itself, whatever is put in between. So it sits in an empty span that
     follows the last word: the span has a little room in it (padding), and
     the arrow is placed in that room, out of the run of text. -->
{#snippet arrow()}<span class="relative pr-[0.8em]" aria-hidden="true"
    ><svg
      class="absolute bottom-[0.4em] right-0 h-[0.6em] w-[0.6em]"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"><path d="M3 1h6v6M9 1 1 9" /></svg
    ></span
  >{/snippet}

<!-- That room alone can still be pushed to the next line, when the words
     just fill the one before. With `text` it cannot: the last word and the
     arrow are one piece that does not break, so a line ends before that
     word or after the arrow. The hidden words start with a space of their
     own: a screen reader must not run them into the link's last word. They
     are left out where the link's own words say the same (saysNewTab). -->
<a {...rest} {href} {...OUTSIDE} class={[plain ? `rounded-sm ${FOCUS}` : quiet ? QUIET_LINK : LINK, extra]}
  >{#if text !== undefined}{text.slice(0, cut)}<span class="whitespace-nowrap">{text.slice(cut)}{@render arrow()}</span
    >{:else}{@render children?.()}{@render arrow()}{/if}{#if !saysNewTab}<span class="sr-only">{' '}{t.opensNewTab}</span>{/if}</a
>
