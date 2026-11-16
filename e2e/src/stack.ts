// The Worker's own handler, wired for a local run.
//
// In production worker/src/index.ts builds a Deps from Cloudflare's bindings
// and hands it to makeHandler. startStack() builds the same Deps from local
// parts and hands it to the same makeHandler:
//
//   config        configFromEnv over the "vars" of worker/wrangler.jsonc, with
//                 three local values laid over them (LOCAL_VARS below). The
//                 pot's counts are not one of the three: a local run has
//                 them as a deploy has them, switched off, so the handler
//                 does not know their path and the app does not ask for
//                 them. A scenario that reads them says so in its own
//                 settings: `vars: { POT_COUNTS: 'on' }`.
//   origin        makeOrigin, as deployed, with the real fetch, pointed at the
//                 stand-in practice network listening on a free local port
//                 (or at a real origin, for the live run)
//   botCheck      passes Cloudflare's published dummy token and no other.
//                 It looks at the token alone. The deployed check also wants
//                 the token to be for the action "faucet" and for the address
//                 asked for, which no local run can tell from a token that is
//                 always the same. scenarios/helpers.ts compares what a page
//                 drew the widget for with what the faucet was asked instead.
//   forwardEvent  a recorder: nothing is sent anywhere
//   limits        limiters that never refuse, until a scenario tells one to
//   potStatsHolder
//                 one holder for the life of the stack, as the deployed
//                 Worker has one for the life of each isolate: a stack is
//                 one isolate. So where the pot's counts are switched on,
//                 they are kept here as they are when deployed: the
//                 network is asked for them once, and every request of the
//                 next 15 seconds is given that answer. After a question
//                 that failed, the network is not asked again for 5
//                 seconds (worker/src/pot-stats.ts).
//   log           a recorder for the one line the handler writes per request
//   now           the real clock, plus what a scenario has moved it on by
//                 (advanceClock below). Nothing switches the keeping of the
//                 counts off, or the pause after a failure: a scenario that
//                 needs the Worker to ask the network again says that the
//                 15 or the 5 seconds have passed.
//
// That is the whole difference from production. The Worker has no test mode:
// everything local is in what it is given here.

import type { AppConfig, EventBody } from '@learnbitcoin/practice-contract';
import {
  configFromEnv,
  makeHandler,
  makeOrigin,
  makePotStatsHolder,
  type ConfigVars,
  type Deps,
  type EventMeta,
  type Handler,
  type Limiter,
  type Limits,
  type LogLine,
} from '@learnbitcoin/practice-worker';
import { wranglerConfig } from '../../worker/test/fakes.ts';
import { makeFakeOrigin, type FakeOrigin, type FakeOriginOptions } from './fake-origin.ts';
import { DUMMY_TOKEN } from './fake-turnstile.ts';

/** The token Cloudflare's test site keys hand out. The local bot check passes it and fails every other. */
export { DUMMY_TOKEN };

/** Cloudflare's published test site key: a visible widget that always passes. Usable on any host, localhost included. */
export const TEST_SITE_KEY = '1x00000000000000000000AA';

/**
 * The settings a local run lays over the ones in worker/wrangler.jsonc.
 *   PASSKEY_HOST        the page is opened at http://localhost:<port>, and a
 *                       passkey belongs to the host it is made on.
 *   TURNSTILE_SITE_KEY  a site key, so the faucet is open. Hermetic runs never
 *                       load Cloudflare's script (browser.ts answers its URL);
 *                       "pnpm dev" loads the real one, which takes this key.
 *   PLAUSIBLE_DOMAIN    any name turns events on. They go to the recorder.
 *
 * POT_COUNTS is left as wrangler.jsonc has it, on purpose: off. What a
 * local run shows of the pot's counts is then what a deploy shows.
 */
export const LOCAL_VARS: Readonly<Partial<ConfigVars>> = Object.freeze({
  PASSKEY_HOST: 'localhost',
  TURNSTILE_SITE_KEY: TEST_SITE_KEY,
  PLAUSIBLE_DOMAIN: 'practice.localhost',
});

/** A real origin to put the Worker in front of, in place of the stand-in. */
export interface RealOrigin {
  /** For example the value of ORIGIN_URL: Esplora under /esplora/, the bots under /bots/. */
  url: string;
  botsToken: string;
  /** The Access service token, when the origin sits behind one. */
  accessClientId?: string;
  accessClientSecret?: string;
}

export interface StackOptions {
  /** The stand-in network's own options (seed, starting height, what the faucet pays, a clock). */
  network?: FakeOriginOptions;
  /** A real origin: the live run. No stand-in is started, and `network` in the result is null. */
  origin?: RealOrigin;
  /**
   * Settings laid over wrangler.jsonc's and LOCAL_VARS: { TURNSTILE_SITE_KEY: '' } closes the faucet,
   * { POT_COUNTS: 'on' } switches the pot's counts on.
   */
  vars?: Partial<ConfigVars>;
  /** How long the Worker waits for the origin, in ms. Default: as deployed (8 s, and 25 s for the faucet). */
  timeoutMs?: number;
  /** Called with every log line as well as recording it ("pnpm dev" prints them). */
  log?: (line: LogLine) => void;
  /**
   * The most entries each recorder keeps; the oldest go first. Default: all
   * of them. "pnpm dev" runs for hours and sets a limit.
   */
  keep?: number;
}

