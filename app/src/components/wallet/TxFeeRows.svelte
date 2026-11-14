<script lang="ts">
  // What a transaction costs, as three rows for a Rows list: the fee, the
  // size the fee is paid for (in virtual bytes), and the fee rate, which is
  // the one divided by the other. Put it inside a Rows piece, among the
  // screen's own rows:
  //
  //   <Rows>
  //     <Row name={t.to}><Mono value={address} /></Row>
  //     <TxFeeRows {view} />
  //   </Rows>

  import type { TxView } from '@learnbitcoin/practice-wallet';
  import { formatSats } from '../../lib/format.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import Amount from '../Amount.svelte';
  import Row from '../Row.svelte';
  import { feeRateText } from './tx-text.ts';

  interface Props {
    view: Pick<TxView, 'fee' | 'vsize' | 'feeRate'>;
  }

  let { view }: Props = $props();

  let t = $derived(strings.wallet[router.lang]);
  let c = $derived(strings.common[router.lang]);

  const NUMBER = 'font-mono tabular-nums text-ink-800';
  const UNIT = 'whitespace-nowrap text-xs text-ink-500';
</script>

<Row name={t.txFee} data-testid="tx-fee"><Amount sats={view.fee} /></Row>
<Row name={t.txSize} data-testid="tx-size">
  <span translate="no" class={NUMBER}>{formatSats(view.vsize)}</span>
  <span translate="no" class={UNIT}>{c.vbyteUnit}</span>
</Row>
<Row name={t.txFeeRate} data-testid="tx-fee-rate">
  <span translate="no" class={NUMBER}>{feeRateText(view.feeRate)}</span>
  <span translate="no" class={UNIT}>{c.feeRateUnit}</span>
</Row>
