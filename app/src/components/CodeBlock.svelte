<script lang="ts">
  // A command or another line a reader types or pastes somewhere else: how
  // to start Sparrow in Regtest mode, a descriptor. Dark, monospace, never
  // translated.
  //
  // A long line scrolls sideways inside the block (the one place the app
  // scrolls sideways). The block then takes keyboard focus, so that it can
  // be scrolled with the arrow keys, and `label` names it for a screen
  // reader. That suits a line nobody types by hand.
  //
  // With `wrap` the line breaks at its spaces instead, as late as it can,
  // and all of it shows on the narrowest phone: for a command that a reader
  // may type on the computer beside this page. A block that wraps never
  // scrolls, so it takes no focus and is no region of the page: it would be
  // a Tab stop that does nothing. A single word that is longer than the
  // line (a long path) is broken where the line ends, so that it never
  // sticks out of the block and drags the page sideways.

  import { FOCUS } from './styles.ts';

  interface Props {
    text: string;
    /** What a screen reader calls the block, where it scrolls. */
    label: string;
    /** Break the line at its spaces instead of scrolling sideways. */
    wrap?: boolean;
    class?: string;
    [key: `data-${string}`]: string | undefined;
  }

  let { text, label, wrap = false, class: extra = '', ...rest }: Props = $props();

  const LOOK = 'rounded-md bg-[#24292e] p-4 font-mono text-sm leading-[1.6] text-[#e1e4e8]';
  /** A line that scrolls inside its block, and does not drag the page with it at either end. */
  const SCROLLS = 'overflow-x-auto overscroll-x-contain';
  /**
   * A line that breaks where it must, at the last space that fits. The
   * second name matters: text inside <main> is set to avoid a last line of
   * one word, and to get two words onto the last line a browser will break
   * "-n regtest" after its hyphen. A command is no paragraph: it breaks as
   * late as it can, and a last line of one word is fine. The third breaks
   * a word only when the word alone is longer than a line.
   */
  const WRAPS = 'whitespace-pre-wrap text-wrap [overflow-wrap:anywhere]';
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<pre
  {...rest}
  tabindex={wrap ? undefined : 0}
  role={wrap ? undefined : 'region'}
  aria-label={wrap ? undefined : label}
  translate="no"
  class={[LOOK, wrap ? WRAPS : SCROLLS, !wrap && FOCUS, extra]}><code>{text}</code></pre>
