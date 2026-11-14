<script lang="ts">
  // An amount of practice coins: the number, grouped in threes, and the unit
  // "practice sats" after it. An amount never stands without its unit and
  // never beside a price. The one exception is a column whose heading
  // already says "Practice sats": there, pass unit={false}.
  //
  //   headline  the wallet's total
  //   signed    a gain or a loss: "+100,000" or "-30,282"

  import type { HTMLAttributes } from 'svelte/elements';
  import { formatSats } from '../lib/format.ts';
  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';

  interface Props extends Omit<HTMLAttributes<HTMLSpanElement>, 'class' | 'children'> {
    /** In sats. */
    sats: bigint | number;
    headline?: boolean;
    signed?: boolean;
    unit?: boolean;
    class?: string;
  }

  let { sats, headline = false, signed = false, unit = true, class: extra = '', ...rest }: Props = $props();

  let t = $derived(strings.common[router.lang]);
  let amount = $derived(BigInt(sats));
  let digits = $derived((signed && amount > 0n ? '+' : '') + formatSats(amount));
  // "1 practice sat" (and "-1 practice sat"); "practice sats" for every other amount, 0 included.
  let unitText = $derived(amount === 1n || amount === -1n ? t.practiceSat : t.practiceSats);
</script>

<span {...rest} class={extra}
  ><span
    translate="no"
    class={headline ? 'font-mono text-2xl font-bold tabular-nums text-ink-800' : 'font-mono tabular-nums text-ink-800'}
    >{digits}</span
  >{#if unit}{' '}<span
      class={headline
        ? 'whitespace-nowrap font-sans text-sm font-normal text-ink-500'
        : 'whitespace-nowrap font-sans text-xs text-ink-500'}>{unitText}</span
    >{/if}</span
>
