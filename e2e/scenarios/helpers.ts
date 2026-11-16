// What every end-to-end scenario stands on.
//
//   import { scenario } from './helpers.ts';
//
//   scenario('the faucet pays', async (s) => {
//     const page = await s.open('/wallet/receive', { record: testRecord() });
//     await page.click('faucet-ask');
//     await s.network.nextBlock();
//     ...
//   });
//
// scenario() gives each scenario a world of its own: the built app on a local
// server, the Worker's real handler behind it (e2e/src/stack.ts), a practice
// network, and pages in headless Chrome. When the scenario ends, every page
// it opened must be clean: no console error, no uncaught error, no violation
// of the page's security policy, no request to another host, no file of the
// app missing (SPEC section 14 says which console lines do not count).
//
// What else ends a scenario as failed, and what its writer has to know:
//
//   - The pages get a moment after the last step (about a third of a
//     second, and until they have stopped talking to the server), so that
//     an error the last step set going is still seen. Work that takes
//     longer to show is not: wait for its result in the scenario itself.
//   - A fault in the Worker's log fails the scenario: the handler threw, or
//     the practice network could not be reached. A scenario that causes one
//     on purpose (it takes the origin down) says so first: s.expectFault().
//   - If a page drew the bot check's widget, the widget must have been drawn
//     for the action "faucet" and for the address the faucet is then asked
//     to pay. The local bot check only looks at the token; the deployed one
//     looks at both, and refuses.
//   - A scenario has to open a page. One that opens none fails.
//   - page.waitForStatus() also hears what the status region said before the
//     call. Before a step whose message can be the same words as an earlier
//     one, call page.forgetStatus().
//   - The pot's counts are switched off, here as in the Worker that is
//     deployed (POT_COUNTS in worker/wrangler.jsonc): a done "Pass it on"
//     shows no count line, its page asks for none, and the Worker does not
//     know the path. A scenario that reads the count line switches them on
//     in its own settings: `stack: { vars: { POT_COUNTS: 'on' } }` in the
//     scenario's options, as doit-to-the-pot.test.ts does.
//   - Where they are on, the Worker keeps the pot's counts for 15 seconds,
//     here as when it is deployed (worker/src/pot-stats.ts). The first look
//     at them in a scenario is the network's answer of that moment. A look
//     within the 15 seconds after it is given the same answer, whatever has
//     happened on the network since, and with the network down too. A
//     scenario that needs the Worker to ask again says that the time has
//     passed: s.stack.advanceClock(POT_STATS_KEEP_MS), with the constant
//     from the Worker's package. And after a question that failed, the
//     Worker asks nobody for 5 seconds: a scenario that brings the network
//     back and wants the count on the next page says that this time has
//     passed too, s.stack.advanceClock(POT_STATS_PAUSE_MS). Nothing
//     switches the keeping or the pause off.
//   - The main site is no part of a scenario's world. A link to it names a
//     host that the pages may not reach, and a page that follows one fails
//     its scenario (a request to another host). A scenario that has to
//     follow such a link starts a stand-in for the main site itself, hands
//     its address to the Worker as SITE_URL (`stack: { vars }` in the
//     scenario's options) and lets its pages reach it (`allow`), as
//     doit-chapter.test.ts does.
//   - The pages of a scenario share one Chrome with the other scenarios of
//     their file, each in a context of its own that is gone with the page.
//     A scenario about what a browser keeps when it is closed and opened
//     again, or about a setting of the browser itself (site data blocked),
//     starts a Chrome of its own on a profile folder it names: s.chromeOn().
//     Its pages are watched, and checked at the scenario's end, like any
//     other.
//   - Every file in this folder is a scenario file (*.test.ts) or a helper
//     (helpers.ts, or a name ending in helpers.ts). Under any other name a
//     file of scenarios would never be run, and nothing would say so: the
//     run would be green with fewer scenarios. So that stops every run.
//
// "pnpm e2e" runs the scenarios against the stand-in network. "pnpm e2e:live"
// runs the same files against a real practice network (e2e/src/live.ts). To
// run in both, a scenario uses `s.network`, which has the same calls either
// way. Whatever only the stand-in can do (fund an address, change the
// faucet's mood, make the origin fail) is on `s.standIn`, and using it marks
// the scenario as local only: a live run reports it as skipped, never as
// passed.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, relative, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Esplora } from '@learnbitcoin/practice-wallet';
import type { Fault } from '@learnbitcoin/practice-worker';
import { launchChrome, openPage, type Chrome, type OpenOptions, type OpenedPage } from '../src/browser.ts';
import type { FakeOrigin } from '../src/fake-origin.ts';
import type { StandInCall } from '../src/fake-turnstile.ts';
import { serve, type LocalServer } from '../src/serve.ts';
import { DUMMY_TOKEN, startStack, type RealOrigin, type Stack, type StackOptions } from '../src/stack.ts';

