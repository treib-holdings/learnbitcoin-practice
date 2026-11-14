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

if (problems.length > 0) fail();
console.log(`ok: ${dist} passes the dist guard (1 script file, 1 stylesheet, nothing inline, _headers, licenses.md)`);
