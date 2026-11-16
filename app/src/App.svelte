<script lang="ts">
  // The app: the shell, and inside it the screen the address asks for.
  //
  // A screen that shows a wallet is drawn only when this browser has one it
  // can use. Otherwise the gate stands in its place (WalletGate): no wallet
  // here, a stored wallet that cannot be read, a page that is out of date,
  // a browser that failed the self-test, or one that did not let the page
  // read its storage (the gate then says that it cannot tell whether a
  // wallet is here, never that there is none).
  //
  // The wallet arrives as a prop and is put in Svelte's context here, once.
  // Every screen and piece then reaches it with useWallet()
  // (lib/wallet-context.ts) and sees only the WalletApi interface. main.ts
  // hands in the real wallet; the development gallery (app/dev) hands in a
  // scripted stand-in and mounts this same component.
  //
  // The "Do it" steps arrive the same way, and are reached with useDoit()
  // (lib/doit/doit-context.ts). This component also tells them which screen
  // is open, as it tells the wallet.

  import { onDestroy, untrack, type Component } from 'svelte';
  import ScreenChange from './components/ScreenChange.svelte';
  import Shell from './components/Shell.svelte';
  import WalletGate from './components/wallet/WalletGate.svelte';
  import { setDoit, type Doit } from './lib/doit/doit-context.ts';
  import { watchedScreen } from './lib/doit/progress.ts';
  import { trackPage } from './lib/events.ts';
  import { router } from './lib/router.svelte.ts';
  import type { Route } from './lib/router.ts';
  import type { WalletApi } from './lib/wallet-api.ts';
  import { setWallet } from './lib/wallet-context.ts';
  import About from './screens/About.svelte';
  import Activity from './screens/Activity.svelte';
  import Backup from './screens/Backup.svelte';
  import Coins from './screens/Coins.svelte';
  import Do from './screens/Do.svelte';
  import Home from './screens/Home.svelte';
  import New from './screens/New.svelte';
  import NotFound from './screens/NotFound.svelte';
  import Overview from './screens/Overview.svelte';
  import Receive from './screens/Receive.svelte';
  import Restore from './screens/Restore.svelte';
  import Send from './screens/Send.svelte';
  import Settings from './screens/Settings.svelte';
  import Sparrow from './screens/Sparrow.svelte';
  import Step from './screens/Step.svelte';
  import Tx from './screens/Tx.svelte';

  let { wallet: given, doit: steps }: { wallet: WalletApi; doit: Doit } = $props();

  // One wallet for the life of the page: the object never changes, only its
  // properties do. So it is read once, here, and put in the context.
  const wallet = untrack(() => given);
  setWallet(wallet);

  // The same holds for the "Do it" steps.
  const doit = untrack(() => steps);
  setDoit(doit);

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
    do: Do,
    step: Step,
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
  // The effect follows the screen and nothing else. The call itself is made
  // out of its sight (untrack): whatever the wallet reads while it takes the
  // screen in is the wallet's own business, and must not count as something
  // this effect depends on, or the wallet would be told again every time
  // that changed.
  //
  // One screen is told as another: a "Do it" step that is done, whose
  // screen has nothing left to check against the chain, is told as the list
  // of steps, for which the wallet reads nothing (watchedScreen in
  // lib/doit/progress.ts). It is told as a step again the moment the address
  // names one that is under way.
  let watched = $derived(watchedScreen(router.route, doit.progress));
  $effect(() => {
    const name = watched;
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
  //
  // $effect.pre, not $effect: it runs before the page is redrawn, and so
  // before the new screen's own script and its onMount. Whatever the wallet
  // counts from then on is filed under the screen that was named last. A
  // screen that has the wallet count something while it is being put on the
  // page (Backup, which shows the 12 words straight after a create) would
  // otherwise have it filed under the screen before.
  //
  // The other end of a change of screen is the old screen's: what it counts
  // while it is taken off the page is still its own. ScreenChange, below,
  // sees to that.
  $effect.pre(() => {
    const route = router.route;
    const lang = router.lang;
    if (counting) trackPage(route, lang);
  });

  // Tell the "Do it" steps which screen is open: the first one, and every
  // later one. A step's screen starts its step when it opens, and a part
  // such as "Open your coins" is ticked by the opening of a screen.
  //
  // $effect.pre again, and after the effect above. Before the redraw, so
  // that a step's screen is drawn with its step already started and
  // whatever is true of the wallet already ticked. And after the screen
  // has been named to the counter, so that a step this very change of
  // screen finishes is counted under the screen it was finished on.
  //
  // It also says whether the server's settings have arrived. Until they
  // have, nobody knows whether anything is counted, and the steps hold
  // their counts back; this effect runs again when the answer comes.
  $effect.pre(() => {
    const route = router.route;
    const search = router.search;
    const settled = wallet.settings !== 'loading';
    untrack(() => doit.watch(route, search, settled));
  });
</script>

<Shell {busy}>
  <!-- One block for each screen: the marker, the gate and the screen come and go
       together when the address asks for another screen. (The same screen in the
       other language, or another transaction on the transaction screen, is no
       change of screen: nothing is taken off the page for it.) -->
  {#key Screen}
    <ScreenChange />
    <WalletGate>
      <Screen />
    </WalletGate>
  {/key}
</Shell>
