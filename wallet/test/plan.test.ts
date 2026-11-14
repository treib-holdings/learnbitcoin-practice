import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HDKey } from '@scure/bip32';
import { bech32, bech32m, createBase58check, hex } from '@scure/base';
import { Transaction } from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  ACCOUNT_PATH,
  InsufficientFundsError,
  RBF_SEQUENCE,
  REGTEST,
  TEST_VERSIONS,
  accountFromMnemonic,
  addressScript,
  buildPayment,
  checkAddress,
  deriveAddress,
  dustLimit,
  planPayment,
  signPayment,
  watchOnlyAccount,
  type Coin,
  type PaymentPlan,
  type PaymentRequest,
  type SelectionStrategy,
  type SignedPayment,
  type WalletState,
} from '../src/index.ts';
import { V, coinAt, copyOf, seeded, stateOf } from './helpers.ts';

const account = accountFromMnemonic(V.abandon.mnemonic).key;
const watch = watchOnlyAccount(V.abandon.xpub);
const recipient = V.prf.wallet.receive[0] as string;
const base58check = createBase58check(sha256);

const TAPROOT = bech32m.encode('bcrt', [1, ...bech32m.toWords(new Uint8Array(32).fill(0x22))]);
const P2WSH = bech32.encode('bcrt', [0, ...bech32.toWords(new Uint8Array(32).fill(0x11))]);
const P2PKH = 'mkpZhYtJu2r87Js3pDiWJDmPte2NRZ8bJV';
const P2SH = '2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2';

const key = (c: { txid: string; vout: number }) => `${c.txid}:${c.vout}`;
const total = (coins: Coin[]) => coins.reduce((s, c) => s + c.value, 0n);
const spendable = (c: Coin) => c.status.confirmed || c.chain === 1;

/** The plan, which the test then expects to be a yes. */
function planned(acct: HDKey, state: WalletState, req: PaymentRequest): Extract<PaymentPlan, { ok: true }> {
  const plan = planPayment(acct, state, req);
  assert.ok(plan.ok, `expected a plan, got ${JSON.stringify(plan, (_, v) => (typeof v === 'bigint' ? `${v}` : v))}`);
  return plan;
}

/** The refusal, which the test then expects to be a no. */
function refused(acct: HDKey, state: WalletState, req: PaymentRequest): Extract<PaymentPlan, { ok: false }> {
  const plan = planPayment(acct, state, req);
  assert.ok(!plan.ok, 'expected a refusal');
  return plan;
}

/**
 * The weight of a transaction, worked out here a second time and in another
 * way: the bytes without signatures, counted four times, then the witnesses.
 * `outputBytes` is the total length of the output scripts. A signature is 71
 * bytes as this wallet signs; the library's coin selection allows 72 when it
 * prices a payment.
 */
function weightOf(inputs: number, outputs: number, outputBytes: number, signature = 71): number {
  // The count of inputs takes 1 byte up to 252 inputs, then 3.
  const stripped = 4 + (inputs < 253 ? 1 : 3) + inputs * (32 + 4 + 1 + 4) + 1 + outputs * (8 + 1) + outputBytes + 4;
  const witnesses = 2 + inputs * (1 + (1 + signature) + (1 + 33));
  return stripped * 4 + witnesses;
}

/** Its size in vbytes: a quarter of the weight, rounded up. */
function sizeOf(inputs: number, outputs: number, outputBytes: number, signature = 71): number {
  return Math.ceil(weightOf(inputs, outputs, outputBytes, signature) / 4);
}

/** Everything that must be true of a signed payment and the plan it came from. */
function checkAgainstPlan(acct: HDKey, state: WalletState, req: PaymentRequest, plan: Extract<PaymentPlan, { ok: true }>, p: SignedPayment): void {
  // The same coins, in the same order, and the same fee.
  assert.deepEqual(p.inputs.map(key), plan.inputs.map(key));
  assert.equal(p.fee, plan.fee);
  assert.equal(total(p.inputs) - p.outputs.reduce((s, o) => s + o.amount, 0n), p.fee);

  // One output for the recipient, and change exactly when the plan said so.
  const to = checkAddress(req.to);
  assert.equal(to.kind, 'practice');
  const pay = p.outputs.filter((o) => !o.isChange);
  const change = p.outputs.filter((o) => o.isChange);
  assert.equal(pay.length, 1);
  assert.equal(pay[0]!.amount, plan.amount);
  if (to.kind === 'practice') assert.equal(pay[0]!.address, to.address);
  assert.equal(change.length, plan.change === null ? 0 : 1);
  assert.equal(change[0]?.amount ?? null, plan.change);
  assert.equal(p.changeIndex, plan.change === null ? null : state.nextChangeIndex);
  if (change[0]) {
    assert.equal(change[0].address, deriveAddress(acct, 1, state.nextChangeIndex).address, 'change goes to the next change address');
    assert.ok(change[0].amount >= dustLimit(change[0].address), 'change is never dust');
  }

  // Only spendable coins, each once, all from the wallet (or the coin-control list).
  const offered = new Set((req.coins ?? state.coins).filter(spendable).map(key));
  assert.equal(new Set(p.inputs.map(key)).size, p.inputs.length);
  for (const c of p.inputs) assert.ok(offered.has(key(c)), 'spends a coin that was not on offer');

  // The signed bytes say the same thing as the summary around them.
  const tx = Transaction.fromRaw(hex.decode(p.hex), { allowUnknownOutputs: true });

  // The planned size is the real size, unless a signature came out shorter
  // than the usual 71 bytes. Every byte a signature saves is one weight unit,
  // and four weight units are a vbyte: so the payment is then a vbyte or two
  // smaller, never larger, and the real fee rate is never under the one
  // asked for.
  const outputBytes = p.outputs.reduce((n, o) => n + addressScript(o.address).length, 0);
  const signatures = p.inputs.map((_, i) => tx.getInput(i).finalScriptWitness![0]!.length);
  assert.ok(signatures.every((length) => length <= 71), 'no signature is longer than 71 bytes');
  const saved = signatures.reduce((n, length) => n + (71 - length), 0);
  assert.equal(plan.vsize, sizeOf(p.inputs.length, p.outputs.length, outputBytes));
  assert.equal(p.vsize, Math.ceil((weightOf(p.inputs.length, p.outputs.length, outputBytes) - saved) / 4), `${saved} bytes of signature saved`);
  // Without its witnesses no payment is under 65 bytes: Bitcoin Core relays nothing smaller.
  assert.ok(tx.toBytes(true, false).length >= 65, 'too small a transaction to relay');
  assert.equal(p.feeRate, Number(p.fee) / p.vsize);
  assert.equal(plan.feeRate, Number(plan.fee) / plan.vsize);
  assert.ok(p.feeRate >= Number(req.feeRate), `real fee rate ${p.feeRate} is under the requested ${req.feeRate}`);
  // With change, the fee is the rate times the size the library allowed for: one spare byte per signature.
  if (plan.change !== null) assert.equal(plan.fee, req.feeRate * BigInt(sizeOf(p.inputs.length, 2, outputBytes, 72)));
  assert.equal(tx.id, p.txid);
  assert.equal(tx.vsize, p.vsize);
  assert.equal(tx.inputsLength, p.inputs.length);
  assert.equal(tx.outputsLength, p.outputs.length);
  p.inputs.forEach((c, i) => {
    const input = tx.getInput(i);
    assert.equal(hex.encode(input.txid!), c.txid);
    assert.equal(input.index, c.vout);
    assert.equal(input.sequence, RBF_SEQUENCE, 'every input signals replace-by-fee');
  });
  p.outputs.forEach((o, i) => {
    const output = tx.getOutput(i);
    assert.equal(o.vout, i);
    assert.equal(output.amount, o.amount);
    assert.deepEqual(output.script, addressScript(o.address));
  });

  // BIP69 order: inputs by transaction ID then output number, outputs by amount.
  for (let i = 1; i < p.inputs.length; i++) {
    const [a, b] = [p.inputs[i - 1]!, p.inputs[i]!];
    assert.ok(a.txid < b.txid || (a.txid === b.txid && a.vout < b.vout), 'inputs are in order');
  }
  for (let i = 1; i < p.outputs.length; i++) assert.ok(p.outputs[i - 1]!.amount <= p.outputs[i]!.amount, 'outputs are in order');
}

