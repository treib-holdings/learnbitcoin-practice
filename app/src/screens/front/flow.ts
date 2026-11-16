// What the three screens in front of the wallet decide (Home, Create and
// Restore), as plain functions so that "node --test" can check every one:
// what stands in a screen's place when no wallet can be made or brought
// here, what each answer of the wallet means for the reader, and which
// words say which wallet is in this browser.
//
// The wallet's own types list every way an action can end
// (lib/wallet-api.ts). Each function here takes one of those answers and
// names what the screen shows for it. Every `switch` lists every answer, and
// the compiler holds it to the list: a new answer without a line here does
// not build.

import type { Lang } from '@learnbitcoin/practice-contract';
import type { ApiFailure } from '../../lib/api.ts';
import type {
  CeremonyFailure,
  CreateResult,
  KeepResult,
  PublicRecord,
  RestoreResult,
  WalletStatus,
} from '../../lib/wallet-api.ts';

// -- what stands in the screen's place ----------------------------------------------

/**
 * An answer that stops the whole screen, not one of its ways: as the page
 * stands, nothing can be made or restored on it.
 *   exists      a wallet arrived in this browser meanwhile (another tab)
 *   no-storage  this browser refuses to store anything
 *   reload      the bot check has loaded in this page: only a fresh page helps
 */
export type Stop = 'exists' | 'no-storage' | 'reload';

/**
 * What Create and Restore show:
 *   open        nothing is in the way: the screen's own content
 *   trouble     what is stored cannot be used (unreadable, newer, broken), or this page was not
 *               let look at what is stored (blocked): the shared StoredTrouble piece
 *   here        a wallet is in this browser already
 *   arrived     the wallet answered "exists" and still shows none: reload to see it
 *   no-storage  this browser refuses to store anything: say so and stop
 *   reload      the bot check has loaded in this page: reload first
 */
export type Gate = 'open' | 'trouble' | 'here' | 'arrived' | 'no-storage' | 'reload';

/**
 * Which of them it is. What is stored comes first: a wallet that is here,
 * or something that cannot be read, decides whatever else is true. So does
 * a storage the page was not let look into: a wallet may be in it, and
 * nothing is made beside a wallet nobody can see. `stop` is how the
 * screen's last action ended, when that stopped the screen.
 */
export function frontGate(status: WalletStatus, canStore: boolean, stop: Stop | null): Gate {
  switch (status) {
    case 'unreadable':
    case 'newer':
    case 'broken':
    case 'blocked':
      return 'trouble';
    case 'ready':
      return 'here';
    case 'none':
      break;
  }
  if (stop === 'exists') return 'arrived';
  if (!canStore || stop === 'no-storage') return 'no-storage';
  if (stop === 'reload') return 'reload';
  return 'open';
}

// -- which wallet is here -------------------------------------------------------------

/** The line that says which wallet is in this browser: a key of strings/home.ts, and the passkey's tag when it has one. */
export type WalletLine = { key: 'herePasskeyTagged'; tag: string } | { key: 'herePasskey' } | { key: 'hereWords' };

/**
 * A wallet made with a passkey is pointed out by the four characters in its
 * passkey's name (all of the name that this browser keeps). One made
 * without a passkey says so, because its 12 words are in this browser.
 */
export function walletLine(record: Pick<PublicRecord, 'kind' | 'tag'>): WalletLine {
  switch (record.kind) {
    case 'words':
      return { key: 'hereWords' };
    case 'passkey':
      return record.tag === undefined || record.tag === '' ? { key: 'herePasskey' } : { key: 'herePasskeyTagged', tag: record.tag };
  }
}

/**
 * Where "Open my practice wallet" leads. Straight after a create the
 * wallet's first screen is the "Wallet made" step (/wallet/backup), which
 * shows the 12 words, and `created` stays set until the reader has moved on
 * from it. Create goes there by itself, but not when the reader left Create
 * while the passkey prompt was still open. So until that step has been
 * seen, the way in leads to it; after that, to the overview.
 */
export function wayIn(created: 'passkey' | 'words' | null): 'backup' | 'wallet' {
  return created === null ? 'wallet' : 'backup';
}

// -- create ---------------------------------------------------------------------------

/** The three taps of the Create screen: make a passkey, finish one that is waiting, or make a wallet without one. */
export type Way = 'passkey' | 'finish' | 'words';

/**
 * What the passkey's panel on Create holds:
 *   checking     not known yet whether this browser offers passkeys: the button waits
 *   offer        the explanation and "Create with a passkey"
 *   not-offered  this browser offers none: what to do instead
 *   finish       a passkey was saved and has not given its secret yet: "Finish setting up"
 */
export type PasskeyFace = 'checking' | 'offer' | 'not-offered' | 'finish';

/** A passkey that is waiting comes first: it exists, whatever the browser says about passkeys now. */
export function passkeyFace(offered: boolean | null, setup: { tag: string | null } | null): PasskeyFace {
  if (setup !== null) return 'finish';
  if (offered === null) return 'checking';
  return offered ? 'offer' : 'not-offered';
}

/**
 * How the name of every practice passkey starts: the text of the name
 * (passkeyName in strings/common.ts) in front of its tag. The Create screen
 * tells the reader what their device is about to ask, and the name is in
 * that question. Taken from the name itself, so the two cannot drift apart.
 */
export function passkeyNameStart(template: string): string {
  const at = template.indexOf('{tag}');
  return (at === -1 ? template : template.slice(0, at)).trim();
}

