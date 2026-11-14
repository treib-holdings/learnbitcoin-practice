// What the unlock step does with each answer the wallet can give, as plain
// functions so that "node --test" can check every one: which answers are a
// problem to show, and which ways on the reader is offered after each.

import type { CeremonyFailure, UnlockResult, UnlockWordsResult } from '../../lib/wallet-api.ts';

/**
 * How an unlock ended well. The caller is told, because two of the three
 * change what a screen was in the middle of:
 *   same      this wallet's keys are loaded
 *   tampered  the keys are loaded, but what this browser had saved about the
 *             wallet was wrong and has been rebuilt: its coins are being
 *             looked up again, so a payment planned before must be planned again
 *   switched  the reader chose another passkey's wallet: this browser now
 *             holds that wallet, unlocked, and its coins are being looked up
 */
export type Unlocked = 'same' | 'tampered' | 'switched';

/** What went wrong at the last try. */
export type UnlockProblem =
  /** The passkey step did not finish. */
  | { kind: 'passkey'; failure: CeremonyFailure }
  /** The stored passkey gave a wallet that fits nothing saved here: never opened. */
  | { kind: 'changed' }
  /** The wallet was removed or replaced in another tab. */
  | { kind: 'gone' }
  /** The words typed are not twelve valid words. */
  | { kind: 'words-invalid' }
  /** The words typed are valid, and another wallet's. */
  | { kind: 'other-wallet' }
  /** The reader asked to switch wallets and the browser would not store the change. */
  | { kind: 'no-storage' };

/** The answers of unlock() that open nothing. */
export type UnlockRefusal = Exclude<UnlockResult, { kind: 'unlocked' | 'tampered' | 'other-passkey' }>;

/** The problem to show for an unlock() that opened nothing. */
export function problemOfUnlock(result: UnlockRefusal): UnlockProblem {
  if (result.kind === 'changed' || result.kind === 'gone') return { kind: result.kind };
  return { kind: 'passkey', failure: result };
}

/** The problem to show for an unlockWithWords() that opened nothing. */
export function problemOfWords(result: Exclude<UnlockWordsResult, 'unlocked'>): UnlockProblem {
  switch (result) {
    case 'invalid':
      return { kind: 'words-invalid' };
    case 'other-wallet':
      return { kind: 'other-wallet' };
    case 'gone':
      return { kind: 'gone' };
    // The same two dead ends a passkey step can meet, with the same sentences.
    case 'reload':
      return { kind: 'passkey', failure: { kind: 'reload' } };
    case 'broken':
      return { kind: 'passkey', failure: { kind: 'broken' } };
  }
}

/** The ways on the step shows under what it says. */
export interface UnlockOffers {
  /** "Unlock with my passkey": the passkey this browser remembers. */
  stored: boolean;
  /** "Choose another passkey". */
  picker: boolean;
  /** "Use the 12 words". */
  words: boolean;
}

/**
 * Which ways on are offered. `refused` is true once any try has ended
 * without opening the wallet: before that the step shows its one button,
 * and after it the other two as well.
 *
 * Three answers offer less. After "changed" the same passkey would only
 * give the same answer, so the words are the one way on from here (the
 * other is Remove, on the Settings screen). After "gone", and after the
 * two dead ends ("reload", "broken"), nothing on this page can help until
 * it is loaded again, or at all.
 */
export function unlockOffers(problem: UnlockProblem | null, refused: boolean): UnlockOffers {
  const none: UnlockOffers = { stored: false, picker: false, words: false };
  if (problem === null) return { stored: true, picker: refused, words: refused };
  switch (problem.kind) {
    case 'changed':
      return { ...none, words: true };
    case 'gone':
      return none;
    case 'passkey':
      if (problem.failure.kind === 'reload' || problem.failure.kind === 'broken') return none;
      return { stored: true, picker: true, words: true };
    default:
      return { stored: true, picker: true, words: true };
  }
}
