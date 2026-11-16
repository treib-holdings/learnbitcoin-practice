// "The seed", the first step of chapter 4, through the real screens: show
// the wallet's 12 words, write them on paper, and check three of them.
//
// Its three parts are three kinds of proof. The first is something the
// page sees happen (the words were put on screen while the step was
// followed), the second is the reader's own word, and the third is a
// question: three words, asked for by their place, and compared inside the
// wallet. The step's screen never holds the 12 words, never says which word
// was expected, and keeps nothing of what was typed.
//
//   1. from not started to done, in English, with a wallet kept with its
//      words: a wrong word is said by its place, and what was typed is gone
//      after every check
//   2. straight after Create it stays not done: the words that "Wallet made"
//      showed before the step was opened do not count. Then, with that
//      passkey wallet, on to done: the faucet's page load between two parts,
//      and the unlock step before the three words
//   3. with the page loaded again after every part
//   4. it stays not done with a wrong word, whatever is typed
//   5. in Spanish, on a phone 375 px wide
//
// Scenario 2 is local only: it asks the faucet, and the bot check is the
// harness's stand-in. The other four touch nothing of the stand-in (a
// wallet with no coins is enough for this step) and could run against a
// real practice network as they are.

import assert from 'node:assert/strict';
import { fill, formatDate } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { freshRecord, scenario, type OpenedPage } from './helpers.ts';
import {
  arrivesAt,
  assertNoWordsRemembered,
  attributeOf,
  botCheckScripts,
  countOf,
  createFrom,
  documentsOf,
  hook,
  pressAndRemember,
  sleep,
  storageKeys,
  untilPhase,
  usesOf,
  watchPrompts,
  wordsOnScreen,
} from './journey-helpers.ts';
import {
  WORD_FIELD_RULES,
  act,
  begin,
  doIt,
  ends,
  focusedPlace,
  hrefOf,
  noteOf,
  noteText,
  partName,
  partWords,
  partsOf,
  pickStep,
  placesAsked,
  reloadStep,
  saidDone,
  saidTicked,
  section,
  stepsCounted,
  strangerTo,
  stripBack,
  stripOf,
  typeFields,
  typeThree,
  untilParts,
  untilStrip,
  view,
  wordFieldRules,
  wordFields,
  wrongLines,
} from './doit-helpers.ts';

const en = strings.doit.en;
const es = strings.doit.es;
const common = strings.common.en;

const STEP = 'the-seed';
const CHAPTER = '/journey/be-your-own-bank';
const CAPITULO = '/es/recorrido/se-tu-propio-banco';

/** The page's own text and markup at this moment: what anyone looking at the screen can read. */
const shownBy = (page: OpenedPage): Promise<string> =>
  page.page.evaluate(() => `${document.documentElement.textContent ?? ''}\n${document.documentElement.outerHTML}`);

/** The words of a wallet made without a passkey, as its record keeps them. */
function wordsOf(record: { mnemonic?: string }): string[] {
  assert.ok(record.mnemonic !== undefined);
  return record.mnemonic.split(' ');
}

/** What is typed for each of the three places asked for, when each field gets the right word. */
const rightFor = (places: readonly number[], words: readonly string[]): string[] => places.map((place) => words[place - 1] ?? '');

/**
 * One check that must fail: types `typed` into the three fields, presses
 * "Check the three words", and holds the screen to its rules. The wrong
 * places are named, and no word is; the fields are empty again; the same
 * three places are asked for; the keyboard is on the first field that was
 * wrong. Gives what the page's patterns remembered at the moment the check
 * had run.
 */
