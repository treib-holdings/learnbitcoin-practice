import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTION, TOKEN_MAX, VERIFY_URL, makeBotCheck } from '../src/bot-check.ts';
import type { FetchLike } from '../src/deps.ts';
import { ADDRESS, fakeFetch, noNetwork, reply, slowFetch } from './fakes.ts';

noNetwork();

const HOST = 'practice.learnbitcoin.com';
const TOKEN = 'token-from-the-widget';

/** What the verify service says about a token that is good in every way. */
const GOOD = {
  success: true,
  challenge_ts: '2026-11-14T00:00:00.000Z',
  hostname: HOST,
  'error-codes': [],
  action: 'faucet',
  cdata: ADDRESS,
};

function check(fetch: FetchLike, change: { siteKey?: string; secret?: string; hostname?: string } = {}) {
  return makeBotCheck({ siteKey: 'site-key', secret: 'the-secret', hostname: HOST, fetch, ...change });
}

test('the verify address is a constant, and the request tells it the secret and the token only', async () => {
  assert.equal(VERIFY_URL, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(ACTION, 'faucet');
  assert.equal(TOKEN_MAX, 2048);

  const fetch = fakeFetch(() => reply(200, GOOD));
  await check(fetch)(TOKEN, ADDRESS);
  assert.equal(fetch.calls.length, 1);
  const call = fetch.calls[0]!;
  assert.equal(call.url, VERIFY_URL);
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(call.headers, { accept: 'application/json', 'content-type': 'application/json' });
  // No "remoteip", no address, nothing about the reader.
  assert.deepEqual(JSON.parse(call.init.body as string), { secret: 'the-secret', response: TOKEN });
  assert.equal(call.init.redirect, 'manual');
  assert.ok(call.init.signal instanceof AbortSignal);
});

test('a token passes only when success, hostname, action and cdata all agree', async () => {
  assert.deepEqual(await check(fakeFetch(() => reply(200, GOOD)))(TOKEN, ADDRESS), {
    verdict: 'pass',
    upstream: 200,
    fault: null,
  });
});

test('solved for another address: the reader can run the check again', async () => {
  const other = 'bcrt1qxagpc0v6mxg2dq230xmphn8nuzaasw8uk6v5l9';
  for (const cdata of [other, '', undefined, null, ADDRESS.toUpperCase(), `${ADDRESS} `]) {
    const answer = await check(fakeFetch(() => reply(200, { ...GOOD, cdata })))(TOKEN, ADDRESS);
    assert.deepEqual(answer, { verdict: 'fail', upstream: 200, fault: null }, String(cdata));
  }
});

test('solved on another host or for another form: shut, and the owner is told', async () => {
  const wrong = [
    { hostname: 'example.com' },
    { hostname: 'www.learnbitcoin.com' },
    { hostname: `evil.${HOST}` },
    { hostname: HOST.toUpperCase() },
    { hostname: undefined },
    { action: 'newsletter' },
    { action: '' },
    { action: undefined },
    { action: 'Faucet' },
  ];
  for (const change of wrong) {
    const answer = await check(fakeFetch(() => reply(200, { ...GOOD, ...change })))(TOKEN, ADDRESS);
    assert.deepEqual(answer, { verdict: 'down', upstream: 200, fault: 'bot_check_config' }, JSON.stringify(change));
  }
});

test("Cloudflare's published test secret can never pass: it names example.com and gives no action", async () => {
  // The answer the verify service gave for the dummy secret and the dummy token.
  const testAnswer = {
    challenge_ts: '2026-11-14T04:06:00.000Z',
    'error-codes': [],
    hostname: 'example.com',
    metadata: { result_with_testing_key: true },
    success: true,
  };
  const answer = await check(fakeFetch(() => reply(200, testAnswer)))('XXXX.DUMMY.TOKEN.XXXX', ADDRESS);
  assert.deepEqual(answer, { verdict: 'down', upstream: 200, fault: 'bot_check_config' });
  // Even on a Worker whose configured host were example.com: no action, no pass.
  const sameHost = await check(fakeFetch(() => reply(200, testAnswer)), { hostname: 'example.com' })('XXXX.DUMMY.TOKEN.XXXX', ADDRESS);
  assert.equal(sameHost.verdict, 'down');
});

test('a token the service rejects is a fail, whatever status the rejection comes with', async () => {
  for (const code of ['invalid-input-response', 'timeout-or-duplicate', 'missing-input-response']) {
    for (const status of [200, 400]) {
      const answer = await check(fakeFetch(() => reply(status, { success: false, 'error-codes': [code], messages: [] })))(TOKEN, ADDRESS);
      assert.deepEqual(answer, { verdict: 'fail', upstream: status, fault: null }, `${code} ${status}`);
    }
  }
});

test('a refused secret is our fault: shut, with the config fault', async () => {
  for (const code of ['invalid-input-secret', 'missing-input-secret']) {
    // The service answers a wrong secret with status 400 and a JSON body.
    for (const status of [400, 200]) {
      const body = { success: false, 'error-codes': [code, 'invalid-input-response'], messages: [] };
      const answer = await check(fakeFetch(() => reply(status, body)))(TOKEN, ADDRESS);
      assert.deepEqual(answer, { verdict: 'down', upstream: status, fault: 'bot_check_config' }, `${code} ${status}`);
    }
  }
});

test('any doubt keeps the faucet shut', async () => {
  const doubts: Array<[string, () => Response]> = [
    ['a server error', () => reply(500, 'Internal error', 'text/plain')],
    ['a server error with JSON', () => reply(503, { success: false, 'error-codes': ['internal-error'] })],
    ['a redirect', () => reply(302, null)],
    ['not JSON', () => reply(200, '<html>ok</html>', 'text/html')],
    ['an empty body', () => reply(200, '')],
    ['JSON that is not an object', () => reply(200, 'true')],
    ['null', () => reply(200, 'null')],
    ['an array', () => reply(200, '[{"success":true}]')],
    ['no success field', () => reply(200, { hostname: HOST, action: 'faucet', cdata: ADDRESS })],
    ['success as a string', () => reply(200, { ...GOOD, success: 'true' })],
    ['success as a number', () => reply(200, { ...GOOD, success: 1 })],
    ['a failure with no codes', () => reply(200, { success: false })],
    ['a failure with an unknown code', () => reply(200, { success: false, 'error-codes': ['something-new'] })],
    ['internal-error', () => reply(200, { success: false, 'error-codes': ['internal-error'] })],
    ['bad-request', () => reply(400, { success: false, 'error-codes': ['bad-request'] })],
    ['codes that are not a list', () => reply(200, { success: false, 'error-codes': 'invalid-input-response' })],
    ['a success with a status that is not 200', () => reply(203, GOOD)],
    ['an answer too long to be one', () => reply(200, { ...GOOD, padding: 'x'.repeat(20_000) })],
  ];
  for (const [what, respond] of doubts) {
    const answer = await check(fakeFetch(respond))(TOKEN, ADDRESS);
    assert.equal(answer.verdict, 'down', what);
    assert.equal(answer.fault, 'bot_check_down', what);
    assert.equal(answer.upstream, respond().status, what);
  }
});

test('a service that cannot be asked, or does not answer in time, keeps the faucet shut', async () => {
  const thrown = await check(
    fakeFetch(() => {
      throw new TypeError('fetch failed');
    }),
  )(TOKEN, ADDRESS);
  assert.deepEqual(thrown, { verdict: 'down', upstream: null, fault: 'bot_check_down' });

  // The real limit is 8 seconds; here the signal the request carries is fired by hand.
  const fetch = slowFetch(null, () => reply(200, GOOD));
  const original = AbortSignal.timeout;
  let asked = 0;
  AbortSignal.timeout = (ms: number) => {
    asked = ms;
    return original.call(AbortSignal, 10);
  };
  try {
    assert.deepEqual(await check(fetch)(TOKEN, ADDRESS), { verdict: 'down', upstream: null, fault: 'bot_check_down' });
  } finally {
    AbortSignal.timeout = original;
  }
  assert.equal(asked, 8000);
});

test('no site key: the faucet is closed and the service is never asked', async () => {
  const fetch = fakeFetch(() => reply(200, GOOD));
  assert.deepEqual(await check(fetch, { siteKey: '' })(TOKEN, ADDRESS), { verdict: 'closed', upstream: null, fault: null });
  // Closed stays closed even with a secret missing as well.
  assert.deepEqual(await check(fetch, { siteKey: '', secret: '' })(TOKEN, ADDRESS), { verdict: 'closed', upstream: null, fault: null });
  assert.equal(fetch.calls.length, 0);
});

test('a site key without a secret or a host: closed, and the owner is told', async () => {
  const fetch = fakeFetch(() => reply(200, GOOD));
  for (const change of [{ secret: '' }, { hostname: '' }]) {
    assert.deepEqual(await check(fetch, change)(TOKEN, ADDRESS), {
      verdict: 'closed',
      upstream: null,
      fault: 'bot_check_config',
    });
  }
  assert.equal(fetch.calls.length, 0);
});

test('a setting that is missing or only spaces is read as not set', async () => {
  const fetch = fakeFetch(() => reply(200, GOOD));
  // What a deleted setting is when the Worker runs, whatever its type says.
  const missing = undefined as unknown as string;
  // No site key: closed on purpose, as GET /api/config tells the app.
  for (const siteKey of [missing, '   ', '\n']) {
    assert.deepEqual(
      await check(fetch, { siteKey })(TOKEN, ADDRESS),
      { verdict: 'closed', upstream: null, fault: null },
      JSON.stringify(siteKey),
    );
  }
  // A site key, but no secret or no host to hold a token to: closed, and the owner is told.
  for (const change of [{ secret: missing }, { secret: '  ' }, { hostname: missing }, { hostname: ' ' }]) {
    assert.deepEqual(
      await check(fetch, change)(TOKEN, ADDRESS),
      { verdict: 'closed', upstream: null, fault: 'bot_check_config' },
      JSON.stringify(change),
    );
  }
  assert.equal(fetch.calls.length, 0, 'the verify service is never asked');
});

test('a host name that is not set never matches an answer that names no host', async () => {
  // Compared as they came, a missing setting would equal a missing field, and
  // a blank one a blank field: the one check that ties a token to this site
  // would pass by itself.
  const missing = undefined as unknown as string;
  const noHost = { success: true, action: 'faucet', cdata: ADDRESS, 'error-codes': [] };
  const cases: Array<[configured: string, answered: object]> = [
    [missing, noHost],
    [' ', { ...noHost, hostname: ' ' }],
    ['', { ...noHost, hostname: '' }],
  ];
  for (const [configured, answered] of cases) {
    const fetch = fakeFetch(() => reply(200, answered));
    const answer = await check(fetch, { hostname: configured })(TOKEN, ADDRESS);
    assert.deepEqual(answer, { verdict: 'closed', upstream: null, fault: 'bot_check_config' }, JSON.stringify(answered));
    assert.equal(fetch.calls.length, 0);
  }
  // With a host configured, an answer that names none is still no pass.
  const answer = await check(fakeFetch(() => reply(200, noHost)))(TOKEN, ADDRESS);
  assert.deepEqual(answer, { verdict: 'down', upstream: 200, fault: 'bot_check_config' });
});

test('spaces around a setting are not part of it', async () => {
  const fetch = fakeFetch(() => reply(200, GOOD));
  const spaced = { siteKey: ' site-key ', secret: ' the-secret\n', hostname: ` ${HOST} ` };
  assert.deepEqual(await check(fetch, spaced)(TOKEN, ADDRESS), { verdict: 'pass', upstream: 200, fault: null });
  assert.deepEqual(JSON.parse(fetch.calls[0]?.init.body as string), { secret: 'the-secret', response: TOKEN });
});

test('an empty token or one over 2048 characters fails without asking the service', async () => {
  const fetch = fakeFetch(() => reply(200, GOOD));
  for (const token of ['', 'x'.repeat(TOKEN_MAX + 1), 'x'.repeat(100_000)]) {
    assert.deepEqual(await check(fetch)(token, ADDRESS), { verdict: 'fail', upstream: null, fault: null });
  }
  assert.equal(fetch.calls.length, 0);
  // Exactly 2048 is asked about.
  await check(fetch)('x'.repeat(TOKEN_MAX), ADDRESS);
  assert.equal(fetch.calls.length, 1);
});

test('nothing about a key or a token gets special treatment', async () => {
  // The same answer gives the same verdict whatever the secret, site key or token look like.
  const keys = [
    { siteKey: '1x00000000000000000000AA', secret: '1x0000000000000000000000000000000AA' },
    { siteKey: 'site-key', secret: 'the-secret' },
  ];
  for (const change of keys) {
    for (const token of ['XXXX.DUMMY.TOKEN.XXXX', TOKEN]) {
      const rejected = await check(fakeFetch(() => reply(200, { success: false, 'error-codes': ['invalid-input-response'] })), change)(token, ADDRESS);
      assert.equal(rejected.verdict, 'fail');
      const wrongHost = await check(fakeFetch(() => reply(200, { ...GOOD, hostname: 'example.com' })), change)(token, ADDRESS);
      assert.equal(wrongHost.verdict, 'down');
      const good = await check(fakeFetch(() => reply(200, GOOD)), change)(token, ADDRESS);
      assert.equal(good.verdict, 'pass');
    }
  }
});
