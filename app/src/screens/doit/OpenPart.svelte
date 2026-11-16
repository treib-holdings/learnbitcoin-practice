<script lang="ts">
  // The part of a step that is open: the first one that is not ticked.
  //
  // What it shows depends on where judge() says the part stands:
  //
  //   now      what to do, in one or two sentences, and the part's one
  //            action: a link into the wallet, a question, or the box the
  //            reader ticks. A part that waits for a block has no action:
  //            it shows the waiting display, and ticks by itself.
  //   blocked  what is missing, and the step or the screen that meets it.
  //            For the wallet's own trouble (a stored wallet that cannot be
  //            used, a wallet that cannot run in this browser, a storage
  //            this page was not let read), the wallet's own piece
  //            (StoredTrouble), as on Home.
  //   unknown  the part's facts are not known yet: the lines about the
  //            practice network, and no action. It never says "no coins"
  //            while nobody knows.
  //
  // The link into the wallet tells the steps that it was used: the step is
  // then the one being followed, and what the reader does on the wallet's
  // screen counts for it.

  import Button from '../../components/Button.svelte';
  import Checkbox from '../../components/Checkbox.svelte';
  import Notice from '../../components/Notice.svelte';
  import OutLink from '../../components/OutLink.svelte';
  import TextLink from '../../components/TextLink.svelte';
  import { faucetLink } from '../../components/wallet/frame.ts';
  import StoredTrouble from '../../components/wallet/StoredTrouble.svelte';
  import { useDoit } from '../../lib/doit/doit-context.ts';
  import { SIX_BLOCKS, isWalletTrouble, type PartView } from '../../lib/doit/judge.ts';
  import { partDef, stepDef, type StepId } from '../../lib/doit/steps.ts';
  import { fill, formatSats } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import { explorerTxUrl } from '../read/read.ts';
  import AskNumber from './AskNumber.svelte';
  import AskWords from './AskWords.svelte';
  import ChainLines from './ChainLines.svelte';
  import GlossaryLinks from './GlossaryLinks.svelte';
  import Sentence from './Sentence.svelte';
  import { actionOf, askOf, fillFrom, guideKey, needOf, paperHelp, sixBlocks, slotsFor, termsOf, type Action } from './view.ts';
  import WaitingBlock from './WaitingBlock.svelte';

  interface Props {
    id: StepId;
    /** The part's number, from 1. */
    part: number;
    /** Where it stands: now, blocked or unknown. */
    view: Exclude<PartView, { state: 'ticked' | 'later' }>;
    /** The time, in ms since 1970. */
    now: number;
    /** Something the reader did on this screen ticked the part, or cleared what it noted. */
    onticked: () => void;
  }

  let { id, part, view, now, onticked }: Props = $props();

  const wallet = useWallet();
  const doit = useDoit();

  let lang = $derived(router.lang);
  let t = $derived(strings.doit[lang]);

  let fact = $derived(partDef(id, part)?.on);
  let blockSeconds = $derived(wallet.config.blockSeconds);
  let six = $derived(sixBlocks(blockSeconds));

  /**
   * The facts a sentence of this part can name. Each sentence takes the
   * ones it has a slot for. {seconds} is the time between two practice
   * blocks, except in the one sentence that says how long six of them take
   * on a network so fast that six take under a minute.
   */
  let values = $derived({
    seconds: formatSats(fact === 'six-blocks' && six.unit === 'seconds' ? six.count : blockSeconds),
    minutes: formatSats(six.count),
    here: wallet.record?.fingerprint ?? '',
    noted: doit.progress.steps[id]?.wallet ?? '',
  });

  let guide = $derived(fillFrom(t[guideKey(id, part, blockSeconds)], values));
  let terms = $derived(termsOf(id, part));
  let ask = $derived(askOf(id, part));
  let action = $derived(view.state === 'now' ? actionOf(id, part, view) : null);
  let need = $derived(view.state === 'blocked' && !isWalletTrouble(view.reason) ? needOf(id, part, view.reason, doit.progress, doit.kept) : null);
  /** The drill's paper check: where a reader with no paper copy makes one. Null for every other part. */
  let paper = $derived(paperHelp(id, part, doit.progress));

  /** The slots that hold a wallet fingerprint: drawn apart from the words around them. */
  const FINGERPRINTS = ['here', 'noted'] as const;

  /** A payment that is in a block and counts the blocks on top of it: from 1 to 6. */
  let confirmations = $derived(view.state === 'now' && view.confirmations !== null && view.confirmations > 0 ? view.confirmations : null);
  /** The part waits for a block that has not come. */
  let waits = $derived(view.state === 'now' && view.waiting !== null && confirmations === null ? view.waiting : null);

  /** The address of a link into the wallet, in the page's language. */
  function hrefOf(to: Action): string {
    const address = router.link(to.route);
    return to.part === 'faucet' ? faucetLink(address) : address;
  }

  /** "Send another": the payment the step waited for is cleared from its note. */
  function sendAnother(): void {
    doit.sendAnother(id);
    onticked();
  }

  /** The box the reader ticks, for what no page can check. */
  let said = $state(false);
  /** The box was ticked and nothing was written: the part is not open any more. */
  let closed = $state(false);

  function onsaid(ticked: boolean): void {
    if (!ticked) return;
    if (doit.answer(id)) {
      onticked();
      return;
    }
    said = false;
    closed = true;
  }
