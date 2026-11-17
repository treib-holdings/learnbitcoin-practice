// tools/live-check, both ways: it passes on the local server (the built
// app's headers and the Worker's real handler), and it fails, on the right
// line, when any one of its expectations is broken on purpose.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Handler } from '@learnbitcoin/practice-worker';
import { PAGE_CSP, WORKER_HEADERS, expectedHeaders, liveCheck, maxAgeOf, readExpectations, repositoryExpectations, type Check, type Expectations } from '../../tools/live-check/live-check.ts';
import { applyHeaderRules, parseHeadersFile } from '../src/serve.ts';
import { startStack, type Stack } from '../src/stack.ts';
import { APP_HEADERS, PAGE, scratchSite } from './scratch-site.ts';

const SCRIPT = fileURLToPath(new URL('../../tools/live-check/live-check.ts', import.meta.url));
const ROBOTS = readFileSync(new URL('../../app/public/robots.txt', import.meta.url), 'utf8');
/** The About page's string table, as the repository has it: what the build ships as /about.txt. */
const ABOUT = readFileSync(new URL('../../app/src/strings/about.ts', import.meta.url), 'utf8');
const EXPECT = repositoryExpectations();

/** The pages the check asks for, in the order it asks: a path of two parts, a path of one, the home page. */
const PAGES = ['/wallet/receive', '/about', '/'];

/** The policy's headers: every page carries them. */
const POLICY_NAMES = [
  'content-security-policy',
  'referrer-policy',
  'x-content-type-options',
  'cross-origin-opener-policy',
  'permissions-policy',
  'strict-transport-security',
];

/**
 * The check's name for its look at the pot's counts. It is made only while the site's settings say that the
 * counts are off, which is how the Worker ships and how the stack here runs.
 */
const POT_OFF = "GET /api/pot/stats (the settings say the pot's counts are off)";

/** The one check that is the pot's own: the answer is the answer of a path the Worker does not know. */
const POT_AS_UNKNOWN = `${POT_OFF}: answered as GET /api/no-such-path is`;

/** The answers of the Worker that the check looks at, in the order it asks for them. */
const WORKER_ANSWERS = [
  'GET /api/no-such-path',
  'GET /p/no-such-path',
  'GET /api/config',
  POT_OFF,
  'POST /api/pot/address from another site',
  'POST /api/pot/address from no page at all',
];

/** The name of one header's check, on every page. */
const onPages = (name: string) => PAGES.map((path) => `GET ${path}: ${name}`);

/** The About page's text file. It is a file of the app, under the headers its path is given: a path of one part. */
const ABOUT_FILE = 'GET /about.txt';
const ABOUT_TYPE = `${ABOUT_FILE}: 200, as text/plain; charset=utf-8`;
const ABOUT_TEXT = `${ABOUT_FILE}: the text of app/src/strings/about.ts`;
const ABOUT_UNLISTED = `${ABOUT_FILE} (must not be listed): x-robots-tag`;

/** The name of one header's check on every page, and on the text file after them. */
const onFiles = (name: string) => [...onPages(name), `${ABOUT_FILE}: ${name}`];

/** The names of the checks that the script states outright, whatever the file it reads says. */
const mustNotBeListed = (path: string) => `GET ${path} (must not be listed): x-robots-tag`;
const floor = (path: string) => `GET ${path} (the floor, as written in this script): strict-transport-security`;

/** Both checks on a page's Strict-Transport-Security, on every page: against the file, and against the floor. */
const bothOnPages = PAGES.flatMap((path) => [`GET ${path}: strict-transport-security`, floor(path)]);

let stack: Stack;
before(async () => {
  stack = await startStack();
});
after(async () => {
  await stack.close();
});

/**
 * A site that holds what the build ships (the app's headers, robots.txt and the About page's text file, and a
 * page), with the Worker's handler behind it. A file given as null is one the site does not have.
 */
const site = (files: Record<string, string | null> = {}, handler: Handler = stack.handler) => {
  const held = Object.entries({ 'robots.txt': ROBOTS, 'about.txt': ABOUT, ...files }).filter((file): file is [string, string] => file[1] !== null);
  return scratchSite(Object.fromEntries(held), handler);
};

const fronts: Server[] = [];
after(async () => {
  for (const front of fronts) {
    await new Promise<void>((resolve) => {
      front.close(() => resolve());
      front.closeAllConnections();
    });
  }
});

/**
 * A server that stands in front of a site as a host stands in front of the files it was given: every request is
 * handed on as it came and every answer back as it came, but for the headers of one path, which `change` alters.
 * (The local server takes a file's type from its own table, as Cloudflare does. This is how a test has a host
 * that sends a file under another type.)
 */
async function inFrontOf(base: string, path: string, change: (headers: Headers) => void): Promise<{ url: string }> {
  const front = createServer((request, response) => {
    const pass = async (): Promise<void> => {
      const headers = new Headers();
      for (let i = 0; i + 1 < request.rawHeaders.length; i += 2) {
        const name = request.rawHeaders[i]!.toLowerCase();
        // What belongs to this connection and not to the request is left to the next one.
        if (!['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding'].includes(name)) headers.append(name, request.rawHeaders[i + 1]!);
      }
      const sent: Buffer[] = [];
      for await (const chunk of request) sent.push(chunk as Buffer);
      const method = request.method ?? 'GET';
      const answer = await fetch(`${base}${request.url ?? '/'}`, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(sent),
        redirect: 'manual',
      });
      const body = Buffer.from(await answer.arrayBuffer());
      const out = new Headers(answer.headers);
      // The body is handed on as it was read here: whole, and not compressed.
      for (const name of ['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive']) out.delete(name);
      if (new URL(request.url ?? '/', base).pathname === path) change(out);
      response.statusCode = answer.status;
      for (const [name, value] of out) response.setHeader(name, value);
      response.end(body);
    };
    pass().catch(() => response.destroy());
  });
  fronts.push(front);
  await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', () => resolve()));
  return { url: `http://localhost:${(front.address() as AddressInfo).port}` };
}

/** The names of the checks that failed. */
const failed = (checks: Check[]) => checks.filter((check) => !check.ok).map((check) => check.name);

