// What a screen may ask of the "Do it" steps, and how it reaches them.
//
// main.ts builds the one object that satisfies Doit (doit.svelte.ts) and
// hands it to App.svelte, which calls setDoit once, as it does for the
// wallet. Every screen and piece under it calls useDoit() and gets the same
// object. Nothing but main.ts imports doit.svelte.ts, so the development
// gallery (app/dev) can run the same steps over its scripted stand-in
// wallet and a storage that lives in the page's memory.
//
// Call useDoit() while the component is being set up (at the top of its
// script), never inside a handler.
//
// A screen never reads the stored note itself and never writes it: it
// reads the properties below, which follow the note, and calls the actions.

import { createContext } from 'svelte';
import type { Route } from '../router.ts';
import type { Seen, StepView } from './judge.ts';
import type { Shown } from './runner.ts';
import type { StepId } from './steps.ts';

export interface Doit {
  // ---- state (reactive, read-only) ----

  /** The note as it stands in this browser's storage. Empty when none is stored, when it cannot be read, and under a newer note. */
  readonly progress: Shown['progress'];
  /** How the stored note reads: none, kept, unreadable, newer or blocked. */
  readonly read: Shown['read'];
  /** Whether progress can be written here: yes, no (the browser refuses) or newer (a newer version's note is stored). */
  readonly kept: Shown['kept'];
  /** How long a step's payment waited for its block, where this page saw the block come. In memory only. */
  readonly waited: Shown['waited'];

  /**
   * The world as judge() takes it, at `now` (ms since 1970): what the
   * wallet publishes, the note, and whether it can be written. Reactive:
   * read it in markup or in $derived.
   */
  seen(now: number): Seen;
  /** Where a step stands at `now`: judge(id, seen(now)). Reactive. */
  view(id: StepId, now: number): StepView;

  // ---- told by App.svelte alone ----

  /**
   * The reader is on this screen, with this query string in the address.
   * `settled` is true once the server's settings have arrived (or failed
   * for good): counts are held back until then. App.svelte calls it for the
   * first screen and at every change, straight after it has named the
   * screen to the counter.
   */
  watch(route: Route, search: string, settled: boolean): void;

  // ---- what the reader does ----

  /** The step's action link was used: the step is the one followed. Call it from the link's click. */
  follow(step: StepId): void;
  /**
   * The link of a need that leads to another step was pressed: `to` is the
   * step it leads to, `cameFor` the step whose screen it stands on. For a
   * reader who came from a chapter, the step they are sent to then leads
   * back to the step they came for, and to their chapter. Call it from the
   * link's click: the link's address carries nothing of it.
   */
  detour(to: StepId, cameFor: StepId): void;
  /** "Stop following", and the strip closed. */
  stop(step: StepId): void;
  /** "Send another": the payment the step waits for is cleared from its note. */
  sendAnother(step: StepId): void;
  /** "Start this step again". False when nothing could be written. */
  restart(step: StepId): boolean;
  /** "Forget my progress". True when no note is stored afterwards. */
  forget(): boolean;
  /**
   * The step's open question was answered right, or its box was ticked.
   * The screen has judged the answer (answerBlock, answerCoins and
   * wordsPassed in judge.ts). False when nothing was ticked.
   */
  answer(step: StepId): boolean;
  /** "The seed", done: its three words were checked again and passed, for the wallet that is here now. */
  recheck(): boolean;
}

const [getDoit, putDoit] = createContext<Doit>();

/** Makes `api` the "Do it" steps of this component and everything inside it. App.svelte calls it; nothing else in the app does. */
export function setDoit(api: Doit): Doit {
  return putDoit(api);
}

/** The "Do it" steps. Its properties are reactive: read them in markup or in $derived. Throws outside App.svelte. */
export function useDoit(): Doit {
  return getDoit();
}
