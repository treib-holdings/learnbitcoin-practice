// Prints the wallet's test vectors as JSON (node test/make-vectors.ts > test/vectors.json).
// The values are then checked independently: HKDF against Python's standard
// library, addresses and descriptor checksums against Bitcoin Core on regtest
// (tools/regtest-crosscheck). Keep vectors.json in git; never regenerate it
// to make a failing test pass.

import { bytesToHex } from '@noble/hashes/utils.js';
import {
  PRF_INPUT_V1,
  accountDescriptor,
  accountFromMnemonic,
  deriveAddress,
  entropyFromPrf,
  mnemonicFromEntropy,
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

const prfOutput = new Uint8Array(32).fill(1);
const entropy = entropyFromPrf(prfOutput);

console.log(
  JSON.stringify(
    {
      prfInputV1: bytesToHex(PRF_INPUT_V1),
      prf: {
        prfOutput: bytesToHex(prfOutput),
        entropy: bytesToHex(entropy),
        wallet: wallet(mnemonicFromEntropy(entropy)),
      },
      abandon: wallet('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
    },
    null,
    2,
  ),
);
