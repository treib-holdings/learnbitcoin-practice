// Passing a counted event on to Plausible.
//
// The app counts a few things (a screen was opened, a wallet was made, a
// faucet request ended this way or that) so the site can tell which steps
// people finish. An event is a name, a screen and at most one value, each
// from a closed list in the contract; the handler has already checked that
// before this module is called.
//
// The request to Plausible is written from scratch. Nothing the reader's
// browser sent is copied across: no cookies, no referrer, no language. Two
// things about the reader are passed on, on purpose: the browser's user agent
// and the address the request came from. Plausible uses them to tell a
// visitor from a robot and to count one visitor once a day, and drops
// requests that arrive without them. The app's About screen says so.

import { EVENTS } from '@learnbitcoin/practice-contract';
import type { EventBody } from '@learnbitcoin/practice-contract';
import { drop } from './body.ts';
import type { EventMeta, FetchLike, ForwardEvent } from './deps.ts';

/** Plausible's events API. */
export const EVENTS_URL = 'https://plausible.io/api/event';

const TIMEOUT_MS = 5000;

export interface ForwardEventOptions {
  /** The site the events are counted under in Plausible. Empty: nothing is sent. */
  domain: string;
  /** The app's own origin, for example https://practice.learnbitcoin.com (no slash at the end). */
  appUrl: string;
  /**
   * True: an event's value goes as a custom property ({ result: "ok" }).
   * False: it becomes part of the name ("Passkey: ok"), which every Plausible
   * plan can count. Either way the names come from a closed list.
   */
  props: boolean;
  fetch: FetchLike;
}

export function makeForwardEvent(options: ForwardEventOptions): ForwardEvent {
  const { props } = options;
  // The domain as config.ts reads the same setting when it tells the app
  // whether events are on: without the spaces around it, and empty when it
  // was never set. Sent on as typed, a stray space would name a site the
  // events service does not know, and every event would be thrown away unseen.
  const domain = typeof options.domain === 'string' ? options.domain.trim() : '';
  const appUrl = options.appUrl.replace(/\/+$/, '');
  const send = options.fetch;

  return async (event, meta) => {
    if (domain === '') return { ok: false, upstream: null, fault: null };
    try {
      const response = await send(EVENTS_URL, {
        method: 'POST',
        headers: eventHeaders(meta),
        body: JSON.stringify(eventPayload(event, domain, appUrl, props)),
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await drop(response);
      // Plausible answers 202 for an event it took. It marks one it threw
      // away (a robot's, by its reckoning) with a header.
      const taken = response.status === 202 && response.headers.get('x-plausible-dropped') !== '1';
      return { ok: taken, upstream: response.status, fault: taken ? null : 'events_down' };
    } catch {
      return { ok: false, upstream: null, fault: 'events_down' };
    }
  };
}

/** What Plausible is sent for one event. Every field is built here; none is copied from the reader's request. */
export function eventPayload(
  event: EventBody,
  domain: string,
  appUrl: string,
  props: boolean,
): { name: string; url: string; domain: string; props?: Record<string, string> } {
  // The path is one of the contract's fixed screen paths: no address, no
  // transaction ID, nothing typed by the reader.
  const url = `${appUrl}${event.path}`;
  const spec = EVENTS[event.name];
  if (spec === null || event.value === undefined) return { name: event.name, url, domain };
  if (props) return { name: event.name, url, domain, props: { [spec.prop]: event.value } };
  return { name: `${event.name}: ${event.value}`, url, domain };
}

/** The headers Plausible gets: these and no others. */
export function eventHeaders(meta: EventMeta): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (meta.userAgent) headers['User-Agent'] = meta.userAgent;
  if (meta.ip) {
    // Plausible reads the visitor's address from X-Forwarded-For, but prefers
    // CF-Connecting-IP when a request has both. Cloudflare can fill that
    // header on a Worker's own request with an address of its network, so
    // both are set to the reader's.
    headers['X-Forwarded-For'] = meta.ip;
    headers['CF-Connecting-IP'] = meta.ip;
  }
  return headers;
}
