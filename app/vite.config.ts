import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

// Where /api/ and /p/ go while developing: the local server that "pnpm dev"
// starts on this port. It runs the Worker's own handlers in front of a
// stand-in practice network. In production the app and the Worker share one
// host, so these paths are already on the page's own origin.
const WORKER = 'http://127.0.0.1:8787';

/** The About page's string table, as a path under the app's folder. */
const ABOUT_SOURCE = 'src/strings/about.ts';

/** The name it is published under: /about.txt. */
const ABOUT_FILE = 'about.txt';

/** A byte order mark: three bytes at the very start of a file, which tell whoever reads it that the file is UTF-8. */
const UTF8_MARK = Uint8Array.of(0xef, 0xbb, 0xbf);

/**
 * Ships the About page's own string table with the build, as about.txt.
 *
 * The About page says what the wallet keeps, sends and counts, and it is
 * drawn by the app's script: a reader who browses with scripts off sees
 * none of it. So the build adds the file every sentence of that page is
 * taken from, and the page's <noscript> lines link it (index.html). It is
 * that file as it is written, both languages and its comments, not a page
 * laid out for reading: a byte order mark, and behind the mark the file
 * byte for byte.
 *
 * The mark is there for the file's Spanish half. The deployed site sends a
 * text file's type with no charset: this file comes as "text/plain". A
 * browser that is told no charset cannot be counted on to read a text file
 * as UTF-8: Chromium and WebKit have both been seen to read this one,
 * without the mark, as windows-1252, and to show "prÃ¡ctica" where the
 * file says "práctica". A browser that finds the mark reads the file as
 * UTF-8 whatever the header says, and does not show the mark. The type is
 * not set in public/_headers instead: the live check
 * (tools/live-check/live-check.ts) holds a path to come without every
 * header that file names for other paths only, so a Content-Type written
 * there for this file would have it ask that the app's pages come with
 * none.
 *
 * The file is made here, at each build, and never kept as a second copy in
 * the repository: a copy would drift from the table. The dist guard
 * (scripts/check-dist.mjs) fails a build without it, without the mark, or
 * with other bytes behind the mark. It also fails a table that starts
 * with a mark of its own, since the copy would then start with two.
 */
function aboutText(): Plugin {
  let root = '';
  return {
    name: 'practice-about-text',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    generateBundle() {
      // The mark, then the file: read as bytes and handed on as bytes. Nothing reads the text or changes a line ending.
      this.emitFile({ type: 'asset', fileName: ABOUT_FILE, source: Buffer.concat([UTF8_MARK, readFileSync(join(root, ABOUT_SOURCE))]) });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), svelte(), aboutText()],
  build: {
    // The page's security policy has no "data:" source, so no file may be
    // folded into the CSS or JS as a data: URL.
    assetsInlineLimit: 0,
    // Every supported browser preloads modules by itself.
    modulePreload: { polyfill: false },
    // The code is public and meant to be read: ship the maps.
    sourcemap: true,
    // The licenses of everything bundled, as dist/licenses.md.
    license: { fileName: 'licenses.md' },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // A key that starts with ^ is a regular expression. The trailing slash
      // keeps app screens such as /passkey or /apiary out of the proxy.
      //
      // changeOrigin stays false, so a proxied request keeps this page's Host
      // header. The Worker refuses a POST whose Origin header names another
      // host than the one the request was sent to; with the Host rewritten,
      // every POST from the dev page would be refused.
      '^/api/': { target: WORKER, changeOrigin: false },
      '^/p/': { target: WORKER, changeOrigin: false },
    },
  },
});
