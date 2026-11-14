// The words of the three screens in front of the wallet (strings/home.ts,
// create.ts and restore.ts), and the rules their source keeps. The rules
// every table shares (characters, key parity, matching slots) are held by
// strings.test.ts; these are the ones that belong to these screens.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import { splitLead } from '../src/components/text.ts';
import { SAFARI_KEEPS_DAYS } from '../src/components/wallet/frame.ts';
import { fill, slotNames } from '../src/lib/format.ts';
import { strings } from '../src/strings/index.ts';

type Table = Readonly<Record<string, string>>;

const AREAS = ['home', 'create', 'restore'] as const;

/** A source file of these screens, as text. */
function source(name: string): string {
  return readFileSync(new URL(`../src/screens/${name}`, import.meta.url), 'utf8');
}

/** The three screens and every file of their own folder. */
const FILES = [
  'Home.svelte',
  'New.svelte',
  'Restore.svelte',
  ...readdirSync(new URL('../src/screens/front/', import.meta.url)).map((name) => `front/${name}`),
];

// -- every key is used ----------------------------------------------------------------

test('every text of the three tables is shown somewhere, by its own key', () => {
  // Where each table is read, and under which name: t.lede, h.hereUnseen.
  const readers: Record<(typeof AREAS)[number], [file: string, name: string][]> = {
    home: [
      ['Home.svelte', 't'],
      ['front/WalletHere.svelte', 't'],
      ['front/FrontGate.svelte', 'h'],
    ],
    create: [['New.svelte', 't']],
    restore: [['Restore.svelte', 't']],
  };
  // Two lines are picked by what kind of wallet is here: flow.ts names their keys, and WalletHere reads t[line.key].
  const picked = ['herePasskey', 'hereWords'];
  assert.match(source('front/WalletHere.svelte'), /t\[line\.key\]/);

  for (const area of AREAS) {
    for (const [file, name] of readers[area]) {
      assert.ok(source(file).includes(`strings.${area}[router.lang]`), `${file} reads strings.${area}`);
      assert.match(source(file), new RegExp(`let ${name} = \\$derived\\(strings\\.${area}\\[router\\.lang\\]\\)`), file);
    }
    for (const key of Object.keys(strings[area].en)) {
      const used = readers[area].some(([file, name]) => new RegExp(`\\b${name}\\.${key}\\b`).test(source(file)));
      const named = picked.includes(key) && source('front/flow.ts').includes(`key: '${key}'`);
      assert.ok(used || named, `strings.${area}.${key} is shown nowhere`);
    }
  }
});

// -- the sentences the spec and the notes give word for word ---------------------------

test('the words the spec gives are the words on the screens', () => {
  const { home, create, restore } = strings;
  assert.equal(home.en.hereOpen, 'Open my practice wallet');
  assert.equal(create.en.finishGo, 'Finish setting up');
  assert.equal(create.en.passkeyChecking, 'Checking this browser...');
  assert.equal(restore.en.emptyTitle, 'No practice coins found for these words');
  assert.equal(restore.en.keep, 'Keep them here anyway');
  assert.equal(restore.en.erase, 'Erase');
  assert.equal(restore.en.looking, "Looking for these words' practice coins...");
  // Calibration (notes/06 sections 5.1, 5.2 and 5.9).
  assert.equal(create.en.passkeyGo, 'Create with a passkey');
  assert.equal(create.en.wordsGo, 'Create without a passkey');
  assert.equal(create.en.cancelledNothing, 'No passkey was saved and no wallet was made.');
  assert.equal(create.en.foot, 'Practice only. This wallet cannot hold real bitcoin.');
  assert.equal(restore.en.go, 'Restore');
  assert.equal(create.es.cancelledNothing, 'No se guardó ninguna llave de acceso y no se creó ninguna billetera.');
});

