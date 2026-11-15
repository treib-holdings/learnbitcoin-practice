// Passkeys for the practice wallet: the browser calls, and how each one ended.
//
// A passkey can give back the same 32 secret bytes every time it is asked
// with the same input (the WebAuthn "PRF" extension). The wallet package
// turns those bytes into the 12 words (wallet/src/keys.ts). So a passkey can
// rebuild the wallet on any device it syncs to, and nothing secret has to be
// kept in the browser.
//
// This file only talks to the browser. It never throws: every way a prompt
// can end is a PasskeyOutcome, so a screen can give each ending its own text.
// What an answer means for the wallet is decided elsewhere (keystore.ts).
//
// Rules this file keeps:
//   - One prompt at a time. A second call while one is open answers "Busy".
//   - No prompt stays open for ever. A little after the browser should have
//     ended one, this file ends it itself, so "Busy" always passes.
//   - The page can end the open prompt itself (endPrompt). Its answer, if
//     one still comes, is never read.
//   - The 32 bytes are the wallet. They leave this file only inside an "ok"
//     outcome. Nothing here logs, and a credential is never turned into
//     JSON: its JSON form holds the secret as text.
//   - Outside this file a credential ID is always base64url text.
//   - A failure is told apart by the error's name alone, never by its
//     message: messages differ from browser to browser and may be translated.

import { PRF_INPUT_V1 } from '@learnbitcoin/practice-wallet';

// -- what the caller passes in ------------------------------------------------

/** The two calls of `navigator.credentials` this file makes. */
export interface CredentialsLike {
  create(options?: CredentialCreationOptions): Promise<unknown>;
  get(options?: CredentialRequestOptions): Promise<unknown>;
}

/** The static methods of `window.PublicKeyCredential` this file uses. A browser may lack either. */
export interface PublicKeyCredentialLike {
  getClientCapabilities?(): Promise<Record<string, unknown>>;
  signalUnknownCredential?(options: { rpId: string; credentialId: string }): Promise<unknown>;
}

/**
 * The browser objects this file needs. They are passed in, never read from
 * globals, so the tests can pass fakes.
 */
export interface PasskeyEnv {
  /** `navigator.credentials`. Undefined on a page that is not secure, or in a browser without passkeys. */
  credentials: CredentialsLike | undefined;
  /** `window.PublicKeyCredential`. Undefined in the same cases. */
  PublicKeyCredential: PublicKeyCredentialLike | undefined;
  /** `window.crypto`: the browser's random number generator. */
  crypto: Pick<Crypto, 'getRandomValues'>;
  /** `window.isSecureContext`. */
  isSecureContext: boolean;
  /** `location.hostname`. A passkey belongs to the host it was made on, for life. */
  hostname: string;
}

// -- how a prompt can end -----------------------------------------------------

/**
 * ok          the passkey gave its 32 secret bytes (`prfAt` says in which call)
 * unfinished  the passkey was made, but the follow-up prompt that fetches the
 *             bytes did not go through: offer "Finish setting up" (finishCreate)
 * no-prf      the passkey answered, without the bytes: it cannot make a wallet
 * cancelled   refused, dismissed, timed out, or there was no passkey to use;
 *             the browser does not say which
 * error       anything else; `name` is the error's name, for a details line
 *
 * `prfEnabled` is what create() reported about the new passkey (true, false,
 * or null when it said nothing). It is kept only to learn how providers behave.
 */
export type PasskeyOutcome =
  | {
      kind: 'ok';
      prfOutput: Uint8Array;
      credentialId: string;
      tag: string | null;
      prfAt: 'create' | 'get';
      prfEnabled: boolean | null;
    }
  | { kind: 'unfinished' | 'no-prf'; credentialId: string; tag: string | null; prfEnabled: boolean | null }
  | { kind: 'cancelled'; timedOut: boolean }
  | { kind: 'error'; name: string };

// -- constants ----------------------------------------------------------------

/** How long a prompt may stay open, in ms. Five minutes leaves room to scan a QR code with a phone. */
const TIMEOUT_MS = 300_000;

