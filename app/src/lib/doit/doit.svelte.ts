// The "Do it" steps as the screens see them: makeDoit() builds the one
// object that satisfies Doit (doit-context.ts).
//
// Nothing is decided here. The rules are in the plain modules beside this
// one, which node --test runs: what a step is (steps.ts), how its note is
// kept (progress.ts), where it stands (judge.ts), what follows from a
// change (advance.ts) and the runner that calls them at every change
// (runner.ts). This file does three small things for the runner:
//
//   1. It hands it the page: the storage, the wallet, the clock, the
//      counter, and whether the tab is in view.
//   2. It calls it whenever something the world is made of changes: any
//      property of the wallet that a step looks at (an effect follows
//      them, and runs in the same task as the change), the stored note
//      when another tab writes it, and the tab coming back into view. The
//      change of screen is App.svelte's to tell (watch).
//   3. It copies what the runner publishes into Svelte state, so that a
//      screen that reads `doit.progress` in its markup follows the note.
//
// It is made once, in main.ts, before the app is drawn, and lives for the
// whole page: a payment sent on the Send screen has to be seen by the step
// that waits for it, whichever screen is open. Only main.ts imports this
// file. Screens get the object through useDoit().

import { untrack } from 'svelte';
import type { WalletApi } from '../wallet-api.ts';
import type { Doit } from './doit-context.ts';
import { judge, walletFacts, type Seen } from './judge.ts';
import { PROGRESS_KEY } from './progress.ts';
import { makeRunner, type Shown } from './runner.ts';
import type { StepId } from './steps.ts';

export interface DoitDeps {
  /** The wallet: the real one, or the gallery's stand-in. */
  wallet: WalletApi;
  /** The storage the wallet keeps its record in. The note of the steps is kept beside it, under a key of its own. */
  storage: Storage;
  /** Counts one finished step: the app's track('Do it', step). */
  count: (step: StepId) => void;
}

export function makeDoit(deps: DoitDeps): Doit {
  const { wallet, storage } = deps;

  const runner = makeRunner({
    local: storage,
    wallet: () => walletFacts(wallet),
    canStore: () => wallet.canStore,
    now: () => Date.now(),
    visible: () => document.visibilityState !== 'hidden',
    count: deps.count,
    publish: (next) => {
      shown = next;
    },
  });

  // $state.raw: the value is replaced whole and never changed in place.
  let shown = $state.raw<Shown>(runner.shown());

  // The wallet lives outside this file, so an effect follows it. What the
  // effect reads is every property a step looks at, and nothing else: it
  // runs again when one of them is replaced, in the same task. The runner
  // is called out of the effect's sight (untrack): the note it reads and
  // the state it publishes must not count as something to run again for.
  // The effect belongs to no component, so it is made in a root of its
  // own, which lasts as long as the page.
  $effect.root(() => {
    $effect(() => {
      walletFacts(wallet);
      void wallet.canStore;
      untrack(() => runner.changed());
    });
  });

  // Another tab wrote the note: a payment sent there ticks a part here. (The event never fires in the tab that wrote.)
  window.addEventListener('storage', (event) => {
    if (event.storageArea === storage && (event.key === PROGRESS_KEY || event.key === null)) runner.changed();
  });

  // Back in view: a step whose screen is open is the one followed again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') runner.visible();
  });

  /** The world for judge(): the wallet as it publishes itself, read here so that whoever asks follows it. */
  const seen = (now: number): Seen => ({ wallet: walletFacts(wallet), note: shown.progress, kept: shown.kept, now, listAt: shown.listAt });

  return {
    get progress() {
      return shown.progress;
    },
    get read() {
      return shown.read;
    },
    get kept() {
      return shown.kept;
    },
    get waited() {
      return shown.waited;
    },

    seen,
    view: (id, now) => judge(id, seen(now)),

    watch(route, search, settled) {
      // First, so that a step this very change of screen finishes is counted at once, under the screen just named.
      if (settled) runner.release();
      runner.watch(route, search);
    },

    follow: (step) => runner.follow(step),
    stop: (step) => runner.stop(step),
    sendAnother: (step) => runner.sendAnother(step),
    restart: (step) => runner.restart(step),
    forget: () => runner.forget(),
    answer: (step) => runner.answer(step),
    recheck: () => runner.recheck(),
  };
}
