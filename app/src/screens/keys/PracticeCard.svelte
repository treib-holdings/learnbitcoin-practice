<script lang="ts">
  // The practice card: a blank form to print and fill in by hand.
  //
  // It has the PRACTICE stamp, twelve numbered lines, the short form of the
  // exception paragraph and the line that says where these words restore.
  // It never holds a word: the reader writes them. A printout of the words
  // themselves would be one more copy to keep safe, and it would pass
  // through a printer's memory on the way.
  //
  // The card is marked data-print="only". The print rules at the end of
  // app.css then leave everything else on the page out of a printout, so
  // what comes out of the printer is the card alone, whether the 12 words
  // are showing on screen at that moment or not.
  //
  // On screen the card is a small picture of what will print. The twelve
  // empty lines say nothing to a screen reader, so they are hidden from
  // it; the sentence above the card says what the card is.

  import Badge from '../../components/Badge.svelte';
  import Button from '../../components/Button.svelte';
  import Section from '../../components/Section.svelte';
  import { WORD_COUNT } from '../../components/wallet/words.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import { isRepeatTap } from './taps.ts';

  let lang = $derived(router.lang);
  let t = $derived(strings.backup[lang]);
  let c = $derived(strings.common[lang]);
  let w = $derived(strings.wallet[lang]);

  /** The numbers of the card's lines: 1 to 12. */
  const LINES = Array.from({ length: WORD_COUNT }, (_, index) => index + 1);
</script>

<Section title={t.cardTitle}>
  <p class="text-pretty leading-relaxed text-ink-700">{t.cardLead}</p>

  <!-- The lines run across, 1 and 2 on the first row, as the words on
       screen do. On a phone both are two columns wide and stand on one
       screen: were the card numbered down its columns, a reader copying
       by place would write the words in the wrong order. -->
  <div
    data-print="only"
    data-testid="practice-card"
    class="max-w-md rounded-lg border-2 border-dashed border-ink-300 bg-white p-5 print:max-w-lg print:border-solid print:border-ink-900"
  >
    <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <p class="text-base font-semibold leading-snug text-ink-800 print:text-ink-900">{t.cardName}</p>
      <Badge tone="stamp">{c.markerBadge}</Badge>
    </div>
    <ol aria-hidden="true" class="mt-5 grid grid-cols-2 gap-x-6 gap-y-3">
      {#each LINES as number (number)}
        <li class="flex items-end gap-2">
          <span class="w-6 shrink-0 text-right font-mono text-sm leading-none text-ink-500 print:text-ink-900">{number}.</span>
          <span class="h-7 flex-1 border-b border-ink-400 print:h-9 print:border-ink-900"></span>
        </li>
      {/each}
    </ol>
    <p class="mt-5 text-pretty text-sm leading-snug text-ink-700 print:text-ink-900">{w.wordsException}</p>
    <p class="mt-2 text-sm font-semibold leading-snug text-ink-800 print:text-ink-900">{t.cardRestores}</p>
  </div>

  <div>
    <!-- One print for a double tap: its second click is not taken. -->
    <Button
      data-testid="print-card"
      onclick={(event) => {
        if (!isRepeatTap(event)) window.print();
      }}
    >
      {t.cardPrint}
    </Button>
  </div>
</Section>
