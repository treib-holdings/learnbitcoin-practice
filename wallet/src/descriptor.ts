// Output descriptors (BIP380/BIP382) for exporting the practice wallet.
//
// A descriptor tells another wallet exactly which addresses belong to this
// one. Bitcoin Core's importdescriptors needs the 8-character checksum after
// the "#", computed by the polynomial below (BIP380's reference algorithm).

import { ACCOUNT_PATH_DESCRIPTOR } from './network.ts';
import type { Chain } from './keys.ts';

const INPUT_CHARSET =
  "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn];

function polymod(symbols: number[]): bigint {
  let chk = 1n;
  for (const value of symbols) {
    const top = chk >> 35n;
    chk = ((chk & 0x7ffffffffn) << 5n) ^ BigInt(value);
    for (let i = 0; i < 5; i++) {
      if ((top >> BigInt(i)) & 1n) chk ^= GENERATOR[i]!;
    }
  }
  return chk;
}

function expand(descriptor: string): number[] {
  const symbols: number[] = [];
  let groups: number[] = [];
  for (const c of descriptor) {
    const v = INPUT_CHARSET.indexOf(c);
    if (v < 0) throw new Error(`Character not allowed in a descriptor: ${JSON.stringify(c)}`);
    symbols.push(v & 31);
    groups.push(v >> 5);
    if (groups.length === 3) {
      symbols.push(groups[0]! * 9 + groups[1]! * 3 + groups[2]!);
      groups = [];
    }
  }
  if (groups.length === 1) symbols.push(groups[0]!);
  else if (groups.length === 2) symbols.push(groups[0]! * 3 + groups[1]!);
  return symbols;
}

/** The 8-character BIP380 checksum of a descriptor (without any existing "#..."). */
export function descriptorChecksum(descriptor: string): string {
  const checksum = polymod([...expand(descriptor), 0, 0, 0, 0, 0, 0, 0, 0]) ^ 1n;
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += CHECKSUM_CHARSET[Number((checksum >> BigInt(5 * (7 - i))) & 31n)];
  }
  return out;
}

/** Append "#checksum". */
export function withChecksum(descriptor: string): string {
  return `${descriptor}#${descriptorChecksum(descriptor)}`;
}

/**
 * The public descriptor for one chain of the practice account, with checksum:
 * wpkh([fingerprint/84h/1h/0h]tpub.../0/*)#xxxxxxxx
 * Safe to share: it reveals addresses, not keys.
 */
export function accountDescriptor(masterFingerprint: string, xpub: string, chain: Chain): string {
  if (!/^[0-9a-f]{8}$/.test(masterFingerprint)) throw new Error('Fingerprint must be 8 lower-case hex characters');
  return withChecksum(`wpkh([${masterFingerprint}/${ACCOUNT_PATH_DESCRIPTOR}]${xpub}/${chain}/*)`);
}
