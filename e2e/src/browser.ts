// Headless Chrome for the end-to-end tools: the smoke command and the scenarios.
//
// launchChrome() starts the Chrome installed on this machine (puppeteer-core
// brings no browser of its own) on a throwaway profile, or on a profile
// folder that makeProfile() made and the caller keeps (for what a browser
// holds when it is closed and opened again, and for a setting of the
// browser itself: setSiteData). Both take such a folder and no other: a
// folder under the system's temporary folder that this harness made itself.
// So neither can be pointed at a person's own browser profile, where
// setSiteData would switch that person's Chrome to blocking all site data.
// openPage() opens one page of the local server and watches it:
//
//   - Every console error, every uncaught error and every violation of the
//     page's Content-Security-Policy is recorded as a failure, in the page
//     and in a Worker the page starts. One kind of line does not count, and
//     only that kind: Chrome's own "Failed to load resource" for a 4xx or
//     5xx answer under /api/ or /p/. The app expects such answers (a
//     transaction not found yet, a faucet that is busy) and shows its own
//     text for them.
//   - A file of the app that is not there is a failure. The server answers
//     a path that names no file with the app's own page and status 200, as
//     Cloudflare does, and Chrome then says next to nothing: two warnings
//     for a font, not a word for a picture.
//   - A request to any host but the local server is refused and recorded as
//     a failure. One address is answered instead of refused: the bot check's
//     script, with the stand-in of fake-turnstile.ts.
//   - The page cannot open another window: window.open and a link that
//     would open one are stopped before they start, and recorded as a
//     failure. Only the page that was opened is watched, so what a second
//     window did would go unseen.
//
// Chrome is also started so that no name but "localhost" and "*.test"
// resolves at all: a request this file never sees finds no host to go to.
// One thing could still leave the machine, and it is why windows are
// stopped before they start: when a whole window fails to find its host,
// Chrome itself asks the system's DNS servers for a well-known name, to
// tell the reader whether the network is down. A window that opens in
// spite of everything is closed at once and fails the run.
//
// A page can be given a virtual passkey authenticator, a wallet already in
// its storage, a width, a language and a slow phone's speed.

import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import puppeteer, { PredefinedNetworkConditions, type Browser, type BrowserContext, type CDPSession, type Page } from 'puppeteer-core';
import type { Lang } from '@learnbitcoin/practice-contract';
import { accountFromMnemonic, deriveAddress, newMnemonic, watchOnlyAccount } from '@learnbitcoin/practice-wallet';
import { RECORD_KEY, makeRecord, type WalletRecord } from '../../app/src/lib/keystore.ts';
import { TURNSTILE_SCRIPT } from '../../app/src/lib/turnstile.ts';
import type { FakeOrigin } from './fake-origin.ts';
import { fakeTurnstileScript, type StandInCall, type StandInState, type TurnstileMode, type TurnstileTiming } from './fake-turnstile.ts';

// -- Chrome -----------------------------------------------------------------------

/** Where Chrome is on a Mac. The setting CHROME_PATH names another Chrome or Chromium. */
export const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * Which names Chrome may look up. "localhost" is the local server (it
 * listens on IPv4 only). Any name ending in ".test" is this machine too: a
 * scenario uses one for a page of "another site". No other name resolves,
 * so nothing can reach the network by accident.
 */
const RESOLVER_RULES = 'MAP localhost 127.0.0.1, MAP *.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1';

export interface Chrome {
  browser: Browser;
  /** Closes Chrome and removes its profile directory. */
  close(): Promise<void>;
}

let endsOnSignals = false;

/**
 * Makes an interrupt, a "stop" or a hangup end this process the ordinary
 * way, through its "exit" hooks: that is where a Chrome profile, and the
 * smoke command's build, are removed. Left alone, Node ends at once on such
 * a signal and runs no hook, and puppeteer's own handlers stop Chrome
 * without ending the process. Once per process; calling it again does nothing.
 */
export function endOnSignals(): void {
  if (endsOnSignals) return;
  endsOnSignals = true;
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]] as const) {
    process.on(signal, () => process.exit(code));
  }
}

export interface ChromeOptions {
  /**
   * A profile folder that makeProfile() made, in place of a throwaway one.
   * Chrome keeps what its pages store in it (the pages of its own context:
   * `browser.defaultBrowserContext()`), so a Chrome started on the same
   * folder later finds it again, as a browser that was closed and opened
   * again does. It is NOT removed when Chrome is closed, or when this
   * process ends: it is the caller's to remove. Any other folder is
   * refused, and nothing is started (ownProfile).
   */
  profile?: string;
}

/** The profile folders makeProfile() has made in this process, each by its real path. */
const madeProfiles = new Set<string>();

