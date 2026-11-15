// What this browser stored, and what becomes of the wallet when that
// changes behind the page: the storage is cleared, the wallet's passkey is
// gone from the device, the stored record is edited between two page loads,
// one wallet takes another's place, something unreadable lands where the
// record goes, or another tab makes or removes a wallet.
//
// A passkey wallet's record is all this browser has of it: which passkey to
// ask, the public key the screens show addresses from, the wallet
// fingerprint that names it. None of it is secret, and nothing vouches for
// it: whoever can write this origin's storage can change any of it. The
// keys are not there to be changed. So the next unlock is where a changed
// record is found out, and these journeys hold what the reader is then
// told, and what is done to the record, on the screens where they meet it.
//
// Every wallet here is made through the real Create screen. The record is
// altered where a page of this origin that is not the app stands
// (robots.txt): between two loads of the app, so the app never sees the
// change happen, only its result.

import assert from 'node:assert/strict';
import type { EventBody } from '@learnbitcoin/practice-contract';
import { strings } from '../../app/src/strings/index.ts';
import { OTHER_WORDS, fundTestWallet, scenario, testRecord, type OpenedPage, type Scenario } from './helpers.ts';
import {
  NOTHING_REMEMBERED,
  RECORD_KEY,
  arrivesAt,
  assertNoWordsRemembered,
  attributeOf,
  broadcastsOf,
  countOf,
  countedBy,
  countedExactly,
  createFrom,
  figuresOf,
  focusOf,
  headingBecomes,
  heldBy,
  hook,
  makePasskey,
  noticeOf,
  nothingPrivate,
  onNetwork,
  passkeyRecordOf,
  patternMemory,
  pressAndRemember,
  refuseNextGet,
  rowOf,
  sentTxid,
  standBy,
  storageKeys,
  storedRecord,
  toSection,
  typeWords,
  untilAnswersCount,
  untilCounted,
  usesOf,
  watchEventRequests,
  watchPrompts,
  wordsOnScreen,
  type Made,
} from './journey-helpers.ts';

const common = strings.common.en;
const errors = strings.errors.en;
const wallet = strings.wallet.en;
const home = strings.home.en;
const settings = strings.settings.en;

/** An address that is neither the wallet's nor the pot's: the first address of the harness's second wallet. */
const SOMEBODY = testRecord(OTHER_WORDS).firstAddress;

/** The lock line of an unlocked passkey wallet, with its button. */
const UNLOCKED = `${common.stateUnlocked} ${common.lock}`;

const view = (path: string): EventBody => ({ name: 'pageview', path });

