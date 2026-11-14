// The practice network's bots, imitated for the stand-in origin: the faucet
// and the pay-it-forward pot, following bots/practice_bots/bots.py rule by
// rule, with the refusals worded as bots.py words them.
//
// The real bots ask a Bitcoin Core wallet to pay. Here a small wallet of the
// stand-in's own does it: its keys come from the seed, its coins come from
// nowhere (the chain's mint), and what it sends are real signed transactions
// that go through the same door as anybody's broadcast.

import { hex } from '@scure/base';
import { Transaction, p2wpkh } from '@scure/btc-signer';
import { pubECDSA, sha256 } from '@scure/btc-signer/utils.js';
import { RBF_SEQUENCE, REGTEST } from '@learnbitcoin/practice-wallet';
import { scriptOf, type Chain } from './fake-chain.ts';

/**
 * ok: the faucet pays. busy, refilling and failed make it refuse as the real
 * one does when it is busy, out of coins, or broken. down is not a refusal:
 * the bots are stopped (the nightly backup stops them for about half a
 * minute), so the router has nobody to hand a request to and answers 502 for
 * everything under /bots/, while the chain goes on answering.
 */
export const FAUCET_MODES = ['ok', 'busy', 'refilling', 'failed', 'down'] as const;
export type FaucetMode = (typeof FAUCET_MODES)[number];

/** An answer of the bots' API: a status and a JSON body. A refusal's body is { error: <sentence>, code: <stable code> }. */
export interface BotsAnswer {
  status: number;
  body: unknown;
}

const refusal = (status: number, code: string, error: string): BotsAnswer => ({ status, body: { error, code } });

/** The bots pay 2 sat/vB (FEE_RATE in bots/practice_bots/config.py). */
const FEE_RATE = 2n;
/** One faucet payment per address per 24 hours. */
const DAY_SECONDS = 24 * 3600;
/** Change smaller than this is not worth an output of its own (the dust limit of a P2WPKH output). */
const SMALLEST_CHANGE = 294n;
/** What the stand-in's wallet gives itself when it has no coin to spend: 50 practice bitcoin. */
const MINT_SATS = 5_000_000_000n;

/** An address of the stand-in's own wallet, with its key. */
interface OwnAddress {
  address: string;
  script: Uint8Array;
  key: Uint8Array;
  /** True for the pot's addresses, false for the wallet's own money. */
  pot: boolean;
}

interface OwnCoin {
  txid: string;
  vout: number;
  value: bigint;
  owner: OwnAddress;
  /** Height of the block that holds it. */
  height: number;
}