export { FUNDED_COINS, OTHER_WORDS, TEST_MADE_AT, TEST_WORDS, freshRecord, fundTestWallet, setSiteData, testRecord } from '../src/browser.ts';
export type { OpenOptions, OpenedPage, Passkey, PasskeyKind } from '../src/browser.ts';
export { DUMMY_TOKEN };

// -- where this run stands ------------------------------------------------------------

/**
 * The real origin of a live run, or null for the stand-in. live.ts sets
 * E2E_LIVE; the two settings alone do not switch a run to live, so a shell
 * that happens to hold them still gets the hermetic run from "pnpm e2e".
 */
function realOrigin(): RealOrigin | null {
  if (process.env.E2E_LIVE !== '1') return null;
  const { ORIGIN_URL, BOTS_API_TOKEN, ACCESS_CLIENT_ID, ACCESS_CLIENT_SECRET } = process.env;
  if (!ORIGIN_URL || !BOTS_API_TOKEN) throw new Error('A live run needs ORIGIN_URL and BOTS_API_TOKEN');
  return { url: ORIGIN_URL, botsToken: BOTS_API_TOKEN, accessClientId: ACCESS_CLIENT_ID, accessClientSecret: ACCESS_CLIENT_SECRET };
}

/** True when the scenarios run against a real practice network. */
export const LIVE = process.env.E2E_LIVE === '1';

/**
 * The files of a scenarios folder that a run would pass over, each with the
 * reason. "pnpm e2e:live" runs the files named *.test.ts, in this folder and
 * the folders inside it. "pnpm e2e" hands the folder to Node's test runner,
 * which knows a few more names for a test file (send-test.ts, test-send.ts)
 * and no others. So a scenario in restore.ts is never run at all, and one in
 * send-test.ts is run against the stand-in and left out of the live run, and
 * neither run says a word: it is green, with fewer scenarios. Every code
 * file here therefore has to be a scenario file by the one name both runs
 * know, or say in its name that it is a helper.
 */
export function strayFiles(folder: string): string[] {
  const stray: string[] = [];
  const entries = readdirSync(folder, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('helpers.ts')) continue;
    const name = relative(folder, join(entry.parentPath, entry.name));
    stray.push(`${name} is neither a scenario file (*.test.ts) nor a helper (*helpers.ts): a run would pass over what is in it without a word`);
  }
  return stray.sort();
}

{
  const stray = strayFiles(fileURLToPath(new URL('./', import.meta.url)));
  if (stray.length > 0) throw new Error(`e2e/scenarios holds a file that a run would pass over:\n  ${stray.join('\n  ')}`);
}

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url));

/** The newest change time among the files of a folder, in ms. */
function newestIn(folder: string): number {
  let newest = 0;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(folder, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestIn(path) : statSync(path).mtimeMs);
  }
  return newest;
}

