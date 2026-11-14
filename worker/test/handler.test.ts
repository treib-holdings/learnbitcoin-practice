import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API, ERROR_STATUS } from '@learnbitcoin/practice-contract';
import type { ErrorCode } from '@learnbitcoin/practice-contract';
import type { Fault } from '../src/deps.ts';
import { EVENT_BODY_MAX, FAUCET_BODY_MAX, TX_HEX_MAX, esploraReadPath, makeHandler } from '../src/handler.ts';
import { FIXED_HEADERS } from '../src/headers.ts';
import { readerKey } from '../src/reader-key.ts';
import {
  ADDRESS,
  APP,
  CONFIG,
  POT_ADDRESS,
  READER_IP,
  READER_IP6,
  TXID,
  errorOf,
  get,
  harness,
  noNetwork,
  post,
} from './fakes.ts';
import type { Harness, HarnessOptions } from './fakes.ts';

noNetwork();

const HEX = '0200000001abcdef';
const TOKEN = 'token-from-the-widget';
const FAUCET_BODY = { address: ADDRESS, token: TOKEN };
const EVENT = { name: 'Passkey', path: '/new', value: 'ok' };

/** One good POST for each of the four POST routes. */
const POSTS: Array<[path: string, body: string | object | null]> = [
  [`${API.esplora}/tx`, HEX],
  [API.faucet, FAUCET_BODY],
  [API.potAddress, null],
  [API.event, EVENT],
];

async function run(
  request: Request,
  options: HarnessOptions = {},
): Promise<{ response: Response; h: Harness; request: Request }> {
  const h = harness(options);
  const response = await makeHandler(h.deps)(request);
  await Promise.all(h.pending);
  return { response, h, request };
}

/** Checks a refusal: its status, its body, and that nothing outside was asked unless `asked` says so. */
async function refusedWith(
  request: Request,
  code: ErrorCode,
  asked: string[] = [],
  options: HarnessOptions = {},
): Promise<Harness> {
  const { response, h } = await run(request, options);
  assert.equal(response.status, ERROR_STATUS[code], `${request.method} ${request.url}`);
  assert.deepEqual(await errorOf(response), { error: code }, `${request.method} ${request.url}`);
  assert.deepEqual(h.trace, asked, `${request.method} ${request.url}`);
  return h;
}

// -- config ---------------------------------------------------------------------

test('GET /api/config answers the config, numbers as numbers', async () => {
  const { response, h } = await run(get(API.config));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), CONFIG);
  assert.match(text, /"electrumPort":50002,/);
  assert.deepEqual(h.trace, [], 'no limiter and no origin for a constant answer');
  assert.deepEqual(h.lines, [{ route: 'config', status: 200, upstream: null, ms: 5, fault: null }]);
});

// -- the Esplora allowlist --------------------------------------------------------

const READS: Array<[path: string, upstream: string]> = [
  [`${API.esplora}/blocks/tip/height`, '/blocks/tip/height'],
  [`${API.esplora}/address/${ADDRESS}`, `/address/${ADDRESS}`],
  [`${API.esplora}/address/${ADDRESS}/utxo`, `/address/${ADDRESS}/utxo`],
  [`${API.esplora}/address/${ADDRESS}/txs`, `/address/${ADDRESS}/txs`],
  [`${API.esplora}/tx/${TXID}`, `/tx/${TXID}`],
];

test('the five chain reads reach the origin, each with a path rebuilt from its checked parts', async () => {
  for (const [path, upstream] of READS) {
    const { response, h } = await run(get(path));
    assert.equal(response.status, 200, path);
    assert.deepEqual(h.trace, ['limit:chain', 'origin:esplora'], path);
    assert.deepEqual(h.originArgs, [upstream], path);
    assert.equal(await response.text(), '{"ok":true}', 'the body is passed on');
    assert.deepEqual(h.lines, [{ route: 'esplora_read', status: 200, upstream: 200, ms: 5, fault: null }]);
  }
  // A taproot address is as good as a segwit one.
  const taproot = `bcrt1p${'q'.repeat(58)}`;
  const { h } = await run(get(`${API.esplora}/address/${taproot}/txs`));
  assert.deepEqual(h.originArgs, [`/address/${taproot}/txs`]);
});