async function failsWith(page: OpenedPage, typed: readonly string[], words: readonly string[], lang: 'en' | 'es' = 'en'): Promise<void> {
  const t = strings.doit[lang];
  const places = await placesAsked(page);
  const wrong = places.filter((place, at) => typed[at] !== words[place - 1]);
  assert.ok(wrong.length > 0, 'the scenario types at least one wrong word');
  await typeFields(page, typed);
  assert.deepEqual(await wordFields(page), typed);
  // The press and the look at the patterns' memory are one run of the page's script: nothing can come between.
  const memory = await pressAndRemember(page, 'step-words-check');
  await page.waitFor('step-words-wrong');
  assertNoWordsRemembered(memory, [...words, ...typed.filter((word) => word !== '')], await shownBy(page), 'after a check that failed');
  assert.deepEqual(await wrongLines(page), [...wrong.map((place) => fill(t.wordsWrong, { n: String(place) })), t.wordsWrongWay]);
  assert.deepEqual(await wordFields(page), ['', '', ''], 'the fields are emptied after the check');
  assert.deepEqual(await placesAsked(page), places, 'the same three places are asked for again');
  assert.equal(await focusedPlace(page), wrong[0], 'the keyboard is on the first field that was wrong');
  assert.deepEqual(
    await page.page.$$eval(hook('step-word'), (fields) => fields.map((field) => field.getAttribute('aria-invalid') === 'true')),
    places.map((place) => wrong.includes(place)),
  );
}

scenario(
  'The seed, from not started to done: the words are shown on Backup while the step is followed, the reader says they are on paper, and three of them are checked; a wrong word is named by its place only, and nothing typed outlives its check',
  { timeout: 150_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const record = freshRecord();
    const words = wordsOf(record);
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;

    // -- The step's screen: three parts, the first one open --
    await untilParts(page, ['now', 'later', 'later']);
    assert.equal(await page.text('step-title'), en['title_the-seed']);
    assert.deepEqual(await partWords(page), [en.partNow, en.partLater, en.partLater]);
    assert.equal(await page.text('step-guide'), en['guide_the-seed_1']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#do-${STEP}`);
    assert.equal(await hrefOf(page, 'step-action'), '/wallet/backup');
    for (const later of ['step-said', 'step-word', 'step-words-check']) assert.equal(await countOf(page, later), 0, later);

    // -- Part 1: the 12 words, put on screen on Backup. The page sees that they were shown, and it ticks there. --
    await act(page, '/wallet/backup');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 1));
    await page.click('reveal-words');
    assert.deepEqual(await wordsOnScreen(page), words);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    assert.deepEqual((await noteOf(page))?.steps[STEP], { started: true, parts: { 1: true } });
    assert.ok(!page.statusLog().includes(saidTicked(STEP, 1)), 'a tick that comes on a wallet screen is not read out there');
    await stripBack(page, STEP);
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);
    // What kind of proof it is: the page saw the words shown, and cannot see whether anything was read.
    assert.deepEqual(await partWords(page), [en.proofOpened, en.partNow, en.partLater]);

    // -- Part 2: the reader's word, for what no page can check --
    assert.equal(await page.text('step-guide'), en['guide_the-seed_2']);
    assert.equal(await countOf(page, 'step-word'), 0);
    await page.click('step-said');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(await page.waitForStatus(saidTicked(STEP, 2)), saidTicked(STEP, 2));
    assert.deepEqual(await partWords(page), [en.proofOpened, en.proofSaid, en.partNow]);

    // -- Part 3: three words, by their place. Above them, why this page may ask at all, and that nothing else may. --
    assert.equal(await page.text('step-guide'), en['guide_the-seed_3']);
    const rules = await page.text('step-words-exception');
    assert.ok(rules.includes(strings.restore.en.exception) && rules.includes(en.wordsOnce), rules);
    assert.deepEqual(await wordFieldRules(page), [WORD_FIELD_RULES, WORD_FIELD_RULES, WORD_FIELD_RULES]);
    const places = await placesAsked(page);
    assert.equal(new Set(places).size, 3);
    assert.deepEqual(
      await page.page.$$eval(`${hook('step-open')} label`, (labels) => labels.map((label) => (label.textContent ?? '').trim())),
      places.map((place) => fill(strings.wallet.en.wordsNumber, { n: String(place) })),
    );

    // A wrong word in the middle field: a real word, and not this wallet's word for that place.
    const typed = rightFor(places, words);
    typed[1] = strangerTo(words);
    await failsWith(page, typed, words);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'now']);
    assert.deepEqual((await noteOf(page))?.steps[STEP], { started: true, parts: { 1: true, 2: true } });
    assert.equal(stepsCounted(s)[STEP], undefined);

    // The three right words.
    assert.deepEqual(await typeThree(page, words), places);
    const memory = await pressAndRemember(page, 'step-words-check');
    await page.waitFor('step-done');
    assertNoWordsRemembered(memory, words, await shownBy(page), 'after the check that passed');

    // -- Done: the wallet the words were checked for, by its wallet fingerprint, and the next step of the chapter --
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);
    assert.deepEqual(await partWords(page), [en.proofOpened, en.proofSaid, en.proofChecked]);
    assert.equal(await countOf(page, 'step-word'), 0, 'the fields are gone with the question');
    const note = await noteOf(page);
    const done = note?.steps[STEP];
    assert.ok(done?.doneAt !== undefined);
    // What the note keeps of the check: the wallet fingerprint it was passed for. No place, no word, no answer.
    assert.deepEqual(note, { v: 1, following: null, steps: { 'the-seed': { started: true, doneAt: done.doneAt, wallet: record.fingerprint, parts: { 1: true, 2: true, 3: true } } } });
    assert.equal(await page.text('step-done-on'), `Done on ${formatDate(done.doneAt / 1000, 'en', 'utc')}.`);
    assert.equal(await page.text('step-done-text'), en['done_the-seed']);
    assert.equal(await page.text('step-seed-wallet'), fill(en.seedChecked, { fingerprint: record.fingerprint }));
    assert.equal(await countOf(page, 'step-seed-other'), 0);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#done=${STEP}`);
    assert.equal(await page.text('step-next'), fill(en.next, { step: en['title_prove-the-backup'] }));
    assert.equal(await hrefOf(page, 'step-next'), '/do/prove-the-backup');
    assert.equal(await stripOf(page), null);

    await ends(
      s,
      reader,
      [view('/do/the-seed'), view('/wallet/backup'), { name: 'Words shown', path: '/wallet/backup', value: 'words' }, view('/do/the-seed'), doIt('/do/the-seed', STEP)],
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [] },
    );
  },
);

