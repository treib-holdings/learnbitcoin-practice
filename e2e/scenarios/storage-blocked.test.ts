// A browser that will not let the page read its storage, through the real
// screens.
//
// A reader gets there with one ordinary setting of the browser: they make a
// wallet, and then tell the browser not to let sites save data. Chrome then
// refuses the page every look at its storage (the mere mention of
// `localStorage` throws) and deletes nothing: the wallet's record, with the
// 12 words of a wallet kept with them, and the note of the "Do it" steps
// are still on the disk, and are back the moment the block is lifted.
//
// A page in that browser has not seen that nothing is kept. It has seen
// nothing. So no screen may say "this browser has no practice wallet",
// "nothing", or "not started": each says that it cannot tell, or says
// nothing. Three scenarios:
//
//   1. the state reached the way a reader reaches it: one Chrome profile,
//      closed and opened again three times. A wallet is made on the Create
//      screen and a step is opened; then site data is blocked with Chrome's
//      own setting, and every screen is read in both languages; then the
//      block is lifted, and everything is there as it was.
//   2. the same refusal made by a script in the page, in the two ways a
//      browser can refuse (the storage itself, or every call to it), with a
//      second tab of the same browser that may still read: what the browser
//      holds is what it held, character for character.
//   3. the refusal that begins while a wallet screen is open: the page
//      remembers the wallet until its tab is back in view, then says that
//      it cannot tell. The wallet is not counted as removed, and is there
//      again when the block is lifted, with no page load.
//
// None of them drives the stand-in network.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRecord } from '../../app/src/lib/keystore.ts';
import { strings } from '../../app/src/strings/index.ts';
import { TEST_MADE_AT, TEST_WORDS, scenario, setSiteData, testRecord, type OpenedPage, type OwnChrome } from './helpers.ts';
import { arrivesAt, attributeOf, countOf, createFrom, headingOf, hook, until } from './journey-helpers.ts';
import { PROGRESS_KEY, noteFor, partsOf, stripOf } from './doit-helpers.ts';

type Lang = 'en' | 'es';

/** Everything the screen says, as one line. (The header, the strip and the footer are outside it.) */
const mainText = (page: OpenedPage): Promise<string> =>
  page.page.$eval('main', (main) => (main.textContent ?? '').replace(/\s+/g, ' ').trim());

/** What the page is told when it reaches for its storage: "ok", or the name of what the browser threw. */
const storageAnswers = (page: OpenedPage): Promise<string> =>
  page.page.evaluate(() => {
    try {
      window.localStorage.getItem('lbp_wallet_v1');
      return 'ok';
    } catch (error) {
      return (error as Error).name;
    }
  });

/**
 * What no screen may say of a browser it could not look into: that no
 * wallet is here, that nothing is kept, that a step was not started. (That
 * no screen offers to make a wallet beside one that may still be stored is
 * held by the buttons that must not be there: the Create screen keeps its
 * own name as its heading.)
 */
const NEVER: Record<Lang, RegExp> = {
  en: /has no practice wallet|has none right now|and there is none|Nothing\.|No practice wallet|Not started|I already have a practice wallet/,
  es: /no tiene billetera de práctica|no tiene ninguna en este momento|y no hay ninguna|Nada\.|Ninguna billetera|Sin empezar|Ya tengo una billetera de práctica/,
};

/**
 * Every screen of the app, read in a browser that refuses the page its
 * storage, in one language. `prefix` is "" or "/es".
 */
