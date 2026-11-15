// The plain helpers of the two reading screens, the Sparrow page and About:
// the commands that start Sparrow, what step 5 says where this browser has
// no wallet it can use, the network's facts from the settings, what this
// browser holds right now, and the list of what is counted.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EVENTS, LANGS, type AppConfig, type EventName } from '@learnbitcoin/practice-contract';
import { accountFromMnemonic } from '@learnbitcoin/practice-wallet';
import { DEFAULT_CONFIG } from '../src/lib/config.ts';
import { makeRecord, publicRecord } from '../src/lib/keystore.ts';
import type { PublicRecord, WalletStatus } from '../src/lib/wallet-api.ts';
import {
  COUNT_KEYS,
  KEPT_KEYS,
  blocksText,
  countedEvents,
  faucetClosed,
  faucetText,
  keptNow,
  linkText,
  type KeptNow,
} from '../src/screens/info/facts.ts';
import {
  REGTEST_FLAG,
  SPARROW_DOWNLOAD_URL,
  START_COMMANDS,
  walletNote,
} from '../src/screens/info/sparrow-guide.ts';
import { strings } from '../src/strings/index.ts';

type Table = Readonly<Record<string, string>>;

// Written as an object so that the compiler refuses a status that is missing
// here: a status added to the wallet must be given a place in both screens.
const STATUSES: Record<WalletStatus, true> = { none: true, ready: true, unreadable: true, newer: true, broken: true };
const statuses = Object.keys(STATUSES) as WalletStatus[];

const WORDS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MADE_AT = Date.UTC(2026, 10, 1, 12);

/** A wallet's record as a screen gets it: without the words. */
function record(kind: 'passkey' | 'words'): PublicRecord {
  const full =
    kind === 'words' ? makeRecord('words', WORDS, MADE_AT) : makeRecord('passkey', WORDS, MADE_AT, { credentialId: 'QUJD', tag: 'K7Q2' });
  return publicRecord(full) as PublicRecord;
}

/** Settings that are not the built-in ones, so a value typed into a sentence would show. */
const OTHER: AppConfig = {
  ...DEFAULT_CONFIG,
  electrumHost: 'electrum.practice.test',
  electrumPort: 60002,
  explorerUrl: 'https://explorer.practice.test',
  blockSeconds: 45,
  faucetSats: 2_500_000,
};

// -- the Sparrow page -----------------------------------------------------------------

test('sparrow: one command for each system, each ending with the flag', () => {
  assert.equal(REGTEST_FLAG, '-n regtest');
  assert.deepEqual(
    START_COMMANDS.map((each) => each.system),
    ['macos', 'windows', 'linux'],
  );
  for (const { system, command } of START_COMMANDS) {
    assert.ok(command.endsWith(` ${REGTEST_FLAG}`), system);
    // Exactly what is typed: plain ASCII, single spaces, nothing before or after.
    assert.match(command, /^[\x21-\x7e]+( [\x21-\x7e]+)+$/, system);
    // The flag once, and no other network's name beside it.
    assert.equal(command.split(REGTEST_FLAG).length, 2, system);
    assert.doesNotMatch(command, /testnet|signet|mainnet/i, system);
  }
});

test('sparrow: the macOS command is the one that was run; the other two follow the documentation', () => {
  const by = Object.fromEntries(START_COMMANDS.map((each) => [each.system, each]));
  // Run by hand by the site's owner (BRIEF, "Decisions already made").
  assert.deepEqual(by.macos, { system: 'macos', command: 'open -a Sparrow --args -n regtest', proof: 'ran' });
  // Sparrow's FAQ gives these two with "testnet" as its example; regtest is one of the option's values.
  assert.deepEqual(by.windows, { system: 'windows', command: 'Sparrow.exe -n regtest', proof: 'documented' });
  assert.deepEqual(by.linux, { system: 'linux', command: 'Sparrow/bin/Sparrow -n regtest', proof: 'documented' });
  // Only a command that was run is shown as run.
  assert.deepEqual(
    START_COMMANDS.filter((each) => each.proof === 'ran').map((each) => each.system),
    ['macos'],
  );
});

test("sparrow: the download link is the publisher's own page, with nothing added to it", () => {
  const url = new URL(SPARROW_DOWNLOAD_URL);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'sparrowwallet.com');
  // No referral parameter and no tracking of any kind.
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
});

