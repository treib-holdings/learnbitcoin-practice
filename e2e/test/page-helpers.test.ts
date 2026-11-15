// The page tools of browser.ts, against a scratch page under the app's own
// headers: what a page is given before its script runs (a wallet in storage,
// a width, a language), the helpers that find things by data-testid, the
// status region's memory, and what counts as a failure of the run.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { RECORD_KEY, loadRecord } from '../../app/src/lib/keystore.ts';
import {
  FUNDED_COINS,
  OTHER_WORDS,
  TEST_MADE_AT,
  TEST_WORDS,
  freshRecord,
  fundTestWallet,
  launchChrome,
  missingFile,
  openPage,
  testRecord,
  type Chrome,
  type OpenOptions,
  type OpenedPage,
} from '../src/browser.ts';
import { makeFakeOrigin } from '../src/fake-origin.ts';
import { scratchSite } from './scratch-site.ts';

/**
 * The scratch page. The first thing its script does is look in storage, as
 * the app's will; the rest is a few elements for the helpers to work on.
 */
const PAGE_JS = `
var KEY = ${JSON.stringify(RECORD_KEY)};
var found = localStorage.getItem(KEY);
var app = document.getElementById('app');
app.innerHTML =
  '<p data-testid="found"></p>' +
  '<p data-testid="facts"></p>' +
  '<input data-testid="field">' +
  '<button data-testid="add">Add</button>' +
  '<button data-testid="forget">Forget</button>' +
  '<button data-testid="off" disabled>Not yet</button>' +
  '<ul></ul>' +
  '<p role="status" data-testid="status"></p>' +
  '<p data-testid="leaving">Going soon</p>' +
  '<a data-testid="new-window" href="https://example.com/elsewhere" target="_blank" rel="noopener">In a new window</a> ' +
  '<a data-testid="named-window" href="/wallet" target="guide">In a window with a name</a> ' +
  '<a data-testid="same-window" href="#further">Further down</a>';
app.querySelector('[data-testid="found"]').textContent = found === null ? 'nothing' : found;
app.querySelector('[data-testid="facts"]').textContent = JSON.stringify({
  language: navigator.language,
  languages: navigator.languages,
  width: window.innerWidth,
  touch: navigator.maxTouchPoints > 0,
  zone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
  other: localStorage.getItem('other-key'),
});
// Long words break, so the page is never wider than its window. (Set through the style object: the policy allows that.)
app.style.overflowWrap = 'anywhere';
var region = app.querySelector('[data-testid="status"]');
app.querySelector('[data-testid="add"]').addEventListener('click', function () {
  var value = app.querySelector('[data-testid="field"]').value;
  var item = document.createElement('li');
  item.setAttribute('data-testid', 'item');
  item.textContent = '  ' + value + '\\n ';
  app.querySelector('ul').append(item);
  // Said, and replaced a moment later: a test that looks afterwards must still hear it.
  region.textContent = 'Added ' + value;
  setTimeout(function () { region.textContent = ''; }, 30);
  setTimeout(function () { region.textContent = 'Ready for more'; }, 60);
});
app.querySelector('[data-testid="forget"]').addEventListener('click', function () {
  localStorage.removeItem(KEY);
});
setTimeout(function () {
  var late = document.createElement('p');
  late.setAttribute('data-testid', 'late');
  late.textContent = 'Here now';
  app.append(late);
  app.querySelector('[data-testid="leaving"]').remove();
  app.querySelector('[data-testid="off"]').disabled = false;
}, 2000);
`;

let chrome: Chrome;
let site: Awaited<ReturnType<typeof scratchSite>>;
/** A Worker's script: it logs an error, asks another host for something, and throws. */
const WORKER_JS = `
console.error('said by the Worker');
fetch('https://example.com/collect').catch(function () {});
setTimeout(function () { throw new Error('thrown in the Worker'); }, 30);
`;

before(async () => {
  chrome = await launchChrome();
  site = await scratchSite({ 'page.js': PAGE_JS, 'robots.txt': 'User-agent: *\n', 'worker.js': WORKER_JS, 'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' });
});
after(async () => {
  await chrome?.close();
});

