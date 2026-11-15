// The local server: what Cloudflare does for the deployed app, done for a
// folder on this machine. The app relies on four things, and each is pinned
// here: the headers of _headers on every page, the app's own page for every
// path that is no file, the right content types under "nosniff", and the
// Worker's handler behind /api/ and /p/ with nothing added or lost.

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { Agent, request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { Handler } from '@learnbitcoin/practice-worker';
import { applyHeaderRules, contentType, networkPath, parseHeadersFile, serve } from '../src/serve.ts';
import { startStack } from '../src/stack.ts';
import { APP_HEADERS, PAGE, notFound, scratchDist, scratchSite } from './scratch-site.ts';

// -- a client that sends exactly what it is told ----------------------------------

interface Answer {
  status: number;
  /** Lower-case names. A header sent twice is an array. */
  headers: Record<string, string | string[] | undefined>;
  /** The body as text, and as the bytes that came. */
  body: string;
  raw: Buffer;
  /** This client's own port on the connection the answer came over: the same number, the same connection. */
  via: number | undefined;
}

/**
 * One request over a socket, with no tidying of the path on the way (fetch
 * would resolve "/../" before it sent anything) and with any Host header.
 */
function ask(
  port: number,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string | string[]>;
    body?: string | Uint8Array;
    /** A body sent in pieces, with no length said beforehand. */
    pieces?: string[];
    /** Keeps the connection for the next request that names the same agent. */
    agent?: Agent;
  } = {},
): Promise<Answer> {
  // Said outright: left to itself, Node sends the body of a DELETE or an OPTIONS without its length.
  const headers = { ...options.headers };
  if (options.body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(options.body));
  return new Promise((resolve, reject) => {
    const sent = httpRequest(
      { host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers, setHost: options.headers?.Host === undefined, agent: options.agent },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks);
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: raw.toString('utf8'), raw, via });
        });
      },
    );
    let via: number | undefined;
    sent.on('socket', (socket) => {
      via = socket.localPort;
      // A connection that is new has to be made first: its port is known once it is.
      socket.once('connect', () => (via = socket.localPort));
    });
    sent.on('error', reject);
    for (const piece of options.pieces ?? []) sent.write(piece);
    sent.end(options.body);
  });
}

/** The pairs of the app's "/*" block: every page must carry each of them. */
const POLICY = parseHeadersFile(APP_HEADERS)[0]!.set;

// -- the _headers file --------------------------------------------------------------

test('_headers: the app\'s own file reads as three blocks, the policy for every path and noindex for every path but the home page and one that begins with two slashes', () => {
  const rules = parseHeadersFile(APP_HEADERS);
  assert.deepEqual(rules.map((rule) => rule.path), ['/*', '/:part', '/:part/*']);
  assert.deepEqual(rules[0]!.set.map(([name]) => name), [
    'content-security-policy',
    'referrer-policy',
    'x-content-type-options',
    'cross-origin-opener-policy',
    'permissions-policy',
    'strict-transport-security',
  ]);
  assert.deepEqual(rules[1]!.set, [['x-robots-tag', 'noindex']]);
  assert.deepEqual(rules[2]!.set, [['x-robots-tag', 'noindex']]);
  // The three patterns, sign for sign as Cloudflare's file server makes them of these paths.
  assert.deepEqual(rules.map((rule) => rule.pattern.source), [String.raw`^\/(?<splat>.*)$`, String.raw`^\/(?<part>[^/]+)$`, String.raw`^\/(?<part>[^/]+)\/(?<splat>.*)$`]);
});

/** Every order a list can be put in. */
function orders<T>(list: readonly T[]): T[][] {
  if (list.length <= 1) return [[...list]];
  return list.flatMap((first, index) => orders([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [first, ...rest]));
}

test('_headers: the app\'s own file gives a path the same headers whatever order its blocks are applied in', () => {
  // The order of the file is this server's. What order the deployed site applies the blocks in is not known,
  // so the file must not lean on one: every path gets the policy, and every path is marked noindex but "/"
  // and a path that begins with two slashes, which no page or file of the app has.
  const policy = Object.fromEntries(POLICY);
  const marked = ['/about', '/wallet', '/es', '/robots.txt', '/index.html', '/wallet/receive', '/es/', '/es/about', '/assets/x.js', '/do/hold-some'];
  const all = orders(parseHeadersFile(APP_HEADERS));
  assert.equal(all.length, 6);
  for (const rules of all) {
    const order = rules.map((rule) => rule.path).join(', ');
    const applied = (path: string) => {
      const headers = new Headers();
      applyHeaderRules(rules, path, headers);
      return Object.fromEntries(headers);
    };
    assert.deepEqual(applied('/'), policy, `/ (${order})`);
    for (const path of marked) assert.deepEqual(applied(path), { ...policy, 'x-robots-tag': 'noindex' }, `${path} (${order})`);
  }
});

test('_headers: read as Cloudflare reads it', () => {
  // Lines are trimmed, comments and empty lines skipped, names lower-cased, a value keeps its colons.
  const rules = parseHeadersFile('# a comment\n\n/assets/*\n\tCache-Control:  public, max-age=60 \n  X-Where: https://example.com/:splat\n\n/exact\n  # a comment under a path\n  X-Exact: yes\n');
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0]!.set, [
    ['cache-control', 'public, max-age=60'],
    ['x-where', 'https://example.com/:splat'],
  ]);
  assert.deepEqual(rules[1]!.set, [['x-exact', 'yes']]);
  // The same header twice in one block is one header, joined with a comma.
  assert.deepEqual(parseHeadersFile('/*\n  X-Robots-Tag: noindex\n  X-Robots-Tag: nofollow\n')[0]!.set, [['x-robots-tag', 'noindex, nofollow']]);
});

