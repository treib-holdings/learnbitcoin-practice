// The front door of the practice wallet in a real browser: Home (/), Create
// (/new) and Restore (/restore), against the real engine and the stand-in
// practice network.
//
// What is proved here: a wallet made without a passkey and with each kind
// of passkey Chrome's virtual authenticator can be (the secret at create(),
// only at the follow-up get(), never), with the count of prompts and what
// is stored; a cancelled prompt; a follow-up prompt that is dismissed and
// finished later; restore of words that have coins (stored only after the
// scan) and of unused words (nothing stored until "Keep them here anyway",
// nothing after "Erase"); a bad word pointed out and described; the word
// fields' attributes; two tabs; open with a passkey after the storage was
// cleared, and on a device that holds none; the Spanish routes; and that no
// counted event holds an address, an ID or a wallet fingerprint.
//
// And what happens around a wait: a passkey prompt or a look for history
// that is still open when the reader leaves the screen, comes back, or a
// second tab or the browser's storage gets in the way; where focus is and
// what is on a small phone's screen after each answer.
//
// The screens behind these three are other engineers': /wallet and
// /wallet/backup are reached and not looked into.

import assert from 'node:assert/strict';
import { isEventBody, type EventBody } from '@learnbitcoin/practice-contract';
import { accountFromMnemonic, isValidMnemonic } from '@learnbitcoin/practice-wallet';
import { SAFARI_KEEPS_DAYS } from '../../app/src/components/wallet/frame.ts';
import { fill, formatSats } from '../../app/src/lib/format.ts';
import { RECORD_KEY, type WalletRecord } from '../../app/src/lib/keystore.ts';
import { strings } from '../../app/src/strings/index.ts';
import {
  TEST_WORDS,
  freshRecord,
  fundTestWallet,
  scenario as harnessScenario,
  testRecord,
  type OpenedPage,
  type Scenario,
  type ScenarioOptions,
} from './helpers.ts';

// -- the end of a run -----------------------------------------------------------------------
//
// One Chrome serves every scenario of this file, and the harness closes it when the last one is done
// (helpers.ts). The process should then end. On a Mac it sometimes cannot. About 20 seconds after it
// starts, Chrome runs Google's updater, whose helper processes inherit Chrome's error output and
// outlive Chrome by about five minutes. Puppeteer reads that output through a pipe, and a pipe that is
// still open at its other end keeps this process alive: the run stands still for those five minutes,
// with every scenario passed. This file runs for longer than 20 seconds, so it meets this often.
//
// The cure belongs where Chrome is started (e2e/src/browser.ts), which is not this file's to change.
// Until it is there, the scenarios of this file let go of Chrome's two output pipes as soon as they have
// a page to reach Chrome through. The output is read as before. It no longer holds the process open.

/** True once Chrome's output pipes have been let go of. One Chrome, so once is enough. */
let outputLetGo = false;

function letGoOfChromeOutput(page: OpenedPage): void {
  if (outputLetGo) return;
  outputLetGo = true;
  const chrome = page.page.browser().process();
  for (const pipe of [chrome?.stdout, chrome?.stderr]) (pipe as { unref?: () => void } | null | undefined)?.unref?.();
}

/** A scenario of this file: the harness's scenario(), with that one thing done when its first page opens. */
function scenario(name: string, run: (s: Scenario) => Promise<void>): void;
function scenario(name: string, options: ScenarioOptions, run: (s: Scenario) => Promise<void>): void;
function scenario(
  name: string,
  optionsOrRun: ScenarioOptions | ((s: Scenario) => Promise<void>),
  maybeRun?: (s: Scenario) => Promise<void>,
): void {
  const options = typeof optionsOrRun === 'function' ? {} : optionsOrRun;
  const run = typeof optionsOrRun === 'function' ? optionsOrRun : maybeRun!;
  harnessScenario(name, options, (s) => {
    // Laid over the harness's own object, not copied from it: `standIn` is read only when a scenario
    // asks for it (reading it ends a live run as "local only").
    const mine = Object.create(s) as Scenario;
    mine.open = async (path, openOptions) => {
      const page = await s.open(path, openOptions);
      letGoOfChromeOutput(page);
      return page;
    };
    return run(mine);
  });
}

const en = {
  common: strings.common.en,
  errors: strings.errors.en,
  wallet: strings.wallet.en,
  home: strings.home.en,
  create: strings.create.en,
  restore: strings.restore.en,
};
const es = {
  common: strings.common.es,
  wallet: strings.wallet.es,
  home: strings.home.es,
  create: strings.create.es,
  restore: strings.restore.es,
};

/** The four characters in a practice passkey's name (passkey.ts). */
const TAG = /^[23456789CDFHJKMNPQRTVWXY]{4}$/;

// -- small helpers ----------------------------------------------------------------------

const pathOf = (page: OpenedPage): Promise<string> => page.page.evaluate(() => location.pathname);

/** Waits until the app has moved to this address, with or without a page load. */
async function arrivesAt(page: OpenedPage, path: string): Promise<void> {
  await page.page.waitForFunction((wanted) => location.pathname === wanted, {}, path);
}

/**
 * Goes Home by the logo in the header. The header is at the top of the
 * page, and the sticky PRACTICE banner lies over it once the page has
 * scrolled, so the page is taken to its top first, as a reader would.
 */
async function goHome(page: OpenedPage): Promise<void> {
  await page.page.evaluate(() => window.scrollTo(0, 0));
  await page.page.click(`a[aria-label="${en.common.homeLabel}"]`);
  await arrivesAt(page, '/');
}

const headingOf = (page: OpenedPage): Promise<string> =>
  page.page.$eval('main h1', (heading) => (heading.textContent ?? '').replace(/\s+/g, ' ').trim());

/** What has keyboard focus: its test hook, or else its tag name. */
const focusOf = (page: OpenedPage): Promise<string> =>
  page.page.evaluate(() => {
    const at = document.activeElement;
    return at instanceof HTMLElement ? (at.dataset['testid'] ?? at.tagName) : 'nothing';
  });

/** How many elements carry this test hook right now. */
const countOf = (page: OpenedPage, testid: string): Promise<number> =>
  page.page.$$eval(`[data-testid="${testid}"]`, (nodes) => nodes.length);

async function storedRecord(page: OpenedPage): Promise<WalletRecord | null> {
  const text = await page.stored();
  return text === null ? null : (JSON.parse(text) as WalletRecord);
}

/**
 * Counts the passkey prompts the page opens from now on, until its next
 * load: every create() and every get(). Returns how to read the count.
 */
async function countPrompts(page: OpenedPage): Promise<() => Promise<{ create: number; get: number }>> {
  await page.page.evaluate(() => {
    const container = navigator.credentials;
    const asked = { create: 0, get: 0 };
    (window as unknown as { __prompts: typeof asked }).__prompts = asked;
    const create = container.create.bind(container);
    const get = container.get.bind(container);
    container.create = (options?: CredentialCreationOptions) => {
      asked.create += 1;
      return create(options);
    };
    container.get = (options?: CredentialRequestOptions) => {
      asked.get += 1;
      return get(options);
    };
  });
  return () => page.page.evaluate(() => ({ ...(window as unknown as { __prompts: { create: number; get: number } }).__prompts }));
}

/** Types one word into each of the twelve fields. */
async function typeWords(page: OpenedPage, words: string): Promise<void> {
  await page.waitFor('word-input');
  const fields = await page.page.$$('[data-testid="word-input"]');
  assert.equal(fields.length, 12);
  for (const [index, word] of words.split(' ').entries()) await fields[index]!.type(word);
}

/** What the twelve fields hold. */
const wordsTyped = (page: OpenedPage): Promise<string[]> =>
  page.page.$$eval('[data-testid="word-input"]', (nodes) => nodes.map((node) => (node as HTMLInputElement).value));

/** Whether <main> is marked busy. */
const mainBusy = (page: OpenedPage): Promise<boolean> => page.page.$eval('main', (main) => main.getAttribute('aria-busy') === 'true');

/** What the button with this hook says, and whether it is waiting or switched off. */
const buttonOf = (page: OpenedPage, testid: string): Promise<{ text: string; busy: boolean; disabled: boolean }> =>
  page.page.$eval(`[data-testid="${testid}"]`, (button) => ({
    text: (button.textContent ?? '').replace(/\s+/g, ' ').trim(),
    busy: button.getAttribute('aria-busy') === 'true',
    disabled: (button as HTMLButtonElement).disabled,
  }));

/** Waits until the button with this hook says that the wallet is working on what it started. */
async function waitsOn(page: OpenedPage, testid: string): Promise<void> {
  await page.page.waitForSelector(`[data-testid="${testid}"][aria-busy="true"]`);
}

/** Waits until keyboard focus is on the element with this hook. */
async function focusArrivesAt(page: OpenedPage, testid: string): Promise<void> {
  await page.page.waitForFunction((hook) => (document.activeElement as HTMLElement | null)?.dataset?.['testid'] === hook, {}, testid);
}

/**
 * Where an element is on the screen: its top and bottom edge, with the
 * bottom edge of the sticky PRACTICE banner and the height of the window.
 */
const placeOf = (page: OpenedPage, testid: string): Promise<{ top: number; bottom: number; banner: number; height: number }> =>
  page.page.$eval(`[data-testid="${testid}"]`, (node) => {
    const box = node.getBoundingClientRect();
    const banner = document.querySelector('[role="note"]')?.getBoundingClientRect().bottom ?? 0;
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), banner: Math.round(banner), height: window.innerHeight };
  });

/**
 * Holds every passkey prompt of one kind that the page opens from now on,
 * as a prompt the reader leaves open, until the returned function is
 * called. That function gives how many prompts it let go on.
 */
async function holdPrompt(page: OpenedPage, which: 'create' | 'get'): Promise<() => Promise<number>> {
  await page.page.evaluate((name) => {
    const container = navigator.credentials as unknown as Record<string, (options?: unknown) => Promise<unknown>>;
    const real = container[name]!.bind(container);
    const held: (() => void)[] = [];
    (window as unknown as { __held: (() => void)[] }).__held = held;
    container[name] = (options?: unknown) =>
      new Promise((resolve, reject) => {
        held.push(() => void real(options).then(resolve, reject));
      });
  }, which);
  return () =>
    page.page.evaluate(() => {
      const all = (window as unknown as { __held: (() => void)[] }).__held.splice(0);
      for (const go of all) go();
      return all.length;
    });
}

/**
 * Holds every read of the chain that the page asks for from now on, as a
 * look for history on a slow line, until the returned function is called.
 * From then on the reads go through as usual.
 */
