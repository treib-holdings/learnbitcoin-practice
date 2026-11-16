// Checks a running practice wallet from the outside: the headers its pages
// are served with, which pages a search engine may list, and that the Worker
// answers its own paths in its own way.
//
//   node tools/live-check/live-check.ts https://practice.learnbitcoin.com
//   node tools/live-check/live-check.ts http://localhost:8787       (pnpm dev, after pnpm build)
//
// It prints one line per check and exits with 1 if any failed (2 when it was
// not told where to look). It only reads, except for two POSTs that must be
// refused. It needs nothing but Node.
//
// One request goes by what the site's own settings say. While GET
// /api/config says that the pot's counts are off, which is how the Worker
// ships, the check asks for the counts once and expects the answer of a
// path the Worker does not know. Asked that way the request costs the
// practice network nothing. Where the settings say that the counts are on,
// it does not ask for them at all.
//
// What it expects comes from two places. The pages' headers are read from
// app/public/_headers, the file the build ships, so a deploy that lost the
// file, or serves an old one, shows. The Content-Security-Policy is also
// written out below a second time, on purpose: loosening the policy then
// takes a change in two places, and this check fails until both agree.
//
// What one page must carry is worked out from that file for the page's own
// path: the headers of every block whose path matches it. Cloudflare's rule
// for matching a path is written out below, since this script imports
// nothing from the rest of the repository. A header the file names for
// other paths only must be absent.
//
// The file is not taken at its word for everything, since a mistake in it
// would then pass: the site would be serving just what the file says. So
// three more things are said outright below, whatever the file says. The
// home page comes without X-Robots-Tag, since it is the one page a search
// engine may list. Every other page this check asks for is marked, with
// "X-Robots-Tag: noindex". And no page's Strict-Transport-Security has a
// shorter max-age than the one this script holds for the Worker's own
// answers.
//
// Every header is compared letter for letter, but one. A
// Strict-Transport-Security passes with a max-age at least as long as the
// one expected, whatever else it says. Our files send a plain
// "max-age=31536000". On the deployed site every answer carries
// "max-age=31536000; includeSubDomains; preload", and so does the main
// site on the same domain, which this repository does not serve: so the
// header is put on after the Worker has answered. (Cloudflare has a
// setting that does this for a whole domain. Whether that is what does it
// here has not been looked at.) The longer value is stricter, not weaker,
// and ours stays in the files as the floor under it.

import { readFileSync } from 'node:fs';

/** The pages' Content-Security-Policy, exactly (SPEC section 11). */
export const PAGE_CSP =
  "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self'; font-src 'self'; " +
  "connect-src 'self'; frame-src https://challenges.cloudflare.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** What every answer written by the Worker carries (worker/src/headers.ts). */
export const WORKER_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000',
};

/**
 * The shortest Strict-Transport-Security a page may come with, whatever the
 * headers file says: the one this script holds for the Worker's own answers.
 */
const PAGE_STS_FLOOR = WORKER_HEADERS['strict-transport-security']!;

const JSON_TYPE = 'application/json; charset=utf-8';

/** A page of the app that is no file: the server has to answer it with the app itself. */
const DEEP_PATH = '/wallet/receive';

/** Another one, with a path of one part: the headers file names such a path in a block of its own. */
const ONE_PART_PATH = '/about';

/** Every page this check asks for. */
const PAGES = [DEEP_PATH, ONE_PART_PATH, '/'];

/**
 * The keys of GET /api/config, and the kind of value each holds (contract/src/index.ts, AppConfig). The list is
 * written out by hand, since this script imports nothing from the rest of the repository, so nothing but a test
 * can hold it to the contract: e2e/test/live-check.test.ts takes each key of the Worker's own answer away in
 * turn, and this check must then name it as missing. A setting that is added to the contract and not here
 * fails there.
 *
 * `potCounts` says whether the pot's counts can be had. It is false as the Worker ships (POT_COUNTS in
 * worker/wrangler.jsonc), and what is expected of GET /api/pot/stats goes by it (POT_STATS_PATH below).
 */
const CONFIG_KEYS: Readonly<Record<string, 'string' | 'number' | 'boolean'>> = {
  turnstileSiteKey: 'string',
  explorerUrl: 'string',
  electrumHost: 'string',
  electrumPort: 'number',
  siteUrl: 'string',
  sourceUrl: 'string',
  passkeyHost: 'string',
  faucetSats: 'number',
  blockSeconds: 'number',
  events: 'boolean',
  potCounts: 'boolean',
};

