<script lang="ts">
  // Remove: takes the wallet out of this browser, after a step that asks
  // first. It is the last part of the Settings screen.
  //
  // The question names what brings the wallet back, and says only what is
  // true. A wallet this browser opens with a passkey can come back with
  // that passkey, on this device or on another one that has it, and with
  // its 12 words. The text does not promise the passkey: a reader may be
  // here because theirs has just failed, so it says the 12 words are the
  // sure way. A wallet kept here with its 12 words comes back with those
  // words, or with its passkey if it was made with one, which this browser
  // cannot know; without either its practice coins are out of reach.
  //
  // "Remove it" removes the wallet and goes Home. "Keep it" closes the
  // question. If another tab removed or replaced the wallet while the
  // question was open, nothing is removed and the screen says so: the
  // reader said yes to one wallet, never to whichever is here now.
  //
  // The question is the only guard Remove has, so it must be seen before
  // it can be answered. Opening it does not move the page more than it
  // takes to bring the whole question on screen, both answers included,
  // and neither answer takes a press in the first moment after it opened
  // (keys/taps.ts): the second tap of a double tap on "Remove this
  // wallet" removes nothing, and leaves the question standing.

  import { tick } from 'svelte';
  import Actions from '../../components/Actions.svelte';
  import Button from '../../components/Button.svelte';
  import Notice from '../../components/Notice.svelte';
  import Prose from '../../components/Prose.svelte';
  import Section from '../../components/Section.svelte';
  import TextLink from '../../components/TextLink.svelte';
  import { navigate, router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import { afterRemove, removeBackKey, sameWallet } from './settings-flow.ts';
  import { answerCounts } from './taps.ts';

  const wallet = useWallet();

  /** For the id that ties what brings the wallet back to "Remove it". */
  const id = $props.id();

  let t = $derived(strings.settings[router.lang]);

  /** The reader has pressed Remove, and is being asked whether they mean it. */
  let asking = $state(false);
  /** The wallet the question is about, by its public key. */
  let askedFor: string | null = null;
  /** Nothing was removed, because the wallet here is no longer the one the reader was asked about. */
  let gone = $state(false);
  /** When the question opened, on the page's own clock (performance.now()), in ms. */
  let askedAt = 0;

  let root = $state<HTMLElement>();
  /** The whole question: the sentence, what brings the wallet back, and the two answers. */
  let box = $state<HTMLElement>();
  let question = $state<HTMLElement>();

  /** Focus goes back to the button that opened the question. */
  async function focusButton(): Promise<void> {
    await tick();
    root?.querySelector<HTMLElement>('[data-testid="remove-wallet"]')?.focus();
  }

  async function ask(): Promise<void> {
    askedFor = wallet.record?.xpub ?? null;
    asking = true;
    gone = false;
    askedAt = performance.now();
    await tick();
    // The question is read out, and Tab goes on to its two answers. Focus
    // by itself must not move the page: a browser brings what takes focus
    // to the middle of the screen, which put "Remove it" under the finger
    // that had just pressed the button and often left "Keep it" below the
    // screen's edge. The whole question is brought on screen instead, by
    // the shortest way, and nothing moves when it is there already.
    question?.focus({ preventScroll: true });
    box?.scrollIntoView({ block: 'nearest' });
  }

  /** True for a press on an answer that came too soon to count: the question has only just opened. */
  function tooSoon(event: MouseEvent): boolean {
    return !answerCounts(performance.now() - askedAt, event);
  }

  function keep(event: MouseEvent): void {
    if (tooSoon(event)) return;
    asking = false;
    void focusButton();
  }

  /** Closes the question and says that nothing was removed. */
  function sayGone(): void {
    asking = false;
    gone = true;
    void focusButton();
  }

  function remove(event: MouseEvent): void {
    // The question has only just opened, or this is the second click of a
    // double tap: the reader cannot have read it yet. Nothing happens, and
    // the question stays.
    if (tooSoon(event)) return;
    // The wallet changed in another tab since the question was asked: it is not removed.
    if (!sameWallet(askedFor, wallet.record?.xpub ?? null)) {
      sayGone();
      return;
    }
    if (afterRemove(wallet.removeWallet()) === 'home') {
      // The wallet is out of this browser. Home has the ways to open, restore or make one.
      asking = false;
      navigate(router.link({ name: 'home' }));
      return;
    }
    sayGone();
  }

  // A question that is still open when the wallet changes in another tab is
  // closed at once, before the reader can answer it for the wrong wallet.
  $effect(() => {
    const now = wallet.record?.xpub ?? null;
    if (asking && !sameWallet(askedFor, now)) sayGone();
  });
</script>

<Section title={t.removeTitle}>
  <div bind:this={root} class="space-y-4">
    <Prose>
      <p>{t.removeLead}</p>
      <p>{t.removeDrill}</p>
    </Prose>

    {#if gone}
      <Notice kind="problem" text={t.removeGone} data-testid="remove-gone" />
    {/if}

    <Actions>
      <Button data-testid="remove-wallet" aria-expanded={asking} onclick={() => void ask()}>{t.removeButton}</Button>
    </Actions>

    {#if asking && wallet.record !== null}
      <div bind:this={box}>
        <Notice kind="caution" data-testid="remove-question">
          <div class="space-y-3">
            <!-- tabindex="-1": it takes focus from code only, so that the question is read out. -->
            <p bind:this={question} tabindex="-1" class="font-semibold text-ink-800 outline-none">{t.removeAsk}</p>
            <p id="{id}-back" data-testid="remove-back">{t[removeBackKey(wallet.record.kind)]}</p>
            <p><TextLink href={router.link({ name: 'backup' })}>{t.removeShowWords}</TextLink></p>
            <!-- Full-size buttons of one width on a phone, with room between
                 them: one of the two cannot be undone from this screen. What
                 brings the wallet back is tied to "Remove it", so that a
                 screen reader says it when Tab reaches that button. -->
            <Actions>
              <Button data-testid="remove-confirm" class="w-full sm:w-auto" aria-describedby="{id}-back" onclick={remove}>
                {t.removeYes}
              </Button>
              <Button data-testid="remove-keep" class="w-full sm:w-auto" onclick={keep}>{t.removeNo}</Button>
            </Actions>
          </div>
        </Notice>
      </div>
    {/if}
  </div>
</Section>