test('sparrow: step 5 links into the wallet only when a wallet is here, and names every other state', () => {
  assert.equal(walletNote('ready'), null);
  assert.equal(walletNote('none'), 'none');
  assert.equal(walletNote('unreadable'), 'unreadable');
  assert.equal(walletNote('newer'), 'newer');
  assert.equal(walletNote('broken'), 'broken');
  // Every status has an answer: none falls through to "undefined".
  for (const status of statuses) assert.notEqual(walletNote(status), undefined, status);
  // Each state without a wallet has its own sentence, in both languages: the cause, then the way out.
  for (const lang of LANGS) {
    const t = strings.sparrow[lang];
    const texts = [t.needNone, t.needUnreadable, t.needNewer, strings.errors[lang].passkey_broken];
    assert.equal(new Set(texts).size, 4, lang);
    for (const text of texts) assert.ok(text.split(/\. (?=[A-ZÁÉÍÓÚÑ])/).length >= 2, `${lang}: ${text}`);
  }
});

// -- About: the network's facts ---------------------------------------------------------

test('about: the block interval and the faucet amount come from the settings', () => {
  assert.equal(blocksText(OTHER, 'en'), 'About one every 45 seconds');
  assert.equal(blocksText(OTHER, 'es'), 'Uno cada 45 segundos, más o menos');
  assert.equal(faucetText(OTHER, 'en'), '2,500,000 practice sats for each request');
  assert.equal(faucetText(OTHER, 'es'), '2,500,000 sats de práctica por cada solicitud');
  // The built-in settings give the practice network's own numbers, and only because the settings hold them.
  assert.equal(blocksText(DEFAULT_CONFIG, 'en'), `About one every ${DEFAULT_CONFIG.blockSeconds} seconds`);
  assert.equal(faucetText(DEFAULT_CONFIG, 'en'), '100,000 practice sats for each request');
});

test('about: one second and one sat are said in the singular; a long interval has its thousands grouped', () => {
  const small: AppConfig = { ...DEFAULT_CONFIG, blockSeconds: 1, faucetSats: 1 };
  assert.equal(blocksText(small, 'en'), 'About one every second');
  assert.equal(blocksText(small, 'es'), 'Uno por segundo, más o menos');
  assert.equal(faucetText(small, 'en'), '1 practice sat for each request');
  assert.equal(faucetText(small, 'es'), '1 sat de práctica por cada solicitud');
  assert.equal(blocksText({ ...DEFAULT_CONFIG, blockSeconds: 2 }, 'en'), 'About one every 2 seconds');
  assert.equal(blocksText({ ...DEFAULT_CONFIG, blockSeconds: 86_400 }, 'en'), 'About one every 86,400 seconds');
});

test("about: a link's words are the address as a reader would say it", () => {
  assert.equal(linkText('https://practice-explorer.learnbitcoin.com'), 'practice-explorer.learnbitcoin.com');
  assert.equal(linkText('https://explorer.practice.test/'), 'explorer.practice.test');
  assert.equal(linkText('http://localhost:8787'), 'localhost:8787');
  assert.equal(linkText('https://example.org/practice/'), 'example.org/practice');
  // Text that is no address is shown as it is: a link is never left without words.
  assert.equal(linkText('not an address'), 'not an address');
  assert.equal(linkText(''), '');
});

