// The Receive screen in a browser: the address, and the faucet behind the
// bot check, from the tap to the confirmed coin.
//
// The bot check is the stand-in of e2e/src/fake-turnstile.ts, so nothing
// here reaches Cloudflare. The wallets are made without a passkey (a stored
// passkey wallet cannot be prepared: it needs the Create screen), so no
// scenario here asks for a passkey.
//
// Every scenario here that asks the faucet for coins is local only: a live
// run asks nothing of a faucet that is not its own (e2e/test/live.test.ts
// holds the runs to that), and reports them as skipped. The two that ask
// nothing of it (a closed faucet, settings that come late) run anywhere,
// with a wallet of fresh words.
//
// What a reader on a phone sees is part of what is checked: the faucet
// answers under its button and a new address appears above its button, so
// several scenarios tap with the button at the screen's lower edge and then
// ask how much of the answer is on screen. Set RECEIVE_SHOTS to a folder
// and those moments are saved there as pictures of the screen, to look at.
//
// What takes time here is the wallet's own pace, in real seconds: it looks
// at the shown address every 5 seconds and at the chain's height every 15,
// and after "busy" it waits 20 before it asks the faucet again.

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deriveAddress, watchOnlyAccount } from '@learnbitcoin/practice-wallet';
import { qrShape } from '../../app/src/components/qr-path.ts';
import { fill } from '../../app/src/lib/format.ts';
import { RECORD_KEY } from '../../app/src/lib/keystore.ts';
import { BOT_CHECK_WAIT_MS } from '../../app/src/screens/receive/bot-check.ts';
import { BOX_SAY_MS, FAUCET_ONCE_HOURS } from '../../app/src/screens/receive/faucet.ts';
import { strings } from '../../app/src/strings/index.ts';
import type { StandInCall } from '../src/fake-turnstile.ts';
import { DUMMY_TOKEN, freshRecord, scenario, testRecord, type OpenedPage, type Scenario } from './helpers.ts';

const en = strings.receive.en;
const es = strings.receive.es;

/** How long a step may take that waits for the wallet's next look at the practice network, on a busy machine. */
const NETWORK_WAIT = 45_000;

/** One thing the faucet's state line showed. */
interface Said {
  phase: string;
  text: string;
  /** The promised transaction's ID where it stands as plain text. */
  txid: string | null;
  /** Where the transaction's link goes, once it is a link. */
  link: string | null;
}

/** From now on, keeps everything the faucet's state line shows, in order, where statesOf() can read it. */
async function watchStates(page: OpenedPage): Promise<void> {
  await page.page.evaluate(() => {
    const seen: Said[] = [];
    (window as unknown as { __faucetSaid: Said[] }).__faucetSaid = seen;
    const read = (): void => {
      const line = document.querySelector('[data-testid="faucet-state"]');
      if (!line) return;
      const now: Said = {
        phase: line.getAttribute('data-phase') ?? '',
        text: (line.textContent ?? '').replace(/\s+/g, ' ').trim(),
        txid: line.querySelector('[data-testid="faucet-txid"]')?.textContent ?? null,
        link: line.querySelector('[data-testid="faucet-tx-link"]')?.getAttribute('href') ?? null,
      };
      const last = seen.at(-1);
      if (!last || last.phase !== now.phase || last.text !== now.text || last.link !== now.link) seen.push(now);
    };
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    read();
  });
}

/** What the state line showed since watchStates(): the first text of each phase it went through, in order. */
async function statesOf(page: OpenedPage): Promise<Said[]> {
  const all = await page.page.evaluate(() => (window as unknown as { __faucetSaid: Said[] }).__faucetSaid);
  return all.filter((said, index) => index === 0 || all[index - 1]!.phase !== said.phase);
}

/** Waits until the state line is in this phase. */
async function untilPhase(page: OpenedPage, phase: string, timeout = NETWORK_WAIT): Promise<void> {
  await page.page.waitForSelector(`[data-testid="faucet-state"][data-phase="${phase}"]`, { timeout });
}

/** How many of the bot check's script elements the page holds. */
const botCheckScripts = (page: OpenedPage): Promise<number> =>
  page.page.$$eval('script[src^="https://challenges.cloudflare.com/"]', (found) => found.length);

/** How many widgets the stand-in bot check has on screen. */
const widgetsOnScreen = (page: OpenedPage): Promise<number> =>
  page.page.$$eval('[data-testid="bot-check"] [data-stand-in-bot-check]', (found) => found.length);

/** How many documents the page has loaded so far: one more for every full page load. (The harness loads one of its own first, to put the wallet in storage.) */
const documentsOf = (page: OpenedPage): number => page.responses.filter((response) => response.type === 'document').length;

/** The events the Worker passed on that say how a request to the faucet ended. */
async function faucetEvents(s: Scenario): Promise<string[]> {
  await s.stack.settled();
  return s.stack.events.filter(({ event }) => event.name === 'Faucet').map(({ event }) => `${event.path} ${event.value}`);
}

const renders = (calls: StandInCall[]): StandInCall[] => calls.filter((call) => call.op === 'render');

/** The path that draws the QR code on screen. */
const qrPath = (page: OpenedPage): Promise<string | null> =>
  page.page.$eval('[data-testid="receive-qr"] path', (path) => path.getAttribute('d'));

/** Whether "Show a new address" is switched off. */
const newAddressOff = (page: OpenedPage): Promise<boolean> =>
  page.page.$eval('[data-testid="new-address"]', (button) => (button as HTMLButtonElement).disabled);

/**
 * Taps the element with this hook where a reader on a phone often has it:
 * with its lower edge close to the bottom of the screen, so that whatever
 * appears under it is off the screen unless the page brings it there.
 */
async function tapAtBottom(page: OpenedPage, hook: string): Promise<void> {
  const at = await page.page.evaluate((testid) => {
    const target = document.querySelector(`[data-testid="${testid}"]`)!;
    window.scrollBy(0, target.getBoundingClientRect().bottom - window.innerHeight * 0.95);
    const box = target.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, hook);
  await page.page.mouse.click(at.x, at.y);
}

/** How much of the first element that matches is on screen, under the banner: from 0 (none of it) to 1 (all of it). */
const shareOnScreen = (page: OpenedPage, selector: string): Promise<number> =>
  page.page.evaluate((query) => {
    const box = document.querySelector(query)?.getBoundingClientRect();
    if (!box || box.height === 0) return 0;
    const banner = document.querySelector('[role="note"]')?.getBoundingClientRect().bottom ?? 0;
    const shown = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, banner);
    return Math.round((100 * Math.max(0, shown)) / box.height) / 100;
  }, selector);

