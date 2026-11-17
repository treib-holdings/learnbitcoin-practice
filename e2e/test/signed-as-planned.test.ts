// The check the journeys make on the review of a signed payment against its
// plan (scenarios/journey-helpers.ts, assertSignedAsPlanned): what it lets
// pass, and what it does not.
//
// The plan of a payment says how large the signed payment will be, and
// counts every signature at its full length. Now and then a signature comes
// out a byte shorter (wallet/src/send.ts, above plannedVsize). A payment
// that spends one coin is then a vbyte smaller than its plan said, and the
// rate it pays, which is the fee over the size, a little higher: "109 vB"
// and "2.02 sat/vB" where the plan said "110 vB" and "2 sat/vB". A payment
// that spends two coins keeps its plan's size with one such signature: a
// size is counted in whole vbytes, and the byte of a signature is a quarter
// of one. Whether a signature comes out shorter depends on the key and on
// what it signs. A wallet from fixed words signs the same payment the same
// way in every run. The wallet of a journey is made on Create, so its keys
// are new in every run, and a journey that held the review to the plan
// figure for figure failed once in a long while, with nothing wrong in the
// app.
//
// So this file runs the check on the figures of such a payment, on the
// things it must still refuse, and on payments signed by the wallet's own
// code: of one coin until one of them comes out smaller than its plan, and
// of two coins until one of them is signed a byte short and keeps its size.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Esplora, accountFromMnemonic, deriveAddress, planPayment, scanWallet, signPayment } from '@learnbitcoin/practice-wallet';
import { feeRateText } from '../../app/src/components/wallet/tx-text.ts';
import { formatSats } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { assertSignedAsPlanned, type Figures } from '../scenarios/journey-helpers.ts';
import { makeFakeOrigin } from '../src/fake-origin.ts';

const common = strings.common.en;

/** An address of some other wallet (wallet/test/vectors.json, the passkey vector's first address). */
const SOMEONE = 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6';

/**
 * The seven figures of a payment as the Send screen writes them, in the plan
 * and in the review alike (screens/send/Plan.svelte and Review.svelte, with
 * the rows of components/wallet/TxFeeRows.svelte between them).
 */
function figures(payment: { to: string; amount: bigint; fee: bigint; vsize: number; feeRate: number; change: bigint | null }): Figures {
  const amount = (sats: bigint): string => `${formatSats(sats)} ${common.practiceSats}`;
  return {
    to: payment.to,
    amount: amount(payment.amount),
    fee: amount(payment.fee),
    size: `${formatSats(payment.vsize)} ${common.vbyteUnit}`,
    rate: `${feeRateText(payment.feeRate)} ${common.feeRateUnit}`,
    total: amount(payment.amount + payment.fee),
    change: payment.change === null ? strings.send.en.planNoChange : amount(payment.change),
  };
}

/** The length of a signed payment in bytes, as it goes to the network: witnesses and all. */
const bytesOf = (signed: { hex: string }): number => signed.hex.length / 2;

/** A payment with change, as planned: one coin in, two outputs, 2 sat/vB. */
const PLAN: Figures = {
  to: SOMEONE,
  amount: '30,000 practice sats',
  fee: '282 practice sats',
  size: '141 vB',
  rate: '2 sat/vB',
  total: '30,282 practice sats',
  change: '69,718 practice sats',
};

/** "Send all", as planned: one coin in, one output, 2 sat/vB. */
const ALL: Figures = {
  to: SOMEONE,
  amount: '99,780 practice sats',
  fee: '220 practice sats',
  size: '110 vB',
  rate: '2 sat/vB',
  total: '100,000 practice sats',
  change: strings.send.en.planNoChange,
};

test('a review that is the plan passes, and so does one that is a vbyte or two smaller at the rate its size gives', () => {
  // Figure for figure the plan: what nearly every signed payment is.
  assertSignedAsPlanned({ ...PLAN }, PLAN);
  assertSignedAsPlanned({ ...ALL }, ALL);
  // One signature a byte shorter. The fee is the plan's, so the rate is the fee over the smaller size, as the app writes a rate.
  assertSignedAsPlanned({ ...ALL, size: '109 vB', rate: '2.02 sat/vB' }, ALL);
  assertSignedAsPlanned({ ...PLAN, size: '140 vB', rate: '2.01 sat/vB' }, PLAN);
  // Two vbytes under the plan: a payment of several coins, with more than one short signature.
  assertSignedAsPlanned({ ...PLAN, size: '139 vB', rate: '2.03 sat/vB' }, PLAN);
  // On the Spanish screen only the unit of an amount is another. And a payment of many coins: its size is
  // written with a comma, which a vbyte less takes away, and the rate is then the same to two places.
  const large: Figures = { to: SOMEONE, amount: '30,000 sats de práctica', fee: '2,000 sats de práctica', size: '1,000 vB', rate: '2 sat/vB', total: '32,000 sats de práctica', change: '68,000 sats de práctica' };
  assertSignedAsPlanned({ ...large }, large);
  assertSignedAsPlanned({ ...large, size: '999 vB' }, large);
  assertSignedAsPlanned({ ...large, size: '998 vB' }, large);
  assert.throws(() => assertSignedAsPlanned({ ...large, size: '999 vB', rate: '2.01 sat/vB' }, large), { name: 'AssertionError' });
});