/**
 * Makes a new, empty profile folder under the system's temporary folder
 * and gives its path: for a Chrome that the caller starts more than once
 * on the same folder (launchChrome with `profile`) and whose own settings
 * it changes in between (setSiteData). The folder is the caller's to
 * remove when it is done with it.
 *
 * It is the one way to such a folder. launchChrome and setSiteData take a
 * folder that this function made, in this process, and refuse every other.
 */
export async function makeProfile(): Promise<string> {
  const folder = realpathSync(await mkdtemp(join(tmpdir(), 'lbp-own-profile-')));
  madeProfiles.add(folder);
  return folder;
}

/**
 * The real path of a profile folder that the harness may start a Chrome on
 * or write a setting into. It throws for every other folder, before
 * anything is started, read or written:
 *
 *   - a folder that is not there;
 *   - one whose real path does not lie under the system's temporary
 *     folder (a link that sits in the temporary folder and leads out of it
 *     is where it leads);
 *   - one that makeProfile() did not make in this process.
 *
 * A person's own browser profile is none of these. Chrome's own folder has
 * the very file setSiteData rewrites, so a path given by mistake would
 * otherwise go through without a word.
 */
function ownProfile(folder: string, asked: string): string {
  let real: string;
  try {
    real = realpathSync(folder);
  } catch {
    throw new Error(`${asked}: there is no folder ${folder}. A profile folder is made with makeProfile().`);
  }
  const temporary = realpathSync(tmpdir());
  if (!real.startsWith(temporary + sep)) {
    throw new Error(`${asked}: ${folder} is not under the system's temporary folder. Only a throwaway profile that makeProfile() made is taken, never a browser profile of somebody's own.`);
  }
  if (!madeProfiles.has(real)) {
    throw new Error(`${asked}: ${folder} is not a profile folder that makeProfile() made in this run. Only such a folder is taken.`);
  }
  return real;
}

