<script lang="ts">
  // A step that is done: the day it was done, two or three sentences on
  // what the reader did and saw, and the ways on.
  //
  // The card's day and its own sentences are drawn from the step's note
  // alone, on every later visit, for as long as the note lives: with the
  // wallet removed, the practice chain started again, the pot's coins
  // handed on to somebody else. So the sentences are in the past tense,
  // about what the reader did and saw, or say what is true of Bitcoin
  // whatever happens here. None says what the wallet, the chain, the pot or
  // this browser holds now (strings/doit.ts). Three pieces rest on more than
  // the note, and each is drawn only while what it rests on is there (the
  // list below says when): under a done "Hold some" the block that took in
  // a coin of the wallet that is here, under a done "Pass it on" the pot's
  // count, and under a done "The seed" the lines on the wallet that is in
  // this browser now.
  //
  // The ways on depend on how the reader came to the step, which the note
  // says (waysOn in view.ts):
  //
  //   by the step's card in its chapter
  //       The main button is the link back to the chapter, and there is no
  //       "Next step": the reader came from the chapter to do this one
  //       thing, reads on there, and meets the next card where the chapter
  //       has it.
  //   sent here by a need of another step, which is not done yet
  //       The main button leads back to that step, by name: it is the step
  //       the reader came for. The link back to the chapter is second, and
  //       leads to the chapter the reader left. On every road this version
  //       of the page writes that is this step's own chapter: a step that
  //       came from a chapter sends its reader to another step only inside
  //       one chapter. Under a note that an earlier version wrote it can be
  //       another one: that version sent a reader with no wallet or no
  //       coins to "Hold some" (the bitcoin chapter) from a step of the
  //       payment chapter or the keys chapter.
  //   from the wallet's own list of steps
  //       The link back to the chapter, then the next step where it
  //       belongs to the same chapter: a reader who has finished a
  //       chapter's last step has not read the next chapter yet.
  //
  // The address of the link back is built from the whole note (chapterLink
  // in lib/doit/progress.ts). Where it leads to this step's own chapter it
  // ends "#done=" and then this step and the other done steps of the
  // chapter, which the chapter's page marks as done. Where it leads to
  // another chapter (the second case above, for a "Hold some" whose note
  // an earlier version wrote) it ends with the card the reader pressed
  // there, and marks nothing.
  //
  // Four steps add something of their own:
  //
  //   Hold some         under the buttons, and only while the wallet in this
  //                     browser holds a coin that was paid to it and is in a
  //                     block: which block took that coin in, and a link to
  //                     the coin's transaction on the practice explorer, in
  //                     a new tab, beside the words that say who runs that
  //                     explorer. It is worked out when the card is drawn,
  //                     from the wallet's latest look at its coins
  //                     (coinInBlock in lib/doit/judge.ts): the note of this
  //                     step names no coin, and a done step's screen asks
  //                     the practice network nothing. After a page load the
  //                     piece arrives when the wallet's first look ends. It
  //                     stands last so that nothing above it moves then: the
  //                     card's buttons are where they are without it. Its
  //                     two sentences say what a block did and nothing of
  //                     what the wallet holds, so they stay true on a page
  //                     that is left open after the coin was sent on. The
  //                     piece is about the wallet that is here, whichever
  //                     wallet the step was done with: with another wallet
  //                     in this browser it names a coin of that wallet, if
  //                     it holds one of the kind. With no such coin (no
  //                     wallet here, the coins sent on, only change left)
  //                     there is no piece.
  //   Pass it on        how many payments have been passed on to the pot so
  //                     far. Payments, not people: the pot cannot tell who
  //                     sent one. And never "yours": the count is a number
  //                     the pot gives of the chain as it stands (and the
  //                     Worker may give one a few seconds old), while a
  //                     done step's note names no payment, so this piece
  //                     cannot know that the reader's payment is one of
  //                     them. The count is asked for once, and only where
  //                     the Worker's settings say that the pot's counts
  //                     can be had. Where they say no, nothing is asked
  //                     and the line is left out. It is also left out
  //                     when the count cannot be had or is 0.
  //   The seed          the wallet fingerprint the three words were checked
  //                     for. When another wallet is in this browser now,
  //                     the piece says so, and offers the check again for
  //                     that wallet.
  //   Prove the backup  for a wallet that was opened with a passkey before
  //                     the drill: what the restore changed. The card is
  //                     drawn from the step's note alone (how the wallet
  //                     was kept when the drill began), and it stays for
  //                     as long as the note does, whatever this browser
  //                     keeps by then: that wallet with its words, that
  //                     wallet behind its passkey again, no wallet, or
  //                     another one. So it says what the restore did, in
  //                     the past tense, and never what this browser keeps
  //                     now: for that it names About. Of the passkey it
  //                     promises nothing: the passkey may have been
  //                     deleted since, and the page cannot know. Then the
  //                     Sparrow page, as one more proof that the words are
  //                     the wallet.

  import { onMount, untrack } from 'svelte';
  import BackToStep from '../../components/doit/BackToStep.svelte';
  import ChapterLink from '../../components/doit/ChapterLink.svelte';
  import Button from '../../components/Button.svelte';
  import Card from '../../components/Card.svelte';
  import Notice from '../../components/Notice.svelte';
  import OutLink from '../../components/OutLink.svelte';
  import { busyWhile } from '../../components/status.svelte.ts';
  import { TAP } from '../../components/styles.ts';
  import TextLink from '../../components/TextLink.svelte';
  import { useDoit } from '../../lib/doit/doit-context.ts';
  import { coinInBlock, seedWallet } from '../../lib/doit/judge.ts';
  import { chapterLink } from '../../lib/doit/progress.ts';
  import { stepDef, type StepId } from '../../lib/doit/steps.ts';
  import { fill, formatDate, formatSats } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import { explorerTxUrl } from '../read/read.ts';
  import AskWords from './AskWords.svelte';
  import Sentence from './Sentence.svelte';
  import { asksPotCount, doneKey, waysOn } from './view.ts';

  interface Props {
    id: StepId;
    /** The time, in ms since 1970. */
    now: number;
  }

  let { id, now }: Props = $props();

  const wallet = useWallet();
  const doit = useDoit();

  let lang = $derived(router.lang);
  let t = $derived(strings.doit[lang]);

  let note = $derived(doit.progress.steps[id]);
  let day = $derived(note?.doneAt === undefined ? '' : fill(t.doneOn, { date: formatDate(note.doneAt / 1000, lang) }));
  /** The link back to the chapter: built from the whole note. Null when no link can be built from the settings. */
  let back = $derived(chapterLink(wallet.config.siteUrl, id, lang, doit.progress));
  /** The step this one leads back to, when a need of that step sent the reader here; and the next step, for a reader from the list. */
  let ways = $derived(waysOn(id, doit.progress));

  // -- Pass it on: the pot's count -------------------------------------------------

  /** How many payments have been passed on to the pot. Null until the count is here, and when it could not be had. */
  let passedOn = $state<number | null>(null);
  /** True once the count has been asked for: it is asked for once while this piece stays on screen. */
  let asked = false;
  /** True once this piece has left the screen: an answer that comes after that is for nobody. */
  let gone = false;

  // Whether the count is asked for at all: under a done "Pass it on", and only when the Worker's settings say
  // that the pot's counts can be had (asksPotCount in view.ts). A value of its own, so that what follows is
  // told only when the answer changes, and not each time the wallet swaps in a settings object that says the same.
  let countsWanted = $derived(asksPotCount(id, wallet.config));

  // Asked once: when a done "Pass it on" is shown, or, on a page that was loaded on this screen, when the
  // Worker's settings arrive and say yes. Not again while it stays on screen. While the settings say no,
  // which is how the Worker ships, nothing is asked: no request for the counts leaves the page.
  $effect(() => {
    if (!countsWanted || asked) return;
    asked = true;
    untrack(() => {
      void busyWhile(wallet.potStats()).then((answer) => {
        if (!gone && answer.ok) passedOn = answer.stats.passedOn;
      });
    });
  });

  onMount(() => () => {
    gone = true;
  });

  let potLine = $derived.by(() => {
    // Left out for a count of 0. Under a step that was done by a payment to the pot, "none so far" would
    // read as a contradiction, and this piece cannot tell which of the two is behind: the count may have
    // been read a moment before the payment, or the chain may have been started again since the step.
    if (passedOn === null || passedOn < 1) return '';
    return passedOn === 1 ? t.potCountOne : fill(t.potCount, { count: formatSats(passedOn) });
  });

  // -- The seed: which wallet the words were checked for ------------------------------

  /** Whether the wallet in this browser is the one the three words were checked for. */
  let seed = $derived(id === 'the-seed' ? seedWallet(doit.seen(now)) : 'none');
  /**
   * The check was passed again on this screen, for the wallet that was here then. That is said only while
   * `seed` is "same": while the wallet in this browser is still the one the note names.
   */
  let rechecked = $state(false);

  // -- Hold some: the block that took a coin of this wallet in -------------------------

  /**
   * A coin that was paid to the wallet in this browser and is in a block, by the wallet's latest look at its
   * coins, or null. Asked for "Hold some" alone. Nothing is asked of the practice network for it.
   */
  let coin = $derived(id === 'hold-some' ? coinInBlock(doit.seen(now)) : null);

  /** A small link that stands on a line by itself: a box of its own, with a tap area 44 px tall (styles.ts, TAP). */
  const ALONE = `inline-block ${TAP}`;
