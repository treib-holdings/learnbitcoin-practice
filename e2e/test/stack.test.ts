// The seams between the parts, tested with the real parts on both sides.
//
// Each package has tests of its own, and each of those puts a fake on the far
// side of its seam: the app's client is tested against answers typed into the
// test, the Worker's handler against an origin made of fakes. A fake agrees
// with whoever wrote it. Here nothing between the app and the chain is a fake:
//
//   the app's own client        app/src/lib/api.ts, config.ts and events.ts
//     -> the Worker's handler   makeHandler, as it is deployed
//     -> its way to the origin  makeOrigin, as it is deployed
//     -> the stand-in network   makeFakeOrigin, answering in this process
//
// and the wallet package scans, plans, signs and reads history on top of
// that, the way the app will use it.
//
// What stands in for the Worker's surroundings is what the local server will
// put there too: a bot check that passes one known token, rate limiters that
// never refuse (unless a test tells one to) and a recorder in place of the
// events service. Nothing here opens a socket.
//
// A few tests put a fault of their own on the way from the Worker to the origin
// (a wrong token for the bots, a body that arrives in pieces, something in
// between that answers for Esplora, or for the older pages of a long list
// alone, or that refuses the unspent coins of an address that holds too
// many). Each says so where it does.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bech32, bech32m } from '@scure/base';
import { Address, Transaction } from '@scure/btc-signer';
import {
  ADDRESS_PATTERN,
  API,
  DETAIL_MAX,
  ERROR_STATUS,
  TXID_PATTERN,
  type AppConfig,
  type BroadcastRefusal,
  type ErrorCode,
  type EventBody,
} from '@learnbitcoin/practice-contract';
import {
  Esplora,
  EsploraError,
  RBF_SEQUENCE,
  REGTEST,
  accountFromMnemonic,
  addressScript,
  applyPayment,
  checkAddress,
  deriveAddress,
  ownAddresses,
  planPayment,
  privateKeyAt,
  refreshWallet,
  scanWallet,
  signPayment,
  viewPayment,
  viewTx,
  walletHistory,
  watchOnlyAccount,
  type Coin,
  type FetchLike,
  type PaymentRequest,
  type WalletState,
} from '@learnbitcoin/practice-wallet';
import {
  POT_STATS_KEEP_MS,
  POT_STATS_PAUSE_MS,
  configFromEnv,
  makeBotCheck,
  makeForwardEvent,
  makeHandler,
  makeOrigin,
  makePotStatsHolder,
  type ConfigVars,
  type Deps,
  type EventMeta,
  type Fault,
  type Handler,
  type Limiter,
  type Limits,
  type LogLine,
  type RouteName,
} from '@learnbitcoin/practice-worker';
import { ApiError, api as readyMadeApi, broadcastFailure, failureOf, makeApi } from '../../app/src/lib/api.ts';
import { DEFAULT_CONFIG, loadConfig } from '../../app/src/lib/config.ts';
import { initEvents, track, trackPage } from '../../app/src/lib/events.ts';
import { faucetWidgetOptions } from '../../app/src/lib/turnstile.ts';
import { costOf, wranglerConfig } from '../../worker/test/fakes.ts';
import { makeFakeOrigin, type FakeOriginOptions } from '../src/fake-origin.ts';

// -- the stack ----------------------------------------------------------------

/** The app's own address, as the handler sees it in a request. A name that can never resolve. */
const APP = 'https://practice.test';
/** The origin's address. The stand-in ignores the host, and nothing is sent anywhere. */
const ORIGIN = 'https://origin.test';
/** A fixed moment. The tests supply the clock, so the real one is never read. */
const START_MS = 1_800_000_000_000;
/** What the stand-in's faucet pays, and what the Worker's settings say it pays. */
const FAUCET_SATS = 50_000;
/** The token Cloudflare's test widget hands out. The bot check here passes it and fails every other. */
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const BROWSER = 'stack-test browser';

/**
 * The Worker's settings for a local run. Every value differs from the one the
 * app carries built in, so a setting that did not cross would show.
 */
const LOCAL_VARS: ConfigVars = {
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA', // Cloudflare's published test key
  EXPLORER_URL: 'https://explorer.test/',
  ELECTRUM_HOST: 'electrum.test',
  ELECTRUM_PORT: '60002',
  PLAUSIBLE_DOMAIN: 'practice.test',
  SITE_URL: 'https://site.test',
  SOURCE_URL: 'https://source.test/practice',
  PASSKEY_HOST: 'localhost',
  FAUCET_SATS: String(FAUCET_SATS),
  BLOCK_SECONDS: '10',
  // Switched on, where a deploy ships with it off: the tests of the pot's counts below run the route.
  POT_COUNTS: 'on',
};

/** The same settings as the app must read them. Typed out, not computed: a key that the two sides spell differently shows here. */
const LOCAL_CONFIG: AppConfig = {
  turnstileSiteKey: '1x00000000000000000000AA',
  explorerUrl: 'https://explorer.test',
  electrumHost: 'electrum.test',
  electrumPort: 60002,
  siteUrl: 'https://site.test',
  sourceUrl: 'https://source.test/practice',
  passkeyHost: 'localhost',
  faucetSats: FAUCET_SATS,
  blockSeconds: 10,
  events: true,
  potCounts: true,
};

/**
 * Who a request comes from, as told by headers that a browser adds and a
 * page cannot change:
 *   page   one of the app's own pages. fetch() names the page's origin on
 *          every POST and says "same-origin" on every request.
 *   bare   something that is not a browser (a script, curl): neither header.
 *   other  a page of another site.
 */
type Sender = 'page' | 'bare' | 'other';

/** A fetch that hands each request to the Worker's handler, dressed as that sender's browser would dress it. */
function fetchFrom(handler: Handler, sender: Sender): FetchLike {
  return async (input, init = {}) => {
    const headers = new Headers(init.headers);
    const method = (init.method ?? 'GET').toUpperCase();
    headers.set('User-Agent', BROWSER);
    if (sender === 'page') {
      headers.set('Sec-Fetch-Site', 'same-origin');
      if (method !== 'GET') headers.set('Origin', APP);
    } else if (sender === 'other') {
      headers.set('Sec-Fetch-Site', 'cross-site');
      headers.set('Origin', 'https://elsewhere.test');
    }
    // The app asks by path alone ("/api/config"). A browser reads that against the page's own address.
    return handler(new Request(new URL(input, APP), { ...init, headers }));
  };
}

interface StackOptions {
  network?: FakeOriginOptions;
  /** How long the Worker waits for the origin, in ms. Default: as deployed (8 s, and 25 s for the faucet). */
  timeoutMs?: number;
  /** The token the Worker sends the bots. Default: the one the stand-in's bots ask for. */
  botsToken?: string;
  /** What carries the Worker's requests to the origin. Default: nothing stands in between. */
  transport?: (send: FetchLike) => FetchLike;
  /**
   * What the limiter for chain reads lets a count go up to, counted the way
   * Cloudflare's limiter counts (worker/test/fakes.ts, countingLimiter, has
   * the rule): a call passes while the count for its key is below this, and
   * then adds its weight. Default: no such limit, and the limiter never
   * refuses by itself.
   */
  chainBudget?: number;
  /** Other surroundings for the Worker than the local ones. */
  deps?: Partial<Pick<Deps, 'config' | 'botCheck' | 'forwardEvent'>>;
}

function stack(options: StackOptions = {}) {
  const clock = { ms: START_MS };
  const network = makeFakeOrigin({ clock: () => clock.ms, faucetSats: FAUCET_SATS, ...options.network });
  const lines: LogLine[] = [];
  const pending: Promise<unknown>[] = [];
  const forwarded: { event: EventBody; meta: EventMeta }[] = [];
  const botChecks: { token: string; address: string }[] = [];
  /** The limiters a test has told to refuse. */
  const over = new Set<keyof Limits>();
  /**
   * Every call to a limiter, in order: which limiter, what the call counted for (its weight, or
   * 1 when it named none), and the count it went to when that is not the reader's main one (the
   * word the Worker added to the reader's key, as in "older-pages").
   */
  const counted: { limiter: keyof Limits; cost: number; apart: string }[] = [];
  /** How far each count of the limiter for chain reads has got, by key, when the stack was given a budget. */
  const used = new Map<string, number>();
  const limiter = (name: keyof Limits): Limiter => ({
    limit: async (asked) => {
      const cost = costOf(asked);
      counted.push({ limiter: name, cost, apart: asked.key.split(':')[1] ?? '' });
      if (over.has(name)) return { success: false };
      if (name !== 'chain' || options.chainBudget === undefined) return { success: true };
      const count = used.get(asked.key) ?? 0;
      if (count >= options.chainBudget) return { success: false };
      used.set(asked.key, count + cost);
      return { success: true };
    },
  });

  const deps: Deps = {
    config: configFromEnv(LOCAL_VARS),
    origin: makeOrigin({
      url: ORIGIN,
      botsToken: options.botsToken ?? network.token,
      fetch: options.transport ? options.transport(network.fetch) : network.fetch,
      timeoutMs: options.timeoutMs,
      faucetTimeoutMs: options.timeoutMs,
    }),
    botCheck: async (token, address) => {
      botChecks.push({ token, address });
      return { verdict: token === DUMMY_TOKEN ? 'pass' : 'fail', upstream: 200, fault: null };
    },
    forwardEvent: async (event, meta) => {
      forwarded.push({ event, meta });
      return { ok: true, upstream: 202, fault: null };
    },
    limits: {
      chain: limiter('chain'),
      broadcast: limiter('broadcast'),
      faucet: limiter('faucet'),
      pot: limiter('pot'),
      events: limiter('events'),
    },
    // One Worker, started once: its holder of the pot's counts lives as long as the stack. So the
    // counts are kept as they are when deployed, by the stack's own clock (`clock.ms`), which a
    // test moves by hand: the origin is asked once, and again when the answer is 15 seconds old.
    potStatsHolder: makePotStatsHolder(),
    log: (line) => {
      lines.push(line);
    },
    waitUntil: (promise) => {
      pending.push(promise);
    },
    now: () => clock.ms,
    ...options.deps,
  };
  const answer = makeHandler(deps);
  /** Requests the handler has not answered yet. */
  const open = new Set<Promise<Response>>();
  let handled = 0;
  const handler: Handler = (request) => {
    handled += 1;
    const answered = answer(request);
    open.add(answered);
    const done = () => open.delete(answered);
    answered.then(done, done);
    return answered;
  };
  const page = fetchFrom(handler, 'page');
  return {
    network,
    clock,
    handler,
    /** fetch, as one of the app's own pages has it. */
    page,
    /** The app's client on that fetch. */
    api: makeApi(page),
    lines,
    /** How many requests the handler has been given. Not every one leaves a log line: a chain read that goes well leaves none. */
    handled: () => handled,
    forwarded,
    botChecks,
    over,
    counted,
    /** How far the counts of the limiter for chain reads have got, all of them added up. */
    chainUsed: () => [...used.values()].reduce((sum, count) => sum + count, 0),
    /** Waits for what the handler left to finish after its answers (an event on its way on). */
    settled: () => Promise.all(pending.splice(0)),
    /**
     * Waits until every request has its answer. A scan asks about ten
     * addresses at once and gives up at the first failure; the other nine
     * are answered, and logged, a moment after it has.
     */
    idle: async () => {
      while (open.size > 0) await Promise.allSettled([...open]);
    },
    /** How many requests of one kind have reached the origin. */
    reached: (method: string, path: string) =>
      network.requests().filter((request) => request.method === method && request.path === path).length,
  };
}

type Stack = ReturnType<typeof stack>;

/** A log line. The clock stands still while a request is answered, so every line says 0 ms. */
function line(route: RouteName, status: number, upstream: number | null = null, fault: Fault | null = null): LogLine {
  return { route, status, upstream, ms: 0, fault };
}

/** Runs a call that must fail and hands back what it threw. */
async function thrownBy(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (e) {
    return e;
  }
  assert.fail('the call did not throw');
}

const JSON_POST = { method: 'POST', headers: { 'Content-Type': 'application/json' } } as const;

// -- a wallet -------------------------------------------------------------------

const account = accountFromMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
/** What the app holds while a passkey wallet is locked: the account's public key and nothing else. */
const watch = watchOnlyAccount(account.xpub);
const receive = (index: number) => deriveAddress(watch, 0, index);
const change = (index: number) => deriveAddress(watch, 1, index);
/** An address of some other wallet (wallet/test/vectors.json, the passkey vector's first address). */
const SOMEONE = 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6';
/** A segwit address of a later version than 0, from its version and its program. */
const segwit = (version: number, program: Uint8Array) => bech32m.encode(REGTEST.bech32, [version, ...bech32m.toWords(program)]);
/** Pay-to-anchor: an output anyone can spend. Its address stands for a script of only 4 bytes, the shortest there is. */
const ANCHOR = segwit(1, Uint8Array.of(0x4e, 0x73));
/** The bytes of a transaction without its witnesses, from the two figures Esplora reports: a byte outside the witnesses weighs 4, one inside 1. */
const strippedSize = (tx: { size: number; weight: number }) => (tx.weight - tx.size) / 3;

/**
 * A transaction made by hand, with none of the wallet's checks: one of the
 * wallet's coins in, any outputs out. This is how the payments that the node
 * refuses are made; the wallet itself will not build them. `signAs` signs
 * with the key of another receive address than the coin's own.
 */
function handMade(coin: Coin, outputs: { address: string; amount: bigint }[], signAs?: number): { hex: string; txid: string } {
  const index = signAs ?? coin.index;
  const chain = signAs === undefined ? coin.chain : 0;
  const tx = new Transaction({ allowUnknownOutputs: true });
  tx.addInput({
    txid: coin.txid,
    index: coin.vout,
    witnessUtxo: { script: deriveAddress(watch, chain, index).script, amount: coin.value },
    sequence: RBF_SEQUENCE,
  });
  for (const output of outputs) tx.addOutput({ script: addressScript(output.address), amount: output.amount });
  tx.signIdx(privateKeyAt(account.key, chain, index), 0);
  tx.finalize();
  return { hex: tx.hex, txid: tx.id };
}

/**
 * What the stand-in's node says to a transaction it refuses, asked directly.
 * A refusal changes nothing on the chain, so the same transaction can then be
 * sent through the whole stack and must come back with these words.
 */
async function nodeSays(s: Stack, hex: string): Promise<string> {
  const response = await s.network.fetch(`${ORIGIN}/esplora/tx`, { method: 'POST', body: hex });
  const text = await response.text();
  assert.equal(response.status, 400, text);
  return (JSON.parse(text.slice(text.indexOf('{'))) as { message: string }).message;
}

