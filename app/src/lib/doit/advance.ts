// What to write, and what to count, when the world changes.
//
// The glue (doit.svelte.ts) keeps the world as it was a moment ago and the
// world as it is now, and asks this file what follows from the difference.
// The answer is a list of changes for the one write function
// (progress.ts). Nothing here writes, reads the page or looks at a clock:
// two worlds in, changes out.
//
// The rules:
//
//   - Ticks come in order. Only the first part of a step that is not
//     ticked is looked at; when it ticks, the next one is looked at in the
//     same breath, so a step opened on a wallet that already holds a
//     confirmed coin ticks three parts at once.
//   - A part that is a STATE of the wallet (a wallet is here, a coin is
//     confirmed, a payment is in a block) ticks when the state holds, on any
//     screen, for every step that is started and not done, whether or not it
//     is the one being followed.
//   - A part that is an EVENT (a payment sent, a screen opened, the 12 words
//     put on screen, the wallet removed) ticks only when the event is a
//     change between the two worlds, and only for the step the stored note
//     says is followed at that moment. What happened before the step was
//     followed does not count: a payment that was this page's last one
//     before the reader opened the step is no change, and ticks nothing.
//   - A question or the reader's own word is ticked by the reader, on the
//     step's screen: answered() makes that change.
//   - Where nothing can be written (the browser refuses, or a newer
//     version's note is stored) nothing is ticked and nothing is counted.
//
// What a tick carries: the payment's ID and the moment it was sent, for the
// parts that wait for a payment; the wallet fingerprint and how this
// browser kept the wallet, for the parts that check the paper copy. The
// moment a step is done is the moment of its last tick, and what is
// deleted from the note then is progress.ts's rule (the payment, and for
// the last step the wallet it named).
//
// And what to count: "Do it" is counted for a step by the write that put
// the moment it was done into the note, when the note that was read for
// that write had none (counted, below). So two tabs that both see the last
// part tick count the step once between them.

import type { Route } from '../router.ts';
import { applyChange, parseProgress, type Change, type Progress } from './progress.ts';
import { firstOpen, judge, verdictOf, waitedFor, type Waited, type World } from './judge.ts';
import { STEPS, STEP_DEFS, sendPart, type Fact, type StepId } from './steps.ts';

/** What advance() answers. */
export interface Plan {
  /**
   * What to write, in this order, each through writeProgress(). If a write
   * is refused, the ones after it are not made: they were worked out on top
   * of it.
   */
  changes: Change[];
  /**
   * For the page's memory only, and never written: how long a step's
   * payment waited for its block, for each step whose "in a block" part
   * ticks in this advance. The note deletes the payment when the step is
   * done, so a page that wants to say "It waited 23 seconds. Block 150 took
   * it in." under a done step has to remember it from here.
   */
  waited: Partial<Record<StepId, Waited>>;
}

// -- events: what happened between two worlds ---------------------------------------

/** A payment that this page had not sent in the world before: its last payment is another one now. */
function sentNow(before: World, after: World): boolean {
  const last = after.wallet.lastSent;
  return last !== null && last.txid !== before.wallet.lastSent?.txid;
}

/** The Coins screen is open on a wallet that holds at least one coin. */
function coinsOpen(world: World): boolean {
  const { status, chain } = world.wallet;
  return world.route.name === 'coins' && status === 'ready' && chain.state !== null && chain.state.coins.length > 0;
}

/** The transaction screen is open for a payment this wallet sent (to somebody else, or to itself). */
function paymentOpen(world: World): boolean {
  const route: Route = world.route;
  if (route.name !== 'tx' || world.wallet.status !== 'ready') return false;
  return (world.wallet.history ?? []).some((tx) => tx.txid === route.txid && (tx.direction === 'sent' || tx.direction === 'internal'));
}

/**
 * Whether the event a part rests on happened between `before` and `after`.
 * Each is a change, never a state: with no world before (a page that has
 * just loaded) nothing has happened yet.
 */
