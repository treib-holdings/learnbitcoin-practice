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
//   2. the way back to the chapter: "?from=" is kept when it is the step's
//      own chapter page, in English or in Spanish, and ignored, without a
//      word, when it is anything else; a reader who came from the English
//      chapter goes back to it from the Spanish wallet too; the link
//      carries "#do-<step>" until the step is done and "#done=<step>" from
//      then on
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
//   9. in a browser that fails the wallet's self-test the steps keep their
//      note as in any other, and About says so: its line speaks of the
//      wallet only, and names the note once one is stored; the strip says
//      that the wallet cannot run in this browser, and nothing of a stored
//      wallet
//  10. what a read dropped from a note (a way back that is not the step's
//      own chapter, a field this page does not know) is still in the
//      browser after the read, and leaves it at the next write, whatever
//      that write is for: also where every started step is done and none
//      is followed, and no visit changes anything
//  11. a done step on a later day, with no wallet in the browser: each of
//      the six cards says what the reader did and saw, in the past tense,
//      and nothing of what the wallet, the chain or the pot holds now
//
// Scenarios 2, 7, 9, 10 and 11 touch nothing of the stand-in (they pay no
// wallet and make no block) and could run against a real practice network
// as they are. The other six are local only: they pay the wallet from the
// stand-in and make blocks.

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
  switchLanguage,
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
    // A chapter's name leads to the chapter's page, in this tab, with no mark in its address; and nothing on the
    // link asks for a referrer to be sent (the page's own policy sends none).
    assert.deepEqual(
      await page.page.$$eval(hook('do-chapter'), (links) =>
        links.map((link) => [link.getAttribute('href'), (link.textContent ?? '').trim(), link.getAttribute('referrerpolicy'), link.getAttribute('rel'), link.getAttribute('target')]),
      ),
      CHAPTERS.map((chapter) => [`${site}${chapter.path}`, fill(en.chapterHeading, { number: String(chapter.number), title: chapter.title }), null, null, null]),
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
  'The way back to the chapter: "?from=" is kept only when it is the step\'s own chapter page, in English or in Spanish, and ignored without a word when it is another step\'s chapter, any other page of the main site, a full address, a second slash, dots, an encoding of any of them, or too long; the latest of the two pages wins, any other path in the stored note is dropped, a reader who came from the English chapter goes back to it from the Spanish wallet too, and the link ends "#do-<step>" until the step is done and "#done=<step>" after',
  { timeout: 240_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const STEP = 'pass-it-on';
    /** The step's own chapter: its English page and its Spanish one. No other value of "from" counts for this step. */
    const OWN = '/journey/how-bitcoin-works';
    const OWN_ES = '/es/recorrido/como-funciona-bitcoin';
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
    // The link itself: this tab, nothing that asks for a referrer to be sent, and the main site's own origin.
    assert.deepEqual(
      await page.page.$eval(hook('step-back'), (link) => [link.getAttribute('referrerpolicy'), link.getAttribute('rel'), link.getAttribute('target'), (link as HTMLAnchorElement).origin]),
      [null, null, null, new URL(site).origin],
    );

    // -- The step's own chapter page, in English or in Spanish, is kept --
    const own: [why: string, query: string, from: string][] = [
      ['the chapter\'s English page', `from=${OWN}`, OWN],
      ['the same, encoded as a browser writes it in a link', 'from=%2Fjourney%2Fhow-bitcoin-works', OWN],
      ['the chapter\'s Spanish page', `from=${OWN_ES}`, OWN_ES],
      ['the Spanish page, encoded', 'from=%2Fes%2Frecorrido%2Fcomo-funciona-bitcoin', OWN_ES],
      ['the first of two', `from=${OWN}&from=//evil.example`, OWN],
      ['among other things in the address', `ref=//evil.example&from=${OWN_ES}&next=https://evil.example`, OWN_ES],
    ];
    for (const [why, query, from] of own) {
      assert.deepEqual(await arrive(query), { href: `${site}${from}#do-${STEP}`, from }, why);
    }

    // -- Anything else is ignored: the link is the step's own chapter, and the note keeps no way back --
    const refused: [why: string, query: string][] = [
      // Plain paths of the main site that are not this step's chapter. Kept, any of them would send the reader
      // back to a page that has no card for the step.
      ['another step\'s chapter', 'from=/journey/what-bitcoin-actually-is'],
      ['another step\'s chapter, encoded', 'from=%2Fjourney%2Fbe-your-own-bank'],
      ['another step\'s chapter, in Spanish', 'from=/es/recorrido/se-tu-propio-banco'],
      ['another page of the site', 'from=/glossary/utxo-unspent-transaction-output'],
      ['the main site\'s front page', 'from=/'],
      ['the Journey\'s own page', 'from=/journey'],
      ['a long plain path, which a link could fill with text of its choosing', `from=/${'a'.repeat(199)}`],
      ['a path that names a reader', 'from=/u/reader-4f1c9a7e-2b6d-4c1e-9d0a-7e5f3b2a1c0d/campaign-77'],
      ['the chapter\'s page with a slash at its end', `from=${OWN}/`],
      ['the chapter\'s page with something after it', `from=${OWN}/extra`],
      ['the chapter\'s Spanish path without its language', 'from=/recorrido/como-funciona-bitcoin'],
      ['a plain first value that is not the chapter, with the chapter after it', `from=/newsletter&from=${OWN}`],
      // Everything that is no plain path at all.
      ['a full address', 'from=https://evil.example/journey/how-bitcoin-works'],
      ['a full address, encoded', 'from=https%3A%2F%2Fevil.example%2Fjourney%2Fhow-bitcoin-works'],
      ['the main site\'s own full address of the chapter', 'from=https://www.learnbitcoin.com/journey/how-bitcoin-works'],
      ['an address without its scheme', 'from=//evil.example/journey'],
      ['the same, encoded', 'from=%2F%2Fevil.example%2Fjourney'],
      ['a second slash inside the path', 'from=/journey//how-bitcoin-works'],
      ['a backslash', 'from=/%5Cevil.example'],
      ['a backslash, as typed', 'from=/\\evil.example'],
      ['dots that climb out', 'from=/journey/../../evil'],
      ['dots that come back to the chapter', 'from=/journey/x/../how-bitcoin-works'],
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
      ['a letter with an accent', 'from=/es/recorrido/c%C3%B3mo-funciona-bitcoin'],
      ['a line break', 'from=/journey/how%0Abitcoin-works'],
      ['a NUL character', 'from=/journey/how-bitcoin-works%00'],
      ['an underscore', 'from=/journey/how_bitcoin_works'],
      ['a path of 201 characters', `from=/${'a'.repeat(200)}`],
      ['a very long path', `from=/${'journey/'.repeat(400)}how-bitcoin-works`],
      ['an empty value', 'from='],
      ['the name in capitals', `FROM=${OWN}`],
      ['a hostile first value with the chapter after it', `from=//evil.example&from=${OWN}`],
    ];
    for (const [why, query] of refused) {
      assert.deepEqual(await arrive(query), { href: `${site}${OWN}#do-${STEP}`, from: undefined }, why);
      // Nothing of what the address said is kept: the note is the one any first opening of the step writes.
      assert.deepEqual((await noteOf(page))?.steps, { [STEP]: { started: true } }, why);
      // "Without a word": the screen is the step's own, with nothing said about the address.
      assert.equal(await page.text('step-title'), en['title_pass-it-on'], why);
      assert.equal(await countOf(page, 'do-no-storage'), 0, why);
    }

    // -- The latest of the chapter's two pages wins. An opening with anything else, or with none, leaves the earlier one alone. --
    assert.deepEqual(await arrive(`from=${OWN}`), { href: `${site}${OWN}#do-${STEP}`, from: OWN });
    assert.deepEqual(await arrive('from=//evil.example/journey', { fresh: false }), { href: `${site}${OWN}#do-${STEP}`, from: OWN });
    assert.deepEqual(await arrive('from=/journey/be-your-own-bank', { fresh: false }), { href: `${site}${OWN}#do-${STEP}`, from: OWN });
    assert.deepEqual(await arrive('', { fresh: false }), { href: `${site}${OWN}#do-${STEP}`, from: OWN });
    assert.deepEqual(await arrive(`from=${OWN_ES}`, { fresh: false }), { href: `${site}${OWN_ES}#do-${STEP}`, from: OWN_ES });

    // -- A reader who came from the English chapter and then switches the wallet to Spanish still goes back to
    //    the English chapter: the switch is no new opening, and the Spanish page loaded again reads the same
    //    way back from its address --
    assert.deepEqual(await arrive(`from=${OWN}`), { href: `${site}${OWN}#do-${STEP}`, from: OWN });
    const documents = documentsOf(page);
    await switchLanguage(page);
    await arrivesAt(page, `/es/do/${STEP}`);
    await page.page.waitForFunction((wanted) => document.querySelector('[data-testid="step-back"]')?.textContent?.trim() === wanted, {}, strings.doit.es.back);
    counted.push(view(`/es/do/${STEP}`));
    assert.equal(documentsOf(page), documents, 'the switch loads no page');
    assert.equal(await page.text('step-title'), strings.doit.es['title_pass-it-on']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${OWN}#do-${STEP}`, 'the Spanish wallet leads back to the English chapter the reader came from');
    assert.equal((await noteOf(page))?.steps[STEP]?.from, OWN);
    await reloadStep(page);
    counted.push(view(`/es/do/${STEP}`));
    assert.equal(await hrefOf(page, 'step-back'), `${site}${OWN}#do-${STEP}`, 'and still does after the Spanish page was loaded again');
    assert.equal((await noteOf(page))?.steps[STEP]?.from, OWN);

    // -- A way back that is in the stored note already and is not the step's own chapter (written by anything
    //    but this page) is dropped when the note is read, and is gone from it at the next write --
    const at = Date.now();
    for (const planted of ['//evil.example/journey', 'https://evil.example/', '/journey/../x', `/${'a'.repeat(200)}`, '/newsletter', '/journey/be-your-own-bank', `${OWN}/`, '/u/reader-4f1c9a7e/campaign-77']) {
      await page.store(PROGRESS_KEY, noteFor({ following: STEP, followedAt: at, steps: { [STEP]: { started: true, from: planted } } }));
      assert.deepEqual(await arrive('', { fresh: false }), { href: `${site}${OWN}#do-${STEP}`, from: undefined }, planted);
      assert.ok(!((await noteText(page)) ?? '').includes('from'), `${planted}: the note that was written back has no way back in it`);
    }

    // -- A step that is done: the same way back, now with the mark the chapter stamps on --
    const done = { started: true as const, doneAt: at, parts: { 1: true as const, 2: true as const, 3: true as const } };
    await page.store(PROGRESS_KEY, noteFor({ following: null, steps: { [STEP]: { ...done, from: OWN_ES } } }));
    assert.deepEqual(await arrive('', { fresh: false }), { href: `${site}${OWN_ES}#done=${STEP}`, from: OWN_ES });
    assert.equal(await countOf(page, 'step-done'), 1);
    for (const planted of ['//evil.example/journey', '/journey/what-bitcoin-actually-is', '/newsletter']) {
      await page.store(PROGRESS_KEY, noteFor({ following: null, steps: { [STEP]: { ...done, from: planted } } }));
      assert.equal((await arrive('', { fresh: false })).href, `${site}${OWN}#done=${STEP}`, planted);
    }
    // A "from" in the address of a done step that is not its chapter changes nothing either.
    assert.equal((await arrive(`from=/journey/how-bitcoin-works%23done%3Dhold-some`, { fresh: false })).href, `${site}${OWN}#done=${STEP}`);
    assert.equal((await arrive('from=/journey/be-your-own-bank', { fresh: false })).href, `${site}${OWN}#done=${STEP}`);

    // -- The strip of a done step carries the same link: on Home, for a step that was finished elsewhere --
    await page.store(PROGRESS_KEY, noteFor({ following: STEP, followedAt: at, steps: { [STEP]: { ...done, from: OWN_ES } } }));
    await page.goto('/');
    counted.push(view('/'));
    await untilStrip(page, STEP, 'done');
    assert.equal(await hrefOf(page, 'strip-chapter'), `${site}${OWN_ES}#done=${STEP}`);
    assert.deepEqual(
      await page.page.$eval(hook('strip-chapter'), (link) => [link.getAttribute('referrerpolicy'), link.getAttribute('rel'), link.getAttribute('target')]),
      [null, null, null],
    );
    for (const planted of ['//evil.example', '/journey/be-your-own-bank']) {
      await page.store(PROGRESS_KEY, noteFor({ following: STEP, followedAt: at, steps: { [STEP]: { ...done, from: planted } } }));
      await page.goto('/');
      counted.push(view('/'));
      await untilStrip(page, STEP, 'done');
      assert.equal(await hrefOf(page, 'strip-chapter'), `${site}${OWN}#done=${STEP}`, planted);
    }

    // -- In Spanish, with no way back noted, the step's own chapter is the Spanish page --
    await page.store(PROGRESS_KEY, null);
    await page.goto(`/es/do/${STEP}`);
    await page.waitFor('step-parts');
    counted.push(view(`/es/do/${STEP}`));
    assert.equal(await hrefOf(page, 'step-back'), `${site}${OWN_ES}#do-${STEP}`);
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
    // Over a note that was read, the list says what such a note holds.
    assert.equal(await page.text('do-forget-what'), en.forgetWhat);
    assert.equal(await countOf(page, 'do-forget-unreadable'), 0);
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
    // It speaks of what this site keeps, which is all the button can erase: not of everything in the browser.
    assert.ok(question.includes('Every tick and every finished step is erased from what this site keeps in this browser.'), question);
    assert.ok(!/erased from this browser/.test(question), question);
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
    assert.equal(en.forgotten, 'Your "Do it" progress was forgotten. This site keeps none of it in this browser now.');
    assert.equal(await page.waitForStatus(en.forgotten), en.forgotten);
    // And that is so: of all this site keeps in this browser, the wallet's record is what is left.
    assert.deepEqual(await storageKeys(page), ['lbp_wallet_v1']);
    assert.deepEqual(await page.page.evaluate(() => [sessionStorage.length, document.cookie]), [0, '']);
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
  'What is stored under the note\'s key and is no note counts as no progress, is left alone by the list and by About, which both say that something is stored there that this page cannot read, and is replaced when a step is opened; in a note, a field that fails its check is dropped by itself, a step this version does not know is not read, and the rest stands',
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
    // What the list says is kept is said of what is there: something this page cannot read, in About's own
    // words. The sentence written for a note (which steps were opened and done, which parts are ticked) is not
    // drawn over a value nobody could read.
    assert.equal(await page.text('do-forget-unreadable'), en.forgetUnreadable);
    assert.equal(en.forgetUnreadable, `${about.noteUnreadableNow.replace(/\.$/, '')}. "${en.forget}" erases it.`);
    assert.equal(await countOf(page, 'do-forget-what'), 0);
    assert.ok(!(await page.page.evaluate(() => document.body.innerText)).includes('keeps a note of your progress'), 'the note\'s sentence stands over a value that is no note');
    assert.equal(await noteText(page), NONSENSE);

    // -- About says what is so: no wallet, and something stored where the note goes that this page cannot
    //    read. Not "Nothing": the key holds text, and the list has just offered to erase it. --
    const rightNow = async (path: string): Promise<{ kept: string | null; note: string | null; says: string; also: string[] }> => {
      await page.goto(path);
      await page.waitFor('about-kept-now');
      return {
        kept: await attributeOf(page, 'about-kept-now', 'data-kept'),
        note: await attributeOf(page, 'about-kept-now', 'data-note'),
        says: await page.text('about-kept-now'),
        also: await page.texts('about-kept-note'),
      };
    };
    assert.deepEqual(await rightNow('/about'), {
      kept: 'none',
      note: 'unreadable',
      says: `${about.keepNowLabel} ${about.noWalletNow} ${about.noteUnreadableNow}`,
      also: [about.noteUnreadableNow],
    });
    assert.equal(about.noteUnreadableNow, 'Something is stored where the note of your "Do it" progress goes, and this page cannot read it.');
    assert.deepEqual(await rightNow('/es/about'), {
      kept: 'none',
      note: 'unreadable',
      says: `${strings.about.es.keepNowLabel} ${strings.about.es.noWalletNow} ${strings.about.es.noteUnreadableNow}`,
      also: ['Hay algo guardado donde va la nota de tu progreso de "Hazlo", y esta página no puede leerlo.'],
    });
    // Reading About wrote nothing over it either.
    assert.equal(await noteText(page), NONSENSE);
    // The list in Spanish says the same of it, and offers the same button.
    await page.goto('/es/do');
    await page.waitFor('do-list');
    assert.equal(await page.text('do-forget-unreadable'), 'Hay algo guardado donde va la nota de tu progreso de "Hazlo", y esta página no puede leerlo. "Olvidar mi progreso" lo borra.');
    assert.equal(await countOf(page, 'do-forget-what'), 0);
    assert.equal(await page.text('do-forget'), strings.doit.es.forget);
    assert.equal(await noteText(page), NONSENSE);
    await page.goto('/do');
    await page.waitFor('do-list');

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
    // This one is a note, and was read: the list says what a note holds, and no longer that it cannot read it.
    assert.equal(await page.text('do-forget-what'), en.forgetWhat);
    assert.equal(await countOf(page, 'do-forget-unreadable'), 0);
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
    // With a note that can be read, About says that the note is kept: the one sentence for a browser with no wallet.
    assert.deepEqual(await rightNow('/about'), { kept: 'none', note: 'yes', says: `${about.keepNowLabel} ${about.noteOnlyNow}`, also: [] });

    // -- A wallet in the browser, and again something in the note's place that is no note: About says the
    //    wallet's line, and then that something is stored there that it cannot read --
    await page.store('lbp_wallet_v1', JSON.stringify(testRecord()));
    await page.store(PROGRESS_KEY, NONSENSE);
    assert.deepEqual(await rightNow('/about'), {
      kept: 'words',
      note: 'unreadable',
      says: `${about.keepNowLabel} ${about.keepNowWords} ${about.noteUnreadableNow}`,
      also: [about.noteUnreadableNow],
    });
    assert.equal(await noteText(page), NONSENSE);

    // What must not show up anywhere is held against the harness's own test wallet, the one that was put into this
    // browser at the end. What is stored for the steps is the text the scenario put there, to the last character.
    await ends(
      s,
      reader,
      [view('/do'), view('/about'), view('/es/about'), view('/es/do'), view('/do'), view('/do/the-seed'), view('/do'), view('/do/hold-some'), view('/about'), view('/about')],
      { records: [testRecord()], words: [WORDS], addresses: [testRecord().firstAddress], txids: [] },
      { untouched: NONSENSE },
    );
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

scenario(
  'In a browser that fails the wallet\'s self-test About speaks of the wallet only: before any step it says that no wallet is read or stored here, and once a step\'s screen has been opened it adds that the note of the progress is kept, in both languages, and the strip says that the wallet cannot run in this browser and nothing of a stored wallet; the wallet\'s record that was stored before is never read, changed or removed, and "Forget my progress" takes the second sentence away again',
  { timeout: 150_000 },
  async (s) => {
    const record = testRecord();
    const kept = JSON.stringify(record);
    const page = await standBy(s, { record, timeout: 30_000 });
    const reader = { page, requests: watchEventRequests(page) };
    // In every page from here on, before any script of the app runs. The salt of the seed is turned into
    // something else, so every key this browser derives is wrong and the wallet's self-test fails. And every
    // call to the browser's storage is written down, with the key it names.
    await page.page.evaluateOnNewDocument(() => {
      const normalize = String.prototype.normalize;
      String.prototype.normalize = function wrong(this: string, form?: string): string {
        const out = normalize.call(this, form);
        return form === 'NFKD' && out.startsWith('mnemonic') ? `${out}x` : out;
      };
      const calls: string[] = [];
      (window as unknown as { __storageCalls: string[] }).__storageCalls = calls;
      for (const name of ['getItem', 'setItem', 'removeItem'] as const) {
        const real = Storage.prototype[name] as (this: Storage, ...args: string[]) => unknown;
        (Storage.prototype as unknown as Record<string, unknown>)[name] = function watched(this: Storage, ...args: string[]): unknown {
          calls.push(`${name} ${String(args[0])}`);
          return real.apply(this, args);
        };
      }
    });
    /** What the app asked of the storage in the document that is showing. (Asked first: the harness's own looks at the storage come after.) */
    const storageCalls = (): Promise<string[]> => page.page.evaluate(() => [...(window as unknown as { __storageCalls: string[] }).__storageCalls]);
    /** About's line "In this browser right now": what it is about, whether a note is there, and its words. */
    const rightNow = async (path: string): Promise<{ kept: string | null; note: string | null; says: string; also: string[]; calls: string[] }> => {
      await page.goto(path);
      await page.waitFor('about-kept-now');
      await page.settle();
      const calls = await storageCalls();
      return {
        kept: await attributeOf(page, 'about-kept-now', 'data-kept'),
        note: await attributeOf(page, 'about-kept-now', 'data-note'),
        says: await page.text('about-kept-now'),
        also: await page.texts('about-kept-note'),
        calls,
      };
    };

    // -- Before any step: the line speaks of the wallet, and nothing follows it. The page has looked for a note
    //    and for nothing else. --
    const before = await rightNow('/about');
    assert.deepEqual([before.kept, before.note], ['broken', 'no']);
    assert.equal(before.says, `${about.keepNowLabel} ${about.keepNowBroken}`);
    assert.equal(about.keepNowBroken, "Not known. This browser failed the wallet's self-test, so this page does not read or store a wallet here.");
    assert.deepEqual(before.also, []);
    assert.ok(before.calls.length > 0 && before.calls.every((call): boolean => call === `getItem ${PROGRESS_KEY}`), before.calls.join(', '));
    assert.deepEqual(await storageKeys(page), ['lbp_wallet_v1']);

    // -- A step's screen, opened as a chapter's card opens it: the note is written, in this browser as in any other --
    await page.goto('/do/hold-some?from=/journey/what-bitcoin-actually-is');
    await page.waitFor('step-parts');
    await page.settle();
    const onStep = await storageCalls();
    assert.equal(onStep.filter((call): boolean => call === `setItem ${PROGRESS_KEY}`).length, 1, onStep.join(', '));
    assert.ok(onStep.every((call): boolean => call.endsWith(` ${PROGRESS_KEY}`)), `the wallet's record was touched: ${onStep.join(', ')}`);
    // No wallet can be used here, so no part can be done; and the step does not say that progress cannot be kept, for it is.
    assert.equal((await partsOf(page))[0], 'blocked');
    assert.equal(await countOf(page, 'do-no-storage'), 0);
    const note = await noteOf(page);
    assert.deepEqual(note?.steps, { 'hold-some': { started: true, from: '/journey/what-bitcoin-actually-is' } });
    assert.equal(note?.following, 'hold-some');
    assert.deepEqual(await storageKeys(page), [PROGRESS_KEY, 'lbp_wallet_v1']);

    // -- About now: the same line about the wallet, and then that the note is kept too --
    const after = await rightNow('/about');
    assert.deepEqual([after.kept, after.note], ['broken', 'yes']);
    assert.equal(after.says, `${about.keepNowLabel} ${about.keepNowBroken} ${about.noteAlsoNow}`);
    assert.deepEqual(after.also, [about.noteAlsoNow]);
    assert.ok(after.calls.every((call): boolean => call === `getItem ${PROGRESS_KEY}`), after.calls.join(', '));
    // The strip under the header, on this screen: the step the reader is on, and why it cannot go on. Nothing
    // was read here and no wallet can have been made, so it says nothing of a stored wallet: it says that the
    // wallet cannot run in this browser.
    const strip = await untilStrip(page, 'hold-some', 'need');
    assert.equal(strip.words, en.stripNeed_broken);
    assert.equal(strip.words, 'the wallet cannot run in this browser');
    assert.ok(!/stored wallet/.test(strip.text), strip.text);
    const spanish = await rightNow('/es/about');
    const tira = await untilStrip(page, 'hold-some', 'need');
    assert.equal(tira.words, strings.doit.es.stripNeed_broken);
    assert.equal(tira.words, 'la billetera no funciona en este navegador');
    assert.ok(!/billetera guardada/.test(tira.text), tira.text);
    assert.deepEqual([spanish.kept, spanish.note], ['broken', 'yes']);
    assert.equal(spanish.says, `${strings.about.es.keepNowLabel} ${strings.about.es.keepNowBroken} ${strings.about.es.noteAlsoNow}`);
    assert.equal(
      spanish.says,
      'En este navegador, ahora mismo No se sabe. Este navegador no pasó la comprobación interna de la billetera, así que esta página no lee ni guarda ninguna billetera aquí. Este navegador también guarda la nota de tu progreso de "Hazlo".',
    );
    // What the line says of the wallet is so: the record that was stored is there, character for character.
    assert.equal(await page.stored(), kept);

    // -- The list reads the note back, and "Forget my progress" erases it: the second sentence goes with it --
    await page.goto('/do');
    await page.waitFor('do-list');
    assert.equal(await listState(page, 'hold-some'), 'started');
    await page.click('do-forget');
    await page.waitFor('do-forget-confirm');
    await untilAnswersCount();
    await page.click('do-forget-confirm');
    await page.waitFor('do-forgotten');
    assert.deepEqual(await storageKeys(page), ['lbp_wallet_v1']);
    const forgotten = await rightNow('/about');
    assert.deepEqual([forgotten.kept, forgotten.note], ['broken', 'no']);
    assert.equal(forgotten.says, `${about.keepNowLabel} ${about.keepNowBroken}`);
    assert.equal(await page.stored(), kept);
    assert.deepEqual(stepsCounted(s), {});

    await ends(s, reader, [view('/about'), view('/do/hold-some'), view('/about'), view('/es/about'), view('/do'), view('/about')], {
      records: [record],
      words: [WORDS],
      addresses: [record.firstAddress],
      txids: [],
    });
  },
);

scenario(
  'What a read dropped from the note leaves the browser at the next write, whatever that write is for: under a note of this version that holds two ways back that are not the step\'s own chapter and fields this page does not know, with every started step done and none followed, the list, About and Home read it and write nothing, and the first step screen that is opened, a done one, stores the note again as this page writes it',
  { timeout: 150_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const at = Date.now() - 3 * 86_400_000;
    // As a hand or another program might leave it: this page never writes such a note. Two steps done three
    // days ago, each with a way back that is not its own chapter's page, and fields no version has had.
    const PLANTED = JSON.stringify({
      v: 1,
      following: null,
      steps: {
        'hold-some': { started: true, doneAt: at, from: '/u/reader-4f1c9a7e/campaign-77', parts: { 1: true, 2: true, 3: true, 4: true }, memo: 'kept by hand' },
        'pass-it-on': { started: true, doneAt: at, from: '/newsletter', parts: { 1: true, 2: true, 3: true } },
      },
      words: 'never here',
    });
    const PLANTED_TEXT = ['campaign-77', 'reader-4f1c9a7e', '/newsletter', 'never here', 'kept by hand', 'memo', 'from'];
    const reader = await begin(s, '/do', { storage: { [PROGRESS_KEY]: PLANTED } });
    const { page } = reader;

    // -- The list reads the note: two steps done, none followed. What this page does not know is as if it were
    //    not there, and no screen is shown it. A look is no change: the stored text is as it was. --
    await page.waitFor('do-list');
    assert.deepEqual([await listState(page, 'hold-some'), await listState(page, 'pass-it-on'), await listState(page, 'no-balances')], ['done', 'done', 'not-started']);
    assert.equal(await countOf(page, 'do-following'), 0);
    for (const text of PLANTED_TEXT.slice(0, 5)) assert.ok(!(await page.page.evaluate(() => document.documentElement.outerHTML)).includes(text), text);
    assert.equal(await noteText(page), PLANTED);

    // -- About and Home read it too, and write nothing --
    await page.goto('/about');
    await page.waitFor('about-kept-now');
    assert.equal(await attributeOf(page, 'about-kept-now', 'data-note'), 'yes');
    assert.equal(await noteText(page), PLANTED);
    await page.goto('/');
    await page.waitFor('home-do-link');
    assert.equal(await stripOf(page), null);
    assert.equal(await noteText(page), PLANTED);

    // -- A done step's screen is opened. Nothing about the step changes: it was done, and it is not followed.
    //    But a step's screen hands the note to the one function that writes it, and that function stores the
    //    note as it was read. The two ways back and the fields this page does not know are out of the browser. --
    await page.click('home-do-link');
    await arrivesAt(page, '/do');
    assert.equal(await noteText(page), PLANTED);
    await pickStep(page, 'hold-some');
    await page.waitFor('step-done');
    // The link back was built from the note as read all along: the step's own chapter, in this page's language.
    assert.equal(await hrefOf(page, 'step-back'), `${site}/journey/what-bitcoin-actually-is#done=hold-some`);
    const tidy = await noteText(page);
    assert.ok(tidy !== null);
    assert.deepEqual(JSON.parse(tidy), {
      v: 1,
      following: null,
      steps: {
        'hold-some': { started: true, doneAt: at, parts: { 1: true, 2: true, 3: true, 4: true } },
        'pass-it-on': { started: true, doneAt: at, parts: { 1: true, 2: true, 3: true } },
      },
    });
    for (const text of PLANTED_TEXT) assert.ok(!tidy.includes(text), `the stored note still holds "${text}"`);

    // -- From here on the stored text is what this page writes, and a visit that changes nothing writes nothing --
    await reloadStep(page);
    await page.waitFor('step-done');
    assert.equal(await noteText(page), tidy);
    await page.click('step-list');
    await arrivesAt(page, '/do');
    await pickStep(page, 'pass-it-on');
    await page.waitFor('step-done');
    assert.equal(await hrefOf(page, 'step-back'), `${site}/journey/how-bitcoin-works#done=pass-it-on`);
    assert.equal(await noteText(page), tidy);
    // Both steps were done on an earlier visit: nothing here counted either again.
    assert.deepEqual(stepsCounted(s), {});

    // The end holds the stored note to its closed shape (noteIsPublic): the listed fields and no others, and a
    // way back that is the step's own chapter or is not there. No wallet was ever in this browser: what must
    // not show up anywhere is held against the harness's own test wallet.
    await ends(
      s,
      reader,
      [view('/do'), view('/about'), view('/'), view('/do'), view('/do/hold-some'), view('/do/hold-some'), view('/do'), view('/do/pass-it-on')],
      { records: [testRecord()], words: [WORDS], addresses: [testRecord().firstAddress], txids: [] },
    );
  },
);

scenario(
  'A done step on a later day, in a browser that has no wallet any more: each of the six cards says what the reader did and saw, in the past tense, in English and in Spanish, and nothing of what the wallet, the chain or the pot holds now',
  { timeout: 150_000 },
  async (s) => {
    // All six steps, done three days ago. Since then the wallet was removed from this browser, and the practice
    // chain here has never heard of it: no coin of it, no payment, nothing in the pot from it.
    const at = Date.now() - 3 * 86_400_000;
    const stored = noteFor({ following: null, steps: Object.fromEntries(STEPS.map((id) => [id, { started: true as const, doneAt: at }])) });
    const reader = await begin(s, '/do', { storage: { [PROGRESS_KEY]: stored } });
    const { page } = reader;
    await page.waitFor('do-list');
    assert.deepEqual(await storageKeys(page), [PROGRESS_KEY]);
    assert.deepEqual(
      await page.page.$$eval(hook('do-state'), (states) => states.map((state) => state.getAttribute('data-state'))),
      STEPS.map(() => 'done'),
    );

    // What each card says, word for word. Each is what happened on the day, so it is as true today.
    const SAID: Record<(typeof STEPS)[number], string> = {
      'hold-some':
        "You got practice coins, and you named the block that took the first of them in. A block explorer shows a chain to anyone who asks, with no wallet at all, so nobody has to take a wallet's word for what is on it. On Bitcoin it works the same way: verify, don't trust.",
      'pass-it-on': 'Your payment got into a block, and the pot took your coins to hand on to a learner who comes after you. The fee was what went in less what came out.',
      'no-balances':
        'You counted the coins in your wallet, and opened one of its payments to see what it did to them. A wallet keeps no balance: it holds coins, and its total is what they add up to. A payment uses coins up whole and makes new ones: one for the address paid and, when something is left over, one back to you as change.',
      'waiting-room':
        'Your payment reached six confirmations: its own block and five on top. On Bitcoin, undoing a payment that deep means redoing all six blocks faster than the rest of the network adds new ones. That is why six confirmations is the usual line for "settled".',
      'the-seed': 'You said you wrote your 12 words on paper, and three of them matched. Three right words do not prove the other nine: "Prove the backup" does that.',
      'prove-the-backup': 'The wallet came back from its 12 words, with its coins. The chain kept them the whole time, and the words only unlocked them: you own keys, not coins.',
    };
    // What would be a claim about today: what the reader, the wallet or the pot holds, where a payment is.
    const NOW = {
      en: /\byou hold\b|\byour wallet (holds|keeps|has)\b|\bis in a block\b|\bholds your coins\b|\bhas six confirmations\b|\bare on paper\b|\bstill\b|\bnow\b|\btoday\b/i,
      es: /\btienes monedas\b|\btu billetera (tiene|guarda)\b|\bestá en un bloque\b|\bguarda tus monedas\b|\btiene seis confirmaciones\b|\bestán en papel\b|\btodavía\b|\bahora\b|\bhoy\b/i,
    };
    const counted: EventBody[] = [view('/do')];
    for (const id of STEPS) {
      for (const lang of ['en', 'es'] as const) {
        const path = `${lang === 'es' ? '/es' : ''}/do/${id}`;
        await page.goto(path);
        await page.waitFor('step-done');
        counted.push(view(path));
        const said = await page.text('step-done-text');
        assert.equal(said, strings.doit[lang][`done_${id}`], `${id} (${lang})`);
        if (lang === 'en') assert.equal(said, SAID[id], id);
        assert.doesNotMatch(said, NOW[lang], `${id} (${lang})`);
        // No wallet is here, and the card does not ask for one: a done step needs nothing.
        assert.equal(await countOf(page, 'step-need'), 0, `${id} (${lang})`);
      }
    }
    // Nothing was written, and nothing was counted again.
    assert.equal(await noteText(page), stored);
    assert.deepEqual(stepsCounted(s), {});
    // No wallet is in this browser: what must not show up anywhere is held against the harness's own test wallet.
    await ends(s, reader, counted, { records: [testRecord()], words: [WORDS], addresses: [testRecord().firstAddress], txids: [] });
  },
);