// -- one payment, step by step -------------------------------------------------

test('a plan needs no private key, and signing makes exactly the planned payment', () => {
  const state = stateOf([coinAt(account, 0, 0, 50_000n, { txid: 'aa'.repeat(32) }), coinAt(account, 0, 1, 30_000n, { txid: 'bb'.repeat(32) })]);
  const req: PaymentRequest = { to: recipient, amount: 60_000n, feeRate: 2n };

  const plan = planned(watch, state, req);
  assert.deepEqual(plan, planPayment(account, state, req), 'the private key changes nothing');
  assert.equal(plan.amount, 60_000n);
  assert.equal(plan.inputs.length, 2);
  // Two inputs and two outputs sign at 208 vB. The fee allows one spare byte
  // per signature, which makes it 209 vB at 2 sat/vB: 418 sats.
  assert.equal(plan.vsize, 208);
  assert.equal(plan.fee, 418n);
  assert.equal(plan.feeRate, 418 / 208);
  assert.equal(plan.change, 80_000n - 60_000n - 418n);
  // Sending everything would take both coins and one output: 177 vB.
  assert.equal(plan.maxSendable, 80_000n - 2n * 177n);

  assert.throws(() => signPayment(watch, state, req), /watch-only/);
  const p = signPayment(account, state, req);
  checkAgainstPlan(account, state, req, plan, p);
  assert.deepEqual([p.fee, p.vsize, p.feeRate], [plan.fee, plan.vsize, plan.feeRate], 'fee, size and fee rate are as planned');
  assert.deepEqual(p.outputs, [
    { address: V.abandon.change[0], amount: 19_582n, isChange: true, vout: 0 },
    { address: recipient, amount: 60_000n, isChange: false, vout: 1 },
  ]);
});

test('buildPayment is signPayment under its first name, and still makes the frozen payment', () => {
  assert.equal(buildPayment, signPayment);
  // The transaction the first version of buildPayment made for this request,
  // byte for byte. Its code path is the one Bitcoin Core accepted in
  // tools/regtest-crosscheck.
  const frozen = V.payment;
  const coins = frozen.coins.map((c: { txid: string; vout: number; value: number; chain: 0 | 1; index: number }) =>
    coinAt(account, c.chain, c.index, BigInt(c.value), c),
  );
  const p = buildPayment(account, stateOf(coins), { to: frozen.to, amount: BigInt(frozen.amount), feeRate: BigInt(frozen.feeRate) });
  assert.equal(p.txid, frozen.txid);
  assert.equal(p.hex, frozen.hex);
});

// -- the property: plan and sign agree ------------------------------------------

const CASES = 300;