async function readEveryScreen(page: OpenedPage, lang: Lang, prefix: '' | '/es'): Promise<void> {
  const w = strings.wallet[lang];
  const about = strings.about[lang];
  const doit = strings.doit[lang];
  const where = (path: string): string => `${lang} ${path}`;
  /** Opens a path and waits for what marks its screen as drawn. */
  const open = async (path: string, wait: string): Promise<string> => {
    await page.goto(`${prefix}${path === '/' && prefix !== '' ? '' : path}`);
    await page.waitFor(wait);
    const said = await mainText(page);
    assert.doesNotMatch(said, NEVER[lang], where(path));
    // No screen carries a strip: no followed step could be read.
    assert.equal(await stripOf(page), null, where(path));
    return said;
  };
  /** The wallet's own piece, as it is drawn for this state: the two sentences, and Reload. */
  const piece = async (path: string): Promise<void> => {
    assert.equal(await page.text('storage-blocked'), `${w.blockedBody} ${w.blockedWay}`, where(path));
    assert.equal(await countOf(page, 'remove-wallet'), 0, `${where(path)}: nothing is removed unseen`);
  };

  // -- About, "In this browser right now": not known, and nothing else. --
  await open('/about', 'about-kept-now');
  assert.deepEqual(
    [await attributeOf(page, 'about-kept-now', 'data-kept'), await attributeOf(page, 'about-kept-now', 'data-note')],
    ['blocked', 'blocked'],
    where('/about'),
  );
  assert.equal(await page.text('about-kept-now'), `${about.keepNowLabel} ${about.keepNowBlocked}`, where('/about'));
  assert.equal(await countOf(page, 'about-kept-note'), 0, where('/about'));

  // -- Home: the wallet's own piece. None of the ways in for a browser with no wallet. --
  const home = await open('/', 'storage-blocked');
  assert.ok(home.includes(w.blockedTitle), where('/'));
  await piece('/');
  for (const absent of ['home-create', 'home-have', 'home-restore', 'open-passkey', 'wallet-here', 'home-removed']) {
    assert.equal(await countOf(page, absent), 0, `${where('/')}: ${absent}`);
  }

  // -- A wallet screen: the gate, under a heading of its own. Never the gate for "no wallet". --
  for (const path of ['/wallet', '/wallet/settings', '/wallet/backup']) {
    await open(path, 'storage-blocked');
    assert.equal(await headingOf(page), w.blockedTitle, where(path));
    await piece(path);
    for (const absent of ['wallet-fingerprint', 'open-passkey', 'keeps', 'reveal-words']) assert.equal(await countOf(page, absent), 0, `${where(path)}: ${absent}`);
  }

  // -- Create and Restore: nothing is made beside a wallet nobody can see. --
  for (const path of ['/new', '/restore']) {
    const said = await open(path, 'storage-blocked');
    assert.ok(said.includes(w.blockedTitle), where(path));
    await piece(path);
    for (const absent of ['create-passkey', 'create-words', 'finish-setup', 'word-input', 'restore-go', 'front-stop']) {
      assert.equal(await countOf(page, absent), 0, `${where(path)}: ${absent}`);
    }
  }

  // -- The Sparrow guide, step 5: the page cannot tell whether a wallet is here to bring. --
  await open('/sparrow', 'sparrow-need-wallet');
  assert.equal(await attributeOf(page, 'sparrow-need-wallet', 'data-state'), 'blocked', where('/sparrow'));
  assert.ok((await page.text('sparrow-need-wallet')).startsWith(strings.sparrow[lang].needBlocked), where('/sparrow'));
  assert.equal(await countOf(page, 'sparrow-need-link'), 0, `${where('/sparrow')}: no link to the start page, where a wallet is made`);

  // -- The list of steps: the notice, the six steps, and no state for any of them. --
  await open('/do', 'do-no-read');
  assert.ok((await page.text('do-no-read')).startsWith(doit.noRead), where('/do'));
  assert.equal(await countOf(page, 'do-step-link'), 6, where('/do'));
  for (const absent of ['do-state', 'do-following', 'do-forget', 'do-no-storage', 'do-newer', 'do-forgotten']) {
    assert.equal(await countOf(page, absent), 0, `${where('/do')}: ${absent}`);
  }

  // -- A step's screen: the notice, and in the open part the wallet's own piece. Not "there is none", not
  //    "Create a practice wallet", and no done card for a step that was done in this browser. --
  for (const step of ['hold-some', 'the-seed', 'pass-it-on']) {
    const path = `/do/${step}`;
    await open(path, 'step-parts');
    assert.ok((await page.text('do-no-read')).startsWith(doit.noRead), where(path));
    const parts = await partsOf(page);
    assert.equal(parts[0], 'blocked', where(path));
    assert.ok(parts.slice(1).every((state) => state === 'later'), `${where(path)}: ${parts.join(', ')}`);
    assert.equal(await page.page.$eval(`${hook('step-open')} ${hook('storage-blocked')}`, (node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim()), `${w.blockedBody} ${w.blockedWay}`, where(path));
    for (const absent of ['step-need', 'step-action', 'step-done', 'step-restart', 'do-no-storage']) assert.equal(await countOf(page, absent), 0, `${where(path)}: ${absent}`);
  }
}

// -- 1. the way a reader gets there ------------------------------------------------------------------

scenario(
  'Site data blocked in the browser after a wallet was made, by Chrome\'s own setting on one profile closed and opened again: no screen says "no practice wallet", "nothing" or "not started" in either language, each says that the page cannot tell or says nothing, and when the block is lifted the wallet with its 12 words and the note of the steps are there as they were',
  { timeout: 300_000 },
  async (s) => {
    const { en } = strings.about;
    const profile = await mkdtemp(join(tmpdir(), 'lbp-own-profile-'));
    let chrome: OwnChrome | null = null;
    try {
      // -- As it comes: a wallet is made without a passkey on the Create screen, and a step is opened. --
      chrome = await s.chromeOn(profile);
      let page = await chrome.open('/new', { timeout: 30_000 });
      const made = await createFrom(page, 'create-words');
      await page.goto('/do/the-seed');
      await page.waitFor('step-parts');
      const stored = { record: await page.stored(), note: await page.stored(PROGRESS_KEY) };
      assert.ok(stored.record !== null && stored.record.includes(made.words.join(' ')), 'the record holds the 12 words, as plain text');
      assert.ok(stored.note !== null && stored.note.includes('"the-seed"'), 'a note of the steps is stored');
      await page.goto('/about');
      await page.waitFor('about-kept-now');
      const before = await page.text('about-kept-now');
      assert.equal(before, `${en.keepNowLabel} ${en.keepNowWords} ${en.noteAlsoNow}`);
      await chrome.close();

      // -- The reader tells Chrome not to let sites save data, and opens the page again. --
      await until(() => existsSync(join(profile, 'Default', 'Preferences')), 'Chrome has written its preferences');
      setSiteData(profile, 'block');
      chrome = await s.chromeOn(profile);
      page = await chrome.open('/about', { timeout: 30_000 });
      await page.waitFor('about-kept-now');
      // The browser refuses the page the mere mention of its storage. (If this ever stops being so, the
      // setting was not taken, and what follows would prove nothing.)
      assert.equal(await storageAnswers(page), 'SecurityError', 'Chrome refuses the page its storage');
      assert.equal(await page.text('about-kept-now'), `${en.keepNowLabel} ${en.keepNowBlocked}`);
      // The sentence, word for word.
      assert.equal(
        await page.text('about-kept-now'),
        'In this browser right now Not known. This browser did not let this page read what it may have stored here, so the page cannot tell what is kept. A wallet or a note stored here before may still be kept.',
      );
      await readEveryScreen(page, 'en', '');
      await readEveryScreen(page, 'es', '/es');
      await page.goto('/es/about');
      await page.waitFor('about-kept-now');
      assert.equal(
        await page.text('about-kept-now'),
        'En este navegador, ahora mismo No se sabe. Este navegador no dejó que esta página leyera lo que pueda tener guardado aquí, así que la página no puede saber qué hay guardado. Una billetera o una nota guardadas aquí antes pueden seguir guardadas.',
      );
      await chrome.close();

      // -- The block is lifted: the wallet, with its 12 words, and the note are there, character for character. --
      setSiteData(profile, 'allow');
      chrome = await s.chromeOn(profile);
      page = await chrome.open('/about', { timeout: 30_000 });
      await page.waitFor('about-kept-now');
      assert.equal(await storageAnswers(page), 'ok');
      assert.deepEqual({ record: await page.stored(), note: await page.stored(PROGRESS_KEY) }, stored, 'blocking deleted nothing, and the page wrote nothing meanwhile');
      assert.equal(await page.text('about-kept-now'), before);
      await page.goto('/wallet');
      await page.waitFor('wallet-fingerprint');
      assert.equal(await page.text('wallet-fingerprint'), made.record.fingerprint);
      await page.goto('/do');
      await page.waitFor('do-list');
      assert.equal(await page.page.$eval(`li[data-step="the-seed"] ${hook('do-state')}`, (state) => state.getAttribute('data-state')), 'started');
      await chrome.close();
    } finally {
      // Chrome first, also after a failure halfway: while it is open it writes into the folder, and once more
      // when it is closed.
      await chrome?.close().catch(() => {});
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
);

// -- 2. the same refusal, made in the page, in the two ways a browser can refuse ----------------------

/** A note with a step done, one under way and followed: what a page that could read would show. */
const NOTE = noteFor({
  following: 'pass-it-on',
  followedAt: Date.now(),
  steps: {
    'hold-some': { started: true, doneAt: Date.now() - 86_400_000, parts: { 1: true, 2: true, 3: true, 4: true } },
    'pass-it-on': { started: true, parts: { 1: true } },
  },
});

for (const how of ['the storage itself is refused', 'every call to the storage is refused'] as const) {
  for (const kind of ['words', 'passkey'] as const) {
    scenario(
      `A wallet ${kind === 'words' ? 'kept with its 12 words' : 'opened with a passkey'} and a note of the steps are stored, and then ${how}: every screen says that the page cannot tell, in both languages, and a second tab that may still read finds both as they were`,
      { timeout: 200_000 },
      async (s) => {
        const record =
          kind === 'words' ? testRecord() : makeRecord('passkey', TEST_WORDS, TEST_MADE_AT, { credentialId: 'QUJDREVGR0g', tag: 'K7Q2' });
        const page = await s.open('/robots.txt', { record, storage: { [PROGRESS_KEY]: NOTE }, timeout: 30_000 });
        // A second tab of the same browser, on a page that is not the app: it can read what the browser holds.
        const watcher = await s.open('/robots.txt', { context: page.context });
        const held = async (): Promise<{ record: string | null; note: string | null; keys: string[] }> => ({
          record: await watcher.stored(),
          note: await watcher.stored(PROGRESS_KEY),
          keys: await watcher.page.evaluate(() => Object.keys(localStorage).sort()),
        });
        const before = await held();
        assert.deepEqual(before, { record: JSON.stringify(record), note: NOTE, keys: [PROGRESS_KEY, 'lbp_wallet_v1'].sort() });

        // From the next page load on, the first tab is refused its storage.
        await page.page.evaluateOnNewDocument((mode: string) => {
          const refuse = (): never => {
            throw new DOMException("Failed to read the 'localStorage' property from 'Window': Access is denied for this document.", 'SecurityError');
          };
          if (mode === 'the storage itself is refused') {
            Object.defineProperty(window, 'localStorage', { configurable: true, get: refuse });
          } else {
            for (const name of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) {
              (Storage.prototype as unknown as Record<string, unknown>)[name] = refuse;
            }
          }
        }, how);
        await page.goto('/about');
        await page.waitFor('about-kept-now');
        assert.equal(await storageAnswers(page), 'SecurityError');
        await readEveryScreen(page, 'en', '');
        await readEveryScreen(page, 'es', '/es');

        // What the browser holds is what it held: nothing was written, and nothing removed.
        assert.deepEqual(await held(), before);
        // And nothing was counted that the page could not know: no wallet was made, opened or removed, no step done.
        await page.settle();
        await s.stack.settled();
        assert.deepEqual(
          s.stack.events.filter(({ event }) => event.name !== 'pageview').map(({ event }) => event.name),
          [],
        );
      },
    );
  }
}

// -- 3. the refusal begins while a wallet screen is open -------------------------------------------------

scenario(
  'The browser stops letting the page read its storage while a wallet screen is open: the page remembers the wallet until its tab is back in view, then says that it cannot tell whether a wallet is here; the wallet is not counted as removed, and is there again, with no page load, when the block is lifted',
  { timeout: 150_000 },
  async (s) => {
    const w = strings.wallet.en;
    const record = testRecord();
    const page = await s.open('/wallet', { record, timeout: 30_000 });
    await page.waitFor('wallet-fingerprint');
    assert.equal(await page.text('wallet-fingerprint'), record.fingerprint);
    // A second tab of the same browser comes to the front: the first one lies hidden.
    const tab = await s.open('/robots.txt', { context: page.context });
    await tab.page.bringToFront();

    // The browser stops letting the first tab's page look. (Made in the page, for this document alone: the
    // second tab can still read what the browser holds.)
    await page.page.evaluate(() => {
      const names = ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const;
      const real: Record<string, unknown> = {};
      for (const name of names) {
        real[name] = Storage.prototype[name];
        (Storage.prototype as unknown as Record<string, unknown>)[name] = (): never => {
          throw new DOMException('Access is denied for this document.', 'SecurityError');
        };
      }
      (window as unknown as { __realStorage: Record<string, unknown> }).__realStorage = real;
    });
    // Until the page looks again, it remembers the wallet.
    assert.equal(await page.text('wallet-fingerprint'), record.fingerprint);
    const loads = page.responses.filter((response) => response.type === 'document').length;

    // The reader comes back to the tab: the page looks, is refused, and says that it cannot tell.
    await page.page.bringToFront();
    await until(async () => (await headingOf(page)) === w.blockedTitle, 'the gate says that the page cannot tell');
    assert.equal(await page.text('storage-blocked'), `${w.blockedBody} ${w.blockedWay}`);
    assert.equal(await countOf(page, 'wallet-fingerprint'), 0);
    assert.doesNotMatch(await mainText(page), NEVER.en);
    // Nothing was removed, and nothing is counted as removed.
    assert.equal(await tab.stored(), JSON.stringify(record));
    await page.settle();
    await s.stack.settled();
    assert.deepEqual(
      s.stack.events.filter(({ event }) => event.name === 'Wallet removed').map(({ event }) => event.name),
      [],
    );

    // The block is lifted, and the reader comes back to the tab once more: the wallet is there, as it was.
    await tab.page.bringToFront();
    await page.page.evaluate(() => {
      const real = (window as unknown as { __realStorage: Record<string, unknown> }).__realStorage;
      for (const [name, method] of Object.entries(real)) (Storage.prototype as unknown as Record<string, unknown>)[name] = method;
    });
    await page.page.bringToFront();
    await page.waitFor('wallet-fingerprint');
    assert.equal(await page.text('wallet-fingerprint'), record.fingerprint);
    assert.equal(await countOf(page, 'storage-blocked'), 0);
    assert.equal(page.responses.filter((response) => response.type === 'document').length, loads, 'no page was loaded for any of it');
    assert.equal(await tab.stored(), JSON.stringify(record));
    await arrivesAt(page, '/wallet');
  },
);
