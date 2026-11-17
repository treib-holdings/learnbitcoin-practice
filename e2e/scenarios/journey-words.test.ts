// A wallet kept with its 12 words, across every screen: made without a
// passkey through the real Create screen, in Spanish on a phone, and then
// the same 12 words in another browser.
//
// The words are the whole wallet here. The browser keeps them, so nothing
// on the way may ask for a passkey: the first journey is opened with a
// device that could give one, and holds that it was never asked. Typed
// into another browser, the words must bring back the same wallet: the same
// first address, the same coins, the same next address to be paid at. And
// what a browser says about a wallet goes by how that browser keeps it,
// never by how the wallet was made: a passkey wallet's words, typed into a
// browser that has no passkey for it, make a wallet "kept with its 12
// words" there, and every screen says so.
//
// The last two journeys follow coins instead of keys, between screens and
// between readers: a payment to the wallet's own address, which Send, the
// transaction's screen and Receive each tell in their own way; and a coin
// passed on to the pot, which comes out with the next reader's first coins.

import assert from 'node:assert/strict';
import type { EventBody } from '@learnbitcoin/practice-contract';
import { accountDescriptor, deriveAddress, watchOnlyAccount } from '@learnbitcoin/practice-wallet';
import { SAFARI_KEEPS_DAYS } from '../../app/src/components/wallet/frame.ts';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { OTHER_WORDS, fundTestWallet, scenario, testRecord, type OpenedPage } from './helpers.ts';
import {
  RECORD_KEY,
  arrivesAt,
  assertSignedAsPlanned,
  attributeOf,
  botCheckScripts,
  countOf,
  countedBy,
  countedExactly,
  createFrom,
  documentsOf,
  figuresOf,
  headerLink,
  headingBecomes,
  headingOf,
  heldBy,
  hook,
  loads,
  nothingPrivate,
  onNetwork,
  rowOf,
  satsIn,
  sentBy,
  sentTxid,
  standBy,
  storageKeys,
  storedRecord,
  switchLanguage,
  textOf,
  toSection,
  typeWords,
  untilAnswersCount,
  untilCounted,
  untilPhase,
  watchEventRequests,
  watchPrompts,
  wordsOnScreen,
} from './journey-helpers.ts';

const en = {
  common: strings.common.en,
  wallet: strings.wallet.en,
  home: strings.home.en,
  receive: strings.receive.en,
  restore: strings.restore.en,
  send: strings.send.en,
  settings: strings.settings.en,
  about: strings.about.en,
};
const es = {
  common: strings.common.es,
  wallet: strings.wallet.es,
  home: strings.home.es,
  backup: strings.backup.es,
  receive: strings.receive.es,
  send: strings.send.es,
  settings: strings.settings.es,
};

/** An address that is neither the wallet's nor the pot's: the first address of the harness's second wallet. */
const SOMEBODY = testRecord(OTHER_WORDS).firstAddress;

/** The text of the screen's content, as one line. */
const mainText = (page: OpenedPage): Promise<string> =>
  page.page.$eval('main', (main) => (main.textContent ?? '').replace(/\s+/g, ' ').trim());

/** On a phone no screen may be wider than the phone. */
async function fits(page: OpenedPage, where: string): Promise<void> {
  assert.equal(await page.sidewaysScroll(), 0, `${where} scrolls sideways`);
}

