// Pay it forward, end to end on the live practice network:
//   1. learner A asks the faucet for coins;
//   2. A passes 30,000 sats on to a fresh pot address;
//   3. learner B asks the faucet, and B's payment spends A's pot coin
//      (when the pot was empty before the run, so A's coin is the oldest).
//
//   ESPLORA_URL, BOTS_URL  through the router (run-bots-e2e.sh sets up the tunnel)
//   BOTS_API_TOKEN         the bots' bearer token (never printed)
import { Esplora, accountFromMnemonic, buildPayment, deriveAddress, newMnemonic, scanWallet } from '../../wallet/src/index.ts';

const { ESPLORA_URL, BOTS_URL, BOTS_API_TOKEN } = process.env;
if (!ESPLORA_URL || !BOTS_URL || !BOTS_API_TOKEN) throw new Error('Set ESPLORA_URL, BOTS_URL and BOTS_API_TOKEN');
const esplora = new Esplora(ESPLORA_URL);

async function bots(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BOTS_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${BOTS_API_TOKEN}`, 'Content-Type': 'application/json' },
  });
  return { status: res.status, body: await res.json() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, seconds: number, probe: () => Promise<T | undefined>): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < seconds * 1000) {
    const v = await probe().catch(() => undefined);
    if (v !== undefined) {
      console.log(`  ${what} after ${((Date.now() - start) / 1000).toFixed(1)} s`);
      return v;
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

async function faucet(address: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = await bots('/faucet', { method: 'POST', body: JSON.stringify({ address }) });
    if (r.status === 200) return r.body;
    if (r.status !== 503) throw new Error(`faucet answered ${r.status}: ${JSON.stringify(r.body)}`);
    console.log('  faucet is refilling, waiting...');
    await sleep(15000);
  }
  throw new Error('faucet stayed busy');
}

const confirmedAtLeast = (key: any, sats: bigint) => async () => {
  const s = await scanWallet(key, esplora);
  return s.confirmed >= sats ? s : undefined;
};

const statsBefore = (await bots('/pot/stats')).body;
console.log(`pot before: ${JSON.stringify(statsBefore)}`);

const a = accountFromMnemonic(newMnemonic());
const aPaid = await faucet(deriveAddress(a.key, 0, 0).address);
console.log(`learner A ${a.masterFingerprint} got ${aPaid.amount_sats} sats: ${aPaid.txid}`);
const aState = await until('A sees the faucet coin confirmed', 120, confirmedAtLeast(a.key, 100_000n));

const pot = (await bots('/pot/address')).body.address as string;
const passOn = buildPayment(a.key, aState, { to: pot, amount: 30_000n, feeRate: 2n });
await esplora.broadcast(passOn.hex);
console.log(`A passed 30000 sats on to the pot: ${passOn.txid}`);
await until('A\'s pot payment confirms', 120, async () => ((await esplora.tx(passOn.txid)).status.confirmed ? true : undefined));

const b = accountFromMnemonic(newMnemonic());
const bPaid = await faucet(deriveAddress(b.key, 0, 0).address);
console.log(`learner B ${b.masterFingerprint} got ${bPaid.amount_sats} sats: ${bPaid.txid}, pot coin ${JSON.stringify(bPaid.pot_coin)}`);
const bTx = await until('B\'s payment shows in Esplora', 60, () => esplora.tx(bPaid.txid));
await until('B sees the coin confirmed', 120, confirmedAtLeast(b.key, 100_000n));
const statsAfter = (await bots('/pot/stats')).body;

const potWasEmpty = statsBefore.coins_waiting === 0;
const checks = {
  b_payment_spent_a_pot_coin: potWasEmpty ? bPaid.pot_coin?.txid === passOn.txid : bPaid.pot_coin !== null,
  a_coin_is_an_input_of_b_tx: potWasEmpty ? bTx.vin.some((v: any) => v.txid === passOn.txid) : true,
  counter_went_up: statsAfter.coins_passed_to_newcomers === statsBefore.coins_passed_to_newcomers + 1,
  learners_passed_on_counted: statsAfter.learners_passed_on >= statsBefore.learners_passed_on + 1,
};
console.log(JSON.stringify({ potWasEmpty, checks, statsAfter }, null, 2));
if (!Object.values(checks).every(Boolean)) throw new Error('pay-it-forward check failed');
console.log('PAY IT FORWARD OK');
