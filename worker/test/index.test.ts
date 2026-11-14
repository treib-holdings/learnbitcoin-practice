// The deployed entry, run under Node with stand-ins for what Cloudflare
// supplies: the settings of wrangler.jsonc, four secrets, five limiters and
// fetch. These tests are about the wiring: which setting, secret and limiter
// ends up where.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { API } from '@learnbitcoin/practice-contract';
import type { LogLine } from '../src/deps.ts';
import { FIXED_HEADERS } from '../src/headers.ts';
import worker from '../src/index.ts';
import { ADDRESS, APP, POT_ADDRESS, READER_IP, TXID, fakeFetch, fakeLimiter, post, reply, wranglerConfig } from './fakes.ts';
import type { FetchCall } from './fakes.ts';

const VARS = wranglerConfig().vars as Record<string, string>;
const ORIGIN = 'https://practice-origin.learnbitcoin.com';

type Limiters = Record<'CHAIN_LIMIT' | 'BROADCAST_LIMIT' | 'FAUCET_LIMIT' | 'POT_LIMIT' | 'EVENTS_LIMIT', ReturnType<typeof fakeLimiter>>;

/** The bindings as a deploy of this repository would have them, with the secrets set. */
function bindings(change: Record<string, string | undefined> = {}): { env: Env; limiters: Limiters } {
  const limiters: Limiters = {
    CHAIN_LIMIT: fakeLimiter(),
    BROADCAST_LIMIT: fakeLimiter(),
    FAUCET_LIMIT: fakeLimiter(),
    POT_LIMIT: fakeLimiter(),
    EVENTS_LIMIT: fakeLimiter(),
  };
  const env = {
    ...VARS,
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
    ACCESS_CLIENT_ID: 'client-id',
    ACCESS_CLIENT_SECRET: 'client-secret',
    BOTS_API_TOKEN: 'bots-token',
    ...limiters,
    ...change,
  } as unknown as Env;
  return { env, limiters };
}

let logged: Array<{ level: 'log' | 'error'; line: unknown }> = [];
let waiting: Promise<unknown>[] = [];
const context = { waitUntil: (promise: Promise<unknown>) => void waiting.push(promise) };
const real = { fetch: globalThis.fetch, log: console.log, error: console.error };

/** What the outside answers, per test. Anything a test did not expect to be asked fails it. */
let outside: (call: FetchCall) => Response = () => {
  throw new Error('nothing outside should be asked');
};
let asked: FetchCall[] = [];

beforeEach(() => {
  logged = [];
  waiting = [];
  const fetch = fakeFetch((call) => outside(call));
  asked = fetch.calls;
  globalThis.fetch = fetch as typeof globalThis.fetch;
  console.log = (line: unknown) => void logged.push({ level: 'log', line });
  console.error = (line: unknown) => void logged.push({ level: 'error', line });
});

afterEach(() => {
  globalThis.fetch = real.fetch;
  console.log = real.log;
  console.error = real.error;
  outside = () => {
    throw new Error('nothing outside should be asked');
  };
});

async function send(request: Request, env: Env): Promise<Response> {
  const response = await worker.fetch(request, env, context);
  await Promise.all(waiting);
  return response;
}

const get = (path: string): Request => new Request(`${APP}${path}`, { headers: { 'CF-Connecting-IP': READER_IP } });

test('as shipped: the config says the faucet is closed and events are off', async () => {
  const { env } = bindings();
  const response = await send(get(API.config), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    turnstileSiteKey: '',
    explorerUrl: 'https://practice-explorer.learnbitcoin.com',
    electrumHost: 'practice-electrum.learnbitcoin.com',
    electrumPort: 50002,
    siteUrl: 'https://www.learnbitcoin.com',
    sourceUrl: 'https://github.com/treib-holdings/learnbitcoin-practice',
    passkeyHost: 'practice.learnbitcoin.com',
    faucetSats: 100000,
    blockSeconds: 30,
    events: false,
  });
  assert.equal(asked.length, 0);
});

test('as shipped: the faucet answers closed and asks nobody; an event gets its 202 and goes nowhere', async () => {
  const { env, limiters } = bindings();
  const faucet = await send(post(API.faucet, { address: ADDRESS, token: 'a-token' }), env);
  assert.equal(faucet.status, 503);
  assert.deepEqual(await faucet.json(), { error: 'closed' });
  assert.equal(limiters.FAUCET_LIMIT.keys.length, 1);

  const event = await send(post(API.event, { name: 'pageview', path: '/' }), env);
  assert.equal(event.status, 202);
  assert.equal(waiting.length, 0);
  assert.equal(asked.length, 0, 'neither the verify service, nor the origin, nor the events service');
  assert.deepEqual(logged, [
    { level: 'log', line: { route: 'faucet', status: 503, upstream: null, ms: (logged[0]?.line as LogLine).ms, fault: null } },
    { level: 'log', line: { route: 'event', status: 202, upstream: null, ms: (logged[1]?.line as LogLine).ms, fault: null } },
  ]);
});