export async function launchChrome(options: ChromeOptions = {}): Promise<Chrome> {
  /** True for a throwaway profile, which goes with its Chrome. */
  const throwaway = options.profile === undefined;
  // A folder the caller names is looked at first: one that is not a throwaway folder of this harness's own
  // making stops here, before Chrome is looked for or anything is started.
  const named = options.profile === undefined ? null : ownProfile(options.profile, 'launchChrome');
  const executablePath = process.env.CHROME_PATH || DEFAULT_CHROME_PATH;
  if (!existsSync(executablePath)) {
    throw new Error(`No Chrome at ${executablePath}. Set CHROME_PATH to a Chrome or Chromium program.`);
  }
  endOnSignals();
  const profile = named ?? (await mkdtemp(join(tmpdir(), 'lbp-chrome-')));
  /** Chrome's process, once it runs. */
  let running: ChildProcess | null = null;
  const removeProfile = () => {
    // Chrome first, with its helpers (it leads a process group of its own): it writes into the profile as
    // long as it lives. Only while it is known to be running: the number of a process that has ended may
    // belong to another by now.
    if (running !== null && running.pid !== undefined && running.exitCode === null && running.signalCode === null) {
      try {
        process.kill(-running.pid, 'SIGKILL');
      } catch {
        // Gone already.
      }
    }
    // The helpers go on writing for a moment after that. (A profile the caller named is the caller's.)
    if (throwaway) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  // If this process ends before close() is called, the profile still goes.
  process.once('exit', removeProfile);
  let browser: Browser;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      userDataDir: profile,
      // Over a pipe, not a socket: Chrome then ends by itself when this process is killed outright and no hook can run.
      pipe: true,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-component-update', `--host-resolver-rules=${RESOLVER_RULES}`],
    });
  } catch (error) {
    process.off('exit', removeProfile);
    removeProfile();
    throw error;
  }
  running = browser.process();
  // Chrome's helper processes (its updater among them) inherit its output
  // and can outlive it by minutes. A pipe that is still read keeps this
  // process alive for as long, so the two pipes are let go of: they are read
  // while there is something to read, and they no longer hold the process open.
  (running?.stdout as { unref?(): void } | null)?.unref?.();
  (running?.stderr as { unref?(): void } | null)?.unref?.();
  return {
    browser,
    close: async () => {
      await browser.close();
      process.off('exit', removeProfile);
      if (throwaway) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

/**
 * Sets, in a profile folder, Chrome's own default for cookies and site
 * data: what a reader sets under "Third-party cookies" and "On-device site
 * data" in Chrome's settings. "block" is "Don't allow sites to save data on
 * your device": Chrome then refuses every page the mere mention of its
 * storage (reading `window.localStorage` throws a SecurityError), and
 * deletes nothing that is stored. "allow" is Chrome's default.
 *
 * The setting is written where Chrome's settings page writes it, the
 * profile's own Preferences file, so Chrome must not be running on the
 * folder: it writes that file when it closes, and reads it when it starts.
 * The folder must have been used by a Chrome once (launchChrome with
 * `profile`), or there is no such file yet.
 *
 * `profile` is a folder that makeProfile() made. Any other folder is
 * refused, and no file in it is read or written (ownProfile): a person's
 * own Chrome folder has this file too.
 */
export function setSiteData(profile: string, setting: 'allow' | 'block'): void {
  const file = join(ownProfile(profile, 'setSiteData'), 'Default', 'Preferences');
  if (!existsSync(file)) throw new Error(`setSiteData: no Preferences file in ${profile}. Start Chrome on this profile once, and close it, first.`);
  const preferences = JSON.parse(readFileSync(file, 'utf8')) as { profile?: { default_content_setting_values?: Record<string, number> } };
  preferences.profile ??= {};
  preferences.profile.default_content_setting_values ??= {};
  // Chrome's numbers for a content setting: 1 allows, 2 blocks.
  preferences.profile.default_content_setting_values.cookies = setting === 'block' ? 2 : 1;
  writeFileSync(file, JSON.stringify(preferences));
}

// -- what fails a run ---------------------------------------------------------------

/** One line of the browser's console, as much of it as the rule below needs. */
export interface ConsoleEntry {
  /** The kind of line: "error", "warn", "log", "assert", ... */
  type: string;
  text: string;
  /** For a line about a resource: the resource's address. */
  url?: string;
}

/**
 * Whether a console line fails a run. Errors do (a failed console.assert is
 * one), with one exception: the line Chrome writes by itself for an answer
 * with a 4xx or 5xx status, when the answer came from /api/ or /p/ of the
 * local server (`localOrigins`). Those answers are part of how the app talks
 * to its Worker. The same line for any other address counts, and so does a
 * request under /api/ that failed without an answer.
 */
export function countsAsError(entry: ConsoleEntry, localOrigins: readonly string[]): boolean {
  if (entry.type !== 'error' && entry.type !== 'assert') return false;
  if (!/^Failed to load resource: the server responded with a status of [45][0-9][0-9]\b/.test(entry.text)) return true;
  if (entry.url === undefined) return true;
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return true;
  }
  if (!localOrigins.includes(url.origin)) return true;
  return !(url.pathname.startsWith('/api/') || url.pathname.startsWith('/p/'));
}

export interface Failure {
  /**
   * console: a console error. csp: the page's security policy blocked
   * something. pageerror: an uncaught error. request: a request to another
   * host. missing: a file of the app that the server does not have.
   * window: the page tried to open another window.
   */
  kind: 'console' | 'csp' | 'pageerror' | 'request' | 'missing' | 'window';
  text: string;
  url?: string;
}

/** What a page asks for as a file: Chrome's names for a font, a picture, a stylesheet, a script and the like. */
const FILE_KINDS: ReadonlySet<string> = new Set(['font', 'image', 'stylesheet', 'script', 'media', 'manifest', 'texttrack']);

/**
 * The path of a file of the app that is not there, or null. The server
 * answers a path that names no file with the app's own page, as Cloudflare
 * does. So a font, a picture, a stylesheet or a script that came back as a
 * page of HTML is a file that is missing from the build.
 *
 * A page's icon is asked for as "other". That counts too, with one
 * exception: /favicon.ico, which Chrome asks for by itself when a page
 * names no icon at all.
 */
export function missingFile(response: Pick<SeenResponse, 'url' | 'type' | 'headers'>, localOrigins: readonly string[]): string | null {
  let url: URL;
  try {
    url = new URL(response.url);
  } catch {
    return null;
  }
  if (!localOrigins.includes(url.origin)) return null;
  const asFile = FILE_KINDS.has(response.type) || (response.type === 'other' && url.pathname !== '/favicon.ico');
  if (!asFile) return null;
  // The Worker's own paths: whatever comes from there is the Worker's answer, not a file.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/p/')) return null;
  return /^text\/html\b/i.test(response.headers['content-type'] ?? '') ? url.pathname : null;
}

// -- passkeys -----------------------------------------------------------------------

/**
 * The passkey providers a page can be given (Chrome's virtual authenticator):
 *   prf         the secret comes with create(), as Chrome's own password manager gives it
 *   prf-at-get  create() says the secret is supported and does not give it; a get() does
 *   no-prf      a passkey without the secret: it cannot make a wallet
 */
export type PasskeyKind = 'prf' | 'prf-at-get' | 'no-prf';

export interface Passkey {
  kind: PasskeyKind;
  /**
   * The passkeys the authenticator holds. `id` is the passkey's ID as the
   * app keeps it (base64url); `uses` is how many get() calls it has answered.
   * It holds three at most: a fourth create() fails.
   */
  credentials(): Promise<{ id: string; uses: number; rpId: string }[]>;
  /**
   * From now on every prompt is refused at once, as when the reader cancels.
   * Keep it for the end of a page: an authenticator with the secret stays
   * blocked afterwards, whatever it is told.
   */
  refuse(): Promise<void>;
  /** false: a prompt gets no answer and waits for its timeout. true: prompts are answered again. */
  setPresence(present: boolean): Promise<void>;
  /** Removes one passkey, as when the reader deletes it in their password manager. */
  remove(id: string): Promise<void>;
  /** Removes every passkey. */
  clear(): Promise<void>;
}

const toBase64url = (base64: string) => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const toBase64 = (base64url: string) => base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');

async function addPasskey(cdp: CDPSession, kind: PasskeyKind): Promise<Passkey> {
  const uses = new Map<string, number>();
  cdp.on('WebAuthn.credentialAsserted', (event) => {
    const id = toBase64url(event.credential.credentialId);
    uses.set(id, (uses.get(id) ?? 0) + 1);
  });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      // "internal" makes it the device's own authenticator, the kind the app asks for.
      transport: 'internal',
      // The app asks for a passkey the authenticator stores, and for the reader to be verified.
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      ...(kind === 'prf' ? { hasPrf: true } : kind === 'prf-at-get' ? { hasHmacSecret: true } : {}),
    },
  });
  return {
    kind,
    credentials: async () => {
      const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      return credentials.map((credential) => {
        const id = toBase64url(credential.credentialId);
        return { id, uses: uses.get(id) ?? 0, rpId: credential.rpId ?? '' };
      });
    },
    refuse: async () => {
      await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    },
    setPresence: async (present) => {
      await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: present });
    },
    remove: async (id) => {
      await cdp.send('WebAuthn.removeCredential', { authenticatorId, credentialId: toBase64(id) });
    },
    clear: async () => {
      await cdp.send('WebAuthn.clearCredentials', { authenticatorId });
    },
  };
}

