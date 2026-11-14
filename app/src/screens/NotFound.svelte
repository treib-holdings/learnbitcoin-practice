<script lang="ts">
  // What shows for an address that is no screen of the app: a mistyped
  // link, or a path kept for a later phase.

  import Button from '../components/Button.svelte';
  import Page from '../components/Page.svelte';
  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';

  let t = $derived(strings.common[router.lang]);
</script>

<Page title={t.notFoundTitle} lede={t.notFoundBody}>
  <Button variant="primary" href={router.link({ name: 'home' })}>{t.notFoundHome}</Button>
</Page>