test('a site key that is missing or only spaces closes the faucet for the Worker, as it does for the app', async () => {
  // What GET /api/config tells the app and what POST /api/faucet does must
  // be one decision. A setting that was deleted arrives as undefined.
  for (const siteKey of [undefined, '   ']) {
    const { env } = bindings({ TURNSTILE_SITE_KEY: siteKey });
    const config = await send(get(API.config), env);
    assert.equal(((await config.json()) as { turnstileSiteKey: string }).turnstileSiteKey, '', JSON.stringify(siteKey));
    const faucet = await send(post(API.faucet, { address: ADDRESS, token: 'a-token' }), env);
    assert.equal(faucet.status, 503, JSON.stringify(siteKey));
    assert.deepEqual(await faucet.json(), { error: 'closed' });
  }
  assert.equal(asked.length, 0, 'neither the verify service nor the bots were asked');
  assert.ok(logged.every(({ level }) => level === 'log'), "closed on purpose is nobody's fault");
});

test('a host name setting that is missing closes the faucet and tells the owner, whatever the verify service would say', async () => {
  // An answer that names no host: compared with a missing setting as it came, it would have passed.
  outside = () => reply(200, { success: true, action: 'faucet', cdata: ADDRESS });
  for (const hostname of [undefined, '  ']) {
    const { env } = bindings({ TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_HOSTNAME: hostname });
    const faucet = await send(post(API.faucet, { address: ADDRESS, token: 'a-token' }), env);
    assert.equal(faucet.status, 503, JSON.stringify(hostname));
    assert.deepEqual(await faucet.json(), { error: 'closed' });
  }
  assert.equal(asked.length, 0);
  assert.deepEqual(
    logged.map(({ level, line }) => [level, (line as LogLine).route, (line as LogLine).fault]),
    [
      ['error', 'faucet', 'bot_check_config'],
      ['error', 'faucet', 'bot_check_config'],
    ],
  );
});

test('EVENT_PROPS missing is the default, off, and stops nothing', async () => {
  outside = (call) => (call.url === 'https://plausible.io/api/event' ? reply(202, 'ok') : reply(200, '6326', 'text/plain'));
  const event = { name: 'Passkey', path: '/new', value: 'ok' };
  // Deleted, or set to something that is not text at all.
  for (const setting of [undefined, true as unknown as string, 1 as unknown as string]) {
    const { env } = bindings({ PLAUSIBLE_DOMAIN: 'counted.example', EVENT_PROPS: setting });
    assert.equal((await send(get(API.config), env)).status, 200, String(setting));
    const tip = await send(get(`${API.esplora}/blocks/tip/height`), env);
    assert.equal(tip.status, 200, String(setting));
    assert.equal(await tip.text(), '6326');
    assert.equal((await send(post(API.event, event), env)).status, 202, String(setting));
    assert.deepEqual(JSON.parse(asked.at(-1)?.init.body as string), {
      name: 'Passkey: ok',
      url: `${APP}/new`,
      domain: 'counted.example',
    });
  }
  assert.ok(logged.every(({ level }) => level === 'log'), 'no fault anywhere');
});

test('a chain answer that stalls after its headers is given up on at the 8 second limit: 502, and the log says why', async () => {
  // The real limit is 8 seconds; here the signal the request carries is fired after 10 ms.
  const original = AbortSignal.timeout;
  let limit = 0;
  AbortSignal.timeout = (ms: number) => {
    limit = ms;
    return original.call(AbortSignal, 10);
  };
  // The origin sends its headers and the first bytes of an answer, and then
  // nothing more. When the signal fires the body fails with the signal's
  // reason, as the body of a real fetch does while the Worker is reading it.
  outside = (call) => {
    const signal = call.init.signal as AbortSignal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('[{"txid":"'));
        // Node does not wait for an AbortSignal's timer, so this one keeps the test alive.
        const timer = setTimeout(() => controller.error(new Error('the time limit never fired')), 5000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          controller.error(signal.reason);
        });
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { env } = bindings();
    const response = await send(get(`${API.esplora}/address/${ADDRESS}/txs`), env);
    assert.equal(response.status, 502, 'not a 200 with half an answer behind it');
    assert.deepEqual(await response.json(), { error: 'unavailable' });
  } finally {
    AbortSignal.timeout = original;
  }
  assert.equal(limit, 8000);
  assert.deepEqual(
    logged.map(({ level, line }) => ({ level, line: { ...(line as LogLine), ms: 0 } })),
    [{ level: 'error', line: { route: 'esplora_read', status: 502, upstream: 200, ms: 0, fault: 'origin_timeout' } }],
  );
});

