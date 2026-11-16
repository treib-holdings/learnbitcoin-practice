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
  //
  // Steps can be played on what shows, once it is drawn (play.ts): after
  // "#frame:" on the sample screen, and after "#play:" on the app's own
  // screen, on any route. So a state that only shows after a tap (a review,
  // the unlock step after a refused passkey, an open question) can be
  // looked at and photographed with the gallery tool.

  import { untrack } from 'svelte';
  import App from '../src/App.svelte';
  import Shell from '../src/components/Shell.svelte';
  import { setDoit, type Doit } from '../src/lib/doit/doit-context.ts';
  import WalletGate from '../src/components/wallet/WalletGate.svelte';
  import { router } from '../src/lib/router.svelte.ts';
  import { needsWallet } from '../src/lib/router.ts';
  import { setWallet } from '../src/lib/wallet-context.ts';
  import FrameDemo from './FrameDemo.svelte';
  import Gates from './Gates.svelte';
  import Index from './Index.svelte';
  import { frameDemo, galleryPage, playSteps } from './pages.ts';
  import Pieces from './Pieces.svelte';
  import { parseSteps, play } from './play.ts';
  import type { StandIn } from './stand-in.svelte.ts';
  import UnlockStates from './UnlockStates.svelte';
  import WalletPieces from './WalletPieces.svelte';

  let { wallet: given, preset, doit: steps }: { wallet: StandIn; preset: string; doit: Doit } = $props();

  // The gallery's own pages use pieces that ask for the wallet, as screens do.
  const wallet = untrack(() => given);
  setWallet(wallet);

  // And the shell around them asks for the "Do it" steps, for its strip.
  const doit = untrack(() => steps);
  setDoit(doit);

  let page = $derived(galleryPage(router.path));

  // Read once, when the page loads: the sample screen then stays while the
  // reader moves between the wallet's sections.
  const demo = frameDemo(location.hash);

  /** The steps to play on the app's own screen, read once as well. */
  const onApp = playSteps(location.hash);

  /** Plays the taps the address asks for, on whatever shows: the sample screen, or the gate in front of it. */
  function played(node: HTMLElement): void {
    const steps = parseSteps(demo ?? '');
    if (steps.length > 0) void play(node, steps);
  }

  /** The same, on the app itself. */
  function playedOnApp(node: HTMLElement): void {
    const steps = parseSteps(onApp ?? '');
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
{:else if onApp !== null}
  <!-- The app, with the steps the address asks for played on it once it is drawn. -->
  <div {@attach playedOnApp}>
    <App {wallet} {doit} />
  </div>
{:else}
  <App {wallet} {doit} />
{/if}