/** Sends a transaction the node refuses through the app's client, and checks what the app is told. */
async function refusedAs(s: Stack, hex: string, code: BroadcastRefusal, words: RegExp): Promise<void> {
  const message = await nodeSays(s, hex);
  assert.match(message, words);
  assert.ok(message.length <= DETAIL_MAX, 'short enough for the Worker to pass on uncut (a longer one has a test of its own)');
  const e = await thrownBy(() => s.api.esplora.broadcast(hex));
  assert.ok(e instanceof EsploraError, code);
  assert.equal(e.status, ERROR_STATUS[code]);
  assert.equal(failureOf(e), code);
  // The code for the screen's own sentence, and the node's words for its details line.
  assert.deepEqual(broadcastFailure(e), { reason: code, detail: message });
  assert.deepEqual(s.lines.at(-1), line('esplora_broadcast', 400, 400));
}

// -- config ---------------------------------------------------------------------

test('config: every setting crosses from the Worker to the app, numbers as numbers', async () => {
  const s = stack();
  const { config, loaded } = await loadConfig(s.page);
  assert.deepEqual(config, LOCAL_CONFIG);
  // The Worker answered: these are its settings, and the app is told so.
  assert.equal(loaded, true);
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[]) {
    assert.notEqual(config[key], DEFAULT_CONFIG[key], `${key} must differ from the built-in value, or this proves nothing`);
  }
  // The settings are the Worker's own: the origin is not asked, and they are there when it is down.
  s.network.setOrigin('down');
  assert.deepEqual(await loadConfig(s.page), { config: LOCAL_CONFIG, loaded: true });
  assert.deepEqual(s.network.requests(), []);
  assert.deepEqual(s.lines, [line('config', 200), line('config', 200)]);
});

test('as shipped: the settings built into the app are the ones in wrangler.jsonc, with no secrets set the faucet is closed, and the pot\'s counts are neither asked for nor answered', async () => {
  // The Worker's parts wired as worker/src/index.ts wires them, from the settings a deploy of
  // this repository carries. No secret is set, as in a checkout.
  const vars = wranglerConfig().vars as Record<string, string>;
  const config = configFromEnv(vars as unknown as ConfigVars);
  let verifyAsked = 0;
  const verify: FetchLike = async () => {
    verifyAsked += 1;
    throw new Error('the verify service should not be asked');
  };
  const eventsSent: string[] = [];
  const eventsService: FetchLike = async (_url, init) => {
    eventsSent.push(String(init?.body));
    return new Response(null, { status: 202 });
  };
  const s = stack({
    deps: {
      config,
      botCheck: makeBotCheck({ siteKey: config.turnstileSiteKey, secret: '', hostname: vars.TURNSTILE_HOSTNAME ?? '', fetch: verify }),
      forwardEvent: makeForwardEvent({ domain: vars.PLAUSIBLE_DOMAIN ?? '', appUrl: APP, props: false, fetch: eventsService }),
    },
  });

  // Two settings are the owner's to fill in: the bot check's site key and the events domain. The
  // app carries them empty and off. Every other value it carries is the one the Worker answers,
  // so the app is right from its first moment, before the Worker has answered at all.
  const shipped = (await loadConfig(s.page)).config;
  assert.deepEqual({ ...shipped, turnstileSiteKey: '', events: false }, { ...DEFAULT_CONFIG });
  assert.equal(shipped.turnstileSiteKey, (vars.TURNSTILE_SITE_KEY ?? '').trim());
  assert.equal(shipped.events, (vars.PLAUSIBLE_DOMAIN ?? '').trim() !== '');

  // The pot's counts are switched off as shipped, and the app carries them off: the two agree from the
  // first moment, so a page of this app never asks for them. Asked for all the same, by the app's own
  // client or by hand, they are a path the Worker does not know: the answer of any unknown path, with no
  // limiter counted and the practice network left alone.
  assert.equal(vars.POT_COUNTS, 'off');
  assert.equal(shipped.potCounts, false);
  assert.equal(DEFAULT_CONFIG.potCounts, false);
  s.lines.length = 0;
  const asking = await thrownBy(() => s.api.potStats());
  assert.ok(asking instanceof ApiError);
  assert.equal(asking.status, 404);
  const byHand = await fetchFrom(s.handler, 'bare')(API.potStats);
  const unknown = await fetchFrom(s.handler, 'bare')('/api/pot/statz');
  assert.deepEqual([byHand.status, [...byHand.headers], await byHand.text()], [unknown.status, [...unknown.headers], await unknown.text()]);
  assert.equal(byHand.status, 404);
  assert.deepEqual(s.lines.splice(0), [line('unknown', 404), line('unknown', 404), line('unknown', 404)]);
  assert.deepEqual(s.counted, [], 'no limiter was asked');
  assert.deepEqual(s.network.requests(), [], 'and the practice network heard nothing');

  // The faucet is closed, with or without a site key, until the bot check has its secret.
  // The app has a word of its own for that, and nobody outside is asked.
  const e = await thrownBy(() => s.api.askFaucet(receive(0).address, DUMMY_TOKEN));
  assert.ok(e instanceof ApiError);
  assert.equal(e.status, 503);
  assert.equal(failureOf(e), 'closed');
  assert.equal(verifyAsked, 0);
  assert.deepEqual(s.network.requests(), []);

  // An event is always thanked. It travels on only when a domain is set, which is also what the app was told.
  const answer = await s.page(API.event, { ...JSON_POST, body: JSON.stringify({ name: 'pageview', path: '/' }) });
  assert.equal(answer.status, 202);
  await s.settled();
  assert.equal(eventsSent.length, shipped.events ? 1 : 0);
});

// -- the chain, read ---------------------------------------------------------------

test('a full scan of a funded wallet, with the public key alone', async () => {
  const s = stack();
  const funded = [
    s.network.fund(receive(0).address, 100_000n),
    s.network.fund(receive(2).address, 25_000n),
    s.network.fund(change(0).address, 40_000n, { confirmed: false }),
  ];
  assert.equal(await s.api.esplora.tipHeight(), s.network.height());

  const state = await scanWallet(watch, s.api.esplora);
  assert.equal(state.confirmed, 125_000n);
  assert.equal(state.unconfirmed, 40_000n);
  assert.equal(state.nextReceiveIndex, 3);
  assert.equal(state.nextChangeIndex, 1);
  assert.deepEqual(state.receive.filter((address) => address.used).map((address) => address.index), [0, 2]);
  assert.deepEqual(state.coins.map((coin) => coin.txid).sort(), [...funded].sort());

  // The Worker adds nothing and loses nothing: the scan is the one the wallet gets from the origin itself.
  assert.deepEqual(state, await scanWallet(watch, new Esplora(`${ORIGIN}/esplora`, s.network.fetch)));

  // A light refresh finds the same coins and sees no reason for another scan.
  const refreshed = await refreshWallet(watch, s.api.esplora, state);
  assert.equal(refreshed.rescan, false);
  assert.deepEqual(refreshed.state, state);

  // History: the waiting payment first, then the newest block first. All three were paid to the wallet.
  const history = await walletHistory(state, s.api.esplora);
  assert.deepEqual(history.map((tx) => [tx.direction, tx.net, tx.confirmed]), [
    ['received', 40_000n, false],
    ['received', 25_000n, true],
    ['received', 100_000n, true],
  ]);

  // Every one of these requests went through the handler, and not one left a log line. The URL
  // of a chain read holds an address or a transaction ID, and a log service can keep the URL
  // beside the line. So a read that went well writes nothing at all.
  assert.ok(s.handled() > 60, 'a full scan asks about at least 20 unused addresses on each chain');
  assert.deepEqual(s.lines, []);
});

test('a transaction the chain index has not heard of yet is "not found", and found a moment later', async () => {
  const s = stack();
  const me = receive(0).address;
  s.network.setEsploraLag(5);
  const payment = await s.api.askFaucet(me, DUMMY_TOKEN);

  const e = await thrownBy(() => s.api.esplora.tx(payment.txid));
  assert.ok(e instanceof EsploraError);
  assert.equal(e.status, 404);
  assert.equal(failureOf(e), 'not_found');
  assert.equal((await s.api.esplora.address(me)).mempool_stats.tx_count, 0);

  s.clock.ms += 5_000;
  assert.equal((await s.api.esplora.tx(payment.txid)).txid, payment.txid);
  assert.equal((await s.api.esplora.address(me)).mempool_stats.tx_count, 1);

  // "Not found" is an answer about the chain and nobody's fault. Like a read that went well, it
  // leaves no log line: the faucet's is the only one there is.
  assert.deepEqual(s.lines, [line('faucet', 200, 200)]);
});

test('the edges of the allowlist: what the wallet can ask or pay that the Worker does not carry', async () => {
  const s = stack();
  const funding = s.network.fund(receive(0).address, 100_000n);
  const state = await scanWallet(watch, s.api.esplora);
  const before = s.network.requests().length;
  const notFound = async (call: () => Promise<unknown>) => {
    const e = await thrownBy(call);
    assert.ok(e instanceof EsploraError);
    assert.equal(e.status, 404);
    assert.equal(failureOf(e), 'not_found');
  };

  // The wallet's Esplora client knows two calls that the Worker has no route for.
  await notFound(() => s.api.esplora.txHex(funding));
  await notFound(() => s.api.esplora.feeEstimates());

  // The wallet calls an old-style test-network address a practice address, and it is one.
  // The Worker's pattern knows bcrt1 addresses only, so such an address cannot be looked up ...
  const legacy = Address(REGTEST).encode({ type: 'pkh', hash: receive(7).script.subarray(2) });
  assert.equal(checkAddress(legacy).kind, 'practice');
  assert.doesNotMatch(legacy, ADDRESS_PATTERN);
  await notFound(() => s.api.esplora.address(legacy));
  assert.equal(s.network.requests().length, before, 'none of these reached the origin');

  // ... but it can be paid: a payment travels as a transaction, and is looked up by its ID.
  const payment = signPayment(account.key, state, { to: legacy, amount: 20_000n, feeRate: 2n });
  assert.equal(await s.api.esplora.broadcast(payment.hex), payment.txid);
  const seen = viewTx(await s.api.esplora.tx(payment.txid), ownAddresses(state));
  assert.deepEqual(seen, viewPayment(payment, ownAddresses(state)));
  assert.ok(seen.outputs.some((output) => output.address === legacy && output.value === 20_000n && !output.mine));

  // Text that has the looks of an address and is none: one character of a real one changed, so
  // that its checksum no longer fits. The chain answers such text with a 400. The Worker checks
  // an address in full before it asks, so the chain never hears of this one: it is "not found",
  // like any path the Worker does not carry. (The wallet never asks about an address it did not derive.)
  const broken = `${receive(0).address.slice(0, -1)}${receive(0).address.endsWith('q') ? 'p' : 'q'}`;
  assert.match(broken, ADDRESS_PATTERN);
  assert.equal((await s.network.fetch(`${ORIGIN}/esplora/address/${broken}`)).status, 400, 'what the chain says, asked directly');
  const reached = s.network.requests().length;
  await notFound(() => s.api.esplora.address(broken));
  await notFound(() => s.api.esplora.addressUtxos(broken));
  await notFound(() => s.api.esplora.addressTxs(broken));
  assert.equal(s.network.requests().length, reached, 'the Worker did not ask the chain');

  // Of everything above, one request left a line in the log: the broadcast. No read did, whether
  // it was answered or turned away. (Had the broken address reached the chain, its 400 would
  // stand in the log as a fault of ours, and anyone could write such lines at will.)
  assert.deepEqual(s.lines, [line('esplora_broadcast', 200, 200)]);
});

test('a chain read leaves a log line only when something is broken', async () => {
  const s = stack();
  const me = receive(0).address;
  const funding = s.network.fund(me, 100_000n);
  const broken = `${me.slice(0, -1)}${me.endsWith('q') ? 'p' : 'q'}`;
  const ask = (path: string, init?: RequestInit) => s.page(`${API.esplora}${path}`, init);

  // Every chain read the app makes, each answered well.
  const reads = [
    () => s.api.esplora.tipHeight(),
    () => s.api.esplora.address(me),
    () => s.api.esplora.addressUtxos(me),
    () => s.api.esplora.addressTxs(me),
    // The two shapes by which a list longer than one page is read to its end.
    () => s.api.esplora.addressTxsChain(me),
    () => s.api.esplora.addressTxsChain(me, funding),
    () => s.api.esplora.tx(funding),
  ];
  for (const read of reads) await read();

  // Turned away, and nobody's fault. The URL of each of these can hold an address or an ID just the same.
  const turnedAway: [what: string, status: number, code: ErrorCode, request: () => Promise<Response>][] = [
    ['a transaction the chain does not know', 404, 'not_found', () => ask(`/tx/${'ab'.repeat(32)}`)],
    ['a wrong method', 405, 'method', () => ask(`/address/${me}`, { method: 'POST' })],
    ['a shape the Worker does not carry', 404, 'not_found', () => ask(`/tx/${funding}/hex`)],
    ['another such shape', 404, 'not_found', () => ask(`/address/${me}/txs/mempool`)],
    ['a paging shape with something after the ID', 404, 'not_found', () => ask(`/address/${me}/txs/chain/${funding}/`)],
    ['a paging shape with a query string', 404, 'not_found', () => ask(`/address/${me}/txs/chain?max_txs=100`)],
    ['a query string', 404, 'not_found', () => ask(`/address/${me}?after=${funding}`)],
    ['text that is no address', 404, 'not_found', () => ask(`/address/${broken}/utxo`)],
  ];
  for (const [what, status, code, request] of turnedAway) {
    const answer = await request();
    assert.equal(answer.status, status, what);
    assert.deepEqual(await answer.json(), { error: code }, what);
  }
  // A reader who asks too fast is turned away as well.
  s.over.add('chain');
  for (const read of reads) assert.equal(failureOf(await thrownBy(read)), 'limit');
  s.over.delete('chain');

  assert.equal(s.handled(), reads.length + turnedAway.length + reads.length);
  assert.deepEqual(s.lines, [], 'not one of these requests left a line');

  // Broken: the origin is down. Now each read leaves its line, and the line says what kind of
  // request failed and whose fault it is, and still nothing of what was asked for.
  s.network.setOrigin('down');
  for (const read of reads) assert.equal(failureOf(await thrownBy(read)), 'unavailable');
  assert.deepEqual(s.lines, reads.map(() => line('esplora_read', 502, 502, 'origin_down')));
  assert.doesNotMatch(JSON.stringify(s.lines), /bcrt1|[0-9a-f]{64}/);
  // What the Worker turns away by itself never gets as far as the fault, and stays silent.
  assert.equal((await ask(`/tx/${funding}/hex`)).status, 404);
  assert.equal(s.lines.length, reads.length);

  // Mended, the reads are silent again.
  s.network.setOrigin('ok');
  s.lines.length = 0;
  for (const read of reads) await read();
  assert.deepEqual(s.lines, []);

  // Broken in another way: something on the way to Esplora has lost it, and answers every
  // question with a "not found" page of its own. That is not the chain saying it does not know a
  // transaction, so the app is not told "not found". It is told "unavailable", and the log says
  // origin_shape. Every "unavailable" has such a code: with none, a failure like this one would
  // leave no line, and nobody would hear of it.
  const lost = stack({
    transport: () => async () => new Response('<html><h1>404 Not Found</h1></html>', { status: 404, headers: { 'Content-Type': 'text/html' } }),
  });
  const lostReads = [() => lost.api.esplora.tx(funding), () => lost.api.esplora.address(me), () => lost.api.esplora.tipHeight()];
  for (const read of lostReads) {
    const e = await thrownBy(read);
    assert.ok(e instanceof EsploraError);
    assert.equal(e.status, 502);
    assert.equal(failureOf(e), 'unavailable');
  }
  assert.deepEqual(lost.lines, lostReads.map(() => line('esplora_read', 502, 404, 'origin_shape')));

  // Every other route writes its line for every request, whatever the answer: none of their URLs
  // holds anything about a wallet. A broadcast is one of them, though it travels under /api/esplora/:
  // its URL is the same for everyone, and the transaction is in its body.
  assert.deepEqual(await loadConfig(s.page), { config: LOCAL_CONFIG, loaded: true });
  assert.equal(broadcastFailure(await thrownBy(() => s.api.esplora.broadcast('00'))).reason, 'refused');
  assert.equal((await ask('/tx')).status, 405);
  assert.equal(failureOf(await thrownBy(() => s.api.askFaucet(me, 'some-other-token'))), 'bot_check');
  assert.match(await s.api.potAddress(), ADDRESS_PATTERN);
  assert.equal((await s.page(API.event, { ...JSON_POST, body: JSON.stringify({ name: 'pageview', path: '/' }) })).status, 202);
  await s.settled();
  assert.equal((await s.page('/api/nothing')).status, 404);
  assert.deepEqual(s.lines, [
    line('config', 200),
    line('esplora_broadcast', 400, 400),
    line('esplora_broadcast', 405),
    line('faucet', 403, 200),
    line('pot_address', 200, 200),
    line('event', 202, 202),
    line('unknown', 404),
  ]);
});

