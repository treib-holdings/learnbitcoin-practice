<script lang="ts">
  // A boxed message, in three kinds. All three stay inside orange and ink:
  // the app has no red.
  //
  //   info     something worth knowing: a state line, a slow network
  //   caution  something to heed before going on: practice words only, a browser can erase them
  //   problem  something went wrong: the cause in bold, then the way out
  //
  // A problem takes a sentence from strings/errors.ts as `text`, and sets its
  // first sentence (the cause) in bold. It is announced at once
  // (role="alert") because it answers something the reader just did; pass
  // `silent` for a problem that is already there when the screen opens.
  // Anything inside the tags comes after the text: a details line, a button.
  // Pass something between the tags only when it draws something: content
  // that turns out empty still takes the gap that is kept for it.
  //
  // A word too long for the box (a host name in a sentence, on the
  // narrowest phone) is broken where the line ends: it never sticks out.

  import type { Snippet } from 'svelte';
  import { EYEBROW } from './styles.ts';
  import { splitLead } from './text.ts';

  interface Props {
    kind?: 'info' | 'caution' | 'problem';
    /** A short line above the text, in small capitals. */
    label?: string;
    /** The message. For a problem: the cause first, then the way out. */
    text?: string;
    /** A problem that is not announced when it appears. */
    silent?: boolean;
    class?: string;
    children?: Snippet;
    [key: `data-${string}`]: string | undefined;
  }

  let { kind = 'info', label, text, silent = false, class: extra = '', children, ...rest }: Props = $props();

  const BOX = {
    info: 'rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-pretty break-words text-ink-700',
    caution:
      'rounded-lg border border-l-4 border-orange-200 border-l-orange-400 bg-orange-50 px-4 py-3 text-base text-pretty break-words text-ink-700',
    problem:
      'rounded-lg border border-l-4 border-ink-200 border-l-ink-800 bg-ink-50 px-4 py-3 text-base text-pretty break-words text-ink-700',
  } as const;

  let parts = $derived(text === undefined ? null : splitLead(text));
</script>

<div {...rest} role={kind === 'problem' && !silent ? 'alert' : undefined} class={[BOX[kind], extra]}>
  {#if label}
    <p class={['mb-1', kind === 'problem' ? 'text-xs font-semibold uppercase tracking-widest text-ink-500' : EYEBROW]}>
      {label}
    </p>
  {/if}
  {#if parts !== null}
    {#if kind === 'problem'}
      <p class="font-semibold text-ink-800">{parts.lead}</p>
      {#if parts.rest !== ''}<p class="mt-1 text-ink-600">{parts.rest}</p>{/if}
    {:else}
      <p>{text}</p>
    {/if}
  {/if}
  {#if children}
    <div class={parts !== null ? 'mt-2' : ''}>{@render children()}</div>
  {/if}
</div>