async function holdChain(page: OpenedPage): Promise<() => Promise<void>> {
  await page.page.evaluate(() => {
    const gate = { open: false, waiting: [] as (() => void)[] };
    (window as unknown as { __gate: typeof gate }).__gate = gate;
    const ask = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href).pathname;
      if (path.startsWith('/api/esplora/') && !gate.open) await new Promise<void>((go) => gate.waiting.push(go));
      return ask(input, init);
    };
  });
  return () =>
    page.page.evaluate(() => {
      const gate = (window as unknown as { __gate: { open: boolean; waiting: (() => void)[] } }).__gate;
      gate.open = true;
      for (const go of gate.waiting.splice(0)) go();
    });
}

/** The next get() of the page is refused, once: the reader dismisses the prompt that asks a new passkey for its secret. */
async function refuseNextGet(page: OpenedPage): Promise<void> {
  await page.page.evaluate(() => {
    const container = navigator.credentials;
    const real = container.get.bind(container);
    let refused = false;
    container.get = (options?: CredentialRequestOptions) => {
      if (refused) return real(options);
      refused = true;
      return Promise.reject(new DOMException('The operation was dismissed.', 'NotAllowedError'));
    };
  });
}

/**
 * From now on this browser refuses every write, as it does once site data
 * is blocked. The returned function allows them again.
 */
async function refuseWrites(page: OpenedPage): Promise<() => Promise<void>> {
  await page.page.evaluate(() => {
    const w = window as unknown as { __setItem?: typeof Storage.prototype.setItem };
    w.__setItem ??= Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  });
  return () =>
    page.page.evaluate(() => {
      const w = window as unknown as { __setItem?: typeof Storage.prototype.setItem };
      if (w.__setItem) Storage.prototype.setItem = w.__setItem;
    });
}

/**
 * Notes, from now on and until the next page load, whether an element with
 * this hook is ever on the page while the address is `path`. The returned
 * function reads the answer.
 */
async function everShown(page: OpenedPage, testid: string, path: string): Promise<() => Promise<boolean>> {
  await page.page.evaluate(
    (hook, where) => {
      const shown = ((window as unknown as { __shown?: Record<string, boolean> }).__shown ??= {});
      shown[hook] = false;
      const look = (): void => {
        if (location.pathname === where && document.querySelector(`[data-testid="${hook}"]`) !== null) shown[hook] = true;
      };
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true });
      look();
    },
    testid,
    path,
  );
  return () => page.page.evaluate((hook) => (window as unknown as { __shown: Record<string, boolean> }).__shown[hook] === true, testid);
}

/**
 * Notes, from now on, each time an element with this hook is put on the
 * page, and with which role, and each time the role of one that is already
 * there changes. A screen reader says an alert when it is put on the page.
 */
async function watchRole(page: OpenedPage, testid: string): Promise<() => Promise<string[]>> {
  await page.page.evaluate((hook) => {
    const log: string[] = [];
    (window as unknown as { __roles: string[] }).__roles = log;
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'childList') {
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            const hit = node.matches(`[data-testid="${hook}"]`) ? node : node.querySelector(`[data-testid="${hook}"]`);
            if (hit) log.push(`put with role ${hit.getAttribute('role') ?? 'none'}`);
          }
        } else if (record.target instanceof HTMLElement && record.target.dataset['testid'] === hook) {
          log.push(`role changed to ${record.target.getAttribute('role') ?? 'none'}`);
        }
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['role'] });
  }, testid);
  return () => page.page.evaluate(() => [...(window as unknown as { __roles: string[] }).__roles]);
}

/** Everything counted so far, once the page and the Worker have gone quiet. */
async function counted(s: Scenario, page: OpenedPage): Promise<EventBody[]> {
  await page.settle();
  await s.stack.settled();
  return s.stack.events.map((recorded) => recorded.event);
}

/** Waits until this event has been counted. */
async function waitForEvent(s: Scenario, wanted: EventBody): Promise<void> {
  const deadline = performance.now() + 15_000;
  const same = (event: EventBody) => event.name === wanted.name && event.path === wanted.path && event.value === wanted.value;
  while (!s.stack.events.some((recorded) => same(recorded.event))) {
    if (performance.now() > deadline) {
      throw new Error(`never counted: ${JSON.stringify(wanted)}; counted: ${JSON.stringify(s.stack.events.map((each) => each.event))}`);
    }
    await new Promise((wake) => setTimeout(wake, 50));
  }
  await s.stack.settled();
}

/** The events counted on one screen, in order. */
const on = (events: EventBody[], path: string): EventBody[] => events.filter((event) => event.path === path);

/**
 * Every two neighbours among the 12 words, as text: "abandon ability". One
 * word alone proves nothing either way: "view", "page", "new", "wallet" and
 * "restore" are all on the word list, and are all in the name or the path
 * of some event.
 */
const pairsOf = (words: string): string[] =>
  words
    .split(' ')
    .slice(0, -1)
    .map((word, index) => `${word} ${words.split(' ')[index + 1]}`);

/**
 * No counted event says anything about the wallet: each is a name, a
 * screen and at most one value from the contract's closed list, and none
 * holds an address, a public key, a transaction or passkey ID, a wallet
 * fingerprint, a passkey's tag, or two of the 12 words in a row.
 */
function nothingPrivate(events: EventBody[], record: WalletRecord | null, more: string[] = []): void {
  assert.ok(events.length > 0, 'something was counted');
  const secrets = [
    record?.fingerprint,
    record?.xpub,
    record?.firstAddress,
    record?.credentialId,
    record?.tag,
    ...pairsOf(record?.mnemonic ?? ''),
    ...more,
  ];
  for (const event of events) {
    assert.ok(isEventBody(event), JSON.stringify(event));
    const text = JSON.stringify(event);
    assert.doesNotMatch(text, /bcrt1|tpub|[0-9a-f]{64}/, text);
    for (const secret of secrets) {
      if (secret !== undefined && secret !== '') assert.ok(!text.includes(secret), `${text} holds ${secret}`);
    }
  }
}

/** A record as Create and Restore store it for a wallet made without a passkey: the words, and what they give. */
function assertWordsRecord(record: WalletRecord | null, words?: string): asserts record is WalletRecord {
  assert.ok(record !== null, 'a record is stored');
  assert.equal(record.v, 1);
  assert.equal(record.kind, 'words');
  assert.equal(record.credentialId, undefined);
  assert.equal(record.tag, undefined);
  const mnemonic = record.mnemonic ?? '';
  assert.equal(mnemonic.split(' ').length, 12);
  assert.ok(isValidMnemonic(mnemonic), 'the stored words are a valid phrase');
  if (words !== undefined) assert.equal(mnemonic, words);
  const account = accountFromMnemonic(mnemonic);
  assert.equal(record.xpub, account.xpub);
  assert.equal(record.fingerprint, account.masterFingerprint);
  assert.match(record.firstAddress, /^bcrt1q/);
}

/** A record as Create and Open store it for a passkey wallet: which passkey, its tag, and no words. */
function assertPasskeyRecord(record: WalletRecord | null, credentialId: string): asserts record is WalletRecord {
  assert.ok(record !== null, 'a record is stored');
  assert.equal(record.v, 1);
  assert.equal(record.kind, 'passkey');
  assert.equal(record.credentialId, credentialId);
  assert.match(record.tag ?? '', TAG);
  assert.equal(record.mnemonic, undefined, 'a passkey wallet stores no words');
  assert.match(record.xpub, /^tpub/);
  assert.match(record.firstAddress, /^bcrt1q/);
}

// -- Home ---------------------------------------------------------------------------------

scenario('Home with no wallet: what this is, Create first, then the two ways back, and the practice network\'s two facts', async (s) => {
  const page = await s.open('/');
  assert.equal(await page.page.title(), 'Practice wallet | LearnBitcoin');
  assert.equal(await headingOf(page), en.common.appName);
  assert.ok((await page.page.$eval('main', (main) => main.textContent ?? '')).includes(en.home.lede));

  // Create is the main action; then "I already have a practice wallet", in the spec's order.
  await page.waitFor('home-create');
  const order = await page.page.$$eval('main [data-testid]', (nodes) => nodes.map((node) => (node as HTMLElement).dataset['testid']));
  assert.deepEqual(
    order.filter((hook) => ['home-create', 'open-passkey', 'home-restore'].includes(hook ?? '')),
    ['home-create', 'open-passkey', 'home-restore'],
  );
  assert.ok((await page.text('home-have')).includes(fill(en.home.haveWhy, { days: String(SAFARI_KEEPS_DAYS) })));
  assert.equal(await page.page.$eval('[data-testid="home-create"]', (link) => link.getAttribute('href')), '/new');
  assert.equal(await page.page.$eval('[data-testid="home-restore"]', (link) => link.getAttribute('href')), '/restore');

  // The two facts are the settings' own.
  assert.equal(
    await page.text('home-facts'),
    fill(en.home.facts, { seconds: String(s.stack.config.blockSeconds), sats: formatSats(s.stack.config.faucetSats) }),
  );
  for (const href of ['/about', '/sparrow']) assert.equal(await page.page.$$eval(`main a[href="${href}"]`, (links) => links.length), 1, href);

  // Both ways on change the screen without loading a page: what was typed into the window is still there.
  await page.page.evaluate(() => ((window as unknown as { __same: boolean }).__same = true));
  await page.click('home-restore');
  await arrivesAt(page, '/restore');
  assert.equal(await headingOf(page), en.common.screen_restore);
  await page.page.goBack();
  await arrivesAt(page, '/');
  await page.click('home-create');
  await arrivesAt(page, '/new');
  assert.equal(await headingOf(page), en.common.screen_new);
  assert.equal(await page.page.evaluate(() => (window as unknown as { __same?: boolean }).__same), true);
  assert.equal(await page.stored(), null);
  assert.deepEqual((await counted(s, page)).map((event) => [event.name, event.path]), [
    ['pageview', '/'],
    ['pageview', '/restore'],
    ['pageview', '/'],
    ['pageview', '/new'],
  ]);
});

