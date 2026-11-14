// What the frame of every wallet screen decides, as plain functions so that
// "node --test" can check them: the wallet's sections, which line about the
// practice network a screen shows and what it says of a failed look, and
// the sentence for each thing the wallet, or an unlock, has to announce.

import type { Lang } from '@learnbitcoin/practice-contract';
import type { ApiFailure } from '../../lib/api.ts';
import { fill, formatSats } from '../../lib/format.ts';
import type { ChainView, Notice } from '../../lib/wallet-api.ts';
import { strings } from '../../strings/index.ts';
import { splitLead, withoutLastSentence } from '../text.ts';
import type { FrameNote } from './frame-notes.ts';

/** The wallet's sections, in the order of their links. Each is a route's name. */
export const SECTIONS = ['wallet', 'coins', 'receive', 'send', 'activity', 'backup', 'settings'] as const;

export type Section = (typeof SECTIONS)[number];

/**
 * How many days Safari keeps what a site stored when the site is not used.
 * Not a setting of ours but the browser's own rule, so it is written here
 * once and filled into every sentence that names it.
 */
export const SAFARI_KEEPS_DAYS = 7;

/**
 * What a wallet screen says about the coins (SPEC section 3):
 *   looking  the first scan has not finished: no total, never a total of 0
 *   failed   the first scan failed: the cause, and "Try again"
 *   stale    a later refresh failed: the last values stay, with their age
 *   fresh    the coins are known and the last look at the network worked
 */
export type ChainPhase = 'looking' | 'failed' | 'stale' | 'fresh';

export function chainPhase(chain: Pick<ChainView, 'state' | 'error'>): ChainPhase {
  if (chain.state === null) return chain.error === null ? 'looking' : 'failed';
  return chain.error === null ? 'fresh' : 'stale';
}

/**
 * The failures whose whole way out is to wait and try again. The frame does
 * exactly that by itself, and says so in lines of its own under the
 * sentence: a countdown to its next try, and a "Try again" button.
 */
const FRAME_RETRIES: readonly ApiFailure[] = ['unavailable', 'limit'];

/**
 * What the frame says about a failed look at the practice network: the
 * sentence from the error table, which gives the cause and then the way out.
 *
 * For the failures that only waiting cures, the sentence's last part is
 * left out. "Try again in a minute." above the frame's own "This page tries
 * again by itself in 13 seconds." and a "Try again" button would be three
 * instructions that disagree. The cause stays, and so does the line that
 * says the fault is ours. Every other sentence is shown whole: its way out
 * (check the connection, reload the page) is something the frame's own
 * lines do not say.
 */
export function chainFailureText(failure: ApiFailure, lang: Lang): string {
  const sentence = strings.errors[lang][failure];
  return FRAME_RETRIES.includes(failure) ? withoutLastSentence(sentence) : sentence;
}

/**
 * What the status region says when the frame takes a note from an unlock,
 * or null when the note speaks for itself. A switch to another passkey's
 * wallet changes which wallet this browser holds, and its note is a quiet
 * box that a screen reader is not told about: so its first sentence is
 * said. The note about saved details that were wrong is an alert already.
 */
export function noteAnnouncement(note: FrameNote, lang: Lang): string | null {
  return note.kind === 'switched' ? splitLead(strings.wallet[lang].noteSwitched).lead : null;
}

/** An amount with its unit, for a sentence: "25,000 practice sats", "1 practice sat". */
export function satsText(sats: bigint, lang: Lang): string {
  const c = strings.common[lang];
  return `${formatSats(sats)} ${sats === 1n || sats === -1n ? c.practiceSat : c.practiceSats}`;
}

/**
 * The sentence the status region says for something that just happened to
 * the wallet. Outcomes only: coins arrived, 1 confirmation, payment sent,
 * unlocked, locked.
 */
export function noticeText(notice: Notice, lang: Lang): string {
  const t = strings.wallet[lang];
  switch (notice.kind) {
    case 'coins-arrived':
      // One sat and several are two sentences, because in Spanish the verb changes with the count.
      return notice.sats === 1n ? t.noticeArrivedOne : fill(t.noticeArrived, { amount: formatSats(notice.sats) });
    case 'confirmed':
      return t.noticeConfirmed;
    case 'payment-sent':
      return t.noticeSent;
    case 'unlocked':
      return t.noticeUnlocked;
    case 'locked':
      return t.noticeLocked;
  }
}