test('_headers: a line Cloudflare would drop, or a rule this server cannot apply, stops the server instead', () => {
  const bad: [text: string, why: RegExp][] = [
    ['  X-Robots-Tag: noindex\n', /before any path/],
    ['/*\n  X-Robots-Tag noindex\n', /not a path or a "Name: value" pair/],
    ['/*\n  X-Robots-Tag:\n', /no value/],
    ['/*\n  : noindex\n', /not a header name/],
    ['/*\n  X Robots: noindex\n', /not a header name/],
    ['/*\n  !\n', /not a path/],
    ['/*\n', /no header/],
    ['/*\n  X-A: 1\n/*\n  X-B: 2\n', /same path twice/],
    ['/a/*/b/*\n  X-A: 1\n', /more than one \*/],
    // Cloudflare's code can make no pattern of these, and does not apply the rule: a name twice, a name that
    // is the start of a later one, and ":splat" beside the "*" that bears that name.
    ['/:a/:a\n  X-A: 1\n', /no pattern can be made of this path/],
    ['/:a/:ab\n  X-A: 1\n', /no pattern can be made of this path/],
    ['/:splat/*\n  X-A: 1\n', /no pattern can be made of this path/],
    ['https://practice.learnbitcoin.com/*\n  X-A: 1\n', /one host/],
    [`/*\n  X-Long: ${'a'.repeat(2000)}\n`, /longer than 2000/],
    [Array.from({ length: 101 }, (_, i) => `/p${i}\n  X-A: 1\n`).join(''), /101 rules/],
  ];
  for (const [text, why] of bad) assert.throws(() => parseHeadersFile(text), why, JSON.stringify(text.slice(0, 40)));
  // The error says which line.
  assert.throws(() => parseHeadersFile('/*\n  X-A: 1\n  oops\n'), /_headers line 3/);
});

test('_headers: a "! Name" line is refused, and the error says why', () => {
  // Cloudflare takes such a line: it takes away a header that another block added. The app's file as it was
  // first deployed had one, for the home page. Here the home page then came without the header. There it kept it.
  const deployed = '/*\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex\n\n/\n  ! X-Robots-Tag\n';
  assert.throws(
    () => parseHeadersFile(deployed),
    /^Error: _headers line 6: a "! Name" line\. What such a line does on the deployed site cannot be shown here: one took a header off the home page on this server, and the deployed site still sent it\. Write blocks that only add, each for the paths that carry its headers$/,
  );
  // Wherever it stands, and whatever it names.
  for (const text of ['/*\n  ! X-Robots-Tag\n', '/*\n  X-A: 1\n  ! Cache-Control\n', '/:part\n  ! X-A\n  X-B: 2\n']) {
    assert.throws(() => parseHeadersFile(text), /a "! Name" line\. What such a line does on the deployed site cannot be shown here/, JSON.stringify(text));
  }
});

test('_headers: a path that Cloudflare would read as another path than the one written is refused, and the error says which', () => {
  // Cloudflare's parser reads a rule's path the way the path of a web address is read, and applies the rule to
  // the path it read. Each line is what its own code made of the path on the left, run on this machine: the
  // parser in wrangler 4.161.0, and the copy of it in miniflare. This server applies a path as it is written:
  // taken as it stands, each of these four rules did not give its headers to the path on the right, where
  // Cloudflare's code did.
  const rewritten: [written: string, read: string][] = [
    // What follows a "?" is dropped.
    ['/wallet?tab=1', '/wallet'],
    // ".." takes the part before it away.
    ['/a/../about', '/about'],
    // A letter outside ASCII and a brace come out as escapes.
    ['/caf\u00e9', '/caf%C3%A9'],
    ['/{id}', '/%7Bid%7D'],
  ];
  for (const [written, read] of rewritten) {
    assert.throws(
      () => parseHeadersFile(`/*\n  X-A: 1\n${written}\n  X-B: 2\n`),
      {
        message: `_headers line 3: a path that Cloudflare would read as "${read}". It would apply the rule to that path, and this server to the path as written: write the path the way Cloudflare reads it`,
      },
      written,
    );
  }
  // A path that is read as it is written is taken as before: the app's own three, and others.
  for (const path of ['/*', '/:part', '/:part/*', '/assets/*', '/a.b', '/es/']) {
    assert.deepEqual(parseHeadersFile(`${path}\n  X-Hit: yes\n`).map((rule) => rule.path), [path]);
  }
  // And so is each of the four, written the way Cloudflare reads it.
  for (const [, read] of rewritten) {
    assert.deepEqual(parseHeadersFile(`${read}\n  X-Hit: yes\n`).map((rule) => rule.path), [read]);
  }
});

test('_headers: a path that no request reaches this server with is refused, and the error says what the path is tidied to', () => {
  // This server tidies the path of a request before it looks at the rules (networkPath): slashes in a row
  // become one, an escape of a plain character is read, and an escape is written in capitals. A rule whose
  // path is not tidy in that way would never apply here, while Cloudflare's own code, run on this machine,
  // gave each of these six to a request for exactly the path as written.
  const untidy: [written: string, tidied: string][] = [
    ['//x', '/x'],
    ['/a//b', '/a/b'],
    ['/%77allet', '/wallet'],
    ['/a%41b', '/aAb'],
    ['/caf%c3%a9', '/caf%C3%A9'],
    ['/a%2fb', '/a%2Fb'],
  ];
  for (const [written, tidied] of untidy) {
    assert.throws(
      () => parseHeadersFile(`/*\n  X-A: 1\n${written}\n  X-B: 2\n`),
      (error: unknown) => error instanceof Error && error.message.startsWith('_headers line 3: a path that no request reaches this server with') && error.message.includes(JSON.stringify(tidied)),
      written,
    );
  }
  // A tidy path is taken as before: the app's own three, and the tidy form of the two with escapes.
  for (const path of ['/*', '/:part', '/:part/*', '/assets/*', '/caf%C3%A9', '/a%2Fb']) {
    assert.deepEqual(parseHeadersFile(`${path}\n  X-Hit: yes\n`).map((rule) => rule.path), [path]);
  }
});

