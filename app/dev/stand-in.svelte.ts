// A scripted stand-in for the wallet, for the development gallery.
//
// It satisfies WalletApi (src/lib/wallet-api.ts), so the app cannot tell it
// from the real wallet. It talks to no network, stores nothing, asks for no
// passkey and logs nothing. Its state comes from a preset, and each action
// ends the way the page's query string says, after a short delay. So any
// screen can be opened in any state:
//
//   /es/wallet/receive?state=funded
//   /wallet/send?state=passkey-locked&unlock=cancelled
//
// PRESETS (state=...). These thirteen are in presets/base.ts; the page
// /gallery lists every preset there is, with a link to each screen in it.
//
//   none              this browser has no wallet (the default)
//   words             a wallet made without a passkey, with coins and history
//   passkey-locked    a passkey wallet, locked, with coins and history
//   passkey-unlocked  the same, unlocked
//   scanning          the first scan of the wallet's coins is running: no total yet
//   scan-failed       the first scan failed: still no total, a next try is due
//   no-coins          scanned, and the wallet holds nothing
//   funded            four coins (one is change, one unconfirmed) and five transactions
//   refresh-failed    funded, but the latest refresh failed three minutes ago
//   slow              funded, and the practice network has made no block for a while
//   unreadable        something is stored that cannot be read
//   newer             what is stored was written by a newer version of the page
//   broken            the self-test failed: this browser derives wrong keys
//
// Where a preset has a wallet and does not say which kind, it is a passkey
// wallet, locked.
//
// TO ADD A PRESET, make a file of your own under presets/ (presets/receive.ts,
// say) that exports `presets`, as presets/base.ts does. Every file there is
// picked up by itself, so no shared list has to be edited, and two people
// adding presets never touch the same file. Say what each one shows in a
// comment beside it.
//
// QUERY KEYS that change the state:
//
//   kind=passkey|words         the kind of wallet, where the preset has one
//   unlocked=yes|no            a passkey wallet's lock (a "words" wallet is always unlocked)
//   passkeys=yes|no|unknown    whether this browser offers passkeys (default yes)
//   storage=no                 the browser refuses to store anything
//   settings=loading|failed    the Worker's settings have not arrived yet, or never came: the
//                              built-in ones stand (default: they are loaded)
//   botcheck=none              the settings name no bot check, so the faucet is closed
//   events=yes                 screen views are counted (into a list on the page, never the network: see main.ts)
//   delay=<milliseconds>       how long an action takes (default 600)
//
// QUERY KEYS that say how an action ends. The first value is the default.
// Wherever "passkey" stands in a list, any of these may be given: cancelled,
// timed-out, no-prf, error, busy, reload, broken.
//
//   create=created|unfinished|exists|no-storage|passkey        createWithPasskey
//   finish=created|unfinished|exists|no-storage|passkey        finishSetup
//   createWords=created|exists|no-storage|reload|broken        createWithWords
//   open=opened|opened-empty|exists|no-storage|passkey         openWithPasskey
//   unlock=unlocked|tampered|other-passkey|changed|gone|replaced|passkey    unlock ("gone": the wallet was
//                              removed in another tab; "replaced": another one was put in its place.
//                              The wallet answers "gone" to both)
//   unlockWords=check|unlocked|tampered|invalid|other-wallet|no-storage|gone|reload|broken    unlockWithWords ("check" looks at the words)
//   switch=switched|gone|no-storage                            confirmSwitch
//   restore=check|restored|empty|invalid|exists|no-storage|failed|reload|broken    restore ("check": valid words are restored)
//   keep=restored|exists|no-storage                            keepRestored
//   remove=removed|gone                                        removeWallet
//   reveal=words|none                                          revealWords ("none": no words although unlocked)
//   descriptors=ok|none                                        descriptors
//   refresh=ok|<a failure>                                     refresh, e.g. refresh=unavailable
//   list=ok|<a failure>                                        the read of the list of transactions that
//                                                              follows a refresh that worked, e.g. list=limit
//   lookup=check|found|waiting|not-found|<a failure>           lookupTx ("check": found if it is in the history)
//   faucet=ok|ok-pot|busy|refilling|limit|<a failure>|no-token|gave-up    askFaucet (busy, refilling, limit: it waits 20 s, then pays)
//   sign=ok|<a plan failure>                                   sign, e.g. sign=too-much
//   broadcast=ok|<a broadcast failure>                         broadcast, e.g. broadcast=coin_spent
//   pot=ok|<a failure>                                         potAddress
//
// "A failure" is one of the contract's refusal codes, or "network". A key or
// a value that is not listed stops the page with an error that says what is
// allowed, so a typing mistake is never taken for a default.

