// A stand-in for the practice network's origin, kept in memory.
//
// The real origin is a router with two things behind it: the chain, through
// the Esplora API under /esplora/, and the bots (the faucet and the
// pay-it-forward pot) under /bots/. This file answers the same requests with
// the same statuses, content types and bodies, as they were recorded from the
// real one (e2e/fixtures/origin-samples.json). So the app, the Worker and the
// end-to-end tests run with no network and no secrets.
//
//   fake-chain.ts  the chain: transactions, coins, blocks, the node's refusals
//   fake-bots.ts   the faucet and the pot, and the wallet they pay from
//   this file      the routes, and the controls a test drives it with
//
//   const origin = makeFakeOrigin();
//   const esplora = new Esplora('http://origin.test/esplora', origin.fetch);
//   origin.fund(address, 100_000n);       // a confirmed coin, in a new block
//   await esplora.broadcast(payment.hex); // waits ...
//   origin.mine();                        // ... until the next block
//
// Nothing here is random: keys, addresses and block hashes come from a seed.
// And the real clock is read only when the caller supplies no clock.

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hex } from '@scure/base';
import { makeBots, FAUCET_MODES, type BotsAnswer, type FaucetMode } from './fake-bots.ts';
import { makeChain, scriptOf } from './fake-chain.ts';

export type { FaucetMode };

/**
 * ok         the origin answers.
 * down       every route answers 502, as a proxy does when nothing is behind it.
 * slow       no route answers at all, until the caller gives up.
 * redirect   every route answers 302, as Cloudflare Access does without its service token.
 * forbidden  every route answers 403.
 */
export const ORIGIN_MODES = ['ok', 'down', 'slow', 'redirect', 'forbidden'] as const;
export type OriginMode = (typeof ORIGIN_MODES)[number];

/** The bearer token the stand-in's bots ask for. Not a secret: it opens nothing but this stand-in. */
export const FAKE_BOTS_TOKEN = 'stand-in-bots-token';

export interface FakeOriginOptions {
  /** Keys, addresses and block hashes are made from this, so two stand-ins with one seed are alike. Default "practice". */
  seed?: string;
  /** The time in milliseconds since 1970, as Date.now gives it. Default: the real clock. With a clock supplied, the real one is never read. */
  clock?: () => number;
  /** The height the chain starts at. Default 101. */
  height?: number;
  /** What one faucet request pays, in sats. Default 100,000. */
  faucetSats?: number;
  /** The bearer token /bots/pot/address and /bots/faucet ask for. Default FAKE_BOTS_TOKEN. */
  token?: string;
}

export interface FakeOrigin {
  /**
   * Answers in-process, as the origin would, for any URL whose path starts
   * with /esplora/ or /bots/ (the host is ignored). No socket is opened.
   */
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  /** Serves the same over HTTP on a free port of 127.0.0.1. `url` has no trailing slash. */
  listen(): Promise<{ url: string; close(): Promise<void> }>;
  /** The token to send as "Authorization: Bearer <token>" to the two bots routes that ask for one. */
  readonly token: string;

  /**
   * Makes `count` blocks. The first takes every waiting transaction. Each
   * moves the stand-in's time on 30 seconds (see fake-chain.ts for the exact
   * rule when the clock runs too). Returns the new height.
   */
  mine(count?: number): number;
  /**
   * Pays an address from nowhere and returns the transaction ID. The payment
   * is confirmed at once, in a new block that holds nothing else (so the
   * height goes up by one and other waiting transactions go on waiting), or
   * with { confirmed: false } it is left waiting for the next mine(). It is
   * an ordinary payment: an amount under the address's dust limit throws,
   * and the coin is not always output 0.
   */
  fund(address: string, sats: bigint | number, options?: { confirmed?: boolean }): string;
  /**
   * Makes the faucet refuse with this code, after its address checks, until
   * it is set back to "ok". "down" stops the bots instead: every route under
   * /bots/ answers 502, the pot's too, and the chain goes on answering.
   */
  setFaucet(mode: FaucetMode): void;
  /**
   * How many seconds Esplora takes to hear of a payment the stand-in makes
   * itself: the faucet's, and fund()'s waiting ones. Until then GET /tx/<id>
   * answers 404 and the address shows nothing, as on the real network, where
   * this takes a moment. A block ends the wait, and a transaction sent
   * through POST /esplora/tx is never made to wait. It applies to payments
   * made from now on. At the start it is 0: Esplora hears at once.
   */
  setEsploraLag(seconds: number): void;
  /** Makes every route fail in this way until it is set back to "ok". */
  setOrigin(mode: OriginMode): void;
  /** The height of the chain. */
  height(): number;
  /** The method and path of every request so far, oldest first: for counting polls. */
  requests(): { method: string; path: string }[];
}

