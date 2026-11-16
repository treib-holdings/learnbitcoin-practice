// The note of the "Do it" steps, through the real screens: when it is first
// written, what a reader can do to it, what it takes from the address a
// reader arrives with, and what happens under a note this version of the
// page cannot read.
//
// The note is one value in this browser's storage, beside the wallet's
// record. The scenarios of the six steps (doit-hold-some.test.ts and the
// five files beside it) show what it holds while a step is done. These
// show its edges:
//
//   1. nothing is written before a step's screen is opened: not by Home,
//      the list, About, any screen of the wallet, the 12 words shown or a
//      payment sent; and a payment sent before the step was opened does not
//      count for it
//   2. the way back to the chapter: "?from=" is kept when it is a plain
//      path of the main site and ignored, without a word, when it is
//      anything else; the link carries "#do-<step>" until the step is done
//      and "#done=<step>" from then on
//   3. "Forget my progress": the question, "Keep it", an answer pressed too
//      soon, and the note gone; the wallet is untouched, and a step done
//      again is counted again
//   4. "Start this step again": one step's ticks and its payment go, its way
//      back and every other step stay
//   5. under a note written by a newer version nothing is ticked, written
//      or counted, and no strip shows
//   6. in a browser that refuses to store anything, the list and a step say
//      that progress cannot be kept here, and nothing is ticked or counted
//   7. what is stored under the note's key and is no note, and a note with
//      fields that fail their checks
//   8. a step done before the server's settings have arrived is counted
//      when they arrive, and not before
//
// Scenarios 2 and 7 touch nothing of the stand-in (they need no wallet at
// all) and could run against a real practice network as they are. The
// other six are local only: they pay the wallet from the stand-in and
// make blocks.

