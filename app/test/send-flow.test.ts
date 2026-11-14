// What the Send screen does with each answer of the wallet
// (src/screens/send/flow.ts): what follows sign(), what an unlock that
// changed the wallet means for a payment, which refused payments may be
// handed in again, and which lines stand beside a plan.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BROADCAST_REFUSALS } from '@learnbitcoin/practice-contract';
import {
  accountFromMnemonic,
  deriveAddress,
  planPayment,
  signPayment,
  viewPayment,
  ownAddresses,
  watchOnlyAccount,
  type Coin,
  type PaymentPlan,
  type PlanFailure,
  type WalletState,
} from '@learnbitcoin/practice-wallet';
import type { Unlocked } from '../src/components/wallet/unlock-flow.ts';
import type { BroadcastFailure } from '../src/lib/api.ts';
import type { SignResult } from '../src/lib/wallet-api.ts';
import {
  REVIEW_SETTLE_MS,
  afterUnlock,
  canSendAgain,
  coinsInDoubt,
  fillsPot,
  judgeSign,
  noChangeOf,
  rateDiffers,
  refusalHeading,
  sendAllLine,
  unanswered,
  type RefusalHeading,
} from '../src/screens/send/flow.ts';
import { strings } from '../src/strings/index.ts';

const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ACCOUNT = accountFromMnemonic(WORDS);
const WATCH = watchOnlyAccount(ACCOUNT.xpub);
const TO = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
/** The shortest kind of address there is: one coin paid to it in full makes too small a transaction. */
const ANCHOR = 'bcrt1pfeesnyr2tx';

function walletWith(...values: bigint[]): WalletState {
  const coins: Coin[] = values.map((value, index) => {
    const own = deriveAddress(WATCH, 0, index);
    return {
      txid: (0xab + index).toString(16).repeat(32),
      vout: 0,
      value,
      status: { confirmed: true, block_height: 101 },
      chain: 0,
      index,
      address: own.address,
      script: own.script,
    };
  });
  return {
    receive: [],
    change: [],
    coins,
    nextReceiveIndex: values.length,
    nextChangeIndex: 0,
    confirmed: values.reduce((sum, value) => sum + value, 0n),
    unconfirmed: 0n,
  };
}

// The lists below are objects so that the compiler refuses a missing value:
// add a failure to a type and its line must be added here.
const PLAN_FAILURES: Record<PlanFailure, true> = {
  'nothing-spendable': true,
  'unconfirmed-only': true,
  'too-much': true,
  'below-dust': true,
  'bad-address': true,
  'too-small': true,
  'bad-fee': true,
};
const BROADCAST_FAILURES: Record<BroadcastFailure, boolean> = {
  // Nothing about the payment was at fault, and waiting helps: the same payment may go again.
  network: true,
  unavailable: true,
  limit: true,
  // The node refused the payment, or it is too large: the same one would be refused again.
  already_sent: false,
  coin_spent: false,
  fee_too_low: false,
  dust: false,
  refused: false,
  too_large: false,
};

// -- after sign() -----------------------------------------------------------------

test('judgeSign: a signed payment goes to the review', () => {
  const state = walletWith(100_000n);
  const payment = signPayment(ACCOUNT.key, state, { to: TO, amount: 30_000n, feeRate: 2n });
  const signed: SignResult = { ok: true, payment, view: viewPayment(payment, ownAddresses(state)) };
  for (const passkey of [true, false]) {
    for (const keysLoaded of [true, false]) assert.deepEqual(judgeSign(signed, passkey, keysLoaded), { kind: 'signed' });
  }
});

test('judgeSign: locked means the unlock step for a passkey wallet, and keys loaded without a prompt for any other', () => {
  const locked: SignResult = { ok: false, reason: 'locked' };
  assert.deepEqual(judgeSign(locked, true, false), { kind: 'needs-unlock' });
  assert.deepEqual(judgeSign(locked, false, false), { kind: 'needs-keys' });
});

test('judgeSign: locked straight after an unlock never sends the reader round again', () => {
  const locked: SignResult = { ok: false, reason: 'locked' };
  assert.deepEqual(judgeSign(locked, true, true), { kind: 'no-keys' });
  assert.deepEqual(judgeSign(locked, false, true), { kind: 'no-keys' });
});

test('judgeSign: every reason the planner can give leads back to the form with that reason', () => {
  for (const reason of Object.keys(PLAN_FAILURES) as PlanFailure[]) {
    for (const keysLoaded of [true, false]) {
      assert.deepEqual(judgeSign({ ok: false, reason }, true, keysLoaded), { kind: 'refused', reason });
    }
    // And the form has a sentence to show for it, in both languages.
    assert.ok(strings.errors.en[`plan_${reason}`].length > 20, reason);
    assert.ok(strings.errors.es[`plan_${reason}`].length > 20, reason);
  }
});

