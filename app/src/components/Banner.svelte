<script lang="ts">
  // The PRACTICE banner: the first thing on every screen. It stays on screen
  // while the page scrolls, so a screenshot taken anywhere says these coins
  // are not real. A phone gets a shorter sentence that fits one line (two,
  // of even length, in Spanish on the narrowest screens).
  //
  // It is a note, not a live region: read once, in order, never announced again.

  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';

  let t = $derived(strings.common[router.lang]);
</script>

<p
  role="note"
  class="sticky top-0 z-40 border-b border-orange-600 bg-orange-400 px-4 py-1.5 text-center text-balance text-sm font-semibold leading-snug text-ink-900"
>
  <span class="md:hidden">{t.markerBannerShort}</span>
  <span class="hidden md:inline">{t.markerBanner}</span>
</p>
