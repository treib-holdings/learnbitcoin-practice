// The "Do it" progress: one note in this browser's storage, beside the
// wallet's record.
//
// The note says which steps the reader has started and finished, which
// parts of each are ticked, and which step they are following. It holds
// public things only: ticks, times, which of a chapter's two pages the
// reader came from, a wallet fingerprint, a transaction ID. Never one of the
// 12 words, never a key, never an answer the reader typed. And no free
// text: every field is a tick, a time, one of a few fixed values, or hex
// characters of a fixed length (8 for a wallet fingerprint, 64 for a
// transaction ID).
//
// The rules this file keeps:
//
//   - Nothing is written until the reader opens a step's screen: every
//     write goes through writeProgress(), and the first change anyone hands
//     it is that opening.
//   - ONE function writes. It reads the stored text, applies one change to
//     it and stores the result. So no tab ever writes its own copy of a
//     step over what another tab has ticked meanwhile.
//   - What is written once stays: that a step was started, each tick, and
//     the moment a step was done are never cleared by a later change. Only
//     "Start this step again" (one step) and "Forget my progress" (the lot)
//     take them away.
//   - Reading takes the six steps and the listed fields and nothing else,
//     each under its own check. A field that fails its check is dropped by
//     itself; the rest of the note stands.
//   - A note written by a newer version of this page is left exactly as it
//     is: nothing is written and nothing is deleted.
//   - Removing the wallet does not touch the note. The last step depends on
//     that: it removes the wallet and has to know afterwards which one.
//
// Any change to the note's shape raises `v`.
//
// Nothing here touches the page: the Storage is handed in, so node --test
// runs every rule on a Map. This file and the wallet's key store are the
// only two that write to the browser's storage.

import { LANGS, STEPS, TXID_PATTERN, isStepId, type Lang, type StepId } from '@learnbitcoin/practice-contract';
import type { Route } from '../router.ts';
import { STEP_DEFS, sendPart } from './steps.ts';

/** Where the note lives in the browser's storage. "v1" is the format's version, like the note's own `v`. */
export const PROGRESS_KEY = 'lbp_progress_v1';

// -- the note -----------------------------------------------------------------

/** What is kept about one step. Every field is optional: a field that is missing means "not yet", or "no longer". */
export interface StepNote {
  /** The step's screen has been opened. Written the first time, and then it stays. */
  started?: true;
  /** When the step was done, in ms since 1970. Written once. */
  doneAt?: number;
  /**
   * The page of the step's own chapter that the reader came from: that
   * chapter's English path or its Spanish one, and nothing else (validFrom).
   * The latest valid one.
   */
  from?: string;
  /** A wallet fingerprint: the wallet whose words were checked (the-seed), or the one to remove and restore (prove-the-backup). */
  wallet?: string;
  /** How this browser kept that wallet when the drill began: with a passkey, or with its words. */
  was?: 'passkey' | 'words';
  /** The payment the step waits for, by its ID. Deleted when the step is done. */
  tx?: string;
  /** When that payment was sent, in ms since 1970. Deleted with it. */
  sentAt?: number;
  /** The parts that are ticked, by their number (from 1). A tick is written once and stays. */
  parts?: Partial<Record<number, true>>;
}

export interface Progress {
  /** The format's version. */
  v: 1;
  /** The step the reader is following: the one that events count for, and the one the strip shows. */
  following: StepId | null;
  /** When that step was last followed (its screen opened, or a part of it ticked), in ms since 1970. */
  followedAt?: number;
  steps: Partial<Record<StepId, StepNote>>;
}

/** A note with nothing in it: what a browser that has never opened a step holds, in effect. */
export function emptyProgress(): Progress {
  return { v: 1, following: null, steps: {} };
}

// -- the checks every field passes, read or written -----------------------------

/** The largest time a date can hold, in ms: a time kept here can always be shown as a day. */
const TIME_MAX = 8_640_000_000_000_000;

/** A time: whole ms since 1970. */
function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= TIME_MAX;
}

