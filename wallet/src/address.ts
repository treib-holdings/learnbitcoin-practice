// Reading an address that somebody typed, pasted or scanned.
//
// An address is a short way to write an output script: "pay to this key
// hash", "pay to this script hash". Every network spells the same script its
// own way, so that coins are not sent to the wrong chain by accident:
//   bcrt1...  the practice network (regtest)
//   tb1...    testnet and signet
//   bc1...    Bitcoin's real network
// Older base58 addresses carry a version byte instead of a prefix. Regtest
// shares its version bytes with testnet, so those are practice addresses too.
//
// The practice wallet only ever pays practice addresses. checkAddress says
// which kind a text is, so the app can explain a wrong one instead of just
// refusing it.

import { bech32, bech32m, createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { REGTEST } from './network.ts';

export type AddressCheck =
  /** Valid on the practice network. `address` is the tidy spelling: trimmed, bech32 in lower case. */
  | { kind: 'practice'; address: string }
  /** A tb1 address: the same script, written the testnet/signet way. `practiceAddress` is its bcrt1 spelling. */
  | { kind: 'other-test-network'; practiceAddress: string }
  /** An address on Bitcoin's real network. The practice wallet never pays one. */
  | { kind: 'mainnet' }
  | { kind: 'invalid' };

interface Parsed {
  check: AddressCheck;
  /** The output script (scriptPubKey) the address stands for. */
  script: Uint8Array;
  /** True for a segwit address of any version. */
  witness: boolean;
}

const base58check = createBase58check(sha256);

// Base58 version bytes on Bitcoin's real network: 0 for a key hash ("1..."), 5 for a script hash ("3...").
const MAINNET_KEY_HASH = 0x00;
const MAINNET_SCRIPT_HASH = 0x05;

/** bech32 (segwit) addresses: BIP173 for version 0, BIP350 for every later version. */
function parseSegwit(text: string): Parsed | null {
  // BIP173 allows printable ASCII only (character codes 33 to 126), and so
  // does Bitcoin Core. This comes before the case is changed, because
  // lower-casing turns one character from outside that range into a plain
  // letter: the Kelvin sign (U+212A) becomes "k".
  if (!/^[\x21-\x7e]+$/.test(text)) return null;
  // QR codes carry addresses in capitals, which is allowed. A mix of both cases is not.
  const lower = text.toLowerCase();
  if (text !== lower && text !== text.toUpperCase()) return null;

  // Two checksums exist. Version 0 addresses must carry the first (bech32),
  // every later version the second (bech32m). At most one of them matches.
  const first = bech32.decodeUnsafe(lower);
  const second = first ? undefined : bech32m.decodeUnsafe(lower);
  const decoded = first || second;
  if (!decoded) return null;
  const coder = first ? bech32 : bech32m;

  const [version, ...rest] = decoded.words;
  if (version === undefined || (version === 0) !== (coder === bech32)) return null;
  const program = coder.fromWordsUnsafe(rest);
  if (!program) return null;
  // BIP141: versions 0 to 16 and programs of 2 to 40 bytes. Version 0 means
  // exactly a 20-byte key hash (P2WPKH) or a 32-byte script hash (P2WSH).
  if (version > 16 || program.length < 2 || program.length > 40) return null;
  if (version === 0 && program.length !== 20 && program.length !== 32) return null;

  // The script is the version (OP_0, or OP_1 to OP_16) and one push of the program.
  const script = Uint8Array.from([version === 0 ? 0x00 : 0x50 + version, program.length, ...program]);
  if (decoded.prefix === REGTEST.bech32) return { check: { kind: 'practice', address: lower }, script, witness: true };
  if (decoded.prefix === 'tb') {
    // The same version and program under the practice network's prefix.
    const practiceAddress = coder.encode(REGTEST.bech32, decoded.words);
    return { check: { kind: 'other-test-network', practiceAddress }, script, witness: true };
  }
  if (decoded.prefix === 'bc') return { check: { kind: 'mainnet' }, script, witness: true };
  return null;
}

/** Base58 addresses: a version byte, a 20-byte hash and a checksum. */
function parseBase58(text: string): Parsed | null {
  let bytes: Uint8Array;
  try {
    bytes = base58check.decode(text);
  } catch {
    return null;
  }
  if (bytes.length !== 21) return null;
  const version = bytes[0];
  const hash = bytes.subarray(1);
  const keyHash = version === REGTEST.pubKeyHash || version === MAINNET_KEY_HASH;
  const scriptHash = version === REGTEST.scriptHash || version === MAINNET_SCRIPT_HASH;
  if (!keyHash && !scriptHash) return null;
  const script = keyHash
    ? Uint8Array.from([0x76, 0xa9, 0x14, ...hash, 0x88, 0xac]) // OP_DUP OP_HASH160 <hash> OP_EQUALVERIFY OP_CHECKSIG
    : Uint8Array.from([0xa9, 0x14, ...hash, 0x87]); // OP_HASH160 <hash> OP_EQUAL
  const practice = version === REGTEST.pubKeyHash || version === REGTEST.scriptHash;
  return { check: practice ? { kind: 'practice', address: text } : { kind: 'mainnet' }, script, witness: false };
}

function parse(input: string): Parsed | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  return parseSegwit(text) ?? parseBase58(text);
}

