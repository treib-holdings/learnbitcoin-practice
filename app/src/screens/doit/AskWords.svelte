<script lang="ts">
  // Three of the 12 words, asked for by their place: the paper check of
  // "The seed" and of "Prove the backup".
  //
  // The check answers one question: is the paper copy this wallet's? The
  // screen names three places of the phrase (ask.ts keeps them until they
  // are answered right) and takes one word for each. It never holds the 12
  // words itself. What the reader types goes straight to the wallet, which
  // compares it inside (wallet.checkWordsAt) and answers with the places
  // that were wrong, never with a word. So a wrong word is said by its
  // place and is never corrected, and the fields are emptied after every
  // check, right or wrong.
  //
  // The three fields are fields for seed words, like the twelve of the
  // Restore screen (components/wallet/WordsInput.svelte), and carry every
  // attribute those do: no spell check, no autocomplete, no autocorrect, no
  // capitals, never translated, no name, and no form around them. No
  // regular expression is run over what is typed here, or it would stay
  // where any script in the page could read it back. On paper the fields
  // are left out, and when the piece leaves the screen it empties them.
  //
  // Above them stands the paragraph the Restore screen carries: the keys
  // chapter of the main site's Journey says never to type a seed into a
  // website, and this page is the one exception, because its words guard
  // play money. One more sentence follows it here. A real wallet does ask
  // for a few words back, once, on its own screen, straight after it has
  // shown them, and a reader who has done that here must not take the next
  // page that asks for "only three words" for the same thing.
  //
  // A wallet opened with a passkey has to be unlocked first: comparing
  // words needs the wallet's keys. The shared unlock step does that, with a
  // line of this screen's own on what the keys are for. Once it has, focus
  // goes to the first of the three fields: they are what the reader
  // unlocked for, and on a phone they are a screen further down than the
  // heading the unlock step would leave them at.
  //
  // Keys that this piece had loaded are dropped again when it leaves the
  // screen (the check was passed, or the reader went elsewhere). Every
  // wallet screen says "Unlocked in this tab until you lock it" and offers
  // Lock; a step's screen has no such line, so it does not leave a wallet
  // unlocked behind it. A wallet that was unlocked before the reader came
  // here stays as it was: the screen that unlocked it has said so.

  import { onDestroy, tick, untrack } from 'svelte';
  import Button from '../../components/Button.svelte';
  import Notice from '../../components/Notice.svelte';
  import TextInput from '../../components/TextInput.svelte';
  import ReloadButton from '../../components/wallet/ReloadButton.svelte';
  import Unlock from '../../components/wallet/Unlock.svelte';
  import { useDoit } from '../../lib/doit/doit-context.ts';
  import { wordsPassed } from '../../lib/doit/judge.ts';
  import type { StepId } from '../../lib/doit/steps.ts';
  import { fill } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import { positionsAnswered, positionsFor } from './ask.ts';
  import { withChapters } from './view.ts';

  interface Props {
    /** The step whose paper is checked. */
    id: StepId;
    /**
     * "part": the check is the step's open part, and passing it ticks the
     * part. "again": "The seed" is done, another wallet is here now, and
     * passing the check says the same of that wallet.
     */
    mode?: 'part' | 'again';
    /** The check was passed and written. */
    onpassed: () => void;
  }

  let { id, mode = 'part', onpassed }: Props = $props();

  const wallet = useWallet();
  const doit = useDoit();
  const uid = $props.id();

  let lang = $derived(router.lang);
  let t = $derived(strings.doit[lang]);
  let w = $derived(strings.wallet[lang]);
  let r = $derived(strings.restore[lang]);

  /**
   * The question's name in the page's memory: one for each step, and one
   * more for the check that is done again. Read once, when the piece is
   * made: a question does not change into another one while it is on screen.
   */
  const key = untrack(() => (mode === 'again' ? `${id}:again` : id));
  /** The three places asked for, counted from 0. The same ones until they are answered right. */
  const positions = positionsFor(key);

  /** What the three fields hold. This is the only place the typed words are kept, and only until "Check". */
  let fields = $state<string[]>(positions.map(() => ''));
  /** The places (from 0) whose word did not match at the last check. */
  let wrong = $state.raw<readonly number[]>([]);
  /**
   * Why the last check compared nothing: the bot check is in the page
   * (reload), the wallet changed in another tab (gone), or the question
   * closed under the reader (closed).
   */
  let problem = $state<'reload' | 'gone' | 'closed' | null>(null);

  /** A passkey wallet whose keys are not loaded: the unlock step comes first. */
  let locked = $derived(wallet.record?.kind === 'passkey' && !wallet.unlocked);

  /** True once the unlock step of this piece has loaded the wallet's keys: this piece then drops them when it goes. */
  let unlockedHere = false;

  /** The keys are loaded, and the three fields have taken the unlock step's place. */
  async function unlocked(): Promise<void> {
    unlockedHere = true;
    // After the unlock step's own move: it puts focus on the screen's heading, one turn after it has told us.
    await tick();
    await tick();
    field(0)?.focus();
  }

  onDestroy(() => {
    if (unlockedHere) wallet.lock();
  });

  let root = $state<HTMLElement>();

  function field(at: number): HTMLInputElement | undefined {
    return root?.querySelectorAll('input')[at];
  }

  async function check(): Promise<void> {
    problem = null;
    // Handed over as the fields hold them, and kept nowhere else: the wallet tidies and compares.
    const answer = wallet.checkWordsAt([...positions], [...fields]);
    // Emptied after every check, whatever it said.
    fields = fields.map(() => '');
    if (!answer.ok) {
      wrong = [];
      // "locked" needs no word here: the unlock step takes the fields' place.
      if (answer.reason !== 'locked') problem = answer.reason;
      return;
    }
    if (!wordsPassed(positions, answer)) {
      wrong = answer.wrong;
      await tick();
      // Focus goes to the first field that was wrong: its line says so, and is read out there.
      const first = positions.findIndex((position) => answer.wrong.includes(position));
      field(Math.max(0, first))?.focus();
      return;
    }
    wrong = [];
    const written = mode === 'again' ? doit.recheck() : doit.answer(id);
    if (!written) {
      problem = 'closed';
      return;
    }
    // Answered right: the next time this question opens, it asks for three other places.
    positionsAnswered(key);
    onpassed();
  }

  function onkey(event: KeyboardEvent, at: number): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (at < positions.length - 1) field(at + 1)?.focus();
    else void check();
  }

  /** When the piece leaves the screen, its fields are emptied: the typed words do not outlive it. */
  function emptied(node: HTMLElement): () => void {
    return () => {
      for (const input of node.querySelectorAll('input')) input.value = '';
      fields = [];
    };
  }

  const ERROR = 'text-pretty text-sm font-semibold leading-relaxed text-ink-800';
