// "What just happened": a transaction read out in plain sentences on its
// own screen, with the transaction's own numbers.
//
// The step "There are no balances" ends on this (doit-no-balances.test.ts).
// Here the sentences themselves are held against the practice network: each
// figure a sentence gives is worked out again from the transaction as the
// network reports it (asked directly, not through the Worker or the app),
// and the sentence must say exactly that.
//
//   1. a transaction the wallet only received: whose coin was spent, what
//      came to which address, what the sender kept, the sender's fee, the
//      block; then in Spanish
//      a payment sent with change: the coin spent whole, what went to the
//      address paid, the change at a fresh address of the wallet, the fee as
//      what went in less what came out, and where the payment stands, before
//      its block and after
//      a payment sent without change ("Send all"): every coin spent, one
//      output, why no change came back
//
// It is local only: the wallet is paid from the stand-in, and a block is made.

import assert from 'node:assert/strict';
import { deriveAddress, watchOnlyAccount } from '@learnbitcoin/practice-wallet';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { OTHER_WORDS, TEST_WORDS, fundTestWallet, scenario, testRecord, type OpenedPage } from './helpers.ts';
import { arrivesAt, hook, onNetwork, rowOf, sats, storageKeys, toSection, type NetworkTx } from './journey-helpers.ts';
import { begin, ends, pay, stepsCounted, view } from './doit-helpers.ts';

const WORDS = TEST_WORDS.split(' ');

/** An address that is neither the wallet's nor the pot's: the first address of the harness's second wallet. */
const SOMEBODY = testRecord(OTHER_WORDS).firstAddress;

type Table = Record<keyof typeof strings.doit.en, string>;
type Key = Extract<keyof Table, `explain_${string}`>;

/** One sentence as the screen draws it: which one, and its words. */
type Said = [key: string, text: string];

/** The sentences under "What just happened", in the order they stand. */
const explainedOf = (page: OpenedPage): Promise<Said[]> =>
  page.page.$$eval(`${hook('tx-explained')} p`, (lines) =>
    lines.map((line) => [line.getAttribute('data-sentence') ?? '', (line.textContent ?? '').replace(/\s+/g, ' ').trim()] as [string, string]),
  );

/** The glossary entries linked under the sentences, in order. */
const glossaryOf = (page: OpenedPage): Promise<(string | null)[]> =>
  page.page.$$eval(`${hook('tx-explained-glossary')} a`, (links) => links.map((link) => link.getAttribute('href')));

/** What a transaction's figures come to, from the network's own report of it. */
function figuresOf(tx: NetworkTx): { went: number; came: number; size: number } {
  const went = tx.vin.reduce((sum, input) => sum + input.prevout.value, 0);
  const came = tx.vout.reduce((sum, output) => sum + output.value, 0);
  // What went in less what came out is the fee, to the sat: if the network's own figures did not add up, nothing below would mean anything.
  assert.equal(went - came, tx.fee);
  // A transaction's size in virtual bytes is a quarter of its weight, rounded up.
  return { went, came, size: Math.ceil(tx.weight / 4) };
}

/**
 * The sentences a language's table gives for figures the scenario worked
 * out itself. An amount is written with its unit, as the app writes
 * amounts; a fee rate that is not a whole number is given to two decimal
 * places at most, with "about".
 */
