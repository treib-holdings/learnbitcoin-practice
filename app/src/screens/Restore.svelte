<script lang="ts">
  // Restore: bring a practice wallet back from its 12 words.
  //
  // It is the one screen of the app that asks for 12 words, so it says
  // first why it may: the exception paragraph (strings/restore.ts). Then,
  // in this order: that the words will be kept in this browser, not
  // encrypted, and must never guard real money; the twelve fields; the box
  // "these are practice words"; the button. The button works only with
  // twelve good words and the box ticked. Pressed without them, the fields
  // say what is wrong with the words, and a line under the box asks for it.
  //
  // The wallet looks for the words' practice history before anything is
  // stored. While it looks, the button says so and holds keyboard focus:
  // the fields are switched off, and a field that had focus (Enter in the
  // last one starts the look) would otherwise drop it on the page itself.
  // Every answer has its text (restoreView and keepView in front/flow.ts):
  //   restored    history was found and the wallet is stored: on to /wallet
  //   empty       none was found and nothing is stored. The step "No
  //               practice coins found for these words" opens: what to do
  //               if they are a real wallet's words, then "Keep them here
  //               anyway" or "Erase". It is open for as long as the wallet
  //               holds the words (wallet.pendingRestore), on the visit of
  //               the screen whose look found nothing, and on no other
  //   failed      the practice network could not be asked: the cause, and
  //               that the words were not stored and are still in the fields
  //   invalid, broken
  //               their sentences, above the button
  //   exists, no-storage, reload
  //               the whole screen stops, and says why (FrontGate)
  //
  // The words are in the fields and nowhere else: the screen hands them to
  // the wallet in the same breath as it reads them, and keeps no copy. When
  // the reader leaves the screen with the step open, the wallet is told to
  // erase the words it was holding. If the reader leaves while the look is
  // still under way and it then finds nothing, they are erased when the
  // answer comes. Should the reader be back on this screen by then, that
  // answer changes nothing on the new visit: what they have typed since
  // stays in the fields.
  //
  // Before any of that the screen looks at what this browser holds, as
  // Create does: a wallet that is here already, something stored that
  // cannot be read, and a browser that refuses to store anything each stand
  // in the screen's place.

  import { onDestroy, tick } from 'svelte';
  import Actions from '../components/Actions.svelte';
  import Button from '../components/Button.svelte';
  import Checkbox from '../components/Checkbox.svelte';
  import Notice from '../components/Notice.svelte';
  import OutLink from '../components/OutLink.svelte';
  import Page from '../components/Page.svelte';
  import { busyWhile } from '../components/status.svelte.ts';
  import { TAP } from '../components/styles.ts';
  import { SAFARI_KEEPS_DAYS } from '../components/wallet/frame.ts';
  import PasskeyProblem from '../components/wallet/PasskeyProblem.svelte';
  import WordsInput from '../components/wallet/WordsInput.svelte';
  import { fill } from '../lib/format.ts';
  import { focusHeading, navigate, router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import FrontGate from './front/FrontGate.svelte';
  import {
    chapterFourUrl,
    frontGate,
    keepView,
    restoreHeldBy,
    restoreView,
    type Gate,
    type RestoreView,
    type Stop,
  } from './front/flow.ts';

  const wallet = useWallet();
  const id = $props.id();

  let t = $derived(strings.restore[router.lang]);
  let c = $derived(strings.common[router.lang]);
  let w = $derived(strings.wallet[router.lang]);
  let errors = $derived(strings.errors[router.lang]);

  /** What is said above the button, or above the fields, after a try that restored nothing. */
  type Problem = Extract<RestoreView, { kind: 'invalid' | 'failed' | 'broken' }> | { kind: 'lost' };

  /** The reader has said that these are practice words. */
  let ticked = $state(false);
  /** "Restore" was pressed while the box was not ticked. */
  let asked = $state(false);
  /** The practice network is being asked about the words. Nothing is stored yet. */
  let busy = $state(false);
  let problem = $state.raw<Problem | null>(null);
  /** How the last try ended, when that stopped the whole screen. */
  let stop = $state<Stop | null>(null);
  /** The browser would not store the words the reader chose to keep. They go on waiting. */
  let refused = $state(false);

  /** That the words are kept here, not encrypted, and that a browser can erase them: how soon Safari does is a slot. */
  let kept = $derived(fill(t.kept, { days: String(SAFARI_KEEPS_DAYS) }));

  /**
   * The words that wait are this visit's own: it was this visit's look that
   * found nothing. A look can outlive the visit that asked for it (the
   * reader goes Back while it runs, and may be here again when it ends).
   * Its answer is the old visit's to deal with. It must not open the step
   * on the new one, over words the reader has typed since. (True from the
   * start where words already wait as the screen opens, which only the
   * development gallery arranges.)
   */
  let own = $state(wallet.pendingRestore);
  /** The step "No practice coins found" is open: the wallet holds this visit's words until the reader chooses. */
  let pending = $derived(own && wallet.pendingRestore);
  // Held open while the look is under way, so that a wallet it has just
  // stored does not show as "already here" before the screen moves on. And
  // while words are waiting, a browser that will not store them does not
  // take the step away: the reader can still erase them, or choose again.
  let gate = $derived<Gate>(busy ? 'open' : frontGate(wallet.status, wallet.canStore || pending, stop));
  let step = $derived(gate === 'open' && pending);
  let needsBox = $derived(asked && !ticked);

  let root = $state<HTMLElement>();
  let input = $state<ReturnType<typeof WordsInput>>();

  /** True once the screen has left the page. */
  let gone = false;

  function within(hook: string): HTMLElement | null {
    return root?.querySelector<HTMLElement>(`[data-testid="${hook}"]`) ?? null;
  }

  /** After a try that restored nothing: what went wrong is brought on screen, and focus stays on the button. */
  async function show(): Promise<void> {
    await tick();
    within('restore-problem')?.scrollIntoView({ block: 'nearest' });
    // The button took focus when the look began. Should it have gone astray since, it comes back here.
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (lost) within('restore-go')?.focus();
  }

  async function go(): Promise<void> {
    if (busy) return;
    // What an earlier try was answered with has had its say, also when the form itself stops this one.
    problem = null;
    // null: the fields say what is wrong with the words, and focus is on the first wrong one.
    const words = input?.check() ?? null;
    const held = restoreHeldBy(words !== null, ticked);
    asked = !ticked;
    if (words === null || held !== null) {
      if (held === 'box') within('restore-check')?.focus();
      return;
    }
    // The fields and the box are about to be switched off. If one of them
    // has focus (Enter in the last field starts the look), the button takes
    // it: it stays on the screen, and it says what the page is doing.
    if (document.activeElement instanceof HTMLInputElement) within('restore-go')?.focus();
    busy = true;
    own = false;
    stop = null;
    const view = restoreView(await busyWhile(wallet.restore(words)));
    if (gone) {
      // Nobody is here to choose: words that found nothing are let go at once.
      if (view.kind === 'empty') wallet.eraseRestored();
      return;
    }
    switch (view.kind) {
      case 'restored':
        // The wallet is stored and its coins are known. `busy` stays set, so
        // this screen shows nothing new in the moment before it leaves. The
        // wallet takes this screen's place in the history: Back from there
        // leads past a Restore that could only say a wallet is here already.
        navigate(router.link({ name: 'wallet' }), { replace: true });
        return;
      case 'empty':
        // The words that wait are this visit's: the step opens, and the fields go with the form.
        own = true;
        busy = false;
        ticked = false;
        asked = false;
        refused = false;
        await tick();
        focusHeading();
        return;
      case 'stopped':
        // FrontGate takes the screen's place and moves focus to the heading.
        busy = false;
        stop = view.why;
        return;
      case 'invalid':
      case 'failed':
      case 'broken':
        busy = false;
        problem = view;
        return show();
    }
  }

  function keep(): void {
    const view = keepView(wallet.keepRestored());
    switch (view.kind) {
      case 'restored':
        navigate(router.link({ name: 'wallet' }), { replace: true });
        return;
      case 'stopped':
        stop = view.why;
        return;
      case 'refused':
        // The words go on waiting, and the two buttons stay. (Should the wallet
        // have let go of them all the same, the reader is told so: see "lost".)
        if (wallet.pendingRestore) {
          refused = true;
          void tick().then(() => within('restore-problem')?.scrollIntoView({ block: 'nearest' }));
          return;
        }
        problem = { kind: 'lost' };
        void tick().then(focusHeading);
        return;
      case 'lost':
        // Nothing was waiting any more. Should the wallet still say otherwise, it is told to let go.
        wallet.eraseRestored();
        refused = false;
        problem = { kind: 'lost' };
        void tick().then(focusHeading);
        return;
    }
  }

  async function erase(): Promise<void> {
    wallet.eraseRestored();
    refused = false;
    // Back at the empty fields: the step is gone, and so is the button that was pressed.
    await tick();
    focusHeading();
  }

  // Words that wait for a choice do not outlive the screen they were typed on.
  onDestroy(() => {
    gone = true;
    if (wallet.pendingRestore) wallet.eraseRestored();
  });

  const TEXT = 'text-pretty leading-relaxed text-ink-700';
  /** A link that stands by itself, with a tap area 44 px tall (styles.ts). */
  const LONE_LINK = `inline-block ${TAP}`;
</script>

<Page
  title={step ? t.emptyTitle : c.screen_restore}
  titleName={step ? t.emptyName : undefined}
  lede={gate === 'open' && !pending ? t.lede : undefined}
>
  <FrontGate {gate} {stop}>
    <div bind:this={root} class="space-y-6">
      {#if pending}
        <div class="space-y-4" data-testid="restore-empty">
          <p class={TEXT}>{t.emptyBody}</p>
          <Notice kind="caution" text={t.emptyReal} />
          <p class={TEXT}>{t.emptyPractice}</p>
        </div>
        {#if refused}
          <Notice kind="problem" text={t.keepRefused} data-testid="restore-problem" />
        {/if}
        <!-- Two full-size buttons of one weight: neither choice is the page's to make. -->
        <Actions>
          <Button class="w-full sm:w-auto" data-testid="restore-keep" onclick={keep}>{t.keep}</Button>
          <Button class="w-full sm:w-auto" data-testid="restore-erase" onclick={() => void erase()}>{t.erase}</Button>
        </Actions>
      {:else}
        {#if problem !== null && problem.kind === 'lost'}
          <Notice kind="problem" text={t.lost} data-testid="restore-problem" />
        {/if}

        <!-- Why this page may ask for 12 words, and what becomes of them, before any field. The box
             under the fields names both as its description, so a screen reader that goes from
             control to control reads them where the reader says "these are practice words". -->
        <div id="{id}-rules" class="space-y-6">
          <Notice kind="caution" text={t.exception} data-testid="restore-exception">
            <OutLink class={LONE_LINK} href={chapterFourUrl(wallet.config.siteUrl, router.lang)}>{t.chapter}</OutLink>
          </Notice>
          <Notice data-testid="restore-kept">
            <div class="space-y-2">
              <p>{kept}</p>
              <p>{t.never}</p>
            </div>
          </Notice>
        </div>

        <WordsInput bind:this={input} data-testid="restore-words" disabled={busy} onenter={() => void go()} />

        <div class="space-y-2">
          <Checkbox
            bind:checked={ticked}
            data-testid="restore-check"
            disabled={busy}
            aria-invalid={needsBox ? 'true' : undefined}
            aria-describedby={needsBox ? `${id}-box ${id}-rules` : `${id}-rules`}
          >
            {t.check}
          </Checkbox>
          {#if needsBox}
            <p
              id="{id}-box"
              role="alert"
              class="text-pretty text-sm font-semibold leading-relaxed text-ink-800"
              data-testid="restore-check-needed"
            >
              {t.checkNeeded}
            </p>
          {/if}
        </div>

        <!-- What went wrong, right above the button that was pressed. -->
        {#if problem !== null && problem.kind === 'failed'}
          <Notice kind="problem" text={errors[problem.reason]} data-testid="restore-problem">
            <p>{t.failedKept}</p>
          </Notice>
        {:else if problem !== null && problem.kind === 'invalid'}
          <Notice kind="problem" text={w.wordsInvalid} data-testid="restore-problem" />
        {:else if problem !== null && problem.kind === 'broken'}
          <PasskeyProblem failure={{ kind: 'broken' }} data-testid="restore-problem" />
        {/if}

        <!-- While the wallet looks, the button itself says so: it is where the reader's eyes and the keyboard's focus are. -->
        <div>
          <Button
            variant="primary"
            class="w-full sm:w-auto"
            data-testid="restore-go"
            {busy}
            busyText={t.looking}
            onclick={() => void go()}
          >
            {t.go}
          </Button>
        </div>
      {/if}
    </div>
  </FrontGate>
</Page>
