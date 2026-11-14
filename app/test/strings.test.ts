// The rules every string table keeps, checked for every table in the map:
// the same keys in both languages, the same slots per key, plain characters,
// no exclamation marks, no empty text. And for the error sentences: one for
// every failure the app can meet.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BROADCAST_REFUSALS, ERROR_CODES, ERROR_STATUS, LANGS, SCREENS } from '@learnbitcoin/practice-contract';
import {
  accountFromMnemonic,
  deriveAddress,
  planPayment,
  watchOnlyAccount,
  type Coin,
  type PlanFailure,
  type WalletState,
} from '@learnbitcoin/practice-wallet';
import { ApiError, broadcastFailure, type ApiFailure, type BroadcastFailure } from '../src/lib/api.ts';
import { fill, slotNames } from '../src/lib/format.ts';
import type { CeremonyFailure, FaucetFailure } from '../src/lib/wallet-api.ts';
import { strings, type Area } from '../src/strings/index.ts';
import type { ErrorKey } from '../src/strings/errors.ts';

type Table = Readonly<Record<string, string>>;

const areas = Object.keys(strings) as Area[];

/** Every text of every table: where it is, and what it says. */
function everyText(): { where: string; lang: 'en' | 'es'; key: string; text: string }[] {
  return areas.flatMap((area) =>
    LANGS.flatMap((lang) =>
      Object.entries(strings[area][lang] as Table).map(([key, text]) => ({
        where: `${area}.${lang}.${key}`,
        lang,
        key,
        text,
      })),
    ),
  );
}

/** Printable ASCII. */
const ASCII = /^[\x20-\x7e]*$/;
/** The same, plus the sixteen characters Spanish adds: its accented letters and its two inverted marks. */
const SPANISH = /^[\x20-\x7eáéíóúüñÁÉÍÓÚÜÑ¿¡]*$/;

test('the map holds the twelve areas, each with both languages', () => {
  // The areas of SPEC section 12: the shell, the errors and one per screen.
  const expected = ['common', 'errors', 'home', 'create', 'wallet', 'receive', 'send', 'backup', 'restore', 'settings'];
  assert.deepEqual([...areas].sort(), [...expected, 'sparrow', 'about'].sort());
  for (const area of areas) {
    assert.deepEqual(Object.keys(strings[area]).sort(), [...LANGS].sort(), area);
    for (const lang of LANGS) {
      const table: unknown = strings[area][lang];
      assert.ok(typeof table === 'object' && table !== null && !Array.isArray(table), `${area}.${lang}`);
    }
  }
});

test('both languages have the same keys', () => {
  for (const area of areas) {
    assert.deepEqual(Object.keys(strings[area].es).sort(), Object.keys(strings[area].en).sort(), area);
  }
});

test('every value is a text, and none is empty', () => {
  const texts = everyText();
  assert.ok(texts.length > 100, 'the walk found the tables');
  for (const { where, text } of texts) {
    assert.equal(typeof text, 'string', where);
    assert.notEqual(text.trim(), '', where);
  }
});

test('English is plain ASCII; Spanish adds only its own letters', () => {
  for (const { where, lang, text } of everyText()) {
    assert.match(text, lang === 'en' ? ASCII : SPANISH, where);
    // One way to write each accented letter, never a letter plus a loose accent.
    assert.equal(text, text.normalize('NFC'), where);
  }
});

test('no exclamation marks, in either form', () => {
  for (const { where, text } of everyText()) {
    assert.ok(!text.includes('!') && !text.includes('¡'), where);
  }
});

test('no stray spaces', () => {
  for (const { where, text } of everyText()) {
    assert.equal(text, text.trim(), where);
    assert.ok(!text.includes('  '), where);
  }
});

test('both languages use the same slots for a key', () => {
  for (const area of areas) {
    const en: Table = strings[area].en;
    const es: Table = strings[area].es;
    for (const key of Object.keys(en)) {
      const where = `${area}.${key}`;
      assert.deepEqual(slotNames(es[key] ?? '').sort(), slotNames(en[key] ?? '').sort(), where);
    }
  }
});

test('a brace is only ever part of a slot, and every slot can be filled', () => {
  for (const { where, text } of everyText()) {
    const names = slotNames(text);
    const filled = fill(text, Object.fromEntries(names.map((name) => [name, '7'])));
    assert.ok(!filled.includes('{') && !filled.includes('}'), where);
  }
});

