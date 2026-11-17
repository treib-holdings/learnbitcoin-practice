// "The waiting room", the last step of the payment chapter, through the
// real screens: send a payment, watch a block take it in, and watch six
// blocks pile up on top of it.
//
// Its first part is an event: a payment sent while the step is followed.
// The same page may have sent a payment a moment before, for another step,
// and that one must not count. Its other two parts are states of the chain,
// and tick by themselves.
//
//   1. from not started to done, in English: both chain parts tick while
//      the step's screen stays open, with no move and no reload
//   2. with the page loaded again after every part and after every block,
//      and with the faucet's page load before the payment: the count of
//      confirmations is read at each height
//   3. it stays not done after "Pass it on" in the same page with no new
//      payment
//   4. a payment to the pot counts for the step that is followed, and not
//      for another one that is only started
//   5. the payment the network no longer knows, and "Send another"
//
// All five are local only: they pay the wallet from the stand-in, make
// blocks on it, or ask the faucet.

import assert from 'node:assert/strict';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { OTHER_WORDS, TEST_WORDS, scenario, testRecord } from './helpers.ts';
import { arrivesAt, attributeOf, botCheckScripts, countOf, documentsOf, onNetwork, untilPhase } from './journey-helpers.ts';
import {
  PROGRESS_KEY,
  act,
  begin,
  doIt,
  ends,
  hrefOf,
  ledeOf,
  listState,
  mainSays,
  marked,
  noteFor,
  noteOf,
  partName,
  partWords,
  partsOf,
  pay,
  pickStep,
  reloadStep,
  saidDone,
  saidTicked,
  section,
  stepsCounted,
  stripBack,
  untilParts,
  untilStrip,
  view,
} from './doit-helpers.ts';

const en = strings.doit.en;

const STEP = 'waiting-room';
const CHAPTER = '/journey/how-bitcoin-works';

const WORDS = TEST_WORDS.split(' ');

/** An address that is neither the wallet's nor the pot's: the first address of the harness's second wallet. */
const SOMEBODY = testRecord(OTHER_WORDS).firstAddress;

scenario(
  'The waiting room, from not started to done: a payment to any address, the block that takes it in and the six on top of it all come while the step stays open, and the count of confirmations moves with them',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;

    await untilParts(page, ['now', 'later', 'later']);
    assert.equal(await page.text('step-title'), en['title_waiting-room']);
    // This step's lede names no chapter. It is drawn the way the other five are, and stands whole.
    assert.equal(ledeOf(STEP), en['lede_waiting-room']);
    assert.ok(await mainSays(page, ledeOf(STEP)), ledeOf(STEP));
    assert.equal(await page.text('step-guide'), en['guide_waiting-room_1']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#do-${STEP}`);

    // -- Part 1: a payment, to anybody. It ticks on Send, and the note keeps which payment and when. --
    await act(page, '/wallet/send');
    const paid = await pay(page, SOMEBODY, '10,000');
    const noted = (await noteOf(page))?.steps[STEP];
    assert.deepEqual([noted?.parts, noted?.tx], [{ 1: true }, paid.txid]);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal(await attributeOf(page, 'step-waiting', 'data-lost'), 'no');
    assert.match(await page.text('step-waiting-sent'), /^Sent (just now|\d+ seconds? ago)\.$/);
    assert.equal(await hrefOf(page, 'step-waiting-explorer'), `${s.stack.config.explorerUrl}/tx/${paid.txid}`);

    // -- Part 2: a block takes it in while the screen stays open. One confirmation: the count begins. --
    const same = await marked(page);
    const height = await s.network.nextBlock();
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(await page.waitForStatus(saidTicked(STEP, 2)), saidTicked(STEP, 2));
    assert.match(await page.text('step-waited'), new RegExp(`^It waited (1 second|\\d+ seconds)\\. Block ${height} took it in\\.$`));
    assert.equal(await attributeOf(page, 'step-confirmations', 'data-count'), '1');
    assert.equal(await page.text('step-confirmations'), fill(en.confirmations, { count: '1', total: '6' }));
    // Six practice blocks take three minutes here, and the part says so.
    assert.equal(await page.text('step-guide'), fill(en['guide_waiting-room_3'], { minutes: '3' }));
    assert.deepEqual(await partWords(page), [en.proofChecked, en.proofChecked, en.partNow]);

    // -- Part 3: five more blocks, and the step is done. Still the same screen in the same document. --
    s.standIn.mine(5);
    await page.waitFor('step-done');
    assert.equal(await same(), true, 'the step stayed open: the same screen in the same document');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);
    assert.equal(await s.network.height(), height + 5);
    assert.equal(await page.text('step-done-text'), en['done_waiting-room']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#done=${STEP}`);
    // The chapter's last step: no next one is offered.
    assert.equal(await countOf(page, 'step-next'), 0);
    const done = (await noteOf(page))?.steps[STEP];
    assert.ok(done?.doneAt !== undefined);
    assert.deepEqual(done, { started: true, doneAt: done.doneAt, parts: { 1: true, 2: true, 3: true } }, 'the payment it waited for is let go');

    await ends(
      s,
      reader,
      [view('/do/waiting-room'), view('/wallet/send'), { name: 'Payment', path: '/wallet/send', value: 'sent' }, view('/do/waiting-room'), doIt('/do/waiting-room', STEP)],
      { records: [record], words: [WORDS], addresses: [record.firstAddress, SOMEBODY], txids: [funding, paid.txid] },
    );
  },
);

