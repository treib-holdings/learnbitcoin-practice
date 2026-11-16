// The deployed entry, run under Node with stand-ins for what Cloudflare
// supplies: the settings of wrangler.jsonc, four secrets, five limiters and
// fetch. These tests are about the wiring: which setting, secret and limiter
// ends up where, and what the entry keeps from one request to the next.
//
// Cloudflare runs the entry in an isolate: it loads the module once and then
// hands it request after request. What the module holds at its top (the
// holder of the pot's counts) lives as long as that. So each test here gets
// an isolate of its own, newly started (newIsolate below), and a test that
// is about two isolates starts a second one.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { API } from '@learnbitcoin/practice-contract';
import type { LogLine } from '../src/deps.ts';
import { OLDER_PAGE_COST, POT_STATS } from '../src/handler.ts';
import { FIXED_HEADERS } from '../src/headers.ts';
import { POT_STATS_KEEP_MS } from '../src/pot-stats.ts';
import { ADDRESS, APP, POT_ADDRESS, READER_IP, TXID, fakeFetch, fakeLimiter, post, reply, wranglerConfig } from './fakes.ts';
import type { FetchCall } from './fakes.ts';

/** The entry as Cloudflare calls it. */
type Entry = typeof import('../src/index.ts').default;

let started = 0;

/**
 * The entry module, loaded anew: what Cloudflare has when it starts an
 * isolate for the Worker. Node keeps one copy of a module for each address
 * it was asked for under, so a new query string is a new copy, with its
 * top-level values made again. (The modules it imports are shared, as they
 * hold nothing.)
 */
async function newIsolate(): Promise<Entry> {
  started += 1;
  const loaded = (await import(`../src/index.ts?isolate=${started}`)) as { default: Entry };
  return loaded.default;
}

/** The isolate the test's requests go to, unless it names another. */
let worker: Entry;

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

/** What the outside answers, per test: at once, or when the test lets it. Anything a test did not expect to be asked fails it. */
let outside: (call: FetchCall) => Response | Promise<Response> = () => {
  throw new Error('nothing outside should be asked');
};
let asked: FetchCall[] = [];

