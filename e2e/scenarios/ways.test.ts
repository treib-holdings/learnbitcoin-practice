// Ways through the app that cross two screens, and what the reader is told
// on the way: where "Get practice coins" lands, what Home and the Overview
// say after a wallet was removed or restored, the way back out of Backup's
// unlock step, an answer about typed words that no longer fits them, and
// what becomes of Send's form and title when the reader leaves and returns.
//
// Each of these looked right on its own screen. They went wrong between
// screens, or one step into a screen, where no single screen's scenario
// was looking.

import assert from 'node:assert/strict';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { OTHER_WORDS, TEST_WORDS, freshRecord, fundTestWallet, scenario, testRecord, type OpenedPage } from './helpers.ts';
import {
  arrivesAt,
  attributeOf,
  countOf,
  createFrom,
  focusOf,
  headingBecomes,
  headingOf,
  heldBy,
  hook,
  noticeOf,
  refuseNextGet,
  sleep,
  standBy,
  storedRecord,
  textOf,
  toSection,
  typeWords,
  until,
  untilAnswersCount,
  wordsOnScreen,
} from './journey-helpers.ts';

const common = strings.common.en;
const wallet = strings.wallet.en;
const home = strings.home.en;
const send = strings.send.en;
const backup = strings.backup.en;

/** An address that is neither the wallet's nor the pot's: the first address of the harness's second wallet. */
const SOMEBODY = testRecord(OTHER_WORDS).firstAddress;

/** Where an element stands on the screen: its top and bottom edge, the screen's height, and how far the page is scrolled. */
const placeOf = (page: OpenedPage, id: string): Promise<{ top: number; bottom: number; screen: number; scrolled: number }> =>
  page.page.$eval(hook(id), (element) => {
    const box = element.getBoundingClientRect();
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), screen: window.innerHeight, scrolled: Math.round(window.scrollY) };
  });

/** Waits until keyboard focus is on the faucet card's heading, and holds that the faucet's own button is on the screen. */
async function landsOnFaucet(page: OpenedPage, heading: string, where: string): Promise<void> {
  await page.waitFor('faucet-ask');
  await page.page.waitForFunction(
    (text) => document.activeElement?.tagName === 'H2' && document.activeElement.textContent?.trim() === text,
    {},
    heading,
  );
  const button = await placeOf(page, 'faucet-ask');
  assert.ok(button.top >= 0 && button.bottom <= button.screen, where + ': the faucet\'s button is not on the screen ' + JSON.stringify(button));
  assert.ok(button.scrolled > 0, where + ': the page did not move to the faucet');
}

scenario('"Get practice coins" on a wallet screen lands on the faucet itself, on a phone, in both languages, also after a page load', async (s) => {
  const page = await s.open('/wallet', { record: freshRecord(), width: 375, height: 667 });
  await page.waitFor('no-coins');
  const link = hook('no-coins') + ' a';
  assert.equal(await page.page.$eval(link, (anchor) => anchor.getAttribute('href')), '/wallet/receive#faucet');

  // From the empty Overview: the screen is Receive, and what is in front of the reader is the faucet,
  // whose button has the very words they pressed. Not the QR code, two screens above it.
  await page.page.locator(link).click();
  await arrivesAt(page, '/wallet/receive');
  assert.equal(await headingOf(page), common.section_receive);
  await landsOnFaucet(page, strings.receive.en.faucetTitle, 'from the Overview');
  assert.equal(await page.page.evaluate(() => location.hash), '#faucet');
  assert.equal(await page.text('faucet-ask'), wallet.getCoins);

  // Back, and the Overview is there again.
  await page.page.goBack();
  await arrivesAt(page, '/wallet');
  await page.waitFor('no-coins');

  // The same from Coins and from Activity.
  for (const [path, id] of [
    ['/wallet/coins', 'coins-empty'],
    ['/wallet/activity', 'activity-empty'],
  ] as const) {
    await toSection(page, path);
    await page.waitFor(id);
    await page.page.locator(hook(id) + ' a').click();
    await arrivesAt(page, '/wallet/receive');
    await landsOnFaucet(page, strings.receive.en.faucetTitle, 'from ' + path);
  }

  // The wallet's own "Receive" link still opens the screen at its top, with focus on its heading.
  await toSection(page, '/wallet');
  await toSection(page, '/wallet/receive');
  await page.waitFor('faucet-ask');
  assert.equal(await focusOf(page), 'H1');
  assert.equal(await page.page.evaluate(() => window.scrollY), 0);

  // A page load at the faucet's address (a reload, a link from elsewhere): the card is drawn only
  // once the wallet's first look at its coins is done, and comes on screen then. In Spanish.
  await page.goto('/es/wallet/receive#faucet');
  await landsOnFaucet(page, strings.receive.es.faucetTitle, 'after a page load');
  assert.equal(await page.sidewaysScroll(), 0);
});