async function onPage(options: OpenOptions, run: (page: OpenedPage) => Promise<void>): Promise<void> {
  const page = await openPage(chrome, site.url, options);
  try {
    await run(page);
    assert.deepEqual(page.problems(), []);
  } finally {
    await page.close();
  }
}

const facts = async (page: OpenedPage) => JSON.parse(await page.text('facts')) as Record<string, unknown>;

/**
 * Waits until `done` holds, for ten seconds at most, and gives whether it
 * came to hold. What Chrome reports about a page (a console line, a
 * refused request) arrives here a moment after it happened, and on a busy
 * machine that moment can be long: a test waits for the report itself,
 * never for a fixed time, and then asserts on what has arrived.
 */
async function until(done: () => boolean): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  while (!done()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return true;
}

/**
 * Types into a field and taps a button of a page that was opened with a
 * short timeout, without that timeout. Such a page is there for one wait
 * that is meant to run out. Its own fill() and click() would be held to
 * the same few hundred ms, and on a busy machine a tap can take longer
 * than that to land: the test would then fail before it reached the wait
 * it is about. These two take the time they need.
 */
async function typeInto(page: OpenedPage, testid: string, text: string): Promise<void> {
  await page.page.locator(`[data-testid="${testid}"]`).fill(text);
}
async function tap(page: OpenedPage, testid: string): Promise<void> {
  await page.page.locator(`[data-testid="${testid}"]`).click();
}

/**
 * Waits until the scratch page's status region holds exactly these words.
 * The page says "Added ..." and, a moment later, "Ready for more": a test
 * that needs both to have been said waits for the second, however long the
 * page takes on a busy machine, and never for a fixed time.
 */
