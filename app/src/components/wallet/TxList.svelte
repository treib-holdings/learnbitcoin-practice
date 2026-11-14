<script lang="ts">
  // A list of transactions, one TxRow each: the recent ones on the
  // Overview, all of them on the Activity screen. Pass them newest first,
  // as wallet.history has them. For an empty list show the screen's own
  // empty line instead.
  //
  // The rows say how long ago each transaction was confirmed, and the list
  // keeps its own clock for that: it reads the time again every half minute
  // and whenever the list is handed over again, so "6 minutes ago" goes on
  // counting for as long as the screen stays open. A screen has nothing to
  // do for it. (`now` is for a place that wants a fixed moment, such as the
  // gallery: with it the list keeps no clock.)

  import type { TxView } from '@learnbitcoin/practice-wallet';
  import TxRow from './TxRow.svelte';

  interface Props {
    txs: readonly TxView[];
    /** A fixed moment to read the rows at, in milliseconds since 1970. Without it, the list's own clock. */
    now?: number;
    class?: string;
  }

  let { txs, now, class: extra = '' }: Props = $props();

  /** How often the list reads the time, in milliseconds. A row counts in whole minutes. */
  const TICK = 30_000;

  let clock = $state(Date.now());

  // A clock is outside Svelte, so an effect follows it. It runs again when
  // the list changes (a poll has brought it afresh, perhaps with a
  // transaction that was confirmed a moment ago): that is the time to look
  // at the clock, not up to half a minute later. The effect only ever
  // writes `clock`. If it also read it, every tick would start it again.
  $effect(() => {
    void txs;
    if (now !== undefined) return;
    clock = Date.now();
    const timer = setInterval(() => (clock = Date.now()), TICK);
    return () => clearInterval(timer);
  });
</script>

<!-- role="list": Safari stops calling a list a list once its bullets are styled away. -->
<ul role="list" class={['space-y-2', extra]}>
  {#each txs as view (view.txid)}
    <TxRow {view} now={now ?? clock} />
  {/each}
</ul>