test('restore carries the exception paragraph, the line about real money and the box, as the notes word them', () => {
  const { en, es } = strings.restore;
  assert.equal(
    en.exception,
    'Chapter 4 of the Journey says never to type your seed into a website, and that a page asking for it is a scam. This page is the one exception, because the 12 words it asks for only guard play money, practice coins that are worth nothing. The words of a wallet that holds real bitcoin never go into a web page, this one included.',
  );
  assert.equal(
    es.exception,
    'El capítulo 4 del Recorrido dice que nunca escribas tu frase semilla en un sitio web, y que una página que te la pide es una estafa. Esta página es la única excepción, porque las 12 palabras que pide solo protegen dinero de juguete, monedas de práctica que no valen nada. Las palabras de una billetera con bitcoin de verdad nunca van en una página web, incluida esta.',
  );
  assert.equal(
    en.never,
    'Never put real money on these 12 words. Words that have been on a web page are for practice only: a real wallet should make its own.',
  );
  assert.match(es.never, /^Nunca pongas dinero de verdad en estas 12 palabras\./);
  assert.equal(en.check, 'These 12 words are from a practice wallet, not from a wallet with real bitcoin.');
  assert.equal(es.check, 'Estas 12 palabras son de una billetera de práctica, no de una billetera con bitcoin de verdad.');
  // The reason is about the words, never about the page: no sentence argues that this page can be trusted.
  for (const lang of LANGS) {
    for (const [key, text] of Object.entries(strings.restore[lang])) {
      assert.doesNotMatch(text, /\bsafe\b|\bsecure\b|\bsegur[oa]s?\b|trust|confia/i, `${lang}.${key}`);
    }
  }
});

test('the line that says which wallet is here is true of every wallet of its kind', () => {
  const { en, es } = strings.home;
  // Kept without a passkey: a wallet made that way, and also one restored from its 12 words (which
  // may have been made with a passkey somewhere else). So the line says how it is kept, not how it was made.
  assert.equal(en.hereWords, 'It works without a passkey, because its 12 words are kept in this browser.');
  assert.doesNotMatch(en.hereWords, /\bmade\b/);
  assert.doesNotMatch(es.hereWords, /\bcre[óo]\b/);
  // Kept with a passkey: made with one, here or elsewhere, and pointed out by its tag alone.
  assert.equal(fill(en.herePasskeyTagged, { tag: 'K7Q2' }), 'It was made with a passkey, the one with "K7Q2" in its name.');
  assert.equal(fill(es.herePasskeyTagged, { tag: 'K7Q2' }), 'Se creó con una llave de acceso (passkey), la que tiene "K7Q2" en su nombre.');
});

test('restore says before the fields that the words will be kept here, not encrypted', () => {
  assert.match(strings.restore.en.kept, /kept in this browser, not encrypted/);
  assert.match(strings.restore.es.kept, /guardadas en este navegador, sin cifrar/);
  assert.match(strings.create.en.wordsKept, /keep them in this browser, not encrypted/);
  assert.match(strings.create.es.wordsKept, /en este navegador, sin cifrar/);
  // And who can then use the wallet (SPEC section 12).
  assert.match(strings.create.en.wordsKept, /Anyone who uses this browser can open the wallet/);
  assert.match(strings.restore.en.kept, /Anyone who uses this browser can then open the wallet/);
});

test('both ways to a wallet whose words are kept here say that a browser can erase them (SPEC section 5)', () => {
  // Create says it before the tap. A restored wallet never passes the "Wallet made" step, so Restore says it too.
  for (const text of [strings.create.en.wordsErased, strings.restore.en.kept]) {
    assert.match(text, /A browser can also erase them/);
    assert.match(text, /Safari does if you go \{days\} days without using the site/);
  }
  for (const text of [strings.create.es.wordsErased, strings.restore.es.kept]) {
    assert.match(text, /Un navegador también puede borrarlas/);
    assert.match(text, /Safari lo hace si pasas \{days\} días sin usar el sitio/);
  }
  assert.match(strings.restore.en.kept, /keep your paper copy/);
  assert.match(strings.restore.es.kept, /conserva tu copia en papel/);
  assert.match(source('Restore.svelte'), /fill\(t\.kept, \{ days: String\(SAFARI_KEEPS_DAYS\) \}\)/);
});

