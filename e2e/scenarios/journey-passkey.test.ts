// A wallet made with a passkey, through the real Create screen, across every
// screen of the app.
//
// The screens' own scenarios each begin in the middle: with a wallet put in
// the page's storage, or with a passkey the scenario made by hand and
// brought in through "Open with my passkey". Here the reader starts with
// nothing, and everything that follows is what the screens themselves did:
// the passkey is the one Create asked the device to make, the 12 words are
// the ones "Wallet made" showed, the coins are the ones that arrived.
//
// What a journey can show and a screen's scenario cannot is how the screens
// hand over to each other: that the keys Create loaded are still loaded on
// Send, that no screen on the way asks for the passkey, that Lock on one
// screen is felt on the next, and how often the device is asked in all.
// The count of prompts is taken twice: what the page called (watchPrompts)
// and what the device answered (usesOf).
//
// Then the passkeys that give less: one that hands its secret over only
// when asked a second time, and one that never does (the way without a
// passkey still works after it). And one made on the Spanish page, whose
// name must stay as the device was given it.
//
// A scenario that pays the wallet from the stand-in, or asks the faucet, is
// local only. The others run against any practice network.

import assert from 'node:assert/strict';
import type { EventBody } from '@learnbitcoin/practice-contract';
import { accountDescriptor, deriveAddress, watchOnlyAccount } from '@learnbitcoin/practice-wallet';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { OTHER_WORDS, scenario, testRecord, type OpenedPage, type Scenario } from './helpers.ts';
import {
  NOTHING_REMEMBERED,
  SECTIONS,
  arrivesAt,
  assertNoWordsRemembered,
  assertSignedAsPlanned,
  attributeOf,
  backWithLoad,
  botCheckScripts,
  broadcastsOf,
  checkFold,
  countOf,
  countedExactly,
  createFrom,
  documentsOf,
  figuresOf,
  goHome,
  headerLink,
  headingBecomes,
  headingOf,
  heldBy,
  hook,
  nothingPrivate,
  onNetwork,
  openCheckFold,
  pairsOf,
  passkeyRecordOf,
  patternMemory,
  rowOf,
  sats,
  satsIn,
  sentTxid,
  standBy,
  storedRecord,
  switchLanguage,
  toSection,
  untilCounted,
  untilPhase,
  usesOf,
  watchBotCheck,
  watchEventRequests,
  watchPhases,
  watchPrompts,
  wordsOnScreen,
} from './journey-helpers.ts';

const common = strings.common.en;
const errors = strings.errors.en;
const wallet = strings.wallet.en;
const backup = strings.backup.en;
const home = strings.home.en;
const receive = strings.receive.en;
const send = strings.send.en;
const settings = strings.settings.en;
const about = strings.about.en;

/** An address that is neither the wallet's nor the pot's: the first address of the harness's second wallet. */
const SOMEBODY = testRecord(OTHER_WORDS).firstAddress;

/** The lock line of an unlocked passkey wallet, with its button. */
const UNLOCKED = `${common.stateUnlocked} ${common.lock}`;

const view = (path: string): EventBody => ({ name: 'pageview', path });

/** The pot's address, asked of the bots directly. */
async function potOnNetwork(s: Scenario): Promise<string> {
  const answer = await fetch(`${s.stack.originUrl}/bots/pot/address`, { headers: { Authorization: `Bearer ${s.standIn.token}` } });
  return ((await answer.json()) as { address: string }).address;
}

/**
 * Every wallet screen but the one the reader is on, in turn, by the section
 * links. None of them may show the unlock step by itself. Gives the paths
 * in the order they were opened.
 */
async function walk(page: OpenedPage, lockLine: string, from: string): Promise<string[]> {
  const seen: string[] = [];
  for (const path of SECTIONS) {
    if (path === from) continue;
    await toSection(page, path);
    assert.equal(await page.text('lock-state'), lockLine, path);
    assert.equal(await countOf(page, 'unlock-step'), 0, `${path} shows the unlock step unasked`);
    seen.push(path);
  }
  return seen;
}