scenario('what is stored decides: a wallet that is here, a record that cannot be read, one from a newer version', async (s) => {
  // A wallet made without a passkey: Home leads with the way in and says which wallet it is.
  const home = await s.open('/', { record: testRecord() });
  await home.waitFor('wallet-here');
  assert.equal(await home.text('wallet-here-kind'), en.home.hereWords);
  assert.equal(await countOf(home, 'home-create'), 0);
  assert.equal(await countOf(home, 'open-passkey'), 0);
  await home.click('wallet-open');
  await arrivesAt(home, '/wallet');

  // The same wallet stops Create and Restore, with the way into it.
  for (const path of ['/new', '/restore']) {
    const page = await s.open(path, { record: testRecord() });
    await page.waitFor('wallet-here');
    assert.ok((await page.text('wallet-here')).includes(en.home.hereAlready), path);
    assert.ok((await page.text('wallet-here')).includes(en.home.hereOne), path);
    for (const hook of ['create-passkey', 'create-words', 'word-input', 'restore-go']) assert.equal(await countOf(page, hook), 0, `${path}: ${hook}`);
    assert.equal(await page.stored(), JSON.stringify(testRecord()), path);
  }

  // Something stored that cannot be read: the shared piece, on all three, and nothing to make a wallet with.
  for (const path of ['/', '/new', '/restore']) {
    const page = await s.open(path, { record: 'not a record' });
    await page.waitFor('remove-wallet');
    assert.ok((await page.page.$eval('main', (main) => main.textContent ?? '')).includes(en.wallet.unreadableTitle), path);
    for (const hook of ['home-create', 'open-passkey', 'create-passkey', 'create-words', 'word-input']) assert.equal(await countOf(page, hook), 0, `${path}: ${hook}`);
    assert.equal(await page.stored(), 'not a record', path);
  }

  // Written by a newer version of the page: Reload only, and it is left alone.
  const newer = JSON.stringify({ v: 2, kind: 'words' });
  for (const path of ['/', '/new', '/restore']) {
    const page = await s.open(path, { record: newer });
    await page.page.waitForFunction((title) => (document.querySelector('main')?.textContent ?? '').includes(title), {}, en.wallet.newerTitle);
    for (const hook of ['remove-wallet', 'home-create', 'create-words', 'word-input']) assert.equal(await countOf(page, hook), 0, `${path}: ${hook}`);
    assert.equal(await page.stored(), newer, path);
  }
});

scenario('a browser that stores nothing: Create and Restore say so and stop, before any passkey is made', async (s) => {
  for (const path of ['/new', '/restore']) {
    const page = await s.open('/about', { passkey: 'prf' });
    // From the next page load on, this browser refuses every write, as a private window with site data blocked does.
    await page.page.evaluateOnNewDocument(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });
    await page.goto(path);
    await page.waitFor('front-stop');
    const said = await page.text('front-stop');
    assert.ok(said.includes(en.wallet.noStorage.split('. ')[0]!), said);
    for (const hook of ['create-passkey', 'create-words', 'finish-setup', 'word-input', 'restore-go']) assert.equal(await countOf(page, hook), 0, `${path}: ${hook}`);
    // It was so when the screen opened: said on the screen, not called out as an alert.
    assert.equal(await page.page.$eval('[data-testid="front-stop"]', (notice) => notice.getAttribute('role')), null);
    assert.deepEqual(await page.passkey!.credentials(), [], 'no passkey was made');
    assert.equal(await page.stored(), null);
  }
});

scenario('a browser that offers no passkey: Create says what to do and goes on without one; Home says so too', async (s) => {
  const page = await s.open('/about');
  // Chrome here can make the wallet's passkeys. A browser inside another app often cannot: it reports no "prf".
  await page.page.evaluateOnNewDocument(() => {
    (PublicKeyCredential as unknown as { getClientCapabilities: () => Promise<Record<string, boolean>> }).getClientCapabilities = () =>
      Promise.resolve({});
  });
  await page.goto('/new');
  await page.waitFor('create-not-offered');
  assert.equal(await page.text('create-not-offered'), en.create.passkeyNotOffered);
  assert.equal(await countOf(page, 'create-passkey'), 0);
  // The way without a passkey works as everywhere.
  await page.click('create-words');
  await arrivesAt(page, '/wallet/backup');
  assertWordsRecord(await storedRecord(page));

  const home = await s.open('/about');
  await home.page.evaluateOnNewDocument(() => {
    (PublicKeyCredential as unknown as { getClientCapabilities: () => Promise<Record<string, boolean>> }).getClientCapabilities = () =>
      Promise.resolve({});
  });
  await home.goto('/');
  await home.waitFor('open-not-offered');
  assert.equal(await home.text('open-not-offered'), en.wallet.openNotOffered);
  assert.equal(await countOf(home, 'open-passkey'), 0);
  assert.equal(await countOf(home, 'home-restore'), 1);
});

// -- Create -------------------------------------------------------------------------------

scenario('create without a passkey: nothing is stored before the tap; then a record with its 12 words, on to the "Wallet made" address, counted once', async (s) => {
  const page = await s.open('/');
  await page.click('home-create');
  await arrivesAt(page, '/new');
  await page.waitFor('create-words');
  // Before the tap: what this means.
  const panel = await page.text('create-without-passkey');
  assert.ok(panel.includes(en.create.wordsKept), panel);
  assert.ok(panel.includes(fill(en.create.wordsErased, { days: String(SAFARI_KEEPS_DAYS) })), panel);
  assert.equal(await page.stored(), null);
  const saidAlready = await everShown(page, 'wallet-here', '/new');

  await page.click('create-words');
  await arrivesAt(page, '/wallet/backup');
  const record = await storedRecord(page);
  assertWordsRecord(record);
  // In the moment between the wallet being stored and the screen moving on, Create never said "a wallet is already here".
  assert.equal(await saidAlready(), false);
  // The keys are loaded, so the next screen shows the words with no prompt: no reload happened on the way.
  assert.equal(page.responses.filter((response) => response.type === 'document').length, 1);

  const events = await counted(s, page);
  assert.deepEqual(on(events, '/new'), [
    { name: 'pageview', path: '/new' },
    { name: 'Wallet created', path: '/new', value: 'words' },
  ]);
  assert.ok(events.some((event) => event.name === 'pageview' && event.path === '/wallet/backup'));
  nothingPrivate(events, record);

  // Back does not return to a Create that could only say a wallet is here: it leads to Home, which shows the wallet.
  await page.page.goBack();
  await arrivesAt(page, '/');
  await page.waitFor('wallet-here');
  assert.equal(await page.text('wallet-here-kind'), en.home.hereWords);
});

scenario('create with a passkey whose secret comes with create(): one prompt, one passkey, a record without words', async (s) => {
  const page = await s.open('/new', { passkey: 'prf' });
  await page.page.bringToFront();
  await page.waitFor('create-passkey');
  // Before the tap: what the device is about to ask, where the 12 words come from, and what is not sent.
  const panel = await page.text('create-with-passkey');
  assert.ok(panel.includes(fill(en.create.passkeyAsk, { name: 'Practice wallet' })), panel);
  assert.ok(panel.includes(en.create.passkeyMakes), panel);
  assert.ok(panel.includes(en.create.passkeySent), panel);
  assert.deepEqual(await page.passkey!.credentials(), []);
  assert.equal(await page.stored(), null);
  const prompts = await countPrompts(page);

  await page.click('create-passkey');
  await arrivesAt(page, '/wallet/backup');
  const passkeys = await page.passkey!.credentials();
  assert.equal(passkeys.length, 1);
  // The secret came with create(): one prompt, and the passkey was never asked again.
  assert.deepEqual(await prompts(), { create: 1, get: 0 });
  assert.deepEqual([passkeys[0]!.uses, passkeys[0]!.rpId], [0, 'localhost']);
  const record = await storedRecord(page);
  assertPasskeyRecord(record, passkeys[0]!.id);

  const events = await counted(s, page);
  assert.deepEqual(on(events, '/new'), [
    { name: 'pageview', path: '/new' },
    { name: 'Passkey', path: '/new', value: 'ok' },
    { name: 'Wallet created', path: '/new', value: 'passkey' },
  ]);
  nothingPrivate(events, record);

  // Home now leads with the way in, and points the wallet out by the tag in its passkey's name.
  await page.goto('/');
  await page.waitFor('wallet-here');
  assert.equal(await page.text('wallet-here-kind'), fill(en.home.herePasskeyTagged, { tag: record.tag ?? '' }));
  // Looking costs no prompt.
  assert.equal((await page.passkey!.credentials())[0]!.uses, 0);
});

scenario('create with a passkey whose secret comes only at the follow-up get(): two prompts from one tap', async (s) => {
  const page = await s.open('/new', { passkey: 'prf-at-get' });
  await page.page.bringToFront();
  await page.waitFor('create-passkey');
  const prompts = await countPrompts(page);
  await page.click('create-passkey');
  await arrivesAt(page, '/wallet/backup');
  const passkeys = await page.passkey!.credentials();
  assert.equal(passkeys.length, 1);
  assert.deepEqual(await prompts(), { create: 1, get: 1 }, 'create(), then exactly one get() for the secret');
  assert.equal(passkeys[0]!.uses, 1);
  const record = await storedRecord(page);
  assertPasskeyRecord(record, passkeys[0]!.id);

  const events = await counted(s, page);
  assert.deepEqual(on(events, '/new'), [
    { name: 'pageview', path: '/new' },
    { name: 'Passkey', path: '/new', value: 'ok-at-get' },
    { name: 'Wallet created', path: '/new', value: 'passkey' },
  ]);
  nothingPrivate(events, record);
});

scenario('a passkey that never gives the secret: no wallet, how to delete it by its tag, and the way on without a passkey', async (s) => {
  const page = await s.open('/new', { passkey: 'no-prf' });
  await page.page.bringToFront();
  await page.waitFor('create-passkey');
  const prompts = await countPrompts(page);
  await page.click('create-passkey');
  await page.waitFor('create-problem');
  assert.equal(await pathOf(page), '/new');
  assert.equal(await page.stored(), null, 'nothing was stored');

  // The cause, from the error table; which passkey it was; how to delete it; the other way on.
  const said = await page.text('create-problem');
  assert.ok(said.includes(en.errors['passkey_no-prf']), said);
  const named = await page.text('passkey-named');
  const tag = /"([^"]+)"/.exec(named)?.[1] ?? '';
  assert.match(tag, TAG);
  assert.equal(await page.text('create-delete-passkey'), fill(en.create.noPrfDeleteTagged, { host: 'localhost', tag }));
  assert.ok(said.includes(en.create.noPrfElsewhere), said);
  assert.equal(await page.page.$eval('[data-testid="create-problem"]', (notice) => notice.getAttribute('role')), 'alert');
  // The button that was pressed is still there, and still has focus.
  assert.equal(await focusOf(page), 'create-passkey');
  assert.deepEqual(page.statusLog(), [], 'a refusal is an alert, not an outcome for the status region');

  // Two prompts were answered (create, then the one get() that had no secret), and the page hinted the provider to drop the passkey.
  assert.deepEqual(await prompts(), { create: 1, get: 1 });
  assert.deepEqual(await page.passkey!.credentials(), [], 'the virtual authenticator dropped the passkey when told it is unknown');
  const events = await counted(s, page);
  assert.deepEqual(events, [
    { name: 'pageview', path: '/new' },
    { name: 'Passkey', path: '/new', value: 'no-prf' },
  ]);
  nothingPrivate(events, null, [tag]);

  // The way on: without a passkey.
  await page.click('create-words');
  await arrivesAt(page, '/wallet/backup');
  assertWordsRecord(await storedRecord(page));
});

