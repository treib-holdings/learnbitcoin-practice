<script lang="ts">
  // The payment is sent: what happens to it next, a link to its own screen,
  // and the way to send another.
  //
  // "Payment sent" itself is the screen's heading, and the wallet frame
  // says it through the status region when the wallet announces it. The
  // figures here are the signed payment's own.
  //
  // The view follows the payment. It starts by saying that the payment went
  // into the mempool and that the next block should take it in. With every
  // new block it asks the wallet for the transaction, and once a block has
  // taken it in the first paragraph says so and names the block. (The frame
  // says "1 confirmation." through the status region when the wallet
  // announces it, and the status region is not drawn: what it says has to
  // show here as well.) Nothing is asked once the payment is confirmed.

  import { onDestroy, untrack } from 'svelte';
  import Actions from '../../components/Actions.svelte';
  import Amount from '../../components/Amount.svelte';
  import Button from '../../components/Button.svelte';
  import Mono from '../../components/Mono.svelte';
  import Prose from '../../components/Prose.svelte';
  import Row from '../../components/Row.svelte';
  import Rows from '../../components/Rows.svelte';
  import { fill, formatSats } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { useWallet } from '../../lib/wallet-context.ts';
  import { strings } from '../../strings/index.ts';
  import type { PaymentFacts } from './form.ts';

  interface Props {
    txid: string;
    /** The payment's figures, as it was signed. Null only for a payment the form could not have made. */
    facts: PaymentFacts | null;
    /** It went to an address of the pot. */
    pot: boolean;
    /** Seconds between practice blocks. */
    blockSeconds: number;
    onanother: () => void;
  }

  let { txid, facts, pot, blockSeconds, onanother }: Props = $props();

  const wallet = useWallet();

  let t = $derived(strings.send[router.lang]);
  let c = $derived(strings.common[router.lang]);
  let w = $derived(strings.wallet[router.lang]);

  // -- following the payment ----------------------------------------------------------

  /** The height of the block that took the payment in, once one has. */
  let block = $state<number | null>(null);
  /** A look for the transaction is under way, and whether a new block came while it was. */
  let looking = false;
  let again = false;
  let gone = false;
  onDestroy(() => (gone = true));

  async function follow(): Promise<void> {
    if (block !== null) return;
    if (looking) {
      again = true;
      return;
    }
    looking = true;
    // No mark on <main>: nothing the reader did is waiting for this.
    const found = await wallet.lookupTx(txid);
    looking = false;
    if (gone) return;
    if (found.kind === 'found' && found.view.confirmed && found.view.height !== null) {
      block = found.view.height;
      return;
    }
    // Not in a block yet, or not to be had just now: the next block asks again.
    if (again) {
      again = false;
      void follow();
    }
  }

  // Once when the view appears (a payment that was handed in a second time
  // can be in a block already), then with every new block. The height is
  // read through a value of its own: the wallet hands out a new `chain` with
  // every look at the network, and only a new height is a reason to ask.
  let tip = $derived(wallet.chain.tip);
  $effect(() => {
    void tip;
    untrack(() => void follow());
  });

  /** Buttons of one group are as wide as each other on a phone. */
  const WIDE = 'w-full sm:w-auto';
</script>

<div class="space-y-8" data-testid="send-sent">
  <Prose>
    {#if block === null}
      <p data-testid="sent-next">{fill(t.sentNext, { seconds: String(blockSeconds) })}</p>
    {:else}
      <!-- A height is written as every number here is: 5,912. -->
      <p data-testid="sent-confirmed">{fill(t.sentConfirmed, { height: formatSats(block) })}</p>
    {/if}
    {#if pot}<p data-testid="sent-pot">{t.sentPot}</p>{/if}
  </Prose>

  <Rows>
    {#if facts !== null}
      <Row name={t.planTo} data-testid="sent-to"><Mono value={facts.to} /></Row>
      <Row name={t.planAmount} data-testid="sent-amount"><Amount sats={facts.amount} /></Row>
      <Row name={w.txFee} data-testid="sent-fee"><Amount sats={facts.fee} /></Row>
    {/if}
    <Row name={c.screen_tx} data-testid="sent-txid"><Mono value={txid} size="small" /></Row>
  </Rows>

  <Actions>
    <Button variant="primary" class={WIDE} href={router.link({ name: 'tx', txid })} data-testid="sent-link">{t.sentLink}</Button>
    <Button class={WIDE} data-testid="send-another" onclick={onanother}>{t.sentAnother}</Button>
  </Actions>
</div>
