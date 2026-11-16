// The wallet in this page: which one it is, and whether its keys are loaded.
//
// This is where the rules about keys, storage and other tabs are kept, so
// that no screen has to know them:
//
//   - The 12 words and the private account key live here and nowhere else,
//     in variables that only the functions below can reach. They are never
//     put into anything this module shows, counts or throws. The words come
//     out through revealWords(), and the key never comes out at all: a
//     payment is signed here.
//   - A wallet made without a passkey keeps its words in the browser's
//     storage, so its keys are always at hand. A passkey wallet's keys are
//     loaded by one passkey prompt, live in memory only, and are gone when
//     the page is reloaded or locked.
//   - Other tabs share the storage. Everything that writes reads it again
//     first (keystore.ts does), and when another tab changes the record this
//     page drops what it knows and starts again from what is stored.
//   - The faucet's bot check is somebody else's code. Before it is let into
//     the page, a passkey wallet's keys and every typed word are dropped
//     and a passkey prompt that is still open is ended, and from then on
//     nothing here will load keys or take words until the page has been
//     reloaded. That keeps what was loaded before from that code, and no
//     more: code in the page could still ask the passkey itself.
//   - Words leave a trace where one would not look for it: a regular
//     expression that has matched keeps the text it ran on, and any script
//     in the page can read that text back. So every action here ends by
//     wiping the trace (scrub, below).
//
// Nothing in this file touches the page. The storage, the passkey calls,
// the clock and the rest are handed in, so node --test can run every rule
// with stand-ins. State is shown as in chain-sync.ts: a snapshot, and a call
// when it is replaced.

import type { CountedEvent, Lang, ValueOf } from '@learnbitcoin/practice-contract';
import {
  accountDescriptor,
  accountFromMnemonic,
  entropyFromPrf,
  isValidMnemonic,
  mnemonicFromEntropy,
  newMnemonic,
  normalizeMnemonic,
  ownAddresses,
  selfTest,
  signPayment,
  unknownWords,
  viewPayment,
  type HDKey,
  type PaymentRequest,
  type WalletState,
} from '@learnbitcoin/practice-wallet';
import type { PracticeApi } from './api.ts';
import {
  makeBoard,
  makeChainSync,
  hasHistory,
  safePlan,
  type ChainSync,
  type FirstScan,
  type Published,
  type Timers,
  type Track,
} from './chain-sync.ts';
import { makeFaucetFlow, type FaucetFlow } from './faucet-flow.ts';
import { fill } from './format.ts';
import {
  RECORD_KEY,
  canStore,
  judgeUnlock,
  judgeWords,
  loadRecord,
  makeRecord,
  publicRecord,
  removeUnreadable,
  removeWallet as removeStored,
  replaceRecord,
  saveRecordIfNone,
  type WalletRecord,
} from './keystore.ts';
import {
  createPasskey,
  endPrompt,
  finishCreate,
  getPasskey,
  passkeyOffered,
  signalUnknown,
  type PasskeyEnv,
  type PasskeyOutcome,
} from './passkey.ts';
import type {
  CeremonyFailure,
  CreateResult,
  KeepResult,
  OpenResult,
  PublicRecord,
  RestoreResult,
  SignResult,
  SwitchResult,
  UnlockResult,
  UnlockWordsResult,
  WalletStatus,
  WordsAtResult,
  WordsCheck,
} from './wallet-api.ts';
import { strings } from '../strings/index.ts';

// -- what the caller passes in ------------------------------------------------

/** The passkey calls of passkey.ts, already given their browser objects. Tests pass stand-ins. */
export interface PasskeyPort {
  offered(passkeyHost: string): Promise<boolean>;
  create(label: (tag: string) => string): Promise<PasskeyOutcome>;
  finish(pending: { credentialId: string; tag: string | null; prfEnabled: boolean | null }): Promise<PasskeyOutcome>;
  get(credentialId?: string): Promise<PasskeyOutcome>;
  signalUnknown(credentialId: string): void;
  /** Ends the prompt that is open, if one is: its call answers "cancelled", and what it gives later is never read. */
  end(): void;
}

/** passkey.ts's functions on one set of browser objects. */
export function passkeyPort(env: PasskeyEnv): PasskeyPort {
  return {
    offered: (passkeyHost) => passkeyOffered(env, passkeyHost),
    create: (label) => createPasskey(env, label),
    finish: (pending) => finishCreate(env, pending),
    get: (credentialId) => getPasskey(env, credentialId),
    signalUnknown: (credentialId) => signalUnknown(env, credentialId),
    end: () => endPrompt(),
  };
}

export interface SessionDeps {
  /** localStorage, or a test's stand-in. */
  local: Storage;
  passkeys: PasskeyPort;
  /** The chain engine. The session tells it which wallet to watch, and asks it for the coins when it signs. */
  chain: Pick<ChainSync, 'open' | 'close' | 'probe' | 'state' | 'announce' | 'subscribe'>;
  /** The time in ms since 1970, in whole milliseconds. */
  now: () => number;
  track: Track;
  /** navigator.storage.persist(): asks the browser to keep this site's data. Null: it cannot say. */
  persist: () => Promise<boolean | null>;
  /** The language of the page at this moment: a new passkey is named in it. */
  lang: () => Lang;
  /** The wallet package's selfTest and newMnemonic. Passed in only by tests. */
  selfTest?: () => boolean;
  newMnemonic?: () => string;
}

// -- what it shows ------------------------------------------------------------

/** The session's part of WalletApi's state. wallet-api.ts says what each field means. */
export interface SessionView {
  status: WalletStatus;
  record: PublicRecord | null;
  unlocked: boolean;
  passkeyOffered: boolean | null;
  canStore: boolean;
  persisted: boolean | null;
  setup: { tag: string | null } | null;
  created: 'passkey' | 'words' | null;
  createdName: string | null;
  pendingSwitch: { tag: string | null; fingerprint: string } | null;
  pendingRestore: boolean;
  openedEmpty: boolean;
  /** How many times this page has handed out a wallet's 12 words to be put on screen. A count, never a word. */
  wordsShown: number;
}

