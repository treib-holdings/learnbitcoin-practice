// The hand-over between a chapter of the main site and the practice wallet,
// through the real screens: a reader who came from a chapter to do a step
// ends up back in that chapter, at the place they left.
//
// A chapter's card leads into the wallet with "?from=<the chapter's page>".
// A step that needs a wallet or coins sends a reader who came that way
// straight to the screen that gives them (Create, Home, the faucet), by
// the wallet's own short road: such a reader is not sent through "Hold
// some". From there they go through the wallet's own screens, and have to
// find the way back at every point: back to the step, and back to the
// chapter. A need can still lead to another step of the same chapter
// ("There are no balances" to "Pass it on", the drill to "The seed"), and
// the earlier version of the wallet sent every reader through "Hold some":
// its notes are still in readers' browsers. These scenarios follow those
// ways back.
//
//   1. the short road: from the card of "Pass it on" in the payment
//      chapter with no wallet, by Create, "Wallet made", the faucet and
//      Send, with the note read at every stop and every address read to
//      the character; "Hold some" is never opened, noted or counted
//   2. the reader who gave up half-way, on the earlier version's road and
//      on the short one, and the other roads into a detour
//   3. a done step's link back names every done step of its chapter, and
//      which buttons a done step's card has by the way the reader came
//   4. the strip's link back to the chapter, on phones too, and the
//      footer's link to the main site
//   5. the faucet's result and "Payment sent" lead back to the step, and
//      the faucet's result says when the block that came there finished it
//   6. "I have written them down" leads back to the step that is followed
//   7. a need's link to another step tells the steps however it is used:
//      from the keyboard, with the middle button, from the browser's menu
//   8. the two cards of the keys chapter, by the short road
//   9. the next move is in the window on four wallet screens while a step
//      is followed, on the gate that stands in for a wallet screen in the
//      middle of the drill, and on a step's own screen when the step ends
//      there; nothing is new for a reader who follows none
//  10. after the short road "Hold some" is not started, and its first
//      opening goes by the wallet as it stands
//
// No scenario here follows a link to the main site: the main site is no
// part of a scenario's world. Each reads the link's address off the page,
// as the other scenarios of the steps do. doit-chapter.test.ts is the one
// that presses such links, at a stand-in for the main site.
//
// Scenarios 3, 4 and 6 touch nothing of the stand-in, and could run
// against a real practice network as they are. The others are local only:
// they ask the faucet (the bot check is the harness's stand-in), pay a
// wallet from the stand-in or make blocks.

import assert from 'node:assert/strict';
import type { EventBody, Lang, StepId } from '@learnbitcoin/practice-contract';
import type { ChapterKey } from '../../app/src/lib/doit/steps.ts';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { OTHER_WORDS, freshRecord, scenario, testRecord, type OpenedPage } from './helpers.ts';
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
  isMain,
  listState,
  mainSays,
  namesBlock,
  namesNoBlock,
  noteFor,
  noteOf,
  noteText,
  partName,
  partsOf,
  pay,
  pickStep,
  removeHere,
  restoreHere,
  saidDone,
  section,
  shareOnScreen,
  stepsCounted,
  storedIsPublic,
  stripBack,
  stripOf,
  titleOf,
  typeThree,
  untilOnScreen,
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