/** What every journey here begins with, as counted: a wallet made with a passkey on Create, and its "Wallet made" step. */
const MADE: EventBody[] = [
  view('/new'),
  { name: 'Passkey', path: '/new', value: 'ok' },
  { name: 'Wallet created', path: '/new', value: 'passkey' },
  view('/wallet/backup'),
  { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
];

/** The headings of the screen, in page order: "H1 Overview", "H2 ...". */
const headingsOf = (page: OpenedPage): Promise<string[]> =>
  page.page.$$eval('main h1, main h2, main h3, main h4', (all) => all.map((heading) => `${heading.tagName} ${(heading.textContent ?? '').replace(/\s+/g, ' ').trim()}`));

/** A page with a passkey wallet that Create has just made, at its "Wallet made" step, and the watchers every journey here uses. */
async function madeWithPasskey(s: Scenario) {
  const page = await standBy(s, { passkey: 'prf', timeout: 30_000 });
  const prompts = await watchPrompts(page);
  const requests = watchEventRequests(page);
  await page.goto('/new');
  await page.waitFor('create-passkey');
  const made = await createFrom(page, 'create-passkey');
  assert.equal(await page.stored(), JSON.stringify(passkeyRecordOf(made)));
  return { page, prompts, requests, made };
}

/**
 * Puts `text` where the wallet's record is stored (or takes the record away,
 * with null) while the app is not running: the page stands on robots.txt,
 * the storage is changed, and the app is then loaded at `path`.
 */
async function behindThePage(page: OpenedPage, text: string | null, path: string): Promise<void> {
  await page.goto('/robots.txt');
  await page.store(RECORD_KEY, text);
  await page.goto(path);
}

// -- the storage was cleared ------------------------------------------------------------------------

scenario(
  'the browser forgot the wallet, and its passkey brings it back from Home: the same wallet, with its coins and its keys, counted as "opened"',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    const { page, prompts, requests, made } = await madeWithPasskey(s);
    const { record, words } = made;
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    const funding = s.standIn.fund(record.firstAddress, 50_000);

    // The browser forgets the site's data, as Safari does after a week without use. The passkey stays with the device.
    await behindThePage(page, null, '/');
    await page.waitFor('open-passkey');
    assert.equal(await page.stored(), null);
    assert.equal(await countOf(page, 'wallet-here'), 0);
    assert.equal(await countOf(page, 'home-create'), 1);

    // One prompt, and the wallet is back: on the Overview, with its coins, as a wallet that has a history.
    await page.page.bringToFront();
    await page.click('open-passkey');
    await arrivesAt(page, '/wallet');
    await page.waitFor('coin');
    assert.equal(await page.text('total'), '50,000 practice sats');
    const coins = await page.texts('coin');
    assert.equal(coins.length, 1);
    assert.ok(coins[0]!.startsWith('50,000 practice sats') && coins[0]!.includes(record.firstAddress), coins[0]);
    assert.equal(await countOf(page, 'opened-empty'), 0);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });
    assert.equal(await usesOf(page), 1);
    // The same wallet: what is stored again is what Create had stored, but for the moment it was written.
    const back = await storedRecord(page);
    assert.ok(back !== null);
    assert.deepEqual({ ...back, createdAt: record.createdAt }, passkeyRecordOf(made));
    assert.deepEqual(await page.texts('passkey-tag'), [record.tag]);
    assert.deepEqual(await page.texts('wallet-fingerprint'), [record.fingerprint]);
    // Open leaves the keys loaded: the lock line says so, and the 12 words come with no second prompt.
    assert.equal(await page.text('lock-state'), UNLOCKED);
    await untilCounted(s, 'Unlock');
    await toSection(page, '/wallet/activity');
    await page.waitFor('tx-row');
    assert.deepEqual(await page.page.$$eval(hook('tx-row'), (rows) => rows.map((row) => row.getAttribute('href'))), [`/wallet/tx/${funding}`]);
    await toSection(page, '/wallet/backup');
    // Each press is made from inside the page, and what the page's patterns remember is read in the
    // same breath. When the words have been put on screen: nothing. The wallet wiped it as it handed
    // them over, and nothing since has run a pattern over them.
    assert.deepEqual(await pressAndRemember(page, 'reveal-words'), NOTHING_REMEMBERED);
    assert.deepEqual(await wordsOnScreen(page), words, 'the passkey gave the same 12 words as when the wallet was made');
    assert.equal(await countOf(page, 'unlock-step'), 0);
    // And when they have been taken off it again: none of them.
    const shown = await page.page.evaluate(() => `${document.documentElement.textContent ?? ''}\n${document.documentElement.outerHTML}`);
    assertNoWordsRemembered(await pressAndRemember(page, 'hide-words'), words, shown, 'as the words are hidden');
    await page.waitForGone('word');
    // And a payment is signed with no further prompt: the review of the signed payment follows "Continue" at once.
    await toSection(page, '/wallet/send');
    await page.waitFor('send-spendable');
    await page.fill('send-to', SOMEBODY);
    await page.fill('send-amount', '10,000');
    await page.waitFor('send-plan');
    await page.click('send-continue');
    await page.waitFor('send-review');
    assert.equal(await countOf(page, 'unlock-step'), 0);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });
    // Lock, with the signed payment on screen: it is dropped with the keys. The form is back, with what was typed.
    await page.click('lock');
    await headingBecomes(page, common.section_send);
    assert.equal(await countOf(page, 'send-review'), 0);
    assert.equal(await countOf(page, 'send-broadcast'), 0);
    assert.equal(await page.text('lock-state'), common.stateLocked);
    assert.deepEqual([await heldBy(page, 'send-to'), await heldBy(page, 'send-amount')], [SOMEBODY, '10,000']);
    assert.equal(broadcastsOf(s), 0, 'nothing was sent');
    assert.deepEqual(await s.network.coins(SOMEBODY), { count: 0, sats: 0 });

    await countedExactly(s, page, requests, [
      ...MADE,
      view('/wallet'),
      view('/'),
      view('/wallet'),
      { name: 'Unlock', path: '/wallet', value: 'opened' },
      view('/wallet/activity'),
      view('/wallet/backup'),
      { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
      view('/wallet/send'),
    ]);
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      { records: [record, back], words: [words], addresses: [record.firstAddress], txids: [funding] },
    );
  },
);

