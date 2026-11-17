// The Send screen (/wallet/send) against the real wallet engine, the Worker's
// real handler and the stand-in practice network: the form, the plan, the
// review of the signed payment, the broadcast and the sent view.
//
// A payment needs coins, and only the stand-in hands them out without the
// faucet's bot check: every scenario but one pays the wallet from the
// stand-in first, and is local only. In most of them the wallet is one made
// without a passkey, put in the page's storage before the page starts: its
// keys load with no prompt, so the unlock step never shows. The passkey
// path (plan, unlock step, one prompt, review) has a scenario of its own.
// A stored passkey wallet cannot be prepared and the Create screen is not
// built in this tree, so that scenario makes the passkey by hand, with the
// options the app's own create() uses, and brings the wallet in through
// the gate's "Open with my passkey".
//
// "Send it" is switched off for the review's first moment (REVIEW_SETTLE_MS).
// page.click() waits for a button that is switched on, so a scenario needs
// no wait of its own before it. One that presses keys or taps at a spot
// calls armed() first.

import assert from 'node:assert/strict';
import { Esplora, accountFromMnemonic, scanWallet, signPayment } from '@learnbitcoin/practice-wallet';
import { strings } from '../../app/src/strings/index.ts';
import { fill, formatSats } from '../../app/src/lib/format.ts';
import { REVIEW_SETTLE_MS } from '../../app/src/screens/send/flow.ts';
import {
  OTHER_WORDS,
  TEST_WORDS,
  freshRecord,
  fundTestWallet,
  scenario,
  testRecord,
  type OpenedPage,
  type Scenario,
} from './helpers.ts';

const en = strings.send.en;
const es = strings.send.es;
const errors = strings.errors.en;

/** An address that is neither the wallet's nor the pot's: the first address of the harness's second wallet. */
const SOMEBODY = testRecord(OTHER_WORDS).firstAddress;
/** The example key of BIP173, as testnet and as Bitcoin's real network write its address, and as the practice network does. */
const TB1 = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const BC1 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TB1_AS_PRACTICE = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

const hook = (id: string): string => `[data-testid="${id}"]`;
const tidy = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** The text of one element, found by a CSS selector, once it is there. */
async function textOf(page: OpenedPage, selector: string): Promise<string> {
  const node = await page.page.waitForSelector(selector, { timeout: 10_000 });
  return tidy(await node!.evaluate((found) => found.textContent));
}

/** The value of a row of facts (its name left out): "30,000 practice sats". `scope` is the step the row is in. */
const row = (page: OpenedPage, scope: string, name: string): Promise<string> => textOf(page, `${scope} ${hook(name)} dd`);

/** What a field holds. */
const held = (page: OpenedPage, id: string): Promise<string> =>
  page.page.$eval(hook(id), (input) => (input as HTMLInputElement).value);

/** The lines a field is described by (its hint, its error and what stands under it), as a screen reader is given them. */
const described = (page: OpenedPage, id: string): Promise<string> =>
  page.page.$eval(hook(id), (input) =>
    (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter((each) => each !== '')
      .map((each) => document.getElementById(each)?.textContent ?? `(no element ${each})`)
      .join(' | ')
      .replace(/\s+/g, ' ')
      .trim(),
  );

/**
 * The sentence of a boxed message: its own paragraphs (the cause, then the
 * way out), without what stands under them.
 */
const notice = (page: OpenedPage, id: string): Promise<string> =>
  page.page.$eval(hook(id), (box) =>
    [...box.querySelectorAll(':scope > p')]
      .map((each) => (each.textContent ?? '').replace(/\s+/g, ' ').trim())
      .join(' '),
  );

/** For a scenario that pays the wallet from the stand-in first: local from its first line. */
const LOCAL = { localOnly: true };

/** How many elements with this test hook are on the page. */
const count = async (page: OpenedPage, id: string): Promise<number> => (await page.texts(id)).length;

/** Waits until `check` holds. */
async function until(check: () => boolean | Promise<boolean>, what: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`not within ${ms} ms: ${what}`);
    await new Promise((wake) => setTimeout(wake, 25));
  }
}

/** The heading of the step that is showing, once focus has moved to it. */
async function headingInFocus(page: OpenedPage): Promise<string> {
  await page.page.waitForFunction(() => document.activeElement?.tagName === 'H1', { timeout: 10_000 });
  return textOf(page, 'main h1');
}

/** Whether a button is switched off. */
const off = (page: OpenedPage, id: string): Promise<boolean> =>
  page.page.$eval(hook(id), (button) => (button as HTMLButtonElement).disabled);

/** Waits until "Send it" takes a tap: it is switched off for the review's first moment. */
async function armed(page: OpenedPage): Promise<void> {
  await page.page.waitForFunction(
    (selector) => {
      const button = document.querySelector<HTMLButtonElement>(selector);
      return button !== null && !button.disabled;
    },
    { timeout: 10_000 },
    hook('send-broadcast'),
  );
}

/** A real tap at the middle of an element, wherever it stands: the mouse goes there, and whatever is at that spot takes it. */
async function tapAt(page: OpenedPage, id: string): Promise<void> {
  const element = (await page.page.waitForSelector(hook(id), { timeout: 10_000 }))!;
  await element.evaluate((found) => found.scrollIntoView({ block: 'center' }));
  const box = (await element.boundingBox())!;
  await page.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const sleep = (ms: number): Promise<void> => new Promise((wake) => setTimeout(wake, ms));

/** What stands in focus: its test hook, or else its tag. */
const focused = (page: OpenedPage): Promise<string> =>
  page.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? '');

/** The very payment the page signs for this request: the same words, coins and request give the same transaction. */
async function sameAsThePage(s: Scenario, request: { to: string; amount: bigint; feeRate: bigint }) {
  const esplora = new Esplora(`${s.stack.originUrl}/esplora`);
  const account = accountFromMnemonic(TEST_WORDS);
  const payment = signPayment(account.key, await scanWallet(account.key, esplora), request);
  return { payment, hand: () => esplora.broadcast(payment.hex) };
}

/** The seven figures of a payment, as the plan shows them (rows "plan-...") and as the review does (rows "review-..."). */
async function figures(page: OpenedPage, step: 'send-plan' | 'send-review') {
  const scope = hook(step);
  const own = step === 'send-plan' ? 'plan' : 'review';
  return {
    to: await textOf(page, `${scope} ${hook(`${own}-to`)} dd [translate="no"]`),
    amount: await row(page, scope, `${own}-amount`),
    fee: await row(page, scope, 'tx-fee'),
    size: await row(page, scope, 'tx-size'),
    rate: await row(page, scope, 'tx-fee-rate'),
    total: await row(page, scope, `${own}-total`),
    change: await row(page, scope, `${own}-change`),
  };
}

/** "30,000 practice sats" as a number of sats. */
const satsIn = (text: string): number => Number(text.replace(/ .*$/, '').replaceAll(',', ''));

interface NetworkTx {
  txid: string;
  fee: number;
  weight: number;
  vin: { prevout: { value: number; scriptpubkey_address: string } }[];
  vout: { value: number; scriptpubkey_address: string }[];
  status: { confirmed: boolean };
}

