// The words of the "Do it" steps (src/strings/doit.ts) and what the screens
// do with them, held to the rules a program can check:
//
//   - every key the code builds from a step, a part or a reason is in the
//     table, and every key of the table is on a screen;
//   - the sentences the spec gives word for word are there;
//   - the text is short, facts are slots, and the house words are kept;
//   - the sentences other screens gain say what the spec asks of them, and
//     stand where it asks;
//   - About lists the note field by field, and the note still has exactly
//     those fields;
//   - every test hook of the spec is in the markup, on a piece of these screens;
//   - the three word fields are fields for seed words, and nothing in these
//     screens reads the browser's storage or the network by itself.
//
// (strings.test.ts holds this table, like every other, to the same keys and
// slots in both languages, plain characters and no exclamation marks.)

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { EVENTS, LANGS, STEPS, eventPaths, type StepId } from '@learnbitcoin/practice-contract';
import { DEFAULT_CONFIG } from '../src/lib/config.ts';
import { answered, rechecked } from '../src/lib/doit/advance.ts';
import { EXPLAIN_SLOTS, EXPLAIN_TERMS } from '../src/lib/doit/explain.ts';
import { SIX_BLOCKS, answerBlock, isWalletTrouble, judge, seedWallet, verdictOf, type BlockedReason, type World } from '../src/lib/doit/judge.ts';
import { PROGRESS_KEY, applyChange, emptyProgress, forgetProgress, parseProgress, readProgress, type Progress } from '../src/lib/doit/progress.ts';
import { STEP_DEFS, partCount, partKey } from '../src/lib/doit/steps.ts';
import { slotNames } from '../src/lib/format.ts';
import { RECORD_KEY } from '../src/lib/keystore.ts';
import { doneKey, proofOf } from '../src/screens/doit/view.ts';
import { KEPT_KEYS, keptNowLines, notKnown, noteNow, type KeptNow } from '../src/screens/info/facts.ts';
import { strings } from '../src/strings/index.ts';
import { FP, NOW, OTHER_FP, chain, noWallet, record, state, tx, txid, world } from './doit-worlds.ts';
import { MemoryStorage } from './engine-fakes.ts';

type Table = Readonly<Record<string, string>>;
type Lang = (typeof LANGS)[number];

const en: Table = strings.doit.en;
const es: Table = strings.doit.es;

/** Every text of the table: where it is, and what it says. */
function everyText(): { where: string; lang: Lang; key: string; text: string }[] {
  return LANGS.flatMap((lang) => Object.entries(strings.doit[lang] as Table).map(([key, text]) => ({ where: `doit.${lang}.${key}`, lang, key, text })));
}

/** A file of the app, as text. `path` is read from the app's folder. */
function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

/** A file's text without its comment lines, which may name anything. */
function code(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line))
    .join('\n');
}

/** Every file of a folder of the app (not its sub-folders), by name. */
function folder(path: string): { name: string; text: string }[] {
  const root = new URL(`../${path}/`, import.meta.url);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: `${path}/${entry.name}`, text: readFileSync(new URL(entry.name, root), 'utf8') }));
}

/** The pieces that make up the "Do it" screens: the two screens, their own pieces, and the shell's. */
function doitSources(): { name: string; text: string }[] {
  return [
    { name: 'src/screens/Do.svelte', text: source('src/screens/Do.svelte') },
    { name: 'src/screens/Step.svelte', text: source('src/screens/Step.svelte') },
    ...folder('src/screens/doit'),
    ...folder('src/components/doit'),
    { name: 'src/screens/read/Explained.svelte', text: source('src/screens/read/Explained.svelte') },
    { name: 'src/screens/read/explained.ts', text: source('src/screens/read/explained.ts') },
  ];
}

/**
 * The screens outside the steps' own folders that ask the steps something. Four gained a sentence or a line
 * about the note that is kept. Three lead a reader who is following a step back to it: "Wallet made" by its
 * button, the faucet's card by its result, and Send's sent view.
 */
const GAINED = [
  'src/screens/Home.svelte',
  'src/screens/Overview.svelte',
  'src/screens/Settings.svelte',
  'src/screens/keys/RemoveWallet.svelte',
  'src/screens/Backup.svelte',
  'src/screens/receive/FaucetCard.svelte',
  'src/screens/send/Sent.svelte',
];