test('_headers: rules are applied in file order, by the path that was asked for', () => {
  const rules = parseHeadersFile(
    ['/*', '  X-Robots-Tag: noindex', '  Cache-Control: no-cache', '/', '  X-Home: yes', '/assets/*', '  X-Robots-Tag: nofollow', '  X-File: :splat', ''].join('\n'),
  );
  const applied = (path: string) => {
    // What the server sends by itself, before the file is looked at.
    const headers = new Headers({ 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=0, must-revalidate' });
    applyHeaderRules(rules, path, headers);
    return Object.fromEntries(headers);
  };
  // A rule's value replaces the server's own, and never joins it.
  assert.deepEqual(applied('/wallet'), { 'content-type': 'text/html', 'cache-control': 'no-cache', 'x-robots-tag': 'noindex' });
  // "/" is the root and nothing else.
  assert.deepEqual(applied('/'), { 'content-type': 'text/html', 'cache-control': 'no-cache', 'x-robots-tag': 'noindex', 'x-home': 'yes' });
  // Two matching rules that name one header: both values, joined in the order of the file. A value can quote what the "*" stood for.
  assert.deepEqual(applied('/assets/a/b.js'), {
    'content-type': 'text/html',
    'cache-control': 'no-cache',
    'x-robots-tag': 'noindex, nofollow',
    'x-file': 'a/b.js',
  });
  // A pattern covers the whole path: "/assets" itself is not under "/assets/*".
  assert.equal(applied('/assets')['x-file'], undefined);
});

test('_headers: a ":name" in a path is one part of the path, matched as Cloudflare matches it', () => {
  /** The headers a file gives a path, and nothing else. */
  const headersOf = (file: string, path: string) => {
    const headers = new Headers();
    applyHeaderRules(parseHeadersFile(file), path, headers);
    return Object.fromEntries(headers);
  };
  /** Which of these paths a rule's path matches. */
  const matched = (rule: string, paths: string[]) => paths.filter((path) => headersOf(`${rule}\n  X-Hit: yes\n`, path)['x-hit'] === 'yes');

  // Every line below is what Cloudflare's own code did with the same rule and the same paths, run on this
  // machine: the parser in wrangler 4.161.0, and the matcher of the file server that ships with it (in miniflare).
  //
  // One or more characters that are not a slash. So: one part and never none, and an escaped slash is no slash.
  assert.deepEqual(matched('/:part', ['/', '/about', '/es', '/robots.txt', '/index.html', '/a%2Fb', '/a:b', '/about/', '/wallet/receive', '/es/']), [
    '/about',
    '/es',
    '/robots.txt',
    '/index.html',
    '/a%2Fb',
    '/a:b',
  ]);
  // With a "*" after it: one part, a slash, and whatever follows, even nothing.
  assert.deepEqual(matched('/:part/*', ['/', '/about', '/wallet/receive', '/es/', '/es/about', '/assets/x.js', '/a/b/c/d']), [
    '/wallet/receive',
    '/es/',
    '/es/about',
    '/assets/x.js',
    '/a/b/c/d',
  ]);
  // The rest of the path stands for itself, capitals too, and the pattern covers the whole path.
  assert.deepEqual(matched('/books/:id', ['/books/7', '/books/ada', '/books', '/books/', '/books/7/', '/books/7/edit', '/Books/7', '/x/books/7']), ['/books/7', '/books/ada']);
  // A name can stand beside other text. The dot after it is a dot.
  assert.deepEqual(matched('/file-:name.txt', ['/file-a.txt', '/file-a.b.txt', '/file-.txt', '/file-aXtxt', '/file-a.txt/']), ['/file-a.txt', '/file-a.b.txt']);
  // Two names, each one part.
  assert.deepEqual(matched('/:lang/wallet/:screen', ['/es/wallet/send', '/es/wallet', '/es/wallet/send/x', '/wallet/send']), ['/es/wallet/send']);
  // A name is a colon, a letter, then letters, digits or "_". A colon before anything else is a colon.
  assert.deepEqual(matched('/a:1', ['/a:1', '/ab', '/a']), ['/a:1']);
  assert.deepEqual(matched('/:_x', ['/:_x', '/a']), ['/:_x']);
  assert.deepEqual(matched('/a:b', ['/ax', '/a:b', '/a', '/a/x']), ['/ax', '/a:b']);
  assert.deepEqual(matched('/:part_1/:Part2', ['/a/b', '/a']), ['/a/b']);
  // Of two names that start alike, the longer has to come first ("/:a/:ab" is refused: see above).
  assert.deepEqual(matched('/:ab/:a', ['/x/y', '/x']), ['/x/y']);
  // ":splat" by itself is a name like any other.
  assert.deepEqual(matched('/:splat', ['/x', '/x/y']), ['/x']);
  // The patterns themselves, sign for sign.
  const source = (rule: string) => parseHeadersFile(`${rule}\n  X-Hit: yes\n`)[0]!.pattern.source;
  assert.equal(source('/books/:id'), String.raw`^\/books\/(?<id>[^/]+)$`);
  assert.equal(source('/file-:name.txt'), String.raw`^\/file\-(?<name>[^/]+)\.txt$`);
  assert.equal(source('/:lang/wallet/:screen'), String.raw`^\/(?<lang>[^/]+)\/wallet\/(?<screen>[^/]+)$`);
  assert.equal(source('/a:1'), String.raw`^\/a:1$`);

  // A value can quote what a name stood for, and what the "*" stood for, wherever it writes them.
  assert.deepEqual(headersOf('/books/:id\n  X-Id: book-:id\n', '/books/7'), { 'x-id': 'book-7' });
  assert.deepEqual(headersOf('/books/:id\n  X-Id: book-:id\n', '/books/a%20b'), { 'x-id': 'book-a%20b' });
  assert.deepEqual(headersOf('/:lang/wallet/*\n  X-Where: :lang|:splat\n', '/es/wallet/send/now'), { 'x-where': 'es|send/now' });
  assert.deepEqual(headersOf('/:lang/wallet/*\n  X-Where: :lang|:splat\n', '/es/wallet/'), { 'x-where': 'es|' });
  // A name the path does not have stays as written. One that starts like a name of the path has that start replaced.
  assert.deepEqual(headersOf('/books/:id\n  X-Other: :other and :idle\n', '/books/7'), { 'x-other': ':other and 7le' });
  // The names are put in one after the other, in the order of the path: what the first put in, the second can still replace.
  assert.deepEqual(headersOf('/:a/:b\n  X-Both: :a\n', '/:b/x'), { 'x-both': 'x' });
  // Two rules that match, one of them by a name: the values are joined in the order of the file.
  assert.deepEqual(headersOf('/*\n  X-A: one\n/:part\n  X-A: two\n', '/about'), { 'x-a': 'one, two' });
});

// -- files ----------------------------------------------------------------------------

const FILES: Record<string, string | Uint8Array> = {
  'robots.txt': 'User-agent: *\nAllow: /\n',
  'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  'favicon.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  'licenses.md': '# Licenses\n',
  'assets/app-abc123.js': 'export {};\n',
  'assets/app-abc123.js.map': '{"version":3}',
  'assets/app-abc123.css': 'body{margin:0}',
  'assets/font-abc123.woff2': new Uint8Array([0x77, 0x4f, 0x46, 0x32]),
  'assets/data.json': '{}',
  'a b.txt': 'a space in the name\n',
  'mystery.bin': new Uint8Array([1, 2, 3]),
  'favicon.ico': new Uint8Array([0, 0, 1, 0]),
  'site.webmanifest': '{}',
  'feed.xml': '<feed/>',
  'table.csv': 'a,b\n',
  'clip.mp4': new Uint8Array([0, 0, 0, 24]),
  'all.zip': new Uint8Array([0x50, 0x4b]),
  'LICENSE': 'a file with no extension\n',
  'notes.nobody-knows-this': 'a kind of file nobody knows\n',
};

test('every page carries the policy: the home page, a file, and a path that is no file', async () => {
  const site = await scratchSite(FILES);
  for (const path of ['/', '/about', '/es', '/wallet/receive', '/es/', '/es/wallet/tx/abc', '/assets/app-abc123.js', '/robots.txt', '/assets/no-such-file.js']) {
    const answer = await ask(site.port, path);
    assert.equal(answer.status, 200, path);
    for (const [name, value] of POLICY) assert.equal(answer.headers[name], value, `${path}: ${name}`);
    // The home page alone has no X-Robots-Tag: it may be listed.
    assert.equal(answer.headers['x-robots-tag'], path === '/' ? undefined : 'noindex', `${path}: x-robots-tag`);
  }
  // The home page's other name is a path of its own: the answer that sends it on to "/" is marked like any other.
  const other = await ask(site.port, '/index.html');
  assert.deepEqual([other.status, other.headers['x-robots-tag']], [307, 'noindex']);
  for (const [name, value] of POLICY) assert.equal(other.headers[name], value, `/index.html: ${name}`);
});

test('a path that is no file is the app, with status 200', async () => {
  const site = await scratchSite(FILES);
  for (const path of ['/wallet', '/wallet/', '/es/wallet/send', '/not-found', '/assets/no-such-file.js', '/api', '/apiary', '/p', '/.well-known/nothing', '/wallet?x=1']) {
    const answer = await ask(site.port, path);
    assert.equal(answer.status, 200, path);
    assert.equal(answer.headers['content-type'], 'text/html; charset=utf-8', path);
    assert.equal(answer.body, PAGE, path);
  }
  // The home page's own two other names lead back to it, as on Cloudflare.
  for (const path of ['/index.html', '/index']) {
    const answer = await ask(site.port, `${path}?x=1`);
    assert.equal(answer.status, 307, path);
    assert.equal(answer.headers.location, '/?x=1', path);
    assert.equal(answer.body, '', path);
  }
});

test('content types: what a browser needs under "nosniff", named as Cloudflare names them', async () => {
  const site = await scratchSite(FILES);
  // Each of these is what Cloudflare's own file server sent for a file of that name, run on this machine.
  // Its rule: "; charset=utf-8" goes with the text/ types and with no other, so JSON has none.
  const types: [path: string, type: string | undefined][] = [
    ['/', 'text/html; charset=utf-8'],
    ['/assets/app-abc123.js', 'text/javascript; charset=utf-8'],
    ['/assets/app-abc123.js.map', 'application/json'],
    ['/assets/app-abc123.css', 'text/css; charset=utf-8'],
    ['/assets/font-abc123.woff2', 'font/woff2'],
    ['/assets/data.json', 'application/json'],
    ['/logo.svg', 'image/svg+xml'],
    ['/favicon.png', 'image/png'],
    ['/favicon.ico', 'image/vnd.microsoft.icon'],
    ['/robots.txt', 'text/plain; charset=utf-8'],
    ['/licenses.md', 'text/markdown; charset=utf-8'],
    ['/a%20b.txt', 'text/plain; charset=utf-8'],
    ['/site.webmanifest', 'application/manifest+json'],
    ['/feed.xml', 'application/xml'],
    ['/table.csv', 'text/csv; charset=utf-8'],
    ['/clip.mp4', 'video/mp4'],
    ['/all.zip', 'application/zip'],
    ['/mystery.bin', 'application/octet-stream'],
    // A kind of file nobody knows goes out with no Content-Type at all, there and here.
    ['/LICENSE', undefined],
    ['/notes.nobody-knows-this', undefined],
  ];
  for (const [path, type] of types) {
    const answer = await ask(site.port, path);
    assert.equal(answer.status, 200, path);
    assert.equal(answer.headers['content-type'], type, path);
  }
  assert.equal((await ask(site.port, '/a%20b.txt')).body, 'a space in the name\n');
  assert.equal((await ask(site.port, '/LICENSE')).body, 'a file with no extension\n');
  assert.equal(contentType('x.JS'), 'text/javascript; charset=utf-8');
  assert.equal(contentType('no-extension'), null);
});

test('a file comes with its length, a tag and "ask before using your copy"; an unchanged file is not sent twice', async () => {
  const site = await scratchSite(FILES);
  const first = await ask(site.port, '/assets/app-abc123.js');
  assert.equal(first.body, 'export {};\n');
  assert.equal(first.headers['content-length'], '11');
  assert.equal(first.headers['cache-control'], 'public, max-age=0, must-revalidate');
  const etag = first.headers.etag;
  assert.ok(typeof etag === 'string' && /^"[0-9a-f]{32}"$/.test(etag), String(etag));

  for (const known of [etag, `W/${etag}`]) {
    const again = await ask(site.port, '/assets/app-abc123.js', { headers: { 'If-None-Match': known } });
    assert.equal(again.status, 304);
    assert.equal(again.body, '');
    assert.equal(again.headers.etag, etag);
    // The policy rides on this answer too.
    assert.equal(again.headers['x-content-type-options'], 'nosniff');
  }
  assert.equal((await ask(site.port, '/assets/app-abc123.js', { headers: { 'If-None-Match': '"something-else"' } })).status, 200);
  // Another file, another tag.
  assert.notEqual((await ask(site.port, '/assets/app-abc123.css')).headers.etag, etag);
  // Cloudflare leaves its Cache-Control off when the request carries one of these.
  assert.equal((await ask(site.port, '/assets/app-abc123.js', { headers: { Range: 'bytes=0-3' } })).headers['cache-control'], undefined);
  assert.equal((await ask(site.port, '/assets/app-abc123.js', { headers: { Range: 'bytes=0-3' } })).body, 'export {};\n');
});

test('text goes out compressed to a client that takes it, and the file is the same after unpacking', async () => {
  const script = `export const words = ${JSON.stringify('practice '.repeat(400))};\n`;
  const site = await scratchSite({ ...FILES, 'assets/big.js': script, 'assets/big.woff2': new Uint8Array(4000) });
  const plain = await ask(site.port, '/assets/big.js');
  assert.deepEqual([plain.headers['content-encoding'], plain.body, plain.headers.vary], [undefined, script, 'Accept-Encoding']);

  // A browser's own header: Brotli first, as Cloudflare chooses.
  const br = await ask(site.port, '/assets/big.js', { headers: { 'Accept-Encoding': 'gzip, deflate, br, zstd' } });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(brotliDecompressSync(br.raw).toString('utf8'), script);
  assert.equal(br.headers['content-length'], String(br.raw.byteLength));
  assert.ok(br.raw.byteLength < script.length / 10, `${br.raw.byteLength} bytes for ${script.length}`);
  assert.equal(br.headers['content-type'], 'text/javascript; charset=utf-8');
  // The same file in another form: the tag says so, and both forms of it are recognised.
  assert.equal(br.headers.etag, `W/${String(plain.headers.etag)}`);
  for (const known of [String(plain.headers.etag), String(br.headers.etag)]) {
    assert.equal((await ask(site.port, '/assets/big.js', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': known } })).status, 304);
  }

  const gzip = await ask(site.port, '/assets/big.js', { headers: { 'Accept-Encoding': 'gzip, br;q=0' } });
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.equal(gunzipSync(gzip.raw).toString('utf8'), script);
  assert.equal((await ask(site.port, '/assets/big.js', { headers: { 'Accept-Encoding': 'identity' } })).headers['content-encoding'], undefined);

  // HEAD tells the length a GET would send.
  const head = await ask(site.port, '/assets/big.js', { method: 'HEAD', headers: { 'Accept-Encoding': 'br' } });
  assert.deepEqual([head.headers['content-encoding'], head.headers['content-length'], head.body], ['br', String(br.raw.byteLength), '']);

  // A font is compressed already, and a small file gains nothing.
  assert.equal((await ask(site.port, '/assets/big.woff2', { headers: { 'Accept-Encoding': 'br' } })).headers['content-encoding'], undefined);
  assert.equal((await ask(site.port, '/robots.txt', { headers: { 'Accept-Encoding': 'br' } })).headers['content-encoding'], undefined);
  // What the handler answers is never touched.
  const api = await ask(site.port, '/api/config', { headers: { 'Accept-Encoding': 'gzip, br' } });
  assert.deepEqual([api.headers['content-encoding'], api.body], [undefined, '{"error":"not_found"}']);
});

test('HEAD: the headers of a GET and no body', async () => {
  const site = await scratchSite(FILES);
  for (const path of ['/', '/assets/app-abc123.js', '/wallet/receive']) {
    const get = await ask(site.port, path);
    const head = await ask(site.port, path, { method: 'HEAD' });
    assert.equal(head.status, 200, path);
    assert.equal(head.body, '', path);
    for (const name of ['content-type', 'content-length', 'etag', 'cache-control', 'content-security-policy', 'x-robots-tag']) {
      assert.equal(head.headers[name], get.headers[name], `${path}: ${name}`);
    }
    assert.equal(head.headers['content-length'], String(Buffer.byteLength(get.body)), path);
  }
});

test('only GET and HEAD read a file', async () => {
  const site = await scratchSite(FILES);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    for (const path of ['/', '/robots.txt', '/wallet']) {
      const answer = await ask(site.port, path, { method, body: method === 'OPTIONS' ? undefined : 'x' });
      assert.equal(answer.status, 405, `${method} ${path}`);
      // No Allow header: Cloudflare's file server sends none with its 405.
      assert.equal(answer.headers.allow, undefined, `${method} ${path}`);
      assert.equal(answer.body, '', `${method} ${path}`);
      // The policy rides on this answer too.
      assert.equal(answer.headers['x-content-type-options'], 'nosniff', `${method} ${path}`);
    }
  }
  // Also where a GET would be sent on to another spelling: the method is looked at first.
  assert.equal((await ask(site.port, '/wallet/a+b', { method: 'POST', body: 'x' })).status, 405);
  assert.equal((await ask(site.port, '/index.html', { method: 'POST', body: 'x' })).status, 405);
});

test('nothing outside the folder is served, and nothing that is not a plain file of it', async () => {
  const site = await scratchSite(FILES);
  // A file next to the built app, and a link to it from inside.
  const secret = join(dirname(site.dist), 'secret.txt');
  writeFileSync(secret, 'SECRET');
  symlinkSync(secret, join(site.dist, 'link.txt'));
  mkdirSync(join(site.dist, 'folder'));
  writeFileSync(join(site.dist, 'folder', 'file.txt'), 'a file in a folder');

  const paths = [
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/..%2fsecret.txt',
    '/..%2Fsecret.txt',
    '/assets/../../secret.txt',
    '/assets/..%2f..%2fsecret.txt',
    '/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
    '/..\\secret.txt',
    '/%5c..%5csecret.txt',
    '/link.txt', // a link that points out of the folder
    '/_headers', // Cloudflare reads this file and never serves it
    '/assets', // a folder: no listing
    '/assets/',
    '/folder',
    '/folder/',
    '/%00',
    '/robots.txt/',
    '/robots.txt%00.html',
    '/%E0%A4%A', // not a readable escape
    '/ROBOTS.TXT', // names are exact, also on a disk that would find it
    '/Logo.svg',
  ];
  let redirected = 0;
  for (const path of paths) {
    let answer = await ask(site.port, path);
    // A path in another spelling than Cloudflare's own is sent to that spelling first, with nothing in the
    // answer but the new address. Followed as a browser follows it, it ends at the app like the others.
    if (answer.status === 307) {
      redirected += 1;
      assert.equal(answer.body, '', path);
      const next = new URL(String(answer.headers.location), `http://localhost:${site.port}`);
      answer = await ask(site.port, `${next.pathname}${next.search}`);
    }
    assert.equal(answer.status, 200, path);
    assert.equal(answer.body, PAGE, `${path} must be answered with the app, as any path with no file`);
    assert.equal(answer.headers['content-type'], 'text/html; charset=utf-8', path);
  }
  // The five with an escaped slash in them, or an escape that cannot be read.
  assert.equal(redirected, 5);
  // Slashes in a row are one slash. Cloudflare's network makes them so before its file server sees the path.
  // (The file server alone, as Wrangler runs it on a developer's machine, would redirect instead.)
  assert.equal((await ask(site.port, '//robots.txt')).body, FILES['robots.txt']);
  rmSync(secret);
});

test('the path as Cloudflare\'s network hands it on: slashes merged, plain escapes read, the others in capitals', () => {
  const tidied: [typed: string, handedOn: string][] = [
    ['/wallet/receive', '/wallet/receive'],
    ['//robots.txt', '/robots.txt'],
    ['/assets///app.js', '/assets/app.js'],
    ['/%77allet', '/wallet'],
    ['/robots%2Etxt', '/robots.txt'],
    ['/%7Ex/%2D%5F%30', '/~x/-_0'],
    // What is not a plain letter, digit, "-", ".", "_" or "~" stays an escape, in capitals.
    ['/wallet/%c3%a9', '/wallet/%C3%A9'],
    ['/wallet%2freceive', '/wallet%2Freceive'],
    ['/a%20b%2b%3f', '/a%20b%2B%3F'],
    // Not an escape at all: left as it is.
    ['/%zz/%4', '/%zz/%4'],
    // Characters that are written out stay written out.
    ['/wallet/a+b:c@d', '/wallet/a+b:c@d'],
  ];
  for (const [typed, handedOn] of tidied) assert.equal(networkPath(typed), handedOn, typed);
});

test('one spelling for each path: any other is sent to it, and what the network tidies is answered directly', async () => {
  const { seen, handler } = recorder();
  const site = await scratchSite(FILES, handler);

  // Cloudflare's file server answers a path under the spelling it would write itself (read, then escaped
  // again) and under no other. Each line is what it sent, run on this machine, for the path on the left.
  const sentOn: [path: string, location: string][] = [
    ['/wallet/a+b', '/wallet/a%2Bb'],
    ['/wallet/a@b', '/wallet/a%40b'],
    ['/wallet/a:b', '/wallet/a%3Ab'],
    ['/wallet/a=b', '/wallet/a%3Db'],
    ['/wallet/a,b', '/wallet/a%2Cb'],
    ['/wallet/a;b', '/wallet/a%3Bb'],
    ['/wallet/a$b', '/wallet/a%24b'],
    ['/wallet/a&b', '/wallet/a%26b'],
    ['/wallet/a|b', '/wallet/a%7Cb'],
    ['/wallet/[x]', '/wallet/%5Bx%5D'],
    ['/wallet/a%21b', '/wallet/a!b'],
    ['/wallet%2Freceive', '/wallet/receive'],
    ['/wallet%2freceive', '/wallet/receive'],
    ['/api%2Fconfig', '/api/config'],
    ['/%zz', '/%25zz'],
    ['/%E0%A4%A', '/%25E0%25A4%25A'],
    // The home page's other names, one step at a time.
    ['/index/', '/index'],
    ['/index', '/'],
    ['/index.html', '/'],
    ['//index.html', '/'],
    // What follows the "?" goes along untouched.
    ['/wallet/a+b?x=1&y=%2b', '/wallet/a%2Bb?x=1&y=%2b'],
    ['/index/?z=3', '/index?z=3'],
  ];
  for (const [path, location] of sentOn) {
    for (const method of ['GET', 'HEAD']) {
      const answer = await ask(site.port, path, { method });
      assert.equal(answer.status, 307, `${method} ${path}`);
      assert.equal(answer.headers.location, location, `${method} ${path}`);
      assert.equal(answer.body, '', `${method} ${path}`);
      assert.equal(answer.headers['content-length'], '0', `${method} ${path}`);
      assert.equal(answer.headers['content-type'], undefined, `${method} ${path}`);
      // The policy rides on a redirect too.
      assert.equal(answer.headers['x-content-type-options'], 'nosniff', `${method} ${path}`);
    }
  }
  // Where a path is sent, it is at home: no second redirect. (Except from /index, which is one more step from "/".)
  for (const [, location] of sentOn) {
    if (location.split('?')[0] === '/index') continue;
    assert.equal((await ask(site.port, location)).status, 200, location);
  }

  // What Cloudflare's network tidies before its file server sees it is answered directly.
  const files: [path: string, file: string][] = [
    ['//robots.txt', 'robots.txt'],
    ['///robots.txt', 'robots.txt'],
    ['/robots%2Etxt', 'robots.txt'],
    ['/%72obots.txt', 'robots.txt'],
    ['/assets//app-abc123.js', 'assets/app-abc123.js'],
  ];
  for (const [path, file] of files) {
    const answer = await ask(site.port, path);
    assert.deepEqual([answer.status, answer.body], [200, FILES[file]], path);
  }
  for (const path of ['/%77allet', '/wallet/%c3%a9', '/wallet/%C3%A9', '/wallet/a%20b', "/wallet/a'b", '/wallet/(x)', '/wallet/a!b', '/wallet/a*b', '/wallet/~x', '/wallet/a%2Bb', '/wallet%3Fx']) {
    const answer = await ask(site.port, path);
    assert.deepEqual([answer.status, answer.body], [200, PAGE], path);
  }
  // The headers are chosen by the tidied path as well: "//" is the home page, which may be listed.
  assert.equal((await ask(site.port, '//')).headers['x-robots-tag'], undefined);
  assert.equal((await ask(site.port, '//wallet')).headers['x-robots-tag'], 'noindex');

  // The Worker's handler is given the tidied path too, and it is the tidied path that decides who answers.
  // (So far it was asked once: /api%2Fconfig was sent on to /api/config, and that address is the Worker's.)
  assert.deepEqual(seen.map((asked) => new URL(asked.url).pathname), ['/api/config']);
  seen.length = 0;
  const handed: [path: string, url: string][] = [
    ['//api/config', '/api/config'],
    ['/api//config', '/api/config'],
    ['/%61pi/config', '/api/config'],
    ['/p//event', '/p/event'],
    ['/api/esplora/tx/%41%62', '/api/esplora/tx/Ab'],
    // An escaped slash stays escaped: the handler sees it, in capitals, and decides.
    ['/api/esplora%2ftx?x=%2f', '/api/esplora%2Ftx?x=%2f'],
  ];
  for (const [path, url] of handed) {
    await ask(site.port, path);
    assert.equal(seen.at(-1)?.url, `http://127.0.0.1:${site.port}${url}`, path);
  }
  assert.equal(seen.length, handed.length);
});

// -- the handler behind /api/ and /p/ ----------------------------------------------------

/** A handler that remembers what it was asked and answers as it was told to. */
function recorder(respond: (request: Request) => Response | Promise<Response> = () => new Response('ok')) {
  const seen: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  const handler: Handler = async (request) => {
    seen.push({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body: await request.text() });
    return respond(request);
  };
  return { seen, handler };
}

test('/api/ and /p/ go to the handler, with the address built from the Host header', async () => {
  const { seen, handler } = recorder();
  const site = await scratchSite(FILES, handler);

  await ask(site.port, '/api/config');
  assert.equal(seen.at(-1)!.url, `http://127.0.0.1:${site.port}/api/config`);

  // The host the browser used, not the address the server listens on: behind
  // Vite's proxy that is localhost:5173, and the handler compares a POST's Origin with it.
  await ask(site.port, '/api/esplora/tx?x=1', { method: 'POST', headers: { Host: 'localhost:5173', Origin: 'http://localhost:5173' }, body: 'abcd' });
  assert.deepEqual(
    { url: seen.at(-1)!.url, method: seen.at(-1)!.method, origin: seen.at(-1)!.headers.origin, body: seen.at(-1)!.body },
    { url: 'http://localhost:5173/api/esplora/tx?x=1', method: 'POST', origin: 'http://localhost:5173', body: 'abcd' },
  );
  await ask(site.port, '/p/event', { method: 'POST', headers: { Host: 'practice.test' }, body: '{}' });
  assert.equal(seen.at(-1)!.url, 'http://practice.test/p/event');

  // The address always starts with http://, whatever a proxy in front says about itself. So behind
  // something that adds HTTPS the page's Origin (https) is not the request's own, and the real handler
  // refuses every POST: this server cannot stand behind a tunnel (written down in dev.ts).
  await ask(site.port, '/api/pot/address', {
    method: 'POST',
    headers: { Host: 'phone.test', Origin: 'https://phone.test', 'X-Forwarded-Proto': 'https', Forwarded: 'proto=https' },
  });
  assert.deepEqual([seen.at(-1)!.url, seen.at(-1)!.headers.origin], ['http://phone.test/api/pot/address', 'https://phone.test']);
  seen.length = 3;

  // A request line that names a host of its own is not taken at its word, and a Host header must be a host.
  assert.equal((await ask(site.port, 'http://elsewhere.test/api/config')).status, 400);
  assert.equal((await ask(site.port, '/api/config', { headers: { Host: 'practice.test/api' } })).status, 400);
  assert.equal((await ask(site.port, '/api/config', { headers: { Host: 'user@practice.test' } })).status, 400);
  assert.equal(seen.length, 3);

  // What the path leads to is decided after "." and ".." are resolved, as a browser would have sent it.
  await ask(site.port, '/api/../wallet');
  assert.equal(seen.length, 3);
  await ask(site.port, '/wallet/../api/config');
  assert.equal(seen.at(-1)!.url, `http://127.0.0.1:${site.port}/api/config`);
  // "/api" and "/p" themselves are the app's, and so is everything that only starts alike.
  for (const path of ['/api', '/p', '/apiary', '/public']) assert.equal((await ask(site.port, path)).body, PAGE, path);
  assert.equal(seen.length, 4);
});

test('the request reaches the handler whole: method, headers and body', async () => {
  const { seen, handler } = recorder();
  const site = await scratchSite(FILES, handler);
  const body = JSON.stringify({ address: 'bcrt1qexample', token: 'XXXX.DUMMY.TOKEN.XXXX' });
  await ask(site.port, '/api/faucet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: `http://localhost:${site.port}`,
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent': 'serve-test browser',
      'X-Twice': ['one', 'two'],
      // A reader cannot choose this one: Cloudflare writes it, and here the server does.
      'CF-Connecting-IP': '203.0.113.7',
    },
    body,
  });
  const asked = seen.at(-1)!;
  assert.equal(asked.method, 'POST');
  assert.equal(asked.body, body);
  assert.equal(asked.headers['content-type'], 'application/json');
  assert.equal(asked.headers['content-length'], String(body.length));
  assert.equal(asked.headers.origin, `http://localhost:${site.port}`);
  assert.equal(asked.headers['sec-fetch-site'], 'same-origin');
  assert.equal(asked.headers['user-agent'], 'serve-test browser');
  assert.equal(asked.headers['x-twice'], 'one, two');
  assert.equal(asked.headers['cf-connecting-ip'], '127.0.0.1');

  // Every method goes through: saying no to one is the handler's business.
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    await ask(site.port, '/api/config', { method });
    assert.equal(seen.at(-1)!.method, method);
  }
  // A body of any size is passed on whole: this server has no cap of its own, as Cloudflare has none below 100 MB.
  const large = 'a'.repeat(3 * 1024 * 1024 + 1);
  assert.equal((await ask(site.port, '/api/esplora/tx', { method: 'POST', body: large })).status, 200);
  assert.equal(seen.at(-1)!.body.length, large.length);
  // The same in pieces, with no length said beforehand.
  assert.equal((await ask(site.port, '/api/esplora/tx', { method: 'POST', pieces: ['ab', 'cd', 'ef'] })).status, 200);
  assert.deepEqual([seen.at(-1)!.body, seen.at(-1)!.headers['content-length']], ['abcdef', undefined]);
  assert.deepEqual(site.faults, []);
});

test('a body over the handler\'s cap gets the handler\'s own answer, as on Cloudflare, and the connection lives on', async () => {
  const stack = await startStack();
  try {
    const site = await scratchSite(FILES, stack.handler);
    const origin = `http://127.0.0.1:${site.port}`;
    const refused = { status: 413, type: 'application/json; charset=utf-8', body: '{"error":"too_large"}' };
    /** The connections the answers came over. */
    const connections = new Set<number | undefined>();
    const got = (answer: Answer) => {
      connections.add(answer.via);
      return { status: answer.status, type: answer.headers['content-type'], body: answer.body };
    };

    // One connection for all of it: an answer that goes out before the body has been read must not break it.
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const sizes: [path: string, bytes: number][] = [
        ['/api/esplora/tx', 200_001],
        ['/api/esplora/tx', 1024 * 1024 + 1], // the old limit of this server: over it, the answer was the server's own, in plain text
        ['/api/esplora/tx', 5 * 1024 * 1024],
        ['/api/faucet', 4097],
        ['/p/event', 1025],
      ];
      for (const [path, bytes] of sizes) {
        const answer = await ask(site.port, path, { method: 'POST', headers: { Origin: origin }, body: 'a'.repeat(bytes), agent });
        assert.deepEqual(got(answer), refused, `${path}, ${bytes} bytes`);
        // What the handler says when it is handed the same request directly.
        const direct = await stack.handler(new Request(`${origin}${path}`, { method: 'POST', headers: { Origin: origin }, body: 'a'.repeat(bytes) }));
        assert.deepEqual([direct.status, await direct.text()], [answer.status, answer.body], `${path}, ${bytes} bytes`);
      }
      // No length said beforehand: the handler reads up to its cap, lets go, and still answers.
      const pieces = Array.from({ length: 5 }, () => 'a'.repeat(64 * 1024));
      assert.deepEqual(got(await ask(site.port, '/api/esplora/tx', { method: 'POST', headers: { Origin: origin }, pieces, agent })), refused);
      // The connection is still good for the next request, and a small body still goes through.
      assert.equal(got(await ask(site.port, '/api/config', { agent })).status, 200);
      const event = await ask(site.port, '/p/event', { method: 'POST', headers: { Origin: origin }, body: '{"name":"pageview","path":"/"}', agent });
      assert.equal(got(event).status, 202);
      assert.equal(connections.size, 1, 'one connection carried every request');
      assert.equal(typeof [...connections][0], 'number');
    } finally {
      agent.destroy();
    }

    // A handler that never looks at the body: its answer goes out all the same.
    const deaf = await scratchSite(FILES, async () => new Response('not read'));
    assert.equal((await ask(deaf.port, '/api/anything', { method: 'POST', body: 'a'.repeat(2 * 1024 * 1024) })).body, 'not read');
    assert.deepEqual([site.faults, deaf.faults], [[], []]);
  } finally {
    await stack.close();
  }
});

