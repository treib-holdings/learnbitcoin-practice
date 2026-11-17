// The edges of the "Do it" steps, through the real screens: what a reader
// can do at the wrong moment, or with the wrong wallet, and what the steps
// must then not say, tick or count. Each of these was found by a review of
// the steps as built, and each holds one rule that no scenario held before.
//
//   1. the drill, with its screen left for another site and brought back
//      whole by the browser's Back after the wallet was removed in a page
//      loaded since: nothing is ticked for a wallet that is not here
//   2. the drill, with the wallet out of the browser: "Start this step
//      again" is not offered; and a step that finds no wallet says where a
//      wallet a reader already has comes back, beside "Hold some" for a
//      step from the list and beside Create for one opened by its card
//   3. the drill for a wallet with no paper copy: the part names "The
//      seed", and says so when the check was made there; with "The seed"
//      done for another wallet the drill asks, and names the Backup screen
//   4. the drill, with the first part ticked for one wallet and another
//      wallet removed while the step is followed: the removal is not the
//      one the step waits for
//   5. "Pass it on" after "Send another": a payment that is not to the pot
//      is not noted
//   6. on a phone the strip says what is missing, what it waits for, and
//      "restore", in the place of "3 of 4"
//   7. a passkey wallet unlocked inside the three-word check: focus goes to
//      the first field, and the wallet is locked again when the check is done
//   8. a note that follows a step it never started draws no strip; a noted
//      payment dated ahead of the clock is said to be lost, with "Send another"
//   9. "Forget my progress" in a second tab under an open step: back in
//      view, the step is started again and can be done
//  10. a done drill for a wallet that was opened with a passkey: no heading
//      level is jumped, and its screen asks the practice network nothing
//  11. "Hold some", with the reader back from the faucet before the chain's
//      index lists the payment: the step sees the coin arrive with no
//      block, and is done when the block comes
//
// All are local only: they pay a wallet from the stand-in, or store a note
// that stands in the middle of a step.

import assert from 'node:assert/strict';
import { stepDef } from '../../app/src/lib/doit/steps.ts';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { OTHER_WORDS, freshRecord, fundTestWallet, scenario, testRecord, type OpenedPage } from './helpers.ts';
import { arrivesAt, attributeOf, botCheckScripts, countOf, createFrom, focusOf, hook, sleep, standBy, storedRecord, until, untilAnswersCount, untilPhase } from './journey-helpers.ts';
import {
  PROGRESS_KEY,
  act,
  begin,
  doIt,
  ends,
  focusedPlace,
  hrefOf,
  noteFor,
  noteOf,
  noteText,
  partName,
  partsOf,
  pay,
  removeHere,
  restoreHere,
  saidDone,
  section,
  stepsCounted,
  storedIsPublic,
  stripBack,
  stripOf,
  titleOf,
  typeThree,
  untilParts,
  untilStrip,
  view,
} from './doit-helpers.ts';

const en = strings.doit.en;
const es = strings.doit.es;

const DRILL = 'prove-the-backup';
const SEED = 'the-seed';
const KEYS_PAGE = '/journey/be-your-own-bank';

/** The words of a wallet made without a passkey, as its record keeps them. */
function wordsOf(record: { mnemonic?: string }): string[] {
  assert.ok(record.mnemonic !== undefined);
  return record.mnemonic.split(' ');
}

/** Every link inside the open part, by the address it leads to. */
const linksInOpenPart = (page: OpenedPage): Promise<(string | null)[]> =>
  page.page.$$eval(`${hook('step-open')} a`, (links) => links.map((link) => link.getAttribute('href')));

/** A mark put on the document that is showing: a page the browser brings back whole still carries it, a page loaded anew does not. */
const markDocument = (page: OpenedPage, mark: string): Promise<void> =>
  page.page.evaluate((value) => {
    (window as unknown as { __doitKept?: string }).__doitKept = value;
  }, mark);

const documentMark = (page: OpenedPage): Promise<string | null> =>
  page.page.evaluate(() => (window as unknown as { __doitKept?: string }).__doitKept ?? null).catch(() => null);

