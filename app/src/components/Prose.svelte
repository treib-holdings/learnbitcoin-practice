<script lang="ts">
  // Running text: paragraphs, lists, a word in bold, a bit of code. It sets
  // the space between paragraphs and the look of what is inside them, so a
  // screen writes plain <p>, <ul>, <ol>, <strong> and <code>.
  // Links inside it are TextLink and OutLink. A CodeBlock may stand inside it too.

  import type { Snippet } from 'svelte';

  interface Props {
    class?: string;
    children: Snippet;
  }

  let { class: extra = '', children }: Props = $props();
</script>

<div
  class={[
    'space-y-5 leading-relaxed text-pretty text-ink-700',
    '[&_strong]:font-semibold [&_strong]:text-ink-800',
    // A bit of code inside a sentence. Not the code of a CodeBlock, which has its own look.
    '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-ink-50 [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-sm',
    '[&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6',
    extra,
  ]}
>
  {@render children()}
</div>
