// The sample wallet the development gallery shows: its keys, addresses,
// coins and history.
//
// All of it is made with the wallet package from one well-known test phrase,
// so every address is a real practice address, the descriptors are real, and
// a payment planned or signed in the gallery is a real practice transaction
// (that is never sent anywhere). Nothing here is secret: the phrase is the
// first test phrase of the BIP39 standard, printed in countless documents.

import {
  GAP_LIMIT,
  accountFromMnemonic,
  deriveAddress,
  watchOnlyAccount,
  type Account,
  type Chain,
  type Coin,
  type TxPart,
  type TxView,
  type WalletAddress,
  type WalletState,
} from '@learnbitcoin/practice-wallet';
import type { PublicRecord } from '../src/lib/wallet-api.ts';

/** The sample wallet's 12 words. */
export const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** The words of everybody else in the sample history: the faucet, the pot, another reader. */
const OTHER_WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

/** The sample wallet's account, private key included: the stand-in signs with it. */
export const ACCOUNT: Account = accountFromMnemonic(WORDS);

const OTHERS = accountFromMnemonic(OTHER_WORDS);

/** Both accounts as a watching wallet sees them: public keys only. */
const OWN_WATCH = watchOnlyAccount(ACCOUNT.xpub);
const OTHERS_WATCH = watchOnlyAccount(OTHERS.xpub);

/** The wallet fingerprint of a second wallet, for "this passkey opened another wallet". */
export const OTHER_FINGERPRINT = OTHERS.masterFingerprint;

/** The tags in the names of the sample passkeys. */
export const TAG = 'K7Q2';
export const OTHER_TAG = 'M3XD';

/** One of the sample wallet's addresses. */
export function ownAddress(chain: Chain, index: number, used = false): WalletAddress {
  return { ...deriveAddress(OWN_WATCH, chain, index), used };
}

/** An address that is not the wallet's: number 0 is the faucet's, 1 the pot's, the rest other readers'. */
export function otherAddress(index: number): string {
  return deriveAddress(OTHERS_WATCH, 0, index).address;
}

/** The pay-it-forward pot's address. */
export const POT_ADDRESS = otherAddress(1);

/** The record this browser would hold for the sample wallet. A passkey wallet's names its passkey. */
export function sampleRecord(kind: 'passkey' | 'words', now: number): PublicRecord {
  const record: PublicRecord = {
    v: 1,
    kind,
    fingerprint: ACCOUNT.masterFingerprint,
    xpub: ACCOUNT.xpub,
    firstAddress: ownAddress(0, 0).address,
    // Made three days ago.
    createdAt: now - 3 * 86_400_000,
  };
  if (kind === 'passkey') {
    record.credentialId = 'Z2FsbGVyeS1zYW1wbGUtcGFzc2tleQ';
    record.tag = TAG;
  }
  return record;
}

/** The height of the practice chain in the sample. */
export const TIP = 5912;

/** Transaction IDs of the sample history, oldest first, and of what the scripted actions add. */
export const TXID = {
  /** The faucet's first payment: 100,000 sats. */
  faucet: '9313b3f0c2e51a3d8d3a014406c490183c131f282d9446f20dc77058015dc250',
  /** Another reader paid 48,782 sats. */
  paidIn: '19bdd090c42099a0dde8b294ef89836dde414e5cc6538e23e450d3ae69c74b87',
  /** The wallet sent 30,000 sats to the pot, with change. */
  sent: '5a08b9a18ac03ba34f0413f71cbd22b215e4b087f44d0d83251688a0bffe1177',
  /** Another reader paid 54,321 sats. */
  paidInAgain: 'e6b271f3da1d98e56feb1c84f36a6026507e3e3fb9ace36d88d6b3ba21c48670',
  /** 25,000 sats that are still unconfirmed. */
  arriving: '2218ef42a6c2431f79045ec376adf13ae2e7595e78c82d93cde42fc970d251ab',
  /** What the faucet pays when asked in the gallery. */
  faucetNew: '30d2d0f17b986e9a241c4803918278947e0225a7dc708ebe840b5082f0ed3336',
  /** The pot transaction that a faucet payment "from the pot" spends. */
  pot: 'e0d0196a90fc7f0612f984025d11ad775302f2199189a450b0ea3bc661116633',
} as const;

