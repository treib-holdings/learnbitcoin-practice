// What the Settings screen decides, as plain functions so that "node --test"
// can check every one: which lines say what this browser keeps, which
// sentence says what brings a removed wallet back, whether the wallet the
// reader was asked about is still the one here, and the day the wallet has
// been in this browser since.

import type { Lang } from '@learnbitcoin/practice-contract';
import { formatDate } from '../../lib/format.ts';

/**
 * The two kinds of wallet, by how this browser opens one: with a passkey,
 * or with the 12 words it keeps. It is the record's `kind`, and it says
 * nothing about how the wallet was first made: a wallet made with a
 * passkey and later restored here from its 12 words is of the kind "words".
 */
export type WalletKind = 'passkey' | 'words';

/**
 * The lines of "What this browser keeps", in the order they are shown.
 *
 *   public         the wallet's public key, always: so anyone who uses this
 *                  browser can see the wallet
 *   no-words       a passkey wallet: the 12 words are not kept
 *   words          a wallet opened without a passkey: the 12 words are kept,
 *                  not encrypted, so anyone who uses this browser can spend
 *   persisted      the browser agreed to keep this page's data
 *   not-persisted  the browser was asked, and did not agree
 */
export type KeepsLine = 'public' | 'no-words' | 'words' | 'persisted' | 'not-persisted';

/**
 * What this browser keeps, for a wallet of this kind. `persisted` is the
 * wallet's own answer (WalletApi.persisted): true or false once the browser
 * has said whether it will keep this page's data, null when it was not
 * asked or has not answered. Only a wallet kept with its 12 words is asked
 * about, because only its words live in this browser; a passkey wallet
 * comes back from its passkey whatever the browser erases. Where the answer
 * is not known the screen says nothing about it: it never guesses.
 */
export function keepsLines(kind: WalletKind, persisted: boolean | null): KeepsLine[] {
  const lines: KeepsLine[] = ['public', kind === 'passkey' ? 'no-words' : 'words'];
  if (kind === 'words' && persisted !== null) lines.push(persisted ? 'persisted' : 'not-persisted');
  return lines;
}

/**
 * The key, in strings/settings.ts, of the sentence that says what brings a
 * removed wallet back. A passkey wallet comes back with its passkey or its
 * 12 words, and the sentence promises no passkey. A wallet kept here with
 * its words comes back with those words, and with its passkey if it was
 * made with one, which this browser cannot know.
 */
export function removeBackKey(kind: WalletKind): 'removeBackPasskey' | 'removeBackWords' {
  return kind === 'passkey' ? 'removeBackPasskey' : 'removeBackWords';
}

/**
 * True while the wallet in this browser is still the one the reader was
 * asked about, by its public key. Another tab can remove or replace the
 * wallet while the question is open. "Remove it" then must not go on to
 * remove whatever is here now: the reader never said yes to that.
 */
export function sameWallet(askedFor: string | null, now: string | null): boolean {
  return askedFor !== null && askedFor === now;
}

/**
 * What the screen does with each answer removeWallet() can give.
 *
 *   removed  the wallet is out of this browser: go Home
 *   gone     nothing was removed, because the wallet here is no longer the
 *            one this page loaded: stay, and say so
 */
export function afterRemove(answer: 'removed' | 'gone'): 'home' | 'say-gone' {
  return answer === 'removed' ? 'home' : 'say-gone';
}

/**
 * The day the wallet has been in this browser since, on the reader's own
 * calendar: "November 14, 2026" or "14 de noviembre de 2026". A record
 * keeps the moment it was written, in milliseconds since 1970. That is the
 * moment the wallet was made here, or opened or restored here: it is not
 * the day the wallet was first made, which no record holds.
 */
export function hereSince(createdAt: number, lang: Lang, zone: 'local' | 'utc' = 'local'): string {
  return formatDate(Math.floor(createdAt / 1000), lang, zone);
}