function sentences(t: Table, unit: string) {
  const amount = (value: number): string => `${sats(value)} ${unit}`;
  const said = (key: Key, slots: Record<string, string> = {}): Said => [key, fill(t[key], slots)];
  return {
    amount,
    said,
    /** The fee: what went in less what came out, then spread over the size. */
    fee(tx: NetworkTx, theirs: boolean): Said {
      const { went, came, size } = figuresOf(tx);
      const whole = tx.fee % size === 0;
      const rate = whole ? String(tx.fee / size) : String(Math.round((tx.fee / size) * 100) / 100);
      const key: Key = theirs ? (whole ? 'explain_feeTheirs' : 'explain_feeTheirsAbout') : whole ? 'explain_fee' : 'explain_feeAbout';
      return said(key, { in: sats(went), out: sats(came), fee: amount(tx.fee), size: sats(size), rate });
    },
    /** What was spent, when the coins were this wallet's. */
    spent(tx: NetworkTx): Said {
      const { went } = figuresOf(tx);
      return tx.vin.length === 1 ? said('explain_spentOne', { amount: amount(went) }) : said('explain_spentMany', { count: String(tx.vin.length), amount: amount(went) });
    },
    /** What was spent, when none of it was this wallet's. */
    theirs(tx: NetworkTx): Said {
      const { went } = figuresOf(tx);
      return tx.vin.length === 1 ? said('explain_theirsOne', { amount: amount(went) }) : said('explain_theirsMany', { count: String(tx.vin.length), amount: amount(went) });
    },
  };
}

