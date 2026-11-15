// The plain helpers behind the wallet's four looking screens (Overview,
// Coins, Activity and one transaction: src/screens/read/read.ts), and the
// rules their text and their files keep: what the Overview shows for which
// wallet, what a list of transactions shows when it cannot be read, what
// each answer to "Choose another passkey" leads to, how the transaction
// screen asks and when it stops, and how a transaction is put into words.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import type { TxView } from '@learnbitcoin/practice-wallet';
import { splitLead } from '../src/components/text.ts';
import type { ApiFailure } from '../src/lib/api.ts';
import { DEFAULT_CONFIG } from '../src/lib/config.ts';
import { fill, slotNames } from '../src/lib/format.ts';
import type { TxLookup, UnlockResult } from '../src/lib/wallet-api.ts';
import {
  OVERVIEW_COINS,
  OVERVIEW_TXS,
  WAIT_LIMIT_MS,
  WAIT_STEP_MS,
  activityNotice,
  activityShows,
  afterChoose,
  afterLookup,
  amountSentence,
  explorerTxUrl,
  firstFew,
  glossaryUrl,
  keepShown,
  overviewBody,
  txReplaceable,
  txStatus,
  txSummary,
  type TxShows,
  type TxStep,
} from '../src/screens/read/read.ts';
import { strings } from '../src/strings/index.ts';

const TXID = '5a08b9a18ac03ba34f0413f71cbd22b215e4b087f44d0d83251688a0bffe1177';

function view(over: Partial<TxView> = {}): TxView {
  return {
    txid: TXID,
    confirmed: false,
    height: null,
    time: null,
    inputs: [],
    outputs: [],
    fee: 282n,
    vsize: 141,
    feeRate: 2,
    net: 0n,
    direction: 'other',
    rbf: true,
    ...over,
  };
}

// -- the Overview -------------------------------------------------------------------