/** Waits until all of the first element that matches is on screen: a scroll takes a frame or two. */
async function untilOnScreen(page: OpenedPage, selector: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while ((await shareOnScreen(page, selector)) < 1 && Date.now() < deadline) await new Promise((wake) => setTimeout(wake, 50));
  assert.equal(await shareOnScreen(page, selector), 1, `${selector} is not all on screen`);
}

/**
 * Saves what the screen shows now, when RECEIVE_SHOTS names a folder. For
 * looking at, not for asserting. `bring` names something to put in the
 * middle of the screen first: only for a step where nothing that follows
 * depends on where the page stands.
 */
async function snap(page: OpenedPage, name: string, bring?: string): Promise<void> {
  const folder = process.env.RECEIVE_SHOTS;
  if (!folder) return;
  mkdirSync(folder, { recursive: true });
  if (bring !== undefined) {
    await page.page.$eval(bring, (element) => element.scrollIntoView({ block: 'center' }));
  }
  await page.page.screenshot({ path: join(folder, `${name}.png`) as `${string}.png` });
}

/** "100,000 practice sats", as the wallet's settings in this run have it. */
const pays = (s: Scenario, lang: 'en' | 'es' = 'en'): string =>
  `${s.stack.config.faucetSats.toLocaleString('en-US')} ${strings.common[lang].practiceSats}`;

