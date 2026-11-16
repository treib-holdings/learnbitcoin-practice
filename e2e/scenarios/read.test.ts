// The wallet's four looking screens in a real browser, against the real
// wallet engine and the stand-in practice network: the Overview, Coins,
// Activity and the screen of one transaction, in English and in Spanish.
//
// Looking needs no key. So the scenarios that only look also hold that no
// passkey prompt was opened and that nothing was counted but screen views.
//
// Most wallets here are made without a passkey: such a wallet can be put in
// the page's storage before the page starts. A passkey wallet cannot (the
// secret of a virtual password manager cannot be set from outside). The
// scenarios at the end of this file make one all the same: they put a
// passkey into the page's password manager themselves, and then use the
// app's own "Open with my passkey", which takes any practice passkey. That
// is also the one way to reach the Overview's list of causes for a wallet
// opened with no history, and its "Choose another passkey".

import assert from 'node:assert/strict';
import { accountFromMnemonic, deriveAddress, watchOnlyAccount } from '@learnbitcoin/practice-wallet';
import { RECORD_KEY } from '../../app/src/lib/keystore.ts';
import { FUNDED_COINS, OTHER_WORDS, freshRecord, fundTestWallet, scenario, testRecord, type OpenedPage, type Scenario } from './helpers.ts';

/** The test wallet's wallet fingerprint (the first BIP39 test phrase). */
const FINGERPRINT = '73c5da0a';

/** What the funded test wallet holds: 100,000 and 40,000 confirmed, 2,500 unconfirmed. */
const TOTAL = FUNDED_COINS.reduce((sum, coin) => sum + coin.sats, 0);

/** "142500" -> "142,500", as the app writes amounts in both languages. */
const sats = (amount: number): string => amount.toLocaleString('en-US');

/** The text of the screen's heading. */
const h1 = (page: OpenedPage): Promise<string> => page.page.$eval('h1', (heading) => (heading.textContent ?? '').trim());

/** The path in the address bar. */
const pathOf = (page: OpenedPage): string => new URL(page.page.url()).pathname;

/** Waits until the screen with this heading is showing: a link inside the app changes the screen without a page load. */
async function showing(page: OpenedPage, heading: string): Promise<void> {
  await page.page.waitForFunction((wanted) => document.querySelector('h1')?.textContent?.trim() === wanted, {}, heading);
}

/** Follows the first link to a path of the app, as a reader's click. */
async function follow(page: OpenedPage, path: string, heading: string): Promise<void> {
  await page.page.locator(`a[href="${path}"]`).click();
  await showing(page, heading);
  assert.equal(pathOf(page), path);
}

/** An attribute of the first element with this data-testid. */
const attribute = (page: OpenedPage, testid: string, name: string): Promise<string | null> =>
  page.page.$eval(`[data-testid="${testid}"]`, (element, attr) => element.getAttribute(attr), name);

/** Waits until the first element with this data-testid holds text that fits. */
async function textBecomes(page: OpenedPage, testid: string, wanted: RegExp): Promise<string> {
  await page.page.waitForFunction(
    (id, source) => new RegExp(source).test((document.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim()),
    {},
    testid,
    wanted.source,
  );
  return page.text(testid);
}

/** The headings of the screen, in page order: "H1 Overview", "H2 ...". */
const headings = (page: OpenedPage): Promise<string[]> =>
  page.page.$$eval('main h1, main h2, main h3, main h4', (all) => all.map((heading) => `${heading.tagName} ${(heading.textContent ?? '').replace(/\s+/g, ' ').trim()}`));

/** How many buttons in the screen's content carry these words. */
const buttons = (page: OpenedPage, words: string): Promise<number> =>
  page.page.$$eval('main button', (all, wanted) => all.filter((button) => (button.textContent ?? '').trim() === wanted).length, words);

/** The data-testid of what has the keyboard's focus, or its tag name where it has none. */
const focusOf = (page: OpenedPage): Promise<string> =>
  page.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? 'nothing');

/** Waits until the keyboard's focus is on the screen's heading. */
const focusOnHeading = (page: OpenedPage): Promise<unknown> =>
  page.page.waitForFunction(() => document.activeElement === document.querySelector('h1'));

/**
 * Collects, from now on, the text of everything that appears on the page
 * as an alert (role="alert"): what a screen reader reads out at once.
 */
async function collectAlerts(page: OpenedPage): Promise<() => Promise<string[]>> {
  await page.page.evaluate(() => {
    const heard: string[] = [];
    (window as unknown as { __readAlerts: string[] }).__readAlerts = heard;
    const note = (node: Node): void => {
      if (!(node instanceof Element)) return;
      const alerts = [...(node.matches('[role="alert"]') ? [node] : []), ...node.querySelectorAll('[role="alert"]')];
      for (const alert of alerts) heard.push((alert.textContent ?? '').replace(/\s+/g, ' ').trim());
    };
    new MutationObserver((changes) => {
      for (const change of changes) for (const node of change.addedNodes) note(node);
    }).observe(document.body, { subtree: true, childList: true });
  });
  return () => page.page.evaluate(() => (window as unknown as { __readAlerts: string[] }).__readAlerts);
}

/**
 * Counts the passkey prompts a page opens from its next load on: every call
 * of navigator.credentials.get() and create(). The count is kept here, so
 * it survives page loads.
 *
 * For a wallet made without a passkey the count says little: the wallet
 * itself opens no prompt for such a wallet, whatever a screen asks of it.
 * The scenario that walks the four screens with a locked passkey wallet,
 * near the end of this file, is the one in which a screen that asked for
 * keys would be caught.
 */
async function countPasskeyPrompts(page: OpenedPage): Promise<() => number> {
  let prompts = 0;
  await page.page.exposeFunction('__readScenarioPrompt', () => {
    prompts += 1;
  });
  await page.page.evaluateOnNewDocument(() => {
    const credentials = navigator.credentials as unknown as Record<string, (...args: unknown[]) => unknown> | undefined;
    if (!credentials) return;
    for (const name of ['get', 'create']) {
      const real = credentials[name]?.bind(credentials);
      if (!real) continue;
      credentials[name] = (...args: unknown[]) => {
        (window as unknown as { __readScenarioPrompt(): void }).__readScenarioPrompt();
        return real(...args);
      };
    }
  });
  return () => prompts;
}

/** Everything the app counted in this scenario, as "name path" (and its value, were there one). */
async function counted(s: Scenario, page: OpenedPage): Promise<string[]> {
  await page.settle();
  await s.stack.settled();
  return s.stack.events.map(({ event }) => [event.name, event.path, event.value].filter((part) => part !== undefined).join(' '));
}

