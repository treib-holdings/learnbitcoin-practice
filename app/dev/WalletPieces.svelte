<script lang="ts">
  // The pieces that show a wallet's coins, transactions and words, in every
  // state, on one page, in the page's language:
  //
  //   pnpm gallery /gallery/wallet --width 375 --scale 2 --part 950 --wait 800 --shot wallet.png
  //   pnpm gallery /es/gallery/wallet --width 320 ...
  //
  // Each block has its own stand-in wallet (Shown.svelte). The gates are on
  // /gallery/gates, the unlock step on /gallery/unlock, and the frame on any
  // wallet route whose address ends in "#frame".

  import { coinTotals, type TxView } from '@learnbitcoin/practice-wallet';
  import Card from '../src/components/Card.svelte';
  import Page from '../src/components/Page.svelte';
  import Rows from '../src/components/Rows.svelte';
  import Section from '../src/components/Section.svelte';
  import CoinList from '../src/components/wallet/CoinList.svelte';
  import NoCoins from '../src/components/wallet/NoCoins.svelte';
  import PasskeyProblem from '../src/components/wallet/PasskeyProblem.svelte';
  import Total from '../src/components/wallet/Total.svelte';
  import TxFeeRows from '../src/components/wallet/TxFeeRows.svelte';
  import TxList from '../src/components/wallet/TxList.svelte';
  import TxParts from '../src/components/wallet/TxParts.svelte';
  import WalletId from '../src/components/wallet/WalletId.svelte';
  import WordsInput from '../src/components/wallet/WordsInput.svelte';
  import WordsList from '../src/components/wallet/WordsList.svelte';
  import { router } from '../src/lib/router.svelte.ts';
  import type { CeremonyFailure } from '../src/lib/wallet-api.ts';
  import {
    OTHER_FINGERPRINT,
    OTHER_TAG,
    POT_ADDRESS,
    TAG,
    TXID,
    WORDS,
    fundedState,
    otherAddress,
    ownAddress,
    sampleHistory,
  } from './sample.ts';
  import Shown from './Shown.svelte';
  import { makeStandIn, type StandIn } from './stand-in.svelte.ts';

  const LEDE = {
    en: 'The pieces that show coins, transactions and the 12 words, in every state. Development only.',
    es: 'Las piezas que muestran monedas, transacciones y las 12 palabras, en todos sus estados. Solo para desarrollo.',
  } as const;

  const now = Date.now();
  const history = sampleHistory(now);
  const funded = fundedState();

  /** One transaction of the sample history. */
  function sample(txid: string): TxView {
    const view = history.find((tx) => tx.txid === txid);
    if (!view) throw new Error('gallery: no such sample transaction');
    return view;
  }

  /** A payment of everything the sample wallet can spend, signed by the real signer: it has no change. */
  const sendAll: TxView = (() => {
    const signed = makeStandIn('passkey-unlocked').sign({ to: POT_ADDRESS, amount: 'all', feeRate: 2n });
    if (!signed.ok) throw new Error('gallery: the sample wallet could not sign');
    return signed.view;
  })();

  /** The wallet moving its own coins to one of its own addresses: every part is its own. */
  const internal: TxView = {
    txid: 'c4f1b7e2a95d3086c4f1b7e2a95d3086c4f1b7e2a95d3086c4f1b7e2a95d3086',
    confirmed: true,
    height: 5900,
    time: Math.floor(now / 1000) - 3 * 3600,
    inputs: [{ address: ownAddress(0, 0).address, value: 100_000n, mine: true, change: false }],
    outputs: [{ address: ownAddress(0, 5).address, value: 99_780n, mine: true, change: false }],
    fee: 220n,
    vsize: 110,
    feeRate: 2,
    net: -220n,
    direction: 'internal',
    rbf: true,
  };

  /** A transaction that is none of the wallet's, from weeks ago. */
  const foreign: TxView = {
    txid: '7be09a13d2c4f6587be09a13d2c4f6587be09a13d2c4f6587be09a13d2c4f658',
    confirmed: true,
    height: 1200,
    time: Math.floor(now / 1000) - 40 * 86_400,
    inputs: [{ address: otherAddress(7), value: 60_000n, mine: false, change: false }],
    outputs: [
      { address: otherAddress(8), value: 20_000n, mine: false, change: false },
      { address: otherAddress(9), value: 39_577n, mine: false, change: false },
    ],
    fee: 423n,
    vsize: 141,
    feeRate: 3,
    net: 0n,
    direction: 'other',
    rbf: false,
  };

  /** A block's own first transaction: new coins, and an output with no address. */
  const coinbase: TxView = {
    txid: '0e3d5c7a9b1f24680e3d5c7a9b1f24680e3d5c7a9b1f24680e3d5c7a9b1f2468',
    confirmed: true,
    height: 5911,
    time: null,
    inputs: [{ address: null, value: 0n, mine: false, change: false }],
    outputs: [
      { address: otherAddress(0), value: 5_000_000_000n, mine: false, change: false },
      { address: null, value: 0n, mine: false, change: false },
    ],
    fee: 0n,
    vsize: 173,
    feeRate: 0,
    net: 0n,
    direction: 'other',
    rbf: false,
  };

  /** A payment whose fee rate is not a whole number. */
  const oddRate = { fee: 283n, vsize: 141, feeRate: 283 / 141 };

  /** The funded wallet without its unconfirmed coin. */
  function allConfirmed(wallet: StandIn): void {
    const coins = funded.coins.filter((coin) => coin.status.confirmed);
    wallet.haveCoins({ ...funded, coins, ...coinTotals(coins) }, history);
  }

  /** Twelve words with the seventh misspelled. */
  const BAD_WORD = 'abandon abandon abandon abandon abandon abandon abandn abandon abandon abandon abandon about';
  /** Twelve words on the list that do not pass their checksum. */
  const BAD_SUM = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';

  const FAILURES: { name: string; failure: CeremonyFailure }[] = [
    { name: 'cancelled', failure: { kind: 'cancelled', timedOut: false } },
    { name: 'cancelled, timed out', failure: { kind: 'cancelled', timedOut: true } },
    { name: 'no-prf, passkey known', failure: { kind: 'no-prf', tag: TAG } },
    { name: 'no-prf, passkey not known', failure: { kind: 'no-prf', tag: null } },
    { name: 'error', failure: { kind: 'error', name: 'NotAllowedError' } },
    { name: 'busy', failure: { kind: 'busy' } },
    { name: 'reload', failure: { kind: 'reload' } },
    { name: 'broken', failure: { kind: 'broken' } },
  ];

  /** The word fields of the blocks below, by name, so a block's button can ask them for the check. */
  let inputs = $state<Record<string, ReturnType<typeof WordsInput> | undefined>>({});