scenario('the faucet pays a wallet made without a passkey: from the tap to the first confirmation, and then a new address', { localOnly: true }, async (s) => {
  const record = testRecord();
  const page = await s.open('/wallet/receive', { record });
  const amount = s.stack.config.faucetSats.toLocaleString('en-US');

  // The address: the wallet's first, as text beside its QR code, with its place in the wallet.
  await page.waitFor('receive-address');
  const address = await page.text('receive-address');
  assert.equal(address, record.firstAddress);
  assert.equal(await page.page.$eval('[data-testid="receive-qr"]', (code) => code.getAttribute('aria-label')), en.qrLabel);
  assert.equal(await page.text('receive-path'), "m/84'/1'/0'/0/0");
  // The QR code is the code of exactly that address, and "Copy address" copies exactly that
  // address: a wrong one of either would send the payer's coins somewhere else.
  assert.equal(await qrPath(page), qrShape(address).d);
  await page.click('receive-copy');
  assert.equal(await page.waitForStatus(en.addressCopied), en.addressCopied);
  // Reading the clipboard back needs the browser's leave. It is given after the copy and taken
  // back at once: while a list of permissions is in force here, Chrome refuses the page every
  // permission that is not on it, writing to the clipboard included.
  await page.context.overridePermissions(s.url, ['clipboard-read']);
  assert.equal(await page.page.evaluate(() => navigator.clipboard.readText()), address);
  await page.context.clearPermissionOverrides();

  // Before the tap: nothing of the bot check is in the page, and nothing was asked of Cloudflare.
  assert.equal(await botCheckScripts(page), 0);
  assert.deepEqual(await page.turnstileCalls(), []);
  assert.deepEqual(page.responses.filter((response) => response.url.includes('cloudflare')), []);
  assert.deepEqual(await page.texts('faucet-state'), []);
  assert.deepEqual(await page.texts('new-address'), [], 'no coins have arrived: no new address is offered yet');
  // A wallet made without a passkey has nothing to lock.
  assert.deepEqual(await page.texts('faucet-locks'), []);
  assert.deepEqual(await page.texts('lock-state'), []);
  // What the tap sets going stands above the button, and the button names it as its description:
  // a reader who tabs to the button hears that a bot check of Cloudflare's will load.
  const described = await page.page.$eval('[data-testid="faucet-ask"]', (button) =>
    (document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
  assert.equal(described, `${fill(en.faucetPays, { amount: pays(s) })} ${en.faucetCheck}`);

  // The tap.
  await watchStates(page);
  await page.click('faucet-ask');
  await untilPhase(page, 'arrived');

  // The coin is in the wallet, unconfirmed. The address card says what arrived and offers a new address.
  assert.equal(await page.text('receive-arrived'), `${amount} practice sats arrived at this address.`);
  assert.equal(await page.text('new-address'), en.newAddress);
  assert.equal(await page.text('receive-address'), address, 'the address stays');
  assert.deepEqual(await page.texts('faucet-ask'), [], 'the faucet has paid this address: no button to ask again');
  // With the button, what the tap would set going is gone too: both have happened.
  assert.ok(!(await page.text('faucet')).includes(en.faucetCheck), 'the paragraph about the bot check has left with the button');
  assert.ok((await page.text('faucet')).startsWith(`${en.faucetTitle} ${fill(en.faucetPays, { amount: pays(s) })}`));
  // The button that was pressed is gone. Focus went to what took its place, not to nowhere.
  assert.equal(await page.page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'faucet-state');
  assert.equal(await page.text('faucet-once'), fill(en.faucetOnce, { hours: String(FAUCET_ONCE_HOURS) }));
  // The faucet paid from its own coins, so nothing is said of the pot.
  assert.deepEqual(await page.texts('faucet-pot'), []);
  assert.deepEqual(await s.network.coins(address), { count: 1, sats: s.stack.config.faucetSats });

  // A block. The page hears of it within its next look at the chain.
  await s.network.nextBlock();
  await untilPhase(page, 'confirmed');
  assert.equal(await page.text('receive-address'), address, 'the address stays');

  // What the state line said at each phase.
  const said = await statesOf(page);
  assert.deepEqual(said.map((each) => each.phase), ['checking', 'asking', 'on-its-way', 'arrived', 'confirmed']);
  const [checking, asking, promised, arrived, confirmed] = said as [Said, Said, Said, Said, Said];
  assert.equal(checking.text, en.stateChecking);
  assert.equal(asking.text, en.stateAsking);
  // On its way: the promised amount, and the transaction ID as text. Not a link yet.
  assert.ok(promised.text.startsWith(fill(en.statePromised, { amount: pays(s) })), promised.text);
  assert.match(promised.txid ?? '', /^[0-9a-f]{64}$/);
  assert.equal(promised.link, null);
  const txid = promised.txid!;
  assert.ok(promised.text.includes(`${en.txid} ${txid}`), promised.text);
  // Arrived: unconfirmed until the next block, and now the ID is a link to the transaction's screen.
  const arrivedText = fill(en.stateArrived, { amount: pays(s), seconds: String(s.stack.config.blockSeconds), minutes: '10' });
  assert.ok(arrived.text.startsWith(arrivedText), arrived.text);
  assert.equal(arrived.link, `/wallet/tx/${txid}`);
  assert.equal(arrived.txid, null);
  // Confirmed.
  assert.ok(confirmed.text.startsWith(fill(en.stateConfirmed, { amount: pays(s) })), confirmed.text);
  assert.equal(confirmed.link, `/wallet/tx/${txid}`);

  // What the status region said: the faucet's answer from this screen, the arrival and the confirmation from the wallet.
  assert.equal(await page.waitForStatus('The faucet has sent'), `The faucet has sent ${pays(s)} to this address.`);
  assert.equal(await page.waitForStatus('arrived'), `${amount} practice sats arrived.`);
  assert.equal(await page.waitForStatus('confirmation'), '1 confirmation.');

  // What was counted: one request, which ended well.
  assert.deepEqual(await faucetEvents(s), ['/wallet/receive ok']);

  // The bot check: one script, and one widget, drawn for the action "faucet" and exactly the address
  // on screen, in English, at its normal size on a wide screen. It was taken away once it had answered.
  assert.equal(await botCheckScripts(page), 1);
  const calls = await page.turnstileCalls();
  assert.deepEqual(calls.map((call) => call.op), ['render', 'remove']);
  assert.deepEqual(calls[0]!.options, {
    sitekey: s.stack.config.turnstileSiteKey,
    action: 'faucet',
    cData: address,
    language: 'en',
    appearance: 'interaction-only',
    'response-field': false,
    size: 'normal',
  });
  assert.deepEqual([...calls[0]!.callbacks!].sort(), ['callback', 'error-callback', 'expired-callback', 'timeout-callback']);
  assert.equal(await widgetsOnScreen(page), 0);
  assert.deepEqual(s.stack.botChecks, [{ token: DUMMY_TOKEN, address }]);

  // "Show a new address": the next address of the wallet, a fresh start for the faucet, and the reader is told.
  page.forgetStatus();
  await page.click('new-address');
  const next = deriveAddress(watchOnlyAccount(record.xpub), 0, 1).address;
  assert.notEqual(next, address);
  assert.equal(await page.text('receive-address'), next);
  assert.equal(await page.text('receive-path'), "m/84'/1'/0'/0/1");
  assert.equal(await page.text('receive-new'), en.newAddressShown);
  assert.equal(await page.waitForStatus(en.newAddressShown), en.newAddressShown);
  assert.deepEqual(await page.texts('new-address'), []);
  assert.deepEqual(await page.texts('receive-arrived'), []);
  assert.deepEqual(await page.texts('faucet-state'), []);
  assert.equal(await page.text('faucet-ask'), en.faucetAsk);
  // Focus is on the address that changed, not on a button that is gone.
  assert.equal(
    await page.page.evaluate(() => document.activeElement?.querySelector('[data-testid="receive-address"]') !== null),
    true,
  );
  assert.equal(await qrPath(page), qrShape(next).d, 'the QR code is the new address');

  // Asked again, the bot check is drawn anew for the address that is on screen now. A token made for
  // the first address would be refused by the deployed Worker, and no local run could tell.
  await page.click('faucet-ask');
  await untilPhase(page, 'on-its-way', 20_000);
  assert.deepEqual(renders(await page.turnstileCalls()).map((render) => render.options?.cData), [address, next]);
  assert.deepEqual(s.stack.botChecks, [{ token: DUMMY_TOKEN, address }, { token: DUMMY_TOKEN, address: next }]);
  assert.deepEqual(await faucetEvents(s), ['/wallet/receive ok', '/wallet/receive ok']);
});

scenario('a busy faucet: the countdown shows, the address waits, and once the faucet is free the page asks again by itself', { localOnly: true }, async (s) => {
  const record = testRecord();
  const address = record.firstAddress;
  const page = await s.open('/wallet/receive', { record, width: 375 });
  await page.waitFor('faucet-ask');

  // Coins from somewhere else arrive first, so "Show a new address" is on screen when the request starts.
  s.standIn.fund(address, 2_500, { confirmed: false });
  await page.page.waitForSelector('[data-testid="receive-arrived"]', { timeout: 20_000 });
  assert.equal(await page.text('receive-arrived'), '2,500 practice sats arrived at this address.');
  assert.equal(await newAddressOff(page), false);

  s.standIn.setFaucet('busy');
  await watchStates(page);
  // The button is at the screen's lower edge: the faucet's answer appears below it.
  await tapAtBottom(page, 'faucet-ask');
  await untilPhase(page, 'waiting', 20_000);

  // Why the faucet refused for now, and when the page asks again.
  const waiting = await page.text('faucet-state');
  assert.ok(waiting.startsWith(strings.errors.en.busy), waiting);
  const retry = /^Asking again in ([0-9]+) seconds\.$/.exec(await page.text('faucet-retry'));
  assert.ok(retry !== null && Number(retry[1]) >= 1 && Number(retry[1]) <= 20, `the countdown: ${String(retry?.[0])}`);
  // It answers the reader's tap, so it is an alert, and the page has moved to show it.
  assert.equal(await page.page.$eval('[data-testid="faucet-state"] [role="alert"]', (alert) => alert !== null), true);
  await untilOnScreen(page, '[data-testid="faucet-state"]');
  await snap(page, 'busy-waiting-375-en');
  // The countdown is under the alert, not in it: an alert is read out whole, and this line changes every second.
  assert.equal(
    await page.page.$eval('[data-testid="faucet-state"] [role="alert"]', (alert) => alert.querySelector('[role="timer"]') === null),
    true,
  );
  // The request is still under way: the faucet's button says so and takes no tap...
  assert.equal(await page.text('faucet-ask'), en.faucetBusy);
  assert.equal(await page.page.$eval('[data-testid="faucet-ask"]', (button) => button.getAttribute('aria-busy')), 'true');
  // ...and the address is held: "Show a new address" is switched off, with the reason under it.
  assert.equal(await newAddressOff(page), true);
  assert.equal(await page.text('new-address-waits'), en.newAddressWaits);
  assert.equal(await page.text('receive-address'), address);
  // Nothing was paid, and nothing was counted yet: a request is counted once, when it ends.
  assert.deepEqual(await faucetEvents(s), []);

  // The faucet is free again. The page asks by itself when its wait is over, with a fresh bot check.
  s.standIn.setFaucet('ok');
  await untilPhase(page, 'arrived', 45_000);
  const said = await statesOf(page);
  assert.deepEqual(
    said.map((each) => each.phase),
    ['checking', 'asking', 'waiting', 'checking', 'asking', 'on-its-way', 'arrived'],
  );
  assert.equal(await page.text('receive-address'), address, 'the address stays');
  assert.equal(await newAddressOff(page), false);
  assert.deepEqual(await page.texts('new-address-waits'), []);
  // Both coins are at the address now.
  assert.equal(await page.text('receive-arrived'), '102,500 practice sats arrived at this address.');

  // The bot check was asked twice: the faucet uses a token up, also when it refuses. Each time the
  // widget was drawn anew for the address on screen, compact on a 375 px screen, and taken away again.
  const calls = await page.turnstileCalls();
  assert.deepEqual(calls.map((call) => call.op), ['render', 'remove', 'render', 'remove']);
  for (const render of renders(calls)) {
    assert.equal(render.options?.action, 'faucet');
    assert.equal(render.options?.cData, address);
    assert.equal(render.options?.size, 'compact');
  }
  assert.equal(await botCheckScripts(page), 1, 'the script is added once');
  assert.deepEqual(s.stack.botChecks, [{ token: DUMMY_TOKEN, address }, { token: DUMMY_TOKEN, address }]);
  // One request, however often it asked.
  assert.deepEqual(await faucetEvents(s), ['/wallet/receive ok']);
  assert.equal(await page.sidewaysScroll(), 0);
});

scenario('a bot check that fails: the cause, and another it can have; asked again once it passes, the faucet pays', { localOnly: true }, async (s) => {
  const record = testRecord();
  const address = record.firstAddress;
  const page = await s.open('/wallet/receive', { record, turnstile: 'fail' });
  await page.waitFor('faucet-ask');
  await watchStates(page);
  await page.click('faucet-ask');
  await untilPhase(page, 'failed', 20_000);

  // The failure's own sentence (a content blocker), then another cause it can have (a network that stops Cloudflare).
  const failed = await page.text('faucet-state');
  assert.equal(failed, `${strings.errors.en['no-token']} ${en.failedOtherCause}`);
  assert.equal(await page.page.$eval('[data-testid="faucet-state"] [role="alert"]', (alert) => alert !== null), true);
  assert.deepEqual((await statesOf(page)).map((each) => each.phase), ['checking', 'failed']);
  // The button can be pressed again, and the address is free again.
  assert.equal(await page.text('faucet-ask'), en.faucetAsk);
  assert.equal(await page.page.$eval('[data-testid="faucet-ask"]', (button) => button.getAttribute('aria-busy')), null);
  // The widget that failed is gone: left alone, it would try again every few seconds.
  await page.page.waitForFunction(() => document.querySelector('[data-stand-in-bot-check]') === null);
  assert.deepEqual((await page.turnstileCalls()).map((call) => call.op), ['render', 'remove']);
  // The Worker was never asked, and the request is counted as failed. ("Faucet: bot-check" is
  // for a token the Worker refuses: the next scenario.)
  assert.deepEqual(s.stack.botChecks, []);
  assert.deepEqual(await faucetEvents(s), ['/wallet/receive failed']);
  assert.deepEqual(await s.network.coins(address), { count: 0, sats: 0 });

  // Whatever stopped the check is out of the way. The same button asks again, in the same page.
  await page.setTurnstile('pass');
  await page.click('faucet-ask');
  await untilPhase(page, 'on-its-way', 20_000);
  assert.equal(await botCheckScripts(page), 1, 'the script is not added a second time');
  assert.deepEqual((await page.turnstileCalls()).map((call) => call.op), ['render', 'remove', 'render', 'remove']);
  assert.deepEqual(s.stack.botChecks, [{ token: DUMMY_TOKEN, address }]);
  assert.deepEqual(await faucetEvents(s), ['/wallet/receive failed', '/wallet/receive ok']);
});

scenario('a token the Worker does not accept: one fresh check, then the bot check\'s own sentence, counted as "bot-check"', { localOnly: true }, async (s) => {
  const record = testRecord();
  const address = record.firstAddress;
  const stale = 'XXXX.STALE.TOKEN.XXXX';
  const page = await s.open('/wallet/receive', { record });
  // The stand-in bot check hands out the one token the local Worker accepts. Here every widget
  // hands the page another one in its place, as if each token had expired on its way: put in
  // front of the bot check's own object before the page's script runs, then the page is loaded again.
  await page.page.evaluateOnNewDocument((token: string) => {
    type Api = { render(container: unknown, options: Record<string, unknown>): unknown };
    let api: Api | undefined;
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      get: () => api,
      set(value: Api) {
        const render = value.render;
        value.render = (container, options) =>
          render(container, { ...options, callback: () => (options.callback as (given: string) => void)(token) });
        api = value;
      },
    });
  }, stale);
  await page.goto('/wallet/receive');
  await page.waitFor('faucet-ask');
  await watchStates(page);
  await page.click('faucet-ask');
  await untilPhase(page, 'failed', 20_000);

  assert.equal(await page.text('faucet-state'), strings.errors.en.bot_check);
  // Refused once, the wallet takes one fresh token and asks once more. Refused again, it stops.
  assert.deepEqual((await statesOf(page)).map((each) => each.phase), ['checking', 'asking', 'checking', 'asking', 'failed']);
  assert.deepEqual(s.stack.botChecks, [{ token: stale, address }, { token: stale, address }]);
  // The fresh token came from a widget drawn anew, for the same address.
  const calls = await page.turnstileCalls();
  assert.deepEqual(calls.map((call) => call.op), ['render', 'remove', 'render', 'remove']);
  for (const render of renders(calls)) assert.equal(render.options?.cData, address);
  assert.deepEqual(await faucetEvents(s), ['/wallet/receive bot-check']);
  assert.deepEqual(await s.network.coins(address), { count: 0, sats: 0 });
  assert.equal(await page.text('faucet-ask'), en.faucetAsk);
});

