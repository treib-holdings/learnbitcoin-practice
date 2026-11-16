<script lang="ts">
  // A line of links to the main site's glossary, for the words a newcomer
  // meets where they stand: under a part of the first step, and under
  // "What just happened" on the transaction screen.
  //
  // Each link leads to the entry in the page's language, through the map
  // the read screens keep (read/read.ts), where every entry was looked up
  // in the site's content in both languages. One entry exists in English
  // only, the faucet's: a Spanish page links that one, says so in the
  // link's words, and marks the link as English, as the main site does.
  //
  // The links stand in a line of their own, and not inside the sentences:
  // a link that leaves the site carries a small arrow, and in the middle
  // of a sentence that arrow can be left alone at the start of a line.

  import OutLink from '../../components/OutLink.svelte';
  import { router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import { faucetGlossaryUrl, glossaryUrl } from '../read/read.ts';
  import { termKey, type Term } from './view.ts';

  interface Props {
    /** The entries to link, in the order the text names them. */
    terms: readonly Term[];
    class?: string;
    [key: `data-${string}`]: string | undefined;
  }

  let { terms, class: extra = '', ...rest }: Props = $props();

  const wallet = useWallet();

  let lang = $derived(router.lang);
  let t = $derived(strings.doit[lang]);

  let links = $derived(
    terms.map((term) => ({
      term,
      text: t[termKey(term)],
      href: term === 'faucet' ? faucetGlossaryUrl(wallet.config.siteUrl) : glossaryUrl(wallet.config.siteUrl, lang, term),
      // The faucet's entry is English in every language.
      english: term === 'faucet' && lang !== 'en',
    })),
  );
</script>

{#if links.length > 0}
  <div {...rest} class={['text-sm text-ink-600', extra]}>
    <p>{t.glossaryLine}</p>
    <!-- Each link is a line a thumb can take: the rows are 44 px apart where the links wrap. -->
    <ul class="flex flex-wrap gap-x-5">
      {#each links as link (link.term)}
        <li class="flex min-h-11 items-center">
          <OutLink href={link.href} hreflang={link.english ? 'en' : undefined} text={link.text} data-term={link.term} />
        </li>
      {/each}
    </ul>
  </div>
{/if}