/** A transaction as the practice network itself reports it: asked directly, not through the Worker. */
async function onNetwork(s: Scenario, txid: string): Promise<NetworkTx> {
  const answer = await fetch(`${s.stack.originUrl}/esplora/tx/${txid}`);
  assert.equal(answer.status, 200, `the network does not know ${txid}`);
  return (await answer.json()) as NetworkTx;
}

/** The pot's address, asked of the bots directly. */
async function potOnNetwork(s: Scenario): Promise<string> {
  const answer = await fetch(`${s.stack.originUrl}/bots/pot/address`, { headers: { Authorization: `Bearer ${s.standIn.token}` } });
  return ((await answer.json()) as { address: string }).address;
}

/** The payments the network was handed: every POST of a transaction that reached the stand-in. */
const broadcasts = (s: Scenario): number =>
  s.standIn.requests().filter((request) => request.method === 'POST' && request.path === '/esplora/tx').length;

/** What was counted about payments, in order. */
const counted = (s: Scenario): (string | undefined)[] =>
  s.stack.events.map((recorded) => recorded.event).filter((event) => event.name === 'Payment').map((event) => event.value);

/** The transaction ID the sent view links to. */
async function sentTxid(page: OpenedPage, prefix = ''): Promise<string> {
  await page.waitFor('sent-link');
  const href = await page.page.$eval(hook('sent-link'), (link) => link.getAttribute('href') ?? '');
  assert.match(href, new RegExp(`^${prefix}/wallet/tx/[0-9a-f]{64}$`));
  return href.slice(-64);
}

/** Opens the Send screen of the funded test wallet (100,000 and 40,000 sats confirmed, 2,500 still unconfirmed). */
async function openFunded(s: Scenario, options: { lang?: 'es'; width?: number; timeout?: number } = {}): Promise<OpenedPage> {
  fundTestWallet(s.standIn);
  const path = options.lang === 'es' ? '/es/wallet/send' : '/wallet/send';
  const page = await s.open(path, {
    record: testRecord(),
    lang: options.lang ?? 'en',
    ...(options.width === undefined ? {} : { width: options.width }),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
  });
  await page.waitFor('send-spendable');
  return page;
}

scenario('a payment to the pot: the plan, the signed review and the transaction itself carry the same numbers', LOCAL, async (s) => {
  const page = await openFunded(s, { timeout: 30_000 });

  // What can be spent, and what cannot yet, each by its name.
  assert.equal(await row(page, 'main', 'send-spendable'), '140,000 practice sats');
  assert.equal(await row(page, 'main', 'send-waiting'), '2,500 practice sats');
  assert.equal(await count(page, 'send-plan'), 0);

  // "Pass it on" asks the wallet for a pot address and fills it in. A screen reader is told: focus stays on the button.
  await page.click('pass-it-on');
  await page.waitFor('send-to-pot');
  await page.waitForStatus(en.potFilled);
  assert.equal(await focused(page), 'pass-it-on');
  const pot = await held(page, 'send-to');
  assert.equal(pot, await potOnNetwork(s));
  assert.equal(await page.text('send-to-pot'), en.toPot);

  // The plan shows as soon as the three fields are good, and no key was asked for.
  await page.fill('send-amount', '30,000');
  await page.waitFor('send-plan');
  const plan = await figures(page, 'send-plan');
  assert.deepEqual(plan, {
    to: pot,
    amount: '30,000 practice sats',
    fee: '282 practice sats',
    size: '141 vB',
    rate: '2 sat/vB',
    total: '30,282 practice sats',
    change: '69,718 practice sats',
  });
  assert.ok((await row(page, hook('send-plan'), 'plan-to')).endsWith(en.toPot));
  // The amount and the fee together, named as that: the sum does not always leave the wallet.
  assert.equal(await textOf(page, `${hook('send-plan')} ${hook('plan-total')} dt`), 'Amount and fee together');
  // Not an address of this wallet, so nothing says it is.
  assert.equal(await count(page, 'send-to-own'), 0);
  assert.equal(await count(page, 'plan-to-own'), 0);
  // The coin it will spend: the faucet-sized one, alone.
  const coins = await page.page.$$eval(`${hook('send-plan')} ${hook('coin')}`, (rows) => rows.map((each) => each.textContent ?? ''));
  assert.equal(coins.length, 1);
  assert.match(coins[0] ?? '', /100,000/);
  assert.match(await page.text('send-all-would'), /^Send all would deliver 139,[0-9]{3} practice sats to this address at this fee rate\.$/);

  // Continue: a wallet made without a passkey never sees the unlock step. Signed, and nothing sent.
  await page.click('send-continue');
  await page.waitFor('send-review');
  assert.equal(await headingInFocus(page), 'Signed, not sent yet');
  assert.equal(await count(page, 'unlock-step'), 0);
  assert.equal(broadcasts(s), 0);
  assert.deepEqual(await s.network.coins(pot), { count: 0, sats: 0 });

  // The review is the payment as signed, and its figures are the plan's.
  const review = await figures(page, 'send-review');
  assert.deepEqual(review, plan);
  // It says to compare the whole address, and the whole address stands under the sentence: every character
  // of the one in the To field, with none left out and nothing put in its place.
  assert.ok((await page.text('send-review')).includes(en.reviewCheck), en.reviewCheck);
  assert.equal(await textOf(page, `${hook('send-review')} ${hook('review-to')} dd [translate="no"]`), pot);
  assert.ok((await page.text('send-review')).indexOf(en.reviewCheck) < (await page.text('send-review')).indexOf(pot));
  const inputs = await page.texts('tx-input');
  const outputs = await page.texts('tx-output');
  assert.equal(inputs.length, 1);
  assert.match(inputs[0] ?? '', /^100,000 practice sats/);
  assert.equal(outputs.length, 2);
  assert.ok(outputs.some((text) => text.startsWith('30,000 practice sats') && text.includes(pot)));
  assert.ok(outputs.some((text) => text.startsWith('69,718 practice sats') && text.includes(strings.wallet.en.txChange)));
  assert.equal(await count(page, 'tx-no-change'), 0);

  // Send it.
  await page.click('send-broadcast');
  const txid = await sentTxid(page);
  assert.equal(await headingInFocus(page), 'Payment sent');
  await page.waitForStatus('Payment sent.');
  assert.equal(await page.text('sent-pot'), en.sentPot);
  assert.match(await page.text('send-sent'), new RegExp(`about every ${s.stack.config.blockSeconds} seconds`));

  // The transaction's own numbers, from the network itself.
  const tx = await onNetwork(s, txid);
  assert.equal(tx.fee, satsIn(plan.fee));
  assert.equal(`${Math.ceil(tx.weight / 4)} vB`, plan.size);
  assert.deepEqual(tx.vin.map((input) => input.prevout.value), [100_000]);
  assert.deepEqual(
    tx.vout.map((output) => output.value).sort((a, b) => a - b),
    [satsIn(plan.amount), satsIn(plan.change)],
  );
  assert.equal(tx.vout.find((output) => output.scriptpubkey_address === pot)?.value, 30_000);
  assert.equal(tx.vin[0]!.prevout.value - satsIn(plan.change), satsIn(plan.total));
  assert.deepEqual(await s.network.coins(pot), { count: 1, sats: 30_000 });
  assert.equal(tx.status.confirmed, false);

  // Counted once, as passed on, on the Send screen's path.
  await until(() => counted(s).length > 0, 'the payment is counted');
  assert.deepEqual(counted(s), ['sent-to-pot']);
  assert.equal(broadcasts(s), 1);
  assert.deepEqual(page.statusLog().filter((said) => said.includes('Payment sent')), ['Payment sent.']);

  // "Send another": the coins have followed at once. The change is the wallet's own, so it can be spent unconfirmed.
  await page.click('send-another');
  assert.equal(await headingInFocus(page), 'Send');
  assert.equal(await held(page, 'send-to'), '');
  assert.equal(await held(page, 'send-amount'), '');
  assert.equal(await row(page, 'main', 'send-spendable'), '109,718 practice sats');
  assert.equal(await row(page, 'main', 'send-waiting'), '2,500 practice sats');

  // After a block the payment is confirmed, and so is the coin somebody else had sent: nothing waits any more.
  await s.network.nextBlock();
  assert.equal((await onNetwork(s, txid)).status.confirmed, true);
  await page.waitForGone('send-waiting');
  assert.equal(await row(page, 'main', 'send-spendable'), '112,218 practice sats');
});

