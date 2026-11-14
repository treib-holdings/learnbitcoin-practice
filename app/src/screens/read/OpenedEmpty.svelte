<script lang="ts">
  // What the Overview shows in place of "No coins yet." for a wallet that
  // was opened with a passkey a moment ago and turned out to have no
  // history at all (wallet.openedEmpty). A reader who expected their coins
  // needs more than an empty line. So the likely causes stand here, the
  // most likely first, each with its way out (SPEC section 6):
  //
  //   1. it is a new wallet with no coins yet: the faucet;
  //   2. another practice passkey was chosen than the one the reader's
  //      wallet was made with: the passkey just used is named by the tag
  //      in its name, and the reader can choose another;
  //   3. the same passkey gave a different wallet than before: the wallet
  //      fingerprint to compare, and the 12 words as the way back.
  //
  // "Choose another passkey" asks the wallet for any practice passkey
  // (wallet.unlock('picker')). The wallet is left exactly as it is while
  // the reader chooses: it stays unlocked, and a prompt that is closed has
  // changed nothing, as the sentence for it says. When another passkey
  // answers, nothing changes either until the reader says so: this piece
  // asks, with that passkey's name and wallet fingerprint, "Switch" or
  // "Keep". (The shared unlock step asks the same question, but it draws
  // only for a locked wallet, and locking this one first would take the
  // reader's keys away for a question they may answer with "Keep".)
  //
  // Every answer the wallet can give is dealt with here (read.ts,
  // afterChoose): the same passkey again, another passkey (the question),
  // saved details that were wrong and have been rebuilt (the wallet frame
  // says so), a passkey that fits nothing saved here, a wallet that
  // changed in another tab, and a passkey step that did not finish.
  //
  // This list can leave the screen while the prompt is open. The wallet
  // reads this browser's storage again before it opens a prompt, and if
  // what is stored was changed behind the page, the wallet on screen is no
  // longer one that was "just opened": the Overview takes the list away.
  // The answers that follow such a change are the ones the reader must not
  // miss. So an answer that finds the list gone, on an Overview that is
  // still showing, is delivered all the same: the rebuilt record through
  // the frame's note, and "changed" and "gone" through `onlate`, to the
  // Overview, which draws them.

  import { onDestroy, tick } from 'svelte';
  import Button from '../../components/Button.svelte';
  import Mono from '../../components/Mono.svelte';
  import Notice from '../../components/Notice.svelte';
  import Row from '../../components/Row.svelte';
  import Rows from '../../components/Rows.svelte';
  import Section from '../../components/Section.svelte';
  import { busyWhile } from '../../components/status.svelte.ts';
  import { TAP } from '../../components/styles.ts';
  import { splitLead } from '../../components/text.ts';
  import TextLink from '../../components/TextLink.svelte';
  import { useFrameNotes } from '../../components/wallet/frame-notes.ts';
  import WalletId from '../../components/wallet/WalletId.svelte';
  import { focusHeading, router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import ChooseAnswer from './ChooseAnswer.svelte';
  import { afterChoose, type ChooseLate, type ChooseTold } from './read.ts';

  interface Props {
    /** An answer that must reach the reader although this list has left the screen (see the top of this file). */
    onlate: (outcome: ChooseLate) => void;
  }

  let { onlate }: Props = $props();

  const wallet = useWallet();
  /** Where the wallet frame takes a note about an unlock that changed something. */
  const notes = useFrameNotes();

  let t = $derived(strings.wallet[router.lang]);
  let c = $derived(strings.common[router.lang]);

  /** The four characters this browser knows of the passkey's name, when it knows them. */
  let tag = $derived(wallet.record?.tag ?? null);
  let fingerprint = $derived(wallet.record?.fingerprint ?? '');

  // The frame's line above this list names the passkey only while the
  // wallet is locked. While it is unlocked, as it is straight after it was
  // opened, the lead below is the first thing on the screen to name one.
  let lead = $derived(wallet.unlocked ? t.emptyOpenedLeadFirst : t.emptyOpenedLead);

  /** The passkey prompt is open. */
  let busy = $state(false);
  /** What the last "Choose another passkey" came to, when it is told right here. */
  let outcome = $state.raw<ChooseTold | null>(null);
  /** Another passkey answered, and the reader has not yet said whether to switch to its wallet. */
  let pending = $derived(wallet.pendingSwitch);
  /** The question about that passkey's wallet: what happened, in bold, and then that nothing has changed. */
  let asked = $derived(splitLead(t.switchLead));
  /** The reader said "Switch", and the browser would not store the change. */
  let refused = $state(false);

  let root = $state<HTMLElement>();
  /** True once this list has left the screen. */
  let gone = false;
  onDestroy(() => {
    gone = true;
    // A question left unanswered must not wait for the reader on another screen.
    if (wallet.pendingSwitch !== null) wallet.cancelSwitch();
  });

  /** A small link that stands on a line by itself: a box of its own, with a tap area 44 px tall. */
  const ALONE = `inline-block ${TAP}`;

  /** Moves focus to one of this list's own controls, by its test hook. */
  async function focusOn(hook: string): Promise<void> {
    await tick();
    root?.querySelector<HTMLElement>(`[data-testid="${hook}"]`)?.focus();
  }

  /** After something that took the pressed button away: if focus fell back to the page itself, it goes to the heading. */
  async function focusLeft(): Promise<void> {
    await tick();
    if (document.activeElement === null || document.activeElement === document.body) focusHeading();
  }

  async function choose(): Promise<void> {
    if (busy) return;
    busy = true;
    outcome = null;
    refused = false;
    // Read now: this list may be gone when the answer comes.
    const late = onlate;
    const from = router.path;
    const result = await busyWhile(wallet.unlock('picker'));
    const next = afterChoose(result);

    if (gone) {
      // Nobody is here to answer a question about another passkey's wallet.
      if (next.show === 'question') wallet.cancelSwitch();
      // The reader went to another screen, or this browser has no wallet
      // any more and the gate stands where the Overview was: the answer is
      // not for what is showing.
      if (router.path !== from || wallet.status !== 'ready') return;
      // The Overview is still showing, without this list.
      if (next.show === 'tampered' && notes !== null) notes.note = { kind: 'tampered' };
      if (next.show === 'changed' || next.show === 'gone') late(next);
      // The button that was pressed went with the list.
      return focusLeft();
    }

    busy = false;
    switch (next.show) {
      case 'question':
        // The question shows below. Focus goes to it, so that it is read out.
        return focusOn('switch-question');
      case 'tampered':
        // The frame tells the reader what was wrong with the saved details.
        if (notes !== null) notes.note = { kind: 'tampered' };
        await tick();
        return focusHeading();
      case 'gone':
        // The wallet on screen is another one now, and this list is not about it: the Overview says so.
        late(next);
        return focusLeft();
      default:
        outcome = next;
    }
  }

  /** The reader says yes: this browser now holds the other passkey's wallet, and the frame says so. */
  async function switchWallet(): Promise<void> {
    const other = wallet.pendingSwitch;
    const late = onlate;
    refused = false;
    const result = wallet.confirmSwitch();
    if (result === 'switched') {
      if (notes !== null && other !== null) notes.note = { kind: 'switched', ...other };
      await tick();
      return focusHeading();
    }
    if (result === 'no-storage') {
      // Nothing was switched, and the question stays: the reader can say yes again, or keep this wallet.
      refused = true;
      return;
    }
    // The wallet changed in another tab meanwhile, or the question was withdrawn: it is no longer asked.
    if (result === 'gone') late({ show: 'gone' });
    await focusOn('opened-choose');
    return focusLeft();
  }

  /** The reader says no: nothing changes. */
  function keepWallet(): void {
    wallet.cancelSwitch();
    refused = false;
    void focusOn('opened-choose');
  }
</script>

<div bind:this={root} data-testid="opened-empty">
  <Section title={t.emptyOpenedTitle}>
    <p class="text-pretty leading-relaxed text-ink-700">{lead}</p>

    <!-- role="list": Safari stops calling a list a list once its numbers are styled away. -->
    <ol role="list" class="divide-y divide-ink-100 border-y border-ink-100">
      <li class="space-y-3 py-5">
        <h3 class="text-balance text-base font-semibold text-ink-800">{t.emptyNewTitle}</h3>
        <p class="text-pretty text-sm leading-relaxed text-ink-700">{t.emptyNewBody}</p>
        <div>
          <Button variant="primary" small href={router.link({ name: 'receive' })} data-testid="opened-faucet">
            {t.getCoins}
          </Button>
        </div>
      </li>

      <li class="space-y-3 py-5">
        <h3 class="text-balance text-base font-semibold text-ink-800">{t.emptyOtherTitle}</h3>
        <p class="text-pretty text-sm leading-relaxed text-ink-700">{t.emptyOtherBody}</p>
        <Rows>
          {#if tag !== null}
            <Row name={t.walletPasskeyHas}><Mono value={tag} data-testid="passkey-tag" /></Row>
          {:else}
            <Row name={t.switchPasskey}>{t.switchPasskeyUnknown}</Row>
          {/if}
        </Rows>

        {#if pending !== null}
          <!-- Another passkey answered. Nothing changes until the reader says so. -->
          <Notice kind="caution">
            <div class="space-y-3">
              <!-- tabindex="-1": it takes focus from code only, so that the question is read out. -->
              <p tabindex="-1" data-testid="switch-question" class="outline-none">
                <span class="font-semibold text-ink-800">{asked.lead}</span>
                {asked.rest}
              </p>
              <WalletId tag={pending.tag} fingerprint={pending.fingerprint} />
              <p>{t.switchAsk}</p>
              {#if refused}
                <p class="font-semibold text-ink-800" role="alert" data-testid="opened-problem">{t.switchNoStorage}</p>
              {/if}
              <!-- One group: on a phone the two stand one under the other, at one width. -->
              <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button class="w-full sm:w-auto" data-testid="switch-confirm" onclick={() => void switchWallet()}>
                  {t.switchYes}
                </Button>
                <Button class="w-full sm:w-auto" data-testid="switch-cancel" onclick={keepWallet}>{t.switchNo}</Button>
              </div>
            </div>
          </Notice>
        {:else}
          <!-- What the last try came to, right above the button that was pressed. -->
          {#if outcome !== null}
            <ChooseAnswer {outcome} />
          {/if}
          <div>
            <Button
              variant="quiet"
              data-testid="opened-choose"
              {busy}
              busyText={t.unlockBusy}
              onclick={() => void choose()}
            >
              {t.unlockPicker}
            </Button>
          </div>
        {/if}
      </li>

      <li class="space-y-3 py-5">
        <h3 class="text-balance text-base font-semibold text-ink-800">{t.emptyChangedTitle}</h3>
        <p class="text-pretty text-sm leading-relaxed text-ink-700">{t.emptyChangedBody}</p>
        <Rows>
          <Row name={t.walletFingerprint}><Mono value={fingerprint} data-testid="wallet-fingerprint" /></Row>
        </Rows>
        <p class="text-pretty text-sm text-ink-500">{t.walletFingerprintIs}</p>
        <!-- At the size of the text around it, and with a tap area of its own. -->
        <p class="text-sm">
          <TextLink class={ALONE} href={router.link({ name: 'settings' })}>{c.section_settings}</TextLink>
        </p>
      </li>
    </ol>
  </Section>
</div>