scenario(
  'The waiting room with the page loaded again after every part and after every block, and the faucet asked before the payment: the count of confirmations is right at each height, from 1 to 5, and the sixth block finishes the step',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const record = testRecord();
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;

    // -- No coins: nothing to send. The need is the same after a reload. --
    await untilParts(page, ['blocked', 'later', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-coins');
    await reloadStep(page);
    await untilParts(page, ['blocked', 'later', 'later']);

    // -- The faucet, and a block for its coin. The bot check's script is in the page from here on. --
    await page.goto('/wallet/receive#faucet');
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    await page.click('faucet-ask');
    await untilPhase(page, 'arrived');
    const faucetTxid = ((await attributeOf(page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    assert.equal((await untilStrip(page, STEP, 'need')).words, en['stripNeed_not-spendable-yet']);
    await s.network.nextBlock();
    await untilPhase(page, 'confirmed');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 1));

    // -- Part 1: the move to Send loads a page. The payment made on it is the step's. --
    assert.equal(await botCheckScripts(page), 1);
    const documents = documentsOf(page);
    await section(page, '/wallet/send', { load: true });
    assert.equal(documentsOf(page), documents + 1);
    const paid = await pay(page, 'pot', '20,000');
    assert.equal((await noteOf(page))?.steps[STEP]?.tx, paid.txid);
    await page.page.reload({ waitUntil: 'load' });
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'now', 'later']);
    await reloadStep(page);
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal(await hrefOf(page, 'step-waiting-explorer'), `${s.stack.config.explorerUrl}/tx/${paid.txid}`);

    // -- Part 2: the block, and the page loaded after it --
    const height = await s.network.nextBlock();
    await reloadStep(page);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(await page.waitForStatus(saidTicked(STEP, 2)), saidTicked(STEP, 2));
    assert.ok((await page.text('step-waited')).endsWith(`Block ${height} took it in.`), await page.text('step-waited'));
    assert.equal(await attributeOf(page, 'step-confirmations', 'data-count'), '1');

    // -- Part 3: one block at a time, with a page load after each. The block that holds the payment is the first confirmation. --
    for (const count of [2, 3, 4, 5]) {
      await s.network.nextBlock();
      await reloadStep(page);
      await untilParts(page, ['ticked', 'ticked', 'now']);
      await page.page.waitForSelector(`[data-testid="step-confirmations"][data-count="${count}"]`);
      assert.equal(await page.text('step-confirmations'), fill(en.confirmations, { count: String(count), total: '6' }));
      // While the step is not done the note still names the payment, so the line about its wait is kept across the loads.
      assert.ok((await page.text('step-waited')).endsWith(`Block ${height} took it in.`));
    }
    assert.equal(stepsCounted(s)[STEP], undefined, 'five confirmations are not six');
    assert.equal(await countOf(page, 'step-done'), 0);
    await s.network.nextBlock();
    await reloadStep(page);
    await page.waitFor('step-done');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.equal((await onNetwork(s, paid.txid)).status.block_height, (await s.network.height()) - 5);
    await reloadStep(page);
    await page.waitFor('step-done');
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);
    assert.deepEqual(stepsCounted(s), { 'waiting-room': 1 });

    await ends(
      s,
      reader,
      [
        view('/do/waiting-room'),
        view('/do/waiting-room'),
        view('/wallet/receive'),
        { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view('/wallet/send'),
        view('/do/waiting-room'),
        view('/do/waiting-room'),
        view('/do/waiting-room'),
        view('/do/waiting-room'),
        view('/do/waiting-room'),
        view('/do/waiting-room'),
        view('/do/waiting-room'),
        view('/do/waiting-room'),
        doIt('/do/waiting-room', STEP),
        view('/do/waiting-room'),
      ],
      { records: [record], words: [WORDS], addresses: [address, paid.to], txids: [faucetTxid, paid.txid] },
    );
  },
);