scenario('a payment to an ordinary address, made with the keyboard alone', LOCAL, async (s) => {
  const page = await openFunded(s);
  const keys = page.page.keyboard;

  await page.page.focus(hook('send-to'));
  await keys.type(SOMEBODY);
  await keys.press('Tab');
  assert.equal(await focused(page), 'pass-it-on');
  await keys.press('Tab');
  assert.equal(await focused(page), 'send-amount');
  await keys.type('5,000');
  await keys.press('Tab');
  assert.equal(await focused(page), 'send-all');
  await keys.press('Tab');
  assert.equal(await focused(page), 'send-fee');
  assert.equal(await held(page, 'send-fee'), '2');
  await page.waitFor('send-plan');
  assert.equal(await row(page, hook('send-plan'), 'plan-to'), SOMEBODY);

  // Nothing in the plan takes a tap or the Tab key: a link there would leave the screen, and the way back
  // finds the form empty. So "Continue" comes straight after the fee rate.
  assert.equal((await page.page.$$(`${hook('send-plan')} a, ${hook('send-plan')} button`)).length, 0);
  assert.equal((await page.page.$$(`${hook('send-plan')} ${hook('coin')}`)).length, 1);
  await keys.press('Tab');
  assert.equal(await focused(page), 'send-continue');
  await keys.press('Enter');
  assert.equal(await headingInFocus(page), 'Signed, not sent yet');
  assert.equal(await row(page, hook('send-review'), 'review-amount'), '5,000 practice sats');
  // The address that was typed stands whole in the review, under the sentence that says to compare it.
  assert.equal(await row(page, hook('send-review'), 'review-to'), SOMEBODY);
  assert.ok((await page.text('send-review')).includes(en.reviewCheck), en.reviewCheck);

  // From the heading, the first thing the Tab key reaches is "Send it", once the review's first moment is over.
  await armed(page);
  await keys.press('Tab');
  assert.equal(await focused(page), 'send-broadcast');
  await keys.press('Enter');
  const txid = await sentTxid(page);
  assert.equal(await headingInFocus(page), 'Payment sent');
  await keys.press('Tab');
  assert.equal(await focused(page), 'sent-link');
  assert.equal(await count(page, 'sent-pot'), 0);

  assert.equal((await onNetwork(s, txid)).vout.find((output) => output.scriptpubkey_address === SOMEBODY)?.value, 5_000);
  assert.deepEqual(await s.network.coins(SOMEBODY), { count: 1, sats: 5_000 });
  await until(() => counted(s).length > 0, 'the payment is counted');
  assert.deepEqual(counted(s), ['sent']);
});

scenario('send all: every spendable coin goes in, no change comes back, and nothing is left to spend', LOCAL, async (s) => {
  const page = await openFunded(s);
  await page.fill('send-to', SOMEBODY);
  await page.fill('send-amount', '1,000');
  await page.waitFor('send-plan');

  await page.click('send-all');
  await page.waitFor('send-all-arrives');
  // The amount field is set aside, not emptied, and the plan is now for everything.
  assert.equal(await page.page.$eval(hook('send-amount'), (input) => (input as HTMLInputElement).disabled), true);
  const plan = await figures(page, 'send-plan');
  assert.equal(plan.total, '140,000 practice sats');
  assert.equal(plan.change, en.planNoChange);
  assert.equal(satsIn(plan.amount) + satsIn(plan.fee), 140_000);
  assert.equal(plan.rate, '2 sat/vB');
  assert.equal(await page.text('plan-no-change'), en.noChangeAll);
  assert.equal(await page.text('send-all-arrives'), `${plan.amount} would arrive.`);
  // The plan is the figure: no second line about what "Send all" would deliver.
  assert.equal(await count(page, 'send-all-would'), 0);
  assert.equal((await page.page.$$(`${hook('send-plan')} ${hook('coin')}`)).length, 2);

  await page.click('send-continue');
  await page.waitFor('send-review');
  assert.deepEqual(await figures(page, 'send-review'), plan);
  assert.equal((await page.texts('tx-input')).length, 2);
  assert.equal((await page.texts('tx-output')).length, 1);
  // Why there is no change, said exactly: the reader chose "Send all".
  assert.equal(await page.text('tx-no-change'), en.noChangeAll);

  await page.click('send-broadcast');
  const txid = await sentTxid(page);
  const tx = await onNetwork(s, txid);
  assert.deepEqual(tx.vout.map((output) => [output.scriptpubkey_address, output.value]), [[SOMEBODY, satsIn(plan.amount)]]);
  assert.equal(tx.fee, satsIn(plan.fee));
  assert.equal(`${Math.ceil(tx.weight / 4)} vB`, plan.size);

  // Nothing is left to spend: only the coin that is still unconfirmed, which the payment could not touch.
  await page.click('send-another');
  await page.waitFor('send-spendable');
  assert.equal(await row(page, 'main', 'send-spendable'), '0 practice sats');
  assert.equal(await row(page, 'main', 'send-waiting'), '2,500 practice sats');
  for (const coin of fundedAddresses()) {
    assert.deepEqual(await s.network.coins(coin.address), coin.confirmed ? { count: 0, sats: 0 } : { count: 1, sats: 2_500 });
  }
  // With nothing spendable the planner says so, in its own words.
  await page.fill('send-to', SOMEBODY);
  await page.fill('send-amount', '1,000');
  await page.waitFor('send-plan-refused');
  assert.equal(await notice(page, 'send-plan-refused'), errors['plan_unconfirmed-only']);
  assert.equal(await count(page, 'send-continue'), 0);
});

