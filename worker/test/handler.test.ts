import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADDRESS_PATTERN, API, ERROR_STATUS } from '@learnbitcoin/practice-contract';
import type { ErrorCode } from '@learnbitcoin/practice-contract';
import type { Fault, LogLine } from '../src/deps.ts';
import {
  EVENT_BODY_MAX,
  FAUCET_BODY_MAX,
  OLDER_PAGES,
  OLDER_PAGE_COST,
  TX_HEX_MAX,
  chainReadCost,
  esploraReadPath,
  isPracticeAddress,
  makeHandler,
} from '../src/handler.ts';
import { FIXED_HEADERS } from '../src/headers.ts';
import { readerKey } from '../src/reader-key.ts';
import {
  ADDRESS,
  APP,
  CONFIG,
  POT_ADDRESS,
  READER_IP,
  READER_IP6,
  TXID,
  countingLimiter,
  errorOf,
  get,
  harness,
  noNetwork,
  post,
  readJson,
  wranglerConfig,
} from './fakes.ts';
import type { Harness, HarnessOptions } from './fakes.ts';

noNetwork();

const HEX = '0200000001abcdef';
const TOKEN = 'token-from-the-widget';
const FAUCET_BODY = { address: ADDRESS, token: TOKEN };
const EVENT = { name: 'Passkey', path: '/new', value: 'ok' };

/** A taproot address: the first address of BIP 86's test vectors, spelled the practice network's way. */
const TAPROOT = 'bcrt1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqvg32hk';
/** ADDRESS with its last character changed: all the looks of an address, and a checksum that does not fit. */
const NEARLY = `${ADDRESS.slice(0, -1)}${ADDRESS.endsWith('q') ? 'p' : 'q'}`;

// The addresses below were made with the library the wallet reads addresses
// with (@scure/base), from the version and the bytes each line names.
// "00..13" is the bytes 00, 01, 02 and so on up to 13 (hex).
const ADDRESSES: Array<[what: string, address: string]> = [
  ['a key hash (P2WPKH): version 0, the 20 bytes 00..13', 'bcrt1qqqqsyqcyq5rqwzqfpg9scrgwpugpzysnard0ew'],
  ['a script hash (P2WSH): version 0, the 32 bytes 00..1f', 'bcrt1qqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0scjhmyt'],
  ['taproot: version 1, the 32 bytes 00..1f', 'bcrt1pqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0sj9hjuh'],
  ["taproot: BIP 86's first address", TAPROOT],
  ['pay to anchor: version 1, the 2 bytes 4e 73, with four bits to spare', 'bcrt1pfeesnyr2tx'],
  ['version 2, the 3 bytes 00 01 02, with one bit to spare', 'bcrt1zqqqsyyyf2ep'],
  ['version 1, 4 bytes of zeros, with three bits to spare', 'bcrt1pqqqqqqqzc95z6'],
  ['version 1, 5 bytes of zeros, with no bit to spare', 'bcrt1pqqqqqqqq93hrg4'],
  ['version 1, 6 bytes of zeros, with two bits to spare', 'bcrt1pqqqqqqqqqqcwfmad'],
  ['as short as an address gets: version 16, the 2 bytes 00 01', 'bcrt1sqqqsq0cn3a'],
  ['as long as an address gets: version 16, the 40 bytes 00..27', 'bcrt1sqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0jqgfzyvjz2f38rhf4f4'],
];

/**
 * Text that fits the contract's pattern and is no address. The first four
 * have no checksum to speak of. The others were made the same way as the
 * addresses above, each with a checksum worked out over its own characters,
 * so the only thing wrong with one is what its line names.
 */
const LOOKALIKES: Array<[what: string, text: string]> = [
  ['only the looks of an address', 'bcrt1qqqqqqqqqqqq'],
  ['the longest text the pattern takes', `bcrt1${'q'.repeat(71)}`],
  ['the looks of a taproot address', `bcrt1p${'q'.repeat(58)}`],
  ['an address with its last character changed', NEARLY],
  ['a taproot address under the checksum of version 0', 'bcrt1pqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0s8e87e4'],
  ['a version 0 address under the checksum of the later versions', 'bcrt1qqqqsyqcyq5rqwzqfpg9scrgwpugpzysnglaruv'],
  ['version 17, which does not exist', 'bcrt13qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0sw3dsfm'],
  ['version 31, which does not exist', 'bcrt1lqqqsyqcyq5rqwzqfpg9scrgwpugpzysnwaw922'],
  ['version 0 with 21 bytes', 'bcrt1qqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzshh9yaa'],
  ['version 0 with 16 bytes', 'bcrt1qqqqsyqcyq5rqwzqfpg9scrgwpupkf6zw'],
  ['version 0 with 2 bytes', 'bcrt1qqqqs8rnyk0'],
  ['version 0 with 40 bytes', 'bcrt1qqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0jqgfzyvjz2f38s993a3'],
  ['pay to anchor with one of its four spare bits set', 'bcrt1pfee3wjhlk5'],
  ['version 1, 4 bytes of zeros with one of the three spare bits set', 'bcrt1pqqqqqqydj8jdq'],
  // A program is written five bits to a character, so five bits or more left over are a character too many.
  ['version 1, 5 bytes of zeros and five bits over', 'bcrt1pqqqqqqqqqd6hexs'],
  ['version 1, 3 bytes of zeros and six bits over', 'bcrt1pqqqqqqtuwkvn'],
  ['version 1, 6 bytes of zeros and seven bits over', 'bcrt1pqqqqqqqqqqqtd4t8k'],
];

/** One good POST for each of the four POST routes. */
const POSTS: Array<[path: string, body: string | object | null]> = [
  [`${API.esplora}/tx`, HEX],
  [API.faucet, FAUCET_BODY],
  [API.potAddress, null],
  [API.event, EVENT],
];

async function run(
  request: Request,
  options: HarnessOptions = {},
): Promise<{ response: Response; h: Harness; request: Request }> {
  const h = harness(options);
  const response = await makeHandler(h.deps)(request);
  await Promise.all(h.pending);
  return { response, h, request };
}

/** Checks a refusal: its status, its body, and that nothing outside was asked unless `asked` says so. */
async function refusedWith(
  request: Request,
  code: ErrorCode,
  asked: string[] = [],
  options: HarnessOptions = {},
): Promise<Harness> {
  const { response, h } = await run(request, options);
  assert.equal(response.status, ERROR_STATUS[code], `${request.method} ${request.url}`);
  assert.deepEqual(await errorOf(response), { error: code }, `${request.method} ${request.url}`);
  assert.deepEqual(h.trace, asked, `${request.method} ${request.url}`);
  return h;
}

// -- config ---------------------------------------------------------------------

test('GET /api/config answers the config, numbers as numbers', async () => {
  const { response, h } = await run(get(API.config));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), CONFIG);
  assert.match(text, /"electrumPort":50002,/);
  assert.deepEqual(h.trace, [], 'no limiter and no origin for a constant answer');
  assert.deepEqual(h.lines, [{ route: 'config', status: 200, upstream: null, ms: 5, fault: null }]);
});

// -- the Esplora allowlist --------------------------------------------------------

/** What may follow an address in a chain read: nothing, or one of these. */
const ADDRESS_TAILS = ['', '/utxo', '/txs', '/txs/chain', `/txs/chain/${TXID}`];

const READS: Array<[path: string, upstream: string]> = [
  [`${API.esplora}/blocks/tip/height`, '/blocks/tip/height'],
  [`${API.esplora}/address/${ADDRESS}`, `/address/${ADDRESS}`],
  [`${API.esplora}/address/${ADDRESS}/utxo`, `/address/${ADDRESS}/utxo`],
  [`${API.esplora}/address/${ADDRESS}/txs`, `/address/${ADDRESS}/txs`],
  // The older pages of a long list: the newest 25 confirmed ones, and the 25 after a given one.
  [`${API.esplora}/address/${ADDRESS}/txs/chain`, `/address/${ADDRESS}/txs/chain`],
  [`${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}`, `/address/${ADDRESS}/txs/chain/${TXID}`],
  [`${API.esplora}/tx/${TXID}`, `/tx/${TXID}`],
];

test('the seven chain reads reach the origin, each with a path rebuilt from its checked parts', async () => {
  assert.equal(READS.length, 7);
  for (const [path, upstream] of READS) {
    const { response, h } = await run(get(path));
    assert.equal(response.status, 200, path);
    assert.deepEqual(h.trace, ['limit:chain', 'origin:esplora'], path);
    assert.deepEqual(h.originArgs, [upstream], path);
    assert.equal(await response.text(), '{"ok":true}', 'the body is passed on');
    assert.deepEqual(h.lines, [], 'a chain read that went well writes no log line');
    // Each counts as one read at the limiter. One counts as 50: the page of older transactions asked for by an ID.
    assert.deepEqual(h.limiters.chain.costs, [upstream === `/address/${ADDRESS}/txs/chain/${TXID}` ? 50 : 1], path);
  }
  // A taproot address is as good as a segwit one.
  const { h } = await run(get(`${API.esplora}/address/${TAPROOT}/txs`));
  assert.deepEqual(h.originArgs, [`/address/${TAPROOT}/txs`]);
  const paged = await run(get(`${API.esplora}/address/${TAPROOT}/txs/chain/${'0'.repeat(64)}`));
  assert.deepEqual(paged.h.originArgs, [`/address/${TAPROOT}/txs/chain/${'0'.repeat(64)}`]);
});

