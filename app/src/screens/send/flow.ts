// What the Send screen does with each answer the wallet can give on the way
// from a plan to a sent payment, as plain functions so that "node --test"
// can check every one: what follows sign(), what an unlock that changed the
// wallet means for a payment, which refused payments may be handed in
// again, which heading a refusal gets and whether it puts the wallet's coins
// in doubt, how long the review takes no tap on "Send it", whether a pot
// address that arrives late still goes into the field, and which line about
// "Send all" and about change stands beside a plan.

import type { PaymentPlan, PlanFailure } from '@learnbitcoin/practice-wallet';
import { feeRateText } from '../../components/wallet/tx-text.ts';
import type { Unlocked } from '../../components/wallet/unlock-flow.ts';
import type { BroadcastFailure } from '../../lib/api.ts';
import { formatSats } from '../../lib/format.ts';
import type { SignResult } from '../../lib/wallet-api.ts';

// -- after sign() -----------------------------------------------------------------

/**
 * What follows an answer of sign():
 *   signed        the review of the signed payment
 *   needs-unlock  a passkey wallet that is locked: the unlock step, then sign again
 *   needs-keys    a wallet made without a passkey whose keys are not loaded yet:
 *                 they load without a prompt (wallet.unlock()), then sign again
 *   no-keys       still locked although the keys were just loaded: nothing more
 *                 this page can do, so it says so and offers a reload
 *   refused       the payment cannot be made after all (the coins changed between
 *                 the plan and the signing): back at the form, with the planner's reason
 */
export type SignOutcome =
  | { kind: 'signed' }
  | { kind: 'needs-unlock' }
  | { kind: 'needs-keys' }
  | { kind: 'no-keys' }
  | { kind: 'refused'; reason: PlanFailure };

/**
 * `passkey` says whether the wallet was made with a passkey. `keysLoaded`
 * is true for the sign() that follows an unlock: it must not send the
 * reader round to the unlock step a second time.
 */
export function judgeSign(result: SignResult, passkey: boolean, keysLoaded: boolean): SignOutcome {
  if (result.ok) return { kind: 'signed' };
  if (result.reason !== 'locked') return { kind: 'refused', reason: result.reason };
  if (keysLoaded) return { kind: 'no-keys' };
  return passkey ? { kind: 'needs-unlock' } : { kind: 'needs-keys' };
}

/**
 * What an unlock means for the payment that was waiting for it. After
 * "same" the payment is signed. After "tampered" and "switched" the coins
 * the plan was made from are being looked up afresh, or are another
 * wallet's: the plan is dropped, and the reader is back at the form, where
 * a new plan shows once the coins are known.
 */
export function afterUnlock(how: Unlocked): 'sign' | 'plan-again' {
  return how === 'same' ? 'sign' : 'plan-again';
}

// -- after a refused broadcast ------------------------------------------------------

/**
 * Whether the very same signed payment may be handed to the network again.
 * Yes where nothing about the payment was at fault and waiting helps: no
 * answer came, the network could not answer, or it was asked too fast. No
 * where the node itself refused it, or the payment is too large: the same
 * payment would be refused again, and the way out starts at the form.
 */
export function canSendAgain(reason: BroadcastFailure): boolean {
  return reason === 'network' || reason === 'unavailable' || reason === 'limit';
}

/**
 * True for an answer that says nothing about the payment itself: none came
 * back at all ("network"), or the practice network could not answer in time
 * ("unavailable"). Either is also what a payment gets that did go out, when
 * only the answer was lost on the way back. So the screen may not say "not
 * sent" of it. (After "network" the wallet has already looked for the
 * transaction and not found it, which the network's index can be a moment
 * late with.)
 */
export function unanswered(reason: BroadcastFailure): boolean {
  return reason === 'network' || reason === 'unavailable';
}

/**
 * The heading over a payment the practice network did not take:
 *   already-sent  it says the payment is in a block: "not sent" would be wrong
 *   unanswered    nothing is known about the payment (see unanswered()), and
 *                 the heading claims no more than that
 *   not-sent      the network refused it or never got it: the node's own
 *                 refusals, a request too large to pass on, and asking too fast
 */
export type RefusalHeading = 'already-sent' | 'unanswered' | 'not-sent';