scenario(
  'Prove the backup, with its screen left for another site and brought back by the browser\'s Back after the wallet was removed in a page loaded since: nothing is ticked for a wallet that is not here, the one way on is Restore, and the step is done only once the wallet is back',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const record = freshRecord();
    const words = wordsOf(record);
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const elsewhere = await s.openElsewhere();
    const there = await elsewhere.page.evaluate(() => location.origin);
    // The drill as an earlier visit left it: the paper checked for this wallet, and the step followed.
    const stored = noteFor({ following: DRILL, followedAt: Date.now(), steps: { [DRILL]: { started: true, wallet: record.fingerprint, was: 'words', parts: { 1: true } } } });
    const reader = await begin(s, `/do/${DRILL}`, { record, storage: { [PROGRESS_KEY]: stored }, allow: [there] });
    const { page } = reader;
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    // The reader stays a moment: the wallet's first look at its coins is over before they leave.
    await page.settle();
    await page.waitFor('step-action');
    await markDocument(page, 'the first step page');

    // -- Away in the same tab, as "Back to the chapter" goes; and from there to the step again: a new document. --
    await page.page.goto(`${there}/chapter`, { waitUntil: 'load' });
    await page.page.goto(`${s.url}/do/${DRILL}?from=${KEYS_PAGE}`, { waitUntil: 'load' });
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.equal(await documentMark(page), null, 'the step opened from the chapter is a page loaded anew');

    // -- In that page the wallet is removed, while the step is followed: its second part ticks. --
    await act(page, '/wallet/settings');
    await removeHere(page);
    assert.equal(await storedRecord(page), null);
    assert.deepEqual((await noteOf(page))?.steps[DRILL]?.parts, { 1: true, 2: true });

    // -- The browser's Back, as far as the first step page: Home, Settings, the step, the other site, and there it is. --
    await page.page.evaluate(() => history.go(-4)).catch(() => {});
    await until(async () => (await documentMark(page)) === 'the first step page', 'the browser brought the first step page back as it was');
    assert.equal(await page.page.evaluate(() => location.pathname), `/do/${DRILL}`);
    // That page remembers a wallet. What is stored says there is none, and the page goes by what is stored.
    await untilParts(page, ['ticked', 'ticked', 'now', 'later']);
    await sleep(2_000);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'now', 'later'], 'no part ticks for a wallet that is not in the browser');
    assert.equal(await countOf(page, 'step-done'), 0);
    assert.equal(await page.text('step-action'), en.actRestore);
    assert.deepEqual(await linksInOpenPart(page), ['/restore']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${KEYS_PAGE}#do-${DRILL}`, 'the way back does not say "done"');
    assert.deepEqual(stepsCounted(s), {}, 'nothing was counted as done');
    assert.equal((await noteOf(page))?.steps[DRILL]?.doneAt, undefined);
    assert.ok(!page.statusLog().includes(saidDone(DRILL)), page.statusLog().join(' | '));

    // -- From that page the drill goes on as it should: restored from the 12 words, it is done, and counted once. --
    await act(page, '/restore');
    await restoreHere(page, words);
    await page.waitFor('overview-restored');
    await untilStrip(page, DRILL, 'done');
    assert.equal(await hrefOf(page, 'strip-chapter'), `${site}${KEYS_PAGE}#done=${DRILL}`);
    assert.deepEqual(stepsCounted(s), { [DRILL]: 1 });

    await ends(
      s,
      reader,
      [
        view(`/do/${DRILL}`),
        view(`/do/${DRILL}`),
        view('/wallet/settings'),
        { name: 'Wallet removed', path: '/wallet/settings', value: 'words' },
        view('/'),
        view('/restore'),
        { name: 'Restore', path: '/restore', value: 'found' },
        doIt('/restore', DRILL),
        view('/wallet'),
      ],
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [funding] },
    );
  },
);

