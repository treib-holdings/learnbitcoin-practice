<script lang="ts">
  // The state of a request to the faucet, in words: one text for every
  // phase the wallet publishes (FaucetPhase in lib/wallet-api.ts).
  //
  //   checking    that the bot check runs, and what to do if it shows a box
  //   asking      the check is done, the faucet has not answered yet
  //   waiting     why the faucet refused for now, and when the page asks again
  //   on-its-way  what the faucet promised, with the transaction ID as text.
  //               The practice network may not list the transaction yet, so
  //               it is not a link
  //   arrived     the coin is in the wallet, unconfirmed: now the ID is a link
  //   confirmed   the coin is in a block
  //   failed      the cause and the way out, and what the sentence leaves out
  //
  // The three phases after a promise come in two forms. With a payment
  // record they name the amount and the transaction. Without one (the
  // faucet said it has paid this address before, or a coin turned up after
  // a request that had failed) they say only where the coins are.
  //
  // A refusal and a failure are boxed and announced (the cause in bold, then
  // the way out): each answers the reader's own tap. Coins arriving and
  // their first confirmation are announced by the wallet frame, not here.
  //
  // These words stand under the button, which on a phone can be below the
  // screen's edge. The card that holds this piece brings them on screen
  // when they answer the reader's own tap.

  import type { FaucetPayment } from '@learnbitcoin/practice-contract';
  import Countdown from '../../components/Countdown.svelte';
  import Mono from '../../components/Mono.svelte';
  import Notice from '../../components/Notice.svelte';
  import Row from '../../components/Row.svelte';
  import Rows from '../../components/Rows.svelte';
  import TextLink from '../../components/TextLink.svelte';
  import { satsText } from '../../components/wallet/frame.ts';
  import ReloadButton from '../../components/wallet/ReloadButton.svelte';
  import { fill } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import type { FaucetView } from '../../lib/wallet-api.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import { BITCOIN_BLOCK_MINUTES, FAUCET_ONCE_HOURS, failedText, waitingText } from './faucet.ts';

  interface Props {
    /** The request, in any phase but "idle". */
    view: FaucetView;
    /** True when the faucet has paid and "Show a new address" can be pressed: the line on how to get more coins then shows. */
    more: boolean;
    /** True when the last bot check ran out of time while its box stood on screen, waiting to be ticked. */
    boxWaited?: boolean;
  }

  let { view, more, boxWaited = false }: Props = $props();

  const wallet = useWallet();

  let lang = $derived(router.lang);
  let t = $derived(strings.receive[lang]);
  let e = $derived(strings.errors[lang]);

  let root = $state<HTMLElement>();

  /**
   * Moves keyboard focus here: for when the button that was pressed has
   * left the screen. The page does not move with it: the card brings these
   * words on screen itself, together with the bot check's box.
   */
  export function focus(): void {
    root?.focus({ preventScroll: true });
  }

  /** What a payment holds, with its unit: "100,000 practice sats". */
  function paid(payment: FaucetPayment): string {
    return satsText(BigInt(payment.amountSats), lang);
  }

  /** A box for the phases that are no refusal: white, on the faucet's grey panel. */
  const BOX = 'space-y-3 rounded-lg border border-ink-100 bg-white px-4 py-3 text-sm text-ink-700';
</script>

<!-- The payment's transaction ID, as text or as a link to the transaction's screen, and what the payment spent. -->
{#snippet record(payment: FaucetPayment, linked: boolean)}
  <Rows>
    <Row name={t.txid}>
      {#if linked}
        <TextLink href={router.link({ name: 'tx', txid: payment.txid })} data-testid="faucet-tx-link"
          ><span translate="no" class="break-all font-mono text-xs">{payment.txid}</span></TextLink
        >
      {:else}
        <Mono value={payment.txid} size="small" data-testid="faucet-txid" />
      {/if}
    </Row>
  </Rows>
  {#if payment.potTxid !== null}
    <p data-testid="faucet-pot">{t.statePot}</p>
  {/if}
{/snippet}

{#snippet once()}
  {#if more}
    <p class="text-ink-500" data-testid="faucet-once">{fill(t.faucetOnce, { hours: String(FAUCET_ONCE_HOURS) })}</p>
  {/if}
{/snippet}

<!-- tabindex="-1": it takes focus from code only, never from the Tab key, so it shows no outline. -->
<div bind:this={root} tabindex="-1" class="outline-none" data-testid="faucet-state" data-phase={view.phase}>
  {#if view.phase === 'checking'}
    <div class={BOX}><p>{t.stateChecking}</p></div>
  {:else if view.phase === 'asking'}
    <div class={BOX}><p>{t.stateAsking}</p></div>
  {:else if view.phase === 'waiting'}
    <Notice kind="problem" text={waitingText(view.failure, lang)} />
    <!-- Under the box, not in it. The box is an alert, which a screen reader reads out whole: a line
         that changes every second must not be part of it. -->
    {#if view.retryAt !== null}
      <Countdown to={view.retryAt} text={t.stateRetryIn} class="mt-2 block text-sm text-ink-600" data-testid="faucet-retry" />
    {/if}
  {:else if view.phase === 'on-its-way'}
    <div class={BOX}>
      {#if view.payment !== null}
        <p>{fill(t.statePromised, { amount: paid(view.payment) })}</p>
        {@render record(view.payment, false)}
      {:else}
        <p>{t.statePaidBefore}</p>
      {/if}
      {@render once()}
    </div>
  {:else if view.phase === 'arrived'}
    <div class={BOX}>
      {#if view.payment !== null}
        <p>
          {fill(t.stateArrived, {
            amount: paid(view.payment),
            seconds: String(wallet.config.blockSeconds),
            minutes: String(BITCOIN_BLOCK_MINUTES),
          })}
        </p>
        {@render record(view.payment, true)}
      {:else}
        <p>{t.stateArrivedNoRecord}</p>
      {/if}
      {@render once()}
    </div>
  {:else if view.phase === 'confirmed'}
    <div class={BOX}>
      {#if view.payment !== null}
        <p>{fill(t.stateConfirmed, { amount: paid(view.payment) })}</p>
        {@render record(view.payment, true)}
      {:else}
        <p>{t.stateConfirmedNoRecord}</p>
      {/if}
      {@render once()}
    </div>
  {:else if view.phase === 'failed'}
    {const failed = $derived(failedText(view.failure))}
    {#if view.failure === 'no-token' && boxWaited}
      <!-- The bot check's box stood on screen and nobody ticked it. The wallet calls that "no-token"
           like every check without an answer, and the sentence for it names a content blocker:
           not what happened here. So this one cause has the screen's own sentence. -->
      <Notice kind="problem" text={t.failedBoxWaited} data-testid="faucet-box-waited" />
    {:else if failed.adds === 'nothing'}
      <!-- The sentence ends with the way out, and the button that asks again
           is right above. What follows is only what the sentence cannot say or do. -->
      <Notice kind="problem" text={e[failed.sentence]} />
    {:else}
      <Notice kind="problem" text={e[failed.sentence]}>
        {#if failed.adds === 'other-cause'}
          <p class="text-sm">{t.failedOtherCause}</p>
        {:else if failed.adds === 'reload'}
          <ReloadButton variant="quiet" class="bg-white" data-testid="faucet-reload" />
        {:else if failed.adds === 'new-address'}
          <p class="text-sm">{fill(t.failedNewAddress, { button: t.newAddress })}</p>
        {/if}
      </Notice>
    {/if}
  {/if}
</div>