test('an address read reaches the chain for every address there is, and for no other text', async (t) => {
  const s = stack();
  // Numbers that look random and are the same in every run.
  let seed = 20261114;
  const below = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 2 ** 32) * n);
  };
  const bytes = (length: number) => Uint8Array.from({ length }, () => below(256));
  /** The 32 characters an address is written in after "bcrt1". */
  const CHARACTERS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

  // Every kind of bcrt1 address there is: version 0 with a program of 20 or 32 bytes, and
  // versions 1 to 16 with one of 2 to 40. Version 0 has the first kind of checksum (bech32),
  // every later version the second (bech32m).
  const good = [20, 32].map((length) => bech32.encode(REGTEST.bech32, [0, ...bech32.toWords(bytes(length))]));
  for (let version = 1; version <= 16; version++) {
    for (let length = 2; length <= 40; length++) good.push(segwit(version, bytes(length)));
  }

  // And text that only looks like one.
  const bad: string[] = [];
  for (const address of good) {
    // One character changed, anywhere after "bcrt1".
    const at = 5 + below(address.length - 5);
    const other = CHARACTERS[(CHARACTERS.indexOf(address[at]!) + 1 + below(31)) % 32]!;
    bad.push(`${address.slice(0, at)}${other}${address.slice(at + 1)}`);
  }
  for (let length = 2; length <= 40; length++) {
    // Version 0 with a program that is neither a key hash nor a script hash.
    if (length !== 20 && length !== 32) bad.push(bech32.encode(REGTEST.bech32, [0, ...bech32.toWords(bytes(length))]));
    // The right version and program under the wrong kind of checksum.
    bad.push(bech32m.encode(REGTEST.bech32, [0, ...bech32m.toWords(bytes(length))]));
    bad.push(bech32.encode(REGTEST.bech32, [1 + below(16), ...bech32.toWords(bytes(length))]));
    // A version that does not exist: the character has room for numbers up to 31, and versions end at 16.
    bad.push(segwit(17 + below(15), bytes(length)));
  }
  // Characters with no checksum at all.
  for (let n = 0; n < 300; n++) bad.push(`bcrt1${Array.from({ length: 11 + below(61) }, () => CHARACTERS[below(32)]).join('')}`);

  // And text that may be either: any characters, with a good checksum put after them. It is an
  // address when the characters come to whole bytes, 2 to 40 of them, and leave no bit set at the end.
  const either = Array.from({ length: 600 }, () =>
    bech32m.encode(REGTEST.bech32, [1 + below(16), ...Array.from({ length: 4 + below(61) }, () => below(32))]),
  );

  const counts = { good: [0, 0], bad: [0, 0], either: [0, 0] };
  for (const [kind, texts] of Object.entries({ good, bad, either }) as [keyof typeof counts, string[]][]) {
    for (const text of texts) {
      assert.match(text, ADDRESS_PATTERN, 'it has the looks of an address, so the pattern alone lets it by');
      // What the chain itself says of this text, asked directly: 200 for an address, 400 for anything else.
      const chain = await s.network.fetch(`${ORIGIN}/esplora/address/${text}`);
      const before = s.network.requests().length;
      const answer = await s.page(`${API.esplora}/address/${text}`);
      if (chain.status === 200) {
        // An address: the Worker asks the chain, and passes its answer on as it came.
        assert.equal(answer.status, 200, text);
        assert.equal(await answer.text(), await chain.text(), text);
        assert.equal(s.network.requests().length, before + 1, text);
        counts[kind][0]! += 1;
      } else {
        // Not an address: the Worker says so itself, and the chain is not asked.
        assert.equal(chain.status, 400, text);
        assert.equal(answer.status, 404, text);
        assert.deepEqual(await answer.json(), { error: 'not_found' }, text);
        assert.equal(s.network.requests().length, before, text);
        counts[kind][1]! += 1;
      }
    }
  }
  // The two sides agree on every text, and they are written apart: the Worker checks an address by
  // hand (worker/src/handler.ts), the chain here with the wallet's reader. Were the Worker to let
  // by what the chain refuses, the chain's 400 would be logged as a fault. No line was written.
  assert.deepEqual(s.lines, []);
  assert.deepEqual([counts.good, counts.bad], [[good.length, 0], [0, bad.length]], 'every address was passed on, and nothing made to be wrong was');
  assert.ok(counts.either[0]! > 50 && counts.either[1]! > 50, 'the texts that may be either were some of each');
  t.diagnostic(`passed on: ${good.length} addresses and ${counts.either[0]} texts that turned out to be one; turned away: ${bad.length + counts.either[1]!}`);
});

// -- a long history ---------------------------------------------------------------

test('a long history: an address that took part in 60 transactions shows all 60, and in 130 all 130, read page by page through the Worker', async () => {
  const s = stack();
  const me = receive(0).address;
  /** Everything the address was paid, oldest first. */
  const paid: string[] = [];
  const pay = (count: number): void => {
    for (let n = 0; n < count; n++) paid.push(s.network.fund(me, 1_000n, { confirmed: false }));
  };
  /** What the Worker asked the origin about this address's transactions since `from`, as the part of each path after the address. */
  const asked = (from: number): string[] =>
    s.network
      .requests()
      .slice(from)
      .map((request) => request.path)
      .filter((path) => path.startsWith(`/esplora/address/${me}/txs`))
      .map((path) => path.slice(`/esplora/address/${me}`.length));
  /** The wallet's history, read through the app's client and the Worker, and checked against what was paid. */
  const read = async (waiting: number) => {
    const state = await scanWallet(watch, s.api.esplora);
    assert.equal(state.coins.length, paid.length);
    assert.deepEqual(state.receive.filter((address) => address.used).map((address) => address.index), [0], 'one address holds it all');
    const from = s.network.requests().length;
    const history = await walletHistory(state, s.api.esplora);
    const pages = asked(from);

    assert.equal(history.length, paid.length, `all ${paid.length}`);
    assert.equal(new Set(history.map((tx) => tx.txid)).size, paid.length, 'each one once');
    assert.deepEqual(new Set(history.map((tx) => tx.txid)), new Set(paid));
    assert.ok(history.every((tx) => tx.direction === 'received' && tx.net === 1_000n));
    // Newest first: the ones that wait, then the ones in blocks from the tip down.
    const confirmed = paid.slice(0, paid.length - waiting).reverse();
    assert.ok(history.slice(0, waiting).every((tx) => !tx.confirmed));
    assert.deepEqual(new Set(history.slice(0, waiting).map((tx) => tx.txid)), new Set(paid.slice(paid.length - waiting)));
    assert.ok(history.slice(waiting).every((tx) => tx.confirmed));
    const heights = history.slice(waiting).map((tx) => tx.height ?? 0);
    assert.deepEqual(heights, [...heights].sort((x, y) => y - x), 'from the tip down');
    // The Worker adds nothing and loses nothing: this is the history the wallet reads from the origin itself.
    assert.deepEqual(history, await walletHistory(state, new Esplora(`${ORIGIN}/esplora`, s.network.fetch)));
    return { pages, confirmed };
  };

  // 60, as the practice network was measured with: 30 in a block, 30 that wait. Esplora lists 50
  // at once (the 30 that wait, then the newest 20 of the block). The other 10 are on a second
  // page, asked for by the last confirmed transaction of the first: the 20th newest in the block.
  pay(30);
  s.network.mine();
  pay(30);
  const first = await read(30);
  assert.deepEqual(first.pages, ['/txs', `/txs/chain/${first.confirmed[19]}`]);
  // With the first page alone, as the wallet read history before, 10 of the 60 would be missing.
  assert.equal((await s.api.esplora.addressTxs(me)).length, 50);

  // The same 60, all in blocks: 50, then 10.
  s.network.mine();
  const settled = await read(0);
  assert.deepEqual(settled.pages, ['/txs', `/txs/chain/${settled.confirmed[49]}`]);

  // 130: 100 in blocks, 30 that wait. 50, then three full pages of 25, then the last 5.
  pay(40);
  s.network.mine();
  pay(30);
  const many = await read(30);
  assert.equal(paid.length, 130);
  assert.deepEqual(many.pages, [
    '/txs',
    `/txs/chain/${many.confirmed[19]}`,
    `/txs/chain/${many.confirmed[44]}`,
    `/txs/chain/${many.confirmed[69]}`,
    `/txs/chain/${many.confirmed[94]}`,
  ]);
  // How the limiter for chain reads was told to count that history. The first page counts as
  // one read, like every other read. Each older page asked for by an ID counts as 50 (the
  // Worker's OLDER_PAGE_COST), in a count of its own: four of the 120 such pages a reader may
  // ask for in a minute.
  const cost = (from: number) => s.counted.slice(from).map((call) => `${call.limiter} ${call.cost}${call.apart === '' ? '' : ` ${call.apart}`}`);
  const before = s.counted.length;
  await walletHistory(await scanWallet(watch, s.api.esplora), s.api.esplora);
  const forHistory = cost(before).slice(-5);
  assert.deepEqual(forHistory, ['chain 1', 'chain 50 older-pages', 'chain 50 older-pages', 'chain 50 older-pages', 'chain 50 older-pages']);
  // Everything before those five was the scan, and each of its reads counted as one.
  assert.ok(cost(before).length > 40);
  assert.deepEqual(new Set(cost(before).slice(0, -5)), new Set(['chain 1']));
  // The newest 25 confirmed ones, asked for with no ID, count as one read too.
  const plain = s.counted.length;
  await s.api.esplora.addressTxsChain(me);
  assert.deepEqual(cost(plain), ['chain 1']);

  // A page crosses the Worker byte for byte, like every chain read.
  for (const tail of ['/txs/chain', `/txs/chain/${many.confirmed[44]}`]) {
    const direct = await s.network.fetch(`${ORIGIN}/esplora/address/${me}${tail}`);
    const through = await s.page(`${API.esplora}/address/${me}${tail}`);
    assert.equal(through.status, 200, tail);
    assert.equal(through.headers.get('Content-Type'), 'application/json; charset=utf-8', tail);
    const body = await through.text();
    assert.equal(body, await direct.text(), tail);
    assert.equal((JSON.parse(body) as unknown[]).length, 25, tail);
  }
  // Past the oldest transaction the list is empty, and so it is after an ID the address does not know.
  assert.deepEqual(await s.api.esplora.addressTxsChain(me, many.confirmed[99]), []);
  assert.deepEqual(await s.api.esplora.addressTxsChain(me, 'ab'.repeat(32)), []);

  // Well over a hundred requests went through the handler for this, each with an address in
  // its URL and some with a transaction ID as well. Not one left a log line.
  assert.ok(s.handled() > 100, `${s.handled()} requests`);
  assert.deepEqual(s.lines, []);

  // The pages count against the reader's budget for chain reads. Over it, the history is not
  // read at all: the wallet is told to wait, never handed a list that stops short.
  const state = await scanWallet(watch, s.api.esplora);
  s.over.add('chain');
  assert.equal(failureOf(await thrownBy(() => walletHistory(state, s.api.esplora))), 'limit');
  s.over.delete('chain');
  assert.deepEqual(s.lines, [], 'asking too fast is nobody\'s fault');
});

