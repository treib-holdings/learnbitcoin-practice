// "Hold some", the step of the bitcoin chapter, through the real screens:
// make a practice wallet, ask the faucet for coins, and see a block take
// them in. The step is done by that block. Nothing is typed on its road,
// and nothing on it asks for a second tab.
//
// A reader who comes to this step has no wallet yet, so the first three
// scenarios start from an empty browser and go through the real Create
// screen and the real faucet card. Asking the faucet lets the bot check's
// script into the page, and from then on every move between screens loads
// a page: the step and its strip have to be the same on the far side of
// that load.
//
//   1. from nothing to done, in English, arriving from the chapter
//      ("?from="): the block comes while the step's screen stays open, with
//      no move and no reload, and the done card names the block the wallet
//      read, under its buttons, with the practice explorer beside it
//   2. the same in Spanish, on a phone 375 px wide: the block comes while
//      the reader is still on Receive, and the step is done there
//   3. with the page loaded again after every part: the card of the done
//      step names the block again after each load, its buttons do not move
//      when that piece arrives, and the done step's screen asks the
//      practice network nothing beyond the wallet's first look
//   4. it stays not done with only an unconfirmed coin
//   5. the done card names a block only from the wallet's latest look at
//      its coins, and only for a coin that was paid to the wallet
//   6. the block that comes while the reader waits on Receive, in a window
//      of 375 by 667 px: what the faucet's result says there
//
// No scenario follows the explorer's link: the harness lets no page open a
// tab. Each reads the link's address and its target off the page.
//
// All six are local only: they ask the faucet (the bot check is the
// harness's stand-in), pay the wallet from the stand-in, or make a block.

import assert from 'node:assert/strict';
import { fill, formatDate } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { OTHER_WORDS, scenario, testRecord, TEST_WORDS, type OpenedPage } from './helpers.ts';
import {
  arrivesAt,
  attributeOf,
  botCheckScripts,
  countOf,
  createFrom,
  documentsOf,
  hook,
  loads,
  onNetwork,
  sleep,
  storageKeys,
  toSection,
  untilCounted,
  untilPhase,
} from './journey-helpers.ts';
import {
  PROGRESS_KEY,
  act,
  begin,
  doIt,
  ends,
  hrefOf,
  isMain,
  ledeOf,
  mainSays,
  marked,
  named,
  namesBlock,
  namesNoBlock,
  noteFor,
  noteOf,
  partName,
  partWords,
  partsOf,
  pay,
  pickStep,
  reloadStep,
  removeHere,
  saidDone,
  saidTicked,
  section,
  shareOnScreen,
  stepsCounted,
  stripBack,
  stripOf,
  titleOf,
  untilOnScreen,
  untilParts,
  untilStrip,
  view,
  watchDoneCard,
} from './doit-helpers.ts';

const en = strings.doit.en;
const es = strings.doit.es;

const STEP = 'hold-some';
const CHAPTER = '/journey/what-bitcoin-actually-is';
const CAPITULO = '/es/recorrido/que-es-bitcoin-en-realidad';

/** How long a wallet screen waits between two looks at the chain's height (TIP_MS in app/src/lib/chain-sync.ts), in ms. */
const LOOK_MS = 15_000;

/** An address of somebody else's wallet, to pay. */
const SOMEONE = testRecord(OTHER_WORDS).firstAddress;

/** The step asks nothing: its screen holds no field to type in and no box to tick. */
const asksNothing = async (page: OpenedPage, when: string): Promise<void> =>
  assert.equal(await page.page.$$eval('main input, main textarea, main select', (fields) => fields.length), 0, when);

/** The links of the step's screen that lead to the practice explorer. */
const explorerLinks = (page: OpenedPage, explorerUrl: string): Promise<string[]> =>
  page.page.$$eval(
    'main a',
    (links, to) => links.map((link) => link.getAttribute('href') ?? '').filter((href) => href.startsWith(to)),
    explorerUrl,
  );