scenario('a cancelled prompt: no passkey, no wallet, the cause and both ways on; then the reader goes on without a passkey', async (s) => {
  const page = await s.open('/new', { passkey: 'prf' });
  await page.page.bringToFront();
  await page.waitFor('create-passkey');
  await page.passkey!.refuse();
  const prompts = await countPrompts(page);
  await page.click('create-passkey');
  await page.waitFor('create-problem');
  // One prompt, refused: no second one follows by itself.
  assert.deepEqual(await prompts(), { create: 1, get: 0 });

  const said = await page.text('create-problem');
  assert.ok(said.includes(en.errors.passkey_cancelled), said);
  assert.ok(said.includes(en.create.cancelledNothing), said);
  assert.ok(said.includes(en.create.cancelledWays), said);
  assert.equal(await pathOf(page), '/new');
  assert.equal(await page.stored(), null);
  assert.deepEqual(await page.passkey!.credentials(), [], 'no passkey was saved');
  assert.equal(await focusOf(page), 'create-passkey');
  // Both buttons can be pressed again.
  for (const hook of ['create-passkey', 'create-words']) {
    assert.equal(await page.page.$eval(`[data-testid="${hook}"]`, (button) => (button as HTMLButtonElement).disabled), false, hook);
  }
  assert.deepEqual(await counted(s, page), [
    { name: 'pageview', path: '/new' },
    { name: 'Passkey', path: '/new', value: 'cancelled' },
  ]);

  await page.click('create-words');
  await arrivesAt(page, '/wallet/backup');
  const record = await storedRecord(page);
  assertWordsRecord(record);
  nothingPrivate(await counted(s, page), record);
});

scenario('the follow-up prompt is dismissed: "Finish setting up" waits, also after a visit to Home, and one more prompt finishes it', async (s) => {
  const page = await s.open('/new', { passkey: 'prf-at-get' });
  await page.page.bringToFront();
  await page.waitFor('create-passkey');
  // The reader dismisses the second prompt, the one that asks the new passkey for its secret: the next get() is refused, once.
  await refuseNextGet(page);
  const roles = await watchRole(page, 'create-unfinished');

  await page.click('create-passkey');
  await page.waitFor('finish-setup');
  await focusArrivesAt(page, 'finish-setup');
  // The passkey exists, the wallet does not, and the screen says so with the passkey's tag.
  const waiting = await page.text('create-unfinished');
  const tag = /"([^"]+)"/.exec(waiting)?.[1] ?? '';
  assert.match(tag, TAG);
  assert.equal(waiting, fill(en.create.unfinishedTagged, { tag }));
  assert.equal(await countOf(page, 'create-passkey'), 0);
  assert.equal(await focusOf(page), 'finish-setup');
  // It is said aloud, once: the line is put on the page as an alert. (A line that is already there and is
  // then given the role is not something a screen reader can be counted on to say.)
  const said = await roles();
  assert.equal(said.at(-1), 'put with role alert', said.join('; '));
  assert.ok(!said.some((line) => line.startsWith('role changed')), said.join('; '));
  assert.equal(await page.stored(), null);
  const before = await page.passkey!.credentials();
  assert.deepEqual(before.map((passkey) => passkey.uses), [0], 'one passkey, not asked successfully yet');
  assert.deepEqual(await counted(s, page), [
    { name: 'pageview', path: '/new' },
    { name: 'Passkey', path: '/new', value: 'unfinished' },
  ]);

  // The reader looks at Home and comes back: the passkey is still waiting, and the way without one is still offered.
  await goHome(page);
  await page.click('home-create');
  await arrivesAt(page, '/new');
  await page.waitFor('finish-setup');
  assert.equal(await page.text('create-unfinished'), fill(en.create.unfinishedTagged, { tag }));
  // Something that was so when the screen opened is on the screen, and is not called out.
  assert.equal(await page.page.$eval('[data-testid="create-unfinished"]', (line) => line.getAttribute('role')), null);
  assert.equal(await countOf(page, 'create-words'), 1);

  await page.click('finish-setup');
  await arrivesAt(page, '/wallet/backup');
  const after = await page.passkey!.credentials();
  assert.deepEqual(after.map((passkey) => [passkey.id, passkey.uses]), [[before[0]!.id, 1]], 'the same passkey, asked once');
  const record = await storedRecord(page);
  assertPasskeyRecord(record, before[0]!.id);
  assert.equal(record.tag, tag);
  const events = await counted(s, page);
  assert.deepEqual(on(events, '/new'), [
    { name: 'pageview', path: '/new' },
    { name: 'Passkey', path: '/new', value: 'unfinished' },
    { name: 'pageview', path: '/new' },
    { name: 'Passkey', path: '/new', value: 'finished' },
    { name: 'Wallet created', path: '/new', value: 'passkey' },
  ]);
  nothingPrivate(events, record);
});

scenario('two tabs: a wallet made in one stops Create and Restore in the other', async (s) => {
  const first = await s.open('/new');
  const second = await s.open('/new', { context: first.context });
  const third = await s.open('/restore', { context: first.context });
  await second.waitFor('create-words');
  await third.waitFor('restore-go');

  // A tab takes a click only while it is the one in front.
  await first.page.bringToFront();
  await first.click('create-words');
  await arrivesAt(first, '/wallet/backup');
  const record = await storedRecord(first);
  assertWordsRecord(record);

  // The other tabs hear of it and put the wallet in the screen's place: nothing more can be made or restored there.
  await second.waitFor('wallet-here');
  assert.ok((await second.text('wallet-here')).includes(en.home.hereAlready));
  assert.equal(await second.text('wallet-here-kind'), en.home.hereWords);
  for (const hook of ['create-passkey', 'create-words', 'finish-setup']) assert.equal(await countOf(second, hook), 0, hook);
  await third.waitFor('wallet-here');
  for (const hook of ['word-input', 'restore-go', 'restore-check']) assert.equal(await countOf(third, hook), 0, hook);
  // One wallet, the first tab's, in all three.
  assert.equal(await second.stored(), JSON.stringify(record));
  assert.equal(await third.stored(), JSON.stringify(record));

  // The way on from there is into that wallet.
  await second.page.bringToFront();
  await second.click('wallet-open');
  await arrivesAt(second, '/wallet');
  const created = s.stack.events.filter((recorded) => recorded.event.name === 'Wallet created');
  assert.equal(created.length, 1, 'one wallet was made');
});

// -- Restore ------------------------------------------------------------------------------