test('the handler\'s answer goes back as it is: status, headers and body, and none of the pages\' headers', async () => {
  const { handler } = recorder((request) => {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/teapot') {
      const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Custom': 'kept' });
      headers.append('Set-Cookie', 'a=1');
      headers.append('Set-Cookie', 'b=2');
      return new Response('{"error":"refused","detail":"caf\u00e9"}', { status: 418, headers });
    }
    if (pathname === '/p/event') return new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    return new Response(new Uint8Array([0, 255, 1, 254]), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
  });
  const site = await scratchSite(FILES, handler);

  const teapot = await ask(site.port, '/api/teapot');
  assert.equal(teapot.status, 418);
  assert.equal(teapot.body, '{"error":"refused","detail":"caf\u00e9"}');
  assert.equal(teapot.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(teapot.headers['cache-control'], 'no-store');
  assert.equal(teapot.headers['x-custom'], 'kept');
  assert.deepEqual(teapot.headers['set-cookie'], ['a=1', 'b=2']);
  assert.equal(teapot.headers['content-length'], String(Buffer.byteLength(teapot.body)));
  // Nothing from _headers: Cloudflare never applies that file to what a Worker answers.
  for (const rule of parseHeadersFile(APP_HEADERS)) {
    for (const [name] of rule.set) assert.equal(teapot.headers[name], undefined, name);
  }
  assert.equal(teapot.headers.etag, undefined);

  const accepted = await ask(site.port, '/p/event', { method: 'POST', body: '{}' });
  assert.deepEqual([accepted.status, accepted.body, accepted.headers['content-length']], [202, '', '0']);

  // Bytes come back as bytes.
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    httpRequest({ host: '127.0.0.1', port: site.port, path: '/api/bytes' }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    })
      .on('error', reject)
      .end();
  });
  assert.deepEqual([...bytes], [0, 255, 1, 254]);

  // HEAD: the handler's status and headers, and no body.
  const head = await ask(site.port, '/api/teapot', { method: 'HEAD' });
  assert.deepEqual([head.status, head.body, head.headers['x-custom']], [418, '', 'kept']);
});

