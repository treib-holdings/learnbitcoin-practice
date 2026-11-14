// The stand-in for the bot check's script, in a real headless page that is
// served under the app's own Content-Security-Policy.
//
// The page here does what the app's Receive screen will do: it adds a script
// element for Turnstile's address and draws one widget with the options of
// faucetWidgetOptions(). The browser tools answer that address with the
// stand-in, so nothing leaves this machine. Each of the stand-in's five
// endings is run, and every page must end clean: a style attribute in what
// the stand-in draws would show here as a violation of the policy.
//
// Where the stand-in refuses something, or does something by itself (a
// second try after a failure, a token handed to the expired-callback), that
// is what Cloudflare's own script does: read in its source, never run here.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { TURNSTILE_SCRIPT, faucetWidgetOptions } from '../../app/src/lib/turnstile.ts';
import { launchChrome, openPage, type Chrome, type OpenOptions, type OpenedPage } from '../src/browser.ts';
import { DUMMY_TOKEN, FAIL_CODE, fakeTurnstileScript, type StandInState } from '../src/fake-turnstile.ts';
import { TEST_SITE_KEY } from '../src/stack.ts';
import { scratchSite } from './scratch-site.ts';

const ADDRESS = 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6';

/** What the scratch page's own script puts on its window. */
interface ScratchWindow {
  /** Every callback the widget made, in order. */
  seen: [name: string, value?: string][];
  /** Adds a script element for `src`, as a page's own code does, and waits for it. `inOrder` sets the element's "async" to false first. */
  load(src: string, inOrder?: boolean): Promise<void>;
  /** Loads the script from `src` and draws one widget in #app with these options plus recording callbacks. */
  start(src: string, options: Record<string, unknown>, withErrorCallback?: boolean): Promise<string>;
  turnstile: {
    render(container: unknown, options: Record<string, unknown>): string;
    reset(id?: string): void;
    remove(id?: string): void;
    getResponse(id?: string): string | undefined;
    isExpired(id?: string): boolean;
    ready(work: () => void): void;
    __standIn: StandInState;
  };
  whenReady?: () => void;
}

/** The scratch page's script: a file of its own origin, since the policy runs nothing else. */
const PAGE_JS = `
window.seen = [];
window.load = function (src, inOrder) {
  return new Promise(function (resolve, reject) {
    var script = document.createElement('script');
    script.src = src;
    if (inOrder) script.async = false;
    script.onload = function () { resolve(); };
    script.onerror = function () { reject(new Error('the script did not load')); };
    document.head.append(script);
  });
};
window.start = function (src, options, withErrorCallback) {
  return window.load(src).then(function () {
    var all = Object.assign({}, options, {
      callback: function (token) { window.seen.push(['callback', token]); },
      // Recorded with whatever it is handed: the real widget hands over the token that expired.
      'expired-callback': function (token) { window.seen.push(['expired', token]); },
      'timeout-callback': function () { window.seen.push(['timeout']); },
    });
    if (withErrorCallback !== false) all['error-callback'] = function (code) { window.seen.push(['error', code]); return true; };
    return window.turnstile.render('#app', all);
  });
};
`;

/** The options the app passes: a narrow Spanish page asking coins for ADDRESS. */
const OPTIONS = faucetWidgetOptions(TEST_SITE_KEY, ADDRESS, 'es', true);