test('the step after a restore that found nothing says what to do with a real wallet\'s words', () => {
  const { en, es } = strings.restore;
  // Not stored; close the page; that wallet is not affected (SPEC section 6).
  assert.match(en.emptyReal, /real wallet/);
  assert.match(en.emptyReal, /close this page/);
  assert.match(en.emptyReal, /have not been stored/);
  assert.match(en.emptyReal, /not affected/);
  assert.match(es.emptyReal, /cierra esta página/);
  assert.match(es.emptyReal, /No se guardaron/);
  assert.match(en.emptyBody, /Nothing has been stored\.$/);
  // The network was asked about addresses, never about the words, and the step says so: a reader who
  // typed a real wallet's words must not be left thinking they were sent anywhere.
  assert.match(en.emptyBody, /at the addresses these 12 words give/);
  assert.match(en.emptyBody, /The words themselves did not leave this browser\./);
  assert.doesNotMatch(en.emptyBody, /record of these 12 words/);
  assert.match(es.emptyBody, /en las direcciones que dan estas 12 palabras/);
  assert.match(es.emptyBody, /Las palabras no salieron de este navegador\./);
  assert.doesNotMatch(es.emptyBody, /registro de estas 12 palabras/);
});

test('home says what this is: a working wallet, on the practice network, with play money, before real money is at stake', () => {
  const { en, es } = strings.home;
  assert.match(en.lede, /working Bitcoin wallet on LearnBitcoin's practice network/);
  assert.match(en.lede, /play money with no value/);
  assert.match(en.lede, /before real money is at stake/);
  assert.match(es.lede, /red de práctica de LearnBitcoin/);
  assert.match(es.lede, /dinero de juguete/);
  // Two or three sentences, not more: the page is not a wall of text.
  for (const lang of LANGS) assert.ok(strings.home[lang].lede.split(/\. (?=[A-ZÁÉÍÓÚÑ])/).length <= 3, lang);
});

// -- facts are slots --------------------------------------------------------------------

test('facts are slots, never numbers or names written into a sentence', () => {
  for (const lang of LANGS) {
    const { home, create, restore } = strings;
    assert.deepEqual(slotNames(home[lang].haveWhy), ['days'], lang);
    assert.deepEqual(slotNames(home[lang].facts).sort(), ['sats', 'seconds'], lang);
    assert.deepEqual(slotNames(home[lang].herePasskeyTagged), ['tag'], lang);
    assert.deepEqual(slotNames(create[lang].passkeyAsk), ['name'], lang);
    assert.deepEqual(slotNames(create[lang].wordsErased), ['days'], lang);
    assert.deepEqual(slotNames(create[lang].unfinishedTagged), ['tag'], lang);
    assert.deepEqual(slotNames(create[lang].noPrfDeleteTagged).sort(), ['host', 'tag'], lang);
    assert.deepEqual(slotNames(create[lang].noPrfDelete), ['host'], lang);
    assert.deepEqual(slotNames(create[lang].unfinished), [], lang);
    assert.deepEqual(slotNames(restore[lang].kept), ['days'], lang);
    for (const area of AREAS) {
      for (const [key, text] of Object.entries(strings[area][lang] as Table)) {
        const where = `${area}.${lang}.${key}`;
        // No block interval, no faucet amount, no count of days, no host name.
        assert.doesNotMatch(text, /\b30\b|100,000|\b7\b|learnbitcoin\.com|localhost/, where);
        // The passkey's name is the wallet module's to write: no sentence here spells it out.
        assert.doesNotMatch(text, /Practice wallet [A-Z0-9{]|Billetera de práctica [A-Z0-9{]/, where);
      }
    }
    // The two that speak of a count of 12 mean the wallet's words, which is a fixed fact of Bitcoin's word lists.
    assert.match(restore[lang].lede, /12/, lang);
  }
  // The Safari sentence on Home is the gate's, shortened, with the same fact in the same place.
  assert.match(fill(strings.home.en.haveWhy, { days: String(SAFARI_KEEPS_DAYS) }), /Safari does after 7 days without use/);
});

// -- words that are held to ----------------------------------------------------------------

test('one word per thing: unconfirmed, wallet fingerprint, practice coins, and no account words for the wallet', () => {
  for (const area of AREAS) {
    for (const [key, text] of Object.entries(strings[area].en as Table)) {
      const where = `${area}.en.${key}`;
      assert.doesNotMatch(text, /\bpending\b/i, where);
      // A fingerprint is always a wallet fingerprint. (These screens never need the word.)
      for (const hit of text.matchAll(/\S*\s?fingerprints?/gi)) assert.match(hit[0], /^wallet fingerprints?$/i, where);
      assert.doesNotMatch(text, /\btest coins?\b|\btBTC\b|\bfree bitcoin\b|\btokens?\b|\bfunds\b|\bseed words\b|recovery phrase|\bmnemonic\b/i, where);
      // No exclamation, no cheering, no minimizers (notes/06 section 1.4).
      assert.doesNotMatch(text, /\b(simply|just|seamless|effortless|awesome|great)\b|^Let's\b/i, where);
      // There is no account. The device's own prompt may still say "signing in": one sentence allows for it.
      if (where !== 'create.en.passkeyAsk') {
        assert.doesNotMatch(text, /\b(account|sign(ing)? (in|up)|log(ging)? in|register|username|user)\b/i, where);
      }
      // A wallet is removed from this browser. Only a passkey, in a password manager, is deleted.
      if (/\bdelet/i.test(text)) assert.match(text, /passkey/i, where);
    }
    for (const [key, text] of Object.entries(strings[area].es as Table)) {
      const where = `${area}.es.${key}`;
      assert.doesNotMatch(text, /\bpendiente/i, where);
      assert.doesNotMatch(text, /\bcartera\b|\bmonedero\b|copia de seguridad|\btarifa\b|\busted\b/i, where);
      // A Bitcoin key is "clave"; "llave" is only ever the passkey: "llave de acceso", or "la llave" right after it.
      for (const hit of text.matchAll(/\bllaves?\b(?! de acceso)/gi)) {
        assert.match(text, /llave de acceso/, `${where}: ${hit[0]}`);
      }
    }
  }
  assert.match(strings.create.en.passkeyAsk, /It may call this signing in\. There is no account behind it\./);
});

test('the privacy wording: what is not sent is said of us, and nothing claims that nothing leaves the browser', () => {
  assert.equal(strings.create.en.passkeySent, 'Neither the passkey nor the 12 words are sent to us.');
  assert.equal(strings.create.es.passkeySent, 'Ni la llave de acceso ni las 12 palabras se nos envían.');
  for (const lang of LANGS) {
    for (const area of AREAS) {
      for (const [key, text] of Object.entries(strings[area][lang] as Table)) {
        assert.doesNotMatch(text, /nothing leaves|nothing is sent|nada sale|no se envía nada|who you are|quién eres/i, `${area}.${lang}.${key}`);
      }
    }
  }
});

test('a refusal gives the cause and then the way out', () => {
  const problems: [(typeof AREAS)[number], string][] = [
    ['home', 'hereUnseen'],
    ['home', 'hereOne'],
    ['create', 'passkeyNotOffered'],
    ['create', 'unfinishedAgain'],
    ['create', 'wordsFailed'],
    ['restore', 'keepRefused'],
    ['restore', 'lost'],
  ];
  for (const lang of LANGS) {
    for (const [area, key] of problems) {
      const text = (strings[area][lang] as Table)[key] ?? '';
      const { lead, rest } = splitLead(text);
      assert.ok(lead.endsWith('.') && rest.endsWith('.') && rest.length > 10, `${area}.${lang}.${key}`);
    }
  }
  // What follows a sentence from the error table is whole sentences too.
  for (const lang of LANGS) {
    const t = strings.create[lang];
    for (const key of ['cancelledNothing', 'cancelledWays', 'stillWaiting', 'noPrfElsewhere', 'orphan'] as const) {
      assert.ok(t[key].endsWith('.'), `${lang}.${key}`);
    }
    assert.ok(strings.restore[lang].failedKept.endsWith('.'), lang);
  }
  // After a cancelled prompt and after a passkey that cannot make a wallet, the other way on is named.
  assert.match(strings.create.en.cancelledWays, /when this tab is not in front/);
  assert.match(strings.create.en.cancelledWays, /without a passkey/);
  assert.match(strings.create.en.unfinishedAgain, /without a passkey/);
  assert.match(strings.create.en.noPrfDeleteTagged, /delete it/);
});

test('what is said of a passkey holds whatever the password manager has done with it', () => {
  const { en, es } = strings.create;
  // A passkey without the secret: the page has already asked the password manager to drop it, and some
  // do. So the reader is not told to go and find it, only what to do if it is still listed.
  for (const key of ['noPrfDeleteTagged', 'noPrfDelete'] as const) {
    assert.match(en[key], /^Your password manager may already have deleted that passkey\. If it is still listed there /, key);
    assert.match(en[key], /delete it: it is of no use now\.$/, key);
    assert.doesNotMatch(en[key], /To delete it, open/, key);
    assert.match(es[key], /^Puede que tu administrador de contraseñas ya haya borrado esa llave de acceso\. Si todavía aparece ahí /, key);
    assert.match(es[key], /bórrala: ya no sirve\.$/, key);
  }
  // A passkey that waits to be set up is held in memory only: a reload forgets it, and Create would then
  // save a second one. The line says to finish first, and why. It does not say the passkey must be
  // deleted: "Open with my passkey" still makes its wallet (a scenario holds that).
  for (const key of ['unfinishedTagged', 'unfinished'] as const) {
    assert.match(en[key], /One more confirmation finishes it\. Do that before you reload or close this page: /, key);
    assert.match(en[key], /a fresh page will not know that this passkey is waiting\.$/, key);
    assert.doesNotMatch(en[key], /delet/, key);
    assert.match(es[key], /Hazlo antes de recargar o cerrar esta página: /, key);
    assert.match(es[key], /no sabrá que esta llave de acceso está esperando\.$/, key);
    assert.doesNotMatch(es[key], /borr/, key);
  }
});

test('the Spanish is Spanish', () => {
  for (const area of AREAS) {
    const en: Table = strings[area].en;
    const es: Table = strings[area].es;
    for (const key of Object.keys(en)) {
      const text = en[key] ?? '';
      if (text.split(' ').length >= 4) assert.notEqual(es[key], text, `${area}.${key}`);
    }
  }
  // The passkey is "llave de acceso", with "(passkey)" where a screen first names it.
  assert.match(strings.create.es.passkeyTitle, /llave de acceso \(passkey\)/);
  assert.match(strings.home.es.herePasskey, /llave de acceso \(passkey\)/);
  assert.match(strings.home.es.hereOne, /quita esta en Configuración/);
});

// -- the source of the screens ---------------------------------------------------------------

test('no screen reaches around the wallet, or writes what the security policy refuses', () => {
  assert.ok(FILES.length >= 6, 'the walk found the screens and their folder');
  for (const name of FILES) {
    const text = source(name);
    for (const banned of [/localStorage/, /sessionStorage/, /indexedDB/, /navigator\.credentials/, /\bfetch\s*\(/, /XMLHttpRequest/]) {
      assert.doesNotMatch(text, banned, name);
    }
    for (const banned of [/\sstyle=/, /<style/, /\{@html/, /\son:[a-z]+=/, /export let /, /<slot/, /wallet\.svelte\.ts/]) {
      assert.doesNotMatch(text, banned, name);
    }
    // English source is plain ASCII.
    assert.match(text, /^[\x09\x0a\x20-\x7e]*$/, name);
  }
});

test('the 12 words are handed to the wallet as they come: nothing on Restore runs a regular expression or keeps them', () => {
  const text = source('Restore.svelte');
  // A regular expression run over the words would leave them in RegExp.input.
  assert.doesNotMatch(text, /new RegExp|\.(match|matchAll|replace|replaceAll|search|split|test|exec)\(/);
  // The words go from the fields to the wallet in one line, and into no state.
  assert.match(text, /const words = input\?\.check\(\) \?\? null;/);
  assert.match(text, /busyWhile\(wallet\.restore\(words\)\)/);
  assert.doesNotMatch(text, /\$state[^\n]*\bwords\b/);
  // The shared fields are used, with the hooks the spec names.
  for (const hook of ['restore-words', 'restore-check', 'restore-go', 'restore-keep', 'restore-erase']) {
    assert.ok(text.includes(`data-testid="${hook}"`), hook);
  }
  // Words that wait for a choice do not outlive the screen.
  assert.match(text, /onDestroy\(\(\) => \{\s*gone = true;\s*if \(wallet\.pendingRestore\) wallet\.eraseRestored\(\);/);
});

test('Restore shows the step only for words its own visit asked about, and an old answer goes with the next press', () => {
  const text = source('Restore.svelte');
  // The wallet's "words are waiting" alone does not open the step: a look can outlive the visit that started it.
  assert.match(text, /let pending = \$derived\(own && wallet\.pendingRestore\);/);
  assert.doesNotMatch(text, /\{#if wallet\.pendingRestore\}/);
  const go = text.slice(text.indexOf('async function go()'), text.indexOf('function keep()'));
  // The visit lets go of older words as its look starts, and takes the words its own look left waiting.
  assert.match(go, /busy = true;\s*own = false;/);
  assert.match(go, /case 'empty':[^}]*?own = true;/s);
  // What an earlier try was answered with is taken away before the form's own checks can stop this one.
  assert.ok(go.indexOf('problem = null;') !== -1 && go.indexOf('problem = null;') < go.indexOf('input?.check()'));
  // Focus leaves the fields before they are switched off, and the button says what the page is doing.
  assert.ok(go.indexOf("within('restore-go')?.focus()") < go.indexOf('busy = true;'));
  assert.match(text, /busyText=\{t\.looking\}/);
});

test('every wait on Create marks <main> busy, and the hooks of the spec are on its buttons', () => {
  const text = source('New.svelte');
  for (const call of ['createWithPasskey', 'finishSetup', 'createWithWords']) {
    const lines = text.split('\n').filter((line) => line.includes(`wallet.${call}(`) && !line.trim().startsWith('//'));
    assert.equal(lines.length, 1, call);
    assert.match(lines[0] ?? '', /await busyWhile\(wallet\./, call);
  }
  for (const hook of ['create-passkey', 'create-words', 'finish-setup']) {
    assert.ok(text.includes(`data-testid="${hook}"`), hook);
  }
  // The passkey's whole name is never built here: only its start is shown, before there is a tag.
  assert.doesNotMatch(text, /fill\(c\.passkeyName/);
  assert.match(text, /passkeyNameStart\(c\.passkeyName\)/);
  // Why the passkey button waits is never written on the button: a switched-off button fades its words.
  assert.doesNotMatch(text, /\? t\.passkeyChecking :/);
  assert.match(text, /<Waiting inline text=\{t\.passkeyChecking\} data-testid="create-checking" \/>/);
});

test('Home keeps the fixed document title, and shows the shared pieces for the states it does not own', () => {
  const text = source('Home.svelte');
  assert.match(text, /documentTitle=\{c\.homeTitle\}/);
  assert.match(text, /<OpenWithPasskey variant="secondary" onopened=\{opened\} \/>/);
  assert.match(text, /<StoredTrouble titled/);
  // The two facts come from the settings.
  assert.match(text, /wallet\.config\.blockSeconds/);
  assert.match(text, /wallet\.config\.faucetSats/);
});