scenario(
  'The drill with its wallet out of the browser offers no "Start this step again", and Restore is the one link of its open part; forgotten in that state and opened again from the list, it names "Hold some" and says where a wallet the reader already has comes back, and so does every step from the list that finds no wallet; opened by its card, each of the five steps that need a wallet names Create, with the same line under it',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const record = freshRecord();
    const words = wordsOf(record);
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const stored = noteFor({ following: DRILL, followedAt: Date.now(), steps: { [DRILL]: { started: true, wallet: record.fingerprint, was: 'words', parts: { 1: true } } } });
    const reader = await begin(s, `/do/${DRILL}`, { record, storage: { [PROGRESS_KEY]: stored } });
    const { page } = reader;
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    // Before the removal the step can be started again, like any step under way.
    assert.deepEqual([await countOf(page, 'step-restart'), await countOf(page, 'step-stop')], [1, 1]);

    // -- The wallet is removed. The note is now all that says which wallet has to come back. --
    await act(page, '/wallet/settings');
    await removeHere(page);
    await stripBack(page, DRILL);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'now', 'later']);
    assert.equal(await countOf(page, 'step-restart'), 0, 'starting again would erase which wallet was removed, and lead to making a new one');
    assert.equal(await countOf(page, 'step-stop'), 1, '"Stop following" stays');
    assert.ok(!(await page.page.$eval('main', (main) => main.textContent ?? '')).includes(en.restartNote));
    assert.deepEqual(await linksInOpenPart(page), ['/restore'], 'the one action offered is Restore, never Create');

    // -- "Forget my progress", in that same state: the step is started afresh, with no wallet here. --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    // What the list says of its note is held against the note and against what this page has sent so far. The
    // note does hold a wallet fingerprint, as the line says a note can; the note is in no request; and the
    // opening of the step's screen was counted (About lists it), so the list does not say "nothing is sent".
    assert.ok((await page.page.$eval('main', (main) => (main.textContent ?? '').replace(/\s+/g, ' '))).includes(en.forgetWhat));
    assert.match(en.forgetWhat, /^This browser keeps a note of your progress: .*, such as a wallet fingerprint and a payment it waits for\. The About page lists it all\. /);
    assert.match(en.forgetWhat, /The note itself is never sent to us\. While counting is on, opening a step's screen and finishing a step are counted; the About page says whether it is on\.$/);
    assert.equal((await noteOf(page))?.steps[DRILL]?.wallet, record.fingerprint);
    const sent = reader.requests().map((request) => request.body);
    assert.ok(sent.includes(JSON.stringify(view(`/do/${DRILL}`))), sent.join(' '));
    for (const body of sent) assert.ok(!body.includes(record.fingerprint) && !body.includes('"parts"'), body);
    await page.click('do-forget');
    await page.waitFor('do-forget-confirm');
    await untilAnswersCount();
    await page.click('do-forget-confirm');
    await page.waitFor('do-forgotten');
    assert.equal(await noteText(page), null);
    for (const id of [DRILL, 'pass-it-on', SEED] as const) {
      await page.page.locator(`${hook('do-step-link')}[data-step="${id}"]`).click();
      await arrivesAt(page, `/do/${id}`);
      await page.waitFor('step-need');
      assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-wallet', id);
      assert.ok((await page.text('step-need')).startsWith(en['need_no-wallet']), id);
      // The main link: "Hold some", the step that gives a wallet (SPEC-A3 2.2).
      assert.equal(await page.text('step-need-link'), fill(en.actStep, { step: titleOf('hold-some') }), id);
      assert.equal(await hrefOf(page, 'step-need-link'), '/do/hold-some', id);
      // Beside it, for a reader whose wallet is on paper or behind a passkey: Home, where it is opened or restored.
      assert.equal(await page.text('step-need-also'), `${en.needHadOne} ${en.needHadOneLink}`, id);
      assert.equal(await hrefOf(page, 'step-need-also-link'), '/', id);
      await page.click('step-list');
      await arrivesAt(page, '/do');
    }
    // -- The same steps opened by their cards, from their own chapter's page, and the two others that need a
    //    wallet: a reader who came from a chapter is not sent through "Hold some". Each names Create, the
    //    screen that makes a wallet, and under it the same line on a wallet the reader already has. --
    const byCard = ['pass-it-on', 'no-balances', 'waiting-room', SEED, DRILL] as const;
    for (const id of byCard) {
      await page.goto(`/do/${id}?from=${stepDef(id).chapter.path.en}`);
      await page.waitFor('step-need');
      assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-wallet', id);
      assert.ok((await page.text('step-need')).startsWith(en['need_no-wallet']), id);
      assert.equal(await page.text('step-need-link'), en.actCreate, id);
      assert.equal(await hrefOf(page, 'step-need-link'), '/new', id);
      assert.equal(await page.page.$$eval('main a[href$="/do/hold-some"]', (links) => links.length), 0, `${id}: no link to "Hold some"`);
      assert.equal(await page.text('step-need-also'), `${en.needHadOne} ${en.needHadOneLink}`, id);
      assert.equal(await hrefOf(page, 'step-need-also-link'), '/', id);
    }
    assert.doesNotMatch((await noteText(page)) ?? '', /hold-some|cameFor/);
    await page.click('step-list');
    await arrivesAt(page, '/do');

    // -- That way on, taken: Home offers Restore, and the wallet comes back with its coins. --
    await page.page.locator(`${hook('do-step-link')}[data-step="${DRILL}"]`).click();
    await arrivesAt(page, `/do/${DRILL}`);
    await page.click('step-need-also-link');
    await arrivesAt(page, '/');
    await page.click('home-restore');
    await arrivesAt(page, '/restore');
    await restoreHere(page, words);
    await page.waitFor('overview-restored');
    assert.equal((await storedRecord(page))?.fingerprint, record.fingerprint);
    // The step was started again from nothing, so it asks for the paper again: nothing of the first try is left.
    await stripBack(page, DRILL);
    await untilParts(page, ['now', 'later', 'later', 'later']);
    assert.equal(await countOf(page, 'step-word'), 3);
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [
        view(`/do/${DRILL}`),
        view('/wallet/settings'),
        { name: 'Wallet removed', path: '/wallet/settings', value: 'words' },
        view('/'),
        view(`/do/${DRILL}`),
        view('/do'),
        view(`/do/${DRILL}`),
        view('/do'),
        view('/do/pass-it-on'),
        view('/do'),
        view(`/do/${SEED}`),
        view('/do'),
        // The five steps, each opened by its card.
        view('/do/pass-it-on'),
        view('/do/no-balances'),
        view('/do/waiting-room'),
        view(`/do/${SEED}`),
        view(`/do/${DRILL}`),
        view('/do'),
        view(`/do/${DRILL}`),
        view('/'),
        view('/restore'),
        { name: 'Restore', path: '/restore', value: 'found' },
        view('/wallet'),
        view(`/do/${DRILL}`),
      ],
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [funding] },
    );
  },
);

scenario(
  'The drill for a wallet with no paper copy names "The seed" beside its three fields; with that step done for this wallet, the drill finds its paper check ticked and says where it was made',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const record = freshRecord();
    const words = wordsOf(record);
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const reader = await begin(s, `/do/${DRILL}`, { record });
    const { page } = reader;
    await untilParts(page, ['now', 'later', 'later', 'later']);
    // The guidance is as it was. Under it: where a paper copy is made, for a reader who has none.
    assert.equal(await page.text('step-guide'), en['guide_prove-the-backup_1']);
    assert.equal(await page.text('step-paper'), `${fill(en.paperNone, { step: titleOf(SEED) })} ${fill(en.actStep, { step: titleOf(SEED) })}`);
    assert.equal(await hrefOf(page, 'step-paper-link'), `/do/${SEED}`);
    assert.equal(await countOf(page, 'step-word'), 3, 'a reader who has the paper can go straight on');
    assert.equal(await countOf(page, 'step-checked-in-seed'), 0);

    // -- "The seed", by that link: the 12 words shown, the reader's word, three of them checked. --
    await page.click('step-paper-link');
    await arrivesAt(page, `/do/${SEED}`);
    await untilParts(page, ['now', 'later', 'later']);
    assert.equal(await countOf(page, 'step-paper'), 0, 'its own check comes straight after its own writing down');
    await act(page, '/wallet/backup');
    await page.click('reveal-words');
    await untilStrip(page, SEED, 'part');
    await stripBack(page, SEED);
    await page.click('step-said');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    await typeThree(page, words);
    await page.click('step-words-check');
    await page.waitFor('step-done');

    // -- Back on the drill: the paper is the same paper. Ticked on arrival, and the part says where it was checked. --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    await page.page.locator(`${hook('do-step-link')}[data-step="${DRILL}"]`).click();
    await arrivesAt(page, `/do/${DRILL}`);
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.equal(await page.text('step-checked-in-seed'), fill(en.checkedInSeed, { step: titleOf(SEED) }));
    assert.equal(await page.page.$eval(hook('step-checked-in-seed'), (line) => line.closest('[data-testid="step-part"]')?.getAttribute('data-part')), '1');
    assert.equal(await countOf(page, 'step-paper'), 0);
    assert.deepEqual((await noteOf(page))?.steps[DRILL], { started: true, wallet: record.fingerprint, was: 'words', parts: { 1: true } });

    await ends(
      s,
      reader,
      [
        view(`/do/${DRILL}`),
        view(`/do/${SEED}`),
        view('/wallet/backup'),
        { name: 'Words shown', path: '/wallet/backup', value: 'words' },
        view(`/do/${SEED}`),
        doIt(`/do/${SEED}`, SEED),
        view('/do'),
        view(`/do/${DRILL}`),
      ],
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [funding] },
    );
  },
);

