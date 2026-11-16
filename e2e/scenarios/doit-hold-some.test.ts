// "Hold some", the step of chapter 2, through the real screens: make a
// practice wallet, ask the faucet for coins, see them confirm, and read the
// coin's block off the practice explorer.
//
// The reader of chapter 2 has no wallet yet, so the first two scenarios
// start from an empty browser and go through the real Create screen and the
// real faucet card. Asking the faucet lets the bot check's script into the
// page, and from then on every move between screens loads a page: the step
// and its strip have to be the same on the far side of that load.
//
//   1. from nothing to done, in English, arriving from the chapter
//      ("?from="): the part that waits for a block ticks while the step's
//      screen stays open, with no move and no reload
//   2. the same in Spanish, on a phone 375 px wide
//   3. with the page loaded again after every part
//   4. it stays not done with only an unconfirmed coin
//   5. it stays not done with a wrong block number
//
// All five are local only: they ask the faucet (the bot check is the
// harness's stand-in), pay the wallet from the stand-in, or make a block.

import assert from 'node:assert/strict';
import { fill, formatDate } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { scenario, testRecord, TEST_WORDS } from './helpers.ts';
import {
  arrivesAt,
  attributeOf,
  botCheckScripts,
  countOf,
  createFrom,
  documentsOf,
  heldBy,
  hook,
  onNetwork,
  sleep,
  storageKeys,
  toSection,
  untilPhase,
} from './journey-helpers.ts';
import {
  PROGRESS_KEY,
  act,
  begin,
  doIt,
  ends,
  hrefOf,
  marked,
  noteOf,
  partName,
  partWords,
  partsOf,
  reloadStep,
  saidDone,
  saidTicked,
  stepsCounted,
  stripBack,
  stripOf,
  titleOf,
  untilParts,
  untilStrip,
  view,
} from './doit-helpers.ts';

const en = strings.doit.en;
const es = strings.doit.es;

const STEP = 'hold-some';
const CHAPTER = '/journey/what-bitcoin-actually-is';
const CAPITULO = '/es/recorrido/que-es-bitcoin-en-realidad';

/** The text of the field's error line: the sentence under a question that was answered wrong. */
const answerError = (page: Parameters<typeof partsOf>[0]): Promise<string> =>
  page.page.$eval(hook('step-open'), (open) => {
    const field = open.querySelector('input');
    const ids = (field?.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '');
    // The error is the described-by line that is marked as an alert, or else the last line described.
    const lines = ids.map((id) => document.getElementById(id)).filter((line): line is HTMLElement => line !== null);
    const error = lines.find((line) => line.getAttribute('role') === 'alert' || line.querySelector('[role="alert"]') !== null) ?? lines.at(-1);
    return (error?.textContent ?? '').replace(/\s+/g, ' ').trim();
  });

