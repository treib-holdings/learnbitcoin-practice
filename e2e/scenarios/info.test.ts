// The two screens a reader reads: the Sparrow guide (/sparrow) and About
// (/about), in English and Spanish, against the real engine and the Worker's
// real handler.
//
// Neither screen does anything to a wallet, so what is proved here is what
// they show and whether it is true of the run they are shown in:
//
//   - the settings on screen are this run's own (every scenario runs on
//     settings that are not the built-in ones, so a value typed into a
//     sentence would show as the wrong value);
//   - the sentences SPEC section 12 gives word for word are there;
//   - both screens work with no wallet in the browser and with one;
//   - a copy button copies exactly the line beside it, and a refused copy
//     leaves the value whole;
//   - both screens follow the wallet when another tab changes it;
//   - no line says "off" while the settings that may say "on" are on their way;
//   - and what About says of the browser's storage, of the Worker's log and
//     of what is counted is what this run really stored, logged and sent on.
//
// None of them drives the stand-in network, so all of them run against a
// real practice network as well. They only read: the settings, a wallet's
// addresses, and never the faucet.

import assert from 'node:assert/strict';
import { EVENTS, eventPaths } from '@learnbitcoin/practice-contract';
import { accountDescriptor } from '@learnbitcoin/practice-wallet';
import { makeForwardEvent } from '@learnbitcoin/practice-worker';
import { RECORD_KEY, makeRecord } from '../../app/src/lib/keystore.ts';
import { OTHER_WORDS, TEST_MADE_AT, TEST_WORDS, scenario, testRecord, type OpenedPage, type ScenarioOptions } from './helpers.ts';

// -- this run's settings ----------------------------------------------------------------

/** Settings that are none of the built-in ones. The screens must show these. */
const RUN = {
  ELECTRUM_HOST: 'electrum.practice.test',
  ELECTRUM_PORT: '60002',
  EXPLORER_URL: 'https://explorer.practice.test',
  BLOCK_SECONDS: '45',
  FAUCET_SATS: '25000',
} as const;

const ON_RUN: ScenarioOptions = { stack: { vars: RUN } };

/** The same, with the two settings a deploy may leave empty: no counting, and no bot check, so the faucet is closed. */
const BOTH_OFF: ScenarioOptions = { stack: { vars: { ...RUN, PLAUSIBLE_DOMAIN: '', TURNSTILE_SITE_KEY: '' } } };

/** The three commands, typed out here a second time: what a reader must end up with on the clipboard. */
const COMMANDS = {
  macos: 'open -a Sparrow --args -n regtest',
  windows: 'Sparrow.exe -n regtest',
  linux: 'Sparrow/bin/Sparrow -n regtest',
} as const;

const REAL_NETWORK = {
  en: "If they start bc1, Sparrow is on Bitcoin's real network. Delete that wallet in Sparrow and never send bitcoin to it.",
  es: 'Si empiezan por bc1, Sparrow está en la red real de Bitcoin. Elimina esa billetera en Sparrow y nunca le envíes bitcoin.',
} as const;

// -- small helpers ------------------------------------------------------------------------

/** Waits until `check` holds, looking again every 50 ms, for five seconds at most. */
async function eventually(what: string, check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`still not so after 5 s: ${what}`);
    await new Promise((wake) => setTimeout(wake, 50));
  }
}

/**
 * Waits until the element with this test hook shows `text`. A screen is
 * drawn at once with the built-in settings, and with this run's as soon as
 * the Worker has answered, so a setting is waited for, not read at once.
 */
async function shows(page: OpenedPage, testid: string, text: string): Promise<void> {
  let last = '';
  try {
    await eventually(`${testid} shows ${JSON.stringify(text)}`, async () => (last = await page.text(testid)) === text);
  } catch (error) {
    throw new Error(`${(error as Error).message}; it shows ${JSON.stringify(last)}`);
  }
}

/** An attribute of the first element with this test hook, or null. */
const attribute = (page: OpenedPage, testid: string, name: string): Promise<string | null> =>
  page.page.$eval(`[data-testid="${testid}"]`, (found, asked) => found.getAttribute(asked), name);

/** The same, for an element that may not be on the screen at this moment: null then, never a failure. */
const attributeNow = (page: OpenedPage, testid: string, name: string): Promise<string | null> =>
  page.page.$$eval(`[data-testid="${testid}"]`, (found, asked) => found[0]?.getAttribute(asked) ?? null, name);

/** The screen's heading, and the language the document says it is in. */
const heading = (page: OpenedPage): Promise<{ h1: string; lang: string; title: string }> =>
  page.page.evaluate(() => ({
    h1: (document.querySelector('main h1')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    lang: document.documentElement.lang,
    title: document.title,
  }));

/** The path in the address bar. */
const pathOf = (page: OpenedPage): string => new URL(page.page.url()).pathname;

/** How many times this page has been loaded: a move between screens inside the app loads nothing. */
const loadsOf = (page: OpenedPage): number => page.responses.filter((response) => response.type === 'document').length;

/**
 * The places on the screen where one of `needles` is cut in two by the end
 * of a line: the menu arrow as a hyphen at the end of one line and ">" at
 * the start of the next, the flag as "-" and "n regtest". Each character of
 * a needle is asked where it stands, so the answer does not depend on how
 * the screen marks the text up. Commands in their own boxes are left out:
 * a long command may break at a space there.
 */
const cutAtLineEnd = (page: OpenedPage, needles: readonly string[]): Promise<string[]> =>
  page.page.evaluate((wanted) => {
    const cut: string[] = [];
    const main = document.querySelector('main');
    if (main === null) return ['no main'];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.parentElement?.closest('pre')) continue;
      const text = node.textContent ?? '';
      for (const needle of wanted) {
        for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
          const tops = new Set<number>();
          for (let k = 0; k < needle.length; k += 1) {
            if (needle[k] === ' ') continue;
            const range = document.createRange();
            range.setStart(node, at + k);
            range.setEnd(node, at + k + 1);
            tops.add(Math.round(range.getBoundingClientRect().top));
          }
          if (tops.size > 1) cut.push(`${needle} in "${text.slice(Math.max(0, at - 20), at + needle.length + 12)}"`);
        }
      }
    }
    return cut;
  }, needles);

/** The things on the Sparrow guide that must never be cut in two by the end of a line. */
const WHOLE = ['->', '-n regtest', "m/84'/1'/0'"] as const;

/** The labels of Sparrow's that the page marks as English a browser must not translate, in page order. */
const sparrowLabels = (page: OpenedPage): Promise<string[]> =>
  page.page.$$eval('main strong[lang="en"][translate="no"]', (found) => found.map((each) => (each.textContent ?? '').replace(/\s+/g, ' ')));

/** How many lines the element with this test hook is drawn on. */
const linesOf = (page: OpenedPage, testid: string): Promise<number> =>
  page.page.$eval(`[data-testid="${testid}"]`, (found) =>
    Math.round(found.getBoundingClientRect().height / parseFloat(getComputedStyle(found).lineHeight)),
  );