test('whom it pays, the amount, the fee, the total and the change must be the plan\'s; the size never more than the plan\'s and never three less; the rate the one its size gives', () => {
  const refused = (review: Figures, plan: Figures, what: string): void => {
    assert.throws(() => assertSignedAsPlanned(review, plan), { name: 'AssertionError' }, what);
  };
  // Each of the five, one at a time, by the least it can differ.
  refused({ ...PLAN, to: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080' }, PLAN, 'another address');
  refused({ ...PLAN, amount: '30,001 practice sats' }, PLAN, 'another amount');
  refused({ ...PLAN, fee: '281 practice sats' }, PLAN, 'another fee');
  refused({ ...PLAN, total: '30,281 practice sats' }, PLAN, 'another total');
  refused({ ...PLAN, change: '69,719 practice sats' }, PLAN, 'another change');
  refused({ ...ALL, change: '1 practice sat' }, ALL, 'change where the plan had none');
  // A signed payment is never larger than its plan: the fee would fall short of the rate asked for.
  refused({ ...PLAN, size: '142 vB', rate: '1.99 sat/vB' }, PLAN, 'a vbyte more');
  refused({ ...PLAN, size: '142 vB' }, PLAN, 'a vbyte more, at the plan\'s rate');
  // Three vbytes less is no short signature or two.
  refused({ ...PLAN, size: '138 vB', rate: '2.04 sat/vB' }, PLAN, 'three vbytes less');
  refused({ ...PLAN, size: '14 vB', rate: '20.14 sat/vB' }, PLAN, 'a size that lost a digit');
  // The size is written as the plan writes a size.
  refused({ ...PLAN, size: '140' }, PLAN, 'no unit');
  refused({ ...PLAN, size: '140 bytes', rate: '2.01 sat/vB' }, PLAN, 'another unit');
  refused({ ...PLAN, size: '' }, PLAN, 'no size at all');
  // At the plan's size the rate is the plan's. At a smaller size it is the fee over that size, and not the plan's.
  refused({ ...PLAN, rate: '2.01 sat/vB' }, PLAN, 'the plan\'s size at another rate');
  refused({ ...PLAN, size: '140 vB' }, PLAN, 'a vbyte less at the plan\'s rate');
  refused({ ...PLAN, size: '140 vB', rate: '2.02 sat/vB' }, PLAN, 'a vbyte less at a rate that is not the fee over the size');
  refused({ ...PLAN, size: '140 vB', rate: '2.01' }, PLAN, 'a rate with no unit');
  refused({ ...ALL, size: '109 vB', rate: '2.01 sat/vB' }, ALL, '220 sats over 109 vbytes is 2.02 sat/vB');
});

test('payments signed by the wallet\'s own code: each passes the check, none is larger than its plan, and one that comes out a vbyte smaller shows the plan\'s fee at a higher rate', async () => {
  // The harness's test wallet, paid one coin of the faucet's size by a stand-in network: fixed words and a
  // fixed coin, so every payment below is signed the same way in every run.
  const account = accountFromMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about').key;
  const origin = makeFakeOrigin({ clock: () => 1_800_000_000_000 });
  origin.fund(deriveAddress(account, 0, 0).address, 100_000n);
  const state = await scanWallet(account, new Esplora('http://origin.test/esplora', origin.fetch));

  // One payment after another, each a sat more than the last, until a signature comes out short. About
  // one in 128 does, so the limit is far out of reach: it is there so that the loop ends.
  let short: { plan: Figures; review: Figures; bytes: number } | null = null;
  let tried = 0;
  /** The lengths in bytes, witnesses and all, of the payments that came out at their plan's size. */
  const whole = new Set<number>();
  for (let more = 0n; more < 5_000n && short === null; more += 1n) {
    const request = { to: SOMEONE, amount: 30_000n + more, feeRate: 2n };
    const planned = planPayment(account, state, request);
    assert.ok(planned.ok);
    const signed = signPayment(account, state, request);
    tried += 1;
    assert.equal(signed.inputs.length, 1);
    const paid = signed.outputs.find((output) => !output.isChange);
    const change = signed.outputs.find((output) => output.isChange);
    assert.ok(paid);
    const plan = figures({ to: request.to, amount: planned.amount, fee: planned.fee, vsize: planned.vsize, feeRate: planned.feeRate, change: planned.change });
    const review = figures({ to: paid.address, amount: paid.amount, fee: signed.fee, vsize: signed.vsize, feeRate: signed.feeRate, change: change?.amount ?? null });
    // Every one of them is what the check lets pass, and none is larger than planned.
    assertSignedAsPlanned(review, plan);
    assert.ok(signed.vsize <= planned.vsize, `${request.amount} sats: signed at ${signed.vsize} vB, planned at ${planned.vsize}`);
    if (signed.vsize === planned.vsize) {
      assert.deepEqual(review, plan, `${request.amount} sats`);
      whole.add(bytesOf(signed));
    } else short = { plan, review, bytes: bytesOf(signed) };
  }
  assert.ok(short !== null, `none of ${tried} payments came out smaller than its plan`);

  // The one that came out smaller: a vbyte under its plan, with the plan's fee, so at a higher rate. Held to
  // the plan figure for figure, as a journey once held it, this payment fails, and there is nothing wrong with it.
  const { plan, review } = short;
  assert.deepEqual([plan.size, plan.rate, plan.fee], ['141 vB', '2 sat/vB', '282 practice sats']);
  assert.deepEqual([review.size, review.rate, review.fee], ['140 vB', '2.01 sat/vB', '282 practice sats']);
  assert.deepEqual({ ...review, size: plan.size, rate: plan.rate }, plan, 'nothing else differs');
  assert.notDeepEqual(review, plan);
  // What made it smaller is one byte: every payment at its plan's size is of one length, and this one is
  // a byte under it. With one coin in, that byte is the one that takes the size down a whole vbyte.
  assert.equal(whole.size, 1, `the payments at their plan's size are ${[...whole].join(', ')} bytes long`);
  assert.equal(short.bytes, [...whole][0]! - 1);
});

test('a payment of two coins with a signature a byte short keeps its plan\'s size: its review is the plan, figure for figure', async () => {
  // The same wallet with two coins, and payments that take both. The byte a short signature saves is a
  // quarter of a vbyte, and the size of such a payment is the same whole number of vbytes with or without
  // it. So it comes out at its plan's size, where a payment of one coin comes out a vbyte under it: the
  // other case, for the sentence on it at the top of this file.
  const account = accountFromMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about').key;
  const origin = makeFakeOrigin({ clock: () => 1_800_000_000_000 });
  origin.fund(deriveAddress(account, 0, 0).address, 100_000n);
  origin.fund(deriveAddress(account, 0, 1).address, 100_000n);
  const state = await scanWallet(account, new Esplora('http://origin.test/esplora', origin.fetch));

  // One payment after another until one is shorter in bytes than those before it: a short signature.
  // About one payment in 64 has one, among its two.
  /** The lengths in bytes, witnesses and all, of the payments before that one. */
  const whole = new Set<number>();
  let short: { bytes: number; signed: number; planned: number } | null = null;
  let tried = 0;
  for (let more = 0n; more < 5_000n && short === null; more += 1n) {
    const request = { to: SOMEONE, amount: 150_000n + more, feeRate: 2n };
    const planned = planPayment(account, state, request);
    assert.ok(planned.ok);
    const signed = signPayment(account, state, request);
    tried += 1;
    assert.equal(signed.inputs.length, 2);
    const paid = signed.outputs.find((output) => !output.isChange);
    const change = signed.outputs.find((output) => output.isChange);
    assert.ok(paid);
    const plan = figures({ to: request.to, amount: planned.amount, fee: planned.fee, vsize: planned.vsize, feeRate: planned.feeRate, change: planned.change });
    const review = figures({ to: paid.address, amount: paid.amount, fee: signed.fee, vsize: signed.vsize, feeRate: signed.feeRate, change: change?.amount ?? null });
    assertSignedAsPlanned(review, plan);
    // Signed at full length or a byte short, the size is the plan's, and the review the plan to the letter.
    assert.equal(signed.vsize, planned.vsize, `${request.amount} sats, ${bytesOf(signed)} bytes`);
    assert.deepEqual(review, plan, `${request.amount} sats`);
    if (whole.size > 0 && bytesOf(signed) < Math.max(...whole)) short = { bytes: bytesOf(signed), signed: signed.vsize, planned: planned.vsize };
    else whole.add(bytesOf(signed));
  }
  assert.ok(short !== null, `none of ${tried} payments was signed shorter than the others`);
  // The payments before it were all of one length, both signatures whole. This one is a byte under that
  // length, and the same size in vbytes as its plan.
  assert.equal(whole.size, 1, `the payments before it are ${[...whole].join(', ')} bytes long`);
  assert.deepEqual(short, { bytes: [...whole][0]! - 1, signed: 208, planned: 208 });
});
