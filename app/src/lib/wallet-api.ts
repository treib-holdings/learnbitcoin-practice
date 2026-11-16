// What a screen may ask of the wallet, and what it is told back.
//
// Types only. wallet.svelte.ts builds the one object that satisfies WalletApi
// and exports it as `wallet`. Screens and components use that object and
// nothing beneath it: no keystore, no passkey module, no API client. So the
// rules about keys, storage and other tabs live in one place.
//
// Three rules hold for every member:
//   1. Properties are reactive: read them in markup or in $derived and the
//      screen follows the wallet.
//   2. Actions never throw. Every way an action can end is a `kind` (or an
//      `ok: false` with a `reason`), so a screen can give each one its own
//      text: the cause, then the way out.
//   3. The 12 words and private keys are never held in a property. They come
//      out through revealWords() only, and only while the wallet is unlocked.

import type { AppConfig, FaucetPayment, PotStats } from '@learnbitcoin/practice-contract';
import type {
  PaymentPlan,
  PaymentRequest,
  PlanFailure,
  SignedPayment,
  TxView,
  WalletState,
} from '@learnbitcoin/practice-wallet';
import type { ApiFailure, BroadcastFailure } from './api.ts';
import type { WalletRecord } from './keystore.ts';
import type { Route } from './router.ts';

// -- what is here ---------------------------------------------------------------

/**
 * none        this browser has no practice wallet: its storage was read,
 *             and holds none
 * ready       a wallet is here (it may be locked: see `unlocked`)
 * unreadable  something is stored under the wallet's key but cannot be read;
 *             nothing is overwritten until the reader chooses Remove
 * newer       what is stored was written by a newer version of this page (a
 *             tab left open across an update). It may be a good wallet, so
 *             this page never removes it: the one way out is Reload
 * broken      the self-test failed: this browser derives wrong keys, so no
 *             wallet may be made, opened or restored
 * blocked     the browser did not let this page read its storage (site data
 *             is blocked, say). Whether a wallet is kept here is NOT KNOWN:
 *             a browser that blocks a site's data deletes none of it, so a
 *             wallet made before may still be stored, with its 12 words. No
 *             screen may say "no wallet" of this state. Nothing can be
 *             made, opened, restored or removed until the page can read
 *             again: the way out is to allow site data, and Reload
 */
export type WalletStatus = 'none' | 'ready' | 'unreadable' | 'newer' | 'broken' | 'blocked';

/**
 * The stored record without the 12 words. A record that still holds its words
 * does not fit this type: pass it through publicRecord() (keystore.ts) first.
 */
export type PublicRecord = Omit<WalletRecord, 'mnemonic'> & { mnemonic?: never };

/**
 * Where the request for the Worker's settings stands.
 *
 * loading  it is still out (or being tried a second time): `config` holds the
 *          built-in values, and what they say may yet change
 * loaded   the Worker answered: `config` holds this deployment's settings
 * failed   no usable answer came, twice: `config` holds the built-in values
 *          and will go on holding them until the page is loaded again
 *
 * The built-in values name no bot check and switch counting off. So a screen
 * that says "the faucet is closed" or "nothing is counted" from `config`
 * alone would say it during every visit's first moment, and would say it of
 * a server it never heard from. Such a line waits for "loaded"; for "failed"
 * the true cause is that the settings could not be read.
 */
export type SettingsState = 'loading' | 'loaded' | 'failed';

/** The wallet's coins as last read from the practice network. */
export interface ChainView {
  /** Null until the first scan of this wallet has finished. Never show a total of 0 in its place. */
  state: WalletState | null;
  /** A full scan is running. */
  scanning: boolean;
  /** Why the latest scan or refresh failed. Null after one that worked. */
  error: ApiFailure | null;
  /** When `state` was last confirmed against the network, in ms since 1970. */
  checkedAt: number | null;
  /** When the app will next try again by itself after a failure, in ms since 1970. */
  retryAt: number | null;
  /** Height of the practice chain, when known. */
  tip: number | null;
  /** True once the tip has not moved for four block intervals. */
  slow: boolean;
}

/** The address the Receive screen shows. It stays until the reader asks for another. */
export interface ReceiveView {
  address: string;
  /** Its place on the receive chain: m/84'/1'/0'/0/<index>. */
  index: number;
  /** Sats seen arriving at this address since it was first shown, confirmed or not. */
  arrived: bigint;
}

