// Building and signing a payment.
//
// A payment spends whole coins. The wallet picks coins worth at least the
// amount plus the fee, pays the recipient, and sends what is left back to
// itself at a fresh change address. Every input signals BIP125 replace-by-fee
// so a stuck payment can be bumped later.

import { hex } from '@scure/base';
import type { HDKey } from '@scure/bip32';
import { selectUTXO } from '@scure/btc-signer';
import type { SelectionStrategy } from '@scure/btc-signer/utxo.js';
import { deriveAddress, privateKeyAt } from './keys.ts';
import { RBF_SEQUENCE, REGTEST } from './network.ts';
import type { Coin, WalletState } from './scan.ts';

export type { SelectionStrategy };

export interface PaymentRequest {
  /** Recipient address on the practice network (bcrt1...). */
  to: string;
  /** In satoshis. */
  amount: bigint;
  /** Fee rate in sat/vB (whole numbers). */
  feeRate: bigint;
  /** Coin-selection strategy; see the coin-selection rabbit hole. Default: 'default'. */
  strategy?: SelectionStrategy;
  /** Spend only these coins (coin control). Default: any coin in the wallet. */
  coins?: Coin[];
}

export interface PaymentOutput {
  address: string;
  amount: bigint;
  isChange: boolean;
}

export interface SignedPayment {
  txid: string;
  hex: string;
  /** In satoshis. */
  fee: bigint;
  vsize: number;
  /** Actual fee rate in sat/vB, after signing. */
  feeRate: number;
  inputs: Coin[];
  outputs: PaymentOutput[];
  /** The change index used, if any; the caller marks it used after broadcast. */
  changeIndex: number | null;
}

export class InsufficientFundsError extends Error {
  constructor() {
    super('Not enough coins to pay this amount plus the fee');
    this.name = 'InsufficientFundsError';
  }
}

function coinKey(txid: string, vout: number): string {
  return `${txid}:${vout}`;
}

/** Choose coins, build the transaction, sign every input. Nothing is broadcast. */
export function buildPayment(account: HDKey, state: WalletState, req: PaymentRequest): SignedPayment {
  if (req.amount <= 0n) throw new Error('Amount must be positive');
  if (req.feeRate < 1n) throw new Error('Fee rate must be at least 1 sat/vB');
  const pool = req.coins ?? state.coins;
  const byKey = new Map(pool.map((c) => [coinKey(c.txid, c.vout), c]));
  const change = deriveAddress(account, 1, state.nextChangeIndex);

  const selection = selectUTXO(
    pool.map((c) => ({
      txid: hex.decode(c.txid),
      index: c.vout,
      witnessUtxo: { script: c.script, amount: c.value },
      sequence: RBF_SEQUENCE,
    })),
    [{ address: req.to, amount: req.amount }],
    req.strategy ?? 'default',
    { feePerByte: req.feeRate, changeAddress: change.address, network: REGTEST, createTx: true, lowR: true },
  );
  if (!selection || !selection.tx) throw new InsufficientFundsError();
  const tx = selection.tx;

  const inputs: Coin[] = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i);
    if (!input.txid || input.index === undefined) throw new Error('Selected input is missing its outpoint');
    const coin = byKey.get(coinKey(hex.encode(input.txid), input.index));
    if (!coin) throw new Error('Selected an input the wallet does not own');
    tx.signIdx(privateKeyAt(account, coin.chain, coin.index), i);
    inputs.push(coin);
  }
  tx.finalize();

  const outputs: PaymentOutput[] = [];
  let changeUsed = false;
  for (let i = 0; i < tx.outputsLength; i++) {
    const address = tx.getOutputAddress(i, REGTEST);
    const amount = tx.getOutput(i).amount;
    if (!address || amount === undefined) throw new Error('Unexpected output in the built transaction');
    const isChange = address === change.address;
    changeUsed ||= isChange;
    outputs.push({ address, amount, isChange });
  }

  return {
    txid: tx.id,
    hex: tx.hex,
    fee: tx.fee,
    vsize: tx.vsize,
    feeRate: Number(tx.fee) / tx.vsize,
    inputs,
    outputs,
    changeIndex: changeUsed ? change.index : null,
  };
}
