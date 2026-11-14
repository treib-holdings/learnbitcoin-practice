// A local server for a built app, standing in for Cloudflare.
//
// In production Cloudflare serves the files of app/dist itself and runs the
// Worker for /api/ and /p/ only (worker/wrangler.jsonc). This server does the
// same for one directory and one handler, for the cases the app relies on:
//
//   - /api/* and /p/* go to the handler as a standard Request, and its
//     Response goes back as it is. Nothing from _headers touches it. A
//     request's body is handed over as a stream, whatever its size: the
//     handler's own caps are the only ones, as they are when deployed.
//   - Every other path is a file of the directory, for GET and HEAD only
//     (any other method: 405).
//   - A path with no file gets index.html with status 200, so the app's own
//     router can show the screen (the "single-page application" setting).
//   - The directory's _headers file is applied to every such answer, the
//     fallback included, by the path that was asked for: rules in the order
//     of the file, a "! Name" line taking away what an earlier rule added.
//   - /index.html and /index are redirects to /, and /index/ is one to
//     /index (Cloudflare's default "auto-trailing-slash" handling of HTML
//     files).
//   - A path is served under one spelling only, the one Cloudflare itself
//     would write. Any other spelling is a redirect (307) to that one:
//     /wallet/a+b to /wallet/a%2Bb, /wallet%2Freceive to /wallet/receive.
//   - Before any of this, a path is tidied the way Cloudflare's network
//     tidies it for every request (networkPath below): "//robots.txt" is
//     "/robots.txt" and "/%77allet" is "/wallet", with no redirect. The
//     handler is given the tidied path, as a Worker is.
//   - The _headers file itself is never served.
//   - Text files (pages, scripts, styles, JSON, SVG) go out compressed to a
//     browser that takes it, as Cloudflare sends them. Nothing depends on
//     it but time: on the slow connection of the phone profile a page's
//     load time is mostly the size of its files on the wire.
//
// What it leaves out, so that nobody relies on it:
//
//   - Other HTML files than index.html get no special treatment.
//   - A rule in _headers that names a host or uses a :placeholder, and a
//     build that holds a _redirects or an .assetsignore file, are refused
//     with an error instead of applied: this server could not apply them
//     the way Cloudflare does, and would otherwise answer differently from
//     the deployed site without a word.
//   - The handler's answers are passed back byte for byte, where Cloudflare
//     would compress its JSON as well.
//   - Three headers. This server sends "Vary: Accept-Encoding" with text
//     files and a Content-Length on a HEAD; Cloudflare's file server sends
//     neither by itself. It sends CF-Cache-Status, and this one does not.
//     A scenario must not pin any of them.
//   - Cloudflare knows many more kinds of file than the table below. A file
//     whose kind the table does not hold goes out with no Content-Type, as
//     one that Cloudflare itself does not know would.
//   - The network's tidying follows Cloudflare's documentation of its
//     default settings, and has not been compared with a deployed zone.
//     Wrangler's own local server has no such network in front of it: it
//     redirects "//robots.txt" and "/%77allet", which this server, like the
//     network, answers directly.
//   - Cloudflare itself refuses a request body over 100 MB. This server
//     hands on whatever is sent.
//   - It speaks plain HTTP, and the address it gives the handler always
//     starts with http://. Behind anything that adds HTTPS (a tunnel, to
//     try the wallet on a phone) every POST is refused: the page's Origin
//     says https, the request's own address says http, and the handler
//     wants the two to be the same.
//
// It is a test tool. It listens on the loopback address only.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';
import type { Handler } from '@learnbitcoin/practice-worker';

// -- content types --------------------------------------------------------------

/**
 * The type sent for each kind of file a build holds, as Cloudflare names it:
 * the type its list of file kinds gives for the extension, with
 * "; charset=utf-8" added to the text/ types and to no other (so JSON goes
 * out without one). The app's pages are served with
 * "X-Content-Type-Options: nosniff", so a browser refuses a script or a
 * stylesheet that arrives under the wrong type.
 */
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/vnd.microsoft.icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.bin': 'application/octet-stream',
};

/**
 * The Content-Type for a file name, or null for a kind of file the table
 * does not hold: such a file is sent with no Content-Type at all, which is
 * what Cloudflare does with a kind it does not know.
 */
export function contentType(file: string): string | null {
  return TYPES[extname(file).toLowerCase()] ?? null;
}

/** The kinds of file worth compressing. Fonts (woff2) and pictures are compressed already. */
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|xml|manifest\+json|wasm)|image\/svg\+xml)/;

