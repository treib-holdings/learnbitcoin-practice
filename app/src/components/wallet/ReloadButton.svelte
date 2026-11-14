<script lang="ts">
  // A button that loads the page afresh. For the states only a fresh page
  // gets out of: what is stored cannot be read, the page is out of date, the
  // bot check has loaded, the wallet changed in another tab.

  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import Button from '../Button.svelte';

  interface Props {
    variant?: 'primary' | 'secondary' | 'quiet';
    class?: string;
    [key: `data-${string}`]: string | undefined;
  }

  let { variant = 'secondary', class: extra = '', ...rest }: Props = $props();

  let c = $derived(strings.common[router.lang]);
</script>

<Button {...rest} {variant} class={extra} onclick={() => location.reload()}>{c.reload}</Button>
