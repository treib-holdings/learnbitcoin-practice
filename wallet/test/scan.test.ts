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
