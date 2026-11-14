// The app's settings: the values it carries, and how the Worker's answer is
// laid over them.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API, type AppConfig } from '@learnbitcoin/practice-contract';
import { DEFAULT_CONFIG, loadConfig } from '../src/lib/config.ts';

/** A fetch that answers every request with `body` as JSON, and notes what was asked. */
function answering(body: unknown, status = 200) {
  const calls: { input: string; init: RequestInit | undefined }[] = [];
  const fetchFn = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetchFn, calls };
}

/** A whole answer in which every value differs from the built-in one. */
const OTHER: AppConfig = {
  turnstileSiteKey: '1x00000000000000000000AA',
  explorerUrl: 'http://127.0.0.1:8787/explorer',
  electrumHost: 'localhost',
  electrumPort: 60002,
  siteUrl: 'http://127.0.0.1:4321',
  sourceUrl: 'https://example.com/source',
  passkeyHost: 'localhost',
  faucetSats: 50000,
  blockSeconds: 10,
  events: true,
};

test('the built-in values are production', () => {
  assert.deepEqual(DEFAULT_CONFIG, {
    turnstileSiteKey: '',
    explorerUrl: 'https://practice-explorer.learnbitcoin.com',
    electrumHost: 'practice-electrum.learnbitcoin.com',
    electrumPort: 50002,
    siteUrl: 'https://www.learnbitcoin.com',
    sourceUrl: 'https://github.com/treib-holdings/learnbitcoin-practice',
    passkeyHost: 'practice.learnbitcoin.com',
    faucetSats: 100000,
    blockSeconds: 30,
    events: false,
  });
  // Until the Worker says otherwise: no bot check (so no faucet) and nothing counted.
  assert.equal(DEFAULT_CONFIG.turnstileSiteKey, '');
  assert.equal(DEFAULT_CONFIG.events, false);
  // No URL ends in a slash: the app adds its own paths.
  for (const url of [DEFAULT_CONFIG.explorerUrl, DEFAULT_CONFIG.siteUrl, DEFAULT_CONFIG.sourceUrl]) {
    assert.match(url, /^https:\/\/[^/]+(\/[^/]+)*$/);
  }
  assert.ok(Object.isFrozen(DEFAULT_CONFIG), 'nothing can change the shared defaults');
});

test('one GET to the config path', async () => {
  const { fetchFn, calls } = answering(OTHER);
  await loadConfig(fetchFn);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, API.config);
  assert.ok(calls[0]?.init?.method === undefined || calls[0].init.method === 'GET');
  assert.equal(calls[0]?.init?.body, undefined);
});

test('a whole answer replaces every value', async () => {
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[]) {
    assert.notEqual(OTHER[key], DEFAULT_CONFIG[key], `the test's answer must differ in ${key}`);
  }
  assert.deepEqual(await loadConfig(answering(OTHER).fetchFn), OTHER);
});

test('a missing key keeps the built-in value', async () => {
  assert.deepEqual(await loadConfig(answering({}).fetchFn), DEFAULT_CONFIG);
  assert.deepEqual(await loadConfig(answering({ events: true, faucetSats: 25000 }).fetchFn), {
    ...DEFAULT_CONFIG,
    events: true,
    faucetSats: 25000,
  });
  // One key at a time: each can be set alone, and setting it moves nothing else.
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[]) {
    assert.deepEqual(
      await loadConfig(answering({ [key]: OTHER[key] }).fetchFn),
      { ...DEFAULT_CONFIG, [key]: OTHER[key] },
      key,
    );
  }
});

test('a wrongly typed value keeps the built-in one', async () => {
  const wrong: Record<keyof AppConfig, unknown[]> = {
    turnstileSiteKey: [7, null, true, ['x'], { key: 'x' }],
    explorerUrl: [7, null, false, ['https://example.com']],
    electrumHost: [50002, null, {}],
    // A number sent as text is not a number, and a count is whole and above zero.
    electrumPort: ['50002', null, true, 0, -1, 50002.5, 1e400, [50002]],
    siteUrl: [1, null],
    sourceUrl: [1, null],
    passkeyHost: [1, null, ['localhost']],
    faucetSats: ['100000', null, 0, -5, 0.5, 2 ** 60, {}],
    blockSeconds: ['30', null, 0, -30, 2.5, false],
    events: ['true', 1, 0, null, 'yes', []],
  };
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[]) {
    assert.ok(wrong[key].length > 0);
    for (const value of wrong[key]) {
      // JSON has no way to write infinity; 1e400 in the text reads back as it.
      const body =
        value === 1e400
          ? `{"${key}":1e400,"events":true}`
          : { [key]: value, events: key === 'events' ? value : true };
      const config = await loadConfig(answering(body).fetchFn);
      assert.equal(config[key], DEFAULT_CONFIG[key], `${key}: ${JSON.stringify(value)}`);
      // The good value beside the bad one is still taken.
      if (key !== 'events') assert.equal(config.events, true, `${key}: ${JSON.stringify(value)}`);
    }
  }
});

