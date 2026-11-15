// What the Receive screen decides, as plain functions so that "node --test"
// can check them: what the button does in each phase of a faucet request,
// which sentence a failure gets and what the screen adds to it, when
// "Show a new address" is offered and when it has to wait, and where an
// address sits in the wallet.
//
// The words themselves are in strings/receive.ts, and the sentence of every
// failure is in strings/errors.ts. What is here picks among them.

import type { Lang } from '@learnbitcoin/practice-contract';
import { ACCOUNT_PATH } from '@learnbitcoin/practice-wallet';
import { withoutLastSentence } from '../../components/text.ts';
import { fill, formatSats } from '../../lib/format.ts';
import type { FaucetFailure, FaucetPhase, FaucetView } from '../../lib/wallet-api.ts';
import type { ErrorKey } from '../../strings/errors.ts';
import { strings } from '../../strings/index.ts';
import type { NoToken } from './bot-check.ts';

/**
 * How long the faucet leaves an address unpaid after it has paid it once,
 * in hours. The rule is the practice network's own (its bots keep it), and
 * the error table's sentence for "already_paid" names the same figure: a
 * test holds the two together.
 */
export const FAUCET_ONCE_HOURS = 24;

/** How long Bitcoin's real network takes to make a block, on average, in minutes. */
export const BITCOIN_BLOCK_MINUTES = 10;


/**
 * How long the bot check's box has to stand on screen, unanswered, before
 * the status region says that it is there, in milliseconds. Long enough
 * that a check which passes by itself is over first; short enough that a
 * reader who cannot see the box is not left wondering.
 */
export const BOX_SAY_MS = 1_500;

/**
 * Where a receive address sits in the wallet: the path from the 12 words to
 * its key. The account's part is the wallet package's own; 0 is the chain
 * of addresses to be paid at (1 is the chain for change); the last number
 * counts the addresses of that chain, from 0.
 */
export function addressPath(index: number): string {
  return `${ACCOUNT_PATH}/0/${index}`;
}

/** "100,000 practice sats arrived at this address." One sat is its own sentence: in Spanish the verb changes with the count. */
export function arrivedText(sats: bigint, lang: Lang): string {
  const t = strings.receive[lang];
  return sats === 1n ? t.arrivedOne : fill(t.arrived, { amount: formatSats(sats) });
}

// -- a request to the faucet ----------------------------------------------------

/**
 * True while a request is under way: the bot check runs, the faucet is
 * being asked, or the page waits to ask again. The wallet holds the address
 * for that long, so "Show a new address" does nothing, and a second tap on
 * "Get practice coins" would start nothing.
 */
export function faucetRuns(phase: FaucetPhase): boolean {
  switch (phase) {
    case 'checking':
    case 'asking':
    case 'waiting':
      return true;
    case 'idle':
    case 'on-its-way':
    case 'arrived':
    case 'confirmed':
    case 'failed':
      return false;
  }
}

/**
 * What "Get practice coins" is in each phase:
 *   ready  it can be pressed: nothing has been asked yet, or the last request failed
 *   busy   a request is under way: the button says so and ignores taps
 *   done   the faucet has paid this address, or has promised to. It pays an
 *          address once and then not again for FAUCET_ONCE_HOURS, so there
 *          is no button: more coins need a new address
 */
export function askButton(phase: FaucetPhase): 'ready' | 'busy' | 'done' {
  switch (phase) {
    case 'idle':
    case 'failed':
      return 'ready';
    case 'checking':
    case 'asking':
    case 'waiting':
      return 'busy';
    case 'on-its-way':
    case 'arrived':
    case 'confirmed':
      return 'done';
  }
}

/**
 * The sentence shown while the page waits to ask the faucet again. The
 * wallet then names one of three causes. "busy" is the one that says only
 * what is true of every wait, that the page will ask again by itself, so it
 * also stands in should the wallet ever wait without naming one of the three.
 */
export function waitingSentence(failure: FaucetFailure | null): 'limit' | 'busy' | 'refilling' {
  return failure === 'limit' || failure === 'refilling' ? failure : 'busy';
}

/**
 * That sentence as the screen shows it. The one for "limit" ends "Wait a
 * minute, and it will take requests again." It is written for the screens
 * where the reader does the asking. Here the page waits by itself, and the
 * countdown under the sentence says for how long: so the sentence's last
 * part is left out, as the wallet frame does for the same failure
 * (chainFailureText). The other two already say that the page asks again.
 */
export function waitingText(failure: FaucetFailure | null, lang: Lang): string {
  const key = waitingSentence(failure);
  const sentence = strings.errors[lang][key];
  return key === 'limit' ? withoutLastSentence(sentence) : sentence;
}

/**
 * What the screen puts under the sentence of a request that failed. Every
 * sentence in the error table ends with the way out (try again, ask again
 * in a few minutes), and the button that asks again stands right above it.
 * So the screen adds only what a sentence cannot say or do:
 *   nothing      the sentence says it all
 *   other-cause  the bot check gave no token. The sentence names a content
 *                blocker; the screen names another cause, a network that
 *                stops Cloudflare. (When the check's box was on screen and
 *                nobody ticked it, neither is the cause: boxWasWaiting)
 *   reload       the sentence says to reload the page: the screen has the button
 *   new-address  the sentence says to show a new address: the screen offers
 *                that button and says where it is
 */
export type Adds = 'nothing' | 'other-cause' | 'reload' | 'new-address';

interface Failed {
  /** Whose sentence from strings/errors.ts is shown. Mostly the failure's own. */
  sentence: ErrorKey;
  adds: Adds;
}

