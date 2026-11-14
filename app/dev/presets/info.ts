// Presets for the two reading screens, the Sparrow page and About: the
// states that the base presets and the query keys do not reach.
//
//   info-other-network  a wallet made without a passkey, on settings that are not the built-in
//                       ones: long host names, another port, another block interval, another
//                       faucet amount, and counting switched on. Every fact on the two screens
//                       must follow, and the long names must fit a small phone
//   info-singular       the smallest settings there can be: a block each second, and a faucet
//                       that gives one sat. For the two sentences that have a singular form
//   info-no-descriptor  a wallet whose descriptor cannot be worked out: step 5 of the Sparrow
//                       page then says so in place of the line to copy, with no link to
//                       Settings (which could not show it either), and the 12-word way stays
//
// The other states of the two screens need no preset of their own:
//   /sparrow?state=none, words, passkey-locked, unreadable, newer, broken
//   /about?state=none, words, passkey-locked, unreadable, newer, broken, and &events=yes
//   /about?state=none&botcheck=none   the faucet is closed: a line under its amount says so
//   /about?state=none&passkeys=unknown   the server's settings have not arrived yet: neither
//                       the counting line nor the line about a closed faucet is drawn

import { emptyState } from '../sample.ts';
import type { Preset } from '../stand-in.svelte.ts';

export const presets: Record<string, Preset> = {
  'info-other-network': (wallet) => {
    wallet.haveWallet('words');
    wallet.haveCoins(emptyState(), []);
    wallet.config = {
      ...wallet.config,
      electrumHost: 'electrum.practice-network.example.org',
      electrumPort: 60002,
      explorerUrl: 'https://explorer.practice-network.example.org',
      blockSeconds: 45,
      faucetSats: 2_500_000,
      events: true,
    };
  },

  'info-singular': (wallet) => {
    wallet.config = { ...wallet.config, blockSeconds: 1, faucetSats: 1 };
  },

  'info-no-descriptor': (wallet) => {
    wallet.haveWallet('passkey');
    wallet.haveCoins(emptyState(), []);
    wallet.descriptors = () => null;
  },
};
