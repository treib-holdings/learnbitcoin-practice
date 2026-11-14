import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bech32, bech32m, createBase58check, hex } from '@scure/base';
import { Address, OutScript } from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha2.js';
import { REGTEST, addressScript, checkAddress, dustLimit, parsePaymentInput } from '../src/index.ts';
import { V } from './helpers.ts';

const base58check = createBase58check(sha256);

// The practice wallet's own first address, and the same key written for other networks.
const OWN = V.abandon.receive[0] as string; // bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk
const OWN_ON_TESTNET = 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl';
// Published examples with the test-network version bytes, which regtest shares:
// "abandon ... about" at m/44'/1'/0'/0/0 (P2PKH) and BIP49's test vector (P2SH).
const TEST_P2PKH = 'mkpZhYtJu2r87Js3pDiWJDmPte2NRZ8bJV';
const TEST_P2SH = '2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2';
// Addresses on Bitcoin's real network, all published: BIP84's first address,
// the genesis block's address, and the examples in BIP173 and BIP350.
const MAINNET = [
  'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
  '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
  'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
  'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
  'bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs',
  'BC1SW50QGDZ25J',
];

const segwit = (prefix: string, version: number, program: Uint8Array, coder = version === 0 ? bech32 : bech32m) =>
  coder.encode(prefix, [version, ...coder.toWords(program)]);
const P2WSH = segwit('bcrt', 0, new Uint8Array(32).fill(0x11));
const TAPROOT = segwit('bcrt', 1, new Uint8Array(32).fill(0x22));
const ANCHOR = 'bcrt1pfeesnyr2tx'; // pay-to-anchor: version 1 with the two-byte program 4e73

test('practice: bcrt1 addresses of every witness version, checksum verified', () => {
  assert.deepEqual(checkAddress(OWN), { kind: 'practice', address: OWN });
  assert.deepEqual(checkAddress(P2WSH), { kind: 'practice', address: P2WSH });
  assert.deepEqual(checkAddress(TAPROOT), { kind: 'practice', address: TAPROOT });
  assert.deepEqual(checkAddress(ANCHOR), { kind: 'practice', address: ANCHOR });
  assert.match(TAPROOT, /^bcrt1p/);
  // Versions the network has not given a meaning yet are valid addresses all the same (BIP350).
  for (const [version, length] of [[1, 40], [2, 16], [2, 32], [16, 2], [16, 40]] as const) {
    const future = segwit('bcrt', version, new Uint8Array(length).fill(version));
    assert.deepEqual(checkAddress(future), { kind: 'practice', address: future }, `version ${version}, ${length} bytes`);
  }
  for (const address of [...V.abandon.receive, ...V.abandon.change, ...V.prf.wallet.receive]) {
    assert.equal(checkAddress(address).kind, 'practice');
  }
});

test('practice: base58 addresses with the test-network version bytes', () => {
  assert.deepEqual(checkAddress(TEST_P2PKH), { kind: 'practice', address: TEST_P2PKH });
  assert.deepEqual(checkAddress(TEST_P2SH), { kind: 'practice', address: TEST_P2SH });
});

test('capitals are accepted and lower-cased, mixed case is not, white space around is trimmed', () => {
  assert.deepEqual(checkAddress(OWN.toUpperCase()), { kind: 'practice', address: OWN });
  assert.deepEqual(checkAddress(`  ${OWN}\n`), { kind: 'practice', address: OWN });
  assert.deepEqual(checkAddress(`\t${TAPROOT.toUpperCase()} `), { kind: 'practice', address: TAPROOT });
  assert.deepEqual(checkAddress(` ${TEST_P2PKH} `), { kind: 'practice', address: TEST_P2PKH });
  assert.deepEqual(checkAddress(OWN.slice(0, -1) + OWN.slice(-1).toUpperCase()), { kind: 'invalid' });
  assert.deepEqual(checkAddress(`BCRT1${OWN.slice(5)}`), { kind: 'invalid' });
  assert.deepEqual(checkAddress(`${OWN.slice(0, 20)} ${OWN.slice(20)}`), { kind: 'invalid' }, 'a space inside');
  // Base58 has no "all capitals" form: changing case changes the address, and the checksum catches it.
  assert.deepEqual(checkAddress(TEST_P2PKH.toUpperCase()), { kind: 'invalid' });
  assert.deepEqual(checkAddress(TEST_P2PKH.toLowerCase()), { kind: 'invalid' });
});

