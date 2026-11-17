// What the practice app and its Worker agree on.
//
// Both sides import this file, so a path, a body, an error code or an event
// name is never spelled two ways. Plain TypeScript with no imports: it runs
// in the browser, in the Worker and under node --test.
//
// Within one version, things are added here, never removed or given a new
// meaning. A tab opened before a deploy keeps running the old app against
// the new Worker.

// -- paths --------------------------------------------------------------------

/** Every path the Worker answers. Anything else under /api/ or /p/ is a JSON 404. */
export const API = {
  /** GET: AppConfig. */
  config: '/api/config',
  /** GET <base>/<shape>, POST <base>/tx: the chain, through the Esplora API. */
  esplora: '/api/esplora',
  /** POST FaucetRequest: FaucetPayment. */
  faucet: '/api/faucet',
  /** POST (empty body): PotAddress. */
  potAddress: '/api/pot/address',
  /**
   * GET: PotStats, while AppConfig.potCounts is true. While it is false the
   * Worker does not know this path: it answers the JSON 404 of any other.
   */
  potStats: '/api/pot/stats',
  /** POST EventBody: 202, no body worth reading. */
  event: '/p/event',
} as const;

/** A practice-network address: lower-case bech32 or bech32m with the "bcrt" prefix. */
export const ADDRESS_PATTERN = /^bcrt1[02-9ac-hj-np-z]{11,71}$/;

/** A transaction ID: 64 lower-case hex characters. */
export const TXID_PATTERN = /^[0-9a-f]{64}$/;

// -- bodies -------------------------------------------------------------------

/** GET /api/config: public facts the app needs. Nothing here is secret. */
export interface AppConfig {
  /** Site key for the faucet's bot check. Empty: the faucet is closed. */
  turnstileSiteKey: string;
  /** Block explorer for the practice chain, no trailing slash. */
  explorerUrl: string;
  /** Electrum server (TLS) for desktop wallets such as Sparrow. */
  electrumHost: string;
  electrumPort: number;
  /** The main site, no trailing slash. */
  siteUrl: string;
  /** Where this code can be read. */
  sourceUrl: string;
  /** The one host where passkeys are offered (localhost is always allowed too). */
  passkeyHost: string;
  /** What one faucet request pays, in sats. */
  faucetSats: number;
  /** Seconds between practice blocks. */
  blockSeconds: number;
  /** False: the app sends no events at all. */
  events: boolean;
  /**
   * Whether the pot's counts can be had (GET /api/pot/stats). False: the
   * Worker does not answer that path, and the app does not ask for it.
   */
  potCounts: boolean;
}

/** POST /api/faucet. */
export interface FaucetRequest {
  address: string;
  /** The bot check's token, made for action "faucet" and this address. */
  token: string;
}

/** What the faucet promised. The payment is broadcast but not yet in a block. */
export interface FaucetPayment {
  txid: string;
  amountSats: number;
  /**
   * The transaction in which an earlier learner passed on the coin this payment
   * spends, or null when the coins came from the practice network's own supply.
   */
  potTxid: string | null;
}

/** POST /api/pot/address: where to send coins to pass them on. */
export interface PotAddress {
  address: string;
}

/**
 * GET /api/pot/stats: the pay-it-forward pot in three counts. Each is a whole
 * number from 0. They say how many, never who: no address, no transaction ID.
 * The path is answered only while AppConfig.potCounts is true.
 */
export interface PotStats {
  /** Payments that readers have passed on to the pot and that a block has taken in. */
  passedOn: number;
  /** Coins in the pot that wait for a newcomer. */
  waiting: number;
  /** Pot coins the faucet has handed on to a newcomer. */
  handedOn: number;
}

// -- refusals -----------------------------------------------------------------

/**
 * Every refusal the Worker can send, as { "error": <code> } with the status
 * in ERROR_STATUS. The app shows its own text for each code, in the reader's
 * language. Anything the app does not know it treats as "unavailable".
 */
