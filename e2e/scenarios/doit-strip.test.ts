// The strip: the slim line under the header that keeps a reader oriented
// while a "Do it" step sends them through the wallet's own screens.
//
// A step's parts are done on Receive, on Send, on Backup, on Settings, and
// nothing on those screens knows about the step. The strip is what holds the
// two together: it names the step and the part that is next, leads back to
// the step and, for a reader who came from a chapter, back to the chapter,
// and can be told to go away. The step scenarios meet it on the way (and
// across the page load after the bot check: doit-hold-some.test.ts). What
// decides whether it carries the link back to the chapter while a step is
// under way, and where that link leads when a need of another step sent
// the reader on, is in doit-handover.test.ts. These follow the strip
// itself:
//
//   1. it is on every screen of the app but the followed step's own, and
//      for a step that was reached by its card in a chapter it carries
//      the way back to that chapter from the start; "Stop following"
//      takes it off all of them, and from then on what the reader does
//      counts for no step; the step's action link follows the step
//      again; when the step is done on another screen the strip says so,
//      once, and its way back to the chapter now says that the step is
//      done, until it is closed
//   2. it shows for 24 hours after the step was last followed, and is back
//      when a part of that step is ticked
//   3. with two tabs on two steps, the step that is followed is the one of
//      the tab that came back into view, and the other tab's strip says so
//
// The first two are local only: they pay the wallet from the stand-in and
// make blocks. The third touches nothing of the stand-in and could run
// against a real practice network as it is.

import assert from 'node:assert/strict';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { OTHER_WORDS, TEST_WORDS, freshRecord, fundTestWallet, scenario, testRecord } from './helpers.ts';
import {
  SECTIONS,
  arrivesAt,
  attributeOf,
  countOf,
  documentsOf,
  focusOf,
  goHome,
  headerLink,
  hook,
  standBy,
  toSection,
  until,
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
  listState,
  noteFor,
  noteOf,
  partName,
  partsOf,
  pay,
  pickStep,
  saidDone,
  stepsCounted,
  stripBack,
  stripOf,
  titleOf,
  untilParts,
  untilStrip,
  view,
  type Reader,
} from './doit-helpers.ts';

const en = strings.doit.en;

const WORDS = TEST_WORDS.split(' ');

/** An address that is neither the wallet's nor the pot's: the first address of the harness's second wallet. */
const SOMEBODY = testRecord(OTHER_WORDS).firstAddress;

