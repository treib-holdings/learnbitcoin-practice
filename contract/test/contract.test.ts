import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADDRESS_PATTERN,
  BROADCAST_REFUSALS,
  ERROR_CODES,
  ERROR_STATUS,
  EVENTS,
  LANGS,
  SCREENS,
  TXID_PATTERN,
  eventPath,
  eventPaths,
  isErrorCode,
  isEventBody,
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
  assert.equal(all.length, SCREENS.length * LANGS.length);
  assert.equal(new Set(all).size, all.length);
  for (const path of all) assert.match(path, /^\/[a-z/-]*$/);
  assert.equal(eventPaths(), all, 'the list is built once');
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