/** Runs the script itself, as the owner will. */
function run(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

test('what it expects: for each path what the app\'s own _headers file gives it, and the policy written out a second time', () => {
  // The home page: the policy, and no X-Robots-Tag.
  const home = expectedHeaders(EXPECT, '/');
  assert.deepEqual(home.map(([name]) => name), [...POLICY_NAMES, 'x-robots-tag']);
  assert.deepEqual(home.at(-1), ['x-robots-tag', null]);
  const policy = home.slice(0, -1);
  for (const [name, value] of policy) assert.equal(typeof value, 'string', name);
  // The policy in the script is, today, the policy in the file. Changing one without the other fails here first.
  assert.equal(policy[0]![1], PAGE_CSP);
  // Every other path, unless it begins with two slashes: the same policy, and noindex. One part or more, a file or not.
  for (const path of ['/about', '/about.txt', '/wallet', '/es', '/robots.txt', '/index.html', '/wallet/receive', '/es/', '/es/about', '/assets/x.js', '/do/hold-some']) {
    assert.deepEqual(expectedHeaders(EXPECT, path), [...policy, ['x-robots-tag', 'noindex']], path);
  }
  assert.equal(EXPECT.robots, ROBOTS);
  // The text file is held to the repository's own copy of the About page's strings, and to nothing shorter.
  assert.equal(EXPECT.about, ABOUT);
  assert.ok(ABOUT.includes('export const en = {') && ABOUT.includes('export const es: Record<keyof typeof en, string> = {') && ABOUT.length > 20_000, `${ABOUT.length} characters`);
});

test('a _headers file it cannot hold a site to is refused, with the reason', () => {
  assert.throws(() => readExpectations('/:part\n  X-Robots-Tag: noindex\n', ROBOTS, ABOUT), /no "\/\*" block/);
  assert.throws(() => readExpectations('/*\n  nonsense\n', ROBOTS, ABOUT), /cannot read the line/);
  // A rule for one host is refused, and not taken for a header named "https" in the block above it.
  assert.throws(() => readExpectations('/*\n  X-A: 1\nhttps://example.test/*\n  X-B: 2\n', ROBOTS, ABOUT), /is a rule for one host/);
  assert.throws(() => readExpectations('https://example.test/*\n  X-B: 2\n/*\n  X-A: 1\n', ROBOTS, ABOUT), /is a rule for one host/);
  // The app's file as it was first deployed. On the deployed site the home page kept the header this line takes away.
  assert.throws(
    () => readExpectations('/*\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex\n\n/\n  ! X-Robots-Tag\n', ROBOTS, ABOUT),
    /the line " {2}! X-Robots-Tag" takes a header away, and what a page must carry cannot be worked out from such a line/,
  );
  // Two blocks that match one of the pages and name the same header: its value would depend on the order they are applied in.
  assert.throws(() => readExpectations('/*\n  X-Robots-Tag: noindex\n/:part\n  X-Robots-Tag: nofollow\n', ROBOTS, ABOUT), /two blocks that match \/about name x-robots-tag/);
  assert.throws(() => readExpectations('/*\n  X-A: 1\n/*\n  X-B: 2\n', ROBOTS, ABOUT), /the path \/\* twice/);
  assert.throws(() => readExpectations('/*\n  X-A: 1\n/:a/:a\n  X-B: 2\n', ROBOTS, ABOUT), /no pattern can be made of the path \/:a\/:a/);
  // A path Cloudflare would read as another path than the one written. It applies the block to the path it read,
  // and this check would hold a site to the path as written. (What it reads each as: see test/serve.test.ts.)
  const rewritten: [written: string, read: string][] = [
    ['/wallet?tab=1', '/wallet'],
    ['/a/../about', '/about'],
    ['/caf\u00e9', '/caf%C3%A9'],
    ['/{id}', '/%7Bid%7D'],
  ];
  for (const [written, read] of rewritten) {
    assert.throws(
      () => readExpectations(`/*\n  X-A: 1\n${written}\n  X-B: 2\n`, ROBOTS, ABOUT),
      { message: `_headers: Cloudflare would read the path ${written} as ${read}, and what a page must carry cannot be worked out from the path as written` },
      written,
    );
  }
  // A path that is read as it is written is taken as before.
  for (const path of ['/:part', '/:part/*', '/assets/*', '/a.b', '/es/']) {
    assert.deepEqual(readExpectations(`/*\n  X-A: 1\n${path}\n  X-B: 2\n`, ROBOTS, ABOUT).blocks.map((block) => block.path), ['/*', path]);
  }
  // A block of the text file's own that names a header a block for every path of one part names too: refused
  // as it is for a page, before anything is asked.
  assert.throws(() => readExpectations(`${APP_HEADERS}\n/about.txt\n  X-Robots-Tag: none\n`, ROBOTS, ABOUT), /two blocks that match \/about\.txt name x-robots-tag/);
  // The same name twice in one block is one header, as Cloudflare reads it, and no fault.
  assert.deepEqual(expectedHeaders(readExpectations('/*\n  X-Robots-Tag: noindex\n  X-Robots-Tag: nofollow\n', ROBOTS, ABOUT), '/about'), [['x-robots-tag', 'noindex, nofollow']]);
});

test('it matches a path to a block as the local server does: the same headers for the same file and path', () => {
  // The check carries its own copy of Cloudflare's rule, so that it needs nothing but Node. The two copies must agree.
  const files = [
    APP_HEADERS,
    '/*\n  X-All: yes\n  X-All: twice\n/books/:id\n  X-Id: book-:id\n/:lang/wallet/*\n  X-Where: :lang|:splat\n/file-:name.txt\n  X-Name: :name\n/a:1\n  X-Colon: yes\n/\n  X-Home: yes\n',
  ];
  const paths = ['/', '/about', '/es', '/robots.txt', '/index.html', '/wallet/receive', '/es/', '/es/about', '/assets/x.js', '/do/hold-some'];
  const more = ['/books/7', '/books/7/', '/Books/7', '/books/a%2Fb', '/es/wallet/send/now', '/es/wallet/', '/es/wallet', '/file-a.b.txt', '/file-.txt', '/a:1', '/ax'];
  for (const file of files) {
    const expect = readExpectations(file, ROBOTS, ABOUT);
    for (const path of [...paths, ...more]) {
      const served = new Headers();
      applyHeaderRules(parseHeadersFile(file), path, served);
      const expected = expectedHeaders(expect, path).filter(([, value]) => value !== null);
      assert.deepEqual(Object.fromEntries(expected), Object.fromEntries(served), path);
    }
  }
  // Not an empty comparison: the second file gives these two paths something of their own.
  const second = readExpectations(files[1]!, ROBOTS, ABOUT);
  assert.deepEqual(expectedHeaders(second, '/books/7').filter(([, value]) => value !== null), [['x-all', 'yes, twice'], ['x-id', 'book-7']]);
  assert.deepEqual(expectedHeaders(second, '/es/wallet/send/now').filter(([, value]) => value !== null), [['x-all', 'yes, twice'], ['x-where', 'es|send/now']]);
});

test('Strict-Transport-Security is read strictly: one max-age in plain digits, and no directive twice', () => {
  const read: [value: string, seconds: number | null][] = [
    ['max-age=31536000', 31536000],
    // What the deployed site sends.
    ['max-age=31536000; includeSubDomains; preload', 31536000],
    ['max-age=63072000; includeSubDomains; preload', 63072000],
    // Directives come in any order, their names in any case, with spaces around them and a semicolon to end.
    ['includeSubDomains; max-age=31536000', 31536000],
    ['Max-Age=31536000 ; IncludeSubDomains', 31536000],
    ['max-age = 31536000;', 31536000],
    ['max-age=0', 0],
    // No max-age, or one that is no whole number of seconds in plain digits.
    ['', null],
    ['includeSubDomains; preload', null],
    ['max-age', null],
    ['max-age=', null],
    ['max-age=forever', null],
    ['max-age=-1', null],
    ['max-age=1.5', null],
    ['max-age=31536000 seconds', null],
    ['max-age="31536000"', null],
    ['max age=31536000', null],
    // A directive twice.
    ['max-age=31536000; max-age=31536000', null],
    ['max-age=31536000; preload; Preload', null],
    // Two headers of this name, as they arrive: joined by a comma.
    ['max-age=31536000, max-age=31536000; includeSubDomains; preload', null],
    ['max-age=31536000; includeSubDomains, max-age=31536000', null],
    // No value in quotes, whichever directive it belongs to: a comma inside quotes would let two headers pass as one.
    ['max-age=31536000; note="a"', null],
    ['max-age=31536000; note="a, b"', null],
    // includeSubDomains takes no value: given one, a browser sets the whole header aside.
    ['max-age=31536000; includeSubDomains=1', null],
    // Only a space and a tab are blanks. A no-break space is not, wherever it stands.
    ['max-age=31536000\u00a0', null],
    ['max-age=\u00a031536000', null],
    ['max-age\u00a0=31536000', null],
    ['max-age=31536000\u00a0; includeSubDomains; preload', null],
    ['max-age=31536000;\tincludeSubDomains', 31536000],
  ];
  for (const [value, seconds] of read) assert.equal(maxAgeOf(value), seconds, JSON.stringify(value));
});

test('it passes on the local server', async () => {
  const local = await site();
  const checks = await liveCheck(local.url, EXPECT);
  assert.deepEqual(failed(checks), []);
  assert.ok(checks.length >= 40, `${checks.length} checks`);
  // Every kind of expectation was looked at.
  const names = checks.map((check) => check.name).join('\n');
  for (const part of [
    'GET /wallet/receive: x-robots-tag',
    'GET /about: 200, and it is the app\'s page',
    'GET /about: x-robots-tag',
    'GET /about: strict-transport-security',
    'GET /: x-robots-tag is absent',
    'GET / (may be listed): x-robots-tag is absent',
    'GET /wallet/receive (must not be listed): x-robots-tag',
    'GET /about (must not be listed): x-robots-tag',
    '(the policy, as written in this script): content-security-policy',
    'GET /wallet/receive (the floor, as written in this script): strict-transport-security',
    'GET /about (the floor, as written in this script): strict-transport-security',
    'GET / (the floor, as written in this script): strict-transport-security',
    'GET /robots.txt: keeps crawlers out of /api/ and /p/',
    // The About page's text file: there, as plain text said to be UTF-8, the repository's text, and never listed.
    ABOUT_TYPE,
    ABOUT_TEXT,
    'GET /about.txt: content-security-policy',
    'GET /about.txt: x-content-type-options',
    'GET /about.txt: strict-transport-security',
    'GET /about.txt: x-robots-tag',
    ABOUT_UNLISTED,
    'GET /api/no-such-path: 404 {"error":"not_found"}',
    'GET /p/no-such-path: 404 {"error":"not_found"}',
    'GET /api/config: cache-control',
    // The one answer that is not a refusal carries the Worker's whole set too, and none may be read by another site's page.
    'GET /api/config: x-content-type-options',
    'GET /api/config: x-robots-tag',
    'GET /api/config: content-security-policy',
    'GET /api/config: strict-transport-security',
    'GET /api/config: access-control-allow-origin is absent',
    'GET /api/no-such-path: access-control-allow-origin is absent',
    'POST /api/pot/address from another site: access-control-allow-origin is absent',
    'POST /api/pot/address from another site: 403 {"error":"forbidden"}',
    'POST /api/pot/address from no page at all: 403 {"error":"forbidden"}',
    // The pot's counts are off, as the Worker ships: asked for, they are a path the Worker does not know.
    POT_AS_UNKNOWN,
    `${POT_OFF}: content-type`,
    `${POT_OFF}: cache-control`,
    `${POT_OFF}: x-robots-tag`,
    `${POT_OFF}: access-control-allow-origin is absent`,
  ]) {
    assert.ok(names.includes(part), part);
  }
  // That look was taken because the settings of this site say so: the stack runs on the settings of
  // worker/wrangler.jsonc, where the pot's counts are off.
  assert.equal(stack.config.potCounts, false);
  // Nothing was asked of the practice network, by that look or any other: the check only reads the Worker's own answers.
  assert.deepEqual(stack.network!.requests(), []);

  // The script itself: one line per check, a count, exit code 0.
  const ran = await run([`${local.url}/some/path?ignored`]);
  assert.equal(ran.code, 0, ran.out + ran.err);
  const lines = ran.out.trim().split('\n');
  assert.equal(lines.length, checks.length + 1);
  for (const line of lines.slice(0, -1)) assert.match(line, /^ok {4}\S/);
  assert.equal(lines.at(-1), `all ${checks.length} checks passed for ${local.url}`);
});

test('without an address it runs nothing and says how to call it', async () => {
  for (const args of [[], ['not a url']]) {
    const ran = await run(args);
    assert.equal(ran.code, 2);
    assert.match(ran.err, /^usage: node tools\/live-check\/live-check\.ts <base URL>/);
    assert.equal(ran.out, '');
  }
});

/** A _headers file with one line changed. */
const headersWith = (from: string | RegExp, to: string): string => {
  const changed = APP_HEADERS.replace(from, to);
  assert.notEqual(changed, APP_HEADERS, `nothing was changed by ${String(from)}`);
  return changed;
};

/** The Worker's handler, with one thing about its answers changed. */
const answering = (change: (response: Response, request: Request) => Response | Promise<Response>): Handler => {
  return async (request) => change(await stack.handler(request), request);
};
const withoutHeader = (name: string, onlyFor?: string): Handler =>
  answering((response, request) => {
    if (onlyFor !== undefined && new URL(request.url).pathname !== onlyFor) return response;
    const headers = new Headers(response.headers);
    headers.delete(name);
    return new Response(response.body, { status: response.status, headers });
  });
const withHeader = (name: string, value: string): Handler =>
  answering((response) => {
    const headers = new Headers(response.headers);
    headers.set(name, value);
    return new Response(response.body, { status: response.status, headers });
  });
/** The Worker's handler, with its answer to a request for the pot's counts made from its answer to that request as it is (an unknown path's). */
const potAnswered = (make: (unknown: Response) => Response): Handler =>
  answering((response, request) => (new URL(request.url).pathname === '/api/pot/stats' ? make(response) : response));
/** A handler that notes the path of every request it is asked, and hands each on. */
const noting = (inner: Handler): { handler: Handler; paths: string[] } => {
  const paths: string[] = [];
  return {
    paths,
    handler: (request) => {
      paths.push(new URL(request.url).pathname);
      return inner(request);
    },
  };
};

test('every expectation, broken one at a time, fails its own check', async () => {
  /** The same mistake in both places: in the copy that is served, and in the file the check reads what to expect from. */
  const inBoth = (headers: string) => ({ files: { _headers: headers }, expect: readExpectations(headers, ROBOTS, ABOUT) });
  const cases: { what: string; files?: Record<string, string | null>; handler?: Handler; expect?: Expectations; fails: (string | RegExp)[] }[] = [
    // -- the pages --
    {
      what: 'the pages are not the app (another page is served in its place)',
      files: { 'index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>another page</title></head><body></body></html>' },
      fails: PAGES.map((path) => `GET ${path}: 200, and it is the app's page`),
    },
    // -- the pages' headers --
    {
      what: 'a page header is missing',
      files: { _headers: headersWith('  Referrer-Policy: no-referrer\n', '') },
      fails: onFiles('referrer-policy'),
    },
    {
      what: 'a page header has another value',
      files: { _headers: headersWith('Cross-Origin-Opener-Policy: same-origin', 'Cross-Origin-Opener-Policy: unsafe-none') },
      fails: onFiles('cross-origin-opener-policy'),
    },
    {
      what: 'a permission is opened',
      files: { _headers: headersWith('camera=()', 'camera=(self)') },
      fails: onFiles('permissions-policy'),
    },
    {
      what: 'the policy is loosened by one word',
      files: { _headers: headersWith("style-src 'self'", "style-src 'self' 'unsafe-inline'") },
      fails: [
        ...PAGES.flatMap((path) => [`GET ${path}: content-security-policy`, `GET ${path} (the policy, as written in this script): content-security-policy`]),
        `${ABOUT_FILE}: content-security-policy`,
      ],
    },
    {
      what: 'no headers at all (the file did not reach the build)',
      files: { _headers: '/nowhere\n  X-Nothing: 1\n' },
      fails: [
        ...PAGES.flatMap((path) => [
          ...POLICY_NAMES.map((name) => `GET ${path}: ${name}`),
          // The home page is the one page that is right to come without this one.
          ...(path === '/' ? [] : [`GET ${path}: x-robots-tag`]),
          `GET ${path} (the policy, as written in this script): content-security-policy`,
          ...(path === '/' ? [] : [mustNotBeListed(path)]),
          floor(path),
        ]),
        // The text file is there and is the right text, and comes as bare as the pages.
        ...POLICY_NAMES.map((name) => `${ABOUT_FILE}: ${name}`),
        `${ABOUT_FILE}: x-robots-tag`,
        ABOUT_UNLISTED,
      ],
    },
    // -- the one header that may say more: it still has to be there, readable, and no shorter --
    {
      what: 'the pages come without Strict-Transport-Security',
      files: { _headers: headersWith('  Strict-Transport-Security: max-age=31536000\n', '') },
      fails: [...bothOnPages, `${ABOUT_FILE}: strict-transport-security`],
    },
    {
      what: 'the pages\' Strict-Transport-Security is one second shorter',
      files: { _headers: headersWith('max-age=31536000', 'max-age=31535999; includeSubDomains; preload') },
      fails: [...bothOnPages, `${ABOUT_FILE}: strict-transport-security`],
    },
    {
      what: 'the pages\' Strict-Transport-Security cannot be read',
      files: { _headers: headersWith('max-age=31536000', 'max-age=forever; includeSubDomains; preload') },
      fails: [...bothOnPages, `${ABOUT_FILE}: strict-transport-security`],
    },
    // A max-age made shorter in the file itself: served and read alike, so the site agrees with the file.
    // Only the floor in the script says no.
    {
      what: 'the max-age is one second shorter in the file itself (the same in what is served and in what the check reads)',
      ...inBoth(headersWith('max-age=31536000', 'max-age=31535999')),
      fails: PAGES.map(floor),
    },
    {
      what: 'the Worker\'s answers come without Strict-Transport-Security',
      handler: withoutHeader('Strict-Transport-Security'),
      fails: WORKER_ANSWERS.map((label) => `${label}: strict-transport-security`),
    },
    {
      what: 'the Worker\'s Strict-Transport-Security is shorter',
      handler: withHeader('Strict-Transport-Security', 'max-age=86400; includeSubDomains; preload'),
      fails: WORKER_ANSWERS.map((label) => `${label}: strict-transport-security`),
    },
    {
      what: 'the Worker\'s Strict-Transport-Security cannot be read (the header came twice)',
      handler: answering((response) => {
        const headers = new Headers(response.headers);
        headers.append('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        return new Response(response.body, { status: response.status, headers });
      }),
      fails: WORKER_ANSWERS.map((label) => `${label}: strict-transport-security`),
    },
    // -- which pages may be listed --
    {
      what: 'the home page is marked noindex too (what the first deploy sent)',
      files: { _headers: `${APP_HEADERS}\n/\n  X-Robots-Tag: noindex\n` },
      fails: ['GET /: x-robots-tag is absent', 'GET / (may be listed): x-robots-tag is absent'],
    },
    {
      what: 'no page is marked noindex',
      files: { _headers: headersWith('\n/:part\n  X-Robots-Tag: noindex\n\n/:part/*\n  X-Robots-Tag: noindex\n', '') },
      fails: ['GET /wallet/receive: x-robots-tag', mustNotBeListed('/wallet/receive'), 'GET /about: x-robots-tag', mustNotBeListed('/about'), `${ABOUT_FILE}: x-robots-tag`, ABOUT_UNLISTED],
    },
    {
      // The text file is a path of one part too: the block that marks /about marks it.
      what: 'a path of one part is not marked noindex',
      files: { _headers: headersWith('\n/:part\n  X-Robots-Tag: noindex\n', '') },
      fails: ['GET /about: x-robots-tag', mustNotBeListed('/about'), `${ABOUT_FILE}: x-robots-tag`, ABOUT_UNLISTED],
    },
    {
      what: 'a path of more than one part is not marked noindex',
      files: { _headers: headersWith('\n/:part/*\n  X-Robots-Tag: noindex\n', '') },
      fails: ['GET /wallet/receive: x-robots-tag', mustNotBeListed('/wallet/receive')],
    },
    {
      what: 'a page is marked in another way',
      files: { _headers: headersWith('/:part\n  X-Robots-Tag: noindex\n', '/:part\n  X-Robots-Tag: none\n') },
      fails: ['GET /about: x-robots-tag', mustNotBeListed('/about'), `${ABOUT_FILE}: x-robots-tag`, ABOUT_UNLISTED],
    },
    // The file itself marks the home page: served and read alike, so the site agrees with the file. Only
    // what the script states outright says no.
    {
      what: 'the file itself marks the home page too (the same in what is served and in what the check reads)',
      ...inBoth(`${APP_HEADERS}\n/\n  X-Robots-Tag: noindex\n`),
      fails: ['GET / (may be listed): x-robots-tag is absent'],
    },
    // A block deleted from the file itself: served and read alike, so the site agrees with the file, which
    // now says that the page comes without the mark. Only what the script states outright says no.
    {
      what: 'the "/:part" block is gone from the file itself (the same in what is served and in what the check reads)',
      ...inBoth(headersWith('\n/:part\n  X-Robots-Tag: noindex\n', '')),
      fails: [mustNotBeListed('/about'), ABOUT_UNLISTED],
    },
    {
      what: 'the "/:part/*" block is gone from the file itself (the same in what is served and in what the check reads)',
      ...inBoth(headersWith('\n/:part/*\n  X-Robots-Tag: noindex\n', '')),
      fails: [mustNotBeListed('/wallet/receive')],
    },
    {
      what: 'robots.txt lets crawlers into the Worker\'s paths',
      files: { 'robots.txt': 'User-agent: *\nAllow: /\n' },
      fails: ['GET /robots.txt: the text of app/public/robots.txt', 'GET /robots.txt: keeps crawlers out of /api/ and /p/'],
    },
    // -- the About page's text file --
    {
      // A host answers a path that names no file with the app's page: status 200, and nothing of the text.
      what: 'the About page\'s text file is not there (it did not reach the build)',
      files: { 'about.txt': null },
      fails: [ABOUT_TYPE, ABOUT_TEXT],
    },
    {
      what: 'the About page\'s text file is another text by one letter',
      files: { 'about.txt': ABOUT.replace('Qué guarda este navegador', 'Que guarda este navegador') },
      fails: [ABOUT_TEXT],
    },
    {
      what: 'the About page\'s text file is cut short',
      files: { 'about.txt': ABOUT.slice(0, -1) },
      fails: [ABOUT_TEXT],
    },
    // -- the Worker --
    {
      // With the pot's counts off their path is one of the unknown ones, so it gets the app too. It is then
      // answered as the other unknown path is, and that one check passes: what fails for it is every header.
      what: 'unknown /api/ paths get the app instead of the Worker (run_worker_first is missing)',
      handler: async (request) =>
        new URL(request.url).pathname.includes('no-such-path') || new URL(request.url).pathname === '/api/pot/stats'
          ? new Response(PAGE, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
          : stack.handler(request),
      fails: [/^GET \/api\/no-such-path: /, /^GET \/p\/no-such-path: /, /^GET \/api\/pot\/stats \(the settings say the pot's counts are off\): (?!answered as )/],
    },
    {
      what: 'the Worker\'s answers may be cached',
      handler: withoutHeader('Cache-Control'),
      fails: WORKER_ANSWERS.map((label) => `${label}: cache-control`),
    },
    {
      what: 'the Worker\'s answers may be listed by a search engine',
      handler: withoutHeader('X-Robots-Tag'),
      fails: WORKER_ANSWERS.map((label) => `${label}: x-robots-tag`),
    },
    // The config is the one answer here that is not a refusal. A header lost on that answer alone must show.
    ...Object.keys(WORKER_HEADERS).map((name) => ({
      what: `the config alone comes without ${name}`,
      handler: withoutHeader(name, '/api/config'),
      fails: [`GET /api/config: ${name}`],
    })),
    {
      what: 'the config alone is not JSON by its type',
      handler: answering((response, request) => {
        if (new URL(request.url).pathname !== '/api/config') return response;
        const headers = new Headers(response.headers);
        headers.set('Content-Type', 'text/plain');
        return new Response(response.body, { status: response.status, headers });
      }),
      fails: ['GET /api/config: content-type'],
    },
    {
      what: 'any site\'s page may read the Worker\'s answers',
      handler: answering((response) => {
        const headers = new Headers(response.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(response.body, { status: response.status, headers });
      }),
      fails: WORKER_ANSWERS.map((label) => `${label}: access-control-allow-origin is absent`),
    },
    {
      what: 'the config alone is opened to one other site (the header a later phase may add to the chain reads, come too early)',
      handler: answering((response, request) => {
        if (new URL(request.url).pathname !== '/api/config') return response;
        const headers = new Headers(response.headers);
        headers.set('Access-Control-Allow-Origin', 'https://learnbitcoin.com');
        return new Response(response.body, { status: response.status, headers });
      }),
      fails: ['GET /api/config: access-control-allow-origin is absent'],
    },
    {
      what: 'the config is not JSON',
      handler: answering((response, request) =>
        new URL(request.url).pathname === '/api/config' ? new Response('<html>', { status: 200, headers: response.headers }) : response,
      ),
      fails: ['GET /api/config: 200, with every setting'],
    },
    {
      what: 'the config lost a setting',
      handler: answering(async (response, request) => {
        if (new URL(request.url).pathname !== '/api/config') return response;
        const { blockSeconds: _dropped, ...rest } = (await response.json()) as Record<string, unknown>;
        return new Response(JSON.stringify(rest), { status: 200, headers: response.headers });
      }),
      fails: ['GET /api/config: 200, with every setting'],
    },
    // -- the pot's counts, which the settings say are off --
    {
      what: 'the pot\'s counts are answered while the settings say that they are off',
      handler: potAnswered((unknown) => new Response(JSON.stringify({ passedOn: 3, waiting: 1, handedOn: 2 }), { status: 200, headers: unknown.headers })),
      fails: [POT_AS_UNKNOWN],
    },
    {
      what: 'the pot\'s counts are refused in a way of their own: the status of an unknown path, and another body',
      handler: potAnswered((unknown) => new Response(JSON.stringify({ error: 'switched_off' }), { status: 404, headers: unknown.headers })),
      fails: [POT_AS_UNKNOWN],
    },
    {
      what: 'the pot\'s counts are refused in a way of their own: the body of an unknown path, and another status',
      handler: potAnswered((unknown) => new Response(unknown.body, { status: 403, headers: unknown.headers })),
      fails: [POT_AS_UNKNOWN],
    },
    {
      what: 'the pot\'s counts are answered as an unknown path is, and may be cached',
      handler: withoutHeader('Cache-Control', '/api/pot/stats'),
      fails: [`${POT_OFF}: cache-control`],
    },
    {
      what: 'a POST from another site is answered',
      handler: (request) => {
        // As if the Worker took the sender at its word.
        const headers = new Headers(request.headers);
        if (headers.get('Origin')) headers.set('Origin', new URL(request.url).origin);
        return stack.handler(new Request(request.url, { method: request.method, headers }));
      },
      fails: ['POST /api/pot/address from another site: 403 {"error":"forbidden"}'],
    },
    {
      what: 'a POST from no page at all is answered',
      handler: (request) => {
        const headers = new Headers(request.headers);
        if (!headers.get('Origin')) headers.set('Sec-Fetch-Site', 'same-origin');
        return stack.handler(new Request(request.url, { method: request.method, headers }));
      },
      fails: ['POST /api/pot/address from no page at all: 403 {"error":"forbidden"}'],
    },
  ];

  for (const broken of cases) {
    const local = await site(broken.files, broken.handler);
    const names = failed(await liveCheck(local.url, broken.expect ?? EXPECT));
    if (broken.fails.every((each) => typeof each === 'string')) {
      assert.deepEqual(names, broken.fails, broken.what);
    } else {
      // A whole answer of the wrong kind: every check on it fails, and no other.
      assert.ok(names.length > 0, broken.what);
      for (const name of names) assert.ok(broken.fails.some((each) => (each as RegExp).test(name)), `${broken.what}: ${name}`);
      for (const each of broken.fails) assert.ok(names.some((name) => (each as RegExp).test(name)), `${broken.what}: ${String(each)}`);
    }
  }

  // The script itself says FAIL, with what it expected and what came, and exits with 1.
  const local = await site({ _headers: headersWith('Referrer-Policy: no-referrer', 'Referrer-Policy: unsafe-url') });
  const ran = await run([local.url]);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /^FAIL {2}GET \/wallet\/receive: referrer-policy: expected "no-referrer", got "unsafe-url"$/m);
  assert.match(ran.out, /^FAIL {2}GET \/about: referrer-policy: expected "no-referrer", got "unsafe-url"$/m);
  assert.match(ran.out, /^FAIL {2}GET \/about\.txt: referrer-policy: expected "no-referrer", got "unsafe-url"$/m);
  assert.match(ran.out, /^4 of [0-9]+ checks FAILED for http:\/\/localhost:[0-9]+$/m);
});

test('the About page\'s text file: there, the repository\'s text to the character, and under one type to the letter', async () => {
  // -- As the build ships it: every check on the file passes, and each was made. --
  const shipped = await site();
  const made = (await liveCheck(shipped.url, EXPECT)).filter((check) => check.name.startsWith(ABOUT_FILE));
  assert.deepEqual(failed(made), []);
  assert.deepEqual(
    made.map((check) => check.name),
    [ABOUT_TYPE, ABOUT_TEXT, ...POLICY_NAMES.map((name) => `${ABOUT_FILE}: ${name}`), `${ABOUT_FILE}: x-robots-tag`, ABOUT_UNLISTED],
  );
  // What the local server sends for it is what the check asks for: the type of a text file as Cloudflare names it.
  const sent = await fetch(`${shipped.url}/about.txt`);
  assert.deepEqual([sent.status, sent.headers.get('content-type'), sent.headers.get('x-robots-tag')], [200, 'text/plain; charset=utf-8', 'noindex']);
  assert.equal(await sent.text(), ABOUT);

  // -- A site without the file. The host answers with the app's page, as it answers every path that names no
  //    file: status 200, so only the type and the text say that the file is not there. Both fail, and say what came. --
  const without = await site({ 'about.txt': null });
  const missing = (await liveCheck(without.url, EXPECT)).filter((check) => !check.ok);
  assert.deepEqual(missing, [
    { name: ABOUT_TYPE, ok: false, detail: 'status 200, type "text/html; charset=utf-8"' },
    {
      name: ABOUT_TEXT,
      ok: false,
      detail: `${PAGE.length} characters came, ${ABOUT.length} were expected; they differ from character 0: got ${JSON.stringify(PAGE.slice(0, 80))}`,
    },
  ]);

  // -- Another text. One letter of the Spanish half lost its accent: the check names the place. --
  const at = ABOUT.indexOf('Qué guarda este navegador') + 2;
  assert.ok(at > 2);
  const plain = `${ABOUT.slice(0, at)}e${ABOUT.slice(at + 1)}`;
  const other = (await liveCheck((await site({ 'about.txt': plain })).url, EXPECT)).filter((check) => !check.ok);
  assert.deepEqual(other, [
    { name: ABOUT_TEXT, ok: false, detail: `${ABOUT.length} characters came, ${ABOUT.length} were expected; they differ from character ${at}: got ${JSON.stringify(plain.slice(at, at + 80))}` },
  ]);

  // -- The right text under another type. The host decides the type, and half of the file is Spanish: a browser
  //    that is not told the file is UTF-8 may show its accented letters broken. Every other check passes. --
  const types: [sent: string | null, shown: string][] = [
    // Plain text, and nothing said about how its letters are written.
    ['text/plain', '"text/plain"'],
    ['text/plain; charset=iso-8859-1', '"text/plain; charset=iso-8859-1"'],
    ['text/plain; charset=utf-8; format=flowed', '"text/plain; charset=utf-8; format=flowed"'],
    // What a host sends for a kind of file it does not know, and a file sent as the source it is a copy of.
    ['application/octet-stream', '"application/octet-stream"'],
    ['text/typescript; charset=utf-8', '"text/typescript; charset=utf-8"'],
    // No type at all.
    [null, 'no such header'],
  ];
  for (const [type, shown] of types) {
    const front = await inFrontOf(shipped.url, '/about.txt', (headers) => {
      if (type === null) headers.delete('content-type');
      else headers.set('content-type', type);
    });
    // The file is the same, to the byte, and so is every other answer of the site.
    const got = await fetch(`${front.url}/about.txt`);
    assert.deepEqual([got.status, got.headers.get('content-type'), await got.text()], [200, type, ABOUT], String(type));
    assert.deepEqual(
      (await liveCheck(front.url, EXPECT)).filter((check) => !check.ok),
      [{ name: ABOUT_TYPE, ok: false, detail: `status 200, type ${shown}` }],
      String(type),
    );
  }
  // The server in front changes nothing else: with the type left alone, every check passes through it.
  const untouched = await inFrontOf(shipped.url, '/about.txt', () => {});
  const through = await liveCheck(untouched.url, EXPECT);
  assert.deepEqual(failed(through), []);
  assert.equal(through.length, (await liveCheck(shipped.url, EXPECT)).length);

  // -- The script itself, on a site without the file: two lines that say FAIL, and exit code 1. --
  const ran = await run([without.url]);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /^FAIL {2}GET \/about\.txt: 200, as text\/plain; charset=utf-8: status 200, type "text\/html; charset=utf-8"$/m);
  assert.match(ran.out, /^FAIL {2}GET \/about\.txt: the text of app\/src\/strings\/about\.ts: [0-9]+ characters came, [0-9]+ were expected; they differ from character 0: got "<!doctype html>/m);
  assert.match(ran.out, /^2 of [0-9]+ checks FAILED for http:\/\/localhost:[0-9]+$/m);
});

test('Strict-Transport-Security: a max-age as long as ours passes, and so does a longer one with more behind it', async () => {
  // Ours as our files send it, ours as the deployed site sends it, and a longer one. On the deployed site every
  // answer carries "max-age=31536000; includeSubDomains; preload", and so does the main site on the same domain,
  // which this repository does not serve: so the header is put on after the Worker has answered.
  for (const value of ['max-age=31536000', 'max-age=31536000; includeSubDomains; preload', 'max-age=63072000; includeSubDomains; preload']) {
    const local = await site({ _headers: APP_HEADERS.replace('max-age=31536000', value) }, withHeader('Strict-Transport-Security', value));
    const checks = await liveCheck(local.url, EXPECT);
    assert.deepEqual(failed(checks), [], value);
    // The value that was looked at is the one this test sent, on every answer: the three pages and the Worker's six.
    for (const path of [...PAGES, '/about.txt', '/api/config', '/api/no-such-path']) {
      assert.equal((await fetch(`${local.url}${path}`)).headers.get('strict-transport-security'), value, `${path}: ${value}`);
    }
    // Each page's is looked at twice: against the file, and against the floor in the script. The text file's once.
    assert.equal(checks.filter((check) => check.name.endsWith(': strict-transport-security')).length, 2 * PAGES.length + 1 + WORKER_ANSWERS.length, value);
  }

  // A failed one says what was expected and what came.
  const shorter = await site({ _headers: headersWith('max-age=31536000', 'max-age=600') });
  const check = (await liveCheck(shorter.url, EXPECT)).find((each) => each.name === 'GET /about: strict-transport-security');
  assert.deepEqual([check?.ok, check?.detail], [false, 'expected "max-age=31536000" or a longer max-age, got "max-age=600"']);
  const missing = await site({ _headers: headersWith('  Strict-Transport-Security: max-age=31536000\n', '') });
  const absent = (await liveCheck(missing.url, EXPECT)).find((each) => each.name === 'GET /about: strict-transport-security');
  assert.deepEqual([absent?.ok, absent?.detail], [false, 'expected "max-age=31536000" or a longer max-age, got no such header']);
});

test('the first deploy, as it answered: the longer Strict-Transport-Security passes, and the home page\'s mark is all that fails', async () => {
  // Every answer came with "max-age=31536000; includeSubDomains; preload", and the home page with "X-Robots-Tag: noindex".
  const sent = 'max-age=31536000; includeSubDomains; preload';
  const local = await site({ _headers: `${APP_HEADERS.replace('max-age=31536000', sent)}\n/\n  X-Robots-Tag: noindex\n` }, withHeader('Strict-Transport-Security', sent));
  assert.equal((await fetch(`${local.url}/`)).headers.get('x-robots-tag'), 'noindex');
  assert.deepEqual(failed(await liveCheck(local.url, EXPECT)), ['GET /: x-robots-tag is absent', 'GET / (may be listed): x-robots-tag is absent']);
});

test('every other header is still compared letter for letter: more behind the expected value fails', async () => {
  const local = await site({ _headers: headersWith('Referrer-Policy: no-referrer', 'Referrer-Policy: no-referrer, strict-origin') }, withHeader('X-Robots-Tag', 'noindex, nofollow'));
  assert.deepEqual(failed(await liveCheck(local.url, EXPECT)), [...onFiles('referrer-policy'), ...WORKER_ANSWERS.map((label) => `${label}: x-robots-tag`)]);
});

test('the pot\'s counts: asked for only while the settings say that they are off, and then held to the answer of an unknown path', async () => {
  // -- Off, as the Worker ships: one request, answered as GET /api/no-such-path is, and the practice network is asked nothing. --
  // (The stack is the one every test of this file uses: what the network was asked before this test is set aside.)
  const askedBefore = stack.network!.requests().length;
  const off = noting(stack.handler);
  const shipped = await site({}, off.handler);
  const checks = await liveCheck(shipped.url, EXPECT);
  assert.deepEqual(failed(checks), []);
  assert.equal(off.paths.filter((path) => path === '/api/pot/stats').length, 1);
  assert.equal(off.paths.filter((path) => path === '/api/no-such-path').length, 1);
  const pot = checks.filter((check) => check.name.startsWith(`${POT_OFF}: `)).map((check) => check.name);
  assert.deepEqual(pot, [POT_AS_UNKNOWN, `${POT_OFF}: content-type`, ...Object.keys(WORKER_HEADERS).map((name) => `${POT_OFF}: ${name}`), `${POT_OFF}: access-control-allow-origin is absent`]);
  // What it is held to is what this site answers for a path nobody knows, letter for letter.
  const [unknown, counts] = await Promise.all(['/api/no-such-path', '/api/pot/stats'].map((path) => fetch(`${shipped.url}${path}`)));
  assert.deepEqual([counts!.status, await counts!.text()], [unknown!.status, await unknown!.text()]);
  assert.equal(unknown!.status, 404);
  assert.deepEqual(stack.network!.requests().slice(askedBefore), [], 'asked that way, a look at the counts costs the practice network nothing');
  // A failed one says what was expected and what came.
  const answered = await site({}, potAnswered((response) => new Response('{"passedOn":3,"waiting":1,"handedOn":2}', { status: 200, headers: response.headers })));
  const check = (await liveCheck(answered.url, EXPECT)).find((each) => each.name === POT_AS_UNKNOWN);
  assert.deepEqual([check?.ok, check?.detail], [false, 'expected status 404, body "{\\"error\\":\\"not_found\\"}"; got status 200, body "{\\"passedOn\\":3,\\"waiting\\":1,\\"handedOn\\":2}"']);

  // -- On: the settings say that the counts can be had. The check does not ask for them: an answered look can
  //    cost the practice network a reading of the pot's coins, and a check from outside must cost it nothing. --
  const on = await startStack({ vars: { POT_COUNTS: 'on' } });
  try {
    assert.equal(on.config.potCounts, true);
    const asked = noting(on.handler);
    const local = await site({}, asked.handler);
    const withCounts = await liveCheck(local.url, EXPECT);
    assert.deepEqual(failed(withCounts), []);
    assert.deepEqual(asked.paths.filter((path) => path.startsWith('/api/pot/')), ['/api/pot/address', '/api/pot/address'], 'the two refused POSTs, and no look at the counts');
    assert.deepEqual(withCounts.filter((each) => each.name.includes('/api/pot/stats')), []);
    assert.equal(withCounts.length, checks.length - pot.length, 'every other check is made as before');
    assert.deepEqual(on.network!.requests(), []);
  } finally {
    await on.close();
  }

  // -- Not known: settings that could not be read, or that do not say. Nothing is asked then either: only a
  //    plain "false" counts as off. (The settings' own check fails, which is the news.) --
  const unreadable: [what: string, change: (settings: Record<string, unknown>) => unknown][] = [
    ['the setting is missing', ({ potCounts: _dropped, ...rest }) => rest],
    ['the setting is a word', (settings) => ({ ...settings, potCounts: 'off' })],
    ['the setting is null', (settings) => ({ ...settings, potCounts: null })],
    ['the settings are no object', () => 'off'],
  ];
  for (const [what, change] of unreadable) {
    const asked = noting(
      answering(async (response, request) => {
        if (new URL(request.url).pathname !== '/api/config') return response;
        return new Response(JSON.stringify(change((await response.json()) as Record<string, unknown>)), { status: 200, headers: response.headers });
      }),
    );
    const local = await site({}, asked.handler);
    assert.deepEqual(failed(await liveCheck(local.url, EXPECT)), ['GET /api/config: 200, with every setting'], what);
    assert.ok(!asked.paths.includes('/api/pot/stats'), what);
  }
  // The same for settings that say "false" under a status that is no answer to the question.
  const refused = noting(
    answering((response, request) => (new URL(request.url).pathname === '/api/config' ? new Response(response.body, { status: 503, headers: response.headers }) : response)),
  );
  assert.deepEqual(failed(await liveCheck((await site({}, refused.handler)).url, EXPECT)), ['GET /api/config: 200, with every setting']);
  assert.ok(!refused.paths.includes('/api/pot/stats'));
});

test('the settings it expects are every setting the Worker answers with: each one taken away, or given the wrong kind of value, is named as missing or of the wrong kind', async () => {
  // The check carries its own list of the settings, so that it needs nothing but Node. What holds that list
  // to the contract is this: the keys of the Worker's own answer, one at a time.
  const answer = (await (await stack.handler(new Request('http://localhost/api/config'))).json()) as Record<string, unknown>;
  const keys = Object.keys(answer);
  assert.deepEqual(keys, Object.keys(stack.config));
  assert.ok(keys.includes('potCounts') && keys.length >= 11, keys.join(', '));
  /** A value of another kind than the one it is given: a number for a text, a text for a number or for yes and no. */
  const wrongKind = (value: unknown): unknown => (typeof value === 'string' ? 7 : String(value));
  for (const key of keys) {
    for (const [what, change] of [
      ['missing', (settings: Record<string, unknown>) => Object.fromEntries(Object.entries(settings).filter(([name]) => name !== key))],
      ['of the wrong kind', (settings: Record<string, unknown>) => ({ ...settings, [key]: wrongKind(settings[key]) })],
    ] as const) {
      const local = await site(
        {},
        answering(async (response, request) => {
          if (new URL(request.url).pathname !== '/api/config') return response;
          return new Response(JSON.stringify(change((await response.json()) as Record<string, unknown>)), { status: 200, headers: response.headers });
        }),
      );
      const found = (await liveCheck(local.url, EXPECT)).find((each) => each.name === 'GET /api/config: 200, with every setting');
      assert.deepEqual([found?.ok, found?.detail], [false, `status 200; missing or of the wrong kind: ${key}`], `${key}, ${what}`);
    }
  }
});

test('a server that is not there fails every request, and the run', async () => {
  const local = await site();
  await local.close();
  const checks = await liveCheck(local.url, EXPECT);
  assert.ok(checks.length >= 7);
  assert.deepEqual(failed(checks), checks.map((check) => check.name));
  assert.match(checks[0]!.detail, /the request failed/);
  assert.equal((await run([local.url])).code, 1);
});

test('the Worker\'s headers it expects are the ones the Worker sends', async () => {
  const answer = await stack.handler(new Request('http://localhost/api/no-such-path'));
  for (const [name, value] of Object.entries(WORKER_HEADERS)) assert.equal(answer.headers.get(name), value, name);
});
