// The "Do it" runner at work in one page: it keeps the world as it was a
// moment ago, looks at the world as it is now, and has the difference
// written to the note.
//
// The other files of this folder are pure. judge.ts says where a step
// stands in a world, advance.ts what follows from the change between two
// worlds, progress.ts how one change is written. This file is what calls
// them, at every change:
//
//   - the reader moves to another screen (watch);
//   - the wallet publishes something new, or another tab changes the stored
//     note (changed);
//   - the tab comes back into view (visible);
//   - the reader answers a question, ticks the box, stops following, starts
//     a step again or forgets the lot.
//
// Each time it builds the world (the screen, what the wallet publishes, the
// stored note, the clock), hands the world before and this one to
// advance(), and writes what that says, one change at a time, through the
// one write function. The world is then kept as "before", with the note
// read again.
//
// Three rules live here and nowhere else:
//
//   - Nothing is written until a step's screen is opened. Opening one is
//     the first change this file ever writes, and it is written before the
//     world is looked at, so that what the opening itself makes true (a
//     wallet that is already here) is ticked in the same breath.
//   - A step is counted ("Do it", with the step as its value) by the write
//     that put the moment it was done into the note, and by no other. The
//     count is held back until the page says counts may go out: before the
//     server's settings have arrived nobody knows whether anything is
//     counted at all.
//   - A step that is done and still followed is let go once the reader has
//     seen it done on its own screen. Until then it stays followed, so that
//     the strip on the other screens can say that it is done.
//
// No Svelte and no browser objects in here: the storage, the wallet's
// picture of itself, the clock and the counter are all handed in, so
// node --test runs every rule. doit.svelte.ts wires the browser in and
// publishes what this file hands it.

import type { Route } from '../router.ts';
import { advance, answered, counted, rechecked } from './advance.ts';
import type { Seen, Waited, World } from './judge.ts';
import { forgetProgress, fromOfSearch, readProgress, restartStep, writeProgress, type Change, type Progress, type Read, type WriteResult } from './progress.ts';
import type { StepId } from './steps.ts';

/** What a screen is shown of the runner's state. Each value is replaced whole when it changes. */
export interface Shown {
  /** How the stored note reads: none, kept, unreadable, newer or blocked (progress.ts). */
  read: Read['state'];
  /** The note as it stands in storage. Empty for everything but "kept". */
  progress: Progress;
  /**
   * Whether progress can be written here: "yes"; "no" where the browser
   * refuses (it will not store anything, the note cannot be read, or the
   * last write was refused); "newer" under a note that a newer version of
   * this page wrote.
   */
  kept: Seen['kept'];
  /**
   * How long a step's payment waited for its block, for each step whose
   * block came while this page was open. The note forgets the payment when
   * the step is done, so this is the only place that still knows. In the
   * page's memory only: a reload forgets it.
   */
  waited: Readonly<Partial<Record<StepId, Waited>>>;
  /**
   * When this page last saw the wallet's list of transactions replaced: the
   * moment of its latest read, as near as the page can tell. Null while the
   * wallet has no list. judge() takes it as Seen.listAt: a list read before
   * a payment was sent says nothing about that payment.
   */
  listAt: number | null;
}

/** What the runner is handed. */
export interface RunnerDeps {
  /** The browser's storage for this site: the one the wallet's record is kept in. */
  local: Storage;
  /** The wallet's part of the world, as it stands at this moment (walletFacts in judge.ts). */
  wallet: () => World['wallet'];
  /** False when the browser refuses to store anything at all (the wallet's canStore). */
  canStore: () => boolean;
  /** The time, in ms since 1970. */
  now: () => number;
  /** False while the tab is hidden: nobody is looking at it. */
  visible: () => boolean;
  /** Counts one finished step. Called only after release(). */
  count: (step: StepId) => void;
  /** Called with the new state whenever it may have changed. */
  publish: (shown: Shown) => void;
}

