<script lang="ts">
  // The unlock step after every answer the wallet can give, on one page.
  //
  //   pnpm gallery /gallery/unlock --width 375 --scale 2 --part 950 --wait 800 --shot unlock.png
  //
  // Each block has its own stand-in wallet (Shown.svelte) and plays the taps
  // that lead to its state. The two unlocks that end well and still have
  // something to tell (tampered, switched) sit in a wallet frame, because
  // the frame is what tells it. To try the step by hand on a route:
  // /wallet/send?state=passkey-locked&unlock=cancelled#frame

  import Page from '../src/components/Page.svelte';
  import Section from '../src/components/Section.svelte';
  import Unlock from '../src/components/wallet/Unlock.svelte';
  import WalletFrame from '../src/components/wallet/WalletFrame.svelte';
  import type { Unlocked } from '../src/components/wallet/unlock-flow.ts';
  import { router } from '../src/lib/router.svelte.ts';
  import type { Step } from './play.ts';
  import Shown from './Shown.svelte';
  import type { StandIn } from './stand-in.svelte.ts';

  const SAMPLE = {
    en: {
      lede: 'The unlock step after every answer the wallet can give. Development only.',
      whySend: 'Signing this payment needs the keys of this wallet, and your passkey loads them.',
      whyWords: 'Showing the 12 words needs the keys of this wallet, and your passkey loads them.',
      got: 'The step called onunlocked with:',
      nothing: '(Nothing is drawn: a wallet made without a passkey never shows this step.)',
      frame: 'A wallet screen',
    },
    es: {
      lede: 'El paso de desbloqueo después de cada respuesta que puede dar la billetera. Solo para desarrollo.',
      whySend: 'Para firmar este pago hacen falta las claves de esta billetera, y tu llave de acceso las carga.',
      whyWords: 'Para mostrar las 12 palabras hacen falta las claves de esta billetera, y tu llave de acceso las carga.',
      got: 'El paso llamó a onunlocked con:',
      nothing: '(No se dibuja nada: una billetera creada sin llave de acceso nunca muestra este paso.)',
      frame: 'Una pantalla de la billetera',
    },
  } as const;

  let s = $derived(SAMPLE[router.lang]);

  /** What each block's step told its screen, by the block's name. */
  let told = $state<Record<string, Unlocked>>({});

  /** Every way unlock() can end with a problem. "gone" has a block of its own below. */
  const REFUSALS = ['cancelled', 'timed-out', 'no-prf', 'error', 'busy', 'reload', 'broken', 'changed'] as const;

  const tapUnlock: readonly Step[] = [{ tap: 'unlock' }];
  /** As far as the open word fields: a refused passkey, then "Use the 12 words". */
  const toWords: readonly Step[] = [{ tap: 'unlock' }, { tap: 'unlock-words' }];

  /** Eleven words of the sample wallet, with the seventh misspelled. */
  const BAD_WORD = 'abandon abandon abandon abandon abandon abandon abandn abandon abandon abandon abandon about';
  /** Twelve words on the list that do not pass their checksum. */
  const BAD_SUM = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
  const SAMPLE_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  /** Valid words of another wallet. */
  const OTHER_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

  /**
   * "Gone" in the app means the wallet was removed or replaced in another
   * tab. The stand-in then removes its wallet, and the gate takes over. To
   * see the step's own text, these answer "gone" and leave the wallet be.
   */
  function goneAtUnlock(wallet: StandIn): void {
    wallet.unlock = () => Promise.resolve({ kind: 'gone' });
  }
  function goneAtWords(wallet: StandIn): void {
    wallet.unlockWithWords = () => 'gone';
  }
</script>

