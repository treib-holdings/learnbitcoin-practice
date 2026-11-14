<script lang="ts">
  // What goes into a transaction and what comes out of it: the inputs (the
  // coins it spends) and the outputs (the coins it makes), each with its
  // amount and its address.
  //
  // The piece marks what is this wallet's, and which output is the change
  // coming back. When the wallet spent coins and got no change, a line says
  // why there is none, because a payment without change looks like a
  // mistake until it is explained. A screen that knows the exact reason
  // (the reader chose "Send all") passes its own sentence as `noChange`.
  //
  // It takes a TxView, which is the shape of a transaction the network
  // knows (wallet.history, wallet.lookupTx) and also of a payment that is
  // signed and not sent yet (the review on the Send screen), so both look
  // the same. Put it under a heading of the screen's own; its two parts are
  // headed one level below (h3).

  import type { TxPart, TxView } from '@learnbitcoin/practice-wallet';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import Amount from '../Amount.svelte';
  import Badge from '../Badge.svelte';
  import Mono from '../Mono.svelte';
  import { lacksChange, partMark, partPlace } from './tx-text.ts';

  interface Props {
    view: TxView;
    /** Why there is no change, when the screen knows it exactly. Without it, a sentence that covers both causes. */
    noChange?: string;
    class?: string;
  }

  let { view, noChange, class: extra = '' }: Props = $props();

  let t = $derived(strings.wallet[router.lang]);
</script>

{#snippet side(title: string, note: string, parts: readonly TxPart[], which: 'input' | 'output')}
  <div>
    <h3 class="text-sm font-semibold uppercase tracking-widest text-ink-500">{title}</h3>
    <p class="mt-1 text-sm text-ink-500">{note}</p>
    <!-- role="list": Safari stops calling a list a list once its bullets are styled away. -->
    <ul role="list" class="mt-2 divide-y divide-ink-100 border-y border-ink-100">
      {#each parts as part, index (index)}
        {const mark = $derived(partMark(part, which))}
        {const place = $derived(partPlace(part, which))}
        <li
          data-testid={which === 'input' ? 'tx-input' : 'tx-output'}
          class="flex flex-col gap-1 py-2 sm:flex-row-reverse sm:items-baseline sm:justify-between sm:gap-4"
        >
          <p class="leading-snug sm:shrink-0"><Amount sats={part.value} /></p>
          <!-- What marks the part stands under its address: it says whose the address is. -->
          <div class="min-w-0">
            {#if part.address !== null}
              <Mono value={part.address} />
            {:else}
              <!-- A paragraph and not a span: a span would keep the taller lines of the text around it when it wraps. -->
              <p class="text-sm leading-snug text-ink-500">{place === 'new-coins' ? t.txNewCoins : t.txNoAddress}</p>
            {/if}
            {#if mark !== 'none'}
              <!-- The paragraph is as small as the mark, so that a mark that wraps keeps its two lines close. -->
              <p class="mt-0.5 text-xs leading-normal"><Badge tone="kind">{mark === 'change' ? t.txChange : t.txMine}</Badge></p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </div>
{/snippet}

<div data-testid="tx-parts" class={['space-y-6', extra]}>
  {@render side(t.txInputs, t.txInputsNote, view.inputs, 'input')}
  <div class="space-y-2">
    {@render side(t.txOutputs, t.txOutputsNote, view.outputs, 'output')}
    {#if lacksChange(view)}
      <p class="text-pretty text-sm leading-relaxed text-ink-600" data-testid="tx-no-change">{noChange ?? t.txNoChange}</p>
    {/if}
  </div>
</div>
