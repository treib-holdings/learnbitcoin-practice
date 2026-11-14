// The presets every screen needs: the states of SPEC section 3.
//
// A preset is a function that puts a new stand-in into one state. To add
// one for your screen, make a file next to this one that exports `presets`
// the same way (presets/receive.ts, say). It is picked up by itself: its
// names can then be used as ?state=<name>, and the page /gallery lists them.
// Leave this file as it is, so that two people adding presets never touch
// the same file. A name must be new: one that two files both use stops the
// gallery with an error that says so.

import { emptyState, fundedState, sampleHistory } from '../sample.ts';
import type { Preset, StandIn } from '../stand-in.svelte.ts';

/** The sample wallet with its coins and history, as a passkey wallet that is locked. */
function funded(wallet: StandIn): void {
  wallet.haveWallet('passkey');
  wallet.haveCoins(fundedState(), sampleHistory(Date.now()));
}

export const presets: Record<string, Preset> = {
  none: () => {},

  words: (wallet) => {
    funded(wallet);
    wallet.haveWallet('words');
  },

  'passkey-locked': funded,

  'passkey-unlocked': (wallet) => {
    funded(wallet);
    wallet.haveWallet('passkey', true);
  },

  scanning: (wallet) => {
    wallet.haveWallet('passkey');
    wallet.chain = { ...wallet.chain, scanning: true };
  },

  'scan-failed': (wallet) => {
    wallet.haveWallet('passkey');
    // The app tries again by itself: 15 seconds after the first failure.
    wallet.chain = { ...wallet.chain, error: 'unavailable', retryAt: Date.now() + 15_000 };
  },

  'no-coins': (wallet) => {
    wallet.haveWallet('passkey');
    wallet.haveCoins(emptyState(), []);
  },

  funded,

  'refresh-failed': (wallet) => {
    funded(wallet);
    // The last values stay, with when they were last checked.
    wallet.chain = {
      ...wallet.chain,
      error: 'network',
      checkedAt: Date.now() - 180_000,
      retryAt: Date.now() + 45_000,
    };
  },

  slow: (wallet) => {
    funded(wallet);
    wallet.chain = { ...wallet.chain, slow: true };
  },

  unreadable: (wallet) => {
    wallet.status = 'unreadable';
  },

  newer: (wallet) => {
    wallet.status = 'newer';
  },

  broken: (wallet) => {
    wallet.status = 'broken';
  },
};
