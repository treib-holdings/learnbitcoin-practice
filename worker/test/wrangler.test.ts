// The Worker's config file, held to what the spec says about it. A slip here
// would otherwise show only after a deploy.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configFromEnv } from '../src/config.ts';
import type { ConfigVars } from '../src/config.ts';
import { readFile, stripJsonComments, wranglerConfig } from './fakes.ts';

const config = wranglerConfig();
const source = readFile('../wrangler.jsonc');

test('the comment stripper leaves strings alone', () => {
  const text = '{ // one\n "a": "https://x.test/y", /* two */ "b": "a \\" // not a comment" }';
  assert.deepEqual(JSON.parse(stripJsonComments(text)), { a: 'https://x.test/y', b: 'a " // not a comment' });
});

test('the config holds these keys and no others', () => {
  assert.deepEqual(Object.keys(config).sort(), [
    '$schema',
    'assets',
    'compatibility_date',
    'main',
    'name',
    'observability',
    'preview_urls',
    'ratelimits',
    'routes',
    'secrets',
    'vars',
    'workers_dev',
  ]);
  assert.equal(config.name, 'learnbitcoin-practice');
  assert.equal(config.main, './src/index.ts');
  assert.equal(config.compatibility_date, '2026-11-14');
  assert.equal(config.compatibility_flags, undefined, 'no flags');
});

test('the app is served as a single-page app, and the Worker runs for /api/ and /p/ only', () => {
  assert.deepEqual(config.assets, {
    directory: '../app/dist',
    not_found_handling: 'single-page-application',
    run_worker_first: ['/api/*', '/p/*'],
  });
});

test('one door: the custom domain, with no workers.dev copy and no preview URLs', () => {
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{ pattern: 'practice.learnbitcoin.com', custom_domain: true }]);
});

test('Workers Logs are on, invocation logs are off, and traces are off by name', () => {
  // A trace records the full URL of a request and of each fetch made for it,
  // so the address or transaction ID. Left unsaid, traces are off only for
  // as long as that stays Cloudflare's default.
  assert.deepEqual(config.observability, {
    enabled: true,
    logs: { enabled: true, invocation_logs: false },
    traces: { enabled: false },
  });
});

test('five rate limiters with the per-minute limits of the spec and namespaces of their own', () => {
  const limiters = config.ratelimits as Array<{ name: string; namespace_id: string; simple: { limit: number; period: number } }>;
  assert.deepEqual(
    limiters.map((limiter) => [limiter.name, limiter.simple.limit, limiter.simple.period]),
    [
      ['CHAIN_LIMIT', 6000, 60],
      ['BROADCAST_LIMIT', 120, 60],
      ['FAUCET_LIMIT', 40, 60],
      ['POT_LIMIT', 60, 60],
      ['EVENTS_LIMIT', 600, 60],
    ],
  );
  const ids = limiters.map((limiter) => limiter.namespace_id);
  assert.equal(new Set(ids).size, 5, 'no two limiters share a namespace');
  for (const id of ids) {
    assert.match(id, /^[1-9][0-9]*$/);
    assert.ok(id !== '2610' && id !== '2611', "the main site's namespaces are not reused");
  }
  for (const limiter of limiters) assert.deepEqual(Object.keys(limiter).sort(), ['name', 'namespace_id', 'simple']);
});

test('the settings carry their production values: faucet closed and events off until the owner fills them in', () => {
  assert.deepEqual(config.vars, {
    ORIGIN_URL: 'https://practice-origin.learnbitcoin.com',
    TURNSTILE_SITE_KEY: '',
    TURNSTILE_HOSTNAME: 'practice.learnbitcoin.com',
    EXPLORER_URL: 'https://practice-explorer.learnbitcoin.com',
    ELECTRUM_HOST: 'practice-electrum.learnbitcoin.com',
    ELECTRUM_PORT: '50002',
    PLAUSIBLE_DOMAIN: '',
    EVENT_PROPS: 'off',
    SITE_URL: 'https://www.learnbitcoin.com',
    SOURCE_URL: 'https://github.com/treib-holdings/learnbitcoin-practice',
    PASSKEY_HOST: 'practice.learnbitcoin.com',
    FAUCET_SATS: '100000',
    BLOCK_SECONDS: '30',
  });
  // And they make a config the app can use.
  assert.deepEqual(configFromEnv(config.vars as ConfigVars), {
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
});

test('the four secrets are named, and none has a value here', () => {
  assert.deepEqual(config.secrets, {
    required: ['TURNSTILE_SECRET_KEY', 'ACCESS_CLIENT_ID', 'ACCESS_CLIENT_SECRET', 'BOTS_API_TOKEN'],
  });
  const vars = config.vars as Record<string, unknown>;
  for (const name of (config.secrets as { required: string[] }).required) assert.equal(vars[name], undefined, name);
});

test('no account, zone, tunnel or token identifier anywhere in the file', () => {
  const keys: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === 'object' && value !== null) {
      for (const [key, inner] of Object.entries(value)) {
        keys.push(key);
        walk(inner);
      }
    }
  };
  walk(config);
  for (const key of keys) assert.doesNotMatch(key, /account|zone|tunnel|token|api_key|binding/i, key);
  // Nothing that looks like an ID or a key: a long run of hex, or a 32-character tag.
  assert.doesNotMatch(source, /[0-9a-f]{32}/i);
  assert.doesNotMatch(source, /cfast_|Bearer |\/Users\//);
  // Plain ASCII, like the rest of the source.
  assert.match(source, /^[\x09\x0a\x20-\x7e]*$/);
});

test('the generated Env lists every binding the config has, and nothing else', () => {
  const generated = readFile('../worker-configuration.d.ts');
  assert.match(generated, /wrangler types --include-runtime=false --strict-vars=false`/, 'made with the two flags index.ts names');
  const block = generated.slice(generated.indexOf('interface __BaseEnv_Env {'), generated.indexOf('}'));
  const names = [...block.matchAll(/^\t([A-Z_]+): /gm)].map((match) => match[1]);
  const expected = [
    ...(config.ratelimits as Array<{ name: string }>).map((limiter) => limiter.name),
    ...Object.keys(config.vars as object),
    ...(config.secrets as { required: string[] }).required,
  ];
  assert.deepEqual(names, expected, 'run "wrangler types" again after changing wrangler.jsonc (index.ts says how)');
  // The runtime types were left out: the file is small and names one runtime type only.
  assert.ok(generated.length < 5000);
  assert.doesNotMatch(generated, /declare (class|function|var) /);
});
