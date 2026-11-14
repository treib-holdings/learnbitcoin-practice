import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Where /api/ and /p/ go while developing: the local server that "pnpm dev"
// starts on this port. It runs the Worker's own handlers in front of a
// stand-in practice network. In production the app and the Worker share one
// host, so these paths are already on the page's own origin.
const WORKER = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
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