/** Below this size compressing saves nothing. */
const COMPRESS_FROM = 256;

/**
 * A file's bytes as they go out to a client that sent this Accept-Encoding
 * header: Brotli if it takes that, else gzip, else as they are.
 */
function encode(bytes: Buffer, type: string | null, accepted: string | undefined): { bytes: Buffer; encoding: 'br' | 'gzip' | null } {
  if (accepted === undefined || bytes.byteLength < COMPRESS_FROM || type === null || !COMPRESSIBLE.test(type)) return { bytes, encoding: null };
  // "gzip, deflate, br;q=0.9": the names a client takes. One marked q=0 is one it refuses.
  const takes = new Set(
    accepted
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter((part) => !/;\s*q=0(?:\.0*)?$/.test(part))
      .map((part) => part.split(';')[0]!.trim()),
  );
  // A middling effort, as a server that compresses while it answers would spend.
  if (takes.has('br')) return { bytes: brotliCompressSync(bytes, { params: { [zlib.BROTLI_PARAM_QUALITY]: 5 } }), encoding: 'br' };
  if (takes.has('gzip')) return { bytes: gzipSync(bytes, { level: 6 }), encoding: 'gzip' };
  return { bytes, encoding: null };
}

// -- the _headers file ------------------------------------------------------------

/** One block of a _headers file. */
export interface HeaderRule {
  /** The path as written: "/*", "/", "/assets/*". */
  path: string;
  /** The path as a pattern for a whole request path. A "*" stands for any run of characters. */
  pattern: RegExp;
  /** Headers the rule adds, with lower-case names, in the order written. */
  set: [name: string, value: string][];
  /** Headers the rule takes away again ("! Name"). */
  unset: string[];
}

// Cloudflare's limits for this file.
const MAX_RULES = 100;
const MAX_LINE = 2000;

const escapeRegex = (text: string) => text.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

/**
 * Reads a _headers file the way Cloudflare's own parser does: lines are
 * trimmed; an empty line or one that starts with "#" is skipped; a line that
 * starts with "/" opens a block; "! Name" takes a header away; "Name: value"
 * adds one, and the same name twice in one block is joined with a comma.
 *
 * Where Cloudflare would skip a bad line with a warning and deploy the rest,
 * this throws. A policy line that silently goes missing is the one mistake
 * this file must never make.
 */
export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let rule: HeaderRule | null = null;
  const fail = (index: number, why: string): never => {
    throw new Error(`_headers line ${index + 1}: ${why}`);
  };

  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    if (line.length > MAX_LINE) fail(index, `longer than ${MAX_LINE} characters (Cloudflare would ignore the line)`);

    if (line.startsWith('/') || /^[^\s]+:\/\//.test(line)) {
      if (!line.startsWith('/')) fail(index, 'a rule for one host: the local server applies rules by path only');
      if (/\s/.test(line)) fail(index, 'a path cannot hold a space');
      if (/:[A-Za-z]/.test(line)) fail(index, 'a :placeholder in a path is not supported by the local server');
      const parts = line.split('*');
      if (parts.length > 2) fail(index, 'more than one * in a path');
      if (rules.some((earlier) => earlier.path === line)) fail(index, 'the same path twice (Cloudflare would keep the last block only)');
      rule = { path: line, pattern: new RegExp(`^${parts.map(escapeRegex).join('(?<splat>.*)')}$`), set: [], unset: [] };
      rules.push(rule);
      return;
    }
    if (rule === null) return fail(index, 'a header before any path');

    if (!line.includes(':')) {
      if (!line.startsWith('! ')) fail(index, 'not a path, a "Name: value" pair or a "! Name"');
      const name = line.slice(2).trim().toLowerCase();
      if (name === '' || /\s/.test(name)) fail(index, 'not a header name after "!"');
      rule.unset.push(name);
      return;
    }
    const colon = line.indexOf(':');
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === '' || /\s/.test(name)) fail(index, 'not a header name before the colon');
    if (value === '') fail(index, 'no value after the colon');
    const earlier = rule.set.find(([known]) => known === name);
    if (earlier) earlier[1] = `${earlier[1]}, ${value}`;
    else rule.set.push([name, value]);
  });

  for (const each of rules) {
    if (each.set.length === 0 && each.unset.length === 0) throw new Error(`_headers: the block for ${each.path} has no header`);
  }
  if (rules.length > MAX_RULES) throw new Error(`_headers: ${rules.length} rules, and Cloudflare takes ${MAX_RULES}`);
  return rules;
}

