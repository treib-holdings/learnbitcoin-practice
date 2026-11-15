<script lang="ts">
  // The About page: what this is and who runs it, the practice network's
  // facts, and then, in short sections, what this browser keeps, what our
  // server sees and writes down, what is counted, and what the faucet's bot
  // check does.
  //
  // Every sentence about what is stored, sent or seen is a claim about the
  // code (strings/about.ts says which file each rests on). Three things on
  // the page are not sentences but this run's own state, read from the
  // wallet:
  //
  //   - the network's facts come from the wallet's settings (info/facts.ts),
  //     with a line under the faucet's amount while the faucet is closed;
  //   - "In this browser right now" says what is stored here at this moment;
  //   - the list of what is counted is the contract's list of events, and
  //     the line above it says whether counting is switched on.
  //
  // The two lines that can say "off" (counting, the faucet) wait for the
  // wallet's word on the server's settings (wallet.settings). The page is
  // first drawn with the built-in ones, which say "off" to both, and the
  // server's may say the opposite a moment later. Whether this page counts
  // is settled once that request has ended, either way: with no settings
  // from the server nothing is counted. That the faucet is closed is the
  // server's to say, so that line is drawn only from settings that arrived.
  //
  // Nobody needs a wallet to read it.

  import Card from '../components/Card.svelte';
  import Mono from '../components/Mono.svelte';
  import Notice from '../components/Notice.svelte';
  import OutLink from '../components/OutLink.svelte';
  import Page from '../components/Page.svelte';
  import Prose from '../components/Prose.svelte';
  import Row from '../components/Row.svelte';
  import Rows from '../components/Rows.svelte';
  import Section from '../components/Section.svelte';
  import TextLink from '../components/TextLink.svelte';
  import { siteHome } from '../components/text.ts';
  import { router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import {
    KEPT_KEYS,
    blocksText,
    countedEvents,
    faucetClosed,
    faucetText,
    keptNow,
    linkText,
  } from './info/facts.ts';

  const wallet = useWallet();

  let t = $derived(strings.about[router.lang]);
  let c = $derived(strings.common[router.lang]);

  /** What this browser holds for the page at this moment. */
  let kept = $derived(keptNow(wallet.status, wallet.record));

  /** Whether the settings say that events are wanted. While they do not, the app sends none. */
  let counting = $derived(wallet.config.events);

  /** False while the request for the server's settings is still out: what the page counts may yet change. */
  let settled = $derived(wallet.settings !== 'loading');
  /** True when the settings on screen are the server's own. Only those can say that the faucet is closed. */
  let fromServer = $derived(wallet.settings === 'loaded');

  /** A page that exists in English only says so to a browser, as its link's words say so to a Spanish reader. */
  let english = $derived(router.lang === 'en' ? undefined : 'en');
</script>

<Page title={t.title} titleName={c.linkAbout} lede={t.lede}>
  <Card tone="grey" title={t.shortTitle}>
    <div class="space-y-3 text-pretty leading-relaxed text-ink-700">
      <p class="font-semibold text-ink-800" data-testid="about-short">{t.shortBody}</p>
      <p>{t.shortRest}</p>
    </div>
  </Card>

  <Section title={t.whatTitle}>
    <Prose>
      <p>{t.whatBody}</p>
      <p>{t.whatWho}</p>
      <p>{t.whatHot}</p>
      <p>
        <OutLink href={siteHome(wallet.config.siteUrl, router.lang)} text={t.whatSiteLink} data-testid="about-site" />
      </p>
    </Prose>
  </Section>

  <Section title={t.netTitle}>
    <Prose>
      <p>{t.netBody}</p>
    </Prose>
    <Rows>
      <Row name={t.netBlocks} data-testid="about-blocks">{blocksText(wallet.config, router.lang)}</Row>
      <Row name={t.netFaucet} data-testid="about-faucet">
        {faucetText(wallet.config, router.lang)}
        {#if fromServer && faucetClosed(wallet.config)}
          <span class="mt-1 block font-semibold" data-testid="about-faucet-off">{t.netFaucetOff}</span>
        {/if}
      </Row>
      <Row name={t.netExplorer}>
        <OutLink href={wallet.config.explorerUrl} class="break-all" data-testid="about-explorer"
          >{linkText(wallet.config.explorerUrl)}</OutLink
        >
      </Row>
      <Row name={t.netElectrum}>
        <Mono value={wallet.config.electrumHost} data-testid="about-electrum-host" />
      </Row>
      <Row name={t.netElectrumPort}>
        <Mono value={String(wallet.config.electrumPort)} data-testid="about-electrum-port" />
      </Row>
    </Rows>
    <p class="text-pretty leading-relaxed text-ink-700">
      <TextLink href={router.link({ name: 'sparrow' })} data-testid="about-sparrow">{t.netSparrowLink}</TextLink>
    </p>
  </Section>

  <Section title={t.keepTitle}>
    <Prose>
      <p>{t.keepBody}</p>
      <ul>
        <li>{t.keepPublic}</li>
        <li>{t.keepPasskey}</li>
        <li>{t.keepWords}</li>
      </ul>
      <p data-testid="about-kept-so">{t.keepSo}</p>
    </Prose>
    {#if kept !== null}
      <Notice kind="info" label={t.keepNowLabel} text={t[KEPT_KEYS[kept]]} data-testid="about-kept-now" data-kept={kept} />
    {/if}
  </Section>

  <Section title={t.passkeyTitle}>
    <Prose>
      <p>{t.passkeyBody}</p>
      <p data-testid="about-passkey-restored">{t.passkeyRestored}</p>
      <p>{t.passkeyWhere}</p>
    </Prose>
  </Section>

  <Section title={t.serverTitle}>
    <Prose>
      <p>{t.serverBody}</p>
      <p>{t.serverLimit}</p>
      <p>{t.serverLog}</p>
      <p>{t.serverCloudflare}</p>
    </Prose>
  </Section>

  <Section title={t.countTitle}>
    <Prose>
      <p>{t.countBody}</p>
      {#if settled}
        <p data-testid="about-counting" data-counting={counting ? 'on' : 'off'}>
          <strong>{counting ? t.countOn : t.countOff}</strong>
        </p>
      {/if}
      <ul>
        {#each countedEvents(router.lang) as each (each.name)}
          <li data-testid="about-count" data-event={each.name}>
            <!-- The name as it is sent, on a line of its own. -->
            <span class="block"><Mono value={each.name} class="font-semibold" /></span>
            {each.text}
          </li>
        {/each}
      </ul>
      <p>{t.countNames}</p>
      <p>{t.countSent}</p>
    </Prose>
  </Section>

  <Section title={t.botTitle}>
    <Prose>
      <p>{t.botBody}</p>
      <p>{t.botSees}</p>
      <p data-testid="about-bot-reads">{t.botReads}</p>
      <p data-testid="about-bot-passkey">{t.botPasskey}</p>
      <p data-testid="about-bot-still">{t.botPasskeyStill}</p>
      <p>{t.botWords}</p>
    </Prose>
  </Section>

  <Section title={t.codeTitle}>
    <Prose>
      <p>{t.codeBody}</p>
      <p>
        <OutLink href={wallet.config.sourceUrl} hreflang={english} text={t.codeLink} data-testid="about-source" />
      </p>
    </Prose>
  </Section>
</Page>
