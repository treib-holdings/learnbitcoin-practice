<script lang="ts">
  // The unlock step: wherever a passkey wallet's keys are needed, which is
  // to sign a payment and to show the 12 words.
  //
  //   <Unlock why={t.unlockWhy} promise onunlocked={(how) => ...} />
  //
  // Show it only while wallet.unlocked is false, from a state of your own
  // (a step of the screen), and leave it there until it calls `onunlocked`.
  // A wallet made without a passkey is always unlocked and never shows this
  // step; for such a wallet the piece draws nothing.
  //
  // What the reader sees: `why`, one short line that says what the keys are
  // needed for; with `promise`, "Unlocking sends nothing. You will check the
  // payment first."; and one button, for the passkey this browser
  // remembers. After a try that did not open the wallet it also offers
  // another passkey, and the 12 words.
  //
  // Every answer the wallet can give has its text here:
  //   unlocked       onunlocked('same')
  //   tampered       onunlocked('tampered'): the saved details were wrong and
  //                  were rebuilt, and the coins are being looked up again
  //   other-passkey  the reader is asked before anything changes: that
  //                  passkey's name and wallet fingerprint, then "Switch" or
  //                  "Keep". After a switch: onunlocked('switched')
  //   changed        never opened: the words, or Remove (on Settings) and
  //                  then Open
  //   gone           the wallet changed in another tab: Reload
  //   cancelled, timed out, no-prf, error, busy, reload, broken
  //                  the sentence from the error table (PasskeyProblem)
  // and the same for the words: unlocked, not valid, another wallet's, gone,
  // reload, broken.
  //
  // After 'tampered' and 'switched' a screen must drop what it had worked
  // out from the coins (a planned payment): they are another wallet's, or
  // are being looked up afresh. What happened is told to the reader by the
  // wallet frame, above the screen's content, so the step must sit inside a
  // WalletFrame, as every wallet screen does. Then focus goes to the
  // screen's heading.
  //
  // What went wrong always stands right above the buttons the step shows,
  // also under the fields for the 12 words: a reader looks at the button
  // they pressed, and on a phone the top of the step is a screenful away
  // from it. After an answer the step also brings it on screen.
  //
  // While a passkey prompt is open, <main> is marked busy (busyWhile).
  //
  // If the reader goes to another screen while a prompt is open, the step
  // is gone when the wallet answers. It then says nothing, moves nothing
  // and does not call `onunlocked`: none of it would be for the screen that
  // is showing. Whether the keys were loaded is the wallet's to say
  // (wallet.unlocked). A question about another passkey's wallet is
  // withdrawn, so that it does not wait for the reader somewhere else.

  import { onDestroy, tick } from 'svelte';
  import { focusHeading, router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import Actions from '../Actions.svelte';
  import Button from '../Button.svelte';
  import Card from '../Card.svelte';
  import Notice from '../Notice.svelte';
  import { busyWhile } from '../status.svelte.ts';
  import TextLink from '../TextLink.svelte';
  import { splitLead } from '../text.ts';
  import { useFrameNotes } from './frame-notes.ts';
  import PasskeyProblem from './PasskeyProblem.svelte';
  import ReloadButton from './ReloadButton.svelte';
  import {
    problemOfUnlock,
    problemOfWords,
    unlockOffers,
    type Unlocked,
    type UnlockProblem,
  } from './unlock-flow.ts';
  import WalletId from './WalletId.svelte';
  import WordsInput from './WordsInput.svelte';

  interface Props {
    /** One short line: what the keys are needed for on this screen. */
    why: string;
    /** Say that unlocking sends nothing, and that the payment is checked first. For Send. */
    promise?: boolean;
    /** The keys are loaded. `how` says whether anything else changed (see the top of this file). */
    onunlocked: (how: Unlocked) => void;
    class?: string;
  }

  let { why, promise = false, onunlocked, class: extra = '' }: Props = $props();

  const wallet = useWallet();
  const notes = useFrameNotes();

  let t = $derived(strings.wallet[router.lang]);
  let c = $derived(strings.common[router.lang]);

  /** Which passkey prompt is open, if one is. */
  let busy = $state<'stored' | 'picker' | null>(null);
  /** What went wrong at the last try. */
  let problem = $state.raw<UnlockProblem | null>(null);
  /** Some try has ended without opening the wallet: the other two ways on are offered from then on. */
  let refused = $state(false);
  /** The fields for the 12 words are open. */
  let typing = $state(false);

  let offers = $derived(unlockOffers(problem, refused));
  /** The question about another passkey's wallet: what happened, in bold, and then that nothing has changed. */
  let asked = $derived(splitLead(t.switchLead));
  /** Another passkey answered, and the reader has not yet said whether to switch to its wallet. */
  let pending = $derived(wallet.pendingSwitch);
  /** Only a passkey wallet that is locked has anything to unlock. */
  let shown = $derived(wallet.record?.kind === 'passkey' && !wallet.unlocked);

  let root = $state<HTMLElement>();
  /** What went wrong, and the buttons under it. */
  let answered = $state<HTMLElement>();
  let input = $state<ReturnType<typeof WordsInput>>();

  /** True once the step has left the screen. */
  let gone = false;

  /**
   * Brings what the step has just answered on screen. The answer and the
   * buttons under it, when the screen has room for both, so that the reader
   * sees what went wrong and still has the button they pressed. Otherwise
   * the answer alone, and one that is taller than the screen from its first
   * line, where the cause is. Nothing moves when it is all on screen already.
   */
  async function showAnswer(): Promise<void> {
    await tick();
    const answer = root?.querySelector<HTMLElement>('[data-testid="unlock-problem"]');
    if (!answer || !answered) return;
    // The banner at the top of the screen covers a strip of it: index.html sets that much aside.
    const covered = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const room = window.innerHeight - covered;
    const fits = (element: HTMLElement): boolean => element.getBoundingClientRect().height <= room;
    if (fits(answered)) answered.scrollIntoView({ block: 'nearest' });
    else answer.scrollIntoView({ block: fits(answer) ? 'nearest' : 'start' });
  }

  /**
   * Moves focus to one of the step's own controls, by its test hook. When
   * the last answer took that control away, focus goes to "Use the 12
   * words", or else to the first thing left to press in the step. When
   * nothing is left to press, focus is left alone: the answer is an alert
   * and has been read out.
   */
  async function focusOn(hook: string): Promise<void> {
    await tick();
    const within = (selector: string): HTMLElement | null => root?.querySelector<HTMLElement>(selector) ?? null;
    (within(`[data-testid="${hook}"]`) ?? within('[data-testid="unlock-words"]') ?? within('a[href], button'))?.focus();
  }

  /**
   * After an answer that opened nothing. The control that was pressed keeps
   * focus while it is still there. When the answer took it away, focus has
   * fallen back to the page itself, and is put on what is left to press.
   */
  async function keepFocus(pressed: string): Promise<void> {
    await tick();
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (lost) await focusOn(pressed);
  }

  /** The keys are loaded: tell the frame what else changed, tell the screen, and move focus to its heading. */
  async function finish(how: Unlocked, done: (how: Unlocked) => void): Promise<void> {
    problem = null;
    typing = false;
    done(how);
    await tick();
    focusHeading();
  }

  async function unlock(how: 'stored' | 'picker'): Promise<void> {
    if (busy !== null) return;
    // Read now: once the keys are loaded the screen may take this step away.
    const done = onunlocked;
    const from = router.path;
    busy = how;
    problem = null;
    const result = await busyWhile(wallet.unlock(how));
    if (gone) {
      // The step left the screen while the prompt was open. A question about
      // another passkey's wallet would now wait in the wallet, and the next
      // unlock step to open, on any screen, would start with it, "Switch"
      // one tap away. Nobody is here to answer it, so it is withdrawn.
      if (result.kind === 'other-passkey') wallet.cancelSwitch();
      // Two things take a step away. The reader went to another screen: then
      // the answer is not for the screen that is showing, and nothing more
      // happens here. Or the step's own screen took it away the moment the
      // keys were loaded: that screen is still showing and is still told.
      const opened = result.kind === 'unlocked' || result.kind === 'tampered';
      if (!opened || router.path !== from) return;
    }
    busy = null;
    switch (result.kind) {
      case 'unlocked':
        return finish('same', done);
      case 'tampered':
        if (notes !== null) notes.note = { kind: 'tampered' };
        return finish('tampered', done);
      case 'other-passkey':
        // Nothing has changed. The wallet now holds the question (pendingSwitch), and it shows below.
        refused = true;
        return focusOn('switch-question');
      default:
        refused = true;
        problem = problemOfUnlock(result);
        await keepFocus(how === 'stored' ? 'unlock' : 'unlock-picker');
        return showAnswer();
    }
  }

  function switchWallet(): void {
    const other = wallet.pendingSwitch;
    const done = onunlocked;
    const result = wallet.confirmSwitch();
    if (result === 'switched') {
      if (notes !== null && other !== null) notes.note = { kind: 'switched', ...other };
      void finish('switched', done);
      return;
    }
    if (result === 'gone') problem = { kind: 'gone' };
    if (result === 'no-storage') problem = { kind: 'no-storage' };
    void focusOn('unlock').then(showAnswer);
  }

  function keepWallet(): void {
    wallet.cancelSwitch();
    void focusOn('unlock');
  }

  async function openWords(): Promise<void> {
    typing = true;
    problem = null;
    await tick();
    input?.focus();
  }

  function closeWords(): void {
    typing = false;
    problem = null;
    void focusOn('unlock-words');
  }

  function unlockWithWords(): void {
    // null: the fields say what is wrong, and focus is on the first wrong one.
    const words = input?.check() ?? null;
    if (words === null) return;
    const done = onunlocked;
    const result = wallet.unlockWithWords(words);
    if (result === 'unlocked') {
      void finish('same', done);
      return;
    }
    problem = problemOfWords(result);
    // A dead end closes the fields: there is nothing left to type.
    if (!unlockOffers(problem, true).words) {
      typing = false;
      void keepFocus('unlock-words-go').then(showAnswer);
      return;
    }
    // The fields stay, and the answer stands under them, above the button that was pressed.
    void showAnswer();
  }

  // A question left unanswered must not wait for the reader on another
  // screen. One that arrives after this (the prompt was still open) is
  // withdrawn in unlock().
  onDestroy(() => {
    gone = true;
    if (wallet.pendingSwitch !== null) wallet.cancelSwitch();
  });
</script>

{#if shown}
  <div bind:this={root} class={extra}>
    <Card title={t.unlockTitle} data-testid="unlock-step">
      <div class="space-y-4">
        <div class="space-y-2 text-pretty text-base leading-relaxed text-ink-700">
          <p>{why}</p>
          {#if promise}<p>{t.unlockPromise}</p>{/if}
        </div>

        {#if pending !== null}
          <Notice kind="caution">
            <div class="space-y-3">
              <!-- tabindex="-1": it takes focus from code only, so that the question is read out. -->
              <p tabindex="-1" data-testid="switch-question" class="outline-none">
                <span class="font-semibold text-ink-800">{asked.lead}</span>
                {asked.rest}
              </p>
              <WalletId tag={pending.tag} fingerprint={pending.fingerprint} />
              <p>{t.switchAsk}</p>
              <!-- Full-size buttons with room between them: one of the two changes which wallet this browser holds. -->
              <Actions>
                <Button data-testid="switch-confirm" onclick={switchWallet}>{t.switchYes}</Button>
                <Button data-testid="switch-cancel" onclick={keepWallet}>{t.switchNo}</Button>
              </Actions>
            </div>
          </Notice>
        {:else}
          {#if typing}
            <!-- What the reader should know before typing stands above the fields, never under the button. -->
            <Notice kind="caution" text={t.wordsException} />
            <p class="text-pretty text-sm leading-relaxed text-ink-600">{t.unlockWordsLead}</p>
            <WordsInput bind:this={input} onenter={unlockWithWords} />
          {/if}

          <!-- What went wrong, right above the buttons: that is where the
               reader is looking. showAnswer() brings the two on screen together. -->
          <div bind:this={answered} class="space-y-4">
            {#if problem !== null}
              {#if problem.kind === 'passkey'}
                <PasskeyProblem failure={problem.failure} data-testid="unlock-problem" />
              {:else if problem.kind === 'changed'}
                <!-- The gravest answer, in short paragraphs: what happened, the warning by itself, then each way out. -->
                <Notice kind="problem" text={t.unlockChanged} data-testid="unlock-problem">
                  <div class="space-y-2">
                    <p class="font-semibold text-ink-800" data-testid="unlock-changed-warning">{t.unlockChangedWarn}</p>
                    <p>{t.unlockChangedWords}</p>
                    <p>{t.unlockChangedRemove}</p>
                    <p><TextLink href={router.link({ name: 'settings' })}>{c.section_settings}</TextLink></p>
                  </div>
                </Notice>
              {:else if problem.kind === 'gone'}
                <Notice kind="problem" text={t.unlockGone} data-testid="unlock-problem">
                  <ReloadButton />
                </Notice>
              {:else if problem.kind === 'words-invalid'}
                <Notice kind="problem" text={t.wordsInvalid} data-testid="unlock-problem" />
              {:else if problem.kind === 'other-wallet'}
                <Notice kind="problem" text={t.unlockOtherWallet} data-testid="unlock-problem">
                  <TextLink href={router.link({ name: 'settings' })}>{c.section_settings}</TextLink>
                </Notice>
              {:else}
                <Notice kind="problem" text={t.switchNoStorage} data-testid="unlock-problem" />
              {/if}
            {/if}

            {#if typing}
              <Actions>
                <Button variant="primary" data-testid="unlock-words-go" onclick={unlockWithWords}>{t.unlockWordsGo}</Button>
                <Button onclick={closeWords}>{t.unlockWordsBack}</Button>
              </Actions>
            {:else if offers.stored || offers.picker || offers.words}
              <Actions>
                {#if offers.stored}
                  <Button
                    variant="primary"
                    data-testid="unlock"
                    busy={busy === 'stored'}
                    busyText={t.unlockBusy}
                    disabled={busy === 'picker'}
                    onclick={() => void unlock('stored')}
                  >
                    {t.unlockButton}
                  </Button>
                {/if}
                {#if offers.picker}
                  <Button
                    data-testid="unlock-picker"
                    busy={busy === 'picker'}
                    busyText={t.unlockBusy}
                    disabled={busy === 'stored'}
                    onclick={() => void unlock('picker')}
                  >
                    {t.unlockPicker}
                  </Button>
                {/if}
                {#if offers.words}
                  <Button data-testid="unlock-words" disabled={busy !== null} onclick={() => void openWords()}>
                    {t.unlockWords}
                  </Button>
                {/if}
              </Actions>
            {/if}
          </div>
        {/if}
      </div>
    </Card>
  </div>
{/if}
