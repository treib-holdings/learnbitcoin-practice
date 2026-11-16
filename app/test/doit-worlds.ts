// Worlds for the tests of the "Do it" runner (src/lib/doit): a wallet as it
// would publish itself, a note, a screen and a clock, each said in a line.
// (Not a test file itself: it only exports.)
//
// The wallet is the sample wallet of the development gallery (dev/sample.ts):
// real addresses of a real account, made by the wallet package from the first
// test phrase of the BIP39 standard.

import type { Coin, TxPart, TxView, WalletState } from '@learnbitcoin/practice-wallet';
import { ACCOUNT, OTHER_FINGERPRINT, otherAddress, ownAddress, sampleRecord } from '../dev/sample.ts';
import type { World } from '../src/lib/doit/judge.ts';
import { emptyProgress, type Progress, type StepNote } from '../src/lib/doit/progress.ts';
import type { StepId } from '../src/lib/doit/steps.ts';
import type { Route } from '../src/lib/router.ts';
import type { ChainView, LastSent, PublicRecord, WalletStatus } from '../src/lib/wallet-api.ts';

/** A fixed moment (15 January 2027), in ms. */
export const NOW = 1_800_000_000_000;

/** The sample wallet's fingerprint, and another wallet's. */
export const FP = ACCOUNT.masterFingerprint;
export const OTHER_FP = OTHER_FINGERPRINT;

/** The height of the chain in these worlds, unless a test says otherwise. */
export const TIP = 200;

/** A transaction ID, made from a short tag: txid('a1') is "a1" and then zeros. */
export function txid(tag: string): string {
  return tag.padEnd(64, '0');
}

// -- the wallet -----------------------------------------------------------------

/** This browser's record of the sample wallet, or of another wallet under the same kind of record. */
export function record(kind: 'passkey' | 'words' = 'words', fingerprint: string = FP): PublicRecord {
  return { ...sampleRecord(kind, NOW), fingerprint };
}

export interface CoinSpec {
  /** A tag for its transaction ID. */
  tx: string;
  sats: bigint | number;
  /** Null: unconfirmed. Default: confirmed, ten blocks under the tip. */
  height?: number | null;
  /** On the change chain. */
  change?: boolean;
  /** Which address of its chain. */
  index?: number;
}

export function coin(spec: CoinSpec): Coin {
  const at = ownAddress(spec.change ? 1 : 0, spec.index ?? 0);
  const height = spec.height === undefined ? TIP - 10 : spec.height;
  return {
    txid: txid(spec.tx),
    vout: 0,
    value: BigInt(spec.sats),
    status: height === null ? { confirmed: false } : { confirmed: true, block_height: height },
    chain: at.chain,
    index: at.index,
    address: at.address,
    script: at.script,
  };
}

/** The wallet's coins as a scan reports them. `used` is how many receive addresses have ever been paid. */
export function state(coins: CoinSpec[] = [], used = coins.some((each) => !each.change) ? 1 : 0): WalletState {
  const held = coins.map(coin);
  const list = (chain: 0 | 1, count: number) => Array.from({ length: count + 3 }, (_, index) => ({ ...ownAddress(chain, index), used: index < count }));
  const changeUsed = coins.some((each) => each.change) ? 1 : 0;
  return {
    receive: list(0, used),
    change: list(1, changeUsed),
    coins: held,
    nextReceiveIndex: used,
    nextChangeIndex: changeUsed,
    confirmed: held.reduce((sum, each) => (each.status.confirmed ? sum + each.value : sum), 0n),
    unconfirmed: held.reduce((sum, each) => (each.status.confirmed ? sum : sum + each.value), 0n),
  };
}

/** What the wallet says of its coins. With `coins` null, the first look is still running. */
export function chain(coins: WalletState | null, extra: Partial<ChainView> = {}): ChainView {
  return {
    state: coins,
    scanning: coins === null && extra.error === undefined,
    error: null,
    checkedAt: coins === null ? null : NOW - 5_000,
    retryAt: null,
    tip: coins === null ? null : TIP,
    slow: false,
    ...extra,
  };
}

const mine = (value: bigint, change = false, index = 0): TxPart => ({ address: ownAddress(change ? 1 : 0, index).address, value, mine: true, change });
const theirs = (value: bigint, index = 0): TxPart => ({ address: otherAddress(index), value, mine: false, change: false });

export interface TxSpec {
  tx: string;
  /** Default: sent. */
  direction?: TxView['direction'];
  /** Null: unconfirmed. Default: confirmed, ten blocks under the tip. */
  height?: number | null;
  /** The block's own time, in seconds. Default: 30 seconds before NOW, when it is in a block. */
  time?: number | null;
}

