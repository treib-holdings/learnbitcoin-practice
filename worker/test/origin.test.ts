import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BROADCAST_REFUSALS, DETAIL_MAX, ERROR_STATUS } from '@learnbitcoin/practice-contract';
import type { ErrorCode } from '@learnbitcoin/practice-contract';
import type { Fault, FetchLike, Origin, OriginAnswer } from '../src/deps.ts';
import {
  BOTS_REFUSALS,
  CHAIN_ANSWER_MAX,
  FAUCET_TIMEOUT_MS,
  ORIGIN_TIMEOUT_MS,
  PLACEHOLDER_IP,
  makeOrigin,
  mapBroadcastRefusal,
} from '../src/origin.ts';
import { ADDRESS, POT_ADDRESS, TXID, fakeFetch, noNetwork, readJson, reply, slowFetch } from './fakes.ts';

noNetwork();

const ORIGIN = 'https://origin.test';
const HEX = '02000000000101abcdef';

function origin(fetch: FetchLike, extra: { access?: boolean; botsToken?: string; timeoutMs?: number; faucetTimeoutMs?: number } = {}) {
  return makeOrigin({
    url: ORIGIN,
    botsToken: extra.botsToken ?? 'bots-token',
    ...(extra.access ? { accessClientId: 'client-id', accessClientSecret: 'client-secret' } : {}),
    fetch,
    timeoutMs: extra.timeoutMs,
    faucetTimeoutMs: extra.faucetTimeoutMs,
  });
}

/** The four calls, so a rule that holds for all of them can be checked on all of them. */
const CALLS: Array<[name: string, run: (o: ReturnType<typeof makeOrigin>) => Promise<{ ok: boolean }>]> = [
  ['esplora', (o) => o.esplora('/blocks/tip/height')],
  ['broadcast', (o) => o.broadcast(HEX)],
  ['faucet', (o) => o.faucet(ADDRESS)],
  ['potAddress', (o) => o.potAddress()],
];

/** The two calls to the bots. */
const BOTS: Array<(o: ReturnType<typeof makeOrigin>) => Promise<{ ok: boolean }>> = [
  (o) => o.faucet(ADDRESS),
  (o) => o.potAddress(),
];

/** The fault that goes with a status no route has a reading for: the three-way rule of origin.ts. */
function faultFor(status: number): Fault {
  if ((status >= 300 && status <= 399) || status === 401 || status === 403) return 'origin_auth';
  if (status >= 500) return 'origin_down';
  return 'origin_shape';
}

/** A response with a status that allows no body (204, 205, 304), or with one. */
function replyWith(status: number, body: string | object, type?: string): Response {
  return status === 204 || status === 205 || status === 304 ? new Response(null, { status }) : reply(status, body, type);
}

test('the three-way rule these tests expect, spelled out once', () => {
  // faultFor() above says what many rows below expect. Here it is held to
  // the decision itself, status by status, so that it cannot be wrong in
  // the same way as the code it checks.
  const rule: Array<[fault: Fault, statuses: number[]]> = [
    // We were not let in: a redirect (Access sends one to its login page), 401 or 403.
    ['origin_auth', [300, 301, 302, 303, 304, 307, 308, 399, 401, 403]],
    // The origin is stopped or broken.
    ['origin_down', [500, 501, 502, 503, 504, 520, 530, 599]],
    // Up, and it let us in, but this is no answer the Worker has a reading for.
    ['origin_shape', [201, 202, 204, 206, 299, 400, 402, 404, 405, 409, 410, 413, 418, 429, 451, 499]],
  ];
  for (const [fault, statuses] of rule) {
    for (const status of statuses) assert.equal(faultFor(status), fault, String(status));
  }
});

// -- what goes out ------------------------------------------------------------

test('every request is written from scratch: path, method, headers and nothing else', async () => {
  const fetch = fakeFetch(() => reply(500, 'x'));
  const o = origin(fetch, { access: true });
  for (const [, run] of CALLS) await run(o);
  await o.esplora(`/address/${ADDRESS}/utxo`);

  const sent = fetch.calls.map((call) => ({
    url: call.url,
    method: call.init.method,
    headers: call.headers,
    body: call.init.body ?? null,
  }));
  const access = { 'cf-access-client-id': 'client-id', 'cf-access-client-secret': 'client-secret', 'x-real-ip': PLACEHOLDER_IP };
  assert.deepEqual(sent, [
    { url: `${ORIGIN}/esplora/blocks/tip/height`, method: 'GET', headers: access, body: null },
    { url: `${ORIGIN}/esplora/tx`, method: 'POST', headers: { ...access, 'content-type': 'text/plain' }, body: HEX },
    {
      url: `${ORIGIN}/bots/faucet`,
      method: 'POST',
      headers: { ...access, authorization: 'Bearer bots-token', 'content-type': 'application/json' },
      body: JSON.stringify({ address: ADDRESS }),
    },
    { url: `${ORIGIN}/bots/pot/address`, method: 'GET', headers: { ...access, authorization: 'Bearer bots-token' }, body: null },
    { url: `${ORIGIN}/esplora/address/${ADDRESS}/utxo`, method: 'GET', headers: access, body: null },
  ]);
  for (const call of fetch.calls) {
    assert.equal(call.init.redirect, 'manual', 'a redirect is never followed: it would carry our tokens along');
    assert.ok(call.init.signal instanceof AbortSignal, 'every request has a time limit');
    assert.equal(typeof (call.init.body ?? ''), 'string', 'a body goes as a string, so its length is declared');
  }
});