scenario(
  'Hold some, from an empty browser to done, arriving from the chapter: a wallet through Create, coins from the faucet, the page load after the bot check, and the block that comes while the step stays open finishes it: the done card names the block the wallet read, under its buttons, and offers the explorer',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const explorer = s.stack.config.explorerUrl;
    const reader = await begin(s, `/do/${STEP}?from=${CHAPTER}`);
    const { page } = reader;

    // -- The step's screen, opened from the chapter's card: part 1 is open, and nothing else can be done yet --
    await page.waitFor('step-parts');
    assert.equal(await page.text('step-title'), en['title_hold-some']);
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later']);
    assert.deepEqual(await partWords(page), [en.partNow, en.partLater, en.partLater]);
    await asksNothing(page, 'part 1');
    // The lede names the step's own chapter, and the first part's guide the keys chapter: each by the number
    // the app's table of chapters gives, with no slot left on screen.
    assert.ok(await mainSays(page, ledeOf(STEP)), ledeOf(STEP));
    assert.equal(await page.text('step-guide'), named(en['guide_hold-some_1']));
    assert.doesNotMatch(await page.page.$eval('main', (main) => main.textContent ?? ''), /[{}]/);
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
    // "Hold some" explains a wallet and the 12 words itself: the part links what they are.
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
    assert.ok(onMade.text.includes(fill(en.stripPart, { n: '2', m: '3' })), onMade.text);
    assert.deepEqual((await noteOf(page))?.steps[STEP]?.parts, { 1: true });
    // A tick that comes on a wallet screen is not read out there.
    assert.deepEqual(page.statusLog(), []);
    await stripBack(page, STEP);
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);
    assert.deepEqual(await partWords(page), [en.proofChecked, en.partNow, en.partLater]);
    assert.equal(await page.text('step-guide'), en['guide_hold-some_2']);
    assert.equal(await hrefOf(page, 'step-action'), '/wallet/receive#faucet');
    await asksNothing(page, 'part 2');

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
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(await page.text('step-guide'), fill(en['guide_hold-some_3'], { seconds: String(s.stack.config.blockSeconds) }));
    assert.equal(await attributeOf(page, 'step-waiting', 'data-lost'), 'no');
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#do-${STEP}`, 'the way back is kept across the page load');
    // The one idle moment on this step's road sends nobody to the practice explorer: the waiting display has
    // no link to it, and neither has anything else on the screen. The glossary's entry for a block is there.
    assert.equal(await countOf(page, 'step-waiting-explorer'), 0);
    assert.deepEqual(await explorerLinks(page, explorer), []);
    assert.deepEqual(
      await page.page.$$eval(`${hook('step-glossary')} a`, (links) => links.map((link) => link.getAttribute('href'))),
      [`${site}/glossary/block`],
    );
    await asksNothing(page, 'part 3, waiting');

    // -- Part 3: a block takes the coins in while this screen stays open. No move, no reload. It is the
    //    step's last part: its tick finishes the step, and that is what is read out. --
    const same = await marked(page);
    page.forgetStatus();
    const height = await s.network.nextBlock();
    await page.waitFor('step-done');
    assert.equal(await same(), true, 'the step stayed open: the same screen in the same document');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.ok(!page.statusLog().includes(saidTicked(STEP, 3)), 'the tick that finishes the step is said once, as the step being done');
    assert.equal((await onNetwork(s, faucetTxid)).status.block_height, height);

    // -- Done: the day, what just happened, and the way back, whose ending now says that the step is done --
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);
    assert.deepEqual(await partWords(page), [en.proofChecked, en.proofChecked, en.proofChecked]);
    const done = await noteOf(page);
    const note = done?.steps[STEP];
    assert.ok(note?.doneAt !== undefined);
    assert.deepEqual(done, { v: 1, following: null, steps: { 'hold-some': { started: true, doneAt: note.doneAt, from: CHAPTER, parts: { 1: true, 2: true, 3: true } } } });
    // The day, in the page's own time zone: the harness runs its pages in UTC (e2e/src/browser.ts), whatever this
    // machine's zone is. Worked out in local time, the expectation is a day behind for the hours between
    // midnight UTC and local midnight.
    assert.equal(await page.text('step-done-on'), `Done on ${formatDate(note.doneAt / 1000, 'en', 'utc')}.`);
    assert.equal(await page.text('step-done-text'), en['done_hold-some']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#done=${STEP}`);
    assert.equal(await page.page.$eval(hook('step-back'), (link) => link.getAttribute('referrerpolicy')), null);
    // Under the card's buttons: the block the wallet read for the faucet's coin, which is the block the
    // practice network gives for it, and the explorer beside the words on who runs it.
    await namesBlock(page, s, faucetTxid, height);
    assert.deepEqual(await explorerLinks(page, explorer), [`${explorer}/tx/${faucetTxid}`], 'the one link to the explorer on the screen');
    // The chapter's last step offers no next one: the reader has not read the next chapter.
    assert.equal(await countOf(page, 'step-next'), 0);
    for (const gone of ['step-restart', 'step-stop', 'step-waiting', 'step-open']) assert.equal(await countOf(page, gone), 0, gone);
    await asksNothing(page, 'done');

    // -- The list says the same --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    assert.equal(await page.page.$eval(`li[data-step="${STEP}"] ${hook('do-state')}`, (state) => state.getAttribute('data-state')), 'done');
    assert.equal(await stripOf(page), null, 'a step that was seen done on its own screen is no longer followed');

    assert.deepEqual(stepsCounted(s), { 'hold-some': 1 });
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
  'Hold some in Spanish on a phone 375 px wide: every screen fits, the strip keeps its short form, the faucet entry is marked as English, the block that comes while the reader is on Receive finishes the step there, counted under the Spanish address of Receive, and the done card reads in Spanish',
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
    assert.deepEqual(await partWords(page), [es.partNow, es.partLater, es.partLater]);
    assert.ok(await mainSays(page, ledeOf(STEP, 'es')), ledeOf(STEP, 'es'));
    assert.equal(await page.text('step-guide'), named(es['guide_hold-some_1'], 'es'));
    assert.doesNotMatch(await page.page.$eval('main', (main) => main.textContent ?? ''), /[{}]/);
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
    // The strip on a phone: the step and "2 de 3", with the part's name left to wider screens.
    const strip = await untilStrip(page, STEP, 'part');
    assert.ok(strip.text.startsWith(`${es['title_hold-some']} 2 de 3`), strip.text);
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
    assert.deepEqual(await partWords(page), [es.proofChecked, es.partNow, es.partLater]);
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

    // -- Part 2 and part 3: the faucet pays, and a block takes the coins in while the reader is still on
    //    Receive. That block's tick is the step's last: the step is done there, and says so there. --
    await act(page, '/es/wallet/receive');
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    await page.click('faucet-ask');
    await untilPhase(page, 'arrived');
    const faucetTxid = ((await attributeOf(page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    assert.equal(await countOf(page, 'faucet-step-done'), 0, 'the coins are here, and the step is not done yet');
    page.forgetStatus();
    const height = await s.network.nextBlock();
    await untilPhase(page, 'confirmed');
    const onReceive = await untilStrip(page, STEP, 'done');
    assert.equal(onReceive.words, fill(es.stripDone, { step: titleOf(STEP, 'es') }));
    assert.equal(await page.waitForStatus(saidDone(STEP, 'es')), saidDone(STEP, 'es'));
    // The faucet's result says it too, where the reader is looking: one line, and under it the way back to the step.
    assert.equal(await page.text('faucet-step-done'), saidDone(STEP, 'es'));
    assert.equal(await page.text('faucet-step'), fill(es.backTo, { step: titleOf(STEP, 'es') }));
    const note = (await noteOf(page))?.steps[STEP];
    assert.ok(note?.doneAt !== undefined);
    assert.deepEqual(note, { started: true, doneAt: note.doneAt, from: CAPITULO, parts: { 1: true, 2: true, 3: true } });
    await untilCounted(s, 'Do it');
    assert.deepEqual(stepsCounted(s), { 'hold-some': 1 });
    await fits('Receive with the strip and the result');

    // -- Back to the step by the result's button, which is a page load after the bot check: the done card, in Spanish --
    await loads(page, () => page.click('faucet-step'));
    await arrivesAt(page, `/es/do/${STEP}`);
    await page.waitFor('step-done');
    assert.equal(await page.text('step-done-on'), `Hecho el ${formatDate(note.doneAt / 1000, 'es', 'utc')}.`);
    assert.equal(await page.text('step-done-text'), es['done_hold-some']);
    assert.equal(await page.text('step-back'), es.back);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CAPITULO}#done=${STEP}`);
    assert.deepEqual(await partWords(page), [es.proofChecked, es.proofChecked, es.proofChecked]);
    await namesBlock(page, s, faucetTxid, height, 'es');
    assert.doesNotMatch(await page.page.$eval('main', (main) => main.textContent ?? ''), /[{}]/);
    await fits('the step, done');
    assert.deepEqual((await noteOf(page))?.steps[STEP], note, 'opening the done step changes nothing of its note');

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
        // Done by the block, on the screen the reader waited on.
        doIt('/es/wallet/receive', STEP),
        view('/es/do/hold-some'),
      ],
      { records: [record], words: [words], addresses: [address], txids: [faucetTxid] },
    );
  },
);

