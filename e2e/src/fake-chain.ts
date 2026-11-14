// A small model of the practice chain, for the stand-in origin (fake-origin.ts).
//
// It holds what the Esplora API is asked about: a height, transactions (in a
// block, or waiting for one), which outputs have been spent, and an index by
// output script. It refuses a broadcast for the reasons the real node gave
// when its answers were recorded (worker/test/fixtures/broadcast-refusals.json),
// in the node's own words and in the node's order.
//
// What it leaves out, so that nobody takes it for a node:
//   - Signatures are NOT checked. Only this much is looked at when a coin is
//     spent: a coin of a bcrt1q address (P2WPKH, the only kind a practice
//     wallet holds) has to come with the public key that the address is the
//     hash of. So a payment signed with the key of another address is
//     refused, as it is on the real network. A payment whose signature does
//     not fit is still accepted, and a coin of any other kind can be spent
//     with anything at all.
//   - A replacement (a transaction that spends a coin a waiting one already
//     spends) is weighed by its fees alone: the two rules in the recording.
//     The real node also asks that a miner be no worse off byte for byte (its
//     "feerate diagram"). A replacement that pays more in all, but is so much
//     bigger that it pays less per byte, is refused there and gets in here.
//   - Of the node's many other rules, only those in the recording are here,
//     three more that keep coins from being made out of nothing, and the
//     least size a transaction may have.
//   - A block has no size: it takes everything that waits.

import { bech32m, hex } from '@scure/base';
import { Address, RawTx, Script } from '@scure/btc-signer';
import { RawOldTx } from '@scure/btc-signer/script.js';
import { equalBytes, hash160, sha256, sha256x2 } from '@scure/btc-signer/utils.js';
import { REGTEST, addressScript, checkAddress } from '@learnbitcoin/practice-wallet';

/** The practice network makes a block every 30 seconds. */
const BLOCK_SECONDS = 30;
/** The node keeps at most this many waiting transactions that hang together. */
const CLUSTER_LIMIT = 64;
/** The node relays no transaction of fewer bytes than this, counted without its witnesses. */
const SMALLEST_SIZE = 65;

interface ChainBlock {
  height: number;
  hash: string;
  /** Seconds since 1970. */
  time: number;
}

interface ChainOutput {
  script: Uint8Array;
  /** The script as hex: what the index "by address" is really keyed by. */
  scriptHex: string;
  value: bigint;
  /** Esplora's name for the kind of script. */
  type: string;
  /** Only the kinds of script that have an address. */
  address?: string;
}

interface ChainInput {
  txid: string;
  vout: number;
  sequence: number;
  scriptSig: Uint8Array;
  witness: Uint8Array[];
  /** The output this input spends. Null in a coinbase, which spends nothing. */
  prevout: ChainOutput | null;
}

interface ChainTx {
  txid: string;
  /** The ID that covers the witnesses as well. The node names it when it refuses the way a coin is spent. */
  wtxid: string;
  version: number;
  locktime: number;
  vin: ChainInput[];
  vout: ChainOutput[];
  /** In bytes. */
  size: number;
  /** In bytes, without the witnesses. */
  strippedSize: number;
  weight: number;
  /** In virtual bytes: a quarter of the weight, rounded up. Fees are counted against this. */
  vsize: number;
  fee: bigint;
  /** The block that holds it. Null while it waits for one. */
  block: ChainBlock | null;
  /** Order of arrival: a later transaction has a higher number. */
  seq: number;
  /** When Esplora hears of it, in the chain's milliseconds (see `heard` in makeChain). */
  heardAt: number;
}

/** One output that pays a script: where it is, and what has become of it. */
interface ChainCoin {
  tx: ChainTx;
  vout: number;
  output: ChainOutput;
  /** The transaction that spends it (waiting or in a block), if any does. */
  spender: ChainTx | undefined;
}

/** How a broadcast ended. `code` and `message` are Bitcoin Core's own, as its RPC gives them. */
type Broadcast = { ok: true; txid: string } | { ok: false; code: number; message: string };