test('common and errors: the Spanish is Spanish', () => {
  // A table copied over and never translated would pass every test above.
  // Some values are rightly the same in both languages (units, the site's
  // name), so this asks only that whole sentences differ. It looks at the two
  // tables that hold no commands or other text that is never translated.
  for (const area of ['common', 'errors'] as const) {
    const en: Table = strings[area].en;
    const es: Table = strings[area].es;
    for (const key of Object.keys(en)) {
      const text = en[key] ?? '';
      if (text.split(' ').length >= 4) assert.notEqual(es[key], text, `${area}.${key}`);
    }
  }
});

// -- common ---------------------------------------------------------------------

test('common: what the shell needs is there', () => {
  const { en, es } = strings.common;
  // The marker, on every screen and at the front of every title.
  assert.match(en.markerBanner, /practice network/i);
  assert.match(en.markerBanner, /not real bitcoin/);
  assert.equal(en.markerBadge, 'Practice');
  assert.equal(es.markerBadge, 'Práctica');
  assert.ok(en.markerBannerShort.length < en.markerBanner.length);
  assert.ok(es.markerBannerShort.length < es.markerBanner.length);
  assert.ok(fill(en.markerTitle, { screen: 'Receive' }).startsWith('Practice'));
  assert.ok(fill(es.markerTitle, { screen: 'Recibir' }).startsWith('Práctica'));

  // The passkey's name carries its tag, and says there is no real money behind it.
  assert.deepEqual(slotNames(en.passkeyName), ['tag']);
  assert.equal(fill(en.passkeyName, { tag: 'K7Q2' }), 'Practice wallet K7Q2 (no real money)');
  assert.equal(fill(es.passkeyName, { tag: 'K7Q2' }), 'Billetera de práctica K7Q2 (sin dinero de verdad)');
  // A password manager may cut a name at 64 bytes.
  for (const name of [en.passkeyName, es.passkeyName]) {
    assert.ok(Buffer.byteLength(fill(name, { tag: 'K7Q2' }), 'utf8') <= 64, name);
  }

  // The state line of a passkey wallet (SPEC section 3).
  assert.equal(en.stateLocked, 'Looking and receiving need no passkey. Sending and showing the 12 words do.');
  assert.equal(en.stateUnlocked, 'Unlocked in this tab until you lock it, reload or close the tab.');

  // The site's notice on its machine-made Spanish.
  assert.equal(es.footerTranslation, 'Traducción hecha con ayuda de IA, pendiente de revisión humana.');

  // The switch shows the other language's own name.
  assert.equal(en.languageName, 'English');
  assert.equal(es.languageName, 'Español');

  // Units are never translated; "practice" is.
  for (const key of ['sat', 'sats', 'feeRateUnit', 'vbyteUnit'] as const) assert.equal(es[key], en[key], key);
  assert.equal(en.feeRateUnit, 'sat/vB');
  assert.equal(en.practiceSats, 'practice sats');
  assert.equal(es.practiceSats, 'sats de práctica');
});

test('common: every wallet section has a name under "section_" and its route name', () => {
  const names = ['wallet', 'coins', 'receive', 'send', 'activity', 'backup', 'settings'];
  const sections = SCREENS.filter((name) => names.includes(name));
  assert.equal(sections.length, 7);
  const en: Table = strings.common.en;
  const es: Table = strings.common.es;
  for (const name of sections) {
    assert.ok(en[`section_${name}`], name);
    assert.ok(es[`section_${name}`], name);
  }
  // And no section key that is not a screen.
  for (const key of Object.keys(en)) {
    if (key.startsWith('section_')) assert.ok((sections as string[]).includes(key.slice(8)), key);
  }
});

// -- errors ---------------------------------------------------------------------