</script>

<Card tone="grey" data-testid="step-done">
  <div class="space-y-4">
    <div class="space-y-3 text-pretty text-base leading-relaxed text-ink-700">
      <!-- A heading: "What the restore changed" below is one level under it, and a reader who moves by headings finds the card. -->
      <h2 class="text-balance text-xl font-bold leading-snug text-ink-800" data-testid="step-done-on">{day}</h2>
      <p data-testid="step-done-text">{t[doneKey(id)]}</p>
      {#if potLine !== ''}
        <p data-testid="step-pot-count">{potLine}</p>
      {/if}
      {#if id === 'the-seed' && note?.wallet !== undefined}
        <p data-testid="step-seed-wallet">
          <Sentence text={t.seedChecked} slots={{ fingerprint: note.wallet }} mono={['fingerprint']} />
        </p>
      {/if}
    </div>

    <!-- "Checked ... for the wallet that is here" only while that is so: while the wallet here is the one the note
         names. Another tab can put another wallet in this browser afterwards, and the line below then takes its place. -->
    {#if id === 'the-seed' && rechecked && seed === 'same'}
      <Notice kind="info" text={t.seedRechecked} data-testid="step-seed-rechecked" />
    {:else if id === 'the-seed' && seed === 'other'}
      <!-- Another wallet is here: this step's note names no check for it, and the check is offered again for it. -->
      <div class="space-y-4 border-t border-ink-200 pt-4" data-testid="step-seed-other">
        <p class="text-pretty text-base leading-relaxed text-ink-700">
          <Sentence text={t.seedOther} slots={{ here: wallet.record?.fingerprint ?? '' }} mono={['here']} />
        </p>
        <AskWords {id} mode="again" onpassed={() => (rechecked = true)} />
      </div>
    {/if}

    {#if id === 'prove-the-backup'}
      <!-- From the note alone, whatever wallet is here now: the sentence is about the restore, not about the present. -->
      {#if note?.was === 'passkey'}
        <div class="space-y-2 border-t border-ink-200 pt-4" data-testid="step-changed">
          <h3 class="text-base font-bold text-ink-800">{t.changedTitle}</h3>
          <p class="text-pretty text-base leading-relaxed text-ink-700">{t.changed}</p>
        </div>
      {/if}
      <p class="text-base">
        <TextLink href={router.link({ name: 'sparrow' })} data-testid="step-sparrow">{t.sparrow}</TextLink>
      </p>
    {/if}

    <!-- One group: on a phone the buttons stand one under the other, at one width. One of them is the main
         button: the way back to the step the reader came for, where a need of that step sent them here, and
         the link back to the chapter otherwise. The group has a hook of its own: when the step ends while its
         screen is open, the screen brings these buttons into the window (StepBody.svelte). -->
    <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center" data-testid="step-ways">
      {#if ways.led !== null}
        <BackToStep step={ways.led} data-testid="step-led" />
      {/if}
      {#if back !== null}
        <ChapterLink look={ways.led === null ? 'primary' : 'secondary'} class="w-full sm:w-auto" href={back} data-testid="step-back">{t.back}</ChapterLink>
      {/if}
      {#if ways.next !== null}
        <Button class="w-full sm:w-auto" href={router.link({ name: 'step', id: ways.next })} data-testid="step-next">
          {fill(t.next, { step: t[stepDef(ways.next).title] })}
        </Button>
      {/if}
      <Button class="w-full sm:w-auto" href={router.link({ name: 'do' })} data-testid="step-list">{t.allSteps}</Button>
    </div>

    {#if coin !== null}
      <!-- "Hold some" only, and last: it comes from the wallet's latest look at its coins, which can end after the
           card is drawn, and nothing above it may move when it arrives. What a block did, and then the explorer
           as something to look at, beside who runs it. The link stands on a line of its own, outside the piece. -->
      <div class="space-y-3 border-t border-ink-200 pt-4 text-pretty text-base leading-relaxed text-ink-700" data-testid="step-coin-block">
        <p>{fill(t.coinBlock, { height: formatSats(coin.height) })}</p>
        <p>{t.coinCheck}</p>
      </div>
      <p class="text-sm">
        <OutLink class={ALONE} href={explorerTxUrl(wallet.config.explorerUrl, coin.txid)} text={t.coinExplorer} data-testid="step-explorer" />
      </p>
    {/if}
  </div>
</Card>