scenario(
  'a passkey whose wallet was never used is opened from Home: the Overview gives the three likely causes, and "Choose another passkey" asks before this browser holds another wallet',
  async (s) => {
    const { page, prompts, requests, made } = await madeWithPasskey(s);
    const { record, words } = made;
    await behindThePage(page, null, '/');
    await page.waitFor('open-passkey');
    await page.page.bringToFront();
    await page.click('open-passkey');
    await arrivesAt(page, '/wallet');

    // No history: the three causes, the most likely first, with this wallet's own two names where they are spoken of.
    await page.waitFor('opened-empty');
    assert.deepEqual(await headingsOf(page), [
      `H1 ${common.section_wallet}`,
      `H2 ${wallet.emptyOpenedTitle}`,
      `H3 ${wallet.emptyNewTitle}`,
      `H3 ${wallet.emptyOtherTitle}`,
      `H3 ${wallet.emptyChangedTitle}`,
    ]);
    assert.deepEqual(await page.texts('passkey-tag'), [record.tag]);
    assert.deepEqual(await page.texts('wallet-fingerprint'), [record.fingerprint]);
    assert.equal(await attributeOf(page, 'opened-faucet', 'href'), '/wallet/receive#faucet');
    assert.equal(await page.text('lock-state'), UNLOCKED);
    await untilCounted(s, 'Unlock');
    const opened = (await page.stored()) ?? '';
    assert.deepEqual({ ...(JSON.parse(opened) as object), createdAt: record.createdAt }, passkeyRecordOf(made));

    // A second practice passkey on the device, and the reader picks it: here, by its being the only one the device still has.
    const other = await makePasskey(page);
    await page.passkey!.remove(record.credentialId ?? '');
    await page.click('opened-choose');
    await page.waitFor('switch-question');
    assert.equal(await focusOf(page), 'switch-question');
    assert.equal(await page.text('switch-question'), wallet.switchLead);
    // Asked, and nothing has changed: the record, the keys, and whose names the screen shows.
    assert.equal(await page.stored(), opened);
    assert.equal(await page.text('lock-state'), UNLOCKED);
    assert.deepEqual(await page.texts('passkey-tag'), [record.tag]);
    assert.deepEqual(await page.texts('wallet-fingerprint'), [record.fingerprint]);
    assert.ok(!page.statusLog().includes(wallet.noticeLocked), page.statusLog().join(' | '));

    // "Keep this wallet": still nothing has changed.
    await page.click('switch-cancel');
    await page.waitForGone('switch-question');
    assert.equal(await page.stored(), opened);
    assert.equal(await focusOf(page), 'opened-choose');

    // Asked again, and "Switch to that wallet": only now does this browser hold the other passkey's wallet.
    await page.click('opened-choose');
    await page.waitFor('switch-question');
    await page.click('switch-confirm');
    await page.waitFor('unlock-note');
    assert.equal(await noticeOf(page, 'unlock-note'), wallet.noteSwitched);
    const now = await storedRecord(page);
    assert.ok(now !== null);
    assert.equal(now.credentialId, other);
    assert.notEqual(now.fingerprint, record.fingerprint);
    assert.notEqual(now.xpub, record.xpub);
    await page.waitFor('no-coins');
    assert.equal(await countOf(page, 'opened-empty'), 0);
    assert.deepEqual(await page.texts('wallet-fingerprint'), [now.fingerprint]);
    assert.equal(await page.text('lock-state'), UNLOCKED);
    // In all the app asked the device four times: the create, the open, and twice the picker. (The
    // second create() is the scenario's own, for the other passkey.)
    assert.deepEqual(await prompts.asked(), { create: 2, get: 3 });

    await countedExactly(s, page, requests, [
      ...MADE,
      view('/'),
      view('/wallet'),
      { name: 'Unlock', path: '/wallet', value: 'opened-empty' },
      { name: 'Unlock', path: '/wallet', value: 'other-passkey' },
      { name: 'Unlock', path: '/wallet', value: 'other-passkey' },
    ]);
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      { records: [record, now], words: [words], addresses: [record.firstAddress, now.firstAddress], txids: [] },
    );
  },
);

scenario(
  'the device no longer holds the wallet\'s passkey: the unlock step offers another, asks before this browser holds that wallet, and Backup shows no words until they are asked for again',
  async (s) => {
    const { page, prompts, requests, made } = await madeWithPasskey(s);
    const { record, words } = made;
    const original = JSON.stringify(passkeyRecordOf(made));
    // A page load locks the wallet. Meanwhile its passkey was deleted from the device, which holds another practice passkey.
    await page.goto('/wallet/backup');
    await page.waitFor('reveal-words');
    const other = await makePasskey(page);
    await page.passkey!.remove(record.credentialId ?? '');

    // The words are asked for. The passkey this browser remembers cannot answer: the cause, and the other two ways on.
    await page.click('reveal-words');
    await page.waitFor('unlock-step');
    assert.deepEqual([await countOf(page, 'unlock'), await countOf(page, 'unlock-picker'), await countOf(page, 'unlock-words')], [1, 0, 0]);
    await page.click('unlock');
    await page.waitFor('unlock-problem');
    assert.ok((await page.text('unlock-problem')).includes(errors.passkey_cancelled));
    assert.deepEqual([await countOf(page, 'unlock'), await countOf(page, 'unlock-picker'), await countOf(page, 'unlock-words')], [1, 1, 1]);

    // "Choose another passkey": the other one answers. It is another wallet's, and the step asks before anything changes.
    await page.click('unlock-picker');
    await page.waitFor('switch-question');
    assert.equal(await focusOf(page), 'switch-question');
    assert.equal(await page.stored(), original);
    assert.equal(await page.text('lock-state'), common.stateLocked);
    assert.equal(await countOf(page, 'word'), 0);

    // "Switch to that wallet": this browser holds it now, unlocked, and the frame says so. The words that were
    // asked for were the other wallet's, so none are shown: the screen asks again.
    await page.click('switch-confirm');
    await page.waitFor('unlock-note');
    assert.equal(await noticeOf(page, 'unlock-note'), wallet.noteSwitched);
    await page.waitFor('reveal-words');
    assert.equal(await countOf(page, 'word'), 0);
    assert.equal(await countOf(page, 'unlock-step'), 0);
    assert.equal(await page.text('lock-state'), UNLOCKED);
    const now = await storedRecord(page);
    assert.ok(now !== null);
    assert.equal(now.credentialId, other);
    assert.notEqual(now.xpub, record.xpub);
    assert.equal(now.mnemonic, undefined);
    // Asked for now, the words of the wallet that is here come at once: 12 other words, which give its public key.
    await page.click('reveal-words');
    const theirs = await wordsOnScreen(page);
    assert.notDeepEqual(theirs, words);
    assert.equal(passkeyRecordOf({ record: now, words: theirs }).xpub, now.xpub);
    // The app asked the device three times: the create, the passkey it remembered (which was gone), and the
    // picker. (The second create() is the scenario's own, for the other passkey.) One get() was answered.
    assert.deepEqual(await prompts.asked(), { create: 2, get: 2 });
    assert.equal(await usesOf(page), 1);

    await countedExactly(s, page, requests, [
      ...MADE,
      view('/wallet/backup'),
      { name: 'Unlock', path: '/wallet/backup', value: 'cancelled' },
      { name: 'Unlock', path: '/wallet/backup', value: 'other-passkey' },
      { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
    ]);
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      { records: [record, now], words: [words, theirs], addresses: [record.firstAddress, now.firstAddress], txids: [] },
    );
  },
);

