// A link back to a chapter, followed: what LearnBitcoin's main site is sent
// when a reader leaves the practice wallet for the chapter a step belongs to.
//
// The other scenarios of the steps read the address of "Back to the
// chapter" off the page. This one presses it. The main site here is a
// stand-in on this machine: one small server that answers every path with a
// page and writes down each request it is sent, headers and all. The app is
// told that the stand-in is the main site (SITE_URL), so every link back
// leads there, and the scenario can see both ends: the request as the main
// site's server got it, and what a script on the main site's page can read.
//
// The stand-in answers under the app's own name, on another port. To a
// browser that makes it another host of the app's own site, which is what
// the main site is to the practice wallet (two hosts under one name). So
// the stand-in is sent what the main site is sent, the browser's own mark
// of the request included: "Sec-Fetch-Site: same-site". A stand-in under
// another name, over plain http, would be sent no such header at all, and
// the scenario would show less than a reader's browser sends.
//
// About says of these links: they lead to LearnBitcoin in this tab, the
// address of "Back to the chapter" names one step and says whether it is
// done (the step the reader is on or following, or the step they came for
// when a need sent them on first), once that step is done it also names
// the other done steps of its chapter, and nothing about the wallet
// travels with either. And the page's own policy is to send no referrer,
// to which no link is an exception. So:
//
//   1. "Back to the chapter" on a step under way, on a done step's card and
//      in the strip (of a done step, and of a step under way that was
//      reached by its card), on a done step beside another done step of
//      its chapter, and on a step that a need of another step sent the
//      reader to; and a chapter's name on the list of steps: each brings
//      the main site one request for the chapter's page, with no Referer,
//      no cookie and nothing that names the practice site or the wallet;
//      the page the reader arrives at finds no referrer and no cookie, and
//      its address ends in what names the step or steps, or in nothing
//      for a chapter's name. That ending is never part of the request: it
//      is in the address the reader arrives at, where a script of the
//      main site's page can read it. What the request does say of where
//      the reader was is the browser's own mark, which no page can switch
//      off: that the reader pressed a link on some host of the same site.
//      It names no host and no page, and it is pinned here as seen. A link
//      that did ask for a referrer to be sent would be seen: the last part
//      of the scenario makes one by hand, and sees it.
//
// It touches nothing of the stand-in practice network, and could run
// against a real one as it is.

import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after } from 'node:test';
import type { EventBody } from '@learnbitcoin/practice-contract';
import { strings } from '../../app/src/strings/index.ts';
import { freshRecord, scenario } from './helpers.ts';
import { hook, loads, until } from './journey-helpers.ts';
import { PROGRESS_KEY, begin, ends, hrefOf, noteFor, stripOf, untilStrip, view } from './doit-helpers.ts';

const en = strings.doit.en;
const es = strings.doit.es;

/** One request the stand-in for the main site was sent. */
interface Asked {
  method: string;
  /** The path as the server got it, with its query string if it had one. A mark after "#" is never sent. */
  path: string;
  headers: IncomingHttpHeaders;
}

/**
 * A stand-in for the main site: every path answers one small page, and each
 * request is written down with its headers. The page names an empty icon, so
 * that the browser asks for the page and nothing else. Its address is the
 * app's own name with another port: another host of the same site.
 */
