// The app's one client for its Worker: the chain (through the Esplora API),
// the faucet and the pay-it-forward pot (its address, and its counts).
//
// Every way a request can fail comes out as one short word, an ApiFailure:
// one of the contract's refusal codes, or "network" when no answer arrived
// at all. The screens have a sentence for each word in the string tables, so
// a reader is never shown a status number or a server's raw text.

import {
  ADDRESS_PATTERN,
  API,
  BROADCAST_REFUSALS,
  DETAIL_MAX,
  TXID_PATTERN,
  isErrorCode,
  type BroadcastRefusal,
  type ErrorCode,
  type FaucetPayment,
  type FaucetRequest,
  type PotStats,
} from '@learnbitcoin/practice-contract';
import { Esplora, EsploraError, type FetchLike } from '@learnbitcoin/practice-wallet';

/** Why a request failed: a refusal code from the contract, or "network" when no answer came back. */
export type ApiFailure = ErrorCode | 'network';

/**
 * Why a payment was not accepted. Either the node refused it (the
 * contract's BroadcastRefusal codes), or the payment or its answer was
 * stopped on the way: "too_large", "limit", "unavailable", "network". Of
 * those four, "too_large" is the one a reader can do something about: the
 * payment spends so many coins at once that its transaction is more than
 * the Worker takes in one request. A code outside this list reads as
 * "unavailable".
 */
export type BroadcastFailure = BroadcastRefusal | 'too_large' | 'limit' | 'unavailable' | 'network';

/** What askFaucet, potAddress and potStats throw. `status` is the HTTP status, or 0 when there was no answer. */
export class ApiError extends Error {
  status: number;
  reason: ApiFailure;
  /** The node's own words, for a details line. Only a refused broadcast has them. */
  detail: string | null;