scenario(
  'The strip is on every screen but the followed step\'s own, with the way back to the chapter beside the way back to the step for a step that was reached by its card; "Stop following" takes it off them all, and a payment sent while no step is followed counts for none; the step\'s action link follows it again; done on another screen, the strip says so once, with the way back to the chapter, until it is closed',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const STEP = 'waiting-room';
    const FROM = '/journey/how-bitcoin-works';
    const record = testRecord();
    const funded = fundTestWallet(s.standIn);
    const reader = await begin(s, `/do/${STEP}?from=${FROM}`, { record });
    const { page } = reader;
    await untilParts(page, ['now', 'later', 'later']);
    assert.equal(await stripOf(page), null, 'the step\'s own screen carries no strip');
    const documents = documentsOf(page);

    // -- Into the wallet by the step's action: the strip names the step, how far it is, the part, and the things to do.
    //    The reader came by the step's card in chapter 3, so the way back to the chapter stands beside the way back to the step. --
    await act(page, '/wallet/send');
    const onSend = await untilStrip(page, STEP, 'part');
    assert.equal(onSend.words, partName(STEP, 1));
    assert.equal(await attributeOf(page, 'strip', 'aria-label'), en.stripLabel);
    // The whole line as the page holds it: the short form of "how far" is there for a narrow screen, and not drawn on this one.
    const count = { n: '1', m: '3' };
    assert.equal(
      await page.text('strip'),
      `${en.name} ${titleOf(STEP)} ${fill(en.stripShort, count)} ${fill(en.stripPart, count)}: ${partName(STEP, 1)} ${en.stripBack} ${en.back} ${en.stripStop}`,
    );
    assert.equal(
      await page.page.$eval(hook('strip-says'), (says) => getComputedStyle(says.parentElement!).display !== 'none'),
      true,
      'on a wide screen the part is named',
    );
    assert.equal(await hrefOf(page, 'strip-back'), `/do/${STEP}`);
    // The step is not done: the link back names its card on the chapter's page the reader came from, and marks nothing.
    assert.equal(await hrefOf(page, 'strip-chapter'), `${site}${FROM}#do-${STEP}`);

    // -- Every screen of the wallet in turn, then Home, About, the Sparrow page and the list of steps --
    for (const path of SECTIONS) {
      if (path === '/wallet/send') continue;
      await toSection(page, path);
      assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 1), path);
      assert.equal(await hrefOf(page, 'strip-chapter'), `${site}${FROM}#do-${STEP}`, path);
    }
    await goHome(page);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 1), 'Home');
    for (const path of ['/about', '/sparrow']) {
      await headerLink(page, path);
      await arrivesAt(page, path);
      assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 1), path);
    }
    await goHome(page);
    await page.click('home-do-link');
    await arrivesAt(page, '/do');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 1), 'the list of steps');
    assert.deepEqual(await page.page.$$eval(hook('do-following'), (marks) => marks.map((mark) => mark.closest('li')?.getAttribute('data-step'))), [STEP]);
    // The step's own screen, reached by the strip: none there.
    await stripBack(page, STEP);
    assert.equal(await stripOf(page), null);
    assert.equal(documentsOf(page), documents, 'all of it in one page');

    // -- "Stop following", on the strip: it is gone from every screen, and the note follows no step --
    await act(page, '/wallet/send');
    await untilStrip(page, STEP, 'part');
    await page.page.evaluate(() => window.scrollTo(0, 0));
    await page.click('strip-stop');
    await page.waitForGone('strip');
    assert.equal(await focusOf(page), 'H1', 'the button that was pressed is gone, and the keyboard is on the screen\'s heading');
    const stopped = await noteOf(page);
    assert.deepEqual([stopped?.following, stopped?.followedAt], [null, undefined]);
    assert.deepEqual(stopped?.steps, { 'waiting-room': { started: true, from: FROM } }, 'the step is still started: only the following ended');
    for (const path of ['/wallet/coins', '/wallet', '/wallet/send']) {
      await toSection(page, path);
      assert.equal(await stripOf(page), null, path);
    }

    // -- A payment sent now is exactly what the step's first part asks for, and counts for nothing: no step is followed --
    const unseen = await pay(page, SOMEBODY, '10,000');
    await page.settle();
    assert.deepEqual((await noteOf(page))?.steps, { 'waiting-room': { started: true, from: FROM } });
    assert.equal(await stripOf(page), null);
    // The step, opened again in the same page: it is followed again, and the payment made meanwhile is not its payment.
    await toSection(page, '/wallet');
    await page.click('overview-do-link');
    await arrivesAt(page, '/do');
    assert.equal(await countOf(page, 'do-following'), 0);
    assert.equal(await listState(page, STEP), 'started');
    await pickStep(page, STEP);
    assert.deepEqual(await partsOf(page), ['now', 'later', 'later']);
    assert.equal((await noteOf(page))?.following, STEP);

    // -- "Stop following", on the step's own screen. Then the step's action link: using it follows the step again. --
    assert.equal(await page.text('step-stop'), en.stop);
    await page.click('step-stop');
    await page.waitForGone('step-stop');
    assert.equal(await focusOf(page), 'step-title');
    assert.equal((await noteOf(page))?.following, null);
    assert.equal(await countOf(page, 'step-restart'), 1, 'the step can still be started again');
    await act(page, '/wallet/send');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 1));
    assert.equal((await noteOf(page))?.following, STEP);

    // -- The payment, sent while the step is followed. On Send the strip names the next part; on the Overview,
    //    where the wallet reads its list of transactions, it says what the part waits for. --
    const paid = await pay(page, SOMEBODY, '5,000');
    assert.equal((await noteOf(page))?.steps[STEP]?.tx, paid.txid);
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));
    await toSection(page, '/wallet');
    assert.match((await untilStrip(page, STEP, 'waiting')).words, /^waiting for a block, sent (just now|\d+ seconds? ago)$/);

    // -- Its block and five more come while the reader is on the Overview: the step is done there, and the strip says so --
    page.forgetStatus();
    await s.network.nextBlock();
    s.standIn.mine(5);
    const done = await untilStrip(page, STEP, 'done');
    assert.equal(done.words, fill(en.stripDone, { step: titleOf(STEP) }));
    assert.equal(await page.waitForStatus(saidDone(STEP)), saidDone(STEP));
    assert.equal(await page.text('strip'), `${en.name} ${fill(en.stripDone, { step: titleOf(STEP) })} ${en.stripBack} ${en.back} ${en.stripClose}`);
    // The way back to the chapter, which now says that the step is done (and would name the other done steps
    // of chapter 3 after it: there are none): the chapter's page the reader came from.
    // It stays in this tab, and nothing on it asks for a referrer to be sent: the page's own policy sends none.
    assert.equal(await hrefOf(page, 'strip-chapter'), `${site}${FROM}#done=${STEP}`);
    assert.deepEqual(
      await page.page.$eval(hook('strip-chapter'), (link) => [link.getAttribute('referrerpolicy'), link.getAttribute('rel'), link.getAttribute('target')]),
      [null, null, null],
    );
    assert.equal(await hrefOf(page, 'strip-back'), `/do/${STEP}`);
    assert.deepEqual(stepsCounted(s), { 'waiting-room': 1 });
    // It stays, screen after screen, and is said once.
    for (const path of ['/wallet/coins', '/wallet/activity']) {
      await toSection(page, path);
      assert.equal((await untilStrip(page, STEP, 'done')).words, fill(en.stripDone, { step: titleOf(STEP) }), path);
    }
    await page.settle();
    assert.equal(page.statusLog().filter((said) => said === saidDone(STEP)).length, 1, page.statusLog().join(' | '));
    assert.equal((await noteOf(page))?.following, STEP, 'done, and followed until the reader has seen it');

    // -- "Close": the strip goes, on every screen --
    await page.page.evaluate(() => window.scrollTo(0, 0));
    await page.click('strip-stop');
    await page.waitForGone('strip');
    assert.equal((await noteOf(page))?.following, null);
    await toSection(page, '/wallet');
    assert.equal(await stripOf(page), null);
    await page.click('overview-do-link');
    await arrivesAt(page, '/do');
    assert.equal(await listState(page, STEP), 'done');
    await pickStep(page, STEP);
    await page.waitFor('step-done');
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${FROM}#done=${STEP}`);
    assert.equal(documentsOf(page), documents, 'still the one page');
    assert.deepEqual(stepsCounted(s), { 'waiting-room': 1 });

    await ends(
      s,
      reader,
      [
        view('/do/waiting-room'),
        view('/wallet/send'),
        view('/wallet'),
        view('/wallet/coins'),
        view('/wallet/receive'),
        view('/wallet/activity'),
        view('/wallet/backup'),
        view('/wallet/settings'),
        view('/'),
        view('/about'),
        view('/sparrow'),
        view('/'),
        view('/do'),
        view('/do/waiting-room'),
        view('/wallet/send'),
        view('/wallet/coins'),
        view('/wallet'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent' },
        view('/wallet'),
        view('/do'),
        view('/do/waiting-room'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent' },
        view('/wallet'),
        doIt('/wallet', STEP),
        view('/wallet/coins'),
        view('/wallet/activity'),
        view('/wallet'),
        view('/do'),
        view('/do/waiting-room'),
      ],
      {
        records: [record],
        words: [WORDS],
        addresses: [...funded.map((coin) => coin.address), SOMEBODY],
        txids: [...funded.map((coin) => coin.txid), unseen.txid, paid.txid],
      },
    );
  },
);