/** An address of somebody else's wallet, to pay. */
const SOMEONE_ELSE = testRecord(OTHER_WORDS).firstAddress;

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
  'From a card in the payment chapter with no wallet, by the wallet\'s own short road: the step names Create, "Wallet made" and the faucet\'s result lead back to it by name, the link back leads to the card the reader pressed at every stop, and "Hold some" is never opened, noted or counted',
  { localOnly: true, timeout: 240_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    /** The card the reader pressed: "Pass it on", on the English page of the payment chapter. */
    const CARD = `${site}${PAYMENT_PAGE}#do-pass-it-on`;
    const byCard = { started: true as const, from: PAYMENT_PAGE };
    const reader = await begin(s, `/do/pass-it-on?from=${PAYMENT_PAGE}`);
    const { page } = reader;

    /** The note at this stop: which step is followed, and what it holds of each step. */
    const noteNow = async (): Promise<[Progress['following'] | undefined, Progress['steps'] | undefined]> => {
      const stored = await noteOf(page);
      return [stored?.following, stored?.steps];
    };
    /** On a wallet screen: the strip is for the reader's own step, and carries both ways back. */
    const bothWaysBack = async (where: string): Promise<void> => {
      assert.equal((await stripOf(page))?.step, 'pass-it-on', where);
      assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], ['/do/pass-it-on', CARD], where);
    };
    /** Nothing on the screen leads to "Hold some", and the note holds nothing of it. */
    const neverHoldSome = async (where: string): Promise<void> => {
      assert.equal(await page.page.$$eval('a[href$="/do/hold-some"]', (links) => links.length), 0, `${where}: a link to "Hold some"`);
      assert.doesNotMatch((await noteText(page)) ?? '', /hold-some|cameFor/, where);
    };
    const firstOfThree = { n: '1', m: '3' };

    // -- 1. The chapter's card leads here. The step needs a wallet, and there is none: it names Create, the
    //       screen that makes one, and says where a wallet the reader already has comes back. --
    await untilParts(page, ['blocked', 'later', 'later']);
    assert.equal(await page.text('step-chapter'), chapterLine('payment'));
    assert.equal(await hrefOf(page, 'step-back'), CARD);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-wallet');
    assert.ok((await page.text('step-need')).startsWith(en['need_no-wallet']));
    assert.equal(await page.text('step-need-link'), en.actCreate);
    assert.equal(await hrefOf(page, 'step-need-link'), '/new');
    assert.equal(await isMain(page, 'step-need-link'), true);
    assert.equal(await page.text('step-need-also'), `${en.needHadOne} ${en.needHadOneLink}`);
    assert.equal(await hrefOf(page, 'step-need-also-link'), '/');
    assert.deepEqual(await noteNow(), ['pass-it-on', { 'pass-it-on': byCard }]);
    await neverHoldSome('the step, with no wallet');
    const documents = documentsOf(page);

    // -- 2. Create. The strip names the reader's own step and what it needs first, with both ways back. --
    await page.click('step-need-link');
    await arrivesAt(page, '/new');
    assert.equal(documentsOf(page), documents, 'a move inside the app');
    const onCreate = await untilStrip(page, 'pass-it-on', 'need');
    assert.equal(onCreate.words, en['stripNeed_no-wallet']);
    assert.equal(
      await page.text('strip'),
      `${en.name} ${titleOf('pass-it-on')} ${en['stripNeed_no-wallet']} ${fill(en.stripPart, firstOfThree)}: ${en['stripNeed_no-wallet']} ${en.stripBack} ${en.back} ${en.stripStop}`,
    );
    await bothWaysBack('Create');
    assert.deepEqual(await noteNow(), ['pass-it-on', { 'pass-it-on': byCard }]);
    await neverHoldSome('Create');

    // -- 3. The wallet is made: "Wallet made", with the 12 words. Under them stand the sentence on real money
    //       and the button that leads back to the step, by name. The step now needs coins. --
    const made = await createFrom(page, 'create-words');
    assert.equal((await untilStrip(page, 'pass-it-on', 'need')).words, en['stripNeed_no-coins']);
    await bothWaysBack('"Wallet made"');
    assert.equal(await page.text('words-written-step'), fill(strings.backup.en.writtenStep, { step: titleOf('pass-it-on') }));
    assert.equal(await page.text('words-written-step'), 'I have written them down: back to "Pass it on"');
    assert.deepEqual([await isMain(page, 'words-written-step'), await isMain(page, 'words-written')], [true, false]);
    assert.equal(await countOf(page, 'never-real-money'), 1);
    assert.deepEqual(await noteNow(), ['pass-it-on', { 'pass-it-on': byCard }], 'making a wallet ticks no part of "Pass it on"');
    await neverHoldSome('"Wallet made"');

    // -- 4. That button leads straight back to the step. It needs coins, and names the faucet. --
    await page.click('words-written-step');
    await arrivesAt(page, '/do/pass-it-on');
    await untilParts(page, ['blocked', 'later', 'later']);
    assert.equal(documentsOf(page), documents, 'a move inside the app');
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-coins');
    assert.ok((await page.text('step-need')).startsWith(en['need_no-coins']));
    assert.equal(await page.text('step-need-link'), en.actFaucet);
    assert.equal(await hrefOf(page, 'step-need-link'), '/wallet/receive#faucet');
    assert.equal(await countOf(page, 'step-need-also'), 0);
    assert.equal(await hrefOf(page, 'step-back'), CARD);
    assert.deepEqual(await noteNow(), ['pass-it-on', { 'pass-it-on': byCard }]);
    await neverHoldSome('the step, with no coins');

    // -- 5. The faucet. The coins arrive, and the faucet's result leads back to the step by name. --
    await page.click('step-need-link');
    await arrivesAt(page, '/wallet/receive');
    await page.waitFor('faucet-ask');
    await bothWaysBack('Receive');
    const address = await page.text('receive-address');
    assert.equal(address, made.record.firstAddress);
    await page.click('faucet-ask');
    await untilPhase(page, 'arrived');
    const faucetTxid = ((await attributeOf(page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    assert.match(faucetTxid, /^[0-9a-f]{64}$/);
    assert.equal(await page.text('faucet-step'), backTo('pass-it-on'));
    assert.equal(await hrefOf(page, 'faucet-step'), '/do/pass-it-on');
    assert.equal(await isMain(page, 'faucet-step'), true);
    await untilOnScreen(page, 'faucet-step');
    assert.equal(await countOf(page, 'faucet-step-done'), 0, 'the step is not done: the result says nothing of that');
    // The coins are here and wait for their block: the strip says what the step waits for.
    assert.equal((await untilStrip(page, 'pass-it-on', 'need')).words, en['stripNeed_not-spendable-yet']);
    await bothWaysBack('Receive, with the coins');
    assert.deepEqual(await noteNow(), ['pass-it-on', { 'pass-it-on': byCard }]);
    await neverHoldSome('Receive');

    // -- 6. Back to the step by that button: a page load, because the bot check's script has been in the page.
    //       Its first part says that the coins can be spent once a block has taken them in. The block comes,
    //       the part ticks by itself, and the next one opens Send. --
    assert.equal(await botCheckScripts(page), 1);
    await loads(page, () => page.click('faucet-step'));
    await arrivesAt(page, '/do/pass-it-on');
    assert.equal(documentsOf(page), documents + 1);
    assert.equal(await botCheckScripts(page), 0);
    await untilParts(page, ['blocked', 'later', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'not-spendable-yet');
    assert.equal(await countOf(page, 'step-need-link'), 0, 'nothing to press: the block comes by itself');
    assert.equal(await hrefOf(page, 'step-back'), CARD, 'the way back is the same on the far side of the page load');
    await s.network.nextBlock();
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal(await page.text('step-action'), en.actSend);
    assert.equal(await hrefOf(page, 'step-action'), '/wallet/send');
    assert.deepEqual(await noteNow(), ['pass-it-on', { 'pass-it-on': { ...byCard, parts: { 1: true } } }]);
    await neverHoldSome('the step, with coins');

    // -- 7. Send: the strip carries both ways back. The payment goes to the pot, and "Payment sent" leads back
    //       to the step by name, as its main button. --
    await act(page, '/wallet/send');
    assert.equal((await untilStrip(page, 'pass-it-on', 'part')).words, partName('pass-it-on', 2));
    await bothWaysBack('Send');
    const paid = await pay(page, 'pot', '30,000');
    assert.equal(await page.text('sent-step'), backTo('pass-it-on'));
    assert.equal(await hrefOf(page, 'sent-step'), '/do/pass-it-on');
    assert.deepEqual([await isMain(page, 'sent-step'), await isMain(page, 'sent-link')], [true, false]);
    let note = await noteOf(page);
    const paying = note?.steps['pass-it-on'];
    assert.deepEqual(paying, { ...byCard, tx: paid.txid, sentAt: paying?.sentAt, parts: { 1: true, 2: true } });
    assert.deepEqual([note?.following, Object.keys(note?.steps ?? {})], ['pass-it-on', ['pass-it-on']]);
    await neverHoldSome('"Payment sent"');

    // -- 8. Back to the step. The block comes, and the step is done. Its card: the link back to the payment
    //       chapter as the main button, now saying that the step is done, and "All steps". No "Next step": the
    //       reader came from the chapter, reads on there, and meets the next card where the chapter has it. --
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
    assert.deepEqual(note, {
      v: 1,
      following: null,
      steps: { 'pass-it-on': { started: true, doneAt: passDone, from: PAYMENT_PAGE, parts: { 1: true, 2: true, 3: true } } },
    });
    await neverHoldSome('the done card');

    // -- What the short road leaves of "Hold some": nothing. The reader has a wallet and coins, and the
    //    wallet's list says "Not started" for it, until its screen is opened once. --
    await page.click('step-list');
    await arrivesAt(page, '/do');
    assert.deepEqual([await listState(page, 'hold-some'), await listState(page, 'pass-it-on')], ['not-started', 'done']);
    assert.doesNotMatch((await noteText(page)) ?? '', /hold-some|cameFor/);

    // What was counted on the way, as a whole: each screen, the wallet's own events, and "Do it" once, for the
    // step the reader came for. No screen of "Hold some", and no count of it.
    assert.deepEqual(stepsCounted(s), { 'pass-it-on': 1 });
    await ends(
      s,
      reader,
      [
        view('/do/pass-it-on'),
        view('/new'),
        { name: 'Wallet created', path: '/new', value: 'words' },
        view('/wallet/backup'),
        { name: 'Words shown', path: '/wallet/backup', value: 'words' },
        view('/do/pass-it-on'),
        view('/wallet/receive'),
        { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
        view('/do/pass-it-on'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view('/do/pass-it-on'),
        doIt('/do/pass-it-on', 'pass-it-on'),
        view('/do'),
      ],
      { records: [made.record], words: [made.words], addresses: [address, paid.to], txids: [faucetTxid, paid.txid] },
    );
  },
);

scenario(
  'The reader who gave up half-way, and the other roads into a detour. Under a note the earlier version wrote, "Hold some" opened from the list on a later day still leads back to the chapter the reader left and to their step; opened by its own card it leads to the bitcoin chapter; with a way back of its own beside the memory it never leads to the bitcoin chapter while the detour lasts; the card of the reader\'s step, pressed again, names the faucet and not "Hold some", and "Hold some" is done by the block all the same and leads back to their step first. A need of a step from a chapter leads to another step of the chapter and from there to the faucet; a reader from the list is remembered nothing, and their press ends what an earlier road left; a restart keeps the memory and "Forget my progress" takes it. The reader who gave up on "Wallet made" of the short road finds the step where they left it: by its card, by the strip within a day, and from the list after it',
  { localOnly: true, timeout: 240_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const CARD = `${site}${PAYMENT_PAGE}#do-pass-it-on`;
    const HOURS = 3_600_000;
    const at = Date.now();
    const record = freshRecord();
    assert.ok(record.mnemonic !== undefined);
    const words = record.mnemonic.split(' ');
    const byCard = { started: true as const, from: PAYMENT_PAGE };
    /** A done "Hold some" as the earlier version stored it: with the tick of a fourth part, which this version does not have. */
    const allTicked = { 1: true as const, 2: true as const, 3: true as const, 4: true as const };
    /**
     * A note the earlier version wrote. Its reader pressed the card of "Pass it on" with no wallet, was sent to
     * "Hold some", and closed the tab on "Wallet made": a wallet, "Hold some" one part in and sent there by "Pass it on".
     */
    const halfWay = (followedAt: number): string =>
      noteFor({ following: 'hold-some', followedAt, steps: { 'hold-some': { started: true, cameFor: 'pass-it-on', parts: { 1: true } }, 'pass-it-on': byCard } });
    /** The same reader on this version's short road: a wallet, and "Pass it on" as its card started it. Nothing of "Hold some". */
    const shortRoad = (followedAt: number): string => noteFor({ following: 'pass-it-on', followedAt, steps: { 'pass-it-on': byCard } });

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
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal(await page.text('step-chapter'), chapterLine('bitcoin'));
    assert.equal(await hrefOf(page, 'step-back'), CARD);
    let note = await noteOf(page);
    assert.deepEqual([note?.following, note?.steps], ['hold-some', { 'hold-some': { started: true, cameFor: 'pass-it-on', parts: { 1: true } }, 'pass-it-on': byCard }]);
    // In Spanish too: the reader came from the English page of the payment chapter, and is led back to it.
    await openWith(halfWay(at), '/es/do/hold-some', 'step-parts');
    assert.equal(await page.text('step-chapter'), chapterLine('bitcoin', 'es'));
    assert.equal(await hrefOf(page, 'step-back'), CARD);

    // -- Done on that later day: it ends with the way back to their step, and the link back to their chapter.
    //    The fourth tick of the stored note is read as no part: the step has three, all checked. --
    const holdDone = { started: true as const, doneAt: at - HOURS, cameFor: 'pass-it-on' as const, parts: allTicked };
    await openWith(noteFor({ following: null, steps: { 'hold-some': holdDone, 'pass-it-on': byCard } }), '/do/hold-some', 'step-done');
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-led', words: backTo('pass-it-on'), href: '/do/pass-it-on', main: true },
      { hook: 'step-back', words: en.back, href: CARD, main: false },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);

    // -- The card of their own step, pressed again under that note. "Pass it on" no longer points at "Hold
    //    some": with a wallet and no coins its need names the faucet, and nothing on the screen leads to the
    //    other step. The note keeps what the earlier version wrote. --
    await openWith(halfWay(at - HOURS), `/do/pass-it-on?from=${PAYMENT_PAGE}`, 'step-need-link');
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-coins');
    assert.equal(await page.text('step-need-link'), en.actFaucet);
    assert.equal(await hrefOf(page, 'step-need-link'), '/wallet/receive#faucet');
    assert.equal(await countOf(page, 'step-need-also'), 0);
    assert.equal(await page.page.$$eval('main a[href$="/do/hold-some"]', (links) => links.length), 0);
    assert.equal(await hrefOf(page, 'step-back'), CARD);
    note = await noteOf(page);
    assert.deepEqual([note?.following, note?.steps], ['pass-it-on', { 'hold-some': { started: true, cameFor: 'pass-it-on', parts: { 1: true } }, 'pass-it-on': byCard }]);

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

    // -- A need that still leads to another step, by the real links. The wallet holds no coins and has sent
    //    nothing. The reader presses the card of "There are no balances" on the Spanish page of the payment
    //    chapter: its need leads to "Pass it on", for every reader. "Pass it on" was reached on a road that
    //    began at a card, so its own need names the faucet and not "Hold some". On both steps, and on the
    //    faucet's screen, "Back to the chapter" leads to the card they pressed. --
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
    assert.equal(await page.text('step-need-link'), en.actFaucet);
    assert.equal(await hrefOf(page, 'step-need-link'), '/wallet/receive#faucet');
    assert.equal(await page.page.$$eval('main a[href$="/do/hold-some"]', (links) => links.length), 0);
    note = await noteOf(page);
    assert.deepEqual([note?.following, note?.steps], [
      'pass-it-on',
      { 'pass-it-on': { started: true, cameFor: 'no-balances' }, 'no-balances': { started: true, from: PAYMENT_PAGE_ES } },
    ]);
    // The faucet's screen: the strip is for "Pass it on", says what it needs first, and carries both ways back.
    await page.click('step-need-link');
    await arrivesAt(page, '/wallet/receive');
    counted.push(view('/wallet/receive'));
    assert.equal((await untilStrip(page, 'pass-it-on', 'need')).words, en['stripNeed_no-coins']);
    assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], ['/do/pass-it-on', pressed]);
    assert.doesNotMatch((await noteText(page)) ?? '', /hold-some/, '"Hold some" is no part of that road');

    // -- A reader who opened "Pass it on" from the wallet's own list is remembered nothing: the press of the
    //    need's link writes no step, "Hold some" leads to its own chapter, and its strip has the one link. --
    await openWith(null, '/do/pass-it-on', 'step-need-link');
    assert.equal(await hrefOf(page, 'step-back'), `${site}${PAYMENT_PAGE}#do-pass-it-on`);
    const writes = await watchNoteWrites(page);
    assert.equal(await page.text('step-need-link'), fill(en.actStep, { step: titleOf('hold-some') }), 'a step from the list still names "Hold some"');
    await page.click('step-need-link');
    await arrivesAt(page, '/do/hold-some');
    counted.push(view('/do/hold-some'));
    await untilParts(page, ['ticked', 'now', 'later']);
    for (const each of await writes()) assert.doesNotMatch(JSON.stringify(each), /cameFor/);
    note = await noteOf(page);
    assert.deepEqual(note?.steps, { 'hold-some': { started: true, parts: { 1: true } }, 'pass-it-on': { started: true } });
    assert.equal(await hrefOf(page, 'step-back'), `${site}${BITCOIN_PAGE}#do-hold-some`);
    await act(page, '/wallet/receive');
    counted.push(view('/wallet/receive'));
    await untilStrip(page, 'hold-some', 'part');
    assert.equal(await hrefOf(page, 'strip-back'), '/do/hold-some');
    assert.equal(await countOf(page, 'strip-chapter'), 0, 'the strip of a step from the list is as it was');

    // -- And such a press ends what an earlier road left. On an earlier day, on the earlier version, the reader
    //    pressed the card of "The waiting room" in the payment chapter, was sent to "Hold some" and gave up
    //    there. Now they open "Prove the backup" from the wallet's own list. It needs coins too, and sends a
    //    reader from the list to "Hold some". This trip did not begin at a card: "Hold some" must not lead
    //    them back to "The waiting room", nor to the payment chapter. --
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
    await untilParts(page, ['ticked', 'now', 'later']);
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
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'blocked']);
    await page.click('step-restart');
    await untilParts(page, ['ticked', 'now', 'later']);
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
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal(await hrefOf(page, 'step-back'), `${site}${BITCOIN_PAGE}#do-hold-some`);
    assert.deepEqual((await noteOf(page))?.steps, { 'hold-some': { started: true, parts: { 1: true } } });
    assert.deepEqual(stepsCounted(s), {});

    // -- The reader who gave up on "Wallet made" of the short road. The browser holds their wallet, with no
    //    coins, and "Pass it on" as its card started it. They press the card again: the step is where they
    //    left it, at the faucet, and its note is as they left it. --
    await openWith(shortRoad(at - HOURS), `/do/pass-it-on?from=${PAYMENT_PAGE}`, 'step-need-link');
    assert.deepEqual(await partsOf(page), ['blocked', 'later', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-coins');
    assert.deepEqual([await page.text('step-need-link'), await hrefOf(page, 'step-need-link')], [en.actFaucet, '/wallet/receive#faucet']);
    assert.equal(await hrefOf(page, 'step-back'), CARD);
    note = await noteOf(page);
    assert.deepEqual([note?.following, note?.steps], ['pass-it-on', { 'pass-it-on': byCard }]);
    // They open the wallet itself, the same day: the strip names their step and what it needs first, with both ways back.
    await openWith(shortRoad(at - HOURS), '/wallet', 'overview-do-link');
    assert.equal((await untilStrip(page, 'pass-it-on', 'need')).words, en['stripNeed_no-coins']);
    assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], ['/do/pass-it-on', CARD]);
    // Another day: no strip. The Overview's line leads to the list, which shows their step as started and
    // "Hold some" as not started, and the step opens where they left it.
    await openWith(shortRoad(at - 25 * HOURS), '/wallet', 'overview-do-link');
    await page.settle();
    assert.equal(await stripOf(page), null);
    await page.click('overview-do-link');
    await arrivesAt(page, '/do');
    counted.push(view('/do'));
    assert.deepEqual([await listState(page, 'hold-some'), await listState(page, 'pass-it-on')], ['not-started', 'started']);
    await pickStep(page, 'pass-it-on');
    counted.push(view('/do/pass-it-on'));
    assert.deepEqual(await partsOf(page), ['blocked', 'later', 'later']);
    assert.deepEqual([await page.text('step-need-link'), await hrefOf(page, 'step-need-link')], [en.actFaucet, '/wallet/receive#faucet']);
    assert.equal(await hrefOf(page, 'step-back'), CARD);

    // -- Coins come to the wallet, and their block with them, while the reader of the earlier version's note
    //    is on the screen of their own step. "Hold some" was started under that note, and its parts are states
    //    of the wallet: it is done by the block, on the screen that is open, and counted under that screen.
    //    "Pass it on" gets its first part by the same block. --
    await openWith(halfWay(at - HOURS), `/do/pass-it-on?from=${PAYMENT_PAGE}`, 'step-need-link');
    const funding = s.standIn.fund(record.firstAddress, 100_000);
    const height = await s.network.height();
    await untilParts(page, ['ticked', 'now', 'later']);
    await until(async () => (await noteOf(page))?.steps['hold-some']?.doneAt !== undefined, '"Hold some" is done by the block');
    note = await noteOf(page);
    const doneNow = note?.steps['hold-some']?.doneAt;
    assert.deepEqual([note?.following, note?.steps], [
      'pass-it-on',
      {
        'hold-some': { started: true, doneAt: doneNow, cameFor: 'pass-it-on', parts: { 1: true, 2: true, 3: true } },
        'pass-it-on': { ...byCard, parts: { 1: true } },
      },
    ]);
    counted.push(doIt('/do/pass-it-on', 'hold-some'));
    assert.deepEqual(stepsCounted(s), { 'hold-some': 1 });
    // Its card leads back to the reader's step first, then to the card they pressed, and names the block
    // that took the coin in.
    await page.goto('/do/hold-some');
    await page.waitFor('step-done');
    counted.push(view('/do/hold-some'));
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-led', words: backTo('pass-it-on'), href: '/do/pass-it-on', main: true },
      { hook: 'step-back', words: en.back, href: CARD, main: false },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);
    await namesBlock(page, s, funding, height);

    // -- The reader of the short road who had gone on to Receive and asked the faucet before they left: the
    //    coins came anyway. On a later day the step opens with its first part ticked, at "Open Send". --
    await openWith(shortRoad(at - 25 * HOURS), `/do/pass-it-on?from=${PAYMENT_PAGE}`, 'step-action');
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.deepEqual([await page.text('step-action'), await hrefOf(page, 'step-action')], [en.actSend, '/wallet/send']);
    assert.deepEqual((await noteOf(page))?.steps, { 'pass-it-on': { ...byCard, parts: { 1: true } } });

    // -- And the one who closed the tab on Create, before any wallet was made: the card opens the step as it
    //    first did, with Create and the line for a wallet the reader has elsewhere. --
    await page.goto('/robots.txt');
    await page.store(RECORD_KEY, null);
    await openWith(shortRoad(at - 25 * HOURS), `/do/pass-it-on?from=${PAYMENT_PAGE}`, 'step-need-link');
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-wallet');
    assert.deepEqual([await page.text('step-need-link'), await hrefOf(page, 'step-need-link')], [en.actCreate, '/new']);
    assert.equal(await countOf(page, 'step-need-also'), 1);
    assert.deepEqual((await noteOf(page))?.steps, { 'pass-it-on': byCard });

    assert.deepEqual(stepsCounted(s), { 'hold-some': 1 });
    await ends(s, reader, counted, { records: [record], words: [words], addresses: [record.firstAddress], txids: [funding] });
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
    await openWith(noteFor({ following: null, steps: { 'hold-some': done(3, 9), 'pass-it-on': done(3, 3), 'waiting-room': done(3, 1), 'no-balances': { started: true } } }), '/do/waiting-room', 'step-done');
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
    //    they left. (The note is one the earlier version wrote, whose needs led to "Hold some". This version
    //    reads it as it stands.) --
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
    // Without a wallet: "Hold some", which a need of "Pass it on" sent the reader to under the earlier version, on Home.
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
  'Where a part was just done on a wallet screen, the result leads back to the step: the faucet\'s result once the coins are here, with a record of the payment and without one, with its button on screen at 375 by 667 px for a wallet made without a passkey and for one with, and "Payment sent" once the step\'s payment is out; when the block comes while the reader waits on Receive, "Hold some" is done there, and the strip and the faucet\'s result both say so, for each of those readers; a reader who follows no step sees neither button and no such line, the page does not move for them when coins arrive, and "See this transaction" is the main button as before',
  { localOnly: true, timeout: 300_000 },
  async (s) => {
    const PHONE = { width: 375, height: 667, timeout: 30_000 };

    /**
     * The first pieces of the faucet's result, in the order they stand in its box: a sentence ("p"), the line
     * that says the followed step is done ("done"), the way back to the step ("step"), the transaction's row ("dl").
     */
    const resultOrder = (page: OpenedPage, most: number): Promise<string[]> =>
      page.page.$eval(
        hook('faucet-state'),
        (state, count) => {
          const box = state.firstElementChild;
          const kinds = [...(box?.children ?? [])].map((child) => {
            if (child.querySelector('[data-testid="faucet-step"]') !== null) return 'step';
            return child.getAttribute('data-testid') === 'faucet-step-done' ? 'done' : child.tagName.toLowerCase();
          });
          return kinds.slice(0, count);
        },
        most,
      );
    /**
     * The block has come to a reader who waits on Receive with "Hold some" followed: the step is done there.
     * The strip says so, and the faucet's result says so in one line straight above the way back to the step.
     */
    const doneOnReceive = async (page: OpenedPage, pieces: string[]): Promise<void> => {
      await untilPhase(page, 'confirmed');
      await page.waitFor('faucet-step-done');
      assert.equal(await page.text('faucet-step-done'), saidDone('hold-some'));
      assert.equal(await page.text('faucet-step'), backTo('hold-some'));
      assert.deepEqual(await resultOrder(page, pieces.length), pieces);
      const strip = await untilStrip(page, 'hold-some', 'done');
      assert.equal(strip.words, fill(en.stripDone, { step: titleOf('hold-some') }));
      const held = (await noteOf(page))?.steps['hold-some'];
      assert.ok(held?.doneAt !== undefined);
      assert.deepEqual(held, { started: true, doneAt: held.doneAt, parts: { 1: true, 2: true, 3: true } });
    };

    /**
     * From the step's screen with no wallet in the browser: makes one through Create, goes back to the step by
     * "I have written them down", and from there to the faucet's card on Receive. Gives the wallet that was made.
     */
    const toFaucet = async (page: OpenedPage, button: 'create-passkey' | 'create-words') => {
      await untilParts(page, ['now', 'later', 'later']);
      await act(page, '/new');
      const made = await createFrom(page, button);
      await page.click('words-written-step');
      await arrivesAt(page, '/do/hold-some');
      await untilParts(page, ['ticked', 'now', 'later']);
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
    // The step is not done, and no line says that it is.
    assert.deepEqual(await resultOrder(plain.page, 3), ['p', 'step', 'dl']);
    assert.equal(await countOf(plain.page, 'faucet-step-done'), 0);
    assert.equal(await plain.page.sidewaysScroll(), 0);
    const firstTxid = ((await attributeOf(plain.page, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    // While the reader waits here for the coin's block, the strip says what the step waits for.
    assert.equal((await untilStrip(plain.page, 'hold-some', 'waiting')).words, en.stripWaitingBlock);
    // Its confirmation does not move the page again, and the button stays.
    const stood = await plain.page.page.evaluate(() => window.scrollY);
    await s.network.nextBlock();
    await untilPhase(plain.page, 'confirmed');
    await plain.page.settle();
    assert.equal(await plain.page.page.evaluate(() => window.scrollY), stood, 'the page stays where it is when the coins confirm');
    // The coin has its block, and that is the last part of "Hold some": the step is done here, on Receive.
    // The strip says so above all this, and the result says so in one line straight above its button, over
    // the sentence that the coins are confirmed. Both are on screen where the page stands.
    await doneOnReceive(plain.page, ['p', 'done', 'step', 'dl']);
    assert.ok((await plain.page.text('faucet-state')).startsWith(fill(receive.stateConfirmed, { amount: '100,000 practice sats' })));
    assert.deepEqual([await shareOnScreen(plain.page, 'faucet-step-done'), await shareOnScreen(plain.page, 'faucet-step')], [1, 1]);
    assert.equal(await plain.page.page.evaluate(() => window.scrollY), stood);
    assert.equal(await plain.page.sidewaysScroll(), 0);
    // The press: a page load after the bot check, and the step's own screen, with its done card.
    await loads(plain.page, () => plain.page.click('faucet-step'));
    await arrivesAt(plain.page, '/do/hold-some');
    await plain.page.waitFor('step-done');
    assert.deepEqual(await partsOf(plain.page), ['ticked', 'ticked', 'ticked']);

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
    // For this reader the coins and their block came in one moment: two parts of "Hold some" ticked at once,
    // and the step is done. The line that says so is on screen with the button the page moved to.
    await doneOnReceive(late.page, ['p', 'done', 'step', 'dl']);
    await untilOnScreen(late.page, 'faucet-step-done');
    // The same block took in the coins of the two readers who were left waiting on Receive further up: the one
    // with a passkey wallet, which the faucet locked, and the one whose coins came with no record of a
    // payment. For each the step is done where they wait, and the result says so.
    await doneOnReceive(keyed.page, ['p', 'done', 'step', 'dl']);
    await doneOnReceive(stray.page, ['p', 'done', 'step']);
    assert.ok((await stray.page.text('faucet-state')).startsWith(receive.stateConfirmedNoRecord), await stray.page.text('faucet-state'));

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
    assert.deepEqual([await countOf(nobody.page, 'faucet-step'), await countOf(nobody.page, 'faucet-step-done')], [0, 0]);
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
    // Confirmed coins finish "Hold some" for this reader too: the line stands between the result's one
    // sentence and the button.
    await doneOnReceive(twice.page, ['p', 'done', 'step']);
    assert.equal(await twice.page.sidewaysScroll(), 0);
    // The press leads to the step, which is done.
    await loads(twice.page, () => twice.page.click('faucet-step'));
    await arrivesAt(twice.page, '/do/hold-some');
    await twice.page.waitFor('step-done');
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

    // What was counted: each reader's own screens and events, "Hold some" once for each of the five readers
    // whose coins got their block while they followed it, and "Pass it on" once.
    await plain.page.settle();
    assert.deepEqual(stepsCounted(s), { 'hold-some': 5, 'pass-it-on': 1 });
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
    // Each of them finished "Hold some" on Receive, and it is counted under that screen.
    const heldThere = doIt('/wallet/receive', 'hold-some');
    assert.deepEqual(sentBy(plain.requests()), [...countedTo('words'), heldThere, view('/do/hold-some')]);
    assert.deepEqual(sentBy(keyed.requests()), [...countedTo('passkey'), heldThere]);
    // The request that failed is counted as failed, and the coins that came from elsewhere are no count of the faucet's.
    assert.deepEqual(sentBy(stray.requests()), [...countedTo('words').slice(0, -1), { name: 'Faucet', path: '/wallet/receive', value: 'failed' }, heldThere]);
    assert.deepEqual(sentBy(late.requests()), [...countedTo('words'), heldThere]);
    assert.deepEqual(sentBy(twice.requests()), [
      ...countedTo('words'),
      view('/wallet/receive'),
      { name: 'Faucet', path: '/wallet/receive', value: 'already-paid' },
      heldThere,
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
  'On "Wallet made", "I have written them down" leads back to the step that is followed, by the button under the 12 words that names that step, in Spanish too; and by the screen\'s own button to the Overview when no step is followed: with no note at all, and for a step that was last followed more than a day ago',
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
    /**
     * On the "Wallet made" step: the button that says the words are written down, for a reader who follows
     * `followed` or follows no step (null). A followed step has a button of its own under the 12 words, which
     * names it and is the main one; the screen's own button stands at the end as before, and is the main one
     * only for a reader who follows no step. Presses the one such a reader would.
     */
    const written = async (followed: StepId | null, lang: Lang = 'en'): Promise<void> => {
      const t = strings.backup[lang];
      assert.equal(await page.text('words-written'), t.written);
      if (followed === null) {
        assert.equal(await countOf(page, 'words-written-step'), 0, 'no step is followed: nothing new under the words');
        assert.equal(await isMain(page, 'words-written'), true);
        await page.click('words-written');
        return;
      }
      assert.equal(await page.text('words-written-step'), fill(t.writtenStep, { step: titleOf(followed, lang) }));
      assert.deepEqual([await isMain(page, 'words-written-step'), await isMain(page, 'words-written')], [true, false]);
      await page.click('words-written-step');
    };
    /** From Create: makes a wallet, and presses "I have written them down" on the "Wallet made" step. */
    const makeAndWrite = async (followed: StepId | null, prefix = '') => {
      const made = await createFrom(page, 'create-words', prefix);
      counted.push({ name: 'Wallet created', path: `${prefix}/new`, value: 'words' }, view(`${prefix}/wallet/backup`), { name: 'Words shown', path: `${prefix}/wallet/backup`, value: 'words' });
      await written(followed, prefix === '' ? 'en' : 'es');
      return made;
    };

    // -- "Hold some" is followed: it sent the reader to make a wallet. The button under the words names it,
    //    and leads straight back to it. --
    await untilParts(page, ['now', 'later', 'later']);
    const documents = documentsOf(page);
    await act(page, '/new');
    counted.push(view('/new'));
    const first = await makeAndWrite('hold-some');
    await arrivesAt(page, '/do/hold-some');
    counted.push(view('/do/hold-some'));
    await untilParts(page, ['ticked', 'now', 'later']);
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
    await untilParts(page, ['now', 'later', 'later']);
    await act(page, '/es/new');
    counted.push(view('/es/new'));
    const second = await makeAndWrite('hold-some', '/es');
    await arrivesAt(page, '/es/do/hold-some');
    counted.push(view('/es/do/hold-some'));
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal(await page.text('step-title'), titleOf('hold-some', 'es'));

    // -- No step is followed: the screen's own button, and the wallet's Overview, as it always was. --
    await empty();
    await page.goto('/new');
    await page.waitFor('create-words');
    counted.push(view('/new'));
    const third = await makeAndWrite(null);
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
    const fourth = await makeAndWrite(null);
    await arrivesAt(page, '/wallet');
    counted.push(view('/wallet'));
    await page.settle();
    assert.equal(await stripOf(page), null);
    assert.deepEqual((await noteOf(page))?.steps, { 'no-balances': { started: true, from: PAYMENT_PAGE } });

    // -- "Hold some", last followed as long ago: no strip on Create either. But making the wallet is its first
    //    part, and a part of the followed step ticked is that step followed again: the strip is back on
    //    "Wallet made", the button under the words is there with it, and leads to the step both name. --
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
    await written('hold-some');
    await arrivesAt(page, '/do/hold-some');
    counted.push(view('/do/hold-some'));
    await untilParts(page, ['ticked', 'now', 'later']);
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
  'A need\'s link to another step tells the steps however the reader uses it: from the keyboard, with the middle button, and from the browser\'s own menu, on the need\'s button and on the drill\'s link to "The seed" alike; the tab that the middle button opens leads back to the step the reader came for and to their chapter; a reader from the list is remembered nothing by any of them; and a step that came from a chapter has no link to "Hold some" to use',
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

    // -- 3. The button of a need. A reader with no wallet opens "Pass it on" from the wallet's own list. Its
    //       need names "Hold some", as it does for every step from the list, and that reader is remembered
    //       nothing, whichever way they use the link. --
    const carded = await begin(s, '/do/pass-it-on');
    const first = carded.page;
    const cardCounted: EventBody[] = [view('/do/pass-it-on')];
    await first.waitFor('step-need-link');
    assert.equal(await hrefOf(first, 'step-need-link'), '/do/hold-some');
    const fromList = await noteText(first);
    for (const how of USES) {
      await use(first, 'step-need-link', how);
      await first.settle(200);
      assert.equal(await noteText(first), fromList, `${how}: nothing is written for a reader from the list`);
      assert.equal(await addressOf(first), '/do/pass-it-on');
    }
    // The reader who pressed the card of "Pass it on" in the payment chapter has no link to "Hold some" to
    // use: the need's button leads to Create, which is a screen and no step. Used in any of the three ways
    // it writes nothing, and nothing of "Hold some" comes into the note.
    const byCard = { started: true as const, from: PAYMENT_PAGE };
    for (const how of USES) {
      const { before, after } = await fresh(first, `/do/pass-it-on?from=${PAYMENT_PAGE}`, 'step-need-link', how);
      cardCounted.push(view('/do/pass-it-on'));
      assert.equal(await hrefOf(first, 'step-need-link'), '/new', how);
      assert.equal(await first.page.$$eval('main a[href$="/do/hold-some"]', (links) => links.length), 0, how);
      assert.deepEqual(before?.steps, { 'pass-it-on': byCard }, how);
      assert.deepEqual(after, before, how);
    }

    // -- 4. The need's button that does lead to another step, for a reader who came from a chapter. The first
    //       reader's wallet holds coins and has sent nothing, and they press the card of "There are no
    //       balances" in the payment chapter: its need leads to "Pass it on". Each way of using the link
    //       writes the step they came for into the note of "Pass it on", and nothing else. --
    const CARD = `${site}${PAYMENT_PAGE}#do-no-balances`;
    const pressed = { started: true as const, from: PAYMENT_PAGE };
    for (const how of USES) {
      const { before, after } = await fresh(page, `/do/no-balances?from=${PAYMENT_PAGE}`, 'step-need-link', how);
      counted.push(view('/do/no-balances'));
      assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'nothing-sent', how);
      assert.deepEqual(before?.steps, { 'no-balances': pressed }, how);
      assert.deepEqual(after, { ...before, steps: { 'pass-it-on': { cameFor: 'no-balances' }, 'no-balances': pressed } }, how);
    }

    // -- 5. The tab that the middle button opens: another tab of the same browser, at the link's address. It
    //       finds the step the reader came for in the note. "Pass it on" there leads back to the card they
    //       pressed, on its own screen and on the strip. --
    assert.equal(await hrefOf(page, 'step-need-link'), '/do/pass-it-on');
    const tab = await standBy(s, { context: page.context, timeout: 30_000 });
    const opened: Reader = { page: tab, requests: watchEventRequests(tab) };
    await tab.goto('/do/pass-it-on');
    // The wallet holds a coin that can be spent, so the first part of "Pass it on" ticks as it opens.
    await untilParts(tab, ['ticked', 'now', 'later']);
    assert.equal(await tab.text('step-chapter'), chapterLine('payment'));
    assert.equal(await hrefOf(tab, 'step-back'), CARD);
    note = await noteOf(tab);
    assert.deepEqual([note?.following, note?.steps], ['pass-it-on', { 'pass-it-on': { started: true, cameFor: 'no-balances', parts: { 1: true } }, 'no-balances': pressed }]);
    await act(tab, '/wallet/send');
    await untilStrip(tab, 'pass-it-on', 'part');
    assert.deepEqual([await hrefOf(tab, 'strip-back'), await hrefOf(tab, 'strip-chapter')], ['/do/pass-it-on', CARD]);

    assert.deepEqual(stepsCounted(s), {});
    const secrets = { records: [record], words: [words], addresses: [record.firstAddress], txids: [funding] };
    await endsTwo(
      s,
      [
        { reader, expected: counted },
        { reader: carded, expected: cardCounted },
        { reader: opened, expected: [view('/do/pass-it-on'), view('/wallet/send')] },
      ],
      secrets,
    );
    // The second browser's storage as well: the note of the reader with no wallet, and nothing else.
    await storedIsPublic(first, secrets);
  },
);

/**
 * Whether these pieces stand on the page in this order: true, or a sentence that says what is wrong. Each is a
 * test hook, "last:<hook>" for the last element with that hook, or "h2:<words>" for a section's heading with
 * exactly these words.
 */
const standInOrder = (page: OpenedPage, pieces: readonly string[]): Promise<true | string> =>
  page.page.evaluate((names) => {
    const find = (name: string): Element | null => {
      if (name.startsWith('h2:')) return [...document.querySelectorAll('main h2')].find((heading) => (heading.textContent ?? '').trim() === name.slice(3)) ?? null;
      if (name.startsWith('last:')) return [...document.querySelectorAll(`[data-testid="${name.slice(5)}"]`)].at(-1) ?? null;
      return document.querySelector(`[data-testid="${name}"]`);
    };
    const found = names.map(find);
    const missing = names.filter((_, at) => found[at] === null);
    if (missing.length > 0) return `not on the page: ${missing.join(', ')}`;
    for (let at = 1; at < found.length; at += 1) {
      if ((found[at - 1]!.compareDocumentPosition(found[at]!) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) return `${names[at - 1]} does not stand before ${names[at]}`;
    }
    return true;
  }, pieces);

/** The second click of a double tap, as a browser tells a page of it: a click that says it is the second. */
const secondClickOn = (page: OpenedPage, id: string): Promise<void> =>
  page.page.$eval(hook(id), (button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }));
  });

scenario(
  'From the cards of the keys chapter with no wallet: "The seed" is done with no faucet, no block and no second tab, its first part ticked by the words "Wallet made" shows; "Prove the backup" goes by Create, the faucet, the three words, the removal, Home\'s restore and the Overview; one of them in Spanish, one with a passkey wallet',
  { localOnly: true, timeout: 300_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    /** The note at this stop: which step is followed, and what it holds of each step. */
    const noteNow = async (of: OpenedPage): Promise<[Progress['following'] | undefined, Progress['steps'] | undefined]> => {
      const stored = await noteOf(of);
      return [stored?.following, stored?.steps];
    };
    const startHeight = await s.network.height();

    // == "The seed", pressed on the Spanish page of the keys chapter. The wallet is made without a passkey. ==
    const SEED_CARD = `${site}${KEYS_PAGE_ES}#do-the-seed`;
    const bySeedCard = { started: true as const, from: KEYS_PAGE_ES };
    const seed = await begin(s, `/es/do/the-seed?from=${KEYS_PAGE_ES}`, { lang: 'es' });
    const page = seed.page;

    // -- 1. The step needs a wallet, and there is none: it names Create, and says where a wallet the reader
    //       already has comes back. --
    await untilParts(page, ['blocked', 'later', 'later']);
    assert.equal(await page.text('step-chapter'), chapterLine('keys', 'es'));
    assert.equal(await hrefOf(page, 'step-back'), SEED_CARD);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-wallet');
    assert.deepEqual([await page.text('step-need-link'), await hrefOf(page, 'step-need-link')], [es.actCreate, '/es/new']);
    assert.equal(await page.text('step-need-also'), `${es.needHadOne} ${es.needHadOneLink}`);
    assert.deepEqual(await noteNow(page), ['the-seed', { 'the-seed': bySeedCard }]);
    const documents = documentsOf(page);

    // -- 2. Create: the strip names the reader's step and what it needs first, with both ways back. --
    await page.click('step-need-link');
    await arrivesAt(page, '/es/new');
    assert.equal((await untilStrip(page, 'the-seed', 'need')).words, es['stripNeed_no-wallet']);
    assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], ['/es/do/the-seed', SEED_CARD]);
    assert.deepEqual(await noteNow(page), ['the-seed', { 'the-seed': bySeedCard }]);

    // -- 3. "Wallet made". The 12 words are on screen while the step is followed, and that is its first part:
    //       it ticks here. Under the words stand the sentence on real money and the button back to the step. --
    const made = await createFrom(page, 'create-words', '/es');
    await until(async () => (await noteOf(page))?.steps['the-seed']?.parts?.[1] === true, 'the words that "Wallet made" shows tick the first part of "The seed"');
    assert.deepEqual(await noteNow(page), ['the-seed', { 'the-seed': { ...bySeedCard, parts: { 1: true } } }]);
    assert.equal((await untilStrip(page, 'the-seed', 'part')).words, partName('the-seed', 2, 'es'));
    assert.deepEqual([await hrefOf(page, 'strip-back'), await hrefOf(page, 'strip-chapter')], ['/es/do/the-seed', SEED_CARD]);
    assert.equal(await page.text('words-written-step'), fill(strings.backup.es.writtenStep, { step: titleOf('the-seed', 'es') }));
    assert.equal(await page.text('words-written-step'), 'Ya las escribí: volver a "La semilla"');
    assert.equal(await page.text('never-real-money'), strings.backup.es.neverRealMoney);
    assert.equal(await countOf(page, 'never-real-money'), 1);
    assert.equal(await standInOrder(page, ['last:word', 'never-real-money', 'words-written-step', 'made-keeps', 'backup-exception', 'words-written']), true);

    // -- 4. Back to the step by that button: the box for what no page can check, and then three of the words. --
    await page.click('words-written-step');
    await arrivesAt(page, '/es/do/the-seed');
    await untilParts(page, ['ticked', 'now', 'later']);
    assert.equal(await hrefOf(page, 'step-back'), SEED_CARD);
    await page.click('step-said');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.deepEqual(await noteNow(page), ['the-seed', { 'the-seed': { ...bySeedCard, parts: { 1: true, 2: true } } }]);
    await typeThree(page, made.words);
    await page.click('step-words-check');

    // -- 5. Done, on the same screen: the link back to the keys chapter as the main button, and "All steps". --
    await page.waitFor('step-done');
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-back', words: es.back, href: `${site}${KEYS_PAGE_ES}#done=the-seed`, main: true },
      { hook: 'step-list', words: es.allSteps, href: '/es/do', main: false },
    ]);
    const seedNote = await noteOf(page);
    const seedDone = seedNote?.steps['the-seed']?.doneAt;
    assert.ok(seedDone !== undefined);
    assert.deepEqual(seedNote, {
      v: 1,
      following: null,
      steps: { 'the-seed': { started: true, doneAt: seedDone, from: KEYS_PAGE_ES, wallet: made.record.fingerprint, parts: { 1: true, 2: true, 3: true } } },
    });
    // No faucet, no block, no page load and no second tab: the whole road was moves inside the app, the
    // bot check never came into the page, and the practice chain stands where it stood.
    assert.equal(documentsOf(page), documents);
    assert.equal(await botCheckScripts(page), 0);
    assert.deepEqual(s.stack.botChecks, []);
    assert.equal(await s.network.height(), startHeight);
    assert.equal(await page.page.$$eval(`${hook('step-done')} a[target="_blank"]`, (links) => links.length), 0, 'no link of the done card opens a tab');
    assert.doesNotMatch((await noteText(page)) ?? '', /hold-some|cameFor/);

    // == "Prove the backup", pressed on the English page of the keys chapter. The wallet is made with a passkey. ==
    const DRILL_CARD = `${site}${KEYS_PAGE}#do-prove-the-backup`;
    const byDrillCard = { started: true as const, from: KEYS_PAGE };
    const drill = await begin(s, `/do/prove-the-backup?from=${KEYS_PAGE}`, { passkey: 'prf' });
    const tab = drill.page;
    const bothWaysBack = async (where: string): Promise<void> => {
      assert.equal((await stripOf(tab))?.step, 'prove-the-backup', where);
      assert.deepEqual([await hrefOf(tab, 'strip-back'), await hrefOf(tab, 'strip-chapter')], ['/do/prove-the-backup', DRILL_CARD], where);
    };

    // -- 1. No wallet: Create, and the line for a wallet the reader has elsewhere. --
    await untilParts(tab, ['blocked', 'later', 'later', 'later']);
    assert.equal(await hrefOf(tab, 'step-back'), DRILL_CARD);
    assert.equal(await attributeOf(tab, 'step-need', 'data-reason'), 'no-wallet');
    assert.deepEqual([await tab.text('step-need-link'), await hrefOf(tab, 'step-need-link')], [en.actCreate, '/new']);
    assert.equal(await countOf(tab, 'step-need-also'), 1);
    assert.deepEqual(await noteNow(tab), ['prove-the-backup', { 'prove-the-backup': byDrillCard }]);

    // -- 2 and 3. Create, and "Wallet made" with a passkey: the button under the words names the drill. --
    await tab.click('step-need-link');
    await arrivesAt(tab, '/new');
    assert.equal((await untilStrip(tab, 'prove-the-backup', 'need')).words, en['stripNeed_no-wallet']);
    await bothWaysBack('Create');
    const keyed = await createFrom(tab, 'create-passkey');
    assert.equal(keyed.record.kind, 'passkey');
    assert.equal((await untilStrip(tab, 'prove-the-backup', 'need')).words, en['stripNeed_no-coins']);
    await bothWaysBack('"Wallet made"');
    assert.equal(await tab.text('words-written-step'), 'I have written them down: back to "Prove the backup"');
    assert.equal(await standInOrder(tab, ['last:word', 'made-passkey-back', 'never-real-money', 'words-written-step', 'backup-exception', 'words-written']), true);
    assert.deepEqual(await noteNow(tab), ['prove-the-backup', { 'prove-the-backup': byDrillCard }]);

    // -- 4. Back to the step: it needs coins, and names the faucet. --
    await tab.click('words-written-step');
    await arrivesAt(tab, '/do/prove-the-backup');
    await untilParts(tab, ['blocked', 'later', 'later', 'later']);
    assert.equal(await attributeOf(tab, 'step-need', 'data-reason'), 'no-coins');
    assert.deepEqual([await tab.text('step-need-link'), await hrefOf(tab, 'step-need-link')], [en.actFaucet, '/wallet/receive#faucet']);
    assert.equal(await hrefOf(tab, 'step-back'), DRILL_CARD);

    // -- 5. The faucet. The coins arrive, and its result leads back to the step by name. Asking it locked
    //       the wallet: its keys left the page before the bot check came in. --
    await tab.click('step-need-link');
    await arrivesAt(tab, '/wallet/receive');
    await tab.waitFor('faucet-ask');
    const address = await tab.text('receive-address');
    await tab.click('faucet-ask');
    await untilPhase(tab, 'arrived');
    const faucetTxid = ((await attributeOf(tab, 'faucet-tx-link', 'href')) ?? '').slice(-64);
    assert.equal(await tab.text('faucet-step'), backTo('prove-the-backup'));
    assert.equal(await hrefOf(tab, 'faucet-step'), '/do/prove-the-backup');
    await untilOnScreen(tab, 'faucet-step');
    await bothWaysBack('Receive');
    assert.deepEqual(await noteNow(tab), ['prove-the-backup', { 'prove-the-backup': byDrillCard }]);

    // -- 6. Back to the step by that button, which is a page load. The drill's first part: three of the 12
    //       words, off the paper the reader wrote at "Wallet made". The passkey is asked first, because
    //       comparing words needs the wallet's keys. The line above still names "The seed", for a reader who
    //       has no paper copy. --
    await loads(tab, () => tab.click('faucet-step'));
    await arrivesAt(tab, '/do/prove-the-backup');
    await untilParts(tab, ['now', 'later', 'later', 'later']);
    await tab.waitFor('unlock-step');
    assert.equal(await countOf(tab, 'step-word'), 0, 'no field before the wallet is unlocked');
    assert.equal(await tab.text('step-paper-link'), fill(en.actStep, { step: titleOf('the-seed') }));
    await tab.page.bringToFront();
    await tab.click('unlock');
    await tab.waitFor('step-word');
    await typeThree(tab, keyed.words);
    await tab.click('step-words-check');
    await untilParts(tab, ['ticked', 'now', 'later', 'later']);
    assert.deepEqual(await noteNow(tab), [
      'prove-the-backup',
      { 'prove-the-backup': { ...byDrillCard, wallet: keyed.record.fingerprint, was: 'passkey', parts: { 1: true } } },
    ]);

    // -- 7. The warnings, Settings, and the removal. --
    assert.equal(await tab.text('step-action'), en.actSettings);
    await act(tab, '/wallet/settings');
    await bothWaysBack('Settings');
    await removeHere(tab);
    assert.deepEqual(await noteNow(tab), [
      'prove-the-backup',
      { 'prove-the-backup': { ...byDrillCard, wallet: keyed.record.fingerprint, was: 'passkey', parts: { 1: true, 2: true } } },
    ]);

    // -- 8. Home. The step goes on with a restore, and Home says so first: the restore as its main button,
    //       before the lines on the removal, and under it the sentence that names the step. --
    await tab.waitFor('home-step-restore');
    assert.equal(await tab.text('home-step'), `${strings.wallet.en.gateRestore} ${fill(en.homeRestore, { step: titleOf('prove-the-backup') })}`);
    assert.deepEqual([await hrefOf(tab, 'home-step-restore'), await isMain(tab, 'home-step-restore'), await isMain(tab, 'home-create')], ['/restore', true, false]);
    assert.equal(await standInOrder(tab, ['home-step-restore', 'home-removed', 'home-progress-stays', 'home-create', 'home-restore']), true);
    await bothWaysBack('Home');

    // -- 9. Restore, from the 12 words on the paper. The wallet and its coins come back, the last two parts
    //       tick, and the Overview opens with the strip saying that the step is done. --
    await tab.click('home-step-restore');
    await arrivesAt(tab, '/restore');
    await restoreHere(tab, keyed.words);
    await tab.waitFor('overview-restored');
    const strip = await untilStrip(tab, 'prove-the-backup', 'done');
    assert.equal(strip.words, fill(en.stripDone, { step: titleOf('prove-the-backup') }));
    assert.equal(await hrefOf(tab, 'strip-chapter'), `${site}${KEYS_PAGE}#done=prove-the-backup`);
    let drilled = await noteOf(tab);
    const drillDone = drilled?.steps['prove-the-backup']?.doneAt;
    assert.ok(drillDone !== undefined);
    assert.deepEqual([drilled?.following, drilled?.steps], [
      'prove-the-backup',
      { 'prove-the-backup': { started: true, doneAt: drillDone, from: KEYS_PAGE, was: 'passkey', parts: { 1: true, 2: true, 3: true, 4: true } } },
    ]);

    // -- 10. The done card: the link back to the keys chapter as the main button, the Sparrow link, "All steps". --
    await stripBack(tab, 'prove-the-backup');
    await tab.waitFor('step-done');
    assert.deepEqual(await waysOf(tab), [
      { hook: 'step-back', words: en.back, href: `${site}${KEYS_PAGE}#done=prove-the-backup`, main: true },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);
    assert.equal(await hrefOf(tab, 'step-sparrow'), '/sparrow');
    assert.equal(await countOf(tab, 'step-changed'), 1, 'this wallet was opened with a passkey before, and is kept with its words now');
    drilled = await noteOf(tab);
    assert.equal(drilled?.following, null);
    assert.doesNotMatch((await noteText(tab)) ?? '', /hold-some|the-seed|cameFor/);

    // What was counted: each reader's own screens and events, and each of the two steps once. Nothing of "Hold some".
    assert.deepEqual(stepsCounted(s), { 'the-seed': 1, 'prove-the-backup': 1 });
    const secrets = {
      records: [made.record, keyed.record],
      words: [made.words, keyed.words],
      addresses: [made.record.firstAddress, address],
      txids: [faucetTxid],
    };
    await endsTwo(
      s,
      [
        {
          reader: seed,
          expected: [
            view('/es/do/the-seed'),
            view('/es/new'),
            { name: 'Wallet created', path: '/es/new', value: 'words' },
            view('/es/wallet/backup'),
            { name: 'Words shown', path: '/es/wallet/backup', value: 'words' },
            view('/es/do/the-seed'),
            doIt('/es/do/the-seed', 'the-seed'),
          ],
        },
        {
          reader: drill,
          expected: [
            view('/do/prove-the-backup'),
            view('/new'),
            { name: 'Passkey', path: '/new', value: 'ok' },
            { name: 'Wallet created', path: '/new', value: 'passkey' },
            view('/wallet/backup'),
            { name: 'Words shown', path: '/wallet/backup', value: 'passkey' },
            view('/do/prove-the-backup'),
            view('/wallet/receive'),
            { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
            view('/do/prove-the-backup'),
            { name: 'Unlock', path: '/do/prove-the-backup', value: 'same' },
            view('/wallet/settings'),
            { name: 'Wallet removed', path: '/wallet/settings', value: 'passkey' },
            view('/'),
            view('/restore'),
            { name: 'Restore', path: '/restore', value: 'found' },
            doIt('/restore', 'prove-the-backup'),
            view('/wallet'),
            view('/do/prove-the-backup'),
          ],
        },
      ],
      secrets,
    );
    await storedIsPublic(tab, secrets);
  },
);