test('a long history: when a later page cannot be read, the whole read fails and the log says what kind of request broke', async () => {
  // The fault put here on purpose: something on the way to Esplora answers every request for an
  // older page with an error page of its own. First pages, and everything else, go through.
  const s = stack({
    transport: (send) => async (input, init) =>
      input.includes('/txs/chain')
        ? new Response('<html><h1>502 Bad Gateway</h1></html>', { status: 502, headers: { 'Content-Type': 'text/html' } })
        : send(input, init),
  });
  const me = receive(0).address;
  for (let n = 0; n < 49; n++) s.network.fund(me, 1_000n, { confirmed: false });
  s.network.mine();
  const state = await scanWallet(watch, s.api.esplora);

  // 49 transactions fit the first page, so no older page is asked for and the history is whole.
  assert.equal((await walletHistory(state, s.api.esplora)).length, 49);
  assert.deepEqual(s.lines, []);

  // The 50th fills the page. Now the wallet has to ask whether there are more, and that request breaks.
  s.network.fund(me, 1_000n);
  const later = await scanWallet(watch, s.api.esplora);
  const e = await thrownBy(() => walletHistory(later, s.api.esplora));
  assert.ok(e instanceof EsploraError);
  assert.equal(e.status, 502);
  assert.equal(failureOf(e), 'unavailable');
  // One line: the route, the statuses and the fault. Nothing of the address or the ID the URL held.
  assert.deepEqual(s.lines, [line('esplora_read', 502, 502, 'origin_down')]);
  assert.doesNotMatch(JSON.stringify(s.lines), /bcrt1|[0-9a-f]{64}|chain/);
});

test('a long history: a flood of questions for older pages is held to 120 a minute for one reader, and a wallet still reads the longest list it reads', async () => {
  // What wrangler.jsonc lets the limiter for chain reads count up to, counted the way
  // Cloudflare's limiter counts: for each reader by themselves. Everything below happens inside
  // one minute.
  const budget = (wranglerConfig().ratelimits as Array<{ name: string; simple: { limit: number } }>).find((limiter) => limiter.name === 'CHAIN_LIMIT')?.simple.limit;
  assert.equal(budget, 6000);
  const s = stack({ chainBudget: budget });
  // A wallet with one address that has a long list: 1,100 payments, all in blocks. That is more
  // than the wallet reads of one address's list (1,025).
  const me = receive(0);
  for (let n = 0; n < 1_100; n++) s.network.fund(me.address, 1_000n, { confirmed: false });
  s.network.mine();
  const olderPages = (): number => s.network.requests().filter((request) => request.path.startsWith(`/esplora/address/${me.address}/txs/chain/`)).length;

  // The flood comes from somebody else (a reader at another address, one of those set aside for
  // examples): 6,000 questions about the wallet's address, each for the page after 64 hex
  // characters that are no transaction at all. The Worker can refuse neither on sight: anyone
  // may read any address, and any 64 hex characters could be an ID. Each question that gets
  // through makes Esplora read down the whole list of the address to look for its ID.
  const stranger = { headers: { 'CF-Connecting-IP': '203.0.113.9' } };
  let empty = 0;
  let turnedAway = 0;
  for (let n = 0; n < 6_000; n++) {
    const response = await s.page(`${API.esplora}/address/${me.address}/txs/chain/${n.toString(16).padStart(64, 'e')}`, stranger);
    const body = await response.text();
    if (response.status === 200) {
      assert.equal(body, '[]');
      empty += 1;
    } else {
      assert.equal(response.status, 429);
      assert.deepEqual(JSON.parse(body), { error: 'limit' });
      turnedAway += 1;
    }
  }
  // Each counts as 50 (the Worker's OLDER_PAGE_COST), so 120 of them take the stranger's count
  // of older pages to the limiter's 6,000 for the minute.
  assert.deepEqual([empty, turnedAway], [120, 5_880]);
  assert.equal(olderPages(), 120, 'the origin was asked 120 times, not 6,000');
  assert.equal(s.chainUsed(), 6_000);
  assert.equal(s.counted.length, 6_000);
  assert.ok(s.counted.every((call) => call.limiter === 'chain' && call.cost === 50 && call.apart === 'older-pages'));
  assert.deepEqual(s.lines, [], 'nobody is at fault, and no line is written beside which an address could be kept');
  // That count is apart from the stranger's other chain reads, which are answered as before.
  assert.equal((await s.page(`${API.esplora}/blocks/tip/height`, stranger)).status, 200);
  assert.equal((await s.page(`${API.esplora}/address/${me.address}/txs`, stranger)).status, 200);
  assert.equal(s.chainUsed(), 6_000 + 2);

  // The wallet's own reader has counts of their own, untouched by the stranger. The wallet
  // reads the newest 1,025 of the list and stops (40 answers: the first page and 39 older ones):
  // one ordinary read, and 39 of the 120 older pages a minute.
  const state: WalletState = { receive: [{ ...me, used: true }], change: [], coins: [], nextReceiveIndex: 1, nextChangeIndex: 0, confirmed: 0n, unconfirmed: 0n };
  assert.equal((await walletHistory(state, s.api.esplora)).length, 1_025);
  assert.equal(olderPages(), 120 + 39);
  assert.equal(s.chainUsed(), 6_000 + 2 + 1 + 39 * 50);
  // Three such readings fit into a minute. Left to itself the app reads the history again when
  // the wallet's coins change, which a block every half minute allows twice.
  for (let again = 2; again <= 3; again++) assert.equal((await walletHistory(state, s.api.esplora)).length, 1_025, `reading ${again}`);
  assert.equal(s.chainUsed(), 6_000 + 2 + 3 * (1 + 39 * 50));
  // A fourth is turned away part of the way through, and the wallet is told to wait. It is never
  // handed the part that was read as if that were the whole list.
  assert.equal(failureOf(await thrownBy(() => walletHistory(state, s.api.esplora))), 'limit');
  // Its coins and its total are other reads, and those go on being answered: 1,100 coins here.
  // (The practice network itself is expected to refuse a list of that many unspent coins: the
  // next test. The stand-in lists any number.)
  const scanned = await scanWallet(watch, s.api.esplora);
  assert.deepEqual([scanned.coins.length, scanned.confirmed], [1_100, 1_100_000n]);
  assert.deepEqual(s.lines, []);
});

