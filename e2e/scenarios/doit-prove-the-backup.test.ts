// "Prove the backup", the last step of chapter 4, through the real screens:
// check the paper copy, remove the wallet from this browser, restore it
// from the 12 words, and find its coins again.
//
// It is the one step that takes something away, and the one whose note has
// to outlive the wallet: after the removal the note alone says which wallet
// has to come back, and how this browser kept it before. A wallet that
// comes back through its passkey proves the passkey, and another wallet
// proves nothing; only the same wallet, kept with its words (which is what
// Restore writes), finishes the step.
//
//   1. from not started to done, in English, with a wallet kept with its
//      words: Settings, the question before the removal, Home and Restore
//      each say what this browser still keeps of the steps
//   2. with a passkey wallet, after "The seed" was done for it: the paper
//      check is ticked already; the wallet opened again with its passkey
//      leaves the step not done; restored from the words it is done, and the
//      screen says what the restore changed
//   3. it stays not done when another wallet is restored; a done "The
//      seed" then offers its check again for the wallet that is here; with
//      the first wallet restored the step is done
//   4. it stays not done before any removal the step saw: with the wallet
//      here, kept with its words and holding coins, and after a removal
//      made while the step was not followed
//   5. with the page loaded again after every part, and the faucet's page
//      load between two parts
//   6. the done drill of a wallet that was opened with a passkey, read again
//      in each state a reader can then bring this browser to: that wallet
//      kept with its words, that wallet behind its passkey again, no wallet,
//      another wallet. The card says what the restore changed, and what it
//      says is true in each of them
//
// All six are local only: they pay the wallet from the stand-in, or ask
// the faucet.

