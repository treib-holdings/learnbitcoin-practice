// The hand-over between a chapter of the main site and the practice wallet,
// through the real screens: a reader who came from a chapter to do a step
// ends up back in that chapter, at the place they left.
//
// A chapter's card leads into the wallet with "?from=<the chapter's page>".
// From there the reader may be sent on by a need (a step that needs a
// wallet or coins sends a reader who has none to "Hold some"), goes through
// the wallet's own screens, and has to find the way back at every point:
// back to the step, and back to the chapter. These scenarios follow that
// way back.
//
//   1. the whole detour: from the card of "Pass it on" in the payment
//      chapter with no wallet, through "Hold some" and back, with the note
//      read at every turn and every address read to the character
//   2. the reader who gave up half-way, and the other roads into a detour
//   3. a done step's link back names every done step of its chapter, and
//      which buttons a done step's card has by the way the reader came
//   4. the strip's link back to the chapter, on phones too, and the
//      footer's link to the main site
//   5. the faucet's result and "Payment sent" lead back to the step
//   6. "I have written them down" leads back to the step that is followed
//   7. a need's link to another step tells the steps however it is used:
//      from the keyboard, with the middle button, from the browser's menu
//
// No scenario here follows a link to the main site: the main site is no
// part of a scenario's world. Each reads the link's address off the page,
// as the other scenarios of the steps do. doit-chapter.test.ts is the one
// that presses such links, at a stand-in for the main site.
//
// Scenarios 1, 5 and 7 are local only: they ask the faucet (the bot check
// is the harness's stand-in), pay a wallet from the stand-in and make
// blocks. The other four touch nothing of the stand-in, and could run
// against a real practice network as they are.

import assert from 'node:assert/strict';
import type { EventBody, Lang, StepId } from '@learnbitcoin/practice-contract';
import type { ChapterKey } from '../../app/src/lib/doit/steps.ts';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { freshRecord, scenario, testRecord, type OpenedPage } from './helpers.ts';
import {
  RECORD_KEY,
  SECTIONS,
  arrivesAt,
  attributeOf,
  botCheckScripts,
  countOf,
  createFrom,
  documentsOf,
  goHome,
  headerLink,
  hook,
  loads,
  sleep,
  standBy,
  toSection,
  until,
  untilAnswersCount,
  untilPhase,
  watchEventRequests,
} from './journey-helpers.ts';
import {
  PROGRESS_KEY,
  act,
  begin,
  chapterName,
  doIt,
  ends,
  endsTwo,
  hrefOf,
  listState,
  noteFor,
  noteOf,
  noteText,
  partName,
  partsOf,
  pay,
  pickStep,
  stepsCounted,
  storedIsPublic,
  stripOf,
  titleOf,
  untilParts,
  untilStrip,
  view,
  type Progress,
  type Reader,
} from './doit-helpers.ts';

const en = strings.doit.en;
const es = strings.doit.es;
/** The Receive screen's own words: what the faucet's result says. */
const receive = strings.receive.en;

/** The pages of the three chapters that have steps, as the main site writes its own addresses. */
const BITCOIN_PAGE = '/journey/what-bitcoin-actually-is';
const PAYMENT_PAGE = '/journey/how-bitcoin-works';
const PAYMENT_PAGE_ES = '/es/recorrido/como-funciona-bitcoin';
const KEYS_PAGE = '/journey/be-your-own-bank';
const KEYS_PAGE_ES = '/es/recorrido/se-tu-propio-banco';

/**
 * The line under a step's title: the chapter it belongs to, and beside it the link back while the step is not
 * done. The chapter is named by its key: its number and its title are the app's table's (doit-helpers.ts).
 */
const chapterLine = (key: ChapterKey, lang: Lang = 'en'): string => `${chapterName(key, lang)} ${(lang === 'en' ? en : es).back}`;

/** `Back to "Pass it on"`: the words on the button that leads back to a step. */
const backTo = (id: StepId, lang: Lang = 'en'): string => fill((lang === 'en' ? en : es).backTo, { step: titleOf(id, lang) });

/** The address the page is at: its path, with the query string and the part after "#" if it has them. */
const addressOf = (page: OpenedPage): Promise<string> => page.page.evaluate(() => `${location.pathname}${location.search}${location.hash}`);

/** A button or a link of a done step's card. */
interface Way {
  hook: string;
  words: string;
  href: string | null;
  /** Drawn as the main button: filled. Every other one is an outline. */
  main: boolean;
}

/** The ways on of the done card on screen, in the order they stand. */
const waysOf = (page: OpenedPage): Promise<Way[]> =>
  page.page.$$eval(
    ['step-led', 'step-back', 'step-next', 'step-list'].map((id) => `${hook('step-done')} ${hook(id)}`).join(', '),
    (links) =>
      links.map((link) => ({
        hook: link.getAttribute('data-testid') ?? '',
        words: (link.textContent ?? '').replace(/\s+/g, ' ').trim(),
        href: link.getAttribute('href'),
        main: getComputedStyle(link).backgroundColor !== 'rgba(0, 0, 0, 0)',
      })),
  );

/** Whether the element with this hook is drawn as a main button: filled, not an outline. */
const isMain = (page: OpenedPage, id: string): Promise<boolean> =>
  page.page.$eval(hook(id), (button) => getComputedStyle(button).backgroundColor !== 'rgba(0, 0, 0, 0)');

/** How much of the first element with this hook is on screen, under the banner: from 0 (none of it) to 1 (all of it). */
const shareOnScreen = (page: OpenedPage, id: string): Promise<number> =>
  page.page.evaluate((query) => {
    const box = document.querySelector(query)?.getBoundingClientRect();
    if (!box || box.height === 0) return 0;
    const banner = document.querySelector('[role="note"]')?.getBoundingClientRect().bottom ?? 0;
    const shown = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, banner);
    return Math.round((100 * Math.max(0, shown)) / box.height) / 100;
  }, hook(id));

/** Waits until all of the element with this hook is on screen: a scroll takes a frame or two. */
async function untilOnScreen(page: OpenedPage, id: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while ((await shareOnScreen(page, id)) < 1 && Date.now() < deadline) await sleep(50);
  assert.equal(await shareOnScreen(page, id), 1, `${id} is not all on screen`);
}

/**
 * Keeps every text this page stores under the note's key from now on, in
 * the order it stores them, for as long as the document lives. For what
 * one press writes, before the screen it leads to writes on top of it.
 */
async function watchNoteWrites(page: OpenedPage): Promise<() => Promise<Progress[]>> {
  await page.page.evaluate((key) => {
    const seen: string[] = [];
    (window as unknown as { __noteWrites: string[] }).__noteWrites = seen;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, name: string, value: string): void {
      if (name === key) seen.push(value);
      set.call(this, name, value);
    };
  }, PROGRESS_KEY);
  return async () => (await page.page.evaluate(() => [...(window as unknown as { __noteWrites: string[] }).__noteWrites])).map((text) => JSON.parse(text) as Progress);
}

/** Where the strip's two links stand: on one line that neither breaks inside itself nor leaves the screen. */
interface StripLinks {
  /** How many lines each link's words take. */
  lines: [back: number, chapter: number];
  /** The two start at the same height. */
  level: boolean;
  /** The link back to the chapter stands to the right of the link back to the step. */
  beside: boolean;
  /** Both end inside the screen's width. */
  inside: boolean;
}

const stripLinks = (page: OpenedPage): Promise<StripLinks> =>
  page.page.evaluate(() => {
    const back = document.querySelector('[data-testid="strip-back"]');
    const chapter = document.querySelector('[data-testid="strip-chapter"]');
    if (back === null || chapter === null) throw new Error('the strip has not both links');
    const a = back.getBoundingClientRect();
    const b = chapter.getBoundingClientRect();
    return {
      lines: [back.getClientRects().length, chapter.getClientRects().length] as [number, number],
      level: Math.abs(a.top - b.top) < 1,
      beside: b.left >= a.right,
      inside: a.left >= 0 && b.right <= window.innerWidth,
    };
  });

const ON_ONE_LINE: StripLinks = { lines: [1, 1], level: true, beside: true, inside: true };

