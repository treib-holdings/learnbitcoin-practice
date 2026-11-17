// The "Do it" steps, judged against the wallet's real engine.
//
// The runner's plain modules (app/src/lib/doit/) are handed a world and say
// where each step stands and what to write. Their own tests type that world
// into the test. Here the world is the one the engine really publishes:
//
//   session.ts and chain-sync.ts   wired by makeEngine, as wallet.svelte.ts wires them
//     -> the app's own client      makeApi (app/src/lib/api.ts)
//     -> the Worker's handler      makeHandler, as it is deployed
//     -> its way to the origin     makeOrigin, as it is deployed
//     -> the stand-in network      makeFakeOrigin, answering in this process
//
// with the note of the steps kept by progress.ts in the same storage as the
// wallet's record. One reader goes through the six steps in order, without a
// browser, and at each turn the test asks judge() where the step stands and
// lets advance() write what follows. (The screens, and the scenarios that
// click through them in Chrome, come on top of this.)
//
// What stands between the engine and the runner here is `follow()`, forty
// lines that do what the app's own glue has to do: build a world at every
// change, hand the last two to advance(), write each change through the one
// write function, and count a step that this write finished.
//
// The wiring of the stack and of a page is the one in engine.test.ts.

import assert from 'node:assert/strict';
import { API, STEPS, isEventBody, type EventBody, type StepId } from '@learnbitcoin/practice-contract';
import { type FetchLike, type PaymentRequest } from '@learnbitcoin/practice-wallet';
import {
  configFromEnv,
  makeHandler,
  makeOrigin,
  makePotStatsHolder,
  type ConfigVars,
  type Deps,
  type Handler,
  type Limiter,
  type Limits,
  type LogLine,
} from '@learnbitcoin/practice-worker';
import { makeApi } from '../../app/src/lib/api.ts';
import { advance, answered, counted, rechecked } from '../../app/src/lib/doit/advance.ts';
import { answerCoins, coinInBlock, judge, pickPositions, seedWallet, wordsPassed, type PartView, type Waited, type World } from '../../app/src/lib/doit/judge.ts';
import { PROGRESS_KEY, chapterLink, doneFollowed, fromOfSearch, readProgress, stripStep, writeProgress, type Change } from '../../app/src/lib/doit/progress.ts';
import { initEvents, track, trackPage } from '../../app/src/lib/events.ts';
import { RECORD_KEY } from '../../app/src/lib/keystore.ts';
import { parsePath, type Route } from '../../app/src/lib/router.ts';
import { makeEngine, passkeyPort } from '../../app/src/lib/session.ts';
import type { TokenSource } from '../../app/src/lib/wallet-api.ts';
import { FakeTimers, MemoryStorage, VirtualAuthenticator, flush, test } from '../../app/test/engine-fakes.ts';
import { makeFakeOrigin } from '../src/fake-origin.ts';

// -- the stack (as in engine.test.ts) ---------------------------------------------

const APP = 'https://practice.test';
const ORIGIN = 'https://origin.test';
const START_MS = 1_800_000_000_000;
const FAUCET_SATS = 50_000;
/** The token Cloudflare's test widget hands out. The bot check here passes it and fails every other. */
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const SITE = 'https://site.test';
/** An address of some other wallet (wallet/test/vectors.json, the passkey vector's first address). */
const SOMEONE = 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6';

const LOCAL_VARS: ConfigVars = {
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  EXPLORER_URL: 'https://explorer.test/',
  ELECTRUM_HOST: 'electrum.test',
  ELECTRUM_PORT: '60002',
  PLAUSIBLE_DOMAIN: 'practice.test',
  SITE_URL: SITE,
  SOURCE_URL: 'https://source.test/practice',
  PASSKEY_HOST: 'localhost',
  FAUCET_SATS: String(FAUCET_SATS),
  BLOCK_SECONDS: '10',
  // Switched on: the reader of this file looks at the pot's count under a done "Pass it on". (As shipped it is off.)
  POT_COUNTS: 'on',
};

/** A fetch that hands each request to the Worker's handler, dressed as one of the app's own pages dresses it. */
function pageFetch(handler: Handler): FetchLike {
  return async (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('User-Agent', 'doit-test browser');
    headers.set('Sec-Fetch-Site', 'same-origin');
    if ((init.method ?? 'GET').toUpperCase() !== 'GET') headers.set('Origin', APP);
    return handler(new Request(new URL(input, APP), { ...init, headers }));
  };
}

