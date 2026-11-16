// The Worker's one way to the practice network.
//
// The network's origin serves two things: the chain, through the Esplora API
// under /esplora/, and the bots (the faucet and the pay-it-forward pot) under
// /bots/. It is not open to the public. Requests reach it only with an Access
// service token, and the bots ask for a bearer token as well, for everything
// but their counts.
//
// So every request made here is written from scratch:
//
//   - a constant origin and a path made of parts the handler has validated,
//     never a path, query string or header that a reader sent;
//   - redirect "manual", because following a redirect would carry our tokens
//     to whatever host it named;
//   - a time limit, which covers the whole answer and not only its headers;
//   - a fixed x-real-ip. On a request from a Worker to a host in its own
//     zone, Cloudflare tells the origin the reader's IP address unless the
//     Worker sets this header itself. The practice network has no use for
//     who is asking, so it is told a placeholder.
//
// And only a 200 is ever passed on, and only once all of it has arrived.
// Any other answer is turned into one of the contract's codes here: an error
// page from a proxy, or a login page from Access, must never reach the app
// dressed up as chain data.
//
// A few answers that are not a 200 mean something to the reader: Esplora's
// plain-text 404 for a transaction it does not know, the node's plain-text
// 400 for a transaction it refuses, and the faucet's six refusals (on the
// two routes of the bots that take the bearer token). Each is taken for
// what it is only when everything about it fits: the status, the kind of
// body, the question it answers. Everything else is "unavailable", and
// every "unavailable" carries a fault code, so the owner's log never holds
// a failure with no hint of where to look.

import { ADDRESS_PATTERN, DETAIL_MAX, ERROR_STATUS, TXID_PATTERN } from '@learnbitcoin/practice-contract';
import type { BroadcastRefusal, ErrorCode, FaucetPayment, PotStats } from '@learnbitcoin/practice-contract';
import { drop, isRecord, readBytes, readText } from './body.ts';
import type { Fault, FetchLike, Origin, OriginAnswer, OriginBody } from './deps.ts';

export interface OriginOptions {
  /** The origin, for example https://practice-origin.learnbitcoin.com. */
  url: string;
  /** The bearer token the bots ask for on the faucet and on the pot's address. */
  botsToken: string;
  /** The Access service token. The two headers are sent only when both values are set. */
  accessClientId?: string;
  accessClientSecret?: string;
  fetch: FetchLike;
  /** How long a call may take, in milliseconds. */
  timeoutMs?: number;
  /** The same for the faucet. Its payments queue behind one lock, so it is given longer. */
  faucetTimeoutMs?: number;
}

export const ORIGIN_TIMEOUT_MS = 8000;
export const FAUCET_TIMEOUT_MS = 25_000;

/**
 * What the origin is told instead of the reader's IP address: an address
 * from a range that is set aside for documentation, so it is nobody's.
 */
export const PLACEHOLDER_IP = '192.0.2.1';

/** The most the Worker reads of an answer it has to look inside (a transaction ID, a refusal, the bots' JSON). */
const ANSWER_MAX = 4096;

/**
 * The most the Worker takes of one chain answer, in bytes. The longest thing
 * the app asks for is an address's transactions, and Esplora sends at most 75
 * of those at a time. An ordinary practice payment is about 1,500 bytes
 * there, so a full answer is a little over 100,000: this is some forty times
 * that. The Worker holds an answer in memory until it is complete, so one
 * that is longer still is refused, not held.
 */
export const CHAIN_ANSWER_MAX = 4 * 1024 * 1024;

/** What a path rebuilt by the handler looks like: lower-case letters and digits between single slashes. */
const REBUILT_PATH = /^(?:\/[a-z0-9]+)+$/;

/**
 * The faucet's own refusals: the six things it tells a reader (see
 * bots/practice_bots/bots.py). The app has a sentence for each, so these
 * pass through. The bots have other codes too (bad_request, unauthorized,
 * not_found, unavailable, error). Those say that this Worker asked wrongly
 * or that the bots are broken, which is never the reader's doing, so they
 * do not pass through, even where the contract happens to have a code of
 * the same name.
 */