/**
 * A cancel and a timeout reach the page as the same error, so the only way
 * to tell them apart is the clock: a refusal that comes this long after the
 * prompt opened, or later, is called a timeout. It is a second short of the
 * timeout the browser is given, so a refusal that comes on time always counts.
 *
 * This is a hint for the screen's text and no more, because a browser may
 * change the timeout it is given. Chrome keeps the five minutes. Firefox and
 * Safari allow two at most (read in their source code), so there a prompt
 * that ran out of time is reported as a plain cancel.
 */
const TIMED_OUT_FROM_MS = TIMEOUT_MS - 1000;

/**
 * When this file ends a prompt itself, in ms: two seconds after the browser
 * should have. Not every browser keeps to the timeout, and a password
 * manager that stands in for the browser may never answer at all. One such
 * prompt would otherwise leave every later call answering "Busy" until the
 * page is reloaded.
 */
const GIVE_UP_MS = TIMEOUT_MS + 2000;

/** The longest ID WebAuthn allows a passkey, in bytes. The wallet's record keeps to the same limit (keystore.ts). */
const ID_MAX_BYTES = 1023;

/** The site's name, which some password managers show beside the passkey. */
const RP_NAME = 'LearnBitcoin practice wallet';

/**
 * The characters a tag is written in. None is easily taken for another when
 * read or said aloud (no 0 or O, no 1, I or L, no B, G, S or Z beside 8, 6,
 * 5 and 2), and there are no vowels, so a tag never spells a word.
 */
const TAG_ALPHABET = '23456789CDFHJKMNPQRTVWXY';

// -- the tag ------------------------------------------------------------------

/**
 * A four-character tag, such as "7KQ4", that tells one practice passkey from
 * another. It goes into the passkey's name, where the password manager shows
 * it, and the app shows it too.
 *
 * It is taken from `user.id`, the random bytes the passkey is made with. The
 * browser hands those bytes back when the passkey is used, so a new device
 * can show the same tag with nothing stored.
 *
 * Each of the first four bytes picks one character. The same bytes always
 * give the same tag. Do not change this: the names of passkeys already saved
 * in password managers carry these tags. It is a label, not a secret.
 */
export function tagFromUserId(userId: Uint8Array): string {
  let tag = '';
  for (let i = 0; i < 4; i++) {
    tag += TAG_ALPHABET.charAt((userId[i] ?? 0) % TAG_ALPHABET.length);
  }
  return tag;
}

// -- bytes and text -----------------------------------------------------------

/** The bytes of an ArrayBuffer or of any view on one; null for everything else. */
function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

/** Bytes as base64url text without padding: how WebAuthn itself writes a credential ID. */
function toBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** The bytes of base64url text. Throws a TypeError for anything else. */
function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) {
    throw new TypeError('A credential ID must be base64url text');
  }
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** True when the two hold the same bytes. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// -- reading an answer --------------------------------------------------------

/**
 * The parts of a credential this file reads. Every one may be missing: a
 * password manager's browser extension can stand in for the browser and
 * hand back something less complete than the real thing.
 */
interface CredentialParts {
  rawId?: unknown;
  response?: { userHandle?: unknown } | null;
  getClientExtensionResults?: () => {
    prf?: { enabled?: unknown; results?: { first?: unknown } | null } | null;
  } | null;
}

/** What was read from the credential a call returned. */
interface Answered {
  /** The credential's ID, as bytes. */
  id: Uint8Array;
  /** The passkey's secret bytes; null unless there are exactly 32 of them. */
  prf: Uint8Array | null;
  /** The `enabled` flag create() reports for a new passkey; null when absent. */
  prfEnabled: boolean | null;
  /** The `user.id` the passkey was made with, when the browser hands it back. */
  userHandle: Uint8Array | null;
}

/**
 * The PRF part of an answer. The result counts only if it is exactly 32
 * bytes: anything else would be a different wallet, or none. Browsers
 * return an ArrayBuffer; a view on one is accepted too. A credential whose
 * extension results cannot be read counts as one without the bytes.
 */
