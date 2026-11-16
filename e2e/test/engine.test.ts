// The wallet's engine, whole, on the real parts.
//
// The three plain modules of the app (session.ts, chain-sync.ts and
// faucet-flow.ts, wired by makeEngine as wallet.svelte.ts wires them) run
// here over:
//
//   the app's own client        makeApi (app/src/lib/api.ts)
//     -> the Worker's handler   makeHandler, as it is deployed
//     -> its way to the origin  makeOrigin, as it is deployed
//     -> the stand-in network   makeFakeOrigin, answering in this process
//
// with the app's real passkey module on a stand-in password manager, the
// real key store on a Map, the real event sender, and timers driven by hand.
// Everything a screen will do through WalletApi is done here once, in the
// order a reader would do it, without a browser. (The browser run, with
// Svelte and a virtual authenticator in Chrome, is the scenarios' job.)
//
// The wiring of the stack is the one in stack.test.ts.

import assert from 'node:assert/strict';
import {
  API,
  TXID_PATTERN,
  isEventBody,
  type AppConfig,
  type EventBody,
} from '@learnbitcoin/practice-contract';
import {
  accountFromMnemonic,
  applyPayment,
  deriveAddress,
  newMnemonic,
  watchOnlyAccount,
  type FetchLike,
  type PaymentRequest,
} from '@learnbitcoin/practice-wallet';
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
import { loadConfig } from '../../app/src/lib/config.ts';
import { initEvents, track, trackPage } from '../../app/src/lib/events.ts';
import { RECORD_KEY, loadRecord } from '../../app/src/lib/keystore.ts';
import type { Route } from '../../app/src/lib/router.ts';
import { makeEngine, passkeyPort } from '../../app/src/lib/session.ts';
import type { TokenSource } from '../../app/src/lib/wallet-api.ts';
import { FakeTimers, MemoryStorage, VirtualAuthenticator, flush, test } from '../../app/test/engine-fakes.ts';
import { makeFakeOrigin } from '../src/fake-origin.ts';

// -- the stack (as in stack.test.ts) ----------------------------------------------

const APP = 'https://practice.test';
const ORIGIN = 'https://origin.test';
const START_MS = 1_800_000_000_000;
const FAUCET_SATS = 50_000;
/** The token Cloudflare's test widget hands out. The bot check here passes it and fails every other. */
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const LOCAL_VARS: ConfigVars = {
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  EXPLORER_URL: 'https://explorer.test/',
  ELECTRUM_HOST: 'electrum.test',
  ELECTRUM_PORT: '60002',
  PLAUSIBLE_DOMAIN: 'practice.test',
  SITE_URL: 'https://site.test',
  SOURCE_URL: 'https://source.test/practice',
  PASSKEY_HOST: 'localhost',
  FAUCET_SATS: String(FAUCET_SATS),
  BLOCK_SECONDS: '10',
  // As shipped. Nothing in this file looks at the pot's counts.
  POT_COUNTS: 'off',
};

