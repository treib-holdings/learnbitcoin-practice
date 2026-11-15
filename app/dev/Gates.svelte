<script lang="ts">
  // The gates, in every state, on one page: what stands in for a wallet
  // screen when this browser has no wallet it can use, and each way "Open
  // with my passkey" can end.
  //
  //   pnpm gallery /gallery/gates --width 375 --scale 2 --part 950 --wait 800 --shot gates.png
  //   pnpm gallery /es/gallery/gates --width 320 ...
  //
  // Each block has its own stand-in wallet (Shown.svelte). The whole gate,
  // with its heading, is at any wallet route: /wallet?state=none,
  // ?state=unreadable, ?state=newer, ?state=broken.

  import Page from '../src/components/Page.svelte';
  import Section from '../src/components/Section.svelte';
  import NoWallet from '../src/components/wallet/NoWallet.svelte';
  import OpenWithPasskey from '../src/components/wallet/OpenWithPasskey.svelte';
  import StoredTrouble from '../src/components/wallet/StoredTrouble.svelte';
  import { router } from '../src/lib/router.svelte.ts';
  import Shown from './Shown.svelte';

  const LEDE = {
    en: 'What stands in for a wallet screen when this browser has no wallet it can use, in every state. Development only.',
    es: 'Lo que aparece en lugar de una pantalla de la billetera cuando este navegador no tiene una billetera que pueda usar, en todos sus estados. Solo para desarrollo.',
  } as const;

  /** Every way openWithPasskey can end without opening a wallet. */
  const ANSWERS = ['cancelled', 'timed-out', 'no-prf', 'error', 'busy', 'reload', 'broken', 'exists', 'no-storage'] as const;

  const tapOpen = [{ tap: 'open-passkey' }] as const;
</script>

<Page eyebrow="Gallery" title="Gates" lede={LEDE[router.lang]}>
  <Section title="NoWallet">
    <Shown note="the gate's body, on a wallet route"><NoWallet /></Shown>
    <Shown query="passkeys=no" note="this browser offers no passkeys"><NoWallet /></Shown>
    <Shown query="passkeys=unknown" note="not known yet whether it offers passkeys"><NoWallet /></Shown>
  </Section>

  <Section title="OpenWithPasskey, after each answer">
    {#each ANSWERS as answer (answer)}
      <Shown query="open={answer}" steps={tapOpen}><OpenWithPasskey /></Shown>
    {/each}
  </Section>

  <Section title="StoredTrouble">
    <Shown preset="unreadable"><StoredTrouble /></Shown>
    <Shown preset="unreadable" steps={[{ tap: 'remove-wallet' }]}><StoredTrouble /></Shown>
    <!-- The question takes no answer in its first moment (components/taps.ts): the second tap waits that out. -->
    <Shown preset="unreadable" query="remove=gone" steps={[{ tap: 'remove-wallet' }, { wait: 700 }, { tap: 'remove-confirm' }]}>
      <StoredTrouble />
    </Shown>
    <Shown preset="unreadable" note="titled, as Home shows it"><StoredTrouble titled /></Shown>
    <Shown preset="newer"><StoredTrouble /></Shown>
    <Shown preset="newer" note="titled, as Home shows it"><StoredTrouble titled /></Shown>
    <Shown preset="broken"><StoredTrouble /></Shown>
    <Shown preset="broken" note="titled, as Home shows it"><StoredTrouble titled /></Shown>
  </Section>
</Page>