scenario(
  'a wallet made without a passkey, start to finish, in Spanish on a phone: Create, what this browser keeps, the faucet, a payment, the words again, Settings, Remove, and back from the 12 words, here and in a second browser; no passkey prompt anywhere',
  { localOnly: true, timeout: 180_000 },
  async (s) => {
    // Two keys of other things on this origin: Remove, at the end, must leave them alone.
    const others = { lb_progress_v1: '{"kept":"by another page"}', another_key: 'stays' };
    // A device that could make a passkey: that none is asked for is then this wallet's doing, not the device's.
    const page = await standBy(s, { lang: 'es', width: 375, passkey: 'prf', storage: others, timeout: 30_000 });
    const prompts = await watchPrompts(page);
    const requests = watchEventRequests(page);
    await page.goto('/es');

    // -- Home, in Spanish --
    assert.equal(await page.page.evaluate(() => document.documentElement.lang), 'es');
    assert.equal(await page.text('home-create'), es.wallet.gateCreate);
    await fits(page, 'Home');
    await page.click('home-create');
    await arrivesAt(page, '/es/new');
    await page.waitFor('create-words');
    await fits(page, 'Create');

    // -- Create without a passkey, and "Wallet made": the 12 words, and what this browser now keeps --
    const made = await createFrom(page, 'create-words', '/es');
    const { record, words } = made;
    assert.equal(await headingOf(page), es.backup.madeTitle);
    assert.deepEqual([record.kind, record.mnemonic, record.credentialId, record.tag], ['words', words.join(' '), undefined, undefined]);
    assert.equal(await page.text('made-keeps'), `${es.backup.madeKeepsWords} ${es.backup.madeKeepsWho}`);
    const madeText = await mainText(page);
    assert.ok(madeText.includes(fill(es.backup.madeKeepsCleared, { days: String(SAFARI_KEEPS_DAYS) })), madeText);
    assert.equal(await page.text('never-real-money'), es.backup.neverRealMoney);
    // The words stay English on a Spanish screen, marked so that no translating browser touches them, and the screen says why.
    assert.deepEqual(
      await page.page.$eval(`ol:has(${hook('word')})`, (list) => [list.getAttribute('lang'), list.getAttribute('translate')]),
      ['en', 'no'],
    );
    assert.ok(madeText.includes(es.wallet.wordsEnglishCopy));
    // Whether the browser agreed to keep this page's data is said as the browser itself answers it.
    const kept = await page.page.evaluate(() => navigator.storage.persisted());
    if (!kept) await page.waitFor('made-not-persisted');
    assert.equal(await countOf(page, 'made-not-persisted'), kept ? 0 : 1);
    // No passkey in sight: no name, no tag, no lock line.
    for (const absent of ['passkey-name', 'passkey-tag', 'made-passkey', 'lock-state']) assert.equal(await countOf(page, absent), 0, absent);
    assert.deepEqual(await storageKeys(page), ['another_key', 'lb_progress_v1', 'lbp_wallet_v1']);
    await fits(page, '"Wallet made"');

    // -- The Overview of a wallet with no coins points to the faucet --
    await page.click('words-written');
    await arrivesAt(page, '/es/wallet');
    await page.waitFor('no-coins');
    assert.ok((await page.text('no-coins')).startsWith(es.wallet.noCoins));
    await fits(page, 'the Overview');
    await page.page.locator(`${hook('no-coins')} a`).click();
    await arrivesAt(page, '/es/wallet/receive');

    // -- Receive: the faucet pays the address on screen --
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    assert.equal(address, record.firstAddress);
    // A wallet kept with its words has nothing to lock, and is not told that asking locks it.
    assert.equal(await countOf(page, 'faucet-locks'), 0);
    const documents = documentsOf(page);
    // Before the tap the language switch is a move like any other inside the app: no page is loaded, and the address stays.
    await switchLanguage(page);
    await arrivesAt(page, '/wallet/receive');
    await headingBecomes(page, en.common.section_receive);
    assert.equal(await page.text('receive-address'), address);
    await switchLanguage(page);
    await arrivesAt(page, '/es/wallet/receive');
    await headingBecomes(page, es.common.section_receive);
    assert.equal(documentsOf(page), documents);
    await page.click('faucet-ask');
    await untilPhase(page, 'arrived');
    const faucetTxid = ((await attributeOf(page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    assert.match(faucetTxid, /^[0-9a-f]{64}$/);
    assert.equal(await page.waitForStatus('El faucet le envió'), `El faucet le envió 100,000 sats de práctica a esta dirección.`);
    assert.equal(await page.waitForStatus('Llegaron'), 'Llegaron 100,000 sats de práctica.');
    assert.equal(await page.text('receive-address'), address, 'the address stays');
    const [render] = (await page.turnstileCalls()).filter((call) => call.op === 'render');
    assert.deepEqual([render?.options?.action, render?.options?.cData, render?.options?.language, render?.options?.size], ['faucet', address, 'es', 'compact']);
    await fits(page, 'Receive');
    // A block, so that the coin can be spent.
    await s.network.nextBlock();

    // -- The bot check's script has been in the page, so the next move loads a page: here, the language
    //    switch. The new page has no such script, shows the next address (the first has been paid), and
    //    from it the reader moves about inside the app again. --
    assert.equal(await botCheckScripts(page), 1);
    await loads(page, () => switchLanguage(page));
    await arrivesAt(page, '/wallet/receive');
    assert.equal(documentsOf(page), documents + 1);
    assert.equal(await botCheckScripts(page), 0);
    await page.waitFor('receive-address');
    assert.equal(await page.text('receive-address'), deriveAddress(watchOnlyAccount(record.xpub), 0, 1).address);
    await switchLanguage(page);
    await arrivesAt(page, '/es/wallet/receive');
    // The Overview, which had pointed to the faucet: the total is what the faucet paid.
    await toSection(page, '/es/wallet');
    await page.waitFor('coin');
    assert.equal(await page.text('total'), '100,000 sats de práctica');
    assert.equal(await countOf(page, 'no-coins'), 0);

    // -- Send: a payment to the pot. The wallet is as usable after the page load: its keys are the stored words. --
    await toSection(page, '/es/wallet/send');
    assert.equal(documentsOf(page), documents + 1);
    await page.waitFor('send-spendable');
    await page.click('pass-it-on');
    await page.waitFor('send-to-pot');
    const pot = await heldBy(page, 'send-to');
    await page.fill('send-amount', '30,000');
    await page.waitFor('send-plan');
    const plan = await figuresOf(page, 'send-plan');
    assert.deepEqual([plan.amount, plan.fee, plan.change], ['30,000 sats de práctica', '282 sats de práctica', '69,718 sats de práctica']);
    await fits(page, 'the plan');
    await page.click('send-continue');
    await page.waitFor('send-review');
    await headingBecomes(page, es.send.reviewTitle);
    assert.equal(await countOf(page, 'unlock-step'), 0);
    // The signed payment is the planned one. The wallet's words are new in every run, so its size may be a
    // vbyte or two under the plan's (assertSignedAsPlanned).
    assertSignedAsPlanned(await figuresOf(page, 'send-review'), plan);
    await fits(page, 'the review');
    await page.click('send-broadcast');
    const txid = await sentTxid(page, '/es');
    await headingBecomes(page, es.send.sentTitle);
    assert.equal(await page.waitForStatus(es.wallet.noticeSent), es.wallet.noticeSent);
    const tx = await onNetwork(s, txid);
    assert.equal(tx.fee, satsIn(plan.fee));
    assert.equal(tx.vout.find((output) => output.scriptpubkey_address === pot)?.value, 30_000);
    await fits(page, 'the sent view');

    // -- Backup: the same 12 words, at once. No unlock step and no prompt: the browser keeps them. --
    await toSection(page, '/es/wallet/backup');
    assert.equal(await headingOf(page), es.common.section_backup);
    assert.equal(await countOf(page, 'word'), 0);
    await page.click('reveal-words');
    assert.deepEqual(await wordsOnScreen(page), words);
    await headingBecomes(page, es.backup.shownTitle);
    assert.equal(await countOf(page, 'unlock-step'), 0);
    await fits(page, 'Backup');

    // -- Settings: what this wallet is, and what this browser keeps of it --
    await toSection(page, '/es/wallet/settings');
    assert.equal(await page.text('wallet-kind'), es.settings.kindWords);
    assert.equal(await page.text('wallet-fingerprint'), record.fingerprint);
    assert.equal(await page.text('first-address'), record.firstAddress);
    assert.equal(await page.text('keeps-words'), es.settings.keepsWords);
    assert.equal(await countOf(page, 'keeps-no-words'), 0);
    assert.equal(await countOf(page, 'passkey-tag'), 0);
    assert.equal(await countOf(page, 'word'), 0, 'the words left the screen with Backup');
    await fits(page, 'Settings');

    // -- Remove: the wallet's own key goes, the two others stay as they were, and Home has no wallet --
    await page.click('remove-wallet');
    await page.waitFor('remove-confirm');
    await fits(page, 'the Remove question');
    await untilAnswersCount();
    await page.click('remove-confirm');
    await arrivesAt(page, '/es');
    await page.waitFor('home-create');
    assert.equal(await page.stored(), null);
    assert.deepEqual(await storageKeys(page), ['another_key', 'lb_progress_v1']);
    assert.deepEqual([await page.stored('lb_progress_v1'), await page.stored('another_key')], [others.lb_progress_v1, others.another_key]);
    assert.equal(await countOf(page, 'wallet-here'), 0);
    // The Sparrow guide has no wallet to show a descriptor of, and says so.
    await page.page.locator('footer a[href="/es/sparrow"]').click();
    await arrivesAt(page, '/es/sparrow');
    assert.equal(await attributeOf(page, 'sparrow-need-wallet', 'data-state'), 'none');
    assert.equal(await countOf(page, 'sparrow-descriptor-text'), 0);

    // -- The coins did not go with the wallet, and the 12 words written at Backup bring it back: the same
    //    first address, the same coins. Nothing else was needed, and the two other keys are still as they were. --
    await page.click('sparrow-need-link');
    await arrivesAt(page, '/es');
    await page.click('home-restore');
    await arrivesAt(page, '/es/restore');
    await typeWords(page, words);
    await page.click('restore-check');
    await fits(page, 'Restore');
    await page.click('restore-go');
    await arrivesAt(page, '/es/wallet');
    await page.waitFor('coin');
    assert.equal(await page.text('total'), '69,718 sats de práctica');
    const restored = await storedRecord(page);
    assert.ok(restored !== null);
    assert.deepEqual(
      [restored.kind, restored.mnemonic, restored.xpub, restored.fingerprint, restored.firstAddress],
      ['words', words.join(' '), record.xpub, record.fingerprint, record.firstAddress],
    );
    assert.deepEqual(await storageKeys(page), ['another_key', 'lb_progress_v1', 'lbp_wallet_v1']);
    await page.page.locator('footer a[href="/es/sparrow"]').click();
    await arrivesAt(page, '/es/sparrow');
    assert.equal(await page.text('sparrow-descriptor-text'), accountDescriptor(record.fingerprint, record.xpub, 0));
    assert.equal(await countOf(page, 'sparrow-need-wallet'), 0);
    await fits(page, 'the Sparrow guide');

    // -- No passkey prompt anywhere, and no passkey was made --
    assert.deepEqual(await prompts.asked(), { create: 0, get: 0 });
    assert.deepEqual(await page.passkey!.credentials(), []);

    // -- What was counted, each under the screen and the language it happened in --
    const view = (path: string): EventBody => ({ name: 'pageview', path });
    await countedExactly(s, page, requests, [
      view('/es'),
      view('/es/new'),
      { name: 'Wallet created', path: '/es/new', value: 'words' },
      view('/es/wallet/backup'),
      { name: 'Words shown', path: '/es/wallet/backup', value: 'words' },
      view('/es/wallet'),
      view('/es/wallet/receive'),
      view('/wallet/receive'),
      view('/es/wallet/receive'),
      { name: 'Faucet', path: '/es/wallet/receive', value: 'ok' },
      view('/wallet/receive'),
      view('/es/wallet/receive'),
      view('/es/wallet'),
      view('/es/wallet/send'),
      { name: 'Payment', path: '/es/wallet/send', value: 'sent-to-pot' },
      view('/es/wallet/backup'),
      { name: 'Words shown', path: '/es/wallet/backup', value: 'words' },
      view('/es/wallet/settings'),
      { name: 'Wallet removed', path: '/es/wallet/settings', value: 'words' },
      view('/es'),
      view('/es/sparrow'),
      view('/es'),
      view('/es/restore'),
      { name: 'Restore', path: '/es/restore', value: 'found' },
      view('/es/wallet'),
      view('/es/sparrow'),
    ]);
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      { records: [record, restored], words: [words], addresses: [address, pot], txids: [faucetTxid, txid] },
    );

    // -- And a second browser, which has never held this wallet: the same 12 words find its history there
    //    too, and bring the same first address and the same coins. (The next scenario looks closer at
    //    what Restore does on the way.) --
    const second = await standBy(s, { lang: 'es', width: 375, timeout: 30_000 });
    await second.goto('/es/restore');
    assert.equal(await second.stored(), null);
    await typeWords(second, words);
    await second.click('restore-check');
    await second.click('restore-go');
    await arrivesAt(second, '/es/wallet');
    await second.waitFor('coin');
    assert.equal(await second.text('total'), '69,718 sats de práctica');
    const elsewhere = await storedRecord(second);
    assert.ok(elsewhere !== null);
    assert.deepEqual(
      [elsewhere.kind, elsewhere.mnemonic, elsewhere.xpub, elsewhere.fingerprint, elsewhere.firstAddress],
      ['words', words.join(' '), record.xpub, record.fingerprint, record.firstAddress],
    );
    // Coin for coin, as the first browser lists them (it stands on the Sparrow guide: back into the wallet by its link to Settings).
    await page.click('sparrow-settings-link');
    await arrivesAt(page, '/es/wallet/settings');
    await toSection(page, '/es/wallet/coins');
    await toSection(second, '/es/wallet/coins');
    await page.waitFor('coin');
    await second.waitFor('coin');
    assert.deepEqual(await second.texts('coin'), await page.texts('coin'));
    await fits(second, 'Coins, in the second browser');
  },
);

scenario(
  'the same 12 words in a second browser: Restore finds their history, and the wallet there has the same first address, the same coins and the same next address',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    // -- The first browser: a wallet made without a passkey, paid, and one payment made from it --
    const first = await standBy(s, { timeout: 30_000 });
    await first.goto('/new');
    await first.waitFor('create-words');
    const made = await createFrom(first, 'create-words');
    const { record, words } = made;
    await first.click('words-written');
    await arrivesAt(first, '/wallet');
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    // A page load reads the coins afresh; a wallet kept with its words is as unlocked after it.
    await first.goto('/wallet/send');
    await first.waitFor('send-spendable');
    await first.fill('send-to', SOMEBODY);
    await first.fill('send-amount', '30,000');
    await first.waitFor('send-plan');
    await first.click('send-continue');
    await first.waitFor('send-review');
    await first.click('send-broadcast');
    const txid = await sentTxid(first);
    await toSection(first, '/wallet');
    await first.waitFor('coin');

    // -- The second browser: nothing stored, and no passkey --
    const second = await standBy(s, { timeout: 30_000 });
    const requests = watchEventRequests(second);
    await second.goto('/');
    await second.page.bringToFront();
    await second.click('home-restore');
    await arrivesAt(second, '/restore');
    assert.equal(await second.stored(), null);
    await typeWords(second, words);
    assert.equal(await second.stored(), null, 'typing stores nothing');
    await second.click('restore-check');
    // From here on, in the order it happens: what the page writes to its storage, and each read of the
    // chain as it is asked and as it is answered. And: is the "looking up this wallet's coins" line ever on the Overview?
    await second.page.evaluate(() => {
      const seen = { looking: false, order: [] as string[] };
      (window as unknown as { __journeySeen: typeof seen }).__journeySeen = seen;
      const look = (): void => {
        if (location.pathname === '/wallet' && document.querySelector('[data-testid="chain-looking"]') !== null) seen.looking = true;
      };
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true });
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, key: string, value: string): void {
        seen.order.push(`store ${key}`);
        setItem.call(this, key, value);
      };
      const ask = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href).pathname;
        const chain = path.startsWith('/api/esplora/');
        if (chain) seen.order.push('ask');
        const answer = await ask(input, init);
        if (chain) seen.order.push('answer');
        return answer;
      };
    });
    await second.click('restore-go');
    await arrivesAt(second, '/wallet');

    // The coins are on screen as the screen opens: the look for history was the wallet's first look.
    await second.waitFor('total');
    const watched = await second.page.evaluate(() => (window as unknown as { __journeySeen: { looking: boolean; order: string[] } }).__journeySeen);
    assert.equal(watched.looking, false);
    // Scan first: the record was written once, and every read of the look for history had been
    // answered by then. A wallet with addresses in use on both chains takes more than the 40 reads of an empty one.
    const written = watched.order.indexOf(`store ${RECORD_KEY}`);
    assert.equal(watched.order.filter((line) => line === `store ${RECORD_KEY}`).length, 1, watched.order.join(' '));
    const before = watched.order.slice(0, written);
    assert.ok(before.filter((line) => line === 'answer').length > 40, `${before.filter((line) => line === 'answer').length} reads were answered before the record was written`);
    assert.equal(before.filter((line) => line === 'ask').length, before.filter((line) => line === 'answer').length, 'no read was still open when the record was written');
    // The same wallet: what is stored gives the same public key, wallet fingerprint and first address, from the same words.
    const restored = await storedRecord(second);
    assert.ok(restored !== null);
    assert.deepEqual(
      [restored.kind, restored.mnemonic, restored.xpub, restored.fingerprint, restored.firstAddress],
      ['words', words.join(' '), record.xpub, record.fingerprint, record.firstAddress],
    );
    // The same coins: the total, the part still unconfirmed, and every coin with its address.
    assert.equal(await second.text('total'), '69,718 practice sats');
    assert.equal(await second.text('total'), await first.text('total'));
    assert.equal(await second.text('total-unconfirmed'), await first.text('total-unconfirmed'));
    await second.waitFor('coin');
    const coins = await second.texts('coin');
    assert.deepEqual(coins, await first.texts('coin'));
    assert.equal(coins.length, 1);
    assert.ok(coins[0]!.startsWith('69,718 practice sats') && coins[0]!.includes(en.wallet.coinChange) && coins[0]!.includes(en.common.unconfirmed), coins[0]);
    // The same history, newest first.
    await second.waitFor('tx-row');
    const links = (page: OpenedPage): Promise<(string | null)[]> =>
      page.page.$$eval(hook('tx-row'), (rows) => rows.map((row) => row.getAttribute('href')));
    assert.deepEqual(await links(second), [`/wallet/tx/${txid}`, `/wallet/tx/${funding}`]);
    assert.deepEqual(await links(first), await links(second));
    // The same next address to be paid at: the first one has been used, in both browsers.
    await toSection(second, '/wallet/receive');
    await toSection(first, '/wallet/receive');
    const next = await second.text('receive-address');
    assert.notEqual(next, record.firstAddress);
    assert.equal(await first.text('receive-address'), next);
    // Settings names it the same way.
    await toSection(second, '/wallet/settings');
    assert.equal(await second.text('first-address'), record.firstAddress);
    assert.equal(await second.text('wallet-fingerprint'), record.fingerprint);
    assert.equal(await second.text('wallet-kind'), en.settings.kindWords);

    // Counted in the second browser: the restore, as "found", under the Restore screen.
    const view = (path: string): EventBody => ({ name: 'pageview', path });
    assert.deepEqual(await sentBy(second, requests, 6), [
      view('/'),
      view('/restore'),
      { name: 'Restore', path: '/restore', value: 'found' },
      view('/wallet'),
      view('/wallet/receive'),
      view('/wallet/settings'),
    ]);
    await s.stack.settled();
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      { records: [record, restored], words: [words], addresses: [record.firstAddress, next, SOMEBODY], txids: [funding, txid] },
    );
  },
);

