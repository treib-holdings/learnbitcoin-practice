<script lang="ts">
  // A panel that holds one thing: a form, a list, a result.
  //
  //   white   the usual card
  //   grey    a quieter panel, for something beside the main thing
  //   dashed  something that is not there yet
  //
  // With a `title` the card is a named section of the page, and the title is
  // an h2. `label` is the small orange line above it.

  import type { Snippet } from 'svelte';
  import { EYEBROW } from './styles.ts';

  interface Props {
    tone?: 'white' | 'grey' | 'dashed';
    label?: string;
    title?: string;
    class?: string;
    children: Snippet;
    [key: `data-${string}`]: string | undefined;
  }

  let { tone = 'white', label, title, class: extra = '', children, ...rest }: Props = $props();

  const id = $props.id();

  const BOX = {
    white: 'rounded-xl border border-ink-100 bg-white p-5 shadow-sm',
    grey: 'rounded-xl border border-ink-100 bg-ink-50 p-6',
    dashed: 'rounded-xl border border-dashed border-ink-200 bg-ink-50/50 p-6',
  } as const;
</script>

<section {...rest} aria-labelledby={title ? `${id}-title` : undefined} class={[BOX[tone], extra]}>
  {#if label}<p class={EYEBROW}>{label}</p>{/if}
  {#if title}
    <h2 id="{id}-title" class={['text-balance text-xl font-bold text-ink-800', label && 'mt-1']}>{title}</h2>
  {/if}
  <div class={label || title ? 'mt-3' : ''}>{@render children()}</div>
</section>
