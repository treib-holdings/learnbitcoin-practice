// Stand-ins for everything the Worker's parts are given from outside, so the
// tests run with no network, no Cloudflare and no clock of their own.
// (Not a test file itself: it only exports.)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after } from 'node:test';
import type { AppConfig, EventBody, FaucetPayment, PotStats } from '@learnbitcoin/practice-contract';
import type {
  BotCheckResult,
  Deps,
  EventMeta,
  FetchLike,
  Limiter,
  Limits,
  LogLine,
  Origin,
  OriginAnswer,
  OriginBody,
} from '../src/deps.ts';
import { makePotStatsHolder } from '../src/pot-stats.ts';

/** Where the app lives, as the handler sees it in a request's URL. */
export const APP = 'https://practice.learnbitcoin.com';

// Real values from the recorded samples (e2e/fixtures/origin-samples.json).
export const ADDRESS = 'bcrt1qdpwsxpwkt6dc0c0l9vq3xgaz6s0jsjjnnk6ppw';
export const TXID = '2bfbd6c40dbd2ed74b3b180fb96a83a0c0c97cfc4b5d4fe788b99347127a2287';
export const POT_ADDRESS = 'bcrt1qxagpc0v6mxg2dq230xmphn8nuzaasw8uk6v5l9';

/** The pot's counts, as the contract carries them: three numbers that all differ, so that none can stand in for another. */
export const POT_COUNTS: PotStats = { passedOn: 12, waiting: 3, handedOn: 9 };

// Reader addresses from the ranges set aside for documentation: nobody's.
export const READER_IP = '203.0.113.7';
export const READER_IP6 = '2001:db8:aa:bb:1:2:3:4';

export const CONFIG: AppConfig = {
  turnstileSiteKey: 'site-key',
  explorerUrl: 'https://practice-explorer.learnbitcoin.com',
  electrumHost: 'practice-electrum.learnbitcoin.com',
  electrumPort: 50002,
  siteUrl: 'https://www.learnbitcoin.com',
  sourceUrl: 'https://example.com/source',
  passkeyHost: 'practice.learnbitcoin.com',
  faucetSats: 100000,
  blockSeconds: 30,
  events: true,
};

/** Reads a JSON file that sits beside the tests, or anywhere else in the repository. */
export function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
}

/** The text of a file, by its path from this folder. */
export function readFile(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

/** JSON with comments (wrangler.jsonc), without them. A "//" inside a string, as in a URL, is left alone. */
export function stripJsonComments(source: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    const next = source[i + 1];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
    } else if (char === '/' && next === '*') {
      i = source.indexOf('*/', i + 2) + 1;
    } else {
      out += char;
    }
  }
  return out;
}

/** The Worker's own config file, parsed. */
export function wranglerConfig(): Record<string, unknown> {
  return JSON.parse(stripJsonComments(readFile('../wrangler.jsonc'))) as Record<string, unknown>;
}

/**
 * Takes the real fetch away for the whole test file, and checks at the end
 * that nothing reached for it. Every part under test is handed a fake.
 */
export function noNetwork(): void {
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    return Promise.reject(new Error('a test reached for the network'));
  };
  after(() => assert.equal(calls, 0, 'a test reached for the network'));
}

export interface FetchCall {
  url: string;
  init: RequestInit;
  /** The headers that were sent, with lower-case names. */
  headers: Record<string, string>;
}

/** A fetch that records what it was asked and answers with `respond`. */
export function fakeFetch(
  respond: (call: FetchCall) => Response | Promise<Response>,
): FetchLike & { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const send = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const call = { url: input, init, headers };
    calls.push(call);
    return respond(call);
  };
  return Object.assign(send, { calls });
}

/**
 * A fetch that answers only after `ms` (never, by default), unless the
 * request's own time limit aborts it first, as a real fetch would be.
 */
export function slowFetch(ms: number | null, respond: () => Response): FetchLike & { calls: FetchCall[] } {
  return fakeFetch(
    (call) =>
      new Promise<Response>((resolve, reject) => {
        const signal = call.init.signal;
        assert.ok(signal, 'every request carries a time limit');
        // Node does not wait for an AbortSignal's timer, so this one keeps the test alive.
        const timer = setTimeout(
          () => (ms === null ? reject(new Error('the time limit never fired')) : resolve(respond())),
          ms ?? 5000,
        );
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason);
        });
      }),
  );
}

