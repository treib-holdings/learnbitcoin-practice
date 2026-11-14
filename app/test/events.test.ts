// What the app counts: every event is one the contract lists, filed under the
// screen it happened on, and nothing is sent while events are off.
//
// events.ts remembers the current screen between calls, and the tests in this
// file share that memory. The first test needs it empty, so it stays first.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  API,
  EVENTS,
  LANGS,
  SCREENS,
  eventPath as contractEventPath,
  isEventBody,
  type CountedEvent,
  type ScreenName,
  type ValueOf,
} from '@learnbitcoin/practice-contract';
import { initEvents, track, trackPage } from '../src/lib/events.ts';
import type { Route } from '../src/lib/router.ts';

const TXID = '6c0443f5'.padEnd(64, 'a');

function routeOf(name: ScreenName): Route {
  return name === 'tx' ? { name, txid: TXID } : ({ name } as Route);
}

/** Turns events on with a recorder in place of the Worker. Strict: a bad event fails the test. */
function recording(options: { on?: boolean; strict?: boolean } = {}): string[] {
  const sent: string[] = [];
  initEvents(options.on ?? true, (body) => sent.push(body), { strict: options.strict ?? true });
  return sent;
}

/** Calls track with a value the types would refuse, as a bug elsewhere in the app could. */
function trackAnything(name: string, value: string): void {
  (track as (name: string, value: string) => void)(name, value);
}

test('an event before any screen is a bug: thrown under strict, dropped otherwise', () => {
  const strict = recording();
  assert.throws(() => track('Wallet created', 'passkey'), /not an event the contract lists/);
  assert.deepEqual(strict, []);

  const lenient = recording({ strict: false });
  assert.doesNotThrow(() => track('Wallet created', 'passkey'));
  assert.deepEqual(lenient, []);
});

test('a screen view is the contract path for the screen, in both languages', () => {
  for (const lang of LANGS) {
    for (const name of SCREENS) {
      const sent = recording();
      trackPage(routeOf(name), lang);
      assert.equal(sent.length, 1);
      const body: unknown = JSON.parse(sent[0] ?? '');
      assert.deepEqual(body, { name: 'pageview', path: contractEventPath(name, lang) });
      assert.ok(isEventBody(body));
    }
  }
});

test('a transaction screen is counted without its ID', () => {
  const sent = recording();
  trackPage({ name: 'tx', txid: TXID }, 'en');
  trackPage({ name: 'tx', txid: TXID }, 'es');
  track('Payment', 'sent');
  assert.deepEqual(sent.map((body) => JSON.parse(body) as unknown), [
    { name: 'pageview', path: '/wallet/tx' },
    { name: 'pageview', path: '/es/wallet/tx' },
    { name: 'Payment', path: '/es/wallet/tx', value: 'sent' },
  ]);
  for (const body of sent) {
    assert.ok(!body.includes(TXID));
    assert.doesNotMatch(body, /[0-9a-f]{16}/);
  }
});

