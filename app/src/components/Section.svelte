<script lang="ts">
  // A part of a screen with its own heading (an h2), such as the parts of
  // About or of one transaction. The screen's h1 comes from Page.

  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    class?: string;
    children: Snippet;
  }

  let { title, class: extra = '', children }: Props = $props();

  const id = $props.id();
</script>

<section aria-labelledby="{id}-title" class={extra}>
  <h2 id="{id}-title" class="text-balance text-2xl font-bold tracking-tight text-ink-800">{title}</h2>
  <div class="mt-4 space-y-4">{@render children()}</div>
</section>