test('afterUnlock: only an unlock that changed nothing else signs the payment that was waiting', () => {
  const answers: Record<Unlocked, 'sign' | 'plan-again'> = { same: 'sign', tampered: 'plan-again', switched: 'plan-again' };
  for (const how of Object.keys(answers) as Unlocked[]) assert.equal(afterUnlock(how), answers[how], how);
});

// -- after a refused broadcast ------------------------------------------------------

test('canSendAgain: the same payment goes again only where waiting helps', () => {
  for (const reason of Object.keys(BROADCAST_FAILURES) as BroadcastFailure[]) {
    assert.equal(canSendAgain(reason), BROADCAST_FAILURES[reason], reason);
  }
  // Whatever the node itself refused is never handed in again as it is.
  for (const reason of BROADCAST_REFUSALS) assert.equal(canSendAgain(reason), false, reason);
});

test('canSendAgain: where it says no, the sentence sends the reader back; where it says yes, it does not', () => {
  const { en, es } = strings.errors;
  for (const reason of Object.keys(BROADCAST_FAILURES) as BroadcastFailure[]) {
    if (reason === 'already_sent') {
      // Nothing is left to send: the way out is to look for the payment.
      assert.match(en[reason], /Look for it under Activity/);
      continue;
    }
    if (canSendAgain(reason)) {
      assert.doesNotMatch(en[reason], /Go back/, reason);
      assert.doesNotMatch(es[reason], /Vuelve atrás/, reason);
    } else {
      assert.match(en[reason], /Go back|make the payment again/, reason);
      assert.match(es[reason], /Vuelve atrás|vuelve a hacer el pago/, reason);
    }
  }
});

test('refusalHeading: "not sent" is said only where the network refused the payment or never got it', () => {
  // An object, so that the compiler refuses a failure without a heading.
  const headings: Record<BroadcastFailure, RefusalHeading> = {
    // No answer came, or the practice network could not give one: the payment may be out all the same.
    network: 'unanswered',
    unavailable: 'unanswered',
    // The network says it is in a block.
    already_sent: 'already-sent',
    // The node refused it, the request was too large to pass on, or the page asked too fast.
    coin_spent: 'not-sent',
    fee_too_low: 'not-sent',
    dust: 'not-sent',
    refused: 'not-sent',
    too_large: 'not-sent',
    limit: 'not-sent',
  };
  for (const reason of Object.keys(headings) as BroadcastFailure[]) {
    assert.equal(refusalHeading(reason), headings[reason], reason);
    assert.equal(unanswered(reason), headings[reason] === 'unanswered', reason);
    // Where nothing is known about the payment, the same payment may always be handed in again.
    if (unanswered(reason)) assert.equal(canSendAgain(reason), true, reason);
  }
  const { en, es } = strings.send;
  assert.equal(en.refusedTitle, 'Payment not sent');
  assert.equal(en.unansweredTitle, 'No answer about this payment');
  // The heading and the line under the sentence claim nothing about where the payment is.
  for (const text of [en.unansweredTitle, es.unansweredTitle]) assert.doesNotMatch(text, /not sent|no se envi|was sent|se envi[óo]/i);
  assert.match(en.unansweredNote, /^This page cannot tell whether the payment went out\. Sending this same payment again is safe/);
  assert.match(es.unansweredNote, /^Esta página no puede saber si el pago salió\./);
  // The sentences these two answers get do not say it either.
  for (const reason of ['network', 'unavailable'] as const) {
    assert.doesNotMatch(strings.errors.en[reason], /not sent|was not/i, reason);
  }
});

test('coinsInDoubt: the coins are read again after a refusal that says they are not what the wallet thinks', () => {
  const doubt: Record<BroadcastFailure, boolean> = {
    coin_spent: true,
    already_sent: true,
    refused: true,
    // Nothing about the coins: the fee, the amount or the size was at fault, or nothing is known.
    fee_too_low: false,
    dust: false,
    too_large: false,
    limit: false,
    network: false,
    unavailable: false,
  };
  for (const reason of Object.keys(doubt) as BroadcastFailure[]) {
    assert.equal(coinsInDoubt(reason), doubt[reason], reason);
    // Such a payment is never handed in again as it is: the way on starts at the form, which must show the coins as they are.
    if (coinsInDoubt(reason)) assert.equal(canSendAgain(reason), false, reason);
  }
  // The sentences promise it: "let the wallet refresh".
  for (const reason of ['coin_spent', 'refused'] as const) {
    assert.match(strings.errors.en[reason], /let the wallet refresh/, reason);
    assert.match(strings.errors.es[reason], /deja que la billetera se actualice/, reason);
  }
});

