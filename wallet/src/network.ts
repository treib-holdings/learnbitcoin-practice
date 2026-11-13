// Network constants for the LearnBitcoin practice network.
//
// The practice network is a regtest chain run by LearnBitcoin. Regtest uses
// the same address version bytes and extended-key versions as testnet, but
// its bech32 addresses start with "bcrt1" instead of "tb1". None of these
// constants can produce a mainnet address: the wallet never touches real
// bitcoin.

import type { BTC_NETWORK } from '@scure/btc-signer/utils.js';

/** Address encoding for regtest: bech32 prefix "bcrt", testnet version bytes. */
export const REGTEST: BTC_NETWORK = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

/** BIP32 version bytes for test networks (tprv / tpub), as Bitcoin Core uses them. */
export const TEST_VERSIONS = { private: 0x04358394, public: 0x043587cf } as const;

/** BIP84 account path on test networks: purpose 84', coin type 1', account 0'. */
export const ACCOUNT_PATH = "m/84'/1'/0'";

/** The same path in the "h" notation that descriptors use. */
export const ACCOUNT_PATH_DESCRIPTOR = '84h/1h/0h';

/** BIP125 opt-in replace-by-fee sequence number. */
export const RBF_SEQUENCE = 0xfffffffd;

/** BIP44 gap limit: stop scanning after this many unused addresses in a row. */
export const GAP_LIMIT = 20;