/** A path under /api/ that the Worker does not know: what it answers here is its answer to any unknown path. */
const UNKNOWN_PATH = '/api/no-such-path';

/**
 * The pot's counts (contract/src/index.ts, API.potStats). While the site's settings say that the counts
 * cannot be had (`potCounts` false), the Worker does not know this path: it must answer it exactly as it
 * answers UNKNOWN_PATH. Asked that way the request costs the practice network nothing: the Worker counts
 * nothing at its limiter and asks its origin nothing. Where the settings say true, this check does not ask
 * at all: an answered look can cost the practice network a reading of the pot's coins.
 */
const POT_STATS_PATH = '/api/pot/stats';

export interface Check {
  name: string;
  ok: boolean;
  /** For a failed check: what was expected and what came. */
  detail: string;
}

/** One block of _headers. */
export interface HeaderBlock {
  /** The path as written: "/*", "/:part". */
  path: string;
  /** The path as a pattern for a whole request path. */
  pattern: RegExp;
  /** The headers the block adds, with lower-case names. */
  set: [name: string, value: string][];
}

export interface Expectations {
  /** The blocks of _headers, in the order written. */
  blocks: HeaderBlock[];
  /** The text of robots.txt. */
  robots: string;
}

/**
 * A block's path as a pattern, made the way Cloudflare's file server makes
 * it. Every character stands for itself, with two exceptions: a "*" takes
 * any run of characters (and is named "splat"), and a ":name" takes one or
 * more characters that are not a slash. The pattern covers the whole path.
 */
function pathPattern(path: string): RegExp {
  let source = path
    .split('*')
    .map((part) => part.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'))
    .join('(?<splat>.*)');
  // The names are found once, and each is then replaced wherever it is written.
  for (const [written, name] of source.matchAll(/:([A-Za-z]\w*)/g)) source = source.split(written).join(`(?<${name}>[^/]+)`);
  return new RegExp(`^${source}$`);
}

/**
 * A block's path as Cloudflare's parser reads it, or null if it cannot be
 * read. The parser, as it ships in wrangler, reads a path the way the path
 * of a web address is read before a pattern is made of it, with the same
 * call as this. Most paths come out as they went in. Some do not:
 * "/wallet?tab=1" comes out as "/wallet", "/a/../about" as "/about", and
 * "/{id}" as "/%7Bid%7D".
 */
function pathAsRead(path: string): string | null {
  try {
    return new URL(`//${path}`, 'relative://').pathname;
  } catch {
    return null;
  }
}

/**
 * Reads the blocks of the app's _headers file. Header names come back in
 * lower case, and the same name twice in one block is one header, joined
 * with a comma, as Cloudflare reads it.
 *
 * It throws for a file that cannot say what a page must carry. One case is a
 * "! Name" line, which takes a header away that another block added: on the
 * deployed site the home page kept a header that such a line was to take
 * away, so nothing can be worked out from one. Another is a path that
 * Cloudflare would read as another path than the one written: Cloudflare
 * applies the block to the path it read, and the pattern here would be made
 * of the path as written.
 */
export function readExpectations(headersText: string, robots: string): Expectations {
  const blocks: HeaderBlock[] = [];
  let block: HeaderBlock | null = null;
  for (const raw of headersText.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('/')) {
      if (blocks.some((earlier) => earlier.path === line)) throw new Error(`_headers: the path ${line} twice`);
      const read = pathAsRead(line);
      if (read === null) throw new Error(`_headers: the path ${line} cannot be read as the path of an address`);
      if (read !== line) throw new Error(`_headers: Cloudflare would read the path ${line} as ${read}, and what a page must carry cannot be worked out from the path as written`);
      let pattern: RegExp;
      try {
        pattern = pathPattern(line);
      } catch {
        throw new Error(`_headers: no pattern can be made of the path ${line}`);
      }
      block = { path: line, pattern, set: [] };
      blocks.push(block);
    } else if (/^[^\s/:]+:\/\//.test(line)) {
      // Cloudflare takes such a line as a rule for one host. Read as "Name: value" it would be a header named "https".
      throw new Error(`_headers: the line ${JSON.stringify(raw)} is a rule for one host, and this check works out what a page must carry from its path alone`);
    } else if (block !== null && line.startsWith('! ')) {
      throw new Error(`_headers: the line ${JSON.stringify(raw)} takes a header away, and what a page must carry cannot be worked out from such a line`);
    } else if (block !== null && line.includes(':')) {
      const colon = line.indexOf(':');
      const name = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      const earlier = block.set.find(([known]) => known === name);
      if (earlier) earlier[1] = `${earlier[1]}, ${value}`;
      else block.set.push([name, value]);
    } else {
      throw new Error(`_headers: cannot read the line ${JSON.stringify(raw)}`);
    }
  }
  if (!blocks.some((each) => each.path === '/*' && each.set.length > 0)) throw new Error('_headers: no "/*" block');
  const expect = { blocks, robots };
  // Fails here, before anything is asked, if the file cannot say what one of the pages must carry.
  for (const path of PAGES) expectedHeaders(expect, path);
  return expect;
}

