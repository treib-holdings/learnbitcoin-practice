// faucet-flow.ts with a scripted faucet, a chain engine that shows what the
// test tells it to, and a clock driven by hand.
//
// What is proved here: the order of the phases, which token each try uses,
// how long each wait is and when the waiting ends, and that the coin is
// recognised when it turns up, also after a request that failed. The same
// flow runs against the Worker's real handler and the stand-in faucet in
// e2e/test/engine.test.ts.

import assert from 'node:assert/strict';
import { ERROR_STATUS, type ErrorCode, type FaucetPayment } from '@learnbitcoin/practice-contract';
import type { Coin } from '@learnbitcoin/practice-wallet';
import { ApiError } from '../src/lib/api.ts';
import type { ChainSnapshot } from '../src/lib/chain-sync.ts';
import { makeFaucetFlow } from '../src/lib/faucet-flow.ts';
import type { FaucetView, TokenSource } from '../src/lib/wallet-api.ts';
import { FakeClock, FakeTimers, coinsState, flush, recorder, test } from './engine-fakes.ts';

/** The address the Receive screen shows, and the one it moves to. */
const ME = 'bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk';
const NEXT = 'bcrt1qd7spv5q28348xl4myc8zmh983w5jx32cs707jh';
const TXID = '6c0443f5'.padEnd(64, 'a');
const PAYMENT: FaucetPayment = { txid: TXID, amountSats: 100_000, potTxid: null };

function coin(txid: string, address: string, confirmed: boolean): Coin {
  return {
    txid,
    vout: 0,
    value: 100_000n,
    status: confirmed ? { confirmed: true, block_height: 101 } : { confirmed: false },
    chain: 0,
    index: 0,
    address,
    script: new Uint8Array(),
  };
}

/** The part of the chain engine the faucet flow uses, showing whatever the test says. */
class ChainStub {
  snapshot: ChainSnapshot = {
    wallet: 1,
    chain: { state: coinsState(), scanning: false, error: null, checkedAt: null, retryAt: null, tip: 100, slow: false },
    history: null,
    historyError: null,
    receive: { address: ME, index: 0, arrived: 0n },
    notice: null,
  };
  readonly remembered: string[] = [];
  /** Every holdReceive() call, in order. */
  readonly holds: boolean[] = [];
  private readonly listeners = new Set<() => void>();

  view = (): ChainSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  rememberTx = (txid: string): void => {
    this.remembered.push(txid);
  };
  holdReceive = (hold: boolean): void => {
    this.holds.push(hold);
  };

  private tell(): void {
    for (const listener of this.listeners) listener();
  }
  /** The wallet now holds exactly these coins. */
  coins(...coins: Coin[]): void {
    this.snapshot = { ...this.snapshot, chain: { ...this.snapshot.chain, state: coinsState(coins) } };
    this.tell();
  }
  /** The Receive screen now shows this address. */
  shows(address: string): void {
    this.snapshot = { ...this.snapshot, receive: { address, index: 1, arrived: 0n } };
    this.tell();
  }
  /** Another wallet is in the page now. */
  replaced(): void {
    this.snapshot = { ...this.snapshot, wallet: this.snapshot.wallet + 1, receive: null, chain: { ...this.snapshot.chain, state: null } };
    this.tell();
  }
}

/** What the faucet does with one request: pays, refuses with a code, or gives no answer. */
type Step = FaucetPayment | ErrorCode | 'network';

function setup(script: Step[] = [], always?: Step) {
  const clock = new FakeClock();
  const timers = new FakeTimers(clock);
  const chain = new ChainStub();
  const counted = recorder();
  /** Every request that reached the faucet: the address and the token. */
  const requests: [string, string][] = [];
  const flow = makeFaucetFlow({
    api: {
      askFaucet: async (address, token) => {
        requests.push([address, token]);
        const step = script.shift() ?? always ?? PAYMENT;
        if (step === 'network') throw new ApiError(0, 'network');
        if (typeof step === 'string') throw new ApiError(ERROR_STATUS[step], step);
        return step;
      },
    },
    chain,
    now: clock.now,
    timers,
    track: counted.track,
  });
  const phases: string[] = [];
  flow.subscribe(() => phases.push(flow.view().phase));
  return { flow, chain, clock, timers, requests, phases, events: counted.events, unlisted: counted.unlisted, advance: (ms: number) => timers.advance(ms) };
}

