// The API client: what it sends, and how every kind of failure becomes one
// of the words the screens have text for.
//
// The chain calls go through the wallet package's own Esplora client, so the
// tests run that real class against a fake fetch that answers the way the
// Worker does: a refusal is { "error": <code> } with the contract's status.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  API,
  BROADCAST_REFUSALS,
  DETAIL_MAX,
  ERROR_CODES,
  ERROR_STATUS,
  type ErrorCode,
} from '@learnbitcoin/practice-contract';
import { Esplora, EsploraError } from '@learnbitcoin/practice-wallet';
import { ApiError, api, broadcastFailure, failureOf, makeApi } from '../src/lib/api.ts';

const ADDRESS = 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6';
const TXID = '6c0443f5'.padEnd(64, 'a');
const POT_TXID = '564c1d'.padEnd(64, 'b');

interface Call {
  input: string;
  init: RequestInit | undefined;
}

type FakeFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A fetch that answers every request the same way and notes what was asked. */
function answering(status: number, body: string, contentType = 'application/json') {
  const calls: Call[] = [];
  const fetchFn: FakeFetch = async (input, init) => {
    calls.push({ input, init });
    return new Response(body, { status, headers: { 'Content-Type': contentType } });
  };
  return { fetchFn, calls };
}

/** The Worker's refusal for a code: the contract's status and body. */
function refusing(code: ErrorCode, detail?: string) {
  const body = detail === undefined ? { error: code } : { error: code, detail };
  return answering(ERROR_STATUS[code], JSON.stringify(body));
}

/** Runs a call that must fail and hands back what it threw. */
async function thrownBy(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (e) {
    return e;
  }
  assert.fail('the call did not throw');
}

// -- what is sent ---------------------------------------------------------------

test('the chain goes through the wallet package client, pointed at the Worker', async () => {
  const { fetchFn, calls } = answering(200, '6326', 'text/plain');
  const client = makeApi(fetchFn);
  assert.ok(client.esplora instanceof Esplora);
  assert.equal(client.esplora.baseUrl, API.esplora);
  assert.equal(await client.esplora.tipHeight(), 6326);
  assert.equal(calls[0]?.input, `${API.esplora}/blocks/tip/height`);
  // The ready-made client is the same thing on the browser's own fetch.
  assert.equal(api.esplora.baseUrl, API.esplora);
});

test('askFaucet posts the address and the token as JSON', async () => {
  const { fetchFn, calls } = answering(200, JSON.stringify({ txid: TXID, amountSats: 100000, potTxid: null }));
  const payment = await makeApi(fetchFn).askFaucet(ADDRESS, 'a-token');
  assert.deepEqual(payment, { txid: TXID, amountSats: 100000, potTxid: null });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, API.faucet);
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(new Headers(calls[0]?.init?.headers).get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { address: ADDRESS, token: 'a-token' });
});

test('askFaucet says which earlier payment the coin came from, when the faucet does', async () => {
  const answer = { txid: TXID, amountSats: 100000, potTxid: POT_TXID, extra: 'ignored' };
  const payment = await makeApi(answering(200, JSON.stringify(answer)).fetchFn).askFaucet(ADDRESS, 't');
  assert.deepEqual(payment, { txid: TXID, amountSats: 100000, potTxid: POT_TXID });

  // The payment is real with or without that ID, so a missing or odd one is null, not a failure.
  for (const potTxid of [undefined, 7, 'not-an-id', POT_TXID.toUpperCase()]) {
    const body = JSON.stringify({ txid: TXID, amountSats: 100000, potTxid });
    assert.equal((await makeApi(answering(200, body).fetchFn).askFaucet(ADDRESS, 't')).potTxid, null);
  }
});

test('potAddress posts an empty body', async () => {
  const { fetchFn, calls } = answering(200, JSON.stringify({ address: ADDRESS }));
  assert.equal(await makeApi(fetchFn).potAddress(), ADDRESS);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, API.potAddress);
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(calls[0]?.init?.body, undefined);
});

// -- refusals from the faucet and the pot -----------------------------------------