import assert from 'node:assert/strict';
import type { EventBody } from '@learnbitcoin/practice-contract';
import { STEPS } from '../../app/src/lib/doit/steps.ts';
import { fill, formatDate } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { OTHER_WORDS, TEST_WORDS, fundTestWallet, scenario, testRecord } from './helpers.ts';
import {
  SECTIONS,
  arrivesAt,
  attributeOf,
  countOf,
  documentsOf,
  focusOf,
  goHome,
  headerLink,
  headingOf,
  hook,
  onNetwork,
  sleep,
  standBy,
  storageKeys,
  toSection,
  untilAnswersCount,
  watchEventRequests,
  wordsOnScreen,
} from './journey-helpers.ts';
import {
  PROGRESS_KEY,
  act,
  begin,
  doIt,
  ends,
  hrefOf,
  listState,
  noteFor,
  noteOf,
  noteText,
  partsOf,
  pay,
  pickStep,
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
const common = strings.common.en;
const about = strings.about.en;

const WORDS = TEST_WORDS.split(' ');

/** An address that is neither the wallet's nor the pot's: the first address of the harness's second wallet. */
const SOMEBODY = testRecord(OTHER_WORDS).firstAddress;

/** The three chapters that have steps: their number, their title and their page on the main site. */
const CHAPTERS = [
  { number: 2, title: en.chapter_2, path: '/journey/what-bitcoin-actually-is' },
  { number: 3, title: en.chapter_3, path: '/journey/how-bitcoin-works' },
  { number: 4, title: en.chapter_4, path: '/journey/be-your-own-bank' },
] as const;

scenario(
  'Nothing is noted before a step is opened: Home, the list of steps, About, an address that names no step, every screen of the wallet, the 12 words shown and a payment sent all leave this browser with the wallet and nothing else; and the payment sent before the step was opened does not count for it',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const record = testRecord();
    const funded = fundTestWallet(s.standIn);
    const reader = await begin(s, '/', { record });
    const { page } = reader;
    /** This browser keeps the wallet's record and nothing else, and no screen shows a strip. */
    const nothingNoted = async (where: string): Promise<void> => {
      assert.deepEqual(await storageKeys(page), ['lbp_wallet_v1'], where);
      assert.equal(await stripOf(page), null, where);
    };

    // -- Home: a short section on what "Do it" is, and the way to the list --
    await page.waitFor('home-do-link');
    assert.equal(await page.text('home-do'), en.homeBody);
    assert.equal(await page.text('home-do-link'), en.homeLink);
    await nothingNoted('Home');

    // -- The list: the six steps under their three chapters, each not started. Opening it starts nothing. --
    await page.click('home-do-link');
    await arrivesAt(page, '/do');
    await page.waitFor('do-list');
    assert.equal(await headingOf(page), en.name);
    assert.deepEqual(
      await page.page.$$eval(hook('do-step-link'), (links) => links.map((link) => [link.getAttribute('href'), link.getAttribute('data-step'), (link.textContent ?? '').trim()])),
      STEPS.map((id) => [`/do/${id}`, id, titleOf(id)]),
    );
    assert.deepEqual(
      await page.page.$$eval(hook('do-state'), (states) => states.map((state) => [state.getAttribute('data-state'), (state.textContent ?? '').trim()])),
      STEPS.map(() => ['not-started', en.stateNotStarted]),
    );
    // A chapter's name leads to the chapter, in this tab, and tells the main site no more than where the reader comes from.
    assert.deepEqual(
      await page.page.$$eval(hook('do-chapter'), (links) =>
        links.map((link) => [link.getAttribute('href'), (link.textContent ?? '').trim(), link.getAttribute('referrerpolicy'), link.getAttribute('target')]),
      ),
      CHAPTERS.map((chapter) => [`${site}${chapter.path}`, fill(en.chapterHeading, { number: String(chapter.number), title: chapter.title }), 'origin', null]),
    );
    // Which step stands under which chapter.
    assert.deepEqual(
      await page.page.$$eval(`${hook('do-list')} section`, (sections) =>
        sections.map((section) => [...section.querySelectorAll('li[data-step]')].map((line) => line.getAttribute('data-step'))),
      ),
      [['hold-some'], ['pass-it-on', 'no-balances', 'waiting-room'], ['the-seed', 'prove-the-backup']],
    );
    for (const absent of ['do-forget', 'do-following', 'do-newer', 'do-no-storage', 'do-forgotten']) assert.equal(await countOf(page, absent), 0, absent);
    await nothingNoted('the list of steps');
    await page.page.reload({ waitUntil: 'load' });
    await page.waitFor('do-list');
    await nothingNoted('the list of steps, loaded again');

    // -- About lists the note and its fields, and says that this browser keeps none right now --
    await headerLink(page, '/about');
    await arrivesAt(page, '/about');
    assert.equal(await page.text('about-note'), about.keepNote);
    assert.equal((await page.texts('about-note-fields')).length, 1);
    assert.deepEqual([await attributeOf(page, 'about-kept-now', 'data-kept'), await attributeOf(page, 'about-kept-now', 'data-note')], ['words', 'no']);
    assert.equal(await countOf(page, 'about-kept-note'), 0);
    await nothingNoted('About');

    // -- An address under /do that names none of the six steps is no step: not found, and nothing is started --
    for (const path of ['/do/nothing', '/do/hold-some/extra', '/do/Hold-Some', '/do/hold-some.html']) {
      await page.goto(path);
      assert.equal(await headingOf(page), common.notFoundTitle, path);
      await nothingNoted(path);
    }

    // -- Every screen of the wallet, in turn. The Overview has one line that leads to the steps. --
    await page.goto('/wallet');
    await page.waitFor('coin');
    assert.ok((await page.text('overview-do')).startsWith(en.overviewLine));
    assert.equal(await page.text('overview-do-link'), en.overviewLink);
    assert.equal(await hrefOf(page, 'overview-do-link'), '/do');
    await nothingNoted('/wallet');
    const documents = documentsOf(page);
    for (const path of SECTIONS.slice(1)) {
      await toSection(page, path);
      await page.settle();
      await nothingNoted(path);
    }
    // Settings names no note among what this browser keeps, and the question before a removal names none either.
    assert.equal(await countOf(page, 'keeps-progress'), 0);
    await page.click('remove-wallet');
    await page.waitFor('remove-confirm');
    assert.equal(await countOf(page, 'remove-progress'), 0);
    await untilAnswersCount();
    await page.click('remove-keep');
    await page.waitForGone('remove-confirm');
    // The 12 words, shown.
    await toSection(page, '/wallet/backup');
    await page.click('reveal-words');
    assert.deepEqual(await wordsOnScreen(page), WORDS);
    await nothingNoted('Backup, with the words shown');
    // A payment to the pot, and its own screen with "What just happened".
    await toSection(page, '/wallet/send');
    const paid = await pay(page, 'pot', '30,000');
    await nothingNoted('Send, after a payment');
    await page.click('sent-link');
    await arrivesAt(page, `/wallet/tx/${paid.txid}`);
    await page.waitFor('tx-explained');
    await nothingNoted('the payment\'s screen');

    // -- Now a step is opened, in the same page: "Pass it on". That is the first thing written. --
    await toSection(page, '/wallet');
    await page.click('overview-do-link');
    await arrivesAt(page, '/do');
    await nothingNoted('the list of steps, after all that');
    await pickStep(page, 'pass-it-on');
    assert.equal(documentsOf(page), documents, 'the page that sent the payment is the page that opens the step');
    assert.deepEqual(await storageKeys(page), [PROGRESS_KEY, 'lbp_wallet_v1']);
    // The wallet can spend, so part 1 is ticked at once. The payment to the pot was sent before the step was
    // followed: it is no payment of this step's, and part 2 still asks for one.
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);
    const note = await noteOf(page);
    assert.deepEqual(note?.steps, { 'pass-it-on': { started: true, parts: { 1: true } } });
    assert.equal(note?.following, 'pass-it-on');
    assert.equal(await hrefOf(page, 'step-action'), '/wallet/send');
    // And when that earlier payment gets its block, the step is where it was.
    await s.network.nextBlock();
    await reloadStep(page);
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal((await onNetwork(s, paid.txid)).status.confirmed, true);
    assert.deepEqual((await noteOf(page))?.steps, { 'pass-it-on': { started: true, parts: { 1: true } } });
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [
        view('/'),
        view('/do'),
        view('/do'),
        view('/about'),
        view('/not-found'),
        view('/not-found'),
        view('/not-found'),
        view('/not-found'),
        view('/wallet'),
        view('/wallet/coins'),
        view('/wallet/receive'),
        view('/wallet/send'),
        view('/wallet/activity'),
        view('/wallet/backup'),
        view('/wallet/settings'),
        view('/wallet/backup'),
        { name: 'Words shown', path: '/wallet/backup', value: 'words' },
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view('/wallet/tx'),
        view('/wallet'),
        view('/do'),
        view('/do/pass-it-on'),
        view('/do/pass-it-on'),
      ],
      { records: [record], words: [WORDS], addresses: [...funded.map((coin) => coin.address), paid.to], txids: [...funded.map((coin) => coin.txid), paid.txid] },
    );
  },
);

