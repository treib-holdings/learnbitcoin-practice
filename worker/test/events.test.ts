import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EVENTS, eventPaths, isEventBody } from '@learnbitcoin/practice-contract';
import type { EventBody, EventName } from '@learnbitcoin/practice-contract';
import type { FetchLike } from '../src/deps.ts';
import { EVENTS_URL, eventHeaders, eventPayload, makeForwardEvent } from '../src/events.ts';
import { APP, READER_IP, fakeFetch, noNetwork, reply, slowFetch } from './fakes.ts';

noNetwork();

const DOMAIN = 'practice.learnbitcoin.com';
const META = { ip: READER_IP, userAgent: 'Mozilla/5.0 (a browser)' };

function forward(fetch: FetchLike, props: boolean, domain = DOMAIN) {
  return makeForwardEvent({ domain, appUrl: APP, props, fetch });
}

function sentBody(fetch: { calls: Array<{ init: RequestInit }> }): unknown {
  return JSON.parse(fetch.calls.at(-1)?.init.body as string);
}

test('the request to the events service is written from scratch', async () => {
  assert.equal(EVENTS_URL, 'https://plausible.io/api/event');
  const fetch = fakeFetch(() => reply(202, 'ok'));
  const result = await forward(fetch, false)({ name: 'pageview', path: '/wallet/send' }, META);
  assert.deepEqual(result, { ok: true, upstream: 202, fault: null });

  assert.equal(fetch.calls.length, 1);
  const call = fetch.calls[0]!;
  assert.equal(call.url, EVENTS_URL);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'manual');
  assert.ok(call.init.signal instanceof AbortSignal);
  // These headers and no others: the reader's browser and address, which the
  // service needs to tell a visitor from a robot.
  assert.deepEqual(call.headers, {
    'cf-connecting-ip': READER_IP,
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (a browser)',
    'x-forwarded-for': READER_IP,
  });
  assert.deepEqual(sentBody(fetch), { name: 'pageview', url: `${APP}/wallet/send`, domain: DOMAIN });
});

test('with props off, the value joins the name and no props are sent', async () => {
  const fetch = fakeFetch(() => reply(202, 'ok'));
  const send = forward(fetch, false);
  await send({ name: 'Passkey', path: '/new', value: 'ok' }, META);
  assert.deepEqual(sentBody(fetch), { name: 'Passkey: ok', url: `${APP}/new`, domain: DOMAIN });
  await send({ name: 'Wallet created', path: '/es/new', value: 'passkey' }, META);
  assert.deepEqual(sentBody(fetch), { name: 'Wallet created: passkey', url: `${APP}/es/new`, domain: DOMAIN });
  await send({ name: 'Faucet', path: '/wallet/receive', value: 'already-paid' }, META);
  assert.deepEqual(sentBody(fetch), { name: 'Faucet: already-paid', url: `${APP}/wallet/receive`, domain: DOMAIN });
});

test('with props on, the value goes as the property the contract names', async () => {
  const fetch = fakeFetch(() => reply(202, 'ok'));
  const send = forward(fetch, true);
  await send({ name: 'Passkey', path: '/new', value: 'ok' }, META);
  assert.deepEqual(sentBody(fetch), { name: 'Passkey', url: `${APP}/new`, domain: DOMAIN, props: { result: 'ok' } });
  await send({ name: 'Wallet created', path: '/es/new', value: 'words' }, META);
  assert.deepEqual(sentBody(fetch), { name: 'Wallet created', url: `${APP}/es/new`, domain: DOMAIN, props: { method: 'words' } });
  await send({ name: 'Words shown', path: '/wallet/backup', value: 'passkey' }, META);
  assert.deepEqual(sentBody(fetch), { name: 'Words shown', url: `${APP}/wallet/backup`, domain: DOMAIN, props: { wallet: 'passkey' } });
  // A screen view has no value in either mode.
  await send({ name: 'pageview', path: '/' }, META);
  assert.deepEqual(sentBody(fetch), { name: 'pageview', url: `${APP}/`, domain: DOMAIN });
});