// -- addresses and scripts ----------------------------------------------------

/**
 * The output script an address pays to, read with the wallet's own address
 * reader, so that the stand-in knows every kind of address the wallet lets
 * a reader pay. Esplora on a regtest chain takes the whole family of test
 * networks: a tb1 address is the same script spelled another network's way,
 * and gets the same answer as its bcrt1 twin. For anything else, the words
 * Esplora answers with (and a 400): one sentence for text that is no address
 * at all, another for an address of Bitcoin's real network.
 */
export function scriptOf(address: string): { script: Uint8Array } | { error: string } {
  const check = checkAddress(address);
  if (check.kind === 'practice') return { script: addressScript(check.address) };
  if (check.kind === 'other-test-network') return { script: addressScript(check.practiceAddress) };
  return { error: check.kind === 'mainnet' ? 'Address on invalid network' : 'Invalid Bitcoin address' };
}

/** Esplora's name for a kind of output script, and the address that kind has, if it has one. */
function describe(script: Uint8Array): { type: string; address?: string } {
  const [a, b, c] = script;
  const n = script.length;
  const address = Address(REGTEST);
  if (n === 22 && a === 0x00 && b === 0x14) {
    return { type: 'v0_p2wpkh', address: address.encode({ type: 'wpkh', hash: script.subarray(2) }) };
  }
  if (n === 34 && a === 0x00 && b === 0x20) {
    return { type: 'v0_p2wsh', address: address.encode({ type: 'wsh', hash: script.subarray(2) }) };
  }
  if (n === 25 && a === 0x76 && b === 0xa9 && c === 0x14 && script[23] === 0x88 && script[24] === 0xac) {
    return { type: 'p2pkh', address: address.encode({ type: 'pkh', hash: script.subarray(3, 23) }) };
  }
  if (n === 23 && a === 0xa9 && b === 0x14 && script[22] === 0x87) {
    return { type: 'p2sh', address: address.encode({ type: 'sh', hash: script.subarray(2, 22) }) };
  }
  // Every later version of segwit: OP_1 to OP_16, then one push of 2 to 40
  // bytes. Esplora has a name for two of them (taproot, and the "anchor"
  // that anyone can spend) and an address for all of them.
  if (a !== undefined && a >= 0x51 && a <= 0x60 && n >= 4 && n <= 42 && b === n - 2) {
    const taproot = a === 0x51 && n === 34;
    const anchor = a === 0x51 && n === 4 && c === 0x4e && script[3] === 0x73;
    return {
      type: taproot ? 'v1_p2tr' : anchor ? 'anchor' : 'unknown',
      address: bech32m.encode(REGTEST.bech32, [a - 0x50, ...bech32m.toWords(script.subarray(2))]),
    };
  }
  return { type: a === 0x6a ? 'op_return' : 'unknown' };
}

/** A script in words, as Esplora prints it (with the opcode names of the rust-bitcoin library). */
function asm(script: Uint8Array): string {
  try {
    const words = Script.decode(script).map((part) => {
      if (typeof part === 'number') return part === 0 ? 'OP_0' : `OP_PUSHNUM_${part}`;
      if (typeof part === 'string') return `OP_${part}`;
      const size = part.length;
      const push = size <= 75 ? `OP_PUSHBYTES_${size}` : size <= 0xff ? 'OP_PUSHDATA1' : size <= 0xffff ? 'OP_PUSHDATA2' : 'OP_PUSHDATA4';
      return `${push} ${hex.encode(part)}`;
    });
    return words.join(' ');
  } catch {
    return ''; // Bytes that are not a script the library can read.
  }
}

/**
 * The least the node relays to a script: three sats for every byte it takes
 * to make the output and, later, to spend it (Bitcoin Core's rule at its
 * default of 3 sat/vB). That is 294 sats for P2WPKH, 330 for P2WSH and
 * taproot, 546 for P2PKH. An output nobody can spend (OP_RETURN) has no limit.
 */
