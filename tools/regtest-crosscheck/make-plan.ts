// Writes plan.json for xcheck.py from the wallet's frozen test vectors.
import { readFileSync } from 'node:fs';

const V = JSON.parse(readFileSync(new URL('../../wallet/test/vectors.json', import.meta.url), 'utf8'));
const descriptors = [V.abandon, V.prf.wallet].flatMap((w) => [
  { desc: w.receiveDescriptor, expected: w.receive },
  { desc: w.changeDescriptor, expected: w.change },
]);

console.log(
  JSON.stringify(
    {
      descriptors,
      // Core funds the first two receive addresses of the "abandon ... about" wallet.
      fund: [
        [V.abandon.receive[0], '0.00050000'],
        [V.abandon.receive[1], '0.00030000'],
      ],
      receive_descriptor: V.abandon.receiveDescriptor,
      change_descriptor: V.abandon.changeDescriptor,
    },
    null,
    2,
  ),
);
