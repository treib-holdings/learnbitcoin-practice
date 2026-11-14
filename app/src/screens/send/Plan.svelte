<script lang="ts">
  // The plan of a payment that can be made: what the wallet worked out from
  // its coins alone, before any key is touched.
  //
  // It shows what a payment is made of, each figure as the planner gave it:
  // who is paid and how much, the fee with the size it is charged on and
  // the rate that comes to, the amount and the fee together, the change
  // that comes back (or why there is none), and the very coins the payment
  // will spend. The fee, the size and the rate are drawn by the piece the
  // review and the transaction screen use, so the reader meets the same
  // three rows again once the payment is signed, and again once it is sent.
  //
  // The coins are rows of the plan's own, without the link to the
  // transaction that made each one (the Coins screen has those). The plan
  // stands between the form's fields and "Continue": a link there leaves
  // the screen, and the way back finds the form empty.

  import type { PaymentPlan } from '@learnbitcoin/practice-wallet';
  import Amount from '../../components/Amount.svelte';
  import Badge from '../../components/Badge.svelte';
  import Mono from '../../components/Mono.svelte';
  import Row from '../../components/Row.svelte';
  import Rows from '../../components/Rows.svelte';
  import TxFeeRows from '../../components/wallet/TxFeeRows.svelte';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import { noChangeOf, rateDiffers } from './flow.ts';

  interface Props {
    plan: Extract<PaymentPlan, { ok: true }>;
    /** The address that is paid, in its tidy spelling. */
    to: string;
    /** That address is the pot's: "Pass it on" filled it in. */
    pot: boolean;
    /** That address is one of this wallet's own: the amount comes back, and only the fee leaves. */
    own: boolean;
    /** The reader chose "Send all". */
    sendAll: boolean;
    /** The fee rate in the form's field, in sat/vB. */
    chosen: bigint;
  }

  let { plan, to, pot, own, sendAll, chosen }: Props = $props();

  let t = $derived(strings.send[router.lang]);
  let c = $derived(strings.common[router.lang]);
  let w = $derived(strings.wallet[router.lang]);

  let noChange = $derived(noChangeOf(plan.change, sendAll));

  /** A line of explanation under the rows. */
  const NOTE = 'text-pretty text-sm leading-relaxed text-ink-600';
</script>

<div class="space-y-3">
  <Rows>
    <Row name={t.planTo} data-testid="plan-to">
      <Mono value={to} />
      {#if pot}<p class="mt-0.5 text-xs leading-normal text-ink-500">{t.toPot}</p>{/if}
      {#if own}<p class="mt-0.5 text-xs leading-normal text-ink-500" data-testid="plan-to-own">{t.toOwn}</p>{/if}
    </Row>
    <Row name={t.planAmount} data-testid="plan-amount"><Amount sats={plan.amount} /></Row>
    <TxFeeRows view={plan} />
    <Row name={t.planTotal} data-testid="plan-total"><Amount sats={plan.amount + plan.fee} /></Row>
    <Row name={t.planChange} data-testid="plan-change">
      {#if plan.change !== null}<Amount sats={plan.change} />{:else}{t.planNoChange}{/if}
    </Row>
  </Rows>
  {#if noChange !== null}
    <p class={NOTE} data-testid="plan-no-change">{noChange === 'send-all' ? t.noChangeAll : t.noChangeLeftover}</p>
  {/if}
  {#if rateDiffers(plan.feeRate, chosen)}
    <p class={NOTE} data-testid="plan-rate-note">{t.planRateNote}</p>
  {/if}
</div>

<div>
  <h3 class="text-sm font-semibold uppercase tracking-widest text-ink-500">{t.planCoins}</h3>
  <!-- role="list": Safari stops calling a list a list once its bullets are styled away. -->
  <ul role="list" class="mt-2 divide-y divide-ink-100 border-y border-ink-100">
    {#each plan.inputs as coin (`${coin.txid}:${coin.vout}`)}
      <!-- Laid out as a row of the Coins screen is: the amount first on a phone, at the right edge on a wider screen. -->
      <li data-testid="coin" class="flex flex-col gap-1 py-3 sm:flex-row-reverse sm:items-baseline sm:justify-between sm:gap-4">
        <p class="flex flex-wrap items-baseline gap-x-3 gap-y-1 leading-snug sm:shrink-0 sm:flex-row-reverse">
          <Amount sats={coin.value} />
          {#if !coin.status.confirmed}<Badge tone="fact">{c.unconfirmed}</Badge>{/if}
          {#if coin.chain === 1}<Badge tone="kind">{w.coinChange}</Badge>{/if}
        </p>
        <div class="min-w-0"><Mono value={coin.address} size="small" /></div>
      </li>
    {/each}
  </ul>
</div>