/** The sentences of a text, split after a full stop that a capital, an opening mark or a quote follows. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.?]) (?=[A-ZÁÉÍÓÚÑ¿"])/);
}

// Written as an object, so that the compiler refuses a reason that is missing here.
const ALL_REASONS: Record<BlockedReason, true> = {
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
const REASONS = Object.keys(ALL_REASONS) as BlockedReason[];

// -- the table and the code agree on the keys -------------------------------------------

test('every key the code builds from a step, a part or a reason is in the table, in both languages', () => {
  for (const table of [en, es]) {
    for (const id of STEPS) {
      for (const key of [STEP_DEFS[id].title, `lede_${id}`, `done_${id}`]) assert.ok(Object.hasOwn(table, key), key);
      for (let part = 1; part <= partCount(id); part++) {
        assert.ok(Object.hasOwn(table, partKey(id, part)), partKey(id, part));
        assert.ok(Object.hasOwn(table, `guide_${id}_${part}`), `guide_${id}_${part}`);
      }
    }
    assert.equal(REASONS.length, 10);
    for (const reason of REASONS) {
      assert.ok(Object.hasOwn(table, `stripNeed_${reason}`), `stripNeed_${reason}`);
      // The wallet's own trouble (a stored wallet that cannot be used, a wallet that cannot run in this
      // browser, a storage the page was not let read) is said by the wallet's own piece, not by a sentence here.
      assert.equal(Object.hasOwn(table, `need_${reason}`), !isWalletTrouble(reason), `need_${reason}`);
    }
    // And the table holds no strip words for a reason that does not exist.
    for (const key of Object.keys(table)) {
      const strip = /^stripNeed_(.+)$/.exec(key);
      if (strip !== null) assert.ok((REASONS as string[]).includes(strip[1] ?? ''), key);
    }
    for (const number of [2, 3, 4]) assert.ok(Object.hasOwn(table, `chapter_${number}`), `chapter_${number}`);
    for (const term of [...EXPLAIN_TERMS, 'wallet', 'address', 'seed', 'explorer', 'height', 'faucet']) assert.ok(Object.hasOwn(table, `term_${term}`), `term_${term}`);
  }
  // No part, lede or done sentence for a step or a part that does not exist.
  for (const key of Object.keys(en)) {
    const part = /^(?:part|guide)_([a-z-]+)_([0-9]+)/.exec(key);
    if (part !== null) {
      const id = STEPS.find((step) => step === part[1]);
      assert.ok(id !== undefined && Number(part[2]) <= partCount(id), key);
    }
    const whole = /^(?:title|lede|done)_([a-z-]+)$/.exec(key);
    if (whole !== null) assert.ok((STEPS as readonly string[]).includes(whole[1] ?? ''), key);
  }
});

test('"What just happened": one sentence for each key explain() can give, with exactly its slots', () => {
  const keys = Object.keys(EXPLAIN_SLOTS) as (keyof typeof EXPLAIN_SLOTS)[];
  assert.equal(keys.length, 24);
  assert.deepEqual(
    Object.keys(en)
      .filter((key) => key.startsWith('explain_'))
      .sort(),
    [...keys].sort(),
  );
  for (const lang of LANGS) {
    for (const key of keys) {
      assert.deepEqual(slotNames(strings.doit[lang][key]).sort(), [...EXPLAIN_SLOTS[key]].sort(), `${lang}.${key}`);
    }
  }
  // The one sentence the spec gives in full, and the heading.
  assert.equal(
    en.explain_other,
    "{amount} went to an address that is not this wallet's, most likely the sender's own change. A wallet knows its own change and can only guess at someone else's.",
  );
  assert.equal(en.explainTitle, 'What just happened');
  // A transaction this wallet only received is never told "there was no change".
  for (const key of ['explain_theirsOne', 'explain_theirsMany', 'explain_got', 'explain_gotMany', 'explain_other', 'explain_otherMany', 'explain_feeTheirs', 'explain_feeTheirsAbout'] as const) {
    assert.doesNotMatch(strings.doit.en[key], /no change/i, key);
    assert.doesNotMatch(strings.doit.es[key], /no (hubo|volvió) cambio/i, key);
  }
  // "About" stands in the two sentences for a rate that is not whole, and in no other.
  for (const key of keys) {
    assert.equal(/\babout\b/.test(strings.doit.en[key]), key.endsWith('About'), key);
    assert.equal(/\bunos\b/.test(strings.doit.es[key]), key.endsWith('About'), key);
  }
});

test('every key of the table is on a screen', () => {
  const where = [...doitSources(), ...GAINED.map((name) => ({ name, text: source(name) }))].map((file) => code(file.text)).join('\n');
  // Keys that are looked up by a name built from a step, a part, a reason, a sentence or a term.
  const built = /^(title|lede|done|part|guide|chapter|need|stripNeed|explain|term)_/;
  for (const key of Object.keys(en)) {
    if (built.test(key)) continue;
    const used = new RegExp(`\\.${key}\\b`).test(where) || where.includes(`'${key}'`);
    assert.ok(used, `doit.${key} is in the table and on no screen`);
  }
  // And each family of built keys is built somewhere.
  for (const made of ['`lede_${id}`', '`done_${id}`', '`guide_${id}_${part}`', '`chapter_${chapter.number}`', '`stripNeed_${says.reason}`', '`term_${term}`', 'partKey(']) {
    assert.ok(where.includes(made), made);
  }
  assert.match(where, /t\[need\.text\]/);
  assert.match(where, /text: t\[sentence\.key\]/);
});

// -- the name, and the sentences the spec gives ----------------------------------------------

test('the reader-facing name is "Do it", in Spanish "Hazlo", and never "lab"', () => {
  assert.equal(en.name, 'Do it');
  assert.equal(es.name, 'Hazlo');
  for (const { where, text } of everyText()) assert.doesNotMatch(text, /\b(lab|labs|laboratorio|tutorial|lesson|quest|mission)\b/i, where);
  // The six titles of the spec, and the names of what the reader presses.
  assert.deepEqual(
    STEPS.map((id) => en[STEP_DEFS[id].title]),
    ['Hold some', 'Pass it on', 'There are no balances', 'The waiting room', 'The seed', 'Prove the backup'],
  );
  assert.equal(en.back, 'Back to the chapter');
  assert.equal(es.back, 'Volver al capítulo');
  assert.equal(en.restart, 'Start this step again');
  assert.equal(en.stop, 'Stop following');
  assert.equal(en.stripStop, 'Stop following');
  assert.equal(en.stripBack, 'Back to the step');
  // The way back to a step, on a button, names the step: where it stands, nothing else in view does.
  assert.equal(en.backTo, 'Back to "{step}"');
  assert.equal(es.backTo, 'Volver a "{step}"');
  for (const lang of LANGS) assert.deepEqual(slotNames(strings.doit[lang].backTo), ['step'], lang);
  assert.equal(en.next, 'Next step: {step}');
  assert.equal(en.allSteps, 'All steps');
  assert.equal(en.forget, 'Forget my progress');
  assert.equal(en.sendAnother, 'Send another');
});

test('the sentence that follows the exception paragraph above the three word fields, word for word', () => {
  assert.equal(
    en.wordsOnce,
    'A real wallet asks for this once, on its own screen, straight after it has shown you the words. Anything else that asks for your words, even for three of them (a web page, an email, a support chat), is the scam chapter 4 describes.',
  );
  assert.match(es.wordsOnce ?? '', /^Una billetera de verdad pide esto una sola vez, .+ es la estafa que describe el capítulo 4\.$/);
  // It stands under the paragraph the Restore screen carries, in the same notice.
  const piece = source('src/screens/doit/AskWords.svelte');
  assert.match(piece, /<Notice kind="caution" text=\{r\.exception\} data-testid="step-words-exception">\s*<p>\{t\.wordsOnce\}<\/p>\s*<\/Notice>/);
  assert.match(piece, /let r = \$derived\(strings\.restore\[lang\]\);/);
  assert.match(strings.restore.en.exception, /^Chapter 4 of the Journey says never to type your seed into a website/);
});

test('the waiting display, and the line a part keeps once its block has come', () => {
  assert.equal(en.waited, 'It waited {seconds} seconds. Block {height} took it in.');
  for (const lang of LANGS) {
    const t = strings.doit[lang];
    assert.deepEqual(slotNames(t.waitSent), ['ago'], lang);
    assert.deepEqual(slotNames(t.waitTip), ['height'], lang);
    assert.deepEqual(slotNames(t.waitEvery), ['seconds'], lang);
    assert.deepEqual(slotNames(t.confirmations).sort(), ['count', 'total'], lang);
    // A payment the network has lost: the cause, then the way out.
    assert.ok(sentences(t.waitLost).length >= 2, lang);
  }
  assert.match(strings.doit.en.waitLost, /^The practice network does not know this payment\./);
  assert.match(strings.doit.en.waitLost, /Send another payment/);
});

test('the lede of "The waiting room" says why the fee rate does not matter here, and that it does on Bitcoin', () => {
  const lede = en['lede_waiting-room'] ?? '';
  assert.match(lede, /Here the waiting room is almost empty, so the next block takes every payment whatever fee rate it pays/);
  assert.match(lede, /on Bitcoin the fee rate decides the place in line\.$/);
  const spanish = es['lede_waiting-room'] ?? '';
  assert.match(spanish, /la sala de espera está casi vacía/);
  assert.match(spanish, /en Bitcoin, la tasa de comisión decide el lugar en la fila\.$/);
  // Six blocks: about so many minutes here, about an hour on Bitcoin.
  for (const key of ['guide_waiting-room_3', 'guide_waiting-room_3_minute', 'guide_waiting-room_3_seconds']) {
    assert.match(en[key] ?? '', /about an hour on Bitcoin\.$/, key);
    assert.match(es[key] ?? '', /alrededor de una hora en Bitcoin\.$/, key);
  }
});

test('"Hold some" says one plain sentence for each new thing, and what is coming', () => {
  // Chapter 2 has not taught a wallet, an address, the faucet or the 12 words.
  const [wallet, coins, confirm, outside] = [1, 2, 3, 4].map((part) => en[`guide_hold-some_${part}`] ?? '');
  assert.match(wallet ?? '', /^A wallet is software that keeps the keys to your coins\./);
  // What is coming: a choice, either way fine for practice, and 12 words that chapter 4 explains.
  assert.match(wallet ?? '', /with a passkey or without, and either is fine for practice/);
  assert.match(wallet ?? '', /12 words, which chapter 4 explains\.$/);
  assert.match(coins ?? '', /^An address is where coins are sent/);
  assert.match(coins ?? '', /The faucet hands practice coins to anyone who asks/);
  assert.match(confirm ?? '', /On Bitcoin a block comes about every 10 minutes; here, about every \{seconds\} seconds\.$/);
  assert.match(outside ?? '', /^A block explorer is a website that shows a chain to anyone who asks/);
  assert.match(es['guide_hold-some_3'] ?? '', /En Bitcoin llega un bloque más o menos cada 10 minutos; aquí, más o menos cada \{seconds\} segundos\.$/);
  // The Spanish names a passkey the way the app does on first mention.
  assert.match(es['guide_hold-some_1'] ?? '', /con llave de acceso \(passkey\) o sin ella/);
});

test('before the wallet is removed the screen says plainly what the drill is, and what it costs', () => {
  assert.match(en.removeWarnFunded ?? '', /^With real money this drill is done before the wallet is funded \(chapter 4, section 7\)\. Here the coins stay in, to show that the chain kept them\.$/);
  assert.match(en.removeWarnNine ?? '', /^Three right words do not prove the other nine\. If the restore fails, this wallet and its practice coins are gone, which is what a wrong backup costs\.$/);
  assert.match(en.removeWarnKept ?? '', /^A wallet restored from its 12 words is kept in this browser with those words, also when it was opened with a passkey before\.$/);
  // All three stand in one notice, in that order, in the part that removes.
  const part = source('src/screens/doit/OpenPart.svelte');
  assert.match(
    part,
    /\{#if fact === 'wallet-removed'\}[\s\S]*?<Notice kind="caution" label=\{t\.removeWarnTitle\} data-testid="step-remove-warning">[\s\S]*?<p>\{t\.removeWarnFunded\}<\/p>\s*<p>\{t\.removeWarnNine\}<\/p>\s*<p>\{t\.removeWarnKept\}<\/p>/,
  );
});

test('a done drill says what the restore changed, in the past tense: the card is drawn from the note alone, and must be true whatever this browser keeps by then', () => {
  // For a wallet that was opened with a passkey before the drill. The sentence, in both languages.
  assert.equal(en.changedTitle, 'What the restore changed');
  assert.equal(
    en.changed,
    'When you restored the wallet from its 12 words, this browser began to keep it with those words, not encrypted, and stopped asking for the passkey. The restore did not change the passkey: if you still have it, it opens the same wallet, and if it ever fails, the 12 words bring the wallet back. About says what this browser keeps right now. To go back to the passkey for that wallet, remove the wallet that is in this browser, if there is one, and choose "Open with my passkey".',
  );
  assert.equal(es.changedTitle, 'Lo que cambió con la restauración');
  assert.equal(
    es.changed,
    'Cuando restauraste la billetera desde sus 12 palabras, este navegador empezó a guardarla con esas palabras, sin cifrar, y dejó de pedir la llave de acceso (passkey). La restauración no cambió la llave de acceso: si todavía la tienes, abre la misma billetera, y si alguna vez falla, las 12 palabras recuperan la billetera. La página Acerca de dice qué guarda este navegador ahora mismo. Para volver a la llave de acceso con esa billetera, quita la billetera que haya en este navegador, si hay alguna, y elige "Abrir con mi llave de acceso (passkey)".',
  );
  // The button is quoted exactly as each language draws it, and About is called by the name its link has.
  assert.equal(strings.wallet.en.openButton, 'Open with my passkey');
  assert.equal(strings.wallet.es.openButton, 'Abrir con mi llave de acceso (passkey)');
  for (const lang of LANGS) {
    assert.ok(strings.doit[lang].changed.endsWith(` "${strings.wallet[lang].openButton}".`), lang);
  }
  assert.match(source('src/components/wallet/OpenWithPasskey.svelte'), /\{t\.openButton\}/);
  assert.ok(en.changed?.includes(`${strings.common.en.linkAbout} says what this browser keeps right now.`));
  assert.ok(es.changed?.includes(`La página ${strings.common.es.linkAbout} dice qué guarda este navegador ahora mismo.`));
  assert.equal(strings.about.en.keepNowLabel, 'In this browser right now');

  // The card is drawn whenever the step's note says the wallet was opened with a passkey when the drill began,
  // and from nothing else: nothing of the wallet that is in this browser now is looked at for it.
  const done = source('src/screens/doit/Done.svelte');
  assert.match(
    done,
    /\{#if note\?\.was === 'passkey'\}\s*<div class="[^"]*" data-testid="step-changed">\s*<h3 class="[^"]*">\{t\.changedTitle\}<\/h3>\s*<p class="[^"]*">\{t\.changed\}<\/p>\s*<\/div>\s*\{\/if\}/,
  );
  // So no sentence of it may say what this browser keeps, or asks for, now: after the drill the reader can put
  // the wallet back behind its passkey, remove it, or bring in another one, and the note stays as it is.
  assert.doesNotMatch(en.changed ?? '', /\bnow keeps\b|\bkeeps this wallet\b|\bno longer asks\b|\bis kept\b|\bare stored\b/);
  assert.doesNotMatch(es.changed ?? '', /\bahora guarda\b|\bguarda esta billetera\b|\bya no pide\b|\bestán guardadas\b/);
  for (const lang of LANGS) {
    const [restore, passkey, where, way] = sentences(strings.doit[lang].changed);
    assert.equal(sentences(strings.doit[lang].changed).length, 4, lang);
    // What the restore did, in the past tense; what it did not do to the passkey, and what holds if the reader
    // still has it; where the present is told; the way back.
    assert.match(restore ?? '', lang === 'en' ? /^When you restored the wallet .* began to keep it .* stopped asking/ : /^Cuando restauraste la billetera .* empezó a guardarla .* dejó de pedir/, lang);
    // Of the passkey the card promises nothing. The passkey lives in the reader's password manager: it can
    // have been deleted there, be lost with a security key, or fail, and this page cannot know. So: what the
    // restore did not do (past tense), what holds IF the reader still has it, and what brings the wallet back
    // if it fails. Never a bare "the passkey still opens the same wallet".
    assert.match(
      passkey ?? '',
      lang === 'en'
        ? /^The restore did not change the passkey: if you still have it, it opens the same wallet, and if it ever fails, the 12 words bring the wallet back\.$/
        : /^La restauración no cambió la llave de acceso: si todavía la tienes, abre la misma billetera, y si alguna vez falla, las 12 palabras recuperan la billetera\.$/,
      lang,
    );
    assert.match(where ?? '', lang === 'en' ? /^About says/ : /^La página Acerca de dice/, lang);
    // The way back removes whatever wallet is in this browser, and says so: with another wallet here, "the wallet" would be the wrong one.
    assert.match(way ?? '', lang === 'en' ? /remove the wallet that is in this browser, if there is one,/ : /quita la billetera que haya en este navegador, si hay alguna,/, lang);
  }

  // No sentence of the card says, without a condition, what the passkey does or opens now.
  assert.doesNotMatch(en.changed ?? '', /\bstill opens\b|\bThe passkey (still )?(opens|works|unlocks)\b|\byour passkey (still )?(opens|works|unlocks)\b/i);
  assert.doesNotMatch(es.changed ?? '', /\bsigue abriendo\b|\bLa llave de acceso (sigue|abre|funciona)\b/i);
  for (const lang of LANGS) {
    for (const each of sentences(strings.doit[lang].changed)) {
      const names = lang === 'en' ? /\bpasskey\b/.test(each) && /\b(opens|open|works|unlocks)\b/.test(each) : /llave de acceso/.test(each) && /\b(abre|funciona|desbloquea)\b/.test(each);
      // The one sentence that says what the passkey opens says it under "if you still have it".
      if (names && !/^To go back|^Para volver/.test(each)) assert.match(each, lang === 'en' ? /\bif you still have it\b/ : /\bsi todavía la tienes\b/, `${lang}: ${each}`);
    }
  }
  // What Settings says before a removal is the same promise, and no stronger: the 12 words are the sure way back.
  assert.match(strings.settings.en.removeBackPasskey, /A passkey can fail, so the 12 words are the sure way back\./);

  // What the past tense rests on. The note's `was` is how this browser kept the wallet when the drill's paper
  // check was ticked, and the drill's third part ticks only in a world where that same wallet is here and kept
  // with its words. For a wallet that was opened with a passkey, only a restore from the 12 words writes that.
  const drill = { started: true as const, wallet: FP, was: 'passkey' as const, parts: { 1: true as const, 2: true as const } };
  const at = (wallet: World['wallet']): string => {
    const verdict = verdictOf('prove-the-backup', 3, { wallet, note: { v: 1, following: 'prove-the-backup', followedAt: NOW, steps: { 'prove-the-backup': drill } }, kept: 'yes', now: NOW, listAt: NOW });
    return verdict.is === 'blocked' ? `blocked: ${verdict.reason}` : verdict.is;
  };
  assert.equal(at(world({ record: record('words', FP) }).wallet), 'met', 'the same wallet, kept with its words');
  assert.equal(at(world({ record: record('passkey', FP) }).wallet), 'blocked: came-back-with-passkey', 'the same wallet, opened with its passkey');
  assert.equal(at(world({ record: record('words', OTHER_FP) }).wallet), 'blocked: another-wallet');
  assert.equal(at(noWallet().wallet), 'now', 'no wallet: the part is still to do');
});

test('the pot\'s line says payments, not people, and never whose: the page is given a number and cannot know that the reader\'s payment is one of them', () => {
  // The count alone, in both languages.
  assert.equal(en.potCount, '{count} payments have been passed on to the pot so far.');
  assert.equal(en.potCountOne, 'One payment has been passed on to the pot so far.');
  assert.equal(es.potCount, 'Hasta ahora se han pasado {count} pagos al fondo común.');
  assert.equal(es.potCountOne, 'Hasta ahora se ha pasado un pago al fondo común.');
  for (const key of ['potCount', 'potCountOne']) {
    assert.match(en[key] ?? '', /\bpayments?\b/, key);
    assert.match(es[key] ?? '', /\bpagos?\b/, key);
    assert.doesNotMatch(en[key] ?? '', /people|person|learner|reader|wallet/i, key);
    assert.doesNotMatch(es[key] ?? '', /persona|gente|billetera/i, key);
    // Never "yours", "yours among them", "including yours": the line is one sentence that ends with "so far".
    assert.doesNotMatch(en[key] ?? '', /\byours?\b|\bamong\b|\bincluding\b|\bown\b/i, key);
    assert.doesNotMatch(es[key] ?? '', /\b(el )?tuyo\b|\btu\b|\bentre\b|\bincluid[oa]\b|\bpropio\b/i, key);
    assert.match(en[key] ?? '', /to the pot so far\.$/, key);
    assert.match(es[key] ?? '', /al fondo común\.$/, key);
  }
  assert.deepEqual(slotNames(en.potCount ?? ''), ['count']);
  // Why it cannot say whose. What the page is handed is three numbers: the Worker builds the answer from three
  // counts and nothing else, and a kept answer may be some seconds old. And a done step's note names no payment.
  const stats = source('src/screens/doit/Done.svelte');
  assert.match(stats, /if \(!gone && answer\.ok\) passedOn = answer\.stats\.passedOn;/);
  assert.equal(stats.match(/answer\.stats\./g)?.length, 1, 'the count is the one thing read from the answer');
  let paid: Progress = applyChange(emptyProgress(), { kind: 'open', step: 'pass-it-on', at: NOW, from: null });
  paid = applyChange(paid, { kind: 'tick', step: 'pass-it-on', part: 1, at: NOW });
  paid = applyChange(paid, { kind: 'tick', step: 'pass-it-on', part: 2, at: NOW, tx: txid('a1'), sentAt: NOW });
  assert.equal(paid.steps['pass-it-on']?.tx, txid('a1'), 'while the step waits, the note names the payment');
  paid = applyChange(paid, { kind: 'tick', step: 'pass-it-on', part: 3, at: NOW + 30_000 });
  assert.deepEqual(paid.steps['pass-it-on'], { started: true, doneAt: NOW + 30_000, parts: { 1: true, 2: true, 3: true } }, 'done, it names none');
  // No other sentence of a done step's card says that the reader's payment is among those the pot counts.
  for (const lang of LANGS) {
    for (const [key, text] of Object.entries(strings.doit[lang] as Table)) {
      if (!key.startsWith('done_') && !key.startsWith('pot')) continue;
      assert.doesNotMatch(text, /yours among|among them|one of them is yours|including yours|el tuyo|entre ellos/i, `doit.${lang}.${key}`);
    }
  }
  // Asked once, and shown only for a count of at least 1.
  const done = source('src/screens/doit/Done.svelte');
  assert.equal(done.match(/wallet\.potStats\(\)/g)?.length, 1);
  // (For a count of 0 the line is left out: "none so far" under a step done by a payment to the pot would read
  // as a contradiction, and the page cannot tell which of the two is behind.)
  assert.match(done, /if \(passedOn === null \|\| passedOn < 1\) return '';/);
  // Asked under "Pass it on" alone, and only where the Worker's settings say that the counts can be had: the
  // one question sits behind asksPotCount (doit-view.test.ts holds that function, and this line, to the rule).
  assert.match(done, /if \(!countsWanted \|\| asked\) return;\s*asked = true;\s*untrack\(\(\) => \{\s*void busyWhile\(wallet\.potStats\(\)\)/);
});

// -- nothing is said that the page does not do ---------------------------------------------------

test('what the list says of what is sent agrees with what is counted: the note stays here, and opening and finishing a step are counted while counting is on', () => {
  // The facts first. A step's screen is counted as a screen view under its own path, and a finished step by name.
  for (const id of STEPS) {
    assert.ok(eventPaths().includes(`/do/${id}`), id);
    assert.ok((EVENTS['Do it'].values as readonly string[]).includes(id), id);
  }
  assert.match(strings.about.en.count_doIt, /^A "Do it" step was done, and which of the six steps it was\./);
  // So the list may say that the note is not sent, and must say that those two things are counted. It stands
  // where a reader decides whether to forget, so it also says what the note holds, by the kinds of thing About
  // lists, and where the whole list is.
  assert.equal(
    en.forgetWhat,
    "This browser keeps a note of your progress: which steps you have opened and done, which parts are ticked, and what a step needs on its way, such as a wallet fingerprint and a payment it waits for. The About page lists it all. The note itself is never sent to us. While counting is on, opening a step's screen and finishing a step are counted; the About page says whether it is on.",
  );
  assert.equal(
    es.forgetWhat,
    'Este navegador guarda una nota de tu progreso: qué pasos abriste y cuáles terminaste, qué partes están marcadas, y lo que un paso necesita por el camino, como una huella de la billetera y un pago que espera. La página Acerca de lo enumera todo. La nota en sí nunca se nos envía. Mientras el conteo esté activado, abrir la pantalla de un paso y terminar un paso se cuentan; la página Acerca de dice si está activado.',
  );
  assert.equal(strings.common.en.linkAbout, 'About');
  assert.equal(strings.common.es.linkAbout, 'Acerca de');
  // Counting can be off: with settings that say so, and with none from the server (the built-in ones say off).
  // The app then sends no count at all, and About says "Counting is off right now, so none of this is sent."
  // The list draws its sentence without a look at that setting, so the sentence itself must hold both ways:
  // whatever it says is counted, it says under "while counting is on", and it names About for whether it is.
  assert.equal(DEFAULT_CONFIG.events, false);
  assert.doesNotMatch(source('src/screens/Do.svelte'), /config\.events/);
  assert.deepEqual([strings.about.en.countOn, strings.about.en.countOff], ['Counting is on right now.', 'Counting is off right now, so none of this is sent.']);
  assert.match(source('src/screens/About.svelte'), /<strong>\{counting \? t\.countOn : t\.countOff\}<\/strong>/);
  for (const lang of LANGS) {
    const counted = sentences(strings.doit[lang].forgetWhat).filter((each) => /\bare counted\b|\bse cuentan\b/.test(each));
    assert.equal(counted.length, 1, lang);
    assert.match(
      counted[0] ?? '',
      lang === 'en'
        ? /^While counting is on, opening a step's screen and finishing a step are counted; the About page says whether it is on\.$/
        : /^Mientras el conteo esté activado, abrir la pantalla de un paso y terminar un paso se cuentan; la página Acerca de dice si está activado\.$/,
      lang,
    );
    // Never flatly, as if counting were always on.
    assert.doesNotMatch(strings.doit[lang].forgetWhat, /are counted, as the About page says|se cuentan, como dice/, lang);
  }
  // It is drawn above the button, on the list, for a note that was read. For a stored value that is no note
  // this version can read, the list says that instead (the next test): the sentence above describes a note.
  assert.match(
    source('src/screens/Do.svelte'),
    /\{#if canForget\}\s*<Section title=\{t\.forgetTitle\}>\s*<div bind:this=\{root\} class="[^"]*">\s*\{#if doit\.read === 'unreadable'\}\s*<!--[^>]*-->\s*<p class="[^"]*" data-testid="do-forget-unreadable">\{t\.forgetUnreadable\}<\/p>\s*\{:else\}\s*<p class="[^"]*" data-testid="do-forget-what">\{t\.forgetWhat\}<\/p>\s*\{\/if\}/,
  );
  assert.equal(source('src/screens/Do.svelte').match(/\{t\.forgetWhat\}/g)?.length, 1, 'the sentence for a note is drawn in one place');
  // What it names is what a note holds. A note with every field a note can have, by the one write function's rules:
  let whole: Progress = emptyProgress();
  for (const change of [
    { kind: 'open', step: 'waiting-room', at: NOW, from: '/journey/how-bitcoin-works' },
    { kind: 'tick', step: 'waiting-room', part: 1, at: NOW, tx: txid('a1'), sentAt: NOW },
    { kind: 'open', step: 'prove-the-backup', at: NOW, from: null },
    { kind: 'tick', step: 'prove-the-backup', part: 1, at: NOW, wallet: FP, was: 'passkey' },
    // A need of "The waiting room", which was reached by its card, sends the reader to "Hold some".
    { kind: 'detour', step: 'hold-some', cameFor: 'waiting-room' },
    { kind: 'open', step: 'hold-some', at: NOW, from: null },
    ...[1, 2, 3, 4].map((part) => ({ kind: 'tick', step: 'hold-some', part, at: NOW })),
  ] as Parameters<typeof applyChange>[1][]) {
    whole = applyChange(whole, change);
  }
  const held = new Set(Object.values(whole.steps).flatMap((note) => Object.keys(note ?? {})));
  // "which steps you have opened and done" (started, doneAt), "which parts are ticked" (parts), "a wallet
  // fingerprint" (wallet) and "a payment it waits for" (tx, sentAt), as two of the things a step needs on its way.
  for (const field of ['started', 'doneAt', 'parts', 'wallet', 'tx', 'sentAt']) assert.ok(held.has(field), field);
  // "Such as": the two it names are not all of them, and the sentence does not say they are. About lists the rest:
  // how the wallet was kept, which of the chapter's pages the reader came from, the step they came for when
  // another step sent them on first, and the step that is followed.
  assert.deepEqual([...held].sort(), ['cameFor', 'doneAt', 'from', 'parts', 'sentAt', 'started', 'tx', 'wallet', 'was']);
  assert.equal(whole.steps['hold-some']?.cameFor, 'waiting-room');
  // "The note itself is never sent to us" stays true with that field in it: the note is not sent. What a link
  // back to a chapter carries in its address is another matter, and About says it (test/info-text.test.ts).
  for (const lang of LANGS) assert.match(strings.doit[lang].forgetWhat, lang === 'en' ? /The note itself is never sent to us\./ : /La nota en sí nunca se nos envía\./, lang);
  assert.match(en.forgetWhat ?? '', /such as a wallet fingerprint and a payment it waits for\. The About page lists it all\./);
  assert.match(es.forgetWhat ?? '', /como una huella de la billetera y un pago que espera\. La página Acerca de lo enumera todo\./);
  assert.doesNotMatch(en.forgetWhat ?? '', /\bonly\b|\bnothing else\b/);
  assert.doesNotMatch(es.forgetWhat ?? '', /\bsolo\b|\bnada más\b/);
  // "Opening a step's screen" is counted as a screen view under the step's own path, and About's entry for a
  // screen view says that each step is a screen of its own: so a view tells which step was opened.
  assert.equal(strings.about.en.count_pageview, 'A screen was opened. Every transaction screen counts as the same screen. Each "Do it" step is a screen of its own.');
  assert.equal(strings.about.es.count_pageview, 'Se abrió una pantalla. Todas las pantallas de transacción cuentan como la misma pantalla. Cada paso de "Hazlo" es una pantalla propia.');
  assert.equal(new Set(STEPS.map((id) => `/do/${id}`).filter((path) => eventPaths().includes(path))).size, STEPS.length, 'one counted path for each step');
  assert.equal(eventPaths().filter((path) => path.startsWith('/wallet/tx')).length, 1, 'and one for every transaction screen together');
  // No sentence of these screens says that nothing is sent, or that nothing leaves the browser (SPEC section 12).
  for (const { where, text } of everyText()) {
    assert.doesNotMatch(text, /\bnothing\b[^.]*\b(is sent|is counted|leaves|is shared)\b/i, where);
    assert.doesNotMatch(text, /\bnada\b[^.]*\b(se (nos )?envía|se cuenta|sale|se comparte)\b/i, where);
    assert.doesNotMatch(text, /says who you are|dice quién eres/i, where);
  }
});

test('the step notes that the 12 words were shown; it is the page that shows them, and the text does not say otherwise', () => {
  assert.equal(en['guide_the-seed_1'], 'Open the Backup screen and show the 12 words. This step notes only that they were shown, never the words.');
  assert.equal(es['guide_the-seed_1'], 'Abre la pantalla Respaldo y muestra las 12 palabras. Este paso solo anota que se mostraron, nunca las palabras.');
  // "The page" is the whole app in these texts: it makes, shows and (without a passkey) stores the words.
  for (const { where, text } of everyText()) {
    assert.doesNotMatch(text, /the page (sees|knows|learns)[^.]*never which/i, where);
    assert.doesNotMatch(text, /la página (ve|sabe)[^.]*nunca cuáles/i, where);
  }
});

test('six confirmations are the payment\'s own block and five on top: no sentence puts six blocks on top of it', () => {
  assert.equal(SIX_BLOCKS, 6);
  assert.match(en['lede_waiting-room'] ?? '', /^You send a payment and watch it wait, get into a block, and reach six confirmations\./);
  assert.match(es['lede_waiting-room'] ?? '', /^Envías un pago y lo ves esperar, entrar en un bloque y llegar a seis confirmaciones\./);
  assert.match(en['done_waiting-room'] ?? '', /^Your payment reached six confirmations: its own block and five on top\./);
  assert.match(es['done_waiting-room'] ?? '', /^Tu pago llegó a seis confirmaciones: su propio bloque y cinco encima\./);
  for (const key of ['lede_waiting-room', 'done_waiting-room', 'guide_waiting-room_3', 'guide_waiting-room_3_minute', 'guide_waiting-room_3_seconds']) {
    assert.doesNotMatch(en[key] ?? '', /six blocks on top|under six/i, key);
    assert.doesNotMatch(es[key] ?? '', /seis bloques encima|debajo de seis/i, key);
  }
});

test('a done step states as fact only what the page checked: the paper is the reader\'s word, and change is not promised', () => {
  // "On paper" rests on the box the reader ticked, and where the words were read from no page can know.
  assert.match(en['done_the-seed'] ?? '', /^You said you wrote your 12 words on paper, and three of them matched\./);
  assert.match(es['done_the-seed'] ?? '', /^Dijiste que escribiste tus 12 palabras en papel, y tres de ellas coincidieron\./);
  // What the reader said is what the box says, in the past tense: where the paper is today nobody knows.
  assert.equal(en.said, 'I wrote the 12 words on paper, in order.');
  assert.match(en['done_prove-the-backup'] ?? '', /^The wallet came back from its 12 words, with its coins\./);
  assert.match(es['done_prove-the-backup'] ?? '', /^La billetera volvió desde sus 12 palabras, con sus monedas\./);
  assert.doesNotMatch(en['done_prove-the-backup'] ?? '', /on paper/);
  assert.doesNotMatch(es['done_prove-the-backup'] ?? '', /en papel/);
  // A payment that sent everything has no change: "Pass it on" with "Send all" is one.
  assert.match(en['guide_no-balances_3'] ?? '', /and the change that came back as a new coin, if any did\.$/);
  assert.match(es['guide_no-balances_3'] ?? '', /y el cambio que volvió como una moneda nueva, si lo hubo\.$/);
  assert.match(en['done_no-balances'] ?? '', /one for the address paid and, when something is left over, one back to you as change\.$/);
  assert.match(es['done_no-balances'] ?? '', /una para la dirección de destino y, cuando sobra algo, otra de vuelta para ti como cambio\.$/);
  assert.match(en.explain_noChange ?? '', /^No change came back\./);
});

test('a done step says what the reader did and saw, in the past tense: its card is drawn from the note on every later visit, whatever has become of the wallet, the chain and the pot', () => {
  // The six sentences, word for word, in both languages.
  const said: Record<StepId, [english: string, spanish: string]> = {
    'hold-some': [
      "You got practice coins, and you named the block that took the first of them in. A block explorer shows a chain to anyone who asks, with no wallet at all, so nobody has to take a wallet's word for what is on it. On Bitcoin it works the same way: verify, don't trust.",
      'Recibiste monedas de práctica, y dijiste qué bloque incluyó la primera de ellas. Un explorador de bloques le muestra una cadena a quien pregunte, sin ninguna billetera, así que nadie tiene que creerle a una billetera lo que hay en la cadena. En Bitcoin funciona igual: verifica, no confíes.',
    ],
    'pass-it-on': [
      'Your payment got into a block, and the pot took your coins to hand on to a learner who comes after you. The fee was what went in less what came out.',
      'Tu pago entró en un bloque, y el fondo común recibió tus monedas para pasarlas a alguien que viene después de ti. La comisión fue lo que entró menos lo que salió.',
    ],
    'no-balances': [
      'You counted the coins in your wallet, and opened one of its payments to see what it did to them. A wallet keeps no balance: it holds coins, and its total is what they add up to. A payment uses coins up whole and makes new ones: one for the address paid and, when something is left over, one back to you as change.',
      'Contaste las monedas de tu billetera, y abriste uno de sus pagos para ver qué hizo con ellas. Una billetera no lleva ningún saldo: tiene monedas, y su total es lo que suman. Un pago gasta monedas enteras y crea monedas nuevas: una para la dirección de destino y, cuando sobra algo, otra de vuelta para ti como cambio.',
    ],
    'waiting-room': [
      'Your payment reached six confirmations: its own block and five on top. On Bitcoin, undoing a payment that deep means redoing all six blocks faster than the rest of the network adds new ones. That is why six confirmations is the usual line for "settled".',
      'Tu pago llegó a seis confirmaciones: su propio bloque y cinco encima. En Bitcoin, deshacer un pago a esa profundidad exige rehacer los seis bloques más rápido de lo que el resto de la red agrega bloques nuevos. Por eso seis confirmaciones son la línea habitual de "liquidado".',
    ],
    'the-seed': [
      'You said you wrote your 12 words on paper, and three of them matched. Three right words do not prove the other nine: "Prove the backup" does that.',
      'Dijiste que escribiste tus 12 palabras en papel, y tres de ellas coincidieron. Tres palabras correctas no comprueban las otras nueve: eso lo hace "Comprueba el respaldo".',
    ],
    'prove-the-backup': [
      'The wallet came back from its 12 words, with its coins. The chain kept them the whole time, and the words only unlocked them: you own keys, not coins.',
      'La billetera volvió desde sus 12 palabras, con sus monedas. La cadena las conservó todo el tiempo, y las palabras solo las desbloquearon: tienes claves, no monedas.',
    ],
  };
  for (const id of STEPS) {
    assert.equal(doneKey(id), `done_${id}`);
    assert.equal(en[`done_${id}`], said[id][0], id);
    assert.equal(es[`done_${id}`], said[id][1], id);
  }

  // The card is drawn from the step's note and from nothing else: for as long as the note says "done", on every
  // later visit. By then the wallet may be removed or another one, its coins sent on, the practice chain
  // started again (the payment and its block are gone), and the pot's coins handed to a newcomer.
  const card = source('src/screens/doit/Done.svelte');
  assert.match(card, /<p data-testid="step-done-text">\{t\[doneKey\(id\)\]\}<\/p>/);
  assert.equal(card.match(/doneKey\(id\)/g)?.length, 1, 'one sentence, drawn in one place, under no condition');
  assert.match(source('src/screens/doit/StepBody.svelte'), /let done = \$derived\(view\.state === 'done'\);/);
  assert.match(source('src/screens/doit/StepBody.svelte'), /\{#if done\}\s*<Done \{id\} \{now\} \/>\s*\{\/if\}/);
  for (const id of STEPS) {
    // Done is what the note says, whatever the wallet is: no wallet, a storage nobody could read, another wallet.
    const note = { v: 1 as const, following: null, steps: { [id]: { started: true as const, doneAt: NOW - 86_400_000 } } };
    for (const seen of [noWallet({ note }), world({ note, status: 'unreadable', record: null }), world({ note, record: record('passkey', OTHER_FP) })]) {
      const view = judge(id, seen);
      assert.deepEqual([view.state, view.at, view.parts.every((part) => part.state === 'ticked')], ['done', null, true], id);
    }
  }

  // So no sentence of it says what is so now: what the wallet or the browser holds, where a payment is, what
  // the pot holds, what a screen shows. Each of these was in the table once, and each goes stale.
  const nowEnglish = /\bYou hold\b|\byour wallet (holds|keeps)\b|\bis in a block\b|\bholds your coins\b|\bhas six confirmations\b|\bundo it now\b|\b12 words are on paper\b|\bonly unlock them\b|\bscreen shows\b|\bstill\b|\bnow\b|\btoday\b/i;
  const nowSpanish = /\bTienes monedas\b|\bTu billetera (tiene|no lleva)\b|\bestá en un bloque\b|\bguarda tus monedas\b|\btiene seis confirmaciones\b|\bdeshacerlo ahora\b|\b12 palabras están en papel\b|\bsolo las desbloquean\b|\bmuestra las cifras\b|\btodavía\b|\bahora\b|\bhoy\b/i;
  for (const id of STEPS) {
    assert.doesNotMatch(en[`done_${id}`] ?? '', nowEnglish, id);
    assert.doesNotMatch(es[`done_${id}`] ?? '', nowSpanish, id);
  }

  // Each opens with what the reader did or saw, in the past tense ...
  const opens: Record<StepId, [english: RegExp, spanish: RegExp]> = {
    'hold-some': [/^You got practice coins, and you named the block that took the first of them in\./, /^Recibiste monedas de práctica, y dijiste qué bloque incluyó la primera de ellas\./],
    'pass-it-on': [/^Your payment got into a block, and the pot took your coins\b/, /^Tu pago entró en un bloque, y el fondo común recibió tus monedas\b/],
    'no-balances': [/^You counted the coins in your wallet, and opened one of its payments\b/, /^Contaste las monedas de tu billetera, y abriste uno de sus pagos\b/],
    'waiting-room': [/^Your payment reached six confirmations\b/, /^Tu pago llegó a seis confirmaciones\b/],
    'the-seed': [/^You said you wrote your 12 words on paper, and three of them matched\./, /^Dijiste que escribiste tus 12 palabras en papel, y tres de ellas coincidieron\./],
    'prove-the-backup': [/^The wallet came back from its 12 words, with its coins\. The chain kept them the whole time, and the words only unlocked them\b/, /^La billetera volvió desde sus 12 palabras, con sus monedas\. La cadena las conservó todo el tiempo, y las palabras solo las desbloquearon\b/],
  };
  for (const id of STEPS) {
    assert.match(en[`done_${id}`] ?? '', opens[id][0], id);
    assert.match(es[`done_${id}`] ?? '', opens[id][1], id);
  }
  // ... and rests on what the step's parts were ticked for. A step is done when its last part is ticked, and a
  // part ticks only when every part before it is: so these facts held on the day the note says.
  assert.deepEqual(STEP_DEFS['hold-some'].parts.map((part) => part.on), ['wallet-here', 'coins-seen', 'coin-confirmed', 'block-height']);
  assert.deepEqual(STEP_DEFS['pass-it-on'].parts.map((part) => part.on), ['spendable', 'sent-to-pot', 'payment-confirmed']);
  assert.deepEqual(STEP_DEFS['no-balances'].parts.map((part) => part.on), ['coins-opened', 'coin-count', 'payment-read']);
  assert.deepEqual(STEP_DEFS['waiting-room'].parts.map((part) => part.on), ['sent', 'payment-confirmed', 'six-blocks']);
  assert.deepEqual(STEP_DEFS['the-seed'].parts.map((part) => part.on), ['words-shown', 'written', 'three-words']);
  assert.deepEqual(STEP_DEFS['prove-the-backup'].parts.map((part) => part.on), ['three-words', 'wallet-removed', 'restored-from-words', 'coins-found']);
  // The page saw a payment's screen opened, and cannot see whether anything was read there: "opened ... to see".
  assert.equal(proofOf('no-balances', 3), 'opened');
  assert.doesNotMatch(en['done_no-balances'] ?? '', /\bread what\b/);
  // The paper is the reader's word, said by ticking a box: "You said you wrote".
  assert.equal(proofOf('the-seed', 2), 'said');

  // "Hold some": the page checked one thing in the last part, a number. It is the block of the oldest
  // transaction the wallet received, whichever blocks took later coins in, and the page cannot know where the
  // reader read it: the wallet's own transaction screen shows that number too ("Confirmed in block ..."). So
  // the card says "you named the block that took the first of them in", and never that the explorer showed
  // the reader anything, or that they did not have to take the page's word.
  assert.equal(STEP_DEFS['hold-some'].parts[3]?.kind, 'ask');
  const coins = chain(state([{ tx: 'c1', sats: 100_000, height: 150 }]));
  const blocks = [tx({ tx: 'r3', direction: 'received', height: 160 }), tx({ tx: 'r1', direction: 'received', height: 150 }), tx({ tx: 'r2', direction: 'received', height: 155 })];
  const asked = world({ chain: coins, history: blocks, note: { v: 1, following: 'hold-some', followedAt: NOW, steps: { 'hold-some': { started: true, parts: { 1: true, 2: true, 3: true } } } } });
  assert.deepEqual(['150', '155', '160'].map((typed) => answerBlock(asked, typed)), ['right', 'wrong', 'wrong'], 'the block of the first coin, and no other');
  assert.match(strings.wallet.en.txStatusBlock, /^Confirmed in block \{height\}\.$/);
  assert.doesNotMatch(en['done_hold-some'] ?? '', /explorer showed|did not have to|you (saw|looked|read|checked)\b/i);
  assert.doesNotMatch(es['done_hold-some'] ?? '', /explorador mostró|no tuviste que|\b(viste|miraste|leíste|comprobaste)\b/i);
  // Nor what an explorer shows of that block today: once the practice chain is started again, the block is gone.
  assert.doesNotMatch(en['done_hold-some'] ?? '', /\b(shows|holds|has) that block\b|\bthat block is\b/i);
  assert.doesNotMatch(es['done_hold-some'] ?? '', /\b(muestra|tiene) ese bloque\b|\bese bloque está\b/i);

  // What is not about the reader's own step is about Bitcoin, or about any wallet, and is true whatever
  // happens on the practice network: it is said in general, never of "your wallet" or "your payment".
  assert.match(en['done_hold-some'] ?? '', /\. A block explorer shows a chain to anyone who asks, with no wallet at all, so nobody has to take a wallet's word for what is on it\. On Bitcoin it works the same way: verify, don't trust\.$/);
  assert.match(es['done_hold-some'] ?? '', /\. Un explorador de bloques le muestra una cadena a quien pregunte, sin ninguna billetera, así que nadie tiene que creerle a una billetera lo que hay en la cadena\. En Bitcoin funciona igual: verifica, no confíes\.$/);
  // In the words the step's own guidance taught an explorer with.
  assert.match(en['guide_hold-some_4'] ?? '', /^A block explorer is a website that shows a chain to anyone who asks, with no wallet at all\./);
  assert.match(en['done_no-balances'] ?? '', /\. A wallet keeps no balance: it holds coins, and its total is what they add up to\. A payment uses coins up whole\b/);
  assert.match(es['done_no-balances'] ?? '', /\. Una billetera no lleva ningún saldo: tiene monedas, y su total es lo que suman\. Un pago gasta monedas enteras\b/);
  assert.match(en['done_waiting-room'] ?? '', /\. On Bitcoin, undoing a payment that deep means redoing all six blocks faster than the rest of the network adds new ones\./);
  assert.match(es['done_waiting-room'] ?? '', /\. En Bitcoin, deshacer un pago a esa profundidad exige rehacer los seis bloques\b/);
  // The pot took the coins "to hand on": it is not said to hold them (the faucet hands the oldest on with the
  // next newcomer's payment), and the fee "was". No screen is named that a removed wallet no longer has.
  assert.match(en['done_pass-it-on'] ?? '', /the pot took your coins to hand on to a learner who comes after you\. The fee was what went in less what came out\.$/);
  assert.match(es['done_pass-it-on'] ?? '', /el fondo común recibió tus monedas para pasarlas a alguien que viene después de ti\. La comisión fue lo que entró menos lo que salió\.$/);
  for (const lang of LANGS) {
    for (const id of STEPS) assert.doesNotMatch(strings.doit[lang][`done_${id}`], /\bscreen\b|\bpantalla\b/i, `${lang}.done_${id}`);
  }
});

test('a done "The seed" beside another wallet says what the step\'s note knows: that it has no note of a check for that wallet, never that its paper was not checked', () => {
  assert.equal(en.seedOther, 'Another wallet is in this browser now ({here}). This step has no note of a check for it: type three of its words to check it too.');
  assert.equal(
    es.seedOther,
    'Ahora hay otra billetera en este navegador ({here}). Este paso no tiene anotada ninguna comprobación para ella: escribe tres de sus palabras para comprobarla también.',
  );
  for (const lang of LANGS) assert.deepEqual(slotNames(strings.doit[lang].seedOther), ['here'], lang);
  // It is drawn where the wallet here is not the one the step's note names, with that wallet's fingerprint.
  const card = source('src/screens/doit/Done.svelte');
  assert.match(card, /let seed = \$derived\(id === 'the-seed' \? seedWallet\(doit\.seen\(now\)\) : 'none'\);/);
  assert.match(card, /\{:else if id === 'the-seed' && seed === 'other'\}[\s\S]*?<Sentence text=\{t\.seedOther\} slots=\{\{ here: wallet\.record\?\.fingerprint \?\? '' \}\} mono=\{\['here'\]\} \/>/);
  assert.equal(card.match(/t\.seedOther\b/g)?.length, 1);

  // What the note keeps of the check is one wallet fingerprint, and the next check takes its place.
  const coins = chain(state([{ tx: 'c1', sats: 50_000 }]));
  let seeded: Progress = applyChange(emptyProgress(), { kind: 'open', step: 'the-seed', at: NOW, from: null });
  for (const part of [1, 2]) seeded = applyChange(seeded, { kind: 'tick', step: 'the-seed', part, at: NOW });
  seeded = applyChange(seeded, { kind: 'tick', step: 'the-seed', part: 3, at: NOW, wallet: FP });
  assert.deepEqual(seeded.steps['the-seed'], { started: true, doneAt: NOW, wallet: FP, parts: { 1: true, 2: true, 3: true } });
  const again = rechecked(world({ note: seeded, record: record('words', OTHER_FP) }));
  assert.deepEqual(again, { kind: 'checked', step: 'the-seed', wallet: OTHER_FP });
  const twice = applyChange(seeded, again ?? { kind: 'stop', step: 'the-seed' });
  assert.equal(twice.steps['the-seed']?.wallet, OTHER_FP);
  assert.ok(!JSON.stringify(twice).includes(FP), 'nothing of the first check is kept');
  // The first wallet is back in this browser. Its three words were checked, and the note no longer says so:
  // to the card it is "another wallet". So the card may say that it has no note of a check, and never that
  // the paper of that wallet was not checked.
  assert.equal(seedWallet(world({ note: twice, record: record('words', FP) })), 'other');
  assert.doesNotMatch(en.seedOther ?? '', /has not been checked|was not checked|never (been )?checked|\bIts paper\b/);
  assert.doesNotMatch(es.seedOther ?? '', /no se ha comprobado|no se comprobó|nunca se comprobó|\bSu papel\b/);

  // "This step", not "this page". The drill keeps a note of its own paper check, with the wallet fingerprint
  // it was passed for. With "The seed" done for one wallet and the drill's paper check passed for the wallet
  // that is here, the note of the steps does name a check for it: "this page has no note" would be untrue.
  let both = applyChange(seeded, { kind: 'open', step: 'prove-the-backup', at: NOW, from: null });
  const tick = answered('prove-the-backup', world({ note: both, record: record('words', OTHER_FP), chain: coins }));
  assert.deepEqual(tick, { kind: 'tick', step: 'prove-the-backup', part: 1, at: NOW, wallet: OTHER_FP, was: 'words' });
  both = applyChange(both, tick ?? { kind: 'stop', step: 'the-seed' });
  assert.equal(both.steps['prove-the-backup']?.wallet, OTHER_FP, 'the drill\'s note names the wallet that is here');
  assert.equal(seedWallet(world({ note: both, record: record('words', OTHER_FP), chain: coins })), 'other', 'and the card of "The seed" speaks of another wallet');
  assert.match(en.seedOther ?? '', /\)\. This step has no note of a check for it: /);
  assert.match(es.seedOther ?? '', /\)\. Este paso no tiene anotada ninguna comprobación para ella: /);
  assert.doesNotMatch(en.seedOther ?? '', /\bthis page\b/i);
  assert.doesNotMatch(es.seedOther ?? '', /\besta página\b/i);
  // The step's own note holds one fingerprint, so of the step it is always true where the card draws it.
  for (const here of [FP, OTHER_FP]) {
    for (const noted of [seeded, twice, both]) {
      const beside = seedWallet(world({ note: noted, record: record('words', here), chain: coins }));
      assert.equal(beside === 'other', noted.steps['the-seed']?.wallet !== here, `${here}, ${noted.steps['the-seed']?.wallet}`);
    }
  }
});

test('a done "The seed", after the check was passed again: "checked for the wallet that is here" is drawn only while the wallet here is the one the note names', () => {
  assert.equal(en.seedRechecked, 'Checked. The three words are now checked for the wallet that is here.');
  assert.equal(es.seedRechecked, 'Comprobado. Las tres palabras quedan comprobadas para la billetera que está aquí.');
  // The line is in the present tense about the wallet that is here, so it follows the wallet: the flag that the
  // check was passed on this screen is not enough. It stays set for the rest of the visit, and another tab can
  // put another wallet in this browser meanwhile.
  const card = source('src/screens/doit/Done.svelte');
  assert.match(
    card,
    /\{#if id === 'the-seed' && rechecked && seed === 'same'\}\s*<Notice kind="info" text=\{t\.seedRechecked\} data-testid="step-seed-rechecked" \/>\s*\{:else if id === 'the-seed' && seed === 'other'\}/,
  );
  assert.equal(card.match(/t\.seedRechecked\b/g)?.length, 1, 'drawn in one place, under that condition');
  assert.doesNotMatch(card, /\{#if id === 'the-seed' && rechecked\}/);
  assert.match(card, /<AskWords \{id\} mode="again" onpassed=\{\(\) => \(rechecked = true\)\} \/>/);

  // What "same" rests on. The check passed again writes the wallet that is here into the step's note ...
  let noted: Progress = applyChange(emptyProgress(), { kind: 'open', step: 'the-seed', at: NOW, from: null });
  for (const part of [1, 2]) noted = applyChange(noted, { kind: 'tick', step: 'the-seed', part, at: NOW });
  noted = applyChange(noted, { kind: 'tick', step: 'the-seed', part: 3, at: NOW, wallet: FP });
  const here = world({ note: noted, record: record('words', OTHER_FP) });
  assert.equal(seedWallet(here), 'other', 'before the check: another wallet');
  noted = applyChange(noted, rechecked(here) ?? { kind: 'stop', step: 'the-seed' });
  assert.equal(seedWallet(world({ note: noted, record: record('words', OTHER_FP) })), 'same', 'after it: the line is true, and drawn');
  // ... and from then on the answer follows the wallet in this browser. The first wallet put back by another tab:
  // the line about another wallet takes its place by itself. No wallet, or a storage nobody could read: neither line.
  assert.equal(seedWallet(world({ note: noted, record: record('passkey', FP) })), 'other');
  assert.equal(seedWallet(noWallet({ note: noted })), 'none');
  for (const status of ['unreadable', 'newer', 'broken', 'blocked'] as const) assert.equal(seedWallet(world({ note: noted, status, record: null })), 'none', status);
  // The wallet the line was said of is back: it is true again.
  assert.equal(seedWallet(world({ note: noted, record: record('passkey', OTHER_FP) })), 'same');
});

test('"Forget my progress" speaks of this site, not of the whole browser; over a stored value that is no note, the list says what About says of it', () => {
  // -- What is erased, and what is kept afterwards: said of this site, in this browser. --
  assert.equal(en.forgetWarn, 'Every tick and every finished step is erased from what this site keeps in this browser. Your wallet and its coins are not touched, and each step can be done again.');
  assert.equal(en.forgotten, 'Your "Do it" progress was forgotten. This site keeps none of it in this browser now.');
  assert.equal(es.forgetWarn, 'Cada marca y cada paso terminado se borra de lo que este sitio guarda en este navegador. Tu billetera y sus monedas no se tocan, y cada paso se puede volver a hacer.');
  assert.equal(es.forgotten, 'Tu progreso de "Hazlo" se olvidó. Este sitio ya no guarda nada de él en este navegador.');
  // Of this browser, in both sentences. The button erases the note stored here and nothing else. While counting
  // is on, each opening of a step's screen and each finished step was counted when it happened (a test above
  // holds that), and a count is passed on with the IP address of its request: none of that is in this browser,
  // and none of it is erased. So the line after the button keeps the scope the warning before it has, and never
  // says "keeps none of it" alone.
  for (const lang of LANGS) {
    for (const key of ['forgetWarn', 'forgotten'] as const) {
      assert.match(strings.doit[lang][key], lang === 'en' ? /\bthis site keeps\b[^.]*\bin this browser\b/i : /\beste sitio (ya no )?guarda\b[^.]*\ben este navegador\b/i, `${lang}.${key}`);
    }
  }
  assert.doesNotMatch(en.forgotten ?? '', /keeps none of it now\b/);
  assert.doesNotMatch(es.forgotten ?? '', /nada de él\.$/);
  // Never of the browser as a whole. "Forget my progress" deletes one value of this site's own storage. The
  // link back of a done step ends "#done=" and then the done steps of its chapter, which is what the main site
  // marks those steps' cards on: that mark is the main site's, in its own storage in the same browser, where
  // this site cannot reach.
  assert.doesNotMatch(en.forgetWarn ?? '', /erased from this browser\b/);
  assert.doesNotMatch(en.forgotten ?? '', /This browser keeps none\b/);
  assert.doesNotMatch(es.forgetWarn ?? '', /se borra de este navegador\b/);
  assert.doesNotMatch(es.forgotten ?? '', /Este navegador ya no guarda\b/);
  for (const lang of LANGS) {
    for (const key of ['forgetWarn', 'forgotten'] as const) assert.match(strings.doit[lang][key], lang === 'en' ? /\bthis site keeps\b/i : /\beste sitio (ya no )?guarda\b/i, `${lang}.${key}`);
  }
  const kept = new MemoryStorage();
  kept.map.set(PROGRESS_KEY, JSON.stringify({ v: 1, following: null, steps: { 'hold-some': { started: true, doneAt: NOW } } }));
  kept.map.set(RECORD_KEY, 'the wallet');
  kept.map.set('another-key', 'not ours');
  assert.equal(forgetProgress(kept as Storage), true);
  assert.deepEqual([...kept.map.keys()].sort(), [RECORD_KEY, 'another-key'].sort(), 'exactly the note is erased');
  // The question shows the first, the list and the status region the second.
  const list = source('src/screens/Do.svelte');
  assert.match(list, /<p id="\{uid\}-forget-what">\{t\.forgetWarn\}<\/p>/);
  assert.match(list, /\{#if forgotten\}\s*<Notice kind="info" text=\{t\.forgotten\} data-testid="do-forgotten" \/>\s*\{\/if\}/);
  assert.match(list, /forgotten = true;\s*announce\(t\.forgotten\);/);
  // "None of it" is said only while nothing is stored where the note goes: the line goes as soon as the
  // storage holds something again (a note, or anything else another tab left there), or cannot be read.
  assert.match(list, /\$effect\(\(\) => \{\s*if \(doit\.read !== 'none'\) forgotten = false;\s*\}\);/);

  // -- A stored value that is no note this version can read. --
  assert.equal(en.forgetUnreadable, 'Something is stored where the note of your "Do it" progress goes, and this page cannot read it. "Forget my progress" erases it.');
  assert.equal(es.forgetUnreadable, 'Hay algo guardado donde va la nota de tu progreso de "Hazlo", y esta página no puede leerlo. "Olvidar mi progreso" lo borra.');
  // In the words About uses of the same browser, and then what the button under it does, quoted as it is drawn.
  assert.equal(en.forgetUnreadable, `${strings.about.en.noteUnreadableNow} "${en.forget}" erases it.`);
  assert.equal(es.forgetUnreadable, `${strings.about.es.noteUnreadableNow} "${es.forget}" lo borra.`);
  // It does: for every stored text that is no note, the button's action removes it, and leaves the rest.
  for (const text of ['not a note {', '[1]', '7', '""', '{"v":0}', '{}', '{"v":"1","steps":{}}', '']) {
    const storage = new MemoryStorage();
    storage.map.set(PROGRESS_KEY, text);
    storage.map.set(RECORD_KEY, 'the wallet');
    assert.equal(readProgress(storage as Storage).state, 'unreadable', text);
    assert.equal(forgetProgress(storage as Storage), true, text);
    assert.deepEqual([...storage.map.keys()], [RECORD_KEY], text);
  }
  // The sentence written for a note names what a note holds ("which steps you have opened and done, which
  // parts are ticked ..."). Over a value nobody has read it would describe nothing: so it is drawn for a note
  // that was read, and this one in its place otherwise. "Forget my progress" is offered under both.
  assert.match(list, /let canForget = \$derived\(stated && \(doit\.read === 'kept' \|\| doit\.read === 'unreadable'\)\);/);
  assert.match(list, /\{#if doit\.read === 'unreadable'\}\s*<!--[^>]*-->\s*<p class="[^"]*" data-testid="do-forget-unreadable">\{t\.forgetUnreadable\}<\/p>\s*\{:else\}\s*<p class="[^"]*" data-testid="do-forget-what">\{t\.forgetWhat\}<\/p>\s*\{\/if\}/);
  assert.doesNotMatch(en.forgetUnreadable ?? '', /keeps a note|which steps|ticked|wallet fingerprint|payment/);
  assert.doesNotMatch(es.forgetUnreadable ?? '', /guarda una nota|qué pasos|marcadas|huella|pago/);
});

test('the open part draws the way on for a reader with a wallet elsewhere, and for one with no paper copy; the step hides "Start this step again" by its rule', () => {
  const part = source('src/screens/doit/OpenPart.svelte');
  // Under the link of a need: one more sentence, with a plain link of its own.
  assert.match(
    part,
    /\{#if need\.also !== undefined\}[\s\S]*?<p [^>]*data-testid="step-need-also">\s*\{t\[need\.also\.text\]\}\s*<TextLink href=\{hrefOf\(need\.also\.action\)\} data-testid="step-need-also-link" onclick=\{\(\) => doit\.follow\(id\)\}>/,
  );
  // Over the three word fields of the drill: where a paper copy is made.
  assert.match(part, /let paper = \$derived\(paperHelp\(id, part, doit\.progress\)\);/);
  assert.match(part, /\{:else if ask === 'words'\}\s*\{#if paper !== null\}[\s\S]*?data-testid="step-paper"[\s\S]*?\{\/if\}\s*<AskWords \{id\} onpassed=\{onticked\} \/>/);
  const body = source('src/screens/doit/StepBody.svelte');
  assert.match(body, /let restartable = \$derived\(canRestart\(view, doit\.kept, wallet\.status\)\);/);
  assert.match(body, /\{#if restartable\}\s*<Button variant="quiet" class="w-full sm:w-auto" data-testid="step-restart"/);
  assert.match(body, /\{#if part\.state === 'ticked' && checkedInSeed\(id, number, doit\.progress\)\}[\s\S]*?data-testid="step-checked-in-seed"/);
  // The done card's first line is a heading, so that "What the restore changed" under it is one level down and no level is jumped.
  const done = source('src/screens/doit/Done.svelte');
  assert.match(done, /<h2 class="[^"]*" data-testid="step-done-on">\{day\}<\/h2>/);
  assert.match(done, /<h3 class="[^"]*">\{t\.changedTitle\}<\/h3>/);
  assert.ok(done.indexOf('data-testid="step-done-on"') < done.indexOf('{t.changedTitle}'));
});

// -- short, with facts as slots ---------------------------------------------------------------

test('a lede is two sentences at most, a part\'s guidance one or two; "Hold some" may say three', () => {
  for (const lang of LANGS) {
    const t: Table = strings.doit[lang];
    for (const id of STEPS) {
      assert.ok(sentences(t[`lede_${id}`] ?? '').length <= 2, `${lang}.lede_${id}`);
      assert.ok(sentences(t[`done_${id}`] ?? '').length <= 3, `${lang}.done_${id}`);
      for (const key of Object.keys(t).filter((each) => each.startsWith(`guide_${id}_`))) {
        const count = sentences(t[key] ?? '').length;
        assert.ok(count >= 1 && count <= (id === 'hold-some' ? 3 : 2), `${lang}.${key} has ${count} sentences`);
      }
    }
  }
});

test('facts are slots: no setting is typed into a sentence, and the few numbers that are typed are Bitcoin\'s or the design\'s', () => {
  const { electrumHost, explorerUrl, siteUrl, sourceUrl, faucetSats, blockSeconds } = DEFAULT_CONFIG;
  const settings = [electrumHost, new URL(explorerUrl).host, new URL(siteUrl).host, new URL(sourceUrl).host, String(faucetSats), faucetSats.toLocaleString('en-US')];
  // 1 second and 1 confirmation; chapters 2, 3 and 4; section 7 of chapter 4; 10 minutes between Bitcoin's blocks; the 12 words.
  const typed = new Set(['1', '2', '3', '4', '7', '10', '12']);
  for (const { where, text } of everyText()) {
    for (const setting of settings) assert.ok(!text.includes(setting), `${where} spells out ${setting}`);
    assert.doesNotMatch(text, new RegExp(`\\b${blockSeconds} (seconds|segundos|s)\\b`), where);
    assert.doesNotMatch(text, /https?:|www\.|\b[a-z0-9-]+\.(com|org|net|io|dev|test)\b/i, where);
    for (const hit of text.replace(/\{[A-Za-z]+\}/g, '').matchAll(/[0-9][0-9,.]*/g)) {
      assert.ok(typed.has(hit[0].replace(/[.,]$/, '')), `${where} has the number ${hit[0]} typed into it`);
    }
  }
});

