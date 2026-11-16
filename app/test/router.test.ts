// Which screen an address shows, in both languages, and the address of each
// screen. The list of screens is the contract's, so these tests walk that
// list: a screen added there without a route fails here.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  API,
  LANGS,
  SCREENS,
  STEPS,
  eventPath as contractEventPath,
  eventPaths,
  type ScreenName,
  type StepId,
} from '@learnbitcoin/practice-contract';
import { eventPath, isAppPath, needsWallet, parsePath, pathFor, readsCoins, readsTransactions, type Lang, type Route } from '../src/lib/router.ts';

const TXID = '6c0443f5'.padEnd(64, 'a');
/** The step the tables below stand a step's screen on. Every one of the six has a test of its own further down. */
const STEP: StepId = 'pass-it-on';

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
  // SPEC-A3 section 3: the list of "Do it" steps and one step. Neither needs a wallet.
  ['/do', 'do', false],
  [`/do/${STEP}`, 'step', false],
];

/** A route for a screen name. The cast is checked by the round trip below. */
function routeOf(name: ScreenName): Route {
  if (name === 'tx') return { name, txid: TXID };
  if (name === 'step') return { name, id: STEP };
  return { name } as Route;
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
    // After /do/ only one of the six steps is a screen.
    '/do/first-payment',
    '/do//',
    '/DO',
    '/do/Pass-it-on',
    '/dos',
    '/wallet/do',
  ];
  for (const path of english) {
    assert.deepEqual(parsePath(path), { lang: 'en', route: { name: 'not-found' } }, JSON.stringify(path));
  }
  // An unknown path under /es is still a Spanish page.
  const spanish = ['/es/nope', '/es/es', '/es/wallet/nope', '/es//', '/es//wallet', '/es/do/first-payment', '/es/hazlo'];
  for (const path of spanish) {
    assert.deepEqual(parsePath(path), { lang: 'es', route: { name: 'not-found' } }, path);
  }
});

test('the "Do it" steps: /do is the list, /do/<id> one of the six steps, and any other text after /do/ is not found', () => {
  for (const lang of LANGS) {
    const prefix = lang === 'en' ? '' : '/es';
    assert.deepEqual(parsePath(`${prefix}/do`), { lang, route: { name: 'do' } });
    // One trailing slash is the same screen: "/do/" is the list, not a step with no name.
    assert.deepEqual(parsePath(`${prefix}/do/`), { lang, route: { name: 'do' } });
    assert.equal(pathFor({ name: 'do' }, lang), `${prefix}/do`);
    for (const id of STEPS) {
      const route: Route = { name: 'step', id };
      assert.deepEqual(parsePath(`${prefix}/do/${id}`), { lang, route }, id);
      // One trailing slash is the same screen.
      assert.deepEqual(parsePath(`${prefix}/do/${id}/`), { lang, route }, id);
      assert.equal(pathFor(route, lang), `${prefix}/do/${id}`);
      // Counted under its own address: the six IDs are the contract's closed list.
      assert.equal(eventPath(route, lang), `${prefix}/do/${id}`);
      assert.equal(eventPath(route, lang), contractEventPath('step', lang, id));
      assert.ok(eventPaths().includes(eventPath(route, lang)));
      assert.equal(needsWallet(route), false, id);
      assert.equal(isAppPath(pathFor(route, lang)), true, id);
    }
    assert.equal(eventPath({ name: 'do' }, lang), `${prefix}/do`);
    assert.equal(needsWallet({ name: 'do' }), false);
    // Anything else after /do/ is no screen: an ID that is not one of the six, a longer path, a query, capitals.
    const typed = [
      'first-payment',
      'hold',
      'hold-some-more',
      'hold-some/extra',
      'hold-some//',
      'HOLD-SOME',
      'Hold-some',
      'hold_some',
      'hold-some.html',
      'hold-some?from=/journey/x',
      'hold-some#done=hold-some',
      '%68old-some',
      ' hold-some',
      'toString',
      '__proto__',
      'constructor',
      '/',
      '/hold-some',
    ];
    for (const text of typed) {
      assert.deepEqual(parsePath(`${prefix}/do/${text}`), { lang, route: { name: 'not-found' } }, `${prefix}/do/${text}`);
    }
    // And such an address is counted as every unknown address is: nothing typed rides on a count.
    assert.equal(eventPath(parsePath(`${prefix}/do/first-payment`).route, lang), `${prefix}/not-found`);
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
      // The contract takes a step's ID as a third argument, and looks at it for the step screen alone.
      assert.equal(counted, contractEventPath(name, lang, STEP));
      assert.ok(allowed.includes(counted), counted);
      assert.ok(!counted.includes(TXID), counted);
      assert.doesNotMatch(counted, /[0-9a-f]{16}/);
      // Every screen but two is counted under its own address.
      if (name !== 'tx' && name !== 'not-found') assert.equal(counted, pathFor(routeOf(name), lang));
    }
  }
  // (A step's screen is counted with its step: the contract takes the ID as a third argument.)
  assert.equal(eventPath({ name: 'step', id: STEP }, 'en'), contractEventPath('step', 'en', STEP));
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
  // The same thing said another way: the screens under /wallet. (The steps are not under it: the first of them makes the wallet.)
  for (const name of SCREENS) {
    const underWallet = pathFor(routeOf(name), 'en').split('/')[1] === 'wallet';
    assert.equal(needsWallet(routeOf(name)), underWallet, name);
  }
});

test('readsCoins and readsTransactions: where the wallet keeps reading, which the engine and the strip both go by', () => {
  // The coins: every screen that shows a wallet, and a step's own screen. Not the list of steps, and no page about the app.
  for (const name of [...SCREENS, 'not-found'] as const) {
    assert.equal(readsCoins(name), name === 'step' || needsWallet(routeOf(name)), name);
  }
  assert.equal(readsCoins('step'), true);
  assert.equal(readsCoins('do'), false);
  assert.equal(readsCoins('home'), false);
  // The list of transactions: the three screens that show it, and a step's own. Nothing else.
  const lists = [...SCREENS, 'not-found' as const].filter((name) => readsTransactions(name));
  assert.deepEqual([...lists].sort(), ['activity', 'step', 'tx', 'wallet']);
  // The list is read only where the coins are.
  for (const name of lists) assert.equal(readsCoins(name), true, name);
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
