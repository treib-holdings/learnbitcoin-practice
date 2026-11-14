<script lang="ts">
  // What a wallet screen shows when the coins are known and there are none:
  // "No coins yet." and the way to get some, a link to the Receive screen,
  // where the faucet is. (Coins and Activity have empty lines of their own.)

  import { router } from '../../lib/router.svelte.ts';
  import { strings } from '../../strings/index.ts';
  import Button from '../Button.svelte';
  import Empty from '../Empty.svelte';

  interface Props {
    class?: string;
    [key: `data-${string}`]: string | undefined;
  }

  let { class: extra = '', ...rest }: Props = $props();

  let t = $derived(strings.wallet[router.lang]);
</script>

<Empty {...rest} text={t.noCoins} class={extra}>
  <Button variant="primary" small href={router.link({ name: 'receive' })}>{t.getCoins}</Button>
</Empty>
