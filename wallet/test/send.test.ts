import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Transaction } from '@scure/btc-signer';
import {
  InsufficientFundsError,
  RBF_SEQUENCE,
  accountFromMnemonic,
  buildPayment,
  deriveAddress,
  type Coin,
  type WalletState,
} from '../src/index.ts';

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const account = accountFromMnemonic(V.abandon.mnemonic).key;
const recipient = V.prf.wallet.receive[0] as string;

function coin(index: number, value: bigint, txidByte: number): Coin {
  const a = deriveAddress(account, 0, index);
  return {
    txid: txidByte.toString(16).padStart(2, '0').repeat(32),
    vout: 0,
    value,
    status: { confirmed: true, block_height: 101 },
    chain: 0,
    index,
    address: a.address,
    script: a.script,
  };
}

function state(coins: Coin[]): WalletState {
  return {
    receive: [],
    change: [],
    coins,
    nextReceiveIndex: 2,
    nextChangeIndex: 0,
    confirmed: coins.reduce((s, c) => s + c.value, 0n),
    unconfirmed: 0n,
  };
}

test('pays the recipient, returns change, and the fee matches the rate', () => {
  const s = state([coin(0, 50_000n, 0xaa), coin(1, 30_000n, 0xbb)]);
  const p = buildPayment(account, s, { to: recipient, amount: 60_000n, feeRate: 2n });

  assert.equal(p.inputs.length, 2);
  const pay = p.outputs.filter((o) => !o.isChange);
  const change = p.outputs.filter((o) => o.isChange);
  assert.deepEqual(pay, [{ address: recipient, amount: 60_000n, isChange: false, vout: 1 }]);
  assert.equal(change.length, 1);
  assert.equal(change[0]!.address, V.abandon.change[0]);
  assert.equal(p.changeIndex, 0);

  const totalIn = p.inputs.reduce((s, c) => s + c.value, 0n);
  const totalOut = p.outputs.reduce((s, o) => s + o.amount, 0n);
  assert.equal(p.fee, totalIn - totalOut);
  assert.ok(p.feeRate >= 2 && p.feeRate < 2.3, `fee rate ${p.feeRate}`);

  const tx = Transaction.fromRaw(Uint8Array.from(Buffer.from(p.hex, 'hex')));
  assert.equal(tx.id, p.txid);
  assert.ok(tx.hasWitnesses);
  for (let i = 0; i < tx.inputsLength; i++) assert.equal(tx.getInput(i).sequence, RBF_SEQUENCE);
});

test('spending one coin when it is enough', () => {
  const s = state([coin(0, 50_000n, 0xaa), coin(1, 30_000n, 0xbb)]);
  const p = buildPayment(account, s, { to: recipient, amount: 10_000n, feeRate: 1n, strategy: 'exactBiggest/accumBiggest' });
  assert.equal(p.inputs.length, 1);
  assert.equal(p.inputs[0]!.value, 50_000n);
});

test('coin control limits the coins a payment may use', () => {
  const small = coin(1, 30_000n, 0xbb);
  const s = state([coin(0, 50_000n, 0xaa), small]);
  const p = buildPayment(account, s, { to: recipient, amount: 10_000n, feeRate: 1n, coins: [small] });
  assert.deepEqual(p.inputs.map((c) => c.txid), [small.txid]);
});

test('refuses payments the wallet cannot afford, and silly fee rates', () => {
  const s = state([coin(0, 5_000n, 0xaa)]);
  assert.throws(() => buildPayment(account, s, { to: recipient, amount: 10_000n, feeRate: 1n }), InsufficientFundsError);
  assert.throws(() => buildPayment(account, s, { to: recipient, amount: 1_000n, feeRate: 0n }), /at least 1/);
  assert.throws(() => buildPayment(account, s, { to: recipient, amount: 0n, feeRate: 1n }), /positive/);
});

test('rejects a mainnet recipient address', () => {
  const s = state([coin(0, 50_000n, 0xaa)]);
  assert.throws(() =>
    buildPayment(account, s, { to: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', amount: 1_000n, feeRate: 1n }),
  );
});