export interface Session extends Published<SessionView> {
  createWithPasskey(): Promise<CreateResult>;
  finishSetup(): Promise<CreateResult>;
  createWithWords(): Promise<CreateResult>;
  ackCreated(): void;
  openWithPasskey(): Promise<OpenResult>;
  unlock(how?: 'stored' | 'picker'): Promise<UnlockResult>;
  unlockWithWords(words: string): UnlockWordsResult;
  confirmSwitch(): SwitchResult;
  cancelSwitch(): void;
  checkWords(input: string): WordsCheck;
  restore(words: string): Promise<RestoreResult>;
  keepRestored(): KeepResult;
  eraseRestored(): void;
  lock(): void;
  revealWords(): string[] | null;
  checkWordsAt(positions: number[], typed: string[]): WordsAtResult;
  removeWallet(): 'removed' | 'gone';
  descriptors(): { receive: string; change: string } | null;
  beforeBotCheck(): void;
  sign(request: PaymentRequest): SignResult;

  /** Finds out whether this browser can make the wallet's passkeys on this host, and shows the answer. */
  learnPasskeys(passkeyHost: string): Promise<void>;
  /** Call for every "storage" event of localStorage, with the event's key (null: the storage was cleared). */
  storageChanged(key: string | null): void;
  /**
   * Call when the tab comes back into view, and when the browser brings the
   * page back whole from its memory (Back, or Forward). What is stored is
   * read again, and if it is not what this page loaded, the page starts
   * again from it, as it does for a "storage" event.
   */
  backInView(): void;
}

// -- small helpers ------------------------------------------------------------

/** An error's name, for a details line. Never its message: a message could quote what was handed in. */
function nameOf(error: unknown): string {
  try {
    const name = (error as { name?: unknown } | null | undefined)?.name;
    return typeof name === 'string' && name !== '' ? name : 'Unknown';
  } catch {
    return 'Unknown';
  }
}

/** The same record, field for field. */
function sameRecord(a: WalletRecord, b: WalletRecord): boolean {
  return (
    a.kind === b.kind &&
    a.fingerprint === b.fingerprint &&
    a.xpub === b.xpub &&
    a.firstAddress === b.firstAddress &&
    a.createdAt === b.createdAt &&
    a.credentialId === b.credentialId &&
    a.tag === b.tag &&
    a.mnemonic === b.mnemonic
  );
}

/** A pattern that matches any text, at its start. Made with new RegExp for scrub's sake: see there. */
const START = new RegExp('^');

/**
 * Wipes what regular expressions remember. When one matches, the browser
 * keeps the text it ran on in RegExp.input (also RegExp.$_, leftContext and
 * rightContext), and every script in the page can read it there. The wallet
 * package runs no regular expression over the 12 words (its tests hold it
 * to that), and neither should anything here. But one slip anywhere, in
 * this app or in a library it calls, would leave them in RegExp.input until
 * some other match happened along: after lock(), after "Erase", and with
 * the bot check's script in the page. So every action that handles words
 * ends with this. Matching an empty text puts nothing there in their place.
 *
 * A build tool may drop a call whose answer nobody reads, if it takes the
 * call to do nothing else. Here the match is the whole point. So it is
 * written as the call such tools leave alone (exec, on a pattern they cannot
 * see into), and session.test.ts checks the built code as well as this file.
 */
function scrub(): void {
  START.exec('');
}

const BAD_ANSWER: PasskeyOutcome = { kind: 'error', name: 'BadAnswer' };

/**
 * What a passkey call answered, checked. passkey.ts keeps to PasskeyOutcome;
 * this is for the day something else stands in for it. An answer without
 * the 32 secret bytes it claims, or without the passkey's ID, is no answer.
 */
function soundOutcome(value: unknown): PasskeyOutcome {
  if (typeof value !== 'object' || value === null) return BAD_ANSWER;
  const outcome = value as Record<string, unknown>;
  const named = typeof outcome.credentialId === 'string' && (outcome.tag === null || typeof outcome.tag === 'string');
  switch (outcome.kind) {
    case 'ok':
      return named && outcome.prfOutput instanceof Uint8Array && outcome.prfOutput.length === 32
        ? (value as PasskeyOutcome)
        : BAD_ANSWER;
    case 'unfinished':
    case 'no-prf':
      return named ? (value as PasskeyOutcome) : BAD_ANSWER;
    case 'cancelled':
      return { kind: 'cancelled', timedOut: outcome.timedOut === true };
    case 'error':
      return { kind: 'error', name: typeof outcome.name === 'string' && outcome.name !== '' ? outcome.name : 'Unknown' };
    default:
      return BAD_ANSWER;
  }
}

type Named = Extract<PasskeyOutcome, { kind: 'ok' }>;

// -- the session --------------------------------------------------------------

