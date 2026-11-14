// What the About page shows that depends on this run and on this browser:
// the practice network's facts, which come from the wallet's settings and
// are never typed into a sentence; what this browser holds right now; and
// the list of what is counted, which is the contract's own list.
//
// Plain functions, so that "node --test" can hold each to its rule.

import { EVENTS, type AppConfig, type EventName, type Lang } from '@learnbitcoin/practice-contract';
import { satsText } from '../../components/wallet/frame.ts';
import { fill, formatSats } from '../../lib/format.ts';
import type { PublicRecord, WalletStatus } from '../../lib/wallet-api.ts';
import { strings } from '../../strings/index.ts';

type AboutKey = keyof typeof strings.about.en;

// -- the practice network ---------------------------------------------------------

/** How often the practice network makes a block: "About one every 30 seconds". */
export function blocksText(config: AppConfig, lang: Lang): string {
  const t = strings.about[lang];
  // One second is its own sentence, so that no language has to bend a plural.
  if (config.blockSeconds === 1) return t.netBlocksEveryOne;
  return fill(t.netBlocksEvery, { seconds: formatSats(config.blockSeconds) });
}

/** What the faucet gives for one request: "100,000 practice sats for each request". */
export function faucetText(config: AppConfig, lang: Lang): string {
  return fill(strings.about[lang].netFaucetGives, { amount: satsText(BigInt(config.faucetSats), lang) });
}

/**
 * The words of a link to an address of the web: the address as a reader
 * would say it, without "https://" and without a slash at its end. Text
 * that is no address comes back as it is: a link must never be left
 * without words.
 */
export function linkText(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    if (host === '') return url;
    return pathname === '/' ? host : host + pathname.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

/**
 * Whether the settings a screen is looking at are the ones this visit will
 * keep. The wallet draws a page at once with its built-in settings, and
 * swaps in the server's when they arrive; it has no field that says which
 * of the two a screen is looking at. The built-in ones say that nothing is
 * counted and that the faucet is closed, so a line that reads those two
 * would say "off" for the first moment of every visit and then, when the
 * answer comes, the opposite.
 *
 * The one sign the wallet gives is whether passkeys are offered. That is
 * null until the settings have been loaded (or given up on) and the browser
 * has then been asked about passkeys, in that order (lib/wallet.svelte.ts).
 * So it is null for exactly as long as the settings may still change, and
 * the lines that would say "off" wait for it.
 */
export function settingsArrived(passkeyOffered: boolean | null): boolean {
  return passkeyOffered !== null;
}

/**
 * True when the settings name no bot check. The server then pays nobody,
 * whatever the faucet's amount is (the contract: an empty site key closes
 * the faucet), and the page says so beside the amount.
 */
export function faucetClosed(config: AppConfig): boolean {
  return config.turnstileSiteKey === '';
}

// -- what this browser holds right now ----------------------------------------------

/**
 * none        nothing is stored: this browser has no practice wallet
 * passkey     the record of a wallet this browser opens with a passkey: no words
 * words       the record of a wallet kept with its 12 words, in plain text: one made
 *             without a passkey, or any wallet restored here from its words
 * unreadable  something is stored under the wallet's key that cannot be read
 * newer       a record written by a newer version of the page
 * broken      the self-test failed, so the page has read nothing and stores nothing
 */
export type KeptNow = 'none' | 'passkey' | 'words' | 'unreadable' | 'newer' | 'broken';

/**
 * What this browser holds for the page at this moment, from the wallet's
 * status and its record. Null when that cannot be said for certain: the
 * status is "ready" and yet there is no record to tell the kind from. The
 * wallet promises that never happens. If it ever did, saying nothing is
 * right, and guessing a kind would not be.
 */
export function keptNow(status: WalletStatus, record: PublicRecord | null): KeptNow | null {
  switch (status) {
    case 'none':
      return 'none';
    case 'ready':
      return record === null ? null : record.kind;
    case 'unreadable':
      return 'unreadable';
    case 'newer':
      return 'newer';
    case 'broken':
      return 'broken';
  }
}

/** The sentence, in the About table, for each thing this browser can hold. */
export const KEPT_KEYS = {
  none: 'keepNowNone',
  passkey: 'keepNowPasskey',
  words: 'keepNowWords',
  unreadable: 'keepNowUnreadable',
  newer: 'keepNowNewer',
  broken: 'keepNowBroken',
} as const satisfies Record<KeptNow, AboutKey>;

// -- what is counted ---------------------------------------------------------------

/**
 * The sentence, in the About table, for each event of the contract. The
 * list of events is the contract's and nobody else's: add one there, and
 * this table does not build until the About page has a sentence for it.
 */
export const COUNT_KEYS = {
  pageview: 'count_pageview',
  'Wallet created': 'count_walletCreated',
  Passkey: 'count_passkey',
  Unlock: 'count_unlock',
  Restore: 'count_restore',
  Faucet: 'count_faucet',
  Payment: 'count_payment',
  'Words shown': 'count_wordsShown',
  'Wallet removed': 'count_walletRemoved',
} as const satisfies Record<EventName, AboutKey>;

/** Everything the app counts, in the contract's order: the event's name as it is sent, and what it means. */
export function countedEvents(lang: Lang): { name: EventName; text: string }[] {
  const t = strings.about[lang];
  return (Object.keys(EVENTS) as EventName[]).map((name) => ({ name, text: t[COUNT_KEYS[name]] }));
}
