<script lang="ts">
  // A line that says the app is waiting for something: "Looking up this
  // wallet's coins...". The app says so in words; it has no spinner. The
  // text is a present participle and three periods.
  //
  // `inline` is for a small line inside a card, under the thing being worked on.

  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';

  interface Props {
    /** What is being waited for. Without it: "Loading...". */
    text?: string;
    inline?: boolean;
    class?: string;
    [key: `data-${string}`]: string | undefined;
  }

  let { text, inline = false, class: extra = '', ...rest }: Props = $props();

  let t = $derived(strings.common[router.lang]);
</script>

<p {...rest} class={[inline ? 'text-sm text-ink-500' : 'py-8 text-center text-sm text-ink-500', extra]}>
  {text ?? t.loading}
</p>
