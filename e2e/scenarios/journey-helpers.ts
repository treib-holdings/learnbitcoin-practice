// What the journeys stand on (journey-*.test.ts), beside scenario() itself.
//
// Each screen has scenarios of its own, written while the screens around it
// were not built yet. A journey crosses screens: one reader, one wallet,
// from Home to wherever the journey ends. So a journey asks different
// questions than a screen's scenario does, and this file holds the tools
// for them:
//
//   - How often was the passkey asked? Counted in two places: every
//     create() and get() the page calls (watchPrompts), and every get()
//     the device itself answered (usesOf). A journey says what each must be.
//   - What did the page count, in which order and under which screen?
//     Every request the page sends to /p/event is kept as it was sent
//     (watchEventRequests), beside what the Worker passed on.
//   - Does anything that was counted or logged say which wallet it was?
//     nothingPrivate() holds events, the Worker's log lines and the
//     requests themselves against everything the journey knows about the
//     wallet: its addresses, transaction IDs, wallet fingerprint, public
//     key, passkey, and its 12 words.
//   - What could the bot check's script have read? watchBotCheck() looks
//     at the page from inside that script's own world, at the moment its
//     element goes into the page, at its first line, and when it is asked
//     to draw its widget.
//
// A page is a full page load away from forgetting what a scenario put into
// it. So the watchers here are set up for every document the page will
// load, and they have to be in place before the app's own first line runs.
// That is what standBy() is for: it opens a page of the app's origin that
// is not the app.

import assert from 'node:assert/strict';
import { EVENTS, eventPaths, isEventBody, type EventBody } from '@learnbitcoin/practice-contract';
import { accountFromMnemonic, isValidMnemonic } from '@learnbitcoin/practice-wallet';
import { ANSWER_SETTLE_MS } from '../../app/src/components/taps.ts';
import { RECORD_KEY, makeRecord, type WalletRecord } from '../../app/src/lib/keystore.ts';
import type { OpenOptions, OpenedPage, Scenario } from './helpers.ts';

// -- small things ---------------------------------------------------------------------------

/** The CSS selector of a test hook. */
export const hook = (id: string): string => `[data-testid="${id}"]`;

const tidy = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

export const sleep = (ms: number): Promise<void> => new Promise((wake) => setTimeout(wake, ms));

/** Waits until `check` holds. */
export async function until(check: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`not within ${ms} ms: ${what}`);
    await sleep(25);
  }
}

/** Waits until the app has moved to this address, with or without a page load. */
export async function arrivesAt(page: OpenedPage, path: string): Promise<void> {
  await page.page.waitForFunction((wanted) => location.pathname === wanted, {}, path);
}

/** The text of the screen's heading. */
export const headingOf = (page: OpenedPage): Promise<string> =>
  page.page.$eval('main h1', (heading) => (heading.textContent ?? '').replace(/\s+/g, ' ').trim());

/** Waits until the screen's heading reads this: a step that swaps in place changes it. */
export async function headingBecomes(page: OpenedPage, wanted: string): Promise<void> {
  await page.page.waitForFunction((text) => document.querySelector('main h1')?.textContent?.trim() === text, {}, wanted);
}

/** How many elements carry this test hook right now. */
export const countOf = (page: OpenedPage, id: string): Promise<number> => page.page.$$eval(hook(id), (nodes) => nodes.length);

/** The text of one element, found by a CSS selector, once it is there. */
export async function textOf(page: OpenedPage, selector: string): Promise<string> {
  const node = await page.page.waitForSelector(selector);
  return tidy(await node!.evaluate((found) => found.textContent));
}

/**
 * The sentence of a boxed message: its own paragraphs (the cause, then the
 * way out), without what stands under them (a button, a list of facts).
 */
export const noticeOf = (page: OpenedPage, id: string): Promise<string> =>
  page.page.$eval(hook(id), (box) =>
    [...box.querySelectorAll(':scope > p')].map((each) => (each.textContent ?? '').replace(/\s+/g, ' ').trim()).join(' '),
  );

/** An attribute of the first element with this test hook. */
export const attributeOf = (page: OpenedPage, id: string, name: string): Promise<string | null> =>
  page.page.$eval(hook(id), (element, attribute) => element.getAttribute(attribute), name);

/** What a field holds. */
export const heldBy = (page: OpenedPage, id: string): Promise<string> =>
  page.page.$eval(hook(id), (input) => (input as HTMLInputElement).value);

/** What has keyboard focus: its test hook, or else its tag name. */
export const focusOf = (page: OpenedPage): Promise<string> =>
  page.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? 'nothing');

/**
 * How many documents the page has loaded: one more for every full page
 * load, and none for a move inside the app. (The page the harness loads
 * first, to put a wallet in storage, and the one standBy() opens count too:
 * compare two readings, never one with a number.)
 */
export const documentsOf = (page: OpenedPage): number => page.responses.filter((response) => response.type === 'document').length;

