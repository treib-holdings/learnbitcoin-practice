// The router's decisions, as plain functions.
//
// router.svelte.ts follows the address bar and touches the page. What it
// decides is written here, with no Svelte and no browser objects, so that
// "node --test" can check every rule: which clicks the app takes over, what
// a move does to the browser's history, what Back and Forward mean, and what
// the address of this screen is in the other language.

import { isAppPath, parsePath, pathFor, type Lang } from './router.ts';

// -- clicks -------------------------------------------------------------------

/** What the router needs to know about a click. A MouseEvent fits as it is. */
export interface ClickFacts {
  /** Something else has already dealt with the click. */
  defaultPrevented: boolean;
  /** 0 is the main button. */
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** What it needs to know about the link under the click. */
export interface LinkFacts {
  /** The link's whole address, as the browser resolved it. */
  href: string;
  /** Its target attribute, or "". */
  target: string;
  /** It has a download attribute. */
  download: boolean;
  /** Its rel attribute, or "". */
  rel: string;
}

export type ClickVerdict =
  /** Not the router's business: the browser does what it always does. */
  | { kind: 'leave' }
  /** A link to another part of the screen that is showing, such as "Skip to content". */
  | { kind: 'part'; id: string }
  /** A link to a screen of the app: change the screen without loading a page. */
  | { kind: 'go'; to: string };

const LEAVE: ClickVerdict = { kind: 'leave' };

/**
 * What a click means. `here` is the page's own address. `fullLoads` is true
 * once the bot check's script is in the page: from then on a link to
 * another screen is left to the browser, which loads the page afresh.
 */
export function judgeClick(click: ClickFacts, link: LinkFacts | null, here: string, fullLoads: boolean): ClickVerdict {
  if (link === null) return LEAVE;
  // A handler of the link's own has already said what the click does.
  if (click.defaultPrevented) return LEAVE;
  // Another mouse button, or a key held down: the reader is asking for a
  // new tab, a new window or a download, and that is the browser's to give.
  if (click.button !== 0) return LEAVE;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return LEAVE;
  // The link itself asks for another tab or frame, or for a download.
  if (link.target !== '' && link.target.toLowerCase() !== '_self') return LEAVE;
  if (link.download) return LEAVE;
  // rel="external": a way to say "load this page afresh", for a link to this site.
  if (link.rel.toLowerCase().split(/\s+/).includes('external')) return LEAVE;

  let to: URL;
  let from: URL;
  try {
    to = new URL(link.href, here);
    from = new URL(here);
  } catch {
    return LEAVE;
  }
  // Another site, or a path on this one that is a file or the Worker's.
  if (to.origin !== from.origin || !isAppPath(to.pathname)) return LEAVE;

  if (to.pathname === from.pathname && to.search === from.search && to.hash !== '') {
    // The same screen, another part of it. No page is loaded for this even
    // after the bot check: it is not a move between screens.
    try {
      return { kind: 'part', id: decodeURIComponent(to.hash.slice(1)) };
    } catch {
      return LEAVE;
    }
  }
  if (fullLoads) return LEAVE;
  return { kind: 'go', to: to.href };
}

// -- moves --------------------------------------------------------------------

export type MoveVerdict =
  /** Already there: nothing to do. */
  | { kind: 'stay' }
  /** A screen of the app: a new history entry (push) or the current one swapped (replace), and no page load. */
  | { kind: 'push' | 'replace'; url: string }
  /** The browser loads the address: location.assign for "load", location.replace for "load-replace". */
  | { kind: 'load' | 'load-replace'; url: string };

/**
 * What navigate(to) does. `to` may be a path ("/wallet/send") or a whole
 * address; `here` is the page's own address.
 */
export function judgeMove(to: string, here: string, replace: boolean, fullLoads: boolean): MoveVerdict {
  let target: URL;
  let from: URL;
  try {
    target = new URL(to, here);
    from = new URL(here);
  } catch {
    return { kind: 'stay' };
  }
  const load: MoveVerdict = { kind: replace ? 'load-replace' : 'load', url: target.href };
  if (target.origin !== from.origin || !isAppPath(target.pathname)) return load;
  if (target.pathname === from.pathname && target.search === from.search && !replace) return { kind: 'stay' };
  if (fullLoads) return load;
  return { kind: replace ? 'replace' : 'push', url: target.href };
}

// -- Back and Forward ---------------------------------------------------------

/**
 * The place a history entry has in the router's count, read from what the
 * router stored with it ({ index: 3 }). Null for an entry the router has not
 * counted: one the browser made by itself for a "#part".
 */
export function entryIndex(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) return null;
  const index = (state as { index?: unknown }).index;
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : null;
}

export type PopVerdict =
  /** The screen that is showing, in the entry the router is already at: only the "#part" changed. Nothing to do. */
  | { kind: 'stay' }
  /** After the bot check: the browser loads the page the address bar now names. */
  | { kind: 'load' }
  /** Another entry: show its screen. `index` is its place in the count, or null when it has none. */
  | { kind: 'show'; index: number | null };

/**
 * What Back or Forward means. `entry` is the place of the history entry the
 * browser has moved to (entryIndex of its state), `current` is the place the
 * router was at, and `sameAddress` says whether the path and the query
 * string are the ones already showing.
 *
 * The entry's place is looked at before the address. Two entries can have
 * one address (Home, About, Home again, then two steps back). Going by the
 * address alone, that would be no move, and the router would lose count of
 * where it is: the next link would be stored under a wrong place, and a
 * later Back would scroll to where some other entry had been left.
 */
export function judgePop(entry: number | null, current: number, sameAddress: boolean, fullLoads: boolean): PopVerdict {
  if (sameAddress && (entry === null || entry === current)) return { kind: 'stay' };
  if (fullLoads) return { kind: 'load' };
  return { kind: 'show', index: entry };
}

// -- languages ----------------------------------------------------------------

/** What a language puts in front of a path: "" for English, "/es" for Spanish. */
function prefixOf(lang: Lang): string {
  const home = pathFor({ name: 'home' }, lang);
  return home === '/' ? '' : home;
}

/**
 * The address of the same screen in another language, for the language
 * switch. A path that is no screen keeps its text and changes only its
 * language, so "/nothing/here" becomes "/es/nothing/here": still not found,
 * now said in Spanish.
 */
export function pathInLang(pathname: string, lang: Lang): string {
  const here = parsePath(pathname);
  if (here.route.name !== 'not-found') return pathFor(here.route, lang);
  // Exactly one slash in front, whatever the address had. A link that starts
  // with two ("//example.org/claim", which is what is left of
  // "/es//example.org/claim" without its "/es") is read by a browser as
  // another site, and so is one that starts with a slash and a backslash.
  // The language switch must never lead off this site.
  const bare = `/${pathname.slice(prefixOf(here.lang).length).replace(/^[/\\]+/, '')}`;
  const prefix = prefixOf(lang);
  if (bare === '/') return prefix === '' ? '/' : prefix;
  return prefix + bare;
}
