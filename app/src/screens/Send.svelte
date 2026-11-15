<script lang="ts">
  // The Send screen: where a reader learns what a payment is made of.
  //
  // It is one screen in four steps, swapped in place:
  //
  //   form    what the wallet can spend, then three fields (to, amount, fee
  //           rate). As soon as all three are good the plan shows under
  //           them, worked out without keys: the fee and the size it is
  //           charged on, the change, the total, the coins that will be
  //           spent. A plan the wallet cannot make shows the planner's own
  //           sentence instead.
  //   unlock  only for a passkey wallet that is locked: the shared unlock
  //           step, which promises that unlocking sends nothing.
  //   review  the payment, signed and not sent: exactly what was signed.
  //           "Send it" hands it to the practice network, once. A payment
  //           the network did not take shows its sentence here as well.
  //   sent    what happens next, and a link to the transaction's screen.
  //
  // The form checks its own fields before it asks for a plan, and never
  // cuts the amount down to what "Send all" would deliver (send/form.ts).
  // What each answer of the wallet leads to is in send/flow.ts. Both are
  // plain functions with tests of their own.
  //
  // What the reader typed lives as long as the page does, so "Change it"
  // and a refused payment find the form as it was left, and so does a
  // reader who left the screen and came back (the browser's Back button at
  // the unlock step or at the review leaves Send altogether): send/kept.ts.
  // It is forgotten once the payment is sent. The signed payment lives only
  // on the review: it is dropped when the reader goes back to the form,
  // locks the wallet or leaves the screen.
  //
  // The document's title follows the step, as the heading does: a tab must
  // not read "Send" over a page that reads "Payment sent".
  //
  // The screen never says more about a payment than it knows. An answer
  // that says nothing about the payment (none came, or the practice network
  // could not give one) gets a heading of its own, never "not sent": the
  // payment may be out. The wallet has looked for the transaction by then
  // (after either answer), and a payment the network has comes back as sent.

  import { onDestroy, tick, untrack } from 'svelte';
  import {
    ownAddresses,
    type PaymentPlan,
    type PaymentRequest,
    type PlanFailure,
    type SignedPayment,
    type TxView,
  } from '@learnbitcoin/practice-wallet';
  import Actions from '../components/Actions.svelte';
  import Amount from '../components/Amount.svelte';
  import Button from '../components/Button.svelte';
  import Checkbox from '../components/Checkbox.svelte';
  import Field from '../components/Field.svelte';
  import Mono from '../components/Mono.svelte';
  import Notice from '../components/Notice.svelte';
  import Row from '../components/Row.svelte';
  import Rows from '../components/Rows.svelte';
  import Section from '../components/Section.svelte';
  import TextInput from '../components/TextInput.svelte';
  import TextLink from '../components/TextLink.svelte';
  import { announce, busyWhile, working } from '../components/status.svelte.ts';
  import NoCoins from '../components/wallet/NoCoins.svelte';
  import ReloadButton from '../components/wallet/ReloadButton.svelte';
  import Unlock from '../components/wallet/Unlock.svelte';
  import WalletFrame from '../components/wallet/WalletFrame.svelte';
  import { satsText } from '../components/wallet/frame.ts';
  import type { Unlocked } from '../components/wallet/unlock-flow.ts';
  import type { ApiFailure, BroadcastFailure } from '../lib/api.ts';
  import { fill, formatSats } from '../lib/format.ts';
  import { focusHeading, router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import { afterUnlock, coinsInDoubt, fillsPot, judgeSign, refusalHeading, sendAllLine, unanswered } from './send/flow.ts';
  import {
    FEE_RATE,
    factsOf,
    fundsOf,
    readAmount,
    readFee,
    readLink,
    readTo,
    requestOf,
    type PaymentFacts,
  } from './send/form.ts';
  import { forgetForm, keepForm, keptForm } from './send/kept.ts';
  import Plan from './send/Plan.svelte';
  import Review from './send/Review.svelte';
  import Sent from './send/Sent.svelte';

  const wallet = useWallet();
  // For the ids that tie a field to the lines that describe it.
  const uid = $props.id();

  let lang = $derived(router.lang);
  let t = $derived(strings.send[lang]);
  let c = $derived(strings.common[lang]);
  let errors = $derived(strings.errors[lang]);

  /** True once the screen has left: an answer that arrives after that is for nobody. */
  let gone = false;

  // -- the form's fields ------------------------------------------------------------

  /** What the reader typed here before leaving the screen, if this page still has it (send/kept.ts). */
  const before = keptForm(wallet.record?.xpub ?? null);

  let toText = $state(before?.to ?? '');
  let amountText = $state(before?.amount ?? '');
  let sendAll = $state(before?.sendAll ?? false);
  let feeText = $state(before?.fee ?? formatSats(FEE_RATE.start));

  let to = $derived(readTo(toText));
  let amount = $derived(readAmount(amountText, sendAll));
  let fee = $derived(readFee(feeText));
  /** The payment the three fields stand for, or null until all of them are good. */
  let request = $derived(requestOf(to, amount, fee));

  const limits = { min: formatSats(FEE_RATE.min), max: formatSats(FEE_RATE.max) };

  let toError = $derived(
    to.kind === 'invalid'
      ? errors['plan_bad-address']
      : to.kind === 'mainnet'
        ? t.toMainnet
        : to.kind === 'other-test-network'
          ? t.toOtherNet
          : '',
  );
  let amountError = $derived(amount.kind === 'period' ? t.amountPeriod : amount.kind === 'invalid' ? t.amountInvalid : '');
  let feeError = $derived(
    fee.kind === 'rate'
      ? ''
      : fee.kind === 'low'
        ? // The planner's own sentence for a rate under the lowest: the limit is this wallet's, and it says so.
          errors['plan_bad-fee']
        : fee.kind === 'high'
          ? fill(t.feeHigh, { max: limits.max })
          : fill(t.feeRange, limits),
  );

  let toField = $state<ReturnType<typeof TextInput>>();

  // A payment link in the "To" field names an amount: it goes into the
  // amount field, once, when the link is typed or pasted. The effect follows
  // the "To" field alone, so an amount the reader types afterwards stays.
  $effect(() => {
    const link = readLink(toText);
    if (link === null || link.amount === null) return;
    const filled = link.amount;
    untrack(() => {
      amountText = filled;
      sendAll = false;
    });
  });

  /** Once the reader leaves the field, a payment link gives way to the address it carries. */
  function settleLink(): void {
    const link = readLink(toText);
    if (link !== null && link.to !== null) toText = link.to;
  }

  /** A tb1 address is swapped for the same address in the practice network's spelling. */
  async function usePractice(address: string): Promise<void> {
    toText = address;
    // The button that was pressed is gone with the offer.
    await tick();
    toField?.focus();
  }

  /** The ids of the lines that describe a field, as aria-describedby wants them. */
  function describedBy(...ids: (string | undefined | false)[]): string | undefined {
    const text = ids.filter((id) => typeof id === 'string' && id !== '').join(' ');
    return text === '' ? undefined : text;
  }

  // -- pass it on -------------------------------------------------------------------

  /** The pot address the wallet last gave. A payment to it is counted as passed on. */
  let potAddress = $state<string | null>(before?.pot ?? null);
  let potBusy = $state(false);
  let potProblem = $state<ApiFailure | null>(null);

  let toPot = $derived(to.kind === 'practice' && to.address === potAddress);

  async function passItOn(): Promise<void> {
    if (potBusy) return;
    potBusy = true;
    potProblem = null;
    /** What the field held when the button was pressed. The answer can take many seconds. */
    const atTap = toText;
    // The wallet must be the source of the address: it remembers which addresses are the pot's.
    const result = await busyWhile(wallet.potAddress());
    if (gone) return;
    potBusy = false;
    const atForm = step === 'form';
    if (!result.ok) {
      // Said only where it answers the tap: a reader who has gone on to the review is past it.
      if (atForm) potProblem = result.reason;
      return;
    }
    // An address the reader typed while the pot was asked stays, and so does the field behind a review (flow.ts).
    if (!fillsPot(atTap, toText, atForm)) return;
    potAddress = result.address;
    toText = result.address;
    // Focus is still on the button, and the field it filled stands above it: a screen reader is told.
    announce(t.potFilled);
  }

  // -- an address of this wallet ------------------------------------------------------

  // The Receive screen shows the reader an address, and it is the first one
  // a learner with nobody to pay will paste here. Such a payment comes back:
  // the form and the plan say so, because only the fee leaves the wallet.
  let own = $derived(wallet.chain.state === null ? null : ownAddresses(wallet.chain.state));
  let toOwn = $derived(to.kind === 'practice' && own !== null && (own.receive.has(to.address) || own.change.has(to.address)));

  // -- what can be spent, and the plan --------------------------------------------------

  let funds = $derived(wallet.chain.state === null ? null : fundsOf(wallet.chain.state));

  let plan = $derived.by((): PaymentPlan | null => {
    // Read here so that the plan is worked out again whenever the coins
    // change: wallet.plan() is a plain call, which nothing follows by itself.
    void wallet.chain.state;
    return request === null ? null : wallet.plan(request);
  });

  /** The line about "Send all" beside the plan (flow.ts says when there is one). */
  let allLine = $derived(plan === null ? null : sendAllLine(plan, sendAll));
  /** A plan refused for its amount: the amount field is then described by the planner's sentence. */
  let amountRefused = $derived(
    plan !== null && !plan.ok && (plan.reason === 'too-much' || plan.reason === 'below-dust' || plan.reason === 'too-small'),
  );

  // -- the steps ------------------------------------------------------------------------

  let step = $state<'form' | 'unlock' | 'review' | 'sent'>('form');

  /** The payment as signed, with what the form knew about it. Dropped with the review. */
  let signed = $state.raw<{ payment: SignedPayment; view: TxView; sendAll: boolean; pot: boolean } | null>(null);
  /** Why the practice network did not take the signed payment. */
  let refusal = $state.raw<{ reason: BroadcastFailure; detail: string | null } | null>(null);
  let sending = $state(false);
  /** The payment that was sent. */
  let sent = $state.raw<{ txid: string; facts: PaymentFacts | null; pot: boolean } | null>(null);

  /** Signing was refused although the plan stood: the planner's reason. */
  let signProblem = $state<PlanFailure | null>(null);
  /** The keys could not be loaded. */
  let keysProblem = $state(false);
  /** The wallet is working on "Continue". */
  let signing = $state(false);
  /** The request the unlock step is waiting to sign. */
  let pending: PaymentRequest | null = null;

  /** The heading over a payment the network did not take (flow.ts says which answer gets which). */
  function refusedTitle(reason: BroadcastFailure): string {
    const heading = refusalHeading(reason);
    return heading === 'already-sent' ? t.alreadyTitle : heading === 'unanswered' ? t.unansweredTitle : t.refusedTitle;
  }

  let title = $derived(
    step === 'form'
      ? c.section_send
      : step === 'unlock'
        ? t.unlockTitle
        : step === 'review'
          ? refusal === null
            ? t.reviewTitle
            : refusedTitle(refusal.reason)
          : t.sentTitle,
  );

  /** Swaps the step in place, then moves focus to the heading, so the new step is announced and Tab starts at its top. */
  async function show(next: typeof step): Promise<void> {
    step = next;
    await tick();
    if (!gone) focusHeading();
  }

  // What was said about the last try to sign is about the payment as it
  // stood then, and a failed "Pass it on" is about the field as it stood
  // then. Both go as soon as the reader changes a field.
  $effect(() => {
    void toText;
    void amountText;
    void sendAll;
    void feeText;
    untrack(() => {
      signProblem = null;
      keysProblem = false;
      potProblem = null;
    });
  });

  // The form is kept for a reader who leaves and comes back, until the
  // payment is sent. A payment link is kept as the address it carries, as
  // the field itself holds it once the reader has left it: read again as a
  // link, it would put its amount back over one the reader has changed.
  $effect(() => {
    const link = readLink(toText);
    const form = { to: link !== null && link.to !== null ? link.to : toText, amount: amountText, sendAll, fee: feeText, pot: potAddress };
    const owner = wallet.record?.xpub ?? null;
    const done = sent !== null;
    untrack(() => {
      if (owner === null || done) forgetForm();
      else keepForm(owner, form);
    });
  });

  /** "Continue": sign the payment the form stands for. Nothing is sent. */
  async function next(): Promise<void> {
    if (request === null || signing) return;
    signProblem = null;
    keysProblem = false;
    await sign(request, false);
  }

  /** Signs, and goes where the wallet's answer leads (flow.ts). `keysLoaded`: this follows an unlock. */
  async function sign(asked: PaymentRequest, keysLoaded: boolean): Promise<void> {
    const result = wallet.sign(asked);
    const outcome = judgeSign(result, wallet.record?.kind === 'passkey', keysLoaded);
    if (result.ok) {
      signed = { payment: result.payment, view: result.view, sendAll: asked.amount === 'all', pot: asked.to === potAddress };
      refusal = null;
      return show('review');
    }
    switch (outcome.kind) {
      case 'needs-unlock':
        pending = asked;
        return show('unlock');
      case 'needs-keys': {
        // A wallet made without a passkey: its keys load with no prompt.
        signing = true;
        const opened = await busyWhile(wallet.unlock());
        if (gone) return;
        signing = false;
        if (opened.kind === 'unlocked') return sign(asked, true);
        return fail({ keys: true });
      }
      case 'no-keys':
        return fail({ keys: true });
      case 'refused':
        return fail({ reason: outcome.reason });
      case 'signed':
        return;
    }
  }

  /** The payment was not signed: the reader is at the form, and the reason stands above "Continue". */
  async function fail(why: { keys: true } | { reason: PlanFailure }): Promise<void> {
    if ('keys' in why) keysProblem = true;
    else signProblem = why.reason;
    // Already at the form: focus stays on the button that was pressed, and the reason is an alert.
    if (step !== 'form') await show('form');
  }

  /** The unlock step has loaded the keys. It moves focus to the heading itself. */
  function unlocked(how: Unlocked): void {
    const asked = pending;
    pending = null;
    // The reader went back to the form while the prompt was open: the keys
    // are loaded, and "Continue" there signs without another prompt.
    if (step !== 'unlock' || asked === null) return;
    if (afterUnlock(how) === 'plan-again') {
      // The coins are being looked up afresh, or are another wallet's: the
      // plan made before is worth nothing. The form shows a new one once
      // the coins are known, and the frame says what happened.
      step = 'form';
      return;
    }
    void sign(asked, true);
  }

  /**
   * "Back to the form", under the unlock step. Not while a passkey prompt
   * is open (the button is switched off then): the page cannot take a
   * prompt back, and a reader who left with one open would meet this step
   * again at the next "Continue", with a prompt already waiting that the
   * new step knows nothing about. (The unlock step itself leaves focus
   * alone once it is off the screen, so this is no longer about focus.)
   */
  function leaveUnlock(): void {
    if (working()) return;
    pending = null;
    void show('form');
  }

  /** "Send it": hand the signed payment to the practice network, once. */
  async function broadcast(): Promise<void> {
    if (signed === null || sending) return;
    const { payment, pot } = signed;
    sending = true;
    // With no answer about the payment the wallet looks for the transaction
    // itself before it answers here: a payment the network has is "sent".
    const result = await busyWhile(wallet.broadcast(payment));
    if (gone) return;
    sending = false;
    if (result.ok) {
      sent = { txid: result.txid, facts: factsOf(payment), pot };
      signed = null;
      refusal = null;
      return show('sent');
    }
    // Nothing in the wallet changed. The review stays, under a new heading.
    refusal = { reason: result.reason, detail: result.detail };
    // The network holds other coins than this payment was made from: read
    // them again now, so that the form the reader goes back to has them.
    if (coinsInDoubt(result.reason)) void wallet.refresh();
    await tick();
    if (!gone) focusHeading();
  }

  /** The signed payment is dropped and the form comes back, with its values kept and focus on the heading. */
  function dropSigned(): void {
    // No answer came about the last try, so the payment may be out all the
    // same. The coins are read again: the form must not offer coins that
    // payment has spent for a second one.
    if (refusal !== null && unanswered(refusal.reason)) void wallet.refresh();
    signed = null;
    refusal = null;
    void show('form');
  }

  /** "Change it", and the way back after a refusal. */
  function backToForm(): void {
    if (sending) return;
    dropSigned();
  }

  /** "Send another": a fresh form. The fee rate stays as the reader set it. */
  function another(): void {
    sent = null;
    toText = '';
    amountText = '';
    sendAll = false;
    potAddress = null;
    potProblem = null;
    void show('form');
  }

  // Locking the wallet takes the signed payment with it: a reader who locks
  // means that nothing more leaves this wallet. A payment that is already
  // on its way is not called back by that. But `sending` is read where the
  // effect follows it: if that try fails, the effect runs again and drops
  // the payment then, so that "Try sending again" is never offered by a
  // locked wallet. A payment that was sent is untouched: the step is "sent".
  // The keys can also go without the frame's Lock button (another tab
  // changed the wallet), and the button that had focus goes with the
  // review: so focus moves to the heading here as well.
  $effect(() => {
    if (wallet.unlocked || sending) return;
    untrack(() => {
      if (step === 'review') dropSigned();
    });
  });

  // Leaving the screen drops the signed payment.
  onDestroy(() => {
    gone = true;
    signed = null;
    pending = null;
  });

  /** A line of explanation under a field or a list. */
  const NOTE = 'text-pretty text-sm leading-relaxed text-ink-600';
</script>

<WalletFrame {title} lede={step === 'form' ? t.lede : undefined}>
  {#snippet children(known)}
    {#if step === 'sent' && sent !== null}
      <Sent txid={sent.txid} facts={sent.facts} pot={sent.pot} blockSeconds={wallet.config.blockSeconds} onanother={another} />
    {:else if step === 'review' && signed !== null}
      <Review
        payment={signed.payment}
        view={signed.view}
        sendAll={signed.sendAll}
        pot={signed.pot}
        {refusal}
        {sending}
        onsend={() => void broadcast()}
        onback={backToForm}
      />
    {:else if step === 'unlock'}
      <div class="space-y-6" data-testid="send-unlock">
        <Unlock why={t.unlockWhy} promise onunlocked={unlocked} />
        <Actions>
          <!-- As wide as the step's own buttons on a phone, and off while a passkey prompt is open (leaveUnlock). -->
          <Button class="w-full sm:w-auto" data-testid="send-unlock-back" disabled={working()} onclick={leaveUnlock}>
            {t.backToForm}
          </Button>
        </Actions>
      </div>
    {:else if !known || funds === null}
      <!-- The frame says why above: the coins are being looked up, or the look failed. No amount is shown, and never 0. -->
      <p class="text-pretty leading-relaxed text-ink-600" data-testid="send-unknown">{t.coinsUnknown}</p>
    {:else if funds.coins === 0}
      <!-- "No coins yet." (or "No coins left."), and the way to the Receive screen, where the faucet is. -->
      <NoCoins data-testid="send-no-coins" />
    {:else}
      <Section title={t.fundsTitle}>
        <Rows>
          <Row name={t.spendable} data-testid="send-spendable"><Amount sats={funds.spendable} /></Row>
          {#if funds.waiting > 0n}
            <Row name={t.waiting} data-testid="send-waiting"><Amount sats={funds.waiting} /></Row>
          {/if}
        </Rows>
        {#if funds.waiting > 0n}
          <p class={NOTE}>{fill(t.waitingNote, { seconds: String(wallet.config.blockSeconds) })}</p>
        {/if}
      </Section>

      <Section title={t.formTitle}>
        <div class="space-y-8">
          <!-- To -->
          <div class="space-y-3">
            <Field label={t.toLabel} hint={t.toHint} error={toError}>
              {#snippet children(field)}
                <TextInput
                  {...field}
                  aria-describedby={describedBy(
                    field['aria-describedby'],
                    (to.kind === 'mainnet' || to.kind === 'other-test-network' || toPot || toOwn) && `${uid}-to-more`,
                  )}
                  bind:this={toField}
                  bind:value={toText}
                  mono
                  data-testid="send-to"
                  spellcheck="false"
                  autocomplete="off"
                  autocorrect="off"
                  autocapitalize="none"
                  translate="no"
                  onblur={settleLink}
                />
              {/snippet}
            </Field>
            {#if to.kind === 'other-test-network'}
              {const spelled = $derived(to.practiceAddress)}
              <div id="{uid}-to-more" class={['space-y-3', NOTE]} data-testid="send-to-other">
                <p>{t.toOtherNetSame}</p>
                <p><Mono value={spelled} data-testid="send-to-practice" /></p>
                <Actions tight>
                  <Button variant="quiet" data-testid="send-use-practice" onclick={() => void usePractice(spelled)}>
                    {t.toOtherNetUse}
                  </Button>
                </Actions>
                <p>
                  {t.toOtherNetSparrow}
                  <TextLink href={router.link({ name: 'sparrow' })}>{c.linkSparrow}</TextLink>
                </p>
              </div>
            {:else if to.kind === 'mainnet'}
              <p id="{uid}-to-more" class={NOTE}>
                <span>{t.toMainnetFrom}</span>
                <span data-testid="send-to-sparrow">{t.toMainnetSparrow}</span>
                <TextLink href={router.link({ name: 'sparrow' })}>{c.linkSparrow}</TextLink>
              </p>
            {:else if toPot}
              <p id="{uid}-to-more" class={NOTE} data-testid="send-to-pot">{t.toPot}</p>
            {:else if toOwn}
              <p id="{uid}-to-more" class={NOTE} data-testid="send-to-own">{t.toOwn}</p>
            {/if}

            <!-- Pass it on: for a reader with nobody to pay. -->
            <div class="space-y-3 rounded-lg border border-ink-100 bg-ink-50 px-4 py-3">
              <p class={NOTE}>{t.potAbout}</p>
              <Actions tight>
                <Button variant="quiet" data-testid="pass-it-on" busy={potBusy} busyText={t.potBusy} onclick={() => void passItOn()}>
                  {t.potButton}
                </Button>
              </Actions>
              {#if potProblem !== null}
                <Notice kind="problem" text={errors[potProblem]} data-testid="pot-problem" />
              {/if}
            </div>
          </div>

          <!-- Amount -->
          <div class="space-y-3">
            <Field label={t.amountLabel} hint={t.amountHint} error={amountError}>
              {#snippet children(field)}
                <TextInput
                  {...field}
                  aria-describedby={describedBy(
                    field['aria-describedby'],
                    sendAll && `${uid}-all-note`,
                    amountRefused && `${uid}-plan-refused`,
                  )}
                  aria-invalid={!sendAll && (amountError !== '' || amountRefused) ? 'true' : undefined}
                  bind:value={amountText}
                  mono
                  class="sm:max-w-xs"
                  data-testid="send-amount"
                  inputmode="numeric"
                  autocomplete="off"
                  translate="no"
                  disabled={sendAll}
                />
              {/snippet}
            </Field>
            <Checkbox bind:checked={sendAll} data-testid="send-all">{t.sendAll}</Checkbox>
            {#if sendAll}
              <p id="{uid}-all-note" class={NOTE} data-testid="send-all-note">
                {t.sendAllNote}
                {#if plan !== null && plan.ok}
                  <span class="font-semibold text-ink-800" data-testid="send-all-arrives"
                    >{fill(t.sendAllArrives, { amount: satsText(plan.amount, lang) })}</span
                  >
                {/if}
              </p>
            {/if}
          </div>

          <!-- Fee rate -->
          <Field label={t.feeLabel} hint={t.feeHint} error={feeError}>
            {#snippet children(field)}
              <TextInput
                {...field}
                bind:value={feeText}
                mono
                class="sm:max-w-xs"
                data-testid="send-fee"
                inputmode="numeric"
                autocomplete="off"
                translate="no"
              />
            {/snippet}
          </Field>
        </div>
      </Section>

      <Section title={t.planTitle}>
        {#if request === null || plan === null}
          <p class={NOTE} data-testid="send-plan-waiting">{t.planWaiting}</p>
        {:else}
          <div class="space-y-4" data-testid="send-plan">
            {#if plan.ok}
              <p class={NOTE}>{t.planNote}</p>
              <Plan {plan} to={request.to} pot={toPot} own={toOwn} {sendAll} chosen={request.feeRate} />
            {:else}
              <!-- Not announced: it follows the typing, and the amount field is described by it where it is about the amount. -->
              <div id="{uid}-plan-refused">
                <Notice kind="problem" silent text={errors[`plan_${plan.reason}`]} data-testid="send-plan-refused" />
              </div>
            {/if}
            {#if allLine !== null}
              <p class={NOTE} data-testid="send-all-would">
                {allLine.kind === 'cannot' ? t.sendAllCannot : fill(t.sendAllWould, { amount: satsText(allLine.sats, lang) })}
              </p>
            {/if}
          </div>

          <!-- What the last try to sign ran into, where the plan itself does not already say the same. -->
          {#if signProblem !== null && (plan.ok || plan.reason !== signProblem)}
            <Notice kind="problem" text={errors[`plan_${signProblem}`]} data-testid="send-sign-problem" />
          {/if}
          {#if keysProblem}
            <Notice kind="problem" text={t.keysProblem} data-testid="send-keys-problem">
              <ReloadButton />
            </Notice>
          {/if}
          {#if plan.ok}
            <div class="space-y-3">
              <Actions>
                <Button variant="primary" data-testid="send-continue" busy={signing} onclick={() => void next()}>
                  {t.continue}
                </Button>
              </Actions>
              <p class={NOTE}>{t.continueNote}</p>
            </div>
          {/if}
        {/if}
      </Section>
    {/if}
  {/snippet}
</WalletFrame>
