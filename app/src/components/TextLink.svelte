<script lang="ts">
  // A link inside a sentence, to another screen of the app. Build the
  // address with router.link(route), so it keeps the language.
  // For a link that leaves this site use OutLink.

  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { LINK } from './styles.ts';

  interface Props extends Omit<HTMLAnchorAttributes, 'class' | 'children' | 'href'> {
    href: string;
    class?: string;
    children: Snippet;
  }

  let { href, class: extra = '', children, ...rest }: Props = $props();
</script>

<a {...rest} {href} class={[LINK, extra]}>{@render children()}</a>