/**
 * Lays the rules that match a request path over an answer's headers, as
 * Cloudflare does: every matching rule in file order; a rule first takes
 * away what it unsets and then adds its own. The first rule to name a header
 * replaces what the server sent by itself (so a rule can change
 * Cache-Control); a later rule's value for the same header is appended.
 */
export function applyHeaderRules(rules: readonly HeaderRule[], pathname: string, headers: Headers): void {
  const added = new Set<string>();
  for (const rule of rules) {
    const match = rule.pattern.exec(pathname);
    if (!match) continue;
    for (const name of rule.unset) headers.delete(name);
    for (const [name, written] of rule.set) {
      // A value may quote the part of the path its "*" stood for.
      const value = match.groups?.splat === undefined ? written : written.replaceAll(':splat', match.groups.splat);
      if (added.has(name)) headers.append(name, value);
      else headers.set(name, value);
      added.add(name);
    }
  }
}

// -- files ------------------------------------------------------------------------

/** Files Cloudflare reads for itself and never serves. */
const NEVER_SERVED = new Set(['_headers', '_redirects', '.assetsignore']);

/**
 * Files that change what Cloudflare serves, and that this server cannot
 * apply: redirects of its own, and a list of files to leave out.
 */
const NOT_APPLIED = ['_redirects', '.assetsignore'];

/** Stops on a build that holds a file this server would have to apply and cannot. */
function refuseWhatIsNotApplied(dist: string): void {
  for (const name of NOT_APPLIED) {
    if (existsSync(join(dist, name))) {
      throw new Error(`serve: ${dist} holds ${name}. Cloudflare applies that file and the local server does not, so paths would be answered differently here than on the deployed site`);
    }
  }
}

/**
 * A request path as Cloudflare's network hands it on. Before the Worker or
 * the files see a request, the network tidies its path. Slashes in a row
 * become one: that is done for every site and cannot be switched off. And,
 * under a setting that is on unless the zone's owner switches it off
 * ("Normalize incoming URLs"): an escape that stands for a plain letter, a
 * digit, "-", ".", "_" or "~" is read, so "%77allet" is "wallet"; every
 * other escape stays an escape, written in capitals. Nothing is redirected:
 * the address in the reader's browser stays as it was typed.
 *
 * From Cloudflare's documentation (developers.cloudflare.com/rules/normalization/),
 * not from a look at a deployed zone.
 */
export function networkPath(pathname: string): string {
  return pathname.replace(/\/{2,}/g, '/').replace(/%[0-9A-Fa-f]{2}/g, (escape) => {
    const char = String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return /^[A-Za-z0-9._~-]$/.test(char) ? char : escape.toUpperCase();
  });
}

/** A request path with its percent-escapes read. A part that cannot be read stays as it came. */
function decodePath(pathname: string): string {
  return pathname
    .split('/')
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join('/')
    .replace(/\/+/g, '/');
}