/** A wallet fingerprint as the key store writes one: 8 lower-case hex characters. */
const FINGERPRINT = /^[0-9a-f]{8}$/;

/** A payment as a note keeps one: a transaction ID and the moment it was sent, both or neither. */
function isPayment(tx: unknown, sentAt: unknown): boolean {
  return typeof tx === 'string' && TXID_PATTERN.test(tx) && isTime(sentAt);
}

/**
 * The way back to the main site for a step, checked: `value` if it is the
 * page of the step's own chapter, in English or in Spanish, character for
 * character as steps.ts has the two paths. Otherwise null.
 *
 * The reader arrives on a step with "?from=<path>": the chapter page whose
 * card they pressed. "Back to the chapter" leads there. Whatever stands in
 * an address can have been written by anybody, so a way back counts only
 * when it is one of those two pages. Every other value is ignored without a
 * word, and the way back is then the step's chapter in the language of the
 * page: another page of the main site (it has no card for this step, so a
 * reader sent there would find nothing to come back to), another step's
 * chapter, the right path with a slash at its end or in capitals, a full
 * address, a path that names another host.
 *
 * So the note never keeps text of anybody's choosing. For each step this
 * field is one of two fixed strings, or it is not there: all it can say is
 * which of the chapter's two pages the reader came from.
 *
 * The same check runs when the address is read, when the note is read,
 * when it is written, and again each time a link is built from it.
 */
export function validFrom(id: StepId, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const own = STEP_DEFS[id].chapter.path;
  for (const lang of LANGS) if (value === own[lang]) return own[lang];
  return null;
}

/**
 * The way back named in a step's address, or null: the decoded value of the
 * first "from" in the query string ("?from=/journey/how-bitcoin-works"),
 * if it passes validFrom for the step whose screen the address opens.
 * `search` is location.search, with or without its question mark.
 */
export function fromOfSearch(id: StepId, search: string): string | null {
  try {
    return validFrom(id, new URLSearchParams(search).get('from'));
  } catch {
    return null;
  }
}

/** One step's note with every field under its check, in one fixed order. Null when nothing of it is left. */
function soundNote(id: StepId, value: unknown): StepNote | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const has = (field: string): boolean => Object.hasOwn(value, field);
  const fields = value as Record<string, unknown>;
  const note: StepNote = {};
  if (has('started') && fields.started === true) note.started = true;
  if (has('doneAt') && isTime(fields.doneAt)) note.doneAt = fields.doneAt;
  // A way back that is not one of this step's two chapter pages is dropped here: no write puts it back.
  const from = has('from') ? validFrom(id, fields.from) : null;
  if (from !== null) note.from = from;
  if (has('wallet') && typeof fields.wallet === 'string' && FINGERPRINT.test(fields.wallet)) note.wallet = fields.wallet;
  if (has('was') && (fields.was === 'passkey' || fields.was === 'words')) note.was = fields.was;
  if (has('tx') && typeof fields.tx === 'string' && TXID_PATTERN.test(fields.tx)) note.tx = fields.tx;
  if (has('sentAt') && isTime(fields.sentAt)) note.sentAt = fields.sentAt;
  const ticks = has('parts') ? fields.parts : undefined;
  if (typeof ticks === 'object' && ticks !== null && !Array.isArray(ticks)) {
    const parts: Partial<Record<number, true>> = {};
    let any = false;
    // Only the numbers this step has parts for, each ticked with exactly `true`.
    for (let part = 1; part <= STEP_DEFS[id].parts.length; part++) {
      if (Object.hasOwn(ticks, String(part)) && (ticks as Record<string, unknown>)[String(part)] === true) {
        parts[part] = true;
        any = true;
      }
    }
    if (any) note.parts = parts;
  }
  return Object.keys(note).length === 0 ? null : note;
}

/**
 * A note with only what a note may hold: the six steps, the listed fields,
 * each under its check, as a fresh object in one fixed order. `value` must
 * be an object; what in it fails a check is left out by itself.
 */
