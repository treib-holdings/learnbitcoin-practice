// Presets for the Send screen: the states of its form that the base
// presets do not reach, and one answer the stand-in has no query value for.
//
//   send-unconfirmed-only  a wallet made without a passkey whose one coin is still
//                          unconfirmed: nothing can be spent until the next block
//   send-small-coin        one confirmed coin of 400 sats: too small to pay its own
//                          fee and leave anything worth sending, so "Send all"
//                          cannot be made and every amount is refused
//   send-dusty             the faucet's coin beside five coins of about 300 sats.
//                          At a high fee rate (type 250) "Send all" cannot be made,
//                          because it would spend the small coins too, while an
//                          ordinary payment from the large coin still goes through
//   send-too-large         the funded wallet, made without a passkey, on a network
//                          that answers "too_large" to every payment
//   send-keys-fail         the funded wallet, made without a passkey, whose keys do
//                          not load: signing answers "locked" and goes on doing so.
//                          The real wallet should never do this; the screen still
//                          has to say something true if it does
//   send-answer-lost       the funded wallet on a network that takes the payment
//                          and then cannot answer: the first try ends "unavailable",
//                          the look for the transaction finds it, and the same
//                          payment handed in again is taken. The screen ends at
//                          "Payment sent", never at "not sent"
//   send-in-a-block        the funded wallet on a network whose next block is
//                          there at once: the sent view opens on the payment as
//                          confirmed, with the block that took it in
//
// Every other state of the screen comes from a base preset and the query
// keys of the stand-in, for example:
//
//   /wallet/send?state=words                           the form, with coins
//   /wallet/send?state=passkey-locked                  Continue leads to the unlock step
//   /wallet/send?state=passkey-locked&unlock=reload    the unlock step after the bot check
//   /wallet/send?state=words&broadcast=coin_spent      a payment the node refuses
//   /wallet/send?state=words&broadcast=network         no answer about the payment: it may be sent again
//   /wallet/send?state=words&broadcast=unavailable     the same after "could not answer" and a look that found nothing
//   /wallet/send?state=passkey-locked&delay=1500       the unlock step with a prompt that stays open for a moment
//   /wallet/send?state=words&pot=unavailable           "Pass it on" fails
//   /wallet/send?state=words&sign=too-much             signing refused after the plan stood

import type { Coin, WalletState } from '@learnbitcoin/practice-wallet';
import { TIP, TXID, emptyState, fundedState, ownAddress, sampleHistory } from '../sample.ts';
import type { Preset, StandIn } from '../stand-in.svelte.ts';

/** A coin on one of the sample wallet's receive addresses. `height` null: still unconfirmed. */
function coinAt(index: number, txid: string, value: bigint, height: number | null): Coin {
  const at = ownAddress(0, index, true);
  return {
    txid,
    vout: 0,
    value,
    status: height === null ? { confirmed: false } : { confirmed: true, block_height: height },
    chain: at.chain,
    index: at.index,
    address: at.address,
    script: at.script,
  };
}

/** A scanned wallet that holds exactly these coins, one on each of its first receive addresses. */
function stateWith(coins: Coin[]): WalletState {
  const empty = emptyState();
  let confirmed = 0n;
  let unconfirmed = 0n;
  for (const coin of coins) {
    if (coin.status.confirmed) confirmed += coin.value;
    else unconfirmed += coin.value;
  }
  return {
    ...empty,
    receive: empty.receive.map((address) => (address.index < coins.length ? { ...address, used: true } : address)),
    coins,
    nextReceiveIndex: coins.length,
    confirmed,
    unconfirmed,
  };
}

/** Transaction IDs for coins the sample history does not explain: any 64 hex characters will do. */
const madeUp = (index: number): string => (0xa0 + index).toString(16).repeat(32);

function have(wallet: StandIn, coins: Coin[]): void {
  wallet.haveWallet('words');
  wallet.haveCoins(stateWith(coins), []);
}

export const presets: Record<string, Preset> = {
  'send-unconfirmed-only': (wallet) => have(wallet, [coinAt(0, TXID.faucetNew, 100_000n, null)]),

  'send-small-coin': (wallet) => have(wallet, [coinAt(0, madeUp(0), 400n, TIP - 5)]),

  'send-dusty': (wallet) =>
    have(wallet, [
      coinAt(0, TXID.faucet, 100_000n, TIP - 40),
      ...[300n, 310n, 320n, 330n, 340n].map((value, index) => coinAt(index + 1, madeUp(index + 1), value, TIP - 9 + index)),
    ]),

  'send-keys-fail': (wallet) => {
    wallet.haveWallet('words');
    wallet.haveCoins(fundedState(), sampleHistory(Date.now()));
    // The stand-in always holds the keys of a wallet made without a passkey, so this preset answers for it.
    wallet.sign = () => ({ ok: false, reason: 'locked' });
  },

  'send-answer-lost': (wallet) => {
    wallet.haveWallet('words');
    wallet.haveCoins(fundedState(), sampleHistory(Date.now()));
    const taken = wallet.broadcast.bind(wallet);
    const looked = wallet.lookupTx.bind(wallet);
    /** The payment the network has taken without saying so. */
    let lost: string | null = null;
    wallet.broadcast = async (payment) => {
      if (lost === payment.txid) return taken(payment);
      lost = payment.txid;
      await new Promise((done) => setTimeout(done, wallet.delay));
      return { ok: false, reason: 'unavailable', detail: null };
    };
    wallet.lookupTx = async (txid) => {
      if (txid !== lost) return looked(txid);
      await new Promise((done) => setTimeout(done, wallet.delay));
      // Any view will do: the screen only asks whether the network knows the transaction.
      return { kind: 'found', view: sampleHistory(Date.now())[0]! };
    };
  },

  'send-in-a-block': (wallet) => {
    wallet.haveWallet('words');
    wallet.haveCoins(fundedState(), sampleHistory(Date.now()));
    const looked = wallet.lookupTx.bind(wallet);
    wallet.lookupTx = async (txid) => {
      const answer = await looked(txid);
      if (answer.kind !== 'found' || answer.view.confirmed) return answer;
      return { kind: 'found', view: { ...answer.view, confirmed: true, height: TIP + 1, time: Math.floor(Date.now() / 1000) } };
    };
  },

  'send-too-large': (wallet) => {
    wallet.haveWallet('words');
    wallet.haveCoins(fundedState(), sampleHistory(Date.now()));
    // The stand-in's own list of ways a broadcast can end has no "too_large"
    // (the code the Worker gives a payment that spends hundreds of coins), so
    // this preset answers for it.
    wallet.broadcast = async () => {
      await new Promise((done) => setTimeout(done, wallet.delay));
      return { ok: false, reason: 'too_large', detail: null };
    };
  },
};