import { BROADCAST_REFUSALS, ERROR_CODES, type AppConfig, type FaucetPayment } from '@learnbitcoin/practice-contract';
import {
  accountDescriptor,
  applyPayment,
  coinTotals,
  isValidMnemonic,
  normalizeMnemonic,
  ownAddresses,
  planPayment,
  signPayment,
  unknownWords,
  viewPayment,
  watchOnlyAccount,
  type PaymentPlan,
  type PaymentRequest,
  type PlanFailure,
  type SignedPayment,
  type TxView,
  type WalletState,
} from '@learnbitcoin/practice-wallet';
import type { ApiFailure, BroadcastFailure } from '../src/lib/api.ts';
import { DEFAULT_CONFIG } from '../src/lib/config.ts';
import { fill } from '../src/lib/format.ts';
import { parsePath, type Route } from '../src/lib/router.ts';
import type {
  BroadcastResult,
  CeremonyFailure,
  ChainView,
  CreateResult,
  FaucetFailure,
  FaucetView,
  KeepResult,
  Notice,
  OpenResult,
  PotAddressResult,
  PublicRecord,
  ReceiveView,
  RestoreResult,
  SettingsState,
  SignResult,
  SwitchResult,
  TokenSource,
  TxLookup,
  UnlockResult,
  UnlockWordsResult,
  WalletApi,
  WalletStatus,
  WordsCheck,
} from '../src/lib/wallet-api.ts';
import { strings } from '../src/strings/index.ts';
import {
  ACCOUNT,
  OTHER_FINGERPRINT,
  OTHER_TAG,
  POT_ADDRESS,
  TAG,
  TIP,
  TXID,
  WORDS,
  emptyState,
  fundedState,
  ownAddress,
  sampleHistory,
  sampleRecord,
} from './sample.ts';

// -- what the query string may say ----------------------------------------------

const PASSKEY_FAILURES = ['cancelled', 'timed-out', 'no-prf', 'error', 'busy', 'reload', 'broken'] as const;
const API_FAILURES: readonly ApiFailure[] = [...ERROR_CODES, 'network'];
const BROADCAST_FAILURES: readonly BroadcastFailure[] = [...BROADCAST_REFUSALS, 'too_large', 'limit', 'unavailable', 'network'];
const PLAN_FAILURES: readonly string[] = [
  'nothing-spendable',
  'unconfirmed-only',
  'too-much',
  'below-dust',
  'bad-address',
  'too-small',
  'bad-fee',
];

/** Every action key, with the ways the action can be told to end. The first is the default. */
export const ANSWERS: Record<string, readonly string[]> = {
  create: ['created', 'unfinished', 'exists', 'no-storage', ...PASSKEY_FAILURES],
  finish: ['created', 'unfinished', 'exists', 'no-storage', ...PASSKEY_FAILURES],
  createWords: ['created', 'exists', 'no-storage', 'reload', 'broken'],
  open: ['opened', 'opened-empty', 'exists', 'no-storage', ...PASSKEY_FAILURES],
  unlock: ['unlocked', 'tampered', 'other-passkey', 'changed', 'gone', 'replaced', ...PASSKEY_FAILURES],
  unlockWords: ['check', 'unlocked', 'tampered', 'invalid', 'other-wallet', 'no-storage', 'gone', 'reload', 'broken'],
  switch: ['switched', 'gone', 'no-storage'],
  restore: ['check', 'restored', 'empty', 'invalid', 'exists', 'no-storage', 'failed', 'reload', 'broken'],
  keep: ['restored', 'exists', 'no-storage'],
  remove: ['removed', 'gone'],
  reveal: ['words', 'none'],
  descriptors: ['ok', 'none'],
  refresh: ['ok', ...API_FAILURES],
  list: ['ok', ...API_FAILURES],
  lookup: ['check', 'found', 'waiting', 'not-found', ...API_FAILURES],
  faucet: ['ok', 'ok-pot', ...API_FAILURES, 'no-token', 'gave-up'],
  sign: ['ok', ...PLAN_FAILURES],
  broadcast: ['ok', ...BROADCAST_FAILURES],
  pot: ['ok', ...API_FAILURES],
};

