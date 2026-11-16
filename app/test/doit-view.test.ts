// What the "Do it" screens decide before they draw (src/screens/doit/view.ts,
// ask.ts and bits.ts, src/components/doit/strip.ts and
// src/screens/read/explained.ts): the words for a part's state, where its
// one action leads, what is missing and where that is put right, what the
// strip says, and "What just happened" from keys to sentences.
//
// Where a step stands is judge()'s business and is tested there. These
// tests start from what judge() answers, on worlds said in a line
// (doit-worlds.ts), and hold the screens' own decisions to the spec.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { LANGS, STEPS, type AppConfig, type StepId } from '@learnbitcoin/practice-contract';
import { ownAddresses, signPayment, viewPayment, type TxView } from '@learnbitcoin/practice-wallet';
import { ACCOUNT, POT_ADDRESS, TXID, fundedState, sampleHistory } from '../dev/sample.ts';
import { stripCount, stripOffersChapter, stripShows, stripSpeaks, stripText, stripView, stepTitle } from '../src/components/doit/strip.ts';
import { EXPLAIN_SLOTS, explain } from '../src/lib/doit/explain.ts';
import { DEFAULT_CONFIG } from '../src/lib/config.ts';
import { judge, type BlockedReason, type PartView, type StepView, type WalletTrouble } from '../src/lib/doit/judge.ts';
import { applyChange, chapterLink, type Progress, type StepNote } from '../src/lib/doit/progress.ts';
import { CHAPTERS, STEP_DEFS, nextStep, partCount, partDef } from '../src/lib/doit/steps.ts';
import { fill, slotNames } from '../src/lib/format.ts';
import { answerKey, positionsAnswered, positionsFor } from '../src/screens/doit/ask.ts';
import { bitsText, sentenceBits } from '../src/screens/doit/bits.ts';
import {
  actionOf,
  askOf,
  asksPotCount,
  canRestart,
  chapterHeading,
  chapterUrl,
  checkedInSeed,
  fillFrom,
  guideKey,
  needOf,
  paperHelp,
  progressKept,
  proofOf,
  sixBlocks,
  slotsFor,
  stateKey,
  termsOf,
  waitedOf,
  waitedText,
  waysOn,
} from '../src/screens/doit/view.ts';
import { ADDRESS_SLOTS, explainSlots, explained, explainedTerms } from '../src/screens/read/explained.ts';
import { faucetGlossaryUrl, glossaryUrl } from '../src/screens/read/read.ts';
import { strings } from '../src/strings/index.ts';
import { FP, NOW, OTHER_FP, chain, noWallet, note, record, started, state, tx, txid, world } from './doit-worlds.ts';

/** This browser's record of another wallet than the sample one, kept with its words. */
const sampleOther = () => record('words', OTHER_FP);

const SITE = 'https://www.learnbitcoin.com';
const en = strings.doit.en;
const es = strings.doit.es;

const NOW_PART: Extract<PartView, { state: 'now' }> = { state: 'now', txid: null, waiting: null, confirmations: null, unlock: false };

// -- a part's words ---------------------------------------------------------------------

test('a ticked part says what kind of proof it is: checked, opened, or the reader\'s word', () => {
  const proofs: Record<StepId, string[]> = {
    'hold-some': ['checked', 'checked', 'checked', 'checked'],
    'pass-it-on': ['checked', 'checked', 'checked'],
    'no-balances': ['opened', 'checked', 'opened'],
    'waiting-room': ['checked', 'checked', 'checked'],
    'the-seed': ['opened', 'said', 'checked'],
    'prove-the-backup': ['checked', 'checked', 'checked', 'checked'],
  };
  for (const id of STEPS) {
    assert.deepEqual(
      STEP_DEFS[id].parts.map((_part, index) => proofOf(id, index + 1)),
      proofs[id],
      id,
    );
  }
  const ticked: PartView = { state: 'ticked', waited: null };
  assert.equal(en[stateKey('no-balances', 1, ticked)], 'Opened');
  assert.equal(en[stateKey('no-balances', 2, ticked)], 'Checked');
  assert.equal(en[stateKey('the-seed', 2, ticked)], 'Your word');
  assert.equal(es[stateKey('the-seed', 2, ticked)], 'Tu palabra');
  assert.equal(en[stateKey('hold-some', 1, NOW_PART)], 'Now');
  assert.equal(en[stateKey('hold-some', 2, { state: 'later' })], 'Later');
  assert.equal(en[stateKey('hold-some', 2, { state: 'blocked', reason: 'no-coins' })], 'Not yet');
  assert.equal(en[stateKey('hold-some', 2, { state: 'unknown', reason: 'looking' })], 'Not known yet');
});

test('six practice blocks are said in minutes, in one minute or in seconds, and never as a glued number', () => {
  assert.deepEqual(sixBlocks(30), { unit: 'minutes', count: 3 });
  assert.deepEqual(sixBlocks(10), { unit: 'minutes', count: 1 });
  assert.deepEqual(sixBlocks(5), { unit: 'seconds', count: 30 });
  assert.deepEqual(sixBlocks(600), { unit: 'minutes', count: 60 });
  assert.equal(guideKey('waiting-room', 3, 30), 'guide_waiting-room_3');
  assert.equal(guideKey('waiting-room', 3, 10), 'guide_waiting-room_3_minute');
  assert.equal(guideKey('waiting-room', 3, 5), 'guide_waiting-room_3_seconds');
  assert.equal(guideKey('waiting-room', 2, 5), 'guide_waiting-room_2');
  // Each form says the same thing with the one fact it needs, in both languages.
  for (const lang of LANGS) {
    const t = strings.doit[lang];
    assert.deepEqual(slotNames(t['guide_waiting-room_3']), ['minutes'], lang);
    assert.deepEqual(slotNames(t['guide_waiting-room_3_minute']), [], lang);
    assert.deepEqual(slotNames(t['guide_waiting-room_3_seconds']), ['seconds'], lang);
  }
  assert.match(fill(en['guide_waiting-room_3'], { minutes: '3' }), /Six take about 3 minutes here, and about an hour on Bitcoin\.$/);
});

test('a sentence takes the facts it names from the screen\'s list, and still throws for one that is missing', () => {
  const values = { seconds: '30', here: FP, noted: OTHER_FP };
  assert.deepEqual(slotsFor('{here} is not {noted}', values), { here: FP, noted: OTHER_FP });
  assert.equal(fillFrom('about every {seconds} seconds', values), 'about every 30 seconds');
  assert.equal(fillFrom('no slot at all', values), 'no slot at all');
  assert.throws(() => fillFrom('{minutes} minutes', values), /no value for \{minutes\}/);
});

// -- the one action -----------------------------------------------------------------------

test('each part that sends the reader into the wallet names one screen, and the questions name none', () => {
  const where = (id: StepId, part: number, view = NOW_PART): string => {
    const action = actionOf(id, part, view);
    if (action === null) return 'none';
    const route = action.route;
    return `${en[action.label]} -> ${route.name}${action.part === undefined ? '' : `#${action.part}`}`;
  };
  assert.equal(where('hold-some', 1), 'Create a practice wallet -> new');
  assert.equal(where('hold-some', 2), 'Get practice coins -> receive#faucet');
  assert.equal(where('hold-some', 3), 'none');
  assert.equal(where('hold-some', 4), 'none');
  assert.equal(where('pass-it-on', 1), 'none');
  assert.equal(where('pass-it-on', 2), 'Open Send -> send');
  assert.equal(where('pass-it-on', 3), 'none');
  assert.equal(where('no-balances', 1), 'Open Coins -> coins');
  assert.equal(where('no-balances', 2), 'none');
  assert.equal(where('no-balances', 3), 'Open Activity -> activity');
  assert.equal(where('waiting-room', 1), 'Open Send -> send');
  assert.equal(where('the-seed', 1), 'Open Backup -> backup');
  assert.equal(where('the-seed', 2), 'none');
  assert.equal(where('the-seed', 3), 'none');
  assert.equal(where('prove-the-backup', 1), 'none');
  assert.equal(where('prove-the-backup', 2), 'Open Settings -> settings');
  // With no wallet here the one action offered is Restore, never Create.
  assert.equal(where('prove-the-backup', 3), 'Restore from the 12 words -> restore');
  assert.equal(where('prove-the-backup', 4), 'none');
  // The payment to read is named by its ID, and opens its own screen.
  const read = actionOf('no-balances', 3, { ...NOW_PART, txid: txid('a1') });
  assert.deepEqual(read, { label: 'actPayment', route: { name: 'tx', txid: txid('a1') } });
  // A part that waits for a block has nothing to press.
  assert.equal(actionOf('waiting-room', 1, { ...NOW_PART, waiting: { txid: txid('a1'), sentAt: NOW, lost: false } }), null);
  // The questions and the box, by the fact they rest on.
  assert.deepEqual(
    STEPS.flatMap((id) => STEP_DEFS[id].parts.map((_part, index) => askOf(id, index + 1))).filter((ask) => ask !== null),
    ['block', 'coins', 'said', 'words', 'words'],
  );
});