/** The wallet's record as it is stored right now, or null. */
export async function storedRecord(page: OpenedPage): Promise<WalletRecord | null> {
  const text = await page.stored();
  return text === null ? null : (JSON.parse(text) as WalletRecord);
}

/** The keys this origin's localStorage holds, sorted. */
export const storageKeys = (page: OpenedPage): Promise<string[]> => page.page.evaluate(() => Object.keys(localStorage).sort());

/** "142500" -> "142,500", as the app writes amounts in both languages. */
export const sats = (amount: number | bigint): string => amount.toLocaleString('en-US');

/** "30,000 practice sats" as a number of sats. */
export const satsIn = (text: string): number => Number(text.replace(/ .*$/, '').replaceAll(',', ''));

/** Waits until the Remove question takes an answer: it takes none in its first moment (components/taps.ts). */
export const untilAnswersCount = (): Promise<void> => sleep(ANSWER_SETTLE_MS + 150);

// -- before the app starts ---------------------------------------------------------------------

/**
 * Opens a page that stands on the app's origin and is not the app: its
 * robots.txt. A journey sets its watchers up there, and then loads the app
 * with page.goto(). Done the other way round, whatever the app did in its
 * first moment would be over before anything watched: the first screen view
 * is counted as soon as the settings arrive, and that can be before the
 * page's load event.
 */
export function standBy(s: Scenario, options: Omit<OpenOptions, 'path'> = {}): Promise<OpenedPage> {
  return s.open('/robots.txt', options);
}

// -- the passkey ----------------------------------------------------------------------------------

export interface Prompts {
  /** How many times the page has called create() and get() since the watch began, page loads included. */
  asked(): Promise<{ create: number; get: number }>;
  /** The name the page last handed to the device for a passkey to make, or null. */
  named(): Promise<string | null>;
}

/**
 * Counts every passkey prompt the page opens from now on, in this document
 * and in every one it loads later: each call of navigator.credentials
 * .create() and .get(). The count is kept here, outside the page, so a page
 * load does not set it back.
 *
 * It counts what the page asked for. What the device answered is usesOf().
 */
export async function watchPrompts(page: OpenedPage): Promise<Prompts> {
  const asked = { create: 0, get: 0 };
  let named: string | null = null;
  await page.page.exposeFunction('__journeyPrompt', (kind: 'create' | 'get', name: string | null) => {
    asked[kind] += 1;
    if (kind === 'create') named = name;
  });
  const wrap = (): void => {
    const w = window as unknown as { __journeyPrompts?: boolean; __journeyPrompt(kind: string, name: string | null): void };
    const container = navigator.credentials as CredentialsContainer | undefined;
    if (!container || w.__journeyPrompts) return;
    w.__journeyPrompts = true;
    const create = container.create.bind(container);
    const get = container.get.bind(container);
    container.create = (options?: CredentialCreationOptions) => {
      w.__journeyPrompt('create', options?.publicKey?.user.name ?? null);
      return create(options);
    };
    container.get = (options?: CredentialRequestOptions) => {
      w.__journeyPrompt('get', null);
      return get(options);
    };
  };
  await page.page.evaluateOnNewDocument(wrap);
  await page.page.evaluate(wrap);
  // One trip to the page and back: whatever it reported before the question has arrived by then.
  const arrived = (): Promise<void> => page.page.evaluate(() => undefined);
  return {
    asked: async () => {
      await arrived();
      return { ...asked };
    },
    named: async () => {
      await arrived();
      return named;
    },
  };
}

/** How many get() calls the page's passkeys have answered, all of them together. A create() is not one. */
export async function usesOf(page: OpenedPage): Promise<number> {
  return (await page.passkey!.credentials()).reduce((sum, each) => sum + each.uses, 0);
}

/**
 * The next get() of the page is refused, once: the reader dismisses the
 * prompt that asks a new passkey for its secret. The page did ask, so the
 * count of prompts (watchPrompts), where one is kept, is told of it.
 */
export async function refuseNextGet(page: OpenedPage): Promise<void> {
  await page.page.evaluate(() => {
    const container = navigator.credentials;
    const real = container.get.bind(container);
    let refused = false;
    container.get = (options?: CredentialRequestOptions) => {
      if (refused) return real(options);
      refused = true;
      (window as unknown as { __journeyPrompt?(kind: string, name: string | null): void }).__journeyPrompt?.('get', null);
      return Promise.reject(new DOMException('The operation was dismissed.', 'NotAllowedError'));
    };
  });
}

/**
 * Puts a passkey into the page's password manager from the scenario itself,
 * not through the app: one that the device keeps, that verifies the reader
 * and that gives the secret a wallet is made from. To "Open with my
 * passkey" it is a practice passkey like any other, and its wallet has
 * never been used. Gives its ID as the app stores it.
 */
