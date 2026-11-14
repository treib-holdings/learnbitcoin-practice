<script lang="ts">
  // The app: the shell, and inside it the screen the address asks for.
  //
  // A screen that shows a wallet is drawn only when this browser has one it
  // can use. Otherwise the gate stands in its place (WalletGate): no wallet
  // here, a stored wallet that cannot be read, a page that is out of date,
  // or a browser that failed the self-test.
  //
  // The wallet arrives as a prop and is put in Svelte's context here, once.
  // Every screen and piece then reaches it with useWallet()
  // (lib/wallet-context.ts) and sees only the WalletApi interface. main.ts
  // hands in the real wallet; the development gallery (app/dev) hands in a
  // scripted stand-in and mounts this same component.

  import { onDestroy, untrack, type Component } from 'svelte';
  import Shell from './components/Shell.svelte';
  import WalletGate from './components/wallet/WalletGate.svelte';
  import { trackPage } from './lib/events.ts';
  import { router } from './lib/router.svelte.ts';
  import type { Route } from './lib/router.ts';
  import type { WalletApi } from './lib/wallet-api.ts';
  import { setWallet } from './lib/wallet-context.ts';
  import About from './screens/About.svelte';
  import Activity from './screens/Activity.svelte';
  import Backup from './screens/Backup.svelte';
  import Coins from './screens/Coins.svelte';
  import Home from './screens/Home.svelte';
  import New from './screens/New.svelte';
  import NotFound from './screens/NotFound.svelte';
  import Overview from './screens/Overview.svelte';
  import Receive from './screens/Receive.svelte';
  import Restore from './screens/Restore.svelte';
  import Send from './screens/Send.svelte';
  import Settings from './screens/Settings.svelte';
  import Sparrow from './screens/Sparrow.svelte';
  import Tx from './screens/Tx.svelte';

  let { wallet: given }: { wallet: WalletApi } = $props();

  // One wallet for the life of the page: the object never changes, only its
  // properties do. So it is read once, here, and put in the context.
  const wallet = untrack(() => given);
  setWallet(wallet);

  /**
   * The screen of every route. The compiler holds this table to the list of
   * routes: a route without a screen does not build.
   */
  const SCREENS: Record<Route['name'], Component> = {
    home: Home,
    new: New,
    restore: Restore,
    sparrow: Sparrow,
    about: About,
    wallet: Overview,
    coins: Coins,
    receive: Receive,
    send: Send,
    activity: Activity,
    tx: Tx,
    backup: Backup,
    settings: Settings,
    'not-found': NotFound,
  };

  // Follows the address by itself: router.route is reactive.
  let Screen = $derived(SCREENS[router.route.name]);

  // <main> is marked busy here from what the wallet itself publishes: the
  // first scan of the wallet's coins. The shell adds what the wallet does
  // not publish, a passkey prompt that is open and a payment that is being
  // sent: the piece that starts one says so (busyWhile in
  // components/status.svelte.ts).
  let busy = $derived(wallet.chain.scanning && wallet.chain.state === null);

  // Tell the wallet which screen is open, on every change of route, so it
  // reads the network only as often as that screen needs. The wallet is
  // outside Svelte's drawing of the page, which is what an effect is for.
  //
  // The effect follows the route and nothing else. The call itself is made
  // out of its sight (untrack): whatever the wallet reads while it takes the
  // screen in is the wallet's own business, and must not count as something
  // this effect depends on, or the wallet would be told again every time
  // that changed.
  $effect(() => {
    const name = router.route.name;
    untrack(() => wallet.watch(name));
  });
  onDestroy(() => wallet.watch(null));

  // Whether events are wanted. A value of its own, so that what follows is
  // told only when the answer changes, and not each time the wallet swaps in
  // a settings object that says the same.
  let counting = $derived(wallet.config.events);

  // Count a view of the screen that is showing, and of every later one, once
  // the wallet's settings say that events are wanted. Until then nothing is
  // sent. The counted path is fixed per screen and language (lib/events.ts),
  // so no transaction ID and nothing the reader typed ever leaves.
  $effect(() => {
    const route = router.route;
    const lang = router.lang;
    if (counting) trackPage(route, lang);
  });
</script>

<Shell {busy}>
  <WalletGate>
    <Screen />
  </WalletGate>
</Shell>
