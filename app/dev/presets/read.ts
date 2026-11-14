// Presets for the wallet's four looking screens (Overview, Coins, Activity
// and one transaction): the states the base presets do not reach.
//
//   opened-empty         a passkey wallet that was just opened and has no history: the
//                        Overview explains the likely causes (add unlock=other-passkey,
//                        unlock=cancelled and so on to choose how "Choose another passkey" ends)
//   opened-empty-switch  the same after another passkey answered: the list of causes asks
//                        whether to switch this browser to that passkey's wallet. The wallet
//                        stays unlocked while it asks
//   spent-all            a wallet that has spent every coin: no coins, but a history
//   history-failed       funded; the list of transactions could not be read again, and the
//                        list as it was last read stays
//   history-unread       funded; the list of transactions has never been read, and the
//                        read failed
//   network-failed       funded; the latest look at the coins failed and so did the read of
//                        the list: the wallet frame says why, once, and the list as it was
//                        last read stays under one small line
//   network-unread       the same, with a list that has never been read
//   tx-kinds             funded, with four more transactions in the history, for the
//                        screen of one transaction (their IDs are in TX below):
//                          other      another wallet's transaction
//                          internal   the wallet paying itself
//                          silent     unconfirmed, without the replace-by-fee signal
//                          untimed    in a block whose time is not known
//
// The transaction screen's other answers come from the query string, on any
// preset with a history: lookup=waiting, lookup=not-found, lookup=network.

import type { TxPart, TxView } from '@learnbitcoin/practice-wallet';
import {
  OTHER_FINGERPRINT,
  OTHER_TAG,
  TIP,
  emptyState,
  fundedState,
  otherAddress,
  ownAddress,
  sampleHistory,
} from '../sample.ts';
import type { Preset, StandIn } from '../stand-in.svelte.ts';

/** The IDs of the four transactions that "tx-kinds" adds. */
export const TX = {
  other: 'a3f1c2d4e5b60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00',
  internal: 'b4e2d3c5f6a718293a4b5c6d7e8f9011223344556677889900aabbccddeeff11',
  silent: 'c5d3e4f6a7b8293a4b5c6d7e8f90112233445566778899001122aabbccddee22',
  untimed: 'd6c4f5a7b8c93a4b5c6d7e8f9011223344556677889900112233aabbccddee33',
} as const;

const mine = (chain: 0 | 1, index: number, value: bigint): TxPart => ({
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

/** Four transactions of kinds the sample history lacks. */
function moreHistory(now: number): TxView[] {
  const blockTime = (height: number): number => Math.floor(now / 1000) - (TIP - height) * 30;
  const simple = { vsize: 141, feeRate: 2, fee: 282n };
  return [
    {
      txid: TX.silent,
      confirmed: false,
      height: null,
      time: null,
      inputs: [theirs(7, 40_000n)],
      outputs: [mine(0, 4, 12_000n), theirs(8, 27_718n)],
      ...simple,
      rbf: false,
      net: 12_000n,
      direction: 'received',
    },
    {
      txid: TX.other,
      confirmed: true,
      height: TIP - 5,
      time: blockTime(TIP - 5),
      inputs: [theirs(9, 50_000n)],
      outputs: [theirs(10, 20_000n), theirs(11, 29_718n)],
      ...simple,
      rbf: true,
      net: 0n,
      direction: 'other',
    },
    {
      txid: TX.internal,
      confirmed: true,
      height: TIP - 8,
      time: blockTime(TIP - 8),
      inputs: [mine(0, 2, 54_321n)],
      outputs: [mine(0, 5, 30_000n), mine(1, 1, 24_039n)],
      ...simple,
      rbf: true,
      net: -282n,
      direction: 'internal',
    },
    {
      txid: TX.untimed,
      confirmed: true,
      height: TIP - 30,
      time: null,
      inputs: [theirs(12, 9_000n)],
      outputs: [mine(0, 6, 8_718n)],
      ...simple,
      rbf: false,
      net: 8_718n,
      direction: 'received',
    },
  ];
}

/** A passkey wallet, unlocked as it is straight after "Open with my passkey", with nothing found. */
function openedEmpty(wallet: StandIn): void {
  wallet.haveWallet('passkey', true);
  wallet.haveCoins(emptyState(), []);
  wallet.openedEmpty = true;
}

export const presets: Record<string, Preset> = {
  'opened-empty': openedEmpty,

  'opened-empty-switch': (wallet) => {
    openedEmpty(wallet);
    // Another passkey answered "Choose another passkey". Nothing has changed: the wallet is still unlocked.
    wallet.pendingSwitch = { tag: OTHER_TAG, fingerprint: OTHER_FINGERPRINT };
  },

  'spent-all': (wallet) => {
    wallet.haveWallet('passkey');
    wallet.haveCoins(emptyState(), sampleHistory(Date.now()));
  },

  'history-failed': (wallet) => {
    wallet.haveWallet('passkey');
    wallet.haveCoins(fundedState(), []);
    // The list as it was last read stays, with why the latest read failed.
    wallet.history = sampleHistory(Date.now());
    wallet.historyError = 'unavailable';
  },

  'history-unread': (wallet) => {
    wallet.haveWallet('passkey');
    // The coins are known, the list has never been read, and its first read failed.
    wallet.chain = { ...wallet.chain, state: fundedState(), checkedAt: Date.now() - 20_000, tip: TIP };
    wallet.historyError = 'network';
  },

  'network-failed': (wallet) => {
    wallet.haveWallet('passkey');
    wallet.haveCoins(fundedState(), []);
    wallet.history = sampleHistory(Date.now());
    wallet.historyError = 'unavailable';
    // The coins are from the last look that worked, three minutes ago; the next try is 40 seconds away.
    wallet.chain = { ...wallet.chain, error: 'unavailable', checkedAt: Date.now() - 180_000, retryAt: Date.now() + 40_000 };
  },

  'network-unread': (wallet) => {
    wallet.haveWallet('passkey');
    wallet.chain = {
      ...wallet.chain,
      state: fundedState(),
      error: 'limit',
      checkedAt: Date.now() - 180_000,
      retryAt: Date.now() + 40_000,
      tip: TIP,
    };
    wallet.historyError = 'limit';
  },

  'tx-kinds': (wallet) => {
    wallet.haveWallet('passkey');
    const now = Date.now();
    // Newest first, as the wallet hands its list over: the unconfirmed ones, then by block from the tip down.
    const age = (tx: TxView): number => (tx.height === null ? -1 : TIP - tx.height);
    const history = [...moreHistory(now), ...sampleHistory(now)].sort((a, b) => age(a) - age(b));
    wallet.haveCoins(fundedState(), history);
  },
};