scenario(
  'The way back to the chapter: "?from=" is kept when it is a plain path of the main site, and ignored without a word when it is a full address, a second slash, dots, an encoding of any of them, or too long; the latest plain one wins, a hostile one in the stored note is dropped, and the link ends "#do-<step>" until the step is done and "#done=<step>" after',
  { timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const STEP = 'pass-it-on';
    const OWN = '/journey/how-bitcoin-works';
    const reader = await begin(s, `/do/${STEP}`);
    const { page } = reader;
    await page.waitFor('step-parts');
    /** Every page load below is one screen view, counted under the step's own fixed path: never under what the address said. */
    const counted: EventBody[] = [view(`/do/${STEP}`)];

    /** Opens the step with this query string, in a browser that has no note yet or keeps the one it has. */
    const arrive = async (query: string, options: { fresh?: boolean } = {}): Promise<{ href: string | null; from: string | undefined }> => {
      if (options.fresh ?? true) await page.store(PROGRESS_KEY, null);
      await page.goto(`/do/${STEP}${query === '' ? '' : `?${query}`}`);
      await page.waitFor('step-parts');
      counted.push(view(`/do/${STEP}`));
      return { href: await hrefOf(page, 'step-back'), from: (await noteOf(page))?.steps[STEP]?.from };
    };

    // -- No "from" at all: the step's own chapter, with the card's mark and no stamp --
    assert.deepEqual(await arrive(''), { href: `${site}${OWN}#do-${STEP}`, from: undefined });
    // The link itself: this tab, the site's name as the only thing the main site is told, and the main site's own origin.
    assert.deepEqual(
      await page.page.$eval(hook('step-back'), (link) => [link.getAttribute('referrerpolicy'), link.getAttribute('target'), (link as HTMLAnchorElement).origin]),
      ['origin', null, new URL(site).origin],
    );

    // -- Plain paths of the main site are kept --
    const plain: [why: string, query: string, from: string][] = [
      ['a chapter page', 'from=/journey/what-bitcoin-actually-is', '/journey/what-bitcoin-actually-is'],
      ['the same kind of path, encoded', 'from=%2Fjourney%2Fbe-your-own-bank', '/journey/be-your-own-bank'],
      ['another page of the site', 'from=/glossary/utxo-unspent-transaction-output', '/glossary/utxo-unspent-transaction-output'],
      ['a Spanish page', 'from=/es/recorrido/como-funciona-bitcoin', '/es/recorrido/como-funciona-bitcoin'],
      ['the longest path that is kept: 200 characters', `from=/${'a'.repeat(199)}`, `/${'a'.repeat(199)}`],
      ['the first of two', 'from=/journey/what-bitcoin-actually-is&from=//evil.example', '/journey/what-bitcoin-actually-is'],
      ['among other things in the address', 'ref=//evil.example&from=/journey/be-your-own-bank&next=https://evil.example', '/journey/be-your-own-bank'],
      ['the main site\'s front page', 'from=/', '/'],
    ];
    for (const [why, query, from] of plain) {
      assert.deepEqual(await arrive(query), { href: `${site}${from}#do-${STEP}`, from }, why);
    }

    // -- Anything else is ignored: the link is the step's own chapter, and the note keeps no way back --
    const hostile: [why: string, query: string][] = [
      ['a full address', 'from=https://evil.example/journey/how-bitcoin-works'],
      ['a full address, encoded', 'from=https%3A%2F%2Fevil.example%2Fjourney%2Fhow-bitcoin-works'],
      ['an address without its scheme', 'from=//evil.example/journey'],
      ['the same, encoded', 'from=%2F%2Fevil.example%2Fjourney'],
      ['a second slash inside the path', 'from=/journey//how-bitcoin-works'],
      ['a backslash', 'from=/%5Cevil.example'],
      ['a backslash, as typed', 'from=/\\evil.example'],
      ['dots that climb out', 'from=/journey/../../evil'],
      ['the same dots, encoded', 'from=/journey/%2e%2e/%2e%2e/evil'],
      ['a dot in a name', 'from=/journey/how-bitcoin-works.html'],
      ['a host name after one slash', 'from=/evil.example'],
      ['an at sign', 'from=/@evil.example'],
      ['a colon', 'from=/journey:8080'],
      ['a script', 'from=javascript:alert(1)'],
      ['a script, encoded', 'from=javascript%3Aalert%281%29'],
      ['no slash in front', 'from=journey/how-bitcoin-works'],
      ['capital letters', 'from=/Journey/How-Bitcoin-Works'],
      ['a query of its own', 'from=/journey/how-bitcoin-works%3Fnext%3D%2F%2Fevil.example'],
      ['a mark of its own, made to look like a finished step', `from=/journey/how-bitcoin-works%23done%3D${STEP}`],
      ['a space', 'from=/journey/how%20bitcoin%20works'],
      ['a plus sign, which an address reads as a space', 'from=/journey/how+bitcoin+works'],
      ['a path encoded twice', 'from=%252Fjourney%252Fhow-bitcoin-works'],
      ['a letter with an accent', 'from=/es/recorrido/qu%C3%A9-es-bitcoin'],
      ['a line break', 'from=/journey/how%0Abitcoin-works'],
      ['a NUL character', 'from=/journey/how-bitcoin-works%00'],
      ['an underscore', 'from=/journey/how_bitcoin_works'],
      ['a path one character too long: 201', `from=/${'a'.repeat(200)}`],
      ['a very long path', `from=/${'journey/'.repeat(400)}how-bitcoin-works`],
      ['an empty value', 'from='],
      ['the name in capitals', 'FROM=/journey/what-bitcoin-actually-is'],
      ['a hostile first value with a plain one after it', 'from=//evil.example&from=/journey/what-bitcoin-actually-is'],
    ];
    for (const [why, query] of hostile) {
      assert.deepEqual(await arrive(query), { href: `${site}${OWN}#do-${STEP}`, from: undefined }, why);
      // "Without a word": the screen is the step's own, with nothing said about the address.
      assert.equal(await page.text('step-title'), en['title_pass-it-on'], why);
      assert.equal(await countOf(page, 'do-no-storage'), 0, why);
    }

    // -- The latest plain one wins. An opening with a hostile one, or with none, leaves the earlier one alone. --
    assert.deepEqual(await arrive('from=/journey/what-bitcoin-actually-is'), { href: `${site}/journey/what-bitcoin-actually-is#do-${STEP}`, from: '/journey/what-bitcoin-actually-is' });
    assert.deepEqual(await arrive('from=//evil.example/journey', { fresh: false }), {
      href: `${site}/journey/what-bitcoin-actually-is#do-${STEP}`,
      from: '/journey/what-bitcoin-actually-is',
    });
    assert.deepEqual(await arrive('', { fresh: false }), { href: `${site}/journey/what-bitcoin-actually-is#do-${STEP}`, from: '/journey/what-bitcoin-actually-is' });
    assert.deepEqual(await arrive('from=/journey/be-your-own-bank', { fresh: false }), { href: `${site}/journey/be-your-own-bank#do-${STEP}`, from: '/journey/be-your-own-bank' });

    // -- A hostile way back that is in the stored note already (written by anything but this page) is dropped
    //    when the note is read, and is gone from it at the next write --
    const at = Date.now();
    for (const planted of ['//evil.example/journey', 'https://evil.example/', '/journey/../x', `/${'a'.repeat(200)}`]) {
      await page.store(PROGRESS_KEY, noteFor({ following: STEP, followedAt: at, steps: { [STEP]: { started: true, from: planted } } }));
      assert.deepEqual(await arrive('', { fresh: false }), { href: `${site}${OWN}#do-${STEP}`, from: undefined }, planted);
    }

    // -- A step that is done: the same way back, now with the mark the chapter stamps on --
    const done = { started: true as const, doneAt: at, parts: { 1: true as const, 2: true as const, 3: true as const } };
    await page.store(PROGRESS_KEY, noteFor({ following: null, steps: { [STEP]: { ...done, from: '/journey/what-bitcoin-actually-is' } } }));
    assert.deepEqual(await arrive('', { fresh: false }), { href: `${site}/journey/what-bitcoin-actually-is#done=${STEP}`, from: '/journey/what-bitcoin-actually-is' });
    assert.equal(await countOf(page, 'step-done'), 1);
    await page.store(PROGRESS_KEY, noteFor({ following: null, steps: { [STEP]: { ...done, from: '//evil.example/journey' } } }));
    assert.equal((await arrive('', { fresh: false })).href, `${site}${OWN}#done=${STEP}`);
    // A hostile "from" in the address of a done step changes nothing either.
    assert.equal((await arrive(`from=/journey/how-bitcoin-works%23done%3Dhold-some`, { fresh: false })).href, `${site}${OWN}#done=${STEP}`);

    // -- The strip of a done step carries the same link: on Home, for a step that was finished elsewhere --
    await page.store(PROGRESS_KEY, noteFor({ following: STEP, followedAt: at, steps: { [STEP]: { ...done, from: '/journey/be-your-own-bank' } } }));
    await page.goto('/');
    counted.push(view('/'));
    await untilStrip(page, STEP, 'done');
    assert.equal(await hrefOf(page, 'strip-chapter'), `${site}/journey/be-your-own-bank#done=${STEP}`);
    assert.deepEqual(
      await page.page.$eval(hook('strip-chapter'), (link) => [link.getAttribute('referrerpolicy'), link.getAttribute('target')]),
      ['origin', null],
    );
    await page.store(PROGRESS_KEY, noteFor({ following: STEP, followedAt: at, steps: { [STEP]: { ...done, from: '//evil.example' } } }));
    await page.goto('/');
    counted.push(view('/'));
    await untilStrip(page, STEP, 'done');
    assert.equal(await hrefOf(page, 'strip-chapter'), `${site}${OWN}#done=${STEP}`);

    // -- In Spanish the step's own chapter is the Spanish page --
    await page.store(PROGRESS_KEY, null);
    await page.goto(`/es/do/${STEP}`);
    await page.waitFor('step-parts');
    counted.push(view(`/es/do/${STEP}`));
    assert.equal(await hrefOf(page, 'step-back'), `${site}/es/recorrido/como-funciona-bitcoin#do-${STEP}`);
    assert.deepEqual(stepsCounted(s), {});

    // No wallet was ever in this browser. What must not show up anywhere is held against the harness's own test wallet.
    await ends(s, reader, counted, { records: [testRecord()], words: [WORDS], addresses: [testRecord().firstAddress], txids: [] });
  },
);