/** The test wallet's first three receive addresses, as fundTestWallet pays them. */
function fundedAddresses(): { address: string; confirmed: boolean }[] {
  const found: { address: string; confirmed: boolean }[] = [];
  // A stand-in that only records what it is asked to pay.
  fundTestWallet({ fund: (address, _sats, options) => (found.push({ address, confirmed: options?.confirmed !== false }), '') });
  return found;
}

scenario('the form checks its own fields, and a plan the wallet cannot make shows the planner\'s sentence', LOCAL, async (s) => {
  const page = await openFunded(s);
  await page.fill('send-to', SOMEBODY);

  // Below the dust limit: 293 sats are refused, 294 are planned.
  await page.fill('send-amount', '293');
  await page.waitFor('send-plan-refused');
  assert.equal(await notice(page, 'send-plan-refused'), errors['plan_below-dust']);
  assert.equal(await page.page.$eval(hook('send-amount'), (input) => input.getAttribute('aria-invalid')), 'true');
  assert.match(await described(page, 'send-amount'), /That amount is too small for the network to carry\./);
  assert.equal(await count(page, 'send-continue'), 0);
  await page.fill('send-amount', '294');
  await page.waitFor('send-continue');
  assert.equal(await row(page, hook('send-plan'), 'plan-amount'), '294 practice sats');
  assert.equal(await page.page.$eval(hook('send-amount'), (input) => input.getAttribute('aria-invalid')), null);

  // More than the wallet can send: the sentence, what "Send all" would deliver, and the amount left as typed.
  await page.fill('send-amount', '150,000');
  await page.waitFor('send-plan-refused');
  assert.equal(await notice(page, 'send-plan-refused'), errors['plan_too-much']);
  const would = await page.text('send-all-would');
  assert.match(would, /^Send all would deliver 139,[0-9]{3} practice sats to this address at this fee rate\.$/);
  assert.equal(await held(page, 'send-amount'), '150,000');
  // The figure is exact: that amount is planned with no change, and one sat more is not.
  const most = would.match(/139,[0-9]{3}/)![0];
  await page.fill('send-amount', most);
  await page.waitFor('send-continue');
  assert.equal(await row(page, hook('send-plan'), 'plan-change'), en.planNoChange);
  assert.equal(await page.text('plan-no-change'), en.noChangeLeftover);
  await page.fill('send-amount', String(satsIn(most) + 1));
  await page.waitFor('send-plan-refused');
  assert.equal(await notice(page, 'send-plan-refused'), errors['plan_too-much']);

  // A period in the amount: refused with the reason, and no plan is asked for.
  await page.fill('send-amount', '0.5');
  assert.ok((await described(page, 'send-amount')).includes(en.amountPeriod));
  assert.equal(await count(page, 'send-plan'), 0);
  assert.equal(await page.text('send-plan-waiting'), en.planWaiting);
  await page.fill('send-amount', 'lots');
  assert.ok((await described(page, 'send-amount')).includes(en.amountInvalid));
  await page.fill('send-amount', '5,000');
  await page.waitFor('send-continue');

  // The fee rate: whole numbers from 1 to 1,000, checked by the form itself.
  await page.fill('send-fee', '0');
  assert.match(await described(page, 'send-fee'), /That fee rate is below 1 sat\/vB, the lowest this wallet takes\. Use a fee rate of 1 or more\./);
  assert.equal(await count(page, 'send-plan'), 0);
  await page.fill('send-fee', '1,001');
  assert.match(await described(page, 'send-fee'), /That fee rate is above 1,000 sat\/vB, the highest this wallet takes\. Use a fee rate of 1,000 or less\./);
  assert.equal(await count(page, 'send-plan'), 0);
  await page.fill('send-fee', '1.5');
  assert.match(await described(page, 'send-fee'), /A fee rate here is a whole number from 1 to 1,000 sat\/vB\. Type digits only\./);
  for (const rate of ['1', '100']) {
    await page.fill('send-fee', rate);
    await page.waitFor('send-continue');
    assert.equal(await row(page, hook('send-plan'), 'tx-fee-rate'), `${rate} sat/vB`);
    assert.equal(await page.page.$eval(hook('send-fee'), (input) => input.getAttribute('aria-invalid')), null);
  }
  // 1,000 is taken by the form. This wallet cannot pay a fee that size, and it is the planner that says so.
  await page.fill('send-fee', '1,000');
  await page.waitFor('send-plan-refused');
  assert.equal(await notice(page, 'send-plan-refused'), errors['plan_too-much']);
  assert.equal(await page.page.$eval(hook('send-fee'), (input) => input.getAttribute('aria-invalid')), null);
  // No text about the fee rate says that the network refuses a lower one.
  assert.doesNotMatch(await textOf(page, 'main'), /network (refuses|rejects|does not (accept|take))/i);

  // Nothing here reached the network: a plan costs no request, and nothing was signed or sent.
  assert.equal(broadcasts(s), 0);
  assert.deepEqual(counted(s), []);
});

scenario('addresses of other networks: tb1 is offered in its practice spelling, bc1 is refused, and a payment link fills the form', LOCAL, async (s) => {
  const page = await openFunded(s);
  await page.fill('send-amount', '5,000');

  // tb1: the same address as another test network writes it. Explained, and offered with one button.
  await page.fill('send-to', TB1);
  await page.waitFor('send-use-practice');
  assert.ok((await described(page, 'send-to')).includes(en.toOtherNet));
  assert.equal(await page.text('send-to-practice'), TB1_AS_PRACTICE);
  assert.equal(await count(page, 'send-plan'), 0);
  await page.click('send-use-practice');
  await page.waitFor('send-plan');
  assert.equal(await held(page, 'send-to'), TB1_AS_PRACTICE);
  assert.equal(await row(page, hook('send-plan'), 'plan-to'), TB1_AS_PRACTICE);
  // The button is gone with the offer: focus is in the field it filled.
  await until(() => page.page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'send-to'), 'focus is in the field');

  // bc1: an address of Bitcoin's real network is refused, with the two sentences.
  await page.fill('send-to', BC1);
  await page.waitFor('send-to-sparrow');
  const refusal = await described(page, 'send-to');
  assert.ok(refusal.includes("This is an address on Bitcoin's real network. Practice coins cannot be sent there."), refusal);
  assert.ok(
    refusal.includes("If they start bc1, Sparrow is on Bitcoin's real network. Delete that wallet in Sparrow and never send bitcoin to it."),
    refusal,
  );
  assert.equal(
    await page.text('send-to-sparrow'),
    "If they start bc1, Sparrow is on Bitcoin's real network. Delete that wallet in Sparrow and never send bitcoin to it.",
  );
  assert.equal(await page.page.$eval(hook('send-to'), (input) => input.getAttribute('aria-invalid')), 'true');
  assert.equal(await count(page, 'send-plan'), 0);
  assert.equal(await count(page, 'send-continue'), 0);

  // Anything else is not an address.
  await page.fill('send-to', `${SOMEBODY}q`);
  assert.match(await described(page, 'send-to'), /That is not an address this wallet can pay\. Practice addresses start with bcrt1\./);
  assert.equal(await count(page, 'send-plan'), 0);

  // A payment link fills the amount as it is typed, and gives way to its address when the field is left.
  await page.fill('send-to', `bitcoin:${SOMEBODY}?label=Somebody&amount=0.00025`);
  await page.waitFor('send-plan');
  assert.equal(await held(page, 'send-amount'), '25,000');
  assert.equal(await row(page, hook('send-plan'), 'plan-to'), SOMEBODY);
  assert.equal(await row(page, hook('send-plan'), 'plan-amount'), '25,000 practice sats');
  await page.page.keyboard.press('Tab');
  await until(async () => (await held(page, 'send-to')) === SOMEBODY, 'the field holds the address alone');
  // The amount stays the reader's to change: the link does not fill it a second time.
  await page.fill('send-amount', '26,000');
  assert.equal(await row(page, hook('send-plan'), 'plan-amount'), '26,000 practice sats');

  // A link to a tb1 address is offered in its practice spelling like the bare address.
  await page.fill('send-to', `bitcoin:${TB1}?amount=0.0003`);
  await page.waitFor('send-use-practice');
  assert.equal(await held(page, 'send-amount'), '30,000');
  await page.click('send-use-practice');
  await page.waitFor('send-plan');
  assert.equal(await row(page, hook('send-plan'), 'plan-to'), TB1_AS_PRACTICE);
  assert.equal(await row(page, hook('send-plan'), 'plan-amount'), '30,000 practice sats');
});