let chrome: Chrome;
let site: Awaited<ReturnType<typeof scratchSite>>;
before(async () => {
  chrome = await launchChrome();
  site = await scratchSite({ 'page.js': PAGE_JS });
});
after(async () => {
  await chrome?.close();
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const seen = (page: OpenedPage) => page.page.evaluate(() => (window as unknown as ScratchWindow).seen);
const start = (page: OpenedPage, src: string = TURNSTILE_SCRIPT, options: Record<string, unknown> = OPTIONS, withErrorCallback = true) =>
  page.page.evaluate((...args) => (window as unknown as ScratchWindow).start(...args), src, options, withErrorCallback);

/** Opens the scratch page, runs the test on it, and closes it. The page must end clean unless the test said what to expect. */
async function onPage(options: OpenOptions, run: (page: OpenedPage) => Promise<void>): Promise<void> {
  const page = await openPage(chrome, site.url, { turnstileTiming: { delayMs: 20, expireMs: 120 }, ...options });
  try {
    await run(page);
    assert.deepEqual(page.problems(), []);
  } finally {
    await page.close();
  }
}

test('the script text is plain JavaScript that carries its settings', () => {
  const text = fakeTurnstileScript('expire', { delayMs: 7, expireMs: 9 });
  // It parses as a script (nothing is run: the function is only compiled).
  assert.doesNotThrow(() => new Function(text));
  // The times a scenario did not set are the stand-in's own: two seconds before a failed check is tried again.
  assert.match(text, /"mode":"expire","delayMs":7,"expireMs":9,"retryMs":2000,"timeoutMs":400,"token":"XXXX\.DUMMY\.TOKEN\.XXXX"/);
  assert.match(fakeTurnstileScript('fail', { retryMs: 11, timeoutMs: 13 }), /"mode":"fail","delayMs":50,"expireMs":400,"retryMs":11,"timeoutMs":13,/);
  // Nobody is told of the page's calls unless the caller names a listener (the browser tools do).
  assert.match(text, /"report":""\}\);\n$/);
  assert.match(fakeTurnstileScript('pass', {}, '__listener'), /"report":"__listener"\}\);\n$/);
  // No style attribute and no markup with one: the box is styled through its style object.
  assert.doesNotMatch(text, /setAttribute\(\s*['"]style|style\s*=\s*\\?["']|innerHTML|cssText/);
  assert.throws(() => fakeTurnstileScript('sometimes' as 'pass'), /no such mode/);
});

test('pass: the page gets Cloudflare\'s dummy token, from a box drawn under the page\'s policy', async () => {
  await onPage({ turnstile: 'pass' }, async (page) => {
    const id = await start(page);
    assert.match(id, /^stand-in-/);
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.length > 0);
    assert.deepEqual(await seen(page), [['callback', DUMMY_TOKEN]]);
    assert.equal(await page.page.evaluate((widget) => (window as unknown as ScratchWindow).turnstile.getResponse(widget), id), DUMMY_TOKEN);
    assert.equal(await page.page.evaluate(() => (window as unknown as ScratchWindow).turnstile.isExpired()), false);

    // The box: labelled, and the size of the real compact widget.
    const box = await page.page.$eval('#app [data-stand-in-bot-check]', (element) => {
      const rect = element.getBoundingClientRect();
      return { text: element.textContent, width: rect.width, height: rect.height };
    });
    assert.deepEqual(box, { text: 'Stand-in bot check: pass', width: 150, height: 140 });

    // The script came from the harness, not from the network: the page asked for Turnstile's own address and was answered.
    const script = page.responses.find((response) => response.url === TURNSTILE_SCRIPT);
    assert.deepEqual([script?.status, script?.headers['content-type']], [200, 'text/javascript; charset=utf-8']);
    assert.deepEqual(page.failures, []);

    // What the page asked of the widget is kept: the app's own options, without the callbacks.
    assert.deepEqual(await page.turnstileCalls(), [
      { op: 'render', id, options: OPTIONS, callbacks: ['callback', 'expired-callback', 'timeout-callback', 'error-callback'] },
    ]);
  });
});

test('fail: the error callback gets a code, and there is no token', async () => {
  await onPage({ turnstile: 'fail' }, async (page) => {
    await start(page);
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.length > 0);
    await pause(100);
    assert.deepEqual(await seen(page), [['error', FAIL_CODE]]);
    assert.equal(await page.page.evaluate(() => (window as unknown as ScratchWindow).turnstile.getResponse()), undefined);
    assert.equal(await page.page.$eval('[data-stand-in-bot-check]', (element) => element.textContent), 'Stand-in bot check: fail');
  });
});