// -- the review, and pass it on -----------------------------------------------------

test('REVIEW_SETTLE_MS: "Send it" is off for longer than a double tap takes, and not for long', () => {
  // Systems count two taps as a double tap up to about half a second apart.
  assert.ok(REVIEW_SETTLE_MS >= 700, String(REVIEW_SETTLE_MS));
  assert.ok(REVIEW_SETTLE_MS <= 1_500, String(REVIEW_SETTLE_MS));
});

test('fillsPot: a pot address that arrives late never replaces what the reader typed meanwhile', () => {
  const pot = 'bcrt1qdz087gr9rthdz0uu5pekjuc7ada86d95tjwqqx';
  // Nothing was typed since the tap: the address goes in, also over an address that was there at the tap.
  assert.equal(fillsPot('', '', true), true);
  assert.equal(fillsPot(TO, TO, true), true);
  assert.equal(fillsPot(pot, pot, true), true);
  // The reader typed or cleared something while the pot was asked.
  assert.equal(fillsPot('', TO, true), false);
  assert.equal(fillsPot(TO, '', true), false);
  assert.equal(fillsPot(TO, `${TO} `, true), false);
  // The reader has gone on: the field behind a review or a sent payment is left alone.
  assert.equal(fillsPot('', '', false), false);
  assert.equal(fillsPot(TO, TO, false), false);
});

// -- beside a plan ------------------------------------------------------------------

test('sendAllLine: what "Send all" would deliver shows beside a plan and beside a refusal, when it is above 0', () => {
  const state = walletWith(100_000n, 40_000n);
  const ok = planPayment(WATCH, state, { to: TO, amount: 30_000n, feeRate: 2n });
  assert.ok(ok.ok && ok.maxSendable > 0n);
  assert.deepEqual(sendAllLine(ok, false), { kind: 'would-deliver', sats: ok.maxSendable });

  const tooMuch = planPayment(WATCH, state, { to: TO, amount: 10_000_000n, feeRate: 2n });
  assert.ok(!tooMuch.ok && tooMuch.reason === 'too-much');
  assert.deepEqual(sendAllLine(tooMuch, false), { kind: 'would-deliver', sats: tooMuch.maxSendable });
  // The figure is what the planner gives for "Send all" itself.
  const all = planPayment(WATCH, state, { to: TO, amount: 'all', feeRate: 2n });
  assert.ok(all.ok);
  assert.equal(all.amount, tooMuch.maxSendable);

  const dust = planPayment(WATCH, state, { to: TO, amount: 100n, feeRate: 2n });
  assert.ok(!dust.ok && dust.reason === 'below-dust');
  assert.equal(sendAllLine(dust, false)?.kind, 'would-deliver');
});

test('sendAllLine: with "Send all" on, a plan that stands is the figure, and one that cannot be made gets the line', () => {
  const state = walletWith(100_000n);
  const all = planPayment(WATCH, state, { to: TO, amount: 'all', feeRate: 2n });
  assert.ok(all.ok);
  assert.equal(sendAllLine(all, true), null);
  // One coin too small to pay its own fee and leave anything worth sending. The planner's sentence
  // speaks of "that amount" and of sending a larger one, and the reader typed none: the line says what it is about.
  const small = planPayment(WATCH, walletWith(400n), { to: TO, amount: 'all', feeRate: 2n });
  assert.ok(!small.ok && small.reason === 'below-dust' && small.maxSendable === 0n);
  assert.deepEqual(sendAllLine(small, true), { kind: 'cannot' });
  // One coin sent whole to a very short address: too small in bytes.
  const short = planPayment(WATCH, state, { to: ANCHOR, amount: 'all', feeRate: 2n });
  assert.ok(!short.ok && short.reason === 'too-small' && short.maxSendable === 0n);
  assert.deepEqual(sendAllLine(short, true), { kind: 'cannot' });
  // A refusal about the wallet's coins has its own sentence, with "Send all" on as with it off.
  const refused = (reason: PlanFailure): PaymentPlan => ({ ok: false, reason, maxSendable: 0n, dust: null });
  for (const reason of ['nothing-spendable', 'unconfirmed-only', 'bad-address', 'bad-fee'] as const) {
    assert.equal(sendAllLine(refused(reason), true), null, reason);
  }
});