scenario('a bot check whose box gets no tick: the box is brought on screen and said, and after a minute the screen says that it was not ticked; one that ran unseen is told as before', { localOnly: true }, async (s) => {
  const record = testRecord();
  const page = await s.open('/wallet/receive', { record, turnstile: 'never', width: 375 });
  // The screen gives the bot check a minute. So that this scenario need not sit through it, the
  // page's clock is held for that one wait, and the scenario lets it run out when it is ready:
  // put in place before the page's script runs, then the page is loaded again.
  await page.page.evaluateOnNewDocument((wait: number) => {
    const real = window.setTimeout.bind(window);
    const held = window as unknown as { __minuteOver?: () => void };
    window.setTimeout = ((run: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms !== wait) return real(run, ms, ...rest);
      held.__minuteOver = run;
      return 0;
    }) as typeof window.setTimeout;
  }, BOT_CHECK_WAIT_MS);
  await page.goto('/wallet/receive');
  await page.waitFor('faucet-ask');
  // Whether <main> is marked busy, each time that changes.
  await page.page.evaluate(() => {
    const main = document.querySelector('main')!;
    const seen = [main.getAttribute('aria-busy')];
    (window as unknown as { __busy: (string | null)[] }).__busy = seen;
    new MutationObserver(() => seen.push(main.getAttribute('aria-busy'))).observe(main, { attributes: true, attributeFilter: ['aria-busy'] });
  });
  // The reader has the button at the lower edge of a phone's screen: all the faucet says appears below it.
  await tapAtBottom(page, 'faucet-ask');
  await untilPhase(page, 'checking', 20_000);

  // What is running and what to do about a box, with the widget under it.
  assert.equal(await page.text('faucet-state'), en.stateChecking);
  await page.page.waitForSelector('[data-testid="bot-check"] [data-stand-in-bot-check]');
  assert.equal(await page.text('faucet-ask'), en.faucetBusy);
  // Whose check it is and what it is given still stands above the button while it runs.
  assert.ok((await page.text('faucet')).includes(en.faucetCheck));
  // <main> was busy from the tap until the widget was on screen, and no longer: the widget may be waiting for the reader.
  assert.deepEqual(await page.page.evaluate(() => (window as unknown as { __busy: (string | null)[] }).__busy), [null, 'true', null]);
  // The box waits for the reader, so the page has moved to show it, with the line that says to tick it.
  await untilOnScreen(page, '[data-testid="bot-check"]');
  await untilOnScreen(page, '[data-testid="faucet-state"]');
  await snap(page, 'box-waits-375-en');
  // A reader who cannot see the box is told that it is there, once it has stood a moment.
  assert.equal(await page.waitForStatus(en.checkBoxShows), en.checkBoxShows);
  // It is still running: nothing has been asked of the faucet.
  assert.equal(await page.text('faucet-state'), en.stateChecking);
  assert.deepEqual(s.stack.botChecks, []);

  // The minute is over.
  await page.page.evaluate(() => (window as unknown as { __minuteOver(): void }).__minuteOver());
  await untilPhase(page, 'failed', 20_000);
  // The box stood on screen and nobody ticked it. That is the cause the screen gives, with its own
  // way out: not a content blocker, and not a network that stops Cloudflare.
  assert.equal(await page.text('faucet-state'), en.failedBoxWaited);
  assert.equal(await page.page.$eval('[data-testid="faucet-box-waited"]', (box) => box.getAttribute('role')), 'alert');
  await page.page.waitForFunction(() => document.querySelector('[data-stand-in-bot-check]') === null);
  await untilOnScreen(page, '[data-testid="faucet-state"]');
  await snap(page, 'box-not-ticked-375-en');
  assert.deepEqual((await page.turnstileCalls()).map((call) => call.op), ['render', 'remove']);
  assert.deepEqual(s.stack.botChecks, []);
  assert.deepEqual(await faucetEvents(s), ['/wallet/receive failed']);
  assert.equal(await page.text('faucet-ask'), en.faucetAsk);

  // Asked again, and this time the widget stays out of sight, as Cloudflare's does while it needs
  // nobody: whatever the bot check puts in its place is hidden the moment it is there.
  await page.page.evaluate(() => {
    const place = document.querySelector('[data-testid="bot-check"]')!;
    new MutationObserver(() => {
      for (const widget of Array.from(place.children)) (widget as HTMLElement).style.display = 'none';
    }).observe(place, { childList: true });
  });
  await page.click('faucet-ask');
  await untilPhase(page, 'checking', 20_000);
  await page.page.waitForSelector('[data-testid="bot-check"] [data-stand-in-bot-check]');
  // No box to tick, so nothing is said of one, however long the check runs.
  await new Promise((wake) => setTimeout(wake, BOX_SAY_MS + 700));
  assert.equal(page.statusLog().filter((said) => said === en.checkBoxShows).length, 1, 'said once, for the first check only');
  await page.page.evaluate(() => (window as unknown as { __minuteOver(): void }).__minuteOver());
  await untilPhase(page, 'failed', 20_000);
  // A check that went nowhere unseen: here a content blocker or the network is the likely cause.
  assert.equal(await page.text('faucet-state'), `${strings.errors.en['no-token']} ${en.failedOtherCause}`);
  assert.deepEqual(await page.texts('faucet-box-waited'), []);
  assert.deepEqual((await page.turnstileCalls()).map((call) => call.op), ['render', 'remove', 'render', 'remove']);
  assert.deepEqual(await faucetEvents(s), ['/wallet/receive failed', '/wallet/receive failed']);
});