scenario(
  'The seed straight after Create stays not done: the words "Wallet made" showed before the step was opened do not count. Then, with that passkey wallet, on to done: the words shown again on Backup, the faucet\'s page load between two parts, and one unlock before the three words',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const reader = await begin(s, '/new', { passkey: 'prf' });
    const { page } = reader;
    const prompts = await watchPrompts(page);
    await page.waitFor('create-passkey');

    // -- Create with a passkey. "Wallet made" shows the 12 words at once: that is one showing of them in this page. --
    const made = await createFrom(page, 'create-passkey');
    const { record, words } = made;
    assert.equal(record.kind, 'passkey');
    assert.deepEqual(await storageKeys(page), ['lbp_wallet_v1'], 'no step was opened: nothing is noted, whatever was shown');
    const documents = documentsOf(page);

    // -- From there to the step, inside the same page: the Overview, the list, the step --
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    await page.click('overview-do-link');
    await arrivesAt(page, '/do');
    await pickStep(page, STEP);
    assert.equal(documentsOf(page), documents, 'all of it in the page that showed the words');

    // -- Not done, and not begun: the first part asks for the words to be shown while the step is followed --
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later']);
    assert.equal(await hrefOf(page, 'step-action'), '/wallet/backup');
    for (const later of ['step-said', 'step-word', 'step-done']) assert.equal(await countOf(page, later), 0, later);
    assert.deepEqual((await noteOf(page))?.steps, { 'the-seed': { started: true } });
    await sleep(1500);
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later']);
    assert.ok(!page.statusLog().some((said) => said.includes(partName(STEP, 1))), page.statusLog().join(' | '));
    assert.deepEqual(stepsCounted(s), {});

    // -- Part 1: Backup, and the words shown now. The keys are still loaded from Create, so nothing is asked. --
    await act(page, '/wallet/backup');
    await page.click('reveal-words');
    assert.deepEqual(await wordsOnScreen(page), words);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    assert.deepEqual((await noteOf(page))?.steps[STEP]?.parts, { 1: true });
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 });

    // -- The faucet, between two parts. Its bot check comes into the page, and the wallet's keys are dropped for it. --
    await section(page, '/wallet/receive');
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    await page.click('faucet-ask');
    await untilPhase(page, 'arrived');
    const faucetTxid = ((await attributeOf(page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    assert.equal(await botCheckScripts(page), 1);
    assert.ok((await page.text('lock-state')).startsWith(common.stateLocked));
    // The strip is still for this step, and the way back loads a page.
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    await stripBack(page, STEP, { load: true });
    assert.equal(documentsOf(page), documents + 1);
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);

    // -- Part 2, then part 3: comparing words needs the wallet's keys, and after the page load they are not loaded --
    await page.click('step-said');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    await page.waitFor('unlock-step');
    assert.ok((await page.text('unlock-step')).includes(en.wordsUnlockWhy), await page.text('unlock-step'));
    assert.equal(await countOf(page, 'step-word'), 0, 'no field before the wallet is unlocked');
    await page.page.bringToFront();
    await page.click('unlock');
    await page.waitFor('step-word');
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 }, 'one prompt for the three words');
    assert.equal(await usesOf(page), 1);

    // A wrong word first, then the right three.
    const places = await placesAsked(page);
    const typed = rightFor(places, words);
    typed[0] = strangerTo(words);
    await failsWith(page, typed, words);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'now']);
    await typeThree(page, words);
    await page.click('step-words-check');
    await page.waitFor('step-done');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.equal((await noteOf(page))?.steps[STEP]?.wallet, record.fingerprint);
    assert.equal(await page.text('step-seed-wallet'), fill(en.seedChecked, { fingerprint: record.fingerprint }));
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });
    assert.deepEqual(stepsCounted(s), { 'the-seed': 1 });

    await ends(
      s,
      reader,
      [
        view('/new'),
        { name: 'Passkey', path: '/new', value: 'ok' },
        { name: 'Wallet created', path: '/new', value: 'passkey' },
        view('/wallet/backup'),
        { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
        view('/wallet'),
        view('/do'),
        view('/do/the-seed'),
        // The words shown a second time in one page are counted for the step, and not a second time as an event.
        view('/wallet/backup'),
        view('/wallet/receive'),
        { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
        view('/do/the-seed'),
        { name: 'Unlock', path: '/do/the-seed', value: 'same' },
        doIt('/do/the-seed', STEP),
      ],
      { records: [record], words: [words], addresses: [address], txids: [faucetTxid] },
    );
  },
);

