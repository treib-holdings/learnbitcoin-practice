<script lang="ts">
  // The Settings screen: what the wallet in this browser is, what this
  // browser keeps of it, its public descriptors, and Remove.
  //
  //   The wallet in this browser   how this browser opens it, with a
  //       passkey or without; for a passkey wallet the tag in its
  //       passkey's name, right beside the wallet fingerprint, with a line
  //       on what each is; the day it has been in this browser since; its
  //       first address.
  //   What this browser keeps      the wallet's public key, always, so
  //       anyone who uses this browser can see the wallet; the 12 words
  //       only for a wallet it opens without a passkey; the note of the
  //       "Do it" steps, while there is one, with what it can name and that
  //       it stays when the wallet is removed; and whether the browser
  //       agreed to keep this page's data, where the wallet knows.
  //   Public descriptors           the receive and the change descriptor,
  //       each shown whole and with a copy button: another wallet program
  //       can watch this wallet with them, without the 12 words.
  //   Remove                       a step that asks first (keys/RemoveWallet.svelte).
  //
  // The screen says what this browser holds, never where the wallet came
  // from: the stored record does not know (see strings/settings.ts).
  //
  // Nothing here needs keys, so the screen is the same whether a passkey
  // wallet is locked or not. The lock line and the Lock button are the
  // wallet frame's, as on every wallet screen.

  import Actions from '../components/Actions.svelte';
  import CopyButton from '../components/CopyButton.svelte';
  import Mono from '../components/Mono.svelte';
  import Notice from '../components/Notice.svelte';
  import Prose from '../components/Prose.svelte';
  import Row from '../components/Row.svelte';
  import Rows from '../components/Rows.svelte';
  import Section from '../components/Section.svelte';
  import TextLink from '../components/TextLink.svelte';
  import ReloadButton from '../components/wallet/ReloadButton.svelte';
  import WalletFrame from '../components/wallet/WalletFrame.svelte';
  import { SAFARI_KEEPS_DAYS } from '../components/wallet/frame.ts';
  import { useDoit } from '../lib/doit/doit-context.ts';
  import { fill } from '../lib/format.ts';
  import { router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import { progressKept } from './doit/view.ts';
  import RemoveWallet from './keys/RemoveWallet.svelte';
  import { hereSince, keepsLines } from './keys/settings-flow.ts';

  const wallet = useWallet();
  const doit = useDoit();

  let lang = $derived(router.lang);
  let t = $derived(strings.settings[lang]);
  let d = $derived(strings.doit[lang]);
  let c = $derived(strings.common[lang]);
  let w = $derived(strings.wallet[lang]);

  // The gate in front of every wallet screen draws this one only while a
  // wallet is here, so the record is there. It is still read as one that
  // may be missing, for the moment in which a wallet leaves.
  let record = $derived(wallet.record);

  /** The descriptors need no keys. They are worked out again when another wallet takes this one's place. */
  let descriptors = $derived(record === null ? null : wallet.descriptors());

  /** The lines that say what this browser keeps, for this kind of wallet. */
  let keeps = $derived(record === null ? [] : keepsLines(record.kind, wallet.persisted));
</script>

<!-- One descriptor: its name, the line itself, and a button that copies it.
     The line is shown whole and wraps. The two descriptors differ only near
     their ends, so in a box that cut them off at its edge they would look
     the same. The button says which one it copies. -->
{#snippet descriptor(name: string, text: string, copy: string, said: string, hook: string)}
  <div class="space-y-2">
    <h3 class="text-sm font-semibold text-ink-800">{name}</h3>
    <p class="rounded-md border border-ink-100 bg-ink-50 px-3 py-3">
      <Mono size="small" value={text} data-testid={hook} />
    </p>
    <Actions tight>
      <CopyButton {text} label={copy} {said} data-testid="copy-{hook}" />
    </Actions>
  </div>
{/snippet}

<WalletFrame title={c.section_settings} coins={false}>
  {#snippet children()}
    {#if record !== null}
      <Section title={t.walletTitle}>
        <Rows>
          <Row name={t.kind}>
            <span data-testid="wallet-kind">{record.kind === 'passkey' ? t.kindPasskey : t.kindWords}</span>
          </Row>
          {#if record.kind === 'passkey'}
            <!-- The passkey's tag and the wallet fingerprint stand together: the two things that tell this wallet from another. -->
            <Row name={t.passkeyTag}>
              {#if record.tag !== undefined}
                <Mono value={record.tag} data-testid="passkey-tag" />
              {:else}
                <span data-testid="passkey-tag-unknown">{t.passkeyTagUnknown}</span>
              {/if}
            </Row>
          {/if}
          <Row name={w.walletFingerprint}>
            <Mono value={record.fingerprint} data-testid="wallet-fingerprint" />
          </Row>
          <Row name={t.since}>
            <span data-testid="wallet-since">{hereSince(record.createdAt, lang)}</span>
          </Row>
          <Row name={t.firstAddress}>
            <Mono value={record.firstAddress} data-testid="first-address" />
          </Row>
        </Rows>
        <div class="space-y-2 text-pretty text-sm leading-relaxed text-ink-500">
          {#if record.kind === 'passkey'}
            <p>{record.tag !== undefined ? t.passkeyTagIs : t.passkeyTagUnknownIs}</p>
          {/if}
          <p>{w.walletFingerprintIs}</p>
        </div>
      </Section>

      <Section title={t.keepsTitle}>
        <Prose>
          <!-- A list under the heading: what is kept, one item each. -->
          <ul data-testid="keeps">
            <li data-testid="keeps-public">{t.keepsPublic}</li>
            {#if keeps.includes('words')}
              <li data-testid="keeps-words">{t.keepsWords}</li>
            {:else}
              <li data-testid="keeps-no-words">{t.keepsPasskey}</li>
            {/if}
            <!-- Kept beside the wallet, and not removed with it: listed while there is such a note. -->
            {#if progressKept(doit.read)}
              <li data-testid="keeps-progress">{d.keepsProgress}</li>
            {/if}
          </ul>
          <!-- What the browser said about keeping it, where the wallet knows. -->
          {#if keeps.includes('persisted')}
            <p data-testid="keeps-persisted">{t.keepsPersisted}</p>
          {:else if keeps.includes('not-persisted')}
            <p data-testid="keeps-not-persisted">{fill(t.keepsNotPersisted, { days: String(SAFARI_KEEPS_DAYS) })}</p>
          {/if}
          <!-- All the page says about anything else, in the words it may use. -->
          <p data-testid="keeps-promise">{t.keepsPromise}</p>
        </Prose>
      </Section>

      <Section title={t.descriptorsTitle}>
        <Prose>
          <p>{t.descriptorsWhat} {t.descriptorsUse}</p>
        </Prose>
        {#if descriptors !== null}
          {@render descriptor(t.descriptorReceive, descriptors.receive, t.descriptorReceiveCopy, t.descriptorReceiveCopied, 'descriptor-receive')}
          {@render descriptor(t.descriptorChange, descriptors.change, t.descriptorChangeCopy, t.descriptorChangeCopied, 'descriptor-change')}
        {:else}
          <Notice kind="problem" silent text={t.descriptorsFailed} data-testid="descriptors-failed">
            <ReloadButton />
          </Notice>
        {/if}
        <p class="text-base">
          <TextLink href={router.link({ name: 'sparrow' })}>{c.linkSparrow}</TextLink>
        </p>
      </Section>

      <RemoveWallet />
    {/if}
  {/snippet}
</WalletFrame>
