// "There are no balances", the second step of chapter 3, through the real
// screens: open the Coins screen, count the coins, and read what one of the
// wallet's own payments did to them.
//
// The step rests on a payment this wallet has sent: without one no coin
// was used up whole, and there is no change to see. Two of its parts are
// screens the reader opens while the step is followed, so they tick on the
// wallet's own screens, and the last one finishes the step there: it is the
// strip that says "done", on the transaction's screen.
//
//   1. from not started to done, in English: the payment it needs is made
//      on the way, through "Pass it on"
//   2. with the page loaded again after every part, and with the faucet's
//      page load between two parts
//   3. it stays not done with a wrong count, and with the wallet's total in
//      the count's place
//   4. it stays not done after the Coins screen is opened on a wallet that
//      holds no coin
//   5. it stays not done after the screen of a transaction the wallet only
//      received
//
// All five are local only: they pay the wallet from the stand-in, make
// blocks on it, or ask the faucet.

import assert from 'node:assert/strict';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { OTHER_WORDS, TEST_WORDS, fundTestWallet, scenario, testRecord, type OpenedPage } from './helpers.ts';
import {
  arrivesAt,
  attributeOf,
  botCheckScripts,
  countOf,
  documentsOf,
  heldBy,
  hook,
  satsIn,
  toSection,
  untilPhase,
} from './journey-helpers.ts';
import {
  act,
  begin,
  doIt,
  ends,
  hrefOf,
  listState,
  loadStep,
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
  stripOf,
  untilParts,
  untilStrip,
  view,
} from './doit-helpers.ts';

const en = strings.doit.en;

const STEP = 'no-balances';
const CHAPTER = '/journey/how-bitcoin-works';

const WORDS = TEST_WORDS.split(' ');

/** An address that is neither the wallet's nor the pot's: the first address of the harness's second wallet. */
const SOMEBODY = testRecord(OTHER_WORDS).firstAddress;

/** The sentence under the count's field after an answer that did not tick the part. */
const answerError = (page: OpenedPage): Promise<string> =>
  page.page.$eval(hook('step-open'), (open) => {
    const field = open.querySelector('input');
    const ids = (field?.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '');
    const lines = ids.map((id) => document.getElementById(id)).filter((line): line is HTMLElement => line !== null);
    const error = lines.find((line) => line.getAttribute('role') === 'alert' || line.querySelector('[role="alert"]') !== null) ?? lines.at(-1);
    return (error?.textContent ?? '').replace(/\s+/g, ' ').trim();
  });

/** Types an answer to the count and presses Check; waits until the field is marked as wrong. */
async function answerWrong(page: OpenedPage, typed: string): Promise<string> {
  await page.fill('step-coins-answer', typed);
  await page.click('step-coins-check');
  await page.page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('aria-invalid') === 'true', {}, hook('step-coins-answer'));
  return answerError(page);
}

/** On the Coins screen: how many rows it shows, and what they add up to. */
async function coinsShown(page: OpenedPage): Promise<{ rows: number; total: number }> {
  await page.waitFor('coin');
  return { rows: (await page.texts('coin')).length, total: satsIn(await page.text('total')) };
}