/** The text of the whole screen, with runs of white space read as one space. */
const screenText = (page: OpenedPage): Promise<string> =>
  page.page.$eval('main', (main) => (main.textContent ?? '').replace(/\s+/g, ' '));

/**
 * Stands in for the clipboard on this page and gives a way to read what was
 * put on it. A scenario must not touch the machine's own clipboard: other
 * runs share it, and so does whoever is sitting at the machine. What the
 * button hands to navigator.clipboard.writeText is what a browser would copy.
 */
async function recordCopies(page: OpenedPage): Promise<() => Promise<string[]>> {
  await page.page.evaluate(() => {
    const copied: string[] = [];
    (window as unknown as { harnessCopied: string[] }).harnessCopied = copied;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string): Promise<void> => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    });
  });
  return () => page.page.evaluate(() => [...(window as unknown as { harnessCopied: string[] }).harnessCopied]);
}

/** Makes the clipboard of this page refuse, as a browser inside another app can. */
const refuseCopies = (page: OpenedPage): Promise<void> =>
  page.page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (): Promise<void> => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')) },
    });
  });

/** The well-known test wallet as a browser keeps it when it opens the wallet with a passkey: no words in the record. */
const passkeyRecord = () => makeRecord('passkey', TEST_WORDS, TEST_MADE_AT, { credentialId: 'QUJDREVGR0g', tag: 'K7Q2' });

/** What the browser holds for the app's address: every kind of storage a page can write to. */
const browserKeeps = (page: OpenedPage): Promise<{ local: string[]; session: number; cookie: string; databases: number; caches: number }> =>
  page.page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: sessionStorage.length,
    cookie: document.cookie,
    databases: (await indexedDB.databases()).length,
    caches: (await caches.keys()).length,
  }));

/**
 * Whether a screen's text holds the test wallet's 12 words, or the first of
 * them. (The last test word, "about", is an everyday word that About uses
 * itself, so the words are not looked for one by one.)
 */
const hasWords = (text: string): boolean => text.includes(TEST_WORDS) || text.includes(TEST_WORDS.split(' ')[0]!);

/** The page views the Worker passed on so far: the path each was counted under. */
const viewsOf = (events: readonly { event: { name: string; path: string } }[]): string[] =>
  events.filter((each) => each.event.name === 'pageview').map((each) => each.event.path);

// -- the Sparrow guide --------------------------------------------------------------------

scenario('the Sparrow guide with no wallet, in English: this run\'s server, the three commands, the sentence word for word', ON_RUN, async (s) => {
  // A device that offers passkeys, so that "no passkey was made" below says something.
  const page = await s.open('/sparrow', { width: 375, passkey: 'prf' });
  assert.equal(page.status, 200);
  assert.deepEqual(await heading(page), {
    h1: 'Use the practice network from Sparrow',
    lang: 'en',
    title: 'Practice: Sparrow guide | LearnBitcoin',
  });

  // Step 4: the server settings are this run's, not the built-in ones.
  await shows(page, 'sparrow-host', RUN.ELECTRUM_HOST);
  assert.equal(await page.text('sparrow-port'), RUN.ELECTRUM_PORT);
  assert.equal(await page.text('sparrow-ssl'), 'Use SSL On');
  assert.ok(!(await screenText(page)).includes('learnbitcoin.com'), 'no built-in host name is left on the screen');

  // Step 2: one command for each system, each exactly as it is typed, and the warning about the menu.
  for (const [system, command] of Object.entries(COMMANDS)) assert.equal(await page.text(`sparrow-${system}-text`), command, system);
  assert.match(await page.text('sparrow-no-menu'), /lists Testnet and Signet networks, and no Regtest\. Do not pick one of those in its place\./);
  // A command is marked so that a translating browser leaves it alone.
  assert.equal(await attribute(page, 'sparrow-macos-text', 'translate'), 'no');
  // So is the flag inside a sentence: code, never translated, and the sentence reads on around it.
  assert.deepEqual(
    await page.page.$$eval('[data-testid="sparrow-start-how"] code', (found) => found.map((each) => [each.textContent, each.getAttribute('translate')])),
    [['-n regtest', 'no']],
  );
  assert.match(await page.text('sparrow-start-how'), /^Regtest mode starts only from a command, with the flag -n regtest after the name of the program\./);
  assert.deepEqual(
    await page.page.$$eval('[data-testid="sparrow-path"] code', (found) => found.map((each) => [each.textContent, each.getAttribute('translate')])),
    [["m/84'/1'/0'", 'no']],
  );

  // Sparrow's labels are set apart, as Sparrow's program shows them, and no mark of the string table reaches the page.
  const labels = await sparrowLabels(page);
  for (const label of ['Tools -> Restart In', 'File -> New Wallet', 'Regtest', 'Private Electrum', 'Test Connection', 'Use 24 Words', 'Use 12 Words', 'Apply']) {
    assert.ok(labels.includes(label), `${label} is not marked as a label: ${labels.join(' | ')}`);
  }
  const all = await screenText(page);
  assert.ok(!all.includes('`'), 'a backtick of the string table is on the screen');
  assert.doesNotMatch(all, /Enter (12|24) Words/);
  // The two ways into Sparrow are lists, one action to a line.
  assert.equal((await page.page.$$('[data-testid="sparrow-watch-steps"] > li')).length, 4);
  assert.equal((await page.page.$$('[data-testid="sparrow-words-steps"] > li')).length, 6);
  assert.match(await page.text('sparrow-words-steps'), /Open the list beside Use 24 Words and choose Use 12 Words\./);

  // Step 6: the sentence of SPEC section 12, and the line for another test mode.
  assert.equal(await page.text('sparrow-real-network'), REAL_NETWORK.en);
  assert.match(await page.text('sparrow-test-network'), /^If they start tb1, Sparrow is in another test mode\./);

  // Step 5 with no wallet here: the cause and the way out, and no link into a wallet that is not there.
  assert.equal(await attribute(page, 'sparrow-need-wallet', 'data-state'), 'none');
  assert.match(await page.text('sparrow-need-wallet'), /^This browser has no practice wallet yet, so there is nothing to bring into Sparrow\./);
  assert.deepEqual(await page.texts('sparrow-settings-link'), []);
  assert.deepEqual(await page.texts('sparrow-backup-link'), []);
  assert.deepEqual(await page.texts('sparrow-descriptor-text'), []);
  // The exception line stands whether or not a wallet is here.
  assert.match(await page.text('sparrow-words-exception'), /^Practice words only\./);

  // Nothing that must stay whole is cut in two by the end of a line: not on this phone, and not at
  // widths where a line ends inside the flag (328, 454, 566 px) or inside an arrow (512 px) as soon
  // as they are plain text. (Measured in this browser with the piece that keeps them whole switched off.)
  assert.deepEqual(await cutAtLineEnd(page, WHOLE), []);
  for (const width of [328, 454, 512, 566]) {
    await page.page.setViewport({ width, height: 812 });
    assert.deepEqual(await cutAtLineEnd(page, WHOLE), [], `at ${width} px`);
    assert.equal(await page.sidewaysScroll(), 0, `at ${width} px`);
  }
  await page.page.setViewport({ width: 375, height: 812 });

  // The screen fits a phone, and the way out goes to the start page without loading a page.
  assert.equal(await page.sidewaysScroll(), 0);
  const loads = loadsOf(page);
  await page.click('sparrow-need-link');
  await eventually('the start page is open', () => pathOf(page) === '/');
  assert.equal(loadsOf(page), loads, 'the way out loaded a page');

  // Counted: this screen's view under its fixed path, then the start page's. Nothing else.
  await eventually('both views were counted', () => s.stack.events.length >= 2);
  assert.deepEqual(s.stack.events.map((each) => each.event), [
    { name: 'pageview', path: '/sparrow' },
    { name: 'pageview', path: '/' },
  ]);
  // Nothing was stored by reading the guide, and no passkey was made on a device that offers them.
  assert.equal(await page.stored(), null);
  assert.deepEqual(await page.passkey?.credentials(), []);
});

