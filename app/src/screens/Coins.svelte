<script lang="ts">
  // The Coins screen: every coin this wallet holds.
  //
  // A wallet has no balance to keep. It holds coins, each one an unspent
  // output of some transaction (a UTXO), and its total is what they add up
  // to. So each coin is shown for itself: what it holds, the address it
  // sits on, whether it is still unconfirmed, whether it is change, and a
  // link to the transaction that made it. A few sentences under the list
  // say what a coin is, with a link to the main site's glossary.
  //
  // Until the first look at the practice network has finished there is no
  // list, and never an empty one in its place: the wallet frame says what
  // is going on.

  import Button from '../components/Button.svelte';
  import Empty from '../components/Empty.svelte';
  import OutLink from '../components/OutLink.svelte';
  import Prose from '../components/Prose.svelte';
  import Section from '../components/Section.svelte';
  import CoinList from '../components/wallet/CoinList.svelte';
  import { faucetLink } from '../components/wallet/frame.ts';
  import Total from '../components/wallet/Total.svelte';
  import WalletFrame from '../components/wallet/WalletFrame.svelte';
  import { fill } from '../lib/format.ts';
  import { router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import { glossaryUrl } from './read/read.ts';

  const wallet = useWallet();

  let lang = $derived(router.lang);
  let t = $derived(strings.wallet[lang]);
  let c = $derived(strings.common[lang]);

  let coins = $derived(wallet.chain.state?.coins ?? []);
</script>

<WalletFrame title={c.section_coins} lede={t.coinsLede}>
  {#snippet children(known)}
    {#if known}
      {#if coins.length > 0}
        <Total />
        <div class="space-y-3">
          <CoinList {coins} />
          <!-- What the two marks in the list mean, and what no mark means. -->
          <p class="text-pretty text-sm leading-relaxed text-ink-500" data-testid="coins-marks">
            {fill(t.coinsMarks, { unconfirmed: c.unconfirmed, change: t.coinChange })}
          </p>
        </div>
      {:else}
        <Empty text={t.coinsEmpty} data-testid="coins-empty">
          <Button variant="primary" small href={faucetLink(router.link({ name: 'receive' }))}>{t.getCoins}</Button>
        </Empty>
      {/if}
    {/if}

    <Section title={t.coinsWhatTitle}>
      <Prose>
        <p>{t.coinsWhat}</p>
        <!-- Small enough to stay one line at 320 px in both languages: a link
             that wraps can leave its arrow alone at the start of the next line. -->
        <p class="text-sm">
          <OutLink href={glossaryUrl(wallet.config.siteUrl, lang, 'utxo')} text={t.coinsGlossary} data-testid="coins-glossary" />
        </p>
      </Prose>
    </Section>
  {/snippet}
</WalletFrame>
