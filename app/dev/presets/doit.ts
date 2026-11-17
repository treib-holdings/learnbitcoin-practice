// Presets for the "Do it" steps: the list (/do), a step's screen (/do/<id>)
// and the strip, in the states the base presets do not reach.
//
// The steps run for real in the gallery: the same runner as in the app,
// over the stand-in wallet, with their note kept in the stand-in's storage
// (which lives in the page's memory). A preset here puts a wallet in the
// browser and a note in that storage, before any screen is drawn. What the
// screen then shows is what the runner makes of the two: a part that the
// wallet already satisfies ticks as the page loads.
//
// MANY STATES NEED NO PRESET OF THEIR OWN. A step's screen starts its step
// when it opens, so on a base preset it shows the step from its first part:
//
//   /do/hold-some?state=none          part 1 is open: "Create a practice wallet"
//   /do/hold-some?state=no-coins      part 2 is open: "Get practice coins"
//   /do/hold-some?state=scanning      part 2 is not known yet: the coins are being looked up
//   /do/hold-some?state=scan-failed   the same, after a look that failed
//   /do/hold-some?state=funded        part 4 is open: the question about the block
//   /do/hold-some?state=unreadable    part 1 cannot be done: the stored wallet cannot be read (also newer, broken)
//   /do/pass-it-on?state=none         needs a wallet: leads to "Hold some"
//   /do/pass-it-on?state=no-coins     needs coins
//   /do/pass-it-on?state=funded       part 2 is open: "Open Send"
//   /do/no-balances?state=funded      part 1 is open: "Open Coins"
//   /do/waiting-room?state=funded     part 1 is open: "Open Send"
//   /do/the-seed?state=funded         part 1 is open: "Open Backup"
//   /do/prove-the-backup?state=words  part 1 is open: three of the 12 words
//   /do/prove-the-backup?state=funded the same for a locked passkey wallet: the unlock step first
//
// and any of them with &storage=no (progress cannot be kept), with
// &from=<the step's own chapter page> (the way back the reader came by: for
// a step of the payment chapter, /journey/how-bitcoin-works or its Spanish
// twin; any other value is ignored), or in Spanish under /es. The history
// loads a moment after the page: give the gallery tool --wait 900.
//
// THE PRESETS HERE, by the screen they are for:
//
//   the list (/do)
//     do-progress         two steps done, one started and followed, three not started
//     do-all-done         all six done
//     do-newer            a note written by a newer version: no states, Reload, no "Forget my progress"
//     do-unreadable       something stored that is no note: no progress, and "Forget my progress"
//                         (on /about, "In this browser right now" then says that something is
//                         stored where the note goes, and that the page cannot read it)
//
//   Hold some (/do/hold-some)
//     do-unconfirmed      one coin, not in a block yet: part 3 waits (also: Pass it on, "not spendable yet")
//     do-hold-done        done
//     do-detour           under way, for a reader whom "Pass it on" sent here, and who had pressed the card
//                         of "Pass it on" in the payment chapter: "Back to the chapter" on the step's
//                         screen leads to that card, and so does the strip (on /wallet/receive: both links)
//     do-led-on           done, in the same detour: the card's main button leads back to "Pass it on",
//                         and "Back to the chapter", second, to the payment chapter
//
//   Pass it on (/do/pass-it-on)
//     do-pass-waiting     the payment was sent 12 seconds ago and waits for its block
//     do-pass-lost        the network does not know the payment, five minutes on: "Send another"
//     do-pass-again       after "Send another": no payment is noted
//     do-pass-done        done (add potStats=none or potStats=unavailable for no pot line)
//     do-pass-ticking     the block has come while the page was away: the step is done as the
//                         page loads, with the line "It waited 9 seconds. Block ... took it in."
//     do-card-done        done, for a reader who came by its card in the payment chapter, with "The
//                         waiting room" done too: no "Next step", and a link back that names both steps
//
//   There are no balances (/do/no-balances)
//     do-received-only    a wallet that has sent nothing: leads to "Pass it on"
//     do-count            part 2 is open: how many coins
//     do-read             part 3 is open: "Open your latest payment"
//     do-balances-done    done
//
//   The waiting room (/do/waiting-room)
//     do-room-waiting     the payment waits for its block
//     do-room-counting    in a block, four of six confirmations, with the line about its wait
//     do-room-done        done
//
//   The seed (/do/the-seed)
//     do-seed-said        part 2 is open: the box "I wrote the 12 words on paper"
//     do-seed-words       part 3 is open: three words (add kind=passkey&unlocked=no for the unlock step
//                         first, wordsAt=wrong#play:step-words-check for a wrong word)
//     do-seed-done        done, for the wallet that is here
//     do-seed-other       done, and another wallet is here: the check is offered again
//
//   Prove the backup (/do/prove-the-backup)
//     (part 1 on the base preset "words" names "The seed" for a reader with no paper copy; on
//     do-seed-other, where that step is done for another wallet, it names the Backup screen)
//     do-prove-seed       part 1 was ticked by the check of "The seed", and says so; part 2 is open
//     do-prove-remove     part 2 is open: the warnings, and "Open Settings"
//     do-prove-unchecked  part 2: the wallet here is not the one whose words were checked
//     do-prove-gone       part 2: no wallet is here, and none was removed while the step was followed
//     do-prove-restore    part 3 is open, with no wallet here: "Restore from the 12 words"
//                         (the same preset on / and /restore shows the strip without a wallet)
//     do-prove-passkey    part 3: the wallet came back through its passkey
//     do-prove-other      part 3: another wallet was restored
//     do-prove-looking    part 4: the restored wallet's coins are being looked up
//     do-prove-empty      part 4: the restored wallet holds no coins
//     do-prove-done       done, for a wallet that was opened with a passkey before: "What the restore changed"
//     do-prove-done-words done, for a wallet that was kept with its words all along
//
//   the strip (any screen but the followed step's own: /wallet, /wallet/send, /)
//     do-count, do-read, do-seed-said ...   the part's name
//     do-strip-need       what is missing: "first: get practice coins"
//                         (on a phone the need, a wait, a lost payment and the drill's "restore"
//                         stand in the place of "2 of 3": look at these at 320 and 375 px)
//     do-strip-looking    the coins are being looked up
//     do-pass-waiting     "waiting for a block, sent 12 seconds ago" on /wallet, where the list of
//                         transactions is read; on /wallet/receive, where it is not, the part's name
//     do-pass-lost        "the network does not know the payment"
//     do-strip-done       the step is done: both ways back, and "Close"
//     do-strip-card       a step under way that was reached by its card in the payment chapter: both
//                         ways back on the strip from the start (look at it at 320 and 375 px, also under /es)
//     do-detour           the strip of a step that a need sent the reader to: the link leads to the
//                         chapter they left
//     do-strip-old        followed more than 24 hours ago: no strip

