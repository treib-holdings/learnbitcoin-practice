<script lang="ts">
  // The faucet: "Get practice coins", and what becomes of the request.
  //
  // Before the tap the card says what the faucet pays and what the bot
  // check is: Cloudflare's, loaded only when coins are asked for, given the
  // address. A wallet opened with a passkey is also told that asking locks
  // it, what that keeps from the check's code, and to cancel a passkey
  // prompt or close a window that comes after the tap: this page opens
  // neither then, and the lock cannot stop the check's code from doing so.
  // The button names those paragraphs as its description, so a reader who
  // tabs to it hears them too. Nothing of the bot check is in the page until
  // the tap.
  //
  // The tap hands the wallet a token source (bot-check.ts). The wallet runs
  // the request and publishes its phases; this card only draws them
  // (FaucetState.svelte) and holds the element the bot check's widget is
  // drawn in. That element is always there and always empty in the markup:
  // what is inside it belongs to the widget's script.
  //
  // What the faucet answers stands under the button, and on a phone that is
  // often below the screen's edge. So the card brings it on screen: the
  // words when they answer the reader's own tap, and the bot check's box
  // whenever it shows, because then it waits for the reader. A reader who
  // cannot see the box is told through the status region.
  //
  // With no site key in the server's settings there is no bot check, and
  // the faucet is closed: the card says so and has a Reload button in place
  // of the faucet's, because the settings are read when the page loads.
  // Until the settings have arrived the card says only that it is loading,
  // and if they never come it says that, and not that the faucet is closed
  // (the wallet says which of the three it is: wallet.settings).
  //
  // The card is a part of the Receive screen that an address can name:
  // "#faucet". Every "Get practice coins" on the other wallet screens leads
  // to that address, because on a phone the faucet is one to three screens
  // below the top of Receive. When the screen was opened for the faucet,
  // the card brings itself on screen and puts focus on its heading.

  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import Actions from '../../components/Actions.svelte';
  import Button from '../../components/Button.svelte';
  import Card from '../../components/Card.svelte';
  import Notice from '../../components/Notice.svelte';
  import { announce, busyWhile } from '../../components/status.svelte.ts';
  import { splitLead } from '../../components/text.ts';
  import Waiting from '../../components/Waiting.svelte';
  import { FAUCET_PART, satsText } from '../../components/wallet/frame.ts';
  import ReloadButton from '../../components/wallet/ReloadButton.svelte';
  import { fill } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import type { ReceiveView, TokenSource } from '../../lib/wallet-api.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import { makeBotCheck } from './bot-check.ts';
  import { BOX_SAY_MS, askButton, boxWasWaiting, offersMore } from './faucet.ts';
  import FaucetState from './FaucetState.svelte';
  import { bringIntoView } from './view.ts';

  interface Props {
    /** The address on screen: the one the faucet is asked to pay. */
    receive: ReceiveView;
  }

  let { receive }: Props = $props();
  /** Names the paragraphs above the button, so that the button can point to them as its description. */
  const about = $props.id();

  const wallet = useWallet();

  let lang = $derived(router.lang);
  let t = $derived(strings.receive[lang]);
  let e = $derived(strings.errors[lang]);

  let view = $derived(wallet.faucet);
  /** No site key, no bot check: the faucet is closed. */
  let open = $derived(wallet.config.turnstileSiteKey !== '');

  // The site key comes with the server's settings, and the built-in ones
  // have none. So an empty key is a closed faucet only once the server's
  // settings are here; until then the card is loading, and if they could
  // not be read, that is what it says.
  let settings = $derived(wallet.settings);

  let button = $derived(askButton(view.phase));
  let passkey = $derived(wallet.record?.kind === 'passkey');
  /** What the faucet pays, with its unit. */
  let pays = $derived(satsText(BigInt(wallet.config.faucetSats), lang));
  /** The faucet has paid, and the way to more coins ("Show a new address") can be taken. */
  let more = $derived(offersMore(receive.arrived, view));

  /** Where the bot check's widget is drawn. */
  let box = $state<HTMLElement>();
  /** The words under the button: what has become of the request. */
  let line = $state<FaucetState>();
  /** Those words and the bot check's box together: everything that answers the tap. */
  let answer = $state<HTMLElement>();

  let gone = false;
  /** Takes the busy mark off <main> for the request that is starting. Null when none is. */
  let started: (() => void) | null = null;
  /** True once the reader has asked from this screen. */
  let asked = false;
  /** True when the last bot check ran out of time while its box stood on screen, waiting to be ticked. */
  let boxWaited = $state(false);

  /** Brings what answers the tap on screen. Nothing moves when it is there already. */
  function showAnswer(): void {
    if (answer !== undefined) bringIntoView(answer);
  }

  // -- the bot check's box ------------------------------------------------------------
  //
  // The widget is drawn so that it shows only when it needs the reader
  // (lib/turnstile.ts, "interaction-only"). While it has no height the
  // check runs unseen. Once it has one, it is a box that waits for a tick.

  /** How tall the widget's place is on screen right now, in pixels. */
  const boxHeight = (): number => box?.offsetHeight ?? 0;
  /** True while the widget takes room on screen, as last seen by the watcher below. */
  let boxShows = false;
  /** The timer that says, a moment after the box has appeared, that it is there. */
  let boxSays: number | undefined;

  function boxChanged(): void {
    const shows = boxHeight() > 0;
    if (shows === boxShows) return;
    boxShows = shows;
    window.clearTimeout(boxSays);
    if (!shows) return;
    // The box waits for the reader: on screen with it, and with the words above it that say to tick it.
    showAnswer();
    // A reader who cannot see the box is told that it is there. Not at once:
    // a check that needs nobody is over before this runs. The box is looked
    // at again then, since only a box that is still there is worth saying.
    boxSays = window.setTimeout(() => {
      if (boxHeight() > 0 && wallet.faucet.phase === 'checking') announce(t.checkBoxShows);
    }, BOX_SAY_MS);
  }

  // The widget's script changes the box when it likes (the real one gives it
  // a height only when it wants a tick), so the box's size is watched. The
  // watcher is the one place that says whether the box shows: it is told
  // once the browser has laid the page out, and so never sees a widget that
  // came and went within one frame.
  $effect(() => {
    const element = box;
    // A browser too old to watch a size shows the box all the same. It only does not bring it on screen.
    if (element === undefined || typeof ResizeObserver === 'undefined') return;
    const watcher = new ResizeObserver(boxChanged);
    watcher.observe(element);
    return () => watcher.disconnect();
  });

  const botCheck = makeBotCheck<HTMLScriptElement, HTMLElement>({
    before: () => wallet.beforeBotCheck(),
    // The widget is on the page: from here on the reader may have a box to tick.
    drawn: () => started?.(),
    // A check gave no token. Whether its box was on screen is read now, while the widget is still there.
    ended: (why) => {
      boxWaited = boxWasWaiting(why, boxHeight());
    },
    document,
    turnstile: () => (window as { turnstile?: unknown }).turnstile,
    // Read when the widget is drawn: the address is the one on screen at that moment.
    target: () => {
      const here = wallet.receive;
      const siteKey = wallet.config.turnstileSiteKey;
      if (box === undefined || here === null || siteKey === '') return null;
      return { container: box, width: box.clientWidth, siteKey, address: here.address, lang: router.lang };
    },
    timers: {
      set: (run, ms) => window.setTimeout(run, ms),
      clear: (handle) => window.clearTimeout(handle as number),
    },
  });

  onDestroy(() => {
    gone = true;
    window.clearTimeout(boxSays);
    botCheck.close();
  });

  // The screen was opened for the faucet ("#faucet"): the card comes on
  // screen, and its heading takes focus, so that a screen reader says where
  // the reader has landed and Tab goes on from there. One frame after the
  // card is drawn, and not at once: the router has just put the new screen
  // at its top with focus on the screen's own heading, and does so right
  // after the screen is drawn. (After a page load the card is drawn later
  // than the screen, once the wallet's first look at its coins is done.)
  onMount(() => {
    if (!router.takePart(FAUCET_PART)) return;
    const frame = requestAnimationFrame(() => {
      const card = document.getElementById(FAUCET_PART);
      if (card === null) return;
      bringIntoView(card);
      card.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  });

  async function ask(): Promise<void> {
    if (!open || button !== 'ready') return;
    asked = true;
    boxWaited = false;
    // <main> is marked busy from the tap until the bot check's widget is on
    // screen, or the check has ended without one. No longer: the widget may
    // ask the reader to tick a box, and a screen reader must not be kept
    // from a screen that is waiting for its user. From there on the
    // wallet's own phases say where the request stands.
    let release = (): void => {};
    const start = new Promise<void>((resolve) => (release = resolve));
    started = release;
    const source: TokenSource = async (fresh) => {
      try {
        return await botCheck.token(fresh);
      } finally {
        release();
      }
    };
    const request = wallet.askFaucet(source);
    // However the request ends, the mark goes: also when the wallet never asked for a token.
    void request.then(release, release);
    // The first words of the answer ("Checking...") are under the button now.
    void tick().then(showAnswer);
    await busyWhile(start);
    await request;
    if (started === release) started = null;
    if (gone) return;
    // Once the faucet has paid there is no button any more. If focus was on
    // it, it would now be nowhere: it goes to what took the button's place.
    await tick();
    if (askButton(wallet.faucet.phase) === 'done' && document.activeElement === document.body) {
      line?.focus();
      showAnswer();
    }
  }

  // What the request came to is said once, when the faucet answers: that it
  // has sent the coins, or that it has paid this address before. (That the
  // coins arrived, and their first confirmation, the wallet frame says.) A
  // phase that is already there when the screen opens was said before.
  let last = wallet.faucet.phase;
  $effect(() => {
    const now = view;
    if (now.phase === last) return;
    last = now.phase;
    // An answer to the reader's own tap is brought on screen: refused for
    // now, promised, failed. Not the coins arriving or their confirmation:
    // those come by themselves, perhaps while the reader reads something else.
    if (asked && (now.phase === 'waiting' || now.phase === 'on-its-way' || now.phase === 'failed')) {
      void tick().then(showAnswer);
    }
    if (now.phase !== 'on-its-way') return;
    const text =
      now.payment !== null
        ? fill(t.statePromised, { amount: satsText(BigInt(now.payment.amountSats), lang) })
        : t.statePaidBefore;
    untrack(() => announce(splitLead(text).lead));
  });
</script>

<!-- scroll-mt-4: when the page moves to show the card, it does not start flush under the banner. -->
<Card tone="grey" title={t.faucetTitle} id={FAUCET_PART} class="scroll-mt-4" data-testid="faucet">
  {#if settings === 'loading'}
    <!-- The settings are still on their way: whether the faucet is open is not known yet. -->
    <Waiting inline data-testid="faucet-loading" />
  {:else if settings === 'failed'}
    <!-- The settings never came, so whether the faucet is open is still not known. The cause is
         the one every unanswered request has; the line under it says what follows for the faucet,
         and the button is the one way to ask again. Not announced: it answers no tap. -->
    <Notice kind="problem" silent text={e.network} data-testid="faucet-settings-failed">
      <div class="space-y-3">
        <p class="text-sm">{t.settingsFailed}</p>
        <ReloadButton variant="quiet" class="bg-white" data-testid="faucet-settings-reload" />
      </div>
    </Notice>
  {:else if !open}
    <!-- Already there when the screen opens, so it is not announced as an answer to something.
         The sentence ends "Try again later": on this page only a reload looks again, which the
         line and the button say. -->
    <Notice kind="problem" silent text={e.closed} data-testid="faucet-closed">
      <div class="space-y-3">
        <p class="text-sm">{t.closedReload}</p>
        <ReloadButton variant="quiet" class="bg-white" data-testid="faucet-closed-reload" />
      </div>
    </Notice>
  {:else}
    <div id={about} class="space-y-3">
      <p class="text-base leading-normal text-ink-800">{fill(t.faucetPays, { amount: pays })}</p>
      <!-- What the tap sets going. Once the faucet has paid there is no button, and both have happened. -->
      {#if button !== 'done'}
        <p class="text-sm text-ink-600">{t.faucetCheck}</p>
        {#if passkey}
          <p class="text-sm text-ink-600" data-testid="faucet-locks">{t.faucetLocks}</p>
          <p class="text-sm text-ink-600" data-testid="faucet-no-prompt">{t.faucetNoPrompt}</p>
        {/if}
      {/if}
    </div>

    {#if button !== 'done'}
      <Actions class="mt-5">
        <Button
          variant="primary"
          class="w-full sm:w-auto"
          busy={button === 'busy'}
          busyText={t.faucetBusy}
          aria-describedby={about}
          data-testid="faucet-ask"
          onclick={() => void ask()}
        >
          {t.faucetAsk}
        </Button>
      </Actions>
    {/if}

    <!-- scroll-mb-4: when the page moves to show the answer, it does not end flush with the screen's edge. -->
    <div bind:this={answer} class="scroll-mb-4">
      {#if view.phase !== 'idle'}
        <div class="mt-5">
          <FaucetState bind:this={line} {view} {more} {boxWaited} />
        </div>
      {/if}

      <!-- The bot check's widget. It takes room only while a widget is in it. -->
      <div bind:this={box} class="[&:not(:empty)]:mt-4" data-testid="bot-check"></div>
    </div>
  {/if}
</Card>