test('an event is filed under the screen the reader is on', () => {
  const sent = recording();
  trackPage({ name: 'new' }, 'en');
  track('Passkey', 'ok');
  track('Wallet created', 'passkey');
  trackPage({ name: 'backup' }, 'en');
  track('Words shown', 'passkey');
  trackPage({ name: 'receive' }, 'es');
  track('Faucet', 'already-paid');
  assert.deepEqual(sent.map((body) => JSON.parse(body) as unknown), [
    { name: 'pageview', path: '/new' },
    { name: 'Passkey', path: '/new', value: 'ok' },
    { name: 'Wallet created', path: '/new', value: 'passkey' },
    { name: 'pageview', path: '/wallet/backup' },
    { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
    { name: 'pageview', path: '/es/wallet/receive' },
    { name: 'Faucet', path: '/es/wallet/receive', value: 'already-paid' },
  ]);
});

test('every event and value of the contract is sent as a body the Worker accepts', () => {
  const sent = recording();
  trackPage({ name: 'wallet' }, 'en');
  let expected = 1;
  for (const name of Object.keys(EVENTS) as (keyof typeof EVENTS)[]) {
    const spec = EVENTS[name];
    if (spec === null) continue;
    for (const value of spec.values) {
      trackAnything(name, value);
      expected += 1;
      const body: unknown = JSON.parse(sent.at(-1) ?? '');
      assert.deepEqual(body, { name, path: '/wallet', value });
      assert.ok(isEventBody(body), `${name}: ${value}`);
    }
  }
  assert.equal(sent.length, expected);
  // The body is exactly name, path and value, and JSON text: nothing else rides along.
  for (const body of sent) {
    assert.equal(typeof body, 'string');
    const keys = Object.keys(JSON.parse(body) as object);
    assert.ok(keys.length <= 3 && keys.every((key) => ['name', 'path', 'value'].includes(key)), body);
  }
});

test('the types allow only the contract values', () => {
  // The three calls marked below do not compile without their marks: the type
  // check ("pnpm check") fails if one of them ever becomes allowed. At run
  // time, with strict off, each is dropped.
  const sent = recording({ strict: false });
  trackPage({ name: 'wallet' }, 'en');
  const name: CountedEvent = 'Restore';
  const value: ValueOf<'Restore'> = 'found';
  track(name, value);
  // @ts-expect-error "sent" is a value of Payment, not of Restore
  track('Restore', 'sent');
  // @ts-expect-error a screen view is not sent through track
  track('pageview', 'x');
  // @ts-expect-error not an event at all
  track('Made up', 'ok');
  assert.deepEqual(sent.map((body) => JSON.parse(body) as unknown), [
    { name: 'pageview', path: '/wallet' },
    { name: 'Restore', path: '/wallet', value: 'found' },
  ]);
});

test('with events off, nothing is sent', () => {
  const sent = recording({ on: false });
  trackPage({ name: 'home' }, 'en');
  trackPage({ name: 'send' }, 'es');
  track('Payment', 'sent');
  track('Wallet removed', 'words');
  assert.deepEqual(sent, []);

  // The screen is still remembered, so events are right from the moment they are turned on.
  const later = recording();
  track('Payment', 'refused');
  assert.deepEqual(later.map((body) => JSON.parse(body) as unknown), [
    { name: 'Payment', path: '/es/wallet/send', value: 'refused' },
  ]);
});

test('an event the contract does not list is thrown under strict, on or off', () => {
  for (const on of [true, false]) {
    const sent = recording({ on });
    trackPage({ name: 'wallet' }, 'en');
    const before = sent.length;
    assert.throws(() => trackAnything('Payment', 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6'), /not an event/);
    assert.throws(() => trackAnything('Payment', 'ok'), /not an event/);
    assert.throws(() => trackAnything('Made up', 'ok'), /not an event/);
    assert.throws(() => trackAnything('pageview', 'x'), /not an event/);
    assert.throws(() => trackAnything('toString', 'x'), /not an event/);
    assert.equal(sent.length, before);
  }
});

test('an event the contract does not list is dropped in silence otherwise', () => {
  const sent = recording({ strict: false });
  trackPage({ name: 'wallet' }, 'en');
  assert.doesNotThrow(() => trackAnything('Payment', 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6'));
  assert.doesNotThrow(() => trackAnything('Made up', 'ok'));
  assert.doesNotThrow(() => trackAnything('pageview', 'x'));
  track('Payment', 'sent');
  assert.deepEqual(sent.map((body) => JSON.parse(body) as unknown), [
    { name: 'pageview', path: '/wallet' },
    { name: 'Payment', path: '/wallet', value: 'sent' },
  ]);
});

test('strict is off unless asked for', () => {
  const sent: string[] = [];
  initEvents(true, (body) => sent.push(body));
  trackPage({ name: 'wallet' }, 'en');
  assert.doesNotThrow(() => trackAnything('Made up', 'ok'));
  assert.equal(sent.length, 1);
});

test('by default an event goes to the Worker with fetch and keepalive', async (t) => {
  const calls: { input: unknown; init: RequestInit | undefined }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(null, { status: 202 });
  });
  initEvents(true);
  trackPage({ name: 'about' }, 'es');
  track('Restore', 'found');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.input, API.event);
    assert.equal(call.init?.method, 'POST');
    assert.equal(call.init?.keepalive, true);
    assert.equal(new Headers(call.init?.headers).get('content-type'), 'application/json');
    assert.ok(isEventBody(JSON.parse(String(call.init?.body))));
  }
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { name: 'pageview', path: '/es/about' });
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), { name: 'Restore', path: '/es/about', value: 'found' });

  // With events off the Worker is not called at all.
  initEvents(false);
  trackPage({ name: 'about' }, 'en');
  track('Restore', 'kept');
  assert.equal(calls.length, 2);
});

test('a failed send is ignored', async (t) => {
  let asked = 0;
  const failures: unknown[] = [];
  const noteFailure = (reason: unknown): void => {
    failures.push(reason);
  };
  process.on('unhandledRejection', noteFailure);
  t.after(() => process.off('unhandledRejection', noteFailure));

  // No answer.
  t.mock.method(globalThis, 'fetch', () => {
    asked += 1;
    return Promise.reject(new TypeError('fetch failed'));
  });
  initEvents(true);
  assert.doesNotThrow(() => trackPage({ name: 'home' }, 'en'));
  assert.doesNotThrow(() => track('Faucet', 'ok'));

  // A refusal: the answer is not read, so it changes nothing.
  t.mock.method(globalThis, 'fetch', async () => {
    asked += 1;
    return new Response('{"error":"limit"}', { status: 429 });
  });
  assert.doesNotThrow(() => track('Faucet', 'failed'));

  // A fetch that throws at once.
  t.mock.method(globalThis, 'fetch', () => {
    asked += 1;
    throw new Error('no fetch here');
  });
  assert.doesNotThrow(() => track('Faucet', 'gave-up'));

  // Give the rejected promises time to be noticed, were they left unhandled.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(asked, 4);
  assert.deepEqual(failures, []);
});
