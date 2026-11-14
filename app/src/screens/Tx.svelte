<script lang="ts">
  // The screen of one transaction: /wallet/tx/<its ID>.
  //
  // It asks the wallet for the transaction (wallet.lookupTx) when it opens,
  // when the address moves on to another transaction, and again whenever
  // the wallet's coins or its list of transactions change, and at every
  // new block: that is when an unconfirmed transaction may have reached a
  // block. The block counts by itself because not every transaction shown
  // here is in the wallet's coins or its list: another wallet's is in
  // neither, and it confirms all the same. Each answer has its own view
  // (read/read.ts, afterLookup):
  //
  //   found      which way the coins went and how much, in words; whether
  //              it is in a block; what went in and what came out; the fee,
  //              the size and the fee rate; whether it can still be
  //              replaced; its ID, with a copy button; and a link to the
  //              same transaction on the practice explorer
  //   waiting    the faucet or a payment of this page returned the ID a
  //              moment ago and the network does not list it yet: the
  //              screen says so and asks again every few seconds, for two
  //              minutes at most
  //   not found  the cause, "Try again" and the way back to the activity.
  //              After a wait that ran out the cause is another one, and
  //              it is read out, because it comes by itself
  //   failed     the cause and "Try again"
  //
  // A transaction that is on screen stays there when a later look at it
  // fails: nothing about it has changed, and the wallet frame says when
  // the practice network cannot be reached (SPEC section 3: the last
  // values stay).
  //
  // Looking needs no key, so nothing here asks for a passkey. An address
  // that holds no transaction ID never gets here: the router shows "Page
  // not found" for it.

  import { onDestroy, tick, untrack } from 'svelte';
  import Actions from '../components/Actions.svelte';
  import Button from '../components/Button.svelte';
  import CopyButton from '../components/CopyButton.svelte';
  import Mono from '../components/Mono.svelte';
  import Notice from '../components/Notice.svelte';
  import OutLink from '../components/OutLink.svelte';
  import Row from '../components/Row.svelte';
  import Rows from '../components/Rows.svelte';
  import Section from '../components/Section.svelte';
  import { TAP } from '../components/styles.ts';
  import TextLink from '../components/TextLink.svelte';
  import Waiting from '../components/Waiting.svelte';
  import { satsText } from '../components/wallet/frame.ts';
  import TxFeeRows from '../components/wallet/TxFeeRows.svelte';
  import TxParts from '../components/wallet/TxParts.svelte';
  import WalletFrame from '../components/wallet/WalletFrame.svelte';
  import { fill, formatDate, formatSats } from '../lib/format.ts';
  import { focusHeading, router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import {
    WAIT_LIMIT_MS,
    afterLookup,
    amountSentence,
    explorerTxUrl,
    glossaryUrl,
    keepShown,
    txReplaceable,
    txStatus,
    txSummary,
    type TxShows,
  } from './read/read.ts';

  const wallet = useWallet();

  let lang = $derived(router.lang);
  let t = $derived(strings.wallet[lang]);
  let c = $derived(strings.common[lang]);

  // The transaction's ID is part of the address: /wallet/tx/<64 hex characters>.
  let txid = $derived(router.route.name === 'tx' ? router.route.txid : '');

  // -- asking ---------------------------------------------------------------------

  let shows = $state.raw<TxShows>({ kind: 'asking' });

  /** The ID the screen is showing, or asking for. */
  let showing = '';
  /** When the wallet first said "waiting" for this transaction, in ms since 1970. */
  let waitingSince: number | null = null;
  /** A wait for this transaction has run out on this screen: "not found" goes on saying so. */
  let waitedOut = false;
  /** The number of the latest look. An answer to an older one is dropped. */
  let round = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** True once this screen has left the page. */
  let gone = false;

  /** The reader's own "Try again" is under way. */
  let trying = $state(false);
  /** How many of the reader's tries ended without the transaction. */
  let tries = $state(0);

  /** Asks the wallet, shows what it answers, and sets the next look if one is due. Null: the answer came too late to count. */
  async function ask(id: string): Promise<TxShows | null> {
    round += 1;
    const mine = round;
    clearTimeout(timer);
    const answer = await wallet.lookupTx(id);
    if (gone || mine !== round) return null;
    const step = afterLookup(answer, waitingSince, Date.now(), waitedOut);
    waitingSince = step.waitingSince;
    waitedOut = step.waitedOut;
    if (step.askAgainIn !== null) timer = setTimeout(() => void ask(id), step.askAgainIn);
    // A later look that fails takes nothing off the screen: the transaction that is shown stays.
    shows = keepShown(shows, step.shows, id);
    return shows;
  }

  // What a new look depends on. Each is a value of its own, so that the
  // effect below runs when the coins, the list or the height of the chain
  // really change, and not every time the wallet says it has checked and
  // found nothing new.
  let coins = $derived(wallet.chain.state);
  let listed = $derived(wallet.history);
  let tip = $derived(wallet.chain.tip);

  // The wallet is outside Svelte's drawing of the page, so an effect asks
  // it. What the effect itself reads is the ID, the coins, the list and
  // the height; the asking is done out of its sight (untrack), or
  // everything the wallet reads on the way would count as something to
  // ask again for. A look at a transaction the wallet's list holds costs
  // no request, so the one more look at each block is free for those.
  $effect(() => {
    const id = txid;
    const known = coins !== null;
    void listed;
    void tip;
    untrack(() => {
      if (id === '') return;
      if (id !== showing || !known) {
        // Another transaction, or the wallet's coins are being looked up
        // from nothing: what was shown so far says nothing about this.
        showing = id;
        waitingSince = null;
        waitedOut = false;
        tries = 0;
        shows = { kind: 'asking' };
      }
      void ask(id);
    });
  });

  onDestroy(() => {
    gone = true;
    clearTimeout(timer);
  });

  // -- trying again ---------------------------------------------------------------

  async function tryAgain(): Promise<void> {
    if (trying || txid === '') return;
    trying = true;
    // The reader asked: the two minutes of waiting start again.
    waitingSince = null;
    const now = await ask(txid);
    trying = false;
    // No better: the cause is drawn afresh, so that it is read out again.
    if (now !== null && (now.kind === 'not-found' || now.kind === 'failed')) tries += 1;
  }

  // A notice goes when the transaction turns up, and its buttons go with
  // it: after the reader's own "Try again", or by itself when a block
  // brings the transaction. If one of those buttons had the keyboard's
  // focus, the focus would be left on nothing. So, before the screen is
  // redrawn, note whether the focus is inside a notice; after it, if the
  // focus has fallen back to the page itself, move it to the heading.
  let held = false;
  $effect.pre(() => {
    void shows;
    held = document.activeElement?.closest('[data-testid="tx-not-found"], [data-testid="tx-failed"]') != null;
  });
  $effect(() => {
    void shows;
    if (!held) return;
    held = false;
    void tick().then(() => {
      if (document.activeElement === null || document.activeElement === document.body) focusHeading();
    });
  });

  // -- what a found transaction says ------------------------------------------------

  let view = $derived(shows.kind === 'found' ? shows.view : null);

  // The sentence that says which way the coins went, cut at its amount:
  // the unit is drawn in one piece, so that "practice sats" never breaks
  // in two at the end of a line.
  let summary = $derived.by(() => {
    if (view === null) return amountSentence('', '');
    const sum = txSummary(view);
    const amount = satsText(sum.sats, lang);
    switch (sum.kind) {
      case 'received':
        return amountSentence(t.txSumReceived, amount);
      case 'sent':
        return amountSentence(t.txSumSent, amount);
      case 'internal':
        return amountSentence(t.txSumInternal, amount);
      case 'other':
        return amountSentence(t.txSumOther, '');
    }
  });

  let status = $derived.by(() => {
    if (view === null) return '';
    const at = txStatus(view);
    switch (at.kind) {
      case 'unconfirmed':
        return fill(t.txStatusUnconfirmed, { seconds: String(wallet.config.blockSeconds) });
      case 'block-date':
        return fill(t.txStatusBlockDate, { height: formatSats(at.height), date: formatDate(at.time, lang) });
      case 'block':
        return fill(t.txStatusBlock, { height: formatSats(at.height) });
      case 'confirmed':
        return t.txStatusConfirmed;
    }
  });

  let replaceable = $derived(view === null ? 'no' : txReplaceable(view));

  // A small link that stands on a line by itself: a box of its own, with a
  // tap area 44 px tall (TAP in components/styles.ts says why, and that
  // such lines must be 44 px apart).
  const ALONE = `inline-block ${TAP}`;
</script>

<!-- The ID, for the views that have no transaction to show: the reader can compare it with what they copied. -->
{#snippet asked()}
  <Rows>
    <Row name={t.txId}><Mono value={txid} data-testid="tx-id" /></Row>
  </Rows>
{/snippet}

<WalletFrame title={c.screen_tx}>
  {#snippet children(known)}
    <!-- Until the wallet's coins are known, the frame says what is going
         on. Whose the inputs and outputs are cannot be said before that. -->
    {#if known}
      {#if shows.kind === 'asking'}
        <Waiting text={t.txLooking} data-testid="tx-looking" />
      {:else if shows.kind === 'waiting'}
        <div data-testid="tx-waiting">
          <Waiting text={t.txWaiting} />
          <p class="text-pretty text-center text-sm text-ink-500">{t.txWaitingNote}</p>
        </div>
        {@render asked()}
      {:else if shows.kind === 'not-found'}
        <div class="space-y-3" data-testid="tx-not-found">
          <!-- Announced when it answers the reader's own "Try again", and
               when it ends a wait: then it comes by itself, in place of
               the line that said the screen was waiting. Not when it is
               there as the screen opens. -->
          {#key tries}
            <Notice
              kind="problem"
              silent={tries === 0 && !shows.waited}
              text={shows.waited ? fill(t.txNotFoundWaited, { minutes: String(WAIT_LIMIT_MS / 60_000) }) : t.txNotFound}
            />
          {/key}
          <!-- One group: on a phone the two stand one under the other, at one width. -->
          <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              variant="quiet"
              class="w-full sm:w-auto"
              data-testid="tx-retry"
              busy={trying}
              busyText={t.txLooking}
              onclick={() => void tryAgain()}
            >
              {c.tryAgain}
            </Button>
            <Button variant="quiet" class="w-full sm:w-auto" href={router.link({ name: 'activity' })} data-testid="tx-back">
              {t.overviewAllActivity}
            </Button>
          </div>
        </div>
        {@render asked()}
      {:else if shows.kind === 'failed'}
        <div class="space-y-3" data-testid="tx-failed">
          {#key tries}
            <Notice kind="problem" silent={tries === 0} text={strings.errors[lang][shows.reason]} />
          {/key}
          <Actions tight>
            <Button variant="quiet" data-testid="tx-retry" busy={trying} busyText={t.txLooking} onclick={() => void tryAgain()}>
              {c.tryAgain}
            </Button>
          </Actions>
        </div>
        {@render asked()}
      {:else}
        <div class="space-y-3">
          <p class="text-pretty text-xl leading-snug text-ink-800" data-testid="tx-summary">
            {summary.before}{#if summary.unit !== ''}{summary.number}{' '}<span class="whitespace-nowrap">{summary.unit}</span
              >{/if}{summary.after}
          </p>
          {#if shows.view.direction === 'other'}
            <p class="text-pretty leading-relaxed text-ink-600">{t.txSumOtherNote}</p>
          {/if}
          <p class="text-pretty leading-relaxed text-ink-600" data-testid="tx-status">{status}</p>
        </div>

        <Section title={t.txPartsTitle}>
          <TxParts view={shows.view} />
        </Section>

        <Section title={c.details}>
          <Rows>
            <TxFeeRows view={shows.view} />
            <Row name={t.txId}>
              <Mono value={shows.view.txid} data-testid="tx-id" />
              <!-- The button stands under the ID it copies, at the ID's own edge. -->
              <div class="mt-2 flex flex-wrap items-center gap-2 sm:justify-end">
                <CopyButton text={shows.view.txid} said={t.txIdCopied} data-testid="tx-copy" />
              </div>
            </Row>
            <Row name={t.txReplace} data-testid="tx-replace">
              {replaceable === 'no' ? t.txReplaceNo : t.txReplaceYes}
            </Row>
          </Rows>
          {#if replaceable !== 'no'}
            <p class="text-pretty text-sm leading-relaxed text-ink-600" data-testid="tx-replace-note">
              {replaceable === 'signals' ? t.txReplaceSignals : t.txReplaceSilent}
            </p>
          {/if}
          <!-- The links that leave the app, each on a line of its own, at
               one size. At this size each is one line at 320 px in both
               languages: a link that wraps can leave its arrow alone at
               the start of the next line, when its words end just short of
               the edge. The lines are 44 px apart, so that a thumb takes
               the one it means. -->
          <div class="space-y-6 text-sm">
            {#if replaceable !== 'no'}
              <p>
                <OutLink class={ALONE} href={glossaryUrl(wallet.config.siteUrl, lang, 'rbf')} data-testid="tx-replace-glossary">
                  {t.txReplaceGlossary}
                </OutLink>
              </p>
            {/if}
            <p>
              <OutLink class={ALONE} href={explorerTxUrl(wallet.config.explorerUrl, shows.view.txid)} data-testid="tx-explorer">
                {t.txExplorer}
              </OutLink>
            </p>
          </div>
        </Section>

        <!-- The way back, at the size of the two links above it. -->
        <p class="text-sm">
          <TextLink class={ALONE} href={router.link({ name: 'activity' })} data-testid="tx-back">{t.overviewAllActivity}</TextLink>
        </p>
      {/if}
    {/if}
  {/snippet}
</WalletFrame>