export const ERROR_CODES = [
  'bad_request', // the request is malformed: a bug in the app, not something the reader did
  'forbidden', // the request did not come from this site's own pages
  'not_found', // no such path, or the chain has no such address or transaction (yet)
  'method', // wrong HTTP method for this path
  'too_large', // the body is over the cap for this path
  'limit', // this reader is asking too fast: wait and try again
  'unavailable', // the practice network or a service behind it cannot answer: our fault
  // the faucet
  'closed', // the faucet is switched off (no bot check is configured)
  'bot_check', // the bot check did not pass, or its token expired
  'bad_address', // not a practice-network address
  'own_address', // an address of the practice network's own wallets
  'already_paid', // this address already got coins in the last 24 hours
  'busy', // the faucet has paid its limit for this minute
  'refilling', // the faucet is out of coins until its refill confirms
  'failed', // the faucet could not finish the payment: our fault
  // a broadcast the node refused
  'already_sent', // the node already has this transaction in a block
  'coin_spent', // one of the coins it spends is gone, or another payment is spending it
  'fee_too_low', // below the minimum fee the network relays
  'dust', // an output is too small to be worth spending
  'refused', // any other refusal; `detail` carries the node's own words
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** The refusals that can only come from POST /api/esplora/tx. */
export const BROADCAST_REFUSALS = ['already_sent', 'coin_spent', 'fee_too_low', 'dust', 'refused'] as const;
export type BroadcastRefusal = (typeof BROADCAST_REFUSALS)[number];

export const ERROR_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  forbidden: 403,
  not_found: 404,
  method: 405,
  too_large: 413,
  limit: 429,
  unavailable: 502,
  closed: 503,
  bot_check: 403,
  bad_address: 400,
  own_address: 400,
  already_paid: 429,
  busy: 429,
  refilling: 503,
  failed: 500,
  already_sent: 400,
  coin_spent: 400,
  fee_too_low: 400,
  dust: 400,
  refused: 400,
};

/** The body of every refusal. `detail` is only set on a refused broadcast. */
export interface ErrorBody {
  error: ErrorCode;
  /** The node's own words, cut to DETAIL_MAX characters. For a details line, never as the message. */
  detail?: string;
}

export const DETAIL_MAX = 300;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

// -- the "Do it" steps --------------------------------------------------------

/**
 * The guided steps, in the order of their chapters: one for the bitcoin
 * chapter, three for the payment chapter, two for the keys chapter (the
 * app's table of chapters has their numbers and titles). An ID is part of
 * an address (/do/<id>), of a counted event and of the link back to the
 * main site, so it is lower-case letters and hyphens and nothing else.
 */
export const STEPS = ['hold-some', 'pass-it-on', 'no-balances', 'waiting-room', 'the-seed', 'prove-the-backup'] as const;
export type StepId = (typeof STEPS)[number];

export function isStepId(value: unknown): value is StepId {
  return typeof value === 'string' && (STEPS as readonly string[]).includes(value);
}

// -- screens and languages ----------------------------------------------------