/** A bot check that hands out token-1, token-2 and so on, and notes whether a fresh one was asked for. */
function tokens(limit = Infinity) {
  const asked: boolean[] = [];
  const source: TokenSource = async (fresh) => {
    asked.push(fresh);
    return asked.length > limit ? null : `token-${asked.length}`;
  };
  return { source, asked };
}

const IDLE: FaucetView = { phase: 'idle', payment: null, failure: null, retryAt: null };

// -- the way it is meant to go ---------------------------------------------------

test('from the tap to the confirmed coin: checking, asking, on its way, arrived, confirmed', async () => {
  const t = setup();
  const check = tokens();
  assert.deepEqual(t.flow.view(), IDLE);

  const asking = t.flow.ask(check.source);
  // At once: the bot check runs, and the address on screen is frozen.
  assert.deepEqual(t.flow.view(), { phase: 'checking', payment: null, failure: null, retryAt: null });
  assert.deepEqual(t.chain.holds, [true]);
  await asking;

  assert.deepEqual(t.phases, ['checking', 'asking', 'on-its-way']);
  assert.deepEqual(check.asked, [false], 'the first token is not asked for as a fresh one');
  assert.deepEqual(t.requests, [[ME, 'token-1']]);
  assert.deepEqual(t.flow.view(), { phase: 'on-its-way', payment: PAYMENT, failure: null, retryAt: null });
  // The promised ID is remembered, so the transaction screen says "waiting" until Esplora lists it.
  assert.deepEqual(t.chain.remembered, [TXID]);
  assert.deepEqual(t.chain.holds, [true, false], 'the address may move again');
  assert.deepEqual(t.events, ['Faucet: ok']);
  assert.equal(t.timers.size, 0);

  // Some other coin at the address is not the promised one.
  t.chain.coins(coin('b'.repeat(64), ME, false));
  assert.equal(t.flow.view().phase, 'on-its-way');
  // The promised coin, at another address of the wallet, is not it either.
  t.chain.coins(coin(TXID, NEXT, false));
  assert.equal(t.flow.view().phase, 'on-its-way');

  t.chain.coins(coin(TXID, ME, false));
  assert.deepEqual(t.flow.view(), { phase: 'arrived', payment: PAYMENT, failure: null, retryAt: null });
  t.chain.coins(coin(TXID, ME, true));
  assert.deepEqual(t.flow.view(), { phase: 'confirmed', payment: PAYMENT, failure: null, retryAt: null });
  assert.deepEqual(t.phases, ['checking', 'asking', 'on-its-way', 'arrived', 'confirmed']);

  // Spent later: confirmed stays confirmed.
  t.chain.coins();
  assert.equal(t.flow.view().phase, 'confirmed');
  assert.deepEqual(t.events, ['Faucet: ok'], 'one request, one event');
  assert.deepEqual(t.unlisted, []);
});

test('a coin first seen when it is already in a block goes straight to confirmed', async () => {
  const t = setup();
  await t.flow.ask(tokens().source);
  t.chain.coins(coin(TXID, ME, true));
  assert.deepEqual(t.phases, ['checking', 'asking', 'on-its-way', 'confirmed']);
});

test('no token from the bot check: failed, and the faucet is never asked', async () => {
  const sources: [string, TokenSource][] = [
    ['null', async () => null],
    ['an empty token', async () => ''],
    ['not a token', (async () => 42) as unknown as TokenSource],
    ['rejects', () => Promise.reject(new Error('the widget failed to load'))],
    ['throws', () => { throw new Error('no widget'); }],
  ];
  for (const [name, source] of sources) {
    const t = setup();
    await t.flow.ask(source);
    assert.deepEqual(t.flow.view(), { phase: 'failed', payment: null, failure: 'no-token', retryAt: null }, name);
    assert.deepEqual(t.phases, ['checking', 'failed'], name);
    assert.deepEqual(t.requests, [], name);
    assert.deepEqual(t.chain.holds, [true, false], name);
    assert.deepEqual(t.events, ['Faucet: failed'], name);
    assert.equal(t.timers.size, 0, name);
  }
});

// -- refused for now ---------------------------------------------------------------

