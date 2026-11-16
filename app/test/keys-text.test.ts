// The rules the text of the Backup and Settings screens keeps, beyond the
// ones test/strings.test.ts holds every table to: the exception paragraph
// word for word, the words of the main site's backup form on the practice
// card, what Remove may promise, the words the app may use about privacy,
// facts as slots, and that every key of the two tables is used.
// And a few rules for the screens' own source: nothing reaches around the
// wallet, the 12 words meet no regular expression and no copy control, the
// practice sheet is the form's parts in the form's order and holds no word,
// the passkey's whole name is built nowhere here, the words of the "Wallet
// made" step are taken only once the screen is on the page, and the Remove
// question neither moves the page nor takes an answer at once.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import { splitLead } from '../src/components/text.ts';
import { SAFARI_KEEPS_DAYS } from '../src/components/wallet/frame.ts';
import { fill, slotNames } from '../src/lib/format.ts';
import { COPIES } from '../src/screens/keys/card-form.ts';
import { strings } from '../src/strings/index.ts';

type Table = Readonly<Record<string, string>>;

/** The screens' own files: the two screens and everything in their folder. */
function sources(): { name: string; text: string }[] {
  const screens = new URL('../src/screens/', import.meta.url);
  const folder = new URL('keys/', screens);
  return [
    ...['Backup.svelte', 'Settings.svelte'].map((name) => ({ name, text: readFileSync(new URL(name, screens), 'utf8') })),
    ...readdirSync(folder).map((name) => ({ name: `keys/${name}`, text: readFileSync(new URL(name, folder), 'utf8') })),
  ];
}

const files = sources();
const source = (name: string): string => {
  const found = files.find((file) => file.name === name);
  assert.ok(found, `no file ${name}`);
  return found.text;
};
const everything = files.map((file) => file.text).join('\n');

/** A file's code without its comments: what the file does, not what it says about itself. */
function code(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => {
      const start = line.trim();
      return !(start.startsWith('//') || start.startsWith('*') || start.startsWith('/*'));
    })
    .join('\n');
}

/** A text without "12 words": the one number that is a name here, not a fact that could change. */
const withoutTheWords = (text: string): string => text.replaceAll('12 words', '').replaceAll('12 palabras', '');

/** The sentences of a text, split where a full stop is followed by a capital. */
const sentences = (text: string): string[] => text.split(/(?<=\.) (?=[A-ZÁÉÍÓÚÑ¿])/);

// -- every key is used ---------------------------------------------------------------

test('every key of the two tables is used by the screens, and the screens use no key that is missing', () => {
  assert.ok(files.length >= 6, 'the walk found the screens and their folder');
  for (const area of ['backup', 'settings'] as const) {
    const table: Table = strings[area].en;
    for (const key of Object.keys(table)) {
      // As t.key in markup or script, or as the key's own name where a helper picks between two.
      const used = new RegExp(`\\bt\\.${key}\\b|'${key}'`).test(everything);
      assert.ok(used, `${area}.${key} is in the table and no screen shows it`);
    }
  }
  // The other way round: every t.<key> a screen writes is in the table it reads.
  const reads: [string, 'backup' | 'settings'][] = [
    ['Backup.svelte', 'backup'],
    ['keys/PracticeCard.svelte', 'backup'],
    ['Settings.svelte', 'settings'],
    ['keys/RemoveWallet.svelte', 'settings'],
  ];
  for (const [name, area] of reads) {
    const table: Table = strings[area].en;
    for (const hit of source(name).matchAll(/\bt\.([A-Za-z]+)\b/g)) {
      assert.ok(Object.hasOwn(table, hit[1] ?? ''), `${name} shows ${area}.${hit[1]}, which is not in the table`);
    }
  }
});

// -- the exception paragraph ---------------------------------------------------------

test('the exception paragraph is the one of notes/06 section 3.5, word for word, in both languages', () => {
  assert.equal(
    strings.backup.en.exception,
    'Chapter 4 of the Journey says never to type your seed into a website, and to keep it only on your wallet device and on backups you made yourself. This page is the one exception, because the 12 words here only guard play money, practice coins that are worth nothing. The words of a wallet that holds real bitcoin never go into a web page, this one included.',
  );
  assert.equal(
    strings.backup.es.exception,
    'El capítulo 4 del Recorrido dice que nunca escribas tu frase semilla en un sitio web, y que solo debe vivir en tu dispositivo de billetera y en los respaldos que tú hiciste. Esta página es la única excepción, porque sus 12 palabras solo protegen dinero de juguete, monedas de práctica que no valen nada. Las palabras de una billetera con bitcoin de verdad nunca van en una página web, incluida esta.',
  );
  // Three sentences, and the last closes the loophole the word "exception" opens.
  for (const lang of LANGS) assert.equal(sentences(strings.backup[lang].exception).length, 3, lang);
  assert.match(strings.backup.en.exception, /this one included\.$/);
  assert.match(strings.backup.es.exception, /incluida esta\.$/);
});

test('the exception gives one reason, about the words, and never argues that this page can be trusted', () => {
  // A scam page can claim everything a page can claim. It cannot make real words worthless.
  for (const key of ['exception', 'neverRealMoney', 'before', 'after'] as const) {
    assert.doesNotMatch(strings.backup.en[key], /\b(safe|secure|trust|encrypted|open source|we never see)\b/i, key);
    assert.doesNotMatch(strings.backup.es[key], /\b(segur[ao]s?|confía|confiar|cifrad[ao]s?|código abierto)\b/i, key);
  }
  assert.match(strings.backup.en.exception, /because the 12 words here only guard play money/);
  assert.match(strings.backup.es.exception, /porque sus 12 palabras solo protegen dinero de juguete/);
});

test('real money must never go on these words: the companion line, in both languages', () => {
  assert.equal(
    strings.backup.en.neverRealMoney,
    'Never put real money on these 12 words. Words that have been on a web page are for practice only: a real wallet should make its own.',
  );
  assert.equal(
    strings.backup.es.neverRealMoney,
    'Nunca pongas dinero de verdad en estas 12 palabras. Las palabras que estuvieron en una página web solo sirven para practicar: una billetera de verdad debe generar las suyas.',
  );
  // The practice sheet carries the short form, which is the shared one.
  assert.match(source('keys/PracticeCard.svelte'), /\{w\.wordsException\}/);
});