scenario(
  'From a card in the payment chapter with no wallet, through "Hold some" and back: the need remembers the step the reader came for, "Back to the chapter" leads to the card they pressed all through the detour, the done "Hold some" leads back to their step first, and "Pass it on" ends with the link back to the payment chapter and no "Next step"',
  { localOnly: true, timeout: 240_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    /** The card the reader pressed: "Pass it on", on the English page of the payment chapter. */
    const CARD = `${site}${PAYMENT_PAGE}#do-pass-it-on`;
    const byCard = { started: true as const, from: PAYMENT_PAGE };

    // -- 1. The chapter's card leads here. The step needs a wallet, and there is none: it names "Hold some". --
    const reader = await begin(s, `/do/pass-it-on?from=${PAYMENT_PAGE}`);
    const { page } = reader;
    await untilParts(page, ['blocked', 'later', 'later']);
    assert.equal(await page.text('step-chapter'), chapterLine('payment'));
    assert.equal(await hrefOf(page, 'step-back'), CARD);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-wallet');
    assert.ok((await page.text('step-need')).startsWith(en['need_no-wallet']));
    assert.equal(await page.text('step-need-link'), fill(en.actStep, { step: titleOf('hold-some') }));
    // The link's address is the other step's screen and nothing more: no step is named in a query string.
    assert.equal(await hrefOf(page, 'step-need-link'), '/do/hold-some');
    assert.equal(await countOf(page, 'step-need-also'), 1, 'the line for a reader who has a wallet elsewhere');
    let note = await noteOf(page);
    assert.deepEqual([note?.following, note?.steps], ['pass-it-on', { 'pass-it-on': byCard }]);
    const documents = documentsOf(page);

    // -- 2. The press. It writes the step the reader came for into the note of "Hold some", and nothing else:
    //       "Hold some" is not started by it. Then the screen it leads to opens, and starts the step. --
    const writes = await watchNoteWrites(page);
    await page.click('step-need-link');
    await arrivesAt(page, '/do/hold-some');
    await untilParts(page, ['now', 'later', 'later', 'later']);
    const written = await writes();
    assert.deepEqual(
      written.map((each) => [each.following, each.steps]),
      [
        ['pass-it-on', { 'hold-some': { cameFor: 'pass-it-on' }, 'pass-it-on': byCard }],
        ['hold-some', { 'hold-some': { started: true, cameFor: 'pass-it-on' }, 'pass-it-on': byCard }],
      ],
      'two writes: the press, and the opening of the screen it leads to',
    );
    assert.equal(written[0]?.followedAt, note?.followedAt, 'the press notes no time');
    assert.equal(await addressOf(page), '/do/hold-some');
    assert.equal(documentsOf(page), documents, 'a move inside the app');
    // "Hold some" belongs to the bitcoin chapter, and says so. Its link back leads to the chapter the reader left: to the card they pressed.
    assert.equal(await page.text('step-title'), titleOf('hold-some'));
    assert.equal(await page.text('step-chapter'), chapterLine('bitcoin'));
    assert.equal(await hrefOf(page, 'step-back'), CARD);
    assert.deepEqual(
      await page.page.$eval(hook('step-back'), (link) => [link.getAttribute('referrerpolicy'), link.getAttribute('rel'), link.getAttribute('target')]),
      [null, null, null],
    );
    assert.equal(await hrefOf(page, 'step-action'), '/new');

    // -- 3. Into the wallet: the strip carries both ways back, and the one to the chapter leads to the card. --
    await act(page, '/new');
    const onCreate = await untilStrip(page, 'hold-some', 'part');
    assert.equal(onCreate.words, partName('hold-some', 1));
    const count = { n: '1', m: '4' };
    assert.equal(
      await page.text('strip'),
      `${en.name} ${titleOf('hold-some')} ${fill(en.stripShort, count)} ${fill(en.stripPart, count)}: ${partName('hold-some', 1)} ${en.stripBack} ${en.back} ${en.stripStop}`,
    );
    assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], ['/do/hold-some', CARD]);

    // -- 4. The wallet is made: "Wallet made", with the 12 words. Part 1 ticks. --
    const made = await createFrom(page, 'create-words');
    assert.equal((await untilStrip(page, 'hold-some', 'part')).words, partName('hold-some', 2));
    note = await noteOf(page);
    assert.deepEqual(note?.steps, { 'hold-some': { started: true, cameFor: 'pass-it-on', parts: { 1: true } }, 'pass-it-on': byCard });

    // -- 5. "I have written them down" leads straight back to the step, not to the Overview. --
    await page.click('words-written');
    await arrivesAt(page, '/do/hold-some');
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.equal(await hrefOf(page, 'step-action'), '/wallet/receive#faucet');
    assert.equal(await hrefOf(page, 'step-back'), CARD);

    // -- 6. The faucet. The coins arrive, part 2 ticks, and the faucet's result leads back to the step by name. --
    await act(page, '/wallet/receive');
    await page.waitFor('faucet-ask');
    const address = await page.text('receive-address');
    assert.equal(address, made.record.firstAddress);
    await page.click('faucet-ask');
    await untilPhase(page, 'arrived');
    const faucetTxid = ((await attributeOf(page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    assert.match(faucetTxid, /^[0-9a-f]{64}$/);
    assert.equal(await page.text('faucet-step'), backTo('hold-some'));
    assert.equal(await hrefOf(page, 'faucet-step'), '/do/hold-some');
    assert.equal(await isMain(page, 'faucet-step'), true);
    await untilOnScreen(page, 'faucet-step');
    await untilStrip(page, 'hold-some', 'waiting');
    assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], ['/do/hold-some', CARD]);
    note = await noteOf(page);
    assert.deepEqual(note?.steps, { 'hold-some': { started: true, cameFor: 'pass-it-on', parts: { 1: true, 2: true } }, 'pass-it-on': byCard });

    // -- 7. Back to the step by that button: a page load, because the bot check's script has been in the page.
    //       The block comes: part 3 ticks by itself, and so does part 1 of "Pass it on", whose coins can now be
    //       spent. Then the block's number, read off the explorer. --
    assert.equal(await botCheckScripts(page), 1);
    await loads(page, () => page.click('faucet-step'));
    await arrivesAt(page, '/do/hold-some');
    assert.equal(documentsOf(page), documents + 1);
    assert.equal(await botCheckScripts(page), 0);
    await untilParts(page, ['ticked', 'ticked', 'now', 'later']);
    assert.equal(await hrefOf(page, 'step-back'), CARD, 'the way back is the same on the far side of the page load');
    const height = await s.network.nextBlock();
    await untilParts(page, ['ticked', 'ticked', 'ticked', 'now']);
    await until(async () => (await noteOf(page))?.steps['pass-it-on']?.parts?.[1] === true, 'part 1 of "Pass it on" ticks with the block');
    note = await noteOf(page);
    assert.deepEqual(note?.steps, {
      'hold-some': { started: true, cameFor: 'pass-it-on', parts: { 1: true, 2: true, 3: true } },
      'pass-it-on': { ...byCard, parts: { 1: true } },
    });
    assert.equal(note?.following, 'hold-some', 'a tick of another step takes no following away');
    await page.fill('step-block-answer', String(height));
    await page.click('step-block-check');
    await page.waitFor('step-done');
    note = await noteOf(page);
    const holdDone = note?.steps['hold-some']?.doneAt;
    assert.ok(holdDone !== undefined);
    assert.deepEqual(note, {
      v: 1,
      following: null,
      steps: {
        'hold-some': { started: true, doneAt: holdDone, cameFor: 'pass-it-on', parts: { 1: true, 2: true, 3: true, 4: true } },
        'pass-it-on': { ...byCard, parts: { 1: true } },
      },
    });

    // -- 8. The done card leads the reader on: back to the step they came for, as its main button; the link back
    //       to the chapter second, and it still leads to the card they pressed; then "All steps". No "Next step". --
    const led: Way[] = [
      { hook: 'step-led', words: backTo('pass-it-on'), href: '/do/pass-it-on', main: true },
      { hook: 'step-back', words: en.back, href: CARD, main: false },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ];
    assert.deepEqual(await waysOf(page), led);
    assert.equal(await page.text('step-chapter'), chapterName('bitcoin'), 'the link back stands on the card now, not in the chapter\'s line');

    // -- 9. Back to "Pass it on": its first part is ticked, and the next one is the payment. The memory stays. --
    await page.click('step-led');
    await arrivesAt(page, '/do/pass-it-on');
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal(await addressOf(page), '/do/pass-it-on');
    assert.equal(await hrefOf(page, 'step-action'), '/wallet/send');
    assert.equal(await hrefOf(page, 'step-back'), CARD);
    note = await noteOf(page);
    assert.deepEqual([note?.following, note?.steps['hold-some']?.cameFor], ['pass-it-on', 'pass-it-on']);

    // The browser's Back from here shows the card of "Hold some" exactly as it was: the same three ways on.
    // "Pass it on" stays the followed step, so its strip stands above the card.
    await page.page.goBack();
    await arrivesAt(page, '/do/hold-some');
    await page.waitFor('step-done');
    assert.deepEqual(await waysOf(page), led);
    assert.equal((await untilStrip(page, 'pass-it-on', 'part')).words, partName('pass-it-on', 2));
    note = await noteOf(page);
    assert.deepEqual([note?.following, note?.steps['hold-some']?.cameFor], ['pass-it-on', 'pass-it-on']);
    await page.page.goForward();
    await arrivesAt(page, '/do/pass-it-on');
    await untilParts(page, ['ticked', 'now', 'later']);

    // -- 10. Send: the strip carries both ways back. The payment goes to the pot, and "Payment sent" leads back
    //        to the step by name, as its main button. --
    await act(page, '/wallet/send');
    assert.equal((await untilStrip(page, 'pass-it-on', 'part')).words, partName('pass-it-on', 2));
    assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], ['/do/pass-it-on', CARD]);
    const paid = await pay(page, 'pot', '30,000');
    assert.equal(await page.text('sent-step'), backTo('pass-it-on'));
    assert.equal(await hrefOf(page, 'sent-step'), '/do/pass-it-on');
    assert.deepEqual([await isMain(page, 'sent-step'), await isMain(page, 'sent-link')], [true, false]);
    note = await noteOf(page);
    const paying = note?.steps['pass-it-on'];
    assert.deepEqual(paying, { ...byCard, tx: paid.txid, sentAt: paying?.sentAt, parts: { 1: true, 2: true } });

    // -- 11. Back to the step. The block comes, and the step is done. Its card: the link back to the payment
    //        chapter as the main button, now saying that the step is done, and "All steps". No "Next step": the
    //        reader came from the chapter, reads on there, and meets the next card where the chapter has it. --
    await page.click('sent-step');
    await arrivesAt(page, '/do/pass-it-on');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    await s.network.nextBlock();
    await page.waitFor('step-done');
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-back', words: en.back, href: `${site}${PAYMENT_PAGE}#done=pass-it-on`, main: true },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);
    note = await noteOf(page);
    const passDone = note?.steps['pass-it-on']?.doneAt;
    assert.ok(passDone !== undefined);
    // The memory went with the write that finished "Pass it on".
    assert.deepEqual(note, {
      v: 1,
      following: null,
      steps: {
        'hold-some': { started: true, doneAt: holdDone, parts: { 1: true, 2: true, 3: true, 4: true } },
        'pass-it-on': { started: true, doneAt: passDone, from: PAYMENT_PAGE, parts: { 1: true, 2: true, 3: true } },
      },
    });
    assert.doesNotMatch((await noteText(page)) ?? '', /cameFor/);

    // -- "Hold some", opened from the list now: the detour is over. Its link back leads to its own chapter, and
    //    says that the step is done there. --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    assert.deepEqual([await listState(page, 'hold-some'), await listState(page, 'pass-it-on')], ['done', 'done']);
    await pickStep(page, 'hold-some');
    await page.waitFor('step-done');
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-back', words: en.back, href: `${site}${BITCOIN_PAGE}#done=hold-some`, main: true },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);

    // What was counted on the way is what was counted before: each screen, the wallet's own events, and each
    // of the two steps once. Nothing new, and no view of the Overview after "Wallet made".
    assert.deepEqual(stepsCounted(s), { 'hold-some': 1, 'pass-it-on': 1 });
    await ends(
      s,
      reader,
      [
        view('/do/pass-it-on'),
        view('/do/hold-some'),
        view('/new'),
        { name: 'Wallet created', path: '/new', value: 'words' },
        view('/wallet/backup'),
        { name: 'Words shown', path: '/wallet/backup', value: 'words' },
        view('/do/hold-some'),
        view('/wallet/receive'),
        { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
        view('/do/hold-some'),
        doIt('/do/hold-some', 'hold-some'),
        view('/do/pass-it-on'),
        view('/do/hold-some'),
        view('/do/pass-it-on'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view('/do/pass-it-on'),
        doIt('/do/pass-it-on', 'pass-it-on'),
        view('/do'),
        view('/do/hold-some'),
      ],
      { records: [made.record], words: [made.words], addresses: [address, paid.to], txids: [faucetTxid, paid.txid] },
    );
  },
);