// -- prepared wallets -----------------------------------------------------------------

/**
 * The 12 words of the harness's test wallet: the first test phrase of the
 * BIP39 standard. Everybody knows them, so they guard nothing anywhere.
 */
export const TEST_WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** The words of a second wallet, for scenarios that need another one: BIP39's second test phrase. */
export const OTHER_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

/** When the prepared wallets say they were made: noon UTC on November 1, 2026 (whole ms, as a record requires). */
export const TEST_MADE_AT = Date.UTC(2026, 10, 1, 12);

/** The record of a wallet made without a passkey, as the app itself would have stored it. */
export function testRecord(words: string = TEST_WORDS): WalletRecord {
  return makeRecord('words', words, TEST_MADE_AT);
}

/**
 * The record of a wallet nobody has seen before, from 12 new random words
 * (they are in the record's `mnemonic`). For a scenario that must start
 * with no history on any network: on a real practice network the test
 * words above may have been paid by anybody.
 */
export function freshRecord(): WalletRecord {
  return makeRecord('words', newMnemonic(), TEST_MADE_AT);
}

/**
 * What the "funded" wallet holds: three coins on its first three receive
 * addresses. Two are confirmed (the first is the size of a faucet payment)
 * and one is still waiting for a block. 142,500 sats in all.
 */
export const FUNDED_COINS = [
  { index: 0, sats: 100_000, confirmed: true },
  { index: 1, sats: 40_000, confirmed: true },
  { index: 2, sats: 2_500, confirmed: false },
] as const;

/** Pays the test wallet its coins on the stand-in network. */
export function fundTestWallet(
  network: Pick<FakeOrigin, 'fund'>,
  words: string = TEST_WORDS,
): { index: number; address: string; sats: number; confirmed: boolean; txid: string }[] {
  const watch = watchOnlyAccount(accountFromMnemonic(words).xpub);
  return FUNDED_COINS.map((coin) => {
    const { address } = deriveAddress(watch, 0, coin.index);
    return { ...coin, address, txid: network.fund(address, coin.sats, { confirmed: coin.confirmed }) };
  });
}

// -- a page -------------------------------------------------------------------------