scenario(
  'a wallet is removed and then restored: Home says that it was removed, the Overview says that it was restored, each for one visit, on the page and to a screen reader',
  { localOnly: true },
  async (s) => {
    fundTestWallet(s.standIn);
    const page = await s.open('/wallet/settings', { record: testRecord(), width: 375 });
    await page.waitFor('remove-wallet');
    await page.click('remove-wallet');
    await page.waitFor('remove-confirm');
    await untilAnswersCount();
    await page.click('remove-confirm');

    // Home, which would otherwise read as a first visit ("It may have erased its copy...").
    await arrivesAt(page, '/');
    await page.waitFor('home-removed');
    assert.equal(await noticeOf(page, 'home-removed'), home.removed);
    assert.equal(await page.waitForStatus(home.removed), home.removed);
    // Above the way to a new wallet.
    const above = await page.page.$eval('main', (main) => {
      const note = main.querySelector('[data-testid="home-removed"]');
      const create = main.querySelector('[data-testid="home-create"]');
      return note !== null && create !== null && (note.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    assert.equal(above, true);
    assert.equal(await page.stored(), null);

    // For that one visit: on the next one Home is the plain Home again.
    await page.page.locator('main a[href="/about"]').click();
    await arrivesAt(page, '/about');
    await page.page.goBack();
    await arrivesAt(page, '/');
    await page.waitFor('home-create');
    assert.equal(await countOf(page, 'home-removed'), 0);

    // The wallet comes back from its 12 words: the practice network knows its coins, so it is stored at once.
    await page.click('home-restore');
    await arrivesAt(page, '/restore');
    await typeWords(page, TEST_WORDS.split(' '));
    await page.click('restore-check');
    await page.click('restore-go');
    await arrivesAt(page, '/wallet');
    await page.waitFor('overview-restored');
    assert.equal(await noticeOf(page, 'overview-restored'), wallet.restoredHere);
    assert.equal(await page.waitForStatus(wallet.restoredHere), wallet.restoredHere);
    await page.waitFor('total');
    assert.equal(await page.text('total'), '142,500 practice sats');
    // Once: another screen and back, and the Overview is the plain Overview.
    await toSection(page, '/wallet/coins');
    await toSection(page, '/wallet');
    await page.waitFor('total');
    assert.equal(await countOf(page, 'overview-restored'), 0);
    // A page load of the Overview says nothing either: it was not a restore.
    await page.goto('/wallet');
    await page.waitFor('total');
    assert.equal(await countOf(page, 'overview-restored'), 0);

    // "Keep them here anyway", for words the network knows nothing of, ends the same way.
    const fresh = freshRecord();
    const second = await s.open('/restore', { width: 375 });
    await typeWords(second, (fresh.mnemonic ?? '').split(' '));
    await second.click('restore-check');
    await second.click('restore-go');
    await second.waitFor('restore-keep');
    await second.click('restore-keep');
    await arrivesAt(second, '/wallet');
    await second.waitFor('overview-restored');
    assert.equal(await noticeOf(second, 'overview-restored'), wallet.restoredHere);
    assert.equal(await second.waitForStatus(wallet.restoredHere), wallet.restoredHere);
  },
);

// -- a page the browser brings back from its memory ---------------------------------------------------------

/** What the page was told each time it was shown, written down by a listener the scenario put there. */
type Shown = { __shows?: boolean[] };

/**
 * Marks the document that is showing, and has it note every time it is
 * shown again and whether the browser brought it back whole from its memory
 * (pageshow, persisted). A document that is loaded anew has no such mark.
 */
const markDocument = (page: OpenedPage): Promise<void> =>
  page.page.evaluate(() => {
    const shows: boolean[] = [];
    (window as unknown as Shown).__shows = shows;
    window.addEventListener('pageshow', (event) => shows.push(event.persisted));
  });

/** How often the marked document was brought back from the browser's memory. Null: this is not the marked document. */
const broughtBack = (page: OpenedPage): Promise<number | null> =>
  page.page.evaluate(() => {
    const shows = (window as unknown as Shown).__shows;
    return shows === undefined ? null : shows.filter((persisted) => persisted).length;
  });

/**
 * Presses the browser's Back button until the marked document is on the
 * screen again, brought back from the browser's memory `times` times in
 * all. A press that only moves inside the app, and one that loads a page,
 * each count as one press.
 */
async function backToMarked(page: OpenedPage, times: number): Promise<void> {
  const trail: string[] = [];
  for (let press = 1; press <= 10; press++) {
    await page.page.goBack().catch(() => null);
    await sleep(250);
    const back = await broughtBack(page).catch(() => null);
    trail.push(await page.page.evaluate(() => `${location.host}${location.pathname}`).catch(() => '(on its way)'));
    if (back === times) return;
  }
  throw new Error(`the page the reader left did not come back from the browser's memory, so nothing was shown about it: ${trail.join(' <- ')}`);
}

/** What the status region holds right now: what a screen reader that goes there is told. Empty: nothing. */
const statusNow = (page: OpenedPage): Promise<string> => textOf(page, hook('status'));

scenario(
  'The Overview\'s line after a restore, "This browser now keeps them", is drawn only while it is so: brought back from the browser\'s memory with Back it still stands over the wallet that was restored, and it is gone over that same wallet once it is behind its passkey again, and over another wallet; the status region stops saying it when the line goes, also when a second tab removes the wallet and the gate takes the Overview\'s place',
  { timeout: 300_000 },
  async (s) => {
    const c = strings.common.en;
    // Another site, on this machine. The reader leaves the wallet for it in the same tab, as "Back to the
    // chapter" takes them to the main site, and comes back with the browser's Back button.
    const otherSite = await s.elsewhere();

    // -- The same wallet, back behind its passkey. --
    const page = await standBy(s, { passkey: 'prf', allow: [otherSite], timeout: 30_000 });
    await page.goto('/new');
    await page.waitFor('create-passkey');
    const made = await createFrom(page, 'create-passkey');
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    // The drill of chapter 4: removed, and restored from the 12 words. (The practice network knows no history
    // of this new wallet, so the reader chooses to keep the words here.)
    await toSection(page, '/wallet/settings');
    await page.click('remove-wallet');
    await page.waitFor('remove-confirm');
    await untilAnswersCount();
    await page.click('remove-confirm');
    await arrivesAt(page, '/');
    await page.click('home-restore');
    await arrivesAt(page, '/restore');
    await typeWords(page, made.words);
    await page.click('restore-check');
    await page.click('restore-go');
    await page.waitFor('restore-keep');
    await page.click('restore-keep');
    await arrivesAt(page, '/wallet');
    await page.waitFor('overview-restored');
    assert.equal(await noticeOf(page, 'overview-restored'), wallet.restoredHere);
    assert.equal(wallet.restoredHere, 'This wallet was restored from its 12 words. This browser now keeps them.');
    assert.deepEqual([(await storedRecord(page))?.kind, (await storedRecord(page))?.fingerprint], ['words', made.record.fingerprint]);
    // Said to a screen reader as well, and kept in the status region for as long as the address stays.
    await until(async () => (await statusNow(page)) === wallet.restoredHere, 'the status region says that the wallet was restored');
    await markDocument(page);

    // The reader leaves for another site in this tab, and comes straight back with Back. The browser brings
    // the page back as it was. Nothing has changed: the line is still true, and it still stands.
    await page.page.goto(`${otherSite}/chapter`, { waitUntil: 'load' });
    await backToMarked(page, 1);
    await page.waitFor('wallet-fingerprint');
    assert.equal(await page.text('wallet-fingerprint'), made.record.fingerprint);
    assert.equal(await noticeOf(page, 'overview-restored'), wallet.restoredHere);
    assert.equal(await statusNow(page), wallet.restoredHere, 'still true, so still said');

    // The reader leaves again, comes back to the wallet by its address (a page of its own), removes the
    // wallet there and opens it with its passkey: the same wallet, and this browser keeps no words of it now.
    await page.page.goto(`${otherSite}/chapter`, { waitUntil: 'load' });
    await page.goto('/wallet/settings');
    await page.click('remove-wallet');
    await page.waitFor('remove-confirm');
    await untilAnswersCount();
    await page.click('remove-confirm');
    await arrivesAt(page, '/');
    await page.page.bringToFront();
    await page.click('open-passkey');
    await arrivesAt(page, '/wallet');
    await page.waitFor('wallet-fingerprint');
    const behind = await storedRecord(page);
    assert.deepEqual([behind?.kind, behind?.fingerprint, behind?.mnemonic], ['passkey', made.record.fingerprint, undefined]);

    // Back, until the Overview the reader left is on the screen again: out of the browser's memory, as it was.
    await backToMarked(page, 2);
    // The page looks at what is stored when it is shown again, so it shows the wallet as this browser keeps
    // it now: locked behind its passkey.
    await until(async () => (await countOf(page, 'lock-state')) === 1, 'the Overview shows the wallet behind its passkey');
    assert.ok((await page.text('lock-state')).startsWith(c.stateLocked));
    assert.equal(await page.text('wallet-fingerprint'), made.record.fingerprint);
    assert.equal((await storedRecord(page))?.kind, 'passkey');
    // And it does not say that this browser keeps the 12 words: it keeps none.
    assert.equal(await countOf(page, 'overview-restored'), 0, 'the line outlived the state it was said of');
    assert.ok(!(await textOf(page, 'main')).includes('This browser now keeps them'));
    // Nor does the status region go on saying it, where a screen reader would still be told: the address has
    // not changed, so nothing else would have emptied it.
    await until(async () => (await statusNow(page)) === '', 'the status region no longer says that this browser keeps the 12 words');
    assert.ok(!(await textOf(page, 'body')).includes('This browser now keeps them'), 'no part of the page says it, seen or read out');

    // -- Another wallet in its place. --
    const fresh = freshRecord();
    const second = await s.open('/restore', { allow: [otherSite], timeout: 30_000 });
    await typeWords(second, (fresh.mnemonic ?? '').split(' '));
    await second.click('restore-check');
    await second.click('restore-go');
    await second.waitFor('restore-keep');
    await second.click('restore-keep');
    await arrivesAt(second, '/wallet');
    await second.waitFor('overview-restored');
    assert.equal(await second.text('wallet-fingerprint'), fresh.fingerprint);
    await markDocument(second);
    await second.page.goto(`${otherSite}/chapter`, { waitUntil: 'load' });
    // Back by the wallet's address: removed, and a new wallet made in its place, also kept with its words.
    await second.goto('/wallet/settings');
    await second.click('remove-wallet');
    await second.waitFor('remove-confirm');
    await untilAnswersCount();
    await second.click('remove-confirm');
    await arrivesAt(second, '/');
    await second.click('home-create');
    await arrivesAt(second, '/new');
    await second.waitFor('create-words');
    const other = await createFrom(second, 'create-words');
    assert.notEqual(other.record.fingerprint, fresh.fingerprint);
    await second.click('words-written');
    await arrivesAt(second, '/wallet');

    await backToMarked(second, 1);
    await until(async () => (await second.text('wallet-fingerprint')) === other.record.fingerprint, 'the Overview shows the wallet that is in the browser now');
    // That wallet was made here a moment ago. It was never restored: the line must not stand over it.
    assert.equal(await countOf(second, 'overview-restored'), 0, 'the line stands over a wallet it was never said of');
    await until(async () => !(await statusNow(second)).includes('This browser now keeps them'), 'the status region does not say it of that wallet either');

    // -- The wallet removed in a second tab, while the first stays on the Overview. --
    const kept = freshRecord();
    const third = await s.open('/restore', { timeout: 30_000 });
    await typeWords(third, (kept.mnemonic ?? '').split(' '));
    await third.click('restore-check');
    await third.click('restore-go');
    await third.waitFor('restore-keep');
    await third.click('restore-keep');
    await arrivesAt(third, '/wallet');
    await third.waitFor('overview-restored');
    assert.equal(await third.text('wallet-fingerprint'), kept.fingerprint);
    await until(async () => (await statusNow(third)) === wallet.restoredHere, 'the status region says that the wallet was restored');
    const loads = third.responses.filter((response) => response.type === 'document').length;
    // Another tab of the same browser: the wallet is removed there, on Settings.
    const tab = await s.open('/wallet/settings', { context: third.context, timeout: 30_000 });
    await tab.page.bringToFront();
    await tab.click('remove-wallet');
    await tab.waitFor('remove-confirm');
    await untilAnswersCount();
    await tab.click('remove-confirm');
    await arrivesAt(tab, '/');
    assert.equal(await tab.stored(), null);
    // The first tab, which nobody touched: at the same address the gate has taken the Overview's place.
    await third.page.bringToFront();
    await headingBecomes(third, wallet.gateNoneTitle);
    assert.equal(await third.page.evaluate(() => location.pathname), '/wallet');
    assert.equal(third.responses.filter((response) => response.type === 'document').length, loads, 'no page was loaded for it');
    assert.equal(await countOf(third, 'overview-restored'), 0);
    assert.equal(await countOf(third, 'wallet-fingerprint'), 0);
    // This browser keeps no wallet and none of its words now, and no part of the page says that it does: the
    // status region was emptied when the gate took the screen's place, as it is when the address changes.
    await until(async () => (await statusNow(third)) === '', 'the status region is empty under the gate');
    assert.ok(!(await textOf(third, 'body')).includes('This browser now keeps them'), 'no part of the page says it, seen or read out');
  },
);

scenario('Backup: the unlock step has a way back to the warnings and the button, and typed words that were refused are not called valid once they are changed', async (s) => {
  const page = await standBy(s, { passkey: 'prf', width: 375, timeout: 30_000 });
  await page.goto('/new');
  await page.waitFor('create-passkey');
  const { words } = await createFrom(page, 'create-passkey');
  await page.click('words-written');
  await arrivesAt(page, '/wallet');
  await page.click('lock');
  await page.waitForGone('lock');
  await toSection(page, '/wallet/backup');

  // "Show the 12 words" leads to the unlock step, which takes the screen's first view away.
  await page.click('reveal-words');
  await page.waitFor('unlock-step');
  assert.equal(await countOf(page, 'reveal-words'), 0);
  assert.equal(await countOf(page, 'backup-exception'), 0);
  // The way back is under the step, and fills the column as the step's own button fills its card.
  assert.equal(await page.text('backup-unlock-back'), common.back);
  const widths = await page.page.evaluate(() =>
    ['unlock', 'backup-unlock-back'].map((id) => Math.round(document.querySelector('[data-testid="' + id + '"]')?.getBoundingClientRect().width ?? 0)),
  );
  assert.ok(widths[0]! > 200 && widths[1]! > widths[0]!, JSON.stringify(widths));
  await page.click('backup-unlock-back');
  await page.waitFor('reveal-words');
  assert.equal(await countOf(page, 'unlock-step'), 0);
  assert.equal(await countOf(page, 'backup-exception'), 1);
  assert.equal(await focusOf(page), 'reveal-words');
  assert.equal(await headingOf(page), common.section_backup);
  assert.equal(await page.text('lock-state'), common.stateLocked);

  // Again, and this time the passkey's prompt is closed and the reader types words: another wallet's.
  await page.click('reveal-words');
  await page.waitFor('unlock-step');
  await refuseNextGet(page);
  await page.click('unlock');
  await page.waitFor('unlock-problem');
  await page.click('unlock-words');
  await typeWords(page, OTHER_WORDS.split(' '));
  await page.click('unlock-words-go');
  await until(async () => (await page.texts('unlock-problem')).some((text) => text.startsWith('These 12 words are valid')), 'the words are refused as another wallet\'s');
  assert.equal(await noticeOf(page, 'unlock-problem'), wallet.unlockOtherWallet);

  // The reader sets about correcting them. The first field now holds a word that is no word: the
  // screen says so, and no longer says "These 12 words are valid" under it.
  const first = (await page.page.$$(hook('word-input')))[0]!;
  await first.click({ count: 3 });
  await first.type('zzzz');
  await page.page.waitForFunction(() => document.querySelector('[data-testid="unlock-problem"]') === null);
  await (await page.page.$$(hook('word-input')))[1]!.focus();
  await page.page.waitForFunction(
    (text) => (document.querySelector('[data-testid="unlock-step"]')?.textContent ?? '').includes(text),
    {},
    fill(wallet.wordsUnknown, { n: '1' }),
  );
  assert.equal(await countOf(page, 'unlock-problem'), 0);

  // Leaving the fields by the step's way back empties them. The step starts afresh the next time
  // (one button, until a try has failed), and the right words then unlock.
  await page.click('backup-unlock-back');
  await page.waitFor('reveal-words');
  await page.click('reveal-words');
  await page.waitFor('unlock-step');
  assert.equal(await countOf(page, 'word-input'), 0);
  assert.equal(await countOf(page, 'unlock-words'), 0);
  await refuseNextGet(page);
  await page.click('unlock');
  await page.waitFor('unlock-problem');
  await page.click('unlock-words');
  await page.waitFor('word-input');
  assert.deepEqual(
    await page.page.$$eval(hook('word-input'), (fields) => fields.map((field) => (field as HTMLInputElement).value).filter((value) => value !== '')),
    [],
  );
  await typeWords(page, words);
  await page.click('unlock-words-go');
  assert.deepEqual(await wordsOnScreen(page), words);
  assert.equal(await headingOf(page), backup.shownTitle);
});

scenario(
  'Send: the document\'s title follows the step, and a reader who leaves at the review and comes back finds the form as it was, until the payment is sent',
  { localOnly: true },
  async (s) => {
    fundTestWallet(s.standIn);
    const titled = (screen: string): string => fill(common.markerTitle, { screen });
    const page = await s.open('/wallet', { record: testRecord() });
    await page.waitFor('total');
    await toSection(page, '/wallet/send');
    await page.waitFor('send-spendable');
    assert.equal(await page.page.title(), titled(common.section_send));

    await page.fill('send-to', SOMEBODY);
    await page.fill('send-amount', '30,000');
    await page.fill('send-fee', '3');
    await page.waitFor('send-plan');
    await page.click('send-continue');
    await page.waitFor('send-review');
    // The step has its own heading, and the tab reads the same.
    await headingBecomes(page, send.reviewTitle);
    assert.equal(await page.page.title(), titled(send.reviewTitle));

    // The browser's Back at the review leaves Send altogether (the steps are no history entries).
    await page.page.goBack();
    await arrivesAt(page, '/wallet');
    // Forward: the form, as it was left. The signed payment is gone, as it must be; the plan is made again.
    await page.page.goForward();
    await arrivesAt(page, '/wallet/send');
    await page.waitFor('send-plan');
    assert.deepEqual([await heldBy(page, 'send-to'), await heldBy(page, 'send-amount'), await heldBy(page, 'send-fee')], [SOMEBODY, '30,000', '3']);
    assert.equal(await countOf(page, 'send-review'), 0);
    assert.equal(await page.page.title(), titled(common.section_send));
    // The same by a section link and back.
    await toSection(page, '/wallet/coins');
    await toSection(page, '/wallet/send');
    await page.waitFor('send-plan');
    assert.deepEqual([await heldBy(page, 'send-to'), await heldBy(page, 'send-amount'), await heldBy(page, 'send-fee')], [SOMEBODY, '30,000', '3']);

    // Sent: the heading and the title say so, and the ID has the name it has on every other screen.
    await page.click('send-continue');
    await page.waitFor('send-review');
    await page.click('send-broadcast');
    await page.waitFor('sent-link');
    await headingBecomes(page, send.sentTitle);
    assert.equal(await page.page.title(), titled(send.sentTitle));
    assert.equal(await textOf(page, hook('sent-txid') + ' dt'), wallet.txId);
    const txid = ((await attributeOf(page, 'sent-link', 'href')) ?? '').slice(-64);
    assert.equal(await textOf(page, hook('sent-txid') + ' dd'), txid);

    // What was sent is not offered a second time: a reader who leaves now and comes back finds an empty form.
    await toSection(page, '/wallet/coins');
    await toSection(page, '/wallet/send');
    await page.waitFor('send-to');
    assert.deepEqual([await heldBy(page, 'send-to'), await heldBy(page, 'send-amount'), await heldBy(page, 'send-fee')], ['', '', '2']);
    // And a page load forgets a form that was only typed: nothing of it is kept in the browser.
    await page.fill('send-to', SOMEBODY);
    await page.fill('send-amount', '1,000');
    await page.goto('/wallet/send');
    await page.waitFor('send-to');
    assert.deepEqual([await heldBy(page, 'send-to'), await heldBy(page, 'send-amount')], ['', '']);
    assert.deepEqual(await page.page.evaluate(() => [Object.keys(localStorage), sessionStorage.length]), [['lbp_wallet_v1'], 0]);
  },
);

scenario('on a phone, the line that says a passkey wallet is unlocked shares its row with the Lock button wherever the sentence keeps a readable column', async (s) => {
  const page = await standBy(s, { passkey: 'prf', width: 375, height: 667, timeout: 30_000 });
  await page.goto('/new');
  await page.waitFor('create-passkey');
  await createFrom(page, 'create-passkey');
  await page.click('words-written');
  await arrivesAt(page, '/wallet');
  await page.waitFor('lock');

  /** Where the sentence and the button of the lock line stand, and where the screen's heading starts. */
  const measure = (): Promise<{ sameRow: boolean; under: boolean; column: number; heading: number; sideways: number }> =>
    page.page.evaluate(() => {
      const line = document.querySelector('[data-testid="lock-state"]');
      const sentence = line?.querySelector('p')?.getBoundingClientRect();
      const button = line?.querySelector('[data-testid="lock"]')?.getBoundingClientRect();
      const heading = document.querySelector('main h1')?.getBoundingClientRect();
      if (!sentence || !button || !heading) throw new Error('the lock line is not on the page');
      return {
        sameRow: button.left >= sentence.right && button.top < sentence.bottom && button.bottom > sentence.top,
        under: button.top >= sentence.bottom,
        column: Math.round(sentence.width),
        heading: Math.round(heading.top + window.scrollY),
        sideways: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      };
    });

  // 375 px, English and Spanish: one row. The sentence wraps beside the button, which costs no line of its own.
  const english = await measure();
  assert.deepEqual([english.sameRow, english.sideways], [true, 0], JSON.stringify(english));
  assert.ok(english.column >= 192, JSON.stringify(english));
  await page.page.evaluate(() => window.scrollTo(0, 0));
  await page.click('lang-switch');
  await arrivesAt(page, '/es/wallet');
  const spanish = await measure();
  assert.deepEqual([spanish.sameRow, spanish.sideways], [true, 0], JSON.stringify(spanish));
  assert.ok(spanish.column >= 192, JSON.stringify(spanish));

  // 320 px. In English the sentence still has its column beside the short button.
  await page.page.setViewport({ width: 320, height: 568, deviceScaleFactor: 1 });
  await page.page.evaluate(() => window.scrollTo(0, 0));
  await page.click('lang-switch');
  await arrivesAt(page, '/wallet');
  const narrow = await measure();
  assert.deepEqual([narrow.sameRow, narrow.sideways], [true, 0], JSON.stringify(narrow));
  assert.ok(narrow.column >= 192, JSON.stringify(narrow));
  // In Spanish the longer button would leave the sentence a sliver: there the button goes under it, as before.
  await page.page.evaluate(() => window.scrollTo(0, 0));
  await page.click('lang-switch');
  await arrivesAt(page, '/es/wallet');
  const narrowSpanish = await measure();
  assert.deepEqual([narrowSpanish.sameRow, narrowSpanish.under, narrowSpanish.sideways], [false, true, 0], JSON.stringify(narrowSpanish));

  // On a wide screen nothing changed: the button stands right after the sentence, not at the far edge.
  await page.page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  const wide = await page.page.evaluate(() => {
    const line = document.querySelector('[data-testid="lock-state"]');
    const sentence = line!.querySelector('p')!.getBoundingClientRect();
    const button = line!.querySelector('[data-testid="lock"]')!.getBoundingClientRect();
    return Math.round(button.left - sentence.right);
  });
  assert.equal(wide, 16, 'the gap between the sentence and the Lock button on a wide screen');
});
