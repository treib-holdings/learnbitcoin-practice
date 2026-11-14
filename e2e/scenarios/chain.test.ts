// The practice network as a page reaches it: through the Worker, which adds
// nothing and loses nothing on the way. The first scenario runs against the
// stand-in and against a real network alike; the other two drive the
// stand-in, so a live run reports them as skipped.

import assert from 'node:assert/strict';
import { DUMMY_TOKEN, FUNDED_COINS, freshRecord, fundTestWallet, scenario, testRecord, type OpenedPage } from './helpers.ts';

interface Utxo {
  txid: string;
  value: number;
  status: { confirmed: boolean };
}

/** An address's coins, asked by the page's own script. */
const coinsVia = (page: OpenedPage, address: string): Promise<Utxo[]> =>
  page.page.evaluate(async (asked) => (await (await fetch(`/api/esplora/address/${asked}/utxo`)).json()) as Utxo[], address);

const heightVia = (page: OpenedPage): Promise<number> =>
  page.page.evaluate(async () => Number(await (await fetch('/api/esplora/blocks/tip/height')).text()));

scenario('the chain through the page\'s own fetch is the chain the network itself reports', async (s) => {
  const page = await s.open('/');

  // The height, read between two looks at the network itself (a block may land in between).
  const before = await s.network.height();
  const seen = await heightVia(page);
  const after = await s.network.height();
  assert.ok(seen >= before && seen <= after, `the page read ${seen}, the network said ${before} to ${after}`);

  // The next block shows at once.
  const next = await s.network.nextBlock();
  assert.ok(next > before);
  assert.ok((await heightVia(page)) >= next);

  // An address's coins: the same count and the same sum both ways. (On a real network the
  // well-known test wallet may hold anything, so the two answers are compared, not counted.)
  const address = testRecord().firstAddress;
  const direct = await s.network.coins(address);
  const through = await coinsVia(page, address);
  assert.equal(through.length, direct.count);
  assert.equal(through.reduce((sum, coin) => sum + coin.value, 0), direct.sats);

  // A wallet made this moment has no history on any network.
  const fresh = freshRecord();
  assert.notEqual(fresh.firstAddress, address);
  assert.deepEqual(await s.network.coins(fresh.firstAddress), { count: 0, sats: 0 });
  assert.deepEqual(await coinsVia(page, fresh.firstAddress), []);
});

scenario('a funded wallet: what the stand-in paid is what the page is told, and a block confirms the rest', async (s) => {
  const paid = fundTestWallet(s.standIn); // only the stand-in can do this: local only from here
  const page = await s.open('/wallet', { record: testRecord() });

  for (const coin of paid) {
    const told = await coinsVia(page, coin.address);
    assert.deepEqual(
      told.map((each) => [each.txid, each.value, each.status.confirmed]),
      [[coin.txid, coin.sats, coin.confirmed]],
      `receive address ${coin.index}`,
    );
  }
  assert.deepEqual(paid.map((coin) => [coin.index, coin.sats, coin.confirmed]), FUNDED_COINS.map((coin) => [coin.index, coin.sats, coin.confirmed]));

  await s.network.nextBlock();
  const waiting = paid.find((coin) => !coin.confirmed)!;
  assert.equal((await coinsVia(page, waiting.address))[0]?.status.confirmed, true);
  // The wallet the page was given is the one in its storage, untouched by the placeholder app.
  assert.equal(await page.stored(), JSON.stringify(testRecord()));
});

scenario('a busy faucet says so; once it is free it pays, and the bot check was asked both times', { localOnly: true }, async (s) => {
  const address = testRecord().firstAddress;
  const page = await s.open('/wallet/receive', { record: testRecord() });
  const ask = () =>
    page.page.evaluate(
      async (body) => {
        const response = await fetch('/api/faucet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        return { status: response.status, body: (await response.json()) as Record<string, unknown> };
      },
      JSON.stringify({ address, token: DUMMY_TOKEN }),
    );

  s.standIn.setFaucet('busy');
  assert.deepEqual(await ask(), { status: 429, body: { error: 'busy' } });
  assert.deepEqual(await s.network.coins(address), { count: 0, sats: 0 });

  s.standIn.setFaucet('ok');
  const payment = await ask();
  assert.equal(payment.status, 200);
  assert.equal(payment.body.amountSats, s.stack.config.faucetSats);
  assert.deepEqual(await s.network.coins(address), { count: 1, sats: s.stack.config.faucetSats });

  // A token that is not Cloudflare's dummy token does not pass the local bot check.
  const forged = await page.page.evaluate(async (body) => {
    const response = await fetch('/api/faucet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }, JSON.stringify({ address, token: 'not-the-dummy-token' }));
  assert.deepEqual(forged, { status: 403, body: { error: 'bot_check' } });
  assert.deepEqual(s.stack.botChecks, [
    { token: DUMMY_TOKEN, address },
    { token: DUMMY_TOKEN, address },
    { token: 'not-the-dummy-token', address },
  ]);

  // A limiter told to refuse answers "limit" before anybody else is asked.
  s.stack.over.add('faucet');
  assert.deepEqual(await ask(), { status: 429, body: { error: 'limit' } });
  assert.equal(s.stack.botChecks.length, 3);
});