scenario(
  'a passkey wallet, start to finish: one prompt makes it, the 12 words show at once, no screen asks again, a payment goes out unprompted; after Lock every screen still shows, and the next payment asks exactly once',
  { localOnly: true, timeout: 180_000 },
  async (s) => {
    const page = await standBy(s, { passkey: 'prf', timeout: 30_000 });
    const prompts = await watchPrompts(page);
    const requests = watchEventRequests(page);
    await page.goto('/');
    /** The one document of the whole journey: nothing below loads a page. */
    const documents = documentsOf(page);

    // -- Home: nothing here yet, and Create is the first thing offered --
    await page.waitFor('home-create');
    assert.equal(await page.stored(), null);
    assert.deepEqual(await page.passkey!.credentials(), []);
    await page.click('home-create');
    await arrivesAt(page, '/new');
    await page.waitFor('create-passkey');

    // -- Create with a passkey: one prompt, and on to "Wallet made" --
    const made = await createFrom(page, 'create-passkey');
    const { record, words } = made;
    assert.equal(await headingOf(page), backup.madeTitle);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 }, 'one prompt made the wallet, and the words needed no second one');
    const passkeys = await page.passkey!.credentials();
    assert.deepEqual(passkeys.map((each) => [each.id, each.uses, each.rpId]), [[record.credentialId, 0, 'localhost']]);
    // The step names the passkey as the device was told to save it, whole.
    const named = await prompts.named();
    assert.equal(named, fill(common.passkeyName, { tag: record.tag ?? '' }));
    assert.equal(await page.text('passkey-name'), named);
    assert.equal(await page.text('made-passkey-back'), backup.madePasskeyBack);
    // What this browser stored is the public record, exactly: which passkey, the public key, the wallet
    // fingerprint and the first address. No field for the words, and nothing else under any other key.
    assert.equal(record.kind, 'passkey');
    assert.equal(await page.stored(), JSON.stringify(passkeyRecordOf(made)));
    assert.deepEqual(await page.page.evaluate(() => [Object.keys(localStorage), sessionStorage.length]), [['lbp_wallet_v1'], 0]);
    // The keys came with the create: nothing was "unlocked", and nothing says so.
    assert.deepEqual(page.statusLog(), []);

    // -- "I have written them down": the Overview of an unlocked wallet with no coins --
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    await page.waitFor('no-coins');
    assert.equal(await page.text('total'), '0 practice sats');
    assert.equal(await page.text('lock-state'), UNLOCKED);
    assert.deepEqual(await page.texts('passkey-tag'), [record.tag]);
    assert.deepEqual(await page.texts('wallet-fingerprint'), [record.fingerprint]);
    // A wallet that was made here is not "opened and empty": the plain line, not the list of causes.
    assert.equal(await countOf(page, 'opened-empty'), 0);

    // -- Every wallet screen in turn. Looking asks for nothing. --
    const first = await walk(page, UNLOCKED, '/wallet');
    assert.deepEqual(first, SECTIONS.slice(1));
    // Settings, where the walk ends: how this browser opens the wallet, the tag (which is in the name the device
    // was given), the wallet fingerprint, the first address, and that the 12 words are not kept.
    assert.equal(await page.text('wallet-kind'), settings.kindPasskey);
    assert.equal(await page.text('passkey-tag'), record.tag);
    assert.ok((named ?? '').includes(record.tag ?? 'no tag'));
    assert.equal(await page.text('wallet-fingerprint'), record.fingerprint);
    assert.equal(await page.text('first-address'), record.firstAddress);
    assert.equal(await page.text('keeps-no-words'), settings.keepsPasskey);
    assert.equal(await countOf(page, 'keeps-words'), 0);
    const descriptors = [await page.text('descriptor-receive'), await page.text('descriptor-change')];
    assert.deepEqual(descriptors, [accountDescriptor(record.fingerprint, record.xpub, 0), accountDescriptor(record.fingerprint, record.xpub, 1)]);
    // Backup is the plain screen now: the "Wallet made" step ended with its button, and the words are off the page.
    await toSection(page, '/wallet/backup');
    assert.equal(await headingOf(page), common.section_backup);
    assert.equal(await countOf(page, 'word'), 0);
    assert.equal(await countOf(page, 'reveal-words'), 1);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 });
    assert.equal(await usesOf(page), 0);

    // -- Receive: the wallet's first address, and coins that arrive at it --
    await toSection(page, '/wallet/receive');
    await page.waitFor('receive-address');
    const address = await page.text('receive-address');
    assert.equal(address, record.firstAddress);
    const funding = s.standIn.fund(address, 100_000);
    assert.equal(await page.waitForStatus('arrived'), '100,000 practice sats arrived.');
    assert.equal(await page.text('receive-arrived'), '100,000 practice sats arrived at this address.');
    assert.equal(await page.text('receive-address'), address, 'the address stays');

    // -- Send to the pot: the plan, the signed review and the transaction itself, with no prompt --
    await toSection(page, '/wallet/send');
    await page.waitFor('send-spendable');
    assert.equal(await rowOf(page, 'main', 'send-spendable'), '100,000 practice sats');
    await page.click('pass-it-on');
    await page.waitFor('send-to-pot');
    const pot = await heldBy(page, 'send-to');
    assert.equal(pot, await potOnNetwork(s));
    await page.fill('send-amount', '30,000');
    await page.waitFor('send-plan');
    const plan = await figuresOf(page, 'send-plan');
    assert.deepEqual(plan, {
      to: pot,
      amount: '30,000 practice sats',
      fee: '282 practice sats',
      size: '141 vB',
      rate: '2 sat/vB',
      total: '30,282 practice sats',
      change: '69,718 practice sats',
    });
    await page.click('send-continue');
    await page.waitFor('send-review');
    await headingBecomes(page, send.reviewTitle);
    // The keys that Create loaded are still here: no unlock step, no prompt, and nothing sent yet.
    assert.equal(await countOf(page, 'unlock-step'), 0);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 });
    assert.equal(broadcastsOf(s), 0);
    // The signed payment is the planned one. This wallet's keys are new in every run, so its size may be
    // a vbyte or two under the plan's, and its rate then follows from that size (assertSignedAsPlanned).
    const review = await figuresOf(page, 'send-review');
    assertSignedAsPlanned(review, plan);
    await page.click('send-broadcast');
    const txid = await sentTxid(page);
    await headingBecomes(page, send.sentTitle);
    await page.waitForStatus(wallet.noticeSent);
    assert.equal(await page.text('sent-pot'), send.sentPot);
    // The transaction's own numbers, from the network itself: the fee the plan said, and the size the review showed.
    const tx = await onNetwork(s, txid);
    assert.equal(tx.fee, satsIn(plan.fee));
    assert.equal(`${Math.ceil(tx.weight / 4)} vB`, review.size);
    assert.deepEqual(tx.vin.map((input) => [input.prevout.value, input.prevout.scriptpubkey_address]), [[100_000, address]]);
    assert.deepEqual(tx.vout.map((output) => output.value).sort((a, b) => a - b), [satsIn(plan.amount), satsIn(plan.change)]);
    assert.equal(tx.vout.find((output) => output.scriptpubkey_address === pot)?.value, 30_000);
    assert.equal(tx.vin[0]!.prevout.value - satsIn(plan.change), satsIn(plan.total));
    assert.deepEqual(await s.network.coins(pot), { count: 1, sats: 30_000 });
    assert.equal(broadcastsOf(s), 1);

    // -- The transaction's screen, reached from the sent view: the same payment --
    await page.click('sent-link');
    await arrivesAt(page, `/wallet/tx/${txid}`);
    await page.waitFor('tx-summary');
    assert.equal(await page.text('tx-summary'), fill(wallet.txSumSent, { amount: plan.total }));
    assert.equal(await page.text('tx-status'), fill(wallet.txStatusUnconfirmed, { seconds: String(s.stack.config.blockSeconds) }));
    assert.equal(await page.text('tx-fee'), `${wallet.txFee} ${plan.fee}`);
    // The size and the rate of the payment as it was signed: what the review showed.
    assert.equal(await page.text('tx-size'), `${wallet.txSize} ${review.size}`);
    assert.equal(await page.text('tx-fee-rate'), `${wallet.txFeeRate} ${review.rate}`);
    assert.equal(await page.text('tx-replace'), `${wallet.txReplace} ${wallet.txReplaceYes}`);
    assert.equal(await page.text('tx-id'), txid);
    const inputs = await page.texts('tx-input');
    assert.equal(inputs.length, 1);
    assert.ok(inputs[0]!.startsWith('100,000 practice sats') && inputs[0]!.includes(address) && inputs[0]!.includes(wallet.txMine), inputs[0]);
    const outputs = await page.texts('tx-output');
    assert.equal(outputs.length, 2);
    assert.ok(outputs.some((text) => text.startsWith(plan.amount) && text.includes(pot) && !text.includes(wallet.txMine)), outputs.join(' | '));
    assert.ok(outputs.some((text) => text.startsWith(plan.change) && text.includes(wallet.txChange)), outputs.join(' | '));

    // -- Activity lists it, above the coins that came in --
    await page.click('tx-back');
    await arrivesAt(page, '/wallet/activity');
    await page.waitFor('tx-row');
    const rows = await page.texts('tx-row');
    assert.equal(rows.length, 2);
    assert.match(rows[0]!, /^Sent -30,282 practice sats Unconfirmed /);
    assert.match(rows[1]!, /^Received \+100,000 practice sats Confirmed /);
    assert.deepEqual(
      await page.page.$$eval(hook('tx-row'), (links) => links.map((link) => link.getAttribute('href'))),
      [`/wallet/tx/${txid}`, `/wallet/tx/${funding}`],
    );

    // -- Coins: what is left is the change, the wallet's own, not yet in a block --
    await toSection(page, '/wallet/coins');
    await page.waitFor('coin');
    const waiting = await page.texts('coin');
    assert.equal(waiting.length, 1);
    assert.ok(waiting[0]!.startsWith(plan.change) && waiting[0]!.includes(wallet.coinChange) && waiting[0]!.includes(common.unconfirmed), waiting[0]);
    assert.equal(await page.text('total'), plan.change);
    assert.equal(await page.text('total-unconfirmed'), fill(wallet.totalUnconfirmed, { amount: plan.change }));

    // -- A block confirms it: the coins, the list and the transaction's screen follow --
    page.forgetStatus();
    const height = await s.network.nextBlock();
    assert.equal(await page.waitForStatus('confirmation'), wallet.noticeConfirmed);
    await page.waitForGone('total-unconfirmed');
    const confirmed = await page.texts('coin');
    assert.ok(confirmed.length === 1 && confirmed[0]!.includes(wallet.coinChange) && !confirmed[0]!.includes(common.unconfirmed), confirmed.join(' | '));
    await toSection(page, '/wallet/activity');
    await page.page.waitForFunction(
      (selector) => /^Sent -30,282 practice sats Confirmed /.test((document.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim()),
      {},
      hook('tx-row'),
    );
    await page.click('tx-row');
    await arrivesAt(page, `/wallet/tx/${txid}`);
    await page.waitFor('tx-summary');
    assert.match(await page.text('tx-status'), new RegExp(`^Confirmed in block ${sats(height)}, on [A-Z][a-z]+ \\d{1,2}, \\d{4}\\.$`));
    assert.equal(await page.text('tx-replace'), `${wallet.txReplace} ${wallet.txReplaceNo}`);
    assert.equal((await onNetwork(s, txid)).status.confirmed, true);

    // Up to here: one create(), and the device was never asked again.
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 });
    assert.equal(await usesOf(page), 0);

    // -- Lock, on the transaction's screen. It still shows the transaction, and so does every other screen what it shows. --
    page.forgetStatus();
    await page.click('lock');
    assert.equal(await page.waitForStatus(wallet.noticeLocked), wallet.noticeLocked);
    await page.waitForGone('lock');
    assert.equal(await page.text('lock-state'), common.stateLocked);
    assert.equal(await page.text('tx-summary'), fill(wallet.txSumSent, { amount: plan.total }));
    assert.equal(await countOf(page, 'unlock-step'), 0);
    const second = await walk(page, common.stateLocked, 'the transaction');
    assert.deepEqual(second, [...SECTIONS]);
    // About, and the Sparrow guide: what this browser keeps of a passkey wallet, and its receive descriptor, as Settings showed it.
    await headerLink(page, '/about');
    await arrivesAt(page, '/about');
    await page.waitFor('about-kept-now');
    assert.equal(await attributeOf(page, 'about-kept-now', 'data-kept'), 'passkey');
    assert.ok((await page.text('about-kept-now')).endsWith(about.keepNowPasskey));
    await headerLink(page, '/sparrow');
    await arrivesAt(page, '/sparrow');
    assert.equal(await page.text('sparrow-descriptor-text'), descriptors[0]);
    await page.click('sparrow-settings-link');
    await arrivesAt(page, '/wallet/settings');
    assert.equal(await page.text('descriptor-receive'), descriptors[0]);
    assert.equal(await page.text('lock-state'), common.stateLocked);
    // Looking, at every screen there is, asked the device for nothing.
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 });
    assert.equal(await usesOf(page), 0);

    // -- The next payment: the plan costs nothing, "Continue" leads to the unlock step, and one prompt signs --
    await toSection(page, '/wallet/send');
    await page.waitFor('send-spendable');
    assert.equal(await rowOf(page, 'main', 'send-spendable'), plan.change);
    await page.fill('send-to', SOMEBODY);
    await page.fill('send-amount', '10,000');
    await page.waitFor('send-plan');
    const next = await figuresOf(page, 'send-plan');
    assert.deepEqual([next.to, next.amount, next.fee, next.change], [SOMEBODY, '10,000 practice sats', '282 practice sats', '59,436 practice sats']);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 }, 'a plan needs no key');
    await page.click('send-continue');
    await page.waitFor('unlock-step');
    await headingBecomes(page, send.unlockTitle);
    assert.ok((await page.text('unlock-step')).includes(wallet.unlockPromise));
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 }, 'the step waits for the reader');
    page.forgetStatus();
    await page.click('unlock');
    await page.waitFor('send-review');
    await headingBecomes(page, send.reviewTitle);
    assert.equal(await page.waitForStatus(wallet.noticeUnlocked), wallet.noticeUnlocked);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 }, 'exactly one prompt');
    assert.equal(await usesOf(page), 1);
    assertSignedAsPlanned(await figuresOf(page, 'send-review'), next);
    assert.equal(broadcastsOf(s), 1, 'unlocking sent nothing');
    await page.click('send-broadcast');
    const secondTxid = await sentTxid(page);
    await headingBecomes(page, send.sentTitle);
    assert.deepEqual(await s.network.coins(SOMEBODY), { count: 1, sats: 10_000 });
    assert.equal(await page.text('lock-state'), UNLOCKED);
    assert.equal(await countOf(page, 'sent-pot'), 0);

    // -- Home names the wallet by the tag in its passkey's name, and leads into it --
    await goHome(page);
    assert.equal(await page.text('wallet-here-kind'), fill(home.herePasskeyTagged, { tag: record.tag ?? '' }));
    assert.equal(await attributeOf(page, 'wallet-open', 'href'), '/wallet');

    // -- In all: one create() made the wallet, and one get() signed after the lock. No page was loaded. --
    await untilCounted(s, 'Payment', 2);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });
    assert.equal(await usesOf(page), 1);
    assert.equal(documentsOf(page), documents, 'the whole journey ran in one document');
    assert.equal(await page.stored(), JSON.stringify(passkeyRecordOf(made)), 'the record is as Create stored it');

    // -- What was counted: each screen as it was opened, and each thing that happened under the screen it happened on --
    const expected: EventBody[] = [
      view('/'),
      view('/new'),
      { name: 'Passkey', path: '/new', value: 'ok' },
      { name: 'Wallet created', path: '/new', value: 'passkey' },
      view('/wallet/backup'),
      { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
      view('/wallet'),
      ...first.map(view),
      view('/wallet/backup'),
      view('/wallet/receive'),
      view('/wallet/send'),
      { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
      view('/wallet/tx'),
      view('/wallet/activity'),
      view('/wallet/coins'),
      view('/wallet/activity'),
      view('/wallet/tx'),
      ...second.map(view),
      view('/about'),
      view('/sparrow'),
      view('/wallet/settings'),
      view('/wallet/send'),
      { name: 'Unlock', path: '/wallet/send', value: 'same' },
      { name: 'Payment', path: '/wallet/send', value: 'sent' },
      view('/'),
    ];
    await countedExactly(s, page, requests, expected);
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      { records: [record], words: [words], addresses: [address, pot, SOMEBODY], txids: [funding, txid, secondTxid] },
    );
  },
);

