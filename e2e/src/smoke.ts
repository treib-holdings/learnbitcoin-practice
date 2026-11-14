// The smoke command: one page of the app, as a browser really gets it.
//
//   pnpm smoke <path> [--lang es] [--wallet none|empty|funded|passkey]
//                     [--width 375] [--shot file.png] [--dist <dir>]
//
// It builds the app into a temporary directory (never into app/dist), starts
// the stand-in practice network and the local server on free ports, opens
// the path in headless Chrome, prints every console error, every violation
// of the page's security policy, every uncaught error and every request the
// page tried to send elsewhere, saves a screenshot if asked, and exits with
// 1 if there was any of them (SPEC section 14 says which console lines do
// not count).
//
// "Nothing went wrong" is only worth something if something happened. So it
// also fails a page that drew nothing (an empty #app), a page that came
// without the app's own Content-Security-Policy (with no policy, nothing can
// violate one), a file of the app that is missing, and a fault in the
// Worker's own log (an answer under /api/ may be a refusal; a fault is the
// Worker saying that something is broken).
//
//   --lang es    the Spanish address of the path (/es/...), in a browser set to Spanish
//   --wallet     none     nothing in storage (the default)
//                empty    a wallet made without a passkey, with no coins
//                funded   the same wallet with three coins from the stand-in
//                passkey  nothing in storage, and a passkey provider that gives
//                         the wallet secret (so Create with a passkey can run)
//   --width      the window's width in CSS pixels (default 1280)
//   --shot       where to save a picture of the whole page
//   --dist       use this build instead of making one (the dist guard is not run on it)
//
// Each run has its own ports, its own build and its own Chrome profile, so
// several can run at once. Everything it made is removed when it ends.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS, type Lang } from '@learnbitcoin/practice-contract';
import type { LogLine } from '@learnbitcoin/practice-worker';
import { FUNDED_COINS, TEST_WORDS, endOnSignals, fundTestWallet, launchChrome, openPage, testRecord, type Chrome, type OpenedPage } from './browser.ts';
import { parseHeadersFile, serve, type LocalServer } from './serve.ts';
import { startStack, type Stack } from './stack.ts';

const WALLETS = ['none', 'empty', 'funded', 'passkey'] as const;
type WalletChoice = (typeof WALLETS)[number];

export interface SmokeArgs {
  path: string;
  lang: Lang;
  wallet: WalletChoice;
  width: number;
  /** Where to save the screenshot, or null. */
  shot: string | null;
  /** A build to use as it is, or null to make one. */
  dist: string | null;
}

const USAGE = 'usage: pnpm smoke <path> [--lang es] [--wallet none|empty|funded|passkey] [--width 375] [--shot file.png] [--dist <dir>]';

/** Reads the command line. `from` is the folder relative file names are read against. */
export function parseSmokeArgs(argv: readonly string[], from: string): SmokeArgs | { error: string } {
  const args: SmokeArgs = { path: '', lang: 'en', wallet: 'none', width: 1280, shot: null, dist: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      if (args.path !== '') return { error: `two paths: ${args.path} and ${arg}` };
      args.path = arg;
      continue;
    }
    // "--width 375" and "--width=375" are both taken.
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const value = equals === -1 ? argv[(i += 1)] : arg.slice(equals + 1);
    if (value === undefined || value === '') return { error: `${name} needs a value` };
    if (name === '--lang') {
      if (!(LANGS as readonly string[]).includes(value)) return { error: `--lang is one of: ${LANGS.join(', ')}` };
      args.lang = value as Lang;
    } else if (name === '--wallet') {
      if (!(WALLETS as readonly string[]).includes(value)) return { error: `--wallet is one of: ${WALLETS.join(', ')}` };
      args.wallet = value as WalletChoice;
    } else if (name === '--width') {
      if (!/^[0-9]+$/.test(value) || Number(value) < 200 || Number(value) > 4000) return { error: '--width is a number of pixels from 200 to 4000' };
      args.width = Number(value);
    } else if (name === '--shot') {
      args.shot = resolve(from, value);
    } else if (name === '--dist') {
      args.dist = resolve(from, value);
    } else {
      return { error: `no such option: ${name}` };
    }
  }
  if (!args.path.startsWith('/')) return { error: 'the path must start with a slash, for example /wallet/receive' };
  return args;
}

