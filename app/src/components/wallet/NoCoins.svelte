<script lang="ts">
  // What a wallet screen shows when the coins are known and there are none,
  // with the way to get some: a link to the faucet, which is a part of the
  // Receive screen further down than the address (frame.ts, faucetLink).
  // (Coins and Activity have empty lines of their own, with the same link.)
  //
  // It says "No coins yet." of a wallet that has never been used, and "No
  // coins left." of one that has: a reader who has just sent their last coin
  // must not be told that none have come yet. The wallet's own record of
  // its addresses says which it is: an address that has ever been paid is
  // marked as used for good, whatever became of the coins. The list of
  // transactions says the same where a screen has it.

  import { router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import Button from '../Button.svelte';
  import Empty from '../Empty.svelte';
  import { faucetLink } from './frame.ts';

  interface Props {
    class?: string;
    [key: `data-${string}`]: string | undefined;
  }

  let { class: extra = '', ...rest }: Props = $props();

  const wallet = useWallet();

  let t = $derived(strings.wallet[router.lang]);

  /** True for a wallet that has held coins before: some address of it was paid, or a transaction of it is listed. */
  let used = $derived.by(() => {
    const state = wallet.chain.state;
    const paid = state !== null && (state.receive.some((address) => address.used) || state.change.some((address) => address.used));
    return paid || (wallet.history?.length ?? 0) > 0;
  });
</script>

<Empty {...rest} text={used ? t.noCoinsLeft : t.noCoins} class={extra}>
  <Button variant="primary" small href={faucetLink(router.link({ name: 'receive' }))}>{t.getCoins}</Button>
</Empty>
