<script lang="ts">
  // The list of "Do it" steps: /do, /es/do.
  //
  // One sentence on what "Do it" is, then the six steps under the chapter
  // each belongs to. A chapter's name is a link to the chapter on the main
  // site. Each step links to its own screen and says where it stands: not
  // started, started, or done, with the day it was done.
  //
  // The states are read from the note this browser keeps (through
  // useDoit()), and from nothing else: the list judges no step and asks
  // the practice network nothing. Opening it writes nothing either. A note
  // is first written when a step's own screen is opened.
  //
  // At the foot, once something is kept: "Forget my progress", which erases
  // the note and nothing else in this browser, after a question. As with
  // the question before a wallet is removed, the question must be seen
  // before it can be answered: opening it brings the whole of it on screen,
  // and neither answer takes a press in the first moment after it opened.
  // The line above the button says what is stored. For a note, what a note
  // holds. For a stored value that is no note this version can read, that
  // something is stored there which the page cannot read, in the words
  // About uses for it: the sentence written for a note would describe what
  // nobody has read.
  //
  // Under a note that a newer version of this page wrote, the list shows
  // the six steps without states and without "Forget my progress": this
  // version reads nothing of that note and deletes nothing. The notice at
  // the top says so, and offers Reload.
  //
  // The same where the browser did not let this page read its storage: no
  // states (a step shown as "Not started" would be said of a note nobody
  // could look for, and one made before may still be stored), no "Forget my
  // progress", and the notice at the top says that the page cannot tell.

  import { tick } from 'svelte';
  import Actions from '../components/Actions.svelte';
  import Button from '../components/Button.svelte';
  import ChapterLink from '../components/doit/ChapterLink.svelte';
  import Notice from '../components/Notice.svelte';
  import Page from '../components/Page.svelte';
  import Section from '../components/Section.svelte';
  import { announce } from '../components/status.svelte.ts';
  import { FOCUS } from '../components/styles.ts';
  import { answerCounts } from '../components/taps.ts';
  import { useDoit } from '../lib/doit/doit-context.ts';
  import { stepState } from '../lib/doit/judge.ts';
  import { CHAPTERS, stepDef, stepsOf, type StepId } from '../lib/doit/steps.ts';
  import { fill, formatDate } from '../lib/format.ts';
  import { focusHeading, router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import ProgressNotice from './doit/ProgressNotice.svelte';
  import { chapterHeading, chapterUrl } from './doit/view.ts';

  const wallet = useWallet();
  const doit = useDoit();
  const uid = $props.id();

  let lang = $derived(router.lang);
  let t = $derived(strings.doit[lang]);

  /**
   * Under a newer version's note the steps are listed without states: this version has read none. And where
   * the browser did not let this page read its storage: nobody knows then which steps were started or done.
   */
  let stated = $derived(doit.kept !== 'newer' && doit.read !== 'blocked');

  /** Something is stored that this version may erase: a note, or something unreadable in its place. */
  let canForget = $derived(stated && (doit.read === 'kept' || doit.read === 'unreadable'));

  /** What a step's line says of it: the words, and the state by name for whoever reads the page by program. */
  function stateOf(id: StepId): { state: 'not-started' | 'started' | 'done'; text: string } {
    const note = doit.progress.steps[id];
    const state = stepState(note);
    if (state === 'done' && note?.doneAt !== undefined) {
      return { state, text: fill(t.stateDone, { date: formatDate(note.doneAt / 1000, lang) }) };
    }
    return { state, text: state === 'started' ? t.stateStarted : t.stateNotStarted };
  }

  // -- forget my progress -----------------------------------------------------------

  /** The reader has pressed "Forget my progress", and is being asked whether they mean it. */
  let asking = $state(false);
  /** The note is gone: said for the rest of this visit. */
  let forgotten = $state(false);
  /** The browser would not erase it. */
  let refused = $state(false);
  /** When the question opened, on the page's own clock (performance.now()), in ms. */
  let askedAt = 0;

  let root = $state<HTMLElement>();
  /** The whole question: the sentence, what goes and what stays, and the two answers. */
  let box = $state<HTMLElement>();
  let question = $state<HTMLElement>();

  async function ask(): Promise<void> {
    asking = true;
    refused = false;
    askedAt = performance.now();
    await tick();
    // The question is read out, and Tab goes on to its two answers. Focus by itself must not
    // move the page: the whole question is brought on screen by the shortest way instead.
    question?.focus({ preventScroll: true });
    box?.scrollIntoView({ block: 'nearest' });
  }

  /** True for a press on an answer that came too soon to count: the question has only just opened. */
  function tooSoon(event: MouseEvent): boolean {
    return !answerCounts(performance.now() - askedAt, event);
  }

  async function keep(event: MouseEvent): Promise<void> {
    if (tooSoon(event)) return;
    asking = false;
    await tick();
    root?.querySelector<HTMLElement>('[data-testid="do-forget"]')?.focus();
  }

  async function forget(event: MouseEvent): Promise<void> {
    if (tooSoon(event)) return;
    asking = false;
    if (!doit.forget()) {
      refused = true;
      await tick();
      root?.querySelector<HTMLElement>('[data-testid="do-forget"]')?.focus();
      return;
    }
    forgotten = true;
    announce(t.forgotten);
    // The section and its buttons are gone with the note.
    await tick();
    focusHeading();
  }

  // "None of it" is true only while nothing is stored where the note goes. A step opened in another tab after
  // the note was forgotten here starts a new one, and another tab can leave anything else under the key: the
  // line goes as soon as the storage holds something again, or can no longer be read.
  $effect(() => {
    if (doit.read !== 'none') forgotten = false;
  });

  const STEP_LINK = `rounded-sm text-lg font-semibold text-ink-800 underline decoration-ink-300 underline-offset-4 hover:text-orange-600 hover:decoration-orange-400 ${FOCUS}`;
</script>

<Page title={t.name} lede={t.listLede}>
  <ProgressNotice />

  {#if forgotten}
    <Notice kind="info" text={t.forgotten} data-testid="do-forgotten" />
  {/if}

  <div class="space-y-10" data-testid="do-list">
    {#each CHAPTERS as chapter (chapter.number)}
      {@const url = chapterUrl(wallet.config.siteUrl, chapter, lang)}
      <section aria-labelledby="{uid}-chapter-{chapter.number}">
        <h2 id="{uid}-chapter-{chapter.number}" class="text-balance text-xl font-bold tracking-tight text-ink-800 sm:text-2xl">
          {#if url !== null}
            <ChapterLink look="heading" href={url} data-testid="do-chapter">{chapterHeading(chapter, lang)}</ChapterLink>
          {:else}
            {chapterHeading(chapter, lang)}
          {/if}
        </h2>
        <ul aria-label={fill(t.listSteps, { number: String(chapter.number) })} class="mt-4 divide-y divide-ink-100 border-y border-ink-100">
          {#each stepsOf(chapter.number) as id (id)}
            {@const here = stateOf(id)}
            <!-- On a phone a step's state stands under its name, in every row alike: side by side, a long
                 state ("Done on November 15, 2026") went under the name in some rows and not in others. -->
            <li class="flex flex-col gap-y-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-x-4" data-step={id}>
              <span
                ><a href={router.link({ name: 'step', id })} class={STEP_LINK} data-testid="do-step-link" data-step={id}
                  >{t[stepDef(id).title]}</a
                ></span
              >
              {#if stated}
                <span class="text-sm">
                  <span
                    class={here.state === 'done' ? 'font-semibold text-ink-700' : here.state === 'started' ? 'font-semibold text-orange-700' : 'text-ink-500'}
                    data-testid="do-state"
                    data-state={here.state}>{here.text}</span
                  >
                  {#if doit.progress.following === id && here.state !== 'done'}
                    <span class="ml-2 text-xs font-semibold uppercase tracking-widest text-ink-500" data-testid="do-following">{t.stateFollowing}</span>
                  {/if}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>

  {#if canForget}
    <Section title={t.forgetTitle}>
      <div bind:this={root} class="space-y-4">
        {#if doit.read === 'unreadable'}
          <!-- Something is stored that is no note this version can read: said as About says it, and what the button does. -->
          <p class="text-pretty leading-relaxed text-ink-700" data-testid="do-forget-unreadable">{t.forgetUnreadable}</p>
        {:else}
          <p class="text-pretty leading-relaxed text-ink-700" data-testid="do-forget-what">{t.forgetWhat}</p>
        {/if}
        {#if refused}
          <Notice kind="problem" text={t.forgetRefused} data-testid="do-forget-refused" />
        {/if}
        <Actions>
          <Button data-testid="do-forget" aria-expanded={asking} onclick={() => void ask()}>{t.forget}</Button>
        </Actions>
        {#if asking}
          <div bind:this={box}>
            <Notice kind="caution" data-testid="do-forget-question">
              <div class="space-y-3">
                <!-- tabindex="-1": it takes focus from code only, so that the question is read out. -->
                <p bind:this={question} tabindex="-1" class="font-semibold text-ink-800 outline-none">{t.forgetAsk}</p>
                <p id="{uid}-forget-what">{t.forgetWarn}</p>
                <!-- Full-size buttons of one width on a phone, with room between them: one of the two cannot be undone. -->
                <Actions>
                  <Button
                    data-testid="do-forget-confirm"
                    class="w-full sm:w-auto"
                    aria-describedby="{uid}-forget-what"
                    onclick={(event) => void forget(event)}
                  >
                    {t.forgetYes}
                  </Button>
                  <Button data-testid="do-forget-keep" class="w-full sm:w-auto" onclick={(event) => void keep(event)}>{t.forgetNo}</Button>
                </Actions>
              </div>
            </Notice>
          </div>
        {/if}
      </div>
    </Section>
  {/if}
</Page>
