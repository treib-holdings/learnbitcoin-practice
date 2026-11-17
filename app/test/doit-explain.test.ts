// "What just happened" (src/lib/doit/explain.ts): the sentences a
// transaction is read out in, as keys and slots.
//
// The transactions here are real ones where that matters: payments planned
// and signed by the wallet package on the gallery's sample wallet, and the
// sample history's transactions as the list would hold them. The figures in
// a sentence are held to the transaction they came from, and every sum a
// sentence states is added up again here.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import { ownAddresses, signPayment, viewPayment, type PaymentRequest, type TxPart, type TxView } from '@learnbitcoin/practice-wallet';
import { ACCOUNT, POT_ADDRESS, TXID, fundedState, otherAddress, ownAddress, sampleHistory } from '../dev/sample.ts';
import { EXPLAIN_SLOTS, EXPLAIN_TERMS, explain, type ExplainKey, type Sentence } from '../src/lib/doit/explain.ts';
import { glossaryUrl, type GlossaryTerm } from '../src/screens/read/read.ts';
import { frozen } from './doit-worlds.ts';

const NOW = 1_800_000_000_000;

/** A payment of the sample wallet's, signed and not sent: the same shape the list holds once the network has it. */
function payment(request: PaymentRequest): TxView {
  const state = fundedState();
  return viewPayment(signPayment(ACCOUNT.key, state, request), ownAddresses(state));
}

/** A transaction of the sample history, by its ID. */
function listed(txid: string): TxView {
  const found = sampleHistory(NOW).find((tx) => tx.txid === txid);
  assert.ok(found, txid);
  return found;
}

const keys = (sentences: Sentence[]): ExplainKey[] => sentences.map((sentence) => sentence.key);
const one = (sentences: Sentence[], key: ExplainKey): Sentence => {
  const found = sentences.filter((sentence) => sentence.key === key);
  assert.equal(found.length, 1, `${key} once in ${keys(sentences).join(', ')}`);
  return found[0] as Sentence;
};
const sum = (parts: TxPart[]): bigint => parts.reduce((total, part) => total + part.value, 0n);

/** What holds for every explanation, whatever the transaction. */
function sound(view: TxView, sentences: Sentence[]): void {
  assert.ok(sentences.length >= 3 && sentences.length <= 5, `three to five sentences, not ${sentences.length}: ${keys(sentences).join(', ')}`);
  for (const sentence of sentences) {
    // Exactly the slots the key takes: the string table's text has these and no others.
    assert.deepEqual(Object.keys(sentence.slots).sort(), [...EXPLAIN_SLOTS[sentence.key]].sort(), sentence.key);
    for (const value of Object.values(sentence.slots)) assert.notEqual(value, undefined, sentence.key);
    for (const term of sentence.terms) assert.ok((EXPLAIN_TERMS as readonly string[]).includes(term), `${sentence.key}: ${term}`);
    if (sentence.slots.count !== undefined) assert.ok(sentence.slots.count >= 2, `${sentence.key}: a count of ${sentence.slots.count} would need another sentence`);
  }
  // In the order they are read: what was spent first, where the transaction stands last, the fee just before that.
  assert.match(sentences[0]?.key ?? '', /^explain_(spent|theirs|newCoins)/);
  assert.match(sentences.at(-1)?.key ?? '', /^explain_(waiting|inBlock|confirmed)$/);
  const fee = sentences.find((sentence) => sentence.key.startsWith('explain_fee'));
  if (fee !== undefined) {
    assert.equal(sentences.indexOf(fee), sentences.length - 2);
    const { in: went, out: came, fee: paid, size, rate } = fee.slots;
    assert.ok(went !== undefined && came !== undefined && paid !== undefined && size !== undefined && rate !== undefined);
    // The fee with the figures: what went in, less what came out.
    assert.equal(went - came, paid);
    assert.deepEqual([went, came, paid, size], [sum(view.inputs), sum(view.outputs), view.fee, view.vsize]);
    // Never a product that does not multiply out: a rate given as it stands is whole and multiplies back to the fee.
    if (fee.key.endsWith('About')) {
      assert.ok(!Number.isInteger(rate), `${rate} is whole: it needs no "about"`);
      assert.ok(Math.abs(rate * size - Number(paid)) < 1e-6);
    } else {
      assert.ok(Number.isInteger(rate), String(rate));
      assert.equal(BigInt(rate) * BigInt(size), paid);
    }
  }
}