/** The other way: a read path as Cloudflare writes it, each part escaped again. */
function encodePath(path: string): string {
  return path
    .split('/')
    .map((part) => {
      try {
        return encodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join('/');
}

/**
 * The file a path names inside `root`, or null. Only a regular file whose
 * real location is exactly root + path counts: so no ".." can climb out, no
 * link can point out, a directory is not a file (there are no listings), and
 * a name in the wrong case is no file even where the disk would find it
 * (Cloudflare's file names are exact, and a Mac's are not).
 */
async function findFile(root: string, path: string): Promise<string | null> {
  // A path that ends in a slash names a folder, never a file.
  if (path.endsWith('/')) return null;
  const parts = path.split('/').filter((part) => part !== '');
  for (const part of parts) {
    if (part === '.' || part === '..' || part.includes('\\') || part.includes('\0')) return null;
    if (NEVER_SERVED.has(part)) return null;
  }
  try {
    const wanted = join(await realpath(root), ...parts);
    if ((await realpath(wanted)) !== wanted) return null;
    return (await stat(wanted)).isFile() ? wanted : null;
  } catch {
    return null; // no such file
  }
}

// -- the server -------------------------------------------------------------------

export interface ServeOptions {
  /** The built app: the directory that holds index.html and _headers. */
  dist: string;
  /** Answers /api/* and /p/*: the Worker's handler (stack.ts). */
  handler: Handler;
  /** Default 0: any free port. */
  port?: number;
  /** Default: the IPv4 loopback address. */
  host?: string;
  /**
   * Default true: refuse to start unless `dist` holds index.html and a
   * _headers file that can be read whole. "pnpm dev" passes false, since it
   * may start before the first build; a path with no app then answers 404
   * with a line that says how to get one.
   */
  requireApp?: boolean;
}

export interface LocalServer {
  /** http://localhost:<port>. The name matters: a passkey can be made on "localhost" and not on an IP address. */
  url: string;
  port: number;
  /** Every request this server could not answer because of a fault of its own. A clean run leaves it empty. */
  faults: string[];
  close(): Promise<void>;
}

/** A host name or an IP address, with or without a port: what a Host header may hold. */
const HOST = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?$/;

/**
 * The address a request was sent to, built from its Host header, as the
 * Worker sees it in production. The handler compares a POST's Origin header
 * with this, so it has to be the host the browser used ("localhost:5173"
 * behind Vite's proxy), not the address this server listens on.
 *
 * It always starts with http://: this server speaks no TLS, and takes
 * nobody's word (an X-Forwarded-Proto header, say) that something in front
 * of it does. So behind a tunnel that adds HTTPS, a page's POSTs are
 * refused: their Origin says https. The path is tidied as Cloudflare's
 * network tidies it (networkPath).
 */
function requestUrl(request: IncomingMessage): URL | null {
  const host = request.headers.host;
  const target = request.url ?? '';
  // Only "GET /path": a target that names its own host is not taken at its word.
  if (host === undefined || !HOST.test(host) || !target.startsWith('/')) return null;
  try {
    const url = new URL(`http://${host}${target}`);
    url.pathname = networkPath(url.pathname);
    return url;
  } catch {
    return null;
  }
}

function plain(response: ServerResponse, status: number, text: string, extra: Record<string, string> = {}): void {
  const body = Buffer.from(`${text}\n`);
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.byteLength, ...extra });
  response.end(body);
}

function writeHeaders(response: ServerResponse, headers: Headers): void {
  for (const [name, value] of headers) {
    if (name !== 'set-cookie') response.setHeader(name, value);
  }
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) response.setHeader('set-cookie', cookies);
}

/**
 * A request's body as the stream a Request carries. Cloudflare hands a
 * Worker the body as it arrives, whatever its size, and the Worker's handler
 * stops reading at its own cap. So here: nothing is read from the sender
 * before the handler asks for it, and this server sets no limit of its own.
 *
 * `drop` ends it: what has not been read by then is read and thrown away,
 * so that the answer can go out and the connection can carry the next
 * request. (The stream Node itself would make of a request ends the whole
 * connection when its reader lets go early, and with it the answer.)
 */
function bodyOf(request: IncomingMessage): { stream: ReadableStream<Uint8Array>; drop(): void } {
  let wanted = true;
  const drop = (): void => {
    wanted = false;
    request.resume();
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      request.on('data', (chunk: Buffer) => {
        if (!wanted) return;
        controller.enqueue(new Uint8Array(chunk));
        // The reader has enough for now: the sender waits.
        if ((controller.desiredSize ?? 0) <= 0) request.pause();
      });
      request.on('end', () => {
        if (wanted) controller.close();
        wanted = false;
      });
      // A sender that goes away in the middle: the reader is told, and reads no more.
      const gone = (): void => {
        if (wanted && !request.complete) controller.error(new Error('the sender went away'));
        wanted = false;
      };
      request.on('error', gone);
      request.on('close', gone);
    },
    pull() {
      if (wanted) request.resume();
    },
    cancel() {
      drop();
    },
  });
  return { stream, drop };
}

async function passToHandler(handler: Handler, url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  // Every header as it was received, repeated ones included.
  const headers = new Headers();
  for (let i = 0; i + 1 < request.rawHeaders.length; i += 2) headers.append(request.rawHeaders[i]!, request.rawHeaders[i + 1]!);
  // Cloudflare tells a Worker where a request came from in this header, and
  // a reader cannot set it. Here every reader is this machine.
  headers.set('CF-Connecting-IP', request.socket.remoteAddress ?? '127.0.0.1');

  const body = method === 'GET' || method === 'HEAD' ? null : bodyOf(request);
  try {
    let asked: Request;
    try {
      // "duplex" is what a Request with a stream for a body has to say. The page types of this compiler do not know the word yet.
      asked = new Request(url, { method, headers, body: body?.stream ?? null, duplex: 'half' } as RequestInit);
    } catch {
      // A method a Request cannot carry (TRACE, CONNECT).
      return plain(response, 405, 'Method not allowed.');
    }
    const answered = await handler(asked);
    const bytes = Buffer.from(await answered.arrayBuffer());
    response.statusCode = answered.status;
    writeHeaders(response, answered.headers);
    response.setHeader('Content-Length', bytes.byteLength);
    response.end(bytes);
  } finally {
    // Whatever the handler left unread (all of it, when a cap was passed) is read and thrown away.
    body?.drop();
  }
}

