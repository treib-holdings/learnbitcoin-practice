// "Pass it on", the first step of the payment chapter, through the real
// screens: have coins that can be spent, send some to the pot with Send's
// "Pass it on", and see the payment get its first confirmation.
//
// Two of its three parts wait for the chain. A coin that is not in a block
// yet cannot be spent, and the payment is done only when a block has taken
// it in. So the first scenario holds the step's screen open and makes the
// blocks under it: each part must tick there, by itself.
//
//   1. from not started to done, in English: both chain parts tick while
//      the screen stays open, with no move and no reload
//   2. with "Send all", after a done "Hold some"; and both steps are still
//      done once the coins are gone, the wallet is removed and the page is
//      loaded again
//   3. with the page loaded again after every part, and with the faucet's
//      page load between two parts
//   4. it stays not done after a payment to an address that is not the pot's
//   5. the payment is sent in a second tab, and the tab with the step open
//      follows
//   6. while the practice network cannot answer, the open part is "not
//      known yet": never "no coins", and nothing to press but "Try again"
//   7. the count under a done step is the pot's own figure, and never says
//      whose payments it counts: with the step done on an earlier visit and
//      every payment on the chain somebody else's, the line says the count
//      alone; and a count the Worker has kept is an older figure in a
//      sentence that is still true
//   8. with the pot's counts switched off, which is how the Worker ships:
//      the step is done as ever, the done card has no count line, and the
//      page never asks for the counts
//
// The Worker ships with the pot's counts switched off (POT_COUNTS in
// worker/wrangler.jsonc), and a scenario's Worker has the shipped settings
// unless the scenario says otherwise. Scenarios 1, 2, 3 and 7 read the
// count line, so they switch the counts on (COUNTS_ON below). The others
// run as shipped: their pages show no count line and ask for none.
//
// All eight are local only: they pay the wallet from the stand-in, make
// blocks on it, ask the faucet, or take the network down.
//
// The other steps' files are named for their step. This one is not named
// for "pass-it-on": a live run that could not start prints the names of the
// scenario files, and must not hold the word "pass" (e2e/test/live.test.ts).

import assert from 'node:assert/strict';
import { deriveAddress, watchOnlyAccount } from '@learnbitcoin/practice-wallet';
import { API } from '@learnbitcoin/practice-contract';
import { POT_STATS_KEEP_MS, POT_STATS_PAUSE_MS } from '@learnbitcoin/practice-worker';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { OTHER_WORDS, TEST_WORDS, scenario, testRecord, type OpenedPage, type Scenario, type ScenarioOptions } from './helpers.ts';
import {
  arrivesAt,
  attributeOf,
  botCheckScripts,
  countOf,
  documentsOf,
  hook,
  onNetwork,
  standBy,
  storageKeys,
  until,
  untilAnswersCount,
  untilPhase,
  watchEventRequests,
} from './journey-helpers.ts';
import {
  PROGRESS_KEY,
  act,
  begin,
  doIt,
  ends,
  endsTwo,
  hrefOf,
  ledeOf,
  listState,
  mainSays,
  marked,
  noteFor,
  noteOf,
  noteText,
  partName,
  partWords,
  partsOf,
  pay,
  pickStep,
  reloadStep,
  saidDone,
  saidTicked,
  stepsCounted,
  stripBack,
  stripOf,
  untilParts,
  untilStrip,
  view,
  type Reader,
} from './doit-helpers.ts';

const en = strings.doit.en;
const wallet = strings.wallet.en;

const STEP = 'pass-it-on';
const CHAPTER = '/journey/how-bitcoin-works';

/** The 12 words of the prepared wallet, one by one. */
const WORDS = TEST_WORDS.split(' ');

/** An address that is neither the wallet's nor the pot's: the first address of the harness's second wallet. */
const SOMEBODY = testRecord(OTHER_WORDS).firstAddress;

/** The prepared wallet's receive address number `index`. */
const receiveAddress = (index: number): string => deriveAddress(watchOnlyAccount(testRecord().xpub), 0, index).address;

/**
 * The Worker's settings with the pot's counts switched on: for the scenarios that read the count line under a
 * done "Pass it on". (Off is how the Worker ships, and how every scenario runs that does not say this.)
 */
const COUNTS_ON: ScenarioOptions['stack'] = { vars: { POT_COUNTS: 'on' } };

/**
 * Keeps every request a page sends from now on, in the order the browser sends them and across page loads:
 * the method, and the path with its query string. Files, the Worker's paths, everything.
 */
function watchRequests(page: OpenedPage): () => string[] {
  const seen: string[] = [];
  page.page.on('request', (request) => {
    let asked = request.url();
    try {
      const url = new URL(asked);
      asked = `${url.pathname}${url.search}`;
    } catch {
      // An address that is none is kept as it was written.
    }
    seen.push(`${request.method()} ${asked}`);
  });
  return () => [...seen];
}

/** The address the pot hands out right now, asked of the bots directly. */
async function potOnNetwork(s: Scenario): Promise<string> {
  const answer = await fetch(`${s.stack.originUrl}/bots/pot/address`, { headers: { Authorization: `Bearer ${s.standIn.token}` } });
  return ((await answer.json()) as { address: string }).address;
}