import assert from 'node:assert/strict';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { freshRecord, scenario, type OpenedPage } from './helpers.ts';
import {
  arrivesAt,
  attributeOf,
  botCheckScripts,
  countOf,
  createFrom,
  documentsOf,
  hook,
  storageKeys,
  storedRecord,
  untilAnswersCount,
  untilPhase,
  watchPrompts,
  wordsOnScreen,
} from './journey-helpers.ts';
import {
  PROGRESS_KEY,
  WORD_FIELD_RULES,
  act,
  begin,
  doIt,
  ends,
  hrefOf,
  listState,
  noteOf,
  noteText,
  partName,
  partWords,
  partsOf,
  pickStep,
  placesAsked,
  reloadStep,
  removeHere,
  restoreHere,
  saidDone,
  saidTicked,
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
const home = strings.home.en;
const about = strings.about.en;

const STEP = 'prove-the-backup';
const SEED = 'the-seed';
const CHAPTER = '/journey/be-your-own-bank';

/** The words of a wallet made without a passkey, as its record keeps them. */
function wordsOf(record: { mnemonic?: string }): string[] {
  assert.ok(record.mnemonic !== undefined);
  return record.mnemonic.split(' ');
}

/** "The seed", from its own screen to done, by the shortest way: Backup, the reader's word, the three words. */
async function doTheSeed(page: OpenedPage, words: readonly string[]): Promise<void> {
  await untilParts(page, ['now', 'later', 'later']);
  await act(page, '/wallet/backup');
  await page.click('reveal-words');
  await untilStrip(page, SEED, 'part');
  await stripBack(page, SEED);
  await page.click('step-said');
  await untilParts(page, ['ticked', 'ticked', 'now']);
  await typeThree(page, words);
  await page.click('step-words-check');
  await page.waitFor('step-done');
}

scenario(
  'Prove the backup, from not started to done: three words off the paper, the wallet removed on Settings, restored from its 12 words, and its coins found again; Settings, the question, Home and the strip say what this browser keeps of the steps meanwhile',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const record = freshRecord();
    const words = wordsOf(record);
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;

    // -- Part 1: the paper the wallet has to come back from. The check of "The seed", for the wallet that is here. --
    await untilParts(page, ['now', 'later', 'later', 'later']);
    assert.equal(await page.text('step-title'), en['title_prove-the-backup']);
    assert.equal(await page.text('step-guide'), en['guide_prove-the-backup_1']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#do-${STEP}`);
    const rules = await page.text('step-words-exception');
    assert.ok(rules.includes(strings.restore.en.exception) && rules.includes(en.wordsOnce), rules);
    assert.deepEqual(await wordFieldRules(page), [WORD_FIELD_RULES, WORD_FIELD_RULES, WORD_FIELD_RULES]);
    // A wrong word first: named by its place, and the step is where it was.
    const places = await placesAsked(page);
    const typed = places.map((place) => words[place - 1] ?? '');
    typed[0] = strangerTo(words);
    await typeFields(page, typed);
    await page.click('step-words-check');
    await page.waitFor('step-words-wrong');
    assert.deepEqual(await wrongLines(page), [fill(en.wordsWrong, { n: String(places[0]) }), en.wordsWrongWay]);
    assert.deepEqual(await wordFields(page), ['', '', '']);
    assert.deepEqual((await noteOf(page))?.steps[STEP], { started: true });
    // The right three.
    await typeThree(page, words);
    await page.click('step-words-check');
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.equal(await page.waitForStatus(saidTicked(STEP, 1)), saidTicked(STEP, 1));
    // The note now names the wallet that has to come back, and how this browser kept it.
    assert.deepEqual((await noteOf(page))?.steps[STEP], { started: true, wallet: record.fingerprint, was: 'words', parts: { 1: true } });

    // -- Part 2: said plainly before anything is taken away --
    assert.equal(await page.text('step-guide'), en['guide_prove-the-backup_2']);
    const warning = await page.text('step-remove-warning');
    for (const sentence of [en.removeWarnTitle, en.removeWarnFunded, en.removeWarnNine, en.removeWarnKept]) assert.ok(warning.includes(sentence), sentence);
    assert.equal(await page.text('step-action'), en.actSettings);
    await act(page, '/wallet/settings');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    // Settings lists the note among what this browser keeps, and the question says that it stays.
    assert.equal(await page.text('keeps-progress'), en.keepsProgress);
    const before = await noteText(page);
    await page.click('remove-wallet');
    await page.waitFor('remove-confirm');
    assert.equal(await page.text('remove-progress'), en.staysOnRemove);
    // "Keep it" first: the question is no removal, and the step is where it was.
    await untilAnswersCount();
    await page.click('remove-keep');
    await page.waitForGone('remove-confirm');
    assert.equal(await noteText(page), before);
    assert.equal((await storedRecord(page))?.fingerprint, record.fingerprint);
    await removeHere(page);

    // -- Home, with no wallet: the removal is said, and so is what is still kept. The note is all that is stored. --
    assert.equal(await page.text('home-removed'), home.removed);
    assert.ok((await page.text('home-progress-stays')).startsWith(en.staysAfterRemove));
    assert.deepEqual(await storageKeys(page), [PROGRESS_KEY]);
    const removed = await noteOf(page);
    assert.deepEqual(removed?.steps[STEP], { started: true, wallet: record.fingerprint, was: 'words', parts: { 1: true, 2: true } });
    assert.equal(removed?.following, STEP);
    assert.notEqual(await noteText(page), before);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 3));

    // -- Part 3: with no wallet here the one way on is Restore, never Create --
    await stripBack(page, STEP);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'now', 'later']);
    assert.deepEqual(await partWords(page), [en.proofChecked, en.proofChecked, en.partNow, en.partLater]);
    assert.equal(await page.text('step-guide'), en['guide_prove-the-backup_3']);
    assert.equal(await page.text('step-action'), en.actRestore);
    assert.deepEqual(await page.page.$$eval(`${hook('step-open')} a`, (links) => links.map((link) => link.getAttribute('href'))), ['/restore']);
    await act(page, '/restore');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 3));
    page.forgetStatus();
    await restoreHere(page, words);

    // -- Parts 3 and 4 tick as the restore finds the coins: the step is done on the Overview, and the strip says so --
    await page.waitFor('overview-restored');
    const strip = await untilStrip(page, STEP, 'done');
    assert.equal(strip.words, fill(en.stripDone, { step: en['title_prove-the-backup'] }));
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.equal(await hrefOf(page, 'strip-chapter'), `${site}${CHAPTER}#done=${STEP}`);
    assert.equal(await page.text('total'), '100,000 practice sats');
    const back = await storedRecord(page);
    assert.deepEqual([back?.kind, back?.fingerprint, back?.xpub], ['words', record.fingerprint, record.xpub]);
    assert.deepEqual(stepsCounted(s), { 'prove-the-backup': 1 });

    // -- The step's own screen: done. This wallet was kept with its words before, so nothing has changed for it. --
    await stripBack(page, STEP);
    await page.waitFor('step-done');
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked', 'ticked']);
    assert.deepEqual(await partWords(page), [en.proofChecked, en.proofChecked, en.proofChecked, en.proofChecked]);
    assert.equal(await page.text('step-done-text'), en['done_prove-the-backup']);
    assert.equal(await countOf(page, 'step-changed'), 0);
    assert.equal(await hrefOf(page, 'step-sparrow'), '/sparrow');
    assert.equal(await hrefOf(page, 'step-back'), `${site}${CHAPTER}#done=${STEP}`);
    assert.equal(await countOf(page, 'step-next'), 0, 'the last step of the last chapter that has steps');
    // Done, the note lets go of the wallet it named for the drill.
    const note = await noteOf(page);
    const done = note?.steps[STEP];
    assert.ok(done?.doneAt !== undefined);
    assert.deepEqual(note, { v: 1, following: null, steps: { 'prove-the-backup': { started: true, doneAt: done.doneAt, was: 'words', parts: { 1: true, 2: true, 3: true, 4: true } } } });

    await ends(
      s,
      reader,
      [
        view('/do/prove-the-backup'),
        view('/wallet/settings'),
        { name: 'Wallet removed', path: '/wallet/settings', value: 'words' },
        view('/'),
        view('/do/prove-the-backup'),
        view('/restore'),
        { name: 'Restore', path: '/restore', value: 'found' },
        doIt('/restore', STEP),
        view('/wallet'),
        view('/do/prove-the-backup'),
      ],
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [funding] },
    );
  },
);

