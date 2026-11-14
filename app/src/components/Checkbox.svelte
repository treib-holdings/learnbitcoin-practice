<script lang="ts">
  // A checkbox with its sentence. The sentence is the label: a tap on it
  // ticks the box. Use it where the reader must say they have read or done
  // something before the next step opens.

  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { FOCUS } from './styles.ts';

  interface Props extends Omit<HTMLInputAttributes, 'class' | 'checked' | 'type' | 'children'> {
    /** Two-way: write bind:checked. */
    checked?: boolean;
    class?: string;
    /** The sentence beside the box. */
    children: Snippet;
  }

  let { checked = $bindable(false), class: extra = '', children, ...rest }: Props = $props();
</script>

<label class={['flex items-start gap-3 text-pretty text-base text-ink-700', extra]}>
  <input {...rest} bind:checked type="checkbox" class={['mt-1 h-5 w-5 shrink-0 accent-orange-400', FOCUS]} />
  <span>{@render children()}</span>
</label>
