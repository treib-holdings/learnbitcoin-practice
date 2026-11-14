// Asking the faucet for practice coins, from the tap to the confirmed coin.
//
// One request goes through these phases (FaucetPhase in wallet-api.ts):
//
//   checking    the bot check runs, and gives a token
//   asking      the request, with the token, is with the faucet
//   waiting     refused for now; the app asks again by itself
//   on-its-way  the faucet has promised a payment
//   arrived     the coin is in the wallet, unconfirmed
//   confirmed   the coin is in a block
//   failed      stopped; `failure` says why
//
// The faucet refuses for reasons that pass by themselves: this reader asked
// too fast ("limit"), it has paid its limit for the minute ("busy"), it is
// out of coins until the next block ("refilling"). For those the app waits
// and asks again, for three minutes at most, and the screen shows when.
//
// This file asks and waits. It does not look at the chain itself: it follows
// what chain-sync.ts publishes about the wallet's coins, and so learns that
// the promised coin has arrived, also after a request that seemed to fail.

import type { CountedEvent, FaucetPayment, ValueOf } from '@learnbitcoin/practice-contract';
import type { Coin, WalletState } from '@learnbitcoin/practice-wallet';
import { failureOf, type ApiFailure, type PracticeApi } from './api.ts';
import { makeBoard, type ChainSync, type Published, type Timers, type Track } from './chain-sync.ts';
import type { FaucetFailure, FaucetView, TokenSource } from './wallet-api.ts';

export interface FaucetDeps {
  /** The app's client for its Worker. Only the faucet's call is used. */
  api: Pick<PracticeApi, 'askFaucet'>;
  /** The chain engine: the address to pay, and the wallet's coins as they change. */
  chain: Pick<ChainSync, 'view' | 'subscribe' | 'rememberTx' | 'holdReceive'>;
  /** The time in ms since 1970. */
  now: () => number;
  timers: Timers;
  track: Track;
}

export interface FaucetFlow extends Published<FaucetView> {
  /**
   * Asks the faucet to pay the address the Receive screen shows. Resolves
   * when the payment has been promised or the request has failed for good.
   * A second call while one runs starts nothing: it waits for the first.
   */
  ask(getToken: TokenSource): Promise<void>;
}

/** One request may wait and ask again for this long in all, in ms. */
const BUDGET_MS = 180_000;

/**
 * How long to wait before asking again, in ms. "limit" and "busy" are both
 * counted by the minute, and half a minute later a slot is usually free.
 * "refilling" ends with the next block, and a block comes every 30 seconds.
 */
const WAIT_MS = { limit: 30_000, busy: 20_000, refilling: 30_000 } as const;

/** A request never asks more than this many times, whatever the clock and the timers say. */
const MOST_TRIES = 12;

const IDLE: FaucetView = Object.freeze({ phase: 'idle', payment: null, failure: null, retryAt: null });

/** What one request was for. Kept after the request has ended, so that the coin is known when it turns up. */
interface Asked {
  /** Which wallet (the chain engine's count), and which of its addresses. */
  wallet: number;
  address: string;
  /** The coins that were at the address already when the request began. */
  had: Set<string>;
  /** The promised transaction, once there is one. */
  txid: string | null;
  /** The faucet said it has paid this address before: any coin there is the one. */
  paidBefore: boolean;
  /** Ends the wait before the next try at once. Set only while waiting. */
  wake: (() => void) | null;
}

function coinKey(coin: Coin): string {
  return `${coin.txid}:${coin.vout}`;
}

function coinsAt(state: WalletState | null, address: string): Coin[] {
  return state === null ? [] : state.coins.filter((coin) => coin.address === address);
}