beforeEach(async () => {
  worker = await newIsolate();
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

async function send(request: Request, env: Env, isolate: Entry = worker): Promise<Response> {
  const response = await isolate.fetch(request, env, context);
  await Promise.all(waiting);
  return response;
}

const get = (path: string): Request => new Request(`${APP}${path}`, { headers: { 'CF-Connecting-IP': READER_IP } });

test("as shipped: the config names the faucet's bot check and says that events are counted", async () => {
  const { env } = bindings();
  const response = await send(get(API.config), env);
  assert.equal(response.status, 200);
  // The site key is the one wrangler.jsonc carries (wrangler.test.ts holds its value), and it is not empty.
  assert.notEqual(VARS.TURNSTILE_SITE_KEY, '');
  assert.deepEqual(await response.json(), {
    turnstileSiteKey: VARS.TURNSTILE_SITE_KEY,
    explorerUrl: 'https://practice-explorer.learnbitcoin.com',
    electrumHost: 'practice-electrum.learnbitcoin.com',
    electrumPort: 50002,
    siteUrl: 'https://www.learnbitcoin.com',
    sourceUrl: 'https://github.com/treib-holdings/learnbitcoin-practice',
    passkeyHost: 'practice.learnbitcoin.com',
    faucetSats: 100000,
    blockSeconds: 30,
    events: true,
  });
  assert.equal(asked.length, 0);
});

test('with the site key and the events site left empty, the faucet answers closed and asks nobody; an event gets its 202 and goes nowhere', async () => {
  // The two settings a copy of this repository may leave empty. Then nobody outside is asked anything.
  const { env, limiters } = bindings({ TURNSTILE_SITE_KEY: '', PLAUSIBLE_DOMAIN: '' });
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
  assert.deepEqual(logged, [], 'a chain read that went well writes nothing to the log');
});

test('the older pages of an address go to the origin as chain reads, on the chain limiter, and write nothing; the page asked for by an ID is counted apart, as 50', async () => {
  outside = () => reply(200, []);
  const { env, limiters } = bindings();
  for (const tail of ['/txs/chain', `/txs/chain/${TXID}`]) {
    const response = await send(get(`${API.esplora}/address/${ADDRESS}${tail}`), env);
    assert.equal(response.status, 200, tail);
    assert.equal(await response.text(), '[]', tail);
    assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
    assert.equal(asked.at(-1)?.url, `${ORIGIN}/esplora/address/${ADDRESS}${tail}`);
    assert.equal(asked.at(-1)?.init.method, 'GET');
  }
  assert.equal(asked.length, 2);
  assert.equal(limiters.CHAIN_LIMIT.keys.length, 2);
  // The binding itself is told how to count each read. The newest 25: one read, under the
  // reader's key and nothing else. The 25 after a given ID: 50, as the weight ("delta") of the
  // call, under a second key of the same reader, so in a count of their own.
  const reader = limiters.CHAIN_LIMIT.keys[0]!;
  assert.match(reader, /^[0-9a-f]{24}$/);
  assert.deepEqual(limiters.CHAIN_LIMIT.costs, [1, OLDER_PAGE_COST]);
  assert.deepEqual(limiters.CHAIN_LIMIT.asked, [{ key: reader }, { key: `${reader}:older-pages`, delta: 50 }]);
  assert.equal(OLDER_PAGE_COST, 50);
  assert.ok(!JSON.stringify(limiters.CHAIN_LIMIT.asked).includes(READER_IP));
  for (const name of ['BROADCAST_LIMIT', 'FAUCET_LIMIT', 'POT_LIMIT', 'EVENTS_LIMIT'] as const) assert.equal(limiters[name].keys.length, 0, name);
  assert.deepEqual(logged, [], 'neither wrote a line');

  // The origin is down: the reader is told "unavailable", and the one line written names no address and no ID.
  outside = () => reply(502, '<html>Bad gateway</html>', 'text/html');
  const failed = await send(get(`${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}`), env);
  assert.equal(failed.status, 502);
  assert.deepEqual(
    logged.map(({ level, line }) => ({ level, line: { ...(line as LogLine), ms: 0 } })),
    [{ level: 'error', line: { route: 'esplora_read', status: 502, upstream: 502, ms: 0, fault: 'origin_down' } }],
  );
  assert.ok(!JSON.stringify(logged).includes(ADDRESS) && !JSON.stringify(logged).includes(TXID));
});

test('a chain read writes to the log only when it ends in a fault', async () => {
  // Workers Logs can keep a request's URL beside each line written in it,
  // and the URL of a chain read holds an address or a transaction ID.
  const address = `${API.esplora}/address/${ADDRESS}`;
  const tx = `${API.esplora}/tx/${TXID}`;

  // It went well.
  outside = () => reply(200, { address: ADDRESS, chain_stats: {}, mempool_stats: {} });
  assert.equal((await send(get(address), bindings().env)).status, 200);
  // The chain does not know the transaction (yet): Esplora's own plain-text 404.
  outside = () => reply(404, 'Transaction not found', 'text/plain');
  const unknown = await send(get(tx), bindings().env);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: 'not_found' });
  // The reader is asking too fast: the origin is not even asked.
  outside = () => {
    throw new Error('nothing outside should be asked');
  };
  const limited = bindings();
  (limited.env as unknown as { CHAIN_LIMIT: unknown }).CHAIN_LIMIT = fakeLimiter(false);
  assert.equal((await send(get(address), limited.env)).status, 429);
  // A wrong method.
  assert.equal((await send(post(address, null), bindings().env)).status, 405);
  assert.deepEqual(logged, [], 'none of these wrote a line, plain or error');

  // Answers that are not the chain speaking: the reader is told "unavailable",
  // and each writes one error line that says whose fault it is.
  const faults: Array<[path: string, answer: Response, upstream: number, fault: string]> = [
    // Esplora's 404 for a path it does not have, and a 404 page from something in between.
    [address, reply(404, 'endpoint does not exist "/x"', 'text/plain'), 404, 'origin_shape'],
    [tx, reply(404, '<html>404 page not found</html>', 'text/html'), 404, 'origin_shape'],
    // Esplora's 400 for text that is no address, said of an address the
    // Worker has checked: the two disagree about what an address is.
    [address, reply(400, 'Invalid Bitcoin address', 'text/plain'), 400, 'origin_shape'],
    // A 200 that is not chain data.
    [address, reply(200, '<html>sign in</html>', 'text/html'), 200, 'origin_shape'],
    [address, reply(502, '<html>Bad gateway</html>', 'text/html'), 502, 'origin_down'],
    [address, reply(302, null), 302, 'origin_auth'],
    [address, reply(403, '<html>Forbidden</html>', 'text/html'), 403, 'origin_auth'],
  ];
  for (const [path, answer, upstream, fault] of faults) {
    logged = [];
    outside = () => answer;
    const response = await send(get(path), bindings().env);
    assert.equal(response.status, 502, fault);
    assert.deepEqual(await response.json(), { error: 'unavailable' }, fault);
    assert.deepEqual(
      logged.map(({ level, line }) => ({ level, line: { ...(line as LogLine), ms: 0 } })),
      [{ level: 'error', line: { route: 'esplora_read', status: 502, upstream, ms: 0, fault } }],
      `${upstream} ${fault}`,
    );
    assert.ok(!JSON.stringify(logged).includes(ADDRESS) && !JSON.stringify(logged).includes(TXID), 'and the line names no address or ID');
  }
});