// -- the stored record was altered between two page loads -------------------------------------------------

scenario(
  'the stored public key was replaced by another wallet\'s: the next unlock, on Send, notices; no payment is signed from the other wallet\'s coins, the record is rebuilt, and the reader is told',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    const { page, prompts, requests, made } = await madeWithPasskey(s);
    const { record, words } = made;
    const original = JSON.stringify(passkeyRecordOf(made));
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    // This wallet holds one coin. The wallet whose public key is about to be put in its record holds three.
    const funding = s.standIn.fund(record.firstAddress, 50_000);
    const theirs = fundTestWallet(s.standIn);
    const other = testRecord();

    // Behind the page: another wallet's public key (and the first address that goes with it), under
    // this wallet's fingerprint and this wallet's passkey. It reads as a sound record.
    await behindThePage(page, JSON.stringify({ ...record, xpub: other.xpub, firstAddress: other.firstAddress }), '/wallet');
    await page.waitFor('total');
    // Looking needs no key, so nothing can notice yet: the screens show the other wallet's coins as this one's.
    assert.equal(await page.text('total'), '142,500 practice sats');
    assert.equal(await page.text('lock-state'), common.stateLocked);
    assert.deepEqual(await page.texts('wallet-fingerprint'), [record.fingerprint]);

    // The reader plans a payment from those coins. A plan needs no key either.
    await toSection(page, '/wallet/send');
    await page.waitFor('send-spendable');
    assert.equal(await rowOf(page, 'main', 'send-spendable'), '140,000 practice sats');
    await page.fill('send-to', SOMEBODY);
    await page.fill('send-amount', '30,000');
    await page.waitFor('send-plan');
    assert.equal((await figuresOf(page, 'send-plan')).change, '69,718 practice sats');
    await page.click('send-continue');
    await page.waitFor('unlock-step');

    // The unlock: the passkey gives this wallet's keys, which fit the stored fingerprint and not the stored public key.
    await page.click('unlock');
    await page.waitFor('unlock-note');
    assert.equal(await noticeOf(page, 'unlock-note'), wallet.noteTampered);
    assert.equal(await page.page.$$eval(`${hook('unlock-note')}[role="alert"]`, (alerts) => alerts.length), 1, 'the note is read out');
    assert.equal(await usesOf(page), 1);
    // Nothing was signed and nothing sent: the plan was made from coins that are not this wallet's. The form is back.
    await headingBecomes(page, common.section_send);
    assert.equal(await countOf(page, 'send-review'), 0);
    assert.equal(broadcastsOf(s), 0);
    // The record was written again from the keys: it is what Create had stored.
    assert.equal(await page.stored(), original);
    // The coins are looked up again from nothing, and are this wallet's own now. What was typed is still in the form.
    await page.page.waitForFunction(
      (selector) => (document.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim() === '50,000 practice sats',
      {},
      `main ${hook('send-spendable')} dd`,
    );
    assert.deepEqual([await heldBy(page, 'send-to'), await heldBy(page, 'send-amount')], [SOMEBODY, '30,000']);
    await page.waitFor('send-plan');
    const plan = await figuresOf(page, 'send-plan');
    assert.equal(plan.change, '19,718 practice sats');

    // The keys are loaded, so the payment now goes out with no second prompt, from this wallet's own coin.
    await page.click('send-continue');
    await page.waitFor('send-review');
    await page.click('send-broadcast');
    const txid = await sentTxid(page);
    assert.equal(await usesOf(page), 1);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });
    const tx = await onNetwork(s, txid);
    assert.deepEqual(tx.vin.map((input) => [input.prevout.value, input.prevout.scriptpubkey_address]), [[50_000, record.firstAddress]]);
    // The other wallet's coins were never touched.
    assert.deepEqual(await s.network.coins(other.firstAddress), { count: 1, sats: 100_000 });
    assert.equal(broadcastsOf(s), 1);

    await countedExactly(s, page, requests, [
      ...MADE,
      view('/wallet'),
      view('/wallet'),
      view('/wallet/send'),
      { name: 'Unlock', path: '/wallet/send', value: 'tampered' },
      { name: 'Payment', path: '/wallet/send', value: 'sent' },
    ]);
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      {
        records: [record, other],
        words: [words],
        addresses: [record.firstAddress, other.firstAddress, SOMEBODY, ...theirs.map((coin) => coin.address)],
        txids: [funding, txid, ...theirs.map((coin) => coin.txid)],
      },
    );
  },
);

