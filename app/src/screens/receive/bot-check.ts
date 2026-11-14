// The faucet's bot check as the Receive screen runs it: Cloudflare
// Turnstile's script, added to the page when the reader asks for coins and
// not before, and one widget, drawn for the address on screen.
//
// makeBotCheck() gives the token source that wallet.askFaucet() is handed.
// Each time the wallet asks it for a token:
//
//   1. The script. The first time, the wallet is told that the bot check is
//      about to load (it drops a passkey wallet's keys, and from then on
//      every move to another screen loads the page afresh). Then a script
//      element is added, and its load event is waited for.
//   2. The widget. One is drawn in the screen's container for the action
//      "faucet" and the address on screen (lib/turnstile.ts has the
//      options), compact where there is no room for the normal one.
//   3. The answer. The token, the moment the widget hands it over. Or null,
//      when there is none to be had: the script did not load, the widget
//      reported an error, or nothing came within BOT_CHECK_WAIT_MS. The
//      wallet is told only "no token". The screen is told which of these it
//      was (NoToken), because the way out is not the same: a widget that
//      was on screen and got no answer may have been a box waiting for a
//      tick, and that is no content blocker.
//
// Whatever the answer, the widget is taken away once it has given it. So no
// check runs in the page that the reader did not ask for: left alone, a
// widget tries a failed check again every few seconds, and fetches a new
// token whenever its last one expires. It also means a token is never kept
// here. Every call draws the widget anew, for the address that is on screen
// at that moment, whether the wallet asked for a fresh token or a first one.
// (Running an old widget again would not do: it keeps the address it was
// drawn for.)
//
// The browser's parts are handed in (the document, the script's own object,
// the container, a timer), so this file runs under "node --test" with
// stand-ins for them. It never touches the network itself: the script
// element does.

import type { Lang } from '@learnbitcoin/practice-contract';
import { TURNSTILE_SCRIPT, faucetWidgetOptions } from '../../lib/turnstile.ts';
import type { TokenSource } from '../../lib/wallet-api.ts';

/**
 * How long one bot check may take, from the moment the wallet asks to the
 * token, in milliseconds. Most checks are done in a few seconds without the
 * reader doing anything. A minute leaves time to notice a box and tick it,
 * and is not so long that a check which is going nowhere (a blocker stopped
 * its frame) looks like a page that hangs.
 */
export const BOT_CHECK_WAIT_MS = 60_000;

/** The width of Turnstile's normal widget, in CSS pixels. Its compact one is 150 wide and taller. */
export const NORMAL_WIDGET_WIDTH = 300;

/** True when a container this many pixels wide has no room for the normal widget. A width that is no number counts as none. */
export function isNarrow(width: number): boolean {
  return !(width >= NORMAL_WIDGET_WIDTH);
}

/**
 * Why a check gave no token:
 *   no-widget   no widget was drawn: the script did not arrive, or defined
 *               nothing that can draw one, or would not draw
 *   error       the widget was drawn and reported an error, or handed over
 *               nothing usable (an empty token, an expired one)
 *   unanswered  the widget was drawn, reported no error, and nothing came
 *               of it in time. If it was showing a box, the box was
 *               waiting for the reader
 *   stopped     the check was ended from outside: a newer one took its
 *               place, or the screen is leaving
 */
export type NoToken = 'no-widget' | 'error' | 'unanswered' | 'stopped';

/** A script element: as much of one as this file uses. */
export interface ScriptTag {
  src: string;
  addEventListener(type: 'load' | 'error', listener: () => void): void;
  remove(): void;
}

/** A document: as much of one as this file uses. The browser's own fits, with S as HTMLScriptElement. */
export interface ScriptHost<S extends ScriptTag> {
  createElement(tag: 'script'): S;
  head: { append(tag: S): void };
}