scenario(
  'The strip shows for 24 hours after a step was last followed: an hour short of that it is there, an hour past it no screen shows it though the note still names the step, and a part of that step ticked now brings it back',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    const STEP = 'pass-it-on';
    const record = testRecord();
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const hours = (count: number): number => count * 3_600_000;
    /** A step under way as an earlier visit left it: its first part ticked, and followed since `followedAt`. */
    const followedSince = (followedAt: number): string => noteFor({ following: STEP, followedAt, steps: { [STEP]: { started: true, parts: { 1: true } } } });
    const reader = await begin(s, '/wallet', { record, storage: { [PROGRESS_KEY]: followedSince(Date.now() - hours(23)) } });
    const { page } = reader;

    // -- Followed 23 hours ago: the strip is there --
    await page.waitFor('coin');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 2));

    // -- Followed 25 hours ago: no screen shows it. The note still says which step it was. --
    await page.store(PROGRESS_KEY, followedSince(Date.now() - hours(25)));
    await page.goto('/wallet');
    await page.waitFor('coin');
    assert.equal(await stripOf(page), null);
    for (const path of ['/wallet/coins', '/wallet/send']) {
      await toSection(page, path);
      await page.settle();
      assert.equal(await stripOf(page), null, path);
    }
    assert.equal((await noteOf(page))?.following, STEP);

    // -- A payment to the pot is that step's next part, and it is still the step that events count for: the
    //    part ticks, the step was followed just now, and the strip is back --
    const before = Date.now();
    const paid = await pay(page, 'pot', '30,000');
    assert.equal((await untilStrip(page, STEP, 'part')).words, partName(STEP, 3));
    const note = await noteOf(page);
    assert.deepEqual([note?.steps[STEP]?.parts, note?.steps[STEP]?.tx], [{ 1: true, 2: true }, paid.txid]);
    assert.ok(note?.followedAt !== undefined && note.followedAt >= before, `followed at ${note?.followedAt}`);
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [view('/wallet'), view('/wallet'), view('/wallet/coins'), view('/wallet/send'), { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' }],
      { records: [record], words: [WORDS], addresses: [record.firstAddress, paid.to], txids: [funding, paid.txid] },
    );
  },
);

