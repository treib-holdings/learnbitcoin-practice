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
  // another passkey, and the 12 words. With `refused` it offers all three
  // from the start: for a screen that has already seen a try fail and now
  // sends the reader here for the other ways on.
  //
  // Every answer the wallet can give has its text here:
  //   unlocked       onunlocked('same')
  //   tampered       onunlocked('tampered'): the saved details were wrong and
  //                  were rebuilt, and the coins are being looked up again
  //   other-passkey  the reader is asked before anything changes: that
  //                  passkey's name and wallet fingerprint, then "Switch" or
  //                  "Keep" (SwitchQuestion.svelte). After a switch:
  //                  onunlocked('switched'). If the browser will not store
  //                  the switch, the question stays and says so
  //   changed        never opened: the words, or Remove (on Settings) and
  //                  then Open
  //   gone           the wallet changed in another tab: Reload
  //   cancelled, timed out, no-prf, error, busy, reload, broken
  //                  the sentence from the error table (PasskeyProblem)
  // and the same for the words: unlocked, tampered (as above), not valid,
  // another wallet's, the browser would not store the rebuilt details,
  // gone, reload, broken.
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
  //
  // "Another screen" goes by the app's count of the screens it has put on
  // the page (screen-count.ts), not by the address. The same screen in the
  // other language is the same screen, and a reader who switched language
  // while the prompt was open is still waiting for it. And a reader who
  // went away and is back at this address when the wallet answers is
  // looking at a new screen, which asked for nothing; the one that asked
  // is gone, and telling it would have it take the 12 words, say, for
  // nobody to see.
  //
  // The step can also leave while its screen stays. The screen may take it
  // away itself the moment the keys are loaded (Backup shows the step only
  // for a locked wallet), or the reader may have left it by a way back the
  // screen offers under it. Either way `onunlocked` is still called when
  // the keys load: the screen decides what that means now. Focus then goes
  // to the heading only if it was lost with the step, as it is for a
  // reader who pressed a button of the step and waited: the button is
  // gone, and focus has fallen back to the page. A reader who went on to
  // something else on the screen has focus there, and keeps it.

  import { onDestroy, tick, untrack } from 'svelte';
  import { focusHeading, router } from '../../lib/router.svelte.ts';
  import { screenNumber } from '../screen-count.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import Actions from '../Actions.svelte';
  import Button from '../Button.svelte';
  import Card from '../Card.svelte';
  import Notice from '../Notice.svelte';
  import { busyWhile } from '../status.svelte.ts';
  import TextLink from '../TextLink.svelte';
  import { useFrameNotes } from './frame-notes.ts';
  import PasskeyProblem from './PasskeyProblem.svelte';
  import ReloadButton from './ReloadButton.svelte';
  import SwitchQuestion from './SwitchQuestion.svelte';
  import {
    problemOfUnlock,
    problemOfWords,
    unlockOffers,
    type Unlocked,
    type UnlockProblem,
  } from './unlock-flow.ts';
  import WordsInput from './WordsInput.svelte';

  interface Props {
    /** One short line: what the keys are needed for on this screen. */
    why: string;
    /** Say that unlocking sends nothing, and that the payment is checked first. For Send. */
    promise?: boolean;
    /**
     * Start as the step stands after a try that opened nothing: "Choose
     * another passkey" and "Use the 12 words" are offered beside the first
     * button at once. Read when the step is drawn, and not followed after.
     */
    refused?: boolean;
    /** The keys are loaded. `how` says whether anything else changed (see the top of this file). */
    onunlocked: (how: Unlocked) => void;
    class?: string;
  }

  let { why, promise = false, refused: startRefused = false, onunlocked, class: extra = '' }: Props = $props();

  const wallet = useWallet();
  const notes = useFrameNotes();

  let t = $derived(strings.wallet[router.lang]);
  let c = $derived(strings.common[router.lang]);

  /** Which passkey prompt is open, if one is. */
  let busy = $state<'stored' | 'picker' | null>(null);
  /** What went wrong at the last try. */
  let problem = $state.raw<UnlockProblem | null>(null);
  /**
   * Some try has ended without opening the wallet: the other two ways on are
   * offered from then on. A caller can say that such a try came before this
   * step was drawn.
   */
  let refused = $state(untrack(() => startRefused));
  /** The fields for the 12 words are open. */
  let typing = $state(false);

  let offers = $derived(unlockOffers(problem, refused));
  /** Another passkey answered, and the reader has not yet said whether to switch to its wallet. */
  let pending = $derived(wallet.pendingSwitch);
  /** The reader said "Switch", and the browser would not store the change: the question stays, and says so. */
  let switchRefused = $state(false);
  /** Only a passkey wallet that is locked has anything to unlock. */
  let shown = $derived(wallet.record?.kind === 'passkey' && !wallet.unlocked);

  let root = $state<HTMLElement>();
  /** What went wrong, and the buttons under it. */
  let answered = $state<HTMLElement>();
  let input = $state<ReturnType<typeof WordsInput>>();

  /** True once the step has left the screen. */
  let gone = false;
  /** The screen this step was put on, by the app's count of screens. */
  const screen = screenNumber();

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
    if (!answer) return;
    // The banner at the top of the screen covers a strip of it: index.html sets that much aside.
    const covered = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const room = window.innerHeight - covered;
    const fits = (element: HTMLElement): boolean => element.getBoundingClientRect().height <= room;
    // Inside the question about another passkey's wallet the answer has no buttons of the step's under it.
    if (answered && fits(answered)) answered.scrollIntoView({ block: 'nearest' });
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
    // Read before the screen is told: being told, it may take the step away, and that is no reason to hold back.
    const left = gone;
    done(how);
    await tick();
    // The step was off the screen before its answer came. If the reader has
    // focus somewhere on the screen by now, it stays where they have put it.
    // If it went with the step (the button they pressed is gone), the
    // heading takes it, as for a reader who is still at the step.
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (left && !lost) return;
    focusHeading();
  }

  async function unlock(how: 'stored' | 'picker'): Promise<void> {
    if (busy !== null) return;
    // Read now: once the keys are loaded the screen may take this step away.
    const done = onunlocked;
    busy = how;
    problem = null;
    switchRefused = false;
    const result = await busyWhile(wallet.unlock(how));
    if (gone) {
      // The step left the screen while the prompt was open. A question about
      // another passkey's wallet would now wait in the wallet, and the next
      // unlock step to open, on any screen, would start with it, "Switch"
      // one tap away. Nobody is here to answer it, so it is withdrawn.
      if (result.kind === 'other-passkey') wallet.cancelSwitch();
      // Two things take a step away. The reader went to another screen: then
      // the answer is not for the screen that is showing, and nothing more
      // happens here. Or the step's own screen took it away (the moment the
      // keys were loaded, or by a way back it offers): that screen is still
      // showing and is still told.
      const opened = result.kind === 'unlocked' || result.kind === 'tampered';
      if (!opened || screenNumber() !== screen) return;
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
    switchRefused = false;
    const result = wallet.confirmSwitch();
    if (result === 'switched') {
      if (notes !== null && other !== null) notes.note = { kind: 'switched', ...other };
      void finish('switched', done);
      return;
    }
    if (result === 'no-storage' && wallet.pendingSwitch !== null) {
      // Nothing was switched, and the wallet keeps the offer: the question
      // stays, with the reason above its two answers. The button that was
      // pressed is still there and keeps focus.
      switchRefused = true;
      void showAnswer();
      return;
    }
    // The question is over: the wallet changed in another tab meanwhile, or the offer was withdrawn.
    if (result === 'gone') problem = { kind: 'gone' };
    if (result === 'no-storage') problem = { kind: 'no-storage' };
    void focusOn('unlock').then(showAnswer);
  }

  function keepWallet(): void {
    switchRefused = false;
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

  /**
   * The reader is changing the words in the fields. What the step said
   * about the words that were tried ("valid, but another wallet's") is not
   * about these: left standing, it would read "these 12 words are valid"
   * right under a field that says its word is not on the list.
   */
  function wordsEdited(): void {
    const about = problem?.kind;
    if (about === 'other-wallet' || about === 'words-invalid' || about === 'words-no-storage') problem = null;
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
    if (result === 'tampered') {
      // As after a passkey: the saved details were wrong and have been rebuilt, and the frame says so.
      if (notes !== null) notes.note = { kind: 'tampered' };
      void finish('tampered', done);
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
    // Nothing of the app's state is read here to judge why the step is
    // leaving: during a teardown Svelte answers such a read with the value
    // from before the change that caused it (screen-count.ts).
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
          <!-- Another passkey answered. Nothing changes until the reader says so. -->
          <SwitchQuestion
            {pending}
            refused={switchRefused}
            refusedHook="unlock-problem"
            onswitch={switchWallet}
            onkeep={keepWallet}
          />
        {:else}
          {#if typing}
            <!-- What the reader should know before typing stands above the fields, never under the button. -->
            <Notice kind="caution" text={t.wordsException} />
            <p class="text-pretty text-sm leading-relaxed text-ink-600">{t.unlockWordsLead}</p>
            <WordsInput bind:this={input} onenter={unlockWithWords} onedit={wordsEdited} />
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
              {:else if problem.kind === 'words-no-storage'}
                <!-- The saved details did not fit the words, and the browser would not store the right ones. -->
                <Notice kind="problem" text={t.noStorage} data-testid="unlock-problem" />
              {:else}
                <Notice kind="problem" text={t.switchNoStorage} data-testid="unlock-problem" />
              {/if}
            {/if}

            <!-- The buttons of one group are one width on a phone, where they stand one
                 under the other: a short label must not make a narrow button under a wide one. -->
            {#if typing}
              <Actions>
                <Button variant="primary" class="w-full sm:w-auto" data-testid="unlock-words-go" onclick={unlockWithWords}>
                  {t.unlockWordsGo}
                </Button>
                <Button class="w-full sm:w-auto" onclick={closeWords}>{t.unlockWordsBack}</Button>
              </Actions>
            {:else if offers.stored || offers.picker || offers.words}
              <Actions>
                {#if offers.stored}
                  <Button
                    variant="primary"
                    class="w-full sm:w-auto"
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
                    class="w-full sm:w-auto"
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
                  <Button class="w-full sm:w-auto" data-testid="unlock-words" disabled={busy !== null} onclick={() => void openWords()}>
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
