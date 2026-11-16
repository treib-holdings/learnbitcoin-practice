<script lang="ts">
  // The Overview: what this wallet holds, and the ways on from here.
  //
  //   - the total, with the part that is still unconfirmed named;
  //   - Receive and Send, the two things a reader comes for;
  //   - the first few coins and the latest few transactions, each with a
  //     link to all of them;
  //   - what tells this browser's wallet from another: the tag in its
  //     passkey's name (passkey wallets) and its wallet fingerprint.
  //
  // Looking needs no key, so nothing here asks for a passkey.
  //
  // Until the first look at the practice network has finished there is no
  // total and no list: the wallet frame says what is going on, and this
  // screen never shows a total of 0 in the meantime. With no coins the
  // screen says so and points to the faucet. A wallet just opened with a
  // passkey that turned out to have no history gets the likely causes
  // instead of the bare empty line (read/OpenedEmpty.svelte).
  //
  // From that list the reader can choose another passkey. Two answers to
  // that can arrive after the list itself has left the screen, and both
  // are warnings: the stored passkey gave a wallet that fits nothing saved
  // here, and the wallet was replaced in another tab. This screen stays, so
  // it holds them and draws them at its top (read/ChooseAnswer.svelte).
  //
  // One line near the foot points to the "Do it" steps, which are done in
  // this wallet.
  //
  // A restore ends here. For that one visit the screen says that the wallet
  // was restored and that its 12 words are now kept in this browser
  // (components/outcome.ts): the Overview would otherwise simply appear.

  import { onMount, tick } from 'svelte';
  import Button from '../components/Button.svelte';
  import Mono from '../components/Mono.svelte';
  import Notice from '../components/Notice.svelte';
  import { takeOutcome } from '../components/outcome.ts';
  import Section from '../components/Section.svelte';
  import { announce } from '../components/status.svelte.ts';
  import { EYEBROW } from '../components/styles.ts';
  import TextLink from '../components/TextLink.svelte';
  import CoinList from '../components/wallet/CoinList.svelte';
  import NoCoins from '../components/wallet/NoCoins.svelte';
  import Total from '../components/wallet/Total.svelte';
  import WalletFrame from '../components/wallet/WalletFrame.svelte';
  import { router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import ActivityList from './read/ActivityList.svelte';
  import ChooseAnswer from './read/ChooseAnswer.svelte';
  import OpenedEmpty from './read/OpenedEmpty.svelte';
  import { OVERVIEW_COINS, OVERVIEW_TXS, firstFew, overviewBody, type ChooseLate } from './read/read.ts';

  const wallet = useWallet();

  let t = $derived(strings.wallet[router.lang]);
  let c = $derived(strings.common[router.lang]);
  let d = $derived(strings.doit[router.lang]);

  let coins = $derived(wallet.chain.state?.coins ?? []);
  let body = $derived(overviewBody({ coins: coins.length, openedEmpty: wallet.openedEmpty }));

  /** The four characters this browser knows of its passkey's name. A wallet made without a passkey has none. */
  let tag = $derived(wallet.record?.kind === 'passkey' ? (wallet.record.tag ?? null) : null);
  let fingerprint = $derived(wallet.record?.fingerprint ?? '');

  // The frame's line at the top names the passkey only while the wallet is
  // locked. While it is unlocked, the label at the foot is the first thing
  // on the screen to name one (in Spanish the first mention is glossed).
  let tagLabel = $derived(wallet.unlocked ? t.walletPasskeyHasFirst : t.walletPasskeyHas);

  /** What "Choose another passkey" came to after the list of causes had left the screen. */
  let late = $state.raw<ChooseLate | null>(null);

  /** The reader restored this wallet on the screen before this one: said here, for this visit. */
  const restored = takeOutcome('restored');
  onMount(() => {
    // Read out as well, once the status region has been emptied for the new screen.
    if (restored) void tick().then(() => announce(t.restoredHere));
  });
</script>

<WalletFrame title={c.section_wallet}>
  {#snippet children(known)}
    <!-- Above everything else, and whether or not the coins are known:
         it is a warning about the wallet that is shown below it. -->
    {#if late !== null}
      <ChooseAnswer outcome={late} />
    {/if}

    {#if restored}
      <Notice kind="info" text={t.restoredHere} data-testid="overview-restored" />
    {/if}

    {#if known}
      <Total />

      {#if body === 'causes'}
        <OpenedEmpty onlate={(outcome) => (late = outcome)} />
      {:else}
        {#if body === 'coins'}
          <!-- Two buttons of one width, side by side on a phone as well. -->
          <div class="grid max-w-sm grid-cols-2 gap-3">
            <Button href={router.link({ name: 'receive' })} data-testid="overview-receive">{c.section_receive}</Button>
            <Button variant="primary" href={router.link({ name: 'send' })} data-testid="overview-send">
              {c.section_send}
            </Button>
          </div>

          <Section title={c.section_coins}>
            <CoinList coins={firstFew(coins, OVERVIEW_COINS)} />
            <p><TextLink href={router.link({ name: 'coins' })} data-testid="all-coins">{t.overviewAllCoins}</TextLink></p>
          </Section>
        {:else}
          <NoCoins data-testid="no-coins" />
        {/if}

        <Section title={t.overviewActivity}>
          <ActivityList limit={OVERVIEW_TXS} />
          <p>
            <TextLink href={router.link({ name: 'activity' })} data-testid="all-activity">{t.overviewAllActivity}</TextLink>
          </p>
        </Section>
      {/if}
    {/if}

    <!-- The steps that go with the main site's chapters are done in this wallet: one line, and the way to them. -->
    <p class="text-pretty text-sm leading-relaxed text-ink-600" data-testid="overview-do">
      {d.overviewLine}
      <TextLink href={router.link({ name: 'do' })} data-testid="overview-do-link">{d.overviewLink}</TextLink>
    </p>

    <!-- Which wallet this browser holds. In the list of causes above, the
         same two facts stand where they are spoken of, so they are not
         repeated here. -->
    {#if !(known && body === 'causes')}
      <div class="border-t border-ink-100 pt-6">
        <p class={EYEBROW}>{t.overviewWallet}</p>
        <dl class="mt-2 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {#if tag !== null}
            <div class="flex flex-wrap items-baseline gap-x-2">
              <dt class="font-semibold text-ink-500">{tagLabel}</dt>
              <dd><Mono value={tag} data-testid="passkey-tag" /></dd>
            </div>
          {/if}
          <div class="flex flex-wrap items-baseline gap-x-2">
            <dt class="font-semibold text-ink-500">{t.walletFingerprint}</dt>
            <dd><Mono value={fingerprint} data-testid="wallet-fingerprint" /></dd>
          </div>
        </dl>
        <p class="mt-2 text-pretty text-sm text-ink-500">{t.walletFingerprintIs}</p>
      </div>
    {/if}
  {/snippet}
</WalletFrame>
