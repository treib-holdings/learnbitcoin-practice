<script module lang="ts">
  /** One chip. */
  export interface Chip {
    href: string;
    text: string;
    /** This is the screen that is showing. */
    current?: boolean;
  }
</script>

<script lang="ts">
  // A row of links as rounded chips, for the wallet's sections. They wrap
  // onto more lines on a narrow screen: seven section names do not fit one
  // line on a phone, in either language. The chip of the screen that is
  // showing is filled and marked for screen readers.
  //
  // These are the wallet's main way around, and on a phone they are used
  // with a thumb. So the area of each chip that takes a tap is 44 px tall
  // (TAP in styles.ts), taller than the chip looks, and the lines of chips
  // stand 44 px apart, so that the areas of two lines never overlap.
  //
  // Where a reader has told the system to force its own colours (Windows
  // high contrast), a fill and a text colour of ours are thrown away, and
  // the chip of the screen that is showing would look like every other
  // one. So there it takes the system's own colours for something that is
  // selected.

  import { FOCUS, TAP } from './styles.ts';

  interface Props {
    /** What a screen reader calls the group: "Wallet sections". */
    label: string;
    items: Chip[];
    class?: string;
  }

  let { label, items, class: extra = '' }: Props = $props();

  /** 34 px tall. With 10 px between the lines, that is the 44 px a tap area needs. */
  const CHIP = `${TAP} inline-block rounded-full border px-3 py-1.5 text-sm font-semibold transition motion-reduce:transition-none`;

  /** The chip of the screen that is showing. The last four are for forced colours, hover included. */
  const CURRENT =
    'border-ink-800 bg-ink-800 text-white hover:text-white forced-colors:border-[Highlight] forced-colors:bg-[Highlight] forced-colors:text-[color:HighlightText] forced-colors:hover:text-[color:HighlightText]';
</script>

<nav aria-label={label} class={extra}>
  <ul class="flex flex-wrap gap-x-2 gap-y-2.5">
    {#each items as item (item.href)}
      <li>
        <a
          href={item.href}
          aria-current={item.current ? 'page' : undefined}
          class={[
            CHIP,
            FOCUS,
            item.current ? CURRENT : 'border-ink-200 text-ink-700 hover:border-orange-400 hover:text-orange-600',
          ]}>{item.text}</a
        >
      </li>
    {/each}
  </ul>
</nav>