scenario(
  'There are no balances, from not started to done: it needs a payment this wallet has sent and leads to "Pass it on" for one; the Coins screen and the payment\'s screen tick their parts where they are opened, the count is asked on the step, and the strip says "done" on the transaction\'s screen',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const record = testRecord();
    const funded = fundTestWallet(s.standIn);
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;

    // -- The wallet has never sent a payment: the step says so, and names the step that makes one --
    await untilParts(page, ['blocked', 'later', 'later']);
    assert.equal(await page.text('step-title'), en['title_no-balances']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'nothing-sent');
    assert.ok((await page.text('step-need')).startsWith(en.needSentOnce));
    assert.equal(await page.text('step-need-link'), fill(en.actStep, { step: en['title_pass-it-on'] }));
    assert.equal(await hrefOf(page, 'step-need-link'), '/do/pass-it-on');
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#do-${STEP}`);

    // -- "Pass it on", as far as its payment --
    await act(page, '/do/pass-it-on', { hook: 'step-need-link' });
    await untilParts(page, ['ticked', 'now', 'later']);
    await act(page, '/wallet/send');
    const paid = await pay(page, 'pot', '30,000');
    await stripBack(page, 'pass-it-on');
    await untilParts(page, ['ticked', 'ticked', 'now']);

    // -- Back to this step by the list. Both are started; the one whose screen is opened is the one followed. --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    assert.deepEqual([await listState(page, 'pass-it-on'), await listState(page, STEP)], ['started', 'started']);
    assert.deepEqual(await page.page.$$eval(hook('do-following'), (marks) => marks.map((mark) => mark.closest('li')?.getAttribute('data-step'))), ['pass-it-on']);
    await pickStep(page, STEP);
    assert.equal((await noteOf(page))?.following, STEP);
    await untilParts(page, ['now', 'later', 'later']);
    assert.equal(await page.text('step-guide'), en['guide_no-balances_1']);

    // -- Part 1: the Coins screen, opened while the step is followed. It ticks there. --
    await act(page, '/wallet/coins');
    const { rows, total } = await coinsShown(page);
    assert.ok(rows >= 2, `the wallet holds several coins: ${rows}`);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    assert.deepEqual((await noteOf(page))?.steps[STEP]?.parts, { 1: true });
    await stripBack(page, STEP);
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);
    assert.deepEqual(await partWords(page), [en.proofOpened, en.partNow, en.partLater]);

    // -- Part 2: how many coins. The total is not the answer, and gets a sentence of its own. --
    assert.equal(await answerWrong(page, String(total)), en.coinsTotal);
    assert.equal(await answerWrong(page, String(rows + 1)), en.coinsWrong);
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);
    await page.fill('step-coins-answer', String(rows));
    await page.click('step-coins-check');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(await page.waitForStatus(saidTicked(STEP, 2)), saidTicked(STEP, 2));
    assert.deepEqual(await partWords(page), [en.proofOpened, en.proofChecked, en.partNow]);

    // -- Part 3: the wallet's latest payment of its own. Opening its screen finishes the step there. --
    assert.equal(await page.text('step-action'), en.actPayment);
    assert.equal(await hrefOf(page, 'step-action'), `/wallet/tx/${paid.txid}`);
    page.forgetStatus();
    await act(page, `/wallet/tx/${paid.txid}`);
    await page.waitFor('tx-explained');
    const strip = await untilStrip(page, STEP, 'done');
    assert.equal(strip.words, fill(en.stripDone, { step: en['title_no-balances'] }));
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    // The strip of a done step: the way back to the chapter, whose ending now says that the step is done, and "Close".
    assert.equal(await hrefOf(page, 'strip-chapter'), `${site}${CHAPTER}#done=${STEP}`);
    assert.equal(await page.text('strip-stop'), en.stripClose);
    assert.equal(await hrefOf(page, 'strip-back'), `/do/${STEP}`);
    assert.deepEqual(stepsCounted(s), { 'no-balances': 1 });
    // What the reader came to read is there: the payment, in sentences.
    assert.deepEqual(
      await page.page.$$eval(`${hook('tx-explained')} p`, (lines) => lines.map((line) => line.getAttribute('data-sentence')).slice(0, 3)),
      ['explain_spentOne', 'explain_paid', 'explain_change'],
    );

    // -- The step's own screen says the same, and the step is let go --
    await stripBack(page, STEP);
    await page.waitFor('step-done');
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);
    assert.deepEqual(await partWords(page), [en.proofOpened, en.proofChecked, en.proofOpened]);
    assert.equal(await page.text('step-done-text'), en['done_no-balances']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#done=${STEP}`);
    assert.equal(await hrefOf(page, 'step-next'), '/do/waiting-room');
    assert.equal((await noteOf(page))?.following, null);
    assert.equal((await noteOf(page))?.steps['pass-it-on']?.doneAt, undefined, '"Pass it on" still waits for its block');

    await ends(
      s,
      reader,
      [
        view('/do/no-balances'),
        view('/do/pass-it-on'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view('/do/pass-it-on'),
        view('/do'),
        view('/do/no-balances'),
        view('/wallet/coins'),
        view('/do/no-balances'),
        view('/wallet/tx'),
        doIt('/wallet/tx', STEP),
        view('/do/no-balances'),
      ],
      { records: [record], words: [WORDS], addresses: [...funded.map((coin) => coin.address), paid.to], txids: [...funded.map((coin) => coin.txid), paid.txid] },
    );
  },
);

