import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configFromEnv } from '../src/config.ts';
import type { ConfigVars } from '../src/config.ts';

const VARS: ConfigVars = {
  TURNSTILE_SITE_KEY: 'site-key',
  EXPLORER_URL: 'https://practice-explorer.learnbitcoin.com',
  ELECTRUM_HOST: 'practice-electrum.learnbitcoin.com',
  ELECTRUM_PORT: '50002',
  PLAUSIBLE_DOMAIN: 'practice.learnbitcoin.com',
  SITE_URL: 'https://www.learnbitcoin.com',
  SOURCE_URL: 'https://example.com/source',
  PASSKEY_HOST: 'practice.learnbitcoin.com',
  FAUCET_SATS: '100000',
  BLOCK_SECONDS: '30',
  POT_COUNTS: 'off',
};

test('settings become the app config, numbers as numbers', () => {
  const config = configFromEnv(VARS);
  assert.deepEqual(config, {
    turnstileSiteKey: 'site-key',
    explorerUrl: 'https://practice-explorer.learnbitcoin.com',
    electrumHost: 'practice-electrum.learnbitcoin.com',
    electrumPort: 50002,
    siteUrl: 'https://www.learnbitcoin.com',
    sourceUrl: 'https://example.com/source',
    passkeyHost: 'practice.learnbitcoin.com',
    faucetSats: 100000,
    blockSeconds: 30,
    events: true,
    potCounts: false,
  });
  // What the app receives: JSON numbers, not strings, and a plain true or false for the two switches.
  assert.match(JSON.stringify(config), /"electrumPort":50002,/);
  assert.match(JSON.stringify(config), /"faucetSats":100000,"blockSeconds":30,/);
  assert.match(JSON.stringify(config), /,"events":true,"potCounts":false\}$/);
});

test('an empty site key and an empty events domain come through as closed and off', () => {
  const config = configFromEnv({ ...VARS, TURNSTILE_SITE_KEY: '', PLAUSIBLE_DOMAIN: '' });
  assert.equal(config.turnstileSiteKey, '');
  assert.equal(config.events, false);
  assert.equal(configFromEnv({ ...VARS, PLAUSIBLE_DOMAIN: '  ' }).events, false);
});

test('the pot counts are on for the exact word "on" and for nothing else', () => {
  // On: the one word.
  assert.equal(configFromEnv({ ...VARS, POT_COUNTS: 'on' }).potCounts, true);
  // Off: how it ships, a setting that is missing or empty, and every value that only looks like the word or
  // means the same to a person. This setting is not trimmed and not read in capitals: it opens a way from
  // the public site to the practice network, so a value that is nearly right leaves that way shut.
  const off: unknown[] = [
    'off',
    '',
    undefined,
    null,
    'ON',
    'On',
    'oN',
    ' on',
    'on ',
    ' on ',
    'on\n',
    '\ton',
    'on\u0000',
    'o n',
    'onn',
    'oon',
    '"on"',
    "'on'",
    'on,off',
    'on;',
    'true',
    'TRUE',
    'yes',
    'y',
    '1',
    'enabled',
    'open',
    'auto',
    true,
    1,
    0,
    ['on'],
    { on: true },
    { toString: () => 'on' },
    new String('on'),
  ];
  for (const value of off) {
    assert.equal(configFromEnv({ ...VARS, POT_COUNTS: value } as unknown as ConfigVars).potCounts, false, JSON.stringify(value) ?? String(value));
  }
  // It is a switch of its own: no other setting turns it on, whatever that setting says, and it turns no other.
  for (const name of Object.keys(VARS) as Array<keyof ConfigVars>) {
    if (name === 'POT_COUNTS' || name === 'ELECTRUM_PORT' || name === 'FAUCET_SATS' || name === 'BLOCK_SECONDS') continue;
    assert.equal(configFromEnv({ ...VARS, [name]: 'on' }).potCounts, false, name);
  }
  const { potCounts: _off, ...whenOff } = configFromEnv(VARS);
  const { potCounts: _on, ...whenOn } = configFromEnv({ ...VARS, POT_COUNTS: 'on' });
  assert.deepEqual(whenOn, whenOff, 'switching the counts on changes nothing else the app is told');
  // And it stops nothing: a Worker with the setting missing or misspelled still has its settings, with the counts off.
  assert.doesNotThrow(() => configFromEnv({ ...VARS, POT_COUNTS: 'maybe' }));
  const { POT_COUNTS: _left, ...without } = VARS;
  assert.equal(configFromEnv(without as ConfigVars).potCounts, false);
});