async function statusReads(page: OpenedPage, words: string): Promise<void> {
  await page.page.waitForFunction(
    (wanted) => document.querySelector('[data-testid="status"]')?.textContent === wanted,
    {},
    words,
  );
  // What the page said has to reach this process too: the log is filled from the page, a call at a time.
  const deadline = Date.now() + 10_000;
  while (page.statusLog().at(-1) !== words && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(page.statusLog().at(-1), words);
}

/**
 * Waits until the scratch page has made its one late change: two seconds
 * after it loads, a line arrives, another leaves and a button is switched
 * on. The line that leaves stands above the page's links, so they move up
 * when it goes. A click aimed at a link just before that would land where
 * the link no longer is. A test that clicks them waits for this first.
 */
async function layoutSettled(page: OpenedPage): Promise<void> {
  await page.waitFor('late');
  await page.waitForGone('leaving');
}

test('the prepared wallets: a record the app itself would read, and the coins the funded one holds', () => {
  const record = testRecord();
  assert.deepEqual(record, {
    v: 1,
    kind: 'words',
    fingerprint: '73c5da0a',
    xpub: record.xpub,
    firstAddress: 'bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk',
    createdAt: TEST_MADE_AT,
    mnemonic: TEST_WORDS,
  });
  assert.match(record.xpub, /^tpub/);
  assert.equal(new Date(TEST_MADE_AT).toISOString(), '2026-11-01T12:00:00.000Z');
  // Stored and read back through the app's own key store, it is a sound record.
  const local = new Map<string, string>([[RECORD_KEY, JSON.stringify(record)]]);
  const storage = { getItem: (key: string) => local.get(key) ?? null } as unknown as Storage;
  assert.deepEqual(loadRecord(storage), record);
  // A second wallet, for scenarios that need another one, and one that nobody has seen before.
  assert.notEqual(testRecord(OTHER_WORDS).fingerprint, record.fingerprint);
  const fresh = freshRecord();
  assert.equal(fresh.kind, 'words');
  assert.equal(fresh.mnemonic?.split(' ').length, 12);
  assert.notEqual(fresh.fingerprint, freshRecord().fingerprint);

  // The funded wallet: its first three receive addresses, paid on the stand-in network.
  const network = makeFakeOrigin();
  const paid = fundTestWallet(network);
  assert.deepEqual(paid.map((coin) => [coin.index, coin.sats, coin.confirmed]), [
    [0, 100_000, true],
    [1, 40_000, true],
    [2, 2_500, false],
  ]);
  assert.equal(paid[0]!.address, record.firstAddress);
  assert.equal(new Set(paid.map((coin) => coin.address)).size, 3);
  assert.equal(FUNDED_COINS.reduce((sum, coin) => sum + coin.sats, 0), 142_500);
  // Two blocks for the confirmed coins; the third coin waits for the next one.
  assert.equal(network.height(), 103);
});

test('a wallet is in storage before the page\'s own script first runs, and is put there once', async () => {
  const record = testRecord();
  await onPage({ record, storage: { 'other-key': 'kept' } }, async (page) => {
    assert.equal(await page.text('found'), JSON.stringify(record));
    assert.equal((await facts(page)).other, 'kept');
    assert.equal(await page.stored(), JSON.stringify(record));
    assert.equal(await page.stored('other-key'), 'kept');
    assert.equal(page.status, 200);
    assert.ok(page.loadMs >= 0 && page.loadMs < 5000);

    // The page removes its wallet. A reload must not bring it back.
    await page.click('forget');
    assert.equal(await page.stored(), null);
    await page.goto('/wallet');
    assert.equal(await page.text('found'), 'nothing');
    assert.equal(await page.stored('other-key'), 'kept');

    // A scenario can change storage behind the page's back.
    await page.store(RECORD_KEY, '{"v":2}');
    await page.goto('/');
    assert.equal(await page.text('found'), '{"v":2}');
    await page.store(RECORD_KEY, null);
    assert.equal(await page.stored(), null);
  });
  // Stored text is taken as it is: a damaged record, say.
  await onPage({ record: 'not json' }, async (page) => {
    assert.equal(await page.text('found'), 'not json');
  });
  // Nothing asked for, nothing stored.
  await onPage({}, async (page) => {
    assert.equal(await page.text('found'), 'nothing');
    assert.equal(await page.page.evaluate(() => localStorage.length), 0);
  });
});

test('each page has storage of its own, unless it is opened as a second tab', async () => {
  await onPage({ record: testRecord() }, async (first) => {
    await onPage({}, async (stranger) => {
      assert.equal(await stranger.text('found'), 'nothing');
    });
    const tab = await openPage(chrome, site.url, { context: first.context });
    try {
      assert.equal(await tab.text('found'), JSON.stringify(testRecord()));
      // What one tab removes is gone for the other.
      await tab.click('forget');
      assert.equal(await first.stored(), null);
      assert.deepEqual(tab.problems(), []);
    } finally {
      await tab.close();
    }
    // Closing the second tab leaves the first one's context alone.
    assert.equal(await first.text('found'), JSON.stringify(testRecord()));
  });
});

test('width, language and time zone are what the test asked for, not what this machine has', async () => {
  await onPage({}, async (page) => {
    assert.deepEqual(await facts(page), { language: 'en', languages: ['en'], width: 1280, touch: false, zone: 'UTC', other: null });
  });
  await onPage({ width: 375, lang: 'es' }, async (page) => {
    assert.deepEqual(await facts(page), { language: 'es', languages: ['es'], width: 375, touch: false, zone: 'UTC', other: null });
    assert.equal(await page.page.evaluate(() => window.innerHeight), 812);
    // The language goes out with every request, too.
    assert.equal(await page.page.evaluate(async () => (await fetch('/api/echo-nothing')).status), 404);
  });
});

test('click, fill and read by data-testid; wait for what comes and for what goes', async () => {
  await onPage({}, async (page) => {
    // The page adds one element two seconds after it loads. It is looked for at once, while it
    // cannot be there yet: after the steps below, on a busy machine, it might be.
    assert.equal(await page.page.$('[data-testid="late"]'), null);
    assert.deepEqual(await page.texts('item'), []);
    await page.fill('field', 'first');
    await page.click('add');
    await page.fill('field', 'second'); // in place of what the field held
    await page.click('add');
    // White space is tidied, so a test compares words.
    assert.deepEqual(await page.texts('item'), ['first', 'second']);
    assert.equal(await page.text('item'), 'first');

    // An element that was not there when the page opened, one that leaves, and a button that is still disabled.
    const ms = await page.timeTo('late');
    assert.ok(ms >= 1500 && ms < 8000, `timeTo counts from the navigation: ${ms} ms`);
    assert.equal(await page.text('late'), 'Here now');
    await page.waitForGone('leaving');
    await page.waitFor('late');
    await page.click('off'); // waited until it was enabled

    // What is never there is an error, with the name asked for in it.
    const quick = await openPage(chrome, site.url, { timeout: 300 });
    try {
      await assert.rejects(quick.waitFor('no-such-thing'), /no-such-thing/);
      await assert.rejects(quick.text('no-such-thing'), /no-such-thing/);
      await assert.rejects(quick.click('no-such-thing'));
    } finally {
      await quick.close();
    }
  });
});

test('the status region is remembered: a message that came and went is still heard, each one once', async () => {
  await onPage({}, async (page) => {
    await page.fill('field', 'one');
    await page.click('add');
    // After "Added one" was replaced.
    await statusReads(page, 'Ready for more');
    assert.equal(await page.text('status'), 'Ready for more');
    assert.equal(await page.waitForStatus('Added one'), 'Added one');
    assert.equal(await page.waitForStatus(/^Ready/), 'Ready for more');

    // The same words again are a new message, heard once more and no more.
    await page.fill('field', 'one');
    await page.click('add');
    assert.equal(await page.waitForStatus('Added one'), 'Added one');
    assert.equal(await page.waitForStatus('Ready'), 'Ready for more');
    assert.deepEqual(page.statusLog(), ['Added one', 'Ready for more', 'Added one', 'Ready for more']);

    // The memory outlives a reload: what the page said before it is still there, and new words follow.
    await page.goto('/wallet');
    await page.fill('field', 'two');
    await page.click('add');
    assert.equal(await page.waitForStatus('Added two'), 'Added two');
    assert.deepEqual(page.statusLog().slice(0, 5), ['Added one', 'Ready for more', 'Added one', 'Ready for more', 'Added two']);

    // A wait that runs out says what was heard instead. Only that wait is held to the 300 ms: the
    // typing and the tap before it are not, and what the page said has reached this process first.
    const quick = await openPage(chrome, site.url, { timeout: 300 });
    try {
      await typeInto(quick, 'field', 'x');
      await tap(quick, 'add');
      assert.ok(await until(() => quick.statusLog().includes('Added x')), 'the page said "Added x"');
      await assert.rejects(quick.waitForStatus('Payment sent'), /did not say Payment sent within 300 ms; it said: \["Added x"/);
    } finally {
      await quick.close();
    }
  });
});

test('forgetStatus: a message from an earlier step does not answer a wait meant for a later one', async () => {
  // Two steps that should each say "Added one". The second is broken here: it says nothing at all.
  // (The two pages below have a short timeout for the one wait that is meant to run out. What is
  // typed and tapped on them is not held to it: typeInto and tap, above.)
  const silentSecondStep = async (page: OpenedPage): Promise<void> => {
    await typeInto(page, 'field', 'one');
    await tap(page, 'add'); // the first step: "Added one", then "Ready for more"
    await statusReads(page, 'Ready for more');
    await tap(page, 'forget'); // stands for the second step, which announces nothing
  };

  // Without it, the first step's message, which nobody asked about, passes for the second step's.
  const trusting = await openPage(chrome, site.url, { timeout: 1500 });
  try {
    await silentSecondStep(trusting);
    assert.equal(await trusting.waitForStatus('Added one'), 'Added one');
  } finally {
    await trusting.close();
  }

  // With it, the wait hears only what is said from then on, and the silent step is found out.
  const careful = await openPage(chrome, site.url, { timeout: 1500 });
  try {
    await typeInto(careful, 'field', 'one');
    await tap(careful, 'add');
    await statusReads(careful, 'Ready for more');
    careful.forgetStatus();
    await tap(careful, 'forget');
    await assert.rejects(careful.waitForStatus('Added one'), /did not say Added one within 1500 ms; it said: \[\]/);
    // Nothing is lost from the log, and a message that does come afterwards is heard.
    assert.deepEqual(careful.statusLog(), ['Added one', 'Ready for more']);
    await tap(careful, 'add');
    assert.ok(await until(() => careful.statusLog().length > 2), 'the page spoke again');
    assert.equal(await careful.waitForStatus('Added one'), 'Added one');
  } finally {
    await careful.close();
  }
});

test('settle: waits until the page has stopped talking to the server', async () => {
  await onPage({ record: testRecord() }, async (page) => {
    // A burst of questions, the last one sent 300 ms after the first.
    await page.page.evaluate(() => {
      for (let i = 0; i < 4; i += 1) setTimeout(() => void fetch(`/api/burst/${i}`), i * 100);
    });
    assert.equal(await page.settle(), true);
    const burst = page.responses.filter((response) => response.url.includes('/api/burst/'));
    assert.equal(burst.length, 4, 'settle() came back after the last answer, not in a gap between two');
  });
  // A page that never stops asking is not waited for longer than the page's timeout.
  const busy = await openPage(chrome, site.url, { timeout: 600 });
  try {
    await busy.page.evaluate(() => {
      setInterval(() => void fetch('/api/poll'), 50);
    });
    const started = Date.now();
    assert.equal(await busy.settle(), false);
    assert.ok(Date.now() - started < 3000);
  } finally {
    await busy.close();
  }
});

test('a screenshot of the whole page, in a folder that did not exist', async () => {
  await onPage({ width: 375 }, async (page) => {
    const file = join(dirname(site.dist), 'shots', 'deep', 'page.png');
    await page.shot(file);
    assert.ok(existsSync(file));
    const png = readFileSync(file);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // The width asked for, in the picture's own header (bytes 16 to 19): the page fits its window.
    assert.equal(png.readUInt32BE(16), 375);
    assert.equal(await page.sidewaysScroll(), 0);

    // A page that is too wide for a phone says by how much.
    await page.page.evaluate(() => {
      const wide = document.createElement('div');
      wide.style.width = '500px';
      wide.textContent = 'too wide';
      document.body.append(wide);
    });
    assert.ok((await page.sidewaysScroll()) >= 125);
  });
});

test('what fails a run: console errors, uncaught errors, the policy at work, a request to another host', async () => {
  const page = await openPage(chrome, site.url);
  try {
    assert.equal(page.failures.length, 0);

    await page.page.evaluate(() => console.error('the app said something is wrong'));
    await page.page.evaluate(() => {
      setTimeout(() => {
        throw new Error('nobody caught this');
      }, 0);
    });
    await page.page.evaluate(() => console.assert(1 > 2, 'one is not more than two'));
    // A style attribute, which the page's policy forbids. The style object is allowed.
    await page.page.evaluate(() => document.body.setAttribute('style', 'color: red'));
    await page.page.evaluate(() => {
      document.body.style.color = 'green';
    });
    // The policy stops this one inside the browser.
    await page.page.evaluate(() => fetch('https://example.com/').catch(() => {}));
    // Not errors: a warning, and a refusal by the Worker's side.
    await page.page.evaluate(() => console.warn('only a warning'));
    assert.equal(await page.page.evaluate(async () => (await fetch('/api/esplora/tx/unknown')).status), 404);

    const expected: [kind: string, text: RegExp][] = [
      ['console', /^the app said something is wrong$/],
      ['pageerror', /nobody caught this/],
      ['console', /one is not more than two/],
      ['csp', /^Applying inline style violates the following Content Security Policy directive 'style-src 'self''/],
      ['csp', /^Connecting to 'https:\/\/example\.com\/' violates the following Content Security Policy directive: "connect-src 'self'"/],
      ['csp', /^Fetch API cannot load https:\/\/example\.com\/\. Refused to connect because it violates the document's Content Security Policy/],
    ];
    // Each is reported a moment after it happened. All six are waited for, and then a little
    // longer: a seventh, from the warning or the refusal that must not count, would show by then.
    await until(() => page.failures.length >= expected.length);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(page.failures.map((failure) => failure.kind), expected.map(([kind]) => kind));
    expected.forEach(([, text], index) => assert.match(page.failures[index]!.text, text));
    assert.equal(page.problems().length, 6);
    assert.match(page.problems()[0]!, /^console: the app said something is wrong/);
    assert.match(page.problems()[3]!, /^csp: Applying inline style/);

    // The policy has no say over where the whole page goes. The tools do: the request is refused and recorded.
    await page.page.evaluate(() => {
      location.href = 'https://example.com/elsewhere';
    });
    await until(() => page.failures.some((failure) => failure.kind === 'request'));
    const refused = page.failures.filter((failure) => failure.kind === 'request');
    assert.deepEqual(refused.map((failure) => failure.text), ['a request to another host was refused: GET https://example.com/elsewhere']);
  } finally {
    await page.close();
  }
});

test('a file of the app that is not there fails the run, although the server answers 200 and Chrome says next to nothing', async () => {
  const page = await openPage(chrome, site.url);
  try {
    assert.equal(page.failures.length, 0);
    // The page asks for a picture, a font and an icon that are not in the build, and for a picture that is.
    // No script and no stylesheet here: for those Chrome writes an error of its own, which already counts.
    const loaded = await page.page.evaluate(async () => {
      const picture = (src: string) =>
        new Promise<string>((done) => {
          const image = document.createElement('img');
          image.onload = () => done('loaded');
          image.onerror = () => done('broken');
          image.src = src;
          document.body.append(image);
        });
      const icon = document.createElement('link');
      icon.rel = 'icon';
      icon.href = '/icons/app.png';
      document.head.append(icon);
      const font = await new FontFace('Gone', 'url(/assets/gone.woff2)').load().then(
        () => 'loaded',
        () => 'broken',
      );
      // Not files: the page's own fetch of a path of the app, and an answer of the Worker's.
      await fetch('/wallet/receive');
      await fetch('/api/no-such-path');
      return { missing: await picture('/pictures/logo.svg'), there: await picture('/logo.svg'), font };
    });
    assert.deepEqual(loaded, { missing: 'broken', there: 'loaded', font: 'broken' });
    // Chrome fetches an icon when it gets round to it.
    const answered = (path: string) => page.responses.find((response) => new URL(response.url).pathname === path);
    const deadline = Date.now() + 5000;
    while (answered('/icons/app.png') === undefined && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    await page.settle();

    // All three came back with status 200 and the app's page.
    for (const path of ['/pictures/logo.svg', '/assets/gone.woff2', '/icons/app.png']) {
      const answer = answered(path);
      assert.deepEqual([answer?.status, answer?.headers['content-type']], [200, 'text/html; charset=utf-8'], path);
    }
    assert.deepEqual(
      page.failures.map((failure) => [failure.kind, failure.text]).sort(),
      [
        ['missing', "a file of the app is missing: /assets/gone.woff2 was answered with the app's page"],
        ['missing', "a file of the app is missing: /icons/app.png was answered with the app's page"],
        ['missing', "a file of the app is missing: /pictures/logo.svg was answered with the app's page"],
      ],
    );
    assert.match(page.problems()[0]!, /^missing: a file of the app is missing: /);
  } finally {
    await page.close();
  }
});

test('which answers are a missing file', () => {
  const APP = 'http://localhost:50123';
  const html = { 'content-type': 'text/html; charset=utf-8' };
  const answer = (type: string, path: string, headers: Record<string, string> = html, origin = APP) => ({ type, url: `${origin}${path}`, headers });

  for (const [type, path] of [
    ['font', '/assets/geist-latin-wght-normal-BgDaEnEv.woff2'],
    ['image', '/logo.svg'],
    ['image', '/wallet/qr.png?x=1'],
    ['stylesheet', '/assets/index-abc.css'],
    ['script', '/assets/index-abc.js'],
    ['media', '/intro.mp4'],
    ['manifest', '/site.webmanifest'],
    ['other', '/favicon.png'], // an icon the page names
    ['image', '/apiary/logo.png'], // only starts like the Worker's path
  ] as const) {
    assert.equal(missingFile(answer(type, path), [APP]), path.split('?')[0], `${type} ${path}`);
  }
  // The type is what counts, in any spelling, and whatever the status (a copy Chrome kept is still the app's page).
  assert.equal(missingFile(answer('image', '/logo.svg', { 'content-type': 'TEXT/HTML' }), [APP]), '/logo.svg');

  const fine = [
    answer('image', '/logo.svg', { 'content-type': 'image/svg+xml' }), // the file is there
    answer('font', '/assets/a.woff2', { 'content-type': 'font/woff2' }),
    answer('image', '/logo.svg', {}), // no type at all: not the app's page
    answer('document', '/wallet/receive'), // a page is meant to be HTML
    answer('fetch', '/wallet/receive'), // the page's own fetch
    answer('xhr', '/wallet'),
    answer('other', '/favicon.ico'), // Chrome's own guess, for a page that names no icon
    answer('image', '/api/logo.png'), // the Worker's answer, whatever it is
    answer('script', '/p/event'),
    answer('image', '/logo.svg', html, 'http://localhost:50124'), // another server
    answer('image', '/logo.svg', html, 'https://example.com'),
    { type: 'image', url: 'not a url', headers: html },
  ];
  for (const each of fine) assert.equal(missingFile(each, [APP]), null, `${each.type} ${each.url}`);
  // A page of another site that is allowed to call the app: the app's files count there too.
  assert.equal(missingFile(answer('image', '/logo.svg'), ['http://elsewhere.test:50200', APP]), '/logo.svg');
});

test('the page cannot open another window: window.open and a link to one are stopped, and counted', async () => {
  const page = await openPage(chrome, site.url);
  try {
    const before = (await chrome.browser.pages()).length;
    // window.open opens nothing and says so the way a blocked window does: null.
    assert.equal(await page.page.evaluate(() => window.open('https://challenges.cloudflare.com/popup')), null);
    assert.equal(await page.page.evaluate(() => window.open('/wallet', '_blank', 'noopener')), null);
    // The links are clicked where they stand, so they have to stand still: the page's one late change moves them.
    await layoutSettled(page);
    // A click on a link that asks for a window of its own goes nowhere.
    await page.click('new-window');
    await page.click('named-window');
    // An ordinary link is followed as ever. The page's address is read once it has changed, not after a fixed time.
    await page.click('same-window');
    await page.page.waitForFunction(() => location.hash === '#further');
    // The two clicks before it were dealt with before that one. A window, had one opened, has had a moment to show.
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal((await chrome.browser.pages()).length, before, 'no window was opened');
    assert.equal(await page.page.evaluate(() => location.href), `${site.url}/#further`);
    assert.deepEqual(
      page.failures.map((failure) => [failure.kind, failure.text]),
      [
        ['window', 'the page tried to open another window: https://challenges.cloudflare.com/popup'],
        ['window', 'the page tried to open another window: /wallet'],
        ['window', 'the page tried to open another window: https://example.com/elsewhere'],
        ['window', `the page tried to open another window: ${site.url}/wallet`],
      ],
    );
    // No request left for the other host: the windows were stopped before they started.
    assert.deepEqual(page.failures.filter((failure) => failure.kind === 'request'), []);

    // window.open for the window the page is already in is no new window: it works as ever, and counts for nothing.
    await page.page.evaluate(() => {
      window.open('#opened-here', '_self');
    });
    assert.equal(await page.page.evaluate(() => location.href), `${site.url}/#opened-here`);
    assert.equal(page.failures.length, 4);

    // A scenario that clicks such a link on purpose says so, and can see where the link led.
    page.expectFailure(/another window: /);
    assert.deepEqual(page.problems(), []);

    // It holds after a reload too.
    await page.goto('/wallet');
    assert.equal(await page.page.evaluate(() => window.open('https://example.com/')), null);
    assert.equal(page.failures.length, 5);
  } finally {
    await page.close();
  }
});

test('a Worker the page starts is watched too: what it logs, what it throws, and what the policy stops it from doing', async () => {
  const page = await openPage(chrome, site.url);
  try {
    await page.page.evaluate(() => {
      (window as unknown as { worker: Worker }).worker = new Worker('/worker.js');
    });
    const deadline = Date.now() + 5000;
    while (page.failures.length < 4 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));

    const expected: [kind: string, text: RegExp][] = [
      ['console', /^said by the Worker$/],
      // The Worker's request to another host never left: the policy stopped it, and that is said in the Worker's own log.
      ['csp', /^Connecting to 'https:\/\/example\.com\/collect' violates the following Content Security Policy directive: "connect-src 'self'"/],
      ['csp', /^Fetch API cannot load https:\/\/example\.com\/collect\. Refused to connect/],
      ['pageerror', /thrown in the Worker/],
    ];
    assert.deepEqual(page.failures.map((failure) => failure.kind).sort(), expected.map(([kind]) => kind).sort());
    for (const [kind, text] of expected) {
      assert.ok(page.failures.some((failure) => failure.kind === kind && text.test(failure.text)), `${kind}: ${String(text)}`);
    }
  } finally {
    await page.close();
  }
});

test('a failure a scenario expects does not count; one it expects and never gets does', async () => {
  const page = await openPage(chrome, site.url);
  try {
    page.expectFailure(/meant to happen/);
    page.expectFailure(/never happens/);
    await page.page.evaluate(() => console.error('this was meant to happen'));
    await page.page.evaluate(() => console.error('this was not'));
    const problems = page.problems();
    assert.equal(problems.length, 2);
    assert.match(problems[0]!, /^console: this was not/);
    assert.equal(problems[1], 'expected and never seen: /never happens/');
  } finally {
    await page.close();
  }
});

test('the phone profile: a narrow touch screen, and a load that takes a slow connection\'s time', async () => {
  const fast = await openPage(chrome, site.url);
  await fast.close();
  await onPage({ phone: true }, async (page) => {
    const seen = await facts(page);
    assert.deepEqual([seen.width, seen.touch], [360, true]);
    // Two files over a connection that adds a few hundred ms to every answer.
    assert.ok(page.loadMs > fast.loadMs + 250, `phone ${page.loadMs} ms, desktop ${fast.loadMs} ms`);
    assert.ok((await page.timeTo('late')) >= page.loadMs);
  });
});

test('the phone profile over this server: six requests at a time, so ten at once take two rounds of the delay', async (t) => {
  // What the note on the `phone` option says, measured. The local server speaks HTTP/1.1, over which Chrome
  // keeps six connections to a host. Each answer comes 562 ms late on the slow connection. One read, or six
  // at once: one round. Ten at once, as the wallet scans: two rounds. On the deployed site (HTTP/2 or 3) the
  // ten take one round, so a time taken here that includes a scan is too long. If this ever fails, the
  // server or Chrome has changed, and the note in browser.ts must change with it.
  await onPage({ phone: true }, async (page) => {
    const timeOf = (count: number) =>
      page.page.evaluate(async (reads) => {
        const started = performance.now();
        await Promise.all(Array.from({ length: reads }, (_, index) => fetch(`/api/read/${reads}/${index}`)));
        return Math.round(performance.now() - started);
      }, count);
    const one = await timeOf(1);
    const ten = await timeOf(10);
    t.diagnostic(`one read ${one} ms, ten reads at once ${ten} ms`);
    assert.ok(one >= 550, `one read took ${one} ms: less than the connection's delay`);
    assert.ok(ten >= 1100, `ten reads at once took ${ten} ms: less than two rounds of the connection's delay`);
  });
});
