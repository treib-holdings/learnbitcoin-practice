// The wallet's coins, as the practice network reports them.
//
// A wallet keeps no balance of its own. It asks the network which of its
// addresses have been paid, and adds up the coins it finds there. This file
// decides when to ask:
//
//   - a full scan (every address, 40 requests or more) when a wallet arrives
//     in the page, when the reader asks for one, and when a light refresh
//     finds a payment at an address that counted as unused;
//   - a light refresh (the addresses in use and the few after them) when the
//     chain has a new block, when an address on screen has been paid, and
//     straight after a payment of the wallet's own;
//   - nothing by itself while the tab is hidden or no wallet screen is open:
//     no poll, and no second try after a read that failed.
//
// It sets a limit to how long an answer may take (withDeadline): a request
// that gets none is given up, so that nothing waits behind it for ever.
//
// It also keeps what follows from the coins: the address the Receive screen
// shows, the list of transactions, the outcomes worth announcing, and what a
// payment would cost. It needs only the account's public key, so all of it
// works while the wallet is locked. Signing is session.ts's business.
//
// Three modules make up the wallet's engine: this one, session.ts and
// faucet-flow.ts. None of them touches the page. Each is handed what it
// needs (the API client, a clock, timers) and shows its state the same way,
// as a Published value: a snapshot, and a call whenever the snapshot is
// replaced. wallet.svelte.ts copies those snapshots to where the screens
// read them.

import { API, BROADCAST_REFUSALS, type CountedEvent, type ValueOf } from '@learnbitcoin/practice-contract';
import {
  LOOKAHEAD,
  applyPayment,
  deriveAddress,
  ownAddresses,
  planPayment,
  refreshWallet,
  scanWallet,
  viewTx,
  walletHistory,
  watchOnlyAccount,
  type Coin,
  type EsploraAddress,
  type FetchLike,
  type HDKey,
  type PaymentPlan,
  type PaymentRequest,
  type SignedPayment,
  type TxView,
  type WalletState,
} from '@learnbitcoin/practice-wallet';
import { broadcastFailure, failureOf, type ApiFailure, type BroadcastFailure, type PracticeApi } from './api.ts';
import { needsWallet, type Route } from './router.ts';
import type { BroadcastResult, ChainView, Notice, PotAddressResult, ReceiveView, TxLookup } from './wallet-api.ts';

// -- how a module shows its state ---------------------------------------------

/**
 * A value that changes, and a way to hear that it has. The snapshot is never
 * altered in place: a change puts a new object there, and a part that did
 * not change is the same object as before. So whoever copies the parts can
 * tell what changed by comparing them.
 */
export interface Published<T> {
  /** The state as it stands. Treat it as frozen. */
  view(): T;
  /** Calls `listener` after every change. The function it returns stops the calls. */
  subscribe(listener: () => void): () => void;
}

/** The writing side of a Published value. Each module keeps this to itself. */
export interface Board<T> extends Published<T> {
  /** Puts new values in some fields. Listeners are called only if a field really changed. */
  set(patch: Partial<T>): void;
}

export function makeBoard<T extends object>(first: T): Board<T> {
  let current = first;
  const listeners = new Set<() => void>();
  return {
    view: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(patch) {
      const keys = Object.keys(patch) as (keyof T)[];
      if (keys.every((key) => Object.is(current[key], patch[key]))) return;
      current = { ...current, ...patch };
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // A listener's fault is its own: the others are still told.
        }
      }
    },
  };
}

// -- what the caller passes in ------------------------------------------------

/** setTimeout and clearTimeout, or a test's stand-ins for them. */
export interface Timers {
  /** Runs `run` once, `ms` from now. Returns whatever clear() needs to stop it. */
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** events.ts's track(): one counted event, held by the compiler to the contract's closed list. */
export type Track = <N extends CountedEvent>(name: N, value: ValueOf<N>) => void;

export interface ChainDeps {
  /** The app's client for its Worker (makeApi). */
  api: PracticeApi;
  /** The time in ms since 1970. */
  now: () => number;
  timers: Timers;
  /** Whether the tab is in view. Call visibilityChanged() whenever the answer changes. */
  visible: () => boolean;
  track: Track;
  /** Seconds between practice blocks (the settings' blockSeconds), read each time it is needed. */
  blockSeconds: () => number;
}

// -- how long a request may take ----------------------------------------------

/**
 * How long a request may go without an answer before the page gives up on
 * it, in ms. The Worker gives the practice network 8 seconds, so an answer
 * that is coming at all is here long before this.
 */
export const REQUEST_MS = 20_000;

/**
 * The same for the faucet's request. The Worker waits up to 8 seconds for
 * the bot check's verdict, and then up to 25 for the faucet.
 */
export const FAUCET_REQUEST_MS = 40_000;

/**
 * A fetch that gives up. The browser's own fetch has no time limit: while
 * the connection stays open, a request that gets no answer waits for ever.
 * The engine does one thing of a kind at a time (one scan, one look, one
 * broadcast, one restore, one faucet request), so a single request without
 * an answer would hold that part of the wallet until the page is reloaded.
 *
 * `giveUpAfter` makes the signal that ends a request after so many ms: in
 * the browser, AbortSignal.timeout. A request ended that way rejects, and
 * the client reads that as "network", no answer (api.ts). Where no such
 * signal can be made, the request goes out as it always did, with no limit.
 */
export function withDeadline(fetchFn: FetchLike, giveUpAfter: (ms: number) => AbortSignal): FetchLike {
  return (input, init) => {
    let signal: AbortSignal | undefined;
    try {
      signal = giveUpAfter(input === API.faucet ? FAUCET_REQUEST_MS : REQUEST_MS);
    } catch {
      signal = undefined;
    }
    return fetchFn(input, signal ? { ...init, signal } : init);
  };
}

// -- what it shows ------------------------------------------------------------

export interface ChainSnapshot {
  /** Counts up every time the wallet being watched changes: opened, replaced or closed. */
  wallet: number;
  chain: ChainView;
  history: TxView[] | null;
  historyError: ApiFailure | null;
  receive: ReceiveView | null;
  notice: Notice | null;
}

/** What the first scan of a wallet found. `history`: some address of the wallet has been used. */
export interface FirstScan {
  history: boolean;
}

/** A scan of an account that is not (yet) the wallet in this page. */
export type Probe = { ok: true; state: WalletState } | { ok: false; reason: ApiFailure };

export interface ChainSync extends Published<ChainSnapshot> {
  /**
   * The wallet in this page is now the one with this public key. Everything
   * known about the wallet before it is dropped, and its first scan starts.
   * With `seed` (a scan made a moment ago, as restore makes one) that scan is
   * taken as the first. Resolves once the first scan has finished, however
   * many tries that takes, or with null if the wallet left the page first.
   */
  open(xpub: string, seed?: WalletState): Promise<FirstScan | null>;
  /** No wallet is here now: everything known is dropped and nothing is read. */
  close(): void;
  /** Scans an account without showing anything: restore looks before it stores. Never throws. */
  probe(xpub: string): Promise<Probe>;
  /** The coins as last read. Null until the first scan has finished. */
  state(): WalletState | null;