scenario(
  'the same wallet and the faucet: asking locks it before the bot check is in the page, the address stays until a new one is asked for, the coins arrive and confirm, the next move loads a page, and the next payment asks for the passkey once',
  { localOnly: true, timeout: 180_000 },
  async (s) => {
    const page = await standBy(s, { passkey: 'prf', timeout: 30_000 });
    const prompts = await watchPrompts(page);
    const requests = watchEventRequests(page);
    const looks = await watchBotCheck(page);
    await page.goto('/new');
    await page.waitFor('create-passkey');
    const made = await createFrom(page, 'create-passkey');
    const { record, words } = made;
    const stored = JSON.stringify(passkeyRecordOf(made));
    assert.equal(await page.stored(), stored);

    // The reader leaves "Wallet made" by a section link, without its button. That ends the step all the
    // same: Backup is the plain screen when they come back, with the words off the page.
    await toSection(page, '/wallet/receive');
    await toSection(page, '/wallet/backup');
    assert.equal(await headingOf(page), common.section_backup);
    assert.equal(await countOf(page, 'word'), 0);
    assert.equal(await countOf(page, 'reveal-words'), 1);
    await toSection(page, '/wallet/receive');

    // -- Before the tap: unlocked, the card holds what asking will do, and nothing of the bot check is in the page --
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    assert.equal(address, record.firstAddress);
    assert.equal(await page.text('lock-state'), UNLOCKED);
    assert.equal(await page.text('faucet-locks'), receive.faucetLocks);
    // And how far that goes, said as what the reader can do: this screen opens no passkey prompt and no window after the tap.
    assert.equal(await page.text('faucet-no-prompt'), receive.faucetNoPrompt);
    // Both stand behind the card's folded line about the check, after what the check is. The line comes
    // before the button, so a reader who tabs meets it first. It is folded until it is opened, and then
    // the three sentences are on screen.
    const held = `${receive.faucetCheck} ${receive.faucetLocks} ${receive.faucetNoPrompt}`;
    assert.deepEqual(await checkFold(page), { open: false, beforeButton: true, drawn: false, says: held });
    await openCheckFold(page);
    assert.deepEqual(await checkFold(page), { open: true, beforeButton: true, drawn: true, says: held });
    // The button names the lines in the open as its description: what the faucet sends, and that a check may come first.
    const described = await page.page.$eval(hook('faucet-ask'), (button) =>
      (document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    assert.equal(
      described,
      `${fill(receive.faucetPays, { amount: `${sats(s.stack.config.faucetSats)} ${common.practiceSats}` })} ${fill(receive.faucetStart, { button: receive.faucetAsk })}`,
    );
    assert.equal(await botCheckScripts(page), 0);
    assert.deepEqual(await looks(), []);
    assert.deepEqual(await page.turnstileCalls(), []);
    const documents = documentsOf(page);
    // A marker, left in what the page's patterns remember just before the tap: the scenario runs a pattern
    // of its own over a text of its own. What becomes of it is read below, from where the script stands.
    await page.page.evaluate(() => /marker/.test('the journey left this marker'));
    assert.notEqual((await patternMemory(page)).input, '', 'the patterns remember some text before the tap');

    // -- The tap --
    const phases = await watchPhases(page);
    await page.click('faucet-ask');
    assert.equal(await page.waitForStatus(wallet.noticeLocked), wallet.noticeLocked);
    await untilPhase(page, 'on-its-way');
    // Locked, by the tap alone: no prompt was opened for it, and the device was not asked.
    assert.equal(await page.text('lock-state'), common.stateLocked);
    assert.equal(await countOf(page, 'lock'), 0);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 });
    assert.equal(await usesOf(page), 0);

    // -- What the bot check's script could read, seen from where it runs --
    const seen = await looks();
    assert.deepEqual(seen.map((look) => look.when), ['added', 'ran', 'drew'], 'the script was added once, ran once, and drew one widget');
    const [added, ran, drew] = seen as [(typeof seen)[number], (typeof seen)[number], (typeof seen)[number]];
    // As its element went into the page, the patterns remembered nothing at all: the marker is gone, and
    // nothing stands in its place. Only the wallet does that. It ends every action that handles keys by
    // matching a pattern against an empty text (session.ts, "scrub"), and the action that had just ended
    // is the one that drops them: the wallet was told of the bot check, and had done its part, before the
    // element was added. (Whether the keys are gone from the wallet's own memory cannot be seen from
    // outside it. app/test/session.test.ts holds that, and app/test/receive-bot-check.test.ts the order.
    // The page itself is redrawn a moment later: at this very instant its lock line still reads "Unlocked".)
    assert.deepEqual(added.memory, NOTHING_REMEMBERED);
    for (const look of seen) {
      // Storage holds the record of a passkey wallet, as it was before the tap: public facts, and no field for the words.
      assert.deepEqual(look.local, { lbp_wallet_v1: stored }, look.when);
      assert.deepEqual(look.session, {}, look.when);
      assertNoWordsRemembered(look.memory, words, look.shown, `as the bot check's script ${look.when}`);
      // And no two of the 12 words stand together anywhere on the page it runs in.
      for (const pair of pairsOf(words)) assert.ok(!look.shown.includes(pair), look.when);
    }
    // By the script's first line the page shows the wallet as locked, and still does when the widget is drawn.
    for (const look of [ran, drew]) {
      assert.equal(look.lockLine, common.stateLocked, look.when);
      assert.equal(look.lockButton, false, look.when);
    }
    // The widget was drawn for the faucet and for the address on screen.
    const renders = (await page.turnstileCalls()).filter((call) => call.op === 'render');
    assert.deepEqual(renders.map((render) => [render.options?.action, render.options?.cData]), [['faucet', address]]);

    // -- The address stays, the coins arrive, and a block confirms them --
    const faucetTxid = (await page.text('faucet-txid')).trim();
    assert.match(faucetTxid, /^[0-9a-f]{64}$/);
    assert.equal(await page.waitForStatus('The faucet has sent'), 'The faucet has sent 100,000 practice sats to this address.');
    await untilPhase(page, 'arrived');
    assert.equal(await page.waitForStatus('arrived'), '100,000 practice sats arrived.');
    assert.equal(await page.text('receive-address'), address, 'the address stays');
    assert.equal(await page.text('receive-arrived'), '100,000 practice sats arrived at this address.');
    await s.network.nextBlock();
    await untilPhase(page, 'confirmed');
    assert.equal(await page.waitForStatus('confirmation'), wallet.noticeConfirmed);
    assert.equal(await page.text('receive-address'), address, 'the address stays');
    assert.deepEqual(await s.network.coins(address), { count: 1, sats: 100_000 });
    assert.equal(await page.stored(), stored, 'the record is untouched');
    // From the bot check to the first confirmation, the state line went through every phase of a request.
    assert.deepEqual(await phases(), ['checking', 'asking', 'on-its-way', 'arrived', 'confirmed']);
    // "Show a new address", and only that, moves Receive on: to the wallet's next address, which the faucet can be asked for anew.
    await page.click('new-address');
    assert.equal(await page.text('receive-address'), deriveAddress(watchOnlyAccount(record.xpub), 0, 1).address);
    assert.equal(await page.text('receive-new'), receive.newAddressShown);
    assert.equal(await countOf(page, 'faucet-ask'), 1);
    // All of this in the document the reader asked in, which still holds the script.
    assert.equal(documentsOf(page), documents);
    assert.equal(await botCheckScripts(page), 1);
    assert.equal(await page.text('lock-state'), common.stateLocked);

    // -- The next move between screens loads a page: the script is gone before any key is loaded again.
    //    Here the move is the browser's Back button, which leads to Backup, where the reader was before. --
    await backWithLoad(page);
    await arrivesAt(page, '/wallet/backup');
    assert.equal(documentsOf(page), documents + 1, 'a full page load');
    assert.equal(await botCheckScripts(page), 0);
    assert.deepEqual(await looks(), [], 'no bot check in the new page');
    assert.equal(await page.page.evaluate(() => typeof (window as unknown as { turnstile?: unknown }).turnstile), 'undefined');
    await page.waitFor('reveal-words');
    assert.equal(await page.text('lock-state'), common.stateLocked);
    // From here on moves are inside the app again: the bot check was never in this page. Activity
    // lists the faucet's payment, and its row leads to the transaction's screen.
    await toSection(page, '/wallet/activity');
    await page.waitFor('tx-row');
    const rows = await page.texts('tx-row');
    assert.equal(rows.length, 1);
    assert.match(rows[0]!, /^Received \+100,000 practice sats Confirmed /);
    await page.click('tx-row');
    await arrivesAt(page, `/wallet/tx/${faucetTxid}`);
    await page.waitFor('tx-summary');
    assert.equal(await page.text('tx-summary'), fill(wallet.txSumReceived, { amount: '100,000 practice sats' }));
    assert.equal(await page.text('lock-state'), common.stateLocked);
    await toSection(page, '/wallet/send');
    assert.equal(documentsOf(page), documents + 1);
    await page.waitFor('send-spendable');
    assert.equal(await rowOf(page, 'main', 'send-spendable'), '100,000 practice sats');

    // -- The next payment asks for the passkey once --
    await page.click('pass-it-on');
    await page.waitFor('send-to-pot');
    const pot = await heldBy(page, 'send-to');
    await page.fill('send-amount', '30,000');
    await page.waitFor('send-plan');
    const plan = await figuresOf(page, 'send-plan');
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 });
    await page.click('send-continue');
    await page.waitFor('unlock-step');
    assert.ok((await page.text('unlock-step')).includes(wallet.unlockPromise));
    assert.equal(await usesOf(page), 0);
    await page.click('unlock');
    await page.waitFor('send-review');
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });
    assert.equal(await usesOf(page), 1);
    assertSignedAsPlanned(await figuresOf(page, 'send-review'), plan);
    await page.click('send-broadcast');
    const txid = await sentTxid(page);
    assert.equal(await page.text('sent-pot'), send.sentPot);
    assert.deepEqual(await s.network.coins(pot), { count: 1, sats: 30_000 });
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });
    assert.equal(await usesOf(page), 1);

    // -- What was counted --
    await countedExactly(s, page, requests, [
      view('/new'),
      { name: 'Passkey', path: '/new', value: 'ok' },
      { name: 'Wallet created', path: '/new', value: 'passkey' },
      view('/wallet/backup'),
      { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
      view('/wallet/receive'),
      view('/wallet/backup'),
      view('/wallet/receive'),
      { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
      view('/wallet/backup'),
      view('/wallet/activity'),
      view('/wallet/tx'),
      view('/wallet/send'),
      { name: 'Unlock', path: '/wallet/send', value: 'same' },
      { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
    ]);
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      { records: [record], words: [words], addresses: [address, pot], txids: [faucetTxid, txid] },
    );
  },
);