// -- what is missing -----------------------------------------------------------------------

test('a need names the step or the screen that meets it', () => {
  const none = note();
  const link = (id: StepId, part: number, reason: Exclude<BlockedReason, WalletTrouble>, progress = none): string => {
    const need = needOf(id, part, reason, progress, 'yes');
    const to =
      need.link === null ? 'no link' : need.link.kind === 'step' ? `step ${need.link.step}` : `${need.link.action.route.name}${need.link.action.part === undefined ? '' : `#${need.link.action.part}`}`;
    return `${need.text} -> ${to}`;
  };
  // A wallet and coins are what "Hold some" gives: until it is done, a step that lacks either leads there.
  assert.equal(link('pass-it-on', 1, 'no-wallet'), 'need_no-wallet -> step hold-some');
  assert.equal(link('pass-it-on', 1, 'no-coins'), 'need_no-coins -> step hold-some');
  assert.equal(link('prove-the-backup', 1, 'no-wallet'), 'need_no-wallet -> step hold-some');
  assert.equal(link('prove-the-backup', 1, 'no-coins'), 'need_no-coins -> step hold-some');
  // Once it is done the reader has been through it, and goes straight to the screen that helps.
  const held = note({ 'hold-some': { started: true, doneAt: NOW, parts: { 1: true, 2: true, 3: true, 4: true } } });
  assert.equal(link('pass-it-on', 1, 'no-wallet', held), 'need_no-wallet -> home');
  assert.equal(link('pass-it-on', 1, 'no-coins', held), 'need_no-coins -> receive#faucet');
  // "Hold some" does not send the reader to itself.
  assert.equal(link('hold-some', 3, 'no-coins'), 'need_no-coins -> receive#faucet');
  // Coins that wait for their block need nothing but the block.
  assert.equal(link('pass-it-on', 1, 'not-spendable-yet'), 'need_not-spendable-yet -> no link');
  // "There are no balances" needs a payment this wallet has sent: "Pass it on" makes one.
  for (const part of [1, 2, 3]) assert.equal(link('no-balances', part, 'nothing-sent'), 'needSentOnce -> step pass-it-on');
  const passed = note({ 'pass-it-on': { started: true, doneAt: NOW, parts: { 1: true, 2: true, 3: true } } });
  assert.equal(link('no-balances', 1, 'nothing-sent', passed), 'needSentOnce -> send');
  // After "Send another" the step waits for a new payment, sent from Send.
  assert.equal(link('pass-it-on', 3, 'nothing-sent'), 'need_nothing-sent -> send');
  assert.equal(link('waiting-room', 2, 'nothing-sent'), 'need_nothing-sent -> send');
  // The drill.
  assert.equal(link('prove-the-backup', 2, 'no-wallet'), 'needRemovedElsewhere -> home');
  assert.equal(link('prove-the-backup', 2, 'another-wallet'), 'needNotChecked -> no link');
  assert.equal(link('prove-the-backup', 3, 'came-back-with-passkey'), 'need_came-back-with-passkey -> settings');
  assert.equal(link('prove-the-backup', 3, 'another-wallet'), 'need_another-wallet -> settings');
  assert.equal(needOf('prove-the-backup', 3, 'another-wallet', none, 'yes').more, 'needAnotherWays');
  assert.equal(link('prove-the-backup', 4, 'no-coins'), 'needCoinsAgain -> receive#faucet');
  // Where nothing can be written: the browser refuses, or the page is out of date.
  assert.equal(needOf('the-seed', 2, 'storage', none, 'no').text, 'need_storage');
  assert.equal(needOf('the-seed', 2, 'storage', none, 'newer').text, 'needNewer');
});

test('sent to "Hold some" for a wallet, a reader who has one already is told where it comes back: Home', () => {
  const none = note();
  // The main link leads to the step whose first part is "make one". Beside it: open or restore, on Home.
  for (const id of ['pass-it-on', 'no-balances', 'waiting-room', 'the-seed', 'prove-the-backup'] as const) {
    const need = needOf(id, 1, 'no-wallet', none, 'yes');
    assert.deepEqual(need.link, { kind: 'step', step: 'hold-some' }, id);
    assert.deepEqual(need.also, { text: 'needHadOne', action: { label: 'needHadOneLink', route: { name: 'home' } } }, id);
  }
  assert.equal(en.needHadOne, 'If you made one before, open or restore it on the home screen.');
  assert.equal(es.needHadOne, 'Si ya creaste una antes, ábrela o restáurala en la pantalla de inicio.');
  // Once "Hold some" is done the link is Home itself, which says all three: nothing is added.
  const held = note({ 'hold-some': { started: true, doneAt: NOW, parts: { 1: true, 2: true, 3: true, 4: true } } });
  const direct = needOf('pass-it-on', 1, 'no-wallet', held, 'yes');
  assert.deepEqual(direct.link, { kind: 'screen', action: { label: 'actHome', route: { name: 'home' } } });
  assert.equal(direct.also, undefined);
  assert.equal(en.actHome, 'Open, restore or create a wallet');
  // No other need has it: the drill's "bring your wallet back first" already leads Home, and coins are not on Home.
  assert.equal(needOf('prove-the-backup', 2, 'no-wallet', none, 'yes').also, undefined);
  assert.equal(needOf('pass-it-on', 1, 'no-coins', none, 'yes').also, undefined);
  assert.equal(needOf('hold-some', 3, 'no-coins', none, 'yes').also, undefined);
});

test('the drill asks for three words off the paper, and names where a reader with no paper copy makes one', () => {
  // "The seed" not done: that step shows the 12 words and has them written down.
  assert.deepEqual(paperHelp('prove-the-backup', 1, note()), { text: 'paperNone', link: { kind: 'step', step: 'the-seed' } });
  assert.deepEqual(paperHelp('prove-the-backup', 1, note({ 'the-seed': started(2) })), { text: 'paperNone', link: { kind: 'step', step: 'the-seed' } });
  // Done (for another wallet, or this part would be ticked): it shows no words any more, and the Backup screen does.
  const done = note({ 'the-seed': { ...started(3), doneAt: NOW, wallet: OTHER_FP } });
  assert.deepEqual(paperHelp('prove-the-backup', 1, done), { text: 'paperNoneHere', link: { kind: 'screen', action: { label: 'actBackup', route: { name: 'backup' } } } });
  // No other part of the drill, and no part of another step: the check of "The seed" comes straight after its own writing down.
  for (const part of [2, 3, 4]) assert.equal(paperHelp('prove-the-backup', part, note()), null);
  assert.equal(paperHelp('the-seed', 3, note()), null);
  assert.equal(paperHelp('hold-some', 1, note()), null);
  for (const lang of LANGS) {
    assert.deepEqual(slotNames(strings.doit[lang].paperNone), ['step'], lang);
    assert.deepEqual(slotNames(strings.doit[lang].paperNoneHere), [], lang);
    assert.deepEqual(slotNames(strings.doit[lang].checkedInSeed), ['step'], lang);
  }
  assert.equal(fill(en.paperNone, { step: en['title_the-seed'] }), 'No paper copy yet? Do "The seed" first: it shows the 12 words and has you write them down.');
});

test('the drill\'s paper check says where it was made, when that was in "The seed"', () => {
  const seed = { ...started(3), doneAt: NOW, wallet: FP };
  // Ticked on arrival, by the check of "The seed" for the same wallet.
  const both = note({ 'the-seed': seed, 'prove-the-backup': started(1, { wallet: FP, was: 'words' }) });
  assert.equal(checkedInSeed('prove-the-backup', 1, both), true);
  assert.equal(fill(en.checkedInSeed, { step: en['title_the-seed'] }), 'Checked in "The seed".');
  assert.equal(fill(es.checkedInSeed, { step: es['title_the-seed'] }), 'Comprobado en "La semilla".');
  // Checked on the drill's own screen, with "The seed" not done, or done for another wallet: nothing to add.
  assert.equal(checkedInSeed('prove-the-backup', 1, note({ 'prove-the-backup': started(1, { wallet: FP, was: 'words' }) })), false);
  assert.equal(checkedInSeed('prove-the-backup', 1, note({ 'the-seed': { ...seed, wallet: OTHER_FP }, 'prove-the-backup': started(1, { wallet: FP, was: 'words' }) })), false);
  assert.equal(checkedInSeed('prove-the-backup', 1, note({ 'the-seed': { ...started(2), wallet: FP }, 'prove-the-backup': started(1, { wallet: FP, was: 'words' }) })), false);
  // Not before the part is ticked, and of no other part or step.
  assert.equal(checkedInSeed('prove-the-backup', 1, note({ 'the-seed': seed, 'prove-the-backup': started() })), false);
  assert.equal(checkedInSeed('prove-the-backup', 2, both), false);
  assert.equal(checkedInSeed('the-seed', 3, both), false);
  // A done drill has let go of the wallet it named: the line goes with it.
  assert.equal(checkedInSeed('prove-the-backup', 1, note({ 'the-seed': seed, 'prove-the-backup': { ...started(4), doneAt: NOW, was: 'words' } })), false);
});