function readPrf(credential: CredentialParts): Pick<Answered, 'prf' | 'prfEnabled'> {
  try {
    const prf = credential.getClientExtensionResults?.()?.prf;
    const first = toBytes(prf?.results?.first);
    return {
      prf: first !== null && first.length === 32 ? first : null,
      prfEnabled: typeof prf?.enabled === 'boolean' ? prf.enabled : null,
    };
  } catch {
    return { prf: null, prfEnabled: null };
  }
}

/** Reads what create() or get() resolved with. Null: there is no credential in it that can be named. */
function readCredential(answer: unknown): Answered | null {
  try {
    if (typeof answer !== 'object' || answer === null) return null;
    const credential = answer as CredentialParts;
    // rawId, not id: rawId is the bytes themselves, the same in every browser.
    const id = toBytes(credential.rawId);
    if (id === null || id.length === 0 || id.length > ID_MAX_BYTES) return null;
    const userHandle = toBytes(credential.response?.userHandle);
    return {
      id,
      ...readPrf(credential),
      userHandle: userHandle !== null && userHandle.length > 0 ? userHandle : null,
    };
  } catch {
    return null;
  }
}

// -- failures -----------------------------------------------------------------

type Failure = Extract<PasskeyOutcome, { kind: 'cancelled' | 'error' }>;

/** An error's name, and never its message. "Unknown" for a rejection that is not an error object. */
function errorName(error: unknown): string {
  try {
    const name = (error as { name?: unknown } | null | undefined)?.name;
    return typeof name === 'string' && name !== '' ? name : 'Unknown';
  } catch {
    return 'Unknown';
  }
}

/**
 * NotAllowedError is the browser's one answer for "the reader said no", "the
 * prompt ran out of time", "that passkey is not on this device" and "this
 * device cannot do what was asked". The page cannot tell these apart, so
 * they are all "cancelled", and the screen offers the next step for each.
 * Every other name is a fault, kept by name for a details line.
 */
function failureOf(error: unknown, timedOut: boolean): Failure {
  const name = errorName(error);
  if (name === 'NotAllowedError') return { kind: 'cancelled', timedOut };
  return { kind: 'error', name };
}

// -- one prompt at a time -----------------------------------------------------

/**
 * True while a prompt is open. A browser takes one passkey request at a
 * time (Chrome fails a second one with OperationError). Refusing here
 * gives the same clear answer in every browser, and leaves the open
 * prompt alone.
 */
let promptOpen = false;

/** Runs one ceremony (one or two prompts) unless another is open, and turns any stray fault into an outcome. */
async function ceremony(run: () => Promise<PasskeyOutcome>): Promise<PasskeyOutcome> {
  if (promptOpen) return { kind: 'error', name: 'Busy' };
  promptOpen = true;
  try {
    return await run();
  } catch (error) {
    // Not a refusal by the browser: something failed around the call.
    return { kind: 'error', name: errorName(error) };
  } finally {
    promptOpen = false;
  }
}

/** What ask() hears from its own timer when it gives up on a prompt: a value no browser call resolves with. */
const GAVE_UP = Symbol('gave up');

/** Ends the browser call that is waiting for the reader, if one is. Set by ask() for as long as it waits. */
let endOpenCall: (() => void) | null = null;

/**
 * Ends the passkey prompt this page has open, if it has one: the browser is
 * told to close it, and whoever asked is answered "cancelled" at once.
 * What the browser hands back for that prompt afterwards, if anything, is
 * never read.
 *
 * The wallet calls this before somebody else's code (the faucet's bot
 * check) is let into the page. A prompt answered after that would hand the
 * passkey's secret to a page that such code can read.
 */
export function endPrompt(): void {
  endOpenCall?.();
}

