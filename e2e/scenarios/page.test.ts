// The app's pages as a browser gets them: under the headers of
// app/public/_headers, with every file from this origin.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHeadersFile } from '../src/serve.ts';
import { scenario, type OpenedPage } from './helpers.ts';

/** The headers every page must carry: the "/*" block of the app's own _headers file, as written in the source. */
const POLICY = parseHeadersFile(readFileSync(new URL('../../app/public/_headers', import.meta.url), 'utf8'))[0]!.set;

/** The response that brought the page's document. */
function documentOf(page: OpenedPage, url: string) {
  const found = page.responses.find((response) => response.type === 'document' && response.url === url);
  assert.ok(found, `no document response for ${url}`);
  return found;
}

scenario('the page loads under its real headers: no console error, nothing blocked, both fonts from this origin', async (s) => {
  const page = await s.open('/');
  assert.equal(page.status, 200);

  // The headers of the "/*" block, each exactly as written. The home page alone may be listed by a search engine.
  const first = documentOf(page, `${s.url}/`);
  assert.match(first.headers['content-type'] ?? '', /^text\/html/);
  for (const [name, value] of POLICY) {
    if (name === 'x-robots-tag') assert.equal(first.headers[name], undefined, 'the home page carries no X-Robots-Tag');
    else assert.equal(first.headers[name], value, name);
  }
  assert.match(first.headers['content-security-policy'] ?? '', /^default-src 'none'; script-src 'self' /);

  // The app has drawn itself: the PRACTICE marker and a heading.
  assert.match(await page.page.$eval('[role="note"]', (note) => note.textContent ?? ''), /[Pp]ractice network/);
  assert.ok((await page.page.$eval('h1', (heading) => heading.textContent ?? '')).trim() !== '');

  // Both fonts are this origin's own files. A font is only fetched when text needs it, so each is asked for by name.
  const fonts = await page.page.evaluate(async () => {
    const out: { family: string; faces: string[] }[] = [];
    for (const family of ['Geist Variable', 'Geist Mono Variable']) {
      const faces = await document.fonts.load(`16px "${family}"`, 'Practice 0123');
      out.push({ family, faces: faces.map((face) => face.status) });
    }
    return out;
  });
  for (const font of fonts) {
    assert.ok(font.faces.length > 0, `${font.family}: no font face in the stylesheet`);
    assert.deepEqual([...new Set(font.faces)], ['loaded'], font.family);
  }
  const fontFiles = page.responses.filter((response) => response.type === 'font');
  assert.ok(fontFiles.some((file) => /\/assets\/geist-latin-/.test(file.url)), 'the text font was fetched');
  assert.ok(fontFiles.some((file) => /\/assets\/geist-mono-latin-/.test(file.url)), 'the monospace font was fetched');
  for (const file of fontFiles) {
    assert.ok(file.url.startsWith(`${s.url}/assets/`), file.url);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'font/woff2');
  }

  // Nothing came from anywhere else, and every file came with the policy's headers.
  for (const response of page.responses) {
    assert.ok(response.url.startsWith(`${s.url}/`), response.url);
    assert.equal(response.headers['x-content-type-options'], 'nosniff', response.url);
  }
});

scenario('a deep path gets the app, marked noindex; the home page is not marked', async (s) => {
  // No file is called /wallet/receive: the server answers with the app, and the app's router takes it from there.
  const deep = await s.open('/wallet/receive');
  assert.equal(deep.status, 200);
  const first = documentOf(deep, `${s.url}/wallet/receive`);
  assert.match(first.headers['content-type'] ?? '', /^text\/html/);
  assert.equal(first.headers['x-robots-tag'], 'noindex');
  for (const [name, value] of POLICY) assert.equal(first.headers[name], value, name);
  // The same app as at the root: its script ran and drew the page.
  assert.ok(deep.responses.some((response) => response.type === 'script' && response.status === 200));
  assert.ok((await deep.page.$eval('h1', (heading) => heading.textContent ?? '')).trim() !== '');

  // Spanish lives under /es, and is the same file again.
  const spanish = await s.open('/es/wallet');
  assert.equal(spanish.status, 200);
  assert.equal(documentOf(spanish, `${s.url}/es/wallet`).headers['x-robots-tag'], 'noindex');

  const home = await s.open('/');
  assert.equal(documentOf(home, `${s.url}/`).headers['x-robots-tag'], undefined);
});