scenario('the Sparrow guide with no wallet, in Spanish: the same settings and commands, Sparrow\'s labels left in English', ON_RUN, async (s) => {
  const page = await s.open('/es/sparrow', { width: 320, lang: 'es' });
  assert.deepEqual(await heading(page), {
    h1: 'Usa la red de práctica desde Sparrow',
    lang: 'es',
    title: 'Práctica: Guía de Sparrow | LearnBitcoin',
  });
  await shows(page, 'sparrow-host', RUN.ELECTRUM_HOST);
  assert.equal(await page.text('sparrow-port'), RUN.ELECTRUM_PORT);
  assert.equal(await page.text('sparrow-ssl'), 'Use SSL (usar SSL) Activado');

  // Commands are never translated.
  for (const [system, command] of Object.entries(COMMANDS)) assert.equal(await page.text(`sparrow-${system}-text`), command, system);
  assert.equal(await page.text('sparrow-real-network'), REAL_NETWORK.es);
  assert.match(await page.text('sparrow-test-network'), /^Si empiezan por tb1, Sparrow está en otro modo de prueba\./);
  assert.match(await page.text('sparrow-no-menu'), /Tools -> Restart In \(Herramientas -> Reiniciar en\)/);

  // Sparrow's labels stay English, are marked as English for a screen reader and a translating browser,
  // and their Spanish meaning follows outside the mark.
  const labels = await sparrowLabels(page);
  for (const label of ['Tools -> Restart In', 'File -> Settings', 'Server', 'Use 24 Words', 'Use 12 Words', 'Apply']) {
    assert.ok(labels.includes(label), `${label} is not marked as a label: ${labels.join(' | ')}`);
  }
  for (const label of labels) assert.doesNotMatch(label, /[áéíóúñ]|Herramientas|Archivo|Configuración/, `a gloss is inside the label: ${label}`);
  const all = await screenText(page);
  assert.ok(!all.includes('`'), 'a backtick of the string table is on the screen');
  assert.match(all, /Abre la lista junto a Use 24 Words y elige Use 12 Words \(usar 12 palabras\)\./);
  assert.doesNotMatch(all, /Enter (12|24) Words/);
  // The port's box has no label in Sparrow, so the row is named in Spanish, with no English word and gloss.
  assert.match(all, /Puerto, en el campo junto a la URL/);
  assert.doesNotMatch(all, /Port \(puerto\)/);
  // Who ran the command that was run.
  assert.match(all, /Este lo ejecutamos nosotros\./);
  // The flag and the arrow stay whole here too: at this width, and at widths where a line ends inside
  // the flag (340, 430, 630 px) or inside an arrow (380, 430, 578 px) as soon as they are plain text.
  assert.deepEqual(await cutAtLineEnd(page, WHOLE), []);
  for (const width of [340, 380, 430, 578, 630]) {
    await page.page.setViewport({ width, height: 812 });
    assert.deepEqual(await cutAtLineEnd(page, WHOLE), [], `at ${width} px`);
    assert.equal(await page.sidewaysScroll(), 0, `at ${width} px`);
  }
  await page.page.setViewport({ width: 320, height: 812 });

  // The page that exists in English only says so, in its words and to the browser.
  assert.match(await page.text('sparrow-download'), /^Página de descargas de Sparrow \(en inglés\) \(se abre en otra pestaña\)$/);
  assert.equal(await attribute(page, 'sparrow-download', 'hreflang'), 'en');
  assert.equal(await attribute(page, 'sparrow-download', 'href'), 'https://sparrowwallet.com/download/');
  assert.equal(await attribute(page, 'sparrow-download', 'rel'), 'noopener noreferrer');

  // The way out keeps the reader in Spanish.
  assert.equal(await attribute(page, 'sparrow-need-wallet', 'data-state'), 'none');
  assert.equal(await attribute(page, 'sparrow-need-link', 'href'), '/es');
  // Even at 320 px nothing is wider than the screen: a command breaks at a space, inside its own box.
  assert.equal(await page.sidewaysScroll(), 0);

  await eventually('the view was counted', () => s.stack.events.length >= 1);
  assert.deepEqual(viewsOf(s.stack.events), ['/es/sparrow']);
});