/** Something that just happened, for the screen's one role="status" region. Outcomes only. */
export type Notice =
  | { id: number; kind: 'coins-arrived'; sats: bigint }
  | { id: number; kind: 'confirmed' }
  | { id: number; kind: 'payment-sent' }
  | { id: number; kind: 'unlocked' }
  | { id: number; kind: 'locked' }
  /** Another tab put a different wallet in this browser: every wallet screen shows that one from now on. */
  | { id: number; kind: 'replaced' };

// -- how a passkey ceremony can fail ------------------------------------------------

export type CeremonyFailure =
  /** Refused, dismissed or timed out. Offer: try again, choose another passkey, use the 12 words. */
  | { kind: 'cancelled'; timedOut: boolean }
  /** The passkey answered without the secret a wallet is made from. `tag` names it when known. */
  | { kind: 'no-prf'; tag: string | null }
  /** Anything else. `name` is the browser's error name, for a details line only. */
  | { kind: 'error'; name: string }
  /** Another passkey prompt is still open. */
  | { kind: 'busy' }
  /** The bot check has loaded in this page (see beforeBotCheck): the page must be reloaded first. */
  | { kind: 'reload' }
  /** The self-test failed (status is "broken"). */
  | { kind: 'broken' };

// -- create -----------------------------------------------------------------------

export type CreateResult =
  /** The wallet exists, its record is stored and its keys are loaded. `created` is now set: go to Backup. */
  | { kind: 'created' }
  /** The passkey was made but the follow-up prompt was refused. `setup` is now set: show "Finish setting up". */
  | { kind: 'unfinished' }
  /** A wallet appeared in this browser meanwhile (another tab). */
  | { kind: 'exists' }
  /** This browser refuses to store anything, so nothing was made. */
  | { kind: 'no-storage' }
  | CeremonyFailure;

// -- unlock, open, switch ---------------------------------------------------------

export type UnlockResult =
  /** The same wallet: its keys are loaded. */
  | { kind: 'unlocked' }
  /**
   * The keys fit only one of the two things this browser stored about the wallet
   * (its public key, its wallet fingerprint), so the stored record had been altered.
   * It was rebuilt from the keys and the wallet rescanned; the keys are loaded. Say
   * that the saved details were wrong and have been replaced, and that an address
   * shown here before this unlock may have belonged to another wallet.
   */
  | { kind: 'tampered' }
  /** A different passkey answered. Nothing changed. `pendingSwitch` is now set: ask before switching. */
  | { kind: 'other-passkey'; tag: string | null; fingerprint: string }
  /**
   * The stored passkey gave a wallet that fits nothing this browser stored: the
   * passkey now gives a different wallet, or the whole record was replaced. It is
   * never opened and nothing is overwritten. The text must allow for both causes
   * and must not say the addresses shown so far were this wallet's. Ways out: the
   * 12 words, or Remove and then Open with the passkey.
   */
  | { kind: 'changed' }
  /** The wallet was removed or replaced in another tab. */
  | { kind: 'gone' }
  | CeremonyFailure;

export type UnlockWordsResult =
  /** The words are this wallet's: keys loaded for this page. Nothing was stored. */
  | 'unlocked'
  /**
   * The words fit only one of the two things this browser stored about the wallet
   * (its public key, its wallet fingerprint), so the stored record had been altered.
   * It was rebuilt from the words (it stays a passkey wallet's record: the words are
   * not stored) and the wallet rescanned; the keys are loaded. Say what "tampered"
   * says after a passkey unlock.
   */
  | 'tampered'
  /** Not 12 valid words. */
  | 'invalid'
  /** Valid words that fit nothing stored here: another wallet's. Point to Remove, then Restore. */
  | 'other-wallet'
  /** The record had been altered (see "tampered") and the browser refused to store the right one. Nothing was opened. */
  | 'no-storage'
  | 'gone'
  | 'reload'
  | 'broken';

export type OpenResult =
  /** The wallet is now in this browser and unlocked; its first scan has started. */
  | { kind: 'opened' }
  | { kind: 'exists' }
  | { kind: 'no-storage' }
  | CeremonyFailure;

export type SwitchResult = 'switched' | 'gone' | 'no-storage' | 'nothing-pending';

// -- restore ----------------------------------------------------------------------

export interface WordsCheck {
  /** The input, normalised: lower case, split on white space. */
  words: string[];
  /** Positions (from 0) of words that are not in the BIP39 English list. */
  unknown: number[];
  /** True for exactly 12 known words with a good checksum. */
  valid: boolean;
}

