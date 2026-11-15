<script lang="ts">
  // The gate in front of every wallet screen.
  //
  // App.svelte puts the screen between its tags. For a route that needs a
  // wallet (needsWallet in lib/router.ts), the screen is drawn only while
  // the wallet's status is "ready". Otherwise a gate stands in its place,
  // at the same address, chosen by the status (SPEC section 3):
  //
  //   none        this browser has no practice wallet: open, restore or create
  //   unreadable  what is stored cannot be read: reload, or remove it
  //   newer       the page is out of date: reload
  //   broken      the self-test failed: use another browser
  //
  // So no wallet screen ever has to ask whether there is a wallet. A route
  // that needs none (Home, Create, Restore, About, the Sparrow page) is
  // always drawn: Home shows the same ways in itself (OpenWithPasskey,
  // StoredTrouble), in its own layout.

  import { tick, type Snippet } from 'svelte';
  import { focusHeading, router } from '../../lib/router.svelte.ts';
  import { needsWallet } from '../../lib/router.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import Page from '../Page.svelte';
  import NoWallet from './NoWallet.svelte';
  import StoredTrouble from './StoredTrouble.svelte';

  interface Props {
    /** The screen. */
    children: Snippet;
  }

  let { children }: Props = $props();

  const wallet = useWallet();

  let t = $derived(strings.wallet[router.lang]);

  /** The status whose gate stands in for the screen, or null when the screen itself shows. */
  let gate = $derived(needsWallet(router.route) && wallet.status !== 'ready' ? wallet.status : null);

  // A gate can come or go while the address stays: a wallet opened from the
  // gate, a wallet removed in another tab. The heading is then a new one,
  // and whatever had focus may be gone, so focus moves to the new heading,
  // as it does when the router changes the screen. When the address changed
  // too, the router has already seen to scroll and focus: nothing is done.
  let before = { gate: null as typeof gate, path: '' };
  let started = false;
  $effect(() => {
    const now = { gate, path: router.path };
    const swapped = started && now.gate !== before.gate && now.path === before.path;
    before = now;
    started = true;
    if (swapped) void tick().then(focusHeading);
  });
</script>

{#if gate === null}
  {@render children()}
{:else if gate === 'none'}
  <Page title={t.gateNoneTitle} titleName={t.gateNoneName}>
    <NoWallet />
  </Page>
{:else if gate === 'unreadable'}
  <Page title={t.unreadableTitle} titleName={t.unreadableName}>
    <StoredTrouble />
  </Page>
{:else if gate === 'newer'}
  <Page title={t.newerTitle} titleName={t.newerName}>
    <StoredTrouble />
  </Page>
{:else}
  <Page title={t.brokenTitle} titleName={t.brokenName}>
    <StoredTrouble />
  </Page>
{/if}