test('values are trimmed, URLs lose a trailing slash, numbers may arrive as numbers', () => {
  const config = configFromEnv({
    ...VARS,
    EXPLORER_URL: ' https://practice-explorer.learnbitcoin.com/ ',
    SITE_URL: 'https://www.learnbitcoin.com//',
    ELECTRUM_PORT: 50002,
    FAUCET_SATS: ' 100000 ',
  });
  assert.equal(config.explorerUrl, 'https://practice-explorer.learnbitcoin.com');
  assert.equal(config.siteUrl, 'https://www.learnbitcoin.com');
  assert.equal(config.electrumPort, 50002);
  assert.equal(config.faucetSats, 100000);
});

test('a number that is missing or malformed stops the Worker, naming the setting and not its value', () => {
  const bad: Array<[Partial<Record<keyof ConfigVars, unknown>>, RegExp]> = [
    [{ ELECTRUM_PORT: '' }, /^ELECTRUM_PORT must be/],
    [{ ELECTRUM_PORT: undefined }, /^ELECTRUM_PORT must be/],
    [{ ELECTRUM_PORT: '50002.5' }, /^ELECTRUM_PORT must be/],
    [{ ELECTRUM_PORT: '70000' }, /^ELECTRUM_PORT must be/],
    [{ ELECTRUM_PORT: '0' }, /^ELECTRUM_PORT must be/],
    [{ FAUCET_SATS: '1e5' }, /^FAUCET_SATS must be/],
    [{ FAUCET_SATS: '-5' }, /^FAUCET_SATS must be/],
    [{ FAUCET_SATS: 0.5 }, /^FAUCET_SATS must be/],
    [{ FAUCET_SATS: '99999999999999999999' }, /^FAUCET_SATS must be/],
    [{ BLOCK_SECONDS: 'thirty' }, /^BLOCK_SECONDS must be/],
    [{ BLOCK_SECONDS: null }, /^BLOCK_SECONDS must be/],
  ];
  for (const [change, message] of bad) {
    assert.throws(
      () => configFromEnv({ ...VARS, ...change } as ConfigVars),
      (error: Error) => {
        assert.match(error.message, message);
        for (const value of Object.values(change)) {
          if (typeof value === 'string' && value !== '') assert.ok(!error.message.includes(value));
        }
        return true;
      },
    );
  }
});

test('a text setting that is missing reads as empty', () => {
  const config = configFromEnv({ ...VARS, EXPLORER_URL: undefined, TURNSTILE_SITE_KEY: undefined } as unknown as ConfigVars);
  assert.equal(config.explorerUrl, '');
  assert.equal(config.turnstileSiteKey, '');
});

test('the settings are read from what the Worker is given and from nothing else', () => {
  // configFromEnv takes the settings and nothing of a request: there is no second argument for one to ride in on.
  assert.equal(configFromEnv.length, 1);
  // The object it is handed is only read: a setting cannot be switched by reading it.
  const vars = Object.freeze({ ...VARS });
  assert.equal(configFromEnv(vars).potCounts, false);
  assert.deepEqual(vars, VARS);
  // The same settings give the same answer, every time: nothing is remembered from one reading to the next.
  assert.equal(configFromEnv({ ...VARS, POT_COUNTS: 'on' }).potCounts, true);
  assert.equal(configFromEnv(VARS).potCounts, false);
  assert.equal(configFromEnv({ ...VARS, POT_COUNTS: 'on' }).potCounts, true);
});
