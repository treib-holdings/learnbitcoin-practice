<script lang="ts">
  // A line for a list that has nothing in it yet: "No coins yet". What the
  // reader can do about it goes between the tags, as a button or a link:
  // "Get practice coins".

  import type { Snippet } from 'svelte';

  interface Props {
    text: string;
    class?: string;
    children?: Snippet;
    [key: `data-${string}`]: string | undefined;
  }

  let { text, class: extra = '', children, ...rest }: Props = $props();
</script>

<div {...rest} class={['py-8 text-center', extra]}>
  <p class="text-sm text-ink-500">{text}</p>
  {#if children}
    <div class="mt-4 flex flex-wrap items-center justify-center gap-2">{@render children()}</div>
  {/if}
</div>