scenario('a funded wallet shows its total and coins, and a block confirms what was unconfirmed', { localOnly: true }, async (s) => {
  const paid = fundTestWallet(s.standIn);
  // The wallet looks at the height every 15 seconds: a wait here may take that long.
  const page = await s.open('/wallet', { record: testRecord(), timeout: 30_000 });

  await page.waitFor('total');
  assert.equal(await h1(page), 'Overview');
  assert.equal(await page.text('total'), `${sats(TOTAL)} practice sats`);
  // The unconfirmed part is named.
  assert.equal(await page.text('total-unconfirmed'), 'Of that, still unconfirmed: 2,500 practice sats.');

  // Each coin: its amount, its address, a link to the transaction that made it, and "Unconfirmed" on the one that is.
  const coins = await page.texts('coin');
  assert.equal(coins.length, paid.length);
  for (const coin of paid) {
    const row = coins.find((text) => text.includes(coin.address));
    assert.ok(row, `the coin at receive address ${coin.index} is listed`);
    assert.ok(row.includes(`${sats(coin.sats)} practice sats`), row);
    assert.equal(row.includes('Unconfirmed'), !coin.confirmed, row);
    assert.equal(await page.page.$$eval(`[data-testid="coin"] a[href="/wallet/tx/${coin.txid}"]`, (links) => links.length), 1);
  }

  // The latest transactions, newest first: the unconfirmed one leads.
  await page.waitFor('tx-row');
  const rows = await page.texts('tx-row');
  assert.equal(rows.length, 3);
  assert.match(rows[0]!, /^Received \+2,500 practice sats Unconfirmed /);

  // A wallet made without a passkey: no lock line, no passkey to name, and its wallet fingerprint by its full name.
  assert.deepEqual(await page.texts('lock-state'), []);
  assert.deepEqual(await page.texts('passkey-tag'), []);
  assert.equal(await page.text('wallet-fingerprint'), FINGERPRINT);

  // A block: the unconfirmed coin is confirmed, and the status region says so.
  assert.deepEqual(page.statusLog(), []);
  await s.network.nextBlock();
  assert.equal(await page.waitForStatus('1 confirmation.'), '1 confirmation.');
  await page.waitForGone('total-unconfirmed');
  assert.equal(await page.text('total'), `${sats(TOTAL)} practice sats`);
  assert.ok((await page.texts('coin')).every((text) => !text.includes('Unconfirmed')));
  await textBecomes(page, 'tx-row', /^Received \+2,500 practice sats Confirmed /);

  // Said once, and nothing else was said: polling never announces the height.
  await page.settle(1000);
  assert.deepEqual(page.statusLog(), ['1 confirmation.']);
});

// The Worker's settings say 45 seconds between blocks here, not the 30 of a
// deploy: a sentence with the figure typed into it would show.
scenario('Overview, Coins, Activity and one transaction in turn, with no passkey prompt and nothing counted but screen views', { localOnly: true, stack: { vars: { BLOCK_SECONDS: '45' } } }, async (s) => {
  const paid = fundTestWallet(s.standIn);
  const waiting = paid.find((coin) => !coin.confirmed)!;
  // A fourth coin, on the wallet's fourth receive address: more than the Overview lists of either kind.
  const fourth = { index: 3, address: deriveAddress(watchOnlyAccount(testRecord().xpub), 0, 3).address, sats: 7_000 };
  const fourthTx = s.standIn.fund(fourth.address, fourth.sats, { confirmed: true });
  const { config } = s.stack;
  assert.equal(config.blockSeconds, 45);
  const page = await s.open('/wallet', { record: testRecord(), timeout: 30_000 });
  const prompts = await countPasskeyPrompts(page);
  // The copy button is pressed below, and what it copied is read back: writing needs no leave here, reading does.
  await page.context.overridePermissions(s.url, ['clipboard-read', 'clipboard-sanitized-write']);
  await page.goto('/wallet');

  // -- Overview: the total, the two actions, the first coins, the latest transactions --
  await page.waitFor('total');
  assert.equal(await page.text('total'), `${sats(TOTAL + fourth.sats)} practice sats`);
  assert.equal(await page.text('overview-receive'), 'Receive');
  assert.equal(await attribute(page, 'overview-receive', 'href'), '/wallet/receive');
  assert.equal(await page.text('overview-send'), 'Send');
  assert.equal(await attribute(page, 'overview-send', 'href'), '/wallet/send');
  // The first three of four coins, and the latest three of four transactions: the rest is one link away.
  const firstCoins = await page.texts('coin');
  assert.equal(firstCoins.length, 3);
  assert.ok(firstCoins.every((text) => !text.includes(fourth.address)), 'the fourth coin is not among the first few');
  await page.waitFor('tx-row');
  const latest = await page.texts('tx-row');
  assert.equal(latest.length, 3);
  // Newest first: the unconfirmed one, then the newest two that are in a block. The oldest is left out.
  assert.match(latest[0]!, /^Received \+2,500 practice sats Unconfirmed /);
  assert.match(latest[1]!, /^Received \+7,000 practice sats Confirmed /);
  assert.match(latest[2]!, /^Received \+40,000 practice sats Confirmed /);
  assert.equal(await attribute(page, 'all-coins', 'href'), '/wallet/coins');
  assert.equal(await attribute(page, 'all-activity', 'href'), '/wallet/activity');
  // Coins are there, so nothing says there are none.
  assert.deepEqual(await page.texts('no-coins'), []);
  assert.deepEqual(await page.texts('opened-empty'), []);

  // -- Coins: every coin, what the marks mean, what a coin is --
  await page.click('all-coins');
  await showing(page, 'Coins');
  assert.equal(pathOf(page), '/wallet/coins');
  assert.equal(await page.text('total'), `${sats(TOTAL + fourth.sats)} practice sats`);
  const coins = await page.texts('coin');
  // All four, where the Overview listed three.
  assert.deepEqual(
    coins.map((text) => text.split(' practice sats')[0]),
    [...FUNDED_COINS.map((coin) => sats(coin.sats)), sats(fourth.sats)],
  );
  for (const coin of [...paid, fourth]) assert.ok(coins[coin.index]!.includes(coin.address), `coin ${coin.index} names its address`);
  assert.equal(await page.page.$$eval(`[data-testid="coin"] a[href="/wallet/tx/${fourthTx}"]`, (links) => links.length), 1);
  assert.match(coins[waiting.index]!, /Unconfirmed/);
  // None of them is change: all four were received.
  assert.ok(coins.every((text) => !text.includes('Change')));
  assert.match(await page.text('coins-marks'), /^"Unconfirmed" marks a coin that is not in a block yet\. "Change" marks /);
  assert.equal(await attribute(page, 'coins-glossary', 'href'), `${config.siteUrl}/glossary/utxo-unspent-transaction-output`);
  assert.equal(await attribute(page, 'coins-glossary', 'target'), '_blank');

  // -- Activity: every transaction, newest first --
  await follow(page, '/wallet/activity', 'Activity');
  await page.waitFor('tx-row');
  const rows = await page.texts('tx-row');
  // All four, where the Overview listed three.
  assert.equal(rows.length, 4);
  assert.match(rows[0]!, /^Received \+2,500 practice sats Unconfirmed /);
  assert.match(rows[1]!, /^Received \+7,000 practice sats Confirmed /);
  assert.match(rows[2]!, /^Received \+40,000 practice sats Confirmed /);
  assert.match(rows[3]!, /^Received \+100,000 practice sats Confirmed /);
  assert.deepEqual(await page.texts('activity-empty'), []);
  assert.deepEqual(await page.texts('activity-failed'), []);

  // -- One transaction: the row leads to it --
  await follow(page, `/wallet/tx/${waiting.txid}`, 'Transaction');
  await page.waitFor('tx-summary');
  assert.equal(await page.text('tx-summary'), 'This wallet received 2,500 practice sats.');
  assert.equal(
    await page.text('tx-status'),
    `Unconfirmed: it is not in a block yet. On the practice network a block comes about every ${config.blockSeconds} seconds.`,
  );
  // What went in and what came out: this wallet's output is marked.
  assert.ok((await page.texts('tx-input')).length >= 1);
  const outputs = await page.texts('tx-output');
  const mine = outputs.filter((text) => text.includes('This wallet'));
  assert.equal(mine.length, 1);
  assert.ok(mine[0]!.startsWith('2,500 practice sats') && mine[0]!.includes(waiting.address), mine[0]);
  // A payment that was received owes no word about change.
  assert.deepEqual(await page.texts('tx-no-change'), []);
  // What it cost, and whether it can still be replaced.
  assert.match(await page.text('tx-fee'), /^Fee [\d,]+ practice sats?$/);
  assert.match(await page.text('tx-size'), /^Size [\d,]+ vB$/);
  assert.match(await page.text('tx-fee-rate'), /^Fee rate [\d,.]+ sat\/vB$/);
  assert.equal(await page.text('tx-replace'), 'Can still be replaced Yes, until it is in a block');
  await page.waitFor('tx-replace-note');
  // Its ID, which the button copies, and the same transaction on the practice explorer.
  assert.equal(await page.text('tx-id'), waiting.txid);
  await page.click('tx-copy');
  assert.equal(await page.waitForStatus('Transaction ID copied'), 'Transaction ID copied');
  assert.equal(await page.page.evaluate(() => navigator.clipboard.readText()), waiting.txid);
  assert.equal(await attribute(page, 'tx-explorer', 'href'), `${config.explorerUrl}/tx/${waiting.txid}`);
  assert.equal(await attribute(page, 'tx-explorer', 'target'), '_blank');

  // A block: the screen asks again by itself and shows the block.
  const height = await s.network.nextBlock();
  await page.waitForStatus('1 confirmation.');
  assert.match(await textBecomes(page, 'tx-status', /^Confirmed in block /), new RegExp(`^Confirmed in block ${sats(height)}, on [A-Z][a-z]+ \\d{1,2}, \\d{4}\\.$`));
  assert.equal(await page.text('tx-replace'), 'Can still be replaced No, it is in a block');
  assert.deepEqual(await page.texts('tx-replace-note'), []);

  // The way back.
  await page.click('tx-back');
  await showing(page, 'Activity');

  // Looking asked for no passkey, and only screen views were counted: no ID, no amount, nothing else.
  assert.equal(prompts(), 0);
  assert.deepEqual(await counted(s, page), [
    'pageview /wallet',
    'pageview /wallet',
    'pageview /wallet/coins',
    'pageview /wallet/activity',
    'pageview /wallet/tx',
    'pageview /wallet/activity',
  ]);
  // The wallet in storage is as it was put there.
  assert.equal(await page.stored(), JSON.stringify(testRecord()));
});

