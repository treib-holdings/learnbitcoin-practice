<script lang="ts">
  // One piece in one state, on a gallery page that shows many.
  //
  // Each block has a stand-in wallet of its own, in the state `preset` names
  // and with the answers `query` scripts: the same words as a page's own
  // query string (see the top of stand-in.svelte.ts). So ten blocks on one
  // page can show one piece after ten different answers. `steps` are played
  // on the block once it is drawn (play.ts), and the line above the block
  // says how to get the same state on a screen of the app.

  import { untrack, type Snippet } from 'svelte';
  import { setWallet } from '../src/lib/wallet-context.ts';
  import { play, type Step } from './play.ts';
  import { fromQuery, makeStandIn, type StandIn } from './stand-in.svelte.ts';

  interface Props {
    /** A preset's name: what ?state= would say. */
    preset?: string;
    /** More of the query string: "unlock=cancelled&passkeys=no". */
    query?: string;
    /** A last change to the stand-in, for what no query key can say. */
    setup?: (wallet: StandIn) => void;
    /** Taps to play once the block is drawn. */
    steps?: readonly Step[];
    /** What the block shows, in a few words, when the line above it should say more than the query. */
    note?: string;
    children: Snippet<[StandIn]>;
  }

  let { preset = 'none', query = '', setup, steps = [], note, children }: Props = $props();

  // The scripted actions answer at once here: a page of many blocks is looked at once, not waited for.
  const made = untrack(() => {
    const asked = fromQuery(`?state=${preset}&delay=0${query === '' ? '' : `&${query}`}`);
    const wallet = makeStandIn(asked.preset, asked.overrides);
    setup?.(wallet);
    return wallet;
  });
  setWallet(made);

  const said = untrack(() =>
    [
      `state=${preset}`,
      query,
      ...steps.map((step) => ('tap' in step ? `tap ${step.tap}` : 'words' in step ? 'type words' : '')),
      note ?? '',
    ]
      .filter((part) => part !== '')
      .join(' | '),
  );

  function start(node: HTMLElement): void {
    const todo = untrack(() => steps);
    if (todo.length > 0) void play(node, todo);
  }
</script>

<section class="space-y-3 border-t border-dashed border-ink-200 pt-4">
  <p class="break-words font-mono text-xs text-ink-500">{said}</p>
  <div {@attach start}>{@render children(made)}</div>
</section>
