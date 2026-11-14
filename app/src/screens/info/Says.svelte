<script lang="ts">
  // A sentence of the Sparrow page with what must stay whole kept whole
  // (info/says.ts says what and why):
  //
  //   - the menu arrow "->" never splits at the end of a line;
  //   - a slot's value (the flag, the derivation path) is set as code, on
  //     one line, and a translating browser leaves it alone;
  //   - a label of Sparrow's, written between backticks in the table, is
  //     set in bold and marked as English that is not translated, so a
  //     screen reader says it as English on the Spanish page too.
  //
  // It draws text and nothing around it: put it inside a <p> or an <li>.
  //
  // The markup below is one line on purpose. A line break between two of
  // its parts would reach the page as a space in the middle of a sentence.

  import { ARROW, sentenceParts } from './says.ts';

  interface Props {
    /** The sentence, from the string tables. */
    text: string;
    /** A value for each slot of the sentence. */
    slots?: Record<string, string>;
  }

  let { text, slots = {} }: Props = $props();

  let parts = $derived(sentenceParts(text, slots));
</script>

{#each parts as part, at (at)}{#if part.kind === 'arrow'}<span class="whitespace-nowrap">{ARROW}</span>{:else if part.kind === 'value'}<code translate="no" class="whitespace-nowrap">{part.text}</code>{:else if part.kind === 'label'}<strong translate="no" lang="en">{#each part.bits as bit, index (index)}{#if bit.kind === 'arrow'}<span class="whitespace-nowrap">{ARROW}</span>{:else}{bit.text}{/if}{/each}</strong>{:else}{part.text}{/if}{/each}