scenario('a wallet with no coins says so on each screen, and points to the faucet', async (s) => {
  // New words: no history on any network.
  const record = freshRecord();
  // On a real practice network the first look takes longer than on the stand-in.
  const page = await s.open('/wallet', { record, timeout: 30_000 });
  const prompts = await countPasskeyPrompts(page);
  await page.goto('/wallet');

  // The first look has finished and found nothing: now 0 is the truth.
  await page.waitFor('total');
  assert.equal(await page.text('total'), '0 practice sats');
  assert.deepEqual(await page.texts('total-unconfirmed'), []);
  assert.match(await page.text('no-coins'), /^No coins yet\. Get practice coins$/);
  // The way to coins leads to the faucet itself, a part of the Receive screen below the address.
  assert.equal(await page.page.$eval('[data-testid="no-coins"] a', (link) => link.getAttribute('href')), '/wallet/receive#faucet');
  assert.deepEqual(await page.texts('coin'), []);
  // Nothing to send, so Send is not offered here; the wallet's sections still lead to it.
  assert.deepEqual(await page.texts('overview-send'), []);
  await page.waitFor('activity-empty');
  assert.equal(await page.text('activity-empty'), 'No transactions yet. The first one shows here when coins arrive.');
  // The wallet was made without a passkey and was not "opened": no list of causes.
  assert.deepEqual(await page.texts('opened-empty'), []);
  assert.equal(await page.text('wallet-fingerprint'), record.fingerprint);

  // Coins: its own empty line.
  await follow(page, '/wallet/coins', 'Coins');
  assert.match(await page.text('coins-empty'), /^This wallet holds no coins\. One shows here as soon as a payment arrives\. Get practice coins$/);
  assert.deepEqual(await page.texts('total'), []);

  // Activity: its own empty line, in the look of the Coins screen's, with the way to the faucet inside it.
  await follow(page, '/wallet/activity', 'Activity');
  await page.waitFor('activity-empty');
  assert.match(await page.text('activity-empty'), /^No transactions yet\. The first one shows here when coins arrive\. Get practice coins$/);
  assert.equal(await attribute(page, 'activity-faucet', 'href'), '/wallet/receive#faucet');
  assert.equal(await page.page.$$eval('[data-testid="activity-empty"] [data-testid="activity-faucet"]', (inside) => inside.length), 1);
  assert.deepEqual(await page.texts('tx-row'), []);

  assert.equal(prompts(), 0);
  assert.deepEqual(await counted(s, page), ['pageview /wallet', 'pageview /wallet', 'pageview /wallet/coins', 'pageview /wallet/activity']);
});

scenario('the first look fails: no total, the cause, and "Try again" works once the network is back', { localOnly: true }, async (s) => {
  s.expectFault('origin_down');
  const paid = fundTestWallet(s.standIn);
  s.standIn.setOrigin('down');

  const page = await s.open('/wallet', { record: testRecord() });
  await page.waitFor('chain-failed');
  // The cause, and that the fault is ours. No total, and never a total of 0.
  assert.match(await page.text('chain-failed'), /^The practice network could not answer just now\. The fault is on our side\./);
  assert.deepEqual(await page.texts('total'), []);
  assert.deepEqual(await page.texts('coin'), []);
  assert.deepEqual(await page.texts('no-coins'), []);
  assert.deepEqual(await page.texts('activity-empty'), []);
  assert.doesNotMatch(await page.page.$eval('main', (main) => main.textContent ?? ''), /\b0 practice sats/);
  // Which wallet this is does not depend on the network.
  assert.equal(await page.text('wallet-fingerprint'), FINGERPRINT);

  // The transaction's screen in the same state: the frame speaks, and the screen claims nothing.
  const tx = await s.open(`/wallet/tx/${paid[0]!.txid}`, { record: testRecord() });
  await tx.waitFor('chain-failed');
  for (const hook of ['tx-summary', 'tx-not-found', 'tx-failed', 'tx-waiting']) assert.deepEqual(await tx.texts(hook), [], hook);

  // The network is back: "Try again" finds the coins.
  s.standIn.setOrigin('ok');
  await page.page.locator('[data-testid="chain-failed"] button').click();
  await page.waitFor('total');
  assert.equal(await page.text('total'), `${sats(TOTAL)} practice sats`);
  await page.waitForGone('chain-failed');
  assert.equal((await page.texts('coin')).length, 3);

  await tx.page.locator('[data-testid="chain-failed"] button').click();
  await tx.waitFor('tx-summary');
  assert.equal(await tx.text('tx-summary'), 'This wallet received 100,000 practice sats.');
});

scenario('a later look fails: the last values stay, with when they were last checked', { localOnly: true }, async (s) => {
  s.expectFault('origin_down');
  fundTestWallet(s.standIn);
  // The wallet looks at the height every 15 seconds: the failure shows at the next look.
  const page = await s.open('/wallet', { record: testRecord(), timeout: 40_000 });
  await page.waitFor('total');
  await page.waitFor('tx-row');
  await page.settle();

  s.standIn.setOrigin('down');
  await page.waitFor('chain-stale');
  assert.match(await page.text('chain-stale'), /^The practice network could not answer just now\. The fault is on our side\./);
  assert.match(await page.text('chain-stale'), /What is shown here is from the last check that worked, (just now|\d+ seconds ago)\./);
  // Everything that was known is still shown.
  assert.equal(await page.text('total'), `${sats(TOTAL)} practice sats`);
  assert.equal(await page.text('total-unconfirmed'), 'Of that, still unconfirmed: 2,500 practice sats.');
  assert.equal((await page.texts('coin')).length, 3);
  assert.equal((await page.texts('tx-row')).length, 3);

  // And it stays on the other screens.
  await follow(page, '/wallet/coins', 'Coins');
  await page.waitFor('chain-stale');
  assert.equal((await page.texts('coin')).length, 3);

  s.standIn.setOrigin('ok');
  await page.page.locator('[data-testid="chain-stale"] button').click();
  await page.waitForGone('chain-stale');
  assert.equal(await page.text('total'), `${sats(TOTAL)} practice sats`);
});