scenario('the word fields carry the attributes of the spec, with no name and no form around them', async (s) => {
  const page = await s.open('/restore');
  await page.waitFor('word-input');
  const fields = await page.page.$$eval('[data-testid="word-input"]', (nodes) =>
    nodes.map((node) => ({
      tag: node.tagName,
      spellcheck: node.getAttribute('spellcheck'),
      autocomplete: node.getAttribute('autocomplete'),
      autocorrect: node.getAttribute('autocorrect'),
      autocapitalize: node.getAttribute('autocapitalize'),
      translate: node.getAttribute('translate'),
      name: node.getAttribute('name'),
      inForm: (node as HTMLInputElement).form !== null || node.closest('form') !== null,
      labelled: (node as HTMLInputElement).labels?.length ?? 0,
    })),
  );
  assert.equal(fields.length, 12);
  for (const [index, field] of fields.entries()) {
    assert.deepEqual(
      field,
      { tag: 'INPUT', spellcheck: 'false', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', translate: 'no', name: null, inForm: false, labelled: 1 },
      `word ${index + 1}`,
    );
  }
  // The twelve are one group with a name, are left out on paper, and the page has no form at all.
  const group = await page.page.$eval('[data-testid="restore-words"]', (node) => ({
    role: node.getAttribute('role'),
    label: node.getAttribute('aria-label'),
    print: node.getAttribute('data-print'),
  }));
  assert.deepEqual(group, { role: 'group', label: en.wallet.wordsGroup, print: 'never' });
  assert.equal(await page.page.$$eval('form', (forms) => forms.length), 0);

  // The order on the screen: why this page may ask, what happens to the words, the fields, the box, the button.
  const order = await page.page.$$eval('main [data-testid]', (nodes) => nodes.map((node) => (node as HTMLElement).dataset['testid'] ?? ''));
  assert.deepEqual(
    order.filter((hook) => hook !== 'word-input'),
    ['restore-exception', 'restore-kept', 'restore-words', 'restore-check', 'restore-go'],
  );
  assert.ok((await page.text('restore-exception')).includes(en.restore.exception));
  const chapter = await page.page.$eval('[data-testid="restore-exception"] a', (link) => ({
    href: link.getAttribute('href'),
    target: link.getAttribute('target'),
    rel: link.getAttribute('rel'),
  }));
  assert.deepEqual(chapter, { href: `${s.stack.config.siteUrl}/journey/be-your-own-bank`, target: '_blank', rel: 'noopener noreferrer' });
  // The link stands by itself, on one line at this width: the area that takes a tap is 44 px tall all the same.
  const tap = await page.page.$eval('[data-testid="restore-exception"] a', (link) => {
    const area = getComputedStyle(link, '::after');
    return { lines: Math.round(link.getBoundingClientRect().height / parseFloat(getComputedStyle(link).lineHeight)), area: `${area.position} ${area.height}` };
  });
  assert.deepEqual(tap, { lines: 1, area: 'absolute 44px' });
  // What becomes of the words, with how soon Safari erases what a site stored (a restored wallet never passes "Wallet made").
  const kept = await page.text('restore-kept');
  assert.ok(kept.includes(fill(en.restore.kept, { days: String(SAFARI_KEEPS_DAYS) })) && kept.includes(en.restore.never), kept);
  assert.match(kept, new RegExp(`Safari does if you go ${SAFARI_KEEPS_DAYS} days without using the site`));
  // A screen reader that goes from control to control passes over plain text. So the box where the reader
  // says "these are practice words" names both notices as its description.
  const described = await page.page.$eval('[data-testid="restore-check"]', (box) =>
    (box.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => Array.from(document.getElementById(id)?.querySelectorAll('[data-testid]') ?? []).map((node) => (node as HTMLElement).dataset['testid'])),
  );
  assert.deepEqual(described, [['restore-exception', 'restore-kept']]);
});

/** How many times the page has asked the Worker about the chain. */
const chainReads = (page: OpenedPage): number => page.responses.filter((response) => new URL(response.url).pathname.startsWith('/api/esplora/')).length;

scenario('a word that is not on the list is pointed out and described; the box is asked for; a bad checksum says so; nothing is asked of the network', async (s) => {
  const page = await s.open('/restore');
  await page.settle();
  const asked = chainReads(page);
  const wrong = TEST_WORDS.replace('abandon abandon abandon', 'abandon abandon abandn');
  await typeWords(page, wrong);

  // "Restore" pressed with a wrong word and the box not ticked: it says why not, for both.
  await page.click('restore-go');
  await page.waitFor('restore-check-needed');
  const third = await page.page.$$eval('[data-testid="word-input"]', (nodes) => {
    const field = nodes[2] as HTMLInputElement;
    const described = field.getAttribute('aria-describedby');
    return {
      invalid: field.getAttribute('aria-invalid'),
      says: described === null ? null : (document.getElementById(described)?.textContent ?? '').trim(),
      focused: document.activeElement === field,
      others: nodes.filter((node) => node.getAttribute('aria-invalid') === 'true').length,
    };
  });
  assert.deepEqual(third, { invalid: 'true', says: fill(en.wallet.wordsUnknown, { n: '3' }), focused: true, others: 1 });
  const box = await page.page.$eval('[data-testid="restore-check"]', (node) => {
    // The line that asks for the box comes first, then the two notices above the fields.
    const [first = '', ...others] = (node.getAttribute('aria-describedby') ?? '').split(' ');
    return {
      invalid: node.getAttribute('aria-invalid'),
      says: (document.getElementById(first)?.textContent ?? '').trim(),
      then: others.map((id) => document.getElementById(id)?.querySelectorAll('[data-testid="restore-exception"], [data-testid="restore-kept"]').length ?? 0),
      checked: (node as HTMLInputElement).checked,
    };
  });
  assert.deepEqual(box, { invalid: 'true', says: en.restore.checkNeeded, then: [2], checked: false });
  assert.equal(await page.text('restore-check-needed'), en.restore.checkNeeded);

  // The word is corrected: only the box is missing now, and focus goes to it.
  const fields = await page.page.$$('[data-testid="word-input"]');
  await fields[2]!.click({ count: 3 });
  await fields[2]!.type('abandon');
  await page.click('restore-go');
  assert.equal(await focusOf(page), 'restore-check');
  assert.equal(await page.page.$$eval('[data-testid="word-input"][aria-invalid="true"]', (nodes) => nodes.length), 0);
  await page.click('restore-check');
  await page.waitForGone('restore-check-needed');

  // Twelve words that are all on the list and do not pass their checksum.
  await fields[11]!.click({ count: 3 });
  await fields[11]!.type('abandon');
  await page.click('restore-go');
  await page.waitFor('words-invalid');
  assert.equal(await page.text('words-invalid'), en.wallet.wordsInvalid);

  // None of it reached the practice network or the storage, and nothing was counted but the screen.
  assert.equal(await page.stored(), null);
  assert.equal(await pathOf(page), '/restore');
  const events = await counted(s, page);
  assert.equal(chainReads(page), asked, 'no word was looked up on the practice network');
  assert.deepEqual(events, [{ name: 'pageview', path: '/restore' }]);
});

scenario('restore of words that have practice coins, by keyboard alone: stored only after the scan, and the same wallet as before', { localOnly: true }, async (s) => {
  const paid = fundTestWallet(s.standIn);
  const page = await s.open('/');
  await page.click('home-restore');
  await arrivesAt(page, '/restore');
  await page.waitFor('word-input');
  assert.equal(await page.stored(), null);
  const saidAlready = await everShown(page, 'wallet-here', '/restore');

  // What the page writes to its storage and asks of the Worker, in the order it happens.
  await page.page.evaluate(() => {
    const order: string[] = [];
    (window as unknown as { __order: string[] }).__order = order;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string): void {
      order.push(`store ${key}`);
      setItem.call(this, key, value);
    };
    const ask = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href).pathname;
      order.push(`ask ${path}`);
      const answer = await ask(input, init);
      order.push(`answer ${path}`);
      return answer;
    };
  });

  // Tab to the first field, type the twelve words with a space after each, Tab to the box, Space, Tab to the button, Enter.
  for (let presses = 0; (await focusOf(page)) !== 'word-input'; presses += 1) {
    assert.ok(presses < 20, 'the first word field is reached with the Tab key');
    await page.page.keyboard.press('Tab');
  }
  await page.page.keyboard.type(TEST_WORDS, { delay: 5 });
  assert.deepEqual(await wordsTyped(page), TEST_WORDS.split(' '));
  await page.page.keyboard.press('Tab');
  assert.equal(await focusOf(page), 'restore-check');
  await page.page.keyboard.press('Space');
  await page.page.keyboard.press('Tab');
  assert.equal(await focusOf(page), 'restore-go');
  await page.page.keyboard.press('Enter');

  await arrivesAt(page, '/wallet');
  // The same wallet as the one that was paid: the same words, the same first address.
  const record = await storedRecord(page);
  assertWordsRecord(record, TEST_WORDS);
  const original = testRecord();
  assert.deepEqual([record.firstAddress, record.xpub, record.fingerprint], [original.firstAddress, original.xpub, original.fingerprint]);
  assert.equal(paid[0]!.address, record.firstAddress);
  assert.deepEqual(await s.network.coins(record.firstAddress), { count: 1, sats: paid[0]!.sats });

  // Scan first: every read of the look for history was answered before the one write of the record.
  const order = await page.page.evaluate(() => (window as unknown as { __order: string[] }).__order);
  const writes = order.filter((line) => line === `store ${RECORD_KEY}`);
  assert.equal(writes.length, 1, order.join('\n'));
  const written = order.indexOf(`store ${RECORD_KEY}`);
  const readsBefore = order.slice(0, written).filter((line) => line.startsWith('answer /api/esplora/'));
  // A full scan of a wallet with three addresses in use is 63 reads (notes/21); 40 is an empty wallet's.
  assert.ok(readsBefore.length >= 40, `${readsBefore.length} reads were answered before the record was written`);
  assert.equal(order.slice(0, written).filter((line) => line.startsWith('ask /api/esplora/')).length, readsBefore.length, 'no read was still open when the record was written');

  const events = await counted(s, page);
  assert.deepEqual(on(events, '/restore'), [
    { name: 'pageview', path: '/restore' },
    { name: 'Restore', path: '/restore', value: 'found' },
  ]);
  assert.ok(events.some((event) => event.name === 'pageview' && event.path === '/wallet'));
  nothingPrivate(events, record, paid.map((coin) => coin.txid));

  // In the moment between the wallet being stored and the screen moving on, Restore never said "a wallet is already here".
  assert.equal(await saidAlready(), false);
  // The wallet took Restore's place in the history: Back leads to Home, not to a Restore that could only say a wallet is here.
  await page.page.goBack();
  await arrivesAt(page, '/');
  await page.waitFor('wallet-here');
});

scenario('restore of unused words: nothing is stored until "Keep them here anyway", and a browser that refuses the first try is said so', async (s) => {
  const words = freshRecord().mnemonic ?? '';
  const page = await s.open('/');
  await page.click('home-restore');
  await arrivesAt(page, '/restore');
  await typeWords(page, words);
  await page.click('restore-check');
  await page.click('restore-go');

  // The step opens in the screen's place: its heading takes focus and names the page.
  await page.waitFor('restore-empty');
  assert.equal(await headingOf(page), en.restore.emptyTitle);
  assert.equal(await focusOf(page), 'H1');
  assert.equal(await page.page.title(), fill(en.common.markerTitle, { screen: en.restore.emptyName }));
  const said = await page.text('restore-empty');
  for (const line of [en.restore.emptyBody, en.restore.emptyReal, en.restore.emptyPractice]) assert.ok(said.includes(line), line);
  // The fields went with the form, and nothing is stored.
  assert.equal(await countOf(page, 'word-input'), 0);
  assert.equal(await page.stored(), null);
  assert.equal(await pathOf(page), '/restore');
  assert.deepEqual(on(await counted(s, page), '/restore'), [{ name: 'pageview', path: '/restore' }]);
  // What was looked up, and that the words stayed here: this is the step a reader with a real wallet's words reads.
  assert.match(en.restore.emptyBody, /at the addresses these 12 words give/);
  assert.match(en.restore.emptyBody, /The words themselves did not leave this browser\./);

  // The browser has stopped storing anything (site data was blocked meanwhile): the choice is refused, said so, and stays open.
  const allowWrites = await refuseWrites(page);
  await page.click('restore-keep');
  await page.waitFor('restore-problem');
  assert.equal(await page.text('restore-problem'), en.restore.keepRefused);
  assert.equal(await page.page.$eval('[data-testid="restore-problem"]', (notice) => notice.getAttribute('role')), 'alert');
  assert.equal(await headingOf(page), en.restore.emptyTitle);
  assert.deepEqual([await countOf(page, 'restore-keep'), await countOf(page, 'restore-erase'), await countOf(page, 'front-stop')], [1, 1, 0]);
  assert.equal(await focusOf(page), 'restore-keep');
  assert.equal(await page.stored(), null);
  assert.equal(await pathOf(page), '/restore');

  // Storage is allowed again, and the reader chooses again: the same words are kept.
  await allowWrites();
  await page.click('restore-keep');
  await arrivesAt(page, '/wallet');
  const record = await storedRecord(page);
  assertWordsRecord(record, words);
  const events = await counted(s, page);
  assert.deepEqual(on(events, '/restore'), [
    { name: 'pageview', path: '/restore' },
    { name: 'Restore', path: '/restore', value: 'kept' },
  ]);
  nothingPrivate(events, record);

  // The wallet took Restore's place in the history: Back leads to Home.
  await page.page.goBack();
  await arrivesAt(page, '/');
  await page.waitFor('wallet-here');
  assert.equal(await page.page.$eval('[data-testid="wallet-open"]', (link) => link.getAttribute('href')), '/wallet');
});

scenario('restore of unused words: "Erase" returns to empty fields with nothing stored, and leaving the step erases them too', async (s) => {
  const words = freshRecord().mnemonic ?? '';
  const page = await s.open('/restore');
  await typeWords(page, words);
  await page.click('restore-check');
  await page.click('restore-go');
  await page.waitFor('restore-empty');

  await page.click('restore-erase');
  await page.waitFor('restore-words');
  assert.equal(await headingOf(page), en.common.screen_restore);
  assert.equal(await focusOf(page), 'H1');
  assert.deepEqual(await wordsTyped(page), Array.from({ length: 12 }, () => ''));
  assert.equal(await page.page.$eval('[data-testid="restore-check"]', (box) => (box as HTMLInputElement).checked), false);
  assert.equal(await page.stored(), null);
  assert.deepEqual(await counted(s, page), [
    { name: 'pageview', path: '/restore' },
    { name: 'Restore', path: '/restore', value: 'erased' },
  ]);

  // Again, and this time the reader walks away from the step: the words do not wait for them.
  await typeWords(page, words);
  await page.click('restore-check');
  await page.click('restore-go');
  await page.waitFor('restore-empty');
  await goHome(page);
  await waitForEvent(s, { name: 'pageview', path: '/' });
  const events = await counted(s, page);
  assert.deepEqual(on(events, '/restore'), [
    { name: 'pageview', path: '/restore' },
    { name: 'Restore', path: '/restore', value: 'erased' },
    { name: 'Restore', path: '/restore', value: 'erased' },
  ]);
  assert.equal(await page.stored(), null);
  // Back on Restore the fields are empty and no step is open.
  await page.click('home-restore');
  await arrivesAt(page, '/restore');
  await page.waitFor('restore-words');
  assert.deepEqual(await wordsTyped(page), Array.from({ length: 12 }, () => ''));
  assert.equal(await countOf(page, 'restore-empty'), 0);
  // The words left no trace where a regular expression would keep one.
  const trace = await page.page.evaluate(() => String((RegExp as unknown as { input?: string }).input ?? ''));
  for (const pair of pairsOf(words)) assert.ok(!trace.includes(pair), 'RegExp.input holds none of the words');
  nothingPrivate(events, null, pairsOf(words));
});

