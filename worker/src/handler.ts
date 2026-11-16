// Answers every request under /api/ and /p/.
//
// The app is static files; this is the only code that runs on the server for
// it. It does four small jobs: it tells the app its settings, it passes chain
// questions and signed transactions to the practice network, it guards the
// faucet (and asks the pot beside it for its address and, where they are
// switched on, its counts), and it passes on the few events the app counts.
//
// It trusts nothing a request says about itself:
//
//   - A path is taken apart and checked piece by piece. What goes to the
//     practice network is built again from the checked pieces; the reader's
//     own path, query string and headers never travel on.
//   - Every POST must come from this site's own pages.
//   - Every body is read under a cap and checked before anything acts on it.
//   - Each reader gets a budget per minute for each kind of request.
//
// And it keeps next to nothing about a request: one log line, which names a
// route and never a path, and for a request for chain data no line at all
// unless something is broken (the end of this file says why).
//
// The pot's counts are answered only while the Worker's settings switch
// them on (config.potCounts, which is POT_COUNTS in wrangler.jsonc). While
// they are off, their path is one the Worker does not know: it gets the
// 404 of any other, and nothing behind it is touched.
//
// One thing is kept from one request to the next, and it is about no
// request and no reader: the pot's three counts, which are the same for
// everybody. The origin is not asked for them once for each request. Each
// isolate that Cloudflare runs the Worker in asks once, for all the
// requests it answers while it keeps that answer (pot-stats.ts). Every
// other request that reaches the practice network is asked there for
// itself.
//
// Nothing in this file exists only on Cloudflare. makeHandler() is given
// everything from outside as a Deps (deps.ts), so the same code answers in
// the deployed Worker and under node --test.

import { ADDRESS_PATTERN, API, TXID_PATTERN, isEventBody } from '@learnbitcoin/practice-contract';
import type { ErrorCode } from '@learnbitcoin/practice-contract';
import { readText } from './body.ts';
import { TOKEN_MAX } from './bot-check.ts';
import type { Deps, Fault, Handler, Limiter, OriginAnswer, RouteName } from './deps.ts';
import { answer, jsonAnswer, refusal } from './headers.ts';
import { potStatsForAll } from './pot-stats.ts';
import { readerKey } from './reader-key.ts';
import type { LimiterName } from './reader-key.ts';

/** Room for an address and a bot-check token (2048 characters at most). */
export const FAUCET_BODY_MAX = 4096;
/** An event is a name, a path and a value from short closed lists. */
export const EVENT_BODY_MAX = 1024;
/** The longest signed transaction taken, in hex characters: 100,000 bytes, hundreds of coins spent at once. */
export const TX_HEX_MAX = 200_000;

const HEX = /^[0-9a-fA-F]+$/;

/** A path the Worker knows, and what answers it. */
type Match =
  | { route: 'config' | 'esplora_broadcast' | 'faucet' | 'pot_address' | 'pot_stats' | 'event' }
  | { route: 'esplora_read'; upstream: string; cost: number };

/** The one method each route takes. */
const METHOD: Record<Match['route'], 'GET' | 'POST'> = {
  config: 'GET',
  esplora_read: 'GET',
  esplora_broadcast: 'POST',
  faucet: 'POST',
  pot_address: 'POST',
  pot_stats: 'GET',
  event: 'POST',
};

/** An answer, and what the log line says about how it came to be. */
interface Reply {
  response: Response;
  upstream: number | null;
  fault: Fault | null;
  /** True when the log line is written later, by work that goes on after the answer. */
  logged?: boolean;
}

function refuse(code: ErrorCode, extra?: Record<string, string>): Reply {
  return { response: refusal(code, null, extra), upstream: null, fault: null };
}

/** An answer from the practice origin that is not a success, as a reply. */
function refused(result: Extract<OriginAnswer<unknown>, { ok: false }>): Reply {
  return { response: refusal(result.code, result.detail), upstream: result.upstream, fault: result.fault };
}

/**
 * The 32 characters an address is written in after "bcrt1". Each stands for
 * a number from 0 to 31: its place in this line.
 */
const ADDRESS_CHARACTERS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/** The prefix "bcrt" as the checksum takes it in: the high bits of its four letters, a zero, then their low five bits. */
const PREFIX_VALUES = [3, 3, 3, 3, 0, 2, 3, 18, 20];

