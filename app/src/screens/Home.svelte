<script lang="ts">
  // A placeholder: the real Home screen replaces this file.
  //
  // Until then it is the way around the app: a link to every screen.

  import Page from '../components/Page.svelte';
  import TextLink from '../components/TextLink.svelte';
  import { router } from '../lib/router.svelte.ts';
  import type { Route } from '../lib/router.ts';
  import { strings } from '../strings/index.ts';

  let t = $derived(strings.common[router.lang]);

  /** A transaction to link to, so that the transaction screen can be reached from here. */
  const SAMPLE_TXID = '5a08b9a18ac03ba34f0413f71cbd22b215e4b087f44d0d83251688a0bffe1177';

  let links = $derived<{ route: Route; text: string }[]>([
    { route: { name: 'new' }, text: t.screen_new },
    { route: { name: 'restore' }, text: t.screen_restore },
    { route: { name: 'sparrow' }, text: t.linkSparrow },
    { route: { name: 'about' }, text: t.linkAbout },
    { route: { name: 'wallet' }, text: t.section_wallet },
    { route: { name: 'coins' }, text: t.section_coins },
    { route: { name: 'receive' }, text: t.section_receive },
    { route: { name: 'send' }, text: t.section_send },
    { route: { name: 'activity' }, text: t.section_activity },
    { route: { name: 'tx', txid: SAMPLE_TXID }, text: t.screen_tx },
    { route: { name: 'backup' }, text: t.section_backup },
    { route: { name: 'settings' }, text: t.section_settings },
    { route: { name: 'not-found' }, text: t.notFoundTitle },
  ]);
</script>

<Page title={t.appName} documentTitle={t.homeTitle}>
  <p>{t.notBuiltYet}</p>
  <ul class="space-y-2">
    {#each links as link (link.route.name)}
      <li><TextLink href={router.link(link.route)}>{link.text}</TextLink></li>
    {/each}
  </ul>
</Page>