/**
 * What a path must carry, worked out from the file: for every header the
 * file names in any block, the value the blocks that match the path give
 * it, or null where none of them names it (the path must come without it).
 *
 * It throws when two blocks that match the path name the same header.
 * Cloudflare would join their values in the order it applies the blocks in,
 * and for the deployed site that order is not known.
 */
export function expectedHeaders(expect: Expectations, path: string): [name: string, value: string | null][] {
  const carried = new Map<string, string | null>();
  for (const block of expect.blocks) for (const [name] of block.set) carried.set(name, null);
  for (const block of expect.blocks) {
    const match = block.pattern.exec(path);
    if (match === null) continue;
    for (const [name, written] of block.set) {
      if (carried.get(name) !== null) throw new Error(`_headers: two blocks that match ${path} name ${name}, so its value would depend on the order the blocks are applied in`);
      // A value may quote what the path's "*" or a ":name" of it stood for, as ":splat" or ":name".
      let value = written;
      for (const [capture, text] of Object.entries(match.groups ?? {})) value = value.replaceAll(`:${capture}`, text);
      carried.set(name, value);
    }
  }
  return [...carried];
}

/**
 * One directive of a Strict-Transport-Security value: a name, or a name and
 * a value. A value in quotes is not taken: see maxAgeOf.
 */