export type RestoreResult =
  /** Practice history was found: the record is stored and the wallet is open. */
  | { kind: 'restored' }
  /**
   * No practice history for these words. Nothing is stored; the words wait in
   * memory (`pendingRestore` is true) for keepRestored() or eraseRestored().
   */
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'exists' }
  | { kind: 'no-storage' }
  /** The scan failed, so nothing is known yet. The words were dropped: ask again. */
  | { kind: 'failed'; reason: ApiFailure }
  | { kind: 'reload' }
  | { kind: 'broken' };

export type KeepResult = 'restored' | 'exists' | 'no-storage' | 'nothing-pending';

// -- the faucet -------------------------------------------------------------------

export type FaucetPhase =
  | 'idle'
  /** The bot check is running. */
  | 'checking'
  /** The request is with the faucet. */
  | 'asking'
  /** Refused for now (limit, busy, refilling). The app asks again by itself at `retryAt`. */
  | 'waiting'
  /**
   * Promised: `payment` holds the transaction ID and amount. It is null when the faucet
   * answered that it has paid this address before (the coin is on its way or already
   * here), and when a coin arrived after a request that had failed.
   */
  | 'on-its-way'
  /** The coin is in the wallet, unconfirmed. */
  | 'arrived'
  /** The coin has a confirmation. */
  | 'confirmed'
  /** Stopped. `failure` says why. */
  | 'failed';

/**
 * no-token  the bot check gave no token (blocked, failed to load, or dismissed)
 * gave-up   three minutes of waiting and asking again did not get through
 */
export type FaucetFailure = ApiFailure | 'no-token' | 'gave-up';

export interface FaucetView {
  phase: FaucetPhase;
  payment: FaucetPayment | null;
  /** Set while "waiting" (why the last try was refused) and when "failed". */
  failure: FaucetFailure | null;
  /** While "waiting": when the next try starts, in ms since 1970. */
  retryAt: number | null;
}

/**
 * Runs the bot check and resolves to its token, or null if there is none to
 * be had. `fresh` is true when the last token has been used up and the check
 * must run again.
 */
export type TokenSource = (fresh: boolean) => Promise<string | null>;

// -- sending ----------------------------------------------------------------------

export type SignResult =
  /** Signed, not sent. `view` is the payment as the review shows it. */
  | { ok: true; payment: SignedPayment; view: TxView }
  /** locked: call unlock() first. Otherwise the reason planPayment would give. */
  | { ok: false; reason: 'locked' | PlanFailure };

export type BroadcastResult =
  | { ok: true; txid: string }
  /** `detail` is the node's own words, for a details line only. */
  | { ok: false; reason: BroadcastFailure; detail: string | null };

export type PotAddressResult = { ok: true; address: string } | { ok: false; reason: ApiFailure };

/** The pot's three counts, or why they could not be had. A screen that shows a count leaves its line out on a failure. */
export type PotStatsResult = { ok: true; stats: PotStats } | { ok: false; reason: ApiFailure };

/**
 * The payment this page last sent: its ID, whether it went to an address the
 * pot handed out in this page ("Pass it on"), and when, in ms since 1970.
 */
export interface LastSent {
  txid: string;
  toPot: boolean;
  at: number;
}

// -- checking a few of the 12 words -----------------------------------------------

/**
 * What checkWordsAt() answers.
 *
 * ok      the words were compared. `wrong` holds the positions (from 0, as
 *         they were asked) whose typed word is not the wallet's word there:
 *         empty when every one was right. It never holds a word.
 * locked  a passkey wallet whose keys are not loaded: unlock it first
 * reload  the bot check has been let into this page: nothing here takes
 *         typed words until the page has been loaded again
 * gone    no wallet is here (it was removed or replaced in another tab)
 */
export type WordsAtResult = { ok: true; wrong: number[] } | { ok: false; reason: 'locked' | 'reload' | 'gone' };

// -- one transaction --------------------------------------------------------------

export type TxLookup =
  | { kind: 'found'; view: TxView }
  /** The faucet or a broadcast just returned this ID and the network does not list it yet. Ask again shortly. */
  | { kind: 'waiting' }
  | { kind: 'not-found' }
  | { kind: 'failed'; reason: ApiFailure };

// -- the wallet -------------------------------------------------------------------

export interface WalletApi {
  // ---- state (reactive, read-only) ----