test('other-test-network: a tb1 address comes back as the bcrt1 spelling of the same script', () => {
  assert.deepEqual(checkAddress(OWN_ON_TESTNET), { kind: 'other-test-network', practiceAddress: OWN });
  assert.deepEqual(checkAddress(OWN_ON_TESTNET.toUpperCase()), { kind: 'other-test-network', practiceAddress: OWN });

  // BIP173 and BIP350 test vectors: testnet addresses with the output script each one stands for.
  const published: [string, string][] = [
    ['tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7', '00201863143c14c5166804bd19203356da136c985678cd4d27a1b8c6329604903262'],
    ['tb1qqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesrxh6hy', '0020000000c4a5cad46221b2a187905e5266362b99d5e91c6ce24d165dab93e86433'],
    ['tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c', '5120000000c4a5cad46221b2a187905e5266362b99d5e91c6ce24d165dab93e86433'],
  ];
  for (const [address, script] of published) {
    const check = checkAddress(address);
    assert.equal(check.kind, 'other-test-network');
    if (check.kind !== 'other-test-network') continue;
    assert.match(check.practiceAddress, /^bcrt1/);
    assert.deepEqual(checkAddress(check.practiceAddress), { kind: 'practice', address: check.practiceAddress });
    assert.equal(hex.encode(addressScript(check.practiceAddress)), script);
  }
});

test('mainnet: bc1 and base58 addresses of the real network are named, never accepted', () => {
  for (const address of MAINNET) assert.deepEqual(checkAddress(address), { kind: 'mainnet' }, address);
  assert.deepEqual(checkAddress(' bc1pfeessrawgf '), { kind: 'mainnet' });
});

test('invalid: BIP350 lists these, each broken in a different way', () => {
  const broken = [
    'tc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq5zuyut', // a prefix no network uses
    'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd', // version 1 with the old checksum
    'tb1z0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqglt7rf', // version 2 with the old checksum
    'BC1S0XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ54WELL', // version 16 with the old checksum
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh', // version 0 with the new checksum
    'tb1q0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq24jc47', // version 0 with the new checksum
    'bc1p38j9r5y49hruaue7wxjce0updqjuyyx0kh56v8s25huc6995vvpql3jow4', // a character bech32 does not have
    'BC130XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ7ZWS8R', // witness version 17
    'bc1pw5dgrnzv', // a 1-byte program
    'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v8n0nx0muaewav253zgeav', // a 41-byte program
    'BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P', // version 0 with a 16-byte program
    'tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq47Zagq', // mixed case
    'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf', // too much padding
    'tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vpggkg4j', // padding that is not zero
    'bc1gmk9yu', // no data at all
  ];
  for (const address of broken) assert.deepEqual(checkAddress(address), { kind: 'invalid' }, address);
});

test('invalid: the same mistakes on the practice network, and things that are not addresses', () => {
  const program = new Uint8Array(32).fill(0x33);
  const broken = [
    OWN.slice(0, -1) + (OWN.endsWith('q') ? 'p' : 'q'), // one wrong character: the checksum catches it
    OWN.slice(0, -1), // one character short
    segwit('bcrt', 1, program, bech32), // version 1 with the old checksum
    segwit('bcrt', 0, program, bech32m), // version 0 with the new checksum
    segwit('bcrt', 0, new Uint8Array(16).fill(1)), // version 0 must be 20 or 32 bytes
    segwit('bcrt', 17, program), // no witness version 17
    segwit('bcrt', 1, new Uint8Array(1)), // too short
    segwit('bcrt', 1, new Uint8Array(41)), // too long
    segwit('ltc', 0, new Uint8Array(20).fill(1)), // another coin's prefix
    base58check.encode(Uint8Array.from([0x30, ...new Uint8Array(20).fill(1)])), // another coin's version byte
    base58check.encode(Uint8Array.from([REGTEST.pubKeyHash, ...new Uint8Array(19).fill(1)])), // a hash one byte short
    TEST_P2PKH.slice(0, -1) + (TEST_P2PKH.endsWith('V') ? 'W' : 'V'), // base58 with a wrong checksum
    V.abandon.xpub, // an extended public key is not an address
    'ab'.repeat(32), // nor is a transaction ID
    '',
    '   ',
    'bcrt1',
    'not an address',
  ];
  for (const address of broken) assert.deepEqual(checkAddress(address), { kind: 'invalid' }, address);
  assert.deepEqual(checkAddress(undefined as never), { kind: 'invalid' });
});