</script>

{#if locked}
  <Unlock why={t.wordsUnlockWhy} onunlocked={() => void unlocked()} />
{:else}
  <div class="space-y-4">
    <!-- Why this page may ask for words at all, before any field. The group of fields names it as its description. -->
    <div id="{uid}-rules">
      <Notice kind="caution" text={withChapters(r.exception, lang)} data-testid="step-words-exception">
        <p>{withChapters(t.wordsOnce, lang)}</p>
      </Notice>
    </div>

    <div
      {@attach emptied}
      bind:this={root}
      role="group"
      aria-label={t.wordsGroup}
      aria-describedby="{uid}-rules"
      data-print="never"
      class="space-y-3"
    >
      {#if lang === 'es'}
        <p class="text-pretty text-sm leading-relaxed text-ink-500">{w.wordsEnglishType}</p>
      {/if}
      <!-- One under the other on a phone, side by side from there: each field shows the longest word on the list whole. -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {#each positions as position, at (position)}
          {@const bad = wrong.includes(position)}
          <div class="flex flex-col gap-1">
            <label for="{uid}-word-{at}" class="block text-sm font-semibold text-ink-800">
              {fill(w.wordsNumber, { n: String(position + 1) })}
            </label>
            <TextInput
              id="{uid}-word-{at}"
              bind:value={fields[at]}
              mono
              data-testid="step-word"
              data-place={String(position + 1)}
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="none"
              translate="no"
              inputmode="text"
              enterkeyhint={at < positions.length - 1 ? 'next' : 'done'}
              aria-invalid={bad ? 'true' : undefined}
              aria-describedby={bad ? `${uid}-wrong-${at}` : undefined}
              onkeydown={(event) => onkey(event, at)}
            />
          </div>
        {/each}
      </div>

      <!-- Which places were wrong, and never which word belongs there. -->
      {#if wrong.length > 0}
        <div role="alert" class="space-y-1" data-testid="step-words-wrong">
          {#each positions as position, at (position)}
            {#if wrong.includes(position)}
              <p id="{uid}-wrong-{at}" class={ERROR}>{fill(t.wordsWrong, { n: String(position + 1) })}</p>
            {/if}
          {/each}
          <p class="text-pretty text-sm leading-relaxed text-ink-600">{t.wordsWrongWay}</p>
        </div>
      {/if}
    </div>

    <!-- What went wrong with the check itself, right above the button that was pressed. -->
    {#if problem === 'reload'}
      <Notice kind="problem" text={t.wordsReload} data-testid="step-words-problem">
        <ReloadButton />
      </Notice>
    {:else if problem === 'gone'}
      <Notice kind="problem" text={t.wordsGone} data-testid="step-words-problem" />
    {:else if problem === 'closed'}
      <Notice kind="problem" text={t.answerClosed} data-testid="step-words-problem" />
    {/if}

    <div>
      <!-- The main button of an open part. On a step that is done the way back is the main one, and this stands beside it. -->
      <Button
        variant={mode === 'again' ? 'secondary' : 'primary'}
        class="w-full sm:w-auto"
        data-testid="step-words-check"
        onclick={() => void check()}
      >
        {t.wordsCheck}
      </Button>
    </div>
  </div>
{/if}