scenario(
  'With "The seed" done for one wallet and another wallet in the browser, the drill asks for three words of the wallet that is here, and names the Backup screen for a reader with no paper copy of it',
  { localOnly: true, timeout: 120_000 },
  async (s) => {
    const first = testRecord();
    const second = testRecord(OTHER_WORDS);
    const words = OTHER_WORDS.split(' ');
    const funding = s.standIn.fund(second.firstAddress, 80_000);
    // "The seed", done on an earlier visit, for the first wallet.
    const stored = noteFor({ following: null, steps: { [SEED]: { started: true, doneAt: Date.now() - 60_000, wallet: first.fingerprint, parts: { 1: true, 2: true, 3: true } } } });
    const reader = await begin(s, `/do/${DRILL}`, { record: second, storage: { [PROGRESS_KEY]: stored } });
    const { page } = reader;
    // The check passed for another wallet proves nothing about this one's paper: the part is open, and asks.
    await untilParts(page, ['now', 'later', 'later', 'later']);
    await sleep(1_000);
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later', 'later']);
    assert.equal(await countOf(page, 'step-word'), 3);
    assert.equal(await countOf(page, 'step-checked-in-seed'), 0);
    // "The seed" shows no words any more: the Backup screen does.
    assert.equal(await page.text('step-paper'), `${en.paperNoneHere} ${en.actBackup}`);
    assert.equal(await hrefOf(page, 'step-paper-link'), '/wallet/backup');
    assert.deepEqual((await noteOf(page))?.steps[DRILL], { started: true });

    // Three words of the wallet that is here: checked on this screen, and the note names this wallet.
    await typeThree(page, words);
    await page.click('step-words-check');
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.deepEqual((await noteOf(page))?.steps[DRILL], { started: true, wallet: second.fingerprint, was: 'words', parts: { 1: true } });
    assert.equal(await countOf(page, 'step-checked-in-seed'), 0, 'it was checked here, not in "The seed"');
    assert.equal((await noteOf(page))?.steps[SEED]?.wallet, first.fingerprint);

    await ends(s, reader, [view(`/do/${DRILL}`)], { records: [first, second], words: [words], addresses: [second.firstAddress], txids: [funding] });
  },
);

