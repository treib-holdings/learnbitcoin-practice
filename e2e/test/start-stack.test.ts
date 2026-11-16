// startStack(): the Worker's own handler with local surroundings.
//
// stack.test.ts (beside this file) proves the seams between the app's client,
// the handler and the stand-in network, with the network answering in the
// same process. This file is about the wiring the local server uses: the
// settings a local run gets, the stand-in reached over a real socket through
// makeOrigin, the bot check that knows one token, the recorders, the
// limiters a scenario can switch, and the clock a scenario can move on.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADDRESS_PATTERN } from '@learnbitcoin/practice-contract';
import { POT_STATS_KEEP_MS, POT_STATS_PAUSE_MS, type LogLine } from '@learnbitcoin/practice-worker';
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

test('the pot\'s counts are switched off in a local run, as they are shipped: their path is an unknown path, and the network is not asked; a scenario switches them on in its settings', async () => {
  assert.equal(wranglerVars().POT_COUNTS, 'off');
  assert.ok(!('POT_COUNTS' in LOCAL_VARS), 'a local run does not lay its own value over it');
  await withStack({}, async (stack) => {
    assert.equal(stack.config.potCounts, false);
    const counts = await get(stack, '/api/pot/stats');
    const unknown = await get(stack, '/api/pot/statz');
    assert.deepEqual([counts.status, [...counts.headers], await counts.text()], [unknown.status, [...unknown.headers], await unknown.text()]);
    assert.equal(counts.status, 404);
    assert.deepEqual((await (await get(stack, '/api/pot/statz')).json()) as unknown, { error: 'not_found' });
    assert.deepEqual(stack.lines.map((line) => [line.route, line.status, line.upstream, line.fault]), [
      ['unknown', 404, null, null],
      ['unknown', 404, null, null],
      ['unknown', 404, null, null],
    ]);
    assert.deepEqual(stack.network!.requests(), [], 'the stand-in network heard nothing');
    // "Pass it on" itself needs the pot's address, and that is answered as ever.
    assert.equal((await post(stack, '/api/pot/address')).status, 200);
  });
  // Only the exact word switches them on, here as in the Worker.
  for (const value of ['ON', ' on', 'true', '1', '']) {
    await withStack({ vars: { POT_COUNTS: value } }, async (stack) => {
      assert.equal(stack.config.potCounts, false, JSON.stringify(value));
      assert.equal((await get(stack, '/api/pot/stats')).status, 404, JSON.stringify(value));
    });
  }
  await withStack({ vars: { POT_COUNTS: 'on' } }, async (stack) => {
    assert.equal(stack.config.potCounts, true);
    assert.deepEqual(await (await get(stack, '/api/pot/stats')).json(), { passedOn: 0, waiting: 0, handedOn: 0 });
    assert.deepEqual(stack.network!.requests(), [{ method: 'GET', path: '/bots/pot/stats' }]);
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

test("switched on, the pot's counts are kept by the stack's Worker as by the deployed one: the network is asked once, again when the scenario says that 15 seconds have passed, and after a failure only when it says that 5 have", async () => {
  const none = { passedOn: 0, waiting: 0, handedOn: 0 };
  const ON = { vars: { POT_COUNTS: 'on' } };
  await withStack(ON, async (stack) => {
    const asked = (): number => stack.network!.requests().filter((request) => request.path === '/bots/pot/stats').length;
    const counts = async (): Promise<unknown> => (await get(stack, '/api/pot/stats')).json();

    assert.deepEqual(await counts(), none);
    assert.equal(asked(), 1);
    // Somebody pays the pot, and a block takes the payment in.
    const pot = ((await (await post(stack, '/api/pot/address')).json()) as { address: string }).address;
    assert.match(pot, ADDRESS_PATTERN);
    stack.network!.fund(pot, 5_000);
    // The Worker has an answer from a moment ago and gives it to every request. The network is not
    // asked: nothing switches the keeping off for a local run.
    for (let look = 0; look < 25; look += 1) assert.deepEqual(await counts(), none);
    assert.equal(asked(), 1);

    // A scenario that needs the figure as it now stands says that the Worker's 15 seconds are over.
    stack.advanceClock(5_000);
    assert.deepEqual(await counts(), none, 'five seconds on, the answer is still the kept one');
    stack.advanceClock(POT_STATS_KEEP_MS - 5_000);
    assert.deepEqual(await counts(), { passedOn: 1, waiting: 1, handedOn: 0 });
    assert.deepEqual(await counts(), { passedOn: 1, waiting: 1, handedOn: 0 });
    assert.equal(asked(), 2);
    // The second status of a line is the network's, and a look that was given the kept answer has none.
    assert.deepEqual(
      stack.lines.filter((line) => line.route === 'pot_stats').map((line) => [line.status, line.upstream]),
      [[200, 200], ...Array.from({ length: 26 }, () => [200, null]), [200, 200], [200, null]],
    );

    // Only the Worker's clock moved, and it only goes forward.
    for (const backwards of [-1, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      assert.throws(() => stack.advanceClock(backwards), /the clock only goes forward/, String(backwards));
    }
    assert.deepEqual(await counts(), { passedOn: 1, waiting: 1, handedOn: 0 });
    assert.equal(asked(), 2);

    // With the bots stopped, the kept answer is still given while it is young. Once it has run out,
    // the page is told "unavailable": an old answer is not given again.
    stack.network!.setFaucet('down');
    assert.deepEqual(await counts(), { passedOn: 1, waiting: 1, handedOn: 0 });
    stack.advanceClock(POT_STATS_KEEP_MS);
    assert.deepEqual(await errorOf(await get(stack, '/api/pot/stats')), [502, 'unavailable']);
    assert.equal(stack.lines.at(-1)?.fault, 'origin_down');
    assert.equal(asked(), 3);

    // The bots are back at once. For 5 seconds after the question that failed, the Worker asks nobody: a
    // page is told "unavailable" without it. A scenario that needs the counts back says that the time has passed.
    stack.network!.setFaucet('ok');
    assert.deepEqual(await errorOf(await get(stack, '/api/pot/stats')), [502, 'unavailable']);
    assert.deepEqual([stack.lines.at(-1)?.upstream, stack.lines.at(-1)?.fault], [null, 'origin_down']);
    assert.equal(asked(), 3);
    stack.advanceClock(POT_STATS_PAUSE_MS);
    assert.deepEqual(await counts(), { passedOn: 1, waiting: 1, handedOn: 0 });
    assert.equal(asked(), 4);
  });

  // Another stack is another Worker: it has kept nothing, and asks for itself.
  await withStack(ON, async (other) => {
    assert.deepEqual(await (await get(other, '/api/pot/stats')).json(), none);
    assert.equal(other.network!.requests().filter((request) => request.path === '/bots/pot/stats').length, 1);
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
