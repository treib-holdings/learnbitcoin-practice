// The token source the Receive screen hands to wallet.askFaucet()
// (src/screens/receive/bot-check.ts), run here with stand-ins for the
// document, for Turnstile's own object and for the clock: when the script
// is added and what the wallet is told first, what the widget is drawn for,
// every way a check can end without a token, and the reason the screen is
// given for each.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TURNSTILE_SCRIPT } from '../src/lib/turnstile.ts';
import {
  BOT_CHECK_WAIT_MS,
  NORMAL_WIDGET_WIDTH,
  isNarrow,
  makeBotCheck,
  type NoToken,
  type ScriptTag,
  type WidgetTarget,
} from '../src/screens/receive/bot-check.ts';

const ADDRESS = 'bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk';
const OTHER_ADDRESS = 'bcrt1qd7spv5q28348xl4myc8zmh983w5jx32cs707jh';

/** Lets every promise that is ready run. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

class FakeScript implements ScriptTag {
  src = '';
  removed = false;
  private readonly listeners: Record<string, (() => void)[]> = { load: [], error: [] };

  addEventListener(type: 'load' | 'error', listener: () => void): void {
    this.listeners[type]!.push(listener);
  }

  remove(): void {
    this.removed = true;
  }

  fire(type: 'load' | 'error'): void {
    for (const listener of this.listeners[type]!) listener();
  }
}

/** One widget the fake script was asked to draw. */
interface Drawn {
  id: string;
  container: unknown;
  options: Record<string, unknown>;
  removed: boolean;
}

/** A clock that only moves when a test says so. */
class Clock {
  private waiting: { id: number; at: number; run: () => void }[] = [];
  private made = 0;
  now = 0;

  set = (run: () => void, ms: number): unknown => {
    this.made += 1;
    this.waiting.push({ id: this.made, at: this.now + ms, run });
    return this.made;
  };

  clear = (handle: unknown): void => {
    this.waiting = this.waiting.filter((timer) => timer.id !== handle);
  };

  /** In how many ms each timer that is set will run. */
  dueIn(): number[] {
    return this.waiting.map((timer) => timer.at - this.now).sort((a, b) => a - b);
  }

  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    await flush();
    for (;;) {
      const due = this.waiting.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.clear(due.id);
      this.now = due.at;
      due.run();
      await flush();
    }
    this.now = end;
  }
}

/** A page with no bot check in it yet, and everything a test wants to see of what the token source does to it. */
function world(options: { waitMs?: number; before?: () => void; drawn?: () => void; ended?: (why: NoToken) => void } = {}) {
  const clock = new Clock();
  /** What happened, in order: "before", "script", "render", "drawn", "remove". */
  const log: string[] = [];
  /** The reason the screen was given for each check that ended without a token, in order. */
  const why: NoToken[] = [];
  const scripts: FakeScript[] = [];
  const drawn: Drawn[] = [];
  let turnstile: unknown;
  let target: WidgetTarget<string> | null = { container: 'the box', width: 320, siteKey: 'site-key', address: ADDRESS, lang: 'en' };

  /** What the script defines once it has run: Turnstile's render and remove. */
  const api = {
    render(container: unknown, given: Record<string, unknown>): string {
      const id = `widget-${drawn.length + 1}`;
      drawn.push({ id, container, options: given, removed: false });
      log.push('render');
      return id;
    },
    remove(id: string): void {
      const widget = drawn.find((each) => each.id === id);
      if (!widget || widget.removed) throw new Error(`no widget ${id}`);
      widget.removed = true;
      log.push('remove');
    },
  };

  const check = makeBotCheck<FakeScript, string>({
    before: () => {
      log.push('before');
      options.before?.();
    },
    document: {
      createElement: () => {
        const script = new FakeScript();
        scripts.push(script);
        return script;
      },
      head: {
        append: (script) => {
          assert.equal(script.src, TURNSTILE_SCRIPT, 'the element has its address before it is added');
          log.push('script');
        },
      },
    },
    turnstile: () => turnstile,
    target: () => target,
    timers: clock,
    drawn: () => {
      log.push('drawn');
      options.drawn?.();
    },
    ended: (reason) => {
      why.push(reason);
      options.ended?.(reason);
    },
    waitMs: options.waitMs,
  });

  return {
    check,
    clock,
    log,
    why,
    scripts,
    drawn,
    /** The script arrives and runs. */
    load(index = scripts.length - 1): void {
      turnstile = api;
      scripts[index]!.fire('load');
    },
    setTurnstile(value: unknown): void {
      turnstile = value;
    },
    setTarget(next: Partial<WidgetTarget<string>> | null): void {
      target = next === null ? null : { ...target!, ...next };
    },
    /** Calls one of the newest widget's callbacks, as the script would. */
    tell(name: string, ...values: unknown[]): unknown {
      const callback = drawn.at(-1)!.options[name];
      assert.equal(typeof callback, 'function', name);
      return (callback as (...given: unknown[]) => unknown)(...values);
    },
  };
}