export const BOTS_REFUSALS = [
  'bad_address',
  'own_address',
  'already_paid',
  'busy',
  'refilling',
  'failed',
] as const satisfies readonly ErrorCode[];

type Failure = Extract<OriginAnswer<never>, { ok: false }>;

/**
 * An answer that is not a success. The first two lines put a rule in the
 * compiler's hands: an "unavailable" cannot be made here without a fault
 * code. (The handler writes no log line for a chain read that ends without
 * a fault, so an "unavailable" with none would fail in silence.)
 */
function failure(code: 'unavailable', upstream: number | null, fault: Fault): Failure;
function failure(code: Exclude<ErrorCode, 'unavailable'>, upstream: number | null, fault: Fault | null, detail?: string | null): Failure;
function failure(code: ErrorCode, upstream: number | null, fault: Fault | null, detail: string | null = null): Failure {
  return { ok: false, code, detail, upstream, fault };
}

/**
 * Whose fault it is when the origin answers with a status that no route has
 * a reading for. (The other ways to be "unavailable" have their codes too:
 * a 200 with the wrong body is origin_shape, a request that got no answer
 * is origin_down or origin_timeout, see thrown() below, and a call to the
 * bots with no token to send is origin_auth.)
 *
 *   origin_auth   a redirect, 401 or 403: the origin does not let us in.
 *                 Access answers a missing or expired service token with a
 *                 redirect to a login page, or with 401 or 403; the bots
 *                 answer a wrong bearer token with 401.
 *   origin_down   a 5xx: something on the origin's side is stopped or broken.
 *   origin_shape  anything else: the origin is up and lets us in, but what
 *                 it said is not an answer this Worker knows how to read.
 */
function faultOf(status: number): Fault {
  if ((status >= 300 && status < 400) || status === 401 || status === 403) return 'origin_auth';
  return status >= 500 ? 'origin_down' : 'origin_shape';
}

/** A fetch or a body read that threw: the time limit, or the origin could not be reached. */
function thrown(error: unknown, upstream: number | null = null): Failure {
  const name = isRecord(error) ? String(error.name) : '';
  const fault: Fault = name === 'TimeoutError' || name === 'AbortError' ? 'origin_timeout' : 'origin_down';
  return failure('unavailable', upstream, fault);
}

