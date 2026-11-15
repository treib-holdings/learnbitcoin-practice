<script lang="ts">
  // A word or two that marks what something is.
  //
  //   practice  the PRACTICE marker beside the logo: outlined orange
  //   stamp     the same marker for paper, where backgrounds are not printed: a dark outline.
  //             With `small` it is the stamp of the practice card, which is made for paper:
  //             its sizes are in points, as every length on that card is, and it is small
  //             enough to stand on one line with the card's title.
  //   kind      what a thing is, as small orange capitals: "Change"
  //   fact      something about it, as small grey capitals: "Unconfirmed"
  //   tag       a filled grey tag, for the rare thing that needs a box

  import type { Snippet } from 'svelte';

  interface Props {
    tone?: 'practice' | 'stamp' | 'kind' | 'fact' | 'tag';
    /** The stamp only: at the size of the practice card's small print. */
    small?: boolean;
    class?: string;
    children: Snippet;
    [key: `data-${string}`]: string | undefined;
  }

  let { tone = 'fact', small = false, class: extra = '', children, ...rest }: Props = $props();

  const LOOK = {
    practice:
      'rounded border border-orange-600 bg-orange-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-widest text-orange-700',
    stamp:
      'inline-block rounded border-2 border-ink-900 px-2 py-0.5 text-sm font-bold uppercase tracking-widest text-ink-900',
    kind: 'text-xs font-semibold uppercase tracking-widest text-orange-600',
    fact: 'text-xs font-semibold uppercase tracking-widest text-ink-500',
    tag: 'rounded bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-ink-500',
  } as const;

  /** The stamp of the practice card: the same look, with every size in points. */
  const SMALL_STAMP =
    'inline-block rounded-[1.5pt] border-[0.75pt] border-ink-900 px-[2pt] py-[0.75pt] text-[5pt] font-bold uppercase leading-[6pt] tracking-widest text-ink-900';
</script>

<span {...rest} class={[tone === 'stamp' && small ? SMALL_STAMP : LOOK[tone], extra]}>{@render children()}</span>