scenario(
  'a passkey that gives its secret only when asked a second time: two prompts make the wallet, "Wallet made" asks no third, and a later unlock gives the same 12 words',
  async (s) => {
    const page = await standBy(s, { passkey: 'prf-at-get', timeout: 30_000 });
    const prompts = await watchPrompts(page);
    const requests = watchEventRequests(page);
    await page.goto('/new');
    await page.waitFor('create-passkey');

    // One tap: the device makes the passkey, and is asked once more, by the same tap, for the secret.
    const made = await createFrom(page, 'create-passkey');
    const { record, words } = made;
    assert.equal(await headingOf(page), backup.madeTitle);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 }, 'create(), then one get() for the secret; the words needed no third prompt');
    assert.deepEqual((await page.passkey!.credentials()).map((each) => [each.id, each.uses]), [[record.credentialId, 1]]);
    assert.equal(await page.text('passkey-name'), await prompts.named());
    assert.equal(await page.stored(), JSON.stringify(passkeyRecordOf(made)));

    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    await page.waitFor('total');
    assert.equal(await page.text('lock-state'), UNLOCKED);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });

    // A page load locks the wallet. The words are asked for again: the unlock step, one more prompt, and
    // the secret the passkey gives now is the one it gave when the wallet was made.
    await page.goto('/wallet/backup');
    await page.waitFor('reveal-words');
    assert.equal(await page.text('lock-state'), common.stateLocked);
    assert.equal(await countOf(page, 'word'), 0);
    await page.click('reveal-words');
    await page.waitFor('unlock-step');
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });
    await page.click('unlock');
    assert.deepEqual(await wordsOnScreen(page), words, 'the same passkey gives the same 12 words');
    assert.deepEqual(await prompts.asked(), { create: 1, get: 2 });
    assert.equal(await usesOf(page), 2);
    assert.equal(await page.stored(), JSON.stringify(passkeyRecordOf(made)), 'the record is as Create stored it: this unlock found nothing to put right');

    await countedExactly(s, page, requests, [
      view('/new'),
      { name: 'Passkey', path: '/new', value: 'ok-at-get' },
      { name: 'Wallet created', path: '/new', value: 'passkey' },
      view('/wallet/backup'),
      { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
      view('/wallet'),
      view('/wallet/backup'),
      { name: 'Unlock', path: '/wallet/backup', value: 'same' },
      { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
    ]);
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [] },
    );
  },
);

