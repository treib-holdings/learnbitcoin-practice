// Prints the wallet's test vectors as JSON (node test/make-vectors.ts > test/vectors.json).
// The values are then checked independently: HKDF against Python's standard
// library, addresses and descriptor checksums against Bitcoin Core on regtest
// (tools/regtest-crosscheck). Keep vectors.json in git; never regenerate it
// to make a failing test pass.
//
// "payment" is one signed transaction, kept byte for byte. Signatures here
// are deterministic, so the same coins and the same request must always
// give the same bytes. It was first made by the first version of
// buildPayment, the code path whose transactions Bitcoin Core accepted in
// tools/regtest-crosscheck.

import { bytesToHex } from '@noble/hashes/utils.js';
import {
  PRF_INPUT_V1,
  accountDescriptor,
  accountFromMnemonic,
  deriveAddress,
  entropyFromPrf,
  mnemonicFromEntropy,
  signPayment,
  type Chain,
  type Coin,
} from '../src/index.ts';

function wallet(mnemonic: string) {
  const a = accountFromMnemonic(mnemonic);
  return {
    mnemonic,
    masterFingerprint: a.masterFingerprint,
    xpub: a.xpub,
    receive: [0, 1, 2, 3, 4].map((i) => deriveAddress(a.key, 0, i).address),
    change: [0, 1].map((i) => deriveAddress(a.key, 1, i).address),
    receiveDescriptor: accountDescriptor(a.masterFingerprint, a.xpub, 0),
    changeDescriptor: accountDescriptor(a.masterFingerprint, a.xpub, 1),
  };
}

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const prfOutput = new Uint8Array(32).fill(1);
const entropy = entropyFromPrf(prfOutput);
const prfWallet = wallet(mnemonicFromEntropy(entropy));

/** The "abandon" wallet pays the passkey wallet 60,000 sats from two coins at 2 sat/vB. */
function payment() {
  const account = accountFromMnemonic(ABANDON).key;
  const coins = [
    { txid: 'aa'.repeat(32), vout: 0, value: 50_000, chain: 0 as Chain, index: 0 },
    { txid: 'bb'.repeat(32), vout: 0, value: 30_000, chain: 0 as Chain, index: 1 },
  ];
  const request = { to: prfWallet.receive[0]!, amount: 60_000, feeRate: 2 };
  const state = {
    receive: [],
    change: [],
    coins: coins.map((c): Coin => {
      const a = deriveAddress(account, c.chain, c.index);
      return { ...c, value: BigInt(c.value), status: { confirmed: true, block_height: 101 }, address: a.address, script: a.script };
    }),
    nextReceiveIndex: 2,
    nextChangeIndex: 0,
    confirmed: 80_000n,
    unconfirmed: 0n,
  };
  const signed = signPayment(account, state, { to: request.to, amount: BigInt(request.amount), feeRate: BigInt(request.feeRate) });
  return { coins, ...request, txid: signed.txid, hex: signed.hex };
}

console.log(
  JSON.stringify(
    {
      prfInputV1: bytesToHex(PRF_INPUT_V1),
      prf: {
        prfOutput: bytesToHex(prfOutput),
        entropy: bytesToHex(entropy),
        wallet: prfWallet,
      },
      abandon: wallet(ABANDON),
      payment: payment(),
    },
    null,
    2,
  ),
);