function soundProgress(value: object): Progress {
  const has = (field: string): boolean => Object.hasOwn(value, field);
  const fields = value as Record<string, unknown>;
  const following = has('following') && isStepId(fields.following) ? fields.following : null;
  // Built in the order it is written in: the version, who is followed and since when, then the steps.
  const progress: Progress =
    has('followedAt') && isTime(fields.followedAt) ? { v: 1, following, followedAt: fields.followedAt, steps: {} } : { v: 1, following, steps: {} };
  const steps = has('steps') ? fields.steps : undefined;
  if (typeof steps === 'object' && steps !== null && !Array.isArray(steps)) {
    for (const id of STEPS) {
      if (!Object.hasOwn(steps, id)) continue;
      const note = soundNote(id, (steps as Record<string, unknown>)[id]);
      if (note !== null) progress.steps[id] = note;
    }
  }
  return progress;
}

// -- reading ------------------------------------------------------------------

/**
 * What is stored, as the page may use it.
 *
 *   none        nothing is stored: no step was ever opened here (or the note was forgotten)
 *   kept        a note of this version: `progress` is what it holds
 *   unreadable  something is stored that is no note: not JSON, not an object, or
 *               with no whole number for its version. It counts as no progress,
 *               and the next write puts a note in its place
 *   newer       a note written by a newer version of this page. This version
 *               reads nothing of it, writes nothing and deletes nothing
 *   blocked     the browser will not let this page read its storage at all
 *
 * `progress` is empty for everything but "kept".
 */
export interface Read {
  state: 'none' | 'kept' | 'unreadable' | 'newer' | 'blocked';
  progress: Progress;
}

/** Reads the text of a stored note. Pure: `text` is what the storage holds under PROGRESS_KEY, or null. */
export function parseProgress(text: string | null): Read {
  if (text === null) return { state: 'none', progress: emptyProgress() };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { state: 'unreadable', progress: emptyProgress() };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { state: 'unreadable', progress: emptyProgress() };
  const v = Object.hasOwn(value, 'v') ? (value as Record<string, unknown>).v : undefined;
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) return { state: 'unreadable', progress: emptyProgress() };
  if (v > 1) return { state: 'newer', progress: emptyProgress() };
  // A version below 1 was never written by any version of this page.
  if (v !== 1) return { state: 'unreadable', progress: emptyProgress() };
  return { state: 'kept', progress: soundProgress(value) };
}

/** The text stored under PROGRESS_KEY: null when there is none, undefined when the storage cannot be read. */
function storedText(local: Storage): string | null | undefined {
  try {
    const text = local.getItem(PROGRESS_KEY);
    return typeof text === 'string' ? text : null;
  } catch {
    return undefined;
  }
}

/** The note in this browser. Never throws and never writes. */
export function readProgress(local: Storage): Read {
  const text = storedText(local);
  return text === undefined ? { state: 'blocked', progress: emptyProgress() } : parseProgress(text);
}

// -- changes ------------------------------------------------------------------

/**
 * One change to the note. Every write is one of these, handed to
 * writeProgress(). advance.ts makes them: from what changed in the world
 * (advance), from a question answered or a box ticked (answered), and
 * for what a reader does to the progress itself.
 *
 * Times are in ms since 1970. A change whose time is not one is ignored.
 */