scenario(
  'The waiting room stays not done after "Pass it on" in the same page with no new payment: the payment the page sent before the step was followed does not count, not when it confirms either',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const reader = await begin(s, '/do/pass-it-on', { record });
    const { page } = reader;
    const documents = documentsOf(page);

    // -- "Pass it on", as far as its payment: this page has now sent one --
    await untilParts(page, ['ticked', 'now', 'later']);
    await act(page, '/wallet/send');
    const paid = await pay(page, 'pot', '30,000');
    await stripBack(page, 'pass-it-on');
    await untilParts(page, ['ticked', 'ticked', 'now']);

    // -- "The waiting room", opened inside the same page: its first part asks for a payment, and has none --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    await pickStep(page, STEP);
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later']);
    assert.equal(await hrefOf(page, 'step-action'), '/wallet/send');
    assert.equal((await noteOf(page))?.following, STEP);
    assert.deepEqual((await noteOf(page))?.steps[STEP], { started: true });

    // -- The earlier payment confirms while this screen is open. That finishes "Pass it on", wherever the reader is;
    //    it ticks nothing here. --
    await s.network.nextBlock();
    await page.page.waitForFunction((key) => (localStorage.getItem(key) ?? '').includes('"doneAt"'), { timeout: 40_000 }, PROGRESS_KEY);
    assert.equal(documentsOf(page), documents, 'all of it in one page');
    const note = await noteOf(page);
    assert.ok(note?.steps['pass-it-on']?.doneAt !== undefined);
    assert.deepEqual(note?.steps[STEP], { started: true });
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later']);
    assert.equal(await countOf(page, 'step-waiting'), 0);
    // Looking at Send again, and coming back, changes nothing: no payment was made.
    await act(page, '/wallet/send');
    await page.waitFor('send-spendable');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 1));
    await stripBack(page, STEP);
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later']);
    await page.click('step-list');
    await arrivesAt(page, '/do');
    assert.deepEqual([await listState(page, 'pass-it-on'), await listState(page, STEP)], ['done', 'started']);
    assert.ok(!page.statusLog().includes(saidTicked(STEP, 1)), page.statusLog().join(' | '));
    assert.deepEqual(stepsCounted(s), { 'pass-it-on': 1 });

    await ends(
      s,
      reader,
      [
        view('/do/pass-it-on'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view('/do/pass-it-on'),
        view('/do'),
        view('/do/waiting-room'),
        // "Pass it on" was finished by the block, while the reader was on this step's screen.
        doIt('/do/waiting-room', 'pass-it-on'),
        view('/wallet/send'),
        view('/do/waiting-room'),
        view('/do'),
      ],
      { records: [record], words: [WORDS], addresses: [record.firstAddress, paid.to], txids: [funding, paid.txid] },
    );
  },
);

scenario(
  'A payment counts for the step that is followed and for no other: sent to the pot while "The waiting room" is followed, it ticks that step, and "Pass it on", which is started and not followed, still asks for its own',
  { localOnly: true },
  async (s) => {
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const reader = await begin(s, '/do/pass-it-on', { record });
    const { page } = reader;

    // Both steps are opened, one after the other: both are started, and the one opened last is followed.
    await untilParts(page, ['ticked', 'now', 'later']);
    await page.click('step-list');
    await arrivesAt(page, '/do');
    await pickStep(page, STEP);
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later']);
    assert.equal((await noteOf(page))?.following, STEP);

    // A payment to the pot, through "Pass it on" on the Send screen: exactly what the other step asks for.
    await act(page, '/wallet/send');
    const paid = await pay(page, 'pot', '30,000');
    assert.equal(await countOf(page, 'sent-pot'), 1);
    const note = await noteOf(page);
    assert.deepEqual([note?.steps[STEP]?.parts, note?.steps[STEP]?.tx], [{ 1: true }, paid.txid]);
    assert.deepEqual(note?.steps['pass-it-on'], { started: true, parts: { 1: true } }, 'the step that is not followed took nothing from it');

    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'now', 'later']);
    await page.click('step-list');
    await arrivesAt(page, '/do');
    await pickStep(page, 'pass-it-on');
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);
    assert.equal(await hrefOf(page, 'step-action'), '/wallet/send');
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [
        view('/do/pass-it-on'),
        view('/do'),
        view('/do/waiting-room'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view('/do/waiting-room'),
        view('/do'),
        view('/do/pass-it-on'),
      ],
      { records: [record], words: [WORDS], addresses: [record.firstAddress, paid.to], txids: [funding, paid.txid] },
    );
  },
);

