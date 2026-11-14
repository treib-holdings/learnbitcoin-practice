<script lang="ts">
  // Home: what this is, and the way in.
  //
  // It is the one page a search engine may list, so it says at the top, in
  // two sentences, what the practice wallet is. What comes next depends on
  // what this browser holds:
  //
  //   a wallet      the way into it comes first, with one line that says
  //                 which wallet it is
  //   no wallet     "Create a practice wallet" is the main button. Under it,
  //                 for a reader who has one already: why it may not be here,
  //                 then the two ways to bring it back, open with my passkey
  //                 and restore from the 12 words. A wallet opened with a
  //                 passkey is shown at once, unless the reader has left
  //                 this screen while the passkey prompt was open
  //   unreadable, newer, broken
  //                 the shared StoredTrouble piece, as the gate of a wallet
  //                 screen shows it
  //
  // Under that, on every visit: what can be done here, and the two facts of
  // the practice network a newcomer wants first (how often a block comes,
  // what the faucet gives), both read from the settings.

  import { onDestroy } from 'svelte';
  import Button from '../components/Button.svelte';
  import Card from '../components/Card.svelte';
  import Page from '../components/Page.svelte';
  import Prose from '../components/Prose.svelte';
  import Section from '../components/Section.svelte';
  import { TAP } from '../components/styles.ts';
  import TextLink from '../components/TextLink.svelte';
  import { SAFARI_KEEPS_DAYS } from '../components/wallet/frame.ts';
  import OpenWithPasskey from '../components/wallet/OpenWithPasskey.svelte';
  import StoredTrouble from '../components/wallet/StoredTrouble.svelte';
  import { fill, formatSats } from '../lib/format.ts';
  import { navigate, router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import WalletHere from './front/WalletHere.svelte';

  const wallet = useWallet();

  let t = $derived(strings.home[router.lang]);
  let c = $derived(strings.common[router.lang]);
  let w = $derived(strings.wallet[router.lang]);

  let status = $derived(wallet.status);
  let why = $derived(fill(t.haveWhy, { days: String(SAFARI_KEEPS_DAYS) }));
  let facts = $derived(
    fill(t.facts, { seconds: String(wallet.config.blockSeconds), sats: formatSats(wallet.config.faucetSats) }),
  );

  /** A link that stands by itself, with a tap area 44 px tall (styles.ts). */
  const LONE_LINK = `inline-block ${TAP}`;

  /**
   * For a shared piece that stacks its buttons on a phone and gives them no
   * width of their own: there each button takes the whole width, so a short
   * one is not a stub beside a long one. (The pieces take a class for their
   * outermost element only, so the buttons are reached from there.)
   */
  const GROUPED = '[&_button]:w-full sm:[&_button]:w-auto';
  /**
   * The same for two buttons that stay one under the other on every screen:
   * the whole width on a phone, and one fixed width from there, wide enough
   * for the longer Spanish label on one line.
   */
  const PAIRED = '[&_button]:w-full sm:[&_button]:w-96';

  /** True once the screen has left the page. */
  let gone = false;
  onDestroy(() => {
    gone = true;
  });

  /**
   * A wallet opened with a passkey is in this browser now, unlocked: show
   * it. A reader who went to another screen while the passkey prompt was
   * open is left where they are, as Create leaves them: the wallet is here,
   * and the page does not change under them.
   */
  function opened(): void {
    if (!gone) navigate(router.link({ name: 'wallet' }));
  }
</script>

<Page title={c.appName} documentTitle={c.homeTitle} lede={t.lede}>
  {#if status === 'ready'}
    <WalletHere />
  {:else if status === 'none'}
    <div>
      <Button variant="primary" class="w-full sm:w-auto" data-testid="home-create" href={router.link({ name: 'new' })}>
        {w.gateCreate}
      </Button>
    </div>
    <Card tone="grey" title={w.gateAlreadyHave} data-testid="home-have">
      <!-- The two ways in are one group, one under the other: both buttons get one width. -->
      <div class={['space-y-4', PAIRED]}>
        <p class="text-pretty text-sm leading-relaxed text-ink-600">{why}</p>
        <OpenWithPasskey variant="secondary" onopened={opened} />
        <div>
          <Button class="w-full sm:w-96" data-testid="home-restore" href={router.link({ name: 'restore' })}>
            {w.gateRestore}
          </Button>
        </div>
      </div>
    </Card>
  {:else if status === 'unreadable' || status === 'newer' || status === 'broken'}
    <StoredTrouble titled class={GROUPED} />
  {/if}

  <Section title={t.canTitle}>
    <Prose>
      <ul>
        <li>{t.canCoins}</li>
        <li>{t.canSend}</li>
        <li>{t.canLook}</li>
        <li>{t.canWords}</li>
        <li>{t.canDesktop}</li>
      </ul>
      <p data-testid="home-facts">{facts}</p>
    </Prose>
    <!-- Two links that stand by themselves: each line is 44 px tall, and so is the area that takes a tap. -->
    <ul>
      <li class="flex min-h-11 items-center">
        <TextLink class={LONE_LINK} href={router.link({ name: 'about' })}>{t.linkAbout}</TextLink>
      </li>
      <li class="flex min-h-11 items-center">
        <TextLink class={LONE_LINK} href={router.link({ name: 'sparrow' })}>{c.linkSparrow}</TextLink>
      </li>
    </ul>
  </Section>
</Page>
