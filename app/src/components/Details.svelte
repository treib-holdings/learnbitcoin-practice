<script lang="ts">
  // A part of the screen that stays folded until the reader opens it: the
  // browser's own <details>, so it works with no script and from the
  // keyboard. For what most readers do not need: the node's own words for a
  // refusal, a descriptor, how a fee is worked out.
  //
  // `summary` is the line that is always shown; `note` continues it in
  // lighter text. The words "Show" and "Hide" stand in for the arrow.

  import type { Snippet } from 'svelte';
  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';
  import { FOCUS } from './styles.ts';

  interface Props {
    summary: string;
    note?: string;
    /** Two-way: write bind:open to follow or set whether it is open. */
    open?: boolean;
    class?: string;
    children: Snippet;
    [key: `data-${string}`]: string | undefined;
  }

  let { summary, note, open = $bindable(false), class: extra = '', children, ...rest }: Props = $props();

  let t = $derived(strings.common[router.lang]);
</script>

<details {...rest} bind:open class={['group rounded-lg border border-ink-100 bg-ink-50', extra]}>
  <summary
    class={[
      'flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg px-4 py-3 text-sm text-ink-600 [&::-webkit-details-marker]:hidden',
      FOCUS,
    ]}
  >
    <span
      ><span class="font-semibold text-ink-800">{summary}</span>{#if note}{' '}{note}{/if}</span
    >
    <span class="ml-auto shrink-0 font-semibold text-orange-600 group-open:hidden">{t.show}</span>
    <span class="ml-auto hidden shrink-0 font-semibold text-ink-500 group-open:inline">{t.hide}</span>
  </summary>
  <div class="border-t border-ink-200 px-4 pb-4 pt-3 text-sm">{@render children()}</div>
</details>