scenario('the list of transactions cannot be read: the cause shows, and "Try again" is answered only once the list has been read', { localOnly: true }, async (s) => {
  fundTestWallet(s.standIn);
  // Coins shows no transactions, so the list has not been read yet.
  const page = await s.open('/wallet/coins', { record: testRecord() });
  await page.waitFor('coin');
  await page.settle();

  // From here the Worker refuses every chain read: this reader is asking too fast.
  s.stack.over.add('chain');
  await follow(page, '/wallet/activity', 'Activity');
  await page.waitFor('activity-failed');
  // The cause, and what the page does about it. A reader refused for asking too fast is not told to ask again now.
  assert.match(await page.text('activity-failed'), /^You are asking the practice network faster than it allows\. This page tries again by itself\. Try again$/);
  // It was there as the screen opened: not read out.
  assert.equal(await page.page.$$eval('[data-testid="activity-failed"] [role="alert"]', (alerts) => alerts.length), 0);
  assert.deepEqual(await page.texts('tx-row'), []);
  assert.deepEqual(await page.texts('activity-empty'), []);

  // The Worker lets reads through again, and the reader tries again.
  s.stack.over.delete('chain');
  const alerts = await collectAlerts(page);
  await page.click('activity-retry');
  await page.waitFor('tx-row');
  await page.waitForGone('activity-failed');
  assert.equal((await page.texts('tx-row')).length, 3);
  // The try worked. So nothing was read out on the way: the coins are read before the list is, and at
  // that moment the old failure still stands. Read out then, it would tell of a failure that is over.
  assert.deepEqual(await alerts(), []);
  // The button that was pressed is gone with the notice: focus went to the heading, not to nowhere.
  await focusOnHeading(page);
});

scenario('the reader tries again while the network still refuses: the frame says why, the list says what is shown, and it is read out', { localOnly: true }, async (s) => {
  fundTestWallet(s.standIn);
  const page = await s.open('/wallet/coins', { record: testRecord() });
  await page.waitFor('coin');
  await page.settle();

  s.stack.over.add('chain');
  await follow(page, '/wallet/activity', 'Activity');
  await page.waitFor('activity-failed');
  const alerts = await collectAlerts(page);
  await page.click('activity-retry');

  // The try reads the coins first, and that fails now. So the frame shows the cause, with its own
  // "Try again", and the list's own notice makes way for it: one cause and one button.
  await page.waitFor('chain-stale');
  await page.waitForGone('activity-failed');
  assert.match(await page.text('chain-stale'), /^You are asking the practice network faster than it allows\./);
  assert.equal(await buttons(page, 'Try again'), 1);
  // What is left for the list to say is read out, because it answers the reader's own try.
  await page.page.waitForSelector('[data-testid="activity-stale"][role="alert"]');
  assert.equal(await page.text('activity-stale'), 'The list of transactions has not been read yet.');
  assert.deepEqual(await alerts(), ['The list of transactions has not been read yet.']);
  // The button that was pressed is gone: focus is on the heading.
  await focusOnHeading(page);

  // The frame's button reads the list too.
  s.stack.over.delete('chain');
  await page.page.locator('[data-testid="chain-stale"] button').click();
  await page.waitFor('tx-row');
  await page.waitForGone('chain-stale');
  assert.deepEqual(await page.texts('activity-stale'), []);
  assert.equal((await page.texts('tx-row')).length, 3);
});

scenario('the practice network cannot be read at all: one cause and one "Try again", on Activity and on the Overview', { localOnly: true }, async (s) => {
  s.expectFault('origin_down');
  fundTestWallet(s.standIn);
  // The wallet looks at the height every 15 seconds: the failure of the coins shows at the next look.
  const page = await s.open('/wallet/coins', { record: testRecord(), timeout: 40_000 });
  await page.waitFor('coin');
  await page.settle();

  s.standIn.setOrigin('down');
  await follow(page, '/wallet/activity', 'Activity');
  // First the list alone could not be read. Then the wallet finds that the coins cannot be read either,
  // and the frame says so: from then on the list repeats neither the cause nor the button.
  await page.waitFor('chain-stale');
  await page.waitForGone('activity-failed');
  const cause = 'The practice network could not answer just now.';
  const said = (text: string): number => text.split(cause).length - 1;
  assert.equal(said(await page.page.$eval('main', (main) => main.textContent ?? '')), 1);
  assert.equal(await buttons(page, 'Try again'), 1);
  assert.equal(await page.text('activity-stale'), 'The list of transactions has not been read yet.');
  // It came by itself, so it is not read out.
  assert.equal(await page.page.$$eval('main [role="alert"]', (alerts) => alerts.length), 0);

  // The Overview in the same state: the coins as they were last read, and the same single cause.
  await follow(page, '/wallet', 'Overview');
  await page.waitFor('chain-stale');
  assert.equal(said(await page.page.$eval('main', (main) => main.textContent ?? '')), 1);
  assert.equal(await buttons(page, 'Try again'), 1);
  assert.deepEqual(await page.texts('activity-failed'), []);
  assert.equal(await page.text('activity-stale'), 'The list of transactions has not been read yet.');
  assert.equal((await page.texts('coin')).length, 3);

  // The network is back, and the frame's one button reads the coins and the list.
  s.standIn.setOrigin('ok');
  await page.page.locator('[data-testid="chain-stale"] button').click();
  await page.waitFor('tx-row');
  await page.waitForGone('chain-stale');
  assert.deepEqual(await page.texts('activity-stale'), []);
  assert.equal((await page.texts('tx-row')).length, 3);
});

scenario('a transaction the network does not list yet: the screen says so, and shows it once it is listed', { localOnly: true }, async (s) => {
  const paid = fundTestWallet(s.standIn);
  // From now on the stand-in's Esplora hears of a new payment ten minutes late, or at the next block.
  s.standIn.setEsploraLag(600);
  const next = s.standIn.fund(testRecord().firstAddress, 7_000, { confirmed: false });
  assert.ok(!paid.some((coin) => coin.txid === next));

  // This page was not handed the ID by the faucet or by a payment of its own, so to it the
  // transaction is simply not listed. (Handed the ID, the wallet says "waiting": that needs
  // the Receive or the Send screen, and is a scenario for the joined app.)
  const page = await s.open(`/wallet/tx/${next}`, { record: testRecord(), timeout: 30_000 });
  await page.waitFor('tx-not-found');
  assert.match(await page.text('tx-not-found'), /^The practice network lists no transaction with this ID\. One sent a moment ago can take a few seconds to show, so try again\./);
  assert.equal(await page.text('tx-id'), next);
  assert.deepEqual(await page.texts('tx-summary'), []);

  // "Try again" asks again: still not listed, and the cause is said again.
  await page.click('tx-retry');
  await page.page.waitForSelector('[data-testid="tx-not-found"] [role="alert"]');
  assert.equal(await h1(page), 'Transaction');

  // A block: the network lists it, the wallet's coins change, and the screen asks again by itself.
  const height = await s.network.nextBlock();
  await page.waitFor('tx-summary');
  assert.equal(await page.text('tx-summary'), 'This wallet received 7,000 practice sats.');
  assert.match(await page.text('tx-status'), new RegExp(`^Confirmed in block ${sats(height)}, on `));
  assert.deepEqual(await page.texts('tx-not-found'), []);
  // "Try again" had the keyboard's focus and is gone with the notice: focus went to the heading, not to nowhere.
  await page.page.waitForFunction(() => document.activeElement === document.querySelector('h1'));
  // The coins that arrived were announced by the wallet's frame, once.
  assert.deepEqual(
    page.statusLog().filter((said) => said.includes('arrived')),
    ['7,000 practice sats arrived.'],
  );
});

