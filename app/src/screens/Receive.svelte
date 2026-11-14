<script lang="ts">
  // The Receive screen: an address to be paid at, and the faucet, which
  // pays practice coins to that address once Cloudflare's bot check has
  // passed.
  //
  // The address comes from the wallet (wallet.receive). There is none until
  // the first look at the practice network has finished: the wallet shows
  // an address nobody has paid yet, and cannot know which that is before
  // then. The wallet frame says that the coins are being looked up, or why
  // that failed; this screen adds that there is no address yet.
  //
  // The two parts are pieces of their own (screens/receive/): the address
  // with its QR code, and the faucet with the bot check.

  import WalletFrame from '../components/wallet/WalletFrame.svelte';
  import { router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import AddressCard from './receive/AddressCard.svelte';
  import FaucetCard from './receive/FaucetCard.svelte';

  const wallet = useWallet();

  let t = $derived(strings.receive[router.lang]);
  let c = $derived(strings.common[router.lang]);
</script>

<WalletFrame title={c.section_receive} lede={t.lede}>
  {#snippet children()}
    {#if wallet.receive === null}
      <p class="text-base leading-relaxed text-ink-600" data-testid="receive-no-address">{t.noAddressYet}</p>
    {:else}
      <AddressCard receive={wallet.receive} />
      <FaucetCard receive={wallet.receive} />
    {/if}
  {/snippet}
</WalletFrame>