test('"Start this step again" is offered on a step under way, and not while the drill\'s wallet is out of the browser', () => {
  const drill = (count: number) => note({ 'prove-the-backup': started(count, { wallet: FP, was: 'words' }) }, 'prove-the-backup');
  const coins = chain(state([{ tx: 'c1', sats: 50_000 }]));
  // The wallet removed, and nothing here: the note is all that says which wallet has to come back.
  const out = judge('prove-the-backup', noWallet({ note: drill(2) }));
  assert.deepEqual(out.parts.map((part) => part.state), ['ticked', 'ticked', 'now', 'later']);
  assert.equal(canRestart(out, 'yes', 'none'), false);
  // Another wallet here: starting again is one of the two ways on the step names.
  const other = judge('prove-the-backup', world({ record: { ...sampleOther() }, chain: coins, note: drill(2) }));
  assert.deepEqual(other.parts[2], { state: 'blocked', reason: 'another-wallet' });
  assert.equal(canRestart(other, 'yes', 'ready'), true);
  // Before the removal, with or without a wallet here.
  assert.equal(canRestart(judge('prove-the-backup', world({ chain: coins, note: drill(1) })), 'yes', 'ready'), true);
  assert.equal(canRestart(judge('prove-the-backup', noWallet({ note: drill(1) })), 'yes', 'none'), true);
  assert.equal(canRestart(judge('prove-the-backup', noWallet({ note: drill(0) })), 'yes', 'none'), true);
  // A stored wallet that cannot be used is no "wallet out of the browser": the step shows the wallet's own trouble.
  assert.equal(canRestart(out, 'yes', 'unreadable'), true);
  // A storage the page was not let read: it sees no wallet either, and the note still names the one to bring back.
  assert.equal(canRestart(out, 'yes', 'blocked'), false);
  assert.equal(canRestart(judge('prove-the-backup', world({ chain: coins, note: drill(1) })), 'yes', 'blocked'), true, 'before the removal the note names nothing that could be lost');
  // Every other step, wallet or no wallet.
  const waiting = judge('waiting-room', noWallet({ note: note({ 'waiting-room': started(1, { tx: txid('a1'), sentAt: NOW }) }, 'waiting-room') }));
  assert.equal(canRestart(waiting, 'yes', 'none'), true);
  // Never on a step that is not started or is done, and never where nothing can be written.
  assert.equal(canRestart(judge('the-seed', world()), 'yes', 'ready'), false);
  assert.equal(canRestart(judge('the-seed', world({ note: note({ 'the-seed': { ...started(3), doneAt: NOW, wallet: FP } }) })), 'yes', 'ready'), false);
  assert.equal(canRestart(judge('prove-the-backup', world({ chain: coins, note: drill(1) })), 'no', 'ready'), false);
  assert.equal(canRestart(judge('prove-the-backup', world({ chain: coins, note: drill(1) })), 'newer', 'ready'), false);
});

test('the sentences the spec gives for the drill, word for word', () => {
  assert.equal(
    en['need_came-back-with-passkey'],
    'This wallet came back through its passkey. That proves the passkey, not the paper. Remove it once more and choose Restore from the 12 words.',
  );
  assert.equal(
    fillFrom(en['need_another-wallet'], { here: FP, noted: OTHER_FP }),
    `The wallet in this browser (${FP}) is not the one you removed (${OTHER_FP}).`,
  );
  assert.equal(en.wordsUnlockWhy, 'Checking three words needs the keys of this wallet, and your passkey loads them.');
  assert.equal(en.said, 'I wrote the 12 words on paper, in order.');
});

// -- the glossary -----------------------------------------------------------------------------

test('"Hold some" links each new thing it names; no other step links the glossary from its parts', () => {
  assert.deepEqual(termsOf('hold-some', 1), ['wallet', 'seed']);
  assert.deepEqual(termsOf('hold-some', 2), ['address', 'faucet']);
  assert.deepEqual(termsOf('hold-some', 3), ['block']);
  assert.deepEqual(termsOf('hold-some', 4), ['explorer', 'height']);
  for (const id of STEPS) {
    if (id === 'hold-some') continue;
    for (let part = 1; part <= partCount(id); part++) assert.deepEqual(termsOf(id, part), [], `${id} ${part}`);
  }
  // The entries, by the last part of their address, as they were found in the main site's content
  // in English and in Spanish (journey and glossary folders of the content repository).
  const entries = {
    wallet: { en: 'wallet', es: 'billetera' },
    address: { en: 'address', es: 'direccion' },
    seed: { en: 'seed-phrase', es: 'frase-semilla' },
    explorer: { en: 'block-explorer', es: 'explorador-de-bloques' },
    height: { en: 'block-height', es: 'altura-de-bloque' },
    block: { en: 'block', es: 'bloque' },
  } as const;
  for (const [term, slugs] of Object.entries(entries) as [keyof typeof entries, { en: string; es: string }][]) {
    assert.equal(glossaryUrl(SITE, 'en', term), `${SITE}/glossary/${slugs.en}`);
    assert.equal(glossaryUrl(SITE, 'es', term), `${SITE}/es/glosario/${slugs.es}`);
  }
  // The faucet has an English entry only: one address, and the Spanish link says that it is English.
  assert.equal(faucetGlossaryUrl(SITE), `${SITE}/glossary/bitcoin-faucet`);
  assert.equal(en.term_faucet, 'faucet');
  assert.match(es.term_faucet, /\(en inglés\)$/);
});

// -- chapters -----------------------------------------------------------------------------------

