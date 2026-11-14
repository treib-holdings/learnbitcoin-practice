<script lang="ts">
  // The 12 words, shown: on the Backup screen, and at the "Wallet made" step
  // straight after a wallet is created.
  //
  // An ordered list, so each word has its number and a screen reader says
  // which it is. The list is marked as English and as not to be translated:
  // a translating browser would otherwise turn "abandon" into another word,
  // and the copy on paper would open nothing. On a Spanish screen a line
  // under it says the words are English on purpose.
  //
  // There is no control to copy or download the words, and there must never
  // be one: they are written on paper by hand. On paper the list itself is
  // left out (the print rule in app.css), so a printout carries the blank
  // card and never the words.
  //
  // Get the words from wallet.revealWords() at the moment they are shown,
  // and keep them out of anything that outlives the screen.

  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';

  interface Props {
    /** The words, in order. */
    words: readonly string[];
    class?: string;
    [key: `data-${string}`]: string | undefined;
  }

  let { words, class: extra = '', ...rest }: Props = $props();

  let lang = $derived(router.lang);
  let t = $derived(strings.wallet[lang]);

  // SPEC section 12 asks the same of the words when they are shown as of
  // the fields they are typed into. Nobody types into a list, so most of
  // these do nothing here. They are set all the same, so that the list and
  // the fields say one thing to a browser and to any tool that reads the
  // page: these words are not to be corrected, completed or remembered.
  const AS_SEED_WORDS = {
    spellcheck: 'false',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'none',
  } as const;
</script>

<div {...rest} data-print="never" class={extra}>
  <!-- The numbers are the list's own markers, so an item's text is the word
       and nothing else. As many columns as fit with the longest word whole:
       two on a phone, then three, then four. -->
  <ol
    {...AS_SEED_WORDS}
    lang="en"
    translate="no"
    class="grid list-decimal grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-x-4 gap-y-2 font-mono text-base text-ink-800 marker:font-sans marker:text-xs marker:text-ink-500 sm:grid-cols-3 md:grid-cols-4"
  >
    {#each words as word}
      <li data-testid="word" class="ml-7 pl-1">{word}</li>
    {/each}
  </ol>
  {#if lang === 'es'}
    <p class="mt-3 text-pretty text-sm leading-relaxed text-ink-500">{t.wordsEnglishCopy}</p>
  {/if}
</div>
