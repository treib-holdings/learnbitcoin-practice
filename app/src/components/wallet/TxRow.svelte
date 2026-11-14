<script lang="ts">
  // One transaction, as a row of a TxList. The whole row is a link to the
  // transaction's own screen. It says which way the coins went, what the
  // wallet gained or lost (the fee included), and either "Unconfirmed" or
  // when it was confirmed.
  //
  // `now` is the time the row is read at, in milliseconds since 1970. It
  // is what "6 minutes ago" is counted from, and it has to move: TxList
  // hands every row its clock. A row that read the time once, when it was
  // drawn, would stop counting.

  import type { TxView } from '@learnbitcoin/practice-wallet';
  import { fill, formatDate, formatElapsed, shortId } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import Amount from '../Amount.svelte';
  import Badge from '../Badge.svelte';
  import { FOCUS } from '../styles.ts';
  import { txWhen } from './tx-text.ts';

  interface Props {
    view: TxView;
    now: number;
  }

  let { view, now }: Props = $props();

  let lang = $derived(router.lang);
  let t = $derived(strings.wallet[lang]);
  let c = $derived(strings.common[lang]);

  let direction = $derived(
    { received: t.txReceived, sent: t.txSent, internal: t.txInternal, other: t.txOther }[view.direction],
  );
  let when = $derived.by(() => {
    const at = txWhen(view, now);
    if (at.kind === 'ago') return fill(t.txConfirmedAgo, { when: formatElapsed(at.seconds, lang) });
    if (at.kind === 'date') return fill(t.txConfirmedOn, { date: formatDate(at.time, lang) });
    return at.kind === 'confirmed' ? t.txConfirmed : null;
  });
</script>

<li>
  <a
    data-testid="tx-row"
    href={router.link({ name: 'tx', txid: view.txid })}
    class={[
      'group block rounded-lg border border-ink-100 px-4 py-3 transition hover:border-orange-400 motion-reduce:transition-none',
      FOCUS,
    ]}
  >
    <span class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <span class="font-semibold text-ink-800 group-hover:text-orange-600">{direction}</span>
      <!-- A transaction that is not this wallet's neither added to it nor took from it. -->
      {#if view.direction !== 'other'}<Amount sats={view.net} signed />{/if}
    </span>
    <span class="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-ink-500">
      {#if when === null}
        <Badge tone="fact">{c.unconfirmed}</Badge>
      {:else}
        <span>{when}</span>
      {/if}
      <span translate="no" class="font-mono">{shortId(view.txid)}</span>
    </span>
  </a>
</li>