export function makeSession(deps: SessionDeps): Session {
  const { local, passkeys, chain } = deps;

  // -- the secrets. Nothing below this block may show, count or throw them. ----

  /** The wallet in this page, as stored. For a wallet made without a passkey it holds the words. */
  let record: WalletRecord | null = null;
  /** The 12 words while the wallet is unlocked. */
  let words: string | null = null;
  /** The private account key those words give. Made the first time a payment is signed. */
  let key: HDKey | null = null;
  /** Another passkey's wallet, waiting for confirmSwitch() or cancelSwitch(). */
  let switchTo: { mnemonic: string; credentialId: string; tag: string | null } | null = null;
  /** Typed words with no practice history, waiting for keepRestored() or eraseRestored(). */
  let restoring: string | null = null;

  // -- the rest -----------------------------------------------------------------

  let status: WalletStatus = 'none';
  /** The record as the screens may see it: no words. */
  let shownRecord: PublicRecord | null = null;
  let offered: boolean | null = null;
  let storable = true;
  let persisted: boolean | null = null;
  /**
   * A passkey that was made and has not given its secret yet. `name` is
   * what this page wrote as its name when it made it: kept for the "Wallet
   * made" step that follows "Finish setting up".
   */
  let unfinished: { credentialId: string; tag: string | null; prfEnabled: boolean | null; name: string | null } | null = null;
  let setup: { tag: string | null } | null = null;
  let created: 'passkey' | 'words' | null = null;
  /** The name this page gave the passkey of the wallet it has just made. Set and cleared with `created`. */
  let createdName: string | null = null;
  let pendingSwitch: { tag: string | null; fingerprint: string } | null = null;
  let openedEmpty = false;

  /** True while a passkey prompt of this page is open. */
  let prompting = false;
  /** True once the bot check has been let into the page. It stays true: only a reload gets rid of the script. */
  let botCheck = false;
  /** Counts up every time the wallet in this page changes. Work begun for an earlier wallet checks it and stops. */
  let epoch = 0;
  /** The browser's answer to "will you keep this site's data?". Asked once in a page's life. */
  let persistAnswer: Promise<boolean | null> | null = null;
  /** The wallets (by public key) whose words were shown since the page loaded: each is counted as an event once. */
  const countedShown = new Set<string>();
  /** How many times the words were handed out to be shown since the page loaded, whichever wallet's. */
  let timesShown = 0;
  /** Restores run one after another. */
  let restoreQueue: Promise<unknown> = Promise.resolve();

  const board = makeBoard<SessionView>({
    status,
    record: null,
    unlocked: false,
    passkeyOffered: null,
    canStore: true,
    persisted: null,
    setup: null,
    created: null,
    createdName: null,
    pendingSwitch: null,
    pendingRestore: false,
    openedEmpty: false,
    wordsShown: 0,
  });

  function publish(): void {
    board.set({
      status,
      record: shownRecord,
      unlocked: record !== null && words !== null,
      passkeyOffered: offered,
      canStore: storable,
      persisted,
      setup,
      created,
      // Only ever beside "passkey": whatever clears `created` clears the name with it.
      createdName: created === 'passkey' ? createdName : null,
      pendingSwitch,
      pendingRestore: restoring !== null,
      openedEmpty,
      wordsShown: timesShown,
    });
  }

  // -- the surroundings, used so that a fault in them cannot stop the session ----

  function count<N extends CountedEvent>(name: N, value: ValueOf<N>): void {
    try {
      deps.track(name, value);
    } catch {
      // Counting is never worth a failed action.
    }
  }

  function announce(kind: 'unlocked' | 'locked' | 'replaced'): void {
    try {
      chain.announce(kind);
    } catch {
      // The screen's own text still says it.
    }
  }

  /** What is stored now. Null also when the storage cannot be read at all. */
  function read(): WalletRecord | null | 'unreadable' | 'newer' {
    try {
      return loadRecord(local);
    } catch {
      return null;
    }
  }

  /** Whether the browser will store a wallet, asked with a real write. The answer is shown. */
  function probeStorage(): boolean {
    try {
      storable = canStore(local);
    } catch {
      storable = false;
    }
    return storable;
  }

  /** The name a new passkey gets, in the language the page is in at this moment. */
  function passkeyName(tag: string): string {
    let lang: Lang = 'en';
    try {
      if (deps.lang() === 'es') lang = 'es';
    } catch {
      // English, then.
    }
    return fill(strings.common[lang].passkeyName, { tag });
  }

  /**
   * Hints the password manager to forget a passkey that has no wallet here.
   *
   * Never the passkey of the wallet that is here. A wallet can arrive while
   * a passkey waits to be set up, and it may be that passkey's own: the
   * reader picked it under "Open with my passkey", in this tab or another.
   * Hinted away, a password manager may delete it, and it could then never
   * unlock that wallet again. So this looks at the wallet this page holds
   * and at what is stored right now. And where what is stored cannot be
   * read, nobody can tell whose wallet it is: nothing is hinted, and a
   * setup that was waiting goes on waiting.
   */
  function forgetPasskey(credentialId: string): void {
    const stored = read();
    if (typeof stored === 'string') return;
    const itsOwn = record?.credentialId === credentialId || stored?.credentialId === credentialId;
    if (!itsOwn) {
      try {
        passkeys.signalUnknown(credentialId);
      } catch {
        // Best effort. The screen shows how to delete it by hand.
      }
    }
    if (unfinished?.credentialId === credentialId) {
      unfinished = null;
      setup = null;
    }
  }

  // -- which wallet is here ---------------------------------------------------------

  /** Tells the chain engine which wallet to watch. Its answer says what the first scan found. */
  function openChain(xpub: string, seed?: WalletState): Promise<FirstScan | null> {
    try {
      return chain.open(xpub, seed);
    } catch {
      return Promise.resolve(null);
    }
  }

  /**
   * Starts again from what is stored: the answer to a change made in another
   * tab, and the first thing the session does. Keys, words that were waiting
   * and everything read from the chain are dropped.
   *
   * When one wallet is found in another's place, the screens are told
   * ("replaced"): an address on screen is the other wallet's from this moment,
   * and a reader who is looking at it must not be left to find that out.
   */
  function load(): void {
    const before = record?.xpub ?? null;
    epoch += 1;
    words = null;
    key = null;
    switchTo = null;
    pendingSwitch = null;
    restoring = null;
    created = null;
    createdName = null;
    openedEmpty = false;
    persisted = null;

    const stored = read();
    if (stored === null || typeof stored === 'string') {
      record = null;
      shownRecord = null;
      status = stored ?? 'none';
      try {
        chain.close();
      } catch {
        // Nothing was being watched.
      }
    } else {
      record = stored;
      shownRecord = publicRecord(stored);
      status = 'ready';
      // A passkey still waiting to be set up cannot get a wallet here now: it is given up,
      // unless the wallet that has arrived is its own (forgetPasskey tells the two apart).
      if (unfinished !== null) forgetPasskey(unfinished.credentialId);
      // A wallet made without a passkey: its words are in the record, so it is unlocked from the start.
      if (stored.kind === 'words') words = stored.mnemonic ?? null;
      void openChain(stored.xpub);
    }
    publish();
    // Only another tab does this: whatever this page does to its own wallet goes through adopt().
    if (before !== null && record !== null && record.xpub !== before) announce('replaced');
  }

  /** True when what is stored is what this page loaded. */
  function storedIsLoaded(): boolean {
    const stored = read();
    if (stored === null || typeof stored === 'string') return record === null && status === (stored ?? 'none');
    return record !== null && sameRecord(stored, record);
  }

  /** Reads the storage again and, if another tab has changed it, starts again from it. True when it had changed. */
  function syncWithStorage(): boolean {
    if (storedIsLoaded()) return false;
    load();
    return true;
  }

  /** A wallet this page has just stored is the wallet here now, with its keys loaded. */
  function adopt(next: WalletRecord, mnemonic: string, seed?: WalletState): Promise<FirstScan | null> {
    epoch += 1;
    record = next;
    shownRecord = publicRecord(next);
    status = 'ready';
    words = mnemonic;
    key = null;
    switchTo = null;
    pendingSwitch = null;
    restoring = null;
    created = null;
    createdName = null;
    openedEmpty = false;
    persisted = null;
    // Another passkey that was still waiting to be set up is given up. If it is this wallet's own
    // (opened from the picker instead of "Finish setting up"), it has its wallet now, and is kept.
    if (unfinished !== null) forgetPasskey(unfinished.credentialId);
    publish();
    return openChain(next.xpub, seed);
  }

  /**
   * Why no wallet can be made or brought here right now, or null. The order
   * matters: each reason is checked before anything that costs the reader a
   * prompt, and the storage is read again every time.
   */
  function cannotStart(): 'broken' | 'reload' | 'exists' | 'no-storage' | null {
    if (status === 'broken') return 'broken';
    if (botCheck) return 'reload';
    if (read() !== null) {
      syncWithStorage();
      return 'exists';
    }
    if (!probeStorage()) {
      publish();
      return 'no-storage';
    }
    publish();
    return null;
  }

  /** After a save that did not go through: because a wallet is stored already, or because nothing can be? */
  function whyNotSaved(): 'exists' | 'no-storage' {
    if (read() !== null) {
      syncWithStorage();
      return 'exists';
    }
    probeStorage();
    publish();
    return 'no-storage';
  }

  /** Asks the browser, once, to keep this site's data: a wallet made without a passkey lives in it. */
  function askToPersist(): void {
    const mine = epoch;
    persistAnswer ??= (async () => {
      try {
        const answer = await deps.persist();
        return typeof answer === 'boolean' ? answer : null;
      } catch {
        return null;
      }
    })();
    void persistAnswer.then((answer) => {
      if (mine !== epoch || record?.kind !== 'words') return;
      persisted = answer;
      publish();
    });
  }

  // -- passkey prompts --------------------------------------------------------------

  /** Runs one passkey call. Whatever it does, the answer is a PasskeyOutcome. */
  async function prompt(ask: () => Promise<PasskeyOutcome>): Promise<PasskeyOutcome> {
    prompting = true;
    try {
      return soundOutcome(await ask());
    } catch (error) {
      return { kind: 'error', name: nameOf(error) };
    } finally {
      prompting = false;
    }
  }

  /** The 12 words a passkey's secret bytes give. */
  function wordsOf(outcome: Named): string {
    return mnemonicFromEntropy(entropyFromPrf(outcome.prfOutput));
  }

  /**
   * What making a passkey (or finishing one) came to. `name` is what this
   * page wrote as the passkey's name when it made it, or null if the passkey
   * call never asked for one.
   */
  function made(outcome: PasskeyOutcome, how: 'create' | 'finish', name: string | null): CreateResult {
    // The bot check came into the page while the prompt was open: nothing the prompt gave is used.
    if (botCheck) return { kind: 'reload' };
    switch (outcome.kind) {
      case 'ok': {
        count('Passkey', how === 'finish' ? 'finished' : outcome.prfAt === 'get' ? 'ok-at-get' : 'ok');
        let mnemonic: string;
        let next: WalletRecord;
        try {
          mnemonic = wordsOf(outcome);
          next = makeRecord('passkey', mnemonic, deps.now(), { credentialId: outcome.credentialId, tag: outcome.tag });
        } catch (error) {
          forgetPasskey(outcome.credentialId);
          publish();
          return { kind: 'error', name: nameOf(error) };
        }
        if (!saveRecordIfNone(local, next)) {
          // The passkey exists and its wallet could not be stored: it has no wallet here
          // (unless the wallet stored meanwhile is its own: forgetPasskey looks).
          forgetPasskey(outcome.credentialId);
          return { kind: whyNotSaved() };
        }
        // This passkey has its wallet now. (Another one still unfinished is given up in adopt.)
        if (unfinished?.credentialId === outcome.credentialId) {
          unfinished = null;
          setup = null;
        }
        void adopt(next, mnemonic);
        created = 'passkey';
        // The one moment the whole name is known: the "Wallet made" step shows it as it was written.
        createdName = name;
        publish();
        count('Wallet created', 'passkey');
        return { kind: 'created' };
      }
      case 'unfinished':
        count('Passkey', 'unfinished');
        if (read() !== null) {
          // Something was stored in this browser while the prompt was open (another tab). If it is a
          // wallet, this passkey cannot get one here now, and there is nothing left to finish: no
          // setup is left waiting beside a wallet. (forgetPasskey knows when nothing may be hinted.)
          forgetPasskey(outcome.credentialId);
          syncWithStorage();
          return { kind: 'exists' };
        }
        if (unfinished !== null && unfinished.credentialId !== outcome.credentialId) forgetPasskey(unfinished.credentialId);
        unfinished = { credentialId: outcome.credentialId, tag: outcome.tag, prfEnabled: outcome.prfEnabled, name };
        if (setup === null || setup.tag !== outcome.tag) setup = { tag: outcome.tag };
        publish();
        return { kind: 'unfinished' };
      case 'no-prf':
        count('Passkey', 'no-prf');
        // It answered, and cannot give the secret a wallet is made from: of no use to anyone.
        forgetPasskey(outcome.credentialId);
        publish();
        return { kind: 'no-prf', tag: outcome.tag };
      case 'cancelled':
        count('Passkey', outcome.timedOut ? 'timed-out' : 'cancelled');
        return { kind: 'cancelled', timedOut: outcome.timedOut };
      case 'error':
        if (outcome.name === 'Busy') return { kind: 'busy' };
        count('Passkey', 'error');
        return { kind: 'error', name: outcome.name };
    }
  }

  /** How a prompt that opens or unlocks a wallet failed, counted and passed on. */
  function notOpened(outcome: Exclude<PasskeyOutcome, { kind: 'ok' }>): CeremonyFailure {
    switch (outcome.kind) {
      case 'no-prf':
        count('Unlock', 'no-prf');
        return { kind: 'no-prf', tag: outcome.tag };
      case 'cancelled':
        count('Unlock', outcome.timedOut ? 'timed-out' : 'cancelled');
        return { kind: 'cancelled', timedOut: outcome.timedOut };
      case 'unfinished':
        // Only a create can end this way.
        count('Unlock', 'error');
        return { kind: 'error', name: 'BadAnswer' };
      case 'error':
        if (outcome.name === 'Busy') return { kind: 'busy' };
        count('Unlock', 'error');
        return { kind: 'error', name: outcome.name };
    }
  }

  // -- making a wallet --------------------------------------------------------------

  async function createWithPasskey(): Promise<CreateResult> {
    try {
      const refusal = cannotStart() ?? (prompting ? 'busy' : null);
      if (refusal !== null) return { kind: refusal };
      // The passkey call asks for the name once it has made up the tag. What it is told is kept.
      let name: string | null = null;
      const label = (tag: string): string => {
        name = passkeyName(tag);
        return name;
      };
      return made(await prompt(() => passkeys.create(label)), 'create', name);
    } catch (error) {
      return { kind: 'error', name: nameOf(error) };
    }
  }

  async function finishSetup(): Promise<CreateResult> {
    try {
      const refusal = cannotStart() ?? (prompting ? 'busy' : null);
      if (refusal !== null) return { kind: refusal };
      const pending = unfinished;
      if (pending === null) return { kind: 'error', name: 'NothingToFinish' };
      const { name, ...passkey } = pending;
      return made(await prompt(() => passkeys.finish(passkey)), 'finish', name);
    } catch (error) {
      return { kind: 'error', name: nameOf(error) };
    }
  }

  async function createWithWords(): Promise<CreateResult> {
    try {
      const refusal = cannotStart() ?? (prompting ? 'busy' : null);
      if (refusal !== null) return { kind: refusal };
      const next = makeRecord('words', (deps.newMnemonic ?? newMnemonic)(), deps.now());
      if (next.mnemonic === undefined) return { kind: 'error', name: 'NoWords' };
      if (!saveRecordIfNone(local, next)) return { kind: whyNotSaved() };
      void adopt(next, next.mnemonic);
      created = 'words';
      publish();
      count('Wallet created', 'words');
      askToPersist();
      return { kind: 'created' };
    } catch (error) {
      return { kind: 'error', name: nameOf(error) };
    }
  }

  function ackCreated(): void {
    created = null;
    createdName = null;
    publish();
  }

  async function openWithPasskey(): Promise<OpenResult> {
    try {
      const refusal = cannotStart() ?? (prompting ? 'busy' : null);
      if (refusal !== null) return { kind: refusal };
      // No credential ID: the browser shows its picker, and the reader chooses.
      const outcome = await prompt(() => passkeys.get());
      if (botCheck) return { kind: 'reload' };
      if (outcome.kind !== 'ok') return notOpened(outcome);

      const mnemonic = wordsOf(outcome);
      // With nothing stored there is nothing to compare this wallet with: it is taken as it comes.
      // (The overview says so if it turns out to have no history: see openedEmpty.)
      const next = makeRecord('passkey', mnemonic, deps.now(), { credentialId: outcome.credentialId, tag: outcome.tag });
      if (!saveRecordIfNone(local, next)) return { kind: whyNotSaved() };
      const scanned = adopt(next, mnemonic);
      const mine = epoch;
      // Counted once the first scan has said whether this wallet was ever used.
      void scanned.then((found) => {
        if (found === null || mine !== epoch) return;
        count('Unlock', found.history ? 'opened' : 'opened-empty');
        if (found.history) return;
        openedEmpty = true;
        publish();
      });
      return { kind: 'opened' };
    } catch (error) {
      return { kind: 'error', name: nameOf(error) };
    }
  }

  // -- unlocking ----------------------------------------------------------------------

  function dropSwitch(): void {
    switchTo = null;
    pendingSwitch = null;
  }

  async function unlock(how: 'stored' | 'picker' = 'stored'): Promise<UnlockResult> {
    try {
      if (status === 'broken') return { kind: 'broken' };
      syncWithStorage();
      const before = record;
      if (before === null) return { kind: 'gone' };
      // Words kept in this browser: there is nothing to unlock.
      if (before.kind === 'words') return { kind: 'unlocked' };
      if (botCheck) return { kind: 'reload' };
      if (how !== 'picker' && words !== null) return { kind: 'unlocked' };
      if (prompting) return { kind: 'busy' };
      // An earlier offer to switch wallets is over once the reader asks again.
      dropSwitch();
      publish();

      // "stored": the one passkey this browser remembers, no picker. "picker": the reader chooses.
      const outcome = await prompt(() => passkeys.get(how === 'picker' ? undefined : before.credentialId));
      if (botCheck) return { kind: 'reload' };
      // Another tab may have removed or replaced the wallet while the prompt was open.
      syncWithStorage();
      const current = record;
      if (current === null || !sameRecord(current, before)) return { kind: 'gone' };
      if (outcome.kind !== 'ok') return notOpened(outcome);

      const mnemonic = wordsOf(outcome);
      switch (judgeUnlock(current, outcome.credentialId, mnemonic)) {
        case 'same':
          words = mnemonic;
          key = null;
          publish();
          count('Unlock', 'same');
          announce('unlocked');
          return { kind: 'unlocked' };

        case 'other-passkey': {
          // Another wallet. Nothing changes until the reader says so; its words wait here meanwhile.
          // The record is made once now, and thrown away: a wallet whose record could not be written
          // (a passkey ID or tag that is not one) must not be offered at all.
          const { fingerprint } = makeRecord('passkey', mnemonic, current.createdAt, {
            credentialId: outcome.credentialId,
            tag: outcome.tag,
          });
          switchTo = { mnemonic, credentialId: outcome.credentialId, tag: outcome.tag };
          pendingSwitch = { tag: outcome.tag, fingerprint };
          publish();
          count('Unlock', 'other-passkey');
          return { kind: 'other-passkey', tag: outcome.tag, fingerprint };
        }

        case 'tampered': {
          // The stored record had been altered. The keys are the wallet: the record is written again from them.
          const rebuilt = makeRecord('passkey', mnemonic, current.createdAt, {
            credentialId: outcome.credentialId,
            tag: outcome.tag ?? current.tag ?? null,
          });
          if (!replaceRecord(local, current.fingerprint, rebuilt)) {
            if (syncWithStorage()) return { kind: 'gone' };
            return { kind: 'error', name: 'StorageError' };
          }
          // What was read from the chain so far may have been another wallet's: adopt() has it read again from nothing.
          void adopt(rebuilt, mnemonic);
          count('Unlock', 'tampered');
          announce('unlocked');
          return { kind: 'tampered' };
        }

        // "changed", and "adopt", which cannot be the verdict on a stored record: nothing is opened or written.
        default:
          count('Unlock', 'changed');
          return { kind: 'changed' };
      }
    } catch (error) {
      return { kind: 'error', name: nameOf(error) };
    }
  }

  function unlockWithWords(input: string): UnlockWordsResult {
    try {
      if (status === 'broken') return 'broken';
      if (botCheck) return 'reload';
      syncWithStorage();
      const current = record;
      if (current === null) return 'gone';
      if (typeof input !== 'string' || !isValidMnemonic(input)) return 'invalid';
      // Judged as a passkey's answer is: by the stored public key and the stored wallet fingerprint.
      const verdict = judgeWords(current, input);
      if (verdict === 'other') return 'other-wallet';
      // A wallet made without a passkey is unlocked already; the words were only checked.
      // (Its record holds its words, and is read only if they give both of the two.)
      if (current.kind !== 'passkey') return 'unlocked';
      const mnemonic = normalizeMnemonic(input);
      if (verdict === 'tampered') {
        // The words fit one of the two and not the other: the stored record had been altered. As after
        // a passkey's answer, it is written again from the keys. It stays a passkey wallet's record,
        // with its passkey's ID and tag: the words themselves are not stored.
        const rebuilt = makeRecord('passkey', mnemonic, current.createdAt, {
          credentialId: current.credentialId ?? '',
          tag: current.tag ?? null,
        });
        if (!replaceRecord(local, current.fingerprint, rebuilt)) {
          if (syncWithStorage()) return 'gone';
          // The keys are not loaded on top of a record that is known to be wrong.
          probeStorage();
          publish();
          return 'no-storage';
        }
        // What was read from the chain so far may have been another wallet's: adopt() has it read again from nothing.
        void adopt(rebuilt, mnemonic);
        count('Unlock', 'tampered');
        announce('unlocked');
        return 'tampered';
      }
      // For this page only. Nothing is written: a reload locks the wallet again.
      words = mnemonic;
      key = null;
      dropSwitch();
      publish();
      count('Unlock', 'words');
      announce('unlocked');
      return 'unlocked';
    } catch {
      return 'invalid';
    }
  }

  function confirmSwitch(): SwitchResult {
    try {
      const to = switchTo;
      if (to === null || botCheck) return 'nothing-pending';
      syncWithStorage();
      if (record === null || switchTo !== to) return 'gone';
      const next = makeRecord('passkey', to.mnemonic, deps.now(), { credentialId: to.credentialId, tag: to.tag });
      // Only in place of the wallet this page loaded: another tab may have changed it.
      if (!replaceRecord(local, record.fingerprint, next)) {
        if (syncWithStorage()) return 'gone';
        probeStorage();
        publish();
        return 'no-storage';
      }
      void adopt(next, to.mnemonic);
      announce('unlocked');
      return 'switched';
    } catch {
      return 'no-storage';
    }
  }

  function cancelSwitch(): void {
    dropSwitch();
    publish();
  }

  function lock(): void {
    dropSwitch();
    if (record !== null && record.kind === 'passkey' && words !== null) {
      words = null;
      key = null;
      publish();
      announce('locked');
    } else {
      publish();
    }
  }

  function revealWords(): string[] | null {
    try {
      if (record === null || words === null) return null;
      // A new list each time: nothing the caller does to it reaches the words kept here.
      const list = words.split(' ');
      if (!countedShown.has(record.xpub)) {
        countedShown.add(record.xpub);
        count('Words shown', record.kind);
      }
      // Every time they are handed out, the page is told that it happened, and nothing more
      // than that: a number that goes up. The "Do it" step that asks the reader to look at
      // their words goes by it. (The event above is sent once for a wallet; this counts each time.)
      timesShown += 1;
      publish();
      return list;
    } catch {
      return null;
    }
  }

  /**
   * Compares a few typed words with the wallet's own, by their place in the
   * phrase, and says which places were wrong. The "Do it" steps that check
   * a paper copy ask through this, so that the 12 words never have to be
   * handed to a screen for a check: what comes back is positions, never a
   * word. Nothing is counted, nothing is stored, and the wallet is left as
   * it was.
   *
   * What was typed is handled as the 12 words themselves are: tidied
   * without a regular expression (the wallet package's own way), compared
   * as plain text, and the trace wiped when the call returns (tidy, below).
   */
  function checkWordsAt(positions: number[], typed: string[]): WordsAtResult {
    try {
      // Nothing takes typed words in a page the bot check has been let into, whatever kind of wallet is here.
      if (botCheck) return { ok: false, reason: 'reload' };
      // Another tab may have removed or replaced the wallet since this page last looked.
      if (status !== 'broken') syncWithStorage();
      if (record === null) return { ok: false, reason: 'gone' };
      if (words === null) return { ok: false, reason: 'locked' };
      const own = words.split(' ');
      const asked: unknown[] = Array.isArray(positions) ? positions : [];
      const given: unknown[] = Array.isArray(typed) ? typed : [];
      const wrong: number[] = [];
      for (let i = 0; i < asked.length; i++) {
        const position = asked[i];
        const text = given[i];
        // A place the phrase does not have is wrong, and so is one with nothing typed for it.
        const expected = typeof position === 'number' && Number.isInteger(position) && position >= 0 ? own[position] : undefined;
        const right = expected !== undefined && typeof text === 'string' && normalizeMnemonic(text) === expected;
        if (!right) wrong.push(typeof position === 'number' ? position : -1);
      }
      return { ok: true, wrong };
    } catch {
      // Nothing above should throw. If it did, this page is not fit to check words: load it again.
      return { ok: false, reason: 'reload' };
    }
  }

  function removeWallet(): 'removed' | 'gone' {
    try {
      if (status === 'unreadable') {
        // Deletes only what still cannot be read. A sound wallet another tab stored meanwhile stays.
        if (!removeUnreadable(local)) {
          syncWithStorage();
          return 'gone';
        }
        load();
        return 'removed';
      }
      if (status !== 'ready' || record === null) {
        if (status !== 'broken') syncWithStorage();
        return 'gone';
      }
      const kind = record.kind;
      // Only the wallet this page loaded: keystore.ts reads the storage again and compares.
      if (!removeStored(local, record.fingerprint)) {
        syncWithStorage();
        return 'gone';
      }
      count('Wallet removed', kind);
      load();
      return 'removed';
    } catch {
      return 'gone';
    }
  }

  function descriptors(): { receive: string; change: string } | null {
    try {
      if (record === null) return null;
      return {
        receive: accountDescriptor(record.fingerprint, record.xpub, 0),
        change: accountDescriptor(record.fingerprint, record.xpub, 1),
      };
    } catch {
      return null;
    }
  }

  // -- restoring ----------------------------------------------------------------------

  function checkWords(input: string): WordsCheck {
    try {
      const text = normalizeMnemonic(input);
      return { words: text === '' ? [] : text.split(' '), unknown: unknownWords(text), valid: isValidMnemonic(text) };
    } catch {
      return { words: [], unknown: [], valid: false };
    }
  }

  function restore(input: string): Promise<RestoreResult> {
    // One at a time: a second restore waits for the first, and then answers for itself.
    const run = restoreQueue.then(() => restoreNow(input));
    restoreQueue = run;
    return run;
  }

  async function restoreNow(input: string): Promise<RestoreResult> {
    try {
      if (status === 'broken') return { kind: 'broken' };
      if (typeof input !== 'string' || !isValidMnemonic(input)) return { kind: 'invalid' };
      const refusal = cannotStart();
      if (refusal !== null) return { kind: refusal };
      // Words still waiting from an earlier try are let go.
      restoring = null;
      publish();

      // Scan first. Until history is found, or the reader says "keep them anyway",
      // the words are in this function's memory and nowhere else.
      const mnemonic = normalizeMnemonic(input);
      const xpub = accountFromMnemonic(mnemonic).xpub;
      // The scan takes a while, and other code runs meanwhile.
      scrub();
      const found = await chain.probe(xpub);
      if (botCheck) return { kind: 'reload' };
      if (!found.ok) return { kind: 'failed', reason: found.reason };
      // A wallet may have arrived here while the scan ran: another tab, or a passkey prompt that was open.
      if (read() !== null) {
        syncWithStorage();
        return { kind: 'exists' };
      }
      if (!hasHistory(found.state)) {
        restoring = mnemonic;
        publish();
        return { kind: 'empty' };
      }
      const next = makeRecord('words', mnemonic, deps.now());
      if (!saveRecordIfNone(local, next)) return { kind: whyNotSaved() };
      // The scan just made is the wallet's first.
      void adopt(next, mnemonic, found.state);
      count('Restore', 'found');
      askToPersist();
      return { kind: 'restored' };
    } catch {
      return { kind: 'failed', reason: 'unavailable' };
    }
  }

  function keepRestored(): KeepResult {
    try {
      const mnemonic = restoring;
      if (mnemonic === null || botCheck) return 'nothing-pending';
      const next = makeRecord('words', mnemonic, deps.now());
      if (!saveRecordIfNone(local, next)) return whyNotSaved();
      void adopt(next, mnemonic);
      count('Restore', 'kept');
      askToPersist();
      return 'restored';
    } catch {
      return 'no-storage';
    }
  }

  function eraseRestored(): void {
    if (restoring === null) return;
    restoring = null;
    publish();
    count('Restore', 'erased');
  }

  // -- the bot check ----------------------------------------------------------------

  function beforeBotCheck(): void {
    botCheck = true;
    // A passkey prompt that is still open is ended first. Answered later, it would hand the
    // passkey's secret to a page that holds the script: the answer is read where the script
    // can look on. (The call that opened it answers "reload", like every call from now on.)
    try {
      passkeys.end();
    } catch {
      // What that prompt gives is thrown away all the same.
    }
    // Typed words and another wallet's words: gone, whatever kind of wallet is here.
    restoring = null;
    dropSwitch();
    // A passkey wallet's keys exist in memory only, so dropping them keeps them from the script.
    // A wallet made without a passkey keeps its words in storage, where any script can read them anyway.
    if (record !== null && record.kind === 'passkey' && words !== null) {
      words = null;
      key = null;
      publish();
      announce('locked');
    } else {
      publish();
    }
  }

  // -- signing ------------------------------------------------------------------------

  function sign(request: PaymentRequest): SignResult {
    try {
      if (record === null || words === null) return { ok: false, reason: 'locked' };
      const state = chain.state();
      key ??= accountFromMnemonic(words).key;
      // The plan first: a payment that cannot be made is refused with planPayment's own reason.
      const plan = safePlan(key, state, request);
      if (!plan.ok) return { ok: false, reason: plan.reason };
      if (state === null) return { ok: false, reason: 'nothing-spendable' };
      const payment = signPayment(key, state, request);
      return { ok: true, payment, view: viewPayment(payment, ownAddresses(state)) };
    } catch {
      return { ok: false, reason: 'nothing-spendable' };
    }
  }

  // -- wired by the glue --------------------------------------------------------------

  async function learnPasskeys(passkeyHost: string): Promise<void> {
    let answer = false;
    try {
      answer = (await passkeys.offered(passkeyHost)) === true;
    } catch {
      answer = false;
    }
    offered = answer;
    publish();
  }

  function storageChanged(changed: string | null): void {
    try {
      if (status === 'broken') return;
      // Only the wallet's own key, or a storage that was cleared whole.
      if (changed !== null && changed !== RECORD_KEY) return;
      load();
    } catch {
      // The next action reads the storage again.
    }
  }

  /**
   * A page that was put aside hears nothing. When the reader leaves for
   * another site in the same tab, the browser may keep this page whole in
   * its memory and bring it back as it was when they press Back. While it
   * lies there it gets no "storage" event, so a wallet removed or replaced
   * in the meantime (in another tab, or in the same tab on a page loaded
   * after this one) is still the wallet this page remembers. Shown again,
   * the page would speak of a wallet that is not in the browser, and the
   * "Do it" steps would judge by it.
   *
   * So the storage is read again whenever the page is back in front of the
   * reader. If it holds what this page loaded, nothing happens: the keys of
   * a passkey wallet stay loaded and nothing is read from the network. If
   * it does not, the page starts again from what is stored, exactly as
   * after a "storage" event.
   */
  function backInView(): void {
    try {
      if (status !== 'broken') syncWithStorage();
    } catch {
      // The next action reads the storage again.
    }
  }

  // -- starting up ----------------------------------------------------------------------

  // The self-test comes before the first derivation of the page, and reading the record derives.
  let sound = false;
  try {
    sound = (deps.selfTest ?? selfTest)() === true;
  } catch {
    sound = false;
  }
  if (sound) {
    probeStorage();
    load();
  } else {
    // This browser derives wrong keys. Nothing is read, written, made or opened.
    status = 'broken';
    publish();
  }

  // Reading a stored wallet's words is handling them, too.
  scrub();

  // An opened wallet with no history shows why that may be, until coins are seen.
  try {
    chain.subscribe(() => {
      if (!openedEmpty || (chain.state()?.coins.length ?? 0) === 0) return;
      openedEmpty = false;
      publish();
    });
  } catch {
    // The explanation then stays until the page is reloaded.
  }

  /**
   * An action as it is handed out. Whatever it did with the words, the trace
   * a regular expression may have kept of them is wiped when the call
   * returns, and again when its answer arrives (see scrub).
   */
  function tidy<A extends unknown[], R>(action: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      let answer: R;
      try {
        answer = action(...args);
      } finally {
        scrub();
      }
      if (answer instanceof Promise) void answer.then(scrub, scrub);
      return answer;
    };
  }

  return {
    view: board.view,
    subscribe: board.subscribe,
    createWithPasskey: tidy(createWithPasskey),
    finishSetup: tidy(finishSetup),
    createWithWords: tidy(createWithWords),
    ackCreated: tidy(ackCreated),
    openWithPasskey: tidy(openWithPasskey),
    unlock: tidy(unlock),
    unlockWithWords: tidy(unlockWithWords),
    confirmSwitch: tidy(confirmSwitch),
    cancelSwitch: tidy(cancelSwitch),
    checkWords: tidy(checkWords),
    restore: tidy(restore),
    keepRestored: tidy(keepRestored),
    eraseRestored: tidy(eraseRestored),
    lock: tidy(lock),
    revealWords: tidy(revealWords),
    checkWordsAt: tidy(checkWordsAt),
    removeWallet: tidy(removeWallet),
    descriptors: tidy(descriptors),
    beforeBotCheck: tidy(beforeBotCheck),
    sign: tidy(sign),
    learnPasskeys: tidy(learnPasskeys),
    storageChanged: tidy(storageChanged),
    backInView: tidy(backInView),
  };
}