/**
 * Makes one browser call and says how it ended: with an answer, or with a
 * failure.
 *
 * The call is handed a signal to pass on to the browser. If the prompt is
 * still open at GIVE_UP_MS, the signal tells the browser to close it, and
 * this function stops waiting whether the browser listens or not. That
 * ending is reported as a prompt that ran out of time. endPrompt() ends it
 * the same way, at once, and that ending is a plain "cancelled".
 */
async function ask(
  call: (signal: AbortSignal) => Promise<unknown>,
): Promise<{ answer: unknown } | { failure: Failure }> {
  const started = Date.now();
  const controller = new AbortController();
  /** True once the page itself has ended this prompt (endPrompt). */
  let ended = false;
  let giveUp = (): void => {};
  const gaveUp = new Promise<typeof GAVE_UP>((resolve) => {
    giveUp = () => resolve(GAVE_UP);
  });
  const timer = setTimeout(() => {
    // abort() with no argument. Given a reason, the browser would reject
    // with that reason, which need not be an error at all.
    controller.abort();
    giveUp();
  }, GIVE_UP_MS);
  const end = (): void => {
    ended = true;
    controller.abort();
    giveUp();
  };
  endOpenCall = end;
  try {
    const answer = await Promise.race([call(controller.signal), gaveUp]);
    // Ended by the page: whatever came back in the same moment is left unread.
    if (ended) return { failure: { kind: 'cancelled', timedOut: false } };
    if (answer === GAVE_UP) return { failure: { kind: 'cancelled', timedOut: true } };
    return { answer };
  } catch (error) {
    // A rejection after our own abort is the prompt this file ended, whatever
    // name the browser gives it (AbortError, by the standard).
    if (controller.signal.aborted) return { failure: { kind: 'cancelled', timedOut: !ended } };
    // The clock is read here, not kept by a timer: a hidden tab may run its timers late.
    return { failure: failureOf(error, Date.now() - started >= TIMED_OUT_FROM_MS) };
  } finally {
    clearTimeout(timer);
    if (endOpenCall === end) endOpenCall = null;
  }
}

// -- the options --------------------------------------------------------------

/**
 * The PRF request, the same in every call: "evaluate the wallet's fixed
 * input". A fresh copy each time, so nothing can alter the frozen constant.
 */
function prfRequest(): AuthenticationExtensionsClientInputs {
  return { prf: { eval: { first: new Uint8Array(PRF_INPUT_V1) } } };
}

/**
 * Options for get(). `onlyThis` names the one passkey to ask; null lets the
 * reader pick. `signal` is how ask() ends a prompt that stays open too long.
 */
function requestOptions(
  env: PasskeyEnv,
  onlyThis: Uint8Array<ArrayBuffer> | null,
  signal: AbortSignal,
): CredentialRequestOptions {
  const publicKey: PublicKeyCredentialRequestOptions = {
    // The API insists on a challenge. It is there for servers that check the
    // passkey's signature. This app has no server, so nothing ever checks it.
    challenge: env.crypto.getRandomValues(new Uint8Array(32)),
    rpId: env.hostname,
    // Always "required", at create and at every get. An authenticator can hold
    // two secrets for each passkey, one used with user verification and one
    // without, so asking differently could give a different wallet.
    userVerification: 'required',
    timeout: TIMEOUT_MS,
    extensions: prfRequest(),
  };
  if (onlyThis !== null) {
    // No "transports" hint. A passkey syncs, so by now it may live somewhere
    // else, and a wrong hint makes the browser wait for a device that never
    // answers. With no allowCredentials at all the browser shows its picker.
    publicKey.allowCredentials = [{ type: 'public-key', id: onlyThis }];
  }
  return { publicKey, signal };
}

// -- the calls ----------------------------------------------------------------

/**
 * Whether to offer passkeys at all. All of these must hold:
 *   - the page is a secure context;
 *   - the browser has WebAuthn;
 *   - the browser says it supports the PRF extension;
 *   - the page is on the one configured host, or on localhost.
 * A missing API or a failed check means "no": never a throw.
 *
 * A "yes" is permission to try, not a promise. The browser answers for
 * itself, not for the reader's password manager, so the prompt can still
 * end in "no-prf".
 */
