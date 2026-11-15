<script lang="ts">
  // The frame every wallet screen sits in.
  //
  // A wallet screen is one WalletFrame with its own content between the
  // tags. The frame draws what all of them share:
  //
  //   - the links to the wallet's sections, as chips that wrap, with the
  //     chip of the screen that is showing marked;
  //   - for a wallet made with a passkey, the one line that says whether it
  //     is locked, with the Lock button while it is not (a wallet made
  //     without a passkey shows neither);
  //   - the screen's heading;
  //   - what the practice network last said about the coins (SPEC section
  //     3): the first look still running, the first look failed, a later
  //     look failed, the network slow;
  //   - a note after an unlock that changed something (the saved details
  //     were wrong, or the reader switched to another passkey's wallet),
  //     and a note when another tab put a different wallet in this browser
  //     while the screen was open.
  //
  // It also speaks for the wallet: each thing the wallet announces (coins
  // arrived, 1 confirmation, payment sent, unlocked, locked) is said once
  // through the shell's status region. A screen never says those itself.
  // A switch to another passkey's wallet is said there too.
  //
  // The content is a snippet that is told whether the coins are known yet:
  //
  //   <WalletFrame title={t.title}>
  //     {#snippet children(known)}
  //       {#if known} ... the total, the coins ... {/if}
  //     {/snippet}
  //   </WalletFrame>
  //
  // While `known` is false there is no total to show, and never a total of 0.

  import { onDestroy, tick, untrack, type Snippet } from 'svelte';
  import { fill, formatElapsed } from '../../lib/format.ts';
  import { focusHeading, router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import Actions from '../Actions.svelte';
  import Button from '../Button.svelte';
  import Chips from '../Chips.svelte';
  import Countdown from '../Countdown.svelte';
  import Notice from '../Notice.svelte';
  import Page from '../Page.svelte';
  import Waiting from '../Waiting.svelte';
  import { announce } from '../status.svelte.ts';
  import { SECTIONS, chainFailureText, chainPhase, noteAnnouncement, noticeText } from './frame.ts';
  import { provideFrameNotes, type FrameNotes } from './frame-notes.ts';
  import WalletId from './WalletId.svelte';

  interface Props {
    /** The screen's heading. A step that swaps in place changes it, awaits tick() and calls focusHeading(). */
    title: string;
    /** The screen's name in the document title, when it should differ from the heading. */
    titleName?: string;
    /** One or two sentences under the heading. */
    lede?: string;
    /**
     * False for a screen that shows no coins (Backup, Settings): the frame
     * then says nothing about looking them up, so the 12 words can be shown
     * while the practice network is down.
     */
    coins?: boolean;
    /** The screen's content. It is told whether the wallet's coins are known yet. */
    children: Snippet<[known: boolean]>;
  }

  let { title, titleName, lede, coins = true, children }: Props = $props();

  const wallet = useWallet();

  let lang = $derived(router.lang);
  let t = $derived(strings.wallet[lang]);
  let c = $derived(strings.common[lang]);

  /**
   * True once this frame has left the screen. An action that waited for the
   * wallet then stops where it is: whatever it would do next (move focus to
   * the heading, scroll to it) would be done to the screen that is showing
   * now, which is another one.
   */
  let gone = false;
  onDestroy(() => (gone = true));

  let chips = $derived(
    SECTIONS.map((name) => ({
      href: router.link({ name }),
      text: c[`section_${name}`],
      current: router.route.name === name,
    })),
  );

  let passkey = $derived(wallet.record?.kind === 'passkey');
  let known = $derived(wallet.chain.state !== null);
  let phase = $derived(chainPhase(wallet.chain));
  /** A look at the network is under way: the wallet's own, or one the reader asked for. */
  let looking = $derived(wallet.chain.scanning);

  // -- what an unlock changed -----------------------------------------------------

  // The unlock step, inside this frame, leaves its note here (frame-notes.ts).
  const notes = $state<FrameNotes>({ note: null });
  provideFrameNotes(notes);

  async function readNote(): Promise<void> {
    notes.note = null;
    // The button that had focus is gone with the note.
    await tick();
    focusHeading();
  }

  // -- what the wallet announces --------------------------------------------------

  // The notice that is there when the screen opens was said on the screen
  // before this one. Only a newer one is said here.
  let said = wallet.notice?.id ?? null;
  $effect(() => {
    const notice = wallet.notice;
    if (notice === null || notice.id === said) return;
    said = notice.id;
    announce(noticeText(notice, lang));
    // Another tab put a different wallet in this browser. What is on screen changed under the
    // reader's eyes (on Receive, the address), so it is not only said: the note stays on screen
    // until the reader has read it.
    if (notice.kind === 'replaced') untrack(() => (notes.note = { kind: 'replaced' }));
  });

  // A note from an unlock that does not speak for itself is said as well,
  // once, when it arrives (frame.ts says which). It comes after the effect
  // above on purpose: should the wallet announce "unlocked" in the same
  // moment, the status region ends up holding what matters more, that this
  // browser now holds another wallet. The effect follows the note alone.
  $effect(() => {
    const note = notes.note;
    if (note === null) return;
    untrack(() => {
      const text = noteAnnouncement(note, lang);
      if (text !== null) announce(text);
    });
  });

  // -- the lock ---------------------------------------------------------------------

  async function lock(): Promise<void> {
    wallet.lock();
    // The Lock button is gone: focus goes to the heading, not to nowhere.
    await tick();
    focusHeading();
  }

  // -- trying again -------------------------------------------------------------------

  /** How many times the reader has pressed "Try again" on this screen. */
  let tries = $state(0);
  let trying = $state(false);

  async function tryAgain(): Promise<void> {
    if (trying) return;
    trying = true;
    await wallet.refresh();
    // The reader has moved on to another screen meanwhile: nothing here is theirs to see.
    if (gone) return;
    trying = false;
    if (wallet.chain.error !== null) {
      // Failed again. The line is drawn afresh, so that it is read out again.
      tries += 1;
      return;
    }
    // It worked: the line and its button are gone.
    await tick();
    focusHeading();
  }

  // How long ago the coins were last checked. The text is redrawn now and
  // then while the line shows, so that "3 minutes ago" does not go stale.
  let now = $state(Date.now());
  $effect(() => {
    if (phase !== 'stale') return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 10_000);
    return () => clearInterval(timer);
  });
  let checked = $derived.by(() => {
    const at = wallet.chain.checkedAt;
    return at === null ? '' : fill(t.chainStale, { when: formatElapsed(Math.max(0, (now - at) / 1000), lang) });
  });
