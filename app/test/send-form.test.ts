// What the Send form makes of what was typed into it (src/screens/send/form.ts):
// which kind of address the "To" field holds, what a payment link fills in,
// which amounts and fee rates the form takes, the request the three fields
// stand for, what the wallet can spend, and a signed payment's own figures.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accountFromMnemonic,
  deriveAddress,
  ownAddresses,
  planPayment,
  signPayment,
  viewPayment,
  watchOnlyAccount,
  type Coin,
  type WalletState,
} from '@learnbitcoin/practice-wallet';
import {
  FEE_RATE,
  factsOf,
  fundsOf,
  paysOwn,
  readAmount,
  readFee,
  readLink,
  readTo,
  requestOf,
  type AmountRead,
  type FeeRead,
  type ToRead,
} from '../src/screens/send/form.ts';
import { strings } from '../src/strings/index.ts';

const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ACCOUNT = accountFromMnemonic(WORDS);
const WATCH = watchOnlyAccount(ACCOUNT.xpub);

/** A practice address, and the same key hash as two other networks write it (the example key of BIP173). */
const PRACTICE = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const TESTNET = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const MAINNET = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

/** A wallet with these coins: `chain` 1 is the change chain, `height` null is unconfirmed. */
function walletWith(coins: { value: bigint; chain?: 0 | 1; height?: number | null }[]): WalletState {
  const made: Coin[] = coins.map(({ value, chain = 0, height = 101 }, index) => {
    const own = deriveAddress(WATCH, chain, index);
    return {
      txid: (0xab + index).toString(16).repeat(32),
      vout: 0,
      value,
      status: height === null ? { confirmed: false } : { confirmed: true, block_height: height },
      chain,
      index,
      address: own.address,
      script: own.script,
    };
  });
  return {
    receive: [],
    change: [],
    coins: made,
    nextReceiveIndex: coins.length,
    nextChangeIndex: 0,
    confirmed: made.reduce((sum, coin) => (coin.status.confirmed ? sum + coin.value : sum), 0n),
    unconfirmed: made.reduce((sum, coin) => (coin.status.confirmed ? sum : sum + coin.value), 0n),
  };
}

// -- the address ------------------------------------------------------------------

test('readTo: nothing typed is not an error', () => {
  assert.deepEqual(readTo(''), { kind: 'empty' });
  assert.deepEqual(readTo('  \n'), { kind: 'empty' });
});

test('readTo: a practice address is fine, in its tidy spelling', () => {
  assert.deepEqual(readTo(PRACTICE), { kind: 'practice', address: PRACTICE });
  // Spaces around it and capitals (as a QR code carries an address) are tidied away.
  assert.deepEqual(readTo(`  ${PRACTICE.toUpperCase()} `), { kind: 'practice', address: PRACTICE });
  // The oldest kind of address, which the practice network shares with testnet.
  assert.equal(readTo('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn').kind, 'practice');
});

test('readTo: a tb1 address is the same address in another spelling, and comes with its practice spelling', () => {
  assert.deepEqual(readTo(TESTNET), { kind: 'other-test-network', practiceAddress: PRACTICE });
});