function dustLimit(script: Uint8Array): bigint {
  const first = script[0] ?? 0xff;
  if (first === 0x6a) return 0n;
  // A segwit output: a version (OP_0, or OP_1 to OP_16), then one push of 2 to 40 bytes.
  const segwit =
    script.length >= 4 && script.length <= 42 && (first === 0x00 || (first >= 0x51 && first <= 0x60)) && script[1] === script.length - 2;
  // 8 bytes of amount, 1 of script length, the script; then 67 virtual bytes to spend a segwit coin, 148 for an older kind.
  return 3n * BigInt(8 + 1 + script.length + (segwit ? 67 : 148));
}

/** An amount as Bitcoin Core prints it in its messages: in BTC, with trailing zeros cut down to two decimals. */
function formatMoney(sats: bigint): string {
  const text = `${sats / 100_000_000n}.${String(sats % 100_000_000n).padStart(8, '0')}`;
  return text.replace(/0{1,6}$/, '');
}

// -- reading a transaction ----------------------------------------------------

/**
 * Reads a raw transaction with the wallet's own library: its ID, what it
 * spends, what it pays and how big it is. Null when the text is not hex or
 * is not exactly one transaction. What each input is worth is not in the
 * transaction itself; the chain fills that in (`prevout`).
 */
function parse(text: string): Omit<ChainTx, 'fee' | 'block' | 'seq' | 'heardAt'> | null {
  try {
    const bytes = hex.decode(text); // throws unless the text is hex and nothing else
    const raw = RawTx.decode(bytes);
    if (raw.inputs.length === 0) return null;
    // The ID is the double SHA-256 of the transaction without its witnesses,
    // shown in reverse. So signatures in a witness never change it.
    const stripped = RawOldTx.encode({ version: raw.version, inputs: raw.inputs, outputs: raw.outputs, lockTime: raw.lockTime });
    // A byte outside the witnesses weighs 4, a witness byte 1.
    const weight = stripped.length * 3 + bytes.length;
    return {
      txid: hex.encode(sha256x2(stripped).reverse()),
      wtxid: hex.encode(sha256x2(bytes).reverse()),
      version: raw.version,
      locktime: raw.lockTime,
      vin: raw.inputs.map((input, i) => ({
        txid: hex.encode(input.txid),
        vout: input.index,
        sequence: input.sequence,
        scriptSig: input.finalScriptSig,
        witness: raw.witnesses?.[i] ?? [],
        prevout: null,
      })),
      vout: raw.outputs.map((output) => ({
        script: output.script,
        scriptHex: hex.encode(output.script),
        value: output.amount,
        ...describe(output.script),
      })),
      size: bytes.length,
      strippedSize: stripped.length,
      weight,
      vsize: Math.ceil(weight / 4),
    };
  } catch {
    return null;
  }
}

// -- the chain ----------------------------------------------------------------

export type Chain = ReturnType<typeof makeChain>;

/**
 * `clock` gives milliseconds since 1970. `seed` names the blocks: a block's
 * hash is made from it and the height, so nothing here is random.
 */
