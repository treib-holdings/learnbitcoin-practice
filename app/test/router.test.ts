// Which screen an address shows, in both languages, and the address of each
// screen. The list of screens is the contract's, so these tests walk that
// list: a screen added there without a route fails here.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  API,
  LANGS,
  SCREENS,
  eventPath as contractEventPath,
  eventPaths,
  type ScreenName,
} from '@learnbitcoin/practice-contract';
import { eventPath, isAppPath, needsWallet, parsePath, pathFor, type Lang, type Route } from '../src/lib/router.ts';

const TXID = '6c0443f5'.padEnd(64, 'a');

/** The table of SPEC section 3: every screen's English path, and whether it needs a wallet. */
const TABLE: [path: string, name: ScreenName, needsRecord: boolean][] = [
  ['/', 'home', false],
  ['/new', 'new', false],
  ['/restore', 'restore', false],
  ['/sparrow', 'sparrow', false],
  ['/about', 'about', false],
  ['/wallet', 'wallet', true],
  ['/wallet/coins', 'coins', true],
  ['/wallet/receive', 'receive', true],
  ['/wallet/send', 'send', true],
  ['/wallet/activity', 'activity', true],
  [`/wallet/tx/${TXID}`, 'tx', true],
  ['/wallet/backup', 'backup', true],
  ['/wallet/settings', 'settings', true],
];

/** A route for a screen name. The cast is checked by the round trip below. */
function routeOf(name: ScreenName): Route {
  return name === 'tx' ? { name, txid: TXID } : ({ name } as Route);
}

test('the table covers every screen of the contract', () => {
  assert.deepEqual([...TABLE.map(([, name]) => name), 'not-found'].sort(), [...SCREENS].sort());
});

test('English paths', () => {
  for (const [path, name] of TABLE) {
    assert.deepEqual(parsePath(path), { lang: 'en', route: routeOf(name) }, path);
    assert.equal(pathFor(routeOf(name), 'en'), path);
  }
});

test('Spanish paths are the English ones under /es', () => {
  assert.deepEqual(parsePath('/es'), { lang: 'es', route: { name: 'home' } });
  assert.equal(pathFor({ name: 'home' }, 'es'), '/es');
  for (const [path, name] of TABLE) {
    if (name === 'home') continue;
    assert.deepEqual(parsePath(`/es${path}`), { lang: 'es', route: routeOf(name) }, path);
    assert.equal(pathFor(routeOf(name), 'es'), `/es${path}`);
  }
});

test('one trailing slash is the same screen', () => {
  assert.deepEqual(parsePath('/es/'), { lang: 'es', route: { name: 'home' } });
  for (const [path, name] of TABLE) {
    if (name === 'home') continue;
    assert.deepEqual(parsePath(`${path}/`), { lang: 'en', route: routeOf(name) }, path);
    assert.deepEqual(parsePath(`/es${path}/`), { lang: 'es', route: routeOf(name) }, path);
  }
});

test('a transaction needs a whole lower-case ID', () => {
  assert.deepEqual(parsePath(`/wallet/tx/${TXID}`), { lang: 'en', route: { name: 'tx', txid: TXID } });
  assert.deepEqual(parsePath(`/es/wallet/tx/${TXID}/`), { lang: 'es', route: { name: 'tx', txid: TXID } });
  const zeros = '0'.repeat(64);
  assert.deepEqual(parsePath(`/wallet/tx/${zeros}`).route, { name: 'tx', txid: zeros });

  for (const bad of [
    '/wallet/tx',
    '/wallet/tx/',
    `/wallet/tx/${TXID.slice(1)}`, // 63 characters
    `/wallet/tx/${TXID}a`, // 65
    `/wallet/tx/${TXID.toUpperCase()}`,
    `/wallet/tx/${TXID.slice(0, 63)}g`, // not hex
    `/wallet/tx/${TXID}/raw`,
    `/wallet/tx/${TXID}//`,
    `/wallet/tx//${TXID}`,
    `/wallet/tx/${TXID}.json`,
    `/wallet/tx/${TXID.slice(0, 62)}%61`,
    `/tx/${TXID}`,
    `/wallet/TX/${TXID}`,
  ]) {
    assert.deepEqual(parsePath(bad).route, { name: 'not-found' }, bad);
    assert.deepEqual(parsePath(`/es${bad}`), { lang: 'es', route: { name: 'not-found' } }, bad);
  }
});

test('anything else is not found', () => {
  const english = [
    '/nope',
    '/wallet/nope',
    '/wallet/coins/extra',
    '/new/wallet',
    '/Wallet',
    '/WALLET/SEND',
    '/home',
    '/index.html',
    '/not-found',
    '/esx',
    '/espanol',
    '/ES',
    '/en',
    '/en/wallet',
    '//',
    '/wallet//',
    '//wallet',
    '/%77allet',
    '/wallet?x=1',
    '/wallet#top',
    '/__proto__',
    '/constructor',
    '/toString',
    '',
    'wallet',
    'es',
    ' /wallet',
    // Kept for the guided steps of the next phase.
    '/do',
    '/do/first-payment',
  ];
  for (const path of english) {
    assert.deepEqual(parsePath(path), { lang: 'en', route: { name: 'not-found' } }, JSON.stringify(path));
  }
  // An unknown path under /es is still a Spanish page.
  const spanish = ['/es/nope', '/es/es', '/es/wallet/nope', '/es//', '/es//wallet', '/es/do', '/es/do/first-payment'];
  for (const path of spanish) {
    assert.deepEqual(parsePath(path), { lang: 'es', route: { name: 'not-found' } }, path);
  }
});