scenario(
  'The seed with the page loaded again after every part: each tick is still there, a wrong try leaves nothing behind, and the done step still names the wallet its words were checked for',
  { timeout: 150_000 },
  async (s) => {
    const record = freshRecord();
    const words = wordsOf(record);
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;
    await untilParts(page, ['now', 'later', 'later']);
    await reloadStep(page);
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later']);
    assert.deepEqual((await noteOf(page))?.steps, { 'the-seed': { started: true } });

    // -- Part 1, and a reload on Backup: the words are hidden again, the tick is not --
    await act(page, '/wallet/backup');
    await page.click('reveal-words');
    await wordsOnScreen(page);
    await untilStrip(page, STEP, 'part');
    await page.page.reload({ waitUntil: 'load' });
    await page.waitFor('reveal-words');
    assert.equal(await countOf(page, 'word'), 0);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    await stripBack(page, STEP);
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);
    await reloadStep(page);
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);

    // -- Part 2, and a reload --
    await page.click('step-said');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    await reloadStep(page);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'now']);

    // -- A wrong try, and a reload: nothing of it is left, in the fields or in the note --
    const typed = rightFor(await placesAsked(page), words);
    typed[2] = strangerTo(words);
    await failsWith(page, typed, words);
    await reloadStep(page);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'now']);
    assert.deepEqual(await wordFields(page), ['', '', '']);
    assert.equal(await countOf(page, 'step-words-wrong'), 0);
    assert.deepEqual((await noteOf(page))?.steps, { 'the-seed': { started: true, parts: { 1: true, 2: true } } });
    assert.equal(stepsCounted(s)[STEP], undefined);

    // -- Part 3, and two more loads: done, and still done --
    await typeThree(page, words);
    await page.click('step-words-check');
    await page.waitFor('step-done');
    const done = await noteText(page);
    for (const again of [1, 2]) {
      await reloadStep(page);
      await page.waitFor('step-done');
      assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked'], `after reload ${again}`);
      assert.equal(await page.text('step-seed-wallet'), fill(en.seedChecked, { fingerprint: record.fingerprint }));
      assert.equal(await hrefOf(page, 'step-back'), `${s.stack.config.siteUrl}${CHAPTER}#done=${STEP}`);
      assert.equal(await noteText(page), done, 'the note is as it was');
    }
    assert.deepEqual(stepsCounted(s), { 'the-seed': 1 });

    await ends(
      s,
      reader,
      [
        view('/do/the-seed'),
        view('/do/the-seed'),
        view('/wallet/backup'),
        { name: 'Words shown', path: '/wallet/backup', value: 'words' },
        view('/wallet/backup'),
        view('/do/the-seed'),
        view('/do/the-seed'),
        view('/do/the-seed'),
        view('/do/the-seed'),
        doIt('/do/the-seed', STEP),
        view('/do/the-seed'),
        view('/do/the-seed'),
      ],
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [] },
    );
  },
);

