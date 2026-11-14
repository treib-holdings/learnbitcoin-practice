<script lang="ts">
  // A command or another line a reader types or pastes somewhere else: how
  // to start Sparrow in Regtest mode, a descriptor. Dark, monospace, never
  // translated. A long line scrolls sideways inside the block (the one place
  // the app scrolls sideways), and the block takes keyboard focus so that it
  // can be scrolled with the arrow keys. `label` names it for a screen reader.

  import { FOCUS } from './styles.ts';

  interface Props {
    text: string;
    label: string;
    class?: string;
    [key: `data-${string}`]: string | undefined;
  }

  let { text, label, class: extra = '', ...rest }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<pre
  {...rest}
  tabindex="0"
  role="region"
  aria-label={label}
  translate="no"
  class={[
    'overflow-x-auto overscroll-x-contain rounded-md bg-[#24292e] p-4 font-mono text-sm leading-[1.6] text-[#e1e4e8]',
    FOCUS,
    extra,
  ]}><code>{text}</code></pre>