/** The passkey failure an answer names, or null when the answer is something else. */
function passkeyFailure(answer: string): CeremonyFailure | null {
  switch (answer) {
    case 'cancelled':
      return { kind: 'cancelled', timedOut: false };
    case 'timed-out':
      return { kind: 'cancelled', timedOut: true };
    case 'no-prf':
      return { kind: 'no-prf', tag: TAG };
    case 'error':
      return { kind: 'error', name: 'NotAllowedError' };
    case 'busy':
      return { kind: 'busy' };
    case 'reload':
      return { kind: 'reload' };
    case 'broken':
      return { kind: 'broken' };
    default:
      return null;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The name a passkey made on this page is saved under: written in the
 * page's language at that moment, as the real wallet writes it, with the
 * sample passkey's tag.
 */
function nameGiven(): string {
  const { lang } = parsePath(location.pathname);
  return fill(strings.common[lang].passkeyName, { tag: TAG });
}

// -- the stand-in ---------------------------------------------------------------

const IDLE: FaucetView = { phase: 'idle', payment: null, failure: null, retryAt: null };
const NO_CHAIN: ChainView = {
  state: null,
  scanning: false,
  error: null,
  checkedAt: null,
  retryAt: null,
  tip: null,
  slow: false,
};

/**
 * The stand-in itself. Its fields are the wallet's reactive properties: a
 * preset sets them, a scripted action changes them, and a screen follows.
 * Values that are objects are swapped whole, never changed in place.
 */
export class StandIn implements WalletApi {
  status = $state<WalletStatus>('none');
  record = $state.raw<PublicRecord | null>(null);
  unlocked = $state(false);
  // The built-in settings, with no counting. The site key is a made-up one:
  // it only says "the faucet is open". The bot check is never run here
  // (askFaucet never asks for a token), so a screen that waits for the
  // wallet to ask loads no outside script in the gallery.
  config = $state.raw<AppConfig>({ ...DEFAULT_CONFIG, turnstileSiteKey: 'stand-in', events: false });
  // As if the Worker had answered: the settings above are "this deployment's".
  settings = $state<SettingsState>('loaded');
  passkeyOffered = $state<boolean | null>(true);
  canStore = $state(true);
  persisted = $state<boolean | null>(null);
  setup = $state.raw<{ tag: string | null } | null>(null);
  created = $state<'passkey' | 'words' | null>(null);
  createdName = $state<string | null>(null);
  pendingSwitch = $state.raw<{ tag: string | null; fingerprint: string } | null>(null);
  pendingRestore = $state(false);
  openedEmpty = $state(false);
  chain = $state.raw<ChainView>(NO_CHAIN);
  history = $state.raw<TxView[] | null>(null);
  historyError = $state<ApiFailure | null>(null);
  receive = $state.raw<ReceiveView | null>(null);
  faucet = $state.raw<FaucetView>(IDLE);
  notice = $state.raw<Notice | null>(null);

  /** How each action ends, by action key. Unlisted keys take the default. */
  answers: Record<string, string> = {};
  /** How long an action takes, in milliseconds. */
  delay = 600;
  /** The screen App.svelte last said is open. For a look from the console. */
  watching: Route['name'] | null = null;

  /** What `history` becomes once a screen that shows activity is watched. */
  #historyToLoad: TxView[] | null = null;
  /** True while that list is on its way: it is handed over once, however often watch() is called meanwhile. */
  #historyLoading = false;
  /** True after beforeBotCheck(): actions that need keys answer "reload". */
  #botCheck = false;
  /** Who is told when beforeBotCheck() is first called. */
  #botCheckListeners: (() => void)[] = [];
  #noticeId = 0;

  // -- for presets ----------------------------------------------------------------

  /**
   * Puts the sample wallet in this browser, as on a later visit. A "words"
   * wallet is always unlocked. Whether the browser agreed to keep the
   * page's data is not known then: the real wallet asks only when it makes
   * or restores a wallet (justCreated, and the actions below, say so).
   */
  haveWallet(kind: 'passkey' | 'words', unlocked = false): void {
    this.status = 'ready';
    this.record = sampleRecord(kind, Date.now());
    this.unlocked = kind === 'words' || unlocked;
    this.persisted = null;
  }

  /**
   * The wallet that is here was made on this page a moment ago: Backup
   * opens as the "Wallet made" step. A passkey's whole name is known (this
   * page wrote it), and for a wallet made without one the browser has
   * agreed to keep the page's data.
   */
  justCreated(kind: 'passkey' | 'words'): void {
    this.created = kind;
    this.createdName = kind === 'passkey' ? nameGiven() : null;
    if (kind === 'words') this.persisted = true;
  }

  /** The wallet has been scanned: `state` is what was found, checked 20 seconds ago. */
  haveCoins(state: WalletState, history: TxView[]): void {
    this.chain = { ...NO_CHAIN, state, checkedAt: Date.now() - 20_000, tip: TIP };
    this.receive = this.#receiveAt(state.nextReceiveIndex);
    // The history is not loaded yet: watch() loads it for a screen that shows
    // activity. If such a screen is open already, it starts loading now.
    this.history = null;
    this.#historyToLoad = history;
    if (this.watching !== null) this.watch(this.watching);
  }

  // -- how an action ends -----------------------------------------------------------

  #answer(key: string): string {
    return this.answers[key] ?? ANSWERS[key]?.[0] ?? '';
  }

  #wait(): Promise<void> {
    return sleep(this.delay);
  }

  #say(notice: { kind: 'coins-arrived'; sats: bigint } | { kind: Exclude<Notice['kind'], 'coins-arrived'> }): void {
    this.#noticeId += 1;
    this.notice = { id: this.#noticeId, ...notice };
  }

  #receiveAt(index: number): ReceiveView {
    return { address: ownAddress(0, index).address, index, arrived: 0n };
  }

  /** A wallet has just been made or opened here: its first scan runs, then finds `state`. */
  #scanFor(state: WalletState, history: TxView[]): void {
    this.chain = { ...NO_CHAIN, scanning: true };
    this.receive = null;
    this.history = null;
    void this.#wait().then(() => {
      if (this.status === 'ready') this.haveCoins(state, history);
    });
  }

  #forget(): void {
    this.status = 'none';
    this.record = null;
    this.unlocked = false;
    this.created = null;
    this.createdName = null;
    this.setup = null;
    this.pendingSwitch = null;
    this.pendingRestore = false;
    this.openedEmpty = false;
    this.chain = NO_CHAIN;
    this.history = null;
    this.#historyToLoad = null;
    this.receive = null;
    this.faucet = IDLE;
  }

  /**
   * A wallet arrived in this browser from another tab while an action of
   * this page was under way: the action answers "exists", and the wallet is
   * already what the properties show, as with the real wallet.
   */
  #arrived(): void {
    this.haveWallet('words');
    this.#scanFor(fundedState(), sampleHistory(Date.now()));
  }

  /** Another tab put another passkey's wallet in this one's place: it is here now, locked, and being looked up. */
  #replaced(): void {
    this.record = { ...sampleRecord('passkey', Date.now()), fingerprint: OTHER_FINGERPRINT, tag: OTHER_TAG };
    this.unlocked = false;
    this.created = null;
    this.createdName = null;
    this.pendingSwitch = null;
    this.openedEmpty = false;
    this.#scanFor(emptyState(), []);
    // The real wallet announces it: the frame of the screen that is open says and shows it.
    this.#say({ kind: 'replaced' });
  }

  /** What an action answers when it could not store a wallet, with what the real wallet then shows. */
  #cannotStore(answer: 'exists' | 'no-storage'): { kind: 'exists' | 'no-storage' } {
    if (answer === 'exists') this.#arrived();
    else this.canStore = false;
    return { kind: answer };
  }

  // -- making and opening a wallet --------------------------------------------------

  async #create(key: 'create' | 'finish'): Promise<CreateResult> {
    const answer = this.#botCheck ? 'reload' : this.#answer(key);
    await this.#wait();
    const failure = passkeyFailure(answer);
    // A passkey that cannot give its secret is of no use: the real wallet forgets it, and nothing waits to be finished.
    if (answer === 'no-prf') this.setup = null;
    if (failure) return failure;
    if (answer === 'unfinished') {
      this.setup = { tag: TAG };
      return { kind: 'unfinished' };
    }
    if (answer === 'exists' || answer === 'no-storage') {
      // Nothing is left to finish beside a wallet that has arrived.
      if (answer === 'exists') this.setup = null;
      return this.#cannotStore(answer);
    }
    this.setup = null;
    this.haveWallet('passkey', true);
    this.justCreated('passkey');
    this.#scanFor(emptyState(), []);
    return { kind: 'created' };
  }

  createWithPasskey(): Promise<CreateResult> {
    return this.#create('create');
  }

  finishSetup(): Promise<CreateResult> {
    return this.#create('finish');
  }

  async createWithWords(): Promise<CreateResult> {
    const answer = this.#botCheck ? 'reload' : this.#answer('createWords');
    await this.#wait();
    if (answer === 'exists' || answer === 'no-storage') return this.#cannotStore(answer);
    if (answer === 'reload' || answer === 'broken') return { kind: answer };
    this.haveWallet('words');
    this.justCreated('words');
    this.#scanFor(emptyState(), []);
    return { kind: 'created' };
  }

  ackCreated(): void {
    this.created = null;
    this.createdName = null;
  }

  async openWithPasskey(): Promise<OpenResult> {
    const answer = this.#botCheck ? 'reload' : this.#answer('open');
    await this.#wait();
    const failure = passkeyFailure(answer);
    if (failure) return failure;
    if (answer === 'exists' || answer === 'no-storage') return this.#cannotStore(answer);
    this.haveWallet('passkey', true);
    if (answer === 'opened-empty') {
      this.openedEmpty = true;
      this.#scanFor(emptyState(), []);
    } else {
      this.#scanFor(fundedState(), sampleHistory(Date.now()));
    }
    return { kind: 'opened' };
  }

  async unlock(how: 'stored' | 'picker' = 'stored'): Promise<UnlockResult> {
    if (this.record === null) return { kind: 'gone' };
    if (this.record.kind === 'words') return { kind: 'unlocked' };
    // "stored" asks nothing of a wallet whose keys are loaded already. "picker" always opens the prompt.
    if (how !== 'picker' && this.unlocked && !this.#botCheck) return { kind: 'unlocked' };
    const answer = this.#botCheck ? 'reload' : this.#answer('unlock');
    // An earlier offer to switch wallets is over once the reader asks again.
    this.pendingSwitch = null;
    await this.#wait();
    const failure = passkeyFailure(answer);
    if (failure) return failure;
    switch (answer) {
      case 'other-passkey': {
        const other = { tag: OTHER_TAG, fingerprint: OTHER_FINGERPRINT };
        this.pendingSwitch = other;
        return { kind: 'other-passkey', ...other };
      }
      case 'changed':
        return { kind: 'changed' };
      case 'gone':
        this.#forget();
        return { kind: 'gone' };
      case 'replaced':
        this.#replaced();
        return { kind: 'gone' };
      default:
        this.unlocked = true;
        this.#say({ kind: 'unlocked' });
        return { kind: answer === 'tampered' ? 'tampered' : 'unlocked' };
    }
  }

  unlockWithWords(words: string): UnlockWordsResult {
    let answer = this.#botCheck ? 'reload' : this.#answer('unlockWords');
    if (answer === 'check') {
      if (!this.checkWords(words).valid) answer = 'invalid';
      else answer = normalizeMnemonic(words) === WORDS ? 'unlocked' : 'other-wallet';
    }
    if (answer === 'gone') this.#forget();
    if (answer !== 'unlocked' && answer !== 'tampered') return answer as UnlockWordsResult;
    this.unlocked = true;
    this.#say({ kind: 'unlocked' });
    return answer;
  }

  confirmSwitch(): SwitchResult {
    if (this.pendingSwitch === null) return 'nothing-pending';
    const answer = this.#answer('switch');
    if (answer === 'no-storage') {
      // The browser would not store the change. The offer stays, and can be confirmed again.
      this.canStore = false;
      return 'no-storage';
    }
    this.pendingSwitch = null;
    if (answer === 'gone') this.#forget();
    if (answer !== 'switched') return answer as SwitchResult;
    // The other wallet is now this browser's, unlocked, and empty. It was not "just opened":
    // whatever was said about the wallet before it is over.
    this.record = { ...sampleRecord('passkey', Date.now()), fingerprint: OTHER_FINGERPRINT, tag: OTHER_TAG };
    this.unlocked = true;
    this.openedEmpty = false;
    this.created = null;
    this.createdName = null;
    this.#scanFor(emptyState(), []);
    this.#say({ kind: 'unlocked' });
    return 'switched';
  }

  cancelSwitch(): void {
    this.pendingSwitch = null;
  }

  checkWords(input: string): WordsCheck {
    const text = normalizeMnemonic(input);
    return {
      words: text === '' ? [] : text.split(' '),
      unknown: unknownWords(text),
      valid: isValidMnemonic(text),
    };
  }

  async restore(words: string): Promise<RestoreResult> {
    let answer = this.#botCheck ? 'reload' : this.#answer('restore');
    if (answer === 'check') answer = this.checkWords(words).valid ? 'restored' : 'invalid';
    if (answer === 'invalid') return { kind: 'invalid' };
    await this.#wait();
    switch (answer) {
      case 'empty':
        this.pendingRestore = true;
        return { kind: 'empty' };
      case 'failed':
        return { kind: 'failed', reason: 'unavailable' };
      case 'exists':
      case 'no-storage':
        return this.#cannotStore(answer);
      case 'reload':
      case 'broken':
        return { kind: answer };
      default:
        this.haveWallet('words');
        // The browser is asked to keep the page's data when a wallet is stored, and here it agrees.
        this.persisted = true;
        this.haveCoins(fundedState(), sampleHistory(Date.now()));
        return { kind: 'restored' };
    }
  }

  keepRestored(): KeepResult {
    if (!this.pendingRestore) return 'nothing-pending';
    const answer = this.#answer('keep');
    if (answer === 'no-storage') {
      // The browser would not store the words. They go on waiting, as with the real wallet.
      this.canStore = false;
      return 'no-storage';
    }
    this.pendingRestore = false;
    if (answer === 'exists') {
      this.#arrived();
      return 'exists';
    }
    this.haveWallet('words');
    this.persisted = true;
    this.haveCoins(emptyState(), []);
    return 'restored';
  }

  eraseRestored(): void {
    this.pendingRestore = false;
  }

  // -- keys ---------------------------------------------------------------------------

  lock(): void {
    // A question about another passkey's wallet is over when the wallet is locked.
    this.pendingSwitch = null;
    if (this.record?.kind !== 'passkey' || !this.unlocked) return;
    this.unlocked = false;
    this.#say({ kind: 'locked' });
  }

  revealWords(): string[] | null {
    if (this.#answer('reveal') === 'none') return null;
    return this.status === 'ready' && this.unlocked ? WORDS.split(' ') : null;
  }

  removeWallet(): 'removed' | 'gone' {
    if (this.status !== 'ready' && this.status !== 'unreadable') return 'gone';
    if (this.#answer('remove') === 'gone') return 'gone';
    this.#forget();
    return 'removed';
  }

  descriptors(): { receive: string; change: string } | null {
    if (this.record === null || this.#answer('descriptors') === 'none') return null;
    return {
      receive: accountDescriptor(ACCOUNT.masterFingerprint, ACCOUNT.xpub, 0),
      change: accountDescriptor(ACCOUNT.masterFingerprint, ACCOUNT.xpub, 1),
    };
  }

  // -- the chain ------------------------------------------------------------------------

  watch(screen: Route['name'] | null): void {
    this.watching = screen;
    // The history loads when a screen that shows activity is first watched.
    // After a read that failed it waits for refresh(), as the real list waits for its next try.
    if (!this.#showsActivity() || this.history !== null || this.historyError !== null) return;
    if (this.#historyToLoad === null || this.#historyLoading) return;
    // The list stays where lookupTx() can find a transaction in it until it is handed over: the
    // real wallet asks the network about a transaction whether or not its list has been read.
    this.#historyLoading = true;
    void this.#wait().then(() => {
      this.#historyLoading = false;
      const history = this.#historyToLoad;
      if (this.status !== 'ready' || history === null) return;
      this.#historyToLoad = null;
      this.history = history;
    });
  }

  /** True while a screen that shows the wallet's transactions is open. */
  #showsActivity(): boolean {
    return this.watching === 'wallet' || this.watching === 'activity' || this.watching === 'tx';
  }

  async refresh(): Promise<void> {
    if (this.status !== 'ready') return;
    const answer = this.#answer('refresh');
    this.chain = { ...this.chain, scanning: true };
    await this.#wait();
    if (answer !== 'ok') {
      this.chain = { ...this.chain, scanning: false, error: answer as ApiFailure, retryAt: Date.now() + 15_000 };
      return;
    }
    this.chain = {
      ...this.chain,
      state: this.chain.state ?? emptyState(),
      scanning: false,
      error: null,
      checkedAt: Date.now(),
      retryAt: null,
      tip: TIP,
    };
    this.receive ??= this.#receiveAt(this.chain.state?.nextReceiveIndex ?? 0);
    // As with the real wallet: the list of transactions is read again too, where a screen shows
    // it, and the caller's wait ends when that read has ended.
    if (!this.#showsActivity()) return;
    const list = this.#answer('list');
    await this.#wait();
    if (this.status !== 'ready') return;
    if (list !== 'ok') {
      // The list as it was last read stays, with the reason beside it.
      this.historyError = list as ApiFailure;
      return;
    }
    this.history = [...(this.#historyToLoad ?? this.history ?? [])];
    this.#historyToLoad = null;
    this.historyError = null;
  }

  async lookupTx(txid: string): Promise<TxLookup> {
    let answer = this.#answer('lookup');
    await this.#wait();
    const view = (this.history ?? this.#historyToLoad ?? []).find((tx) => tx.txid === txid);
    if (answer === 'check') answer = view ? 'found' : 'not-found';
    if (answer === 'found') return view ? { kind: 'found', view } : { kind: 'not-found' };
    if (answer === 'waiting' || answer === 'not-found') return { kind: answer };
    return { kind: 'failed', reason: answer as ApiFailure };
  }

  // -- receiving ------------------------------------------------------------------------

  newReceiveAddress(): void {
    const busy = this.faucet.phase === 'checking' || this.faucet.phase === 'asking' || this.faucet.phase === 'waiting';
    if (this.receive === null || busy) return;
    this.receive = this.#receiveAt(this.receive.index + 1);
    this.faucet = IDLE;
  }

  beforeBotCheck(): void {
    const told = this.#botCheck;
    this.#botCheck = true;
    // Typed words and another wallet's words go, whatever kind of wallet is here.
    this.pendingRestore = false;
    this.pendingSwitch = null;
    // A passkey wallet's keys go too, and the reader is told, as when they lock it themselves.
    if (this.record?.kind === 'passkey' && this.unlocked) {
      this.unlocked = false;
      this.#say({ kind: 'locked' });
    }
    // Each listener is told once, as by the real wallet.
    if (!told) for (const listener of this.#botCheckListeners) listener();
  }

  /**
   * Not part of WalletApi: it stands in for what the real wallet.svelte.ts
   * exports beside `wallet`. `listener` is called when beforeBotCheck() is
   * first called. The gallery's main.ts hands the router's
   * fullLoadsFromNowOn here, as the app's main.ts does with the real wallet.
   */
  onBotCheck(listener: () => void): void {
    this.#botCheckListeners.push(listener);
    // Added after the fact: told at once.
    if (this.#botCheck) listener();
  }

  /**
   * The bot check is never run here: the token source is not called, and the
   * phases come from the script alone. So nothing outside this page is asked
   * for, unless the screen loads the bot check's script before the wallet
   * asks for a token.
   */
  async askFaucet(_getToken: TokenSource): Promise<void> {
    const receive = this.receive;
    const { phase } = this.faucet;
    // One request at a time. After one has ended, the reader may ask again.
    const running = phase === 'checking' || phase === 'asking' || phase === 'waiting' || phase === 'on-its-way';
    if (receive === null || running) return;
    // The real wallet drops a passkey wallet's keys before the bot check runs, whoever asks the faucet.
    this.beforeBotCheck();
    const answer = this.#answer('faucet');
    this.faucet = { ...IDLE, phase: 'checking' };
    await this.#wait();
    this.faucet = { ...IDLE, phase: 'asking' };
    await this.#wait();
    if (answer === 'already_paid') {
      // The faucet has paid this address before: the coin is on its way or already here, and no payment comes with the answer.
      this.faucet = { ...IDLE, phase: 'on-its-way' };
      return;
    }
    if (answer === 'busy' || answer === 'refilling' || answer === 'limit') {
      // Refused for now: the wallet waits, then asks again by itself, and is paid.
      this.faucet = { ...IDLE, phase: 'waiting', failure: answer, retryAt: Date.now() + 20_000 };
      await sleep(20_000);
    } else if (answer !== 'ok' && answer !== 'ok-pot') {
      this.faucet = { ...IDLE, phase: 'failed', failure: answer as FaucetFailure };
      return;
    }
    const payment: FaucetPayment = {
      txid: TXID.faucetNew,
      amountSats: this.config.faucetSats,
      potTxid: answer === 'ok-pot' ? TXID.pot : null,
    };
    this.faucet = { ...IDLE, phase: 'on-its-way', payment };
    // The request is promised: the caller's wait ends here. The coin arrives, then confirms.
    void this.#coinArrives(receive, payment);
  }

  async #coinArrives(receive: ReceiveView, payment: FaucetPayment): Promise<void> {
    const sats = BigInt(payment.amountSats);
    const at = ownAddress(0, receive.index, true);
    /** Puts the faucet's coin in the wallet, unconfirmed at first and then in a block. */
    const hold = (confirmed: boolean): void => {
      const state = this.chain.state ?? emptyState();
      const coins = [
        ...state.coins.filter((c) => c.txid !== payment.txid),
        {
          txid: payment.txid,
          vout: 0,
          value: sats,
          status: confirmed ? { confirmed: true, block_height: TIP + 1 } : { confirmed: false },
          chain: at.chain,
          index: at.index,
          address: at.address,
          script: at.script,
        },
      ];
      this.chain = {
        ...this.chain,
        state: {
          ...state,
          coins,
          nextReceiveIndex: Math.max(state.nextReceiveIndex, at.index + 1),
          ...coinTotals(coins),
        },
        checkedAt: Date.now(),
        tip: confirmed ? TIP + 1 : this.chain.tip,
      };
    };
    await sleep(this.delay * 2);
    if (this.status !== 'ready') return;
    hold(false);
    if (this.receive?.index === receive.index) this.receive = { ...this.receive, arrived: sats };
    this.faucet = { ...IDLE, phase: 'arrived', payment };
    this.#say({ kind: 'coins-arrived', sats });
    await sleep(this.delay * 4);
    if (this.status !== 'ready') return;
    hold(true);
    this.faucet = { ...IDLE, phase: 'confirmed', payment };
    this.#say({ kind: 'confirmed' });
  }

  // -- sending --------------------------------------------------------------------------

  /** The real planner, on the sample wallet's coins. */
  plan(request: PaymentRequest): PaymentPlan {
    const refused: PaymentPlan = { ok: false, reason: 'nothing-spendable', maxSendable: 0n, dust: null };
    if (this.record === null || this.chain.state === null) return refused;
    try {
      return planPayment(watchOnlyAccount(this.record.xpub), this.chain.state, request);
    } catch {
      return refused;
    }
  }

  /** The real signer, with the sample wallet's keys. Nothing is sent. */
  sign(request: PaymentRequest): SignResult {
    if (!this.unlocked || this.chain.state === null) return { ok: false, reason: 'locked' };
    const answer = this.#answer('sign');
    if (answer !== 'ok') return { ok: false, reason: answer as PlanFailure };
    const plan = this.plan(request);
    if (!plan.ok) return { ok: false, reason: plan.reason };
    try {
      const payment = signPayment(ACCOUNT.key, this.chain.state, request);
      return { ok: true, payment, view: viewPayment(payment, ownAddresses(this.chain.state)) };
    } catch {
      return { ok: false, reason: 'too-much' };
    }
  }

  async broadcast(payment: SignedPayment): Promise<BroadcastResult> {
    const answer = this.#answer('broadcast');
    await this.#wait();
    if (answer !== 'ok') {
      const reason = answer as BroadcastFailure;
      // The node's own words come with a refusal it made itself.
      const detail = (BROADCAST_REFUSALS as readonly string[]).includes(reason) ? 'bad-txns-inputs-missingorspent' : null;
      return { ok: false, reason, detail };
    }
    const state = this.chain.state;
    if (state !== null) {
      const view = viewPayment(payment, ownAddresses(state));
      this.chain = { ...this.chain, state: applyPayment(state, payment), checkedAt: Date.now() };
      if (this.history !== null) this.history = [view, ...this.history];
      else if (this.#historyToLoad !== null) this.#historyToLoad = [view, ...this.#historyToLoad];
    }
    this.#say({ kind: 'payment-sent' });
    return { ok: true, txid: payment.txid };
  }

  async potAddress(): Promise<PotAddressResult> {
    const answer = this.#answer('pot');
    await this.#wait();
    if (answer !== 'ok') return { ok: false, reason: answer as ApiFailure };
    return { ok: true, address: POT_ADDRESS };
  }
}

// -- presets ------------------------------------------------------------------------

/** A preset puts a new stand-in into one state. */
export type Preset = (wallet: StandIn) => void;

// Every file under presets/ that exports `presets` is part of the list. A
// file per screen, and no shared list to edit.
const files = import.meta.glob<{ presets?: Record<string, Preset> }>('./presets/*.ts', { eager: true });

/** Every preset, by name. A name that two files both use stops the page: neither would know which one it got. */
export const PRESETS: Record<string, Preset> = {};
for (const file of Object.keys(files).sort()) {
  for (const [name, preset] of Object.entries(files[file]?.presets ?? {})) {
    if (Object.hasOwn(PRESETS, name)) throw new Error(`stand-in: the preset "${name}" is in two files; the second is ${file}`);
    PRESETS[name] = preset;
  }
}

// -- the factory --------------------------------------------------------------------

/** What is laid over a preset. */
export interface Overrides {
  /** The kind of wallet, where the preset has one. */
  kind?: 'passkey' | 'words';
  /** A passkey wallet's lock. */
  unlocked?: boolean;
  /** Whether this browser offers passkeys. Null: not known yet. */
  passkeys?: boolean | null;
  /** False: the browser refuses to store anything. */
  storage?: boolean;
  /** False: the settings name no bot check, so the faucet is closed. */
  botCheck?: boolean;
  /** True: the settings say events are wanted, so App.svelte counts screen views. */
  events?: boolean;
  /** How long an action takes, in milliseconds. */
  delay?: number;
  /** Where the request for the Worker's settings stands. Anything but "loaded": the built-in settings stand. */
  settings?: SettingsState;
  /** How each action ends, by action key (see the top of this file). */
  answers?: Record<string, string>;
}

function fail(message: string): never {
  throw new Error(`stand-in: ${message}`);
}

/** A stand-in wallet in the state `preset` names, with `overrides` laid over it. Throws on a name it does not know. */
export function makeStandIn(preset = 'none', overrides: Overrides = {}): StandIn {
  const apply = PRESETS[preset];
  if (!apply) fail(`no preset "${preset}". There are: ${Object.keys(PRESETS).join(', ')}`);
  const wallet = new StandIn();
  apply(wallet);

  // Only when the address asks for another kind of wallet or another lock: put in place a second
  // time, the wallet would lose what the preset set on it (a record without a tag, a lock, what
  // the browser said about keeping the page's data).
  if (wallet.record !== null && (overrides.kind !== undefined || overrides.unlocked !== undefined)) {
    const kind = overrides.kind ?? wallet.record.kind;
    const unlocked = overrides.unlocked ?? wallet.unlocked;
    wallet.haveWallet(kind, unlocked);
  }
  if (overrides.settings !== undefined) {
    wallet.settings = overrides.settings;
    if (overrides.settings !== 'loaded') {
      // The Worker's settings are not here, so the built-in ones stand: no bot check, nothing counted.
      wallet.config = { ...DEFAULT_CONFIG };
      // The browser is asked about passkeys only once the request for the settings has ended.
      if (overrides.settings === 'loading') wallet.passkeyOffered = null;
    }
  }
  if (overrides.passkeys !== undefined) wallet.passkeyOffered = overrides.passkeys;
  if (overrides.storage !== undefined) wallet.canStore = overrides.storage;
  if (overrides.botCheck === false) wallet.config = { ...wallet.config, turnstileSiteKey: '' };
  if (overrides.events !== undefined) wallet.config = { ...wallet.config, events: overrides.events };
  if (overrides.delay !== undefined) wallet.delay = overrides.delay;

  for (const [key, answer] of Object.entries(overrides.answers ?? {})) {
    const allowed = ANSWERS[key];
    if (!allowed) fail(`no action "${key}". There are: ${Object.keys(ANSWERS).join(', ')}`);
    if (!allowed.includes(answer)) fail(`${key}=${answer} is not a way "${key}" can end. There are: ${allowed.join(', ')}`);
    wallet.answers[key] = answer;
  }
  return wallet;
}

const YES_NO: Record<string, boolean> = { yes: true, no: false };

/** Reads a page's query string ("?state=funded&unlock=cancelled") into a preset name and its overrides. */
export function fromQuery(search: string): { preset: string; overrides: Overrides } {
  const query = new URLSearchParams(search);
  const overrides: Overrides = { answers: {} };
  let preset = 'none';
  for (const [key, value] of query) {
    const yesNo = YES_NO[value];
    if (key === 'state') preset = value;
    else if (key === 'kind' && (value === 'passkey' || value === 'words')) overrides.kind = value;
    else if (key === 'unlocked' && yesNo !== undefined) overrides.unlocked = yesNo;
    else if (key === 'passkeys' && (yesNo !== undefined || value === 'unknown')) overrides.passkeys = yesNo ?? null;
    else if (key === 'storage' && value === 'no') overrides.storage = false;
    else if (key === 'settings' && (value === 'loading' || value === 'failed' || value === 'loaded')) overrides.settings = value;
    else if (key === 'botcheck' && value === 'none') overrides.botCheck = false;
    else if (key === 'events' && value === 'yes') overrides.events = true;
    else if (key === 'delay' && /^[0-9]+$/.test(value)) overrides.delay = Number(value);
    else if (Object.hasOwn(ANSWERS, key)) overrides.answers = { ...overrides.answers, [key]: value };
    else fail(`the query string says ${key}=${value}, which is not a key and value the stand-in knows`);
  }
  return { preset, overrides };
}