scenario('a refusal that only a fresh page cures: the sentence says to reload, and the button under it does', { localOnly: true }, async (s) => {
  const record = testRecord();
  const page = await s.open('/about', { record });
  // "forbidden" is what the Worker answers a request it does not take to be this site's own, and
  // nothing a scenario does makes it say so to its own page. So that one answer is put in the
  // Worker's place: in front of fetch before the page's script runs, then the page is loaded again.
  await page.page.evaluateOnNewDocument(() => {
    const real = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith('/api/faucet')) return real(input, init);
      const body = JSON.stringify({ error: 'forbidden' });
      return Promise.resolve(new Response(body, { status: 403, headers: { 'Content-Type': 'application/json' } }));
    }) as typeof window.fetch;
  });
  await page.goto('/wallet/receive');
  await page.waitFor('faucet-ask');
  await page.click('faucet-ask');
  await untilPhase(page, 'failed', 20_000);

  // The sentence ends "Reload the page and try again", and the button that does it stands under it.
  assert.equal(await page.text('faucet-state'), `${strings.errors.en.forbidden} ${strings.common.en.reload}`);
  assert.match(strings.errors.en.forbidden, /Reload the page/);
  assert.equal(await page.text('faucet-reload'), strings.common.en.reload);
  assert.deepEqual(s.stack.botChecks, [], 'the request never reached the Worker');
  assert.deepEqual(await faucetEvents(s), ['/wallet/receive failed']);

  const loaded = documentsOf(page);
  await Promise.all([page.page.waitForNavigation({ waitUntil: 'load' }), page.click('faucet-reload')]);
  assert.equal(documentsOf(page), loaded + 1, 'a full page load');
  // The fresh page: the same address, nothing asked, and no bot check until the reader asks again.
  await page.waitFor('faucet-ask');
  assert.equal(await page.text('receive-address'), record.firstAddress);
  assert.deepEqual(await page.texts('faucet-state'), []);
  assert.equal(await botCheckScripts(page), 0);
});