test('the two shapes for the older pages of an address are chain reads: the same limiter and the same silence, and the page asked for by an ID is counted apart, as 50', async () => {
  assert.equal(OLDER_PAGE_COST, 50);
  assert.equal(OLDER_PAGES, 'older-pages');
  for (const [tail, cost] of [['/txs/chain', 1], [`/txs/chain/${TXID}`, OLDER_PAGE_COST]] as const) {
    const path = `${API.esplora}/address/${ADDRESS}${tail}`;
    // The chain limiter is asked, and no other; then the origin, with the path put together again.
    const { response, h } = await run(get(path, { 'CF-Connecting-IP': READER_IP }));
    assert.equal(response.status, 200, tail);
    assert.deepEqual(h.trace, ['limit:chain', 'origin:esplora'], tail);
    assert.deepEqual(h.originArgs, [`/address/${ADDRESS}${tail}`], tail);
    // One call to the limiter. The newest 25 count as one read under the reader's key for chain
    // reads, like any other read. The 25 after a given ID count as 50, under a second key of the
    // same reader, so in a count of their own: to find that ID Esplora reads down the address's
    // list, however long it is.
    const key = await readerKey('chain', READER_IP);
    assert.deepEqual(h.limiters.chain.costs, [cost], tail);
    assert.deepEqual(h.limiters.chain.keys, [cost === 1 ? key : `${key}:older-pages`], tail);
    assert.ok(!h.limiters.chain.keys[0]!.includes(READER_IP), 'neither key holds the reader address');
    // The call itself: the key, and a weight only where the read counts for more than one. Every
    // other read is asked for exactly as it was before there were weights.
    assert.deepEqual(h.limiters.chain.asked, [cost === 1 ? { key } : { key: `${key}:older-pages`, delta: 50 }], tail);
    for (const name of ['broadcast', 'faucet', 'pot', 'events'] as const) assert.deepEqual(h.limiters[name].keys, [], `${tail} ${name}`);
    // It went well: nothing is written. Its URL holds an address, and in the second shape a transaction ID as well.
    assert.deepEqual(h.lines, [], tail);

    // Over the budget, the origin is not asked, and that is nobody's fault either.
    const limited = await refusedWith(get(path), 'limit', ['limit:chain'], { over: ['chain'] });
    assert.deepEqual(limited.lines, [], tail);

    // Broken: one line, which names the route and the fault and nothing of the path.
    const broken = await refusedWith(get(path), 'unavailable', ['limit:chain', 'origin:esplora'], {
      esplora: () => ({ ok: false, code: 'unavailable', detail: null, upstream: 502, fault: 'origin_down' }),
    });
    assert.deepEqual(broken.lines, [{ route: 'esplora_read', status: 502, upstream: 502, ms: 5, fault: 'origin_down' }], tail);
    assert.doesNotMatch(JSON.stringify(broken.lines), /bcrt1|[0-9a-f]{64}|chain/);

    // Reading only: a POST is the wrong method, from our own page or anywhere else.
    const posted = await refusedWith(post(path, HEX), 'method');
    assert.deepEqual(posted.lines, [], tail);
  }
});

test('what a chain read counts for: one, and 50 for a page of older transactions asked for by an ID', () => {
  for (const [, upstream] of READS) {
    assert.equal(chainReadCost(upstream), upstream === `/address/${ADDRESS}/txs/chain/${TXID}` ? OLDER_PAGE_COST : 1, upstream);
  }
  // Whatever the address and whatever the ID.
  assert.equal(chainReadCost(`/address/${TAPROOT}/txs/chain/${'0'.repeat(64)}`), OLDER_PAGE_COST);
  assert.equal(chainReadCost(`/address/${TAPROOT}/txs/chain`), 1);
  assert.equal(chainReadCost(`/address/${TAPROOT}/txs`), 1);
  // Against what wrangler.jsonc lets the limiter for chain reads count up to, that is 120 such
  // pages a minute for one reader. The wallet package reads 39 of them at the most for one
  // address (addressTxsAll).
  const budget = (wranglerConfig().ratelimits as Array<{ name: string; simple: { limit: number; period: number } }>).find(
    (limiter) => limiter.name === 'CHAIN_LIMIT',
  );
  assert.deepEqual(budget?.simple, { limit: 6000, period: 60 });
  assert.equal(6000 / OLDER_PAGE_COST, 120);
  assert.ok(Number.isInteger(OLDER_PAGE_COST) && OLDER_PAGE_COST > 0, 'the limiter takes whole weights above 0');
});

test('a flood of questions for older pages: 120 of them a minute reach the origin for one reader, whatever ID they ask by', async () => {
  // The limiter here counts as Cloudflare's does, up to what wrangler.jsonc sets for chain
  // reads: 6,000 a minute. All of what follows happens inside one minute.
  const flooded = harness();
  const chain = countingLimiter(6000);
  flooded.deps.limits = { ...flooded.deps.limits, chain };
  const handler = makeHandler(flooded.deps);
  const key = await readerKey('chain', READER_IP);

  // 6,000 questions from one reader, each for the page after an ID that is no transaction at
  // all, about an address that need not be the asker's own. The Worker cannot tell: any 64 hex
  // characters could be an ID. Esplora answers each with an empty list, after reading the
  // address's whole list to look for the ID.
  let passed = 0;
  let refused = 0;
  for (let n = 0; n < 6000; n += 1) {
    const response = await handler(get(`${API.esplora}/address/${ADDRESS}/txs/chain/${n.toString(16).padStart(64, 'f')}`));
    if (response.status === 200) {
      passed += 1;
    } else {
      assert.equal(response.status, 429);
      assert.deepEqual(await errorOf(response), { error: 'limit' });
      refused += 1;
    }
  }
  assert.deepEqual([passed, refused], [120, 5880]);
  assert.equal(flooded.originArgs.length, 120, 'the origin was asked 120 times, not 6,000');
  assert.equal(new Set(flooded.originArgs).size, 120);
  assert.equal(chain.calls, 6000, 'one call to the limiter for each request');
  assert.equal(chain.count(`${key}:older-pages`), 6000, 'a refused call adds nothing to the count');
  assert.deepEqual(flooded.lines, [], 'asking too fast is nobody\'s fault: no line, and no address or ID kept beside one');

  // The older pages are counted apart. The reader who asked for too many of them is still
  // answered everything else: the height, coins, totals, a first page, the newest 25.
  assert.equal(chain.count(key), 0);
  for (const [path, upstream] of READS.filter(([, read]) => chainReadCost(read) === 1)) {
    assert.equal((await handler(get(path))).status, 200, upstream);
  }
  assert.equal(chain.count(key), 6);
  assert.equal((await handler(get(`${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}`))).status, 429, 'but no older page');
  // Another reader has counts of their own.
  assert.equal((await handler(get(`${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}`, { 'CF-Connecting-IP': '203.0.113.8' }))).status, 200);
  assert.equal(flooded.originArgs.length, 120 + 6 + 1);

  // The same flood of any other read is 6,000 requests to the origin: each of those costs the
  // practice network one page or less, whatever is asked.
  const plain = harness();
  const counted = countingLimiter(6000);
  plain.deps.limits = { ...plain.deps.limits, chain: counted };
  const reads = makeHandler(plain.deps);
  for (const [path] of READS.filter(([, upstream]) => chainReadCost(upstream) === 1)) {
    for (let n = 0; n < 1000; n += 1) assert.equal((await reads(get(path))).status, 200);
  }
  assert.equal(plain.originArgs.length, 6000);
  assert.equal((await reads(get(READS[0]![0]))).status, 429, 'the 6,001st is refused');
  // And the other way about: a reader with no other reads left this minute can still ask for
  // older pages, 120 of them.
  assert.deepEqual([counted.count(key), counted.count(`${key}:older-pages`)], [6000, 0]);
  let pages = 0;
  for (let n = 0; n < 130; n += 1) {
    if ((await reads(get(`${API.esplora}/address/${ADDRESS}/txs/chain/${n.toString(16).padStart(64, 'c')}`))).status === 200) pages += 1;
  }
  assert.equal(pages, 120);
  assert.deepEqual([counted.count(key), counted.count(`${key}:older-pages`)], [6000, 6000]);
});