/** The five constants the checksum is worked out with (BIP 173). */
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/** What the checksum of a version 0 address comes to (BIP 173), and that of every later version (BIP 350). */
const CHECKSUM_VERSION_0 = 1;
const CHECKSUM_LATER = 0x2bc830a3;

/**
 * Is this text an address of the practice network, as the Worker takes one:
 * "bcrt1..." in lower case?
 *
 * The contract's pattern says what such an address looks like. An address is
 * more than its looks, though (BIP 173 and BIP 350). The first character
 * after "bcrt1" is a version, from 0 to 16. The last six are a checksum over
 * everything before them, so that a mistyped address is caught and not paid.
 * What lies between is the witness program, five bits to a character: it
 * must come to whole bytes, 20 or 32 of them for version 0 and from 2 to 40
 * for any later version.
 *
 * Esplora checks all of this, and answers text that fails with a 400. Anyone
 * can ask the Worker about any text, so the Worker checks it first, by the
 * rules of those two BIPs. Text that is no address is the asker's own
 * mistake: it gets the 404 of any path the Worker does not know, and the
 * practice network is never asked about it. (Were it asked, its 400 would
 * stand in the owner's log as a fault of ours, and anyone could fill that
 * log at will.)
 */
export function isPracticeAddress(text: string): boolean {
  if (!ADDRESS_PATTERN.test(text)) return false;
  // Everything after "bcrt1", as numbers: the version, the program, the checksum.
  const values = Array.from(text.slice('bcrt1'.length), (character) => ADDRESS_CHARACTERS.indexOf(character));

  // The checksum, worked out over the prefix and every character (the
  // "polymod" of BIP 173). It comes to one fixed number for a version 0
  // address and to another for every later version. Anything else means
  // that a character is wrong.
  let checksum = 1;
  for (const value of [...PREFIX_VALUES, ...values]) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let bit = 0; bit < 5; bit += 1) {
      if ((top >>> bit) & 1) checksum ^= GENERATOR[bit]!;
    }
  }
  const version = values[0]!;
  if (version > 16 || checksum !== (version === 0 ? CHECKSUM_VERSION_0 : CHECKSUM_LATER)) return false;

  // The program: five bits to a character, to be read as bytes of eight.
  // Up to four bits may be left over at the end, and each must be zero.
  const program = values.slice(1, -6);
  const spare = (program.length * 5) % 8;
  if (spare > 4 || (program.at(-1)! & ((1 << spare) - 1)) !== 0) return false;
  const bytes = (program.length * 5 - spare) / 8;
  // Version 0 is a key hash (20 bytes) or a script hash (32). A later
  // version may have from 2 to 40 bytes, and the pattern's 11 to 71
  // characters already hold a program to that.
  return version !== 0 || bytes === 20 || bytes === 32;
}

/**
 * The Esplora paths the app uses, and no others. `parts` is what follows
 * /api/esplora/, split at the slashes. The result is the path to ask the
 * origin for, put together from the parts that passed, or null.
 *
 * There are seven shapes:
 *
 *   blocks/tip/height                     the height of the chain
 *   address/<address>                     how much an address has received and spent
 *   address/<address>/utxo                its unspent coins
 *   address/<address>/txs                 its transactions: the first 50
 *   address/<address>/txs/chain           its confirmed transactions: the newest 25
 *   address/<address>/txs/chain/<txid>    the 25 that come after that one
 *   tx/<txid>                             one transaction
 *
 * The two "chain" shapes are how a list longer than 50 is read to its end
 * (the wallet package's addressTxsAll). They are chain reads like the
 * others: the same limiter counts them, and they are as silent in the log
 * (the end of this file). The last of them is counted apart and for more
 * than one read, though: OLDER_PAGE_COST below says why.
 *
 * An address or a transaction ID must match the contract's pattern exactly:
 * lower case, nothing percent-encoded, nothing before or after. So "..",
 * "%2e%2e", an encoded slash, an empty part or an extra one all end here,
 * and nothing a reader types can steer a request to another part of the
 * origin (the bots sit beside Esplora there). An address must also be one,
 * checksum and all (isPracticeAddress above), so the origin is asked about
 * addresses only. A transaction ID has no such check: any 64 hex characters
 * could be one, and Esplora answers "not found" for one it does not know,
 * or an empty list when asked what comes after it.
 */
