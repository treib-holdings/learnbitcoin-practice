// The app's pages as a browser gets them: under the headers of
// app/public/_headers, with every file from this origin. And what a
// browser with scripts switched off gets: the page's <noscript> lines, and
// the text file they send a reader to.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHeadersFile } from '../src/serve.ts';
import { scratchSite } from '../test/scratch-site.ts';
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
  for (const [name, value] of POLICY) assert.equal(first.headers[name], value, name);
  assert.equal(first.headers['x-robots-tag'], undefined, 'the home page carries no X-Robots-Tag');
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

scenario('a deep path and a path of one part get the app, marked noindex; the home page is not marked', async (s) => {
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

  // A path of one part is marked by a block of its own in the headers file, and comes under the same policy.
  const about = await s.open('/about');
  assert.equal(about.status, 200);
  const onePart = documentOf(about, `${s.url}/about`);
  assert.equal(onePart.headers['x-robots-tag'], 'noindex');
  for (const [name, value] of POLICY) assert.equal(onePart.headers[name], value, name);

  const home = await s.open('/');
  assert.equal(documentOf(home, `${s.url}/`).headers['x-robots-tag'], undefined);
});

scenario('Without JavaScript the page says where the sentences of About can be read, and that file is the page\'s own string table, which a browser reads as UTF-8 though its type names no charset', async (s) => {
  /** The About page's string table, as the repository has it: the bytes the build ships as /about.txt, behind a byte order mark. */
  const SOURCE = readFileSync(new URL('../../app/src/strings/about.ts', import.meta.url));
  const TEXT = SOURCE.toString('utf8');
  /** The mark: three bytes in front of the file, which tell a browser that it is UTF-8. */
  const MARK = Buffer.from([0xef, 0xbb, 0xbf]);
  /** A line of the Spanish half, with a letter that is two bytes in UTF-8. */
  const SPANISH = 'Qué guarda este navegador';

  // -- The file, as any client gets it: there, as plain text with no charset named (which is how the
  //    deployed site sends a text file), under the policy's headers, never listed, and the mark followed
  //    by the source file to the byte. --
  const got = await fetch(`${s.url}/about.txt`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'text/plain');
  for (const [name, value] of POLICY) assert.equal(got.headers.get(name), value, name);
  assert.equal(got.headers.get('x-robots-tag'), 'noindex');
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(Buffer.concat([MARK, SOURCE])), 'the file is a byte order mark and then app/src/strings/about.ts, to the byte');
  // Half of it is Spanish, and its letters outside ASCII are all in that half: for them it matters how a browser reads the file.
  assert.ok(TEXT.includes(SPANISH) && TEXT.includes('What this browser keeps'));

  // -- A browser shows it as the text it is. The app's router leaves the address alone: the page that
  //    answers is the file. Its type names no charset, and the browser reads it as UTF-8 all the same:
  //    the accented letters arrive whole, and the mark is no part of what is shown. --
  const page = await s.open('/about.txt');
  assert.equal(page.status, 200);
  const file = documentOf(page, `${s.url}/about.txt`);
  assert.equal(file.headers['content-type'], 'text/plain');
  assert.equal(file.headers['x-robots-tag'], 'noindex');
  assert.equal(await page.page.evaluate(() => document.characterSet), 'UTF-8');
  const shownText = await page.page.evaluate(() => document.body.innerText);
  assert.equal(shownText.trimEnd(), TEXT.trimEnd());
  assert.ok(shownText.includes(SPANISH));
  assert.equal(await page.page.evaluate(() => document.querySelector('#app')), null, 'the file, not the app');

  // -- The control: that reading is the mark's doing, and not the browser's guess. A second site sends
  //    the same bytes without the mark, in the same way: the same server, the same headers, the same
  //    type. The browser does not read that file as UTF-8. It falls back to a charset of its own
  //    choosing (Chrome set to English takes windows-1252), and the accented letters come out broken. --
  const bare = await scratchSite({ 'about.txt': SOURCE });
  const unmarked = await fetch(`${bare.url}/about.txt`);
  assert.deepEqual([unmarked.status, unmarked.headers.get('content-type')], [200, 'text/plain']);
  for (const [name, value] of POLICY) assert.equal(unmarked.headers.get(name), value, name);
  assert.ok(Buffer.from(await unmarked.arrayBuffer()).equals(SOURCE), 'the same bytes, without the mark');
  // A page of the app that may also reach the second site, taken there.
  const other = await s.open('/robots.txt', { allow: [bare.url] });
  const answer = await other.page.goto(`${bare.url}/about.txt`, { waitUntil: 'load' });
  assert.deepEqual([answer?.status(), answer?.headers()['content-type']], [200, 'text/plain']);
  const fallback = await other.page.evaluate(() => document.characterSet);
  assert.notEqual(fallback, 'UTF-8', 'without the mark the browser does not take the file for UTF-8');
  // What it shows is the file's bytes read as that other charset: the Spanish line is not among them as
  // the file has it, and stands there as its bytes misread.
  const misread = (bytes: Uint8Array): string => new TextDecoder(fallback).decode(bytes);
  const brokenText = await other.page.evaluate(() => document.body.innerText);
  assert.equal(brokenText.trimEnd(), misread(SOURCE).trimEnd());
  assert.notEqual(brokenText.trimEnd(), TEXT.trimEnd());
  assert.ok(!brokenText.includes(SPANISH), 'the Spanish line is not shown whole');
  assert.ok(brokenText.includes(misread(Buffer.from(SPANISH, 'utf8'))), 'the Spanish line is shown as its bytes misread');
  assert.deepEqual(bare.faults, [], 'the second site answered every request');

  // -- With scripts switched off the app's one page draws nothing but its <noscript> block: four lines, two
  //    in English and two marked as Spanish, on About's own address in each language. --
  const LINES = [
    'The practice wallet needs JavaScript.',
    'Its About page says what the wallet keeps, sends and counts. The sentences of that page can be read without JavaScript, in English and in Spanish, in a copy of the file the page takes them from: about.txt.',
    'La billetera de práctica necesita JavaScript.',
    'Su página Acerca de dice qué guarda, qué envía y qué cuenta la billetera. Las frases de esa página se pueden leer sin JavaScript, en inglés y en español, en una copia del archivo del que la página las toma: about.txt.',
  ];
  await page.page.setJavaScriptEnabled(false);
  for (const path of ['/about', '/es/about']) {
    const answer = await page.page.goto(`${s.url}${path}`, { waitUntil: 'load' });
    assert.equal(answer?.status(), 200, path);
    const drawn = await page.page.$$eval('noscript p', (lines) =>
      lines.map((line) => ({
        text: (line.textContent ?? '').replace(/\s+/g, ' ').trim(),
        lang: line.getAttribute('lang'),
        seen: line.getBoundingClientRect().height > 0,
      })),
    );
    assert.deepEqual(drawn.map((line) => line.text), LINES, path);
    assert.deepEqual(drawn.map((line) => line.lang), [null, null, 'es', 'es'], path);
    assert.ok(drawn.every((line) => line.seen), `${path}: every line is on the page`);
    // The app drew nothing, and the block's two links lead to the file on this site.
    assert.equal(await page.page.$eval('#app', (app) => app.childElementCount), 0, path);
    assert.deepEqual(
      await page.page.$$eval('noscript a', (links) => links.map((link) => [link.getAttribute('href'), link.getAttribute('target'), (link.textContent ?? '').trim()])),
      [
        ['/about.txt', null, 'about.txt'],
        ['/about.txt', null, 'about.txt'],
      ],
      path,
    );
  }
  // The link, pressed: the file, in this tab.
  await Promise.all([page.page.waitForNavigation({ waitUntil: 'load' }), page.page.click('noscript a')]);
  assert.equal(page.page.url(), `${s.url}/about.txt`);
  assert.equal((await page.page.evaluate(() => document.body.innerText)).trimEnd(), TEXT.trimEnd());

  // -- With scripts on, a reader never sees the block: the app draws About, and nothing in it links the file. --
  await page.page.setJavaScriptEnabled(true);
  await page.goto('/about');
  await page.waitFor('about-kept-now');
  assert.equal(await page.page.$$eval('noscript p', (lines) => lines.length), 0);
  assert.equal(await page.page.$$eval('a[href$="about.txt"]', (links) => links.length), 0);
});