scenario(
  'The seed stays not done with a wrong word: nothing typed, a word that is not on the paper, a misspelt one, the right words in the wrong fields and a word from another place of the phrase are all refused by their place, and nothing is counted',
  { timeout: 150_000 },
  async (s) => {
    const record = freshRecord();
    const words = wordsOf(record);
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;
    await untilParts(page, ['now', 'later', 'later']);
    await act(page, '/wallet/backup');
    await page.click('reveal-words');
    await untilStrip(page, STEP, 'part');
    await stripBack(page, STEP);
    await page.click('step-said');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    const stored = await noteText(page);

    const places = await placesAsked(page);
    const right = rightFor(places, words);
    const stranger = strangerTo(words);
    /** A word of this wallet that does not belong at the first place asked for. */
    const elsewhere = words.find((word) => word !== right[0]) ?? stranger;
    const tries: string[][] = [
      ['', '', ''],
      [right[0]!, right[1]!, ''],
      [stranger, right[1]!, right[2]!],
      [right[0]!, `${right[1]}s`, right[2]!],
      [right[1]!, right[2]!, right[0]!],
      [elsewhere, right[1]!, right[2]!],
      [stranger, stranger, stranger],
    ];
    for (const typed of tries) {
      // A wallet can hold one word twice: a try that happens to be right for this wallet proves nothing here.
      if (typed.every((word, at) => word === right[at])) continue;
      await failsWith(page, typed, words);
      assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'now'], JSON.stringify(typed));
      assert.equal(await countOf(page, 'step-done'), 0);
      assert.equal(await noteText(page), stored, 'a wrong try writes nothing');
    }
    // Leaving the question and coming back to it, in the same page, does not change it: the same three places
    // are asked for until they are answered right. A question that moved on could be passed by guessing.
    await page.click('step-list');
    await arrivesAt(page, '/do');
    await pickStep(page, STEP);
    assert.deepEqual(await placesAsked(page), places);
    assert.deepEqual(await wordFields(page), ['', '', '']);
    // Enter in the last field checks too, and a wrong word is as wrong.
    await typeFields(page, [right[0]!, right[1]!, stranger]);
    await page.page.keyboard.press('Enter');
    await page.waitFor('step-words-wrong');
    assert.deepEqual(await wrongLines(page), [fill(en.wordsWrong, { n: String(places[2]) }), en.wordsWrongWay]);
    assert.deepEqual(await wordFields(page), ['', '', '']);

    // Still not done after a reload, and the note names no wallet: no check was passed.
    await reloadStep(page);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'now']);
    assert.deepEqual((await noteOf(page))?.steps, { 'the-seed': { started: true, parts: { 1: true, 2: true } } });
    assert.ok(!page.statusLog().includes(saidDone(STEP)) && !page.statusLog().includes(saidTicked(STEP, 3)), page.statusLog().join(' | '));
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [
        view('/do/the-seed'),
        view('/wallet/backup'),
        { name: 'Words shown', path: '/wallet/backup', value: 'words' },
        view('/do/the-seed'),
        view('/do'),
        view('/do/the-seed'),
        view('/do/the-seed'),
      ],
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [] },
    );
  },
);

