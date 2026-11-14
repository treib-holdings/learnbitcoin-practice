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
// What it expects comes from two places. The pages' headers are read from
// app/public/_headers, the file the build ships, so a deploy that lost the
// file, or serves an old one, shows. The Content-Security-Policy is also
// written out below a second time, on purpose: loosening the policy then
// takes a change in two places, and this check fails until both agree.

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

const JSON_TYPE = 'application/json; charset=utf-8';

/** A page of the app that is no file: the server has to answer it with the app itself. */
const DEEP_PATH = '/wallet/receive';

/** Every key of GET /api/config, and the kind of value it holds (contract/src/index.ts, AppConfig). */
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
};

export interface Check {
  name: string;
  ok: boolean;
  /** For a failed check: what was expected and what came. */
  detail: string;
}

export interface Expectations {
  /** The headers of the "/*" block of _headers: every page carries them. */
  everyPage: [name: string, value: string][];
  /** The headers the "/" block takes away again: the home page does not carry them. */
  notOnHome: string[];
  /** The text of robots.txt. */
  robots: string;
}

/** Reads the two blocks of the app's _headers file. Header names come back in lower case. */
export function readExpectations(headersText: string, robots: string): Expectations {
  const blocks = new Map<string, { set: [string, string][]; unset: string[] }>();
  let block: { set: [string, string][]; unset: string[] } | null = null;
  for (const raw of headersText.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('/')) {
      block = { set: [], unset: [] };
      blocks.set(line, block);
    } else if (block !== null && line.startsWith('! ')) {
      block.unset.push(line.slice(2).trim().toLowerCase());
    } else if (block !== null && line.includes(':')) {
      const colon = line.indexOf(':');
      block.set.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
    } else {
      throw new Error(`_headers: cannot read the line ${JSON.stringify(raw)}`);
    }
  }
  const everyPage = blocks.get('/*');
  if (!everyPage || everyPage.set.length === 0) throw new Error('_headers: no "/*" block');
  return { everyPage: everyPage.set, notOnHome: blocks.get('/')?.unset ?? [], robots };
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
    check(`${label}: ${name}${value === null ? ' is absent' : ''}`, came === value, `expected ${show(value)}, got ${show(came)}`);
  };
  const isPage = (label: string, got: Got): void => {
    const type = got.headers.get('content-type') ?? '';
    check(`${label}: 200, and it is the app's page`, got.status === 200 && type.startsWith('text/html') && got.body.includes('<div id="app">'), `status ${got.status}, type ${show(type)}`);
  };

  // -- the pages --
  await on(`GET ${DEEP_PATH}`, DEEP_PATH, undefined, (got) => {
    const label = `GET ${DEEP_PATH}`;
    isPage(label, got);
    for (const [name, value] of expect.everyPage) header(label, got, name, value);
    header(`${label} (the policy, as written in this script)`, got, 'content-security-policy', PAGE_CSP);
  });
  await on('GET /', '/', undefined, (got) => {
    isPage('GET /', got);
    for (const [name, value] of expect.everyPage) header('GET /', got, name, expect.notOnHome.includes(name) ? null : value);
    header('GET / (the policy, as written in this script)', got, 'content-security-policy', PAGE_CSP);
    // Said outright, whatever the file says: the home page is the one page a search engine may list.
    header('GET / (may be listed)', got, 'x-robots-tag', null);
  });
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
  for (const path of ['/api/no-such-path', '/p/no-such-path']) {
    await on(`GET ${path}`, path, undefined, (got) => workerAnswer(`GET ${path}`, got, 404, 'not_found'));
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
  });
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
