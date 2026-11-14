// startStack(): the Worker's own handler with local surroundings.
//
// stack.test.ts (beside this file) proves the seams between the app's client,
// the handler and the stand-in network, with the network answering in the
// same process. This file is about the wiring the local server uses: the
// settings a local run gets, the stand-in reached over a real socket through
// makeOrigin, the bot check that knows one token, the recorders, and the
// limiters a scenario can switch.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADDRESS_PATTERN } from '@learnbitcoin/practice-contract';
import type { LogLine } from '@learnbitcoin/practice-worker';
import { DEFAULT_CONFIG } from '../../app/src/lib/config.ts';
import { makeFakeOrigin } from '../src/fake-origin.ts';
import { DUMMY_TOKEN, LOCAL_VARS, TEST_SITE_KEY, localVars, startStack, wranglerVars, type Stack, type StackOptions } from '../src/stack.ts';

/** The app's address in these tests. Only the handler sees it. */
const APP = 'http://localhost:8787';
/** An address of nobody's wallet (wallet/test/vectors.json). */
const ADDRESS = 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6';

const get = (stack: Stack, path: string) => stack.handler(new Request(`${APP}${path}`, { headers: { 'User-Agent': 'stack-test' } }));
/** A POST as one of the app's own pages sends it. */
const post = (stack: Stack, path: string, body?: unknown) =>
  stack.handler(
    new Request(`${APP}${path}`, {
      method: 'POST',
      headers: { Origin: APP, 'Content-Type': 'application/json', 'User-Agent': 'stack-test' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
const errorOf = async (response: Response) => [response.status, ((await response.json()) as { error: string }).error];

/** Starts a stack that is closed when the test ends, pass or fail. */
async function withStack(options: StackOptions, run: (stack: Stack) => Promise<void>): Promise<void> {
  const stack = await startStack(options);
  try {
    await run(stack);
  } finally {
    await stack.close();
  }
}

test('the settings of a local run: the ones a deploy carries, with three laid over them', async () => {
  const shipped = wranglerVars();
  // Read from worker/wrangler.jsonc itself: the values a deploy of this repository would have.
  assert.equal(shipped.PASSKEY_HOST, 'practice.learnbitcoin.com');
  assert.equal(shipped.ORIGIN_URL, 'https://practice-origin.learnbitcoin.com');
  assert.deepEqual(Object.keys(LOCAL_VARS).sort(), ['PASSKEY_HOST', 'PLAUSIBLE_DOMAIN', 'TURNSTILE_SITE_KEY']);
  assert.deepEqual(localVars(), { ...shipped, ...LOCAL_VARS });
  assert.equal(localVars({ BLOCK_SECONDS: '10' }).BLOCK_SECONDS, '10');

  await withStack({}, async (stack) => {
    // Everything the app carries built in, except the three: passkeys on this
    // host, a site key so the faucet is open, and events switched on.
    assert.deepEqual(stack.config, { ...DEFAULT_CONFIG, passkeyHost: 'localhost', turnstileSiteKey: TEST_SITE_KEY, events: true });
    const answer = await get(stack, '/api/config');
    assert.equal(answer.status, 200);
    assert.deepEqual(await answer.json(), stack.config);
  });
  await withStack({ vars: { FAUCET_SATS: '50000', BLOCK_SECONDS: '10' } }, async (stack) => {
    assert.equal(stack.config.faucetSats, 50_000);
    assert.equal(stack.config.blockSeconds, 10);
  });
});

test('the stand-in network is reached over a socket, through makeOrigin, and its controls are handed out', async () => {
  await withStack({}, async (stack) => {
    assert.ok(stack.network);
    assert.match(stack.originUrl, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
    // The stand-in really listens there.
    assert.equal(await (await fetch(`${stack.originUrl}/esplora/blocks/tip/height`)).text(), String(stack.network.height()));
    const before = stack.network.requests().length;

    const tip = await get(stack, '/api/esplora/blocks/tip/height');
    assert.equal(tip.status, 200);
    assert.equal(await tip.text(), String(stack.network.height()));
    assert.deepEqual(stack.network.requests().slice(before), [{ method: 'GET', path: '/esplora/blocks/tip/height' }]);

    // The controls drive the chain the handler reads.
    const height = stack.network.mine(2);
    assert.equal(await (await get(stack, '/api/esplora/blocks/tip/height')).text(), String(height));
    const txid = stack.network.fund(ADDRESS, 25_000);
    const coins = (await (await get(stack, `/api/esplora/address/${ADDRESS}/utxo`)).json()) as { txid: string; value: number }[];
    assert.deepEqual(coins.map((coin) => [coin.txid, coin.value]), [[txid, 25_000]]);

    // The bots are asked with the stand-in's own token.
    const pot = await post(stack, '/api/pot/address');
    assert.equal(pot.status, 200);
    assert.match(((await pot.json()) as { address: string }).address, ADDRESS_PATTERN);
  });
});

test('the bot check passes Cloudflare\'s dummy token and no other; with no site key the faucet is closed', async () => {
  await withStack({}, async (stack) => {
    const paid = await post(stack, '/api/faucet', { address: ADDRESS, token: DUMMY_TOKEN });
    assert.equal(paid.status, 200);
    const payment = (await paid.json()) as { txid: string; amountSats: number };
    assert.equal(payment.amountSats, stack.config.faucetSats);
    assert.match(payment.txid, /^[0-9a-f]{64}$/);

    assert.deepEqual(await errorOf(await post(stack, '/api/faucet', { address: ADDRESS, token: 'XXXX.DUMMY.TOKEN.XXXY' })), [403, 'bot_check']);
    assert.deepEqual(stack.botChecks, [
      { token: DUMMY_TOKEN, address: ADDRESS },
      { token: 'XXXX.DUMMY.TOKEN.XXXY', address: ADDRESS },
    ]);
    // Only the first was passed on to the faucet.
    assert.equal(stack.network!.requests().filter((request) => request.path === '/bots/faucet').length, 1);
  });

  await withStack({ vars: { TURNSTILE_SITE_KEY: '' } }, async (stack) => {
    assert.equal(stack.config.turnstileSiteKey, '');
    assert.deepEqual(await errorOf(await post(stack, '/api/faucet', { address: ADDRESS, token: DUMMY_TOKEN })), [503, 'closed']);
    assert.equal(stack.network!.requests().length, 0);
  });
});

test('limiters never refuse, until a scenario tells one to', async () => {
  await withStack({}, async (stack) => {
    // Hex that is no transaction: it gets past the handler's own checks and the limiter, and the node refuses it.
    const broadcast = () => stack.handler(new Request(`${APP}/api/esplora/tx`, { method: 'POST', headers: { Origin: APP }, body: 'abcd' }));
    const calls: [name: 'chain' | 'broadcast' | 'pot' | 'events', ask: () => Promise<Response>, status: number][] = [
      ['chain', () => get(stack, '/api/esplora/blocks/tip/height'), 200],
      ['broadcast', broadcast, 400],
      ['pot', () => post(stack, '/api/pot/address'), 200],
      ['events', () => post(stack, '/p/event', { name: 'pageview', path: '/' }), 202],
    ];
    for (const [name, ask, status] of calls) {
      assert.equal((await ask()).status, status, name);
      const reached = stack.network!.requests().length;
      stack.over.add(name);
      assert.deepEqual(await errorOf(await ask()), [429, 'limit'], name);
      assert.equal(stack.network!.requests().length, reached, `${name}: refused before the network was asked`);
      // The others are not touched.
      assert.equal((await get(stack, '/api/esplora/blocks/tip/height')).status, name === 'chain' ? 429 : 200);
      stack.over.delete(name);
      assert.equal((await ask()).status, status, `${name}, allowed again`);
    }
    stack.over.add('faucet');
    assert.deepEqual(await errorOf(await post(stack, '/api/faucet', { address: ADDRESS, token: DUMMY_TOKEN })), [429, 'limit']);
    assert.deepEqual(stack.botChecks, [], 'refused before the bot check was asked');
  });
});

test('events go to the recorder, and only when the settings say events are on', async () => {
  await withStack({}, async (stack) => {
    assert.equal((await post(stack, '/p/event', { name: 'Wallet created', path: '/new', value: 'passkey' })).status, 202);
    await stack.settled();
    assert.deepEqual(stack.events, [
      { event: { name: 'Wallet created', path: '/new', value: 'passkey' }, meta: { ip: null, userAgent: 'stack-test' } },
    ]);
    // Something that is not one of the contract's events never gets that far.
    assert.equal((await post(stack, '/p/event', { name: 'Wallet created', path: '/new', value: ADDRESS })).status, 400);
    await stack.settled();
    assert.equal(stack.events.length, 1);
  });
  await withStack({ vars: { PLAUSIBLE_DOMAIN: '' } }, async (stack) => {
    assert.equal(stack.config.events, false);
    assert.equal((await post(stack, '/p/event', { name: 'pageview', path: '/' })).status, 202);
    await stack.settled();
    assert.deepEqual(stack.events, []);
  });
});

test('log lines are recorded, handed to the caller, and can be capped', async () => {
  const printed: LogLine[] = [];
  await withStack({ log: (line) => printed.push(line), keep: 3 }, async (stack) => {
    await get(stack, '/api/config');
    await get(stack, '/api/no-such-path');
    assert.deepEqual(stack.lines.map((line) => [line.route, line.status, line.fault]), [
      ['config', 200, null],
      ['unknown', 404, null],
    ]);
    for (let i = 0; i < 5; i += 1) await post(stack, '/api/pot/address');
    await stack.settled();
    // The recorder keeps the newest three; the caller was given all seven.
    assert.deepEqual(stack.lines.map((line) => line.route), ['pot_address', 'pot_address', 'pot_address']);
    assert.equal(printed.length, 7);
    assert.deepEqual(printed.slice(0, 2).map((line) => line.route), ['config', 'unknown']);
  });
});

test('an origin that does not answer is given up on after the time the stack was given', async () => {
  await withStack({ timeoutMs: 150 }, async (stack) => {
    stack.network!.setOrigin('slow');
    const started = Date.now();
    assert.deepEqual(await errorOf(await get(stack, '/api/esplora/blocks/tip/height')), [502, 'unavailable']);
    assert.ok(Date.now() - started < 3000, 'the wait is the one the stack was given, not the deployed 8 seconds');
    assert.equal(stack.lines.at(-1)?.fault, 'origin_timeout');
  });
});

test('close() stops the stand-in: the handler then says "unavailable", and says whose fault', async () => {
  const stack = await startStack();
  assert.equal((await get(stack, '/api/esplora/blocks/tip/height')).status, 200);
  await stack.close();
  assert.deepEqual(await errorOf(await get(stack, '/api/esplora/blocks/tip/height')), [502, 'unavailable']);
  assert.equal(stack.lines.at(-1)?.fault, 'origin_down');
  // The Worker's own answers need no origin.
  assert.equal((await get(stack, '/api/config')).status, 200);
});

test('a real origin in place of the stand-in: the live run\'s wiring', async () => {
  // "Real" here is a second stand-in on a socket of its own, known to the stack only by its address and token.
  const elsewhere = makeFakeOrigin({ height: 500, token: 'the-live-token' });
  const listening = await elsewhere.listen();
  try {
    await withStack({ origin: { url: `${listening.url}/`, botsToken: 'the-live-token' } }, async (stack) => {
      assert.equal(stack.network, null, 'no stand-in is started');
      assert.equal(stack.originUrl, listening.url);
      assert.equal(await (await get(stack, '/api/esplora/blocks/tip/height')).text(), '500');
      assert.equal((await post(stack, '/api/pot/address')).status, 200);
      assert.deepEqual(elsewhere.requests(), [
        { method: 'GET', path: '/esplora/blocks/tip/height' },
        { method: 'GET', path: '/bots/pot/address' },
      ]);
      // Closing the stack leaves an origin it did not start alone.
      await stack.close();
      assert.equal((await fetch(`${listening.url}/esplora/blocks/tip/height`)).status, 200);
    });
    // The wrong token: the bots say 401, and the handler calls that our fault.
    await withStack({ origin: { url: listening.url, botsToken: 'not-the-token' } }, async (stack) => {
      assert.deepEqual(await errorOf(await post(stack, '/api/pot/address')), [502, 'unavailable']);
      assert.equal(stack.lines.at(-1)?.fault, 'origin_auth');
    });
  } finally {
    await listening.close();
  }
});