scenario(
  'The drill with its paper checked for one wallet, and another wallet removed from the browser while the step is followed: that removal is not the one the step waits for, and its second part stays open',
  { localOnly: true, timeout: 120_000 },
  async (s) => {
    const first = testRecord();
    const second = testRecord(OTHER_WORDS);
    const funding = s.standIn.fund(second.firstAddress, 80_000);
    const stored = noteFor({ following: DRILL, followedAt: Date.now(), steps: { [DRILL]: { started: true, wallet: first.fingerprint, was: 'words', parts: { 1: true } } } });
    const reader = await begin(s, `/do/${DRILL}`, { record: second, storage: { [PROGRESS_KEY]: stored } });
    const { page } = reader;
    await untilParts(page, ['ticked', 'blocked', 'later', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'another-wallet');
    const need = await page.text('step-need');
    assert.ok(need.includes(second.fingerprint) && need.includes(first.fingerprint), need);
    assert.equal(await countOf(page, 'step-need-link'), 0);

    // The wallet that is here is removed, by the wallet's own screens, with the step still the one followed.
    await page.goto('/wallet/settings');
    await page.waitFor('remove-wallet');
    assert.equal((await noteOf(page))?.following, DRILL);
    await removeHere(page);
    assert.equal(await storedRecord(page), null);
    // The step named another wallet. Nothing ticked, and the strip does not ask for a restore.
    assert.deepEqual((await noteOf(page))?.steps[DRILL], { started: true, wallet: first.fingerprint, was: 'words', parts: { 1: true } });
    const strip = await untilStrip(page, DRILL, 'need');
    assert.equal(strip.words, en['stripNeed_no-wallet']);
    await stripBack(page, DRILL);
    assert.deepEqual(await partsOf(page), ['ticked', 'blocked', 'later', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-wallet');
    assert.ok((await page.text('step-need')).startsWith(en.needRemovedElsewhere));
    assert.equal(await hrefOf(page, 'step-need-link'), '/');
    assert.equal(await countOf(page, 'step-restart'), 1, 'nothing the step removed is out of the browser: it can be started again');
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [view(`/do/${DRILL}`), view('/wallet/settings'), { name: 'Wallet removed', path: '/wallet/settings', value: 'words' }, view('/'), view(`/do/${DRILL}`)],
      { records: [first, second], words: [OTHER_WORDS.split(' ')], addresses: [second.firstAddress], txids: [funding] },
    );
  },
);

scenario(
  '"Pass it on" after "Send another": a payment to an address that is not the pot\'s is not noted, and the step goes on only with one to the pot',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const STEP = 'pass-it-on';
    const record = testRecord();
    const funded = fundTestWallet(s.standIn);
    const somebody = testRecord(OTHER_WORDS).firstAddress;
    // The step as an earlier visit left it: a payment noted that the practice network does not know (the chain was started again since).
    const gone = 'ab'.repeat(32);
    const stored = noteFor({ following: STEP, followedAt: Date.now(), steps: { [STEP]: { started: true, tx: gone, sentAt: Date.now() - 200_000, parts: { 1: true, 2: true } } } });
    const reader = await begin(s, `/do/${STEP}`, { record, storage: { [PROGRESS_KEY]: stored } });
    const { page } = reader;
    await untilParts(page, ['ticked', 'ticked', 'now']);
    await page.waitFor('step-send-another');
    assert.equal(await attributeOf(page, 'step-waiting', 'data-lost'), 'yes');

    // -- "Send another": the note lets go of the payment, and the part waits for a new one. --
    await page.click('step-send-another');
    await untilParts(page, ['ticked', 'ticked', 'blocked']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'nothing-sent');
    assert.deepEqual((await noteOf(page))?.steps[STEP], { started: true, parts: { 1: true, 2: true } });

    // -- A payment to somebody: sent while the step is followed, and not to the pot. It is not the step's payment. --
    await act(page, '/wallet/send', { hook: 'step-need-link' });
    const other = await pay(page, somebody, '10,000');
    await page.settle();
    assert.deepEqual((await noteOf(page))?.steps[STEP], { started: true, parts: { 1: true, 2: true } }, 'a payment that is not to the pot is not noted');
    await stripBack(page, STEP);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'blocked']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'nothing-sent');

    // -- A payment to the pot: noted, waited for, and with its block the step is done. --
    await act(page, '/wallet/send', { hook: 'step-need-link' });
    const paid = await pay(page, 'pot', '20,000');
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal((await noteOf(page))?.steps[STEP]?.tx, paid.txid);
    assert.equal(await attributeOf(page, 'step-waiting', 'data-lost'), 'no');
    s.standIn.mine();
    await page.waitFor('step-done');
    assert.deepEqual(stepsCounted(s), { [STEP]: 1 });

    await ends(
      s,
      reader,
      [
        view(`/do/${STEP}`),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent' },
        view(`/do/${STEP}`),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view(`/do/${STEP}`),
        doIt(`/do/${STEP}`, STEP),
      ],
      { records: [record], words: [wordsOf(record)], addresses: [...funded.map((coin) => coin.address), somebody, other.to, paid.to], txids: [...funded.map((coin) => coin.txid), other.txid, paid.txid, gone] },
    );
  },
);

// -- the strip on a phone ------------------------------------------------------------------------------

/** The narrow form of the strip: its words, and whether it is drawn (from 480 px on it is not). */
const shortOf = (page: OpenedPage): Promise<{ text: string; shown: boolean; wide: boolean }> =>
  page.page.$eval(hook('strip'), (strip) => {
    const short = strip.querySelector('[data-testid="strip-short"]');
    const says = strip.querySelector('[data-testid="strip-says"]');
    const shown = (node: Element | null | undefined): boolean => node != null && getComputedStyle(node).display !== 'none';
    return { text: (short?.textContent ?? '').replace(/\s+/g, ' ').trim(), shown: shown(short), wide: shown(says?.parentElement) };
  });

