<script lang="ts">
  // The frame of every screen: the reading column, the heading and the
  // document title.
  //
  // Each screen is one Page. `title` is the screen's h1, the only one, and
  // the router moves keyboard focus to it when the screen opens. The same
  // text names the screen in the document title, which always starts with
  // the PRACTICE word, so a tab, a bookmark and the history list carry the
  // marker too. A step that swaps in place (the review of a payment, "sent")
  // changes `title`, awaits tick() and calls focusHeading().
  //
  // What is inside the tags is laid out in a column with the same space
  // between its parts. Wrap things that belong together in one element (a
  // Card, a Section, a div) and space them inside it.
  //
  // On a phone the column starts closer to the header, and the heading
  // closer to what stands above it, than on a wider screen: a small screen
  // has little room, and what the screen is for should be on it without
  // scrolling.

  import type { Snippet } from 'svelte';
  import { fill } from '../lib/format.ts';
  import { router } from '../lib/router.svelte.ts';
  import { strings } from '../strings/index.ts';

  interface Props {
    /** The screen's heading. */
    title: string;
    /**
     * A test hook (data-testid) for the heading, on the one kind of screen
     * whose scenarios read it by name: a "Do it" step, whose heading is the
     * step's title.
     */
    titleHook?: string;
    /** The screen's name in the document title, when it should differ from the heading. */
    titleName?: string;
    /**
     * The whole document title, for the one screen whose title is fixed:
     * Home (homeTitle in strings/common.ts). It must start with the PRACTICE word.
     */
    documentTitle?: string;
    /** The small orange line above the heading. */
    eyebrow?: string;
    /** One or two sentences under the heading that say what the screen is for. */
    lede?: string;
    /** What stands above the heading on this screen, such as the wallet's section links. */
    above?: Snippet;
    children?: Snippet;
  }

  let { title, titleHook, titleName, documentTitle, eyebrow, lede, above, children }: Props = $props();

  let t = $derived(strings.common[router.lang]);
</script>

<svelte:head>
  <title>{documentTitle ?? fill(t.markerTitle, { screen: titleName ?? title })}</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-6 py-10 md:py-16">
  {#if above}
    <div class="mb-6 md:mb-10">{@render above()}</div>
  {/if}
  {#if eyebrow}
    <p class="mb-3 text-sm font-semibold uppercase tracking-widest text-orange-600">{eyebrow}</p>
  {/if}
  <!-- tabindex="-1": the heading takes focus from code only, never from the Tab key, so it shows no outline. -->
  <h1
    tabindex="-1"
    data-testid={titleHook}
    class="break-words text-balance text-4xl font-bold leading-tight tracking-tight outline-none md:text-5xl"
  >
    {title}
  </h1>
  {#if lede}
    <p class="mt-6 text-pretty text-xl text-ink-500">{lede}</p>
  {/if}
  {#if children}
    <div class="mt-10 space-y-8">{@render children()}</div>
  {/if}
</div>