scenario(
  'the stored wallet fingerprint was changed: the next unlock, on Backup, notices; the record is rebuilt, the reader is told, and the 12 words shown are this wallet\'s',
  async (s) => {
    const { page, requests, made } = await madeWithPasskey(s);
    const { record, words } = made;
    const original = JSON.stringify(passkeyRecordOf(made));
    const wrong = record.fingerprint === '00000000' ? '11111111' : '00000000';

    await behindThePage(page, JSON.stringify({ ...record, fingerprint: wrong }), '/wallet/settings');
    // Settings shows what is stored: the wrong wallet fingerprint, beside the right first address.
    assert.equal(await page.text('wallet-fingerprint'), wrong);
    assert.equal(await page.text('first-address'), record.firstAddress);
    assert.equal(await page.text('lock-state'), common.stateLocked);

    await toSection(page, '/wallet/backup');
    await page.click('reveal-words');
    await page.waitFor('unlock-step');
    await page.click('unlock');
    // The keys fit the stored public key and not the stored fingerprint: the record was altered. The
    // words are this wallet's all the same, so they show, under the note that says what was put right.
    assert.deepEqual(await wordsOnScreen(page), words);
    assert.equal(await noticeOf(page, 'unlock-note'), wallet.noteTampered);
    assert.equal(await page.stored(), original);
    assert.equal(await usesOf(page), 1);
    assert.equal(await page.text('lock-state'), UNLOCKED);
    await toSection(page, '/wallet/settings');
    assert.equal(await page.text('wallet-fingerprint'), record.fingerprint);

    await countedExactly(s, page, requests, [
      ...MADE,
      view('/wallet/settings'),
      view('/wallet/backup'),
      { name: 'Unlock', path: '/wallet/backup', value: 'tampered' },
      { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
      view('/wallet/settings'),
    ]);
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [] },
    );
  },
);

scenario(
  'the stored public key and wallet fingerprint were both replaced: the next unlock opens nothing and overwrites nothing, warns, and the way out it names (Remove, then Open with the passkey) brings the reader\'s own wallet back',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    const { page, prompts, requests, made } = await madeWithPasskey(s);
    const { record, words } = made;
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    const funding = s.standIn.fund(record.firstAddress, 50_000);
    const theirs = fundTestWallet(s.standIn);
    const other = testRecord();

    // Behind the page: another wallet's public key, first address and wallet fingerprint under this
    // wallet's passkey. Nothing in the record now fits the keys the passkey gives.
    const replaced = JSON.stringify({ ...record, xpub: other.xpub, firstAddress: other.firstAddress, fingerprint: other.fingerprint });
    await behindThePage(page, replaced, '/wallet/backup');
    await page.waitFor('reveal-words');
    await page.click('reveal-words');
    await page.waitFor('unlock-step');
    await page.click('unlock');

    // Never opened: the cause (which allows for both things it can be), the warning by itself, and the two ways out.
    await page.waitFor('unlock-problem');
    const said = await page.text('unlock-problem');
    for (const part of [wallet.unlockChanged, wallet.unlockChangedWarn, wallet.unlockChangedWords, wallet.unlockChangedRemove]) {
      assert.ok(said.includes(part), part);
    }
    assert.equal(await page.text('unlock-changed-warning'), wallet.unlockChangedWarn);
    assert.equal(await page.page.$$eval(`${hook('unlock-problem')}[role="alert"]`, (alerts) => alerts.length), 1);
    assert.equal(await usesOf(page), 1, 'the passkey did answer');
    assert.equal(await page.text('lock-state'), common.stateLocked);
    assert.equal(await countOf(page, 'word'), 0);
    // Nothing was overwritten: what is stored is exactly what was put there.
    assert.equal(await page.stored(), replaced);
    // The same passkey would only give the same answer: the step offers the 12 words, and no second try.
    assert.deepEqual([await countOf(page, 'unlock'), await countOf(page, 'unlock-picker'), await countOf(page, 'unlock-words')], [0, 0, 1]);

    // The way out the text names: Settings, Remove, and then open with the passkey.
    await page.page.locator(`${hook('unlock-problem')} a[href="/wallet/settings"]`).click();
    await arrivesAt(page, '/wallet/settings');
    await page.click('remove-wallet');
    await page.waitFor('remove-confirm');
    // The question names what brings a passkey wallet back, and promises no passkey.
    assert.equal(await page.text('remove-back'), settings.removeBackPasskey);
    await untilAnswersCount();
    await page.click('remove-confirm');
    await arrivesAt(page, '/');
    assert.equal(await page.stored(), null);
    await page.click('open-passkey');
    await arrivesAt(page, '/wallet');
    await page.waitFor('coin');
    // The reader's own wallet, with its own coin: nothing of the other wallet is left in this browser.
    const back = await storedRecord(page);
    assert.ok(back !== null);
    assert.deepEqual({ ...back, createdAt: record.createdAt }, passkeyRecordOf(made));
    assert.equal(await page.text('total'), '50,000 practice sats');
    assert.deepEqual(await page.texts('wallet-fingerprint'), [record.fingerprint]);
    assert.equal(await page.text('lock-state'), UNLOCKED);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 2 });

    await countedExactly(s, page, requests, [
      ...MADE,
      view('/wallet'),
      view('/wallet/backup'),
      { name: 'Unlock', path: '/wallet/backup', value: 'changed' },
      view('/wallet/settings'),
      { name: 'Wallet removed', path: '/wallet/settings', value: 'passkey' },
      view('/'),
      view('/wallet'),
      { name: 'Unlock', path: '/wallet', value: 'opened' },
    ]);
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      {
        records: [record, other],
        words: [words],
        addresses: [record.firstAddress, other.firstAddress, ...theirs.map((coin) => coin.address)],
        txids: [funding, ...theirs.map((coin) => coin.txid)],
      },
    );
  },
);