function stack() {
  const clock = { ms: START_MS };
  const network = makeFakeOrigin({ clock: () => clock.ms, faucetSats: FAUCET_SATS });
  const lines: LogLine[] = [];
  const pending: Promise<unknown>[] = [];
  const forwarded: EventBody[] = [];
  const limiter = (): Limiter => ({ limit: async () => ({ success: true }) });
  const limits: Limits = { chain: limiter(), broadcast: limiter(), faucet: limiter(), pot: limiter(), events: limiter() };

  const deps: Deps = {
    config: configFromEnv(LOCAL_VARS),
    origin: makeOrigin({ url: ORIGIN, botsToken: network.token, fetch: network.fetch }),
    botCheck: async (token) => ({ verdict: token === DUMMY_TOKEN ? 'pass' : 'fail', upstream: 200, fault: null }),
    forwardEvent: async (event) => {
      forwarded.push(event);
      return { ok: true, upstream: 202, fault: null };
    },
    limits,
    // One Worker, started once: its holder of the pot's counts lives as long as the stack.
    potStatsHolder: makePotStatsHolder(),
    log: (line) => {
      lines.push(line);
    },
    waitUntil: (promise) => {
      pending.push(promise);
    },
    now: () => clock.ms,
  };
  const answer = makeHandler(deps);
  /** Requests the handler has not answered yet. */
  const open = new Set<Promise<Response>>();
  const handler: Handler = (request) => {
    const answered = answer(request);
    open.add(answered);
    const done = () => open.delete(answered);
    answered.then(done, done);
    return answered;
  };
  const page = pageFetch(handler);
  return {
    network,
    clock,
    page,
    api: makeApi(page),
    lines,
    forwarded,
    settled: () => Promise.all(pending.splice(0)),
    /** Waits until every request has its answer. */
    idle: async () => {
      while (open.size > 0) await Promise.allSettled([...open]);
    },
  };
}

type Stack = ReturnType<typeof stack>;

/** The engine as one page of the app holds it. Two pages on one storage are two tabs, or one tab before and after a page load. */
function pageOn(s: Stack, options: { storage?: MemoryStorage; auth?: VirtualAuthenticator } = {}) {
  const timers = new FakeTimers(s.clock);
  const storage = options.storage ?? new MemoryStorage();
  const auth = options.auth ?? new VirtualAuthenticator();
  const engine = makeEngine({
    local: storage as Storage,
    passkeys: passkeyPort(auth.env()),
    api: s.api,
    now: () => s.clock.ms,
    timers,
    visible: () => true,
    // The app's own event sender.
    track,
    persist: async () => true,
    lang: () => 'en',
    blockSeconds: () => 10,
  });
  /** Waits until the engine and the stack have nothing on their way. */
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 4; round++) {
      await flush();
      await s.idle();
      await engine.chain.idle();
    }
    await flush();
  };
  return {
    ...engine,
    storage,
    auth,
    settle,
    /** Moves time on for the page and the stand-in network alike, running the timers that come due. */
    advance: (ms: number) => timers.advance(ms, settle),
  };
}

type Page = ReturnType<typeof pageOn>;

// -- the glue, in small ---------------------------------------------------------------

/**
 * What the app's glue does with the runner's plain modules, for one page.
 *
 * At every change (the session's, the chain's, a move to another screen) it
 * takes a picture of the world, hands the picture before and this one to
 * advance(), and writes what advance() says, one change at a time, through
 * writeProgress(). A step is counted by the write that finished it. The
 * picture is then kept as "before", with the note read again, so the next
 * change is compared with what is now stored.
 */
function follow(s: Stack, page: Page) {
  const local = page.storage as Storage;
  let route: Route = { name: 'home' };
  let before: World | null = null;
  /** How long a step's payment waited for its block: kept in the page's memory, never stored. */
  const waited: Partial<Record<StepId, Waited>> = {};
  /** Every change this page really wrote, in order. */
  const wrote: Change[] = [];

  /** The world at this moment: the screen, what the engine publishes, the stored note, the clock. */
  const world = (): World => {
    const session = page.session.view();
    const chain = page.chain.view();
    const read = readProgress(local);
    return {
      route,
      wallet: {
        status: session.status,
        record: session.record,
        unlocked: session.unlocked,
        chain: chain.chain,
        history: chain.history,
        historyError: chain.historyError,
        lastSent: chain.lastSent,
        wordsShown: session.wordsShown,
      },
      note: read.progress,
      kept: read.state === 'newer' ? 'newer' : read.state === 'blocked' || !session.canStore ? 'no' : 'yes',
      now: s.clock.ms,
    };
  };

  /** The one way anything is written. True when the browser took it. */
  const write = (change: Change): boolean => {
    const result = writeProgress(local, change);
    if (!result.ok) return false;
    if (result.changed) wrote.push(change);
    // Counted by the write that put the moment a step was done into the note.
    for (const id of counted(result.read, result.progress)) track('Do it', id);
    return true;
  };

  /** Applies advance() to the change from the last world to this one. */
  const run = (): void => {
    const after = world();
    const plan = advance(before, after);
    for (const change of plan.changes) if (!write(change)) break;
    Object.assign(waited, plan.waited);
    before = plan.changes.length > 0 ? world() : after;
  };

  // In the same task as each change the engine publishes.
  const stop = [page.session.subscribe(run), page.chain.subscribe(run)];

  return {
    world,
    write,
    run,
    waited,
    wrote,
    /** Where a step stands now. */
    view: (id: StepId) => judge(id, world()),
    /** The states of a step's parts, in order: for one-line comparisons. */
    states: (id: StepId): string[] =>
      judge(id, world()).parts.map((part) => (part.state === 'blocked' || part.state === 'unknown' ? `${part.state}: ${part.reason}` : part.state)),
    /** The reader moves to a screen. A step's screen is opened as its address says, with what follows the "?". */
    go(to: Route, search = ''): void {
      route = to;
      page.chain.watch(to.name);
      trackPage(to, 'en');
      // A step's screen starts its step and follows it; that is the first write a browser ever sees.
      if (to.name === 'step') write({ kind: 'open', step: to.id, at: s.clock.ms, from: fromOfSearch(to.id, search) });
      run();
    },
    /** The page is gone (a page load, a closed tab): its engine is no longer listened to. */
    close(): void {
      for (const each of stop) each();
    },
  };
}