/** A promise's answer, or "pending" when it has none yet. */
async function answerOf(promise: Promise<string | null>): Promise<string | null | 'pending'> {
  let answer: string | null | 'pending' = 'pending';
  void promise.then((value) => (answer = value));
  await flush();
  return answer;
}

// -- the script ---------------------------------------------------------------------

test('nothing of the bot check is in the page until a token is asked for', () => {
  const w = world();
  assert.deepEqual(w.log, []);
  assert.equal(w.scripts.length, 0);
  assert.deepEqual(w.clock.dueIn(), []);
});

test('the first call tells the wallet, then adds the script, and draws nothing until the script has loaded', async () => {
  const w = world();
  const token = w.check.token(false);
  await flush();
  // The wallet first (it drops a passkey wallet's keys), then the script's element.
  assert.deepEqual(w.log, ['before', 'script']);
  assert.equal(w.scripts[0]!.src, TURNSTILE_SCRIPT);
  assert.equal(await answerOf(token), 'pending');

  w.load();
  await flush();
  // The screen is told that a widget is on it: the reader may have a box to tick.
  assert.deepEqual(w.log, ['before', 'script', 'render', 'drawn']);
  assert.equal(await answerOf(token), 'pending');

  w.tell('callback', 'the-token');
  assert.equal(await token, 'the-token');
  // A check that gave its token has no reason to give.
  assert.deepEqual(w.why, []);
});

test('the widget is drawn in the screen\'s container, for the action "faucet" and the address on screen', async () => {
  const w = world();
  const token = w.check.token(false);
  w.load();
  await flush();
  const { container, options } = w.drawn[0]!;
  assert.equal(container, 'the box');
  assert.equal(options.sitekey, 'site-key');
  assert.equal(options.action, 'faucet');
  assert.equal(options.cData, ADDRESS);
  assert.equal(options.language, 'en');
  assert.equal(options.size, 'normal');
  for (const name of ['callback', 'error-callback', 'expired-callback', 'timeout-callback']) {
    assert.equal(typeof options[name], 'function', name);
  }
  w.tell('callback', 't');
  await token;
});

test('the widget is compact where the container has no room for the normal one', async () => {
  assert.equal(NORMAL_WIDGET_WIDTH, 300);
  assert.equal(isNarrow(299), true);
  assert.equal(isNarrow(300), false);
  assert.equal(isNarrow(0), true);
  assert.equal(isNarrow(Number.NaN), true);

  const w = world();
  // The faucet's card on a 375 px phone leaves 287 px.
  w.setTarget({ width: 287, lang: 'es' });
  const token = w.check.token(false);
  w.load();
  await flush();
  assert.equal(w.drawn[0]!.options.size, 'compact');
  assert.equal(w.drawn[0]!.options.language, 'es');
  w.tell('callback', 't');
  await token;
});

test('a widget that has given its token is taken away, once the script is done telling', async () => {
  const w = world();
  const token = w.check.token(false);
  w.load();
  await flush();
  w.tell('callback', 'the-token');
  // Not from inside the widget's own callback.
  assert.equal(w.drawn[0]!.removed, false);
  assert.equal(await token, 'the-token');
  await w.clock.advance(0);
  assert.equal(w.drawn[0]!.removed, true);
  // Nothing is left running: no clock, no widget.
  assert.deepEqual(w.clock.dueIn(), []);
});

test('a later call adds no second script and tells the wallet nothing new; it draws a widget for the address then on screen', async () => {
  const w = world();
  const first = w.check.token(false);
  w.load();
  await flush();
  w.tell('callback', 'one');
  assert.equal(await first, 'one');
  await w.clock.advance(0);

  // The reader has moved on to a new address and asks again.
  w.setTarget({ address: OTHER_ADDRESS });
  for (const fresh of [false, true]) {
    const next = w.check.token(fresh);
    await flush();
    assert.equal(w.scripts.length, 1, 'one script element for the life of the page');
    assert.equal(w.log.filter((entry) => entry === 'before').length, 1);
    assert.equal(w.drawn.at(-1)!.options.cData, OTHER_ADDRESS);
    w.tell('callback', 'next');
    assert.equal(await next, 'next');
    await w.clock.advance(0);
  }
  // Three checks, three widgets, each taken away: a fresh token is never an old widget run again.
  assert.equal(w.drawn.length, 3);
  assert.deepEqual(w.drawn.map((widget) => widget.removed), [true, true, true]);
});

