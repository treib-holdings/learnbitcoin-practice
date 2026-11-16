<script lang="ts">
  // What a step's screen says about the practice network, in the part that
  // is open. A step's screen is not a wallet screen and has no wallet frame
  // around it, but a part can rest on the wallet's coins or on its list of
  // transactions, and then the reader has to be told the same four things
  // (SPEC section 3):
  //
  //   - the coins are being looked up for the first time;
  //   - that first look failed: the cause, when the page tries again by
  //     itself, and "Try again";
  //   - a later look failed: what is shown is from the last one that
  //     worked, with when that was;
  //   - the practice network is slow, which is our fault.
  //
  // With `unknown` set, the part's facts are not known yet: the piece says
  // why, and the part offers no action. It never says "no coins" in that
  // state, because nobody knows yet. Without it the piece draws only the
  // third and the fourth line, and nothing when the last look worked.
  //
  // The sentences and the rules are the wallet frame's own (wallet.ts in
  // strings/, components/wallet/frame.ts), so the two can never disagree.

  import Button from '../../components/Button.svelte';
  import Countdown from '../../components/Countdown.svelte';
  import Notice from '../../components/Notice.svelte';
  import Waiting from '../../components/Waiting.svelte';
  import { chainFailureText, chainPhase } from '../../components/wallet/frame.ts';
  import type { UnknownReason } from '../../lib/doit/judge.ts';
  import { fill, formatElapsed } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';

  interface Props {
    /** Why the open part's facts are not known, or null when they are. */
    unknown: UnknownReason | null;
    /** The time, in ms since 1970, for "3 minutes ago". */
    now: number;
  }

  let { unknown, now }: Props = $props();

  const wallet = useWallet();

  let lang = $derived(router.lang);
  let t = $derived(strings.doit[lang]);
  let w = $derived(strings.wallet[lang]);
  let c = $derived(strings.common[lang]);

  let phase = $derived(chainPhase(wallet.chain));
  let looking = $derived(wallet.chain.scanning);
  let checked = $derived.by(() => {
    const at = wallet.chain.checkedAt;
    return at === null ? '' : fill(w.chainStale, { when: formatElapsed(Math.max(0, (now - at) / 1000), lang) });
  });

  /** The reader's own "Try again" is under way. */
  let trying = $state(false);

  async function tryAgain(): Promise<void> {
    if (trying) return;
    trying = true;
    // A full look at the coins, and the list of transactions after it. The wallet says how it ended.
    await wallet.refresh();
    trying = false;
  }
</script>

<!-- The cause of a failed look at the coins, what the page does about it by itself, and the button to try now. -->
{#snippet failure(stale: boolean)}
  {#if wallet.chain.error !== null}
    <div class="space-y-3">
      <Notice kind="problem" silent text={chainFailureText(wallet.chain.error, lang)} />
      <div class="space-y-1 text-sm text-ink-500">
        {#if stale && checked !== ''}<p>{checked}</p>{/if}
        {#if wallet.chain.retryAt !== null && !looking}
          <Countdown to={wallet.chain.retryAt} text={w.chainRetryIn} class="block" />
        {/if}
      </div>
      <div>
        <Button variant="quiet" busy={trying || looking} busyText={w.chainLooking} onclick={() => void tryAgain()}>
          {c.tryAgain}
        </Button>
      </div>
    </div>
  {/if}
{/snippet}

{#if unknown !== null}
  <div class="space-y-3" data-testid="step-unknown" data-reason={unknown}>
    {#if unknown === 'scan-failed'}
      {@render failure(false)}
    {:else if unknown === 'history' && wallet.historyError !== null}
      <!-- The coins are known, and the list of transactions could not be read. -->
      <Notice kind="problem" silent text={strings.errors[lang][wallet.historyError]} />
      <p class="text-sm text-ink-500">{t.unknownHistoryFailed}</p>
      <div>
        <Button variant="quiet" busy={trying || looking} busyText={w.activityReading} onclick={() => void tryAgain()}>
          {c.tryAgain}
        </Button>
      </div>
    {:else if unknown === 'history'}
      <Waiting inline text={t.unknownHistory} />
    {:else}
      <Waiting inline text={w.chainLooking} />
    {/if}
    {#if wallet.chain.slow}
      <Notice text={w.chainSlow} />
    {/if}
  </div>
{:else if wallet.status === 'ready'}
  {#if phase === 'stale'}
    {@render failure(true)}
  {/if}
  {#if wallet.chain.slow}
    <Notice text={w.chainSlow} />
  {/if}
{/if}