test('invalid: a character outside printable ASCII, even one that lower-cases to a letter', () => {
  // The Kelvin sign (U+212A) looks like K and lower-cases to "k", so an
  // address in capitals with it in place of a K reads as the real address
  // once lower-cased. BIP173 and Bitcoin Core accept characters 33 to 126 only.
  const kelvin = String.fromCharCode(0x212a);
  const odd = OWN.toUpperCase().replace(/K$/, kelvin);
  assert.notEqual(odd, OWN.toUpperCase());
  assert.equal(odd.toLowerCase(), OWN, 'lower-cased, it is the real address');
  assert.deepEqual(checkAddress(odd), { kind: 'invalid' });
  assert.deepEqual(parsePaymentInput(odd), { address: { kind: 'invalid' }, amountSats: null });
  assert.deepEqual(parsePaymentInput(`BITCOIN:${odd}?amount=0.001`), { address: { kind: 'invalid' }, amountSats: 100_000n });
  assert.throws(() => addressScript(odd), /practice/);
  assert.throws(() => dustLimit(odd), /practice/);
  // The same on the other networks: not "another network's address", just not an address.
  assert.deepEqual(checkAddress(OWN_ON_TESTNET.toUpperCase().replace('K', kelvin)), { kind: 'invalid' });
  assert.deepEqual(checkAddress('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4'.replace('K', kelvin)), { kind: 'invalid' });

  // Other look-alikes and stray characters were never accepted, and are not now.
  const others: [string, string][] = [
    ['a long s (U+017F) for the s', OWN.replace('s', String.fromCharCode(0x17f))],
    ['a full-width K (U+FF2B) for the last K', OWN.toUpperCase().replace(/K$/, String.fromCharCode(0xff2b))],
    ['an Angstrom sign (U+212B) for the last K', OWN.toUpperCase().replace(/K$/, String.fromCharCode(0x212b))],
    ['a zero-width space (U+200B) inside', `${OWN.slice(0, 20)}${String.fromCharCode(0x200b)}${OWN.slice(20)}`],
    ['a control character (7) at the end', OWN + String.fromCharCode(7)],
    ['a delete character (127) at the end', OWN + String.fromCharCode(127)],
  ];
  for (const [what, address] of others) assert.deepEqual(checkAddress(address), { kind: 'invalid' }, what);
});

test('addressScript writes the script Bitcoin expects for every kind of practice address', () => {
  // @scure/btc-signer's own address decoder is the second opinion.
  for (const address of [OWN, P2WSH, TAPROOT, ANCHOR, TEST_P2PKH, TEST_P2SH]) {
    assert.deepEqual(addressScript(address), OutScript.encode(Address(REGTEST).decode(address)), address);
  }
  assert.equal(hex.encode(addressScript(OWN.toUpperCase())), '0014d0c4a3ef09e997b6e99e397e518fe3e41a118ca1');
  assert.equal(hex.encode(addressScript(ANCHOR)), '51024e73');
  assert.equal(hex.encode(addressScript(segwit('bcrt', 16, Uint8Array.from([0x75, 0x1e])))), '6002751e');
  assert.throws(() => addressScript(OWN_ON_TESTNET), /practice/);
  assert.throws(() => addressScript(MAINNET[0]!), /practice/);
  assert.throws(() => addressScript('nonsense'), /practice/);
});

test('dustLimit follows Bitcoin Core: 294, 330, 546 and 540 sats', () => {
  assert.equal(dustLimit(OWN), 294n, 'P2WPKH');
  assert.equal(dustLimit(P2WSH), 330n, 'P2WSH');
  assert.equal(dustLimit(TAPROOT), 330n, 'taproot');
  assert.equal(dustLimit(TEST_P2PKH), 546n, 'P2PKH');
  assert.equal(dustLimit(TEST_P2SH), 540n, 'P2SH');
  // The rule itself: (output size + 67 for segwit, or + 148) * 3. A 4-byte anchor script gives (13 + 67) * 3.
  assert.equal(dustLimit(ANCHOR), 240n);
  assert.equal(dustLimit(` ${OWN.toUpperCase()} `), 294n);
  assert.throws(() => dustLimit(OWN_ON_TESTNET), /practice/);
  assert.throws(() => dustLimit(MAINNET[1]!), /practice/);
  assert.throws(() => dustLimit(''), /practice/);
});

test('parsePaymentInput: a bare address has no amount', () => {
  assert.deepEqual(parsePaymentInput(OWN), { address: { kind: 'practice', address: OWN }, amountSats: null });
  assert.deepEqual(parsePaymentInput(` ${OWN.toUpperCase()}\n`), { address: { kind: 'practice', address: OWN }, amountSats: null });
  assert.deepEqual(parsePaymentInput(OWN_ON_TESTNET), { address: { kind: 'other-test-network', practiceAddress: OWN }, amountSats: null });
  assert.deepEqual(parsePaymentInput('hello'), { address: { kind: 'invalid' }, amountSats: null });
  assert.deepEqual(parsePaymentInput(''), { address: { kind: 'invalid' }, amountSats: null });
  assert.deepEqual(parsePaymentInput(`${OWN}?amount=1`), { address: { kind: 'invalid' }, amountSats: null }, 'a query without the scheme');
});