/** A bot check that hands out the token the Worker passes. */
const botCheck: TokenSource = async () => DUMMY_TOKEN;

const now = (extra: Partial<Extract<PartView, { state: 'now' }>> = {}): PartView => ({ state: 'now', txid: null, waiting: null, confirmations: null, unlock: false, ...extra });
const TICKED: PartView = { state: 'ticked', waited: null };
const LATER: PartView = { state: 'later' };

// -- the story ------------------------------------------------------------------------------

test('the six steps, from a browser that holds nothing to all six done, on the real engine, the Worker and the stand-in network', async () => {
  const s = stack();
  const bodies: string[] = [];
  // The app's own sender, strictly: an event the contract does not list throws.
  initEvents(true, (body) => bodies.push(body), { strict: true });
  try {
    const first = pageOn(s);
    let page = first;
    let doit = follow(s, page);
    const keys = (): string[] => [...page.storage.map.keys()].sort();

    // -- before any step is opened, nothing is written --
    doit.go({ name: 'home' });
    doit.go({ name: 'do' });
    await page.settle();
    assert.deepEqual(keys(), [], 'Home and the list of steps write nothing');
    assert.deepEqual(s.network.requests(), [], 'and with no wallet nothing is asked of the network');
    assert.deepEqual(readProgress(page.storage as Storage), { state: 'none', progress: { v: 1, following: null, steps: {} } });
    for (const id of STEPS) assert.deepEqual([doit.view(id).state, doit.view(id).at], ['not-started', null], id);

    // ================================================================================
    // hold-some: a wallet is here, coins arrive, a block takes one in
    // ================================================================================
    const holdSome: Route = { name: 'step', id: 'hold-some' };
    assert.deepEqual(parsePath('/do/hold-some'), { lang: 'en', route: holdSome });
    doit.go(holdSome, '?from=/journey/what-bitcoin-actually-is');
    assert.deepEqual(keys(), [PROGRESS_KEY], 'opening a step is the first write');
    assert.deepEqual(readProgress(page.storage as Storage).progress, {
      v: 1,
      following: 'hold-some',
      followedAt: START_MS,
      steps: { 'hold-some': { started: true, from: '/journey/what-bitcoin-actually-is' } },
    });
    // No wallet: the first part is the one to do, and it can be done now.
    assert.deepEqual(doit.view('hold-some'), { id: 'hold-some', state: 'started', parts: [now(), LATER, LATER], at: 1 });
    assert.equal(chapterLink(SITE, 'hold-some', 'en', doit.world().note), `${SITE}/journey/what-bitcoin-actually-is#do-hold-some`);
    // And no coin that a done step's card could name a block for.
    assert.equal(coinInBlock(doit.world()), null);

    // The reader makes a wallet, with a passkey. The engine publishes it, and the part ticks in the same task.
    doit.go({ name: 'new' });
    assert.deepEqual(await page.session.createWithPasskey(), { kind: 'created' });
    const record = page.session.view().record;
    assert.ok(record);
    assert.equal(record.kind, 'passkey');
    page.session.ackCreated();
    assert.deepEqual(readProgress(page.storage as Storage).progress.steps['hold-some']?.parts, { 1: true });
    // The wallet's first look at its coins is running: the next part is not known yet, and is not "no coins".
    doit.go(holdSome);
    assert.deepEqual(doit.states('hold-some'), ['ticked', 'unknown: looking', 'later']);
    await page.settle();
    assert.deepEqual(doit.states('hold-some'), ['ticked', 'now', 'later']);

    // Coins from the faucet, on Receive. The keys leave the page before the bot check's script comes in.
    doit.go({ name: 'receive' });
    await page.settle();
    page.session.beforeBotCheck();
    await page.faucet.ask(botCheck);
    const coin = page.faucet.view().payment;
    assert.ok(coin);
    await page.advance(5_000);
    assert.equal(page.chain.state()?.unconfirmed, BigInt(FAUCET_SATS));
    // Seen, on a screen that is not the step's: a state of the wallet ticks wherever the reader is.
    assert.deepEqual(readProgress(page.storage as Storage).progress.steps['hold-some']?.parts, { 1: true, 2: true });
    // "must stay not done: hold-some with only an unconfirmed coin". The part waits, and names the coin's transaction.
    assert.deepEqual(doit.view('hold-some').parts[2], now({ txid: coin.txid, waiting: { txid: coin.txid, sentAt: null, lost: false } }));
    await page.advance(60_000);
    assert.deepEqual(doit.states('hold-some'), ['ticked', 'ticked', 'now']);
    // "must stay not done: hold-some with only an unconfirmed coin". And a coin that is in no block is not one
    // the card of a done step names a block for.
    assert.equal(doit.view('hold-some').state, 'started');
    assert.equal(coinInBlock(doit.world()), null);

    // A block takes the coin in, while the reader is still on Receive. The step asks nothing after that: the
    // tick the block brings is its last one, and it is written at the moment the page saw the block.
    const minedAt = s.clock.ms;
    s.network.mine();
    const coinHeight = s.network.height();
    await page.advance(15_000);
    assert.equal(page.chain.state()?.confirmed, BigInt(FAUCET_SATS));
    assert.deepEqual(doit.view('hold-some'), { id: 'hold-some', state: 'done', parts: [TICKED, TICKED, TICKED], at: null });
    const done = readProgress(page.storage as Storage).progress;
    const holdNote = done.steps['hold-some'];
    assert.ok(holdNote?.doneAt !== undefined && holdNote.doneAt > minedAt && holdNote.doneAt <= s.clock.ms, JSON.stringify(holdNote));
    assert.deepEqual(holdNote, { started: true, doneAt: holdNote.doneAt, from: '/journey/what-bitcoin-actually-is', parts: { 1: true, 2: true, 3: true } });
    // No part of it is a question, so nothing is left for the reader to answer or to say.
    assert.equal(answered('hold-some', doit.world()), null);
    // Done: the way back now ends in what the chapter marks its card on. It names this step, and would name the
    // other done steps of its chapter after it: there are none.
    assert.equal(chapterLink(SITE, 'hold-some', 'en', done), `${SITE}/journey/what-bitcoin-actually-is#done=hold-some`);
    // The step is followed until the reader has seen that. Receive, where they are, says that the step is done
    // and leads back to it.
    assert.deepEqual([done.following, stripStep(done, s.clock.ms), doneFollowed(done, s.clock.ms)], ['hold-some', 'hold-some', 'hold-some']);

    // Back to the step. With the bot check's script in the page, that is a page load: a new
    // document on the same storage. Nothing the runner knows lived in the old page.
    doit.close();
    page = pageOn(s, { storage: first.storage, auth: first.auth });
    doit = follow(s, page);
    doit.go(holdSome);
    // That the step is done is read from the note, before the wallet has looked at anything.
    assert.deepEqual(doit.view('hold-some'), { id: 'hold-some', state: 'done', parts: [TICKED, TICKED, TICKED], at: null });
    assert.equal(readProgress(page.storage as Storage).progress.following, null, 'seen on its own screen: let go');
    // The block its card names is not: it comes from the wallet's look at its coins, and until that look is
    // in the card names none.
    assert.equal(coinInBlock(doit.world()), null);
    await page.settle();
    // The coin the faucet paid, and the block the stand-in network put it in: what the practice explorer
    // shows for that transaction, and what the wallet's own list of transactions shows.
    assert.deepEqual(coinInBlock(doit.world()), { txid: coin.txid, height: coinHeight });
    const listed = page.chain.view().history?.find((tx) => tx.txid === coin.txid);
    assert.deepEqual([listed?.direction, listed?.height], ['received', coinHeight]);
    // Neither is kept: the note of the done step is as the block left it.
    assert.deepEqual(readProgress(page.storage as Storage).progress.steps['hold-some'], holdNote);
    // The wallet of this new page is locked. Its coins are known all the same: the card needs no key.
    assert.equal(page.session.view().unlocked, false);

    // ================================================================================
    // pass-it-on: a coin that can be spent, a payment to the pot, a block
    // ================================================================================
    const passItOn: Route = { name: 'step', id: 'pass-it-on' };
    doit.go(passItOn);
    // A confirmed coin is here, so the first part ticks as the step opens.
    assert.deepEqual(doit.view('pass-it-on'), { id: 'pass-it-on', state: 'started', parts: [TICKED, now(), LATER], at: 2 });
    // Opened with no "?from=": the way back is the step's own chapter, in the page's language.
    assert.equal(chapterLink(SITE, 'pass-it-on', 'en', doit.world().note), `${SITE}/journey/how-bitcoin-works#do-pass-it-on`);
    assert.equal(chapterLink(SITE, 'pass-it-on', 'es', doit.world().note), `${SITE}/es/recorrido/como-funciona-bitcoin#do-pass-it-on`);

    /** Plans, signs and sends a payment from the Send screen, as the reader would. */
    const pay = async (request: PaymentRequest): Promise<string> => {
      doit.go({ name: 'send' });
      const signed = page.session.sign(request);
      assert.ok(signed.ok, signed.ok ? '' : signed.reason);
      const sent = await page.chain.broadcast(signed.payment);
      assert.deepEqual(sent, { ok: true, txid: signed.payment.txid });
      await page.settle();
      return signed.payment.txid;
    };
    assert.deepEqual(await page.session.unlock(), { kind: 'unlocked' });

    // "must stay not done: pass-it-on after a payment to an address that is not the pot's".
    const elsewhere = await pay({ to: SOMEONE, amount: 4_000n, feeRate: 2n });
    assert.deepEqual(page.chain.view().lastSent, { txid: elsewhere, toPot: false, at: s.clock.ms });
    doit.go(passItOn);
    assert.deepEqual(doit.view('pass-it-on').parts, [TICKED, now(), LATER]);

    // "Pass it on": the pot hands out its address, and the payment goes there.
    await page.advance(7_000);
    doit.go({ name: 'send' });
    const pot = await page.chain.potAddress();
    assert.ok(pot.ok);
    const sentAt = s.clock.ms;
    const gift = await pay({ to: pot.address, amount: 20_000n, feeRate: 2n });
    assert.deepEqual(page.chain.view().lastSent, { txid: gift, toPot: true, at: sentAt });
    assert.deepEqual(readProgress(page.storage as Storage).progress.steps['pass-it-on'], { started: true, tx: gift, sentAt, parts: { 1: true, 2: true } });
    doit.go(passItOn);
    await page.settle();
    // It waits for its block, and the part says which payment it waits for.
    assert.deepEqual(doit.view('pass-it-on').parts, [TICKED, TICKED, now({ txid: gift, waiting: { txid: gift, sentAt, lost: false } })]);

    // The step's screen stays open; nine seconds on a block is mined; nothing is clicked.
    await page.advance(9_000);
    assert.deepEqual(doit.states('pass-it-on'), ['ticked', 'ticked', 'now']);
    s.network.mine();
    const giftHeight = s.network.height();
    await page.advance(15_000);
    assert.deepEqual(doit.view('pass-it-on'), { id: 'pass-it-on', state: 'done', parts: [TICKED, TICKED, TICKED], at: null });
    // Done at the moment the page saw the block: the payment is deleted from the note.
    const passed = readProgress(page.storage as Storage).progress.steps['pass-it-on'];
    assert.ok(passed?.doneAt !== undefined && passed.doneAt > sentAt + 9_000 && passed.doneAt <= s.clock.ms, JSON.stringify(passed));
    assert.deepEqual(passed, { started: true, doneAt: passed.doneAt, parts: { 1: true, 2: true, 3: true } });
    // How long it waited lives in the page's memory only: from the moment it was sent to its block's own time.
    assert.deepEqual(doit.waited['pass-it-on'], { height: giftHeight, seconds: 9 });
    // The line under a done pass-it-on: the pot's counts, asked once, through the Worker.
    assert.deepEqual(await page.chain.potStats(), { ok: true, stats: { passedOn: 1, waiting: 1, handedOn: 0 } });

    // ================================================================================
    // no-balances: the coins, how many there are, one payment read
    // ================================================================================
    const noBalances: Route = { name: 'step', id: 'no-balances' };
    doit.go(noBalances);
    await page.settle();
    assert.deepEqual(doit.view('no-balances'), { id: 'no-balances', state: 'started', parts: [now(), LATER, LATER], at: 1 });
    // Opening the list of transactions is not opening the coins.
    doit.go({ name: 'activity' });
    assert.deepEqual(doit.states('no-balances'), ['now', 'later', 'later']);
    doit.go({ name: 'coins' });
    assert.deepEqual(doit.states('no-balances'), ['ticked', 'now', 'later']);
    doit.go(noBalances);
    const coins = page.chain.state()?.coins ?? [];
    const total = (page.chain.state()?.confirmed ?? 0n) + (page.chain.state()?.unconfirmed ?? 0n);
    assert.ok(coins.length >= 1 && total > BigInt(coins.length));
    // "must stay not done: no-balances with a wrong count". The total is the answer to another question.
    assert.equal(answerCoins(doit.world(), String(coins.length + 1)), 'wrong');
    assert.equal(answerCoins(doit.world(), '0'), 'wrong');
    assert.equal(answerCoins(doit.world(), '1.5'), 'period');
    assert.equal(answerCoins(doit.world(), total.toLocaleString('en-US')), 'total');
    assert.deepEqual(doit.states('no-balances'), ['ticked', 'now', 'later']);
    assert.equal(answerCoins(doit.world(), String(coins.length)), 'right');
    const count = answered('no-balances', doit.world());
    assert.ok(count && doit.write(count));
    // The last part names the payment to read: the wallet's newest one of its own.
    assert.deepEqual(doit.view('no-balances').parts, [TICKED, TICKED, now({ txid: gift })]);
    // A transaction the wallet only received is not one it sent.
    doit.go({ name: 'tx', txid: coin.txid });
    assert.deepEqual(doit.states('no-balances'), ['ticked', 'ticked', 'now']);
    doit.go({ name: 'tx', txid: gift });
    assert.deepEqual(doit.view('no-balances'), { id: 'no-balances', state: 'done', parts: [TICKED, TICKED, TICKED], at: null });

    // ================================================================================
    // waiting-room: a payment, its block, six blocks
    // ================================================================================
    const waitingRoom: Route = { name: 'step', id: 'waiting-room' };
    doit.go(waitingRoom);
    await page.settle();
    // "must stay not done: waiting-room after pass-it-on in the same page with no new payment".
    // This page's last payment is still the one to the pot, sent before this step was followed.
    assert.equal(page.chain.view().lastSent?.txid, gift);
    assert.deepEqual(doit.view('waiting-room'), { id: 'waiting-room', state: 'started', parts: [now(), LATER, LATER], at: 1 });
    await page.advance(30_000);
    assert.deepEqual(doit.states('waiting-room'), ['now', 'later', 'later']);

    const paidAt = s.clock.ms;
    const payment = await pay({ to: SOMEONE, amount: 3_000n, feeRate: 1n });
    assert.deepEqual(readProgress(page.storage as Storage).progress.steps['waiting-room'], { started: true, tx: payment, sentAt: paidAt, parts: { 1: true } });
    doit.go(waitingRoom);
    await page.settle();
    assert.deepEqual(doit.view('waiting-room').parts, [TICKED, now({ txid: payment, waiting: { txid: payment, sentAt: paidAt, lost: false } }), LATER]);

    await page.advance(12_000);
    s.network.mine();
    const paymentHeight = s.network.height();
    await page.advance(15_000);
    // In a block: one confirmation. The line "It waited ..." is told from the note while it still holds the payment.
    const inBlock = doit.view('waiting-room');
    assert.deepEqual(inBlock.parts[2], now({ txid: payment, waiting: { txid: payment, sentAt: paidAt, lost: false }, confirmations: 1 }));
    assert.deepEqual(inBlock.parts[1], { state: 'ticked', waited: { height: paymentHeight, seconds: 12 } });
    assert.deepEqual(doit.waited['waiting-room'], { height: paymentHeight, seconds: 12 });
    // One block on top after another, with the screen left open.
    for (const confirmations of [2, 3, 4, 5]) {
      s.network.mine();
      await page.advance(15_000);
      const part = doit.view('waiting-room').parts[2];
      assert.deepEqual(part?.state === 'now' ? part.confirmations : part, confirmations);
    }
    assert.equal(doit.view('waiting-room').state, 'started');
    s.network.mine();
    await page.advance(15_000);
    assert.deepEqual(doit.view('waiting-room'), { id: 'waiting-room', state: 'done', parts: [TICKED, TICKED, TICKED], at: null });
    const waitedOut = readProgress(page.storage as Storage).progress.steps['waiting-room'];
    assert.ok(waitedOut?.doneAt !== undefined && waitedOut.doneAt > paidAt && waitedOut.doneAt <= s.clock.ms);
    assert.deepEqual(waitedOut, { started: true, doneAt: waitedOut.doneAt, parts: { 1: true, 2: true, 3: true } });

    // ================================================================================
    // the-seed: the 12 words on screen, written down, three of them checked
    // ================================================================================
    // The words were on screen once before the step is followed. That is not this step's doing.
    doit.go({ name: 'backup' });
    const words = page.session.revealWords();
    assert.ok(words);
    assert.equal(page.session.view().wordsShown, 1);
    const theSeed: Route = { name: 'step', id: 'the-seed' };
    doit.go(theSeed);
    assert.deepEqual(doit.view('the-seed'), { id: 'the-seed', state: 'started', parts: [now(), LATER, LATER], at: 1 });
    // Shown again, while the step is followed.
    doit.go({ name: 'backup' });
    assert.deepEqual(page.session.revealWords(), words);
    assert.deepEqual(doit.states('the-seed'), ['ticked', 'now', 'later']);
    doit.go(theSeed);
    // "I have written them down": the reader's own word.
    const said = answered('the-seed', doit.world());
    assert.deepEqual(said, { kind: 'tick', step: 'the-seed', part: 2, at: s.clock.ms });
    assert.ok(said && doit.write(said));
    assert.deepEqual(doit.view('the-seed').parts, [TICKED, TICKED, now()]);

    // Three of the 12, asked by their place. Locked, the wallet compares nothing, and the part says to unlock first.
    const places = pickPositions(() => 0.5);
    assert.equal(places.length, 3);
    const typed = places.map((place) => words[place] ?? '');
    page.session.lock();
    assert.deepEqual(doit.view('the-seed').parts[2], now({ unlock: true }));
    assert.deepEqual(page.session.checkWordsAt(places, typed), { ok: false, reason: 'locked' });
    assert.equal(wordsPassed(places, page.session.checkWordsAt(places, typed)), false);
    assert.deepEqual(await page.session.unlock(), { kind: 'unlocked' });
    // "must stay not done: the-seed with a wrong word". The answer names the place, never the word.
    const other = words.find((word) => word !== typed[1]) ?? '';
    const wrong = page.session.checkWordsAt(places, [typed[0] ?? '', other, typed[2] ?? '']);
    assert.deepEqual(wrong, { ok: true, wrong: [places[1]] });
    assert.equal(wordsPassed(places, wrong), false);
    assert.deepEqual(doit.states('the-seed'), ['ticked', 'ticked', 'now']);
    // Right, however it is typed.
    const right = page.session.checkWordsAt(places, typed.map((word, at) => (at === 0 ? ` ${word.toUpperCase()} ` : word)));
    assert.deepEqual(right, { ok: true, wrong: [] });
    assert.equal(wordsPassed(places, right), true);
    // Another tab has the same step open and the same answer ready. Both write; the step is counted once.
    const twin = answered('the-seed', doit.world());
    const checked = answered('the-seed', doit.world());
    assert.deepEqual(checked, { kind: 'tick', step: 'the-seed', part: 3, at: s.clock.ms, wallet: record.fingerprint });
    const counts = (): number => bodies.filter((body) => (JSON.parse(body) as EventBody).name === 'Do it').length;
    const beforeCount = counts();
    assert.ok(checked && doit.write(checked));
    assert.equal(counts(), beforeCount + 1);
    assert.ok(twin && doit.write(twin));
    assert.equal(counts(), beforeCount + 1, 'the write that found the step done already counts nothing');
    // Done, and the note keeps the wallet fingerprint the words were checked for. Never a word, never a place.
    assert.deepEqual(readProgress(page.storage as Storage).progress.steps['the-seed'], { started: true, doneAt: s.clock.ms, wallet: record.fingerprint, parts: { 1: true, 2: true, 3: true } });
    assert.equal(seedWallet(doit.world()), 'same');
    assert.deepEqual(rechecked(doit.world()), { kind: 'checked', step: 'the-seed', wallet: record.fingerprint });

    // ================================================================================
    // prove-the-backup: the paper checked, the wallet removed, restored from the paper, the coins found
    // ================================================================================
    const prove: Route = { name: 'step', id: 'prove-the-backup' };
    const held = page.chain.state();
    assert.ok(held && held.confirmed + held.unconfirmed > 0n);
    doit.go(prove);
    // The paper was checked a moment ago, in the-seed, for this very wallet: the first part is ticked with that.
    assert.deepEqual(doit.view('prove-the-backup'), { id: 'prove-the-backup', state: 'started', parts: [TICKED, now(), LATER, LATER], at: 2 });
    assert.deepEqual(readProgress(page.storage as Storage).progress.steps['prove-the-backup'], { started: true, wallet: record.fingerprint, was: 'passkey', parts: { 1: true } });

    // Remove, on Settings. The note is not touched by it: only the wallet's record goes.
    doit.go({ name: 'settings' });
    assert.equal(page.session.removeWallet(), 'removed');
    assert.deepEqual(keys(), [PROGRESS_KEY]);
    assert.deepEqual(doit.states('prove-the-backup'), ['ticked', 'ticked', 'now', 'later']);
    // The steps that are done stay done with no wallet in the browser.
    for (const id of ['hold-some', 'pass-it-on', 'no-balances', 'waiting-room', 'the-seed'] as const) assert.equal(doit.view(id).state, 'done', id);

    // "must stay not done: prove-the-backup when the wallet returns with its passkey".
    doit.go({ name: 'home' });
    const opened = await page.session.openWithPasskey();
    assert.equal(opened.kind, 'opened', JSON.stringify(opened));
    await page.settle();
    assert.equal(page.session.view().record?.kind, 'passkey');
    assert.deepEqual(doit.states('prove-the-backup'), ['ticked', 'ticked', 'blocked: came-back-with-passkey', 'later']);
    // "... when another wallet is restored". Out again, and a wallet from other words comes in.
    assert.equal(page.session.removeWallet(), 'removed');
    doit.go({ name: 'restore' });
    const stranger = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    assert.deepEqual(await page.session.restore(stranger), { kind: 'empty' });
    assert.equal(page.session.keepRestored(), 'restored');
    await page.settle();
    assert.deepEqual(doit.states('prove-the-backup'), ['ticked', 'ticked', 'blocked: another-wallet', 'later']);
    assert.equal(seedWallet(doit.world()), 'other');
    assert.equal(page.session.removeWallet(), 'removed');
    assert.deepEqual(doit.states('prove-the-backup'), ['ticked', 'ticked', 'now', 'later']);

    // From the paper: the 12 words, typed in. The scan comes first, and the coins are there with the wallet.
    assert.deepEqual(await page.session.restore(words.join(' ')), { kind: 'restored' });
    await page.settle();
    const restored = page.session.view().record;
    assert.deepEqual([restored?.kind, restored?.fingerprint], ['words', record.fingerprint]);
    assert.deepEqual(doit.view('prove-the-backup'), { id: 'prove-the-backup', state: 'done', parts: [TICKED, TICKED, TICKED, TICKED], at: null });
    assert.deepEqual([page.chain.state()?.confirmed, page.chain.state()?.unconfirmed], [held.confirmed, held.unconfirmed], 'the same coins');
    // Done: the wallet the drill named is deleted from its note. What it was kept with stays, to say what changed.
    assert.deepEqual(readProgress(page.storage as Storage).progress.steps['prove-the-backup'], { started: true, doneAt: s.clock.ms, was: 'passkey', parts: { 1: true, 2: true, 3: true, 4: true } });

    // ================================================================================
    // all six, and what left the browser
    // ================================================================================
    for (const id of STEPS) assert.equal(doit.view(id).state, 'done', id);
    assert.deepEqual(keys(), [PROGRESS_KEY, RECORD_KEY].sort());
    // Nothing private in the note: no word of the 12, no key, no address, no answer.
    const stored = page.storage.map.get(PROGRESS_KEY) ?? '';
    for (const word of words) assert.ok(!new RegExp(`\\b${word}\\b`).test(stored), `the note holds the word in place ${words.indexOf(word) + 1}`);
    for (const secret of [record.xpub, record.firstAddress, pot.address, SOMEONE, String(coinHeight), gift, payment]) assert.ok(!stored.includes(secret), secret);
    assert.match(stored, new RegExp(`"wallet":"${record.fingerprint}"`));

    // "Do it" was counted once for each step, in the order they were finished, each under the screen it was finished on.
    const events = bodies.map((body) => JSON.parse(body) as EventBody);
    for (const event of events) assert.ok(isEventBody(event), JSON.stringify(event));
    assert.deepEqual(
      events.filter((event) => event.name === 'Do it'),
      [
        // "Hold some" is done by its coin's block, on the screen where the reader waited for it.
        { name: 'Do it', path: '/wallet/receive', value: 'hold-some' },
        { name: 'Do it', path: '/do/pass-it-on', value: 'pass-it-on' },
        { name: 'Do it', path: '/wallet/tx', value: 'no-balances' },
        { name: 'Do it', path: '/do/waiting-room', value: 'waiting-room' },
        { name: 'Do it', path: '/do/the-seed', value: 'the-seed' },
        { name: 'Do it', path: '/restore', value: 'prove-the-backup' },
      ],
    );
    // And the Worker takes every one of them, the new event and the new paths included, and passes it on as it came.
    for (const body of bodies) {
      const response = await s.page(API.event, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      assert.equal(response.status, 202, body);
    }
    await s.settled();
    assert.deepEqual(s.forwarded, events);
    // The Worker wrote a line for the pot's counts, and none of its lines names a step.
    assert.ok(s.lines.some((each) => each.route === 'pot_stats' && each.status === 200));
    for (const each of s.lines) assert.doesNotMatch(JSON.stringify(each), /hold-some|pass-it-on|no-balances|waiting-room|the-seed|prove-the-backup/);
    doit.close();
  } finally {
    initEvents(false);
  }
});