scenario('the wallet leaves this browser while the bot check waits: the check is ended and its widget taken away with the screen', { localOnly: true }, async (s) => {
  const record = testRecord();
  const page = await s.open('/wallet/receive', { record, turnstile: 'never' });
  await page.waitFor('faucet-ask');
  await page.click('faucet-ask');
  await page.page.waitForSelector('[data-testid="bot-check"] [data-stand-in-bot-check]');
  assert.deepEqual((await page.turnstileCalls()).map((call) => call.op), ['render']);

  // Another tab of the same browser removes the wallet. This tab hears of it, and the screen gives
  // way to "no practice wallet here" at the same address.
  const other = await s.open('/about', { context: page.context });
  await other.store(RECORD_KEY, null);
  await page.waitForGone('faucet');
  assert.equal(await page.stored(), null);
  // The check went with the screen: its widget was taken away by the page, not left running in a
  // corner of the bot check's script, where it would start over every few seconds.
  assert.deepEqual((await page.turnstileCalls()).map((call) => call.op), ['render', 'remove']);
  assert.equal(await page.page.$$eval('[data-stand-in-bot-check]', (found) => found.length), 0);
  assert.deepEqual(s.stack.botChecks, [], 'nothing was asked of the faucet');
});

scenario('a promised payment that is not listed yet: the address stays until the coins are here, and so does the promise', { localOnly: true }, async (s) => {
  const record = testRecord();
  const address = record.firstAddress;
  const page = await s.open('/wallet/receive', { record, width: 375 });
  await page.waitFor('faucet-ask');

  // Coins from somewhere else are at the address already, so "Show a new address" is on screen.
  s.standIn.fund(address, 2_500, { confirmed: false });
  await page.page.waitForSelector('[data-testid="receive-arrived"]', { timeout: 20_000 });
  assert.equal(await newAddressOff(page), false);
  // The practice network takes a while to list the faucet's payment, as the real one can.
  s.standIn.setEsploraLag(120);
  await tapAtBottom(page, 'faucet-ask');
  await untilPhase(page, 'on-its-way', 20_000);
  const txid = await page.text('faucet-txid');
  assert.match(txid, /^[0-9a-f]{64}$/);

  // The promise answers the tap: the page has moved to show it, where the button was.
  await untilOnScreen(page, '[data-testid="faucet-state"]');
  await snap(page, 'promised-375-en');
  // Promised, and not here yet. A new address now would take the promise off the screen, and the
  // coins would later arrive unseen: so the button waits, and says for what.
  assert.equal(await newAddressOff(page), true);
  assert.equal(await page.text('new-address-waits'), en.newAddressWaitsPayment);
  // The line that sends the reader to that button for more coins is not there while it is switched off.
  assert.deepEqual(await page.texts('faucet-once'), []);
  assert.equal(await page.text('receive-address'), address);

  // The block that holds the payment. The address was kept, so the screen shows the coins come.
  await s.network.nextBlock();
  await untilPhase(page, 'confirmed');
  assert.equal(await page.text('receive-address'), address);
  assert.equal(await page.page.$eval('[data-testid="faucet-tx-link"]', (link) => link.getAttribute('href')), `/wallet/tx/${txid}`);
  assert.equal(await page.text('receive-arrived'), '102,500 practice sats arrived at this address.');
  // Now the address is free, and the faucet's line says how to get more.
  assert.equal(await newAddressOff(page), false);
  assert.deepEqual(await page.texts('new-address-waits'), []);
  assert.equal(await page.text('faucet-once'), fill(en.faucetOnce, { hours: String(FAUCET_ONCE_HOURS) }));
  assert.deepEqual(await faucetEvents(s), ['/wallet/receive ok']);
});

scenario('a closed faucet: the card says so, with the other thing that can mean and a Reload button, and has no way to ask', { stack: { vars: { TURNSTILE_SITE_KEY: '' } } }, async (s) => {
  const record = freshRecord();
  const page = await s.open('/wallet/receive', { record, width: 375 });
  await page.waitFor('faucet-closed');
  assert.equal(s.stack.config.turnstileSiteKey, '');

  // The error table's sentence, then what it leaves out: on this page only a reload looks again,
  // and the same shows when the settings could not be read.
  assert.equal(await page.text('faucet-closed'), `${strings.errors.en.closed} ${en.closedReload} ${strings.common.en.reload}`);
  // It was there when the screen opened, so it is no alert.
  assert.equal(await page.page.$eval('[data-testid="faucet-closed"]', (notice) => notice.getAttribute('role')), null);
  await snap(page, 'closed-375-en', '[data-testid="faucet"]');
  // No way to ask, and nothing of the bot check.
  assert.deepEqual(await page.texts('faucet-ask'), []);
  assert.deepEqual(await page.texts('faucet-loading'), []);
  assert.deepEqual(await page.texts('faucet-state'), []);
  assert.equal(await botCheckScripts(page), 0);
  assert.deepEqual(await page.turnstileCalls(), []);
  // The address is there all the same: being paid needs no faucet.
  assert.equal(await page.text('receive-address'), record.firstAddress);
  assert.equal(await page.sidewaysScroll(), 0);

  // The button loads the page afresh, which is when the page asks whether the faucet is open.
  const loaded = documentsOf(page);
  await Promise.all([page.page.waitForNavigation({ waitUntil: 'load' }), page.click('faucet-closed-reload')]);
  assert.equal(documentsOf(page), loaded + 1, 'a full page load');
  await page.waitFor('faucet-closed');
  assert.equal(await page.text('receive-address'), record.firstAddress);
});