scenario('an unknown transaction ID says so and gives the way back; a path that holds no ID is no screen', async (s) => {
  const unknown = 'ab'.repeat(32);
  const page = await s.open(`/wallet/tx/${unknown}`, { record: freshRecord(), timeout: 30_000 });
  await page.waitFor('tx-not-found');
  assert.equal(await h1(page), 'Transaction');
  assert.match(await page.text('tx-not-found'), /^The practice network lists no transaction with this ID\. .+ Try again See all activity$/);
  assert.equal(await page.text('tx-id'), unknown);
  // There when the screen opened, so not read out as an alert.
  assert.equal(await page.page.$$eval('[data-testid="tx-not-found"] [role="alert"]', (alerts) => alerts.length), 0);

  // The way back.
  await page.click('tx-back');
  await showing(page, 'Activity');
  assert.equal(pathOf(page), '/wallet/activity');

  // 63 characters are no transaction ID: the router answers, not this screen.
  const short = await s.open(`/wallet/tx/${unknown.slice(1)}`, { record: freshRecord() });
  assert.equal(await h1(short), 'Page not found');
  assert.deepEqual(await short.texts('tx-not-found'), []);
});

/**
 * The links of the screen that leave the app whose arrow does not stand on
 * the line of the link's last word: there must be none. Each is given by
 * its text.
 */
const loneArrows = (page: OpenedPage): Promise<string[]> =>
  page.page.evaluate(() =>
    [...document.querySelectorAll('main a[target="_blank"]')]
      .filter((link) => {
        const mark = link.querySelector('span[aria-hidden]');
        const arrow = link.querySelector('svg')?.getBoundingClientRect();
        if (!mark || !arrow) return false;
        // The link's own words: everything in it before the arrow.
        const words = document.createRange();
        words.setStart(link, 0);
        words.setEndBefore(mark);
        const lines = [...words.getClientRects()];
        const last = lines[lines.length - 1];
        return last === undefined || arrow.top < last.top - 2 || arrow.top > last.bottom;
      })
      .map((link) => link.textContent ?? ''),
  );

scenario('on a phone 320 px wide, in both languages: no screen is wider than the phone, and no link loses its arrow', { localOnly: true }, async (s) => {
  const paid = fundTestWallet(s.standIn);
  const waiting = paid.find((coin) => !coin.confirmed)!;
  for (const lang of ['en', 'es'] as const) {
    const prefix = lang === 'es' ? '/es' : '';
    const page = await s.open(`${prefix}/wallet`, { record: testRecord(), width: 320, lang });
    await page.waitFor('total');
    await page.waitFor('tx-row');
    assert.equal(await page.sidewaysScroll(), 0, `${lang}: the Overview`);

    await page.click('all-coins');
    await page.waitFor('coins-marks');
    assert.equal(await page.sidewaysScroll(), 0, `${lang}: Coins`);
    assert.deepEqual(await loneArrows(page), [], `${lang}: Coins`);

    await page.page.locator(`a[href="${prefix}/wallet/activity"]`).click();
    await page.waitFor('tx-row');
    assert.equal(await page.sidewaysScroll(), 0, `${lang}: Activity`);

    await page.page.locator(`a[href="${prefix}/wallet/tx/${waiting.txid}"]`).click();
    await page.waitFor('tx-replace-glossary');
    assert.equal(await page.sidewaysScroll(), 0, `${lang}: one transaction`);
    // Six links leave the app from here. Under "What just happened", the glossary's entries for what the
    // sentences name: the coin, the change, the fee, and the waiting room of a payment that is not in a
    // block yet. Then the glossary's entry on replacing a payment, and the explorer.
    assert.equal(await page.page.$$eval('[data-testid="tx-explained-glossary"] a[target="_blank"]', (links) => links.length), 4);
    assert.equal(await page.page.$$eval('main a[target="_blank"]', (links) => links.length), 6);
    assert.deepEqual(await loneArrows(page), [], `${lang}: one transaction`);

    await page.goto(`${prefix}/wallet/tx/${'ef'.repeat(32)}`);
    await page.waitFor('tx-not-found');
    assert.equal(await page.sidewaysScroll(), 0, `${lang}: a transaction that is not listed`);
    // The two ways on stand one under the other, at one width.
    const widths = await page.page.$$eval('[data-testid="tx-retry"], [data-testid="tx-back"]', (buttons) =>
      buttons.map((button) => Math.round(button.getBoundingClientRect().width)),
    );
    assert.equal(widths.length, 2);
    assert.equal(widths[0], widths[1], `${lang}: ${widths.join(' and ')}`);
  }
});

// 45 seconds between blocks here too, so that the Spanish sentence is held to the setting as well.
scenario('the Spanish routes: the same four screens under /es, in Spanish', { localOnly: true, stack: { vars: { BLOCK_SECONDS: '45' } } }, async (s) => {
  const paid = fundTestWallet(s.standIn);
  const waiting = paid.find((coin) => !coin.confirmed)!;
  const { config } = s.stack;
  assert.equal(config.blockSeconds, 45);
  const page = await s.open('/es/wallet', { record: testRecord(), lang: 'es' });
  const prompts = await countPasskeyPrompts(page);
  await page.goto('/es/wallet');

  await page.waitFor('total');
  assert.equal(await page.page.evaluate(() => document.documentElement.lang), 'es');
  assert.equal(await h1(page), 'Resumen');
  assert.equal(await page.text('total'), `${sats(TOTAL)} sats de práctica`);
  assert.equal(await page.text('total-unconfirmed'), 'De ese total, todavía sin confirmar: 2,500 sats de práctica.');
  assert.equal(await page.text('overview-receive'), 'Recibir');
  assert.equal(await attribute(page, 'overview-receive', 'href'), '/es/wallet/receive');
  assert.equal(await page.text('overview-send'), 'Enviar');
  assert.equal(await page.text('wallet-fingerprint'), FINGERPRINT);

  // Every link stays in Spanish.
  await page.click('all-coins');
  await showing(page, 'Monedas');
  assert.equal(pathOf(page), '/es/wallet/coins');
  const coins = await page.texts('coin');
  assert.equal(coins.length, 3);
  assert.match(coins[waiting.index]!, /^2,500 sats de práctica Sin confirmar /);
  assert.match(await page.text('coins-marks'), /^"Sin confirmar" marca una moneda que todavía no está en un bloque\. "Cambio" marca /);
  // The glossary entry in Spanish, on the main site's Spanish side.
  assert.equal(await attribute(page, 'coins-glossary', 'href'), `${config.siteUrl}/es/glosario/utxo`);

  await follow(page, '/es/wallet/activity', 'Actividad');
  await page.waitFor('tx-row');
  const rows = await page.texts('tx-row');
  assert.equal(rows.length, 3);
  assert.match(rows[0]!, /^Recibido \+2,500 sats de práctica Sin confirmar /);

  await follow(page, `/es/wallet/tx/${waiting.txid}`, 'Transacción');
  await page.waitFor('tx-summary');
  assert.equal(await page.text('tx-summary'), 'Esta billetera recibió 2,500 sats de práctica.');
  assert.equal(
    await page.text('tx-status'),
    `Sin confirmar: todavía no está en un bloque. En la red de práctica llega un bloque más o menos cada ${config.blockSeconds} segundos.`,
  );
  assert.equal(await page.text('tx-replace'), 'Todavía se puede reemplazar Sí, hasta que entre en un bloque');
  assert.equal(await page.text('tx-id'), waiting.txid);
  // The link's own words, then what a screen reader is told about it.
  assert.match(await page.text('tx-explorer'), /^Verla en el explorador de práctica \(se abre en otra pestaña\)$/);
  assert.equal(await attribute(page, 'tx-back', 'href'), '/es/wallet/activity');

  // An unknown ID, in Spanish.
  await page.goto(`/es/wallet/tx/${'cd'.repeat(32)}`);
  await page.waitFor('tx-not-found');
  assert.match(await page.text('tx-not-found'), /^La red de práctica no muestra ninguna transacción con este txid\./);

  assert.equal(prompts(), 0);
  assert.deepEqual(await counted(s, page), [
    'pageview /es/wallet',
    'pageview /es/wallet',
    'pageview /es/wallet/coins',
    'pageview /es/wallet/activity',
    'pageview /es/wallet/tx',
    'pageview /es/wallet/tx',
  ]);
});

