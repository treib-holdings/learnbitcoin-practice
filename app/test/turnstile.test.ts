// The options the faucet's bot check is drawn with. The Worker refuses a
// token unless it was made for the action "faucet" and for the address that
// is being paid, so those two must leave the page exactly right.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADDRESS_PATTERN, LANGS } from '@learnbitcoin/practice-contract';
import { TURNSTILE_SCRIPT, faucetWidgetOptions } from '../src/lib/turnstile.ts';

const SITE_KEY = '1x00000000000000000000AA'; // Cloudflare's published test key: always passes
const ADDRESS = 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6';

test('the widget is made for the faucet and for one address', () => {
  const options = faucetWidgetOptions(SITE_KEY, ADDRESS, 'en', false);
  assert.equal(options.sitekey, SITE_KEY);
  assert.equal(options.action, 'faucet');
  assert.equal(options.cData, ADDRESS);

  const other = `bcrt1p${'q'.repeat(58)}`;
  assert.equal(faucetWidgetOptions(SITE_KEY, other, 'en', false).cData, other);
});

test('the widget speaks the page language', () => {
  for (const lang of LANGS) {
    assert.equal(faucetWidgetOptions(SITE_KEY, ADDRESS, lang, false).language, lang);
  }
});

test('the widget is compact on a narrow screen and normal otherwise', () => {
  assert.equal(faucetWidgetOptions(SITE_KEY, ADDRESS, 'en', true).size, 'compact');
  assert.equal(faucetWidgetOptions(SITE_KEY, ADDRESS, 'es', true).size, 'compact');
  assert.equal(faucetWidgetOptions(SITE_KEY, ADDRESS, 'en', false).size, 'normal');
  assert.equal(faucetWidgetOptions(SITE_KEY, ADDRESS, 'es', false).size, 'normal');
});

test('the whole option object, so nothing slips in unseen', () => {
  assert.deepEqual(faucetWidgetOptions(SITE_KEY, ADDRESS, 'es', true), {
    sitekey: SITE_KEY,
    action: 'faucet',
    cData: ADDRESS,
    language: 'es',
    // Out of sight unless the reader has to do something.
    appearance: 'interaction-only',
    // No form on the page, so no hidden form field: the token comes through the callback.
    'response-field': false,
    size: 'compact',
  });
  // Callbacks are the caller's to add.
  for (const value of Object.values(faucetWidgetOptions(SITE_KEY, ADDRESS, 'en', false))) {
    assert.notEqual(typeof value, 'function');
  }
});

test('action and cData fit what Turnstile accepts', () => {
  // Turnstile takes up to 32 characters for the action and 255 for cData, from
  // letters, digits, "_" and "-". Any practice address fits: the longest the
  // contract allows is 76 characters of lower-case letters and digits.
  const allowed = /^[A-Za-z0-9_-]+$/;
  const longest = `bcrt1${'q'.repeat(71)}`;
  assert.match(longest, ADDRESS_PATTERN);
  for (const address of [ADDRESS, longest]) {
    const { action, cData } = faucetWidgetOptions(SITE_KEY, address, 'en', false);
    assert.ok(typeof action === 'string' && action.length <= 32);
    assert.match(action, allowed);
    assert.ok(typeof cData === 'string' && cData.length <= 255);
    assert.match(cData, allowed);
  }
});

test('the script is loaded for explicit rendering, from the one host the page allows', () => {
  const url = new URL(TURNSTILE_SCRIPT);
  // The page's Content-Security-Policy allows scripts from this origin and no other.
  assert.equal(url.origin, 'https://challenges.cloudflare.com');
  assert.equal(url.pathname, '/turnstile/v0/api.js');
  assert.equal(url.searchParams.get('render'), 'explicit');
});