import type { TxPart, TxView, WalletState } from '@learnbitcoin/practice-wallet';
import { PROGRESS_KEY, type Progress, type StepNote } from '../../src/lib/doit/progress.ts';
import type { StepId } from '../../src/lib/doit/steps.ts';
import {
  ACCOUNT,
  OTHER_FINGERPRINT,
  POT_ADDRESS,
  TIP,
  TXID,
  emptyState,
  fundedState,
  otherAddress,
  ownAddress,
  sampleHistory,
} from '../sample.ts';
import type { Preset, StandIn } from '../stand-in.svelte.ts';

/** The sample wallet's fingerprint: the wallet a note names. */
const HERE = ACCOUNT.masterFingerprint;

/** The ID of a payment the sample wallet "has just sent", for the presets that wait for one. */
const PAYMENT = '7e57ab1e'.padEnd(64, '0');

/** A day and a half ago, in ms: a step that was done before today. */
const EARLIER = 36 * 3_600_000;

// -- notes --------------------------------------------------------------------------

/** A step's note with its first `count` parts ticked, and whatever else it holds. */
function started(count = 0, extra: StepNote = {}): StepNote {
  const note: StepNote = { started: true, ...extra };
  if (count > 0) note.parts = Object.fromEntries(Array.from({ length: count }, (_, at) => [at + 1, true]));
  return note;
}

/** A step that is done: every part ticked, and the moment it was done. */
function done(parts: number, at: number, extra: StepNote = {}): StepNote {
  return { ...started(parts, extra), doneAt: at };
}

/** Puts a note in the stand-in's storage. `following` is the step followed, since ten seconds ago. */
function keep(wallet: StandIn, steps: Progress['steps'], following: StepId | null = null, followedAt = Date.now() - 10_000): void {
  const note: Progress = following === null ? { v: 1, following, steps } : { v: 1, following, followedAt, steps };
  wallet.storage.setItem(PROGRESS_KEY, JSON.stringify(note));
}

// -- wallets --------------------------------------------------------------------------

