<script lang="ts">
  // A QR code, drawn in the page as one SVG path: dark squares on white,
  // with the blank margin a scanner needs. It is never a picture file (the
  // page's security policy allows no "data:" image) and it carries no style.
  //
  // Always show the text itself beside it too, as a Mono value: a code is no
  // use to a screen reader, and a reader on one device cannot scan their own
  // screen.

  import { qrShape } from './qr-path.ts';

  interface Props {
    /** What the code says when scanned. */
    text: string;
    /** What a screen reader says in place of the picture: "QR code of this address". */
    label: string;
    class?: string;
    [key: `data-${string}`]: string | undefined;
  }

  let { text, label, class: extra = '', ...rest }: Props = $props();

  let shape = $derived(qrShape(text));
</script>

<svg
  {...rest}
  viewBox="0 0 {shape.size} {shape.size}"
  role="img"
  aria-label={label}
  shape-rendering="crispEdges"
  class={['h-auto w-full max-w-64 rounded-md border border-ink-100 bg-white text-ink-900', extra]}
>
  <path d={shape.d} fill="currentColor" />
</svg>