test('a chain read is sent with the content type the Worker picks, never the origin headers', async () => {
  const json = await run(get(`${API.esplora}/tx/${TXID}`), {
    esplora: () => ({ ok: true, value: { body: new Response('{"txid":"x"}').body, type: 'json' }, upstream: 200 }),
  });
  assert.equal(json.response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  const text = await run(get(`${API.esplora}/blocks/tip/height`), {
    esplora: () => ({ ok: true, value: { body: new Response('6326').body, type: 'text' }, upstream: 200 }),
  });
  assert.equal(text.response.headers.get('Content-Type'), 'text/plain; charset=utf-8');
  assert.equal(await text.response.text(), '6326');
});

/** Paths that must never reach the origin. Each is given as typed; the comment says what it tries. */
const TRICKS: string[] = [
  // Not one of the seven shapes.
  API.esplora,
  `${API.esplora}/`,
  `${API.esplora}/blocks`,
  `${API.esplora}/blocks/tip`,
  `${API.esplora}/blocks/tip/hash`,
  `${API.esplora}/address`,
  `${API.esplora}/address/`,
  `${API.esplora}/fee-estimates`,
  `${API.esplora}/mempool`,
  `${API.esplora}/tx/${TXID}/hex`,
  `${API.esplora}/tx/${TXID}/status`,
  `${API.esplora}/tx/${TXID}/chain`,
  `${API.esplora}/address/${ADDRESS}/txs/mempool`,
  `${API.esplora}/address/${ADDRESS}/txs/mempool/${TXID}`,
  `${API.esplora}/address/${ADDRESS}/txs/summary`,
  `${API.esplora}/address/${ADDRESS}/txs/${TXID}`,
  `${API.esplora}/address/${ADDRESS}/chain`,
  `${API.esplora}/address/${ADDRESS}/chain/${TXID}`,
  `${API.esplora}/address/${ADDRESS}/utxo/chain`,
  `${API.esplora}/address/${ADDRESS}/utxo/chain/${TXID}`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}/${TXID}`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}/hex`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/chain`,
  `${API.esplora}/address/txs/chain/${TXID}`,
  `${API.esplora}/txs/chain/${TXID}`,
  `${API.esplora}/address/${ADDRESS}/utxo/extra`,
  `${API.esplora}/address/${ADDRESS}/${ADDRESS}`,
  `${API.esplora}/tx/${TXID}/${TXID}`,
  // A trailing slash, a doubled slash.
  `${API.esplora}/blocks/tip/height/`,
  `${API.esplora}/address/${ADDRESS}/`,
  `${API.esplora}/address/${ADDRESS}/utxo/`,
  `${API.esplora}/tx/${TXID}/`,
  `${API.esplora}/address/${ADDRESS}/txs/`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}/`,
  `${API.esplora}/address/${ADDRESS}/txs//chain`,
  `${API.esplora}/address/${ADDRESS}/txs/chain//${TXID}`,
  `${API.esplora}//blocks/tip/height`,
  `${API.esplora}/blocks//tip/height`,
  `${API.esplora}/address//${ADDRESS}`,
  `/api//esplora/blocks/tip/height`,
  `//api/esplora/blocks/tip/height`,
  // Upper case.
  `${API.esplora}/Blocks/tip/height`,
  `${API.esplora}/blocks/tip/HEIGHT`,
  `/API/esplora/blocks/tip/height`,
  `/api/Esplora/blocks/tip/height`,
  `${API.esplora}/address/${ADDRESS.toUpperCase()}`,
  `${API.esplora}/address/${ADDRESS}/UTXO`,
  `${API.esplora}/tx/${TXID.toUpperCase()}`,
  `${API.esplora}/TX/${TXID}`,
  `${API.esplora}/address/${ADDRESS}/txs/Chain`,
  `${API.esplora}/address/${ADDRESS}/TXS/chain`,
  `${API.esplora}/address/${ADDRESS}/txs/CHAIN/${TXID}`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID.toUpperCase()}`,
  // A query string.
  `${API.esplora}/blocks/tip/height?`.concat('x=1'),
  `${API.esplora}/address/${ADDRESS}?after=${TXID}`,
  `${API.esplora}/address/${ADDRESS}/txs?x`,
  `${API.esplora}/address/${ADDRESS}/txs?after_txid=${TXID}`,
  `${API.esplora}/address/${ADDRESS}/txs?max_txs=100`,
  `${API.esplora}/address/${ADDRESS}/txs/chain?max_txs=1000`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}?max_txs=1000`,
  `${API.esplora}/tx/${TXID}?/../../bots/health`,
  // Not an address, not a transaction ID.
  `${API.esplora}/address/bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq`,
  `${API.esplora}/address/tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx`,
  `${API.esplora}/address/bcrt1qnotanaddress`,
  `${API.esplora}/address/bcrt1`,
  `${API.esplora}/address/${ADDRESS}x!`,
  `${API.esplora}/address/${ADDRESS};a=b`,
  `${API.esplora}/address/${ADDRESS}%00`,
  `${API.esplora}/address/${ADDRESS}%0a`,
  `${API.esplora}/address/%62crt1${ADDRESS.slice(5)}`,
  `${API.esplora}/address/${ADDRESS}.json`,
  `${API.esplora}/tx/${TXID.slice(0, 63)}`,
  `${API.esplora}/tx/${TXID}0`,
  `${API.esplora}/tx/${'g'.repeat(64)}`,
  `${API.esplora}/tx/${TXID.slice(0, 62)}%61`,
  // The ID in the paging shape is held to the same pattern.
  `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID.slice(0, 63)}`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}0`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/${'g'.repeat(64)}`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID.slice(0, 62)}%61`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}%0a`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/x`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/${ADDRESS}`,
  `${API.esplora}/address/${TXID}/txs/chain/${TXID}`,
  // Text with all the looks of an address that is not one, in each of the five address shapes.
  ...LOOKALIKES.flatMap(([, text]) => ADDRESS_TAILS.map((tail) => `${API.esplora}/address/${text}${tail}`)),
  // Dot segments, plain and percent-encoded, and encoded slashes: the ways
  // to climb out of /esplora/ and into /bots/ on the origin.
  `${API.esplora}/../bots/pot/address`,
  `${API.esplora}/../bots/health`,
  `${API.esplora}/address/../../bots/faucet`,
  `${API.esplora}/blocks/tip/height/../../../../bots/pot/address`,
  `${API.esplora}/%2e%2e/bots/pot/address`,
  `${API.esplora}/%2E%2E/bots/health`,
  `${API.esplora}/.%2e/bots/health`,
  `${API.esplora}/%2e./bots/health`,
  `${API.esplora}/..%2fbots%2fpot%2faddress`,
  `${API.esplora}/..%2Fbots/faucet`,
  `${API.esplora}/%2e%2e%2fbots%2fhealth`,
  `${API.esplora}/..%252fbots%252fhealth`,
  `${API.esplora}/address/..%2f..%2fbots%2fpot%2faddress`,
  `${API.esplora}/address/${ADDRESS}%2f..%2f..%2fbots%2fpot%2faddress`,
  `${API.esplora}/address/${ADDRESS}/..%2f..%2f..%2fbots%2fhealth`,
  `${API.esplora}/address/${ADDRESS}/%2e%2e/%2e%2e/%2e%2e/bots/health`,
  `${API.esplora}/tx/..%2f..%2fbots%2fhealth`,
  `${API.esplora}/tx/${TXID}%2f..%2f..%2f..%2fbots%2fpot%2faddress`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/../../../../bots/health`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/..%2f..%2f..%2f..%2fbots%2fhealth`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}%2f..%2f..%2f..%2f..%2f..%2fbots%2fpot%2faddress`,
  `${API.esplora}/address/${ADDRESS}/txs/chain/%2e%2e/%2e%2e/%2e%2e/%2e%2e/bots/health`,
  `${API.esplora}\\..\\bots\\health`,
  `${API.esplora}/..;/bots/health`,
  // The origin's own prefixes, asked for directly.
  `${API.esplora}/bots/health`,
  `${API.esplora}/bots/pot/address`,
  `/api/bots/health`,
  `/api/bots/faucet`,
  `/api/bots/pot/address`,
  `/bots/faucet`,
  `/esplora/blocks/tip/height`,
];

test('path tricks get a JSON 404 and reach nothing', async () => {
  for (const path of TRICKS) {
    await refusedWith(get(path), 'not_found');
    // The same path as a POST from our own page gets no further.
    await refusedWith(post(path, HEX), 'not_found');
  }
});

test('the path check itself, part by part', () => {
  assert.equal(esploraReadPath(['blocks', 'tip', 'height']), '/blocks/tip/height');
  assert.equal(esploraReadPath(['address', ADDRESS]), `/address/${ADDRESS}`);
  assert.equal(esploraReadPath(['address', ADDRESS, 'utxo']), `/address/${ADDRESS}/utxo`);
  assert.equal(esploraReadPath(['address', ADDRESS, 'txs']), `/address/${ADDRESS}/txs`);
  assert.equal(esploraReadPath(['address', ADDRESS, 'txs', 'chain']), `/address/${ADDRESS}/txs/chain`);
  assert.equal(esploraReadPath(['address', ADDRESS, 'txs', 'chain', TXID]), `/address/${ADDRESS}/txs/chain/${TXID}`);
  assert.equal(esploraReadPath(['tx', TXID]), `/tx/${TXID}`);
  const bad: string[][] = [
    [],
    [''],
    ['blocks'],
    ['blocks', 'tip'],
    ['blocks', 'tip', 'height', ''],
    ['blocks', 'tip', 'height', 'x'],
    ['address'],
    ['address', ''],
    ['address', ADDRESS, ''],
    ['address', ADDRESS, 'utxo', ''],
    ['address', ADDRESS, 'txs', ''],
    ['address', ADDRESS, 'txs', 'chain', ''],
    ['address', ADDRESS, 'txs', 'chain', TXID, ''],
    ['address', ADDRESS, 'txs', 'chain', TXID, TXID],
    ['address', ADDRESS, 'txs', 'chain', TXID.toUpperCase()],
    ['address', ADDRESS, 'txs', 'chain', TXID.slice(1)],
    ['address', ADDRESS, 'txs', 'chain', `${TXID}\n`],
    ['address', ADDRESS, 'txs', 'chain', ` ${TXID}`],
    ['address', ADDRESS, 'txs', 'chain', '..'],
    ['address', ADDRESS, 'txs', 'chain', ADDRESS],
    ['address', ADDRESS, 'txs', 'Chain'],
    ['address', ADDRESS, 'txs', 'mempool'],
    ['address', ADDRESS, 'txs', TXID],
    ['address', ADDRESS, 'utxo', 'chain'],
    ['address', ADDRESS, 'utxo', 'chain', TXID],
    ['address', ADDRESS, 'chain'],
    ['address', ADDRESS, 'chain', TXID],
    ['address', ADDRESS, 'txs', 'txs', 'chain'],
    ['address', NEARLY, 'txs', 'chain'],
    ['address', NEARLY, 'txs', 'chain', TXID],
    ['address', TXID, 'txs', 'chain', TXID],
    ['address', 'txs', 'chain', TXID],
    ['txs', 'chain', TXID],
    ['tx', TXID, 'chain'],
    ['tx', TXID, 'txs', 'chain'],
    ['address', `${ADDRESS}\n`],
    ['address', ` ${ADDRESS}`],
    ['address', NEARLY],
    ['address', NEARLY, 'utxo'],
    ['address', NEARLY, 'txs'],
    ['address', 'bcrt1qqqqqqqqqqqq'],
    ['address', '..'],
    ['address', '..', '..', 'bots'],
    ['tx'],
    ['tx', ''],
    ['tx', TXID, ''],
    ['tx', TXID, 'hex'],
    ['tx', `${TXID}\n`],
    ['tx', '..'],
    ['..', 'bots', 'health'],
    ['bots', 'health'],
  ];
  for (const parts of bad) assert.equal(esploraReadPath(parts), null, JSON.stringify(parts));
  // Whatever comes back is made only of lower-case letters, digits and single slashes.
  for (const [path] of READS) {
    const rebuilt = esploraReadPath(path.slice(API.esplora.length + 1).split('/'));
    assert.match(rebuilt ?? '', /^(\/[a-z0-9]+)+$/);
  }
});

// -- what an address is -------------------------------------------------------------

test('an address is more than its looks: version, program and checksum must all be right', () => {
  for (const [what, address] of ADDRESSES) {
    assert.match(address, ADDRESS_PATTERN, what);
    assert.equal(isPracticeAddress(address), true, what);
  }
  for (const [what, text] of LOOKALIKES) {
    // Each fits the pattern: the pattern alone would let it through to the origin.
    assert.match(text, ADDRESS_PATTERN, what);
    assert.equal(isPracticeAddress(text), false, what);
  }
  // The pattern is still the first check: this network's spelling, in lower case, and nothing around it.
  const misspelled = [
    '',
    'bcrt1',
    ADDRESS.toUpperCase(),
    ` ${ADDRESS}`,
    `${ADDRESS}\n`,
    `${ADDRESS}x`,
    // The first of ADDRESSES as testnet and as Bitcoin's real network spell it.
    'tb1qqqqsyqcyq5rqwzqfpg9scrgwpugpzysnl25zw8',
    'bc1qqqqsyqcyq5rqwzqfpg9scrgwpugpzysn4v0345',
  ];
  for (const text of misspelled) assert.equal(isPracticeAddress(text), false, JSON.stringify(text));
  // A program of 2 to 40 bytes takes 11 to 71 characters after "bcrt1", which
  // is what the pattern allows. So a version 1 program of 1 byte and one of 41
  // bytes, each under a checksum that is right, are stopped by their length.
  const wrongLength = ['bcrt1pqqlgpf04', 'bcrt1pqqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0jqgfzyvjz2f389qrmww65'];
  for (const text of wrongLength) {
    assert.doesNotMatch(text, ADDRESS_PATTERN);
    assert.equal(isPracticeAddress(text), false, text);
  }
});

test('one wrong character anywhere in an address is caught', () => {
  // What the checksum is for. Every character after "bcrt1" of every
  // address above is swapped for each of the 31 others in turn.
  const characters = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  let tried = 0;
  for (const [what, address] of [...ADDRESSES, ['a recorded address', ADDRESS] as const]) {
    for (let at = 'bcrt1'.length; at < address.length; at += 1) {
      for (const other of characters) {
        if (other === address[at]) continue;
        const changed = `${address.slice(0, at)}${other}${address.slice(at + 1)}`;
        assert.equal(isPracticeAddress(changed), false, `${what}: ${changed}`);
        tried += 1;
      }
    }
  }
  assert.ok(tried > 10_000, `${tried} changed addresses were tried`);
});

test('every address the wallet package derives passes, and so does every one the real origin took or printed', () => {
  /** Every text in a JSON value that begins as an address of this network does. */
  const spelled = (value: unknown, found: string[] = []): string[] => {
    if (typeof value === 'string' && value.startsWith('bcrt1')) found.push(value);
    else if (Array.isArray(value)) for (const inner of value) spelled(inner, found);
    else if (typeof value === 'object' && value !== null) for (const inner of Object.values(value)) spelled(inner, found);
    return found;
  };

  // The wallet package's own test vectors: the addresses it derives there. A
  // scan asks the Worker about addresses like these and nothing else, so one
  // that the check refused would be a wallet that cannot be read.
  const derived = spelled(readJson('../../wallet/test/vectors.json'));
  assert.ok(derived.length >= 10, `${derived.length} addresses in the wallet's vectors`);
  for (const address of derived) assert.equal(isPracticeAddress(address), true, address);

  // What Esplora itself made of text, as recorded: a 200 for what it took to
  // be an address, a 400 for what it did not. The check agrees each time.
  const { samples } = readJson('../../e2e/fixtures/origin-samples.json') as {
    samples: Array<{ request: string; status: number; body: unknown }>;
  };
  const verdicts = { taken: 0, refused: 0, printed: 0 };
  for (const sample of samples) {
    const asked = /^GET \/esplora\/address\/([^/]+)/.exec(sample.request)?.[1];
    if (asked !== undefined) {
      assert.ok(sample.status === 200 || sample.status === 400, sample.request);
      assert.equal(isPracticeAddress(asked), sample.status === 200, sample.request);
      verdicts[sample.status === 200 ? 'taken' : 'refused'] += 1;
    }
    // And every address Esplora printed in an answer is one.
    for (const address of spelled(sample.body)) {
      assert.equal(isPracticeAddress(address), true, address);
      verdicts.printed += 1;
    }
  }
  assert.ok(verdicts.taken >= 5 && verdicts.refused >= 2 && verdicts.printed >= 10, JSON.stringify(verdicts));
});