test('text that only looks like an address never reaches the origin, so it cannot be used to fill the error log', async () => {
  // Esplora answers such text with a 400, and a 400 on a chain read is a
  // fault for the owner to look at. A GET needs no page of ours and passes
  // no bot check, so anyone could send thousands of these a minute.
  outside = () => reply(400, 'Invalid Bitcoin address', 'text/plain');
  const { env, limiters } = bindings();
  const texts = [
    'bcrt1qqqqqqqqqqqq',
    // A real address with its last character changed.
    `${ADDRESS.slice(0, -1)}${ADDRESS.endsWith('q') ? 'p' : 'q'}`,
    `bcrt1${'q'.repeat(71)}`,
    `bcrt1p${'q'.repeat(58)}`,
  ];
  let sent = 0;
  for (let round = 0; round < 50; round += 1) {
    for (const text of texts) {
      for (const tail of ['', '/utxo', '/txs']) {
        const response = await send(get(`${API.esplora}/address/${text}${tail}`), env);
        assert.equal(response.status, 404, text);
        assert.deepEqual(await response.json(), { error: 'not_found' }, text);
        sent += 1;
      }
    }
  }
  assert.equal(sent, 600);
  assert.equal(asked.length, 0, 'the origin was never asked');
  assert.equal(limiters.CHAIN_LIMIT.keys.length, 0, 'and no budget was spent on text that is no address');
  assert.deepEqual(logged, [], 'none of the 600 wrote a line, plain or error');

  // The address itself is still asked about.
  outside = () => reply(200, { address: ADDRESS, chain_stats: {}, mempool_stats: {} });
  assert.equal((await send(get(`${API.esplora}/address/${ADDRESS}`), env)).status, 200);
  assert.equal(asked.length, 1);
  assert.equal(asked[0]?.url, `${ORIGIN}/esplora/address/${ADDRESS}`);
});

test('a path under the Esplora prefix that the Worker does not carry writes nothing to the log either', async () => {
  // Its URL can hold an address or a transaction ID like that of a chain read.
  const { env } = bindings();
  const paths = [
    `${API.esplora}/tx/${TXID}/hex`,
    `${API.esplora}/address/${ADDRESS}/txs/mempool`,
    `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}/`,
    `${API.esplora}/address/${ADDRESS}/txs/chain?max_txs=100`,
    `${API.esplora}/address/${ADDRESS}/`,
    `${API.esplora}/address/${ADDRESS}?x=1`,
    `${API.esplora}/address/${ADDRESS.toUpperCase()}`,
    `${API.esplora}/tx?txid=${TXID}`,
  ];
  for (const path of paths) {
    const response = await send(get(path), env);
    assert.equal(response.status, 404, path);
    assert.deepEqual(await response.json(), { error: 'not_found' }, path);
    assert.equal((await send(post(path, null), env)).status, 404, path);
  }
  assert.equal(asked.length, 0);
  assert.deepEqual(logged, [], 'none of these wrote a line');

  // Outside the prefix an unknown path writes its line as ever, and the line holds nothing of the path.
  await send(get(`/api/nothing/${ADDRESS}`), env);
  // The broadcast keeps its line too: its URL is the same for everyone.
  await send(get(`${API.esplora}/tx`), env);
  assert.deepEqual(
    logged.map(({ level, line }) => ({ level, line: { ...(line as LogLine), ms: 0 } })),
    [
      { level: 'log', line: { route: 'unknown', status: 404, upstream: null, ms: 0, fault: null } },
      { level: 'log', line: { route: 'esplora_broadcast', status: 405, upstream: null, ms: 0, fault: null } },
    ],
  );
});