// -- a payment this wallet sent ---------------------------------------------------------------

test('sent, with change: the coins spent, what went to the address paid, the change, the fee, and that it waits', () => {
  const view = payment({ to: POT_ADDRESS, amount: 30_000n, feeRate: 2n });
  assert.equal(view.direction, 'sent');
  const sentences = explain(view);
  sound(view, sentences);
  assert.equal(sentences.length, 5);
  const spentCoins = view.inputs.filter((part) => part.mine);
  assert.equal(spentCoins.length, view.inputs.length, 'a payment of the wallet spends its own coins and no others');
  const change = view.outputs.find((part) => part.mine && part.change);
  assert.ok(change && change.address !== null);
  assert.deepEqual(sentences, [
    spentCoins.length === 1
      ? { key: 'explain_spentOne', slots: { amount: sum(spentCoins) }, terms: ['utxo'] }
      : { key: 'explain_spentMany', slots: { count: spentCoins.length, amount: sum(spentCoins) }, terms: ['utxo'] },
    { key: 'explain_paid', slots: { amount: 30_000n, address: POT_ADDRESS }, terms: [] },
    { key: 'explain_change', slots: { amount: change.value, address: change.address }, terms: ['change'] },
    { key: 'explain_fee', slots: { in: sum(view.inputs), out: sum(view.outputs), fee: view.fee, size: view.vsize, rate: 2 }, terms: ['fee'] },
    { key: 'explain_waiting', slots: {}, terms: ['mempool'] },
  ]);
  // The change went to an address on the wallet's change chain: a fresh one, not the one the coin came from.
  assert.equal(change.address, ownAddress(1, 1).address);
  // The sums a reader can check: what was spent is what was paid, the change and the fee.
  assert.equal(sum(spentCoins), 30_000n + change.value + view.fee);

  // The same payment once a block has taken it in, as the list holds it.
  const confirmed = explain({ ...view, confirmed: true, height: 5_913, time: 1_800_000_000 });
  assert.deepEqual(confirmed.at(-1), { key: 'explain_inBlock', slots: { height: 5_913 }, terms: ['block'] });
  assert.deepEqual(keys(confirmed).slice(0, 4), keys(sentences).slice(0, 4));
  // In a block, and which one is not known.
  assert.deepEqual(explain({ ...view, confirmed: true, height: null }).at(-1), { key: 'explain_confirmed', slots: {}, terms: ['block'] });
});

test('sent, with change, from more than one coin', () => {
  // More than the largest coin holds, so the planner has to take several.
  const view = payment({ to: otherAddress(7), amount: 150_000n, feeRate: 3n });
  const sentences = explain(view);
  sound(view, sentences);
  const spent = one(sentences, 'explain_spentMany');
  assert.ok((spent.slots.count ?? 0) >= 2);
  assert.deepEqual(spent.slots, { count: view.inputs.length, amount: sum(view.inputs) });
  assert.deepEqual(one(sentences, 'explain_paid').slots, { amount: 150_000n, address: otherAddress(7) });
  // A real case of a rate that is not whole: the planner prices the size it expects, rounding each
  // coin's share up, and the signed transaction comes out a little smaller. The fee is 3 sats for
  // each of 209 units, the transaction is 208, and "3 sat/vB" would not multiply out. So: "about".
  const fee = one(sentences, 'explain_feeAbout').slots;
  assert.deepEqual([fee.fee, fee.size], [627n, 208]);
  assert.equal(fee.rate, 627 / 208);
});

test('sent without change, and why: "Send all" uses the coins up whole', () => {
  const view = payment({ to: POT_ADDRESS, amount: 'all', feeRate: 2n });
  assert.equal(view.direction, 'sent');
  assert.equal(view.outputs.length, 1);
  const sentences = explain(view);
  sound(view, sentences);
  assert.deepEqual(keys(sentences), ['explain_spentMany', 'explain_paid', 'explain_noChange', 'explain_fee', 'explain_waiting']);
  // No change came back, and the figures say why: everything the coins held is the payment and the fee.
  const paid = one(sentences, 'explain_paid').slots.amount ?? 0n;
  const fee = one(sentences, 'explain_fee').slots;
  assert.equal(one(sentences, 'explain_spentMany').slots.amount, paid + (fee.fee ?? 0n));
  assert.deepEqual(one(sentences, 'explain_noChange'), { key: 'explain_noChange', slots: {}, terms: ['change'] });
  assert.equal(fee.rate, 2, 'the planner prices "Send all" at the rate asked for, to the sat');
});

