// The faucet's bot check (Cloudflare Turnstile): how its widget is set up.
//
// Turnstile is the one piece of other people's code this site ever loads, and
// it loads only when the reader asks the faucet for coins. Adding the script
// to the page and drawing the widget need a browser, so that part lives with
// the Receive screen. What is here can be tested without one.

import type { Lang } from '@learnbitcoin/practice-contract';

/**
 * Turnstile's script. "render=explicit" tells it not to search the page for
 * widgets to draw: the app draws its one widget itself, with the options below.
 */
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * The options for turnstile.render(). The caller adds its own callbacks
 * ("callback", "error-callback", "expired-callback", "timeout-callback").
 */
export function faucetWidgetOptions(
  siteKey: string,
  address: string,
  lang: Lang,
  narrow: boolean,
): Record<string, unknown> {
  return {
    sitekey: siteKey,
    // The Worker accepts a token only if it was made for this action...
    action: 'faucet',
    // ...and for this address, so one solved check cannot pay another address.
    cData: address,
    // If Cloudflare asks the reader to tick a box, it asks in the page's language.
    language: lang,
    // Nothing is drawn unless the reader has to do something.
    appearance: 'interaction-only',
    // There is no form here. The token arrives in the callback, so Turnstile's
    // hidden form field is not wanted.
    'response-field': false,
    // The normal widget is 300 px wide, too wide for a small phone once the
    // page's margins are taken off. The compact one is 150 px.
    size: narrow ? 'compact' : 'normal',
  };
}