test('each route counts against its own limiter binding', async () => {
  outside = (call) => {
    if (call.url.endsWith('/esplora/tx')) return reply(200, TXID);
    if (call.url.endsWith('/bots/pot/address')) return reply(200, { address: POT_ADDRESS });
    if (call.url.endsWith('/bots/pot/stats')) return reply(200, { learners_passed_on: 1, coins_waiting: 1, coins_passed_to_newcomers: 0 });
    return reply(200, '1', 'text/plain');
  };
  const routes: Array<[keyof Limiters, Request]> = [
    ['CHAIN_LIMIT', get(`${API.esplora}/address/${ADDRESS}/utxo`)],
    ['BROADCAST_LIMIT', post(`${API.esplora}/tx`, '00ff')],
    ['FAUCET_LIMIT', post(API.faucet, { address: ADDRESS, token: 'a-token' })],
    ['POT_LIMIT', post(API.potAddress, null)],
    ['POT_LIMIT', get(API.potStats)],
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

test('the pot counts go to the configured origin with the Access token and no bearer token, and are counted apart at the pot limiter', async () => {
  // What the bots answer (bots/practice_bots/bots.py): five fields. Three of them cross.
  outside = () => reply(200, { learners_passed_on: 128, sats_received: 3_840_000, coins_waiting: 3, coins_passed_to_newcomers: 125, faucet_payments: 400 });
  const { env, limiters } = bindings();
  const response = await send(get(API.potStats), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"passedOn":128,"waiting":3,"handedOn":125}');
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  for (const [name, value] of Object.entries(FIXED_HEADERS)) assert.equal(response.headers.get(name), value, name);
  response.headers.forEach((_value, name) => assert.ok(!name.toLowerCase().startsWith('access-control-'), name));

  assert.equal(asked.length, 1);
  assert.equal(asked[0]?.url, `${ORIGIN}/bots/pot/stats`);
  assert.equal(asked[0]?.init.method, 'GET');
  assert.deepEqual(asked[0]?.headers, {
    'cf-access-client-id': 'client-id',
    'cf-access-client-secret': 'client-secret',
    'x-real-ip': '192.0.2.1',
  });
  assert.ok(!JSON.stringify(asked).includes(READER_IP) && !JSON.stringify(asked).includes('bots-token'));

  // The binding is told to count it under a second key of the reader's, as one.
  const address = bindings();
  outside = () => reply(200, { address: POT_ADDRESS });
  await send(post(API.potAddress, null), address.env);
  const reader = address.limiters.POT_LIMIT.keys[0]!;
  assert.match(reader, /^[0-9a-f]{24}$/);
  assert.equal(POT_STATS, 'stats');
  assert.deepEqual(limiters.POT_LIMIT.asked, [{ key: `${reader}:stats` }]);
  for (const name of ['CHAIN_LIMIT', 'BROADCAST_LIMIT', 'FAUCET_LIMIT', 'EVENTS_LIMIT'] as const) assert.equal(limiters[name].keys.length, 0, name);
  assert.deepEqual(
    logged.map(({ level, line }) => ({ level, line: { ...(line as LogLine), ms: 0 } })),
    [
      { level: 'log', line: { route: 'pot_stats', status: 200, upstream: 200, ms: 0, fault: null } },
      { level: 'log', line: { route: 'pot_address', status: 200, upstream: 200, ms: 0, fault: null } },
    ],
  );

  // With no bots token set the counts are still asked for: they need none. The address does.
  // (A Worker that has just been started, so that it has no counts yet and must ask.)
  logged = [];
  outside = () => reply(200, { learners_passed_on: 0, coins_waiting: 0, coins_passed_to_newcomers: 0 });
  const bare = bindings({ BOTS_API_TOKEN: undefined });
  const untokened = await newIsolate();
  assert.deepEqual(await (await send(get(API.potStats), bare.env, untokened)).json(), { passedOn: 0, waiting: 0, handedOn: 0 });
  assert.equal(asked.at(-1)?.url, `${ORIGIN}/bots/pot/stats`);
  assert.equal(asked.at(-1)?.headers.authorization, undefined);
  assert.equal((await send(post(API.potAddress, null), bare.env, untokened)).status, 502);

  // An origin that is down: "unavailable", and one error line. (Again a Worker with no counts yet.)
  logged = [];
  outside = () => reply(502, '<html>Bad gateway</html>', 'text/html');
  const failed = await send(get(API.potStats), bindings().env, await newIsolate());
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'unavailable' });
  assert.deepEqual(
    logged.map(({ level, line }) => ({ level, line: { ...(line as LogLine), ms: 0 } })),
    [{ level: 'error', line: { route: 'pot_stats', status: 502, upstream: 502, ms: 0, fault: 'origin_down' } }],
  );
});

/** What the bots answer when asked for the pot's counts, with `passedOn` payments passed on. */
const botsCounts = (passedOn: number): Response => reply(200, { learners_passed_on: passedOn, sats_received: 60_000 * passedOn, coins_waiting: 0, coins_passed_to_newcomers: 0, faucet_payments: 9 });

/**
 * Runs `body` with the runtime's clock in the test's hands. index.ts reads
 * Date.now itself: `move` puts it that many milliseconds after the moment
 * the test took it over. The real clock is put back at the end.
 */
async function withClock(body: (move: (ms: number) => void) => Promise<void>): Promise<void> {
  const real = Date.now;
  const began = real.call(Date);
  let ahead = 0;
  Date.now = () => began + ahead;
  try {
    await body((ms) => {
      ahead = ms;
    });
  } finally {
    Date.now = real;
  }
}

/** A look at the pot's counts by reader number `n`, with bindings of its own, as every request to the deployed Worker has. */
async function look(n: number, isolate: Entry = worker): Promise<{ response: Response; limiters: Limiters }> {
  const { env, limiters } = bindings();
  const request = new Request(`${APP}${API.potStats}`, { headers: { 'CF-Connecting-IP': `198.51.100.${n + 1}` } });
  return { response: await send(request, env, isolate), limiters };
}

test('the pot counts outlive a request: one isolate asks the origin once for many readers, again when the counts are 15 seconds old, and a new isolate starts with none', async () => {
  let questions = 0;
  outside = (call) => {
    assert.equal(call.url, `${ORIGIN}/bots/pot/stats`);
    questions += 1;
    return botsCounts(questions);
  };
  await withClock(async (move) => {
    // Twenty readers, one after another. For each the entry builds everything anew: the settings,
    // the way to the origin, the handler. What it does not build anew is the holder of the counts.
    for (let n = 0; n < 20; n += 1) {
      const { response, limiters } = await look(n);
      assert.equal(response.status, 200, `reader ${n}`);
      assert.equal(await response.text(), '{"passedOn":1,"waiting":0,"handedOn":0}', `reader ${n}`);
      for (const [name, value] of Object.entries(FIXED_HEADERS)) assert.equal(response.headers.get(name), value, name);
      assert.equal(limiters.POT_LIMIT.keys.length, 1, 'each reader is counted at the pot limiter, kept counts or not');
    }
    assert.equal(asked.length, 1, 'the origin was asked once for the twenty of them');
    // One line for each. The first asked the origin; the others were given the kept counts and asked nobody.
    assert.deepEqual(
      logged.map(({ level, line }) => [level, (line as LogLine).route, (line as LogLine).status, (line as LogLine).upstream, (line as LogLine).fault]),
      [['log', 'pot_stats', 200, 200, null], ...Array.from({ length: 19 }, () => ['log', 'pot_stats', 200, null, null])],
    );

    // A millisecond before the counts are 15 seconds old they are still given. At 15 seconds the origin is asked.
    move(POT_STATS_KEEP_MS - 1);
    assert.deepEqual(await (await look(20)).response.json(), { passedOn: 1, waiting: 0, handedOn: 0 });
    assert.equal(asked.length, 1);
    move(POT_STATS_KEEP_MS);
    assert.deepEqual(await (await look(21)).response.json(), { passedOn: 2, waiting: 0, handedOn: 0 });
    assert.deepEqual(await (await look(22)).response.json(), { passedOn: 2, waiting: 0, handedOn: 0 });
    assert.equal(asked.length, 2);

    // Another isolate of the same Worker (another machine, another location, or this one started
    // again) has kept nothing: it asks for itself, once.
    const other = await newIsolate();
    assert.deepEqual(await (await look(23, other)).response.json(), { passedOn: 3, waiting: 0, handedOn: 0 });
    assert.deepEqual(await (await look(24, other)).response.json(), { passedOn: 3, waiting: 0, handedOn: 0 });
    assert.equal(asked.length, 3);
    // And the first isolate still has its own.
    assert.deepEqual(await (await look(25)).response.json(), { passedOn: 2, waiting: 0, handedOn: 0 });
    assert.equal(asked.length, 3);
  });
  assert.ok(!JSON.stringify(asked).includes('198.51.100.'), 'no reader address went to the origin');
});

test('requests that reach one isolate while the origin is being asked for the pot counts share that one question, and it is handed to waitUntil once', async () => {
  let answer: (response: Response) => void = () => {};
  outside = () =>
    new Promise<Response>((resolve) => {
      answer = resolve;
    });
  const readers = Array.from({ length: 25 }, () => bindings());
  const answers = readers.map(({ env }, n) => worker.fetch(new Request(`${APP}${API.potStats}`, { headers: { 'CF-Connecting-IP': `198.51.100.${n + 1}` } }), env, context));
  // Every one of them is counted at its limiter first. One turn later each has asked the origin or waits for the question that is out.
  for (let turns = 0; readers.some(({ limiters }) => limiters.POT_LIMIT.keys.length === 0); turns += 1) {
    assert.ok(turns < 10_000, 'not every request reached its limiter');
    await new Promise((resolve) => setImmediate(resolve));
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(asked.length, 1, 'one question is out, not twenty-five');
  assert.equal(waiting.length, 1, 'handed to waitUntil by the request that asked, so that it is seen through if that reader leaves');

  answer(botsCounts(4));
  for (const each of answers) {
    const response = await each;
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"passedOn":4,"waiting":0,"handedOn":0}');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  await Promise.all(waiting);
  assert.equal(asked.length, 1);
  assert.equal(logged.length, 25);
  for (const { level, line } of logged) assert.deepEqual([level, (line as LogLine).route, (line as LogLine).status, (line as LogLine).upstream], ['log', 'pot_stats', 200, 200]);
});

test('pot counts the origin could not give are not kept by the isolate: the next request asks again, and old counts are not given once they have run out', async () => {
  await withClock(async (move) => {
    // A 200 whose body is not the three counts, then an origin that is down, then one that never answers in time.
    const bad: Array<[answer: () => Response, upstream: number | null, fault: string]> = [
      [() => reply(200, { learners_passed_on: '4', coins_waiting: 1, coins_passed_to_newcomers: 3 }), 200, 'origin_shape'],
      [() => reply(200, '<html>sign in</html>', 'text/html'), 200, 'origin_shape'],
      [() => reply(502, '<html>Bad gateway</html>', 'text/html'), 502, 'origin_down'],
      [() => reply(302, null), 302, 'origin_auth'],
    ];
    for (const [n, [respond, upstream, fault]] of bad.entries()) {
      logged = [];
      outside = respond;
      const { response } = await look(n);
      assert.equal(response.status, 502, fault);
      assert.deepEqual(await response.json(), { error: 'unavailable' }, fault);
      assert.equal(asked.length, n + 1, 'each of them asked: nothing was kept from the one before');
      assert.deepEqual(
        logged.map(({ level, line }) => ({ level, line: { ...(line as LogLine), ms: 0 } })),
        [{ level: 'error', line: { route: 'pot_stats', status: 502, upstream, ms: 0, fault } }],
      );
    }

    // A good answer is kept, and given while it is young, also when the origin has gone down meanwhile.
    outside = () => botsCounts(6);
    assert.deepEqual(await (await look(10)).response.json(), { passedOn: 6, waiting: 0, handedOn: 0 });
    assert.equal(asked.length, bad.length + 1);
    outside = () => reply(502, '<html>Bad gateway</html>', 'text/html');
    move(POT_STATS_KEEP_MS - 1);
    assert.deepEqual(await (await look(11)).response.json(), { passedOn: 6, waiting: 0, handedOn: 0 });
    assert.equal(asked.length, bad.length + 1, 'not asked: the kept counts were young enough');
    // Once they are 15 seconds old they are not given any more: the reader is told "unavailable".
    move(POT_STATS_KEEP_MS);
    const late = await look(12);
    assert.equal(late.response.status, 502);
    assert.deepEqual(await late.response.json(), { error: 'unavailable' });
    assert.equal(asked.length, bad.length + 2);
  });
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

test('a token solved for another form or another address is a failed bot check: 403, and nothing is logged as an error', async () => {
  // The verify service accepts each of these tokens. They were solved on
  // this host, so the widget and the Worker agree about where the app
  // lives; the reader can run the check again.
  const accepted = { success: true, hostname: 'practice.learnbitcoin.com', 'error-codes': [] };
  const answers = [
    { ...accepted, action: 'newsletter', cdata: ADDRESS },
    { ...accepted, cdata: ADDRESS },
    { ...accepted, action: 'faucet', cdata: POT_ADDRESS },
    { ...accepted, action: 'faucet' },
    { ...accepted, action: 'newsletter', cdata: POT_ADDRESS },
  ];
  for (const answer of answers) {
    outside = (call) => {
      assert.equal(call.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify', 'the bots are not asked');
      return reply(200, answer);
    };
    const { env } = bindings({ TURNSTILE_SITE_KEY: 'site-key' });
    const response = await send(post(API.faucet, { address: ADDRESS, token: 'a-token' }), env);
    assert.equal(response.status, 403, JSON.stringify(answer));
    assert.deepEqual(await response.json(), { error: 'bot_check' });
  }
  assert.equal(asked.length, answers.length);
  assert.deepEqual(
    logged.map(({ level, line }) => ({ level, line: { ...(line as LogLine), ms: 0 } })),
    answers.map(() => ({ level: 'log', line: { route: 'faucet', status: 403, upstream: 200, ms: 0, fault: null } })),
  );
});

test("of the bots' refusals only the faucet's own reach the app; any other is unavailable, and logged as a fault", async () => {
  const verified = { success: true, hostname: 'practice.learnbitcoin.com', action: 'faucet', cdata: ADDRESS, 'error-codes': [] };
  const ask = async (bots: Response): Promise<Response> => {
    logged = [];
    outside = (call) => (call.url.startsWith('https://challenges.cloudflare.com/') ? reply(200, verified) : bots);
    return send(post(API.faucet, { address: ADDRESS, token: 'a-token' }), bindings({ TURNSTILE_SITE_KEY: 'site-key' }).env);
  };
  const lines = () => logged.map(({ level, line }) => ({ level, line: { ...(line as LogLine), ms: 0 } }));

  // The faucet's own: the reader is told why, under the status the bots sent.
  const paid = await ask(reply(429, { error: 'This address already got practice coins today', code: 'already_paid' }));
  assert.equal(paid.status, 429);
  assert.deepEqual(await paid.json(), { error: 'already_paid' });
  assert.deepEqual(lines(), [{ level: 'log', line: { route: 'faucet', status: 429, upstream: 429, ms: 0, fault: null } }]);

  const refilling = await ask(reply(503, { error: 'The faucet is refilling; try again in a minute', code: 'refilling' }));
  assert.equal(refilling.status, 503);
  assert.deepEqual(await refilling.json(), { error: 'refilling' });
  assert.deepEqual(lines(), [{ level: 'log', line: { route: 'faucet', status: 503, upstream: 503, ms: 0, fault: null } }]);

  // Not the faucet's own. The bots answer a body they cannot read with
  // "bad_request", and the Worker wrote that body: the reader did nothing wrong.
  const others: Array<[bots: Response, upstream: number, fault: string]> = [
    [reply(400, { error: 'Send JSON like {"address": "bcrt1..."}', code: 'bad_request' }), 400, 'origin_shape'],
    [reply(404, { error: 'not found', code: 'not_found' }), 404, 'origin_shape'],
    [reply(429, 'Too many requests', 'text/plain'), 429, 'origin_shape'],
    [reply(502, { error: 'The practice network could not do that just now', code: 'unavailable' }), 502, 'origin_down'],
    [reply(500, { error: 'Something went wrong', code: 'error' }), 500, 'origin_down'],
    [reply(401, { error: 'unauthorized', code: 'unauthorized' }), 401, 'origin_auth'],
  ];
  for (const [bots, upstream, fault] of others) {
    const response = await ask(bots);
    assert.equal(response.status, 502, `${upstream}`);
    assert.deepEqual(await response.json(), { error: 'unavailable' }, `${upstream}`);
    assert.deepEqual(lines(), [{ level: 'error', line: { route: 'faucet', status: 502, upstream, ms: 0, fault } }], `${upstream}`);
  }
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

test('an event the events service drops writes a plain line, whatever it was dropped for; one it refuses, or never answers, writes an error line', async () => {
  const event = { name: 'pageview', path: '/' };
  // The user agent is the visitor's to choose, and it is one of the things that get an event dropped.
  const robot = { 'User-Agent': 'curl/8.7.1' };
  const { env } = bindings({ PLAUSIBLE_DOMAIN: 'counted.example' });

  outside = () => new Response('ok', { status: 202, headers: { 'x-plausible-dropped': '1' } });
  for (let n = 0; n < 3; n += 1) assert.equal((await send(post(API.event, event, robot), env)).status, 202);
  assert.equal(asked.length, 3);
  assert.equal(asked[0]?.headers['user-agent'], 'curl/8.7.1');
  assert.deepEqual(
    logged.map(({ level, line }) => ({ level, line: { ...(line as LogLine), ms: 0 } })),
    [0, 1, 2].map(() => ({ level: 'log', line: { route: 'event', status: 202, upstream: 202, ms: 0, fault: null } })),
    'three dropped events, and not one error line',
  );

  // The service gives the same answer to every event sent under a domain it does not know (so
  // its source has it). A misspelled PLAUSIBLE_DOMAIN therefore writes the same plain lines as
  // a good one, while every event is thrown away: the log cannot show that mistake. What shows
  // it is the service's own dashboard (wrangler.jsonc says so at the setting).
  logged = [];
  const browser = { 'User-Agent': 'Mozilla/5.0 (a browser)' };
  const known = (call: FetchCall): boolean => (JSON.parse(call.init.body as string) as { domain: string }).domain === 'counted.example';
  outside = (call) => new Response('ok', { status: 202, headers: known(call) ? {} : { 'x-plausible-dropped': '1' } });
  assert.equal((await send(post(API.event, event, browser), env)).status, 202);
  assert.equal((await send(post(API.event, event, browser), bindings({ PLAUSIBLE_DOMAIN: 'countd.example' }).env)).status, 202);
  assert.deepEqual(asked.slice(-2).map(known), [true, false], 'the second went out under the misspelled name');
  assert.deepEqual(
    logged.map(({ level, line }) => ({ level, line: { ...(line as LogLine), ms: 0 } })),
    [0, 1].map(() => ({ level: 'log', line: { route: 'event', status: 202, upstream: 202, ms: 0, fault: null } })),
    'a counted event and one lost to a wrong domain: the same line',
  );

  // A real failure still tells the owner: the service refuses the event, or cannot be reached.
  logged = [];
  outside = () => reply(500, 'no');
  assert.equal((await send(post(API.event, event, robot), env)).status, 202);
  outside = () => {
    throw new TypeError('fetch failed');
  };
  assert.equal((await send(post(API.event, event, robot), env)).status, 202);
  assert.deepEqual(
    logged.map(({ level, line }) => ({ level, line: { ...(line as LogLine), ms: 0 } })),
    [
      { level: 'error', line: { route: 'event', status: 202, upstream: 500, ms: 0, fault: 'events_down' } },
      { level: 'error', line: { route: 'event', status: 202, upstream: null, ms: 0, fault: 'events_down' } },
    ],
  );
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