scenario(
  'A step\'s tab that comes back into view is the one being followed again: with two tabs of one browser on two steps, the step that is followed, and the strip in the other tab, go with the tab the reader looks at',
  { timeout: 150_000 },
  async (s) => {
    const record = freshRecord();
    assert.ok(record.mnemonic !== undefined);
    const words = record.mnemonic.split(' ');
    const first = await begin(s, '/do/the-seed', { record });
    await untilParts(first.page, ['now', 'later', 'later']);
    assert.equal((await noteOf(first.page))?.following, 'the-seed');

    // -- A second tab of the same browser opens another step: that one is followed now --
    const tab = await standBy(s, { context: first.page.context, timeout: 30_000 });
    const second: Reader = { page: tab, requests: watchEventRequests(tab) };
    await tab.goto('/do/waiting-room');
    await tab.waitFor('step-parts');
    assert.equal((await noteOf(tab))?.following, 'waiting-room');
    // The first tab hears of it: its own step is not the followed one any more, so it carries the other step's strip.
    await until(async () => (await stripOf(first.page))?.step === 'waiting-room', 'the first tab shows the strip of the step the second tab follows');

    // -- The reader goes back to the first tab: its step is the followed one again --
    await first.page.page.bringToFront();
    await until(async () => (await noteOf(first.page))?.following === 'the-seed', 'the step of the tab that came back into view is followed');
    assert.equal(await stripOf(first.page), null);
    await until(async () => (await stripOf(tab))?.step === 'the-seed', 'the second tab shows the strip of the step the first tab follows');

    // -- And to the second tab again --
    await tab.page.bringToFront();
    await until(async () => (await noteOf(tab))?.following === 'waiting-room', 'the step of the tab that came back into view is followed');
    assert.equal(await stripOf(tab), null);
    await until(async () => (await stripOf(first.page))?.step === 'waiting-room', 'the first tab shows the other step\'s strip again');
    // Following a step starts nothing and ticks nothing.
    assert.deepEqual((await noteOf(tab))?.steps, { 'the-seed': { started: true }, 'waiting-room': { started: true } });
    assert.deepEqual(stepsCounted(s), {});

    await endsTwo(
      s,
      [
        { reader: first, expected: [view('/do/the-seed')] },
        { reader: second, expected: [view('/do/waiting-room')] },
      ],
      { records: [record], words: [words], addresses: [record.firstAddress], txids: [] },
    );
  },
);