scenario(
  'The reader who gave up half-way, and the other roads into a detour: "Hold some" opened from the list on a later day still leads back to the chapter the reader left and to their step; opened by its own card it leads to the bitcoin chapter; with a way back of its own beside the memory it never leads to the bitcoin chapter while the detour lasts; on a road of three it leads to the card the reader pressed; a reader from the list is remembered nothing, and their press ends what an earlier road left; a restart keeps the memory and "Forget my progress" takes it',
  { timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const CARD = `${site}${PAYMENT_PAGE}#do-pass-it-on`;
    const HOURS = 3_600_000;
    const at = Date.now();
    const record = freshRecord();
    assert.ok(record.mnemonic !== undefined);
    const words = record.mnemonic.split(' ');
    const byCard = { started: true as const, from: PAYMENT_PAGE };
    const allTicked = { 1: true as const, 2: true as const, 3: true as const, 4: true as const };
    /** The reader closed the tab on "Wallet made": a wallet, "Hold some" one part in and sent there by "Pass it on". */
    const halfWay = (followedAt: number): string =>
      noteFor({ following: 'hold-some', followedAt, steps: { 'hold-some': { started: true, cameFor: 'pass-it-on', parts: { 1: true } }, 'pass-it-on': byCard } });

    const counted: EventBody[] = [];
    /** Puts a note in this browser behind the app's back (on a page of the site that is not the app), and loads a screen. */
    const openWith = async (stored: string | null, path: string, wait: string): Promise<void> => {
      await page.goto('/robots.txt');
      await page.store(PROGRESS_KEY, stored);
      await page.goto(path);
      await page.waitFor(wait);
      counted.push(view(path.replace(/\?.*$/, '')));
    };

    // -- The same day, back in the wallet: the strip still shows "Hold some", with both ways back. --
    const reader = await begin(s, '/wallet', { record, storage: { [PROGRESS_KEY]: halfWay(at - HOURS) } });
    const { page } = reader;
    counted.push(view('/wallet'));
    assert.equal((await untilStrip(page, 'hold-some', 'part')).words, partName('hold-some', 2));
    assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], ['/do/hold-some', CARD]);

    // -- Another day: no strip. The Overview leads to the list, which shows both steps as started. "Hold some"
    //    goes on from part 2, and its link back still leads to the card in the payment chapter. --
    await openWith(halfWay(at - 25 * HOURS), '/wallet', 'overview-do-link');
    await page.settle();
    assert.equal(await stripOf(page), null);
    await page.click('overview-do-link');
    await arrivesAt(page, '/do');
    counted.push(view('/do'));
    assert.deepEqual([await listState(page, 'hold-some'), await listState(page, 'pass-it-on')], ['started', 'started']);
    await pickStep(page, 'hold-some');
    counted.push(view('/do/hold-some'));
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.equal(await page.text('step-chapter'), chapterLine('bitcoin'));
    assert.equal(await hrefOf(page, 'step-back'), CARD);
    let note = await noteOf(page);
    assert.deepEqual([note?.following, note?.steps], ['hold-some', { 'hold-some': { started: true, cameFor: 'pass-it-on', parts: { 1: true } }, 'pass-it-on': byCard }]);
    // In Spanish too: the reader came from the English page of the payment chapter, and is led back to it.
    await openWith(halfWay(at), '/es/do/hold-some', 'step-parts');
    assert.equal(await page.text('step-chapter'), chapterLine('bitcoin', 'es'));
    assert.equal(await hrefOf(page, 'step-back'), CARD);

    // -- Done on that later day: it ends with the way back to their step, and the link back to their chapter. --
    const holdDone = { started: true as const, doneAt: at - HOURS, cameFor: 'pass-it-on' as const, parts: allTicked };
    await openWith(noteFor({ following: null, steps: { 'hold-some': holdDone, 'pass-it-on': byCard } }), '/do/hold-some', 'step-done');
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-led', words: backTo('pass-it-on'), href: '/do/pass-it-on', main: true },
      { hook: 'step-back', words: en.back, href: CARD, main: false },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);

    // -- Opened by its own card in the bitcoin chapter: that is the later road. Every link back leads to the
    //    bitcoin chapter, the done card's main button too, and the memory is gone from the note. --
    await openWith(halfWay(at), `/do/hold-some?from=${BITCOIN_PAGE}`, 'step-parts');
    assert.equal(await hrefOf(page, 'step-back'), `${site}${BITCOIN_PAGE}#do-hold-some`);
    note = await noteOf(page);
    assert.deepEqual(note?.steps, { 'hold-some': { started: true, from: BITCOIN_PAGE, parts: { 1: true } }, 'pass-it-on': byCard });
    await openWith(noteFor({ following: null, steps: { 'hold-some': holdDone, 'pass-it-on': byCard } }), `/do/hold-some?from=${BITCOIN_PAGE}`, 'step-done');
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-back', words: en.back, href: `${site}${BITCOIN_PAGE}#done=hold-some`, main: true },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);
    assert.equal((await noteOf(page))?.steps['hold-some']?.cameFor, undefined);

    // -- With a way back of its own beside the memory (its card was pressed on an earlier day, and a need sent
    //    the reader here now): the detour decides. No link leads to the bitcoin chapter while it lasts. --
    const both = { started: true as const, from: BITCOIN_PAGE, cameFor: 'pass-it-on' as const, parts: { 1: true as const } };
    await openWith(noteFor({ following: 'hold-some', followedAt: at, steps: { 'hold-some': both, 'pass-it-on': byCard } }), '/do/hold-some', 'step-parts');
    assert.equal(await hrefOf(page, 'step-back'), CARD);
    assert.deepEqual((await noteOf(page))?.steps['hold-some'], both, 'an opening without a way back leaves both');
    await act(page, '/wallet/receive');
    counted.push(view('/wallet/receive'));
    await untilStrip(page, 'hold-some', 'part');
    assert.equal(await hrefOf(page, 'strip-chapter'), CARD);
    await openWith(noteFor({ following: null, steps: { 'hold-some': { ...both, doneAt: at, parts: allTicked }, 'pass-it-on': byCard } }), '/do/hold-some', 'step-done');
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-led', words: backTo('pass-it-on'), href: '/do/pass-it-on', main: true },
      { hook: 'step-back', words: en.back, href: CARD, main: false },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);

    // -- A road of three, by the real links. The wallet holds no coins and has sent nothing. The reader presses
    //    the card of "There are no balances" on the Spanish page of the payment chapter: its need leads to "Pass
    //    it on", whose need leads on to "Hold some". On all three, "Back to the chapter" leads to the card they
    //    pressed. --
    const pressed = `${site}${PAYMENT_PAGE_ES}#do-no-balances`;
    await openWith(null, `/do/no-balances?from=${PAYMENT_PAGE_ES}`, 'step-need-link');
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'nothing-sent');
    assert.equal(await page.text('step-need-link'), fill(en.actStep, { step: titleOf('pass-it-on') }));
    assert.equal(await hrefOf(page, 'step-back'), pressed);
    await page.click('step-need-link');
    await arrivesAt(page, '/do/pass-it-on');
    counted.push(view('/do/pass-it-on'));
    await page.waitFor('step-need-link');
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-coins');
    assert.equal(await page.text('step-chapter'), chapterLine('payment'));
    assert.equal(await hrefOf(page, 'step-back'), pressed);
    await page.click('step-need-link');
    await arrivesAt(page, '/do/hold-some');
    counted.push(view('/do/hold-some'));
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.equal(await addressOf(page), '/do/hold-some');
    assert.equal(await hrefOf(page, 'step-back'), pressed);
    note = await noteOf(page);
    assert.deepEqual(note?.steps, {
      'hold-some': { started: true, cameFor: 'pass-it-on', parts: { 1: true } },
      'pass-it-on': { started: true, cameFor: 'no-balances' },
      'no-balances': { started: true, from: PAYMENT_PAGE_ES },
    });
    // And on the strip of "Hold some", on a wallet screen.
    await act(page, '/wallet/receive');
    counted.push(view('/wallet/receive'));
    await untilStrip(page, 'hold-some', 'part');
    assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], ['/do/hold-some', pressed]);

    // -- A reader who opened "Pass it on" from the wallet's own list is remembered nothing: the press of the
    //    need's link writes no step, "Hold some" leads to its own chapter, and its strip has the one link. --
    await openWith(null, '/do/pass-it-on', 'step-need-link');
    assert.equal(await hrefOf(page, 'step-back'), `${site}${PAYMENT_PAGE}#do-pass-it-on`);
    const writes = await watchNoteWrites(page);
    await page.click('step-need-link');
    await arrivesAt(page, '/do/hold-some');
    counted.push(view('/do/hold-some'));
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    for (const each of await writes()) assert.doesNotMatch(JSON.stringify(each), /cameFor/);
    note = await noteOf(page);
    assert.deepEqual(note?.steps, { 'hold-some': { started: true, parts: { 1: true } }, 'pass-it-on': { started: true } });
    assert.equal(await hrefOf(page, 'step-back'), `${site}${BITCOIN_PAGE}#do-hold-some`);
    await act(page, '/wallet/receive');
    counted.push(view('/wallet/receive'));
    await untilStrip(page, 'hold-some', 'part');
    assert.equal(await hrefOf(page, 'strip-back'), '/do/hold-some');
    assert.equal(await countOf(page, 'strip-chapter'), 0, 'the strip of a step from the list is as it was');

    // -- And such a press ends what an earlier road left. On an earlier day the reader pressed the card of "The
    //    waiting room" in the payment chapter, was sent to "Hold some" and gave up there. Now they open "Prove
    //    the backup" from the wallet's own list. It needs coins too, and sends them to "Hold some". This trip did
    //    not begin at a card: "Hold some" must not lead them back to "The waiting room", nor to the payment
    //    chapter. --
    const gaveUp = noteFor({
      following: 'hold-some',
      followedAt: at - 25 * HOURS,
      steps: { 'hold-some': { started: true, cameFor: 'waiting-room', parts: { 1: true } }, 'waiting-room': byCard },
    });
    await openWith(gaveUp, '/do/hold-some', 'step-parts');
    assert.equal(await hrefOf(page, 'step-back'), `${site}${PAYMENT_PAGE}#do-waiting-room`, 'until that press, "Hold some" leads to the card of the earlier day');
    await openWith(gaveUp, '/do/prove-the-backup', 'step-need-link');
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-coins');
    assert.equal(await hrefOf(page, 'step-need-link'), '/do/hold-some');
    const laterWrites = await watchNoteWrites(page);
    await page.click('step-need-link');
    await arrivesAt(page, '/do/hold-some');
    counted.push(view('/do/hold-some'));
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    // The press took the earlier step's name out of the note of "Hold some", and wrote no other in its place.
    const unremembered = { 'hold-some': { started: true, parts: { 1: true } }, 'waiting-room': byCard, 'prove-the-backup': { started: true } };
    const pressWrote = (await laterWrites())[0];
    assert.deepEqual([pressWrote?.following, pressWrote?.steps], ['prove-the-backup', unremembered], 'the first write is the press');
    note = await noteOf(page);
    assert.deepEqual([note?.following, note?.steps], ['hold-some', unremembered]);
    assert.doesNotMatch((await noteText(page)) ?? '', /cameFor/);
    // So "Hold some" is the step of a reader from the list: its link back leads to its own chapter, and its
    // strip has the one link.
    assert.equal(await page.text('step-chapter'), chapterLine('bitcoin'));
    assert.equal(await hrefOf(page, 'step-back'), `${site}${BITCOIN_PAGE}#do-hold-some`);
    await act(page, '/wallet/receive');
    counted.push(view('/wallet/receive'));
    await untilStrip(page, 'hold-some', 'part');
    assert.equal(await hrefOf(page, 'strip-back'), '/do/hold-some');
    assert.equal(await countOf(page, 'strip-chapter'), 0);
    // The step of the earlier day keeps its own way back, for the day the reader presses its card again.
    await openWith(await noteText(page), '/do/waiting-room', 'step-need-link');
    assert.equal(await hrefOf(page, 'step-back'), `${site}${PAYMENT_PAGE}#do-waiting-room`);

    // -- "Start this step again" keeps the memory, as it keeps a way back. (The note says two parts are ticked;
    //    the wallet holds no coins, so started again only the first ticks: the restart shows.) --
    const twoIn = noteFor({ following: 'hold-some', followedAt: at, steps: { 'hold-some': { started: true, cameFor: 'pass-it-on', parts: { 1: true, 2: true } }, 'pass-it-on': byCard } });
    await openWith(twoIn, '/do/hold-some', 'step-restart');
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'blocked', 'later']);
    await page.click('step-restart');
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    note = await noteOf(page);
    assert.deepEqual(note?.steps, { 'hold-some': { started: true, cameFor: 'pass-it-on', parts: { 1: true } }, 'pass-it-on': byCard });
    assert.equal(await hrefOf(page, 'step-back'), CARD);

    // -- "Forget my progress" takes it with the rest of the note: the step then leads to its own chapter. --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    counted.push(view('/do'));
    await page.click('do-forget');
    await page.waitFor('do-forget-confirm');
    await untilAnswersCount();
    await page.click('do-forget-confirm');
    await page.waitFor('do-forgotten');
    assert.equal(await noteText(page), null);
    await pickStep(page, 'hold-some');
    counted.push(view('/do/hold-some'));
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${BITCOIN_PAGE}#do-hold-some`);
    assert.deepEqual((await noteOf(page))?.steps, { 'hold-some': { started: true, parts: { 1: true } } });

    assert.deepEqual(stepsCounted(s), {});
    await ends(s, reader, counted, { records: [record], words: [words], addresses: [record.firstAddress], txids: [] });
  },
);