test("readTo: an address of Bitcoin's real network is told apart from text that is no address", () => {
  assert.deepEqual(readTo(MAINNET), { kind: 'mainnet' });
  assert.deepEqual(readTo('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), { kind: 'mainnet' });
  for (const text of ['hello', 'bcrt1', PRACTICE.slice(0, -1), `${PRACTICE.slice(0, -1)}x`, '100,000']) {
    assert.deepEqual(readTo(text), { kind: 'invalid' }, text);
  }
});

test('readTo: a payment link is read for the address it carries', () => {
  assert.deepEqual(readTo(`bitcoin:${PRACTICE}?amount=0.001`), { kind: 'practice', address: PRACTICE });
  assert.deepEqual(readTo(`BITCOIN:${PRACTICE}`), { kind: 'practice', address: PRACTICE });
  assert.deepEqual(readTo(`bitcoin:${TESTNET}?amount=0.001`), { kind: 'other-test-network', practiceAddress: PRACTICE });
  assert.deepEqual(readTo(`bitcoin:${MAINNET}`), { kind: 'mainnet' });
  // A link that insists on something this wallet does not know is not followed at all.
  assert.deepEqual(readTo(`bitcoin:${PRACTICE}?req-thing=1`), { kind: 'invalid' });
});

test('readLink: a link fills in its address and its amount, written as the amount field writes it', () => {
  assert.equal(readLink(PRACTICE), null);
  assert.equal(readLink(''), null);
  assert.deepEqual(readLink(`bitcoin:${PRACTICE}?amount=0.001`), { to: PRACTICE, amount: '100,000' });
  assert.deepEqual(readLink(` bitcoin:${PRACTICE.toUpperCase()}?label=shop&amount=0.00025 `), { to: PRACTICE, amount: '25,000' });
  assert.deepEqual(readLink(`bitcoin:${PRACTICE}?amount=1`), { to: PRACTICE, amount: '100,000,000' });
  // No amount, an amount of nothing, two amounts that contradict each other: the amount field is left alone.
  assert.deepEqual(readLink(`bitcoin:${PRACTICE}`), { to: PRACTICE, amount: null });
  assert.deepEqual(readLink(`bitcoin:${PRACTICE}?amount=0`), { to: PRACTICE, amount: null });
  assert.deepEqual(readLink(`bitcoin:${PRACTICE}?amount=0.1&amount=0.2`), { to: PRACTICE, amount: null });
});

test('readLink: the field keeps a link to another network as typed, and a broken link fills in nothing', () => {
  // The amount still comes over: the reader is offered the practice spelling next.
  assert.deepEqual(readLink(`bitcoin:${TESTNET}?amount=0.0003`), { to: null, amount: '30,000' });
  assert.deepEqual(readLink(`bitcoin:${MAINNET}?amount=0.0003`), { to: null, amount: '30,000' });
  assert.deepEqual(readLink('bitcoin:nonsense?amount=0.0003'), { to: null, amount: null });
  assert.deepEqual(readLink(`bitcoin:${PRACTICE}?amount=0.0003&req-thing=1`), { to: null, amount: null });
});

// -- the amount -------------------------------------------------------------------

test('readAmount: whole sats, with commas only where thousands are grouped', () => {
  assert.deepEqual(readAmount('', false), { kind: 'empty' });
  assert.deepEqual(readAmount('25000', false), { kind: 'sats', sats: 25_000n });
  assert.deepEqual(readAmount(' 25,000 ', false), { kind: 'sats', sats: 25_000n });
  assert.deepEqual(readAmount('0', false), { kind: 'sats', sats: 0n });
  for (const text of ['2,50', 'abc', '-5', '1 000', '1e3', '25,000 sats']) {
    assert.deepEqual(readAmount(text, false), { kind: 'invalid' }, text);
  }
});

test('readAmount: a period is refused for its own reason, never read as thousands or as a fraction', () => {
  for (const text of ['0.001', '25.000', '1.', '.5', '1,000.50']) {
    assert.deepEqual(readAmount(text, false), { kind: 'period' }, text);
  }
});

test('readAmount: with "Send all" on, the field is not read', () => {
  for (const text of ['', '25,000', '0.5', 'abc']) assert.deepEqual(readAmount(text, true), { kind: 'all' }, text);
});

// -- the fee rate -----------------------------------------------------------------

test('readFee: whole numbers from 1 to 1,000, and 2 to start with', () => {
  assert.deepEqual(FEE_RATE, { min: 1n, max: 1_000n, start: 2n });
  assert.deepEqual(readFee('2'), { kind: 'rate', rate: 2n });
  assert.deepEqual(readFee('1'), { kind: 'rate', rate: 1n });
  assert.deepEqual(readFee('1000'), { kind: 'rate', rate: 1_000n });
  assert.deepEqual(readFee('1,000'), { kind: 'rate', rate: 1_000n });
  assert.deepEqual(readFee(String(FEE_RATE.start)), { kind: 'rate', rate: FEE_RATE.start });
});

test('readFee: each way a fee rate can be wrong has its own answer', () => {
  assert.deepEqual(readFee('0'), { kind: 'low' });
  assert.deepEqual(readFee('1001'), { kind: 'high' });
  assert.deepEqual(readFee('1,001'), { kind: 'high' });
  assert.deepEqual(readFee('999999999999999999999'), { kind: 'high' });
  assert.deepEqual(readFee(''), { kind: 'empty' });
  for (const text of ['0.5', '2.5', '-1', 'two', '2 sat/vB']) assert.deepEqual(readFee(text), { kind: 'not-whole' }, text);
});

// -- the request ------------------------------------------------------------------

test('requestOf: a request only when all three fields are good', () => {
  const to: ToRead = { kind: 'practice', address: PRACTICE };
  const sats: AmountRead = { kind: 'sats', sats: 30_000n };
  const rate: FeeRead = { kind: 'rate', rate: 2n };
  assert.deepEqual(requestOf(to, sats, rate), { to: PRACTICE, amount: 30_000n, feeRate: 2n });
  assert.deepEqual(requestOf(to, { kind: 'all' }, rate), { to: PRACTICE, amount: 'all', feeRate: 2n });

  const badTo: ToRead[] = [{ kind: 'empty' }, { kind: 'other-test-network', practiceAddress: PRACTICE }, { kind: 'mainnet' }, { kind: 'invalid' }];
  for (const each of badTo) assert.equal(requestOf(each, sats, rate), null, each.kind);
  const badAmount: AmountRead[] = [{ kind: 'empty' }, { kind: 'period' }, { kind: 'invalid' }];
  for (const each of badAmount) assert.equal(requestOf(to, each, rate), null, each.kind);
  const badFee: FeeRead[] = [{ kind: 'empty' }, { kind: 'low' }, { kind: 'high' }, { kind: 'not-whole' }];
  for (const each of badFee) assert.equal(requestOf(to, sats, each), null, each.kind);
});

test('requestOf: the amount goes to the planner as typed, never cut down to what "Send all" would deliver', () => {
  // The faucet's coin beside five small ones, at 250 sat/vB: "Send all" would
  // spend the small coins too and cannot be made, while 50,000 sats from the
  // large coin go through. A form that capped the amount would send nothing.
  const state = walletWith([{ value: 100_000n }, { value: 300n }, { value: 310n }, { value: 320n }, { value: 330n }, { value: 340n }]);
  const request = requestOf(readTo(PRACTICE), readAmount('50,000', false), readFee('250'));
  assert.deepEqual(request, { to: PRACTICE, amount: 50_000n, feeRate: 250n });
  const plan = planPayment(WATCH, state, request!);
  assert.ok(plan.ok);
  assert.deepEqual([plan.amount, plan.maxSendable], [50_000n, 0n]);
});

test('requestOf: the form never asks for a plan the planner would refuse for the address or the fee rate', () => {
  // Those two are the form's own checks. Whatever it does hand over, the
  // planner answers for the amount or the coins alone.
  const state = walletWith([{ value: 100_000n }]);
  const texts = { to: [PRACTICE, TESTNET, MAINNET, 'hello', ''], amount: ['0', '293', '294', '99,000', '100,000', '1.5', ''], fee: ['0', '1', '2', '1,000', '1,001', 'x'] };
  let asked = 0;
  for (const to of texts.to) {
    for (const amount of texts.amount) {
      for (const fee of texts.fee) {
        const request = requestOf(readTo(to), readAmount(amount, false), readFee(fee));
        if (request === null) continue;
        asked += 1;
        const plan = planPayment(WATCH, state, request);
        if (!plan.ok) assert.ok(plan.reason !== 'bad-address' && plan.reason !== 'bad-fee', `${to} ${amount} ${fee}: ${plan.reason}`);
      }
    }
  }
  // One good address, five readable amounts, three good fee rates.
  assert.equal(asked, 15);
});

// -- what can be spent ------------------------------------------------------------

test('fundsOf: confirmed coins and own unconfirmed change can be spent; an unconfirmed coin somebody sent cannot yet', () => {
  const state = walletWith([
    { value: 100_000n },
    { value: 40_000n },
    { value: 2_500n, height: null },
    { value: 18_500n, chain: 1, height: null },
  ]);
  assert.deepEqual(fundsOf(state), { coins: 4, spendable: 158_500n, waiting: 2_500n });
  assert.deepEqual(fundsOf(walletWith([])), { coins: 0, spendable: 0n, waiting: 0n });
  assert.deepEqual(fundsOf(walletWith([{ value: 100_000n, height: null }])), { coins: 1, spendable: 0n, waiting: 100_000n });
});

test('fundsOf: what it calls spendable is what the planner will spend', () => {
  const state = walletWith([{ value: 100_000n }, { value: 2_500n, height: null }, { value: 18_500n, chain: 1, height: null }]);
  const all = planPayment(WATCH, state, { to: PRACTICE, amount: 'all', feeRate: 2n });
  assert.ok(all.ok);
  // "Send all" delivers the spendable coins less the fee, and leaves the waiting coin where it is.
  assert.equal(all.amount + all.fee, fundsOf(state).spendable);
  assert.equal(all.inputs.length, 2);
});

// -- a signed payment ---------------------------------------------------------------

test('factsOf: the figures of the signed payment are the ones its plan gave', () => {
  const state = walletWith([{ value: 100_000n }, { value: 40_000n }]);
  for (const amount of [30_000n, 'all'] as const) {
    const request = { to: PRACTICE, amount, feeRate: 2n };
    const plan = planPayment(WATCH, state, request);
    assert.ok(plan.ok);
    const facts = factsOf(signPayment(ACCOUNT.key, state, request));
    assert.deepEqual(facts, { to: PRACTICE, amount: plan.amount, fee: plan.fee, change: plan.change, total: plan.amount + plan.fee });
  }
  // With change the total and the change add up to the coins spent; "Send all" has no change.
  const paid = signPayment(ACCOUNT.key, state, { to: PRACTICE, amount: 30_000n, feeRate: 2n });
  const withChange = factsOf(paid);
  assert.equal(withChange!.total + withChange!.change!, paid.inputs.reduce((sum, coin) => sum + coin.value, 0n));
  assert.equal(factsOf(signPayment(ACCOUNT.key, state, { to: PRACTICE, amount: 'all', feeRate: 2n }))!.change, null);
});

test('factsOf: something with no payment output is not one of the form\'s payments', () => {
  const state = walletWith([{ value: 100_000n }]);
  const payment = signPayment(ACCOUNT.key, state, { to: PRACTICE, amount: 30_000n, feeRate: 2n });
  assert.equal(factsOf({ ...payment, outputs: payment.outputs.filter((output) => output.isChange) }), null);
});

test('paysOwn: a payment to one of the wallet\'s own addresses comes back, and only the fee leaves', () => {
  const state = walletWith([{ value: 100_000n }, { value: 40_000n }]);
  const sign = (to: string, amount: bigint | 'all') => {
    const payment = signPayment(ACCOUNT.key, state, { to, amount, feeRate: 2n });
    return { payment, view: viewPayment(payment, ownAddresses(state)) };
  };
  // Somebody else's address: the amount leaves.
  const away = sign(PRACTICE, 30_000n);
  assert.equal(paysOwn(away.payment, away.view), false);
  assert.equal(away.view.net, -(30_000n + away.payment.fee));

  // The address of one of the wallet's coins, as the Coins screen shows it.
  const own = state.coins[1]!.address;
  for (const amount of [30_000n, 'all'] as const) {
    const back = sign(own, amount);
    assert.equal(paysOwn(back.payment, back.view), true, String(amount));
    // What the wallet is out of is the fee alone, whatever "amount and fee together" comes to.
    assert.equal(back.view.net, -back.payment.fee, String(amount));
    assert.ok(factsOf(back.payment)!.total > back.payment.fee);
  }
  // The row that adds the amount and the fee is named for what it is, and never says that the sum leaves the wallet.
  for (const lang of ['en', 'es'] as const) {
    assert.doesNotMatch(strings.send[lang].planTotal, /leav|sale|deja/i, lang);
    assert.match(strings.send[lang].toOwn, lang === 'en' ? /only the fee leaves the wallet\.$/ : /solo la comisión sale de la billetera\.$/);
  }
  assert.equal(strings.send.en.planTotal, 'Amount and fee together');

  // Something that is no payment of the form's pays nobody.
  assert.equal(paysOwn({ ...away.payment, outputs: away.payment.outputs.filter((output) => output.isChange) }, away.view), false);
});
