// The deployed Worker.
//
// This is the only file that names Cloudflare's bindings (the settings,
// secrets and rate limiters of wrangler.jsonc). It turns them into the Deps
// that handler.ts asks for and hands the request over. Every decision about a
// request is made in the files it imports, which run the same way under
// node --test.
//
// The type of `env` comes from worker-configuration.d.ts, which Wrangler
// writes from wrangler.jsonc. After a change there, run in this folder:
//
//     pnpm exec wrangler types --include-runtime=false --strict-vars=false
//
// The two flags keep that file to the bindings alone: Cloudflare's runtime
// types stay out of this package, so the other files are checked against the
// same standard Request, Response and fetch that Node gives them in tests.

import { makeBotCheck } from './bot-check.ts';
import { configFromEnv } from './config.ts';
import type { Deps, FetchLike, Limiter, LogLine } from './deps.ts';
import { makeForwardEvent } from './events.ts';
import { makeHandler } from './handler.ts';
import { refusal } from './headers.ts';
import { makeOrigin } from './origin.ts';

declare global {
  /**
   * A rate limiting binding. The generated Env names this type; with the
   * runtime types left out, this is where it is said what one can do.
   */
  interface RateLimit extends Limiter {}
}

/** What Cloudflare passes beside the request. Only one thing is used: a way to finish work after the answer. */
interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

/** The runtime's fetch, called as a plain function (handed over bare, it would lose the object it belongs to). */
const send: FetchLike = (input, init) => fetch(input, init);

/**
 * One line per request, as an object so that Workers Logs can filter on its
 * fields. A line with a fault code goes out as an error: those are the ones
 * the owner has to act on.
 */
function log(line: LogLine): void {
  if (line.fault === null) console.log(line);
  else console.error(line);
}

function depsFor(request: Request, env: Env, context: Context): Deps {
  const config = configFromEnv(env);
  return {
    config,
    origin: makeOrigin({
      url: env.ORIGIN_URL,
      // A secret that is not set arrives as undefined, whatever its type
      // says. The parts below treat an empty value as "not configured" and
      // keep their door shut.
      botsToken: env.BOTS_API_TOKEN ?? '',
      accessClientId: env.ACCESS_CLIENT_ID,
      accessClientSecret: env.ACCESS_CLIENT_SECRET,
      fetch: send,
    }),
    botCheck: makeBotCheck({
      // The site key as GET /api/config reports it, not as it was typed in.
      // When the app is told the faucet is closed, it is closed here too.
      siteKey: config.turnstileSiteKey,
      secret: env.TURNSTILE_SECRET_KEY ?? '',
      hostname: env.TURNSTILE_HOSTNAME,
      fetch: send,
    }),
    forwardEvent: makeForwardEvent({
      domain: env.PLAUSIBLE_DOMAIN,
      // Events are counted under the address the app was reached at.
      appUrl: new URL(request.url).origin,
      props: isOn(env.EVENT_PROPS),
      fetch: send,
    }),
    limits: {
      chain: env.CHAIN_LIMIT,
      broadcast: env.BROADCAST_LIMIT,
      faucet: env.FAUCET_LIMIT,
      pot: env.POT_LIMIT,
      events: env.EVENTS_LIMIT,
    },
    log,
    waitUntil: (promise) => context.waitUntil(promise),
    // In a Worker the clock stands still while code runs and moves only when
    // the Worker waits for something outside itself. So the "ms" of a log
    // line is the time spent waiting, which is nearly always the origin's.
    now: () => Date.now(),
  };
}

/** "on" switches a setting on. Anything else is off, the default, and so is a setting that is missing. */
function isOn(setting: unknown): boolean {
  return typeof setting === 'string' && setting.trim().toLowerCase() === 'on';
}

export default {
  async fetch(request: Request, env: Env, context: Context): Promise<Response> {
    let deps: Deps;
    try {
      deps = depsFor(request, env, context);
    } catch {
      // A setting is missing or malformed (config.ts says which ones can
      // be). Nothing can be answered properly until the owner fixes it.
      log({ route: 'unknown', status: 502, upstream: null, ms: 0, fault: 'handler' });
      return refusal('unavailable');
    }
    return makeHandler(deps)(request);
  },
};
