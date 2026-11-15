// What the Send screen keeps of its form while the page lives
// (src/screens/send/kept.ts), and two things about its steps: the document's
// title follows the step, and the sent view names the transaction ID as
// every other screen does.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import { forgetForm, keepForm, keptForm, type KeptForm } from '../src/screens/send/kept.ts';
import { strings } from '../src/strings/index.ts';

const source = (path: string): string => readFileSync(new URL(`../src/screens/${path}`, import.meta.url), 'utf8');

const WALLET = 'tpubD-one';
const OTHER = 'tpubD-two';
const FORM: KeptForm = { to: 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6', amount: '30,000', sendAll: false, fee: '5', pot: null };

test('the form is kept for the wallet it was typed for, as a copy, until it is forgotten', () => {
  forgetForm();
  assert.equal(keptForm(WALLET), null);
  keepForm(WALLET, FORM);
  assert.deepEqual(keptForm(WALLET), FORM);
  // A copy either way: what a screen does to its fields afterwards does not reach what was kept.
  const taken = keptForm(WALLET);
  assert.ok(taken !== null && taken !== FORM);
  taken.amount = '1';
  assert.deepEqual(keptForm(WALLET), FORM);
  // Another wallet in this browser (a remove and a restore, a switch) is not shown this wallet's form,
  // and the form is forgotten then: the wallet that typed it is no longer the one here.
  assert.equal(keptForm(OTHER), null);
  assert.equal(keptForm(WALLET), null);
  keepForm(WALLET, FORM);
  assert.equal(keptForm(null), null);
  assert.equal(keptForm(WALLET), null);
  // The last one kept counts, and the pot address travels with it.
  keepForm(WALLET, { ...FORM, sendAll: true, pot: FORM.to });
  assert.deepEqual(keptForm(WALLET), { ...FORM, sendAll: true, pot: FORM.to });
  forgetForm();
  assert.equal(keptForm(WALLET), null);
});

test('Send opens with what was typed before, keeps it while the reader types, and forgets it once the payment is sent', () => {
  const screen = source('Send.svelte');
  // The fields start from what was kept for this wallet.
  assert.match(screen, /const before = keptForm\(wallet\.record\?\.xpub \?\? null\);/);
  assert.match(screen, /let toText = \$state\(before\?\.to \?\? ''\);/);
  assert.match(screen, /let amountText = \$state\(before\?\.amount \?\? ''\);/);
  assert.match(screen, /let sendAll = \$state\(before\?\.sendAll \?\? false\);/);
  assert.match(screen, /let feeText = \$state\(before\?\.fee \?\? formatSats\(FEE_RATE\.start\)\);/);
  assert.match(screen, /let potAddress = \$state<string \| null>\(before\?\.pot \?\? null\);/);
  // Kept on every change, for the wallet that is here; forgotten once a payment is sent, or with no wallet.
  assert.match(screen, /const done = sent !== null;\s*untrack\(\(\) => \{\s*if \(owner === null \|\| done\) forgetForm\(\);\s*else keepForm\(owner, form\);/);
  // The signed payment is never kept: what is kept has five fields of text, and no room for one.
  const kept = source('send/kept.ts');
  assert.match(kept, /export interface KeptForm \{\s*to: string;\s*amount: string;\s*sendAll: boolean;\s*fee: string;\s*\/\*\*[^*]*\*\/\s*pot: string \| null;\s*\}/);
  assert.doesNotMatch(kept, /^import /m);
});

test('the document title of Send follows its steps, and the sent view calls the ID what Receive and the transaction screen call it', () => {
  // No fixed name for the document's title: the frame then takes the heading, which is the step's own
  // ("Signed, not sent yet", "Payment sent"). Backup and Restore do the same.
  const screen = source('Send.svelte');
  assert.match(screen, /<WalletFrame \{title\} lede=\{step === 'form' \? t\.lede : undefined\}>/);
  assert.doesNotMatch(screen, /titleName/);
  // "Transaction" is the name of a screen. The 64 characters are the transaction ID.
  const sent = source('send/Sent.svelte');
  assert.match(sent, /<Row name=\{w\.txId\} data-testid="sent-txid">/);
  assert.doesNotMatch(sent, /screen_tx/);
  for (const lang of LANGS) assert.equal(strings.wallet[lang].txId, strings.receive[lang].txid, lang);
});