test('fail: the widget tries again by itself, so the error comes more than once and a token can arrive unasked', async () => {
  // The app sets no "retry" option, so the real widget's default holds: after a failure it runs the check
  // again by itself. The stand-in does the same, after as long as the scenario says.
  assert.equal('retry' in OPTIONS, false);
  await onPage({ turnstile: 'fail', turnstileTiming: { delayMs: 20, retryMs: 60 } }, async (page) => {
    await start(page);
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.length >= 3);
    assert.deepEqual((await seen(page)).slice(0, 3), [['error', FAIL_CODE], ['error', FAIL_CODE], ['error', FAIL_CODE]]);

    // The check starts to pass (the reader's network is back). Nobody resets the widget, and a token arrives.
    await page.setTurnstile('pass');
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.at(-1)?.[0] === 'callback');
    const after = await seen(page);
    assert.deepEqual(after.at(-1), ['callback', DUMMY_TOKEN]);
    assert.equal(await page.page.evaluate(() => (window as unknown as ScratchWindow).turnstile.getResponse()), DUMMY_TOKEN);
    // A check that passed is not run again.
    await pause(250);
    assert.equal((await seen(page)).length, after.length);
    // The page asked for one widget and nothing else: every other run was the widget's own doing.
    assert.deepEqual((await page.turnstileCalls()).map((call) => call.op), ['render']);
  });
  // A page that says it will try again itself gets one error and no more.
  await onPage({ turnstile: 'fail', turnstileTiming: { delayMs: 20, retryMs: 60 } }, async (page) => {
    await start(page, TURNSTILE_SCRIPT, { ...OPTIONS, retry: 'never' });
    await pause(400);
    assert.deepEqual(await seen(page), [['error', FAIL_CODE]]);
  });
  // A page that takes the widget away after the first error hears nothing more.
  await onPage({ turnstile: 'fail', turnstileTiming: { delayMs: 20, retryMs: 60 } }, async (page) => {
    const id = await start(page);
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.length >= 1);
    await page.page.evaluate((widget) => (window as unknown as ScratchWindow).turnstile.remove(widget), id);
    const heard = (await seen(page)).length;
    await pause(300);
    assert.equal((await seen(page)).length, heard);
  });
});

test('timeout: a reader who does not tick the box; the page is told, and the widget starts over', async () => {
  await onPage({ turnstile: 'timeout', turnstileTiming: { delayMs: 20, timeoutMs: 60 } }, async (page) => {
    await start(page);
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.length >= 2);
    assert.deepEqual((await seen(page)).slice(0, 2), [['timeout'], ['timeout']]);
    assert.equal(await page.page.evaluate(() => (window as unknown as ScratchWindow).turnstile.getResponse()), undefined);
    assert.equal(await page.page.$eval('[data-stand-in-bot-check]', (element) => element.textContent), 'Stand-in bot check: timeout');
    // The reader ticks the box at last: the run that is under way times out once more, and the next one passes.
    await page.setTurnstile('pass');
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.at(-1)?.[0] === 'callback');
    assert.deepEqual((await seen(page)).at(-1), ['callback', DUMMY_TOKEN]);
  });
  // A page that asked to start over by hand is told once, and gets nothing more until it resets the widget.
  await onPage({ turnstile: 'timeout', turnstileTiming: { delayMs: 20, timeoutMs: 60 } }, async (page) => {
    await start(page, TURNSTILE_SCRIPT, { ...OPTIONS, 'refresh-timeout': 'manual' });
    await pause(400);
    assert.deepEqual(await seen(page), [['timeout']]);
    await page.setTurnstile('pass');
    await page.page.evaluate(() => (window as unknown as ScratchWindow).turnstile.reset());
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.length >= 2);
    assert.deepEqual((await seen(page)).at(-1), ['callback', DUMMY_TOKEN]);
  });
});

test('never: the widget is drawn and nothing is ever called', async () => {
  await onPage({ turnstile: 'never' }, async (page) => {
    await start(page);
    await pause(300);
    assert.deepEqual(await seen(page), []);
    assert.equal(await page.page.evaluate(() => (window as unknown as ScratchWindow).turnstile.getResponse()), undefined);
    assert.equal(await page.page.$eval('[data-stand-in-bot-check]', (element) => element.textContent), 'Stand-in bot check: never');
  });
});

