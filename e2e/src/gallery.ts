// Looks at one page of the development gallery in headless Chrome.
//
//   pnpm gallery "/es/wallet/receive?state=funded" --width 375 --shot receive.png
//   node e2e/src/gallery.ts /gallery/pieces --width 320 --shot pieces.png
//
// It builds the gallery (app/dev) into a temporary folder, serves that
// folder on a free local port with the app's own _headers file, opens the
// one address in Chrome, and prints what it found: every console error,
// every violation of the page's security policy, every request to another
// host, and whether the page is wider than the screen. Then it saves a
// picture of the whole page. Any of those problems ends the run with a
// failing exit code, so a script can rely on it.
//
// LOOK AT THE PICTURE. No check here knows whether a screen looks right:
// cramped spacing, a line that wraps badly in Spanish and a focus outline
// that is cut off only show to someone who opens the file.
//
// The headers are the ones production sends, so a style attribute or an
// inline script that the security policy would block is blocked here too,
// and shows up as a violation. Nothing leaves this machine: a request to
// any other host is stopped and reported.
//
// Options:
//   --width <px>     the screen's width (default 375)
//   --height <px>    the screen's height (default 800); the picture is of the whole page
//   --scale <n>      pixels of the picture per pixel of the page (default 1)
//   --shot <file>    where the picture goes (default: a file in the temporary folder, printed)
//   --part <px>      cut the picture into parts this tall: file.01.png, file.02.png, ...
//                    (a long page in one picture is too small to read once it is scaled to fit a window)
//   --wait <ms>      wait this long before looking (default 0): the stand-in's actions take time
//   --dist <folder>  look at a gallery that is already built, and build nothing
//   --keep <folder>  build the gallery into this folder and leave it there, for --dist later
//
// Several runs at once are fine: each has its own folders and its own port.
// The Chrome it starts is the installed one, or the program CHROME names,
// with a throwaway profile.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');

// -- building -----------------------------------------------------------------

/** Builds the gallery into `outDir` with the app's own Vite. Throws when the build fails. */
export function buildGallery(outDir: string): void {
  const vite = join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const args = ['build', '--config', 'dev/vite.config.ts', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'];
  const result = spawnSync(process.execPath, [vite, ...args], { cwd: appDir, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('the gallery did not build');
}

// -- serving ------------------------------------------------------------------

/** One block of a _headers file: a path, the headers it adds and the ones it takes away again. */
interface HeaderRule {
  path: string;
  add: [name: string, value: string][];
  remove: string[];
}

/** Reads a _headers file: a path at the left edge, then indented "Name: value" and "! Name" lines. */
export function readHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) {
      rules.push({ path: line.trim(), add: [], remove: [] });
      continue;
    }
    const rule = rules.at(-1);
    if (!rule) continue;
    const entry = line.trim();
    if (entry.startsWith('!')) rule.remove.push(entry.slice(1).trim().toLowerCase());
    else rule.add.push([entry.slice(0, entry.indexOf(':')).trim(), entry.slice(entry.indexOf(':') + 1).trim()]);
  }
  return rules;
}