scenario(
  'Prove the backup with a passkey wallet: the paper check is ticked already when "The seed" was done for this wallet; opened again with its passkey the wallet proves the passkey and the step stays not done; restored from the 12 words it is done, and the screen says what the restore changed',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const reader = await begin(s, '/new', { passkey: 'prf' });
    const { page } = reader;
    const prompts = await watchPrompts(page);
    await page.waitFor('create-passkey');
    const made = await createFrom(page, 'create-passkey');
    const { record, words } = made;
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    await page.waitFor('coin');

    // -- "The seed" first, for this wallet. The keys are loaded since Create: no prompt on the way. --
    await page.click('overview-do-link');
    await arrivesAt(page, '/do');
    await pickStep(page, SEED);
    await doTheSeed(page, words);
    assert.equal((await noteOf(page))?.steps[SEED]?.wallet, record.fingerprint);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 });

    // -- "Prove the backup", offered as the next step: its paper check was passed for this very wallet --
    await page.click('step-next');
    await arrivesAt(page, `/do/${STEP}`);
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.equal(await countOf(page, 'step-word'), 0);
    assert.deepEqual((await noteOf(page))?.steps[STEP], { started: true, wallet: record.fingerprint, was: 'passkey', parts: { 1: true } });

    // -- Part 2: removed --
    await act(page, '/wallet/settings');
    await removeHere(page);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 3));
    assert.deepEqual((await noteOf(page))?.steps[STEP]?.parts, { 1: true, 2: true });

    // -- The wallet comes back through its passkey. That is the same wallet, and it is not what the step asked for. --
    await page.page.bringToFront();
    await page.click('open-passkey');
    await arrivesAt(page, '/wallet');
    await page.waitFor('coin');
    assert.equal((await storedRecord(page))?.kind, 'passkey');
    assert.equal((await untilStrip(page, STEP, 'need')).words, en['stripNeed_came-back-with-passkey']);
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'ticked', 'blocked', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'came-back-with-passkey');
    assert.ok((await page.text('step-need')).startsWith(en['need_came-back-with-passkey']), await page.text('step-need'));
    assert.equal(await page.text('step-need-link'), en.actSettings);
    assert.equal(await hrefOf(page, 'step-need-link'), '/wallet/settings');
    // Not done, here or after a page load.
    await reloadStep(page);
    await untilParts(page, ['ticked', 'ticked', 'blocked', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'came-back-with-passkey');
    assert.equal((await noteOf(page))?.steps[STEP]?.doneAt, undefined);
    assert.ok(!page.statusLog().includes(saidDone(STEP)), page.statusLog().join(' | '));
    assert.deepEqual(stepsCounted(s), { 'the-seed': 1 });

    // -- Removed once more, and restored from the paper --
    await act(page, '/wallet/settings', { hook: 'step-need-link' });
    await removeHere(page);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 3));
    await page.click('home-restore');
    await arrivesAt(page, '/restore');
    await restoreHere(page, words);
    await untilStrip(page, STEP, 'done');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    const back = await storedRecord(page);
    assert.deepEqual([back?.kind, back?.fingerprint], ['words', record.fingerprint]);

    // -- Done, and what the restore changed: this browser began to keep the wallet with its words --
    await stripBack(page, STEP);
    await page.waitFor('step-done');
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked', 'ticked']);
    const changed = await page.text('step-changed');
    assert.ok(changed.includes(en.changedTitle) && changed.includes(en.changed), changed);
    const done = (await noteOf(page))?.steps[STEP];
    assert.ok(done?.doneAt !== undefined);
    assert.deepEqual(done, { started: true, doneAt: done.doneAt, was: 'passkey', parts: { 1: true, 2: true, 3: true, 4: true } });
    // One prompt made the wallet, one opened it again, and no other was shown.
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });
    assert.deepEqual(stepsCounted(s), { 'the-seed': 1, 'prove-the-backup': 1 });

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
        view('/do/the-seed'),
        doIt('/do/the-seed', SEED),
        view('/do/prove-the-backup'),
        view('/wallet/settings'),
        { name: 'Wallet removed', path: '/wallet/settings', value: 'passkey' },
        view('/'),
        view('/wallet'),
        { name: 'Unlock', path: '/wallet', value: 'opened' },
        view('/do/prove-the-backup'),
        view('/do/prove-the-backup'),
        view('/wallet/settings'),
        { name: 'Wallet removed', path: '/wallet/settings', value: 'passkey' },
        view('/'),
        view('/restore'),
        { name: 'Restore', path: '/restore', value: 'found' },
        doIt('/restore', STEP),
        view('/wallet'),
        view('/do/prove-the-backup'),
      ],
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [funding] },
    );
  },
);