function happened(fact: Fact, id: StepId, before: World | null, after: World): boolean {
  if (before === null) return false;
  switch (fact) {
    case 'sent':
      return sentNow(before, after);
    case 'sent-to-pot':
      // To an address the pot handed out in this page: Send's "Pass it on".
      return sentNow(before, after) && after.wallet.lastSent?.toPot === true;
    case 'coins-opened':
      // The screen was opened, or the coins became known while it was open (a page loaded on it).
      return coinsOpen(after) && !coinsOpen(before);
    case 'payment-read':
      return paymentOpen(after) && !paymentOpen(before);
    case 'words-shown':
      // The words of the wallet that is here: only that wallet's are ever handed out.
      return after.wallet.status === 'ready' && after.wallet.wordsShown > before.wallet.wordsShown;
    case 'wallet-removed': {
      // The wallet the note names was here, and now no wallet is.
      const named = after.note.steps[id]?.wallet;
      const was = before.wallet;
      return named !== undefined && was.status === 'ready' && was.record?.fingerprint === named && after.wallet.status === 'none';
    }
    default:
      return false;
  }
}

// -- one tick -------------------------------------------------------------------------

/** The tick for a part, with what that part notes beside it. `world` is the world it ticks in. */
function tickOf(id: StepId, part: number, world: World): Change {
  const tick: Extract<Change, { kind: 'tick' }> = { kind: 'tick', step: id, part, at: world.now };
  const fact = STEP_DEFS[id].parts[part - 1]?.on;
  const { lastSent, record } = world.wallet;
  if ((fact === 'sent' || fact === 'sent-to-pot') && lastSent !== null) {
    // The payment the step waits for from here on: its ID, and when it was sent.
    tick.tx = lastSent.txid;
    tick.sentAt = lastSent.at;
  }
  if (fact === 'three-words' && record !== null) {
    // The wallet whose words were checked. The drill also notes how this browser kept it, to
    // say afterwards what the restore changed: a wallet restored from its words is kept with them.
    tick.wallet = record.fingerprint;
    if (id === 'prove-the-backup') tick.was = record.kind;
  }
  return tick;
}

/** The change that ticks the first open part of a step, if the world says it ticks now. */
function nextTick(id: StepId, before: World | null, world: World): Change | null {
  const note = world.note.steps[id];
  if (note?.started !== true || note.doneAt !== undefined) return null;
  const part = firstOpen(id, note);
  // Every part is ticked and the step is not marked done (a note edited by hand): the last tick, again, marks it.
  if (part === null) return { kind: 'tick', step: id, part: STEP_DEFS[id].parts.length, at: world.now };
  const def = STEP_DEFS[id].parts[part - 1];
  if (def === undefined) return null;
  switch (def.kind) {
    case 'state':
      return verdictOf(id, part, world).is === 'met' ? tickOf(id, part, world) : null;
    case 'ask':
      // Asked of the reader. One question answers itself: the paper check of the drill, when
      // the same check was passed in the-seed for the wallet that is here.
      return verdictOf(id, part, world).is === 'met' ? tickOf(id, part, world) : null;
    case 'say-so':
      return null;
    case 'event':
      // Only for the step the stored note says is followed, and only as a change.
      return world.note.following === id && happened(def.on, id, before, world) ? tickOf(id, part, world) : null;
  }
}

/**
 * After "Send another": the step's send part is ticked and its note holds
 * no payment. The next payment sent while the step is followed is noted in
 * the old one's place.
 */
function paymentAgain(id: StepId, before: World | null, world: World): Change | null {
  const send = sendPart(id);
  const note = world.note.steps[id];
  if (send === null || note?.started !== true || note.doneAt !== undefined) return null;
  if (note.parts?.[send] !== true || note.tx !== undefined || world.note.following !== id) return null;
  const fact = STEP_DEFS[id].parts[send - 1]?.on;
  const last = world.wallet.lastSent;
  if (fact === undefined || last === null || !happened(fact, id, before, world)) return null;
  return { kind: 'payment', step: id, tx: last.txid, sentAt: last.at };
}

// -- the whole advance ------------------------------------------------------------------

/**
 * A note as the one write function would store it: only what a note may
 * hold, each field in its fixed place. applyChange() answers in this form,
 * and a note read from the storage is in it already. A note handed in from
 * anywhere else is put into it first, so that "the same note" can be told
 * by comparing the two texts.
 */
