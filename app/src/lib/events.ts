// What the app counts, and how it is sent.
//
// An event is a name from the contract's closed list, the screen it happened
// on and, except for a screen view, one value from a closed list. There is no
// free text in it, no ID, no address and no amount, so nothing here can say
// who the reader is or which wallet is theirs. The Worker checks every event
// against the same list (isEventBody) before it passes one on.
//
// How to wire it: call initEvents once the settings say whether events are
// wanted, then trackPage for the screen already showing and again on every
// change of screen. track() files its event under the screen trackPage was
// last told about. Until initEvents(true), nothing is sent at all.

import {
  API,
  isEventBody,
  type CountedEvent,
  type EventBody,
  type Lang,
  type ValueOf,
} from '@learnbitcoin/practice-contract';
import { eventPath, type Route } from './router.ts';

export interface EventOptions {
  /**
   * Throw on an event the contract does not list, instead of dropping it.
   * Such an event is a bug in the app, never something the reader did. Tests
   * turn this on so that the bug fails a test, whether events are on or off.
   * The app leaves it off: a counting mistake must never break a wallet
   * screen.
   */
  strict?: boolean;
}

let on = false;
let strict = false;
let post: (body: string) => void = postToWorker;

/** The counted path of the screen the reader is on. Null until the first trackPage. */
let screenPath: string | null = null;

/**
 * Hands one event to the Worker. "keepalive" lets the request finish even if
 * the reader leaves the page meanwhile. Nothing waits for the answer, and a
 * failure is ignored: counting is never worth an error on screen.
 */
function postToWorker(body: string): void {
  try {
    void fetch(API.event, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // The same as a failed request: ignored.
  }
}

/** Turns counting on or off and says where events go. `post` is given the event as JSON text. */
export function initEvents(
  enabled: boolean,
  postFn: (body: string) => void = postToWorker,
  options: EventOptions = {},
): void {
  on = enabled;
  post = postFn;
  strict = options.strict === true;
}

function send(body: { name: string; path: string | null; value?: string }): void {
  if (!isEventBody(body)) {
    if (strict) throw new Error(`events: not an event the contract lists: ${JSON.stringify(body)}`);
    return;
  }
  const event: EventBody = body;
  if (on) post(JSON.stringify(event));
}

/** Counts one view of a screen, and remembers the screen for the events that follow. */
export function trackPage(route: Route, lang: Lang): void {
  screenPath = eventPath(route, lang);
  send({ name: 'pageview', path: screenPath });
}

/** Counts one thing that happened on the current screen: track('Wallet created', 'passkey'). */
export function track<N extends CountedEvent>(name: N, value: ValueOf<N>): void {
  send({ name, path: screenPath, value });
}