export interface Stack {
  /** Answers /api/ and /p/ requests: the Worker's handler, as deployed. */
  handler: Handler;
  /** What GET /api/config answers in this run. */
  config: AppConfig;
  /** The stand-in's controls (mine, fund, setFaucet, setOrigin, setEsploraLag, height, requests). Null with a real origin. */
  network: FakeOrigin | null;
  /** Where the origin listens: the stand-in's own address, or the real origin's. */
  originUrl: string;
  /** The events the handler passed on, oldest first, with what it would have told the events service about the request. */
  events: { event: EventBody; meta: EventMeta }[];
  /** The handler's log lines, oldest first. */
  lines: LogLine[];
  /** Every token the bot check was asked about, with the address it was for. */
  botChecks: { token: string; address: string }[];
  /** The limiters told to refuse: stack.over.add('faucet') makes the faucet answer "limit" until it is deleted again. */
  over: Set<keyof Limits>;
  /**
   * Moves the Worker's clock on by `ms`, at once and for good: for the
   * Worker, that much more time has passed. The Worker's clock dates its log
   * lines and the pot's kept counts, and nothing else reads it: not the
   * stand-in network, not the pages.
   *
   * What it is for: where the pot's counts are switched on, the Worker
   * asks the network for them once and gives every page that answer for 15
   * seconds (POT_STATS_KEEP_MS of the Worker's package). A scenario that
   * has looked at the counts and needs the Worker to ask again (after a
   * payment, or to see what happens when the network cannot answer) moves
   * the clock on by that much first. And after a question that failed, the
   * Worker asks nobody for 5 seconds (POT_STATS_PAUSE_MS): a scenario that
   * brings the network back and needs the next page to be given the counts
   * moves the clock on by that much. The clock only goes forward.
   */
  advanceClock(ms: number): void;
  /** Waits for the work the handler left to finish after its answers (an event on its way to the recorder). */
  settled(): Promise<void>;
  /** Stops the stand-in network. The handler answers "unavailable" from then on. */
  close(): Promise<void>;
}

/** The "vars" of worker/wrangler.jsonc: the settings a deploy of this repository carries. */
export function wranglerVars(): Record<string, string> {
  const vars = wranglerConfig().vars;
  if (typeof vars !== 'object' || vars === null) throw new Error('worker/wrangler.jsonc has no "vars"');
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(vars)) out[name] = String(value);
  return out;
}

/** The settings of a local run: wrangler.jsonc's, then LOCAL_VARS, then the caller's. */
export function localVars(overrides: Partial<ConfigVars> = {}): ConfigVars {
  return { ...wranglerVars(), ...LOCAL_VARS, ...overrides } as unknown as ConfigVars;
}

/** Appends to a recorder, and drops its oldest entries once it holds more than `keep`. */
function record<T>(list: T[], entry: T, keep: number): void {
  list.push(entry);
  if (list.length > keep) list.splice(0, list.length - keep);
}

export async function startStack(options: StackOptions = {}): Promise<Stack> {
  const keep = options.keep ?? Number.POSITIVE_INFINITY;
  const config = configFromEnv(localVars(options.vars));

  // The practice network: the stand-in over HTTP on a free port, or a real one.
  const network = options.origin ? null : makeFakeOrigin(options.network);
  const listening = network ? await network.listen() : null;
  const originUrl = options.origin ? options.origin.url.replace(/\/+$/, '') : listening!.url;

  const events: Stack['events'] = [];
  const lines: LogLine[] = [];
  const botChecks: Stack['botChecks'] = [];
  const over = new Set<keyof Limits>();
  const pending = new Set<Promise<unknown>>();
  const limiter = (name: keyof Limits): Limiter => ({ limit: async () => ({ success: !over.has(name) }) });
  /** How far the Worker's clock is ahead of the real one, in ms (advanceClock). */
  let ahead = 0;

  const deps: Deps = {
    config,
    origin: makeOrigin({
      url: originUrl,
      botsToken: options.origin ? options.origin.botsToken : network!.token,
      accessClientId: options.origin?.accessClientId,
      accessClientSecret: options.origin?.accessClientSecret,
      // The runtime's fetch, called as a plain function, as index.ts hands it over.
      fetch: (input, init) => fetch(input, init),
      timeoutMs: options.timeoutMs,
      faucetTimeoutMs: options.timeoutMs,
    }),
    botCheck: async (token, address) => {
      record(botChecks, { token, address }, keep);
      // As deployed: with no site key there is no bot check, and the faucet is closed.
      if (config.turnstileSiteKey === '') return { verdict: 'closed', upstream: null, fault: null };
      return { verdict: token === DUMMY_TOKEN ? 'pass' : 'fail', upstream: 200, fault: null };
    },
    forwardEvent: async (event, meta) => {
      record(events, { event, meta }, keep);
      return { ok: true, upstream: 202, fault: null };
    },
    limits: {
      chain: limiter('chain'),
      broadcast: limiter('broadcast'),
      faucet: limiter('faucet'),
      pot: limiter('pot'),
      events: limiter('events'),
    },
    // Made once, here, and handed to every request: the stack is one Worker, started once.
    potStatsHolder: makePotStatsHolder(),
    log: (line) => {
      record(lines, line, keep);
      options.log?.(line);
    },
    waitUntil: (promise) => {
      const forget = (): void => {
        pending.delete(tracked);
      };
      const tracked: Promise<void> = promise.then(forget, forget);
      pending.add(tracked);
    },
    now: () => Date.now() + ahead,
  };

  return {
    handler: makeHandler(deps),
    config,
    network,
    originUrl,
    events,
    lines,
    botChecks,
    over,
    advanceClock: (ms) => {
      if (!Number.isFinite(ms) || ms < 0) throw new Error(`advanceClock: the clock only goes forward (${ms})`);
      ahead += ms;
    },
    settled: async () => {
      while (pending.size > 0) await Promise.all([...pending]);
    },
    close: async () => {
      await listening?.close();
    },
  };
}
