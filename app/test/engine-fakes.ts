// Stand-ins for everything the wallet's engine is handed, shared by the tests
// of session.ts, chain-sync.ts and faucet-flow.ts and by the integration test
// in e2e/test/engine.test.ts.
//
//   FakeClock, FakeTimers   time that moves only when a test moves it
//   giveUpOn                the browser's request time limit, on that time
//   MemoryStorage           localStorage for one origin, and three faulty kinds
//   VirtualAuthenticator    a password manager: the browser objects passkey.ts
//                           needs, answering from passkeys it keeps itself
//   FakeNetwork             the Worker and the practice chain behind it, small
//                           enough to read: just what the wallet asks about
//   recorder                where counted events go
//   testEngine              all of these wired into makeEngine()
//
// Nothing here opens a socket or reads the real clock.

import assert from 'node:assert/strict';
import { test as nodeTest } from 'node:test';
import {
  API,
  ERROR_STATUS,
  EVENTS,
  type CountedEvent,
  type ErrorCode,
  type Lang,
} from '@learnbitcoin/practice-contract';
import {
  entropyFromPrf,
  mnemonicFromEntropy,
  type EsploraTx,
  type FetchLike,
  type SignedPayment,
  type WalletState,
} from '@learnbitcoin/practice-wallet';
import { makeApi } from '../src/lib/api.ts';
import { withDeadline, type FirstScan, type Probe, type Timers, type Track } from '../src/lib/chain-sync.ts';
import type { PasskeyEnv } from '../src/lib/passkey.ts';
import { makeEngine, passkeyPort, type Engine } from '../src/lib/session.ts';

// -- tests that cannot hang ---------------------------------------------------

/**
 * node:test's test(), with a time limit. These tests wait on promises the
 * engine is meant to settle. If a change to the engine leaves one unsettled,
 * the test fails after half a minute instead of holding the whole run for ever.
 */
export function test(name: string, run: () => void | Promise<void>): void {
  void nodeTest(name, { timeout: 30_000 }, async () => {
    try {
      await run();
    } finally {
      // Whatever a test still holds open when it ends (a passkey prompt, the
      // network, a scan) is let go. A prompt left open after a failed
      // assertion would otherwise keep passkey.ts's five-minute timer, and
      // with it the whole run, alive.
      for (const release of [...held]) release();
    }
  });
}

/** What the stand-ins hold open right now, each with the function that lets it go. */
const held = new Set<() => void>();

/** A gate that stays shut until `release` is called, by the test or at its end. */
function gate(): { shut: Promise<void>; release: () => void } {
  let open!: () => void;
  const shut = new Promise<void>((resolve) => {
    open = resolve;
  });
  const release = (): void => {
    held.delete(release);
    open();
  };
  held.add(release);
  return { shut, release };
}

// -- time ---------------------------------------------------------------------

/** A fixed moment (15 January 2027), in whole milliseconds, as a record's time has to be. */
export const START_MS = 1_800_000_000_000;

/** A clock that stands still until a test moves it. */
export class FakeClock {
  ms: number;
  constructor(start: number = START_MS) {
    this.ms = start;
  }
  now = (): number => this.ms;
}

/** Lets everything that is ready to run, run: promises first, then one turn of the event loop. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * setTimeout and clearTimeout on a clock a test drives by hand. advance()
 * moves the clock on and runs each timer at its own moment, in order, and
 * waits after each for what it started (`settle`) before going on. So a
 * timer that sets the next one, as a poll does, behaves as it would in time.
 */
export class FakeTimers implements Timers {
  private readonly clock: { ms: number };
  private readonly waiting = new Map<number, { at: number; run: () => void }>();
  private made = 0;

  constructor(clock: { ms: number }) {
    this.clock = clock;
  }

  set = (run: () => void, ms: number): unknown => {
    this.made += 1;
    this.waiting.set(this.made, { at: this.clock.ms + Math.max(0, ms), run });
    return this.made;
  };

  clear = (handle: unknown): void => {
    this.waiting.delete(handle as number);
  };

  /** How many timers are set. */
  get size(): number {
    return this.waiting.size;
  }

  /** In how many ms each timer that is set will run, soonest first. */
  dueIn(): number[] {
    return [...this.waiting.values()].map((timer) => timer.at - this.clock.ms).sort((a, b) => a - b);
  }