  readonly status: WalletStatus;
  /** The wallet in this browser, without its words. Null unless status is "ready". */
  readonly record: PublicRecord | null;
  /**
   * True when sign() and revealWords() will work without a prompt. A wallet made
   * without a passkey is always unlocked; a passkey wallet is unlocked from one
   * ceremony until lock(), a reload or the tab's end.
   */
  readonly unlocked: boolean;
  /** Public settings, usable at once: built-in values first, the Worker's once they load. */
  readonly config: AppConfig;
  /** Whether the Worker's settings have arrived: `config` alone cannot say which values it holds. */
  readonly settings: SettingsState;
  /** Whether this browser can make and use the wallet's passkeys. Null while that is being found out. */
  readonly passkeyOffered: boolean | null;
  /** False when this browser refuses to store anything: Create and Restore must say so and stop. */
  readonly canStore: boolean;
  /** For a wallet made without a passkey: whether the browser agreed to keep its data. Null: not asked or not known. */
  readonly persisted: boolean | null;

  /** Set when a passkey was made but its setup is unfinished: show "Finish setting up", which calls finishSetup(). */
  readonly setup: { tag: string | null } | null;
  /** Set straight after a create, until ackCreated(): Backup opens as the "Wallet made" step with the words shown. */
  readonly created: 'passkey' | 'words' | null;
  /**
   * The name this page gave the passkey it has just made, exactly as it was
   * written at create(): in the language the page had at that moment. Set
   * while `created` is "passkey", null otherwise (and null if the name was
   * never told to the wallet). The "Wallet made" step is the one place that
   * can show a passkey's whole name: this browser keeps only the tag, and a
   * name built from the tag later could be the one in the other language,
   * which the reader's password manager does not list.
   */
  readonly createdName: string | null;
  /** Set after unlock() met a different passkey, until confirmSwitch() or cancelSwitch(). */
  readonly pendingSwitch: { tag: string | null; fingerprint: string } | null;
  /** True while restored words with no practice history wait for keepRestored() or eraseRestored(). */
  readonly pendingRestore: boolean;
  /**
   * True from openWithPasskey() until coins are seen, when the first scan found no
   * history. The overview then explains the likely causes instead of a bare empty state.
   */
  readonly openedEmpty: boolean;

  readonly chain: ChainView;
  /** Newest first. Null until loaded; loading starts when a screen that shows activity is watched. */
  readonly history: TxView[] | null;
  readonly historyError: ApiFailure | null;

  /** Null until the first scan has finished. */
  readonly receive: ReceiveView | null;
  readonly faucet: FaucetView;

  /** The latest outcome worth announcing. A new one has a new id. */
  readonly notice: Notice | null;

  /**
   * The payment this page last sent from the wallet that is here, or null.
   * It is set at the moment the wallet counts the payment as sent, is null
   * again as soon as another wallet (or none) is in the page, and lives in
   * memory only: a reload forgets it. The "Do it" steps that wait for a
   * payment read it, to tell a payment made now from one made before.
   */
  readonly lastSent: LastSent | null;
  /**
   * How many times this page has put a wallet's 12 words on screen: it goes
   * up by one each time revealWords() gives them. In memory only, and never
   * a word: a reload starts it at 0 again.
   */
  readonly wordsShown: number;

  // ---- making and opening a wallet ----

  /** Starts the passkey prompt, so call it from a tap. */
  createWithPasskey(): Promise<CreateResult>;
  /** Retries the follow-up prompt for the passkey in `setup`. Call it from a tap. */
  finishSetup(): Promise<CreateResult>;
  /** Makes 12 random words and stores them in this browser. */
  createWithWords(): Promise<CreateResult>;
  /** Clears `created` once the reader has moved on from the "Wallet made" step. */
  ackCreated(): void;

  /** No wallet here: lets the reader pick a practice passkey and adopts its wallet. Call it from a tap. */
  openWithPasskey(): Promise<OpenResult>;

  /**
   * Loads a passkey wallet's keys. "stored" asks for the passkey this browser
   * remembers; "picker" lets the reader choose any practice passkey. Call it
   * from a tap. A wallet made without a passkey answers "unlocked" at once.
   */
  unlock(how?: 'stored' | 'picker'): Promise<UnlockResult>;
  /** Loads a passkey wallet's keys from its 12 words, for this page only. */
  unlockWithWords(words: string): UnlockWordsResult;
  /** After "other-passkey": make that wallet this browser's wallet. */
  confirmSwitch(): SwitchResult;
  cancelSwitch(): void;

  /** Checks typed words without keeping them. Cheap: safe on every keystroke. */
  checkWords(input: string): WordsCheck;
  /** Scans for the words' practice history first; stores them only if some is found. */
  restore(words: string): Promise<RestoreResult>;
  /** After "empty": store the words in this browser anyway. */
  keepRestored(): KeepResult;
  /** After "empty": forget the words. Nothing was stored. */
  eraseRestored(): void;

  // ---- keys ----