test('a script that cannot load gives no token, and the next call tries again with a new element', async () => {
  const w = world();
  const token = w.check.token(false);
  await flush();
  w.scripts[0]!.fire('error');
  assert.equal(await token, null);
  assert.deepEqual(w.why, ['no-widget']);
  assert.equal(w.scripts[0]!.removed, true);
  assert.equal(w.drawn.length, 0);
  await w.clock.advance(0);
  assert.deepEqual(w.clock.dueIn(), [], 'the clock of a check that is over is stopped');

  const again = w.check.token(false);
  await flush();
  assert.equal(w.scripts.length, 2);
  // Nothing was drawn the first time, so the screen was told of no widget.
  assert.deepEqual(w.log, ['before', 'script', 'before', 'script']);
  w.load();
  await flush();
  w.tell('callback', 'second-try');
  assert.equal(await again, 'second-try');
});

test('a script that loads and defines nothing usable gives no token', async () => {
  const w = world();
  const token = w.check.token(false);
  await flush();
  // What a content blocker can leave in the script's place.
  w.setTurnstile({});
  w.scripts[0]!.fire('load');
  assert.equal(await token, null);
  assert.deepEqual(w.why, ['no-widget']);
  assert.equal(w.scripts[0]!.removed, true);
  assert.equal(w.drawn.length, 0);
});

test('if the wallet cannot be told, no script is added', async () => {
  const w = world({
    before: () => {
      throw new Error('the keys were not dropped');
    },
  });
  assert.equal(await w.check.token(false), null);
  assert.deepEqual(w.log, ['before']);
  assert.deepEqual(w.why, ['no-widget']);
});

// -- the ways a check ends without a token ------------------------------------------

test('an error from the widget gives no token; it is marked as dealt with, however often it comes', async () => {
  const w = world();
  const token = w.check.token(false);
  w.load();
  await flush();
  // True tells the script that the page has dealt with the error.
  assert.equal(w.tell('error-callback', '600010'), true);
  assert.equal(await token, null);
  // The widget tries again by itself and fails again before it is taken away.
  assert.equal(w.tell('error-callback', '600010'), true);
  // The screen is given the reason once, however often the widget reports.
  assert.deepEqual(w.why, ['error']);
  await w.clock.advance(0);
  assert.equal(w.drawn[0]!.removed, true);
  // A token that comes after all is nobody's.
  w.tell('callback', 'too-late');
  await flush();
  assert.equal(w.drawn.length, 1);
});

test('a check that never answers ends after a minute, with the widget taken away', async () => {
  assert.equal(BOT_CHECK_WAIT_MS, 60_000);
  const w = world();
  const token = w.check.token(false);
  w.load();
  await flush();
  await w.clock.advance(BOT_CHECK_WAIT_MS - 1);
  assert.equal(await answerOf(token), 'pending');
  assert.equal(w.drawn[0]!.removed, false);
  await w.clock.advance(1);
  assert.equal(await token, null);
  // The widget was on the page and reported no error: it got no answer. With a box on screen, the box was waiting.
  assert.deepEqual(w.why, ['unanswered']);
  await w.clock.advance(0);
  assert.equal(w.drawn[0]!.removed, true);
});

test('the screen is given the reason while the widget is still on the page, and before the wallet has its answer', async () => {
  const seen: string[] = [];
  const w = world({ ended: (why) => seen.push(`${why}: widget ${w.drawn[0]!.removed ? 'gone' : 'there'}`) });
  const token = w.check.token(false);
  void token.then(() => seen.push('the wallet has its answer'));
  w.load();
  await flush();
  await w.clock.advance(BOT_CHECK_WAIT_MS);
  assert.deepEqual(seen, ['unanswered: widget there', 'the wallet has its answer']);
  assert.equal(w.drawn[0]!.removed, true);
});