/** A response as the origin, the verify service or the events service would send it. */
export function reply(status: number, body: string | object | null, type?: string): Response {
  const text = body === null || typeof body === 'string' ? body : JSON.stringify(body);
  const contentType = type ?? (typeof body === 'string' ? 'text/plain' : 'application/json');
  return new Response(text, { status, headers: body === null ? {} : { 'Content-Type': contentType } });
}

/**
 * What one call to a limiter counts for: its `delta`, or 1 when it has
 * none. Cloudflare's limiter takes the weight of a call under that name
 * (deps.ts's Limiter type names the key alone so far). It throws for a
 * field it does not know and for a weight that is not a whole number above
 * 0, and so does this, so that a call the real one would refuse fails here.
 */
export function costOf(options: { key: string }): number {
  for (const name of Object.keys(options)) assert.ok(name === 'key' || name === 'delta', `bad rate limit options: [${name}]`);
  assert.equal(typeof options.key, 'string');
  const delta = (options as { delta?: unknown }).delta;
  if (delta === undefined) {
    assert.ok(!('delta' in options), 'a call that counts as one names no delta at all');
    return 1;
  }
  assert.ok(typeof delta === 'number' && Number.isInteger(delta) && delta > 0, `delta must be a whole number above 0: ${String(delta)}`);
  return delta;
}

/** A rate limiter for the tests, and what it remembers of the calls made to it, in order. */
export type FakeLimiter = Limiter & {
  /** The key of each call. */
  keys: string[];
  /** What each call counted for. */
  costs: number[];
  /** Each call's options, whole, as they were handed over. */
  asked: Array<Record<string, unknown>>;
};

/** A rate limiter that says `success` and remembers what it was asked. */
export function fakeLimiter(success = true): FakeLimiter {
  const keys: string[] = [];
  const costs: number[] = [];
  const asked: Array<Record<string, unknown>> = [];
  return {
    keys,
    costs,
    asked,
    async limit(options) {
      costs.push(costOf(options));
      keys.push(options.key);
      asked.push({ ...options });
      return { success };
    },
  };
}

/**
 * A rate limiter that counts, by the rule Cloudflare's own follows (its
 * documentation under "Weighted requests", and the stand-in that Wrangler
 * runs locally): a call is let through while the count for its key is
 * below the limit, and then adds its weight to the count, even when that
 * takes the count past the limit. A call that is refused adds nothing. One
 * window only: the count never starts again, as it would after a minute.
 */
export function countingLimiter(limit: number): Limiter & { count(key: string): number; calls: number } {
  const counts = new Map<string, number>();
  const limiter = {
    calls: 0,
    count: (key: string): number => counts.get(key) ?? 0,
    async limit(options: { key: string }): Promise<{ success: boolean }> {
      limiter.calls += 1;
      const cost = costOf(options);
      const count = counts.get(options.key) ?? 0;
      if (count >= limit) return { success: false };
      counts.set(options.key, count + cost);
      return { success: true };
    },
  };
  return limiter;
}

function textBody(text: string, type: OriginBody['type']): OriginBody {
  return { body: new Response(text).body, type };
}

export interface Harness {
  deps: Deps;
  /** Every log line written, in order. */
  lines: LogLine[];
  /** Everything handed to waitUntil. */
  pending: Promise<unknown>[];
  /** What was asked of the outside, in order: "limit:faucet", "botCheck", "origin:faucet", "origin:potStats", "forward". */
  trace: string[];
  /** The argument of each call to the origin. */
  originArgs: string[];
  botCalls: Array<{ token: string; address: string }>;
  forwarded: Array<{ event: EventBody; meta: EventMeta }>;
  limiters: Record<keyof Limits, FakeLimiter>;
}

export interface HarnessOptions {
  config?: Partial<AppConfig>;
  /** Limiters that refuse. */
  over?: Array<keyof Limits>;
  esplora?: (path: string) => OriginAnswer<OriginBody> | Promise<OriginAnswer<OriginBody>>;
  broadcast?: (hex: string) => OriginAnswer<string>;
  faucet?: (address: string) => OriginAnswer<FaucetPayment>;
  potAddress?: () => OriginAnswer<string>;
  /** What the origin answers when asked for the pot's counts: at once, or when the test lets it. */
  potStats?: () => OriginAnswer<PotStats> | Promise<OriginAnswer<PotStats>>;
  botCheck?: BotCheckResult;
  forward?: () => Promise<{ ok: boolean; upstream: number | null; fault: LogLine['fault'] }>;
  /** A clock of the test's own. Default: each look at the clock is 5 ms after the last. */
  now?: () => number;
}