scenario(
  'The next move is where the reader is looking on the wallet\'s screens while a step is followed, and nothing is new for a reader who follows none: on "Wallet made" the sentence on real money and then a button back to the step stand under the 12 words; on Backup the way back stands beside "Hide them", under the same sentence; a payment\'s screen says that the followed step is done and leads back to it; Home puts the restore first in the middle of the drill, in the first window at 375 by 667 px and in shorter ones, in English and in Spanish, and so does the gate of a wallet screen, and another step that finds no wallet then leads to Home and not to Create; and when a step ends while its own screen is open, the done card\'s buttons come into the window',
  { localOnly: true, timeout: 300_000 },
  async (s) => {
    const PHONE = { width: 375, height: 667, timeout: 30_000 };
    const HOURS = 3_600_000;
    const counted: EventBody[] = [];
    const reader = await begin(s, `/do/the-seed?from=${KEYS_PAGE}`, PHONE);
    const { page } = reader;
    counted.push(view('/do/the-seed'));
    /** Puts a note, and with `record` a wallet's stored record, in this browser behind the app's back, and loads a screen. */
    const openWith = async (stored: string | null, path: string, wait: string, record?: string | null): Promise<void> => {
      await page.goto('/robots.txt');
      await page.store(PROGRESS_KEY, stored);
      if (record !== undefined) await page.store(RECORD_KEY, record);
      await page.goto(path);
      await page.waitFor(wait);
      counted.push(view(path));
    };
    /** How often the screen says this sentence. */
    const saysTimes = (sentence: string): Promise<number> =>
      page.page.$eval('main', (main, wanted) => (main.textContent ?? '').replace(/\s+/g, ' ').split(wanted).length - 1, sentence);
    const backup = strings.backup.en;

    // == "Wallet made", with "The seed" followed: the reader pressed its card with no wallet. ==
    await untilParts(page, ['blocked', 'later', 'later']);
    await page.click('step-need-link');
    await arrivesAt(page, '/new');
    counted.push(view('/new'));
    const made = await createFrom(page, 'create-words');
    counted.push({ name: 'Wallet created', path: '/new', value: 'words' }, view('/wallet/backup'), { name: 'Words shown', path: '/wallet/backup', value: 'words' });
    // The sentence on real money and then the button stand between the words and "What this browser now
    // keeps". The screen's own button is still at its end, after the sheet.
    await page.waitFor('words-written-step');
    assert.equal(
      await standInOrder(page, ['last:word', 'never-real-money', 'words-written-step', `h2:${backup.madeKeepsTitle}`, 'made-keeps', 'backup-exception', 'practice-card', 'words-written']),
      true,
    );
    // The sentence is on the screen once: as the caution under the words, and not in the paragraph further down.
    assert.equal(await countOf(page, 'never-real-money'), 1);
    assert.equal(await saysTimes(backup.neverRealMoney), 1);
    assert.equal(await page.page.$eval(hook('never-real-money'), (line) => line.closest('[data-testid="backup-exception"]') === null), true);
    // The button names the step, and is the main one. The screen's own is a second button.
    assert.equal(await page.text('words-written-step'), 'I have written them down: back to "The seed"');
    assert.deepEqual([await isMain(page, 'words-written-step'), await isMain(page, 'words-written')], [true, false]);
    assert.equal(await page.text('words-written'), backup.written);
    assert.equal(await page.sidewaysScroll(), 0);
    // The second click of a double tap does nothing: its first may have been the press that made the wallet.
    await secondClickOn(page, 'words-written-step');
    await sleep(300);
    assert.deepEqual([await addressOf(page), await countOf(page, 'word')], ['/wallet/backup', 12], 'the words are still on the screen');
    // A press of its own leads to the step.
    await page.click('words-written-step');
    await arrivesAt(page, '/do/the-seed');
    counted.push(view('/do/the-seed'));
    await untilParts(page, ['ticked', 'now', 'later']);

    // == Backup, with the words shown at any other time: the way back stands in the row of "Hide them". ==
    await page.goto('/wallet/backup');
    counted.push(view('/wallet/backup'));
    await page.click('reveal-words');
    await page.waitFor('backup-step');
    counted.push({ name: 'Words shown', path: '/wallet/backup', value: 'words' });
    assert.equal(await page.text('backup-step'), backTo('the-seed'));
    assert.deepEqual([await hrefOf(page, 'backup-step'), await isMain(page, 'backup-step'), await isMain(page, 'hide-words')], ['/do/the-seed', true, false]);
    // The button leaves the screen, so the sentence on real money stands between the words and its row: no
    // reader reaches the button before it, as at "Wallet made". It is on the screen once.
    assert.equal(await standInOrder(page, ['last:word', 'never-real-money', 'backup-step', 'hide-words']), true);
    assert.deepEqual([await countOf(page, 'never-real-money'), await saysTimes(backup.neverRealMoney)], [1, 1]);
    assert.equal(await page.text('never-real-money'), backup.neverRealMoney);
    assert.equal(
      await page.page.$eval(hook('backup-step'), (link) => link.parentElement !== null && link.parentElement.querySelector('[data-testid="hide-words"]') !== null),
      true,
      'in the row of "Hide them"',
    );
    // And the button is still where the reader is looking: the whole of it in the window, with the sentence above it.
    await untilOnScreen(page, 'backup-step');
    assert.equal(await shareOnScreen(page, 'never-real-money'), 1, 'the sentence is in the window too');
    assert.equal(await countOf(page, 'words-written-step'), 0);
    assert.equal(await page.sidewaysScroll(), 0);
    await page.click('backup-step');
    await arrivesAt(page, '/do/the-seed');
    counted.push(view('/do/the-seed'));
    await untilParts(page, ['ticked', 'now', 'later']);

    // == A payment's screen. The wallet gets coins and sends a payment. Then "There are no balances" is
    //    followed, two parts in: reading that payment is its last part, and finishes it on the payment's
    //    screen. The screen says so under "What just happened", and leads back to the step by its name. ==
    const funding = s.standIn.fund(made.record.firstAddress, 100_000);
    await page.goto('/wallet/send');
    counted.push(view('/wallet/send'));
    const paid = await pay(page, SOMEONE_ELSE, '30,000');
    counted.push({ name: 'Payment', path: '/wallet/send', value: 'sent' });
    assert.equal(await countOf(page, 'sent-step'), 0, '"The seed" takes no payment');
    const twoIn = noteFor({ following: 'no-balances', followedAt: Date.now(), steps: { 'no-balances': { started: true, from: PAYMENT_PAGE, parts: { 1: true, 2: true } } } });
    await openWith(twoIn, '/do/no-balances', 'step-action');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(await hrefOf(page, 'step-action'), `/wallet/tx/${paid.txid}`);
    await act(page, `/wallet/tx/${paid.txid}`);
    counted.push(view('/wallet/tx'));
    await page.waitFor('tx-step-done');
    counted.push(doIt('/wallet/tx', 'no-balances'));
    assert.equal(await page.text('tx-step-done'), `${saidDone('no-balances')} ${backTo('no-balances')}`);
    assert.equal(saidDone('no-balances'), 'Step done: There are no balances.');
    assert.deepEqual([await page.text('tx-step'), await hrefOf(page, 'tx-step'), await isMain(page, 'tx-step')], [backTo('no-balances'), '/do/no-balances', true]);
    assert.equal(await standInOrder(page, ['tx-explained', 'tx-step-done', 'tx-step', `h2:${strings.wallet.en.txPartsTitle}`]), true);
    assert.equal(await page.page.$eval(`${hook('tx-step-done')} p`, (line) => Number(getComputedStyle(line).fontWeight) >= 600), true);
    assert.equal(await page.sidewaysScroll(), 0);
    await untilStrip(page, 'no-balances', 'done');
    // It leads to the done card.
    await page.click('tx-step');
    await arrivesAt(page, '/do/no-balances');
    counted.push(view('/do/no-balances'));
    await page.waitFor('step-done');
    assert.equal(await page.text('step-done-text'), en['done_no-balances']);

    // == Home, in the middle of the drill. The wallet's words were checked, and the wallet is removed for
    //    the step on Settings. Home opens at its top, and the restore is its first move. ==
    const recordText = await page.stored();
    assert.ok(recordText !== null);
    const drillAt = (parts: Record<number, true>, followedAt: number): string =>
      noteFor({
        following: 'prove-the-backup',
        followedAt,
        steps: { 'prove-the-backup': { started: true, from: KEYS_PAGE, wallet: made.record.fingerprint, was: 'words', parts } },
      });
    /** Home as it stands for a reader in the middle of the drill, in a language. `removal` is true on the visit that follows the removal. */
    const restoreFirst = async (lang: Lang, removal: boolean, where: string): Promise<void> => {
      const w = strings.wallet[lang];
      const prefix = lang === 'en' ? '' : '/es';
      await page.waitFor('home-step-restore');
      assert.equal(await page.page.evaluate(() => window.scrollY), 0, `${where}: the page stands at its top`);
      // The two sentences on what the practice wallet is are left out for this reader: the restore stands
      // straight under the heading.
      assert.equal(await mainSays(page, strings.home[lang].lede), false, `${where}: no lede`);
      // The main button, the whole of it inside the window, with Home's own words for a restore.
      assert.deepEqual(
        [await page.text('home-step-restore'), await hrefOf(page, 'home-step-restore'), await isMain(page, 'home-step-restore'), await shareOnScreen(page, 'home-step-restore')],
        [w.gateRestore, `${prefix}/restore`, true, 1],
        where,
      );
      // Under it, the sentence that names the step, which the button names as its description.
      const sentence = fill(strings.doit[lang].homeRestore, { step: titleOf('prove-the-backup', lang) });
      assert.equal(await page.text('home-step'), `${w.gateRestore} ${sentence}`, where);
      assert.equal(
        await page.page.$eval(hook('home-step-restore'), (button) => (document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ?? '').replace(/\s+/g, ' ').trim()),
        sentence,
        where,
      );
      // Before the lines on the removal, on the visit that shows them, and before Create, which is a second button here.
      assert.equal(await standInOrder(page, removal ? ['home-step-restore', 'home-removed', 'home-progress-stays', 'home-create', 'home-restore'] : ['home-step-restore', 'home-create', 'home-restore']), true, where);
      if (!removal) assert.equal(await countOf(page, 'home-removed'), 0, where);
      assert.deepEqual([await page.text('home-create'), await isMain(page, 'home-create')], [w.gateCreate, false], where);
      assert.equal(await page.sidewaysScroll(), 0, where);
    };
    /** The links of the screen that lead to this path, as they stand. */
    const linksTo = (path: string): Promise<number> => page.page.$$eval('main a', (links, to) => links.filter((link) => link.getAttribute('href') === to).length, path);
    /**
     * The gate that stands in for a wallet screen, as it stands for the same reader: the restore first, as the
     * main button, with Home's sentence under it; "Open with my passkey" as a second button; the restore not
     * drawn twice.
     */
    const gateFirst = async (lang: Lang, where: string): Promise<void> => {
      const w = strings.wallet[lang];
      const prefix = lang === 'en' ? '' : '/es';
      await page.waitFor('gate-step-restore');
      assert.equal(await page.page.$eval('main h1', (heading) => (heading.textContent ?? '').trim()), w.gateNoneTitle, where);
      assert.equal(await page.page.evaluate(() => window.scrollY), 0, `${where}: the page stands at its top`);
      assert.deepEqual(
        [await page.text('gate-step-restore'), await hrefOf(page, 'gate-step-restore'), await isMain(page, 'gate-step-restore'), await shareOnScreen(page, 'gate-step-restore')],
        [w.gateRestore, `${prefix}/restore`, true, 1],
        where,
      );
      const sentence = fill(strings.doit[lang].homeRestore, { step: titleOf('prove-the-backup', lang) });
      assert.equal(await page.text('gate-step'), `${w.gateRestore} ${sentence}`, where);
      assert.equal(
        await page.page.$eval(hook('gate-step-restore'), (button) => (document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ?? '').replace(/\s+/g, ' ').trim()),
        sentence,
        where,
      );
      // Under it the gate's other two ways in: the passkey button, which is no longer the main one, and Create.
      assert.equal(await standInOrder(page, ['gate-step-restore', 'open-passkey']), true, where);
      assert.deepEqual([await page.text('open-passkey'), await isMain(page, 'open-passkey')], [w.openButton, false], where);
      assert.deepEqual([await linksTo(`${prefix}/restore`), await linksTo(`${prefix}/new`)], [1, 1], `${where}: one restore, one Create`);
      assert.equal(await page.sidewaysScroll(), 0, where);
    };
    /** The same gate for every other reader: the passkey button first and main, then Restore and Create, and nothing of a step. */
    const gateAsItWas = async (where: string): Promise<void> => {
      await page.waitFor('open-passkey');
      assert.deepEqual([await countOf(page, 'gate-step'), await countOf(page, 'gate-step-restore')], [0, 0], where);
      await until(() => isMain(page, 'open-passkey'), `${where}: the passkey button is the main one`);
      assert.deepEqual([await linksTo('/restore'), await linksTo('/new')], [1, 1], where);
    };
    await openWith(drillAt({ 1: true }, Date.now()), '/wallet/settings', 'remove-wallet');
    await removeHere(page);
    counted.push({ name: 'Wallet removed', path: '/wallet/settings', value: 'words' }, view('/'));
    await restoreFirst('en', true, 'Home, straight after the removal');
    assert.deepEqual((await noteOf(page))?.steps['prove-the-backup']?.parts, { 1: true, 2: true });
    assert.equal((await untilStrip(page, 'prove-the-backup', 'part')).words, partName('prove-the-backup', 3));
    // The same after a reload of Home, when no line says that a wallet was removed.
    await page.page.reload({ waitUntil: 'load' });
    counted.push(view('/'));
    await restoreFirst('en', false, 'Home, loaded again');
    // The same reader at the address of a wallet screen meets the gate, and the gate puts the restore first too.
    // They get there by the browser's Back from Home, which leads to Settings, and by a bookmark or the address
    // bar, which lead to the Overview.
    await page.goto('/wallet/settings');
    counted.push(view('/wallet/settings'));
    await gateFirst('en', 'the gate, at the address of Settings');
    assert.equal((await untilStrip(page, 'prove-the-backup', 'part')).words, partName('prove-the-backup', 3));
    await page.goto('/wallet');
    counted.push(view('/wallet'));
    await gateFirst('en', 'the gate, at the Overview\'s address');
    // It leads to Restore.
    await page.click('gate-step-restore');
    await arrivesAt(page, '/restore');
    counted.push(view('/restore'));
    // In the same state the reader presses the card of another step. Its first part needs a wallet, and the
    // wallet that was removed for the drill is the one to bring back: the step leads to Home, where a wallet is
    // opened or restored, and not to making a new one, which would leave the drill with "another wallet".
    await page.goto(`/do/the-seed?from=${KEYS_PAGE}`);
    counted.push(view('/do/the-seed'));
    await untilParts(page, ['blocked', 'later', 'later']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-wallet');
    assert.deepEqual([await page.text('step-need-link'), await hrefOf(page, 'step-need-link'), await countOf(page, 'step-need-also')], [en.actHome, '/', 0]);
    // In Spanish, on the visit that follows the removal.
    await openWith(drillAt({ 1: true }, Date.now()), '/es/wallet/settings', 'remove-wallet', recordText);
    await removeHere(page, '/es');
    counted.push({ name: 'Wallet removed', path: '/es/wallet/settings', value: 'words' }, view('/es'));
    await restoreFirst('es', true, 'Home in Spanish, straight after the removal');
    await page.page.reload({ waitUntil: 'load' });
    counted.push(view('/es'));
    await restoreFirst('es', false, 'Home in Spanish, loaded again');
    // In shorter windows too, where the longer Spanish sentences under the heading had pushed the button under
    // the edge: 553 px tall (what a browser's bars leave of a 667 px phone), and a phone 320 px wide.
    for (const [width, height] of [[375, 553], [320, 568]] as const) {
      await page.page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.page.reload({ waitUntil: 'load' });
      counted.push(view('/es'));
      await restoreFirst('es', false, `Home in Spanish, in a window ${width} by ${height} px`);
    }
    await page.page.setViewport({ width: PHONE.width, height: PHONE.height, deviceScaleFactor: 1 });
    // The gate of a wallet screen puts the restore first for the same reader, in Spanish as in English (below).
    await page.goto('/es/wallet/settings');
    counted.push(view('/es/wallet/settings'));
    await gateFirst('es', 'the gate in Spanish, at the address of Settings');
    // With the step last followed two days ago there is no strip, and the note is all that says which
    // wallet has to come back: Home still puts the restore first.
    await openWith(drillAt({ 1: true, 2: true }, Date.now() - 48 * HOURS), '/wallet', 'gate-step-restore');
    await gateFirst('en', 'the gate, two days after the step was last followed');
    await page.settle();
    assert.equal(await stripOf(page), null);
    await openWith(drillAt({ 1: true, 2: true }, Date.now() - 48 * HOURS), '/', 'home-create');
    await restoreFirst('en', false, 'Home, two days after the step was last followed');
    await page.settle();
    assert.equal(await stripOf(page), null);
    // And it leads to Restore.
    await page.click('home-step-restore');
    await arrivesAt(page, '/restore');
    counted.push(view('/restore'));
    // After "Stop following" none of it: Create is the main button again.
    await openWith(drillAt({ 1: true, 2: true }, Date.now()), '/', 'home-step-restore');
    await untilStrip(page, 'prove-the-backup', 'part');
    await page.click('strip-stop');
    await page.waitForGone('home-step');
    // (The button's colour changes over a moment, as every button's does.)
    await until(() => isMain(page, 'home-create'), 'Create is the main button again');
    assert.deepEqual([await countOf(page, 'home-step-restore'), await stripOf(page)], [0, null]);
    assert.equal((await noteOf(page))?.following, null);
    // And the screen says what the practice wallet is again.
    assert.equal(await mainSays(page, strings.home.en.lede), true);
    // The same on the gate: after "Stop following" it is as it always was.
    await openWith(drillAt({ 1: true, 2: true }, Date.now()), '/wallet', 'gate-step-restore');
    await untilStrip(page, 'prove-the-backup', 'part');
    await page.click('strip-stop');
    await page.waitForGone('gate-step');
    await gateAsItWas('the gate, after "Stop following"');
    assert.equal((await noteOf(page))?.following, null);

    // == The same four screens for a reader who follows no step: none of the new pieces is on the page. ==
    const NEW = ['words-written-step', 'backup-step', 'tx-step-done', 'tx-step', 'home-step', 'home-step-restore', 'gate-step', 'gate-step-restore', 'faucet-step-done'];
    const nothingNew = async (where: string): Promise<void> => {
      for (const id of NEW) assert.equal(await countOf(page, id), 0, `${where}: ${id}`);
    };
    // The gate of a wallet screen, with no wallet and no note.
    await openWith(null, '/wallet', 'open-passkey');
    await nothingNew('the gate');
    await gateAsItWas('the gate, with no note');
    // Home, with no wallet and no note: it says what the practice wallet is, and Create is its main button.
    await openWith(null, '/', 'home-create');
    await nothingNew('Home');
    assert.equal(await isMain(page, 'home-create'), true);
    assert.equal(await mainSays(page, strings.home.en.lede), true);
    // "Wallet made": the sentence on real money is where it was, in the paragraph after "What this browser
    // now keeps", and "I have written them down" is the main button, at the end.
    await page.click('home-create');
    await arrivesAt(page, '/new');
    counted.push(view('/new'));
    const second = await createFrom(page, 'create-words');
    counted.push({ name: 'Wallet created', path: '/new', value: 'words' }, view('/wallet/backup'), { name: 'Words shown', path: '/wallet/backup', value: 'words' });
    await nothingNew('"Wallet made"');
    assert.equal(await standInOrder(page, ['last:word', `h2:${backup.madeKeepsTitle}`, 'backup-exception', 'never-real-money', 'practice-card', 'words-written']), true);
    assert.equal(await page.page.$eval(hook('never-real-money'), (line) => line.tagName === 'P' && line.closest('[data-testid="backup-exception"]') !== null), true);
    assert.deepEqual([await countOf(page, 'never-real-money'), await saysTimes(backup.neverRealMoney), await isMain(page, 'words-written')], [1, 1, true]);
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    counted.push(view('/wallet'));
    // Backup, with the words shown: "Hide them" alone.
    await section(page, '/wallet/backup');
    counted.push(view('/wallet/backup'));
    await page.click('reveal-words');
    await page.waitFor('hide-words');
    // (Not counted again: "Words shown" is sent once for a wallet in one page, and "Wallet made" showed them.)
    await nothingNew('Backup, with the words shown');
    // The sentence on real money is where it was: under "Hide them" and the two sentences that follow it, once.
    assert.equal(await standInOrder(page, ['last:word', 'hide-words', 'never-real-money']), true);
    assert.deepEqual([await countOf(page, 'never-real-money'), await saysTimes(backup.neverRealMoney)], [1, 1]);
    // A payment's screen: no line.
    const gift = s.standIn.fund(second.record.firstAddress, 50_000);
    await page.goto(`/wallet/tx/${gift}`);
    counted.push(view('/wallet/tx'));
    await page.waitFor('tx-explained');
    await nothingNew('a payment\'s screen');
    assert.equal(await noteText(page), null, 'nothing of the steps is stored');

    // == A step's own screen. When the step ends while the screen is open, the done card takes its place above
    //    the parts, and its buttons come into the window: the reader waited at the top of the screen, where
    //    at this size the card's buttons would stand at or under the window's edge. ==
    /** The buttons of the done card: all of each inside the window, the link back to the chapter as the main one. */
    const waysInWindow = async (where: string): Promise<void> => {
      await untilOnScreen(page, 'step-back');
      await untilOnScreen(page, 'step-list');
      assert.deepEqual([await shareOnScreen(page, 'step-ways'), await isMain(page, 'step-back')], [1, true], where);
      assert.equal(await page.page.$eval(hook('step-back'), (link) => link.closest('[data-testid="step-done"]') !== null), true, where);
      assert.equal(await page.sidewaysScroll(), 0, where);
    };
    // By a block. The wallet pays the pot, and "Pass it on" waits for that payment's block at the top of its screen.
    await page.goto('/wallet/send');
    counted.push(view('/wallet/send'));
    const passed = await pay(page, 'pot', '10,000');
    counted.push({ name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' });
    const waits = noteFor({
      following: 'pass-it-on',
      followedAt: Date.now(),
      steps: { 'pass-it-on': { started: true, from: PAYMENT_PAGE, tx: passed.txid, sentAt: Date.now(), parts: { 1: true, 2: true } } },
    });
    await openWith(waits, '/do/pass-it-on', 'step-waiting');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(await page.page.evaluate(() => window.scrollY), 0, 'the reader waits at the top of the screen');
    assert.equal(await shareOnScreen(page, 'step-back'), 1, 'where the link back to the chapter is in the window');
    page.forgetStatus();
    await s.network.nextBlock();
    await page.waitFor('step-done');
    counted.push(doIt('/do/pass-it-on', 'pass-it-on'));
    assert.equal(await page.waitForStatus(saidDone('pass-it-on')), saidDone('pass-it-on'));
    await waysInWindow('"Pass it on", done by a block');
    assert.equal(await hrefOf(page, 'step-back'), `${s.stack.config.siteUrl}${PAYMENT_PAGE}#done=pass-it-on`);
    // By the reader's own answer, in Spanish: the three words finish "The seed". Focus goes to the heading, and
    // the buttons are in the window all the same.
    const twoParts = noteFor({ following: 'the-seed', followedAt: Date.now(), steps: { 'the-seed': { started: true, from: KEYS_PAGE_ES, parts: { 1: true, 2: true } } } });
    await openWith(twoParts, '/es/do/the-seed', 'step-word');
    await untilParts(page, ['ticked', 'ticked', 'now']);
    await typeThree(page, second.words);
    await page.click('step-words-check');
    await page.waitFor('step-done');
    counted.push(doIt('/es/do/the-seed', 'the-seed'));
    await waysInWindow('"The seed" in Spanish, done by the three words');
    assert.equal(await page.page.evaluate(() => document.activeElement?.tagName), 'H1', 'focus is on the heading');
    // A step that was done before its screen opened moves nothing: the page stands where the router put it.
    await page.page.reload({ waitUntil: 'load' });
    counted.push(view('/es/do/the-seed'));
    await page.waitFor('step-done');
    await page.settle();
    assert.equal(await page.page.evaluate(() => window.scrollY), 0, 'a done step, loaded: the page stands at its top');

    assert.deepEqual(stepsCounted(s), { 'no-balances': 1, 'pass-it-on': 1, 'the-seed': 1 });
    await ends(s, reader, counted, {
      records: [made.record, second.record],
      words: [made.words, second.words],
      addresses: [made.record.firstAddress, second.record.firstAddress, paid.to, passed.to],
      txids: [funding, paid.txid, gift, passed.txid],
    });
  },
);

scenario(
  'After the short road "Hold some" is not started, and its first opening goes by the wallet as it stands: with a confirmed coin it is done by that opening and counted then, and with only change in the wallet its card names no block; with only change that waits it waits for the block and is done when it comes; with every coin sent on it asks for coins',
  { localOnly: true, timeout: 300_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const at = Date.now();
    const record = testRecord();
    const counted: EventBody[] = [];
    /**
     * What the short road leaves: the step the reader came for, done by its card, and nothing of "Hold some".
     * (Here the drill: its reader ends with a wallet and the faucet's coin.)
     */
    const shortRoad = noteFor({
      following: null,
      steps: { 'prove-the-backup': { started: true, doneAt: at - 3_600_000, from: KEYS_PAGE, was: 'words', parts: { 1: true, 2: true, 3: true, 4: true } } },
    });
    const drillDone = (JSON.parse(shortRoad) as Progress).steps['prove-the-backup'];
    const funding = s.standIn.fund(record.firstAddress, 50_000);
    const height = await s.network.height();
    const reader = await begin(s, '/do', { record, storage: { [PROGRESS_KEY]: shortRoad } });
    const { page } = reader;
    counted.push(view('/do'));
    /** Puts the short road's note back behind the app's back, and loads the list of steps: "Hold some" is not started. */
    const shortRoadAgain = async (): Promise<void> => {
      await page.goto('/robots.txt');
      await page.store(PROGRESS_KEY, shortRoad);
      await page.goto('/do');
      counted.push(view('/do'));
      await notStarted();
    };
    const notStarted = async (): Promise<void> => {
      await page.waitFor('do-list');
      assert.deepEqual([await listState(page, 'hold-some'), await listState(page, 'prove-the-backup')], ['not-started', 'done']);
      assert.equal(await page.page.$eval(`li[data-step="hold-some"] ${hook('do-state')}`, (state) => (state.textContent ?? '').trim()), en.stateNotStarted);
    };
    /** The note of "Hold some" once it is done: three ticks and the moment, and with `from` the page of its card. */
    const doneNote = async (from?: string): Promise<void> => {
      const note = await noteOf(page);
      const held = note?.steps['hold-some'];
      assert.ok(held?.doneAt !== undefined);
      assert.deepEqual(note?.steps, {
        'hold-some': { started: true, doneAt: held.doneAt, ...(from === undefined ? {} : { from }), parts: { 1: true, 2: true, 3: true } },
        'prove-the-backup': drillDone,
      });
    };

    // -- The wallet holds the faucet's coin, in a block. The list says "Not started". The reader presses the
    //    card of "Hold some" in the bitcoin chapter: the step is done by that opening, with nothing else to
    //    do, and counted then. Its link back marks the card: two presses from it. The card names the block. --
    await notStarted();
    await page.goto(`/do/hold-some?from=${BITCOIN_PAGE}`);
    counted.push(view('/do/hold-some'));
    await page.waitFor('step-done');
    counted.push(doIt('/do/hold-some', 'hold-some'));
    assert.deepEqual(await partsOf(page), ['ticked', 'ticked', 'ticked']);
    assert.deepEqual(await waysOf(page), [
      { hook: 'step-back', words: en.back, href: `${site}${BITCOIN_PAGE}#done=hold-some`, main: true },
      { hook: 'step-list', words: en.allSteps, href: '/do', main: false },
    ]);
    await namesBlock(page, s, funding, height);
    await doneNote(BITCOIN_PAGE);
    assert.equal(await page.waitForStatus(saidDone('hold-some')), saidDone('hold-some'));
    assert.deepEqual(stepsCounted(s), { 'hold-some': 1 });

    // -- Only change that waits. The reader of the short road for "Pass it on" has paid the pot: the wallet's
    //    one coin is the change of that payment, and it is in no block yet. "Hold some", opened from the
    //    list, waits at its last part for the block, with no link to the explorer, and is done when it comes.
    //    Its card names no block: the coin is not one that was paid to the wallet. --
    await shortRoadAgain();
    await page.goto('/wallet/send');
    counted.push(view('/wallet/send'));
    const first = await pay(page, 'pot', '30,000');
    counted.push({ name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' });
    await section(page, '/wallet');
    counted.push(view('/wallet'));
    await page.click('overview-do-link');
    await arrivesAt(page, '/do');
    counted.push(view('/do'));
    await notStarted();
    await pickStep(page, 'hold-some');
    counted.push(view('/do/hold-some'));
    await untilParts(page, ['ticked', 'ticked', 'now']);
    assert.equal(await attributeOf(page, 'step-waiting', 'data-lost'), 'no');
    assert.equal(await countOf(page, 'step-waiting-explorer'), 0);
    assert.deepEqual((await noteOf(page))?.steps['hold-some'], { started: true, parts: { 1: true, 2: true } });
    page.forgetStatus();
    await s.network.nextBlock();
    await page.waitFor('step-done');
    counted.push(doIt('/do/hold-some', 'hold-some'));
    assert.equal(await page.waitForStatus(saidDone('hold-some')), saidDone('hold-some'));
    await page.settle();
    await namesNoBlock(page, s, 'done by the block of its change');
    await doneNote();
    assert.deepEqual(stepsCounted(s), { 'hold-some': 2 });

    // -- Only change, in a block. The same wallet on a later visit: "Hold some" is done by its first opening,
    //    and counted then, and its card still names no block. --
    await shortRoadAgain();
    await pickStep(page, 'hold-some');
    counted.push(view('/do/hold-some'));
    await page.waitFor('step-done');
    counted.push(doIt('/do/hold-some', 'hold-some'));
    await page.settle();
    await namesNoBlock(page, s, 'done by its first opening, with only change in the wallet');
    assert.equal(await page.text('step-done-text'), en['done_hold-some']);
    await doneNote();
    assert.deepEqual(stepsCounted(s), { 'hold-some': 3 });

    // -- Every coin sent on. The wallet holds nothing: "Hold some" has its wallet and has seen coins come,
    //    and stands at its last part, which needs coins and names the faucet. Nothing is counted. --
    await shortRoadAgain();
    await page.goto('/wallet/send');
    counted.push(view('/wallet/send'));
    const second = await pay(page, 'pot', 'all');
    counted.push({ name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' });
    await section(page, '/wallet');
    counted.push(view('/wallet'));
    await page.click('overview-do-link');
    await arrivesAt(page, '/do');
    counted.push(view('/do'));
    await notStarted();
    await pickStep(page, 'hold-some');
    counted.push(view('/do/hold-some'));
    await untilParts(page, ['ticked', 'ticked', 'blocked']);
    assert.equal(await attributeOf(page, 'step-need', 'data-reason'), 'no-coins');
    assert.ok((await page.text('step-need')).startsWith(en['need_no-coins']));
    assert.deepEqual([await page.text('step-need-link'), await hrefOf(page, 'step-need-link')], [en.actFaucet, '/wallet/receive#faucet']);
    assert.equal(await countOf(page, 'step-done'), 0);
    assert.deepEqual((await noteOf(page))?.steps['hold-some'], { started: true, parts: { 1: true, 2: true } });
    assert.deepEqual(stepsCounted(s), { 'hold-some': 3 });

    await ends(s, reader, counted, {
      records: [record],
      words: [(record.mnemonic ?? '').split(' ')],
      addresses: [record.firstAddress, first.to, second.to],
      txids: [funding, first.txid, second.txid],
    });
  },
);
