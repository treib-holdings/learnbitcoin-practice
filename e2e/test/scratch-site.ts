// A throwaway site for the harness's own tests: a few files in a temporary
// folder, served by the local server under the app's real headers.
// (Not a test file itself: it only exports.)

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after } from 'node:test';
import type { Handler } from '@learnbitcoin/practice-worker';
import { serve, type LocalServer } from '../src/serve.ts';

/** The app's own _headers file, as it is in the source. */
export const APP_HEADERS = readFileSync(new URL('../../app/public/_headers', import.meta.url), 'utf8');

/** A page that loads one script of its own origin, which is all the app's policy lets a page do. */
export const PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>scratch</title></head><body><div id="app"></div><script src="/page.js"></script></body></html>';

/** Stands where the Worker's handler would: every /api/ and /p/ path is the JSON 404. */
export const notFound: Handler = async () =>
  new Response('{"error":"not_found"}', { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

const made: string[] = [];
after(() => {
  for (const folder of made) rmSync(folder, { recursive: true, force: true });
});

/**
 * Writes `files` (path -> content) into a new temporary folder and gives the
 * folder. Unless `files` says otherwise it also holds index.html (PAGE) and
 * the app's own _headers. The folder is removed when the test file ends.
 */
export function scratchDist(files: Record<string, string | Uint8Array> = {}): string {
  const folder = mkdtempSync(join(tmpdir(), 'lbp-test-'));
  made.push(folder);
  const dist = join(folder, 'dist');
  for (const [path, content] of Object.entries({ 'index.html': PAGE, _headers: APP_HEADERS, ...files })) {
    const file = join(dist, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dist;
}

const servers: LocalServer[] = [];
after(async () => {
  for (const server of servers) await server.close();
});

/** A scratch folder on a local server of its own, closed when the test file ends. */
export async function scratchSite(files: Record<string, string | Uint8Array> = {}, handler: Handler = notFound): Promise<LocalServer & { dist: string }> {
  const dist = scratchDist(files);
  const server = await serve({ dist, handler });
  servers.push(server);
  return { ...server, dist };
}