test('an address that is refused its list of unspent coins: the scan fails as a whole and the log names a fault, while the past payments still read', async () => {
  // The fault put here on purpose. By the Esplora server's source, the list of unspent coins
  // of an address that holds more than 500 of them in blocks is refused whole: a 400, in plain
  // text, with these words. That was read, not measured on the practice network, and the
  // stand-in lists any number of coins. So something on the way to it does the refusing here.
  const words = 'Too many unspent transaction outputs (>500). Contact support to raise limits.';
  const s = stack({
    transport: (send) => async (input, init) => {
      const response = await send(input, init);
      if (!input.endsWith('/utxo') || response.status !== 200) return response;
      const body = await response.text();
      const inBlocks = (JSON.parse(body) as { status: { confirmed: boolean } }[]).filter((coin) => coin.status.confirmed).length;
      return inBlocks > 500
        ? new Response(words, { status: 400, headers: { 'Content-Type': 'text/plain' } })
        : new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const me = receive(0).address;
  const other = receive(1).address;
  s.network.fund(other, 70_000n);
  for (let n = 0; n < 500; n++) s.network.fund(me, 1_000n, { confirmed: false });
  s.network.mine();

  // 500 coins at one address, and one at another: the wallet finds all 501, and its total.
  const state = await scanWallet(watch, s.api.esplora);
  assert.deepEqual([state.coins.length, state.confirmed], [501, 570_000n]);
  assert.deepEqual(s.lines, []);

  // One payment more to the first address, and its list is refused. A long list of past payments
  // only stops short. This list has no pages to stop short at: the scan fails as a whole, and
  // the wallet has no coins and no total to show, not even the coin at its other address.
  s.network.fund(me, 1_000n);
  const e = await thrownBy(() => scanWallet(watch, s.api.esplora));
  assert.ok(e instanceof EsploraError);
  assert.equal(e.status, 502);
  assert.equal(failureOf(e), 'unavailable');
  assert.ok(!e.message.includes('unspent'), 'the server\'s words stay on the Worker\'s side');
  await s.idle();
  // To the Worker, a 400 for an address it has checked itself is an answer it cannot make sense
  // of: a fault, logged for the owner, with nothing of the address in the line.
  assert.deepEqual(s.lines, [line('esplora_read', 502, 400, 'origin_shape')]);
  assert.doesNotMatch(JSON.stringify(s.lines), /bcrt1|[0-9a-f]{64}|unspent/);
  // The lighter look the app takes between scans asks for the same list, and fails the same way.
  assert.equal(failureOf(await thrownBy(() => refreshWallet(watch, s.api.esplora, state))), 'unavailable');
  await s.idle();
  assert.deepEqual(s.lines, [line('esplora_read', 502, 400, 'origin_shape'), line('esplora_read', 502, 400, 'origin_shape')]);

  // The past payments are another list, and it still reads: all 501 of that address page by
  // page (the first 50, 18 pages of 25 and a last page of one), and the one of the other address.
  s.lines.length = 0;
  const from = s.network.requests().length;
  const history = await walletHistory(state, s.api.esplora);
  assert.equal(history.length, 502);
  assert.equal(s.network.requests().slice(from).filter((request) => request.path.startsWith(`/esplora/address/${me}/txs`)).length, 20);
  assert.deepEqual(s.lines, []);
});

// -- a payment --------------------------------------------------------------------

test('a payment: planned without keys, signed, broadcast, applied and confirmed', async () => {
  const s = stack();
  s.network.fund(receive(0).address, 100_000n);
  const before = await scanWallet(watch, s.api.esplora);
  const request: PaymentRequest = { to: SOMEONE, amount: 60_000n, feeRate: 2n };

  // The plan needs no key. Signing makes exactly the planned payment.
  const plan = planPayment(watch, before, request);
  assert.ok(plan.ok);
  const payment = signPayment(account.key, before, request);
  assert.deepEqual([payment.fee, payment.vsize], [plan.fee, plan.vsize]);
  assert.equal(plan.change, 100_000n - 60_000n - plan.fee);
  const review = viewPayment(payment, ownAddresses(before));

  // Broadcast: the answer is the transaction's ID, as plain text.
  assert.equal(await s.api.esplora.broadcast(payment.hex), payment.txid);
  assert.deepEqual(s.lines.at(-1), line('esplora_broadcast', 200, 200));
  assert.equal(s.reached('POST', '/esplora/tx'), 1);

  // Applied at once, the wallet already holds what the network reports a moment later.
  const applied = applyPayment(before, payment);
  const refreshed = await refreshWallet(watch, s.api.esplora, applied);
  assert.equal(refreshed.rescan, false);
  assert.deepEqual(refreshed.state, applied);
  assert.deepEqual([applied.confirmed, applied.unconfirmed], [0n, plan.change]);

  // The network shows the payment as the review showed it before it was sent.
  const waiting = await s.api.esplora.tx(payment.txid);
  assert.deepEqual(waiting.status, { confirmed: false });
  assert.deepEqual(viewTx(waiting, ownAddresses(applied)), review);
  assert.deepEqual([review.direction, review.net], ['sent', -(60_000n + plan.fee)]);

  // Sent again while it waits: accepted again, with the same ID.
  assert.equal(await s.api.esplora.broadcast(payment.hex), payment.txid);

  // In a block.
  const height = s.network.mine();
  const confirmed = await s.api.esplora.tx(payment.txid);
  assert.equal(confirmed.status.confirmed, true);
  assert.equal(confirmed.status.block_height, height);
  const after = await refreshWallet(watch, s.api.esplora, applied);
  assert.deepEqual([after.state.confirmed, after.state.unconfirmed, after.rescan], [plan.change, 0n, false]);
  const history = await walletHistory(after.state, s.api.esplora);
  assert.deepEqual(history.map((tx) => [tx.direction, tx.net, tx.height]), [
    ['sent', -(60_000n + plan.fee), height],
    ['received', 100_000n, height - 1],
  ]);

  // Sent again once it is in a block: the node refuses, and the app has a word for that.
  await refusedAs(s, payment.hex, 'already_sent', /^Transaction outputs already in utxo set$/);
});

test('send all: every spendable coin goes, the recipient gets the planned amount to the sat, and nothing is left', async () => {
  const s = stack();
  s.network.fund(receive(0).address, 100_000n);
  s.network.fund(receive(1).address, 30_000n);
  s.network.fund(change(0).address, 7_000n, { confirmed: false }); // the wallet's own change, still waiting: spendable
  s.network.fund(receive(2).address, 9_000n, { confirmed: false }); // somebody's payment, still waiting: not spendable
  const state = await scanWallet(watch, s.api.esplora);
  const request: PaymentRequest = { to: SOMEONE, amount: 'all', feeRate: 3n };

  const plan = planPayment(watch, state, request);
  assert.ok(plan.ok);
  assert.equal(plan.inputs.length, 3);
  assert.deepEqual([plan.amount, plan.change, plan.amount + plan.fee], [plan.maxSendable, null, 137_000n]);
  const payment = signPayment(account.key, state, request);
  assert.equal(await s.api.esplora.broadcast(payment.hex), payment.txid);

  // The node took it at the fee the reader was shown, and the rate is the one asked for.
  const sent = await s.api.esplora.tx(payment.txid);
  assert.equal(BigInt(sent.fee), plan.fee);
  assert.equal(Math.ceil(sent.weight / 4), payment.vsize);
  assert.ok(payment.feeRate >= 3 && payment.feeRate < 4, `${payment.feeRate} sat/vB`);

  // Only the payment that was not spendable is left, and the network says the same.
  const applied = applyPayment(state, payment);
  assert.deepEqual([applied.confirmed, applied.unconfirmed], [0n, 9_000n]);
  const refreshed = await refreshWallet(watch, s.api.esplora, applied);
  assert.deepEqual(refreshed.state.coins, applied.coins);
  s.network.mine();
  const { status } = await s.api.esplora.tx(payment.txid);
  assert.equal(status.confirmed, true);
  assert.deepEqual(await s.api.esplora.addressUtxos(SOMEONE), [{ txid: payment.txid, vout: 0, status, value: Number(plan.amount) }]);
});

test('the smallest payment the wallet will plan to each kind of address is one the node takes', async () => {
  const s = stack();
  s.network.fund(receive(0).address, 100_000n);
  let state = await scanWallet(watch, s.api.esplora);
  const filled = (length: number) => new Uint8Array(length).fill(7);
  const address = Address(REGTEST);
  // The wallet's rule (wallet/src/address.ts) and the node's (here the stand-in's, e2e/src/fake-chain.ts)
  // are written apart. The limits themselves: 294 and 330 were measured on the live node, the others
  // follow from Bitcoin Core's formula.
  const kinds: [kind: string, to: string, limit: bigint][] = [
    ['P2WPKH', SOMEONE, 294n],
    ['P2WSH', address.encode({ type: 'wsh', hash: filled(32) }), 330n],
    ['taproot', segwit(1, filled(32)), 330n],
    ['P2PKH', address.encode({ type: 'pkh', hash: filled(20) }), 546n],
    ['P2SH', address.encode({ type: 'sh', hash: filled(20) }), 540n],
    ['a later witness version', segwit(2, filled(20)), 294n],
    ['pay-to-anchor', ANCHOR, 240n],
  ];
  for (const [kind, to, limit] of kinds) {
    assert.equal(checkAddress(to).kind, 'practice', kind);
    // One sat under: the wallet says no before any key is touched, and names the limit.
    const under = planPayment(watch, state, { to, amount: limit - 1n, feeRate: 2n });
    assert.deepEqual([under.ok, under.ok ? null : under.reason, under.ok ? null : under.dust], [false, 'below-dust', limit], kind);
    // At the limit: planned, signed, and taken by the node.
    const payment = signPayment(account.key, state, { to, amount: limit, feeRate: 2n });
    assert.equal(await s.api.esplora.broadcast(payment.hex), payment.txid, kind);
    state = applyPayment(state, payment);
    // The network shows the output where the review put it, to the address the reader typed.
    const seen = viewTx(await s.api.esplora.tx(payment.txid), ownAddresses(state));
    assert.ok(seen.outputs.some((output) => output.address === to && output.value === limit && !output.mine), kind);
  }
  const refreshed = await refreshWallet(watch, s.api.esplora, state);
  assert.deepEqual(refreshed.state.coins, state.coins);
});

test('what the wallet will not plan with the coins in hand: a fee rate under 1, and a payment too small in bytes for the node', async () => {
  const s = stack();
  s.network.fund(receive(0).address, 100_000n);
  let state = await scanWallet(watch, s.api.esplora);
  const [coin] = state.coins;
  assert.ok(coin);

  // A fee rate under 1 sat/vB. A form can hand over a 0, so the plan answers with a reason and
  // does not throw. It names no figure for the most that can be sent: there is no rate to work one out from.
  const free: PaymentRequest = { to: SOMEONE, amount: 20_000n, feeRate: 0n };
  assert.deepEqual(planPayment(watch, state, free), { ok: false, reason: 'bad-fee', maxSendable: 0n, dust: null });
  assert.throws(() => signPayment(account.key, state, free), /at least 1 sat\/vB/);
  // The limit is the wallet's own, which is why its sentence never says the network refuses the
  // rate. The node relays from a tenth of it: a payment made by hand at half a sat per vbyte gets in.
  const cheap = handMade(coin, [{ address: change(0).address, amount: coin.value - 55n }]);
  assert.equal(await s.api.esplora.broadcast(cheap.hex), cheap.txid);
  const relayed = await s.api.esplora.tx(cheap.txid);
  assert.deepEqual([relayed.fee, Math.ceil(relayed.weight / 4)], [55, 110]);
  s.network.mine();
  state = await scanWallet(watch, s.api.esplora);
  const [only] = state.coins;
  assert.ok(only);
  assert.deepEqual([state.coins.length, only.value], [1, coin.value - 55n]);

  // A transaction too small to relay. One coin paid in full to a pay-to-anchor address, with no
  // change, comes to 64 bytes without its witnesses, and the node relays nothing under 65. The
  // address is a good one and the coin is enough, so this has a reason of its own.
  assert.equal(checkAddress(ANCHOR).kind, 'practice');
  const tooSmall = { ok: false, reason: 'too-small', maxSendable: 0n, dust: null };
  const inFull: PaymentRequest = { to: ANCHOR, amount: 'all', feeRate: 2n };
  assert.deepEqual(planPayment(watch, state, inFull), tooSmall);
  assert.throws(() => signPayment(account.key, state, inFull), /too small to relay/);
  // An amount that leaves less than change is worth makes the same transaction.
  assert.deepEqual(planPayment(watch, state, { ...inFull, amount: only.value - 400n }), tooSmall);
  // The wallet is right to stop there. Made by hand, that payment is one the node refuses, and
  // all the app could then show is "refused", with the node's words in a details line.
  await refusedAs(s, handMade(only, [{ address: ANCHOR, amount: only.value - 200n }]).hex, 'refused', /^tx-size-small$/);

  // The way out the app's sentence gives: a smaller amount, so that change comes back. With two
  // outputs the same coin pays the same address, in a transaction of 95 bytes.
  const smaller: PaymentRequest = { ...inFull, amount: 50_000n };
  const plan = planPayment(watch, state, smaller);
  assert.ok(plan.ok);
  assert.equal(plan.change, only.value - 50_000n - plan.fee);
  const payment = signPayment(account.key, state, smaller);
  assert.equal(await s.api.esplora.broadcast(payment.hex), payment.txid);
  assert.equal(strippedSize(await s.api.esplora.tx(payment.txid)), 95);
  state = applyPayment(state, payment);

  // And one byte is all that was missing. An address that stands for a script of 5 bytes takes a
  // whole coin with no change: 65 bytes, planned by the wallet and taken by the node.
  const whole: PaymentRequest = { to: segwit(1, Uint8Array.of(1, 2, 3)), amount: 'all', feeRate: 2n };
  const sweep = planPayment(watch, state, whole);
  assert.ok(sweep.ok);
  assert.deepEqual([sweep.inputs.length, sweep.change, sweep.amount], [1, null, sweep.maxSendable]);
  const last = signPayment(account.key, state, whole);
  assert.equal(await s.api.esplora.broadcast(last.hex), last.txid);
  assert.equal(strippedSize(await s.api.esplora.tx(last.txid)), 65);
});

test('a refused broadcast: every code the node can cause reaches the app, with the node\'s own words beside it', async () => {
  const s = stack();
  s.network.fund(receive(0).address, 100_000n);
  const state = await scanWallet(watch, s.api.esplora);
  const [coin] = state.coins;
  assert.ok(coin);
  const rest = (spent: bigint) => ({ address: change(0).address, amount: coin.value - spent });

  // dust: an output one sat under the smallest the network relays to that kind of address.
  await refusedAs(s, handMade(coin, [{ address: receive(1).address, amount: 293n }, rest(293n + 400n)]).hex, 'dust', /^dust, /);

  // fee_too_low: 5 sats for a payment of 110 vbytes. The node relays from 0.1 sat/vB.
  await refusedAs(s, handMade(coin, [rest(5n)]).hex, 'fee_too_low', /^min relay fee not met, 5 < 11$/);

  // refused: hex that is no transaction at all. The Worker lets any hex by; the node says what it is.
  await refusedAs(s, '00', 'refused', /^TX decode failed/);

  // coin_spent, first way: a second payment of a coin while the first one still waits, for the same fee.
  const first = signPayment(account.key, state, { to: SOMEONE, amount: 20_000n, feeRate: 2n });
  const second = signPayment(account.key, state, { to: receive(5).address, amount: 20_000n, feeRate: 2n });
  assert.equal(await s.api.esplora.broadcast(first.hex), first.txid);
  await refusedAs(s, second.hex, 'coin_spent', new RegExp(`^insufficient fee, rejecting replacement ${second.txid}, `));

  // coin_spent, second way: the coin is gone for good, spent in a block.
  s.network.mine();
  await refusedAs(s, second.hex, 'coin_spent', /^bad-txns-inputs-missingorspent$/);

  // already_sent: the payment that is in that block, sent once more.
  await refusedAs(s, first.hex, 'already_sent', /^Transaction outputs already in utxo set$/);

  // Six refusals reached the node twice each (once asked directly, once through the stack), and one payment got in.
  assert.equal(s.reached('POST', '/esplora/tx'), 13);
});

test('a refused broadcast whose words are long: the first 300 characters of them reach the app whole', async (t) => {
  const s = stack();
  s.network.fund(receive(0).address, 100_000n);
  const [coin] = (await scanWallet(watch, s.api.esplora)).coins;
  assert.ok(coin);

  // A coin of receive address 0, signed for with the key of receive address 1. The node names the
  // transaction, its second ID and the coin: three IDs of 64 characters, a little over 300 in all.
  const wrongKey = handMade(coin, [{ address: SOMEONE, amount: coin.value - 500n }], 1);
  const message = await nodeSays(s, wrongKey.hex);
  assert.match(message, /^mempool-script-verify-flag-failed \(Script failed an OP_EQUALVERIFY operation\), input 0 of /);
  assert.ok(message.length > DETAIL_MAX, 'longer than the contract lets a detail be');

  const e = await thrownBy(() => s.api.esplora.broadcast(wrongKey.hex));
  assert.ok(e instanceof EsploraError);
  assert.equal(failureOf(e), 'refused');
  // The Worker keeps the first 300 characters of the node's words (the contract's DETAIL_MAX) and
  // wraps them in its refusal. The wallet's Esplora client keeps the first 2,000 characters of a
  // failed answer, which is room for the longest refusal the Worker can write. So the refusal crosses as whole JSON, and the
  // details line gets every one of the 300 characters: nothing has to be pieced together.
  const passedOn = message.slice(0, DETAIL_MAX);
  assert.ok(e.message.endsWith(`: ${JSON.stringify({ error: 'refused', detail: passedOn })}`), 'the refusal crossed whole');
  const { reason, detail } = broadcastFailure(e);
  assert.deepEqual([reason, detail], ['refused', passedOn]);
  assert.equal(detail?.length, 300);
  t.diagnostic(`a node message of ${message.length} characters reaches the app as ${detail?.length}`);
});

test('a payment that spends too many coins at once is "too_large" before the node hears of it, and one coin fewer fits', async (t) => {
  const s = stack();
  // A wallet of 676 small coins: one payment made by hand with 676 outputs, spread over four of
  // the wallet's addresses.
  const COINS = 676;
  s.network.fund(receive(0).address, 700_000n);
  const [funding] = (await scanWallet(watch, s.api.esplora)).coins;
  assert.ok(funding);
  const split = handMade(funding, Array.from({ length: COINS }, (_, n) => ({ address: receive(1 + (n % 4)).address, amount: 1_000n })));
  assert.equal(await s.api.esplora.broadcast(split.hex), split.txid);
  s.network.mine();
  const state = await scanWallet(watch, s.api.esplora);
  assert.deepEqual([state.coins.length, state.confirmed], [COINS, 676_000n]);
  const sent = () => s.reached('POST', '/esplora/tx');
  assert.equal(sent(), 1);

  // "Send all" spends every one of them. The wallet plans it and signs it: nothing is wrong with the payment.
  const everything: PaymentRequest = { to: SOMEONE, amount: 'all', feeRate: 1n };
  const plan = planPayment(watch, state, everything);
  assert.ok(plan.ok);
  assert.equal(plan.inputs.length, COINS);
  const payment = signPayment(account.key, state, everything);
  assert.equal(payment.fee, plan.fee);
  // But each coin spent adds 148 bytes, now and then one fewer (which coin it is, a signature and
  // a public key), and 676 of them come to more than the 100,000 bytes, 200,000 characters of
  // hex, that the Worker takes as one broadcast.
  assert.ok(payment.hex.length > 200_000, `${payment.hex.length} characters of hex`);
  const e = await thrownBy(() => s.api.esplora.broadcast(payment.hex));
  assert.ok(e instanceof EsploraError);
  assert.equal(e.status, ERROR_STATUS.too_large);
  assert.equal(failureOf(e), 'too_large');
  // The one failure on the way to the node that a reader can do something about, so it is not
  // read as "unavailable": the Send screen has a sentence of its own for it.
  assert.deepEqual(broadcastFailure(e), { reason: 'too_large', detail: null });
  assert.deepEqual(s.lines.at(-1), line('esplora_broadcast', 413));
  assert.equal(sent(), 1, 'the node never heard of it');

  // The way out that sentence gives: send less first, then the rest. One coin fewer is little
  // enough. 675 coins fit, and the node takes them.
  const [last, ...most] = state.coins;
  assert.ok(last);
  const first = signPayment(account.key, state, { ...everything, coins: most });
  assert.equal(first.inputs.length, COINS - 1);
  assert.ok(first.hex.length <= 200_000, `${first.hex.length} characters of hex`);
  assert.equal(await s.api.esplora.broadcast(first.hex), first.txid);
  const left = applyPayment(state, first);
  assert.deepEqual(left.coins, [last]);
  const rest = signPayment(account.key, left, everything);
  assert.equal(await s.api.esplora.broadcast(rest.hex), rest.txid);
  assert.equal(sent(), 3);

  // In a block, the recipient holds all the wallet had, less the two fees, and the wallet holds nothing.
  s.network.mine();
  const received = await s.api.esplora.addressUtxos(SOMEONE);
  assert.equal(received.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n), 676_000n - first.fee - rest.fee);
  assert.deepEqual((await scanWallet(watch, s.api.esplora)).coins, []);
  t.diagnostic(`${COINS} coins: ${payment.hex.length} characters of hex; ${COINS - 1} coins: ${first.hex.length}`);
});

test('65 payments in a row, each spending the change of the one before: the 65th has to wait for a block', async () => {
  const s = stack();
  s.network.fund(receive(0).address, 100_000n);
  let state = await scanWallet(watch, s.api.esplora);
  const request: PaymentRequest = { to: SOMEONE, amount: 1_000n, feeRate: 1n };

  const sent: string[] = [];
  for (let n = 1; n <= 64; n++) {
    const payment = signPayment(account.key, state, request);
    assert.equal(await s.api.esplora.broadcast(payment.hex), payment.txid, `payment ${n}`);
    state = applyPayment(state, payment);
    sent.push(payment.txid);
  }
  // What the wallet worked out by itself, 64 payments on, is what the network reports.
  const refreshed = await refreshWallet(watch, s.api.esplora, state);
  assert.deepEqual(refreshed.state.coins, state.coins);
  assert.equal(state.nextChangeIndex, 64);
  // The wallet's list of change addresses still ends where the first scan left it, 20 addresses in,
  // so the refresh asks for a full scan. That scan finds the same coin and the same next address.
  assert.equal(refreshed.rescan, true);
  const scanned = await scanWallet(watch, s.api.esplora);
  assert.deepEqual(scanned.coins, state.coins);
  assert.deepEqual([scanned.nextChangeIndex, scanned.unconfirmed], [64, state.unconfirmed]);
  // History, read from 65 addresses: the newest payment first, the coin they all began with last.
  const history = await walletHistory(scanned, s.api.esplora);
  assert.deepEqual(history.map((tx) => tx.txid).slice(0, 64), [...sent].reverse());
  assert.deepEqual(history.map((tx) => tx.direction), [...sent.map(() => 'sent'), 'received']);

  const last = signPayment(account.key, state, request);
  await refusedAs(s, last.hex, 'refused', /^too-large-cluster$/);

  // The way out the app's sentence gives: wait for the next block, then send it again.
  s.network.mine();
  assert.equal(await s.api.esplora.broadcast(last.hex), last.txid);
});

// -- the faucet and the pot ----------------------------------------------------------

test('the faucet pays: the coin shows at once, cannot be spent yet, and confirms with the next block', async () => {
  const s = stack();
  const me = receive(0).address;
  const payment = await s.api.askFaucet(me, DUMMY_TOKEN);
  assert.match(payment.txid, TXID_PATTERN);
  assert.deepEqual(payment, { txid: payment.txid, amountSats: LOCAL_CONFIG.faucetSats, potTxid: null });

  // The bot check was asked about this token and this address, then the bots were asked once.
  assert.deepEqual(s.botChecks, [{ token: DUMMY_TOKEN, address: me }]);
  assert.deepEqual(s.network.requests(), [{ method: 'POST', path: '/bots/faucet' }]);
  assert.deepEqual(s.lines, [line('faucet', 200, 200)]);

  // The promised payment is on the chain already, waiting for a block.
  const state = await scanWallet(watch, s.api.esplora);
  assert.deepEqual([state.confirmed, state.unconfirmed], [0n, BigInt(payment.amountSats)]);
  const seen = viewTx(await s.api.esplora.tx(payment.txid), ownAddresses(state));
  assert.deepEqual([seen.direction, seen.net, seen.confirmed], ['received', BigInt(payment.amountSats), false]);
  // A coin somebody else sent is not spendable until it is in a block.
  const early = planPayment(watch, state, { to: SOMEONE, amount: 1_000n, feeRate: 2n });
  assert.deepEqual([early.ok, early.ok ? null : early.reason], [false, 'unconfirmed-only']);

  s.network.mine();
  const later = await refreshWallet(watch, s.api.esplora, state);
  assert.deepEqual([later.state.confirmed, later.state.unconfirmed, later.rescan], [BigInt(payment.amountSats), 0n, false]);
  assert.equal(planPayment(watch, later.state, { to: SOMEONE, amount: 1_000n, feeRate: 2n }).ok, true);
});

test('the faucet refuses: each reason reaches the app as its own word', async () => {
  const s = stack();
  const me = receive(0).address;
  const refused = async (address: string, token: string, code: ErrorCode) => {
    const e = await thrownBy(() => s.api.askFaucet(address, token));
    assert.ok(e instanceof ApiError, code);
    assert.equal(e.status, ERROR_STATUS[code], code);
    assert.equal(failureOf(e), code);
    assert.equal(e.detail, null);
  };
  const botsAsked = () => s.reached('POST', '/bots/faucet');

  // Stopped by the Worker, before the bot check or the bots hear of it.
  await refused(me, '', 'bad_request');
  await refused(me, 'x'.repeat(2049), 'bad_request');
  await refused(me, 'x'.repeat(5000), 'too_large');
  await refused('tb1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjpupg53', DUMMY_TOKEN, 'bad_address');
  await refused('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', DUMMY_TOKEN, 'bad_address');
  assert.deepEqual([s.botChecks.length, botsAsked()], [0, 0]);

  // Stopped by the bot check: any token but the known one.
  await refused(me, 'some-other-token', 'bot_check');
  assert.deepEqual([s.botChecks.length, botsAsked()], [1, 0]);
  // The largest request the faucet can be sent in earnest, the longest address there is with the
  // longest token the bot check issues, is well inside the Worker's cap and is looked at like any
  // other. So "too large" is never what a reader is told here: that word belongs to Send alone.
  const longest = segwit(16, new Uint8Array(40).fill(7));
  assert.equal(longest.length, 'bcrt1'.length + 71);
  await refused(longest, 'x'.repeat(2048), 'bot_check');
  assert.deepEqual([s.botChecks.length, botsAsked()], [2, 0]);

  // Refused by the bots, whose own code is passed on.
  const broken = `${me.slice(0, -1)}${me.endsWith('q') ? 'p' : 'q'}`;
  assert.match(broken, ADDRESS_PATTERN);
  await refused(broken, DUMMY_TOKEN, 'bad_address');
  await refused(await s.api.potAddress(), DUMMY_TOKEN, 'own_address');
  s.network.setFaucet('busy');
  await refused(me, DUMMY_TOKEN, 'busy');
  s.network.setFaucet('refilling');
  await refused(me, DUMMY_TOKEN, 'refilling');
  assert.deepEqual(s.lines.at(-1), line('faucet', 503, 503), 'a refill is nobody\'s fault');
  s.network.setFaucet('failed');
  await refused(me, DUMMY_TOKEN, 'failed');
  assert.deepEqual(s.lines.at(-1), line('faucet', 500, 500, 'origin_down'));
  assert.equal(botsAsked(), 5);

  // The bots are stopped altogether (the nightly backup does this): not a refusal of theirs, so "unavailable".
  s.network.setFaucet('down');
  await refused(me, DUMMY_TOKEN, 'unavailable');
  assert.deepEqual(s.lines.at(-1), line('faucet', 502, 502, 'origin_down'));

  // Paid once, the same address is refused for a day.
  s.network.setFaucet('ok');
  assert.equal((await s.api.askFaucet(me, DUMMY_TOKEN)).amountSats, FAUCET_SATS);
  await refused(me, DUMMY_TOKEN, 'already_paid');
  s.clock.ms += 24 * 3600 * 1000;
  assert.equal((await s.api.askFaucet(me, DUMMY_TOKEN)).amountSats, FAUCET_SATS);
});

test('the bots answer, but not with a refusal of the faucet\'s: the app is told "unavailable", and the log says where to look', async () => {
  const me = receive(0).address;
  /** What the bots answered on the way, read off the wire: the status, and the code in their body. */
  const heard: { status: number; code: unknown }[] = [];
  const listening =
    (send: FetchLike): FetchLike =>
    async (input, init) => {
      const response = await send(input, init);
      if (new URL(input).pathname.startsWith('/bots/')) {
        heard.push({ status: response.status, code: ((await response.clone().json()) as { code?: unknown }).code });
      }
      return response;
    };
  const unavailable = async (call: () => Promise<unknown>) => {
    const e = await thrownBy(call);
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 502);
    assert.equal(failureOf(e), 'unavailable');
    assert.equal(e.detail, null);
  };

  // The Worker's token for the bots is not the one they ask for. They answer 401 with a code of
  // their own, "unauthorized". The reader can do nothing about that, and the owner must: origin_auth.
  const locked = stack({ botsToken: 'not-the-bots-token', transport: listening });
  await unavailable(() => locked.api.askFaucet(me, DUMMY_TOKEN));
  await unavailable(() => locked.api.potAddress());
  assert.deepEqual(heard.splice(0), [
    { status: 401, code: 'unauthorized' },
    { status: 401, code: 'unauthorized' },
  ]);
  assert.deepEqual(locked.lines, [line('faucet', 502, 401, 'origin_auth'), line('pot_address', 502, 401, 'origin_auth')]);

  // Something on the way to the bots passes the faucet's request on in pieces, so that it arrives
  // without its length. The bots read no body then, and answer 400 "bad_request". The contract
  // has a code of that name, for a request of the app's that the Worker could not read. This is
  // not one: the app asked well, and the fault lies between the Worker and the bots. So the
  // bots' word is not passed on. The app is told "unavailable", and the log says origin_shape:
  // the origin is up and lets us in, but said something this Worker has no reading for.
  const inPieces = stack({
    transport: (send) =>
      listening((input, init) =>
        send(input, typeof init?.body === 'string' ? ({ ...init, body: new Blob([init.body]).stream(), duplex: 'half' } as RequestInit) : init),
      ),
  });
  await unavailable(() => inPieces.api.askFaucet(me, DUMMY_TOKEN));
  assert.deepEqual(heard.splice(0), [{ status: 400, code: 'bad_request' }]);
  assert.deepEqual(inPieces.lines, [line('faucet', 502, 400, 'origin_shape')]);
  // Nobody was paid, and the pot's address, which is asked for without a body, still comes.
  assert.equal((await inPieces.api.esplora.address(me)).mempool_stats.tx_count, 0);
  assert.match(await inPieces.api.potAddress(), ADDRESS_PATTERN);
  assert.deepEqual(heard, [{ status: 200, code: undefined }]);
});

test('pass it on: the pot address stays until it is paid, and the coin comes back as a newcomer\'s faucet coin', async () => {
  const s = stack();
  s.network.fund(receive(0).address, 100_000n);
  const state = await scanWallet(watch, s.api.esplora);

  const pot = await s.api.potAddress();
  assert.match(pot, ADDRESS_PATTERN);
  assert.equal(await s.api.potAddress(), pot, 'everyone gets the same address until a payment reaches it');
  assert.deepEqual(s.lines.slice(-2), [line('pot_address', 200, 200), line('pot_address', 200, 200)]);
  assert.equal(s.reached('GET', '/bots/pot/address'), 2);

  // The wallet pays the pot. From then on the next asker is given a fresh address.
  const gift = signPayment(account.key, state, { to: pot, amount: 60_000n, feeRate: 2n });
  assert.equal(await s.api.esplora.broadcast(gift.hex), gift.txid);
  const next = await s.api.potAddress();
  assert.notEqual(next, pot);
  assert.match(next, ADDRESS_PATTERN);

  // Once the gift is in a block, the faucet spends it first and says which payment it came from.
  s.network.mine();
  const payment = await s.api.askFaucet(SOMEONE, DUMMY_TOKEN);
  assert.deepEqual(payment, { txid: payment.txid, amountSats: FAUCET_SATS, potTxid: gift.txid });
  const paid = await s.api.esplora.tx(payment.txid);
  assert.ok(paid.vin.some((input) => input.txid === gift.txid), 'the newcomer\'s coin is made from the gift');
});

test('the pot\'s counts: three numbers cross from the bots to the app, written by the Worker, and reading them cannot use up "Pass it on"', async () => {
  const s = stack();
  s.network.fund(receive(0).address, 100_000n);
  const state = await scanWallet(watch, s.api.esplora);
  /** What the bots themselves answer, asked with nothing in between. */
  const bots = async (): Promise<unknown> => (await s.network.fetch(`${ORIGIN}/bots/pot/stats`)).json();
  /** How often the bots have been asked for the counts. Until this test asks them itself, further down, that is how often the Worker has. */
  const asked = (): number => s.reached('GET', '/bots/pot/stats');
  /**
   * For the Worker, 15 seconds pass. It gives every page it serves the bots' last answer until that answer
   * is 15 seconds old (worker/src/pot-stats.ts), so this is how a test gets it to ask the bots again.
   */
  const answerRunsOut = (): void => {
    s.clock.ms += POT_STATS_KEEP_MS;
  };

  // Nobody has passed anything on yet. The app reads that as three zeros, and the request leaves a line.
  assert.deepEqual(await s.api.potStats(), { passedOn: 0, waiting: 0, handedOn: 0 });
  assert.deepEqual(s.lines, [line('pot_stats', 200, 200)]);
  assert.equal(asked(), 1);

  // The wallet pays the pot. The counter counts what is in a block, so nothing moves until one is mined.
  const pot = await s.api.potAddress();
  const gift = signPayment(account.key, state, { to: pot, amount: 60_000n, feeRate: 2n });
  assert.equal(await s.api.esplora.broadcast(gift.hex), gift.txid);
  answerRunsOut();
  assert.deepEqual(await s.api.potStats(), { passedOn: 0, waiting: 0, handedOn: 0 });
  assert.equal(asked(), 2);
  s.network.mine();
  // Asked again at once, the app is given the answer the Worker has: the one from before the block.
  // The bots are not asked. (So a count on a screen can be up to 15 seconds behind the chain.)
  assert.deepEqual(await s.api.potStats(), { passedOn: 0, waiting: 0, handedOn: 0 });
  assert.equal(asked(), 2);
  // Once that answer has run out, the Worker asks, and the payment is counted.
  answerRunsOut();
  assert.deepEqual(await s.api.potStats(), { passedOn: 1, waiting: 1, handedOn: 0 });
  assert.equal(asked(), 3);

  // A newcomer's coin is made from it: none waiting any more, one handed on.
  const payment = await s.api.askFaucet(SOMEONE, DUMMY_TOKEN);
  assert.equal(payment.potTxid, gift.txid);
  answerRunsOut();
  assert.deepEqual(await s.api.potStats(), { passedOn: 1, waiting: 0, handedOn: 1 });
  assert.equal(asked(), 4);

  // The bots say more than that: the sats the pot has received, and how many payments the faucet
  // has made. The Worker writes its own answer from three of the fields, so the page is sent the
  // three counts under the contract's names, and not a byte of the rest. That goes for an answer
  // the Worker had kept as for one it has just been given: this one is kept.
  assert.deepEqual(await bots(), { learners_passed_on: 1, sats_received: 60_000, coins_waiting: 0, coins_passed_to_newcomers: 1, faucet_payments: 1 });
  assert.equal(asked(), 5, 'four questions of the Worker\'s, and this one of the test\'s own');
  const raw = await s.page(API.potStats);
  assert.equal(raw.status, 200);
  assert.match(raw.headers.get('Content-Type') ?? '', /^application\/json\b/);
  assert.equal(raw.headers.get('Cache-Control'), 'no-store', 'kept by the Worker for a moment, and by nothing else');
  assert.equal(raw.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(await raw.text(), '{"passedOn":1,"waiting":0,"handedOn":1}');

  // A plain GET like the other reads: it needs no page of the app's behind it, and takes nothing after its path.
  const bare = await fetchFrom(s.handler, 'bare')(API.potStats);
  assert.deepEqual([bare.status, await bare.json()], [200, { passedOn: 1, waiting: 0, handedOn: 1 }]);
  for (const [path, init, status] of [
    [`${API.potStats}?x=1`, {}, 404],
    [`${API.potStats}/`, {}, 404],
    [API.potStats, { method: 'POST' }, 405],
  ] as const) {
    assert.equal((await s.page(path, init)).status, status, path);
  }
  assert.equal(asked(), 5, 'none of those reached the bots: not the two that were given the kept answer, not the three that were refused');

  // Each reading counts 1 at the pot's limiter, on a count of the reader's own beside the one
  // "Pass it on" uses (as the older pages of a long list have theirs at the chain's limiter). A
  // reading that is given the kept answer is counted like one the bots are asked for.
  const stats = { limiter: 'pot', cost: 1, apart: 'stats' };
  const address = { limiter: 'pot', cost: 1, apart: '' };
  assert.deepEqual(
    s.counted.filter((call) => call.limiter === 'pot'),
    [stats, address, stats, stats, stats, stats, stats, stats],
  );
  // One line for each request, and a line holds a route, two statuses, a time and a fault: none of
  // the counts. The second status is the bots', and there is none where the bots were not asked.
  assert.deepEqual(s.lines, [
    line('pot_stats', 200, 200),
    line('pot_address', 200, 200),
    line('esplora_broadcast', 200, 200),
    line('pot_stats', 200, 200),
    line('pot_stats', 200),
    line('pot_stats', 200, 200),
    line('faucet', 200, 200),
    line('pot_stats', 200, 200),
    line('pot_stats', 200),
    line('pot_stats', 200),
    line('unknown', 404),
    line('unknown', 404),
    line('pot_stats', 405),
  ]);
});

test('the pot\'s counts are asked for once for every page this Worker serves: sixty pages at the same moment, one question to the bots; an answer that failed is not kept, and the bots are left alone for 5 seconds after it', async () => {
  // Something on the way holds the Worker's question to the bots until the test lets it through.
  let through: () => void = () => {};
  let gate: Promise<void> = Promise.resolve();
  const hold = (): void => {
    gate = new Promise((open) => {
      through = open;
    });
  };
  const s = stack({
    transport: (send) => async (input, init) => {
      if (new URL(input).pathname === '/bots/pot/stats') await gate;
      return send(input, init);
    },
  });
  const asked = (): number => s.reached('GET', '/bots/pot/stats');
  /** Waits until `count` requests in all have been counted at the pot's limiter, and have gone as far as they can. */
  const arrived = async (count: number): Promise<void> => {
    for (let turns = 0; s.counted.filter((call) => call.limiter === 'pot').length < count; turns += 1) {
      assert.ok(turns < 10_000, 'not every request reached the limiter');
      await new Promise((turn) => setImmediate(turn));
    }
    await new Promise((turn) => setImmediate(turn));
  };

  // Sixty pages ask at the same moment, and the bots take their time.
  hold();
  const looks = Array.from({ length: 60 }, () => s.api.potStats());
  await arrived(60);
  assert.deepEqual(s.lines, [], 'nobody has an answer yet');
  through();
  for (const each of looks) assert.deepEqual(await each, { passedOn: 0, waiting: 0, handedOn: 0 });
  assert.equal(asked(), 1, 'the bots were asked once for the sixty of them');
  // Each of the sixty was counted, and each wrote its line: all of them waited for the bots' answer.
  assert.equal(s.counted.filter((call) => call.limiter === 'pot' && call.apart === 'stats').length, 60);
  assert.deepEqual(s.lines.splice(0), Array.from({ length: 60 }, () => line('pot_stats', 200, 200)));

  // The answer runs out while the bots are stopped. Twenty pages ask: one question, which fails, and
  // all twenty are told so. No counts are kept of it. For the 5 seconds that follow, a page that asks is
  // told the same at once and the bots are not asked: stopped or slow, they are left alone for that long.
  s.clock.ms += POT_STATS_KEEP_MS;
  s.network.setFaucet('down');
  hold();
  const failing = Array.from({ length: 20 }, () => thrownBy(() => s.api.potStats()));
  await arrived(80);
  through();
  for (const each of failing) assert.equal(failureOf(await each), 'unavailable');
  assert.equal(asked(), 2);
  assert.deepEqual(s.lines.splice(0), Array.from({ length: 20 }, () => line('pot_stats', 502, 502, 'origin_down')));
  for (const later of [0, POT_STATS_PAUSE_MS - 1]) {
    s.clock.ms += later;
    assert.equal(failureOf(await thrownBy(() => s.api.potStats())), 'unavailable');
    assert.equal(asked(), 2, 'not asked in the pause');
  }
  // Each pause over, the next page asks again, and the bots are still stopped.
  for (const again of [3, 4]) {
    s.clock.ms += again === 3 ? 1 : POT_STATS_PAUSE_MS;
    assert.equal(failureOf(await thrownBy(() => s.api.potStats())), 'unavailable');
    assert.equal(asked(), again);
  }
  // The bots are back. Within the pause after the last failure nobody finds out. After it the next page
  // is answered, and that answer is kept for the pages after it.
  s.network.setFaucet('ok');
  assert.equal(failureOf(await thrownBy(() => s.api.potStats())), 'unavailable');
  assert.equal(asked(), 4);
  s.clock.ms += POT_STATS_PAUSE_MS;
  assert.deepEqual(await s.api.potStats(), { passedOn: 0, waiting: 0, handedOn: 0 });
  assert.deepEqual(await s.api.potStats(), { passedOn: 0, waiting: 0, handedOn: 0 });
  assert.equal(asked(), 5);
  // A page that asked the bots, or waited for that question, names their status in its line. A page that
  // was turned away in a pause names none, and the fault of the question that failed.
  assert.deepEqual(s.lines.splice(0), [
    line('pot_stats', 502, null, 'origin_down'),
    line('pot_stats', 502, null, 'origin_down'),
    line('pot_stats', 502, 502, 'origin_down'),
    line('pot_stats', 502, 502, 'origin_down'),
    line('pot_stats', 502, null, 'origin_down'),
    line('pot_stats', 200, 200),
    line('pot_stats', 200),
  ]);
});

test('the pot\'s counts when they cannot be read: the app is told "unavailable" or "limit" and nothing more, and the log says where to look', async () => {
  const failed = async (s: Stack, status: number, reason: string): Promise<void> => {
    const e = await thrownBy(() => s.api.potStats());
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, status);
    assert.equal(failureOf(e), reason);
    assert.equal(e.detail, null);
  };

  /** For the Worker, 5 seconds pass: the pause after a question that failed is over, and the next page's question is asked. */
  const pauseIsOver = (s: Stack): void => {
    s.clock.ms += POT_STATS_PAUSE_MS;
  };

  // The origin is down, sends the Worker to a login page, or forbids it.
  const s = stack();
  for (const { mode, upstream, fault } of [
    { mode: 'down', upstream: 502, fault: 'origin_down' },
    { mode: 'redirect', upstream: 302, fault: 'origin_auth' },
    { mode: 'forbidden', upstream: 403, fault: 'origin_auth' },
  ] as const) {
    s.network.setOrigin(mode);
    await failed(s, 502, 'unavailable');
    assert.deepEqual(s.lines.splice(0), [line('pot_stats', 502, upstream, fault)], mode);
    // Asked again at once, the app is told the same, and the origin is not asked: the line has no status of its.
    const reached = s.network.requests().length;
    await failed(s, 502, 'unavailable');
    assert.equal(s.network.requests().length, reached, mode);
    assert.deepEqual(s.lines.splice(0), [line('pot_stats', 502, null, fault)], mode);
    pauseIsOver(s);
  }
  s.network.setOrigin('ok');
  // The bots alone are stopped, while the chain still answers.
  s.network.setFaucet('down');
  await failed(s, 502, 'unavailable');
  assert.equal(await s.api.esplora.tipHeight(), s.network.height());
  assert.deepEqual(s.lines.splice(0), [line('pot_stats', 502, 502, 'origin_down')]);
  s.network.setFaucet('ok');
  pauseIsOver(s);
  assert.deepEqual(await s.api.potStats(), { passedOn: 0, waiting: 0, handedOn: 0 });

  // The pot's limiter refuses: "limit", and the bots are not asked. The Worker has an answer it
  // could give, the one of a moment ago, and refuses all the same: the reader's count comes first.
  const before = s.reached('GET', '/bots/pot/stats');
  s.over.add('pot');
  s.lines.length = 0;
  await failed(s, 429, 'limit');
  assert.equal(s.reached('GET', '/bots/pot/stats'), before);
  assert.deepEqual(s.lines, [line('pot_stats', 429)]);
  s.over.clear();
  // With the limiter out of the way, that answer is given, and the bots are still not asked.
  assert.deepEqual(await s.api.potStats(), { passedOn: 0, waiting: 0, handedOn: 0 });
  assert.equal(s.reached('GET', '/bots/pot/stats'), before);
  assert.deepEqual(s.lines.splice(0), [line('pot_stats', 429), line('pot_stats', 200)]);

  // An origin that never answers is given up on.
  const slow = stack({ timeoutMs: 40 });
  slow.network.setOrigin('slow');
  await failed(slow, 502, 'unavailable');
  assert.deepEqual(slow.lines, [line('pot_stats', 502, null, 'origin_timeout')]);

  // The Worker's token for the bots is wrong. This question needs none, so it is still answered,
  // while the pot's address, which does need it, is not.
  const locked = stack({ botsToken: 'not-the-bots-token' });
  assert.deepEqual(await locked.api.potStats(), { passedOn: 0, waiting: 0, handedOn: 0 });
  assert.equal(failureOf(await thrownBy(() => locked.api.potAddress())), 'unavailable');
  assert.deepEqual(locked.lines, [line('pot_stats', 200, 200), line('pot_address', 502, 401, 'origin_auth')]);

  // Something on the way answers for the counter with a body that is not the three counts. Each
  // of these is "unavailable" with a fault for the owner: no count is guessed, defaulted or passed on.
  let body = '';
  let status = 200;
  const between = stack({
    transport: (send) => async (input, init) =>
      new URL(input).pathname === '/bots/pot/stats' ? new Response(body, { status, headers: { 'Content-Type': 'application/json' } }) : send(input, init),
  });
  const whole = { learners_passed_on: 4, sats_received: 240_000, coins_waiting: 1, coins_passed_to_newcomers: 3, faucet_payments: 9 };
  const wrong: unknown[] = [
    { ...whole, learners_passed_on: undefined },
    { ...whole, coins_waiting: -1 },
    { ...whole, coins_passed_to_newcomers: 2.5 },
    { ...whole, learners_passed_on: '4' },
    { ...whole, coins_waiting: null },
    { ...whole, coins_passed_to_newcomers: 2 ** 53 },
    { passedOn: 4, waiting: 1, handedOn: 3 },
    [whole],
    null,
    'not the counts',
  ];
  for (const answer of wrong) {
    body = JSON.stringify(answer);
    await failed(between, 502, 'unavailable');
    pauseIsOver(between);
  }
  body = '{"learners_passed_on": 4, "coins_waiting": 1, "coins_passed_to_newcomers": ';
  await failed(between, 502, 'unavailable');
  pauseIsOver(between);
  assert.deepEqual(between.lines.splice(0), [...wrong, 'cut short'].map(() => line('pot_stats', 502, 200, 'origin_shape')));
  // A refusal in the faucet's own words is not passed on either: a count has no refusal a reader could act on.
  body = JSON.stringify({ error: 'The faucet is busy; try again in a minute', code: 'busy' });
  status = 429;
  await failed(between, 502, 'unavailable');
  assert.deepEqual(between.lines.splice(0), [line('pot_stats', 502, 429, 'origin_shape')]);
  // And with the counts as they should be, the same stack answers, once the pause after that failure is over.
  body = JSON.stringify(whole);
  status = 200;
  await failed(between, 502, 'unavailable');
  pauseIsOver(between);
  assert.deepEqual(await between.api.potStats(), { passedOn: 4, waiting: 1, handedOn: 3 });
});

/** The host the app is served on, as the bot check's settings name it. */
const WIDGET_HOST = 'practice.test';

/**
 * Turnstile, played by hand: the widget on a page, and the verify service the
 * Worker asks about a token. A widget that is solved gives a token. Asked
 * about that token, the service says on which host the widget ran, and which
 * action and customer data the page drew it with. Of any other token it says
 * that it is not one.
 */
function turnstile() {
  const solved = new Map<string, { hostname: string; action: unknown; cdata: unknown }>();
  /** Every question the verify service was asked. */
  const asked: unknown[] = [];
  const verify: FetchLike = async (url, init) => {
    const question = JSON.parse(String(init?.body)) as { response: string };
    asked.push({ url, ...question });
    const widget = solved.get(question.response);
    const answer = widget ? { success: true, ...widget, 'error-codes': [] } : { success: false, 'error-codes': ['invalid-input-response'] };
    return new Response(JSON.stringify(answer), { headers: { 'Content-Type': 'application/json' } });
  };
  return {
    asked,
    /** The Worker's real bot check, asking this verify service. */
    botCheck: makeBotCheck({ siteKey: LOCAL_CONFIG.turnstileSiteKey, secret: 'a-secret', hostname: WIDGET_HOST, fetch: verify }),
    /** Solves a widget that a page on `hostname` drew with these options, and gives its token. */
    solve(options: Record<string, unknown>, hostname = WIDGET_HOST): string {
      const token = `solved-${solved.size}`;
      solved.set(token, { hostname, action: options.action, cdata: options.cData });
      return token;
    },
  };
}

/** The widget as the app's own module sets it up for an address. */
const widgetFor = (address: string) => faucetWidgetOptions(LOCAL_CONFIG.turnstileSiteKey, address, 'en', false);

test('the bot check: a token from the widget the app sets up passes the Worker\'s own check, for its address only', async () => {
  const me = receive(0).address;
  const cloudflare = turnstile();
  // The Worker's real bot check in place of the stand-in one.
  const s = stack({ deps: { botCheck: cloudflare.botCheck } });

  // The app and the Worker agree on the action's name and on what the customer data holds: paid.
  assert.equal((await s.api.askFaucet(me, cloudflare.solve(widgetFor(me)))).amountSats, FAUCET_SATS);
  // The verify service was told the secret and the token, and nothing about the reader.
  assert.deepEqual(cloudflare.asked, [
    { url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify', secret: 'a-secret', response: 'solved-0' },
  ]);

  // A token solved for one address does not pay another, and a made-up token pays nobody.
  assert.equal(failureOf(await thrownBy(() => s.api.askFaucet(receive(1).address, cloudflare.solve(widgetFor(me))))), 'bot_check');
  assert.equal(failureOf(await thrownBy(() => s.api.askFaucet(receive(1).address, 'made-up'))), 'bot_check');
  assert.equal(s.reached('POST', '/bots/faucet'), 1);
});

test('the bot check: a token solved for another form or another address is the reader\'s to put right, and one solved on another host is ours', async () => {
  const me = receive(0).address;
  const cloudflare = turnstile();
  const s = stack({ deps: { botCheck: cloudflare.botCheck } });
  const refused = async (token: string, code: ErrorCode) => {
    const e = await thrownBy(() => s.api.askFaucet(me, token));
    assert.ok(e instanceof ApiError, code);
    assert.equal(e.status, ERROR_STATUS[code]);
    assert.equal(failureOf(e), code);
  };

  // Turnstile vouches for each of these tokens: it was solved, on this host. What it was solved
  // for is another matter. The action and the address are whatever the page that drew the widget
  // said they were, and a reader's browser can be made to say anything. So nothing is wrong on
  // our side: the app is told that the bot check did not pass, as for a token that is made up,
  // and the reader can run it again. The log line carries no fault. (A fault that any visitor
  // could cause at will would bury the real ones.)
  const notForThis: [what: string, token: string][] = [
    ['drawn for another form', cloudflare.solve({ ...widgetFor(me), action: 'signup' })],
    ['drawn with no action at all', cloudflare.solve({ ...widgetFor(me), action: undefined })],
    ['solved for another address', cloudflare.solve(widgetFor(receive(1).address))],
    ['never solved', 'made-up'],
  ];
  for (const [what, token] of notForThis) {
    await refused(token, 'bot_check');
    assert.deepEqual(s.lines.at(-1), line('faucet', 403, 200), what);
  }

  // A token solved on another host is ours to look into. Turnstile runs a widget only on the
  // hosts its settings list, so the widget lets in a host this Worker does not expect: the two
  // disagree about where the app lives. Nobody is paid until the owner has looked, and the log says so.
  await refused(cloudflare.solve(widgetFor(me), 'elsewhere.test'), 'unavailable');
  assert.deepEqual(s.lines.at(-1), line('faucet', 502, 200, 'bot_check_config'));
  assert.equal(s.reached('POST', '/bots/faucet'), 0, 'the bots were asked for nothing so far');

  // The check run again on the app's own page, for this address: paid.
  assert.equal((await s.api.askFaucet(me, cloudflare.solve(widgetFor(me)))).amountSats, FAUCET_SATS);
  assert.deepEqual(s.lines.at(-1), line('faucet', 200, 200));
});

// -- events -----------------------------------------------------------------------

test('events: what the app counts reaches the events service, and nothing else gets through', async () => {
  const s = stack();
  const paymentId = s.network.fund(receive(0).address, 10_000n);

  // The app's own module writes the bodies. Strict: an event the contract does not list would throw here.
  const bodies: string[] = [];
  initEvents(true, (body) => bodies.push(body), { strict: true });
  try {
    trackPage({ name: 'home' }, 'en');
    trackPage({ name: 'new' }, 'es');
    track('Wallet created', 'passkey');
    trackPage({ name: 'tx', txid: paymentId }, 'en');
    track('Payment', 'sent-to-pot');
  } finally {
    initEvents(false);
  }
  for (const body of bodies) {
    // Sent as events.ts sends them: a POST of JSON that outlives the page.
    const answer = await s.page(API.event, { ...JSON_POST, body, keepalive: true });
    assert.equal(answer.status, 202);
    assert.equal(await answer.text(), '');
    await s.settled();
  }

  assert.deepEqual(s.forwarded.map(({ event }) => event), [
    { name: 'pageview', path: '/' },
    { name: 'pageview', path: '/es/new' },
    { name: 'Wallet created', path: '/es/new', value: 'passkey' },
    // Every transaction is counted under one path. Its ID never leaves the page.
    { name: 'pageview', path: '/wallet/tx' },
    { name: 'Payment', path: '/wallet/tx', value: 'sent-to-pot' },
  ]);
  assert.doesNotMatch(JSON.stringify(s.forwarded), new RegExp(paymentId));
  // What the events service is told about the reader: the browser's name, and here no address.
  for (const { meta } of s.forwarded) assert.deepEqual(meta, { ip: null, userAgent: BROWSER });
  // One line each, written once the event has gone on.
  assert.deepEqual(s.lines, Array.from({ length: 5 }, () => line('event', 202, 202)));

  // What is not on the contract's lists is refused, and nothing of it travels on.
  const invalid: unknown[] = [
    { name: 'pageview', path: `/wallet/tx/${paymentId}` }, // the address bar's own path
    { name: 'pageview', path: '/', value: 'home' }, // a screen view carries no value
    { name: 'Wallet created', path: '/new' }, // a counted event needs one
    { name: 'Wallet created', path: '/new', value: receive(0).address }, // free text
    { name: 'Payment', path: '/wallet/send', value: 'sent', txid: paymentId }, // an extra key
    { name: 'Clicked', path: '/', value: 'ok' }, // a name nobody listed
    [{ name: 'pageview', path: '/' }],
  ];
  for (const body of invalid) {
    const answer = await s.page(API.event, { ...JSON_POST, body: JSON.stringify(body) });
    assert.equal(answer.status, 400, JSON.stringify(body));
    assert.deepEqual(await answer.json(), { error: 'bad_request' });
  }
  await s.settled();
  assert.equal(s.forwarded.length, 5);
});

test('the ready-made client, loadConfig() and the default event sender all ride on the page\'s own fetch', async () => {
  const s = stack();
  const sent: Promise<Response>[] = [];
  const real = globalThis.fetch;
  // The page's fetch for the length of this test. Every answer is kept, so the test can wait for it.
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    const answer = s.page(input, init);
    sent.push(answer);
    return answer;
  }) as typeof globalThis.fetch;
  try {
    assert.equal(await readyMadeApi.esplora.tipHeight(), s.network.height());
    assert.match(await readyMadeApi.potAddress(), ADDRESS_PATTERN);
    assert.deepEqual(await loadConfig(), { config: LOCAL_CONFIG, loaded: true });

    initEvents(true);
    trackPage({ name: 'about' }, 'es');
    assert.equal(sent.length, 4);
    assert.equal((await sent[3])?.status, 202);
    await s.settled();
    assert.deepEqual(s.forwarded.map(({ event }) => event), [{ name: 'pageview', path: '/es/about' }]);
  } finally {
    initEvents(false);
    globalThis.fetch = real;
  }
});