export interface Runner {
  /** The state as it stands. */
  shown(): Shown;
  /**
   * The reader is on this screen. Call it for the page's first screen and
   * at every change of screen; a call that names the screen that is already
   * open (the same screen in the other language) changes nothing. `search`
   * is the address's query string: a step's screen reads the way back to
   * the main site from it ("?from=<path>"), and takes it only when it is
   * one of the two pages of the step's own chapter.
   */
  watch(route: Route, search: string): void;
  /** Something the world is made of has changed: what the wallet publishes, or the stored note (another tab wrote it). */
  changed(): void;
  /** The tab is in view again. A step whose screen is open is followed again. */
  visible(): void;
  /** Counts may go out from now on: the settings have arrived, and the screen has been named to the counter. */
  release(): void;
  /** The step's action link was used: the step is the one followed. */
  follow(step: StepId): void;
  /** "Stop following", and the strip closed. */
  stop(step: StepId): void;
  /** "Send another": the payment the step waits for is cleared from its note. */
  sendAnother(step: StepId): void;
  /** "Start this step again". False when nothing could be written. */
  restart(step: StepId): boolean;
  /** "Forget my progress". True when no note is stored afterwards. */
  forget(): boolean;
  /**
   * A question of the step was answered right, or its box was ticked: the
   * part that is open is ticked. The caller has judged the answer. False
   * when nothing was written: the part is not the one that is open any
   * more, or nothing can be kept here.
   */
  answer(step: StepId): boolean;
  /** "The seed", done: its three words were checked again, for the wallet that is here now. False when nothing was written. */
  recheck(): boolean;
}

/** True for two routes that are one screen: the same name, and for a step or a transaction the same one. */
function sameScreen(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  if (a.name === 'step' && b.name === 'step') return a.id === b.id;
  if (a.name === 'tx' && b.name === 'tx') return a.txid === b.txid;
  return true;
}