</script>

<!-- The cause of a failed look, and what the page does about it by itself. -->
{#snippet failure(stale: boolean)}
  {#if wallet.chain.error !== null}
    <div class="space-y-3" data-testid={stale ? 'chain-stale' : 'chain-failed'}>
      <!-- Announced only when it answers the reader's own "Try again". -->
      {#key tries}
        <Notice kind="problem" silent={tries === 0} text={chainFailureText(wallet.chain.error, lang)} />
      {/key}
      <!-- The frame's own lines are the way out: what is still shown, when
           the page tries again by itself, and the button to try now. The
           countdown draws nothing once its time has passed. -->
      <div class="space-y-1 text-sm text-ink-500">
        {#if stale && checked !== ''}<p>{checked}</p>{/if}
        {#if wallet.chain.retryAt !== null && !looking}
          <Countdown to={wallet.chain.retryAt} text={t.chainRetryIn} class="block" data-testid="chain-retry" />
        {/if}
      </div>
      <Actions tight>
        <Button variant="quiet" busy={trying || looking} busyText={t.chainLooking} onclick={() => void tryAgain()}>
          {c.tryAgain}
        </Button>
      </Actions>
    </div>
  {/if}
{/snippet}

<Page {title} {titleName} {lede}>
  {#snippet above()}
    <Chips label={c.sectionsLabel} items={chips} />
    {#if passkey}
      <!-- On a phone the sentence wraps beside the Lock button where that leaves it a column of
           192 px or more (basis-48), and the button goes under it only where it does not. Left
           to itself the sentence took the whole row and pushed the button onto a line of its
           own: every line saved here is a line of the screen's own content in the first view.
           From 640 px the sentence is as wide as its words, with the button right after it. -->
      <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="lock-state">
        <p class="min-w-0 flex-1 basis-48 text-pretty text-sm text-ink-500 sm:flex-initial">
          {wallet.unlocked ? c.stateUnlocked : c.stateLocked}
        </p>
        {#if wallet.unlocked}
          <Button variant="quiet" data-testid="lock" onclick={() => void lock()}>{c.lock}</Button>
        {/if}
      </div>
    {/if}
  {/snippet}

  {#if notes.note !== null}
    {#if notes.note.kind === 'tampered'}
      <Notice kind="problem" text={t.noteTampered} data-testid="unlock-note">
        <Button variant="quiet" onclick={() => void readNote()}>{t.noteOk}</Button>
      </Notice>
    {:else if notes.note.kind === 'replaced'}
      <Notice kind="caution" text={t.noteReplaced} data-testid="replaced-note">
        <Button variant="quiet" onclick={() => void readNote()}>{t.noteOk}</Button>
      </Notice>
    {:else}
      <Notice kind="caution" text={t.noteSwitched} data-testid="unlock-note">
        <div class="space-y-3">
          <WalletId tag={notes.note.tag} fingerprint={notes.note.fingerprint} />
          <Button variant="quiet" onclick={() => void readNote()}>{t.noteOk}</Button>
        </div>
      </Notice>
    {/if}
  {/if}

  {#if coins}
    {#if phase === 'looking'}
      <Waiting text={t.chainLooking} data-testid="chain-looking" />
    {:else if phase === 'failed'}
      {@render failure(false)}
    {:else if phase === 'stale'}
      {@render failure(true)}
    {/if}
    {#if wallet.chain.slow}
      <Notice text={t.chainSlow} data-testid="chain-slow" />
    {/if}
  {/if}

  {@render children(known)}
</Page>
