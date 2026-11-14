// A stand-in for Cloudflare Turnstile's script, so that a local run never
// touches the network.
//
// The app loads the faucet's bot check from one URL (TURNSTILE_SCRIPT in
// app/src/lib/turnstile.ts). In a hermetic run the browser tools answer that
// URL with the text this file makes. It defines the same global the real
// script does for explicit rendering:
//
//   turnstile.render(container, options)   draws the widget, returns its ID
//   turnstile.reset(id)                    runs the check again
//   turnstile.remove(id)                   takes the widget away, calls nothing
//   turnstile.getResponse(id)              the token, or undefined
//   turnstile.isExpired(id), turnstile.execute(id), turnstile.ready(fn)
//
// and a scenario chooses how the check ends:
//
//   pass     "callback" gets Cloudflare's dummy token after a short delay
//   fail     "error-callback" gets an error code after the same delay. Then,
//            as the real widget does unless the page passed retry: "never",
//            the check runs again by itself after a wait, and the page is
//            told again: the error once more, or a token if the scenario has
//            changed the ending in the meantime. So the error-callback can
//            be called many times, and a token can arrive unasked.
//   never    nothing is ever called (a check that is still running)
//   timeout  nothing is called for a while (a reader who does not tick the
//            box); then "timeout-callback" is, and the check starts over,
//            unless the page passed refresh-timeout "manual" or "never"
//   expire   as pass; a moment later the token expires ("expired-callback",
//            which is handed the token that expired), and then, as the real
//            widget does unless told otherwise, a new token arrives by
//            itself. Only a widget's first token expires.
//
// It refuses what the real script refuses: no container, no site key, an
// action or cData with characters Turnstile does not take, a failed check
// with no error-callback to tell, reset() or getResponse() for a widget that
// is not there, and ready() when the script's own element is async or defer.
// Each is thrown as an error, so a mistake in the page fails the run instead
// of passing unseen.
//
// That last one matters to a page that adds the script when it is needed, as
// this app does: a script element made by code is async unless the code sets
// its "async" to false, and then the real turnstile.ready() throws. Wait for
// the element's load event instead, or name a function with onload=<name> in
// the address.
//
// Loaded a second time, the script leaves the first copy in place and only
// says so, as the real one does: the widgets already drawn stay in its care.
//
// What it is not: there is no frame, no hidden form field and no real check
// of any kind. The box it draws is always visible, also with appearance
// "interaction-only", so a screenshot shows where the widget sits and how
// much room it takes. The real widget waits two seconds plus the page's
// "retry-interval" (eight seconds unless the page says otherwise) before it
// tries a failed check again; the stand-in waits as long as the scenario
// says (retryMs), whatever the page passed.
//
// The page's security policy allows no style attribute in markup, so the box
// is styled through its style object, which the policy does not restrict.

/** The token Cloudflare's test site keys hand out ("pnpm dev" gets it from the real widget). */
export const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/** How a check ends. See the top of this file. */
export const TURNSTILE_MODES = ['pass', 'fail', 'never', 'timeout', 'expire'] as const;
export type TurnstileMode = (typeof TURNSTILE_MODES)[number];

/** The error code the stand-in reports in "fail" mode: one of Turnstile's own "challenge failed" codes. */
export const FAIL_CODE = '600010';

export interface TurnstileTiming {
  /** How long a check takes, in ms. Default 50. */
  delayMs?: number;
  /** In "expire" mode: how long the first token lives, in ms. Default 400. */
  expireMs?: number;
  /** In "fail" mode: how long after a failure the check runs again by itself, in ms. Default 2000. */
  retryMs?: number;
  /** In "timeout" mode: how long the widget waits for the reader before it calls "timeout-callback", in ms. Default 400. */
  timeoutMs?: number;
}

