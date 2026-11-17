import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADDRESS_PATTERN,
  API,
  BROADCAST_REFUSALS,
  ERROR_CODES,
  ERROR_STATUS,
  EVENTS,
  LANGS,
  SCREENS,
  STEPS,
  TXID_PATTERN,
  eventPath,
  eventPaths,
  isErrorCode,
  isEventBody,
  isStepId,
  type AppConfig,
  type PotStats,
  type StepId,
  type ValueOf,
} from '../src/index.ts';

test('every error code has a status, and only error codes do', () => {
  assert.deepEqual(Object.keys(ERROR_STATUS).sort(), [...ERROR_CODES].sort());
  assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length);
  for (const code of ERROR_CODES) {
    const status = ERROR_STATUS[code];
    assert.ok(status >= 400 && status <= 503, `${code} -> ${status}`);
    assert.match(code, /^[a-z]+(_[a-z]+)*$/);
  }
  for (const code of BROADCAST_REFUSALS) assert.ok(isErrorCode(code));
  assert.equal(isErrorCode('nope'), false);
  assert.equal(isErrorCode(undefined), false);
});

test('event paths are fixed per screen and language', () => {
  assert.equal(eventPath('home', 'en'), '/');
  assert.equal(eventPath('home', 'es'), '/es');
  assert.equal(eventPath('tx', 'en'), '/wallet/tx');
  assert.equal(eventPath('tx', 'es'), '/es/wallet/tx');
  assert.equal(eventPath('not-found', 'es'), '/es/not-found');
  const all = eventPaths();
  // Every screen but one has one path in each language. The step screen has one for each step.
  assert.equal(all.length, (SCREENS.length - 1) * LANGS.length + STEPS.length * LANGS.length);
  assert.equal(all.length, 42);
  assert.equal(new Set(all).size, all.length);
  for (const path of all) assert.match(path, /^\/[a-z/-]*$/);
  assert.equal(eventPaths(), all, 'the list is built once');
});

test('the six steps, in the order of their chapters', () => {
  assert.deepEqual([...STEPS], ['hold-some', 'pass-it-on', 'no-balances', 'waiting-room', 'the-seed', 'prove-the-backup']);
  assert.equal(new Set(STEPS).size, STEPS.length);
  // An ID is part of an address, of a counted event and of a link to the main site.
  for (const step of STEPS) {
    assert.match(step, /^[a-z]+(-[a-z]+)*$/);
    assert.ok(isStepId(step));
  }
  for (const not of ['', 'hold', 'Hold-some', 'hold-some ', 'hold-some/', 'first-payment', 'toString', '__proto__', 0, null, undefined, ['hold-some']]) {
    assert.equal(isStepId(not), false, String(not));
  }
});

