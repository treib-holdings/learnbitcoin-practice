<script lang="ts">
  // A panel that holds one thing: a form, a list, a result.
  //
  //   white   the usual card
  //   grey    a quieter panel, for something beside the main thing
  //   dashed  something that is not there yet
  //
  // With a `title` the card is a named section of the page, and the title is
  // an h2. `label` is the small orange line above it. With an `id` the card
  // is a part of its screen that an address can name ("#faucet"); its
  // heading can then be given focus from code.
  //
  // Every tone has the same room inside (a little less on a phone), so the
  // text of two cards that stand one under the other starts at one edge.

  import type { Snippet } from 'svelte';
  import { EYEBROW } from './styles.ts';

  interface Props {
    tone?: 'white' | 'grey' | 'dashed';
    label?: string;
    title?: string;
    /** The card's name as a part of its screen: what follows "#" in an address that leads to it. */
    id?: string;
    class?: string;
    children: Snippet;
    [key: `data-${string}`]: string | undefined;
  }

  let { tone = 'white', label, title, id: part, class: extra = '', children, ...rest }: Props = $props();

  const id = $props.id();

  const BOX = {
    white: 'rounded-xl border border-ink-100 bg-white p-5 shadow-sm sm:p-6',
    grey: 'rounded-xl border border-ink-100 bg-ink-50 p-5 sm:p-6',
    dashed: 'rounded-xl border border-dashed border-ink-200 bg-ink-50/50 p-5 sm:p-6',
  } as const;
</script>

<section {...rest} id={part} aria-labelledby={title ? `${id}-title` : undefined} class={[BOX[tone], extra]}>
  {#if label}<p class={EYEBROW}>{label}</p>{/if}
  {#if title && part !== undefined}
    <!-- A card that an address can name: like a screen's own heading, its heading takes focus
         from code only (tabindex="-1"), never from the Tab key, so it shows no outline. -->
    <h2 id="{id}-title" tabindex="-1" class={['text-balance text-xl font-bold text-ink-800 outline-none', label && 'mt-1']}>
      {title}
    </h2>
  {:else if title}
    <h2 id="{id}-title" class={['text-balance text-xl font-bold text-ink-800', label && 'mt-1']}>{title}</h2>
  {/if}
  <div class={label || title ? 'mt-3' : ''}>{@render children()}</div>
</section>
