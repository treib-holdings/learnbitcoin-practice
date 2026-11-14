// Presets for the Receive screen: the states of a request to the faucet that
// a look at the gallery cannot reach by itself, because they come and go in
// a moment, or need a faucet that refuses.
//
// Each is a passkey wallet, locked, that holds no coins yet (lay ?kind=words
// over it for a wallet made without a passkey). Open any of them at
// /wallet/receive?state=<name>, or at /es/wallet/receive?state=<name>.
//
// The base presets already show the rest on this screen: "scanning" and
// "scan-failed" (no address yet), "no-coins" and "funded" (before the tap),
// and any of them with ?botcheck=none (the faucet is closed), or with
// ?botcheck=none&passkeys=unknown (the settings have not arrived yet: the
// card says only that it is loading). To watch a whole request play, open
// "no-coins" in the gallery's live server and press the button:
// ?faucet=busy waits and then pays, ?faucet=ok-pot pays with a coin from
// the pot.
//
// One state no preset can show: a bot check whose box was not ticked in
// time. The gallery never runs the bot check, and that sentence comes from
// what the screen itself saw of the widget. e2e/scenarios/receive.test.ts
// plays it in the real app.
//
//   receive-checking            the bot check is running
//   receive-asking              the request is with the faucet
//   receive-waiting-busy        refused for now (busy); the page asks again in 20 s
//   receive-waiting-refilling   the same, the faucet is out of coins
//   receive-waiting-limit       the same, the reader asked too fast
//   receive-promised            on its way, with a payment record
//   receive-promised-pot        the same, paid with a coin from the pot
//   receive-paid-before         on its way, no record: the faucet has paid this address before
//   receive-arrived             the coin is here, unconfirmed
//   receive-arrived-no-record   the same, without a payment record
//   receive-confirmed           the coin is in a block
//   receive-confirmed-no-record the same, without a payment record
//   receive-coins-arrived       coins came from somewhere else; nothing was asked of the faucet
//   receive-held                coins are here and the faucet is being asked again: the address is held
//   receive-held-promised       coins are here and the faucet has promised more: the address is held until they come
//   receive-failed-<failure>    stopped, for every kind of way out: no-token, bot-check,
//                               network, unavailable, gave-up, closed, bad-address, own-address

import { emptyState, TXID } from '../sample.ts';
import type { Preset, StandIn } from '../stand-in.svelte.ts';
import type { FaucetFailure, FaucetView } from '../../src/lib/wallet-api.ts';

const IDLE: FaucetView = { phase: 'idle', payment: null, failure: null, retryAt: null };

/** A locked passkey wallet with no coins: the wallet that most needs the faucet. */
function fresh(wallet: StandIn): void {
  wallet.haveWallet('passkey');
  wallet.haveCoins(emptyState(), []);
}

/** The record of what the faucet promised. `pot`: the payment spent a coin from the pay-it-forward pot. */
function payment(wallet: StandIn, pot = false) {
  return { txid: TXID.faucetNew, amountSats: wallet.config.faucetSats, potTxid: pot ? TXID.pot : null };
}

/** That many sats have been seen arriving at the address on screen. */
function arrive(wallet: StandIn, sats: number): void {
  if (wallet.receive !== null) wallet.receive = { ...wallet.receive, arrived: BigInt(sats) };
}

/** A request that stopped with `failure`. */
function failed(failure: FaucetFailure): Preset {
  return (wallet) => {
    fresh(wallet);
    wallet.faucet = { ...IDLE, phase: 'failed', failure };
  };
}

/** A request the faucet refused for now with `failure`: the page asks again in 20 seconds. */
function waiting(failure: FaucetFailure): Preset {
  return (wallet) => {
    fresh(wallet);
    wallet.faucet = { ...IDLE, phase: 'waiting', failure, retryAt: Date.now() + 20_000 };
  };
}

export const presets: Record<string, Preset> = {
  'receive-checking': (wallet) => {
    fresh(wallet);
    wallet.faucet = { ...IDLE, phase: 'checking' };
  },

  'receive-asking': (wallet) => {
    fresh(wallet);
    wallet.faucet = { ...IDLE, phase: 'asking' };
  },

  'receive-waiting-busy': waiting('busy'),
  'receive-waiting-refilling': waiting('refilling'),
  'receive-waiting-limit': waiting('limit'),

  'receive-promised': (wallet) => {
    fresh(wallet);
    wallet.faucet = { ...IDLE, phase: 'on-its-way', payment: payment(wallet) };
  },

  'receive-promised-pot': (wallet) => {
    fresh(wallet);
    wallet.faucet = { ...IDLE, phase: 'on-its-way', payment: payment(wallet, true) };
  },

  'receive-paid-before': (wallet) => {
    fresh(wallet);
    wallet.faucet = { ...IDLE, phase: 'on-its-way' };
  },

  'receive-arrived': (wallet) => {
    fresh(wallet);
    arrive(wallet, wallet.config.faucetSats);
    wallet.faucet = { ...IDLE, phase: 'arrived', payment: payment(wallet) };
  },

  'receive-arrived-no-record': (wallet) => {
    fresh(wallet);
    arrive(wallet, wallet.config.faucetSats);
    wallet.faucet = { ...IDLE, phase: 'arrived' };
  },

  'receive-confirmed': (wallet) => {
    fresh(wallet);
    arrive(wallet, wallet.config.faucetSats);
    wallet.faucet = { ...IDLE, phase: 'confirmed', payment: payment(wallet, true) };
  },

  'receive-confirmed-no-record': (wallet) => {
    fresh(wallet);
    arrive(wallet, wallet.config.faucetSats);
    wallet.faucet = { ...IDLE, phase: 'confirmed' };
  },

  'receive-coins-arrived': (wallet) => {
    fresh(wallet);
    arrive(wallet, 48_782);
  },

  'receive-held': (wallet) => {
    fresh(wallet);
    arrive(wallet, 1);
    wallet.faucet = { ...IDLE, phase: 'asking' };
  },

  'receive-held-promised': (wallet) => {
    fresh(wallet);
    arrive(wallet, 2_500);
    wallet.faucet = { ...IDLE, phase: 'on-its-way', payment: payment(wallet) };
  },

  'receive-failed-no-token': failed('no-token'),
  'receive-failed-bot-check': failed('bot_check'),
  'receive-failed-network': failed('network'),
  'receive-failed-unavailable': failed('unavailable'),
  'receive-failed-gave-up': failed('gave-up'),
  'receive-failed-closed': failed('closed'),
  'receive-failed-bad-address': failed('bad_address'),
  'receive-failed-own-address': failed('own_address'),
};
