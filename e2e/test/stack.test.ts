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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bech32m } from '@scure/base';
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
} from '@learnbitcoin/practice-wallet';
import {
  configFromEnv,
  makeBotCheck,
  makeForwardEvent,
  makeHandler,
  makeOrigin,
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
import { wranglerConfig } from '../../worker/test/fakes.ts';
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
  const limiter = (name: keyof Limits): Limiter => ({ limit: async () => ({ success: !over.has(name) }) });

  const deps: Deps = {
    config: configFromEnv(LOCAL_VARS),
    origin: makeOrigin({
      url: ORIGIN,
      botsToken: network.token,
      fetch: network.fetch,
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
  const handler: Handler = (request) => {
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
    forwarded,
    botChecks,
    over,
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

/**
 * How much of the node's words the app can read today. The wallet's Esplora
 * client keeps the first 300 characters of a failed answer, and the Worker's
 * answer spends some of those on its wrapper: {"error":"<code>","detail":"
 */
const detailRoom = (code: BroadcastRefusal) => 300 - '{"error":"","detail":"'.length - code.length;

/** Sends a transaction the node refuses through the app's client, and checks what the app is told. */
async function refusedAs(s: Stack, hex: string, code: BroadcastRefusal, words: RegExp): Promise<void> {
  const message = await nodeSays(s, hex);
  assert.match(message, words);
  assert.ok(message.length <= detailRoom(code), 'short enough to cross whole (a long one has a test of its own)');
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
  const config = await loadConfig(s.page);
  assert.deepEqual(config, LOCAL_CONFIG);
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[]) {
    assert.notEqual(config[key], DEFAULT_CONFIG[key], `${key} must differ from the built-in value, or this proves nothing`);
  }
  // The settings are the Worker's own: the origin is not asked, and they are there when it is down.
  s.network.setOrigin('down');
  assert.deepEqual(await loadConfig(s.page), LOCAL_CONFIG);
  assert.deepEqual(s.network.requests(), []);
  assert.deepEqual(s.lines, [line('config', 200), line('config', 200)]);
});

test('as shipped: the settings built into the app are the ones in wrangler.jsonc, and with no secrets set the faucet is closed', async () => {
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
  const shipped = await loadConfig(s.page);
  assert.deepEqual({ ...shipped, turnstileSiteKey: '', events: false }, { ...DEFAULT_CONFIG });
  assert.equal(shipped.turnstileSiteKey, (vars.TURNSTILE_SITE_KEY ?? '').trim());
  assert.equal(shipped.events, (vars.PLAUSIBLE_DOMAIN ?? '').trim() !== '');

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

  // Every request went through the handler, and each has its line. No line holds an address or an ID.
  assert.ok(s.lines.length > 60, 'a full scan asks about at least 20 unused addresses on each chain');
  for (const logged of s.lines) assert.deepEqual(logged, line('esplora_read', 200, 200));
  assert.doesNotMatch(JSON.stringify(s.lines), /bcrt1|[0-9a-f]{64}/);
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
  assert.deepEqual(s.lines.at(-1), line('esplora_read', 404, 404));
  assert.equal((await s.api.esplora.address(me)).mempool_stats.tx_count, 0);

  s.clock.ms += 5_000;
  assert.equal((await s.api.esplora.tx(payment.txid)).txid, payment.txid);
  assert.equal((await s.api.esplora.address(me)).mempool_stats.tx_count, 1);
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

  // Text that fits the Worker's pattern but is no address reaches the chain, which answers 400.
  // The app is told "unavailable". The wallet never asks about an address it did not derive.
  const broken = `${receive(0).address.slice(0, -1)}${receive(0).address.endsWith('q') ? 'p' : 'q'}`;
  assert.match(broken, ADDRESS_PATTERN);
  const e = await thrownBy(() => s.api.esplora.address(broken));
  assert.ok(e instanceof EsploraError);
  assert.equal(failureOf(e), 'unavailable');
  assert.deepEqual(s.lines.at(-1), line('esplora_read', 502, 400));
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
  const segwit = (version: number, program: Uint8Array) => bech32m.encode(REGTEST.bech32, [version, ...bech32m.toWords(program)]);
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
    ['pay-to-anchor', segwit(1, Uint8Array.of(0x4e, 0x73)), 240n],
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

test('a refused broadcast whose words are long: the code crosses whole, and the words from their start', async (t) => {
  const s = stack();
  s.network.fund(receive(0).address, 100_000n);
  const [coin] = (await scanWallet(watch, s.api.esplora)).coins;
  assert.ok(coin);

  // A coin of receive address 0, signed for with the key of receive address 1. The node names the
  // transaction, its second ID and the coin: three IDs of 64 characters, a little over 300 in all.
  const wrongKey = handMade(coin, [{ address: SOMEONE, amount: coin.value - 500n }], 1);
  const message = await nodeSays(s, wrongKey.hex);
  assert.match(message, /^mempool-script-verify-flag-failed \(Script failed an OP_EQUALVERIFY operation\), input 0 of /);
  assert.ok(message.length > 300, 'longer than the contract lets a detail be');

  const e = await thrownBy(() => s.api.esplora.broadcast(wrongKey.hex));
  assert.ok(e instanceof EsploraError);
  assert.equal(failureOf(e), 'refused');
  const { reason, detail } = broadcastFailure(e);
  assert.equal(reason, 'refused');
  // The Worker keeps the first 300 characters of the node's words (the contract's DETAIL_MAX). The
  // wallet's Esplora client then keeps the first 300 characters of the whole answer, wrapper
  // included, which cuts the JSON short, and the app reads what is left of it. So the details line
  // gets the start of the node's words: today 271 characters of them, and never anything else.
  assert.ok(detail !== null && detail.length >= detailRoom('refused'), 'all that fits arrives');
  assert.ok(message.slice(0, DETAIL_MAX).startsWith(detail), 'and it is the start of what the node said');
  t.diagnostic(`a node message of ${message.length} characters reaches the app as ${detail.length}`);
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

test('the bot check: a token from the widget the app sets up passes the Worker\'s own check, for its address only', async () => {
  const me = receive(0).address;
  const HOST = 'practice.test';
  // Turnstile's verify service, played by hand. For a solved token it says where it was solved
  // and which action and customer data its widget was drawn with. The widgets here are drawn
  // with the options the app's own module gives.
  const widgets = new Map<string, Record<string, unknown>>();
  const solve = (address: string): string => {
    const token = `solved-${widgets.size}`;
    widgets.set(token, faucetWidgetOptions(LOCAL_CONFIG.turnstileSiteKey, address, 'en', false));
    return token;
  };
  const asked: unknown[] = [];
  const verify: FetchLike = async (url, init) => {
    const question = JSON.parse(String(init?.body)) as { response: string };
    asked.push({ url, ...question });
    const widget = widgets.get(question.response);
    const answer = widget
      ? { success: true, hostname: HOST, action: widget.action, cdata: widget.cData, 'error-codes': [] }
      : { success: false, 'error-codes': ['invalid-input-response'] };
    return new Response(JSON.stringify(answer), { headers: { 'Content-Type': 'application/json' } });
  };
  // The Worker's real bot check in place of the stand-in one.
  const botCheck = makeBotCheck({ siteKey: LOCAL_CONFIG.turnstileSiteKey, secret: 'a-secret', hostname: HOST, fetch: verify });
  const s = stack({ deps: { botCheck } });

  // The app and the Worker agree on the action's name and on what the customer data holds: paid.
  assert.equal((await s.api.askFaucet(me, solve(me))).amountSats, FAUCET_SATS);
  // The verify service was told the secret and the token, and nothing about the reader.
  assert.deepEqual(asked, [
    { url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify', secret: 'a-secret', response: 'solved-0' },
  ]);

  // A token solved for one address does not pay another, and a made-up token pays nobody.
  assert.equal(failureOf(await thrownBy(() => s.api.askFaucet(receive(1).address, solve(me)))), 'bot_check');
  assert.equal(failureOf(await thrownBy(() => s.api.askFaucet(receive(1).address, 'made-up'))), 'bot_check');
  assert.equal(s.reached('POST', '/bots/faucet'), 1);
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
    assert.deepEqual(await loadConfig(), LOCAL_CONFIG);

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
    assert.deepEqual(await loadConfig(fetchFn), LOCAL_CONFIG);
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
    assert.deepEqual(await loadConfig(s.page), LOCAL_CONFIG);

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
  assert.deepEqual(await loadConfig(s.page), LOCAL_CONFIG);

  // Each route has a limiter of its own. With one of them back, its route works and the others stay shut.
  s.over.delete('broadcast');
  assert.equal(await s.api.esplora.broadcast(payment.hex), payment.txid);
  assert.equal(failureOf(await thrownBy(() => s.api.esplora.tx(payment.txid))), 'limit');
  s.over.clear();
  assert.equal((await s.api.esplora.tx(payment.txid)).txid, payment.txid);
  assert.equal((await event()).status, 202);
});