export async function passkeyOffered(env: PasskeyEnv, passkeyHost: string): Promise<boolean> {
  try {
    if (env.isSecureContext !== true) return false;
    // The host is part of the wallet's format: a passkey made on any other
    // host (a preview address, say) could never open the wallet on this one.
    const host = env.hostname;
    if (typeof host !== 'string' || host === '') return false;
    if (host !== passkeyHost && host !== 'localhost') return false;
    const credentials = env.credentials;
    if (!credentials || typeof credentials.create !== 'function' || typeof credentials.get !== 'function') {
      return false;
    }
    const pkc = env.PublicKeyCredential;
    if (!pkc || typeof pkc.getClientCapabilities !== 'function') return false;
    const capabilities = await pkc.getClientCapabilities();
    return capabilities?.['extension:prf'] === true;
  } catch {
    return false;
  }
}

/** A passkey that was made and has not given its secret bytes yet: what an "unfinished" outcome carries. */
interface Pending {
  credentialId: string;
  tag: string | null;
  prfEnabled: boolean | null;
}

/**
 * The second prompt of a create: asks the passkey that was just made for
 * its secret bytes, for providers that do not hand them over at creation.
 *
 * Any failure of this call is "unfinished", whatever its name: the passkey
 * exists, so the way on is to ask it again ("Finish setting up"), not to
 * make another one. "no-prf" is kept for a passkey that did answer and had
 * no bytes to give.
 *
 * An answer from any other passkey is no answer. A browser's own passkeys
 * keep to the one ID they are asked for; a password manager that stands in
 * for the browser might not. Another passkey's bytes are another wallet:
 * taking them would store that wallet under the new passkey's name. So
 * nothing of such an answer is used, neither its ID, its tag nor its bytes.
 */
async function followUp(env: PasskeyEnv, credentials: CredentialsLike, pending: Pending): Promise<PasskeyOutcome> {
  const onlyThis = fromBase64url(pending.credentialId);
  const asked = await ask((signal) => credentials.get(requestOptions(env, onlyThis, signal)));
  const answered = 'failure' in asked ? null : readCredential(asked.answer);
  if (answered === null || !sameBytes(answered.id, onlyThis)) {
    const { credentialId, tag, prfEnabled } = pending;
    return { kind: 'unfinished', credentialId, tag, prfEnabled };
  }
  const named = {
    credentialId: toBase64url(answered.id),
    tag: pending.tag ?? (answered.userHandle === null ? null : tagFromUserId(answered.userHandle)),
    prfEnabled: pending.prfEnabled,
  };
  if (answered.prf === null) return { kind: 'no-prf', ...named };
  return { kind: 'ok', prfOutput: answered.prf, ...named, prfAt: 'get' };
}

/**
 * Makes a new passkey and asks it for its secret bytes, in one prompt where
 * the provider allows it and in two where it does not. `label` turns the
 * passkey's tag into its name, in the page's language. Call it from a tap.
 */