async function startMainSite(): Promise<{ url: string; asked: Asked[]; close(): Promise<void> }> {
  const asked: Asked[] = [];
  const server = createServer((request, response) => {
    asked.push({ method: request.method ?? '', path: request.url ?? '', headers: request.headers });
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>main site stand-in</title><h1>A chapter of the main site</h1>');
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  // The scenarios are what keeps this process going, never this server.
  server.unref();
  const { port } = server.address() as AddressInfo;
  return {
    // The app is at http://localhost:<its port> (e2e/src/serve.ts). A port is no part of what a browser calls
    // a site, so this is the app's site, and another origin with storage of its own.
    url: `http://localhost:${port}`,
    asked,
    close: () =>
      new Promise<void>((closed) => {
        server.close(() => closed());
        server.closeAllConnections();
      }),
  };
}

// One stand-in for the file, started before the scenario is registered: its address is one of the Worker's settings.
const main = await startMainSite();
after(() => main.close());

/** What following a link to the main site brought: what its server was sent, and what a script on its page can read. */
interface Arrival {
  asked: Asked[];
  href: string;
  referrer: string;
  cookie: string;
}

scenario(
  'A link back to the chapter, followed to the main site: "Back to the chapter" on a step under way, on a done step and in the strip, on a done step beside another done step of its chapter, in the strip of a step under way that was reached by its card, and on a step that a need sent the reader to, and a chapter\'s name on the list of steps each bring the main site one request for the chapter\'s page, with no Referer, no cookie and nothing that names the practice site or the wallet, and with the browser\'s own mark that it comes from the same site; the address the reader arrives at ends in what names the step or steps, or in nothing for a chapter\'s name',
  { stack: { vars: { SITE_URL: main.url } }, timeout: 180_000 },
  async (s) => {
    const STEP = 'pass-it-on';
    const OWN = '/journey/how-bitcoin-works';
    const OWN_ES = '/es/recorrido/como-funciona-bitcoin';
    assert.equal(s.stack.config.siteUrl, main.url, 'the app is told that the stand-in is the main site');
    const practice = new URL(s.url);
    const mainSite = new URL(main.url);
    assert.deepEqual([mainSite.hostname, mainSite.port === practice.port], [practice.hostname, false], 'the stand-in is another host of the app\'s own site');
    main.asked.length = 0;

    // A wallet is in this browser all the while: what must not travel is known by value. A wallet nobody has
    // seen before, so that it has no history on any practice network.
    const record = freshRecord();
    assert.ok(record.mnemonic !== undefined);
    const words = record.mnemonic.split(' ');
    const reader = await begin(s, `/do/${STEP}?from=${OWN}`, { record, allow: [main.url] });
    const { page } = reader;
    await page.waitFor('step-parts');
    const counted: EventBody[] = [view(`/do/${STEP}`)];

    /** Follows a link of the app to the main site, as a reader's click does, and waits for the main site's page. */
    const follow = async (click: () => Promise<unknown>): Promise<Arrival> => {
      const before = main.asked.length;
      await loads(page, click);
      const there = await page.page.evaluate(() => ({ href: location.href, referrer: document.referrer, cookie: document.cookie }));
      return { asked: main.asked.slice(before), ...there };
    };

    /** Back on the practice site, on a page that is not the app: a place to change what is stored. */
    const standBy = async (): Promise<void> => {
      await page.goto('/robots.txt');
    };

    /** The app's page at this path, loaded: one screen view. */
    const open = async (path: string, wait: string): Promise<void> => {
      await page.goto(path);
      await page.waitFor(wait);
      counted.push(view(path.replace(/\?.*$/, '')));
    };

    /**
     * What the main site may have been sent for one link followed: one
     * request, for the chapter's page and nothing after it, with no
     * Referer, no cookie and no Origin, in which nothing names the practice
     * site or the wallet. The browser's own mark of the request is there,
     * and it is all the request says of where the reader was: a link, on
     * some host of the same site, that the reader pressed. And the page the
     * request answers finds no referrer and no cookie.
     */
    const sentOnlyThePage = (arrival: Arrival, path: string, what: string): void => {
      assert.deepEqual(
        arrival.asked.map((each) => [each.method, each.path]),
        [['GET', path]],
        `${what}: one request, for the chapter's page`,
      );
      const headers = arrival.asked[0]?.headers ?? {};
      assert.equal(headers.referer, undefined, `${what}: no Referer header`);
      assert.equal(headers.cookie, undefined, `${what}: no cookie`);
      assert.equal(headers.origin, undefined, `${what}: no Origin header`);
      // What the browser adds by itself to a request between two hosts of one site, and no page can switch
      // off. Seen, and accepted: it names no host and no page.
      assert.deepEqual(
        [headers['sec-fetch-site'], headers['sec-fetch-mode'], headers['sec-fetch-dest'], headers['sec-fetch-user']],
        ['same-site', 'navigate', 'document', '?1'],
        `${what}: the browser's own mark of the request`,
      );
      // The request names the host it is sent to, the stand-in, as every request does.
      assert.equal(headers.host, mainSite.host, `${what}: the Host header`);
      for (const [name, value] of Object.entries(headers)) {
        const text = Array.isArray(value) ? value.join(' ') : (value ?? '');
        // The practice site's address is its name with its port. The name alone is the stand-in's too, and
        // stands in no header but Host.
        assert.ok(!text.includes(practice.host), `${what}: the header ${name} names the practice site: ${text}`);
        if (name !== 'host') assert.ok(!text.includes(practice.hostname), `${what}: the header ${name} names the practice site's host: ${text}`);
        for (const secret of [record.fingerprint, record.xpub, record.firstAddress]) assert.ok(!text.includes(secret), `${what}: the header ${name} holds ${secret}`);
      }
      assert.equal(arrival.referrer, '', `${what}: the main site's page finds no referrer`);
      assert.equal(arrival.cookie, '', `${what}: and it finds no cookie`);
      for (const secret of [record.fingerprint, record.xpub, record.firstAddress, practice.host]) assert.ok(!arrival.href.includes(secret), `${what}: the address holds ${secret}`);
    };

    // -- The practice site's own pages are served with the policy that sends no referrer. (The harness's blank
    //    page, where the wallet was put into storage, never reaches the server and is no page of the site.) --
    const policies = (): [path: string, policy: string | undefined][] =>
      page.responses
        .filter((response) => response.type === 'document' && new URL(response.url).origin === practice.origin && !new URL(response.url).pathname.startsWith('/__harness/'))
        .map((response) => [new URL(response.url).pathname, response.headers['referrer-policy']]);
    assert.deepEqual(policies(), [
      ['/robots.txt', 'no-referrer'],
      [`/do/${STEP}`, 'no-referrer'],
    ]);

    // -- 1. A step under way, opened from the chapter's English page: "Back to the chapter", in the chapter's line --
    assert.equal(await page.text('step-back'), en.back);
    assert.equal(await hrefOf(page, 'step-back'), `${main.url}${OWN}#do-${STEP}`);
    assert.deepEqual(
      await page.page.$eval(hook('step-back'), (link) => [link.getAttribute('referrerpolicy'), link.getAttribute('rel'), link.getAttribute('target')]),
      [null, null, null],
    );
    const underWay = await follow(() => page.click('step-back'));
    sentOnlyThePage(underWay, OWN, 'a step under way');
    // The ending is in the address the reader arrives at, where a script of the main site's page can read it. It names the step, and says "not done".
    assert.equal(underWay.href, `${main.url}${OWN}#do-${STEP}`);

    // -- 2. The same step, done: the main button of the done card. The ending now says "done". --
    const at = Date.now();
    const done = { started: true as const, doneAt: at, from: OWN_ES, parts: { 1: true as const, 2: true as const, 3: true as const } };
    await standBy();
    await page.store(PROGRESS_KEY, noteFor({ following: null, steps: { [STEP]: done } }));
    await open(`/do/${STEP}`, 'step-done');
    assert.equal(await page.text('step-back'), en.back);
    const finished = await follow(() => page.click('step-back'));
    // The reader came from the chapter's Spanish page, so that is the page asked for.
    sentOnlyThePage(finished, OWN_ES, 'a done step');
    assert.equal(finished.href, `${main.url}${OWN_ES}#done=${STEP}`);

    // -- 3. The strip of a done step, on another screen --
    await standBy();
    await page.store(PROGRESS_KEY, noteFor({ following: STEP, followedAt: at, steps: { [STEP]: { ...done, from: OWN } } }));
    await open('/', 'home-do-link');
    await untilStrip(page, STEP, 'done');
    assert.equal(await page.text('strip-chapter'), en.back);
    await page.page.evaluate(() => window.scrollTo(0, 0));
    const fromStrip = await follow(() => page.click('strip-chapter'));
    sentOnlyThePage(fromStrip, OWN, 'the strip of a done step');
    assert.equal(fromStrip.href, `${main.url}${OWN}#done=${STEP}`);

    // -- 4. A done step, with another step of its chapter done as well: the ending names both, this one first.
    //       The request is the same as ever: the chapter's page, and nothing of the ending. --
    const other = { started: true as const, doneAt: at - 60_000, parts: { 1: true as const, 2: true as const, 3: true as const } };
    await standBy();
    await page.store(PROGRESS_KEY, noteFor({ following: null, steps: { [STEP]: { ...done, from: OWN }, 'no-balances': other } }));
    await open(`/do/${STEP}`, 'step-done');
    assert.equal(await hrefOf(page, 'step-back'), `${main.url}${OWN}#done=${STEP},no-balances`);
    const two = await follow(() => page.click('step-back'));
    sentOnlyThePage(two, OWN, 'a done step beside another done step');
    assert.equal(two.href, `${main.url}${OWN}#done=${STEP},no-balances`);

    // -- 5. The strip of a step under way that was reached by its card: the way back to the chapter is there
    //       before the step is done, and names its card. --
    await standBy();
    await page.store(PROGRESS_KEY, noteFor({ following: STEP, followedAt: at, steps: { [STEP]: { started: true, from: OWN } } }));
    await open('/', 'home-do-link');
    await until(async () => (await stripOf(page))?.step === STEP, 'the strip of the step that is followed');
    assert.notEqual((await stripOf(page))?.says, 'done');
    assert.equal(await page.text('strip-chapter'), en.back);
    await page.page.evaluate(() => window.scrollTo(0, 0));
    const underWayStrip = await follow(() => page.click('strip-chapter'));
    sentOnlyThePage(underWayStrip, OWN, 'the strip of a step under way');
    assert.equal(underWayStrip.href, `${main.url}${OWN}#do-${STEP}`);

    // -- 6. "Hold some", which a need of this step sent the reader to. Its own chapter is chapter 2. "Back to
    //       the chapter" asks the main site for the page the reader left, chapter 3, and for nothing else, and
    //       the address names the card they pressed there. --
    await standBy();
    await page.store(
      PROGRESS_KEY,
      noteFor({ following: 'hold-some', followedAt: at, steps: { 'hold-some': { started: true, cameFor: STEP, parts: { 1: true } }, [STEP]: { started: true, from: OWN } } }),
    );
    await open('/do/hold-some', 'step-parts');
    assert.equal(await page.text('step-back'), en.back);
    const detour = await follow(() => page.click('step-back'));
    sentOnlyThePage(detour, OWN, 'a step that a need sent the reader to');
    assert.equal(detour.href, `${main.url}${OWN}#do-${STEP}`);
    assert.ok(!main.asked.some((each) => each.path.includes('what-bitcoin-actually-is')), 'the chapter of "Hold some" was never asked for');

    // -- 7. A chapter's name on the list of steps: the chapter's page, and no ending at all --
    await standBy();
    await open('/do', 'do-list');
    const names = await page.page.$$(hook('do-chapter'));
    assert.equal(names.length, 3);
    assert.equal(await names[1]!.evaluate((link) => link.getAttribute('href')), `${main.url}${OWN}`);
    const byName = await follow(() => names[1]!.click());
    sentOnlyThePage(byName, OWN, 'a chapter\'s name');
    assert.equal(byName.href, `${main.url}${OWN}`);

    // -- 8. In Spanish, with no way back noted: the chapter's Spanish page --
    await standBy();
    await page.store(PROGRESS_KEY, null);
    await open(`/es/do/${STEP}`, 'step-parts');
    assert.equal(await page.text('step-back'), es.back);
    const spanish = await follow(() => page.click('step-back'));
    sentOnlyThePage(spanish, OWN_ES, 'the Spanish page');
    assert.equal(spanish.href, `${main.url}${OWN_ES}#do-${STEP}`);

    // -- 9. The stand-in does see a Referer when a link sends one. The same link, made by hand into an
    //       exception to the page's policy (which the app never makes), tells the main site the practice
    //       site's name. --
    await standBy();
    await open(`/do/${STEP}`, 'step-parts');
    await page.page.$eval(hook('step-back'), (link) => link.setAttribute('referrerpolicy', 'origin'));
    const excepted = await follow(() => page.click('step-back'));
    assert.deepEqual(excepted.asked.map((each) => [each.method, each.path, each.headers.referer]), [['GET', OWN, `${practice.origin}/`]]);
    assert.equal(excepted.referrer, `${practice.origin}/`);

    // -- Back in the wallet: every page of the practice site came with that policy, nothing was counted but the
    //    screens, and the note is as the last opening left it --
    await standBy();
    await open('/do', 'do-list');
    for (const [path, policy] of policies()) assert.equal(policy, 'no-referrer', path);
    assert.equal(policies().length, 20, 'ten screens of the app, and ten times the page beside it');
    await ends(s, reader, counted, { records: [record], words: [words], addresses: [record.firstAddress], txids: [] });
  },
);