scenario('a look for history that fails: the cause, nothing stored, the words still in the fields; once the network answers they restore', { localOnly: true }, async (s) => {
  fundTestWallet(s.standIn);
  const page = await s.open('/restore');
  await typeWords(page, TEST_WORDS);
  await page.click('restore-check');
  await page.settle();

  s.expectFault('origin_down');
  s.standIn.setOrigin('down');
  await page.click('restore-go');
  await page.waitFor('restore-problem');
  const said = await page.text('restore-problem');
  // The cause and the way out from the error table, then what became of the words.
  assert.ok(said.includes(en.errors.unavailable), said);
  assert.ok(said.includes(en.restore.failedKept), said);
  assert.equal(await page.page.$eval('[data-testid="restore-problem"]', (notice) => notice.getAttribute('role')), 'alert');
  assert.equal(await page.stored(), null);
  assert.deepEqual(await wordsTyped(page), TEST_WORDS.split(' '));
  assert.equal(await page.page.$eval('[data-testid="restore-check"]', (box) => (box as HTMLInputElement).checked), true);
  assert.equal(await focusOf(page), 'restore-go');
  assert.deepEqual(await buttonOf(page, 'restore-go'), { text: en.restore.go, busy: false, disabled: false });

  // The reader unticks the box and presses again: the form itself stops this one, and what the
  // earlier try was answered with is gone. (It said the words "are still in the fields above, so
  // you can try again", right above a button that now asks for the box.)
  await page.click('restore-check');
  await page.click('restore-go');
  await page.waitFor('restore-check-needed');
  assert.equal(await countOf(page, 'restore-problem'), 0);
  assert.deepEqual(await page.page.$$eval('[role="alert"]', (alerts) => alerts.map((alert) => (alert as HTMLElement).dataset['testid'])), ['restore-check-needed']);
  await page.click('restore-check');
  await page.waitForGone('restore-check-needed');

  // The same tap again, once the practice network is back.
  s.standIn.setOrigin('ok');
  await page.click('restore-go');
  await arrivesAt(page, '/wallet');
  const record = await storedRecord(page);
  assertWordsRecord(record, TEST_WORDS);
  assert.deepEqual(on(await counted(s, page), '/restore'), [
    { name: 'pageview', path: '/restore' },
    { name: 'Restore', path: '/restore', value: 'found' },
  ]);
});

// -- open with a passkey --------------------------------------------------------------------

/**
 * Makes a passkey wallet through Create, then clears this browser's storage
 * and loads Home afresh. With `fund`, the wallet's first address is paid on
 * the stand-in network first, which only a local run can do.
 */
async function madeThenCleared(s: Scenario, fund: boolean): Promise<{ page: OpenedPage; made: WalletRecord }> {
  const page = await s.open('/new', { passkey: 'prf' });
  await page.page.bringToFront();
  await page.click('create-passkey');
  await arrivesAt(page, '/wallet/backup');
  const made = await storedRecord(page);
  assert.ok(made !== null && made.kind === 'passkey');
  if (fund) s.standIn.fund(made.firstAddress, 50_000);
  // The browser forgets the site's data (as Safari does after a week without use). The passkey stays with its provider.
  await page.store(RECORD_KEY, null);
  await page.goto('/');
  await page.waitFor('open-passkey');
  assert.equal(await page.stored(), null);
  assert.equal(await countOf(page, 'wallet-here'), 0);
  return { page, made };
}

scenario('open with a passkey after the storage was cleared: the same wallet comes back, with one prompt, counted as "opened" after its first scan', { localOnly: true }, async (s) => {
  const { page, made } = await madeThenCleared(s, true);
  await page.click('open-passkey');
  await arrivesAt(page, '/wallet');
  const record = await storedRecord(page);
  assertPasskeyRecord(record, made.credentialId ?? '');
  // The same wallet: the same public key, wallet fingerprint, first address and tag.
  assert.deepEqual(
    [record.xpub, record.fingerprint, record.firstAddress, record.tag],
    [made.xpub, made.fingerprint, made.firstAddress, made.tag],
  );
  assert.deepEqual((await page.passkey!.credentials()).map((passkey) => passkey.uses), [1], 'one get() to open it');

  await waitForEvent(s, { name: 'Unlock', path: '/wallet', value: 'opened' });
  const events = await counted(s, page);
  assert.deepEqual(events.filter((event) => event.name === 'Unlock'), [{ name: 'Unlock', path: '/wallet', value: 'opened' }]);
  nothingPrivate(events, record);
});

scenario('open with a passkey whose wallet was never used: counted as "opened-empty"', async (s) => {
  const { page, made } = await madeThenCleared(s, false);
  await page.click('open-passkey');
  await arrivesAt(page, '/wallet');
  const record = await storedRecord(page);
  assertPasskeyRecord(record, made.credentialId ?? '');
  assert.equal(record.xpub, made.xpub);
  await waitForEvent(s, { name: 'Unlock', path: '/wallet', value: 'opened-empty' });
  const events = await counted(s, page);
  assert.deepEqual(events.filter((event) => event.name === 'Unlock'), [{ name: 'Unlock', path: '/wallet', value: 'opened-empty' }]);
  nothingPrivate(events, record);
});

scenario('open with a passkey on a device that holds none: nothing opens, and the text allows for a passkey that has not arrived', async (s) => {
  const page = await s.open('/', { passkey: 'prf' });
  await page.page.bringToFront();
  assert.deepEqual(await page.passkey!.credentials(), []);
  await page.click('open-passkey');
  await page.page.waitForSelector('[data-testid="home-have"] [role="alert"]');
  const said = await page.text('home-have');
  assert.ok(said.includes(en.errors.passkey_cancelled), said);
  assert.ok(said.includes(en.wallet.openHint), said);
  assert.equal(await pathOf(page), '/');
  assert.equal(await page.stored(), null);
  // Restore is still one tap away, right under what was said.
  assert.equal(await countOf(page, 'home-restore'), 1);
  assert.deepEqual(await counted(s, page), [
    { name: 'pageview', path: '/' },
    { name: 'Unlock', path: '/', value: 'cancelled' },
  ]);
});

// -- Spanish --------------------------------------------------------------------------------

scenario('the Spanish routes: Home, Create and Restore in Spanish, links that stay in Spanish, and a create counted under /es', async (s) => {
  const page = await s.open('/es', { lang: 'es' });
  assert.equal(await page.page.evaluate(() => document.documentElement.lang), 'es');
  assert.equal(await page.page.title(), es.common.homeTitle);
  assert.equal(await headingOf(page), es.common.appName);
  assert.ok((await page.page.$eval('main', (main) => main.textContent ?? '')).includes(es.home.lede));
  assert.equal(await page.text('home-create'), es.wallet.gateCreate);
  assert.equal(await page.page.$eval('[data-testid="home-create"]', (link) => link.getAttribute('href')), '/es/new');
  assert.equal(await page.page.$eval('[data-testid="home-restore"]', (link) => link.getAttribute('href')), '/es/restore');
  assert.equal(
    await page.text('home-facts'),
    fill(es.home.facts, { seconds: String(s.stack.config.blockSeconds), sats: formatSats(s.stack.config.faucetSats) }),
  );

  // Restore: the exception paragraph in Spanish, its chapter in Spanish, and the line that says the words are English.
  await page.click('home-restore');
  await arrivesAt(page, '/es/restore');
  assert.equal(await headingOf(page), es.common.screen_restore);
  assert.ok((await page.text('restore-exception')).includes(es.restore.exception));
  assert.equal(
    await page.page.$eval('[data-testid="restore-exception"] a', (link) => link.getAttribute('href')),
    `${s.stack.config.siteUrl}/es/recorrido/se-tu-propio-banco`,
  );
  assert.ok((await page.text('restore-words')).includes(es.wallet.wordsEnglishType));
  assert.equal(await page.page.$eval('[data-testid="restore-check"]', (box) => box.closest('label')?.textContent?.trim()), es.restore.check);
  assert.equal(await page.text('restore-go'), es.restore.go);

  // Create: both panels in Spanish, and the passkey named as the Spanish page will name it.
  await page.page.goBack();
  await arrivesAt(page, '/es');
  await page.click('home-create');
  await arrivesAt(page, '/es/new');
  assert.equal(await headingOf(page), es.common.screen_new);
  await page.waitFor('create-passkey');
  assert.ok((await page.text('create-with-passkey')).includes(fill(es.create.passkeyAsk, { name: 'Billetera de práctica' })));
  assert.ok((await page.text('create-without-passkey')).includes(es.create.wordsKept));
  assert.equal(await page.text('create-words'), es.create.wordsGo);

  // The language switch keeps the screen.
  assert.equal(await page.page.$eval('[data-testid="lang-switch"]', (link) => link.getAttribute('href')), '/new');

  await page.click('create-words');
  await arrivesAt(page, '/es/wallet/backup');
  const record = await storedRecord(page);
  assertWordsRecord(record);
  const events = await counted(s, page);
  assert.deepEqual(on(events, '/es/new'), [
    { name: 'pageview', path: '/es/new' },
    { name: 'Wallet created', path: '/es/new', value: 'words' },
  ]);
  // Every screen was counted under its Spanish path.
  for (const event of events) assert.ok(event.path === '/es' || event.path.startsWith('/es/'), JSON.stringify(event));
  nothingPrivate(events, record);
});

// -- around a wait: the reader leaves, comes back, or something gets in the way ----------------