test('expire: a token, then it expires, then a fresh one arrives by itself and stays', async () => {
  await onPage({ turnstile: 'expire' }, async (page) => {
    await start(page);
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.length >= 3);
    await pause(400); // long enough for a second expiry, if there were one
    // The expired-callback is handed the token that expired, as the real widget hands it.
    assert.deepEqual(await seen(page), [['callback', DUMMY_TOKEN], ['expired', DUMMY_TOKEN], ['callback', DUMMY_TOKEN]]);
    assert.equal(await page.page.evaluate(() => (window as unknown as ScratchWindow).turnstile.getResponse()), DUMMY_TOKEN);
  });
  // A page that asks to refresh by hand gets no new token until it resets the widget.
  await onPage({ turnstile: 'expire' }, async (page) => {
    await start(page, TURNSTILE_SCRIPT, { ...OPTIONS, 'refresh-expired': 'manual' });
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.length >= 2);
    await pause(300);
    assert.deepEqual(await seen(page), [['callback', DUMMY_TOKEN], ['expired', DUMMY_TOKEN]]);
    assert.deepEqual(
      await page.page.evaluate(() => {
        const { turnstile } = window as unknown as ScratchWindow;
        return { token: typeof turnstile.getResponse(), expired: turnstile.isExpired() };
      }),
      { token: 'undefined', expired: true },
    );
    await page.page.evaluate(() => (window as unknown as ScratchWindow).turnstile.reset());
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.length >= 3);
    assert.deepEqual((await seen(page)).at(-1), ['callback', DUMMY_TOKEN]);
  });
});

test('reset runs the check again, remove takes the widget away, and a scenario can change the ending on the way', async () => {
  await onPage({ turnstile: 'never' }, async (page) => {
    const id = await start(page);
    await pause(100);
    assert.deepEqual(await seen(page), []);

    // The reader "ticks the box" at last: the scenario switches the ending, and the page asks again.
    await page.setTurnstile('pass');
    await page.page.evaluate((widget) => (window as unknown as ScratchWindow).turnstile.reset(widget), id);
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.length === 1);

    await page.setTurnstile('fail');
    await page.page.evaluate((widget) => (window as unknown as ScratchWindow).turnstile.reset(widget), id);
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.length === 2);
    assert.deepEqual(await seen(page), [['callback', DUMMY_TOKEN], ['error', FAIL_CODE]]);

    // remove() in the middle of a check: the box goes, and the callback never comes.
    await page.setTurnstile('pass', { delayMs: 150 });
    await page.page.evaluate((widget) => {
      const { turnstile } = window as unknown as ScratchWindow;
      turnstile.reset(widget);
      turnstile.remove(widget);
    }, id);
    await pause(300);
    assert.equal((await seen(page)).length, 2);
    assert.equal(await page.page.$('[data-stand-in-bot-check]'), null);
    assert.deepEqual((await page.turnstileCalls()).map((call) => call.op), ['render', 'reset', 'reset', 'reset', 'remove']);

    // A page loaded after the switch gets a script with the new ending.
    await page.goto('/');
    await start(page);
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.length === 1);
    assert.deepEqual(await seen(page), [['callback', DUMMY_TOKEN]]);
    // What the page asked before the reload is not forgotten: a scenario's end looks at all of it.
    assert.deepEqual((await page.turnstileCalls()).map((call) => call.op), ['render', 'reset', 'reset', 'reset', 'remove', 'render']);
    // In the page itself only the new document's own calls are kept.
    assert.equal(await page.page.evaluate(() => (window as unknown as ScratchWindow).turnstile.__standIn.calls.length), 1);
  });
});