// -- what the Worker refuses, and what it does when the origin fails --------------------

test('a POST that does not come from one of the app\'s own pages is refused on all four routes, and nothing is asked', async () => {
  const s = stack();
  s.network.fund(receive(0).address, 100_000n);
  const state = await scanWallet(watch, s.api.esplora);
  const payment = signPayment(account.key, state, { to: SOMEONE, amount: 20_000n, feeRate: 2n });
  const before = s.network.requests().length;

  for (const sender of ['bare', 'other'] as const) {
    const fetchFn = fetchFrom(s.handler, sender);
    const outsider = makeApi(fetchFn);

    for (const call of [() => outsider.askFaucet(receive(0).address, DUMMY_TOKEN), () => outsider.potAddress()]) {
      const e = await thrownBy(call);
      assert.ok(e instanceof ApiError, sender);
      assert.equal(e.status, 403);
      assert.equal(failureOf(e), 'forbidden');
    }
    const e = await thrownBy(() => outsider.esplora.broadcast(payment.hex));
    assert.ok(e instanceof EsploraError, sender);
    assert.equal(failureOf(e), 'forbidden');
    // Not one of the node's refusals: on the Send screen it reads as our fault.
    assert.deepEqual(broadcastFailure(e), { reason: 'unavailable', detail: null });
    const event = await fetchFn(API.event, { ...JSON_POST, body: JSON.stringify({ name: 'pageview', path: '/' }) });
    assert.equal(event.status, 403);
    assert.deepEqual(await event.json(), { error: 'forbidden' });
  }
  await s.settled();
  assert.deepEqual(s.botChecks, []);
  assert.deepEqual(s.forwarded, []);
  assert.equal(s.network.requests().length, before, 'the origin heard of none of them');
  assert.deepEqual(
    s.lines.slice(-8).map((logged) => [logged.route, logged.status, logged.upstream]),
    ['bare', 'other'].flatMap(() => [
      ['faucet', 403, null],
      ['pot_address', 403, null],
      ['esplora_broadcast', 403, null],
      ['event', 403, null],
    ]),
  );

  // Reading is open to anyone, but no answer says another site's page may read it.
  for (const sender of ['bare', 'other'] as const) {
    const fetchFn = fetchFrom(s.handler, sender);
    assert.equal(await makeApi(fetchFn).esplora.tipHeight(), s.network.height());
    assert.deepEqual(await loadConfig(fetchFn), { config: LOCAL_CONFIG, loaded: true });
    assert.equal((await fetchFn(API.config)).headers.get('Access-Control-Allow-Origin'), null);
  }

  // The same payment from the app's own page goes through.
  assert.equal(await s.api.esplora.broadcast(payment.hex), payment.txid);
});

