<script lang="ts">
  // The header: the logo with the PRACTICE badge (a link to Home), the links
  // to About, to the Sparrow page and to the practice network's block
  // explorer, and the language switch.
  //
  // On a phone only the language switch stays here; About, the Sparrow page
  // and the explorer are in the footer on every screen. The header does not stay on
  // screen while the page scrolls: only the banner above it does.

  import { pathInLang } from '../lib/navigation.ts';
  import { router } from '../lib/router.svelte.ts';
  import type { Lang, Route } from '../lib/router.ts';
  import { useWallet } from '../lib/wallet-context.ts';
  import { strings } from '../strings/index.ts';
  import Badge from './Badge.svelte';
  import OutLink from './OutLink.svelte';
  import { FOCUS, TAP } from './styles.ts';

  // The explorer's address comes from the wallet's settings, so a local run can point somewhere else.
  const wallet = useWallet();

  let t = $derived(strings.common[router.lang]);

  // The switch is one plain link to the same screen in the other language.
  // Its text is that language's own name. Nothing is stored or guessed.
  let other = $derived<Lang>(router.lang === 'en' ? 'es' : 'en');
  let switchHref = $derived(pathInLang(router.path, other) + router.search);

  const LINK = `inline-flex items-center transition-colors motion-reduce:transition-none ${FOCUS}`;
  /**
   * The link of the screen that is showing, and every other link. The first
   * is underlined as well as orange: the two colours are too close to tell
   * apart by themselves, and a mark made of colour alone is lost on anyone
   * who does not see it.
   */
  const HERE = 'text-orange-600 underline underline-offset-4';
  const ELSEWHERE = 'text-ink-500 hover:text-orange-600';

  let links = $derived(
    (['about', 'sparrow'] as const).map((name) => {
      const route: Route = { name };
      return {
        href: router.link(route),
        text: name === 'about' ? t.linkAbout : t.linkSparrow,
        current: router.route.name === name,
      };
    }),
  );
</script>

<header class="relative z-30 border-b border-ink-100 bg-white">
  <!-- The first Tab stop of every screen. It shows only while it has focus. -->
  <a
    href="#main"
    class={[
      'sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-ink-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white',
      FOCUS,
    ]}>{t.skipToContent}</a
  >
  <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-5">
    <a
      href={router.link({ name: 'home' })}
      aria-label={t.homeLabel}
      class={['flex shrink-0 items-center gap-3 rounded-sm', FOCUS]}
    >
      <!-- The logo is a file shown through <img>, never pasted into the page:
           it carries a small picture inside, which the page's security policy
           would refuse if the SVG were part of this document. -->
      <img src="/logo.svg" alt={t.siteName} width="152" height="28" class="h-7 w-auto" />
      <Badge tone="practice">{t.markerBadge}</Badge>
    </a>
    <!-- ml-auto: on a screen so narrow that the links wrap under the logo, they stay at the right edge. -->
    <nav aria-label={t.navMain} class="ml-auto">
      <ul class="flex items-center gap-5 text-sm font-medium">
        {#each links as link (link.href)}
          <li class="hidden md:block">
            <a
              href={link.href}
              aria-current={link.current ? 'page' : undefined}
              class={[LINK, link.current ? HERE : ELSEWHERE]}>{link.text}</a
            >
          </li>
        {/each}
        <!-- The explorer is another site. It opens in a tab of its own, and the small arrow says so. -->
        <li class="hidden md:block">
          <OutLink
            plain
            href={wallet.config.explorerUrl}
            text={t.linkExplorer}
            data-testid="header-explorer"
            class={`transition-colors motion-reduce:transition-none ${ELSEWHERE}`}
          />
        </li>
        <li>
          <!-- TAP: on a phone this is the header's one link, and 20 px of text is a small thing to hit. -->
          <a href={switchHref} lang={other} hreflang={other} data-testid="lang-switch" class={[TAP, LINK, ELSEWHERE]}
            >{strings.common[other].languageName}</a
          >
        </li>
      </ul>
    </nav>
  </div>
</header>