scenario(
  'the 12 words of a passkey wallet, typed into a browser that has no passkey for it: nothing is stored until "Keep them here anyway", and every screen there says the wallet is kept with its words',
  async (s) => {
    // -- The first browser: a wallet made with a passkey. Its 12 words are the ones "Wallet made" shows. --
    const first = await standBy(s, { passkey: 'prf', timeout: 30_000 });
    await first.goto('/new');
    await first.waitFor('create-passkey');
    const made = await createFrom(first, 'create-passkey');
    const { record, words } = made;
    assert.equal(record.kind, 'passkey');

    // -- The second browser: no passkey, only the words on paper. The wallet has never been paid. --
    const second = await standBy(s, { timeout: 30_000 });
    const requests = watchEventRequests(second);
    await second.goto('/restore');
    await second.page.bringToFront();
    await typeWords(second, words);
    await second.click('restore-check');
    await second.click('restore-go');
    // No practice coins for these words: nothing is stored, and the reader chooses.
    await second.waitFor('restore-empty');
    assert.equal(await headingOf(second), en.restore.emptyTitle);
    assert.equal(await second.stored(), null);
    await second.click('restore-keep');
    await arrivesAt(second, '/wallet');
    await second.waitFor('no-coins');

    // The same wallet, kept another way: the same public key, wallet fingerprint and first address, and now the words too.
    const kept = await storedRecord(second);
    assert.ok(kept !== null);
    assert.deepEqual(
      [kept.kind, kept.mnemonic, kept.xpub, kept.fingerprint, kept.firstAddress, kept.credentialId, kept.tag],
      ['words', words.join(' '), record.xpub, record.fingerprint, record.firstAddress, undefined, undefined],
    );
    // Every screen goes by how this browser keeps it. The Overview: no lock line, no passkey named.
    assert.equal(await countOf(second, 'lock-state'), 0);
    assert.equal(await countOf(second, 'passkey-tag'), 0);
    assert.equal(await second.text('wallet-fingerprint'), record.fingerprint);
    // Backup: the words at once, with no unlock step.
    await toSection(second, '/wallet/backup');
    await second.click('reveal-words');
    assert.deepEqual(await wordsOnScreen(second), words);
    assert.equal(await countOf(second, 'unlock-step'), 0);
    // Settings: opens without a passkey, keeps the words, and Remove speaks of words.
    await toSection(second, '/wallet/settings');
    assert.equal(await second.text('wallet-kind'), en.settings.kindWords);
    assert.equal(await second.text('keeps-words'), en.settings.keepsWords);
    assert.equal(await second.text('first-address'), record.firstAddress);
    // About: "a wallet kept with its 12 words, as plain text".
    await headerLink(second, '/about');
    await arrivesAt(second, '/about');
    await second.waitFor('about-kept-now');
    assert.equal(await attributeOf(second, 'about-kept-now', 'data-kept'), 'words');
    assert.ok((await second.text('about-kept-now')).endsWith(en.about.keepNowWords));
    // Home: it works without a passkey, because its words are here.
    await second.page.evaluate(() => window.scrollTo(0, 0));
    await second.page.click(`a[aria-label="${en.common.homeLabel}"]`);
    await arrivesAt(second, '/');
    assert.equal(await second.text('wallet-here-kind'), en.home.hereWords);

    // The first browser still holds it as a passkey wallet, with no words stored, and says so on the same screens.
    await first.page.bringToFront();
    assert.equal((await storedRecord(first))?.mnemonic, undefined);
    await first.click('words-written');
    await arrivesAt(first, '/wallet');
    await toSection(first, '/wallet/settings');
    assert.equal(await first.text('wallet-kind'), en.settings.kindPasskey);
    assert.equal(await first.text('first-address'), record.firstAddress);
    assert.equal(await first.text('wallet-fingerprint'), record.fingerprint);
    assert.equal(await countOf(first, 'keeps-words'), 0);

    // Counted in the second browser: the restore as "kept", and the words as shown by a wallet kept with its words.
    const view = (path: string): EventBody => ({ name: 'pageview', path });
    assert.deepEqual(await sentBy(second, requests, 8), [
      view('/restore'),
      { name: 'Restore', path: '/restore', value: 'kept' },
      view('/wallet'),
      view('/wallet/backup'),
      { name: 'Words shown', path: '/wallet/backup', value: 'words' },
      view('/wallet/settings'),
      view('/about'),
      view('/'),
    ]);
    await s.stack.settled();
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      { records: [record, kept], words: [words], addresses: [record.firstAddress], txids: [] },
    );
  },
);

