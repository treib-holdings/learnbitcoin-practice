<script lang="ts">
  // A list of facts, each a name and its value: To, Amount, Fee, Total.
  // Put Row pieces inside. On a phone a value sits under its name; from a
  // wider screen they share a line.

  import type { Snippet } from 'svelte';

  interface Props {
    class?: string;
    children: Snippet;
  }

  let { class: extra = '', children }: Props = $props();
</script>

<dl class={['divide-y divide-ink-100 border-y border-ink-100 text-sm', extra]}>
  {@render children()}
</dl>