scenario(
  'Prove the backup stays not done when another wallet is restored: the step names both wallets and the two ways on; a done "The seed" offers its check again for the wallet that is here; and with the first wallet restored the step is done',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const first = freshRecord();
    const second = freshRecord();
    const words = wordsOf(first);
    const others = wordsOf(second);
    const fundings = [s.standIn.fund(first.firstAddress, 100_000), s.standIn.fund(second.firstAddress, 7_000)];
    const reader = await begin(s, `/do/${SEED}`, { record: first });
    const { page } = reader;

    // -- "The seed" for the first wallet, then this step: its paper check is ticked already --
    await doTheSeed(page, words);
    await page.click('step-next');
    await arrivesAt(page, `/do/${STEP}`);
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    await act(page, '/wallet/settings');
    await removeHere(page);

    // -- Another wallet is restored: the words of a second paper --
    await page.click('home-restore');
    await arrivesAt(page, '/restore');
    await restoreHere(page, others);
    await page.waitFor('coin');
    assert.equal(await page.text('total'), '7,000 practice sats');
    assert.equal((await untilStrip(page, STEP, 'need')).words, en['stripNeed_another-wallet']);
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'ticked', 'blocked', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'another-wallet');
    const need = await page.text('step-need');
    assert.ok(need.startsWith(`${fill(en['need_another-wallet'], { here: second.fingerprint, noted: first.fingerprint })} ${en.needAnotherWays}`), need);
    assert.equal(await hrefOf(page, 'step-need-link'), '/wallet/settings');
    assert.equal(await countOf(page, 'step-restart'), 1, '"Start this step again" is the other way on');
    assert.equal((await noteOf(page))?.steps[STEP]?.doneAt, undefined);
    assert.deepEqual(stepsCounted(s), { 'the-seed': 1 });

    // -- "The seed" is done, for the first wallet. With another one here it says so, and offers the check again. --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    assert.deepEqual([await listState(page, SEED), await listState(page, STEP)], ['done', 'started']);
    await pickStep(page, SEED);
    await page.waitFor('step-done');
    assert.equal(await page.text('step-seed-wallet'), fill(en.seedChecked, { fingerprint: first.fingerprint }));
    assert.ok((await page.text('step-seed-other')).startsWith(fill(en.seedOther, { here: second.fingerprint })), await page.text('step-seed-other'));
    // The first paper's words are wrong for this wallet.
    const places = await placesAsked(page);
    const wrong = places.filter((place) => words[place - 1] !== others[place - 1]);
    assert.ok(wrong.length > 0);
    await typeThree(page, words);
    await page.click('step-words-check');
    await page.waitFor('step-words-wrong');
    assert.deepEqual(await wrongLines(page), [...wrong.map((place) => fill(en.wordsWrong, { n: String(place) })), en.wordsWrongWay]);
    assert.deepEqual(await wordFields(page), ['', '', '']);
    assert.equal((await noteOf(page))?.steps[SEED]?.wallet, first.fingerprint);
    // The second paper's words pass: the note now names the wallet that is here. The step was done before, and is not counted again.
    const doneAt = (await noteOf(page))?.steps[SEED]?.doneAt;
    await typeThree(page, others);
    await page.click('step-words-check');
    await page.waitFor('step-seed-rechecked');
    assert.equal(await page.text('step-seed-rechecked'), en.seedRechecked);
    assert.equal(await page.text('step-seed-wallet'), fill(en.seedChecked, { fingerprint: second.fingerprint }));
    assert.equal(await countOf(page, 'step-word'), 0);
    assert.deepEqual((await noteOf(page))?.steps[SEED], { started: true, doneAt, wallet: second.fingerprint, parts: { 1: true, 2: true, 3: true } });
    assert.deepEqual(stepsCounted(s), { 'the-seed': 1 });

    // -- This step still waits for the wallet it named. The first way on: remove this one, and restore the first. --
    assert.equal((await untilStrip(page, STEP, 'need')).words, en['stripNeed_another-wallet']);
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'ticked', 'blocked', 'later']);
    await act(page, '/wallet/settings', { hook: 'step-need-link' });
    await removeHere(page);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 3));
    await page.click('home-restore');
    await arrivesAt(page, '/restore');
    await restoreHere(page, words);
    await untilStrip(page, STEP, 'done');
    assert.equal(await page.text('total'), '100,000 practice sats');
    await stripBack(page, STEP);
    await page.waitFor('step-done');
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked', 'ticked']);
    assert.deepEqual(stepsCounted(s), { 'the-seed': 1, 'prove-the-backup': 1 });

    await ends(
      s,
      reader,
      [
        view('/do/the-seed'),
        view('/wallet/backup'),
        { name: 'Words shown', path: '/wallet/backup', value: 'words' },
        view('/do/the-seed'),
        doIt('/do/the-seed', SEED),
        view('/do/prove-the-backup'),
        view('/wallet/settings'),
        { name: 'Wallet removed', path: '/wallet/settings', value: 'words' },
        view('/'),
        view('/restore'),
        { name: 'Restore', path: '/restore', value: 'found' },
        view('/wallet'),
        view('/do/prove-the-backup'),
        view('/do'),
        view('/do/the-seed'),
        view('/do/prove-the-backup'),
        view('/wallet/settings'),
        { name: 'Wallet removed', path: '/wallet/settings', value: 'words' },
        view('/'),
        view('/restore'),
        { name: 'Restore', path: '/restore', value: 'found' },
        doIt('/restore', STEP),
        view('/wallet'),
        view('/do/prove-the-backup'),
      ],
      { records: [first, second], words: [words, others], addresses: [first.firstAddress, second.firstAddress], txids: fundings },
    );
  },
);