// The lists below are written out as objects so that the compiler refuses a
// missing or a misspelled value: add a failure to a type and its line must be
// added here, and then the test asks for its sentence.
/** { a: true, b: true } from ['a', 'b']: the contract's lists, in the shape of the lists below. */
function each<K extends string>(keys: readonly K[]): Record<K, true> {
  return Object.fromEntries(keys.map((key) => [key, true])) as Record<K, true>;
}
const API_FAILURES: Record<ApiFailure, true> = { ...each(ERROR_CODES), network: true };
const BROADCAST_FAILURES: Record<BroadcastFailure, true> = {
  ...each(BROADCAST_REFUSALS),
  limit: true,
  unavailable: true,
  network: true,
};
const FAUCET_FAILURES: Record<FaucetFailure, true> = { ...API_FAILURES, 'no-token': true, 'gave-up': true };
const PLAN_FAILURES: Record<PlanFailure, true> = {
  'nothing-spendable': true,
  'unconfirmed-only': true,
  'too-much': true,
  'below-dust': true,
  'bad-address': true,
};
const CEREMONY_FAILURES: Record<CeremonyFailure['kind'], true> = {
  cancelled: true,
  'no-prf': true,
  error: true,
  busy: true,
  reload: true,
  broken: true,
};

/** Every key the error tables must hold, built the way the top of errors.ts tells a screen to build one. */
function errorKeys(): ErrorKey[] {
  return [
    ...(Object.keys(API_FAILURES) as ApiFailure[]),
    ...(Object.keys(BROADCAST_FAILURES) as BroadcastFailure[]),
    ...(Object.keys(FAUCET_FAILURES) as FaucetFailure[]),
    ...(Object.keys(PLAN_FAILURES) as PlanFailure[]).map((reason) => `plan_${reason}` as const),
    ...(Object.keys(CEREMONY_FAILURES) as CeremonyFailure['kind'][]).map((kind) => `passkey_${kind}` as const),
  ];
}

test('errors: a sentence for every failure, found from its value', () => {
  assert.equal(Object.keys(API_FAILURES).length, ERROR_CODES.length + 1);
  const keys = errorKeys();
  for (const lang of LANGS) {
    const table: Table = strings.errors[lang];
    for (const key of keys) {
      assert.ok(Object.hasOwn(table, key), `${lang}: no sentence for ${key}`);
      assert.ok((table[key] ?? '').length > 20, `${lang}.${key}`);
    }
    // Nothing in the table that no failure leads to.
    assert.deepEqual(Object.keys(table).sort(), [...new Set<string>(keys)].sort(), lang);
  }
  // The typed way in, as a screen writes it.
  const failure: FaucetFailure = 'gave-up';
  const plan: PlanFailure = 'below-dust';
  const kind: CeremonyFailure['kind'] = 'no-prf';
  assert.match(strings.errors.en[failure], /faucet/);
  assert.match(strings.errors.en[`plan_${plan}`], /dust/);
  assert.match(strings.errors.es[`passkey_${kind}`], /llave de acceso/);
});

test('errors: the two meanings of "busy" and of a bad address stay apart', () => {
  const { en } = strings.errors;
  assert.match(en.busy, /faucet/);
  assert.match(en.passkey_busy, /passkey prompt/);
  assert.notEqual(en.bad_address, en['plan_bad-address']);
  assert.match(en['plan_bad-address'], /bcrt1/);
});

test('errors: no slots, so any of them can be shown as it stands', () => {
  for (const lang of LANGS) {
    for (const [key, text] of Object.entries(strings.errors[lang])) {
      assert.deepEqual(slotNames(text), [], `${lang}.${key}`);
      assert.ok(!text.includes('{'), `${lang}.${key}`);
    }
  }
});

test('errors: each is whole sentences, the cause and then the way out', () => {
  for (const lang of LANGS) {
    for (const [key, text] of Object.entries(strings.errors[lang])) {
      const where = `${lang}.${key}`;
      assert.match(text, /^[A-ZÁÉÍÓÚÑ]/, where);
      assert.ok(text.endsWith('.'), where);
      // At least two sentences: what happened, and what to do about it.
      const sentences = text.split(/\. (?=[A-ZÁÉÍÓÚÑ])/);
      assert.ok(sentences.length >= 2, where);
      // Never a status number or a raw code in front of the reader.
      assert.doesNotMatch(text, /\b[45][0-9]{2}\b/, where);
      assert.doesNotMatch(text, /[a-z]_[a-z]/, where);
    }
  }
});