/**
 * Every failure a faucet request can end with. The compiler holds the table
 * to the type: a new failure does not build until it has a line here.
 *
 * Some of these the faucet can never answer (they are refusals of a payment
 * the wallet sends, or of a chain read). Their own sentences speak of a
 * payment, so they get the sentence for an answer the practice network
 * could not give: that is what such an answer would be.
 */
const FAILED: Record<FaucetFailure, Failed> = {
  // -- our own bugs: a fresh page is the way out --
  bad_request: { sentence: 'bad_request', adds: 'reload' },
  method: { sentence: 'method', adds: 'reload' },
  forbidden: { sentence: 'forbidden', adds: 'reload' },
  bad_address: { sentence: 'bad_address', adds: 'reload' },
  // The sentence for "too_large" speaks of a payment that spends too many
  // coins. A faucet request that is too large is a malformed request.
  too_large: { sentence: 'bad_request', adds: 'reload' },

  // -- it may work the next time: try again, now or in a minute --
  unavailable: { sentence: 'unavailable', adds: 'nothing' },
  failed: { sentence: 'failed', adds: 'nothing' },
  network: { sentence: 'network', adds: 'nothing' },
  limit: { sentence: 'limit', adds: 'nothing' },
  bot_check: { sentence: 'bot_check', adds: 'nothing' },
  'no-token': { sentence: 'no-token', adds: 'other-cause' },

  // -- not now: come back later --
  closed: { sentence: 'closed', adds: 'nothing' },
  'gave-up': { sentence: 'gave-up', adds: 'nothing' },
  // "busy" and "refilling" say the page will ask again by itself, which is
  // true only while it waits. Once it has stopped, it has given up.
  busy: { sentence: 'gave-up', adds: 'nothing' },
  refilling: { sentence: 'gave-up', adds: 'nothing' },

  // -- this address will not be paid --
  own_address: { sentence: 'own_address', adds: 'new-address' },
  already_paid: { sentence: 'already_paid', adds: 'new-address' },

  // -- answers the faucet never gives --
  not_found: { sentence: 'unavailable', adds: 'nothing' },
  already_sent: { sentence: 'unavailable', adds: 'nothing' },
  coin_spent: { sentence: 'unavailable', adds: 'nothing' },
  fee_too_low: { sentence: 'unavailable', adds: 'nothing' },
  dust: { sentence: 'unavailable', adds: 'nothing' },
  refused: { sentence: 'unavailable', adds: 'nothing' },
};

/**
 * The sentence for a request that failed, and what the screen adds to it.
 * With no failure named, it reads as an answer that could not be given.
 */
export function failedText(failure: FaucetFailure | null): Failed {
  return failure === null ? FAILED.unavailable : FAILED[failure];
}

/**
 * True when a bot check ended because its box was not ticked: it ran out of
 * time with its widget on the page ("unanswered"), and the widget took room
 * on screen. The widget is drawn so that it shows only when it needs the
 * reader (lib/turnstile.ts, "interaction-only"), so a widget with a height
 * is a box that waits for a tick. `boxHeight` is the height of the
 * widget's place on screen at the moment the check ended, in pixels.
 *
 * The wallet calls every check without a token "no-token", and the sentence
 * for that names a content blocker. A box nobody ticked is another cause
 * with another way out, so the screen gives it a sentence of its own.
 */
export function boxWasWaiting(why: NoToken, boxHeight: number): boolean {
  return why === 'unanswered' && boxHeight > 0;
}

// -- a new address ----------------------------------------------------------------

/**
 * True when the faucet has answered that it paid this address before, or a
 * coin turned up after a request that had failed: the wallet then has no
 * payment record to show (FaucetView.payment is null).
 */
export function paidWithoutRecord(faucet: Pick<FaucetView, 'phase' | 'payment'>): boolean {
  switch (faucet.phase) {
    case 'on-its-way':
    case 'arrived':
    case 'confirmed':
      return faucet.payment === null;
    case 'idle':
    case 'checking':
    case 'asking':
    case 'waiting':
    case 'failed':
      return false;
  }
}

/**
 * Whether "Show a new address" is offered. It is, once coins have arrived
 * at the address on screen: a wallet uses a fresh address for each payment.
 * It also is where the faucet will pay this address no more, so that the
 * reader is never left with an address that gets nothing: the faucet has
 * paid it before, or refuses it for good.
 */
export function offersNewAddress(arrived: bigint, faucet: Pick<FaucetView, 'phase' | 'payment' | 'failure'>): boolean {
  if (arrived > 0n) return true;
  if (paidWithoutRecord(faucet)) return true;
  return faucet.phase === 'failed' && failedText(faucet.failure).adds === 'new-address';
}

/**
 * What the address on screen is held for, or null when "Show a new address"
 * may be pressed:
 *   answer   a request to the faucet is under way. The wallet itself holds
 *            the address for that long
 *   payment  the faucet has promised a payment that has not arrived yet.
 *            The wallet would let the address go, and with it everything
 *            the screen shows of the promise: the amount, the transaction
 *            ID, and later that the coins came. So the screen keeps the
 *            address until the payment is here
 */
export function addressHeld(faucet: Pick<FaucetView, 'phase' | 'payment'>): 'answer' | 'payment' | null {
  if (faucetRuns(faucet.phase)) return 'answer';
  return faucet.phase === 'on-its-way' && faucet.payment !== null ? 'payment' : null;
}

/**
 * Whether the line on how to get more coins stands under what the faucet
 * has paid ("... show a new address and ask again"): only once that button
 * is on screen and can be pressed.
 */
export function offersMore(arrived: bigint, faucet: Pick<FaucetView, 'phase' | 'payment' | 'failure'>): boolean {
  return askButton(faucet.phase) === 'done' && addressHeld(faucet) === null && offersNewAddress(arrived, faucet);
}