export function makeBots(chain: Chain, opts: { seed: string; faucetSats: bigint }) {
  /** Every address the wallet has made, by output script (hex). */
  const own = new Map<string, OwnAddress>();
  /** Address -> when the faucet last paid it, in seconds. */
  const paidAt = new Map<string, number>();
  let mode: FaucetMode = 'ok';
  let payments = 0; // every payment the wallet has made
  let faucetPayments = 0;
  let passedOn = 0; // faucet payments that carried a pot coin

  /** A key is the SHA-256 of the seed and a label: the same seed gives the same wallet, and nothing is random. */
  function newAddress(label: string, pot = false): OwnAddress {
    const key = sha256(new TextEncoder().encode(`${opts.seed}/${label}`));
    const payment = p2wpkh(pubECDSA(key), REGTEST);
    if (!payment.address) throw new Error('Address encoding failed');
    const made = { address: payment.address, script: payment.script, key, pot };
    own.set(hex.encode(made.script), made);
    return made;
  }

  /** The wallet's confirmed coins that nothing spends yet: its own money, or the pot's. Oldest first. */
  function coins(pot: boolean): OwnCoin[] {
    const found: OwnCoin[] = [];
    for (const [script, owner] of own) {
      if (owner.pot !== pot) continue;
      for (const coin of chain.coinsOf(script)) {
        if (coin.spender || !coin.tx.block) continue;
        found.push({ txid: coin.tx.txid, vout: coin.vout, value: coin.output.value, owner, height: coin.tx.block.height });
      }
    }
    // The order bots.py gives the pot's coins: most confirmations first, then by ID.
    return found.sort((a, b) => a.height - b.height || (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : a.vout - b.vout));
  }

  const treasury = newAddress('treasury');
  let pot = newAddress('pot/0', true);
  let potAddresses = 1;
  chain.mint(treasury.script, MINT_SATS);

  /** A confirmed coin of the wallet's own money worth at least `sats`: one it has, or a new one from nowhere. */
  function ownCoin(sats: bigint): OwnCoin {
    const have = coins(false).find((coin) => coin.value >= sats);
    if (have) return have;
    const value = sats > MINT_SATS / 2n ? sats * 2n : MINT_SATS;
    const minted = chain.mint(treasury.script, value);
    return { txid: minted.txid, vout: 0, value, owner: treasury, height: minted.block?.height ?? 0 };
  }

  /**
   * One payment from the wallet: a real, signed transaction that then waits
   * for a block like any other. `first`, when given, is spent before anything
   * else (the faucet passes a pot coin on this way).
   */
  function pay(to: Uint8Array, sats: bigint, first?: OwnCoin): string {
    const change = newAddress(`change/${payments}`);
    // The size of a native segwit payment is known before it is signed: 10.5
    // virtual bytes around it, 68 for each coin spent, 9 plus its script for each output.
    const fee = (inputs: number, outputs: Uint8Array[]) =>
      FEE_RATE * BigInt(Math.ceil(10.5 + 68 * inputs + outputs.reduce((sum, script) => sum + 9 + script.length, 0)));
    const both = [to, change.script];

    const spend = first ? [first] : [];
    if (!first || first.value < sats + fee(1, both)) spend.push(ownCoin(sats + fee(spend.length + 1, both)));
    const total = spend.reduce((sum, coin) => sum + coin.value, 0n);
    const left = total - sats - fee(spend.length, both);

    const outputs = [{ script: to, amount: sats }];
    // Change too small to be worth an output is left to the fee, as in any
    // wallet. Bitcoin Core shuffles its outputs; this alternates, starting with
    // the change, so that tests meet a payment at both positions.
    if (left >= SMALLEST_CHANGE) outputs.splice(payments % 2, 0, { script: change.script, amount: left });

    // lockTime and sequence as Bitcoin Core's wallet sets them: the current height, and open to replacement.
    const tx = new Transaction({ lockTime: chain.height(), lowR: true, allowUnknownOutputs: true, disableScriptCheck: true });
    for (const coin of spend) {
      tx.addInput({ txid: coin.txid, index: coin.vout, witnessUtxo: { script: coin.owner.script, amount: coin.value }, sequence: RBF_SEQUENCE });
    }
    for (const output of outputs) tx.addOutput(output);
    spend.forEach((coin, i) => tx.signIdx(coin.owner.key, i));
    tx.finalize();

    // Straight to the node, as the real bots pay: Esplora hears of it later (see fake-chain.ts).
    const sent = chain.broadcast(tx.hex, 'node');
    if (!sent.ok) throw new Error(`The stand-in's own payment was refused: ${sent.message}`);
    payments++;
    return sent.txid;
  }

  return {
    mode: (): FaucetMode => mode,
    setMode(next: FaucetMode): void {
      mode = next;
    },

    /** POST /faucet: bots.py's pay(), check by check. */
    faucet(address: string): BotsAnswer {
      if (!address || address.length > 100) return refusal(400, 'bad_address', 'Send a practice-network address');
      const to = scriptOf(address);
      if ('error' in to || !address.startsWith('bcrt1')) {
        return refusal(400, 'bad_address', 'That is not a practice-network address (they start with bcrt1)');
      }
      if (own.has(hex.encode(to.script))) {
        return refusal(400, 'own_address', "That address belongs to the practice network's own wallets");
      }
      const now = chain.now();
      const last = paidAt.get(address);
      if (last !== undefined && now - last < DAY_SECONDS) {
        return refusal(429, 'already_paid', 'This address already got practice coins today');
      }
      // The real faucet is busy after 20 payments in a minute, refills when its coins
      // run out, and fails when its node does. Here a test switches each of them on.
      if (mode === 'busy') return refusal(429, 'busy', 'The faucet is busy; try again in a minute');
      if (mode === 'refilling') return refusal(503, 'refilling', 'The faucet is refilling; try again in a minute');
      if (mode === 'failed') return refusal(500, 'failed', 'The faucet could not finish that payment');

      // The oldest coin a learner passed on goes out first, so a newcomer's
      // first coin can be traced back to an earlier learner's payment.
      const potCoin = coins(true)[0];
      const txid = pay(to.script, opts.faucetSats, potCoin);
      paidAt.set(address, now);
      faucetPayments++;
      if (potCoin) passedOn++;
      return {
        status: 200,
        body: {
          txid,
          amount_sats: Number(opts.faucetSats),
          pot_coin: potCoin ? { txid: potCoin.txid, vout: potCoin.vout, sats: Number(potCoin.value) } : null,
        },
      };
    },

    /** GET /pot/address: everyone gets the same address until a transaction pays it; only then is a new one made. */
    potAddress(): BotsAnswer {
      if (chain.coinsOf(hex.encode(pot.script)).length > 0) pot = newAddress(`pot/${potAddresses++}`, true);
      return { status: 200, body: { address: pot.address } };
    },

    /** GET /pot/stats: the pay-it-forward counter. Like the real one, it counts what is in a block. */
    potStats(): BotsAnswer {
      const received = [...own]
        .filter(([, owner]) => owner.pot)
        .flatMap(([script]) => chain.coinsOf(script))
        .filter((coin) => coin.tx.block);
      return {
        status: 200,
        body: {
          learners_passed_on: new Set(received.map((coin) => coin.tx.txid)).size,
          sats_received: received.reduce((sum, coin) => sum + Number(coin.output.value), 0),
          coins_waiting: coins(true).length,
          coins_passed_to_newcomers: passedOn,
          faucet_payments: faucetPayments,
        },
      };
    },

    /** GET /health. */
    health(): BotsAnswer {
      return {
        status: 200,
        body: {
          height: chain.height(),
          block_age_seconds: chain.now() - chain.tip().time,
          esplora_height: chain.height(),
          faucet_sats: coins(false).reduce((sum, coin) => sum + Number(coin.value), 0),
          faucet_pending_sats: 0,
          disk_used_pct: 0,
        },
      };
    },

    /**
     * A test's own way to give an address coins: a payment from the wallet,
     * either left waiting or put in a new block that holds nothing else.
     */
    fund(address: string, sats: bigint, confirmed: boolean): string {
      const to = scriptOf(address);
      if ('error' in to) throw new Error(`fund: ${to.error}: ${address}`);
      const txid = pay(to.script, sats);
      if (confirmed) chain.mine(new Set([txid]));
      return txid;
    },
  };
}