scenario('the settings come late, or not at all: the card says it is loading, and never that the faucet is closed before it knows', async (s) => {
  const record = freshRecord();
  const page = await s.open('/about', { record, width: 375 });
  // The page's one request for its settings is held until the scenario lets it through or fails
  // it: put in front of fetch before the page's script runs, then the page is loaded again.
  await page.page.evaluateOnNewDocument(() => {
    const real = window.fetch.bind(window);
    const held = window as unknown as { __settings?: (how: string) => void };
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith('/api/config')) return real(input, init);
      return new Promise<Response>((resolve, reject) => {
        held.__settings = (how) => {
          if (how === 'arrive') real(input, init).then(resolve, reject);
          else reject(new TypeError('Failed to fetch'));
        };
      });
    }) as typeof window.fetch;
  });
  const settings = (how: 'arrive' | 'fail'): Promise<void> =>
    page.page.evaluate((way) => (window as unknown as { __settings(how: string): void }).__settings(way), how);

  await page.goto('/wallet/receive');
  await page.waitFor('receive-address');
  // The wallet's coins were looked up and the address shows. Whether the faucet is open is not known yet.
  assert.equal(await page.text('faucet-loading'), strings.common.en.loading);
  assert.deepEqual(await page.texts('faucet-closed'), []);
  assert.deepEqual(await page.texts('faucet-ask'), []);
  await snap(page, 'settings-loading-375-en', '[data-testid="faucet"]');
  // A while later it still says no more than it knows.
  await new Promise((wake) => setTimeout(wake, 1_000));
  assert.equal(await page.text('faucet-loading'), strings.common.en.loading);
  assert.deepEqual(await page.texts('faucet-closed'), []);

  // The settings arrive, and they name a bot check: the faucet is open.
  await settings('arrive');
  await page.waitFor('faucet-ask');
  assert.deepEqual(await page.texts('faucet-loading'), []);
  assert.deepEqual(await page.texts('faucet-closed'), []);

  // Once more, and this time the request for the settings fails. The page cannot tell that from a
  // faucet that is switched off, so it says both, and offers the one way out that works for both.
  await page.goto('/wallet/receive');
  await page.waitFor('faucet-loading');
  await settings('fail');
  await page.waitFor('faucet-closed');
  const closed = await page.text('faucet-closed');
  assert.ok(closed.includes(en.closedReload), closed);
  assert.equal(await page.text('faucet-closed-reload'), strings.common.en.reload);
  assert.deepEqual(await page.texts('faucet-ask'), []);
  assert.deepEqual(await page.texts('faucet-loading'), []);
  await snap(page, 'settings-failed-375-en', '[data-testid="faucet"]');
});

scenario('a faucet that has paid this address before: it says so, offers a new address, and shows the coins when they come', { localOnly: true }, async (s) => {
  const record = testRecord();
  const address = record.firstAddress;
  // The practice network takes a while to list the faucet's payment, as the real one can.
  s.standIn.setEsploraLag(120);
  const page = await s.open('/wallet/receive', { record });
  await page.waitFor('faucet-ask');
  await page.click('faucet-ask');
  await untilPhase(page, 'on-its-way', 20_000);
  const txid = await page.text('faucet-txid');

  // The reader reloads before the coin shows. The wallet starts over, finds the same address
  // unpaid as far as the network says, and the reader asks again.
  await page.goto('/wallet/receive');
  await page.waitFor('faucet-ask');
  assert.equal(await page.text('receive-address'), address);
  assert.deepEqual(await page.texts('new-address'), []);
  await watchStates(page);
  page.forgetStatus();
  await page.click('faucet-ask');
  await untilPhase(page, 'on-its-way', 20_000);

  // No payment to show for it: the faucet has paid before, and the coins are on their way or already here.
  assert.equal(await page.text('faucet-state'), `${en.statePaidBefore} ${fill(en.faucetOnce, { hours: String(FAUCET_ONCE_HOURS) })}`);
  assert.deepEqual(await page.texts('faucet-txid'), []);
  assert.deepEqual(await page.texts('faucet-tx-link'), []);
  assert.equal(await page.waitForStatus('paid this address before'), 'The faucet has paid this address before.');
  // This address gets nothing more from the faucet, so a new one is offered, though no coins have arrived.
  assert.equal(await page.text('new-address'), en.newAddress);
  assert.deepEqual(await page.texts('receive-arrived'), []);
  assert.deepEqual(await page.texts('faucet-ask'), []);
  assert.deepEqual(await faucetEvents(s), ['/wallet/receive ok', '/wallet/receive already-paid']);

  // The block that holds the first payment. The coins show, confirmed, without a record of the payment.
  await s.network.nextBlock();
  await untilPhase(page, 'confirmed');
  assert.ok((await page.text('faucet-state')).startsWith(en.stateConfirmedNoRecord));
  assert.equal(await page.text('receive-arrived'), '100,000 practice sats arrived at this address.');
  assert.deepEqual((await statesOf(page)).map((each) => each.phase), ['checking', 'asking', 'on-its-way', 'confirmed']);
  assert.deepEqual(await s.network.coins(address), { count: 1, sats: 100_000 });
  assert.match(txid, /^[0-9a-f]{64}$/);

  // Both requests were for the address a widget was drawn for.
  const calls = await page.turnstileCalls();
  assert.deepEqual(renders(calls).map((render) => render.options?.cData), [address, address]);
  assert.deepEqual(s.stack.botChecks, [{ token: DUMMY_TOKEN, address }, { token: DUMMY_TOKEN, address }]);
});