test('the pot count is asked for under a done "Pass it on" alone, and only when the Worker\'s settings say that the counts can be had', () => {
  // The settings the page carries built in say no. So nothing is asked before the Worker's own have arrived,
  // and nothing at all when they do not arrive or say no, which is how the Worker ships.
  assert.equal(DEFAULT_CONFIG.potCounts, false);
  for (const id of STEPS) {
    assert.equal(asksPotCount(id, DEFAULT_CONFIG), false, `${id}, built in`);
    assert.equal(asksPotCount(id, { potCounts: false }), false, `${id}, the Worker says no`);
    // The Worker says yes: asked under "Pass it on", and under no other step.
    assert.equal(asksPotCount(id, { potCounts: true }), id === 'pass-it-on', `${id}, the Worker says yes`);
    assert.equal(asksPotCount(id, { ...DEFAULT_CONFIG, potCounts: true }), id === 'pass-it-on', id);
  }
  // Only a plain true is a yes. (loadConfig lets nothing else through; this holds the screen's own line.)
  for (const stray of ['on', 'true', 1, {}, [], null, undefined]) {
    assert.equal(asksPotCount('pass-it-on', { potCounts: stray as unknown as boolean }), false, String(stray));
  }
  // It goes by that one setting: the faucet being open or events being counted do not switch it.
  const allButTheCounts: AppConfig = { ...DEFAULT_CONFIG, turnstileSiteKey: 'a-site-key', events: true };
  assert.equal(asksPotCount('pass-it-on', allButTheCounts), false);

  // The card asks through this and through nothing else: one place calls the wallet for the counts, it is
  // behind this answer, and it runs once.
  const done = readFileSync(new URL('../src/screens/doit/Done.svelte', import.meta.url), 'utf8');
  assert.equal(done.match(/wallet\.potStats\(\)/g)?.length, 1);
  assert.match(done, /let countsWanted = \$derived\(asksPotCount\(id, wallet\.config\)\);/);
  assert.match(done, /\$effect\(\(\) => \{\s*if \(!countsWanted \|\| asked\) return;\s*asked = true;\s*untrack\(\(\) => \{\s*void busyWhile\(wallet\.potStats\(\)\)/);
  assert.doesNotMatch(done, /onMount\(\(\) => \{[^}]*potStats/, 'not asked when the piece is put on the page, whatever the settings say');
  // And no other file of the app asks for them by the wallet.
  const sources = readdirSync(new URL('../src/', import.meta.url), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(svelte|ts)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
  const askers = sources.filter((file) => /wallet\.potStats\(/.test(readFileSync(file, 'utf8'))).map((file) => file.slice(file.indexOf('/src/') + 1));
  assert.deepEqual(askers, ['src/screens/doit/Done.svelte']);
});

test('a chapter\'s heading and its address on the main site, in the page\'s language', () => {
  assert.deepEqual(
    CHAPTERS.map((chapter) => chapterHeading(chapter, 'en')),
    ['Chapter 2: What Bitcoin Actually Is', 'Chapter 3: How Bitcoin Works', 'Chapter 4: Be Your Own Bank'],
  );
  assert.deepEqual(
    CHAPTERS.map((chapter) => chapterHeading(chapter, 'es')),
    ['Capítulo 2: Qué es Bitcoin en realidad', 'Capítulo 3: Cómo funciona Bitcoin', 'Capítulo 4: Sé tu propio banco'],
  );
  const [two] = CHAPTERS;
  assert.ok(two);
  assert.equal(chapterUrl(SITE, two, 'en'), `${SITE}/journey/what-bitcoin-actually-is`);
  assert.equal(chapterUrl(`${SITE}/`, two, 'es'), `${SITE}/es/recorrido/que-es-bitcoin-en-realidad`);
  // No site to build it from: no link, and never a guess.
  assert.equal(chapterUrl('', two, 'en'), null);
  assert.equal(chapterUrl('javascript:alert(1)', two, 'en'), null);
  assert.equal(chapterUrl('not an address', two, 'en'), null);
});

// -- a done step's ways on ------------------------------------------------------------------------

/** A step's own chapter page, in English: the way back a card of that chapter hands a step. */
const cardOf = (id: StepId): string => STEP_DEFS[id].chapter.path.en;

/** A done step's note, with whatever else it holds. */
const doneNote = (id: StepId, extra: StepNote = {}): StepNote => ({ ...started(partCount(id)), doneAt: NOW, ...extra });

test('a done step\'s ways on: back to the step the reader came for, or back to the chapter, and "Next step" only for a reader from the list', () => {
  // The next step of each, where the chapter has one: what a reader from the list is offered.
  assert.deepEqual(
    STEPS.map((id) => nextStep(id)),
    [null, 'no-balances', 'waiting-room', null, 'prove-the-backup', null],
  );
  for (const id of STEPS) {
    // From the wallet's own list (no way back, no step to lead back to): the card as it always was.
    for (const own of [doneNote(id), started(1), { started: true as const }, undefined]) {
      const progress: Progress = { v: 1, following: null, steps: own === undefined ? {} : { [id]: own } };
      assert.deepEqual(waysOn(id, progress), { led: null, next: nextStep(id) }, `${id}, from the list`);
    }
    // Reached by its card, from either of the chapter's two pages: no "Next step". The reader goes back to the chapter.
    for (const from of Object.values(STEP_DEFS[id].chapter.path)) {
      assert.deepEqual(waysOn(id, note({ [id]: doneNote(id, { from }) })), { led: null, next: null }, `${id}, by card from ${from}`);
    }
    // A way back that is none is no card: the note is then as if the reader had come from the list.
    assert.deepEqual(waysOn(id, { v: 1, following: null, steps: { [id]: doneNote(id, { from: '/newsletter' }) } }), { led: null, next: nextStep(id) }, id);

    // In a detour: a need of another step sent the reader here, and that step is not done. The card leads
    // back to it, and offers no "Next step" beside it.
    for (const cameFor of STEPS) {
      if (cameFor === id) continue;
      const sender = started(0, { from: cardOf(cameFor) });
      assert.deepEqual(waysOn(id, note({ [id]: doneNote(id, { cameFor }), [cameFor]: sender })), { led: cameFor, next: null }, `${id} from ${cameFor}`);
      // With a way back of the step's own beside the memory, too: the detour is the later road.
      assert.deepEqual(waysOn(id, note({ [id]: doneNote(id, { from: cardOf(id), cameFor }), [cameFor]: sender })), { led: cameFor, next: null }, `${id} from ${cameFor}, with both`);
      // The step the reader came for is done by now (a note handed in with the stale field: a read never
      // leaves one): the detour is over, and the card is what the step's own way back makes it.
      const over: Progress = { v: 1, following: null, steps: { [id]: doneNote(id, { cameFor }), [cameFor]: doneNote(cameFor, { from: cardOf(cameFor) }) } };
      assert.deepEqual(waysOn(id, over), { led: null, next: nextStep(id) }, `${id} from ${cameFor}, which is done`);
      const overByCard: Progress = { v: 1, following: null, steps: { [id]: doneNote(id, { from: cardOf(id), cameFor }), [cameFor]: doneNote(cameFor) } };
      assert.deepEqual(waysOn(id, overByCard), { led: null, next: null }, `${id} from ${cameFor}, which is done, by card`);
    }
    // A memory that names the step itself, or what is no step, is none.
    for (const cameFor of [id, 'first-payment', '', 7]) {
      const odd = { v: 1, following: null, steps: { [id]: { ...doneNote(id), cameFor } } } as unknown as Progress;
      assert.deepEqual(waysOn(id, odd), { led: null, next: nextStep(id) }, `${id}: ${String(cameFor)}`);
    }
  }
  // For the pairs the app's own needs make, the next step of the step a need leads to is, where it has one,
  // the very step the reader came for: the main button names it, and "Next step" would name it a second time.
  assert.equal(nextStep('pass-it-on'), 'no-balances');
  assert.equal(nextStep('the-seed'), 'prove-the-backup');
  assert.equal(nextStep('hold-some'), null);

  // Walked through the one write function, as the app writes it: "Pass it on" by its card with no wallet,
  // on to "Hold some", which is done; then "Pass it on" itself.
  let progress = applyChange({ v: 1, following: null, steps: {} }, { kind: 'open', step: 'pass-it-on', at: NOW, from: '/journey/how-bitcoin-works' });
  progress = applyChange(progress, { kind: 'detour', step: 'hold-some', cameFor: 'pass-it-on' });
  progress = applyChange(progress, { kind: 'open', step: 'hold-some', at: NOW + 1, from: null });
  for (const part of [1, 2, 3, 4]) progress = applyChange(progress, { kind: 'tick', step: 'hold-some', part, at: NOW + 2 });
  assert.deepEqual(waysOn('hold-some', progress), { led: 'pass-it-on', next: null });
  // The reader presses the button: the opening of "Pass it on" changes nothing on the card they left.
  progress = applyChange(progress, { kind: 'open', step: 'pass-it-on', at: NOW + 3, from: null });
  assert.deepEqual(waysOn('hold-some', progress), { led: 'pass-it-on', next: null });
  for (const part of [1, 2, 3]) progress = applyChange(progress, { kind: 'tick', step: 'pass-it-on', part, at: NOW + 4 });
  // "Pass it on" was reached by its card: no "Next step". And "Hold some", which no card ever led to, is a
  // step from the list again: it leads back to no step, and chapter 2 has no next one to offer.
  assert.deepEqual(waysOn('pass-it-on', progress), { led: null, next: null });
  assert.deepEqual(waysOn('hold-some', progress), { led: null, next: null });
  assert.equal(progress.steps['hold-some']?.cameFor, undefined);
  // The same steps done from the wallet's own list: "Next step" is offered, as before.
  let listed = applyChange({ v: 1, following: null, steps: {} }, { kind: 'open', step: 'pass-it-on', at: NOW, from: null });
  for (const part of [1, 2, 3]) listed = applyChange(listed, { kind: 'tick', step: 'pass-it-on', part, at: NOW + 1 });
  assert.deepEqual(waysOn('pass-it-on', listed), { led: null, next: 'no-balances' });
});

test('the strip offers the link back to the chapter for a step that came from a chapter, and once a step is done', () => {
  for (const id of STEPS) {
    // Under way, opened from the wallet's own list: the one link, "Back to the step", as it always was.
    for (const own of [started(0), started(1)]) assert.equal(stripOffersChapter(note({ [id]: own }, id), id), false, `${id}, from the list`);
    // Under way, reached by its card: the link back, from the start.
    for (const from of Object.values(STEP_DEFS[id].chapter.path)) {
      assert.equal(stripOffersChapter(note({ [id]: started(0, { from }) }, id), id), true, `${id}, by card`);
      assert.equal(stripOffersChapter(note({ [id]: started(1, { from }) }, id), id), true, `${id}, by card`);
    }
    // A way back that is none is no card.
    assert.equal(stripOffersChapter({ v: 1, following: id, followedAt: NOW, steps: { [id]: { started: true, from: '/newsletter' } } }, id), false, id);
    // Done: both links, however the reader came to the step.
    for (const own of [doneNote(id), doneNote(id, { from: cardOf(id) })]) assert.equal(stripOffersChapter(note({ [id]: own }, id), id), true, `${id}, done`);
    // Under way, sent here by a need of another step that is not done: the link back, and it leads to the chapter the reader left.
    for (const cameFor of STEPS) {
      if (cameFor === id) continue;
      const sent = note({ [id]: started(1, { cameFor }), [cameFor]: started(0, { from: cardOf(cameFor) }) }, id);
      assert.equal(stripOffersChapter(sent, id), true, `${id} from ${cameFor}`);
      assert.equal(chapterLink(SITE, id, 'en', sent), `${SITE}${cardOf(cameFor)}#do-${cameFor}`, `${id} from ${cameFor}`);
      // With both a way back of its own and the memory: offered, and the detour decides where it leads.
      const both = note({ [id]: started(1, { from: cardOf(id), cameFor }), [cameFor]: started(0, { from: cardOf(cameFor) }) }, id);
      assert.equal(stripOffersChapter(both, id), true);
      assert.equal(chapterLink(SITE, id, 'en', both), `${SITE}${cardOf(cameFor)}#do-${cameFor}`, `${id} from ${cameFor}, with both`);
      // The step the reader came for is done (a stale field in a note handed in): no detour, so no link for a step from the list.
      const over: Progress = { v: 1, following: id, followedAt: NOW, steps: { [id]: started(1, { cameFor }), [cameFor]: doneNote(cameFor) } };
      assert.equal(stripOffersChapter(over, id), false, `${id} from ${cameFor}, which is done`);
    }
    // A step with no note at all (the strip is never drawn for one): nothing to offer.
    assert.equal(stripOffersChapter({ v: 1, following: null, steps: {} }, id), false);
  }
  // The piece asks that one function, and builds the link from the whole note, as the step's own screen does.
  const piece = readFileSync(new URL('../src/components/doit/Strip.svelte', import.meta.url), 'utf8');
  assert.match(
    piece,
    /let chapter = \$derived\(step !== null && stripOffersChapter\(doit\.progress, step\) \? chapterLink\(wallet\.config\.siteUrl, step, lang, doit\.progress\) : null\);/,
  );
  // The two links share one line that does not break inside itself, and "Back to the step" comes first.
  assert.match(
    piece,
    /<div class="order-3 flex w-full items-center gap-x-4 whitespace-nowrap min-\[480px\]:order-2 min-\[480px\]:w-auto">\s*<a href=\{router\.link\(\{ name: 'step', id: step \}\)\} class=\{BACK\} data-testid="strip-back">\{t\.stripBack\}<\/a>\s*\{#if chapter !== null\}\s*<ChapterLink look="strip" href=\{chapter\} data-testid="strip-chapter">\{t\.back\}<\/ChapterLink>\s*\{\/if\}\s*<\/div>/,
  );
  // The words on the two links, in both languages: on the narrowest phone the two must fit one line.
  assert.deepEqual([en.stripBack, en.back, es.stripBack, es.back], ['Back to the step', 'Back to the chapter', 'Volver al paso', 'Volver al capítulo']);
});

// -- progress kept --------------------------------------------------------------------------------

test('a note counts as kept when one is stored: this version\'s, or a newer one\'s', () => {
  assert.deepEqual(
    (['none', 'kept', 'unreadable', 'newer', 'blocked'] as const).map((read) => progressKept(read)),
    [false, true, false, true, false],
  );
});

// -- a wait that is over ----------------------------------------------------------------------------

test('the one line a part keeps once its block has come', () => {
  assert.equal(waitedText({ height: 150, seconds: 23 }, 'en'), 'It waited 23 seconds. Block 150 took it in.');
  assert.equal(waitedText({ height: 5900, seconds: 1 }, 'en'), 'It waited 1 second. Block 5,900 took it in.');
  assert.equal(waitedText({ height: 5900, seconds: null }, 'en'), 'Block 5,900 took it in.');
  assert.equal(waitedText({ height: 150, seconds: 0 }, 'en'), 'It waited 0 seconds. Block 150 took it in.');
  assert.equal(waitedText({ height: 150, seconds: 23 }, 'es'), 'Esperó 23 segundos. Lo incluyó el bloque 150.');
  assert.equal(waitedText({ height: 150, seconds: 1 }, 'es'), 'Esperó 1 segundo. Lo incluyó el bloque 150.');
  // Which account the line is made from. The note's comes first: it is the one a page load keeps.
  assert.deepEqual(waitedOf({ height: 150, seconds: 23 }, { height: 150, seconds: 25 }), { height: 150, seconds: 23 });
  // A block whose own time cannot say how long the wait was (it lies before the payment): the page
  // saw that block come, and says the seconds by its own clock, on the tick and after it alike.
  assert.deepEqual(waitedOf({ height: 150, seconds: null }, { height: 150, seconds: 11 }), { height: 150, seconds: 11 });
  // What the page remembers of another block says nothing of this one.
  assert.deepEqual(waitedOf({ height: 151, seconds: null }, { height: 150, seconds: 11 }), { height: 151, seconds: null });
  // A done step's note names no payment any more: only the page remembers, until it is loaded again.
  assert.deepEqual(waitedOf(null, { height: 150, seconds: 11 }), { height: 150, seconds: 11 });
  assert.equal(waitedOf(null, null), null);
  assert.deepEqual(waitedOf({ height: 150, seconds: null }, null), { height: 150, seconds: null });
});

// -- the questions ------------------------------------------------------------------------------------

test('three places are picked once for a question and kept until it is answered right', () => {
  const rolls = [0.0, 0.5, 0.99];
  let at = 0;
  const first = positionsFor('test-step', () => rolls[at++ % rolls.length] ?? 0);
  assert.equal(first.length, 3);
  assert.equal(new Set(first).size, 3);
  for (const place of first) assert.ok(Number.isInteger(place) && place >= 0 && place < 12, String(place));
  assert.deepEqual([...first], [...first].sort((a, b) => a - b), 'in rising order');
  // Asked again (after a wrong word, or after the reader left the screen): the same three.
  assert.equal(positionsFor('test-step', () => 0.3), first);
  // Another question has places of its own.
  const again = positionsFor('test-step:again', () => 0.3);
  assert.notEqual(again, first);
  // Answered right: the next opening picks afresh.
  positionsAnswered('test-step');
  const second = positionsFor('test-step', () => 0.3);
  assert.notEqual(second, first);
  assert.deepEqual([...second], [...again]);
  positionsAnswered('test-step');
  positionsAnswered('test-step:again');
});

test('an answer that does not tick gets a sentence that never says the number', () => {
  assert.equal(answerKey('block', 'right'), null);
  assert.equal(answerKey('block', 'wrong'), 'blockWrong');
  assert.equal(answerKey('coins', 'wrong'), 'coinsWrong');
  assert.equal(answerKey('coins', 'total'), 'coinsTotal');
  assert.equal(answerKey('coins', 'empty'), 'answerEmpty');
  assert.equal(answerKey('block', 'period'), 'answerPeriod');
  assert.equal(answerKey('block', 'invalid'), 'answerInvalid');
  assert.equal(answerKey('coins', 'not-now'), 'answerClosed');
  // The total gets the line the spec gives, and any other wrong count says to count the rows.
  assert.equal(en.coinsTotal, 'That is what your coins add up to. The question is how many coins hold it.');
  assert.match(en.coinsWrong, /Count the rows on the Coins screen/);
  // The hint under the field does not say the guidance over again.
  assert.equal(en.coinsHint, 'The number of rows, in digits.');
  for (const lang of LANGS) assert.notEqual(strings.doit[lang].coinsHint, strings.doit[lang]['guide_no-balances_2'], lang);
  // None of them has a slot: nothing of the wallet can be put into them.
  for (const lang of LANGS) {
    for (const key of ['blockWrong', 'coinsWrong', 'coinsTotal', 'answerEmpty', 'answerPeriod', 'answerInvalid', 'answerClosed'] as const) {
      assert.deepEqual(slotNames(strings.doit[lang][key]), [], `${lang}.${key}`);
      assert.doesNotMatch(strings.doit[lang][key], /[0-9]/, `${lang}.${key}`);
    }
  }
});

// -- a sentence with an address in it --------------------------------------------------------------------

test('a sentence is cut at an address or a wallet fingerprint, and reads the same put back together', () => {
  assert.deepEqual(sentenceBits('Plain words.', {}), [{ kind: 'text', text: 'Plain words.' }]);
  assert.deepEqual(sentenceBits('{amount} went to {address}, the address paid.', { amount: '300 practice sats', address: 'bcrt1qexample' }, ['address']), [
    { kind: 'text', text: '300 practice sats went to ' },
    { kind: 'mono', text: 'bcrt1qexample' },
    { kind: 'text', text: ', the address paid.' },
  ]);
  // Two values set apart in one sentence, and a slot at the very start.
  const two = sentenceBits('{here} is not {noted}.', { here: FP, noted: OTHER_FP }, ['here', 'noted']);
  assert.deepEqual(two, [
    { kind: 'mono', text: FP },
    { kind: 'text', text: ' is not ' },
    { kind: 'mono', text: OTHER_FP },
    { kind: 'text', text: '.' },
  ]);
  assert.equal(bitsText(two), `${FP} is not ${OTHER_FP}.`);
  // A value is put in as it is: braces inside it are not read again.
  assert.deepEqual(sentenceBits('{a}', { a: '{b}' }, ['a']), [{ kind: 'mono', text: '{b}' }]);
  assert.equal(bitsText(sentenceBits('{a} and {b}', { a: '{b}', b: 'x' })), '{b} and x');
  // The screen and its text have drifted apart.
  assert.throws(() => sentenceBits('with {address}', {}), /no value for \{address\}/);
  assert.throws(() => sentenceBits('no slot', { address: 'x' }), /has no \{address\}/);
});

// -- the strip ----------------------------------------------------------------------------------------------

/** judge() on a world, for the strip. */
function viewOf(id: StepId, spec: Parameters<typeof world>[0]): StepView {
  return judge(id, world(spec));
}

test('the strip names the part, or what stands in its way', () => {
  const coins = chain(state([{ tx: 'c1', sats: 50_000 }]));
  const listed = [tx({ tx: 'a1' }), tx({ tx: 'c1', direction: 'received' })];
  // The reader can do the part: its name.
  const part = stripView(viewOf('no-balances', { chain: coins, history: listed, note: note({ 'no-balances': started(1) }, 'no-balances') }));
  assert.deepEqual(part, { step: 'no-balances', part: 2, parts: 3, says: { kind: 'part' } });
  assert.equal(stripText(part, 'en', NOW), 'Count your coins');
  assert.deepEqual(stripCount(part, 'en'), { long: 'part 2 of 3', short: '2 of 3' });
  assert.deepEqual(stripCount(part, 'es'), { long: 'parte 2 de 3', short: '2 de 3' });
  assert.equal(stepTitle('no-balances', 'en'), 'There are no balances');
  assert.equal(stepTitle('no-balances', 'es'), 'No hay saldos');
  // Something is missing first.
  const need = stripView(viewOf('pass-it-on', { note: note({ 'pass-it-on': started() }, 'pass-it-on') }));
  assert.deepEqual(need.says, { kind: 'need', reason: 'no-coins' });
  assert.equal(stripText(need, 'en', NOW), 'first: get practice coins');
  assert.equal(stripText(need, 'es', NOW), 'primero: pide monedas de práctica');
  // The coins are being looked up, and the look failed.
  const looking = stripView(viewOf('pass-it-on', { chain: chain(null), note: note({ 'pass-it-on': started() }, 'pass-it-on') }));
  assert.equal(stripText(looking, 'en', NOW), 'looking up your coins...');
  const failed = stripView(viewOf('pass-it-on', { chain: chain(null, { error: 'network', scanning: false }), note: note({ 'pass-it-on': started() }, 'pass-it-on') }));
  assert.deepEqual(failed.says, { kind: 'failed' });
  assert.equal(stripText(failed, 'en', NOW), 'your coins could not be looked up');
  // The list of transactions is not read on the screen the strip stands on: only the part's name is known.
  const unread = stripView(viewOf('no-balances', { chain: coins, history: null, note: note({ 'no-balances': started(1) }, 'no-balances') }));
  assert.deepEqual(unread.says, { kind: 'part' });
  assert.equal(stripText(unread, 'en', NOW), 'Count your coins');
});

test('a need that is read off the list of transactions is said only where the screen keeps that list read: elsewhere the strip names the part', () => {
  /** A wallet screen that keeps the coins read and not the list of transactions: Receive, Send, Coins, Backup, Settings. */
  const elsewhere = { coins: true, list: false };
  const confirmed = chain(state([{ tx: 'c1', sats: 100_000 }]));

  // "Hold some", part 4, on Receive. The faucet's coin has its block, so part 3 is ticked. The list of
  // transactions the page holds was read on the step's own screen, before the coin came: it holds no payment.
  const behind = viewOf('hold-some', { chain: confirmed, history: [], note: note({ 'hold-some': started(3) }, 'hold-some') });
  assert.deepEqual(behind.parts[3], { state: 'blocked', reason: 'no-coins' }, 'what judge() reads off such a list');
  // The strip must not say "first: get practice coins" over a coin that is confirmed: it names the part.
  const onReceive = stripView(behind, elsewhere);
  assert.deepEqual(onReceive, { step: 'hold-some', part: 4, parts: 4, says: { kind: 'part' } });
  assert.equal(stripText(onReceive, 'en', NOW), 'See it from outside');
  assert.equal(stripText(onReceive, 'es', NOW), es['part_hold-some_4']);
  assert.equal(stripSpeaks(onReceive), false, 'on a phone the strip keeps "4 of 4": it has no need to say');
  assert.deepEqual(stripView(behind, { coins: false, list: false }).says, { kind: 'part' });
  // On a screen that keeps the list read, the answer is that list's own, and it is said.
  assert.deepEqual(stripView(behind, { coins: true, list: true }).says, { kind: 'need', reason: 'no-coins' });
  assert.deepEqual(stripView(behind).says, { kind: 'need', reason: 'no-coins' });
  assert.equal(stripText(stripView(behind), 'en', NOW), 'first: get practice coins');

  // "There are no balances": each of its parts rests on a payment the wallet has sent, read off the list. On
  // Send, where the payment goes out and the list is not read, the strip names the part.
  for (const part of [1, 2, 3]) {
    const unsent = viewOf('no-balances', {
      chain: confirmed,
      history: [tx({ tx: 'c1', direction: 'received' })],
      note: note({ 'no-balances': started(part - 1) }, 'no-balances'),
    });
    assert.deepEqual(unsent.parts[part - 1], { state: 'blocked', reason: 'nothing-sent' }, `part ${part}`);
    assert.deepEqual(stripView(unsent, elsewhere), { step: 'no-balances', part, parts: 3, says: { kind: 'part' } }, `part ${part}`);
    assert.deepEqual(stripView(unsent).says, { kind: 'need', reason: 'nothing-sent' }, `part ${part}`);
  }

  // A need that is read off the coins, off the note or off the browser's storage is said on every screen, as before.
  const said = (id: StepId, spec: Parameters<typeof world>[0], reason: BlockedReason): void => {
    const view = viewOf(id, spec);
    assert.equal(view.at !== null && view.parts[view.at - 1]?.state, 'blocked', `${id}: ${reason}`);
    for (const live of [elsewhere, { coins: false, list: false }, { coins: true, list: true }]) {
      assert.deepEqual(stripView(view, live).says, { kind: 'need', reason }, `${id}: ${reason}`);
    }
  };
  // No coin at all, and a coin that waits for its block: the wallet's coins say so.
  said('pass-it-on', { note: note({ 'pass-it-on': started() }, 'pass-it-on') }, 'no-coins');
  said('hold-some', { note: note({ 'hold-some': started(2) }, 'hold-some') }, 'no-coins');
  said('waiting-room', { chain: chain(state([{ tx: 'c1', sats: 100_000, height: null }])), note: note({ 'waiting-room': started() }, 'waiting-room') }, 'not-spendable-yet');
  // The coins of "There are no balances" are spent: the list holds the payment, and the coins say that none is left.
  said('no-balances', { chain: chain(state()), history: [tx({ tx: 'a1' })], note: note({ 'no-balances': started() }, 'no-balances') }, 'no-coins');
  // After "Send another" the note names no payment: the note says so.
  said('waiting-room', { chain: confirmed, history: [], note: note({ 'waiting-room': started(1) }, 'waiting-room') }, 'nothing-sent');
  // No wallet in the browser.
  assert.deepEqual(stripView(judge('hold-some', noWallet({ note: note({ 'hold-some': started(3) }, 'hold-some') })), elsewhere).says, { kind: 'need', reason: 'no-wallet' });

  // The piece hands the strip what the screen it stands on keeps read.
  const piece = readFileSync(new URL('../src/components/doit/Strip.svelte', import.meta.url), 'utf8');
  assert.match(piece, /let live = \$derived\(\{ coins: readsCoins\(watched\), list: readsTransactions\(watched\) \}\);/);
  assert.match(piece, /let strip = \$derived\(step === null \? null : stripView\(doit\.view\(step, now\), live\)\);/);
});

test('the strip says how long a payment has waited, that it is lost, and that the step is done', () => {
  const coins = chain(state([{ tx: 'c1', sats: 50_000 }]));
  const waiting = note({ 'pass-it-on': started(2, { tx: txid('a1'), sentAt: NOW - 12_000 }) }, 'pass-it-on');
  const sent = stripView(viewOf('pass-it-on', { chain: coins, history: [tx({ tx: 'a1', height: null })], note: waiting }));
  assert.deepEqual(sent.says, { kind: 'waiting', sentAt: NOW - 12_000 });
  assert.equal(stripText(sent, 'en', NOW), 'waiting for a block, sent 12 seconds ago');
  assert.equal(stripText(sent, 'es', NOW), 'esperando un bloque, se envió hace 12 segundos');
  // A clock that is behind the note never counts backwards.
  assert.equal(stripText(sent, 'en', NOW - 60_000), 'waiting for a block, sent just now');
  // A coin that waits for its first block has no moment of sending to count from.
  const coin = stripView(viewOf('hold-some', { chain: chain(state([{ tx: 'c1', sats: 50_000, height: null }])), note: note({ 'hold-some': started(2) }, 'hold-some') }));
  assert.deepEqual(coin.says, { kind: 'waiting', sentAt: null });
  assert.equal(stripText(coin, 'en', NOW), 'waiting for a block');
  // Two minutes on, a list that still lacks the payment.
  const lost = stripView(viewOf('pass-it-on', { chain: coins, history: [], note: note({ 'pass-it-on': started(2, { tx: txid('a1'), sentAt: NOW - 200_000 }) }, 'pass-it-on') }));
  assert.equal(stripText(lost, 'en', NOW), 'the network does not know the payment');
  // The wait is said only where it is still being read. A payment's wait is read from the list of
  // transactions: on a screen that does not read the list, the strip names the part and counts nothing.
  const elsewhere = stripView(viewOf('pass-it-on', { chain: coins, history: [tx({ tx: 'a1', height: null })], note: waiting }), { coins: true, list: false });
  assert.deepEqual(elsewhere.says, { kind: 'part' });
  assert.equal(stripText(elsewhere, 'en', NOW), 'It gets its first confirmation');
  // A coin's wait is read from the coins, which every wallet screen reads: there it is said, list or no list.
  const coinView = viewOf('hold-some', { chain: chain(state([{ tx: 'c1', sats: 50_000, height: null }])), note: note({ 'hold-some': started(2) }, 'hold-some') });
  assert.deepEqual(stripView(coinView, { coins: true, list: false }).says, { kind: 'waiting', sentAt: null });
  // On a screen that reads nothing (Home, About, the list of steps), neither wait is said.
  assert.deepEqual(stripView(coinView, { coins: false, list: false }).says, { kind: 'part' });
  assert.equal(stripText(stripView(coinView, { coins: false, list: false }), 'en', NOW), 'See them confirm');
  // That the network does not know a payment was true when it was read, and stays said.
  const lostView = viewOf('pass-it-on', { chain: coins, history: [], note: note({ 'pass-it-on': started(2, { tx: txid('a1'), sentAt: NOW - 200_000 }) }, 'pass-it-on') });
  assert.deepEqual(stripView(lostView, { coins: false, list: false }).says, { kind: 'lost' });
  // In a block and counting its six: the part's own name says what goes on.
  const counting = stripView(
    viewOf('waiting-room', { chain: coins, history: [tx({ tx: 'a1', height: 198 })], note: note({ 'waiting-room': started(2, { tx: txid('a1'), sentAt: NOW - 90_000 }) }, 'waiting-room') }),
  );
  assert.deepEqual(counting, { step: 'waiting-room', part: 3, parts: 3, says: { kind: 'part' } });
  assert.equal(stripText(counting, 'en', NOW), 'Six blocks on top');
  // Done.
  const done = stripView(viewOf('pass-it-on', { note: note({ 'pass-it-on': { started: true, doneAt: NOW, parts: { 1: true, 2: true, 3: true } } }, 'pass-it-on') }));
  assert.deepEqual(done, { step: 'pass-it-on', part: null, parts: 3, says: { kind: 'done' } });
  assert.equal(stripText(done, 'en', NOW), '"Pass it on" is done');
  assert.equal(stripText(done, 'es', NOW), '"Pásala": hecho');
  assert.deepEqual(stripCount(done, 'en'), { long: '', short: '' });
});

test('on a narrow screen the strip gives the room of "2 of 3" to its words where the reader has to know them', () => {
  const coins = chain(state([{ tx: 'c1', sats: 50_000 }]));
  const speaks = (id: StepId, spec: Parameters<typeof world>[0], live?: Parameters<typeof stripView>[1]): boolean => stripSpeaks(stripView(viewOf(id, spec), live));
  // The reader can simply go on: the step and how far it is.
  assert.equal(speaks('no-balances', { chain: coins, history: [tx({ tx: 'a1' }), tx({ tx: 'c1', direction: 'received' })], note: note({ 'no-balances': started(1) }, 'no-balances') }), false);
  // Something is missing first.
  assert.equal(speaks('pass-it-on', { note: note({ 'pass-it-on': started() }, 'pass-it-on') }), true);
  // The part waits for a block, where the wait is read; elsewhere the strip names the part, and the narrow form keeps the count.
  const waiting = { chain: coins, history: [tx({ tx: 'a1', height: null })], note: note({ 'pass-it-on': started(2, { tx: txid('a1'), sentAt: NOW - 12_000 }) }, 'pass-it-on') };
  assert.equal(speaks('pass-it-on', waiting), true);
  assert.equal(speaks('pass-it-on', waiting, { coins: true, list: false }), false);
  // The network has lost the payment.
  assert.equal(speaks('pass-it-on', { chain: coins, history: [], note: note({ 'pass-it-on': started(2, { tx: txid('a1'), sentAt: NOW - 200_000 }) }, 'pass-it-on') }), true);
  // The coins are still being looked up, or could not be: the wallet's own screen says that under the strip.
  assert.equal(speaks('pass-it-on', { chain: chain(null), note: note({ 'pass-it-on': started() }, 'pass-it-on') }), false);
  assert.equal(speaks('pass-it-on', { chain: chain(null, { error: 'network', scanning: false }), note: note({ 'pass-it-on': started() }, 'pass-it-on') }), false);
  // The drill, with the wallet removed: the reader is on Home, whose main button makes a new wallet.
  // The strip is all that says "restore", so it says the part's name on a phone too.
  const removed = stripView(judge('prove-the-backup', noWallet({ note: note({ 'prove-the-backup': started(2, { wallet: FP, was: 'words' }) }, 'prove-the-backup') })));
  assert.deepEqual(removed, { step: 'prove-the-backup', part: 3, parts: 4, says: { kind: 'part' } });
  assert.equal(stripSpeaks(removed), true);
  assert.equal(stripText(removed, 'en', NOW), 'Restore it from the 12 words');
  // Back through its passkey, and with another wallet: both are needs, and said.
  const passkey = stripView(judge('prove-the-backup', world({ record: record('passkey'), unlocked: false, chain: coins, note: note({ 'prove-the-backup': started(2, { wallet: FP, was: 'passkey' }) }, 'prove-the-backup') })));
  assert.deepEqual(passkey.says, { kind: 'need', reason: 'came-back-with-passkey' });
  assert.equal(stripSpeaks(passkey), true);
  // No other part of the drill, and a done step says "done" in both forms anyway.
  assert.equal(stripSpeaks(stripView(judge('prove-the-backup', world({ chain: coins, note: note({ 'prove-the-backup': started(1, { wallet: FP, was: 'words' }) }, 'prove-the-backup') })))), false);
  assert.equal(stripSpeaks({ step: 'pass-it-on', part: null, parts: 3, says: { kind: 'done' } }), false);
  // The piece draws the words in the place of the count, in the narrow form only.
  const piece = readFileSync(new URL('../src/components/doit/Strip.svelte', import.meta.url), 'utf8');
  assert.match(piece, /<span class="min-\[480px\]:hidden" data-testid="strip-short">\{speaks \? says : count\.short\}<\/span>/);
  assert.match(piece, /let speaks = \$derived\(strip !== null && stripSpeaks\(strip\)\);/);
});

test('"done" is said of a done step and of no other: a step the note follows and never started gets no strip at all', () => {
  // A note edited by hand: it follows a step whose screen was never opened.
  const never = stripView(judge('hold-some', world({ note: { v: 1, following: 'hold-some', followedAt: NOW, steps: {} } })));
  assert.deepEqual(never, { step: 'hold-some', part: null, parts: 4, says: { kind: 'part' } });
  assert.equal(stripShows(never), false);
  assert.equal(stripText(never, 'en', NOW), '');
  // A step under way, and one that is done, are shown.
  assert.equal(stripShows(stripView(viewOf('pass-it-on', { note: note({ 'pass-it-on': started() }, 'pass-it-on') }))), true);
  const done = stripView(viewOf('pass-it-on', { note: note({ 'pass-it-on': { started: true, doneAt: NOW, parts: { 1: true, 2: true, 3: true } } }, 'pass-it-on') }));
  assert.deepEqual(done.says, { kind: 'done' });
  assert.equal(stripShows(done), true);
  const piece = readFileSync(new URL('../src/components/doit/Strip.svelte', import.meta.url), 'utf8');
  assert.match(piece, /\{#if strip !== null && step !== null && stripShows\(strip\)\}/);
});

test('every reason a part can be blocked for has its words in the strip, in both languages', () => {
  // Written as an object, so that the compiler refuses a reason that is missing here.
  const all: Record<BlockedReason, true> = {
    'no-wallet': true,
    'no-coins': true,
    'not-spendable-yet': true,
    'nothing-sent': true,
    'came-back-with-passkey': true,
    'another-wallet': true,
    storage: true,
    trouble: true,
    broken: true,
    unread: true,
  };
  const reasons = Object.keys(all) as BlockedReason[];
  assert.equal(reasons.length, 10);
  for (const lang of LANGS) {
    const said = reasons.map((reason) => stripText({ step: 'hold-some', part: 1, parts: 4, says: { kind: 'need', reason } }, lang, NOW));
    assert.equal(new Set(said).size, reasons.length, lang);
    for (const text of said) assert.ok(text.length > 8, `${lang}: ${text}`);
  }
  // The world gives the reasons the list above names: a wallet that is not here.
  const none = stripView(judge('the-seed', noWallet({ note: note({ 'the-seed': started() }, 'the-seed') })));
  assert.deepEqual(none.says, { kind: 'need', reason: 'no-wallet' });
});

test('the strip says "the stored wallet" only of a wallet that is stored: a failed self-test and a storage nobody could read have words of their own', () => {
  const said = (status: 'unreadable' | 'newer' | 'broken' | 'blocked' | 'none', id: StepId = 'hold-some'): { reason: string; en: string; es: string; speaks: boolean } => {
    // The step is followed and under way, as it has to be for a strip to show at all.
    const strip = stripView(judge(id, world({ status, record: null, note: note({ [id]: started() }, id) })));
    assert.equal(strip.says.kind, 'need', status);
    return {
      reason: strip.says.kind === 'need' ? strip.says.reason : '',
      en: stripText(strip, 'en', NOW),
      es: stripText(strip, 'es', NOW),
      speaks: stripSpeaks(strip),
    };
  };
  // Something is stored for the wallet, and it cannot be read or is a newer version's: "the stored wallet".
  for (const status of ['unreadable', 'newer'] as const) {
    assert.deepEqual(said(status), { reason: 'trouble', en: 'the stored wallet cannot be used', es: 'la billetera guardada no se puede usar', speaks: true }, status);
  }
  // The self-test failed. In that browser the page reads no wallet and none can have been made (session.ts),
  // and About says so on the same screen: so the strip must not say that one is stored.
  for (const id of STEPS) {
    const broken = said('broken', id);
    assert.deepEqual(broken, { reason: 'broken', en: 'the wallet cannot run in this browser', es: 'la billetera no funciona en este navegador', speaks: true }, id);
    assert.doesNotMatch(`${broken.en} ${broken.es}`, /stored|guardada/, id);
  }
  // The browser did not let the page read its storage: whether a wallet is here is not known. Neither "the
  // stored wallet" (the page saw none) nor "first: a practice wallet" (one may be stored).
  for (const id of STEPS) {
    const unread = said('blocked', id);
    assert.deepEqual(unread, { reason: 'unread', en: 'this page could not look for a wallet here', es: 'esta página no pudo buscar una billetera aquí', speaks: true }, id);
    assert.doesNotMatch(`${unread.en} ${unread.es}`, /stored wallet|billetera guardada|first:|primero:/, id);
  }
  // And a storage that was read and holds no wallet is still said as that.
  assert.deepEqual(said('none', 'pass-it-on'), { reason: 'no-wallet', en: 'first: a practice wallet', es: 'primero: una billetera de práctica', speaks: true });
  // The words in the table, and the reason each is drawn for.
  assert.equal(en.stripNeed_trouble, 'the stored wallet cannot be used');
  assert.equal(en.stripNeed_broken, 'the wallet cannot run in this browser');
  assert.equal(es.stripNeed_broken, 'la billetera no funciona en este navegador');
  assert.equal(en.stripNeed_unread, 'this page could not look for a wallet here');
  assert.equal(es.stripNeed_unread, 'esta página no pudo buscar una billetera aquí');
});

// -- "What just happened", from keys to sentences ----------------------------------------------------------------

/** A transaction of the sample history, by its ID. */
function listed(id: string): TxView {
  const found = sampleHistory(NOW).find((each) => each.txid === id);
  assert.ok(found, id);
  return found;
}

test('a payment this wallet sent, read out in the order the spec gives: spent, went where, the change, the fee', () => {
  const said = explained(listed(TXID.sent), 'en');
  assert.deepEqual(
    said.map((each) => each.key),
    ['explain_spentOne', 'explain_paid', 'explain_change', 'explain_fee', 'explain_inBlock'],
  );
  const texts = said.map((each) => bitsText(sentenceBits(each.text, each.slots, ADDRESS_SLOTS)));
  assert.equal(texts[0], 'One coin of this wallet was spent. It held 48,782 practice sats, and a coin is always spent whole.');
  assert.equal(texts[1], `30,000 practice sats went to ${POT_ADDRESS}, the address that was paid.`);
  assert.match(texts[2] ?? '', /^18,500 practice sats came back as change, to bcrt1q[a-z0-9]+, a fresh address of this wallet\. The change is a new coin\.$/);
  // The fee as the chapter gives it, with the figures, and then as a rate that multiplies out.
  assert.equal(
    texts[3],
    'The fee is what went in less what came out: 48,782 less 48,500 leaves 282 practice sats. Spread over the 141 vB of the transaction, that is 2 sat/vB.',
  );
  assert.equal(48_782 - 48_500, 282);
  assert.equal(2 * 141, 282);
  assert.match(texts[4] ?? '', /^Block 5,900 took it in\.$/);
  // The words a newcomer meets, each once, in the order they come up.
  assert.deepEqual(explainedTerms(listed(TXID.sent)), ['utxo', 'change', 'fee', 'block']);
  // The address is cut out of its sentence, to be drawn apart.
  const paid = said[1];
  assert.ok(paid);
  assert.deepEqual(
    sentenceBits(paid.text, paid.slots, ADDRESS_SLOTS).map((bit) => bit.kind),
    ['text', 'mono', 'text'],
  );
});

test('a transaction this wallet only received never says "there was no change": the other output is someone else\'s', () => {
  const view = listed(TXID.faucet);
  const texts = explained(view, 'en').map((each) => bitsText(sentenceBits(each.text, each.slots, ADDRESS_SLOTS)));
  assert.equal(texts[0], "The one coin spent was not this wallet's. It held 5,000,000 practice sats.");
  assert.match(texts[1] ?? '', /^100,000 practice sats came to this wallet, at its address bcrt1q[a-z0-9]+\.$/);
  assert.equal(
    texts[2],
    "4,899,718 practice sats went to an address that is not this wallet's, most likely the sender's own change. A wallet knows its own change and can only guess at someone else's.",
  );
  assert.match(texts[3] ?? '', /^The sender paid the fee, which is what went in less what came out: 5,000,000 less 4,999,718 leaves 282 practice sats\./);
  for (const text of texts) assert.doesNotMatch(text, /no change/i);
  // The Spanish says the same, with the site's words.
  const spanish = explained(view, 'es').map((each) => bitsText(sentenceBits(each.text, each.slots, ADDRESS_SLOTS)));
  assert.equal(spanish[0], 'La única moneda que se gastó no era de esta billetera. Tenía 5,000,000 sats de práctica.');
  assert.match(spanish[3] ?? '', /5,000,000 menos 4,999,718 deja 282 sats de práctica\./);
  // An unconfirmed one waits in the waiting room.
  const waiting = explained(listed(TXID.arriving), 'en').at(-1);
  assert.equal(waiting?.text, 'It is not in a block yet. It waits in the waiting room, the mempool, for a block to take it in.');
  assert.deepEqual(explainedTerms(listed(TXID.arriving)), ['utxo', 'change', 'fee', 'mempool']);
});

test('a fee rate that is not a whole number is said with "about", and never as a product that does not multiply out', () => {
  // A real payment of the sample wallet from two coins: the planner prices it one unit above the signed size.
  const funds = fundedState();
  const view = viewPayment(signPayment(ACCOUNT.key, funds, { to: POT_ADDRESS, amount: 110_000n, feeRate: 3n }), ownAddresses(funds));
  const fee = explain(view).find((sentence) => sentence.key.startsWith('explain_fee'));
  assert.ok(fee);
  const { fee: paid, size, rate } = fee.slots;
  assert.ok(paid !== undefined && size !== undefined && rate !== undefined);
  // 627 sats for 208 vB: no whole number of sats per vB gives that.
  assert.deepEqual([paid, size], [627n, 208]);
  assert.notEqual(paid % BigInt(size), 0n);
  assert.equal(fee.key, 'explain_feeAbout');
  const slots = explainSlots(fee, 'en');
  assert.equal(
    fill(en[fee.key], slots),
    'The fee is what went in less what came out: 154,321 less 153,694 leaves 627 practice sats. Spread over the 208 vB of the transaction, that is about 3.01 sat/vB.',
  );
  assert.equal(154_321 - 153_694, 627);
  // What is shown is the rate to two places, and no sentence claims that it multiplies back.
  assert.equal(slots.rate, '3.01');
  assert.notEqual(3.01 * 208, 627);
  for (const lang of LANGS) assert.doesNotMatch(strings.doit[lang].explain_feeAbout, / x | times | por /, lang);
  // A whole rate is said without "about", and multiplies out.
  const one = explain(listed(TXID.sent)).find((sentence) => sentence.key === 'explain_fee');
  assert.ok(one);
  assert.equal(BigInt(explainSlots(one, 'en').rate ?? '0') * BigInt(one.slots.size ?? 0), one.slots.fee);
  // Every sentence there is takes exactly the slots explain() gives it, written as text.
  for (const sentence of explain(view)) {
    assert.deepEqual(Object.keys(explainSlots(sentence, 'es')).sort(), [...EXPLAIN_SLOTS[sentence.key]].sort(), sentence.key);
  }
});

test('nothing is said of a transaction that does not touch this wallet', () => {
  const other: TxView = { ...listed(TXID.faucet), direction: 'other' };
  assert.deepEqual(explained(other, 'en'), []);
  assert.deepEqual(explainedTerms(other), []);
});

test('the part a step is at is one of its own', () => {
  // A guard for the helpers above: a part number past the step's last has no fact, no action and no question.
  assert.equal(partDef('hold-some', 5), undefined);
  assert.equal(actionOf('hold-some', 5, NOW_PART), null);
  assert.equal(askOf('hold-some', 5), null);
  assert.equal(proofOf('hold-some', 5), 'checked');
});