scenario(
  'Hold some, from an empty browser to done, arriving from the chapter: a wallet through Create, coins from the faucet, the page load after the bot check, the block that comes while the step stays open, and the block number read off the explorer',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const reader = await begin(s, `/do/${STEP}?from=${CHAPTER}`);
    const { page } = reader;

    // -- The step's screen, opened from the chapter's card: part 1 is open, and nothing else can be done yet --
    await page.waitFor('step-parts');
    assert.equal(await page.text('step-title'), en['title_hold-some']);
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later', 'later']);
    assert.deepEqual(await partWords(page), [en.partNow, en.partLater, en.partLater, en.partLater]);
    assert.equal(await page.text('step-guide'), en['guide_hold-some_1']);
    // The way back is the chapter's page the reader came from, with the card's mark and no stamp. It stays in
    // this tab, and nothing on it asks for a referrer to be sent: the page's own policy sends none.
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#do-${STEP}`);
    assert.deepEqual(
      await page.page.$eval(hook('step-back'), (link) => [link.getAttribute('referrerpolicy'), link.getAttribute('rel'), link.getAttribute('target')]),
      [null, null, null],
    );
    // Opening the step's screen is what starts it: the note is written now, and it is the one being followed.
    const opened = await noteOf(page);
    assert.deepEqual(opened?.steps, { 'hold-some': { started: true, from: CHAPTER } });
    assert.equal(opened?.following, STEP);
    assert.deepEqual(await storageKeys(page), [PROGRESS_KEY]);
    // The step's own screen carries no strip.
    assert.equal(await stripOf(page), null);
    // Chapter 2 has taught no wallet and no 12 words: the part links what they are.
    assert.deepEqual(
      await page.page.$$eval(`${hook('step-glossary')} a`, (links) => links.map((link) => link.getAttribute('href'))),
      [`${site}/glossary/wallet`, `${site}/glossary/seed-phrase`],
    );

    // -- Part 1: make a practice wallet, through the real Create screen. The strip goes along. --
    await act(page, '/new');
    const onCreate = await untilStrip(page, STEP, 'part');
    assert.equal(onCreate.words, partName(STEP, 1));
    const made = await createFrom(page, 'create-words');
    const { record, words } = made;
    // A wallet is here: part 1 is ticked on the spot, on the "Wallet made" step, and the strip names part 2.
    const onMade = await untilStrip(page, STEP, 'part');
    assert.equal(onMade.words, partName(STEP, 2));
    assert.deepEqual((await noteOf(page))?.steps[STEP]?.parts, { 1: true });
    // A tick that comes on a wallet screen is not read out there.
    assert.deepEqual(page.statusLog(), []);
    await stripBack(page, STEP);
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later', 'later']);
    assert.deepEqual(await partWords(page), [en.proofChecked, en.partNow, en.partLater, en.partLater]);
    assert.equal(await page.text('step-guide'), en['guide_hold-some_2']);
    assert.equal(await hrefOf(page, 'step-action'), '/wallet/receive#faucet');

    // -- Part 2: ask the faucet. Its bot check comes into the page, and the coins arrive unconfirmed. --
    const documents = documentsOf(page);
    await act(page, '/wallet/receive');
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    assert.equal(address, record.firstAddress);
    await page.click('faucet-ask');
    await untilPhase(page, 'arrived');
    const faucetTxid = ((await attributeOf(page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    assert.match(faucetTxid, /^[0-9a-f]{64}$/);
    // The coins were seen: part 2 is ticked here, and the strip says what part 3 waits for.
    const onReceive = await untilStrip(page, STEP, 'waiting');
    assert.equal(onReceive.words, en.stripWaitingBlock);
    assert.deepEqual((await noteOf(page))?.steps[STEP]?.parts, { 1: true, 2: true });

    // -- The bot check's script has been in the page: the way back to the step loads a page, and the step
    //    is the same on the far side of it. --
    assert.equal(await botCheckScripts(page), 1);
    await stripBack(page, STEP, { load: true });
    assert.equal(documentsOf(page), documents + 1);
    assert.equal(await botCheckScripts(page), 0);
    await untilParts(page, ['ticked', 'ticked', 'now', 'later']);
    assert.equal(await attributeOf(page, 'step-waiting', 'data-lost'), 'no');
    assert.equal(await hrefOf(page, 'step-waiting-explorer'), `${s.stack.config.explorerUrl}/tx/${faucetTxid}`);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#do-${STEP}`, 'the way back is kept across the page load');

    // -- Part 3: a block takes the coins in while this screen stays open. No move, no reload. --
    const same = await marked(page);
    page.forgetStatus();
    const height = await s.network.nextBlock();
    await untilParts(page, ['ticked', 'ticked', 'ticked', 'now']);
    assert.equal(await same(), true, 'the step stayed open: the same screen in the same document');
    assert.equal(await page.waitForStatus(saidTicked(STEP, 3)), saidTicked(STEP, 3));
    assert.equal((await onNetwork(s, faucetTxid)).status.block_height, height);

    // -- Part 4: the block's number, read off the practice explorer. The page says what was wrong, never the number. --
    assert.equal(await hrefOf(page, 'step-explorer'), `${s.stack.config.explorerUrl}/tx/${faucetTxid}`);
    await page.fill('step-block-answer', '1.5');
    await page.click('step-block-check');
    assert.equal(await answerError(page), en.answerPeriod);
    await page.fill('step-block-answer', String(height + 7));
    await page.click('step-block-check');
    assert.equal(await answerError(page), en.blockWrong);
    assert.equal(await heldBy(page, 'step-block-answer'), String(height + 7), 'a wrong answer stays in the field, to be put right');
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked', 'now']);
    assert.equal(stepsCounted(s)[STEP], undefined);
    await page.fill('step-block-answer', String(height));
    await page.click('step-block-check');

    // -- Done: the day, what just happened, and the way back, whose ending now says that the step is done --
    await page.waitFor('step-done');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked', 'ticked']);
    assert.deepEqual(await partWords(page), [en.proofChecked, en.proofChecked, en.proofChecked, en.proofChecked]);
    const done = await noteOf(page);
    const note = done?.steps[STEP];
    assert.ok(note?.doneAt !== undefined);
    assert.deepEqual(done, { v: 1, following: null, steps: { 'hold-some': { started: true, doneAt: note.doneAt, from: CHAPTER, parts: { 1: true, 2: true, 3: true, 4: true } } } });
    // The day, in the page's own time zone: the harness runs its pages in UTC (e2e/src/browser.ts), whatever this
    // machine's zone is. Worked out in local time, the expectation is a day behind for the hours between
    // midnight UTC and local midnight.
    assert.equal(await page.text('step-done-on'), `Done on ${formatDate(note.doneAt / 1000, 'en', 'utc')}.`);
    assert.equal(await page.text('step-done-text'), en['done_hold-some']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#done=${STEP}`);
    assert.equal(await page.page.$eval(hook('step-back'), (link) => link.getAttribute('referrerpolicy')), null);
    // The chapter's last step offers no next one: the reader has not read the next chapter.
    assert.equal(await countOf(page, 'step-next'), 0);
    for (const gone of ['step-restart', 'step-stop', 'step-block-answer']) assert.equal(await countOf(page, gone), 0, gone);

    // -- The list says the same --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    assert.equal(await page.page.$eval(`li[data-step="${STEP}"] ${hook('do-state')}`, (state) => state.getAttribute('data-state')), 'done');
    assert.equal(await stripOf(page), null, 'a step that was seen done on its own screen is no longer followed');

    await ends(
      s,
      reader,
      [
        view('/do/hold-some'),
        view('/new'),
        { name: 'Wallet created', path: '/new', value: 'words' },
        view('/wallet/backup'),
        { name: 'Words shown', path: '/wallet/backup', value: 'words' },
        view('/do/hold-some'),
        view('/wallet/receive'),
        { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
        view('/do/hold-some'),
        doIt('/do/hold-some', STEP),
        view('/do'),
      ],
      { records: [record], words: [words], addresses: [address], txids: [faucetTxid] },
    );
  },
);

scenario(
  'Hold some in Spanish on a phone 375 px wide: every screen fits, the strip keeps its short form, the faucet entry is marked as English, and the step is done and counted under its Spanish address',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const reader = await begin(s, `/es/do/${STEP}?from=${CAPITULO}`, { lang: 'es', width: 375 });
    const { page } = reader;
    const fits = async (where: string): Promise<void> => assert.equal(await page.sidewaysScroll(), 0, `${where} scrolls sideways`);

    await page.waitFor('step-parts');
    assert.equal(await page.page.evaluate(() => document.documentElement.lang), 'es');
    assert.equal(await page.text('step-title'), es['title_hold-some']);
    assert.equal(await page.page.title(), fill(strings.common.es.markerTitle, { screen: es['title_hold-some'] }));
    assert.deepEqual(await partWords(page), [es.partNow, es.partLater, es.partLater, es.partLater]);
    assert.equal(await page.text('step-guide'), es['guide_hold-some_1']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CAPITULO}#do-${STEP}`);
    assert.deepEqual(
      await page.page.$$eval(`${hook('step-glossary')} a`, (links) => links.map((link) => link.getAttribute('href'))),
      [`${site}/es/glosario/billetera`, `${site}/es/glosario/frase-semilla`],
    );
    await fits('the step');

    // -- Part 1, on the Spanish Create screen --
    await act(page, '/es/new');
    await fits('Create');
    const made = await createFrom(page, 'create-words', '/es');
    const { record, words } = made;
    // The strip on a phone: the step and "2 de 4", with the part's name left to wider screens.
    const strip = await untilStrip(page, STEP, 'part');
    assert.ok(strip.text.startsWith(`${es['title_hold-some']} 2 de 4`), strip.text);
    assert.deepEqual(
      await page.page.$eval(hook('strip'), (line) => {
        const shown = (node: Element | null): boolean => node !== null && getComputedStyle(node).display !== 'none';
        return [shown(line.querySelector('[data-testid="strip-says"]')?.parentElement ?? null), shown(line.querySelector('[data-testid="strip-back"]'))];
      }),
      [false, true],
      'the part\'s name is left out below 480 px, and the way back is there',
    );
    assert.equal(await page.text('strip-back'), es.stripBack);
    // "Stop following" is a cross here, with its words for a screen reader.
    assert.equal(await page.text('strip-stop'), es.stripStop);
    await fits('"Wallet made" with the strip');
    await stripBack(page, STEP, { prefix: '/es' });
    assert.deepEqual(await partWords(page), [es.proofChecked, es.partNow, es.partLater, es.partLater]);
    assert.equal(await page.text('step-guide'), es['guide_hold-some_2']);
    // The faucet has an entry in English only: the Spanish page links that one, and says so.
    assert.deepEqual(
      await page.page.$$eval(`${hook('step-glossary')} a`, (links) => links.map((link) => [link.getAttribute('href'), link.getAttribute('hreflang'), (link.textContent ?? '').includes('(en inglés)')])),
      [
        [`${site}/es/glosario/direccion`, null, false],
        [`${site}/glossary/bitcoin-faucet`, 'en', true],
      ],
    );
    await fits('the step, part 2');

    // -- Part 2 and part 3: the faucet pays, and a block takes the coins in while the reader is still on Receive --
    await act(page, '/es/wallet/receive');
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    await page.click('faucet-ask');
    await untilPhase(page, 'arrived');
    const faucetTxid = ((await attributeOf(page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    const height = await s.network.nextBlock();
    await untilPhase(page, 'confirmed');
    await fits('Receive with the strip');
    await stripBack(page, STEP, { prefix: '/es', load: true });
    await untilParts(page, ['ticked', 'ticked', 'ticked', 'now']);
    assert.equal(await page.text('step-guide'), es['guide_hold-some_4']);
    await fits('the step, part 4');

    // -- Part 4, answered with the comma the explorer may show --
    await page.fill('step-block-answer', String(height + 1));
    await page.click('step-block-check');
    assert.equal(await answerError(page), es.blockWrong);
    await page.fill('step-block-answer', height.toLocaleString('en-US'));
    await page.click('step-block-check');
    await page.waitFor('step-done');
    assert.equal(await page.waitForStatus(saidDone(STEP, 'es')), saidDone(STEP, 'es'));
    const note = (await noteOf(page))?.steps[STEP];
    assert.ok(note?.doneAt !== undefined);
    assert.equal(await page.text('step-done-on'), `Hecho el ${formatDate(note.doneAt / 1000, 'es', 'utc')}.`);
    assert.equal(await page.text('step-done-text'), es['done_hold-some']);
    assert.equal(await page.text('step-back'), es.back);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CAPITULO}#done=${STEP}`);
    assert.deepEqual(await partWords(page), [es.proofChecked, es.proofChecked, es.proofChecked, es.proofChecked]);
    await fits('the step, done');

    await ends(
      s,
      reader,
      [
        view('/es/do/hold-some'),
        view('/es/new'),
        { name: 'Wallet created', path: '/es/new', value: 'words' },
        view('/es/wallet/backup'),
        { name: 'Words shown', path: '/es/wallet/backup', value: 'words' },
        view('/es/do/hold-some'),
        view('/es/wallet/receive'),
        { name: 'Faucet', path: '/es/wallet/receive', value: 'ok' },
        view('/es/do/hold-some'),
        doIt('/es/do/hold-some', STEP),
      ],
      { records: [record], words: [words], addresses: [address], txids: [faucetTxid] },
    );
  },
);

scenario(
  'Hold some with the page loaded again after every part: each tick is still there, the step is still the one followed, and a step that is done stays done',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const reader = await begin(s, `/do/${STEP}`);
    const { page } = reader;
    await page.waitFor('step-parts');
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later', 'later']);
    // With no "?from=" the way back is the step's own chapter.
    assert.equal(await hrefOf(page, 'step-back'), `${s.stack.config.siteUrl}${CHAPTER}#do-${STEP}`);

    // -- Loaded again before anything was done: started, followed, nothing ticked --
    await reloadStep(page);
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later', 'later']);
    assert.deepEqual((await noteOf(page))?.steps, { 'hold-some': { started: true } });

    // -- Part 1, then a reload on the wallet's own screen: the strip is there again, and so is the tick --
    await act(page, '/new');
    const made = await createFrom(page, 'create-words');
    const { record, words } = made;
    await untilStrip(page, STEP, 'part');
    await page.page.reload({ waitUntil: 'load' });
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    await stripBack(page, STEP);
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later', 'later']);
    await reloadStep(page);
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later', 'later']);

    // -- Part 2: the faucet. The page is loaded again on Receive, so the next move is one inside the app again. --
    await act(page, '/wallet/receive');
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    await page.click('faucet-ask');
    await untilPhase(page, 'arrived');
    const faucetTxid = ((await attributeOf(page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    await untilStrip(page, STEP, 'waiting');
    await page.page.reload({ waitUntil: 'load' });
    assert.equal((await untilStrip(page, STEP, 'waiting')).words, en.stripWaitingBlock);
    const documents = documentsOf(page);
    await stripBack(page, STEP);
    assert.equal(documentsOf(page), documents, 'after the reload the bot check is gone, and the way back loads nothing');
    await untilParts(page, ['ticked', 'ticked', 'now', 'later']);
    await reloadStep(page);
    await untilParts(page, ['ticked', 'ticked', 'now', 'later']);
    assert.equal(await countOf(page, 'step-waiting'), 1);

    // -- Part 3: the block comes, and the page that is loaded after it finds the coin confirmed --
    const height = await s.network.nextBlock();
    await reloadStep(page);
    await untilParts(page, ['ticked', 'ticked', 'ticked', 'now']);
    // Ticked while this screen was open (the coins are looked up after it opens), so it is read out.
    assert.equal(await page.waitForStatus(saidTicked(STEP, 3)), saidTicked(STEP, 3));
    await reloadStep(page);
    await untilParts(page, ['ticked', 'ticked', 'ticked', 'now']);
    assert.equal(stepsCounted(s)[STEP], undefined);

    // -- Part 4, and then the page loaded again twice: done, and still done --
    await page.fill('step-block-answer', String(height));
    await page.click('step-block-check');
    await page.waitFor('step-done');
    const done = (await noteOf(page))?.steps[STEP];
    assert.ok(done?.doneAt !== undefined);
    for (const again of [1, 2]) {
      await reloadStep(page);
      await page.waitFor('step-done');
      assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked', 'ticked'], `after reload ${again}`);
      assert.equal(await hrefOf(page, 'step-back'), `${s.stack.config.siteUrl}${CHAPTER}#done=${STEP}`);
      assert.deepEqual((await noteOf(page))?.steps[STEP], done, 'the note is as it was');
    }
    assert.deepEqual(stepsCounted(s), { 'hold-some': 1 }, 'counted once, however often the done step is opened');

    await ends(
      s,
      reader,
      [
        view('/do/hold-some'),
        view('/do/hold-some'),
        view('/new'),
        { name: 'Wallet created', path: '/new', value: 'words' },
        view('/wallet/backup'),
        { name: 'Words shown', path: '/wallet/backup', value: 'words' },
        view('/wallet/backup'),
        view('/do/hold-some'),
        view('/do/hold-some'),
        view('/wallet/receive'),
        { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
        view('/wallet/receive'),
        view('/do/hold-some'),
        view('/do/hold-some'),
        view('/do/hold-some'),
        view('/do/hold-some'),
        doIt('/do/hold-some', STEP),
        view('/do/hold-some'),
        view('/do/hold-some'),
      ],
      { records: [record], words: [words], addresses: [address], txids: [faucetTxid] },
    );
  },
);

scenario(
  'Hold some stays not done with only an unconfirmed coin: the part waits for a block on every screen and across a reload, and nothing is counted',
  { localOnly: true },
  async (s) => {
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 50_000, { confirmed: false });
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;

    // A wallet is here and a coin has arrived: two parts tick as the step opens. The third waits for a block.
    await untilParts(page, ['ticked', 'ticked', 'now', 'later']);
    assert.equal(await page.waitForStatus(saidTicked(STEP, 2)), saidTicked(STEP, 2));
    assert.equal(await attributeOf(page, 'step-waiting', 'data-lost'), 'no');
    assert.equal(await hrefOf(page, 'step-waiting-explorer'), `${s.stack.config.explorerUrl}/tx/${funding}`);
    // The page did not send this coin, so it does not say when it was sent.
    assert.equal(await countOf(page, 'step-waiting-sent'), 0);
    for (const absent of ['step-block-answer', 'step-done', 'step-action']) assert.equal(await countOf(page, absent), 0, absent);

    // Time passes, the wallet's screens are opened, the page is loaded again: no block, no tick.
    await page.click('step-list');
    await arrivesAt(page, '/do');
    assert.equal(await page.page.$eval(`li[data-step="${STEP}"] ${hook('do-state')}`, (state) => state.getAttribute('data-state')), 'started');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 3), 'the list reads no coins, so its strip names the part');
    await page.goto('/wallet/coins');
    await page.waitFor('coin');
    assert.equal((await untilStrip(page, STEP, 'waiting')).words, en.stripWaitingBlock);
    await toSection(page, '/wallet');
    await untilStrip(page, STEP, 'waiting');
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'ticked', 'now', 'later']);
    await sleep(2000);
    await reloadStep(page);
    await untilParts(page, ['ticked', 'ticked', 'now', 'later']);
    await sleep(1000);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'now', 'later']);
    assert.deepEqual((await noteOf(page))?.steps[STEP]?.parts, { 1: true, 2: true });
    assert.equal((await noteOf(page))?.steps[STEP]?.doneAt, undefined);
    assert.ok(!page.statusLog().some((said) => said.includes(titleOf(STEP)) && said.startsWith('Step done')), page.statusLog().join(' | '));
    assert.ok(!page.statusLog().includes(saidTicked(STEP, 3)));
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [view('/do/hold-some'), view('/do'), view('/wallet/coins'), view('/wallet'), view('/do/hold-some'), view('/do/hold-some')],
      { records: [record], words: [TEST_WORDS.split(' ')], addresses: [record.firstAddress], txids: [funding] },
    );
  },
);