for (const { lang, width, prefix } of [
  { lang: 'en', width: 375, prefix: '' },
  { lang: 'es', width: 320, prefix: '/es' },
] as const) {
  const t = strings.doit[lang];
  scenario(
    `On a phone ${width} px wide (${lang}), the strip says what is missing, what it waits for and "restore" in the place of "3 of 4", keeps to "2 of 3" where the reader can simply go on, and never makes the page wider than the phone`,
    { localOnly: true, timeout: 200_000 },
    async (s) => {
      const POT = 'pass-it-on';
      const record = freshRecord();
      const words = wordsOf(record);
      const reader = await begin(s, `${prefix}/do/${POT}`, { record, width, lang });
      const { page } = reader;
      const fits = async (where: string): Promise<void> => assert.equal(await page.sidewaysScroll(), 0, `${where}: the page is wider than the phone`);

      // -- Something is missing first: no coins. On the wallet's own screen the strip says so, not "1 of 3". --
      await untilParts(page, ['blocked', 'later', 'later']);
      await page.goto(`${prefix}/wallet`);
      const need = await untilStrip(page, POT, 'need');
      assert.deepEqual(await shortOf(page), { text: t['stripNeed_no-coins'], shown: true, wide: false });
      assert.ok(need.text.startsWith(`${titleOf(POT, lang)} ${t['stripNeed_no-coins']} ${t.stripBack}`), need.text);
      await fits('a need');

      // -- Coins arrive and confirm: the reader can simply go on, and the strip keeps to how far the step is. --
      const funding = s.standIn.fund(record.firstAddress, 100_000);
      await page.goto(`${prefix}/wallet`);
      await page.waitFor('coin');
      await until(async () => (await stripOf(page))?.says === 'part', 'the strip names the part again');
      assert.deepEqual(await shortOf(page), { text: fill(t.stripShort, { n: '2', m: '3' }), shown: true, wide: false });

      // -- A payment to the pot. On the Overview, where the wait is read, the strip says the wait. --
      await section(page, `${prefix}/wallet/send`);
      const paid = await pay(page, 'pot', '30,000', prefix);
      await section(page, `${prefix}/wallet`);
      const waiting = await untilStrip(page, POT, 'waiting');
      const wait = await shortOf(page);
      assert.deepEqual([wait.shown, wait.wide], [true, false]);
      assert.ok(wait.text.startsWith(t.stripWaiting.slice(0, t.stripWaiting.indexOf('{'))), wait.text);
      assert.ok(waiting.text.startsWith(`${titleOf(POT, lang)} ${wait.text}`), waiting.text);
      await fits('a wait');

      // -- The drill, with its wallet removed: on Home, whose main button makes a new wallet, the strip says "restore". --
      await page.store(PROGRESS_KEY, noteFor({ following: DRILL, followedAt: Date.now(), steps: { [DRILL]: { started: true, wallet: record.fingerprint, was: 'words', parts: { 1: true } } } }));
      await page.goto(`${prefix}/wallet/settings`);
      await page.waitFor('remove-wallet');
      await removeHere(page, prefix);
      const restore = await untilStrip(page, DRILL, 'part');
      assert.deepEqual(await shortOf(page), { text: partName(DRILL, 3, lang), shown: true, wide: false });
      assert.ok(restore.text.startsWith(`${titleOf(DRILL, lang)} ${partName(DRILL, 3, lang)}`), restore.text);
      assert.equal(await countOf(page, 'home-create'), 1, 'the screen under it offers to make a wallet');
      // Both links of the strip are whole, each on one line, and the cross that stops following is beside the words.
      const lines = await page.page.$eval(hook('strip'), (strip) => {
        const back = strip.querySelector('[data-testid="strip-back"]')!.getBoundingClientRect();
        const stop = strip.querySelector('[data-testid="strip-stop"]')!.getBoundingClientRect();
        const words = strip.querySelector('p')!.getBoundingClientRect();
        return { backLines: Math.round(back.height / 20), stopInside: stop.right <= window.innerWidth && stop.left >= words.right - 1, backUnderWords: back.top >= words.bottom - 1 };
      });
      assert.deepEqual(lines, { backLines: 1, stopInside: true, backUnderWords: true });
      await fits('"restore", on Home');

      await ends(
        s,
        reader,
        [
          view(`${prefix}/do/${POT}`),
          view(`${prefix}/wallet`),
          view(`${prefix}/wallet`),
          view(`${prefix}/wallet/send`),
          { name: 'Payment', path: `${prefix}/wallet/send`, value: 'sent-to-pot' },
          view(`${prefix}/wallet`),
          view(`${prefix}/wallet/settings`),
          { name: 'Wallet removed', path: `${prefix}/wallet/settings`, value: 'words' },
          view(prefix === '' ? '/' : prefix),
        ],
        { records: [record], words: [words], addresses: [record.firstAddress, paid.to], txids: [funding, paid.txid] },
      );
    },
  );
}

// -- a passkey wallet, unlocked inside the three-word check ---------------------------------------------------

scenario(
  'A passkey wallet unlocked inside the three-word check: focus goes to the first of the three fields, and when the check is done the wallet is locked again, so that the Backup screen asks for the passkey before it shows a word',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    void s.standIn;
    const common = strings.common.en;
    const reader = await begin(s, '/new', { passkey: 'prf', width: 375 });
    const { page } = reader;
    await page.waitFor('create-passkey');
    const made = await createFrom(page, 'create-passkey');
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    // "The seed" as an earlier visit left it, with its first two parts ticked. Then a page load, which locks the wallet.
    await page.store(PROGRESS_KEY, noteFor({ following: SEED, followedAt: Date.now(), steps: { [SEED]: { started: true, parts: { 1: true, 2: true } } } }));
    await page.goto(`/do/${SEED}`);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    await page.page.bringToFront();
    const uses = async (): Promise<number> => (await page.passkey!.credentials()).reduce((sum, each) => sum + each.uses, 0);
    const before = await uses();

    // -- The shared unlock step stands where the three fields will be. Unlocked, the fields take its place, and focus with them. --
    await page.waitFor('unlock');
    assert.equal(await countOf(page, 'step-word'), 0);
    await page.click('unlock');
    await page.waitFor('step-word');
    await until(async () => (await focusOf(page)) === 'step-word', 'focus is on a word field');
    const places = await page.page.$$eval(hook('step-word'), (fields) => fields.map((field) => Number(field.getAttribute('data-place'))));
    assert.equal(await focusedPlace(page), places[0], 'the first of the three');
    // It stays there: the unlock step's own move to the heading comes first, and does not take it back.
    await sleep(500);
    assert.equal(await focusedPlace(page), places[0]);
    // And the field is on screen: the reader does not have to look for what they unlocked for.
    const seen = await page.page.$eval(`${hook('step-word')}:focus`, (field) => {
      const box = field.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight;
    });
    assert.equal(seen, true, 'the focused field is inside the window');
    assert.equal(await uses(), before + 1, 'one prompt');

    // -- A wrong word first: the wallet stays unlocked for the next try. --
    await typeThree(page, ['zoo', 'zoo', 'zoo', 'zoo', 'zoo', 'zoo', 'zoo', 'zoo', 'zoo', 'zoo', 'zoo', 'zoo']);
    await page.click('step-words-check');
    await page.waitFor('step-words-wrong');
    assert.equal(await countOf(page, 'unlock'), 0);
    await typeThree(page, made.words);
    await page.click('step-words-check');
    await page.waitFor('step-done');
    assert.equal(await uses(), before + 1, 'no second prompt');

    // -- The check is done, and the keys this screen loaded are dropped: in the same page, Backup is locked again. --
    await page.page.evaluate(() => {
      history.pushState({}, '', '/wallet/backup');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitFor('lock-state');
    assert.ok((await page.text('lock-state')).startsWith(common.stateLocked), await page.text('lock-state'));
    assert.equal(await countOf(page, 'lock'), 0, 'nothing to lock');
    assert.equal(await countOf(page, 'word'), 0, 'no word is on screen');
    // "Show the 12 words" leads to the unlock step, not to the words.
    await page.click('reveal-words');
    await page.waitFor('backup-unlock');
    assert.equal(await countOf(page, 'unlock'), 1, 'showing the 12 words asks for the passkey first');
    assert.equal(await countOf(page, 'word'), 0);
    assert.equal(await uses(), before + 1);

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
        view(`/do/${SEED}`),
        { name: 'Unlock', path: `/do/${SEED}`, value: 'same' },
        doIt(`/do/${SEED}`, SEED),
        view('/wallet/backup'),
      ],
      { records: [made.record], words: [made.words], addresses: [made.record.firstAddress], txids: [] },
    );
  },
);

