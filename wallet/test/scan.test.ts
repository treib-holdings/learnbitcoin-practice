import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Esplora, EsploraError, accountFromMnemonic, scanWallet, type FetchLike } from '../src/index.ts';

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const account = accountFromMnemonic(V.abandon.mnemonic).key;

type Fake = { tx: number; mempoolTx?: number; utxos?: { txid: string; vout: number; value: number; confirmed: boolean }[] };

/** A fake Esplora server that knows a handful of addresses. */
function fakeEsplora(known: Record<string, Fake>) {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const path = new URL(url).pathname.replace(/^\/api/, '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    const m = path.match(/^\/address\/([^/]+)(\/utxo)?$/);
    if (m) {
      const f = known[decodeURIComponent(m[1]!)] ?? { tx: 0 };
      if (m[2]) {
        const utxos = (f.utxos ?? []).map((u) => ({
          txid: u.txid,
          vout: u.vout,
          value: u.value,
          status: u.confirmed ? { confirmed: true, block_height: 120 } : { confirmed: false },
        }));
        return Response.json(utxos);
      }
      const stats = (n: number) => ({ funded_txo_count: n, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: n });
      return Response.json({ address: m[1], chain_stats: stats(f.tx), mempool_stats: stats(f.mempoolTx ?? 0) });
    }
    if (path === '/tx' && init?.method === 'POST') {
      return init.body === 'deadbeef' ? new Response('ab'.repeat(32)) : new Response('bad-txns', { status: 400 });
    }
    return new Response('not found', { status: 404 });
  };
  return { esplora: new Esplora('https://example.test/api/', fetchFn), calls };
}

test('finds coins on used addresses and stops after the gap limit', async () => {
  const [r0, , r2] = V.abandon.receive as string[];
  const c0 = V.abandon.change[0] as string;
  const { esplora } = fakeEsplora({
    [r0!]: { tx: 1, utxos: [{ txid: 'aa'.repeat(32), vout: 0, value: 100_000, confirmed: true }] },
    [r2!]: { tx: 2, utxos: [{ txid: 'bb'.repeat(32), vout: 1, value: 25_000, confirmed: true }] },
    [c0]: { tx: 0, mempoolTx: 1, utxos: [{ txid: 'cc'.repeat(32), vout: 1, value: 40_000, confirmed: false }] },
  });

  const s = await scanWallet(account, esplora, { gap: 20, batch: 7 });
  assert.equal(s.coins.length, 3);
  assert.equal(s.confirmed, 125_000n);
  assert.equal(s.unconfirmed, 40_000n);
  assert.equal(s.nextReceiveIndex, 3);
  assert.equal(s.nextChangeIndex, 1);
  assert.equal(s.receive.length, 3 + 20, 'last used index + 1, then 20 unused');
  assert.equal(s.change.length, 1 + 20);
  assert.deepEqual(s.receive.filter((a) => a.used).map((a) => a.index), [0, 2]);
});

test('an empty wallet scans exactly the gap limit on each chain', async () => {
  const { esplora } = fakeEsplora({});
  const s = await scanWallet(account, esplora, { gap: 20, batch: 10 });
  assert.equal(s.coins.length, 0);
  assert.equal(s.receive.length, 20);
  assert.equal(s.change.length, 20);
  assert.equal(s.nextReceiveIndex, 0);
});

test('broadcast posts the hex and returns the txid; errors carry the status', async () => {
  const { esplora, calls } = fakeEsplora({});
  assert.equal(await esplora.broadcast('deadbeef'), 'ab'.repeat(32));
  assert.ok(calls.includes('POST /tx'));
  await assert.rejects(esplora.broadcast('00'), (e: unknown) => e instanceof EsploraError && e.status === 400);
});

test('a failed answer keeps up to 1,000 characters of its body, so a short JSON error arrives whole', async () => {
  /** What a call throws when the server answers it with this status and body. */
  const failure = async (status: number, body: string, call: (esplora: Esplora) => Promise<unknown>): Promise<EsploraError> => {
    try {
      await call(new Esplora('https://example.test/api', async () => new Response(body, { status })));
    } catch (e) {
      assert.ok(e instanceof EsploraError);
      return e;
    }
    assert.fail('the call did not throw');
  };
  const broadcast = (esplora: Esplora) => esplora.broadcast('00');
  const said = 'Esplora POST /tx failed (400): ';

  // A short body is in the message as it came, after the request and the status.
  assert.equal((await failure(400, 'bad-txns', broadcast)).message, `${said}bad-txns`);
  const unknown = await failure(404, 'Transaction not found', (esplora) => esplora.tx('ab'.repeat(32)));
  assert.equal(unknown.status, 404);
  assert.equal(unknown.message, `Esplora GET /tx/${'ab'.repeat(32)} failed (404): Transaction not found`);
  assert.equal((await failure(502, '', broadcast)).message, 'Esplora POST /tx failed (502): ');

  // 1,000 characters arrive whole. Of anything longer, the first 1,000 do.
  assert.equal((await failure(400, 'a'.repeat(1000), broadcast)).message, said + 'a'.repeat(1000));
  assert.equal((await failure(400, `${'a'.repeat(999)}bc`, broadcast)).message, `${said}${'a'.repeat(999)}b`);
  assert.equal((await failure(400, 'a'.repeat(50_000), broadcast)).message, said + 'a'.repeat(1000));

  // What the practice app's server answers when the node refuses a
  // transaction: JSON with a code and the node's own words, up to 300
  // characters of them. The limit used to be 300 for the whole body, which
  // cut the longer of these short. Now words of plain text arrive whole and
  // are still JSON, even 300 quotes or backslashes, each of which JSON
  // writes as two characters.
  const nodeWords = `sendrawtransaction RPC error: {"code":-26,"message":"${'non-mandatory-script-verify-flag '.repeat(12)}"}`;
  for (const detail of [nodeWords.slice(0, 300), 'x'.repeat(300), '"'.repeat(300), '\\'.repeat(300)]) {
    assert.equal(detail.length, 300);
    const body = JSON.stringify({ error: 'already_sent', detail });
    assert.ok(body.length > 300 && body.length <= 1000, `a body of ${body.length} characters`);
    const e = await failure(400, body, broadcast);
    assert.equal(e.status, 400);
    assert.equal(e.message, said + body);
    assert.deepEqual(JSON.parse(e.message.slice(said.length)), { error: 'already_sent', detail });
  }

  // One kind of body is still longer than the limit. JSON writes most
  // control characters as six characters each, so 300 of them make a body
  // of 1,836 characters. Its first 1,000 are kept, and they are no longer
  // JSON. Reading the code and the start of the words out of them is the
  // app's business.
  const control = String.fromCharCode(1).repeat(300);
  const longest = JSON.stringify({ error: 'already_sent', detail: control });
  assert.equal(longest.length, 1836);
  const cut = await failure(400, longest, broadcast);
  assert.equal(cut.message, said + longest.slice(0, 1000));
  assert.throws(() => JSON.parse(cut.message.slice(said.length)), SyntaxError);
});