test('errors: where the fault is ours, the sentence says so', () => {
  const ours = ['bad_request', 'method', 'too_large', 'unavailable', 'closed', 'bad_address', 'failed', 'refused'] as const;
  for (const key of ours) {
    assert.match(strings.errors.en[key], /on our side/, key);
    assert.match(strings.errors.es[key], /nuestr[ao]/, key);
  }
  // And where it is not, the sentence does not take the blame.
  for (const key of ['network', 'limit', 'already_paid', 'busy', 'plan_too-much', 'passkey_cancelled'] as const) {
    assert.doesNotMatch(strings.errors.en[key], /on our side|bug/, key);
  }
});

// A sentence is found by its key alone, so it must be true on every screen
// that can show it. The tests from here on hold the sentences to the flows
// the seam (lib/wallet-api.ts) and the client (lib/api.ts) can show them in.

/** The sentences of a text, split where the test above splits them. Each keeps its full stop. */
function sentencesOf(text: string): string[] {
  return text.split(/(?<=\.) (?=[A-ZÁÉÍÓÚÑ])/);
}

test('errors: while the faucet waits, no sentence tells the reader to ask again', () => {
  // FaucetView.failure is "limit", "busy" or "refilling" while the phase is
  // "waiting". The page then asks again by itself; the address is frozen
  // and there is nothing for the reader to press.
  const { en, es } = strings.errors;
  for (const key of ['limit', 'busy', 'refilling'] as const) {
    assert.doesNotMatch(en[key], /\b(try|ask) again\b(?! by itself)/i, key);
    assert.doesNotMatch(es[key], /\bvuelve a\b/i, key);
  }
  // The faucet's own two refusals are only ever seen while it waits, so they say what the page does.
  for (const key of ['busy', 'refilling'] as const) {
    assert.match(en[key], /This page will ask again by itself/, key);
    assert.match(es[key], /Esta página volverá a pedir sola/, key);
  }
  // "limit" is also the answer to a broadcast and to the pot address, where
  // the reader does the asking: it says to wait, and not who asks next.
  assert.match(en.limit, /Wait a minute/);
  assert.match(es.limit, /Espera un minuto/);
});

test('errors: giving up names no single cause, and "already paid" no calendar day', () => {
  const { en, es } = strings.errors;
  // The page gives up after three minutes of "limit", "busy" or "refilling":
  // a faucet that was out of coins the whole time never "stayed busy".
  assert.doesNotMatch(en['gave-up'], /busy|out of coins|faster/);
  assert.doesNotMatch(es['gave-up'], /ocupado|sin monedas|rápido/);
  // The faucet's rule is 24 hours from the last payment, not a calendar day:
  // paid at nine in the evening, an address is still refused the next morning.
  assert.match(en.already_paid, /in the last 24 hours/);
  assert.match(es.already_paid, /en las últimas 24 horas/);
  assert.doesNotMatch(en.already_paid, /\b(today|tomorrow|once a day)\b/);
  assert.doesNotMatch(es.already_paid, /\b(hoy|mañana|al día)\b/);
});

test('errors: a passkey failure fits Create, Open and Unlock alike', () => {
  // CreateResult, OpenResult and UnlockResult all carry a CeremonyFailure.
  // On Create there is no wallet to open and there are no 12 words yet; on
  // Unlock a wallet is here, so Create refuses. So a sentence that names the
  // 12 words says they are for opening a wallet, and one that names doing
  // without a passkey says it is for making one.
  const rules: Record<'en' | 'es', { words: RegExp; opening: RegExp; without: RegExp; making: RegExp }> = {
    en: { words: /12 words/, opening: /\bopen/, without: /without a passkey/, making: /\b(make|made)\b/ },
    es: { words: /12 palabras/, opening: /\babrir\b/, without: /sin llave de acceso/, making: /\bcrear\b/ },
  };
  let named = 0;
  for (const lang of LANGS) {
    const { words, opening, without, making } = rules[lang];
    for (const [key, text] of Object.entries(strings.errors[lang])) {
      if (!key.startsWith('passkey_')) continue;
      for (const sentence of sentencesOf(text)) {
        if (words.test(sentence)) assert.match(sentence, opening, `${lang}.${key}`);
        if (without.test(sentence)) assert.match(sentence, making, `${lang}.${key}`);
        if (words.test(sentence) || without.test(sentence)) named++;
      }
    }
  }
  assert.ok(named >= 6, 'the walk found the sentences that name a way out');
  // A passkey with no secret number can no more make a wallet than open one.
  assert.match(strings.errors.en['passkey_no-prf'], /cannot make or open/);
  assert.match(strings.errors.es['passkey_no-prf'], /no puede crear ni abrir/);
});