export async function makePasskey(page: OpenedPage): Promise<string> {
  // Chrome makes a passkey only for the page that is in front.
  await page.page.bringToFront();
  const made = await page.page.evaluate(async () => {
    try {
      const credential = await navigator.credentials.create({
        publicKey: {
          rp: { id: location.hostname, name: 'Practice wallet journey' },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'a practice passkey', displayName: 'a practice passkey' },
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
          attestation: 'none',
          extensions: { prf: {} },
        } as PublicKeyCredentialCreationOptions,
      });
      return { id: credential?.id ?? '', error: '' };
    } catch (error) {
      return { id: '', error: String(error) };
    }
  });
  assert.equal(made.error, '', 'the scenario made a passkey');
  assert.notEqual(made.id, '');
  return made.id;
}

// -- the 12 words -----------------------------------------------------------------------------------

/**
 * The 12 words on screen, in order. They are read as they stand, with no
 * pattern run over them in the page: a pattern that matches keeps the text
 * it ran on where every script of the page can read it, and a journey that
 * asks what is lying there must not have put it there itself.
 */
export async function wordsOnScreen(page: OpenedPage): Promise<string[]> {
  await page.waitFor('word');
  return page.page.$$eval(hook('word'), (items) => items.map((item) => item.textContent ?? ''));
}

/** Types one word into each of the twelve fields. */
export async function typeWords(page: OpenedPage, words: readonly string[]): Promise<void> {
  await page.waitFor('word-input');
  const fields = await page.page.$$(hook('word-input'));
  assert.equal(fields.length, 12);
  for (const [index, word] of words.entries()) await fields[index]!.type(word);
}

/** Every two neighbours among the 12 words, as text: "abandon ability". */
export const pairsOf = (words: readonly string[]): string[] => words.slice(0, -1).map((word, index) => `${word} ${words[index + 1]}`);

/** The words of a text, in lower case: runs of letters, with everything else as their borders. */
const tokensOf = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^a-z]+/).filter((token) => token !== ''));

// -- making a wallet through the real Create screen -----------------------------------------------------

/** A wallet a journey has just made: what the browser stored, and the 12 words the "Wallet made" step showed. */
export interface Made {
  record: WalletRecord;
  words: string[];
}

/**
 * From Create (/new, or /es/new): presses the button with this hook, and
 * follows the app to the "Wallet made" step. Gives the stored record and
 * the 12 words that step shows. The words are held against the record: they
 * are this wallet's, or the journey stops here.
 */
export async function createFrom(page: OpenedPage, button: 'create-passkey' | 'create-words' | 'finish-setup', prefix = ''): Promise<Made> {
  // Chrome makes a passkey only for the page that is in front.
  await page.page.bringToFront();
  await page.click(button);
  await arrivesAt(page, `${prefix}/wallet/backup`);
  const words = await wordsOnScreen(page);
  const record = await storedRecord(page);
  assert.ok(record !== null, 'a record is stored');
  assert.equal(words.length, 12);
  assert.ok(isValidMnemonic(words.join(' ')), 'the words shown are a valid phrase');
  const account = accountFromMnemonic(words.join(' '));
  assert.deepEqual([record.xpub, record.fingerprint], [account.xpub, account.masterFingerprint], 'the words shown are the words of the wallet that was stored');
  return { record, words };
}

/**
 * The record a passkey wallet must have in storage, worked out from its 12
 * words alone. Nothing of the words is in it: the wallet fingerprint, the
 * public key and the first address are all public, and the rest names the
 * passkey.
 */
export function passkeyRecordOf(made: Made): WalletRecord {
  const { record, words } = made;
  return makeRecord('passkey', words.join(' '), record.createdAt, { credentialId: record.credentialId ?? '', tag: record.tag ?? null });
}

// -- moving between the wallet's screens ------------------------------------------------------------------

/** The wallet's sections, in the order of their links, with the paths they lead to. */
export const SECTIONS = ['/wallet', '/wallet/coins', '/wallet/receive', '/wallet/send', '/wallet/activity', '/wallet/backup', '/wallet/settings'] as const;

/**
 * A click on one of the wallet's section links, and the wait for its
 * screen. Inside the app this loads no page. Once the bot check's script
 * has been in the page it does, and the wait is for the new page.
 */
export async function toSection(page: OpenedPage, path: string, options: { load?: boolean } = {}): Promise<void> {
  const link = page.page.locator(`main nav a[href="${path}"]`);
  if (options.load) await loads(page, () => link.click());
  else await link.click();
  await arrivesAt(page, path);
  await page.page.waitForSelector(`main nav a[href="${path}"][aria-current="page"]`);
}

/**
 * Does something that makes the page load anew (a link followed once the
 * bot check's script has been in the page), and waits for the new page.
 */
export async function loads(page: OpenedPage, action: () => Promise<unknown>): Promise<void> {
  await Promise.all([page.page.waitForNavigation({ waitUntil: 'load' }), action()]);
}