scenario(
  'The payment the network no longer knows: two minutes after it was sent the step says so and offers "Send another", which clears it from the note; the next payment sent while the step is followed takes its place, and the step goes on to done',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    // A step under way, as an earlier page left it: its payment was sent three minutes ago, and the
    // practice chain has been started again since. The network has never heard of that payment.
    const sentAt = Date.now() - 180_000;
    const lostTxid = 'c0ffee'.padEnd(64, '5');
    const stored = noteFor({ following: STEP, followedAt: sentAt, steps: { [STEP]: { started: true, tx: lostTxid, sentAt, parts: { 1: true } } } });
    const reader = await begin(s, `/do/${STEP}`, { record, storage: { [PROGRESS_KEY]: stored } });
    const { page } = reader;

    // -- The part does not wait: it says the payment is lost, and offers the one way on --
    await untilParts(page, ['ticked', 'now', 'later']);
    await page.waitFor('step-send-another');
    assert.equal(await attributeOf(page, 'step-waiting', 'data-lost'), 'yes');
    assert.ok((await page.text('step-waiting')).startsWith(en.waitLost), await page.text('step-waiting'));
    assert.equal(await page.text('step-send-another'), en.sendAnother);
    assert.deepEqual([await countOf(page, 'step-waiting-sent'), await countOf(page, 'step-waiting-explorer')], [0, 0]);
    // The strip says the same where the wallet reads its list of transactions.
    await page.goto('/wallet');
    assert.equal((await untilStrip(page, STEP, 'lost')).words, en.stripLost);
    await stripBack(page, STEP);
    await page.waitFor('step-send-another');

    // -- "Send another": the payment is cleared from the note, the tick of having sent one stays --
    await page.click('step-send-another');
    await untilParts(page, ['ticked', 'blocked', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'nothing-sent');
    assert.ok((await page.text('step-need')).startsWith(en['need_nothing-sent']));
    assert.deepEqual((await noteOf(page))?.steps[STEP], { started: true, parts: { 1: true } });
    assert.equal(await page.text('step-need-link'), en.actSend);

    // -- The next payment, sent while the step is followed, is the one it waits for now --
    await act(page, '/wallet/send', { hook: 'step-need-link' });
    const paid = await pay(page, SOMEBODY, '10,000');
    const noted = (await noteOf(page))?.steps[STEP];
    assert.deepEqual([noted?.parts, noted?.tx], [{ 1: true }, paid.txid]);
    assert.ok(noted?.sentAt !== undefined && noted.sentAt > sentAt);
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal(await attributeOf(page, 'step-waiting', 'data-lost'), 'no');
    assert.equal(await hrefOf(page, 'step-waiting-explorer'), `${s.stack.config.explorerUrl}/tx/${paid.txid}`);
    assert.equal(await countOf(page, 'step-send-another'), 0);

    // -- And on to done: its block, and five on top --
    await s.network.nextBlock();
    await reloadStep(page);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    s.standIn.mine(5);
    await reloadStep(page);
    await page.waitFor('step-done');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.deepEqual(stepsCounted(s), { 'waiting-room': 1 });

    await ends(
      s,
      reader,
      [
        view('/do/waiting-room'),
        view('/wallet'),
        view('/do/waiting-room'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent' },
        view('/do/waiting-room'),
        view('/do/waiting-room'),
        view('/do/waiting-room'),
        doIt('/do/waiting-room', STEP),
      ],
      { records: [record], words: [WORDS], addresses: [record.firstAddress, SOMEBODY], txids: [funding, paid.txid, lostTxid] },
    );
  },
);
