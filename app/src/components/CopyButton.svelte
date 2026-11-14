<script lang="ts">
  // Copies a text (an address, an ID, a command) and says so: the button
  // reads "Copied" for a moment and the status region tells a screen reader.
  //
  // If the browser refuses (some browsers inside other apps do), a line
  // under the button says so, and says to copy by hand; the status region
  // says the same. Without that line a reader who sees the page would be
  // told nothing, and would paste whatever was copied before. The line
  // stays until the next try.
  //
  // The button keeps one width whichever word it shows. Were it to shrink
  // around "Copied", the button beside it would slide under the finger that
  // has just tapped.
  //
  // Never offer it for the 12 words: they are written on paper, not copied.

  import { onDestroy } from 'svelte';
  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';
  import Button from './Button.svelte';
  import { announce } from './status.svelte.ts';

  interface Props {
    /** What goes to the clipboard. */
    text: string;
    /** The button's word, when "Copy" alone is not clear enough: "Copy address". */
    label?: string;
    /** What the status region says afterwards, when "Copied" alone is not clear enough: "Address copied". */
    said?: string;
    class?: string;
    [key: `data-${string}`]: string | undefined;
  }

  let { text, label, said, class: extra = '', ...rest }: Props = $props();

  let t = $derived(strings.common[router.lang]);

  /** How long the button says "Copied", in milliseconds. */
  const SHOWN_FOR = 2000;

  let copied = $state(false);
  /** The browser refused the last try. */
  let failed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The button has left the screen. */
  let gone = false;

  async function copy(): Promise<void> {
    failed = false;
    let refused = false;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No permission, or no clipboard at all (an old browser, a page not served over HTTPS).
      refused = true;
    }
    // The button left the screen while the browser answered: there is nobody
    // here to tell, and the status region now speaks for another screen.
    if (gone) return;
    clearTimeout(timer);
    if (refused) {
      copied = false;
      failed = true;
      announce(t.copyFailed);
      return;
    }
    announce(said ?? t.copied);
    copied = true;
    timer = setTimeout(() => (copied = false), SHOWN_FOR);
  }

  // The timer must not outlive the button.
  onDestroy(() => {
    gone = true;
    clearTimeout(timer);
  });

  /**
   * Holds the width open. Each of the button's two words is laid into it a
   * second time, unseen and without height (its ::before and ::after, which
   * take their text from the two data attributes), so it is always as wide
   * as the wider word, whichever one shows. The page's text holds only the
   * word that shows.
   */
  const WIDEST =
    'block before:invisible before:block before:h-0 before:overflow-hidden before:content-[attr(data-own)] after:invisible after:block after:h-0 after:overflow-hidden after:content-[attr(data-copied)]';
</script>

<Button {...rest} variant="quiet" class={extra} onclick={() => void copy()}>
  <span class={WIDEST} data-own={label ?? t.copy} data-copied={t.copied}>{copied ? t.copied : (label ?? t.copy)}</span>
</Button>
{#if failed}
  <!-- In a row of buttons it takes a line of its own, after the last of
       them (order-last, basis-full), so no button moves. Anywhere else it is
       a line under the button. The status region has said it already, so it
       is not announced a second time from here. -->
  <span data-testid="copy-failed" class="order-last block basis-full text-pretty text-sm font-semibold leading-relaxed text-ink-800">
    {t.copyFailed}
  </span>
{/if}
