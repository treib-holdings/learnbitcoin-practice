<script lang="ts">
  // A word or two that marks what something is.
  //
  //   practice  the PRACTICE marker beside the logo: outlined orange
  //   stamp     the same marker for paper, where backgrounds are not printed: a dark outline
  //   kind      what a thing is, as small orange capitals: "Change"
  //   fact      something about it, as small grey capitals: "Unconfirmed"
  //   tag       a filled grey tag, for the rare thing that needs a box

  import type { Snippet } from 'svelte';

  interface Props {
    tone?: 'practice' | 'stamp' | 'kind' | 'fact' | 'tag';
    class?: string;
    children: Snippet;
    [key: `data-${string}`]: string | undefined;
  }

  let { tone = 'fact', class: extra = '', children, ...rest }: Props = $props();

  const LOOK = {
    practice:
      'rounded border border-orange-600 bg-orange-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-widest text-orange-700',
    stamp:
      'inline-block rounded border-2 border-ink-900 px-2 py-0.5 text-sm font-bold uppercase tracking-widest text-ink-900',
    kind: 'text-xs font-semibold uppercase tracking-widest text-orange-600',
    fact: 'text-xs font-semibold uppercase tracking-widest text-ink-500',
    tag: 'rounded bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-ink-500',
  } as const;
</script>

<span {...rest} class={[LOOK[tone], extra]}>{@render children()}</span>