scenario(
  'a payment to the wallet\'s own new address: Send says that it comes back, the transaction\'s screen that only the fee left, and Receive counts it as arrived',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    fundTestWallet(s.standIn);
    const record = testRecord();
    const page = await s.open('/wallet/receive', { record, timeout: 30_000 });
    // The address Receive shows is the first that has not been paid: the fourth, here.
    await page.waitFor('receive-address');
    const own = await page.text('receive-address');
    assert.equal(own, deriveAddress(watchOnlyAccount(record.xpub), 0, 3).address);
    assert.equal(await countOf(page, 'receive-arrived'), 0);

    // The reader has nobody to pay, and pastes that address into Send. The form and the plan say whose it is.
    await toSection(page, '/wallet/send');
    await page.waitFor('send-spendable');
    await page.fill('send-to', own);
    assert.equal(await page.text('send-to-own'), en.send.toOwn);
    await page.fill('send-amount', '20,000');
    await page.waitFor('send-plan');
    assert.equal(await page.text('plan-to-own'), en.send.toOwn);
    const plan = await figuresOf(page, 'send-plan');
    await page.click('send-continue');
    await page.waitFor('send-review');
    assert.equal(await page.text('review-to-own'), en.send.toOwn);
    await page.click('send-broadcast');
    const txid = await sentTxid(page);

    // The transaction's screen: the wallet paid itself, and what left it is the fee.
    await page.click('sent-link');
    await arrivesAt(page, `/wallet/tx/${txid}`);
    await page.waitFor('tx-summary');
    assert.equal(await page.text('tx-summary'), en.wallet.txSumInternal.replace('{amount}', plan.fee));
    const outputs = await page.texts('tx-output');
    assert.equal(outputs.length, 2);
    assert.ok(outputs.every((text) => text.includes(en.wallet.txMine) || text.includes(en.wallet.txChange)), outputs.join(' | '));

    // Receive kept the address it had shown, and counts what came to it, though the wallet sent it itself.
    await toSection(page, '/wallet/receive');
    assert.equal(await page.text('receive-address'), own);
    assert.equal(await page.text('receive-arrived'), en.receive.arrived.replace('{amount}', '20,000'));
    assert.equal(await page.text('new-address'), en.receive.newAddress);
    // The total went down by the fee and by nothing else.
    await toSection(page, '/wallet');
    assert.equal(await page.text('total'), `${(142_500 - satsIn(plan.fee)).toLocaleString('en-US')} practice sats`);
    // Activity lists it as what it was. (Among transactions that are not in a block yet the list has no
    // order of time to go by, so the row is found by its link.)
    await toSection(page, '/wallet/activity');
    const row = await textOf(page, `${hook('tx-row')}[href="/wallet/tx/${txid}"]`);
    assert.ok(row.startsWith(`${en.wallet.txInternal} -${satsIn(plan.fee)} practice sats ${en.common.unconfirmed}`), row);
    assert.deepEqual(await s.network.coins(own), { count: 1, sats: 20_000 });
  },
);