export type Change =
  /**
   * The step's screen was opened. The step is started, `from` becomes its
   * way back if it is a valid one (one of the two pages of the step's own
   * chapter: validFrom), and the step is the one followed, unless it is
   * done: a done step that was still followed is let go instead (the
   * reader has now seen that it is done).
   */
  | { kind: 'open'; step: StepId; at: number; from: string | null }
  /** The step's tab came back into view, or its action link was used: it is the one followed, unless it is done or was never started. */
  | { kind: 'follow'; step: StepId; at: number }
  /** "Stop following", the strip closed, or a done step seen on its own screen: nothing is followed. Only if `step` is the one followed. */
  | { kind: 'stop'; step: StepId }
  /**
   * A part is ticked. It is written only if the step is started and not
   * done and every part before it is ticked. With the tick go the things
   * the part notes: a payment's ID and the moment it was sent, a wallet
   * fingerprint and how this browser kept that wallet. When it is the
   * step's last part, the step is done at `at`.
   */
  | { kind: 'tick'; step: StepId; part: number; at: number; tx?: string; sentAt?: number; wallet?: string; was?: 'passkey' | 'words' }
  /** A new payment for a step whose send part is ticked and whose note holds no payment (after "Send another"). */
  | { kind: 'payment'; step: StepId; tx: string; sentAt: number }
  /** "Send another": the noted payment is cleared, so that the next one sent while the step is followed takes its place. */
  | { kind: 'send-another'; step: StepId }
  /** the-seed, with its three words already checked: they were checked again, for the wallet that is here now. */
  | { kind: 'checked'; step: StepId; wallet: string }
  /** "Start this step again": the step's ticks and what it noted are cleared. Only for a step that is started and not done. */
  | { kind: 'restart'; step: StepId; at: number };

/** A copy two levels deep: a note, its steps and their ticks, with nothing shared with the original. */
function copyOf(progress: Progress): Progress {
  const copy: Progress = { ...progress, steps: {} };
  for (const id of STEPS) {
    const note = progress.steps[id];
    if (note !== undefined) copy.steps[id] = note.parts === undefined ? { ...note } : { ...note, parts: { ...note.parts } };
  }
  return copy;
}

/** True when every part of the step is ticked. */
function allTicked(id: StepId, note: StepNote): boolean {
  for (let part = 1; part <= STEP_DEFS[id].parts.length; part++) if (note.parts?.[part] !== true) return false;
  return true;
}

/**
 * The step is done, at `at`: the moment is written (once), and what the
 * step only needed on its way goes. The payment it waited for is deleted
 * from every step. The last step also lets go of the wallet fingerprint it
 * named for the drill; the-seed keeps the one its words were checked for,
 * because that is what a done the-seed shows.
 */
function finish(id: StepId, note: StepNote, at: number): void {
  note.doneAt ??= at;
  delete note.tx;
  delete note.sentAt;
  if (id === 'prove-the-backup') delete note.wallet;
}

/**
 * The note after one change. Pure: `progress` is left as it was, and the
 * answer is a fresh note that holds only what a note may hold, in one fixed
 * order. A change that does not apply (a tick for a step that was started
 * again in another tab, say) gives the note back unchanged in content.
 */
