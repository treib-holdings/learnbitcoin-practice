<script lang="ts">
  // The Backup screen: the 12 words of the wallet in this browser, and a
  // blank practice sheet to print and write them on.
  //
  // It has four steps, and one shows at a time (keys/backup-flow.ts):
  //
  //   made    Straight after a wallet is created the screen opens as the
  //           "Wallet made" step. The keys are still loaded, so the words
  //           are on screen at once, with no second prompt. A passkey
  //           wallet is told the name its passkey was saved under (or,
  //           where the wallet does not have it, the tag in that name) and
  //           where the passkey lives, and under the words that they are the way
  //           back without it. A wallet made without a passkey is told,
  //           under the words, what this browser now keeps and who can
  //           look and spend. Then the sheet to write the words on, and
  //           "I have written them down", which ends the step; so does
  //           leaving it any other way. The button leads to the wallet's
  //           overview, or, for a reader who is following a "Do it" step,
  //           straight back to that step: they made the wallet because the
  //           step asked for one (keys/backup-flow.ts, afterWritten).
  //   ask     At any other time: why this page is the one exception to
  //           the keys chapter's rule, what to know before the words are
  //           on screen, and "Show the 12 words".
  //   unlock  A passkey wallet that is locked gets the shared unlock step
  //           first, and then its words. "Back" under the step returns to
  //           the screen's first view: a reader who does not want to
  //           unlock after all must not have to leave the screen to get
  //           the warnings and the button back.
  //   shown   The words, with "Hide them".
  //
  // The words are held here only while they are on screen. They are
  // dropped when the reader hides them, when the wallet is locked, when the
  // wallet in this browser is no longer the one they belong to (another
  // tab removed or replaced it: the screen then says so), and when the
  // screen is left. They are handed to the words list as they came from
  // the wallet: nothing here copies them, stores them, or runs a regular
  // expression over them (a pattern that has matched keeps the text it ran
  // on where any script in the page can read it). There is no control to
  // copy or download them, and a printout of this screen is the blank sheet
  // alone.

  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import Actions from '../components/Actions.svelte';
  import Badge from '../components/Badge.svelte';
  import Button from '../components/Button.svelte';
  import Mono from '../components/Mono.svelte';
  import Notice from '../components/Notice.svelte';
  import OutLink from '../components/OutLink.svelte';
  import Prose from '../components/Prose.svelte';
  import Row from '../components/Row.svelte';
  import Rows from '../components/Rows.svelte';
  import Section from '../components/Section.svelte';
  import { working } from '../components/status.svelte.ts';
  import ReloadButton from '../components/wallet/ReloadButton.svelte';
  import Unlock from '../components/wallet/Unlock.svelte';
  import WalletFrame from '../components/wallet/WalletFrame.svelte';
  import WordsList from '../components/wallet/WordsList.svelte';
  import { SAFARI_KEEPS_DAYS } from '../components/wallet/frame.ts';
  import type { Unlocked } from '../components/wallet/unlock-flow.ts';
  import { useDoit } from '../lib/doit/doit-context.ts';
  import { stripStep } from '../lib/doit/progress.ts';
  import { fill } from '../lib/format.ts';
  import { focusHeading, navigate, router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import { withChapters } from './doit/view.ts';
  import PracticeCard from './keys/PracticeCard.svelte';
  import { afterUnlock, afterWritten, backupView, chapterUrl, mustDropWords, showPlan, takenByAnotherTab } from './keys/backup-flow.ts';
  import { siteHost } from './keys/card-form.ts';
  import { isRepeatTap } from './keys/taps.ts';

  const wallet = useWallet();
  /** The "Do it" steps: only to know, at the press of "I have written them down", whether the reader follows one. */
  const doit = useDoit();

  /** For the ids that tie a warning to the button it is about. */
  const id = $props.id();

  /**
   * What sets the words apart from the text around them: a hairline above
   * and below, as around the app's lists of facts. No box with padding at
   * its sides: on the narrowest phone (320 px) the list needs the column's
   * whole width to keep its two columns, so that the twelve words stay on
   * one screenful.
   */
  const WORDS_BOX = 'border-y border-ink-100 py-4';


  let lang = $derived(router.lang);
  let t = $derived(strings.backup[lang]);
  let c = $derived(strings.common[lang]);

  /** The 12 words while they are on screen, and at no other time. */
  let words = $state.raw<string[] | null>(null);
  /** The wallet those words belong to, by its public key. */
  let wordsOf: string | null = null;
  /** The reader asked for the words of a locked wallet, and is at the unlock step. */
  let unlocking = $state(false);
  /** The wallet said it was unlocked, and still gave no words. */
  let failed = $state(false);
  /** The words were on screen and left it, because another tab changed the wallet in this browser. */
  let withdrawn = $state(false);
  /**
   * Straight after a create, for the moment between this screen's first
   * drawing and the words: the step is "Wallet made" already, with nothing
   * under its heading yet.
   */
  let arriving = $state(untrack(() => wallet.created) !== null);
  /** True once the screen has been left. */
  let left = false;

  /** Takes the words from the wallet and puts them on screen. False when the wallet gave none. */
  function take(): boolean {
    const list = wallet.revealWords();
    if (list === null) return false;
    wordsOf = wallet.record?.xpub ?? null;
    words = list;
    return true;
  }

  /** Takes the words off the screen. Nothing else here holds them. */
  function drop(): void {
    words = null;
    wordsOf = null;
  }

  // Straight after a create the keys are loaded: the words are shown at
  // once, with no second prompt. They are taken a moment after the screen
  // is drawn, and not while this script runs. Taking them is what the
  // wallet counts as "Words shown", and the count is filed under the screen
  // the app last named to its counter, which has to be this one and not
  // Create. The app names a screen before the screen's own script runs
  // (App.svelte), so that holds from the first line here; taking the words
  // after tick() keeps it true whatever order the app's effects run in.
  onMount(() => {
    if (!arriving) return;
    void tick().then(() => {
      // Left again already: leaving has ended the step (onDestroy).
      if (left) return;
      arriving = false;
      // A wallet that says it was just created and cannot show its words (it
      // was locked on the way here) gets the screen as at any other time.
      if (wallet.created !== null && !take()) wallet.ackCreated();
    });
  });

  let locked = $derived(wallet.record?.kind === 'passkey' && !wallet.unlocked);
  let view = $derived(backupView({ created: wallet.created, locked, shown: words !== null, unlocking }));
  /** The "Wallet made" step, also in the moment before its words are on screen. */
  let made = $derived(arriving || view === 'made');

  let title = $derived(made ? t.madeTitle : view === 'shown' ? t.shownTitle : c.section_backup);
  let lede = $derived(made ? t.madeLede : undefined);

  /** The tag in the name of this wallet's passkey, when this browser knows one. */
  let tag = $derived(wallet.record?.tag ?? null);
  /**
   * The name this page gave the passkey it has just made, as the wallet
   * wrote it then. Only the wallet has it, and only until the step ends:
   * this screen never builds a name itself.
   */
  let madeName = $derived(wallet.createdName);

  /** The main site's name as its backup form prints it, for the foot of the practice card. */
  let site = $derived(siteHost(wallet.config.siteUrl));

  // The words leave the screen with the keys: when the wallet is locked,
  // and when the wallet in this browser is no longer the one they belong
  // to. If that ends the "Wallet made" step, the step is over for good.
  $effect(() => {
    const owner = {
      shownFor: words === null ? null : wordsOf,
      wallet: wallet.record?.xpub ?? null,
      unlocked: wallet.unlocked,
    };
    if (!mustDropWords(owner)) return;
    // Another tab took the wallet away or put another in its place: the
    // reader did nothing here, so the screen says why the words are gone.
    const taken = takenByAnotherTab(owner);
    untrack(() => {
      drop();
      unlocking = false;
      if (taken) withdrawn = true;
      if (wallet.created !== null) wallet.ackCreated();
    });
    // The step changed under the reader, and what had focus may be gone.
    void tick().then(focusHeading);
  });

  // The wallet can stop being locked without the unlock step telling this
  // screen: another tab can put a wallet that needs no passkey in this
  // one's place, say. The wish for the words must not outlive that. Left
  // standing, it would bring the unlock step up unasked the next time a
  // wallet here is locked.
  $effect(() => {
    if (!locked) unlocking = false;
  });

  async function show(): Promise<void> {
    failed = false;
    withdrawn = false;
    if (showPlan(locked) === 'unlock') {
      unlocking = true;
    } else if (!take()) {
      // The button is still there and keeps focus; the notice is read out.
      failed = true;
      return;
    }
    // The step swapped in place: its heading is read out, and Tab starts from its top.
    await tick();
    focusHeading();
  }

  /** The unlock step loaded the keys. It moves focus to the heading itself. */
  function unlocked(how: Unlocked): void {
    unlocking = false;
    if (afterUnlock(how) === 'reveal' && !take()) failed = true;
  }

  /** Holds "Show the 12 words", so that focus can be put back on it. */
  let asks = $state<HTMLElement>();

  /**
   * "Back", under the unlock step: the wish for the words is taken back, and
   * the screen's first view returns, with focus on the button that led to
   * the step. Not while a passkey prompt is open (the button is switched off
   * then): the page cannot take a prompt back, and its answer would arrive
   * at a screen that no longer asked for the words.
   */
  async function leaveUnlock(): Promise<void> {
    if (working()) return;
    unlocking = false;
    await tick();
    if (!left) asks?.querySelector<HTMLElement>('[data-testid="reveal-words"]')?.focus();
  }

  async function hide(): Promise<void> {
    drop();
    await tick();
    focusHeading();
  }

  /**
   * "I have written them down": the "Wallet made" step is over. Next is the "Do it" step the reader is
   * following, if they follow one at this moment, and the wallet's overview if they follow none.
   */
  function written(): void {
    drop();
    wallet.ackCreated();
    navigate(router.link(afterWritten(stripStep(doit.progress, Date.now()))));
  }

  // Leaving the screen any other way ends the "Wallet made" step too, and
  // the words go with the screen.
  onDestroy(() => {
    left = true;
    drop();
    if (wallet.created !== null) wallet.ackCreated();
  });
</script>

<!-- Why this page may show 12 words at all, with a link to the chapter whose
     rule it answers. `strict` adds the line that keeps practice words away
     from real money: it belongs where the words are on screen. -->
{#snippet exception(strict: boolean)}
  <Notice kind="caution" data-testid="backup-exception">
    <div class="space-y-3">
      <p>{withChapters(t.exception, lang)}</p>
      {#if strict}
        <p class="font-semibold text-ink-800" data-testid="never-real-money">{t.neverRealMoney}</p>
      {/if}
      <p class="text-sm">
        <OutLink href={chapterUrl(wallet.config.siteUrl, lang)} text={withChapters(t.chapterLink, lang)} />
      </p>
    </div>
  </Notice>
{/snippet}

<WalletFrame {title} {lede} coins={false}>
  {#snippet children()}
    {#if arriving}
      <!-- Straight after a create: the heading stands, and the words follow in the same moment. -->
    {:else if view === 'made' && words !== null}
      {#if wallet.created === 'passkey'}
        <Section title={t.madePasskeyTitle}>
          {#if madeName !== null}
            <!-- The whole name, exactly as the wallet wrote it when it made
                 the passkey: in the language the page had at that moment,
                 which need not be the language of this screen. It is what
                 the reader's password manager lists, so no translating
                 browser may touch it. -->
            <Rows>
              <Row name={t.madePasskeyName}>
                <span translate="no" data-testid="passkey-name">{madeName}</span>
              </Row>
            </Rows>
          {:else if tag !== null}
            <!-- The wallet has no name to show: the tag stands for it. A
                 whole name built here could be the one in the other
                 language, which the password manager does not list. -->
            <Rows>
              <Row name={t.madePasskeyTag}>
                <Mono value={tag} data-testid="passkey-tag" />
              </Row>
            </Rows>
          {/if}
          <Prose>
            {#if madeName !== null}
              <p>{t.madePasskeyNameIs}</p>
            {:else if tag !== null}
              <p>{t.madePasskeyTagIs}</p>
            {/if}
            <p data-testid="made-passkey">{t.madePasskeyWhere}</p>
          </Prose>
        </Section>
      {/if}

      <Section title={t.shownTitle}>
        <!-- Above the words: a screen reader reads down the page. -->
        <p class="text-pretty text-sm leading-relaxed text-ink-500">{t.spokenAloud}</p>
        <div class={WORDS_BOX}>
          <!-- The marker beside the words: a picture of this part of the screen still says PRACTICE. -->
          <p class="mb-3"><Badge tone="stamp">{c.markerBadge}</Badge></p>
          <WordsList {words} />
        </div>
        <Prose>
          <p>{t.after}</p>
          {#if wallet.created === 'passkey'}
            <p data-testid="made-passkey-back">{t.madePasskeyBack}</p>
          {/if}
        </Prose>
      </Section>

      {#if wallet.created === 'words'}
        <!-- After the words, which are what the reader came for: what keeping them here means. -->
        <Section title={t.madeKeepsTitle}>
          <Prose>
            <p data-testid="made-keeps">{t.madeKeepsWords} {t.madeKeepsWho}</p>
            <p>{fill(t.madeKeepsCleared, { days: String(SAFARI_KEEPS_DAYS) })}</p>
            {#if wallet.persisted === false}
              <p data-testid="made-not-persisted">{t.madeNotPersisted}</p>
            {/if}
          </Prose>
        </Section>
      {/if}

      {@render exception(true)}

      <!-- The sheet comes before the button: the button says the words are
           written down and takes them off the screen, so what to write
           them on has to be offered first. -->
      <PracticeCard {site} />

      <Actions>
        <Button variant="primary" data-testid="words-written" onclick={written}>{t.written}</Button>
      </Actions>
    {:else if view === 'shown' && words !== null}
      <div class="space-y-4">
        <div class={WORDS_BOX}>
          <p class="mb-3"><Badge tone="stamp">{c.markerBadge}</Badge></p>
          <WordsList {words} />
        </div>
        <Actions>
          <!-- Not the second click of a double tap: its first click was on "Show the 12 words", which stood here. -->
          <Button
            data-testid="hide-words"
            onclick={(event) => {
              if (!isRepeatTap(event)) void hide();
            }}
          >
            {t.hide}
          </Button>
        </Actions>
      </div>
      <Prose><p>{t.after}</p></Prose>
      <Notice kind="caution" text={t.neverRealMoney} data-testid="never-real-money" />
    {:else if view === 'unlock'}
      <div class="space-y-6" data-testid="backup-unlock">
        <Unlock why={t.unlockWhy} onunlocked={unlocked} />
        <Actions>
          <!-- As wide as the step's own buttons on a phone, and off while a passkey prompt is open (leaveUnlock). -->
          <Button class="w-full sm:w-auto" data-testid="backup-unlock-back" disabled={working()} onclick={() => void leaveUnlock()}>
            {c.back}
          </Button>
        </Actions>
      </div>
    {:else}
      <Section title={t.wordsTitle}>
        {#if withdrawn}
          <!-- At the top, where the words were. It is read out at once. -->
          <Notice kind="problem" text={t.wordsWithdrawn} data-testid="words-withdrawn" />
        {/if}
        {@render exception(false)}
        <Prose>
          <p>{t.before}</p>
          <p id="{id}-spoken" data-testid="spoken-aloud">{t.spokenAloud}</p>
        </Prose>
        {#if failed}
          <Notice kind="problem" text={t.revealFailed} data-testid="reveal-problem">
            <ReloadButton />
          </Notice>
        {/if}
        <div bind:this={asks}>
          <Actions>
            <!-- The warning about being heard is tied to the button, so that a
                 screen reader says it when Tab reaches the button. The second
                 click of a double tap never shows the words: its first click
                 was on "Hide them", which stood here. -->
            <Button
              variant="primary"
              data-testid="reveal-words"
              aria-describedby="{id}-spoken"
              onclick={(event) => {
                if (!isRepeatTap(event)) void show();
              }}
            >
              {t.show}
            </Button>
          </Actions>
        </div>
      </Section>
    {/if}

    {#if !made}
      <PracticeCard {site} />
    {/if}
  {/snippet}
</WalletFrame>
