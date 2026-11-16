// The words of the two reading screens, the Sparrow page and About, held to
// the rules a program can check:
//
//   - what the pages may never say is in neither language;
//   - the sentences SPEC section 12 gives word for word are there;
//   - facts are slots or values from the settings, never typed into a sentence;
//   - every sentence of the two tables is on a screen;
//   - and the code that About describes still does what About says: what is
//     stored, what the bot check is handed, and what a link back to a chapter
//     of the main site carries.
//
// The last group holds About's sentences to this package's own code by
// calling it: what a record holds, what the bot check's widget is handed.
// What the Worker writes down and sends on is another package's business,
// and is proved by running it: the last scenario of
// e2e/scenarios/info.test.ts reads the log lines of a real run and runs
// the Worker's own forwarder. Nothing here depends on how a line of
// another package's source is spelled. (test/info-kept.test.ts holds the
// sentences about the 12 words against the wallet engine.)

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS, STEPS } from '@learnbitcoin/practice-contract';
import { ACCOUNT_PATH, REGTEST } from '@learnbitcoin/practice-wallet';
import { splitLead } from '../src/components/text.ts';
import { DEFAULT_CONFIG } from '../src/lib/config.ts';
import { slotNames } from '../src/lib/format.ts';
import { PROGRESS_KEY, chapterLink } from '../src/lib/doit/progress.ts';
import { CHAPTERS, STEP_DEFS } from '../src/lib/doit/steps.ts';
import { RECORD_KEY, loadRecord, makeRecord } from '../src/lib/keystore.ts';
import { TURNSTILE_SCRIPT, faucetWidgetOptions } from '../src/lib/turnstile.ts';
import { asksPotCount, chapterUrl } from '../src/screens/doit/view.ts';
import { ARROW, LABEL_MARK, needsSays, sentenceParts, sentenceText } from '../src/screens/info/says.ts';
import { REGTEST_FLAG } from '../src/screens/info/sparrow-guide.ts';
import { strings } from '../src/strings/index.ts';
import { MemoryStorage } from './engine-fakes.ts';

type Table = Readonly<Record<string, string>>;
type Lang = (typeof LANGS)[number];

const AREAS = ['sparrow', 'about'] as const;

/** Every text of the two tables: where it is, and what it says. */
function everyText(): { where: string; area: (typeof AREAS)[number]; lang: Lang; key: string; text: string }[] {
  return AREAS.flatMap((area) =>
    LANGS.flatMap((lang) =>
      Object.entries(strings[area][lang] as Table).map(([key, text]) => ({ where: `${area}.${lang}.${key}`, area, lang, key, text })),
    ),
  );
}

/** A file of the repository, as text. `path` is read from the app's folder. */
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

/** The files that make up the two screens. */
function screenSources(): { name: string; text: string }[] {
  const folder = new URL('../src/screens/info/', import.meta.url);
  const pieces = readdirSync(folder).map((name) => ({ name: `info/${name}`, text: readFileSync(new URL(name, folder), 'utf8') }));
  return [
    { name: 'Sparrow.svelte', text: source('src/screens/Sparrow.svelte') },
    { name: 'About.svelte', text: source('src/screens/About.svelte') },
    ...pieces,
  ];
}

test('the walk finds both tables, in both languages', () => {
  const texts = everyText();
  assert.ok(texts.length > 200, `${texts.length} texts`);
  for (const area of AREAS) {
    for (const lang of LANGS) assert.ok(texts.some((each) => each.area === area && each.lang === lang), `${area}.${lang}`);
  }
});

// -- what the pages may never say ---------------------------------------------------------

test('neither page says that nothing leaves the browser, or that nothing says who the reader is', () => {
  // SPEC section 12, "Privacy wording": the server sees the wallet's addresses and an IP address.
  const never: Record<Lang, RegExp[]> = {
    en: [
      /nothing (ever )?leaves (your|this|the) browser/i,
      /nothing that says who you are/i,
      /nothing (you type|you do) (here )?leaves/i,
      /never see(s)? your address/i,
      /we (collect|store|keep|log|record) nothing/i,
      /\banonym/i,
      /\bno tracking\b/i,
      /\buntraceable\b/i,
    ],
    es: [
      /nada sale de (tu|este|el) navegador/i,
      /nada que diga quién eres/i,
      /nunca (vemos|ve) tus direcciones/i,
      /no (recopilamos|guardamos|registramos) nada/i,
      /\banónim/i,
      /sin rastre/i,
    ],
  };
  for (const { where, lang, text } of everyText()) {
    for (const banned of never[lang]) assert.doesNotMatch(text, banned, where);
  }
});

test('"no cookies" is never said flatly: it is always "we set no cookies"', () => {
  // Cloudflare stands in front of the site and may set a cookie of its own, so the promise is about us alone.
  for (const { where, lang, text } of everyText()) {
    for (const hit of text.matchAll(/[^.]*cookies?[^.]*/gi)) {
      const sentence = hit[0];
      if (lang === 'en') assert.match(sentence, /we set no cookies|no cookies set by us/, where);
      else assert.match(sentence, /no ponemos cookies|ninguna cookie puesta por nosotros/, where);
    }
  }
  // And the promise is there, in the words SPEC section 12 allows.
  assert.equal(strings.about.en.shortBody, 'There is no account, and we set no cookies. The 12 words never leave this browser.');
  assert.equal(strings.about.es.shortBody, 'No hay cuenta, y no ponemos cookies. Las 12 palabras nunca salen de este navegador.');
});

test('no account words: the wallet has no account, and the pages say so only to say there is none', () => {
  const account: Record<Lang, RegExp> = {
    en: /\b(sign up|sign in|signed in|log in|logged in|login|register|username|user|profile)\b/i,
    // "Registro" is left alone: on these pages it is the wallet's record and the server's log, never a sign-up.
    es: /\b(registr(ar|arte|arse|ate)|regístrate|iniciar sesión|inicia sesión|usuari[oa]s?|perfil)\b/i,
  };
  for (const { where, lang, text } of everyText()) {
    assert.doesNotMatch(text, account[lang], where);
    // "Account" only where the page says there is none.
    if (lang === 'en' && /\baccounts?\b/i.test(text)) assert.match(text, /There is no account/, where);
    // In Spanish "cuenta" is also a verb ("lo que se cuenta": what is counted), so the noun is
    // looked for by the word in front of it.
    if (lang === 'es' && /\b(hay|una|la|tu|su|ninguna|alguna|crear|abrir|de) cuentas?\b/i.test(text)) {
      assert.match(text, /No hay cuenta/, where);
    }
    // "Password" only as part of "password manager", where a passkey lives.
    if (lang === 'en') assert.doesNotMatch(text, /\bpasswords?\b(?! manager)/i, where);
    if (lang === 'es') assert.doesNotMatch(text, /(?<!administrador de )\bcontraseñas?\b/i, where);
  }
});

