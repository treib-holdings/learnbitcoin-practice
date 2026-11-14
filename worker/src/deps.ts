// Everything the Worker's request handler needs from outside itself.
//
// Types only. handler.ts turns a Deps into the function that answers every
// /api/ and /p/ request:
//
//     export function makeHandler(deps: Deps): Handler
//
// The handler and everything below it use standard Request, Response, fetch
// and crypto and nothing that exists only on Cloudflare, so node --test runs
// them as they are. Two callers build a Deps:
//
//   index.ts        the deployed Worker: the real practice origin, the real
//                   bot check, Plausible, Cloudflare's rate limiters.
//   e2e/            the local test server: a stand-in origin, a bot check that
//                   accepts only Cloudflare's published dummy token, an event
//                   recorder, limiters that never refuse.
//
// That is the only difference between a test run and production. The handler
// has no test mode, and no setting can relax a check.

import type { AppConfig, ErrorCode, EventBody, FaucetPayment } from '@learnbitcoin/practice-contract';

export type Handler = (request: Request) => Promise<Response>;

/** fetch, as the pieces below take it: tests pass a fake. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// -- log lines ----------------------------------------------------------------

/** One name per route, for the log line. Never a path: paths carry addresses and transaction IDs. */
export type RouteName =
  | 'config'
  | 'esplora_read'
  | 'esplora_broadcast'
  | 'faucet'
  | 'pot_address'
  | 'event'
  | 'unknown';

/**
 * A fixed code for a fault the owner has to fix. A refusal the reader can
 * fix (a bad address, a failed bot check, asking too fast) never has one.
 */
export type Fault =
  | 'origin_auth' // the origin answered with a redirect, 401 or 403: Access or the bots token is wrong
  | 'origin_down' // the origin could not be reached, or answered with a server error
  | 'origin_timeout'
  | 'origin_shape' // the origin answered with something the Worker does not understand: a 200 with the wrong body, or a refusal that is not one of its own
  | 'bot_check_config' // no secret, or the token was made for another host than this Worker expects
  | 'bot_check_down' // the bot check's verify service could not be asked
  | 'events_down' // the events service refused or could not be reached
  | 'handler'; // the handler itself threw

/**
 * The line logged for an API request. No path, address, transaction ID, token or client address.
 * A request for chain data that ends without a fault writes none.
 */
export interface LogLine {
  route: RouteName;
  status: number;
  /** The origin's (or verify service's) status, when one was asked. */
  upstream: number | null;
  ms: number;
  fault: Fault | null;
}

// -- the practice origin --------------------------------------------------------

/** How a call to the practice origin ended. */
export type OriginAnswer<T> =
  | { ok: true; value: T; upstream: number }
  | {
      ok: false;
      /** What to tell the app. */
      code: ErrorCode;
      /** Only for a refused broadcast: the node's own words, already cut to DETAIL_MAX. */
      detail: string | null;
      upstream: number | null;
      fault: Fault | null;
    };

/** A 200 from the Esplora API: read whole, within a time and a size limit, and passed on byte for byte. */
export interface OriginBody {
  body: ReadableStream<Uint8Array> | null;
  /** The origin's content type, reduced to the two the Worker will send. */
  type: 'json' | 'text';
}

/**
 * The practice network, reached through its origin (origin.ts builds this from
 * a URL, the bots token, the optional Access service token and a fetch).
 *
 * Every request is built from scratch: a constant origin, a path made of
 * validated parts, redirect "manual", a timeout, a fixed x-real-ip, and none
 * of the reader's headers. Only a 200 is ever passed on.
 */
export interface Origin {
  /**
   * GET one of the Esplora shapes the app uses. `path` begins with a slash and
   * has been rebuilt by the handler from validated parts, for example
   * "/address/bcrt1q.../utxo". A 404 answered in plain text to a transaction
   * read is `not_found`. Any other answer that is not a 200 is `unavailable`,
   * and always carries a fault: the handler writes no log line for a chain
   * read that ends without one.
   */
  esplora(path: string): Promise<OriginAnswer<OriginBody>>;
  /** POST a signed transaction as hex. The value is its transaction ID. A refusal by the node is mapped to a broadcast code. */
  broadcast(hex: string): Promise<OriginAnswer<string>>;
  /**
   * Ask the faucet to pay `address`. Of the bots' refusals only the faucet's own six pass
   * through (bad_address, own_address, already_paid, busy, refilling, failed), each under
   * its own status. Any other answer is `unavailable` with a fault.
   */
  faucet(address: string): Promise<OriginAnswer<FaucetPayment>>;
  /** An address of the pay-it-forward pot. */
  potAddress(): Promise<OriginAnswer<string>>;
}

// -- the bot check --------------------------------------------------------------

/**
 * pass    the token is good for this host, the action "faucet" and this address.
 * fail    the reader's token is bad, spent or expired, or was solved for another
 *         action or another address: they can run the check again. No fault.
 * closed  no site key or secret is configured, so the faucet is closed.
 * down    the answer cannot be trusted (the verify service failed, or the token
 *         was made for another host): the faucet stays shut. Any doubt lands here.
 */
export type BotVerdict = 'pass' | 'fail' | 'closed' | 'down';

export interface BotCheckResult {
  verdict: BotVerdict;
  upstream: number | null;
  fault: Fault | null;
}

export type BotCheck = (token: string, address: string) => Promise<BotCheckResult>;

// -- events -------------------------------------------------------------------

/** What the events service is told about the request an event arrived in. */
export interface EventMeta {
  /** The reader's IP address, as Cloudflare reports it. */
  ip: string | null;
  userAgent: string | null;
}

/** Passes one checked event on. Never throws; a failure is reported for the log line only. */
export type ForwardEvent = (
  event: EventBody,
  meta: EventMeta,
) => Promise<{ ok: boolean; upstream: number | null; fault: Fault | null }>;

// -- limits -------------------------------------------------------------------

/**
 * The shape of Cloudflare's rate limiting binding, and of the stand-ins used in tests.
 *
 * A call counts as one request against `key`, or as `delta` requests when it
 * names one (a whole number above 0: Cloudflare's "weighted requests").
 * `success` is false once the count for the key has reached the limit, and
 * a call that is refused adds nothing to the count.
 */
export interface Limiter {
  limit(options: { key: string; delta?: number }): Promise<{ success: boolean }>;
}

/** One limiter per kind of traffic. They are brakes on a flood; the faucet's real rules live in the bots. */
export interface Limits {
  /**
   * Chain reads (GET /api/esplora/...). A page of an address's older
   * transactions asked for by an ID is counted apart, under a second key of
   * the reader's, and as 50 (handler.ts, OLDER_PAGE_COST): 120 a minute.
   */
  chain: Limiter;
  broadcast: Limiter;
  faucet: Limiter;
  pot: Limiter;
  events: Limiter;
}

// -- the whole set --------------------------------------------------------------

export interface Deps {
  /** What GET /api/config answers. */
  config: AppConfig;
  origin: Origin;
  botCheck: BotCheck;
  forwardEvent: ForwardEvent;
  limits: Limits;
  /** Writes one line. The deployed Worker prints JSON to the console; tests collect the lines. */
  log(line: LogLine): void;
  /** Lets work finish after the answer has been sent (the Worker's ctx.waitUntil). */
  waitUntil(promise: Promise<unknown>): void;
  /** Milliseconds since 1970, for the log line's timing. */
  now(): number;
}