export function applyChange(progress: Progress, change: Change): Progress {
  const next = copyOf(progress);
  const id = change.step;
  if (!isStepId(id)) return soundProgress(next);
  const note = next.steps[id];
  const open = note?.started === true && note.doneAt === undefined;

  switch (change.kind) {
    case 'open': {
      if (!isTime(change.at)) break;
      const opened: StepNote = note ?? {};
      opened.started = true;
      // The latest valid way back: one of this step's two chapter pages. An opening without one leaves the earlier one alone.
      const from = validFrom(id, change.from);
      if (from !== null) opened.from = from;
      next.steps[id] = opened;
      if (opened.doneAt === undefined) {
        next.following = id;
        next.followedAt = change.at;
      } else if (next.following === id) {
        next.following = null;
        delete next.followedAt;
      }
      break;
    }

    case 'follow':
      if (!open || !isTime(change.at)) break;
      next.following = id;
      next.followedAt = change.at;
      break;

    case 'stop':
      if (next.following !== id) break;
      next.following = null;
      delete next.followedAt;
      break;

    case 'tick': {
      if (!open || note === undefined || !isTime(change.at)) break;
      const { part } = change;
      if (!Number.isInteger(part) || part < 1 || part > STEP_DEFS[id].parts.length) break;
      // Ticks come in order: every part before this one is ticked already.
      let inOrder = true;
      for (let before = 1; before < part; before++) if (note.parts?.[before] !== true) inOrder = false;
      if (!inOrder) break;
      if (note.parts?.[part] !== true) {
        note.parts = { ...note.parts, [part]: true };
        // What the part notes goes in with its tick. A payment is noted only where none is: the first one stands.
        if (isPayment(change.tx, change.sentAt) && note.tx === undefined) {
          note.tx = change.tx;
          note.sentAt = change.sentAt;
        }
        if (change.wallet !== undefined) note.wallet = change.wallet;
        if (change.was !== undefined) note.was = change.was;
        // A part of the followed step was ticked: it was followed just now.
        if (next.following === id) next.followedAt = change.at;
      }
      if (allTicked(id, note)) finish(id, note, change.at);
      break;
    }

    case 'payment': {
      const send = sendPart(id);
      if (!open || note === undefined || send === null) break;
      if (note.parts?.[send] !== true || note.tx !== undefined || !isPayment(change.tx, change.sentAt)) break;
      note.tx = change.tx;
      note.sentAt = change.sentAt;
      break;
    }

    case 'send-another':
      if (!open || note === undefined) break;
      delete note.tx;
      delete note.sentAt;
      break;

    case 'checked':
      // Only the step that keeps the fingerprint its words were checked for, and only once they were.
      if (id !== 'the-seed' || note === undefined || note.parts?.[STEP_DEFS[id].parts.length] !== true) break;
      note.wallet = change.wallet;
      break;

    case 'restart': {
      if (!open || note === undefined || !isTime(change.at)) break;
      // The reader is on the step's screen, so it starts again at once: started, followed, the same way back.
      const again: StepNote = { started: true };
      if (note.from !== undefined) again.from = note.from;
      next.steps[id] = again;
      next.following = id;
      next.followedAt = change.at;
      break;
    }
  }
  return soundProgress(next);
}

// -- writing ------------------------------------------------------------------

/**
 * How a write ended.
 *
 * ok       the change was applied to what is stored. `read` is the note as
 *          it stood in the storage for this write, `progress` the note
 *          after it, and `changed` says whether anything was written: a
 *          change that does not apply writes nothing.
 * newer    a newer version's note is stored: nothing was written
 * storage  the browser refused: the note could not be read or could not be
 *          written. Progress cannot be kept here
 */
export type WriteResult =
  | { ok: true; read: Progress; progress: Progress; changed: boolean }
  | { ok: false; why: 'newer' | 'storage' };

/**
 * THE write. It reads the stored text, applies one change to it and stores
 * the result, in one call with nothing awaited in between. Whatever a tab
 * has in memory plays no part: the stored note is the one that is changed.
 *
 * (The read and the write are two steps, and another tab could in theory
 * slip between them. The browser's storage offers nothing closer to one
 * step. What can be lost that way is one tick, which the same world brings
 * back at the next change.)
 */
export function writeProgress(local: Storage, change: Change): WriteResult {
  const text = storedText(local);
  if (text === undefined) return { ok: false, why: 'storage' };
  const stored = parseProgress(text);
  if (stored.state === 'newer') return { ok: false, why: 'newer' };
  const next = applyChange(stored.progress, change);
  const written = JSON.stringify(next);
  // Nothing to change: nothing is written. (Something unreadable stays until there is.)
  if (written === JSON.stringify(stored.progress)) return { ok: true, read: stored.progress, progress: next, changed: false };
  try {
    local.setItem(PROGRESS_KEY, written);
    // Read back: a browser that takes a write and keeps nothing has not kept it.
    if (local.getItem(PROGRESS_KEY) !== written) return { ok: false, why: 'storage' };
  } catch {
    return { ok: false, why: 'storage' };
  }
  return { ok: true, read: stored.progress, progress: next, changed: true };
}

/** "Start this step again": clears one step's ticks and what it noted. Through the one write, like every change. */
export function restartStep(local: Storage, step: StepId, at: number): WriteResult {
  return writeProgress(local, { kind: 'restart', step, at });
}