test('sent without change because what was left over was too small to be a coin: the fee rate is not whole, and is said with "about"', () => {
  // One coin, a payment that leaves 100 sats over: less than the smallest coin worth making, so it goes to the fee.
  const state = fundedState();
  const [coin] = state.coins;
  assert.ok(coin);
  const all = viewPayment(signPayment(ACCOUNT.key, state, { to: POT_ADDRESS, amount: 'all', feeRate: 2n, coins: [coin] }), ownAddresses(state));
  const most = all.outputs[0]?.value ?? 0n;
  const view = viewPayment(signPayment(ACCOUNT.key, state, { to: POT_ADDRESS, amount: most - 100n, feeRate: 2n, coins: [coin] }), ownAddresses(state));
  assert.deepEqual([view.outputs.length, view.fee], [1, all.fee + 100n]);
  assert.notEqual(view.fee % BigInt(view.vsize), 0n);

  const sentences = explain(view);
  sound(view, sentences);
  assert.deepEqual(keys(sentences), ['explain_spentOne', 'explain_paid', 'explain_noChange', 'explain_feeAbout', 'explain_waiting']);
  const fee = one(sentences, 'explain_feeAbout').slots;
  assert.deepEqual([fee.in, fee.out, fee.fee, fee.size], [coin.value, most - 100n, all.fee + 100n, view.vsize]);
  assert.equal(fee.rate, Number(all.fee + 100n) / view.vsize);
  assert.ok((fee.rate ?? 0) > 2 && (fee.rate ?? 0) < 3);
});

test('to itself: every output is the wallet\'s own, and what it cost is the fee', () => {
  const view = payment({ to: ownAddress(0, 9).address, amount: 20_000n, feeRate: 2n });
  assert.equal(view.direction, 'internal');
  const sentences = explain(view);
  sound(view, sentences);
  assert.equal(sentences.length, 4);
  assert.deepEqual(keys(sentences).slice(1), ['explain_selfMany', 'explain_fee', 'explain_waiting']);
  // Payment and change are one thing here: all of it came back.
  assert.deepEqual(one(sentences, 'explain_selfMany').slots, { count: 2, amount: sum(view.outputs) });
  assert.equal(sum(view.inputs) - sum(view.outputs), view.fee);
  assert.equal(view.net, -view.fee);
  // No sentence speaks of an address paid, or of change, as if somebody else were in it.
  assert.ok(!keys(sentences).some((key) => /paid|change|back|other|got/i.test(key)));

  // Everything, to one of its own addresses: one output.
  const whole = payment({ to: ownAddress(0, 9).address, amount: 'all', feeRate: 1n });
  assert.equal(whole.direction, 'internal');
  const moved = explain(whole);
  sound(whole, moved);
  assert.deepEqual(keys(moved), ['explain_spentMany', 'explain_selfOne', 'explain_fee', 'explain_waiting']);
  assert.deepEqual(one(moved, 'explain_selfOne').slots, { amount: sum(whole.outputs) });
});

test('a payment of the wallet\'s that is not shaped like the usual one is still said truly', () => {
  const state = fundedState();
  const mine = (value: bigint, change: boolean, index: number): TxPart => ({ address: ownAddress(change ? 1 : 0, index).address, value, mine: true, change });
  const theirs = (value: bigint, index: number, address: string | null = otherAddress(index)): TxPart => ({ address, value, mine: false, change: false });
  const base: TxView = { ...payment({ to: POT_ADDRESS, amount: 30_000n, feeRate: 2n }), fee: 300n, vsize: 150, feeRate: 2 };
  assert.equal(state.coins.length, 4);

  // Two addresses paid (a payment made elsewhere, with these keys).
  const two: TxView = { ...base, inputs: [mine(100_000n, false, 0)], outputs: [theirs(30_000n, 1), theirs(20_000n, 2), mine(49_700n, true, 0)] };
  sound(two, explain(two));
  assert.deepEqual(one(explain(two), 'explain_paidMany').slots, { count: 2, amount: 50_000n });
  // What came back did not come back as plain change: to a receive address, or in two outputs.
  const toReceive: TxView = { ...base, inputs: [mine(100_000n, false, 0)], outputs: [theirs(30_000n, 1), mine(69_700n, false, 3)] };
  assert.deepEqual(keys(explain(toReceive)), ['explain_spentOne', 'explain_paid', 'explain_back', 'explain_fee', 'explain_waiting']);
  assert.deepEqual(one(explain(toReceive), 'explain_back').slots, { amount: 69_700n });
  const twice: TxView = { ...base, inputs: [mine(100_000n, false, 0)], outputs: [theirs(30_000n, 1), mine(40_000n, true, 0), mine(29_700n, true, 1)] };
  assert.deepEqual(one(explain(twice), 'explain_back').slots, { amount: 69_700n });
  sound(twice, explain(twice));
  // An output with no address form.
  const odd: TxView = { ...base, inputs: [mine(100_000n, false, 0)], outputs: [theirs(30_000n, 1, null), mine(69_700n, true, 0)] };
  assert.deepEqual(one(explain(odd), 'explain_paidOdd').slots, { amount: 30_000n });
  // An output that carries nothing (a note written into the transaction) went nowhere, and is not counted as paid.
  const noted: TxView = { ...base, inputs: [mine(100_000n, false, 0)], outputs: [theirs(0n, 1, null), theirs(30_000n, 1), mine(69_700n, true, 0)] };
  assert.deepEqual(keys(explain(noted)), ['explain_spentOne', 'explain_paid', 'explain_change', 'explain_fee', 'explain_waiting']);
});