/**
 * Presses the browser's Back button once the bot check's script has been in
 * the page, and waits for the page load the app answers it with. (The
 * browser first steps back inside the page, and the app then loads the
 * address it finds itself at: the harness's own wait for a navigation ends
 * with the first of the two, so the load is waited for by the count of
 * documents.)
 */
export async function backWithLoad(page: OpenedPage): Promise<void> {
  const before = documentsOf(page);
  await page.page.goBack().catch(() => {});
  await until(() => documentsOf(page) > before, 'a page load after Back');
  await page.page.waitForFunction(() => document.readyState === 'complete');
}

/**
 * Presses one of the header's links (Home by the logo, About, the Sparrow
 * guide: on a screen at least 768 px wide). The page is taken to its top
 * first, as a reader would: further down, the sticky PRACTICE banner lies
 * over the header, and a click there would land on the banner.
 */
export async function headerLink(page: OpenedPage, path: string): Promise<void> {
  await page.page.evaluate(() => window.scrollTo(0, 0));
  await page.page.click(`header a[href="${path}"]`);
}

/** Presses the language switch, which stands in the header: from the top of the page, for the same reason. */
export async function switchLanguage(page: OpenedPage): Promise<void> {
  await page.page.evaluate(() => window.scrollTo(0, 0));
  await page.click('lang-switch');
}

/** Goes Home by the logo in the header. */
export async function goHome(page: OpenedPage, prefix = ''): Promise<void> {
  const path = prefix === '' ? '/' : prefix;
  await headerLink(page, path);
  await arrivesAt(page, path);
}

// -- a payment's figures ---------------------------------------------------------------------------------

/** The value of a row of facts (its name left out): "30,000 practice sats". `scope` is the step the row is in. */
export const rowOf = (page: OpenedPage, scope: string, name: string): Promise<string> => textOf(page, `${scope} ${hook(name)} dd`);

export interface Figures {
  to: string;
  amount: string;
  fee: string;
  size: string;
  rate: string;
  total: string;
  change: string;
}

/** The seven figures of a payment, as the plan shows them (rows "plan-...") and as the review of the signed payment does (rows "review-..."). */
export async function figuresOf(page: OpenedPage, step: 'send-plan' | 'send-review'): Promise<Figures> {
  const scope = hook(step);
  const own = step === 'send-plan' ? 'plan' : 'review';
  return {
    to: await textOf(page, `${scope} ${hook(`${own}-to`)} dd [translate="no"]`),
    amount: await rowOf(page, scope, `${own}-amount`),
    fee: await rowOf(page, scope, 'tx-fee'),
    size: await rowOf(page, scope, 'tx-size'),
    rate: await rowOf(page, scope, 'tx-fee-rate'),
    total: await rowOf(page, scope, `${own}-total`),
    change: await rowOf(page, scope, `${own}-change`),
  };
}

export interface NetworkTx {
  txid: string;
  fee: number;
  weight: number;
  /** Each coin it spends: the transaction that made the coin, which of its outputs it was, and what that output held. */
  vin: { txid: string; vout: number; prevout: { value: number; scriptpubkey_address: string } }[];
  vout: { value: number; scriptpubkey_address: string }[];
  status: { confirmed: boolean; block_height?: number };
}

/** A transaction as the practice network itself reports it: asked directly, not through the Worker. */
export async function onNetwork(s: Scenario, txid: string): Promise<NetworkTx> {
  const answer = await fetch(`${s.stack.originUrl}/esplora/tx/${txid}`);
  assert.equal(answer.status, 200, `the network does not know ${txid}`);
  return (await answer.json()) as NetworkTx;
}

/** The transaction ID the sent view links to. */
export async function sentTxid(page: OpenedPage, prefix = ''): Promise<string> {
  await page.waitFor('sent-link');
  const href = (await attributeOf(page, 'sent-link', 'href')) ?? '';
  assert.match(href, new RegExp(`^${prefix}/wallet/tx/[0-9a-f]{64}$`));
  return href.slice(-64);
}

/** The payments the network was handed: every POST of a transaction that reached the stand-in. */
export const broadcastsOf = (s: Scenario): number =>
  s.standIn.requests().filter((request) => request.method === 'POST' && request.path === '/esplora/tx').length;

// -- what was counted ---------------------------------------------------------------------------------------

/** One request the page sent to /p/event, as it left the browser. */
export interface EventRequest {
  method: string;
  /** The address asked, whole. */
  url: string;
  /** The request's body: the event, as JSON text. */
  body: string;
  /** The headers the page's own request carried, with lower-case names. */
  headers: Record<string, string>;
}

/**
 * Keeps every request the page sends to /p/event from now on, in the order
 * the browser sent them, across page loads. That order is the order in
 * which the app counted: the Worker may be handed two requests that left
 * within the same moment the other way round.
 */