test('pathFor and parsePath round-trip for every screen in both languages', () => {
  for (const lang of LANGS) {
    for (const name of SCREENS) {
      const route = routeOf(name);
      const path = pathFor(route, lang);
      assert.match(path, /^\/[a-z0-9/-]*$/, path);
      assert.ok(path === '/' || !path.endsWith('/'), path);
      assert.deepEqual(parsePath(path), { lang, route }, `${lang} ${name}: ${path}`);
    }
  }
  // Every screen has an address of its own.
  const all = LANGS.flatMap((lang) => SCREENS.map((name) => pathFor(routeOf(name), lang)));
  assert.equal(new Set(all).size, all.length);
});

test('the language switch keeps the screen', () => {
  const other: Record<Lang, Lang> = { en: 'es', es: 'en' };
  for (const [path] of TABLE) {
    for (const start of [path, path === '/' ? '/es' : `/es${path}`]) {
      const { lang, route } = parsePath(start);
      const switched = parsePath(pathFor(route, other[lang]));
      assert.equal(switched.lang, other[lang]);
      assert.deepEqual(switched.route, route);
    }
  }
});

test('eventPath is the contract path for the screen, and never holds a transaction ID', () => {
  const allowed = eventPaths();
  for (const lang of LANGS) {
    for (const name of SCREENS) {
      const counted = eventPath(routeOf(name), lang);
      assert.equal(counted, contractEventPath(name, lang));
      assert.ok(allowed.includes(counted), counted);
      assert.ok(!counted.includes(TXID), counted);
      assert.doesNotMatch(counted, /[0-9a-f]{16}/);
      // Every screen but two is counted under its own address.
      if (name !== 'tx' && name !== 'not-found') assert.equal(counted, pathFor(routeOf(name), lang));
    }
  }
  assert.equal(eventPath({ name: 'tx', txid: TXID }, 'en'), '/wallet/tx');
  assert.equal(eventPath({ name: 'tx', txid: TXID }, 'es'), '/es/wallet/tx');
  // Whatever was typed into the address bar, an unknown path is counted as one fixed path.
  assert.equal(eventPath(parsePath('/something/the-reader/typed').route, 'en'), '/not-found');
});

test('needsWallet: the wallet screens, and no other', () => {
  for (const [, name, needsRecord] of TABLE) {
    assert.equal(needsWallet(routeOf(name)), needsRecord, name);
  }
  assert.equal(needsWallet({ name: 'not-found' }), false);
  // The same thing said another way: the screens under /wallet.
  for (const name of SCREENS) {
    const underWallet = pathFor(routeOf(name), 'en').split('/')[1] === 'wallet';
    assert.equal(needsWallet(routeOf(name)), underWallet, name);
  }
});

test('isAppPath: screens are handled in place', () => {
  for (const lang of LANGS) {
    for (const name of SCREENS) assert.equal(isAppPath(pathFor(routeOf(name), lang)), true, name);
  }
  // Unknown paths too: the app shows its own "not found" screen for them.
  for (const path of ['/nope', '/es/nope', '/wallet/', '/do/first-payment', '/es/do/first-payment']) {
    assert.equal(isAppPath(path), true, path);
  }
  // Near misses of the Worker's paths are ordinary paths.
  for (const path of ['/api', '/p', '/apiary', '/passkey', '/pay', '/es/api/config', '/es/p/event', '/wallet/api/x']) {
    assert.equal(isAppPath(path), true, path);
  }
});

test('isAppPath: the Worker paths and files are left to the browser', () => {
  for (const path of Object.values(API)) assert.equal(isAppPath(path), false, path);
  for (const path of [
    '/api/',
    '/api/esplora/blocks/tip/height',
    `/api/esplora/tx/${TXID}`,
    '/api/esplora/address/bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6/utxo',
    '/api/anything/else',
    '/p/',
    '/p/event',
    '/p/anything',
  ]) {
    assert.equal(isAppPath(path), false, path);
  }
  // A last part with a file extension.
  for (const path of [
    '/logo.svg',
    '/favicon.png',
    '/robots.txt',
    '/licenses.md',
    '/index.html',
    '/assets/index-C0uIWOIg.js',
    '/assets/index-C0uIWOIg.js.map',
    '/assets/geist-latin-wght-normal-BgDaEnEv.woff2',
    '/es/card.PDF',
    `/wallet/tx/${TXID}.json`,
  ]) {
    assert.equal(isAppPath(path), false, path);
  }
  // A dot that is not an extension on the last part.
  for (const path of ['/v1.2/notes', '/a.b/', '/wallet.', '/.']) {
    assert.equal(isAppPath(path), true, path);
  }
});