test('parsePaymentInput: BIP21 links, with the scheme in any case', () => {
  const practice = { kind: 'practice', address: OWN };
  assert.deepEqual(parsePaymentInput(`bitcoin:${OWN}`), { address: practice, amountSats: null });
  assert.deepEqual(parsePaymentInput(`bitcoin:${OWN}?amount=0.001`), { address: practice, amountSats: 100_000n });
  assert.deepEqual(parsePaymentInput(`BITCOIN:${OWN.toUpperCase()}?amount=0.001`), { address: practice, amountSats: 100_000n });
  assert.deepEqual(parsePaymentInput(`  BitCoin:${OWN}?amount=1  `), { address: practice, amountSats: 100_000_000n });
  assert.deepEqual(parsePaymentInput(`bitcoin:${OWN}?label=Faucet&amount=0.00000294&message=thanks%20a%20lot`), {
    address: practice,
    amountSats: 294n,
  });
  // An example from BIP21 itself. Its amount reads as 20.3 bitcoin; its address
  // is for show and does not pass its own checksum, which checkAddress notices.
  assert.deepEqual(parsePaymentInput('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=20.3&label=Luke-Jr'), {
    address: { kind: 'invalid' },
    amountSats: 2_030_000_000n,
  });
  assert.deepEqual(parsePaymentInput('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=50&label=Genesis'), {
    address: { kind: 'mainnet' },
    amountSats: 5_000_000_000n,
  });
  assert.deepEqual(parsePaymentInput(`bitcoin:${OWN_ON_TESTNET}?amount=50`), {
    address: { kind: 'other-test-network', practiceAddress: OWN },
    amountSats: 5_000_000_000n,
  });
  assert.deepEqual(parsePaymentInput('bitcoin:'), { address: { kind: 'invalid' }, amountSats: null });
  assert.deepEqual(parsePaymentInput('bitcoin:?amount=1'), { address: { kind: 'invalid' }, amountSats: 100_000_000n });
});

test('parsePaymentInput: amounts are read as text, to the satoshi, never through floating point', () => {
  const amount = (text: string) => parsePaymentInput(`bitcoin:${OWN}?amount=${text}&label=x`).amountSats;
  assert.equal(amount('0.1'), 10_000_000n);
  assert.equal(amount('0.3'), 30_000_000n); // 0.1 + 0.2 in floating point is not 0.3; text has no such trouble
  assert.equal(amount('0.00000001'), 1n);
  assert.equal(amount('20999999.9769'), 2_099_999_997_690_000n); // every bitcoin there will ever be
  assert.equal(amount('1.10000000'), 110_000_000n);
  assert.equal(amount('50'), 5_000_000_000n);
  assert.equal(amount('50.00'), 5_000_000_000n);
  assert.equal(amount('0'), 0n);
  assert.equal(amount('007'), 700_000_000n);
  // BIP21's grammar allows a missing digit on either side of the period.
  assert.equal(amount('.5'), 50_000_000n);
  assert.equal(amount('5.'), 500_000_000n);

  for (const bad of ['0.000000001', '1.123456789', '0.100000000', '-1', '-0.5', '+1', '1e3', '1,5', '50,000.00', '0x10', '1 ', 'abc', '', '.', '1.2.3', '100000000']) {
    assert.equal(amount(bad), null, JSON.stringify(bad));
  }
  // A digit from another script (Arabic-Indic one) is not one of 0 to 9.
  assert.equal(amount(String.fromCharCode(0x661)), null);
});

test('parsePaymentInput: unknown parameters are ignored, an unknown req- parameter spoils the link', () => {
  const practice = { kind: 'practice', address: OWN };
  assert.deepEqual(parsePaymentInput(`bitcoin:${OWN}?somethingnew=1&amount=0.5&lightning=lnbc1`), { address: practice, amountSats: 50_000_000n });
  // Parameter names are case-sensitive: "AMOUNT" is just a parameter this wallet does not know.
  assert.deepEqual(parsePaymentInput(`bitcoin:${OWN}?AMOUNT=0.5`), { address: practice, amountSats: null });
  assert.deepEqual(parsePaymentInput(`bitcoin:${OWN}?amount`), { address: practice, amountSats: null });
  // BIP21's own example of a link a wallet must refuse.
  assert.deepEqual(
    parsePaymentInput('bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?req-somethingyoudontunderstand=50&req-somethingelseyoudontget=999'),
    { address: { kind: 'invalid' }, amountSats: null },
  );
  assert.deepEqual(parsePaymentInput(`bitcoin:${OWN}?amount=0.5&req-expiry=10`), { address: { kind: 'invalid' }, amountSats: null });
  assert.deepEqual(parsePaymentInput(`bitcoin:${OWN}?req-amount=0.5`), { address: { kind: 'invalid' }, amountSats: null });
  // Two amounts contradict each other: neither is used.
  assert.deepEqual(parsePaymentInput(`bitcoin:${OWN}?amount=1&amount=2`), { address: practice, amountSats: null });
});