// -- a transaction this wallet only received -----------------------------------------------------

test('a coin from the faucet: the coins spent were someone else\'s, what came to this wallet, and only a guess about the rest', () => {
  const view = listed(TXID.faucet);
  assert.equal(view.direction, 'received');
  const sentences = explain(view);
  sound(view, sentences);
  assert.deepEqual(sentences, [
    { key: 'explain_theirsOne', slots: { amount: 5_000_000n }, terms: ['utxo'] },
    { key: 'explain_got', slots: { amount: 100_000n, address: ownAddress(0, 0).address }, terms: [] },
    // Of the other output only this: it is not this wallet's, most likely the sender's own change.
    { key: 'explain_other', slots: { amount: 4_899_718n }, terms: ['change'] },
    { key: 'explain_feeTheirs', slots: { in: 5_000_000n, out: 4_999_718n, fee: 282n, size: 141, rate: 2 }, terms: ['fee'] },
    { key: 'explain_inBlock', slots: { height: view.height ?? -1 }, terms: ['block'] },
  ]);
  // Never "there was no change", and never the sentence that names this wallet's own change.
  for (const tx of sampleHistory(NOW).filter((each) => each.direction === 'received')) {
    const said = keys(explain(tx));
    assert.ok(!said.includes('explain_noChange') && !said.includes('explain_change') && !said.includes('explain_back'), tx.txid);
    assert.ok(!said.some((key) => key === 'explain_fee' || key === 'explain_feeAbout'), 'the sender paid the fee');
    sound(tx, explain(tx));
  }
  // Still waiting: the same sentences, and the waiting room at the end.
  assert.deepEqual(explain(listed(TXID.arriving)).at(-1), { key: 'explain_waiting', slots: {}, terms: ['mempool'] });
});

test('received, in other shapes: no other output, several of them, several coins spent, several outputs to this wallet', () => {
  const mine = (value: bigint, index: number): TxPart => ({ address: ownAddress(0, index).address, value, mine: true, change: false });
  const theirs = (value: bigint, index: number): TxPart => ({ address: otherAddress(index), value, mine: false, change: false });
  const base = listed(TXID.faucet);

  // Everything the sender spent came here: there is no other output to say anything about.
  const exact: TxView = { ...base, inputs: [theirs(100_282n, 3)], outputs: [mine(100_000n, 0)], net: 100_000n };
  assert.deepEqual(keys(explain(exact)), ['explain_theirsOne', 'explain_got', 'explain_feeTheirs', 'explain_inBlock']);
  sound(exact, explain(exact));
  // Several coins spent, several outputs elsewhere.
  const batch: TxView = { ...base, inputs: [theirs(60_000n, 3), theirs(50_000n, 4), theirs(40_282n, 5)], outputs: [theirs(10_000n, 6), mine(100_000n, 0), theirs(40_000n, 7)], net: 100_000n };
  const said = explain(batch);
  sound(batch, said);
  assert.deepEqual(one(said, 'explain_theirsMany').slots, { count: 3, amount: 150_282n });
  assert.deepEqual(one(said, 'explain_otherMany').slots, { count: 2, amount: 50_000n });
  // Two outputs of one transaction to this wallet.
  const twice: TxView = { ...base, inputs: [theirs(100_282n, 3)], outputs: [mine(60_000n, 0), mine(40_000n, 1)], net: 100_000n };
  assert.deepEqual(one(explain(twice), 'explain_gotMany').slots, { count: 2, amount: 100_000n });
  sound(twice, explain(twice));
});

