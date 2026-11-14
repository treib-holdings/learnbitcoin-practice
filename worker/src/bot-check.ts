// The faucet's bot check, on the Worker's side.
//
// The app shows Cloudflare Turnstile when a reader asks for practice coins
// and sends the token it gets to POST /api/faucet. The Worker asks Turnstile
// whether that token is good, and then looks at the answer itself. A token
// only passes when Turnstile says all of this about it:
//
//   success   it was solved, and has not been spent or expired
//   hostname  on this site, not on someone else's page that borrowed our key
//   action    for the faucet, not for another form that shares the widget
//   cdata     for this very address: the app ties each token to the address
//             it asks coins for, so one solve cannot pay a list of addresses
//
// Everything else keeps the faucet shut. There is no switch that loosens the
// check, no test mode and no key or token that gets special treatment.
// (Turnstile's published test secret answers with the host name "example.com"
// and no action, so it can never pass here: if it ever reached production it
// would refuse everyone, not let everyone in.)
//
// A token that does not pass is refused in one of two ways. When the reader
// can put it right by running the check again (a token that is spent,
// expired or made up, or one solved for another form or another address),
// the answer is a plain "the bot check did not pass". When only the owner
// can (our secret is refused, the token was solved on another host, the
// service cannot be asked or says something else), the faucet stays shut
// and the log line carries a fault code.
//
// The question to Turnstile holds our secret and the token, and nothing else:
// the reader's IP address is not passed along. (Turnstile already has the
// wallet address the token was made for. The app gave it to the widget, and
// it comes back here as cdata.)

import { isRecord, readText } from './body.ts';
import type { BotCheck, BotCheckResult, BotVerdict, Fault, FetchLike } from './deps.ts';

/** Turnstile's verify service. A constant on purpose: nothing can point the check elsewhere. */
export const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Turnstile documents 2048 characters as the longest token it issues. */
export const TOKEN_MAX = 2048;

/** What the app's widget is told to put in its tokens (app/src/lib/turnstile.ts). */
export const ACTION = 'faucet';

const TIMEOUT_MS = 8000;
const ANSWER_MAX = 16_384;

/** Refusals that are about our secret, not about the reader's token. */
const SECRET_CODES = ['invalid-input-secret', 'missing-input-secret'];
/** Refusals the reader can fix by running the check again. */
const TOKEN_CODES = ['invalid-input-response', 'missing-input-response', 'timeout-or-duplicate'];

export interface BotCheckOptions {
  /** The widget's public key. Empty: no widget exists yet, so the faucet is closed. */
  siteKey: string;
  /** The widget's secret key. */
  secret: string;
  /** The host a token must have been made on, for example practice.learnbitcoin.com. */
  hostname: string;
  fetch: FetchLike;
}

export function makeBotCheck(options: BotCheckOptions): BotCheck {
  // A setting that was never set reaches the Worker as undefined, whatever
  // its type says, and one that is only spaces is as good as missing. Each
  // is read as empty here, once, so that "not set" means one thing below:
  // closed. (Compared as they came, a missing host name would equal the
  // host name missing from an answer.)
  const siteKey = setting(options.siteKey);
  const secret = setting(options.secret);
  const hostname = setting(options.hostname);
  const send = options.fetch;

  return async (token, address) => {
    // No widget: closed on purpose, nothing to fix.
    if (siteKey === '') return result('closed', null, null);
    // A widget but no secret or host to check against: closed, and the owner must fix it.
    if (secret === '' || hostname === '') return result('closed', null, 'bot_check_config');
    // No real token looks like this, so the service is not asked.
    if (token === '' || token.length > TOKEN_MAX) return result('fail', null, null);

    let response: Response;
    try {
      response = await send(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ secret, response: token }),
        // A redirect would carry our secret to whatever host it named.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return result('down', null, 'bot_check_down');
    }

    // The body is read whatever the status: the service answers a wrong
    // secret with status 400 and says why in the JSON.
    const status = response.status;
    let data: unknown;
    try {
      // A body cut off at the cap is not JSON any more, and lands in the catch below.
      data = JSON.parse((await readText(response.body, ANSWER_MAX)).text);
    } catch {
      return result('down', status, 'bot_check_down');
    }
    if (!isRecord(data)) return result('down', status, 'bot_check_down');

    if (data.success === true) {
      if (status !== 200) return result('down', status, 'bot_check_down');
      // Solved, but on another host. Turnstile runs a widget only on the
      // host names its settings list, so the widget lets in a host this
      // Worker does not expect: the two disagree about where the app lives.
      // Nobody gets coins until the owner has looked.
      if (data.hostname !== hostname) return result('down', status, 'bot_check_config');
      // Solved here, but for another form or for another address. Both are
      // whatever the page that drew the widget said they were, and a reader's
      // browser can be made to say anything. So nothing is wrong on our
      // side: the reader can run the check again, and no fault is logged. (A
      // fault that any visitor can cause at will would bury the real ones.)
      if (data.action !== ACTION || data.cdata !== address) return result('fail', status, null);
      return result('pass', status, null);
    }

    const codes: unknown[] = Array.isArray(data['error-codes']) ? data['error-codes'] : [];
    if (codes.some((code) => SECRET_CODES.includes(String(code)))) return result('down', status, 'bot_check_config');
    if (data.success === false && codes.some((code) => TOKEN_CODES.includes(String(code)))) {
      return result('fail', status, null);
    }
    // An answer that says neither yes nor a no we know: any doubt keeps the faucet shut.
    return result('down', status, 'bot_check_down');
  };
}

function result(verdict: BotVerdict, upstream: number | null, fault: Fault | null): BotCheckResult {
  return { verdict, upstream, fault };
}

/** A setting as text: without the spaces around it, and empty when it is missing. */
function setting(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
