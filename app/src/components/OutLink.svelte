<script lang="ts">
  // A link that leaves this site: the main site, the explorer, the source
  // code. It opens in a new tab (each click a tab of its own), so the
  // wallet's tab (and a passkey wallet's unlock) stays as it is, and the
  // other site is not told where the reader came from. A small arrow marks
  // it, and a screen reader is told that a new tab opens.
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
  // of the text around it. Other attributes pass through. On a Spanish page
  // a link to a page that exists in English only says so at the end of its
  // text (as linkSource does in the Spanish table of strings/common.ts) and
  // carries hreflang="en".

  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';
  import { LINK, OUTSIDE, QUIET_LINK } from './styles.ts';

  interface Props extends Omit<HTMLAnchorAttributes, 'class' | 'children' | 'href' | 'target' | 'rel'> {
    href: string;
    /** The link's words. With them, the last word and the arrow stay on one line. */
    text?: string;
    quiet?: boolean;
    class?: string;
    /** The link's words, for what `text` cannot carry. */
    children?: Snippet;
  }

  let { href, text, quiet = false, class: extra = '', children, ...rest }: Props = $props();

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
     own: a screen reader must not run them into the link's last word. -->
<a {...rest} {href} {...OUTSIDE} class={[quiet ? QUIET_LINK : LINK, extra]}
  >{#if text !== undefined}{text.slice(0, cut)}<span class="whitespace-nowrap">{text.slice(cut)}{@render arrow()}</span
    >{:else}{@render children?.()}{@render arrow()}{/if}<span class="sr-only">{' '}{t.opensNewTab}</span></a
>