export function esploraReadPath(parts: readonly string[]): string | null {
  const [first, second, third, fourth, fifth] = parts;
  if (first === 'blocks') {
    return parts.length === 3 && second === 'tip' && third === 'height' ? '/blocks/tip/height' : null;
  }
  if (first === 'address' && second !== undefined && isPracticeAddress(second)) {
    if (parts.length === 2) return `/address/${second}`;
    if (parts.length === 3 && (third === 'utxo' || third === 'txs')) return `/address/${second}/${third}`;
    if (third === 'txs' && fourth === 'chain') {
      if (parts.length === 4) return `/address/${second}/txs/chain`;
      if (parts.length === 5 && fifth !== undefined && TXID_PATTERN.test(fifth)) return `/address/${second}/txs/chain/${fifth}`;
    }
    return null;
  }
  if (first === 'tx' && parts.length === 2 && second !== undefined && TXID_PATTERN.test(second)) {
    return `/tx/${second}`;
  }
  return null;
}

/**
 * How many chain reads one page of an address's older transactions counts
 * as, when it is asked for by an ID (address/<address>/txs/chain/<txid>).
 *
 * Every other read costs the practice network about the same whatever is
 * asked: Esplora stops after one page, or answers from totals it keeps.
 * This one does not. To find where the page begins, Esplora reads the
 * address's list from its newest transaction down to the ID it was given,
 * and to the very end when the ID is not in the list. (That is read from
 * Esplora's source. It was not measured.) So the work grows with the length
 * of the list, and any 64 hex characters will do for an ID. The Worker does
 * not know how long the list of an address is, so it cannot tell a cheap
 * question from a dear one.
 *
 * What the Worker can do is make the question scarce. The limiter for
 * chain reads lets a reader's count go up to 6,000 in a minute
 * (wrangler.jsonc). These pages are counted by the same limiter, but each
 * as 50 and under a second key of the reader's (OLDER_PAGES), so in a count
 * of their own: 120 of them a minute for one reader, whatever else that
 * reader asks. A wallet has room in that. It asks for no older page at all
 * for an address with fewer than 50 transactions, which is nearly every
 * address, and for 39 at the very most for one address (addressTxsAll
 * again): three whole readings of such a list fit into a minute.
 *
 * The count is kept apart so that neither kind of read can use up the
 * other. A reader who has asked for too many older pages still sees coins
 * and totals. And where many readers share one address (a classroom), a
 * flood of older pages from one of them leaves the others' reads alone.
 */
export const OLDER_PAGE_COST = 50;

/** What is added to a reader's key for the count of older pages (OLDER_PAGE_COST above). */
export const OLDER_PAGES = 'older-pages';

/**
 * What a chain read counts for at the limiter. `upstream` is a path that
 * esploraReadPath() has put together.
 */
export function chainReadCost(upstream: string): number {
  // Only one of the seven shapes has something after "/txs/chain": the page asked for by an ID.
  return upstream.includes('/txs/chain/') ? OLDER_PAGE_COST : 1;
}

/**
 * What is added to a reader's key for the count of looks at the pot's
 * counts (GET /api/pot/stats).
 *
 * The pot has one limiter, and "Pass it on" asks it for the pot's address.
 * The counts are a nicety beside that: one line on a screen. While they
 * are switched on they are read with a GET, which needs no page of ours,
 * so anybody can ask for them as often as they like. Counted under the
 * reader's own key, such asking would use up the budget that "Pass it on"
 * draws on, for that reader and for everyone behind the same address. So
 * they are counted at the same limiter under a second key of the reader's,
 * in a count of their own, as the older pages of a long list are at the
 * chain's limiter (OLDER_PAGES above). Each look counts as one.
 *
 * This count is a brake on one reader, and that is all it is. It does not
 * keep the looks of many readers away from the practice network: nothing
 * counted for each reader could. What holds them back is that an isolate
 * of the Worker asks the origin once for all the looks it answers, and
 * rests after a question that failed (pot-stats.ts). That is a bound for
 * each isolate, and Cloudflare may run many. So the counts are answered at
 * all only while the settings switch them on (matchPath below). The count
 * comes first all the same: a reader who is over it is refused, whether or
 * not there is an answer to give.
 */