/** The headers a path is served with: every block that matches, in the file's order. "/*" matches every path. */
export function headersFor(rules: HeaderRule[], pathname: string): Record<string, string> {
  const headers = new Map<string, [name: string, value: string]>();
  for (const rule of rules) {
    const matches = rule.path.endsWith('*') ? pathname.startsWith(rule.path.slice(0, -1)) : pathname === rule.path;
    if (!matches) continue;
    for (const [name, value] of rule.add) headers.set(name.toLowerCase(), [name, value]);
    for (const name of rule.remove) headers.delete(name);
  }
  return Object.fromEntries(headers.values());
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/**
 * Serves a built folder the way the app is hosted: a file where there is
 * one, index.html for every other address that is not a file's (so a screen
 * can be opened by its address), and the headers of the folder's _headers
 * file on everything. /api/ and /p/ answer 404: the gallery has no Worker,
 * and a screen that asks for one has gone around the wallet.
 */
export async function serve(dir: string): Promise<{ origin: string; close: () => Promise<void> }> {
  const root = resolve(dir);
  const rules = readHeaders(readFileSync(join(root, '_headers'), 'utf8'));
  const server: Server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    const headers = headersFor(rules, pathname);
    const send = (status: number, type: string, body: Buffer | string): void => {
      response.writeHead(status, { ...headers, 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(body);
    };
    let file = resolve(root, `.${decodeURIComponent(pathname)}`);
    // Never a file outside the folder, and never the headers file itself.
    const inside = file === root || file.startsWith(root + sep);
    const isFile = inside && file !== join(root, '_headers') && existsSync(file) && statSync(file).isFile();
    if (!isFile) {
      const worker = pathname.startsWith('/api/') || pathname.startsWith('/p/');
      if (worker || extname(pathname) !== '') {
        send(404, 'text/plain; charset=utf-8', 'Not found');
        return;
      }
      file = join(root, 'index.html');
    }
    send(200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

// -- looking ------------------------------------------------------------------

export interface LookOptions {
  width: number;
  height: number;
  scale: number;
  /** Where the picture goes. */
  shot: string;
  /** The height of each part of the picture, in the page's pixels. 0: one picture, as long as Chrome can make it. */
  part: number;
  /** Milliseconds to wait before looking. */
  wait: number;
  /** A folder for Chrome's throwaway profile. */
  profile: string;
}

export interface LookResult {
  url: string;
  title: string;
  lang: string;
  heading: string;
  /** How wide the page's content is, against the screen's width. */
  pageWidth: number;
  /** The pictures taken: one, or the parts in order. */
  shots: string[];
  /** Console errors, page errors and failed requests. */
  errors: string[];
  /** Violations of the page's security policy. */
  violations: string[];
  /** Requests to any host but this server, all of them stopped. */
  outside: string[];
}

/** Chrome draws a picture of at most this many pixels a side. Past it, the picture starts again from the top. */
const CHROME_LIMIT = 16384;

/** What the page-side collector keeps on `window`. */
interface Collected {
  __violations?: string[];
}

/** Opens one address of a served gallery in headless Chrome, and reports. */
export async function look(origin: string, address: string, options: LookOptions): Promise<LookResult> {
  const errors: string[] = [];
  const outside: string[] = [];
  const chrome = process.env['CHROME'];
  const browser = await puppeteer.launch({
    ...(chrome ? { executablePath: chrome } : { channel: 'chrome' as const }),
    headless: true,
    userDataDir: options.profile,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: options.width, height: options.height, deviceScaleFactor: options.scale });

    // Nothing leaves this machine.
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const target = request.url();
      if (target.startsWith(`${origin}/`)) void request.continue();
      else {
        outside.push(target);
        void request.abort();
      }
    });

    // Every violation of the security policy, in every document the page loads.
    await page.evaluateOnNewDocument(() => {
      const kept: string[] = [];
      (window as Collected).__violations = kept;
      document.addEventListener('securitypolicyviolation', (event) => {
        kept.push(`${event.effectiveDirective}: ${event.blockedURI || 'inline'} (${event.sourceFile ?? ''}:${event.lineNumber})`);
      });
    });
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page error: ${error instanceof Error ? error.message : String(error)}`));
    page.on('requestfailed', (request) => {
      if (request.url().startsWith(`${origin}/`)) errors.push(`request failed: ${request.url()}`);
    });

    const url = origin + address;
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    if (options.wait > 0) await new Promise((done) => setTimeout(done, options.wait));

    const found = await page.evaluate(() => ({
      title: document.title,
      lang: document.documentElement.lang,
      heading: document.querySelector('main h1')?.textContent?.trim() ?? '',
      pageWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
      violations: (window as Collected).__violations ?? [],
    }));
    const { pageHeight, ...facts } = found;

    // The picture: whole if it fits, else in parts, top to bottom.
    const whole = resolve(options.shot);
    mkdirSync(dirname(whole), { recursive: true });
    const tallest = Math.floor(CHROME_LIMIT / options.scale);
    const part = options.part > 0 ? Math.min(options.part, tallest) : tallest;
    const shots: string[] = [];
    if (pageHeight <= part) {
      await page.screenshot({ path: whole as `${string}.png`, fullPage: true });
      shots.push(whole);
    } else {
      for (let top = 0; top < pageHeight; top += part) {
        const file = whole.replace(/(\.png)?$/, `.${String(shots.length + 1).padStart(2, '0')}.png`);
        const clip = { x: 0, y: top, width: options.width, height: Math.min(part, pageHeight - top) };
        await page.screenshot({ path: file as `${string}.png`, clip, captureBeyondViewport: true });
        shots.push(file);
      }
    }
    return { url, ...facts, shots, errors, outside };
  } finally {
    await browser.close();
  }
}

// -- the command ----------------------------------------------------------------

const USAGE = `usage: gallery <path-with-query> [--width 375] [--height 800] [--scale 1] [--shot file.png]
               [--part px] [--wait ms] [--dist folder] [--keep folder]
  for example: gallery "/es/wallet/receive?state=funded" --width 320 --shot receive.png
  the gallery's own pages: /gallery (every screen in every state), /gallery/pieces (every piece)`;

async function main(argv: string[]): Promise<number> {
  const options: Record<string, string> = {};
  let address = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--') continue;
    if (arg.startsWith('--')) options[arg.slice(2)] = argv[++i] ?? '';
    else address = arg;
  }
  const number = (name: string, fallback: number): number => {
    const value = Number(options[name] ?? fallback);
    if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a number`);
    return value;
  };
  if (!address.startsWith('/')) {
    console.error(USAGE);
    return 2;
  }
  const known = ['width', 'height', 'scale', 'shot', 'part', 'wait', 'dist', 'keep'];
  const unknown = Object.keys(options).filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    console.error(`unknown option: --${unknown.join(', --')}\n${USAGE}`);
    return 2;
  }

  const scratch = mkdtempSync(join(tmpdir(), 'lbp-gallery-'));
  // Paths given on the command line are read against the folder the command was started in.
  const from = process.env['INIT_CWD'] ?? process.cwd();
  let server: { origin: string; close: () => Promise<void> } | undefined;
  try {
    let dist: string;
    if (options['dist']) {
      dist = resolve(from, options['dist']);
    } else {
      dist = options['keep'] ? resolve(from, options['keep']) : join(scratch, 'dist');
      const started = Date.now();
      buildGallery(dist);
      console.log(`gallery: built in ${((Date.now() - started) / 1000).toFixed(1)} s${options['keep'] ? ` into ${dist}` : ''}`);
    }
    server = await serve(dist);
    const width = number('width', 375);
    const shot = options['shot'] ? resolve(from, options['shot']) : join(tmpdir(), `gallery-${Date.now()}-${width}.png`);
    const result = await look(server.origin, address, {
      width,
      height: number('height', 800),
      scale: number('scale', 1) || 1,
      shot,
      part: number('part', 0),
      wait: number('wait', 0),
      profile: join(scratch, 'profile'),
    });

    const tooWide = result.pageWidth > width;
    console.log(`gallery: ${address} at ${width} px`);
    console.log(`  title: ${result.title}`);
    console.log(`  lang: ${result.lang}   h1: ${result.heading}`);
    console.log(`  page width: ${result.pageWidth} px${tooWide ? `, WIDER THAN THE SCREEN by ${result.pageWidth - width} px` : ' (fits)'}`);
    console.log(`  console errors: ${result.errors.length}`);
    for (const error of result.errors) console.log(`    ${error}`);
    console.log(`  CSP violations: ${result.violations.length}`);
    for (const violation of result.violations) console.log(`    ${violation}`);
    console.log(`  requests to other hosts (stopped): ${result.outside.length}`);
    for (const target of result.outside) console.log(`    ${target}`);
    console.log(`  screenshot: ${result.shots.join('\n              ')}`);

    const problems = result.errors.length + result.violations.length + result.outside.length + (tooWide ? 1 : 0);
    console.log(problems === 0 ? 'ok' : `FAILED: ${problems} problem(s)`);
    return problems === 0 ? 0 : 1;
  } finally {
    await server?.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Run only as a command, so that a script can import the functions above.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