scenario('the Sparrow guide\'s copy buttons copy exactly the line beside them, by click and from the keyboard', ON_RUN, async (s) => {
  const page = await s.open('/sparrow');
  await shows(page, 'sparrow-host', RUN.ELECTRUM_HOST);
  const copied = await recordCopies(page);

  // Each command: a click, the exact line on the clipboard, the button says so and the status region says so.
  const expected: string[] = [];
  for (const [system, command] of Object.entries(COMMANDS)) {
    page.forgetStatus();
    await page.click(`sparrow-${system}-copy`);
    assert.equal(await page.waitForStatus('Command copied'), 'Command copied', system);
    assert.equal(await page.text(`sparrow-${system}-copy`), 'Copied', system);
    expected.push(command);
    assert.deepEqual(await copied(), expected, system);
  }

  // Three buttons say "Copy command". Each stands in a group named by its system, so a screen reader
  // says which command a button copies.
  const groups = await page.page.$$eval('[data-testid$="-copy"]', (buttons) =>
    buttons
      .filter((button) => /^sparrow-(macos|windows|linux)-copy$/.test(button.getAttribute('data-testid') ?? ''))
      .map((button) => {
        const group = button.closest('[role="group"]');
        const name = document.getElementById(group?.getAttribute('aria-labelledby') ?? '');
        return (name?.textContent ?? '').replace(/\s+/g, ' ').trim();
      }),
  );
  assert.deepEqual(groups, [
    'macOS, in Terminal',
    'Windows, in a Command Prompt opened in the folder where Sparrow is installed',
    'Linux, in a terminal opened in the folder that holds the unpacked Sparrow folder',
  ]);

  // The server's host and port, as this run has them.
  page.forgetStatus();
  await page.click('sparrow-host-copy');
  await page.waitForStatus('URL copied');
  page.forgetStatus();
  await page.click('sparrow-port-copy');
  await page.waitForStatus('Port copied');
  expected.push(RUN.ELECTRUM_HOST, RUN.ELECTRUM_PORT);
  assert.deepEqual(await copied(), expected);

  // From the keyboard: Tab reaches the button of the first command, and Enter copies. The command's
  // own box is no stop on the way there: a command wraps, so its box never scrolls and has nothing
  // for a keyboard to do.
  await page.page.reload();
  await shows(page, 'sparrow-host', RUN.ELECTRUM_HOST);
  const again = await recordCopies(page);
  const focused = (): Promise<string | null> => page.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
  const order: string[] = [];
  for (let presses = 0; presses < 40 && order.at(-1) !== 'sparrow-macos-copy'; presses += 1) {
    await page.page.keyboard.press('Tab');
    const hook = await focused();
    if (hook !== null) order.push(hook);
  }
  assert.equal(order.at(-1), 'sparrow-macos-copy', order.join(', '));
  assert.ok(!order.includes('sparrow-macos-text'), order.join(', '));
  assert.deepEqual(
    await page.page.$eval('[data-testid="sparrow-macos-text"]', (box) => [box.getAttribute('tabindex'), box.getAttribute('role'), box.getAttribute('aria-label')]),
    [null, null, null],
  );
  // Nothing of the other two commands comes before it.
  assert.ok(!order.some((hook) => /windows|linux/.test(hook)), order.join(', '));
  page.forgetStatus();
  await page.page.keyboard.press('Enter');
  await page.waitForStatus('Command copied');
  assert.deepEqual(await again(), [COMMANDS.macos]);
  // No copy failed: the line that says so is not on the screen.
  assert.deepEqual(await page.texts('copy-failed'), []);

  // Copying counts nothing: the screen's two views (one for each load of the page) are all there is.
  await eventually('both loads were counted', () => s.stack.events.length >= 2);
  assert.deepEqual(s.stack.events.map((each) => each.event), [
    { name: 'pageview', path: '/sparrow' },
    { name: 'pageview', path: '/sparrow' },
  ]);
});