scenario(
  '"Forget my progress": the question, an answer pressed in its first moment, "Keep it", and then the note gone and said so; the wallet is not touched, every step reads as not started, and a step done again is counted again',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const record = testRecord();
    const funded = fundTestWallet(s.standIn);
    const firstBlock = (await onNetwork(s, funded[0]!.txid)).status.block_height ?? 0;
    const reader = await begin(s, '/do/hold-some', { record });
    const { page } = reader;

    // -- One step done, another started and followed --
    await untilParts(page, ['ticked', 'ticked', 'ticked', 'now']);
    await page.fill('step-block-answer', String(firstBlock));
    await page.click('step-block-check');
    await page.waitFor('step-done');
    await page.click('step-list');
    await arrivesAt(page, '/do');
    await pickStep(page, 'pass-it-on');
    assert.deepEqual(await partsOf(page), ['ticked', 'now', 'later']);
    await page.click('step-list');
    await arrivesAt(page, '/do');

    // -- The list says where each stands, and offers to forget it all --
    const doneAt = (await noteOf(page))?.steps['hold-some']?.doneAt ?? 0;
    assert.deepEqual([await listState(page, 'hold-some'), await listState(page, 'pass-it-on'), await listState(page, 'no-balances')], ['done', 'started', 'not-started']);
    assert.equal(await page.page.$eval(`li[data-step="hold-some"] ${hook('do-state')}`, (state) => (state.textContent ?? '').trim()), fill(en.stateDone, { date: formatDate(doneAt / 1000, 'en', 'utc') }));
    assert.deepEqual(await page.page.$$eval(hook('do-following'), (marks) => marks.map((mark) => mark.closest('li')?.getAttribute('data-step'))), ['pass-it-on']);
    assert.equal(await page.text('do-forget'), en.forget);
    const stored = await noteText(page);
    const wallet = await page.stored();
    assert.ok(stored !== null && wallet !== null);

    // -- An answer pressed in the question's first moment does not count: the question has not been seen yet.
    //    Both presses are made from inside the page, the second as soon as its button is there: a press
    //    sent from here could arrive after that moment has passed. --
    await page.page.evaluate(async () => {
      (document.querySelector('[data-testid="do-forget"]') as HTMLElement).click();
      for (let turn = 0; turn < 400; turn += 1) {
        const yes = document.querySelector('[data-testid="do-forget-confirm"]');
        if (yes !== null) {
          (yes as HTMLElement).click();
          return;
        }
        // The page draws the question in its next turn or two. No picture has to be painted for that.
        await new Promise<void>((next) => {
          if (turn < 50) queueMicrotask(next);
          else setTimeout(next, 1);
        });
      }
      throw new Error('the question did not open');
    });
    assert.equal(await noteText(page), stored, 'an answer in the first moment forgets nothing');
    const question = await page.text('do-forget-question');
    assert.ok(question.includes(en.forgetAsk) && question.includes(en.forgetWarn), question);
    assert.equal(await page.text('do-forget-confirm'), en.forgetYes);

    // -- "Keep it": the question closes, and nothing has changed --
    await untilAnswersCount();
    await page.click('do-forget-keep');
    await page.waitForGone('do-forget-question');
    assert.equal(await noteText(page), stored);
    assert.equal(await focusOf(page), 'do-forget');

    // -- "Forget it": the note is gone, and nothing else is --
    await page.click('do-forget');
    await page.waitFor('do-forget-confirm');
    await untilAnswersCount();
    await page.click('do-forget-confirm');
    await page.waitFor('do-forgotten');
    assert.equal(await page.text('do-forgotten'), en.forgotten);
    assert.equal(await page.waitForStatus(en.forgotten), en.forgotten);
    assert.deepEqual(await storageKeys(page), ['lbp_wallet_v1']);
    assert.equal(await page.stored(), wallet, 'the wallet\'s record is as it was');
    assert.deepEqual(
      await page.page.$$eval(hook('do-state'), (states) => states.map((state) => state.getAttribute('data-state'))),
      STEPS.map(() => 'not-started'),
    );
    for (const gone of ['do-forget', 'do-forget-question', 'do-following']) assert.equal(await countOf(page, gone), 0, gone);
    // The wallet's screens carry no strip any more, and the wallet holds what it held.
    await page.goto('/wallet');
    await page.waitFor('coin');
    assert.equal(await stripOf(page), null);
    assert.equal(await page.text('total'), '142,500 practice sats');
    assert.deepEqual(await storageKeys(page), ['lbp_wallet_v1']);

    // -- Each step can be done again, and "Hold some", done a second time, is counted a second time --
    assert.deepEqual(stepsCounted(s), { 'hold-some': 1 });
    await page.click('overview-do-link');
    await arrivesAt(page, '/do');
    assert.equal(await countOf(page, 'do-forgotten'), 0, 'said for the visit in which it was forgotten');
    await pickStep(page, 'hold-some');
    await untilParts(page, ['ticked', 'ticked', 'ticked', 'now']);
    await page.fill('step-block-answer', String(firstBlock));
    await page.click('step-block-check');
    await page.waitFor('step-done');
    assert.deepEqual(stepsCounted(s), { 'hold-some': 2 });
    assert.deepEqual(Object.keys((await noteOf(page))?.steps ?? {}), ['hold-some'], 'the step that was started before is not started now');

    await ends(
      s,
      reader,
      [
        view('/do/hold-some'),
        doIt('/do/hold-some', 'hold-some'),
        view('/do'),
        view('/do/pass-it-on'),
        view('/do'),
        view('/wallet'),
        view('/do'),
        view('/do/hold-some'),
        doIt('/do/hold-some', 'hold-some'),
      ],
      { records: [record], words: [WORDS], addresses: funded.map((coin) => coin.address), txids: funded.map((coin) => coin.txid) },
    );
  },
);