test('sendAllLine: a figure of 0 says only that "Send all" cannot be made, also beside a plan that stands', () => {
  // The faucet's coin beside five small ones, at 250 sat/vB (strings.test.ts has the same wallet).
  const state = walletWith(100_000n, 300n, 310n, 320n, 330n, 340n);
  const half = planPayment(WATCH, state, { to: TO, amount: 50_000n, feeRate: 250n });
  assert.ok(half.ok);
  assert.equal(half.maxSendable, 0n);
  assert.deepEqual(sendAllLine(half, false), { kind: 'cannot' });
  const over = planPayment(WATCH, state, { to: TO, amount: 10_000_000n, feeRate: 250n });
  assert.ok(!over.ok && over.reason === 'too-much');
  assert.deepEqual(sendAllLine(over, false), { kind: 'cannot' });
  // One coin to a very short address: every amount near the whole coin is too small in bytes.
  const short = planPayment(WATCH, walletWith(100_000n), { to: ANCHOR, amount: 99_700n, feeRate: 2n });
  assert.ok(!short.ok && short.reason === 'too-small' && short.maxSendable === 0n);
  assert.deepEqual(sendAllLine(short, false), { kind: 'cannot' });

  // The screen's own line says exactly that, and never that nothing can be sent.
  for (const lang of ['en', 'es'] as const) {
    assert.doesNotMatch(strings.send[lang].sendAllCannot, /nothing can be sent|can send nothing|cannot send anything/i);
    assert.doesNotMatch(strings.send[lang].sendAllCannot, /no (se )?puede enviar nada|nada (se )?puede enviar/i);
  }
  assert.match(strings.send.en.sendAllCannot, /^Send all cannot be used for this payment at this fee rate\.$/);
});

test('sendAllLine: a refusal about the coins says what the wallet holds, and gets no line', () => {
  const refused = (reason: PlanFailure): PaymentPlan => ({ ok: false, reason, maxSendable: 0n, dust: null });
  for (const reason of ['nothing-spendable', 'unconfirmed-only', 'bad-address', 'bad-fee'] as const) {
    assert.equal(sendAllLine(refused(reason), false), null, reason);
  }
  for (const reason of ['too-much', 'below-dust', 'too-small'] as const) {
    assert.deepEqual(sendAllLine(refused(reason), false), { kind: 'cannot' }, reason);
  }
});

test('noChangeOf: why a payment has no change', () => {
  assert.equal(noChangeOf(18_500n, false), null);
  assert.equal(noChangeOf(18_500n, true), null);
  assert.equal(noChangeOf(null, true), 'send-all');
  assert.equal(noChangeOf(null, false), 'leftover');
  // The planner's own cases: "Send all" has none, and a leftover under the dust limit goes to the fee.
  const state = walletWith(100_000n);
  const all = planPayment(WATCH, state, { to: TO, amount: 'all', feeRate: 2n });
  assert.ok(all.ok);
  assert.equal(noChangeOf(all.change, true), 'send-all');
  const nearly = planPayment(WATCH, state, { to: TO, amount: all.amount - 200n, feeRate: 2n });
  assert.ok(nearly.ok);
  assert.equal(nearly.change, null);
  assert.equal(nearly.fee, all.fee + 200n);
  assert.equal(noChangeOf(nearly.change, false), 'leftover');
});

test('rateDiffers: the plan says so when the rate it pays is not the one in the field, as the screen writes both', () => {
  assert.equal(rateDiffers(2, 2n), false);
  assert.equal(rateDiffers(1000, 1_000n), false);
  // 2.004 is written "2": the reader sees the rate they chose.
  assert.equal(rateDiffers(2.004, 2n), false);
  assert.equal(rateDiffers(2.01, 2n), true);
  assert.equal(rateDiffers(3.4, 2n), true);

  const state = walletWith(100_000n, 40_000n);
  // "Send all" pays exactly the rate asked for, and so does a payment from one coin with change.
  const all = planPayment(WATCH, state, { to: TO, amount: 'all', feeRate: 2n });
  assert.ok(all.ok);
  assert.equal(rateDiffers(all.feeRate, 2n), false);
  const oneCoin = planPayment(WATCH, state, { to: TO, amount: 30_000n, feeRate: 2n });
  assert.ok(oneCoin.ok && oneCoin.change !== null && oneCoin.inputs.length === 1);
  assert.equal(rateDiffers(oneCoin.feeRate, 2n), false);
  // From two coins the spare byte of each signature adds up to a whole vbyte: a hair above.
  const twoCoins = planPayment(WATCH, state, { to: TO, amount: 120_000n, feeRate: 2n });
  assert.ok(twoCoins.ok && twoCoins.change !== null && twoCoins.inputs.length === 2);
  assert.ok(twoCoins.feeRate > 2 && twoCoins.feeRate < 2.05);
  assert.equal(rateDiffers(twoCoins.feeRate, 2n), true);
  // A leftover that went to the fee: well above.
  const nearly = planPayment(WATCH, state, { to: TO, amount: all.amount - 200n, feeRate: 2n });
  assert.ok(nearly.ok);
  assert.equal(rateDiffers(nearly.feeRate, 2n), true);
});