const mine = (chain: 0 | 1, index: number, value: bigint): TxPart => ({
  address: ownAddress(chain, index).address,
  value,
  mine: true,
  change: chain === 1,
});

/** A payment of the sample wallet's own to the pot, with change: in a block at `height`, or not in one yet. */
function payment(now: number, height: number | null): TxView {
  return {
    txid: PAYMENT,
    confirmed: height !== null,
    height,
    time: height === null ? null : Math.floor(now / 1000) - (TIP - height) * 30,
    inputs: [mine(0, 2, 54_321n)],
    outputs: [{ address: POT_ADDRESS, value: 20_000n, mine: false, change: false }, mine(1, 1, 34_039n)],
    fee: 282n,
    vsize: 141,
    feeRate: 2,
    net: -20_282n,
    direction: 'sent',
    rbf: true,
  };
}

/** The sample wallet with its coins and history: kept with its words (so it needs no unlock), or opened with a passkey and locked. */
function funded(wallet: StandIn, kind: 'words' | 'passkey' = 'words', history: TxView[] = sampleHistory(Date.now())): void {
  wallet.haveWallet(kind);
  wallet.haveCoins(fundedState(), history);
}

/** The sample wallet with one coin that is not in a block yet, and the transaction that brought it. */
function unconfirmedOnly(wallet: StandIn): void {
  const at = ownAddress(0, 0, true);
  const empty = emptyState();
  const state: WalletState = {
    ...empty,
    receive: empty.receive.map((address, index) => (index === 0 ? at : address)),
    coins: [{ txid: TXID.arriving, vout: 1, value: 25_000n, status: { confirmed: false }, chain: 0, index: 0, address: at.address, script: at.script }],
    nextReceiveIndex: 1,
    unconfirmed: 25_000n,
  };
  const arriving: TxView = {
    txid: TXID.arriving,
    confirmed: false,
    height: null,
    time: null,
    inputs: [{ address: otherAddress(0), value: 80_000n, mine: false, change: false }],
    outputs: [{ address: otherAddress(4), value: 54_718n, mine: false, change: false }, mine(0, 0, 25_000n)],
    fee: 282n,
    vsize: 141,
    feeRate: 2,
    net: 25_000n,
    direction: 'received',
    rbf: true,
  };
  wallet.haveWallet('words');
  wallet.haveCoins(state, [arriving]);
}

/** The block's own time of a transaction of the sample history, in ms. */
function blockTimeOf(height: number, now: number): number {
  return (Math.floor(now / 1000) - (TIP - height) * 30) * 1000;
}