scenario(
  '"Start this step again": the step\'s ticks and the payment it waited for are cleared, its way back and the other steps are not; the payment sent before does not count when it confirms, and the step is done with a new one and counted once',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const STEP = 'waiting-room';
    const FROM = '/journey/how-bitcoin-works';
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const reader = await begin(s, '/do/pass-it-on', { record });
    const { page } = reader;

    // -- Two steps under way: "Pass it on" with its first part ticked, "The waiting room" with its payment sent --
    await untilParts(page, ['ticked', 'now', 'later']);
    await page.goto(`/do/${STEP}?from=${FROM}`);
    await untilParts(page, ['now', 'later', 'later']);
    // A step that is started offers to be started again, whether or not anything is ticked.
    assert.equal(await page.text('step-restart'), en.restart);
    await act(page, '/wallet/send');
    const first = await pay(page, SOMEBODY, '10,000');
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.deepEqual((await noteOf(page))?.steps[STEP]?.tx, first.txid);
    const others = (await noteOf(page))?.steps['pass-it-on'];
    assert.deepEqual(others, { started: true, parts: { 1: true } });

    // -- "Start this step again": back to its first part, at once and without a question --
    page.forgetStatus();
    await page.click('step-restart');
    await untilParts(page, ['now', 'later', 'later']);
    assert.equal(await focusOf(page), 'step-title', 'the button that was pressed is still there, and the heading is where reading starts again');
    const again = await noteOf(page);
    assert.deepEqual(again?.steps[STEP], { started: true, from: FROM }, 'the ticks and the payment are gone, the way back is not');
    assert.deepEqual(again?.steps['pass-it-on'], others, 'another step is not touched');
    assert.equal(again?.following, STEP);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${FROM}#do-${STEP}`);
    assert.equal(await countOf(page, 'step-waiting'), 0);

    // -- The payment sent before the restart gets its block: it is not this try's payment, and ticks nothing --
    await s.network.nextBlock();
    await reloadStep(page);
    await untilParts(page, ['now', 'later', 'later']);
    assert.equal((await onNetwork(s, first.txid)).status.confirmed, true);
    assert.deepEqual((await noteOf(page))?.steps[STEP], { started: true, from: FROM });
    assert.deepEqual(stepsCounted(s), {});

    // -- A new payment, its block and five more: done, once --
    await act(page, '/wallet/send');
    const second = await pay(page, SOMEBODY, '5,000');
    assert.equal((await noteOf(page))?.steps[STEP]?.tx, second.txid);
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'now', 'later']);
    await s.network.nextBlock();
    s.standIn.mine(5);
    await reloadStep(page);
    await page.waitFor('step-done');
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.equal(await hrefOf(page, 'step-back'), `${site}${FROM}#done=${STEP}`);
    // A step that is done cannot be started again: only "Forget my progress" undoes it.
    assert.deepEqual([await countOf(page, 'step-restart'), await countOf(page, 'step-stop')], [0, 0]);
    assert.ok(!page.statusLog().includes(saidTicked(STEP, 1)), 'a tick made on the Send screen is not read out');
    assert.deepEqual(stepsCounted(s), { 'waiting-room': 1 });

    await ends(
      s,
      reader,
      [
        view('/do/pass-it-on'),
        view('/do/waiting-room'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent' },
        view('/do/waiting-room'),
        view('/do/waiting-room'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent' },
        view('/do/waiting-room'),
        view('/do/waiting-room'),
        doIt('/do/waiting-room', STEP),
      ],
      { records: [record], words: [WORDS], addresses: [record.firstAddress, SOMEBODY], txids: [funding, first.txid, second.txid] },
      { from: [FROM] },
    );
  },
);