scenario(
  'a passkey that never gives its secret: no wallet is made of it, and the way without a passkey still works, from Create to the last coin sent',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    const page = await standBy(s, { passkey: 'no-prf', timeout: 30_000 });
    const prompts = await watchPrompts(page);
    const requests = watchEventRequests(page);
    await page.goto('/new');
    await page.waitFor('create-passkey');
    await page.page.bringToFront();

    // The passkey is made, asked for its secret, and has none: no wallet, and the device is told to drop it.
    await page.click('create-passkey');
    await page.waitFor('create-problem');
    assert.ok((await page.text('create-problem')).includes(errors['passkey_no-prf']));
    assert.equal(await countOf(page, 'create-delete-passkey'), 1);
    assert.equal(await page.stored(), null);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });
    assert.deepEqual(await page.passkey!.credentials(), []);

    // The way on, on the same screen: without a passkey. "Wallet made" says what this browser now keeps.
    const made = await createFrom(page, 'create-words');
    const { record, words } = made;
    assert.equal(await headingOf(page), backup.madeTitle);
    assert.equal(await page.text('made-keeps'), `${backup.madeKeepsWords} ${backup.madeKeepsWho}`);
    assert.deepEqual([record.kind, record.mnemonic, record.credentialId, record.tag], ['words', words.join(' '), undefined, undefined]);
    for (const absent of ['passkey-name', 'passkey-tag', 'made-passkey', 'lock-state']) assert.equal(await countOf(page, absent), 0, absent);
    // Whether the browser agreed to keep this page's data: "Wallet made" says so, and Settings says the
    // same for as long as this page lives.
    const kept = await page.page.evaluate(() => navigator.storage.persisted());
    if (!kept) await page.waitFor('made-not-persisted');
    assert.equal(await countOf(page, 'made-not-persisted'), kept ? 0 : 1);
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    await toSection(page, '/wallet/settings');
    assert.equal(await page.text('wallet-kind'), settings.kindWords);
    assert.equal(await page.text('keeps-words'), settings.keepsWords);
    assert.deepEqual([await countOf(page, 'keeps-persisted'), await countOf(page, 'keeps-not-persisted')], kept ? [1, 0] : [0, 1]);

    // Coins arrive, and all of them go out again: the keys are the stored words, and nothing asks for a passkey.
    await toSection(page, '/wallet/receive');
    const address = await page.text('receive-address');
    assert.equal(address, record.firstAddress);
    const funding = s.standIn.fund(address, 100_000);
    assert.equal(await page.waitForStatus('arrived'), '100,000 practice sats arrived.');
    await toSection(page, '/wallet/send');
    await page.waitFor('send-spendable');
    await page.fill('send-to', SOMEBODY);
    await page.click('send-all');
    await page.waitFor('send-plan');
    const plan = await figuresOf(page, 'send-plan');
    assert.deepEqual([plan.total, plan.change], ['100,000 practice sats', send.planNoChange]);
    await page.click('send-continue');
    await page.waitFor('send-review');
    assert.equal(await countOf(page, 'unlock-step'), 0);
    assertSignedAsPlanned(await figuresOf(page, 'send-review'), plan);
    await page.click('send-broadcast');
    const txid = await sentTxid(page);
    assert.deepEqual(await s.network.coins(SOMEBODY), { count: 1, sats: satsIn(plan.amount) });
    assert.equal((await onNetwork(s, txid)).fee, satsIn(plan.fee));

    // The transaction's screen says why there is no change, and the Overview that the coins are gone, not that none have come.
    await page.click('sent-link');
    await arrivesAt(page, `/wallet/tx/${txid}`);
    await page.waitFor('tx-summary');
    assert.equal(await page.text('tx-summary'), fill(wallet.txSumSent, { amount: plan.total }));
    assert.equal(await page.text('tx-no-change'), wallet.txNoChange);
    assert.equal((await page.texts('tx-output')).length, 1);
    await toSection(page, '/wallet');
    await page.waitFor('no-coins');
    assert.ok((await page.text('no-coins')).startsWith(wallet.noCoinsLeft), await page.text('no-coins'));
    assert.equal(await page.text('total'), '0 practice sats');

    // Home names the wallet for what it is, and the failed passkey left nothing behind: not on the device, not in the count of prompts.
    await goHome(page);
    assert.equal(await page.text('wallet-here-kind'), home.hereWords);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });
    assert.deepEqual(await page.passkey!.credentials(), []);
    assert.deepEqual(await storedRecord(page), record);

    await countedExactly(s, page, requests, [
      view('/new'),
      { name: 'Passkey', path: '/new', value: 'no-prf' },
      { name: 'Wallet created', path: '/new', value: 'words' },
      view('/wallet/backup'),
      { name: 'Words shown', path: '/wallet/backup', value: 'words' },
      view('/wallet'),
      view('/wallet/settings'),
      view('/wallet/receive'),
      view('/wallet/send'),
      { name: 'Payment', path: '/wallet/send', value: 'sent' },
      view('/wallet/tx'),
      view('/wallet'),
      view('/'),
    ]);
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      { records: [record], words: [words], addresses: [address, SOMEBODY], txids: [funding, txid] },
    );
  },
);

