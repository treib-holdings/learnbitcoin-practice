<script lang="ts">
  // "What just happened": a transaction that touches this wallet, read out
  // in three to five plain sentences. Always in the same order: what was
  // spent, what went where, the change, the fee, and where the transaction
  // stands.
  //
  // The table of inputs and outputs under it shows the transaction as it
  // is. This says what that means for this wallet, with the transaction's
  // own figures: the coin that was used up whole, the change that came back
  // as a new coin, the fee as what went in less what came out. Here the
  // figures are those of the reader's own payment.
  //
  // Every sentence is worked out from the transaction and from nothing
  // else (lib/doit/explain.ts, read/explained.ts): nothing is fetched and
  // nothing is guessed. Of an output that is not this wallet's it says only
  // that it is not: a wallet knows its own change, and can only guess at
  // someone else's.
  //
  // Under the sentences, the words a newcomer meets in them link to the
  // main site's glossary, in the page's language.
  //
  // For a transaction that does not touch this wallet the piece draws
  // nothing: there is nothing to say about it from here.

  import type { TxView } from '@learnbitcoin/practice-wallet';
  import Section from '../../components/Section.svelte';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import GlossaryLinks from '../doit/GlossaryLinks.svelte';
  import Sentence from '../doit/Sentence.svelte';
  import { ADDRESS_SLOTS, explained, explainedTerms } from './explained.ts';

  interface Props {
    /** The transaction, as the wallet's list or a look at the network gave it. */
    view: TxView;
  }

  let { view }: Props = $props();

  let lang = $derived(router.lang);
  let t = $derived(strings.doit[lang]);

  let sentences = $derived(explained(view, lang));
  let terms = $derived(explainedTerms(view));
</script>

{#if sentences.length > 0}
  <Section title={t.explainTitle}>
    <div class="space-y-3 text-pretty leading-relaxed text-ink-700" data-testid="tx-explained">
      {#each sentences as said (said.key)}
        <p data-sentence={said.key}><Sentence text={said.text} slots={said.slots} mono={ADDRESS_SLOTS} /></p>
      {/each}
    </div>
    <GlossaryLinks {terms} data-testid="tx-explained-glossary" />
  </Section>
{/if}