export function makeOrigin(options: OriginOptions): Origin {
  const base = options.url.replace(/\/+$/, '');
  const { botsToken } = options;
  const send = options.fetch;
  const timeoutMs = options.timeoutMs ?? ORIGIN_TIMEOUT_MS;
  const faucetTimeoutMs = options.faucetTimeoutMs ?? FAUCET_TIMEOUT_MS;
  const access =
    options.accessClientId && options.accessClientSecret
      ? { id: options.accessClientId, secret: options.accessClientSecret }
      : null;

  interface Call {
    method: 'GET' | 'POST';
    path: string;
    /** Add the bots' bearer token. */
    bearer?: boolean;
    body?: { text: string; type: 'text/plain' | 'application/json' };
    timeoutMs: number;
  }

  /** Makes one request. Answers the response, or the failure when there is none worth reading. */
  async function call(request: Call): Promise<{ ok: true; response: Response } | Failure> {
    const headers: Record<string, string> = { 'x-real-ip': PLACEHOLDER_IP };
    if (access !== null) {
      headers['CF-Access-Client-Id'] = access.id;
      headers['CF-Access-Client-Secret'] = access.secret;
    }
    if (request.bearer) headers.Authorization = `Bearer ${botsToken}`;
    if (request.body !== undefined) headers['Content-Type'] = request.body.type;

    let response: Response;
    try {
      response = await send(`${base}${request.path}`, {
        method: request.method,
        headers,
        // A string, not a stream: a stream goes out without a Content-Length,
        // and the bots refuse a body whose length they are not told.
        body: request.body?.text,
        redirect: 'manual',
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (error) {
      return thrown(error);
    }

    // We were not let in. Whatever the route, and whatever the body says,
    // the fault is ours and the owner has to fix it. This is settled here,
    // before any route looks at the answer.
    const { status } = response;
    if (faultOf(status) === 'origin_auth') {
      await drop(response);
      return failure('unavailable', status, 'origin_auth');
    }
    return { ok: true, response };
  }

  /** Any answer no route has a use for. */
  async function unexpected(response: Response): Promise<Failure> {
    await drop(response);
    return failure('unavailable', response.status, faultOf(response.status));
  }

  /** Reads an answer from the bots: the value on a 200, otherwise one of the faucet's own refusals or "unavailable". */
  async function fromBots<T>(response: Response, parse: (body: unknown) => T | null): Promise<OriginAnswer<T>> {
    const { status } = response;
    let body: unknown = null;
    try {
      const { text, over } = await readText(response.body, ANSWER_MAX);
      if (!over) body = JSON.parse(text);
    } catch (error) {
      // A body that is not JSON counts as no body: what follows then goes by
      // the status alone. A read that broke off is the origin failing.
      if (!(error instanceof SyntaxError)) return thrown(error, status);
    }
    if (status === 200) {
      const value = parse(body);
      return value === null ? failure('unavailable', status, 'origin_shape') : { ok: true, value, upstream: status };
    }
    // The bots say why in a "code" field. One of the faucet's own six is
    // passed on, so the app can explain it, when it comes with the status
    // the bots give that refusal. The contract gives each of the six the
    // same status, so the reader gets the code and the status as the bots
    // sent them. Under any other status it is not the refusal we know.
    const said: unknown = isRecord(body) ? body.code : undefined;
    const code = BOTS_REFUSALS.find((known) => known === said);
    if (code !== undefined && status === ERROR_STATUS[code]) {
      // "failed" (500) is the faucet saying it is broken: the owner has to
      // look. "refilling" arrives with status 503 by design: the faucet is
      // waiting for its own refill, and nobody has to fix anything.
      return failure(code, status, status >= 500 && code !== 'refilling' ? 'origin_down' : null);
    }
    // Anything else is not a refusal of the faucet's: one of the bots' other
    // codes, a code nobody knows, a body that is not JSON, an error page
    // from something in between. The reader could do nothing about it.
    return failure('unavailable', status, faultOf(status));
  }

  /**
   * Reads the pot's counts. This question has no refusal a reader could do
   * anything about, so nothing but a 200 is read at all: any other status is
   * "unavailable", whatever its body says, a faucet's refusal included.
   */
  async function fromPotStats(response: Response): Promise<OriginAnswer<PotStats>> {
    if (response.status !== 200) return unexpected(response);
    let body: unknown = null;
    try {
      const { text, over } = await readText(response.body, ANSWER_MAX);
      if (!over) body = JSON.parse(text);
    } catch (error) {
      // As in fromBots: a body that is not JSON is no body, and a read that broke off is the origin failing.
      if (!(error instanceof SyntaxError)) return thrown(error, 200);
    }
    const value = potStats(body);
    return value === null ? failure('unavailable', 200, 'origin_shape') : { ok: true, value, upstream: 200 };
  }

  return {
    async esplora(path) {
      // The handler builds this path from validated parts. Should a later
      // change hand over anything else, it stops here, before our tokens go
      // out with it. The message names no path.
      if (!REBUILT_PATH.test(path)) throw new Error('origin: not a rebuilt Esplora path');
      const sent = await call({ method: 'GET', path: `/esplora${path}`, timeoutMs });
      if (!sent.ok) return sent;
      const { response } = sent;
      if (response.status === 200) {
        const type = bodyType(response);
        if (type === null) {
          await drop(response);
          return failure('unavailable', 200, 'origin_shape');
        }
        // The answer is read to its end here, before any of it is passed
        // on. The time limit ends a request that is still waiting for its
        // headers, and it ends a body this code is reading. In Cloudflare's
        // runtime it does not reach a body that a Worker hands straight
        // through to the reader: an origin that stalled halfway would hold
        // the reader's request open for as long as it liked, behind a 200
        // that had already gone out. Read here, a stalled answer is a plain
        // "unavailable" when the time is up, and so is one that is cut off.
        let bytes: Uint8Array<ArrayBuffer>;
        let over: boolean;
        try {
          ({ bytes, over } = await readBytes(response.body, CHAIN_ANSWER_MAX));
        } catch (error) {
          return thrown(error, 200);
        }
        if (over) return failure('unavailable', 200, 'origin_shape');
        // Passed on byte for byte: the Worker never looks inside chain data.
        const value: OriginBody = { body: new Response(bytes).body, type };
        return { ok: true, value, upstream: 200 };
      }
      // Esplora answers 404 to one thing the app asks: a transaction it does
      // not know (yet), and it says so in plain text. That is an answer
      // about the chain, and nobody is at fault for it. A 404 to any other
      // question, or one of another kind (a page from a proxy that has lost
      // its way to Esplora), is not the chain speaking. The reader could do
      // nothing about it, so it is never passed on as "not found".
      if (response.status === 404 && path.startsWith('/tx/') && bodyType(response) === 'text') {
        await drop(response);
        return failure('not_found', 404, null);
      }
      // Every other status is "unavailable", with a fault code for the owner.
      // That goes for Esplora's 400 to text that is no address, too. The
      // handler passes on nothing but addresses it has checked, checksum
      // and all, so such a 400 means that Esplora and the Worker disagree
      // about what an address is, and that is the owner's to look at.
      return unexpected(response);
    },

    async broadcast(hex) {
      const sent = await call({ method: 'POST', path: '/esplora/tx', body: { text: hex, type: 'text/plain' }, timeoutMs });
      if (!sent.ok) return sent;
      const { response } = sent;
      // Esplora answers a broadcast in plain text: the transaction ID with a
      // 200, the node's reason with a 400. A 400 of any other kind (an error
      // page from a proxy on the way, say) is not the node speaking, and must
      // not be shown to the reader as the node's refusal. That one, like
      // every other status, is "unavailable", with a fault code for the owner.
      const refusedByNode = response.status === 400 && bodyType(response) === 'text';
      if (response.status !== 200 && !refusedByNode) return unexpected(response);
      let text: string;
      let over: boolean;
      try {
        ({ text, over } = await readText(response.body, ANSWER_MAX));
      } catch (error) {
        return thrown(error, response.status);
      }
      if (refusedByNode) {
        // The node looked at the transaction and said no. That is an answer
        // for the reader, with the node's own words, and nobody's fault.
        const refusal = mapBroadcastRefusal(text);
        return failure(refusal.code, 400, null, refusal.detail === '' ? null : refusal.detail);
      }
      const txid = text.trim();
      if (over || !TXID_PATTERN.test(txid)) return failure('unavailable', 200, 'origin_shape');
      return { ok: true, value: txid, upstream: 200 };
    },

    async faucet(address) {
      // Without the token the bots would only answer 401.
      if (botsToken === '') return failure('unavailable', null, 'origin_auth');
      const sent = await call({
        method: 'POST',
        path: '/bots/faucet',
        bearer: true,
        body: { text: JSON.stringify({ address }), type: 'application/json' },
        timeoutMs: faucetTimeoutMs,
      });
      return sent.ok ? fromBots(sent.response, faucetPayment) : sent;
    },

    async potAddress() {
      if (botsToken === '') return failure('unavailable', null, 'origin_auth');
      const sent = await call({ method: 'GET', path: '/bots/pot/address', bearer: true, timeoutMs });
      return sent.ok ? fromBots(sent.response, potAddress) : sent;
    },

    async potStats() {
      // The bots answer this to anybody the origin lets in: no bearer token
      // is sent, and so it is asked even when none is configured.
      const sent = await call({ method: 'GET', path: '/bots/pot/stats', timeoutMs });
      return sent.ok ? fromPotStats(sent.response) : sent;
    },
  };
}

/** The origin's content type, reduced to the two kinds of body the Worker sends. Null for any other. */
function bodyType(response: Response): OriginBody['type'] | null {
  const type = (response.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (type === 'application/json') return 'json';
  if (type === 'text/plain') return 'text';
  return null;
}

/** The bots' { txid, amount_sats, pot_coin } as the contract's FaucetPayment, or null if it is anything else. */
function faucetPayment(body: unknown): FaucetPayment | null {
  if (!isRecord(body)) return null;
  const { txid, amount_sats: amount, pot_coin: pot } = body;
  if (typeof txid !== 'string' || !TXID_PATTERN.test(txid)) return null;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1) return null;
  // The coin this payment spends, when an earlier learner passed it on. It
  // is an extra. The payment has been made whether or not this part can be
  // read, so a pot_coin of any other shape is left out and the payment
  // stands. (Thrown away, the reader would be told to try again, and then
  // that this address has already been paid.)
  const potTxid = isRecord(pot) && typeof pot.txid === 'string' && TXID_PATTERN.test(pot.txid) ? pot.txid : null;
  return { txid, amountSats: amount, potTxid };
}

function potAddress(body: unknown): string | null {
  if (!isRecord(body)) return null;
  return typeof body.address === 'string' && ADDRESS_PATTERN.test(body.address) ? body.address : null;
}

/** A count as the bots give one: a whole number from 0. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The bots' pot counter as the contract's PotStats, or null if it is
 * anything else. Exactly three of its fields are taken, and the answer is
 * built from them here: whatever else the bots say beside them (the sats
 * the pot has received, how often the faucet has paid) goes no further.
 */
function potStats(body: unknown): PotStats | null {
  if (!isRecord(body)) return null;
  const { learners_passed_on: passedOn, coins_waiting: waiting, coins_passed_to_newcomers: handedOn } = body;
  if (!isCount(passedOn) || !isCount(waiting) || !isCount(handedOn)) return null;
  return { passedOn, waiting, handedOn };
}

/**
 * What the node says when it refuses a transaction, and the code the app
 * shows its own text for. The first row whose words appear in the node's
 * message wins; a message none of them fits is "refused".
 */
const REFUSALS: ReadonlyArray<readonly [words: string, code: BroadcastRefusal]> = [
  // Sent again after it was confirmed.
  ['Transaction outputs already in utxo set', 'already_sent'],
  // A coin it spends is gone, or another unconfirmed payment is spending it.
  ['bad-txns-inputs-missingorspent', 'coin_spent'],
  ['insufficient fee, rejecting replacement', 'coin_spent'],
  ['txn-mempool-conflict', 'coin_spent'],
  ['min relay fee not met', 'fee_too_low'],
  ['mempool min fee not met', 'fee_too_low'],
  ['dust', 'dust'],
];

/**
 * Maps a refused broadcast to its code. The origin's text looks like
 *
 *   sendrawtransaction RPC error: {"code":-26,"message":"min relay fee not met, 5 < 11"}
 *
 * `detail` is the message alone when the text has that shape, otherwise the
 * text itself, cut to DETAIL_MAX characters. It is the node's own wording,
 * for a details line in the app and never for the message itself.
 */
export function mapBroadcastRefusal(text: string): { code: BroadcastRefusal; detail: string } {
  const message = nodeMessage(text);
  const row = REFUSALS.find(([words]) => message.includes(words));
  return { code: row === undefined ? 'refused' : row[1], detail: message.slice(0, DETAIL_MAX) };
}

function nodeMessage(text: string): string {
  const start = text.indexOf('{');
  if (start !== -1) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start));
      if (isRecord(parsed) && typeof parsed.message === 'string' && parsed.message !== '') return parsed.message;
    } catch {
      // Not the usual shape: the text is used as it is.
    }
  }
  return text.trim();
}