scenario(
  'Under a note written by a newer version of the page nothing is ticked, written or counted: the list shows the steps without states and offers Reload and no "Forget my progress", a step shows its parts as the wallet stands with no question and no box to tick, no screen carries a strip, and the stored note is the same to the last character',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const record = testRecord();
    const funded = fundTestWallet(s.standIn);
    // What a later version of the page might have left: its own version number, and fields this one has never heard of.
    const newer = JSON.stringify({
      v: 2,
      following: 'pass-it-on',
      followedAt: Date.now(),
      steps: { 'pass-it-on': { started: true, parts: { 1: true }, streak: 3 }, 'hold-some': { started: true, doneAt: Date.now(), parts: { 1: true, 2: true, 3: true, 4: true } } },
      badges: ['first-coin'],
    });
    const reader = await begin(s, '/do', { record, storage: { [PROGRESS_KEY]: newer } });
    const { page } = reader;
    const untouched = async (where: string): Promise<void> => assert.equal(await noteText(page), newer, where);

    // -- The list: the six steps, no states, the notice with Reload, and nothing to forget --
    await page.waitFor('do-newer');
    assert.ok((await page.text('do-newer')).startsWith(en.newer), await page.text('do-newer'));
    assert.equal(await page.page.$eval(`${hook('do-newer')} button`, (button) => (button.textContent ?? '').trim()), common.reload);
    assert.equal((await page.texts('do-step-link')).length, 6);
    for (const absent of ['do-state', 'do-following', 'do-forget', 'do-forgotten']) assert.equal(await countOf(page, absent), 0, absent);
    await untouched('the list');

    // -- "Hold some": this version reads nothing of that note, so the step is shown as the wallet stands. The
    //    three parts that are states of the wallet hold; the question cannot be ticked here, and is not asked. --
    await pickStep(page, 'hold-some');
    await untilParts(page, ['ticked', 'ticked', 'ticked', 'blocked']);
    assert.ok((await page.text('do-newer')).startsWith(en.newer));
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'storage');
    assert.ok((await page.text('step-need')).startsWith(en.needNewer), await page.text('step-need'));
    for (const absent of ['step-block-answer', 'step-block-check', 'step-need-link', 'step-action', 'step-restart', 'step-stop', 'step-done']) {
      assert.equal(await countOf(page, absent), 0, absent);
    }
    // The plain link to the chapter: no stamp, whatever that note may say of the step.
    assert.equal(await hrefOf(page, 'step-back'), `${site}/journey/what-bitcoin-actually-is#do-hold-some`);
    await untouched('Hold some');

    // -- "The seed": its first part is something to do while the step is followed, and no step can be followed here --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    await pickStep(page, 'the-seed');
    assert.deepEqual(await partsOf(page), ['blocked', 'later', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'storage');
    for (const absent of ['step-said', 'step-word', 'step-words-check', 'step-action']) assert.equal(await countOf(page, absent), 0, absent);

    // -- "Pass it on": the wallet can spend, which is a state. Sending to the pot is an event, and ticks nothing here. --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    await pickStep(page, 'pass-it-on');
    await untilParts(page, ['ticked', 'blocked', 'later']);
    const documents = documentsOf(page);
    await goHome(page);
    assert.equal(await stripOf(page), null, 'no strip on Home');
    await page.click('wallet-open');
    await arrivesAt(page, '/wallet');
    await page.waitFor('coin');
    assert.equal(await stripOf(page), null, 'no strip on the Overview');
    await toSection(page, '/wallet/send');
    const paid = await pay(page, 'pot', '30,000');
    assert.equal(await stripOf(page), null, 'no strip on Send');
    await untouched('after a payment to the pot');
    // Settings says that a note is kept: it is there, even if this version cannot read it.
    await toSection(page, '/wallet/settings');
    assert.equal(await page.text('keeps-progress'), en.keepsProgress);
    await toSection(page, '/wallet');
    await page.click('overview-do-link');
    await arrivesAt(page, '/do');
    await pickStep(page, 'pass-it-on');
    assert.equal(documentsOf(page), documents, 'the page that sent the payment is the page that shows the step');
    assert.deepEqual(await partsOf(page), ['ticked', 'blocked', 'later']);
    // Its block changes nothing either.
    await s.network.nextBlock();
    await reloadStep(page);
    await untilParts(page, ['ticked', 'blocked', 'later']);
    assert.equal(await countOf(page, 'step-done'), 0);

    // -- Nothing was said as ticked or done, nothing was counted as done, and the note is the one that was stored --
    assert.ok(!page.statusLog().some((said) => said.startsWith('Part ') || said.startsWith('Step done')), page.statusLog().join(' | '));
    assert.deepEqual(stepsCounted(s), {});
    await untouched('at the end');
    assert.deepEqual(await storageKeys(page), [PROGRESS_KEY, 'lbp_wallet_v1']);

    await ends(
      s,
      reader,
      [
        view('/do'),
        view('/do/hold-some'),
        view('/do'),
        view('/do/the-seed'),
        view('/do'),
        view('/do/pass-it-on'),
        view('/'),
        view('/wallet'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view('/wallet/settings'),
        view('/wallet'),
        view('/do'),
        view('/do/pass-it-on'),
        view('/do/pass-it-on'),
      ],
      { records: [record], words: [WORDS], addresses: [...funded.map((coin) => coin.address), paid.to], txids: [...funded.map((coin) => coin.txid), paid.txid] },
      { untouched: newer },
    );
  },
);

