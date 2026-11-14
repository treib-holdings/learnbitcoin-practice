<script lang="ts">
  // A row of buttons. They wrap onto more lines on a narrow screen, and a
  // small button beside a tall one keeps its own height.
  //
  // `tight` is for the small buttons inside a card.

  import type { Snippet } from 'svelte';

  interface Props {
    tight?: boolean;
    class?: string;
    children: Snippet;
  }

  let { tight = false, class: extra = '', children }: Props = $props();
</script>

<div class={['flex flex-wrap items-center', tight ? 'gap-2' : 'gap-4', extra]}>
  {@render children()}
</div>