scenario(
  'Hold some with the page loaded again after every part: each tick is still there, the step is still the one followed, a step that is done stays done, and after each load of the done step its card names the block again without moving its buttons and asks the practice network nothing beyond the wallet\'s first look',
  { localOnly: true, timeout: 240_000 },
  async (s) => {
    const reader = await begin(s, `/do/${STEP}`);
    const { page } = reader;
    // From the next page load on: where the done card's link back stands, each time the page's elements change.
    const card = await watchDoneCard(page);
    await page.waitFor('step-parts');
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later']);
    // With no "?from=" the way back is the step's own chapter.
    assert.equal(await hrefOf(page, 'step-back'), `${s.stack.config.siteUrl}${CHAPTER}#do-${STEP}`);

    // -- Loaded again before anything was done: started, followed, nothing ticked --
    await reloadStep(page);
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later']);
    assert.deepEqual((await noteOf(page))?.steps, { 'hold-some': { started: true } });

    // -- Part 1, then a reload on the wallet's own screen: the strip is there again, and so is the tick --
    await act(page, '/new');
    const made = await createFrom(page, 'create-words');
    const { record, words } = made;
    await untilStrip(page, STEP, 'part');
    await page.page.reload({ waitUntil: 'load' });
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    await stripBack(page, STEP);
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);
    await reloadStep(page);
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);

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
    await untilParts(page, ['ticked', 'ticked', 'now']);
    await reloadStep(page);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.deepEqual([await countOf(page, 'step-waiting'), await countOf(page, 'step-waiting-explorer')], [1, 0]);
    assert.deepEqual(stepsCounted(s), {});

    // -- Part 3: the block comes, and the page that is loaded after it finds the coin confirmed. That is the
    //    step's last part, so this load finishes the step. --
    const height = await s.network.nextBlock();
    page.forgetStatus();
    await reloadStep(page);
    await page.waitFor('step-done');
    // Done while this screen was open (the coins are looked up after it opens), so it is read out.
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);
    const done = (await noteOf(page))?.steps[STEP];
    assert.ok(done?.doneAt !== undefined);
    assert.deepEqual(done, { started: true, doneAt: done.doneAt, parts: { 1: true, 2: true, 3: true } });
    await namesBlock(page, s, faucetTxid, height);
    await untilCounted(s, 'Do it');
    assert.deepEqual(stepsCounted(s), { 'hold-some': 1 });

    // -- Then the page loaded again twice: done, and still done. The card is drawn from the note at once, and
    //    the piece that names the block arrives when the wallet has looked at its coins. --
    for (const again of [1, 2]) {
      const asked = s.standIn.requests().length;
      await reloadStep(page);
      await page.waitFor('step-done');
      assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked'], `after reload ${again}`);
      assert.equal(await hrefOf(page, 'step-back'), `${s.stack.config.siteUrl}${CHAPTER}#done=${STEP}`);
      assert.deepEqual((await noteOf(page))?.steps[STEP], done, 'the note is as it was');
      await namesBlock(page, s, faucetTxid, height);
      // The link back stands where it stood before the piece arrived: the piece is the card's last, so
      // nothing a reader is about to press moves under them.
      const seen = await card();
      const before = seen.filter((look) => !look.block);
      const after = seen.filter((look) => look.block);
      assert.ok(before.length > 0, `reload ${again}: the card was on screen before the wallet had looked at its coins`);
      assert.ok(after.length > 0, `reload ${again}: and still on screen with the piece`);
      assert.equal(after[0]?.top, before.at(-1)?.top, `reload ${again}: "Back to the chapter" did not move when the piece arrived`);
      assert.deepEqual([...new Set(after.map((look) => look.top))], [after[0]?.top], `reload ${again}: nor afterwards`);

      // What the page asked of the practice network for it: the wallet's first look, and then nothing. A done
      // step's screen reads nothing by itself, however long it stays open: here for longer than the time
      // between two looks of a wallet screen.
      await page.settle();
      const looked = s.standIn.requests().slice(asked);
      assert.ok(looked.length > 0 && looked.every((request) => request.method === 'GET' && request.path.startsWith('/esplora/')), JSON.stringify(looked));
      if (again === 2) {
        await sleep(LOOK_MS + 2_000);
        assert.deepEqual(s.standIn.requests().slice(asked + looked.length), [], 'nothing was asked after the first look');
        assert.deepEqual((await card()).filter((look) => look.block).map((look) => look.top).at(-1), after[0]?.top);
      }
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
        // The load after the block: the step's screen opens, the wallet looks at its coins, and the step is done.
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
  'Hold some stays not done with only an unconfirmed coin: the part waits for a block on every screen and across a reload, with no link to the explorer, and nothing is counted',
  { localOnly: true },
  async (s) => {
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 50_000, { confirmed: false });
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;

    // A wallet is here and a coin has arrived: two parts tick as the step opens. The third waits for a block.
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(await page.waitForStatus(saidTicked(STEP, 2)), saidTicked(STEP, 2));
    assert.equal(await attributeOf(page, 'step-waiting', 'data-lost'), 'no');
    // The page did not send this coin, so it does not say when it was sent. And while this step waits,
    // nothing on its screen leads to the practice explorer.
    assert.equal(await countOf(page, 'step-waiting-sent'), 0);
    assert.equal(await countOf(page, 'step-waiting-explorer'), 0);
    assert.deepEqual(await explorerLinks(page, s.stack.config.explorerUrl), []);
    for (const absent of ['step-done', 'step-action', 'step-coin-block', 'step-explorer']) assert.equal(await countOf(page, absent), 0, absent);
    await asksNothing(page, 'part 3, waiting');

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
    await untilParts(page, ['ticked', 'ticked', 'now']);
    await sleep(2000);
    await reloadStep(page);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    await sleep(1000);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'now']);
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
  'A done "Hold some" names a block only from the wallet\'s latest look at its coins, and only for a coin that was paid to the wallet: with only change left, with every coin sent on, with the wallet removed and with no wallet on a later day the card keeps its sentences and shows no block and no link to the explorer',
  { localOnly: true, timeout: 240_000 },
  async (s) => {
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 50_000);
    const height = (await onNetwork(s, funding)).status.block_height ?? 0;
    // More blocks since: the chain's height is no longer the coin's block.
    s.standIn.mine(2);
    assert.equal(await s.network.height(), height + 2);
    /** The step was done three days ago. Its note names no wallet, no coin and no block. */
    const doneAt = Date.now() - 3 * 86_400_000;
    const stored = noteFor({ following: null, steps: { 'hold-some': { started: true, doneAt, parts: { 1: true, 2: true, 3: true } } } });
    const reader = await begin(s, `/do/${STEP}`, { record, storage: { [PROGRESS_KEY]: stored } });
    const { page } = reader;

    /** The card's own sentences come from the note alone: the same in every state below. */
    const sentences = async (when: string): Promise<void> => {
      await page.waitFor('step-done');
      assert.equal(await page.text('step-done-on'), `Done on ${formatDate(doneAt / 1000, 'en', 'utc')}.`, when);
      assert.equal(await page.text('step-done-text'), en['done_hold-some'], when);
      assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked'], when);
      assert.equal(await hrefOf(page, 'step-back'), `${s.stack.config.siteUrl}${CHAPTER}#done=${STEP}`, when);
    };
    /** The card as it stands once the wallet's look at its coins has ended: no block, and no link to the explorer. */
    const noBlock = async (when: string): Promise<void> => {
      await sentences(when);
      await page.settle();
      await namesNoBlock(page, s, when);
      await sentences(when);
    };
    /** From a wallet screen to the step, inside the app: by the Overview's line and the list of steps. */
    const toStepInApp = async (): Promise<void> => {
      await section(page, '/wallet');
      await page.click('overview-do-link');
      await arrivesAt(page, '/do');
      await pickStep(page, STEP);
    };

    // -- The wallet holds a coin that was paid to it, in a block: the card names that block, whatever the
    //    chain's height is now. --
    await sentences('a coin that was paid to the wallet');
    await namesBlock(page, s, funding, height);

    // -- Only change left. The wallet pays somebody part of what it holds: its coin is spent, and what it
    //    holds now is the change of its own payment, which waits for its block. In the same page, the card
    //    goes by the wallet's latest look, which was on Send. --
    await page.goto('/wallet/send');
    const first = await pay(page, SOMEONE, '30,000');
    await toStepInApp();
    await noBlock('only change, which waits for its block (in the page that sent the payment)');
    await reloadStep(page);
    await noBlock('only change, which waits for its block (after a page load)');
    // The change has its block, and the wallet holds a confirmed coin again. It is not a coin that was paid
    // to the wallet: the card's sentence is about coins the reader got.
    await s.network.nextBlock();
    assert.equal((await onNetwork(s, first.txid)).status.confirmed, true);
    await reloadStep(page);
    await noBlock('only change, in a block');
    await page.goto('/wallet/coins');
    await page.waitFor('coin');
    assert.equal(await countOf(page, 'coin'), 1, 'the wallet holds one coin: its change');
    await toStepInApp();
    await noBlock('only change, in a block (after the wallet\'s own screens)');

    // -- Every coin sent on: the wallet holds nothing. --
    await page.goto('/wallet/send');
    const second = await pay(page, SOMEONE, 'all');
    await toStepInApp();
    await noBlock('every coin sent on (in the page that sent the payment)');
    await s.network.nextBlock();
    await reloadStep(page);
    await noBlock('every coin sent on (after a page load)');
    assert.deepEqual(await s.network.coins(record.firstAddress), { count: 0, sats: 0 });

    // -- The wallet removed from this browser: in the page that removed it, and in one loaded afterwards,
    //    which is also a browser that has no wallet on a later day. --
    await page.goto('/wallet/settings');
    await removeHere(page);
    await page.click('home-do-link');
    await arrivesAt(page, '/do');
    await pickStep(page, STEP);
    await noBlock('the wallet removed (in the page that removed it)');
    await reloadStep(page);
    await noBlock('no wallet, on a later day');
    assert.deepEqual(await storageKeys(page), [PROGRESS_KEY]);
    // The note is as it was stored: showing a done step writes nothing.
    assert.deepEqual((await noteOf(page))?.steps, { 'hold-some': { started: true, doneAt, parts: { 1: true, 2: true, 3: true } } });
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [
        view('/do/hold-some'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent' },
        view('/wallet'),
        view('/do'),
        view('/do/hold-some'),
        view('/do/hold-some'),
        view('/do/hold-some'),
        view('/wallet/coins'),
        view('/wallet'),
        view('/do'),
        view('/do/hold-some'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent' },
        view('/wallet'),
        view('/do'),
        view('/do/hold-some'),
        view('/do/hold-some'),
        view('/wallet/settings'),
        { name: 'Wallet removed', path: '/wallet/settings', value: 'words' },
        view('/'),
        view('/do'),
        view('/do/hold-some'),
        view('/do/hold-some'),
      ],
      { records: [record], words: [TEST_WORDS.split(' ')], addresses: [record.firstAddress, SOMEONE], txids: [funding, first.txid, second.txid] },
    );
  },
);

