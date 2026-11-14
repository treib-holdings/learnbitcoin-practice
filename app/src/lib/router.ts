// Which screen an address shows, and the address of each screen.
//
// Plain data and functions with no Svelte and no browser objects in them, so
// "node --test" can run them. router.svelte.ts follows the address bar and
// calls these.
//
// English lives at the root and Spanish under /es, with the same paths:
// /wallet/send and /es/wallet/send are one screen in two languages.

import {
  API,
  LANGS,
  TXID_PATTERN,
  eventPath as countedPath,
  type Lang,
  type ScreenName,
} from '@learnbitcoin/practice-contract';

export type { Lang } from '@learnbitcoin/practice-contract';

/** One screen. The names are exactly the contract's screen names. */
export type Route =
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'restore' }
  | { name: 'sparrow' }
  | { name: 'about' }
  | { name: 'wallet' }
  | { name: 'coins' }
  | { name: 'receive' }
  | { name: 'send' }
  | { name: 'activity' }
  | { name: 'tx'; txid: string }
  | { name: 'backup' }
  | { name: 'settings' }
  | { name: 'not-found' };

/** The screens whose address is one fixed path. */
type FixedScreen = Exclude<ScreenName, 'tx' | 'not-found'>;

// The compiler holds the three tables below to the contract's list of
// screens: add a screen there and each table needs a line before this builds.

/** The English address of every fixed screen. */
const PATHS: Record<FixedScreen, string> = {
  home: '/',
  new: '/new',
  restore: '/restore',
  sparrow: '/sparrow',
  about: '/about',
  wallet: '/wallet',
  coins: '/wallet/coins',
  receive: '/wallet/receive',
  send: '/wallet/send',
  activity: '/wallet/activity',
  backup: '/wallet/backup',
  settings: '/wallet/settings',
};

/** A transaction's screen is this plus its ID. */
const TX_PREFIX = '/wallet/tx/';

/** Where pathFor sends a "not found" route. No screen lives here, so it reads back as "not found". */
const NOT_FOUND_PATH = '/not-found';

/** Whether a screen shows a wallet, and so needs one to be in this browser. */
const NEEDS_WALLET: Record<ScreenName, boolean> = {
  home: false,
  new: false,
  restore: false,
  sparrow: false,
  about: false,
  wallet: true,
  coins: true,
  receive: true,
  send: true,
  activity: true,
  tx: true,
  backup: true,
  settings: true,
  'not-found': false,
};

/** What each language puts in front of a path. English has nothing in front. */
const PREFIX: Record<Lang, string> = { en: '', es: '/es' };

/** PATHS turned around: from an address to its screen. */
const SCREEN_AT = new Map<string, FixedScreen>(
  (Object.keys(PATHS) as FixedScreen[]).map((name) => [PATHS[name], name]),
);

/** The screen at a path that has had its language taken off the front. */
function screenAt(path: string): Route {
  const name = SCREEN_AT.get(path);
  if (name !== undefined) return { name };
  if (path.startsWith(TX_PREFIX)) {
    // Only a whole transaction ID, 64 lower-case hex characters, is a screen.
    const txid = path.slice(TX_PREFIX.length);
    if (TXID_PATTERN.test(txid)) return { name: 'tx', txid };
  }
  // Everything else, including /do/<id>, which is kept for the guided steps
  // of a later phase.
  return { name: 'not-found' };
}

/** "/es/wallet/receive" -> Spanish, the receive screen. */
export function parsePath(pathname: string): { lang: Lang; route: Route } {
  // One trailing slash means the same screen: "/wallet/" is "/wallet".
  const path = pathname.replace(/([^/])\/$/, '$1');
  for (const lang of LANGS) {
    const prefix = PREFIX[lang];
    if (prefix === '') continue;
    if (path === prefix) return { lang, route: { name: 'home' } };
    if (path.startsWith(`${prefix}/`)) return { lang, route: screenAt(path.slice(prefix.length)) };
  }
  return { lang: 'en', route: screenAt(path) };
}

/** The address of a screen in a language: the reverse of parsePath. */
export function pathFor(route: Route, lang: Lang): string {
  let path: string;
  if (route.name === 'tx') path = TX_PREFIX + route.txid;
  else if (route.name === 'not-found') path = NOT_FOUND_PATH;
  else path = PATHS[route.name];
  const prefix = PREFIX[lang];
  // Spanish home is "/es", not "/es/".
  if (path === '/') return prefix === '' ? '/' : prefix;
  return prefix + path;
}

/**
 * The path a screen is counted under. It is the contract's, fixed per screen
 * and language, and never the address itself: every transaction is counted
 * as /wallet/tx, so no transaction ID is ever sent.
 */
export function eventPath(route: Route, lang: Lang): string {
  return countedPath(route.name, lang);
}

/** True for the screens that show a wallet. Without one, the app offers to open, restore or create. */
export function needsWallet(route: Route): boolean {
  return NEEDS_WALLET[route.name];
}

/** "/api/" and "/p/": the first part of every path the Worker answers, read from the contract's list. */
const WORKER_PREFIXES = [...new Set(Object.values(API).map((path) => `/${path.split('/')[1]}/`))];

/**
 * True for a path on this site that the app shows itself, so a click on a
 * link to it changes the screen without loading a page. False for what the
 * browser must fetch: the Worker's paths, and files such as /logo.svg (the
 * last part of the path ends in a dot and an extension).
 */
export function isAppPath(pathname: string): boolean {
  if (WORKER_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
  return !/\.[A-Za-z0-9]+$/.test(pathname);
}