test('what the real script refuses, the stand-in refuses: the mistake fails the page', async () => {
  const mistakes: [options: Record<string, unknown>, why: RegExp][] = [
    [{ ...OPTIONS, sitekey: '' }, /no sitekey/],
    [{ ...OPTIONS, cData: 'an address with spaces' }, /not a cData Turnstile takes/],
    [{ ...OPTIONS, action: 'faucet!' }, /not an action Turnstile takes/],
    [{ ...OPTIONS, action: 'a'.repeat(33) }, /not an action Turnstile takes/],
  ];
  for (const [options, why] of mistakes) {
    await onPage({ turnstile: 'pass' }, async (page) => {
      await assert.rejects(start(page, TURNSTILE_SCRIPT, options), why);
      assert.equal(await page.page.$('[data-stand-in-bot-check]'), null);
    });
  }
  // A failed check with nobody to tell: the real widget throws, and so does this one, where the run sees it.
  await onPage({ turnstile: 'fail' }, async (page) => {
    page.expectFailure(/the page gave no error-callback/);
    await start(page, TURNSTILE_SCRIPT, OPTIONS, false);
    await pause(150);
    assert.deepEqual(page.failures.map((failure) => failure.kind), ['pageerror']);
  });
  // Loaded the way the app must not load it: without render=explicit the real script would draw widgets by itself.
  await onPage({ turnstile: 'pass' }, async (page) => {
    page.expectFailure(/loaded without render=explicit/);
    await start(page, TURNSTILE_SCRIPT.replace('?render=explicit', ''));
    assert.deepEqual(page.failures.map((failure) => failure.kind), ['console']);
  });
});

/** What a call in the page did: the value it gave, or the words of what it threw. */
const tried = (page: OpenedPage, call: 'reset' | 'getResponse' | 'remove', target?: string) =>
  page.page.evaluate(
    (name, widget) => {
      const { turnstile } = window as unknown as ScratchWindow;
      try {
        return { gave: String(widget === undefined ? turnstile[name]() : turnstile[name](widget)) };
      } catch (error) {
        return { threw: (error as Error).message };
      }
    },
    call,
    target,
  );

test('ready(): refused when the script element is async, which one added by code is', async () => {
  // The app adds the script when the reader asks for coins. An element made by code is async unless the
  // code says otherwise, and then the real turnstile.ready() throws: the widget would never be drawn.
  await onPage({ turnstile: 'pass' }, async (page) => {
    await page.page.evaluate((src) => (window as unknown as ScratchWindow).load(src), TURNSTILE_SCRIPT);
    const outcome = await page.page.evaluate(() => {
      let ran = false;
      try {
        (window as unknown as ScratchWindow).turnstile.ready(() => {
          ran = true;
        });
        return { ran, threw: null };
      } catch (error) {
        return { ran, threw: (error as Error).message };
      }
    });
    assert.equal(outcome.ran, false);
    assert.match(outcome.threw ?? '', /ready: the script element is async or defer/);
    assert.match(outcome.threw ?? '', /load event, or onload=<name>/);
    // The load event, which this page waited for, is the way that works: the widget can be drawn now.
    const id = await page.page.evaluate((options) => (window as unknown as ScratchWindow).turnstile.render('#app', options), OPTIONS);
    assert.match(id, /^stand-in-/);
    // The refusal was thrown into the page's own call, which caught it here: nothing else went wrong.
    assert.deepEqual(page.failures, []);
  });
  // With the element's "async" set to false before it is added, ready() runs its function at once, as the real one does.
  await onPage({ turnstile: 'pass' }, async (page) => {
    await page.page.evaluate((src) => (window as unknown as ScratchWindow).load(src, true), TURNSTILE_SCRIPT);
    const ran = await page.page.evaluate(() => {
      let done = false;
      (window as unknown as ScratchWindow).turnstile.ready(() => {
        done = true;
      });
      return done;
    });
    assert.equal(ran, true);
  });
});