function parsePractice(address: string): Parsed {
  const parsed = parse(address);
  if (!parsed || parsed.check.kind !== 'practice') throw new Error('Not a practice-network address');
  return parsed;
}

/** Which network an address belongs to, checksum verified. Surrounding white space is ignored. */
export function checkAddress(input: string): AddressCheck {
  return parse(input)?.check ?? { kind: 'invalid' };
}

/** The output script (scriptPubKey) a practice address pays to. Throws for anything else. */
export function addressScript(address: string): Uint8Array {
  return parsePractice(address).script;
}

/**
 * The smallest amount, in satoshis, the network will relay to this address.
 * Anything less is "dust": an output that costs more to spend than it holds.
 *
 * This is Bitcoin Core's rule at its default dust rate of 3 sat/vB: take the
 * size of the output itself (8 bytes of amount, the script and its length
 * byte), add the size of the input that would one day spend it (67 vbytes
 * for a segwit output, 148 bytes otherwise), and multiply by 3. That gives
 * 294 for P2WPKH, 330 for P2WSH and taproot, 546 for P2PKH and 540 for P2SH.
 * Throws for anything but a practice address.
 */
export function dustLimit(address: string): bigint {
  const { script, witness } = parsePractice(address);
  return 3n * BigInt(8 + 1 + script.length + (witness ? 67 : 148));
}

/**
 * A BIP21 amount is a decimal number of bitcoin ("0.001"). Read it as text,
 * digit by digit: a floating-point number cannot hold every amount exactly.
 */
function btcToSats(text: string): bigint | null {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (whole === '' && fraction === '') return null;
  // A satoshi is the eighth decimal place, and there will never be more than 21,000,000 bitcoin.
  if (fraction.length > 8 || whole.length > 8) return null;
  return BigInt(whole || '0') * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
}

/**
 * What a "send to" field was given: a bare address, or a BIP21 payment link
 * (bitcoin:<address>?amount=<bitcoin>), as a QR code or a "pay" button
 * carries it. `amountSats` is null when the link names no usable amount.
 */
export function parsePaymentInput(input: string): { address: AddressCheck; amountSats: bigint | null } {
  const text = typeof input === 'string' ? input.trim() : '';
  // The scheme may be written in any case. Everything after it is case-sensitive.
  if (!/^bitcoin:/i.test(text)) return { address: checkAddress(text), amountSats: null };

  const rest = text.slice('bitcoin:'.length);
  const mark = rest.indexOf('?');
  const address = mark < 0 ? rest : rest.slice(0, mark);
  const query = mark < 0 ? '' : rest.slice(mark + 1);

  let amountSats: bigint | null = null;
  let amounts = 0;
  for (const pair of query.split('&')) {
    const equals = pair.indexOf('=');
    const key = equals < 0 ? pair : pair.slice(0, equals);
    const value = equals < 0 ? '' : pair.slice(equals + 1);
    if (key === 'amount') {
      amounts++;
      amountSats = btcToSats(value);
    } else if (key.startsWith('req-')) {
      // BIP21: a "req-" parameter is one the sender insists on. A wallet that
      // does not know it must treat the whole link as invalid. This wallet knows none.
      return { address: { kind: 'invalid' }, amountSats: null };
    }
    // label, message and anything else: ignored.
  }
  // Two amounts in one link contradict each other: take neither.
  if (amounts > 1) amountSats = null;
  return { address: checkAddress(address), amountSats };
}
