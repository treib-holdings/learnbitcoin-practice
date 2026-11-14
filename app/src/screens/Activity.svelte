<script lang="ts">
  // The Activity screen: every transaction of this wallet, newest first.
  // Each row leads to the transaction's own screen.
  //
  // The list is read when the wallet's coins are known. If it cannot be
  // read, the list as it was last read stays, and the cause shows above it
  // with "Try again" (read/ActivityList.svelte). With no transactions the
  // screen says so in a line of its own, with the way to the faucet.

  import WalletFrame from '../components/wallet/WalletFrame.svelte';
  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';
  import ActivityList from './read/ActivityList.svelte';

  let t = $derived(strings.wallet[router.lang]);
  let c = $derived(strings.common[router.lang]);
</script>

<WalletFrame title={c.section_activity} lede={t.activityLede}>
  {#snippet children(known)}
    {#if known}
      <ActivityList faucet />
    {/if}
  {/snippet}
</WalletFrame>
