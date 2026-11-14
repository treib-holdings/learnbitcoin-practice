<script lang="ts">
  // The page around every screen: the PRACTICE banner, the header, the
  // screen itself inside <main>, the status region and the footer.
  //
  // <main> carries aria-busy while the screen waits for the wallet, which
  // tells a screen reader that what it holds is still changing. Two things
  // say so: `busy`, which is what the wallet itself publishes (the first
  // look at its coins), and busyWhile() in status.svelte.ts, which a piece
  // wraps around a passkey prompt or the sending of a payment.

  import type { Snippet } from 'svelte';
  import { router } from '../lib/router.svelte.ts';
  import Banner from './Banner.svelte';
  import Footer from './Footer.svelte';
  import Header from './Header.svelte';
  import Status from './Status.svelte';
  import { clearStatus, working } from './status.svelte.ts';

  interface Props {
    busy?: boolean;
    /** The screen. */
    children: Snippet;
  }

  let { busy = false, children }: Props = $props();

  // What the status region said belongs to the screen it was said on.
  $effect(() => {
    void router.path;
    return clearStatus;
  });
</script>

<div class="flex min-h-screen flex-col">
  <Banner />
  <Header />
  <!-- tabindex="-1": "Skip to content" moves focus here. It takes focus from code only, so it shows no outline.
       text-pretty: wherever a paragraph wraps, the browser avoids a last line of one short word. -->
  <main id="main" tabindex="-1" aria-busy={busy || working() ? 'true' : undefined} class="flex-1 text-pretty outline-none">
    {@render children()}
  </main>
  <!-- Outside <main>, so that aria-busy there never holds an announcement back. -->
  <Status />
  <Footer />
</div>
