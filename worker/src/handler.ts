// Answers every request under /api/ and /p/.
//
// The app is static files; this is the only code that runs on the server for
// it. It does four small jobs: it tells the app its settings, it passes chain
// questions and signed transactions to the practice network, it guards the
// faucet, and it passes on the few events the app counts.
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
// Nothing in this file exists only on Cloudflare. makeHandler() is given
// everything from outside as a Deps (deps.ts), so the same code answers in
// the deployed Worker and under node --test.

import { ADDRESS_PATTERN, API, TXID_PATTERN, isEventBody } from '@learnbitcoin/practice-contract';
import type { ErrorCode } from '@learnbitcoin/practice-contract';
import { readText } from './body.ts';
import { TOKEN_MAX } from './bot-check.ts';
import type { Deps, Fault, Handler, Limiter, OriginAnswer, RouteName } from './deps.ts';
import { answer, jsonAnswer, refusal } from './headers.ts';
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
  | { route: 'config' | 'esplora_broadcast' | 'faucet' | 'pot_address' | 'event' }
  | { route: 'esplora_read'; upstream: string };

/** The one method each route takes. */
const METHOD: Record<Match['route'], 'GET' | 'POST'> = {
  config: 'GET',
  esplora_read: 'GET',
  esplora_broadcast: 'POST',
  faucet: 'POST',
  pot_address: 'POST',
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
 * The Esplora paths the app uses, and no others. `parts` is what follows
 * /api/esplora/, split at the slashes. The result is the path to ask the
 * origin for, put together from the parts that passed, or null.
 *
 * An address or a transaction ID must match the contract's pattern exactly:
 * lower case, nothing percent-encoded, nothing before or after. So "..",
 * "%2e%2e", an encoded slash, an empty part or an extra one all end here,
 * and nothing a reader types can steer a request to another part of the
 * origin (the bots sit beside Esplora there).
 */
export function esploraReadPath(parts: readonly string[]): string | null {
  const [first, second, third] = parts;
  if (first === 'blocks') {
    return parts.length === 3 && second === 'tip' && third === 'height' ? '/blocks/tip/height' : null;
  }
  if (first === 'address' && second !== undefined && ADDRESS_PATTERN.test(second)) {
    if (parts.length === 2) return `/address/${second}`;
    if (parts.length === 3 && (third === 'utxo' || third === 'txs')) return `/address/${second}/${third}`;
    return null;
  }
  if (first === 'tx' && parts.length === 2 && second !== undefined && TXID_PATTERN.test(second)) {
    return `/tx/${second}`;
  }
  return null;
}

function matchPath(pathname: string): Match | null {
  if (pathname === API.config) return { route: 'config' };
  if (pathname === API.faucet) return { route: 'faucet' };
  if (pathname === API.potAddress) return { route: 'pot_address' };
  if (pathname === API.event) return { route: 'event' };
  if (pathname === `${API.esplora}/tx`) return { route: 'esplora_broadcast' };
  if (pathname.startsWith(`${API.esplora}/`)) {
    const upstream = esploraReadPath(pathname.slice(API.esplora.length + 1).split('/'));
    return upstream === null ? null : { route: 'esplora_read', upstream };
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
  /** Counts this request against the reader's budget. False: over the limit. */
  async function within(limiter: Limiter, name: LimiterName, request: Request): Promise<boolean> {
    // Read here and hashed at once. The address itself is not kept, logged or sent on by this check.
    const key = await readerKey(name, request.headers.get('CF-Connecting-IP'));
    return (await limiter.limit({ key })).success;
  }

  async function esploraRead(request: Request, upstream: string): Promise<Reply> {
    if (!(await within(deps.limits.chain, 'chain', request))) return refuse('limit');
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
        return esploraRead(request, match.upstream);
      case 'esplora_broadcast':
        return broadcast(request);
      case 'faucet':
        return faucet(request);
      case 'pot_address':
        return potAddress(request);
      case 'event':
        return event(request, started);
    }
  }

  return async (request) => {
    const started = deps.now();
    let route: RouteName = 'unknown';
    let result: Reply;
    try {
      const url = new URL(request.url);
      // No route takes a query string, so a path that has one is not a path we know.
      const match = url.search === '' ? matchPath(url.pathname) : null;
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
    if (!result.logged) {
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