scenario('a payment the node refuses: its sentence, the node\'s own words folded away, and the way back with the values kept', LOCAL, async (s) => {
  const page = await openFunded(s);
  await page.fill('send-to', SOMEBODY);
  await page.fill('send-amount', '5,000');
  await page.click('send-continue');
  await page.waitFor('send-review');

  // Meanwhile the same coins are spent elsewhere: the same words in another wallet program, say. A block confirms that.
  const esplora = new Esplora(`${s.stack.originUrl}/esplora`);
  const account = accountFromMnemonic(TEST_WORDS);
  const elsewhere = signPayment(account.key, await scanWallet(account.key, esplora), { to: SOMEBODY, amount: 'all', feeRate: 3n });
  await esplora.broadcast(elsewhere.hex);
  await s.network.nextBlock();
  const before = broadcasts(s);

  await page.click('send-broadcast');
  await page.waitFor('send-refused');
  assert.equal(await headingInFocus(page), 'Payment not sent');
  assert.equal(broadcasts(s), before + 1);

  // The sentence for its code, and the node's own words inside the details line only.
  assert.equal(await notice(page, 'send-refused'), errors.coin_spent);
  const words = await page.text('send-refused-detail');
  assert.match(words, /bad-txns-inputs-missingorspent/);
  assert.equal(await page.page.$eval(hook('send-refused-detail'), (details) => (details as HTMLDetailsElement).open), false);
  const outside = await page.page.evaluate(() => {
    const copy = document.querySelector('main')!.cloneNode(true) as HTMLElement;
    for (const details of copy.querySelectorAll('details')) details.remove();
    return copy.textContent ?? '';
  });
  assert.doesNotMatch(outside, /bad-txns|missingorspent|sendrawtransaction/);
  // The same payment would be refused again, so "Send it" is gone and the way on is back to the form.
  assert.equal(await count(page, 'send-broadcast'), 0);
  await until(() => counted(s).length > 0, 'the refusal is counted');
  assert.deepEqual(counted(s), ['refused']);
  assert.deepEqual(page.statusLog().filter((each) => each.includes('Payment sent')), []);

  const refusedAt = Date.now();
  await page.click('send-change');
  assert.equal(await headingInFocus(page), 'Send');
  assert.equal(await held(page, 'send-to'), SOMEBODY);
  assert.equal(await held(page, 'send-amount'), '5,000');
  assert.equal(await held(page, 'send-fee'), '2');

  // "Let the wallet refresh", the sentence said: it has, by itself and at once, not at the next block or the
  // next poll. All that is left is the coin that was still unconfirmed, which the block has confirmed.
  await until(async () => (await row(page, 'main', 'send-spendable')) === '2,500 practice sats', 'the form shows the coins the network holds', 5_000);
  assert.ok(Date.now() - refusedAt < 6_000, 'well before the wallet\'s own look every 15 seconds');
  assert.equal(await count(page, 'send-waiting'), 0);
  // The plan has followed the coins: the same payment is no longer offered.
  await page.waitFor('send-plan-refused');
  assert.equal(await notice(page, 'send-plan-refused'), errors['plan_too-much']);
  assert.equal(await count(page, 'send-continue'), 0);
  assert.deepEqual(counted(s), ['refused']);
});

scenario('"Change it" goes back with the values kept, and a double tap on "Send it" sends once', LOCAL, async (s) => {
  const page = await openFunded(s);
  await page.fill('send-to', SOMEBODY);
  await page.fill('send-amount', '5,000');
  await page.fill('send-fee', '3');
  await page.click('send-continue');
  await page.waitFor('send-review');
  assert.equal(await row(page, hook('send-review'), 'tx-fee-rate'), '3 sat/vB');

  // Change it: back at the form, nothing sent, every value as it was left.
  await page.click('send-change');
  assert.equal(await headingInFocus(page), 'Send');
  assert.deepEqual([await held(page, 'send-to'), await held(page, 'send-amount'), await held(page, 'send-fee')], [SOMEBODY, '5,000', '3']);
  assert.equal(broadcasts(s), 0);

  await page.fill('send-amount', '6,000');
  await page.click('send-continue');
  await page.waitFor('send-review');
  assert.equal(await row(page, hook('send-review'), 'review-amount'), '6,000 practice sats');

  // Two taps, as a nervous thumb makes them.
  await armed(page);
  await page.page.click(hook('send-broadcast'), { count: 2 });
  const txid = await sentTxid(page);
  await page.settle();
  assert.equal(broadcasts(s), 1);
  assert.equal((await onNetwork(s, txid)).vout.find((output) => output.scriptpubkey_address === SOMEBODY)?.value, 6_000);
  assert.deepEqual(await s.network.coins(SOMEBODY), { count: 1, sats: 6_000 });
  await until(() => counted(s).length > 0, 'the payment is counted');
  await s.stack.settled();
  assert.deepEqual(counted(s), ['sent']);
  assert.deepEqual(page.statusLog().filter((each) => each.includes('Payment sent')), ['Payment sent.']);
});