test('a chain read is sent with the content type the Worker picks, never the origin headers', async () => {
  const json = await run(get(`${API.esplora}/tx/${TXID}`), {
    esplora: () => ({ ok: true, value: { body: new Response('{"txid":"x"}').body, type: 'json' }, upstream: 200 }),
  });
  assert.equal(json.response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  const text = await run(get(`${API.esplora}/blocks/tip/height`), {
    esplora: () => ({ ok: true, value: { body: new Response('6326').body, type: 'text' }, upstream: 200 }),
  });
  assert.equal(text.response.headers.get('Content-Type'), 'text/plain; charset=utf-8');
  assert.equal(await text.response.text(), '6326');
});

/** Paths that must never reach the origin. Each is given as typed; the comment says what it tries. */
const TRICKS: string[] = [
  // Not one of the five shapes.
  API.esplora,
  `${API.esplora}/`,
  `${API.esplora}/blocks`,
  `${API.esplora}/blocks/tip`,
  `${API.esplora}/blocks/tip/hash`,
  `${API.esplora}/address`,
  `${API.esplora}/address/`,
  `${API.esplora}/fee-estimates`,
  `${API.esplora}/mempool`,
  `${API.esplora}/tx/${TXID}/hex`,
  `${API.esplora}/tx/${TXID}/status`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}`,
  `${API.esplora}/address/${ADDRESS}/txs/mempool`,
  `${API.esplora}/address/${ADDRESS}/utxo/extra`,
  `${API.esplora}/address/${ADDRESS}/${ADDRESS}`,
  `${API.esplora}/tx/${TXID}/${TXID}`,
  // A trailing slash, a doubled slash.
  `${API.esplora}/blocks/tip/height/`,
  `${API.esplora}/address/${ADDRESS}/`,
  `${API.esplora}/address/${ADDRESS}/utxo/`,
  `${API.esplora}/tx/${TXID}/`,
  `${API.esplora}//blocks/tip/height`,
  `${API.esplora}/blocks//tip/height`,
  `${API.esplora}/address//${ADDRESS}`,
  `/api//esplora/blocks/tip/height`,
  `//api/esplora/blocks/tip/height`,
  // Upper case.
  `${API.esplora}/Blocks/tip/height`,
  `${API.esplora}/blocks/tip/HEIGHT`,
  `/API/esplora/blocks/tip/height`,
  `/api/Esplora/blocks/tip/height`,
  `${API.esplora}/address/${ADDRESS.toUpperCase()}`,
  `${API.esplora}/address/${ADDRESS}/UTXO`,
  `${API.esplora}/tx/${TXID.toUpperCase()}`,
  `${API.esplora}/TX/${TXID}`,
  // A query string.
  `${API.esplora}/blocks/tip/height?`.concat('x=1'),
  `${API.esplora}/address/${ADDRESS}?after=${TXID}`,
  `${API.esplora}/address/${ADDRESS}/txs?x`,
  `${API.esplora}/tx/${TXID}?/../../bots/health`,
  // Not an address, not a transaction ID.
  `${API.esplora}/address/bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq`,
  `${API.esplora}/address/tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx`,
  `${API.esplora}/address/bcrt1qnotanaddress`,
  `${API.esplora}/address/bcrt1`,
  `${API.esplora}/address/${ADDRESS}x!`,
  `${API.esplora}/address/${ADDRESS};a=b`,
  `${API.esplora}/address/${ADDRESS}%00`,
  `${API.esplora}/address/${ADDRESS}%0a`,
  `${API.esplora}/address/%62crt1${ADDRESS.slice(5)}`,
  `${API.esplora}/address/${ADDRESS}.json`,
  `${API.esplora}/tx/${TXID.slice(0, 63)}`,
  `${API.esplora}/tx/${TXID}0`,
  `${API.esplora}/tx/${'g'.repeat(64)}`,
  `${API.esplora}/tx/${TXID.slice(0, 62)}%61`,
  // Dot segments, plain and percent-encoded, and encoded slashes: the ways
  // to climb out of /esplora/ and into /bots/ on the origin.
  `${API.esplora}/../bots/pot/address`,
  `${API.esplora}/../bots/health`,
  `${API.esplora}/address/../../bots/faucet`,
  `${API.esplora}/blocks/tip/height/../../../../bots/pot/address`,
  `${API.esplora}/%2e%2e/bots/pot/address`,
  `${API.esplora}/%2E%2E/bots/health`,
  `${API.esplora}/.%2e/bots/health`,
  `${API.esplora}/%2e./bots/health`,
  `${API.esplora}/..%2fbots%2fpot%2faddress`,
  `${API.esplora}/..%2Fbots/faucet`,
  `${API.esplora}/%2e%2e%2fbots%2fhealth`,
  `${API.esplora}/..%252fbots%252fhealth`,
  `${API.esplora}/address/..%2f..%2fbots%2fpot%2faddress`,
  `${API.esplora}/address/${ADDRESS}%2f..%2f..%2fbots%2fpot%2faddress`,
  `${API.esplora}/address/${ADDRESS}/..%2f..%2f..%2fbots%2fhealth`,
  `${API.esplora}/address/${ADDRESS}/%2e%2e/%2e%2e/%2e%2e/bots/health`,
  `${API.esplora}/tx/..%2f..%2fbots%2fhealth`,
  `${API.esplora}/tx/${TXID}%2f..%2f..%2f..%2fbots%2fpot%2faddress`,
  `${API.esplora}\\..\\bots\\health`,
  `${API.esplora}/..;/bots/health`,
  // The origin's own prefixes, asked for directly.
  `${API.esplora}/bots/health`,
  `${API.esplora}/bots/pot/address`,
  `/api/bots/health`,
  `/api/bots/faucet`,
  `/api/bots/pot/address`,
  `/bots/faucet`,
  `/esplora/blocks/tip/height`,
];

test('path tricks get a JSON 404 and reach nothing', async () => {
  for (const path of TRICKS) {
    await refusedWith(get(path), 'not_found');
    // The same path as a POST from our own page gets no further.
    await refusedWith(post(path, HEX), 'not_found');
  }
});

