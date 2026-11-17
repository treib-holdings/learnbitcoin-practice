// The dist guard. It runs after every build and fails when the build holds
// something the page's security policy would block, or lacks something a
// deploy needs.
//
//   node scripts/check-dist.mjs            checks app/dist
//   node scripts/check-dist.mjs <folder>   checks a build made somewhere else
//
// The policy (public/_headers) lets a page run scripts and apply styles that
// come from files of this origin, and nothing else. So the built index.html
// may point at one script file and one stylesheet, and must carry no script
// and no style of its own. The same goes for what the bundle writes into the
// page later: a style attribute or a <style> element in a component's markup
// is refused by the browser, yet neither the Svelte compiler nor svelte-check
// warns about one. Only this script and the end-to-end test catch them.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(process.argv[2] ?? join(appDir, 'dist'));

const problems = [];

/** Prints what is wrong and stops with a failing exit code. */
function fail() {
  console.error(`The build in ${dist} did not pass the dist guard:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

if (!existsSync(join(dist, 'index.html'))) {
  problems.push('there is no index.html: run "vite build" first');
  fail();
}

/**
 * Every start tag of a page, with its attributes. Values are read as
 * written; a name without a value gets the empty string.
 */
function startTags(html) {
  const tags = [];
  for (const [, name, rest] of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const attrs = new Map();
    for (const [, key, double, single, bare] of rest.matchAll(
      /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
    )) {
      attrs.set(key.toLowerCase(), double ?? single ?? bare ?? '');
    }
    tags.push({ name: name.toLowerCase(), attrs });
  }
  return tags;
}

// -- index.html -----------------------------------------------------------------

const tags = startTags(readFileSync(join(dist, 'index.html'), 'utf8'));

const scripts = tags.filter((tag) => tag.name === 'script');
const scriptFiles = scripts.map((tag) => tag.attrs.get('src')).filter((src) => src !== undefined);
const sheetFiles = tags
  .filter((tag) => tag.name === 'link' && (tag.attrs.get('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet'))
  .map((tag) => tag.attrs.get('href') ?? '');
const preloads = tags.filter(
  (tag) => tag.name === 'link' && (tag.attrs.get('rel') ?? '').toLowerCase().split(/\s+/).includes('modulepreload'),
);

if (scripts.length !== scriptFiles.length) {
  problems.push('index.html: a <script> without src (an inline script: the policy blocks it)');
}
if (scriptFiles.length !== 1) {
  problems.push(`index.html: ${scriptFiles.length} script files, expected exactly 1: ${scriptFiles.join(', ') || 'none'}`);
}
if (sheetFiles.length !== 1) {
  problems.push(`index.html: ${sheetFiles.length} stylesheets, expected exactly 1: ${sheetFiles.join(', ') || 'none'}`);
}
if (preloads.length > 0) {
  problems.push(
    `index.html: ${preloads.length} modulepreload link(s): the app must stay one script file (no dynamic import)`,
  );
}
if (tags.some((tag) => tag.name === 'style')) {
  problems.push('index.html: a <style> element (the policy blocks it)');
}
for (const tag of tags) {
  for (const key of tag.attrs.keys()) {
    if (key === 'style') problems.push(`index.html: a style attribute on <${tag.name}> (the policy blocks it)`);
    // onclick="..." and its kind are inline scripts too.
    if (/^on[a-z]/.test(key)) problems.push(`index.html: ${key}= on <${tag.name}> (an inline script: the policy blocks it)`);
  }
}

// -- the files index.html points at ---------------------------------------------

const assetsDir = join(dist, 'assets');
const assets = existsSync(assetsDir) ? readdirSync(assetsDir) : [];

/**
 * The files of one kind under assets/ must be exactly the one index.html
 * loads. The app is one bundle: a dynamic import() anywhere in the source
 * makes Vite write a second script file, and a tab left open across a deploy
 * would then ask for a file that no longer exists.
 */
function onlyTheReferenced(kind, built, referenced) {
  const expected = referenced.map((url) => url.replace(/^\/assets\//, ''));
  if (built.length !== 1 || built[0] !== expected[0]) {
    problems.push(
      `assets/: ${built.length} ${kind} file(s) (${built.join(', ') || 'none'}), ` +
        `expected only the one index.html loads (${referenced.join(', ') || 'none'}). ` +
        'A dynamic import() in the source makes a second file',
    );
  }
}
onlyTheReferenced('.js', assets.filter((name) => name.endsWith('.js')), scriptFiles);
onlyTheReferenced('.css', assets.filter((name) => name.endsWith('.css')), sheetFiles);

// -- what the bundle would write into the page ------------------------------------

for (const name of assets) {
  if (name.endsWith('.css')) {
    // A file folded into the stylesheet as a data: URL: no source in the policy allows it.
    if (readFileSync(join(assetsDir, name), 'utf8').includes('url(data:')) problems.push(`assets/${name}: a data: URL`);
  }
  if (name.endsWith('.js')) {
    const text = readFileSync(join(assetsDir, name), 'utf8');
    // A literal style attribute in a component, or one inside an {@html} string.
    for (const hit of text.matchAll(/style=\\?"[^"]{0,30}/g)) problems.push(`assets/${name}: a style attribute: ${hit[0]}`);
    // A <style> element written inside a component's markup.
    if (text.includes('<style')) problems.push(`assets/${name}: a <style> element in markup`);
    // A --custom-property passed to a component: Svelte wraps it in an element with a style attribute.
    if (text.includes('svelte-css-wrapper')) problems.push(`assets/${name}: a --property passed to a component (svelte-css-wrapper)`);
  }
}

// -- what a deploy needs ----------------------------------------------------------

// The headers file must reach the build unchanged: it is the security policy.
const sourceHeaders = readFileSync(join(appDir, 'public', '_headers'));
if (!existsSync(join(dist, '_headers'))) {
  problems.push('there is no _headers file: the pages would be served without their security policy');
} else if (!readFileSync(join(dist, '_headers')).equals(sourceHeaders)) {
  problems.push('_headers differs from public/_headers');
}

// The licenses of everything bundled. The minifier drops license comments, so this file is where they go.
if (!existsSync(join(dist, 'licenses.md')) || statSync(join(dist, 'licenses.md')).size === 0) {
  problems.push('licenses.md is missing or empty (build.license in vite.config.ts writes it)');
}

// The picture a link preview shows. index.html names it by its whole address on the wallet's own host
// (og:image), and a site that makes previews fetches it from there: so the file has to be in the build,
// under the path of that address, and it has to be a PNG, as the page says it is.
const shareImage = tags.find((tag) => tag.name === 'meta' && tag.attrs.get('property') === 'og:image')?.attrs.get('content');
if (shareImage === undefined) {
  problems.push('index.html names no share picture (a <meta property="og:image">): a link to the wallet would show no card');
} else {
  let sharePath = null;
  try {
    sharePath = new URL(shareImage).pathname;
  } catch {
    problems.push(`index.html: the share picture's address is not a whole address: ${shareImage}`);
  }
  if (sharePath !== null) {
    const shareFile = join(dist, sharePath);
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!existsSync(shareFile) || !statSync(shareFile).isFile()) {
      problems.push(`index.html names ${shareImage} as its share picture, and the build holds no ${sharePath.slice(1)}`);
    } else if (!readFileSync(shareFile).subarray(0, PNG.length).equals(PNG)) {
      problems.push(`${sharePath.slice(1)} is not a PNG file, and index.html says the share picture is one`);
    }
  }
}