export const POT_STATS = 'stats';

/**
 * The route a path stands for, or null for a path the Worker does not know.
 *
 * `potCounts` says whether the pot's counts are switched on (the setting
 * POT_COUNTS, as config.ts read it). While they are off, their path is not
 * a path the Worker knows. It is turned away here, where every unknown path
 * is, and so by the same lines of the handler: the same 404, the same
 * headers, the same line in the log, whatever the method. Nothing is
 * counted at a limiter, the origin is not asked, and what is kept of the
 * counts is neither read nor changed. This is the one place that decides
 * it, and nothing of the request is looked at for it but the path.
 */
function matchPath(pathname: string, potCounts: boolean): Match | null {
  if (pathname === API.config) return { route: 'config' };
  if (pathname === API.faucet) return { route: 'faucet' };
  if (pathname === API.potAddress) return { route: 'pot_address' };
  if (pathname === API.potStats) return potCounts ? { route: 'pot_stats' } : null;
  if (pathname === API.event) return { route: 'event' };
  if (pathname === `${API.esplora}/tx`) return { route: 'esplora_broadcast' };
  if (pathname.startsWith(`${API.esplora}/`)) {
    const upstream = esploraReadPath(pathname.slice(API.esplora.length + 1).split('/'));
    return upstream === null ? null : { route: 'esplora_read', upstream, cost: chainReadCost(upstream) };
  }
  return null;
}

/**
 * Did this request come from one of this site's own pages?
 *
 * A browser names the page's origin in the Origin header of every POST that
 * a script sends, and a page cannot change that header. It must equal the
 * origin this request was sent to. There is no list of allowed hosts and no
 * setting: whatever host the Worker is reached on is the only one accepted.
 *
 * A browser sends the literal "null" instead when the page has a no-referrer
 * policy (the app's pages do) and the request is not in CORS mode. Such a
 * request, and one with no Origin at all, is accepted only if the browser
 * also says it is same-origin in Sec-Fetch-Site, a header pages cannot set
 * either. A page with an opaque origin (a sandboxed frame) sends "cross-site"
 * there and is still refused.
 */
function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin');
  if (origin && origin !== 'null') return origin === url.origin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

/** A request body as text, or the refusal for one that is too large or cannot be read. */
async function readBody(request: Request, max: number): Promise<{ text: string } | { refused: ErrorCode }> {
  // A declared length is only a first, cheap check: the header is optional
  // and can say anything. The cap that counts is the one applied while reading.
  const declared = request.headers.get('Content-Length');
  if (declared !== null) {
    if (!/^[0-9]+$/.test(declared)) return { refused: 'bad_request' };
    if (Number(declared) > max) return { refused: 'too_large' };
  }
  try {
    const { text, over } = await readText(request.body, max);
    return over ? { refused: 'too_large' } : { text };
  } catch {
    // The reader went away in the middle of sending.
    return { refused: 'bad_request' };
  }
}

