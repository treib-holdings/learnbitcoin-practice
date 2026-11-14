<script lang="ts">
  // One coin of the wallet, as a row of a CoinList: what it holds, whether
  // it is still unconfirmed, whether it is change, the address it sits on,
  // and a link to the transaction that made it. A coin is one unspent
  // output of a transaction, which is why it can name the transaction it
  // came from.

  import type { Coin } from '@learnbitcoin/practice-wallet';
  import { shortId } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import Amount from '../Amount.svelte';
  import Badge from '../Badge.svelte';
  import Mono from '../Mono.svelte';
  import { TAP } from '../styles.ts';
  import TextLink from '../TextLink.svelte';

  interface Props {
    coin: Coin;
  }

  let { coin }: Props = $props();

  let t = $derived(strings.wallet[router.lang]);
  let c = $derived(strings.common[router.lang]);
</script>

<!-- On a phone the amount comes first and the address under it. On a wider
     screen they share a line, with the amount at the right edge, so that the
     amounts of a list stand in a column, and what marks a coin to its left. -->
<li
  data-testid="coin"
  class="flex flex-col gap-1 py-3 sm:flex-row-reverse sm:items-baseline sm:justify-between sm:gap-4"
>
  <p class="flex flex-wrap items-baseline gap-x-3 gap-y-1 leading-snug sm:shrink-0 sm:flex-row-reverse">
    <Amount sats={coin.value} />
    {#if !coin.status.confirmed}<Badge tone="fact">{c.unconfirmed}</Badge>{/if}
    {#if coin.chain === 1}<Badge tone="kind">{t.coinChange}</Badge>{/if}
  </p>
  <div class="min-w-0">
    <Mono value={coin.address} size="small" />
    <p class="text-xs">
      <!-- TAP: the one way from a coin to its transaction, and a line of small text is hard to hit with a thumb. -->
      <TextLink href={router.link({ name: 'tx', txid: coin.txid })} class={`${TAP} inline-block`}
        >{t.coinTransaction} <span translate="no" class="font-mono">{shortId(coin.txid)}</span></TextLink
      >
    </p>
  </div>
</li>