export function refusalHeading(reason: BroadcastFailure): RefusalHeading {
  if (reason === 'already_sent') return 'already-sent';
  return unanswered(reason) ? 'unanswered' : 'not-sent';
}

/**
 * True for a refusal that says the wallet's picture of its coins is out of
 * date: a coin is spent already, the payment is in a block already, or the
 * node refused for a reason this page cannot name. The sentences for these
 * tell the reader to let the wallet refresh, so the screen has the wallet
 * read its coins again at once: the form the reader goes back to then
 * shows what the network holds, and not the coins the refused payment was
 * made from. The other refusals (fee too low, dust, too large) say nothing
 * about the coins.
 */
export function coinsInDoubt(reason: BroadcastFailure): boolean {
  return reason === 'coin_spent' || reason === 'already_sent' || reason === 'refused';
}

// -- the review ---------------------------------------------------------------------

/**
 * How long "Send it" takes no tap after the review has appeared, in ms.
 * "Continue" swaps the review in at once, and the second tap of a double
 * tap comes a moment later at the same spot, where "Send it" can stand by
 * then. A payment must not go out before the review could be read, so the
 * button is switched off for this long. A second is longer than a double
 * tap, and shorter than reading the first line.
 */
export const REVIEW_SETTLE_MS = 1_000;

// -- pass it on ---------------------------------------------------------------------

/**
 * Whether a pot address that has just arrived still goes into the "To"
 * field. The answer can take many seconds. Only if the reader is still at
 * the form and the field holds what it held when "Pass it on" was pressed:
 * an address typed meanwhile is the reader's choice, and a field changed
 * behind the review would make "Change it" return to another payment.
 */
export function fillsPot(atTap: string, now: string, atForm: boolean): boolean {
  return atForm && now === atTap;
}

// -- beside a plan ------------------------------------------------------------------

/**
 * The line about "Send all" that stands beside a plan or a refused plan:
 *   would-deliver  what "Send all" would deliver, shown only when that is above 0
 *   cannot         "Send all" cannot be made at this fee rate. That is all a
 *                  figure of 0 says: it never means that nothing can be sent
 *   null           no line: "Send all" is switched on and can be made, so the
 *                  plan itself is the figure, or the refusal is about the
 *                  wallet's coins or a field and has nothing to do with it
 * With "Send all" switched on, a plan that cannot be made is no figure: the
 * planner's sentence then speaks of "that amount" although the reader typed
 * none, so the line that says what it is about stands beside it.
 * The amount is never cut down to the figure: an ordinary payment can
 * sometimes deliver more than "Send all" would.
 */
export type SendAllLine = { kind: 'would-deliver'; sats: bigint } | { kind: 'cannot' } | null;

/** The refusals that leave "Send all" as a way out worth a line. */
const ABOUT_THE_AMOUNT: readonly PlanFailure[] = ['too-much', 'below-dust', 'too-small'];

export function sendAllLine(plan: PaymentPlan, sendAll: boolean): SendAllLine {
  const cannot = plan.maxSendable === 0n && (plan.ok || ABOUT_THE_AMOUNT.includes(plan.reason));
  if (sendAll) return !plan.ok && cannot ? { kind: 'cannot' } : null;
  if (plan.maxSendable > 0n) return { kind: 'would-deliver', sats: plan.maxSendable };
  return cannot ? { kind: 'cannot' } : null;
}

/**
 * Why a payment has no change:
 *   send-all  the reader chose "Send all": every coin goes in whole
 *   leftover  what was left after the amount and the fee was too small for a
 *             coin of its own (or nothing was left), and went to the fee
 *   null      it has change
 */
export function noChangeOf(change: bigint | null, sendAll: boolean): 'send-all' | 'leftover' | null {
  if (change !== null) return null;
  return sendAll ? 'send-all' : 'leftover';
}

/**
 * True when the rate a plan really pays, as the screen writes it, is not
 * the one the reader chose. The wallet works the fee out with a spare byte
 * for each signature, and a leftover too small for change goes to the fee
 * too, so the rate paid can come out above the one in the field. The plan
 * then says so, because the two numbers stand on one screen.
 */
export function rateDiffers(paid: number, chosen: bigint): boolean {
  return feeRateText(paid) !== formatSats(chosen);
}