test('text with the looks of an address that is not one gets the 404 of an unknown path, and nothing is asked or logged', async () => {
  // What Esplora answers to such text, were it asked: a 400. The handler
  // would have to call that "unavailable", with a fault for the owner. So a
  // visitor could write faults into the log at will, and the real ones
  // would drown.
  const esplora = (): never => {
    throw new Error('the origin was asked about text that is no address');
  };
  for (const [what, text] of LOOKALIKES) {
    for (const tail of ADDRESS_TAILS) {
      const { response, h } = await run(get(`${API.esplora}/address/${text}${tail}`), { esplora });
      assert.equal(response.status, 404, what);
      assert.deepEqual(await errorOf(response), { error: 'not_found' }, what);
      assert.deepEqual(h.trace, [], `${what}: neither the limiter nor the origin`);
      assert.deepEqual(h.lines, [], `${what}: no line, least of all one with a fault`);
    }
  }
  // And each real address is asked about, in all five shapes.
  for (const [what, address] of ADDRESSES) {
    for (const tail of ADDRESS_TAILS) {
      const { response, h } = await run(get(`${API.esplora}/address/${address}${tail}`));
      assert.equal(response.status, 200, what);
      assert.deepEqual(h.originArgs, [`/address/${address}${tail}`], what);
    }
  }
});

test('other unknown paths under /api/ and /p/ get the same JSON 404', async () => {
  const unknown = [
    '/api',
    '/api/',
    '/api/nothing',
    '/api/config/',
    '/api/config/x',
    '/api/Config',
    '/api/config?x=1',
    '/api/faucet/',
    '/api/faucet?address=x',
    '/api/pot',
    '/api/pot/',
    '/api/pot/stats',
    '/api/pot/address/',
    '/p',
    '/p/',
    '/p/event/',
    '/p/event?x=1',
    '/p/script.js',
    '/p/api/event',
    '/',
    '/wallet',
  ];
  for (const path of unknown) {
    const h = await refusedWith(get(path), 'not_found');
    assert.deepEqual(h.lines, [{ route: 'unknown', status: 404, upstream: null, ms: 5, fault: null }], path);
    await refusedWith(post(path, FAUCET_BODY), 'not_found');
  }
  // An empty query string is no query string.
  const { response } = await run(get('/api/config?'));
  assert.equal(response.status, 200);
});

// -- methods ----------------------------------------------------------------------

