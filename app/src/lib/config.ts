// The public facts the app runs on: where the explorer is, what the faucet
// pays, how often a block comes.
//
// The app has to work the moment it loads, so it carries production's values
// itself. It then asks its Worker once (GET /api/config) what this deployment
// really uses: a local run has its own explorer and no bot check, for
// example. Each value the Worker gives replaces the built-in one. A value it
// leaves out, sends empty, or sends as the wrong kind of thing, is ignored,
// so a broken answer can never leave the app without a setting. (One value
// may be empty: with no site key for the bot check, the faucet is closed.)

import { API, type AppConfig } from '@learnbitcoin/practice-contract';
import type { FetchLike } from '@learnbitcoin/practice-wallet';

/**
 * Production's values. Nothing here is secret, and nothing can change them:
 * the object is frozen, and loadConfig hands out copies.
 *
 * The compiler still lets this object be held where an AppConfig is wanted,
 * and a write into it there throws when it runs. So whatever keeps the app's
 * settings holds a copy ({ ...DEFAULT_CONFIG }), or swaps in the whole object
 * loadConfig gives. It never writes into this one.
 */
export const DEFAULT_CONFIG: Readonly<AppConfig> = Object.freeze({
  // No site key: the faucet stays closed until the Worker names one.
  turnstileSiteKey: '',
  explorerUrl: 'https://practice-explorer.learnbitcoin.com',
  electrumHost: 'practice-electrum.learnbitcoin.com',
  electrumPort: 50002,
  siteUrl: 'https://www.learnbitcoin.com',
  sourceUrl: 'https://github.com/treib-holdings/learnbitcoin-practice',
  passkeyHost: 'practice.learnbitcoin.com',
  faucetSats: 100000,
  blockSeconds: 30,
  // Nothing is counted until the Worker says events are wanted.
  events: false,
});

/**
 * The one text setting that may be empty. The contract gives an empty site
 * key a meaning: there is no bot check, so the faucet is closed.
 */
const MAY_BE_EMPTY: keyof AppConfig = 'turnstileSiteKey';

/** True when the Worker's value for `key` can stand in for the built-in one. */
function usable(key: keyof AppConfig, value: unknown): boolean {
  const builtIn = DEFAULT_CONFIG[key];
  // Every number here is a count (a port, sats, seconds): whole and above
  // zero. JSON can also carry 1.5, -1 or a number too large to be exact.
  if (typeof builtIn === 'number') return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  if (typeof builtIn === 'string') {
    // The Worker answers "" for a text setting that is not set, so that is
    // how a missing setting arrives. An empty explorer address or passkey
    // host is no setting at all: the built-in one stays.
    return typeof value === 'string' && (key === MAY_BE_EMPTY || value.trim() !== '');
  }
  return typeof value === typeof builtIn;
}

function take<K extends keyof AppConfig>(config: AppConfig, key: K, value: unknown): void {
  if (usable(key, value)) config[key] = value as AppConfig[K];
}

/**
 * The built-in values with the Worker's laid over them, key by key. One
 * request and no second try. It never throws: with no answer, or one that
 * cannot be read, the built-in values come back as they are.
 */
export async function loadConfig(fetchFn: FetchLike = (input, init) => fetch(input, init)): Promise<AppConfig> {
  const config: AppConfig = { ...DEFAULT_CONFIG };
  try {
    const res = await fetchFn(API.config);
    if (!res.ok) return config;
    const answer: unknown = await res.json();
    if (typeof answer !== 'object' || answer === null) return config;
    const given = answer as Record<string, unknown>;
    // Only the keys this app knows. Anything else in the answer is left behind.
    for (const key of Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[]) take(config, key, given[key]);
  } catch {
    // No answer, or one that is not JSON: the built-in values stand.
  }
  return config;
}