test('overview: a few coins and a few transactions, never the lists themselves', () => {
  // SPEC section 3: "first few coins ... recent activity". Three to five of each.
  assert.ok(OVERVIEW_COINS >= 3 && OVERVIEW_COINS <= 5);
  assert.ok(OVERVIEW_TXS >= 3 && OVERVIEW_TXS <= 5);
  const list = [1, 2, 3, 4, 5, 6];
  const few = firstFew(list, 3);
  assert.deepEqual(few, [1, 2, 3]);
  // A new list: the wallet's own is never changed in place.
  few.push(9);
  assert.deepEqual(list, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(firstFew([1], 3), [1]);
  assert.deepEqual(firstFew([1, 2], 0), []);
  assert.deepEqual(firstFew([1, 2], -1), []);
});

test('overview: coins, or "no coins yet", or the causes for a wallet that was opened empty', () => {
  assert.equal(overviewBody({ coins: 4, openedEmpty: false }), 'coins');
  assert.equal(overviewBody({ coins: 0, openedEmpty: false }), 'no-coins');
  assert.equal(overviewBody({ coins: 0, openedEmpty: true }), 'causes');
  // A wallet that holds a coin is never explained away.
  assert.equal(overviewBody({ coins: 1, openedEmpty: true }), 'coins');
});

// -- the list of transactions -------------------------------------------------------

test('activity: loading, empty and rows; a failed read keeps the old list and names the cause', () => {
  assert.deepEqual(activityShows(null, null), { list: 'loading', failure: null });
  assert.deepEqual(activityShows([], null), { list: 'empty', failure: null });
  assert.deepEqual(activityShows([view()], null), { list: 'rows', failure: null });
  // Never read, and the read failed: there is nothing older to show.
  assert.deepEqual(activityShows(null, 'network'), { list: 'unread', failure: 'network' });
  // Read before, and the latest read failed: the old list stays, with the cause.
  assert.deepEqual(activityShows([view()], 'unavailable'), { list: 'rows', failure: 'unavailable' });
  assert.deepEqual(activityShows([], 'limit'), { list: 'empty', failure: 'limit' });
});

test('activity: one notice at a time. The list says why it could not be read only while the frame does not', () => {
  assert.equal(activityNotice(null, null), 'none');
  // The coins could not be read, the list was: nothing for the list to say.
  assert.equal(activityNotice(null, 'unavailable'), 'none');
  // Only the list failed: its own cause and its own "Try again".
  assert.equal(activityNotice('limit', null), 'list');
  // Both failed: the frame's notice and button stand for both, whatever the two reasons are.
  assert.equal(activityNotice('unavailable', 'unavailable'), 'frame');
  assert.equal(activityNotice('limit', 'network'), 'frame');
});

test('activity: "Try again" is answered by the list itself, not by the coins that are read before it', () => {
  // The wallet's refresh() reads the coins and then the list, and resolves when the read of the list
  // has ended (test/chain-sync.test.ts holds the wallet to that). So what the wallet shows at that
  // moment is how the try went, and the list has no clock of its own to guess by.
  const list = readFileSync(new URL('../src/screens/read/ActivityList.svelte', import.meta.url), 'utf8');
  const script = list.slice(0, list.indexOf('</script>'));
  assert.match(script, /await wallet\.refresh\(\);\s*if \(gone\) return;\s*trying = false;/);
  // The coins could not be read: the frame says so, and the line under it is the answer to the try.
  assert.match(script, /if \(wallet\.chain\.error !== null\) \{[\s\S]*?answered = true;\s*return;\s*\}/);
  // The list could not be read: its cause is drawn afresh, also when it is the same cause as before.
  assert.match(script, /if \(wallet\.historyError !== null\) tries \+= 1;/);
  assert.doesNotMatch(script, /setTimeout|setInterval/);
});

// -- "Choose another passkey" ---------------------------------------------------------

test('another passkey: every answer of unlock() has its own outcome', () => {
  const answers: [UnlockResult, ReturnType<typeof afterChoose>][] = [
    [{ kind: 'unlocked' }, { show: 'same' }],
    [{ kind: 'tampered' }, { show: 'tampered' }],
    [{ kind: 'other-passkey', tag: 'M3XD', fingerprint: '0b3f1a2c' }, { show: 'question' }],
    [{ kind: 'changed' }, { show: 'changed' }],
    [{ kind: 'gone' }, { show: 'gone' }],
    [{ kind: 'cancelled', timedOut: false }, { show: 'passkey', failure: { kind: 'cancelled', timedOut: false } }],
    [{ kind: 'cancelled', timedOut: true }, { show: 'passkey', failure: { kind: 'cancelled', timedOut: true } }],
    [{ kind: 'no-prf', tag: null }, { show: 'passkey', failure: { kind: 'no-prf', tag: null } }],
    [{ kind: 'error', name: 'NotAllowedError' }, { show: 'passkey', failure: { kind: 'error', name: 'NotAllowedError' } }],
    [{ kind: 'busy' }, { show: 'passkey', failure: { kind: 'busy' } }],
    [{ kind: 'reload' }, { show: 'passkey', failure: { kind: 'reload' } }],
    [{ kind: 'broken' }, { show: 'passkey', failure: { kind: 'broken' } }],
  ];
  for (const [answer, outcome] of answers) assert.deepEqual(afterChoose(answer), outcome, answer.kind);
  // Every kind an unlock can end with is on the list above.
  const kinds = new Set(answers.map(([answer]) => answer.kind));
  assert.equal(kinds.size, 11);
});

// -- links that leave the app ---------------------------------------------------------

test('links: the glossary in the language of the page, and the explorer by transaction ID', () => {
  const site = DEFAULT_CONFIG.siteUrl;
  assert.ok(!site.endsWith('/'));
  assert.equal(glossaryUrl(site, 'en', 'utxo'), `${site}/glossary/utxo-unspent-transaction-output`);
  assert.equal(glossaryUrl(site, 'es', 'utxo'), `${site}/es/glosario/utxo`);
  assert.equal(glossaryUrl(site, 'en', 'rbf'), `${site}/glossary/replace-fee-rbf`);
  assert.equal(glossaryUrl(site, 'es', 'rbf'), `${site}/es/glosario/rbf`);
  assert.equal(explorerTxUrl(DEFAULT_CONFIG.explorerUrl, TXID), `${DEFAULT_CONFIG.explorerUrl}/tx/${TXID}`);
  // No address is typed into a screen: both are built from the wallet's settings.
  for (const name of ['Overview.svelte', 'Coins.svelte', 'Activity.svelte', 'Tx.svelte']) {
    const text = readFileSync(new URL(`../src/screens/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /https?:\/\//, name);
  }
});

// -- one transaction: asking ------------------------------------------------------------

test('lookup: found, not found and failed are shown as they are, and nothing more is asked', () => {
  const found = afterLookup({ kind: 'found', view: view() }, null, 1000);
  assert.equal(found.shows.kind, 'found');
  assert.equal(found.askAgainIn, null);
  assert.equal(found.waitingSince, null);

  assert.deepEqual(afterLookup({ kind: 'not-found' }, null, 1000), {
    shows: { kind: 'not-found', waited: false },
    waitingSince: null,
    waitedOut: false,
    askAgainIn: null,
  });

  for (const reason of ['network', 'unavailable', 'limit'] as ApiFailure[]) {
    assert.deepEqual(afterLookup({ kind: 'failed', reason }, null, 1000), {
      shows: { kind: 'failed', reason },
      waitingSince: null,
      waitedOut: false,
      askAgainIn: null,
    });
  }
});

test('lookup: a look that fails takes a transaction that is shown off the screen no more than a failed refresh takes the coins', () => {
  const found: TxShows = { kind: 'found', view: view() };
  const failed: TxShows = { kind: 'failed', reason: 'limit' };
  // The transaction stays: the very object that was shown.
  assert.equal(keepShown(found, failed, TXID), found);
  // With no transaction on screen, the failure is what there is to show.
  assert.equal(keepShown({ kind: 'asking' }, failed, TXID), failed);
  assert.equal(keepShown({ kind: 'not-found', waited: false }, failed, TXID), failed);
  assert.equal(keepShown({ kind: 'waiting' }, failed, TXID), failed);
  // Every other answer is shown as it comes: a newer view, and a transaction the network no longer lists.
  const newer: TxShows = { kind: 'found', view: view({ confirmed: true, height: 5900 }) };
  assert.equal(keepShown(found, newer, TXID), newer);
  const dropped: TxShows = { kind: 'not-found', waited: false };
  assert.equal(keepShown(found, dropped, TXID), dropped);
  // A transaction left over from another ID is never kept.
  assert.equal(keepShown(found, failed, 'ab'.repeat(32)), failed);
});

test('lookup: a transaction not listed yet is asked for again every few seconds, for two minutes', () => {
  assert.equal(WAIT_LIMIT_MS, 120_000);
  assert.ok(WAIT_STEP_MS >= 2000 && WAIT_STEP_MS <= 5000, 'every few seconds');

  const waiting: TxLookup = { kind: 'waiting' };
  // Asked again and again, as the screen does: the wait started with the first answer.
  let step: TxStep = afterLookup(waiting, null, 50_000);
  assert.deepEqual({ ...step }, { shows: { kind: 'waiting' }, waitingSince: 50_000, waitedOut: false, askAgainIn: WAIT_STEP_MS });
  let now = 50_000;
  let asks = 1;
  while (step.askAgainIn !== null) {
    now += step.askAgainIn;
    step = afterLookup(waiting, step.waitingSince, now);
    asks += 1;
    assert.ok(asks < 100, 'the asking ends');
  }
  assert.deepEqual(step.shows, { kind: 'not-found', waited: true });
  assert.equal(now - 50_000, WAIT_LIMIT_MS);
  assert.equal(asks, WAIT_LIMIT_MS / WAIT_STEP_MS + 1);

  // One second short of two minutes it is still waiting.
  assert.equal(afterLookup(waiting, 50_000, 50_000 + WAIT_LIMIT_MS - 1000).shows.kind, 'waiting');
  // A transaction that turns up ends the wait.
  assert.equal(afterLookup({ kind: 'found', view: view() }, 50_000, 60_000).waitingSince, null);
  // A look that fails in the middle does not start the two minutes again.
  assert.equal(afterLookup({ kind: 'failed', reason: 'network' }, 50_000, 60_000).waitingSince, 50_000);
  // "Try again" does: the screen hands in null.
  assert.equal(afterLookup(waiting, null, 500_000).waitingSince, 500_000);
});

test('lookup: a wait that the wallet ends is a wait that ran out, and stays one until the transaction turns up', () => {
  // The wallet says "waiting" for two minutes from the moment it was handed the ID, which is before the
  // screen's first look. So its "not found" comes before the screen's own two minutes are up.
  let step = afterLookup({ kind: 'waiting' }, null, 10_000);
  step = afterLookup({ kind: 'waiting' }, step.waitingSince, 13_000, step.waitedOut);
  step = afterLookup({ kind: 'not-found' }, step.waitingSince, 16_000, step.waitedOut);
  assert.deepEqual(step, { shows: { kind: 'not-found', waited: true }, waitingSince: null, waitedOut: true, askAgainIn: null });

  // The reader tries again (the screen hands in null), and a new block makes the screen look again: still the same cause.
  step = afterLookup({ kind: 'not-found' }, null, 20_000, step.waitedOut);
  assert.deepEqual(step.shows, { kind: 'not-found', waited: true });
  step = afterLookup({ kind: 'not-found' }, step.waitingSince, 50_000, step.waitedOut);
  assert.deepEqual(step.shows, { kind: 'not-found', waited: true });
  // A look that fails in between does not forget it.
  step = afterLookup({ kind: 'failed', reason: 'network' }, step.waitingSince, 60_000, step.waitedOut);
  assert.equal(step.waitedOut, true);
  step = afterLookup({ kind: 'not-found' }, step.waitingSince, 70_000, step.waitedOut);
  assert.deepEqual(step.shows, { kind: 'not-found', waited: true });

  // The transaction turns up: the wait is over for good.
  step = afterLookup({ kind: 'found', view: view() }, step.waitingSince, 80_000, step.waitedOut);
  assert.equal(step.waitedOut, false);
  // And if the network later lists it no more (it was replaced), that is no wait that ran out.
  step = afterLookup({ kind: 'not-found' }, step.waitingSince, 90_000, step.waitedOut);
  assert.deepEqual(step.shows, { kind: 'not-found', waited: false });

  // The screen's own two minutes end the same way.
  step = afterLookup({ kind: 'waiting' }, 0, WAIT_LIMIT_MS, false);
  assert.deepEqual(step.shows, { kind: 'not-found', waited: true });
  assert.equal(step.waitedOut, true);

  // An ID the wallet never waited for is simply not listed.
  assert.deepEqual(afterLookup({ kind: 'not-found' }, null, 1000).shows, { kind: 'not-found', waited: false });
});

// -- one transaction: in words ------------------------------------------------------------

test('summary: the amount is what the wallet gained or what left it, never below 0', () => {
  assert.deepEqual(txSummary({ direction: 'received', net: 25_000n }), { kind: 'received', sats: 25_000n });
  // Sent: everything that left the wallet, the fee included.
  assert.deepEqual(txSummary({ direction: 'sent', net: -30_282n }), { kind: 'sent', sats: 30_282n });
  // Paid to itself: what left is the fee.
  assert.deepEqual(txSummary({ direction: 'internal', net: -282n }), { kind: 'internal', sats: 282n });
  // Not this wallet's: no amount at all.
  assert.deepEqual(txSummary({ direction: 'other', net: 0n }), { kind: 'other', sats: 0n });
});

test('summary: the sentence is cut at its amount, so that the unit can be kept in one piece', () => {
  for (const lang of LANGS) {
    const t = strings.wallet[lang];
    const amount = lang === 'es' ? '30,282 sats de pr\u00e1ctica' : '30,282 practice sats';
    for (const key of ['txSumReceived', 'txSumSent', 'txSumInternal'] as const) {
      const parts = amountSentence(t[key], amount);
      // Put end to end, the pieces are the sentence the table gives.
      assert.equal(`${parts.before}${parts.number} ${parts.unit}${parts.after}`, fill(t[key], { amount }), `${lang}.${key}`);
      assert.equal(parts.number, '30,282', `${lang}.${key}`);
      // The unit is whole, and it is the piece with a space in it: the one that could break in two.
      assert.equal(parts.unit, amount.slice('30,282 '.length), `${lang}.${key}`);
      assert.match(parts.unit, / /, `${lang}.${key}`);
    }
    // A sentence that names no amount comes back whole.
    assert.deepEqual(amountSentence(t.txSumOther, ''), { before: t.txSumOther, number: '', unit: '', after: '' }, lang);
  }
  assert.deepEqual(amountSentence('This wallet sent {amount} in all.', '1 practice sat'), {
    before: 'This wallet sent ',
    number: '1',
    unit: 'practice sat',
    after: ' in all.',
  });
});

test('status: unconfirmed, or the block, with its day when the time is known', () => {
  assert.deepEqual(txStatus({ confirmed: false, height: null, time: null }), { kind: 'unconfirmed' });
  assert.deepEqual(txStatus({ confirmed: true, height: 5900, time: 1_794_000_000 }), {
    kind: 'block-date',
    height: 5900,
    time: 1_794_000_000,
  });
  assert.deepEqual(txStatus({ confirmed: true, height: 5900, time: null }), { kind: 'block', height: 5900 });
  assert.deepEqual(txStatus({ confirmed: true, height: null, time: null }), { kind: 'confirmed' });
  // Block 0 is a block like any other.
  assert.deepEqual(txStatus({ confirmed: true, height: 0, time: null }), { kind: 'block', height: 0 });
});

test('replaceable: not once it is in a block; before that, with the signal or without it', () => {
  assert.equal(txReplaceable({ confirmed: true, rbf: true }), 'no');
  assert.equal(txReplaceable({ confirmed: true, rbf: false }), 'no');
  assert.equal(txReplaceable({ confirmed: false, rbf: true }), 'signals');
  assert.equal(txReplaceable({ confirmed: false, rbf: false }), 'silent');
});

// -- the text -------------------------------------------------------------------------------

/** The keys these screens added to the wallet's table. */
const OWN_KEYS = Object.keys(strings.wallet.en).filter((key) =>
  /^(overview|empty|activity|coins[A-Z]|walletPasskeyHas(First)?$|tx(Looking|Waiting|NotFound|Sum|Status|PartsTitle|Replace|Id|Explorer))/.test(key),
) as (keyof typeof strings.wallet.en)[];

/**
 * Keys these screens added and no longer use. A key is never taken out of
 * the table once it is there, so they stay, for whoever tidies the table.
 * emptyOtherWhy was the unlock step's line when "Choose another passkey"
 * still locked the wallet first; it does not any more.
 */
const RETIRED_KEYS: readonly string[] = ['emptyOtherWhy'];

/** The source of the four screens and of everything under screens/read. */
function ownSources(): { name: string; text: string }[] {
  const screens = new URL('../src/screens/', import.meta.url);
  const read = new URL('read/', screens);
  return [
    ...['Overview.svelte', 'Coins.svelte', 'Activity.svelte', 'Tx.svelte'].map((name) => ({ name, url: new URL(name, screens) })),
    ...readdirSync(read).map((name) => ({ name: `read/${name}`, url: new URL(name, read) })),
  ].map(({ name, url }) => ({ name, text: readFileSync(url, 'utf8') }));
}

test('text: every key these screens added is used by one of them', () => {
  assert.ok(OWN_KEYS.length >= 45, `the walk found the keys (${OWN_KEYS.length})`);
  const source = ownSources()
    .map((file) => file.text)
    .join('\n');
  for (const key of OWN_KEYS) {
    if (RETIRED_KEYS.includes(key)) assert.doesNotMatch(source, new RegExp(`\\bt\\.${key}\\b`), `${key} is used again: take it off the retired list`);
    else assert.match(source, new RegExp(`\\bt\\.${key}\\b`), key);
  }
});

test('text: where a screen names the passkey first, Spanish says "(passkey)" beside its own word', () => {
  const { en, es } = strings.wallet;
  // SPEC section 12: "llave de acceso (passkey)" on first mention on a screen. The wallet frame's line
  // does it while the wallet is locked; unlocked, these two are the first mention on the Overview.
  for (const [plain, first] of [
    ['emptyOpenedLead', 'emptyOpenedLeadFirst'],
    ['walletPasskeyHas', 'walletPasskeyHasFirst'],
  ] as const) {
    assert.equal(en[first], en[plain], `en.${first}`);
    assert.equal(es[first], es[plain].replace('llave de acceso', 'llave de acceso (passkey)'), `es.${first}`);
    assert.equal(es[plain].split('llave de acceso').length, 2, `es.${plain} names it once`);
    assert.doesNotMatch(es[plain], /\(passkey\)/, `es.${plain}`);
  }
  // Each screen picks by the lock, which is what the frame's own line goes by.
  const overview = readFileSync(new URL('../src/screens/Overview.svelte', import.meta.url), 'utf8');
  const empty = readFileSync(new URL('../src/screens/read/OpenedEmpty.svelte', import.meta.url), 'utf8');
  assert.match(overview, /wallet\.unlocked \? t\.walletPasskeyHasFirst : t\.walletPasskeyHas\b/);
  assert.match(empty, /wallet\.unlocked \? t\.emptyOpenedLeadFirst : t\.emptyOpenedLead\b/);
  // And the frame's two lines are what that choice rests on.
  assert.match(strings.common.es.stateLocked, /llave de acceso \(passkey\)/);
  assert.doesNotMatch(strings.common.es.stateUnlocked, /llave de acceso/);
});

test('text: a reader refused for asking too fast is not told to ask again now', () => {
  for (const lang of LANGS) {
    const t = strings.wallet[lang];
    // The line for every other failure is this one plus the invitation.
    assert.ok(t.activityRetries.startsWith(t.activityRetriesAlone), lang);
    assert.ok(t.activityRetries.length > t.activityRetriesAlone.length, lang);
  }
  assert.equal(strings.wallet.en.activityRetriesAlone, 'This page tries again by itself.');
  const list = readFileSync(new URL('../src/screens/read/ActivityList.svelte', import.meta.url), 'utf8');
  assert.match(list, /shows\.failure === 'limit' \? t\.activityRetriesAlone : t\.activityRetries\b/);
});

test('text: the sentences the spec gives, and facts as slots', () => {
  const { en } = strings.wallet;
  assert.equal(en.txWaiting, 'Waiting for the practice network to list this transaction...');
  assert.equal(en.txExplorer, 'See it on the practice explorer');
  // "La transacción" is feminine, and the same screen calls it "Confirmada": so "Verla".
  assert.equal(strings.wallet.es.txExplorer, 'Verla en el explorador de práctica');
  // Bitcoin's own network has one name in the Spanish, the one Send and the Sparrow page give it.
  assert.match(strings.wallet.es.txNotFound, /Un txid de la red real de Bitcoin nunca aparece aquí\.$/);
  for (const area of ['wallet', 'send', 'sparrow', 'receive', 'about'] as const) {
    for (const [key, text] of Object.entries(strings[area].es as Readonly<Record<string, string>>)) {
      assert.doesNotMatch(text, /red principal/, `${area}.es.${key}`);
    }
  }
  assert.match(en.coinsLede, /holds coins, not a balance/);
  assert.match(en.coinsWhat, /spends whole coins and makes new ones/);
  assert.match(en.coinsWhat, /UTXO/);
  for (const lang of LANGS) {
    const t = strings.wallet[lang];
    assert.deepEqual(slotNames(t.txStatusUnconfirmed), ['seconds'], lang);
    assert.deepEqual(slotNames(t.txStatusBlockDate).sort(), ['date', 'height'], lang);
    assert.deepEqual(slotNames(t.txStatusBlock), ['height'], lang);
    assert.deepEqual(slotNames(t.txNotFoundWaited), ['minutes'], lang);
    assert.deepEqual(slotNames(t.coinsMarks).sort(), ['change', 'unconfirmed'], lang);
    for (const key of ['txSumReceived', 'txSumSent', 'txSumInternal'] as const) assert.deepEqual(slotNames(t[key]), ['amount'], `${lang}.${key}`);
    assert.deepEqual(slotNames(t.txSumOther), [], lang);
    // No number is written into a sentence of these screens: every figure is a slot.
    for (const key of OWN_KEYS) {
      if (/12 (words|palabras)/.test(t[key])) continue;
      assert.doesNotMatch(t[key].replace(/BIP ?\d+/g, ''), /\d/, `${lang}.${key}`);
    }
  }
  assert.equal(
    fill(en.txStatusUnconfirmed, { seconds: String(DEFAULT_CONFIG.blockSeconds) }),
    'Unconfirmed: it is not in a block yet. On the practice network a block comes about every 30 seconds.',
  );
  assert.equal(fill(en.txSumSent, { amount: '30,282 practice sats' }), 'This wallet sent 30,282 practice sats in all, the fee included.');
});

test('text: what went wrong gives the cause, then the way out', () => {
  for (const lang of LANGS) {
    const t = strings.wallet[lang];
    for (const key of ['txNotFound', 'txNotFoundWaited', 'emptyOtherSame'] as const) {
      const { lead, rest } = splitLead(t[key]);
      assert.ok(lead.endsWith('.') && rest !== '', `${lang}.${key}`);
      assert.ok(t[key].endsWith('.'), `${lang}.${key}`);
    }
    // Work that is under way is said with three periods.
    for (const key of ['txLooking', 'txWaiting', 'activityLoading', 'activityReading'] as const) {
      assert.ok(t[key].endsWith('...'), `${lang}.${key}`);
    }
  }
  // A transaction that is missing is never called lost, and the way back is named.
  assert.match(strings.wallet.en.txNotFound, /try again/);
  assert.match(strings.wallet.en.txNotFoundWaited, /activity/);
});

// -- the files themselves ----------------------------------------------------------------------

test('looking never asks for a passkey: only "Choose another passkey" does, and it marks <main> busy', () => {
  const KEYS = /wallet\.(unlock|unlockWithWords|openWithPasskey|createWithPasskey|createWithWords|finishSetup|restore|sign|broadcast|revealWords|removeWallet|askFaucet|beforeBotCheck)\(/;
  const asking: string[] = [];
  for (const { name, text } of ownSources()) {
    for (const line of text.split('\n')) {
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*') || code.startsWith('<!--')) continue;
      if (KEYS.test(code)) asking.push(`${name}: ${code}`);
    }
  }
  // The one call: the reader's own tap on "Choose another passkey", on the Overview of a wallet opened empty.
  assert.deepEqual(asking, ["read/OpenedEmpty.svelte: const result = await busyWhile(wallet.unlock('picker'));"]);
});

test('choosing another passkey leaves the wallet as it is: nothing here locks it, and nothing draws the unlock step', () => {
  // The sentence for a prompt that was closed says "nothing was changed". It
  // is true only if the tap changed nothing: a wallet locked for the
  // question would need a passkey prompt for what it did not need before.
  for (const { name, text } of ownSources()) {
    assert.doesNotMatch(text, /wallet\.lock\(/, name);
    assert.doesNotMatch(text, /<Unlock\b/, name);
    assert.doesNotMatch(text, /components\/wallet\/Unlock\.svelte/, name);
  }
  const empty = readFileSync(new URL('../src/screens/read/OpenedEmpty.svelte', import.meta.url), 'utf8');
  // The question is asked here, and answered through the wallet. It is the shared piece, with the
  // hooks it has wherever it is asked (test/wallet-pieces.test.ts holds the piece itself to them);
  // a switch the browser would not store is said inside it, under this list's own hook.
  assert.match(empty, /<SwitchQuestion\s+\{pending\}\s+\{refused\}\s+refusedHook="opened-problem"/);
  const question = readFileSync(new URL('../src/components/wallet/SwitchQuestion.svelte', import.meta.url), 'utf8');
  for (const hook of ['switch-question', 'switch-confirm', 'switch-cancel']) {
    assert.match(question, new RegExp(`data-testid="${hook}"`), hook);
  }
  assert.match(empty, /data-testid="opened-choose"/);
  assert.match(empty, /wallet\.confirmSwitch\(\)/);
  assert.match(empty, /wallet\.cancelSwitch\(\)/);
  // An answer that finds the list gone is still delivered: the frame's note, and the Overview's own notice.
  assert.match(empty, /if \(gone\) \{[\s\S]*?notes\.note = \{ kind: 'tampered' \}[\s\S]*?late\(next\)/);
  const overview = readFileSync(new URL('../src/screens/Overview.svelte', import.meta.url), 'utf8');
  assert.match(overview, /<OpenedEmpty onlate=/);
  assert.match(overview, /<ChooseAnswer outcome=\{late\} \/>/);
  // The warning has the hook the unlock step gives the same sentence.
  const answer = readFileSync(new URL('../src/screens/read/ChooseAnswer.svelte', import.meta.url), 'utf8');
  assert.match(answer, /data-testid="unlock-changed-warning">\{t\.unlockChangedWarn\}/);
});

test('no screen reaches around the wallet, and none breaks the page\'s security policy', () => {
  const files = ownSources();
  assert.ok(files.length >= 7, 'the walk found the screens and their pieces');
  for (const { name, text } of files) {
    for (const banned of [/localStorage/, /sessionStorage/, /indexedDB/, /navigator\.credentials/, /\bfetch\s*\(/, /XMLHttpRequest/]) {
      assert.doesNotMatch(text, banned, name);
    }
    for (const banned of [/\sstyle=/, /<style/, /\{@html/, /\son:[a-z]+=/, /export let /, /<slot/]) {
      assert.doesNotMatch(text, banned, name);
    }
    // App.svelte alone tells the wallet which screen is open.
    assert.doesNotMatch(text, /wallet\.watch\(/, name);
    // English source is plain ASCII.
    assert.match(text, /^[\x09\x0a\x20-\x7e]*$/, name);
  }
});

test('the hooks the scenarios use are on the screens', () => {
  const overview = readFileSync(new URL('../src/screens/Overview.svelte', import.meta.url), 'utf8');
  const empty = readFileSync(new URL('../src/screens/read/OpenedEmpty.svelte', import.meta.url), 'utf8');
  // SPEC section 13: the two hooks mark this browser's wallet, on the Overview.
  for (const hook of ['passkey-tag', 'wallet-fingerprint']) {
    assert.match(overview, new RegExp(`data-testid="${hook}"`), hook);
    assert.match(empty, new RegExp(`data-testid="${hook}"`), hook);
  }
  // Never a bare "fingerprint" in what a reader sees: the label comes from the table.
  assert.match(overview, /t\.walletFingerprint\b/);
  assert.match(overview, /t\.walletFingerprintIs\b/);
});