// -- notes that this page did not write as they stand ----------------------------------------------------------

scenario(
  'A note that follows a step it never started draws no strip and says nothing; a noted payment dated ahead of the clock is said to be lost, with "Send another", and not waited for without end',
  { localOnly: true, timeout: 120_000 },
  async (s) => {
    const STEP = 'waiting-room';
    const record = testRecord();
    const funded = fundTestWallet(s.standIn);
    const followed = JSON.stringify({ v: 1, following: 'hold-some', followedAt: Date.now(), steps: {} });
    const reader = await begin(s, '/wallet', { record, storage: { [PROGRESS_KEY]: followed } });
    const { page } = reader;
    await page.waitFor('coin');
    await page.settle();
    await sleep(1_000);
    assert.equal(await stripOf(page), null, 'no strip for a step that was never started');
    assert.deepEqual(page.statusLog().filter((said) => said.includes(titleOf('hold-some'))), [], 'and nothing is said of it');
    assert.equal(await noteText(page), followed, 'the note is as it was');
    assert.deepEqual(stepsCounted(s), {});

    // -- A payment noted for a moment an hour ahead of the clock, which the wallet's list does not hold. --
    const gone = 'ab'.repeat(32);
    await page.store(PROGRESS_KEY, noteFor({ following: STEP, followedAt: Date.now(), steps: { [STEP]: { started: true, tx: gone, sentAt: Date.now() + 3_600_000, parts: { 1: true } } } }));
    await page.goto(`/do/${STEP}`);
    await untilParts(page, ['ticked', 'now', 'later']);
    await page.waitFor('step-send-another');
    assert.equal(await attributeOf(page, 'step-waiting', 'data-lost'), 'yes');
    assert.equal(await countOf(page, 'step-unknown'), 0);
    assert.equal(await countOf(page, 'step-waiting-sent'), 0, 'a time ahead of the clock is not said as "sent ... ago"');
    // On the Overview the strip says the same.
    await page.goto('/wallet');
    assert.equal((await untilStrip(page, STEP, 'lost')).words, en.stripLost);
    // And the way on works: the payment is let go of, and the part asks for a new one.
    await stripBack(page, STEP);
    await page.click('step-send-another');
    await untilParts(page, ['ticked', 'blocked', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'nothing-sent');

    await ends(
      s,
      reader,
      [view('/wallet'), view(`/do/${STEP}`), view('/wallet'), view(`/do/${STEP}`)],
      { records: [record], words: [wordsOf(record)], addresses: funded.map((coin) => coin.address), txids: [...funded.map((coin) => coin.txid), gone] },
    );
  },
);

// -- "Forget my progress" in another tab -----------------------------------------------------------------------------

scenario(
  '"Forget my progress" in a second tab while a step is open in the first: back in view, the first tab\'s step is started again, shows what can be done, and can be done',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const STEP = 'pass-it-on';
    const FROM = '/journey/how-bitcoin-works';
    const record = testRecord();
    const funded = fundTestWallet(s.standIn);
    const first = await begin(s, `/do/${STEP}?from=${FROM}`, { record });
    await untilParts(first.page, ['ticked', 'now', 'later']);

    // -- A second tab of the same browser comes to the front, and the reader forgets the lot there. --
    const tab = await standBy(s, { context: first.page.context, timeout: 30_000 });
    await tab.goto('/do');
    await tab.page.bringToFront();
    await tab.click('do-forget');
    await tab.waitFor('do-forget-confirm');
    await untilAnswersCount();
    await tab.click('do-forget-confirm');
    await tab.waitFor('do-forgotten');
    // The first tab lies hidden, with the step's screen open. It has heard of it, and does not undo it.
    await sleep(1_000);
    assert.equal(await noteText(tab), null, 'forgotten stays forgotten while nobody looks at the step');

    // -- Back on the first tab: the step's screen is what starts a step. It is started again, with its way back. --
    await first.page.page.bringToFront();
    await untilParts(first.page, ['ticked', 'now', 'later']);
    assert.equal(await first.page.text('step-action'), en.actSend);
    assert.deepEqual([await countOf(first.page, 'step-restart'), await countOf(first.page, 'step-stop')], [1, 1]);
    const note = await noteOf(first.page);
    assert.deepEqual(note?.steps[STEP], { started: true, from: FROM, parts: { 1: true } });
    assert.equal(note?.following, STEP);

    // -- And it can be done from there. --
    await act(first.page, '/wallet/send');
    const paid = await pay(first.page, 'pot', '30,000');
    await stripBack(first.page, STEP);
    await untilParts(first.page, ['ticked', 'ticked', 'now']);
    s.standIn.mine();
    await first.page.waitFor('step-done');
    assert.deepEqual(stepsCounted(s), { [STEP]: 1 });
    await first.page.settle();
    await tab.settle();
    await storedIsPublic(first.page, { records: [record], words: [wordsOf(record)], addresses: [...funded.map((coin) => coin.address), paid.to], txids: [...funded.map((coin) => coin.txid), paid.txid] });
  },
);