scenario(
  'the passkey fails and the 12 words unlock: the keys load for this page, a payment goes out, nothing is stored, and a page load locks the wallet again',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    const { page, prompts, requests, made } = await madeWithPasskey(s);
    const { record, words } = made;
    const original = JSON.stringify(passkeyRecordOf(made));
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    const funding = s.standIn.fund(record.firstAddress, 50_000);
    await page.goto('/wallet/backup');
    await page.waitFor('reveal-words');
    assert.equal(await page.text('lock-state'), common.stateLocked);

    // From here on the device refuses every prompt, as when the passkey is lost or its prompt is closed.
    await page.passkey!.refuse();
    await page.click('reveal-words');
    await page.waitFor('unlock-step');
    await page.click('unlock');
    await page.waitFor('unlock-problem');
    assert.ok((await page.text('unlock-problem')).includes(errors.passkey_cancelled));
    assert.equal(await page.text('lock-state'), common.stateLocked);

    // "Use the 12 words": typed from the paper copy, they load the keys. The press is made from inside
    // the page, so that what the page's patterns remember is read the moment the press's own work is
    // done (the wallet has taken the typed words, and the screen has put the wallet's words on show):
    // nothing. The words do not lie where any script of the page could read them back.
    await page.click('unlock-words');
    await typeWords(page, words);
    assert.deepEqual(await pressAndRemember(page, 'unlock-words-go'), NOTHING_REMEMBERED);
    assert.deepEqual(await wordsOnScreen(page), words);
    assert.equal(await page.text('lock-state'), UNLOCKED);
    assert.equal(await page.waitForStatus(wallet.noticeUnlocked), wallet.noticeUnlocked);
    // Nothing was stored: the record is as Create wrote it, with no words in it, and nothing else is kept anywhere.
    assert.equal(await page.stored(), original);
    assert.deepEqual(await storageKeys(page), ['lbp_wallet_v1']);
    assert.equal(await page.page.evaluate(() => sessionStorage.length), 0);
    // Off the screen again, and still nothing of them is remembered.
    const shown = (): Promise<string> => page.page.evaluate(() => `${document.documentElement.textContent ?? ''}\n${document.documentElement.outerHTML}`);
    await page.click('hide-words');
    await page.waitForGone('word');
    assertNoWordsRemembered(await patternMemory(page), words, await shown(), 'after the words were hidden');

    // The keys work as a passkey's would: a payment is signed and sent, with no prompt.
    await toSection(page, '/wallet/send');
    await page.waitFor('send-spendable');
    await page.fill('send-to', SOMEBODY);
    await page.fill('send-amount', '10,000');
    await page.waitFor('send-plan');
    await page.click('send-continue');
    await page.waitFor('send-review');
    assert.equal(await countOf(page, 'unlock-step'), 0);
    await page.click('send-broadcast');
    const txid = await sentTxid(page);
    assert.deepEqual(await s.network.coins(SOMEBODY), { count: 1, sats: 10_000 });

    // Lock: the keys are dropped, and the same look in the same breath finds nothing left behind.
    assert.deepEqual(await pressAndRemember(page, 'lock'), NOTHING_REMEMBERED);
    await page.waitForGone('lock');
    assert.equal(await page.text('lock-state'), common.stateLocked);
    assertNoWordsRemembered(await patternMemory(page), words, await shown(), 'after Lock');
    assert.equal(await page.stored(), original);

    // A page load, and the wallet is locked as before: nothing was kept that could open it. The words are asked for again.
    await page.goto('/wallet/backup');
    await page.waitFor('reveal-words');
    assert.equal(await page.text('lock-state'), common.stateLocked);
    await page.click('reveal-words');
    await page.waitFor('unlock-step');
    assert.equal(await countOf(page, 'word'), 0);
    assert.equal(await page.stored(), original);
    // The device answered no prompt at all: the one get() was refused.
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });
    assert.equal(await usesOf(page), 0);

    await countedExactly(s, page, requests, [
      ...MADE,
      view('/wallet'),
      view('/wallet/backup'),
      { name: 'Unlock', path: '/wallet/backup', value: 'cancelled' },
      { name: 'Unlock', path: '/wallet/backup', value: 'words' },
      { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
      view('/wallet/send'),
      { name: 'Payment', path: '/wallet/send', value: 'sent' },
      view('/wallet/backup'),
    ]);
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      { records: [record], words: [words], addresses: [record.firstAddress, SOMEBODY], txids: [funding, txid] },
    );
  },
);

// -- one wallet after another -------------------------------------------------------------------------------