/** How many addresses of each chain a scan lists: the used ones and the gap after them. */
function addressList(chain: Chain, used: number): WalletAddress[] {
  return Array.from({ length: used + GAP_LIMIT }, (_, index) => ownAddress(chain, index, index < used));
}

function coin(txid: string, vout: number, value: bigint, at: WalletAddress, height: number | null): Coin {
  return {
    txid,
    vout,
    value,
    status: height === null ? { confirmed: false } : { confirmed: true, block_height: height },
    chain: at.chain,
    index: at.index,
    address: at.address,
    script: at.script,
  };
}

/** A wallet that has been scanned and holds nothing. */
export function emptyState(): WalletState {
  return {
    receive: addressList(0, 0),
    change: addressList(1, 0),
    coins: [],
    nextReceiveIndex: 0,
    nextChangeIndex: 0,
    confirmed: 0n,
    unconfirmed: 0n,
  };
}

/**
 * A wallet with some history: four coins, one of them change and one still
 * unconfirmed. 172,821 sats confirmed and 25,000 on their way.
 */
export function fundedState(): WalletState {
  const receive = addressList(0, 4);
  const change = addressList(1, 1);
  const at = (list: WalletAddress[], index: number): WalletAddress => {
    const address = list[index];
    if (!address) throw new Error('sample: no such address');
    return address;
  };
  const coins = [
    coin(TXID.faucet, 0, 100_000n, at(receive, 0), TIP - 40),
    coin(TXID.sent, 1, 18_500n, at(change, 0), TIP - 12),
    coin(TXID.paidInAgain, 0, 54_321n, at(receive, 2), TIP - 3),
    coin(TXID.arriving, 1, 25_000n, at(receive, 3), null),
  ];
  return {
    receive,
    change,
    coins,
    nextReceiveIndex: 4,
    nextChangeIndex: 1,
    confirmed: 172_821n,
    unconfirmed: 25_000n,
  };
}

const mine = (chain: Chain, index: number, value: bigint): TxPart => ({
  address: ownAddress(chain, index).address,
  value,
  mine: true,
  change: chain === 1,
});
const theirs = (index: number, value: bigint): TxPart => ({
  address: otherAddress(index),
  value,
  mine: false,
  change: false,
});

/** The sample wallet's five transactions, newest first. `now` is in milliseconds since 1970. */
export function sampleHistory(now: number): TxView[] {
  /** A block's time, from how many blocks ago it was: a block every 30 seconds. */
  const blockTime = (height: number): number => Math.floor(now / 1000) - (TIP - height) * 30;
  const confirmed = (height: number) => ({ confirmed: true, height, time: blockTime(height) });
  const unconfirmed = { confirmed: false, height: null, time: null };
  const simple = { vsize: 141, feeRate: 2, fee: 282n, rbf: true };
  return [
    {
      txid: TXID.arriving,
      ...unconfirmed,
      inputs: [theirs(3, 80_000n)],
      outputs: [theirs(4, 54_718n), mine(0, 3, 25_000n)],
      ...simple,
      net: 25_000n,
      direction: 'received',
    },
    {
      txid: TXID.paidInAgain,
      ...confirmed(TIP - 3),
      inputs: [theirs(2, 60_000n)],
      outputs: [mine(0, 2, 54_321n), theirs(5, 5_397n)],
      ...simple,
      net: 54_321n,
      direction: 'received',
    },
    {
      txid: TXID.sent,
      ...confirmed(TIP - 12),
      inputs: [mine(0, 1, 48_782n)],
      outputs: [{ address: POT_ADDRESS, value: 30_000n, mine: false, change: false }, mine(1, 0, 18_500n)],
      ...simple,
      net: -30_282n,
      direction: 'sent',
    },
    {
      txid: TXID.paidIn,
      ...confirmed(TIP - 20),
      inputs: [theirs(2, 120_000n)],
      outputs: [mine(0, 1, 48_782n), theirs(6, 70_936n)],
      ...simple,
      net: 48_782n,
      direction: 'received',
    },
    {
      txid: TXID.faucet,
      ...confirmed(TIP - 40),
      inputs: [theirs(0, 5_000_000n)],
      outputs: [mine(0, 0, 100_000n), theirs(0, 4_899_718n)],
      ...simple,
      net: 100_000n,
      direction: 'received',
    },
  ];
}
