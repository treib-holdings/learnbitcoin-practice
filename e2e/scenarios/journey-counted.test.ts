// What the app counted over a whole journey, and what it wrote down.
//
// One reader, from Home to the end: a wallet made with a passkey, the 12
// words shown, coins from the faucet, About, a payment to the pot, the
// words asked for again, the wallet removed (on the Spanish screen) and
// opened once more with the passkey, About in both languages, and at last
// an address that is no screen. The list of what was counted is then held
// against the steps line for line: each event a name and at most one value
// from the contract's lists, in the order the steps were taken, each under
// the fixed path of the screen it happened on.
//
// Three records of the same journey are read. What the page sent: every
// request to /p/event as it left the browser, body and headers. What the
// Worker passed on for counting, with what it would tell the events
// service about each request. And what the Worker wrote in its own log.
// None of the three may hold anything that says which wallet it was: no
// address, no transaction ID, no wallet fingerprint, no public key, no
// passkey ID or tag, and none of the 12 words (journey-helpers.ts,
// nothingPrivate, says how each is searched).
//
// The journey passes through the places where a slip would show: the
// transaction's screen, whose address ends in a transaction ID; the faucet,
// which is handed an address; and a path that is no screen, typed with the
// wallet's own address in it.

import assert from 'node:assert/strict';
import { EVENTS, type EventBody } from '@learnbitcoin/practice-contract';
import { strings } from '../../app/src/strings/index.ts';
import { scenario } from './helpers.ts';
import {
  arrivesAt,
  attributeOf,
  botCheckScripts,
  countedExactly,
  createFrom,
  documentsOf,
  goHome,
  headerLink,
  headingBecomes,
  heldBy,
  hook,
  loads,
  nothingPrivate,
  sentTxid,
  standBy,
  storedRecord,
  switchLanguage,
  toSection,
  untilAnswersCount,
  untilCounted,
  untilPhase,
  usesOf,
  watchEventRequests,
  watchPrompts,
  wordsOnScreen,
} from './journey-helpers.ts';

const es = strings.common.es;