/**
 * "Forget my progress": deletes the note, and nothing else in the storage.
 * True when no note is stored afterwards. False when a newer version's
 * note is there (it is never deleted by this one) or the browser refused.
 */
export function forgetProgress(local: Storage): boolean {
  const text = storedText(local);
  if (text === undefined) return false;
  if (text === null) return true;
  if (parseProgress(text).state === 'newer') return false;
  try {
    local.removeItem(PROGRESS_KEY);
    return local.getItem(PROGRESS_KEY) === null;
  } catch {
    return false;
  }
}

// -- the way back to the chapter ------------------------------------------------

/** `address`, if it is on the same origin as `siteUrl` and that is a web address. Otherwise null. */
function onSite(siteUrl: string, address: string): string | null {
  try {
    const site = new URL(siteUrl);
    if (site.protocol !== 'https:' && site.protocol !== 'http:') return null;
    return new URL(address).origin === site.origin ? address : null;
  } catch {
    return null;
  }
}

/**
 * The link back to the main site for a step: "Back to the chapter".
 *
 * The page is always the step's own chapter: the one of its two pages the
 * reader came from (the note's `from`), or, with no such note, the one in
 * the language of this page. Until the step is done the address ends
 * "#do-<id>": the chapter scrolls to the step's card and nothing is
 * stamped. Once it is done it ends "#done=<id>", which is what the main
 * site stamps on.
 *
 * That is all the address holds: the main site's own address, one of the
 * chapter's two paths, and the mark. The mark names the step and says
 * whether it is done (About says so to the reader). Nothing of the wallet
 * is in it, and the link sends no referrer (ChapterLink.svelte).
 *
 * `siteUrl` is the main site's address from the settings, with no slash at
 * its end. The way back is checked once more here (validFrom), so a note
 * handed in from anywhere cannot choose the page. The built address is used
 * only if its origin is the main site's: null means that it cannot be built
 * from these settings, so the screen shows no link.
 */
export function chapterLink(siteUrl: string, id: StepId, lang: Lang, note: StepNote | undefined): string | null {
  const site = siteUrl.replace(/\/+$/, '');
  const mark = note?.doneAt === undefined ? `#do-${id}` : `#done=${id}`;
  // One of the chapter's two pages, whatever the note holds: the one the reader came from, or this page's language.
  const path = validFrom(id, note?.from) ?? STEP_DEFS[id].chapter.path[lang];
  return onSite(site, `${site}${path}${mark}`);
}

// -- what the wallet is told ---------------------------------------------------------

/**
 * The screen the wallet is told is open (wallet.watch), by which it decides
 * what to read from the practice network: the screen the address names, with
 * one exception. A step's screen reads the chain like a wallet screen,
 * because the step's parts are ticked from what the chain says. A step that
 * is done has nothing left to tick, so its screen is told as the list of
 * steps, for which the wallet reads nothing: a reader who lingers over a
 * finished step costs the practice network no request. Whatever shows on
 * that screen and repeats what the wallet read (the strip of another step)
 * goes by the same answer.
 */
export function watchedScreen(route: Route, progress: Progress): Route['name'] {
  return route.name === 'step' && progress.steps[route.id]?.doneAt !== undefined ? 'do' : route.name;
}

// -- the strip ------------------------------------------------------------------

/** How long after a step was last followed the strip goes on showing it: 24 hours, in ms. */
export const STRIP_MS = 86_400_000;

/**
 * The step the strip shows at `now` (ms since 1970), or null: the one that
 * is followed, for 24 hours after it was last followed. After that the note
 * still says which step it was (an event still counts for it), and the
 * strip stays away until the reader opens the step again.
 */
export function stripStep(progress: Progress, now: number): StepId | null {
  const { following, followedAt } = progress;
  if (following === null || followedAt === undefined) return null;
  // Only a step whose screen was opened is ever followed. A note that says otherwise was not
  // written by this page, and the strip has nothing true to say of such a step.
  if (progress.steps[following]?.started !== true) return null;
  return now - followedAt < STRIP_MS ? following : null;
}