scenario('the Spanish route: the same screen in Spanish, from the form to "Pago enviado"', LOCAL, async (s) => {
  const page = await openFunded(s, { lang: 'es', width: 375, timeout: 30_000 });
  assert.equal(await textOf(page, 'main h1'), 'Enviar');
  assert.equal(await page.page.evaluate(() => document.documentElement.lang), 'es');
  // The same digits in both languages: a comma between thousands.
  assert.equal(await row(page, 'main', 'send-spendable'), '140,000 sats de práctica');

  // A real address is refused in Spanish, with the Sparrow page's sentence.
  await page.fill('send-to', BC1);
  assert.equal(
    await page.text('send-to-sparrow'),
    'Si empiezan por bc1, Sparrow está en la red real de Bitcoin. Elimina esa billetera en Sparrow y nunca le envíes bitcoin.',
  );
  assert.ok((await described(page, 'send-to')).includes(es.toMainnet));

  await page.fill('send-to', SOMEBODY);
  await page.fill('send-amount', '0,5');
  assert.match(await described(page, 'send-amount'), /Eso no es un monto en sats\./);
  await page.fill('send-amount', '5,000');
  await page.waitFor('send-plan');
  assert.equal(await row(page, hook('send-plan'), 'plan-amount'), '5,000 sats de práctica');
  assert.equal(await page.text('send-continue'), 'Continuar');

  await page.click('send-continue');
  await page.waitFor('send-review');
  assert.equal(await headingInFocus(page), 'Firmado, aún sin enviar');
  assert.equal(await page.text('send-broadcast'), 'Enviarlo');

  await page.click('send-broadcast');
  const txid = await sentTxid(page, '/es');
  assert.equal(await headingInFocus(page), 'Pago enviado');
  await page.waitForStatus('Pago enviado.');
  assert.equal(await page.text('sent-next'), fill(es.sentNext, { seconds: String(s.stack.config.blockSeconds) }));
  assert.equal(await count(page, 'sent-confirmed'), 0);
  assert.equal(await page.sidewaysScroll(), 0);
  assert.equal((await onNetwork(s, txid)).vout.find((output) => output.scriptpubkey_address === SOMEBODY)?.value, 5_000);
  // Counted on the Spanish screen's own path.
  await until(() => counted(s).length > 0, 'the payment is counted');
  assert.deepEqual(
    s.stack.events.map((recorded) => recorded.event).filter((event) => event.name === 'Payment'),
    [{ name: 'Payment', path: '/es/wallet/send', value: 'sent' }],
  );

  // The sent view follows the payment: once a block has taken it in, the first paragraph says so and names the
  // block, where it said that the next block should take it in. The status region says its one line about the
  // confirmation then, and that region is not drawn.
  const height = await s.network.nextBlock();
  await page.waitFor('sent-confirmed');
  assert.equal(await page.text('sent-confirmed'), fill(es.sentConfirmed, { height: formatSats(height) }));
  assert.equal(await count(page, 'sent-next'), 0);
  assert.equal((await onNetwork(s, txid)).status.confirmed, true);
  await page.waitForStatus(strings.wallet.es.noticeConfirmed);
  assert.equal(await page.sidewaysScroll(), 0);
});

scenario('a wallet with no coins: "No coins yet", and the way to the Receive screen', async (s) => {
  // A wallet nobody has seen before has no history on any network, so this one runs against a real network too.
  const page = await s.open('/wallet/send', { record: freshRecord() });
  await page.waitFor('send-no-coins');
  assert.match(await page.text('send-no-coins'), /No coins yet\./);
  assert.equal(await page.page.$eval(`${hook('send-no-coins')} a`, (link) => link.getAttribute('href')), '/wallet/receive#faucet');
  // There is no form to fill in, and no amount of 0 on the screen.
  assert.equal(await count(page, 'send-to'), 0);
  assert.equal(await count(page, 'send-spendable'), 0);
  assert.equal(await textOf(page, 'main h1'), 'Send');
});

scenario('coins that are all unconfirmed: nothing to spend yet, said by name, until the next block', LOCAL, async (s) => {
  const address = testRecord().firstAddress;
  s.standIn.fund(address, 100_000, { confirmed: false });
  const page = await s.open('/wallet/send', { record: testRecord(), timeout: 30_000 });
  await page.waitFor('send-spendable');
  assert.equal(await row(page, 'main', 'send-spendable'), '0 practice sats');
  assert.equal(await row(page, 'main', 'send-waiting'), '100,000 practice sats');
  // The form is there, and the planner says why nothing can be planned yet.
  await page.fill('send-to', SOMEBODY);
  await page.fill('send-amount', '1,000');
  await page.waitFor('send-plan-refused');
  assert.equal(await notice(page, 'send-plan-refused'), errors['plan_unconfirmed-only']);

  // The next block confirms the coin. The page is left as it is, with the payment typed: the plan follows the
  // coins by itself, and what was refused can now be made.
  await s.network.nextBlock();
  await page.waitForGone('send-plan-refused');
  await page.waitFor('send-continue');
  assert.equal(await row(page, 'main', 'send-spendable'), '100,000 practice sats');
  assert.equal(await count(page, 'send-waiting'), 0);
  assert.deepEqual([await held(page, 'send-to'), await held(page, 'send-amount')], [SOMEBODY, '1,000']);
  assert.equal(await row(page, hook('send-plan'), 'plan-amount'), '1,000 practice sats');
});

// -- what the review of this part found --------------------------------------------------

scenario('a double tap on "Continue" signs and shows the review, and sends nothing', LOCAL, async (s) => {
  const page = await openFunded(s);
  await page.fill('send-to', SOMEBODY);
  await page.fill('send-amount', '5,000');
  await page.waitFor('send-continue');

  // The first tap signs and swaps the review in at once. The second comes a moment later, and lands on
  // whatever stands at that spot by then: here, as in a tall window, on "Send it".
  const started = Date.now();
  await tapAt(page, 'send-continue');
  await tapAt(page, 'send-broadcast');
  const between = Date.now() - started;
  assert.ok(between < REVIEW_SETTLE_MS - 200, `the two taps were ${between} ms apart: too slow a run to show anything`);

  // Nothing was sent: the review is there to be read, and "Send it" was switched off when the tap came.
  assert.equal(await textOf(page, 'main h1'), 'Signed, not sent yet');
  await sleep(REVIEW_SETTLE_MS + 300);
  assert.equal(await textOf(page, 'main h1'), 'Signed, not sent yet');
  assert.equal(await count(page, 'send-review'), 1);
  assert.equal(await count(page, 'send-sent'), 0);
  assert.equal(broadcasts(s), 0);
  assert.deepEqual(await s.network.coins(SOMEBODY), { count: 0, sats: 0 });
  assert.deepEqual(counted(s), []);

  // The moment over, the same button sends.
  assert.equal(await off(page, 'send-broadcast'), false);
  await tapAt(page, 'send-broadcast');
  await sentTxid(page);
  assert.equal(broadcasts(s), 1);
  assert.deepEqual(await s.network.coins(SOMEBODY), { count: 1, sats: 5_000 });

  // The next review starts switched off again.
  await page.click('send-another');
  await page.fill('send-to', SOMEBODY);
  await page.fill('send-amount', '6,000');
  await page.click('send-continue');
  await page.waitFor('send-review');
  assert.equal(await off(page, 'send-broadcast'), true);
  await armed(page);
});

/** A Worker that gives up on the practice network after 2.5 seconds, so that a silent network costs a scenario seconds, not minutes. */
const SHORT_WAIT = { localOnly: true, stack: { timeoutMs: 2500 } };