test('an empty text keeps the built-in value, except for the site key', async () => {
  // The Worker answers "" for a text setting that is not set, so that is how
  // a missing setting arrives. Taken as it stands, it would blank the links
  // to the explorer and the site, and passkeys would no longer be offered on
  // the passkey host.
  const texts = (Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[]).filter(
    (key) => typeof DEFAULT_CONFIG[key] === 'string' && key !== 'turnstileSiteKey',
  );
  assert.deepEqual(texts, ['explorerUrl', 'electrumHost', 'siteUrl', 'sourceUrl', 'passkeyHost']);
  for (const key of texts) {
    for (const empty of ['', ' ', '\t\n']) {
      const config = await loadConfig(answering({ ...OTHER, [key]: empty }).fetchFn);
      // The built-in value stays, and the good values beside the empty one are still taken.
      assert.deepEqual(config, { ...OTHER, [key]: DEFAULT_CONFIG[key] }, `${key}: ${JSON.stringify(empty)}`);
    }
  }
  // All five at once: what the Worker answers when none of them is set.
  const unset = Object.fromEntries(texts.map((key) => [key, '']));
  assert.deepEqual(await loadConfig(answering({ ...unset, events: true }).fetchFn), { ...DEFAULT_CONFIG, events: true });

  // The contract gives an empty value a meaning for one key only: no site
  // key, so the faucet is closed. (The built-in site key is empty as well,
  // so this pins the answer. It cannot tell a key that was taken from one
  // that was ignored.)
  const closed = await loadConfig(answering({ ...OTHER, turnstileSiteKey: '' }).fetchFn);
  assert.deepEqual(closed, { ...OTHER, turnstileSiteKey: '' });
});

test('keys the app does not know are left behind', async () => {
  // Written as text: in JSON "__proto__" is an ordinary key, which an object literal here could not send.
  const config = await loadConfig(
    answering('{"faucetSats":25000,"somethingNew":"x","toString":"y","__proto__":{"events":true}}').fetchFn,
  );
  assert.deepEqual(config, { ...DEFAULT_CONFIG, faucetSats: 25000 });
  assert.deepEqual(Object.keys(config).sort(), Object.keys(DEFAULT_CONFIG).sort());
});

test('it never throws: any answer that cannot be read gives the built-in values', async () => {
  const unreadable: [what: string, fetchFn: (input: string) => Promise<Response>][] = [
    ['no answer', () => Promise.reject(new TypeError('fetch failed'))],
    ['a fetch that throws at once', () => { throw new Error('no fetch here'); }],
    ['a server error', answering({ error: 'unavailable' }, 502).fetchFn],
    ['a refusal that carries good-looking values', answering(OTHER, 403).fetchFn],
    ['not found, as a page', answering('<!doctype html><title>Not found</title>', 404).fetchFn],
    ['not JSON', answering('<!doctype html>').fetchFn],
    ['nothing at all', answering('').fetchFn],
    ['null', answering(null).fetchFn],
    ['a list', answering([OTHER]).fetchFn],
    ['a text', answering('"events"').fetchFn],
    ['a number', answering(7).fetchFn],
  ];
  for (const [what, fetchFn] of unreadable) {
    assert.deepEqual(await loadConfig(fetchFn), DEFAULT_CONFIG, what);
  }
});

test('the built-in values cannot be written to: hold a copy, or swap in what loadConfig gives', async () => {
  // WalletApi.config is an AppConfig, and the compiler lets the frozen
  // defaults be held as one. A write into them then throws when it runs, and
  // if that write sits where the Worker's answer is laid over them, the
  // settings would silently stay at the built-in ones.
  const held: AppConfig = DEFAULT_CONFIG;
  assert.throws(() => {
    held.events = true;
  }, TypeError);
  assert.throws(() => Object.assign(held, OTHER), TypeError);
  assert.equal(DEFAULT_CONFIG.events, false);
  assert.equal(DEFAULT_CONFIG.faucetSats, 100000);

  // The two ways that work: a copy takes the Worker's values ...
  const copy: AppConfig = { ...DEFAULT_CONFIG };
  Object.assign(copy, await loadConfig(answering(OTHER).fetchFn));
  assert.deepEqual(copy, OTHER);
  // ... and what loadConfig gives can replace the held object whole. It is not frozen.
  const loaded = await loadConfig(answering(OTHER).fetchFn);
  assert.ok(!Object.isFrozen(loaded));
  loaded.events = false;
  assert.equal(loaded.events, false);
});

test('each call gives a copy of its own', async () => {
  const first = await loadConfig(answering({}).fetchFn);
  first.faucetSats = 1;
  first.events = true;
  assert.notEqual(first, DEFAULT_CONFIG);
  assert.equal(DEFAULT_CONFIG.faucetSats, 100000);
  assert.deepEqual(await loadConfig(answering({}).fetchFn), DEFAULT_CONFIG);
});