  async advance(ms: number, settle: () => Promise<void> = flush): Promise<void> {
    const end = this.clock.ms + ms;
    // First let what is already under way get as far as it can: it may be about to set a timer.
    await settle();
    for (;;) {
      const due = [...this.waiting.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort(([a, x], [b, y]) => x.at - y.at || a - b)[0];
      if (due === undefined) break;
      const [id, timer] = due;
      this.waiting.delete(id);
      if (timer.at > this.clock.ms) this.clock.ms = timer.at;
      timer.run();
      await settle();
    }
    this.clock.ms = end;
    await settle();
  }
}

/**
 * AbortSignal.timeout on a test's clock: makes a signal that ends a request
 * after `ms` of the test's time, with the error the browser's own gives.
 * It is what withDeadline (chain-sync.ts) is handed in place of the real one.
 */
export function giveUpOn(timers: Timers): (ms: number) => AbortSignal {
  return (ms) => {
    const controller = new AbortController();
    timers.set(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
    return controller.signal;
  };
}

// -- storage ------------------------------------------------------------------

/** localStorage for one origin, kept in a Map. It counts what is asked of it. */
export class MemoryStorage {
  readonly map = new Map<string, string>();
  reads = 0;
  writes = 0;
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.writes += 1;
    this.map.clear();
  }
  getItem(key: string): string | null {
    this.reads += 1;
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.writes += 1;
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.writes += 1;
    this.map.set(key, String(value));
  }
}

/** Reads work; every write throws, as in a private window of some browsers or on a full disk. `full` can be switched. */
export class FullStorage extends MemoryStorage {
  full = true;
  override setItem(key: string, value: string): void {
    if (this.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    super.setItem(key, value);
  }
  override removeItem(key: string): void {
    if (this.full) throw new DOMException('The operation is insecure.', 'SecurityError');
    super.removeItem(key);
  }
}

/** Storage the browser has switched off for this page: every call throws. */
export class BlockedStorage extends MemoryStorage {
  override get length(): number {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  override clear(): void {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  override getItem(): string | null {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  override key(): string | null {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  override removeItem(): void {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  override setItem(): void {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
}

// -- counted events -------------------------------------------------------------

/**
 * Where the engine's events go in a test: a list of "Name: value". Each is
 * checked against the contract's closed list as it arrives, and one that is
 * not on it is kept apart, so a test can require that there were none. (It
 * cannot simply throw: the engine swallows whatever its event sender throws.)
 */
export function recorder(): { track: Track; events: string[]; unlisted: string[] } {
  const events: string[] = [];
  const unlisted: string[] = [];
  const track: Track = (name, value) => {
    const spec = (EVENTS as Record<string, { values: readonly string[] } | null>)[name as CountedEvent];
    const text = `${String(name)}: ${String(value)}`;
    if (!spec || !spec.values.includes(value)) unlisted.push(text);
    else events.push(text);
  };
  return { track, events, unlisted };
}

// -- passkeys -------------------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function bytesOf(source: unknown): Uint8Array {
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  assert.ok(ArrayBuffer.isView(source), 'expected bytes');
  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
}

/** A copy of the bytes in a buffer of their own, the way a browser returns them. */
function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

export interface VirtualPasskey {
  /** The credential ID, as bytes and as the base64url text the app stores. */
  id: Uint8Array;
  idText: string;
  /** The 32 bytes this passkey answers the wallet's question with. */
  secret: Uint8Array;
  userId: Uint8Array;
  /** The name it was made with: what a password manager would list. */
  name: string;
}

/**
 * A password manager with the PRF extension, as the browser shows it to a
 * page: navigator.credentials, PublicKeyCredential and crypto. passkey.ts
 * runs against it unchanged. Every passkey it makes has its own fixed
 * secret, so a test knows which wallet each one opens.
 */
export class VirtualAuthenticator {
  readonly passkeys: VirtualPasskey[] = [];
  /** Every prompt, in order: "create", "get <credential ID>" or "get (picker)". */
  readonly calls: string[] = [];
  /**
   * Credential IDs the page hinted should be forgotten (signalUnknownCredential).
   * This manager takes the hint, as Chrome's does: such a passkey is gone,
   * and no prompt can use it again. (It stays in `passkeys`, so a test can
   * still name it.)
   */
  readonly forgotten: string[] = [];
  /** Whether create() hands the secret over itself. False: only the get() that follows does. */
  secretAtCreate = true;
  /** False: a provider that cannot give a secret at all. */
  hasSecret = true;
  /** What the browser says about the PRF extension when asked. */
  offersPrf = true;
  /** Which passkey the picker hands over: a position in `passkeys`. */
  pick = 0;
  /** The next create() prompts, and the next get() prompts, fail with these error names: one name each. */
  readonly refuseCreate: string[] = [];
  readonly refuseGet: string[] = [];
  private gate: Promise<void> | null = null;
  private random = 0;

  /** The next prompt stays open until the function this returns is called. */
  hold(): () => void {
    const { shut, release } = gate();
    this.gate = shut;
    return release;
  }

  /** The 12 words the wallet package makes from a passkey's secret. */
  wordsOf(position: number): string {
    const passkey = this.passkeys[position];
    assert.ok(passkey, `no passkey at ${position}`);
    return mnemonicFromEntropy(entropyFromPrf(passkey.secret));
  }

  /** Adds a passkey that was made somewhere else, on another device: it is in the manager, and no page here made it. */
  add(seed: number): VirtualPasskey {
    const passkey: VirtualPasskey = {
      id: Uint8Array.from({ length: 16 }, (_, i) => (seed * 29 + i * 7 + 3) & 0xff),
      idText: '',
      secret: Uint8Array.from({ length: 32 }, (_, i) => (seed * 41 + i * 13 + 5) & 0xff),
      userId: Uint8Array.from({ length: 16 }, (_, i) => (seed * 17 + i * 3 + 11) & 0xff),
      name: `added ${seed}`,
    };
    passkey.idText = base64url(passkey.id);
    this.passkeys.push(passkey);
    return passkey;
  }

  private async prompt(refusals: string[]): Promise<void> {
    const gate = this.gate;
    this.gate = null;
    if (gate) await gate;
    const refusal = refusals.shift();
    if (refusal !== undefined) throw new DOMException('The operation either timed out or was not allowed.', refusal);
  }

  private credential(passkey: VirtualPasskey, at: 'create' | 'get', picked: boolean): object {
    const secret = this.hasSecret && (at === 'get' || this.secretAtCreate) ? passkey.secret : null;
    const prf = {
      ...(at === 'create' ? { enabled: this.hasSecret } : {}),
      ...(secret ? { results: { first: buffer(secret) } } : {}),
    };
    return {
      type: 'public-key',
      id: 'the app reads rawId, never this',
      rawId: buffer(passkey.id),
      // A browser hands the user.id back when the passkey was picked, and may keep it to itself when asked by ID.
      response: { userHandle: picked ? buffer(passkey.userId) : null },
      getClientExtensionResults: () => ({ prf }),
      toJSON() {
        throw new Error('toJSON() was called on a credential: its JSON holds the secret');
      },
    };
  }

  /** The browser objects passkey.ts is given. */
  env(hostname = 'localhost'): PasskeyEnv {
    const credentials: NonNullable<PasskeyEnv['credentials']> = {
      create: async (options) => {
        this.calls.push('create');
        await this.prompt(this.refuseCreate);
        const user = options?.publicKey?.user;
        assert.ok(user, 'create() names a user');
        const made = this.add(this.passkeys.length + 1);
        made.userId = bytesOf(user.id);
        made.name = user.name;
        return this.credential(made, 'create', false);
      },
      get: async (options) => {
        const allowed = options?.publicKey?.allowCredentials;
        const only = allowed?.[0] ? base64url(bytesOf(allowed[0].id)) : null;
        this.calls.push(only === null ? 'get (picker)' : `get ${only}`);
        await this.prompt(this.refuseGet);
        const passkey = only === null ? this.passkeys[this.pick] : this.passkeys.find((one) => one.idText === only);
        // No such passkey here (it never was, or the manager was told to forget it): the browser's one answer for that, and for a cancel.
        if (!passkey || this.forgotten.includes(passkey.idText)) {
          throw new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError');
        }
        return this.credential(passkey, 'get', only === null);
      },
    };
    return {
      credentials,
      PublicKeyCredential: {
        getClientCapabilities: async () => ({ 'extension:prf': this.offersPrf }),
        signalUnknownCredential: async ({ credentialId }) => {
          this.forgotten.push(credentialId);
        },
      },
      crypto: {
        getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
          assert.ok(array instanceof Uint8Array);
          this.random += 1;
          for (let i = 0; i < array.length; i++) array[i] = (this.random * 53 + i * 19 + 1) & 0xff;
          return array;
        },
      },
      isSecureContext: true,
      hostname,
    };
  }
}

// -- the network ----------------------------------------------------------------

/** An address of some other wallet (wallet/test/vectors.json, the passkey vector's first address). */
export const SOMEONE = 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6';
/** The address the stand-in's pot hands out (the same vector's second address). */
export const POT = 'bcrt1qzjat44qzthgeaerjweav79gxzclhkcdaahmfhn';
/** Where the stand-in's payments come from. Not a real address: nothing ever checks it, and no test wallet owns it. */
const ELSEWHERE = 'bcrt1qelsewhere';

/**
 * How a request can go wrong:
 *   network   no answer at all (fetch rejects with a TypeError)
 *   page      an error page from something in front of the Worker (502, HTML)
 *   garbage   a 200 whose body is not what was asked for
 *   <code>    the Worker's own refusal, { "error": <code> } with the contract's status
 */
export type Failure = 'network' | 'page' | 'garbage' | ErrorCode;

/** What the faucet does with the next request: pays, or refuses with a code, or does not answer. */
export type FaucetStep = 'pay' | 'network' | ErrorCode;

function refusal(code: ErrorCode, detail?: string): Response {
  const body = detail === undefined ? { error: code } : { error: code, detail };
  return new Response(JSON.stringify(body), { status: ERROR_STATUS[code], headers: { 'Content-Type': 'application/json' } });
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const text = (body: string): Response => new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' } });

/**
 * The Worker with the practice chain behind it, as the app's client sees it:
 * the six Esplora shapes the wallet reads, the broadcast, the faucet and the
 * pot. It knows transactions only as lists of addresses and amounts. The
 * real rules (signatures, fees, dust) are the stand-in network's business in
 * e2e/, where the whole stack runs.
 */
export class FakeNetwork {
  tip = 100;
  faucetSats = 100_000;
  /** Every request so far, oldest first: "GET /api/esplora/blocks/tip/height". */
  readonly requests: string[] = [];
  /** While set, requests fail this way. */
  down: Failure | null = null;
  /** With `down`: only requests that match fail. Matched against "GET /api/...", as `requests` lists them. */
  downFor: RegExp | null = null;
  /**
   * True: payments made from now on, broadcasts included, are unknown to
   * Esplora until hear() or the next block. The node has them: Esplora goes
   * on answering as if they had not happened, the coins they spent included.
   */
  lag = false;
  /**
   * True: requests made from now on (with `silentFor`: those that match it)
   * get no answer at all, as from a connection that stays open and says
   * nothing. Only a signal handed in with the request ends the wait.
   */
  silent = false;
  silentFor: RegExp | null = null;
  /** What the faucet does with the requests to come, one step each. When the list is empty it pays. */
  readonly faucet: FaucetStep[] = [];
  /** Every faucet request that reached it. */
  readonly faucetAsked: { address: string; token: string }[] = [];
  potAddress: string = POT;
  /** A signed payment the node refuses, by hex. */
  readonly refusing = new Map<string, { code: ErrorCode; detail?: string }>();

  private readonly txs = new Map<string, EsploraTx>();
  private readonly unheard = new Set<string>();
  /** Which transaction spent a coin, by "txid:vout". */
  private readonly spentBy = new Map<string, string>();
  private readonly taking = new Map<string, SignedPayment>();
  private gate: Promise<void> | null = null;
  private gateFor: RegExp | null = null;
  private made = 0;

  // -- controls ---------------------------------------------------------------

  /**
   * Requests made from now on (with `only`: those that match it, as
   * `requests` lists them) wait until the function this returns is called.
   * Each still gets the answer the network had for it when it was made: it
   * is the answer that is slow, not the question.
   */
  hold(only: RegExp | null = null): () => void {
    const { shut, release } = gate();
    this.gate = shut;
    this.gateFor = only;
    return () => {
      if (this.gate === shut) this.gate = null;
      release();
    };
  }

  /** How many requests so far match. */
  count(pattern: RegExp): number {
    return this.requests.filter((request) => pattern.test(request)).length;
  }

  /** A payment to an address from somebody else. Unconfirmed unless asked otherwise. Returns its ID. */
  pay(address: string, sats: number | bigint, options: { confirmed?: boolean } = {}): string {
    this.made += 1;
    const txid = this.made.toString(16).padStart(8, '0').padEnd(64, 'e');
    const confirmed = options.confirmed === true;
    if (confirmed) this.tip += 1;
    this.txs.set(txid, {
      txid,
      version: 2,
      locktime: 0,
      vin: [
        {
          txid: 'f'.repeat(64),
          vout: 0,
          is_coinbase: false,
          sequence: 0xfffffffd,
          prevout: { scriptpubkey: '', scriptpubkey_address: ELSEWHERE, value: Number(sats) + 220 },
        },
      ],
      vout: [{ scriptpubkey: '', scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: address, value: Number(sats) }],
      size: 110,
      weight: 440,
      fee: 220,
      status: confirmed ? { confirmed: true, block_height: this.tip, block_time: 1_800_000_000 } : { confirmed: false },
    });
    if (this.lag && !confirmed) this.unheard.add(txid);
    return txid;
  }

  /** A new block: it takes every waiting transaction, and Esplora hears of all of them. Returns the height. */
  mine(): number {
    this.tip += 1;
    for (const tx of this.txs.values()) {
      if (!tx.status.confirmed) tx.status = { confirmed: true, block_height: this.tip, block_time: 1_800_000_000 };
    }
    this.unheard.clear();
    return this.tip;
  }

  /** Esplora catches up with one transaction. */
  hear(txid: string): void {
    this.unheard.delete(txid);
  }

  /** Esplora has not heard of this transaction yet, although the node has it. */
  unhear(txid: string): void {
    this.unheard.add(txid);
  }

  /**
   * The network drops a transaction that was still waiting: replaced by its sender, or never
   * confirmed. It is gone from every list, and the coins it spent are unspent again.
   */
  drop(txid: string): void {
    assert.equal(this.txs.get(txid)?.status.confirmed, false, 'only a waiting transaction can be dropped');
    this.txs.delete(txid);
    this.unheard.delete(txid);
    for (const [coin, spender] of this.spentBy) if (spender === txid) this.spentBy.delete(coin);
  }

  /** The node will take this signed payment when it is broadcast. (Anything else it calls "not a transaction".) */
  willTake(payment: SignedPayment): void {
    this.taking.set(payment.hex, payment);
  }

  // -- answers ----------------------------------------------------------------

  private touching(address: string): EsploraTx[] {
    return [...this.txs.values()].filter(
      (tx) =>
        !this.unheard.has(tx.txid) &&
        (tx.vout.some((output) => output.scriptpubkey_address === address) ||
          tx.vin.some((input) => input.prevout?.scriptpubkey_address === address)),
    );
  }

  /** Whether Esplora counts a coin as spent: only once it has heard of the transaction that spent it. */
  private spentForEsplora(coin: string): boolean {
    const spender = this.spentBy.get(coin);
    return spender !== undefined && !this.unheard.has(spender);
  }

  private stats(txs: EsploraTx[]) {
    return { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: txs.length };
  }

  private esplora(method: string, path: string, body: string): Response {
    if (method === 'GET' && path === '/blocks/tip/height') return text(String(this.tip));

    const address = /^\/address\/([^/]+)(\/utxo|\/txs)?$/.exec(path);
    if (method === 'GET' && address) {
      const [, asked = '', list] = address;
      const txs = this.touching(asked);
      if (list === '/txs') {
        return json([...txs].sort((a, b) => Number(a.status.confirmed) - Number(b.status.confirmed) || (b.status.block_height ?? 0) - (a.status.block_height ?? 0)));
      }
      if (list === '/utxo') {
        return json(
          txs.flatMap((tx) =>
            tx.vout.flatMap((output, vout) =>
              output.scriptpubkey_address === asked && !this.spentForEsplora(`${tx.txid}:${vout}`)
                ? [{ txid: tx.txid, vout, value: output.value, status: tx.status }]
                : [],
            ),
          ),
        );
      }
      return json({
        address: asked,
        chain_stats: this.stats(txs.filter((tx) => tx.status.confirmed)),
        mempool_stats: this.stats(txs.filter((tx) => !tx.status.confirmed)),
      });
    }

    const tx = /^\/tx\/([0-9a-f]{64})$/.exec(path);
    if (method === 'GET' && tx) {
      const found = this.txs.get(tx[1] ?? '');
      return found && !this.unheard.has(found.txid) ? json(found) : refusal('not_found');
    }

    if (method === 'POST' && path === '/tx') {
      const refused = this.refusing.get(body);
      if (refused) return refusal(refused.code, refused.detail);
      const payment = this.taking.get(body);
      if (!payment) return refusal('refused', 'TX decode failed. Make sure the tx has at least one input.');
      const known = this.txs.get(payment.txid);
      if (known?.status.confirmed) return refusal('already_sent', 'Transaction outputs already in utxo set');
      if (!known) {
        for (const coin of payment.inputs) this.spentBy.set(`${coin.txid}:${coin.vout}`, payment.txid);
        if (this.lag) this.unheard.add(payment.txid);
        this.txs.set(payment.txid, {
          txid: payment.txid,
          version: 2,
          locktime: 0,
          vin: payment.inputs.map((coin) => ({
            txid: coin.txid,
            vout: coin.vout,
            is_coinbase: false,
            sequence: 0xfffffffd,
            prevout: { scriptpubkey: '', scriptpubkey_address: coin.address, value: Number(coin.value) },
          })),
          vout: [...payment.outputs]
            .sort((a, b) => a.vout - b.vout)
            .map((output) => ({
              scriptpubkey: '',
              scriptpubkey_type: 'v0_p2wpkh',
              scriptpubkey_address: output.address,
              value: Number(output.amount),
            })),
          size: payment.vsize,
          weight: payment.vsize * 4,
          fee: Number(payment.fee),
          status: { confirmed: false },
        });
      }
      return text(payment.txid);
    }
    return refusal('not_found');
  }

  private answer(method: string, path: string, body: string): Response {
    if (path.startsWith(`${API.esplora}/`)) return this.esplora(method, path.slice(API.esplora.length), body);
    if (method === 'POST' && path === API.faucet) {
      const asked = JSON.parse(body) as { address: string; token: string };
      this.faucetAsked.push(asked);
      const step = this.faucet.shift() ?? 'pay';
      if (step === 'network') throw new TypeError('fetch failed');
      if (step !== 'pay') return refusal(step);
      return json({ txid: this.pay(asked.address, this.faucetSats), amountSats: this.faucetSats, potTxid: null });
    }
    if (method === 'POST' && path === API.potAddress) return json({ address: this.potAddress });
    return refusal('not_found');
  }

  /** The page's fetch. The app asks by path alone. */
  fetch: FetchLike = async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const request = `${method} ${input}`;
    this.requests.push(request);
    if (this.silent && (this.silentFor === null || this.silentFor.test(request))) {
      // No answer, ever. The wait ends only when the caller's own signal ends it, with the signal's reason.
      const signal = init?.signal;
      return new Promise<Response>((_, reject) => {
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    // What the network has to say at this moment. A request that is held hears it late.
    let answer: Response | TypeError;
    try {
      answer = this.respond(method, input, typeof init?.body === 'string' ? init.body : '', request);
    } catch (cause) {
      answer = cause instanceof TypeError ? cause : new TypeError(String(cause));
    }
    if (this.gate && (this.gateFor === null || this.gateFor.test(request))) await this.gate;
    if (answer instanceof TypeError) throw answer;
    return answer;
  };

  private respond(method: string, path: string, body: string, request: string): Response {
    const failure = this.down !== null && (this.downFor === null || this.downFor.test(request)) ? this.down : null;
    if (failure === 'network') throw new TypeError('fetch failed');
    if (failure === 'page') return new Response('<html><h1>502 Bad Gateway</h1></html>', { status: 502 });
    if (failure === 'garbage') return new Response('{"surprise":[1,2,3]}', { status: 200 });
    if (failure !== null) return refusal(failure);
    return this.answer(method, path, body);
  }
}

// -- a chain engine for the session's own tests -----------------------------------

/** A wallet's coins as a scan would report them, for tests that only need "some coins" or "none". */
export function coinsState(coins: WalletState['coins'] = [], used = false): WalletState {
  return {
    receive: used ? [{ chain: 0, index: 0, address: SOMEONE, script: new Uint8Array(), publicKey: new Uint8Array(), path: '', used: true }] : [],
    change: [],
    coins,
    nextReceiveIndex: used ? 1 : 0,
    nextChangeIndex: 0,
    confirmed: 0n,
    unconfirmed: 0n,
  };
}

/**
 * What the session needs of the chain engine, with nothing behind it. It
 * notes what it was told, and a test decides what each scan finds.
 */
export class FakeChain {
  /** Every wallet the session said to watch: its public key, and whether a scan came with it. */
  readonly opened: { xpub: string; seeded: boolean }[] = [];
  closed = 0;
  readonly announced: string[] = [];
  /** Every account the session asked to have scanned before storing anything. */
  readonly probed: string[] = [];
  /** What the next probe finds. */
  probeAnswer: Probe = { ok: true, state: coinsState() };
  private coins: WalletState | null = null;
  private first: ((found: FirstScan | null) => void) | null = null;
  private probeGate: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();

  open = (xpub: string, seed?: WalletState): Promise<FirstScan | null> => {
    this.opened.push({ xpub, seeded: seed !== undefined });
    this.first?.(null);
    this.coins = seed ?? null;
    return new Promise((resolve) => {
      this.first = resolve;
    });
  };

  close = (): void => {
    this.closed += 1;
    this.first?.(null);
    this.first = null;
    this.coins = null;
  };

  probe = async (xpub: string): Promise<Probe> => {
    this.probed.push(xpub);
    if (this.probeGate) await this.probeGate;
    return this.probeAnswer;
  };

  state = (): WalletState | null => this.coins;

  announce = (kind: 'unlocked' | 'locked'): void => {
    this.announced.push(kind);
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The first scan of the wallet now watched has finished, and found this. */
  finishFirstScan(state: WalletState): void {
    this.setCoins(state);
    const first = this.first;
    this.first = null;
    first?.({ history: state.coins.length > 0 || state.receive.some((address) => address.used) });
  }

  /** The wallet's coins changed. */
  setCoins(state: WalletState): void {
    this.coins = state;
    for (const listener of this.listeners) listener();
  }

  /** The next probe stays unanswered until the function this returns is called. */
  holdProbe(): () => void {
    const { shut, release } = gate();
    this.probeGate = shut;
    return () => {
      this.probeGate = null;
      release();
    };
  }
}

// -- the whole engine on stand-ins --------------------------------------------------

export interface TestEngineOptions {
  storage?: Storage;
  auth?: VirtualAuthenticator;
  net?: FakeNetwork;
  clock?: FakeClock;
  selfTest?: () => boolean;
  newMnemonic?: () => string;
  persist?: () => Promise<boolean | null>;
  /** True: every request has the app's time limit (withDeadline), counted on the test's clock. */
  deadline?: boolean;
}

/**
 * makeEngine() on the stand-ins above. `page` holds what a test may change
 * while it runs: whether the tab is in view, its language, the block interval.
 */
export function testEngine(options: TestEngineOptions = {}) {
  const clock = options.clock ?? new FakeClock();
  const timers = new FakeTimers(clock);
  const net = options.net ?? new FakeNetwork();
  const auth = options.auth ?? new VirtualAuthenticator();
  const storage = options.storage ?? new MemoryStorage();
  const counted = recorder();
  const page = { visible: true, lang: 'en' as Lang, blockSeconds: 30, persistAsked: 0 };
  const engine: Engine = makeEngine({
    local: storage as Storage,
    passkeys: passkeyPort(auth.env()),
    // As wallet.svelte.ts wires it: the client on a fetch that gives up.
    api: makeApi(options.deadline ? withDeadline(net.fetch, giveUpOn(timers)) : net.fetch),
    now: clock.now,
    timers,
    visible: () => page.visible,
    track: counted.track,
    persist:
      options.persist ??
      (async () => {
        page.persistAsked += 1;
        return true;
      }),
    lang: () => page.lang,
    blockSeconds: () => page.blockSeconds,
    // The real self-test costs a key derivation; the tests of it pass their own.
    selfTest: options.selfTest ?? (() => true),
    newMnemonic: options.newMnemonic,
  });
  /** Waits until the engine has nothing on its way. */
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 3; round++) {
      await flush();
      await engine.chain.idle();
    }
    await flush();
  };
  return {
    engine,
    session: engine.session,
    chain: engine.chain,
    faucet: engine.faucet,
    clock,
    timers,
    net,
    auth,
    storage,
    events: counted.events,
    unlisted: counted.unlisted,
    page,
    settle,
    /** Moves time on, running the timers that come due, and waits for what they start. */
    advance: (ms: number) => timers.advance(ms, settle),
    /** Shows or hides the tab, as the browser's visibilitychange event would. */
    show(visible: boolean): void {
      page.visible = visible;
      engine.chain.visibilityChanged();
    },
  };
}

export type TestEngine = ReturnType<typeof testEngine>;