scenario('restore started with Enter in the last field: the button takes focus and says that the page is looking; a look that outlives its visit changes nothing on the next one', async (s) => {
  const first = freshRecord().mnemonic ?? '';
  const second = freshRecord().mnemonic ?? '';
  const page = await s.open('/');
  await page.click('home-restore');
  await arrivesAt(page, '/restore');
  await page.settle();
  const release = await holdChain(page);

  // The box first, then the words by keyboard with a space after each, and Enter in the last field.
  await page.click('restore-check');
  await page.page.focus('[data-testid="word-input"]');
  await page.page.keyboard.type(first, { delay: 5 });
  assert.deepEqual(await wordsTyped(page), first.split(' '));
  assert.equal(await focusOf(page), 'word-input');
  await page.page.keyboard.press('Enter');
  await waitsOn(page, 'restore-go');

  // While the wallet looks, the fields and the box are switched off. Focus did not fall to the page:
  // the button has it, and the button says what is going on.
  assert.equal(await focusOf(page), 'restore-go');
  assert.deepEqual(await buttonOf(page, 'restore-go'), { text: en.restore.looking, busy: true, disabled: false });
  assert.equal(await mainBusy(page), true);
  const off = await page.page.$$eval('[data-testid="word-input"], [data-testid="restore-check"]', (nodes) => nodes.map((node) => (node as HTMLInputElement).disabled));
  assert.deepEqual(off, Array.from({ length: 13 }, () => true));
  assert.deepEqual(page.statusLog(), [], 'progress is not an outcome: the status region says nothing');
  assert.equal(await page.stored(), null);

  // The reader goes Back while the look is under way, and Forward again: a new visit of the screen, with empty fields.
  await page.page.goBack();
  await arrivesAt(page, '/');
  await page.page.goForward();
  await arrivesAt(page, '/restore');
  await page.waitFor('word-input');
  assert.deepEqual(await wordsTyped(page), Array.from({ length: 12 }, () => ''));
  assert.deepEqual(await buttonOf(page, 'restore-go'), { text: en.restore.go, busy: false, disabled: false });
  await typeWords(page, second);
  const stepShown = await everShown(page, 'restore-empty', '/restore');

  // The earlier look ends now, and finds nothing. Nobody is on its visit to choose, so its words are let go.
  await release();
  await waitForEvent(s, { name: 'Restore', path: '/restore', value: 'erased' });
  await page.settle();
  // On the new visit nothing has changed: no step opened over it, the words typed since are in the fields, and focus is where it was.
  assert.equal(await stepShown(), false, 'the step "No practice coins found" never opened on the new visit');
  assert.equal(await headingOf(page), en.common.screen_restore);
  assert.deepEqual(await wordsTyped(page), second.split(' '));
  assert.equal(await focusOf(page), 'word-input');
  assert.equal(await page.stored(), null);

  // The new visit's own look opens the step, for its own words.
  await page.click('restore-check');
  await page.click('restore-go');
  await page.waitFor('restore-empty');
  assert.equal(await headingOf(page), en.restore.emptyTitle);
  await page.click('restore-keep');
  await arrivesAt(page, '/wallet');
  assertWordsRecord(await storedRecord(page), second);
  assert.deepEqual(
    on(await counted(s, page), '/restore').filter((event) => event.name === 'Restore'),
    [
      { name: 'Restore', path: '/restore', value: 'erased' },
      { name: 'Restore', path: '/restore', value: 'kept' },
    ],
  );
});

scenario('"Restore" pressed again on a new visit while an earlier look is still under way: the fields keep their words until this visit\'s own look ends', async (s) => {
  const first = freshRecord().mnemonic ?? '';
  const second = freshRecord().mnemonic ?? '';
  const page = await s.open('/');
  await page.click('home-restore');
  await arrivesAt(page, '/restore');
  await page.settle();
  const release = await holdChain(page);
  await typeWords(page, first);
  await page.click('restore-check');
  await page.click('restore-go');
  await waitsOn(page, 'restore-go');

  await page.page.goBack();
  await arrivesAt(page, '/');
  await page.page.goForward();
  await arrivesAt(page, '/restore');
  await typeWords(page, second);
  await page.click('restore-check');
  await page.click('restore-go');
  await waitsOn(page, 'restore-go');

  // What the screen shows from here on, each change noted: the form with how many fields hold a word, or the step.
  await page.page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    const note = (): void => {
      const fields = Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="word-input"]'));
      const step = document.querySelector('[data-testid="restore-empty"]') !== null;
      const line = step ? 'step' : `form with ${fields.filter((field) => field.value !== '').length} words`;
      if (seen.at(-1) !== line) seen.push(line);
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true });
    note();
  });

  // Both looks end, the earlier one first. Each finds nothing.
  await release();
  await page.waitFor('restore-empty');
  await page.settle();
  // The earlier look's answer did not open the step and empty the form under the second look. (It did,
  // and a failure of the second look then said that the words "are still in the fields above".)
  assert.deepEqual(await page.page.evaluate(() => (window as unknown as { __seen: string[] }).__seen), ['form with 12 words', 'step']);
  assert.equal(await headingOf(page), en.restore.emptyTitle);
  assert.equal(await page.stored(), null);
  // The words that wait are this visit's.
  await page.click('restore-keep');
  await arrivesAt(page, '/wallet');
  assertWordsRecord(await storedRecord(page), second);
});

