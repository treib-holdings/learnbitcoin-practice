<script lang="ts">
  // A list of the wallet's coins, one CoinRow each, with a rule between
  // rows. The Overview passes the first few, the Coins screen all of them.
  // For an empty list show the screen's own empty line (or NoCoins) instead.

  import type { Coin } from '@learnbitcoin/practice-wallet';
  import CoinRow from './CoinRow.svelte';

  interface Props {
    coins: readonly Coin[];
    class?: string;
  }

  let { coins, class: extra = '' }: Props = $props();
</script>

<!-- role="list": Safari stops calling a list a list once its bullets are styled away. -->
<ul role="list" class={['divide-y divide-ink-100 border-y border-ink-100', extra]}>
  {#each coins as coin (`${coin.txid}:${coin.vout}`)}
    <CoinRow {coin} />
  {/each}
</ul>