test('the list of steps and each step are screens, counted under /do and /do/<id>', () => {
  assert.ok(SCREENS.includes('do') && SCREENS.includes('step'));
  assert.equal(eventPath('do', 'en'), '/do');
  assert.equal(eventPath('do', 'es'), '/es/do');
  for (const step of STEPS) {
    assert.equal(eventPath('step', 'en', step), `/do/${step}`);
    assert.equal(eventPath('step', 'es', step), `/es/do/${step}`);
    // For any other screen the step is not looked at.
    assert.equal(eventPath('do', 'en', step), '/do');
    assert.equal(eventPath('tx', 'es', step), '/es/wallet/tx');
  }
  // The twelve step paths are on the closed list, and "/do/" with anything else after it is not.
  const all = eventPaths();
  const stepPaths = all.filter((path) => /\/do\/./.test(path));
  assert.deepEqual(
    [...stepPaths].sort(),
    LANGS.flatMap((lang) => STEPS.map((step) => `${lang === 'en' ? '' : '/es'}/do/${step}`)).sort(),
  );
  assert.ok(all.includes('/do') && all.includes('/es/do'));

  // A step's screen without its step, or with text that is no step, is counted as an unknown
  // address is: under one fixed path. What was typed never becomes part of a counted path.
  for (const typed of [undefined, '', 'first-payment', 'hold-some/x', '../wallet', 'HOLD-SOME', 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6']) {
    assert.equal(eventPath('step', 'en', typed), '/not-found', String(typed));
    assert.equal(eventPath('step', 'es', typed), '/es/not-found', String(typed));
    assert.ok(all.includes(eventPath('step', 'en', typed)));
  }
  for (const lang of LANGS) {
    for (const screen of SCREENS) assert.ok(all.includes(eventPath(screen, lang, 'hold-some')), `${lang} ${screen}`);
  }
});

test('"Do it" is counted with the step that was done, and with nothing else', () => {
  assert.deepEqual(EVENTS['Do it'], { prop: 'step', values: STEPS });
  // The compiler holds a counted step to the list.
  const value: ValueOf<'Do it'> = 'the-seed';
  const step: StepId = value;
  assert.equal(step, 'the-seed');
  for (const id of STEPS) {
    assert.ok(isEventBody({ name: 'Do it', path: `/do/${id}`, value: id }));
    assert.ok(isEventBody({ name: 'Do it', path: '/es/wallet/tx', value: id }), 'a step can be done on another screen');
    assert.ok(isEventBody({ name: 'pageview', path: `/es/do/${id}` }));
  }
  assert.equal(isEventBody({ name: 'Do it', path: '/do/hold-some' }), false);
  assert.equal(isEventBody({ name: 'Do it', path: '/do/hold-some', value: 'first-payment' }), false);
  assert.equal(isEventBody({ name: 'Do it', path: '/do/first-payment', value: 'hold-some' }), false);
  assert.equal(isEventBody({ name: 'pageview', path: '/do/' }), false);
  assert.equal(isEventBody({ name: 'pageview', path: '/do/hold-some/' }), false);
  assert.equal(isEventBody({ name: 'Do it', path: '/do/hold-some', value: 'hold-some', wallet: '73c5da0a' }), false);
});

test('the pot count has a path of its own, and three whole numbers for a body', () => {
  assert.equal(API.potStats, '/api/pot/stats');
  assert.equal(API.potAddress, '/api/pot/address');
  assert.equal(new Set(Object.values(API)).size, Object.values(API).length);
  const stats: PotStats = { passedOn: 3, waiting: 1, handedOn: 2 };
  assert.deepEqual(Object.keys(stats), ['passedOn', 'waiting', 'handedOn']);
});

test('the settings say whether the pot count can be had: a yes or a no of its own', () => {
  // Every field of the settings, typed out. The compiler holds this object to AppConfig: with a
  // field left out, misspelled or of another kind, "pnpm check" fails.
  const settings: AppConfig = {
    turnstileSiteKey: '',
    explorerUrl: 'https://explorer.test',
    electrumHost: 'electrum.test',
    electrumPort: 50002,
    siteUrl: 'https://site.test',
    sourceUrl: 'https://source.test',
    passkeyHost: 'localhost',
    faucetSats: 100000,
    blockSeconds: 30,
    events: false,
    potCounts: false,
  };
  assert.deepEqual(Object.keys(settings).slice(-2), ['events', 'potCounts']);
  assert.equal(Object.keys(settings).length, 11);
  // A yes or a no, like the one for events: no word that could be read two ways.
  assert.equal(typeof settings.potCounts, 'boolean');
  // @ts-expect-error the settings take true or false here, and no text
  const word: AppConfig['potCounts'] = 'on';
  assert.equal(typeof word, 'string');
  // The path it speaks of is the one the counts are read from.
  assert.equal(API.potStats, '/api/pot/stats');
});

test('a screen view carries no value', () => {
  assert.ok(isEventBody({ name: 'pageview', path: '/' }));
  assert.ok(isEventBody({ name: 'pageview', path: '/es/wallet/send' }));
  assert.equal(isEventBody({ name: 'pageview', path: '/', value: 'x' }), false);
  assert.equal(isEventBody({ name: 'pageview', path: '/wallet/tx/abc' }), false);
  assert.equal(isEventBody({ name: 'pageview', path: '/nowhere' }), false);
  assert.equal(isEventBody({ name: 'pageview' }), false);
});

test('every counted event takes exactly its own values', () => {
  for (const [name, spec] of Object.entries(EVENTS)) {
    if (spec === null) continue;
    assert.match(spec.prop, /^[a-z]+$/);
    assert.ok(spec.values.length > 0);
    assert.equal(new Set(spec.values).size, spec.values.length);
    for (const value of spec.values) {
      assert.match(value, /^[a-z]+(-[a-z]+)*$/, `${name}: ${value}`);
      assert.ok(isEventBody({ name, path: '/wallet', value }), `${name}: ${value}`);
    }
    assert.equal(isEventBody({ name, path: '/wallet' }), false, `${name} needs a value`);
    assert.equal(isEventBody({ name, path: '/wallet', value: 'something-else' }), false);
    assert.equal(isEventBody({ name, path: '/wallet', value: 1 }), false);
  }
});

test('anything outside the lists is refused', () => {
  assert.equal(isEventBody(null), false);
  assert.equal(isEventBody('pageview'), false);
  assert.equal(isEventBody([]), false);
  assert.equal(isEventBody({}), false);
  assert.equal(isEventBody({ name: 'Made up', path: '/', value: 'ok' }), false);
  assert.equal(isEventBody({ name: 'toString', path: '/' }), false);
  assert.equal(isEventBody({ name: '__proto__', path: '/' }), false);
  assert.equal(isEventBody({ name: 'Passkey', path: '/new', value: 'ok', props: { a: 'b' } }), false);
  assert.equal(isEventBody({ name: 'Passkey', path: '/new', value: 'ok', address: 'bcrt1q' }), false);
  assert.equal(isEventBody({ name: 'Passkey', path: 7, value: 'ok' }), false);
});

test('address and transaction ID patterns', () => {
  assert.match('bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6', ADDRESS_PATTERN);
  assert.match(`bcrt1p${'q'.repeat(58)}`, ADDRESS_PATTERN); // the length of a taproot address
  assert.doesNotMatch(`bcrt1p${'q'.repeat(72)}`, ADDRESS_PATTERN);
  for (const bad of [
    'tb1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjpupg53',
    'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    'BCRT1QP7TH3DVTKX9VRKTCRN5ERQ0DGJZGC4WJXZL8D6',
    'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6/utxo',
    'bcrt1q',
    'bcrt1b7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6',
    '../bots/faucet',
    '',
  ]) {
    assert.doesNotMatch(bad, ADDRESS_PATTERN, bad);
  }
  assert.match('6c0443f5'.padEnd(64, 'a'), TXID_PATTERN);
  assert.doesNotMatch('6C0443F5'.padEnd(64, 'a'), TXID_PATTERN);
  assert.doesNotMatch('6c0443f5'.padEnd(63, 'a'), TXID_PATTERN);
  assert.doesNotMatch(`${'a'.repeat(64)}/hex`, TXID_PATTERN);
});