scenario(
  'There are no balances with the page loaded again after every part, and the faucet asked between two parts: the Coins screen ticks its part on a page that was loaded straight onto it, and the done strip is still there after a reload',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    // The payment the step needs, made before the step is opened.
    const reader = await begin(s, '/wallet/send', { record });
    const { page } = reader;
    const paid = await pay(page, SOMEBODY, '20,000');
    await s.network.nextBlock();

    await loadStep(page, STEP);
    await untilParts(page, ['now', 'later', 'later']);
    await reloadStep(page);
    await untilParts(page, ['now', 'later', 'later']);

    // -- The faucet, between opening the step and its first part. Its bot check comes into the page. --
    await page.goto('/wallet/receive#faucet');
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    await page.click('faucet-ask');
    await untilPhase(page, 'arrived');
    const faucetTxid = ((await attributeOf(page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 1));
    assert.equal(await botCheckScripts(page), 1);

    // -- Part 1: the move to Coins loads a page. The coins become known on it, and the part ticks there. --
    const documents = documentsOf(page);
    await section(page, '/wallet/coins', { load: true });
    assert.equal(documentsOf(page), documents + 1);
    const { rows } = await coinsShown(page);
    assert.equal(rows, 2, 'the change of the payment, and the faucet\'s coin');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    await page.page.reload({ waitUntil: 'load' });
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'now', 'later']);
    await reloadStep(page);
    await untilParts(page, ['ticked', 'now', 'later']);

    // -- Part 2, and a reload: what was typed is gone, the tick is not --
    await page.fill('step-coins-answer', String(rows));
    await page.click('step-coins-check');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    await reloadStep(page);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(stepsCounted(s)[STEP], undefined);

    // -- Part 3 finishes the step on the payment's screen. After a reload there, the strip still says so. --
    assert.equal(await hrefOf(page, 'step-action'), `/wallet/tx/${paid.txid}`);
    await act(page, `/wallet/tx/${paid.txid}`);
    await untilStrip(page, STEP, 'done');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    await page.page.reload({ waitUntil: 'load' });
    await page.waitFor('tx-explained');
    assert.equal((await untilStrip(page, STEP, 'done')).words, fill(en.stripDone, { step: en['title_no-balances'] }));
    assert.equal(await hrefOf(page, 'strip-chapter'), `${s.stack.config.siteUrl}${CHAPTER}#done=${STEP}`);
    await stripBack(page, STEP);
    await page.waitFor('step-done');
    for (const again of [1, 2]) {
      await reloadStep(page);
      await page.waitFor('step-done');
      assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked'], `after reload ${again}`);
    }
    assert.equal(await stripOf(page), null);
    assert.deepEqual(stepsCounted(s), { 'no-balances': 1 });

    await ends(
      s,
      reader,
      [
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent' },
        view('/do/no-balances'),
        view('/do/no-balances'),
        view('/wallet/receive'),
        { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
        view('/wallet/coins'),
        view('/wallet/coins'),
        view('/do/no-balances'),
        view('/do/no-balances'),
        view('/do/no-balances'),
        view('/wallet/tx'),
        doIt('/wallet/tx', STEP),
        view('/wallet/tx'),
        view('/do/no-balances'),
        view('/do/no-balances'),
        view('/do/no-balances'),
      ],
      { records: [record], words: [WORDS], addresses: [record.firstAddress, address, SOMEBODY], txids: [funding, paid.txid, faucetTxid] },
    );
  },
);