/** A transaction of the wallet's list, shaped by which way it went. The figures are small and add up. */
export function tx(spec: TxSpec): TxView {
  const direction = spec.direction ?? 'sent';
  const height = spec.height === undefined ? TIP - 10 : spec.height;
  const parts: Pick<TxView, 'inputs' | 'outputs' | 'net'> =
    direction === 'received'
      ? { inputs: [theirs(60_000n, 3)], outputs: [mine(50_000n), theirs(9_718n, 4)], net: 50_000n }
      : direction === 'internal'
        ? { inputs: [mine(50_000n)], outputs: [mine(20_000n, false, 1), mine(29_718n, true)], net: -282n }
        : direction === 'other'
          ? { inputs: [theirs(60_000n, 3)], outputs: [theirs(59_718n, 4)], net: 0n }
          : { inputs: [mine(50_000n)], outputs: [theirs(20_000n, 1), mine(29_718n, true)], net: -20_282n };
  return {
    txid: txid(spec.tx),
    confirmed: height !== null,
    height,
    time: height === null ? null : spec.time === undefined ? Math.floor(NOW / 1000) - 30 : spec.time,
    ...parts,
    fee: 282n,
    vsize: 141,
    feeRate: 2,
    direction,
    rbf: true,
  };
}

// -- the note ---------------------------------------------------------------------

/** A step's note with these parts ticked: ticks(1, 2) is { 1: true, 2: true }. */
export function ticks(...parts: number[]): NonNullable<StepNote['parts']> {
  return Object.fromEntries(parts.map((part) => [part, true])) as NonNullable<StepNote['parts']>;
}

/** A started step with its first `count` parts ticked, and whatever else it notes. */
export function started(count = 0, extra: StepNote = {}): StepNote {
  const note: StepNote = { started: true, ...extra };
  if (count > 0) note.parts = ticks(...Array.from({ length: count }, (_, at) => at + 1));
  return note;
}

/** A note that holds these steps. `following` is the step followed, since ten seconds ago. */
export function note(steps: Progress['steps'] = {}, following: StepId | null = null): Progress {
  const progress: Progress = { ...emptyProgress(), following, steps };
  if (following !== null) progress.followedAt = NOW - 10_000;
  return progress;
}

// -- the world ----------------------------------------------------------------------

export interface WorldSpec {
  status?: WalletStatus;
  /** Default: the sample wallet, kept with its words, when the status is "ready". Null: none. */
  record?: PublicRecord | null;
  unlocked?: boolean;
  /** Default: a wallet whose coins are known, and that holds none. */
  chain?: ChainView;
  /** Default: an empty list, when the coins are known. */
  history?: TxView[] | null;
  historyError?: World['wallet']['historyError'];
  lastSent?: LastSent | null;
  wordsShown?: number;
  note?: Progress;
  kept?: World['kept'];
  now?: number;
  route?: Route;
}

/** A world. With nothing said: a ready wallet with no coins, no note, on the Home screen, at NOW. */
export function world(spec: WorldSpec = {}): World {
  const status = spec.status ?? 'ready';
  const held = spec.record === undefined ? (status === 'ready' ? record() : null) : spec.record;
  const coins = spec.chain ?? (status === 'ready' ? chain(state()) : chain(null, { scanning: false }));
  return {
    wallet: {
      status,
      record: held,
      unlocked: spec.unlocked ?? (held !== null && held.kind === 'words'),
      chain: coins,
      history: spec.history === undefined ? (coins.state === null ? null : []) : spec.history,
      historyError: spec.historyError ?? null,
      lastSent: spec.lastSent ?? null,
      wordsShown: spec.wordsShown ?? 0,
    },
    note: spec.note ?? emptyProgress(),
    kept: spec.kept ?? 'yes',
    now: spec.now ?? NOW,
    route: spec.route ?? { name: 'home' },
  };
}

/** A world with no wallet in the browser. */
export function noWallet(spec: WorldSpec = {}): World {
  return world({ status: 'none', record: null, ...spec });
}

/** The same world with some of it changed: the wallet's part, or anything beside it. */
export function change(base: World, wallet: Partial<World['wallet']> = {}, rest: Partial<Omit<World, 'wallet'>> = {}): World {
  return { ...base, ...rest, wallet: { ...base.wallet, ...wallet } };
}

/** Freezes a value and everything in it, so that a function that changed its input would throw. */
export function frozen<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value) && !(value instanceof Uint8Array)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) frozen(inner);
  }
  return value;
}