async function serveFile(dist: string, requireApp: boolean, url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const index = await findFile(dist, '/index.html');
  if (index === null && !requireApp) {
    return plain(response, 404, `No built app in ${dist}. Run "pnpm build", or use the Vite dev server on port 5173. /api/ and /p/ answer here either way.`);
  }
  // Read on every request: under "pnpm dev" a new build replaces the files while the server runs.
  refuseWhatIsNotApplied(dist);
  const rules = parseHeadersFile(await readFile(join(dist, '_headers'), 'utf8').catch(() => ''));
  const headers = new Headers();
  const send = (status: number, body: Buffer | null): void => {
    applyHeaderRules(rules, url.pathname, headers);
    writeHeaders(response, headers);
    response.statusCode = status;
    response.end(body !== null && request.method !== 'HEAD' ? body : undefined);
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // No Allow header: Cloudflare's file server sends none with its 405.
    headers.set('Content-Length', '0');
    return send(405, null);
  }

  const path = decodePath(url.pathname);
  // The home page's other names lead back to it, one step at a time, as on Cloudflare.
  const destination = path === '/index.html' || path === '/index' ? '/' : path === '/index/' ? '/index' : path;
  // A path is served under the spelling Cloudflare itself would write: read,
  // then escaped again. Any other spelling ("a+b" for "a%2Bb", "%2F" for a
  // slash) is sent to that one, together with the redirects above.
  const spelled = encodePath(destination);
  if (spelled !== url.pathname) {
    headers.set('Location', `${spelled}${url.search}`);
    headers.set('Content-Length', '0');
    return send(307, null);
  }

  // The file asked for, or the app's one page for every path that names no file.
  const file = path === '/' ? index : ((await findFile(dist, path)) ?? index);
  if (file === null) {
    headers.set('Content-Length', '0');
    return send(404, null);
  }
  const whole = await readFile(file);
  const type = contentType(file);
  const etag = `"${createHash('sha256').update(whole).digest('hex').slice(0, 32)}"`;
  const accepted = request.headers['accept-encoding'];
  const { bytes, encoding } = encode(whole, type, typeof accepted === 'string' ? accepted : undefined);
  if (type !== null) headers.set('Content-Type', type);
  // The tag names the file. Compressed, the bytes are another form of it, which a tag says with "W/".
  headers.set('ETag', encoding === null ? etag : `W/${etag}`);
  if (type !== null && COMPRESSIBLE.test(type)) headers.set('Vary', 'Accept-Encoding');
  // What Cloudflare sends by itself for a file: keep a copy, but ask before using it.
  if (request.headers.authorization === undefined && request.headers.range === undefined) {
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  }
  const known = request.headers['if-none-match'];
  if (known === etag || known === `W/${etag}`) return send(304, null);
  if (encoding !== null) headers.set('Content-Encoding', encoding);
  headers.set('Content-Length', String(bytes.byteLength));
  send(200, bytes);
}

export async function serve(options: ServeOptions): Promise<LocalServer> {
  const { dist, handler } = options;
  const requireApp = options.requireApp ?? true;
  if (requireApp) {
    if ((await findFile(dist, '/index.html')) === null) throw new Error(`serve: no index.html in ${dist} (run "pnpm build" first)`);
    // Fails here, not on the first request, when the policy file is missing or cannot be read whole.
    const policy = await readFile(join(dist, '_headers'), 'utf8').catch(() => null);
    if (policy === null) throw new Error(`serve: no _headers file in ${dist}: the pages would be served without their security policy`);
    parseHeadersFile(policy);
    refuseWhatIsNotApplied(dist);
  }

  const faults: string[] = [];
  const server = createServer((request, response) => {
    const url = requestUrl(request);
    if (url === null) return plain(response, 400, 'Bad request.');
    const toWorker = url.pathname.startsWith('/api/') || url.pathname.startsWith('/p/');
    const answered = toWorker ? passToHandler(handler, url, request, response) : serveFile(dist, requireApp, url, request, response);
    answered.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      faults.push(`${request.method} ${url.pathname}: ${message}`);
      if (response.headersSent) response.destroy();
      else plain(response, 500, `Local server fault: ${message}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://localhost:${port}`,
    port,
    faults,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
