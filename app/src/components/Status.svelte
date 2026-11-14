<script lang="ts">
  // The screen's one status region: what a screen reader is told when
  // something has happened. The shell renders it once, on every screen, from
  // the first render. It is not drawn: every outcome it speaks also shows on
  // the screen where it happened (the button says "Copied", the total
  // changes). Set its text with announce() from status.svelte.ts.

  import { statusText } from './status.svelte.ts';
</script>

<p role="status" aria-live="polite" data-testid="status" class="sr-only">{statusText()}</p>