/** The address of the same screen in a language: Spanish lives under /es, English at the root. */
export function pathIn(lang: Lang, path: string): string {
  if (lang !== 'es' || path === '/es' || path.startsWith('/es/') || path.startsWith('/es?')) return path;
  return path === '/' ? '/es' : `/es${path}`;
}

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url));

/** The programs this process has started and not yet seen end (a build under way). */
const running = new Set<ChildProcess>();
let endsRunningAtExit = false;

/**
 * Ends them, at once. For the moment this process itself ends: a build that
 * went on by itself would write its files into a folder that has just been
 * removed, and so put the folder back.
 */
function endRunning(): void {
  for (const child of running) {
    try {
      // The program and whatever it started: it leads a process group of its own (see runInApp).
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Gone already.
    }
  }
}

/** Runs a Node program in the app's folder and gives its exit code and what it printed. */
function runInApp(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((done, reject) => {
    // The program file itself, not "pnpm run": that can wait on the registry where there is no network.
    // Vite keeps compiled code in a folder under the temporary directory, for its next start.
    // A smoke run leaves nothing behind, so that is switched off for it.
    const env = { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' };
    // "detached": a process group of its own, so that it can be ended as a whole. It also means that a
    // Ctrl-C in the terminal no longer reaches the program by itself: this process ends it when it ends.
    const child = spawn(process.execPath, args, { cwd: APP_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    running.add(child);
    if (!endsRunningAtExit) {
      endsRunningAtExit = true;
      process.on('exit', endRunning);
    }
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', (error) => {
      running.delete(child);
      reject(error);
    });
    child.on('close', (code) => {
      running.delete(child);
      done({ code: code ?? 1, output });
    });
  });
}

/**
 * Builds the app into `dist` and runs the dist guard over it, as "pnpm build"
 * does for app/dist. Gives what went wrong, one entry each: nothing for a
 * good build.
 */
export async function buildApp(dist: string): Promise<string[]> {
  const built = await runInApp([join(APP_DIR, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'warn']);
  if (built.code !== 0) return [`the build failed:\n${built.output.trim()}`];
  const guard = await runInApp([join(APP_DIR, 'scripts/check-dist.mjs'), dist]);
  return guard.code === 0 ? [] : [`the dist guard: ${guard.output.trim()}`];
}

/**
 * The Content-Security-Policy every page of the app must come with: the one
 * in the "/*" block of app/public/_headers, as it is written in the source.
 */
export function appPolicy(): string {
  const rules = parseHeadersFile(readFileSync(join(APP_DIR, 'public', '_headers'), 'utf8'));
  const policy = rules.find((rule) => rule.path === '/*')?.set.find(([name]) => name === 'content-security-policy')?.[1];
  if (policy === undefined) throw new Error('app/public/_headers names no Content-Security-Policy for "/*"');
  return policy;
}

/**
 * What the Worker's own log holds against a run: one line for each fault. An
 * answer under /api/ may be a refusal, which is part of how the app talks to
 * its Worker and is forgiven in the console. A fault is something else: the
 * Worker saying that it could not do its work (the handler threw, the
 * practice network could not be reached). The page shows its text for
 * "unavailable" and no console line counts, so the log is the only place
 * where it shows.
 */
export function workerFaults(lines: readonly LogLine[]): string[] {
  return lines.filter((line) => line.fault !== null).map((line) => `the Worker logged a fault: ${line.route} ${line.status} ${line.fault}`);
}

const sats = (amount: number) => amount.toLocaleString('en-US');

function describeWallet(wallet: WalletChoice): string {
  if (wallet === 'none') return 'none (nothing in storage)';
  if (wallet === 'passkey') return 'passkey (nothing in storage; a passkey provider that gives the wallet secret)';
  const words = `a wallet without a passkey, words "${TEST_WORDS}"`;
  if (wallet === 'empty') return `empty (${words}, no coins)`;
  const coins = FUNDED_COINS.map((coin) => `${sats(coin.sats)} ${coin.confirmed ? 'confirmed' : 'unconfirmed'}`).join(', ');
  return `funded (${words}; coins in sats: ${coins})`;
}

async function main(): Promise<number> {
  const args = parseSmokeArgs(process.argv.slice(2), process.env.INIT_CWD ?? process.cwd());
  if ('error' in args) {
    console.error(`smoke: ${args.error}\n${USAGE}`);
    return 2;
  }

  // Everything this run writes lives under one folder, which goes when the
  // process does, however it ends: by itself, on Ctrl-C, on "stop", or when
  // the terminal it was started from closes.
  endOnSignals();
  const scratch = await mkdtemp(join(tmpdir(), 'lbp-smoke-'));
  process.on('exit', () => {
    // First the build, if one is under way: it writes into this folder as long as it lives.
    endRunning();
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const problems: string[] = [];
  let stack: Stack | null = null;
  let server: LocalServer | null = null;
  let chrome: Chrome | null = null;
  let page: OpenedPage | null = null;
  try {
    const dist = args.dist ?? join(scratch, 'dist');
    if (args.dist === null) {
      problems.push(...(await buildApp(dist)));
      // No build, no page. (A build the dist guard refuses is still opened: what the browser says about it is worth having.)
      if (!existsSync(join(dist, 'index.html'))) throw new Error('there is no built app to open');
    }

    stack = await startStack();
    if (args.wallet === 'funded') fundTestWallet(stack.network!);
    server = await serve({ dist, handler: stack.handler });
    chrome = await launchChrome();

    const path = pathIn(args.lang, args.path);
    console.log(`smoke: ${server.url}${path}`);
    console.log(`  width ${args.width}, browser language ${args.lang}, wallet: ${describeWallet(args.wallet)}`);
    page = await openPage(chrome, server.url, {
      path,
      lang: args.lang,
      width: args.width,
      record: args.wallet === 'empty' || args.wallet === 'funded' ? testRecord() : undefined,
      passkey: args.wallet === 'passkey' ? 'prf' : undefined,
    });
    // Let the page finish what it started: its first questions to the server, and its fonts.
    const idle = await page.settle(500);
    await page.page.evaluate(() => document.fonts.ready.then(() => undefined));
    console.log(`  document: status ${page.status}, title ${JSON.stringify(await page.page.title())}, load event after ${page.loadMs} ms`);
    if (!idle) console.log('  note: the page was still talking to the server after 10 seconds');
    const sideways = await page.sidewaysScroll();
    if (sideways > 0) console.log(`  note: the page scrolls sideways: it is ${sideways} px wider than the ${args.width} px window`);

    const refused = page.responses.filter((response) => response.status >= 400);
    for (const response of refused) console.log(`  answer ${response.status}: ${response.method} ${new URL(response.url).pathname}`);
    if (page.status !== 200) problems.push(`the document's status is ${page.status}`);
    // With no policy nothing can violate one: "no CSP violation" has to mean the app's own policy was in force.
    const sent = page.responses.findLast((response) => response.type === 'document')?.headers['content-security-policy'];
    if (sent === undefined) problems.push('the page came with no Content-Security-Policy at all');
    else if (sent !== appPolicy()) problems.push(`the page's Content-Security-Policy is not the one in app/public/_headers: ${sent}`);
    // A script that loads and mounts nothing is no error to Chrome. It is one here.
    const drawn = await page.page.$eval('#app', (app) => app.childElementCount).catch(() => 0);
    if (drawn === 0) problems.push('the page drew nothing: #app is empty, or not there');
    if (args.shot !== null) {
      await page.shot(args.shot);
      console.log(`  screenshot: ${args.shot}`);
    }
    await stack.settled();
    problems.push(...page.problems(), ...server.faults.map((fault) => `local server: ${fault}`), ...workerFaults(stack.lines));
  } catch (error) {
    problems.push(`the run stopped: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await page?.close();
    await chrome?.close().catch(() => {});
    await server?.close();
    await stack?.close();
  }

  if (problems.length === 0) {
    // The line is kept as it was: other tools and people look for it. It now also means: the page drew something, under the app's own policy, with every file there.
    console.log('ok: no console error, no CSP violation, no uncaught error, no request to another host');
    return 0;
  }
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`FAILED: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  return 1;
}

if (import.meta.main) process.exit(await main());