scenario(
  'In a browser that refuses to store anything the steps say that progress cannot be kept here: the list and a step carry the notice, the step shows its parts as the wallet stands with no question to answer, nothing is written, no screen carries a strip and nothing is counted as done',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const record = testRecord();
    const funded = fundTestWallet(s.standIn);
    // The wallet is in the browser already. From the next page on, the browser takes no write at all: what a
    // private window does in some browsers, and any window in which site data is blocked.
    const page = await standBy(s, { record, timeout: 30_000 });
    const reader = { page, requests: watchEventRequests(page) };
    await page.page.evaluateOnNewDocument(() => {
      Storage.prototype.setItem = function refuse(): void {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });
    await page.goto('/do');

    // -- The list: the notice, with the way out, above six steps that are not started and cannot be forgotten --
    await page.waitFor('do-no-storage');
    assert.ok((await page.text('do-no-storage')).startsWith(en.noStorage), await page.text('do-no-storage'));
    assert.equal(await page.page.$eval(`${hook('do-no-storage')} button`, (button) => (button.textContent ?? '').trim()), common.reload);
    assert.deepEqual(
      await page.page.$$eval(hook('do-state'), (states) => states.map((state) => state.getAttribute('data-state'))),
      STEPS.map(() => 'not-started'),
    );
    for (const absent of ['do-forget', 'do-following', 'do-newer']) assert.equal(await countOf(page, absent), 0, absent);

    // -- "Hold some": opening it cannot start it. The three parts that are states of the wallet hold as the
    //    wallet stands; the question would need a tick that cannot be written, and is not asked. --
    await pickStep(page, 'hold-some');
    await untilParts(page, ['ticked', 'ticked', 'ticked', 'blocked']);
    assert.ok((await page.text('do-no-storage')).startsWith(en.noStorage));
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'storage');
    assert.ok((await page.text('step-need')).startsWith(en.need_storage), await page.text('step-need'));
    for (const absent of ['step-block-answer', 'step-block-check', 'step-restart', 'step-stop', 'step-done', 'step-action']) {
      assert.equal(await countOf(page, absent), 0, absent);
    }
    assert.equal(await hrefOf(page, 'step-back'), `${site}/journey/what-bitcoin-actually-is#do-hold-some`);
    assert.deepEqual(await storageKeys(page), ['lbp_wallet_v1']);

    // -- "The seed": its first part is something to do while the step is followed, and nothing can be followed here --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    await pickStep(page, 'the-seed');
    assert.deepEqual(await partsOf(page), ['blocked', 'later', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'storage');
    for (const absent of ['step-said', 'step-word', 'step-action']) assert.equal(await countOf(page, absent), 0, absent);

    // -- The wallet's own screens: no strip, since no step is followed --
    await goHome(page);
    await page.click('wallet-open');
    await arrivesAt(page, '/wallet');
    await page.waitFor('coin');
    assert.equal(await stripOf(page), null);
    assert.deepEqual(await storageKeys(page), ['lbp_wallet_v1']);
    assert.ok(!page.statusLog().some((said) => said.startsWith('Part ') || said.startsWith('Step done')), page.statusLog().join(' | '));
    assert.deepEqual(stepsCounted(s), {});

    await ends(s, reader, [view('/do'), view('/do/hold-some'), view('/do'), view('/do/the-seed'), view('/'), view('/wallet')], {
      records: [record],
      words: [WORDS],
      addresses: funded.map((coin) => coin.address),
      txids: funded.map((coin) => coin.txid),
    });
  },
);

