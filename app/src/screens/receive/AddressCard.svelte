<script lang="ts">
  // The address the wallet is paid at: as text beside its QR code, with a
  // copy button, the one line on what it is for, and where it sits in the
  // wallet.
  //
  // The address stays until the reader asks for another. Once coins have
  // arrived at it the card says so and offers "Show a new address", with the
  // one line on why: a wallet uses a fresh address for each payment, and the
  // old one still works. (faucet.ts says when else the button is offered.)
  // While a request to the faucet is under way the wallet holds the address,
  // and while a payment the faucet has promised is still on its way this
  // card does: the button is switched off and a line says what it waits for.
  //
  // The button stands under the address, a screen further down on a phone.
  // So when it brings a new address, the card brings the address on screen:
  // the reader sees what the tap changed.

  import { tick } from 'svelte';
  import Actions from '../../components/Actions.svelte';
  import Button from '../../components/Button.svelte';
  import Card from '../../components/Card.svelte';
  import CopyButton from '../../components/CopyButton.svelte';
  import Details from '../../components/Details.svelte';
  import Mono from '../../components/Mono.svelte';
  import Notice from '../../components/Notice.svelte';
  import QrCode from '../../components/QrCode.svelte';
  import { announce } from '../../components/status.svelte.ts';
  import { router } from '../../lib/router.svelte.ts';
  import type { ReceiveView } from '../../lib/wallet-api.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import { addressHeld, addressPath, arrivedText, offersNewAddress } from './faucet.ts';
  import { bringIntoView } from './view.ts';

  interface Props {
    /** The address on screen. */
    receive: ReceiveView;
  }

  let { receive }: Props = $props();

  const wallet = useWallet();

  let lang = $derived(router.lang);
  let t = $derived(strings.receive[lang]);

  /** What the address is held for: the faucet's answer, or a payment it has promised. Null: a new one may be shown. */
  let held = $derived(addressHeld(wallet.faucet));
  let offered = $derived(offersNewAddress(receive.arrived, wallet.faucet));

  /** The line that holds the address. It takes focus when the address changes under the reader's hand. */
  let line = $state<HTMLElement>();
  /** The address with its QR code, its copy button and its lines: what a new address changes. */
  let shown = $state<HTMLElement>();
  /** The address that "Show a new address" brought, while it is the one on screen. */
  let brought = $state<string | null>(null);

  async function next(): Promise<void> {
    const before = receive.address;
    wallet.newReceiveAddress();
    // The wallet's answer is the address it now shows. It keeps the old one
    // while a request to the faucet runs.
    const now = wallet.receive?.address;
    if (now === undefined || now === before) return;
    brought = now;
    announce(t.newAddressShown);
    // The button that was pressed belongs to the old address and is gone
    // with it. Focus goes to what changed: the address itself. The page
    // does not jump to it (the browser's own scroll would put it under the
    // banner): the address and its QR code are brought on screen together.
    await tick();
    line?.focus({ preventScroll: true });
    if (shown !== undefined) bringIntoView(shown);
  }
</script>

<Card title={t.addressTitle}>
  <!-- scroll-mt-16: when the page moves to show a new address, the card's heading comes with it. -->
  <div bind:this={shown} class="flex scroll-mt-16 flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
    <div class="w-40 shrink-0 sm:w-44">
      <QrCode text={receive.address} label={t.qrLabel} data-testid="receive-qr" />
    </div>
    <div class="min-w-0 flex-1 space-y-3">
      <!-- tabindex="-1": it takes focus from code only, never from the Tab key, so it shows no outline. -->
      <p bind:this={line} tabindex="-1" class="outline-none">
        <Mono value={receive.address} size="lead" data-testid="receive-address" />
      </p>
      <Actions tight>
        <CopyButton text={receive.address} label={t.copyAddress} said={t.addressCopied} data-testid="receive-copy" />
      </Actions>
      {#if brought === receive.address && !offered}
        <p class="text-sm font-semibold text-ink-800" data-testid="receive-new">{t.newAddressShown}</p>
      {/if}
      <p class="text-sm text-ink-600">{t.addressFor}</p>
    </div>
  </div>

  {#if offered}
    <Notice class="mt-5" data-testid="receive-offer">
      <div class="space-y-2">
        {#if receive.arrived > 0n}
          <p class="text-base font-semibold text-ink-800" data-testid="receive-arrived">
            {arrivedText(receive.arrived, lang)}
          </p>
        {/if}
        <p>{t.newAddressWhy}</p>
        <Actions tight>
          <Button
            variant="quiet"
            class="bg-white"
            disabled={held !== null}
            data-testid="new-address"
            onclick={() => void next()}
          >
            {t.newAddress}
          </Button>
        </Actions>
        {#if held !== null}
          <p data-testid="new-address-waits">{held === 'payment' ? t.newAddressWaitsPayment : t.newAddressWaits}</p>
        {/if}
      </div>
    </Notice>
  {/if}

  <Details class="mt-5" summary={t.pathSummary} data-testid="receive-where">
    <div class="space-y-2 text-ink-600">
      <p>{t.pathLead}</p>
      <p><Mono value={addressPath(receive.index)} data-testid="receive-path" /></p>
      <p>{t.pathNote}</p>
    </div>
  </Details>
</Card>