scenario('the reader leaves Create while the passkey prompt is open and stays on Home: nothing moves under them, and the way in leads to the "Wallet made" step', async (s) => {
  const page = await s.open('/', { passkey: 'prf' });
  await page.page.bringToFront();
  await page.click('home-create');
  await arrivesAt(page, '/new');
  await page.waitFor('create-passkey');
  const release = await holdPrompt(page, 'create');
  await page.click('create-passkey');
  await waitsOn(page, 'create-passkey');
  // While the prompt is open: <main> is busy, the button says what it waits for, and the other way is switched off.
  assert.equal(await mainBusy(page), true);
  assert.deepEqual(await buttonOf(page, 'create-passkey'), { text: en.create.passkeyBusy, busy: true, disabled: false });
  assert.equal((await buttonOf(page, 'create-words')).disabled, true);

  await page.page.goBack();
  await arrivesAt(page, '/');
  assert.equal(await release(), 1);
  // The wallet is made, and Home shows it. The reader is not taken anywhere.
  await page.waitFor('wallet-here');
  await page.settle();
  assert.equal(await pathOf(page), '/');
  const record = await storedRecord(page);
  assert.ok(record !== null && record.kind === 'passkey');
  assert.equal(await page.text('wallet-here-kind'), fill(en.home.herePasskeyTagged, { tag: record.tag ?? '' }));
  // Its 12 words have not been shown yet, so "Open my practice wallet" leads to the step that shows them.
  assert.equal(await page.page.$eval('[data-testid="wallet-open"]', (link) => link.getAttribute('href')), '/wallet/backup');
  await page.click('wallet-open');
  await arrivesAt(page, '/wallet/backup');
  // The "Wallet made" step shows the 12 words at once, and that is counted under its own screen.
  await page.settle();
  assert.deepEqual(
    (await counted(s, page)).filter((event) => event.name !== 'pageview'),
    [
      { name: 'Passkey', path: '/', value: 'ok' },
      { name: 'Wallet created', path: '/', value: 'passkey' },
      { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
    ],
  );
});

scenario('the reader is back on Create when the passkey prompt answers: on to the "Wallet made" step, and never told to remove the wallet they have just made', async (s) => {
  const page = await s.open('/', { passkey: 'prf' });
  await page.page.bringToFront();
  await page.click('home-create');
  await arrivesAt(page, '/new');
  await page.waitFor('create-passkey');
  const release = await holdPrompt(page, 'create');
  await page.click('create-passkey');
  await waitsOn(page, 'create-passkey');
  await page.page.goBack();
  await arrivesAt(page, '/');
  await page.page.goForward();
  await arrivesAt(page, '/new');
  await page.waitFor('create-passkey');

  // A new visit of the screen: its buttons can be pressed, and a tap is told that a prompt is still open.
  await page.click('create-words');
  await page.waitFor('create-problem');
  assert.ok((await page.text('create-problem')).includes(en.errors.passkey_busy));
  assert.equal(await page.stored(), null);

  assert.equal(await release(), 1);
  await arrivesAt(page, '/wallet/backup');
  const record = await storedRecord(page);
  assert.ok(record !== null && record.kind === 'passkey');
  assert.equal((await page.passkey!.credentials()).length, 1);
  // "Wallet made" took Create's place in the history: Back leads to Home.
  await page.page.goBack();
  await arrivesAt(page, '/');
  await page.waitFor('wallet-here');
});

scenario('the reader leaves Home while "Open with my passkey" waits: the wallet is opened, and they stay where they went', async (s) => {
  const { page, made } = await madeThenCleared(s, false);
  const release = await holdPrompt(page, 'get');
  await page.click('open-passkey');
  await waitsOn(page, 'open-passkey');
  await page.page.click('main a[href="/about"]');
  await arrivesAt(page, '/about');
  const about = await headingOf(page);

  assert.equal(await release(), 1);
  await page.page.waitForFunction((key) => localStorage.getItem(key) !== null, {}, RECORD_KEY);
  await page.settle();
  // The wallet is in this browser, and the page did not change under the reader.
  assertPasskeyRecord(await storedRecord(page), made.credentialId ?? '');
  assert.equal(await pathOf(page), '/about');
  assert.equal(await headingOf(page), about);
  // Home shows it, by the tag of its passkey. It was opened, not made here: the way in leads to the overview.
  await goHome(page);
  await page.waitFor('wallet-here');
  assert.equal(await page.text('wallet-here-kind'), fill(en.home.herePasskeyTagged, { tag: made.tag ?? '' }));
  assert.equal(await page.page.$eval('[data-testid="wallet-open"]', (link) => link.getAttribute('href')), '/wallet');
});

scenario('two tabs: a wallet arrives while this tab\'s passkey prompt is open. The answer is said, with what became of the passkey', async (s) => {
  const first = await s.open('/new', { passkey: 'prf' });
  const second = await s.open('/new', { context: first.context });
  await first.page.bringToFront();
  await first.waitFor('create-passkey');
  const release = await holdPrompt(first, 'create');
  await first.click('create-passkey');
  await waitsOn(first, 'create-passkey');

  await second.page.bringToFront();
  await second.click('create-words');
  await arrivesAt(second, '/wallet/backup');
  const record = await storedRecord(second);
  assertWordsRecord(record);

  // The first tab has heard of the wallet. It holds still while its own prompt is open.
  await first.page.bringToFront();
  await first.page.waitForFunction((key) => localStorage.getItem(key) !== null, {}, RECORD_KEY);
  assert.equal(await countOf(first, 'wallet-here'), 0);
  assert.equal((await buttonOf(first, 'create-passkey')).busy, true);

  // The reader finishes the prompt: a passkey is saved, and no wallet can be made for it here.
  assert.equal(await release(), 1);
  await first.waitFor('front-stop');
  assert.equal(await first.text('front-stop'), en.home.hereArrived);
  assert.equal(await first.page.$eval('[data-testid="front-stop"]', (notice) => notice.getAttribute('role')), 'alert');
  assert.equal(await first.text('wallet-here-kind'), en.home.hereWords);
  assert.equal(await first.text('create-orphan'), en.create.orphan);
  for (const hook of ['create-passkey', 'create-words', 'finish-setup']) assert.equal(await countOf(first, hook), 0, hook);
  await first.page.waitForFunction(() => document.activeElement?.tagName === 'H1');
  assert.equal(await pathOf(first), '/new');
  // The other tab's wallet is untouched, and the page told the password manager that the new passkey is of no use.
  assert.equal(await first.stored(), JSON.stringify(record));
  assert.deepEqual(await first.passkey!.credentials(), []);
  assert.equal(s.stack.events.filter((recorded) => recorded.event.name === 'Wallet created').length, 1);
});

scenario('the browser stops storing while the passkey prompt is open: nothing is made, it is said as an alert, with what became of the passkey', async (s) => {
  const page = await s.open('/new', { passkey: 'prf' });
  await page.page.bringToFront();
  await page.waitFor('create-passkey');
  const release = await holdPrompt(page, 'create');
  await page.click('create-passkey');
  await waitsOn(page, 'create-passkey');
  await refuseWrites(page);

  assert.equal(await release(), 1);
  await page.waitFor('front-stop');
  const said = await page.text('front-stop');
  assert.ok(said.includes(en.wallet.noStorage), said);
  assert.ok(said.includes(en.create.orphan), said);
  assert.equal(await page.text('create-orphan'), en.create.orphan);
  // It answers a tap, so it is called out. (The same words are not, where the screen opens with them.)
  assert.equal(await page.page.$eval('[data-testid="front-stop"]', (notice) => notice.getAttribute('role')), 'alert');
  for (const hook of ['create-passkey', 'create-words', 'finish-setup']) assert.equal(await countOf(page, hook), 0, hook);
  await page.page.waitForFunction(() => document.activeElement?.tagName === 'H1');
  assert.equal(await page.stored(), null);
  assert.deepEqual(await page.passkey!.credentials(), [], 'the passkey has no wallet, and the password manager was told so');
  assert.deepEqual(await counted(s, page), [
    { name: 'pageview', path: '/new' },
    { name: 'Passkey', path: '/new', value: 'ok' },
  ]);
});

scenario('two tabs: a wallet arrives while Restore is looking. The look\'s answer is said, and nothing is restored over it', async (s) => {
  const first = await s.open('/restore');
  const second = await s.open('/new', { context: first.context });
  await first.page.bringToFront();
  await first.settle();
  const release = await holdChain(first);
  await typeWords(first, freshRecord().mnemonic ?? '');
  await first.click('restore-check');
  await first.click('restore-go');
  await waitsOn(first, 'restore-go');

  await second.page.bringToFront();
  await second.click('create-words');
  await arrivesAt(second, '/wallet/backup');
  const record = await storedRecord(second);
  assertWordsRecord(record);

  // The first tab has heard of the wallet. It holds still while its look is under way.
  await first.page.bringToFront();
  await first.page.waitForFunction((key) => localStorage.getItem(key) !== null, {}, RECORD_KEY);
  assert.equal(await countOf(first, 'wallet-here'), 0);
  assert.equal((await buttonOf(first, 'restore-go')).busy, true);

  await release();
  await first.waitFor('front-stop');
  assert.equal(await first.text('front-stop'), en.home.hereArrived);
  assert.equal(await first.page.$eval('[data-testid="front-stop"]', (notice) => notice.getAttribute('role')), 'alert');
  assert.equal(await first.text('wallet-here-kind'), en.home.hereWords);
  for (const hook of ['word-input', 'restore-check', 'restore-go', 'restore-empty']) assert.equal(await countOf(first, hook), 0, hook);
  await first.page.waitForFunction(() => document.activeElement?.tagName === 'H1');
  assert.equal(await pathOf(first), '/restore');
  assert.equal(await first.stored(), JSON.stringify(record));
  assert.deepEqual(
    s.stack.events.map((recorded) => recorded.event).filter((event) => event.name === 'Restore'),
    [],
  );
});

scenario('the browser stops storing while Restore is looking: words that have coins are not stored, and it is said as an alert', { localOnly: true }, async (s) => {
  fundTestWallet(s.standIn);
  const page = await s.open('/restore');
  await page.settle();
  const release = await holdChain(page);
  await typeWords(page, TEST_WORDS);
  await page.click('restore-check');
  await page.click('restore-go');
  await waitsOn(page, 'restore-go');
  await refuseWrites(page);

  await release();
  await page.waitFor('front-stop');
  assert.ok((await page.text('front-stop')).includes(en.wallet.noStorage));
  assert.equal(await page.page.$eval('[data-testid="front-stop"]', (notice) => notice.getAttribute('role')), 'alert');
  for (const hook of ['word-input', 'restore-check', 'restore-go', 'restore-empty', 'wallet-here']) assert.equal(await countOf(page, hook), 0, hook);
  await page.page.waitForFunction(() => document.activeElement?.tagName === 'H1');
  assert.equal(await pathOf(page), '/restore');
  assert.equal(await page.stored(), null);
  assert.deepEqual(await counted(s, page), [{ name: 'pageview', path: '/restore' }]);
});

scenario('when what stands in a screen\'s place changes and the address does not, focus goes to the heading', async (s) => {
  // Something stored that cannot be read is removed on Restore: the form takes the gate's place.
  const page = await s.open('/restore', { record: 'not a record' });
  await page.click('remove-wallet');
  await page.click('remove-confirm');
  await page.waitFor('restore-go');
  await page.page.waitForFunction(() => document.activeElement?.tagName === 'H1');
  assert.equal(await page.stored(), null);
  assert.ok((await page.page.$eval('main', (main) => main.textContent ?? '')).includes(en.restore.lede));

  // The wallet that stopped Create is removed in another tab: Create's two ways take its place.
  const first = await s.open('/new', { record: testRecord() });
  const second = await s.open('/about', { context: first.context });
  await first.waitFor('wallet-here');
  await second.store(RECORD_KEY, null);
  await first.waitFor('create-words');
  await first.page.waitForFunction(() => document.activeElement?.tagName === 'H1');
  assert.ok((await first.page.$eval('main', (main) => main.textContent ?? '')).includes(en.create.lede));
});

scenario('until the browser has said whether it offers passkeys, the button waits switched off, and the reason stands in a line of its own', async (s) => {
  const page = await s.open('/about');
  // The browser takes its time to say what it can do: the answer is held until the scenario lets it go.
  await page.page.evaluateOnNewDocument(() => {
    const held: (() => void)[] = [];
    (window as unknown as { __capabilities: (() => void)[] }).__capabilities = held;
    const browser = PublicKeyCredential as unknown as { getClientCapabilities: () => Promise<Record<string, boolean>> };
    const real = browser.getClientCapabilities.bind(PublicKeyCredential);
    browser.getClientCapabilities = () =>
      new Promise((resolve, reject) => {
        held.push(() => void real().then(resolve, reject));
      });
  });
  await page.goto('/new');
  await page.waitFor('create-checking');

  // The button is switched off under its own name. Why, is said beside it in text that is not faded.
  assert.deepEqual(await buttonOf(page, 'create-passkey'), { text: en.create.passkeyGo, busy: false, disabled: true });
  assert.equal(await page.text('create-checking'), en.create.passkeyChecking);
  const faded = await page.page.$$eval('[data-testid="create-passkey"], [data-testid="create-checking"]', (nodes) => nodes.map((node) => getComputedStyle(node).opacity));
  assert.deepEqual(faded, ['0.5', '1']);
  // The other way does not wait for the answer.
  assert.equal((await buttonOf(page, 'create-words')).disabled, false);

  await page.page.evaluate(() => {
    for (const go of (window as unknown as { __capabilities: (() => void)[] }).__capabilities.splice(0)) go();
  });
  await page.waitForGone('create-checking');
  assert.deepEqual(await buttonOf(page, 'create-passkey'), { text: en.create.passkeyGo, busy: false, disabled: false });
});

for (const lang of ['en', 'es'] as const) {
  const prefix = lang === 'es' ? '/es' : '';
  const t = strings.create[lang];
  scenario(`on a small phone (${lang}): what a dismissed follow-up prompt, and then a passkey without the secret, are answered with starts on the screen`, async (s) => {
    const page = await s.open(`${prefix}/new`, { passkey: 'no-prf', width: 320, height: 568, lang });
    await page.page.bringToFront();
    await page.waitFor('create-passkey');
    await refuseNextGet(page);
    await page.click('create-passkey');
    await page.waitFor('finish-setup');
    await focusArrivesAt(page, 'finish-setup');

    // The line that says a passkey was saved and is waiting is the whole answer: it is on the screen from
    // its first word, under the banner, with the button it leads to. (Its last line alone used to show.)
    const waiting = await placeOf(page, 'create-unfinished');
    assert.ok(waiting.top >= waiting.banner && waiting.top < waiting.height / 2, JSON.stringify(waiting));
    const tag = /"([^"]+)"/.exec(await page.text('create-unfinished'))?.[1] ?? '';
    assert.match(tag, TAG);
    assert.equal(await page.text('create-unfinished'), fill(t.unfinishedTagged, { tag }));

    // "Finish setting up" is answered by a passkey that has no secret to give. The wallet gives that
    // passkey up, so the pressed button is gone and "Create with a passkey" is back, with focus.
    await page.click('finish-setup');
    await page.waitFor('create-problem');
    await focusArrivesAt(page, 'create-passkey');
    assert.equal(await countOf(page, 'finish-setup'), 0);
    // The notice is taller than this screen. It is its start, the cause, that shows. (Focus on the button
    // under it used to scroll the cause away.)
    const problem = await placeOf(page, 'create-problem');
    assert.ok(problem.top >= problem.banner && problem.top < problem.height / 2, JSON.stringify(problem));
    assert.ok((await page.text('create-problem')).includes(strings.errors[lang]['passkey_no-prf']));
    // The password manager has been told to drop the passkey, and here it did. What the page says holds
    // either way: it sends nobody looking for a passkey that is gone.
    assert.deepEqual(await page.passkey!.credentials(), []);
    assert.equal(await page.text('create-delete-passkey'), fill(t.noPrfDeleteTagged, { host: 'localhost', tag }));
    assert.equal(await page.sidewaysScroll(), 0);
  });
}

scenario('a reload while "Finish setting up" waits: the page no longer knows the passkey, as it said it would; the passkey is not lost, "Open with my passkey" makes its wallet', async (s) => {
  const page = await s.open('/new', { passkey: 'prf-at-get' });
  await page.page.bringToFront();
  await page.waitFor('create-passkey');
  await refuseNextGet(page);
  await page.click('create-passkey');
  await page.waitFor('finish-setup');
  // Said while the passkey waits: finish before a reload.
  assert.match(await page.text('create-unfinished'), /before you reload or close this page/);
  const saved = await page.passkey!.credentials();
  assert.equal(saved.length, 1);

  await page.page.reload({ waitUntil: 'load' });
  await page.waitFor('create-passkey');
  assert.equal(await countOf(page, 'finish-setup'), 0);
  assert.equal(await countOf(page, 'create-unfinished'), 0);
  assert.deepEqual((await page.passkey!.credentials()).map((passkey) => passkey.id), [saved[0]!.id], 'the passkey is still with its provider');
  assert.equal(await page.stored(), null);

  // It can still make its wallet: Home, "Open with my passkey". No second passkey is needed.
  await page.goto('/');
  await page.page.bringToFront();
  await page.click('open-passkey');
  await arrivesAt(page, '/wallet');
  assertPasskeyRecord(await storedRecord(page), saved[0]!.id);
  assert.equal((await page.passkey!.credentials()).length, 1);
});