export const presets: Record<string, Preset> = {
  // -- the list -----------------------------------------------------------------------

  'do-progress': (wallet) => {
    funded(wallet);
    const now = Date.now();
    keep(
      wallet,
      {
        'hold-some': done(4, now - EARLIER, { from: '/journey/what-bitcoin-actually-is' }),
        'pass-it-on': done(3, now - 3_600_000),
        'no-balances': started(1),
      },
      'no-balances',
    );
  },

  'do-all-done': (wallet) => {
    funded(wallet);
    const now = Date.now();
    keep(wallet, {
      'hold-some': done(4, now - 3 * EARLIER),
      'pass-it-on': done(3, now - 2 * EARLIER),
      'no-balances': done(3, now - 2 * EARLIER),
      'waiting-room': done(3, now - EARLIER),
      'the-seed': done(3, now - EARLIER, { wallet: HERE }),
      'prove-the-backup': done(4, now - 3_600_000, { was: 'passkey' }),
    });
  },

  'do-newer': (wallet) => {
    funded(wallet);
    // What a later version of the page might write: this one reads none of it.
    wallet.storage.setItem(PROGRESS_KEY, JSON.stringify({ v: 2, following: 'hold-some', steps: { 'hold-some': { started: true } } }));
  },

  'do-unreadable': (wallet) => {
    funded(wallet);
    wallet.storage.setItem(PROGRESS_KEY, 'not a note');
  },

  // -- Hold some ------------------------------------------------------------------------

  'do-unconfirmed': unconfirmedOnly,

  'do-hold-done': (wallet) => {
    funded(wallet);
    keep(wallet, { 'hold-some': done(4, Date.now() - EARLIER, { from: '/journey/what-bitcoin-actually-is' }) });
  },

  'do-detour': (wallet) => {
    // A wallet with no coins yet. The reader pressed the card of "Pass it on" in the payment chapter; its
    // need (no coins) sent them here, and the press of that link was remembered.
    wallet.haveWallet('words');
    wallet.haveCoins(emptyState(), []);
    keep(wallet, { 'hold-some': started(1, { cameFor: 'pass-it-on' }), 'pass-it-on': started(0, { from: '/journey/how-bitcoin-works' }) }, 'hold-some');
  },

  'do-led-on': (wallet) => {
    funded(wallet);
    // The same detour, with "Hold some" done: "Pass it on" is still to do, so the memory stands.
    keep(wallet, {
      'hold-some': done(4, Date.now() - 60_000, { cameFor: 'pass-it-on' }),
      'pass-it-on': started(1, { from: '/journey/how-bitcoin-works' }),
    });
  },

  // -- Pass it on ------------------------------------------------------------------------

  'do-pass-waiting': (wallet) => {
    const now = Date.now();
    funded(wallet, 'words', [payment(now, null), ...sampleHistory(now)]);
    keep(wallet, { 'pass-it-on': started(2, { tx: PAYMENT, sentAt: now - 12_000 }) }, 'pass-it-on');
  },

  'do-pass-lost': (wallet) => {
    funded(wallet);
    // The list holds no such payment, five minutes after it was sent.
    keep(wallet, { 'pass-it-on': started(2, { tx: PAYMENT, sentAt: Date.now() - 300_000 }) }, 'pass-it-on');
  },

  'do-pass-again': (wallet) => {
    funded(wallet);
    keep(wallet, { 'pass-it-on': started(2) }, 'pass-it-on');
  },

  'do-pass-done': (wallet) => {
    funded(wallet);
    keep(wallet, { 'pass-it-on': done(3, Date.now() - EARLIER) });
  },

  'do-pass-ticking': (wallet) => {
    funded(wallet);
    const now = Date.now();
    // The payment the note waits for is the sample history's own payment to the pot, which is in a
    // block: sent nine seconds before that block's time.
    keep(wallet, { 'pass-it-on': started(2, { tx: TXID.sent, sentAt: blockTimeOf(TIP - 12, now) - 9_000 }) }, 'pass-it-on');
  },

  'do-card-done': (wallet) => {
    funded(wallet);
    const now = Date.now();
    // Reached by its card, so the done card offers no "Next step". Another step of the chapter is done too.
    keep(wallet, {
      'pass-it-on': done(3, now - 60_000, { from: '/journey/how-bitcoin-works' }),
      'waiting-room': done(3, now - EARLIER),
    });
  },

  // -- There are no balances ---------------------------------------------------------------

  'do-received-only': (wallet) => {
    funded(
      wallet,
      'words',
      sampleHistory(Date.now()).filter((tx) => tx.direction === 'received'),
    );
  },

  'do-count': (wallet) => {
    funded(wallet);
    keep(wallet, { 'no-balances': started(1) }, 'no-balances');
  },

  'do-read': (wallet) => {
    funded(wallet);
    keep(wallet, { 'no-balances': started(2) }, 'no-balances');
  },

  'do-balances-done': (wallet) => {
    funded(wallet);
    keep(wallet, { 'no-balances': done(3, Date.now() - 3_600_000) });
  },

  // -- The waiting room -----------------------------------------------------------------------

  'do-room-waiting': (wallet) => {
    const now = Date.now();
    funded(wallet, 'words', [payment(now, null), ...sampleHistory(now)]);
    keep(wallet, { 'waiting-room': started(1, { tx: PAYMENT, sentAt: now - 20_000 }) }, 'waiting-room');
  },

  'do-room-counting': (wallet) => {
    const now = Date.now();
    // In the block three under the tip: that block and the three on top of it are four confirmations.
    funded(wallet, 'words', [payment(now, TIP - 3), ...sampleHistory(now)]);
    keep(wallet, { 'waiting-room': started(2, { tx: PAYMENT, sentAt: blockTimeOf(TIP - 3, now) - 14_000 }) }, 'waiting-room');
  },

  'do-room-done': (wallet) => {
    funded(wallet);
    keep(wallet, { 'waiting-room': done(3, Date.now() - 3_600_000) });
  },

  // -- The seed --------------------------------------------------------------------------------

  'do-seed-said': (wallet) => {
    funded(wallet);
    keep(wallet, { 'the-seed': started(1) }, 'the-seed');
  },

  'do-seed-words': (wallet) => {
    funded(wallet);
    keep(wallet, { 'the-seed': started(2) }, 'the-seed');
  },

  'do-seed-done': (wallet) => {
    funded(wallet);
    keep(wallet, { 'the-seed': done(3, Date.now() - EARLIER, { wallet: HERE }) });
  },

  'do-seed-other': (wallet) => {
    funded(wallet);
    // The words were checked for another wallet than the one that is here now.
    keep(wallet, { 'the-seed': done(3, Date.now() - EARLIER, { wallet: OTHER_FINGERPRINT }) });
  },

  // -- Prove the backup --------------------------------------------------------------------------

  'do-prove-seed': (wallet) => {
    // "The seed" was done for this wallet first: the drill's paper check is ticked on arrival.
    funded(wallet);
    keep(wallet, { 'the-seed': done(3, Date.now() - EARLIER, { wallet: HERE }), 'prove-the-backup': started(1, { wallet: HERE, was: 'words' }) }, 'prove-the-backup');
  },

  'do-prove-remove': (wallet) => {
    funded(wallet, 'passkey');
    keep(wallet, { 'prove-the-backup': started(1, { wallet: HERE, was: 'passkey' }) }, 'prove-the-backup');
  },

  'do-prove-unchecked': (wallet) => {
    funded(wallet);
    keep(wallet, { 'prove-the-backup': started(1, { wallet: OTHER_FINGERPRINT, was: 'words' }) }, 'prove-the-backup');
  },

  'do-prove-gone': (wallet) => {
    // The words were checked, and then the wallet left this browser while the step was not followed.
    keep(wallet, { 'prove-the-backup': started(1, { wallet: HERE, was: 'passkey' }) }, 'prove-the-backup');
  },

  'do-prove-restore': (wallet) => {
    // The wallet has been removed: nothing is here but the note.
    keep(wallet, { 'prove-the-backup': started(2, { wallet: HERE, was: 'passkey' }) }, 'prove-the-backup');
  },

  'do-prove-passkey': (wallet) => {
    funded(wallet, 'passkey');
    keep(wallet, { 'prove-the-backup': started(2, { wallet: HERE, was: 'passkey' }) }, 'prove-the-backup');
  },

  'do-prove-other': (wallet) => {
    funded(wallet);
    keep(wallet, { 'prove-the-backup': started(2, { wallet: OTHER_FINGERPRINT, was: 'passkey' }) }, 'prove-the-backup');
  },

  'do-prove-looking': (wallet) => {
    wallet.haveWallet('words');
    wallet.chain = { ...wallet.chain, scanning: true };
    keep(wallet, { 'prove-the-backup': started(2, { wallet: HERE, was: 'passkey' }) }, 'prove-the-backup');
  },

  'do-prove-empty': (wallet) => {
    wallet.haveWallet('words');
    wallet.haveCoins(emptyState(), []);
    keep(wallet, { 'prove-the-backup': started(2, { wallet: HERE, was: 'passkey' }) }, 'prove-the-backup');
  },

  'do-prove-done': (wallet) => {
    funded(wallet);
    keep(wallet, { 'prove-the-backup': done(4, Date.now() - 3_600_000, { was: 'passkey' }) });
  },

  'do-prove-done-words': (wallet) => {
    funded(wallet);
    keep(wallet, { 'prove-the-backup': done(4, Date.now() - 3_600_000, { was: 'words' }) });
  },

  // -- the strip ---------------------------------------------------------------------------------

  'do-strip-need': (wallet) => {
    wallet.haveWallet('words');
    wallet.haveCoins(emptyState(), []);
    keep(wallet, { 'pass-it-on': started() }, 'pass-it-on');
  },

  'do-strip-looking': (wallet) => {
    wallet.haveWallet('words');
    wallet.chain = { ...wallet.chain, scanning: true };
    keep(wallet, { 'pass-it-on': started() }, 'pass-it-on');
  },

  'do-strip-done': (wallet) => {
    funded(wallet);
    // Done a moment ago on another screen, and still followed: the strip says so until it is closed.
    keep(wallet, { 'no-balances': done(3, Date.now() - 5_000, { from: '/journey/how-bitcoin-works' }) }, 'no-balances');
  },

  'do-strip-card': (wallet) => {
    funded(wallet);
    // Under way, and reached by its card in the payment chapter: the strip carries the link back from the start.
    keep(wallet, { 'no-balances': started(1, { from: '/journey/how-bitcoin-works' }) }, 'no-balances');
  },

  'do-strip-old': (wallet) => {
    funded(wallet);
    keep(wallet, { 'no-balances': started(1) }, 'no-balances', Date.now() - 25 * 3_600_000);
  },
};
