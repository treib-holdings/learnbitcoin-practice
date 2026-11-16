<script lang="ts">
  // One step, under its heading: the chapter it belongs to and the way
  // back there, the "done" card once it is done, its parts as an ordered
  // list, and what the reader can do to the step itself.
  //
  // Each part says where it stands in one or two words. A ticked part says
  // what kind of proof it is: "Checked" for what the page checked against
  // the wallet or the chain, "Opened" for a screen the reader opened, "Your
  // word" for what no page can check. The first part that is not ticked is
  // open, with what to do in it (OpenPart.svelte); the parts after it are
  // "Later".
  //
  // Where the step stands is never worked out here: judge() says
  // (doit.view), from the note and from what the wallet publishes, and
  // this piece draws what it says. A part that waits for a block ticks
  // while the screen stays open: the wallet reads the chain for a step's
  // screen as it does for a wallet screen, and nothing is reloaded.
  //
  // What a screen reader is told (the shell's one status region), outcomes
  // only: a part of this step is ticked, and the step is done. Each is said
  // once, and only for a tick that came while this screen was open.
  //
  // Focus. When the reader's own answer ticks a part, the open part swaps
  // in place and the control they used is gone: focus goes to the screen's
  // heading, and Tab starts again from the top. When a part ticks by itself
  // (a block came), focus stays where the reader has it, and goes to the
  // heading only if what held it has left the screen.

  import { tick, untrack } from 'svelte';
  import Button from '../../components/Button.svelte';
  import ChapterLink from '../../components/doit/ChapterLink.svelte';
  import Notice from '../../components/Notice.svelte';
  import Section from '../../components/Section.svelte';
  import { announce } from '../../components/status.svelte.ts';
  import TextLink from '../../components/TextLink.svelte';
  import { provideFrameNotes, type FrameNotes } from '../../components/wallet/frame-notes.ts';
  import WalletId from '../../components/wallet/WalletId.svelte';
  import { useDoit } from '../../lib/doit/doit-context.ts';
  import { chapterLink } from '../../lib/doit/progress.ts';
  import { partCount, partDef, stepDef, type StepId } from '../../lib/doit/steps.ts';
  import { fill } from '../../lib/format.ts';
  import { focusHeading, router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import Done from './Done.svelte';
  import OpenPart from './OpenPart.svelte';
  import { canRestart, chapterHeading, checkedInSeed, partNameKey, stateKey, waitedOf, waitedText } from './view.ts';

  interface Props {
    id: StepId;
  }

  let { id }: Props = $props();

  const wallet = useWallet();
  const doit = useDoit();

  let lang = $derived(router.lang);
  let t = $derived(strings.doit[lang]);
  let w = $derived(strings.wallet[lang]);

  let def = $derived(stepDef(id));

  // The time, for "sent 12 seconds ago" and for a payment the network has
  // lost. A clock is outside Svelte, so an effect follows it.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  /** Where the step stands, part by part. */
  let view = $derived(doit.view(id, now));
  let note = $derived(doit.progress.steps[id]);
  let done = $derived(view.state === 'done');
  let followed = $derived(doit.progress.following === id);
  /** "Start this step again" is offered on a step under way, but not while the drill's wallet is out of the browser (view.ts). */
  let restartable = $derived(canRestart(view, doit.kept, wallet.status));

  /** The way back to the chapter: the page the reader came from, or the step's own chapter. Null when no link can be built. */
  let back = $derived(chapterLink(wallet.config.siteUrl, id, lang, note));

  /**
   * How long the step's payment waited for its block: from the note while
   * it still names the payment (judge() says so on the ticked part), and
   * from what this page remembers of the block it saw come (waitedOf in
   * view.ts says which of the two is used).
   */
  function waitedLine(part: number): string {
    if (partDef(id, part)?.on !== 'payment-confirmed') return '';
    const seen = view.parts[part - 1];
    if (seen?.state !== 'ticked') return '';
    const waited = waitedOf(seen.waited, doit.waited[id] ?? null);
    return waited === null ? '' : waitedText(waited, lang);
  }

  // -- what an unlock on this screen changed ----------------------------------------

  // The unlock step leaves a note where the frame of a wallet screen would
  // show it (frame-notes.ts). A step's screen has no such frame, so it
  // holds the note itself and shows it above the parts.
  const notes = $state<FrameNotes>({ note: null });
  provideFrameNotes(notes);

  async function readNote(): Promise<void> {
    notes.note = null;
    await tick();
    focusHeading();
  }

  // -- what is said, and where focus goes ---------------------------------------------

  /** How many parts are ticked. A value of its own, so that what follows runs when it changes and not every second. */
  let ticks = $derived(view.parts.filter((part) => part.state === 'ticked').length);

  // Said once, for a tick that came while this screen was open. Not where
  // nothing can be written: a part then only shows as the wallet stands,
  // and may be unticked again a moment later.
  let said: { ticks: number; done: boolean } | null = null;
  $effect(() => {
    const current = { ticks, done };
    const before = said;
    said = current;
    if (before === null || doit.kept !== 'yes') return;
    untrack(() => {
      if (current.done && !before.done) announce(fill(t.saidDone, { step: t[def.title] }));
      else if (current.ticks > before.ticks && !current.done) {
        // Several parts can tick at once: the one said is the last of them.
        announce(fill(t.saidTicked, { n: String(current.ticks), m: String(partCount(id)), part: t[partNameKey(id, current.ticks)] }));
      }
    });
  });

  // A part that ticks by itself takes its body off the screen. If that body
  // held the keyboard's focus, the focus would be left on nothing: before
  // the redraw, note whether it is inside the open part; after it, if it
  // has fallen back to the page itself, move it to the heading.
  let held = false;
  $effect.pre(() => {
    void ticks;
    void done;
    held = document.activeElement?.closest('[data-testid="step-open"]') != null;
  });
  $effect(() => {
    void ticks;
    void done;
    if (!held) return;
    held = false;
    void tick().then(() => {
      if (document.activeElement === null || document.activeElement === document.body) focusHeading();
    });
  });

  /** The reader's own answer ticked a part, or cleared what it noted: the open part has swapped in place. */
  async function swapped(): Promise<void> {
    await tick();
    focusHeading();
  }

  async function restart(): Promise<void> {
    doit.restart(id);
    await swapped();
  }

  async function stop(): Promise<void> {
    doit.stop(id);
    // The button that was pressed is gone.
    await swapped();
  }

  const MARK = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums';
</script>

<!-- The chapter the step belongs to, and the way back to it. Once the step is done, the way back is the main button of the card below. -->
<p class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-base text-ink-600" data-testid="step-chapter">
  <span>{chapterHeading(def.chapter, lang)}</span>
  {#if back !== null && !done}
    <ChapterLink href={back} data-testid="step-back">{t.back}</ChapterLink>
  {/if}
</p>

{#if notes.note !== null}
  {#if notes.note.kind === 'tampered'}
    <Notice kind="problem" text={w.noteTampered} data-testid="unlock-note">
      <Button variant="quiet" onclick={() => void readNote()}>{w.noteOk}</Button>
    </Notice>
  {:else if notes.note.kind === 'switched'}
    <Notice kind="caution" text={w.noteSwitched} data-testid="unlock-note">
      <div class="space-y-3">
        <WalletId tag={notes.note.tag} fingerprint={notes.note.fingerprint} />
        <Button variant="quiet" onclick={() => void readNote()}>{w.noteOk}</Button>
      </div>
    </Notice>
  {/if}
{/if}

{#if done}
  <Done {id} {now} />
{/if}

<Section title={t.partsTitle}>
  <ol class="space-y-3" data-testid="step-parts">
    {#each view.parts as part, index (index)}
      {@const number = index + 1}
      {@const open = view.at === number}
      {@const waited = waitedLine(number)}
      <li
        data-testid="step-part"
        data-part={String(number)}
        data-state={part.state}
        aria-current={open ? 'step' : undefined}
        class={[
          'rounded-xl border p-3.5 sm:p-5',
          open ? 'border-orange-300 bg-white shadow-sm' : part.state === 'ticked' ? 'border-ink-100 bg-ink-50' : 'border-dashed border-ink-200 bg-white',
        ]}
      >
        <div class="flex items-start gap-3">
          <!-- A tick for a ticked part, its number for every other one. Drawn, and not said: the words beside it say it. -->
          {#if part.state === 'ticked'}
            <span class={[MARK, 'bg-ink-800 text-white']} aria-hidden="true">
              <svg class="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3.5 8.5l3 3 6-7" /></svg>
            </span>
          {:else}
            <span class={[MARK, open ? 'border-2 border-orange-400 text-ink-800' : 'border border-ink-200 text-ink-500']} aria-hidden="true"
              >{number}</span
            >
          {/if}
          <!-- On a phone the part's state stands under its name, in every row alike: side by side, a long
               name pushed the state onto a line of its own in some rows and not in others. -->
          <div class="min-w-0 flex-1 pt-0.5 sm:flex sm:items-baseline sm:justify-between sm:gap-4">
            <h3 class={['text-base font-semibold', part.state === 'later' ? 'text-ink-500' : 'text-ink-800']}>{t[partNameKey(id, number)]}</h3>
            <span
              class={[
                'block text-xs font-semibold uppercase tracking-widest sm:shrink-0',
                part.state === 'later' ? 'text-ink-400' : part.state === 'ticked' ? 'text-ink-500' : 'text-orange-700',
              ]}
              data-testid="step-part-state">{t[stateKey(id, number, part)]}</span
            >
          </div>
        </div>
        {#if waited !== ''}
          <p class="mt-2 text-sm leading-relaxed text-ink-600" data-testid="step-waited">{waited}</p>
        {/if}
        {#if part.state === 'ticked' && checkedInSeed(id, number, doit.progress)}
          <!-- The drill's paper check, passed in another step: said, so that a part found ticked on arrival is no riddle. -->
          <p class="mt-2 text-sm leading-relaxed text-ink-600" data-testid="step-checked-in-seed">
            {fill(t.checkedInSeed, { step: t[stepDef('the-seed').title] })}
          </p>
        {/if}
        {#if open && part.state !== 'ticked' && part.state !== 'later'}
          <div class="mt-4" data-testid="step-open">
            <OpenPart {id} part={number} view={part} {now} onticked={() => void swapped()} />
          </div>
        {/if}
      </li>
    {/each}
  </ol>
</Section>

<!-- What the reader can do to the step itself, while it is under way and can be written. -->
{#if view.state === 'started' && doit.kept === 'yes' && (restartable || followed)}
  <div class="space-y-3 border-t border-ink-100 pt-6">
    <!-- One group: on a phone the two stand one under the other, at one width. -->
    <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      {#if restartable}
        <Button variant="quiet" class="w-full sm:w-auto" data-testid="step-restart" onclick={() => void restart()}>{t.restart}</Button>
      {/if}
      {#if followed}
        <Button variant="quiet" class="w-full sm:w-auto" data-testid="step-stop" onclick={() => void stop()}>{t.stop}</Button>
      {/if}
    </div>
    <div class="space-y-1 text-pretty text-sm leading-relaxed text-ink-500">
      {#if restartable}<p>{t.restartNote}</p>{/if}
      {#if followed}<p>{t.stopNote}</p>{/if}
    </div>
  </div>
{/if}

{#if !done}
  <p class="text-base">
    <TextLink href={router.link({ name: 'do' })} data-testid="step-list">{t.allSteps}</TextLink>
  </p>
{/if}