  constructor(status: number, reason: ApiFailure, detail: string | null = null) {
    super(`practice API: ${reason} (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
    this.detail = detail;
  }
}

// -- reading a refusal --------------------------------------------------------

/** A refusal as the contract writes it: { "error": <code>, "detail"?: <the node's words> }. */
interface Refusal {
  code: ErrorCode;
  detail: string | null;
}

/**
 * The node's words as the app keeps them: no longer than the contract allows,
 * and never ending on half a character (a character outside the basic plane
 * is two units long, and a cut can leave the first one alone). Null when
 * nothing is left.
 */
function tidyDetail(detail: string): string | null {
  const kept = detail.slice(0, DETAIL_MAX).replace(/[\ud800-\udbff]$/, '');
  return kept === '' ? null : kept;
}

/**
 * A refusal whose code this app does not know. A tab opened before a deploy
 * keeps running the old app against the new Worker, which may have a code
 * the old app never heard of. The contract's rule for it: "unavailable",
 * whatever the status. A status alone could not say what the code means:
 * 429 is "limit", and it is also "already_paid" and "busy".
 */
const UNKNOWN_CODE: Refusal = { code: 'unavailable', detail: null };

/** Reads a refusal from parsed JSON. Null when the body is not one: no "error" that is a text. */
function refusalIn(body: unknown): Refusal | null {
  if (typeof body !== 'object' || body === null) return null;
  const { error, detail } = body as { error?: unknown; detail?: unknown };
  if (typeof error !== 'string') return null;
  if (!isErrorCode(error)) return UNKNOWN_CODE;
  return { code: error, detail: typeof detail === 'string' ? tidyDetail(detail) : null };
}

/**
 * The inside of a JSON string that may have lost its end. Characters are
 * dropped from the end until what is left reads as a whole string: a cut can
 * fall inside an escape, and the longest one (a backslash, a "u" and four
 * digits) is six characters long.
 */
function readCutString(raw: string): string | null {
  for (let end = raw.length; end >= 0 && end >= raw.length - 6; end--) {
    try {
      return JSON.parse(`"${raw.slice(0, end)}"`) as string;
    } catch {
      // Cut inside an escape: try again one character shorter.
    }
  }
  return null;
}

/** Reads a refusal from the text of a body. Null when the text is not one. */
function refusalInText(text: string): Refusal | null {
  try {
    return refusalIn(JSON.parse(text));
  } catch {
    // Not JSON as it stands. One case is still a refusal: a body that lost
    // its end. The wallet's Esplora client keeps the first 2,000 characters
    // of a failed answer. The Worker's own refusals are all shorter than
    // that: a detail is 300 characters at most, JSON writes a quote or a
    // backslash in it as two and most control characters as six, so the
    // longest body the Worker can write is a little over 1,800. Those
    // arrive whole and never come here. This is the guard for any other
    // refusal: one that was written longer, or was cut on the way. The
    // code comes first in the body, so it can still be read, and so can
    // what is left of the detail.
    const code = /^\s*\{\s*"error"\s*:\s*"([^"\\]*)"/.exec(text)?.[1];
    if (code === undefined) return null;
    if (!isErrorCode(code)) return UNKNOWN_CODE;
    const raw = /^\s*\{\s*"error"\s*:\s*"[^"\\]*"\s*,\s*"detail"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text)?.[1];
    const detail = raw === undefined ? null : readCutString(raw);
    return { code, detail: detail === null ? null : tidyDetail(detail) };
  }
}

/**
 * The wallet's Esplora client reports a failed request as an EsploraError
 * with the status and this message:
 *
 *     Esplora POST /tx failed (400): <the start of the body>
 *
 * The Worker's refusal is that body, so the code is read back out of the
 * message. A path holds no spaces, which keeps the pattern from matching in
 * the wrong place.
 */
const ESPLORA_MESSAGE = /^Esplora \S+ \S+ failed \(\d+\): ([\s\S]*)$/;

/**
 * What a failed answer says, from its status and the text of its body. The
 * one rule for every request this client makes, to the chain or to the bots:
 *
 *   - A refusal of the Worker's with a code this app knows: that code.
 *   - A refusal with a code it does not know: "unavailable" (UNKNOWN_CODE).
 *   - Anything else, such as an error page from the network in front of the
 *     Worker: the status is all there is to go on. 429 means asking too
 *     fast, whoever says it. 404 means "no such thing" only where the chain
 *     was asked for something. The rest is "unavailable".
 */
function failedAnswer(status: number, body: string, chain: boolean): Refusal {
  const refusal = refusalInText(body);
  if (refusal !== null) return refusal;
  if (status === 429) return { code: 'limit', detail: null };
  if (status === 404 && chain) return { code: 'not_found', detail: null };
  return { code: 'unavailable', detail: null };
}

/** The same, for what the wallet's Esplora client threw. A message that is not the client's has no body to read. */
function esploraFailure(e: EsploraError): Refusal {
  return failedAnswer(e.status, ESPLORA_MESSAGE.exec(e.message)?.[1] ?? '', true);
}

/**
 * True when a request ended without an answer. fetch reports that as a
 * TypeError in every browser (offline, a name that does not resolve, a
 * connection that drops). A request given up on is the same thing to the
 * reader: no answer.
 */
function noAnswer(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

// -- what the screens call ----------------------------------------------------

/**
 * Turns anything this client or the wallet's Esplora client threw into the
 * one word the screens have text for. Whatever is not recognized is
 * "unavailable": the practice network gave an answer the app cannot use.
 */
export function failureOf(e: unknown): ApiFailure {
  if (e instanceof ApiError) return e.reason;
  if (e instanceof EsploraError) return esploraFailure(e).code;
  return noAnswer(e) ? 'network' : 'unavailable';
}

function isBroadcastRefusal(code: ApiFailure): code is BroadcastRefusal {
  return (BROADCAST_REFUSALS as readonly string[]).includes(code);
}

/**
 * Why a broadcast failed, from whatever esplora.broadcast() threw, with the
 * node's own words when it said any. Those words are for a details line,
 * never the message. Never throws.
 */
export function broadcastFailure(e: unknown): { reason: BroadcastFailure; detail: string | null } {
  let code: ApiFailure;
  let detail: string | null = null;
  if (e instanceof EsploraError) {
    const refusal = esploraFailure(e);
    code = refusal.code;
    detail = refusal.detail;
  } else if (e instanceof ApiError) {
    code = e.reason;
    detail = e.detail;
  } else {
    code = failureOf(e);
  }
  if (isBroadcastRefusal(code)) return { reason: code, detail };
  // Stopped before the node saw it, for a cause the screen has its own
  // sentence for. "too_large" is the Worker's cap on a broadcast: the hex of
  // a transaction that spends several hundred coins is over it, and a
  // smaller payment is not.
  if (code === 'too_large' || code === 'limit' || code === 'network') return { reason: code, detail: null };
  // Any other code means the payment never reached the node, or the answer
  // made no sense: nothing the reader did.
  return { reason: 'unavailable', detail: null };
}

export interface PracticeApi {
  /** The chain, through the Worker. Its errors go through failureOf or broadcastFailure. */
  esplora: Esplora;
  /** Asks the faucet to pay `address`. `token` is the bot check's, made for this address. Throws ApiError. */
  askFaucet(address: string, token: string): Promise<FaucetPayment>;
  /** An address of the pay-it-forward pot. Throws ApiError. */
  potAddress(): Promise<string>;
  /** The pot's three counts: payments passed on, coins waiting, coins handed on. Throws ApiError. */
  potStats(): Promise<PotStats>;
}

/** A count as the Worker sends one: a whole number from 0. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Builds the client around a fetch. Tests pass a fake; the app uses the browser's. */
export function makeApi(fetchFn: FetchLike = (input, init) => fetch(input, init)): PracticeApi {
  /**
   * Asks one of the Worker's own paths (not the chain's) and gives back the
   * parsed answer, or throws ApiError. A question with nothing to send is a
   * plain GET; everything else is a POST.
   */
  async function ask(path: string, init?: RequestInit): Promise<unknown> {
    let status: number;
    let ok: boolean;
    let text: string;
    try {
      const res = await fetchFn(path, init);
      status = res.status;
      ok = res.ok;
      text = await res.text();
    } catch (e) {
      throw new ApiError(0, noAnswer(e) ? 'network' : 'unavailable');
    }
    if (!ok) {
      // Read by the same rule as a failed chain request. These paths ask the
      // bots, not the chain, so a 404 that is not the Worker's own says
      // nothing the reader can use.
      const refusal = failedAnswer(status, text, false);
      throw new ApiError(status, refusal.code, refusal.detail);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ApiError(status, 'unavailable');
    }
  }

  /** POSTs to one of the Worker's paths, with a JSON body or with none. */
  function post(path: string, body?: unknown): Promise<unknown> {
    return ask(
      path,
      body === undefined
        ? { method: 'POST' }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
  }

  return {
    esplora: new Esplora(API.esplora, fetchFn),

    async askFaucet(address, token) {
      const request: FaucetRequest = { address, token };
      const answer = (await post(API.faucet, request)) as Partial<Record<keyof FaucetPayment, unknown>> | null;
      const txid = answer?.txid;
      const amountSats = answer?.amountSats;
      const potTxid = answer?.potTxid;
      // The ID and the amount are what the app goes on to show and to look
      // for on the chain, so an answer without them is no answer.
      if (typeof txid !== 'string' || !TXID_PATTERN.test(txid)) throw new ApiError(200, 'unavailable');
      if (typeof amountSats !== 'number' || !Number.isSafeInteger(amountSats) || amountSats <= 0) {
        throw new ApiError(200, 'unavailable');
      }
      // Where the coin came from is a nicety. The payment is real without it.
      return { txid, amountSats, potTxid: typeof potTxid === 'string' && TXID_PATTERN.test(potTxid) ? potTxid : null };
    },

    async potAddress() {
      const answer = (await post(API.potAddress)) as { address?: unknown } | null;
      const address = answer?.address;
      if (typeof address !== 'string' || !ADDRESS_PATTERN.test(address)) throw new ApiError(200, 'unavailable');
      return address;
    },

    async potStats() {
      // A plain GET: nothing is sent, and nothing is changed by asking.
      const answer = (await ask(API.potStats)) as Partial<Record<keyof PotStats, unknown>> | null;
      const passedOn = answer?.passedOn;
      const waiting = answer?.waiting;
      const handedOn = answer?.handedOn;
      // Three whole numbers from 0, or it is no answer: a screen puts one of them into a sentence.
      if (!isCount(passedOn) || !isCount(waiting) || !isCount(handedOn)) throw new ApiError(200, 'unavailable');
      return { passedOn, waiting, handedOn };
    },
  };
}

/** The client the app uses, on the browser's own fetch. */
export const api: PracticeApi = makeApi();
