// tools/live-check, both ways: it passes on the local server (the built
// app's headers and the Worker's real handler), and it fails, on the right
// line, when any one of its expectations is broken on purpose.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Handler } from '@learnbitcoin/practice-worker';
import { PAGE_CSP, WORKER_HEADERS, liveCheck, readExpectations, repositoryExpectations, type Check } from '../../tools/live-check/live-check.ts';
import { startStack, type Stack } from '../src/stack.ts';
import { APP_HEADERS, PAGE, scratchSite } from './scratch-site.ts';

const SCRIPT = fileURLToPath(new URL('../../tools/live-check/live-check.ts', import.meta.url));
const ROBOTS = readFileSync(new URL('../../app/public/robots.txt', import.meta.url), 'utf8');
const EXPECT = repositoryExpectations();

let stack: Stack;
before(async () => {
  stack = await startStack();
});
after(async () => {
  await stack.close();
});

/** A site that holds what the build ships (the app's headers and robots.txt, and a page), with the Worker's handler behind it. */
const site = (files: Record<string, string> = {}, handler: Handler = stack.handler) =>
  scratchSite({ 'robots.txt': ROBOTS, ...files }, handler);

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

test('what it expects: the app\'s own _headers file, and the policy written out a second time', () => {
  assert.deepEqual(EXPECT.everyPage.map(([name]) => name), [
    'content-security-policy',
    'referrer-policy',
    'x-content-type-options',
    'cross-origin-opener-policy',
    'permissions-policy',
    'strict-transport-security',
    'x-robots-tag',
  ]);
  assert.deepEqual(EXPECT.notOnHome, ['x-robots-tag']);
  // The policy in the script is, today, the policy in the file. Changing one without the other fails here first.
  assert.equal(EXPECT.everyPage[0]![1], PAGE_CSP);
  assert.equal(EXPECT.robots, ROBOTS);
  assert.throws(() => readExpectations('/\n  ! X-Robots-Tag\n', ROBOTS), /no "\/\*" block/);
  assert.throws(() => readExpectations('/*\n  nonsense\n', ROBOTS), /cannot read the line/);
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
    'GET /: x-robots-tag is absent',
    '(the policy, as written in this script): content-security-policy',
    'GET /robots.txt: keeps crawlers out of /api/ and /p/',
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
  ]) {
    assert.ok(names.includes(part), part);
  }
  // Nothing was asked of the practice network: the check only reads the Worker's own answers.
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

test('every expectation, broken one at a time, fails its own check', async () => {
  const cases: { what: string; files?: Record<string, string>; handler?: Handler; fails: (string | RegExp)[] }[] = [
    // -- the pages' headers --
    {
      what: 'a page header is missing',
      files: { _headers: headersWith('  Referrer-Policy: no-referrer\n', '') },
      fails: ['GET /wallet/receive: referrer-policy', 'GET /: referrer-policy'],
    },
    {
      what: 'a page header has another value',
      files: { _headers: headersWith('Cross-Origin-Opener-Policy: same-origin', 'Cross-Origin-Opener-Policy: unsafe-none') },
      fails: ['GET /wallet/receive: cross-origin-opener-policy', 'GET /: cross-origin-opener-policy'],
    },
    {
      what: 'a permission is opened',
      files: { _headers: headersWith('camera=()', 'camera=(self)') },
      fails: ['GET /wallet/receive: permissions-policy', 'GET /: permissions-policy'],
    },
    {
      what: 'the policy is loosened by one word',
      files: { _headers: headersWith("style-src 'self'", "style-src 'self' 'unsafe-inline'") },
      fails: [
        'GET /wallet/receive: content-security-policy',
        'GET /wallet/receive (the policy, as written in this script): content-security-policy',
        'GET /: content-security-policy',
        'GET / (the policy, as written in this script): content-security-policy',
      ],
    },
    {
      what: 'no headers at all (the file did not reach the build)',
      files: { _headers: '/nowhere\n  X-Nothing: 1\n' },
      fails: [
        ...EXPECT.everyPage.map(([name]) => `GET /wallet/receive: ${name}`),
        'GET /wallet/receive (the policy, as written in this script): content-security-policy',
        ...EXPECT.everyPage.filter(([name]) => name !== 'x-robots-tag').map(([name]) => `GET /: ${name}`),
        'GET / (the policy, as written in this script): content-security-policy',
      ],
    },
    // -- which pages may be listed --
    {
      what: 'the home page is marked noindex too',
      files: { _headers: headersWith('\n/\n  ! X-Robots-Tag\n', '\n') },
      fails: ['GET /: x-robots-tag is absent', 'GET / (may be listed): x-robots-tag is absent'],
    },
    {
      what: 'no page is marked noindex',
      files: { _headers: headersWith('  X-Robots-Tag: noindex\n\n/\n  ! X-Robots-Tag\n', '') },
      fails: ['GET /wallet/receive: x-robots-tag'],
    },
    {
      what: 'robots.txt lets crawlers into the Worker\'s paths',
      files: { 'robots.txt': 'User-agent: *\nAllow: /\n' },
      fails: ['GET /robots.txt: the text of app/public/robots.txt', 'GET /robots.txt: keeps crawlers out of /api/ and /p/'],
    },
    // -- the Worker --
    {
      what: 'unknown /api/ paths get the app instead of the Worker (run_worker_first is missing)',
      handler: async (request) =>
        new URL(request.url).pathname.includes('no-such-path')
          ? new Response(PAGE, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
          : stack.handler(request),
      fails: [/^GET \/api\/no-such-path: /, /^GET \/p\/no-such-path: /],
    },
    {
      what: 'the Worker\'s answers may be cached',
      handler: withoutHeader('Cache-Control'),
      fails: [
        'GET /api/no-such-path: cache-control',
        'GET /p/no-such-path: cache-control',
        'GET /api/config: cache-control',
        'POST /api/pot/address from another site: cache-control',
        'POST /api/pot/address from no page at all: cache-control',
      ],
    },
    {
      what: 'the Worker\'s answers may be listed by a search engine',
      handler: withoutHeader('X-Robots-Tag'),
      fails: [
        'GET /api/no-such-path: x-robots-tag',
        'GET /p/no-such-path: x-robots-tag',
        'GET /api/config: x-robots-tag',
        'POST /api/pot/address from another site: x-robots-tag',
        'POST /api/pot/address from no page at all: x-robots-tag',
      ],
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
      fails: [
        'GET /api/no-such-path: access-control-allow-origin is absent',
        'GET /p/no-such-path: access-control-allow-origin is absent',
        'GET /api/config: access-control-allow-origin is absent',
        'POST /api/pot/address from another site: access-control-allow-origin is absent',
        'POST /api/pot/address from no page at all: access-control-allow-origin is absent',
      ],
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
    const names = failed(await liveCheck(local.url, EXPECT));
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
  assert.match(ran.out, /^2 of [0-9]+ checks FAILED for http:\/\/localhost:[0-9]+$/m);
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