  /** Drops a passkey wallet's keys. Looking and receiving go on working. */
  lock(): void;
  /** The 12 words, or null while locked. Keep them out of anything that outlives the screen. */
  revealWords(): string[] | null;
  /**
   * Checks a few of the wallet's 12 words without ever handing the words to
   * the screen. `positions` are places in the phrase, counted from 0 (the
   * first word is 0, the twelfth 11), and `typed` holds what the reader
   * typed for each, in the same order. The answer names the positions that
   * were wrong and never a word; nothing is counted and nothing is stored.
   *
   * What was typed is compared inside the wallet, under its rule for the 12
   * words: no regular expression is run over it, so it does not stay where
   * any script in the page could read it back. Hand it over as the fields
   * hold it, and keep it nowhere else. Capitals and spaces around a word do
   * not count against it.
   *
   * A position the phrase does not have, or one with nothing typed for it,
   * is wrong. An empty list of positions has nothing wrong in it and proves
   * nothing: the caller says which positions it asked the reader for.
   * Call it from a tap, not while the screen is being drawn: it reads this
   * browser's storage again first, and what it finds can change what the
   * wallet shows.
   */
  checkWordsAt(positions: number[], typed: string[]): WordsAtResult;
  /**
   * Deletes this wallet's record from this browser and drops its keys. Other stored
   * data is left alone. With status "unreadable" it deletes what cannot be read.
   * "gone": the stored wallet is no longer the one this page loaded (another tab),
   * or status is "newer", "none" or "blocked"; nothing was deleted.
   */
  removeWallet(): 'removed' | 'gone';
  /** The wallet's public descriptors (receive and change), for Settings and the Sparrow page. Null with no wallet. */
  descriptors(): { receive: string; change: string } | null;

  // ---- the chain ----

  /**
   * Tells the wallet which screen is open (null: none), so it reads the network
   * only as often as that screen needs. Called by App.svelte alone, on every
   * route change.
   */
  watch(screen: Route['name'] | null): void;
  /** A full scan now. Resolves when it has finished or failed; `chain` says which. */
  refresh(): Promise<void>;
  /** One transaction by ID, from what the wallet already holds or from the network. */
  lookupTx(txid: string): Promise<TxLookup>;

  // ---- receiving ----

  /** Moves Receive on to the next unused address. Does nothing while a faucet request runs. */
  newReceiveAddress(): void;
  /**
   * Call before the bot check's script is added to the page. It drops a passkey
   * wallet's keys, ends a passkey prompt that is still open, and tells the router,
   * so that every later move between screens is a full page load. So the script
   * cannot read keys that were loaded before it, and the wallet loads none while
   * the script is in the page. (No more than that: a script in the page could still
   * ask the passkey itself, which is why the screens promise nothing further.)
   * Until that page load, actions that load keys or take typed words answer "reload"
   * (unlock, unlockWithWords, create, open, restore) and sign() answers "locked". A
   * wallet made without a passkey goes on signing: its words are in storage, where
   * that script could read them anyway. askFaucet() does the same by itself just
   * before it asks for a token, in case a screen forgot.
   */
  beforeBotCheck(): void;
  /**
   * Asks the faucet to pay the receive address, waiting and asking again by itself
   * where that can help. Progress is in `faucet`. Resolves when the request has
   * been promised or has failed for good.
   */
  askFaucet(getToken: TokenSource): Promise<void>;

  // ---- sending ----

  /**
   * What a payment would cost, without keys. With no coins loaded yet the answer is
   * "nothing-spendable". Never throws. The Send form checks its own fields first (a
   * whole fee rate from 1 to 1,000) and never caps the amount at `maxSendable`, which
   * is what "Send all" would deliver and can be less than an ordinary payment can.
   */
  plan(request: PaymentRequest): PaymentPlan;
  /** Builds and signs. Nothing is sent. */
  sign(request: PaymentRequest): SignResult;
  /**
   * Sends a signed payment. A second call with the same payment while it is under way gets
   * the first call's answer; a different payment waits its turn. With no answer from the
   * network it can take up to 40 seconds.
   */
  broadcast(payment: SignedPayment): Promise<BroadcastResult>;
  /** An address of the pay-it-forward pot, for "Pass it on". */
  potAddress(): Promise<PotAddressResult>;
  /**
   * The pot's three counts: payments passed on that a block has taken in,
   * coins waiting for a newcomer, coins the faucet has handed on. One
   * request each time it is called; ask once, when the line that shows a
   * count is drawn.
   */
  potStats(): Promise<PotStatsResult>;
}