scenario(
  'A done step\'s link back names every done step of its chapter, itself first, on its card and on the strip; reached by card it offers no "Next step", from the list it does; a done step that a need led to inside one chapter leads back to the reader\'s step first, and its link back marks it on the page the reader left',
  { timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const at = Date.now();
    /** A done step's note. A day apart, so that each has a time of its own. */
    const done = (parts: 3 | 4, days: number, extra: Record<string, unknown> = {}) => ({
      started: true as const,
      doneAt: at - days * 86_400_000,
      parts: Object.fromEntries(Array.from({ length: parts }, (_, index) => [index + 1, true])) as Record<number, true>,
      ...extra,
    });
    const counted: EventBody[] = [];
    // A wallet that has no coins and no history. A done step's card is drawn from the note alone, whatever the wallet holds.
    const record = freshRecord();
    assert.ok(record.mnemonic !== undefined);
    const words = record.mnemonic.split(' ');
    const reader = await begin(s, '/do', { record });
    const { page } = reader;
    await page.waitFor('do-list');
    counted.push(view('/do'));
    const openWith = async (stored: string, path: string, wait: string): Promise<void> => {
      await page.goto('/robots.txt');
      await page.store(PROGRESS_KEY, stored);
      await page.goto(path);
      await page.waitFor(wait);
      counted.push(view(path.replace(/\?.*$/, '')));
    };
    const next = (id: StepId, lang: Lang = 'en'): string => fill((lang === 'en' ? en : es).next, { step: titleOf(id, lang) });

    // -- The payment chapter, all three steps done from the wallet's own list, one "Next step" after the other.
    //    The link back of each names all three, the one being left first: the chapter marks every card, and
    //    brings that first one into view. A reader from the list is still offered "Next step". --
    const fromList = noteFor({ following: null, steps: { 'pass-it-on': done(3, 3), 'no-balances': done(3, 2), 'waiting-room': done(3, 1) } });
    await openWith(fromList, '/do/pass-it-on', 'step-done');
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-back', words: en.back, href: `${site}${PAYMENT_PAGE}#done=pass-it-on,no-balances,waiting-room`, main: true },
      { hook: 'step-next', words: next('no-balances'), href: '/do/no-balances', main: false },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);
    await page.click('step-next');
    await arrivesAt(page, '/do/no-balances');
    counted.push(view('/do/no-balances'));
    await page.waitFor('step-done');
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-back', words: en.back, href: `${site}${PAYMENT_PAGE}#done=no-balances,pass-it-on,waiting-room`, main: true },
      { hook: 'step-next', words: next('waiting-room'), href: '/do/waiting-room', main: false },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);
    await page.click('step-next');
    await arrivesAt(page, '/do/waiting-room');
    counted.push(view('/do/waiting-room'));
    await page.waitFor('step-done');
    // The chapter's last step: no next one.
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-back', words: en.back, href: `${site}${PAYMENT_PAGE}#done=waiting-room,pass-it-on,no-balances`, main: true },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);
    // A step of another chapter that is done is never named: "Hold some" beside them changes nothing.
    await openWith(noteFor({ following: null, steps: { 'hold-some': done(4, 9), 'pass-it-on': done(3, 3), 'waiting-room': done(3, 1), 'no-balances': { started: true } } }), '/do/waiting-room', 'step-done');
    assert.equal(await hrefOf(page, 'step-back'), `${site}${PAYMENT_PAGE}#done=waiting-room,pass-it-on`);
    // And a step that is not done names its own card, whatever else is done.
    await page.goto('/do/no-balances');
    await page.waitFor('step-parts');
    counted.push(view('/do/no-balances'));
    assert.equal(await hrefOf(page, 'step-back'), `${site}${PAYMENT_PAGE}#do-no-balances`);

    // -- Reached by its card, from the chapter's Spanish page: the same longer ending, on that page, and no
    //    "Next step". The main button is the way back to the chapter. --
    const byCard = noteFor({ following: null, steps: { 'pass-it-on': done(3, 2, { from: PAYMENT_PAGE_ES }), 'no-balances': done(3, 1) } });
    await openWith(byCard, '/do/pass-it-on', 'step-done');
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-back', words: en.back, href: `${site}${PAYMENT_PAGE_ES}#done=pass-it-on,no-balances`, main: true },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);
    // The other step of that note was opened from the list: it keeps its "Next step".
    await page.goto('/do/no-balances');
    await page.waitFor('step-done');
    counted.push(view('/do/no-balances'));
    assert.deepEqual((await waysOf(page)).map((way) => way.hook), ['step-back', 'step-next', 'step-list']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${PAYMENT_PAGE}#done=no-balances,pass-it-on`);

    // -- On the strip of a step that was done on another screen: the same address as on its card. --
    const onStrip = noteFor({ following: 'no-balances', followedAt: at, steps: { 'pass-it-on': done(3, 2), 'no-balances': done(3, 0, { from: PAYMENT_PAGE }), 'waiting-room': { started: true } } });
    await openWith(onStrip, '/', 'home-do-link');
    await untilStrip(page, 'no-balances', 'done');
    assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], ['/do/no-balances', `${site}${PAYMENT_PAGE}#done=no-balances,pass-it-on`]);

    // -- A detour inside one chapter, in Spanish. The reader pressed the card "Comprueba el respaldo" on the
    //    Spanish page of the keys chapter, and the line above its three word fields led to "La semilla". While
    //    that step is not done, its link back leads to the card they pressed. --
    const drill = { started: true as const, from: KEYS_PAGE_ES };
    await openWith(noteFor({ following: 'the-seed', followedAt: at, steps: { 'the-seed': { started: true, cameFor: 'prove-the-backup' }, 'prove-the-backup': drill } }), '/es/do/the-seed', 'step-parts');
    assert.equal(await page.text('step-chapter'), chapterLine('keys', 'es'));
    assert.equal(await hrefOf(page, 'step-back'), `${site}${KEYS_PAGE_ES}#do-prove-the-backup`);
    // Done: it leads back to the reader's step first, by name. The link back to the chapter is second, and
    // marks this step on the page the reader left, which holds its card too.
    const seedDone = noteFor({ following: null, steps: { 'the-seed': done(3, 0, { cameFor: 'prove-the-backup', wallet: record.fingerprint }), 'prove-the-backup': drill } });
    await openWith(seedDone, '/es/do/the-seed', 'step-done');
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-led', words: backTo('prove-the-backup', 'es'), href: '/es/do/prove-the-backup', main: true },
      { hook: 'step-back', words: es.back, href: `${site}${KEYS_PAGE_ES}#done=the-seed`, main: false },
      { hook: 'step-list', words: es.allSteps, href: '/es/do', main: false },
    ]);
    assert.equal(backTo('prove-the-backup', 'es'), 'Volver a "Comprueba el respaldo"');
    // The same after a switch of the wallet to English: the page the reader left is the Spanish one still.
    await page.goto('/do/the-seed');
    await page.waitFor('step-done');
    counted.push(view('/do/the-seed'));
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-led', words: backTo('prove-the-backup'), href: '/do/prove-the-backup', main: true },
      { hook: 'step-back', words: en.back, href: `${site}${KEYS_PAGE_ES}#done=the-seed`, main: false },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);
    // And in the payment chapter: "Pass it on", which a need of "There are no balances" led to, with "The waiting room" done as well.
    const inside = noteFor({
      following: null,
      steps: { 'pass-it-on': done(3, 0, { cameFor: 'no-balances' }), 'no-balances': { started: true, from: PAYMENT_PAGE }, 'waiting-room': done(3, 4) },
    });
    await openWith(inside, '/do/pass-it-on', 'step-done');
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-led', words: backTo('no-balances'), href: '/do/no-balances', main: true },
      { hook: 'step-back', words: en.back, href: `${site}${PAYMENT_PAGE}#done=pass-it-on,waiting-room`, main: false },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);

    assert.deepEqual(stepsCounted(s), {}, 'a step that was done on an earlier visit is not counted again');
    await ends(s, reader, counted, { records: [record], words: [words], addresses: [record.firstAddress], txids: [] });
  },
);