test('a chain read goes to the configured origin with the Access token and the placeholder address', async () => {
  outside = () => reply(200, '6326', 'text/plain');
  const { env, limiters } = bindings();
  const response = await send(get(`${API.esplora}/blocks/tip/height`), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '6326');
  assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8');
  assert.equal(asked.length, 1);
  assert.equal(asked[0]?.url, `${ORIGIN}/esplora/blocks/tip/height`);
  assert.deepEqual(asked[0]?.headers, {
    'cf-access-client-id': 'client-id',
    'cf-access-client-secret': 'client-secret',
    'x-real-ip': '192.0.2.1',
  });
  assert.equal(limiters.CHAIN_LIMIT.keys.length, 1);
  assert.ok(!JSON.stringify(asked).includes(READER_IP), 'the reader address goes nowhere');
});

test('each route counts against its own limiter binding', async () => {
  outside = (call) => {
    if (call.url.endsWith('/esplora/tx')) return reply(200, TXID);
    if (call.url.endsWith('/bots/pot/address')) return reply(200, { address: POT_ADDRESS });
    return reply(200, '1', 'text/plain');
  };
  const routes: Array<[keyof Limiters, Request]> = [
    ['CHAIN_LIMIT', get(`${API.esplora}/address/${ADDRESS}/utxo`)],
    ['BROADCAST_LIMIT', post(`${API.esplora}/tx`, '00ff')],
    ['FAUCET_LIMIT', post(API.faucet, { address: ADDRESS, token: 'a-token' })],
    ['POT_LIMIT', post(API.potAddress, null)],
    ['EVENTS_LIMIT', post(API.event, { name: 'pageview', path: '/' })],
  ];
  for (const [name, request] of routes) {
    const { env, limiters } = bindings();
    await send(request, env);
    for (const [other, limiter] of Object.entries(limiters)) {
      assert.equal(limiter.keys.length, other === name ? 1 : 0, `${name} / ${other}`);
    }
  }
});