scenario(
  'one wallet is removed and another restored in the same page: no screen ever shows a coin, an address or a transaction of the first',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    // The first wallet holds three coins. The second, whose words the reader has on paper, holds one.
    const paid = fundTestWallet(s.standIn);
    const first = testRecord();
    const second = testRecord(OTHER_WORDS);
    const theirs = s.standIn.fund(second.firstAddress, 7_000);
    const page = await s.open('/wallet/activity', { record: first, timeout: 30_000 });
    await page.waitFor('tx-row');
    assert.equal((await page.texts('tx-row')).length, 3);
    await toSection(page, '/wallet/settings');
    await page.click('remove-wallet');
    await page.waitFor('remove-confirm');
    await untilAnswersCount();
    await page.click('remove-confirm');
    await arrivesAt(page, '/');

    // From here on, and without a page load in between: is anything of the first wallet ever on a screen?
    // Its addresses, its transactions, its totals. The page still holds whatever it had read about it.
    await page.page.evaluate(
      (old) => {
        const seen: string[] = [];
        (window as unknown as { __journeyStale: string[] }).__journeyStale = seen;
        const look = (): void => {
          const text = document.querySelector('main')?.textContent ?? '';
          for (const id of old.txids) if (document.querySelector(`[href="/wallet/tx/${id}"]`) !== null) seen.push(`${location.pathname}: a link to its transaction ${id}`);
          for (const address of old.addresses) if (text.includes(address)) seen.push(`${location.pathname}: its address ${address}`);
          for (const total of old.totals) if (text.includes(total)) seen.push(`${location.pathname}: its total ${total}`);
        };
        new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true });
      },
      { txids: paid.map((coin) => coin.txid), addresses: [first.firstAddress, ...paid.map((coin) => coin.address)], totals: ['142,500', '140,000'] },
    );
    await page.click('home-restore');
    await arrivesAt(page, '/restore');
    await typeWords(page, OTHER_WORDS.split(' '));
    await page.click('restore-check');
    await page.click('restore-go');
    await arrivesAt(page, '/wallet');
    await page.waitFor('coin');
    assert.equal(await page.text('total'), '7,000 practice sats');
    assert.deepEqual(await page.texts('wallet-fingerprint'), [second.fingerprint]);
    const links = (): Promise<(string | null)[]> => page.page.$$eval(hook('tx-row'), (rows) => rows.map((row) => row.getAttribute('href')));
    await page.waitFor('tx-row');
    assert.deepEqual(await links(), [`/wallet/tx/${theirs}`]);
    // Every screen of the second wallet in turn.
    for (const path of ['/wallet/coins', '/wallet/receive', '/wallet/send', '/wallet/activity', '/wallet/backup', '/wallet/settings']) {
      await toSection(page, path);
      await page.settle();
    }
    assert.equal(await page.text('first-address'), second.firstAddress);
    await toSection(page, '/wallet/activity');
    await page.waitFor('tx-row');
    assert.deepEqual(await links(), [`/wallet/tx/${theirs}`]);
    assert.deepEqual(await page.page.evaluate(() => (window as unknown as { __journeyStale: string[] }).__journeyStale), []);
    // The first wallet's coins are where they were: on the practice network, untouched.
    assert.deepEqual(await s.network.coins(first.firstAddress), { count: 1, sats: 100_000 });
  },
);