// -- the three modules as one engine --------------------------------------------------

/** Everything the engine is handed. wallet.svelte.ts passes the browser's objects; tests pass stand-ins. */
export interface EngineDeps extends Omit<SessionDeps, 'chain'> {
  api: PracticeApi;
  timers: Timers;
  visible: () => boolean;
  blockSeconds: () => number;
}

export interface Engine {
  session: Session;
  chain: ChainSync;
  faucet: FaucetFlow;
}

/**
 * Builds the chain engine, the faucet flow and the session, in the order
 * they depend on each other. The session comes last because it starts at
 * once: it reads the stored record, and if a wallet is there it has the
 * chain engine begin that wallet's first scan. The faucet flow is handed
 * out with one rule of the session's laid over it: the bot check never
 * runs while a passkey wallet's keys are loaded.
 */
export function makeEngine(deps: EngineDeps): Engine {
  const chain = makeChainSync({
    api: deps.api,
    now: deps.now,
    timers: deps.timers,
    visible: deps.visible,
    track: deps.track,
    blockSeconds: deps.blockSeconds,
  });
  const flow = makeFaucetFlow({ api: deps.api, chain, now: deps.now, timers: deps.timers, track: deps.track });
  const session = makeSession({ ...deps, chain });
  const faucet: FaucetFlow = {
    view: flow.view,
    subscribe: flow.subscribe,
    // The token source is the bot check: somebody else's code. A screen calls beforeBotCheck()
    // before it adds that code to the page. Should one forget, the keys are dropped here all the
    // same, before the check runs: it never meets them, whoever asks the faucet.
    ask: (getToken) =>
      flow.ask((fresh) => {
        session.beforeBotCheck();
        return getToken(fresh);
      }),
  };
  return { session, chain, faucet };
}