test('a fault of the server itself is a 500, and is kept where a run can see it', async () => {
  const site = await scratchSite(FILES, async () => {
    throw new Error('the handler fell over');
  });
  assert.deepEqual(site.faults, []);
  const answer = await ask(site.port, '/api/config');
  assert.equal(answer.status, 500);
  assert.match(answer.body, /the handler fell over/);
  assert.deepEqual(site.faults, ['GET /api/config: the handler fell over']);
  // The files are still served.
  assert.equal((await ask(site.port, '/robots.txt')).status, 200);
});

// -- starting -----------------------------------------------------------------------------

test('it listens on the loopback address, on a free port, and is reached by the name "localhost"', async () => {
  const one = await scratchSite();
  const two = await scratchSite();
  assert.notEqual(one.port, two.port);
  assert.equal(one.url, `http://localhost:${one.port}`);
  assert.equal((await ask(one.port, '/')).status, 200);
  await one.close();
  await assert.rejects(ask(one.port, '/'), /ECONNREFUSED/);
  assert.equal((await ask(two.port, '/')).status, 200);
});

test('it refuses to start without an app, with a policy file it cannot read whole, or with a file it cannot apply', async () => {
  /** The server must not start on this folder, and must say why. (One that does start is closed again, so that the test ends.) */
  const refusesToStart = async (dist: string, why: RegExp): Promise<void> => {
    let started;
    try {
      started = await serve({ dist, handler: notFound });
    } catch (error) {
      assert.match((error as Error).message, why);
      return;
    }
    await started.close();
    assert.fail(`the server started, and should have said: ${String(why)}`);
  };

  const empty = scratchDist();
  rmSync(join(empty, 'index.html'));
  await refusesToStart(empty, /no index\.html/);

  const noPolicy = scratchDist();
  rmSync(join(noPolicy, '_headers'));
  await refusesToStart(noPolicy, /no _headers file/);

  await refusesToStart(scratchDist({ _headers: '/*\n  X-Robots-Tag noindex\n' }), /_headers line 2/);
  // A file that takes a header away again, as the app's own did when it was first deployed.
  await refusesToStart(scratchDist({ _headers: '/*\n  X-Robots-Tag: noindex\n\n/\n  ! X-Robots-Tag\n' }), /_headers line 5: a "! Name" line/);

  // Two files Cloudflare would apply and this server cannot: with either, the same path would be answered
  // one way here and another way when deployed, and nothing would say so.
  await refusesToStart(scratchDist({ _redirects: '/old /new 301\n' }), /holds _redirects\. Cloudflare applies that file and the local server does not/);
  await refusesToStart(scratchDist({ '.assetsignore': 'secret-notes.txt\n', 'secret-notes.txt': 'x' }), /holds \.assetsignore\./);
});