  watch(screen: Route['name'] | null): void;
  /** Call when the tab goes out of view or comes back. */
  visibilityChanged(): void;
  refresh(): Promise<void>;
  lookupTx(txid: string): Promise<TxLookup>;

  newReceiveAddress(): void;
  /** While held, newReceiveAddress() does nothing: the faucet has been asked to pay the address on screen. */
  holdReceive(hold: boolean): void;

  plan(request: PaymentRequest): PaymentPlan;
  broadcast(payment: SignedPayment): Promise<BroadcastResult>;
  potAddress(): Promise<PotAddressResult>;

  /** A transaction ID the network was just given: for two minutes, "not found" for it means "not yet". */
  rememberTx(txid: string): void;
  /**
   * Puts an outcome of the session's (the wallet was unlocked, or locked, or another tab put a
   * different wallet in its place) where the screens announce outcomes.
   */
  announce(kind: 'unlocked' | 'locked' | 'replaced'): void;
  /** Resolves when nothing is on its way: no scan, no refresh, no list being read. For tests. */
  idle(): Promise<void>;
}

// -- constants ----------------------------------------------------------------

/** How often the height of the chain is read while a wallet screen is open, in ms. */
const TIP_MS = 15_000;
/** How often the address on the Receive screen is looked at, in ms. */
const ADDRESS_MS = 5_000;
/** How long to wait after a failure before trying again: 15 s, 30 s, then every 60 s. */
const BACKOFF_MS = [15_000, 30_000, 60_000] as const;
/** The practice network counts as slow once the chain has not grown for this many block intervals. */
const SLOW_AFTER_BLOCKS = 4;
/** How long a transaction the network was just given may still be unknown to it, in ms. */
const RECENT_MS = 120_000;

type Screen = Route['name'];

/** The screens that show the wallet's transactions. */
const ACTIVITY: ReadonlySet<Screen> = new Set<Screen>(['wallet', 'activity', 'tx']);

const NO_CHAIN: ChainView = Object.freeze({
  state: null,
  scanning: false,
  error: null,
  checkedAt: null,
  retryAt: null,
  tip: null,
  slow: false,
});

// -- small helpers ------------------------------------------------------------

/** Whether a screen shows a wallet. Only those screens are worth reading the network for. */
function walletScreen(screen: Screen | null): boolean {
  if (screen === null) return false;
  return needsWallet(screen === 'tx' ? { name: 'tx', txid: '' } : { name: screen });
}

function coinKey(coin: { txid: string; vout: number }): string {
  return `${coin.txid}:${coin.vout}`;
}

/** The same coins, each confirmed or not as before (and in the same block). */
function sameCoins(a: Coin[], b: Coin[]): boolean {
  if (a.length !== b.length) return false;
  const mark = (coin: Coin) => `${coinKey(coin)}:${coin.status.confirmed ? (coin.status.block_height ?? 'c') : 'u'}`;
  const had = new Set(a.map(mark));
  return b.every((coin) => had.has(mark(coin)));
}

/** The same coins, the same addresses in use and the same next addresses: nothing a screen could show has changed. */
function sameWallet(a: WalletState, b: WalletState): boolean {
  const used = (state: WalletState) =>
    [state.receive, state.change].map((list) => `${list.length}/${list.filter((address) => address.used).map((address) => address.index).join(',')}`).join('|');
  return (
    a.nextReceiveIndex === b.nextReceiveIndex &&
    a.nextChangeIndex === b.nextChangeIndex &&
    used(a) === used(b) &&
    sameCoins(a.coins, b.coins)
  );
}

function sameFields<T extends object>(a: T, b: T): boolean {
  return (Object.keys(a) as (keyof T)[]).every((key) => Object.is(a[key], b[key]));
}

/** Whether a scan found any sign of use: a coin, or an address that has ever been paid. */
export function hasHistory(state: WalletState): boolean {
  return state.coins.length > 0 || state.receive.some((address) => address.used) || state.change.some((address) => address.used);
}

/** What plan() answers when there is nothing to plan with. A fresh object each time. */
function nothingSpendable(): PaymentPlan {
  return { ok: false, reason: 'nothing-spendable', maxSendable: 0n, dust: null };
}

/**
 * planPayment, made safe to call from a screen: with no coins read yet the
 * answer is "nothing-spendable", and so it is if the wallet package throws
 * (it should not, for anything a form can ask).
 */
export function safePlan(account: HDKey, state: WalletState | null, request: PaymentRequest): PaymentPlan {
  if (state === null) return nothingSpendable();
  try {
    return planPayment(account, state, request);
  } catch {
    return nothingSpendable();
  }
}

/** How many transactions touch an address, waiting ones included. Throws for an answer that is not Esplora's. */
function txCountOf(info: EsploraAddress): number {
  const count = info?.chain_stats?.tx_count + info?.mempool_stats?.tx_count;
  if (!Number.isSafeInteger(count)) throw new Error('Not an address answer');
  return count;
}

/**
 * A watch-only account from an account public key. "tpub" only: the same
 * kind of text can carry a private key ("tprv"), and this module has no
 * business holding one.
 */
function watchOnly(xpub: string): HDKey {
  if (typeof xpub !== 'string' || !xpub.startsWith('tpub')) throw new Error('Not an account public key');
  return watchOnlyAccount(xpub);
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** The address the Receive screen shows, and what has been seen of it. */
interface Shown {
  address: string;
  index: number;
  /** How many transactions touched it when it was last looked at. */
  txCount: number;
  /** The coins seen at it since it was first shown, so that none is counted twice. */
  seen: Set<string>;
  arrived: bigint;
  /** It has been paid, and the wallet's list of addresses does not say so yet: only a full scan puts that right. */
  wantScan: boolean;
}

/** A timer that is set, or null. */
type Timer = { handle: unknown } | null;

type NewNotice = { kind: 'coins-arrived'; sats: bigint } | { kind: 'confirmed' | 'payment-sent' | 'unlocked' | 'locked' | 'replaced' };

// -- the engine ---------------------------------------------------------------

export function makeChainSync(deps: ChainDeps): ChainSync {
  const esplora = deps.api.esplora;
  const board = makeBoard<ChainSnapshot>({
    wallet: 0,
    chain: NO_CHAIN,
    history: null,
    historyError: null,
    receive: null,
    notice: null,
  });

  // What is known about the wallet being watched. All of it starts again when the wallet changes.
  let wallet = 0;
  let account: HDKey | null = null;
  let state: WalletState | null = null;
  let error: ApiFailure | null = null;
  let checkedAt: number | null = null;
  let retryAt: number | null = null;
  let tip: number | null = null;
  /** When the tip was last seen to move, in ms. */
  let tipMovedAt = 0;
  let slow = false;
  /** How many reads in a row have failed. */
  let failures = 0;
  /** The full scan under way. */
  let scanning: Promise<void> | null = null;
  let scanId = 0;
  /** The lighter look under way: the tip, and perhaps the coins. */
  let checking: Promise<void> | null = null;
  let checkAgain = false;
  let firstScan: Deferred<FirstScan | null> | null = null;
  let shown: Shown | null = null;
  let held = false;
  let history: TxView[] | null = null;
  let historyError: ApiFailure | null = null;
  let historyStale = false;
  let historyLoading = false;
  /** Who is waiting for the read of the list that is under way to end (refresh). Each is called once, then dropped. */
  let historyWaiters: (() => void)[] = [];
  /** How many reads of the list have failed in a row, and when the next try is due, in ms. */
  let historyFailures = 0;
  let historyRetryAt: number | null = null;
  /** The payments this page has sent from this wallet, by ID. One that is sent twice is applied and announced once. */
  const sentHere = new Set<string>();
  /** The coins those payments spent, with when. For two minutes, a read that still lists one of them is behind. */
  const spentHere = new Map<string, number>();
  /** A read was dropped for being behind: the next poll reads the coins whatever the height says. */
  let behind = false;

  // What outlives a wallet.
  let screen: Screen | null = null;
  let notice: Notice | null = null;
  let noticeId = 0;
  let tipTimer: Timer = null;
  let addressTimer: Timer = null;
  let retryTimer: Timer = null;
  let historyTimer: Timer = null;
  /** Addresses of the pay-it-forward pot that were handed out here. */
  const pots = new Set<string>();
  /** Transaction IDs the network was given a moment ago, with when. */
  const recent = new Map<string, number>();
  /** The broadcast under way: which payment, and the answer it will get. */
  let sending: { txid: string | null; answer: Promise<BroadcastResult> } | null = null;
  const working = new Set<Promise<unknown>>();

  // -- the surroundings, read so that a fault in them cannot stop the engine ----

  const now = (): number => {
    try {
      const at = deps.now();
      return Number.isFinite(at) ? at : 0;
    } catch {
      return 0;
    }
  };

  const isVisible = (): boolean => {
    try {
      return deps.visible() !== false;
    } catch {
      return true;
    }
  };

  const blockMs = (): number => {
    try {
      const seconds = deps.blockSeconds();
      return (Number.isFinite(seconds) && seconds > 0 ? seconds : 30) * 1000;
    } catch {
      return 30_000;
    }
  };

  function count<N extends CountedEvent>(name: N, value: ValueOf<N>): void {
    try {
      deps.track(name, value);
    } catch {
      // Counting is never worth a failed action.
    }
  }

  function later(run: () => void, ms: number): Timer {
    try {
      return { handle: deps.timers.set(run, ms) };
    } catch {
      return null;
    }
  }

  function cancel(timer: Timer): null {
    if (timer !== null) {
      try {
        deps.timers.clear(timer.handle);
      } catch {
        // Nothing to stop.
      }
    }
    return null;
  }

  /** Keeps count of work that goes on after the call that started it has returned. */
  function job<T>(work: Promise<T>): Promise<T> {
    working.add(work);
    const done = () => {
      working.delete(work);
    };
    work.then(done, done);
    return work;
  }

  // -- showing ------------------------------------------------------------------

  let chainShown: ChainView = NO_CHAIN;
  let receiveShown: ReceiveView | null = null;

  /** Shows what the variables above hold. A part that has not changed stays the object it was. */
  function publish(): void {
    const chain: ChainView = { state, scanning: scanning !== null, error, checkedAt, retryAt, tip, slow };
    if (!sameFields(chain, chainShown)) chainShown = chain;
    const receive: ReceiveView | null =
      shown === null ? null : { address: shown.address, index: shown.index, arrived: shown.arrived };
    if (receive === null || receiveShown === null || !sameFields(receive, receiveShown)) receiveShown = receive;
    board.set({ wallet, chain: chainShown, history, historyError, receive: receiveShown, notice });
  }

  function notify(what: NewNotice): void {
    noticeId += 1;
    notice = what.kind === 'coins-arrived' ? { id: noticeId, kind: what.kind, sats: what.sats } : { id: noticeId, kind: what.kind };
    publish();
  }

  // -- which wallet -------------------------------------------------------------

  /** Drops everything known about the wallet that was here. Work still on its way for it will be ignored. */
  function forget(): void {
    wallet += 1;
    scanId += 1;
    account = null;
    state = null;
    error = null;
    checkedAt = null;
    retryAt = null;
    tip = null;
    slow = false;
    failures = 0;
    scanning = null;
    checking = null;
    checkAgain = false;
    shown = null;
    held = false;
    history = null;
    historyError = null;
    historyStale = false;
    historyLoading = false;
    historyEnded();
    historyFailures = 0;
    historyRetryAt = null;
    sentHere.clear();
    spentHere.clear();
    behind = false;
    recent.clear();
    stopTimers();
    const waiting = firstScan;
    firstScan = null;
    waiting?.resolve(null);
  }

  function open(xpub: string, seed?: WalletState): Promise<FirstScan | null> {
    forget();
    try {
      account = watchOnly(xpub);
    } catch {
      // Not a public key: there is nothing to watch.
      publish();
      return Promise.resolve(null);
    }
    const first = deferred<FirstScan | null>();
    firstScan = first;
    if (seed === undefined) {
      void fullScan();
    } else {
      try {
        take(seed, 'read');
        checkedAt = now();
      } catch {
        // A seed that cannot be used: scan as if there were none.
        state = null;
        shown = null;
        firstScan = first;
      }
      publish();
      // The seed says nothing about the chain's height.
      if (state === null) void fullScan();
      else void check('never').then(syncTimers);
    }
    return first.promise;
  }

  function close(): void {
    forget();
    publish();
  }

  async function probe(xpub: string): Promise<Probe> {
    try {
      return { ok: true, state: await scanWallet(watchOnly(xpub), esplora) };
    } catch (cause) {
      return { ok: false, reason: failureOf(cause) };
    }
  }

  // -- taking in what was read --------------------------------------------------

  /** The first receive address nobody has paid yet. */
  function firstUnused(from: WalletState, watch: HDKey): { address: string; index: number } {
    return from.receive.find((address) => !address.used) ?? deriveAddress(watch, 0, from.nextReceiveIndex);
  }

  function show(address: { address: string; index: number }): void {
    shown = { address: address.address, index: address.index, txCount: 0, seen: new Set(), arrived: 0n, wantScan: false };
  }

  /**
   * The wallet's coins as just read, or as a payment of the wallet's own
   * just left them. Decides what of the change is news.
   */
  function take(next: WalletState, how: 'read' | 'payment'): void {
    const before = state;
    state = next;

    // The Receive screen's address is chosen once, and then stays until the reader asks for another.
    if (shown === null && account !== null) show(firstUnused(next, account));
    const at = shown;
    if (at !== null) {
      for (const coin of next.coins) {
        if (coin.address !== at.address || at.seen.has(coinKey(coin))) continue;
        at.seen.add(coinKey(coin));
        at.arrived += coin.value;
      }
    }

    // News only once there is something to compare with, and never the wallet's own payment:
    // its change is not a coin that "arrived".
    if (before !== null && how === 'read') {
      const had = new Map(before.coins.map((coin) => [coinKey(coin), coin]));
      let arrived = 0n;
      let confirmed = false;
      for (const coin of next.coins) {
        const old = had.get(coinKey(coin));
        // A new coin on the change chain is what a payment made elsewhere left behind, not a payment received.
        if (old === undefined) arrived += coin.chain === 0 ? coin.value : 0n;
        else if (!old.status.confirmed && coin.status.confirmed) confirmed = true;
      }
      if (arrived > 0n) notify({ kind: 'coins-arrived', sats: arrived });
      else if (confirmed) notify({ kind: 'confirmed' });
    }

    if (before === null) {
      const first = firstScan;
      firstScan = null;
      first?.resolve({ history: hasHistory(next) });
    }
    historyStale = true;
    wantHistory();
  }

  /**
   * True when coins just read still include one that a payment of this page
   * spent in the last two minutes. Esplora hears of a transaction a moment
   * after the node has taken it, and until then it goes on listing the coins
   * the transaction spent. Shown, such a read would bring a spent coin back
   * and offer it for the next payment. (After two minutes a read is believed
   * again: a payment the network has dropped gives its coins back.)
   */
  function lagging(coins: Coin[]): boolean {
    const at = now();
    for (const [key, since] of spentHere) if (at - since > RECENT_MS) spentHere.delete(key);
    return spentHere.size > 0 && coins.some((coin) => spentHere.has(coinKey(coin)));
  }

  /**
   * A read of the coins is believed again. If reads were being dropped for
   * being behind, Esplora has now heard of the payment they lacked, and the
   * list of transactions can show it at last. The coins say nothing of that
   * when they compare equal to what the page already held: after "Send all"
   * the wallet was empty before the read and is empty after it. So the list
   * is marked out of date here, whatever the coins say.
   */
  function caughtUp(): void {
    if (behind) historyStale = true;
    behind = false;
  }

  /** The chain's height, checked: a number the rest can count with. */
  async function readTip(): Promise<number> {
    const height = await esplora.tipHeight();
    if (!Number.isSafeInteger(height) || height < 0) throw new Error('Not a block height');
    return height;
  }

  /** Notes the height just read. True when it differs from the one before. */
  function sawTip(height: number): boolean {
    const at = now();
    if (height === tip) {
      if (at - tipMovedAt >= SLOW_AFTER_BLOCKS * blockMs()) slow = true;
      return false;
    }
    const first = tip === null;
    tip = height;
    tipMovedAt = at;
    slow = false;
    // A payment that spent every coin leaves nothing in the wallet to change
    // when it confirms. The list of transactions would go on calling it
    // unconfirmed, so a new block is reason enough to read the list again.
    // (Whoever read the height does that, once it has read the coins too.)
    if (!first && history !== null && history.some((tx) => !tx.confirmed)) historyStale = true;
    return true;
  }

  function worked(): void {
    failures = 0;
    error = null;
    retryAt = null;
    checkedAt = now();
  }

  function failed(reason: ApiFailure): void {
    failures += 1;
    error = reason;
    retryAt = now() + (BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1] ?? 60_000);
    retryTimer = cancel(retryTimer);
    publish();
    syncTimers();
  }

  // -- reading ------------------------------------------------------------------

  /** Every address, from the start. One at a time: a second asker waits for the scan already under way. */
  function fullScan(): Promise<void> {
    if (scanning !== null) return scanning;
    const watch = account;
    if (watch === null) return Promise.resolve();
    const mine = wallet;
    scanId += 1;
    const id = scanId;
    // A scan that belongs to a wallet no longer here, or that another scan has overtaken, shows nothing.
    const stale = () => mine !== wallet || id !== scanId;
    /** The coins as they stand when the scan sets out. */
    const before = state;
    retryTimer = cancel(retryTimer);
    retryAt = null;
    const run = (async () => {
      try {
        const height = await readTip();
        const next = await scanWallet(watch, esplora);
        if (stale()) return;
        scanning = null;
        // The coins changed while the scan was on its way: a payment of the
        // wallet's own was applied, or a refresh came in. What the scan read
        // may be the older picture, and showing it would bring back a coin
        // that has just been spent. Nothing of it is used: read again.
        if (state !== before) {
          await fullScan();
          return;
        }
        sawTip(height);
        worked();
        if (lagging(next.coins)) {
          // Esplora has not heard of a payment this page just made. What is shown is newer than what was read.
          behind = true;
        } else {
          caughtUp();
          // Only a scan that worked settles what the Receive screen asked for.
          if (shown !== null) shown.wantScan = false;
          if (state === null || !sameWallet(state, next)) take(next, 'read');
        }
        // The list may have gone out of date without the coins changing: a new block, or a read that caught up.
        wantHistory();
        publish();
        syncTimers();
      } catch (cause) {
        // A scan asks about ten addresses at once and fails at the first
        // refusal. The other nine answers arrive a moment later and are of
        // no use to anyone: nothing of a failed scan is shown.
        if (stale()) return;
        scanning = null;
        failed(failureOf(cause));
      }
    })();
    scanning = run;
    publish();
    return job(run);
  }

  /**
   * One look at the network: the height of the chain and, when `refresh`
   * says so, the coins of the addresses in use.
   *   if-moved  the coins only if the chain has grown (the 15-second poll)
   *   always    the coins whatever the height says
   *   never     the height alone
   */
  function check(refresh: 'if-moved' | 'always' | 'never'): Promise<void> {
    if (account === null || state === null) return Promise.resolve();
    if (checking !== null) {
      // One look at a time. A look that has to read the coins is not lost: it follows the one under way.
      if (refresh === 'always') checkAgain = true;
      return checking;
    }
    const mine = wallet;
    const run = (async () => {
      const rescan = await look(mine, refresh);
      if (mine !== wallet) return;
      checking = null;
      if (rescan) {
        checkAgain = false;
        await fullScan();
      } else if (checkAgain) {
        checkAgain = false;
        // After a failure the retry timer says when to look again, and that look reads the coins anyway.
        if (failures === 0) await check('always');
      }
      syncTimers();
    })();
    checking = run;
    return job(run);
  }

  /** The reading part of check(). True when the address lists are out of date and a full scan is due. Never throws. */
  async function look(mine: number, refresh: 'if-moved' | 'always' | 'never'): Promise<boolean> {
    try {
      const height = await readTip();
      if (mine !== wallet) return false;
      const moved = sawTip(height);
      let rescan = false;
      const before = state;
      const watch = account;
      if (before !== null && watch !== null && (refresh === 'always' || (refresh === 'if-moved' && moved))) {
        const answer = await refreshWallet(watch, esplora, before);
        if (mine !== wallet) return false;
        // If a payment was applied or a scan finished while this refresh was
        // on its way, its answer describes the coins as they were. Dropped.
        if (state === before) {
          if (lagging(answer.state.coins)) {
            // It still lists a coin this page has just spent: dropped too, and the next poll reads the coins again.
            behind = true;
          } else {
            caughtUp();
            if (!sameCoins(before.coins, answer.state.coins)) take(answer.state, 'read');
            rescan = answer.rescan || (shown?.wantScan ?? false);
          }
        }
      }
      worked();
      wantHistory();
      publish();
      return rescan;
    } catch (cause) {
      if (mine === wallet) failed(failureOf(cause));
      return false;
    }
  }

  // -- when to read -------------------------------------------------------------

  /** True while the 15-second poll may run: a wallet with coins read, a wallet screen in view, nothing failing. */
  const pollsNow = (): boolean =>
    account !== null && state !== null && failures === 0 && isVisible() && walletScreen(screen);

  /** True while a screen that shows the wallet's transactions is open. */
  const showsActivity = (): boolean => screen !== null && ACTIVITY.has(screen);

  /** What a poll reads besides the height: the coins if it has moved, or in any case after a read that was behind. */
  const pollReads = (): 'if-moved' | 'always' => (behind ? 'always' : 'if-moved');

  function stopTimers(): void {
    tipTimer = cancel(tipTimer);
    addressTimer = cancel(addressTimer);
    retryTimer = cancel(retryTimer);
    historyTimer = cancel(historyTimer);
  }

  /** Sets and stops the timers so that they fit the moment. Safe to call at any time. */
  function syncTimers(): void {
    // Nothing is read by itself unless the tab is in view and a wallet screen is open. That goes for
    // trying again after a failure too: a tab left on another screen asks the network nothing.
    const here = account !== null && isVisible() && walletScreen(screen);
    // After a failure one timer runs, set for the moment shown as retryAt, and the polls rest.
    if (here && failures > 0 && scanning === null && checking === null) {
      retryTimer ??= later(retry, Math.max(0, (retryAt ?? 0) - now()));
    } else {
      retryTimer = cancel(retryTimer);
    }
    // The list of transactions waits the same way after a failure of its own, while a screen shows it.
    if (here && failures === 0 && historyRetryAt !== null && !historyLoading && showsActivity()) {
      historyTimer ??= later(retryHistory, Math.max(0, historyRetryAt - now()));
    } else {
      historyTimer = cancel(historyTimer);
    }
    const polls = pollsNow();
    if (polls) tipTimer ??= later(tick, TIP_MS);
    else tipTimer = cancel(tipTimer);
    if (polls && screen === 'receive' && shown !== null) addressTimer ??= later(addressTick, ADDRESS_MS);
    else addressTimer = cancel(addressTimer);
  }

  function retry(): void {
    retryTimer = null;
    if (account === null || !isVisible() || !walletScreen(screen)) return;
    if (state === null) void fullScan();
    else void check('always').then(syncTimers);
  }

  function retryHistory(): void {
    historyTimer = null;
    wantHistory();
    syncTimers();
  }

  function tick(): void {
    tipTimer = null;
    if (pollsNow()) void check(pollReads()).then(syncTimers);
    else syncTimers();
  }

  function addressTick(): void {
    addressTimer = null;
    void job(lookAtShown()).then(syncTimers);
  }

  /** Receive only: has the address on screen been paid since it was last looked at? One request. */
  async function lookAtShown(): Promise<void> {
    const mine = wallet;
    const at = shown;
    if (at === null || screen !== 'receive' || !pollsNow()) return;
    try {
      const txCount = txCountOf(await esplora.address(at.address));
      if (mine !== wallet || shown !== at || txCount === at.txCount) return;
      // Something is reading already: this is looked at again in five seconds.
      if (scanning !== null || checking !== null) return;
      at.txCount = txCount;
      // The light refresh reads the coins. Marking a newly paid address as
      // used takes a full scan, which the refresh asks for by itself only
      // for the few addresses it watches.
      at.wantScan = state?.receive.find((address) => address.index === at.index)?.used !== true;
      await check('always');
    } catch (cause) {
      if (mine === wallet) failed(failureOf(cause));
    }
  }

  function watch(next: Screen | null): void {
    const polled = pollsNow();
    screen = next;
    wantHistory();
    // Coming to the wallet from a screen that reads nothing: look at once, not in 15 seconds.
    // (After a failure the try that is due decides: syncTimers sets it, for now if its time has passed.)
    if (!polled && pollsNow()) void check(pollReads()).then(syncTimers);
    syncTimers();
  }

  function visibilityChanged(): void {
    if (!isVisible()) {
      stopTimers();
      return;
    }
    // Back in view on a wallet screen: one look now, whatever the timers would have said.
    if (account !== null && walletScreen(screen)) {
      if (state === null) void fullScan();
      else if (failures > 0) void check('always').then(syncTimers);
      else void check(pollReads()).then(syncTimers);
    }
    syncTimers();
  }

  async function refresh(): Promise<void> {
    if (account === null) return;
    const mine = wallet;
    await fullScan();
    // The reader asked: the list of transactions is read again too, also after an earlier failure of its own.
    if (mine === wallet && error === null) {
      // Unless a read of it is under way already. That one will do: either
      // the scan itself began it, or it began before the scan and will be
      // followed by another if the scan found the coins changed.
      if (!historyLoading) {
        historyStale = true;
        wantHistory('now');
      }
      // The reader's wait ends when the list has been read, not before: only
      // then do `history` and `historyError` say how the try went.
      while (mine === wallet && historyLoading) {
        await new Promise<void>((ended) => {
          historyWaiters.push(ended);
        });
      }
    }
  }

  /** Tells whoever waits for a read of the list that it has ended, or that the wallet it was for has left. */
  function historyEnded(): void {
    const waiting = historyWaiters;
    historyWaiters = [];
    for (const ended of waiting) ended();
  }

  // -- the list of transactions -------------------------------------------------

  /**
   * Reads the list of transactions if a screen that shows it is open and the
   * list is missing or out of date. After a read that failed, the next one
   * waits as every failed read does (15 s, 30 s, then every 60 s), unless
   * the reader asked for it ("now").
   */
  function wantHistory(when: 'due' | 'now' = 'due'): void {
    const from = state;
    if (account === null || from === null || !showsActivity() || historyLoading) return;
    if (history !== null && !historyStale && historyError === null) return;
    if (when === 'due' && historyRetryAt !== null && now() < historyRetryAt) return;
    const mine = wallet;
    historyLoading = true;
    historyStale = false;
    historyTimer = cancel(historyTimer);
    void job(
      (async () => {
        try {
          const list = await walletHistory(from, esplora);
          if (mine !== wallet) return;
          history = list;
          historyError = null;
          historyFailures = 0;
          historyRetryAt = null;
        } catch (cause) {
          if (mine !== wallet) return;
          // The old list stays on screen, with the reason beside it.
          historyError = failureOf(cause);
          historyFailures += 1;
          historyRetryAt = now() + (BACKOFF_MS[Math.min(historyFailures, BACKOFF_MS.length) - 1] ?? 60_000);
        }
        historyLoading = false;
        publish();
        syncTimers();
        // The coins changed while the list was on its way: read it again (after a failure, when its turn comes).
        if (historyStale) wantHistory();
        // After that: a waiter that looks now sees the next read, if one has just started, and waits for it too.
        historyEnded();
      })(),
    );
  }

  function rememberTx(txid: string): void {
    const at = now();
    for (const [id, since] of recent) if (at - since > RECENT_MS) recent.delete(id);
    recent.set(txid, at);
  }

  async function lookupTx(txid: string): Promise<TxLookup> {
    try {
      const held = history?.find((tx) => tx.txid === txid);
      if (held !== undefined) return { kind: 'found', view: held };
      const mine = wallet;
      const tx = await esplora.tx(txid);
      // Asked while the wallet's first scan is still running, as a page loaded
      // on the transaction's own screen asks: which of the addresses are the
      // wallet's is not known yet. The answer waits for the scan. Given at
      // once, it would say that nothing in the transaction is the wallet's.
      if (mine === wallet && state === null && scanning !== null) await scanning;
      // No scan has worked yet: the scan's own failure is the answer, and the screen asks again.
      if (mine === wallet && account !== null && state === null) return { kind: 'failed', reason: error ?? 'unavailable' };
      const own = mine === wallet && state !== null ? ownAddresses(state) : { receive: new Set<string>(), change: new Set<string>() };
      return { kind: 'found', view: viewTx(tx, own) };
    } catch (cause) {
      const reason = failureOf(cause);
      if (reason !== 'not_found') return { kind: 'failed', reason };
      // Esplora hears of a new transaction a moment after the node does. One
      // that the faucet or a broadcast returned just now is on its way.
      const since = recent.get(txid);
      return since !== undefined && now() - since <= RECENT_MS ? { kind: 'waiting' } : { kind: 'not-found' };
    }
  }

  // -- receiving ----------------------------------------------------------------

  function newReceiveAddress(): void {
    const at = shown;
    if (held || state === null || at === null) return;
    // Only addresses a light refresh watches: the unused ones up to five past
    // the last used one. An address this page has shown still works when the
    // reader has moved on, so every poll has to look at it. A payment to one
    // further out would wait for the next full scan. After the last of them,
    // start again at the first.
    const reach = state.nextReceiveIndex + LOOKAHEAD;
    const unused = state.receive.filter((address) => !address.used && address.index < reach);
    const next = unused.find((address) => address.index > at.index) ?? unused[0];
    if (next === undefined || next.index === at.index) return;
    show(next);
    publish();
    syncTimers();
  }

  function holdReceive(hold: boolean): void {
    held = hold === true;
  }

  // -- sending ------------------------------------------------------------------

  function plan(request: PaymentRequest): PaymentPlan {
    if (account === null) return nothingSpendable();
    return safePlan(account, state, request);
  }

  function isNodeRefusal(reason: BroadcastFailure): boolean {
    return (BROADCAST_REFUSALS as readonly string[]).includes(reason);
  }

  /**
   * True for the answers to a broadcast that a payment can also get when it
   * did reach the node. "unavailable" is among them: the Worker says it
   * when it has waited for the practice network as long as it will, and the
   * node may have taken the payment in that time.
   */
  function mayBeOut(reason: BroadcastFailure): boolean {
    return reason === 'already_sent' || reason === 'coin_spent' || reason === 'network' || reason === 'unavailable';
  }

  /** A payment's ID, or null for something that is not a payment. */
  function txidOf(payment: SignedPayment): string | null {
    try {
      return typeof payment.txid === 'string' ? payment.txid : null;
    } catch {
      return null;
    }
  }

  function broadcast(payment: SignedPayment): Promise<BroadcastResult> {
    // The wallet in the page as the payment is handed in: the one it was signed for.
    return inTurn(payment, wallet);
  }

  function inTurn(payment: SignedPayment, mine: number): Promise<BroadcastResult> {
    const txid = txidOf(payment);
    const under = sending;
    if (under !== null) {
      // One at a time. A second tap on "Broadcast" hands in the same payment, and gets the first one's answer.
      if (txid !== null && txid === under.txid) return under.answer;
      // Another payment is not that one: "sent", with the first one's ID, would be false for it.
      // It waits its turn, and is then sent and answered for itself.
      return job(under.answer.then(() => inTurn(payment, mine)));
    }
    const run = send(payment, mine);
    const flight = { txid, answer: run };
    sending = flight;
    const done = () => {
      if (sending === flight) sending = null;
    };
    run.then(done, done);
    return job(run);
  }

  /** Sends one payment. `mine` is the wallet it was handed in for: if another is here by the end, nothing is applied to it. */
  async function send(payment: SignedPayment, mine: number): Promise<BroadcastResult> {
    let txid: string;
    try {
      txid = payment.txid;
      let failure: { reason: BroadcastFailure; detail: string | null } | null = null;
      try {
        await esplora.broadcast(payment.hex);
      } catch (cause) {
        failure = broadcastFailure(cause);
      }
      // "Already in a block", "its coins are spent", no answer at all, and
      // a Worker that gave up waiting for the practice network are also
      // what a payment gets that did go out: sent twice, or sent when the
      // answer was lost on the way back. If the network knows the
      // transaction, it was sent.
      if (failure !== null && mayBeOut(failure.reason)) {
        try {
          await esplora.tx(txid);
          failure = null;
        } catch {
          // Not known: the refusal stands.
        }
      }
      if (failure !== null) {
        if (isNodeRefusal(failure.reason)) count('Payment', 'refused');
        return { ok: false, reason: failure.reason, detail: failure.detail };
      }
    } catch {
      // Nothing was sent: what was handed in is not a payment.
      return { ok: false, reason: 'unavailable', detail: null };
    }

    // Sent. From here on nothing may turn the answer into a failure.
    try {
      rememberTx(txid);
      // Sent from this page before, and sent again: the node takes a waiting payment a second time, and
      // says "already sent" of a confirmed one. It is one payment, already applied, announced and counted.
      if (mine === wallet && sentHere.has(txid)) return { ok: true, txid };
      count('Payment', payment.outputs.some((output) => !output.isChange && pots.has(output.address)) ? 'sent-to-pot' : 'sent');
      if (mine === wallet && state !== null) {
        sentHere.add(txid);
        // For two minutes, a read that still lists a coin this payment spent is behind (see lagging).
        const at = now();
        for (const coin of payment.inputs) spentHere.set(coinKey(coin), at);
        // The wallet as the payment leaves it, at once: the network takes a moment to say the same.
        take(applyPayment(state, payment), 'payment');
        notify({ kind: 'payment-sent' });
        void check('always').then(syncTimers);
      } else {
        notify({ kind: 'payment-sent' });
      }
    } catch {
      // The payment is out, but the wallet's own picture of it failed: read everything again.
      void fullScan();
    }
    return { ok: true, txid };
  }

  async function potAddress(): Promise<PotAddressResult> {
    try {
      const address = await deps.api.potAddress();
      pots.add(address);
      return { ok: true, address };
    } catch (cause) {
      return { ok: false, reason: failureOf(cause) };
    }
  }

  return {
    view: board.view,
    subscribe: board.subscribe,
    open,
    close,
    probe,
    state: () => state,
    watch,
    visibilityChanged,
    refresh,
    lookupTx,
    newReceiveAddress,
    holdReceive,
    plan,
    broadcast,
    potAddress,
    rememberTx,
    announce: (kind) => notify({ kind }),
    async idle() {
      while (working.size > 0) await Promise.allSettled([...working]);
    },
  };
}