test('about: a closed faucet is said to be closed, and only once the settings on screen are the ones that stay', () => {
  // The contract: an empty site key means there is no bot check, so the faucet pays nobody.
  assert.equal(faucetClosed({ ...DEFAULT_CONFIG, turnstileSiteKey: '' }), true);
  assert.equal(faucetClosed({ ...DEFAULT_CONFIG, turnstileSiteKey: '1x00000000000000000000AA' }), false);
  // The built-in settings, which every page is drawn with first, say "closed" and "nothing is counted".
  // The server's may say the opposite a moment later, so neither line may be drawn from the built-in ones.
  assert.equal(faucetClosed(DEFAULT_CONFIG), true);
  assert.equal(DEFAULT_CONFIG.events, false);
  // The wallet says which settings a screen is looking at, and About asks it: the faucet line is
  // drawn only from settings the server sent, the counting line once that request has ended.
  const about = readFileSync(new URL('../src/screens/About.svelte', import.meta.url), 'utf8');
  assert.match(about, /let fromServer = \$derived\(wallet\.settings === 'loaded'\);/);
  assert.match(about, /\{#if fromServer && faucetClosed\(wallet\.config\)\}/);
  assert.doesNotMatch(about, /passkeyOffered/);
  for (const lang of LANGS) assert.ok(strings.about[lang].netFaucetOff.endsWith('.'), lang);
  assert.equal(strings.about.en.netFaucetOff, 'The faucet is switched off right now.');
  assert.equal(strings.about.es.netFaucetOff, 'El faucet está apagado por ahora.');
});

// -- About: what this browser holds right now ---------------------------------------------

test('about: what this browser holds, from the status and the kind of wallet', () => {
  assert.equal(keptNow('none', null), 'none');
  assert.equal(keptNow('ready', record('passkey')), 'passkey');
  assert.equal(keptNow('ready', record('words')), 'words');
  assert.equal(keptNow('unreadable', null), 'unreadable');
  assert.equal(keptNow('newer', null), 'newer');
  assert.equal(keptNow('broken', null), 'broken');
  // "ready" with no record is a promise broken by the wallet: nothing is said, and no kind is guessed.
  assert.equal(keptNow('ready', null), null);
  for (const status of statuses) assert.notEqual(keptNow(status, null), undefined, status);
});

test('about: the record a screen is handed never holds the 12 words, and the line for it says which kind it is', () => {
  const words = record('words');
  assert.equal(Object.hasOwn(words, 'mnemonic'), false);
  assert.equal(JSON.stringify(words).includes('abandon'), false);
  // The same wallet either way: the public key is what both kinds keep.
  assert.equal(words.xpub, accountFromMnemonic(WORDS).xpub);
  assert.equal(record('passkey').xpub, words.xpub);
  // The sentence for each kind says whether the words are stored.
  const { en, es } = strings.about;
  assert.match(en[KEPT_KEYS.words], /kept with its 12 words, as plain text/);
  assert.match(en[KEPT_KEYS.passkey], /12 words are not stored/);
  assert.match(es[KEPT_KEYS.words], /guardada con sus 12 palabras, como texto simple/);
  assert.match(es[KEPT_KEYS.passkey], /12 palabras no están guardadas/);
});

test('about: each thing this browser can hold has its own sentence, in both languages', () => {
  const kinds = Object.keys(KEPT_KEYS) as KeptNow[];
  assert.deepEqual([...kinds].sort(), ['broken', 'newer', 'none', 'passkey', 'unreadable', 'words']);
  for (const lang of LANGS) {
    const t: Table = strings.about[lang];
    const texts = kinds.map((kind) => t[KEPT_KEYS[kind]] ?? '');
    assert.equal(new Set(texts).size, kinds.length, lang);
    for (const text of texts) assert.ok(text.length > 20, `${lang}: ${text}`);
  }
  // Every "keepNow" sentence in the table is one of them, the label aside.
  const used = new Set<string>(Object.values(KEPT_KEYS));
  for (const key of Object.keys(strings.about.en)) {
    if (key.startsWith('keepNow') && key !== 'keepNowLabel') assert.ok(used.has(key), key);
  }
});

// -- About: what is counted ---------------------------------------------------------------

test("about: every event of the contract is in About's list, by its own name, and nothing else is", () => {
  const events = Object.keys(EVENTS) as EventName[];
  assert.ok(events.length >= 9, 'the walk found the events');
  for (const lang of LANGS) {
    const list = countedEvents(lang);
    // The contract's events, in the contract's order, each under the very name that is sent.
    assert.deepEqual(
      list.map((each) => each.name),
      events,
      lang,
    );
    // Each has a sentence of its own.
    assert.equal(new Set(list.map((each) => each.text)).size, events.length, lang);
    for (const each of list) assert.ok(each.text.length > 30, `${lang}: ${each.name}`);
  }
  // The table holds no sentence for an event the contract does not have (one that was removed, say).
  const mapped = new Set<string>(Object.values(COUNT_KEYS));
  assert.equal(mapped.size, events.length, 'each event has its own key');
  const inTable = Object.keys(strings.about.en).filter((key) => key.startsWith('count_'));
  assert.deepEqual([...inTable].sort(), [...mapped].sort());
});

test('about: what a count is said to carry is what the contract lets it carry', () => {
  const { en, es } = strings.about;
  // A screen view carries no value. Every other event carries exactly one, from a closed list.
  assert.equal(EVENTS.pageview, null);
  for (const [name, spec] of Object.entries(EVENTS)) {
    if (spec === null) continue;
    assert.ok(spec.values.length >= 2, name);
    for (const value of spec.values) assert.match(value, /^[a-z-]+$/, `${name}: ${value}`);
  }
  assert.match(en.countBody, /the name of what happened, at most one detail from a fixed list, and the screen it happened on/);
  assert.match(es.countBody, /el nombre de lo que pasó, como mucho un detalle tomado de una lista fija, y la pantalla donde pasó/);
  // The two events whose value is the kind of wallet say so, and say that the words are not sent.
  assert.deepEqual(EVENTS['Words shown'].values, ['passkey', 'words']);
  assert.match(en.count_wordsShown, /whether this browser opens the wallet with a passkey\. The words themselves are never part of a count\./);
  assert.match(es.count_wordsShown, /Las palabras mismas nunca forman parte de un conteo\./);
  // The faucet's and the payment's outcomes, as many as the contract has.
  assert.equal(EVENTS.Faucet.values.length, 5);
  assert.match(en.count_faucet, /paid, already paid, stopped by the bot check, given up or failed/);
  assert.equal(EVENTS.Payment.values.length, 3);
  assert.equal(EVENTS.Restore.values.length, 3);
  assert.match(en.count_restore, /found and, if not, whether the words were kept in this browser or erased/);
});