test('a rate that is not whole is said with "about", and a whole one is never', () => {
  const base = listed(TXID.faucet);
  // 282 sats for 141 vB is 2 sat/vB exactly. 283 is not.
  const rated = (fee: bigint, vsize: number): TxView => ({
    ...base,
    fee,
    vsize,
    feeRate: Number(fee) / vsize,
    inputs: [{ ...(base.inputs[0] as TxPart), value: sum(base.outputs) + fee }],
  });
  const cases: [bigint, number, ExplainKey, number][] = [
    [282n, 141, 'explain_feeTheirs', 2],
    [283n, 141, 'explain_feeTheirsAbout', 283 / 141],
    [141n, 141, 'explain_feeTheirs', 1],
    [140n, 141, 'explain_feeTheirsAbout', 140 / 141],
    [1_000n, 110, 'explain_feeTheirsAbout', 1_000 / 110],
    [1_100n, 110, 'explain_feeTheirs', 10],
    [0n, 141, 'explain_feeTheirs', 0],
  ];
  for (const [fee, vsize, key, rate] of cases) {
    const view = rated(fee, vsize);
    const said = explain(view);
    sound(view, said);
    assert.deepEqual(one(said, key).slots, { in: sum(view.inputs), out: sum(view.outputs), fee, size: vsize, rate }, `${fee} / ${vsize}`);
  }
  // The same for a payment of the wallet's own.
  const sent = payment({ to: POT_ADDRESS, amount: 30_000n, feeRate: 2n });
  const bumped: TxView = { ...sent, fee: sent.fee + 1n, inputs: sent.inputs.map((part, at) => (at === 0 ? { ...part, value: part.value + 1n } : part)) };
  assert.equal(one(explain(bumped), 'explain_feeAbout').slots.fee, sent.fee + 1n);
  sound(bumped, explain(bumped));
});

test('figures that do not add up are not said: a block\'s own first transaction, and a size that is none', () => {
  const base = listed(TXID.faucet);
  // New coins, made by the block itself: nothing was spent, and there is no fee to explain.
  const coinbase: TxView = { ...base, inputs: [{ address: null, value: 0n, mine: false, change: false }], fee: 0n, feeRate: 0 };
  assert.deepEqual(keys(explain(coinbase)), ['explain_newCoins', 'explain_got', 'explain_other', 'explain_inBlock']);
  assert.deepEqual(explain(coinbase)[0], { key: 'explain_newCoins', slots: {}, terms: ['block'] });
  // A fee that is not what went in less what came out (an answer of the network's that does not hold together).
  for (const view of [{ ...base, fee: 281n }, { ...base, vsize: 0 }, { ...base, vsize: 140.5 }, { ...base, vsize: Number.NaN }, { ...base, fee: -282n }]) {
    const said = keys(explain(view));
    assert.ok(!said.some((key) => key.startsWith('explain_fee')), JSON.stringify(said));
    assert.equal(said.at(-1), 'explain_inBlock');
  }
});

test('a transaction that does not touch this wallet is not explained', () => {
  const stranger: TxView = { ...listed(TXID.faucet), direction: 'other', net: 0n, outputs: listed(TXID.faucet).outputs.map((part) => ({ ...part, mine: false })) };
  assert.deepEqual(explain(stranger), []);
});

test('every transaction of the sample wallet reads as three to five sentences, and reading changes nothing', () => {
  const all = [...sampleHistory(NOW), payment({ to: POT_ADDRESS, amount: 30_000n, feeRate: 2n }), payment({ to: POT_ADDRESS, amount: 'all', feeRate: 5n })];
  const used = new Set<ExplainKey>();
  for (const view of all) {
    const said = explain(frozen(view));
    sound(view, said);
    assert.deepEqual(explain(view), said, 'the same transaction, the same sentences');
    for (const key of keys(said)) used.add(key);
    // Amounts are whole sats, as the wallet counts them, and addresses are the transaction's own.
    const addresses = [...view.inputs, ...view.outputs].map((part) => part.address);
    for (const sentence of said) {
      if (sentence.slots.address !== undefined) assert.ok(addresses.includes(sentence.slots.address), sentence.key);
      for (const slot of ['amount', 'in', 'out', 'fee'] as const) {
        if (sentence.slots[slot] !== undefined) assert.equal(typeof sentence.slots[slot], 'bigint', `${sentence.key}.${slot}`);
      }
    }
  }
  assert.ok(used.size >= 9, `${used.size} different sentences were said`);
});

