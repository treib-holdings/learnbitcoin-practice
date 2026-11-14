// "pnpm dev": the Worker's handler and a practice network on this machine,
// for a person at a browser.
//
// It listens on port 8787, where the Vite dev server sends /api/ and /p/
// (app/vite.config.ts). So there are two ways to work:
//
//   pnpm dev, and in another terminal "pnpm --filter @learnbitcoin/practice-app dev"
//       the app from source on http://localhost:5173, reloading as you type.
//       Vite's page has no security policy, so "pnpm smoke" still has the last word.
//   pnpm build, then pnpm dev
//       the built app on http://localhost:8787, under its real headers.
//
// The practice network is the stand-in, and it makes a block every ten
// seconds so that a payment confirms while you watch. It starts empty on
// every run. The faucet pays for real (stand-in coins).
//
// One thing to know about those ten seconds. The stand-in dates each block
// at least 30 seconds after the one before, as the real network's blocks
// are. Made every ten seconds, its blocks are dated further and further
// ahead of your clock (20 seconds more with each block). Where that gets in
// the way, BLOCK_SECONDS=30 pnpm dev runs at the real network's pace, with
// block times that are true.
//
// The one thing here that uses the network: the page is given Cloudflare's
// published always-pass test site key, so the real bot-check script loads in
// your browser and hands the page the dummy token, which the local bot check
// accepts. The hermetic tools (pnpm smoke, pnpm e2e) never load that script.
//
// What this server cannot do: stand behind HTTPS. It speaks plain HTTP on
// this machine, and tells the Worker's handler that every request came over
// http. Behind a tunnel or a proxy that adds HTTPS (to try the wallet on a
// phone, where a passkey needs HTTPS) the page's Origin says https, the
// handler sees two different origins, and the faucet, the pot address, a
// broadcast and every event are refused as "forbidden". Passkeys are also
// offered on "localhost" only here. A phone has to wait for a deploy.

import { fileURLToPath } from 'node:url';
import { serve } from './serve.ts';
import { startStack } from './stack.ts';

/** Where app/vite.config.ts expects this server. PORT overrides it, for a second copy. */
const PORT = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
  console.error('PORT must be a port number.');
  process.exit(1);
}
/** How often a block is made, in seconds. */
const BLOCK_SECONDS = Number(process.env.BLOCK_SECONDS ?? 10);
if (!Number.isInteger(BLOCK_SECONDS) || BLOCK_SECONDS < 1 || BLOCK_SECONDS > 3600) {
  console.error('BLOCK_SECONDS must be a whole number of seconds from 1 to 3600.');
  process.exit(1);
}
const DIST = fileURLToPath(new URL('../../app/dist', import.meta.url));

const stack = await startStack({
  // The app is told the truth about how often a block comes here.
  vars: { BLOCK_SECONDS: String(BLOCK_SECONDS) },
  // One line per API request, as the deployed Worker writes them.
  log: (line) => console.log(JSON.stringify(line)),
  keep: 1000,
});

let server;
try {
  server = await serve({ dist: DIST, handler: stack.handler, port: PORT, requireApp: false });
} catch (error) {
  await stack.close();
  const code = (error as { code?: string }).code;
  console.error(
    code === 'EADDRINUSE'
      ? `Port ${PORT} is in use: is another "pnpm dev" running? Stop it, or set PORT (the Vite dev server expects 8787).`
      : `Could not start the local server: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

const mining = setInterval(() => stack.network!.mine(), BLOCK_SECONDS * 1000);

console.log(`Practice wallet, local: ${server.url}`);
console.log(`  /api/ and /p/   the Worker's handler over a stand-in practice network (height ${stack.network!.height()}, a block every ${BLOCK_SECONDS} s)`);
console.log(`  other paths     the built app in app/dist, when there is one ("pnpm build")`);
console.log('  from source     pnpm --filter @learnbitcoin/practice-app dev, then http://localhost:5173');
if (BLOCK_SECONDS < 30) console.log(`  note            blocks are dated 30 s apart, so their times run ahead of your clock (BLOCK_SECONDS=30 keeps them true)`);
console.log('Ctrl-C stops it.');

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(mining);
  await server!.close();
  await stack.close();
  console.log('Stopped.');
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
