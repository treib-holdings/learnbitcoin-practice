<script lang="ts">
  // The wallet's transactions as a list, with every state the list can be
  // in: not read yet, could not be read, empty, and the rows themselves.
  // The Activity screen shows all of them; the Overview passes `limit` and
  // shows the latest few.
  //
  // When a read fails, the list as it was last read stays on screen. Who
  // says why depends on what else failed (read.ts, activityNotice):
  //
  //   - Only the list could not be read. The cause stands above it with
  //     "Try again", which has the wallet look at the practice network
  //     again (wallet.refresh()). The wallet also tries again by itself,
  //     but it does not say when, so no countdown is shown for the list.
  //   - The look at the coins failed as well. Then the wallet frame, at the
  //     top of the screen, already shows the cause and a "Try again" that
  //     reads this list too. The list adds no second copy of either: one
  //     small line says what the reader is looking at.
  //
  // The cause is the sentence from the error table, as the wallet frame
  // shows it for the coins (chainFailureText): where the sentence's whole
  // way out is to wait and try again, that last part is left out, because
  // the lines under it say exactly that.
  //
  // "Try again" is answered when the list has been read, not before. The
  // wallet's refresh() reads the coins again and then the list, and
  // resolves when that read of the list has ended: the button stays busy
  // until then, and what the wallet shows at that moment is how the try
  // went. A failure is read out again then, also when it is the same
  // failure as before and nothing on screen has changed.

  import { onDestroy, tick, untrack } from 'svelte';
  import Actions from '../../components/Actions.svelte';
  import Button from '../../components/Button.svelte';
  import Empty from '../../components/Empty.svelte';
  import Notice from '../../components/Notice.svelte';
  import Waiting from '../../components/Waiting.svelte';
  import { chainFailureText, faucetLink } from '../../components/wallet/frame.ts';
  import TxList from '../../components/wallet/TxList.svelte';
  import { focusHeading, router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import { activityNotice, activityShows, firstFew } from './read.ts';

  interface Props {
    /** Show only the latest so many. Without it, every transaction. */
    limit?: number;
    /**
     * For the screen that is this list (Activity): the empty line stands
     * as the Coins screen's does, with the way to the faucet inside it.
     * Without it the empty line is one small line, for a screen that
     * offers the faucet already.
     */
    faucet?: boolean;
  }

  let { limit, faucet = false }: Props = $props();

  const wallet = useWallet();

  let lang = $derived(router.lang);
  let t = $derived(strings.wallet[lang]);
  let c = $derived(strings.common[lang]);

  let shows = $derived(activityShows(wallet.history, wallet.historyError));
  /** Who says that the list could not be read: the list itself, or the wallet frame above it. */
  let notice = $derived(activityNotice(wallet.historyError, wallet.chain.error));
  let txs = $derived.by(() => {
    const all = wallet.history ?? [];
    return limit === undefined ? all : firstFew(all, limit);
  });

  /** The reader's own "Try again" is under way. */
  let trying = $state(false);
  /** How many of the reader's tries the list's own notice has answered with "still not read". */
  let tries = $state(0);
  /** The reader's try ended with the coins unread: the line that stands under the frame's notice is its answer. */
  let answered = $state(false);

  /** True once this list has left the screen. */
  let gone = false;
  onDestroy(() => {
    gone = true;
  });

  async function tryAgain(): Promise<void> {
    if (trying) return;
    trying = true;
    // Resolves when the wallet's coins have been read again and, if that worked, the list after them.
    await wallet.refresh();
    if (gone) return;
    trying = false;
    if (wallet.chain.error !== null) {
      // The coins could not be read, so the list was not tried at all. The
      // frame shows the cause now, and this list's own notice has made way
      // for it. Once that is drawn, the line that stands here instead is
      // read out: it is the answer to the reader's try.
      await tick();
      if (!gone) answered = true;
      return;
    }
    // Still not read: the cause is drawn afresh, so that it is read out again.
    if (wallet.historyError !== null) tries += 1;
  }

  // An answer belongs to the notice it was given under. Whenever another
  // takes that notice's place (the frame's failure comes or goes with a
  // poll, a read works), both are put back, so that the next notice starts
  // out silent: it comes by itself, and answers nothing the reader did.
  $effect(() => {
    void notice;
    untrack(() => {
      tries = 0;
      answered = false;
    });
  });

  // The list's own notice goes when a read works, or when the frame takes
  // over, and the button in it goes with it: after the reader's own "Try
  // again", or by itself when the wallet's next try ends. If that button
  // had the keyboard's focus, the focus would be left on nothing. So,
  // before the list is redrawn, note whether the focus is inside the
  // notice; after it, if the focus has fallen back to the page itself,
  // move it to the screen's heading.
  let root = $state<HTMLElement>();
  let held = false;
  $effect.pre(() => {
    void shows;
    void notice;
    const own = root?.querySelector('[data-testid="activity-failed"]');
    held = own != null && own.contains(document.activeElement);
  });
  $effect(() => {
    void shows;
    void notice;
    if (!held) return;
    held = false;
    void tick().then(() => {
      if (document.activeElement === null || document.activeElement === document.body) focusHeading();
    });
  });
</script>

<div bind:this={root} class="space-y-4">
  {#if notice === 'list' && shows.failure !== null}
    <div class="space-y-3" data-testid="activity-failed">
      <!-- Announced only when it answers the reader's own "Try again". -->
      {#key tries}
        <Notice kind="problem" silent={tries === 0} text={chainFailureText(shows.failure, lang)} />
      {/key}
      <div class="space-y-1 text-sm text-ink-500">
        <!-- A reader who was refused for asking too fast is not invited to ask again at once. -->
        <p>{shows.failure === 'limit' ? t.activityRetriesAlone : t.activityRetries}</p>
        {#if shows.list !== 'unread'}<p>{t.activityStale}</p>{/if}
      </div>
      <Actions tight>
        <Button
          variant="quiet"
          data-testid="activity-retry"
          busy={trying}
          busyText={t.activityReading}
          onclick={() => void tryAgain()}
        >
          {c.tryAgain}
        </Button>
      </Actions>
    </div>
  {:else if notice === 'frame'}
    <!-- The wallet frame says why the practice network cannot be read, and
         its "Try again" reads this list too. What is left to say here is
         what the reader is looking at. It is read out only as the answer
         to the reader's own "Try again" on this list. -->
    {#key answered}
      <p class="text-pretty text-sm text-ink-500" role={answered ? 'alert' : undefined} data-testid="activity-stale">
        {shows.list === 'unread' ? t.activityUnread : t.activityStale}
      </p>
    {/key}
  {/if}

  {#if shows.list === 'loading'}
    <Waiting inline text={t.activityLoading} data-testid="activity-loading" />
  {:else if shows.list === 'empty'}
    {#if faucet}
      <!-- The same look as the Coins screen's empty line: the two screens are siblings. -->
      <Empty text={t.activityEmpty} data-testid="activity-empty">
        <Button variant="primary" small href={faucetLink(router.link({ name: 'receive' }))} data-testid="activity-faucet">
          {t.getCoins}
        </Button>
      </Empty>
    {:else}
      <p class="text-pretty text-sm text-ink-500" data-testid="activity-empty">{t.activityEmpty}</p>
    {/if}
  {:else if shows.list === 'rows'}
    <TxList {txs} />
  {/if}
</div>