export function makeRunner(deps: RunnerDeps): Runner {
  const { local } = deps;

  /** The screen that is open. Null until the page has named its first one. */
  let route: Route | null = null;
  /** The query string that screen was opened with: a step's screen reads its way back from it. */
  let query = '';
  /** The world at the last change, with the note as it was stored then. Null until the first world has been looked at. */
  let before: World | null = null;
  /** The last write was refused by the browser. Cleared by the next write that is taken. */
  let refused = false;
  let waited: Partial<Record<StepId, Waited>> = {};
  /** The wallet's list of transactions as this file last saw it, and when it first saw that one. */
  let list: World['wallet']['history'] = null;
  let listAt: number | null = null;
  /** Steps this page's writes finished, waiting to be counted. */
  const held: StepId[] = [];
  let released = false;

  /** Whether a write can be tried, from what is stored and what the browser allows. */
  function writable(read: Read): Seen['kept'] {
    if (read.state === 'newer') return 'newer';
    return read.state === 'blocked' || !deps.canStore() ? 'no' : 'yes';
  }

  /**
   * The wallet's part of the world, as it stands. The wallet replaces its
   * list of transactions whole each time it has read it, and never changes
   * one in place: so a list this file has not seen before was read just
   * now, and that moment is noted.
   */
  function wallet(): World['wallet'] {
    const facts = deps.wallet();
    if (facts.history !== list) {
      list = facts.history;
      listAt = list === null ? null : deps.now();
    }
    return facts;
  }

  /** The world at this moment, with the note read from storage. */
  function world(at: Route, now: number = deps.now()): World {
    const read = readProgress(local);
    const facts = wallet();
    return { route: at, wallet: facts, note: read.progress, kept: writable(read), now, listAt };
  }

  function shown(): Shown {
    const read = readProgress(local);
    const kept = writable(read);
    // A browser that refused the last write does not keep progress, whatever it says of itself.
    return { read: read.state, progress: read.progress, kept: kept === 'yes' && refused ? 'no' : kept, waited, listAt };
  }

  function flush(): void {
    if (!released) return;
    for (const step of held.splice(0)) deps.count(step);
  }

  /** Takes in how one write ended. True when the browser took it. */
  function taken(result: WriteResult): boolean {
    if (!result.ok) {
      // Under a newer version's note nothing is written, and that is no refusal of the browser's.
      if (result.why === 'storage') refused = true;
      return false;
    }
    refused = false;
    // Counted by the write that put the moment a step was done into the note, and by no other.
    held.push(...counted(result.read, result.progress));
    flush();
    return true;
  }

  /** The one way anything is written. */
  function write(change: Change): boolean {
    return taken(writeProgress(local, change));
  }

  /**
   * A step that is done and still followed, seen on its own screen: it is
   * let go. Not while the tab is hidden: nobody has seen it then, and the
   * strip of the tab that is in view still has to say that it is done.
   */
  function letGo(at: Route): void {
    if (at.name !== 'step' || !deps.visible()) return;
    const note = readProgress(local).progress;
    if (note.following === at.id && note.steps[at.id]?.doneAt !== undefined) write({ kind: 'stop', step: at.id });
  }

  /** Looks at the world as it is now, and writes what follows from the change since the last look. */
  function run(): void {
    if (route === null) return;
    const after = world(route);
    const plan = advance(before, after);
    for (const change of plan.changes) {
      // The changes were worked out one on top of the other: after a refusal the rest does not hold.
      if (!write(change)) break;
    }
    if (Object.keys(plan.waited).length > 0) waited = { ...waited, ...plan.waited };
    letGo(route);
    // The world to compare the next one with: this one, with the note as it is stored now.
    before = world(route, after.now);
    deps.publish(shown());
  }

  return {
    shown,

    watch(next, search) {
      const opened = next.name === 'step' && !(route !== null && route.name === 'step' && route.id === next.id);
      const same = route !== null && sameScreen(route, next);
      route = next;
      query = search;
      if (same) return;
      // A step's screen starts its step and follows it. Written first, so that the world looked at
      // next already holds a started step, and whatever is true of the wallet ticks at once.
      if (opened) write({ kind: 'open', step: next.id, at: deps.now(), from: fromOfSearch(next.id, search) });
      run();
    },

    changed: run,

    visible() {
      if (route === null) return;
      if (route.name === 'step') {
        // "Forget my progress" in another tab took the note from under this screen: the step it
        // shows is not started any more, and nothing on it could be done. The reader is back on
        // the step's screen, which is what starts a step: it is opened again, as it was when the
        // screen first opened. (Not when the note goes, while this tab lies hidden: the reader
        // has just chosen to forget, and a tab nobody is looking at does not undo that.)
        const read = readProgress(local);
        if (read.state !== 'newer' && read.progress.steps[route.id]?.started !== true) {
          write({ kind: 'open', step: route.id, at: deps.now(), from: fromOfSearch(route.id, query) });
        } else {
          // "A step's screen makes its step the followed one when its tab comes back into view."
          write({ kind: 'follow', step: route.id, at: deps.now() });
        }
      }
      run();
    },

    release() {
      released = true;
      flush();
    },

    follow(step) {
      write({ kind: 'follow', step, at: deps.now() });
      run();
    },

    stop(step) {
      write({ kind: 'stop', step });
      run();
    },

    sendAnother(step) {
      write({ kind: 'send-another', step });
      run();
    },

    restart(step) {
      const ok = taken(restartStep(local, step, deps.now()));
      if (ok) {
        // What this page remembered of the step's wait belongs to the try that was thrown away.
        const { [step]: _gone, ...rest } = waited;
        waited = rest;
      }
      run();
      return ok;
    },

    forget() {
      const ok = forgetProgress(local);
      if (ok) {
        waited = {};
        refused = false;
      }
      // The world to compare the next one with holds no note now: nothing that happened before counts for a step opened later.
      before = route === null ? null : world(route);
      deps.publish(shown());
      return ok;
    },

    answer(step) {
      if (route === null) return false;
      const change = answered(step, world(route));
      const ok = change !== null && write(change);
      run();
      return ok;
    },

    recheck() {
      if (route === null) return false;
      const change = rechecked(world(route));
      const ok = change !== null && write(change);
      run();
      return ok;
    },
  };
}
