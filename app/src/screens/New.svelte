<script lang="ts">
  // Create: make a practice wallet, with a passkey or without one.
  //
  // The two ways stand one under the other, the passkey first, and each
  // says before its button what the tap will do: what the device is about
  // to ask and where the wallet's 12 words come from, or that the words
  // will be kept in this browser, not encrypted. Neither is marked as the
  // better one.
  //
  // The passkey's panel has four faces (passkeyFace in front/flow.ts):
  //   checking     the browser has not yet said whether it offers passkeys:
  //                the button waits, switched off, and a line under it says
  //                why (on the faded button the words would be too faint)
  //   offer        the explanation and "Create with a passkey"
  //   not-offered  this browser offers none: open the page in the device's
  //                own browser, or go on without a passkey
  //   finish       a passkey was saved and has not given its secret yet
  //                (wallet.setup): "Finish setting up". It stays for as
  //                long as the wallet says so, also when the reader leaves
  //                this screen and comes back.
  //
  // Every answer the wallet can give has its text (createView in
  // front/flow.ts says what each one means after which tap):
  //   created      on to /wallet/backup, which opens as the "Wallet made" step
  //                (unless the reader has left for another screen meanwhile)
  //   unfinished   the panel turns to "Finish setting up"
  //   exists, no-storage, reload
  //                the whole screen stops, and says why (FrontGate)
  //   cancelled, timed out, no-prf, error, busy, broken
  //                the sentence from the error table (PasskeyProblem), right
  //                above the button that was pressed, with what Create adds:
  //                what was saved and what was not, how to delete a passkey
  //                that can never make a wallet, and the other way on
  //
  // Before any of that the screen looks at what this browser holds. A
  // wallet that is here already, something stored that cannot be read, a
  // storage the page was not let look into (a wallet may be in it) and a
  // browser that refuses to store anything each stand in the screen's
  // place, so that nothing is made that could not be kept, and nothing
  // beside a wallet nobody can see.
  //
  // While a passkey prompt is open, and while a wallet is being made,
  // <main> is marked busy (busyWhile).

  import { onDestroy, tick } from 'svelte';
  import Button from '../components/Button.svelte';
  import Card from '../components/Card.svelte';
  import Details from '../components/Details.svelte';
  import Mono from '../components/Mono.svelte';
  import Notice from '../components/Notice.svelte';
  import Page from '../components/Page.svelte';
  import { busyWhile } from '../components/status.svelte.ts';
  import Waiting from '../components/Waiting.svelte';
  import { SAFARI_KEEPS_DAYS } from '../components/wallet/frame.ts';
  import PasskeyProblem from '../components/wallet/PasskeyProblem.svelte';
  import { fill } from '../lib/format.ts';
  import { navigate, router } from '../lib/router.svelte.ts';
  import type { CeremonyFailure, CreateResult } from '../lib/wallet-api.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import FrontGate from './front/FrontGate.svelte';
  import {
    createView,
    frontGate,
    passkeyFace,
    passkeyNameStart,
    type CreateView,
    type Gate,
    type Way,
  } from './front/flow.ts';

  const wallet = useWallet();

  let t = $derived(strings.create[router.lang]);
  let c = $derived(strings.common[router.lang]);

  /** Which tap is being answered. */
  let busy = $state<Way | null>(null);
  /** How the last tap ended, unless it made a wallet. */
  let last = $state.raw<{ way: Way; view: CreateView } | null>(null);

  let face = $derived(passkeyFace(wallet.passkeyOffered, wallet.setup));
  /** The last answer, when it stopped the whole screen. */
  let stop = $derived(last !== null && last.view.kind === 'stopped' ? last.view.why : null);
  /** That answer came after a passkey prompt: a passkey may have been saved that now has no wallet. */
  let orphan = $derived(last !== null && last.view.kind === 'stopped' && last.view.orphan);
  // Held open while a tap is being answered: the wallet that the tap itself
  // makes must not show as "already here" before the screen moves on to it.
  let gate = $derived<Gate>(busy !== null ? 'open' : frontGate(wallet.status, wallet.canStore, stop));

  /** What the device is about to ask. The passkey's name is in the question, so it is in the sentence. */
  let ask = $derived(fill(t.passkeyAsk, { name: passkeyNameStart(c.passkeyName) }));
  let erased = $derived(fill(t.wordsErased, { days: String(SAFARI_KEEPS_DAYS) }));
  /** The passkey that is waiting, by the tag in its name when the wallet knows it. */
  let waiting = $derived.by(() => {
    const tag = wallet.setup?.tag ?? null;
    return tag === null ? t.unfinished : fill(t.unfinishedTagged, { tag });
  });
  /** The passkey was saved by the tap that has just been answered: said aloud, once. */
  let justSaved = $derived(last !== null && last.view.kind === 'unfinished' && !last.view.again);

  /** How to delete a passkey that can never make a wallet: by the site it was saved for, and its tag when known. */
  function deleteHow(failure: CeremonyFailure): string {
    const host = wallet.config.passkeyHost;
    const tag = failure.kind === 'no-prf' ? failure.tag : null;
    return tag === null ? fill(t.noPrfDelete, { host }) : fill(t.noPrfDeleteTagged, { host, tag });
  }

  let root = $state<HTMLElement>();

  /** True once the screen has left the page. */
  let gone = false;
  onDestroy(() => {
    gone = true;
  });

  /**
   * After an answer that made no wallet and left the screen standing: the
   * answer is brought on screen, and focus stays on something to press.
   * (After a stop, FrontGate has moved focus to the heading.)
   */
  function settle(way: Way): void {
    const within = (hook: string): HTMLElement | null => root?.querySelector<HTMLElement>(`[data-testid="${hook}"]`) ?? null;
    // The notice, or else the line that says a passkey was saved and is
    // waiting: that line is the whole answer the first time the follow-up
    // prompt is dismissed.
    const said = within('create-problem') ?? within('create-unfinished');
    if (said !== null) {
      // What is on the screen already stays where it is ("nearest"). But
      // something taller than the screen is lined up by its start: left to
      // "nearest", it can be lined up by its end, with the cause above the
      // screen. (The room on the screen is its height less what the page
      // keeps free at the top for the PRACTICE banner.)
      const room = window.innerHeight - (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0);
      said.scrollIntoView({ block: said.getBoundingClientRect().height > room ? 'start' : 'nearest' });
    }
    // The button that was pressed keeps focus while it is still there. "Create
    // with a passkey" is gone once a passkey is waiting: its place is taken by
    // "Finish setting up". And "Finish setting up" is gone once the wallet
    // has given that passkey up: "Create with a passkey" is back.
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (!lost) return;
    // Without scrolling again: the start of what was said (the cause) stays
    // on the screen, with the button under it.
    (within(way === 'words' ? 'create-words' : 'finish-setup') ?? within('create-passkey'))?.focus({ preventScroll: true });
  }

  async function run(way: Way): Promise<void> {
    if (busy !== null) return;
    busy = way;
    last = null;
    let result: CreateResult;
    if (way === 'passkey') result = await busyWhile(wallet.createWithPasskey());
    else if (way === 'finish') result = await busyWhile(wallet.finishSetup());
    else result = await busyWhile(wallet.createWithWords());
    const view = createView(result, way);
    if (view.kind === 'made') {
      // The wallet is in this browser, with its keys loaded: its 12 words are
      // shown next, with no second prompt. `busy` stays set, so this screen
      // shows nothing new in the moment before it leaves. Its place in the
      // history is taken by the next screen: Back from there leads past a
      // Create that could only say a wallet is here already. A reader who
      // went to another screen while the prompt was open is left where they
      // are: the wallet is here, Backup still opens as "Wallet made", and
      // "Open my practice wallet" leads there (front/WalletHere.svelte). A
      // reader who is on Create again by now goes on like any other: left
      // there, they would be told that a wallet is "already" here and to
      // remove it, about the wallet they have just made.
      if (!gone || router.route.name === 'new') navigate(router.link({ name: 'backup' }), { replace: true });
      return;
    }
    busy = null;
    if (gone) return;
    last = { way, view };
    if (view.kind === 'stopped') return;
    await tick();
    settle(way);
  }

  const TEXT = 'text-pretty leading-relaxed text-ink-700';
  /** On a phone a panel's button takes the whole width, so it keeps its size when its words change while it waits. */
  const WIDE = 'w-full sm:w-auto';