scenario(
  'Prove the backup stays not done before any removal the step saw: the wallet is here, kept with its words and holding coins, and nothing ticks; a removal made while the step is not followed does not count, and the wallet restored after it leaves the step where it was',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const record = freshRecord();
    const words = wordsOf(record);
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;
    await untilParts(page, ['now', 'later', 'later', 'later']);
    await typeThree(page, words);
    await page.click('step-words-check');
    await untilParts(page, ['ticked', 'now', 'later', 'later']);

    // -- Everything the last two parts look for is so already: this very wallet, kept with its words, with coins.
    //    Neither is looked at before the removal, on any screen or after a page load. --
    assert.equal((await storedRecord(page))?.kind, 'words');
    await page.goto('/wallet');
    await page.waitFor('coin');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    await stripBack(page, STEP);
    await reloadStep(page);
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.deepEqual((await noteOf(page))?.steps[STEP]?.parts, { 1: true });

    // -- "Stop following", and then the wallet is removed: nobody was following the step when it went --
    await page.click('step-stop');
    await page.waitForGone('step-stop');
    assert.equal((await noteOf(page))?.following, null);
    await page.click('step-list');
    await arrivesAt(page, '/do');
    assert.equal(await stripOf(page), null);
    await page.goto('/wallet/settings');
    await page.waitFor('remove-wallet');
    assert.equal(await stripOf(page), null);
    await removeHere(page);
    assert.equal(await stripOf(page), null);
    assert.ok((await page.text('home-progress-stays')).startsWith(en.staysAfterRemove));
    assert.deepEqual((await noteOf(page))?.steps[STEP]?.parts, { 1: true }, 'a removal the step did not see ticks nothing');

    // -- The step, opened again: no wallet is here, and none was removed while it was followed --
    await page.click('home-do-link');
    await arrivesAt(page, '/do');
    await pickStep(page, STEP);
    assert.deepEqual(await partsOf(page), ['ticked', 'blocked', 'later', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-wallet');
    assert.ok((await page.text('step-need')).startsWith(en.needRemovedElsewhere), await page.text('step-need'));
    assert.equal(await page.text('step-need-link'), en.actHome);

    // -- The wallet restored from its words, with its coins: what the step ends in, and not what it asked for next --
    await act(page, '/', { hook: 'step-need-link' });
    await page.click('home-restore');
    await arrivesAt(page, '/restore');
    await restoreHere(page, words);
    await page.waitFor('coin');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.equal(await hrefOf(page, 'step-action'), '/wallet/settings');
    assert.deepEqual((await noteOf(page))?.steps[STEP], { started: true, wallet: record.fingerprint, was: 'words', parts: { 1: true } });
    assert.equal(await countOf(page, 'step-done'), 0);
    assert.ok(!page.statusLog().includes(saidDone(STEP)) && !page.statusLog().includes(saidTicked(STEP, 2)), page.statusLog().join(' | '));
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [
        view('/do/prove-the-backup'),
        view('/wallet'),
        view('/do/prove-the-backup'),
        view('/do/prove-the-backup'),
        view('/do'),
        view('/wallet/settings'),
        { name: 'Wallet removed', path: '/wallet/settings', value: 'words' },
        view('/'),
        view('/do'),
        view('/do/prove-the-backup'),
        view('/'),
        view('/restore'),
        { name: 'Restore', path: '/restore', value: 'found' },
        view('/wallet'),
        view('/do/prove-the-backup'),
      ],
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [funding] },
    );
  },
);

