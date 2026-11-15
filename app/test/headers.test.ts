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

/** The policy: the headers of every path, in the order the file lists them. */
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
];

/** What keeps a page out of a search engine's list. Every path carries it but "/" and a path that begins with two slashes. */
const NOT_LISTED: [name: string, value: string][] = [['X-Robots-Tag', 'noindex']];

/** One block of the file: a path and the headers it adds. */
interface Rule {
  path: string;
  add: [name: string, value: string][];
}

// Cloudflare's limits for this file.
const MAX_RULES = 100;
const MAX_LINE = 2000;

/**
 * Reads a _headers file. A line is a path at the left edge, or under a path
 * and indented a "Name: value" pair. Empty lines separate blocks, and a line
 * that starts with "#" at the left edge is a comment. Anything else fails:
 * this file holds the policy, the reason for its shape, and nothing more.
 *
 * A "! Name" line fails too. Cloudflare takes one: it removes a header that
 * another block added. But on the deployed site the home page kept a header
 * that such a line was there to remove, so a block may only add.
 */
function parseHeaders(text: string): Rule[] {
  const rules: Rule[] = [];
  text.split('\n').forEach((line, index) => {
    if (line === '' || line.startsWith('#')) return;
    const where = `line ${index + 1} (${JSON.stringify(line)})`;
    assert.ok(line.length <= MAX_LINE, `${where} is longer than ${MAX_LINE} characters`);

    const path = /^(\/\S*|https:\/\/\S+)$/.exec(line)?.[1];
    if (path !== undefined) {
      rules.push({ path, add: [] });
      return;
    }
    const rule = rules.at(-1);
    assert.ok(rule, `${where} comes before any path`);

    assert.ok(!/^[ \t]+! /.test(line), `${where} removes a header, and a block may only add`);
    const pair = /^[ \t]+([A-Za-z0-9-]+): (\S.*)$/.exec(line);
    if (pair?.[1] !== undefined && pair[2] !== undefined) {
      rule.add.push([pair[1], pair[2]]);
      return;
    }
    assert.fail(`${where} is not a path or a "Name: value" pair`);
  });
  assert.ok(rules.length <= MAX_RULES, `${rules.length} rules, and the limit is ${MAX_RULES}`);
  return rules;
}

function checkHeadersFile(file: URL): void {
  const text = readFileSync(file, 'utf8');
  assert.ok(text.endsWith('\n'), 'the file ends with a newline');
  const rules = parseHeaders(text);

  // Three blocks. Every path gets the policy. Two blocks mark a path
  // noindex: ":part" is one or more characters that are not a slash, so
  // "/:part" is every path of one part, and "/:part/*" every path of one
  // part, a slash and whatever follows. Together they are every path except
  // "/" and a path that begins with two slashes, which no page or file of
  // the app has. No path gets one header from two blocks, so the order the
  // blocks are applied in cannot change what a path carries.
  assert.deepEqual(
    rules.map((rule) => rule.path),
    ['/*', '/:part', '/:part/*'],
  );
  const [everyPath, onePart, longer] = rules;
  assert.ok(everyPath && onePart && longer);

  // The policy first and by itself, so a failure shows the two strings side by side.
  const csp = everyPath.add.filter(([name]) => name === 'Content-Security-Policy');
  assert.equal(csp.length, 1, 'exactly one Content-Security-Policy line');
  assert.equal(csp[0]?.[1], CSP);

  assert.deepEqual(everyPath.add, EVERY_PATH);

  // The home page is the one page a search engine may list: the mark is in no block that matches "/".
  assert.deepEqual(onePart.add, NOT_LISTED);
  assert.deepEqual(longer.add, NOT_LISTED);
}

test('the parser refuses anything that is not a path, a pair or a comment', () => {
  assert.equal(parseHeaders('# why\n/*\n  X-Content-Type-Options: nosniff\n\n# and why\n/:part\n  X-Robots-Tag: noindex\n').length, 2);
  for (const bad of [
    '/*\n  # a comment that is not at the left edge\n',
    '/*\n  ! X-Robots-Tag\n',
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
