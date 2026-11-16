<script lang="ts">
  // The footer: what this place is, the ways out (the main site, About, the
  // Sparrow page, the practice network's block explorer, the source code)
  // and one line of small print. On Spanish
  // pages the small print says, as on the main site, that the translation
  // was made with AI help and has not been reviewed by a person yet.
  //
  // The addresses of the main site and of the source come from the
  // wallet's settings, so a local run can point somewhere else.
  //
  // A Spanish page links to the main site's Spanish home page. The source
  // code has no Spanish page, so there the link says "(in English)" in its
  // text and carries hreflang="en", as the main site does for a page it has
  // in English only.
  //
  // On a phone the footer starts closer to the screen's last line than on a
  // wider screen. A small screen has little room, and a footer that is
  // nearly as tall as the screen pushes the end of the screen's content up
  // under the PRACTICE banner when the page is scrolled to its end: with
  // less empty room above the footer, the last button of a screen stays
  // clear of the banner there (measured on a 320 by 568 phone in Spanish,
  // where the banner takes two lines).

  import { router } from '../lib/router.svelte.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import OutLink from './OutLink.svelte';
  import { QUIET_LINK } from './styles.ts';
  import { siteHome } from './text.ts';

  const wallet = useWallet();

  let t = $derived(strings.common[router.lang]);
</script>

<footer class="mt-12 border-t border-ink-100 bg-ink-50 md:mt-24">
  <div class="mx-auto max-w-6xl px-6 py-12 text-pretty text-sm text-ink-500">
    <div class="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
      <div class="max-w-md">
        <p class="font-medium text-ink-700">{t.footerMotto}</p>
        <p class="mt-2">{t.footerAbout}</p>
      </div>
      <nav aria-label={t.navFooter}>
        <ul class="flex flex-wrap items-center gap-x-5 gap-y-2">
          <li><OutLink quiet href={siteHome(wallet.config.siteUrl, router.lang)} text={t.linkSite} /></li>
          <li><a href={router.link({ name: 'about' })} class={QUIET_LINK}>{t.linkAbout}</a></li>
          <li><a href={router.link({ name: 'sparrow' })} class={QUIET_LINK}>{t.linkSparrow}</a></li>
          <li><OutLink quiet href={wallet.config.explorerUrl} text={t.linkExplorer} data-testid="footer-explorer" /></li>
          <li>
            <OutLink quiet href={wallet.config.sourceUrl} hreflang={router.lang === 'en' ? undefined : 'en'} text={t.linkSource} />
          </li>
        </ul>
      </nav>
    </div>
    <p class="mt-8 text-xs text-ink-500">
      {t.footerPromise}
      {#if router.lang === 'es'}{t.footerTranslation}{/if}
    </p>
  </div>
</footer>