export const LANGS = ['en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

/** One name per screen. The router's route names are exactly these. */
export const SCREENS = [
  'home',
  'new',
  'restore',
  'sparrow',
  'about',
  'wallet',
  'coins',
  'receive',
  'send',
  'activity',
  'tx',
  'backup',
  'settings',
  // The list of "Do it" steps, and one step.
  'do',
  'step',
  'not-found',
] as const;
export type ScreenName = (typeof SCREENS)[number];

/** A step's screen has no path of its own here: it is counted under its step's (STEP_PREFIX and the ID). */
const SCREEN_PATHS: Record<Exclude<ScreenName, 'step'>, string> = {
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
  // One path for every transaction: a transaction ID is never counted.
  tx: '/wallet/tx',
  backup: '/wallet/backup',
  settings: '/wallet/settings',
  do: '/do',
  // One path for every unknown address: what the reader typed is never counted.
  'not-found': '/not-found',
};

/** A step's screen is this plus its ID: /do/hold-some. */
const STEP_PREFIX = '/do/';

/**
 * The path a screen is counted under: fixed per screen and language, never
 * the address bar's text.
 *
 * A step's screen is counted under its own step, so `step` says which one:
 * eventPath('step', 'es', 'hold-some') is "/es/do/hold-some". The six IDs
 * are a closed list, so nothing a reader typed can ride on it: without an
 * ID, or with one that is not on the list, the answer is the one path of
 * every unknown address (the router shows "not found" for such an address
 * too). For every other screen `step` is not looked at.
 */
export function eventPath(screen: ScreenName, lang: Lang, step?: string): string {
  let path: string;
  if (screen !== 'step') path = SCREEN_PATHS[screen];
  else path = isStepId(step) ? `${STEP_PREFIX}${step}` : SCREEN_PATHS['not-found'];
  if (lang === 'en') return path;
  return path === '/' ? '/es' : `/es${path}`;
}

let allEventPaths: readonly string[] | null = null;

/**
 * Every path an event may carry: the closed list the Worker checks against.
 * It holds each screen in both languages, and for the step screen the path
 * of each of the six steps.
 */
export function eventPaths(): readonly string[] {
  allEventPaths ??= LANGS.flatMap((lang) =>
    SCREENS.flatMap((screen) => (screen === 'step' ? STEPS.map((step) => eventPath(screen, lang, step)) : [eventPath(screen, lang)])),
  );
  return allEventPaths;
}

// -- events -------------------------------------------------------------------

/**
 * Everything the app counts. An event is a name, the screen it happened on
 * and, except for a screen view, one value from a closed list. There is no
 * free text, no ID, no address, no amount and nothing about the wallet.
 */
export const EVENTS = {
  /** A screen was opened. */
  pageview: null,
  /** A wallet was made in this browser. */
  'Wallet created': { prop: 'method', values: ['passkey', 'words'] },
  /**
   * How making a passkey ended. ok: the secret came with create(). ok-at-get: it
   * needed the follow-up get(). finished: an unfinished setup was completed later.
   */
  Passkey: {
    prop: 'result',
    values: ['ok', 'ok-at-get', 'finished', 'unfinished', 'no-prf', 'cancelled', 'timed-out', 'error'],
  },
  /**
   * How opening a wallet with a passkey (or its 12 words) ended. same: the wallet
   * this browser knew. opened / opened-empty: a browser with no record, after the
   * first scan (history found, or none). words: unlocked by typing the 12 words.
   */
  Unlock: {
    prop: 'result',
    values: [
      'same',
      'other-passkey',
      'changed',
      'tampered',
      'opened',
      'opened-empty',
      'words',
      'no-prf',
      'cancelled',
      'timed-out',
      'error',
    ],
  },
  /** Restore from 12 words. found: practice history was found. kept / erased: none was, and the reader chose. */
  Restore: { prop: 'result', values: ['found', 'kept', 'erased'] },
  /** How one request for practice coins ended (once per request, not per retry). */
  Faucet: { prop: 'result', values: ['ok', 'already-paid', 'bot-check', 'gave-up', 'failed'] },
  /** A payment was broadcast (to a pass-it-on address, or anywhere else), or the node refused it. */
  Payment: { prop: 'result', values: ['sent', 'sent-to-pot', 'refused'] },
  /** The 12 words were put on screen. */
  'Words shown': { prop: 'wallet', values: ['passkey', 'words'] },
  /** The wallet was removed from this browser. */
  'Wallet removed': { prop: 'wallet', values: ['passkey', 'words'] },
  /** A "Do it" step was done. The value is the step: which one, never whose. */
  'Do it': { prop: 'step', values: STEPS },
} as const;

export type EventName = keyof typeof EVENTS;
/** Every event except a screen view; each of these carries exactly one value. */
export type CountedEvent = Exclude<EventName, 'pageview'>;
export type ValueOf<N extends CountedEvent> = (typeof EVENTS)[N]['values'][number];

/** POST /p/event. */
export interface EventBody {
  name: EventName;
  /** One of eventPaths(). */
  path: string;
  /** Required for every event except "pageview", where it must be absent. */
  value?: string;
}

/** The Worker's whole check on an event. Unknown keys, names, paths and values are all refused. */
export function isEventBody(input: unknown): input is EventBody {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const body = input as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (key !== 'name' && key !== 'path' && key !== 'value') return false;
  }
  const { name, path, value } = body;
  if (typeof name !== 'string' || !Object.hasOwn(EVENTS, name)) return false;
  if (typeof path !== 'string' || !eventPaths().includes(path)) return false;
  const spec = EVENTS[name as EventName];
  if (spec === null) return value === undefined;
  return typeof value === 'string' && (spec.values as readonly string[]).includes(value);
}