// -- headings ---------------------------------------------------------------------------------------------------------

scenario(
  'A done step\'s screen has its headings in order: the done card is found by its heading, and "What the restore changed" stands one level under it; and it asks the practice network nothing, block or no block',
  { localOnly: true, timeout: 120_000 },
  async (s) => {
    const record = testRecord();
    const funded = fundTestWallet(s.standIn);
    // The drill, done on an earlier visit for a wallet that was opened with a passkey before it.
    const done = Date.now() - 60_000;
    const stored = noteFor({ following: null, steps: { [DRILL]: { started: true, doneAt: done, was: 'passkey', parts: { 1: true, 2: true, 3: true, 4: true } } } });
    const reader = await begin(s, `/do/${DRILL}`, { record, storage: { [PROGRESS_KEY]: stored } });
    const { page } = reader;
    await page.waitFor('step-changed');
    const headings = await page.page.$$eval('main h1, main h2, main h3, main h4, main h5, main h6', (found) =>
      found.map((heading) => ({ level: Number(heading.tagName.slice(1)), text: (heading.textContent ?? '').replace(/\s+/g, ' ').trim(), hook: heading.getAttribute('data-testid') })),
    );
    assert.deepEqual(
      headings.slice(0, 4).map((heading) => [heading.level, heading.text]),
      [
        [1, en['title_prove-the-backup']],
        [2, await page.text('step-done-on')],
        [3, en.changedTitle],
        [2, en.partsTitle],
      ],
    );
    assert.equal(headings[1]?.hook, 'step-done-on');
    // No level is jumped anywhere on the screen: a heading is at most one level deeper than the one before it.
    for (const [at, heading] of headings.entries()) {
      const before = at === 0 ? 0 : (headings[at - 1]?.level ?? 0);
      assert.ok(heading.level <= before + 1, `"${heading.text}" is an h${heading.level} straight after an h${before}`);
    }
    // A done step has nothing left to check against the chain, so its screen asks the practice network nothing:
    // not the height four times a minute, and nothing when a block comes.
    await page.settle();
    await sleep(1_000);
    const asked = s.standIn.requests().length;
    s.standIn.mine();
    await sleep(16_500);
    assert.deepEqual(s.standIn.requests().slice(asked), [], 'a done step\'s screen reads nothing');

    // The same holds in Spanish, and on a done step that has no such card.
    await page.goto(`/es/do/${DRILL}`);
    await page.waitFor('step-changed');
    assert.deepEqual(
      await page.page.$$eval('main h1, main h2, main h3', (found) => found.slice(0, 4).map((heading) => heading.tagName)),
      ['H1', 'H2', 'H3', 'H2'],
    );
    assert.equal(await page.text('step-changed'), `${es.changedTitle} ${es.changed}`);

    await ends(s, reader, [view(`/do/${DRILL}`), view(`/es/do/${DRILL}`)], {
      records: [record],
      words: [wordsOf(record)],
      addresses: funded.map((coin) => coin.address),
      txids: funded.map((coin) => coin.txid),
    });
  },
);

// -- the faucet's coin, before the index lists it ----------------------------------------------------------------------

scenario(
  '"Hold some", with the reader back on the step before the chain\'s index lists the faucet\'s payment: the step sees the coin arrive within seconds and with no block, ticks "ask the faucet", shows the coin waiting for its block, and is done when the block comes',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const STEP = 'hold-some';
    // The index hears of a payment eight seconds after the node has it.
    s.standIn.setEsploraLag(8);
    const record = freshRecord();
    const words = wordsOf(record);
    const reader = await begin(s, `/do/${STEP}`, { record });
    const { page } = reader;
    await untilParts(page, ['ticked', 'now', 'later']);
    await act(page, '/wallet/receive');
    await page.waitFor('faucet-ask');
    await page.click('faucet-ask');
    await untilPhase(page, 'on-its-way');
    const height = s.standIn.height();
    // The faucet has answered, and the reader goes straight back: a page load, since the bot check was in the page.
    assert.equal(await botCheckScripts(page), 1);
    await stripBack(page, STEP, { load: true });
    // The wallet's first look in the new page finds nothing: the index does not list the payment yet.
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);

    // -- No block comes. The step looks at the wallet's receive address, as Receive does, and sees the coin arrive. --
    await untilParts(page, ['ticked', 'ticked', 'now'], 30_000);
    assert.equal(s.standIn.height(), height, 'no block was made meanwhile');
    await page.waitFor('step-waiting');
    assert.equal(await attributeOf(page, 'step-waiting', 'data-lost'), 'no');
    assert.equal(await page.text('step-guide'), fill(en['guide_hold-some_3'], { seconds: String(s.stack.config.blockSeconds) }));
    assert.deepEqual((await noteOf(page))?.steps[STEP]?.parts, { 1: true, 2: true });

    // -- The block takes the coin in while the screen stays open: part 3 ticks by itself, and it is the
    //    step's last part. The step is done, and counted. --
    s.standIn.mine();
    await page.waitFor('step-done');
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);
    assert.deepEqual(stepsCounted(s), { 'hold-some': 1 });

    await ends(
      s,
      reader,
      [view(`/do/${STEP}`), view('/wallet/receive'), { name: 'Faucet', path: '/wallet/receive', value: 'ok' }, view(`/do/${STEP}`), doIt(`/do/${STEP}`, STEP)],
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [] },
    );
  },
);