interface Answer {
  status: number;
  type: 'text/plain' | 'application/json' | 'text/html';
  body: string;
  headers?: Record<string, string>;
}

const text = (status: number, body: string): Answer => ({ status, type: 'text/plain', body });
const json = (status: number, body: unknown): Answer => ({ status, type: 'application/json', body: JSON.stringify(body) });
const fromBots = (answer: BotsAnswer): Answer => json(answer.status, answer.body);
/** An error page of the router (nginx) or of a proxy in front of it. Nobody reads the body. */
const page = (status: number, title: string): Answer => ({
  status,
  type: 'text/html',
  body: [
    '<html>',
    `<head><title>${status} ${title}</title></head>`,
    '<body>',
    `<center><h1>${status} ${title}</h1></center>`,
    '<hr><center>nginx</center>',
    '</body>',
    '</html>',
    '',
  ].join('\r\n'),
});

export function makeFakeOrigin(options: FakeOriginOptions = {}): FakeOrigin {
  const seed = options.seed ?? 'practice';
  const token = options.token ?? FAKE_BOTS_TOKEN;
  const chain = makeChain({ height: options.height ?? 101, clock: options.clock ?? Date.now, seed });
  const bots = makeBots(chain, { seed, faucetSats: BigInt(options.faucetSats ?? 100_000) });
  const seen: { method: string; path: string }[] = [];
  let mode: OriginMode = 'ok';

  /**
   * The Esplora API (electrs). `path` is what follows /esplora. The real
   * server knows many more paths; this one knows the six the wallet uses.
   */
  function esplora(method: string, path: string, body: string): Answer {
    if (method === 'GET' && path === '/blocks/tip/height') return text(200, String(chain.height()));

    const address = /^\/address\/([^/]*)(\/utxo|\/txs)?$/.exec(path);
    if (method === 'GET' && address) {
      const [, asked = '', list] = address;
      const found = scriptOf(asked);
      if ('error' in found) return text(400, found.error);
      const script = hex.encode(found.script);
      if (list === '/utxo') return json(200, chain.utxoJson(script));
      if (list === '/txs') return json(200, chain.txsJson(script));
      return json(200, chain.addressJson(asked, script));
    }

    const tx = /^\/tx\/([^/]*)$/.exec(path);
    if (method === 'GET' && tx) {
      const [, txid = ''] = tx;
      if (!/^[0-9a-f]{64}$/i.test(txid)) return text(400, 'Invalid hex hash');
      const found = chain.tx(txid.toLowerCase());
      return found ? json(200, chain.txJson(found)) : text(404, 'Transaction not found');
    }

    if (method === 'POST' && path === '/tx') {
      const sent = chain.broadcast(body, 'esplora');
      if (sent.ok) return text(200, sent.txid);
      // electrs passes on what the node's RPC said, as it said it.
      return text(400, `sendrawtransaction RPC error: ${JSON.stringify({ code: sent.code, message: sent.message })}`);
    }

    return text(404, `endpoint does not exist ${JSON.stringify(path)}`);
  }

  /** The bots' API (bots/practice_bots/server.py). `path` is what follows /bots. */
  function botsApi(method: string, path: string, authorization: string | null, body: string, length: number): Answer {
    const notFound = json(404, { error: 'not found', code: 'not_found' });
    const authorized = authorization === `Bearer ${token}`;
    const unauthorized = json(401, { error: 'unauthorized', code: 'unauthorized' });

    if (method === 'GET') {
      if (path === '/health') return fromBots(bots.health());
      if (path === '/pot/stats') return fromBots(bots.potStats());
      if (path === '/pot/address') return authorized ? fromBots(bots.potAddress()) : unauthorized;
      return notFound;
    }

    if (path !== '/faucet') return notFound;
    if (!authorized) return unauthorized;
    // The bots read as many bytes as Content-Length says, and none when it
    // says nothing: a body sent as a stream arrives without one, and is refused.
    if (length <= 0 || length > 1024) return json(400, { error: 'Send a small JSON body with an address', code: 'bad_request' });
    let sent: unknown;
    try {
      sent = JSON.parse(body);
    } catch {
      sent = null;
    }
    if (typeof sent !== 'object' || sent === null || Array.isArray(sent)) {
      return json(400, { error: 'Send JSON like {"address": "bcrt1..."}', code: 'bad_request' });
    }
    // bots.py makes text of whatever came (Python's str). JavaScript's String
    // spells other things another way ("null" for Python's "None"), spells a
    // list of one address as that address, and throws for some objects. Only
    // a string can be an address in either language, so anything else goes
    // on as text that is not one.
    const address: unknown = (sent as Record<string, unknown>).address;
    const asked = typeof address === 'string' ? address.trim() : address === undefined ? '' : 'not an address';
    return fromBots(bots.faucet(asked));
  }

  /**
   * One request in, one answer out. `length` is what the request's
   * Content-Length says (0 when it has none). "slow" means there is never an answer.
   */
  function answer(method: string, path: string, authorization: string | null, body: string, length: number): Answer | 'slow' {
    seen.push({ method, path });
    if (mode === 'slow') return 'slow';
    if (mode === 'down') return page(502, 'Bad Gateway');
    if (mode === 'forbidden') return page(403, 'Forbidden');
    // A login page on a host that does not exist, so that nothing can follow it anywhere.
    if (mode === 'redirect') return { ...page(302, 'Found'), headers: { Location: 'https://login.invalid/cdn-cgi/access/login' } };

    // The router (ops/nginx/router.conf) knows two prefixes, turns away every
    // method but GET and POST (the real one lets HEAD by as well, which nothing
    // here sends), and marks every answer as not for search engines.
    const isEsplora = path.startsWith('/esplora/');
    let reply: Answer;
    if (!isEsplora && !path.startsWith('/bots/')) reply = page(404, 'Not Found');
    else if (method !== 'GET' && method !== 'POST') reply = page(403, 'Forbidden');
    else if (isEsplora) reply = esplora(method, path.slice('/esplora'.length), body);
    // The bots are stopped: the router finds nobody to pass the request on to.
    else if (bots.mode() === 'down') reply = page(502, 'Bad Gateway');
    else reply = botsApi(method, path.slice('/bots'.length), authorization, body, length);
    return { ...reply, headers: { 'X-Robots-Tag': 'noindex, nofollow' } };
  }

  async function fetchInProcess(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const request = new Request(input, init);
    const body = await request.text();
    // Over a socket, a body given as a stream goes out without a Content-Length.
    const length = init?.body instanceof ReadableStream ? 0 : Buffer.byteLength(body);
    const reply = answer(request.method, new URL(request.url).pathname, request.headers.get('authorization'), body, length);
    if (reply !== 'slow') {
      return new Response(reply.body, { status: reply.status, headers: { 'Content-Type': reply.type, ...reply.headers } });
    }
    // No answer is coming. Like the real fetch, this ends only when the
    // caller's signal ends it, and until then it keeps the process alive, as
    // a request on its way does. It listens to the caller's own signal, not
    // to the copy the Request made of it: that copy can be garbage-collected
    // while the caller still waits, and the wait would then never end.
    return new Promise((_, reject) => {
      if (!signal) return;
      const waiting = setInterval(() => {}, 60_000);
      const giveUp = () => {
        clearInterval(waiting);
        reject(signal.reason);
      };
      if (signal.aborted) giveUp();
      else signal.addEventListener('abort', giveUp, { once: true });
    });
  }

  async function listen(): Promise<{ url: string; close(): Promise<void> }> {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let reply: Answer | 'slow';
        try {
          const path = new URL(request.url ?? '/', 'http://stand-in').pathname;
          const length = Number(request.headers['content-length']) || 0;
          reply = answer(request.method ?? 'GET', path, request.headers.authorization ?? null, Buffer.concat(chunks).toString('utf8'), length);
        } catch (error) {
          // A fault in the stand-in itself: say so, and keep serving.
          reply = text(500, `stand-in origin: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (reply === 'slow') return; // The connection stays open and silent until the caller hangs up.
        response.writeHead(reply.status, { 'Content-Type': reply.type, 'Content-Length': Buffer.byteLength(reply.body), ...reply.headers });
        response.end(reply.body);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}`,
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections(); // the silent ones included
        }),
    };
  }

  return {
    fetch: fetchInProcess,
    listen,
    token,
    mine(count = 1) {
      for (let i = 0; i < count; i++) chain.mine();
      return chain.height();
    },
    fund(address, sats, { confirmed = true } = {}) {
      return bots.fund(address, BigInt(sats), confirmed);
    },
    setFaucet(next) {
      // Checked here as well as by the compiler: node runs these files without checking types.
      if (!FAUCET_MODES.includes(next)) throw new Error(`setFaucet: no such mode: ${String(next)}`);
      bots.setMode(next);
    },
    setEsploraLag(seconds) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
        throw new Error(`setEsploraLag: not a number of seconds: ${String(seconds)}`);
      }
      chain.setLag(seconds);
    },
    setOrigin(next) {
      if (!ORIGIN_MODES.includes(next)) throw new Error(`setOrigin: no such mode: ${String(next)}`);
      mode = next;
    },
    height: () => chain.height(),
    requests: () => seen.map((request) => ({ ...request })),
  };
}