scenario("another wallet's transaction: the screen says whose it is not, and follows it into a block though nothing in this wallet changes", { localOnly: true }, async (s) => {
  // Every coin of this wallet is confirmed, so the next block changes neither its coins nor its list.
  s.standIn.fund(testRecord().firstAddress, 60_000, { confirmed: true });
  // Somebody else's payment, still waiting for a block. This wallet's list will never hold it.
  const elsewhere = deriveAddress(watchOnlyAccount(accountFromMnemonic(OTHER_WORDS).xpub), 0, 0).address;
  const theirs = s.standIn.fund(elsewhere, 9_000, { confirmed: false });

  // The wallet looks at the height every 15 seconds: a wait here may take that long.
  const page = await s.open(`/wallet/tx/${theirs}`, { record: testRecord(), timeout: 40_000 });
  await page.waitFor('tx-summary');
  assert.equal(await page.text('tx-summary'), 'This transaction does not touch this wallet.');
  assert.match(await page.text('tx-status'), /^Unconfirmed: it is not in a block yet\./);
  assert.equal(await page.text('tx-replace'), 'Can still be replaced Yes, until it is in a block');

  // A block takes it. Only the height tells this page: the screen looks again when the height has moved.
  const height = await s.network.nextBlock();
  assert.match(await textBecomes(page, 'tx-status', /^Confirmed in block /), new RegExp(`^Confirmed in block ${sats(height)}, on `));
  assert.equal(await page.text('tx-replace'), 'Can still be replaced No, it is in a block');
  assert.deepEqual(await page.texts('tx-replace-note'), []);
  assert.equal(await page.text('tx-summary'), 'This transaction does not touch this wallet.');
  // Nothing of this wallet's changed, so nothing was announced.
  await page.settle(500);
  assert.deepEqual(page.statusLog(), []);
});

/**
 * On how many lines the words of `unit` stand inside the first element
 * with this data-testid: 1 when the unit is whole, 2 when a line breaks
 * inside it, 0 when it is not there.
 */
const unitLines = (page: OpenedPage, testid: string, unit: string): Promise<number> =>
  page.page.evaluate(
    (id, words) => {
      const root = document.querySelector(`[data-testid="${id}"]`);
      if (!root) return 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const at = (node.nodeValue ?? '').indexOf(words);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + words.length);
        return new Set([...range.getClientRects()].map((box) => Math.round(box.top))).size;
      }
      return 0;
    },
    testid,
    unit,
  );

scenario('the unit of an amount never breaks in two in the sentence that sums a transaction up, at any phone width', { localOnly: true }, async (s) => {
  const paid = fundTestWallet(s.standIn);
  // The size of a faucet payment: the amount a first transaction most often shows.
  const faucetSized = paid.find((coin) => coin.sats === 100_000)!;
  for (const [lang, unit] of [
    ['en', 'practice sats'],
    ['es', 'sats de práctica'],
  ] as const) {
    const page = await s.open(`${lang === 'es' ? '/es' : ''}/wallet/tx/${faucetSized.txid}`, { record: testRecord(), width: 320, lang });
    await page.waitFor('tx-summary');
    assert.match(await page.text('tx-summary'), new RegExp(`100,000 ${unit}\\.$`), lang);
    for (let width = 320; width <= 430; width += 5) {
      await page.page.setViewport({ width, height: 800 });
      assert.equal(await unitLines(page, 'tx-summary', unit), 1, `${lang} at ${width} px: "${await page.text('tx-summary')}"`);
    }
    assert.equal(await page.sidewaysScroll(), 0, lang);
  }
});

// -- wallets made with a passkey, on the real engine --------------------------------------

/** What the app stores for a passkey wallet, as far as these scenarios read it. */
interface StoredWallet {
  kind: string;
  fingerprint: string;
  xpub: string;
  firstAddress: string;
  credentialId: string;
  tag: string;
}

const storedWallet = async (page: OpenedPage): Promise<StoredWallet> => JSON.parse((await page.stored()) ?? 'null') as StoredWallet;

/**
 * Puts a passkey into the page's password manager (the virtual one the
 * page was opened with) from the scenario itself, not through the app: one
 * that the password manager keeps, that verifies the reader and that gives
 * the secret a wallet is made from. To "Open with my passkey" it is a
 * practice passkey like any other. Gives its ID as the app stores it.
 */
async function makePasskey(page: OpenedPage, seed: number): Promise<string> {
  // Chrome makes a passkey only for the page that is in front.
  await page.page.bringToFront();
  // 16 bytes, as the app's own passkeys have: the tag in a passkey's name is worked out from them.
  const userId = Array.from({ length: 16 }, (_, at) => (seed * 37 + at * 11 + 5) % 256);
  const made = await page.page.evaluate(async (bytes: number[]) => {
    try {
      const credential = await navigator.credentials.create({
        publicKey: {
          rp: { id: location.hostname, name: 'Practice wallet scenario' },
          user: { id: new Uint8Array(bytes), name: 'scenario', displayName: 'scenario' },
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
          attestation: 'none',
          extensions: { prf: {} },
        } as PublicKeyCredentialCreationOptions,
      });
      return { id: credential?.id ?? '', error: '' };
    } catch (error) {
      return { id: '', error: String(error) };
    }
  }, userId);
  assert.equal(made.error, '', 'the scenario made a passkey');
  assert.notEqual(made.id, '');
  return made.id;
}

/**
 * A page on the Overview of a wallet that "Open with my passkey" has just
 * opened and that has no history: the list of causes is showing, and the
 * wallet is unlocked. `record` is what the app stored for it.
 */
async function openEmpty(s: Scenario, options: { lang?: 'en' | 'es'; width?: number } = {}): Promise<{ page: OpenedPage; record: StoredWallet; stored: string; passkeyId: string }> {
  const prefix = options.lang === 'es' ? '/es' : '';
  const page = await s.open(`${prefix}/wallet`, { passkey: 'prf', lang: options.lang, width: options.width, timeout: 40_000 });
  const passkeyId = await makePasskey(page, 1);
  await page.click('open-passkey');
  await page.waitFor('opened-empty');
  const stored = (await page.stored()) ?? '';
  return { page, record: JSON.parse(stored) as StoredWallet, stored, passkeyId };
}

const UNLOCKED = /^Unlocked in this tab until you lock it, reload or close the tab\. ?Lock$/;
const LOCKED = 'Looking and receiving need no passkey. Sending and showing the 12 words do.';

/** The three causes, under one heading, in the order of SPEC section 6. Nothing else has a heading of its own in between. */
const CAUSES = [
  'H1 Overview',
  'H2 This passkey opened a wallet with no history',
  'H3 It is a new wallet with no coins yet',
  'H3 You chose a different practice passkey',
  'H3 The same passkey gave a different wallet',
];