export async function createPasskey(env: PasskeyEnv, label: (tag: string) => string): Promise<PasskeyOutcome> {
  return ceremony(async () => {
    const credentials = env.credentials;
    if (!credentials) return { kind: 'error', name: 'NotSupportedError' };

    // Fresh random bytes for every passkey, never a fixed value. A password
    // manager keeps one passkey per user.id and site: making a second one
    // with the same user.id would replace the first, and that wallet's
    // passkey would be gone.
    const userId = env.crypto.getRandomValues(new Uint8Array(16));
    const tag = tagFromUserId(userId);
    const name = label(tag);

    const asked = await ask((signal) =>
      credentials.create({
        publicKey: {
          // A passkey works only on the host it was made for.
          rp: { id: env.hostname, name: RP_NAME },
          user: { id: userId, name, displayName: name },
          challenge: env.crypto.getRandomValues(new Uint8Array(32)), // see requestOptions
          // ES256 first: what Apple's and Google's passkeys use. Then RS256,
          // which some Windows hardware needs. The order is the preference.
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: {
            // "Discoverable": the passkey can be found with nothing stored in
            // the browser. That is what lets a new device open the wallet.
            residentKey: 'required',
            requireResidentKey: true, // the same thing, as older browsers spell it
            userVerification: 'required', // see requestOptions
          },
          attestation: 'none',
          timeout: TIMEOUT_MS,
          // Ask for the bytes in the prompt that makes the passkey. Most
          // providers answer here, so making a wallet takes one prompt.
          extensions: prfRequest(),
        },
        signal, // see ask()
      }),
    );
    if ('failure' in asked) return asked.failure;

    const made = readCredential(asked.answer);
    if (made === null) return { kind: 'error', name: 'NoCredential' };
    const credentialId = toBase64url(made.id);
    if (made.prf !== null) {
      // The bytes at create are the bytes every later get() returns, so
      // there is nothing to check with a second prompt.
      return { kind: 'ok', prfOutput: made.prf, credentialId, tag, prfAt: 'create', prfEnabled: made.prfEnabled };
    }
    // No bytes yet. Ask once more even if create() said "enabled: false":
    // some providers give nothing at creation and the bytes at the next
    // call, and a wrong "cannot" would cost the reader more than one prompt.
    return followUp(env, credentials, { credentialId, tag, prfEnabled: made.prfEnabled });
  });
}

/** Asks again for the secret bytes of a passkey whose setup was left unfinished. Call it from a tap. */
export async function finishCreate(
  env: PasskeyEnv,
  pending: { credentialId: string; tag: string | null; prfEnabled: boolean | null },
): Promise<PasskeyOutcome> {
  return ceremony(async () => {
    const credentials = env.credentials;
    if (!credentials) return { kind: 'error', name: 'NotSupportedError' };
    return followUp(env, credentials, pending);
  });
}

/**
 * Asks a passkey for its secret bytes. With `credentialId`, the one passkey
 * this browser remembers: no picker, and no way to choose the wrong one.
 * Without it, the browser's picker: the way in for a device with nothing
 * stored. Call it from a tap.
 *
 * The outcome names the passkey that answered. Its tag comes from the
 * `user.id` the browser hands back, and is null when the browser keeps
 * that to itself (it may, when a passkey is asked for by ID).
 */
export async function getPasskey(env: PasskeyEnv, credentialId?: string): Promise<PasskeyOutcome> {
  return ceremony(async () => {
    const credentials = env.credentials;
    if (!credentials) return { kind: 'error', name: 'NotSupportedError' };
    const onlyThis = credentialId === undefined ? null : fromBase64url(credentialId);

    const asked = await ask((signal) => credentials.get(requestOptions(env, onlyThis, signal)));
    if ('failure' in asked) return asked.failure;

    const answered = readCredential(asked.answer);
    if (answered === null) return { kind: 'error', name: 'NoCredential' };
    const named = {
      credentialId: toBase64url(answered.id),
      tag: answered.userHandle === null ? null : tagFromUserId(answered.userHandle),
      prfEnabled: null, // only create() reports it
    };
    if (answered.prf === null) return { kind: 'no-prf', ...named };
    return { kind: 'ok', prfOutput: answered.prf, ...named, prfAt: 'get' };
  });
}

/**
 * Tells the password manager that a passkey is of no use (it cannot make a
 * wallet), so that it may drop it. Best effort: only some browsers have
 * the call, each provider decides what to do with it, nothing waits for it
 * and it never throws. The screen still shows how to delete the passkey by hand.
 */
export function signalUnknown(env: PasskeyEnv, credentialId: string): void {
  try {
    const pkc = env.PublicKeyCredential;
    if (!pkc || typeof pkc.signalUnknownCredential !== 'function') return;
    // Here the ID travels as base64url text, not as bytes.
    const sent = pkc.signalUnknownCredential({ rpId: env.hostname, credentialId });
    Promise.resolve(sent).catch(() => {});
  } catch {
    // Nothing to do: the passkey stays where it is.
  }
}