scenario(
  'The strip carries the link back to the chapter on every wallet screen while the followed step came from a chapter, by its card or by a need, and not for a step opened from the list; at 320 and 375 px, in English and in Spanish, the two links stand on one line and the page is no wider than the phone; the footer\'s link to the main site says that it opens a new tab, and by its attributes it opens the home page in one',
  { timeout: 240_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const at = Date.now();
    const record = freshRecord();
    assert.ok(record.mnemonic !== undefined);
    const words = record.mnemonic.split(' ');
    const counted: EventBody[] = [];
    const card = `${site}${PAYMENT_PAGE}#do-no-balances`;

    // -- A step under way that was reached by its card: on every screen but its own, both ways back. --
    const byCard = noteFor({ following: 'no-balances', followedAt: at, steps: { 'no-balances': { started: true, from: PAYMENT_PAGE } } });
    const reader = await begin(s, '/wallet', { record, storage: { [PROGRESS_KEY]: byCard } });
    const { page } = reader;
    counted.push(view('/wallet'));
    const both = async (where: string, step: StepId, chapter: string): Promise<void> => {
      await until(async () => (await stripOf(page))?.step === step, `the strip of ${step} on ${where}`);
      assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], [`/do/${step}`, chapter], where);
      assert.deepEqual([await page.text('strip-back'), await page.text('strip-chapter')], [en.stripBack, en.back], where);
      assert.deepEqual(
        await page.page.$eval(hook('strip-chapter'), (link) => [link.getAttribute('referrerpolicy'), link.getAttribute('rel'), link.getAttribute('target')]),
        [null, null, null],
        `${where}: the link back stays in this tab, and asks for no referrer to be sent`,
      );
    };
    await both('/wallet', 'no-balances', card);
    for (const path of SECTIONS) {
      if (path === '/wallet') continue;
      await toSection(page, path);
      counted.push(view(path));
      await both(path, 'no-balances', card);
    }
    await goHome(page);
    counted.push(view('/'));
    await both('Home', 'no-balances', card);
    for (const path of ['/about', '/sparrow']) {
      await headerLink(page, path);
      await arrivesAt(page, path);
      counted.push(view(path));
      await both(path, 'no-balances', card);
    }
    await goHome(page);
    counted.push(view('/'));
    await page.click('home-do-link');
    await arrivesAt(page, '/do');
    counted.push(view('/do'));
    await both('the list of steps', 'no-balances', card);
    // Not on the step's own screen: there the link stands beside the chapter's name.
    await pickStep(page, 'no-balances');
    counted.push(view('/do/no-balances'));
    assert.equal(await stripOf(page), null);
    assert.equal(await hrefOf(page, 'step-back'), card);

    /** Puts a note in this browser behind the app's back, and loads a screen. */
    const openWith = async (stored: string | null, path: string, wait: string): Promise<void> => {
      await page.goto('/robots.txt');
      await page.store(PROGRESS_KEY, stored);
      await page.goto(path);
      await page.waitFor(wait);
      counted.push(view(path));
    };

    // -- A step that a need sent the reader to: both ways back, and the one to the chapter leads to the chapter
    //    they left. --
    const byNeed = noteFor({
      following: 'hold-some',
      followedAt: at,
      steps: { 'hold-some': { started: true, cameFor: 'pass-it-on', parts: { 1: true } }, 'pass-it-on': { started: true, from: PAYMENT_PAGE_ES } },
    });
    await openWith(byNeed, '/wallet/receive', 'receive-address');
    await both('/wallet/receive', 'hold-some', `${site}${PAYMENT_PAGE_ES}#do-pass-it-on`);
    await toSection(page, '/wallet/settings');
    counted.push(view('/wallet/settings'));
    await both('/wallet/settings', 'hold-some', `${site}${PAYMENT_PAGE_ES}#do-pass-it-on`);

    // -- A step opened from the wallet's own list: the one link, as it was. --
    await openWith(noteFor({ following: 'no-balances', followedAt: at, steps: { 'no-balances': { started: true } } }), '/wallet/receive', 'receive-address');
    await untilStrip(page, 'no-balances', 'part');
    assert.equal(await hrefOf(page, 'strip-back'), '/do/no-balances');
    assert.equal(await countOf(page, 'strip-chapter'), 0);
    assert.equal(await page.text('strip'), `${en.name} ${titleOf('no-balances')} ${fill(en.stripShort, { n: '1', m: '3' })} ${fill(en.stripPart, { n: '1', m: '3' })}: ${partName('no-balances', 1)} ${en.stripBack} ${en.stripStop}`);
    // Once it is done it has both, as it always had: the way back to the chapter then says that the step is done.
    const doneFromList = noteFor({ following: 'no-balances', followedAt: at, steps: { 'no-balances': { started: true, doneAt: at, parts: { 1: true, 2: true, 3: true } } } });
    await openWith(doneFromList, '/wallet/receive', 'receive-address');
    await untilStrip(page, 'no-balances', 'done');
    assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], ['/do/no-balances', `${site}${PAYMENT_PAGE}#done=no-balances`]);

    // -- The footer's link to the main site. It opens the main site's home page in a new tab, and its words say
    //    so: it does not read as the way back. For a reader who follows no step it is the same, and there is no strip. --
    const footer = async (lang: Lang): Promise<void> => {
      const common = strings.common[lang];
      assert.equal(await page.text('footer-site'), common.linkSite, lang);
      assert.deepEqual(
        await page.page.$eval(hook('footer-site'), (link) => [link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]),
        [lang === 'en' ? site : `${site}/es`, '_blank', 'noopener noreferrer'],
        lang,
      );
      // Its own words name the new tab, so no hidden words say it a second time. The other links that leave
      // the site still carry them.
      assert.equal(await page.page.$eval(hook('footer-site'), (link) => link.querySelector('.sr-only')?.textContent ?? null), null, lang);
      assert.ok((await page.text('footer-explorer')).endsWith(common.opensNewTab), lang);
    };
    assert.deepEqual([strings.common.en.linkSite, strings.common.es.linkSite], ['LearnBitcoin.com, in a new tab', 'LearnBitcoin.com, en otra pestaña']);
    await footer('en');
    await openWith(null, '/es/wallet', 'overview-do-link');
    await page.settle();
    assert.equal(await stripOf(page), null);
    await footer('es');
    await openWith(null, '/wallet', 'overview-do-link');
    await footer('en');

    // -- On a phone, at 320 and 375 px, in English and in Spanish, with a wallet and without one: the two links
    //    share one line that does not break inside itself, and the page is no wider than the screen. --
    const needs = { en: en['stripNeed_no-coins'], es: es['stripNeed_no-coins'] };
    for (const width of [320, 375]) {
      await page.page.setViewport({ width, height: 667, deviceScaleFactor: 1 });
      for (const lang of ['en', 'es'] as const) {
        const prefix = lang === 'en' ? '' : '/es';
        const t = lang === 'en' ? en : es;
        const what = `${width} px, ${lang}`;
        // With a wallet that holds no coins: "Pass it on", reached by its card, says what is missing first.
        const under = noteFor({ following: 'pass-it-on', followedAt: at, steps: { 'pass-it-on': { started: true, from: PAYMENT_PAGE_ES } } });
        await openWith(under, `${prefix}/wallet/receive`, 'receive-address');
        const strip = await untilStrip(page, 'pass-it-on', 'need');
        // The narrow form: the step, what is missing in the place of "1 of 3", and the two links.
        assert.ok(strip.text.startsWith(`${titleOf('pass-it-on', lang)} ${needs[lang]}`), `${what}: ${strip.text}`);
        assert.deepEqual([await page.text('strip-back'), await page.text('strip-chapter')], [t.stripBack, t.back], what);
        assert.equal(await hrefOf(page, 'strip-chapter'), `${site}${PAYMENT_PAGE_ES}#do-pass-it-on`, what);
        assert.deepEqual(await stripLinks(page), ON_ONE_LINE, `${what}, with a wallet`);
        assert.equal(await page.sidewaysScroll(), 0, `${what}, with a wallet: the page scrolls sideways`);
      }
    }
    // Without a wallet: "Hold some", which a need of "Pass it on" sent the reader to, on Home.
    await page.goto('/robots.txt');
    await page.store(RECORD_KEY, null);
    const sent = noteFor({ following: 'hold-some', followedAt: at, steps: { 'hold-some': { started: true, cameFor: 'pass-it-on' }, 'pass-it-on': { started: true, from: PAYMENT_PAGE } } });
    for (const width of [320, 375]) {
      await page.page.setViewport({ width, height: 667, deviceScaleFactor: 1 });
      for (const lang of ['en', 'es'] as const) {
        const home = lang === 'en' ? '/' : '/es';
        const t = lang === 'en' ? en : es;
        const what = `${width} px, ${lang}`;
        await openWith(sent, home, 'home-do-link');
        await untilStrip(page, 'hold-some', 'part');
        assert.deepEqual([await page.text('strip-back'), await page.text('strip-chapter')], [t.stripBack, t.back], what);
        assert.equal(await hrefOf(page, 'strip-chapter'), `${site}${PAYMENT_PAGE}#do-pass-it-on`, what);
        assert.deepEqual(await stripLinks(page), ON_ONE_LINE, `${what}, without a wallet`);
        assert.equal(await page.sidewaysScroll(), 0, `${what}, without a wallet: the page scrolls sideways`);
      }
    }

    assert.deepEqual(stepsCounted(s), {});
    await ends(s, reader, counted, { records: [record], words: [words], addresses: [record.firstAddress], txids: [] });
  },
);