test('the path check itself, part by part', () => {
  assert.equal(esploraReadPath(['blocks', 'tip', 'height']), '/blocks/tip/height');
  assert.equal(esploraReadPath(['address', ADDRESS]), `/address/${ADDRESS}`);
  assert.equal(esploraReadPath(['address', ADDRESS, 'utxo']), `/address/${ADDRESS}/utxo`);
  assert.equal(esploraReadPath(['address', ADDRESS, 'txs']), `/address/${ADDRESS}/txs`);
  assert.equal(esploraReadPath(['tx', TXID]), `/tx/${TXID}`);
  const bad: string[][] = [
    [],
    [''],
    ['blocks'],
    ['blocks', 'tip'],
    ['blocks', 'tip', 'height', ''],
    ['blocks', 'tip', 'height', 'x'],
    ['address'],
    ['address', ''],
    ['address', ADDRESS, ''],
    ['address', ADDRESS, 'utxo', ''],
    ['address', ADDRESS, 'txs', 'chain'],
    ['address', `${ADDRESS}\n`],
    ['address', ` ${ADDRESS}`],
    ['address', '..'],
    ['address', '..', '..', 'bots'],
    ['tx'],
    ['tx', ''],
    ['tx', TXID, ''],
    ['tx', TXID, 'hex'],
    ['tx', `${TXID}\n`],
    ['tx', '..'],
    ['..', 'bots', 'health'],
    ['bots', 'health'],
  ];
  for (const parts of bad) assert.equal(esploraReadPath(parts), null, JSON.stringify(parts));
  // Whatever comes back is made only of lower-case letters, digits and single slashes.
  for (const [path] of READS) {
    const rebuilt = esploraReadPath(path.slice(API.esplora.length + 1).split('/'));
    assert.match(rebuilt ?? '', /^(\/[a-z0-9]+)+$/);
  }
});

test('other unknown paths under /api/ and /p/ get the same JSON 404', async () => {
  const unknown = [
    '/api',
    '/api/',
    '/api/nothing',
    '/api/config/',
    '/api/config/x',
    '/api/Config',
    '/api/config?x=1',
    '/api/faucet/',
    '/api/faucet?address=x',
    '/api/pot',
    '/api/pot/',
    '/api/pot/stats',
    '/api/pot/address/',
    '/p',
    '/p/',
    '/p/event/',
    '/p/event?x=1',
    '/p/script.js',
    '/p/api/event',
    '/',
    '/wallet',
  ];
  for (const path of unknown) {
    const h = await refusedWith(get(path), 'not_found');
    assert.deepEqual(h.lines, [{ route: 'unknown', status: 404, upstream: null, ms: 5, fault: null }], path);
    await refusedWith(post(path, FAUCET_BODY), 'not_found');
  }
  // An empty query string is no query string.
  const { response } = await run(get('/api/config?'));
  assert.equal(response.status, 200);
});

// -- methods ----------------------------------------------------------------------