scenario(
  'Prove the backup with the page loaded again after every part, and the faucet asked between two parts: the note alone carries the step across the removal, and the done strip is still there after a reload',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const record = freshRecord();
    const words = wordsOf(record);
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;

    // -- No coins: the drill needs a wallet that holds some. The need is the same after a reload. --
    await untilParts(page, ['blocked', 'later', 'later', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-coins');
    assert.equal(await hrefOf(page, 'step-need-link'), '/do/hold-some');
    await reloadStep(page);
    await untilParts(page, ['blocked', 'later', 'later', 'later']);

    // -- The faucet. Its bot check comes into the page, and the way back to the step loads one. --
    await page.goto('/wallet/receive#faucet');
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    await page.click('faucet-ask');
    await untilPhase(page, 'arrived');
    const faucetTxid = ((await attributeOf(page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 1));
    assert.equal(await botCheckScripts(page), 1);
    const documents = documentsOf(page);
    await stripBack(page, STEP, { load: true });
    assert.equal(documentsOf(page), documents + 1);

    // -- Part 1, and a reload --
    await untilParts(page, ['now', 'later', 'later', 'later']);
    await typeThree(page, words);
    await page.click('step-words-check');
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    await reloadStep(page);
    await untilParts(page, ['ticked', 'now', 'later', 'later']);

    // -- Part 2, with a reload on Settings before it and one on Home after it --
    await act(page, '/wallet/settings');
    await page.page.reload({ waitUntil: 'load' });
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    await removeHere(page);
    await page.waitFor('home-removed');
    await page.page.reload({ waitUntil: 'load' });
    await page.waitFor('home-create');
    // "Removed" is said for the one visit that follows the removal. The strip is the note's, and is still there.
    assert.equal(await countOf(page, 'home-removed'), 0);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 3));
    await stripBack(page, STEP);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'now', 'later']);
    await reloadStep(page);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'now', 'later']);
    assert.deepEqual((await noteOf(page))?.steps[STEP], { started: true, wallet: record.fingerprint, was: 'words', parts: { 1: true, 2: true } });
    assert.equal(stepsCounted(s)[STEP], undefined);

    // -- Parts 3 and 4, with a reload on Restore before them and one on the Overview after them --
    await act(page, '/restore');
    await page.page.reload({ waitUntil: 'load' });
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 3));
    await restoreHere(page, words);
    await untilStrip(page, STEP, 'done');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    await page.page.reload({ waitUntil: 'load' });
    await page.waitFor('coin');
    assert.equal((await untilStrip(page, STEP, 'done')).words, fill(en.stripDone, { step: en['title_prove-the-backup'] }));
    await stripBack(page, STEP);
    await page.waitFor('step-done');
    for (const again of [1, 2]) {
      await reloadStep(page);
      await page.waitFor('step-done');
      assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked', 'ticked'], `after reload ${again}`);
      assert.equal(await hrefOf(page, 'step-back'), `${s.stack.config.siteUrl}${CHAPTER}#done=${STEP}`);
    }
    assert.equal(await stripOf(page), null);
    assert.deepEqual(stepsCounted(s), { 'prove-the-backup': 1 });

    await ends(
      s,
      reader,
      [
        view('/do/prove-the-backup'),
        view('/do/prove-the-backup'),
        view('/wallet/receive'),
        { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
        view('/do/prove-the-backup'),
        view('/do/prove-the-backup'),
        view('/wallet/settings'),
        view('/wallet/settings'),
        { name: 'Wallet removed', path: '/wallet/settings', value: 'words' },
        view('/'),
        view('/'),
        view('/do/prove-the-backup'),
        view('/do/prove-the-backup'),
        view('/restore'),
        view('/restore'),
        { name: 'Restore', path: '/restore', value: 'found' },
        doIt('/restore', STEP),
        view('/wallet'),
        view('/wallet'),
        view('/do/prove-the-backup'),
        view('/do/prove-the-backup'),
        view('/do/prove-the-backup'),
      ],
      { records: [record], words: [words], addresses: [address], txids: [faucetTxid] },
    );
  },
);