test('every event the contract allows gives a name from a closed list, in both modes', () => {
  const offNames = new Set<string>();
  let count = 0;
  for (const [name, spec] of Object.entries(EVENTS) as Array<[EventName, (typeof EVENTS)[EventName]]>) {
    const values: Array<string | undefined> = spec === null ? [undefined] : [...spec.values];
    for (const value of values) {
      for (const path of eventPaths()) {
        const event: EventBody = value === undefined ? { name, path } : { name, path, value };
        assert.ok(isEventBody(event));
        count += 1;
        const off = eventPayload(event, DOMAIN, APP, false);
        const on = eventPayload(event, DOMAIN, APP, true);
        for (const payload of [off, on]) {
          assert.equal(payload.domain, DOMAIN);
          assert.equal(payload.url, `${APP}${path}`);
          assert.match(payload.url, /^https:\/\/practice\.learnbitcoin\.com\/[a-z/-]*$/);
        }
        assert.equal(off.props, undefined);
        assert.equal(off.name, value === undefined ? name : `${name}: ${value}`);
        offNames.add(off.name);
        assert.equal(on.name, name);
        assert.deepEqual(on.props, spec === null ? undefined : { [spec.prop]: value });
        for (const key of Object.keys(off)) assert.ok(['name', 'url', 'domain'].includes(key));
        for (const key of Object.keys(on)) assert.ok(['name', 'url', 'domain', 'props'].includes(key));
      }
    }
  }
  assert.ok(count > 500);
  // One name per event and value: 1 screen view plus every listed value.
  const listed = Object.values(EVENTS).reduce((sum, spec) => sum + (spec === null ? 1 : spec.values.length), 0);
  assert.equal(offNames.size, listed);
  for (const name of offNames) assert.match(name, /^[A-Za-z ]+(: [a-z-]+)?$/);
});

test('the headers hold the reader address twice, and are left out when there is nothing to send', () => {
  assert.deepEqual(eventHeaders(META), {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (a browser)',
    'X-Forwarded-For': READER_IP,
    'CF-Connecting-IP': READER_IP,
  });
  assert.deepEqual(eventHeaders({ ip: null, userAgent: null }), { 'Content-Type': 'application/json' });
});

test('an event the service did not take is reported, for the log only', async () => {
  const dropped = fakeFetch(() => new Response('ok', { status: 202, headers: { 'x-plausible-dropped': '1' } }));
  assert.deepEqual(await forward(dropped, false)({ name: 'pageview', path: '/' }, META), {
    ok: false,
    upstream: 202,
    fault: 'events_down',
  });
  for (const status of [200, 301, 400, 402, 429, 500]) {
    const result = await forward(fakeFetch(() => reply(status, 'no')), false)({ name: 'pageview', path: '/' }, META);
    assert.deepEqual(result, { ok: false, upstream: status, fault: 'events_down' }, String(status));
  }
});

test('forwarding never throws', async () => {
  const thrown = fakeFetch(() => {
    throw new TypeError('fetch failed');
  });
  assert.deepEqual(await forward(thrown, false)({ name: 'pageview', path: '/' }, META), {
    ok: false,
    upstream: null,
    fault: 'events_down',
  });

  const original = AbortSignal.timeout;
  let asked = 0;
  AbortSignal.timeout = (ms: number) => {
    asked = ms;
    return original.call(AbortSignal, 10);
  };
  try {
    const slow = slowFetch(null, () => reply(202, 'ok'));
    assert.deepEqual(await forward(slow, true)({ name: 'Passkey', path: '/new', value: 'ok' }, META), {
      ok: false,
      upstream: null,
      fault: 'events_down',
    });
  } finally {
    AbortSignal.timeout = original;
  }
  assert.equal(asked, 5000, 'a short time limit: an event is never worth a long wait');
});

test('with no domain nothing is sent, and that is not a fault', async () => {
  const fetch = fakeFetch(() => reply(202, 'ok'));
  const result = await forward(fetch, false, '')({ name: 'pageview', path: '/' }, META);
  assert.deepEqual(result, { ok: false, upstream: null, fault: null });
  assert.equal(fetch.calls.length, 0);
});

test('spaces around the domain setting are not part of it, as GET /api/config reads it too', async () => {
  // config.ts trims this setting before it tells the app whether events are on. Sent on as it was
  // typed, a stray space would name a site the events service does not know.
  const fetch = fakeFetch(() => reply(202, 'ok'));
  await forward(fetch, false, ` ${DOMAIN} `)({ name: 'pageview', path: '/' }, META);
  assert.deepEqual(sentBody(fetch), { name: 'pageview', url: `${APP}/`, domain: DOMAIN });

  // Only spaces, or never set (which reaches the Worker as undefined, whatever its type says): no domain.
  for (const unset of ['   ', undefined as unknown as string]) {
    const none = fakeFetch(() => reply(202, 'ok'));
    const send = makeForwardEvent({ domain: unset, appUrl: APP, props: false, fetch: none });
    assert.deepEqual(await send({ name: 'pageview', path: '/' }, META), { ok: false, upstream: null, fault: null });
    assert.equal(none.calls.length, 0);
  }
});

test('a slash at the end of the app address does not double up', async () => {
  const fetch = fakeFetch(() => reply(202, 'ok'));
  await makeForwardEvent({ domain: DOMAIN, appUrl: `${APP}/`, props: false, fetch })({ name: 'pageview', path: '/es' }, META);
  assert.deepEqual(sentBody(fetch), { name: 'pageview', url: `${APP}/es`, domain: DOMAIN });
});