test('a screen that throws when given the reason does not hold the wallet up', async () => {
  const w = world({
    ended: () => {
      throw new Error("the screen's own trouble");
    },
  });
  const token = w.check.token(false);
  w.load();
  await flush();
  w.tell('error-callback', '600010');
  assert.equal(await token, null);
  await w.clock.advance(0);
  assert.equal(w.drawn[0]!.removed, true);
});

test('the same clock covers a script that never arrives', async () => {
  const w = world({ waitMs: 5_000 });
  const token = w.check.token(false);
  await w.clock.advance(5_000);
  assert.equal(await token, null);
  // No widget was ever on the page: this is no box that waited for a tick.
  assert.deepEqual(w.why, ['no-widget']);
  // The script arrives after all: nothing is drawn for a check that is over.
  w.load();
  await flush();
  assert.equal(w.drawn.length, 0);
  // And the next call finds the script in the page: no second element.
  const again = w.check.token(false);
  await flush();
  assert.equal(w.scripts.length, 1);
  w.tell('callback', 'now');
  assert.equal(await again, 'now');
});

test('the reader not ticking the box in time does not end the check: the widget starts over by itself', async () => {
  const w = world();
  const token = w.check.token(false);
  w.load();
  await flush();
  w.tell('timeout-callback');
  assert.equal(await answerOf(token), 'pending');
  assert.equal(w.drawn[0]!.removed, false);
  w.tell('callback', 'ticked');
  assert.equal(await token, 'ticked');
});

test('a widget that says its token has expired has none to give', async () => {
  const w = world();
  const token = w.check.token(false);
  w.load();
  await flush();
  w.tell('expired-callback', 'the-expired-token');
  assert.equal(await token, null);
  assert.deepEqual(w.why, ['error']);
  // The token the widget fetches by itself afterwards is not handed out.
  w.tell('callback', 'unasked');
  await w.clock.advance(0);
  assert.equal(w.drawn[0]!.removed, true);
});

test('an empty token, or one that is no text, is no token', async () => {
  for (const value of ['', undefined, 42]) {
    const w = world();
    const token = w.check.token(false);
    w.load();
    await flush();
    w.tell('callback', value);
    assert.equal(await token, null, String(value));
    assert.deepEqual(w.why, ['error'], String(value));
  }
});

test('with nothing to draw the widget in, or no address to draw it for, there is no token', async () => {
  const w = world();
  w.setTarget(null);
  const token = w.check.token(false);
  w.load();
  assert.equal(await token, null);
  assert.equal(w.drawn.length, 0);
  assert.deepEqual(w.why, ['no-widget']);
});

test('a script that refuses to draw, or gives no widget, gives no token', async () => {
  for (const render of [
    () => {
      throw new Error('render refused');
    },
    () => undefined,
  ]) {
    const w = world();
    // The script is in the page already, so none is added.
    w.setTurnstile({ render, remove: () => {} });
    assert.equal(await w.check.token(false), null);
    assert.equal(w.scripts.length, 0);
    assert.deepEqual(w.clock.dueIn(), []);
    assert.deepEqual(w.why, ['no-widget']);
  }
});

test('a call while a check is under way ends the first with no token and runs its own', async () => {
  const w = world();
  const first = w.check.token(false);
  w.load();
  await flush();
  const second = w.check.token(true);
  assert.equal(await first, null);
  // Ended from outside: nothing the reader did or failed to do.
  assert.deepEqual(w.why, ['stopped']);
  await flush();
  // The first check's widget went before the second was drawn, and the second one stays.
  assert.equal(w.drawn.length, 2);
  assert.equal(w.drawn[0]!.removed, true);
  await w.clock.advance(0);
  assert.equal(w.drawn[1]!.removed, false);
  w.tell('callback', 'second');
  assert.equal(await second, 'second');
});

test('a screen that throws when told of the widget does not cost the reader the token', async () => {
  const w = world({
    drawn: () => {
      throw new Error("the screen's own trouble");
    },
  });
  const token = w.check.token(false);
  w.load();
  await flush();
  w.tell('callback', 'the-token');
  assert.equal(await token, 'the-token');
});

test('close ends a check under way and takes the widget away at once', async () => {
  const w = world();
  const token = w.check.token(false);
  w.load();
  await flush();
  w.check.close();
  assert.equal(await token, null);
  assert.deepEqual(w.why, ['stopped']);
  assert.equal(w.drawn[0]!.removed, true);
  // Closing again, or with nothing drawn, does nothing.
  w.check.close();
  await w.clock.advance(BOT_CHECK_WAIT_MS);
  assert.deepEqual(w.log.filter((entry) => entry === 'remove').length, 1);
});
