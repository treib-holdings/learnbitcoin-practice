import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// The development gallery: a second entry beside the app, with its own page
// (dev/index.html), its own start (dev/main.ts) and its own output folder.
// It mounts the app's own components with a scripted stand-in for the
// wallet. The production build (../vite.config.ts) never reads this file.
//
// Run from app/, the folder this path is written against:
//
//   vite build --config dev/vite.config.ts     the gallery, built into dev/dist
//   vite --config dev/vite.config.ts           the same with live reload, on port 5174
//
// "pnpm gallery" (e2e/src/gallery.ts) builds it into a temporary folder,
// serves it with the app's real headers and looks at one page in Chrome.

export default defineConfig({
  // Paths are read against the folder Vite is started in: app/.
  root: 'dev',
  // The app's own static files: the logo, the icon, and the _headers file
  // that holds the security policy.
  publicDir: '../public',
  plugins: [tailwindcss(), svelte({ configFile: '../svelte.config.js' })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The same rules as the app's build, so the gallery meets the same security policy.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: true,
  },
  server: {
    port: 5174,
  },
});
