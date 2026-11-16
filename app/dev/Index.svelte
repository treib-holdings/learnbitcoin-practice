<script lang="ts">
  // The gallery's front page: every screen of the app in every state of the
  // stand-in wallet, as links. Each link loads its page afresh
  // (rel="external"), because the stand-in is made when a page loads.

  import { LANGS, SCREENS, STEPS } from '@learnbitcoin/practice-contract';
  import Page from '../src/components/Page.svelte';
  import Section from '../src/components/Section.svelte';
  import TextLink from '../src/components/TextLink.svelte';
  import { pathFor, type Route } from '../src/lib/router.ts';
  import { FRAME_HASH, GATES_PATH, PIECES_PATH, UNLOCK_PATH, WALLET_PATH } from './pages.ts';
  import { TXID } from './sample.ts';
  import { PRESETS } from './stand-in.svelte.ts';

  /** The state this page itself was loaded in. */
  let { preset }: { preset: string } = $props();

  /** Every screen once, and the step screen once for each of the six steps. */
  const routes: Route[] = SCREENS.flatMap((name): Route[] => {
    if (name === 'tx') return [{ name, txid: TXID.sent }];
    if (name === 'step') return STEPS.map((id) => ({ name, id }));
    return [{ name }];
  });

  /** What a route is listed as: its name, and for a step its ID too. */
  const label = (route: Route): string => (route.name === 'step' ? `step: ${route.id}` : route.name);

  /** The gallery's pages of pieces. Each shows many states at once, each with a stand-in wallet of its own. */
  const PAGES = [
    { path: PIECES_PATH, text: 'Every shared piece in every state' },
    { path: GATES_PATH, text: 'The gates, and each way "Open with my passkey" can end' },
    { path: UNLOCK_PATH, text: 'The unlock step after every answer' },
    { path: WALLET_PATH, text: 'Coins, transactions and the 12 words' },
  ];
</script>

<Page
  eyebrow="Development only"
  title="Gallery"
  lede="Every screen of the practice wallet, in every state of the scripted stand-in wallet. Nothing here talks to a network or stores anything."
>
  <p class="text-sm">
    This page was loaded with <code class="font-mono">state={preset}</code>. The presets and the query keys that say how
    each action ends are listed at the top of <code class="font-mono">app/dev/stand-in.svelte.ts</code>.
  </p>

  <Section title="Pieces">
    <ul class="space-y-1 text-sm">
      {#each PAGES as { path, text } (path)}
        <li>
          {text}:
          {#each LANGS as lang (lang)}
            {' '}<TextLink rel="external" href={(lang === 'en' ? '' : `/${lang}`) + path}>{lang}</TextLink>
          {/each}
        </li>
      {/each}
    </ul>
    <p class="text-sm">
      The wallet frame, with a sample screen in it, is on any wallet route whose address ends in
      <code class="font-mono">{FRAME_HASH}</code>:
      {#each LANGS as lang (lang)}
        {' '}<TextLink rel="external" href="{pathFor({ name: 'receive' }, lang)}?state=funded{FRAME_HASH}">{lang}</TextLink>
      {/each}
    </p>
  </Section>

  {#each Object.keys(PRESETS) as name (name)}
    <Section title={name}>
      <ul class="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {#each routes as route (label(route))}
          <li class="flex items-baseline justify-between gap-3 border-b border-ink-100 py-1">
            <span class="font-semibold text-ink-700">{label(route)}</span>
            <span class="flex gap-3">
              {#each LANGS as lang (lang)}
                <TextLink rel="external" href="{pathFor(route, lang)}?state={name}">{lang}</TextLink>
              {/each}
            </span>
          </li>
        {/each}
      </ul>
    </Section>
  {/each}
</Page>