scenario(
  'something unreadable lands in this browser\'s storage while a new passkey waits to be finished: Create stops and offers Remove, and after it "Finish setting up" makes the wallet from the passkey that waited',
  async (s) => {
    const page = await standBy(s, { passkey: 'prf-at-get', timeout: 30_000 });
    const requests = watchEventRequests(page);
    await page.goto('/new');
    await page.waitFor('create-passkey');
    await page.page.bringToFront();
    // The reader dismisses the second prompt, the one that asks the new passkey for its secret.
    await refuseNextGet(page);
    await page.click('create-passkey');
    await page.waitFor('finish-setup');
    const waiting = await page.text('create-unfinished');
    const [passkey] = await page.passkey!.credentials();
    assert.ok(passkey !== undefined && passkey.uses === 0);
    assert.equal(await page.stored(), null);

    // Another tab of this browser leaves something under the wallet's key that is no wallet. (The tab
    // stands on a page of this origin that is not the app, so nothing is counted for it.)
    const other = await s.open('/robots.txt', { context: page.context });
    await other.store(RECORD_KEY, '{"v":1,"kind":"nonsense"}');
    await page.page.bringToFront();
    // Create steps aside for it: nothing can be made over something that cannot be read.
    await page.waitFor('remove-wallet');
    assert.ok((await page.page.$eval('main', (main) => main.textContent ?? '')).includes(wallet.unreadableBody));
    for (const gone of ['finish-setup', 'create-passkey', 'create-words']) assert.equal(await countOf(page, gone), 0, gone);
    // The passkey that waits was not given up: nobody can tell whose wallet the unreadable thing is.
    assert.deepEqual((await page.passkey!.credentials()).map((each) => each.id), [passkey.id]);

    // "Remove what is stored", and the passkey is still waiting where it was.
    await page.click('remove-wallet');
    await page.waitFor('remove-confirm');
    await untilAnswersCount();
    await page.click('remove-confirm');
    await page.waitFor('finish-setup');
    assert.equal(await page.stored(), null);
    assert.equal(await page.text('create-unfinished'), waiting);
    const made = await createFrom(page, 'finish-setup');
    assert.equal(made.record.credentialId, passkey.id);
    assert.equal(await page.stored(), JSON.stringify(passkeyRecordOf(made)));
    assert.deepEqual((await page.passkey!.credentials()).map((each) => [each.id, each.uses]), [[passkey.id, 1]]);

    await countedExactly(s, page, requests, [
      view('/new'),
      { name: 'Passkey', path: '/new', value: 'unfinished' },
      { name: 'Passkey', path: '/new', value: 'finished' },
      { name: 'Wallet created', path: '/new', value: 'passkey' },
      view('/wallet/backup'),
      { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
    ]);
  },
);

// -- other tabs ------------------------------------------------------------------------------------------

scenario(
  'three tabs: a wallet made in one stops Create in the second and shows on About in the third; removed in the second, it leaves the first empty; put back, the first holds it locked',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    // Two tabs of one browser on Create, each with a device that could make a passkey, and a third on About.
    const { page: first, prompts, made } = await madeWithPasskeyBeside(s);
    const { second, third, record, words } = made;
    const original = JSON.stringify(passkeyRecordOf(made));
    /** Waits until About's "in this browser right now" line, in the third tab, says this. */
    const aboutSays = (kept: 'none' | 'passkey'): Promise<unknown> =>
      third.page.waitForFunction((want) => document.querySelector('[data-testid="about-kept-now"]')?.getAttribute('data-kept') === want, {}, kept);
    await aboutSays('passkey');

    // -- The second tab hears of the wallet: nothing more can be made there, and it says which wallet is here --
    await second.waitFor('wallet-here');
    assert.equal(await second.text('wallet-here-kind'), home.herePasskeyTagged.replace('{tag}', record.tag ?? ''));
    for (const gone of ['create-passkey', 'create-words', 'finish-setup']) assert.equal(await countOf(second, gone), 0, gone);
    assert.equal(await second.stored(), original);
    assert.deepEqual(await second.passkey!.credentials(), [], 'no passkey was made in the second tab');

    // -- The first tab goes on: coins arrive, and it is unlocked, as Create left it --
    await first.click('words-written');
    await arrivesAt(first, '/wallet');
    await toSection(first, '/wallet/receive');
    s.standIn.fund(record.firstAddress, 50_000);
    await first.waitForStatus('arrived');
    await toSection(first, '/wallet');
    await first.waitFor('coin');
    assert.equal(await first.text('total'), '50,000 practice sats');
    assert.equal(await first.text('lock-state'), UNLOCKED);

    // -- The second tab opens the same wallet, locked (its keys were never loaded there), and removes it --
    await second.page.bringToFront();
    await second.click('wallet-open');
    await arrivesAt(second, '/wallet');
    await second.waitFor('coin');
    assert.equal(await second.text('total'), '50,000 practice sats');
    assert.equal(await second.text('lock-state'), common.stateLocked);
    await toSection(second, '/wallet/settings');
    await second.click('remove-wallet');
    await second.waitFor('remove-confirm');
    await untilAnswersCount();
    await second.click('remove-confirm');
    await arrivesAt(second, '/');
    assert.equal(await second.stored(), null);
    await aboutSays('none');

    // -- The first tab is emptied where it stands: no total, no coins, no lock line; the gate, at the same address --
    await headingBecomes(first, wallet.gateNoneTitle);
    assert.equal(await first.page.evaluate(() => location.pathname), '/wallet');
    for (const gone of ['total', 'coin', 'lock-state', 'lock', 'tx-row']) assert.equal(await countOf(first, gone), 0, gone);
    assert.equal(await first.stored(), null);

    // -- And its keys went with the wallet. The same record is put back (as another tab's restore would), and
    //    the first tab shows the wallet again, with its coins: locked now, where it was unlocked before. --
    await second.store(RECORD_KEY, original);
    await aboutSays('passkey');
    await headingBecomes(first, common.section_wallet);
    assert.equal(await first.text('lock-state'), common.stateLocked);
    assert.equal(await countOf(first, 'lock'), 0);
    // A tab that is not in view reads nothing from the practice network. Brought to the front, it looks at once.
    await first.page.bringToFront();
    await first.waitFor('coin');
    assert.equal(await first.text('total'), '50,000 practice sats');
    assert.equal(await first.text('lock-state'), common.stateLocked);
    // Asked for the 12 words, it wants the passkey first. The passkey is this tab's own, and still gives them.
    await toSection(first, '/wallet/backup');
    await first.click('reveal-words');
    await first.waitFor('unlock-step');
    assert.equal(await countOf(first, 'word'), 0);
    assert.equal(await usesOf(first), 0);
    await first.click('unlock');
    assert.deepEqual(await wordsOnScreen(first), words);
    assert.equal(await usesOf(first), 1);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });

    // -- One wallet was made and one removed, each counted once, in the tab that did it. The words of one
    //    wallet, shown twice in one page, are counted once. --
    await untilCounted(s, 'Unlock');
    const counted = await countedBy(s, first, second);
    const named = (name: EventBody['name']): EventBody[] => counted.filter((event) => event.name === name);
    assert.deepEqual(named('Wallet created'), [{ name: 'Wallet created', path: '/new', value: 'passkey' }]);
    assert.deepEqual(named('Wallet removed'), [{ name: 'Wallet removed', path: '/wallet/settings', value: 'passkey' }]);
    assert.deepEqual(named('Unlock'), [{ name: 'Unlock', path: '/wallet/backup', value: 'same' }]);
    assert.deepEqual(named('Words shown'), [{ name: 'Words shown', path: '/wallet/backup', value: 'passkey' }]);
    assert.deepEqual(named('Passkey'), [{ name: 'Passkey', path: '/new', value: 'ok' }]);
  },
);

/**
 * Two tabs of one browser, both on Create, and a passkey wallet made in the
 * first. Gives the first tab with its watchers, and the second tab beside
 * what was made.
 */
async function madeWithPasskeyBeside(
  s: Scenario,
): Promise<{ page: OpenedPage; prompts: Awaited<ReturnType<typeof watchPrompts>>; made: Made & { second: OpenedPage; third: OpenedPage } }> {
  const page = await standBy(s, { passkey: 'prf', timeout: 30_000 });
  const prompts = await watchPrompts(page);
  await page.goto('/new');
  const second = await s.open('/new', { context: page.context, passkey: 'prf', timeout: 30_000 });
  await second.waitFor('create-words');
  const third = await s.open('/about', { context: page.context, timeout: 30_000 });
  await third.waitFor('about-kept-now');
  assert.equal(await attributeOf(third, 'about-kept-now', 'data-kept'), 'none');
  // A tab takes a click only while it is the one in front.
  await page.page.bringToFront();
  await page.waitFor('create-passkey');
  const made = await createFrom(page, 'create-passkey');
  return { page, prompts, made: { ...made, second, third } };
}