scenario('the node takes the payment and its answer is lost: the screen looks for the transaction and says "Payment sent"', SHORT_WAIT, async (s) => {
  s.expectFault('origin_timeout');
  const page = await openFunded(s, { timeout: 30_000 });
  await page.fill('send-to', SOMEBODY);
  await page.fill('send-amount', '5,000');
  await page.click('send-continue');
  await page.waitFor('send-review');
  const same = await sameAsThePage(s, { to: SOMEBODY, amount: 5_000n, feeRate: 2n });
  await armed(page);

  // The practice network goes silent for the page's request.
  s.standIn.setOrigin('slow');
  await page.page.click(hook('send-broadcast'));
  await until(async () => (await page.text('send-broadcast')) === en.sending, 'the button says "Sending..."');
  // One sending at a time, and a payment on its way cannot be changed: the label, the switched-off
  // "Change it", the mark on <main>, and taps that do nothing.
  assert.equal(await off(page, 'send-change'), true);
  assert.equal(await page.page.$eval('main', (main) => main.getAttribute('aria-busy')), 'true');
  await page.page.evaluate((selector) => (document.querySelector(selector) as HTMLElement).click(), hook('send-broadcast'));
  await page.page.evaluate((selector) => (document.querySelector(selector) as HTMLElement).click(), hook('send-change'));
  await sleep(200);
  assert.equal(await count(page, 'send-review'), 1);
  assert.equal(await page.text('send-broadcast'), en.sending);
  assert.equal(broadcasts(s), 1);

  // The node gets the payment all the same. Only the answer to the page never comes: the Worker gives up and
  // answers that the network could not answer. That says nothing about the payment.
  s.standIn.setOrigin('ok');
  await same.hand();

  // The wallet looks for the transaction, finds it, and the screen shows the payment as sent: no "Payment not
  // sent" over a payment that is out, and no second payment.
  const txid = await sentTxid(page);
  assert.equal(txid, same.payment.txid);
  assert.equal(await headingInFocus(page), 'Payment sent');
  assert.equal(await count(page, 'send-refused'), 0);
  await page.waitForStatus('Payment sent.');
  assert.deepEqual(page.statusLog().filter((said) => said.includes('Payment sent')), ['Payment sent.']);
  assert.deepEqual(await s.network.coins(SOMEBODY), { count: 1, sats: 5_000 });
  await until(() => counted(s).length > 0, 'the payment is counted');
  await s.stack.settled();
  assert.deepEqual(counted(s), ['sent']);

  // The wallet has applied it: the form no longer offers the coin it spent.
  await page.click('send-another');
  assert.equal(await row(page, 'main', 'send-spendable'), '134,718 practice sats');
});

scenario('no answer about a payment: the heading claims nothing, and the same payment can be sent again', SHORT_WAIT, async (s) => {
  s.expectFault('origin_timeout');
  const page = await openFunded(s, { timeout: 30_000 });
  await page.fill('send-to', SOMEBODY);
  await page.fill('send-amount', '5,000');
  await page.click('send-continue');
  await page.waitFor('send-review');

  // The practice network is silent: the payment never reaches the node, and the page cannot know that.
  s.standIn.setOrigin('slow');
  await page.click('send-broadcast');
  await page.waitFor('send-refused');
  assert.equal(await headingInFocus(page), 'No answer about this payment');
  assert.equal(await notice(page, 'send-refused'), errors.unavailable);
  assert.equal(await page.text('send-unanswered'), en.unansweredNote);
  assert.doesNotMatch(await textOf(page, 'main'), /not sent/i);
  // The same payment may be handed in again, and that is the first button.
  assert.equal(await page.text('send-broadcast'), en.sendAgain);
  assert.equal(await off(page, 'send-change'), false);
  // Nothing was refused by the node, so nothing is counted, and nothing was announced as sent.
  assert.deepEqual(counted(s), []);
  assert.deepEqual(page.statusLog().filter((said) => said.includes('Payment sent')), []);

  // The network is back, and holds nothing for the address: this time the payment had not gone out.
  // "Try sending again" sends the payment that was signed, once.
  s.standIn.setOrigin('ok');
  assert.deepEqual(await s.network.coins(SOMEBODY), { count: 0, sats: 0 });
  await page.click('send-broadcast');
  const txid = await sentTxid(page);
  assert.equal(await headingInFocus(page), 'Payment sent');
  assert.equal((await onNetwork(s, txid)).vout.find((output) => output.scriptpubkey_address === SOMEBODY)?.value, 5_000);
  assert.deepEqual(await s.network.coins(SOMEBODY), { count: 1, sats: 5_000 });
  await until(() => counted(s).length > 0, 'the payment is counted');
  assert.deepEqual(counted(s), ['sent']);
});

scenario('a payment to one of the wallet\'s own addresses: the screen says so, and never that the amount leaves', LOCAL, async (s) => {
  const page = await openFunded(s);
  // The address the Receive screen shows: the first thing a learner with nobody to pay will paste.
  const own = testRecord().firstAddress;
  await page.fill('send-to', own);
  await page.fill('send-amount', '30,000');
  await page.waitFor('send-plan');

  // Under the field, as part of what describes it, and in the plan.
  assert.equal(await page.text('send-to-own'), en.toOwn);
  assert.ok((await described(page, 'send-to')).includes(en.toOwn));
  assert.equal(await page.text('plan-to-own'), en.toOwn);
  // The sum of the amount and the fee is named as that. Nothing on the screen says that it leaves the wallet.
  assert.equal(await textOf(page, `${hook('send-plan')} ${hook('plan-total')} dt`), 'Amount and fee together');
  assert.equal(await row(page, hook('send-plan'), 'plan-total'), '30,282 practice sats');
  assert.doesNotMatch(await textOf(page, 'main'), /leaving this wallet/i);

  await page.click('send-continue');
  await page.waitFor('send-review');
  assert.equal(await page.text('review-to-own'), en.toOwn);
  assert.equal(await textOf(page, `${hook('send-review')} ${hook('review-total')} dt`), 'Amount and fee together');
  assert.doesNotMatch(await textOf(page, 'main'), /leaving this wallet/i);
  // The outputs agree with it: both come back to this wallet.
  const outputs = await page.texts('tx-output');
  assert.ok(outputs.some((text) => text.startsWith('30,000 practice sats') && text.includes(own) && text.includes(strings.wallet.en.txMine)));
  assert.ok(outputs.some((text) => text.startsWith('69,718 practice sats') && text.includes(strings.wallet.en.txChange)));

  await page.click('send-broadcast');
  await sentTxid(page);
  // Only the fee has left: 142,500 before, 282 less now. The amount is back as a coin somebody sent (not spendable
  // until it is in a block), the change as the wallet's own.
  await page.click('send-another');
  assert.equal(await row(page, 'main', 'send-spendable'), '109,718 practice sats');
  assert.equal(await row(page, 'main', 'send-waiting'), '32,500 practice sats');
});