scenario(
  'pay it forward: a coin one reader passes on to the pot comes out with the next reader\'s faucet payment, and each of them is told',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    // -- The first reader passes 30,000 practice sats on --
    fundTestWallet(s.standIn);
    const giver = await s.open('/wallet/send', { record: testRecord(), timeout: 30_000 });
    await giver.waitFor('send-spendable');
    await giver.click('pass-it-on');
    await giver.waitFor('send-to-pot');
    const pot = await heldBy(giver, 'send-to');
    await giver.fill('send-amount', '30,000');
    await giver.waitFor('send-plan');
    await giver.click('send-continue');
    await giver.waitFor('send-review');
    await giver.click('send-broadcast');
    const passedOn = await sentTxid(giver);
    assert.equal(await giver.text('sent-pot'), en.send.sentPot);
    // The pot's coin has to be in a block before the faucet hands it on.
    await s.network.nextBlock();

    // -- The next reader, in another browser: a new wallet, and the faucet --
    const taker = await standBy(s, { timeout: 30_000 });
    await taker.goto('/new');
    await taker.waitFor('create-words');
    const { record } = await createFrom(taker, 'create-words');
    await taker.click('words-written');
    await arrivesAt(taker, '/wallet');
    await toSection(taker, '/wallet/receive');
    await taker.waitFor('faucet-ask');
    await taker.click('faucet-ask');
    await untilPhase(taker, 'on-its-way');
    // The faucet's payment carries the first reader's coin, and the screen says so.
    assert.equal(await taker.text('faucet-pot'), en.receive.statePot);
    const faucetTxid = (await taker.text('faucet-txid')).trim();
    const payment = await onNetwork(s, faucetTxid);
    const carried = payment.vin.find((input) => input.txid === passedOn);
    assert.ok(carried, 'the faucet\'s payment spends an output of the payment that was passed on');
    assert.deepEqual([carried.prevout.value, carried.prevout.scriptpubkey_address], [30_000, pot]);
    assert.equal(payment.vout.find((output) => output.scriptpubkey_address === record.firstAddress)?.value, 100_000);

    // The newcomer's own screen of that transaction shows the coin it came from: 30,000 practice sats, from the pot's address.
    await untilPhase(taker, 'arrived');
    await loads(taker, () => taker.click('faucet-tx-link'));
    await arrivesAt(taker, `/wallet/tx/${faucetTxid}`);
    await taker.waitFor('tx-summary');
    assert.equal(await taker.text('tx-summary'), en.wallet.txSumReceived.replace('{amount}', '100,000 practice sats'));
    const inputs = await taker.texts('tx-input');
    assert.ok(inputs.some((text) => text.startsWith('30,000 practice sats') && text.includes(pot)), inputs.join(' | '));

    // The pot's own count, as the practice network gives it to anyone who asks.
    const stats = (await (await fetch(`${s.stack.originUrl}/bots/pot/stats`)).json()) as Record<string, number>;
    assert.deepEqual(
      [stats.learners_passed_on, stats.sats_received, stats.coins_waiting, stats.coins_passed_to_newcomers],
      [1, 30_000, 0, 1],
    );
    // Counted: one payment as passed on, one faucet request that ended well.
    await untilCounted(s, 'Faucet');
    const counted = await countedBy(s, giver, taker);
    assert.deepEqual(counted.filter((event) => event.name === 'Payment' || event.name === 'Faucet'), [
      { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
      { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
    ]);
    assert.equal(await rowOf(giver, hook('send-sent'), 'sent-amount'), '30,000 practice sats');
  },
);