test('every refusal code comes out as an ApiError with that code', async () => {
  for (const code of ERROR_CODES) {
    for (const call of [
      () => makeApi(refusing(code).fetchFn).askFaucet(ADDRESS, 't'),
      () => makeApi(refusing(code).fetchFn).potAddress(),
    ]) {
      const e = await thrownBy(call);
      assert.ok(e instanceof ApiError, code);
      assert.ok(e instanceof Error);
      assert.equal(e.name, 'ApiError');
      assert.equal(e.status, ERROR_STATUS[code]);
      assert.equal(e.reason, code);
      assert.equal(e.detail, null);
      assert.equal(failureOf(e), code);
    }
  }
});

test('a refusal keeps its detail, cut to the contract length', async () => {
  const e = await thrownBy(() => makeApi(refusing('refused', 'x'.repeat(DETAIL_MAX + 50)).fetchFn).potAddress());
  assert.ok(e instanceof ApiError);
  assert.equal(e.reason, 'refused');
  assert.equal(e.detail, 'x'.repeat(DETAIL_MAX));
});

test('an answer that is not a refusal of the Worker: only the status is left to go on', async () => {
  const bodies = [
    '<!doctype html><title>502 Bad Gateway</title>',
    '',
    'error code: 1015',
    '[]',
    'null',
    '"limit"',
    '{}',
    '{"message":"limit"}',
    '{"error":429}',
    '{"error":{"code":"limit"}}',
  ];
  for (const status of [400, 403, 404, 429, 500, 502, 503]) {
    // 429 means asking too fast, whoever says it: the rate limit of the
    // network in front of the Worker answers with a page of its own. The
    // faucet then waits and asks again, where "unavailable" would stop it.
    // A 404 says nothing here: these paths ask the bots, not the chain.
    const expect = status === 429 ? 'limit' : 'unavailable';
    for (const body of bodies) {
      for (const call of [
        () => makeApi(answering(status, body, 'text/html').fetchFn).askFaucet(ADDRESS, 't'),
        () => makeApi(answering(status, body, 'text/html').fetchFn).potAddress(),
      ]) {
        const e = await thrownBy(call);
        assert.ok(e instanceof ApiError, body);
        assert.equal(e.reason, expect, `${status} ${body}`);
        assert.equal(e.status, status);
        assert.equal(e.detail, null);
        assert.equal(failureOf(e), expect);
      }
    }
  }
});

test('a refusal with a code this app does not know is "unavailable", whatever the status', async () => {
  // A tab left open across a deploy runs the old app against a newer Worker.
  // The status cannot stand in for the code: the contract uses 429 for
  // "limit", "already_paid" and "busy", and 404 only for "not_found".
  const bodies = [
    '{"error":"something_new"}',
    '{"error":"something_new","detail":"words that belong to a code this app cannot place"}',
    '{"error":"LIMIT"}',
    '{"error":"toString"}',
    '{"error":""}',
    // Long enough that the wallet's Esplora client cuts the body short.
    `{"error":"something_new","detail":"${'x'.repeat(DETAIL_MAX)}"}`,
    `{"error":"Something New","detail":"${'x'.repeat(DETAIL_MAX)}"}`,
  ];
  for (const status of [400, 403, 404, 429, 500, 502, 503]) {
    for (const body of bodies) {
      const where = `${status} ${body.slice(0, 40)}`;
      const client = () => makeApi(answering(status, body).fetchFn);
      // The faucet and the pot ...
      for (const call of [() => client().askFaucet(ADDRESS, 't'), () => client().potAddress()]) {
        const e = await thrownBy(call);
        assert.ok(e instanceof ApiError, where);
        assert.equal(e.reason, 'unavailable', where);
        assert.equal(e.status, status);
        assert.equal(e.detail, null);
      }
      // ... and the chain, read the same way.
      for (const call of [() => client().esplora.tx(TXID), () => client().esplora.addressUtxos(ADDRESS)]) {
        const e = await thrownBy(call);
        assert.ok(e instanceof EsploraError, where);
        // The long bodies reach the app without their end, and are still read as refusals.
        if (body.length > 300) assert.ok(!e.message.endsWith('}'), 'the client cut the body');
        assert.equal(failureOf(e), 'unavailable', where);
      }
      const sent = await thrownBy(() => client().esplora.broadcast('00'));
      assert.deepEqual(broadcastFailure(sent), { reason: 'unavailable', detail: null }, where);
    }
  }
});