scenario(
  'what was counted over a whole journey: exactly the steps taken, each under its own screen and in order; and no count, no log line and no request holds an address, an ID, a wallet fingerprint or a word of the 12',
  { localOnly: true, timeout: 180_000 },
  async (s) => {
    const page = await standBy(s, { passkey: 'prf', timeout: 30_000 });
    const prompts = await watchPrompts(page);
    const requests = watchEventRequests(page);
    const before = documentsOf(page);
    await page.goto('/');

    // -- Home, Create with a passkey, "Wallet made" --
    await page.click('home-create');
    await arrivesAt(page, '/new');
    await page.waitFor('create-passkey');
    const { record, words } = await createFrom(page, 'create-passkey');
    await page.click('words-written');
    await arrivesAt(page, '/wallet');

    // -- Receive: the faucet is asked, and pays --
    await toSection(page, '/wallet/receive');
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    await page.click('faucet-ask');
    await untilPhase(page, 'on-its-way');
    const faucetTxid = (await page.text('faucet-txid')).trim();
    await s.network.nextBlock();

    // -- About, from the header. The bot check's script has been in the page, so this is a page load, and the
    //    new page holds nothing of it: About never asks for that script. --
    assert.equal(await botCheckScripts(page), 1);
    await loads(page, () => headerLink(page, '/about'));
    await arrivesAt(page, '/about');
    assert.equal(documentsOf(page) - before, 2);
    assert.equal(await botCheckScripts(page), 0);
    await page.waitFor('about-kept-now');
    assert.equal(await attributeOf(page, 'about-kept-now', 'data-kept'), 'passkey');

    // -- Back into the wallet by Home, and Send: one unlock, and a payment to the pot --
    await goHome(page);
    await page.click('wallet-open');
    await arrivesAt(page, '/wallet');
    await toSection(page, '/wallet/send');
    assert.equal(documentsOf(page) - before, 2, 'moves inside the new page load nothing');
    await page.waitFor('send-spendable');
    await page.click('pass-it-on');
    await page.waitFor('send-to-pot');
    const pot = await heldBy(page, 'send-to');
    await page.fill('send-amount', '30,000');
    await page.waitFor('send-plan');
    await page.click('send-continue');
    await page.waitFor('unlock-step');
    await page.click('unlock');
    await page.waitFor('send-review');
    await page.click('send-broadcast');
    const txid = await sentTxid(page);

    // -- The transaction's own screen: its address ends in the transaction's ID --
    await page.click('sent-link');
    await arrivesAt(page, `/wallet/tx/${txid}`);
    await page.waitFor('tx-summary');

    // -- Backup: the 12 words, asked for --
    await toSection(page, '/wallet/backup');
    await page.click('reveal-words');
    assert.deepEqual(await wordsOnScreen(page), words);

    // -- Settings, switched to Spanish, and Remove --
    await toSection(page, '/wallet/settings');
    await switchLanguage(page);
    await arrivesAt(page, '/es/wallet/settings');
    await page.click('remove-wallet');
    await page.waitFor('remove-confirm');
    await untilAnswersCount();
    await page.click('remove-confirm');
    await arrivesAt(page, '/es');

    // -- Open with the passkey: the same wallet, which has a history by now --
    await page.click('open-passkey');
    await arrivesAt(page, '/es/wallet');
    await page.waitFor('coin');
    await untilCounted(s, 'Unlock', 2);
    const reopened = await storedRecord(page);
    assert.ok(reopened !== null);
    assert.equal(reopened.xpub, record.xpub);

    // -- About: every name that was counted on the way is on the page's own list of what is counted --
    await headerLink(page, '/es/about');
    await arrivesAt(page, '/es/about');
    await page.waitFor('about-counting');
    assert.equal(await attributeOf(page, 'about-counting', 'data-counting'), 'on');
    const listed = await page.page.$$eval(hook('about-count'), (items) => items.map((item) => item.getAttribute('data-event')));
    assert.deepEqual(listed, Object.keys(EVENTS));
    // The language switch keeps the screen, and the list.
    await switchLanguage(page);
    await arrivesAt(page, '/about');
    await headingBecomes(page, strings.about.en.title);
    assert.deepEqual(await page.page.$$eval(hook('about-count'), (items) => items.map((item) => item.getAttribute('data-event'))), listed);

    // -- An address that is no screen, with the wallet's own address in it --
    await page.goto(`/es/${address}`);
    await headingBecomes(page, es.notFoundTitle);

    // -- What the page sent to be counted, and what the Worker passed on --
    const view = (path: string): EventBody => ({ name: 'pageview', path });
    const expected: EventBody[] = [
      view('/'),
      view('/new'),
      { name: 'Passkey', path: '/new', value: 'ok' },
      { name: 'Wallet created', path: '/new', value: 'passkey' },
      view('/wallet/backup'),
      { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
      view('/wallet'),
      view('/wallet/receive'),
      { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
      view('/about'),
      view('/'),
      view('/wallet'),
      view('/wallet/send'),
      { name: 'Unlock', path: '/wallet/send', value: 'same' },
      { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
      // One path for every transaction: the ID in the address is not counted.
      view('/wallet/tx'),
      view('/wallet/backup'),
      // The words were shown before, in the page that made the wallet. This is another page (the one loaded after the bot check).
      { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
      view('/wallet/settings'),
      view('/es/wallet/settings'),
      { name: 'Wallet removed', path: '/es/wallet/settings', value: 'passkey' },
      view('/es'),
      view('/es/wallet'),
      // Counted once the first look at the practice network had said that this wallet has a history.
      { name: 'Unlock', path: '/es/wallet', value: 'opened' },
      view('/es/about'),
      view('/about'),
      // One path for everything that is no screen: what stood in the address is not counted.
      view('/es/not-found'),
    ];
    await page.settle();
    await countedExactly(s, page, requests, expected);
    // Every name on the way is on About's list, and seven of the list's nine were met.
    const met = [...new Set(expected.map((event) => event.name))];
    for (const name of met) assert.ok(listed.includes(name), name);
    assert.deepEqual(met.sort(), ['Faucet', 'Passkey', 'Payment', 'Unlock', 'Wallet created', 'Wallet removed', 'Words shown', 'pageview']);

    // -- What the Worker wrote in its log: one line for each request that is not a read of the chain --
    const lines = s.stack.lines;
    const count = (route: string): number => lines.filter((line) => line.route === route).length;
    // The settings, once for each page that was loaded: Home, About after the bot check, and the address that is no screen.
    assert.equal(documentsOf(page) - before, 3);
    assert.equal(count('config'), 3);
    assert.equal(count('event'), expected.length);
    assert.deepEqual([count('faucet'), count('pot_address'), count('esplora_broadcast')], [1, 1, 1]);
    // The wallet read the chain many hundreds of times on the way, by address and by transaction ID, and none of it was written down.
    assert.equal(count('esplora_read'), 0);
    assert.equal(lines.length, 3 + expected.length + 3);
    for (const line of lines) assert.deepEqual([line.fault, line.status < 300], [null, true], JSON.stringify(line));
    const reads = page.responses.filter((response) => new URL(response.url).pathname.startsWith('/api/esplora/address/'));
    assert.ok(reads.length > 100 && reads.some((read) => read.url.includes(address)), `${reads.length} reads by address`);

    // -- And none of it says which wallet it was --
    nothingPrivate(
      { events: s.stack.events, lines, requests: requests() },
      { records: [record, reopened], words: [words], addresses: [address, pot], txids: [faucetTxid, txid] },
    );
    // The device was asked three times in all: to make the passkey, to sign, and to open.
    assert.deepEqual(await prompts.asked(), { create: 1, get: 2 });
    assert.equal(await usesOf(page), 2);
  },
);
