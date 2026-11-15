// Presets for the Backup and Settings screens: the states that are hard to
// reach by hand.
//
//   made-passkey         straight after "Create with a passkey": Backup opens as the
//                        "Wallet made" step, the wallet unlocked and still empty
//   made-passkey-unnamed the same, where the wallet was not told the name the passkey
//                        was saved under: the step shows the tag in its place
//   made-words           straight after "Create without a passkey": the same step,
//                        and the browser agreed to keep this page's data
//   made-words-not-kept  the same, and the browser did not agree
//   words-not-kept       a wallet made without a passkey, with coins; the browser did
//                        not agree to keep this page's data (Settings says so)
//   words-later          the same wallet on a later visit: the browser was not asked
//                        again, so whether it keeps the data is not known
//   passkey-untagged     a passkey wallet whose passkey has no tag this browser knows
//                        (it was opened with a passkey this page did not name)
//   reveal-fails         a wallet made without a passkey that gives no words when asked
//   no-descriptors       a wallet whose descriptors cannot be worked out
//
// Every other state of the two screens is one of the base presets: "words",
// "passkey-locked" and "passkey-unlocked" for Backup and Settings at any
// other time, with unlock=<answer> for the unlock step and remove=gone for
// a Remove that found the wallet changed.
//
// With ?kind= or ?unlocked= in the address the factory puts the sample
// wallet in place a second time, and what a preset set on the record or
// about the browser's answer is then the sample's again.

import { emptyState, fundedState, sampleHistory } from '../sample.ts';
import type { Preset, StandIn } from '../stand-in.svelte.ts';

/** The sample wallet made without a passkey, with its coins and history. */
function wordsWallet(wallet: StandIn): void {
  wallet.haveWallet('words');
  wallet.haveCoins(fundedState(), sampleHistory(Date.now()));
}

/** A wallet of this kind that was made a moment ago: unlocked, scanned, empty. */
function justMade(wallet: StandIn, kind: 'passkey' | 'words'): void {
  wallet.haveWallet(kind, true);
  wallet.haveCoins(emptyState(), []);
  wallet.justCreated(kind);
}

export const presets: Record<string, Preset> = {
  'made-passkey': (wallet) => justMade(wallet, 'passkey'),

  'made-passkey-unnamed': (wallet) => {
    justMade(wallet, 'passkey');
    wallet.createdName = null;
  },

  'made-words': (wallet) => justMade(wallet, 'words'),

  'made-words-not-kept': (wallet) => {
    justMade(wallet, 'words');
    wallet.persisted = false;
  },

  'words-not-kept': (wallet) => {
    wordsWallet(wallet);
    wallet.persisted = false;
  },

  // As the base preset "words" is: on a later visit the browser is not asked again.
  'words-later': wordsWallet,

  'passkey-untagged': (wallet) => {
    wallet.haveWallet('passkey');
    wallet.haveCoins(fundedState(), sampleHistory(Date.now()));
    if (wallet.record === null) return;
    // A copy of the record without its tag: values are swapped whole, never changed in place.
    const { tag: _tag, ...untagged } = wallet.record;
    wallet.record = untagged;
  },

  'reveal-fails': (wallet) => {
    wordsWallet(wallet);
    wallet.answers.reveal = 'none';
  },

  'no-descriptors': (wallet) => {
    wordsWallet(wallet);
    wallet.answers.descriptors = 'none';
  },
};