export interface OpenOptions {
  /** The path to open, with its query if it has one. Default "/". */
  path?: string;
  /** The window's width in CSS pixels. Default 1280, or 360 with `phone`. */
  width?: number;
  /** Default 812 for a width under 600 (a phone held upright), else 900. */
  height?: number;
  /** The browser's language (navigator.language and Accept-Language). Default "en". The app's own language is in the path. */
  lang?: Lang;
  /**
   * A wallet to put in the page's storage before its own script first runs:
   * a record (testRecord()), or the stored text itself for a record that is
   * damaged, tampered with or from a newer version.
   */
  record?: WalletRecord | string;
  /** Other localStorage keys to set first. */
  storage?: Record<string, string>;
  /** Give the page a passkey provider. Without one the page sees a device that has no passkeys. */
  passkey?: PasskeyKind;
  /** How the bot check ends on this page. Default "pass". */
  turnstile?: TurnstileMode;
  turnstileTiming?: TurnstileTiming;
  /**
   * A slow phone: a 4x slower processor, a slow 4G connection, a phone's
   * screen and touch. For timing.
   *
   * What the times are worth: the local server speaks HTTP/1.1, over which
   * Chrome sends six requests at a time. Ten chain reads sent at once, which
   * is how the wallet scans, therefore take two rounds of the connection's
   * delay (562 ms each) here. Cloudflare speaks HTTP/2 or HTTP/3 to a
   * browser, where the ten take one round. So a time that includes a scan
   * is too long by about the scan's own length: chain reads take about half
   * as long on the deployed site. Say so beside any figure taken this way.
   */
  phone?: boolean;
  /** Other origins this page may send requests to (the page of "another site" that calls the app). */
  allow?: string[];
  /** Open the page in this context, so it shares storage with the pages already there ("two tabs"). Default: a context of its own. */
  context?: BrowserContext;
  /**
   * How long a wait may take, in ms. Default 10,000. Loading a page is not
   * such a wait: it gets ten seconds at least, however short this is. (On a
   * busy machine a page can take longer to load than a test wants to wait
   * for something that is never coming.)
   */
  timeout?: number;
}

/** A response the page received. */
export interface SeenResponse {
  url: string;
  method: string;
  status: number;
  /** Chrome's name for what was asked for: document, script, stylesheet, font, image, fetch, ... */
  type: string;
  /** The response's headers, with lower-case names. */
  headers: Record<string, string>;
}

export interface OpenedPage {
  /** Puppeteer's page, for anything the helpers below do not cover. */
  page: Page;
  /** The context the page lives in: pass it as `context` to open a second tab on the same storage. */
  context: BrowserContext;
  /** The status of the document that was opened. */
  status: number | null;
  /** From the start of the navigation to the page's load event, in ms. */
  loadMs: number;
  /** Everything so far that fails a run. */
  failures: Failure[];
  /** Every response so far. */
  responses: SeenResponse[];
  /** The passkey provider, when the page was given one. */
  passkey: Passkey | null;

  /** Clicks the element with this data-testid, once it is on screen and enabled. A real click, as the reader's. */
  click(testid: string): Promise<void>;
  /** Puts text in the field with this data-testid, in place of what it held. */
  fill(testid: string, text: string): Promise<void>;
  /** The text of the first element with this data-testid, once there is one. Runs of white space read as one space. */
  text(testid: string): Promise<string>;
  /** The text of every element with this data-testid, in page order. Empty when there is none. */
  texts(testid: string): Promise<string[]>;
  /** Waits until an element with this data-testid is on screen. */
  waitFor(testid: string): Promise<void>;
  /** Waits until no element with this data-testid is on screen. */
  waitForGone(testid: string): Promise<void>;
  /**
   * Waits until the status region (data-testid "status") has said something
   * that holds `expected` or matches it, and gives the text. Everything the
   * region says is kept from the moment the page opens, across reloads, so
   * a message that came and went before this call still counts. Each
   * message is given once, and the ones before it are passed over.
   *
   * That memory cuts both ways: a message from an earlier step that nobody
   * asked about is still there, and would answer a wait meant for a later
   * step. Call forgetStatus() before a step whose message can be the same
   * words as an earlier one ("Payment sent", twice).
   */
  waitForStatus(expected: string | RegExp): Promise<string>;
  /**
   * Passes over everything the status region has said so far: from now on
   * waitForStatus() hears only what is said after this call. statusLog()
   * still holds it all.
   */
  forgetStatus(): void;
  /** Everything the status region has said so far, oldest first. */
  statusLog(): string[];
  /**
   * Waits for an element with this data-testid and gives the ms since the
   * navigation started. Under `phone`, read what that option says about
   * times that include chain reads.
   */
  timeTo(testid: string): Promise<number>;
  /**
   * Waits until the page has stopped talking to the server: nothing asked
   * and nothing answered for `quietMs` (default 400). Gives false if it was
   * never quiet for that long within the page's timeout.
   */
  settle(quietMs?: number): Promise<boolean>;
  /** Saves a picture of the whole page. Folders on the way are made. */
  shot(file: string): Promise<void>;
  /** How many pixels wider than the window the page is: 0 when it fits, more when it scrolls sideways. */
  sidewaysScroll(): Promise<number>;
  /** Opens another path of the app in this page, as a full page load. */
  goto(path: string): Promise<void>;
  /** The text stored under a localStorage key (default: the wallet's record), or null. */
  stored(key?: string): Promise<string | null>;
  /** Stores text under a localStorage key, or removes the key with null. For records altered behind the app's back. */
  store(key: string, value: string | null): Promise<void>;
  /** Changes how the bot check ends from now on, also for a widget already drawn. */
  setTurnstile(mode: TurnstileMode, timing?: TurnstileTiming): Promise<void>;
  /**
   * What the page asked of the bot check since it was opened, reloads
   * included: each render (with its options), reset, execute and remove.
   */
  turnstileCalls(): Promise<StandInCall[]>;
  /**
   * Says that failures matching this pattern are meant to happen in this
   * scenario and do not fail it. One that never happens does fail it.
   */
  expectFailure(pattern: RegExp): void;
  /** What fails the run so far, one line each: every failure not expected, and every expected one that has not come. */
  problems(): string[];
  /** Closes the page, and its context unless it was opened in a shared one. */
  close(): Promise<void>;
}