/**
 * The built app the scenarios run: the folder E2E_DIST names, or app/dist.
 * A build that is older than the source it was made from would prove
 * nothing about the code as it stands, so that fails here, before any
 * scenario runs, with the way out in the message.
 */
function builtApp(): string {
  const named = process.env.E2E_DIST;
  // A name that is not a full path is read against the folder the command was typed in (pnpm keeps it in INIT_CWD).
  if (named) return resolve(process.env.INIT_CWD ?? process.cwd(), named);
  const dist = join(APP_DIR, 'dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('No built app in app/dist. Run "pnpm build" first.');
  const built = statSync(join(dist, 'index.html')).mtimeMs;
  const sources = [
    join(APP_DIR, 'src'),
    join(APP_DIR, 'public'),
    fileURLToPath(new URL('../../wallet/src/', import.meta.url)),
    fileURLToPath(new URL('../../contract/src/', import.meta.url)),
  ];
  const files = ['index.html', 'vite.config.ts', 'svelte.config.js', 'package.json'].map((name) => statSync(join(APP_DIR, name)).mtimeMs);
  const changed = Math.max(...files, ...sources.map(newestIn));
  if (changed > built) throw new Error('app/dist is older than the source. Run "pnpm build" again, then "pnpm e2e".');
  return dist;
}

/** One Chrome for all the scenarios of a file. Each page still gets storage of its own. */
let chrome: Promise<Chrome> | null = null;
after(async () => {
  if (chrome) await (await chrome).close();
});

// -- the network, stand-in or real ------------------------------------------------------

/** The practice network as a scenario may use it in every kind of run. */
export interface Network {
  /** The height of the chain. */
  height(): Promise<number>;
  /**
   * Waits for the next block and gives the new height. The stand-in makes
   * one at once (and it takes every waiting payment). A real network makes
   * one about every 30 seconds.
   */
  nextBlock(): Promise<number>;
  /** The unspent coins an address holds, waiting ones included: how many, and their sum in sats. */
  coins(address: string): Promise<{ count: number; sats: number }>;
}

function networkOf(stack: Stack, origin: RealOrigin | null): Network {
  // The origin is asked directly, not through the Worker: this is the second opinion.
  const esplora = new Esplora(`${stack.originUrl}/esplora`, (input, init) => {
    const headers = new Headers(init?.headers);
    if (origin?.accessClientId && origin.accessClientSecret) {
      headers.set('CF-Access-Client-Id', origin.accessClientId);
      headers.set('CF-Access-Client-Secret', origin.accessClientSecret);
    }
    return fetch(input, { ...init, headers, redirect: 'manual' });
  });
  return {
    height: () => esplora.tipHeight(),
    async nextBlock() {
      if (stack.network) return stack.network.mine();
      const before = await esplora.tipHeight();
      const deadline = Date.now() + 150_000;
      for (;;) {
        await new Promise((wake) => setTimeout(wake, 1000));
        const now = await esplora.tipHeight();
        if (now > before) return now;
        if (Date.now() > deadline) throw new Error(`no new block in 150 seconds (height ${before})`);
      }
    },
    async coins(address) {
      const utxos = await esplora.addressUtxos(address);
      return { count: utxos.length, sats: utxos.reduce((sum, utxo) => sum + utxo.value, 0) };
    },
  };
}

// -- what the bot check was drawn for -------------------------------------------------------

/**
 * The local bot check passes Cloudflare's dummy token and looks no further
 * (SPEC section 14). The deployed one also wants the token to have been made
 * for the action "faucet" and for the very address the faucet is asked to
 * pay (SPEC section 10), and no local run could tell: every widget hands out
 * the same token. What a run does have is the widget itself. So this
 * compares what the pages drew it for with what the faucet was then asked:
 * every widget for "faucet", and every address the faucet was asked to pay
 * with the dummy token named by a widget as its cData.
 *
 * `calls` is what the scenario's pages asked of the bot check
 * (page.turnstileCalls()); `asked` is the stack's `botChecks`. A scenario
 * whose pages drew no widget (it posts to the faucet by hand) is left alone.
 */
export function botCheckProblems(calls: readonly StandInCall[], asked: readonly { token: string; address: string }[]): string[] {
  const renders = calls.filter((call) => call.op === 'render');
  if (renders.length === 0) return [];
  const problems: string[] = [];
  for (const render of renders) {
    if (render.options?.action !== 'faucet') {
      problems.push(`a bot check widget was drawn for the action ${JSON.stringify(render.options?.action)}: the deployed Worker takes a token made for "faucet" and no other`);
    }
  }
  const drawnFor = new Set(renders.map((render) => render.options?.cData));
  for (const each of asked) {
    if (each.token === DUMMY_TOKEN && !drawnFor.has(each.address)) {
      problems.push(`the faucet was asked to pay ${each.address}, and no bot check widget was drawn for that address (cData): the deployed Worker would refuse the token`);
    }
  }
  return problems;
}

// -- a scenario ---------------------------------------------------------------------------

/** How long the pages are given after a scenario's last step to show what that step set going, in ms. */
const LAST_WORDS_MS = 300;

/** Thrown where a scenario reaches for the stand-in in a live run. scenario() reports it as a skip. */
class LocalOnly extends Error {}

export interface ScenarioOptions {
  /**
   * True for a scenario that drives the stand-in from its first line. A live
   * run then skips it before anything is started. (A scenario that only
   * reaches for `s.standIn` later is skipped at that point.)
   */
  localOnly?: boolean;
  /** Options for the Worker's surroundings: other settings, a shorter wait for the origin, the stand-in's own options. */
  stack?: Omit<StackOptions, 'origin'>;
  /** How long the scenario may take, in ms. Default 120,000 (300,000 in a live run, where a block takes its time). */
  timeout?: number;
}

/** A Chrome of a scenario's own, on a profile folder that outlives it (Scenario.chromeOn). */
export interface OwnChrome {
  /**
   * Opens a path of the app in a page of this Chrome's own context, where
   * what the page stores is written to the profile folder. Every page
   * opened here shares that storage, as the tabs of one browser do.
   */
  open(path?: string, options?: Omit<OpenOptions, 'path' | 'context'>): Promise<OpenedPage>;
  /**
   * Closes this Chrome, as a reader closes the browser. What its pages
   * stored stays in the profile folder. Until this has ended, nothing else
   * may use the folder (setSiteData, a second Chrome). Left open, it is
   * closed when the scenario ends.
   */
  close(): Promise<void>;
}

export interface Scenario {
  /** The app's address in this scenario: http://localhost:<port>. */
  url: string;
  /**
   * The Worker's side: its recorders (`events`, `lines`, `botChecks`), `over` to make a limiter refuse, the
   * config, and `advanceClock` to let time pass for the Worker (where the pot's counts are switched on, it keeps
   * them for 15 seconds, and asks nobody for 5 seconds after a question that failed).
   */
  stack: Stack;
  /** The practice network, with the calls that work on the stand-in and on a real one alike. */
  network: Network;
  /**
   * The stand-in's controls: fund, mine, setFaucet, setEsploraLag, setOrigin,
   * height, requests. Reading this in a live run ends the scenario there as
   * "local only".
   */
  readonly standIn: FakeOrigin;
  /** Opens a path of the app in a page of its own (own storage, unless `context` says otherwise). Default path "/". */
  open(path?: string, options?: Omit<OpenOptions, 'path'>): Promise<OpenedPage>;
  /**
   * Opens an empty page of another site (http://elsewhere.test:<port>) that
   * is allowed to send requests to the app's address: what a hostile page in
   * the reader's browser could do.
   */
  openElsewhere(): Promise<OpenedPage>;
  /**
   * Starts another site (http://elsewhere.test:<port>), where every path
   * answers one empty page, and gives its address. For a reader who leaves
   * the app in the same tab and comes back: the page that goes there is
   * opened with `allow: [address]`. The site is closed when the scenario
   * ends.
   */
  elsewhere(): Promise<string>;
  /**
   * Starts a Chrome of this scenario's own on `profile`, a folder the
   * scenario names, and removes when it is done with it. For what a browser
   * keeps when it is closed and opened again, and for a setting of the
   * browser itself: close it, change the setting (setSiteData), and start
   * another on the same folder. Its pages are watched like the pages of
   * s.open(), and what they recorded is checked at the scenario's end, also
   * for a Chrome that was closed long before.
   */
  chromeOn(profile: string): Promise<OwnChrome>;
  /**
   * Says that the Worker is meant to log this fault in this scenario: the
   * scenario takes the practice network down, say ("origin_down"). A fault
   * nobody expected fails the scenario, and so does an expected one that
   * never comes. The handler's own fault ("handler": it threw) cannot be
   * expected.
   */
  expectFault(fault: Exclude<Fault, 'handler'>): void;
}

/** A site that is not the app: every path answers one empty page, with no security policy of its own. */
async function startElsewhere(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><meta charset="utf-8"><title>elsewhere</title>');
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  const { port } = server.address() as AddressInfo;
  return {
    // Chrome is started so that every name under .test is this machine (browser.ts).
    url: `http://elsewhere.test:${port}`,
    close: () =>
      new Promise<void>((closed) => {
        server.close(() => closed());
        server.closeAllConnections();
      }),
  };
}

/**
 * Registers one scenario with node:test. See the top of this file.
 */
export function scenario(name: string, run: (s: Scenario) => Promise<void>): void;
export function scenario(name: string, options: ScenarioOptions, run: (s: Scenario) => Promise<void>): void;
export function scenario(
  name: string,
  optionsOrRun: ScenarioOptions | ((s: Scenario) => Promise<void>),
  maybeRun?: (s: Scenario) => Promise<void>,
): void {
  const options = typeof optionsOrRun === 'function' ? {} : optionsOrRun;
  const run = typeof optionsOrRun === 'function' ? optionsOrRun : maybeRun!;
  const skip = LIVE && options.localOnly ? 'local only: it drives the stand-in network' : false;
  const limit = options.timeout ?? (LIVE ? 300_000 : 120_000);

  // The runner's own time limit is only a backstop: it would end the test
  // without closing what the scenario opened. The limit that counts is the
  // one below, which ends the scenario from inside.
  test(name, { skip, timeout: limit + 30_000 }, async (t) => {
    const origin = realOrigin();
    const dist = builtApp();
    const stack = await startStack({ ...options.stack, origin: origin ?? undefined });
    const closers: (() => Promise<void>)[] = [() => stack.close()];
    const pages: OpenedPage[] = [];
    /** The faults the scenario said it would cause, and whether each has come. */
    const expectedFaults = new Map<Fault, boolean>();
    /** What the checks at the scenario's end found, beside what the pages and the server recorded. */
    const found: string[] = [];
    let server: LocalServer | null = null;
    let outcome: 'passed' | 'failed' | 'skipped' = 'failed';
    try {
      server = await serve({ dist, handler: stack.handler });
      closers.push(() => server!.close());
      chrome ??= launchChrome();
      const browser = await chrome;
      const url = server.url;

      const s: Scenario = {
        url,
        stack,
        network: networkOf(stack, origin),
        get standIn() {
          if (!stack.network) throw new LocalOnly('local only: it drives the stand-in network');
          return stack.network;
        },
        open: async (path = '/', openOptions = {}) => {
          const page = await openPage(browser, url, { ...openOptions, path });
          pages.push(page);
          return page;
        },
        openElsewhere: async () => {
          const elsewhere = await startElsewhere();
          closers.push(elsewhere.close);
          const page = await openPage(browser, elsewhere.url, { allow: [url] });
          pages.push(page);
          return page;
        },
        elsewhere: async () => {
          const elsewhere = await startElsewhere();
          closers.push(elsewhere.close);
          return elsewhere.url;
        },
        chromeOn: async (profile) => {
          const own = await launchChrome({ profile });
          let closed = false;
          const close = async (): Promise<void> => {
            if (closed) return;
            closed = true;
            await own.close();
          };
          // Should the scenario end with it open: closed before the servers are.
          closers.push(close);
          return {
            open: async (path = '/', openOptions = {}) => {
              // In Chrome's own context, not one made for the page: only that one is written to the profile.
              const page = await openPage(own, url, { ...openOptions, path, context: own.browser.defaultBrowserContext() });
              pages.push(page);
              return page;
            },
            close,
          };
        },
        expectFault: (fault) => {
          if ((fault as Fault) === 'handler') throw new Error('expectFault: a handler that throws is never meant to happen');
          if (!expectedFaults.has(fault)) expectedFaults.set(fault, false);
        },
      };

      // A scenario that hangs is ended here, so that its pages and servers are still closed below.
      const body = run(s);
      body.catch(() => {}); // if it loses the race, its own end is of no interest
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`the scenario was not done after ${limit} ms`)), limit);
      });
      try {
        await Promise.race([body, late]);
      } finally {
        clearTimeout(timer);
      }

      // The scenario's own steps are done. What the last of them set going
      // gets a moment to show: a page may still be talking to the server, or
      // have a timer about to fire. Read at once, the pages would look clean.
      const ended = performance.now();
      await Promise.all(pages.map((page) => page.settle(LAST_WORDS_MS)));
      await new Promise((wake) => setTimeout(wake, Math.max(0, LAST_WORDS_MS - (performance.now() - ended))));
      // One trip to each page and back: whatever Chrome has reported by now has arrived here. (A page the
      // scenario closed has no more to say, and one that is stuck is not waited for.)
      await Promise.all(
        pages.map((page) =>
          Promise.race([
            page.page.evaluate(() => new Promise<void>((back) => setTimeout(back, 0))).catch(() => {}),
            new Promise<void>((giveUp) => setTimeout(giveUp, 2000).unref()),
          ]),
        ),
      );
      await stack.settled();

      const calls = (await Promise.all(pages.map((page) => page.turnstileCalls()))).flat();
      found.push(...botCheckProblems(calls, stack.botChecks));
      if (pages.length === 0) found.push('the scenario opened no page: it shows nothing about the app in a browser');
      outcome = 'passed';
    } catch (error) {
      if (!(error instanceof LocalOnly)) throw error;
      outcome = 'skipped';
      t.skip(error.message);
    } finally {
      // The Worker's own log. A refusal is part of how the app talks to its
      // Worker; a fault is the Worker saying that something is broken.
      const faults: string[] = [];
      for (const line of stack.lines) {
        if (line.fault === null) continue;
        if (expectedFaults.has(line.fault)) expectedFaults.set(line.fault, true);
        else faults.push(`the Worker logged a fault: ${line.route} ${line.status} ${line.fault}`);
      }
      for (const [fault, came] of expectedFaults) {
        if (!came) faults.push(`expected and never logged: the fault ${fault}`);
      }
      // What the pages, the server and the Worker recorded. After a pass it
      // decides. After a failure or a skip it is only shown: the failure
      // itself is the news, and a scenario that stopped halfway proves nothing.
      const problems = [
        ...pages.flatMap((page, index) => page.problems().map((line) => `page ${index + 1}: ${line}`)),
        ...(server?.faults ?? []).map((fault) => `local server: ${fault}`),
        ...faults,
        ...found,
      ];
      for (const page of pages) await page.close();
      for (const close of closers.reverse()) await close();
      if (outcome === 'passed') assert.deepEqual(problems, [], 'the scenario must end clean: its pages, the local server and the Worker\'s log');
      else for (const problem of problems) t.diagnostic(problem);
    }
  });
}