test('errors: a refused plan has a way out even when nothing at all can be sent', () => {
  // One coin so small that what is left after the fee is under the dust
  // limit. The planner refuses "send all" as dust and any amount the network
  // would carry as too much, both with nothing sendable. "Send a larger
  // amount" and "send a smaller amount" alone would send the reader round
  // in a circle.
  const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const account = watchOnlyAccount(accountFromMnemonic(words).xpub);
  const own = deriveAddress(account, 0, 0);
  const coin: Coin = {
    txid: 'ab'.repeat(32),
    vout: 0,
    value: 400n,
    status: { confirmed: true, block_height: 101 },
    chain: 0,
    index: 0,
    address: own.address,
    script: own.script,
  };
  const state: WalletState = {
    receive: [],
    change: [],
    coins: [coin],
    nextReceiveIndex: 1,
    nextChangeIndex: 0,
    confirmed: coin.value,
    unconfirmed: 0n,
  };
  const to = deriveAddress(account, 0, 7).address;
  const reasons: PlanFailure[] = [];
  for (const amount of ['all', 300n] as const) {
    const plan = planPayment(account, state, { to, amount, feeRate: 2n });
    assert.ok(!plan.ok);
    assert.equal(plan.maxSendable, 0n);
    reasons.push(plan.reason);
    // The way out that still works: more practice coins, from the Receive screen.
    assert.match(strings.errors.en[`plan_${plan.reason}`], /get more practice coins on the Receive screen/);
    assert.match(strings.errors.es[`plan_${plan.reason}`], /más monedas de práctica en la pantalla Recibir/);
  }
  assert.deepEqual(reasons, ['below-dust', 'too-much']);
  // "Send all" sends what can be spent now. That is less than the wallet
  // holds while a coin someone else sent is still unconfirmed.
  assert.doesNotMatch(strings.errors.en['plan_too-much'], /everything the wallet holds/);
  assert.doesNotMatch(strings.errors.es['plan_too-much'], /todo lo que tiene/);
});

test('errors: "too_large" speaks of a request the page built, never of a payment', () => {
  // A broadcast is the one request whose size depends on the reader, and it
  // can never show this sentence: broadcastFailure reads the code as
  // "unavailable". Advice about a payment here would reach nobody.
  const refusal = new ApiError(ERROR_STATUS.too_large, 'too_large');
  assert.deepEqual(broadcastFailure(refusal), { reason: 'unavailable', detail: null });
  assert.doesNotMatch(strings.errors.en.too_large, /payment|amount|coins/);
  assert.doesNotMatch(strings.errors.es.too_large, /pago|monto|monedas/);
});

test('errors: Spanish keeps its word for a request away from the passkey prompt', () => {
  const en: Table = strings.errors.en;
  const es: Table = strings.errors.es;
  // English says "request" for what the page sends the practice network and
  // "prompt" for what the device shows about a passkey. They are two things,
  // so Spanish has two words as well: a reader must not take a prompt that
  // was closed for a request that failed.
  const prompts = Object.keys(en).filter((key) => /\bprompt\b/.test(en[key] ?? ''));
  assert.deepEqual(prompts, ['passkey_cancelled', 'passkey_busy']);
  for (const key of Object.keys(es)) {
    if (key.startsWith('passkey_')) assert.doesNotMatch(es[key] ?? '', /solicitud/i, key);
  }
  // And the request word is still there where a request is meant.
  assert.match(es.bad_request ?? '', /solicitud/);
  // Said of the check itself, the phrase below reads first as "did not
  // happen", which is the other failure ("no-token").
  assert.doesNotMatch(es.bot_check ?? '', /no pasó/);
});

test('errors: the fee text never says the network refuses less than 1 sat/vB', () => {
  // The node relays from 0.1 sat/vB; it is this app that takes whole numbers from 1.
  for (const lang of LANGS) {
    assert.doesNotMatch(strings.errors[lang].fee_too_low, /[0-9]/, lang);
  }
});