test('the bearer token goes to the two bots routes only, and the Access headers only when both are set', async () => {
  const fetch = fakeFetch(() => reply(500, 'x'));
  for (const [, run] of CALLS) await run(origin(fetch));
  assert.deepEqual(
    fetch.calls.map((call) => Object.keys(call.headers).sort()),
    [['x-real-ip'], ['content-type', 'x-real-ip'], ['authorization', 'content-type', 'x-real-ip'], ['authorization', 'x-real-ip']],
  );

  const half = fakeFetch(() => reply(500, 'x'));
  await makeOrigin({ url: ORIGIN, botsToken: 't', accessClientId: 'client-id', accessClientSecret: '', fetch: half }).esplora('/blocks/tip/height');
  await makeOrigin({ url: ORIGIN, botsToken: 't', accessClientSecret: 'client-secret', fetch: half }).esplora('/blocks/tip/height');
  for (const call of half.calls) assert.deepEqual(Object.keys(call.headers), ['x-real-ip']);
});

test('the origin is told a placeholder address, never a reader', () => {
  assert.equal(PLACEHOLDER_IP, '192.0.2.1');
});

test('a trailing slash on the origin URL does not double up', async () => {
  const fetch = fakeFetch(() => reply(200, '1', 'text/plain'));
  await makeOrigin({ url: `${ORIGIN}/`, botsToken: 't', fetch }).esplora('/blocks/tip/height');
  assert.equal(fetch.calls[0]?.url, `${ORIGIN}/esplora/blocks/tip/height`);
});

test('only a path rebuilt by the handler is asked for', async () => {
  const fetch = fakeFetch(() => reply(200, '1'));
  const o = origin(fetch);
  const bad = [
    '',
    'blocks/tip/height',
    '/blocks/tip/height/',
    '//blocks',
    '/../bots/pot/address',
    '/address/%2e%2e',
    '/tx/abc?x=1',
    '/tx/abc#x',
    '/Blocks/tip/height',
    '/address/a b',
    '/address/a\\b',
  ];
  for (const path of bad) {
    // The message is fixed: it never repeats the path it refused.
    await assert.rejects(o.esplora(path), { message: 'origin: not a rebuilt Esplora path' }, path);
  }
  assert.equal(fetch.calls.length, 0);
});

// -- how each answer is read ----------------------------------------------------

test('a chain read passes a 200 on whole and unchanged, with one of two content types', async () => {
  const json = await origin(fakeFetch(() => reply(200, '{"a":1}', 'application/json'))).esplora('/tx/abc');
  assert.ok(json.ok);
  assert.equal(json.value.type, 'json');
  assert.equal(json.upstream, 200);
  assert.equal(await new Response(json.value.body).text(), '{"a":1}');

  const text = await origin(fakeFetch(() => reply(200, '6326', 'Text/Plain; charset=utf-8'))).esplora('/blocks/tip/height');
  assert.ok(text.ok);
  assert.equal(text.value.type, 'text');
  assert.equal(await new Response(text.value.body).text(), '6326');

  // Byte for byte, in however many pieces it arrived: the Worker does not
  // look inside chain data, so bytes that are not even text come through.
  const odd = [Uint8Array.of(0x7b, 0xff, 0xfe), Uint8Array.of(), Uint8Array.of(0xc3, 0x28, 0x00, 0x7d)];
  const pieces = new ReadableStream<Uint8Array>({
    pull(controller) {
      const piece = odd.shift();
      if (piece === undefined) controller.close();
      else controller.enqueue(piece);
    },
  });
  const raw = await origin(
    fakeFetch(() => new Response(pieces, { headers: { 'Content-Type': 'application/json' } })),
  ).esplora('/tx/abc');
  assert.ok(raw.ok);
  const passed = new Uint8Array(await new Response(raw.value.body).arrayBuffer());
  assert.deepEqual(passed, Uint8Array.of(0x7b, 0xff, 0xfe, 0xc3, 0x28, 0x00, 0x7d));

  // An answer with nothing in it is still an answer.
  const empty = await origin(fakeFetch(() => reply(200, '', 'application/json'))).esplora('/tx/abc');
  assert.ok(empty.ok);
  assert.equal(await new Response(empty.value.body).text(), '');
});

test('a chain answer is whole before any of it is passed on', async () => {
  // The origin sends its headers and a first piece at once, and the rest
  // only when the test says so. Nothing is handed on in between.
  let finish: () => void = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('[{"txid":"'));
      finish = () => {
        controller.enqueue(new TextEncoder().encode('abc"}]'));
        controller.close();
      };
    },
  });
  let settled = false;
  const pending = origin(fakeFetch(() => new Response(body, { headers: { 'Content-Type': 'application/json' } })))
    .esplora('/tx/abc')
    .finally(() => (settled = true));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, false, 'half an answer is not an answer yet');
  finish();
  const answer = await pending;
  assert.ok(answer.ok);
  assert.equal(await new Response(answer.value.body).text(), '[{"txid":"abc"}]');
});

test('a chain answer longer than the cap is refused, and the rest of it is never read', async () => {
  assert.equal(CHAIN_ANSWER_MAX, 4 * 1024 * 1024);
  const wrong = { ok: false, code: 'unavailable', detail: null, upstream: 200, fault: 'origin_shape' };

  // A body with no end: 64 KB at a time, for as long as anyone asks.
  let sent = 0;
  let cancelled = false;
  const endless = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        sent += 65_536;
        controller.enqueue(new Uint8Array(65_536).fill(0x78));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const answer = await origin(
    fakeFetch(() => new Response(endless, { headers: { 'Content-Type': 'application/json' } })),
  ).esplora('/address/x');
  assert.deepEqual(answer, wrong);
  assert.ok(cancelled, 'the origin is told to stop');
  assert.ok(sent <= CHAIN_ANSWER_MAX + 65_536, `read ${sent} bytes of a body with no end`);

  // The cap is on what arrives, whatever length was declared. One byte over is over.
  const over = await origin(fakeFetch(() => reply(200, 'x'.repeat(CHAIN_ANSWER_MAX + 1), 'application/json'))).esplora('/address/x');
  assert.deepEqual(over, wrong);
  // Exactly the cap is still taken.
  const full = await origin(fakeFetch(() => reply(200, 'x'.repeat(CHAIN_ANSWER_MAX), 'text/plain'))).esplora('/address/x');
  assert.ok(full.ok);
  assert.equal((await new Response(full.value.body).arrayBuffer()).byteLength, CHAIN_ANSWER_MAX);
});