export function watchEventRequests(page: OpenedPage): () => EventRequest[] {
  const seen: EventRequest[] = [];
  page.page.on('request', (request) => {
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    if (!url.pathname.startsWith('/p/')) return;
    seen.push({ method: request.method(), url: request.url(), body: request.postData() ?? '', headers: request.headers() });
  });
  return () => [...seen];
}

/** Everything the Worker passed on as counted, once the pages and the Worker have gone quiet. */
export async function countedBy(s: Scenario, ...pages: OpenedPage[]): Promise<EventBody[]> {
  for (const page of pages) await page.settle();
  await s.stack.settled();
  return s.stack.events.map((recorded) => recorded.event);
}

/** Waits until the Worker has passed on this many events of this name. */
export async function untilCounted(s: Scenario, name: EventBody['name'], times = 1): Promise<void> {
  await until(
    () => s.stack.events.filter((recorded) => recorded.event.name === name).length >= times,
    `${times} "${name}" counted; counted so far: ${JSON.stringify(s.stack.events.map((each) => each.event))}`,
  );
  await s.stack.settled();
}

/** An event as one line, for comparing lists whatever their order: "Passkey /new ok". */
const lineOf = (event: EventBody): string => [event.name, event.path, event.value].filter((part) => part !== undefined).join(' ');

/**
 * What a journey counted, held against what it should have: exactly these
 * events, each a name from the contract's list with one of its listed
 * values, under these screens, in this order.
 *
 * The order is read where it is certain: from the requests as the browser
 * sent them. What the Worker passed on must be the same events, each as
 * often; two that left the page in the same moment can reach the Worker
 * the other way round.
 */
export function assertCounted(expected: EventBody[], requests: EventRequest[], passedOn: EventBody[]): void {
  const sent = requests.map((request) => JSON.parse(request.body) as EventBody);
  assert.deepEqual(sent, expected, 'what the page sent to be counted, in the order it sent it');
  assert.deepEqual(passedOn.map(lineOf).sort(), expected.map(lineOf).sort(), 'what the Worker passed on');
  for (const event of expected) {
    // The expectation itself is held to the contract: a scenario that expected a value no list holds would prove nothing.
    assert.ok(isEventBody(event), `not an event the contract lists: ${JSON.stringify(event)}`);
  }
}

/**
 * Waits until everything a journey should have counted has left the page
 * and reached the Worker, and then holds it against the expectation
 * (assertCounted). The last thing a journey does is often a move to another
 * screen, and that screen's view is counted a moment after the move: asked
 * at once, the list would be one short. If it stays short, the comparison
 * says what is missing.
 */
export async function countedExactly(s: Scenario, page: OpenedPage, requests: () => EventRequest[], expected: EventBody[]): Promise<void> {
  const deadline = Date.now() + 20_000;
  while ((requests().length < expected.length || s.stack.events.length < expected.length) && Date.now() < deadline) await sleep(25);
  // And a moment more, so that an event too many would show as well.
  assertCounted(expected, requests(), await countedBy(s, page));
}

/**
 * What one page sent to be counted, in the order it sent it, once it has
 * sent at least `atLeast` events and gone quiet. For a journey with several
 * pages that follows the counts of one of them.
 */
export async function sentBy(page: OpenedPage, requests: () => EventRequest[], atLeast: number): Promise<EventBody[]> {
  const deadline = Date.now() + 20_000;
  while (requests().length < atLeast && Date.now() < deadline) await sleep(25);
  await page.settle();
  return requests().map((request) => JSON.parse(request.body) as EventBody);
}

/** The names a line of the Worker's log can carry for its route and its fault (worker/src/deps.ts). */
const LOG_ROUTES = ['config', 'esplora_read', 'esplora_broadcast', 'faucet', 'pot_address', 'event', 'unknown'];
const LOG_FAULTS = ['origin_auth', 'origin_down', 'origin_timeout', 'origin_shape', 'bot_check_config', 'bot_check_down', 'events_down', 'handler'];

/** Everything a journey knows about its wallets that must never be counted, logged or sent with a count. */
export interface Secrets {
  /** The stored records of the wallets the journey used. */
  records: (WalletRecord | null)[];
  /** The 12 words of each of those wallets. */
  words: string[][];
  /** Every address the journey met: the wallet's own, and the ones it paid. */
  addresses: string[];
  /** Every transaction ID the journey met. */
  txids: string[];
}

/** Every word the contract's own lists hold: an event is made of these and of nothing else. */
const EVENT_WORDS = tokensOf(
  [
    ...Object.keys(EVENTS),
    ...Object.values(EVENTS).flatMap((spec) => (spec === null ? [] : [spec.prop, ...spec.values])),
    ...eventPaths(),
    'name',
    'path',
    'value',
  ].join(' '),
);