scenario('a passkey opens a wallet with no history: the causes show, and choosing another passkey changes nothing by itself', { localOnly: true }, async (s) => {
  const { page, record, stored, passkeyId } = await openEmpty(s);
  assert.deepEqual(await headings(page), CAUSES);
  assert.equal(record.kind, 'passkey');
  // Which wallet this is stands where the causes speak of it, once each: the tag in the passkey's name, and the wallet fingerprint.
  assert.deepEqual(await page.texts('passkey-tag'), [record.tag]);
  assert.deepEqual(await page.texts('wallet-fingerprint'), [record.fingerprint]);
  assert.equal(await attribute(page, 'opened-faucet', 'href'), '/wallet/receive#faucet');
  // Open leaves the keys loaded (SPEC section 4).
  assert.match(await page.text('lock-state'), UNLOCKED);
  assert.deepEqual(await page.texts('total'), ['0 practice sats']);

  // "Choose another passkey", and the only passkey there is answers: the same wallet.
  const uses = async (): Promise<number> => (await page.passkey!.credentials()).find((credential) => credential.id === passkeyId)!.uses;
  const before = await uses();
  await page.click('opened-choose');
  await page.waitFor('opened-same');
  assert.match(await page.text('opened-same'), /^That is the same passkey as before, so it opened the same wallet\./);
  assert.equal(await uses(), before + 1);
  // The button that was pressed is still there, and still has the focus.
  assert.equal(await focusOf(page), 'opened-choose');

  // Then the reader closes the prompt (from here on this password manager refuses every one).
  await page.passkey!.refuse();
  await page.click('opened-choose');
  await page.waitFor('opened-problem');
  assert.equal(await page.text('opened-problem'), 'The passkey prompt was closed or ran out of time, so nothing was changed. Try again when you are ready.');
  // The answer before it is gone: one answer at a time, above the one button.
  assert.deepEqual(await page.texts('opened-same'), []);
  assert.equal(await buttons(page, 'Choose another passkey'), 1);
  assert.equal(await focusOf(page), 'opened-choose');

  // "Nothing was changed" is true. The wallet is as unlocked as it was, nothing said it was locked,
  // no unlock step has appeared, the causes stand as they stood, and the record is the one Open stored.
  assert.match(await page.text('lock-state'), UNLOCKED);
  assert.ok(!page.statusLog().includes('Wallet locked.'), page.statusLog().join(' | '));
  for (const hook of ['unlock-step', 'unlock', 'unlock-picker', 'unlock-words', 'switch-question']) assert.deepEqual(await page.texts(hook), [], hook);
  assert.deepEqual(await headings(page), CAUSES);
  assert.equal(await page.stored(), stored);
  assert.equal(await page.page.$eval('main', (main) => main.getAttribute('aria-busy')), null);

  // One prompt was counted for each try, and nothing else beside the screen view.
  assert.deepEqual(await counted(s, page), ['pageview /wallet', 'Unlock /wallet opened-empty', 'Unlock /wallet same', 'Unlock /wallet cancelled']);

  // The first coin ends the explaining: a wallet that holds a coin is shown, not explained away.
  s.standIn.fund(record.firstAddress, 50_000, { confirmed: true });
  await page.waitFor('coin');
  await page.waitForGone('opened-empty');
  assert.equal(await page.text('total'), '50,000 practice sats');
  // Its two names moved to the foot of the screen, still once each.
  assert.deepEqual(await page.texts('passkey-tag'), [record.tag]);
  assert.deepEqual(await page.texts('wallet-fingerprint'), [record.fingerprint]);
});

scenario('another passkey answers: the reader is asked, "Keep" changes nothing, and "Switch" makes this browser hold that wallet', { localOnly: true }, async (s) => {
  const { page, record, stored, passkeyId } = await openEmpty(s, { width: 320 });
  const second = await makePasskey(page, 2);
  // A password manager that holds both hands over the one this browser knows. The reader picks the
  // other one: here, by its being the only one this device still has.
  await page.passkey!.remove(passkeyId);

  await page.click('opened-choose');
  await page.waitFor('switch-question');
  // The question has the focus, so that it is read out.
  assert.equal(await focusOf(page), 'switch-question');
  assert.equal(await page.text('switch-question'), 'That passkey belongs to a different practice wallet, not the one in this browser. Nothing has changed yet.');
  // And nothing has: the record, the lock, and the causes with this wallet's own two names. The
  // other passkey's name and wallet fingerprint are shown in the question, without those hooks.
  assert.equal(await page.stored(), stored);
  assert.match(await page.text('lock-state'), UNLOCKED);
  assert.ok(!page.statusLog().includes('Wallet locked.'), page.statusLog().join(' | '));
  assert.deepEqual(await page.texts('passkey-tag'), [record.tag]);
  assert.deepEqual(await page.texts('wallet-fingerprint'), [record.fingerprint]);
  // The question opens no heading of its own, and no unlock step: the third cause still hangs under the list's heading.
  assert.deepEqual(await headings(page), CAUSES);
  assert.deepEqual(await page.texts('unlock-step'), []);
  // While it is asked, the way to ask again is not offered beside it.
  assert.deepEqual(await page.texts('opened-choose'), []);
  // On a phone the two answers stand one under the other, at one width, and nothing is wider than the phone.
  const widths = await page.page.$$eval('[data-testid="switch-confirm"], [data-testid="switch-cancel"]', (both) => both.map((button) => Math.round(button.getBoundingClientRect().width)));
  assert.equal(widths.length, 2);
  assert.equal(widths[0], widths[1], widths.join(' and '));
  assert.equal(await page.sidewaysScroll(), 0);

  // "Keep this wallet": the question goes, and nothing has changed.
  await page.click('switch-cancel');
  await page.waitForGone('switch-question');
  assert.equal(await focusOf(page), 'opened-choose');
  assert.equal(await page.stored(), stored);
  assert.match(await page.text('lock-state'), UNLOCKED);

  // Asked again, the reader says yes, and the browser will not store the change (as a full or a blocked storage will not).
  await page.click('opened-choose');
  await page.waitFor('switch-question');
  await page.page.evaluate(() => {
    const kept = window as unknown as { __readSetItem: typeof Storage.prototype.setItem };
    kept.__readSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  });
  await page.click('switch-confirm');
  await page.waitFor('opened-problem');
  assert.equal(await page.text('opened-problem'), 'This browser refused to store the change, so nothing was switched. The wallet that was here is still here.');
  // Nothing was, and the question still stands, with the button that was pressed: the reader can say yes again, or keep this wallet.
  assert.equal(await page.stored(), stored);
  assert.equal((await page.texts('switch-question')).length, 1);
  assert.equal(await focusOf(page), 'switch-confirm');
  assert.deepEqual(await page.texts('unlock-note'), []);

  // The storage takes the change now, and the reader says yes once more.
  await page.page.evaluate(() => {
    Storage.prototype.setItem = (window as unknown as { __readSetItem: typeof Storage.prototype.setItem }).__readSetItem;
  });
  await page.click('switch-confirm');
  await page.waitFor('unlock-note');
  assert.match(await page.text('unlock-note'), /^This browser now holds a different practice wallet, the one named below\./);
  await focusOnHeading(page);
  // This browser's wallet is the second passkey's now, unlocked, and its coins are looked up.
  const now = await storedWallet(page);
  assert.equal(now.credentialId, second);
  assert.notEqual(now.fingerprint, record.fingerprint);
  await page.waitFor('total');
  assert.match(await page.text('lock-state'), UNLOCKED);
  // It was switched to, not "just opened": the plain empty line, not the causes.
  await page.waitFor('no-coins');
  assert.deepEqual(await page.texts('opened-empty'), []);
  assert.deepEqual(await page.texts('passkey-tag'), [now.tag]);
  assert.deepEqual(await page.texts('wallet-fingerprint'), [now.fingerprint]);
  // The practice network was asked about the new wallet only after the reader said yes.
  assert.ok(s.standIn.requests().some((request) => request.path.includes(now.firstAddress)));
  assert.deepEqual(await counted(s, page), [
    'pageview /wallet',
    'Unlock /wallet opened-empty',
    'Unlock /wallet other-passkey',
    'Unlock /wallet other-passkey',
  ]);
});