scenario(
  'Hold some stays not done with a wrong block number: nothing typed, text, a period, the block before, the block after and the height of the chain are all refused, none of them names the number, and nothing is counted',
  { localOnly: true },
  async (s) => {
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 50_000);
    const height = (await onNetwork(s, funding)).status.block_height ?? 0;
    // Two more blocks: the chain's height is no longer the coin's block.
    s.standIn.mine(2);
    const tip = await s.network.height();
    assert.equal(tip, height + 2);
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;
    await untilParts(page, ['ticked', 'ticked', 'ticked', 'now']);
    assert.equal(await page.waitForStatus(saidTicked(STEP, 3)), saidTicked(STEP, 3));
    assert.equal(await hrefOf(page, 'step-explorer'), `${s.stack.config.explorerUrl}/tx/${funding}`);

    const tries: [typed: string, says: string][] = [
      ['', en.answerEmpty],
      ['block', en.answerInvalid],
      [`${height}.0`, en.answerPeriod],
      [String(height - 1), en.blockWrong],
      [String(height + 1), en.blockWrong],
      [String(tip), en.blockWrong],
      ['0', en.blockWrong],
    ];
    for (const [typed, says] of tries) {
      await page.fill('step-block-answer', typed);
      await page.click('step-block-check');
      await page.page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('aria-invalid') === 'true', {}, hook('step-block-answer'));
      const error = await answerError(page);
      assert.equal(error, says, `typed ${JSON.stringify(typed)}`);
      assert.ok(!error.includes(String(height)), 'no answer says what the number is');
      assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked', 'now'], `typed ${JSON.stringify(typed)}`);
    }
    // Enter in the field checks too, and a wrong answer is as wrong.
    await page.fill('step-block-answer', String(height + 3));
    await page.page.keyboard.press('Enter');
    assert.equal(await answerError(page), en.blockWrong);

    // Still not done after a reload, and the wrong answers were kept nowhere.
    await reloadStep(page);
    await untilParts(page, ['ticked', 'ticked', 'ticked', 'now']);
    assert.equal(await heldBy(page, 'step-block-answer'), '');
    const note = await noteOf(page);
    assert.deepEqual(note?.steps, { 'hold-some': { started: true, parts: { 1: true, 2: true, 3: true } } });
    assert.equal(await countOf(page, 'step-done'), 0);
    assert.ok(!page.statusLog().includes(saidDone(STEP)));
    assert.deepEqual(stepsCounted(s), {});

    await ends(s, reader, [view('/do/hold-some'), view('/do/hold-some')], {
      records: [record],
      words: [TEST_WORDS.split(' ')],
      addresses: [record.firstAddress],
      txids: [funding],
    });
  },
);
