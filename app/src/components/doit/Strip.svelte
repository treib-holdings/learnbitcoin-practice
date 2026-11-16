<script lang="ts">
  // The strip: a slim line under the header that says which "Do it" step
  // the reader is following, which part of it is next, and how to get back
  // to it.
  //
  // A step sends the reader into the wallet: to Receive for coins, to Send
  // for a payment, to Settings to remove the wallet. Those are the wallet's
  // own screens, and nothing on them knows about the step. The strip is
  // what keeps the two together. It shows on every screen but the step's
  // own, for as long as the step is followed (and for 24 hours after it was
  // last followed: lib/doit/progress.ts, stripStep).
  //
  //   wide     Do it | the step | part 2 of 3: the part's name | Back to the step | Stop following
  //   narrow   the step | 2 of 3 | Back to the step | (a small cross that stops following)
  //
  // Where the part cannot be done yet, or waits for a block, the strip
  // says that in the place of the part's name: "first: get practice coins",
  // "waiting for a block, sent 12 seconds ago". The narrow form has no room
  // for both, so there those words take the place of "2 of 3" (stripSpeaks
  // in strip.ts says when), on a second line if they need one: a reader on
  // a phone must not be left with "3 of 4" over a screen whose main button
  // would lead them astray. (The wait is said on the
  // screens where the wallet goes on reading what the wait is read from,
  // its coins or its list of transactions: on the others the strip names
  // the part.) Once the step is done the
  // strip says so, in both forms and once through the status region, and
  // offers the way back to the chapter beside the way back to the step. It
  // then stays until the reader opens the step or closes the strip.
  //
  // The strip knows nothing itself. Which step, and where it stands, come
  // from the note and from judge() (through useDoit()), so it is the same
  // after a page load: the faucet's bot check turns every move between
  // screens into one, and the strip is there again on the next page.
  //
  // The separators between its parts are drawn, not typed: the string
  // tables hold plain ASCII, and a screen reader has no use for a dot.

  import { tick } from 'svelte';
  import { useDoit } from '../../lib/doit/doit-context.ts';
  import { chapterLink, stripStep, watchedScreen } from '../../lib/doit/progress.ts';
  import type { StepId } from '../../lib/doit/steps.ts';
  import { fill } from '../../lib/format.ts';
  import { focusHeading, router } from '../../lib/router.svelte.ts';
  import { readsCoins, readsTransactions } from '../../lib/router.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import { announce } from '../status.svelte.ts';
  import { FOCUS } from '../styles.ts';
  import ChapterLink from './ChapterLink.svelte';
  import { stepTitle, stripCount, stripShows, stripSpeaks, stripText, stripView } from './strip.ts';

  const wallet = useWallet();
  const doit = useDoit();

  let lang = $derived(router.lang);
  let t = $derived(strings.doit[lang]);

  /** The time, for "sent 12 seconds ago" and for the 24 hours a strip lasts. */
  let now = $state(Date.now());

  /** The step the strip is for, or null: none is followed, or the reader is on that step's own screen. */
  let step = $derived.by<StepId | null>(() => {
    const followed = stripStep(doit.progress, now);
    if (followed === null) return null;
    const route = router.route;
    return route.name === 'step' && route.id === followed ? null : followed;
  });

  /**
   * What the wallet keeps reading on this screen: only where the wait is read does the strip say "waiting for a block".
   * The screen is the one the wallet is told (a done step's screen is told as the list of steps, and reads nothing).
   */
  let watched = $derived(watchedScreen(router.route, doit.progress));
  let live = $derived({ coins: readsCoins(watched), list: readsTransactions(watched) });

  let strip = $derived(step === null ? null : stripView(doit.view(step, now), live));
  let done = $derived(strip !== null && strip.says.kind === 'done');
  let count = $derived(strip === null ? { long: '', short: '' } : stripCount(strip, lang));
  let says = $derived(strip === null ? '' : stripText(strip, lang, now));
  /** On a narrow screen: the words in the place of "2 of 3", where the reader has to know them here. */
  let speaks = $derived(strip !== null && stripSpeaks(strip));

  /** The way back to the chapter, offered once the step is done: it carries the mark the chapter stamps on. */
  let chapter = $derived(step !== null && done ? chapterLink(wallet.config.siteUrl, step, lang, doit.progress.steps[step]) : null);

  // A clock is outside Svelte, so an effect follows it: every second while
  // the strip counts the time since a payment was sent, and now and then
  // otherwise, which is often enough for a strip that lasts 24 hours.
  let counting = $derived(strip !== null && strip.says.kind === 'waiting' && strip.says.sentAt !== null);
  $effect(() => {
    if (step === null) return;
    const timer = setInterval(() => (now = Date.now()), counting ? 1000 : 30_000);
    return () => clearInterval(timer);
  });

  // "Done" is an outcome, so it is said through the status region as well,
  // once for a step. It is said a moment after the screen has settled, and
  // on the screen the reader has landed on: a step is often done by the
  // very thing that changes the screen (a restore ends on the Overview),
  // and the status region is emptied when the screen changes.
  let saidDone: StepId | null = null;
  $effect(() => {
    void router.path;
    if (step === null || !done || saidDone === step) return;
    const finished = step;
    const text = fill(t.saidDone, { step: stepTitle(finished, lang) });
    const timer = setTimeout(() => {
      saidDone = finished;
      announce(text);
    }, 0);
    return () => clearTimeout(timer);
  });

  /** "Stop following", and the cross that closes a done strip: the strip goes, on every screen. */
  async function stop(): Promise<void> {
    if (step === null) return;
    doit.stop(step);
    // The button that was pressed is gone with the strip.
    await tick();
    focusHeading();
  }

  /** A dot between two parts of the line. Drawn, and not said. */
  const DOT = 'mx-2 inline-block h-1 w-1 rounded-full bg-ink-400 align-middle';
  const BACK = `rounded-sm font-semibold text-ink-800 underline underline-offset-2 hover:text-orange-700 ${FOCUS}`;