function stored(note: Progress): Progress {
  return parseProgress(JSON.stringify(note)).progress;
}

/** Two notes in that form that hold the same: a change that did not apply. */
function same(a: Progress, b: Progress): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What follows from the world having changed from `before` to `after`.
 *
 * `before` is null for a page's first world: states are judged, and no
 * event has happened. Each world holds the note as it stood in storage at
 * that moment; the changes are worked out against the note in `after`, one
 * on top of the other, and writeProgress() applies each to what is stored
 * by then.
 *
 * Pure. It never asks the clock: every time written is `after.now`, or the
 * moment a payment says it was sent.
 */
export function advance(before: World | null, after: World): Plan {
  const plan: Plan = { changes: [], waited: {} };
  // Nothing can be written here, so nothing is ticked.
  if (after.kept !== 'yes') return plan;
  let world: World = { ...after, note: stored(after.note) };
  const take = (change: Change | null): boolean => {
    if (change === null) return false;
    const note = applyChange(world.note, change);
    // A change that changes nothing would be offered again for ever.
    if (same(note, world.note)) return false;
    if (change.kind === 'tick' && STEP_DEFS[change.step].parts[change.part - 1]?.on === 'payment-confirmed') {
      // Seen now, with the payment still in the note: how long it waited. Where the block's own
      // time cannot say, the page's own clock does: it saw the payment sent and sees it in a block.
      const waited = waitedFor(change.step, world);
      const sentAt = world.note.steps[change.step]?.sentAt;
      if (waited !== null) {
        const seen = sentAt === undefined ? null : Math.max(0, Math.round((world.now - sentAt) / 1000));
        plan.waited[change.step] = { height: waited.height, seconds: waited.seconds ?? seen };
      }
    }
    plan.changes.push(change);
    world = { ...world, note };
    return true;
  };
  for (const id of STEPS) {
    // One part after another, for as long as the next one ticks too. (A step has four parts at most.)
    for (let round = 0; round <= STEP_DEFS[id].parts.length; round++) {
      if (!take(nextTick(id, before, world))) break;
    }
    take(paymentAgain(id, before, world));
  }
  return plan;
}

// -- what the reader ticks -----------------------------------------------------------------

/**
 * The change for a question answered right, or for the box the reader
 * ticked: the tick of the step's open part. Null when that part is not a
 * question or the reader's word, or is not the one that is "now" (another
 * tab got there first, the wallet has gone, nothing can be written).
 *
 * The caller has judged the answer first: answerBlock() and answerCoins()
 * for the two numbers, wordsPassed() for the three words (all in
 * judge.ts). This only says what to write once it was right.
 */
export function answered(id: StepId, world: World): Change | null {
  if (world.kept !== 'yes') return null;
  const view = judge(id, world);
  if (view.at === null || view.parts[view.at - 1]?.state !== 'now') return null;
  const kind = STEP_DEFS[id].parts[view.at - 1]?.kind;
  if (kind !== 'ask' && kind !== 'say-so') return null;
  return tickOf(id, view.at, world);
}

/**
 * For a the-seed whose three words are checked: they were checked again,
 * and passed, for the wallet that is in this browser now. The note then
 * names this wallet. Null when no wallet is here or the step has no check
 * to renew.
 */
export function rechecked(world: World): Change | null {
  const { status, record } = world.wallet;
  const note = world.note.steps['the-seed'];
  if (world.kept !== 'yes' || status !== 'ready' || record === null) return null;
  if (note?.parts?.[STEP_DEFS['the-seed'].parts.length] !== true) return null;
  return { kind: 'checked', step: 'the-seed', wallet: record.fingerprint };
}

// -- what to count --------------------------------------------------------------------------

/**
 * The steps to count as done ("Do it", with the step as its value) after
 * one write: those whose moment of being done is in the note that was
 * written and was not in the note that was read for that write
 * (writeProgress hands back both). A step another tab finished first is
 * already marked in what was read, and is not counted a second time.
 */
export function counted(read: Progress, written: Progress): StepId[] {
  return STEPS.filter((id) => written.steps[id]?.doneAt !== undefined && read.steps[id]?.doneAt === undefined);
}
