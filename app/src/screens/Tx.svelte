<script lang="ts">
  // A placeholder: the real screen for one transaction replaces this file.

  import Mono from '../components/Mono.svelte';
  import Page from '../components/Page.svelte';
  import TextLink from '../components/TextLink.svelte';
  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';

  let t = $derived(strings.common[router.lang]);

  // The transaction's ID is part of the address: /wallet/tx/<64 hex characters>.
  let txid = $derived(router.route.name === 'tx' ? router.route.txid : '');
</script>

<Page title={t.screen_tx}>
  <p>{t.notBuiltYet}</p>
  <p><Mono value={txid} /></p>
  <p><TextLink href={router.link({ name: 'home' })}>{t.screen_home}</TextLink></p>
</Page>
