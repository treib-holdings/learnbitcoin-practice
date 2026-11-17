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

/** The sentences of a text, split where a full stop is followed by a capital. */
const sentences = (text: string): string[] => text.split(/(?<=\.) (?=[A-ZÁÉÍÓÚÑ¿])/);

/** How many words a text has. */
const wordCount = (text: string): number => text.trim().split(/\s+/).length;

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

test('restore carries the exception paragraph, the line about real money and the box, word for word', () => {
  const { en, es } = strings.restore;
  // {keysNumber} is the keys chapter's number, from the table of chapters. The paragraph also stands above
  // the three word fields of a step, where the page asks for three words: so "the words", not "the 12 words".
  // And it says "a wallet's words" from its first sentence to its last: the word every version of the chapter
  // and every screen of the wallet share.
  assert.equal(
    en.exception,
    "Chapter {keysNumber} of the Journey says never to type a wallet's words into a website, and to treat a page that asks for them as a scam. This page is the one exception, because the words it asks for only guard play money, practice coins that are worth nothing. The words of any wallet that is not a practice wallet never go into a web page, this one included. That includes the words of a wallet for real bitcoin, even an empty one.",
  );
  assert.equal(
    es.exception,
    'El capítulo {keysNumber} del Recorrido dice que nunca escribas las palabras de una billetera en un sitio web, y que trates como una estafa a cualquier página que te las pida. Esta página es la única excepción, porque las palabras que pide solo protegen dinero de juguete, monedas de práctica que no valen nada. Las palabras de una billetera que no sea de práctica nunca van en una página web, incluida esta. Eso incluye las de una billetera para bitcoin de verdad, aunque esté vacía.',
  );
  assert.equal(
    en.never,
    'Never put real money on these 12 words. Words that have been on a web page are for practice only: a real wallet should make its own.',
  );
  assert.match(es.never, /^Nunca pongas dinero de verdad en estas 12 palabras\./);
  assert.equal(en.check, 'These 12 words are from a practice wallet and from no other: not from a wallet for real bitcoin, even an empty one.');
  assert.equal(
    es.check,
    'Estas 12 palabras son de una billetera de práctica y de ninguna otra: no son de una billetera para bitcoin de verdad, ni siquiera de una que esté vacía.',
  );
  // The paragraph and its link name the keys chapter, so the screen draws both through the table of chapters.
  const screen = source('Restore.svelte');
  assert.match(
    screen,
    /<Notice kind="caution" text=\{withChapters\(t\.exception, router\.lang\)\} data-testid="restore-exception">\s*<OutLink class=\{LONE_LINK\} href=\{keysChapterUrl\(wallet\.config\.siteUrl, router\.lang\)\} text=\{withChapters\(t\.chapter, router\.lang\)\} \/>/,
  );
  // The link names the chapter by its number and, in quotation marks, its title. No colon stands before the
  // title: a title may hold a colon of its own.
  assert.equal(en.chapter, 'Chapter {keysNumber} of the Journey, "{keysTitle}"');
  assert.equal(es.chapter, 'Capítulo {keysNumber} del Recorrido, "{keysTitle}"');
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

test('the step after a restore that found nothing says what to do with words that are not practice words', () => {
  const { en, es } = strings.restore;
  // Not stored; close the page; that wallet is not affected (SPEC section 6). The text is for the words of
  // any wallet that is not a practice wallet, and names the case a scam page plays on: a wallet for real
  // bitcoin that is empty.
  assert.equal(
    en.emptyReal,
    'If they belong to a wallet that is not a practice wallet, erase them and close this page. That includes a wallet for real bitcoin, even an empty one. They have not been stored, and that wallet is not affected.',
  );
  assert.equal(
    es.emptyReal,
    'Si son de una billetera que no es de práctica, bórralas y cierra esta página. Eso incluye una billetera para bitcoin de verdad, aunque esté vacía. No se guardaron, y esa billetera no se ve afectada.',
  );
  // This is the one screen where a reader who typed such words is told what to do. So the first sentence
  // ends in the instruction, with no bracket in front of it, and the named case has a sentence of its own.
  assert.ok((sentences(en.emptyReal)[0] ?? '').endsWith(', erase them and close this page.'));
  assert.ok((sentences(es.emptyReal)[0] ?? '').endsWith(', bórralas y cierra esta página.'));
  for (const text of [en.emptyReal, es.emptyReal]) {
    assert.equal(sentences(text).length, 3, text);
    assert.doesNotMatch(text, /[()]/, text);
    assert.ok(wordCount(sentences(text)[0] ?? '') <= 20, text);
  }
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

test('wherever the wallet says which words never go into a web page, it covers every wallet that is not a practice wallet, and names an empty wallet for real bitcoin', () => {
  const { backup, restore, wallet } = strings;
  // Five texts say which words may be typed here and which never go into a web page: the two exception
  // paragraphs, the short form (also printed on the practice sheet), the box on Restore, and the sentence after
  // a restore that found nothing. A wallet for real bitcoin guards nothing on the day it is made, so "a wallet
  // that holds real bitcoin" would let a page through that says "your new wallet is empty, check it here".
  for (const [where, text] of [
    ['backup.exception', backup.en.exception],
    ['restore.exception', restore.en.exception],
    ['restore.emptyReal', restore.en.emptyReal],
    ['wallet.wordsException', wallet.en.wordsException],
  ] as const) {
    assert.ok(text.includes('wallet that is not a practice wallet'), where);
    assert.ok(text.includes('a wallet for real bitcoin, even an empty one'), where);
  }
  assert.ok(restore.en.check.includes('from a practice wallet and from no other'));
  assert.ok(restore.en.check.includes('a wallet for real bitcoin, even an empty one'));

  for (const [where, text] of [
    ['backup.exception', backup.es.exception],
    ['restore.exception', restore.es.exception],
    ['wallet.wordsException', wallet.es.wordsException],
  ] as const) {
    assert.ok(text.includes('billetera que no sea de práctica'), where);
    assert.ok(text.includes('una billetera para bitcoin de verdad, aunque esté vacía'), where);
  }
  assert.ok(restore.es.emptyReal.includes('billetera que no es de práctica'));
  assert.ok(restore.es.emptyReal.includes('una billetera para bitcoin de verdad, aunque esté vacía'));
  // The box says "not even of one that is empty", which can only be read of the wallet for real bitcoin.
  assert.ok(restore.es.check.includes('de una billetera de práctica y de ninguna otra'));
  assert.ok(restore.es.check.includes('una billetera para bitcoin de verdad, ni siquiera de una que esté vacía'));

  // No text of any table speaks of a wallet that "holds" or "has" real bitcoin, or of "a real wallet", where
  // it says whose words they are: each of those covers less than every wallet that is not a practice wallet.
  const holds = /wallet (that|which) (holds|has)\b[^.]*real (bitcoin|money)|wallet with real (bitcoin|money)|(words of|belong to) a real wallet/i;
  const tiene = /billetera (que (tiene|guarda)|con) (bitcoin|dinero) de verdad|(palabras|son) de una billetera de verdad/i;
  let texts = 0;
  for (const [area, tables] of Object.entries(strings)) {
    for (const lang of LANGS) {
      for (const [key, text] of Object.entries(tables[lang] as Table)) {
        texts += 1;
        assert.doesNotMatch(text, holds, `${area}.${lang}.${key}`);
        assert.doesNotMatch(text, tiene, `${area}.${lang}.${key}`);
      }
    }
  }
  assert.ok(texts > 1000, `${texts} texts were read`);

  // The two paragraphs and the short form end in the same two sentences, word for word: the rule, and the
  // case it names.
  const shared = {
    en: 'The words of any wallet that is not a practice wallet never go into a web page, this one included. That includes the words of a wallet for real bitcoin, even an empty one.',
    es: 'Las palabras de una billetera que no sea de práctica nunca van en una página web, incluida esta. Eso incluye las de una billetera para bitcoin de verdad, aunque esté vacía.',
  };
  for (const lang of LANGS) {
    for (const [where, text] of [
      ['backup.exception', backup[lang].exception],
      ['restore.exception', restore[lang].exception],
      ['wallet.wordsException', wallet[lang].wordsException],
    ] as const) {
      assert.ok(text.endsWith(` ${shared[lang]}`), `${lang} ${where}`);
    }
  }
  assert.equal(wallet.en.wordsException, `Practice words only. ${shared.en}`);
  assert.equal(wallet.es.wordsException, `Solo palabras de práctica. ${shared.es}`);

  // A reader meets these words just before typing some. So they are two plain sentences: neither is long,
  // neither hangs a clause without a verb on a colon, and together they say "not" or "never" twice, once for
  // the wallets the rule covers and once for the rule.
  const negations = { en: /\b(?:not|never|no|nor|neither)\b/gi, es: /(?<![a-záéíóúñ])(?:no|nunca|ni|tampoco|jamás)(?![a-záéíóúñ])/gi };
  for (const lang of LANGS) {
    const both = sentences(shared[lang]);
    assert.equal(both.length, 2, lang);
    for (const sentence of both) {
      assert.ok(wordCount(sentence) <= 20, `${lang}: ${wordCount(sentence)} words in "${sentence}"`);
      assert.ok(!sentence.includes(':'), `${lang}: ${sentence}`);
    }
    assert.equal(shared[lang].match(negations[lang])?.length, 2, lang);
  }
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

test('Create says what became of a passkey that was saved before the wallet could not be stored, under every gate that such an answer leads to', () => {
  const { en, es } = strings.create;
  assert.equal(en.orphan, 'If your device saved a new passkey a moment ago, that passkey has no wallet. You can delete it in your password manager.');
  assert.equal(es.orphan, 'Si tu dispositivo guardó una llave de acceso nueva hace un momento, esa llave no tiene billetera. Puedes borrarla en tu administrador de contraseñas.');
  // The screen hands the line to the gate when its last answer stopped it after a passkey prompt, and at no other time.
  const create = source('New.svelte');
  assert.match(create, /let orphan = \$derived\(last !== null && last\.view\.kind === 'stopped' && last\.view\.orphan\);/);
  assert.match(create, /\{#snippet orphaned\(\)\}\s*<p data-testid="create-orphan">\{t\.orphan\}<\/p>\s*\{\/snippet\}/);
  assert.match(create, /<FrontGate \{gate\} \{stop\} extra=\{orphan \? orphaned : undefined\}>/);
  assert.equal(create.match(/t\.orphan\b/g)?.length, 1);
  // The gate draws it under a wallet that is here, under "a wallet arrived" and under "this browser refuses to
  // store". And under the card for a storage the page was not let read, which stands in front of that last
  // gate: the storage can stop answering while the prompt is open, and without the line the reader would be
  // left with a passkey nobody mentions. There it comes as an alert of its own: the card is none.
  const gate = source('front/FrontGate.svelte');
  assert.match(
    gate,
    /\{:else if gate === 'trouble'\}\s*<StoredTrouble titled \/>\s*\{#if extra !== undefined && addsUnderTrouble\(wallet\.status\)\}\s*<!--[^>]*-->\s*<Notice kind="problem">\s*\{@render extra\(\)\}\s*<\/Notice>\s*\{\/if\}\s*\{:else if gate === 'here'\}/,
  );
  assert.match(gate, /import \{ addsUnderTrouble, type Gate, type Stop \} from '\.\/flow\.ts';/);
  assert.equal(gate.match(/\{@render extra\?*\.?\(\)\}/g)?.length, 4, 'under the blocked card, a wallet that is here, "arrived" and "no storage"');
  // Restore has no such line: it opens no passkey prompt.
  assert.match(source('Restore.svelte'), /<FrontGate \{gate\} \{stop\}>/);
});

test('Home keeps the fixed document title, and shows the shared pieces for the states it does not own', () => {
  const text = source('Home.svelte');
  assert.match(text, /documentTitle=\{c\.homeTitle\}/);
  // The shared piece is the button and its answers. Home sizes the button to match the one under
  // it, and hears of the one answer the piece cannot say itself: a wallet that arrived from
  // another tab during the prompt takes the piece off the screen, so Home says how it came.
  assert.match(text, /<OpenWithPasskey\s+variant="secondary"\s+buttonClass=\{PAIRED\}\s+onopened=\{opened\}\s+onanswer=\{\(answer\) => \{\s*if \(answer\.kind === 'exists'\) arrived = true;\s*\}\}\s*\/>/);
  assert.match(text, /<WalletHere \{arrived\} \/>/);
  assert.match(text, /<Button class=\{PAIRED\} data-testid="home-restore"/);
  assert.match(text, /<StoredTrouble titled \/>/);
  // The pieces size their own buttons now: nothing is laid over them from outside.
  assert.doesNotMatch(text, /\[&_button\]/);
  assert.doesNotMatch(source('front/FrontGate.svelte'), /\[&_button\]/);
  // The two facts come from the settings.
  assert.match(text, /wallet\.config\.blockSeconds/);
  assert.match(text, /wallet\.config\.faucetSats/);
});

test('Home puts the restore first for a reader in the middle of the drill, and is as it was for everyone else', () => {
  const text = source('Home.svelte');

  // -- The condition. The step the note of the "Do it" steps follows, when its open part waits for a removed
  //    wallet to come back from the 12 words: the drill of "Prove the backup" between its removal and its
  //    restore. It is the note's followed step, with no limit of time, and not the step the strip shows, which
  //    stops after 24 hours: days after the removal the note is still all that says which wallet has to come back. --
  assert.match(
    text,
    /let restoring = \$derived\.by\(\(\) => \{\s*const step = doit\.progress\.following;\s*return step !== null && awaitsRestore\(doit\.view\(step, Date\.now\(\)\)\) \? step : null;\s*\}\);/,
  );
  assert.match(text, /import \{ awaitsRestore, progressKept \} from '\.\/doit\/view\.ts';/);
  assert.doesNotMatch(text, /stripStep|STRIP_MS|doneFollowed|setInterval\(/, 'neither the strip\'s rule nor a clock');
  // What the rule itself gives for each state of the note and the wallet is held in test/doit-view.test.ts.

  // -- Where it stands: with no wallet in the browser and in no other state of the screen, first under the
  //    heading. Before the lines that say a wallet was removed (on the visit that shows them), before "Create a
  //    practice wallet", and before the card for a reader who has a wallet already. --
  const from = text.indexOf("{:else if status === 'none'}");
  const none = text.slice(from, text.indexOf("{:else if status === 'unreadable'"));
  assert.match(none, /^\{:else if status === 'none'\}\s*\{#if restoring !== null\}/);
  const marks = ['data-testid="home-step"', 'data-testid="home-step-restore"', 'id="{uid}-step"', 'data-testid="home-removed"', 'data-testid="home-create"', 'data-testid="home-have"', 'data-testid="home-restore"'];
  const order = marks.map((mark) => none.indexOf(mark));
  assert.ok(order.every((at) => at > 0) && order.join() === [...order].sort((a, b) => a - b).join(), `in the order ${marks.join(', ')}: ${order.join()}`);
  for (const hook of ['home-step', 'home-step-restore']) assert.equal(text.split(`data-testid="${hook}"`).length, 2, `${hook} is drawn in one place`);
  assert.ok(text.indexOf('data-testid="home-step"') > from, 'and only where the storage was read and holds no wallet');

  // -- The markup: a main button, a link to Restore in Home's own words for it, and under it one sentence
  //    that names the step. The button names the sentence as its description. --
  assert.match(
    none,
    /\{#if restoring !== null\}\s*<!--[\s\S]*?-->\s*<div class="space-y-3" data-testid="home-step">\s*<div>\s*<Button\s+variant="primary"\s+class="w-full sm:w-auto"\s+data-testid="home-step-restore"\s+aria-describedby="\{uid\}-step"\s+href=\{router\.link\(\{ name: 'restore' \}\)\}\s*>\s*\{w\.gateRestore\}\s*<\/Button>\s*<\/div>\s*<p id="\{uid\}-step" class="text-pretty text-base leading-relaxed text-ink-700">\{fill\(d\.homeRestore, \{ step: stepTitle\(restoring, router\.lang\) \}\)\}<\/p>\s*<\/div>\s*\{\/if\}/,
  );
  assert.match(text, /const uid = \$props\.id\(\);/);
  // The words on the button are the ones on the button in the card below it: one name for one thing on one screen.
  assert.equal(text.match(/\{w\.gateRestore\}/g)?.length, 2);
  assert.deepEqual([strings.wallet.en.gateRestore, strings.wallet.es.gateRestore], ['Restore from the 12 words', 'Restaurar con las 12 palabras']);

  // -- "Create a practice wallet" is drawn as a second button while the restore shows, and is the screen's main
  //    button otherwise: one main button in either state. The card under it is as it was. --
  assert.match(
    none,
    /<Button variant=\{restoring === null \? 'primary' : 'secondary'\} class="w-full sm:w-auto" data-testid="home-create" href=\{router\.link\(\{ name: 'new' \}\)\}>\s*\{w\.gateCreate\}\s*<\/Button>/,
  );
  assert.equal(none.match(/variant="primary"/g)?.length, 1, 'the restore; "Create" is main only without it');
  assert.match(none, /<Card tone="grey" title=\{w\.gateAlreadyHave\} data-testid="home-have">/);
  assert.match(none, /<Button class=\{PAIRED\} data-testid="home-restore" href=\{router\.link\(\{ name: 'restore' \}\)\}>\s*\{w\.gateRestore\}\s*<\/Button>/);

  // -- Straight under the heading: for this reader the screen's two sentences on what the practice wallet is
  //    are left out. They know what this is, and with the sentences in place the restore stood under the edge
  //    of a short phone's window in Spanish, whose sentences are the longer ones. Every other reader, and the
  //    one page a search engine may list, has them as before. --
  assert.match(text, /<Page title=\{c\.appName\} documentTitle=\{c\.homeTitle\} lede=\{restoring === null \? t\.lede : undefined\}>/);
  assert.equal(text.match(/\bt\.lede\b/g)?.length, 1);
  // The page's frame draws no line for a lede it is not handed.
  assert.match(readFileSync(new URL('../src/components/Page.svelte', import.meta.url), 'utf8'), /\{#if lede\}\s*<p class="mt-6 text-pretty text-xl text-ink-500">\{lede\}<\/p>\s*\{\/if\}/);
  // The Spanish sentences are the longer ones: that is why the rule is made for both languages alike.
  assert.ok(strings.home.es.lede.length > strings.home.en.lede.length);

  // -- The sentence, in both languages: it names the step and says what the restore is from. --
  assert.equal(strings.doit.en.homeRestore, '"{step}" goes on with a restore: bring the wallet you removed back from the 12 words on your paper.');
  assert.equal(strings.doit.es.homeRestore, '"{step}" sigue con una restauración: trae de vuelta la billetera que quitaste, desde las 12 palabras de tu papel.');
  for (const lang of LANGS) assert.deepEqual(slotNames(strings.doit[lang].homeRestore), ['step'], lang);
  assert.equal(
    fill(strings.doit.en.homeRestore, { step: strings.doit.en['title_prove-the-backup'] }),
    '"Prove the backup" goes on with a restore: bring the wallet you removed back from the 12 words on your paper.',
  );
  assert.equal(
    fill(strings.doit.es.homeRestore, { step: strings.doit.es['title_prove-the-backup'] }),
    '"Comprueba el respaldo" sigue con una restauración: trae de vuelta la billetera que quitaste, desde las 12 palabras de tu papel.',
  );
  // A wallet is removed, never deleted; and the sentence promises nothing about what the restore will find.
  assert.doesNotMatch(strings.doit.en.homeRestore, /\bdelet|\bcoins?\b|\bwill\b/i);
  assert.doesNotMatch(strings.doit.es.homeRestore, /\belimin|\bmonedas?\b/i);
});

test('the gate of a wallet screen puts the restore first for the same reader, by Home\'s rule and in Home\'s words, and is as it was for everyone else', () => {
  const gate = readFileSync(new URL('../src/components/wallet/NoWallet.svelte', import.meta.url), 'utf8');
  const home = source('Home.svelte');

  // -- The same condition as Home's, character for character: the step the note follows, when its open part
  //    waits for a removed wallet to come back from the 12 words. No strip's rule, and no clock. --
  const rule = /let restoring = \$derived\.by\(\(\) => \{\s*const step = doit\.progress\.following;\s*return step !== null && awaitsRestore\(doit\.view\(step, Date\.now\(\)\)\) \? step : null;\s*\}\);/;
  assert.match(gate, rule);
  assert.equal(rule.exec(gate)?.[0].replace(/\s+/g, ' '), rule.exec(home)?.[0].replace(/\s+/g, ' '));
  assert.match(gate, /import \{ awaitsRestore \} from '\.\.\/\.\.\/screens\/doit\/view\.ts';/);
  assert.match(gate, /const doit = useDoit\(\);/);
  assert.doesNotMatch(gate, /stripStep|STRIP_MS|doneFollowed|setInterval\(/);
  // The gate with no wallet is the only gate that draws this piece (the others say what is wrong with what is stored).
  const frame = readFileSync(new URL('../src/components/wallet/WalletGate.svelte', import.meta.url), 'utf8');
  assert.equal(frame.match(/<NoWallet \/>/g)?.length, 1);
  assert.match(frame, /\{:else if gate === 'none'\}\s*<Page title=\{t\.gateNoneTitle\} titleName=\{t\.gateNoneName\}>\s*<NoWallet \/>/);

  // -- Where it stands, and its markup: first in the gate's body, straight under its heading. A main button, a
  //    link to Restore in the gate's own words for it, and under it Home's sentence, which names the step. The
  //    button names that sentence as its description. --
  const markup = gate.slice(gate.indexOf('</script>'));
  assert.match(
    markup,
    /^<\/script>\s*<div class=\{\['space-y-6', extra\]\}>\s*\{#if restoring !== null\}\s*<!--[\s\S]*?-->\s*<div class="space-y-3" data-testid="gate-step">\s*<div>\s*<Button\s+variant="primary"\s+class="w-full sm:w-auto"\s+data-testid="gate-step-restore"\s+aria-describedby="\{uid\}-step"\s+href=\{router\.link\(\{ name: 'restore' \}\)\}\s*>\s*\{t\.gateRestore\}\s*<\/Button>\s*<\/div>\s*<p id="\{uid\}-step" class="text-pretty text-base leading-relaxed text-ink-700">\{fill\(d\.homeRestore, \{ step: stepTitle\(restoring, router\.lang\) \}\)\}<\/p>\s*<\/div>\s*\{\/if\}\s*<p class="text-pretty leading-relaxed text-ink-700">\{why\}<\/p>/,
  );
  assert.match(gate, /const uid = \$props\.id\(\);/);
  for (const hook of ['gate-step', 'gate-step-restore']) assert.equal(gate.split(`data-testid="${hook}"`).length, 2, `${hook} is drawn in one place`);
  // The sentence is Home's, from the same key: one sentence for one state, wherever the reader meets it.
  assert.equal(gate.match(/\bd\.homeRestore\b/g)?.length, 1);
  assert.equal(home.match(/\bd\.homeRestore\b/g)?.length, 1);

  // -- The three ways in under it. "Open with my passkey" is the gate's first choice for every other reader, and
  //    a second button for this one: for a wallet made with a passkey it is the way the step warns against,
  //    since it proves the passkey and not the paper. The restore is not drawn twice. Create is as it was. --
  assert.match(markup, /<OpenWithPasskey variant=\{restoring === null \? 'primary' : 'secondary'\} \{onopened\} buttonClass="w-full sm:w-auto" \/>/);
  assert.match(
    markup,
    /<Actions>\s*\{#if restoring === null\}\s*<Button class="w-full sm:w-auto" href=\{router\.link\(\{ name: 'restore' \}\)\}>\{t\.gateRestore\}<\/Button>\s*\{\/if\}\s*<Button class="w-full sm:w-auto" href=\{router\.link\(\{ name: 'new' \}\)\}>\{t\.gateCreate\}<\/Button>\s*<\/Actions>/,
  );
  // One main button in either state: the restore, or the passkey button.
  assert.equal(markup.match(/variant="primary"/g)?.length, 1);
  assert.equal(markup.match(/\{t\.gateRestore\}/g)?.length, 2, 'the two places are drawn under the two halves of one condition');
  assert.equal(markup.match(/\{#if restoring (!|=)== null\}/g)?.length, 2);
  // The step's own words on why the passkey is not the way, which the gate goes by.
  assert.match(strings.doit.en['guide_prove-the-backup_3'], /Opening it with a passkey would prove the passkey, not the paper\.$/);
  assert.match(strings.doit.es['guide_prove-the-backup_3'], /comprobaría la llave de acceso, no el papel\.$/);
  // No string is new for it, and nothing but the note is asked: no request, no storage of its own.
  assert.doesNotMatch(gate.replace(/^\s*(\/\/|<!--).*$/gm, ''), /localStorage|sessionStorage|\bfetch\(|readProgress|writeProgress/);
});
