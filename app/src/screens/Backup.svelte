<script lang="ts">
  // The Backup screen: the 12 words of the wallet in this browser, and a
  // blank practice card to print and write them on.
  //
  // It has four steps, and one shows at a time (keys/backup-flow.ts):
  //
  //   made    Straight after a wallet is created the screen opens as the
  //           "Wallet made" step. The keys are still loaded, so the words
  //           are on screen at once, with no second prompt. A passkey
  //           wallet is told the tag in its passkey's name and where the
  //           passkey lives, and under the words that they are the way
  //           back without it. A wallet made without a passkey is told,
  //           under the words, what this browser now keeps and who can
  //           look and spend. Then the card to write the words on, and
  //           "I have written them down", which ends the step; so does
  //           leaving it any other way.
  //   ask     At any other time: why this page is the one exception to
  //           chapter 4's rule, what to know before the words are on
  //           screen, and "Show the 12 words".
  //   unlock  A passkey wallet that is locked gets the shared unlock step
  //           first, and then its words.
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
  // copy or download them, and a printout of this screen is the blank card
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
  import ReloadButton from '../components/wallet/ReloadButton.svelte';
  import Unlock from '../components/wallet/Unlock.svelte';
  import WalletFrame from '../components/wallet/WalletFrame.svelte';
  import WordsList from '../components/wallet/WordsList.svelte';
  import { SAFARI_KEEPS_DAYS } from '../components/wallet/frame.ts';
  import type { Unlocked } from '../components/wallet/unlock-flow.ts';
  import { fill } from '../lib/format.ts';
  import { focusHeading, navigate, router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import PracticeCard from './keys/PracticeCard.svelte';
  import { afterUnlock, backupView, chapterUrl, mustDropWords, showPlan, takenByAnotherTab } from './keys/backup-flow.ts';
  import { isRepeatTap } from './keys/taps.ts';

  const wallet = useWallet();

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

  /**
   * On a phone the unlock step's buttons stack, each as wide as its own
   * label: a short one sits narrow under a wide one. This makes every
   * button inside the step as wide as the step on a narrow screen, as the
   * buttons of one group should be. It is laid over the shared step from
   * outside, and can go once the step does it itself.
   */
  const EVEN_BUTTONS = '[&_button]:w-full sm:[&_button]:w-auto';

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
  // the app last named to its counter. The app names a screen once it is on
  // the page (App.svelte, in an effect that runs after this script and
  // after onMount). Words taken any sooner were counted under the screen
  // before this one, which is Create. After tick() the app has spoken.
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

  // The keys can load without the unlock step telling this screen: the step
  // says nothing when the address changed while its prompt was open, and a
  // switch of language changes the address. The wish for the words must not
  // outlive that. Left standing, it would bring the unlock step up unasked
  // the next time the wallet is locked.
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

  async function hide(): Promise<void> {
    drop();
    await tick();
    focusHeading();
  }

  /** "I have written them down": the "Wallet made" step is over, and the wallet's overview is next. */
  function written(): void {
    drop();
    wallet.ackCreated();
    navigate(router.link({ name: 'wallet' }));
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
      <p>{t.exception}</p>
      {#if strict}
        <p class="font-semibold text-ink-800" data-testid="never-real-money">{t.neverRealMoney}</p>
      {/if}
      <p class="text-sm">
        <OutLink href={chapterUrl(wallet.config.siteUrl, lang)}>{t.chapterLink}</OutLink>
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
          {#if tag !== null}
            <!-- The tag, not the whole name: the name was written in the
                 language the page had when the passkey was made, and this
                 screen is told the tag alone. -->
            <Rows>
              <Row name={t.madePasskeyTag}>
                <Mono value={tag} data-testid="passkey-tag" />
              </Row>
            </Rows>
          {/if}
          <Prose>
            {#if tag !== null}
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

      <!-- The card comes before the button: the button says the words are
           written down and takes them off the screen, so what to write
           them on has to be offered first. -->
      <PracticeCard />

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
      <Unlock why={t.unlockWhy} onunlocked={unlocked} class={EVEN_BUTTONS} />
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
      </Section>
    {/if}

    {#if !made}
      <PracticeCard />
    {/if}
  {/snippet}
</WalletFrame>
