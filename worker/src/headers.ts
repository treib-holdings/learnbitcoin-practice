// The headers on every answer the Worker writes.
//
// The app's pages get their headers from app/public/_headers. That file never
// touches an answer made by Worker code, so the Worker sets its own, and it
// does so in one place: answer() below builds every Response this Worker
// sends. A route cannot forget a header it never had to remember.

import { ERROR_STATUS } from '@learnbitcoin/practice-contract';
import type { ErrorBody, ErrorCode } from '@learnbitcoin/practice-contract';

/** The two kinds of body the Worker sends. */
export type AnswerType = 'json' | 'text';

const CONTENT_TYPE: Record<AnswerType, string> = {
  json: 'application/json; charset=utf-8',
  text: 'text/plain; charset=utf-8',
};

/** Sent on every answer, whatever the route and whatever the status. */
export const FIXED_HEADERS: Readonly<Record<string, string>> = {
  // Coins and balances change with every block, and a refusal may be gone a
  // second later: nothing may keep an old answer.
  'Cache-Control': 'no-store',
  // The body is what Content-Type says it is. A browser must not guess.
  'X-Content-Type-Options': 'nosniff',
  // These are answers for the app, not pages for a search engine.
  'X-Robots-Tag': 'noindex',
  // Should a browser ever show an answer as a page, that page may load
  // nothing, run nothing and sit in nobody's frame.
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  // HTTPS only, the same as for the app's pages.
  'Strict-Transport-Security': 'max-age=31536000',
};

/**
 * Builds an answer. `type` is null for an answer with no body.
 *
 * `extra` holds headers one route needs (Allow on a 405, say). A later phase
 * that lets the main site read chain data can pass its one CORS header here
 * for the Esplora reads, and no other route gets it. An extra can add a
 * header but never replace a fixed one.
 */
export function answer(
  status: number,
  type: AnswerType | null,
  body: string | ReadableStream<Uint8Array> | null,
  extra: Record<string, string> = {},
): Response {
  const headers = new Headers(extra);
  if (type !== null) headers.set('Content-Type', CONTENT_TYPE[type]);
  for (const [name, value] of Object.entries(FIXED_HEADERS)) headers.set(name, value);
  return new Response(body, { status, headers });
}

/** An answer with a JSON body. */
export function jsonAnswer(status: number, value: unknown, extra?: Record<string, string>): Response {
  return answer(status, 'json', JSON.stringify(value), extra);
}

/** A refusal: the contract's ErrorBody, with the status the contract gives its code. */
export function refusal(code: ErrorCode, detail: string | null = null, extra?: Record<string, string>): Response {
  const body: ErrorBody = detail === null || detail === '' ? { error: code } : { error: code, detail };
  return jsonAnswer(ERROR_STATUS[code], body, extra);
}