test('the site-wide word rules: unconfirmed, wallet fingerprint, removed, no prices, no cheering', () => {
  for (const { where, area, lang, key, text } of everyText()) {
    assert.doesNotMatch(text, /\bpending\b|\bpendiente/i, where);
    // A fingerprint is always a wallet fingerprint (a phone asks for the other kind).
    if (lang === 'en') {
      for (const hit of text.matchAll(/\S*\s?fingerprints?/gi)) assert.match(hit[0], /^wallet fingerprints?$/i, where);
    } else {
      for (const hit of text.matchAll(/huellas?(\s+\S+){0,3}/gi)) assert.match(hit[0], /^huellas? de la billetera/i, where);
    }
    // A wallet is removed from this browser, never deleted: its coins stay on the practice network.
    // The one "delete" is the sentence SPEC section 12 gives, about a wallet inside Sparrow.
    if (!(area === 'sparrow' && key === 'addressesReal')) assert.doesNotMatch(text, /\bdelet|\belimin/i, where);
    // Never a price, never BTC as a unit, never another coin.
    assert.doesNotMatch(text, /[$€]|\bBTC\b|\bUSD\b|\bcrypto|\bcripto/i, where);
    // No cheering, no minimizers, no "lab".
    assert.doesNotMatch(text, /\b(great|awesome|simply|just|seamless|effortless|powerful|robust|lab)\b/i, where);
    assert.doesNotMatch(text, /\b(genial|simplemente|laboratorio)\b/i, where);
    // Whole sentences end with a full stop or a colon; a label has neither a stop nor an exclamation mark.
    assert.ok(!text.includes('!'), where);
  }
});

test('Sparrow is named as one wallet that can do this, and never recommended', () => {
  for (const lang of LANGS) {
    const t: Table = strings.sparrow[lang];
    const all = Object.values(t).join('\n');
    // "Sparrow Wallet" once, where the page first names it; "Sparrow" after that.
    assert.equal(all.split('Sparrow Wallet').length - 1, 1, lang);
    assert.ok(t.lede?.startsWith('Sparrow Wallet '), lang);
    for (const [key, text] of Object.entries(t)) {
      const where = `sparrow.${lang}.${key}`;
      assert.doesNotMatch(text, /\b(we recommend|recommended|best|trusted|safest|most secure|official)\b/i, where);
      assert.doesNotMatch(text, /\b(recomendamos|recomendad[oa]|mejor|confiable|oficial)\b/i, where);
    }
  }
  assert.match(strings.sparrow.en.lede, /^Sparrow Wallet is one desktop wallet that can /);
  assert.match(strings.sparrow.en.example, /as an example .*, not as an endorsement\.$/);
  assert.match(strings.sparrow.es.example, /como ejemplo .*, no como recomendación\.$/);
  // "The safer one" is said of a way of bringing the wallet in, never of a product.
  assert.match(strings.sparrow.en.bringBody, /needs no 12 words, so it is the safer one/);
});

// -- the sentences SPEC section 12 gives ----------------------------------------------------

test('the Sparrow page carries the two sentences word for word', () => {
  assert.equal(
    strings.sparrow.en.addressesReal,
    "If they start bc1, Sparrow is on Bitcoin's real network. Delete that wallet in Sparrow and never send bitcoin to it.",
  );
  assert.equal(
    strings.sparrow.es.addressesReal,
    'Si empiezan por bc1, Sparrow está en la red real de Bitcoin. Elimina esa billetera en Sparrow y nunca le envíes bitcoin.',
  );
  // The other test modes: close Sparrow, start it with the flag.
  assert.match(strings.sparrow.en.addressesTest, /^If they start tb1, Sparrow is in another test mode\. Quit it and start it again /);
  assert.match(strings.sparrow.es.addressesTest, /^Si empiezan por tb1, Sparrow está en otro modo de prueba\. Ciérralo y vuelve a abrirlo /);
  // The practice prefix is the wallet package's own.
  assert.equal(`${REGTEST.bech32}1`, 'bcrt1');
  for (const lang of LANGS) {
    assert.match(strings.sparrow[lang].addressesTitle, /bcrt1$/, lang);
    assert.match(strings.sparrow[lang].addressesGood, /bcrt1/, lang);
  }
});

test('the Sparrow page: six steps in the order of SPEC section 12, numbered, in both languages', () => {
  const steps = ['computerTitle', 'startTitle', 'checkTitle', 'serverTitle', 'bringTitle', 'addressesTitle'] as const;
  for (const lang of LANGS) {
    steps.forEach((key, index) => assert.ok(strings.sparrow[lang][key].startsWith(`${index + 1}. `), `${lang}.${key}`));
  }
  // The screen draws them in that order.
  const screen = source('src/screens/Sparrow.svelte');
  const places = steps.map((key) => screen.indexOf(`title={t.${key}}`));
  for (const place of places) assert.ok(place > 0);
  assert.deepEqual(places, [...places].sort((a, b) => a - b));
  // What each step is for, in the words the task gives.
  const { en } = strings.sparrow;
  assert.match(en.computerTitle, /needs a computer/);
  assert.match(en.startMenu, /no Regtest\. Do not pick one of those in its place\./);
  assert.match(en.startMenu, /Testnet and Signet/);
  assert.match(en.checkTitle, /before you type a word/);
  assert.match(en.checkBody, /should now say `Regtest`\.$/);
  assert.match(en.serverBody, /Private Electrum/);
  assert.match(en.bringBody, /The first needs no 12 words, so it is the safer one/);
  assert.match(en.wordsException, /^Practice words only\./);
  assert.match(strings.sparrow.es.wordsException, /^Solo palabras de práctica\./);
  // Where nobody here has seen a thing on Sparrow's screen, the sentence says "should".
  assert.match(en.wordsPath, /should read \{path\}/);
  assert.match(strings.sparrow.es.checkBody, /debería decir `Regtest`\.$/);
  assert.match(strings.sparrow.es.wordsPath, /debería decir \{path\}/);
});

test('a command that was not run here is never shown as run', () => {
  const screen = source('src/screens/Sparrow.svelte');
  // The note beside a command comes from how the command is known, and from nothing else.
  assert.match(screen, /note=\{each\.proof === 'ran' \? t\.startRan : t\.startDocumented\}/);
  assert.match(strings.sparrow.en.startDocumented, /We have not run it ourselves\.$/);
  assert.match(strings.sparrow.es.startDocumented, /No lo hemos ejecutado\.$/);
  // The line beside the command that was run says who ran it, in both languages.
  assert.equal(strings.sparrow.en.startRan, 'We ran this one ourselves.');
  assert.equal(strings.sparrow.es.startRan, 'Este lo ejecutamos nosotros.');
});