test('a widget that is not there: reset() and getResponse() throw, as the real ones do; remove() only says so', async () => {
  await onPage({ turnstile: 'pass' }, async (page) => {
    // No widget at all yet.
    await page.page.evaluate((src) => (window as unknown as ScratchWindow).load(src), TURNSTILE_SCRIPT);
    assert.match((await tried(page, 'reset')).threw ?? '', /reset: no such widget/);
    assert.match((await tried(page, 'getResponse')).threw ?? '', /getResponse: no such widget/);
  });
  await onPage({ turnstile: 'pass' }, async (page) => {
    const id = await start(page);
    await page.page.waitForFunction(() => (window as unknown as ScratchWindow).seen.length === 1);
    assert.deepEqual(await tried(page, 'getResponse', id), { gave: DUMMY_TOKEN });
    // Another name, and a name that is not even a selector.
    for (const name of ['no-such-widget', 'stand-in-99', '#']) {
      assert.match((await tried(page, 'reset', name)).threw ?? '', /reset: no such widget/, name);
      assert.match((await tried(page, 'getResponse', name)).threw ?? '', /getResponse: no such widget/, name);
      assert.deepEqual(await tried(page, 'remove', name), { gave: 'undefined' }, name);
    }
    // The widget itself was left alone by all that.
    assert.deepEqual(await tried(page, 'getResponse', id), { gave: DUMMY_TOKEN });
    // Taken away, it is not there either.
    assert.deepEqual(await tried(page, 'remove', id), { gave: 'undefined' });
    assert.match((await tried(page, 'reset', id)).threw ?? '', /reset: no such widget/);
    assert.match((await tried(page, 'getResponse', id)).threw ?? '', /getResponse: no such widget/);
    // Thrown where the page's own code called, so a page that does not catch it fails its run. Only warnings were logged.
    assert.deepEqual(page.failures, []);
  });
});

test('loaded a second time, the script leaves the first copy and its widgets in place', async () => {
  await onPage({ turnstile: 'never' }, async (page) => {
    const id = await start(page);
    const first = await page.page.evaluate(() => {
      const scratch = window as unknown as ScratchWindow & { firstCopy?: unknown };
      scratch.firstCopy = scratch.turnstile;
      return document.querySelectorAll('[data-stand-in-bot-check]').length;
    });
    assert.equal(first, 1);

    // The second load names a function to call when it is ready: the real script calls it on every load.
    const called = await page.page.evaluate(
      (src) =>
        new Promise<boolean>((resolve) => {
          const scratch = window as unknown as ScratchWindow & { firstCopy?: unknown };
          scratch.whenReady = () => resolve(scratch.turnstile === scratch.firstCopy);
          void scratch.load(src);
        }),
      `${TURNSTILE_SCRIPT}&onload=whenReady`,
    );
    assert.equal(called, true, 'the same object as before the second load');

    // The widget drawn before the second load is still in the script's care: it can be asked about and taken away.
    assert.deepEqual(await tried(page, 'remove', id), { gave: 'undefined' });
    assert.equal(await page.page.$('[data-stand-in-bot-check]'), null);
    assert.deepEqual((await page.turnstileCalls()).map((call) => call.op), ['render', 'remove']);
    // Said in a warning, as the real script says it: not a failure of the page.
    assert.deepEqual(page.failures, []);
  });
});

test('the address may carry onload=<name>, as the real script allows', async () => {
  await onPage({ turnstile: 'pass' }, async (page) => {
    const called = await page.page.evaluate(
      (src) =>
        new Promise<string>((resolve) => {
          const scratch = window as unknown as ScratchWindow;
          scratch.whenReady = () => resolve(typeof scratch.turnstile.render);
          const script = document.createElement('script');
          script.src = src;
          document.head.append(script);
        }),
      `${TURNSTILE_SCRIPT}&onload=whenReady`,
    );
    assert.equal(called, 'function');
  });
});

test('any other address at Cloudflare is refused and recorded, as every request off this machine is', async () => {
  await onPage({ turnstile: 'pass' }, async (page) => {
    page.expectFailure(/a request to another host was refused: GET https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/other\.js/);
    page.expectFailure(/Failed to load resource: net::ERR_BLOCKED_BY_CLIENT/);
    await assert.rejects(start(page, 'https://challenges.cloudflare.com/turnstile/v0/other.js'), /the script did not load/);
    assert.deepEqual(page.failures.map((failure) => failure.kind).sort(), ['console', 'request']);
  });
});
