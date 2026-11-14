<script lang="ts">
  // A placeholder: the real Restore screen replaces this file.

  import Page from '../components/Page.svelte';
  import TextLink from '../components/TextLink.svelte';
  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';

  let t = $derived(strings.common[router.lang]);
</script>

<Page title={t.screen_restore}>
  <p>{t.notBuiltYet}</p>
  <p><TextLink href={router.link({ name: 'home' })}>{t.screen_home}</TextLink></p>
</Page>