test('the house words: unconfirmed, wallet fingerprint, removed, no prices, no cheering, and the site\'s Spanish', () => {
  for (const { where, lang, key, text } of everyText()) {
    assert.doesNotMatch(text, /\bpending\b|\bpendiente/i, where);
    // The word is never bare. A slot's own name is not text the reader sees.
    const said = text.replace(/\{[A-Za-z]+\}/g, '');
    if (lang === 'en') {
      for (const hit of said.matchAll(/\S*\s?fingerprints?/gi)) assert.match(hit[0], /^wallet fingerprints?$/i, where);
    } else {
      for (const hit of said.matchAll(/huellas?(\s+\S+){0,3}/gi)) assert.match(hit[0], /^huellas? de la billetera/i, where);
    }
    // A wallet is removed, never deleted; the note is forgotten or erased.
    assert.doesNotMatch(text, /\bdelet|\belimin/i, where);
    assert.doesNotMatch(text, /[$€]|\bBTC\b|\bUSD\b|\bcrypto|\bcripto/i, where);
    assert.doesNotMatch(text, /\b(great|awesome|congratulations|well done|simply|seamless|effortless|powerful|robust)\b/i, where);
    assert.doesNotMatch(text, /\b(genial|felicidades|simplemente)\b/i, where);
    // "Just" as a minimizer has no place. The one "just" is in the heading the spec names, and where a sentence quotes it.
    if (key !== 'explainTitle') assert.doesNotMatch(text.replaceAll(`"${en.explainTitle}"`, ''), /\bjust\b/i, where);
    // No account words.
    assert.doesNotMatch(text, /\b(account|sign in|sign up|log in|password|username)\b/i, where);
    // ("Cuenta tus monedas" is the verb: count your coins.)
    assert.doesNotMatch(text, /\b(una|tu|su|la|de|mi) cuenta\b|\b(iniciar sesión|contraseña|usuario)\b/i, where);
  }
  const spanish = Object.values(es).join('\n');
  assert.doesNotMatch(spanish, /\b(cartera|monedero|copia de seguridad|tarifa|fallo|ordenador|móvil)\b/i);
  // A passkey is "llave de acceso"; a Bitcoin key is a "clave".
  for (const hit of spanish.matchAll(/\bllaves?\b(\s+\S+){0,2}/gi)) assert.match(hit[0], /^llaves? de acceso/i, hit[0]);
  assert.match(spanish, /fondo común/);
  assert.match(spanish, /monedas de práctica/);
  assert.match(spanish, /sala de espera/);
  assert.match(spanish, /tasa de comisión/);
  // Whole sentences differ between the two tables.
  for (const key of Object.keys(en)) {
    if ((en[key] ?? '').split(' ').length >= 4) assert.notEqual(es[key], en[key], key);
  }
});