scenario(
  'The seed in Spanish on a phone 375 px wide: every screen fits, the fields say that the words are English on purpose, a wrong word is named in Spanish, and the step is done and counted under its Spanish address',
  { timeout: 150_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const record = freshRecord();
    const words = wordsOf(record);
    const reader = await begin(s, `/es/do/${STEP}?from=${CAPITULO}`, { record, lang: 'es', width: 375 });
    const { page } = reader;
    const fits = async (where: string): Promise<void> => assert.equal(await page.sidewaysScroll(), 0, `${where} scrolls sideways`);

    await untilParts(page, ['now', 'later', 'later']);
    assert.equal(await page.page.evaluate(() => document.documentElement.lang), 'es');
    assert.equal(await page.text('step-title'), es['title_the-seed']);
    assert.deepEqual(await partWords(page), [es.partNow, es.partLater, es.partLater]);
    assert.equal(await page.text('step-guide'), es['guide_the-seed_1']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CAPITULO}#do-${STEP}`);
    assert.equal(await page.text('step-action'), es.actBackup);
    await fits('the step');

    // -- Part 1, on the Spanish Backup screen. The strip on a phone: the step and "2 de 3". --
    await act(page, '/es/wallet/backup');
    await page.click('reveal-words');
    assert.deepEqual(await wordsOnScreen(page), words);
    const strip = await untilStrip(page, STEP, 'part');
    assert.ok(strip.text.startsWith(`${es['title_the-seed']} 2 de 3`), strip.text);
    assert.equal(await page.text('strip-back'), es.stripBack);
    await fits('Backup with the words and the strip');
    await stripBack(page, STEP, { prefix: '/es' });
    assert.deepEqual(await partWords(page), [es.proofOpened, es.partNow, es.partLater]);

    // -- Part 2 --
    assert.equal(await page.text('step-guide'), es['guide_the-seed_2']);
    await fits('the step, part 2');
    await page.click('step-said');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(await page.waitForStatus(saidTicked(STEP, 2, 'es')), saidTicked(STEP, 2, 'es'));
    assert.deepEqual(await partWords(page), [es.proofOpened, es.proofSaid, es.partNow]);

    // -- Part 3: the fields, one under the other on a phone, with the line that the words are English --
    const rules = await page.text('step-words-exception');
    assert.ok(rules.includes(strings.restore.es.exception) && rules.includes(es.wordsOnce), rules);
    assert.ok((await page.text('step-open')).includes(strings.wallet.es.wordsEnglishType));
    assert.deepEqual(await wordFieldRules(page), [WORD_FIELD_RULES, WORD_FIELD_RULES, WORD_FIELD_RULES]);
    const places = await placesAsked(page);
    assert.deepEqual(
      await page.page.$$eval(`${hook('step-open')} label`, (labels) => labels.map((label) => (label.textContent ?? '').trim())),
      places.map((place) => fill(strings.wallet.es.wordsNumber, { n: String(place) })),
    );
    await fits('the step, part 3');
    const typed = rightFor(places, words);
    typed[2] = strangerTo(words);
    await failsWith(page, typed, words, 'es');
    await fits('the step, after a wrong word');
    await typeThree(page, words);
    await page.click('step-words-check');
    await page.waitFor('step-done');
    assert.equal(await page.waitForStatus(saidDone(STEP, 'es')), saidDone(STEP, 'es'));
    const done = (await noteOf(page))?.steps[STEP];
    assert.ok(done?.doneAt !== undefined);
    assert.deepEqual(done, { started: true, doneAt: done.doneAt, from: CAPITULO, wallet: record.fingerprint, parts: { 1: true, 2: true, 3: true } });
    assert.equal(await page.text('step-done-on'), `Hecho el ${formatDate(done.doneAt / 1000, 'es', 'utc')}.`);
    assert.equal(await page.text('step-done-text'), es['done_the-seed']);
    assert.equal(await page.text('step-seed-wallet'), fill(es.seedChecked, { fingerprint: record.fingerprint }));
    assert.equal(await page.text('step-back'), es.back);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CAPITULO}#done=${STEP}`);
    assert.equal(await page.text('step-next'), fill(es.next, { step: es['title_prove-the-backup'] }));
    assert.equal(await hrefOf(page, 'step-next'), '/es/do/prove-the-backup');
    assert.deepEqual(await partWords(page), [es.proofOpened, es.proofSaid, es.proofChecked]);
    await fits('the step, done');

    await ends(
      s,
      reader,
      [
        view('/es/do/the-seed'),
        view('/es/wallet/backup'),
        { name: 'Words shown', path: '/es/wallet/backup', value: 'words' },
        view('/es/do/the-seed'),
        doIt('/es/do/the-seed', STEP),
      ],
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [] },
      { from: [CAPITULO] },
    );
  },
);