scenario(
  'A done drill for a wallet that was opened with a passkey says what the restore changed, and goes on saying it word for word whatever this browser keeps by then: that wallet with its words, that wallet behind its passkey again, no wallet, and another wallet; each time the stored record and About say what is kept right now, the passkey opens the same wallet, and the way back to the passkey that the card names works',
  { localOnly: true, timeout: 300_000 },
  async (s) => {
    const reader = await begin(s, '/new', { passkey: 'prf' });
    const { page } = reader;
    const prompts = await watchPrompts(page);
    await page.waitFor('create-passkey');
    const made = await createFrom(page, 'create-passkey');
    const { record, words } = made;
    // A second wallet, for the state in which another wallet is in this browser. It holds coins, so that a restore finds it.
    const second = freshRecord();
    const others = wordsOf(second);
    const fundings = [s.standIn.fund(record.firstAddress, 100_000), s.standIn.fund(second.firstAddress, 7_000)];
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    await page.waitFor('coin');

    // -- "The seed" and then the drill, the short way: removed on Settings, restored from the 12 words --
    await page.click('overview-do-link');
    await arrivesAt(page, '/do');
    await pickStep(page, SEED);
    await doTheSeed(page, words);
    await page.click('step-next');
    await arrivesAt(page, `/do/${STEP}`);
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    await act(page, '/wallet/settings');
    await removeHere(page);
    await untilStrip(page, STEP, 'part');
    await page.click('home-restore');
    await arrivesAt(page, '/restore');
    await restoreHere(page, words);
    await untilStrip(page, STEP, 'done');
    await stripBack(page, STEP);
    await page.waitFor('step-done');
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 });

    /** The card, as it must read in every state below: the same words, drawn from the same note. */
    const CARD = `${en.changedTitle} ${en.changed}`;
    assert.equal(await page.text('step-changed'), CARD);
    // It is in three of the four states below that a sentence about the present would be false: there the
    // browser does not keep that wallet with its words, and (in two of them) asks for the passkey again. So the
    // card speaks of the restore, and says nowhere what this browser keeps or asks for now.
    assert.match(CARD, /^What the restore changed When you restored the wallet from its 12 words, this browser began to keep it with those words, not encrypted, and stopped asking for the passkey\. /);
    assert.doesNotMatch(CARD, /\bnow keeps\b|\bkeeps (this|the) wallet\b|\bno longer asks\b|\bis kept\b/);
    const drill = (await noteOf(page))?.steps[STEP];
    assert.ok(drill?.doneAt !== undefined);
    assert.deepEqual(drill, { started: true, doneAt: drill.doneAt, was: 'passkey', parts: { 1: true, 2: true, 3: true, 4: true } });

    /**
     * One state, looked at after a page load each: the done drill's card, the drill's note, what About
     * says this browser keeps right now, and what it really keeps for the wallet.
     */
    const look = async (): Promise<{ card: string; kept: string | null; about: string; stored: Awaited<ReturnType<typeof storedRecord>> }> => {
      await page.goto(`/do/${STEP}`);
      await page.waitFor('step-done');
      const card = await page.text('step-changed');
      assert.deepEqual((await noteOf(page))?.steps[STEP], drill, 'the done drill\'s note is as it was');
      await page.goto('/about');
      await page.waitFor('about-kept-now');
      return { card, kept: await attributeOf(page, 'about-kept-now', 'data-kept'), about: await page.text('about-kept-now'), stored: await storedRecord(page) };
    };

    /** The way back to the passkey that the card names: "remove the wallet that is in this browser, if there is one, and choose Open with my passkey". */
    const backToThePasskey = async (here: 'a wallet' | 'no wallet'): Promise<void> => {
      if (here === 'a wallet') {
        await page.goto('/wallet/settings');
        await removeHere(page);
      } else {
        await page.goto('/');
      }
      assert.equal(await page.text('open-passkey'), strings.wallet.en.openButton);
      assert.ok(en.changed.endsWith(`choose "${strings.wallet.en.openButton}".`), 'the card quotes the button as Home draws it');
      // Chrome answers a passkey prompt only for the page that is in front.
      await page.page.bringToFront();
      await page.click('open-passkey');
      await arrivesAt(page, '/wallet');
      await page.waitFor('coin');
      // "The passkey still opens the same wallet": the wallet the drill was done for, and this browser keeps none of its words.
      const opened = await storedRecord(page);
      assert.deepEqual([opened?.kind, opened?.fingerprint, opened?.xpub, opened?.mnemonic], ['passkey', record.fingerprint, record.xpub, undefined]);
      assert.equal(await page.text('total'), '100,000 practice sats');
    };

    // -- 1. That wallet, kept with its words: what the restore did is what is so right now --
    const withWords = await look();
    assert.equal(withWords.card, CARD);
    assert.deepEqual([withWords.stored?.kind, withWords.stored?.fingerprint, withWords.stored?.mnemonic], ['words', record.fingerprint, words.join(' ')], 'kept with those words, not encrypted');
    assert.deepEqual([withWords.kept, withWords.about], ['words', `${about.keepNowLabel} ${about.keepNowWords} ${about.noteAlsoNow}`]);
    // "And stopped asking for the passkey": the 12 words are shown with no prompt.
    await page.goto('/wallet/backup');
    await page.click('reveal-words');
    assert.deepEqual(await wordsOnScreen(page), words);
    assert.deepEqual(await prompts.asked(), { create: 1, get: 0 });

    // -- 2. The reader takes the way back that the card names. The wallet is behind its passkey again, the
    //       browser keeps none of its words, and the card says what it said: it is about the restore. --
    await backToThePasskey('a wallet');
    assert.deepEqual(await prompts.asked(), { create: 1, get: 1 });
    const behindPasskey = await look();
    assert.equal(behindPasskey.card, CARD);
    assert.deepEqual([behindPasskey.stored?.kind, behindPasskey.stored?.fingerprint, behindPasskey.stored?.mnemonic], ['passkey', record.fingerprint, undefined]);
    for (const pair of [words.slice(0, 2), words.slice(5, 7), words.slice(10, 12)]) {
      assert.ok(!((await page.stored()) ?? '').includes(pair.join(' ')), 'no two of the 12 words are stored');
    }
    assert.deepEqual([behindPasskey.kept, behindPasskey.about], ['passkey', `${about.keepNowLabel} ${about.keepNowPasskey} ${about.noteAlsoNow}`]);

    // -- 3. No wallet at all: the note is all this browser keeps, and the card is the same --
    await page.goto('/wallet/settings');
    await removeHere(page);
    assert.deepEqual(await storageKeys(page), [PROGRESS_KEY]);
    const noWallet = await look();
    assert.equal(noWallet.card, CARD);
    assert.equal(noWallet.stored, null);
    assert.deepEqual([noWallet.kept, noWallet.about], ['none', `${about.keepNowLabel} ${about.noteOnlyNow}`]);
    // The way back from here has nothing to remove: the passkey opens the wallet.
    await backToThePasskey('no wallet');
    assert.deepEqual(await prompts.asked(), { create: 1, get: 2 });

    // -- 4. Another wallet, kept with its own words: the card still speaks of the wallet that was restored in
    //       the drill, and About says what is here now --
    await page.goto('/wallet/settings');
    await removeHere(page);
    await page.click('home-restore');
    await arrivesAt(page, '/restore');
    await restoreHere(page, others);
    await page.waitFor('coin');
    assert.equal(await page.text('total'), '7,000 practice sats');
    const another = await look();
    assert.equal(another.card, CARD);
    assert.deepEqual([another.stored?.kind, another.stored?.fingerprint], ['words', second.fingerprint]);
    assert.notEqual(second.fingerprint, record.fingerprint);
    assert.deepEqual([another.kept, another.about], ['words', `${about.keepNowLabel} ${about.keepNowWords} ${about.noteAlsoNow}`]);
    // The way back from here removes the wallet that is in this browser, as the card says, and the passkey
    // opens the wallet of the drill.
    await backToThePasskey('a wallet');
    assert.deepEqual(await prompts.asked(), { create: 1, get: 3 });

    // The drill was counted once, when it was done, and nothing since has counted it again.
    assert.deepEqual(stepsCounted(s), { 'the-seed': 1, 'prove-the-backup': 1 });

    const looked = [view('/do/prove-the-backup'), view('/about')];
    const removed = (kind: 'passkey' | 'words') => [view('/wallet/settings'), { name: 'Wallet removed' as const, path: '/wallet/settings', value: kind }, view('/')];
    const opened = [view('/wallet'), { name: 'Unlock' as const, path: '/wallet', value: 'opened' }];
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
        view('/wallet/backup'),
        view('/do/the-seed'),
        doIt('/do/the-seed', SEED),
        view('/do/prove-the-backup'),
        ...removed('passkey'),
        view('/restore'),
        { name: 'Restore', path: '/restore', value: 'found' },
        doIt('/restore', STEP),
        view('/wallet'),
        view('/do/prove-the-backup'),
        // 1. kept with its words
        ...looked,
        view('/wallet/backup'),
        { name: 'Words shown', path: '/wallet/backup', value: 'words' },
        // 2. behind its passkey again
        ...removed('words'),
        ...opened,
        ...looked,
        // 3. no wallet, and the way back from there
        ...removed('passkey'),
        ...looked,
        view('/'),
        ...opened,
        // 4. another wallet, and the way back from there
        ...removed('passkey'),
        view('/restore'),
        { name: 'Restore', path: '/restore', value: 'found' },
        view('/wallet'),
        ...looked,
        ...removed('words'),
        ...opened,
      ],
      { records: [record, second], words: [words, others], addresses: [record.firstAddress, second.firstAddress], txids: fundings },
    );
  },
);