/** What the stand-in is told when it is made. Plain data: it travels to the page as JSON. */
interface Settings {
  mode: TurnstileMode;
  delayMs: number;
  expireMs: number;
  retryMs: number;
  timeoutMs: number;
  token: string;
  failCode: string;
  /** The name of a function of the page to tell every call to, as JSON text. Empty: nobody is told. */
  report: string;
}

/** One thing the page asked of the widget. A render's options are kept without their callbacks. */
export interface StandInCall {
  op: 'render' | 'reset' | 'remove' | 'execute';
  id: string;
  options?: Record<string, unknown>;
  callbacks?: string[];
}

/** What the stand-in keeps where a test can read it: window.turnstile.__standIn. */
export interface StandInState {
  /** Can be changed while the page runs: the next check ends this way. */
  mode: TurnstileMode;
  delayMs: number;
  expireMs: number;
  retryMs: number;
  timeoutMs: number;
  /** What the page asked of the widget in this document, oldest first. */
  calls: StandInCall[];
}

/**
 * The stand-in itself. It runs in the page, not here: its source text is
 * sent as the script, so it may use nothing from outside its own body.
 */
function standIn(settings: Settings): void {
  interface Widget {
    id: string;
    box: HTMLElement;
    options: Record<string, unknown>;
    token: string | undefined;
    expired: boolean;
    /** How many checks this widget has run. */
    runs: number;
    timers: number[];
  }

  // The real script takes two things from its own URL. "render=explicit" is
  // how the app must load it: without that the real script searches the page
  // for widgets to draw, which this stand-in does not do. "onload=<name>"
  // names a global function to call once the script is ready.
  const script = document.currentScript;
  const query = script instanceof HTMLScriptElement && script.src !== '' ? new URL(script.src).searchParams : null;
  /** Calls the function that onload=<name> names. The real script does so on every load, a second one included. */
  const announce = (): void => {
    const onload = query?.get('onload');
    if (!onload) return;
    const ready = (window as unknown as Record<string, unknown>)[onload];
    if (typeof ready === 'function') window.setTimeout(ready, 0);
    else console.error(`[stand-in bot check] onload names ${onload}, which is not a function of this page`);
  };

  // A second load: the real script keeps its first copy and only warns.
  // Replacing it would orphan the widgets already drawn (no reset, no remove).
  const earlier = (window as unknown as { turnstile?: { __standIn?: unknown } }).turnstile;
  if (typeof earlier === 'object' && earlier !== null && earlier.__standIn !== undefined) {
    console.warn('[stand-in bot check] loaded a second time: the first copy stays in place, as with the real script');
    announce();
    return;
  }

  // The real script refuses turnstile.ready() when its own element is async
  // or defer. An element that code adds to the page is async unless the code
  // sets its "async" to false.
  const loadedAsync = script instanceof HTMLScriptElement && (script.async || script.defer);

  const widgets = new Map<string, Widget>();
  const state: StandInState = {
    mode: settings.mode,
    delayMs: settings.delayMs,
    expireMs: settings.expireMs,
    retryMs: settings.retryMs,
    timeoutMs: settings.timeoutMs,
    calls: [],
  };
  let made = 0;

  const fail = (message: string): never => {
    throw new Error(`[stand-in bot check] ${message}`);
  };

  /** Keeps a call where a test can read it, and tells the harness when it listens (it remembers across reloads). */
  function note(call: StandInCall): void {
    state.calls.push(call);
    const listener = settings.report === '' ? undefined : (window as unknown as Record<string, unknown>)[settings.report];
    if (typeof listener === 'function') listener(JSON.stringify(call));
  }

  /** The widget a caller means: by ID, by its container, or the first one when nothing is said. */
  function find(target: unknown): Widget | undefined {
    if (target === undefined) return widgets.values().next().value;
    if (typeof target === 'string' && widgets.has(target)) return widgets.get(target);
    let container: unknown = target;
    if (typeof target === 'string') {
      try {
        container = document.querySelector(target);
      } catch {
        return undefined; // not an ID and not a selector either
      }
    }
    for (const widget of widgets.values()) {
      if (widget.box.parentElement === container) return widget;
    }
    return undefined;
  }

  function stop(widget: Widget): void {
    for (const timer of widget.timers.splice(0)) window.clearTimeout(timer);
  }

  function later(widget: Widget, ms: number, work: () => void): void {
    widget.timers.push(window.setTimeout(work, ms));
  }

  function tell(widget: Widget, name: string, ...values: unknown[]): unknown {
    const callback = widget.options[name];
    return typeof callback === 'function' ? callback(...values) : undefined;
  }

  /** One check: nothing, a failure, a timeout, or a token. */
  function run(widget: Widget): void {
    stop(widget);
    // A widget the page has taken away runs nothing more: remove() "calls nothing".
    if (!widgets.has(widget.id)) return;
    widget.token = undefined;
    widget.expired = false;
    widget.runs += 1;
    const mode = state.mode;
    widget.box.textContent = `Stand-in bot check: ${mode}`;
    if (mode === 'never') return;
    if (mode === 'timeout') {
      later(widget, state.timeoutMs, () => {
        const before = widget.runs;
        tell(widget, 'timeout-callback');
        // The real widget then starts over by itself, unless the page asked to do
        // that by hand or not at all, or has just reset the widget in its callback.
        if (widget.runs === before && (widget.options['refresh-timeout'] ?? 'auto') === 'auto') run(widget);
      });
      return;
    }
    later(widget, state.delayMs, () => {
      if (mode === 'fail') {
        // As the real widget: unless the page passed retry: "never", the check
        // runs again by itself after a wait. Set up before the page is told,
        // so that a page which resets or removes the widget in its callback
        // cancels it.
        if ((widget.options.retry ?? 'auto') === 'auto') later(widget, state.retryMs, () => run(widget));
        if (typeof widget.options['error-callback'] !== 'function') {
          fail('the check failed and the page gave no error-callback (the real widget throws here too)');
        }
        // The real widget logs the code unless the page says it has dealt with it.
        if (!tell(widget, 'error-callback', settings.failCode)) {
          console.warn(`[stand-in bot check] error ${settings.failCode}: the error-callback did not return true`);
        }
        return;
      }
      widget.token = settings.token;
      tell(widget, 'callback', settings.token);
      if (mode === 'expire' && widget.runs === 1) {
        later(widget, state.expireMs, () => {
          const expired = widget.token;
          widget.token = undefined;
          widget.expired = true;
          // The real widget hands the callback the token that has just expired.
          tell(widget, 'expired-callback', expired);
          if ((widget.options['refresh-expired'] ?? 'auto') === 'auto') run(widget);
        });
      }
    });
  }

  function render(target: unknown, options: unknown): string {
    const container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(container instanceof HTMLElement)) return fail('render: the container is not an element of this page');
    if (typeof options !== 'object' || options === null) return fail('render: no options');
    const given = options as Record<string, unknown>;
    if (typeof given.sitekey !== 'string' || given.sitekey === '') fail('render: no sitekey');
    // Turnstile takes up to 32 characters for the action and 255 for cData, from letters, digits, "_" and "-".
    if (given.action !== undefined && !(typeof given.action === 'string' && /^[A-Za-z0-9_-]{0,32}$/.test(given.action))) {
      fail('render: not an action Turnstile takes');
    }
    if (given.cData !== undefined && !(typeof given.cData === 'string' && /^[A-Za-z0-9_-]{0,255}$/.test(given.cData))) {
      fail('render: not a cData Turnstile takes');
    }
    const callbacks: string[] = [];
    for (const name of Object.keys(given)) {
      if (!name.endsWith('callback')) continue;
      if (typeof given[name] !== 'function') fail(`render: ${name} is not a function`);
      callbacks.push(name);
    }
    const already = find(container);
    if (already) {
      console.warn('[stand-in bot check] render: this container already holds a widget');
      return already.id;
    }

    made += 1;
    const id = `stand-in-${made}`;
    const box = document.createElement('div');
    box.setAttribute('data-stand-in-bot-check', id);
    // The sizes of the real widget: normal 300 x 65, compact 150 x 140, flexible as wide as its container.
    const compact = given.size === 'compact';
    box.style.boxSizing = 'border-box';
    box.style.width = given.size === 'flexible' ? '100%' : compact ? '150px' : '300px';
    box.style.minWidth = given.size === 'flexible' ? '300px' : '';
    box.style.height = compact ? '140px' : '65px';
    box.style.padding = '8px';
    box.style.border = '1px dashed #6b7488';
    box.style.font = '12px/1.3 ui-monospace, monospace';
    box.style.color = '#2e3a52';
    box.style.overflow = 'hidden';
    container.append(box);

    const widget: Widget = { id, box, options: given, token: undefined, expired: false, runs: 0, timers: [] };
    widgets.set(id, widget);
    // Without the callbacks: the rest is plain data a test can read back.
    const kept: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(given)) {
      if (typeof value !== 'function') kept[name] = value;
    }
    note({ op: 'render', id, options: kept, callbacks });
    if (given.execution === 'execute') box.textContent = 'Stand-in bot check: waiting for execute()';
    else run(widget);
    return id;
  }

  const api = {
    render,
    reset(target?: unknown): void {
      const widget = find(target);
      // The real script throws here ("Nothing to reset found for provided container").
      if (!widget) return fail('reset: no such widget (the real script throws here too)');
      note({ op: 'reset', id: widget.id });
      run(widget);
    },
    remove(target?: unknown): void {
      const widget = find(target);
      if (!widget) return console.warn('[stand-in bot check] remove: no such widget');
      note({ op: 'remove', id: widget.id });
      stop(widget);
      widget.box.remove();
      widgets.delete(widget.id);
    },
    execute(target?: unknown): void {
      const widget = find(target);
      if (!widget) return fail('execute: no such widget');
      note({ op: 'execute', id: widget.id });
      run(widget);
    },
    getResponse(target?: unknown): string | undefined {
      const widget = find(target);
      // The real script throws here ("Could not find widget for provided container").
      if (!widget) return fail('getResponse: no such widget (the real script throws here too)');
      return widget.token;
    },
    isExpired(target?: unknown): boolean {
      return find(target)?.expired ?? false;
    },
    ready(work: unknown): void {
      if (loadedAsync) {
        fail(
          'ready: the script element is async or defer (one that code adds to the page is async unless its "async" is set to false). ' +
            "The real script throws here. Use the element's load event, or onload=<name> in the address",
        );
      }
      if (typeof work === 'function') work();
    },
    __standIn: state,
  };
  (window as unknown as { turnstile: typeof api }).turnstile = api;

  if (query && query.get('render') !== 'explicit') {
    console.error('[stand-in bot check] loaded without render=explicit: the real script would draw widgets by itself');
  }
  announce();
}

/**
 * The script text to answer Turnstile's URL with. `standIn` is sent as it is
 * written above (Node runs this file with its type annotations blanked out,
 * so the function's own text is plain JavaScript) and called with its settings.
 * `report` names a function of the page that is told every call as JSON text:
 * the browser tools use it to remember what a page asked across reloads.
 */
export function fakeTurnstileScript(mode: TurnstileMode = 'pass', timing: TurnstileTiming = {}, report = ''): string {
  if (!TURNSTILE_MODES.includes(mode)) throw new Error(`fakeTurnstileScript: no such mode: ${String(mode)}`);
  const settings: Settings = {
    mode,
    delayMs: timing.delayMs ?? 50,
    expireMs: timing.expireMs ?? 400,
    retryMs: timing.retryMs ?? 2000,
    timeoutMs: timing.timeoutMs ?? 400,
    token: DUMMY_TOKEN,
    failCode: FAIL_CODE,
    report,
  };
  return `(${standIn.toString()})(${JSON.stringify(settings)});\n`;
}