test('an origin that is down, redirects or forbids: every call reads as "unavailable", and the log says whose fault it is', async () => {
  const s = stack();
  s.network.fund(receive(0).address, 100_000n);
  const me = receive(0).address;
  const state = await scanWallet(watch, s.api.esplora);
  const payment = signPayment(account.key, state, { to: SOMEONE, amount: 20_000n, feeRate: 2n });
  const txid = state.coins[0]?.txid ?? '';

  const modes = [
    { mode: 'down', upstream: 502, fault: 'origin_down' },
    { mode: 'redirect', upstream: 302, fault: 'origin_auth' },
    { mode: 'forbidden', upstream: 403, fault: 'origin_auth' },
  ] as const;
  for (const { mode, upstream, fault } of modes) {
    s.network.setOrigin(mode);
    s.lines.length = 0;

    const reads = [
      () => s.api.esplora.tipHeight(),
      () => s.api.esplora.address(me),
      () => s.api.esplora.addressUtxos(me),
      () => s.api.esplora.addressTxs(me),
      () => s.api.esplora.addressTxsChain(me),
      () => s.api.esplora.addressTxsChain(me, txid),
      () => s.api.esplora.tx(txid),
    ];
    for (const read of reads) {
      const e = await thrownBy(read);
      assert.ok(e instanceof EsploraError, mode);
      assert.equal(e.status, 502);
      assert.equal(failureOf(e), 'unavailable');
    }

    const sent = await thrownBy(() => s.api.esplora.broadcast(payment.hex));
    assert.equal(failureOf(sent), 'unavailable');
    assert.deepEqual(broadcastFailure(sent), { reason: 'unavailable', detail: null });

    for (const call of [() => s.api.askFaucet(me, DUMMY_TOKEN), () => s.api.potAddress()]) {
      const e = await thrownBy(call);
      assert.ok(e instanceof ApiError, mode);
      assert.equal(e.status, 502);
      assert.equal(failureOf(e), 'unavailable');
    }

    assert.deepEqual(s.lines, [
      ...reads.map(() => line('esplora_read', 502, upstream, fault)),
      line('esplora_broadcast', 502, upstream, fault),
      line('faucet', 502, upstream, fault),
      line('pot_address', 502, upstream, fault),
    ]);
    // The Worker's own settings do not come from the origin.
    assert.deepEqual(await loadConfig(s.page), { config: LOCAL_CONFIG, loaded: true });

    // A whole scan and a light refresh fail the same way, and their caller can tell why.
    assert.equal(failureOf(await thrownBy(() => scanWallet(watch, s.api.esplora))), 'unavailable');
    assert.equal(failureOf(await thrownBy(() => refreshWallet(watch, s.api.esplora, state))), 'unavailable');
    await s.idle();
  }

  // Back up: the payment that could not be sent goes through, and the faucet pays.
  s.network.setOrigin('ok');
  assert.equal(await s.api.esplora.broadcast(payment.hex), payment.txid);
  assert.equal((await s.api.askFaucet(me, DUMMY_TOKEN)).amountSats, FAUCET_SATS);
});

