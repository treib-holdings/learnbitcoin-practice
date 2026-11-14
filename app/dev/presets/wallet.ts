// Presets for the pieces every wallet screen shares (src/components/wallet):
// the states of the wallet frame and of the unlock step that the base
// presets do not reach.
//
//   scan-retrying          the first look at the coins failed, and another try is running now
//   stale-and-slow         funded; the last refresh failed, and the practice network is slow as well
//   switch-pending         funded and locked; another passkey answered the last unlock, and the
//                          reader has not yet said whether to switch to its wallet
//   switch-pending-unnamed the same, from a passkey whose name is not known

import { OTHER_FINGERPRINT, OTHER_TAG, fundedState, sampleHistory } from '../sample.ts';
import type { Preset, StandIn } from '../stand-in.svelte.ts';

/** The sample wallet with its coins and history, as a passkey wallet that is locked. */
function funded(wallet: StandIn): void {
  wallet.haveWallet('passkey');
  wallet.haveCoins(fundedState(), sampleHistory(Date.now()));
}

export const presets: Record<string, Preset> = {
  'scan-retrying': (wallet) => {
    wallet.haveWallet('passkey');
    wallet.chain = { ...wallet.chain, error: 'unavailable', scanning: true };
  },

  'stale-and-slow': (wallet) => {
    funded(wallet);
    wallet.chain = {
      ...wallet.chain,
      error: 'unavailable',
      checkedAt: Date.now() - 400_000,
      retryAt: Date.now() + 60_000,
      slow: true,
    };
  },

  'switch-pending': (wallet) => {
    funded(wallet);
    wallet.pendingSwitch = { tag: OTHER_TAG, fingerprint: OTHER_FINGERPRINT };
  },

  'switch-pending-unnamed': (wallet) => {
    funded(wallet);
    wallet.pendingSwitch = { tag: null, fingerprint: OTHER_FINGERPRINT };
  },
};
