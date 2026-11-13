// Checks the public Electrum port the way Sparrow uses it: TLS with a
// certificate the system trusts, the protocol handshake, the chain tip, and
// an address's history and balance by script hash.
//
//   node tools/integration/electrum-check.ts [host] [address]
import tls from 'node:tls';
import { electrumScripthash } from '../../wallet/src/index.ts';

const host = process.argv[2] ?? 'practice-electrum.learnbitcoin.com';
const address = process.argv[3];
const port = 50002;

const socket = tls.connect({ host, port, servername: host }); // rejects an untrusted certificate
let buffer = '';
const pending = new Map<number, (v: unknown) => void>();
let nextId = 0;
socket.setEncoding('utf8');
socket.on('data', (chunk: string) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, nl));
    buffer = buffer.slice(nl + 1);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.error ? { error: msg.error } : msg.result);
      pending.delete(msg.id);
    }
  }
});

function call(method: string, params: unknown[] = []): Promise<any> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

await new Promise<void>((resolve, reject) => {
  socket.once('secureConnect', resolve);
  socket.once('error', reject);
});
const cert = socket.getPeerCertificate();
const result: Record<string, unknown> = {
  tls: { authorized: socket.authorized, subject: cert.subject?.CN, issuer: cert.issuer?.O, valid_to: cert.valid_to },
  server_version: await call('server.version', ['lbp-electrum-check', '1.4']),
  tip: (await call('blockchain.headers.subscribe')).height,
};
if (address) {
  const sh = electrumScripthash(address);
  result.address = {
    address,
    history_txs: (await call('blockchain.scripthash.get_history', [sh])).length,
    balance: await call('blockchain.scripthash.get_balance', [sh]),
  };
}
socket.end();
console.log(JSON.stringify(result, null, 2));