/**
 * Nothing that was counted, logged or sent says which wallet it was.
 *
 *   events    what the Worker passed on, with what it would tell the events
 *             service about the request (the reader's IP address and
 *             browser name, and nothing else)
 *   lines     the Worker's own log lines
 *   requests  the page's requests to /p/event, as they left the browser
 *
 * Each of them is held to its closed shape first: an event is a name, a
 * screen's fixed path and at most one value from the contract's lists; a
 * log line is five fields, with a route and a fault from two short lists
 * and three numbers. Whatever keeps to that shape has no room for an
 * address. Then, all the same, the text of each is searched: for anything
 * that looks like an address, a public key or a transaction ID, for every
 * secret the journey knows by value, and for the 12 words.
 *
 * About the words. One word proves little by itself: "view", "page", "new",
 * "wallet" and "restore" are on the BIP 39 list, and are in the names and
 * paths of events. So two rules. Two of a wallet's words in a row, as they
 * stand in its phrase, are never found. And a single one is found only
 * where the contract's own lists hold that very word.
 */
export function nothingPrivate(
  found: { events: Scenario['stack']['events']; lines: Scenario['stack']['lines']; requests: EventRequest[] },
  secrets: Secrets,
): void {
  const values = [
    ...secrets.records.flatMap((record) => (record === null ? [] : [record.fingerprint, record.xpub, record.firstAddress, record.credentialId, record.tag])),
    ...secrets.addresses,
    ...secrets.txids,
  ].filter((value): value is string => typeof value === 'string' && value !== '');
  assert.ok(values.length > 0 && secrets.words.length > 0, 'the journey knows what to look for');

  /** Searches one text. `allowed` holds the words the text may share with a wallet's phrase. */
  const clean = (text: string, what: string, allowed: ReadonlySet<string>): void => {
    assert.doesNotMatch(text, /bcrt1|tb1q|tpub|tprv|[0-9a-f]{64}/i, `${what} holds what looks like an address, a key or a transaction ID`);
    for (const value of values) assert.ok(!text.includes(value), `${what} holds ${value}`);
    const tokens = tokensOf(text);
    for (const words of secrets.words) {
      for (const pair of pairsOf(words)) assert.ok(!text.toLowerCase().includes(pair), `${what} holds two of the 12 words in a row`);
      for (const word of words) {
        assert.ok(!tokens.has(word) || allowed.has(word), `${what} holds "${word}", one of the 12 words, and no list of the contract does`);
      }
    }
  };

  assert.ok(found.events.length > 0 && found.requests.length > 0, 'something was counted');
  for (const { event, meta } of found.events) {
    assert.ok(isEventBody(event), JSON.stringify(event));
    assert.deepEqual(Object.keys(meta).sort(), ['ip', 'userAgent']);
    clean(JSON.stringify(event), `the event ${JSON.stringify(event)}`, EVENT_WORDS);
    // What the Worker would tell the events service about the request: where it came from, and the browser's name.
    clean(JSON.stringify({ ip: meta.ip }), 'what the Worker says of the request that brought an event', new Set(['ip']));
    assert.match(meta.userAgent ?? '', /Chrome\//);
    for (const value of values) assert.ok(!(meta.userAgent ?? '').includes(value), `the browser's name holds ${value}`);
  }

  const logWords = tokensOf([...LOG_ROUTES, ...LOG_FAULTS, 'route status upstream ms fault null'].join(' '));
  for (const line of found.lines) {
    assert.deepEqual(Object.keys(line).sort(), ['fault', 'ms', 'route', 'status', 'upstream'], JSON.stringify(line));
    assert.ok(LOG_ROUTES.includes(line.route), JSON.stringify(line));
    assert.ok(line.fault === null || LOG_FAULTS.includes(line.fault), JSON.stringify(line));
    assert.ok(Number.isInteger(line.status) && (line.upstream === null || Number.isInteger(line.upstream)) && typeof line.ms === 'number', JSON.stringify(line));
    clean(JSON.stringify(line), `the log line ${JSON.stringify(line)}`, logWords);
  }

  for (const request of found.requests) {
    const url = new URL(request.url);
    // One path, with nothing after it: a query could carry anything.
    assert.deepEqual([request.method, url.pathname, url.search, url.hash], ['POST', '/p/event', '', ''], request.url);
    const body: unknown = JSON.parse(request.body);
    assert.ok(isEventBody(body), request.body);
    assert.equal(request.body, JSON.stringify(body), 'the body is the event and nothing around it');
    clean(request.body, `the request body ${request.body}`, EVENT_WORDS);
    // The page's own headers. The address of the screen the reader is on (which, on a transaction's
    // screen, ends in its ID) must not travel with a count: the page's policy sends no referrer.
    // (The browser reports a header it leaves out as missing, or as empty.)
    assert.equal(request.headers['referer'] ?? '', '', 'a count carries no referrer');
    assert.equal(request.headers['cookie'] ?? '', '', 'a count carries no cookie');
    for (const [name, value] of Object.entries(request.headers)) {
      for (const secret of values) assert.ok(!value.includes(secret), `the header ${name} of a count holds ${secret}`);
      for (const words of secrets.words) {
        for (const pair of pairsOf(words)) assert.ok(!value.toLowerCase().includes(pair), `the header ${name} of a count holds two of the 12 words`);
      }
    }
  }
}

// -- what a script in the page could read ----------------------------------------------------------------------

/** What regular expressions remember of the last text one of them matched in. */
export interface PatternMemory {
  input: string;
  lastMatch: string;
  lastParen: string;
  leftContext: string;
  rightContext: string;
  /** $1 to $9, joined: the parts the last pattern picked out. */
  groups: string;
}

/**
 * What the page's regular expressions remember right now. A pattern that
 * has matched keeps the text it ran on (RegExp.input) and parts of it (the
 * match, what stood before and after it, what its brackets picked out)
 * until the next match, and every script in the page can read them.
 *
 * It is a look at one moment: the page matches other texts all the time,
 * and the harness's own watcher of the status region does too. So it shows
 * that nothing has left the words lying there when the scenario looks, and
 * not that no pattern ever met them. That rule is held by tests of the
 * source (app/test/keys-text.test.ts, wallet/test/words-memory.test.ts).
 */
export const patternMemory = (page: OpenedPage): Promise<PatternMemory> =>
  page.page.evaluate(() => {
    const memory = RegExp as unknown as Record<string, unknown>;
    return {
      input: String(memory['input']),
      lastMatch: String(memory['lastMatch']),
      lastParen: String(memory['lastParen']),
      leftContext: String(memory['leftContext']),
      rightContext: String(memory['rightContext']),
      groups: ['$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9'].map((name) => String(memory[name])).join(' '),
    };
  });

/** What the patterns remember when no pattern has matched anything but an empty text: nothing. */
export const NOTHING_REMEMBERED: PatternMemory = { input: '', lastMatch: '', lastParen: '', leftContext: '', rightContext: '', groups: '        ' };

/**
 * Presses the control with this test hook from inside the page, and reads
 * what the page's patterns remember in the same breath: when the control's
 * own work is done, and before the page has redrawn or any watcher has run.
 *
 * A look taken later, by a trip to the page of its own, comes after
 * whatever else matched in between (the harness's watcher of the status
 * region runs a pattern each time the region speaks). This one cannot be
 * overtaken: the press, the work it sets off and the reading are one
 * uninterrupted run of the page's script. So it is the place to ask what
 * the wallet left behind when it took words in or dropped its keys.
 */
export const pressAndRemember = (page: OpenedPage, id: string): Promise<PatternMemory> =>
  page.page.$eval(hook(id), (control) => {
    (control as HTMLElement).click();
    const memory = RegExp as unknown as Record<string, unknown>;
    return {
      input: String(memory['input']),
      lastMatch: String(memory['lastMatch']),
      lastParen: String(memory['lastParen']),
      leftContext: String(memory['leftContext']),
      rightContext: String(memory['rightContext']),
      groups: ['$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9'].map((name) => String(memory[name])).join(' '),
    };
  });

/**
 * None of the 12 words lies in what the page's patterns remember.
 *
 * Two of the words in a row are never there. One word alone is not there
 * either, unless the text it stands in is text the page itself shows
 * (`shown`: the page's own text and markup at that moment). The last text
 * a pattern ran on is often a sentence of the page, "Wallet locked." say,
 * and "wallet" is on the word list: one wallet in a few hundred has it
 * among its 12 words. A sentence that anyone can read on the screen gives
 * nothing away.
 */
export function assertNoWordsRemembered(memory: PatternMemory, words: readonly string[], shown: string, when: string): void {
  for (const [name, text] of Object.entries(memory)) {
    if (text === '') continue;
    const lower = text.toLowerCase();
    for (const pair of pairsOf(words)) assert.ok(!lower.includes(pair), `${when}: RegExp.${name} holds two of the 12 words in a row`);
    const tokens = tokensOf(text);
    const hits = words.filter((word) => tokens.has(word));
    assert.ok(hits.length === 0 || shown.includes(text), `${when}: RegExp.${name} holds ${JSON.stringify(text)}, with "${hits.join('", "')}" of the 12 words in it, and the page shows no such text`);
  }
}

/** One look at the page from where the bot check's script stands. */
export interface ScriptMoment {
  /**
   * added  the script's element is being put into the page (it has not been fetched yet)
   * ran    the script's own first line: it defines its object
   * drew   the app asks it to draw the widget
   */
  when: 'added' | 'ran' | 'drew';
  memory: PatternMemory;
  /** Everything in the origin's localStorage and sessionStorage. */
  local: Record<string, string>;
  session: Record<string, string>;
  /** The wallet's lock line as the page shows it (null where it shows none), and whether the Lock button is there. */
  lockLine: string | null;
  lockButton: boolean;
  /** The page's own text and markup. */
  shown: string;
}

/**
 * Looks at the page from inside the world the bot check's script runs in,
 * at three moments, in every document the page loads from now on. Call it
 * before the app is loaded (standBy). The returned function gives the looks
 * taken so far in the document that is showing.
 *
 * The script has no world of its own: it runs in the page, beside the app,
 * and can read whatever any script there can. So the looks read exactly
 * that, from code that runs where the script runs: when the app puts the
 * script's element into the page, inside the script as it starts (it
 * defines window.turnstile, and the look is taken as it does), and inside
 * its render() as the app calls it.
 */
export async function watchBotCheck(page: OpenedPage): Promise<() => Promise<ScriptMoment[]>> {
  await page.page.evaluateOnNewDocument(() => {
    const moments: unknown[] = [];
    (window as unknown as { __journeyMoments: unknown[] }).__journeyMoments = moments;
    const look = (when: string): void => {
      // The patterns' memory first: nothing below may run a pattern before it is read.
      const memory = RegExp as unknown as Record<string, unknown>;
      const remembered = {
        input: String(memory['input']),
        lastMatch: String(memory['lastMatch']),
        lastParen: String(memory['lastParen']),
        leftContext: String(memory['leftContext']),
        rightContext: String(memory['rightContext']),
        groups: ['$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9'].map((name) => String(memory[name])).join(' '),
      };
      const all = (storage: Storage): Record<string, string> => {
        const held: Record<string, string> = {};
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key !== null) held[key] = storage.getItem(key) ?? '';
        }
        return held;
      };
      moments.push({
        when,
        memory: remembered,
        local: all(localStorage),
        session: all(sessionStorage),
        lockLine: document.querySelector('[data-testid="lock-state"] p')?.textContent ?? null,
        lockButton: document.querySelector('[data-testid="lock"]') !== null,
        shown: `${document.documentElement.textContent ?? ''}\n${document.documentElement.outerHTML}`,
      });
    };

    // 1. The script's element goes into the page. Every way a node can be put there is watched,
    //    and so is an address given to a script element that is in the page already.
    const isBotCheck = (node: unknown): boolean => node instanceof HTMLScriptElement && node.src.startsWith('https://challenges.cloudflare.com/');
    const watch = (owner: object, name: string): void => {
      const real = (owner as Record<string, (...args: unknown[]) => unknown>)[name];
      if (typeof real !== 'function') return;
      (owner as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]): unknown {
        if (args.some(isBotCheck)) look('added');
        return real.apply(this, args);
      };
    };
    for (const name of ['appendChild', 'insertBefore', 'replaceChild']) watch(Node.prototype, name);
    for (const name of ['append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren', 'insertAdjacentElement']) watch(Element.prototype, name);
    const src = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
    if (src?.set && src.get) {
      const set = src.set;
      Object.defineProperty(HTMLScriptElement.prototype, 'src', {
        ...src,
        set(this: HTMLScriptElement, value: string) {
          if (this.isConnected && String(value).startsWith('https://challenges.cloudflare.com/')) look('added');
          set.call(this, value);
        },
      });
    }

    // 2 and 3. The script defines window.turnstile as it starts: the look is taken inside that
    //    line of the script. Its render() is wrapped, so that a look is taken inside the call
    //    in which the app hands it the address.
    let api: unknown;
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      get: () => api,
      set: (value: unknown) => {
        look('ran');
        const script = value as { render?: (...args: unknown[]) => unknown } | null;
        if (script !== null && typeof script === 'object' && typeof script.render === 'function') {
          const render = script.render.bind(script);
          script.render = (...args: unknown[]) => {
            look('drew');
            return render(...args);
          };
        }
        api = value;
      },
    });
  });
  return () => page.page.evaluate(() => (window as unknown as { __journeyMoments?: ScriptMoment[] }).__journeyMoments ?? []);
}

/** How many of the bot check's script elements the page holds. */
export const botCheckScripts = (page: OpenedPage): Promise<number> =>
  page.page.$$eval('script[src^="https://challenges.cloudflare.com/"]', (found) => found.length);

/**
 * From now on, in the document that is showing, keeps each phase the
 * faucet's state line goes through, in order. The returned function reads
 * them: "checking", "asking", "on-its-way", "arrived", "confirmed".
 */
export async function watchPhases(page: OpenedPage): Promise<() => Promise<string[]>> {
  await page.page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __journeyPhases: string[] }).__journeyPhases = seen;
    const read = (): void => {
      const phase = document.querySelector('[data-testid="faucet-state"]')?.getAttribute('data-phase');
      if (phase && seen.at(-1) !== phase) seen.push(phase);
    };
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] });
    read();
  });
  return () => page.page.evaluate(() => [...(window as unknown as { __journeyPhases: string[] }).__journeyPhases]);
}

/** Waits until the faucet's state line is in this phase. */
export async function untilPhase(page: OpenedPage, phase: string, timeout = 45_000): Promise<void> {
  await page.page.waitForSelector(`${hook('faucet-state')}[data-phase="${phase}"]`, { timeout });
}

export { RECORD_KEY };