</script>

<!-- What a tap that made no wallet is answered with, right above the button that was pressed. -->
{#snippet answer(view: CreateView)}
  {#if view.kind === 'problem'}
    {#if view.advice === 'none'}
      <PasskeyProblem failure={view.failure} data-testid="create-problem" />
    {:else}
      <PasskeyProblem failure={view.failure} data-testid="create-problem">
        {#if view.advice === 'nothing-saved'}
          <p>{t.cancelledNothing}</p>
          <p>{t.cancelledWays}</p>
        {:else if view.advice === 'still-waiting'}
          <p>{t.stillWaiting}</p>
        {:else if view.advice === 'delete-passkey'}
          <p data-testid="create-delete-passkey">{deleteHow(view.failure)}</p>
          <p>{t.noPrfElsewhere}</p>
        {/if}
      </PasskeyProblem>
    {/if}
  {:else if view.kind === 'unfinished'}
    <!-- The first time, the panel itself says that a passkey is waiting. -->
    {#if view.again}
      <Notice kind="problem" text={t.unfinishedAgain} data-testid="create-problem" />
    {/if}
  {:else if view.kind === 'fault'}
    <Notice kind="problem" text={t.wordsFailed} data-testid="create-problem">
      <Details summary={c.details}>
        <Mono value={view.name} />
      </Details>
    </Notice>
  {/if}
{/snippet}

<!-- Under "a wallet arrived" and "this browser stores nothing", and under the card that says the page could not
     read this browser's storage, when the tap had opened a passkey prompt. -->
{#snippet orphaned()}
  <p data-testid="create-orphan">{t.orphan}</p>
{/snippet}

<Page title={c.screen_new} lede={gate === 'open' ? t.lede : undefined}>
  <FrontGate {gate} {stop} extra={orphan ? orphaned : undefined}>
    <div bind:this={root} class="space-y-8">
      <Card title={t.passkeyTitle} data-testid="create-with-passkey">
        <div class="space-y-4">
          {#if face === 'not-offered'}
            <p class={TEXT} data-testid="create-not-offered">{t.passkeyNotOffered}</p>
          {:else if face === 'finish'}
            <!-- A new element whenever `justSaved` changes. The wallet says that a passkey is waiting
                 before the tap is answered, so the line is on the page first and would only be made
                 an alert afterwards. A screen reader says an alert that is put on the page, and may
                 say nothing when a line that is already there becomes one. -->
            {#key justSaved}
              <p class={TEXT} role={justSaved ? 'alert' : undefined} data-testid="create-unfinished">{waiting}</p>
            {/key}
            {#if last !== null && last.way !== 'words'}{@render answer(last.view)}{/if}
            <div>
              <Button
                variant="primary"
                class={WIDE}
                data-testid="finish-setup"
                busy={busy === 'finish'}
                busyText={t.passkeyBusy}
                disabled={busy !== null && busy !== 'finish'}
                onclick={() => void run('finish')}
              >
                {t.finishGo}
              </Button>
            </div>
          {:else if face === 'checking' || face === 'offer'}
            <div class={['space-y-3', TEXT]}>
              <p>{t.passkeyMakes}</p>
              <p>{ask}</p>
              <p class="text-sm text-ink-500">{t.passkeySent}</p>
            </div>
            {#if last !== null && last.way !== 'words'}{@render answer(last.view)}{/if}
            <div class="space-y-3">
              <div>
                <Button
                  variant="primary"
                  class={WIDE}
                  data-testid="create-passkey"
                  busy={busy === 'passkey'}
                  busyText={t.passkeyBusy}
                  disabled={face === 'checking' || (busy !== null && busy !== 'passkey')}
                  onclick={() => void run('passkey')}
                >
                  {t.passkeyGo}
                </Button>
              </div>
              {#if face === 'checking'}
                <!-- Why the button cannot be pressed yet, in a line of its own. A switched-off
                     button is faded, and its words with it: too faint for the one line that
                     gives the reason. -->
                <Waiting inline text={t.passkeyChecking} data-testid="create-checking" />
              {/if}
            </div>
          {/if}
        </div>
      </Card>

      <Card title={t.wordsTitle} data-testid="create-without-passkey">
        <div class="space-y-4">
          <div class={['space-y-3', TEXT]}>
            <p>{t.wordsKept}</p>
            <p>{erased}</p>
          </div>
          {#if last !== null && last.way === 'words'}{@render answer(last.view)}{/if}
          <div>
            <Button
              variant="primary"
              class={WIDE}
              data-testid="create-words"
              busy={busy === 'words'}
              busyText={t.wordsBusy}
              disabled={busy !== null && busy !== 'words'}
              onclick={() => void run('words')}
            >
              {t.wordsGo}
            </Button>
          </div>
        </div>
      </Card>

      <p class="text-pretty text-sm text-ink-500">{t.foot}</p>
    </div>
  </FrontGate>
</Page>
