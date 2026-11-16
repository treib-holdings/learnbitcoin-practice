<script lang="ts">
  // A sentence from the string tables in which an address or a wallet
  // fingerprint stands: the words as words, and the value set apart, in
  // the monospace font, so that it can be compared character by character,
  // breaks wherever the line ends and is left alone by a translating
  // browser (bits.ts says how the sentence is cut).
  //
  // The value runs on with the words around it. The shared piece for such
  // values (Mono) is a box of its own, which is right for a value that
  // stands alone in a row; in the middle of a sentence a box goes to a new
  // line whole, and leaves the comma that follows it alone at the start of
  // the next one.
  //
  // It draws text and nothing around it: put it inside a <p>.
  //
  // The markup below is one line on purpose. A line break between two of
  // its parts would reach the page as a space in the middle of a sentence.

  import { sentenceBits } from './bits.ts';

  interface Props {
    /** The sentence, from the string tables. */
    text: string;
    /** A value for each slot of the sentence. */
    slots: Readonly<Record<string, string>>;
    /** The slots whose values are drawn apart: an address, a wallet fingerprint. */
    mono: readonly string[];
  }

  let { text, slots, mono }: Props = $props();

  let bits = $derived(sentenceBits(text, slots, mono));
</script>

{#each bits as bit, at (at)}{#if bit.kind === 'mono'}<span translate="no" class="font-mono text-[0.875em] text-ink-800 [overflow-wrap:anywhere]">{bit.text}</span>{:else}{bit.text}{/if}{/each}
