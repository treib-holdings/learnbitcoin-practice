// The Worker's config file, held to what the spec says about it. A slip here
// would otherwise show only after a deploy.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configFromEnv } from '../src/config.ts';
import type { ConfigVars } from '../src/config.ts';
import { readFile, readJson, stripJsonComments, wranglerConfig } from './fakes.ts';

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

test('Workers Logs are on, invocation logs are off, query strings are cut from stored URLs, and traces are off by name', () => {
  // A trace records the full URL of a request and of each fetch made for it,
  // so the address or transaction ID. Left unsaid, traces are off only for
  // as long as that stays Cloudflare's default.
  //
  // redact_query_string: no route takes a query string, so whatever follows
  // a question mark was put there by a visitor or picked up by a link on
  // its way, and is not kept. Left unsaid, it is.
  assert.deepEqual(config.observability, {
    enabled: true,
    redact_query_string: true,
    logs: { enabled: true, invocation_logs: false },
    traces: { enabled: false },
  });
});

test("the setting that cuts query strings is one this version of wrangler knows, by that name and at that place", () => {
  // The config's own schema (the file "$schema" points at) describes the
  // setting. A key that wrangler does not know would be an error at deploy
  // time at best, and at worst a setting that silently does nothing.
  assert.equal(config.$schema, './node_modules/wrangler/config-schema.json');
  const schema = readJson('../node_modules/wrangler/config-schema.json') as {
    definitions: { Observability: { properties: Record<string, { type?: string; description?: string; default?: unknown }> } };
  };
  const setting = schema.definitions.Observability.properties.redact_query_string;
  assert.ok(setting, 'observability.redact_query_string is in the schema');
  assert.equal(setting.type, 'boolean');
  assert.equal(setting.default, false, 'off unless asked for');
  assert.equal(setting.description, 'Whether query strings are removed from request URLs in logs and traces.');
  // Every key set under "observability" is one the schema has there.
  const known = Object.keys(schema.definitions.Observability.properties);
  for (const key of Object.keys(config.observability as object)) assert.ok(known.includes(key), key);
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

test("the settings carry their production values: the faucet's bot check is named, events are counted under the main site, and the pot counts are off", () => {
  // The site key is the public half of the bot check: every reader's browser is sent it.
  // The secret half is a secret of the deployed Worker, and appears nowhere in this repository.
  const siteKey = '0x4AAAAAAGB-u7njXBvccBZE';
  assert.deepEqual(config.vars, {
    ORIGIN_URL: 'https://practice-origin.learnbitcoin.com',
    TURNSTILE_SITE_KEY: siteKey,
    TURNSTILE_HOSTNAME: 'practice.learnbitcoin.com',
    EXPLORER_URL: 'https://practice-explorer.learnbitcoin.com',
    ELECTRUM_HOST: 'practice-electrum.learnbitcoin.com',
    ELECTRUM_PORT: '50002',
    PLAUSIBLE_DOMAIN: 'learnbitcoin.com',
    EVENT_PROPS: 'off',
    SITE_URL: 'https://www.learnbitcoin.com',
    SOURCE_URL: 'https://github.com/treib-holdings/learnbitcoin-practice',
    PASSKEY_HOST: 'practice.learnbitcoin.com',
    FAUCET_SATS: '100000',
    BLOCK_SECONDS: '30',
    POT_COUNTS: 'off',
  });
  // And they make a config the app can use.
  assert.deepEqual(configFromEnv(config.vars as ConfigVars), {
    turnstileSiteKey: siteKey,
    explorerUrl: 'https://practice-explorer.learnbitcoin.com',
    electrumHost: 'practice-electrum.learnbitcoin.com',
    electrumPort: 50002,
    siteUrl: 'https://www.learnbitcoin.com',
    sourceUrl: 'https://github.com/treib-holdings/learnbitcoin-practice',
    passkeyHost: 'practice.learnbitcoin.com',
    faucetSats: 100000,
    blockSeconds: 30,
    events: true,
    potCounts: false,
  });
});

test('the pot counts ship switched off, and the note at the setting says what off means and when it may be switched on', () => {
  const vars = config.vars as Record<string, unknown>;
  assert.equal(vars.POT_COUNTS, 'off');
  assert.equal(configFromEnv(vars as unknown as ConfigVars).potCounts, false);
  // The note is the comment that stands right above the setting: from the last setting before it to its own line.
  const from = source.indexOf('"BLOCK_SECONDS": "30",');
  const to = source.indexOf('"POT_COUNTS": "off"');
  assert.ok(from > 0 && to > from, 'POT_COUNTS is the last setting, after BLOCK_SECONDS');
  const note = source
    .slice(from, to)
    .split('\n')
    .map((line) => line.trim().replace(/^\/\/ ?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');
  // What it is, and that only one word switches it on.
  assert.match(note, /GET \/api\/pot\/stats/);
  assert.match(note, /"off", as it ships, or "on"\. Only the exact word "on" switches them on\./);
  // What off means: an unknown path, nothing counted, nobody asked, and the app does not ask.
  assert.match(note, /It answers a request for it as it answers any path it does not know/);
  assert.match(note, /It counts nothing at the limiter and asks the practice network nothing\./);
  assert.match(note, /the app does not ask for them/);
  assert.match(note, /No request can switch it on\./);
  // When it may be switched on.
  assert.match(note, /It may be switched on once the bots that run on the practice network's server keep their own reading of the counts/);
  assert.match(note, /Until it is live there, leave this off\./);
  // And what else has to change with it: the sentence of the About page that lists the requests the Worker writes a line for.
  assert.match(note, /A sentence of the app's About page changes with this setting\./);
  assert.match(note, /Switched on, the page asks, and the list must name "the pot's totals" \(serverLog in app\/src\/strings\/about\.ts, in both languages\)\./);
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
