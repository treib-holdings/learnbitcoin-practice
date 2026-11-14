<script lang="ts">
  // The Sparrow page: how to use the practice network from a desktop
  // wallet, in the six steps of SPEC section 12.
  //
  //   1  this needs a computer
  //   2  start Sparrow in Regtest mode, with one command for each system
  //   3  a check before any word is typed
  //   4  the server settings, from this run's settings
  //   5  bring the wallet in: watch only (the safer way), or the 12 words
  //   6  check that the addresses start bcrt1
  //
  // Nobody needs a wallet to read it. Where this browser has one, step 5
  // shows its receive descriptor and links to Settings and to Backup. Where
  // it has none it can use, step 5 says why and gives the way out, and the
  // rest of the page reads the same.
  //
  // The words are in strings/sparrow.ts. The commands, and where each fact
  // about Sparrow was read, are in info/sparrow-guide.ts. A sentence that
  // holds a menu arrow, a label of Sparrow's or a slot is drawn by
  // info/Says.svelte, which keeps each of those whole.

  import { ACCOUNT_PATH } from '@learnbitcoin/practice-wallet';
  import CopyButton from '../components/CopyButton.svelte';
  import Mono from '../components/Mono.svelte';
  import Notice from '../components/Notice.svelte';
  import OutLink from '../components/OutLink.svelte';
  import Page from '../components/Page.svelte';
  import Prose from '../components/Prose.svelte';
  import Row from '../components/Row.svelte';
  import Rows from '../components/Rows.svelte';
  import Section from '../components/Section.svelte';
  import TextLink from '../components/TextLink.svelte';
  import ReloadButton from '../components/wallet/ReloadButton.svelte';
  import { router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import CopyBlock from './info/CopyBlock.svelte';
  import Says from './info/Says.svelte';
  import { REGTEST_FLAG, SPARROW_DOWNLOAD_URL, START_COMMANDS, walletNote, type System } from './info/sparrow-guide.ts';

  const wallet = useWallet();

  let t = $derived(strings.sparrow[router.lang]);
  let errors = $derived(strings.errors[router.lang]);

  /** The name of each command: the system, and where the command is typed. */
  let systems = $derived<Record<System, string>>({
    macos: t.startMac,
    windows: t.startWindows,
    linux: t.startLinux,
  });

  /** Why step 5 cannot link into this browser's wallet, or null when a wallet is here. */
  let note = $derived(walletNote(wallet.status));

  // The receive descriptor of the wallet in this browser. Sparrow reads the
  // change addresses from the same key, so this one line is all it needs.
  // The record is read here so that the line follows the wallet: another
  // tab can swap one wallet for another while this page is open.
  let descriptor = $derived(
    wallet.status === 'ready' && wallet.record !== null ? (wallet.descriptors()?.receive ?? null) : null,
  );

  /** A page that exists in English only says so to a browser, as its link's words say so to a Spanish reader. */
  let english = $derived(router.lang === 'en' ? undefined : 'en');

  /** The heading of a part of a step: the main site's h3 inside running text. */
  const SUBHEAD = 'text-balance text-xl font-bold text-ink-800';
  /**
   * A part of a step under a heading of its own. Its paragraphs stand as far
   * apart as those of running text, and the room above its heading is twice
   * the room between two parts of a section, so the heading goes with what
   * follows it.
   */
  const PART = 'space-y-5 pt-4';
  /**
   * A value with its copy button: one under the other on a phone, side by
   * side from a wider screen. The row may wrap: when the browser refuses to
   * copy, the button's line about that takes a line of its own under the
   * two, and the value keeps its width. Without the wrap that line would
   * squeeze the value, and a port would be drawn in two halves at the very
   * moment the reader is told to select it by hand.
   */
  const VALUE = 'flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3';
  /** A sentence that stands by itself, outside a run of paragraphs. */
  const LINE = 'text-pretty leading-relaxed text-ink-700';
</script>

<Page title={t.title} titleName={t.name} lede={t.lede}>
  <Prose>
    <p>{t.example}</p>
    {#if router.lang === 'es'}
      <p>{t.interfaceEnglish}</p>
    {/if}
  </Prose>

  <Section title={t.computerTitle}>
    <Prose>
      <p>{t.computerBody}</p>
      <p>{t.computerGet}</p>
      <p>
        <OutLink href={SPARROW_DOWNLOAD_URL} hreflang={english} data-testid="sparrow-download"
          >{t.computerGetLink}</OutLink
        >
      </p>
    </Prose>
  </Section>

  <Section title={t.startTitle}>
    <Prose>
      <p>{t.startBody}</p>
    </Prose>
    <Notice kind="caution" data-testid="sparrow-no-menu"><p><Says text={t.startMenu} /></p></Notice>
    <Prose>
      <p data-testid="sparrow-start-how"><Says text={t.startHow} slots={{ flag: REGTEST_FLAG }} /></p>
    </Prose>
    {#each START_COMMANDS as each (each.system)}
      <CopyBlock
        label={systems[each.system]}
        text={each.command}
        copyLabel={t.copyCommand}
        said={t.saidCommand}
        note={each.proof === 'ran' ? t.startRan : t.startDocumented}
        wrap
        hook={`sparrow-${each.system}`}
      />
    {/each}
    <Prose>
      <p><Says text={t.startOther} slots={{ flag: REGTEST_FLAG }} /></p>
      <p>{t.startApart}</p>
    </Prose>
  </Section>

  <Section title={t.checkTitle}>
    <Prose>
      <p><Says text={t.checkBody} /></p>
      <p>{t.checkStop}</p>
      <p>{t.checkSure}</p>
    </Prose>
  </Section>

  <Section title={t.serverTitle}>
    <Prose>
      <p><Says text={t.serverBody} /></p>
    </Prose>
    <Rows>
      <Row name={t.serverHost}>
        <div class={VALUE}>
          <Mono value={wallet.config.electrumHost} data-testid="sparrow-host" />
          <CopyButton
            text={wallet.config.electrumHost}
            label={t.copyHost}
            said={t.saidHost}
            data-testid="sparrow-host-copy"
          />
        </div>
      </Row>
      <Row name={t.serverPort}>
        <div class={VALUE}>
          <Mono value={String(wallet.config.electrumPort)} data-testid="sparrow-port" />
          <CopyButton
            text={String(wallet.config.electrumPort)}
            label={t.copyPort}
            said={t.saidPort}
            data-testid="sparrow-port-copy"
          />
        </div>
      </Row>
      <Row name={t.serverSsl} data-testid="sparrow-ssl">{t.serverSslOn}</Row>
    </Rows>
    <Prose>
      <p><Says text={t.serverTest} /></p>
      <p>{t.serverSees}</p>
    </Prose>
  </Section>

  <Section title={t.bringTitle}>
    <Prose>
      <p>{t.bringBody}</p>
    </Prose>

    <!-- No wallet here that this page can use: the cause, then the way out.
         Each is already so when the screen opens, so none is announced. -->
    {#if note === 'none'}
      <Notice kind="info" text={t.needNone} data-testid="sparrow-need-wallet" data-state={note}>
        <TextLink href={router.link({ name: 'home' })} data-testid="sparrow-need-link">{t.needNoneLink}</TextLink>
      </Notice>
    {:else if note === 'unreadable'}
      <Notice kind="info" text={t.needUnreadable} data-testid="sparrow-need-wallet" data-state={note}>
        <TextLink href={router.link({ name: 'wallet' })} data-testid="sparrow-need-link"
          >{t.needUnreadableLink}</TextLink
        >
      </Notice>
    {:else if note === 'newer'}
      <Notice kind="info" text={t.needNewer} data-testid="sparrow-need-wallet" data-state={note}>
        <ReloadButton data-testid="sparrow-need-reload" />
      </Notice>
    {:else if note === 'broken'}
      <Notice kind="problem" silent text={errors.passkey_broken} data-testid="sparrow-need-wallet" data-state={note} />
    {/if}

    <div class={PART}>
      <h3 class={SUBHEAD}>{t.watchTitle}</h3>
      <Prose>
        <p>{t.watchBody}</p>
      </Prose>
      {#if note === null}
        {#if descriptor !== null}
          <CopyBlock
            label={t.watchLabel}
            text={descriptor}
            copyLabel={t.copyDescriptor}
            said={t.saidDescriptor}
            hook="sparrow-descriptor"
          />
          <p class={LINE}>
            {t.watchSettings}
            <TextLink href={router.link({ name: 'settings' })} data-testid="sparrow-settings-link"
              >{t.watchSettingsLink}</TextLink
            >
          </p>
        {:else}
          <!-- The wallet is here and its descriptor could not be worked out.
               Settings could not show it either, so no link leads there. It
               is so when the screen opens, so it is not announced. -->
          <Notice kind="problem" silent text={t.watchFailed} data-testid="sparrow-no-descriptor" />
        {/if}
      {/if}
      <Prose>
        <p>{t.inSparrow}</p>
        <ol data-testid="sparrow-watch-steps">
          <li><Says text={t.watchOpen} /></li>
          <li><Says text={t.watchEdit} /></li>
          <li><Says text={t.watchPut} /></li>
          <li><Says text={t.watchApply} /></li>
        </ol>
        <p>{t.watchChange}</p>
      </Prose>
    </div>

    <div class={PART}>
      <h3 class={SUBHEAD}>{t.wordsTitle}</h3>
      <Prose>
        <p>{t.wordsBody}</p>
        <p>{t.inSparrow}</p>
        <ol data-testid="sparrow-words-steps">
          <li><Says text={t.wordsChoose} /></li>
          <li><Says text={t.wordsKind} /></li>
          <li><Says text={t.wordsCount} /></li>
          <li><Says text={t.wordsType} /></li>
          <li data-testid="sparrow-path"><Says text={t.wordsPath} slots={{ path: ACCOUNT_PATH }} /></li>
          <li><Says text={t.wordsFinish} /></li>
        </ol>
      </Prose>
      <Notice kind="caution" text={t.wordsException} data-testid="sparrow-words-exception" />
      {#if note === null}
        <p class={LINE}>
          {t.wordsBackup}
          <TextLink href={router.link({ name: 'backup' })} data-testid="sparrow-backup-link"
            >{t.wordsBackupLink}</TextLink
          >
        </p>
      {/if}
    </div>
  </Section>

  <Section title={t.addressesTitle}>
    <Prose>
      <p><Says text={t.addressesBody} /></p>
      <p data-testid="sparrow-practice-network">{t.addressesGood}</p>
    </Prose>
    <Notice kind="caution">
      <p class="font-semibold text-ink-800" data-testid="sparrow-real-network">{t.addressesReal}</p>
      <p class="mt-2">{t.addressesWhy}</p>
    </Notice>
    <Prose>
      <p data-testid="sparrow-test-network">{t.addressesTest}</p>
    </Prose>
  </Section>
</Page>