</script>

{#if strip !== null && step !== null && stripShows(strip)}
  <aside
    aria-label={t.stripLabel}
    data-testid="strip"
    data-step={step}
    data-says={strip.says.kind}
    class="border-b border-orange-200 bg-orange-50 text-sm leading-snug text-ink-700"
  >
    <!-- On a phone: the words and the cross on one line, the links on the next. Two lines, never
         three: with the cross after the links, a done strip's two links wrapped inside themselves
         on the narrowest screen. From 480 px it is one line: the words, the links, "Stop following". -->
    <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-6 py-2">
      <p class="min-w-0 flex-1 text-pretty">
        <!-- "Do it" in front, on a screen that has the room. -->
        <span class="mr-2 hidden text-xs font-semibold uppercase tracking-widest text-orange-700 min-[480px]:inline">{t.name}</span>
        {#if done}
          <span class="font-semibold text-ink-800" data-testid="strip-says">{says}</span>
        {:else}
          <span class="font-semibold text-ink-800">{stepTitle(step, lang)}</span>
          <span class={DOT} aria-hidden="true"></span>
          <!-- The narrow form: how far the step is. Where the reader has to know more on this very screen, the words instead. -->
          <span class="min-[480px]:hidden" data-testid="strip-short">{speaks ? says : count.short}</span>
          <span class="hidden min-[480px]:inline">{count.long}: <span data-testid="strip-says">{says}</span></span>
        {/if}
      </p>
      <div class="order-3 flex w-full items-center gap-x-4 whitespace-nowrap min-[480px]:order-2 min-[480px]:w-auto">
        <a href={router.link({ name: 'step', id: step })} class={BACK} data-testid="strip-back">{t.stripBack}</a>
        {#if chapter !== null}
          <ChapterLink look="strip" href={chapter} data-testid="strip-chapter">{t.back}</ChapterLink>
        {/if}
      </div>
      <!-- Its words on a screen that has the room, and a small cross on a phone. A screen reader is told the words either way. -->
      <button
        type="button"
        data-testid="strip-stop"
        class={['order-2 shrink-0 rounded-sm text-ink-600 hover:text-orange-700 min-[480px]:order-3', FOCUS]}
        onclick={() => void stop()}
      >
        <span class="sr-only min-[480px]:not-sr-only min-[480px]:underline min-[480px]:underline-offset-2"
          >{done ? t.stripClose : t.stripStop}</span
        >
        <svg class="h-5 w-5 min-[480px]:hidden" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"
          ><path d="M5 5l10 10M15 5L5 15" /></svg
        >
      </button>
    </div>
  </aside>
{/if}
