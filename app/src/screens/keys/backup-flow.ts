// What the Backup screen decides, as plain functions so that "node --test"
// can check every one: which of its steps shows, what a press on "Show the
// 12 words" leads to, what follows each way an unlock can end, when words
// that are on screen must leave it and whether the screen then says why,
// and the address of chapter 4.

import type { Lang } from '@learnbitcoin/practice-contract';
import type { Unlocked } from '../../components/wallet/unlock-flow.ts';

/**
 * The steps of the Backup screen. One shows at a time, and each swaps in
 * place of the one before it.
 *
 *   made    the "Wallet made" step, straight after a create: the 12 words
 *           are on screen already, with no second prompt
 *   ask     the words are not shown: why this page is the exception, what
 *           to know first, and "Show the 12 words"
 *   unlock  a passkey wallet that is locked: the unlock step, which the
 *           reader reached by asking for the words
 *   shown   the words are on screen, with "Hide them"
 */
export type BackupView = 'made' | 'ask' | 'unlock' | 'shown';

/** What the screen and the wallet hold at one moment. */
export interface BackupState {
  /** WalletApi.created: set straight after a create, until it is acknowledged. */
  created: 'passkey' | 'words' | null;
  /** A passkey wallet whose keys are not loaded. */
  locked: boolean;
  /** The screen holds the 12 words. */
  shown: boolean;
  /** The reader asked for the words of a locked wallet and has not unlocked it yet. */
  unlocking: boolean;
}

/**
 * Which step shows. The words on screen decide first: with them it is the
 * "Wallet made" step while the wallet says it was just created, and the
 * plain "shown" step at any other time. Without them the screen asks, or
 * stands at the unlock step once the reader has asked. A wallet that is
 * not locked never shows the unlock step, whatever was asked before.
 */
export function backupView(state: BackupState): BackupView {
  if (state.shown) return state.created !== null ? 'made' : 'shown';
  return state.unlocking && state.locked ? 'unlock' : 'ask';
}

/**
 * What a press on "Show the 12 words" leads to: the words at once, or the
 * unlock step first for a passkey wallet whose keys are not loaded. A
 * wallet made without a passkey is never locked.
 */
export function showPlan(locked: boolean): 'reveal' | 'unlock' {
  return locked ? 'unlock' : 'reveal';
}

/**
 * What follows an unlock that the reader began in order to see the words.
 *
 *   same      the keys of this wallet are loaded: show its words
 *   tampered  the same, and what this browser had saved about the wallet
 *             was rebuilt from those keys: the words are still this
 *             wallet's, so show them (the wallet frame says what changed)
 *   switched  the reader chose another passkey's wallet, and that wallet
 *             is now the one in this browser. The words asked for were the
 *             other wallet's. Nothing is shown: the screen asks again, so
 *             that the words of the new wallet come up only when the
 *             reader asks for them knowing which wallet is here.
 */
export function afterUnlock(how: Unlocked): 'reveal' | 'ask' {
  return how === 'switched' ? 'ask' : 'reveal';
}

/** The wallet the words on screen belong to, and the wallet that is in this browser now. */
export interface WordsOwner {
  /** The public key of the wallet whose words are on screen, or null when none are. */
  shownFor: string | null;
  /** The public key of the wallet in this browser, or null when there is none. */
  wallet: string | null;
  /** WalletApi.unlocked: the wallet's keys are loaded. */
  unlocked: boolean;
}

/**
 * True when words that are on screen must leave it: the wallet was locked
 * (the keys are gone, and the words go with them), or the wallet in this
 * browser is no longer the one whose words are shown (it was removed or
 * replaced in another tab). With no words on screen there is nothing to drop.
 */
export function mustDropWords(owner: WordsOwner): boolean {
  if (owner.shownFor === null) return false;
  return !owner.unlocked || owner.wallet !== owner.shownFor;
}

/**
 * True when the words leave the screen because the wallet in this browser
 * is no longer theirs: another tab removed it or put another wallet in its
 * place. The reader did nothing on this screen to bring that about, so the
 * screen says why the words are gone. A lock is the reader's own doing, or
 * follows a step they took, and is said by the wallet frame.
 */
export function takenByAnotherTab(owner: WordsOwner): boolean {
  return owner.shownFor !== null && owner.wallet !== owner.shownFor;
}

/**
 * Where chapter 4 of the main site's Journey is, in each language. The
 * exception paragraph answers a rule of that chapter, so the screen links
 * to it. Both pages exist; the site keeps its Spanish edition under /es.
 */
export const CHAPTER_PATH: Readonly<Record<Lang, string>> = {
  en: '/journey/be-your-own-bank',
  es: '/es/recorrido/se-tu-propio-banco',
};

/** The address of chapter 4 in the page's language. `siteUrl` comes without a slash at its end. */
export function chapterUrl(siteUrl: string, lang: Lang): string {
  return `${siteUrl}${CHAPTER_PATH[lang]}`;
}