test('Sparrow is written as Sparrow shows itself: menus with an ASCII arrow, English labels glossed in Spanish', () => {
  const { en, es } = strings.sparrow;
  for (const text of [en.startMenu, en.checkBody, en.serverBody]) assert.match(text, / -> /);
  // Every label of Sparrow that an English sentence names is in the Spanish sentence too, untranslated.
  // A label the reader has to find in Sparrow stands between backticks, which is how the screen
  // knows to set it apart. The names of networks in a sentence are plain words.
  const labels: [keyof typeof en, string[]][] = [
    ['startMenu', ['`Tools -> Restart In`', 'Testnet', 'Signet', 'Regtest']],
    ['checkBody', ['`File -> New Wallet`', '`Regtest`']],
    ['serverBody', ['`File -> Settings`', '`Sparrow -> Settings`', '`Server`', '`Private Electrum`']],
    ['serverTest', ['`Test Connection`']],
    ['watchOpen', ['`Settings`']],
    ['watchEdit', ['`Edit`', '`Descriptor`']],
    ['watchApply', ['`Apply`']],
    ['wordsChoose', ['`Settings`', '`New or Imported Software Wallet`']],
    ['wordsKind', ['`Mnemonic Words (BIP39)`']],
    ['wordsCount', ['`Use 24 Words`', '`Use 12 Words`']],
    ['wordsFinish', ['`Apply`']],
    ['addressesBody', ['`Receive`', '`Addresses`']],
  ];
  for (const [key, names] of labels) {
    for (const name of names) {
      assert.ok(en[key].includes(name), `en.${key}: ${name}`);
      assert.ok(es[key].includes(name), `es.${key}: ${name}`);
    }
  }
  // The same labels are marked in both languages, key by key: a label is Sparrow's, not a translator's.
  const marked = (text: string): string[] => text.split(LABEL_MARK).filter((_piece, index) => index % 2 === 1);
  const allLabels = new Set<string>();
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    assert.deepEqual(marked(es[key]), marked(en[key]), `sparrow.${key}`);
    for (const label of marked(en[key])) allLabels.add(label);
  }
  assert.equal(allLabels.size, 18, [...allLabels].join(' | '));
  // The button for the number of words reads as Sparrow's program shows it. Sparrow's guide still
  // prints the words of an older version ("Enter 24 Words"), which a reader would look for in vain.
  for (const { where, text } of everyText()) assert.doesNotMatch(text, /Enter (12|24) Words/, where);
  // The port's box has no label in Sparrow, so the page gives it none of Sparrow's: no English
  // word with a gloss on the Spanish page.
  assert.equal(en.serverPort, 'Port, in the box beside the URL');
  assert.equal(es.serverPort, 'Puerto, en el campo junto a la URL');
  // And the Spanish page says once that the labels are English.
  assert.match(es.interfaceEnglish, /están en inglés/);
  assert.match(source('src/screens/Sparrow.svelte'), /\{#if router\.lang === 'es'\}\s*<p>\{t\.interfaceEnglish\}<\/p>/);
});

// -- facts are slots ------------------------------------------------------------------------

test('facts are slots or values from the settings, never typed into a sentence', () => {
  // Nothing in either table spells out a setting: no host name, no address of the web, no port,
  // no block interval, no faucet amount.
  const { electrumHost, electrumPort, explorerUrl, siteUrl, sourceUrl, passkeyHost, faucetSats, blockSeconds } = DEFAULT_CONFIG;
  const typed = [
    electrumHost,
    String(electrumPort),
    new URL(explorerUrl).host,
    new URL(siteUrl).host,
    new URL(sourceUrl).host,
    passkeyHost,
    String(faucetSats),
    faucetSats.toLocaleString('en-US'),
  ];
  for (const { where, text } of everyText()) {
    for (const fact of typed) assert.ok(!text.includes(fact), `${where} spells out ${fact}`);
    assert.doesNotMatch(text, new RegExp(`\\b${blockSeconds} (seconds|segundos|s)\\b`), where);
    // No address of the web at all, and no host name: a link's address comes from the settings or a named constant.
    assert.doesNotMatch(text, /https?:|www\.|\b[a-z0-9-]+\.(com|org|net|io|dev|test)\b/i, where);
    // Safari's seven days belong to the wallet's own tables, as a slot.
    assert.doesNotMatch(text, /\b7 (days|días)\b/, where);
  }
  // The sentences that carry a fact carry it as a slot, the same one in both languages.
  for (const lang of LANGS) {
    assert.deepEqual(slotNames(strings.about[lang].netBlocksEvery), ['seconds'], lang);
    assert.deepEqual(slotNames(strings.about[lang].netFaucetGives), ['amount'], lang);
    assert.deepEqual(slotNames(strings.sparrow[lang].startHow), ['flag'], lang);
    assert.deepEqual(slotNames(strings.sparrow[lang].startOther), ['flag'], lang);
    assert.deepEqual(slotNames(strings.sparrow[lang].wordsPath), ['path'], lang);
  }
  // The flag and the commands are not in the table either: they are the guide's constants.
  for (const { where, text } of everyText()) assert.ok(!text.includes('-n regtest') && !text.includes('--args'), where);
  // The path a reader should see in Sparrow is the wallet package's own.
  assert.equal(ACCOUNT_PATH, "m/84'/1'/0'");
  assert.equal(
    sentenceText(strings.sparrow.en.wordsPath, { path: ACCOUNT_PATH }),
    "Sparrow then shows the derivation path. Leave it as it is: it should read m/84'/1'/0'.",
  );
});

// -- what must stay whole on a line -------------------------------------------------------------

test('a sentence is cut into words, arrows, values and labels, and reads the same put back together', () => {
  assert.deepEqual(sentenceParts('Plain words.'), [{ kind: 'text', text: 'Plain words.' }]);
  assert.deepEqual(sentenceParts('Choose `File -> Settings`, then {flag}.', { flag: '-n regtest' }), [
    { kind: 'text', text: 'Choose ' },
    { kind: 'label', bits: [{ kind: 'text', text: 'File ' }, { kind: 'arrow' }, { kind: 'text', text: ' Settings' }] },
    { kind: 'text', text: ', then ' },
    { kind: 'value', text: '-n regtest' },
    { kind: 'text', text: '.' },
  ]);
  // An arrow outside a label (a Spanish gloss has one) is set apart too.
  assert.deepEqual(sentenceParts('(Archivo -> Nueva billetera)'), [
    { kind: 'text', text: '(Archivo ' },
    { kind: 'arrow' },
    { kind: 'text', text: ' Nueva billetera)' },
  ]);
  // A value is put in as it is: an arrow or a brace inside it is not read again.
  assert.deepEqual(sentenceParts('{a}', { a: 'x -> {b}' }), [{ kind: 'value', text: 'x -> {b}' }]);
  assert.equal(ARROW, '->');
  assert.equal(sentenceText('Choose `File -> Settings`, then {flag}.', { flag: '-n regtest' }), 'Choose File -> Settings, then -n regtest.');
  // The screen and its text have drifted apart: a slot with no value, a value with no slot.
  assert.throws(() => sentenceParts('with {flag}'), /no value for \{flag\}/);
  assert.throws(() => sentenceParts('no slot', { flag: 'x' }), /has no \{flag\}/);
  // A label left open, an empty one, and a slot inside one.
  assert.throws(() => sentenceParts('press `Apply'), /left open/);
  assert.throws(() => sentenceParts('press `` now'), /empty label/);
  assert.throws(() => sentenceParts('press `{flag}`', { flag: 'x' }), /slot inside a label/);
});

test('every Sparrow sentence with an arrow, a label or a slot is drawn by the piece that keeps those whole', () => {
  const screen = code(source('src/screens/Sparrow.svelte'));
  const values: Record<string, string> = { flag: REGTEST_FLAG, path: ACCOUNT_PATH };
  let drawn = 0;
  for (const lang of LANGS) {
    const table: Table = strings.sparrow[lang];
    for (const [key, text] of Object.entries(table)) {
      const where = `sparrow.${lang}.${key}`;
      const slots = Object.fromEntries(slotNames(text).map((name) => [name, values[name] ?? '']));
      // Every sentence can be cut, with the values the screen has for its slots.
      for (const name of Object.keys(slots)) assert.notEqual(slots[name], '', `${where}: {${name}}`);
      const said = sentenceText(text, slots);
      assert.ok(!said.includes(LABEL_MARK) && !said.includes('{') && !said.includes('}'), where);
      const uses = screen.split(new RegExp(`\\bt\\.${key}\\b`)).length - 1;
      const throughSays = screen.split(`<Says text={t.${key}}`).length - 1;
      if (needsSays(text)) {
        // Never handed to anything else: a mark would reach the page, an arrow or a flag could be cut in two.
        assert.ok(throughSays >= 1, `${where} has an arrow, a label or a slot and is not drawn by Says`);
        assert.equal(uses, throughSays, `${where} is also used outside Says`);
        drawn += 1;
      }
    }
  }
  assert.ok(drawn >= 30, `${drawn} sentences`);
  // The flag and the path are set as code, whole, and are not translated.
  const how = sentenceParts(strings.sparrow.en.startHow, { flag: REGTEST_FLAG });
  assert.ok(how.some((part) => part.kind === 'value' && part.text === '-n regtest'));
  const piece = source('src/screens/info/Says.svelte');
  assert.match(piece, /<code translate="no" class="whitespace-nowrap">\{part\.text\}<\/code>/);
  assert.match(piece, /<strong translate="no" lang="en">/);
  assert.equal(piece.split('<span class="whitespace-nowrap">{ARROW}</span>').length - 1, 2);
});

test('the screens take the settings from the wallet, and name no host themselves', () => {
  const sparrow = source('src/screens/Sparrow.svelte');
  const about = source('src/screens/About.svelte');
  for (const field of ['electrumHost', 'electrumPort']) {
    assert.match(sparrow, new RegExp(`wallet\\.config\\.${field}`), `Sparrow: ${field}`);
    assert.match(about, new RegExp(`wallet\\.config\\.${field}`), `About: ${field}`);
  }
  for (const field of ['explorerUrl', 'siteUrl', 'sourceUrl', 'events']) {
    assert.match(about, new RegExp(`wallet\\.config\\.${field}`), `About: ${field}`);
  }
  // The block interval and the faucet amount go through the plain helpers, which take the settings whole.
  assert.match(about, /blocksText\(wallet\.config, router\.lang\)/);
  assert.match(about, /faucetText\(wallet\.config, router\.lang\)/);
  // No setting is typed into a screen or a helper: not a host name, not the port, not the faucet's amount.
  const { electrumHost, electrumPort, explorerUrl, siteUrl, sourceUrl, faucetSats } = DEFAULT_CONFIG;
  const settings = [electrumHost, String(electrumPort), new URL(explorerUrl).host, new URL(siteUrl).host, new URL(sourceUrl).host, String(faucetSats)];
  for (const { name, text } of screenSources()) {
    for (const setting of settings) assert.ok(!code(text).includes(setting), `${name} spells out ${setting}`);
  }
  // No address of the web is written in a screen. The one that is not a setting is the guide's named constant.
  for (const { name, text } of screenSources()) {
    if (name === 'info/sparrow-guide.ts') continue;
    assert.doesNotMatch(code(text), /https?:\/\//, name);
  }
  assert.equal(code(source('src/screens/info/sparrow-guide.ts')).split('https://').length - 1, 1);
});

// -- every sentence is on a screen ------------------------------------------------------------

test('every key of the two tables is used by its screen', () => {
  // What each table's keys are looked for in: the screen, and the plain helpers it draws from.
  const screens: Record<(typeof AREAS)[number], string> = {
    sparrow: code(source('src/screens/Sparrow.svelte')),
    about: code(`${source('src/screens/About.svelte')}\n${source('src/screens/info/facts.ts')}`),
  };
  for (const area of AREAS) {
    for (const key of Object.keys(strings[area].en)) {
      // As ".key" (t.key in the screen, strings.about[lang].key in a helper), or by name in a helper's table.
      const used = new RegExp(`\\.${key}\\b`).test(screens[area]) || screens[area].includes(`'${key}'`);
      assert.ok(used, `${area}.${key} is in the table and on no screen`);
    }
  }
  // And a screen asks for no key that the table lacks (the compiler says so too).
  for (const area of AREAS) {
    const table: Table = strings[area].en;
    const screen = area === 'sparrow' ? source('src/screens/Sparrow.svelte') : source('src/screens/About.svelte');
    for (const hit of screen.matchAll(/\bt\.([A-Za-z_][A-Za-z0-9_]*)/g)) assert.ok(Object.hasOwn(table, hit[1] ?? ''), `${area}: t.${hit[1]}`);
  }
});

test('the Spanish is Spanish: no sentence of either table was left in English', () => {
  // Two values are rightly the same in both languages: a label of Sparrow's that is never
  // translated, and "Faucet", which the site's Spanish keeps as a loanword.
  const same = new Set(['sparrow.serverHost', 'about.netFaucet']);
  for (const area of AREAS) {
    const en: Table = strings[area].en;
    const es: Table = strings[area].es;
    for (const key of Object.keys(en)) {
      if (same.has(`${area}.${key}`)) continue;
      assert.notEqual(es[key], en[key], `${area}.${key}`);
    }
  }
  // The site's Spanish words for the things these pages name (notes/06, section 2).
  const esAll = AREAS.flatMap((area) => Object.values(strings[area].es as Table)).join('\n');
  assert.doesNotMatch(esAll, /\b(cartera|monedero|copia de seguridad|tarifa|fallo|ordenador|móvil)\b/i);
  assert.match(esAll, /llave de acceso \(passkey\)/);
  assert.match(esAll, /comprobación contra bots/);
  assert.match(esAll, /administrador de contraseñas/);
  assert.match(esAll, /dinero de juguete/);
  assert.match(esAll, /red de práctica/);
  // A Bitcoin key is a "clave"; "llave" is only ever the passkey.
  for (const hit of esAll.matchAll(/\bllaves?\b(\s+\S+){0,2}/gi)) assert.match(hit[0], /^llaves? de acceso/i, hit[0]);
});

test('a problem says the cause and then the way out; a caution is whole sentences', () => {
  for (const lang of LANGS) {
    const t = strings.sparrow[lang];
    for (const key of ['needNone', 'needUnreadable', 'needNewer', 'watchFailed'] as const) {
      const { lead, rest } = splitLead(t[key]);
      assert.ok(lead.endsWith('.') && rest !== '', `${lang}.${key}`);
      // These are handed to a notice as plain text, so they carry no mark.
      assert.equal(needsSays(t[key]), false, `${lang}.${key}`);
    }
    for (const key of ['startMenu', 'wordsException', 'addressesReal', 'addressesTest'] as const) {
      assert.ok(t[key].endsWith('.'), `${lang}.${key}`);
    }
  }
  // The ways out, by name: the start page, the wallet's own screen, a reload.
  assert.match(strings.sparrow.en.needNone, /Create one, or open one you already have, then come back to this step\.$/);
  assert.match(strings.sparrow.en.needUnreadable, /The wallet screen says what can be done about it\.$/);
  assert.match(strings.sparrow.en.needNewer, /Reload the page, then come back to this step\.$/);
  // A wallet is here and its descriptor could not be worked out: the cause, that the fault is ours, the way out.
  assert.equal(
    strings.sparrow.en.watchFailed,
    "This page could not work out this wallet's descriptor. That is our fault, not your wallet's. The 12 words, further down, still bring the wallet into Sparrow.",
  );
  assert.match(strings.sparrow.es.watchFailed, /Es un error nuestro, no de tu billetera\. Las 12 palabras, más abajo, /);
  // The screen says it in place of the line, and only there: where a wallet is here and the line is not.
  assert.match(
    source('src/screens/Sparrow.svelte'),
    /\{#if descriptor !== null\}[\s\S]*?sparrow-settings-link[\s\S]*?\{:else\}[\s\S]*?<Notice kind="problem" silent text=\{t\.watchFailed\} data-testid="sparrow-no-descriptor" \/>\s*\{\/if\}/,
  );
});

// -- About against the code it describes --------------------------------------------------------

const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MADE_AT = Date.UTC(2026, 10, 1, 12);

test('About, "what this browser keeps": the app stores the wallet\'s record and the note of the steps, each under its key, and uses no other storage', () => {
  // The sentence: at most two things, in this browser's storage; no cookies set by us; no other kind of browser storage.
  assert.match(
    strings.about.en.keepBody,
    /^At most two things, in this browser's storage for this site: the record of the wallet, and a note of your "Do it" progress once you have opened a step\. Nothing else is kept: no cookies set by us, and nothing in any other kind of browser storage\.$/,
  );
  assert.match(
    strings.about.es.keepBody,
    /^Como mucho dos cosas, en el almacenamiento de este navegador para este sitio: el registro de la billetera, y una nota de tu progreso de "Hazlo" una vez que abres un paso\. No se guarda nada más: /,
  );
  assert.equal(RECORD_KEY, 'lbp_wallet_v1');
  // The "Do it" steps keep one more value, under a key of its own (SPEC-A3 section 4).
  assert.equal(PROGRESS_KEY, 'lbp_progress_v1');
  // The whole app, every file that is built into it.
  const root = new URL('../src/', import.meta.url);
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((name) => /\.(ts|svelte|css)$/.test(name));
  assert.ok(files.length > 80, `${files.length} files`);
  const writers: string[] = [];
  for (const name of files) {
    const text = code(readFileSync(new URL(name, root), 'utf8'));
    for (const banned of [/sessionStorage/, /indexedDB/, /document\.cookie/, /cookieStore/, /\bcaches\.(open|match)/, /serviceWorker/, /openDatabase/]) {
      assert.doesNotMatch(text, banned, `${name}: About says nothing but the wallet's record is kept`);
    }
    if (/\.setItem\(|\.removeItem\(/.test(text)) writers.push(name);
    if (/\blocalStorage\b/.test(text)) assert.equal(name, 'lib/wallet.svelte.ts', `${name} reaches for localStorage`);
  }
  // Two places write to storage and no third: the key store (the wallet's record) and the note of the
  // "Do it" steps. Only the glue reaches for the browser's storage, and hands it to both.
  assert.deepEqual(writers.sort(), ['lib/doit/progress.ts', 'lib/keystore.ts'], 'where storage is written changed: read About, "What this browser keeps", again');
  // The note's module writes under its own key and no other: every call that stores, reads or deletes names it.
  const progress = code(readFileSync(new URL('lib/doit/progress.ts', root), 'utf8'));
  const calls = progress.match(/\.(setItem|removeItem|getItem|key|clear)\([^)]*/g) ?? [];
  assert.ok(calls.length >= 4, calls.join(' '));
  for (const call of calls) assert.match(call, /^\.(setItem|removeItem|getItem)\(PROGRESS_KEY\b/, call);
});

test('About, "what this browser keeps": a record holds what the page lists, and the words only in the kind that keeps them', () => {
  const { en } = strings.about;
  // The time is when this browser's record was written: also the moment a wallet was opened here with its
  // passkey, switched to, or restored from its words. So it is never called the time the wallet was made.
  assert.match(en.keepPublic, /the wallet's public key\..*wallet fingerprint, the first address and the time this browser began to keep the wallet are stored beside it\.$/);
  assert.match(strings.about.es.keepPublic, /la primera dirección y el momento en que este navegador empezó a guardar la billetera\.$/);
  for (const lang of LANGS) assert.doesNotMatch(strings.about[lang].keepPublic, /was made|se creó/, lang);
  assert.match(en.keepPasskey, /which passkey to ask, and the tag in its name\. Its 12 words are not stored\.$/);
  assert.match(en.keepWords, /the 12 words, as plain text, not encrypted\.$/);
  // The key store is asked, not read: what it makes is what is stored.
  const always = ['createdAt', 'fingerprint', 'firstAddress', 'kind', 'v', 'xpub'];
  const withPasskey = makeRecord('passkey', WORDS, MADE_AT, { credentialId: 'QUJD', tag: 'K7Q2' });
  assert.deepEqual(Object.keys(withPasskey).sort(), [...always, 'credentialId', 'tag'].sort(), 'what a passkey record holds changed: read About, "What this browser keeps", again');
  assert.ok(!JSON.stringify(withPasskey).includes('abandon'), 'a passkey record holds words');
  const withWords = makeRecord('words', WORDS, MADE_AT);
  assert.deepEqual(Object.keys(withWords).sort(), [...always, 'mnemonic'].sort(), 'what a words record holds changed: read About, "What this browser keeps", again');
  assert.equal(withWords.mnemonic, WORDS);
  // As plain text, not encrypted: the stored text holds the words as they are.
  assert.ok(JSON.stringify(withWords).includes(WORDS));
  // A passkey record with words slipped into it is no record at all: it is never read as one.
  const storage = new MemoryStorage();
  storage.setItem(RECORD_KEY, JSON.stringify({ ...withPasskey, mnemonic: WORDS }));
  assert.equal(loadRecord(storage as Storage), 'unreadable');
  storage.setItem(RECORD_KEY, JSON.stringify(withPasskey));
  assert.deepEqual(loadRecord(storage as Storage), withPasskey);
});

test('About, "what our server sees": what is written down, and what Cloudflare keeps beside it', () => {
  const { en, es } = strings.about;
  // Nothing is written for a look at an address, a transaction or the chain's height unless something is
  // broken; every other request writes one line. (The last scenario of e2e/scenarios/info.test.ts reads the
  // lines a real run wrote, and holds these sentences to them.)
  assert.match(en.serverLog, /^When the page asks about an address, a transaction or the height of the chain, the server writes nothing down, unless something on our side is broken\./);
  // The list in brackets is what the page asks for beside the chain. Whether the pot's totals are on it goes by
  // a setting of the Worker: the next test reads the setting as it ships, and holds the list to it.
  assert.match(en.serverLog, /\. For every other request \(the page's settings, the faucet, the address of the pot, [^)]*a payment being sent, a count\) it writes one line: /);
  // The pot has one name in the app, the one Send and Receive give it.
  for (const text of Object.values(strings.about.en)) assert.doesNotMatch(text, /pass-it-on|pay-it-forward/);
  assert.match(en.serverLog, /what kind of request it was, how it ended and how long it took\. The line itself holds no address, no transaction ID and no IP address\.$/);
  // "Block height" is "altura de bloque" on the Spanish site (notes/06, section 2).
  assert.match(es.serverLog, /^Cuando la página pregunta por una dirección, una transacción o la altura de bloque actual, el servidor no anota nada/);
  assert.match(es.serverLog, /\. Por cada una de las demás solicitudes \(la configuración de la página, el faucet, la dirección del fondo común, [^)]*un pago que se envía, un conteo\) anota una línea: /);
  assert.match(es.serverLog, /La línea en sí no contiene ninguna dirección, ningún txid ni ninguna dirección IP\.$/);
  // "The line itself" is the Worker's own line. What the log service stores beside it was read off a stored
  // line on the live host after the first deploy (worker/wrangler.jsonc, above "observability"): the web
  // address that was asked for, the time and the request's IDs, and no IP address. The page says that, and
  // it still never says flatly that no line holds an address: the web address kept beside a line written
  // for a chain read that broke holds one.
  for (const lang of LANGS) {
    for (const [key, text] of Object.entries(strings.about[lang] as Table)) {
      assert.doesNotMatch(text, /No line holds|Ninguna línea contiene/, `about.${lang}.${key}`);
    }
  }
  assert.match(en.serverCloudflare, /Cloudflare stores those lines for a short time\. Beside each one it keeps the web address that was asked for, the time and IDs that Cloudflare gives the request, and no IP address\./);
  // What is kept is known now, so neither language says "may keep" of it.
  assert.doesNotMatch(en.serverCloudflare, /may keep/);
  assert.doesNotMatch(es.serverCloudflare, /puede guardar/);
  assert.match(en.serverCloudflare, /For a line written while something on our side is broken, that web address can hold a wallet address or a transaction ID\./);
  // "No IP address" is said of what is kept beside a line. So that nobody reads it as "Cloudflare keeps no
  // IP address", the paragraph ends by saying where one can be, in both languages.
  assert.match(en.serverCloudflare, /Cloudflare also keeps logs of its own, and those can hold the IP address\.$/);
  assert.match(es.serverCloudflare, /Cloudflare también lleva sus propios registros, y esos sí pueden contener la dirección IP\.$/);
  assert.match(es.serverCloudflare, /^El servidor funciona en la red de Cloudflare\. Cloudflare guarda esas líneas por poco tiempo\. /);
  assert.match(es.serverCloudflare, /Junto a cada una guarda la dirección web que se pidió, la hora y los identificadores que Cloudflare le da a la solicitud, y ninguna dirección IP\./);
  assert.match(es.serverCloudflare, /esa dirección web puede contener una dirección de la billetera o un txid\./);
  // The limit per reader.
  assert.match(en.serverLimit, /^It uses the IP address to slow down anyone who asks too fast\.$/);
});

/**
 * The setting POT_COUNTS as worker/wrangler.jsonc ships it. The file is JSON with comments, and its comments
 * name the setting too: the value is taken from the one line that sets it (a comment line begins with "//").
 */
function potCountsShipped(): string {
  const text = readFileSync(new URL('../../worker/wrangler.jsonc', import.meta.url), 'utf8');
  const set = text.split('\n').flatMap((line) => {
    const hit = /^\s*"POT_COUNTS":\s*"([^"]*)",?\s*$/.exec(line);
    return hit === null ? [] : [hit[1] ?? ''];
  });
  assert.equal(set.length, 1, 'worker/wrangler.jsonc sets POT_COUNTS in exactly one line');
  return set[0] ?? '';
}

test('About, "what our server sees": the list of requests names the pot\'s totals when the Worker ships with the pot\'s counts switched on, and only then', () => {
  // The list, both ways. The page asks for the pot's totals only where the Worker's settings say that they can
  // be had; where they say no, no request for them ever leaves the page, and a list that named one would
  // tell the reader of a request that is not made.
  const lists = {
    off: {
      en: "(the page's settings, the faucet, the address of the pot, a payment being sent, a count)",
      es: '(la configuración de la página, el faucet, la dirección del fondo común, un pago que se envía, un conteo)',
    },
    on: {
      en: "(the page's settings, the faucet, the address of the pot, the pot's totals, a payment being sent, a count)",
      es: '(la configuración de la página, el faucet, la dirección del fondo común, los totales del fondo común, un pago que se envía, un conteo)',
    },
  } as const;
  const names: Record<Lang, RegExp> = { en: /\bthe pot's totals\b/, es: /\blos totales del fondo común\b/ };
  for (const lang of LANGS) {
    assert.doesNotMatch(lists.off[lang], names[lang], lang);
    assert.match(lists.on[lang], names[lang], lang);
  }

  // The setting, as this repository ships it. Only the exact word "on" switches the counts on (worker/src/config.ts).
  const shipped = potCountsShipped();
  const on = shipped === 'on';
  for (const lang of LANGS) {
    const said = strings.about[lang].serverLog;
    const why = `POT_COUNTS is ${JSON.stringify(shipped)} in worker/wrangler.jsonc, so About's list of requests ${on ? 'must name' : 'must not name'} the pot's totals (${lang})`;
    assert.equal(names[lang].test(said), on, why);
    assert.ok(said.includes(lists[on ? 'on' : 'off'][lang]), why);
    // And no other sentence of the page speaks of them while the page never asks.
    if (!on) {
      for (const [key, text] of Object.entries(strings.about[lang] as Table)) assert.doesNotMatch(text, /\bpot's (totals|counts)\b|\b(totales|conteos) del fondo\b/i, `about.${lang}.${key}`);
    }
  }

  // What the sentence follows: the app asks only when the Worker's settings say yes, and the settings it
  // carries built in say no. So with the setting off no page asks, whatever else is true.
  assert.equal(DEFAULT_CONFIG.potCounts, false);
  for (const id of STEPS) assert.equal(asksPotCount(id, { potCounts: false }), false, id);
  assert.equal(asksPotCount('pass-it-on', { potCounts: true }), true);
  // One piece of the page calls for the counts, behind that rule. (Everything under lib/ is the wallet's own
  // seam and its client, which ask only when a screen does.)
  const asks = readdirSync(new URL('../src/', import.meta.url), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(ts|svelte)$/.test(name) && !name.startsWith('lib/'))
    .filter((name) => /\bpotStats\(/.test(code(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8'))));
  assert.deepEqual(asks, ['screens/doit/Done.svelte']);
  assert.match(source('src/screens/doit/Done.svelte'), /let countsWanted = \$derived\(asksPotCount\(id, wallet\.config\)\);/);
  assert.match(source('src/screens/doit/Done.svelte'), /if \(!countsWanted \|\| asked\) return;\s*asked = true;\s*untrack\(\(\) => \{\s*void busyWhile\(wallet\.potStats\(\)\)/);
});

test('About, "what is counted": Plausible is sent the IP address and what the browser says it is, and no ID', () => {
  // What the Worker really sends on is proved by running its own forwarder, in the last scenario of
  // e2e/scenarios/info.test.ts. Here: the sentences, and the screen reading the setting that switches counting.
  assert.match(strings.about.en.countSent, /passes each count on to Plausible/);
  assert.match(strings.about.en.countSent, /with the IP address the request came from and what your browser says it is: its name, its version and its system/);
  assert.match(strings.about.en.countSent, /No ID is sent with a count\.$/);
  const screen = source('src/screens/About.svelte');
  assert.match(screen, /let counting = \$derived\(wallet\.config\.events\);/);
  // The line that says "on" or "off" waits until the request for the server's settings has ended:
  // from then on what this page counts does not change (with no settings from the server, nothing).
  assert.match(screen, /let settled = \$derived\(wallet\.settings !== 'loading'\);/);
  assert.match(screen, /\{#if settled\}\s*<p data-testid="about-counting"/);
});

test("About, \"the faucet's bot check\": Cloudflare's script, loaded from the one other site the page allows, and handed the address", () => {
  const { en, es } = strings.about;
  assert.match(en.botBody, /The check is Cloudflare's, and it is the only code this page loads from another site\. It loads only when you ask the faucet for coins\.$/);
  assert.match(es.botBody, /es el único código que esta página carga desde otro sitio\. Se carga solo cuando le pides monedas al faucet\.$/);
  // "Another site", not "another company's servers": this page itself is served from Cloudflare's network.
  for (const lang of LANGS) assert.doesNotMatch(strings.about[lang].botBody, /another company|otra empresa/, lang);
  assert.match(en.botSees, /It examines your browser to tell a person from a script, and it is given the address the coins are for\.$/);
  // The script is Cloudflare's, and the widget is handed the address: the app's own code is asked.
  assert.equal(new URL(TURNSTILE_SCRIPT).origin, 'https://challenges.cloudflare.com');
  const address = 'bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk';
  const options = faucetWidgetOptions('a-site-key', address, 'en', false);
  assert.equal(options.cData, address);
  assert.equal(options.action, 'faucet');
  // The page's security policy lets a script in from that host and from this site, and from nowhere else.
  const headers = source('public/_headers');
  assert.match(headers, /script-src 'self' https:\/\/challenges\.cloudflare\.com;/);
  assert.match(headers, /connect-src 'self';/);
});

test('About, "what our server sees": a link back to a chapter stays in this tab, sends no referrer, and its address names the step and whether it is done', () => {
  const { en, es } = strings.about;
  // The sentence, in both languages: where the two kinds of link lead, what the address of one of them says, and what travels with neither.
  assert.equal(
    en.serverBack,
    '"Back to the chapter", and a chapter\'s name on the Do it screen, lead to LearnBitcoin in this tab. The address of "Back to the chapter" names the step and whether it is done. Nothing about the wallet travels with either.',
  );
  assert.equal(
    es.serverBack,
    '"Volver al capítulo", y el nombre de un capítulo en la pantalla Hazlo, llevan a LearnBitcoin en esta pestaña. La dirección de "Volver al capítulo" nombra el paso y dice si está terminado. Con ninguno de los dos viaja nada de la billetera.',
  );
  // It names the link by the words on the link, and the screen by its own name.
  assert.deepEqual([strings.doit.en.back, strings.doit.es.back], ['Back to the chapter', 'Volver al capítulo']);
  assert.deepEqual([strings.doit.en.name, strings.doit.es.name], ['Do it', 'Hazlo']);
  // The short version names it among what leaves the browser, in the order the page takes them.
  assert.equal(
    en.shortRest,
    "The rest of this page says what does leave it: what our server sees, what a link back to LearnBitcoin carries, what is counted, and what the faucet's bot check does.",
  );
  assert.equal(
    es.shortRest,
    'El resto de esta página dice qué sí sale de él: lo que ve nuestro servidor, lo que lleva un enlace de vuelta a LearnBitcoin, lo que se cuenta y lo que hace la comprobación contra bots del faucet.',
  );
  // The screen draws it as the last paragraph of "What our server sees", before "What is counted".
  assert.match(
    source('src/screens/About.svelte'),
    /<p>\{t\.serverCloudflare\}<\/p>\s*<!--[^>]*-->\s*<p data-testid="about-link-back">\{t\.serverBack\}<\/p>\s*<\/Prose>\s*<\/Section>\s*<Section title=\{t\.countTitle\}>/,
  );

  // -- No referrer. The page's own policy sends none, and it is set for every page and file of the app ("/*"). --
  assert.match(source('public/_headers'), /^\/\*\n(?:  [^\n]+\n)*?  Referrer-Policy: no-referrer\n/m);
  // No file of the app lifts that policy for a link, a picture or a request: the attribute of an element, the
  // property of one and the option of fetch() are all spelled with this one word. Comments are searched too.
  const root = new URL('../src/', import.meta.url);
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((name) => /\.(ts|svelte|css|html)$/.test(name));
  assert.ok(files.length > 80, `${files.length} files`);
  for (const name of files) {
    const text = readFileSync(new URL(name, root), 'utf8');
    assert.doesNotMatch(text, /referrerpolicy|referrer-policy/i, `${name}: About says that nothing but its address travels with a link back`);
    assert.doesNotMatch(text, /name=["']referrer["']/i, name);
  }
  // The page itself names no policy of its own: a <meta name="referrer"> in it would stand in for the header.
  assert.doesNotMatch(source('index.html'), /referrer/i);

  // -- What "no referrer" does not mean. The request for the chapter's page carries no Referer header, and
  //    the page it leads to finds document.referrer empty. But a browser marks that request with a header of
  //    its own that no page can switch off, "Sec-Fetch-Site: same-site": the wallet's host and the main site's
  //    are two hosts of one site. So the main site's server can tell that the reader followed a link on some
  //    host of its own site (e2e/scenarios/doit-chapter.test.ts reads the header at a stand-in). No sentence
  //    shown to a reader says otherwise: none speaks of a referrer at all, and none says that the main site
  //    is not told, or cannot tell, where the reader was. What About says is what the address carries, and
  //    that nothing about the wallet travels. --
  for (const [area, tables] of Object.entries(strings)) {
    for (const lang of LANGS) {
      for (const [key, text] of Object.entries(tables[lang] as Table)) {
        const where = `${area}.${lang}.${key}`;
        assert.doesNotMatch(text, /\breferr?er\b|\bSec-Fetch\b/i, where);
        assert.doesNotMatch(text, /(is|are) (not|never) told where|told nothing|cannot (tell|know|see) where you|does not (know|learn|see) where you/i, where);
        assert.doesNotMatch(text, /no (se le dice|sabe|se entera|puede saber) (de|desde) dónde/i, where);
      }
    }
  }
  // The comments of the pieces that draw a link off this site keep to the same: "no referrer", and what a
  // browser still sends. None says that the other site is told nothing.
  const pieces = ['src/components/doit/ChapterLink.svelte', 'src/components/styles.ts', 'src/components/OutLink.svelte'];
  for (const file of pieces) {
    const text = source(file).replace(/\s*\n\s*(\/\/|\*)\s*/g, ' ');
    assert.doesNotMatch(text, /is not told by the browser where the reader comes from/, file);
    assert.doesNotMatch(text, /the other site is told nothing about this one/, file);
    assert.doesNotMatch(text, /the other site is not told where the reader came from/, file);
  }
  const said = source('src/components/doit/ChapterLink.svelte').replace(/\s*\n\s*\/\/\s*/g, ' ');
  assert.match(said, /carries no Referer header, and the page it leads to finds document\.referrer empty\. That is all "no referrer" means/);
  assert.match(said, /"Sec-Fetch-Site: same-site" \(and "Sec-Fetch-User: \?1" for a link the reader pressed\), because the wallet's host and the main site's are two hosts of one site\./);
  assert.match(said, /It names no host and no page\./);

  // -- This tab, and these links only. The one piece that draws a link back has no target and no rel ... --
  const link = source('src/components/doit/ChapterLink.svelte');
  assert.doesNotMatch(code(link), /target=|rel=/);
  // ... and "Back to the chapter" in its three places, and a chapter's name on the list of steps, are all drawn by it.
  const drawn: [file: string, words: string][] = [
    ['src/screens/doit/StepBody.svelte', '{t.back}'],
    ['src/screens/doit/Done.svelte', '{t.back}'],
    ['src/components/doit/Strip.svelte', '{t.back}'],
    ['src/screens/Do.svelte', '{chapterHeading(chapter, lang)}'],
  ];
  for (const [file, words] of drawn) {
    const text = source(file);
    const inLink = text.split(`>${words}</ChapterLink>`).length - 1;
    assert.equal(inLink, 1, `${file}: ${words} is the text of one link back`);
    if (words === '{t.back}') assert.equal(text.split(words).length - 1, inLink, `${file}: "Back to the chapter" is drawn by ChapterLink and by nothing else`);
  }
  // No other file of the app draws those words, or that piece.
  for (const name of files) {
    if (drawn.some(([file]) => file === `src/${name}`) || name === 'components/doit/ChapterLink.svelte') continue;
    assert.doesNotMatch(code(readFileSync(new URL(name, root), 'utf8')), /ChapterLink|\bt\.back\b|doit\[[a-z.]+\]\.back\b/, name);
  }

  // -- The address of "Back to the chapter": the main site, one of the chapter's two pages, and the mark that
  //    names the step and says whether it is done. Nothing else, whatever the step's note holds. --
  const SITE = 'https://www.learnbitcoin.com';
  const doneAt = Date.UTC(2026, 10, 15, 12);
  for (const id of STEPS) {
    for (const lang of LANGS) {
      const page = STEP_DEFS[id].chapter.path[lang];
      assert.equal(chapterLink(SITE, id, lang, undefined), `${SITE}${page}#do-${id}`);
      assert.equal(chapterLink(SITE, id, lang, { started: true }), `${SITE}${page}#do-${id}`);
      assert.equal(chapterLink(SITE, id, lang, { started: true, doneAt }), `${SITE}${page}#done=${id}`);
      // A note with everything a step's note can hold: a wallet fingerprint, how the wallet was kept, a payment.
      const full = { started: true as const, doneAt, from: STEP_DEFS[id].chapter.path.es, wallet: '73c5da0a', was: 'passkey' as const, tx: 'ab'.repeat(32), sentAt: doneAt - 60_000, parts: { 1: true as const } };
      const address = new URL(chapterLink(SITE, id, lang, full) ?? '');
      assert.deepEqual(
        [address.origin, address.pathname, address.search, address.hash, address.username, address.password],
        [SITE, STEP_DEFS[id].chapter.path.es, '', `#done=${id}`, '', ''],
        `${id}, ${lang}`,
      );
      assert.doesNotMatch(address.href, /73c5da0a|abab|passkey|[0-9]{6}/, `${id}, ${lang}: nothing about the wallet, and no time, is in the address`);
    }
  }
  // A chapter's name on the Do it screen leads to the chapter's page, with no mark and nothing else.
  for (const chapter of CHAPTERS) {
    for (const lang of LANGS) assert.equal(chapterUrl(SITE, chapter, lang), `${SITE}${chapter.path[lang]}`);
  }
});