scenario(
  'What is stored under the note\'s key and is no note counts as no progress, is left alone by the list and replaced when a step is opened; in a note, a field that fails its check is dropped by itself, a step this version does not know is not read, and the rest stands',
  { timeout: 150_000 },
  async (s) => {
    const NONSENSE = 'not a note {';
    const reader = await begin(s, '/do', { storage: { [PROGRESS_KEY]: NONSENSE } });
    const { page } = reader;

    // -- Something that is no note: no progress, no notice. The list writes nothing over it, and offers to erase it. --
    await page.waitFor('do-list');
    assert.deepEqual(
      await page.page.$$eval(hook('do-state'), (states) => states.map((state) => state.getAttribute('data-state'))),
      STEPS.map(() => 'not-started'),
    );
    for (const absent of ['do-newer', 'do-no-storage', 'do-following']) assert.equal(await countOf(page, absent), 0, absent);
    assert.equal(await countOf(page, 'do-forget'), 1);
    assert.equal(await noteText(page), NONSENSE);

    // -- A step is opened: that is a write, and it puts a note in its place --
    await pickStep(page, 'the-seed');
    assert.deepEqual(await partsOf(page), ['blocked', 'later', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-wallet');
    const replaced = await noteOf(page);
    assert.deepEqual([replaced?.v, replaced?.following, replaced?.steps], [1, 'the-seed', { 'the-seed': { started: true } }]);

    // -- A note of this version in which much is wrong, as a hand or another program might leave it --
    const at = Date.now();
    await page.store(
      PROGRESS_KEY,
      JSON.stringify({
        v: 1,
        following: 'no-such-step',
        followedAt: 'yesterday',
        steps: {
          'hold-some': { started: true, doneAt: -5, from: '//evil.example', wallet: 'not-hex!', was: 'paper', tx: 'abc', sentAt: 1.5, parts: { 1: true, 2: 'yes', 7: true }, answer: '123' },
          'pass-it-on': { started: 'yes', parts: [true] },
          'waiting-room': { started: true, doneAt: at, parts: { 1: true, 2: true, 3: true } },
          'made-up-step': { started: true },
        },
        words: 'never here',
      }),
    );
    await page.goto('/do');
    await page.waitFor('do-list');
    // What passes its check is read: one step started, one done. What does not is as if it were not there.
    assert.deepEqual(
      [await listState(page, 'hold-some'), await listState(page, 'pass-it-on'), await listState(page, 'waiting-room'), await listState(page, 'the-seed')],
      ['started', 'not-started', 'done', 'not-started'],
    );
    assert.equal(await countOf(page, 'do-following'), 0);
    assert.equal(await stripOf(page), null);
    // The step that was started with one sound tick: that tick stands, and the part after it is the open one.
    await pickStep(page, 'hold-some');
    assert.deepEqual(await partsOf(page), ['ticked', 'blocked', 'later', 'later']);
    assert.equal(await hrefOf(page, 'step-back'), `${s.stack.config.siteUrl}/journey/what-bitcoin-actually-is#do-hold-some`);
    // The write that opened it stored the note as this version reads it: the sound fields, and nothing else.
    const sound = await noteOf(page);
    assert.ok(typeof sound?.followedAt === 'number' && sound.followedAt >= at);
    assert.deepEqual(sound, {
      v: 1,
      following: 'hold-some',
      followedAt: sound.followedAt,
      steps: { 'hold-some': { started: true, parts: { 1: true } }, 'waiting-room': { started: true, doneAt: at, parts: { 1: true, 2: true, 3: true } } },
    });
    assert.deepEqual(stepsCounted(s), {});

    // No wallet was ever in this browser. What must not show up anywhere is held against the harness's own test wallet.
    await ends(s, reader, [view('/do'), view('/do/the-seed'), view('/do'), view('/do/hold-some')], {
      records: [testRecord()],
      words: [WORDS],
      addresses: [testRecord().firstAddress],
      txids: [],
    });
  },
);

scenario(
  'A step that is done before the server\'s settings have arrived is counted when they arrive: nothing is sent while nobody knows whether anything is counted, and then the screen first and the step after it, once',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    const STEP = 'pass-it-on';
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const page = await standBy(s, { record, timeout: 30_000 });
    const reader = { page, requests: watchEventRequests(page) };
    // The page asks the server for its settings at /api/config, and they say whether anything is counted.
    // From here on the scenario can hold that one request back, in every page that is loaded.
    let gate: Promise<void> = Promise.resolve();
    let open = (): void => {};
    await page.page.exposeFunction('__doitSettingsGate', () => gate);
    await page.page.evaluateOnNewDocument(() => {
      const real = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (new URL(address, location.href).pathname === '/api/config') {
          await (window as unknown as { __doitSettingsGate(): Promise<void> }).__doitSettingsGate();
        }
        return real(input, init);
      };
    });

    // -- "Pass it on" as far as its payment, with the settings arriving as they always do --
    await page.goto(`/do/${STEP}`);
    await untilParts(page, ['ticked', 'now', 'later']);
    await act(page, '/wallet/send');
    const paid = await pay(page, 'pot', '30,000');
    await stripBack(page, STEP);
    await untilParts(page, ['ticked', 'ticked', 'now']);
    await page.settle();
    const sent = reader.requests().length;
    assert.equal(sent, 4, 'three screens and the payment');

    // -- The settings are held back, the payment gets its block, and the page is loaded again: the step is done
    //    in a page that does not know yet whether it counts anything --
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    await s.network.nextBlock();
    await page.page.reload({ waitUntil: 'load' });
    await page.waitFor('step-done');
    assert.ok((await noteOf(page))?.steps[STEP]?.doneAt !== undefined);
    await sleep(1500);
    assert.equal(reader.requests().length, sent, 'nothing is sent to be counted before the settings have arrived');
    assert.deepEqual(stepsCounted(s), {});

    // -- They arrive: the screen is counted, and then the step that was done on it. Once. --
    open();
    await ends(
      s,
      reader,
      [
        view('/do/pass-it-on'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view('/do/pass-it-on'),
        view('/do/pass-it-on'),
        doIt('/do/pass-it-on', STEP),
      ],
      { records: [record], words: [WORDS], addresses: [record.firstAddress, paid.to], txids: [funding, paid.txid] },
    );
    assert.deepEqual(stepsCounted(s), { 'pass-it-on': 1 });
  },
);