scenario('the Sparrow guide with a wallet in this browser: its receive descriptor to copy, and links to Settings and Backup that work', ON_RUN, async (s) => {
  const record = testRecord();
  const page = await s.open('/sparrow', { record, width: 375 });
  await shows(page, 'sparrow-host', RUN.ELECTRUM_HOST);

  // No note about a missing wallet. The descriptor is this wallet's own: its wallet fingerprint, its public key, the receive chain.
  assert.deepEqual(await page.texts('sparrow-need-wallet'), []);
  const descriptor = accountDescriptor(record.fingerprint, record.xpub, 0);
  assert.match(descriptor, /^wpkh\(\[73c5da0a\/84h\/1h\/0h\]tpub[A-Za-z0-9]+\/0\/\*\)#[a-z0-9]{8}$/);
  assert.equal(await page.text('sparrow-descriptor-text'), descriptor);
  // Public keys only: the 12 words are nowhere on this screen.
  const shown = await screenText(page);
  assert.ok(!shown.includes('tprv'), 'no private key on the screen');
  assert.ok(!hasWords(shown), 'the 12 words are on the screen');

  // Its copy button copies exactly that line.
  const copied = await recordCopies(page);
  await page.click('sparrow-descriptor-copy');
  await page.waitForStatus('Descriptor copied');
  assert.deepEqual(await copied(), [descriptor]);
  // A long line scrolls inside its own box: the page itself stays as wide as the phone.
  assert.equal(await page.sidewaysScroll(), 0);

  // The links go to Settings and to Backup, without loading a page (the wallet stays as it is).
  assert.equal(await attribute(page, 'sparrow-settings-link', 'href'), '/wallet/settings');
  assert.equal(await attribute(page, 'sparrow-backup-link', 'href'), '/wallet/backup');
  const before = loadsOf(page);
  await page.click('sparrow-settings-link');
  await eventually('Settings is open', () => pathOf(page) === '/wallet/settings');
  assert.notEqual((await heading(page)).h1, '');
  await page.page.goBack();
  await eventually('the guide is open again', () => pathOf(page) === '/sparrow');
  await page.click('sparrow-backup-link');
  await eventually('Backup is open', () => pathOf(page) === '/wallet/backup');
  assert.notEqual((await heading(page)).h1, '');
  assert.equal(loadsOf(page), before, 'no page was loaded on the way');

  // Spanish: the same wallet, the same line, links that stay in Spanish.
  const spanish = await s.open('/es/sparrow', { record, lang: 'es', width: 320 });
  await shows(spanish, 'sparrow-host', RUN.ELECTRUM_HOST);
  assert.equal(await spanish.text('sparrow-descriptor-text'), descriptor);
  assert.equal(await attribute(spanish, 'sparrow-settings-link', 'href'), '/es/wallet/settings');
  assert.equal(await attribute(spanish, 'sparrow-backup-link', 'href'), '/es/wallet/backup');
  assert.equal(await spanish.text('sparrow-settings-link'), 'Abrir Configuración');
  assert.equal(await spanish.sidewaysScroll(), 0);

  // Reading the guide changed nothing in storage.
  assert.equal(await page.stored(), JSON.stringify(record));
});

scenario('the Sparrow guide where the stored wallet cannot be used: each state says its cause and its way out', ON_RUN, async (s) => {
  // Something stored that is no record: nothing is overwritten, and the wallet's own screen has the ways out.
  const damaged = '{"v":1,"kind":"words"';
  const unreadable = await s.open('/sparrow', { record: damaged });
  await shows(unreadable, 'sparrow-host', RUN.ELECTRUM_HOST);
  assert.equal(await attribute(unreadable, 'sparrow-need-wallet', 'data-state'), 'unreadable');
  assert.match(await unreadable.text('sparrow-need-wallet'), /^The practice wallet stored in this browser cannot be read, .* The wallet screen says what can be done about it\./);
  assert.deepEqual(await unreadable.texts('sparrow-settings-link'), []);
  assert.deepEqual(await unreadable.texts('sparrow-backup-link'), []);
  assert.deepEqual(await unreadable.texts('sparrow-descriptor-text'), []);
  assert.deepEqual(await unreadable.texts('sparrow-no-descriptor'), []);
  await unreadable.click('sparrow-need-link');
  await eventually('the wallet screen is open', () => pathOf(unreadable) === '/wallet');
  // The gate there offers Remove; the guide itself removed nothing.
  await unreadable.waitFor('remove-wallet');
  assert.equal(await unreadable.stored(), damaged);

  // A record from a newer version of the page: reload is the way out, and nothing is touched.
  const later = JSON.stringify({ v: 2, kind: 'words', anything: 'a later version may keep' });
  const newer = await s.open('/es/sparrow', { record: later, lang: 'es' });
  await shows(newer, 'sparrow-host', RUN.ELECTRUM_HOST);
  assert.equal(await attribute(newer, 'sparrow-need-wallet', 'data-state'), 'newer');
  assert.match(await newer.text('sparrow-need-wallet'), /fue guardada por una versión más nueva de esta página, .* Recarga la página y vuelve a este paso\./);
  assert.equal(await newer.text('sparrow-need-reload'), 'Recargar');
  // No way into a wallet this version leaves alone: no line to copy, no link to Settings or to Backup.
  assert.deepEqual(await newer.texts('sparrow-backup-link'), []);
  assert.deepEqual(await newer.texts('sparrow-settings-link'), []);
  assert.deepEqual(await newer.texts('sparrow-descriptor-text'), []);
  assert.deepEqual(await newer.texts('sparrow-no-descriptor'), []);
  const before = loadsOf(newer);
  await newer.click('sparrow-need-reload');
  await eventually('the page was loaded again', () => loadsOf(newer) === before + 1);
  await shows(newer, 'sparrow-host', RUN.ELECTRUM_HOST);
  assert.equal(await attribute(newer, 'sparrow-need-wallet', 'data-state'), 'newer');
  assert.equal(await newer.stored(), later);
});

// -- About --------------------------------------------------------------------------------

scenario('About with no wallet, in English and Spanish: this run\'s facts, what may be promised, every counted event by its name', ON_RUN, async (s) => {
  const page = await s.open('/about', { width: 375 });
  assert.equal(page.status, 200);
  assert.deepEqual(await heading(page), { h1: 'About the practice wallet', lang: 'en', title: 'Practice: About | LearnBitcoin' });

  // The practice network's facts are this run's settings.
  await shows(page, 'about-blocks', 'Blocks About one every 45 seconds');
  assert.equal(await page.text('about-faucet'), 'Faucet 25,000 practice sats for each request');
  assert.equal(await page.text('about-electrum-host'), RUN.ELECTRUM_HOST);
  assert.equal(await page.text('about-electrum-port'), RUN.ELECTRUM_PORT);
  assert.equal(await attribute(page, 'about-explorer', 'href'), RUN.EXPLORER_URL);
  // The link's words are the explorer's address, and then what a screen reader is told.
  assert.match(await page.text('about-explorer'), /^explorer\.practice\.test \(opens in a new tab\)$/);
  // The outside links: the main site and the source code, each from the settings, each in a tab of its own.
  assert.equal(await attribute(page, 'about-site', 'href'), s.stack.config.siteUrl);
  assert.equal(await attribute(page, 'about-source', 'href'), s.stack.config.sourceUrl);
  for (const link of ['about-explorer', 'about-site', 'about-source']) {
    assert.equal(await attribute(page, link, 'target'), '_blank', link);
    assert.equal(await attribute(page, link, 'rel'), 'noopener noreferrer', link);
  }
  assert.equal(await attribute(page, 'about-source', 'hreflang'), null);

  // What may be said, and no more.
  assert.equal(await page.text('about-short'), 'There is no account, and we set no cookies. The 12 words never leave this browser.');
  const text = await screenText(page);
  assert.doesNotMatch(text, /nothing leaves your browser|nothing that says who you are/i);
  assert.match(text, /the server sees the wallet's addresses and payments, and the IP address each request comes from/);
  assert.match(text, /with the IP address the request came from and what your browser says it is/);
  assert.match(text, /It examines your browser to tell a person from a script, and it is given the address the coins are for/);
  assert.match(text, /anyone who uses this browser can see the wallet\. If its 12 words are stored here, they can also spend from it/);
  // Wallets are sorted by how this browser keeps them: a wallet restored here is kept with its words.
  assert.equal(
    await page.text('about-passkey-restored'),
    'A wallet restored here from its 12 words is kept with the words, whatever it was made with.',
  );
  assert.doesNotMatch(text, /made with a passkey|words are never stored/);
  // What is not known is not promised: what Cloudflare keeps beside a log line.
  assert.match(text, /The line itself holds no address, no transaction ID and no IP address\./);
  assert.match(text, /may keep, beside each one, the web address that was asked for and the IP address it came from/);
  assert.doesNotMatch(text, /No line holds/);

  // No wallet here: the line about this browser says so.
  assert.equal(await attribute(page, 'about-kept-now', 'data-kept'), 'none');
  assert.equal(await page.text('about-kept-now'), 'In this browser right now Nothing. This browser has no practice wallet.');

  // What is counted: the contract's events, each under the name it is sent by, and counting is on in this run.
  const names = Object.keys(EVENTS);
  assert.deepEqual(
    await page.page.$$eval('[data-testid="about-count"]', (items) => items.map((item) => item.getAttribute('data-event'))),
    names,
  );
  const entries = await page.texts('about-count');
  names.forEach((name, index) => assert.ok(entries[index]?.startsWith(`${name} `), `${name}: ${entries[index]}`));
  // The line is drawn once the settings are this run's, so it is waited for.
  await shows(page, 'about-counting', 'Counting is on right now.');
  assert.equal(await attribute(page, 'about-counting', 'data-counting'), 'on');
  // The faucet is open in this run, and nothing says otherwise.
  assert.deepEqual(await page.texts('about-faucet-off'), []);
  assert.equal(await page.sidewaysScroll(), 0);

  // The link to the Sparrow guide changes the screen without loading a page.
  const loads = loadsOf(page);
  await page.click('about-sparrow');
  await eventually('the Sparrow guide is open', () => pathOf(page) === '/sparrow');
  assert.equal(loadsOf(page), loads, 'the link to the guide loaded a page');

  // Spanish: the same facts, the promise in Spanish, and a link to an English-only page says so.
  const spanish = await s.open('/es/about', { lang: 'es', width: 320 });
  assert.deepEqual(await heading(spanish), {
    h1: 'Acerca de la billetera de práctica',
    lang: 'es',
    title: 'Práctica: Acerca de | LearnBitcoin',
  });
  await shows(spanish, 'about-blocks', 'Bloques Uno cada 45 segundos, más o menos');
  assert.equal(await spanish.text('about-faucet'), 'Faucet 25,000 sats de práctica por cada solicitud');
  assert.equal(await spanish.text('about-electrum-host'), RUN.ELECTRUM_HOST);
  assert.equal(await spanish.text('about-electrum-port'), RUN.ELECTRUM_PORT);
  assert.equal(await spanish.text('about-short'), 'No hay cuenta, y no ponemos cookies. Las 12 palabras nunca salen de este navegador.');
  assert.match(await spanish.text('about-source'), /^Leer el código fuente \(en inglés\) \(se abre en otra pestaña\)$/);
  assert.equal(await attribute(spanish, 'about-source', 'hreflang'), 'en');
  // The main site has a Spanish edition, and a Spanish page links to it.
  assert.equal(await attribute(spanish, 'about-site', 'href'), `${s.stack.config.siteUrl}/es`);
  assert.equal(await attribute(spanish, 'about-kept-now', 'data-kept'), 'none');
  assert.equal(await spanish.text('about-kept-now'), 'En este navegador, ahora mismo Nada. Este navegador no tiene billetera de práctica.');
  assert.equal(
    await spanish.text('about-passkey-restored'),
    'Una billetera restaurada aquí desde sus 12 palabras se guarda con las palabras, sin importar cómo se creó.',
  );
  await shows(spanish, 'about-counting', 'El conteo está activado en este momento.');
  assert.deepEqual(await spanish.texts('about-faucet-off'), []);
  // The names of the counts are the same in Spanish: they are what is sent.
  assert.deepEqual(
    await spanish.page.$$eval('[data-testid="about-count"]', (items) => items.map((item) => item.getAttribute('data-event'))),
    names,
  );
  assert.doesNotMatch(await screenText(spanish), /nada sale de tu navegador|nada que diga quién eres/i);
  assert.equal(await spanish.sidewaysScroll(), 0);

  // Counted: each screen's own view under its fixed path, and nothing else.
  await eventually('the three views were counted', () => s.stack.events.length >= 3);
  assert.deepEqual(viewsOf(s.stack.events).sort(), ['/about', '/es/about', '/sparrow']);
  assert.equal(s.stack.events.length, 3);
  // Reading About stores nothing, in any kind of storage.
  assert.deepEqual(await browserKeeps(spanish), { local: [], session: 0, cookie: '', databases: 0, caches: 0 });
});

scenario('About where counting and the faucet are switched off: the page says so of each, and nothing is counted', BOTH_OFF, async (s) => {
  const page = await s.open('/about');
  // The settings have arrived (the block interval is this run's), and they say that events are not wanted.
  await shows(page, 'about-blocks', 'Blocks About one every 45 seconds');
  assert.equal(s.stack.config.events, false);
  await shows(page, 'about-counting', 'Counting is off right now, so none of this is sent.');
  assert.equal(await attribute(page, 'about-counting', 'data-counting'), 'off');
  // The list still says what would be counted.
  assert.equal((await page.texts('about-count')).length, Object.keys(EVENTS).length);
  // The settings name no bot check, so the faucet pays nobody: the amount stays, and a line under it says so.
  assert.equal(s.stack.config.turnstileSiteKey, '');
  assert.equal(await page.text('about-faucet-off'), 'The faucet is switched off right now.');
  assert.equal(await page.text('about-faucet'), 'Faucet 25,000 practice sats for each request The faucet is switched off right now.');

  const spanish = await s.open('/es/about', { lang: 'es' });
  await shows(spanish, 'about-blocks', 'Bloques Uno cada 45 segundos, más o menos');
  await shows(spanish, 'about-counting', 'El conteo está desactivado en este momento, así que nada de esto se envía.');
  assert.equal(await spanish.text('about-faucet-off'), 'El faucet está apagado por ahora.');

  // And it is true: two screens were opened, and the Worker was sent no event at all.
  await page.settle();
  await spanish.settle();
  await s.stack.settled();
  assert.deepEqual(s.stack.events, []);
  assert.deepEqual(s.stack.lines.filter((line) => line.route === 'event'), []);
});

scenario(
  'About with a wallet: what it says this browser keeps, our server writes down and Plausible is sent is what this run stored, logged and sent on',
  ON_RUN,
  async (s) => {
    // The well-known test wallet. Nothing here depends on what it holds: on the stand-in it is empty,
    // and on a real network it may hold anything. What counts is that the wallet looks its coins up.
    const record = testRecord();
    // A wallet screen first, so that the wallet looks its coins up as it does in use.
    const page = await s.open('/wallet', { record });
    await page.settle();
    await page.goto('/about');
    await shows(page, 'about-blocks', 'Blocks About one every 45 seconds');
    await page.settle();
    await eventually('both views were counted', () => s.stack.events.length >= 2);
    await s.stack.settled();

    // -- "What this browser keeps" --
    // The page says: a wallet kept with its 12 words, as plain text. (How the wallet was made is not
    // in the record, and the page does not guess it.)
    assert.equal(await attribute(page, 'about-kept-now', 'data-kept'), 'words');
    assert.equal(
      await page.text('about-kept-now'),
      'In this browser right now The record of a wallet kept with its 12 words, as plain text.',
    );
    // And so it is: one record under one key, the words in it as they were typed, and nothing in any other storage.
    assert.deepEqual(await browserKeeps(page), { local: ['lbp_wallet_v1'], session: 0, cookie: '', databases: 0, caches: 0 });
    const stored = JSON.parse((await page.stored()) ?? 'null') as Record<string, unknown>;
    assert.equal(stored.mnemonic, TEST_WORDS);
    assert.deepEqual(Object.keys(stored).sort(), ['createdAt', 'fingerprint', 'firstAddress', 'kind', 'mnemonic', 'v', 'xpub']);
    // "We set no cookies": no answer of this run asked the browser to keep one.
    assert.ok(page.responses.length > 20, 'the walk found the answers');
    for (const response of page.responses) assert.equal(response.headers['set-cookie'], undefined, response.url);
    // The words are on no part of the About screen.
    assert.ok(!hasWords(await screenText(page)), 'the 12 words are on the screen');

    // -- "What our server sees" --
    // The wallet did ask about its addresses, by the address itself, and the Worker answered each from the
    // practice network: so the server saw them, as the page says.
    const reads = page.responses.filter((response) => new URL(response.url).pathname.startsWith('/api/esplora/address/'));
    assert.ok(reads.length >= 40, `${reads.length} address reads`);
    for (const read of reads) assert.equal(read.status, 200, read.url);
    const addresses = [...new Set(reads.map((read) => new URL(read.url).pathname.split('/')[4] ?? ''))];
    assert.ok(addresses.length >= 20, `${addresses.length} addresses`);
    assert.ok(addresses.includes(record.firstAddress), 'the first address was asked about');
    for (const address of addresses) assert.match(address, /^bcrt1q[0-9a-z]{38}$/);
    // "When the page asks about an address, a transaction or the height of the chain, the server writes
    // nothing down." The height was asked for too, and is the request the wallet repeats most.
    const heights = page.responses.filter((response) => new URL(response.url).pathname === '/api/esplora/blocks/tip/height');
    assert.ok(heights.length >= 1, 'the height of the chain was asked for');
    for (const height of heights) assert.equal(height.status, 200, height.url);
    const lines = s.stack.lines;
    assert.deepEqual(lines.filter((line) => line.route === 'esplora_read'), []);
    // "For every other request it writes one line": here the settings (once for each load of the page) and the two counts.
    assert.deepEqual(
      lines.map((line) => [line.route, line.status, line.fault]),
      [
        ['config', 200, null],
        ['event', 202, null],
        ['config', 200, null],
        ['event', 202, null],
      ],
    );
    // "What kind of request it was, how it ended and how long it took": five fields, and no others.
    for (const line of lines) assert.deepEqual(Object.keys(line).sort(), ['fault', 'ms', 'route', 'status', 'upstream']);
    // "The line itself holds no address, no transaction ID and no IP address." That is all a run can show:
    // what a log service keeps beside a line is not in the line, which is why the page says "may keep".
    const written = JSON.stringify(lines);
    const secrets = [record.fingerprint, record.xpub, ...addresses];
    for (const secret of secrets) assert.ok(!written.includes(secret), secret);
    assert.doesNotMatch(written, /bcrt1|tpub|[0-9a-f]{64}|\b\d{1,3}(\.\d{1,3}){3}\b|localhost/);

    // -- "What is counted" --
    // Two screens were opened: two counts, each a name and the screen's fixed path, and nothing else in them.
    assert.deepEqual(s.stack.events.map((each) => each.event), [
      { name: 'pageview', path: '/wallet' },
      { name: 'pageview', path: '/about' },
    ]);
    for (const { event, meta } of s.stack.events) {
      assert.ok(Object.hasOwn(EVENTS, event.name), event.name);
      assert.ok(eventPaths().includes(event.path), event.path);
      // What the Worker hands on about the request: its IP address and its user agent, and nothing more.
      assert.deepEqual(Object.keys(meta).sort(), ['ip', 'userAgent']);
      assert.match(meta.userAgent ?? '', /Chrome\//);
      for (const secret of secrets) assert.ok(!JSON.stringify({ event, meta }).includes(secret), secret);
    }

    // "Our server passes each count on to Plausible ... with the IP address the request came from and what
    // your browser says it is ... No ID is sent with a count." The Worker's own forwarder is run here over
    // what this run counted, with a fetch that records the request and sends nothing. (A local run has no
    // Cloudflare in front of it to say where a request came from, so an address is put in its place: one
    // from the range kept for documentation.)
    const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const forward = makeForwardEvent({
      domain: 'practice.example',
      appUrl: s.url,
      props: false,
      fetch: (url, init) => {
        sent.push({
          url,
          headers: Object.fromEntries(new Headers(init?.headers)),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return Promise.resolve(new Response(null, { status: 202 }));
      },
    });
    for (const { event, meta } of s.stack.events) {
      assert.deepEqual(await forward(event, { ...meta, ip: '192.0.2.7' }), { ok: true, upstream: 202, fault: null });
    }
    const agent = s.stack.events[0]!.meta.userAgent ?? '';
    assert.deepEqual(sent, [
      {
        url: 'https://plausible.io/api/event',
        headers: { 'cf-connecting-ip': '192.0.2.7', 'content-type': 'application/json', 'user-agent': agent, 'x-forwarded-for': '192.0.2.7' },
        body: { name: 'pageview', url: `${s.url}/wallet`, domain: 'practice.example' },
      },
      {
        url: 'https://plausible.io/api/event',
        headers: { 'cf-connecting-ip': '192.0.2.7', 'content-type': 'application/json', 'user-agent': agent, 'x-forwarded-for': '192.0.2.7' },
        body: { name: 'pageview', url: `${s.url}/about`, domain: 'practice.example' },
      },
    ]);

    // "Each count is the name of what happened, at most one detail from a fixed list, and the screen it
    // happened on." A count with a detail, through the same forwarder, in both of its modes: the detail
    // joins the name, or travels as one property. Nothing else is added in either.
    const detailed: { headers: string[]; body: Record<string, unknown> }[] = [];
    const recording = (_url: string, init?: RequestInit): Promise<Response> => {
      detailed.push({ headers: Object.keys(Object.fromEntries(new Headers(init?.headers))).sort(), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return Promise.resolve(new Response(null, { status: 202 }));
    };
    const meta = { ip: '192.0.2.7', userAgent: agent };
    for (const props of [false, true]) {
      const forwardDetail = makeForwardEvent({ domain: 'practice.example', appUrl: s.url, props, fetch: recording });
      assert.deepEqual(await forwardDetail({ name: 'Words shown', value: 'words', path: '/wallet/backup' }, meta), { ok: true, upstream: 202, fault: null });
    }
    const sentHeaders = ['cf-connecting-ip', 'content-type', 'user-agent', 'x-forwarded-for'];
    assert.deepEqual(detailed, [
      { headers: sentHeaders, body: { name: 'Words shown: words', url: `${s.url}/wallet/backup`, domain: 'practice.example' } },
      { headers: sentHeaders, body: { name: 'Words shown', url: `${s.url}/wallet/backup`, domain: 'practice.example', props: { wallet: 'words' } } },
    ]);
  },
);

// -- a refused copy ----------------------------------------------------------------------------

scenario('the Sparrow guide when the browser refuses to copy: the page says so, and the value to select by hand stays whole', ON_RUN, async (s) => {
  // On a wide screen the value and its button share a line. The line that says the copy was refused
  // must go under them: beside them it squeezed the port into two halves.
  for (const [path, lang, width, refusal] of [
    ['/sparrow', 'en', 1280, 'This browser did not let the page copy. Select the text and copy it by hand.'],
    ['/es/sparrow', 'es', 640, null],
    ['/sparrow', 'en', 375, null],
  ] as const) {
    const where = `${path} at ${width} px`;
    const page = await s.open(path, { width, lang });
    await shows(page, 'sparrow-host', RUN.ELECTRUM_HOST);
    const size = (testid: string): Promise<{ width: number; height: number; top: number; bottom: number }> =>
      page.page.$eval(`[data-testid="${testid}"]`, (found) => {
        const box = found.getBoundingClientRect();
        return { width: Math.round(box.width), height: Math.round(box.height), top: Math.round(box.top), bottom: Math.round(box.bottom) };
      });
    const before = { host: await size('sparrow-host'), port: await size('sparrow-port'), button: await size('sparrow-port-copy') };
    assert.equal(await linesOf(page, 'sparrow-host'), 1, where);
    assert.equal(await linesOf(page, 'sparrow-port'), 1, where);

    await refuseCopies(page);
    page.forgetStatus();
    await page.click('sparrow-host-copy');
    const said = await page.waitForStatus(/./);
    if (refusal !== null) assert.equal(said, refusal, where);
    page.forgetStatus();
    await page.click('sparrow-port-copy');
    assert.equal(await page.waitForStatus(/./), said, where);
    // The same sentence is on the screen under each button, and neither button claims a copy.
    await eventually(`${where}: both refusals are on the screen`, async () => (await page.texts('copy-failed')).length === 2);
    assert.deepEqual(await page.texts('copy-failed'), [said, said], where);
    assert.notEqual(await page.text('sparrow-port-copy'), lang === 'en' ? 'Copied' : 'Copiado', where);

    // The value keeps its line and its width, and the button its size: nothing was squeezed.
    assert.equal(await linesOf(page, 'sparrow-host'), 1, where);
    assert.equal(await linesOf(page, 'sparrow-port'), 1, where);
    const after = { host: await size('sparrow-host'), port: await size('sparrow-port'), button: await size('sparrow-port-copy') };
    assert.equal(after.host.width, before.host.width, where);
    assert.equal(after.port.width, before.port.width, where);
    assert.equal(after.button.width, before.button.width, where);
    assert.equal(after.button.height, before.button.height, where);
    // The refusal stands under the port and its button, on a line of its own.
    const line = await page.page.$$eval('[data-testid="copy-failed"]', (found) => {
      const box = found[1]?.getBoundingClientRect();
      return box ? Math.round(box.top) : -1;
    });
    assert.ok(line >= Math.max(after.port.bottom, after.button.bottom) - 1, `${where}: the refusal starts at ${line}, the port ends at ${after.port.bottom}`);
    assert.equal(await page.sidewaysScroll(), 0, where);
    // The whole value can still be selected by hand.
    assert.equal(await page.text('sparrow-port'), RUN.ELECTRUM_PORT, where);
  }
});

// -- another tab changes the wallet --------------------------------------------------------------

scenario('another tab swaps, removes and damages the wallet: step 5 of the guide and About\'s "right now" line follow, with no page load', ON_RUN, async (s) => {
  const first = testRecord();
  const guide = await s.open('/sparrow', { record: first });
  const about = await s.open('/about', { context: guide.context });
  const other = await s.open('/', { context: guide.context });
  await shows(guide, 'sparrow-host', RUN.ELECTRUM_HOST);
  await shows(about, 'about-blocks', 'Blocks About one every 45 seconds');
  const firstLine = accountDescriptor(first.fingerprint, first.xpub, 0);
  await shows(guide, 'sparrow-descriptor-text', firstLine);
  assert.equal(await attribute(about, 'about-kept-now', 'data-kept'), 'words');
  const loads = { guide: loadsOf(guide), about: loadsOf(about) };
  const kept = (state: string): Promise<void> =>
    eventually(`About says ${state}`, async () => (await attributeNow(about, 'about-kept-now', 'data-kept')) === state);
  const need = (state: string): Promise<void> =>
    eventually(`the guide says ${state}`, async () => (await attributeNow(guide, 'sparrow-need-wallet', 'data-state')) === state);

  // 1. Another wallet in its place. The line a reader would paste into Sparrow must be the new wallet's.
  const second = testRecord(OTHER_WORDS);
  const secondLine = accountDescriptor(second.fingerprint, second.xpub, 0);
  assert.notEqual(secondLine, firstLine);
  await other.store(RECORD_KEY, JSON.stringify(second));
  await shows(guide, 'sparrow-descriptor-text', secondLine);
  await kept('words');

  // 2. The first wallet again, now as a browser keeps it when it opens the wallet with a passkey: no words.
  await other.store(RECORD_KEY, JSON.stringify(passkeyRecord()));
  await shows(guide, 'sparrow-descriptor-text', firstLine);
  await kept('passkey');
  assert.equal(
    await about.text('about-kept-now'),
    'In this browser right now The record of a wallet that this browser opens with a passkey. Its 12 words are not stored.',
  );
  assert.ok(!((await about.stored()) ?? '').includes('abandon'), 'the stored record holds words');

  // 3. Removed.
  await other.store(RECORD_KEY, null);
  await need('none');
  for (const gone of ['sparrow-descriptor-text', 'sparrow-settings-link', 'sparrow-backup-link']) assert.deepEqual(await guide.texts(gone), [], gone);
  await kept('none');
  assert.equal(await about.text('about-kept-now'), 'In this browser right now Nothing. This browser has no practice wallet.');

  // 4. Something that is no record.
  await other.store(RECORD_KEY, '{"v":1,"kind":"words"');
  await need('unreadable');
  await kept('unreadable');

  // 5. A record from a newer version of the page.
  await other.store(RECORD_KEY, JSON.stringify({ v: 2, kind: 'words' }));
  await need('newer');
  await kept('newer');
  assert.deepEqual(await guide.texts('sparrow-descriptor-text'), []);

  // 6. And the first wallet back, with its words.
  await other.store(RECORD_KEY, JSON.stringify(first));
  await shows(guide, 'sparrow-descriptor-text', firstLine);
  assert.deepEqual(await guide.texts('sparrow-need-wallet'), []);
  assert.equal(await attribute(guide, 'sparrow-settings-link', 'href'), '/wallet/settings');
  await kept('words');

  // Neither screen was loaded again to follow.
  assert.equal(loadsOf(guide), loads.guide, 'the guide was loaded again');
  assert.equal(loadsOf(about), loads.about, 'About was loaded again');
});

// -- while the settings are on their way ------------------------------------------------------------

/** What About showed at one moment of a page load. */
interface Glimpse {
  /** The row of the block interval: the built-in one until the server's settings arrive. */
  blocks: string;
  /** What the counting line said: "on", "off", or null while it was not drawn. */
  counting: string | null;
  /** Whether the line about a closed faucet was drawn. */
  faucetOff: boolean;
}

scenario('About while the settings are on their way: no line says "off" that the settings then turn to "on"', ON_RUN, async (s) => {
  // In this run counting is on and the faucet is open. The page is first drawn with the built-in
  // settings, which say the opposite of both.
  assert.equal(s.stack.config.events, true);
  assert.notEqual(s.stack.config.turnstileSiteKey, '');
  const page = await s.open('/about');
  await shows(page, 'about-counting', 'Counting is on right now.');

  // Watch the next load of the page from its first moment: every change to the document is looked at.
  await page.page.evaluateOnNewDocument(() => {
    const seen: Glimpse[] = [];
    (window as unknown as { harnessGlimpses: Glimpse[] }).harnessGlimpses = seen;
    new MutationObserver(() => {
      const blocks = document.querySelector('[data-testid="about-blocks"]');
      if (blocks === null) return;
      seen.push({
        blocks: (blocks.textContent ?? '').replace(/\s+/g, ' ').trim(),
        counting: document.querySelector('[data-testid="about-counting"]')?.getAttribute('data-counting') ?? null,
        faucetOff: document.querySelector('[data-testid="about-faucet-off"]') !== null,
      });
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await page.page.reload();
  await shows(page, 'about-counting', 'Counting is on right now.');
  const seen = await page.page.evaluate(() => [...(window as unknown as { harnessGlimpses: Glimpse[] }).harnessGlimpses]);

  // The page was seen before the settings arrived: the block interval was still the built-in one.
  const early = seen.filter((each) => each.blocks !== 'Blocks About one every 45 seconds');
  assert.ok(early.length >= 1, `the page was not seen before the settings arrived: ${JSON.stringify(seen)}`);
  // In that time neither line was on the screen. As soon as the settings said so, counting read "on".
  for (const each of seen) {
    assert.notEqual(each.counting, 'off', JSON.stringify(each));
    assert.equal(each.faucetOff, false, JSON.stringify(each));
  }
  for (const each of early) assert.equal(each.counting, null, JSON.stringify(each));
  assert.equal(seen.at(-1)?.counting, 'on');
  assert.equal(await page.text('about-faucet'), 'Faucet 25,000 practice sats for each request');
});
