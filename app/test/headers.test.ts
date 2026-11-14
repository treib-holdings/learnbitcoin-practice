// The headers every page of the app is served with (public/_headers).
//
// Cloudflare reads this file from the built app and adds its headers to each
// static response. It is the app's whole security policy, so a stray line or
// a quietly loosened value must not get past a review: this test pins the
// file's format and every value in it.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const SOURCE = new URL('../public/_headers', import.meta.url);
const BUILT = new URL('../dist/_headers', import.meta.url);

/** What a page may load, compared as one string. Directives are joined with "; ". */
const CSP = [
  // Nothing loads unless a line below allows it.
  "default-src 'none'",
  // The app's one bundle, and the faucet's bot check (loaded only when coins are asked for).
  "script-src 'self' https://challenges.cloudflare.com",
  // The app's one stylesheet. No <style> element and no style attribute.
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  // The app talks to its own /api/ and /p/ paths and to nothing else.
  "connect-src 'self'",
  // The bot check draws itself in a frame.
  'frame-src https://challenges.cloudflare.com',
  "base-uri 'none'",
  "form-action 'none'",
  // The wallet is never shown inside another page.
  "frame-ancestors 'none'",
].join('; ');

/** The headers of every path, in the order the file lists them. */
const EVERY_PATH: [name: string, value: string][] = [
  ['Content-Security-Policy', CSP],
  ['Referrer-Policy', 'no-referrer'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  [
    'Permissions-Policy',
    'publickey-credentials-create=(self), publickey-credentials-get=(self), camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
  ],
  ['Strict-Transport-Security', 'max-age=31536000'],
  ['X-Robots-Tag', 'noindex'],
];

/** One block of the file: a path, the headers it adds and the headers it takes away again. */
interface Rule {
  path: string;
  add: [name: string, value: string][];
  remove: string[];
}

// Cloudflare's limits for this file.
const MAX_RULES = 100;
const MAX_LINE = 2000;

/**
 * Reads a _headers file. A line is a path at the left edge, or under a path
 * and indented a "Name: value" pair or a "! Name" (which removes a header an
 * earlier block added). Empty lines separate blocks. Anything else fails,
 * comments included: this file holds the policy and nothing more.
 */
function parseHeaders(text: string): Rule[] {
  const rules: Rule[] = [];
  text.split('\n').forEach((line, index) => {
    if (line === '') return;
    const where = `line ${index + 1} (${JSON.stringify(line)})`;
    assert.ok(line.length <= MAX_LINE, `${where} is longer than ${MAX_LINE} characters`);

    const path = /^(\/\S*|https:\/\/\S+)$/.exec(line)?.[1];
    if (path !== undefined) {
      rules.push({ path, add: [], remove: [] });
      return;
    }
    const rule = rules.at(-1);
    assert.ok(rule, `${where} comes before any path`);

    const removed = /^[ \t]+! ([A-Za-z0-9-]+)$/.exec(line)?.[1];
    if (removed !== undefined) {
      rule.remove.push(removed);
      return;
    }
    const pair = /^[ \t]+([A-Za-z0-9-]+): (\S.*)$/.exec(line);
    if (pair?.[1] !== undefined && pair[2] !== undefined) {
      rule.add.push([pair[1], pair[2]]);
      return;
    }
    assert.fail(`${where} is not a path, a "Name: value" pair or a "! Name"`);
  });
  assert.ok(rules.length <= MAX_RULES, `${rules.length} rules, and the limit is ${MAX_RULES}`);
  return rules;
}

function checkHeadersFile(file: URL): void {
  const text = readFileSync(file, 'utf8');
  assert.ok(text.endsWith('\n'), 'the file ends with a newline');
  const rules = parseHeaders(text);

  // Two blocks, in this order: a "! Name" only removes what an earlier block added.
  assert.deepEqual(
    rules.map((rule) => rule.path),
    ['/*', '/'],
  );
  const [everyPath, home] = rules;
  assert.ok(everyPath && home);

  // The policy first and by itself, so a failure shows the two strings side by side.
  const csp = everyPath.add.filter(([name]) => name === 'Content-Security-Policy');
  assert.equal(csp.length, 1, 'exactly one Content-Security-Policy line');
  assert.equal(csp[0]?.[1], CSP);

  assert.deepEqual(everyPath.add, EVERY_PATH);
  assert.deepEqual(everyPath.remove, []);

  // The home page is the one page a search engine may list.
  assert.deepEqual(home.add, []);
  assert.deepEqual(home.remove, ['X-Robots-Tag']);
}

test('the parser refuses anything that is not a path, a pair or a removal', () => {
  assert.equal(parseHeaders('/*\n  X-Robots-Tag: noindex\n\n/\n  ! X-Robots-Tag\n').length, 2);
  for (const bad of [
    '# a comment\n',
    '/*\n  X-Robots-Tag noindex\n',
    '/*\nX-Robots-Tag: noindex\n',
    '  X-Robots-Tag: noindex\n',
    '/*\n  X-Robots-Tag:\n',
    '/*\n  !X-Robots-Tag\n',
    '/*\r\n  X-Robots-Tag: noindex\r\n',
    '/*\n  \n',
    `/*\n  X-Long: ${'a'.repeat(MAX_LINE)}\n`,
  ]) {
    assert.throws(() => parseHeaders(bad), assert.AssertionError, JSON.stringify(bad.slice(0, 40)));
  }
});

test('public/_headers: well formed, with exactly the reviewed policy', () => {
  checkHeadersFile(SOURCE);
});

test(
  'dist/_headers: the built copy says the same',
  { skip: existsSync(BUILT) ? false : 'no build here yet (pnpm build makes one)' },
  () => {
    checkHeadersFile(BUILT);
    assert.equal(readFileSync(BUILT, 'utf8'), readFileSync(SOURCE, 'utf8'));
  },
);
