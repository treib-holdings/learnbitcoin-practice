// Builds and signs a payment with the wallet library from the coins Core
// funded (utxos.json), for xcheck.py's spend phase. Usage: node build-tx.ts <dir>
import { readFileSync, writeFileSync } from 'node:fs';
import { accountFromMnemonic, buildPayment, deriveAddress, type Coin, type WalletState } from '../../wallet/src/index.ts';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node build-tx.ts <dir>');
const V = JSON.parse(readFileSync(new URL('../../wallet/test/vectors.json', import.meta.url), 'utf8'));
const { unspents, recipient } = JSON.parse(readFileSync(`${dir}/utxos.json`, 'utf8'));
const account = accountFromMnemonic(V.abandon.mnemonic).key;

const byAddress = new Map<string, number>(
  (V.abandon.receive as string[]).map((address, index) => [address, index]),
);

const coins: Coin[] = unspents.map((u: { txid: string; vout: number; desc: string; amount: number; height: number }) => {
  const address = u.desc.match(/^addr\(([^)]+)\)/)?.[1];
  const index = address === undefined ? undefined : byAddress.get(address);
  if (address === undefined || index === undefined) throw new Error(`Core returned a coin we did not fund: ${u.desc}`);
  return {
    txid: u.txid,
    vout: u.vout,
    value: BigInt(Math.round(u.amount * 1e8)),
    status: { confirmed: true, block_height: u.height },
    chain: 0,
    index,
    address,
    script: deriveAddress(account, 0, index).script,
  };
});

const state: WalletState = {
  receive: [],
  change: [],
  coins,
  nextReceiveIndex: 2,
  nextChangeIndex: 0,
  confirmed: coins.reduce((s, c) => s + c.value, 0n),
  unconfirmed: 0n,
};

const amount = 60_000n;
const p = buildPayment(account, state, { to: recipient, amount, feeRate: 2n });
const change = p.outputs.find((o) => o.isChange);
if (!change) throw new Error('Expected a change output');

writeFileSync(`${dir}/tx.hex`, p.hex);
writeFileSync(
  `${dir}/built.json`,
  JSON.stringify(
    {
      txid: p.txid,
      vsize: p.vsize,
      fee: Number(p.fee),
      fee_rate: p.feeRate,
      amount: Number(amount),
      change: Number(change.amount),
      change_address: change.address,
      inputs: p.inputs.length,
    },
    null,
    2,
  ),
);
console.log(`built ${p.txid}: ${p.inputs.length} inputs, fee ${p.fee} sats at ${p.feeRate.toFixed(2)} sat/vB, ${p.vsize} vB`);