test('an origin that does not answer at all is given up on: "unavailable", with the timeout in the log', async () => {
  // As deployed the Worker waits 8 seconds (25 for the faucet). Here, 40 ms.
  const s = stack({ timeoutMs: 40 });
  s.network.setOrigin('slow');
  const me = receive(0).address;

  assert.equal(failureOf(await thrownBy(() => s.api.esplora.tipHeight())), 'unavailable');
  assert.deepEqual(broadcastFailure(await thrownBy(() => s.api.esplora.broadcast('00'))), { reason: 'unavailable', detail: null });
  assert.equal(failureOf(await thrownBy(() => s.api.askFaucet(me, DUMMY_TOKEN))), 'unavailable');
  assert.equal(failureOf(await thrownBy(() => s.api.potAddress())), 'unavailable');
  assert.deepEqual(s.lines, [
    line('esplora_read', 502, null, 'origin_timeout'),
    line('esplora_broadcast', 502, null, 'origin_timeout'),
    line('faucet', 502, null, 'origin_timeout'),
    line('pot_address', 502, null, 'origin_timeout'),
  ]);
});

test('a limiter that refuses: "limit" on its own route, before the origin, the bot check or the events service is asked', async () => {
  const s = stack();
  s.network.fund(receive(0).address, 100_000n);
  const me = receive(0).address;
  const state = await scanWallet(watch, s.api.esplora);
  const payment = signPayment(account.key, state, { to: SOMEONE, amount: 20_000n, feeRate: 2n });
  const before = s.network.requests().length;
  const event = () => s.page(API.event, { ...JSON_POST, body: JSON.stringify({ name: 'pageview', path: '/' }) });

  for (const name of ['chain', 'broadcast', 'faucet', 'pot', 'events'] as const) s.over.add(name);

  const read = await thrownBy(() => s.api.esplora.tipHeight());
  assert.ok(read instanceof EsploraError);
  assert.equal(read.status, 429);
  assert.equal(failureOf(read), 'limit');
  assert.equal(failureOf(await thrownBy(() => scanWallet(watch, s.api.esplora))), 'limit');
  await s.idle();

  const sent = await thrownBy(() => s.api.esplora.broadcast(payment.hex));
  assert.deepEqual(broadcastFailure(sent), { reason: 'limit', detail: null });

  for (const call of [() => s.api.askFaucet(me, DUMMY_TOKEN), () => s.api.potAddress()]) {
    const e = await thrownBy(call);
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 429);
    assert.equal(failureOf(e), 'limit');
  }
  const refused = await event();
  assert.equal(refused.status, 429);
  assert.deepEqual(await refused.json(), { error: 'limit' });

  await s.settled();
  assert.equal(s.network.requests().length, before, 'the origin was not asked');
  assert.deepEqual(s.botChecks, []);
  assert.deepEqual(s.forwarded, []);
  // The settings are not rate limited: the app can always start.
  assert.deepEqual(await loadConfig(s.page), { config: LOCAL_CONFIG, loaded: true });

  // Each route has a limiter of its own. With one of them back, its route works and the others stay shut.
  s.over.delete('broadcast');
  assert.equal(await s.api.esplora.broadcast(payment.hex), payment.txid);
  assert.equal(failureOf(await thrownBy(() => s.api.esplora.tx(payment.txid))), 'limit');
  s.over.clear();
  assert.equal((await s.api.esplora.tx(payment.txid)).txid, payment.txid);
  assert.equal((await event()).status, 202);
});