{#snippet step(name: string, why: string, promise: boolean)}
  <Unlock {why} {promise} onunlocked={(how) => (told[name] = how)} />
  {#if told[name] !== undefined}
    <p class="text-sm text-ink-500">{s.got} <code class="font-mono" data-testid="told">{told[name]}</code></p>
  {/if}
{/snippet}

<Page eyebrow="Gallery" title="Unlock" lede={s.lede}>
  <Section title="Before any try">
    <Shown preset="passkey-locked" note="with the promise, as Send shows it">
      {@render step('first', s.whySend, true)}
    </Shown>
    <Shown preset="passkey-locked" note="without the promise, as Backup shows it">
      {@render step('first-plain', s.whyWords, false)}
    </Shown>
    <Shown preset="words" note="a wallet made without a passkey">
      {@render step('words-wallet', s.whyWords, false)}
      <p class="text-sm text-ink-500">{s.nothing}</p>
    </Shown>
  </Section>

  <Section title="After a try that opened nothing">
    {#each REFUSALS as answer (answer)}
      <Shown preset="passkey-locked" query="unlock={answer}" steps={tapUnlock}>
        {@render step(answer, s.whySend, true)}
      </Shown>
    {/each}
    <Shown preset="passkey-locked" setup={goneAtUnlock} steps={tapUnlock} note="unlock answers gone">
      {@render step('gone', s.whySend, true)}
    </Shown>
  </Section>

  <Section title="Another passkey answered">
    <Shown preset="passkey-locked" query="unlock=other-passkey" steps={tapUnlock}>
      {@render step('other', s.whySend, true)}
    </Shown>
    <Shown preset="switch-pending-unnamed" note="the question, for a passkey with no known name">
      {@render step('other-unnamed', s.whySend, true)}
    </Shown>
    <Shown preset="passkey-locked" query="unlock=other-passkey" steps={[{ tap: 'unlock' }, { tap: 'switch-cancel' }]}>
      {@render step('other-kept', s.whySend, true)}
    </Shown>
    <Shown
      preset="passkey-locked"
      query="unlock=other-passkey&switch=no-storage"
      steps={[{ tap: 'unlock' }, { tap: 'switch-confirm' }]}
    >
      {@render step('other-no-storage', s.whySend, true)}
    </Shown>
    <Shown preset="passkey-locked" query="unlock=other-passkey" steps={[{ tap: 'unlock' }, { tap: 'switch-confirm' }]}>
      <WalletFrame title={s.frame} coins={false}>
        {#snippet children()}
          {@render step('switched', s.whySend, true)}
        {/snippet}
      </WalletFrame>
    </Shown>
  </Section>

  <Section title="Unlocked">
    <Shown preset="passkey-locked" query="unlock=unlocked" steps={tapUnlock}>
      {@render step('same', s.whySend, true)}
    </Shown>
    <Shown
      preset="passkey-locked"
      query="unlock=unlocked"
      steps={tapUnlock}
      note="a screen that takes the step away the moment the keys are loaded: it is still told"
    >
      {#snippet children(wallet)}
        {#if !wallet.unlocked}
          <Unlock why={s.whySend} promise onunlocked={(how) => (told['taken-away'] = how)} />
        {/if}
        {#if told['taken-away'] !== undefined}
          <p class="text-sm text-ink-500">
            {s.got} <code class="font-mono" data-testid="told-taken-away">{told['taken-away']}</code>
          </p>
        {/if}
      {/snippet}
    </Shown>
    <Shown preset="passkey-locked" query="unlock=tampered" steps={tapUnlock}>
      <WalletFrame title={s.frame} coins={false}>
        {#snippet children()}
          {@render step('tampered', s.whySend, true)}
        {/snippet}
      </WalletFrame>
    </Shown>
  </Section>

  <Section title="With the 12 words">
    <Shown preset="passkey-locked" query="unlock=cancelled" steps={toWords}>
      {@render step('words-open', s.whyWords, false)}
    </Shown>
    <Shown
      preset="passkey-locked"
      query="unlock=cancelled"
      steps={[...toWords, { words: BAD_WORD }, { tap: 'unlock-words-go' }]}
      note="word 7 is not on the list"
    >
      {@render step('words-bad', s.whyWords, false)}
    </Shown>
    <Shown
      preset="passkey-locked"
      query="unlock=cancelled"
      steps={[...toWords, { words: 'abandon ability able about above' }, { tap: 'unlock-words-go' }]}
      note="seven fields are empty"
    >
      {@render step('words-missing', s.whyWords, false)}
    </Shown>
    <Shown
      preset="passkey-locked"
      query="unlock=cancelled"
      steps={[...toWords, { words: BAD_SUM }, { tap: 'unlock-words-go' }]}
      note="the checksum fails"
    >
      {@render step('words-sum', s.whyWords, false)}
    </Shown>
    <Shown
      preset="passkey-locked"
      query="unlock=cancelled"
      steps={[...toWords, { words: OTHER_WORDS }, { tap: 'unlock-words-go' }]}
      note="another wallet's words"
    >
      {@render step('words-other', s.whyWords, false)}
    </Shown>
    <Shown
      preset="passkey-locked"
      query="unlock=cancelled&unlockWords=invalid"
      steps={[...toWords, { words: SAMPLE_WORDS }, { tap: 'unlock-words-go' }]}
      note="the wallet itself answers that the words are not valid"
    >
      {@render step('words-invalid', s.whyWords, false)}
    </Shown>
    <Shown
      preset="passkey-locked"
      query="unlock=cancelled"
      setup={goneAtWords}
      steps={[...toWords, { words: SAMPLE_WORDS }, { tap: 'unlock-words-go' }]}
      note="unlockWithWords answers gone"
    >
      {@render step('words-gone', s.whyWords, false)}
    </Shown>
    <Shown
      preset="passkey-locked"
      query="unlock=cancelled&unlockWords=reload"
      steps={[...toWords, { words: SAMPLE_WORDS }, { tap: 'unlock-words-go' }]}
    >
      {@render step('words-reload', s.whyWords, false)}
    </Shown>
    <Shown
      preset="passkey-locked"
      query="unlock=cancelled&unlockWords=broken"
      steps={[...toWords, { words: SAMPLE_WORDS }, { tap: 'unlock-words-go' }]}
    >
      {@render step('words-broken', s.whyWords, false)}
    </Shown>
    <Shown
      preset="passkey-locked"
      query="unlock=cancelled"
      steps={[...toWords, { words: SAMPLE_WORDS }, { tap: 'unlock-words-go' }]}
      note="the right words"
    >
      {@render step('words-right', s.whyWords, false)}
    </Shown>
  </Section>
</Page>