scenario(
  'Where a part was just done on a wallet screen, the result leads back to the step: the faucet\'s result once the coins are here, with a record of the payment and without one, with its button on screen at 375 by 667 px for a wallet made without a passkey and for one with, and "Payment sent" once the step\'s payment is out; while the reader waits on Receive for the coin\'s block, the strip names the step\'s next part and does not say that coins are missing; a reader who follows no step sees neither button, the page does not move for them when coins arrive, and "See this transaction" is the main button as before',
  { localOnly: true, timeout: 300_000 },
  async (s) => {
    const PHONE = { width: 375, height: 667, timeout: 30_000 };

    /**
     * The first pieces of the faucet's result, in the order they stand in its box: a sentence ("p"), the way
     * back to the step ("step"), the transaction's row ("dl").
     */
    const resultOrder = (page: OpenedPage, most: number): Promise<string[]> =>
      page.page.$eval(
        hook('faucet-state'),
        (state, count) => {
          const box = state.firstElementChild;
          const kinds = [...(box?.children ?? [])].map((child) => (child.querySelector('[data-testid="faucet-step"]') !== null ? 'step' : child.tagName.toLowerCase()));
          return kinds.slice(0, count);
        },
        most,
      );

    /**
     * From the step's screen with no wallet in the browser: makes one through Create, goes back to the step by
     * "I have written them down", and from there to the faucet's card on Receive. Gives the wallet that was made.
     */
    const toFaucet = async (page: OpenedPage, button: 'create-passkey' | 'create-words') => {
      await untilParts(page, ['now', 'later', 'later', 'later']);
      await act(page, '/new');
      const made = await createFrom(page, button);
      await page.click('words-written');
      await arrivesAt(page, '/do/hold-some');
      await untilParts(page, ['ticked', 'now', 'later', 'later']);
      await act(page, '/wallet/receive');
      await page.waitFor('faucet-ask');
      return made;
    };
    /** What a reader who made a wallet for "Hold some" and asked the faucet has had counted, with the kind of wallet. */
    const countedTo = (kind: 'words' | 'passkey'): EventBody[] => [
      view('/do/hold-some'),
      view('/new'),
      ...(kind === 'passkey' ? [{ name: 'Passkey', path: '/new', value: 'ok' } as EventBody] : []),
      { name: 'Wallet created', path: '/new', value: kind },
      view('/wallet/backup'),
      { name: 'Words shown', path: '/wallet/backup', value: kind },
      view('/do/hold-some'),
      view('/wallet/receive'),
      { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
    ];

    // -- A wallet made without a passkey, on a phone. The coins arrive: the faucet's result holds the way back
    //    to the step, by name, and the page has moved to show it. --
    const plain = await begin(s, '/do/hold-some', PHONE);
    const first = await toFaucet(plain.page, 'create-words');
    await plain.page.click('faucet-ask');
    await untilPhase(plain.page, 'arrived');
    assert.equal(await plain.page.text('faucet-step'), backTo('hold-some'));
    assert.equal(await hrefOf(plain.page, 'faucet-step'), '/do/hold-some');
    assert.equal(await isMain(plain.page, 'faucet-step'), true);
    await untilOnScreen(plain.page, 'faucet-step');
    // It stands inside the result's box, straight after the first sentence and before the transaction's row.
    assert.deepEqual(await resultOrder(plain.page, 3), ['p', 'step', 'dl']);
    assert.equal(await plain.page.sidewaysScroll(), 0);
    const firstTxid = ((await attributeOf(plain.page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    // Its confirmation does not move the page again, and the button stays.
    const stood = await plain.page.page.evaluate(() => window.scrollY);
    await s.network.nextBlock();
    await untilPhase(plain.page, 'confirmed');
    await plain.page.settle();
    assert.equal(await plain.page.page.evaluate(() => window.scrollY), stood, 'the page stays where it is when the coins confirm');
    assert.equal(await plain.page.text('faucet-step'), backTo('hold-some'));
    // The strip, above all this. The coin has its block, so the step's next part is the question about that
    // block. On Receive the wallet does not read its list of transactions, and the list it holds was read on
    // the step's screen, before the coin came: it holds no payment to the wallet. The strip does not take that
    // for "no coins": it names the part, over a result that says the coins are confirmed.
    await until(async () => (await noteOf(plain.page))?.steps['hold-some']?.parts?.[3] === true, 'part 3 of "Hold some" ticks with the block');
    await plain.page.settle();
    const above = await stripOf(plain.page);
    assert.deepEqual([above?.step, above?.says, above?.words], ['hold-some', 'part', partName('hold-some', 4)]);
    assert.equal(await plain.page.text('strip-short'), fill(en.stripShort, { n: '4', m: '4' }), 'on a phone: how far the step is, where a need would stand');
    assert.ok((await plain.page.text('faucet-state')).startsWith(fill(receive.stateConfirmed, { amount: '100,000 practice sats' })));
    // The press: a page load after the bot check, and the step's own screen.
    await loads(plain.page, () => plain.page.click('faucet-step'));
    await arrivesAt(plain.page, '/do/hold-some');
    await untilParts(plain.page, ['ticked', 'ticked', 'ticked', 'now']);

    // -- A wallet made with a passkey. Asking the faucet locks it, and the screen says so above: the button is
    //    on screen all the same. --
    const keyed = await begin(s, '/do/hold-some', { ...PHONE, passkey: 'prf' });
    const second = await toFaucet(keyed.page, 'create-passkey');
    await keyed.page.click('faucet-ask');
    await untilPhase(keyed.page, 'arrived');
    assert.equal(await keyed.page.text('faucet-step'), backTo('hold-some'));
    await untilOnScreen(keyed.page, 'faucet-step');
    assert.equal(await keyed.page.sidewaysScroll(), 0);
    const secondTxid = ((await attributeOf(keyed.page, 'faucet-tx-link', 'href')) ?? '').slice(-64);

    // -- Coins that turn up after a request that failed. The bot check fails, so the faucet is never asked. Then
    //    coins arrive at the address from somewhere else. The result has no record of a payment to show, and it
    //    holds the way back to the step all the same: the step sent the reader here for coins, and here they are. --
    const stray = await begin(s, '/do/hold-some', { ...PHONE, turnstile: 'fail' });
    const strayed = await toFaucet(stray.page, 'create-words');
    await stray.page.click('faucet-ask');
    await untilPhase(stray.page, 'failed');
    assert.equal(await countOf(stray.page, 'faucet-step'), 0, 'a request that failed leads nowhere');
    await stray.page.settle();
    await stray.page.page.evaluate(() => window.scrollTo(0, 0));
    const strayTxid = s.standIn.fund(strayed.record.firstAddress, 100_000, { confirmed: false });
    await untilPhase(stray.page, 'arrived');
    assert.ok((await stray.page.text('faucet-state')).startsWith(receive.stateArrivedNoRecord), await stray.page.text('faucet-state'));
    assert.equal(await countOf(stray.page, 'faucet-tx-link'), 0, 'no record of a payment');
    assert.equal(await countOf(stray.page, 'faucet-step'), 1, 'coins that arrived with no record of a payment: the result holds the way back to the step');
    assert.equal(await stray.page.text('faucet-step'), backTo('hold-some'));
    assert.equal(await hrefOf(stray.page, 'faucet-step'), '/do/hold-some');
    assert.equal(await isMain(stray.page, 'faucet-step'), true);
    await untilOnScreen(stray.page, 'faucet-step');
    assert.deepEqual(await resultOrder(stray.page, 2), ['p', 'step'], 'straight after the result\'s one sentence');
    assert.equal(await stray.page.sidewaysScroll(), 0);
    assert.deepEqual((await noteOf(stray.page))?.steps, { 'hold-some': { started: true, parts: { 1: true, 2: true } } });

    // -- The move of the page when the coins come, seen by itself. The practice network takes a while to list
    //    the faucet's payment, so the promise and the coins are two moments. The reader has scrolled back to
    //    the top of Receive when the block comes: for a reader who follows a step the page moves once more, to
    //    the button. --
    s.standIn.setEsploraLag(120);
    const late = await begin(s, '/do/hold-some', PHONE);
    const third = await toFaucet(late.page, 'create-words');
    await late.page.click('faucet-ask');
    await untilPhase(late.page, 'on-its-way');
    assert.equal(await countOf(late.page, 'faucet-step'), 0, 'promised is not here: no button yet');
    await late.page.settle();
    await late.page.page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await shareOnScreen(late.page, 'faucet-state'), 0, 'from the top of Receive on a phone, the faucet\'s result is below the screen');
    await s.network.nextBlock();
    await untilPhase(late.page, 'confirmed');
    assert.equal(await late.page.text('faucet-step'), backTo('hold-some'));
    await untilOnScreen(late.page, 'faucet-step');
    const thirdTxid = ((await attributeOf(late.page, 'faucet-tx-link', 'href')) ?? '').slice(-64);

    // -- The faucet has paid this address before. The reader asks, loads Receive again before the practice
    //    network lists the payment, and asks again for the same address: the faucet answers that it has paid
    //    it, and the wallet has no record of that payment to show. (The block comes further down, with the
    //    next reader's.) --
    const twice = await begin(s, '/do/hold-some', PHONE);
    const repeated = await toFaucet(twice.page, 'create-words');
    await twice.page.click('faucet-ask');
    await untilPhase(twice.page, 'on-its-way');
    const repeatedTxid = await twice.page.text('faucet-txid');
    assert.match(repeatedTxid, /^[0-9a-f]{64}$/);
    await twice.page.goto('/wallet/receive');
    await twice.page.waitFor('faucet-ask');
    assert.equal(await twice.page.text('receive-address'), repeated.record.firstAddress);
    await untilStrip(twice.page, 'hold-some', 'part');
    await twice.page.click('faucet-ask');
    await untilPhase(twice.page, 'on-its-way');
    assert.ok((await twice.page.text('faucet-state')).startsWith(receive.statePaidBefore), await twice.page.text('faucet-state'));
    assert.equal(await countOf(twice.page, 'faucet-step'), 0, 'promised is not here: no button yet');
    await twice.page.settle();
    await twice.page.page.evaluate(() => window.scrollTo(0, 0));

    // -- A reader who follows no step, in the same moments: no button, and the page does not move when the
    //    coins come. --
    const alone = freshRecord();
    assert.ok(alone.mnemonic !== undefined);
    const nobody = await begin(s, '/wallet/receive', { ...PHONE, record: alone });
    await nobody.page.waitFor('faucet-ask');
    await nobody.page.click('faucet-ask');
    await untilPhase(nobody.page, 'on-its-way');
    await nobody.page.settle();
    await nobody.page.page.evaluate(() => window.scrollTo(0, 0));
    await s.network.nextBlock();
    await untilPhase(nobody.page, 'confirmed');
    await nobody.page.settle();
    assert.equal(await nobody.page.page.evaluate(() => window.scrollY), 0, 'the page stays at its top');
    assert.equal(await countOf(nobody.page, 'faucet-step'), 0);
    assert.equal(await stripOf(nobody.page), null);
    assert.equal(await noteText(nobody.page), null, 'and nothing of the steps is stored');
    const fourthTxid = ((await attributeOf(nobody.page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    // The same block took in the payment to the reader whom the faucet had paid before. Their coins show,
    // confirmed, with no record of the payment: the result holds the way back to the step, straight after
    // its one sentence, and the page has moved to show it.
    await untilPhase(twice.page, 'confirmed');
    assert.ok((await twice.page.text('faucet-state')).startsWith(receive.stateConfirmedNoRecord), await twice.page.text('faucet-state'));
    assert.equal(await countOf(twice.page, 'faucet-tx-link'), 0, 'no record of a payment');
    assert.equal(await countOf(twice.page, 'faucet-step'), 1, 'confirmed coins with no record of a payment: the result holds the way back to the step');
    assert.equal(await twice.page.text('faucet-step'), backTo('hold-some'));
    assert.equal(await hrefOf(twice.page, 'faucet-step'), '/do/hold-some');
    assert.equal(await isMain(twice.page, 'faucet-step'), true);
    await untilOnScreen(twice.page, 'faucet-step');
    assert.deepEqual(await resultOrder(twice.page, 2), ['p', 'step']);
    assert.equal(await twice.page.sidewaysScroll(), 0);
    // The press leads to the step, where the question about the coin's block is open.
    await loads(twice.page, () => twice.page.click('faucet-step'));
    await arrivesAt(twice.page, '/do/hold-some');
    await untilParts(twice.page, ['ticked', 'ticked', 'ticked', 'now']);
    s.standIn.setEsploraLag(0);

    // -- "Payment sent". A wallet with coins, and "Pass it on" followed: once the payment to the pot is out, the
    //    sent view leads back to the step by name, as its main button, above the figures. --
    const funded = testRecord();
    const funding = s.standIn.fund(funded.firstAddress, 100_000);
    const payer = await begin(s, '/do/pass-it-on', { record: funded });
    await untilParts(payer.page, ['ticked', 'now', 'later']);
    await act(payer.page, '/wallet/send');
    const paid = await pay(payer.page, 'pot', '30,000');
    assert.equal(await payer.page.text('sent-step'), backTo('pass-it-on'));
    assert.equal(await hrefOf(payer.page, 'sent-step'), '/do/pass-it-on');
    assert.deepEqual([await isMain(payer.page, 'sent-step'), await isMain(payer.page, 'sent-link'), await isMain(payer.page, 'send-another')], [true, false, false]);
    assert.deepEqual(
      await payer.page.page.$eval(hook('send-sent'), (sent) => {
        const order = ['sent-next', 'sent-step', 'sent-txid', 'sent-link'].map((id) => sent.querySelector(`[data-testid="${id}"]`));
        return order.every((each, index) => each !== null && (index === 0 || (order[index - 1]!.compareDocumentPosition(each) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0));
      }),
      true,
      'after the sentence on what happens next, before the figures and the other buttons',
    );
    // The button leads to the step's own screen, where its last part waits for the block. (On Send the wallet
    // does not read its list of transactions, so the step is not done there.)
    await payer.page.click('sent-step');
    await arrivesAt(payer.page, '/do/pass-it-on');
    await untilParts(payer.page, ['ticked', 'ticked', 'now']);
    await s.network.nextBlock();
    await payer.page.waitFor('step-done');

    // -- A followed step that takes no payment ("The seed"): a payment is not its part. And a reader who
    //    follows no step. For both the sent view is as it always was: "See this transaction" is the main button. --
    await payer.page.goto('/do/the-seed');
    await untilParts(payer.page, ['now', 'later', 'later']);
    assert.equal((await noteOf(payer.page))?.following, 'the-seed');
    await payer.page.goto('/wallet/send');
    await untilStrip(payer.page, 'the-seed', 'part');
    const other = await pay(payer.page, 'pot', '10,000');
    await payer.page.settle();
    assert.equal(await countOf(payer.page, 'sent-step'), 0);
    assert.equal(await isMain(payer.page, 'sent-link'), true);
    // The same browser with no note of the steps at all: nothing is followed.
    await payer.page.goto('/robots.txt');
    await payer.page.store(PROGRESS_KEY, null);
    await payer.page.goto('/wallet/send');
    const unfollowed = await pay(payer.page, 'pot', '5,000');
    await payer.page.settle();
    assert.equal(await countOf(payer.page, 'sent-step'), 0);
    assert.equal(await isMain(payer.page, 'sent-link'), true);
    assert.equal(await stripOf(payer.page), null);
    assert.equal(await noteText(payer.page), null);

    // What was counted: each reader's own screens and events, and the two steps that were done.
    await plain.page.settle();
    assert.deepEqual(stepsCounted(s), { 'pass-it-on': 1 });
    const secrets = {
      records: [first.record, second.record, strayed.record, third.record, repeated.record, alone, funded],
      words: [first.words, second.words, strayed.words, third.words, repeated.words, alone.mnemonic.split(' '), funded.mnemonic?.split(' ') ?? []],
      addresses: [
        first.record.firstAddress,
        second.record.firstAddress,
        strayed.record.firstAddress,
        third.record.firstAddress,
        repeated.record.firstAddress,
        alone.firstAddress,
        funded.firstAddress,
        paid.to,
        other.to,
        unfollowed.to,
      ],
      txids: [firstTxid, secondTxid, strayTxid, thirdTxid, repeatedTxid, fourthTxid, funding, paid.txid, other.txid, unfollowed.txid],
    };
    for (const each of [plain, keyed, stray, late, twice, nobody, payer]) await storedIsPublic(each.page, secrets);
    const sentBy = (requests: ReturnType<typeof plain.requests>): EventBody[] => requests.map((request) => JSON.parse(request.body) as EventBody);
    assert.deepEqual(sentBy(plain.requests()), [...countedTo('words'), view('/do/hold-some')]);
    assert.deepEqual(sentBy(keyed.requests()), countedTo('passkey'));
    // The request that failed is counted as failed, and the coins that came from elsewhere are no count of the faucet's.
    assert.deepEqual(sentBy(stray.requests()), [...countedTo('words').slice(0, -1), { name: 'Faucet', path: '/wallet/receive', value: 'failed' }]);
    assert.deepEqual(sentBy(late.requests()), countedTo('words'));
    assert.deepEqual(sentBy(twice.requests()), [
      ...countedTo('words'),
      view('/wallet/receive'),
      { name: 'Faucet', path: '/wallet/receive', value: 'already-paid' },
      view('/do/hold-some'),
    ]);
    assert.deepEqual(sentBy(nobody.requests()), [view('/wallet/receive'), { name: 'Faucet', path: '/wallet/receive', value: 'ok' }]);
    assert.deepEqual(sentBy(payer.requests()), [
      view('/do/pass-it-on'),
      view('/wallet/send'),
      { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
      view('/do/pass-it-on'),
      doIt('/do/pass-it-on', 'pass-it-on'),
      view('/do/the-seed'),
      view('/wallet/send'),
      { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
      view('/wallet/send'),
      { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
    ]);
  },
);

scenario(
  'On "Wallet made", "I have written them down" leads back to the step that is followed, in Spanish too, and to the Overview when none is: with no note at all, and for a step that was last followed more than a day ago',
  { timeout: 200_000 },
  async (s) => {
    const counted: EventBody[] = [];
    const reader = await begin(s, '/do/hold-some');
    const { page } = reader;
    counted.push(view('/do/hold-some'));

    /** Takes the wallet and the note out of this browser, behind the app's back: the next visit is a first one. */
    const empty = async (): Promise<void> => {
      await page.goto('/robots.txt');
      await page.store(RECORD_KEY, null);
      await page.store(PROGRESS_KEY, null);
    };
    /** From Create: makes a wallet, and presses "I have written them down" on the "Wallet made" step. */
    const makeAndWrite = async (prefix = '') => {
      const made = await createFrom(page, 'create-words', prefix);
      counted.push({ name: 'Wallet created', path: `${prefix}/new`, value: 'words' }, view(`${prefix}/wallet/backup`), { name: 'Words shown', path: `${prefix}/wallet/backup`, value: 'words' });
      assert.equal(await page.text('words-written'), strings.backup[prefix === '' ? 'en' : 'es'].written);
      await page.click('words-written');
      return made;
    };

    // -- "Hold some" is followed: it sent the reader to make a wallet. The button leads straight back to it. --
    await untilParts(page, ['now', 'later', 'later', 'later']);
    const documents = documentsOf(page);
    await act(page, '/new');
    counted.push(view('/new'));
    const first = await makeAndWrite();
    await arrivesAt(page, '/do/hold-some');
    counted.push(view('/do/hold-some'));
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.equal(await addressOf(page), '/do/hold-some');
    assert.equal(documentsOf(page), documents, 'a move inside the app');
    // The words left the screen with the button, and the "Wallet made" step is over: Backup asks before it shows them again.
    assert.equal(await countOf(page, 'word'), 0);
    await page.goto('/wallet/backup');
    await page.waitFor('reveal-words');
    counted.push(view('/wallet/backup'));
    assert.equal(await countOf(page, 'word'), 0);

    // -- In Spanish: back to the step's Spanish screen. --
    await empty();
    await page.goto('/es/do/hold-some');
    counted.push(view('/es/do/hold-some'));
    await untilParts(page, ['now', 'later', 'later', 'later']);
    await act(page, '/es/new');
    counted.push(view('/es/new'));
    const second = await makeAndWrite('/es');
    await arrivesAt(page, '/es/do/hold-some');
    counted.push(view('/es/do/hold-some'));
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.equal(await page.text('step-title'), titleOf('hold-some', 'es'));

    // -- No step is followed: the wallet's Overview, as it always was. --
    await empty();
    await page.goto('/new');
    await page.waitFor('create-words');
    counted.push(view('/new'));
    const third = await makeAndWrite();
    await arrivesAt(page, '/wallet');
    counted.push(view('/wallet'));
    assert.equal(await stripOf(page), null);
    assert.equal(await noteText(page), null);

    // -- A step that was last followed more than a day ago has no strip, and is not led back to: the Overview.
    //    ("There are no balances": making a wallet ticks no part of it.) --
    const DAY_AGO = Date.now() - 25 * 3_600_000;
    await empty();
    await page.store(PROGRESS_KEY, noteFor({ following: 'no-balances', followedAt: DAY_AGO, steps: { 'no-balances': { started: true, from: PAYMENT_PAGE } } }));
    await page.goto('/new');
    await page.waitFor('create-words');
    counted.push(view('/new'));
    await page.settle();
    assert.equal(await stripOf(page), null);
    const fourth = await makeAndWrite();
    await arrivesAt(page, '/wallet');
    counted.push(view('/wallet'));
    await page.settle();
    assert.equal(await stripOf(page), null);
    assert.deepEqual((await noteOf(page))?.steps, { 'no-balances': { started: true, from: PAYMENT_PAGE } });

    // -- "Hold some", last followed as long ago: no strip on Create either. But making the wallet is its first
    //    part, and a part of the followed step ticked is that step followed again: the strip is back on
    //    "Wallet made", and the button leads to the step it shows. --
    await empty();
    await page.store(PROGRESS_KEY, noteFor({ following: 'hold-some', followedAt: DAY_AGO, steps: { 'hold-some': { started: true, from: BITCOIN_PAGE } } }));
    await page.goto('/new');
    await page.waitFor('create-words');
    counted.push(view('/new'));
    await page.settle();
    assert.equal(await stripOf(page), null);
    const fifth = await createFrom(page, 'create-words');
    counted.push({ name: 'Wallet created', path: '/new', value: 'words' }, view('/wallet/backup'), { name: 'Words shown', path: '/wallet/backup', value: 'words' });
    assert.equal((await untilStrip(page, 'hold-some', 'part')).words, partName('hold-some', 2));
    await page.click('words-written');
    await arrivesAt(page, '/do/hold-some');
    counted.push(view('/do/hold-some'));
    await untilParts(page, ['ticked', 'now', 'later', 'later']);
    assert.deepEqual((await noteOf(page))?.steps, { 'hold-some': { started: true, from: BITCOIN_PAGE, parts: { 1: true } } });

    assert.deepEqual(stepsCounted(s), {});
    await ends(s, reader, counted, {
      records: [first.record, second.record, third.record, fourth.record, fifth.record],
      words: [first.words, second.words, third.words, fourth.words, fifth.words],
      addresses: [first.record.firstAddress, second.record.firstAddress, third.record.firstAddress, fourth.record.firstAddress, fifth.record.firstAddress],
      txids: [],
    });
  },
);

scenario(
  'A need\'s link to another step tells the steps however the reader uses it: from the keyboard, with the middle button, and from the browser\'s own menu, on the need\'s button and on the drill\'s link to "The seed" alike; the tab that the middle button opens leads back to the step the reader came for and to their chapter; and a reader from the list is remembered nothing by any of them',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;

    /**
     * The ways of using a link that open it in a new tab, or offer to:
     *   middle  a press with the middle button of the mouse
     *   right   a press with the right one, which opens the browser's own menu on the link
     *   menu    that menu as a phone's browser tells a page of it, when the reader presses long on the link
     */
    type Use = 'middle' | 'right' | 'menu';
    const USES: readonly Use[] = ['right', 'menu', 'middle'];
    const use = async (page: OpenedPage, id: string, how: Use): Promise<void> => {
      if (how === 'menu') {
        // A long press tells the page one thing, "contextmenu", where a mouse's right button tells it two. The
        // scenario makes that one event itself: the page takes it as it takes the browser's.
        await page.page.$eval(hook(id), (link) => {
          link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
        });
        return;
      }
      // The harness lets no page open another window or tab (helpers.ts), and a tab that the middle button opens
      // would be one nobody watches. So the browser's own part of that press, the new tab, is stopped here. The
      // press itself reaches the link, and the page, as it does for a reader. Where the scenario needs the tab,
      // it opens it itself, on the same storage.
      if (how === 'middle') {
        await page.page.evaluate(() => document.addEventListener('auxclick', (event) => event.preventDefault(), { capture: true, once: true }));
      }
      await page.page.click(hook(id), { button: how });
    };
    /** Opens `path` with no note stored, uses the link with this hook, and gives the note before and after. */
    const fresh = async (page: OpenedPage, path: string, id: string, how: Use): Promise<{ before: Progress | null; after: Progress | null }> => {
      await page.goto('/robots.txt');
      await page.store(PROGRESS_KEY, null);
      await page.goto(path);
      await page.waitFor(id);
      const before = await noteOf(page);
      await use(page, id, how);
      await page.settle(200);
      assert.equal(await addressOf(page), path, `${how}: the page stays where it is`);
      return { before, after: await noteOf(page) };
    };

    // -- 1. The drill's link to "The seed", pressed from the keyboard. The reader came from the Spanish page of
    //       the keys chapter and pressed the card "Comprueba el respaldo". Their wallet holds coins, and they
    //       have no paper copy of its words: the line over the three word fields names the step where one is
    //       made. --
    const record = freshRecord();
    assert.ok(record.mnemonic !== undefined);
    const words = record.mnemonic.split(' ');
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const card = `${site}${KEYS_PAGE_ES}#do-prove-the-backup`;
    const drill = { started: true as const, from: KEYS_PAGE_ES };
    const reader = await begin(s, `/es/do/prove-the-backup?from=${KEYS_PAGE_ES}`, { record });
    const { page } = reader;
    const counted: EventBody[] = [view('/es/do/prove-the-backup')];
    await page.waitFor('step-paper-link');
    assert.equal(await page.text('step-paper-link'), fill(es.actStep, { step: titleOf('the-seed', 'es') }));
    assert.equal(await hrefOf(page, 'step-paper-link'), '/es/do/the-seed', 'the link\'s address names the other step and nothing more');
    assert.equal(await hrefOf(page, 'step-back'), card);
    let note = await noteOf(page);
    assert.deepEqual([note?.following, note?.steps], ['prove-the-backup', { 'prove-the-backup': drill }]);
    const writes = await watchNoteWrites(page);
    await page.page.focus(hook('step-paper-link'));
    await page.page.keyboard.press('Enter');
    await arrivesAt(page, '/es/do/the-seed');
    counted.push(view('/es/do/the-seed'));
    await untilParts(page, ['now', 'later', 'later']);
    // Two writes, as for the need's button: the press, which names the step the reader came for and starts
    // nothing, and the opening of the screen it leads to.
    assert.deepEqual(
      (await writes()).map((each) => [each.following, each.steps]),
      [
        ['prove-the-backup', { 'the-seed': { cameFor: 'prove-the-backup' }, 'prove-the-backup': drill }],
        ['the-seed', { 'the-seed': { started: true, cameFor: 'prove-the-backup' }, 'prove-the-backup': drill }],
      ],
    );
    assert.equal(await addressOf(page), '/es/do/the-seed');
    // "La semilla" belongs to the same chapter. Its link back leads to the card the reader pressed, on the
    // step's own screen and on the strip of the wallet's screens.
    assert.equal(await page.text('step-chapter'), chapterLine('keys', 'es'));
    assert.equal(await hrefOf(page, 'step-back'), card);
    await act(page, '/es/wallet/backup');
    counted.push(view('/es/wallet/backup'));
    await untilStrip(page, 'the-seed', 'part');
    assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], ['/es/do/the-seed', card]);

    // -- 2. The same link used in the ways that open a new tab, each from a note that holds no memory yet. The
    //       step it leads to is named the step the reader came for, and nothing else changes: this tab stays
    //       where it is, "The seed" is not started, and the drill is still the step that is followed. --
    for (const how of USES) {
      const path = `/do/prove-the-backup?from=${KEYS_PAGE}`;
      const { before, after } = await fresh(page, path, 'step-paper-link', how);
      counted.push(view('/do/prove-the-backup'));
      assert.deepEqual(before?.steps, { 'prove-the-backup': { started: true, from: KEYS_PAGE } }, how);
      assert.deepEqual(after, { ...before, steps: { 'the-seed': { cameFor: 'prove-the-backup' }, 'prove-the-backup': { started: true, from: KEYS_PAGE } } }, how);
    }

    // -- 3. The button of a need. A reader with no wallet opens "Pass it on" from the wallet's own list: that
    //       reader is remembered nothing, whichever way they use the link to "Hold some". --
    const carded = await begin(s, '/do/pass-it-on');
    const first = carded.page;
    const cardCounted: EventBody[] = [view('/do/pass-it-on')];
    await first.waitFor('step-need-link');
    const fromList = await noteText(first);
    for (const how of USES) {
      await use(first, 'step-need-link', how);
      await first.settle(200);
      assert.equal(await noteText(first), fromList, `${how}: nothing is written for a reader from the list`);
      assert.equal(await addressOf(first), '/do/pass-it-on');
    }
    // The reader who pressed the card of "Pass it on" in the payment chapter: each way writes the step they came for.
    const CARD = `${site}${PAYMENT_PAGE}#do-pass-it-on`;
    const byCard = { started: true as const, from: PAYMENT_PAGE };
    for (const how of USES) {
      const { before, after } = await fresh(first, `/do/pass-it-on?from=${PAYMENT_PAGE}`, 'step-need-link', how);
      cardCounted.push(view('/do/pass-it-on'));
      assert.deepEqual(before?.steps, { 'pass-it-on': byCard }, how);
      assert.deepEqual(after, { ...before, steps: { 'hold-some': { cameFor: 'pass-it-on' }, 'pass-it-on': byCard } }, how);
    }

    // -- 4. The tab that the middle button opens: another tab of the same browser, at the link's address. It
    //       finds the step the reader came for in the note. "Hold some" there leads back to the card they
    //       pressed in the payment chapter, on its own screen and on the strip, and not to the bitcoin chapter. --
    assert.equal(await hrefOf(first, 'step-need-link'), '/do/hold-some');
    const tab = await standBy(s, { context: first.context, timeout: 30_000 });
    const opened: Reader = { page: tab, requests: watchEventRequests(tab) };
    await tab.goto('/do/hold-some');
    await untilParts(tab, ['now', 'later', 'later', 'later']);
    assert.equal(await tab.text('step-chapter'), chapterLine('bitcoin'));
    assert.equal(await hrefOf(tab, 'step-back'), CARD);
    note = await noteOf(tab);
    assert.deepEqual([note?.following, note?.steps], ['hold-some', { 'hold-some': { started: true, cameFor: 'pass-it-on' }, 'pass-it-on': byCard }]);
    await act(tab, '/new');
    await untilStrip(tab, 'hold-some', 'part');
    assert.deepEqual([await hrefOf(tab, 'strip-back'), await hrefOf(tab, 'strip-chapter')], ['/do/hold-some', CARD]);

    assert.deepEqual(stepsCounted(s), {});
    const secrets = { records: [record], words: [words], addresses: [record.firstAddress], txids: [funding] };
    await endsTwo(
      s,
      [
        { reader, expected: counted },
        { reader: carded, expected: cardCounted },
        { reader: opened, expected: [view('/do/hold-some'), view('/new')] },
      ],
      secrets,
    );
    // The second browser's storage as well: the note of the reader with no wallet, and nothing else.
    await storedIsPublic(first, secrets);
  },
);