test('"limit": it waits 30 s and asks again with the same token', async () => {
  const t = setup(['limit']);
  const check = tokens();
  let done = false;
  const asking = t.flow.ask(check.source).then(() => {
    done = true;
  });
  await flush();
  assert.deepEqual(t.flow.view(), { phase: 'waiting', payment: null, failure: 'limit', retryAt: t.clock.ms + 30_000 });
  assert.deepEqual(t.timers.dueIn(), [30_000]);
  assert.deepEqual(t.chain.holds, [true], 'the address stays frozen while it waits');
  assert.equal(done, false, 'the request is still running');

  await t.advance(29_999);
  assert.equal(t.requests.length, 1);
  await t.advance(1);
  await asking;
  assert.deepEqual(t.phases, ['checking', 'asking', 'waiting', 'asking', 'on-its-way']);
  assert.deepEqual(t.requests, [[ME, 'token-1'], [ME, 'token-1']]);
  assert.deepEqual(check.asked, [false], 'the Worker refused before it looked at the token');
  assert.deepEqual(t.flow.view(), { phase: 'on-its-way', payment: PAYMENT, failure: null, retryAt: null });
  assert.deepEqual(t.events, ['Faucet: ok'], 'once for the request, not once for each try');
});

test('"busy" and "refilling": it waits and asks again with a fresh token', async () => {
  for (const [reason, wait] of [['busy', 20_000], ['refilling', 30_000]] as const) {
    const t = setup([reason]);
    const check = tokens();
    const asking = t.flow.ask(check.source);
    await flush();
    assert.deepEqual(t.flow.view(), { phase: 'waiting', payment: null, failure: reason, retryAt: t.clock.ms + wait }, reason);
    await t.advance(wait);
    await asking;
    assert.deepEqual(t.phases, ['checking', 'asking', 'waiting', 'checking', 'asking', 'on-its-way'], reason);
    assert.deepEqual(check.asked, [false, true], 'the faucet refused after the bot check had used the token up');
    assert.deepEqual(t.requests, [[ME, 'token-1'], [ME, 'token-2']], reason);
    assert.deepEqual(t.events, ['Faucet: ok'], reason);
  }
});

test('three minutes of waiting and asking again, and then it gives up', async () => {
  for (const [reason, tries] of [['busy', 10], ['limit', 7], ['refilling', 7]] as const) {
    const t = setup([], reason);
    const started = t.clock.ms;
    let done = false;
    const asking = t.flow.ask(tokens().source).then(() => {
      done = true;
    });
    await t.advance(179_999);
    assert.equal(done, false, reason);
    assert.equal(t.flow.view().phase, 'waiting', reason);
    assert.equal(t.flow.view().retryAt, started + 180_000, 'the wait on screen never points past the three minutes');
    await t.advance(1);
    await asking;
    assert.deepEqual(t.flow.view(), { phase: 'failed', payment: null, failure: 'gave-up', retryAt: null }, reason);
    assert.equal(t.requests.length, tries, reason);
    assert.deepEqual(t.events, ['Faucet: gave-up'], reason);
    assert.deepEqual(t.chain.holds, [true, false], reason);
    assert.equal(t.timers.size, 0, reason);
    // And that is the end of it.
    await t.advance(600_000);
    assert.equal(t.requests.length, tries, reason);
  }
});

test('the waits can follow one another, and success ends them', async () => {
  const t = setup(['busy', 'limit', 'refilling']);
  const check = tokens();
  const asking = t.flow.ask(check.source);
  await t.advance(20_000 + 30_000 + 30_000);
  await asking;
  assert.equal(t.flow.view().phase, 'on-its-way');
  assert.deepEqual(t.requests.map(([, token]) => token), ['token-1', 'token-2', 'token-2', 'token-3']);
  assert.deepEqual(check.asked, [false, true, true]);
  assert.deepEqual(t.events, ['Faucet: ok']);
});

test('no fresh token when one is needed after a wait: failed with "no-token"', async () => {
  const t = setup(['busy']);
  const asking = t.flow.ask(tokens(1).source);
  await t.advance(20_000);
  await asking;
  assert.deepEqual(t.flow.view(), { phase: 'failed', payment: null, failure: 'no-token', retryAt: null });
  assert.equal(t.requests.length, 1);
  assert.deepEqual(t.events, ['Faucet: failed']);
});