scenario(
  '"What just happened" gives the transaction\'s own numbers: for coins the wallet only received, for a payment sent with change, before its block and after, and for one sent without change; every amount, address, fee, size and rate is the one the practice network reports, and each term links its glossary entry',
  { localOnly: true, timeout: 200_000 },
  async (s) => {
    const site = s.stack.config.siteUrl;
    const en = sentences(strings.doit.en, 'practice sats');
    const es = sentences(strings.doit.es, 'sats de práctica');
    const record = testRecord();
    const funded = fundTestWallet(s.standIn);
    const first = funded[0]!;
    const reader = await begin(s, `/wallet/tx/${first.txid}`, { record });
    const { page } = reader;

    // -- 1. Coins the wallet only received: the stand-in's own wallet paid them, and kept its change --
    await page.waitFor('tx-explained');
    const got = await onNetwork(s, first.txid);
    const mine = got.vout.filter((output) => output.scriptpubkey_address === first.address);
    const others = got.vout.filter((output) => output.scriptpubkey_address !== first.address);
    assert.deepEqual([mine.length, others.length], [1, 1], 'one output to this wallet, and the sender\'s change');
    const received = (t: ReturnType<typeof sentences>): Said[] => [
      t.theirs(got),
      t.said('explain_got', { amount: t.amount(mine[0]!.value), address: first.address }),
      // Of the other output, only that it is not this wallet's. Whose change it is can be guessed, not known.
      t.said('explain_other', { amount: t.amount(others[0]!.value) }),
      t.fee(got, true),
      t.said('explain_inBlock', { height: sats(got.status.block_height ?? 0) }),
    ];
    assert.deepEqual(await explainedOf(page), received(en));
    assert.equal(mine[0]!.value, first.sats);
    assert.ok(!(await page.text('tx-explained')).includes('No change'), 'never "there was no change" of a transaction the wallet did not make');
    assert.deepEqual(await glossaryOf(page), [
      `${site}/glossary/utxo-unspent-transaction-output`,
      `${site}/glossary/change-output`,
      `${site}/glossary/transaction-fee`,
      `${site}/glossary/block`,
    ]);
    // The same figures stand in the screen's own rows.
    const { size: gotSize } = figuresOf(got);
    assert.ok((await rowOf(page, 'main', 'tx-fee')).startsWith(en.amount(got.fee)));
    assert.ok((await rowOf(page, 'main', 'tx-size')).startsWith(sats(gotSize)));

    // The same transaction on the Spanish screen: the Spanish sentences, the same numbers, the Spanish entries.
    await page.goto(`/es/wallet/tx/${first.txid}`);
    await page.waitFor('tx-explained');
    assert.deepEqual(await explainedOf(page), received(es));
    assert.deepEqual(await glossaryOf(page), [
      `${site}/es/glosario/utxo`,
      `${site}/es/glosario/salida-de-cambio`,
      `${site}/es/glosario/comision-de-transaccion`,
      `${site}/es/glosario/bloque`,
    ]);

    // -- 2. A payment sent with change --
    await page.goto('/wallet/send');
    const paid = await pay(page, SOMEBODY, '20,000');
    await page.click('sent-link');
    await arrivesAt(page, `/wallet/tx/${paid.txid}`);
    await page.waitFor('tx-explained');
    const sent = await onNetwork(s, paid.txid);
    const to = sent.vout.filter((output) => output.scriptpubkey_address === SOMEBODY);
    const change = sent.vout.filter((output) => output.scriptpubkey_address !== SOMEBODY);
    assert.deepEqual([to.length, change.length], [1, 1]);
    assert.equal(to[0]!.value, 20_000);
    // The change went to the wallet's first change address: one it had never used.
    assert.equal(change[0]!.scriptpubkey_address, deriveAddress(watchOnlyAccount(record.xpub), 1, 0).address);
    const withChange = (standing: Said): Said[] => [
      en.spent(sent),
      en.said('explain_paid', { amount: en.amount(20_000), address: SOMEBODY }),
      en.said('explain_change', { amount: en.amount(change[0]!.value), address: change[0]!.scriptpubkey_address }),
      en.fee(sent, false),
      standing,
    ];
    assert.deepEqual(await explainedOf(page), withChange(en.said('explain_waiting')));
    assert.deepEqual(await glossaryOf(page), [
      `${site}/glossary/utxo-unspent-transaction-output`,
      `${site}/glossary/change-output`,
      `${site}/glossary/transaction-fee`,
      `${site}/glossary/mempool`,
    ]);
    const { went, came, size } = figuresOf(sent);
    // What was spent is what the coins held whole: more than the payment and the fee together, and the rest is the change.
    assert.equal(went, 20_000 + change[0]!.value + sent.fee);
    assert.equal(came, 20_000 + change[0]!.value);
    assert.ok((await rowOf(page, 'main', 'tx-fee')).startsWith(en.amount(sent.fee)));
    assert.ok((await rowOf(page, 'main', 'tx-size')).startsWith(sats(size)));
    // Once a block has taken it in, the last sentence names the block. Nothing else changes.
    const height = await s.network.nextBlock();
    await page.page.reload({ waitUntil: 'load' });
    await page.waitFor('tx-explained');
    assert.deepEqual(await explainedOf(page), withChange(en.said('explain_inBlock', { height: sats(height) })));

    // -- 3. A payment sent without change: "Send all" --
    await toSection(page, '/wallet/send');
    const all = await pay(page, 'pot', 'all');
    await page.click('sent-link');
    await arrivesAt(page, `/wallet/tx/${all.txid}`);
    await page.waitFor('tx-explained');
    const swept = await onNetwork(s, all.txid);
    assert.equal(swept.vout.length, 1, 'one output, and no change');
    assert.ok(swept.vin.length >= 2, 'every coin the wallet held');
    assert.deepEqual(await explainedOf(page), [
      en.spent(swept),
      en.said('explain_paid', { amount: en.amount(swept.vout[0]!.value), address: all.to }),
      en.said('explain_noChange'),
      en.fee(swept, false),
      en.said('explain_waiting'),
    ]);
    assert.equal(figuresOf(swept).went, swept.vout[0]!.value + swept.fee, 'everything the coins held went to the address paid and to the fee');
    assert.equal(await page.page.$$eval(hook('tx-no-change'), (lines) => lines.length), 1, 'the table under the sentences says the same');

    // No step was opened on the way: this screen belongs to the wallet, and notes nothing.
    assert.deepEqual(await storageKeys(page), ['lbp_wallet_v1']);
    assert.deepEqual(stepsCounted(s), {});

    await ends(
      s,
      reader,
      [
        view('/wallet/tx'),
        view('/es/wallet/tx'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent' },
        view('/wallet/tx'),
        view('/wallet/tx'),
        view('/wallet/send'),
        { name: 'Payment', path: '/wallet/send', value: 'sent-to-pot' },
        view('/wallet/tx'),
      ],
      {
        records: [record],
        words: [WORDS],
        addresses: [...funded.map((coin) => coin.address), SOMEBODY, all.to, change[0]!.scriptpubkey_address],
        txids: [...funded.map((coin) => coin.txid), paid.txid, all.txid],
      },
    );
  },
);