test('a chain answer that breaks off is unavailable, never half an answer', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('[{"txid":"'));
    },
    pull(controller) {
      controller.error(new TypeError('terminated'));
    },
  });
  const answer = await origin(
    fakeFetch(() => new Response(body, { headers: { 'Content-Type': 'application/json' } })),
  ).esplora('/address/x');
  assert.deepEqual(answer, { ok: false, code: 'unavailable', detail: null, upstream: 200, fault: 'origin_down' });
});

test('a 200 that is neither JSON nor plain text is not chain data', async () => {
  for (const type of ['text/html', 'text/html; charset=utf-8', 'application/octet-stream', 'application/jsonp']) {
    const answer = await origin(fakeFetch(() => reply(200, '<html>sign in</html>', type))).esplora('/tx/abc');
    assert.deepEqual(answer, { ok: false, code: 'unavailable', detail: null, upstream: 200, fault: 'origin_shape' });
  }
  const none = await origin(fakeFetch(() => new Response('x', { headers: { 'Content-Type': '' } }))).esplora('/tx/abc');
  assert.ok(!none.ok && none.fault === 'origin_shape');
});

test("Esplora's 404 for a transaction it does not know is not_found, and nobody is at fault", async () => {
  for (const type of ['text/plain', 'text/plain; charset=utf-8']) {
    const answer = await origin(fakeFetch(() => reply(404, 'Transaction not found', type))).esplora(`/tx/${TXID}`);
    assert.deepEqual(answer, { ok: false, code: 'not_found', detail: null, upstream: 404, fault: null }, type);
  }
});

test('any other 404 on a chain read is not the chain speaking: unavailable with origin_shape, never not_found', async () => {
  const lost = { ok: false, code: 'unavailable', detail: null, upstream: 404, fault: 'origin_shape' };
  // Esplora has an answer for every tip height and every address, used or
  // not. A 404 to one of these means the way to Esplora is lost.
  for (const path of ['/blocks/tip/height', `/address/${ADDRESS}`, `/address/${ADDRESS}/utxo`, `/address/${ADDRESS}/txs`]) {
    const answer = await origin(fakeFetch(() => reply(404, 'endpoint does not exist "/x"', 'text/plain'))).esplora(path);
    assert.deepEqual(answer, lost, path);
  }
  // A transaction was asked for, but the 404 is a page or JSON from
  // something in between, not Esplora's plain text.
  const pages: Array<[body: string, type: string]> = [
    ['<html><body>404 page not found</body></html>', 'text/html'],
    ['<html><body>Transaction not found</body></html>', 'text/html; charset=utf-8'],
    ['{"error":"not found"}', 'application/json'],
    ['Transaction not found', 'application/octet-stream'],
  ];
  for (const [body, type] of pages) {
    assert.deepEqual(await origin(fakeFetch(() => reply(404, body, type))).esplora(`/tx/${TXID}`), lost, type);
  }
  const untyped = await origin(fakeFetch(() => new Response(null, { status: 404 }))).esplora(`/tx/${TXID}`);
  assert.deepEqual(untyped, lost, 'no content type at all');
});

test('a redirect, a 401 or a 403 means our tokens are wrong: origin_auth, on every call', async () => {
  for (const status of [301, 302, 303, 307, 308, 401, 403]) {
    for (const [name, run] of CALLS) {
      const answer = await run(origin(fakeFetch(() => reply(status, { error: 'unauthorized', code: 'unauthorized' }))));
      assert.deepEqual(
        answer,
        { ok: false, code: 'unavailable', detail: null, upstream: status, fault: 'origin_auth' },
        `${name} ${status}`,
      );
    }
  }
});

test('a server error or a fetch that throws is origin_down, on every call', async () => {
  for (const [name, run] of CALLS) {
    for (const status of [500, 502, 503, 504]) {
      const answer = await run(origin(fakeFetch(() => reply(status, '<html>Bad gateway</html>', 'text/html'))));
      assert.deepEqual(
        answer,
        { ok: false, code: 'unavailable', detail: null, upstream: status, fault: 'origin_down' },
        `${name} ${status}`,
      );
    }
    const thrown = await run(
      origin(
        fakeFetch(() => {
          throw new TypeError('fetch failed');
        }),
      ),
    );
    assert.deepEqual(thrown, { ok: false, code: 'unavailable', detail: null, upstream: null, fault: 'origin_down' }, name);
  }
});

test('running out of time is origin_timeout, on every call', async () => {
  for (const [name, run] of CALLS) {
    const fetch = slowFetch(null, () => reply(200, 'late'));
    const answer = await run(origin(fetch, { timeoutMs: 15, faucetTimeoutMs: 15 }));
    assert.deepEqual(answer, { ok: false, code: 'unavailable', detail: null, upstream: null, fault: 'origin_timeout' }, name);
    assert.equal(fetch.calls.length, 1);
  }
});