test('the three minutes run out while the bot check is at work on a fresh token: that is giving up, not "no token"', async () => {
  // The faucet is busy every time, and every bot check takes two and a half seconds. The last wait
  // ends exactly as the three minutes do, so the check that follows it has no time left at all.
  const t = setup([], 'busy');
  const asked: boolean[] = [];
  const slow: TokenSource = (fresh) =>
    new Promise((resolve) => {
      asked.push(fresh);
      t.timers.set(() => resolve(`token-${asked.length}`), 2_500);
    });
  const started = t.clock.ms;
  const asking = t.flow.ask(slow);
  await t.advance(179_999);
  assert.deepEqual([t.flow.view().phase, t.flow.view().retryAt], ['waiting', started + 180_000]);
  await t.advance(1);
  await asking;
  assert.deepEqual(t.flow.view(), { phase: 'failed', payment: null, failure: 'gave-up', retryAt: null });
  assert.deepEqual(t.events, ['Faucet: gave-up']);
  assert.equal(t.requests.length, 8);
  assert.equal(asked.length, 9, 'the ninth check was begun, and its token came too late to count');
  assert.deepEqual(t.chain.holds, [true, false]);

  // The same after a token the Worker did not accept: the one fresh check runs out of time.
  const b = setup(['bot_check']);
  const pending = b.flow.ask(async (fresh) => (fresh ? new Promise<string>(() => {}) : 'token-1'));
  await b.advance(180_000);
  await pending;
  assert.deepEqual(b.flow.view(), { phase: 'failed', payment: null, failure: 'gave-up', retryAt: null });
  assert.deepEqual(b.events, ['Faucet: gave-up']);

  // A bot check that answers in time, and has no fresh token to give, is still "no-token".
  const n = setup(['busy']);
  const none = n.flow.ask(tokens(1).source);
  await n.advance(20_000);
  await none;
  assert.deepEqual([n.flow.view().failure, n.events], ['no-token', ['Faucet: failed']]);
});

// -- refused for good, or not really refused -------------------------------------------

test('"already_paid": the coin is on its way or already here, so it is a success without a payment record', async () => {
  // Nothing at the address yet: on its way.
  const t = setup(['already_paid']);
  await t.flow.ask(tokens().source);
  assert.deepEqual(t.flow.view(), { phase: 'on-its-way', payment: null, failure: null, retryAt: null });
  assert.deepEqual(t.events, ['Faucet: already-paid']);
  assert.deepEqual(t.chain.remembered, [], 'there is no ID to remember');
  // Any coin at that address is the one the faucet sent.
  t.chain.coins(coin('c'.repeat(64), ME, false));
  assert.deepEqual(t.flow.view(), { phase: 'arrived', payment: null, failure: null, retryAt: null });
  t.chain.coins(coin('c'.repeat(64), ME, true));
  assert.deepEqual(t.flow.view(), { phase: 'confirmed', payment: null, failure: null, retryAt: null });

  // Already in the wallet when the faucet says so: arrived, or confirmed, at once.
  for (const [confirmed, phase] of [[false, 'arrived'], [true, 'confirmed']] as const) {
    const here = setup(['already_paid']);
    here.chain.coins(coin('c'.repeat(64), ME, confirmed));
    await here.flow.ask(tokens().source);
    assert.deepEqual(here.flow.view(), { phase, payment: null, failure: null, retryAt: null });
    assert.deepEqual(here.phases, ['checking', 'asking', 'on-its-way', phase]);
  }
});

test('"bot_check": one fresh token and one more try, then failed', async () => {
  // The second token passes.
  const t = setup(['bot_check']);
  const check = tokens();
  await t.flow.ask(check.source);
  assert.deepEqual(t.phases, ['checking', 'asking', 'checking', 'asking', 'on-its-way']);
  assert.deepEqual(check.asked, [false, true]);
  assert.deepEqual(t.requests, [[ME, 'token-1'], [ME, 'token-2']]);
  assert.deepEqual(t.events, ['Faucet: ok']);
  assert.equal(t.timers.size, 0, 'no waiting between the two');

  // It does not.
  const twice = setup(['bot_check', 'bot_check']);
  await twice.flow.ask(tokens().source);
  assert.deepEqual(twice.flow.view(), { phase: 'failed', payment: null, failure: 'bot_check', retryAt: null });
  assert.equal(twice.requests.length, 2);
  assert.deepEqual(twice.events, ['Faucet: bot-check']);

  // One more try in all, also when a wait came in between.
  const spread = setup(['bot_check', 'busy', 'bot_check']);
  const asking = spread.flow.ask(tokens().source);
  await spread.advance(20_000);
  await asking;
  assert.equal(spread.flow.view().failure, 'bot_check');
  assert.equal(spread.requests.length, 3);

  // No fresh token to be had.
  const none = setup(['bot_check']);
  await none.flow.ask(tokens(1).source);
  assert.deepEqual(none.flow.view(), { phase: 'failed', payment: null, failure: 'no-token', retryAt: null });
  assert.deepEqual(none.events, ['Faucet: failed']);
});