export function makeChain(opts: { height: number; clock: () => number; seed: string }) {
  const txs = new Map<string, ChainTx>();
  /** "txid:vout" of a spent output -> the transaction that spends it, waiting or in a block. */
  const spentBy = new Map<string, ChainTx>();
  /** Output script (hex) -> every transaction that pays it or spends from it, in order of arrival. */
  const byScript = new Map<string, ChainTx[]>();
  /** Transactions not yet in a block, in order of arrival. */
  const waiting = new Set<ChainTx>();
  let arrivals = 0;

  /**
   * The chain's time is the caller's clock plus `lead`: the seconds that
   * mining has added to it (see mine()). It is the only time there is here,
   * for the blocks, for the faucet's day and for Esplora's lag. So a day on
   * the caller's clock is a day for the faucet, whatever was mined before.
   */
  let lead = 0;
  const nowMs = () => opts.clock() + lead * 1000;
  const now = () => Math.floor(nowMs() / 1000);

  /**
   * Esplora (the electrs server) keeps its own list of what waits. A
   * transaction sent through its own POST /tx goes on that list at once. One
   * that reached the node some other way, as a faucet payment does, gets
   * there when electrs next asks the node what is waiting: here, `lag`
   * seconds later. Until then Esplora answers as if there were no such
   * transaction. A block ends the wait.
   *
   * Only arrivals lag. A transaction that a replacement has pushed out is
   * gone from these answers at once; the real Esplora goes on listing it
   * until it next asks the node.
   */
  let lag = 0;
  const heard = (tx: ChainTx) => tx.block !== null || tx.heardAt <= nowMs();

  const blockAt = (height: number, time: number): ChainBlock => ({
    height,
    time,
    hash: hex.encode(sha256(new TextEncoder().encode(`${opts.seed}/block/${height}`))),
  });
  /** Where the model's history begins. */
  const first = blockAt(opts.height, now());
  let tip = first;

  function add(tx: ChainTx): void {
    txs.set(tx.txid, tx);
    if (!tx.block) waiting.add(tx);
    const scripts = new Set(tx.vout.map((output) => output.scriptHex));
    for (const input of tx.vin) {
      if (!input.prevout) continue;
      spentBy.set(`${input.txid}:${input.vout}`, tx);
      scripts.add(input.prevout.scriptHex);
    }
    for (const script of scripts) {
      const list = byScript.get(script);
      if (list) list.push(tx);
      else byScript.set(script, [tx]);
    }
  }

  /** Takes a waiting transaction out again, as if it had never come. A replacement does this to what it replaces. */
  function remove(tx: ChainTx): void {
    txs.delete(tx.txid);
    waiting.delete(tx);
    const scripts = new Set(tx.vout.map((output) => output.scriptHex));
    for (const input of tx.vin) {
      if (!input.prevout) continue;
      spentBy.delete(`${input.txid}:${input.vout}`); // the coin it spent is free again
      scripts.add(input.prevout.scriptHex);
    }
    for (const script of scripts) {
      byScript.set(script, (byScript.get(script) ?? []).filter((other) => other !== tx));
    }
  }

  /**
   * Coins from nowhere, for the stand-in's own wallet: a coinbase transaction
   * filed under the model's first block, as if it had been mined before the
   * test began. (On the real network, too, every coin began in a coinbase.)
   */
  function mint(script: Uint8Array, value: bigint): ChainTx {
    const raw = RawTx.encode({
      version: 2,
      segwitFlag: false,
      // A coinbase has one input, which spends nothing. Its script starts with the
      // block height; the counter after it gives every mint an ID of its own.
      inputs: [{ txid: new Uint8Array(32), index: 0xffffffff, finalScriptSig: Script.encode([first.height, arrivals]), sequence: 0xffffffff }],
      outputs: [{ amount: value, script }],
      witnesses: [],
      lockTime: 0,
    });
    const parsed = parse(hex.encode(raw));
    if (!parsed) throw new Error('The stand-in could not read its own coinbase');
    const tx: ChainTx = { ...parsed, fee: 0n, block: first, seq: arrivals++, heardAt: 0 };
    add(tx);
    return tx;
  }

  /**
   * What POST /tx does: the node's checks, in the node's order, then the
   * transaction waits for a block. Signatures are not among the checks.
   * `from` says which way it came: through Esplora, or straight to the node
   * (as the bots' own payments do), which Esplora hears of later.
   */
  function broadcast(text: string, from: 'esplora' | 'node'): Broadcast {
    const refuse = (code: number, message: string): Broadcast => ({ ok: false, code, message });
    const parsed = parse(text);
    if (!parsed) return refuse(-22, 'TX decode failed. Make sure the tx has at least one input.');

    const known = txs.get(parsed.txid);
    // Already in a block, and at least one of its outputs has not been spent in a block since.
    if (known?.block && known.vout.some((_, n) => !spentBy.get(`${known.txid}:${n}`)?.block)) {
      return refuse(-27, 'Transaction outputs already in utxo set');
    }
    // Still waiting: the node keeps the one it has and answers with its ID again.
    if (known && !known.block) return { ok: true, txid: known.txid };

    // A transaction of under 65 bytes, counted without its witnesses, is not
    // relayed: at 64 it is as long as two hashes side by side, and could be
    // passed off as a branch of a block's Merkle tree. The wallet's payments
    // are longer, with one exception: one coin paid in full, with no change,
    // to an address that stands for a script of only 4 bytes (pay-to-anchor
    // is one) comes to exactly 64. The recording holds no such refusal. Its
    // words were seen on the practice network's node. The limit, and its
    // place before the node looks for the coins a transaction spends, are
    // Bitcoin Core's (version 31), read from its source.
    if (parsed.strippedSize < SMALLEST_SIZE) return refuse(-26, 'tx-size-small');

    // Every coin it spends must exist and must not have been spent in a block.
    // A coin that another waiting transaction spends is looked at further down.
    /** Each waiting transaction it would push out -> the rival that takes it along. A rival takes itself. */
    const rivals = new Map<ChainTx, ChainTx>();
    const spent = new Set<string>();
    let valueIn = 0n;
    for (const input of parsed.vin) {
      const outpoint = `${input.txid}:${input.vout}`;
      if (spent.has(outpoint)) return refuse(-26, 'bad-txns-inputs-duplicate');
      spent.add(outpoint);
      const prevout = txs.get(input.txid)?.vout[input.vout];
      const spender = spentBy.get(outpoint);
      if (!prevout || spender?.block) return refuse(-25, 'bad-txns-inputs-missingorspent');
      if (spender) rivals.set(spender, spender);
      input.prevout = prevout;
      valueIn += prevout.value;
    }
    const valueOut = parsed.vout.reduce((sum, output) => sum + output.value, 0n);
    if (valueIn < valueOut) {
      return refuse(-26, `bad-txns-in-belowout, value in (${formatMoney(valueIn)}) < value out (${formatMoney(valueOut)})`);
    }
    const fee = valueIn - valueOut;

    // A dust output is let through only in a transaction that pays no fee, and
    // a transaction that pays no fee is stopped by the next rule.
    if (fee > 0n && parsed.vout.some((output) => output.value < dustLimit(output.script))) {
      return refuse(-26, 'dust, tx with dust output must be 0-fee');
    }
    // The node relays from 0.1 sat/vB, rounded up to a whole sat.
    const least = (BigInt(parsed.vsize) + 9n) / 10n;
    if (fee < least) return refuse(-26, `min relay fee not met, ${fee} < ${least}`);

    if (rivals.size > 0) {
      // It spends a coin that a waiting transaction already spends, which makes
      // it a replacement: it can get in only by pushing the rivals out, and
      // with them whatever spends from them. The node allows that when it pays
      // more than all of those together, by at least 0.1 sat/vB of its own
      // size. (The map grows while it is walked: children, then theirs.)
      for (const [tx, rival] of rivals) {
        tx.vout.forEach((_, n) => {
          const child = spentBy.get(`${tx.txid}:${n}`);
          if (child && !rivals.has(child)) rivals.set(child, rival);
        });
      }
      let theirs = 0n;
      for (const tx of rivals.keys()) theirs += tx.fee;
      const short =
        fee < theirs
          ? `less fees than conflicting txs; ${formatMoney(fee)} < ${formatMoney(theirs)}`
          : fee - theirs < least
            ? `not enough additional fees to relay; ${formatMoney(fee - theirs)} < ${formatMoney(least)}`
            : null;
      if (short) return refuse(-26, `insufficient fee, rejecting replacement ${parsed.txid}, ${short}`);
    }

    // Waiting transactions that hang together, one spending from another, are
    // a cluster, and the node lets a cluster grow to 64. So the 65th payment in
    // a row, each spending the change of the one before, has to wait for a block.
    // What a replacement pushes out is on its way out, and does not count.
    const cluster = new Set<ChainTx>();
    const gather = (tx: ChainTx | undefined): void => {
      if (!tx || tx.block || cluster.has(tx) || rivals.has(tx)) return;
      cluster.add(tx);
      for (const input of tx.vin) gather(txs.get(input.txid));
      tx.vout.forEach((_, n) => gather(spentBy.get(`${tx.txid}:${n}`)));
    };
    for (const input of parsed.vin) gather(txs.get(input.txid));
    if (cluster.size >= CLUSTER_LIMIT) return refuse(-26, 'too-large-cluster');

    // The words of the next two refusals are Bitcoin Core's (version 31), read
    // from its source. The recording holds neither.

    // A replacement cannot spend a coin of a transaction it pushes out: the
    // coin would be gone with it. The node names the rival behind it.
    for (const input of parsed.vin) {
      const parent = txs.get(input.txid);
      const rival = parent && rivals.get(parent);
      if (rival) return refuse(-26, `bad-txns-spends-conflicting-tx, ${parsed.txid} spends conflicting transaction ${rival.txid}`);
    }

    // The one check on how a coin is spent (see the top of this file): a
    // P2WPKH coin comes with two things, a signature and the public key that
    // its script holds the hash of. The signature is taken on trust.
    for (const [n, input] of parsed.vin.entries()) {
      const coin = input.prevout;
      if (coin?.type !== 'v0_p2wpkh') continue;
      const key = input.witness[1];
      const fault =
        input.witness.length !== 2 || !key
          ? 'Witness program hash mismatch'
          : equalBytes(hash160(key), coin.script.subarray(2))
            ? null
            : 'Script failed an OP_EQUALVERIFY operation';
      if (fault) {
        const where = `input ${n} of ${parsed.txid} (wtxid ${parsed.wtxid}), spending ${input.txid}:${input.vout}`;
        return refuse(-26, `mempool-script-verify-flag-failed (${fault}), ${where}`);
      }
    }

    for (const tx of rivals.keys()) remove(tx);
    add({ ...parsed, fee, block: null, seq: arrivals++, heardAt: nowMs() + (from === 'node' ? lag * 1000 : 0) });
    return { ok: true, txid: parsed.txid };
  }

  /**
   * A new block. It takes every waiting transaction, or only the ones named
   * (which must not spend from one that is left waiting).
   *
   * A block comes 30 seconds after the one before it, or later. Tests mine
   * much faster than that. So a block that is asked for early moves the
   * chain's time on to where the block belongs, and the time stays moved:
   * blocks are 30 seconds apart even on a clock that stands still, and from
   * then on the chain's time and the caller's clock run at the same pace
   * again. At the real pace nothing is moved, and a block simply carries the
   * time it was made.
   */
  function mine(only?: ReadonlySet<string>): ChainBlock {
    const at = now();
    const due = tip.time + BLOCK_SECONDS;
    if (at < due) lead += due - at;
    tip = blockAt(tip.height + 1, Math.max(at, due));
    for (const tx of waiting) {
      if (only && !only.has(tx.txid)) continue;
      tx.block = tip;
      waiting.delete(tx);
    }
    return tip;
  }

  /** Every output that pays a script, oldest first. */
  function coinsOf(script: string): ChainCoin[] {
    const coins: ChainCoin[] = [];
    for (const tx of byScript.get(script) ?? []) {
      tx.vout.forEach((output, vout) => {
        if (output.scriptHex === script) coins.push({ tx, vout, output, spender: spentBy.get(`${tx.txid}:${vout}`) });
      });
    }
    return coins;
  }

  // -- the Esplora shapes (fields and their order as in e2e/fixtures/origin-samples.json) --

  /** What Esplora has on file for a script: the transactions it has heard of that pay it or spend from it, in order of arrival. */
  const filed = (script: string) => (byScript.get(script) ?? []).filter(heard);

  const statusJson = (tx: ChainTx) =>
    tx.block
      ? { confirmed: true, block_height: tx.block.height, block_hash: tx.block.hash, block_time: tx.block.time }
      : { confirmed: false };

  const outputJson = (output: ChainOutput) => ({
    scriptpubkey: output.scriptHex,
    scriptpubkey_asm: asm(output.script),
    scriptpubkey_type: output.type,
    ...(output.address ? { scriptpubkey_address: output.address } : {}),
    value: Number(output.value),
  });

  /** GET /tx/<txid>. */
  const txJson = (tx: ChainTx) => ({
    txid: tx.txid,
    version: tx.version,
    locktime: tx.locktime,
    vin: tx.vin.map((input) => ({
      txid: input.txid,
      vout: input.vout,
      prevout: input.prevout ? outputJson(input.prevout) : null,
      scriptsig: hex.encode(input.scriptSig),
      scriptsig_asm: asm(input.scriptSig),
      ...(input.witness.length > 0 ? { witness: input.witness.map((item) => hex.encode(item)) } : {}),
      is_coinbase: input.prevout === null,
      sequence: input.sequence,
    })),
    vout: tx.vout.map(outputJson),
    size: tx.size,
    weight: tx.weight,
    // One signature check for each P2WPKH coin spent, which is all a practice
    // wallet spends. Other kinds of coin are not counted.
    sigops: tx.vin.filter((input) => input.prevout?.type === 'v0_p2wpkh').length,
    fee: Number(tx.fee),
    status: statusJson(tx),
  });

  /** GET /address/<address>: totals for what is in blocks, and for what waits. `address` is echoed as it was asked. */
  function addressJson(address: string, script: string) {
    const totals = () => ({ funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 });
    const stats = { address, chain_stats: totals(), mempool_stats: totals() };
    for (const tx of filed(script)) {
      const side = tx.block ? stats.chain_stats : stats.mempool_stats;
      side.tx_count++;
      for (const output of tx.vout) {
        if (output.scriptHex !== script) continue;
        side.funded_txo_count++;
        side.funded_txo_sum += Number(output.value);
      }
      for (const { prevout } of tx.vin) {
        if (prevout?.scriptHex !== script) continue;
        side.spent_txo_count++;
        side.spent_txo_sum += Number(prevout.value);
      }
    }
    return stats;
  }

  /**
   * GET /address/<address>/utxo: the coins nothing spends, those in blocks
   * first. A coin that a waiting transaction spends is already left out. (To
   * Esplora a coin is there once it has heard of the transaction that made
   * it, and spent once it has heard of the one that spends it.)
   */
  function utxoJson(script: string) {
    const unspent = coinsOf(script).filter((coin) => heard(coin.tx) && !(coin.spender && heard(coin.spender)));
    return [...unspent.filter((coin) => coin.tx.block), ...unspent.filter((coin) => !coin.tx.block)].map((coin) => ({
      txid: coin.tx.txid,
      vout: coin.vout,
      status: statusJson(coin.tx),
      value: Number(coin.output.value),
    }));
  }

  /**
   * GET /address/<address>/txs: at most 50. The waiting ones come first, in
   * the order they arrived; then those in blocks, newest first.
   */
  function txsJson(script: string) {
    const all = filed(script);
    const unconfirmed = all.filter((tx) => !tx.block).slice(0, 50);
    const confirmed = all
      .filter((tx) => tx.block)
      .sort((a, b) => (b.block?.height ?? 0) - (a.block?.height ?? 0) || b.seq - a.seq)
      .slice(0, 50 - unconfirmed.length);
    return [...unconfirmed, ...confirmed].map(txJson);
  }

  return {
    height: () => tip.height,
    tip: () => tip,
    /** The chain's time in seconds: the clock's, plus what mining has added. */
    now,
    /** How many seconds Esplora takes to hear of a transaction that was not sent through it. */
    setLag(seconds: number): void {
      lag = seconds;
    },
    /** A transaction by its ID, as far as Esplora has heard of it. */
    tx(txid: string): ChainTx | undefined {
      const tx = txs.get(txid);
      return tx && heard(tx) ? tx : undefined;
    },
    coinsOf,
    mint,
    broadcast,
    mine,
    txJson,
    addressJson,
    utxoJson,
    txsJson,
  };
}