scenario(
  'The block that comes while the reader waits on Receive finishes "Hold some" there: the note holds the moment, "Do it" is counted once under Receive, the strip says that the step is done, and the faucet\'s result says so above `Back to "Hold some"`, in the window at 375 by 667 px; the button leads to the done card',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const record = testRecord();
    const reader = await begin(s, `/do/${STEP}`, { record, width: 375, height: 667 });
    const { page } = reader;
    const backTo = fill(en.backTo, { step: titleOf(STEP) });

    // -- A wallet is here, with no coins: the step sends the reader to the faucet. --
    await untilParts(page, ['ticked', 'now', 'later']);
    await act(page, '/wallet/receive');
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    await page.click('faucet-ask');
    await untilPhase(page, 'arrived');
    const faucetTxid = ((await attributeOf(page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    assert.match(faucetTxid, /^[0-9a-f]{64}$/);

    // -- The coins are here: the result holds the way back to the step, in the window, and no word of a
    //    step that is done. The reader stays, and waits for the block where they are. --
    await untilOnScreen(page, 'faucet-step');
    assert.equal(await page.text('faucet-step'), backTo);
    assert.equal(await countOf(page, 'faucet-step-done'), 0);
    await untilStrip(page, STEP, 'waiting');
    assert.deepEqual((await noteOf(page))?.steps[STEP], { started: true, parts: { 1: true, 2: true } });
    assert.deepEqual(stepsCounted(s), {});
    const scrolled = await page.page.evaluate(() => window.scrollY);

    // -- The block comes. Nothing is pressed, and the page is not moved. --
    page.forgetStatus();
    const from = Date.now();
    const height = await s.network.nextBlock();
    await untilPhase(page, 'confirmed');
    await page.waitFor('faucet-step-done');
    const to = Date.now();

    // The note holds the moment the page saw the block, and the step is still the one followed: the reader
    // has not seen its done card yet.
    const note = await noteOf(page);
    const held = note?.steps[STEP];
    assert.ok(held?.doneAt !== undefined && held.doneAt >= from && held.doneAt <= to, JSON.stringify(held));
    assert.deepEqual(note, { v: 1, following: STEP, followedAt: note?.followedAt, steps: { 'hold-some': { started: true, doneAt: held.doneAt, parts: { 1: true, 2: true, 3: true } } } });
    // Counted once, under the screen the reader is on.
    await untilCounted(s, 'Do it');
    assert.deepEqual(
      s.stack.events.map((each) => each.event).filter((event) => event.name === 'Do it'),
      [doIt('/wallet/receive', STEP)],
    );
    // The strip says so, and so does the status region, once.
    const strip = await untilStrip(page, STEP, 'done');
    assert.equal(strip.words, fill(en.stripDone, { step: titleOf(STEP) }));
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.equal(page.statusLog().filter((said) => said === saidDone(STEP)).length, 1);

    // The faucet's result says it where the reader is looking: one line, in semibold, and under it the way
    // back to the step as the main button. Both are in the window, and the page stands where it stood: at
    // this size the strip, which says the same, is above the window.
    assert.equal(await page.text('faucet-step-done'), saidDone(STEP));
    assert.equal(await page.text('faucet-step'), backTo);
    assert.deepEqual(
      await page.page.$eval(hook('faucet-state'), (state) => {
        const line = state.querySelector('[data-testid="faucet-step-done"]');
        const button = state.querySelector('[data-testid="faucet-step"]');
        if (line === null || button === null) return null;
        return {
          lineFirst: (line.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          semibold: Number(getComputedStyle(line).fontWeight) >= 600,
          href: button.getAttribute('href'),
        };
      }),
      { lineFirst: true, semibold: true, href: `/do/${STEP}` },
    );
    assert.equal(await page.page.evaluate(() => window.scrollY), scrolled, 'the block did not move the page');
    assert.deepEqual([await shareOnScreen(page, 'faucet-step-done'), await shareOnScreen(page, 'faucet-step')], [1, 1], 'the line and the button are in the window');
    assert.equal(await isMain(page, 'faucet-step'), true);
    assert.equal(await shareOnScreen(page, 'strip'), 0, 'the strip is above the window here');
    assert.equal(await page.sidewaysScroll(), 0);

    // -- The button leads to the done card: a page load, because the bot check's script has been in the page. --
    await loads(page, () => page.click('faucet-step'));
    await arrivesAt(page, `/do/${STEP}`);
    await page.waitFor('step-done');
    assert.equal(await page.text('step-done-on'), `Done on ${formatDate(held.doneAt / 1000, 'en', 'utc')}.`);
    assert.equal(await page.text('step-done-text'), en['done_hold-some']);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);
    await namesBlock(page, s, faucetTxid, height);
    // Seen on its own screen: the step is let go, and its note is as the block left it.
    const seen = await noteOf(page);
    assert.deepEqual(seen, { v: 1, following: null, steps: { 'hold-some': held } });
    assert.equal(await stripOf(page), null);
    assert.deepEqual(stepsCounted(s), { 'hold-some': 1 });

    await ends(
      s,
      reader,
      [view('/do/hold-some'), view('/wallet/receive'), { name: 'Faucet', path: '/wallet/receive', value: 'ok' }, doIt('/wallet/receive', STEP), view('/do/hold-some')],
      { records: [record], words: [TEST_WORDS.split(' ')], addresses: [address], txids: [faucetTxid] },
    );
  },
);