test('the reveal warns that a screen reader will speak the words aloud, before they are on screen', () => {
  assert.match(strings.backup.en.spokenAloud, /^A screen reader will read the 12 words aloud\./);
  assert.match(strings.backup.es.spokenAloud, /^Un lector de pantalla va a leer las 12 palabras en voz alta\./);
  // In the screen's markup the warning stands above the button that shows the words, and above the list.
  const backup = source('Backup.svelte');
  const asks = backup.slice(backup.indexOf('<Section title={t.wordsTitle}>'));
  assert.ok(asks.indexOf('{t.spokenAloud}') < asks.indexOf('data-testid="reveal-words"'));
  const made = backup.slice(backup.indexOf('<Section title={t.shownTitle}>'));
  assert.ok(made.indexOf('{t.spokenAloud}') < made.indexOf('<WordsList'));
  // Tab passes over a paragraph. So the button names the warning as its description: a screen reader
  // then says it when the button takes focus.
  assert.match(backup, /<p id="\{id\}-spoken" data-testid="spoken-aloud">\{t\.spokenAloud\}<\/p>/);
  assert.match(asks, /data-testid="reveal-words"\s+aria-describedby="\{id\}-spoken"/);
});

// -- the "Wallet made" step ------------------------------------------------------------

test('"Wallet made" with a passkey: where the passkey lives, and the words as the way back', () => {
  const { en, es } = strings.backup;
  // A passkey may sit on a security key, which is in no password manager and syncs nowhere.
  assert.match(en.madePasskeyWhere, /kept by your password manager, or on the security key you used\./);
  assert.match(en.madePasskeyWhere, /A password manager may sync it to your other devices\.$/);
  assert.match(es.madePasskeyWhere, /administrador de contraseñas, o queda en la llave de seguridad que usaste\./);
  assert.match(es.madePasskeyWhere, /Un administrador de contraseñas puede sincronizarla con tus otros dispositivos\.$/);
  for (const lang of LANGS) assert.doesNotMatch(strings.backup[lang].madePasskeyWhere, /device's password manager|de tu dispositivo/, lang);
  // One line, and it promises nothing about the passkey.
  assert.equal(splitLead(en.madePasskeyBack).rest, '');
  assert.match(en.madePasskeyBack, /^If the passkey ever fails .+ these 12 words are the way back/);
  assert.match(es.madePasskeyBack, /^Si alguna vez la llave de acceso falla .+ estas 12 palabras son la forma de volver/);
  // The words are on screen before the line that points at them, and before what keeping them here means.
  const backup = source('Backup.svelte');
  const from = backup.indexOf("{:else if view === 'made' && words !== null}");
  const to = backup.indexOf("{:else if view === 'shown' && words !== null}");
  assert.ok(from > 0 && to > from, 'the "Wallet made" step is in the screen');
  const step = backup.slice(from, to);
  assert.ok(step.indexOf('data-testid="passkey-name"') > 0);
  assert.ok(step.indexOf('data-testid="passkey-name"') < step.indexOf('<WordsList'));
  assert.ok(step.indexOf('data-testid="passkey-tag"') < step.indexOf('<WordsList'));
  assert.ok(step.indexOf('<WordsList') < step.indexOf('{t.madePasskeyBack}'));
  assert.ok(step.indexOf('<WordsList') < step.indexOf('{t.madeKeepsWords}'));
  assert.ok(step.indexOf('{t.madeKeepsWords}') < step.indexOf('{@render exception(true)}'));
  // The sheet to write the words on is offered before the button that says they are written down,
  // which takes them off the screen. On the other steps the sheet closes the screen.
  assert.ok(step.indexOf('{@render exception(true)}') < step.indexOf('<PracticeCard {site} />'));
  assert.ok(step.indexOf('<PracticeCard {site} />') < step.indexOf('data-testid="words-written"'));
  assert.equal(backup.match(/<PracticeCard \{site\} \/>/g)?.length, 2);
  assert.equal(backup.match(/<PracticeCard\b/g)?.length, 2);
  assert.match(backup, /\{#if !made\}\s*<PracticeCard \{site\} \/>\s*\{\/if\}/);
});

test('the PRACTICE stamp stands beside the 12 words wherever they are shown', () => {
  const backup = source('Backup.svelte');
  const lists = [...backup.matchAll(/<WordsList \{words\} \/>/g)];
  assert.equal(lists.length, 2, 'the "Wallet made" step and the plain step');
  for (const list of lists) {
    // Right above the list, inside the same box.
    const before = backup.slice(0, list.index).trimEnd();
    assert.ok(before.endsWith('<p class="mb-3"><Badge tone="stamp">{c.markerBadge}</Badge></p>'), before.slice(-120));
  }
});

// -- the practice sheet --------------------------------------------------------------------

/** The practice sheet's own file, without its comments. */
const sheet = (): string => code(source('keys/PracticeCard.svelte'));

test("the card's words are the form's own: its title and its two warnings, word for word, and the site's terms in Spanish", () => {
  const { en, es } = strings.backup;
  assert.equal(en.cardName, 'Recovery Seed Phrases');
  assert.equal(en.cardNoCopies, "Don't make digital copies");
  assert.equal(en.cardNoSharing, 'Never share with anyone');
  // "Frase semilla" is the Spanish glossary's term for the words; the word for "recovery" is in that entry's alias.
  assert.equal(es.cardName, 'Frases semilla de recuperación');
  assert.equal(es.cardNoCopies, 'No hagas copias digitales');
  assert.equal(es.cardNoSharing, 'No las compartas con nadie');
  // The one line the form lacks and a practice card needs.
  assert.equal(en.cardRestores, 'Restores only on the practice network.');
  assert.equal(es.cardRestores, 'Solo se restaura en la red de práctica.');
});

test("the section says what the sheet is: the site's form marked for practice, how many cards, written by hand, and never the words in print", () => {
  const { en, es } = strings.backup;
  assert.equal(en.cardTitle, 'A practice backup sheet to print');
  assert.equal(es.cardTitle, 'Una hoja de respaldo de práctica para imprimir');
  assert.match(en.cardLead, /^This is LearnBitcoin's 12-word backup form, marked for practice\./);
  assert.match(en.cardLead, /The sheet prints \{cards\} blank cards: write the 12 words on one by hand, in order\./);
  assert.match(en.cardLead, /The words themselves are never printed, whether they are showing or not\.$/);
  assert.match(es.cardLead, /^Este es el formulario de respaldo de 12 palabras de LearnBitcoin, marcado para práctica\./);
  assert.match(es.cardLead, /La hoja imprime \{cards\} tarjetas en blanco: escribe las 12 palabras en una, a mano y en orden\./);
  assert.match(es.cardLead, /Las palabras mismas nunca se imprimen, se estén mostrando o no\.$/);
  // How many cards is a slot, filled from the number of cards the sheet draws.
  for (const lang of LANGS) {
    const text = strings.backup[lang].cardLead;
    assert.deepEqual(slotNames(text), ['cards'], lang);
    assert.doesNotMatch(withoutTheWords(text.replace('12-word', '')), /[0-9]/, lang);
  }
  assert.equal(fill(en.cardLead, { cards: String(COPIES) }).match(/The sheet prints (\S+) blank cards/)?.[1], '3');
  assert.match(sheet(), /\{fill\(t\.cardLead, \{ cards: String\(COPIES\) \}\)\}/);
  assert.match(sheet(), /const CARDS = Array\.from\(\{ length: COPIES \}, \(_, index\) => index\);/);
  assert.equal(en.cardPrint, 'Print the sheet');
  assert.equal(es.cardPrint, 'Imprimir la hoja');
});

test('the card is the form: its parts in its order, with the stamp on the title\'s line and the "restores" line under the rows', () => {
  const card = sheet();
  const body = card.slice(card.indexOf('{#snippet card('), card.indexOf('<Section'));
  assert.ok(body.length > 0, 'the card is in the file');
  const order = [
    '{t.cardName}',
    '<Badge tone="stamp" small>{c.markerBadge}</Badge>',
    't.cardNoCopies, t.cardNoSharing',
    '{@render shield()}',
    '{#each ROWS as row (row.number)}',
    '{t.cardRestores}',
    "{@render logo('text-[12pt]')}",
    '{site}',
  ];
  let at = -1;
  for (const part of order) {
    const next = body.indexOf(part, at + 1);
    assert.ok(next > at, `${part} is missing from the card, or not where the form has it`);
    at = next;
  }
  // The stamp shares the title's line, at the right, and may drop under the title: one row that wraps.
  assert.match(
    body,
    /<div class="flex flex-wrap items-center justify-between [^"]*">\s*<p class=\{\['[^']*', TIGHT\]\}>\{t\.cardName\}<\/p>\s*<Badge tone="stamp" small>\{c\.markerBadge\}<\/Badge>\s*<\/div>/,
  );
  // Numbered down the card, one row to a word, as on the form: no second column for a number to land in.
  assert.match(card, /const ROWS = formRows\(WORD_COUNT\);/);
  assert.match(body, /<text[^>]*>\{row\.number\}<\/text\s*>/);
  assert.doesNotMatch(card, /grid-cols|grid-flow|columns-/);
  // Seven dashed lines part a row's box into its eight letter cells.
  assert.match(card, /const LINES = cellLines\(\);/);
  assert.match(body, /\{#each LINES as x \(x\)\}/);
});

test('the sheet on paper: a heading with the logo, the stamp, the title and the short exception, then every card; on screen one card, as a picture', () => {
  const card = sheet();
  const page = card.slice(card.indexOf('<Section'));
  // The one thing marked for paper. It says nothing to a screen reader: the sentence above it says what it is.
  assert.match(page, /<div data-print="only" data-testid="practice-sheet" aria-hidden="true" class="[^"]*">/);
  assert.equal(card.match(/data-print=/g)?.length, 1);
  assert.ok(page.indexOf('{fill(t.cardLead') > 0 && page.indexOf('{fill(t.cardLead') < page.indexOf('data-print="only"'));
  // The heading is for paper only.
  assert.match(page, /<div data-testid="sheet-heading" class="hidden [^"]*\bprint:block">/);
  const heading = page.slice(page.indexOf('data-testid="sheet-heading"'), page.indexOf('{#each CARDS'));
  for (const part of ["{@render logo('text-[16.5pt]')}", '<Badge tone="stamp">{c.markerBadge}</Badge>', '{site}', '{t.cardName}', '{w.wordsException}']) {
    assert.ok(heading.includes(part), `the heading lacks ${part}`);
  }
  // Every card of the sheet is drawn, each in a place of its own, and only the first place is on screen.
  // The crop marks of a place are for paper only too.
  const places = page.slice(page.indexOf('{#each CARDS as copy (copy)}'));
  assert.match(places, /^\{#each CARDS as copy \(copy\)\}\s*<div\s+class=\{\[\s*'[^']*',\s*copy > 0 && 'hidden print:block',?\s*\]\}\s*>/);
  assert.match(places, /<svg class="absolute [^"]*\bhidden\b[^"]*\bprint:block">\s*\{#each MARKS as mark/);
  assert.equal(places.match(/\{@render card\(\)\}/g)?.length, 1);
  // A place is never cut in two by the end of a page. On screen it is drawn a third larger than on
  // paper, where its size is the form's own.
  assert.match(places, /^\{#each CARDS as copy \(copy\)\}\s*<div\s+class=\{\[\s*'[^']*\bbreak-inside-avoid\b/);
  assert.match(places, /^\{#each CARDS as copy \(copy\)\}\s*<div\s+class=\{\[\s*'[^']* \[zoom:1\.3333\] [^']*print:\[zoom:1\]'/);
  // The button stands after the sheet, outside it: it is not printed.
  assert.match(page, /\{\/each\}\s*<\/div>\s*<\/div>\s*<div>\s*<Button\s+data-testid="print-card"/);
});

test('the card is made for paper: every length on it is in points, or counted from its own size', () => {
  const card = sheet();
  const drawn = card.slice(card.indexOf('{#snippet shield()'), card.indexOf('<Section'));
  const units = [...drawn.matchAll(/\[(?:calc\()?-?[0-9.]+(px|rem|pt|em|mm|in|%|vw|vh)\b/g)].map((hit) => hit[1]);
  assert.ok(units.length > 20, 'the walk found the lengths of the card');
  for (const unit of units) assert.ok(unit === 'pt' || unit === 'em' || unit === '%', `a length in ${unit}`);
  // Nothing from the app's own scale of sizes: that scale is counted from the reader's type size, for screens.
  assert.doesNotMatch(drawn, /\b(?:text-(?:xs|sm|base|lg|xl)|(?:[mp][trblxy]?|gap(?:-[xy])?|[wh]|leading|top|left|right|bottom|inset)-[0-9])/);
  // The card's own width, and the sheet's on paper.
  assert.match(drawn, /class="w-\[148pt\] /);
  assert.match(card, /class="print:mx-auto print:w-\[520pt\] print:max-w-full"/);
});

test("the blue of the form's circles is a colour of its own, named as the one exception, and only the practice card uses it", () => {
  const src = new URL('../src/', import.meta.url);
  const css = readFileSync(new URL('app.css', src), 'utf8');
  assert.match(css, /^ {2}--color-form-blue: #444ce7;$/m);
  // The stylesheet's sentence about its hues still holds: it names the exception.
  assert.match(css, /Three hues only \(orange, ink, white\), light only\. There is one\s+exception/);
  assert.match(css, /\(--color-form-blue, at the end of this list\)/);
  const users = (readdirSync(src, { recursive: true }) as string[])
    .filter((name) => /\.(svelte|ts|css)$/.test(name))
    .filter((name) => readFileSync(new URL(name, src), 'utf8').includes('form-blue'))
    .sort();
  assert.deepEqual(users, ['app.css', 'screens/keys/PracticeCard.svelte']);
  assert.match(sheet(), /<circle [^>]*class="fill-form-blue" \/>/);
});

test('the words that left the screen because another tab changed the wallet are accounted for', () => {
  const { en, es } = strings.backup;
  assert.match(en.wordsWithdrawn, /^The wallet in this browser changed in another tab, so the 12 words were taken off the screen\./);
  assert.match(en.wordsWithdrawn, /They belonged to the wallet that was here before\./);
  assert.match(es.wordsWithdrawn, /^La billetera de este navegador cambió en otra pestaña, así que las 12 palabras se quitaron de la pantalla\./);
  const backup = source('Backup.svelte');
  // Said where the words were, as an alert (a problem that is not silent), and only for that cause.
  assert.match(backup, /\{#if withdrawn\}[\s\S]{0,160}<Notice kind="problem" text=\{t\.wordsWithdrawn\} data-testid="words-withdrawn" \/>/);
  assert.match(backup, /const taken = takenByAnotherTab\(owner\);/);
  assert.match(backup, /if \(taken\) withdrawn = true;/);
  // Asking again clears it.
  assert.match(backup, /async function show\(\): Promise<void> \{\s*failed = false;\s*withdrawn = false;/);
});

test('"Wallet made" without a passkey: what is kept, who can look and spend, and that a browser can erase it', () => {
  const { en, es } = strings.backup;
  assert.match(en.madeKeepsWords, /keeps the 12 words of this wallet, not encrypted/);
  assert.match(es.madeKeepsWords, /guarda las 12 palabras de esta billetera, sin cifrar/);
  assert.match(en.madeKeepsWho, /^Anyone who uses this browser can see the wallet and spend its coins\.$/);
  assert.match(es.madeKeepsWho, /^Cualquiera que use este navegador puede ver la billetera y gastar sus monedas\.$/);
  // Safari's days are a slot, filled from the one constant that holds the browser's rule.
  for (const lang of LANGS) {
    const text = strings.backup[lang].madeKeepsCleared;
    assert.deepEqual(slotNames(text), ['days'], lang);
    assert.doesNotMatch(withoutTheWords(text), /[0-9]/, lang);
    assert.match(fill(text, { days: String(SAFARI_KEEPS_DAYS) }), /Safari .+ 7 /, lang);
    assert.deepEqual(slotNames(strings.backup[lang].madeNotPersisted), [], lang);
  }
  // What the browser's "no" means, said only then.
  assert.match(en.madeNotPersisted, /was asked to keep what this page stores, and did not agree/);
  assert.match(source('Backup.svelte'), /\{#if wallet\.persisted === false\}\s*<p data-testid="made-not-persisted">\{t\.madeNotPersisted\}<\/p>/);
});

// -- Settings: what the app may say about what is kept ---------------------------------

test('Settings: the public key is kept for every wallet, so anyone using this browser can see the wallet', () => {
  assert.match(strings.settings.en.keepsPublic, /public key.+anyone who uses this browser can see the wallet\.$/);
  assert.match(strings.settings.es.keepsPublic, /clave pública.+cualquiera que use este navegador puede ver la billetera\.$/);
  assert.equal(strings.settings.en.keepsWords, 'The 12 words, not encrypted. So anyone who uses this browser can also spend its coins.');
  assert.match(strings.settings.es.keepsWords, /^Las 12 palabras, sin cifrar\. .+también puede gastar sus monedas\.$/);
  assert.match(strings.settings.en.keepsPasskey, /^Not the 12 words\./);
  assert.match(strings.settings.es.keepsPasskey, /^Las 12 palabras no\./);
  for (const lang of LANGS) {
    assert.deepEqual(slotNames(strings.settings[lang].keepsNotPersisted), ['days'], lang);
    assert.doesNotMatch(withoutTheWords(strings.settings[lang].keepsNotPersisted), /[0-9]/, lang);
  }
});

test('privacy wording: only what SPEC section 12 allows, in both tables and both languages', () => {
  // Allowed: no account; we set no cookies; the 12 words never leave this browser.
  assert.equal(strings.settings.en.keepsPromise, 'There is no account, and we set no cookies. The 12 words never leave this browser.');
  assert.equal(strings.settings.es.keepsPromise, 'No hay ninguna cuenta, y no ponemos cookies. Las 12 palabras nunca salen de este navegador.');
  const banned = {
    en: [
      /nothing (else )?leaves/i,
      /nothing else is (stored|kept)/i,
      /nothing that says who you are/i,
      /\banonymous/i,
      /\bno cookies\b(?<!we set no cookies)/i,
      /we (collect|store|keep) nothing/i,
      /never see your/i,
      /\b(safe|secure)\b/i,
    ],
    es: [/nada (más )?sale/i, /no se guarda nada más/i, /nada que diga quién eres/i, /anónim/i, /sin cookies/i, /no (recopilamos|guardamos) nada/i],
  };
  for (const area of ['backup', 'settings'] as const) {
    for (const lang of LANGS) {
      for (const [key, text] of Object.entries(strings[area][lang] as Table)) {
        for (const pattern of banned[lang]) assert.doesNotMatch(text, pattern, `${area}.${lang}.${key}`);
        // No account words for the wallet. ("Por su cuenta" is Spanish for "by itself", and names no account.)
        if (key === 'keepsPromise') continue;
        assert.doesNotMatch(text, /\b(account|sign in|log in|password(?! manager))\b/i, `${area}.${lang}.${key}`);
        assert.doesNotMatch(text.replaceAll('por su cuenta', ''), /\b(cuenta|iniciar sesión|contraseña(?!s))\b/i, `${area}.${lang}.${key}`);
      }
    }
  }
});

// -- Settings: the descriptors -----------------------------------------------------------

test('descriptors: two sentences on what they are for, with watching named and the 12 words left out of it', () => {
  for (const lang of LANGS) {
    const t = strings.settings[lang];
    assert.equal(splitLead(t.descriptorsWhat).rest, '', lang);
    assert.equal(splitLead(t.descriptorsUse).rest, '', lang);
  }
  assert.match(strings.settings.en.descriptorsUse, /watch-only wallet, without the 12 words/);
  // The Spanish glossary's own term for a watch-only wallet.
  assert.match(strings.settings.es.descriptorsUse, /billetera de solo lectura, sin las 12 palabras/);
  // The link to the Sparrow page, and a copy button on each descriptor.
  const settings = source('Settings.svelte');
  assert.match(settings, /router\.link\(\{ name: 'sparrow' \}\)/);
  // Each descriptor is shown whole, wrapped, never in a block that cuts it off at its edge: the two
  // differ only near their ends.
  assert.match(settings, /<Mono size="small" value=\{text\} data-testid=\{hook\} \/>/);
  assert.doesNotMatch(settings, /CodeBlock/);
  // Each copy button says which descriptor it copies, and the status region says which was copied.
  assert.match(settings, /<CopyButton \{text\} label=\{copy\} \{said\} data-testid="copy-\{hook\}" \/>/);
  assert.match(settings, /t\.descriptorReceive, descriptors\.receive, t\.descriptorReceiveCopy, t\.descriptorReceiveCopied, 'descriptor-receive'/);
  assert.match(settings, /t\.descriptorChange, descriptors\.change, t\.descriptorChangeCopy, t\.descriptorChangeCopied, 'descriptor-change'/);
  for (const lang of LANGS) {
    const t = strings.settings[lang];
    assert.notEqual(t.descriptorReceiveCopy, t.descriptorChangeCopy, lang);
    assert.notEqual(t.descriptorReceiveCopy, strings.common[lang].copy, lang);
    assert.ok(t.descriptorReceiveCopy.startsWith(strings.common[lang].copy), lang);
    assert.ok(t.descriptorChangeCopy.startsWith(strings.common[lang].copy), lang);
  }
});

// -- Settings: only what this browser holds ------------------------------------------------

test('Settings says what this browser holds, and nothing about where the wallet came from', () => {
  // The record's kind is how this browser opens the wallet, and its time is when the record was written
  // here. A wallet made with a passkey and restored here from its 12 words is kept with the words: "made
  // without a passkey", "made on" and "only the 12 words bring it back" would all be false for it.
  const { en, es } = strings.settings;
  assert.equal(en.kindPasskey, 'Opens with a passkey');
  assert.equal(en.kindWords, 'Opens without a passkey');
  assert.equal(en.since, 'In this browser since');
  assert.match(es.since, /^En este navegador desde/);
  const aboutThisCopy = ['kind', 'kindPasskey', 'kindWords', 'since', 'keepsPublic', 'keepsPasskey', 'keepsWords', 'keepsPersisted', 'keepsNotPersisted'] as const;
  for (const key of aboutThisCopy) {
    assert.doesNotMatch(en[key], /\b(made|created)\b/i, key);
    assert.doesNotMatch(es[key], /\b(cread[ao]|creó|hecha)\b/i, key);
  }
  // Nothing says this wallet has no passkey, or that only the words bring it back.
  for (const key of ['keepsWords', 'keepsPersisted', 'keepsNotPersisted', 'removeBackWords'] as const) {
    assert.doesNotMatch(en[key], /\bonly\b|has no passkey|no passkey to/i, key);
    assert.doesNotMatch(es[key], /\bsolo\b|no tiene (una )?llave/i, key);
  }
  // The screen shows them under the hooks the scenarios use.
  const settings = source('Settings.svelte');
  assert.match(settings, /<Row name=\{t\.since\}>\s*<span data-testid="wallet-since">\{hereSince\(record\.createdAt, lang\)\}<\/span>/);
});

// -- Settings: remove ----------------------------------------------------------------------

test('remove: a passkey wallet may come back with its passkey, and the 12 words are the sure way', () => {
  const { en, es } = strings.settings;
  assert.match(en.removeBackPasskey, /can come back with its passkey, on this device or on another one that has the passkey, and with its 12 words/);
  assert.match(en.removeBackPasskey, /A passkey can fail, so the 12 words are the sure way back\./);
  assert.match(es.removeBackPasskey, /puede volver con su llave de acceso, en este dispositivo o en otro que la tenga, y con sus 12 palabras/);
  assert.match(es.removeBackPasskey, /Una llave de acceso puede fallar, así que las 12 palabras son la forma segura de volver\./);
  // It promises no passkey: the reader may be here because theirs has just failed.
  assert.doesNotMatch(en.removeBackPasskey, /\b(will|always) (come back|open|work|bring)/i);
  assert.doesNotMatch(es.removeBackPasskey, /\b(volverá|siempre)\b/i);
});

test('remove: a wallet kept with its 12 words comes back with them, or with its passkey if it was made with one', () => {
  // This browser cannot tell how such a wallet was made: it may be a passkey wallet restored from its words.
  const { en, es } = strings.settings;
  assert.match(en.removeBackWords, /^This erases the 12 words from this browser\./);
  assert.match(en.removeBackWords, /comes back with its 12 words, or with its passkey if it was made with one\./);
  assert.match(en.removeBackWords, /Without the words on paper and without a passkey, its practice coins are out of reach for good\.$/);
  assert.match(es.removeBackWords, /^Esto borra las 12 palabras de este navegador\./);
  assert.match(es.removeBackWords, /vuelve con sus 12 palabras, o con su llave de acceso si se creó con una\./);
  assert.match(es.removeBackWords, /Sin las palabras en papel y sin llave de acceso, sus monedas de práctica quedan fuera de alcance para siempre\.$/);
  // It promises no passkey either.
  assert.doesNotMatch(en.removeBackWords, /\b(will|always) (come back|open|work|bring)/i);
});

test('remove: the question asks with the action, and the two answers are named for what they do', () => {
  assert.equal(strings.settings.en.removeAsk, 'Remove this wallet from this browser?');
  assert.equal(strings.settings.es.removeAsk, '¿Quitar esta billetera de este navegador?');
  assert.equal(strings.settings.en.removeYes, 'Remove it');
  assert.equal(strings.settings.en.removeNo, 'Keep it');
  assert.equal(strings.settings.es.removeYes, 'Quitarla');
  assert.equal(strings.settings.es.removeNo, 'Conservarla');
  // The hooks the scenarios and the other screens rely on.
  const remove = source('keys/RemoveWallet.svelte');
  for (const hook of ['remove-wallet', 'remove-confirm', 'remove-keep']) assert.match(remove, new RegExp(`data-testid="${hook}"`));
  // What brings the wallet back is tied to "Remove it": Tab passes over a paragraph, and a screen
  // reader says a button's description when the button takes focus.
  assert.match(remove, /<p id="\{id\}-back" data-testid="remove-back">/);
  assert.match(remove, /data-testid="remove-confirm" class="w-full sm:w-auto" aria-describedby="\{id\}-back" onclick=\{remove\}/);
});

test('remove: opening the question does not move the page under the finger, and "Remove it" waits a moment', () => {
  const remove = code(source('keys/RemoveWallet.svelte'));
  // Focus alone would bring the question to the middle of the screen. It is focused without a scroll,
  // and the whole question, both answers included, is then brought on screen by the shortest way.
  assert.match(remove, /question\?\.focus\(\{ preventScroll: true \}\);\s*box\?\.scrollIntoView\(\{ block: 'nearest' \}\);/);
  assert.doesNotMatch(remove, /question\?\.focus\(\)/);
  assert.match(remove, /<div bind:this=\{box\}>\s*<Notice kind="caution" data-testid="remove-question">/);
  // The moment the question opens is noted, and the first thing either answer does is ask whether the press counts.
  assert.match(remove, /askedAt = performance\.now\(\);\s*await tick\(\);/);
  assert.match(remove, /function tooSoon\(event: MouseEvent\): boolean \{\s*return !answerCounts\(performance\.now\(\) - askedAt, event\);/);
  assert.match(remove, /function remove\(event: MouseEvent\): void \{\s*if \(tooSoon\(event\)\) return;/);
  assert.match(remove, /function keep\(event: MouseEvent\): void \{\s*if \(tooSoon\(event\)\) return;/);
});

// -- the house rules, kept in these tables too ---------------------------------------------

test('a problem gives the cause and then the way out', () => {
  const problems: ['backup' | 'settings', string][] = [
    ['backup', 'revealFailed'],
    ['settings', 'removeGone'],
    ['settings', 'descriptorsFailed'],
  ];
  for (const [area, key] of problems) {
    for (const lang of LANGS) {
      const text = (strings[area][lang] as Table)[key] ?? '';
      assert.ok(sentences(text).length >= 2, `${area}.${lang}.${key}`);
      assert.ok(text.endsWith('.'), `${area}.${lang}.${key}`);
    }
  }
  // Where the fault may be ours, the sentence says so.
  assert.match(strings.settings.en.descriptorsFailed, /on our side/);
  assert.match(strings.settings.es.descriptorsFailed, /nuestra/);
  // "gone" removed nothing, and says so before anything else.
  assert.match(strings.settings.en.removeGone, /so nothing was removed\./);
  assert.match(strings.settings.es.removeGone, /así que no se quitó nada\./);
});

test('one word per thing: removed (never deleted), wallet fingerprint, the 12 words, llave de acceso', () => {
  for (const area of ['backup', 'settings'] as const) {
    for (const [key, text] of Object.entries(strings[area].en as Table)) {
      assert.doesNotMatch(text, /\bdelet/i, `${area}.${key}`);
      assert.doesNotMatch(text, /\bpending\b/i, `${area}.${key}`);
      for (const hit of text.matchAll(/\S*\s?fingerprints?/gi)) assert.match(hit[0], /^wallet fingerprints?$/i, `${area}.${key}`);
      assert.doesNotMatch(text, /recovery phrase|mnemonic|seed words|secret phrase|backup phrase/i, `${area}.${key}`);
      assert.doesNotMatch(text, /\b(testnet|sandbox|test coins|free bitcoin)\b/i, `${area}.${key}`);
    }
    for (const [key, text] of Object.entries(strings[area].es as Table)) {
      assert.doesNotMatch(text, /\bpendiente/i, `${area}.${key}`);
      for (const hit of text.matchAll(/huellas?(\s+\S+){0,3}/gi)) assert.match(hit[0], /^huellas? de la billetera/i, `${area}.${key}`);
      // A passkey is "llave de acceso"; a Bitcoin key is "clave". A wallet is "billetera".
      assert.doesNotMatch(text, /clave de (acceso|paso)|llave (pública|privada)|\b(cartera|monedero)\b|copia de seguridad/i, `${area}.${key}`);
    }
  }
  // "Quitar" is the Spanish for taking the wallet out of this browser.
  assert.match(strings.settings.es.removeButton, /^Quitar /);
  assert.match(strings.settings.es.removeTitle, /^Quitar /);
});

test('Spanish: the first mention of a passkey in a screen\'s own text carries the English word, and no later one does', () => {
  /**
   * Holds one screen to the rule. `shown` is the keys of the screen's table in the order the screen
   * shows them, for one kind of wallet or one step. The first of them that names a passkey says
   * "llave de acceso (passkey)"; the ones after it say "llave de acceso" alone.
   */
  const firstMentionOnly = (table: Table, shown: readonly string[], what: string): void => {
    let glossed: string | null = null;
    for (const key of shown) {
      const text = table[key];
      assert.ok(text !== undefined, `${what}: no key ${key}`);
      if (!/llaves? de acceso/.test(text)) continue;
      const withWord = /llave de acceso \(passkey\)/.test(text);
      if (glossed === null) {
        assert.ok(withWord, `${what}: ${key} is the first to name a passkey, and does not carry the English word`);
        glossed = key;
      } else {
        assert.ok(!withWord, `${what}: ${key} carries the English word again, after ${glossed}`);
      }
      assert.equal(text.match(/\(passkey\)/g)?.length ?? 0, withWord ? 1 : 0, `${what}: ${key}`);
    }
  };

  // Settings, top to bottom, for each kind of wallet.
  const settings: Table = strings.settings.es;
  const facts = ['walletTitle', 'kind'];
  const after = ['since', 'firstAddress'];
  const descriptors = [
    'descriptorsTitle', 'descriptorsWhat', 'descriptorsUse', 'descriptorReceive', 'descriptorReceiveCopy', 'descriptorReceiveCopied',
    'descriptorChange', 'descriptorChangeCopy', 'descriptorChangeCopied', 'descriptorsFailed',
  ];
  const remove = ['removeTitle', 'removeLead', 'removeDrill', 'removeGone', 'removeButton', 'removeAsk'];
  const answers = ['removeShowWords', 'removeYes', 'removeNo'];
  const passkeyWallet = [
    ...facts, 'kindPasskey', 'passkeyTag', 'passkeyTagUnknown', ...after, 'passkeyTagIs', 'passkeyTagUnknownIs',
    'keepsTitle', 'keepsPublic', 'keepsPasskey', 'keepsPromise', ...descriptors, ...remove, 'removeBackPasskey', ...answers,
  ];
  const wordsWallet = [
    ...facts, 'kindWords', ...after,
    'keepsTitle', 'keepsPublic', 'keepsWords', 'keepsPersisted', 'keepsNotPersisted', 'keepsPromise', ...descriptors, ...remove, 'removeBackWords', ...answers,
  ];
  firstMentionOnly(settings, passkeyWallet, 'Settings, a passkey wallet');
  firstMentionOnly(settings, wordsWallet, 'Settings, a wallet kept with its words');
  // No key of the table escapes the rule.
  assert.deepEqual([...new Set([...passkeyWallet, ...wordsWallet])].sort(), Object.keys(settings).sort());
  // The kind row is the first to name a passkey on either screen.
  assert.match(settings.kindPasskey ?? '', /llave de acceso \(passkey\)/);
  assert.match(settings.kindWords ?? '', /llave de acceso \(passkey\)/);

  // Backup, step by step. The practice sheet and the exception close every step.
  const backup: Table = strings.backup.es;
  const card = ['cardTitle', 'cardLead', 'cardName', 'cardNoCopies', 'cardNoSharing', 'cardRestores', 'cardPrint'];
  const madePasskey = [
    'madeTitle', 'madeLede', 'madePasskeyTitle', 'madePasskeyName', 'madePasskeyNameIs', 'madePasskeyTag', 'madePasskeyTagIs', 'madePasskeyWhere',
    'shownTitle', 'spokenAloud', 'after', 'madePasskeyBack', 'exception', 'neverRealMoney', 'chapterLink', ...card, 'written',
  ];
  const madeWords = [
    'madeTitle', 'madeLede', 'shownTitle', 'spokenAloud', 'after', 'madeKeepsTitle', 'madeKeepsWords', 'madeKeepsWho',
    'madeKeepsCleared', 'madeNotPersisted', 'exception', 'neverRealMoney', 'chapterLink', ...card, 'written',
  ];
  const ask = ['wordsTitle', 'wordsWithdrawn', 'exception', 'chapterLink', 'before', 'spokenAloud', 'revealFailed', 'show', ...card];
  const unlock = ['unlockWhy', ...card];
  const shown = ['shownTitle', 'hide', 'after', 'neverRealMoney', ...card];
  firstMentionOnly(backup, madePasskey, 'Backup, "Wallet made" with a passkey');
  firstMentionOnly(backup, madeWords, 'Backup, "Wallet made" without a passkey');
  firstMentionOnly(backup, ask, 'Backup, before the words');
  firstMentionOnly(backup, unlock, 'Backup, the unlock step');
  firstMentionOnly(backup, shown, 'Backup, the words shown');
  assert.deepEqual([...new Set([...madePasskey, ...madeWords, ...ask, ...unlock, ...shown])].sort(), Object.keys(backup).sort());
  assert.match(strings.backup.es.madePasskeyTitle, /llave de acceso \(passkey\)/);
  assert.match(strings.backup.es.unlockWhy, /llave de acceso \(passkey\)/);
});

test('Spanish: buttons are infinitives', () => {
  assert.match(strings.backup.es.show, /^Mostrar /);
  assert.match(strings.backup.es.hide, /^Ocultar/);
  assert.match(strings.backup.es.cardPrint, /^Imprimir /);
  assert.match(strings.settings.es.descriptorReceiveCopy, /^Copiar /);
  assert.match(strings.settings.es.descriptorChangeCopy, /^Copiar /);
});

test('the Spanish is Spanish: no sentence was left in English', () => {
  for (const area of ['backup', 'settings'] as const) {
    const en: Table = strings[area].en;
    const es: Table = strings[area].es;
    for (const key of Object.keys(en)) {
      if ((en[key] ?? '').split(' ').length >= 3) assert.notEqual(es[key], en[key], `${area}.${key}`);
    }
  }
});

// -- the screens' own source ---------------------------------------------------------------

test('no screen reaches around the wallet, and nothing the security policy would refuse is written', () => {
  for (const { name, text } of files) {
    for (const banned of [/localStorage/, /sessionStorage/, /indexedDB/, /navigator\.credentials/, /\bfetch\s*\(/, /XMLHttpRequest/]) {
      assert.doesNotMatch(text, banned, name);
    }
    for (const banned of [/\sstyle=/, /<style/, /\{@html/, /\son:[a-z]+=/, /export let /, /<slot/]) {
      assert.doesNotMatch(text, banned, name);
    }
    // No screen imports the wallet itself, or anything from the development gallery.
    assert.doesNotMatch(text, /wallet\.svelte\.ts|\/dev\//, name);
    // English source is plain ASCII.
    assert.match(text, /^[\x09\x0a\x20-\x7e]*$/, name);
  }
});

test('the 12 words meet no regular expression, no copy control and no download in the screens that hold them', () => {
  for (const name of ['Backup.svelte', 'keys/PracticeCard.svelte']) {
    const text = code(source(name));
    // A pattern that has matched keeps the text it ran on where any script in the page can read it.
    assert.doesNotMatch(text, /\.(match|matchAll|replace|replaceAll|split|search|test|exec)\(|new RegExp/, name);
    assert.doesNotMatch(text, /CopyButton|clipboard|download|Blob|createObjectURL/, name);
  }
  const backup = source('Backup.svelte');
  // The words come from the wallet at the moment they are shown, and go to the shared list as they came.
  assert.equal(backup.match(/wallet\.revealWords\(\)/g)?.length, 1);
  assert.match(backup, /<WordsList \{words\} \/>/);
  // They are dropped when the screen is left.
  assert.match(backup, /onDestroy\(\(\) => \{\s*left = true;\s*drop\(\);/);
  // The practice sheet is the one thing marked for paper, and it holds no word.
  const card = code(source('keys/PracticeCard.svelte'));
  assert.match(card, /data-print="only"/);
  assert.doesNotMatch(card, /words=|revealWords|useWallet/);
  const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
  assert.match(css, /@media print \{\s*\[data-print="never"\] \{\s*display: none !important;/);
  assert.match(css, /body:has\(\[data-print="only"\]\) :not\(:has\(\[data-print="only"\]\), \[data-print="only"\], \[data-print="only"\] \*\) \{\s*display: none !important;/);
});

test('the passkey\'s whole name is built nowhere in these screens: the wallet hands it over, or the tag stands for it', () => {
  // The name was written in the language the page had at the moment the passkey was made. Only the
  // wallet has it, as it wrote it (WalletApi.createdName), and only until the "Wallet made" step
  // ends. A whole name built here, in the language this screen happens to be in, could be one the
  // reader's password manager does not list.
  for (const { name, text } of files) {
    assert.doesNotMatch(code(text), /passkeyName\b|passkeyFullName/, name);
  }
  const backup = source('Backup.svelte');
  assert.match(backup, /let madeName = \$derived\(wallet\.createdName\);/);
  assert.equal(backup.match(/wallet\.createdName/g)?.length, 1, 'read in one place, and nowhere changed or rebuilt');
  const made = backup.slice(backup.indexOf("{#if wallet.created === 'passkey'}"), backup.indexOf('<Section title={t.shownTitle}>'));
  // Where the wallet has the name: the name itself, marked so that no translating browser touches
  // it, and what it is.
  assert.match(
    made,
    /\{#if madeName !== null\}[\s\S]*?<Row name=\{t\.madePasskeyName\}>\s*<span translate="no" data-testid="passkey-name">\{madeName\}<\/span>/,
  );
  assert.match(made, /\{#if madeName !== null\}\s*<p>\{t\.madePasskeyNameIs\}<\/p>/);
  // Where it has none: the tag, and what the tag is.
  assert.match(made, /\{:else if tag !== null\}[\s\S]*?<Row name=\{t\.madePasskeyTag\}>\s*<Mono value=\{tag\} data-testid="passkey-tag" \/>/);
  assert.match(made, /\{:else if tag !== null\}\s*<p>\{t\.madePasskeyTagIs\}<\/p>/);
  for (const lang of LANGS) {
    const t = strings.backup[lang];
    // No slot for a name in any of them, and none of the name's own words.
    for (const key of ['madePasskeyName', 'madePasskeyNameIs', 'madePasskeyTag', 'madePasskeyTagIs'] as const) {
      assert.deepEqual(slotNames(t[key]), [], `${lang}.${key}`);
      assert.doesNotMatch(t[key], /no real money|sin dinero de verdad|Practice wallet|Billetera de práctica/, `${lang}.${key}`);
    }
  }
  // The line under the name: whose name it is, where the reader meets it, and what the code in it is for.
  assert.match(strings.backup.en.madePasskeyNameIs, /^This page gave the passkey this name when it made it/);
  assert.match(strings.backup.en.madePasskeyNameIs, /A password manager lists the passkey under it\./);
  assert.match(strings.backup.es.madePasskeyNameIs, /^Esta página le dio este nombre a la llave de acceso/);
  // The four characters have one name on every screen: the tag ("etiqueta"). Create says so before the
  // passkey is made, "Wallet made" as it shows the name, and the Overview and the list of causes label
  // the value with the very words Settings does. "Short code" only ever says what a tag is.
  for (const lang of LANGS) {
    const noun = lang === 'en' ? /\btag\b/ : /\betiqueta\b/;
    const gloss = lang === 'en' ? /short code/ : /código corto/;
    assert.match(strings.create[lang].passkeyAsk, noun, `${lang}.passkeyAsk`);
    assert.match(strings.backup[lang].madePasskeyNameIs, noun, `${lang}.madePasskeyNameIs`);
    assert.match(strings.backup[lang].madePasskeyTagIs, noun, `${lang}.madePasskeyTagIs`);
    assert.equal(strings.wallet[lang].walletPasskeyHas, strings.settings[lang].passkeyTag, lang);
    for (const area of ['create', 'backup', 'settings', 'wallet', 'home', 'about'] as const) {
      for (const [key, text] of Object.entries(strings[area][lang] as Readonly<Record<string, string>>)) {
        if (gloss.test(text)) assert.match(text, noun, `${area}.${lang}.${key} says "short code" and not what it is the name of`);
      }
    }
  }
  assert.equal(strings.wallet.en.walletPasskeyHas, "Tag in the passkey's name");
  assert.equal(strings.wallet.es.walletPasskeyHas, 'Etiqueta en el nombre de la llave de acceso');
  // Settings shows the tag, beside the wallet fingerprint, each under its own hook.
  const settings = source('Settings.svelte');
  assert.match(settings, /<Mono value=\{record\.tag\} data-testid="passkey-tag" \/>/);
  assert.match(settings, /<Mono value=\{record\.fingerprint\} data-testid="wallet-fingerprint" \/>/);
  assert.ok(settings.indexOf('data-testid="passkey-tag"') < settings.indexOf('data-testid="wallet-fingerprint"'));
  assert.match(settings, /\{w\.walletFingerprintIs\}/);
});

test('"Wallet made" is acknowledged by its button, and by leaving the screen any other way', () => {
  const backup = source('Backup.svelte');
  // The button drops the words, ends the step, and then moves on: to the "Do it" step the reader is following
  // at the moment of the press (the step the strip shows), or to the wallet's overview when they follow none.
  assert.match(
    backup,
    /function written\(\): void \{\s*drop\(\);\s*wallet\.ackCreated\(\);\s*navigate\(router\.link\(afterWritten\(stripStep\(doit\.progress, Date\.now\(\)\)\)\)\);\s*\}/,
  );
  assert.match(backup, /<Button variant="primary" data-testid="words-written" onclick=\{written\}>\{t\.written\}<\/Button>/);
  // It is the one place of the screen that moves the reader on, and the one place that asks the steps anything.
  assert.equal(code(backup).match(/\bnavigate\(/g)?.length, 1);
  assert.equal(code(backup).match(/\bdoit\./g)?.length, 1);
  // Its words are as they were.
  assert.deepEqual([strings.backup.en.written, strings.backup.es.written], ['I have written them down', 'Ya las escribí']);
  assert.match(backup, /onDestroy\(\(\) => \{\s*left = true;\s*drop\(\);\s*if \(wallet\.created !== null\) wallet\.ackCreated\(\);/);
});

test('the words of "Wallet made" are taken once the screen is on the page, never while its script runs', () => {
  // Taking the words is what the wallet counts as "Words shown", filed under the screen the app last
  // named to its counter: this one, not Create. App.svelte names a screen before the screen's own
  // script runs (test/shell.test.ts holds it to that), and the screen takes the words only once it
  // is on the page, so the count does not rest on that order alone.
  const backup = code(source('Backup.svelte'));
  const script = backup.slice(0, backup.indexOf('</script>'));
  const calls = script.split('\n').filter((line) => /\btake\(\)/.test(line) && !/function take\(\)/.test(line));
  assert.equal(calls.length, 3, 'after a create, on "Show the 12 words", and after an unlock');
  // A statement of the script itself is indented by two spaces; one inside a function by four or more.
  for (const line of calls) assert.match(line, /^ {4,}\S/, `take() runs while the script does: ${line.trim()}`);
  assert.match(script, /onMount\(\(\) => \{\s*if \(!arriving\) return;\s*void tick\(\)\.then\(\(\) => \{\s*if \(left\) return;\s*arriving = false;\s*if \(wallet\.created !== null && !take\(\)\) wallet\.ackCreated\(\);/);
  // Until then the step is "Wallet made" already, so the heading the router moves focus to is the right one.
  assert.match(script, /let arriving = \$state\(untrack\(\(\) => wallet\.created\) !== null\);/);
  assert.match(script, /let made = \$derived\(arriving \|\| view === 'made'\);/);
  assert.match(script, /let title = \$derived\(made \? t\.madeTitle :/);
});

test('a wish for the words does not outlive the lock it was waiting on', () => {
  // The wallet can stop being locked without the unlock step calling back: another tab can put a
  // wallet that needs no passkey in this one's place. Were the wish left standing, the next lock
  // would bring the unlock step up unasked. (A switch of language while the prompt is open no
  // longer ends that way: the step goes by the screen's name, and calls back.)
  const backup = code(source('Backup.svelte'));
  assert.match(backup, /\$effect\(\(\) => \{\s*if \(!locked\) unlocking = false;\s*\}\);/);
});

test('double taps: the second click neither hides nor shows the words, and prints nothing twice', () => {
  const backup = code(source('Backup.svelte'));
  assert.match(backup, /data-testid="hide-words"\s+onclick=\{\(event\) => \{\s*if \(!isRepeatTap\(event\)\) void hide\(\);/);
  assert.match(backup, /data-testid="reveal-words"\s+aria-describedby="\{id\}-spoken"\s+onclick=\{\(event\) => \{\s*if \(!isRepeatTap\(event\)\) void show\(\);/);
  const card = code(source('keys/PracticeCard.svelte'));
  assert.match(card, /data-testid="print-card"\s+onclick=\{\(event\) => \{\s*if \(!isRepeatTap\(event\)\) window\.print\(\);/);
});