/** A fetch that hands each request to the Worker's handler, dressed as one of the app's own pages dresses it. */
function pageFetch(handler: Handler): FetchLike {
  return async (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('User-Agent', 'engine-test browser');
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
  const botChecks: { token: string; address: string }[] = [];
  /** The limiters a test has told to refuse. */
  const over = new Set<keyof Limits>();
  const limiter = (name: keyof Limits): Limiter => ({ limit: async () => ({ success: !over.has(name) }) });

  const deps: Deps = {
    config: configFromEnv(LOCAL_VARS),
    origin: makeOrigin({ url: ORIGIN, botsToken: network.token, fetch: network.fetch }),
    botCheck: async (token, address) => {
      botChecks.push({ token, address });
      return { verdict: token === DUMMY_TOKEN ? 'pass' : 'fail', upstream: 200, fault: null };
    },
    forwardEvent: async (event) => {
      forwarded.push(event);
      return { ok: true, upstream: 202, fault: null };
    },
    limits: {
      chain: limiter('chain'),
      broadcast: limiter('broadcast'),
      faucet: limiter('faucet'),
      pot: limiter('pot'),
      events: limiter('events'),
    },
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
  /**
   * A test can make chosen requests slow. `until` is asked about every request, by method and
   * path, and a request it returns a promise for is not answered before that promise is.
   */
  const slow: { until: ((method: string, path: string) => Promise<void> | null) | null } = { until: null };
  /** Requests the handler has not answered yet. */
  const open = new Set<Promise<Response>>();
  const handler: Handler = (request) => {
    const wait = slow.until?.(request.method, new URL(request.url).pathname) ?? null;
    const answered = wait === null ? answer(request) : wait.then(() => answer(request));
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
    botChecks,
    over,
    slow,
    settled: () => Promise.all(pending.splice(0)),
    /** Waits until every request has its answer. */
    idle: async () => {
      while (open.size > 0) await Promise.allSettled([...open]);
    },
    /** How many requests of one kind have reached the origin. */
    reached: (method: string, path: string | RegExp) =>
      network
        .requests()
        .filter((request) => request.method === method && (typeof path === 'string' ? request.path === path : path.test(request.path))).length,
  };
}

type Stack = ReturnType<typeof stack>;

// -- a page: the engine on that stack ------------------------------------------------

/** A storage that tells the test the moment a wallet's record is written. */
class WatchedStorage extends MemoryStorage {
  onRecord: (() => void) | null = null;
  override setItem(key: string, value: string): void {
    if (key === RECORD_KEY) this.onRecord?.();
    super.setItem(key, value);
  }
}

/** The engine as one page of the app holds it. Two pages on one storage are two tabs. */
function pageOn(s: Stack, options: { storage?: WatchedStorage; auth?: VirtualAuthenticator; config?: AppConfig } = {}) {
  const timers = new FakeTimers(s.clock);
  const storage = options.storage ?? new WatchedStorage();
  const auth = options.auth ?? new VirtualAuthenticator();
  const tab = { visible: true };
  const engine = makeEngine({
    local: storage as Storage,
    // The app's own passkey module, on a stand-in for the browser's password manager.
    passkeys: passkeyPort(auth.env()),
    api: s.api,
    now: () => s.clock.ms,
    timers,
    visible: () => tab.visible,
    // The app's own event sender.
    track,
    persist: async () => true,
    lang: () => 'en',
    blockSeconds: () => options.config?.blockSeconds ?? 10,
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
    engine,
    storage,
    auth,
    timers,
    settle,
    /** Moves time on for the page and the stand-in network alike, running the timers that come due. */
    advance: (ms: number) => timers.advance(ms, settle),
  };
}

/** A bot check that hands out the token the Worker passes, and notes whether a fresh one was asked for. */
function botCheck(): { source: TokenSource; asked: boolean[] } {
  const asked: boolean[] = [];
  return {
    asked,
    source: async (fresh) => {
      asked.push(fresh);
      return DUMMY_TOKEN;
    },
  };
}

/** Counts events through the app's own sender for the length of a test, strictly: an unlisted event throws. */
function counting(): { bodies: string[]; screen(route: Route): void; stop(): void } {
  const bodies: string[] = [];
  initEvents(true, (body) => bodies.push(body), { strict: true });
  return {
    bodies,
    screen: (route) => trackPage(route, 'en'),
    stop: () => initEvents(false),
  };
}

// -- the story ----------------------------------------------------------------------------

test('one whole story: create with a passkey, coins from the faucet, the page load after the bot check, a payment to the pot, lock and unlock, another tab, restore', async () => {
  const s = stack();
  const events = counting();
  try {
    // The settings, as the page loads them.
    const { config } = await loadConfig(s.page);
    assert.deepEqual([config.faucetSats, config.blockSeconds, config.passkeyHost], [FAUCET_SATS, 10, 'localhost']);

    const page = pageOn(s, { config });
    const { session, chain, faucet } = page;
    assert.equal(session.view().status, 'none');
    assert.equal(session.view().passkeyOffered, null);
    await session.learnPasskeys(config.passkeyHost);
    assert.equal(session.view().passkeyOffered, true);
    assert.deepEqual(s.network.requests(), [], 'a page with no wallet asks the practice network nothing');

    // -- create with a passkey --
    events.screen({ name: 'new' });
    assert.deepEqual(await session.createWithPasskey(), { kind: 'created' });
    assert.deepEqual(page.auth.calls, ['create'], 'one prompt');
    const record = session.view().record;
    assert.ok(record);
    assert.deepEqual([session.view().status, session.view().unlocked, session.view().created, record.kind], ['ready', true, 'passkey', 'passkey']);
    // The "Wallet made" step: the words are there with no second prompt, and are the passkey's.
    const words = session.revealWords();
    assert.ok(words);
    assert.equal(words.length, 12);
    assert.equal(words.join(' '), page.auth.wordsOf(0));
    assert.equal(accountFromMnemonic(words.join(' ')).xpub, record.xpub);
    // Stored: the record, and in it no word.
    assert.deepEqual([...page.storage.map.keys()], [RECORD_KEY]);
    assert.deepEqual(loadRecord(page.storage as Storage), record);
    assert.doesNotMatch(page.storage.map.get(RECORD_KEY) ?? '', /mnemonic/);
    session.ackCreated();
    assert.equal(session.view().created, null);

    // -- the first scan: nothing, and never a zero before it is known --
    events.screen({ name: 'wallet' });
    chain.watch('wallet');
    assert.deepEqual([chain.view().chain.state, chain.view().chain.scanning], [null, true]);
    assert.equal(chain.view().receive, null);
    await page.settle();
    const empty = chain.view().chain;
    assert.deepEqual([empty.state?.confirmed, empty.state?.unconfirmed, empty.scanning, empty.error, empty.tip], [0n, 0n, false, null, s.network.height()]);
    assert.deepEqual(chain.view().receive, { address: record.firstAddress, index: 0, arrived: 0n });
    assert.deepEqual(chain.view().history, []);
    assert.equal(s.reached('GET', /^\/esplora\/address\/[a-z0-9]+$/), 40, 'twenty unused addresses on each chain');
    assert.deepEqual(chain.plan({ to: record.firstAddress, amount: 1_000n, feeRate: 2n }), { ok: false, reason: 'nothing-spendable', maxSendable: 0n, dust: null });

    // -- the faucet: from checking to confirmed --
    events.screen({ name: 'receive' });
    chain.watch('receive');
    await page.settle();
    // The Receive screen is about to add the bot check's script to the page. First the keys go:
    // from here on this document holds none and loads none.
    session.beforeBotCheck();
    assert.deepEqual([session.view().unlocked, session.revealWords()], [false, null]);
    assert.deepEqual(chain.view().notice, { id: 1, kind: 'locked' });
    const phases: string[] = [];
    faucet.subscribe(() => phases.push(faucet.view().phase));
    const check = botCheck();
    await faucet.ask(check.source);
    assert.deepEqual(phases, ['checking', 'asking', 'on-its-way']);
    assert.deepEqual(check.asked, [false]);
    assert.deepEqual(s.botChecks, [{ token: DUMMY_TOKEN, address: record.firstAddress }]);
    const promised = faucet.view().payment;
    assert.ok(promised);
    assert.match(promised.txid, TXID_PATTERN);
    assert.deepEqual(promised, { txid: promised.txid, amountSats: FAUCET_SATS, potTxid: null });
    // Promised, not yet seen by the wallet.
    assert.equal(chain.state()?.unconfirmed, 0n);

    // Five seconds on, the Receive poll has found it.
    await page.advance(5_000);
    assert.equal(faucet.view().phase, 'arrived');
    assert.deepEqual([chain.state()?.confirmed, chain.state()?.unconfirmed], [0n, BigInt(FAUCET_SATS)]);
    assert.deepEqual(chain.view().notice, { id: 2, kind: 'coins-arrived', sats: BigInt(FAUCET_SATS) });
    assert.deepEqual(chain.view().receive, { address: record.firstAddress, index: 0, arrived: BigInt(FAUCET_SATS) });
    // A coin somebody else sent cannot be spent before it is in a block. (A plan needs no keys.)
    const pot = await chain.potAddress();
    assert.ok(pot.ok);
    const request: PaymentRequest = { to: pot.address, amount: 20_000n, feeRate: 2n };
    const early = chain.plan(request);
    assert.deepEqual([early.ok, early.ok ? null : early.reason], [false, 'unconfirmed-only']);
    // And nothing is signed or unlocked in a document the bot check has been in.
    assert.deepEqual(session.sign(request), { ok: false, reason: 'locked' });
    assert.deepEqual(await session.unlock(), { kind: 'reload' });
    assert.deepEqual(page.auth.calls, ['create'], 'no prompt was opened');

    // A block. The 15-second poll sees the new height and reads the coins again.
    s.network.mine();
    await page.advance(15_000);
    assert.equal(faucet.view().phase, 'confirmed');
    assert.deepEqual(phases, ['checking', 'asking', 'on-its-way', 'arrived', 'confirmed']);
    assert.deepEqual([chain.state()?.confirmed, chain.state()?.unconfirmed], [BigInt(FAUCET_SATS), 0n]);
    assert.deepEqual(chain.view().notice, { id: 3, kind: 'confirmed' });

    // -- the receive address stays until the reader asks for another --
    assert.deepEqual(chain.view().receive, { address: record.firstAddress, index: 0, arrived: BigInt(FAUCET_SATS) });
    chain.newReceiveAddress();
    assert.equal(chain.view().receive?.index, 1);
    assert.notEqual(chain.view().receive?.address, record.firstAddress);
    assert.equal(faucet.view().phase, 'idle', 'the faucet view is about the address on screen');

    // -- plan, sign and broadcast to the pot --
    // With the bot check's script in the page, the move to Send is a full page load: a new
    // document on the same storage. It holds the same wallet, locked, and reads its coins afresh.
    events.screen({ name: 'send' });
    const send = pageOn(s, { storage: page.storage, auth: page.auth, config });
    send.chain.watch('send');
    assert.deepEqual([send.session.view().status, send.session.view().unlocked], ['ready', false]);
    assert.deepEqual(send.session.view().record, record);
    await send.settle();
    assert.equal(send.chain.state()?.confirmed, BigInt(FAUCET_SATS));
    // "Pass it on" asks the pot again here. Nobody has paid its address yet, so it is still the same one.
    assert.deepEqual(await send.chain.potAddress(), pot);
    const plan = send.chain.plan(request);
    assert.ok(plan.ok);
    assert.deepEqual([plan.amount, plan.change, plan.inputs.length], [20_000n, BigInt(FAUCET_SATS) - 20_000n - plan.fee, 1]);
    // Signing needs the keys: one prompt, for the stored passkey.
    assert.deepEqual(send.session.sign(request), { ok: false, reason: 'locked' });
    assert.deepEqual(await send.session.unlock(), { kind: 'unlocked' });
    assert.deepEqual(send.auth.calls, ['create', `get ${record.credentialId}`]);
    assert.deepEqual(send.chain.view().notice, { id: 1, kind: 'unlocked' });
    const signed = send.session.sign(request);
    assert.ok(signed.ok);
    assert.deepEqual([signed.payment.fee, signed.payment.vsize], [plan.fee, plan.vsize]);
    assert.deepEqual([signed.view.direction, signed.view.net, signed.view.confirmed], ['sent', -(20_000n + plan.fee), false]);
    assert.equal(s.reached('POST', '/esplora/tx'), 0, 'signed, not sent');

    const before = send.chain.state();
    assert.ok(before);
    const sent = await send.chain.broadcast(signed.payment);
    assert.deepEqual(sent, { ok: true, txid: signed.payment.txid });
    assert.equal(s.reached('POST', '/esplora/tx'), 1);
    // Applied at once, and the network says the same a moment later.
    const applied = send.chain.state();
    assert.deepEqual(applied, applyPayment(before, signed.payment));
    assert.deepEqual(send.chain.view().notice, { id: 2, kind: 'payment-sent' });
    await send.settle();
    assert.equal(send.chain.state(), applied, 'the light refresh found exactly what was applied');
    assert.deepEqual([applied?.confirmed, applied?.unconfirmed], [0n, plan.change]);
    // The next asker of the pot gets a fresh address: the gift arrived there.
    const next = await send.chain.potAddress();
    assert.ok(next.ok);
    assert.notEqual(next.address, pot.address);

    // -- history and one transaction --
    events.screen({ name: 'activity' });
    send.chain.watch('activity');
    await send.settle();
    assert.deepEqual(send.chain.view().history?.map((tx) => [tx.txid, tx.direction, tx.net, tx.confirmed]), [
      [signed.payment.txid, 'sent', -(20_000n + plan.fee), false],
      [promised.txid, 'received', BigInt(FAUCET_SATS), true],
    ]);
    const listed = await send.chain.lookupTx(signed.payment.txid);
    assert.ok(listed.kind === 'found');
    assert.equal(listed.view, send.chain.view().history?.[0], 'from the list the wallet already holds');
    // As the review showed it before it was sent.
    assert.deepEqual({ ...listed.view }, { ...signed.view });
    const received = await send.chain.lookupTx(promised.txid);
    assert.ok(received.kind === 'found');
    assert.deepEqual([received.view.direction, received.view.net], ['received', BigInt(FAUCET_SATS)]);
    assert.deepEqual(await send.chain.lookupTx('ab'.repeat(32)), { kind: 'not-found' });

    s.network.mine();
    await send.advance(15_000);
    assert.deepEqual(send.chain.view().history?.map((tx) => tx.confirmed), [true, true]);
    assert.deepEqual([send.chain.state()?.confirmed, send.chain.state()?.unconfirmed], [plan.change, 0n]);
    assert.deepEqual(send.chain.view().notice, { id: 3, kind: 'confirmed' });

    // -- lock, then unlock --
    events.screen({ name: 'settings' });
    send.session.lock();
    assert.equal(send.session.view().unlocked, false);
    assert.equal(send.session.revealWords(), null);
    assert.deepEqual(send.chain.view().notice, { id: 4, kind: 'locked' });
    const second: PaymentRequest = { to: next.address, amount: 5_000n, feeRate: 1n };
    assert.equal(send.chain.plan(second).ok, true, 'planning needs no key');
    assert.deepEqual(send.session.sign(second), { ok: false, reason: 'locked' });
    // Looking still costs nothing.
    assert.equal(send.chain.state()?.confirmed, plan.change);
    assert.equal(send.auth.calls.length, 2);

    assert.deepEqual(await send.session.unlock(), { kind: 'unlocked' });
    assert.deepEqual(send.auth.calls.slice(2), [`get ${record.credentialId}`], 'exactly one more prompt, for the stored passkey');
    assert.deepEqual(send.chain.view().notice, { id: 5, kind: 'unlocked' });
    assert.equal(send.session.sign(second).ok, true);
    assert.equal(send.chain.state()?.confirmed, plan.change, 'unlocking read nothing again and changed nothing');

    // -- another tab on the same storage --
    const tab = pageOn(s, { storage: send.storage, auth: send.auth, config });
    assert.deepEqual([tab.session.view().status, tab.session.view().unlocked], ['ready', false], 'the wallet is there, locked');
    assert.deepEqual(tab.session.view().record, record);
    await tab.settle();
    assert.equal(tab.chain.state()?.confirmed, plan.change);
    assert.equal(tab.chain.view().receive?.index, 1, 'the first address has been used: the next one is shown');
    // Create stops there, before any passkey is made.
    assert.deepEqual(await tab.session.createWithPasskey(), { kind: 'exists' });
    assert.deepEqual(await tab.session.createWithWords(), { kind: 'exists' });
    assert.deepEqual(await tab.session.restore(words.join(' ')), { kind: 'exists' });
    assert.deepEqual(send.auth.calls.length, 3);

    // Removed in the first tab: the second one, told by the browser's storage event, is emptied.
    assert.equal(send.session.removeWallet(), 'removed');
    assert.deepEqual([...send.storage.map.keys()], []);
    assert.deepEqual([send.session.view().status, send.chain.view().chain.state, send.chain.view().receive, send.chain.view().history], ['none', null, null, null]);
    tab.session.storageChanged(RECORD_KEY);
    assert.deepEqual([tab.session.view().status, tab.session.view().record, tab.chain.view().chain.state], ['none', null, null]);
    const quiet = s.network.requests().length;
    await send.advance(120_000);
    await tab.advance(120_000);
    assert.equal(s.network.requests().length, quiet, 'with no wallet, neither tab asks anything');

    // -- restore the same words in a browser that has nothing: scan first --
    events.screen({ name: 'restore' });
    const fresh = pageOn(s, { config });
    let scannedBeforeWrite = -1;
    const scanStart = s.reached('GET', /^\/esplora\/address\/[a-z0-9]+$/);
    fresh.storage.onRecord = () => {
      scannedBeforeWrite = s.reached('GET', /^\/esplora\/address\/[a-z0-9]+$/) - scanStart;
    };
    assert.deepEqual(fresh.session.checkWords(words.join('  ').toUpperCase()), { words, unknown: [], valid: true });
    assert.deepEqual(await fresh.session.restore(words.join(' ')), { kind: 'restored' });
    assert.ok(scannedBeforeWrite >= 40, `the record was written after the scan (${scannedBeforeWrite} addresses read first)`);
    const restored = fresh.session.view().record;
    assert.ok(restored);
    // The same wallet: the same public key, first address and coins. Kept as words now, as the screen warned.
    assert.deepEqual([restored.kind, restored.xpub, restored.firstAddress, restored.fingerprint], ['words', record.xpub, record.firstAddress, record.fingerprint]);
    assert.equal(loadRecord(fresh.storage as Storage) !== null && (fresh.storage.map.get(RECORD_KEY) ?? '').includes(words.join(' ')), true);
    assert.equal(fresh.chain.state()?.confirmed, plan.change, 'the coins are there at once: the scan that found them is not made twice');
    assert.deepEqual(fresh.session.revealWords(), words);
    assert.deepEqual(fresh.auth.calls, [], 'no passkey was needed');
    await fresh.settle();
    assert.equal(fresh.session.sign(second).ok, true, 'and it can spend');

    // -- restore words nobody has used: nothing is written until the reader chooses --
    const unused = newMnemonic();
    const other = pageOn(s, { config });
    assert.deepEqual(await other.session.restore(unused), { kind: 'empty' });
    assert.deepEqual([other.session.view().status, other.session.view().pendingRestore], ['none', true]);
    assert.deepEqual([...other.storage.map.keys()], []);
    other.session.eraseRestored();
    assert.deepEqual([other.session.view().pendingRestore, [...other.storage.map.keys()]], [false, []]);
    assert.equal(other.session.keepRestored(), 'nothing-pending');

    assert.deepEqual(await other.session.restore(unused), { kind: 'empty' });
    assert.equal(other.session.keepRestored(), 'restored');
    assert.deepEqual([other.session.view().status, other.session.view().record?.kind, other.session.view().unlocked], ['ready', 'words', true]);
    assert.equal(accountFromMnemonic(unused).xpub, other.session.view().record?.xpub);
    await other.settle();
    assert.equal(other.chain.state()?.confirmed, 0n);

    // -- what was counted --
    const counted = events.bodies.map((body) => JSON.parse(body) as EventBody);
    assert.deepEqual(counted, [
      { name: 'pageview', path: '/new' },
      { name: 'Passkey', path: '/new', value: 'ok' },
      { name: 'Wallet created', path: '/new', value: 'passkey' },
      { name: 'Words shown', path: '/new', value: 'passkey' },
      { name: 'pageview', path: '/wallet' },
      { name: 'pageview', path: '/wallet/receive' },
      { name: 'Faucet', path: '/wallet/receive', value: 'ok' },
      { name: 'pageview', path: '/wallet/send' },
      { name: 'Unlock', path: '/wallet/send', value: 'same' },
      { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
      { name: 'pageview', path: '/wallet/activity' },
      { name: 'pageview', path: '/wallet/settings' },
      { name: 'Unlock', path: '/wallet/settings', value: 'same' },
      { name: 'Wallet removed', path: '/wallet/settings', value: 'passkey' },
      { name: 'pageview', path: '/restore' },
      { name: 'Restore', path: '/restore', value: 'found' },
      { name: 'Words shown', path: '/restore', value: 'words' },
      { name: 'Restore', path: '/restore', value: 'erased' },
      { name: 'Restore', path: '/restore', value: 'kept' },
    ]);
    // Each is one the Worker takes, and none holds an address, an ID or a wallet fingerprint.
    for (const body of events.bodies) {
      assert.ok(isEventBody(JSON.parse(body)), body);
      const answer = await s.page(API.event, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
      assert.equal(answer.status, 202, body);
    }
    await s.settled();
    assert.deepEqual(s.forwarded, counted);
    const everything = events.bodies.join('\n');
    assert.doesNotMatch(everything, /bcrt1|[0-9a-f]{64}/);
    assert.ok(!everything.includes(record.fingerprint) && !everything.includes(record.credentialId ?? 'none'));

    // Every request of the whole story got an answer the app could use.
    const refused = s.lines.filter((line) => line.status >= 400 && !(line.route === 'esplora_read' && line.status === 404));
    assert.deepEqual(refused, []);
  } finally {
    events.stop();
  }
});

// -- the faucet, when it is not ready ---------------------------------------------------------

test('the faucet is busy, then pays: the page waits and asks again by itself', async () => {
  const s = stack();
  const page = pageOn(s);
  assert.deepEqual(await page.session.createWithWords(), { kind: 'created' });
  page.chain.watch('receive');
  await page.settle();
  const address = page.chain.view().receive?.address;
  assert.ok(address);

  s.network.setFaucet('busy');
  const check = botCheck();
  const phases: string[] = [];
  page.faucet.subscribe(() => phases.push(page.faucet.view().phase));
  let done = false;
  const asking = page.faucet.ask(check.source).then(() => {
    done = true;
  });
  await page.settle();
  assert.deepEqual(page.faucet.view(), { phase: 'waiting', payment: null, failure: 'busy', retryAt: s.clock.ms + 20_000 });
  assert.equal(done, false);
  // The address is frozen while the request runs.
  page.chain.newReceiveAddress();
  assert.equal(page.chain.view().receive?.address, address);
  // A second tap starts nothing.
  void page.faucet.ask(check.source);
  await page.settle();
  assert.equal(s.reached('POST', '/bots/faucet'), 1);

  // Still busy at the next try; free at the one after.
  await page.advance(20_000);
  assert.deepEqual(page.faucet.view(), { phase: 'waiting', payment: null, failure: 'busy', retryAt: s.clock.ms + 20_000 });
  s.network.setFaucet('ok');
  await page.advance(20_000);
  await asking;
  assert.equal(page.faucet.view().payment?.amountSats, FAUCET_SATS);
  assert.deepEqual(check.asked, [false, true, true], 'a fresh token for each new try: the faucet had used the last one up');
  assert.equal(s.botChecks.length, 3);
  assert.equal(s.reached('POST', '/bots/faucet'), 3);

  // The Receive poll, which ran all along, finds the coin at its next look.
  await page.advance(5_000);
  assert.deepEqual(phases, [
    'checking', 'asking', 'waiting',
    'checking', 'asking', 'waiting',
    'checking', 'asking', 'on-its-way', 'arrived',
  ]);
  assert.equal(page.chain.view().receive?.arrived, BigInt(FAUCET_SATS));
  s.network.mine();
  await page.advance(15_000);
  assert.equal(page.faucet.view().phase, 'confirmed');
  // The address may move again.
  page.chain.newReceiveAddress();
  assert.notEqual(page.chain.view().receive?.address, address);
});

test('the faucet refuses in the other ways: refilling, the Worker\'s limit, already paid, a failed bot check, down', async () => {
  const s = stack();
  const page = pageOn(s);
  await page.session.createWithWords();
  page.chain.watch('receive');
  await page.settle();
  const address = page.chain.view().receive?.address;
  assert.ok(address);

  // The Worker's own limit: the same token is used again, and the bot check was never asked.
  s.over.add('faucet');
  let check = botCheck();
  let asking = page.faucet.ask(check.source);
  await page.settle();
  assert.deepEqual(page.faucet.view(), { phase: 'waiting', payment: null, failure: 'limit', retryAt: s.clock.ms + 30_000 });
  assert.deepEqual(s.botChecks, []);
  // Then the faucet is out of coins until its refill confirms.
  s.over.clear();
  s.network.setFaucet('refilling');
  await page.advance(30_000);
  assert.deepEqual(page.faucet.view(), { phase: 'waiting', payment: null, failure: 'refilling', retryAt: s.clock.ms + 30_000 });
  assert.deepEqual(check.asked, [false], 'after "limit" the first token was still good');
  s.network.setFaucet('ok');
  await page.advance(30_000);
  await asking;
  assert.notEqual(page.faucet.view().payment, null);
  assert.deepEqual(check.asked, [false, true]);
  s.network.mine();
  await page.advance(15_000);
  assert.equal(page.faucet.view().phase, 'confirmed');

  // Asked again for the same address: the faucet has paid it today. That is a success with no payment record.
  check = botCheck();
  await page.faucet.ask(check.source);
  assert.deepEqual(page.faucet.view(), { phase: 'confirmed', payment: null, failure: null, retryAt: null });

  // A new address, and a bot check whose tokens the Worker does not pass: one fresh token, one more try, then failed.
  page.chain.newReceiveAddress();
  const before = s.botChecks.length;
  const bad: boolean[] = [];
  await page.faucet.ask(async (fresh) => {
    bad.push(fresh);
    return 'not-the-token';
  });
  assert.deepEqual(page.faucet.view(), { phase: 'failed', payment: null, failure: 'bot_check', retryAt: null });
  assert.deepEqual(bad, [false, true]);
  assert.equal(s.botChecks.length, before + 2);

  // The bots are stopped (the nightly backup does this): failed with "unavailable", at once.
  s.network.setFaucet('down');
  await page.faucet.ask(botCheck().source);
  assert.deepEqual(page.faucet.view(), { phase: 'failed', payment: null, failure: 'unavailable', retryAt: null });

  // After a failure the Receive poll goes on: a coin that arrives all the same turns it into success.
  s.network.setFaucet('ok');
  s.network.fund(page.chain.view().receive?.address ?? '', 7_000n, { confirmed: false });
  await page.advance(5_000);
  assert.deepEqual(page.faucet.view(), { phase: 'arrived', payment: null, failure: null, retryAt: null });
  assert.equal(page.chain.view().receive?.arrived, 7_000n);
});

// -- "waiting for the practice network" ---------------------------------------------------------

test('a payment the network was just given and Esplora does not list yet is "waiting", then found', async () => {
  const s = stack();
  const page = pageOn(s);
  await page.session.createWithWords();
  page.chain.watch('receive');
  await page.settle();
  const address = page.chain.view().receive?.address;
  assert.ok(address);

  // Esplora hears of the faucet's payments a minute late.
  s.network.setEsploraLag(60);
  await page.faucet.ask(botCheck().source);
  const promised = page.faucet.view().payment;
  assert.ok(promised);
  assert.equal(page.faucet.view().phase, 'on-its-way');

  // The transaction screen, opened from the promise: not "not found".
  assert.deepEqual(await page.chain.lookupTx(promised.txid), { kind: 'waiting' });
  // An ID nobody returned is simply not found.
  assert.deepEqual(await page.chain.lookupTx('cd'.repeat(32)), { kind: 'not-found' });
  // The Receive poll looks and finds nothing yet.
  await page.advance(55_000);
  assert.equal(page.faucet.view().phase, 'on-its-way');
  assert.equal(page.chain.state()?.unconfirmed, 0n);
  assert.deepEqual(await page.chain.lookupTx(promised.txid), { kind: 'waiting' });

  // A minute after the promise Esplora lists it: the next look finds the coin, and the transaction.
  await page.advance(5_000);
  assert.equal(page.faucet.view().phase, 'arrived');
  assert.equal(page.chain.state()?.unconfirmed, BigInt(FAUCET_SATS));
  const found = await page.chain.lookupTx(promised.txid);
  assert.ok(found.kind === 'found');
  assert.deepEqual([found.view.direction, found.view.net, found.view.confirmed], ['received', BigInt(FAUCET_SATS), false]);
});

// -- a page that has only just loaded --------------------------------------------------------------

test('a page loaded on a transaction\'s own screen asks at once: the answer waits for the first scan, and knows what is the wallet\'s', async () => {
  const s = stack();
  const page = pageOn(s);
  await page.session.createWithWords();
  page.chain.watch('receive');
  await page.settle();
  const address = page.chain.view().receive?.address;
  assert.ok(address);
  // Coins from the faucet. With the bot check's script in the page, opening the payment is a full page load.
  page.session.beforeBotCheck();
  await page.faucet.ask(botCheck().source);
  const promised = page.faucet.view().payment;
  assert.ok(promised);
  await page.advance(5_000);
  assert.equal(page.faucet.view().phase, 'arrived');

  // The new document, on /wallet/tx/<txid>: its engine starts the wallet's first scan, and the screen asks.
  const next = pageOn(s, { storage: page.storage });
  next.chain.watch('tx');
  const asked = next.chain.lookupTx(promised.txid);
  assert.deepEqual([next.chain.state(), next.chain.view().chain.scanning], [null, true], 'the first scan has only just begun');
  const found = await asked;
  assert.notEqual(next.chain.state(), null, 'the answer came once the scan was done');
  assert.ok(found.kind === 'found');
  assert.deepEqual([found.view.direction, found.view.net, found.view.confirmed], ['received', BigInt(FAUCET_SATS), false]);
  assert.deepEqual(found.view.outputs.filter((output) => output.mine).map((output) => [output.address, output.value]), [[address, BigInt(FAUCET_SATS)]]);
});

// -- a read that is older than what is shown ---------------------------------------------------------

test('a full scan that is under way when a payment goes out does not bring the spent coin back', async () => {
  const s = stack();
  const page = pageOn(s);
  await page.session.createWithWords();
  page.chain.watch('send');
  await page.settle();
  const record = page.session.view().record;
  const address = page.chain.view().receive?.address;
  assert.ok(record && address);
  s.network.fund(address, 80_000n);
  await page.chain.refresh();
  assert.equal(page.chain.state()?.confirmed, 80_000n);
  const pot = await page.chain.potAddress();
  assert.ok(pot.ok);
  const signed = page.session.sign({ to: pot.address, amount: 30_000n, feeRate: 2n });
  assert.ok(signed.ok);
  const change = 80_000n - 30_000n - signed.payment.fee;

  // The reader asks for a refresh. The scan reads the coin, and then its last answers are slow.
  const far = deriveAddress(watchOnlyAccount(record.xpub), 0, 25).address;
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  s.slow.until = (_method, path) => (path === `${API.esplora}/address/${far}` ? gate : null);
  const refreshed = page.chain.refresh();
  for (let turn = 0; turn < 30; turn++) await flush();
  assert.equal(page.chain.view().chain.scanning, true);
  assert.ok(s.reached('GET', `/esplora/address/${address}/utxo`) >= 2, 'the scan has read the coin, as it was');

  // Meanwhile the payment goes out, and is applied.
  assert.deepEqual(await page.chain.broadcast(signed.payment), { ok: true, txid: signed.payment.txid });
  const applied = page.chain.state();
  assert.deepEqual([applied?.confirmed, applied?.unconfirmed], [0n, change]);
  assert.deepEqual(page.chain.view().notice, { id: 2, kind: 'payment-sent' });

  // The scan lands. What it read is older than what is shown: the wallet is read again instead.
  s.slow.until = null;
  release();
  await refreshed;
  await page.settle();
  const state = page.chain.state();
  assert.deepEqual(state?.coins, applied?.coins);
  assert.deepEqual([state?.confirmed, state?.unconfirmed, page.chain.view().chain.scanning], [0n, change, false]);
  assert.deepEqual(page.chain.view().notice, { id: 2, kind: 'payment-sent' }, 'the coin that was spent did not "arrive"');
  const again = page.chain.plan({ to: pot.address, amount: 10_000n, feeRate: 2n });
  assert.ok(again.ok);
  assert.deepEqual(again.inputs.map((coin) => coin.txid), [signed.payment.txid], 'the next payment spends the change');
});

// -- the practice network fails ------------------------------------------------------------------

test('the origin goes down and comes back: the last coins stay, the page retries by itself, and a refused payment says why', async () => {
  const s = stack();
  const page = pageOn(s);
  await page.session.createWithWords();
  page.chain.watch('wallet');
  await page.settle();
  const address = page.chain.view().receive?.address;
  assert.ok(address);
  s.network.fund(address, 100_000n);
  await page.chain.refresh();
  const state = page.chain.state();
  assert.equal(state?.confirmed, 100_000n);
  const checked = page.chain.view().chain.checkedAt;

  s.network.setOrigin('down');
  await page.advance(15_000);
  assert.deepEqual(
    [page.chain.view().chain.error, page.chain.view().chain.state, page.chain.view().chain.checkedAt, page.chain.view().chain.retryAt],
    ['unavailable', state, checked, s.clock.ms + 15_000],
  );
  assert.deepEqual(await page.chain.potAddress(), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await page.chain.lookupTx('ab'.repeat(32)), { kind: 'failed', reason: 'unavailable' });
  const request: PaymentRequest = { to: address, amount: 30_000n, feeRate: 2n };
  const signed = page.session.sign(request);
  assert.ok(signed.ok, 'signing needs no network');
  assert.deepEqual(await page.chain.broadcast(signed.payment), { ok: false, reason: 'unavailable', detail: null });
  assert.equal(page.chain.state(), state, 'nothing was applied');

  s.network.setOrigin('ok');
  await page.advance(15_000);
  assert.deepEqual([page.chain.view().chain.error, page.chain.view().chain.retryAt, page.chain.view().chain.checkedAt], [null, null, s.clock.ms]);

  // The payment that could not be sent goes through now. Sent a second time once it is in a block, it is
  // "already sent" to the node, and the page reads that as what it is: sent.
  assert.deepEqual(await page.chain.broadcast(signed.payment), { ok: true, txid: signed.payment.txid });
  await page.settle();
  s.network.mine();
  await page.advance(15_000);
  assert.deepEqual(await page.chain.broadcast(signed.payment), { ok: true, txid: signed.payment.txid });

  // Two payments made from the same coin, handed in one straight after the other. The first is sent.
  // The second is not the first: it waits its turn and gets the node's answer for itself, a refusal
  // with the node's own words for the details line. (It is never told "sent", with the first one's ID.)
  await page.settle();
  const stale = page.session.sign({ to: address, amount: 1_000n, feeRate: 1n });
  assert.ok(stale.ok);
  const competing = page.session.sign({ to: address, amount: 2_000n, feeRate: 1n });
  assert.ok(competing.ok);
  const posted = s.reached('POST', '/esplora/tx');
  const [first, answer] = await Promise.all([page.chain.broadcast(stale.payment), page.chain.broadcast(competing.payment)]);
  assert.deepEqual(first, { ok: true, txid: stale.payment.txid });
  assert.equal(s.reached('POST', '/esplora/tx'), posted + 2, 'both went to the node');
  assert.equal(answer.ok, false);
  assert.ok(!answer.ok && answer.reason === 'coin_spent' && /insufficient fee|missingorspent/.test(answer.detail ?? ''), JSON.stringify(answer));
  await page.settle();
});