scenario(
  'There are no balances stays not done with a wrong count: nothing typed, a period, one too many, one too few and the wallet\'s total in sats are all refused, no sentence names the number, and nothing is counted',
  { localOnly: true },
  async (s) => {
    const record = testRecord();
    const funded = fundTestWallet(s.standIn);
    const reader = await begin(s, '/wallet/send', { record });
    const { page } = reader;
    const paid = await pay(page, SOMEBODY, '20,000');

    await loadStep(page, STEP);
    await untilParts(page, ['now', 'later', 'later']);
    await act(page, '/wallet/coins');
    const { rows, total } = await coinsShown(page);
    await untilStrip(page, STEP, 'part');
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'now', 'later']);

    const tries: [typed: string, says: string][] = [
      ['', en.answerEmpty],
      [`${rows}.0`, en.answerPeriod],
      ['three', en.answerInvalid],
      [String(rows + 1), en.coinsWrong],
      [String(rows - 1), en.coinsWrong],
      ['0', en.coinsWrong],
      [String(total), en.coinsTotal],
      [total.toLocaleString('en-US'), en.coinsTotal],
    ];
    for (const [typed, says] of tries) {
      const error = await answerWrong(page, typed);
      assert.equal(error, says, `typed ${JSON.stringify(typed)}`);
      assert.ok(!new RegExp(`\\b${rows}\\b`).test(error), 'no answer says how many there are');
      assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later'], `typed ${JSON.stringify(typed)}`);
    }
    assert.equal(await heldBy(page, 'step-coins-answer'), total.toLocaleString('en-US'), 'a wrong answer stays in the field, to be put right');

    await reloadStep(page);
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal(await heldBy(page, 'step-coins-answer'), '');
    assert.deepEqual((await noteOf(page))?.steps, { 'no-balances': { started: true, parts: { 1: true } } });
    assert.ok(!page.statusLog().includes(saidTicked(STEP, 2)), page.statusLog().join(' | '));
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [view('/wallet/send'), { name: 'Payment', path: '/wallet/send', value: 'sent' }, view('/do/no-balances'), view('/wallet/coins'), view('/do/no-balances'), view('/do/no-balances')],
      { records: [record], words: [WORDS], addresses: [...funded.map((coin) => coin.address), SOMEBODY], txids: [...funded.map((coin) => coin.txid), paid.txid] },
    );
  },
);