test(`planPayment and signPayment agree on ${CASES} wallets and requests from a seeded generator`, (t) => {
  const rnd = seeded(20261114);
  const seen = { ok: 0, all: 0, change: 0, noChange: 0, controlled: 0, shortSignature: 0 };
  const refusals = new Map<string, number>();
  const strategies: (SelectionStrategy | undefined)[] = [undefined, undefined, undefined, 'accumBiggest', 'accumSmallest', 'accumOldest', 'accumNewest', 'exactBiggest/accumSmallest', 'all'];

  for (let n = 0; n < CASES; n++) {
    // A wallet nobody has seen before, and a few coins for it.
    const acct = HDKey.fromMasterSeed(rnd.bytes(32), TEST_VERSIONS).derive(ACCOUNT_PATH);
    const coins: Coin[] = Array.from({ length: rnd.pick([0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6, 8]) }, () =>
      coinAt(acct, rnd.pick([0, 0, 1] as const), rnd.int(4), BigInt(rnd.pick([250, 700, 3_000, 20_000, 100_000, 100_000, 2_500_000]) + rnd.int(900)), {
        txid: hex.encode(rnd.bytes(32)),
        vout: rnd.int(3),
        confirmed: rnd.next() < 0.8,
      }),
    );
    const state = stateOf(coins, rnd.int(4));

    // A request: sometimes which coins, then where to, how fast and how much.
    const offered = rnd.next() < 0.15 ? coins.filter(() => rnd.next() < 0.6) : undefined;
    const pool = (offered ?? coins).filter(spendable);
    const other = HDKey.fromMasterSeed(rnd.bytes(32), TEST_VERSIONS).derive(ACCOUNT_PATH);
    const good = [
      deriveAddress(other, 0, rnd.int(3)).address,
      deriveAddress(other, 0, 0).address.toUpperCase(),
      bech32m.encode('bcrt', [1, ...bech32m.toWords(rnd.bytes(32))]),
      bech32.encode('bcrt', [0, ...bech32.toWords(rnd.bytes(32))]),
      bech32m.encode('bcrt', [2 + rnd.int(15), ...bech32m.toWords(rnd.bytes(2 + rnd.int(39)))]),
      base58check.encode(Uint8Array.from([REGTEST.pubKeyHash, ...rnd.bytes(20)])),
      base58check.encode(Uint8Array.from([REGTEST.scriptHash, ...rnd.bytes(20)])),
      deriveAddress(acct, 0, rnd.int(3)).address, // paying itself
      deriveAddress(acct, 1, state.nextChangeIndex).address, // even to its own next change address
    ];
    const bad = [bech32.encode('tb', [0, ...bech32.toWords(rnd.bytes(20))]), 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', ''];
    // The shortest address there is: a program of 2 bytes, which makes a
    // script of 4. One coin paid to it in full is the one payment that is
    // too small a transaction to relay. A wallet with a single coin to spend
    // is sent there half the time, or these cases would hardly ever meet it.
    const shortest = bech32m.encode('bcrt', [1 + rnd.int(16), ...bech32m.toWords(rnd.bytes(2))]);
    const to = pool.length === 1 && rnd.next() < 0.5 ? shortest : rnd.next() < 0.1 ? rnd.pick(bad) : rnd.pick(good);
    // Now and then a fee rate that is none: 0, or less than 0.
    const feeRate = rnd.next() < 0.04 ? BigInt(-rnd.int(3)) : BigInt(rnd.pick([1, 1, 2, 2, 2, 3, 5, 10, 25, 60, 150, 400, 1000]));

    // What the answer must be, worked out without the code under test.
    const check = checkAddress(to);
    const limit = check.kind === 'practice' ? dustLimit(check.address) : 294n;
    const scriptBytes = check.kind === 'practice' ? addressScript(check.address).length : 22;
    const sweepFee = feeRate * BigInt(sizeOf(pool.length, 1, scriptBytes));
    const swept = total(pool) - sweepFee;
    // What the coins reach when all of them are spent: nothing, if that
    // leaves less than the dust limit.
    const reach = swept >= limit ? swept : 0n;
    // "Send all" cannot be made then, and neither if its transaction is too
    // small to relay: one coin in and one output to a script of under 5
    // bytes are under 65 bytes.
    const tooSmall = pool.length === 1 && scriptBytes < 5;
    const most = tooSmall ? 0n : reach;
    // A coin that costs more to spend (68 vB) than it holds. "Send all" spends it anyway.
    const wasteful = pool.some((c) => c.value <= 68n * feeRate);

    const amount: bigint | 'all' = rnd.pick([
      'all' as const,
      'all' as const,
      BigInt(rnd.int(700)), // tiny: often dust
      (reach * BigInt(rnd.int(1001))) / 1000n, // anywhere up to what the coins reach
      (reach * BigInt(rnd.int(1001))) / 1000n,
      (reach * BigInt(rnd.int(1001))) / 1000n,
      (reach * BigInt(rnd.int(1001))) / 1000n,
      reach - BigInt(rnd.int(700)), // a leftover too small, or just big enough, for change
      reach - BigInt(rnd.int(700)),
      reach, // exactly that
      reach + 1n, // one sat more
      total(pool) + BigInt(rnd.int(500)), // more than the wallet holds
    ]);
    const req: PaymentRequest = { to, amount, feeRate, strategy: rnd.pick(strategies), ...(offered ? { coins: offered } : {}) };

    const before = copyOf(state);
    const plan = planPayment(watchOnlyAccount(acct.publicExtendedKey), state, req);
    assert.deepEqual(planPayment(acct, state, req), plan, 'the same plan with and without the private key');
    assert.deepEqual(planPayment(acct, state, req), plan, 'and the same plan every time');
    assert.deepEqual(state, before, 'planning changes nothing');

    if (!plan.ok) {
      refusals.set(plan.reason, (refusals.get(plan.reason) ?? 0) + 1);
      assert.throws(() => signPayment(acct, state, req), 'what cannot be planned cannot be signed');
      let reason: string;
      // The fee rate is looked at before anything else, and with none there is no "most" to quote.
      if (feeRate < 1n) reason = 'bad-fee';
      else if ((offered ?? coins).length === 0) reason = 'nothing-spendable';
      else if (pool.length === 0) reason = 'unconfirmed-only';
      // "bad-address" is said of every text that is no practice address, and of nothing else.
      else if (check.kind !== 'practice') reason = 'bad-address';
      else if ((amount === 'all' ? swept : amount) < limit) reason = 'below-dust';
      else if (plan.reason === 'too-small') {
        // A payment the coins cover, to a good address, is refused for one
        // reason only: it would be one coin, one output of under 5 bytes of
        // script and no change, which is too small a transaction to relay.
        // Which coins a payment takes is the wallet's choice, so what is
        // checked here is that such a payment was possible: one coin alone
        // covers it.
        const alone = feeRate * BigInt(sizeOf(1, 1, scriptBytes));
        assert.ok(scriptBytes < 5 && (amount === 'all' ? pool.length === 1 : pool.some((c) => c.value - alone >= amount)), 'a payment that is not too small was refused as one');
        reason = 'too-small';
      } else reason = 'too-much';
      assert.equal(plan.reason, reason);
      assert.equal(plan.maxSendable, reason === 'bad-fee' || pool.length === 0 ? 0n : most);
      assert.equal(plan.dust, reason === 'below-dust' ? limit : null);
      // "Too much" is only ever said of an amount above what send-all would deliver.
      if (reason === 'too-much') assert.ok(amount !== 'all' && amount > swept);
      continue;
    }

    assert.ok(feeRate >= 1n, 'a payment was planned at a fee rate under 1');
    const p = signPayment(acct, state, req);
    assert.deepEqual(state, before, 'signing changes nothing');
    checkAgainstPlan(acct, state, req, plan, p);
    assert.equal(plan.maxSendable, most);
    // More than send-all delivers can only be paid by leaving a wasteful coin
    // unspent, or with change where send-all would be too small to relay.
    if (plan.amount > most) assert.ok(wasteful || tooSmall, 'paid more than the most that can be sent');
    seen.ok++;
    if (offered) seen.controlled++;
    if (plan.change === null) seen.noChange++;
    else seen.change++;

    if (amount === 'all') {
      seen.all++;
      // Every spendable coin, one output, no change; the recipient gets the total minus the fee.
      assert.deepEqual(p.inputs.map(key).sort(), [...new Set(pool.map(key))].sort());
      assert.equal(p.outputs.length, 1);
      assert.equal(plan.change, null);
      assert.equal(p.fee, feeRate * BigInt(plan.vsize));
      assert.equal(p.outputs[0]!.amount, total(p.inputs) - p.fee);
      assert.equal(plan.amount, plan.maxSendable);
      assert.equal(plan.feeRate, Number(feeRate));
      // The real fee rate is the one asked for. A signature shorter than usual
      // makes the payment a vbyte smaller, which can only raise it by under 1%.
      if (p.vsize === plan.vsize) assert.equal(p.feeRate, Number(feeRate));
      else seen.shortSignature++;
      assert.ok(p.feeRate >= Number(feeRate) && p.feeRate <= Number(feeRate) * 1.01, `send all at ${feeRate} sat/vB paid ${p.feeRate}`);
    }
  }

  // The generator must have reached every branch, or the test proves less than it says.
  t.diagnostic(`${CASES} cases: ${JSON.stringify(seen)}, refused ${JSON.stringify(Object.fromEntries(refusals))}`);
  assert.ok(seen.ok >= 150, `only ${seen.ok} payments were signed`);
  assert.ok(seen.all >= 20 && seen.change >= 40 && seen.noChange >= 40 && seen.controlled >= 10, JSON.stringify(seen));
  const reasons = ['bad-fee', 'nothing-spendable', 'unconfirmed-only', 'bad-address', 'below-dust', 'too-much', 'too-small'];
  for (const reason of reasons) assert.ok((refusals.get(reason) ?? 0) >= 5, `${reason}: ${refusals.get(reason) ?? 0} cases`);
  // And no reason turned up that is not on the list.
  assert.deepEqual([...refusals.keys()].sort(), [...reasons].sort());
});

// -- which coins may be spent -----------------------------------------------------

test('spendable coins are confirmed coins and unconfirmed change, never an unconfirmed payment from outside', () => {
  const confirmed = coinAt(account, 0, 0, 40_000n, { txid: '01'.repeat(32) });
  const received = coinAt(account, 0, 1, 100_000n, { txid: '02'.repeat(32), confirmed: false });
  const ownChange = coinAt(account, 1, 0, 25_000n, { txid: '03'.repeat(32), confirmed: false });
  const req: PaymentRequest = { to: recipient, amount: 'all', feeRate: 1n };

  // Only an unconfirmed payment from outside: nothing can be sent until it confirms.
  assert.deepEqual(planPayment(watch, stateOf([received]), req), { ok: false, reason: 'unconfirmed-only', maxSendable: 0n, dust: null });
  assert.deepEqual(planPayment(watch, stateOf([received]), { ...req, amount: 5_000n }), { ok: false, reason: 'unconfirmed-only', maxSendable: 0n, dust: null });
  // No coins at all.
  assert.deepEqual(planPayment(watch, stateOf([]), req), { ok: false, reason: 'nothing-spendable', maxSendable: 0n, dust: null });

  // With all three, "send all" spends the confirmed coin and the change, and leaves the third alone.
  const state = stateOf([confirmed, received, ownChange], 1);
  const plan = planned(watch, state, req);
  assert.deepEqual(plan.inputs.map((c) => c.txid).sort(), [confirmed.txid, ownChange.txid]);
  assert.equal(plan.amount, 65_000n - 177n);
  assert.equal(plan.maxSendable, 65_000n - 177n);
  // An amount only the unconfirmed 100,000 could cover is too much, and the answer says what is not.
  assert.deepEqual(planPayment(watch, state, { ...req, amount: 80_000n }), { ok: false, reason: 'too-much', maxSendable: 64_823n, dust: null });

  // Coin control follows the same rule.
  assert.equal(refused(watch, state, { ...req, coins: [received] }).reason, 'unconfirmed-only');
  assert.equal(refused(watch, state, { ...req, coins: [] }).reason, 'nothing-spendable');
  assert.deepEqual(planned(watch, state, { ...req, coins: [received, ownChange] }).inputs, [ownChange]);
  // A coin listed twice is spent once.
  assert.deepEqual(planned(watch, state, { ...req, coins: [confirmed, confirmed] }).inputs, [confirmed]);
});

// -- how much ---------------------------------------------------------------------

test('too-much: more than can be paid after the fee, with the most that can', () => {
  const state = stateOf([coinAt(account, 0, 0, 100_000n)]);
  // One input and one output make 110 vB, so at 1 sat/vB the most is 99,890.
  const most = 99_890n;
  assert.deepEqual(planPayment(watch, state, { to: recipient, amount: most + 1n, feeRate: 1n }), { ok: false, reason: 'too-much', maxSendable: most, dust: null });
  assert.deepEqual(planPayment(watch, state, { to: recipient, amount: 100_000n, feeRate: 1n }), { ok: false, reason: 'too-much', maxSendable: most, dust: null });
  assert.equal(refused(watch, state, { to: recipient, amount: 100_000n, feeRate: 10n }).maxSendable, 100_000n - 1_100n);
  // A taproot output is 12 bytes longer, so the most that fits is 12 sats less.
  assert.equal(refused(watch, state, { to: TAPROOT, amount: 100_000n, feeRate: 1n }).maxSendable, most - 12n);

  // Exactly the most is the same payment as "send all".
  const exact = planned(watch, state, { to: recipient, amount: most, feeRate: 1n });
  const all = planned(watch, state, { to: recipient, amount: 'all', feeRate: 1n });
  assert.deepEqual(exact, all);
  assert.deepEqual(all, { ok: true, amount: most, fee: 110n, vsize: 110, feeRate: 1, inputs: state.coins, change: null, maxSendable: most });
  assert.equal(signPayment(account, state, { to: recipient, amount: most, feeRate: 1n }).hex, signPayment(account, state, { to: recipient, amount: 'all', feeRate: 1n }).hex);
});

test('below-dust: 293 sats is refused and 294 accepted for P2WPKH; 329 and 330 for taproot and P2WSH', () => {
  const state = stateOf([coinAt(account, 0, 0, 100_000n)]);
  const cases: [string, string, bigint][] = [
    ['P2WPKH', recipient, 294n],
    ['taproot', TAPROOT, 330n],
    ['P2WSH', P2WSH, 330n],
    ['P2PKH', P2PKH, 546n],
    ['P2SH', P2SH, 540n],
  ];
  for (const [name, to, limit] of cases) {
    const under = refused(watch, state, { to, amount: limit - 1n, feeRate: 1n });
    assert.equal(under.reason, 'below-dust', name);
    assert.equal(under.dust, limit, name);
    assert.ok(under.maxSendable > 99_000n, 'the most that can be sent is still quoted');
    assert.throws(() => signPayment(account, state, { to, amount: limit - 1n, feeRate: 1n }), /dust/, name);

    const at = planned(watch, state, { to, amount: limit, feeRate: 1n });
    assert.equal(at.amount, limit, name);
    const p = signPayment(account, state, { to, amount: limit, feeRate: 1n });
    assert.deepEqual(p.outputs.find((o) => !o.isChange), { address: to, amount: limit, isChange: false, vout: 0 }, name);
  }
  // Nothing and less than nothing are below every limit.
  assert.deepEqual(planPayment(watch, state, { to: recipient, amount: 0n, feeRate: 1n }), { ok: false, reason: 'below-dust', maxSendable: 99_890n, dust: 294n });
  assert.equal(refused(watch, state, { to: recipient, amount: -5n, feeRate: 1n }).reason, 'below-dust');

  // "Send all" from a wallet so small that less than the limit is left after the fee.
  const small = stateOf([coinAt(account, 0, 0, 403n)]);
  assert.deepEqual(planPayment(watch, small, { to: recipient, amount: 'all', feeRate: 1n }), { ok: false, reason: 'below-dust', maxSendable: 0n, dust: 294n });
  assert.equal(planned(watch, stateOf([coinAt(account, 0, 0, 404n)]), { to: recipient, amount: 'all', feeRate: 1n }).amount, 294n);
  // The fee alone is more than the wallet holds.
  assert.deepEqual(planPayment(watch, small, { to: recipient, amount: 'all', feeRate: 50n }), { ok: false, reason: 'below-dust', maxSendable: 0n, dust: 294n });
  assert.deepEqual(planPayment(watch, small, { to: recipient, amount: 300n, feeRate: 1n }), { ok: false, reason: 'too-much', maxSendable: 0n, dust: null });
});

test('bad-address: anything checkAddress does not call practice', () => {
  const state = stateOf([coinAt(account, 0, 0, 100_000n)]);
  for (const to of ['tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', recipient.slice(0, -1), 'hello', '']) {
    assert.notEqual(checkAddress(to).kind, 'practice');
    for (const amount of [5_000n, 'all'] as const) {
      // With no address to size the output for, the most is quoted for an address like the wallet's own.
      assert.deepEqual(planPayment(watch, state, { to, amount, feeRate: 1n }), { ok: false, reason: 'bad-address', maxSendable: 99_890n, dust: null }, to);
      assert.throws(() => signPayment(account, state, { to, amount, feeRate: 1n }), /practice-network address/, to);
    }
  }
  // An empty wallet is said first: no address would help.
  assert.equal(refused(watch, stateOf([]), { to: 'hello', amount: 5_000n, feeRate: 1n }).reason, 'nothing-spendable');
  // And it is never said of a practice address, whatever else is wrong with
  // the payment. Pay-to-anchor, sent this one coin in full, would make a
  // transaction too small to relay: that has a reason of its own.
  assert.equal(refused(watch, state, { to: 'bcrt1pfeesnyr2tx', amount: 'all', feeRate: 1n }).reason, 'too-small');
  for (const to of [recipient, TAPROOT, P2WSH, P2PKH, P2SH, 'bcrt1pfeesnyr2tx']) {
    for (const amount of [-1n, 0n, 1n, 5_000n, 99_000n, 100_000n, 'all'] as const) {
      const plan = planPayment(watch, state, { to, amount, feeRate: 1n });
      assert.ok(plan.ok || plan.reason !== 'bad-address', `${to} ${amount}`);
    }
  }

  // An address in capitals or with spaces around it is the same address.
  const tidy = planned(watch, state, { to: recipient, amount: 5_000n, feeRate: 1n });
  assert.deepEqual(planned(watch, state, { to: ` ${recipient.toUpperCase()}\n`, amount: 5_000n, feeRate: 1n }), tidy);
  const p = signPayment(account, state, { to: ` ${recipient.toUpperCase()}\n`, amount: 5_000n, feeRate: 1n });
  assert.equal(p.outputs.find((o) => !o.isChange)!.address, recipient);
});

// -- send all -----------------------------------------------------------------------

test('send all: every spendable coin, one output, no change, and the fee rate that was asked for', () => {
  const values = [100_000n, 70_000n, 250_000n, 31_000n, 90_000n, 64_000n];
  let payments = 0;
  let smaller = 0;
  for (const to of [recipient, TAPROOT, P2PKH]) {
    for (let count = 1; count <= values.length; count++) {
      // Confirmed coins on the receive chain, and unconfirmed change in between: all spendable.
      const coins = values.slice(0, count).map((value, i) =>
        coinAt(account, i % 2 ? 1 : 0, i, value * 10n, { txid: (0x10 + i).toString(16).repeat(32), confirmed: i % 2 === 0 }),
      );
      const state = stateOf(coins, 2);
      for (const rate of [1n, 2n, 3n, 5n, 10n, 25n, 50n, 100n, 250n, 1000n]) {
        const req: PaymentRequest = { to, amount: 'all', feeRate: rate };
        const plan = planned(watch, state, req);
        const p = signPayment(account, state, req);
        checkAgainstPlan(account, state, req, plan, p);

        assert.equal(p.inputs.length, count, 'every coin is spent');
        assert.deepEqual(p.outputs, [{ address: to, amount: total(coins) - p.fee, isChange: false, vout: 0 }]);
        assert.equal(p.changeIndex, null);
        assert.equal(plan.change, null);
        assert.equal(plan.amount, total(coins) - plan.fee);
        assert.equal(plan.maxSendable, plan.amount);
        assert.equal(plan.fee, rate * BigInt(plan.vsize));
        assert.equal(plan.feeRate, Number(rate));
        // The real fee rate: at least what was asked, and at most 1% above it.
        assert.ok(p.feeRate >= Number(rate), `${count} coins at ${rate}: ${p.feeRate}`);
        assert.ok(p.feeRate <= Number(rate) * 1.01, `${count} coins at ${rate}: ${p.feeRate}`);
        // In fact it is exactly the rate whenever the payment has the planned size.
        payments++;
        if (p.vsize === plan.vsize) assert.equal(p.feeRate, Number(rate));
        else smaller++;
      }
    }
  }
  // About one signature in 128 is a byte shorter than the usual 71. In one of
  // these payments (five coins to the taproot address at 2 sat/vB) that
  // happens just where it makes the payment a vbyte smaller than planned: 392
  // instead of 393, so it pays 786 / 392 = 2.005 sat/vB. Signatures are
  // deterministic, so it is the same one on every run.
  assert.deepEqual([payments, smaller], [180, 1]);

  // The same fee over one vbyte less is a higher rate, by as much as the
  // payment is smaller: under 1% for these payments, the smallest of which
  // is 110 vbytes. At a high fee rate that is still several sat/vB. Here one
  // coin is sent in full at 1,000 sat/vB and its signature comes out at 70
  // bytes: planned at 110 vbytes, signed at 109, it pays 110,000 / 109 =
  // 1,009.17 sat/vB.
  const state = stateOf([coinAt(account, 0, 0, 1_136_000n, { txid: 'aa'.repeat(32) })]);
  const req: PaymentRequest = { to: recipient, amount: 'all', feeRate: 1000n };
  const plan = planned(watch, state, req);
  const p = signPayment(account, state, req);
  checkAgainstPlan(account, state, req, plan, p);
  assert.deepEqual([plan.fee, plan.vsize, plan.feeRate], [110_000n, 110, 1000]);
  assert.deepEqual([p.fee, p.vsize, p.feeRate], [110_000n, 109, 110_000 / 109]);
  assert.ok(p.feeRate > 1009 && p.feeRate <= 1000 * 1.01);
});

test('anything up to the most that can be sent is payable, and one sat more is too much', () => {
  // Two coins and one output sign at 177 vB, so at 100 sat/vB "send all" delivers 80,000 - 17,700.
  const state = stateOf([coinAt(account, 0, 0, 50_000n, { txid: 'aa'.repeat(32) }), coinAt(account, 0, 1, 30_000n, { txid: 'bb'.repeat(32) })]);
  const most = 62_300n;
  const all = planned(watch, state, { to: recipient, amount: 'all', feeRate: 100n });
  assert.deepEqual([all.amount, all.fee, all.vsize, all.maxSendable], [most, 17_700n, 177, most]);

  // Asking for exactly that amount is the same payment.
  const exact: PaymentRequest = { to: recipient, amount: most, feeRate: 100n };
  assert.deepEqual(planned(watch, state, exact), all);
  assert.equal(signPayment(account, state, exact).hex, signPayment(account, state, { ...exact, amount: 'all' }).hex);

  // A few sats less still takes both coins. There is no room for change, so those sats join the fee.
  const near: PaymentRequest = { to: recipient, amount: most - 50n, feeRate: 100n };
  const plan = planned(watch, state, near);
  assert.deepEqual([plan.inputs.length, plan.change, plan.fee, plan.vsize], [2, null, 17_750n, 177]);
  checkAgainstPlan(account, state, near, plan, signPayment(account, state, near));

  // And so it goes for every strategy: no amount up to the most is ever "too much".
  for (const strategy of ['default', 'accumBiggest', 'accumSmallest', 'accumOldest', 'accumNewest', 'exactSmallest/accumBiggest', 'all'] as const) {
    for (const amount of [most, most - 1n, most - 99n, most - 100n, most - 101n, most - 294n, 40_000n, 294n]) {
      const req: PaymentRequest = { to: recipient, amount, feeRate: 100n, strategy };
      const ok = planned(watch, state, req);
      assert.ok(Number(ok.fee) >= 100 * ok.vsize, `${strategy} ${amount}`);
      checkAgainstPlan(account, state, req, ok, signPayment(account, state, req));
    }
    assert.deepEqual(planPayment(watch, state, { to: recipient, amount: most + 1n, feeRate: 100n, strategy }), { ok: false, reason: 'too-much', maxSendable: most, dust: null });
  }
});

test('a coin that costs more to spend than it holds: "send all" spends it all the same, so a payment that leaves it can deliver more', () => {
  // An input adds 67 or 68 vbytes. At 700 sat/vB that costs about 47,000 sats,
  // more than the 39,718 sat coin is worth. The coins are the faucet's
  // 100,000 and the change of an earlier payment.
  const state = stateOf([coinAt(account, 0, 0, 100_000n, { txid: 'aa'.repeat(32) }), coinAt(account, 1, 0, 39_718n, { txid: 'bb'.repeat(32), confirmed: false })], 1);
  const all: PaymentRequest = { to: recipient, amount: 'all', feeRate: 700n };
  const sweep = planned(watch, state, all);
  // Both coins in 177 vbytes: 139,718 - 123,900.
  assert.deepEqual([sweep.inputs.length, sweep.vsize, sweep.fee, sweep.amount, sweep.maxSendable], [2, 177, 123_900n, 15_818n, 15_818n]);
  checkAgainstPlan(account, state, all, sweep, signPayment(account, state, all));

  // The large coin alone, in 110 vbytes, delivers 100,000 - 77,000: 7,182 sats more than "send all".
  const more: PaymentRequest = { to: recipient, amount: 23_000n, feeRate: 700n };
  const plan = planned(watch, state, more);
  assert.deepEqual([plan.inputs.length, plan.vsize, plan.fee, plan.change], [1, 110, 77_000n, null]);
  assert.deepEqual(plan.inputs.map((c) => c.value), [100_000n]);
  checkAgainstPlan(account, state, more, plan, signPayment(account, state, more));
  // maxSendable is what "send all" delivers, here as everywhere. In this corner it is not the most that can be sent ...
  assert.equal(plan.maxSendable, 15_818n);
  assert.ok(plan.amount > plan.maxSendable);
  // ... and a refusal quotes the same figure, though 23,000 can be paid.
  assert.deepEqual(planPayment(watch, state, { ...more, amount: 23_001n }), { ok: false, reason: 'too-much', maxSendable: 15_818n, dust: null });

  // At 1,000 sat/vB, sending all four of these coins takes 313 vbytes:
  // 313,000 sats, more than the 203,000 they hold. "Send all" cannot be
  // made, and maxSendable is 0. The 200,000 sat coin can still pay 90,000 by
  // itself.
  const small = stateOf([200_000n, 1_000n, 1_000n, 1_000n].map((value, i) => coinAt(account, 0, i, value, { txid: (0x21 + i).toString(16).repeat(32) })));
  const fast = { to: recipient, feeRate: 1000n };
  assert.deepEqual(planPayment(watch, small, { ...fast, amount: 'all' }), { ok: false, reason: 'below-dust', maxSendable: 0n, dust: 294n });
  const alone: PaymentRequest = { ...fast, amount: 90_000n };
  const paid = planned(watch, small, alone);
  assert.deepEqual([paid.inputs.length, paid.fee, paid.change, paid.maxSendable], [1, 110_000n, null, 0n]);
  checkAgainstPlan(account, small, alone, paid, signPayment(account, small, alone));
  assert.deepEqual(planPayment(watch, small, { ...fast, amount: 90_001n }), { ok: false, reason: 'too-much', maxSendable: 0n, dust: null });
});

test('a wallet with hundreds of coins: the planned size still holds when the input count needs three bytes', () => {
  // From 253 inputs on, the count at the front of the transaction is written in 3 bytes instead of 1.
  const coins = Array.from({ length: 253 }, (_, i) => coinAt(account, 0, i % 2, 4_000n + BigInt(i), { txid: (i + 1).toString(16).padStart(64, '0'), vout: i % 3 }));
  const state = stateOf(coins);
  const req: PaymentRequest = { to: recipient, amount: 'all', feeRate: 2n };
  const plan = planned(watch, state, req);
  assert.equal(plan.inputs.length, 253);
  // By hand: 10,416 bytes without witnesses (4 + 3 + 253 * 41 + 1 + 31 + 4) and
  // 27,073 of witnesses (2 + 253 * 107) weigh 68,737 units: 17,185 vbytes.
  assert.equal(plan.vsize, 17_185);
  assert.equal(plan.fee, 34_370n);
  const p = signPayment(account, state, req);
  checkAgainstPlan(account, state, req, plan, p);
  // Three of these 253 signatures are a byte short: 68,734 units, one vbyte under the plan.
  assert.equal(p.vsize, 17_184);

  // With this many signatures a payment can come out two vbytes under its
  // plan. At 15 sat/vB the same coins make another transaction, so other
  // signatures, and five of them are a byte short: 68,732 units are 17,183 vbytes.
  const faster: PaymentRequest = { ...req, feeRate: 15n };
  const fasterPlan = planned(watch, state, faster);
  const q = signPayment(account, state, faster);
  checkAgainstPlan(account, state, faster, fasterPlan, q);
  assert.deepEqual([fasterPlan.vsize, fasterPlan.fee, q.fee], [17_185, 257_775n, 257_775n]);
  assert.equal(q.vsize, 17_183);
  assert.ok(q.feeRate > 15 && q.feeRate < 15.002);
});

// -- change -----------------------------------------------------------------------

test('a leftover under the change dust limit goes to the fee; from 294 sats it comes back as change', () => {
  const state = stateOf([coinAt(account, 0, 0, 100_000n)]);
  // One input and two outputs are planned at 141 vB: 141 sats at 1 sat/vB.
  const withChange: PaymentRequest = { to: recipient, amount: 100_000n - 141n - 294n, feeRate: 1n };
  const plan = planned(watch, state, withChange);
  assert.deepEqual(
    { fee: plan.fee, vsize: plan.vsize, feeRate: plan.feeRate, change: plan.change },
    { fee: 141n, vsize: 141, feeRate: 1, change: 294n },
  );
  const p = signPayment(account, state, withChange);
  checkAgainstPlan(account, state, withChange, plan, p);
  assert.deepEqual(p.outputs[0], { address: V.abandon.change[0], amount: 294n, isChange: true, vout: 0 });
  assert.equal(p.changeIndex, 0);

  // One sat more to the recipient leaves 293 for change: too small to be worth an output.
  const without: PaymentRequest = { ...withChange, amount: 100_000n - 141n - 293n };
  const noChange = planned(watch, state, without);
  assert.equal(noChange.change, null);
  assert.equal(noChange.fee, 141n + 293n, 'the leftover is added to the fee');
  assert.equal(noChange.vsize, 110, 'and the transaction is planned without a change output');
  assert.equal(noChange.feeRate, 434 / 110);
  const q = signPayment(account, state, without);
  checkAgainstPlan(account, state, without, noChange, q);
  assert.equal(q.fee, 434n, 'the fee the plan stated is the fee the payment pays');
  assert.equal(q.outputs.length, 1);
  assert.equal(q.changeIndex, null);

  // The case that prompted planPayment: 99,500 of a 100,000 sat coin at 2 sat/vB.
  // The plan shows the real cost before anything is signed: 500 sats, over 4.5 sat/vB.
  const tight = planned(watch, state, { to: recipient, amount: 99_500n, feeRate: 2n });
  assert.deepEqual({ fee: tight.fee, change: tight.change, feeRate: tight.feeRate }, { fee: 500n, change: null, feeRate: 500 / 110 });
});

// -- every kind of recipient ----------------------------------------------------------

test('pays every kind of practice address, and the output script is the address', () => {
  const state = stateOf([coinAt(account, 0, 0, 100_000n), coinAt(account, 1, 3, 60_000n)], 4);
  const anchor = 'bcrt1pfeesnyr2tx';
  const future = bech32m.encode('bcrt', [7, ...bech32m.toWords(new Uint8Array(40).fill(9))]);
  const own = deriveAddress(account, 0, 5).address;
  for (const to of [recipient, TAPROOT, P2WSH, P2PKH, P2SH, anchor, future, own]) {
    for (const amount of [20_000n, 'all'] as const) {
      const req: PaymentRequest = { to, amount, feeRate: 3n };
      const plan = planned(watch, state, req);
      const p = signPayment(account, state, req);
      checkAgainstPlan(account, state, req, plan, p);
      const tx = Transaction.fromRaw(hex.decode(p.hex), { allowUnknownOutputs: true });
      const paid = p.outputs.find((o) => !o.isChange)!;
      assert.deepEqual(tx.getOutput(paid.vout).script, addressScript(to), to);
    }
  }
});

test('too-small: a payment that would make a transaction of under 65 bytes is refused before it is signed', () => {
  // Bitcoin Core relays no transaction of under 65 bytes, witnesses not
  // counted ("tx-size-small"). One coin in and one output are 60 bytes plus
  // the output's script, and an address with a 2-byte program stands for a
  // script of only 4 bytes. Pay-to-anchor is one; here are two more.
  const tiny = ['bcrt1pfeesnyr2tx', bech32m.encode('bcrt', [2, ...bech32m.toWords(Uint8Array.from([1, 2]))]), bech32m.encode('bcrt', [16, ...bech32m.toWords(Uint8Array.from([0x75, 0x1e]))])];
  const first = coinAt(account, 0, 0, 100_000n, { txid: 'aa'.repeat(32) });
  const one = stateOf([first]);
  const two = stateOf([first, coinAt(account, 0, 1, 50_000n, { txid: 'bb'.repeat(32) })]);
  /** The bytes of a signed payment without its witnesses, as the library writes them. */
  const stripped = (p: SignedPayment) => Transaction.fromRaw(hex.decode(p.hex), { allowUnknownOutputs: true }).toBytes(true, false).length;
  /** The same for a transaction made here, not by the wallet: one of its coins in, one output to this script. */
  const oneInOneOut = (script: Uint8Array): number => {
    const tx = new Transaction({ allowUnknownOutputs: true });
    tx.addInput({ txid: hex.decode(first.txid), index: first.vout, witnessUtxo: { script: first.script, amount: first.value }, sequence: RBF_SEQUENCE });
    tx.addOutput({ script, amount: 99_000n });
    return tx.toBytes(true, false).length;
  };
  // The address is a good one and the coin is enough, so the reason is neither "bad-address" nor "too-much".
  const refusal = { ok: false, reason: 'too-small', maxSendable: 0n, dust: null };

  for (const to of tiny) {
    assert.equal(checkAddress(to).kind, 'practice', to);
    assert.equal(addressScript(to).length, 4, to);
    assert.equal(oneInOneOut(addressScript(to)), 64, 'the transaction the wallet must not make');

    // One coin, sent in full, is that transaction. The plan says no, and its maxSendable of 0 says that "send all" cannot be made.
    assert.deepEqual(planPayment(watch, one, { to, amount: 'all', feeRate: 2n }), refusal, to);
    assert.throws(() => signPayment(account, one, { to, amount: 'all', feeRate: 2n }), /too small to relay/, to);
    // One coin, and an amount that leaves less than 294 sats for change: the same transaction.
    // One input and two outputs are priced at 123 vbytes, 246 sats, so that starts at 100,000 - 246 - 293.
    assert.deepEqual(planPayment(watch, one, { to, amount: 99_461n, feeRate: 2n }), refusal, to);
    assert.deepEqual(planPayment(watch, one, { to, amount: 99_816n, feeRate: 2n }), refusal, 'all the coin holds after a 184 sat fee');
    assert.throws(() => signPayment(account, one, { to, amount: 99_461n, feeRate: 2n }), /too small to relay/, to);
    // More than the coin can pay is "too much", as for any address.
    assert.deepEqual(planPayment(watch, one, { to, amount: 99_817n, feeRate: 2n }), { ...refusal, reason: 'too-much' }, to);

    // One sat less to the recipient leaves room for change, and the same coin pays the same address: 95 bytes.
    const withChange: PaymentRequest = { to, amount: 99_460n, feeRate: 2n };
    const plan = planned(watch, one, withChange);
    assert.deepEqual([plan.inputs.length, plan.change, plan.fee, plan.maxSendable], [1, 294n, 246n, 0n]);
    const p = signPayment(account, one, withChange);
    checkAgainstPlan(account, one, withChange, plan, p);
    assert.equal(stripped(p), 95);

    // A second coin makes room too: sent in full, both come to 105 bytes, and "send all" is back.
    const both: PaymentRequest = { to, amount: 'all', feeRate: 2n };
    const sweep = planned(watch, two, both);
    assert.deepEqual([sweep.inputs.length, sweep.vsize, sweep.amount, sweep.maxSendable], [2, 159, 149_682n, 149_682n]);
    const q = signPayment(account, two, both);
    checkAgainstPlan(account, two, both, sweep, q);
    assert.equal(stripped(q), 105);
    // Even then, an amount that the larger coin would pay alone and with no change is refused.
    assert.deepEqual(planPayment(watch, two, { to, amount: 99_700n, feeRate: 2n }), { ...refusal, maxSendable: 149_682n }, to);
    // A little more needs both coins, and goes through.
    assert.equal(planned(watch, two, { to, amount: 99_900n, feeRate: 2n }).inputs.length, 2);
  }

  // Change is not always to be had. One coin has to cover the amount (240
  // sats at the least for these addresses), 294 sats of change and the fee
  // for two outputs, priced at 123 vbytes. Where it cannot, that coin can
  // pay such an address no amount at all.
  const alone = (value: bigint) => stateOf([coinAt(account, 0, 0, value, { txid: 'aa'.repeat(32) })]);
  /** What the plan says of each of these amounts: "ok", or the reason. */
  const answers = (state: WalletState, to: string, feeRate: bigint, amounts: (bigint | 'all')[]): string[] =>
    amounts.map((amount) => {
      const plan = planPayment(watch, state, { to, amount, feeRate });
      return plan.ok ? 'ok' : plan.reason;
    });
  for (const to of tiny) {
    assert.equal(dustLimit(to), 240n, to);
    // At 1 sat/vB a coin of 657 sats just does it: 240 + 294 + 123.
    const exactly: PaymentRequest = { to, amount: 240n, feeRate: 1n };
    const tight = planned(watch, alone(657n), exactly);
    assert.deepEqual([tight.change, tight.fee, tight.vsize], [294n, 123n, 123]);
    checkAgainstPlan(account, alone(657n), exactly, tight, signPayment(account, alone(657n), exactly));
    assert.deepEqual(answers(alone(657n), to, 1n, [239n, 241n, 565n, 566n, 'all']), ['below-dust', 'too-small', 'too-small', 'too-much', 'too-small']);
    // One sat less in the coin, and the smallest amount there is leaves 293 sats: no change, so too small.
    assert.deepEqual(answers(alone(656n), to, 1n, [239n, 240n, 564n, 565n, 'all']), ['below-dust', 'too-small', 'too-small', 'too-much', 'too-small']);

    // The faucet's 100,000 sats, and the highest fee rates the app's form
    // takes. At 808 sat/vB the coin still covers 240 + 294 + 123 x 808; at
    // 809 it does not.
    assert.deepEqual(answers(alone(100_000n), to, 808n, [240n, 322n, 323n, 'all']), ['ok', 'ok', 'too-small', 'too-small']);
    assert.deepEqual(answers(alone(100_000n), to, 809n, [239n, 240n, 25_572n, 25_573n, 'all']), ['below-dust', 'too-small', 'too-small', 'too-much', 'too-small']);
    assert.deepEqual(answers(alone(100_000n), to, 1000n, [239n, 240n, 8_000n, 8_001n, 'all']), ['below-dust', 'too-small', 'too-small', 'too-much', 'too-small']);
    // A second coin does not help a small amount: one coin is still enough
    // for it, so one coin pays and no change comes back. An amount that
    // takes both coins goes through, and so does "send all".
    const pair = stateOf([coinAt(account, 0, 0, 100_000n, { txid: 'aa'.repeat(32) }), coinAt(account, 0, 1, 100_000n, { txid: 'bb'.repeat(32) })]);
    assert.deepEqual(answers(pair, to, 1000n, [240n, 8_000n, 8_001n, 41_000n, 41_001n, 'all']), ['too-small', 'too-small', 'ok', 'ok', 'too-much', 'ok']);
    const larger: PaymentRequest = { to, amount: 8_001n, feeRate: 1000n };
    const taking = planned(watch, pair, larger);
    assert.equal(taking.inputs.length, 2);
    checkAgainstPlan(account, pair, larger, taking, signPayment(account, pair, larger));
  }
  // With no change to be had, every amount is refused: here each one from 1 sat to all the coin holds.
  const reasons = new Set(answers(alone(656n), 'bcrt1pfeesnyr2tx', 1n, Array.from({ length: 656 }, (_, i) => BigInt(i + 1))));
  assert.deepEqual([...reasons].sort(), ['below-dust', 'too-much', 'too-small']);

  // One more byte of script is enough. 65 bytes: the smallest transaction this wallet makes.
  const five = bech32m.encode('bcrt', [2, ...bech32m.toWords(Uint8Array.from([1, 2, 3]))]);
  assert.equal(addressScript(five).length, 5);
  assert.equal(oneInOneOut(addressScript(five)), 65);
  const least: PaymentRequest = { to: five, amount: 'all', feeRate: 2n };
  const smallest = planned(watch, one, least);
  assert.equal(smallest.amount, smallest.maxSendable);
  const s = signPayment(account, one, least);
  checkAgainstPlan(account, one, least, smallest, s);
  assert.equal(stripped(s), 65);
  // And one coin paid on to an address like the wallet's own is 82.
  assert.equal(stripped(signPayment(account, one, { to: recipient, amount: 'all', feeRate: 2n })), 82);
});

// -- whatever a form hands over -----------------------------------------------------

test('bad-fee: a fee rate under 1 sat/vB is a reason from planPayment, not an error', () => {
  const state = stateOf([coinAt(account, 0, 0, 100_000n)]);
  // With no fee rate nothing can be worked out, so the most that can be sent is given as 0.
  const refusal = { ok: false, reason: 'bad-fee', maxSendable: 0n, dust: null };
  for (const feeRate of [0n, -1n, -2n, -1000n]) {
    for (const amount of [5_000n, 100_000n, 0n, -5n, 'all'] as const) {
      assert.deepEqual(planPayment(watch, state, { to: recipient, amount, feeRate }), refusal, `${amount} at ${feeRate}`);
      assert.deepEqual(planPayment(account, state, { to: recipient, amount, feeRate }), refusal, 'with the private key too');
    }
    // It is said before anything else: of an empty wallet, of coins still
    // waiting for a block, of text that is no address.
    assert.deepEqual(planPayment(watch, stateOf([]), { to: recipient, amount: 5_000n, feeRate }), refusal);
    const waiting = stateOf([coinAt(account, 0, 0, 100_000n, { confirmed: false })]);
    assert.deepEqual(planPayment(watch, waiting, { to: recipient, amount: 5_000n, feeRate }), refusal);
    assert.deepEqual(planPayment(watch, state, { to: 'hello', amount: 5_000n, feeRate }), refusal);
    assert.deepEqual(planPayment(watch, state, { to: recipient, amount: 5_000n, feeRate, coins: [] }), refusal);
    // What the plan refuses is not signed.
    assert.throws(() => signPayment(account, state, { to: recipient, amount: 5_000n, feeRate }), /at least 1 sat\/vB/);
    assert.throws(() => signPayment(account, state, { to: recipient, amount: 'all', feeRate }), /at least 1 sat\/vB/);
  }
  // 1 sat/vB is the lowest rate there is: one input and one output are 110 vbytes, 110 sats.
  const lowest = planned(watch, state, { to: recipient, amount: 'all', feeRate: 1n });
  assert.deepEqual([lowest.fee, lowest.vsize, lowest.feeRate], [110n, 110, 1]);
});

test('planPayment answers with a plan or a reason, and never throws, whatever a form hands over', () => {
  const reasons = ['bad-fee', 'nothing-spendable', 'unconfirmed-only', 'bad-address', 'below-dust', 'too-much', 'too-small'];
  const states = [
    stateOf([]),
    stateOf([coinAt(account, 0, 0, 100_000n, { confirmed: false })]),
    stateOf([coinAt(account, 0, 0, 100_000n)]),
    stateOf([coinAt(account, 0, 0, 100_000n, { txid: 'aa'.repeat(32) }), coinAt(account, 1, 0, 700n, { txid: 'bb'.repeat(32), confirmed: false })], 1),
  ];
  // What can be typed or pasted into an address field.
  const addresses = [
    '',
    'hello',
    ` ${recipient.toUpperCase()}\n`,
    recipient.slice(0, -1),
    `bitcoin:${recipient}`,
    'bcrt1pfeesnyr2tx',
    P2PKH,
    'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl',
    'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    'q'.repeat(5_000),
  ];
  // A form takes whole sats and a whole fee rate. A slip in its own checks could let any of these through.
  const amounts = ['all', -(10n ** 30n), 0n, 294n, 99_890n, 99_891n, 10n ** 30n] as const;
  const feeRates = [-(10n ** 30n), 0n, 1n, 1_000n, 10n ** 30n];
  const seen = new Set<string>();
  for (const state of states) {
    for (const to of addresses) {
      for (const amount of amounts) {
        for (const feeRate of feeRates) {
          const where = `${JSON.stringify(to.slice(0, 50))} ${amount} at ${feeRate}, ${state.coins.length} coins`;
          let plan: PaymentPlan;
          try {
            plan = planPayment(watch, state, { to, amount, feeRate });
          } catch (e) {
            assert.fail(`planPayment threw for ${where}: ${String(e)}`);
          }
          // A fee rate under 1 is "bad-fee" whatever else is asked, and nothing else ever is.
          assert.equal(!plan.ok && plan.reason === 'bad-fee', feeRate < 1n, where);
          if (plan.ok) {
            seen.add('ok');
            assert.ok(plan.amount > 0n && plan.fee >= feeRate * BigInt(plan.vsize), where);
            continue;
          }
          seen.add(plan.reason);
          assert.ok(reasons.includes(plan.reason), where);
          assert.ok(plan.maxSendable >= 0n, where);
          assert.equal(plan.dust !== null, plan.reason === 'below-dust', where);
          // And what the plan refuses, signPayment does not sign.
          assert.throws(() => signPayment(account, state, { to, amount, feeRate }), where);
        }
      }
    }
  }
  // Every answer there is came up.
  assert.deepEqual([...seen].sort(), ['ok', ...reasons].sort());
});

// -- what signPayment refuses ---------------------------------------------------------

test('signPayment throws where planPayment says no', () => {
  const state = stateOf([coinAt(account, 0, 0, 5_000n)]);
  assert.throws(() => signPayment(account, state, { to: recipient, amount: 10_000n, feeRate: 1n }), InsufficientFundsError);
  assert.throws(() => signPayment(account, stateOf([]), { to: recipient, amount: 1_000n, feeRate: 1n }), InsufficientFundsError);
  assert.throws(
    () => signPayment(account, stateOf([coinAt(account, 0, 0, 5_000n, { confirmed: false })]), { to: recipient, amount: 1_000n, feeRate: 1n }),
    InsufficientFundsError,
  );
  assert.throws(() => signPayment(account, state, { to: recipient, amount: 100n, feeRate: 1n }), /dust limit of 294 sats/);
  assert.throws(() => signPayment(account, state, { to: recipient, amount: 0n, feeRate: 1n }), /positive/);
  assert.throws(() => signPayment(account, state, { to: recipient, amount: 1_000n, feeRate: 0n }), /at least 1/);
  assert.throws(() => signPayment(account, state, { to: 'hello', amount: 1_000n, feeRate: 1n }), /practice-network address/);
  assert.throws(() => signPayment(account, state, { to: 'bcrt1pfeesnyr2tx', amount: 'all', feeRate: 1n }), /too small to relay/);
  // Each of those is a reason from planPayment, never an error.
  const reasonFor = (req: PaymentRequest, wallet = state) => refused(watch, wallet, req).reason;
  assert.equal(reasonFor({ to: recipient, amount: 10_000n, feeRate: 1n }), 'too-much');
  assert.equal(reasonFor({ to: recipient, amount: 1_000n, feeRate: 1n }, stateOf([])), 'nothing-spendable');
  assert.equal(reasonFor({ to: recipient, amount: 100n, feeRate: 1n }), 'below-dust');
  assert.equal(reasonFor({ to: recipient, amount: 0n, feeRate: 1n }), 'below-dust');
  assert.equal(reasonFor({ to: recipient, amount: 1_000n, feeRate: 0n }), 'bad-fee');
  assert.equal(reasonFor({ to: 'hello', amount: 1_000n, feeRate: 1n }), 'bad-address');
  assert.equal(reasonFor({ to: 'bcrt1pfeesnyr2tx', amount: 'all', feeRate: 1n }), 'too-small');
});
