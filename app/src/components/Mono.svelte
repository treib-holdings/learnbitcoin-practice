<script lang="ts">
  // An address, a transaction ID, a key, a wallet fingerprint: anything a
  // reader compares character by character. It is set in the monospace
  // font, wraps wherever the line ends (never cut short with dots), and is
  // marked so that a translating browser leaves it alone. Its lines keep
  // their own height, close together, whatever text the value sits in.
  //
  // A value with no place to break (an address, a transaction ID) breaks
  // anywhere. One that has such places (a host name, at its hyphens) breaks
  // there first, and in the middle of a word only when that word alone is
  // too long for the line.
  //
  //   lead   the one value a screen is about: the receive address
  //   plain  a value among others (the default)
  //   small  a long key or a descriptor

  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLAttributes<HTMLSpanElement>, 'class' | 'children' | 'translate'> {
    value: string;
    size?: 'lead' | 'plain' | 'small';
    class?: string;
  }

  let { value, size = 'plain', class: extra = '', ...rest }: Props = $props();

  const LOOK = {
    lead: 'inline-block max-w-full [overflow-wrap:anywhere] font-mono text-base font-semibold leading-snug text-ink-800',
    plain: 'inline-block max-w-full [overflow-wrap:anywhere] font-mono text-sm leading-snug text-ink-800',
    small: 'inline-block max-w-full [overflow-wrap:anywhere] font-mono text-xs leading-snug text-ink-700',
  } as const;
</script>

<span {...rest} translate="no" class={[LOOK[size], extra]}>{value}</span>
