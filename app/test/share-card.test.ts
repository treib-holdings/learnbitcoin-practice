// The card a link to the wallet shows where it is shared: the Open Graph
// tags in index.html, and the picture they name (public/og.png).
//
// A site that shows a preview of a link reads these tags from the page as it
// is served, without running the page's script, and fetches the picture from
// the address the tags give. One page is served for every address of the
// app, so every link to the wallet shows the same card.
//
// So four things are held here: the tags are there, once each; they say what
// the page itself says (its title, its description, its own host); the
// picture is in public/, in the format and size the tags name; and where a
// build is present, the built page and the built picture are the same.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../src/lib/config.ts';
import { strings } from '../src/strings/index.ts';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const PICTURE = new URL('../public/og.png', import.meta.url);
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const GUARD = fileURLToPath(new URL('../scripts/check-dist.mjs', import.meta.url));

/** A build is here: `pnpm build` made one. */
const built = existsSync(join(DIST, 'index.html'));
const NO_BUILD = 'no build here yet (pnpm build makes one)';

/** Every <meta> tag of a page that has a content, as [the name it goes by, its content], in the page's order. */
function metas(html: string): [key: string, content: string][] {
  const found: [string, string][] = [];
  for (const [, kind, key, content] of html.matchAll(/<meta (property|name)="([^"]+)" content="([^"]*)" \/>/g)) {
    assert.ok(kind === 'property' || kind === 'name');
    found.push([key ?? '', content ?? '']);
  }
  return found;
}

/** The content of the one tag that goes by `key`. It fails when the page has none, or more than one. */
function one(html: string, key: string): string {
  const hits = metas(html).filter(([name]) => name === key);
  assert.equal(hits.length, 1, `${hits.length} tags named ${key}, expected exactly one`);
  return hits[0]![1];
}

/** The width and height a PNG file states in its header, after its eight signature bytes. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'the file starts with the PNG signature');
  assert.equal(bytes.subarray(12, 16).toString('latin1'), 'IHDR', 'the first chunk is the header');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('index.html carries the tags a link preview is made of, once each, and they say what the page itself says', () => {
  assert.equal(one(indexHtml, 'og:type'), 'website');
  assert.equal(one(indexHtml, 'og:site_name'), strings.common.en.siteName);
  // The card's title and sentence are the page's own: a reader who follows the link finds what the card said.
  assert.equal(one(indexHtml, 'og:title'), /<title>([^<]*)<\/title>/.exec(indexHtml)?.[1]);
  assert.equal(one(indexHtml, 'og:description'), one(indexHtml, 'description'));
  // The large card: the picture across the whole width, not a thumbnail beside the text.
  assert.equal(one(indexHtml, 'twitter:card'), 'summary_large_image');
});

test('the picture is named by an address on the wallet\'s own host, with its kind, its size and words for a reader who cannot see it', () => {
  // A site that makes previews needs a whole address, and the host in it is the one the app is built for.
  assert.equal(one(indexHtml, 'og:image'), `https://${DEFAULT_CONFIG.passkeyHost}/og.png`);
  assert.equal(one(indexHtml, 'og:image:type'), 'image/png');
  assert.equal(one(indexHtml, 'og:image:width'), '1200');
  assert.equal(one(indexHtml, 'og:image:height'), '630');
  const alt = one(indexHtml, 'og:image:alt');
  assert.ok(alt.length >= 40 && alt.length <= 300, `the picture's description is ${alt.length} characters`);
  assert.match(alt, /practice/i);
  assert.doesNotMatch(alt, /PLACEHOLDER|TODO/);
});

test('the tags fix no address for the page: one page answers every address of the app', () => {
  // An og:url would tell a site that every shared link is the same page, and a link to a step would be
  // counted and shown as a link to the front page.
  assert.equal(metas(indexHtml).filter(([name]) => name === 'og:url').length, 0);
  assert.doesNotMatch(indexHtml, /<link rel="canonical"/);
});

test('public/og.png is a PNG of 1200 by 630 pixels, and small', () => {
  assert.ok(existsSync(PICTURE), 'there is no public/og.png');
  const bytes = readFileSync(PICTURE);
  assert.deepEqual(pngSize(bytes), { width: 1200, height: 630 });
  // Sites that show previews fetch it on every first sight of a link: well under their limits, and quick.
  assert.ok(bytes.length < 400_000, `the picture is ${bytes.length} bytes`);
});

test('dist: the built page carries the same tags, and the picture they name is in the build, byte for byte', { skip: built ? false : NO_BUILD }, () => {
  const page = readFileSync(join(DIST, 'index.html'), 'utf8');
  const tagsOf = (html: string) => [...html.matchAll(/<meta (?:property|name)="(?:og:[^"]+|twitter:[^"]+)" content="[^"]*"\s*\/?>/g)].map((match) => match[0].replace(/\s*\/?>$/, ''));
  assert.deepEqual(tagsOf(page), tagsOf(indexHtml));
  assert.equal(tagsOf(indexHtml).length, 10);
  assert.ok(readFileSync(join(DIST, 'og.png')).equals(readFileSync(PICTURE)), 'dist/og.png differs from public/og.png');
});

test('the dist guard fails a build whose picture is missing or is no PNG, and one whose page names no picture', { skip: built ? false : NO_BUILD }, () => {
  const guard = (folder: string): { code: number | null; said: string } => {
    const run = spawnSync(process.execPath, [GUARD, folder], { encoding: 'utf8' });
    return { code: run.status, said: `${run.stdout}${run.stderr}` };
  };
  const copy = mkdtempSync(join(tmpdir(), 'practice-share-'));
  try {
    cpSync(DIST, copy, { recursive: true });
    const whole = guard(copy);
    assert.equal(whole.code, 0, whole.said);

    // The page names a picture that the build does not hold: a link would show an empty card.
    rmSync(join(copy, 'og.png'));
    const missing = guard(copy);
    assert.equal(missing.code, 1, missing.said);
    assert.match(missing.said, /names https:\/\/[a-z.]+\/og\.png as its share picture, and the build holds no og\.png/);

    // A file of that name that is no PNG, while the page says it is one.
    writeFileSync(join(copy, 'og.png'), 'not a picture');
    const other = guard(copy);
    assert.equal(other.code, 1, other.said);
    assert.match(other.said, /og\.png is not a PNG file/);

    // Put back, the build passes again.
    writeFileSync(join(copy, 'og.png'), readFileSync(PICTURE));
    assert.equal(guard(copy).code, 0);

    // A page that names no picture at all.
    const page = readFileSync(join(copy, 'index.html'), 'utf8');
    const without = page.replace(/<meta property="og:image" content="[^"]*"\s*\/?>/, '');
    assert.notEqual(without, page, 'the built page names its picture');
    writeFileSync(join(copy, 'index.html'), without);
    const unnamed = guard(copy);
    assert.equal(unnamed.code, 1, unnamed.said);
    assert.match(unnamed.said, /index\.html names no share picture/);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