test('any other failure: failed with its reason, after one request', async () => {
  for (const reason of ['closed', 'bad_address', 'own_address', 'failed', 'unavailable', 'forbidden', 'bad_request', 'network'] as const) {
    const t = setup([reason]);
    await t.flow.ask(tokens().source);
    assert.deepEqual(t.flow.view(), { phase: 'failed', payment: null, failure: reason, retryAt: null }, reason);
    assert.equal(t.requests.length, 1, reason);
    assert.deepEqual(t.events, ['Faucet: failed'], reason);
    assert.deepEqual(t.chain.holds, [true, false], reason);
    assert.equal(t.timers.size, 0, reason);
  }
});

test('after a failed request, a coin arriving at the address turns the failure into success', async () => {
  // The faucet said it failed. A moment later its payment shows up all the same.
  const t = setup(['failed']);
  const old = coin('d'.repeat(64), ME, true);
  t.chain.coins(old);
  await t.flow.ask(tokens().source);
  assert.equal(t.flow.view().phase, 'failed');

  // The coin that was there before the request is not news.
  t.chain.coins(old);
  assert.deepEqual(t.flow.view(), { phase: 'failed', payment: null, failure: 'failed', retryAt: null });
  // A coin somewhere else in the wallet is not it.
  t.chain.coins(old, coin('e'.repeat(64), NEXT, false));
  assert.equal(t.flow.view().phase, 'failed');

  t.chain.coins(old, coin('e'.repeat(64), ME, false));
  assert.deepEqual(t.flow.view(), { phase: 'arrived', payment: null, failure: null, retryAt: null });
  t.chain.coins(old, coin('e'.repeat(64), ME, true));
  assert.deepEqual(t.flow.view(), { phase: 'confirmed', payment: null, failure: null, retryAt: null });
  assert.deepEqual(t.events, ['Faucet: failed'], 'the request itself did fail');

  // The same after "gave-up" and after "no-token".
  const gaveUp = setup([], 'busy');
  const asking = gaveUp.flow.ask(tokens().source);
  await gaveUp.advance(180_000);
  await asking;
  gaveUp.chain.coins(coin('e'.repeat(64), ME, true));
  assert.equal(gaveUp.flow.view().phase, 'confirmed');
});

// -- one at a time --------------------------------------------------------------------

test('a second ask while one runs starts nothing new', async () => {
  const t = setup(['busy']);
  const first = tokens();
  const second = tokens();
  const running = t.flow.ask(first.source);
  const again = t.flow.ask(second.source);
  assert.equal(again, running, 'the very same request');
  await flush();
  // Also while it waits.
  assert.equal(t.flow.view().phase, 'waiting');
  assert.equal(t.flow.ask(second.source), running);
  await t.advance(20_000);
  await running;
  assert.deepEqual(second.asked, [], 'the second bot check never ran');
  assert.equal(t.requests.length, 2);
  assert.deepEqual(t.chain.holds, [true, false]);
  assert.deepEqual(t.events, ['Faucet: ok']);

  // Once it has ended, asking again is a new request.
  await t.flow.ask(second.source);
  assert.deepEqual(second.asked, [false]);
  assert.equal(t.requests.length, 3);
  assert.deepEqual(t.events, ['Faucet: ok', 'Faucet: ok']);
});

test('with no address to pay yet, asking does nothing', async () => {
  const t = setup();
  t.chain.snapshot = { ...t.chain.snapshot, receive: null };
  const check = tokens();
  await t.flow.ask(check.source);
  assert.deepEqual(t.flow.view(), IDLE);
  assert.deepEqual([check.asked, t.requests, t.chain.holds, t.events], [[], [], [], []]);
});

// -- the wallet moves on ----------------------------------------------------------------

