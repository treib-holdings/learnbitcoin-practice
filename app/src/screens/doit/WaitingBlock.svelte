<script lang="ts">
  // The waiting display: what a part that waits for a block shows while it
  // waits.
  //
  //   - that the payment is not in a block yet;
  //   - how long ago it was sent, where the step's note says when;
  //   - how high the practice chain stands;
  //   - how often a block comes here;
  //   - a link to the payment on the practice explorer, unless the part
  //     that waits asks for the display without it (`explorer`).
  //
  // The link opens a new tab. Two steps wait for a payment of the wallet's
  // own ("Pass it on" and "The waiting room"), and show it. "Hold some"
  // waits for the block of a coin the wallet holds (one that was paid to
  // it or, for a wallet that has paid already, the change of a payment of
  // its own), and does not: it is the first step a newcomer does, this is
  // the one idle moment on its road, and the link's words say nothing of
  // who runs the explorer. Its done card offers the explorer, beside the
  // words on who runs it.
  //
  // The reader has nothing to do but wait, so there is no action here. The
  // part ticks by itself when the block comes: the step's screen reads the
  // chain as a wallet screen does, and nothing has to be reloaded.
  //
  // One case is not a wait. If the network does not know the noted payment
  // two minutes after it was sent (the practice chain can be started again
  // from its first block), the piece says so and offers "Send another",
  // which clears that payment from the step's note: the next payment sent
  // while the step is followed takes its place.
  //
  // It is not a live region: a screen reader is told when the part ticks
  // (the step's screen says so through the status region), not each second
  // of the wait.

  import Button from '../../components/Button.svelte';
  import Notice from '../../components/Notice.svelte';
  import OutLink from '../../components/OutLink.svelte';
  import type { Waiting } from '../../lib/doit/judge.ts';
  import { fill, formatElapsed, formatSats } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import { explorerTxUrl } from '../read/read.ts';

  interface Props {
    waiting: Waiting;
    /** The time, in ms since 1970. */
    now: number;
    /** False for a display without the link to the practice explorer. Left out, the link is drawn. */
    explorer?: boolean;
    /** "Send another" was pressed. */
    onagain: () => void;
  }

  let { waiting, now, explorer = true, onagain }: Props = $props();

  const wallet = useWallet();

  let lang = $derived(router.lang);
  let t = $derived(strings.doit[lang]);

  let sent = $derived(
    waiting.sentAt === null ? '' : fill(t.waitSent, { ago: formatElapsed(Math.max(0, (now - waiting.sentAt) / 1000), lang) }),
  );
  let tip = $derived(wallet.chain.tip);
</script>

<div class="space-y-3" data-testid="step-waiting" data-lost={waiting.lost ? 'yes' : 'no'}>
  {#if waiting.lost}
    <Notice kind="problem" silent text={t.waitLost}>
      <Button data-testid="step-send-another" onclick={onagain}>{t.sendAnother}</Button>
    </Notice>
  {:else}
    <div class="rounded-lg border border-ink-100 bg-ink-50 px-4 py-3 text-sm leading-relaxed text-ink-700">
      <p class="font-semibold text-ink-800">{t.waitNotYet}</p>
      {#if sent !== ''}<p data-testid="step-waiting-sent">{sent}</p>{/if}
      {#if tip !== null}<p data-testid="step-waiting-tip">{fill(t.waitTip, { height: formatSats(tip) })}</p>{/if}
      <p>{fill(t.waitEvery, { seconds: formatSats(wallet.config.blockSeconds) })}</p>
    </div>
    {#if explorer && waiting.txid !== null}
      <p class="text-sm">
        <OutLink href={explorerTxUrl(wallet.config.explorerUrl, waiting.txid)} text={t.waitExplorer} data-testid="step-waiting-explorer" />
      </p>
    {/if}
  {/if}
</div>
