<script lang="ts">
  // A link that leaves this site: the main site, the explorer, the source
  // code. It opens in a new tab (each click a tab of its own), so the
  // wallet's tab (and a passkey wallet's unlock) stays as it is, and the
  // other site is not told where the reader came from. A small arrow marks
  // it, and a screen reader is told that a new tab opens.
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
    quiet?: boolean;
    class?: string;
    children: Snippet;
  }

  let { href, quiet = false, class: extra = '', children, ...rest }: Props = $props();

  let t = $derived(strings.common[router.lang]);
</script>

<!-- The arrow must never stand alone at the start of a line. An <svg> in
     the run of text could: a line may break before it, whatever is put in
     between. So an empty span follows the last word, with a little room in
     it (padding, which a line cannot break away from the word), and the
     arrow is placed in that room, out of the run of text. -->
<a {...rest} {href} {...OUTSIDE} class={[quiet ? QUIET_LINK : LINK, extra]}
  >{@render children()}<span class="relative pr-[0.8em]" aria-hidden="true"
    ><svg
      class="absolute bottom-[0.4em] right-0 h-[0.6em] w-[0.6em]"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"><path d="M3 1h6v6M9 1 1 9" /></svg
    ></span
  ><span class="sr-only"> {t.opensNewTab}</span></a
>