/** What the widget is drawn in and for. */
export interface WidgetTarget<C> {
  /** The element the widget goes into. */
  container: C;
  /** How wide that element is, in CSS pixels. */
  width: number;
  siteKey: string;
  /** The address the coins are for: the token is good for this address and no other. */
  address: string;
  lang: Lang;
}

export interface BotCheckDeps<S extends ScriptTag, C> {
  /** wallet.beforeBotCheck. Called before the script's element is added to the page. */
  before: () => void;
  document: ScriptHost<S>;
  /** The script's own object once it has run (window.turnstile), or anything else before that. */
  turnstile: () => unknown;
  /** Read at the moment a widget is drawn. Null: there is nothing to draw it in, or no address to draw it for. */
  target: () => WidgetTarget<C> | null;
  timers: {
    /** Runs `run` once, `ms` from now. Returns whatever clear() needs to stop it. */
    set(run: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
  /**
   * Called each time a widget has been drawn. From there on the check may
   * need the reader: there can be a box to tick.
   */
  drawn?: () => void;
  /**
   * Called when a check ends without a token, with the reason, before the
   * wallet has its answer and while the widget (if one was drawn) is still
   * on the page.
   */
  ended?: (why: NoToken) => void;
  /** In place of BOT_CHECK_WAIT_MS, for tests. */
  waitMs?: number;
}

export interface BotCheck {
  /** For wallet.askFaucet(): runs the check and resolves to its token, or to null when there is none to be had. */
  token: TokenSource;
  /** The screen is leaving: ends a check that is under way and takes the widget away. */
  close(): void;
}

/** Turnstile's own object, as much of it as this file calls. */
interface Turnstile<C> {
  /** Draws a widget and gives its ID. */
  render(container: C, options: Record<string, unknown>): unknown;
  /** Takes a widget away. It calls none of the widget's callbacks. */
  remove(widget: string): void;
}

function turnstileOf<C>(value: unknown): Turnstile<C> | null {
  if (typeof value !== 'object' || value === null) return null;
  const api = value as Partial<Turnstile<C>>;
  return typeof api.render === 'function' && typeof api.remove === 'function' ? (value as Turnstile<C>) : null;
}

export function makeBotCheck<S extends ScriptTag, C>(deps: BotCheckDeps<S, C>): BotCheck {
  const waitMs = deps.waitMs ?? BOT_CHECK_WAIT_MS;
  /** The script on its way into the page. Null before the first try, and again after a try that failed. */
  let loading: Promise<boolean> | null = null;
  /** The widget on screen, by the ID Turnstile gave it. */
  let widget: string | null = null;
  /** Ends the check that is under way with "no token". Null when none is. */
  let giveUp: (() => void) | null = null;

  /** The script's object, or null while the page has none that can draw a widget. */
  function api(): Turnstile<C> | null {
    try {
      return turnstileOf<C>(deps.turnstile());
    } catch {
      return null;
    }
  }

  function takeAway(): void {
    const id = widget;
    widget = null;
    if (id === null) return;
    try {
      api()?.remove(id);
    } catch {
      // Gone already.
    }
  }

  /**
   * Takes the widget away once the script is done with what it is doing.
   * The widget's own callbacks end a check, and the script may still be in
   * the middle of telling them: so not from inside one.
   */
  function takeAwaySoon(): void {
    const id = widget;
    if (id === null) return;
    const later = (): void => {
      // A newer widget has taken its place meanwhile: that one stays.
      if (widget === id) takeAway();
    };
    try {
      deps.timers.set(later, 0);
    } catch {
      later();
    }
  }

  /** Adds the script's element to the page. Resolves to whether the page can now draw a widget. */
  function addScript(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        // The keys first: the script never shares a page with them. Should
        // this throw, no script is added.
        deps.before();
        const tag = deps.document.createElement('script');
        const failed = (): void => {
          // A browser does not fetch a failed script again by itself. With
          // the element gone, the next try adds a new one.
          try {
            tag.remove();
          } catch {
            // It stays, and does nothing.
          }
          resolve(false);
        };
        // An element that code adds is async, and Turnstile's own ready()
        // refuses to work for an async script. Its load event is the signal.
        tag.addEventListener('load', () => (api() !== null ? resolve(true) : failed()));
        tag.addEventListener('error', failed);
        tag.src = TURNSTILE_SCRIPT;
        deps.document.head.append(tag);
      } catch {
        resolve(false);
      }
    });
  }

  /** Resolves to true once the script is in the page and has run. Only the first call, or one after a failure, adds it. */
  function script(): Promise<boolean> {
    if (api() !== null) return Promise.resolve(true);
    if (loading === null) {
      const attempt = addScript().then((ready) => {
        // After a failure the next call tries again.
        if (loading === attempt && !ready) loading = null;
        return ready;
      });
      loading = attempt;
    }
    return loading;
  }

  function token(_fresh: boolean): Promise<string | null> {
    // A check still under way belongs to a request the wallet has given up on.
    giveUp?.();
    return new Promise((resolve) => {
      let over = false;
      /** True once this check has its widget on the page. */
      let drew = false;
      let clock: unknown;
      /** Ends this check, once: with the token, or with null and the reason why there is none. */
      const finish = (value: string | null, why: NoToken): void => {
        if (over) return;
        over = true;
        if (giveUp === stop) giveUp = null;
        try {
          deps.timers.clear(clock);
        } catch {
          // It runs out and finds the check over.
        }
        if (value === null) {
          // Before the widget goes: the screen may want a last look at it.
          try {
            deps.ended?.(why);
          } catch {
            // The screen's own business.
          }
        }
        // The widget has given its answer, or is not going to.
        takeAwaySoon();
        resolve(value);
      };
      const none = (why: NoToken) => (): void => finish(null, why);
      const stop = none('stopped');
      giveUp = stop;
      try {
        // One clock for the script and the widget together: a script that
        // never arrives must not hold the request any longer than a widget
        // that never answers. Which of the two it was is the reason given.
        clock = deps.timers.set(() => finish(null, drew ? 'unanswered' : 'no-widget'), waitMs);
      } catch {
        // No clock to wait by: the wallet's own limit of three minutes still ends the request.
      }

      const draw = (ready: boolean): void => {
        if (over) return;
        const turnstile = api();
        let target: WidgetTarget<C> | null = null;
        try {
          target = deps.target();
        } catch {
          // No target, then.
        }
        if (!ready || turnstile === null || target === null) return finish(null, 'no-widget');
        // Whatever an earlier check left behind goes first: a container holds one widget.
        takeAway();
        try {
          const id = turnstile.render(target.container, {
            ...faucetWidgetOptions(target.siteKey, target.address, target.lang, isNarrow(target.width)),
            callback: (value: unknown) => finish(typeof value === 'string' && value !== '' ? value : null, 'error'),
            // It can be called again and again, since the widget tries a
            // failed check again by itself: the first call ends this check,
            // and the widget is then taken away. Returning true tells the
            // script that the page has dealt with the error.
            'error-callback': () => {
              finish(null, 'error');
              return true;
            },
            // An expired token must not be used. A token is handed over the
            // moment it comes, so there is none here to expire; if the
            // widget says so all the same, this check has no token to give.
            'expired-callback': none('error'),
            // The reader did not tick the box in time. The widget starts
            // over by itself, and this check's own clock goes on.
            'timeout-callback': () => {},
          });
          if (typeof id !== 'string' || id === '') return finish(null, 'no-widget');
          widget = id;
          drew = true;
          // The answer came while the widget was still being drawn.
          if (over) return takeAwaySoon();
        } catch {
          return finish(null, 'no-widget');
        }
        try {
          deps.drawn?.();
        } catch {
          // The screen's own business.
        }
      };
      script().then(draw, none('no-widget'));
    });
  }

  function close(): void {
    giveUp?.();
    takeAway();
  }

  return { token, close };
}