/**
 * A Deps made of fakes that all succeed unless told otherwise, with a record of what the handler did with them.
 *
 * Each harness has a holder of its own for the pot's counts, with nothing
 * kept: it stands for a Worker that has just been started. Requests that
 * are to find what an earlier one left go to one harness.
 */
export function harness(options: HarnessOptions = {}): Harness {
  const lines: LogLine[] = [];
  const pending: Promise<unknown>[] = [];
  const trace: string[] = [];
  const originArgs: string[] = [];
  const botCalls: Harness['botCalls'] = [];
  const forwarded: Harness['forwarded'] = [];
  const over = options.over ?? [];

  const limiter = (name: keyof Limits): FakeLimiter => {
    const inner = fakeLimiter(!over.includes(name));
    return {
      keys: inner.keys,
      costs: inner.costs,
      asked: inner.asked,
      limit(args) {
        trace.push(`limit:${name}`);
        return inner.limit(args);
      },
    };
  };
  const limiters = {
    chain: limiter('chain'),
    broadcast: limiter('broadcast'),
    faucet: limiter('faucet'),
    pot: limiter('pot'),
    events: limiter('events'),
  };

  const origin: Origin = {
    async esplora(path) {
      trace.push('origin:esplora');
      originArgs.push(path);
      return options.esplora?.(path) ?? { ok: true, value: textBody('{"ok":true}', 'json'), upstream: 200 };
    },
    async broadcast(hex) {
      trace.push('origin:broadcast');
      originArgs.push(hex);
      return options.broadcast?.(hex) ?? { ok: true, value: TXID, upstream: 200 };
    },
    async faucet(address) {
      trace.push('origin:faucet');
      originArgs.push(address);
      return (
        options.faucet?.(address) ?? {
          ok: true,
          value: { txid: TXID, amountSats: 100000, potTxid: null },
          upstream: 200,
        }
      );
    },
    async potAddress() {
      trace.push('origin:potAddress');
      return options.potAddress?.() ?? { ok: true, value: POT_ADDRESS, upstream: 200 };
    },
    async potStats() {
      trace.push('origin:potStats');
      return options.potStats?.() ?? { ok: true, value: { ...POT_COUNTS }, upstream: 200 };
    },
  };

  let clock = 1000;
  const deps: Deps = {
    config: { ...CONFIG, ...options.config },
    origin,
    async botCheck(token, address) {
      trace.push('botCheck');
      botCalls.push({ token, address });
      return options.botCheck ?? { verdict: 'pass', upstream: 200, fault: null };
    },
    async forwardEvent(event, meta) {
      trace.push('forward');
      forwarded.push({ event, meta });
      return options.forward?.() ?? { ok: true, upstream: 202, fault: null };
    },
    limits: limiters,
    potStatsHolder: makePotStatsHolder(),
    log: (line) => {
      lines.push(line);
    },
    waitUntil: (promise) => {
      pending.push(promise);
    },
    // Each look at the clock is 5 ms after the last, unless the test brings a clock.
    now: options.now ?? (() => (clock += 5)),
  };

  return { deps, lines, pending, trace, originArgs, botCalls, forwarded, limiters };
}

/** The headers of a request, with every header that was set to "" left out. */
function without(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== ''));
}

/** A GET as a browser would send it to the app's own host (a header set to "" is left out). */
export function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${APP}${path}`, { headers: without({ 'CF-Connecting-IP': READER_IP, ...headers }) });
}

/** A POST from one of the app's own pages, unless `headers` says otherwise (a header set to "" is left out). */
export function post(path: string, body: string | object | null, headers: Record<string, string> = {}): Request {
  return new Request(`${APP}${path}`, {
    method: 'POST',
    headers: without({ Origin: APP, 'CF-Connecting-IP': READER_IP, ...headers }),
    body: body === null || typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** The body of a refusal, checked to be exactly the contract's shape. */
export async function errorOf(response: Response): Promise<{ error: string; detail?: string }> {
  assert.match(response.headers.get('Content-Type') ?? '', /^application\/json/);
  const body = (await response.json()) as { error: string; detail?: string };
  for (const key of Object.keys(body)) assert.ok(key === 'error' || key === 'detail', `unexpected key ${key}`);
  return body;
}