test('the time limit also covers a body that stops arriving', async () => {
  const fetch = fakeFetch((call) => {
    const signal = call.init.signal as AbortSignal;
    // The headers arrive, the body never does. When the signal fires, the
    // body fails with the signal's reason, as a real fetch's body would.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const timer = setTimeout(() => controller.error(new Error('the time limit never fired')), 5000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          controller.error(signal.reason);
        });
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const o = origin(fetch, { timeoutMs: 15, faucetTimeoutMs: 15 });
  for (const [name, run] of CALLS) {
    // A chain read too: its answer is read here, not handed on while it arrives.
    assert.deepEqual(
      await run(o),
      { ok: false, code: 'unavailable', detail: null, upstream: 200, fault: 'origin_timeout' },
      name,
    );
  }
});

test('the time limit covers a chain answer that starts and then stalls', async () => {
  let reads = 0;
  const fetch = fakeFetch((call) => {
    const signal = call.init.signal as AbortSignal;
    // The headers and the first bytes arrive, and then nothing more.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('[{"txid":"'));
        const timer = setTimeout(() => controller.error(new Error('the time limit never fired')), 5000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          controller.error(signal.reason);
        });
      },
      pull() {
        reads += 1;
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const started = Date.now();
  const answer = await origin(fetch, { timeoutMs: 15 }).esplora(`/address/${ADDRESS}/txs`);
  assert.deepEqual(answer, { ok: false, code: 'unavailable', detail: null, upstream: 200, fault: 'origin_timeout' });
  assert.ok(Date.now() - started < 2000, 'it ended at the limit, not when the origin felt like it');
  assert.ok(reads >= 1, 'the body was being read when the limit fired');
});

test('the faucet is given longer than the other calls', async () => {
  assert.equal(ORIGIN_TIMEOUT_MS, 8000);
  assert.equal(FAUCET_TIMEOUT_MS, 25_000);
  const paid = { txid: TXID, amount_sats: 100000, pot_coin: null };
  const fetch = slowFetch(60, () => reply(200, paid));
  const o = origin(fetch, { timeoutMs: 15, faucetTimeoutMs: 2000 });
  const pot = await o.potAddress();
  assert.ok(!pot.ok && pot.fault === 'origin_timeout');
  const faucet = await o.faucet(ADDRESS);
  assert.ok(faucet.ok, 'a payment that takes longer than a chain read still comes back');
});

test('any other status on a chain read or a broadcast is unavailable, with origin_shape', async () => {
  // The origin is up and lets us in, but this is no answer the Worker has a
  // reading for. Esplora's 400 for text that is no address is one of these:
  // the handler asks about nothing but addresses, checksum and all, so that
  // answer would mean the two disagree about what an address is.
  for (const status of [201, 202, 204, 206, 400, 402, 405, 409, 410, 418, 429, 451]) {
    const read = await origin(fakeFetch(() => replyWith(status, 'Invalid Bitcoin address'))).esplora('/address/x');
    assert.deepEqual(read, { ok: false, code: 'unavailable', detail: null, upstream: status, fault: 'origin_shape' }, `read ${status}`);
    const tx = await origin(fakeFetch(() => replyWith(status, 'Invalid hex hash'))).esplora(`/tx/${TXID}`);
    assert.deepEqual(tx, { ok: false, code: 'unavailable', detail: null, upstream: status, fault: 'origin_shape' }, `tx ${status}`);
  }
  for (const status of [201, 202, 204, 206, 402, 404, 405, 409, 413, 418, 429]) {
    const sent = await origin(fakeFetch(() => replyWith(status, 'no'))).broadcast(HEX);
    assert.deepEqual(sent, { ok: false, code: 'unavailable', detail: null, upstream: status, fault: 'origin_shape' }, `broadcast ${status}`);
  }
});

test('a 400 on a broadcast is the node speaking only when it is plain text', async () => {
  // An error page from something in between must not be shown as the node's refusal.
  for (const type of ['text/html', 'application/json', 'text/html; charset=utf-8']) {
    const page = '<html><head><title>400 Bad Request</title></head><body>dust</body></html>';
    const answer = await origin(fakeFetch(() => reply(400, page, type))).broadcast(HEX);
    assert.deepEqual(answer, { ok: false, code: 'unavailable', detail: null, upstream: 400, fault: 'origin_shape' }, type);
  }
  // The node's own 400, with nothing in it, is still a refusal: just one without words.
  const empty = await origin(fakeFetch(() => reply(400, '', 'text/plain'))).broadcast(HEX);
  assert.deepEqual(empty, { ok: false, code: 'refused', detail: null, upstream: 400, fault: null });
  const charset = await origin(fakeFetch(() => reply(400, 'non-final', 'text/plain; charset=utf-8'))).broadcast(HEX);
  assert.deepEqual(charset, { ok: false, code: 'refused', detail: 'non-final', upstream: 400, fault: null });
});

// -- broadcast --------------------------------------------------------------------

test('an accepted broadcast answers the transaction ID', async () => {
  const answer = await origin(fakeFetch(() => reply(200, `${TXID}\n`))).broadcast(HEX);
  assert.deepEqual(answer, { ok: true, value: TXID, upstream: 200 });
});

test('a 200 that is not a transaction ID is origin_shape', async () => {
  for (const body of ['', 'ok', TXID.toUpperCase(), `${TXID}00`, `<html>${TXID}</html>`, 'x'.repeat(10_000)]) {
    const answer = await origin(fakeFetch(() => reply(200, body))).broadcast(HEX);
    assert.deepEqual(answer, { ok: false, code: 'unavailable', detail: null, upstream: 200, fault: 'origin_shape' });
  }
});

interface Refusal {
  what: string;
  status: number;
  contentType: string;
  body: string;
  expect: string;
}
const { refusals } = readJson('./fixtures/broadcast-refusals.json') as { refusals: Refusal[] };

test('every refusal the node really gave maps to the code recorded for it', async () => {
  assert.ok(refusals.length >= 12);
  const seen = new Set<string>();
  for (const sample of refusals) {
    assert.ok((BROADCAST_REFUSALS as readonly string[]).includes(sample.expect), sample.what);
    seen.add(sample.expect);
    const message = (JSON.parse(sample.body.slice(sample.body.indexOf('{'))) as { message: string }).message;

    // The pure mapping...
    assert.deepEqual(mapBroadcastRefusal(sample.body), { code: sample.expect, detail: message }, sample.what);
    // ...and the same through the transport, as the origin sent it.
    const answer = await origin(fakeFetch(() => reply(sample.status, sample.body, sample.contentType))).broadcast(HEX);
    assert.deepEqual(answer, { ok: false, code: sample.expect, detail: message, upstream: 400, fault: null }, sample.what);
  }
  assert.deepEqual([...seen].sort(), [...BROADCAST_REFUSALS].sort(), 'the samples cover every broadcast code');
});

test("the spec's table of node messages, row by row", () => {
  const rows: Array<[string, string]> = [
    ['Transaction outputs already in utxo set', 'already_sent'],
    ['bad-txns-inputs-missingorspent', 'coin_spent'],
    ['insufficient fee, rejecting replacement abc, not enough additional fees to relay', 'coin_spent'],
    ['txn-mempool-conflict', 'coin_spent'],
    ['min relay fee not met, 5 < 11', 'fee_too_low'],
    ['mempool min fee not met, 100 < 1000', 'fee_too_low'],
    ['dust', 'dust'],
    ['dust, tx with dust output must be 0-fee', 'dust'],
    ['too-large-cluster', 'refused'],
    ['non-final', 'refused'],
    ['TX decode failed. Make sure the tx has at least one input.', 'refused'],
    ['', 'refused'],
  ];
  for (const [message, code] of rows) {
    const text = `sendrawtransaction RPC error: ${JSON.stringify({ code: -26, message })}`;
    assert.equal(mapBroadcastRefusal(text).code, code, message);
  }
});

test('detail is the node message alone, or the whole text when it has another shape, cut to DETAIL_MAX', () => {
  assert.equal(
    mapBroadcastRefusal('sendrawtransaction RPC error: {"code":-26,"message":"min relay fee not met, 5 < 11"}').detail,
    'min relay fee not met, 5 < 11',
  );
  // Not the usual shape: the text itself, trimmed, and still mapped.
  assert.deepEqual(mapBroadcastRefusal('  bad-txns-inputs-missingorspent\n'), {
    code: 'coin_spent',
    detail: 'bad-txns-inputs-missingorspent',
  });
  assert.deepEqual(mapBroadcastRefusal('RPC error: {"code":-26,"mess'), { code: 'refused', detail: 'RPC error: {"code":-26,"mess' });
  assert.deepEqual(mapBroadcastRefusal('error: {"code":-26}'), { code: 'refused', detail: 'error: {"code":-26}' });
  assert.deepEqual(mapBroadcastRefusal('error: [1]'), { code: 'refused', detail: 'error: [1]' });

  const long = `dust ${'x'.repeat(1000)}`;
  const cut = mapBroadcastRefusal(`sendrawtransaction RPC error: ${JSON.stringify({ code: -26, message: long })}`);
  assert.equal(cut.code, 'dust');
  assert.equal(cut.detail.length, DETAIL_MAX);
  assert.equal(cut.detail, long.slice(0, DETAIL_MAX));
  assert.equal(mapBroadcastRefusal('y'.repeat(5000)).detail.length, DETAIL_MAX);
});

// -- the bots -----------------------------------------------------------------------

test("the faucet's answer becomes the contract's FaucetPayment", async () => {
  const plain = await origin(fakeFetch(() => reply(200, { txid: TXID, amount_sats: 100000, pot_coin: null }))).faucet(ADDRESS);
  assert.deepEqual(plain, { ok: true, value: { txid: TXID, amountSats: 100000, potTxid: null }, upstream: 200 });

  const potTxid = 'ab'.repeat(32);
  const passedOn = await origin(
    fakeFetch(() => reply(200, { txid: TXID, amount_sats: 100000, pot_coin: { txid: potTxid, vout: 1, sats: 60000 } })),
  ).faucet(ADDRESS);
  assert.deepEqual(passedOn, { ok: true, value: { txid: TXID, amountSats: 100000, potTxid }, upstream: 200 });
});

test('a payment the faucet made stands, even when where its coin came from cannot be read', async () => {
  // Thrown away, the reader would be told to try again and then that the address was already paid.
  const paid = { ok: true, value: { txid: TXID, amountSats: 100000, potTxid: null }, upstream: 200 };
  const unreadable: unknown[] = ['yes', 5, true, [], ['ab'.repeat(32)], {}, { txid: 'nope' }, { txid: 7 }, { txid: TXID.toUpperCase() }, { vout: 1, sats: 5 }];
  for (const pot of unreadable) {
    const answer = await origin(fakeFetch(() => reply(200, { txid: TXID, amount_sats: 100000, pot_coin: pot }))).faucet(ADDRESS);
    assert.deepEqual(answer, paid, JSON.stringify(pot));
  }
  // With no pot_coin at all, the same.
  assert.deepEqual(await origin(fakeFetch(() => reply(200, { txid: TXID, amount_sats: 100000 }))).faucet(ADDRESS), paid);
});

test('a 200 from the bots that is not what the route promises is origin_shape', async () => {
  const wrong = { ok: false, code: 'unavailable', detail: null, upstream: 200, fault: 'origin_shape' };
  const faucetBodies: Array<string | object> = [
    '',
    'paid',
    '<html>sign in</html>',
    '[]',
    'null',
    {},
    { txid: 'abc', amount_sats: 100000, pot_coin: null },
    { txid: TXID, amount_sats: '100000', pot_coin: null },
    { txid: TXID, amount_sats: 0, pot_coin: null },
    { txid: TXID, amount_sats: 1.5, pot_coin: null },
    { txid: TXID, pot_coin: null },
    { txid: TXID, amount_sats: 100000, pot_coin: null, padding: 'x'.repeat(10_000) },
  ];
  for (const body of faucetBodies) {
    assert.deepEqual(await origin(fakeFetch(() => reply(200, body))).faucet(ADDRESS), wrong, JSON.stringify(body).slice(0, 80));
  }
  for (const body of ['', '"bcrt1q"', {}, { address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' }, { address: 5 }, [POT_ADDRESS]]) {
    assert.deepEqual(await origin(fakeFetch(() => reply(200, body))).potAddress(), wrong, JSON.stringify(body));
  }
});

test('the pot address comes back as a string', async () => {
  const answer = await origin(fakeFetch(() => reply(200, { address: POT_ADDRESS }))).potAddress();
  assert.deepEqual(answer, { ok: true, value: POT_ADDRESS, upstream: 200 });
});

test("the faucet's own six refusals pass through, each with its status", async () => {
  // Each with the status the bots give it (bots/practice_bots/bots.py).
  const own: Array<[status: number, code: ErrorCode, fault: Fault | null]> = [
    [400, 'bad_address', null],
    [400, 'own_address', null],
    [429, 'already_paid', null],
    [429, 'busy', null],
    // Out of coins until its refill confirms: by design, and nobody has to fix anything.
    [503, 'refilling', null],
    // The faucet could not finish a payment: the reader is told so, and the owner has to look.
    [500, 'failed', 'origin_down'],
  ];
  assert.deepEqual(own.map(([, code]) => code), [...BOTS_REFUSALS], 'these six and no others');
  for (const [status, code, fault] of own) {
    // The Worker answers with the contract's status for a code. For these
    // six it is the status the bots sent, so the status passes through too.
    assert.equal(ERROR_STATUS[code], status, code);
    for (const run of BOTS) {
      const answer = await run(origin(fakeFetch(() => reply(status, { error: 'A sentence for people', code }))));
      assert.deepEqual(answer, { ok: false, code, detail: null, upstream: status, fault }, `${status} ${code}`);
    }
  }
});

test('any other answer from the bots that is not a success is unavailable, and the fault goes by its status', async () => {
  const padding = 'x'.repeat(10_000);
  const others: Array<[status: number, body: string | object, type?: string]> = [
    // The bots' other codes (bots/practice_bots/server.py). The contract has
    // codes with three of these names (bad_request, not_found, unavailable):
    // those are the Worker's own answers to the app. Coming from the bots
    // they mean something else, that this Worker asked wrongly or that the
    // bots are broken, and that is never the reader's doing.
    [400, { error: 'Send JSON like {"address": "bcrt1..."}', code: 'bad_request' }],
    [400, { error: 'Send a small JSON body with an address', code: 'bad_request' }],
    [404, { error: 'not found', code: 'not_found' }],
    [502, { error: 'The practice network could not do that just now', code: 'unavailable' }],
    [500, { error: 'Something went wrong', code: 'error' }],
    // An unauthorized-shaped body under a status that is not 401 or 403.
    [400, { error: 'unauthorized', code: 'unauthorized' }],
    [404, { error: 'unauthorized', code: 'unauthorized' }],
    [500, { error: 'unauthorized', code: 'unauthorized' }],
    // The contract's other codes are not the bots' to send.
    [429, { error: 'x', code: 'limit' }],
    [503, { error: 'x', code: 'closed' }],
    [400, { error: 'x', code: 'bot_check' }],
    [400, { error: 'x', code: 'refused' }],
    [400, { error: 'x', code: 'dust' }],
    [405, { error: 'x', code: 'method' }],
    [413, { error: 'x', code: 'too_large' }],
    [400, { error: 'x', code: 'forbidden' }],
    // A code nobody knows, or none at all.
    [418, { error: 'x', code: 'teapot' }],
    [500, { error: 'x', code: 'teapot' }],
    [429, { error: 'x', code: '' }],
    [429, { error: 'x', code: 'BUSY' }],
    [429, { error: 'x', code: 'busy ' }],
    [429, { error: 'x', code: 7 }],
    [429, { error: 'x', code: null }],
    [429, { error: 'x', code: ['busy'] }],
    [429, { error: 'busy' }],
    [429, {}],
    // One of the six under a status the bots do not give it is not the refusal we know.
    [500, { error: 'x', code: 'busy' }],
    [503, { error: 'x', code: 'busy' }],
    [400, { error: 'x', code: 'busy' }],
    [503, { error: 'x', code: 'failed' }],
    [502, { error: 'x', code: 'failed' }],
    [400, { error: 'x', code: 'failed' }],
    [500, { error: 'x', code: 'refilling' }],
    [502, { error: 'x', code: 'refilling' }],
    [429, { error: 'x', code: 'refilling' }],
    [404, { error: 'x', code: 'bad_address' }],
    [429, { error: 'x', code: 'own_address' }],
    [400, { error: 'x', code: 'already_paid' }],
    [201, { error: 'x', code: 'busy' }],
    // A body that is not JSON, or JSON that is not an object with a code.
    [429, ''],
    [429, 'Too many requests'],
    [429, 'busy'],
    [429, '"busy"'],
    [429, '{"code":7}'],
    [429, '[]'],
    [429, '[{"code":"busy"}]'],
    [429, 'null'],
    [429, '{"code":"busy"'],
    [503, 'refilling'],
    [503, '<html><head><title>503 Service Temporarily Unavailable</title></head></html>', 'text/html'],
    [500, '<html><head><title>500 Internal Server Error</title></head></html>', 'text/html'],
    [404, '<html><head><title>404 Not Found</title></head></html>', 'text/html'],
    // A refusal too long to be one of the bots'.
    [429, { error: padding, code: 'busy' }],
    [503, { error: padding, code: 'refilling' }],
    // What would be a success, under a status that is not 200.
    [201, { txid: TXID, amount_sats: 100000, pot_coin: null }],
    [202, { address: POT_ADDRESS }],
    [206, { txid: TXID, amount_sats: 100000, pot_coin: null }],
  ];
  for (const [status, body, type] of others) {
    for (const run of BOTS) {
      const answer = await run(origin(fakeFetch(() => reply(status, body, type))));
      const what = `${status} ${JSON.stringify(body).slice(0, 80)}`;
      assert.deepEqual(answer, { ok: false, code: 'unavailable', detail: null, upstream: status, fault: faultFor(status) }, what);
    }
  }
});

test('an answer from the bots that breaks off is unavailable, with a fault, whatever its status', async () => {
  for (const status of [200, 400, 429, 500, 503]) {
    for (const run of BOTS) {
      const fetch = fakeFetch(() => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"code":"bu'));
          },
          pull(controller) {
            controller.error(new TypeError('terminated'));
          },
        });
        return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
      });
      assert.deepEqual(
        await run(origin(fetch)),
        { ok: false, code: 'unavailable', detail: null, upstream: status, fault: 'origin_down' },
        String(status),
      );
    }
  }
});