/**
 * The harness's own empty page on the app's origin: a place to stand while
 * storage is prepared. Never reaches the server. It names an empty icon, so
 * that Chrome does not go looking for /favicon.ico on its behalf.
 */
const BLANK_PATH = '/__harness/blank';
const BLANK_PAGE = '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>harness</title>';

const TURNSTILE_URL = new URL(TURNSTILE_SCRIPT);

const byTestId = (testid: string) => `[data-testid="${testid}"]`;

/** The name under which a page can tell this process what its status region just said. */
const SAID = '__harnessSaid';

/** The name under which the stand-in bot check tells this process what the page asked of it. */
const BOT_CHECK_ASKED = '__harnessBotCheck';

/** The name under which a page tells this process that it tried to open another window. */
const WINDOW_REFUSED = '__harnessWindow';

/**
 * Runs in the page before any of its own scripts, on every load: the page
 * cannot open another window. window.open opens nothing, and a click on a
 * link that would open one (target="_blank", or any name of a window) goes
 * nowhere. Both are reported.
 */
function refuseWindows(report: string): void {
  const tell = (url: string): void => {
    (window as unknown as Record<string, (url: string) => void>)[report]!(url);
  };
  // These targets stay in the window the page is in. Every other one is a window of its own.
  const stays = (target: string): boolean => ['', '_self', '_parent', '_top'].includes(target.toLowerCase());
  const open = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string): Window | null => {
    if (target !== undefined && target !== '' && stays(target)) return open(url, target, features);
    tell(url === undefined ? 'about:blank' : String(url));
    // What a page is told when its window was blocked.
    return null;
  };
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href], area[href]') : null;
      if (!(link instanceof HTMLAnchorElement || link instanceof HTMLAreaElement)) return;
      if (stays(link.target)) return;
      event.preventDefault();
      tell(link.href);
    },
    true,
  );
}

/**
 * Runs in the page before any of its own scripts, on every load: reports
 * every new thing the status region says, so that a test can ask about a
 * message that has already been replaced.
 */