scenario(
  'Pass it on, from not started to done: a coin that is not in a block yet cannot be spent, the block that makes it spendable and the block that takes the payment in both come while the step stays open, and the pot counts one payment',
  { localOnly: true, timeout: 200_000, stack: COUNTS_ON },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 100_000, { confirmed: false });
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;

    // -- Part 1 cannot be done yet: the one coin waits for its block. The page says so, and offers nothing to press. --
    await untilParts(page, ['blocked', 'later', 'later']);
    assert.equal(await page.text('step-title'), en['title_pass-it-on']);
    // The lede names the step's own chapter by the number the app's table of chapters gives.
    assert.ok(await mainSays(page, ledeOf(STEP)), ledeOf(STEP));
    assert.deepEqual(await partWords(page), [en.partBlocked, en.partLater, en.partLater]);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'not-spendable-yet');
    assert.ok((await page.text('step-need')).startsWith(fill(en['need_not-spendable-yet'], { seconds: String(s.stack.config.blockSeconds) })));
    assert.deepEqual([await countOf(page, 'step-need-link'), await countOf(page, 'step-action')], [0, 0]);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#do-${STEP}`);

    // -- A block comes while the screen stays open: the coin can be spent, and part 1 ticks by itself --
    const first = await marked(page);
    await s.network.nextBlock();
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal(await first(), true, 'the step stayed open: the same screen in the same document');
    assert.equal(await page.waitForStatus(saidTicked(STEP, 1)), saidTicked(STEP, 1));
    assert.equal(await page.text('step-guide'), en['guide_pass-it-on_2']);

    // -- Part 2: Send's "Pass it on" fills in an address of the pot. The payment is noted, with its ID and the moment. --
    await act(page, '/wallet/send');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    const before = Date.now();
    const paid = await pay(page, 'pot', '30,000');
    assert.equal(await page.waitForStatus(wallet.noticeSent), wallet.noticeSent);
    const note = (await noteOf(page))?.steps[STEP];
    assert.deepEqual([note?.parts, note?.tx], [{ 1: true, 2: true }, paid.txid]);
    assert.ok(note?.sentAt !== undefined && note.sentAt >= before && note.sentAt <= Date.now(), `sent at ${note?.sentAt}`);
    // On Send the wallet does not read its list of transactions, so the strip names the part and claims no wait.
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 3));

    // -- Part 3 waits: not in a block yet, sent a moment ago, the chain's height, how often a block comes, the explorer --
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.deepEqual(await partWords(page), [en.proofChecked, en.proofChecked, en.partNow]);
    assert.equal(await attributeOf(page, 'step-waiting', 'data-lost'), 'no');
    const waiting = await page.text('step-waiting');
    assert.ok(waiting.startsWith(en.waitNotYet), waiting);
    assert.match(await page.text('step-waiting-sent'), /^Sent (just now|\d+ seconds? ago)\.$/);
    assert.equal(await page.text('step-waiting-tip'), fill(en.waitTip, { height: String(await s.network.height()) }));
    assert.ok(waiting.includes(fill(en.waitEvery, { seconds: String(s.stack.config.blockSeconds) })), waiting);
    assert.equal(await hrefOf(page, 'step-waiting-explorer'), `${s.stack.config.explorerUrl}/tx/${paid.txid}`);
    assert.deepEqual([await countOf(page, 'step-action'), await countOf(page, 'step-send-another')], [0, 0]);

    // -- The block comes while the screen stays open: the step is done --
    const second = await marked(page);
    page.forgetStatus();
    const height = await s.network.nextBlock();
    await page.waitFor('step-done');
    assert.equal(await second(), true, 'the step stayed open: the same screen in the same document');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);
    assert.equal((await onNetwork(s, paid.txid)).status.block_height, height);
    // The one line the part keeps: how long the payment waited, and which block took it in.
    assert.match(await page.text('step-waited'), new RegExp(`^It waited (1 second|\\d+ seconds)\\. Block ${height} took it in\\.$`));
    // Asked once, of the pot itself: payments, not people, and never whose.
    await page.waitFor('step-pot-count');
    assert.equal(await page.text('step-pot-count'), en.potCountOne);
    assert.equal(await page.text('step-done-text'), en['done_pass-it-on']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#done=${STEP}`);
    // The next step of the same chapter is offered.
    assert.equal(await page.text('step-next'), fill(en.next, { step: en['title_no-balances'] }));
    assert.equal(await hrefOf(page, 'step-next'), '/do/no-balances');
    // Done, the note lets go of the payment it waited for.
    const done = await noteOf(page);
    const kept = done?.steps[STEP];
    assert.ok(kept?.doneAt !== undefined);
    assert.deepEqual(done, { v: 1, following: null, steps: { 'pass-it-on': { started: true, doneAt: kept.doneAt, parts: { 1: true, 2: true, 3: true } } } });

    await ends(
      s,
      reader,
      [view('/do/pass-it-on'), view('/wallet/send'), { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' }, view('/do/pass-it-on'), doIt('/do/pass-it-on', STEP)],
      { records: [record], words: [WORDS], addresses: [record.firstAddress, paid.to], txids: [funding, paid.txid] },
    );
  },
);

scenario(
  'Pass it on with "Send all", after a done "Hold some": both are done, and both are still done once the coins are gone, the wallet is removed and the page is loaded again',
  { localOnly: true, timeout: 200_000, stack: COUNTS_ON },
  async (s) => {
    const record = testRecord();
    const fundings = [s.standIn.fund(receiveAddress(0), 100_000), s.standIn.fund(receiveAddress(1), 40_000)];
    const firstBlock = (await onNetwork(s, fundings[0]!)).status.block_height ?? 0;
    // Somebody passed coins on before this reader did: one payment to the pot is in a block already.
    const earlier = s.standIn.fund(await potOnNetwork(s), 5_000);
    const reader = await begin(s, '/do/hold-some', { record });
    const { page } = reader;

    // -- "Hold some": the wallet is here and holds confirmed coins, so three parts tick as it opens. The block is the first coin's. --
    await untilParts(page, ['ticked', 'ticked', 'ticked', 'now']);
    await page.fill('step-block-answer', String(firstBlock));
    await page.click('step-block-check');
    await page.waitFor('step-done');
    assert.equal(await page.waitForStatus(saidDone('hold-some')), saidDone('hold-some'));

    // -- "Pass it on", by the list, inside the same page --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    assert.deepEqual([await listState(page, 'hold-some'), await listState(page, STEP)], ['done', 'not-started']);
    await pickStep(page, STEP);
    // The coins are known already, so part 1 is ticked before the screen is drawn: there is no change to read out.
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);
    assert.ok(!page.statusLog().includes(saidTicked(STEP, 1)), page.statusLog().join(' | '));

    // -- "Send all" to the pot: every coin goes, and nothing comes back as change --
    await act(page, '/wallet/send');
    const paid = await pay(page, 'pot', 'all');
    const tx = await onNetwork(s, paid.txid);
    assert.deepEqual(tx.vout.map((output) => output.scriptpubkey_address), [paid.to], 'one output: the pot, and no change');
    assert.equal(tx.vin.length, 2);
    assert.equal((await noteOf(page))?.steps[STEP]?.tx, paid.txid);
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(await countOf(page, 'step-waiting'), 1);

    // -- The block comes, and the page that is loaded after it finds the payment in it: done --
    await s.network.nextBlock();
    await reloadStep(page);
    await page.waitFor('step-done');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    // The pot's own count: two payments now. Payments, not people, and the line does not say whose.
    await page.waitFor('step-pot-count');
    assert.equal(await page.text('step-pot-count'), fill(en.potCount, { count: '2' }));
    assert.deepEqual(stepsCounted(s), { 'hold-some': 1, 'pass-it-on': 1 });
    const stored = await noteText(page);

    // -- The coins are gone. "Hold some" rested on a confirmed coin, and is done all the same. --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    assert.deepEqual([await listState(page, 'hold-some'), await listState(page, STEP)], ['done', 'done']);
    await pickStep(page, 'hold-some');
    await page.waitFor('step-done');
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked', 'ticked']);
    await page.goto('/wallet');
    await page.waitFor('no-coins');
    assert.equal(await page.text('total'), '0 practice sats');
    assert.equal(await stripOf(page), null, 'nothing is followed: both steps were seen done');

    // -- The wallet is removed. The note of the steps is not touched, and says the same. --
    await page.goto('/wallet/settings');
    await page.click('remove-wallet');
    await page.waitFor('remove-confirm');
    await untilAnswersCount();
    await page.click('remove-confirm');
    await arrivesAt(page, '/');
    await page.waitFor('home-removed');
    assert.deepEqual(await storageKeys(page), [PROGRESS_KEY]);
    assert.equal(await noteText(page), stored, 'removing the wallet changed nothing in the note');
    await page.click('home-do-link');
    await arrivesAt(page, '/do');
    assert.deepEqual([await listState(page, 'hold-some'), await listState(page, STEP)], ['done', 'done']);
    for (const id of ['hold-some', STEP] as const) {
      await pickStep(page, id);
      await page.waitFor('step-done');
      assert.ok((await partsOf(page)).every((part) => part === 'ticked'), `${id} with no wallet`);
      // -- And after a reload, with no wallet and no coins: done --
      await reloadStep(page);
      await page.waitFor('step-done');
      assert.ok((await partsOf(page)).every((part) => part === 'ticked'), `${id} after a reload`);
      // What the card says is what the reader did. It is as true now, with the coins sent on and the wallet
      // gone from this browser: it says nothing of what the wallet or the pot holds today.
      const said = await page.text('step-done-text');
      assert.equal(said, en[`done_${id}`]);
      assert.doesNotMatch(said, /\byou hold\b|\bholds your coins\b|\bis in a block\b|\bstill\b|\bnow\b/i, id);
      assert.equal(await hrefOf(page, 'step-back'), `${s.stack.config.siteUrl}${id === STEP ? CHAPTER : '/journey/what-bitcoin-actually-is'}#done=${id}`);
      assert.equal(await countOf(page, 'step-need'), 0);
      await page.click('step-list');
      await arrivesAt(page, '/do');
    }
    assert.equal(await noteText(page), stored);
    assert.deepEqual(stepsCounted(s), { 'hold-some': 1, 'pass-it-on': 1 }, 'each counted once');

    await ends(
      s,
      reader,
      [
        view('/do/hold-some'),
        doIt('/do/hold-some', 'hold-some'),
        view('/do'),
        view('/do/pass-it-on'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view('/do/pass-it-on'),
        view('/do/pass-it-on'),
        doIt('/do/pass-it-on', STEP),
        view('/do'),
        view('/do/hold-some'),
        view('/wallet'),
        view('/wallet/settings'),
        { name: 'Wallet removed', path: '/wallet/settings', value: 'words' },
        view('/'),
        view('/do'),
        view('/do/hold-some'),
        view('/do/hold-some'),
        view('/do'),
        view('/do/pass-it-on'),
        view('/do/pass-it-on'),
        view('/do'),
      ],
      { records: [record], words: [WORDS], addresses: [receiveAddress(0), receiveAddress(1), paid.to], txids: [...fundings, earlier, paid.txid] },
    );
  },
);

scenario(
  'Pass it on with the page loaded again after every part, and the faucet asked between two parts: each tick is still there after each load, and the payment noted before a load is the one the step waits for after it',
  { localOnly: true, timeout: 200_000, stack: COUNTS_ON },
  async (s) => {
    const record = testRecord();
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;

    // -- No coins: part 1 says what is missing, and where it is put right. So it does after a reload. --
    await untilParts(page, ['blocked', 'later', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-coins');
    assert.ok((await page.text('step-need')).startsWith(en['need_no-coins']));
    assert.equal(await hrefOf(page, 'step-need-link'), '/do/hold-some');
    await reloadStep(page);
    await untilParts(page, ['blocked', 'later', 'later']);

    // -- The faucet, by its own address. The coin arrives unconfirmed: the strip names what is missing. --
    await page.goto('/wallet/receive#faucet');
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    await page.click('faucet-ask');
    await untilPhase(page, 'arrived');
    const faucetTxid = ((await attributeOf(page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    assert.equal((await untilStrip(page, STEP, 'need')).words, en['stripNeed_not-spendable-yet']);
    // The block makes it spendable: part 1 ticks here, on Receive, and the strip moves on to part 2.
    await s.network.nextBlock();
    await untilPhase(page, 'confirmed');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    assert.deepEqual((await noteOf(page))?.steps[STEP]?.parts, { 1: true });

    // -- The bot check's script has been in the page: the way back loads a page, and part 1 is ticked on it --
    const documents = documentsOf(page);
    assert.equal(await botCheckScripts(page), 1);
    await stripBack(page, STEP, { load: true });
    assert.equal(documentsOf(page), documents + 1);
    await untilParts(page, ['ticked', 'now', 'later']);
    await reloadStep(page);
    await untilParts(page, ['ticked', 'now', 'later']);

    // -- Part 2, and a reload on Send's own "sent" view, then on the step --
    await act(page, '/wallet/send');
    const paid = await pay(page, 'pot', '25,000');
    const noted = (await noteOf(page))?.steps[STEP];
    assert.equal(noted?.tx, paid.txid);
    await page.page.reload({ waitUntil: 'load' });
    await untilStrip(page, STEP, 'part');
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(await hrefOf(page, 'step-waiting-explorer'), `${s.stack.config.explorerUrl}/tx/${paid.txid}`);
    await reloadStep(page);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    // The moment it was sent is in the note, so the page that was loaded since still says how long ago that was.
    assert.match(await page.text('step-waiting-sent'), /^Sent (just now|\d+ seconds? ago)\.$/);
    assert.deepEqual((await noteOf(page))?.steps[STEP], noted, 'the note is as it was before the two loads');
    assert.equal(stepsCounted(s)[STEP], undefined);

    // -- Part 3: the block, and the page loaded after it. Done, and done after two more loads. --
    const height = await s.network.nextBlock();
    await reloadStep(page);
    await page.waitFor('step-done');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.ok((await page.text('step-waited')).endsWith(`Block ${height} took it in.`), await page.text('step-waited'));
    for (const again of [1, 2]) {
      await reloadStep(page);
      await page.waitFor('step-done');
      assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked'], `after reload ${again}`);
      // The note has let go of the payment, so a page loaded later does not say how long it waited.
      assert.equal(await countOf(page, 'step-waited'), 0);
    }
    assert.deepEqual(stepsCounted(s), { 'pass-it-on': 1 });

    // -- The pot's count is asked for each time a done "Pass it on" is shown. The Worker does not ask the bots
    //    each time: it asks once and gives every page that answer for 15 seconds (worker/src/pot-stats.ts). So
    //    with the bots stopped, a page loaded within that time would still be given the count. Here the 15
    //    seconds are over for the Worker: it has to ask, the bots cannot answer, and the line is left out.
    //    Nothing else on the screen changes. --
    await page.waitFor('step-pot-count');
    assert.equal(await page.text('step-pot-count'), en.potCountOne);
    s.expectFault('origin_down');
    s.standIn.setFaucet('down');
    s.stack.advanceClock(POT_STATS_KEEP_MS);
    await reloadStep(page);
    await page.waitFor('step-done');
    await page.settle();
    assert.equal(await countOf(page, 'step-pot-count'), 0);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);
    assert.equal(await page.text('step-done-text'), en['done_pass-it-on']);
    // The bots are back. The Worker kept no counts of the answer that failed. What it noted is that a question
    // failed: for 5 seconds after that it asks nobody, so that bots which are down or slow are left alone. A
    // page loaded within that time is told "unavailable" without the bots being asked, and shows no line...
    s.standIn.setFaucet('ok');
    const askedBots = (): number => s.standIn.requests().filter((request) => request.path === '/bots/pot/stats').length;
    const before = askedBots();
    await reloadStep(page);
    await page.waitFor('step-done');
    await page.settle();
    assert.equal(await countOf(page, 'step-pot-count'), 0);
    assert.equal(askedBots(), before, 'the bots were not asked in the pause');
    // ...and once those 5 seconds are over for the Worker, the page that is loaded next is given the count again.
    s.stack.advanceClock(POT_STATS_PAUSE_MS);
    await reloadStep(page);
    await page.waitFor('step-pot-count');
    assert.equal(await page.text('step-pot-count'), en.potCountOne);
    assert.equal(askedBots(), before + 1);

    await ends(
      s,
      reader,
      [
        view('/do/pass-it-on'),
        view('/do/pass-it-on'),
        view('/wallet/receive'),
        { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
        view('/do/pass-it-on'),
        view('/do/pass-it-on'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view('/wallet/send'),
        view('/do/pass-it-on'),
        view('/do/pass-it-on'),
        view('/do/pass-it-on'),
        doIt('/do/pass-it-on', STEP),
        view('/do/pass-it-on'),
        view('/do/pass-it-on'),
        view('/do/pass-it-on'),
        view('/do/pass-it-on'),
        view('/do/pass-it-on'),
      ],
      { records: [record], words: [WORDS], addresses: [address, paid.to], txids: [faucetTxid, paid.txid] },
    );
  },
);

scenario(
  'Pass it on stays not done after a payment to an address that is not the pot\'s: the payment goes out and confirms, part 2 is still to do, and nothing is counted',
  { localOnly: true },
  async (s) => {
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;
    await untilParts(page, ['ticked', 'now', 'later']);

    // A payment while the step is followed, typed by hand to somebody else's address.
    await act(page, '/wallet/send');
    const paid = await pay(page, SOMEBODY, '20,000');
    assert.equal(await page.waitForStatus(wallet.noticeSent), wallet.noticeSent);
    assert.equal(await countOf(page, 'sent-pot'), 0);
    assert.deepEqual(await s.network.coins(SOMEBODY), { count: 1, sats: 20_000 });
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2), 'the strip still asks for a payment to the pot');
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal(await hrefOf(page, 'step-action'), '/wallet/send');

    // It confirms, the page is loaded again: the step is where it was.
    await s.network.nextBlock();
    await reloadStep(page);
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal((await onNetwork(s, paid.txid)).status.confirmed, true);
    assert.deepEqual((await noteOf(page))?.steps, { 'pass-it-on': { started: true, parts: { 1: true } } });
    assert.equal(await countOf(page, 'step-done'), 0);
    assert.ok(!page.statusLog().includes(saidTicked(STEP, 2)) && !page.statusLog().includes(saidDone(STEP)), page.statusLog().join(' | '));
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [view('/do/pass-it-on'), view('/wallet/send'), { name: 'Payment', path: '/wallet/send', value: 'sent' }, view('/do/pass-it-on'), view('/do/pass-it-on')],
      { records: [record], words: [WORDS], addresses: [record.firstAddress, SOMEBODY], txids: [funding, paid.txid] },
    );
  },
);

scenario(
  'Pass it on with the payment sent in a second tab: the tab that sent it ticks the part, the tab with the step open follows without a move or a reload, and the step is counted once',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const first = await begin(s, `/do/${STEP}`, { record });
    await untilParts(first.page, ['ticked', 'now', 'later']);
    const same = await marked(first.page);

    // -- A second tab of the same browser, on Send. It shares the note, so its strip is for the step the first tab follows. --
    const tab = await standBy(s, { context: first.page.context, timeout: 30_000 });
    const second: Reader = { page: tab, requests: watchEventRequests(tab) };
    await tab.goto('/wallet/send');
    assert.equal((await untilStrip(tab, STEP, 'part')).words, partName(STEP, 2));
    const paid = await pay(tab, 'pot', '30,000');
    assert.equal((await untilStrip(tab, STEP, 'part')).words, partName(STEP, 3));

    // -- The first tab learns of it from the note: part 2 is ticked there too, and the payment it waits for is that
    //    one. Its own list of transactions is older than the payment, so it says nothing of where the payment
    //    stands: neither "not in a block yet" nor, later, "lost". (A tab that is not in view reads nothing.) --
    await untilParts(first.page, ['ticked', 'ticked', 'unknown']);
    assert.equal(await attributeOf(first.page, 'step-unknown', 'data-reason'), 'history');
    assert.deepEqual([await countOf(first.page, 'step-waiting'), await countOf(first.page, 'step-send-another')], [0, 0]);
    assert.equal((await noteOf(first.page))?.steps[STEP]?.tx, paid.txid);
    assert.equal(await first.page.waitForStatus(saidTicked(STEP, 2)), saidTicked(STEP, 2));

    // -- The reader goes back to the first tab, and a block takes the payment in: still on the same screen, the
    //    step is done there --
    await first.page.page.bringToFront();
    await s.network.nextBlock();
    await first.page.waitFor('step-done');
    assert.equal(await same(), true, 'the first tab stayed where it was: the same screen in the same document');
    assert.equal(await first.page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.deepEqual(await partsOf(first.page), ['ticked', 'ticked', 'ticked']);
    assert.deepEqual(stepsCounted(s), { 'pass-it-on': 1 });
    // The reader has seen it done on the step's own screen, so the step is let go: the strip leaves the tab that sent the payment.
    await until(async () => (await stripOf(tab)) === null, 'the strip is gone from the second tab');
    assert.equal((await noteOf(tab))?.following, null);

    await endsTwo(
      s,
      [
        { reader: first, expected: [view('/do/pass-it-on'), doIt('/do/pass-it-on', STEP)] },
        { reader: second, expected: [view('/wallet/send'), { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' }] },
      ],
      { records: [record], words: [WORDS], addresses: [record.firstAddress, paid.to], txids: [funding, paid.txid] },
    );
  },
);

scenario(
  'Pass it on while the practice network cannot answer: the open part is "not known yet", with the cause and "Try again"; it never says "no coins" and offers nothing to do; once the network is back, "Try again" finds the coins and the part ticks',
  { localOnly: true },
  async (s) => {
    s.expectFault('origin_down');
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    s.standIn.setOrigin('down');
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;

    // -- The wallet's first look at its coins fails. What the part rests on is not known: that is said, and nothing else. --
    await page.page.waitForSelector(`${hook('step-unknown')}[data-reason="scan-failed"]`);
    assert.deepEqual(await partsOf(page), ['unknown', 'later', 'later']);
    assert.deepEqual(await partWords(page), [en.partUnknown, en.partLater, en.partLater]);
    assert.match(await page.text('step-unknown'), /^The practice network could not answer just now\. The fault is on our side\./);
    for (const absent of ['step-need', 'step-need-link', 'step-action', 'step-guide', 'step-waiting']) assert.equal(await countOf(page, absent), 0, absent);
    assert.ok(!(await page.text('step-parts')).includes(en['need_no-coins']), 'never "no coins" while nobody knows');
    assert.deepEqual((await noteOf(page))?.steps, { 'pass-it-on': { started: true } });

    // -- The strip says the same on the wallet's own screens --
    await page.goto('/wallet');
    await page.waitFor('chain-failed');
    assert.equal((await untilStrip(page, STEP, 'failed')).words, en.stripFailed);
    await stripBack(page, STEP);
    await page.page.waitForSelector(`${hook('step-unknown')}[data-reason="scan-failed"]`);
    assert.deepEqual((await noteOf(page))?.steps, { 'pass-it-on': { started: true } });

    // -- The network is back: "Try again" finds the coins, and the part ticks on this screen --
    s.standIn.setOrigin('ok');
    await page.page.locator(`${hook('step-unknown')} button`).click();
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal(await page.waitForStatus(saidTicked(STEP, 1)), saidTicked(STEP, 1));
    assert.equal(await hrefOf(page, 'step-action'), '/wallet/send');
    assert.deepEqual(stepsCounted(s), {});

    await ends(s, reader, [view('/do/pass-it-on'), view('/wallet'), view('/do/pass-it-on')], {
      records: [record],
      words: [WORDS],
      addresses: [record.firstAddress],
      txids: [funding],
    });
  },
);

scenario(
  'The count under a done "Pass it on" is the pot\'s own figure and never says whose payments it counts: with the step done on an earlier visit and this wallet having paid nothing on the chain as it is now, the line is left out while the pot counts none, says "One payment" when somebody else has paid, and "3 payments" after two more; a figure the Worker has kept from a moment before is older, and the sentence is still true',
  { localOnly: true, timeout: 150_000, stack: COUNTS_ON },
  async (s) => {
    const record = testRecord();
    // "Pass it on", done three days ago: as it stands in a browser whose practice chain has been started again
    // since. The note of a done step names no payment, and this wallet has sent none on the chain as it is now.
    const doneAt = Date.now() - 3 * 86_400_000;
    const stored = noteFor({ following: null, steps: { [STEP]: { started: true, doneAt, parts: { 1: true, 2: true, 3: true } } } });
    const reader = await begin(s, `/do/${STEP}`, { record, storage: { [PROGRESS_KEY]: stored } });
    const { page } = reader;
    /** How many answers the Worker has given to a look at the pot's counts, and how many of them it asked the network for. */
    const looks = (): [answered: number, asked: number] => {
      const lines = s.stack.lines.filter((line) => line.route === 'pot_stats');
      return [lines.filter((line) => line.status === 200).length, lines.filter((line) => line.upstream === 200).length];
    };
    /** The done step's screen, loaded anew, once the pot's counts have come: the line under it, or null when there is none. */
    const potLine = async (path = `/do/${STEP}`): Promise<string | null> => {
      const [answered] = looks();
      await page.goto(path);
      await page.waitFor('step-done');
      await until(() => looks()[0] > answered, 'the pot\'s counts were asked for and answered');
      await page.settle();
      return (await page.texts('step-pot-count'))[0] ?? null;
    };

    // -- The pot counts no payment on this chain. The step is done all the same, and the line is left out. --
    await page.waitFor('step-done');
    await until(() => looks()[0] === 1, 'the pot\'s counts were asked for and answered');
    await page.settle();
    assert.deepEqual(looks(), [1, 1]);
    assert.equal(await countOf(page, 'step-pot-count'), 0);
    // The card says what happened three days ago. On this chain no block holds the payment and the pot holds
    // no coin of this wallet's, and the sentence is true all the same: it says nothing of what is so today.
    assert.equal(await page.text('step-done-text'), en['done_pass-it-on']);
    assert.equal(en['done_pass-it-on'], 'Your payment got into a block, and the pot took your coins to hand on to a learner who comes after you. The fee was what went in less what came out.');

    // -- Somebody else passes coins on, and a block takes the payment in. It is the only payment the pot has
    //    seen, and it is not this reader's. --
    const theirs = [s.standIn.fund(await potOnNetwork(s), 5_000)];
    // A page loaded within the next seconds is given the count the Worker has kept: an older figure, and no line.
    assert.equal(await potLine(), null);
    assert.deepEqual(looks(), [2, 1], 'the Worker gave the count it had kept, and asked nobody');
    // Once the Worker asks again, the line says how many, and not whose: with "yours" in it, it would be false here.
    s.stack.advanceClock(POT_STATS_KEEP_MS);
    assert.equal(await potLine(), 'One payment has been passed on to the pot so far.');
    assert.equal(en.potCountOne, 'One payment has been passed on to the pot so far.');
    assert.deepEqual(looks(), [3, 2]);

    // -- Two more, by others. The kept figure is one behind the chain for a moment, and what the line says is
    //    still so; then the count is three. --
    theirs.push(s.standIn.fund(await potOnNetwork(s), 6_000), s.standIn.fund(await potOnNetwork(s), 7_000));
    assert.equal(await potLine(), en.potCountOne);
    s.stack.advanceClock(POT_STATS_KEEP_MS);
    assert.equal(await potLine(), '3 payments have been passed on to the pot so far.');
    assert.equal(fill(en.potCount, { count: '3' }), '3 payments have been passed on to the pot so far.');
    // In Spanish, the same count and no more.
    assert.equal(await potLine(`/es/do/${STEP}`), 'Hasta ahora se han pasado 3 pagos al fondo común.');
    assert.equal(
      await page.text('step-done-text'),
      'Tu pago entró en un bloque, y el fondo común recibió tus monedas para pasarlas a alguien que viene después de ti. La comisión fue lo que entró menos lo que salió.',
    );
    assert.equal(fill(strings.doit.es.potCount, { count: '3' }), 'Hasta ahora se han pasado 3 pagos al fondo común.');
    for (const line of [en.potCountOne, en.potCount, strings.doit.es.potCountOne, strings.doit.es.potCount]) {
      assert.doesNotMatch(line, /\byours?\b|among them|\btuyo\b|entre ellos/i, line);
    }

    // The step was done on an earlier visit: nothing here counted it again, and its note is as it was.
    assert.deepEqual(stepsCounted(s), {});
    assert.equal(await noteText(page), stored);

    await ends(
      s,
      reader,
      [view('/do/pass-it-on'), view('/do/pass-it-on'), view('/do/pass-it-on'), view('/do/pass-it-on'), view('/do/pass-it-on'), view('/es/do/pass-it-on')],
      { records: [record], words: [WORDS], addresses: [record.firstAddress], txids: theirs },
    );
  },
);

scenario(
  'Pass it on with the pot\'s counts switched off, as the Worker ships: the step is done as ever, the done card has no count line, and the page never asks for the counts, not when the step is done, not when its screen is loaded again, not from the list, not in Spanish; asked for by hand, they are a path the Worker does not know, and the practice network is left alone',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    // As shipped: nothing in this scenario's settings switches the counts on, and the app is told that they cannot be had.
    assert.equal(s.stack.config.potCounts, false);
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    // The watches are in place before the app loads: what the page counts, and every request it sends at all.
    const page = await standBy(s, { timeout: 30_000, record });
    const reader: Reader = { page, requests: watchEventRequests(page) };
    const sent = watchRequests(page);
    await page.goto(`/do/${STEP}`);

    // -- The step, from its first part to done, with the block coming while the screen stays open --
    await untilParts(page, ['ticked', 'now', 'later']);
    await act(page, '/wallet/send');
    const paid = await pay(page, 'pot', '30,000');
    assert.equal(await page.waitForStatus(wallet.noticeSent), wallet.noticeSent);
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    page.forgetStatus();
    const height = await s.network.nextBlock();
    await page.waitFor('step-done');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);
    assert.equal((await onNetwork(s, paid.txid)).status.block_height, height);
    assert.deepEqual(stepsCounted(s), { 'pass-it-on': 1 });

    /** The done card as it stands once the page has gone quiet: whole, but for the line with the pot's count. */
    const cardWithoutCount = async (lang: 'en' | 'es', why: string): Promise<void> => {
      await page.waitFor('step-done');
      await page.settle();
      assert.equal(await countOf(page, 'step-pot-count'), 0, why);
      assert.equal(await page.text('step-done-text'), strings.doit[lang]['done_pass-it-on'], why);
      assert.equal(await countOf(page, 'step-back'), 1, why);
      assert.equal(await countOf(page, 'step-next'), 1, why);
    };
    await cardWithoutCount('en', 'the moment the step is done');
    assert.equal(await hrefOf(page, 'step-back'), `${s.stack.config.siteUrl}${CHAPTER}#done=${STEP}`);

    // -- The same card on a page that is loaded on it (its settings arrive after the card is drawn), from the
    //    list inside the page, and in Spanish --
    await reloadStep(page);
    await cardWithoutCount('en', 'after a reload');
    await page.click('step-list');
    await arrivesAt(page, '/do');
    assert.equal(await listState(page, STEP), 'done');
    await pickStep(page, STEP);
    await cardWithoutCount('en', 'from the list');
    await page.goto(`/es/do/${STEP}`);
    await cardWithoutCount('es', 'in Spanish');

    // -- Every request the page sent, from its first to its last: none for the pot's counts. Of the pot it
    //    asked for one thing, once: the address that "Pass it on" pays. --
    const all = sent();
    assert.ok(all.filter((line) => line === `GET ${API.config}`).length >= 3, 'the page read its settings on every load');
    assert.ok(all.some((line) => line.startsWith(`GET ${API.esplora}/`)), 'and the chain');
    assert.deepEqual(
      all.filter((line) => line.includes(API.potStats)),
      [],
      'no request for the pot\'s counts left the page',
    );
    assert.deepEqual(
      all.filter((line) => /\/pot\b|stats/i.test(line)),
      [`POST ${API.potAddress}`],
    );
    // What the Worker wrote down agrees: no line for that route, and none for a path it does not know, which is
    // what a request for the counts would have left.
    assert.deepEqual(
      s.stack.lines.filter((line) => line.route === 'pot_stats' || line.route === 'unknown'),
      [],
    );
    // And so does the practice network: its bots were asked for the pot's address, and never for its counts.
    const bots = (): string[] => s.standIn.requests().filter((request) => request.path.startsWith('/bots/pot')).map((request) => `${request.method} ${request.path}`);
    assert.deepEqual(bots(), ['GET /bots/pot/address']);

    // -- Asked for by hand, as anybody can ask: a path the Worker does not know. The answer is the answer to
    //    any such path, header for header and byte for byte, and the practice network hears nothing of it. --
    const answerOf = async (path: string, init?: RequestInit): Promise<[status: number, headers: string[], body: string]> => {
      const response = await fetch(`${s.url}${path}`, init);
      // (The time of day and the connection are the local server's own, not the Worker's.)
      const headers = [...response.headers].filter(([name]) => name !== 'date' && name !== 'connection' && name !== 'keep-alive').map(([name, value]) => `${name}: ${value}`);
      return [response.status, headers, await response.text()];
    };
    const unknown = await answerOf('/api/pot/statz');
    assert.deepEqual([unknown[0], unknown[2]], [404, '{"error":"not_found"}']);
    assert.deepEqual(await answerOf(API.potStats), unknown);
    assert.deepEqual(await answerOf(API.potStats, { headers: { Origin: s.url, 'Sec-Fetch-Site': 'same-origin', 'Cache-Control': 'no-cache' } }), unknown);
    assert.deepEqual(await answerOf(API.potStats, { method: 'POST', headers: { Origin: s.url }, body: '{"potCounts":true}' }), unknown);
    assert.deepEqual((await answerOf(`${API.potStats}?POT_COUNTS=on`)).slice(0, 1), [404]);
    assert.deepEqual(bots(), ['GET /bots/pot/address'], 'the bots were not asked');
    assert.deepEqual(
      s.stack.lines.filter((line) => line.route === 'pot_stats'),
      [],
    );
    assert.equal(s.stack.lines.filter((line) => line.route === 'unknown' && line.status === 404).length, 5, 'each of the five wrote the line of an unknown path');

    await ends(
      s,
      reader,
      [
        view('/do/pass-it-on'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view('/do/pass-it-on'),
        doIt('/do/pass-it-on', STEP),
        view('/do/pass-it-on'),
        view('/do'),
        view('/do/pass-it-on'),
        view('/es/do/pass-it-on'),
      ],
      { records: [record], words: [WORDS], addresses: [record.firstAddress, paid.to], txids: [funding, paid.txid] },
    );
  },
);