scenario('what this browser saved was altered behind the page: "Choose another passkey" still says that it was wrong and has been replaced', { localOnly: true }, async (s) => {
  const { page, record } = await openEmpty(s);
  // The wallet fingerprint alone is changed. The passkey still gives the stored public key, so the
  // record was altered, not replaced: "tampered" (SPEC section 6).
  await page.store(RECORD_KEY, JSON.stringify({ ...record, fingerprint: record.fingerprint === '00000000' ? '11111111' : '00000000' }));
  const scans = (): number => s.standIn.requests().filter((request) => request.path.endsWith(`/address/${record.firstAddress}`)).length;
  const before = scans();

  // The wallet reads the storage again before it opens the prompt, and takes the list of causes off
  // the screen. The answer comes after that, and must not be lost with the list.
  await page.click('opened-choose');
  await page.waitFor('unlock-note');
  assert.match(await page.text('unlock-note'), /^The details this browser had saved about this wallet were wrong, and they have been replaced with the ones your keys give\./);
  // Read out, and the focus is on the heading, not on nothing.
  assert.equal(await page.page.$$eval('[data-testid="unlock-note"][role="alert"]', (alerts) => alerts.length), 1);
  await focusOnHeading(page);
  // The record was written again from the keys, and the coins are looked up again from nothing.
  assert.equal((await storedWallet(page)).fingerprint, record.fingerprint);
  await page.waitFor('total');
  assert.ok(scans() > before, 'the wallet was scanned again');
  assert.match(await page.text('lock-state'), UNLOCKED);
  assert.ok((await counted(s, page)).includes('Unlock /wallet tampered'));
});

scenario("what this browser saved was replaced by another wallet's behind the page: nothing is opened, and the warning shows", { localOnly: true }, async (s) => {
  // The wallet whose details will be put in the record's place holds coins: its Overview has something to show.
  fundTestWallet(s.standIn);
  const { page, record } = await openEmpty(s);
  const other = testRecord();
  // Another wallet's public key, wallet fingerprint and first address under this passkey's ID. The
  // passkey now fits neither: "changed" (SPEC section 6): never opened, never overwritten, warned.
  const replaced = JSON.stringify({ ...record, fingerprint: other.fingerprint, xpub: other.xpub, firstAddress: other.firstAddress });
  await page.store(RECORD_KEY, replaced);

  await page.click('opened-choose');
  await page.waitFor('unlock-changed-warning');
  assert.equal(await page.text('unlock-changed-warning'), 'Until this is settled, do not have coins sent to an address shown here.');
  assert.match(await page.text('opened-problem'), /^This passkey did not give the wallet this browser has saved\. .+ Nothing was opened and nothing was changed\. /);
  // Read out, and the focus is on the heading, not on nothing.
  assert.equal(await page.page.$$eval('[data-testid="opened-problem"][role="alert"]', (alerts) => alerts.length), 1);
  await focusOnHeading(page);
  // Nothing was opened, and nothing was overwritten.
  assert.equal(await page.text('lock-state'), LOCKED);
  assert.equal(await page.stored(), replaced);
  // The warning stands above the wallet it is about, and stays there when that wallet's coins have been read.
  await page.waitFor('total');
  assert.equal(await page.text('total'), `${sats(TOTAL)} practice sats`);
  assert.equal((await page.texts('coin')).length, 3);
  assert.deepEqual(await page.texts('opened-empty'), []);
  assert.equal((await page.texts('unlock-changed-warning')).length, 1);
  assert.equal(await page.page.$eval('[data-testid="opened-problem"] a', (link) => link.getAttribute('href')), '/wallet/settings');
  assert.ok((await counted(s, page)).includes('Unlock /wallet changed'));
});

scenario('a passkey wallet, locked after a page load: the four screens show it and ask for no passkey', { localOnly: true }, async (s) => {
  const { page, record, passkeyId } = await openEmpty(s);
  const confirmed = s.standIn.fund(record.firstAddress, 50_000, { confirmed: true });
  const waiting = s.standIn.fund(record.firstAddress, 7_000, { confirmed: false });

  // A page load locks a passkey wallet. From here on every passkey prompt is counted.
  const prompts = await countPasskeyPrompts(page);
  const uses = async (): Promise<number> => (await page.passkey!.credentials()).find((credential) => credential.id === passkeyId)!.uses;
  const before = await uses();
  await page.goto('/wallet');
  await page.waitFor('total');
  assert.equal(await page.text('total'), '57,000 practice sats');
  assert.equal(await page.text('lock-state'), LOCKED);
  // It has coins, so nothing is explained away, and its two names stand at the foot, once each.
  assert.deepEqual(await page.texts('opened-empty'), []);
  assert.deepEqual(await page.texts('passkey-tag'), [record.tag]);
  assert.deepEqual(await page.texts('wallet-fingerprint'), [record.fingerprint]);
  await page.waitFor('tx-row');

  await page.click('all-coins');
  await showing(page, 'Coins');
  assert.equal((await page.texts('coin')).length, 2);
  assert.equal(await page.text('lock-state'), LOCKED);

  await follow(page, '/wallet/activity', 'Activity');
  await page.waitFor('tx-row');
  assert.equal((await page.texts('tx-row')).length, 2);
  assert.equal(await page.text('lock-state'), LOCKED);

  await follow(page, `/wallet/tx/${waiting}`, 'Transaction');
  await page.waitFor('tx-summary');
  assert.equal(await page.text('tx-summary'), 'This wallet received 7,000 practice sats.');
  assert.equal(await page.text('lock-state'), LOCKED);

  // And a page loaded straight on a transaction's screen.
  await page.goto(`/wallet/tx/${confirmed}`);
  await page.waitFor('tx-summary');
  assert.equal(await page.text('tx-summary'), 'This wallet received 50,000 practice sats.');
  assert.equal(await page.text('lock-state'), LOCKED);

  // Looking asked for nothing: no prompt was opened, and the passkey answered none.
  assert.equal(prompts(), 0);
  assert.equal(await uses(), before);
  for (const hook of ['unlock-step', 'unlock']) assert.deepEqual(await page.texts(hook), [], hook);
});

scenario('in Spanish, the first thing on the Overview to name the passkey says "(passkey)" beside the Spanish word, and nothing says it twice', { localOnly: true }, async (s) => {
  const { page, record } = await openEmpty(s, { lang: 'es' });
  /** The words from the first "llave de acceso" on, and how often the screen's content says "(passkey)". */
  const mentions = (): Promise<{ first: string; glosses: number }> =>
    page.page.$eval('main', (main) => {
      const text = (main as HTMLElement).innerText;
      const at = text.indexOf('llave de acceso');
      return { first: at < 0 ? '' : text.slice(at, at + 'llave de acceso (passkey)'.length), glosses: text.split('(passkey)').length - 1 };
    });

  // Just opened, so unlocked: the frame's line does not name the passkey, and the lead of the causes is the first to.
  assert.match(await page.text('lock-state'), /^Desbloqueada en esta pestaña/);
  assert.deepEqual(await mentions(), { first: 'llave de acceso (passkey)', glosses: 1 });

  // With a coin, and still unlocked: the label at the foot is the first, and the only one.
  s.standIn.fund(record.firstAddress, 50_000, { confirmed: true });
  await page.waitFor('coin');
  await page.waitForGone('opened-empty');
  assert.match(await page.text('lock-state'), /^Desbloqueada en esta pestaña/);
  assert.deepEqual(await mentions(), { first: 'llave de acceso (passkey)', glosses: 1 });
  assert.deepEqual(await page.texts('passkey-tag'), [record.tag]);

  // After a page load it is locked, and the frame's own line is the first to name it: the label does not repeat the gloss.
  await page.goto('/es/wallet');
  await page.waitFor('total');
  assert.match(await page.text('lock-state'), /llave de acceso \(passkey\)/);
  assert.deepEqual(await mentions(), { first: 'llave de acceso (passkey)', glosses: 1 });
});
