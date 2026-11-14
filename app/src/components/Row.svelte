<script lang="ts">
  // One fact inside Rows: `name`, and the value between the tags. The value
  // can be plain text, an Amount, a Mono value or a link.

  import type { Snippet } from 'svelte';

  interface Props {
    name: string;
    children: Snippet;
    [key: `data-${string}`]: string | undefined;
  }

  let { name, children, ...rest }: Props = $props();
</script>

<div {...rest} class="flex flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
  <dt class="shrink-0 font-semibold text-ink-500">{name}</dt>
  <dd class="min-w-0 text-ink-800 sm:text-right">{@render children()}</dd>
</div>
