// End-to-end run of the wallet library against the live practice network:
// a brand-new wallet is funded by the treasury, finds its coin through
// Esplora (first in the mempool, then confirmed), pays the treasury back,
// broadcasts through Esplora, and checks the result on both sides.
//
//   ESPLORA_URL   e.g. http://127.0.0.1:18081/esplora (run-e2e.sh sets up the tunnel)
//   PRACTICE_SSH  ssh target of the practice server, for the treasury side
import { execFileSync } from 'node:child_process';
import {
  Esplora,
  accountFromMnemonic,
  buildPayment,
  deriveAddress,
  newMnemonic,
  scanWallet,
  type WalletState,
} from '../../wallet/src/index.ts';

const esploraUrl = process.env.ESPLORA_URL;
const sshTarget = process.env.PRACTICE_SSH;
if (!esploraUrl || !sshTarget) throw new Error('Set ESPLORA_URL and PRACTICE_SSH');

const esplora = new Esplora(esploraUrl);
const sshOpts = (process.env.SSH_OPTS ?? '').split(' ').filter(Boolean);
const cli = (...args: string[]) =>
  execFileSync('ssh', [...sshOpts, sshTarget, '/opt/learnbitcoin-practice/ops/cli.sh', ...args], { encoding: 'utf8' }).trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, seconds: number, probe: () => Promise<T | undefined>): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < seconds * 1000) {
    const v = await probe();
    if (v !== undefined) {
      console.log(`  ${what} after ${((Date.now() - start) / 1000).toFixed(1)} s`);
      return v;
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

const FUND = 100_000n;
const PAY = 30_000n;

const account = accountFromMnemonic(newMnemonic());
const receive0 = deriveAddress(account.key, 0, 0).address;
console.log(`new practice wallet ${account.masterFingerprint}, first address ${receive0}`);

const fundTxid = cli('-rpcwallet=treasury', 'sendtoaddress', receive0, '0.00100000');
console.log(`treasury paid it: ${fundTxid}`);

await until('the coin shows up unconfirmed', 30, async () => {
  const s = await scanWallet(account.key, esplora);
  return s.unconfirmed === FUND ? s : undefined;
});
const funded: WalletState = await until('the coin confirms', 90, async () => {
  const s = await scanWallet(account.key, esplora);
  return s.confirmed === FUND ? s : undefined;
});

const recipient = cli('-rpcwallet=treasury', 'getnewaddress', 'e2e-return', 'bech32');
const payment = buildPayment(account.key, funded, { to: recipient, amount: PAY, feeRate: 2n });
const broadcastTxid = await esplora.broadcast(payment.hex);
console.log(`paid ${PAY} sats back to the treasury: ${broadcastTxid} (fee ${payment.fee} sats, ${payment.vsize} vB)`);
if (broadcastTxid !== payment.txid) throw new Error('Esplora returned a different txid');

await until('the payment confirms', 90, async () => {
  const tx = await esplora.tx(payment.txid).catch(() => undefined);
  return tx?.status.confirmed ? tx : undefined;
});

const after = await scanWallet(account.key, esplora);
const expectedChange = FUND - PAY - payment.fee;
const core = JSON.parse(cli('getrawtransaction', payment.txid, '1'));
const received = Math.round(Number(cli('-rpcwallet=treasury', 'getreceivedbyaddress', recipient, '1')) * 1e8);

const checks = {
  change_confirmed: after.confirmed === expectedChange,
  one_coin_left: after.coins.length === 1 && after.coins[0]!.chain === 1,
  next_change_index: after.nextChangeIndex === 1,
  core_confirmations: core.confirmations >= 1,
  core_vsize_matches: core.vsize === payment.vsize,
  treasury_received: received === Number(PAY),
};
console.log(JSON.stringify({ wallet: account.masterFingerprint, fundTxid, paymentTxid: payment.txid, checks }, null, 2));
if (!Object.values(checks).every(Boolean)) throw new Error('End-to-end check failed');
console.log('E2E OK');
