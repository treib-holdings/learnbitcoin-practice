// The sample wallet the development gallery shows (dev/sample.ts). Screens
// are built and looked at against it, so it has to hang together the way a
// scanned wallet does: totals that add up, a history that explains the
// coins, and coins the real planner and signer accept.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADDRESS_PATTERN, TXID_PATTERN } from '@learnbitcoin/practice-contract';
import {
  coinTotals,
  ownAddresses,
  planPayment,
  signPayment,
  spendableCoins,
  viewPayment,
  watchOnlyAccount,
} from '@learnbitcoin/practice-wallet';
import {
  ACCOUNT,
  OTHER_FINGERPRINT,
  POT_ADDRESS,
  TXID,
  WORDS,
  emptyState,
  fundedState,
  otherAddress,
  ownAddress,
  sampleHistory,
  sampleRecord,
} from '../dev/sample.ts';

const NOW = 1_800_000_000_000;

test('the sample wallet is the first BIP39 test phrase on the practice network', () => {
  assert.equal(WORDS.split(' ').length, 12);
  assert.equal(ACCOUNT.masterFingerprint, '73c5da0a');
  assert.match(ACCOUNT.xpub, /^tpub/);
  assert.match(ownAddress(0, 0).address, ADDRESS_PATTERN);
  assert.equal(ownAddress(0, 0).path, "m/84'/1'/0'/0/0");
  // Everybody else is another wallet.
  assert.notEqual(OTHER_FINGERPRINT, ACCOUNT.masterFingerprint);
  assert.match(POT_ADDRESS, ADDRESS_PATTERN);
  assert.notEqual(otherAddress(0), ownAddress(0, 0).address);
});

test('the record is what this browser would store, without the words', () => {
  const passkey = sampleRecord('passkey', NOW);
  assert.equal(passkey.kind, 'passkey');
  assert.equal(passkey.xpub, ACCOUNT.xpub);
  assert.equal(passkey.firstAddress, ownAddress(0, 0).address);
  assert.match(passkey.credentialId ?? '', /^[A-Za-z0-9_-]+$/);
  assert.match(passkey.tag ?? '', /^[A-Z0-9]{4}$/);
  const words = sampleRecord('words', NOW);
  assert.equal(words.credentialId, undefined);
  assert.equal(words.tag, undefined);
  for (const record of [passkey, words]) assert.ok(!('mnemonic' in record));
});

test('the funded wallet adds up', () => {
  const state = fundedState();
  assert.deepEqual(coinTotals(state.coins), { confirmed: state.confirmed, unconfirmed: state.unconfirmed });
  assert.equal(state.confirmed, 172_821n);
  assert.equal(state.unconfirmed, 25_000n);
  // Every coin sits on an address the state lists, at the place it says.
  const own = ownAddresses(state);
  for (const coin of state.coins) {
    const list = coin.chain === 0 ? state.receive : state.change;
    assert.equal(list[coin.index]?.address, coin.address);
    assert.ok(list[coin.index]?.used, coin.address);
    assert.ok((coin.chain === 0 ? own.receive : own.change).has(coin.address));
    assert.match(coin.txid, TXID_PATTERN);
  }
  // The next addresses to hand out are the first unused ones.
  assert.equal(state.receive[state.nextReceiveIndex]?.used, false);
  assert.equal(state.receive[state.nextReceiveIndex - 1]?.used, true);
  assert.equal(state.change[state.nextChangeIndex]?.used, false);
  // One coin is still unconfirmed and came from somebody else: it cannot be spent yet.
  assert.equal(spendableCoins(state).length, state.coins.length - 1);
});

test('the empty wallet holds nothing and has used nothing', () => {
  const state = emptyState();
  assert.equal(state.coins.length, 0);
  assert.equal(state.confirmed + state.unconfirmed, 0n);
  assert.equal(state.nextReceiveIndex, 0);
  assert.ok(state.receive.every((address) => !address.used));
});

test('the history explains the coins', () => {
  const state = fundedState();
  const history = sampleHistory(NOW);
  // Newest first: the unconfirmed one, then by height.
  assert.equal(history[0]?.confirmed, false);
  const heights = history.slice(1).map((tx) => tx.height ?? 0);
  assert.deepEqual(heights, [...heights].sort((a, b) => b - a));
  // What the wallet gained and lost over its history is what it holds.
  const net = history.reduce((sum, tx) => sum + tx.net, 0n);
  assert.equal(net, state.confirmed + state.unconfirmed);
  for (const tx of history) {
    assert.match(tx.txid, TXID_PATTERN);
    const sum = (parts: typeof tx.inputs): bigint => parts.reduce((total, part) => total + part.value, 0n);
    // What goes in is what comes out plus the fee.
    assert.equal(sum(tx.inputs), sum(tx.outputs) + tx.fee, tx.txid);
    const mine = (parts: typeof tx.inputs): bigint => parts.reduce((total, p) => (p.mine ? total + p.value : total), 0n);
    assert.equal(tx.net, mine(tx.outputs) - mine(tx.inputs), tx.txid);
    assert.equal(tx.direction, tx.net < 0n ? 'sent' : 'received', tx.txid);
    assert.equal(tx.confirmed, tx.height !== null);
    assert.equal(tx.confirmed, tx.time !== null);
  }
  // Every coin is an output of a transaction in the history.
  for (const coin of state.coins) {
    const tx = history.find((entry) => entry.txid === coin.txid);
    assert.equal(tx?.outputs[coin.vout]?.address, coin.address, coin.txid);
    assert.equal(tx?.outputs[coin.vout]?.value, coin.value, coin.txid);
  }
  // The one payment the wallet made went to the pot, and its change came back.
  const sent = history.find((tx) => tx.txid === TXID.sent);
  assert.equal(sent?.outputs[0]?.address, POT_ADDRESS);
  assert.equal(sent?.outputs[1]?.change, true);
});

test('the real planner and signer take the sample coins', () => {
  const state = fundedState();
  const request = { to: POT_ADDRESS, amount: 30_000n, feeRate: 2n };
  const plan = planPayment(watchOnlyAccount(ACCOUNT.xpub), state, request);
  assert.ok(plan.ok);
  assert.equal(plan.amount, 30_000n);
  const payment = signPayment(ACCOUNT.key, state, request);
  assert.equal(payment.fee, plan.fee);
  const view = viewPayment(payment, ownAddresses(state));
  assert.equal(view.direction, 'sent');
  assert.equal(view.net, -(30_000n + plan.fee));
  // And "send all" leaves the unconfirmed coin from somebody else alone.
  const all = planPayment(watchOnlyAccount(ACCOUNT.xpub), state, { to: POT_ADDRESS, amount: 'all', feeRate: 1n });
  assert.ok(all.ok);
  assert.equal(all.inputs.length, 3);
});