test('with a widget configured, the faucet asks the verify service with the secret, then the bots with their token', async () => {
  outside = (call) =>
    call.url.startsWith('https://challenges.cloudflare.com/')
      ? reply(200, { success: true, hostname: 'practice.learnbitcoin.com', action: 'faucet', cdata: ADDRESS, 'error-codes': [] })
      : reply(200, { txid: TXID, amount_sats: 100000, pot_coin: null });
  const { env } = bindings({ TURNSTILE_SITE_KEY: 'site-key' });
  const response = await send(post(API.faucet, { address: ADDRESS, token: 'a-token' }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { txid: TXID, amountSats: 100000, potTxid: null });

  assert.deepEqual(asked.map((call) => call.url), ['https://challenges.cloudflare.com/turnstile/v0/siteverify', `${ORIGIN}/bots/faucet`]);
  assert.deepEqual(JSON.parse(asked[0]?.init.body as string), { secret: 'turnstile-secret', response: 'a-token' });
  assert.equal(asked[1]?.headers.authorization, 'Bearer bots-token');
  assert.equal(asked[1]?.headers['cf-access-client-id'], 'client-id');
  assert.equal(asked[0]?.headers['cf-access-client-id'], undefined, 'the Access token goes to our origin only');
  assert.equal(asked[0]?.headers.authorization, undefined);
});

test('a token made on another host is refused: the host to match is the TURNSTILE_HOSTNAME setting', async () => {
  outside = () => reply(200, { success: true, hostname: 'www.learnbitcoin.com', action: 'faucet', cdata: ADDRESS });
  const { env } = bindings({ TURNSTILE_SITE_KEY: 'site-key' });
  const response = await send(post(API.faucet, { address: ADDRESS, token: 'a-token' }), env);
  assert.equal(response.status, 502);
  assert.equal(asked.length, 1, 'the bots are not asked');
  assert.equal(logged[0]?.level, 'error');
  assert.equal((logged[0]?.line as LogLine).fault, 'bot_check_config');
});

test('a secret that is not set keeps its door shut, and says so in the log', async () => {
  const noSecret = bindings({ TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET_KEY: undefined });
  const faucet = await send(post(API.faucet, { address: ADDRESS, token: 'a-token' }), noSecret.env);
  assert.equal(faucet.status, 503);
  assert.deepEqual(await faucet.json(), { error: 'closed' });

  const noToken = bindings({ BOTS_API_TOKEN: undefined });
  const pot = await send(post(API.potAddress, null), noToken.env);
  assert.equal(pot.status, 502);
  assert.deepEqual(await pot.json(), { error: 'unavailable' });

  assert.equal(asked.length, 0);
  assert.deepEqual(
    logged.map(({ level, line }) => [level, (line as LogLine).route, (line as LogLine).fault]),
    [
      ['error', 'faucet', 'bot_check_config'],
      ['error', 'pot_address', 'origin_auth'],
    ],
  );
});

test('without the Access secrets the origin is still asked, just without those headers', async () => {
  outside = () => reply(200, '1', 'text/plain');
  const { env } = bindings({ ACCESS_CLIENT_ID: undefined, ACCESS_CLIENT_SECRET: undefined });
  await send(get(`${API.esplora}/blocks/tip/height`), env);
  assert.deepEqual(asked[0]?.headers, { 'x-real-ip': '192.0.2.1' });
});

test('with a domain set, events go on through waitUntil, counted under the address the app was reached at', async () => {
  outside = () => reply(202, 'ok');
  const event = { name: 'Passkey', path: '/es/new', value: 'ok' };
  const headers = { 'User-Agent': 'Mozilla/5.0 (a browser)' };

  // A domain unlike every other setting, so a crossed wire would show.
  const off = bindings({ PLAUSIBLE_DOMAIN: 'counted.example' });
  assert.equal((await send(post(API.event, event, headers), off.env)).status, 202);
  assert.equal(waiting.length, 1);
  assert.equal(asked[0]?.url, 'https://plausible.io/api/event');
  assert.deepEqual(JSON.parse(asked[0]?.init.body as string), {
    name: 'Passkey: ok',
    url: `${APP}/es/new`,
    domain: 'counted.example',
  });
  assert.deepEqual(asked[0]?.headers, {
    'cf-connecting-ip': READER_IP,
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (a browser)',
    'x-forwarded-for': READER_IP,
  });

  for (const setting of ['on', ' ON ']) {
    const on = bindings({ PLAUSIBLE_DOMAIN: 'counted.example', EVENT_PROPS: setting });
    await send(post(API.event, event, headers), on.env);
    assert.deepEqual(JSON.parse(asked.at(-1)?.init.body as string), {
      name: 'Passkey',
      url: `${APP}/es/new`,
      domain: 'counted.example',
      props: { result: 'ok' },
    });
  }
  for (const setting of ['off', '', 'yes', 'true']) {
    const other = bindings({ PLAUSIBLE_DOMAIN: 'counted.example', EVENT_PROPS: setting });
    await send(post(API.event, event, headers), other.env);
    assert.equal((JSON.parse(asked.at(-1)?.init.body as string) as { name: string }).name, 'Passkey: ok', setting);
  }
});

test('a line with a fault is logged as an error, any other as a plain line; each is the five fields', async () => {
  outside = () => reply(502, 'Bad gateway', 'text/html');
  const { env } = bindings();
  await send(get(API.config), env);
  await send(get(`${API.esplora}/tx/${TXID}`), env);
  await send(get('/api/nothing'), env);
  assert.deepEqual(
    logged.map(({ level, line }) => ({ level, line: { ...(line as LogLine), ms: 0 } })),
    [
      { level: 'log', line: { route: 'config', status: 200, upstream: null, ms: 0, fault: null } },
      { level: 'error', line: { route: 'esplora_read', status: 502, upstream: 502, ms: 0, fault: 'origin_down' } },
      { level: 'log', line: { route: 'unknown', status: 404, upstream: null, ms: 0, fault: null } },
    ],
  );
  for (const { line } of logged) {
    const ms = (line as LogLine).ms;
    assert.ok(Number.isInteger(ms) && ms >= 0 && ms < 5000);
  }
});

test('a broken setting stops every route with a clean answer and one error line', async () => {
  const { env } = bindings({ ELECTRUM_PORT: 'fifty thousand' });
  for (const request of [get(API.config), get(`${API.esplora}/blocks/tip/height`), post(API.faucet, { address: ADDRESS, token: 't' })]) {
    const response = await send(request, env);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'unavailable' });
    for (const [name, value] of Object.entries(FIXED_HEADERS)) assert.equal(response.headers.get(name), value);
  }
  assert.equal(asked.length, 0);
  assert.equal(logged.length, 3);
  for (const entry of logged) {
    assert.deepEqual(entry, { level: 'error', line: { route: 'unknown', status: 502, upstream: null, ms: 0, fault: 'handler' } });
  }
});