test('without the bots token the bots are not asked at all', async () => {
  const fetch = fakeFetch(() => reply(200, { address: POT_ADDRESS }));
  const o = origin(fetch, { botsToken: '' });
  const expected = { ok: false, code: 'unavailable', detail: null, upstream: null, fault: 'origin_auth' };
  assert.deepEqual(await o.faucet(ADDRESS), expected);
  assert.deepEqual(await o.potAddress(), expected);
  assert.equal(fetch.calls.length, 0);
  // The chain needs no bearer token, so it is still asked.
  await o.esplora('/blocks/tip/height');
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0]?.headers.authorization, undefined);
});

// -- the recorded samples -------------------------------------------------------------

interface Sample {
  what: string;
  request: string;
  status: number;
  contentType: string;
  body: unknown;
}
const { samples } = readJson('../../e2e/fixtures/origin-samples.json') as { samples: Sample[] };

test('every answer recorded from the real origin is read as the spec says', async () => {
  assert.ok(samples.length >= 25);
  const counts = { read: 0, broadcast: 0, faucet: 0, pot: 0, unknownTx: 0, noSuchPath: 0, notAnAddress: 0, ownRefusal: 0, otherRefusal: 0 };
  for (const sample of samples) {
    const [method, path] = sample.request.split(' ') as [string, string];
    const fetch = fakeFetch(() => reply(sample.status, sample.body as string | object, sample.contentType));
    const o = origin(fetch);
    const label = `${sample.what} (${sample.request} -> ${sample.status})`;

    if (method === 'GET' && path.startsWith('/esplora/')) {
      counts.read += 1;
      // Asked exactly as it was recorded. (The handler would never ask for
      // some of these: they are here for how their answers are read.)
      const answer = await o.esplora(path.slice('/esplora'.length));
      assert.equal(fetch.calls[0]?.url, `${ORIGIN}${path}`, label);
      if (sample.status === 200) {
        assert.ok(answer.ok, label);
        assert.equal(answer.value.type, sample.contentType === 'application/json' ? 'json' : 'text', label);
        const passed = await new Response(answer.value.body).text();
        assert.equal(passed, typeof sample.body === 'string' ? sample.body : JSON.stringify(sample.body), label);
      } else if (sample.status === 404) {
        // "Not found" is Esplora's answer about a transaction, and nobody's
        // fault. Its 404 for a path it does not have means a request went
        // astray on our side: unavailable, and the owner is told.
        const aboutTx = path.startsWith('/esplora/tx/');
        counts[aboutTx ? 'unknownTx' : 'noSuchPath'] += 1;
        assert.equal(sample.contentType, 'text/plain', label);
        assert.deepEqual(
          answer,
          aboutTx
            ? { ok: false, code: 'not_found', detail: null, upstream: 404, fault: null }
            : { ok: false, code: 'unavailable', detail: null, upstream: 404, fault: 'origin_shape' },
          label,
        );
      } else {
        // Esplora's 400 for text that is not an address of this network. The
        // handler never passes such text on (handler.test.ts holds its check
        // to these same samples), so it is not an answer for a reader.
        counts.notAnAddress += 1;
        assert.equal(sample.status, 400, label);
        assert.deepEqual(answer, { ok: false, code: 'unavailable', detail: null, upstream: 400, fault: 'origin_shape' }, label);
      }
    } else if (sample.request === 'POST /esplora/tx') {
      counts.broadcast += 1;
      assert.equal(sample.status, 200, label);
      assert.deepEqual(await o.broadcast(HEX), { ok: true, value: sample.body, upstream: 200 }, label);
    } else if (sample.request === 'POST /bots/faucet') {
      counts.faucet += 1;
      const answer = await o.faucet(ADDRESS);
      const body = sample.body as { txid: string; amount_sats: number; pot_coin: { txid: string } | null; code?: string };
      if (sample.status === 200) {
        assert.deepEqual(
          answer,
          { ok: true, value: { txid: body.txid, amountSats: body.amount_sats, potTxid: body.pot_coin?.txid ?? null }, upstream: 200 },
          label,
        );
      } else if ((BOTS_REFUSALS as readonly string[]).includes(body.code ?? '')) {
        // One of the faucet's own: passed on, under the status it came with.
        counts.ownRefusal += 1;
        assert.equal(sample.status, ERROR_STATUS[body.code as ErrorCode], label);
        assert.deepEqual(answer, { ok: false, code: body.code, detail: null, upstream: sample.status, fault: null }, label);
      } else {
        // The bots' answer to a body they could not read. The Worker writes
        // that body itself (the sample was made by hand), so this is never
        // the reader's doing: unavailable, and the owner is told.
        counts.otherRefusal += 1;
        assert.equal(body.code, 'bad_request', label);
        assert.deepEqual(answer, { ok: false, code: 'unavailable', detail: null, upstream: 400, fault: 'origin_shape' }, label);
      }
    } else if (sample.request === 'GET /bots/pot/address') {
      counts.pot += 1;
      const answer = await o.potAddress();
      if (sample.status === 200) {
        assert.deepEqual(answer, { ok: true, value: (sample.body as { address: string }).address, upstream: 200 }, label);
      } else {
        assert.equal(sample.status, 401, label);
        assert.deepEqual(answer, { ok: false, code: 'unavailable', detail: null, upstream: 401, fault: 'origin_auth' }, label);
      }
    } else {
      assert.fail(`a sample this test does not know how to read: ${label}`);
    }
  }
  assert.ok(counts.read >= 10 && counts.broadcast >= 3 && counts.faucet >= 5 && counts.pot >= 3, JSON.stringify(counts));
  assert.ok(counts.unknownTx >= 1 && counts.noSuchPath >= 1, 'both kinds of 404 the origin gives were read');
  assert.ok(counts.notAnAddress >= 2, "Esplora's 400 was read");
  assert.ok(counts.ownRefusal >= 3 && counts.otherRefusal >= 1, 'refusals of the faucet, and one that is not its own, were read');
});

