<script lang="ts">
  // The review of the signed payment: the step the Send screen exists for.
  //
  // The payment is signed and has gone nowhere. The reader sees it exactly
  // as it was signed: who is paid and how much, the fee, the size and the
  // fee rate of the signed transaction, and then every input and every
  // output, with the change marked or the reason there is none. Two ways
  // on: "Send it", and "Change it", which drops the signed payment and goes
  // back to the form with its values kept.
  //
  // The same piece shows a payment the practice network did not take. The
  // sentence for the refusal stands at the top, under the heading, with the
  // node's own words folded away under it and nowhere else, and the
  // buttons stand right under that: "Try sending again" where the same
  // payment may be handed in again (flow.ts says when), and the way back to
  // the form. Where no answer came about the payment, a line says that it
  // may be out all the same and that sending the same one again is safe.
  //
  // "Send it" takes no tap in the review's first moment (REVIEW_SETTLE_MS in
  // flow.ts): the second tap of a double tap on "Continue" lands where the
  // review has just appeared, and must not send what nobody has read.

  import type { SignedPayment, TxView } from '@learnbitcoin/practice-wallet';
  import Actions from '../../components/Actions.svelte';
  import Amount from '../../components/Amount.svelte';
  import Button from '../../components/Button.svelte';
  import Details from '../../components/Details.svelte';
  import Mono from '../../components/Mono.svelte';
  import Notice from '../../components/Notice.svelte';
  import Prose from '../../components/Prose.svelte';
  import Row from '../../components/Row.svelte';
  import Rows from '../../components/Rows.svelte';
  import Section from '../../components/Section.svelte';
  import TextLink from '../../components/TextLink.svelte';
  import TxFeeRows from '../../components/wallet/TxFeeRows.svelte';
  import TxParts from '../../components/wallet/TxParts.svelte';
  import type { BroadcastFailure } from '../../lib/api.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import { REVIEW_SETTLE_MS, canSendAgain, unanswered } from './flow.ts';
  import { factsOf, paysOwn } from './form.ts';

  interface Props {
    payment: SignedPayment;
    /** The payment as the wallet sees it: SignResult.view. */
    view: TxView;
    /** The reader chose "Send all": the reason there is no change is known exactly. */
    sendAll: boolean;
    /** The address paid is the pot's. */
    pot: boolean;
    /** Why the practice network did not take the payment, after a try that failed. */
    refusal: { reason: BroadcastFailure; detail: string | null } | null;
    /** The payment is on its way to the practice network. */
    sending: boolean;
    onsend: () => void;
    onback: () => void;
  }

  let { payment, view, sendAll, pot, refusal, sending, onsend, onback }: Props = $props();

  let t = $derived(strings.send[router.lang]);
  let c = $derived(strings.common[router.lang]);
  let errors = $derived(strings.errors[router.lang]);

  let facts = $derived(factsOf(payment));
  /** The address paid is one of this wallet's own: the amount comes back, and only the fee leaves. */
  let own = $derived(paysOwn(payment, view));
  /** The same payment may be handed in again: always before a first try, and after a refusal that waiting cures. */
  let sendable = $derived(refusal === null || canSendAgain(refusal.reason));
  /** No answer came about the payment: it may be out all the same. */
  let unknown = $derived(refusal !== null && unanswered(refusal.reason));
  /** What follows the sentence of a refusal: what an answer that never came leaves open, where to look for a payment that is already there, and the node's words. */
  let more = $derived(refusal !== null && (refusal.detail !== null || refusal.reason === 'already_sent' || unknown));

  // False for the review's first moment (see the top of this file). The
  // timer starts when the review appears and is dropped if it leaves first.
  let settled = $state(false);
  $effect(() => {
    const timer = setTimeout(() => (settled = true), REVIEW_SETTLE_MS);
    return () => clearTimeout(timer);
  });

  /** Buttons of one group are as wide as each other on a phone. */
  const WIDE = 'w-full sm:w-auto';
</script>

{#snippet actions()}
  <Actions>
    {#if sendable}
      <Button
        variant="primary"
        class={WIDE}
        data-testid="send-broadcast"
        busy={sending}
        busyText={t.sending}
        disabled={!settled}
        onclick={onsend}
      >
        {refusal === null ? t.send : t.sendAgain}
      </Button>
    {/if}
    <!-- A payment that is on its way cannot be changed any more. -->
    <Button variant={sendable ? 'secondary' : 'primary'} class={WIDE} data-testid="send-change" disabled={sending} onclick={onback}>
      {refusal === null ? t.change : t.backToForm}
    </Button>
  </Actions>
{/snippet}

{#snippet after()}
  <div class="space-y-3">
    {#if unknown}
      <p data-testid="send-unanswered">{t.unansweredNote}</p>
    {/if}
    {#if refusal?.reason === 'already_sent'}
      <p><TextLink href={router.link({ name: 'activity' })}>{c.section_activity}</TextLink></p>
    {/if}
    {#if refusal !== null && refusal.detail !== null}
      <Details summary={t.refusedDetail} data-testid="send-refused-detail">
        <Mono value={refusal.detail} size="small" />
      </Details>
    {/if}
  </div>
{/snippet}

<div class="space-y-8" data-testid="send-review">
  {#if refusal !== null}
    <div class="space-y-4">
      <Notice kind="problem" text={errors[refusal.reason]} data-testid="send-refused" children={more ? after : undefined} />
      {@render actions()}
    </div>
  {:else}
    <Prose>
      <p>{t.reviewLead}</p>
      <p>{t.reviewCheck}</p>
    </Prose>
  {/if}

  <Rows>
    {#if facts !== null}
      <Row name={t.planTo} data-testid="review-to">
        <Mono value={facts.to} />
        {#if pot}<p class="mt-0.5 text-xs leading-normal text-ink-500">{t.toPot}</p>{/if}
        {#if own}<p class="mt-0.5 text-xs leading-normal text-ink-500" data-testid="review-to-own">{t.toOwn}</p>{/if}
      </Row>
      <Row name={t.planAmount} data-testid="review-amount"><Amount sats={facts.amount} /></Row>
    {/if}
    <TxFeeRows {view} />
    {#if facts !== null}
      <Row name={t.planTotal} data-testid="review-total"><Amount sats={facts.total} /></Row>
      <Row name={t.planChange} data-testid="review-change">
        {#if facts.change !== null}<Amount sats={facts.change} />{:else}{t.planNoChange}{/if}
      </Row>
    {/if}
  </Rows>

  <Section title={t.reviewParts}>
    <TxParts {view} noChange={sendAll ? t.noChangeAll : t.noChangeLeftover} />
  </Section>

  {#if refusal === null}
    {@render actions()}
  {/if}
</div>