// The About page's string table, as a text file. The page's <noscript> lines send a reader without
// JavaScript there for what the wallet keeps, sends and counts: so it has to be in the build, and
// behind its first three bytes it has to be the table itself, byte for byte, never an older copy of it.
//
// Those three bytes are a byte order mark. The deployed site sends the file as "text/plain" and names
// no charset, and a browser cannot be counted on to read such a file as UTF-8 unless it starts with
// that mark: without it the accented letters of the Spanish half can come out broken (vite.config.ts
// says more).
const UTF8_MARK = Buffer.from([0xef, 0xbb, 0xbf]);
const sourceAbout = readFileSync(join(appDir, 'src', 'strings', 'about.ts'));
// The table itself must not start with a mark of its own. The build puts its mark in front of whatever
// the table holds, so the copy would start with two marks and still be the mark and then the table:
// the comparison below would pass it. A browser takes only the first for a mark, and the second would
// be a character of the text.
if (sourceAbout.subarray(0, UTF8_MARK.length).equals(UTF8_MARK)) {
  problems.push('src/strings/about.ts starts with a byte order mark of its own: the build puts the one mark in front of its copy, and about.txt would start with two');
}
if (!existsSync(join(dist, 'about.txt'))) {
  problems.push('there is no about.txt: the <noscript> lines of index.html link it (the plugin in vite.config.ts writes it)');
} else {
  const builtAbout = readFileSync(join(dist, 'about.txt'));
  if (!builtAbout.subarray(0, UTF8_MARK.length).equals(UTF8_MARK)) {
    problems.push('about.txt does not start with a byte order mark (the bytes EF BB BF): without one a browser may not read the file as UTF-8 (the plugin in vite.config.ts writes the mark)');
  } else if (!builtAbout.subarray(UTF8_MARK.length).equals(sourceAbout)) {
    problems.push('about.txt differs from src/strings/about.ts behind its byte order mark');
  }
}

if (problems.length > 0) fail();
console.log(`ok: ${dist} passes the dist guard (1 script file, 1 stylesheet, nothing inline, _headers, licenses.md, about.txt, the share picture)`);