const DIRECTIVE = /^([A-Za-z0-9!#$%&'*+.^_`|~-]+)(?:[ \t]*=[ \t]*([A-Za-z0-9!#$%&'*+.^_`|~-]+))?$/;

/**
 * The max-age of a Strict-Transport-Security value, in seconds, or null for
 * a value that cannot be read. A value is a list of directives with ";"
 * between them: "max-age=31536000", and others that this check does not
 * look into ("includeSubDomains", "preload").
 *
 * It is read strictly. max-age has to be there once, as plain digits, and
 * no directive may come twice: a browser that cannot read the header sets
 * it aside, and the protection with it. Two headers of this name also read
 * as one value that cannot be read, since they arrive joined by a comma.
 *
 * In two places that is stricter than a browser, on purpose. The rule for
 * this header (RFC 6797) lets a browser take a value in quotes
 * (max-age="31536000"): here no value in quotes can be read, whichever
 * directive it belongs to. And it tells a browser to use the first of two
 * headers of this name and pass over the second: here two headers cannot
 * be read where the first would do by itself. The two go together: a comma
 * inside quotes would otherwise let two headers pass as one. In this check
 * a false alarm is better than a false pass.
 */
export function maxAgeOf(value: string): number | null {
  const seen = new Set<string>();
  let seconds: number | null = null;
  for (const part of value.split(';')) {
    // Only a space and a tab are blanks in this header. Any other blank
    // character (a no-break space, say) is part of the text, and a browser
    // sets a header with such a character aside: so it is not trimmed away.
    const piece = part.replace(/^[ \t]+|[ \t]+$/g, '');
    // An empty place between two semicolons, or after the last one, is no fault.
    if (piece === '') continue;
    const directive = DIRECTIVE.exec(piece);
    if (directive === null) return null;
    const name = directive[1]!.toLowerCase();
    if (seen.has(name)) return null;
    seen.add(name);
    // includeSubDomains takes no value. Given one, a browser sets the whole header aside.
    if (name === 'includesubdomains' && directive[2] !== undefined) return null;
    if (name !== 'max-age') continue;
    if (directive[2] === undefined || !/^[0-9]+$/.test(directive[2])) return null;
    seconds = Number(directive[2]);
  }
  return seconds;
}

interface Got {
  status: number;
  headers: Headers;
  body: string;
}

const AGENT = 'learnbitcoin-practice-live-check';

async function ask(base: string, path: string, init: RequestInit = {}): Promise<Got> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'User-Agent': AGENT, ...(init.headers as Record<string, string> | undefined) },
    // A redirect is an answer to look at, not one to follow.
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

const show = (value: string | null) => (value === null ? 'no such header' : JSON.stringify(value));

/**
 * Runs every check against `base` (an origin, with no slash at its end) and
 * gives the list. Never throws for something the server did: a request that
 * fails is a failed check.
 */
export async function liveCheck(base: string, expect: Expectations): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail = ''): void => {
    checks.push({ name, ok, detail: ok ? '' : detail });
  };
  /** One request and the checks on its answer. If the request itself fails, that is the one check. */
  const on = async (label: string, path: string, init: RequestInit | undefined, look: (got: Got) => void): Promise<void> => {
    let got: Got;
    try {
      got = await ask(base, path, init);
    } catch (error) {
      return check(`${label}: an answer`, false, `the request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    look(got);
  };
  const header = (label: string, got: Got, name: string, value: string | null): void => {
    const came = got.headers.get(name);
    if (name === 'strict-transport-security' && value !== null) {
      // The one header that may say more than is expected of it (the top of this file says why).
      const least = maxAgeOf(value);
      const comes = came === null ? null : maxAgeOf(came);
      return check(`${label}: ${name}`, least !== null && comes !== null && comes >= least, `expected ${show(value)} or a longer max-age, got ${show(came)}`);
    }
    check(`${label}: ${name}${value === null ? ' is absent' : ''}`, came === value, `expected ${show(value)}, got ${show(came)}`);
  };
  const isPage = (label: string, got: Got): void => {
    const type = got.headers.get('content-type') ?? '';
    check(`${label}: 200, and it is the app's page`, got.status === 200 && type.startsWith('text/html') && got.body.includes('<div id="app">'), `status ${got.status}, type ${show(type)}`);
  };

  // -- the pages --
  for (const path of PAGES) {
    const label = `GET ${path}`;
    await on(label, path, undefined, (got) => {
      isPage(label, got);
      // What the file gives this path, and nothing of what it gives other paths only.
      for (const [name, value] of expectedHeaders(expect, path)) header(label, got, name, value);
      header(`${label} (the policy, as written in this script)`, got, 'content-security-policy', PAGE_CSP);
      // Said outright, whatever the file says: the home page is the one page a search engine may list,
      // and every other page asked for here is marked. A file that lost a noindex block would otherwise
      // pass, since what is served would agree with it.
      if (path === '/') header('GET / (may be listed)', got, 'x-robots-tag', null);
      else header(`${label} (must not be listed)`, got, 'x-robots-tag', 'noindex');
      // The same for a max-age made shorter in the file: no page may come with a shorter one than the floor.
      header(`${label} (the floor, as written in this script)`, got, 'strict-transport-security', PAGE_STS_FLOOR);
    });
  }
  await on('GET /robots.txt', '/robots.txt', undefined, (got) => {
    const type = got.headers.get('content-type') ?? '';
    check('GET /robots.txt: 200, plain text', got.status === 200 && type.startsWith('text/plain'), `status ${got.status}, type ${show(type)}`);
    check('GET /robots.txt: the text of app/public/robots.txt', got.body.trim() === expect.robots.trim(), `got ${JSON.stringify(got.body.slice(0, 200))}`);
    const lines = got.body.split('\n').map((line) => line.trim());
    check('GET /robots.txt: keeps crawlers out of /api/ and /p/', lines.includes('Disallow: /api/') && lines.includes('Disallow: /p/'), `got ${JSON.stringify(got.body.slice(0, 200))}`);
  });

  // -- the Worker --
  /** What every answer the Worker writes carries, whatever it says: a refusal and the config alike. */
  const workerHeaders = (label: string, got: Got): void => {
    header(label, got, 'content-type', JSON_TYPE);
    for (const [name, value] of Object.entries(WORKER_HEADERS)) header(label, got, name, value);
    // No page of another site may read the Worker's answers in this phase (SPEC section 10).
    header(label, got, 'access-control-allow-origin', null);
  };
  const workerAnswer = (label: string, got: Got, status: number, error: string): void => {
    let body: unknown = null;
    try {
      body = JSON.parse(got.body);
    } catch {
      // Not JSON: the check below says so.
    }
    const right = got.status === status && typeof body === 'object' && body !== null && (body as { error?: unknown }).error === error;
    check(`${label}: ${status} {"error":"${error}"}`, right, `status ${got.status}, body ${JSON.stringify(got.body.slice(0, 120))}`);
    workerHeaders(label, got);
  };
  /** What two of the answers said, for the check on the pot's counts further down. */
  const seen: { unknown: Got | null; potCounts: boolean | null } = { unknown: null, potCounts: null };
  for (const path of [UNKNOWN_PATH, '/p/no-such-path']) {
    await on(`GET ${path}`, path, undefined, (got) => {
      if (path === UNKNOWN_PATH) seen.unknown = got;
      workerAnswer(`GET ${path}`, got, 404, 'not_found');
    });
  }
  await on('GET /api/config', '/api/config', undefined, (got) => {
    let config: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(got.body);
      if (typeof parsed === 'object' && parsed !== null) config = parsed as Record<string, unknown>;
    } catch {
      // Not JSON: the checks below say so.
    }
    const wrong = Object.entries(CONFIG_KEYS).filter(([key, kind]) => typeof config[key] !== kind).map(([key]) => key);
    check('GET /api/config: 200, with every setting', got.status === 200 && wrong.length === 0, `status ${got.status}; missing or of the wrong kind: ${wrong.join(', ') || 'none'}`);
    // The one answer here that is not a refusal: it has to come with the same headers as the others.
    workerHeaders('GET /api/config', got);
    // Only a settings answer that was read, and says it in so many words, counts as "the counts are off".
    if (got.status === 200 && typeof config.potCounts === 'boolean') seen.potCounts = config.potCounts;
  });
  // The pot's counts, while the settings say that they are off: a path the Worker does not know, answered as
  // any other one is. The same status, the same body, the Worker's headers. (Where the settings say that they
  // are on, or could not be read, nothing is asked: see POT_STATS_PATH.)
  if (seen.potCounts === false) {
    const label = `GET ${POT_STATS_PATH} (the settings say the pot's counts are off)`;
    await on(label, POT_STATS_PATH, undefined, (got) => {
      const unknown = seen.unknown;
      const same = unknown !== null && got.status === unknown.status && got.body === unknown.body;
      const expected = unknown === null ? `GET ${UNKNOWN_PATH} was not answered, so there is nothing to hold it to` : `expected status ${unknown.status}, body ${JSON.stringify(unknown.body.slice(0, 120))}`;
      check(`${label}: answered as GET ${UNKNOWN_PATH} is`, same, `${expected}; got status ${got.status}, body ${JSON.stringify(got.body.slice(0, 120))}`);
      workerHeaders(label, got);
    });
  }
  // A POST that names another site as its sender, and one that names nobody. Neither may be answered.
  await on('POST /api/pot/address from another site', '/api/pot/address', { method: 'POST', headers: { Origin: 'https://elsewhere.example' } }, (got) =>
    workerAnswer('POST /api/pot/address from another site', got, 403, 'forbidden'),
  );
  await on('POST /api/pot/address from no page at all', '/api/pot/address', { method: 'POST' }, (got) =>
    workerAnswer('POST /api/pot/address from no page at all', got, 403, 'forbidden'),
  );

  return checks;
}

/** What the repository says the server must send. */
export function repositoryExpectations(): Expectations {
  return readExpectations(
    readFileSync(new URL('../../app/public/_headers', import.meta.url), 'utf8'),
    readFileSync(new URL('../../app/public/robots.txt', import.meta.url), 'utf8'),
  );
}

async function main(): Promise<number> {
  const given = process.argv[2];
  let base: URL;
  try {
    base = new URL(given ?? '');
  } catch {
    console.error('usage: node tools/live-check/live-check.ts <base URL>, for example https://practice.learnbitcoin.com');
    return 2;
  }
  const checks = await liveCheck(base.origin, repositoryExpectations());
  for (const each of checks) console.log(each.ok ? `ok    ${each.name}` : `FAIL  ${each.name}: ${each.detail}`);
  const failed = checks.filter((each) => !each.ok).length;
  console.log(failed === 0 ? `all ${checks.length} checks passed for ${base.origin}` : `${failed} of ${checks.length} checks FAILED for ${base.origin}`);
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