/**
 * What the screen adds under a passkey step that did not finish:
 *   nothing-saved   the prompt that makes the passkey was closed: no passkey, no wallet
 *   still-waiting   the passkey exists and still waits to be set up
 *   delete-passkey  the passkey exists and can never make a wallet: how to delete it
 *   none            the sentence from the error table says it all
 */
export type Advice = 'nothing-saved' | 'still-waiting' | 'delete-passkey' | 'none';

/** What the Create screen does with an answer. */
export type CreateView =
  /** The wallet is made and stored: go to the "Wallet made" step. */
  | { kind: 'made' }
  /** A passkey was saved and has not given its secret. `again`: a try to finish it did not. */
  | { kind: 'unfinished'; again: boolean }
  /** The whole screen stops. `orphan`: a passkey may have been saved a moment ago that now has no wallet. */
  | { kind: 'stopped'; why: Stop; orphan: boolean }
  /** A passkey step did not finish: the sentence from the error table, and what the screen adds. */
  | { kind: 'problem'; failure: CeremonyFailure; advice: Advice }
  /** Something this page should never be told. `name` goes in a details line. */
  | { kind: 'fault'; name: string };

/**
 * What an answer of createWithPasskey, finishSetup or createWithWords means
 * on the Create screen. The same answer can mean different things after
 * different taps: a closed prompt left no passkey behind when it was the
 * one that makes the passkey, and left one waiting when it was the one that
 * finishes it. A wallet made without a passkey asks for no prompt, so an
 * answer about a prompt after that tap is a fault of ours.
 */
export function createView(result: CreateResult, way: Way): CreateView {
  const prompted = way !== 'words';
  switch (result.kind) {
    case 'created':
      return { kind: 'made' };
    case 'unfinished':
      return prompted ? { kind: 'unfinished', again: way === 'finish' } : { kind: 'fault', name: result.kind };
    case 'exists':
    case 'no-storage':
      // After a prompt, either can mean that a passkey was saved before the wallet was refused.
      return { kind: 'stopped', why: result.kind, orphan: prompted };
    case 'reload':
      return { kind: 'stopped', why: 'reload', orphan: false };
    case 'cancelled':
      if (!prompted) return { kind: 'fault', name: result.kind };
      return { kind: 'problem', failure: result, advice: way === 'passkey' ? 'nothing-saved' : 'still-waiting' };
    case 'no-prf':
      return prompted ? { kind: 'problem', failure: result, advice: 'delete-passkey' } : { kind: 'fault', name: result.kind };
    case 'error':
      // "The browser could not finish the passkey step" is true only after a prompt.
      return prompted ? { kind: 'problem', failure: result, advice: 'none' } : { kind: 'fault', name: result.name };
    case 'busy':
    case 'broken':
      return { kind: 'problem', failure: result, advice: 'none' };
  }
}

// -- restore --------------------------------------------------------------------------

/** What the Restore screen does with an answer of restore(). */
export type RestoreView =
  /** Practice history was found and the wallet is stored: go to it. */
  | { kind: 'restored' }
  /** None was found and nothing is stored: the step "No practice coins found for these words" opens. */
  | { kind: 'empty' }
  | { kind: 'stopped'; why: Stop }
  /** Not twelve valid words. The fields check this first, so it should never be seen. */
  | { kind: 'invalid' }
  /** The look for history failed. Nothing was stored, and the words are still in the fields. */
  | { kind: 'failed'; reason: ApiFailure }
  /** The self-test failed. */
  | { kind: 'broken' };

export function restoreView(result: RestoreResult): RestoreView {
  switch (result.kind) {
    case 'restored':
    case 'empty':
    case 'invalid':
    case 'broken':
      return { kind: result.kind };
    case 'exists':
    case 'no-storage':
    case 'reload':
      return { kind: 'stopped', why: result.kind };
    case 'failed':
      return { kind: 'failed', reason: result.reason };
  }
}

/**
 * What the step "No practice coins found" does with an answer of keepRestored():
 *   restored  the words are stored: go to the wallet
 *   stopped   a wallet arrived in this browser meanwhile
 *   refused   the browser would not store them: the words go on waiting, and the reader may choose again
 *   lost      the words were no longer waiting: back to the empty fields
 */
export type KeepView = { kind: 'restored' } | { kind: 'stopped'; why: 'exists' } | { kind: 'refused' } | { kind: 'lost' };

export function keepView(result: KeepResult): KeepView {
  switch (result) {
    case 'restored':
      return { kind: 'restored' };
    case 'exists':
      return { kind: 'stopped', why: 'exists' };
    case 'no-storage':
      return { kind: 'refused' };
    case 'nothing-pending':
      return { kind: 'lost' };
  }
}

/**
 * Why "Restore" does not start yet, or null when it may: the fields first
 * (they say themselves what is wrong, and take focus), then the box.
 */
export function restoreHeldBy(wordsGood: boolean, ticked: boolean): 'words' | 'box' | null {
  if (!wordsGood) return 'words';
  return ticked ? null : 'box';
}

// -- chapter 4 --------------------------------------------------------------------------

/** Chapter 4 of the main site's Journey, which holds the rule this app's Restore screen is the one exception to. */
const CHAPTER_FOUR: Record<Lang, string> = {
  en: '/journey/be-your-own-bank',
  es: '/es/recorrido/se-tu-propio-banco',
};

/** Its address in the page's language. `siteUrl` comes without a slash at its end (the contract says so). */
export function chapterFourUrl(siteUrl: string, lang: Lang): string {
  return siteUrl + CHAPTER_FOUR[lang];
}