scenario(
  'There are no balances stays not done after the Coins screen is opened on a wallet that holds no coin: the step says what is missing, the empty screen ticks nothing, by a move inside the app or by a page load',
  { localOnly: true },
  async (s) => {
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 50_000);
    const reader = await begin(s, '/wallet/send', { record });
    const { page } = reader;
    // Everything goes out: the wallet has sent a payment, and holds nothing.
    const paid = await pay(page, SOMEBODY, 'all');
    await s.network.nextBlock();

    await loadStep(page, STEP);
    await untilParts(page, ['blocked', 'later', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-coins');
    assert.ok((await page.text('step-need')).startsWith(en['need_no-coins']));
    assert.equal(await hrefOf(page, 'step-need-link'), '/do/hold-some');
    assert.equal(await countOf(page, 'step-action'), 0);

    // The Coins screen, by a page load: it has no row. (The wallet reads no list of transactions for this
    // screen, so the strip cannot tell yet what the step lacks, and names the part.)
    await page.goto('/wallet/coins');
    await page.waitFor('coins-empty');
    assert.equal(await countOf(page, 'coin'), 0);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 1));
    // And by moves inside the app: to the Overview, which reads the list, and back. Now the strip says what is missing.
    await toSection(page, '/wallet');
    await page.waitFor('no-coins');
    assert.equal((await untilStrip(page, STEP, 'need')).words, en['stripNeed_no-coins']);
    await toSection(page, '/wallet/coins');
    await page.waitFor('coins-empty');
    assert.equal((await untilStrip(page, STEP, 'need')).words, en['stripNeed_no-coins']);

    await stripBack(page, STEP);
    await untilParts(page, ['blocked', 'later', 'later']);
    assert.deepEqual((await noteOf(page))?.steps, { 'no-balances': { started: true } });
    assert.equal(await countOf(page, 'step-coins-answer'), 0);
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent' },
        view('/do/no-balances'),
        view('/wallet/coins'),
        view('/wallet'),
        view('/wallet/coins'),
        view('/do/no-balances'),
      ],
      { records: [record], words: [WORDS], addresses: [record.firstAddress, SOMEBODY], txids: [funding, paid.txid] },
    );
  },
);

scenario(
  'There are no balances stays not done after the screen of a transaction the wallet only received: its part is for a payment this wallet sent, and the strip goes on asking for one',
  { localOnly: true },
  async (s) => {
    const record = testRecord();
    const funded = fundTestWallet(s.standIn);
    const received = funded[0]!.txid;
    const reader = await begin(s, '/wallet/send', { record });
    const { page } = reader;
    const paid = await pay(page, SOMEBODY, '20,000');

    // Parts 1 and 2, as they should be done.
    await loadStep(page, STEP);
    await untilParts(page, ['now', 'later', 'later']);
    await act(page, '/wallet/coins');
    const { rows } = await coinsShown(page);
    await untilStrip(page, STEP, 'part');
    await stripBack(page, STEP);
    await page.fill('step-coins-answer', String(rows));
    await page.click('step-coins-check');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(await hrefOf(page, 'step-action'), `/wallet/tx/${paid.txid}`);

    // Part 3 asks for a payment this wallet sent. The reader opens, from the Activity list, a transaction that paid the wallet.
    await page.goto('/wallet/activity');
    await page.waitFor('tx-row');
    await loadsNothing(page, async () => {
      await page.page.locator(`${hook('tx-row')}[href="/wallet/tx/${received}"]`).click();
      await arrivesAt(page, `/wallet/tx/${received}`);
    });
    await page.waitFor('tx-explained');
    // "What just happened" there says whose coin was spent: not this wallet's.
    assert.equal(await page.page.$eval(`${hook('tx-explained')} p`, (line) => line.getAttribute('data-sentence')), 'explain_theirsOne');
    // Read, and not a payment of this wallet's: the step is where it was.
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 3));
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.deepEqual((await noteOf(page))?.steps, { 'no-balances': { started: true, parts: { 1: true, 2: true } } });
    assert.equal(await countOf(page, 'step-done'), 0);
    assert.ok(!page.statusLog().includes(saidDone(STEP)), page.statusLog().join(' | '));
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent' },
        view('/do/no-balances'),
        view('/wallet/coins'),
        view('/do/no-balances'),
        view('/wallet/activity'),
        view('/wallet/tx'),
        view('/do/no-balances'),
      ],
      { records: [record], words: [WORDS], addresses: [...funded.map((coin) => coin.address), SOMEBODY], txids: [...funded.map((coin) => coin.txid), paid.txid] },
    );
  },
);

/** Runs a move that must stay inside the app: no page may be loaded for it. */
async function loadsNothing(page: OpenedPage, move: () => Promise<void>): Promise<void> {
  const before = documentsOf(page);
  await move();
  assert.equal(documentsOf(page), before, 'the move loaded a page');
}
