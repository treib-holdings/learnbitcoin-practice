<script lang="ts">
  // What stands in the place of Create or Restore when no wallet can be
  // made or brought here, chosen by frontGate() in flow.ts:
  //
  //   open        nothing is in the way: the screen's own content, between the tags
  //   trouble     what is stored cannot be used (unreadable, newer, broken),
  //               or this page was not let look at it (blocked): the shared
  //               StoredTrouble piece, as the gate of a wallet screen shows it.
  //               Under the card for "blocked", what the screen adds: the
  //               storage can stop answering while Create's passkey prompt
  //               is open, and the passkey that was saved then has no wallet
  //   here        a wallet is in this browser already: which one, and the way into it
  //   arrived     the wallet said one arrived from another tab, and shows none yet: reload
  //   no-storage  this browser refuses to store anything, so nothing is made:
  //               the cause, what to change, and Reload
  //   reload      the bot check has loaded in this page: reload first
  //
  // The screen works out which one it is and hands it in as `gate`, so that
  // it can hold the gate still while one of its own actions is under way: a
  // wallet that the action itself has just made must not show as "already
  // here" in the moment before the screen moves on to it.
  //
  // `stop` is how the screen's last action ended, when that stopped the
  // screen. What follows from a tap is said aloud (an alert); what was
  // already so when the screen opened is not. `extra` is what the screen
  // adds under the gate's own words. The screen hands it in only after a
  // tap of its own, so under the "blocked" card, which is no alert itself,
  // it comes as one.
  //
  // When what shows here changes while the address stays, the thing that
  // had focus may be gone. Focus then moves to the screen's heading, as it
  // does when the router changes the screen.

  import { tick, type Snippet } from 'svelte';
  import Notice from '../../components/Notice.svelte';
  import PasskeyProblem from '../../components/wallet/PasskeyProblem.svelte';
  import ReloadButton from '../../components/wallet/ReloadButton.svelte';
  import StoredTrouble from '../../components/wallet/StoredTrouble.svelte';
  import { focusHeading, router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import { addsUnderTrouble, type Gate, type Stop } from './flow.ts';
  import WalletHere from './WalletHere.svelte';

  interface Props {
    gate: Gate;
    /** How the screen's last action ended, when that stopped the screen. */
    stop?: Stop | null;
    /** What the screen adds under the gate's own words. */
    extra?: Snippet;
    /** The screen's own content. */
    children: Snippet;
  }

  let { gate, stop = null, extra, children }: Props = $props();

  const wallet = useWallet();

  let h = $derived(strings.home[router.lang]);
  let w = $derived(strings.wallet[router.lang]);

  let before: { gate: Gate; path: string } | null = null;
  $effect(() => {
    const now = { gate, path: router.path };
    const swapped = before !== null && now.gate !== before.gate && now.path === before.path;
    before = now;
    if (swapped) void tick().then(focusHeading);
  });
</script>

{#if gate === 'open'}
  {@render children()}
{:else if gate === 'trouble'}
  <StoredTrouble titled />
  {#if extra !== undefined && addsUnderTrouble(wallet.status)}
    <!-- Under the card that says the page cannot tell whether a wallet is here: what the screen's last tap left behind. -->
    <Notice kind="problem">
      {@render extra()}
    </Notice>
  {/if}
{:else if gate === 'here'}
  <WalletHere already arrived={stop === 'exists'}>
    {@render extra?.()}
  </WalletHere>
{:else if gate === 'arrived'}
  <Notice kind="problem" text={h.hereUnseen} data-testid="front-stop">
    <div class="space-y-3">
      {@render extra?.()}
      <ReloadButton />
    </div>
  </Notice>
{:else if gate === 'no-storage'}
  <Notice kind="problem" silent={stop !== 'no-storage'} text={w.noStorage} data-testid="front-stop">
    <div class="space-y-3">
      {@render extra?.()}
      <ReloadButton />
    </div>
  </Notice>
{:else if gate === 'reload'}
  <PasskeyProblem failure={{ kind: 'reload' }} data-testid="front-stop" />
{/if}