test('"pnpm dev" may start before the first build: the handler answers, and other paths say how to get an app', async () => {
  const dist = scratchDist();
  rmSync(join(dist, 'index.html'));
  rmSync(join(dist, '_headers'));
  const server = await serve({ dist, handler: notFound, requireApp: false });
  try {
    assert.equal((await ask(server.port, '/api/config')).status, 404);
    assert.equal((await ask(server.port, '/api/config')).body, '{"error":"not_found"}');
    const page = await ask(server.port, '/wallet');
    assert.equal(page.status, 404);
    assert.match(page.body, /pnpm build/);
    // A build that appears while the server runs is served from then on, under its policy.
    writeFileSync(join(dist, 'index.html'), PAGE);
    writeFileSync(join(dist, '_headers'), APP_HEADERS);
    const built = await ask(server.port, '/wallet');
    assert.deepEqual([built.status, built.body, built.headers['x-robots-tag']], [200, PAGE, 'noindex']);
    // A build with a file this server cannot apply: no page is served from it, and the run is told why.
    writeFileSync(join(dist, '_redirects'), '/old /new 301\n');
    const refused = await ask(server.port, '/old');
    assert.equal(refused.status, 500);
    assert.match(refused.body, /holds _redirects/);
    assert.match(server.faults.at(-1) ?? '', /^GET \/old: serve: .* holds _redirects/);
    // The handler still answers.
    assert.equal((await ask(server.port, '/api/config')).status, 404);
  } finally {
    await server.close();
  }
});
