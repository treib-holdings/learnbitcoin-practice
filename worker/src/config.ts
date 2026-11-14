// What GET /api/config answers, built from the Worker's settings.
//
// The settings are the "vars" in wrangler.jsonc. Every one of them reaches
// the Worker as text, so the three numbers are turned into numbers here, once,
// and the app never has to wonder whether a port is 50002 or "50002".

import type { AppConfig } from '@learnbitcoin/practice-contract';

/** The settings the app's config is made from. All of them are public. */
export interface ConfigVars {
  /** Empty until the bot check has a widget: the faucet is then closed. */
  TURNSTILE_SITE_KEY: string;
  EXPLORER_URL: string;
  ELECTRUM_HOST: string;
  ELECTRUM_PORT: string | number;
  /** Empty until events have somewhere to go: the app then sends none. */
  PLAUSIBLE_DOMAIN: string;
  SITE_URL: string;
  SOURCE_URL: string;
  PASSKEY_HOST: string;
  FAUCET_SATS: string | number;
  BLOCK_SECONDS: string | number;
}

/**
 * The app's config. Throws when a number is missing or is not a whole
 * number above zero: a half-filled config would put "NaN sats" on a screen,
 * and a test runs this over the values in wrangler.jsonc so that a slip
 * there is caught before a deploy.
 */
export function configFromEnv(vars: ConfigVars): AppConfig {
  return {
    turnstileSiteKey: text(vars.TURNSTILE_SITE_KEY),
    explorerUrl: url(vars.EXPLORER_URL),
    electrumHost: text(vars.ELECTRUM_HOST),
    electrumPort: whole('ELECTRUM_PORT', vars.ELECTRUM_PORT, 65_535),
    siteUrl: url(vars.SITE_URL),
    sourceUrl: url(vars.SOURCE_URL),
    passkeyHost: text(vars.PASSKEY_HOST),
    faucetSats: whole('FAUCET_SATS', vars.FAUCET_SATS, Number.MAX_SAFE_INTEGER),
    blockSeconds: whole('BLOCK_SECONDS', vars.BLOCK_SECONDS, 86_400),
    events: text(vars.PLAUSIBLE_DOMAIN) !== '',
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The app adds its own paths to these, so they end without a slash. */
function url(value: unknown): string {
  return text(value).replace(/\/+$/, '');
}

function whole(name: string, value: unknown, max: number): number {
  const digits = typeof value === 'number' ? String(value) : text(value);
  const parsed = /^[0-9]+$/.test(digits) ? Number(digits) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    // The name of the setting only. Its value stays out of the message.
    throw new Error(`${name} must be a whole number from 1 to ${max}`);
  }
  return parsed;
}