</script>

<!-- The height of the chain and how often a block comes: under a count of blocks, and where coins wait for their first one. -->
{#snippet chain()}
  <div class="text-sm leading-relaxed text-ink-600">
    {#if wallet.chain.tip !== null}<p>{fill(t.waitTip, { height: formatSats(wallet.chain.tip) })}</p>{/if}
    <p>{fill(t.waitEvery, { seconds: formatSats(blockSeconds) })}</p>
  </div>
{/snippet}

{#if view.state === 'unknown'}
  <ChainLines unknown={view.reason} {now} />
{:else if view.state === 'blocked'}
  {#if isWalletTrouble(view.reason)}
    <!-- The wallet's own trouble: what is stored cannot be used, the wallet cannot run in this browser, or the
         page was not let read its storage. The wallet's own piece says which, and which way out there is. -->
    <StoredTrouble titled />
  {:else if need !== null}
    <div class="space-y-4" data-testid="step-need" data-reason={view.reason}>
      <div class="space-y-2 text-pretty text-base leading-relaxed text-ink-700">
        <!-- A sentence that names the wallet the step noted is left out when the note names none. -->
        {#if !(t[need.text].includes('{noted}') && values.noted === '')}
          <p><Sentence text={t[need.text]} slots={slotsFor(t[need.text], values)} mono={FINGERPRINTS} /></p>
        {/if}
        {#if need.more !== null}<p>{t[need.more]}</p>{/if}
      </div>
      {#if view.reason === 'not-spendable-yet'}
        {@render chain()}
      {/if}
      {#if need.link !== null}
        <div>
          {#if need.link.kind === 'step'}
            <Button
              variant="primary"
              class="w-full sm:w-auto"
              data-testid="step-need-link"
              href={router.link({ name: 'step', id: need.link.step })}
            >
              {fill(t.actStep, { step: t[stepDef(need.link.step).title] })}
            </Button>
          {:else}
            <Button
              variant="primary"
              class="w-full sm:w-auto"
              data-testid="step-need-link"
              href={hrefOf(need.link.action)}
              onclick={() => doit.follow(id)}
            >
              {t[need.link.action.label]}
            </Button>
          {/if}
        </div>
      {/if}
      {#if need.also !== undefined}
        <!-- The link above leads to making a wallet. A reader who has one already is told where it comes back. -->
        <p class="text-pretty text-sm leading-relaxed text-ink-600" data-testid="step-need-also">
          {t[need.also.text]}
          <TextLink href={hrefOf(need.also.action)} data-testid="step-need-also-link" onclick={() => doit.follow(id)}>
            {t[need.also.action.label]}
          </TextLink>
        </p>
      {/if}
    </div>
    <ChainLines unknown={null} {now} />
  {/if}
{:else}
  <div class="space-y-4">
    <p class="text-pretty text-base leading-relaxed text-ink-700" data-testid="step-guide">{guide}</p>

    {#if fact === 'wallet-removed'}
      <!-- Said plainly, before the one part of any step that takes something away. -->
      <Notice kind="caution" label={t.removeWarnTitle} data-testid="step-remove-warning">
        <div class="space-y-2">
          <p>{t.removeWarnFunded}</p>
          <p>{t.removeWarnNine}</p>
          <p>{t.removeWarnKept}</p>
        </div>
      </Notice>
    {/if}

    {#if waits !== null}
      <WaitingBlock waiting={waits} {now} onagain={sendAnother} />
    {:else if confirmations !== null}
      <div class="space-y-2">
        <p class="text-xl font-bold text-ink-800" data-testid="step-confirmations" data-count={String(confirmations)}>
          {fill(t.confirmations, { count: String(confirmations), total: String(SIX_BLOCKS) })}
        </p>
        <!-- The same count as six boxes, one filled for each block. Drawn, and not said: the line above says it. -->
        <div class="flex gap-1.5" aria-hidden="true">
          {#each { length: SIX_BLOCKS }, at}
            <span class={['h-3 w-8 rounded-sm border', at < confirmations ? 'border-orange-600 bg-orange-400' : 'border-ink-200 bg-white']}></span>
          {/each}
        </div>
        {@render chain()}
      </div>
    {:else if ask === 'block'}
      {#if view.txid !== null}
        <p class="text-sm">
          <OutLink href={explorerTxUrl(wallet.config.explorerUrl, view.txid)} text={t.blockExplorer} data-testid="step-explorer" />
        </p>
      {/if}
      <AskNumber {id} ask="block" {onticked} />
    {:else if ask === 'coins'}
      <p class="text-sm">
        <TextLink href={router.link({ name: 'coins' })} onclick={() => doit.follow(id)}>{t.actCoins}</TextLink>
      </p>
      <AskNumber {id} ask="coins" {onticked} />
    {:else if ask === 'words'}
      {#if paper !== null}
        <!-- Three words off the paper, and a reader who has no paper yet: the step or the screen where one is made. -->
        <p class="text-pretty text-sm leading-relaxed text-ink-600" data-testid="step-paper">
          {fillFrom(t[paper.text], { step: t[stepDef('the-seed').title] })}
          {#if paper.link.kind === 'step'}
            <TextLink href={router.link({ name: 'step', id: paper.link.step })} data-testid="step-paper-link">
              {fill(t.actStep, { step: t[stepDef(paper.link.step).title] })}
            </TextLink>
          {:else}
            <TextLink href={hrefOf(paper.link.action)} data-testid="step-paper-link" onclick={() => doit.follow(id)}>
              {t[paper.link.action.label]}
            </TextLink>
          {/if}
        </p>
      {/if}
      <AskWords {id} onpassed={onticked} />
    {:else if ask === 'said'}
      <p class="text-sm">
        <TextLink href={router.link({ name: 'backup' })} onclick={() => doit.follow(id)}>{t.actBackup}</TextLink>
      </p>
      <Checkbox bind:checked={said} data-testid="step-said" onchange={(event) => onsaid(event.currentTarget.checked)}>{t.said}</Checkbox>
      {#if closed}
        <Notice kind="problem" text={t.answerClosed} />
      {/if}
    {:else if action !== null}
      <div>
        <Button variant="primary" class="w-full sm:w-auto" data-testid="step-action" href={hrefOf(action)} onclick={() => doit.follow(id)}>
          {t[action.label]}
        </Button>
      </div>
    {/if}

    {#if terms.length > 0}
      <GlossaryLinks {terms} data-testid="step-glossary" />
    {/if}
    <ChainLines unknown={null} {now} />
  </div>
{/if}
