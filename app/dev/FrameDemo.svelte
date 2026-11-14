<script lang="ts">
  // A sample wallet screen: the wallet frame with a little of everything in
  // it. It stands in for the screen of any wallet route whose address ends
  // in "#frame", so the frame, the gates and the unlock step can be looked
  // at on a real route, in any state, before the screens themselves exist:
  //
  //   /wallet/receive?state=slow#frame
  //   /es/wallet/send?state=passkey-locked&unlock=cancelled#frame:demo-keys,unlock
  //
  // What follows the colon is played once the page is drawn (Gallery.svelte,
  // play.ts): here a tap on "demo-keys", the sample screen's button that
  // needs keys, and then a tap on the unlock step's own button.
  //
  // The sample text here is not the app's: a screen's own words live in its
  // string table.

  import { tick } from 'svelte';
  import Button from '../src/components/Button.svelte';
  import Section from '../src/components/Section.svelte';
  import CoinList from '../src/components/wallet/CoinList.svelte';
  import NoCoins from '../src/components/wallet/NoCoins.svelte';
  import Total from '../src/components/wallet/Total.svelte';
  import TxList from '../src/components/wallet/TxList.svelte';
  import Unlock from '../src/components/wallet/Unlock.svelte';
  import WalletFrame from '../src/components/wallet/WalletFrame.svelte';
  import WordsList from '../src/components/wallet/WordsList.svelte';
  import { SECTIONS, type Section as WalletSection } from '../src/components/wallet/frame.ts';
  import type { Unlocked } from '../src/components/wallet/unlock-flow.ts';
  import { focusHeading, router } from '../src/lib/router.svelte.ts';
  import { useWallet } from '../src/lib/wallet-context.ts';
  import { strings } from '../src/strings/index.ts';

  const wallet = useWallet();

  let c = $derived(strings.common[router.lang]);

  const SAMPLE = {
    en: {
      lede: 'A sample screen for the development gallery: the wallet frame with a little of everything in it.',
      known: 'The frame says the coins are known.',
      unknown: 'The frame says the coins are not known yet, so this screen shows no total.',
      coins: 'Coins',
      activity: 'Activity',
      loading: 'Loading the activity...',
      none: 'No activity yet.',
      keys: 'A step that needs keys',
      show: 'Show the 12 words',
      why: 'Showing the 12 words needs the keys of this wallet, and your passkey loads them.',
      got: 'The step called onunlocked with:',
      hide: 'Hide the words',
    },
    es: {
      lede: 'Una pantalla de muestra para la galería de desarrollo: el marco de la billetera con un poco de todo.',
      known: 'El marco dice que las monedas ya se conocen.',
      unknown: 'El marco dice que las monedas todavía no se conocen, así que esta pantalla no muestra ningún total.',
      coins: 'Monedas',
      activity: 'Actividad',
      loading: 'Cargando la actividad...',
      none: 'Todavía no hay actividad.',
      keys: 'Un paso que necesita las claves',
      show: 'Mostrar las 12 palabras',
      why: 'Para mostrar las 12 palabras hacen falta las claves de esta billetera, y tu llave de acceso las carga.',
      got: 'El paso llamó a onunlocked con:',
      hide: 'Ocultar las palabras',
    },
  } as const;

  let s = $derived(SAMPLE[router.lang]);

  // The heading is the section's own name, as on the real screen.
  let title = $derived.by(() => {
    const name = router.route.name;
    return (SECTIONS as readonly string[]).includes(name) ? c[`section_${name as WalletSection}`] : c.screen_tx;
  });

  // App.svelte tells the wallet which screen is open. Here this screen
  // stands in for App, and it shows activity on every route, so it always
  // names a screen that does: the stand-in then loads the sample history.
  $effect(() => {
    void router.route.name;
    wallet.watch('wallet');
  });

  /** Where the sample screen's own step is: nothing asked, the unlock step, or the words. */
  let step = $state<'idle' | 'unlock' | 'words'>('idle');
  let how = $state<Unlocked | 'already'>('already');
  let words = $state.raw<string[]>([]);

  async function ask(): Promise<void> {
    if (wallet.unlocked) {
      reveal('already');
      return;
    }
    step = 'unlock';
    await tick();
    focusHeading();
  }

  function reveal(told: Unlocked | 'already'): void {
    how = told;
    words = wallet.revealWords() ?? [];
    step = 'words';
  }

  function hide(): void {
    words = [];
    step = 'idle';
  }

  // The words go when the wallet is locked again.
  $effect(() => {
    if (!wallet.unlocked && step === 'words') hide();
  });
</script>

<WalletFrame {title} lede={s.lede}>
  {#snippet children(known)}
    <p class="text-sm text-ink-500" data-testid="demo-known">{known ? s.known : s.unknown}</p>

    {#if known}
      <Total />
      <Section title={s.coins}>
        {#if wallet.chain.state !== null && wallet.chain.state.coins.length > 0}
          <CoinList coins={wallet.chain.state.coins} />
        {:else}
          <NoCoins />
        {/if}
      </Section>
      <Section title={s.activity}>
        {#if wallet.history === null}
          <p class="text-sm text-ink-500">{s.loading}</p>
        {:else if wallet.history.length === 0}
          <p class="text-sm text-ink-500">{s.none}</p>
        {:else}
          <TxList txs={wallet.history} />
        {/if}
      </Section>
    {/if}

    <Section title={s.keys}>
      {#if step === 'idle'}
        <Button data-testid="demo-keys" onclick={() => void ask()}>{s.show}</Button>
      {:else if step === 'unlock'}
        <Unlock why={s.why} promise onunlocked={reveal} />
      {:else}
        <p class="text-sm text-ink-500">{s.got} <code class="font-mono" data-testid="demo-how">{how}</code></p>
        <WordsList {words} />
        <Button variant="quiet" onclick={hide}>{s.hide}</Button>
      {/if}
    </Section>
  {/snippet}
</WalletFrame>