test('a new receive address is a fresh start; a new wallet ends a request that was running', async () => {
  // Promised, then the reader asks for a new address: the faucet view is about that address now.
  const t = setup();
  await t.flow.ask(tokens().source);
  assert.equal(t.flow.view().phase, 'on-its-way');
  t.chain.shows(NEXT);
  assert.deepEqual(t.flow.view(), IDLE);
  // The old coin arriving later changes nothing here. (The wallet announces it by itself.)
  t.chain.coins(coin(TXID, ME, false));
  assert.deepEqual(t.flow.view(), IDLE);
  // And the new address can be asked for.
  await t.flow.ask(tokens().source);
  assert.deepEqual(t.requests.map(([address]) => address), [ME, NEXT]);

  // The wallet is replaced while the request waits: the wait ends, nothing more is asked or shown.
  const w = setup([], 'busy');
  let done = false;
  const asking = w.flow.ask(tokens().source).then(() => {
    done = true;
  });
  await flush();
  assert.equal(w.flow.view().phase, 'waiting');
  w.chain.replaced();
  assert.deepEqual(w.flow.view(), IDLE);
  await asking;
  assert.equal(done, true);
  assert.equal(w.timers.size, 0);
  await w.advance(600_000);
  assert.equal(w.requests.length, 1);
  assert.deepEqual(w.flow.view(), IDLE);
  assert.deepEqual(w.events, [], 'a request nobody waits for any more is not counted');
  assert.deepEqual(w.chain.holds, [true], 'the chain engine let go of the address itself when the wallet changed');

  // The wallet is replaced while the bot check is still running: its token, when it comes, is not used.
  const c = setup();
  let give!: (token: string) => void;
  const slow: TokenSource = () => new Promise((resolve) => (give = resolve));
  const pending = c.flow.ask(slow);
  c.chain.replaced();
  assert.deepEqual(c.flow.view(), IDLE);
  give('token-late');
  await pending;
  assert.deepEqual(c.requests, []);
  assert.deepEqual(c.flow.view(), IDLE);
});

// -- faults in what the flow is handed --------------------------------------------------

test('a bot check that never answers does not hold the request for ever', async () => {
  const t = setup();
  let done = false;
  const asking = t.flow.ask(() => new Promise(() => {})).then(() => {
    done = true;
  });
  await t.advance(179_999);
  assert.deepEqual([done, t.flow.view().phase], [false, 'checking']);
  await t.advance(1);
  await asking;
  assert.deepEqual(t.flow.view(), { phase: 'failed', payment: null, failure: 'no-token', retryAt: null });
  assert.deepEqual(t.chain.holds, [true, false]);
  // A new request can be made.
  await t.flow.ask(tokens().source);
  assert.equal(t.flow.view().phase, 'on-its-way');
});

test('whatever the faucet client, the timers, the clock and the chain engine do, asking ends and never throws', async () => {
  const boom = (): never => {
    throw new Error('not today');
  };

  // A client that throws before it returns, one that answers nonsense, and one that rejects with something odd.
  for (const askFaucet of [boom, async () => null, async () => ({ txid: 5 }), () => Promise.reject('a string')]) {
    const clock = new FakeClock();
    const chain = new ChainStub();
    const flow = makeFaucetFlow({ api: { askFaucet: askFaucet as never }, chain, now: clock.now, timers: new FakeTimers(clock), track: recorder().track });
    await flow.ask(tokens().source);
    assert.deepEqual(flow.view(), { phase: 'failed', payment: null, failure: 'unavailable', retryAt: null });
  }

  // Timers that cannot be set, a clock that throws, an event sender that throws, a chain engine that throws
  // on everything but its snapshot: the request still runs. With no timer to wait on, it asks again at
  // once, and stops after a dozen tries instead of spinning for ever.
  const chain = new ChainStub();
  let asked = 0;
  const flow = makeFaucetFlow({
    api: {
      askFaucet: async () => {
        asked += 1;
        throw new ApiError(429, 'busy');
      },
    },
    chain: { view: chain.view, subscribe: boom, rememberTx: boom, holdReceive: boom },
    now: boom,
    timers: { set: boom, clear: boom },
    track: boom,
  });
  await flow.ask(tokens().source);
  assert.deepEqual(flow.view(), { phase: 'failed', payment: null, failure: 'gave-up', retryAt: null });
  assert.equal(asked, 12);

  // The same surroundings, and a faucet that pays.
  const paying = makeFaucetFlow({
    api: { askFaucet: async () => PAYMENT },
    chain: { view: chain.view, subscribe: boom, rememberTx: boom, holdReceive: boom },
    now: () => Number.NaN,
    timers: { set: boom, clear: boom },
    track: boom,
  });
  await paying.ask(tokens().source);
  assert.deepEqual(paying.view(), { phase: 'on-its-way', payment: PAYMENT, failure: null, retryAt: null });

  // A chain engine that cannot even be read: nothing to ask for.
  const blind = makeFaucetFlow({
    api: { askFaucet: async () => PAYMENT },
    chain: { view: boom, subscribe: boom, rememberTx: boom, holdReceive: boom },
    now: boom,
    timers: { set: boom, clear: boom },
    track: boom,
  });
  await blind.ask(tokens().source);
  assert.deepEqual(blind.view(), IDLE);
});