// -- every "unavailable" says whose fault it is ----------------------------------------

test('whatever status the origin answers with, an "unavailable" always carries a fault, and only the known refusals pass', async () => {
  // Every status a response can have, under each kind of body the origin or
  // something in front of it might send. Only what a route knows by all of
  // its marks comes out as anything but "unavailable".
  const bodies: Array<[body: string | object, type: string]> = [
    ['Transaction not found', 'text/plain'],
    ['sendrawtransaction RPC error: {"code":-26,"message":"dust"}', 'text/plain'],
    ['<html><body>an error page</body></html>', 'text/html'],
    [{ error: 'unauthorized', code: 'unauthorized' }, 'application/json'],
    [{ error: 'The faucet is busy; try again in a minute', code: 'busy' }, 'application/json'],
    [{ error: 'The faucet is refilling; try again in a minute', code: 'refilling' }, 'application/json'],
    [{ error: 'The faucet could not finish that payment', code: 'failed' }, 'application/json'],
    [{ error: 'not found', code: 'not_found' }, 'application/json'],
    ['', 'application/octet-stream'],
  ];
  const calls: Array<[name: string, run: (o: Origin) => Promise<OriginAnswer<unknown>>]> = [
    ['read a transaction', (o) => o.esplora(`/tx/${TXID}`)],
    ['read an address', (o) => o.esplora(`/address/${ADDRESS}/txs`)],
    ['read the tip', (o) => o.esplora('/blocks/tip/height')],
    ['broadcast', (o) => o.broadcast(HEX)],
    ['faucet', (o) => o.faucet(ADDRESS)],
    ['potAddress', (o) => o.potAddress()],
  ];
  const passed = new Set<string>();
  let unavailable = 0;
  for (let status = 200; status <= 599; status += 1) {
    for (const [body, type] of bodies) {
      for (const [name, run] of calls) {
        const answer = await run(origin(fakeFetch(() => replyWith(status, body, type))));
        const what = `${name}: ${status} ${type} ${JSON.stringify(body).slice(0, 40)}`;
        if (answer.ok) {
          // Only a 200 is ever a success.
          assert.equal(status, 200, what);
          continue;
        }
        assert.equal(answer.upstream, status, what);
        if (answer.code === 'unavailable') {
          unavailable += 1;
          assert.notEqual(answer.fault, null, what);
          // A 200 that is unavailable has the wrong body. Any other status goes by the three-way rule.
          assert.equal(answer.fault, status === 200 ? 'origin_shape' : faultFor(status), what);
          continue;
        }
        // Not unavailable: one of the refusals a route knows, under exactly its own status.
        passed.add(`${name}: ${status} ${answer.code} ${answer.fault}`);
        assert.equal(status, ERROR_STATUS[answer.code], what);
      }
    }
  }
  assert.deepEqual([...passed].sort(), [
    // The node's refusal, in plain text, on a broadcast.
    'broadcast: 400 dust null',
    'broadcast: 400 refused null',
    // The faucet's own, on either bots route. Only "failed" is a fault.
    'faucet: 429 busy null',
    'faucet: 500 failed origin_down',
    'faucet: 503 refilling null',
    'potAddress: 429 busy null',
    'potAddress: 500 failed origin_down',
    'potAddress: 503 refilling null',
    // Esplora's plain-text 404, on a transaction read only.
    'read a transaction: 404 not_found null',
  ]);
  assert.ok(unavailable > 20_000, `${unavailable} answers were unavailable, each with a fault`);
});