// -- the glossary ------------------------------------------------------------------------------------

test('each term a newcomer meets has an entry in the read screens\' glossary map, in both languages', () => {
  // The names are the map's own: the compiler holds the two lists together.
  const terms: readonly GlossaryTerm[] = EXPLAIN_TERMS;
  assert.deepEqual([...terms], ['utxo', 'change', 'fee', 'block', 'mempool']);
  // A coin, change, the fee, a block, the waiting room: the entry of each, by the last part of its
  // address, as it was found in the main site's content in English and in Spanish.
  const entries: Record<(typeof EXPLAIN_TERMS)[number], { en: string; es: string }> = {
    utxo: { en: 'utxo-unspent-transaction-output', es: 'utxo' },
    change: { en: 'change-output', es: 'salida-de-cambio' },
    fee: { en: 'transaction-fee', es: 'comision-de-transaccion' },
    block: { en: 'block', es: 'bloque' },
    mempool: { en: 'mempool', es: 'mempool' },
  };
  const site = 'https://www.learnbitcoin.com';
  for (const term of EXPLAIN_TERMS) {
    assert.equal(glossaryUrl(site, 'en', term), `${site}/glossary/${entries[term].en}`);
    assert.equal(glossaryUrl(site, 'es', term), `${site}/es/glosario/${entries[term].es}`);
    for (const lang of LANGS) assert.match(entries[term][lang], /^[a-z0-9-]+$/);
  }
  // Every sentence that uses a term names it, so the screen can link the term where it first appears.
  const terminology: [RegExp, (typeof EXPLAIN_TERMS)[number]][] = [
    [/^explain_(spent|theirs)/, 'utxo'],
    [/^explain_(change|back|noChange|other)/, 'change'],
    [/^explain_fee/, 'fee'],
    [/^explain_(inBlock|confirmed|newCoins)$/, 'block'],
    [/^explain_waiting$/, 'mempool'],
  ];
  const said = [...sampleHistory(NOW), payment({ to: POT_ADDRESS, amount: 30_000n, feeRate: 2n }), payment({ to: POT_ADDRESS, amount: 'all', feeRate: 2n })].flatMap(explain);
  for (const sentence of said) {
    const expected = terminology.filter(([pattern]) => pattern.test(sentence.key)).map(([, term]) => term);
    assert.deepEqual(sentence.terms, expected, sentence.key);
  }
  // explain.ts itself writes no sentence and names no address of the web: keys and slots only.
  const source = readFileSync(new URL('../src/lib/doit/explain.ts', import.meta.url), 'utf8');
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  assert.doesNotMatch(code, /https?:|fetch\(|strings\//);
});

test('the list of sentences: every key has its slots, and every slot is one a sentence can carry', () => {
  const slots = ['amount', 'in', 'out', 'fee', 'count', 'address', 'size', 'rate', 'height'];
  const all = Object.keys(EXPLAIN_SLOTS) as ExplainKey[];
  assert.equal(all.length, 24);
  for (const key of all) {
    assert.match(key, /^explain_[a-z][A-Za-z]+$/, key);
    for (const slot of EXPLAIN_SLOTS[key]) assert.ok(slots.includes(slot), `${key}: ${slot}`);
    assert.equal(new Set<string>(EXPLAIN_SLOTS[key]).size, EXPLAIN_SLOTS[key].length, key);
  }
  // A sentence about one thing and its sibling about several differ by the count alone.
  for (const [single, many] of [['explain_spentOne', 'explain_spentMany'], ['explain_theirsOne', 'explain_theirsMany'], ['explain_selfOne', 'explain_selfMany'], ['explain_other', 'explain_otherMany']] as const) {
    assert.deepEqual([...EXPLAIN_SLOTS[many]].sort(), [...EXPLAIN_SLOTS[single], 'count'].sort(), many);
  }
  // The four fee sentences take the same five figures.
  for (const key of ['explain_fee', 'explain_feeAbout', 'explain_feeTheirs', 'explain_feeTheirsAbout'] as const) {
    assert.deepEqual([...EXPLAIN_SLOTS[key]], ['in', 'out', 'fee', 'size', 'rate'], key);
  }
});