test('a wrong method on a known path is 405, with the method that is right', async () => {
  const known: Array<[path: string, right: 'GET' | 'POST', route: string]> = [
    [API.config, 'GET', 'config'],
    ...READS.map(([path]): [string, 'GET', string] => [path, 'GET', 'esplora_read']),
    [`${API.esplora}/tx`, 'POST', 'esplora_broadcast'],
    [API.faucet, 'POST', 'faucet'],
    [API.potAddress, 'POST', 'pot_address'],
    [API.event, 'POST', 'event'],
  ];
  for (const [path, right, route] of known) {
    for (const method of ['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      if (method === right) continue;
      const body = method === 'GET' || method === 'HEAD' ? undefined : 'x';
      const request = new Request(`${APP}${path}`, { method, headers: { Origin: APP }, body });
      const { response, h } = await run(request);
      assert.equal(response.status, 405, `${method} ${path}`);
      assert.equal(response.headers.get('Allow'), right, `${method} ${path}`);
      if (method !== 'HEAD') assert.deepEqual(await errorOf(response), { error: 'method' });
      assert.deepEqual(h.trace, [], `${method} ${path}`);
      // The path of a chain read holds an address or an ID whatever the method, so that route stays silent.
      const lines = route === 'esplora_read' ? [] : [{ route, status: 405, upstream: null, ms: 5, fault: null }];
      assert.deepEqual(h.lines, lines, `${method} ${path}`);
    }
  }
});

// -- same origin --------------------------------------------------------------------

test('a POST from one of our own pages passes the same-origin check, on all four routes', async () => {
  for (const [path, body] of POSTS) {
    // The usual case: a script on our page, so the browser names our origin.
    assert.ok((await run(post(path, body))).response.status < 300, path);
    // No Origin header, but the browser itself says same-origin.
    assert.ok((await run(post(path, body, { Origin: '', 'Sec-Fetch-Site': 'same-origin' }))).response.status < 300, path);
    // The literal "null" (a no-referrer page, a request not in CORS mode) with the browser's same-origin.
    assert.ok((await run(post(path, body, { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' }))).response.status < 300, path);
  }
});

test('any other POST is 403 forbidden before anything is read or asked, on all four routes', async () => {
  const strangers: Array<Record<string, string>> = [
    // Another site, a sibling host, another scheme, another port, a look-alike.
    { Origin: 'https://evil.example' },
    { Origin: 'https://www.learnbitcoin.com' },
    { Origin: 'https://learnbitcoin.com' },
    { Origin: 'http://practice.learnbitcoin.com' },
    { Origin: 'https://practice.learnbitcoin.com:8443' },
    { Origin: 'https://practice.learnbitcoin.com.evil.example' },
    { Origin: 'https://PRACTICE.learnbitcoin.com' },
    { Origin: `${APP}/` },
    // A wrong Origin is not rescued by Sec-Fetch-Site.
    { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'same-origin' },
    // No Origin, and the browser does not say same-origin.
    { Origin: '', 'Sec-Fetch-Site': 'same-site' },
    { Origin: '', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: '', 'Sec-Fetch-Site': 'none' },
    // Neither header: a script or curl.
    { Origin: '' },
    // An opaque origin (a sandboxed frame).
    { Origin: 'null' },
    { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'null', 'Sec-Fetch-Site': 'same-site' },
  ];
  for (const [path, body] of POSTS) {
    for (const headers of strangers) {
      const h = await refusedWith(post(path, body, headers), 'forbidden');
      assert.equal(h.lines.length, 1);
      assert.equal(h.lines[0]?.status, 403);
    }
  }
});

test('the origin a POST must match is the one the request was sent to, whatever that is', async () => {
  const local = (origin: string): Request =>
    new Request('http://localhost:8787/api/pot/address', { method: 'POST', headers: { Origin: origin } });
  assert.equal((await run(local('http://localhost:8787'))).response.status, 200);
  for (const other of ['http://localhost:5173', 'http://127.0.0.1:8787', 'https://localhost:8787', APP]) {
    assert.equal((await run(local(other))).response.status, 403, other);
  }
});

test('GET routes are not origin-checked', async () => {
  const foreign = { Origin: 'https://www.learnbitcoin.com', 'Sec-Fetch-Site': 'cross-site' };
  for (const path of [API.config, ...READS.map(([read]) => read)]) {
    assert.equal((await run(get(path, foreign))).response.status, 200, path);
    assert.equal((await run(get(path, { 'Sec-Fetch-Site': 'none' }))).response.status, 200, path);
    assert.equal((await run(get(path))).response.status, 200, path);
  }
});

test('no answer carries a CORS header', async () => {
  const foreign = { Origin: 'https://www.learnbitcoin.com' };
  const preflight = (path: string): Request =>
    new Request(`${APP}${path}`, {
      method: 'OPTIONS',
      headers: { ...foreign, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
  const requests: Request[] = [
    get(API.config),
    get(API.config, foreign),
    ...READS.map(([path]) => get(path, foreign)),
    ...POSTS.map(([path, body]) => post(path, body)),
    ...POSTS.map(([path, body]) => post(path, body, foreign)),
    ...POSTS.map(([path]) => preflight(path)),
    preflight(API.config),
    preflight(READS[0]![0]),
    get('/api/nothing', foreign),
    get(`${API.esplora}/tx`, foreign),
  ];
  const statuses = new Set<number>();
  for (const request of requests) {
    const { response } = await run(request);
    statuses.add(response.status);
    response.headers.forEach((_value, name) => {
      assert.ok(!name.toLowerCase().startsWith('access-control-'), `${request.method} ${request.url}: ${name}`);
    });
    assert.equal(response.headers.get('Vary'), null);
  }
  assert.deepEqual([...statuses].sort(), [200, 202, 403, 404, 405]);
});

// -- broadcast ------------------------------------------------------------------------

test('a broadcast takes hex, lower-cases it, and answers the transaction ID as text', async () => {
  const { response, h } = await run(post(`${API.esplora}/tx`, 'DEADbeef00FF'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8');
  assert.equal(await response.text(), TXID);
  assert.deepEqual(h.trace, ['limit:broadcast', 'origin:broadcast']);
  assert.deepEqual(h.originArgs, ['deadbeef00ff']);
  assert.deepEqual(h.lines, [{ route: 'esplora_broadcast', status: 200, upstream: 200, ms: 5, fault: null }]);
});

test('a broadcast that is not hex is bad_request, and the limiter is not even asked', async () => {
  const bad = ['', 'abc', 'zz', '0x00', 'dead beef', 'deadbeef\n', ' deadbeef', '{"tx":"00"}', 'de,ad', String.fromCharCode(233, 233)];
  for (const body of bad) await refusedWith(post(`${API.esplora}/tx`, body), 'bad_request');
});

test('a broadcast of 200,000 characters is taken; one over the cap is too_large', async () => {
  assert.equal(TX_HEX_MAX, 200_000);
  const { response, h } = await run(post(`${API.esplora}/tx`, 'ab'.repeat(TX_HEX_MAX / 2)));
  assert.equal(response.status, 200);
  assert.equal(h.originArgs[0]?.length, TX_HEX_MAX);
  await refusedWith(post(`${API.esplora}/tx`, 'ab'.repeat(TX_HEX_MAX / 2 + 1)), 'too_large');
});

test("the node's refusal comes back as its code, with the node's words in detail", async () => {
  const { response, h } = await run(post(`${API.esplora}/tx`, HEX), {
    broadcast: () => ({
      ok: false,
      code: 'fee_too_low',
      detail: 'min relay fee not met, 5 < 11',
      upstream: 400,
      fault: null,
    }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await errorOf(response), { error: 'fee_too_low', detail: 'min relay fee not met, 5 < 11' });
  assert.deepEqual(h.lines, [{ route: 'esplora_broadcast', status: 400, upstream: 400, ms: 5, fault: null }]);
});

// -- body caps --------------------------------------------------------------------------

test('a declared length over the cap is refused without reading; the cap also holds while reading', async () => {
  const routes: Array<[path: string, max: number]> = [
    [`${API.esplora}/tx`, TX_HEX_MAX],
    [API.faucet, FAUCET_BODY_MAX],
    [API.event, EVENT_BODY_MAX],
  ];
  assert.equal(FAUCET_BODY_MAX, 4096);
  assert.equal(EVENT_BODY_MAX, 1024);
  for (const [path, max] of routes) {
    // A body that is never touched: reading it would throw. (With a high
    // water mark of 0 the stream asks for nothing until someone reads.)
    let touched = false;
    const untouchable = new ReadableStream<Uint8Array>(
      {
        pull() {
          touched = true;
          throw new Error('the body was read');
        },
      },
      { highWaterMark: 0 },
    );
    const declared = new Request(`${APP}${path}`, {
      method: 'POST',
      headers: { Origin: APP, 'Content-Length': String(max + 1) },
      body: untouchable,
      duplex: 'half',
    } as RequestInit);
    await refusedWith(declared, 'too_large');
    assert.equal(touched, false, path);

    // A length that is not a number is a malformed request.
    for (const length of ['abc', '-5', '1e3', '10.5', ' ']) {
      await refusedWith(post(path, 'ab', { 'Content-Length': length }), 'bad_request');
    }

    // No declared length (or one that lies): the read itself stops at the cap.
    const lying = new Request(`${APP}${path}`, {
      method: 'POST',
      headers: { Origin: APP, 'Content-Length': '10' },
      body: 'a'.repeat(max + 1),
    });
    await refusedWith(lying, 'too_large');

    // A reader who goes away mid-upload.
    const broken = new Request(`${APP}${path}`, {
      method: 'POST',
      headers: { Origin: APP },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error('gone'));
        },
      }),
      duplex: 'half',
    } as RequestInit);
    await refusedWith(broken, 'bad_request');
  }
});

// -- the faucet ---------------------------------------------------------------------------

test('a faucet request that passes every check is paid', async () => {
  const { response, h } = await run(post(API.faucet, FAUCET_BODY));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { txid: TXID, amountSats: 100000, potTxid: null });
  assert.deepEqual(h.trace, ['limit:faucet', 'botCheck', 'origin:faucet']);
  assert.deepEqual(h.botCalls, [{ token: TOKEN, address: ADDRESS }]);
  assert.deepEqual(h.originArgs, [ADDRESS]);
  assert.deepEqual(h.lines, [{ route: 'faucet', status: 200, upstream: 200, ms: 5, fault: null }]);
});

test('the faucet checks in order, and each refusal stops before the next thing is asked', async () => {
  const everythingRefuses: HarnessOptions = {
    over: ['faucet'],
    botCheck: { verdict: 'fail', upstream: 200, fault: null },
    faucet: () => ({ ok: false, code: 'busy', detail: null, upstream: 429, fault: null }),
  };
  const long = 'x'.repeat(FAUCET_BODY_MAX);
  const badToken = { address: 'not-an-address', token: 'x'.repeat(2049) };
  const badAddress = { address: 'not-an-address', token: TOKEN };

  // 1. The method, before the origin of the page.
  const wrongMethod = new Request(`${APP}${API.faucet}`, { headers: { Origin: 'https://evil.example' } });
  await refusedWith(wrongMethod, 'method', [], everythingRefuses);
  // 2. Same origin, before the body.
  await refusedWith(post(API.faucet, long + long, { Origin: 'https://evil.example' }), 'forbidden', [], everythingRefuses);
  // 3. The size, before the shape.
  await refusedWith(post(API.faucet, `{${long}`), 'too_large', [], everythingRefuses);
  // 4. The JSON shape, before the address.
  for (const body of ['', 'not json', '[]', 'null', '"x"', '5', '{}', { address: ADDRESS }, { token: TOKEN }]) {
    await refusedWith(post(API.faucet, body), 'bad_request', [], everythingRefuses);
  }
  for (const body of [{ address: 5, token: TOKEN }, { address: ADDRESS, token: 5 }, { address: [ADDRESS], token: TOKEN }, { address: ADDRESS, token: null }]) {
    await refusedWith(post(API.faucet, body), 'bad_request', [], everythingRefuses);
  }
  //    A token that no bot check issues is part of the shape: the service is never asked about it.
  await refusedWith(post(API.faucet, badToken), 'bad_request', [], everythingRefuses);
  await refusedWith(post(API.faucet, { address: ADDRESS, token: '' }), 'bad_request', [], everythingRefuses);
  await refusedWith(post(API.faucet, { address: ADDRESS, token: 'x'.repeat(2049) }), 'bad_request', [], everythingRefuses);
  // 5. The address, before the limiter.
  await refusedWith(post(API.faucet, badAddress), 'bad_address', [], everythingRefuses);
  for (const address of ['', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', ADDRESS.toUpperCase(), ` ${ADDRESS}`, `${ADDRESS}\n`]) {
    await refusedWith(post(API.faucet, { address, token: TOKEN }), 'bad_address', [], everythingRefuses);
  }
  // 6. The reader's budget, before the bot check.
  await refusedWith(post(API.faucet, FAUCET_BODY), 'limit', ['limit:faucet'], everythingRefuses);
  // 7. The bot check, before the origin.
  await refusedWith(post(API.faucet, FAUCET_BODY), 'bot_check', ['limit:faucet', 'botCheck'], { ...everythingRefuses, over: [] });
  // 8. The origin.
  await refusedWith(post(API.faucet, FAUCET_BODY), 'busy', ['limit:faucet', 'botCheck', 'origin:faucet'], {
    faucet: everythingRefuses.faucet,
  });
});

test('a token of exactly 2048 characters is still asked about, and extra keys in the body are ignored', async () => {
  const token = 'x'.repeat(2048);
  const { response, h } = await run(post(API.faucet, { address: ADDRESS, token, later: 'field' }));
  assert.equal(response.status, 200);
  assert.deepEqual(h.botCalls, [{ token, address: ADDRESS }]);
});

test('each bot-check verdict has its own answer, and its fault goes to the log', async () => {
  const cases: Array<[HarnessOptions['botCheck'] & object, ErrorCode]> = [
    // A token that is spent, expired or made up, or solved for another form or another address: no fault.
    [{ verdict: 'fail', upstream: 200, fault: null }, 'bot_check'],
    [{ verdict: 'fail', upstream: 400, fault: null }, 'bot_check'],
    [{ verdict: 'fail', upstream: null, fault: null }, 'bot_check'],
    [{ verdict: 'closed', upstream: null, fault: null }, 'closed'],
    [{ verdict: 'closed', upstream: null, fault: 'bot_check_config' }, 'closed'],
    // A token solved on another host, or a secret the service refuses.
    [{ verdict: 'down', upstream: 200, fault: 'bot_check_config' }, 'unavailable'],
    [{ verdict: 'down', upstream: 500, fault: 'bot_check_down' }, 'unavailable'],
    [{ verdict: 'down', upstream: null, fault: 'bot_check_down' }, 'unavailable'],
  ];
  for (const [botCheck, code] of cases) {
    const h = await refusedWith(post(API.faucet, FAUCET_BODY), code, ['limit:faucet', 'botCheck'], { botCheck });
    assert.deepEqual(h.lines, [
      { route: 'faucet', status: ERROR_STATUS[code], upstream: botCheck.upstream, ms: 5, fault: botCheck.fault },
    ]);
  }
  assert.deepEqual([ERROR_STATUS.bot_check, ERROR_STATUS.closed, ERROR_STATUS.unavailable], [403, 503, 502]);
});

test("the faucet's own refusals and the origin's faults come back as the contract says", async () => {
  const cases: Array<[ErrorCode, number | null, Fault | null]> = [
    ['bad_address', 400, null],
    ['own_address', 400, null],
    ['already_paid', 429, null],
    ['busy', 429, null],
    ['refilling', 503, null],
    ['failed', 500, 'origin_down'],
    ['unavailable', 302, 'origin_auth'],
    ['unavailable', null, 'origin_timeout'],
    ['unavailable', 200, 'origin_shape'],
    // An answer of the bots that is not one of the faucet's own refusals.
    ['unavailable', 400, 'origin_shape'],
    ['unavailable', 502, 'origin_down'],
  ];
  for (const [code, upstream, fault] of cases) {
    const h = await refusedWith(post(API.faucet, FAUCET_BODY), code, ['limit:faucet', 'botCheck', 'origin:faucet'], {
      faucet: () => ({ ok: false, code, detail: null, upstream, fault }),
    });
    assert.deepEqual(h.lines, [{ route: 'faucet', status: ERROR_STATUS[code], upstream, ms: 5, fault }]);
  }
});

// -- the pot ----------------------------------------------------------------------------------

test('the pot address is answered as { address }', async () => {
  const { response, h } = await run(post(API.potAddress, null));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { address: POT_ADDRESS });
  assert.deepEqual(h.trace, ['limit:pot', 'origin:potAddress']);
  assert.deepEqual(h.lines, [{ route: 'pot_address', status: 200, upstream: 200, ms: 5, fault: null }]);

  await refusedWith(post(API.potAddress, null), 'limit', ['limit:pot'], { over: ['pot'] });
  const h2 = await refusedWith(post(API.potAddress, null), 'unavailable', ['limit:pot', 'origin:potAddress'], {
    potAddress: () => ({ ok: false, code: 'unavailable', detail: null, upstream: 401, fault: 'origin_auth' }),
  });
  assert.deepEqual(h2.lines, [{ route: 'pot_address', status: 502, upstream: 401, fault: 'origin_auth', ms: 5 }]);
});

// -- chain reads that fail ------------------------------------------------------------------------

test('a chain read the origin cannot answer comes back as a code, never as the origin body', async () => {
  const cases: Array<[ErrorCode, number | null, Fault | null]> = [
    ['not_found', 404, null],
    ['unavailable', 502, 'origin_down'],
    ['unavailable', 302, 'origin_auth'],
    ['unavailable', null, 'origin_timeout'],
    ['unavailable', 200, 'origin_shape'],
    ['unavailable', 404, 'origin_shape'],
    ['unavailable', 400, 'origin_shape'],
  ];
  for (const [code, upstream, fault] of cases) {
    const h = await refusedWith(get(`${API.esplora}/tx/${TXID}`), code, ['limit:chain', 'origin:esplora'], {
      esplora: () => ({ ok: false, code, detail: null, upstream, fault }),
    });
    // A fault is the owner's to fix, so it has its line. "Not found" is nobody's fault, and writes nothing.
    const lines = fault === null ? [] : [{ route: 'esplora_read', status: ERROR_STATUS[code], upstream, ms: 5, fault }];
    assert.deepEqual(h.lines, lines, `${code} ${fault}`);
  }
  await refusedWith(get(`${API.esplora}/tx/${TXID}`), 'limit', ['limit:chain'], { over: ['chain'] });
  await refusedWith(post(`${API.esplora}/tx`, HEX), 'limit', ['limit:broadcast'], { over: ['broadcast'] });
});

// -- events ----------------------------------------------------------------------------------------

test('an event is answered 202 at once and forwarded afterwards', async () => {
  let finish: (result: { ok: boolean; upstream: number | null; fault: null }) => void = () => {};
  const h = harness({ forward: () => new Promise((resolve) => (finish = resolve)) });
  const request = post(API.event, EVENT, { 'User-Agent': 'Mozilla/5.0 (a browser)' });
  const response = await makeHandler(h.deps)(request);

  // The answer is here while the forward is still under way.
  assert.equal(response.status, 202);
  assert.equal(await response.text(), '');
  assert.equal(h.pending.length, 1, 'the forward was handed to waitUntil');
  assert.deepEqual(h.lines, [], 'the log line waits for the forward to end');

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.trace, ['limit:events', 'forward']);
  assert.deepEqual(h.forwarded, [{ event: EVENT, meta: { ip: READER_IP, userAgent: 'Mozilla/5.0 (a browser)' } }]);

  finish({ ok: true, upstream: 202, fault: null });
  await Promise.all(h.pending);
  assert.deepEqual(h.lines, [{ route: 'event', status: 202, upstream: 202, ms: 5, fault: null }]);
});

test('an event that could not be forwarded still got its 202; the log says what happened', async () => {
  const failed = await run(post(API.event, EVENT), {
    forward: async () => ({ ok: false, upstream: 500, fault: 'events_down' }),
  });
  assert.equal(failed.response.status, 202);
  assert.deepEqual(failed.h.lines, [{ route: 'event', status: 202, upstream: 500, ms: 5, fault: 'events_down' }]);

  const threw = await run(post(API.event, EVENT), {
    forward: () => Promise.reject(new Error('a forwarder that breaks its promise')),
  });
  assert.equal(threw.response.status, 202);
  assert.deepEqual(threw.h.lines, [{ route: 'event', status: 202, upstream: null, ms: 5, fault: 'events_down' }]);
});

test('with events off the answer is 202 and nothing is forwarded', async () => {
  const { response, h } = await run(post(API.event, EVENT), { config: { events: false } });
  assert.equal(response.status, 202);
  assert.deepEqual(h.forwarded, []);
  assert.equal(h.pending.length, 0);
  assert.deepEqual(h.trace, ['limit:events']);
  assert.deepEqual(h.lines, [{ route: 'event', status: 202, upstream: null, ms: 5, fault: null }]);
});

test("the contract's isEventBody decides what an event is", async () => {
  for (const good of [{ name: 'pageview', path: '/' }, { name: 'pageview', path: '/es/wallet/send' }, EVENT]) {
    const { response, h } = await run(post(API.event, good));
    assert.equal(response.status, 202);
    assert.deepEqual(h.forwarded.map((f) => f.event), [good]);
  }
  const bad: Array<string | object> = [
    '',
    'not json',
    '[]',
    'null',
    {},
    { name: 'pageview' },
    { name: 'pageview', path: '/', value: 'x' },
    { name: 'pageview', path: `/wallet/tx/${TXID}` },
    { name: 'pageview', path: `/${ADDRESS}` },
    { name: 'Passkey', path: '/new' },
    { name: 'Passkey', path: '/new', value: 'made-up' },
    { name: 'Made up', path: '/new', value: 'ok' },
    { name: 'Passkey', path: '/new', value: 'ok', props: { address: ADDRESS } },
    { name: 'Passkey', path: '/new', value: 'ok', url: 'https://evil.example' },
    { name: 'Passkey', path: '/new', value: 'ok', domain: 'evil.example' },
  ];
  for (const body of bad) await refusedWith(post(API.event, body), 'bad_request');
  await refusedWith(post(API.event, EVENT), 'limit', ['limit:events'], { over: ['events'] });
  await refusedWith(post(API.event, `{"name":"pageview","path":"/","pad":"${'x'.repeat(EVENT_BODY_MAX)}"}`), 'too_large');
});

// -- limiter keys --------------------------------------------------------------------------------------

test('each limiter is asked with a hash of the reader, never the address itself', async () => {
  const requests: Array<[keyof Harness['limiters'], (ip: Record<string, string>) => Request]> = [
    ['chain', (ip) => get(READS[0]![0], ip)],
    ['broadcast', (ip) => post(`${API.esplora}/tx`, HEX, ip)],
    ['faucet', (ip) => post(API.faucet, FAUCET_BODY, ip)],
    ['pot', (ip) => post(API.potAddress, null, ip)],
    ['events', (ip) => post(API.event, EVENT, ip)],
  ];
  const seen = new Set<string>();
  for (const [name, make] of requests) {
    const { h } = await run(make({ 'CF-Connecting-IP': READER_IP }));
    for (const [other, limiter] of Object.entries(h.limiters)) {
      assert.equal(limiter.keys.length, other === name ? 1 : 0, `${name}: only its own limiter is asked`);
    }
    assert.deepEqual(h.limiters[name].costs, [1], `${name}: one request counts as one`);
    assert.deepEqual(h.limiters[name].asked.map((options) => Object.keys(options)), [['key']], `${name}: the limiter is handed the key and nothing else`);
    const key = h.limiters[name].keys[0]!;
    assert.match(key, /^[0-9a-f]{24}$/);
    assert.ok(!key.includes(READER_IP));
    assert.equal(key, await readerKey(name, READER_IP));
    seen.add(key);

    // IPv6: the /64, so a neighbour in the same /64 shares the budget.
    const six = (await run(make({ 'CF-Connecting-IP': READER_IP6 }))).h.limiters[name].keys[0];
    const neighbour = (await run(make({ 'CF-Connecting-IP': '2001:db8:aa:bb:ffff::1' }))).h.limiters[name].keys[0];
    assert.equal(six, neighbour);
    assert.notEqual(six, key);

    // No address header at all: one shared key.
    const none = (await run(make({ 'CF-Connecting-IP': '' }))).h.limiters[name].keys[0];
    assert.equal(none, await readerKey(name, null));
  }
  assert.equal(seen.size, 5, 'the same reader has a different key at each limiter');
});

test('an address header a reader could forge is not used', async () => {
  const forged = { 'X-Forwarded-For': '198.51.100.9', 'X-Real-IP': '198.51.100.9', Forwarded: 'for=198.51.100.9', 'True-Client-IP': '198.51.100.9' };
  // Without Cloudflare's own header, the forgeable ones do not stand in for it...
  const alone = await run(get(READS[0]![0], { 'CF-Connecting-IP': '', ...forged }));
  assert.equal(alone.request.headers.get('CF-Connecting-IP'), null);
  assert.equal(alone.h.limiters.chain.keys[0], await readerKey('chain', null));
  // ...and beside it, they change nothing.
  const beside = await run(get(READS[0]![0], forged));
  assert.equal(beside.h.limiters.chain.keys[0], await readerKey('chain', READER_IP));
});

// -- headers and the log ---------------------------------------------------------------------------------

test('every answer carries the fixed headers: a success, a refusal, the 404 and the 405', async () => {
  const answers: Array<[what: string, request: Request, status: number, type: string | null]> = [
    ['config', get(API.config), 200, 'application/json; charset=utf-8'],
    ['a chain read', get(READS[1]![0]), 200, 'application/json; charset=utf-8'],
    ['a broadcast', post(`${API.esplora}/tx`, HEX), 200, 'text/plain; charset=utf-8'],
    ['the faucet', post(API.faucet, FAUCET_BODY), 200, 'application/json; charset=utf-8'],
    ['the pot', post(API.potAddress, null), 200, 'application/json; charset=utf-8'],
    ['an event', post(API.event, EVENT), 202, null],
    ['a refusal (bad_address)', post(API.faucet, { address: 'x', token: TOKEN }), 400, 'application/json; charset=utf-8'],
    ['a refusal (forbidden)', post(API.faucet, FAUCET_BODY, { Origin: 'https://evil.example' }), 403, 'application/json; charset=utf-8'],
    ['a refusal (too_large)', post(API.event, 'x'.repeat(2000)), 413, 'application/json; charset=utf-8'],
    ['the 404', get('/api/nothing'), 404, 'application/json; charset=utf-8'],
    ['the 405', get(API.faucet), 405, 'application/json; charset=utf-8'],
  ];
  for (const [what, request, status, type] of answers) {
    const { response } = await run(request);
    assert.equal(response.status, status, what);
    assert.equal(response.headers.get('Content-Type'), type, what);
    for (const [name, value] of Object.entries(FIXED_HEADERS)) assert.equal(response.headers.get(name), value, `${what}: ${name}`);
    const names: string[] = [];
    response.headers.forEach((_value, name) => names.push(name));
    const expected = [...Object.keys(FIXED_HEADERS).map((name) => name.toLowerCase()), ...(type ? ['content-type'] : []), ...(status === 405 ? ['allow'] : [])];
    assert.deepEqual(names.sort(), expected.sort(), `${what}: these headers and no others`);
  }
});

test('a refusal from the limiter also carries the fixed headers', async () => {
  const { response } = await run(get(READS[0]![0]), { over: ['chain'] });
  assert.equal(response.status, 429);
  for (const [name, value] of Object.entries(FIXED_HEADERS)) assert.equal(response.headers.get(name), value);
});

test('a chain read that ends without a fault writes no log line', async () => {
  // Workers Logs can keep the URL of a request beside each line written in
  // it, and the URL of a chain read holds an address or a transaction ID.
  for (const [path] of READS) {
    // It went well.
    const good = await run(get(path));
    assert.equal(good.response.status, 200, path);
    assert.deepEqual(good.h.trace, ['limit:chain', 'origin:esplora'], path);
    assert.deepEqual(good.h.lines, [], path);

    // The chain does not know it (yet): not found.
    const unknown = await run(get(path), {
      esplora: () => ({ ok: false, code: 'not_found', detail: null, upstream: 404, fault: null }),
    });
    assert.equal(unknown.response.status, 404, path);
    assert.deepEqual(await errorOf(unknown.response), { error: 'not_found' }, path);
    assert.deepEqual(unknown.h.lines, [], path);

    // The reader is asking too fast.
    const limited = await run(get(path), { over: ['chain'] });
    assert.equal(limited.response.status, 429, path);
    assert.deepEqual(await errorOf(limited.response), { error: 'limit' }, path);
    assert.deepEqual(limited.h.lines, [], path);

    // A wrong method: the path holds the address or the ID all the same.
    const wrongMethod = await run(post(path, HEX));
    assert.equal(wrongMethod.response.status, 405, path);
    assert.deepEqual(wrongMethod.h.lines, [], path);
  }
  // Nothing was put off for later either.
  const { h } = await run(get(READS[1]![0]));
  assert.equal(h.pending.length, 0);
});

test('a chain read that ends in a fault writes one line, with its fault', async () => {
  const faults: Array<[upstream: number | null, fault: Fault]> = [
    [502, 'origin_down'],
    [null, 'origin_down'],
    [302, 'origin_auth'],
    [403, 'origin_auth'],
    [null, 'origin_timeout'],
    [200, 'origin_timeout'],
    [200, 'origin_shape'],
    [404, 'origin_shape'],
    [400, 'origin_shape'],
  ];
  for (const [path] of READS) {
    for (const [upstream, fault] of faults) {
      const { response, h } = await run(get(path), {
        esplora: () => ({ ok: false, code: 'unavailable', detail: null, upstream, fault }),
      });
      assert.equal(response.status, 502, path);
      assert.deepEqual(await errorOf(response), { error: 'unavailable' }, path);
      assert.deepEqual(h.lines, [{ route: 'esplora_read', status: 502, upstream, ms: 5, fault }], `${path} ${fault}`);
    }
    // The handler's own fault, too: a part that throws.
    const threw = await run(get(path), {
      esplora: () => {
        throw new Error('a part that breaks');
      },
    });
    assert.deepEqual(threw.h.lines, [{ route: 'esplora_read', status: 502, upstream: null, ms: 5, fault: 'handler' }], path);
  }
});

test('any other path under the Esplora prefix writes no line either: its URL can hold an address or an ID just the same', async () => {
  const silent = [
    // What the wallet's own Esplora client can ask for and the Worker does not carry.
    `${API.esplora}/tx/${TXID}/hex`,
    `${API.esplora}/fee-estimates`,
    // Other shapes Esplora has, and the paging shapes spelled a little wrong.
    `${API.esplora}/address/${ADDRESS}/txs/mempool`,
    `${API.esplora}/address/${ADDRESS}/txs/chain/`,
    `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}/`,
    `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID.toUpperCase()}`,
    `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID.slice(1)}`,
    `${API.esplora}/address/${ADDRESS}/txs/chain?max_txs=100`,
    `${API.esplora}/address/${ADDRESS}/txs/chain/${TXID}?x=1`,
    `${API.esplora}/address/${NEARLY}/txs/chain`,
    `${API.esplora}/address/${NEARLY}/txs/chain/${TXID}`,
    `${API.esplora}/tx/${TXID}/status`,
    `${API.esplora}/scripthash/${TXID}/utxo`,
    // A stray slash, a query string, capitals.
    `${API.esplora}/address/${ADDRESS}/`,
    `${API.esplora}/tx/${TXID}/`,
    `${API.esplora}//address/${ADDRESS}`,
    `${API.esplora}/address/${ADDRESS}?x=1`,
    `${API.esplora}/address/${ADDRESS}/txs?after_txid=${TXID}`,
    `${API.esplora}/tx/${TXID}?x`,
    `${API.esplora}/address/${ADDRESS.toUpperCase()}`,
    `${API.esplora}/tx/${TXID.toUpperCase()}`,
    // Text that is no address.
    `${API.esplora}/address/${NEARLY}`,
    `${API.esplora}/address/${NEARLY}/utxo`,
    `${API.esplora}/address/bcrt1qqqqqqqqqqqq/txs`,
    // The broadcast path with a query string is not the broadcast: a query string can hold anything.
    `${API.esplora}/tx?txid=${TXID}`,
    `${API.esplora}/`,
  ];
  for (const path of silent) {
    for (const method of ['GET', 'POST', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
      const body = method === 'GET' || method === 'HEAD' ? undefined : HEX;
      const { response, h } = await run(new Request(`${APP}${path}`, { method, headers: { Origin: APP }, body }));
      assert.equal(response.status, 404, `${method} ${path}`);
      if (method !== 'HEAD') assert.deepEqual(await errorOf(response), { error: 'not_found' }, `${method} ${path}`);
      assert.deepEqual(h.trace, [], `${method} ${path}`);
      assert.deepEqual(h.lines, [], `${method} ${path}`);
      assert.equal(h.pending.length, 0, `${method} ${path}`);
    }
  }

  // A bare "?" is no query string. That request is the chain read itself, and silent as one.
  const bare = await run(get(`${API.esplora}/tx/${TXID}?`));
  assert.equal(bare.response.status, 200);
  assert.deepEqual(bare.h.originArgs, [`/tx/${TXID}`]);
  assert.deepEqual(bare.h.lines, []);

  // The one request under the prefix that keeps its line is the broadcast.
  // Its URL is the same for everyone: the transaction travels in the body.
  for (const [method, status, upstream] of [['POST', 200, 200], ['GET', 405, null], ['PUT', 405, null]] as const) {
    const body = method === 'GET' ? undefined : HEX;
    const { response, h } = await run(new Request(`${APP}${API.esplora}/tx`, { method, headers: { Origin: APP }, body }));
    assert.equal(response.status, status, method);
    assert.deepEqual(h.lines, [{ route: 'esplora_broadcast', status, upstream, ms: 5, fault: null }], method);
  }
});

test('every other request writes exactly one line, whether it went well or was refused', async () => {
  const line = (route: LogLine['route'], status: number, upstream: number | null = null, fault: Fault | null = null): LogLine => ({
    route,
    status,
    upstream,
    ms: 5,
    fault,
  });
  const broadcast = `${API.esplora}/tx`;
  const foreign = { Origin: 'https://evil.example' };
  const cases: Array<[what: string, request: Request, options: HarnessOptions, expected: LogLine]> = [
    ['config', get(API.config), {}, line('config', 200)],
    ['config, wrong method', post(API.config, null), {}, line('config', 405)],

    ['a broadcast', post(broadcast, HEX), {}, line('esplora_broadcast', 200, 200)],
    [
      'a broadcast the node refused',
      post(broadcast, HEX),
      { broadcast: () => ({ ok: false, code: 'dust', detail: 'dust', upstream: 400, fault: null }) },
      line('esplora_broadcast', 400, 400),
    ],
    [
      'a broadcast the origin could not take',
      post(broadcast, HEX),
      { broadcast: () => ({ ok: false, code: 'unavailable', detail: null, upstream: 404, fault: 'origin_shape' }) },
      line('esplora_broadcast', 502, 404, 'origin_shape'),
    ],
    ['a broadcast that is not hex', post(broadcast, 'zz'), {}, line('esplora_broadcast', 400)],
    ['a broadcast over the limit', post(broadcast, HEX), { over: ['broadcast'] }, line('esplora_broadcast', 429)],
    ['a broadcast from another site', post(broadcast, HEX, foreign), {}, line('esplora_broadcast', 403)],
    ['a broadcast, wrong method', new Request(`${APP}${broadcast}`, { method: 'PUT', body: HEX }), {}, line('esplora_broadcast', 405)],

    ['the faucet', post(API.faucet, FAUCET_BODY), {}, line('faucet', 200, 200)],
    [
      'the faucet, bot check not passed',
      post(API.faucet, FAUCET_BODY),
      { botCheck: { verdict: 'fail', upstream: 200, fault: null } },
      line('faucet', 403, 200),
    ],
    [
      'the faucet, refused by the bots',
      post(API.faucet, FAUCET_BODY),
      { faucet: () => ({ ok: false, code: 'already_paid', detail: null, upstream: 429, fault: null }) },
      line('faucet', 429, 429),
    ],
    [
      'the faucet, an answer of the bots that is not their own refusal',
      post(API.faucet, FAUCET_BODY),
      { faucet: () => ({ ok: false, code: 'unavailable', detail: null, upstream: 400, fault: 'origin_shape' }) },
      line('faucet', 502, 400, 'origin_shape'),
    ],
    ['the faucet, a bad address', post(API.faucet, { address: 'x', token: TOKEN }), {}, line('faucet', 400)],
    ['the faucet over the limit', post(API.faucet, FAUCET_BODY), { over: ['faucet'] }, line('faucet', 429)],
    ['the faucet from another site', post(API.faucet, FAUCET_BODY, foreign), {}, line('faucet', 403)],
    ['the faucet, wrong method', get(API.faucet), {}, line('faucet', 405)],

    ['the pot address', post(API.potAddress, null), {}, line('pot_address', 200, 200)],
    [
      'the pot address, origin down',
      post(API.potAddress, null),
      { potAddress: () => ({ ok: false, code: 'unavailable', detail: null, upstream: 502, fault: 'origin_down' }) },
      line('pot_address', 502, 502, 'origin_down'),
    ],
    ['the pot address over the limit', post(API.potAddress, null), { over: ['pot'] }, line('pot_address', 429)],
    ['the pot address from another site', post(API.potAddress, null, foreign), {}, line('pot_address', 403)],
    ['the pot address, wrong method', get(API.potAddress), {}, line('pot_address', 405)],

    ['an event', post(API.event, EVENT), {}, line('event', 202, 202)],
    ['an event, with events off', post(API.event, EVENT), { config: { events: false } }, line('event', 202)],
    [
      'an event the events service did not take',
      post(API.event, EVENT),
      { forward: async () => ({ ok: false, upstream: 500, fault: 'events_down' }) },
      line('event', 202, 500, 'events_down'),
    ],
    ['an event that is not one', post(API.event, { name: 'Made up', path: '/' }), {}, line('event', 400)],
    ['an event over the limit', post(API.event, EVENT), { over: ['events'] }, line('event', 429)],
    ['an event from another site', post(API.event, EVENT, foreign), {}, line('event', 403)],
    ['an event, wrong method', get(API.event), {}, line('event', 405)],

    // A path the Worker does not know, outside the Esplora prefix. Whatever a
    // visitor typed there, the line holds none of it.
    ['an unknown path', get('/api/nothing'), {}, line('unknown', 404)],
    ['an unknown path that holds an address', get(`/api/nothing/${ADDRESS}`), {}, line('unknown', 404)],
    ['the Esplora prefix itself, with nothing under it', get(API.esplora), {}, line('unknown', 404)],
    ['a path that only begins like the Esplora prefix', get(`${API.esplora}x/address/${ADDRESS}`), {}, line('unknown', 404)],
    ['a path with the Esplora prefix further in', get(`/p${API.esplora}/address/${ADDRESS}`), {}, line('unknown', 404)],
    ['a query string that names the Esplora prefix', get(`/api/nothing?next=${API.esplora}/tx/${TXID}`), {}, line('unknown', 404)],
  ];
  for (const [what, request, options, expected] of cases) {
    const { response, h } = await run(request, options);
    assert.equal(response.status, expected.status, what);
    assert.deepEqual(h.lines, [expected], what);
  }
});

test('a log line is five fields, and nothing a reader sent', async () => {
  const secretish = [ADDRESS, TXID, TOKEN, READER_IP, HEX, POT_ADDRESS, 'Mozilla', 'evil.example', '/api/', 'esplora/'];
  const requests: Request[] = [
    get(API.config),
    ...READS.map(([path]) => get(path, { 'User-Agent': 'Mozilla/5.0' })),
    ...POSTS.map(([path, body]) => post(path, body, { 'User-Agent': 'Mozilla/5.0' })),
    ...POSTS.map(([path, body]) => post(path, body, { Origin: 'https://evil.example' })),
    // An unknown path that holds what a visitor typed, in its path and in a query string.
    get(`/api/nothing/${ADDRESS}/${TXID}?token=${TOKEN}`),
    get(API.faucet),
    post(API.faucet, { address: ADDRESS, token: 'x'.repeat(3000) }),
  ];
  for (const request of requests) {
    const { h } = await run(request, {
      // A chain read writes its line only when it ends in a fault, so here each one does.
      esplora: () => ({ ok: false, code: 'unavailable', detail: null, upstream: 502, fault: 'origin_down' }),
      faucet: () => ({ ok: false, code: 'failed', detail: null, upstream: 500, fault: 'origin_down' }),
    });
    assert.equal(h.lines.length, 1, `${request.method} ${request.url}`);
    const line = h.lines[0]!;
    assert.deepEqual(Object.keys(line).sort(), ['fault', 'ms', 'route', 'status', 'upstream']);
    assert.ok(['config', 'esplora_read', 'esplora_broadcast', 'faucet', 'pot_address', 'event', 'unknown'].includes(line.route));
    assert.equal(typeof line.status, 'number');
    assert.ok(line.upstream === null || typeof line.upstream === 'number');
    assert.equal(typeof line.ms, 'number');
    const written = JSON.stringify(line);
    for (const piece of secretish) assert.ok(!written.includes(piece), `${piece} in ${written}`);
  }
});

test('when a part throws, the answer is unavailable and the log says the handler is at fault', async () => {
  const boom = (): never => {
    throw new Error(`could not reach ${ADDRESS} with ${TOKEN}`);
  };
  const cases: Array<[Request, HarnessOptions, string]> = [
    [get(READS[1]![0]), { esplora: boom }, 'esplora_read'],
    [post(`${API.esplora}/tx`, HEX), { broadcast: boom }, 'esplora_broadcast'],
    [post(API.faucet, FAUCET_BODY), { faucet: boom }, 'faucet'],
    [post(API.potAddress, null), { potAddress: boom }, 'pot_address'],
  ];
  for (const [request, options, route] of cases) {
    const { response, h } = await run(request, options);
    assert.equal(response.status, 502);
    assert.deepEqual(await errorOf(response), { error: 'unavailable' });
    assert.deepEqual(h.lines, [{ route, status: 502, upstream: null, ms: 5, fault: 'handler' }]);
    for (const [name, value] of Object.entries(FIXED_HEADERS)) assert.equal(response.headers.get(name), value);
  }
  // A limiter that breaks is our fault too, and nothing behind it is asked.
  const h = harness();
  h.deps.limits.chain.limit = boom;
  const response = await makeHandler(h.deps)(get(READS[0]![0]));
  assert.equal(response.status, 502);
  assert.deepEqual(h.originArgs, []);
  assert.equal(h.lines[0]?.fault, 'handler');
});
