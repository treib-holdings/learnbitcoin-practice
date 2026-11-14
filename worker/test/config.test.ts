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
  });
  // What the app receives: JSON numbers, not strings.
  assert.match(JSON.stringify(config), /"electrumPort":50002,/);
  assert.match(JSON.stringify(config), /"faucetSats":100000,"blockSeconds":30,/);
});

test('an empty site key and an empty events domain come through as closed and off', () => {
  const config = configFromEnv({ ...VARS, TURNSTILE_SITE_KEY: '', PLAUSIBLE_DOMAIN: '' });
  assert.equal(config.turnstileSiteKey, '');
  assert.equal(config.events, false);
  assert.equal(configFromEnv({ ...VARS, PLAUSIBLE_DOMAIN: '  ' }).events, false);
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
