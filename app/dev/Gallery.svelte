<script lang="ts">
  // The root of the development gallery. It shows one of the gallery's own
  // pages (the index, the pieces, the gates, the unlock step, the wallet's
  // pieces) inside the app's shell, or else mounts the app itself, the very
  // component main.ts mounts, with the stand-in wallet.
  //
  // One more thing it can show: on a wallet route whose address ends in
  // "#frame", a sample screen inside the wallet frame, where the real
  // screen would be (FrameDemo.svelte). The gate stands in front of it as
  // it does in the app.

  import { untrack } from 'svelte';
  import App from '../src/App.svelte';
  import Shell from '../src/components/Shell.svelte';
  import WalletGate from '../src/components/wallet/WalletGate.svelte';
  import { router } from '../src/lib/router.svelte.ts';
  import { needsWallet } from '../src/lib/router.ts';
  import { setWallet } from '../src/lib/wallet-context.ts';
  import FrameDemo from './FrameDemo.svelte';
  import Gates from './Gates.svelte';
  import Index from './Index.svelte';
  import { frameDemo, galleryPage } from './pages.ts';
  import Pieces from './Pieces.svelte';
  import { parseSteps, play } from './play.ts';
  import type { StandIn } from './stand-in.svelte.ts';
  import UnlockStates from './UnlockStates.svelte';
  import WalletPieces from './WalletPieces.svelte';

  let { wallet: given, preset }: { wallet: StandIn; preset: string } = $props();

  // The gallery's own pages use pieces that ask for the wallet, as screens do.
  const wallet = untrack(() => given);
  setWallet(wallet);

  let page = $derived(galleryPage(router.path));

  // Read once, when the page loads: the sample screen then stays while the
  // reader moves between the wallet's sections.
  const demo = frameDemo(location.hash);

  /** Plays the taps the address asks for, on whatever shows: the sample screen, or the gate in front of it. */
  function played(node: HTMLElement): void {
    const steps = parseSteps(demo ?? '');
    if (steps.length > 0) void play(node, steps);
  }
</script>

{#if page === 'index'}
  <Shell><Index {preset} /></Shell>
{:else if page === 'pieces'}
  <Shell><Pieces /></Shell>
{:else if page === 'gates'}
  <Shell><Gates /></Shell>
{:else if page === 'unlock'}
  <Shell><UnlockStates /></Shell>
{:else if page === 'wallet'}
  <Shell><WalletPieces /></Shell>
{:else if demo !== null && needsWallet(router.route)}
  <div {@attach played}>
    <!-- As App.svelte does: main is busy while the first look at the coins runs. -->
    <Shell busy={wallet.chain.scanning && wallet.chain.state === null}>
      <WalletGate>
        <FrameDemo />
      </WalletGate>
    </Shell>
  </div>
{:else}
  <App {wallet} />
{/if}