function watchStatus(report: string): void {
  let last = '';
  const read = () => {
    const regions = Array.from(document.querySelectorAll('[data-testid="status"]'));
    const text = regions
      .map((region) => (region.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter((each) => each !== '')
      .join(' | ');
    if (text !== last && text !== '') (window as unknown as Record<string, (said: string) => void>)[report]!(text);
    last = text;
  };
  new MutationObserver(read).observe(document, { subtree: true, childList: true, characterData: true });
}

/**
 * Opens one page of the local server at `baseUrl` (http://localhost:<port>)
 * and watches it. See the top of this file for what is recorded.
 */
export async function openPage(chrome: Chrome, baseUrl: string, options: OpenOptions = {}): Promise<OpenedPage> {
  const base = new URL(baseUrl);
  const timeout = options.timeout ?? 10_000;
  const ownContext = options.context === undefined;
  const context = options.context ?? (await chrome.browser.createBrowserContext());
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(Math.max(timeout, 10_000));
  const cdp = await page.createCDPSession();

  const failures: Failure[] = [];
  const responses: SeenResponse[] = [];
  const expected: { pattern: RegExp; seen: boolean }[] = [];
  const localOrigins = [base.origin, ...(options.allow ?? []).map((url) => new URL(url).origin)];
  const turnstile = { mode: options.turnstile ?? ('pass' as TurnstileMode), timing: options.turnstileTiming ?? {} };

  const logged = (entry: ConsoleEntry): void => {
    if (!countsAsError(entry, localOrigins)) return;
    failures.push({ kind: /Content Security Policy/.test(entry.text) ? 'csp' : 'console', text: entry.text, url: entry.url });
  };
  page.on('console', (message) => {
    logged({ type: message.type(), text: message.text(), url: message.location().url });
  });
  page.on('pageerror', (error) => {
    failures.push({ kind: 'pageerror', text: error instanceof Error ? error.message : String(error) });
  });
  // A Worker the page starts. What its own script logs and throws arrives
  // through the two listeners above. What Chrome itself says about it (a
  // request that the security policy stopped) is only told when asked for.
  page.on('workercreated', (worker) => {
    worker.client.on('Log.entryAdded', ({ entry }) => {
      logged({ type: entry.level, text: entry.text, url: entry.url });
    });
    void worker.client.send('Log.enable').catch(() => {}); // the Worker may be gone already
  });
  // The page is kept from opening windows (refuseWindows). One that opens all the same is closed, and counts.
  page.on('popup', (popup) => {
    failures.push({ kind: 'window', text: 'the page opened another window, which the tools do not watch' });
    void popup?.close().catch(() => {});
  });
  /** When the page last asked for something or was answered. */
  let lastTraffic = performance.now();
  const traffic = () => {
    lastTraffic = performance.now();
  };
  page.on('requestfinished', traffic);
  page.on('requestfailed', traffic);
  page.on('response', (response) => {
    traffic();
    const request = response.request();
    const seen: SeenResponse = {
      url: response.url(),
      method: request.method(),
      status: response.status(),
      type: request.resourceType(),
      headers: response.headers(),
    };
    responses.push(seen);
    const missing = missingFile(seen, localOrigins);
    if (missing !== null) {
      failures.push({ kind: 'missing', text: `a file of the app is missing: ${missing} was answered with the app's page`, url: seen.url });
    }
  });

  // Every request is looked at before it leaves the browser.
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    traffic();
    const answered = (work: Promise<void>) => void work.catch(() => {}); // the page may be gone by now
    let target: URL;
    try {
      target = new URL(request.url());
    } catch {
      return answered(request.continue());
    }
    // data:, blob: and about: addresses go nowhere. The page's own policy decides about those.
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return answered(request.continue());
    if (target.origin === base.origin && target.pathname === BLANK_PATH) {
      return answered(request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: BLANK_PAGE }));
    }
    if (localOrigins.includes(target.origin)) return answered(request.continue());
    if (target.origin === TURNSTILE_URL.origin && target.pathname === TURNSTILE_URL.pathname) {
      const body = fakeTurnstileScript(turnstile.mode, turnstile.timing, BOT_CHECK_ASKED);
      return answered(request.respond({ status: 200, contentType: 'text/javascript; charset=utf-8', body }));
    }
    failures.push({ kind: 'request', text: `a request to another host was refused: ${request.method()} ${request.url()}`, url: request.url() });
    return answered(request.abort('blockedbyclient'));
  });

  // Passkeys. The virtual environment is switched on for every page, with or
  // without an authenticator in it: otherwise a prompt would go to this
  // machine's real passkeys, and what the page is told about the device
  // would depend on the machine the test runs on.
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const passkey = options.passkey ? await addPasskey(cdp, options.passkey) : null;

  // The same on every machine: the language asked for, and UTC for dates.
  const lang = options.lang ?? 'en';
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: await chrome.browser.userAgent(), acceptLanguage: lang });
  await page.emulateTimezone('UTC');

  const width = options.width ?? (options.phone ? 360 : 1280);
  const height = options.height ?? (width < 600 ? 812 : 900);
  if (options.phone) {
    await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.emulateCPUThrottling(4);
    await page.emulateNetworkConditions(PredefinedNetworkConditions['Slow 4G']);
  } else {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
  }

  /** Everything the status region has said, in this document and the ones before it. */
  const said: string[] = [];
  await page.exposeFunction(SAID, (text: string) => {
    said.push(text);
  });
  await page.evaluateOnNewDocument(watchStatus, SAID);

  /** Everything the page has asked of the bot check, in this document and the ones before it. */
  const botCheckCalls: StandInCall[] = [];
  await page.exposeFunction(BOT_CHECK_ASKED, (call: string) => {
    botCheckCalls.push(JSON.parse(call) as StandInCall);
  });

  await page.exposeFunction(WINDOW_REFUSED, (url: string) => {
    failures.push({ kind: 'window', text: `the page tried to open another window: ${url}`, url });
  });
  await page.evaluateOnNewDocument(refuseWindows, WINDOW_REFUSED);

  // The wallet goes into storage from an empty page of the same origin,
  // once, before the app's script has ever run. (Written on every load
  // instead, it would come back after the app removed it.)
  const seed: Record<string, string> = { ...options.storage };
  if (options.record !== undefined) seed[RECORD_KEY] = typeof options.record === 'string' ? options.record : JSON.stringify(options.record);
  if (Object.keys(seed).length > 0) {
    await page.goto(`${base.origin}${BLANK_PATH}`, { waitUntil: 'load' });
    await page.evaluate((items) => {
      for (const [key, value] of Object.entries(items)) localStorage.setItem(key, value);
    }, seed);
  }

  let started = performance.now();
  const first = await page.goto(`${base.origin}${options.path ?? '/'}`, { waitUntil: 'load' });
  const loadMs = Math.round(performance.now() - started);

  /** How many of the status region's messages waitForStatus has given out or passed over. */
  let heard = 0;

  const opened: OpenedPage = {
    page,
    context,
    status: first?.status() ?? null,
    loadMs,
    failures,
    responses,
    passkey,

    click: async (testid) => {
      await page.locator(byTestId(testid)).setTimeout(timeout).click();
    },
    fill: async (testid, text) => {
      await page.locator(byTestId(testid)).setTimeout(timeout).fill(text);
    },
    text: async (testid) => {
      const element = await page.waitForSelector(byTestId(testid), { timeout });
      return (await element!.evaluate((node) => node.textContent ?? '')).replace(/\s+/g, ' ').trim();
    },
    texts: (testid) =>
      page.$$eval(byTestId(testid), (nodes) => nodes.map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())),
    waitFor: async (testid) => {
      await page.waitForSelector(byTestId(testid), { visible: true, timeout });
    },
    waitForGone: async (testid) => {
      await page.waitForSelector(byTestId(testid), { hidden: true, timeout });
    },
    waitForStatus: async (wanted) => {
      const fits = (text: string) => (typeof wanted === 'string' ? text.includes(wanted) : wanted.test(text));
      const deadline = performance.now() + timeout;
      for (;;) {
        for (let i = heard; i < said.length; i += 1) {
          if (fits(said[i]!)) {
            heard = i + 1;
            return said[i]!;
          }
        }
        if (performance.now() > deadline) {
          throw new Error(`the status region did not say ${String(wanted)} within ${timeout} ms; it said: ${JSON.stringify(said.slice(heard))}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    forgetStatus: () => {
      heard = said.length;
    },
    statusLog: () => [...said],
    timeTo: async (testid) => {
      await page.waitForSelector(byTestId(testid), { visible: true, timeout });
      return Math.round(performance.now() - started);
    },
    settle: async (quietMs = 400) => {
      // Counted from the last request or answer, not from requests still open: one that the
      // browser dropped on the way (an icon, when the page moved on) would never close.
      const deadline = performance.now() + timeout;
      for (;;) {
        const quietFor = performance.now() - lastTraffic;
        if (quietFor >= quietMs) return true;
        if (performance.now() > deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, Math.min(quietMs - quietFor, 50)));
      }
    },
    shot: async (file) => {
      await mkdir(dirname(file), { recursive: true });
      await page.screenshot({ path: file as `${string}.png`, fullPage: true });
    },
    sidewaysScroll: () => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth)),
    goto: async (path) => {
      started = performance.now();
      await page.goto(`${base.origin}${path}`, { waitUntil: 'load' });
    },
    stored: (key = RECORD_KEY) => page.evaluate((name) => localStorage.getItem(name), key),
    store: async (key, value) => {
      await page.evaluate(
        (name, text) => {
          if (text === null) localStorage.removeItem(name);
          else localStorage.setItem(name, text);
        },
        key,
        value,
      );
    },
    setTurnstile: async (mode, timing = {}) => {
      turnstile.mode = mode;
      turnstile.timing = timing;
      // A script already in the page is told as well; a page loaded later gets a new script.
      await page.evaluate(
        (next, times) => {
          const state = (window as unknown as { turnstile?: { __standIn?: StandInState } }).turnstile?.__standIn;
          if (!state) return;
          state.mode = next;
          if (times.delayMs !== undefined) state.delayMs = times.delayMs;
          if (times.expireMs !== undefined) state.expireMs = times.expireMs;
          if (times.retryMs !== undefined) state.retryMs = times.retryMs;
          if (times.timeoutMs !== undefined) state.timeoutMs = times.timeoutMs;
        },
        mode,
        timing,
      );
    },
    turnstileCalls: async () => {
      // One trip to the page and back: what it asked before this call has arrived by then. (A page on its way elsewhere has nothing more to say.)
      await page.evaluate(() => undefined).catch(() => {});
      return [...botCheckCalls];
    },
    expectFailure: (pattern) => {
      expected.push({ pattern, seen: false });
    },
    problems: () => {
      const lines: string[] = [];
      for (const failure of failures) {
        const meant = expected.filter((each) => each.pattern.test(failure.text));
        for (const each of meant) each.seen = true;
        if (meant.length > 0) continue;
        // Where it happened, when the browser said: the file that logged it, or the address that failed to load.
        const where = failure.url && /^https?:/.test(failure.url) && !failure.text.includes(failure.url) ? ` (${failure.url})` : '';
        lines.push(`${failure.kind}: ${failure.text}${where}`);
      }
      for (const each of expected) {
        if (!each.seen) lines.push(`expected and never seen: ${String(each.pattern)}`);
      }
      return lines;
    },
    close: async () => {
      await page.close().catch(() => {});
      if (ownContext) await context.close().catch(() => {});
    },
  };
  return opened;
}