</script>

{#snippet transaction(view: TxView)}
  <Card>
    <div class="space-y-6">
      <TxParts {view} />
      <Rows><TxFeeRows {view} /></Rows>
    </div>
  </Card>
{/snippet}

{#snippet typing(name: string)}
  <WordsInput bind:this={inputs[name]} data-testid="sample-words" />
  <!-- The gallery's own button, where a screen would have "Restore" or "Unlock". -->
  <button
    type="button"
    data-testid="sample-check"
    class="mt-3 rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-700"
    onclick={() => inputs[name]?.check()}>check()</button
  >
{/snippet}

<Page eyebrow="Gallery" title="Wallet pieces" lede={LEDE[router.lang]}>
  <Section title="Total">
    <Shown preset="funded"><Total /></Shown>
    <Shown preset="funded" setup={allConfirmed} note="nothing unconfirmed"><Total /></Shown>
    <Shown preset="no-coins"><Total /></Shown>
    <Shown preset="scanning" note="coins not known: the piece draws nothing"><Total /></Shown>
  </Section>

  <Section title="NoCoins">
    <Shown preset="no-coins"><NoCoins /></Shown>
  </Section>

  <Section title="CoinList, CoinRow">
    <Shown preset="funded"><CoinList coins={funded.coins} /></Shown>
  </Section>

  <Section title="TxList, TxRow">
    <Shown preset="funded"><TxList txs={[...history, internal, foreign, coinbase]} {now} /></Shown>
  </Section>

  <Section title="TxParts, TxFeeRows">
    <Shown preset="funded" note="sent, with change">{@render transaction(sample(TXID.sent))}</Shown>
    <Shown preset="funded" note="sent, everything: no change">{@render transaction(sendAll)}</Shown>
    <Shown preset="funded" note="received, unconfirmed">{@render transaction(sample(TXID.arriving))}</Shown>
    <Shown preset="funded" note="the wallet paying itself">{@render transaction(internal)}</Shown>
    <Shown preset="funded" note="a block's own first transaction">{@render transaction(coinbase)}</Shown>
    <Shown preset="funded" note="a fee rate that is not a whole number"><Rows><TxFeeRows view={oddRate} /></Rows></Shown>
  </Section>

  <Section title="WordsList">
    <Shown preset="passkey-unlocked"><WordsList words={WORDS.split(' ')} /></Shown>
  </Section>

  <Section title="WordsInput">
    <Shown note="empty">{@render typing('empty')}</Shown>
    <Shown steps={[{ words: BAD_WORD }, { leave: 7 }]} note="word 7 is not on the list, and the reader has left its field">
      {@render typing('left')}
    </Shown>
    <Shown steps={[{ words: BAD_WORD }, { tap: 'sample-check' }]} note="word 7 is not on the list, after the check">
      {@render typing('bad')}
    </Shown>
    <Shown steps={[{ words: 'abandon ability able about above' }, { tap: 'sample-check' }]} note="seven fields empty, after the check">
      {@render typing('missing')}
    </Shown>
    <Shown steps={[{ words: BAD_SUM }, { tap: 'sample-check' }]} note="the checksum fails">
      {@render typing('sum')}
    </Shown>
    <Shown steps={[{ words: WORDS }, { tap: 'sample-check' }]} note="twelve good words">
      {@render typing('good')}
    </Shown>
    <Shown note="switched off, while the caller works"><WordsInput disabled /></Shown>
  </Section>

  <Section title="PasskeyProblem">
    {#each FAILURES as { name, failure } (name)}
      <Shown note={name}><PasskeyProblem {failure} /></Shown>
    {/each}
  </Section>

  <Section title="WalletId">
    <Shown><WalletId tag={OTHER_TAG} fingerprint={OTHER_FINGERPRINT} /></Shown>
    <Shown note="a passkey with no known name"><WalletId tag={null} fingerprint={OTHER_FINGERPRINT} /></Shown>
  </Section>
</Page>
