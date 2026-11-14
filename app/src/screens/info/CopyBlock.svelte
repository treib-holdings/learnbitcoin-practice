<script lang="ts">
  // A line to type or paste somewhere else, with a button that copies it:
  // a command that starts Sparrow, a wallet's descriptor.
  //
  // The line is a CodeBlock. Its name stands above it, with a note under
  // the name where one is given (where the line comes from), so a reader
  // knows what the line is worth before copying it. The button under the
  // line copies exactly the line that is shown.
  //
  // A CodeBlock scrolls sideways when its line is longer than the screen is
  // wide. That suits a descriptor, which nobody types by hand. A command is
  // different: a reader may have this page open on a phone and type the
  // command on the computer beside it, and on a small phone the end of the
  // line, where the flag is, would be out of sight. With `wrap` the line
  // breaks at a space instead, and all of it shows.
  //
  // The name, the line and the button are one group, named by the name
  // above the line. Three commands stand one after another on the Sparrow
  // page, each with a button that says "Copy command": a screen reader says
  // the group's name on the way in, so each button is heard with the system
  // it belongs to.
  //
  // `hook` names the two test hooks: the line is "<hook>-text" and the
  // button "<hook>-copy".

  import CodeBlock from '../../components/CodeBlock.svelte';
  import CopyButton from '../../components/CopyButton.svelte';

  interface Props {
    /** What the line is. Shown above it, and the name a screen reader gives the block. */
    label: string;
    /** The line: what is shown and what is copied. */
    text: string;
    /** The button's words. */
    copyLabel: string;
    /** What the status region says once the line is copied. */
    said: string;
    /** A line of small print under the name. */
    note?: string;
    /** Break a long line at its spaces, so that all of it shows on a narrow screen. For a line that is typed by hand. */
    wrap?: boolean;
    hook: string;
  }

  let { label, text, copyLabel, said, note, wrap = false, hook }: Props = $props();

  /** Ties the group to its name. */
  const id = $props.id();

  /**
   * A line that breaks where it must, at the last space that fits. The
   * second name matters: text inside <main> is set to avoid a last line of
   * one word, and to get two words onto the last line a browser will break
   * "-n regtest" after its hyphen. A command is no paragraph: it breaks as
   * late as it can, and a last line of one word is fine.
   */
  const WRAP = 'whitespace-pre-wrap text-wrap';
</script>

<div role="group" aria-labelledby="{id}-name" class="space-y-2">
  <div>
    <p id="{id}-name" class="text-pretty text-sm font-semibold text-ink-800">{label}</p>
    {#if note}
      <p class="text-pretty text-sm text-ink-500">{note}</p>
    {/if}
  </div>
  <CodeBlock {text} {label} class={wrap ? WRAP : ''} data-testid={`${hook}-text`} />
  <!-- A box of its own for the button: if the browser refuses to copy, the
       button's line about that is drawn under it, inside this box. -->
  <div>
    <CopyButton {text} label={copyLabel} {said} data-testid={`${hook}-copy`} />
  </div>
</div>