export function makeHandler(deps: Deps): Handler {
  /**
   * Counts this request against the reader's budget. False: over the limit.
   *
   * `cost` is how many requests this one counts as (one, unless told
   * otherwise). With `apart`, it is counted under a second key of the same
   * reader, the reader's own key with that word added: a count of its own
   * at the same limiter, which the reader's other requests there neither
   * add to nor draw on.
   */
  async function within(limiter: Limiter, name: LimiterName, request: Request, cost = 1, apart = ''): Promise<boolean> {
    // Read here and hashed at once. The address itself is not kept, logged or sent on by this check.
    const reader = await readerKey(name, request.headers.get('CF-Connecting-IP'));
    const key = apart === '' ? reader : `${reader}:${apart}`;
    // Cloudflare's limiter counts a call as `delta` requests when it is
    // given one ("weighted requests"), and as one request when it is not.
    // A call is refused once the count has reached the limit, and a call
    // that is refused adds nothing to the count. (The Limiter type in
    // deps.ts names the key alone so far. An object that holds one field
    // more is still one it takes.)
    const options: { key: string; delta?: number } = cost === 1 ? { key } : { key, delta: cost };
    return (await limiter.limit(options)).success;
  }

  async function esploraRead(request: Request, upstream: string, cost: number): Promise<Reply> {
    // A read that counts for more than one is a page of older transactions
    // asked for by an ID. Those have a count of their own (OLDER_PAGE_COST).
    const allowed =
      cost === 1
        ? await within(deps.limits.chain, 'chain', request)
        : await within(deps.limits.chain, 'chain', request, cost, OLDER_PAGES);
    if (!allowed) return refuse('limit');
    const result = await deps.origin.esplora(upstream);
    if (!result.ok) return refused(result);
    // The origin's body is passed on byte for byte, once all of it has
    // arrived (origin.ts says why). Its headers are not: the content type
    // is one of our two, and the rest are the fixed set.
    return { response: answer(200, result.value.type, result.value.body), upstream: result.upstream, fault: null };
  }

  async function broadcast(request: Request): Promise<Reply> {
    const body = await readBody(request, TX_HEX_MAX);
    if ('refused' in body) return refuse(body.refused);
    const hex = body.text;
    if (hex.length % 2 !== 0 || !HEX.test(hex)) return refuse('bad_request');
    if (!(await within(deps.limits.broadcast, 'broadcast', request))) return refuse('limit');
    const result = await deps.origin.broadcast(hex.toLowerCase());
    if (!result.ok) return refused(result);
    // As Esplora answers it: the transaction ID as plain text.
    return { response: answer(200, 'text', result.value), upstream: result.upstream, fault: null };
  }

  async function faucet(request: Request): Promise<Reply> {
    const body = await readBody(request, FAUCET_BODY_MAX);
    if ('refused' in body) return refuse(body.refused);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return refuse('bad_request');
    }
    if (typeof parsed !== 'object' || parsed === null) return refuse('bad_request');
    const { address, token } = parsed as { address?: unknown; token?: unknown };
    if (typeof address !== 'string' || typeof token !== 'string') return refuse('bad_request');
    // No bot check issues an empty token or one this long, so the verify service is never asked about it.
    if (token === '' || token.length > TOKEN_MAX) return refuse('bad_request');
    if (!ADDRESS_PATTERN.test(address)) return refuse('bad_address');

    if (!(await within(deps.limits.faucet, 'faucet', request))) return refuse('limit');

    const check = await deps.botCheck(token, address);
    if (check.verdict !== 'pass') {
      const code: ErrorCode =
        check.verdict === 'fail' ? 'bot_check' : check.verdict === 'closed' ? 'closed' : 'unavailable';
      return { response: refusal(code), upstream: check.upstream, fault: check.fault };
    }

    const result = await deps.origin.faucet(address);
    if (!result.ok) return refused(result);
    return { response: jsonAnswer(200, result.value), upstream: result.upstream, fault: null };
  }

  async function potAddress(request: Request): Promise<Reply> {
    // The body is not read: this route takes none.
    if (!(await within(deps.limits.pot, 'pot', request))) return refuse('limit');
    const result = await deps.origin.potAddress();
    if (!result.ok) return refused(result);
    return { response: jsonAnswer(200, { address: result.value }), upstream: result.upstream, fault: null };
  }

  async function potStats(request: Request): Promise<Reply> {
    // The reader's own count comes first, whatever is kept. It is counted
    // apart from the pot's address, so that looking can never use up
    // "Pass it on" (POT_STATS).
    if (!(await within(deps.limits.pot, 'pot', request, 1, POT_STATS))) return refuse('limit');
    // One answer for everyone this isolate serves: the kept counts while
    // they are young enough, or else the origin's, asked for once for all
    // who wait, or "unavailable" for a moment after a question that failed
    // (pot-stats.ts). Nothing of this request has a say in which: not its
    // address, not a header, and a path with a query string never gets here.
    const result = await potStatsForAll(deps);
    if (!result.ok) return refused(result);
    // The answer is written here, for this request, from the three counts
    // and nothing else: whatever the origin's answer held beside them was
    // left behind where the counts were taken out of it. `upstream` is null
    // when the counts are the kept ones: nobody was asked for this request.
    const { passedOn, waiting, handedOn } = result.value;
    return { response: jsonAnswer(200, { passedOn, waiting, handedOn }), upstream: result.upstream, fault: null };
  }

  async function event(request: Request, started: number): Promise<Reply> {
    const body = await readBody(request, EVENT_BODY_MAX);
    if ('refused' in body) return refuse(body.refused);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return refuse('bad_request');
    }
    // The contract's check is the whole check: a name, a screen path and a
    // value from closed lists, and no other key. Free text cannot get through.
    if (!isEventBody(parsed)) return refuse('bad_request');
    if (!(await within(deps.limits.events, 'events', request))) return refuse('limit');

    const accepted = answer(202, null, null);
    // Events are switched off: say thank you and send nothing on.
    if (!deps.config.events) return { response: accepted, upstream: null, fault: null };

    // The app is answered at once; the event travels on afterwards. This
    // request's log line is written when that has ended, so it can say how.
    const log = (upstream: number | null, fault: Fault | null): void => {
      deps.log({ route: 'event', status: 202, upstream, ms: deps.now() - started, fault });
    };
    const meta = { ip: request.headers.get('CF-Connecting-IP'), userAgent: request.headers.get('User-Agent') };
    deps.waitUntil(
      Promise.resolve()
        .then(() => deps.forwardEvent(parsed, meta))
        .then(
          (result) => log(result.upstream, result.fault),
          () => log(null, 'events_down'),
        ),
    );
    return { response: accepted, upstream: null, fault: null, logged: true };
  }

  async function reply(request: Request, match: Match, url: URL, started: number): Promise<Reply> {
    const method = METHOD[match.route];
    if (request.method !== method) return refuse('method', { Allow: method });
    // Reading is open to anyone; other sites still cannot read the answers,
    // because no answer carries a CORS header. Anything that changes or
    // costs something is a POST, and a POST must come from our own pages.
    if (method === 'POST' && !sameOrigin(request, url)) return refuse('forbidden');
    switch (match.route) {
      case 'config':
        return { response: jsonAnswer(200, deps.config), upstream: null, fault: null };
      case 'esplora_read':
        return esploraRead(request, match.upstream, match.cost);
      case 'esplora_broadcast':
        return broadcast(request);
      case 'faucet':
        return faucet(request);
      case 'pot_address':
        return potAddress(request);
      case 'pot_stats':
        return potStats(request);
      case 'event':
        return event(request, started);
    }
  }

  return async (request) => {
    const started = deps.now();
    let route: RouteName = 'unknown';
    // True for every path under /api/esplora/, whether the Worker knows it or not.
    let underEsplora = false;
    let result: Reply;
    try {
      const url = new URL(request.url);
      underEsplora = url.pathname.startsWith(`${API.esplora}/`);
      // No route takes a query string, so a path that has one is not a path we know.
      // (Only `true` switches the pot's counts on: anything else in its place leaves them off.)
      const match = url.search === '' ? matchPath(url.pathname, deps.config.potCounts === true) : null;
      if (match === null) {
        result = refuse('not_found');
      } else {
        route = match.route;
        result = await reply(request, match, url, started);
      }
    } catch {
      // Our own mistake. The error is not looked at, so nothing from the
      // request can ride into the log on it.
      result = { response: refusal('unavailable'), upstream: null, fault: 'handler' };
    }
    // One line per request, with one exception: a request for chain data
    // that ends without a fault writes none. The line itself would name no
    // address. But a log service can keep, beside each line, the URL of the
    // request it was written in, and the URL of such a request holds a
    // wallet address or a transaction ID. A line that is never written
    // cannot be kept beside anything.
    //
    // "A request for chain data" is every request under /api/esplora/ but a
    // broadcast, whatever its method. So a chain read that went well leaves
    // no trace here, and neither does one that was refused for a reason
    // that is nobody's fault (a transaction the chain does not know yet, a
    // reader asking too fast, a wrong method). Nor does any other path
    // there, which gets a 404: a shape the Worker does not carry, text that
    // is no address, a stray slash, a query string. Its URL can hold an
    // address or an ID just the same. A broadcast keeps its line: its URL
    // is the same for everyone, and the transaction travels in its body.
    //
    // A request that ends in a fault still writes its line, whatever it
    // asked for: something is broken, and the owner has to know.
    const silent = underEsplora && route !== 'esplora_broadcast' && result.fault === null;
    if (!result.logged && !silent) {
      // The whole log line: a route name, never a path, and no address, ID, token or IP.
      deps.log({
        route,
        status: result.response.status,
        upstream: result.upstream,
        ms: deps.now() - started,
        fault: result.fault,
      });
    }
    return result.response;
  };
}