export function makeFaucetFlow(deps: FaucetDeps): FaucetFlow {
  const board = makeBoard<FaucetView>(IDLE);
  let running: Promise<void> | null = null;
  let asked: Asked | null = null;

  const now = (): number => {
    try {
      const at = deps.now();
      return Number.isFinite(at) ? at : 0;
    } catch {
      return 0;
    }
  };

  function count<N extends CountedEvent>(name: N, value: ValueOf<N>): void {
    try {
      deps.track(name, value);
    } catch {
      // Counting is never worth a failed request.
    }
  }

  function hold(on: boolean): void {
    try {
      deps.chain.holdReceive(on);
    } catch {
      // The address may then move while the request runs. The request still pays the address it began with.
    }
  }

  /** Calls `run` once, `ms` from now. Returns what stops it, or null if no timer could be set. */
  function later(run: () => void, ms: number): (() => void) | null {
    try {
      const handle = deps.timers.set(run, ms);
      return () => {
        try {
          deps.timers.clear(handle);
        } catch {
          // Nothing to stop.
        }
      };
    } catch {
      return null;
    }
  }

  // -- following the coin -------------------------------------------------------

  /** The coin this request is about, if the wallet holds it. */
  function coinOf(request: Asked, state: WalletState | null, phase: FaucetView['phase']): Coin | undefined {
    const there = coinsAt(state, request.address);
    if (request.txid !== null) return there.find((coin) => coin.txid === request.txid);
    if (request.paidBefore) return there[0];
    // After a request that failed: only a coin that was not there before counts as having arrived.
    return phase === 'failed' ? there.find((coin) => !request.had.has(coinKey(coin))) : undefined;
  }

  /** Called whenever the chain engine shows something new. Moves the phase on when the coin has come. */
  function follow(): void {
    const request = asked;
    if (request === null) return;
    const chain = deps.chain.view();
    // Another wallet, or none: this request is nobody's any more.
    if (chain.wallet !== request.wallet) {
      asked = null;
      running = null;
      request.wake?.();
      board.set(IDLE);
      return;
    }
    const phase = board.view().phase;
    // The reader moved on to a new address (possible only once the request has ended): a fresh start for it.
    if (running === null && chain.receive?.address !== request.address) {
      asked = null;
      board.set(IDLE);
      return;
    }
    if (phase !== 'on-its-way' && phase !== 'arrived' && phase !== 'failed') return;
    const coin = coinOf(request, chain.chain.state, phase);
    if (coin === undefined) return;
    // From here on it is this coin that is followed to its confirmation.
    request.txid = coin.txid;
    const next = coin.status.confirmed ? 'confirmed' : 'arrived';
    if (next !== phase) board.set({ phase: next, failure: null, retryAt: null });
  }

  // -- one request --------------------------------------------------------------

  /**
   * The bot check's token, or null when there is none to be had: the check
   * failed, was dismissed, threw, or is still not done when the request's
   * time is up. `late` says it was the last of these.
   */
  function tokenFrom(getToken: TokenSource, fresh: boolean, deadline: number): Promise<{ token: string | null; late: boolean }> {
    return new Promise((resolve) => {
      let over = false;
      let stop: (() => void) | null = null;
      const finish = (token: string | null, late = false): void => {
        if (over) return;
        over = true;
        stop?.();
        resolve({ token, late });
      };
      // A check that never answers must not hold the request for ever.
      stop = later(() => finish(null, true), Math.max(0, deadline - now()));
      try {
        Promise.resolve(getToken(fresh)).then(
          (token) => finish(typeof token === 'string' && token !== '' ? token : null),
          () => finish(null),
        );
      } catch {
        finish(null);
      }
    });
  }

  /** Waits `ms`, or until the request is given up. With no timer to wait on, it does not wait at all. */
  function sleep(request: Asked, ms: number): Promise<void> {
    return new Promise((resolve) => {
      let over = false;
      let stop: (() => void) | null = null;
      const finish = (): void => {
        if (over) return;
        over = true;
        request.wake = null;
        stop?.();
        resolve();
      };
      request.wake = finish;
      stop = later(finish, Math.max(0, ms));
      if (stop === null) finish();
    });
  }

  function stopWith(failure: FaucetFailure, counted: ValueOf<'Faucet'>): void {
    count('Faucet', counted);
    board.set({ phase: 'failed', payment: null, failure, retryAt: null });
  }

  async function work(request: Asked, getToken: TokenSource): Promise<void> {
    const deadline = now() + BUDGET_MS;
    /** False once the wallet has changed under the request: nothing more is shown for it. */
    const current = (): boolean => asked === request;

    board.set({ phase: 'checking', payment: null, failure: null, retryAt: null });
    const first = await tokenFrom(getToken, false, deadline);
    if (!current()) return;
    if (first.token === null) return stopWith('no-token', 'failed');
    let token = first.token;

    let checkedAgain = false;
    for (let tries = 1; ; tries += 1) {
      board.set({ phase: 'asking', payment: null, failure: null, retryAt: null });
      let payment: FaucetPayment | null = null;
      let reason: ApiFailure = 'unavailable';
      try {
        const answer = await deps.api.askFaucet(request.address, token);
        // The client checks its answers. This is for the day something else stands in for it.
        if (typeof answer?.txid === 'string' && typeof answer.amountSats === 'number') payment = answer;
      } catch (cause) {
        reason = failureOf(cause);
      }
      if (!current()) return;

      if (payment !== null) {
        request.txid = payment.txid;
        try {
          // Esplora may take a moment to list it: until then "not found" means "not yet".
          deps.chain.rememberTx(payment.txid);
        } catch {
          // The transaction screen would then say "not found" for a moment.
        }
        count('Faucet', 'ok');
        board.set({ phase: 'on-its-way', payment, failure: null, retryAt: null });
        follow();
        return;
      }

      if (reason === 'already_paid') {
        // The faucet has paid this address in the last day. So the coin is
        // on its way or already here: the outcome the reader asked for,
        // without a payment to show for it.
        request.paidBefore = true;
        count('Faucet', 'already-paid');
        board.set({ phase: 'on-its-way', payment: null, failure: null, retryAt: null });
        follow();
        return;
      }

      if (reason === 'bot_check') {
        // The token was not accepted (they expire). One fresh token and one more try.
        if (checkedAgain) return stopWith('bot_check', 'bot-check');
        checkedAgain = true;
      } else if (reason === 'limit' || reason === 'busy' || reason === 'refilling') {
        const retryAt = now() + WAIT_MS[reason];
        if (retryAt > deadline || tries >= MOST_TRIES) return stopWith('gave-up', 'gave-up');
        board.set({ phase: 'waiting', payment: null, failure: reason, retryAt });
        await sleep(request, retryAt - now());
        if (!current()) return;
        // "limit" is the Worker's answer before the token was looked at, so
        // the token is still good. The other two come from the faucet, after
        // the bot check has used the token up.
        if (reason === 'limit') continue;
      } else {
        return stopWith(reason, 'failed');
      }

      board.set({ phase: 'checking', payment: null, failure: null, retryAt: null });
      const fresh = await tokenFrom(getToken, true, deadline);
      if (!current()) return;
      // The three minutes ran out while the bot check was still at work on a fresh token (the last
      // wait may end just before them): that is giving up, not a bot check that gave no token.
      if (fresh.token === null) return fresh.late ? stopWith('gave-up', 'gave-up') : stopWith('no-token', 'failed');
      token = fresh.token;
    }
  }

  function ask(getToken: TokenSource): Promise<void> {
    if (running !== null) return running;
    let request: Asked;
    try {
      const chain = deps.chain.view();
      // No address to pay yet: the first scan has not finished.
      if (chain.receive === null) return Promise.resolve();
      const address = chain.receive.address;
      request = {
        wallet: chain.wallet,
        address,
        had: new Set(coinsAt(chain.chain.state, address).map(coinKey)),
        txid: null,
        paidBefore: false,
        wake: null,
      };
    } catch {
      return Promise.resolve();
    }
    asked = request;
    // The address is frozen while the request runs: the coin is on its way to it.
    hold(true);
    const run = work(request, getToken)
      .catch(() => {
        if (asked === request) stopWith('unavailable', 'failed');
      })
      .then(() => {
        if (running === run) running = null;
        // Given up because the wallet changed: the chain engine has let go of the address already.
        if (asked === request) hold(false);
      });
    running = run;
    return run;
  }

  try {
    deps.chain.subscribe(follow);
  } catch {
    // Without it the phases stop at "on its way". Asking still works.
  }

  return { view: board.view, subscribe: board.subscribe, ask };
}
