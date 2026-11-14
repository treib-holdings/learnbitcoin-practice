<script lang="ts">
  // The wallet's total: everything its coins add up to, confirmed or not,
  // in practice sats, with a line under it when part of it is still
  // unconfirmed.
  //
  // It reads the coins from the wallet itself. Until the first look at the
  // practice network has finished there is no total, and the piece draws
  // nothing: a total of 0 would say the wallet is empty when nobody knows
  // yet. The frame says "Looking up this wallet's coins..." meanwhile.

  import { fill } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import Amount from '../Amount.svelte';
  import { EYEBROW } from '../styles.ts';
  import { satsText } from './frame.ts';

  interface Props {
    class?: string;
  }

  let { class: extra = '' }: Props = $props();

  const wallet = useWallet();

  let lang = $derived(router.lang);
  let t = $derived(strings.wallet[lang]);
  /** What the last look at the network found. Null until the first one has finished. */
  let found = $derived(wallet.chain.state);
</script>

{#if found !== null}
  <div class={extra}>
    <p class={EYEBROW}>{t.total}</p>
    <p class="mt-1"><Amount sats={found.confirmed + found.unconfirmed} headline data-testid="total" /></p>
    {#if found.unconfirmed > 0n}
      <p class="mt-1 text-sm text-ink-500" data-testid="total-unconfirmed">
        {fill(t.totalUnconfirmed, { amount: satsText(found.unconfirmed, lang) })}
      </p>
    {/if}
  </div>
{/if}
