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
  //                 this screen while the passkey prompt was open. A wallet
  //                 that arrived from another tab during that prompt is
  //                 shown as being here, and the screen says how it came.
  //                 A reader who has just removed their wallet (Settings
  //                 leads here) is told so above all that, for this one
  //                 visit: the screen would otherwise read as a first visit.
  //                 One reader with no wallet is not here to make one: the
  //                 reader in the middle of the drill of "Prove the backup",
  //                 whose wallet was removed for it and has to come back
  //                 from the 12 words. For as long as the note of the "Do
  //                 it" steps follows that step and it waits for its wallet
  //                 (awaitsRestore in doit/view.ts), "Restore from the 12
  //                 words" stands first under the heading as the main
  //                 button, with one sentence under it that names the step,
  //                 and "Create a practice wallet" is drawn as a second
  //                 button.
  //                 That goes by the note's followed step, not by the
  //                 strip's 24 hours: days after the removal the note is
  //                 still all that says which wallet has to come back.
  //                 For that reader the two sentences under the heading
  //                 are left out: they know what this is, and the restore
  //                 has to be in the first window of a short phone, where
  //                 the longer Spanish sentences would push it under the
  //                 edge. The gate of a wallet screen puts the restore
  //                 first for the same reader (NoWallet.svelte)
  //   unreadable, newer, broken
  //                 the shared StoredTrouble piece, as the gate of a wallet
  //                 screen shows it
  //   blocked       the browser did not let this page read its storage: the
  //                 same piece, which says that the page cannot tell whether
  //                 a wallet is here. Never the ways in for "no wallet":
  //                 "This browser has none right now" would be a guess, and
  //                 a wallet made before may still be stored
  //
  // Under that, on every visit: what can be done here, and the two facts of
  // the practice network a newcomer wants first (how often a block comes,
  // what the faucet gives), both read from the settings. Then a short
  // section on the "Do it" steps, which leads to their list.
  //
  // Removing a wallet leaves the note of the "Do it" steps in this browser.
  // So the line that says the wallet was removed is followed, while there
  // is such a note, by one that says it stays, what it can name, and where
  // it is erased.

  import { onDestroy, onMount, tick } from 'svelte';
  import Button from '../components/Button.svelte';
  import Card from '../components/Card.svelte';
  import { stepTitle } from '../components/doit/strip.ts';
  import Notice from '../components/Notice.svelte';
  import { takeOutcome } from '../components/outcome.ts';
  import Page from '../components/Page.svelte';
  import Prose from '../components/Prose.svelte';
  import Section from '../components/Section.svelte';
  import { announce } from '../components/status.svelte.ts';
  import { TAP } from '../components/styles.ts';
  import TextLink from '../components/TextLink.svelte';
  import { SAFARI_KEEPS_DAYS } from '../components/wallet/frame.ts';
  import OpenWithPasskey from '../components/wallet/OpenWithPasskey.svelte';
  import StoredTrouble from '../components/wallet/StoredTrouble.svelte';
  import { useDoit } from '../lib/doit/doit-context.ts';
  import { fill, formatSats } from '../lib/format.ts';
  import { navigate, router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import { awaitsRestore, progressKept } from './doit/view.ts';
  import WalletHere from './front/WalletHere.svelte';

  const wallet = useWallet();
  const doit = useDoit();
  /** For the id that ties the sentence under the restore to its button. */
  const uid = $props.id();

  let t = $derived(strings.home[router.lang]);
  let d = $derived(strings.doit[router.lang]);
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
   * The width of the two buttons that bring a wallet back. They stay one
   * under the other on every screen: the whole width on a phone, and one
   * fixed width from there, wide enough for the longer Spanish label on
   * one line.
   */
  const PAIRED = 'w-full sm:w-96';

  /**
   * The step the note of the "Do it" steps follows, when its open part waits for a removed wallet to come back
   * from the 12 words: the drill of "Prove the backup", between its removal and its restore. Otherwise null.
   * It is the note's followed step, with no limit of time (not the step the strip shows, which stops after 24
   * hours): for as long as the note follows the drill, the note is all that says which wallet has to come back.
   * Worked out again whenever the note or the wallet changes; no clock is kept for it.
   */
  let restoring = $derived.by(() => {
    const step = doit.progress.following;
    return step !== null && awaitsRestore(doit.view(step, Date.now())) ? step : null;
  });

  /** A wallet arrived from another tab while "Open with my passkey" was waiting for the prompt. */
  let arrived = $state(false);

  /** The reader removed their wallet on the screen before this one: said here, for this visit. */
  const removed = takeOutcome('removed');
  onMount(() => {
    // Read out as well. A moment after the screen is drawn, and not as it is: the status region is
    // emptied when the screen changes, and that happens after this screen has been put on the page.
    if (removed) void tick().then(() => announce(t.removed));
  });

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

<!-- The lede says what the practice wallet is. A reader in the middle of the drill has no need of it, and for
     them it is left out, so that the restore stands straight under the heading. -->
<Page title={c.appName} documentTitle={c.homeTitle} lede={restoring === null ? t.lede : undefined}>
  {#if status === 'ready'}
    <WalletHere {arrived} />
  {:else if status === 'none'}
    {#if restoring !== null}
      <!-- In the middle of the drill: the wallet was removed for the step, and the step goes on with a restore.
           First under the heading, where a reader who has just removed the wallet is looking: the restore as the
           main button, in Home's own words for it, and under it the sentence that says which step it is for.
           The button names that sentence as its description. -->
      <div class="space-y-3" data-testid="home-step">
        <div>
          <Button
            variant="primary"
            class="w-full sm:w-auto"
            data-testid="home-step-restore"
            aria-describedby="{uid}-step"
            href={router.link({ name: 'restore' })}
          >
            {w.gateRestore}
          </Button>
        </div>
        <p id="{uid}-step" class="text-pretty text-base leading-relaxed text-ink-700">{fill(d.homeRestore, { step: stepTitle(restoring, router.lang) })}</p>
      </div>
    {/if}
    {#if removed && progressKept(doit.read)}
      <!-- The wallet is gone, and the note of the "Do it" steps is not: what it can name, and where it
           is erased. The two lines belong together, and stand closer than the screen's other parts. -->
      <div class="space-y-3">
        <Notice kind="info" text={t.removed} data-testid="home-removed" />
        <Notice kind="info" text={d.staysAfterRemove} data-testid="home-progress-stays">
          <TextLink href={router.link({ name: 'do' })}>{d.name}</TextLink>
        </Notice>
      </div>
    {:else if removed}
      <Notice kind="info" text={t.removed} data-testid="home-removed" />
    {/if}
    <!-- The main button, except in the middle of the drill: there the restore above is, and this is a second one. -->
    <div>
      <Button variant={restoring === null ? 'primary' : 'secondary'} class="w-full sm:w-auto" data-testid="home-create" href={router.link({ name: 'new' })}>
        {w.gateCreate}
      </Button>
    </div>
    <Card tone="grey" title={w.gateAlreadyHave} data-testid="home-have">
      <!-- The two ways in are one group, one under the other: both buttons get one width. -->
      <div class="space-y-4">
        <p class="text-pretty text-sm leading-relaxed text-ink-600">{why}</p>
        <!-- "exists": the wallet is here already, so this panel is gone the moment the answer
             comes, and the piece's own sentence with it. What takes its place says it. -->
        <OpenWithPasskey
          variant="secondary"
          buttonClass={PAIRED}
          onopened={opened}
          onanswer={(answer) => {
            if (answer.kind === 'exists') arrived = true;
          }}
        />
        <div>
          <Button class={PAIRED} data-testid="home-restore" href={router.link({ name: 'restore' })}>
            {w.gateRestore}
          </Button>
        </div>
      </div>
    </Card>
  {:else if status === 'unreadable' || status === 'newer' || status === 'broken' || status === 'blocked'}
    <StoredTrouble titled />
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

  <!-- The steps that go with the main site's chapters: one sentence, and the way to their list. -->
  <Section title={d.name}>
    <Prose>
      <p data-testid="home-do">{d.homeBody}</p>
    </Prose>
    <ul>
      <li class="flex min-h-11 items-center">
        <TextLink class={LONE_LINK} href={router.link({ name: 'do' })} data-testid="home-do-link">{d.homeLink}</TextLink>
      </li>
    </ul>
  </Section>
</Page>