test('a wrong method on a known path is 405, with the method that is right', async () => {
  const known: Array<[path: string, right: 'GET' | 'POST', route: string]> = [
    [API.config, 'GET', 'config'],
    ...READS.map(([path]): [string, 'GET', string] => [path, 'GET', 'esplora_read']),
    [`${API.esplora}/tx`, 'POST', 'esplora_broadcast'],
    [API.faucet, 'POST', 'faucet'],
    [API.potAddress, 'POST', 'pot_address'],
    [API.event, 'POST', 'event'],
  ];
  for (const [path, right, route] of known) {
    for (const method of ['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      if (method === right) continue;
      const body = method === 'GET' || method === 'HEAD' ? undefined : 'x';
      const request = new Request(`${APP}${path}`, { method, headers: { Origin: APP }, body });
      const { response, h } = await run(request);
      assert.equal(response.status, 405, `${method} ${path}`);
      assert.equal(response.headers.get('Allow'), right, `${method} ${path}`);
      if (method !== 'HEAD') assert.deepEqual(await errorOf(response), { error: 'method' });
      assert.deepEqual(h.trace, [], `${method} ${path}`);
      assert.deepEqual(h.lines, [{ route, status: 405, upstream: null, ms: 5, fault: null }]);
    }
  }
});

// -- same origin --------------------------------------------------------------------

test('a POST from one of our own pages passes the same-origin check, on all four routes', async () => {
  for (const [path, body] of POSTS) {
    // The usual case: a script on our page, so the browser names our origin.
    assert.ok((await run(post(path, body))).response.status < 300, path);
    // No Origin header, but the browser itself says same-origin.
    assert.ok((await run(post(path, body, { Origin: '', 'Sec-Fetch-Site': 'same-origin' }))).response.status < 300, path);
    // The literal "null" (a no-referrer page, a request not in CORS mode) with the browser's same-origin.
    assert.ok((await run(post(path, body, { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' }))).response.status < 300, path);
  }
});

test('any other POST is 403 forbidden before anything is read or asked, on all four routes', async () => {
  const strangers: Array<Record<string, string>> = [
    // Another site, a sibling host, another scheme, another port, a look-alike.
    { Origin: 'https://evil.example' },
    { Origin: 'https://www.learnbitcoin.com' },
    { Origin: 'https://learnbitcoin.com' },
    { Origin: 'http://practice.learnbitcoin.com' },
    { Origin: 'https://practice.learnbitcoin.com:8443' },
    { Origin: 'https://practice.learnbitcoin.com.evil.example' },
    { Origin: 'https://PRACTICE.learnbitcoin.com' },
    { Origin: `${APP}/` },
    // A wrong Origin is not rescued by Sec-Fetch-Site.
    { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'same-origin' },
    // No Origin, and the browser does not say same-origin.
    { Origin: '', 'Sec-Fetch-Site': 'same-site' },
    { Origin: '', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: '', 'Sec-Fetch-Site': 'none' },
    // Neither header: a script or curl.
    { Origin: '' },
    // An opaque origin (a sandboxed frame).
    { Origin: 'null' },
    { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'null', 'Sec-Fetch-Site': 'same-site' },
  ];
  for (const [path, body] of POSTS) {
    for (const headers of strangers) {
      const h = await refusedWith(post(path, body, headers), 'forbidden');
      assert.equal(h.lines.length, 1);
      assert.equal(h.lines[0]?.status, 403);
    }
  }
});

test('the origin a POST must match is the one the request was sent to, whatever that is', async () => {
  const local = (origin: string): Request =>
    new Request('http://localhost:8787/api/pot/address', { method: 'POST', headers: { Origin: origin } });
  assert.equal((await run(local('http://localhost:8787'))).response.status, 200);
  for (const other of ['http://localhost:5173', 'http://127.0.0.1:8787', 'https://localhost:8787', APP]) {
    assert.equal((await run(local(other))).response.status, 403, other);
  }
});

test('GET routes are not origin-checked', async () => {
  const foreign = { Origin: 'https://www.learnbitcoin.com', 'Sec-Fetch-Site': 'cross-site' };
  for (const path of [API.config, ...READS.map(([read]) => read)]) {
    assert.equal((await run(get(path, foreign))).response.status, 200, path);
    assert.equal((await run(get(path, { 'Sec-Fetch-Site': 'none' }))).response.status, 200, path);
    assert.equal((await run(get(path))).response.status, 200, path);
  }
});

test('no answer carries a CORS header', async () => {
  const foreign = { Origin: 'https://www.learnbitcoin.com' };
  const preflight = (path: string): Request =>
    new Request(`${APP}${path}`, {
      method: 'OPTIONS',
      headers: { ...foreign, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
  const requests: Request[] = [
    get(API.config),
    get(API.config, foreign),
    ...READS.map(([path]) => get(path, foreign)),
    ...POSTS.map(([path, body]) => post(path, body)),
    ...POSTS.map(([path, body]) => post(path, body, foreign)),
    ...POSTS.map(([path]) => preflight(path)),
    preflight(API.config),
    preflight(READS[0]![0]),
    get('/api/nothing', foreign),
    get(`${API.esplora}/tx`, foreign),
  ];
  const statuses = new Set<number>();
  for (const request of requests) {
    const { response } = await run(request);
    statuses.add(response.status);
    response.headers.forEach((_value, name) => {
      assert.ok(!name.toLowerCase().startsWith('access-control-'), `${request.method} ${request.url}: ${name}`);
    });
    assert.equal(response.headers.get('Vary'), null);
  }
  assert.deepEqual([...statuses].sort(), [200, 202, 403, 404, 405]);
});

// -- broadcast ------------------------------------------------------------------------

test('a broadcast takes hex, lower-cases it, and answers the transaction ID as text', async () => {
  const { response, h } = await run(post(`${API.esplora}/tx`, 'DEADbeef00FF'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8');
  assert.equal(await response.text(), TXID);
  assert.deepEqual(h.trace, ['limit:broadcast', 'origin:broadcast']);
  assert.deepEqual(h.originArgs, ['deadbeef00ff']);
  assert.deepEqual(h.lines, [{ route: 'esplora_broadcast', status: 200, upstream: 200, ms: 5, fault: null }]);
});

test('a broadcast that is not hex is bad_request, and the limiter is not even asked', async () => {
  const bad = ['', 'abc', 'zz', '0x00', 'dead beef', 'deadbeef\n', ' deadbeef', '{"tx":"00"}', 'de,ad', String.fromCharCode(233, 233)];
  for (const body of bad) await refusedWith(post(`${API.esplora}/tx`, body), 'bad_request');
});

test('a broadcast of 200,000 characters is taken; one over the cap is too_large', async () => {
  assert.equal(TX_HEX_MAX, 200_000);
  const { response, h } = await run(post(`${API.esplora}/tx`, 'ab'.repeat(TX_HEX_MAX / 2)));
  assert.equal(response.status, 200);
  assert.equal(h.originArgs[0]?.length, TX_HEX_MAX);
  await refusedWith(post(`${API.esplora}/tx`, 'ab'.repeat(TX_HEX_MAX / 2 + 1)), 'too_large');
});

test("the node's refusal comes back as its code, with the node's words in detail", async () => {
  const { response, h } = await run(post(`${API.esplora}/tx`, HEX), {
    broadcast: () => ({
      ok: false,
      code: 'fee_too_low',
      detail: 'min relay fee not met, 5 < 11',
      upstream: 400,
      fault: null,
    }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await errorOf(response), { error: 'fee_too_low', detail: 'min relay fee not met, 5 < 11' });
  assert.deepEqual(h.lines, [{ route: 'esplora_broadcast', status: 400, upstream: 400, ms: 5, fault: null }]);
});

// -- body caps --------------------------------------------------------------------------

test('a declared length over the cap is refused without reading; the cap also holds while reading', async () => {
  const routes: Array<[path: string, max: number]> = [
    [`${API.esplora}/tx`, TX_HEX_MAX],
    [API.faucet, FAUCET_BODY_MAX],
    [API.event, EVENT_BODY_MAX],
  ];
  assert.equal(FAUCET_BODY_MAX, 4096);
  assert.equal(EVENT_BODY_MAX, 1024);
  for (const [path, max] of routes) {
    // A body that is never touched: reading it would throw. (With a high
    // water mark of 0 the stream asks for nothing until someone reads.)
    let touched = false;
    const untouchable = new ReadableStream<Uint8Array>(
      {
        pull() {
          touched = true;
          throw new Error('the body was read');
        },
      },
      { highWaterMark: 0 },
    );
    const declared = new Request(`${APP}${path}`, {
      method: 'POST',
      headers: { Origin: APP, 'Content-Length': String(max + 1) },
      body: untouchable,
      duplex: 'half',
    } as RequestInit);
    await refusedWith(declared, 'too_large');
    assert.equal(touched, false, path);

    // A length that is not a number is a malformed request.
    for (const length of ['abc', '-5', '1e3', '10.5', ' ']) {
      await refusedWith(post(path, 'ab', { 'Content-Length': length }), 'bad_request');
    }

    // No declared length (or one that lies): the read itself stops at the cap.
    const lying = new Request(`${APP}${path}`, {
      method: 'POST',
      headers: { Origin: APP, 'Content-Length': '10' },
      body: 'a'.repeat(max + 1),
    });
    await refusedWith(lying, 'too_large');

    // A reader who goes away mid-upload.
    const broken = new Request(`${APP}${path}`, {
      method: 'POST',
      headers: { Origin: APP },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error('gone'));
        },
      }),
      duplex: 'half',
    } as RequestInit);
    await refusedWith(broken, 'bad_request');
  }
});

// -- the faucet ---------------------------------------------------------------------------

test('a faucet request that passes every check is paid', async () => {
  const { response, h } = await run(post(API.faucet, FAUCET_BODY));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { txid: TXID, amountSats: 100000, potTxid: null });
  assert.deepEqual(h.trace, ['limit:faucet', 'botCheck', 'origin:faucet']);
  assert.deepEqual(h.botCalls, [{ token: TOKEN, address: ADDRESS }]);
  assert.deepEqual(h.originArgs, [ADDRESS]);
  assert.deepEqual(h.lines, [{ route: 'faucet', status: 200, upstream: 200, ms: 5, fault: null }]);
});

test('the faucet checks in order, and each refusal stops before the next thing is asked', async () => {
  const everythingRefuses: HarnessOptions = {
    over: ['faucet'],
    botCheck: { verdict: 'fail', upstream: 200, fault: null },
    faucet: () => ({ ok: false, code: 'busy', detail: null, upstream: 429, fault: null }),
  };
  const long = 'x'.repeat(FAUCET_BODY_MAX);
  const badToken = { address: 'not-an-address', token: 'x'.repeat(2049) };
  const badAddress = { address: 'not-an-address', token: TOKEN };

  // 1. The method, before the origin of the page.
  const wrongMethod = new Request(`${APP}${API.faucet}`, { headers: { Origin: 'https://evil.example' } });
  await refusedWith(wrongMethod, 'method', [], everythingRefuses);
  // 2. Same origin, before the body.
  await refusedWith(post(API.faucet, long + long, { Origin: 'https://evil.example' }), 'forbidden', [], everythingRefuses);
  // 3. The size, before the shape.
  await refusedWith(post(API.faucet, `{${long}`), 'too_large', [], everythingRefuses);
  // 4. The JSON shape, before the address.
  for (const body of ['', 'not json', '[]', 'null', '"x"', '5', '{}', { address: ADDRESS }, { token: TOKEN }]) {
    await refusedWith(post(API.faucet, body), 'bad_request', [], everythingRefuses);
  }
  for (const body of [{ address: 5, token: TOKEN }, { address: ADDRESS, token: 5 }, { address: [ADDRESS], token: TOKEN }, { address: ADDRESS, token: null }]) {
    await refusedWith(post(API.faucet, body), 'bad_request', [], everythingRefuses);
  }
  //    A token that no bot check issues is part of the shape: the service is never asked about it.
  await refusedWith(post(API.faucet, badToken), 'bad_request', [], everythingRefuses);
  await refusedWith(post(API.faucet, { address: ADDRESS, token: '' }), 'bad_request', [], everythingRefuses);
  await refusedWith(post(API.faucet, { address: ADDRESS, token: 'x'.repeat(2049) }), 'bad_request', [], everythingRefuses);
  // 5. The address, before the limiter.
  await refusedWith(post(API.faucet, badAddress), 'bad_address', [], everythingRefuses);
  for (const address of ['', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', ADDRESS.toUpperCase(), ` ${ADDRESS}`, `${ADDRESS}\n`]) {
    await refusedWith(post(API.faucet, { address, token: TOKEN }), 'bad_address', [], everythingRefuses);
  }
  // 6. The reader's budget, before the bot check.
  await refusedWith(post(API.faucet, FAUCET_BODY), 'limit', ['limit:faucet'], everythingRefuses);
  // 7. The bot check, before the origin.
  await refusedWith(post(API.faucet, FAUCET_BODY), 'bot_check', ['limit:faucet', 'botCheck'], { ...everythingRefuses, over: [] });
  // 8. The origin.
  await refusedWith(post(API.faucet, FAUCET_BODY), 'busy', ['limit:faucet', 'botCheck', 'origin:faucet'], {
    faucet: everythingRefuses.faucet,
  });
});

test('a token of exactly 2048 characters is still asked about, and extra keys in the body are ignored', async () => {
  const token = 'x'.repeat(2048);
  const { response, h } = await run(post(API.faucet, { address: ADDRESS, token, later: 'field' }));
  assert.equal(response.status, 200);
  assert.deepEqual(h.botCalls, [{ token, address: ADDRESS }]);
});

test('each bot-check verdict has its own answer, and its fault goes to the log', async () => {
  const cases: Array<[HarnessOptions['botCheck'] & object, ErrorCode]> = [
    [{ verdict: 'fail', upstream: 200, fault: null }, 'bot_check'],
    [{ verdict: 'closed', upstream: null, fault: null }, 'closed'],
    [{ verdict: 'closed', upstream: null, fault: 'bot_check_config' }, 'closed'],
    [{ verdict: 'down', upstream: 200, fault: 'bot_check_config' }, 'unavailable'],
    [{ verdict: 'down', upstream: 500, fault: 'bot_check_down' }, 'unavailable'],
    [{ verdict: 'down', upstream: null, fault: 'bot_check_down' }, 'unavailable'],
  ];
  for (const [botCheck, code] of cases) {
    const h = await refusedWith(post(API.faucet, FAUCET_BODY), code, ['limit:faucet', 'botCheck'], { botCheck });
    assert.deepEqual(h.lines, [
      { route: 'faucet', status: ERROR_STATUS[code], upstream: botCheck.upstream, ms: 5, fault: botCheck.fault },
    ]);
  }
  assert.deepEqual([ERROR_STATUS.bot_check, ERROR_STATUS.closed, ERROR_STATUS.unavailable], [403, 503, 502]);
});

test("the faucet's own refusals and the origin's faults come back as the contract says", async () => {
  const cases: Array<[ErrorCode, number | null, Fault | null]> = [
    ['bad_address', 400, null],
    ['own_address', 400, null],
    ['already_paid', 429, null],
    ['busy', 429, null],
    ['refilling', 503, null],
    ['failed', 500, 'origin_down'],
    ['unavailable', 302, 'origin_auth'],
    ['unavailable', null, 'origin_timeout'],
    ['unavailable', 200, 'origin_shape'],
  ];
  for (const [code, upstream, fault] of cases) {
    const h = await refusedWith(post(API.faucet, FAUCET_BODY), code, ['limit:faucet', 'botCheck', 'origin:faucet'], {
      faucet: () => ({ ok: false, code, detail: null, upstream, fault }),
    });
    assert.deepEqual(h.lines, [{ route: 'faucet', status: ERROR_STATUS[code], upstream, ms: 5, fault }]);
  }
});

// -- the pot ----------------------------------------------------------------------------------

test('the pot address is answered as { address }', async () => {
  const { response, h } = await run(post(API.potAddress, null));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { address: POT_ADDRESS });
  assert.deepEqual(h.trace, ['limit:pot', 'origin:potAddress']);
  assert.deepEqual(h.lines, [{ route: 'pot_address', status: 200, upstream: 200, ms: 5, fault: null }]);

  await refusedWith(post(API.potAddress, null), 'limit', ['limit:pot'], { over: ['pot'] });
  const h2 = await refusedWith(post(API.potAddress, null), 'unavailable', ['limit:pot', 'origin:potAddress'], {
    potAddress: () => ({ ok: false, code: 'unavailable', detail: null, upstream: 401, fault: 'origin_auth' }),
  });
  assert.deepEqual(h2.lines, [{ route: 'pot_address', status: 502, upstream: 401, fault: 'origin_auth', ms: 5 }]);
});

// -- chain reads that fail ------------------------------------------------------------------------

test('a chain read the origin cannot answer comes back as a code, never as the origin body', async () => {
  const cases: Array<[ErrorCode, number | null, Fault | null]> = [
    ['not_found', 404, null],
    ['unavailable', 502, 'origin_down'],
    ['unavailable', 302, 'origin_auth'],
    ['unavailable', null, 'origin_timeout'],
    ['unavailable', 200, 'origin_shape'],
  ];
  for (const [code, upstream, fault] of cases) {
    const h = await refusedWith(get(`${API.esplora}/tx/${TXID}`), code, ['limit:chain', 'origin:esplora'], {
      esplora: () => ({ ok: false, code, detail: null, upstream, fault }),
    });
    assert.deepEqual(h.lines, [{ route: 'esplora_read', status: ERROR_STATUS[code], upstream, ms: 5, fault }]);
  }
  await refusedWith(get(`${API.esplora}/tx/${TXID}`), 'limit', ['limit:chain'], { over: ['chain'] });
  await refusedWith(post(`${API.esplora}/tx`, HEX), 'limit', ['limit:broadcast'], { over: ['broadcast'] });
});

// -- events ----------------------------------------------------------------------------------------

test('an event is answered 202 at once and forwarded afterwards', async () => {
  let finish: (result: { ok: boolean; upstream: number | null; fault: null }) => void = () => {};
  const h = harness({ forward: () => new Promise((resolve) => (finish = resolve)) });
  const request = post(API.event, EVENT, { 'User-Agent': 'Mozilla/5.0 (a browser)' });
  const response = await makeHandler(h.deps)(request);

  // The answer is here while the forward is still under way.
  assert.equal(response.status, 202);
  assert.equal(await response.text(), '');
  assert.equal(h.pending.length, 1, 'the forward was handed to waitUntil');
  assert.deepEqual(h.lines, [], 'the log line waits for the forward to end');

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.trace, ['limit:events', 'forward']);
  assert.deepEqual(h.forwarded, [{ event: EVENT, meta: { ip: READER_IP, userAgent: 'Mozilla/5.0 (a browser)' } }]);

  finish({ ok: true, upstream: 202, fault: null });
  await Promise.all(h.pending);
  assert.deepEqual(h.lines, [{ route: 'event', status: 202, upstream: 202, ms: 5, fault: null }]);
});

test('an event that could not be forwarded still got its 202; the log says what happened', async () => {
  const failed = await run(post(API.event, EVENT), {
    forward: async () => ({ ok: false, upstream: 500, fault: 'events_down' }),
  });
  assert.equal(failed.response.status, 202);
  assert.deepEqual(failed.h.lines, [{ route: 'event', status: 202, upstream: 500, ms: 5, fault: 'events_down' }]);

  const threw = await run(post(API.event, EVENT), {
    forward: () => Promise.reject(new Error('a forwarder that breaks its promise')),
  });
  assert.equal(threw.response.status, 202);
  assert.deepEqual(threw.h.lines, [{ route: 'event', status: 202, upstream: null, ms: 5, fault: 'events_down' }]);
});

test('with events off the answer is 202 and nothing is forwarded', async () => {
  const { response, h } = await run(post(API.event, EVENT), { config: { events: false } });
  assert.equal(response.status, 202);
  assert.deepEqual(h.forwarded, []);
  assert.equal(h.pending.length, 0);
  assert.deepEqual(h.trace, ['limit:events']);
  assert.deepEqual(h.lines, [{ route: 'event', status: 202, upstream: null, ms: 5, fault: null }]);
});

test("the contract's isEventBody decides what an event is", async () => {
  for (const good of [{ name: 'pageview', path: '/' }, { name: 'pageview', path: '/es/wallet/send' }, EVENT]) {
    const { response, h } = await run(post(API.event, good));
    assert.equal(response.status, 202);
    assert.deepEqual(h.forwarded.map((f) => f.event), [good]);
  }
  const bad: Array<string | object> = [
    '',
    'not json',
    '[]',
    'null',
    {},
    { name: 'pageview' },
    { name: 'pageview', path: '/', value: 'x' },
    { name: 'pageview', path: `/wallet/tx/${TXID}` },
    { name: 'pageview', path: `/${ADDRESS}` },
    { name: 'Passkey', path: '/new' },
    { name: 'Passkey', path: '/new', value: 'made-up' },
    { name: 'Made up', path: '/new', value: 'ok' },
    { name: 'Passkey', path: '/new', value: 'ok', props: { address: ADDRESS } },
    { name: 'Passkey', path: '/new', value: 'ok', url: 'https://evil.example' },
    { name: 'Passkey', path: '/new', value: 'ok', domain: 'evil.example' },
  ];
  for (const body of bad) await refusedWith(post(API.event, body), 'bad_request');
  await refusedWith(post(API.event, EVENT), 'limit', ['limit:events'], { over: ['events'] });
  await refusedWith(post(API.event, `{"name":"pageview","path":"/","pad":"${'x'.repeat(EVENT_BODY_MAX)}"}`), 'too_large');
});

// -- limiter keys --------------------------------------------------------------------------------------

test('each limiter is asked with a hash of the reader, never the address itself', async () => {
  const requests: Array<[keyof Harness['limiters'], (ip: Record<string, string>) => Request]> = [
    ['chain', (ip) => get(READS[0]![0], ip)],
    ['broadcast', (ip) => post(`${API.esplora}/tx`, HEX, ip)],
    ['faucet', (ip) => post(API.faucet, FAUCET_BODY, ip)],
    ['pot', (ip) => post(API.potAddress, null, ip)],
    ['events', (ip) => post(API.event, EVENT, ip)],
  ];
  const seen = new Set<string>();
  for (const [name, make] of requests) {
    const { h } = await run(make({ 'CF-Connecting-IP': READER_IP }));
    for (const [other, limiter] of Object.entries(h.limiters)) {
      assert.equal(limiter.keys.length, other === name ? 1 : 0, `${name}: only its own limiter is asked`);
    }
    const key = h.limiters[name].keys[0]!;
    assert.match(key, /^[0-9a-f]{24}$/);
    assert.ok(!key.includes(READER_IP));
    assert.equal(key, await readerKey(name, READER_IP));
    seen.add(key);

    // IPv6: the /64, so a neighbour in the same /64 shares the budget.
    const six = (await run(make({ 'CF-Connecting-IP': READER_IP6 }))).h.limiters[name].keys[0];
    const neighbour = (await run(make({ 'CF-Connecting-IP': '2001:db8:aa:bb:ffff::1' }))).h.limiters[name].keys[0];
    assert.equal(six, neighbour);
    assert.notEqual(six, key);

    // No address header at all: one shared key.
    const none = (await run(make({ 'CF-Connecting-IP': '' }))).h.limiters[name].keys[0];
    assert.equal(none, await readerKey(name, null));
  }
  assert.equal(seen.size, 5, 'the same reader has a different key at each limiter');
});

test('an address header a reader could forge is not used', async () => {
  const forged = { 'X-Forwarded-For': '198.51.100.9', 'X-Real-IP': '198.51.100.9', Forwarded: 'for=198.51.100.9', 'True-Client-IP': '198.51.100.9' };
  // Without Cloudflare's own header, the forgeable ones do not stand in for it...
  const alone = await run(get(READS[0]![0], { 'CF-Connecting-IP': '', ...forged }));
  assert.equal(alone.request.headers.get('CF-Connecting-IP'), null);
  assert.equal(alone.h.limiters.chain.keys[0], await readerKey('chain', null));
  // ...and beside it, they change nothing.
  const beside = await run(get(READS[0]![0], forged));
  assert.equal(beside.h.limiters.chain.keys[0], await readerKey('chain', READER_IP));
});

// -- headers and the log ---------------------------------------------------------------------------------

test('every answer carries the fixed headers: a success, a refusal, the 404 and the 405', async () => {
  const answers: Array<[what: string, request: Request, status: number, type: string | null]> = [
    ['config', get(API.config), 200, 'application/json; charset=utf-8'],
    ['a chain read', get(READS[1]![0]), 200, 'application/json; charset=utf-8'],
    ['a broadcast', post(`${API.esplora}/tx`, HEX), 200, 'text/plain; charset=utf-8'],
    ['the faucet', post(API.faucet, FAUCET_BODY), 200, 'application/json; charset=utf-8'],
    ['the pot', post(API.potAddress, null), 200, 'application/json; charset=utf-8'],
    ['an event', post(API.event, EVENT), 202, null],
    ['a refusal (bad_address)', post(API.faucet, { address: 'x', token: TOKEN }), 400, 'application/json; charset=utf-8'],
    ['a refusal (forbidden)', post(API.faucet, FAUCET_BODY, { Origin: 'https://evil.example' }), 403, 'application/json; charset=utf-8'],
    ['a refusal (too_large)', post(API.event, 'x'.repeat(2000)), 413, 'application/json; charset=utf-8'],
    ['the 404', get('/api/nothing'), 404, 'application/json; charset=utf-8'],
    ['the 405', get(API.faucet), 405, 'application/json; charset=utf-8'],
  ];
  for (const [what, request, status, type] of answers) {
    const { response } = await run(request);
    assert.equal(response.status, status, what);
    assert.equal(response.headers.get('Content-Type'), type, what);
    for (const [name, value] of Object.entries(FIXED_HEADERS)) assert.equal(response.headers.get(name), value, `${what}: ${name}`);
    const names: string[] = [];
    response.headers.forEach((_value, name) => names.push(name));
    const expected = [...Object.keys(FIXED_HEADERS).map((name) => name.toLowerCase()), ...(type ? ['content-type'] : []), ...(status === 405 ? ['allow'] : [])];
    assert.deepEqual(names.sort(), expected.sort(), `${what}: these headers and no others`);
  }
});

test('a refusal from the limiter also carries the fixed headers', async () => {
  const { response } = await run(get(READS[0]![0]), { over: ['chain'] });
  assert.equal(response.status, 429);
  for (const [name, value] of Object.entries(FIXED_HEADERS)) assert.equal(response.headers.get(name), value);
});

test('one log line per request: five fields, and nothing a reader sent', async () => {
  const secretish = [ADDRESS, TXID, TOKEN, READER_IP, HEX, POT_ADDRESS, 'Mozilla', 'evil.example', '/api/', 'esplora/'];
  const requests: Request[] = [
    get(API.config),
    ...READS.map(([path]) => get(path)),
    ...POSTS.map(([path, body]) => post(path, body, { 'User-Agent': 'Mozilla/5.0' })),
    ...POSTS.map(([path, body]) => post(path, body, { Origin: 'https://evil.example' })),
    get(`/api/esplora/address/${ADDRESS}/nothing`),
    get(API.faucet),
    post(API.faucet, { address: ADDRESS, token: 'x'.repeat(3000) }),
  ];
  for (const request of requests) {
    const { h } = await run(request, {
      faucet: () => ({ ok: false, code: 'failed', detail: null, upstream: 500, fault: 'origin_down' }),
    });
    assert.equal(h.lines.length, 1, `${request.method} ${request.url}`);
    const line = h.lines[0]!;
    assert.deepEqual(Object.keys(line).sort(), ['fault', 'ms', 'route', 'status', 'upstream']);
    assert.ok(['config', 'esplora_read', 'esplora_broadcast', 'faucet', 'pot_address', 'event', 'unknown'].includes(line.route));
    assert.equal(typeof line.status, 'number');
    assert.ok(line.upstream === null || typeof line.upstream === 'number');
    assert.equal(typeof line.ms, 'number');
    const written = JSON.stringify(line);
    for (const piece of secretish) assert.ok(!written.includes(piece), `${piece} in ${written}`);
  }
});

test('when a part throws, the answer is unavailable and the log says the handler is at fault', async () => {
  const boom = (): never => {
    throw new Error(`could not reach ${ADDRESS} with ${TOKEN}`);
  };
  const cases: Array<[Request, HarnessOptions, string]> = [
    [get(READS[1]![0]), { esplora: boom }, 'esplora_read'],
    [post(`${API.esplora}/tx`, HEX), { broadcast: boom }, 'esplora_broadcast'],
    [post(API.faucet, FAUCET_BODY), { faucet: boom }, 'faucet'],
    [post(API.potAddress, null), { potAddress: boom }, 'pot_address'],
  ];
  for (const [request, options, route] of cases) {
    const { response, h } = await run(request, options);
    assert.equal(response.status, 502);
    assert.deepEqual(await errorOf(response), { error: 'unavailable' });
    assert.deepEqual(h.lines, [{ route, status: 502, upstream: null, ms: 5, fault: 'handler' }]);
    for (const [name, value] of Object.entries(FIXED_HEADERS)) assert.equal(response.headers.get(name), value);
  }
  // A limiter that breaks is our fault too, and nothing behind it is asked.
  const h = harness();
  h.deps.limits.chain.limit = boom;
  const response = await makeHandler(h.deps)(get(READS[0]![0]));
  assert.equal(response.status, 502);
  assert.deepEqual(h.originArgs, []);
  assert.equal(h.lines[0]?.fault, 'handler');
});