// -- what other screens gain: the progress stays when the wallet goes ---------------------------

test('Remove\'s question, Home\'s "removed" line and Settings each gain the sentence, and show it while a note is kept', () => {
  for (const key of ['staysOnRemove', 'staysAfterRemove', 'keepsProgress']) {
    // It stays until "Forget my progress"; it can name the wallet by its wallet fingerprint, and a payment.
    assert.match(en[key] ?? '', /until you choose "Forget my progress" on the Do it screen/, key);
    assert.match(en[key] ?? '', /by its wallet fingerprint and, for a step that is not finished, the payment it waits for\.$/, key);
    assert.match(es[key] ?? '', /hasta que elijas "Olvidar mi progreso" en la pantalla Hazlo/, key);
    assert.match(es[key] ?? '', /por su huella de la billetera y, en un paso sin terminar, el pago que ese paso espera\.$/, key);
  }
  assert.equal(es.forget, 'Olvidar mi progreso');
  assert.match(en.staysOnRemove ?? '', /^Your "Do it" progress is not removed with the wallet\./);
  assert.match(en.staysAfterRemove ?? '', /^Your "Do it" progress is still in this browser/);
  // Each screen draws it only while a note is stored, and under a hook of its own.
  const remove = source('src/screens/keys/RemoveWallet.svelte');
  assert.match(remove, /<p id="\{id\}-back" data-testid="remove-back">[^\n]*\n[\s\S]*?\{#if progressKept\(doit\.read\)\}\s*<p data-testid="remove-progress">\{d\.staysOnRemove\}<\/p>\s*\{\/if\}/);
  const home = source('src/screens/Home.svelte');
  assert.match(home, /\{#if removed && progressKept\(doit\.read\)\}[\s\S]*?<Notice kind="info" text=\{d\.staysAfterRemove\} data-testid="home-progress-stays">/);
  const settings = source('src/screens/Settings.svelte');
  assert.match(settings, /\{#if progressKept\(doit\.read\)\}\s*<li data-testid="keeps-progress">\{d\.keepsProgress\}<\/li>\s*\{\/if\}\s*<\/ul>/);
});

test('Home has a short "Do it" section that leads to the list, and the Overview one line', () => {
  const home = source('src/screens/Home.svelte');
  assert.match(home, /<Section title=\{d\.name\}>[\s\S]*?<p data-testid="home-do">\{d\.homeBody\}<\/p>[\s\S]*?href=\{router\.link\(\{ name: 'do' \}\)\} data-testid="home-do-link">\{d\.homeLink\}/);
  const overview = source('src/screens/Overview.svelte');
  assert.match(overview, /<p [^>]*data-testid="overview-do">\s*\{d\.overviewLine\}\s*<TextLink href=\{router\.link\(\{ name: 'do' \}\)\} data-testid="overview-do-link">\{d\.overviewLink\}<\/TextLink>/);
  for (const lang of LANGS) {
    assert.equal(sentences(strings.doit[lang].homeBody).length, 1, lang);
    assert.equal(sentences(strings.doit[lang].overviewLine).length, 1, lang);
  }
});

// -- About lists the note, and the note is what About lists ----------------------------------------

test('About, "what this browser keeps": the note of the steps holds the fields the page lists, and no other', () => {
  // A note with everything a note can hold, made by the one write function's own rules.
  let progress: Progress = emptyProgress();
  const apply = (change: Parameters<typeof applyChange>[1]): void => {
    progress = applyChange(progress, change);
  };
  apply({ kind: 'open', step: 'waiting-room', at: NOW, from: '/journey/how-bitcoin-works' });
  apply({ kind: 'tick', step: 'waiting-room', part: 1, at: NOW, tx: txid('a1'), sentAt: NOW });
  apply({ kind: 'open', step: 'prove-the-backup', at: NOW, from: null });
  apply({ kind: 'tick', step: 'prove-the-backup', part: 1, at: NOW, wallet: FP, was: 'passkey' });
  // The reader came from chapter 3 for "The waiting room", and a need of that step sends them to "Hold some" first.
  apply({ kind: 'detour', step: 'hold-some', cameFor: 'waiting-room' });
  apply({ kind: 'open', step: 'hold-some', at: NOW, from: null });
  for (const part of [1, 2, 3, 4]) apply({ kind: 'tick', step: 'hold-some', part, at: NOW });
  const stored = parseProgress(JSON.stringify(progress)).progress;
  assert.deepEqual(Object.keys(stored).sort(), ['followedAt', 'following', 'steps', 'v'], 'what a note holds changed: read About, "What this browser keeps", again');
  const fields = new Set(Object.values(stored.steps).flatMap((note) => Object.keys(note ?? {})));
  assert.deepEqual([...fields].sort(), ['cameFor', 'doneAt', 'from', 'parts', 'sentAt', 'started', 'tx', 'wallet', 'was'], 'what a step\'s note holds changed: read About, "What this browser keeps", again');

  // The page says each of them, in its own words.
  const about = strings.about.en;
  assert.equal(about.keepNote, 'The note of your "Do it" progress holds:');
  // started, parts, doneAt
  assert.equal(about.keepNoteSteps, 'Which steps you have opened, which parts of each are ticked, and the time each step was done.');
  // following, followedAt
  assert.equal(about.keepNoteFollowing, 'Which step you are following, and when you last followed it.');
  // from: never free text. For each step it is the English or the Spanish page of the step's own chapter, or it
  // is not there, and the page says exactly that.
  assert.equal(about.keepNoteFrom, 'Whether you came to a step from the English or the Spanish page of its chapter, so that "Back to the chapter" leads to that page.');
  assert.equal(
    strings.about.es.keepNoteFrom,
    'Desde cuál de las dos páginas de su capítulo llegaste a un paso, la que está en inglés o la que está en español, para que "Volver al capítulo" lleve a esa página.',
  );
  assert.equal(stored.steps['waiting-room']?.from, '/journey/how-bitcoin-works');
  for (const id of STEPS) {
    const { en: english, es: spanish } = STEP_DEFS[id].chapter.path;
    // Whatever a stored note says its way back is, what is read of it is one of those two pages or nothing.
    const said = [english, spanish, `${english}/`, '/newsletter', '/', '/journey', 'https://www.learnbitcoin.com/journey', 'anything a link might carry', ...STEPS.flatMap((other) => Object.values(STEP_DEFS[other].chapter.path))];
    for (const from of said) {
      const read = parseProgress(JSON.stringify({ v: 1, following: null, steps: { [id]: { started: true, from } } })).progress.steps[id];
      assert.deepEqual(read, from === english || from === spanish ? { started: true, from } : { started: true }, `${id}: ${from}`);
      // And what a step's address says is taken by the same rule when the step is opened.
      const opened = applyChange(emptyProgress(), { kind: 'open', step: id, at: NOW, from }).steps[id];
      assert.deepEqual(opened, read, `${id}: ${from}`);
    }
  }
  // No sentence of the page still speaks of "the page of LearnBitcoin you came from" as if any page could be noted.
  for (const lang of LANGS) {
    for (const [key, text] of Object.entries(strings.about[lang] as Table)) {
      assert.doesNotMatch(text, /The page of LearnBitcoin you came|La página de LearnBitcoin desde la que llegaste/, `about.${lang}.${key}`);
    }
  }
  // cameFor: the step the reader came for. The line, word for word, in both languages.
  assert.equal(
    about.keepNoteCameFor,
    'If you came from a chapter and a step sent you to another step first: the step you came for, so that the other step can lead you back to it and "Back to the chapter" leads to the chapter you came from. It is erased when the step you came for is done.',
  );
  assert.equal(
    strings.about.es.keepNoteCameFor,
    'Si llegaste desde un capítulo y un paso te envió primero a otro paso: el paso por el que venías, para que el otro paso pueda llevarte de vuelta a él y "Volver al capítulo" lleve al capítulo del que venías. Se borra cuando el paso por el que venías se termina.',
  );
  // It names the link by the words on the link.
  for (const lang of LANGS) assert.ok(strings.about[lang].keepNoteCameFor.includes(`"${strings.doit[lang].back}"`), lang);
  // "The step you came for": the note of the step the reader was sent to names it, and it is one of the six steps and nothing else.
  assert.equal(stored.steps['hold-some']?.cameFor, 'waiting-room');
  for (const id of STEPS) {
    const said = [...STEPS, 'first-payment', 'The waiting room', '/journey/how-bitcoin-works', 'anything a link might carry', 7, null, true];
    for (const cameFor of said) {
      const read = parseProgress(JSON.stringify({ v: 1, following: null, steps: { [id]: { started: true, cameFor } } })).progress.steps[id];
      const counts = (STEPS as readonly unknown[]).includes(cameFor) && cameFor !== id;
      assert.deepEqual(read, counts ? { started: true, cameFor } : { started: true }, `${id}: ${String(cameFor)}`);
    }
  }
  // "If you came from a chapter": for a reader who opened the step from the wallet's own list, nothing is noted.
  let listed: Progress = applyChange(emptyProgress(), { kind: 'open', step: 'waiting-room', at: NOW, from: null });
  listed = applyChange(listed, { kind: 'detour', step: 'hold-some', cameFor: 'waiting-room' });
  assert.deepEqual(listed.steps, { 'waiting-room': { started: true } });
  assert.doesNotMatch(JSON.stringify(listed), /cameFor/);
  // "It is erased when the step you came for is done": by the write that finishes that step.
  let ended = progress;
  for (const part of [2, 3]) {
    assert.equal(ended.steps['hold-some']?.cameFor, 'waiting-room', `before part ${part}`);
    ended = applyChange(ended, { kind: 'tick', step: 'waiting-room', part, at: NOW + part });
  }
  assert.ok(ended.steps['waiting-room']?.doneAt !== undefined);
  assert.equal(ended.steps['hold-some']?.cameFor, undefined);
  assert.doesNotMatch(JSON.stringify(ended), /cameFor/);
  // wallet, was
  // "From the drill on": the note keeps how the wallet was opened after the drill is done, for the card that says what the restore changed.
  assert.match(about.keepNoteWallet, /the wallet fingerprint of the wallet they were checked for and, from the drill on, whether this browser opened that wallet with a passkey or with its words\.$/);
  assert.match(strings.about.es.keepNoteWallet, /desde el ejercicio en adelante/);
  for (const part of [1, 2, 3, 4]) apply({ kind: 'tick', step: 'prove-the-backup', part, at: NOW, wallet: FP, was: 'passkey' });
  assert.deepEqual(parseProgress(JSON.stringify(progress)).progress.steps['prove-the-backup'], { started: true, doneAt: NOW, was: 'passkey', parts: { 1: true, 2: true, 3: true, 4: true } });
  // tx, sentAt, and that both go when the step is done
  assert.match(about.keepNotePayment, /that payment's transaction ID and the time it was sent\. Both are erased when the step is done\.$/);
  assert.ok(stored.steps['hold-some']?.doneAt !== undefined && stored.steps['hold-some']?.tx === undefined);
  // Never a word, a key or an answer; and it stays when the wallet goes.
  assert.equal(about.keepNoteNever, 'The note never holds one of the 12 words, a key or an answer you typed. Removing the wallet leaves it in place: "Forget my progress" on the Do it screen erases it.');
  assert.match(strings.about.es.keepNoteNever, /^La nota nunca contiene ninguna de las 12 palabras, ninguna clave ni ninguna respuesta que hayas escrito\./);
  // The screen draws them as a list, under the list of what the wallet's record holds.
  const screen = source('src/screens/About.svelte');
  assert.match(
    screen,
    /<p data-testid="about-note">\{t\.keepNote\}<\/p>\s*<ul data-testid="about-note-fields">\s*<li>\{t\.keepNoteSteps\}<\/li>\s*<li>\{t\.keepNoteFollowing\}<\/li>\s*<li>\{t\.keepNoteFrom\}<\/li>\s*<li>\{t\.keepNoteCameFor\}<\/li>\s*<li>\{t\.keepNoteWallet\}<\/li>\s*<li>\{t\.keepNotePayment\}<\/li>\s*<\/ul>\s*<p data-testid="about-note-never">\{t\.keepNoteNever\}<\/p>/,
  );
});

test('About, "in this browser right now": never "Nothing" while something is stored where the note goes, readable or not', () => {
  const kinds = Object.keys(KEPT_KEYS) as KeptNow[];
  for (const kind of kinds) {
    // Nothing stored for the steps: the line about the wallet's record alone, as before.
    assert.deepEqual(keptNowLines(kind, 'none'), { text: KEPT_KEYS[kind], also: null }, kind);
  }
  // What counts as which: a note of this version or of a newer one is a note; something that is no note this
  // version can read is said to be exactly that; nothing stored is "none". A storage this page was not let
  // look into is none of these: it is "blocked", and the line then says that the page cannot tell
  // (test/storage-blocked.test.ts holds that state, in every pair, to its one sentence).
  assert.deepEqual(
    (['none', 'kept', 'unreadable', 'newer', 'blocked'] as const).map((read) => noteNow(read)),
    ['none', 'kept', 'unreadable', 'kept', 'blocked'],
  );

  // -- A note --
  // No wallet and a note: one sentence that says both.
  assert.deepEqual(keptNowLines('none', 'kept'), { text: 'noteOnlyNow', also: null });
  assert.match(strings.about.en.noteOnlyNow, /^No practice wallet\. This browser keeps only the note of your "Do it" progress\.$/);
  assert.doesNotMatch(strings.about.en.noteOnlyNow, /^Nothing/);
  // A wallet (or something in its place) and a note: the wallet's line, then that the note is kept too.
  // A browser that failed the self-test is one of these: the steps keep their note there as anywhere
  // (test/info-kept.test.ts runs the engine and the steps in that state).
  for (const kind of ['passkey', 'words', 'unreadable', 'newer', 'broken'] as const) {
    assert.deepEqual(keptNowLines(kind, 'kept'), { text: KEPT_KEYS[kind], also: 'noteAlsoNow' }, kind);
  }
  assert.equal(strings.about.en.noteAlsoNow, 'This browser also keeps the note of your "Do it" progress.');
  // Its own line therefore speaks of the wallet only: the page does read and store the note in that state.
  assert.equal(strings.about.en.keepNowBroken, "Not known. This browser failed the wallet's self-test, so this page does not read or store a wallet here.");
  assert.equal(strings.about.es.keepNowBroken, 'No se sabe. Este navegador no pasó la comprobación interna de la billetera, así que esta página no lee ni guarda ninguna billetera aquí.');

  // -- Something stored in the note's place that is no note this version can read --
  // It has a sentence of its own, as an unreadable record of the wallet has: after the wallet's line, or after
  // "No practice wallet." where there is none. Never "Nothing": the key holds text, and the list of steps
  // offers "Forget my progress" for it.
  assert.deepEqual(keptNowLines('none', 'unreadable'), { text: 'noWalletNow', also: 'noteUnreadableNow' });
  for (const kind of ['passkey', 'words', 'unreadable', 'newer', 'broken'] as const) {
    assert.deepEqual(keptNowLines(kind, 'unreadable'), { text: KEPT_KEYS[kind], also: 'noteUnreadableNow' }, kind);
  }
  assert.equal(strings.about.en.noteUnreadableNow, 'Something is stored where the note of your "Do it" progress goes, and this page cannot read it.');
  assert.equal(strings.about.es.noteUnreadableNow, 'Hay algo guardado donde va la nota de tu progreso de "Hazlo", y esta página no puede leerlo.');
  assert.equal(strings.about.en.noWalletNow, 'No practice wallet.');
  assert.equal(strings.about.es.noWalletNow, 'Ninguna billetera de práctica.');
  // The same words as the first sentence of the line for a browser with no wallet and a note.
  assert.ok(strings.about.en.noteOnlyNow.startsWith(`${strings.about.en.noWalletNow} `));
  assert.ok(strings.about.es.noteOnlyNow.startsWith(`${strings.about.es.noWalletNow} `));
  // The stored texts that get there, read by the note's own reader; and each is what the list of steps may erase.
  for (const text of ['not json', '[1]', '{"v":"1","steps":{}}', '{"v":0,"steps":{"the-seed":{"wallet":"73c5da0a"}}}', '{}', '']) {
    assert.equal(noteNow(parseProgress(text).state), 'unreadable', text);
  }
  assert.equal(noteNow(parseProgress(null).state), 'none');
  assert.equal(noteNow(parseProgress('{"v":1}').state), 'kept');
  assert.equal(noteNow(parseProgress('{"v":2}').state), 'kept');
  assert.match(source('src/screens/Do.svelte'), /let canForget = \$derived\(stated && \(doit\.read === 'kept' \|\| doit\.read === 'unreadable'\)\);/);

  // -- In every state --
  // "Nothing" is said in one case only: no wallet, and nothing stored where the note goes.
  for (const lang of LANGS) {
    const table: Table = strings.about[lang];
    for (const kind of kinds) {
      for (const note of ['none', 'kept', 'unreadable', 'blocked'] as const) {
        const lines = keptNowLines(kind, note);
        const said = [table[lines.text], lines.also === null ? '' : table[lines.also]].join(' ');
        assert.equal(/\bnothing\b|\bnada\b/i.test(said), kind === 'none' && note === 'none', `${lang}, ${kind}, ${note}: ${said}`);
        // And whenever something is known to be stored in the note's place, the line names the note. (Where
        // the page was not let read the storage, it names nothing as kept: it says that it cannot tell.)
        assert.equal(/"Do it"|"Hazlo"/.test(said), note !== 'none' && !notKnown(kind, note), `${lang}, ${kind}, ${note}: ${said}`);
      }
    }
  }
  const screen = source('src/screens/About.svelte');
  assert.match(screen, /let note = \$derived\(noteNow\(doit\.read\)\);/);
  assert.match(screen, /let keptLines = \$derived\(kept === null \? null : keptNowLines\(kept, note\)\);/);
  assert.match(screen, /let also = \$derived\(keptLines\?\.also \?\? null\);/);
  assert.match(screen, /\{#snippet alsoNote\(\)\}\s*\{#if also !== null\}\s*<p data-testid="about-kept-note">\{t\[also\]\}<\/p>\s*\{\/if\}\s*\{\/snippet\}/);
  assert.match(screen, /text=\{t\[keptLines\.text\]\}/);
  assert.match(screen, /children=\{also !== null \? alsoNote : undefined\}/);
});

// -- the test hooks of the spec ---------------------------------------------------------------------

test('every test hook of the spec is in the markup of the piece that draws it', () => {
  const hooks: Record<string, string> = {
    'do-list': 'src/screens/Do.svelte',
    'do-step-link': 'src/screens/Do.svelte',
    'do-state': 'src/screens/Do.svelte',
    'do-forget': 'src/screens/Do.svelte',
    'do-forget-confirm': 'src/screens/Do.svelte',
    'do-newer': 'src/screens/doit/ProgressNotice.svelte',
    'step-title': 'src/screens/Step.svelte',
    'step-part': 'src/screens/doit/StepBody.svelte',
    'step-part-state': 'src/screens/doit/StepBody.svelte',
    'step-action': 'src/screens/doit/OpenPart.svelte',
    'step-need': 'src/screens/doit/OpenPart.svelte',
    'step-unknown': 'src/screens/doit/ChainLines.svelte',
    'step-waiting': 'src/screens/doit/WaitingBlock.svelte',
    'step-waited': 'src/screens/doit/StepBody.svelte',
    'step-send-another': 'src/screens/doit/WaitingBlock.svelte',
    'step-done': 'src/screens/doit/Done.svelte',
    'step-back': 'src/screens/doit/StepBody.svelte',
    'step-led': 'src/screens/doit/Done.svelte',
    'step-next': 'src/screens/doit/Done.svelte',
    'step-restart': 'src/screens/doit/StepBody.svelte',
    'step-stop': 'src/screens/doit/StepBody.svelte',
    'step-block-answer': 'src/screens/doit/AskNumber.svelte',
    'step-block-check': 'src/screens/doit/AskNumber.svelte',
    'step-coins-answer': 'src/screens/doit/AskNumber.svelte',
    'step-coins-check': 'src/screens/doit/AskNumber.svelte',
    'step-word': 'src/screens/doit/AskWords.svelte',
    'step-words-check': 'src/screens/doit/AskWords.svelte',
    'step-said': 'src/screens/doit/OpenPart.svelte',
    'step-confirmations': 'src/screens/doit/OpenPart.svelte',
    'step-pot-count': 'src/screens/doit/Done.svelte',
    'step-changed': 'src/screens/doit/Done.svelte',
    strip: 'src/components/doit/Strip.svelte',
    'strip-back': 'src/components/doit/Strip.svelte',
    'strip-chapter': 'src/components/doit/Strip.svelte',
    'strip-stop': 'src/components/doit/Strip.svelte',
    'tx-explained': 'src/screens/read/Explained.svelte',
    // The way back to a followed step, where a part of it was just done on a wallet screen.
    'faucet-step': 'src/screens/receive/FaucetState.svelte',
    'sent-step': 'src/screens/send/Sent.svelte',
  };
  assert.equal(Object.keys(hooks).length, 38);
  for (const [hook, file] of Object.entries(hooks)) {
    const text = source(file);
    // As an attribute of its own, as the heading's hook, or in the table a piece picks its hooks from.
    const there = text.includes(`data-testid="${hook}"`) || text.includes(`titleHook="${hook}"`) || text.includes(`'${hook}'`);
    assert.ok(there, `${hook} is not in ${file}`);
  }
  // "Back to the chapter" is one element at a time: a link in the chapter's line until the step is
  // done, and a button of the done card from then on. There it is the main button, unless the card's
  // main button leads back to the step the reader came for: then it is the second.
  assert.match(source('src/screens/doit/StepBody.svelte'), /\{#if back !== null && !done\}\s*<ChapterLink href=\{back\} data-testid="step-back">/);
  assert.match(
    source('src/screens/doit/Done.svelte'),
    /<ChapterLink look=\{ways\.led === null \? 'primary' : 'secondary'\} class="w-full sm:w-auto" href=\{back\} data-testid="step-back">\{t\.back\}<\/ChapterLink>/,
  );
  assert.equal(source('src/screens/doit/Done.svelte').match(/data-testid="step-back"/g)?.length, 1);
  assert.equal(source('src/screens/doit/StepBody.svelte').match(/data-testid="step-back"/g)?.length, 1);
  // The heading takes its hook through the page's frame.
  assert.match(source('src/components/Page.svelte'), /data-testid=\{titleHook\}/);
  // The transaction screen draws "What just happened" for the transaction it shows.
  assert.match(source('src/screens/Tx.svelte'), /<Explained view=\{shows\.view\} \/>/);
});

// -- the ways back to a step ----------------------------------------------------------------------------

test('the two links from a need to another step tell the steps that they were used, and the three places that lead back to a step draw one piece', () => {
  // -- The press of a link that leads to another step is what remembers the step the reader came for. --
  const part = source('src/screens/doit/OpenPart.svelte');
  // What such a link is handed: one function that hands the steps the step the link leads to and the step it
  // stands on, for each of the three ways a reader can use a link. A plain press (the keyboard's, and one with
  // a key held down for a new tab) is a click; the middle button, which opens the link in a new tab, is told as
  // "auxclick"; and the browser's own menu on the link, which offers a new tab, as "contextmenu". Without the
  // last two, the tab they open would show the other step with no memory of the step the reader came for.
  assert.match(
    code(part),
    /function tells\(to: StepId\): \{ onclick: \(\) => void; onauxclick: \(\) => void; oncontextmenu: \(\) => void \} \{\s*const told = \(\): void => doit\.detour\(to, id\);\s*return \{ onclick: told, onauxclick: told, oncontextmenu: told \};\s*\}/,
  );
  // The button of a need that another step meets: its address is that step's screen and nothing more, and it
  // is handed those three.
  assert.match(
    part,
    /\{#if need\.link\.kind === 'step'\}\s*\{@const to = need\.link\.step\}\s*(<!--[^>]*-->\s*)?<Button\s+variant="primary"\s+class="w-full sm:w-auto"\s+data-testid="step-need-link"\s+href=\{router\.link\(\{ name: 'step', id: to \}\)\}\s+\{\.\.\.tells\(to\)\}\s*>/,
  );
  // The text link to the step where a paper copy is made: the same.
  assert.match(
    part,
    /\{#if paper\.link\.kind === 'step'\}\s*\{@const to = paper\.link\.step\}\s*<TextLink href=\{router\.link\(\{ name: 'step', id: to \}\)\} data-testid="step-paper-link" \{\.\.\.tells\(to\)\}>/,
  );
  // Those two, and no other: every link into the wallet's own screens tells the steps that the step is followed, as before.
  assert.equal(code(part).match(/doit\.detour\(/g)?.length, 1);
  assert.equal(code(part).match(/\{\.\.\.tells\(to\)\}/g)?.length, 2);
  assert.equal(code(part).match(/\btells\(/g)?.length, 3, 'the function, and the two links');
  assert.equal(code(part).match(/onclick=\{\(\) => doit\.follow\(id\)\}/g)?.length, 6);
  // The two pieces that draw such a link put what they are handed on the link itself: the button keeps the
  // click for itself (a link that is switched off takes none) and hands on the rest, the text link all three.
  assert.match(source('src/components/Button.svelte'), /interface Props extends Omit<HTMLAttributes<HTMLElement>, 'class' \| 'children' \| 'onclick'> \{/);
  assert.match(source('src/components/Button.svelte'), /<a\s+\{\.\.\.rest\}\s+href=\{disabled \? undefined : href\}[^>]*\sonclick=\{click\}\s*>/);
  assert.match(source('src/components/TextLink.svelte'), /interface Props extends Omit<HTMLAnchorAttributes, 'class' \| 'children' \| 'href'> \{/);
  assert.match(source('src/components/TextLink.svelte'), /<a \{\.\.\.rest\} \{href\} class=\{\[LINK, extra\]\}>/);
  // No other piece of the app writes it: beside this one there are only the steps' own files, which hand the
  // press on to the one write function.
  const all = readdirSync(new URL('../src/', import.meta.url), { recursive: true, encoding: 'utf8' }).filter((name) => /\.(ts|svelte)$/.test(name));
  for (const name of all) {
    if (['screens/doit/OpenPart.svelte', 'lib/doit/doit.svelte.ts', 'lib/doit/doit-context.ts', 'lib/doit/runner.ts', 'lib/doit/progress.ts'].includes(name)) continue;
    assert.doesNotMatch(code(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')), /\.detour\(|kind: 'detour'/, name);
  }
  // What is remembered travels in no address. A step's screen is /do/<step>, and the one thing these screens
  // ever read from a query string is the way back from the main site ("from"), never a step.
  for (const { name, text } of doitSources()) {
    assert.doesNotMatch(code(text), /URLSearchParams|location\.search|router\.search|\?cameFor|[?&]for=|[?&]step=/, name);
  }
  assert.equal(code(source('src/lib/doit/runner.ts')).match(/fromOfSearch\(/g)?.length, 2, 'the query string is read for the way back, where a step is opened');
  assert.doesNotMatch(code(source('src/lib/doit/progress.ts')).replace(/new URLSearchParams\(search\)\.get\('from'\)/, ''), /URLSearchParams|\.get\('/);

  // -- The one piece that leads back to a step, by its name. --
  const piece = source('src/components/doit/BackToStep.svelte');
  assert.match(
    piece,
    /<Button \{\.\.\.rest\} variant="primary" class="w-full sm:w-auto" href=\{router\.link\(\{ name: 'step', id: step \}\)\}>\s*\{fill\(t\.backTo, \{ step: t\[STEP_DEFS\[step\]\.title\] \}\)\}\s*<\/Button>\s*$/,
  );
  // It is handed the step and reads nothing of the note itself; it has no link element of its own, and what
  // it can be handed beside the step are test hooks.
  assert.doesNotMatch(code(piece), /useDoit|useWallet|<a\s|target=|rel=|onclick/);
  assert.match(piece, /interface Props \{\s*\/\*\*[^*]*\*\/\s*step: StepId;\s*\[key: `data-\$\{string\}`\]: string \| undefined;\s*\}/);
  // Its words name the step, in both languages, for every step.
  for (const lang of LANGS) {
    for (const id of STEPS) {
      const title = strings.doit[lang][STEP_DEFS[id].title];
      const said = strings.doit[lang].backTo.replace('{step}', title);
      assert.equal(said, lang === 'en' ? `Back to "${title}"` : `Volver a "${title}"`);
    }
  }
  // The three places that draw it, each under its own hook, and no other place in the app.
  const drawn: [file: string, tag: RegExp][] = [
    ['src/screens/doit/Done.svelte', /\{#if ways\.led !== null\}\s*<BackToStep step=\{ways\.led\} data-testid="step-led" \/>\s*\{\/if\}/],
    ['src/screens/receive/FaucetState.svelte', /\{#snippet back\(\)\}\s*\{#if step !== null\}\s*<div><BackToStep \{step\} data-testid="faucet-step" \/><\/div>\s*\{\/if\}\s*\{\/snippet\}/],
    ['src/screens/send/Sent.svelte', /\{#if step !== null\}\s*(<!--[^>]*-->\s*)?<div><BackToStep \{step\} data-testid="sent-step" \/><\/div>\s*\{\/if\}/],
  ];
  for (const [file, tag] of drawn) {
    assert.match(source(file), tag, file);
    assert.equal(source(file).match(/<BackToStep\b/g)?.length, 1, `${file}: drawn in one place`);
  }
  for (const name of all) {
    if (drawn.some(([file]) => file === `src/${name}`) || name === 'components/doit/BackToStep.svelte') continue;
    assert.doesNotMatch(code(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')), /BackToStep|\.backTo\b/, name);
  }

  // -- The done card: the three rows, in this order. --
  const card = source('src/screens/doit/Done.svelte');
  assert.match(card, /let back = \$derived\(chapterLink\(wallet\.config\.siteUrl, id, lang, doit\.progress\)\);/);
  assert.match(card, /let ways = \$derived\(waysOn\(id, doit\.progress\)\);/);
  const buttons = card.slice(card.lastIndexOf('<div class="flex flex-col gap-3'));
  const order = ['data-testid="step-led"', 'data-testid="step-back"', 'data-testid="step-next"', 'data-testid="step-list"'].map((hook) => buttons.indexOf(hook));
  assert.ok(order.every((at) => at > 0) && order.join() === [...order].sort((a, b) => a - b).join(), `the buttons stand in the order led, back, next, list: ${order.join()}`);
  assert.match(buttons, /\{#if ways\.next !== null\}\s*<Button class="w-full sm:w-auto" href=\{router\.link\(\{ name: 'step', id: ways\.next \}\)\} data-testid="step-next">/);
  // No "Next step" of the card's own making: the one that is offered is the one waysOn gives.
  assert.doesNotMatch(code(card), /nextStep\(/);

  // -- The faucet's result: once the coins are here, with a payment record or without one, and in no other phase. --
  const state = source('src/screens/receive/FaucetState.svelte');
  assert.equal(state.match(/\{@render back\(\)\}/g)?.length, 4);
  for (const phase of ['arrived', 'confirmed']) {
    const from = state.indexOf(`{:else if view.phase === '${phase}'}`);
    const box = state.slice(from, state.indexOf('{:else if view.phase', from + 1));
    // Straight after the box's first sentence, and before the transaction's row and the line on how to get more coins.
    assert.match(box, /<\/p>\s*\{@render back\(\)\}\s*\{@render record\(view\.payment, true\)\}\s*\{:else\}\s*<p>\{t\.state(Arrived|Confirmed)NoRecord\}<\/p>\s*\{@render back\(\)\}\s*\{\/if\}\s*\{@render once\(\)\}/, phase);
  }
  const early = state.slice(state.indexOf("{#if view.phase === 'checking'}"), state.indexOf("{:else if view.phase === 'arrived'}"));
  assert.doesNotMatch(early, /\{@render back\(\)\}/, 'not while the request runs, and not for a promise');
  assert.doesNotMatch(state.slice(state.indexOf("{:else if view.phase === 'failed'}")), /\{@render back\(\)\}/, 'not after a failure');
  // The card says which step is followed: the step the strip shows, worked out again whenever the note changes.
  const faucet = source('src/screens/receive/FaucetCard.svelte');
  assert.match(faucet, /let followed = \$derived\(stripStep\(doit\.progress, Date\.now\(\)\)\);/);
  assert.match(faucet, /<FaucetState bind:this=\{line\} \{view\} \{more\} \{boxWaited\} step=\{followed\} \/>/);
  assert.doesNotMatch(code(state), /useDoit/);

  // -- "Payment sent": for the followed step whose payment part is ticked, and then it is the screen's main button. --
  const sent = source('src/screens/send/Sent.svelte');
  assert.match(sent, /let step = \$derived\(paidStep\(doit\.progress, Date\.now\(\)\)\);/);
  assert.match(sent, /<Button variant=\{step === null \? 'primary' : 'secondary'\} class=\{WIDE\} href=\{router\.link\(\{ name: 'tx', txid \}\)\} data-testid="sent-link">\{t\.sentLink\}<\/Button>/);
  // After the sentences on what happens next, and before the rows of figures.
  assert.ok(sent.indexOf('</Prose>') < sent.indexOf('data-testid="sent-step"') && sent.indexOf('data-testid="sent-step"') < sent.indexOf('<Rows>'));
  // No clock is kept for either: the step is worked out from the note as it stands.
  for (const text of [faucet, sent]) assert.doesNotMatch(code(text), /setInterval\(/);
});

// -- the way back to the chapter ------------------------------------------------------------------------

test('the link back to the chapter stays in this tab, and is no exception to the page\'s rule that no referrer is sent', () => {
  const link = source('src/components/doit/ChapterLink.svelte');
  // A plain link: its address, the hooks it is handed, its look. Nothing that lifts the page's own policy
  // ("Referrer-Policy: no-referrer", public/_headers) for it. test/info-text.test.ts holds About's sentence
  // about this link to the same facts, over every file of the app.
  assert.match(link, /<a \{\.\.\.rest\} \{href\} class=\{\[LOOK\[look\], extra\]\}>\{@render children\(\)\}<\/a>\s*$/);
  assert.equal(link.match(/<a\s/g)?.length, 1, 'one link element');
  assert.doesNotMatch(link, /referrerpolicy/i);
  // What it can be handed beside its address and its look are test hooks: no attribute of any other name.
  assert.match(link, /\[key: `data-\$\{string\}`\]: string \| undefined;/);
  // No new tab: the reader goes back to where they came from.
  assert.doesNotMatch(code(link), /target=|OUTSIDE|noopener|noreferrer/);
  // Every address it is given was built and checked by the note's own rule, or is a chapter's own page.
  for (const file of ['src/screens/doit/StepBody.svelte', 'src/screens/doit/Done.svelte', 'src/components/doit/Strip.svelte']) {
    assert.match(source(file), /chapterLink\(wallet\.config\.siteUrl, (id|step), lang, /, file);
  }
  assert.match(source('src/screens/Do.svelte'), /chapterUrl\(wallet\.config\.siteUrl, chapter, lang\)/);
  // Nothing else on these screens leads off the site but the explorer and the glossary, and those open a tab of their own.
  for (const { name, text } of doitSources()) {
    assert.doesNotMatch(code(text), /https?:\/\//, name);
    if (name.endsWith('ChapterLink.svelte')) continue;
    for (const hit of code(text).matchAll(/<a\s[^>]*>/g)) assert.match(hit[0], /href=\{router\.link\(/, `${name}: ${hit[0]}`);
  }
});

// -- the three word fields -------------------------------------------------------------------------------

test('the three word fields are fields for seed words: every attribute of the shared twelve, no form, no name, nothing kept', () => {
  const three = source('src/screens/doit/AskWords.svelte');
  const twelve = source('src/components/wallet/WordsInput.svelte');
  for (const attribute of ['spellcheck="false"', 'autocomplete="off"', 'autocorrect="off"', 'autocapitalize="none"', 'translate="no"', 'inputmode="text"']) {
    assert.ok(twelve.includes(attribute), `the shared fields lost ${attribute}`);
    assert.ok(three.includes(attribute), `the three fields lack ${attribute}`);
  }
  assert.match(three, /data-testid="step-word"/);
  assert.match(three, /data-print="never"/);
  // Never inside a form, and never named: no browser offers to remember or to send a word.
  for (const { name, text } of doitSources()) {
    assert.doesNotMatch(code(text), /<form\b/, name);
    assert.doesNotMatch(code(text), /\sname="/, name);
  }
  // What is typed goes to the wallet as the fields hold it, and the fields are emptied after every check.
  assert.match(three, /const answer = wallet\.checkWordsAt\(\[\.\.\.positions\], \[\.\.\.fields\]\);\s*\/\/[^\n]*\n\s*fields = fields\.map\(\(\) => ''\);/);
  // Emptied when the piece leaves the screen, too.
  assert.match(three, /for \(const input of node\.querySelectorAll\('input'\)\) input\.value = '';/);
  // No regular expression is run over what is typed: none is written in the piece at all.
  const script = code(three.slice(0, three.indexOf('</script>')));
  assert.doesNotMatch(script, /new RegExp|\.match\(|\.matchAll\(|\.replace\(|\.replaceAll\(|\.split\(|\.search\(|\.test\(|\.exec\(|\.trim\(|\.toLowerCase\(/);
  assert.doesNotMatch(script, /(^|[=(,:\s])\/(?![/*])[^/\n]+\/[dgimsuvy]*(\.|\)|,|;)/m);
  // A wrong word is said by its place, never corrected: the sentence has the place and nothing else.
  for (const lang of LANGS) assert.deepEqual(slotNames(strings.doit[lang].wordsWrong), ['n'], lang);
  // The 12 words themselves are never handed to these screens.
  for (const { name, text } of doitSources()) assert.doesNotMatch(code(text), /revealWords|unlockWithWords|checkWords\(/, name);
  // A locked passkey wallet goes through the shared unlock step, with this screen's own line.
  assert.match(three, /\{#if locked\}\s*<Unlock why=\{t\.wordsUnlockWhy\} onunlocked=\{\(\) => void unlocked\(\)\} \/>/);
  // Unlocked by this piece, the wallet is locked again when the piece leaves the screen: a step's screen has no "Lock" line.
  assert.match(three, /onDestroy\(\(\) => \{\s*if \(unlockedHere\) wallet\.lock\(\);\s*\}\);/);
  // And focus goes to the first of the three fields, after the unlock step's own move to the heading.
  assert.match(three, /async function unlocked\(\): Promise<void> \{\s*unlockedHere = true;[\s\S]*?await tick\(\);\s*await tick\(\);\s*field\(0\)\?\.focus\(\);\s*\}/);
});

// -- nothing here reaches past the wallet and the steps ----------------------------------------------------

test('the screens read nothing from the browser\'s storage or the network: everything goes through the wallet and the steps', () => {
  for (const { name, text } of [...doitSources(), ...GAINED.map((file) => ({ name: file, text: source(file) }))]) {
    const plain = code(text);
    assert.doesNotMatch(plain, /localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.credentials|\bfetch\(/, name);
    // The note is read and written by the steps alone. A screen may use the pure helpers that build a link or pick the strip's step.
    assert.doesNotMatch(plain, /readProgress|writeProgress|forgetProgress|restartStep|applyChange|PROGRESS_KEY/, name);
    assert.doesNotMatch(plain, /doit\.svelte/, name);
  }
  // Only main.ts makes the steps, and hands them to the app; the gallery's main does the same over its stand-in.
  const makers = ['src/main.ts', 'dev/main.ts'];
  for (const file of makers) assert.match(source(file), /import \{ makeDoit \} from '[./]+\/(src\/)?lib\/doit\/doit\.svelte\.ts';/, file);
  const all = readdirSync(new URL('../src/', import.meta.url), { recursive: true, encoding: 'utf8' }).filter((name) => /\.(ts|svelte)$/.test(name));
  for (const name of all) {
    if (name === 'main.ts') continue;
    assert.doesNotMatch(code(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')), /doit\.svelte\.ts/, name);
  }
});

test('the shell draws the strip under the header, and the app tells the steps which screen is open after it has named it to the counter', () => {
  assert.match(source('src/components/Shell.svelte'), /<Header \/>\s*<!--[^>]*-->\s*<Strip \/>\s*<!--/);
  const app = source('src/App.svelte');
  const counted = app.indexOf('if (counting) trackPage(route, lang);');
  const told = app.indexOf('untrack(() => doit.watch(route, search, settled));');
  assert.ok(counted > 0 && told > counted, 'the screen is named to the counter first');
  assert.match(app, /\$effect\.pre\(\(\) => \{\s*const route = router\.route;\s*const search = router\.search;\s*const settled = wallet\.settings !== 'loading';\s*untrack\(\(\) => doit\.watch\(route, search, settled\)\);\s*\}\);/);
  // A done step's screen is told to the wallet as the list of steps: nothing is left to check, and nothing is read for it.
  assert.match(
    app,
    /let watched = \$derived\(watchedScreen\(router\.route, doit\.progress\)\);\s*\$effect\(\(\) => \{\s*const name = watched;\s*untrack\(\(\) => wallet\.watch\(name\)\);\s*\}\);/,
  );
  // The strip says "waiting for a block" only where the wallet goes on reading what the wait is read from.
  assert.match(
    source('src/components/doit/Strip.svelte'),
    /let watched = \$derived\(watchedScreen\(router\.route, doit\.progress\)\);\s*let live = \$derived\(\{ coins: readsCoins\(watched\), list: readsTransactions\(watched\) \}\);\s*let strip = \$derived\(step === null \? null : stripView\(doit\.view\(step, now\), live\)\);/,
  );
  // The engine reads by the same two rules.
  const engine = source('src/lib/chain-sync.ts');
  assert.match(engine, /return screen !== null && readsCoins\(screen\);/);
  assert.match(engine, /const showsActivity = \(\): boolean => screen !== null && readsTransactions\(screen\);/);
  // One status region, the shell's: no piece of these screens adds another.
  for (const { name, text } of doitSources()) assert.doesNotMatch(code(text), /role="status"|aria-live/, name);
  // What is said through it: a part ticked and a step done, from the step's own screen; "done" from the strip.
  const body = source('src/screens/doit/StepBody.svelte');
  assert.match(body, /announce\(fill\(t\.saidDone, \{ step: t\[def\.title\] \}\)\)/);
  assert.match(body, /announce\(fill\(t\.saidTicked, /);
  assert.match(source('src/components/doit/Strip.svelte'), /const text = fill\(t\.saidDone, \{ step: stepTitle\(finished, lang\) \}\);/);
  for (const lang of LANGS) {
    assert.deepEqual(slotNames(strings.doit[lang].saidTicked).sort(), ['m', 'n', 'part'], lang);
    assert.deepEqual(slotNames(strings.doit[lang].saidDone), ['step'], lang);
  }
});