scenario('"Pass it on": a failure goes when the reader types, and a late answer never replaces what was typed', LOCAL, async (s) => {
  s.expectFault('origin_down');
  const page = await openFunded(s);

  // The bots are down: the cause and the way out, as an alert under the button.
  s.standIn.setFaucet('down');
  await page.click('pass-it-on');
  await page.waitFor('pot-problem');
  assert.equal(await notice(page, 'pot-problem'), errors.unavailable);
  assert.equal(await page.page.$eval(hook('pot-problem'), (box) => box.getAttribute('role')), 'alert');
  assert.equal(await held(page, 'send-to'), '');
  // It was about the field as it stood. The reader types an address by hand, and it goes.
  await page.fill('send-to', SOMEBODY);
  await page.waitForGone('pot-problem');
  s.standIn.setFaucet('ok');

  // Now the pot takes its time to answer (through this process's fetch, which is the Worker's way to the bots).
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/bots/pot/address')) await sleep(900);
    return real(input, init);
  };
  try {
    await page.click('pass-it-on');
    await until(async () => (await page.text('pass-it-on')) === en.potBusy, 'the button says that it is asking');
    // Meanwhile the reader types another address.
    await page.fill('send-to', TB1_AS_PRACTICE);
    await until(async () => (await page.text('pass-it-on')) === en.potButton, 'the pot has answered');
  } finally {
    globalThis.fetch = real;
  }
  // The answer came after the typing, and the typed address stays: in the field and in the plan.
  await page.fill('send-amount', '5,000');
  await page.waitFor('send-plan');
  assert.equal(await held(page, 'send-to'), TB1_AS_PRACTICE);
  assert.equal(await row(page, hook('send-plan'), 'plan-to'), TB1_AS_PRACTICE);
  assert.equal(await count(page, 'send-to-pot'), 0);
  assert.equal(await count(page, 'pot-problem'), 0);
  assert.deepEqual(page.statusLog().filter((said) => said === en.potFilled), []);

  // Pressed again with nothing typed meanwhile, the pot's address goes in over the one that was there, and is said.
  await page.click('pass-it-on');
  await page.waitFor('send-to-pot');
  assert.equal(await held(page, 'send-to'), await potOnNetwork(s));
  await page.waitForStatus(en.potFilled);
});

/** Makes a passkey on the page's own authenticator, with the options the app's create() uses (app/src/lib/passkey.ts). */
async function makePasskey(page: OpenedPage): Promise<void> {
  // Chrome makes a passkey only on the page in front.
  await page.page.bringToFront();
  const made = await page.page.evaluate(async () => {
    const credential = await navigator.credentials.create({
      publicKey: {
        rp: { id: location.hostname, name: 'LearnBitcoin practice wallet' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Practice wallet TEST (no real money)', displayName: 'Practice wallet TEST (no real money)' },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        attestation: 'none',
        extensions: { prf: {} },
      },
    });
    return credential !== null;
  });
  assert.equal(made, true);
}

/** How many times the page's passkeys have been used: every prompt that was answered counts one. */
const prompts = async (page: OpenedPage): Promise<number> => (await page.passkey!.credentials()).reduce((sum, each) => sum + each.uses, 0);

scenario('a passkey wallet: the plan costs no prompt, the unlock step one, and a wallet locked while sending keeps no payment', SHORT_WAIT, async (s) => {
  s.expectFault('origin_timeout');
  // The wallet comes in through the gate's "Open with my passkey", is paid, and the page is loaded afresh: locked, with coins.
  const page = await s.open('/wallet/send', { passkey: 'prf', timeout: 30_000 });
  await page.waitFor('open-passkey');
  await makePasskey(page);
  await page.click('open-passkey');
  await page.waitFor('lock-state');
  const record = JSON.parse((await page.stored()) ?? 'null') as { kind: string; firstAddress: string };
  assert.equal(record.kind, 'passkey');
  s.standIn.fund(record.firstAddress, 100_000);
  await page.goto('/wallet/send');
  await page.waitFor('send-spendable');
  assert.equal(await page.text('lock-state'), strings.common.en.stateLocked);
  const before = await prompts(page);

  // The plan is worked out without the keys: no prompt.
  await page.fill('send-to', SOMEBODY);
  await page.fill('send-amount', '30,000');
  await page.waitFor('send-plan');
  assert.equal(await row(page, hook('send-plan'), 'plan-amount'), '30,000 practice sats');
  assert.equal(await prompts(page), before);

  // "Continue" leads to the unlock step, which promises that unlocking sends nothing. Still no prompt, and nothing sent.
  await page.click('send-continue');
  await page.waitFor('unlock-step');
  assert.equal(await headingInFocus(page), 'Unlock to sign');
  assert.ok((await page.text('unlock-step')).includes(strings.wallet.en.unlockPromise));
  assert.equal(await prompts(page), before);
  assert.equal(broadcasts(s), 0);
  // The way back is there, switched on while no prompt is open, and it keeps what was typed.
  assert.equal(await off(page, 'send-unlock-back'), false);
  await page.click('send-unlock-back');
  assert.equal(await headingInFocus(page), 'Send');
  assert.deepEqual([await held(page, 'send-to'), await held(page, 'send-amount')], [SOMEBODY, '30,000']);
  await page.click('send-continue');
  await page.waitFor('unlock-step');

  // One prompt loads the keys, and the review of the signed payment follows.
  await page.click('unlock');
  await page.waitFor('send-review');
  assert.equal(await headingInFocus(page), 'Signed, not sent yet');
  assert.equal(await prompts(page), before + 1);
  assert.equal(broadcasts(s), 0);
  assert.equal(await row(page, hook('send-review'), 'review-amount'), '30,000 practice sats');
  await page.click('send-broadcast');
  await sentTxid(page);
  assert.deepEqual(await s.network.coins(SOMEBODY), { count: 1, sats: 30_000 });

  // Unlocked now: the next payment goes straight to the review, with no further prompt.
  await page.click('send-another');
  await page.fill('send-to', SOMEBODY);
  await page.fill('send-amount', '10,000');
  await page.click('send-continue');
  await page.waitFor('send-review');
  assert.equal(await prompts(page), before + 1);
  await armed(page);

  // The reader sends it, and locks the wallet while it is on its way to a network that has gone silent.
  s.standIn.setOrigin('slow');
  await page.page.click(hook('send-broadcast'));
  await until(async () => (await page.text('send-broadcast')) === en.sending, 'the button says "Sending..."');
  await page.click('lock');
  // A payment that is on its way is not called back by that.
  await sleep(300);
  assert.equal(await count(page, 'send-review'), 1);
  assert.equal(await page.text('send-broadcast'), en.sending);
  // The try fails. A locked wallet keeps no signed payment: the form is back, with what was typed, and
  // nothing offers to send "again" from a wallet whose state line says that sending needs the passkey.
  await page.waitForGone('send-review');
  await page.waitFor('send-continue');
  assert.equal(await headingInFocus(page), 'Send');
  assert.equal(await count(page, 'send-refused'), 0);
  assert.equal(await count(page, 'send-broadcast'), 0);
  assert.equal(await page.text('lock-state'), strings.common.en.stateLocked);
  assert.deepEqual([await held(page, 'send-to'), await held(page, 'send-amount')], [SOMEBODY, '10,000']);
  s.standIn.setOrigin('ok');
  // The second payment never went out, and "Continue" asks for the passkey again.
  assert.deepEqual(await s.network.coins(SOMEBODY), { count: 1, sats: 30_000 });
  await page.click('send-continue');
  await page.waitFor('unlock-step');
  assert.equal(await prompts(page), before + 1);
  await until(() => counted(s).length > 0, 'the first payment is counted');
  assert.deepEqual(counted(s), ['sent']);
});