scenario(
  'a passkey made on the Spanish page: "Wallet made" shows the name the device was given, and goes on showing that name when the reader switches to English',
  async (s) => {
    const page = await standBy(s, { passkey: 'prf', lang: 'es', timeout: 30_000 });
    const prompts = await watchPrompts(page);
    const requests = watchEventRequests(page);
    await page.goto('/es/new');
    await page.waitFor('create-passkey');
    const { record, words } = await createFrom(page, 'create-passkey', '/es');

    // The passkey was named in the language of the page that made it, and that is the name a password manager lists.
    const named = await prompts.named();
    assert.equal(named, fill(strings.common.es.passkeyName, { tag: record.tag ?? '' }));
    assert.notEqual(named, fill(common.passkeyName, { tag: record.tag ?? '' }));
    assert.equal(await headingOf(page), strings.backup.es.madeTitle);
    assert.equal(await page.text('passkey-name'), named);

    // The language switch, on the step: the same step in English, the words still there, and the
    // passkey's name as it was written. An English name built here would be one no password manager lists.
    await switchLanguage(page);
    await arrivesAt(page, '/wallet/backup');
    await headingBecomes(page, backup.madeTitle);
    assert.deepEqual(await wordsOnScreen(page), words);
    assert.equal(await page.text('passkey-name'), named);
    assert.deepEqual(
      await page.page.$eval(hook('passkey-name'), (name) => [name.getAttribute('translate'), name.closest('[lang]')?.getAttribute('lang')]),
      ['no', 'en'],
    );
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 });

    // Everywhere else the wallet is named by the tag alone, which is all this browser keeps of the name.
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    assert.deepEqual(await page.texts('passkey-tag'), [record.tag]);
    await toSection(page, '/wallet/settings');
    assert.equal(await page.text('passkey-tag'), record.tag);
    assert.ok(!(await page.page.$eval('main', (main) => main.textContent ?? '')).includes(named ?? 'no name'));

    // The words were shown once, and are counted once, under the screen in the language it had then.
    await countedExactly(s, page, requests, [
      view('/es/new'),
      { name: 'Passkey', path: '/es/new', value: 'ok' },
      { name: 'Wallet created', path: '/es/new', value: 'passkey' },
      view('/es/wallet/backup'),
      { name: 'Words shown', path: '/es/wallet/backup', value: 'passkey' },
      view('/wallet/backup'),
      view('/wallet'),
      view('/wallet/settings'),
    ]);
    nothingPrivate(
      { events: s.stack.events, lines: s.stack.lines, requests: requests() },
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [] },
    );
  },
);