test('no answer at all is "network"', async () => {
  // What fetch throws when the request never gets an answer, in Node and in every browser.
  const offline: FakeFetch = () => Promise.reject(new TypeError('fetch failed'));
  for (const call of [() => makeApi(offline).askFaucet(ADDRESS, 't'), () => makeApi(offline).potAddress()]) {
    const e = await thrownBy(call);
    assert.ok(e instanceof ApiError);
    assert.equal(e.reason, 'network');
    assert.equal(e.status, 0);
    assert.equal(failureOf(e), 'network');
  }
  // A request that was given up on is no answer either.
  const timedOut: FakeFetch = () => Promise.reject(new DOMException('took too long', 'TimeoutError'));
  assert.equal(failureOf(await thrownBy(() => makeApi(timedOut).potAddress())), 'network');
  // Anything else a fetch might throw is not the reader's connection.
  const broken: FakeFetch = () => Promise.reject(new Error('a bug'));
  assert.equal(failureOf(await thrownBy(() => makeApi(broken).potAddress())), 'unavailable');
});

test('a 200 the app cannot use is "unavailable"', async () => {
  const faucetAnswers = [
    'not json',
    '',
    'null',
    '[]',
    '7',
    '{}',
    JSON.stringify({ txid: TXID }),
    JSON.stringify({ amountSats: 100000 }),
    JSON.stringify({ txid: 'abc', amountSats: 100000, potTxid: null }),
    JSON.stringify({ txid: TXID.toUpperCase(), amountSats: 100000, potTxid: null }),
    JSON.stringify({ txid: TXID, amountSats: '100000', potTxid: null }),
    JSON.stringify({ txid: TXID, amountSats: 0, potTxid: null }),
    JSON.stringify({ txid: TXID, amountSats: -100000, potTxid: null }),
    JSON.stringify({ txid: TXID, amountSats: 1000.5, potTxid: null }),
    // The bots' own field names: the Worker is meant to have turned these into the contract's.
    JSON.stringify({ txid: TXID, amount_sats: 100000, pot_coin: null }),
  ];
  for (const body of faucetAnswers) {
    const e = await thrownBy(() => makeApi(answering(200, body).fetchFn).askFaucet(ADDRESS, 't'));
    assert.ok(e instanceof ApiError, body);
    assert.equal(e.reason, 'unavailable', body);
    assert.equal(e.status, 200);
  }
  const potAnswers = [
    'not json',
    'null',
    '{}',
    JSON.stringify({ address: 7 }),
    JSON.stringify({ address: '' }),
    JSON.stringify({ address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' }),
    JSON.stringify({ address: 'tb1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjpupg53' }),
    JSON.stringify([ADDRESS]),
  ];
  for (const body of potAnswers) {
    const e = await thrownBy(() => makeApi(answering(200, body).fetchFn).potAddress());
    assert.ok(e instanceof ApiError, body);
    assert.equal(e.reason, 'unavailable', body);
  }
});

// -- failures of the wallet package's Esplora client ------------------------------

test('failureOf reads the code out of what the Esplora client throws', async () => {
  for (const code of ERROR_CODES) {
    const esplora = makeApi(refusing(code).fetchFn).esplora;
    for (const call of [() => esplora.tx(TXID), () => esplora.addressUtxos(ADDRESS), () => esplora.tipHeight()]) {
      const e = await thrownBy(call);
      assert.ok(e instanceof EsploraError);
      assert.equal(e.status, ERROR_STATUS[code]);
      assert.equal(failureOf(e), code, code);
    }
  }
});

test('failureOf falls back on the status when the body is not a refusal', async () => {
  const cases: [status: number, body: string, expect: string][] = [
    // What Esplora itself answers for an unknown transaction, with no Worker in between.
    [404, 'Transaction not found', 'not_found'],
    [404, '<!doctype html>', 'not_found'],
    [404, '{"error":404}', 'not_found'],
    [429, 'error code: 1015', 'limit'],
    [429, '', 'limit'],
    [400, 'Invalid Bitcoin address', 'unavailable'],
    [401, '', 'unavailable'],
    [403, '<html>blocked</html>', 'unavailable'],
    [500, '{"message":"boom"}', 'unavailable'],
    [502, '', 'unavailable'],
    [503, 'null', 'unavailable'],
  ];
  for (const [status, body, expect] of cases) {
    const e = await thrownBy(() => makeApi(answering(status, body, 'text/plain').fetchFn).esplora.tx(TXID));
    assert.ok(e instanceof EsploraError);
    assert.equal(failureOf(e), expect, `${status} ${body}`);
  }
});

test('failureOf: no answer is "network", and anything unknown is "unavailable"', async () => {
  const offline: FakeFetch = () => Promise.reject(new TypeError('Failed to fetch'));
  assert.equal(failureOf(await thrownBy(() => makeApi(offline).esplora.tipHeight())), 'network');
  assert.equal(failureOf(new TypeError('Load failed')), 'network');
  assert.equal(failureOf(new DOMException('aborted', 'AbortError')), 'network');
  assert.equal(failureOf(new DOMException('timed out', 'TimeoutError')), 'network');

  // A 200 whose body is not JSON: the Esplora client's own parse fails.
  const page = await thrownBy(() => makeApi(answering(200, '<!doctype html>', 'text/html').fetchFn).esplora.tx(TXID));
  assert.ok(page instanceof SyntaxError);
  assert.equal(failureOf(page), 'unavailable');

  for (const odd of [new Error('x'), new RangeError('x'), 'limit', 404, null, undefined, {}, { reason: 'limit' }]) {
    assert.equal(failureOf(odd), 'unavailable');
  }
  // An EsploraError made by hand, with a message that is not the client's.
  assert.equal(failureOf(new EsploraError('something else', 429)), 'limit');
  assert.equal(failureOf(new EsploraError('{"error":"dust"}', 400)), 'unavailable');
});

// -- a refused broadcast ----------------------------------------------------------

interface RecordedRefusal {
  what: string;
  status: number;
  /** The node's own words, as the practice network's Esplora answered them. */
  body: string;
  /** The code the Worker must turn it into. */
  expect: ErrorCode;
}

const recorded = JSON.parse(
  readFileSync(new URL('../../worker/test/fixtures/broadcast-refusals.json', import.meta.url), 'utf8'),
) as { refusals: RecordedRefusal[] };

test('broadcastFailure: every refusal recorded from the network keeps its code and the node words', async () => {
  assert.ok(recorded.refusals.length >= 10);
  const seen = new Set<string>();
  for (const refusal of recorded.refusals) {
    const detail = refusal.body.slice(0, DETAIL_MAX);
    const { fetchFn, calls } = refusing(refusal.expect, detail);
    const e = await thrownBy(() => makeApi(fetchFn).esplora.broadcast('00'));
    assert.equal(calls[0]?.input, `${API.esplora}/tx`);
    assert.equal(calls[0]?.init?.method, 'POST');
    assert.deepEqual(broadcastFailure(e), { reason: refusal.expect, detail }, refusal.what);
    assert.equal(failureOf(e), refusal.expect, refusal.what);
    seen.add(refusal.expect);
  }
  // The recording covers every refusal a broadcast can end in.
  assert.deepEqual([...seen].sort(), [...BROADCAST_REFUSALS].sort());
});

test('broadcastFailure: a refusal without the node words has no detail', async () => {
  for (const code of BROADCAST_REFUSALS) {
    const e = await thrownBy(() => makeApi(refusing(code).fetchFn).esplora.broadcast('00'));
    assert.deepEqual(broadcastFailure(e), { reason: code, detail: null });
    const empty = await thrownBy(() => makeApi(refusing(code, '').fetchFn).esplora.broadcast('00'));
    assert.deepEqual(broadcastFailure(empty), { reason: code, detail: null });
  }
});

test('broadcastFailure: a long refusal still gives its code, though the client cut the body', async () => {
  // The wallet's Esplora client keeps the first 300 characters of a body. A
  // detail of the full contract length makes the body longer than that, so
  // what reaches the app is JSON without its end.
  const message = 'non-mandatory-script-verify-flag '.repeat(12);
  const words = `sendrawtransaction RPC error: {"code":-26,"message":"${message}"}`;
  const detail = words.slice(0, DETAIL_MAX);
  assert.equal(detail.length, DETAIL_MAX);
  for (const code of BROADCAST_REFUSALS) {
    const e = await thrownBy(() => makeApi(refusing(code, detail).fetchFn).esplora.broadcast('00'));
    assert.ok(e instanceof EsploraError);
    assert.throws(() => JSON.parse(e.message.slice(e.message.indexOf('{'))), SyntaxError, 'the body was cut');
    const failure = broadcastFailure(e);
    assert.equal(failure.reason, code);
    assert.equal(failureOf(e), code);
    // What is left of the node's words: a clean start of them, most of the way.
    assert.ok(failure.detail !== null && failure.detail.length > 200, String(failure.detail?.length));
    assert.ok(detail.startsWith(failure.detail));
  }
});

test('broadcastFailure: a cut that falls inside an escape leaves no half character', async () => {
  // Every position of the cut, across text full of characters JSON has to
  // escape: an accented letter, quotes, a backslash, a line separator, a tab,
  // a new line and a smiling face, which is two units long.
  const [accented, separator, face] = [0xe9, 0x2028, 0x1f600].map((code) => String.fromCodePoint(code));
  const tricky = `caf${accented} "quoted" back\\slash ${separator} tab\t new\nline ${face} `;
  const ends = new Set<string>();
  for (let pad = 0; pad < 40; pad++) {
    const detail = ('x'.repeat(pad) + tricky.repeat(12)).slice(0, DETAIL_MAX);
    // Written with every character above 127 escaped, as some servers write JSON.
    const body = JSON.stringify({ error: 'refused', detail }).replace(
      /[^\x00-\x7f]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    const e = await thrownBy(() => makeApi(answering(400, body).fetchFn).esplora.broadcast('00'));
    const failure = broadcastFailure(e);
    assert.equal(failure.reason, 'refused');
    assert.ok(failure.detail !== null && failure.detail.length > 100, `pad ${pad}`);
    assert.ok(detail.startsWith(failure.detail), `pad ${pad}: ${JSON.stringify(failure.detail.slice(-12))}`);
    // The smiling face is two units long: half of it is not a character.
    assert.doesNotMatch(failure.detail, /[\ud800-\udbff]$/, `pad ${pad}`);
    ends.add(failure.detail.slice(-1));
  }
  // The cuts really fell in different places, escapes included.
  assert.ok(ends.size >= 8, [...ends].join(''));
});

test('a detail the Worker cut in the middle of a character loses the half', async () => {
  const detail = `${'x'.repeat(DETAIL_MAX - 1)}${String.fromCodePoint(0x1f600)}`;
  const e = await thrownBy(() => makeApi(refusing('refused', detail).fetchFn).potAddress());
  assert.ok(e instanceof ApiError);
  assert.equal(e.detail, 'x'.repeat(DETAIL_MAX - 1));
});

test('broadcastFailure: everything that is not a refusal by the node', async () => {
  const nodeWords = 'sendrawtransaction RPC error: {"code":-26,"message":"dust"}';
  const cases: [fetchFn: FakeFetch, expect: string][] = [
    [refusing('limit').fetchFn, 'limit'],
    [answering(429, 'error code: 1015', 'text/plain').fetchFn, 'limit'],
    [refusing('unavailable').fetchFn, 'unavailable'],
    // Codes that say the payment never reached the node.
    [refusing('bad_request').fetchFn, 'unavailable'],
    [refusing('forbidden').fetchFn, 'unavailable'],
    [refusing('too_large').fetchFn, 'unavailable'],
    [refusing('method').fetchFn, 'unavailable'],
    [refusing('not_found').fetchFn, 'unavailable'],
    // A faucet code has no business here.
    [refusing('busy', 'not the node').fetchFn, 'unavailable'],
    // The node's words with no Worker in between: not the contract's body.
    [answering(400, nodeWords, 'text/plain').fetchFn, 'unavailable'],
    [answering(502, '<html>Bad gateway</html>', 'text/html').fetchFn, 'unavailable'],
    [() => Promise.reject(new TypeError('fetch failed')), 'network'],
  ];
  for (const [fetchFn, expect] of cases) {
    const e = await thrownBy(() => makeApi(fetchFn).esplora.broadcast('00'));
    assert.deepEqual(broadcastFailure(e), { reason: expect, detail: null }, expect);
  }
});

test('broadcastFailure never throws, whatever it is handed', () => {
  assert.deepEqual(broadcastFailure(new ApiError(400, 'dust', 'the node said so')), {
    reason: 'dust',
    detail: 'the node said so',
  });
  assert.deepEqual(broadcastFailure(new ApiError(0, 'network')), { reason: 'network', detail: null });
  assert.deepEqual(broadcastFailure(new ApiError(429, 'busy', 'x')), { reason: 'unavailable', detail: null });
  for (const odd of [null, undefined, 0, 'dust', {}, [], new Error('x'), Symbol('x'), () => 'dust']) {
    assert.deepEqual(broadcastFailure(odd), { reason: 'unavailable', detail: null });
  }
});
