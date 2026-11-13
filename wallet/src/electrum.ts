// Electrum servers look addresses up by "script hash": the SHA-256 of the
// output script, written in reverse byte order. Sparrow and Electrum desktop
// ask the practice network's Electrum port this way.

import { hex } from '@scure/base';
import { Address, OutScript } from '@scure/btc-signer';
import type { BTC_NETWORK } from '@scure/btc-signer/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { REGTEST } from './network.ts';

/** The Electrum protocol's script hash for an address (reversed SHA-256 of its output script, hex). */
export function electrumScripthash(address: string, network: BTC_NETWORK = REGTEST): string {
  const script = OutScript.encode(Address(network).decode(address));
  return hex.encode(sha256(script).reverse());
}