scenario('before the tap a move to another screen loads no page; after it, the next move loads the page afresh, without the bot check', { localOnly: true }, async (s) => {
  const record = testRecord();
  const page = await s.open('/wallet/receive', { record });
  await page.waitFor('faucet-ask');
  const address = await page.text('receive-address');
  const loaded = documentsOf(page);

  // Before the tap: a section link changes the screen inside the page.
  await page.page.click('a[href="/wallet/coins"]');
  await page.page.waitForFunction(() => location.pathname === '/wallet/coins');
  assert.equal(documentsOf(page), loaded, 'no page was loaded');
  await page.page.goBack();
  await page.waitFor('faucet-ask');
  assert.equal(documentsOf(page), loaded);
  assert.equal(await page.text('receive-address'), address, 'the address is still the same one');
  assert.equal(await botCheckScripts(page), 0);
  assert.deepEqual(await page.turnstileCalls(), []);

  // The tap. The bot check's script is in the page from here on.
  await page.click('faucet-ask');
  await untilPhase(page, 'on-its-way', 20_000);
  assert.equal(await botCheckScripts(page), 1);
  assert.equal(await page.page.evaluate(() => typeof (window as unknown as { turnstile?: unknown }).turnstile), 'object');

  // The same link now loads the page afresh: the script is gone before any other screen shows.
  await Promise.all([page.page.waitForNavigation({ waitUntil: 'load' }), page.page.click('a[href="/wallet/coins"]')]);
  assert.equal(documentsOf(page), loaded + 1, 'a full page load');
  assert.equal(await page.page.evaluate(() => location.pathname), '/wallet/coins');
  assert.equal(await botCheckScripts(page), 0);
  assert.equal(await page.page.evaluate(() => typeof (window as unknown as { turnstile?: unknown }).turnstile), 'undefined');

  // Back on Receive in the fresh page: no bot check until the reader asks again.
  await page.goto('/wallet/receive');
  await page.waitFor('receive-address');
  assert.equal(await botCheckScripts(page), 0);
  assert.equal((await page.turnstileCalls()).filter((call) => call.op === 'render').length, 1, 'no widget was drawn since');
});

scenario('the Spanish route: the address, the faucet and the bot check in Spanish, on a phone', { localOnly: true }, async (s) => {
  const record = testRecord();
  const page = await s.open('/es/wallet/receive', { record, lang: 'es', width: 375 });
  const amount = s.stack.config.faucetSats.toLocaleString('en-US');

  await page.waitFor('receive-address');
  const address = await page.text('receive-address');
  assert.equal(address, record.firstAddress, 'an address is the same in every language');
  assert.equal(await page.page.evaluate(() => document.documentElement.lang), 'es');
  assert.equal(await page.page.$eval('main h1', (heading) => heading.textContent?.trim()), strings.common.es.section_receive);
  assert.equal(await page.page.title(), 'Práctica: Recibir | LearnBitcoin');
  const screen = await page.page.$eval('main', (main) => (main.textContent ?? '').replace(/\s+/g, ' '));
  for (const text of [es.lede, es.addressFor, es.faucetCheck, fill(es.faucetPays, { amount: pays(s, 'es') })]) {
    assert.ok(screen.includes(text), text);
  }
  assert.equal(await page.text('faucet-ask'), es.faucetAsk);
  assert.equal(await page.text('receive-copy'), es.copyAddress);
  assert.equal(await page.sidewaysScroll(), 0);
  assert.equal(await botCheckScripts(page), 0);

  // From the keyboard this time: focus on the button, then Enter.
  await watchStates(page);
  await page.page.focus('[data-testid="faucet-ask"]');
  await page.page.keyboard.press('Enter');
  await untilPhase(page, 'arrived');

  // The state line, the address card and the status region speak Spanish.
  const said = await statesOf(page);
  assert.deepEqual(said.map((each) => each.phase), ['checking', 'asking', 'on-its-way', 'arrived']);
  assert.equal(said[0]!.text, es.stateChecking);
  assert.equal(said[1]!.text, es.stateAsking);
  assert.ok(said[2]!.text.startsWith(fill(es.statePromised, { amount: pays(s, 'es') })), said[2]!.text);
  const arrived = fill(es.stateArrived, { amount: pays(s, 'es'), seconds: String(s.stack.config.blockSeconds), minutes: '10' });
  assert.ok(said[3]!.text.startsWith(arrived), said[3]!.text);
  // The link to the transaction stays in Spanish.
  assert.equal(said[3]!.link, `/es/wallet/tx/${said[2]!.txid}`);
  assert.equal(await page.text('receive-arrived'), `Llegaron ${amount} sats de práctica a esta dirección.`);
  assert.equal(await page.text('new-address'), es.newAddress);
  // The next address, from the keyboard too.
  await page.page.focus('[data-testid="new-address"]');
  await page.page.keyboard.press('Enter');
  assert.equal(await page.text('receive-address'), deriveAddress(watchOnlyAccount(record.xpub), 0, 1).address);
  assert.equal(await page.text('receive-new'), es.newAddressShown);
  // The button stood under the address and is gone. What changed is brought on screen: the address
  // that has the focus, its QR code, and the line that says it is a new one.
  await untilOnScreen(page, '[data-testid="receive-address"]');
  await untilOnScreen(page, '[data-testid="receive-qr"]');
  await untilOnScreen(page, '[data-testid="receive-new"]');
  await snap(page, 'new-address-375-es');
  assert.equal(await page.text('faucet-ask'), es.faucetAsk);
  assert.equal(await page.waitForStatus('El faucet le envió'), `El faucet le envió ${pays(s, 'es')} a esta dirección.`);
  assert.equal(await page.waitForStatus('Llegaron'), `Llegaron ${amount} sats de práctica.`);

  // The widget: in Spanish, for the address on screen, compact on a phone.
  const [render] = renders(await page.turnstileCalls());
  assert.equal(render?.options?.language, 'es');
  assert.equal(render?.options?.action, 'faucet');
  assert.equal(render?.options?.cData, address);
  assert.equal(render?.options?.size, 'compact');
  // The event is filed under the Spanish screen.
  assert.deepEqual(await faucetEvents(s), ['/es/wallet/receive ok']);
  assert.equal(await page.sidewaysScroll(), 0);
});
