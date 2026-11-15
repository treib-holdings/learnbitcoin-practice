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
  too_large: true,
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
  'too-small': true,
  'bad-fee': true,
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
  const ours = ['bad_request', 'method', 'unavailable', 'closed', 'bad_address', 'failed', 'refused'] as const;
  for (const key of ours) {
    assert.match(strings.errors.en[key], /on our side/, key);
    assert.match(strings.errors.es[key], /nuestr[ao]/, key);
  }
  // And where it is not, the sentence does not take the blame. "too_large"
  // is one of these: a payment that spends too many coins at once is no bug.
  const notOurs = ['network', 'limit', 'too_large', 'already_paid', 'busy', 'passkey_cancelled'] as const;
  const plans = ['plan_too-much', 'plan_below-dust', 'plan_bad-address', 'plan_too-small', 'plan_bad-fee'] as const;
  for (const key of [...notOurs, ...plans]) {
    assert.doesNotMatch(strings.errors.en[key], /on our side|bug/, key);
    assert.doesNotMatch(strings.errors.es[key], /nuestr[ao]/, key);
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

/** A wallet that holds confirmed coins of this many sats each, as the planner takes it, and an address to pay. */
function walletWithCoins(...values: bigint[]) {
  const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const account = watchOnlyAccount(accountFromMnemonic(words).xpub);
  const coins: Coin[] = values.map((value, index) => {
    const own = deriveAddress(account, 0, index);
    return {
      txid: (0xab + index).toString(16).repeat(32),
      vout: 0,
      value,
      status: { confirmed: true, block_height: 101 },
      chain: 0,
      index,
      address: own.address,
      script: own.script,
    };
  });
  const state: WalletState = {
    receive: [],
    change: [],
    coins,
    nextReceiveIndex: values.length,
    nextChangeIndex: 0,
    confirmed: values.reduce((sum, value) => sum + value, 0n),
    unconfirmed: 0n,
  };
  return { account, state, to: deriveAddress(account, 0, 7).address };
}

/** The same, with one coin. */
function walletWithOneCoin(value: bigint) {
  return walletWithCoins(value);
}

test('errors: a refused plan has a way out even when nothing at all can be sent', () => {
  // One coin so small that what is left after the fee is under the dust
  // limit. The planner refuses "send all" as dust and any amount the network
  // would carry as too much, both with nothing sendable. "Send a larger
  // amount" and "send a smaller amount" alone would send the reader round
  // in a circle.
  const { account, state, to } = walletWithOneCoin(400n);
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

test('errors: at a fee rate where the fee alone is more than the wallet holds, "too-much" names the way out that works: a lower fee rate', () => {
  // The faucet's coin, and the highest fee rate the form takes. One input and two outputs are about
  // 141 vB, so the fee is about 141,000 sats: more than the coin holds, whatever the amount.
  const { account, state, to } = walletWithOneCoin(100_000n);
  for (const amount of [1_000n, 300n, 50_000n]) {
    const plan = planPayment(account, state, { to, amount, feeRate: 1000n });
    assert.deepEqual([plan.ok, !plan.ok && plan.reason, plan.maxSendable], [false, 'too-much', 0n], String(amount));
  }
  // "Send all" cannot be made either: so of the sentence's ways out, a smaller amount and "send all" both fail here.
  assert.equal(planPayment(account, state, { to, amount: 'all', feeRate: 1000n }).ok, false);
  // A lower fee rate works, with the same coin and the same amount.
  const lower = planPayment(account, state, { to, amount: 1_000n, feeRate: 2n });
  assert.ok(lower.ok);
  // So the sentence names it, between the other two, in both languages.
  assert.match(strings.errors.en['plan_too-much'], /\. Send a smaller amount, lower the fee rate, or send all the wallet can spend\. /);
  assert.match(strings.errors.es['plan_too-much'], /\. Envía un monto menor, baja la tasa de comisión, o envía todo lo que la billetera pueda gastar\. /);
});

test('errors: with nothing for "Send all" to deliver, a payment can still go through, and no sentence says otherwise', () => {
  // maxSendable is what "Send all" would deliver, and 0 when "Send all"
  // cannot be made. That is not the same as a wallet that can send nothing.
  // Here the faucet's coin sits beside five small coins, and the fee rate
  // is 250 sat/vB. Each small coin holds about 300 sats and costs 17,000
  // to spend. "Send all" spends every coin, so the fee comes to more than
  // the wallet holds. The large coin alone still pays.
  const { account, state, to } = walletWithCoins(100_000n, 300n, 310n, 320n, 330n, 340n);
  const feeRate = 250n;
  const all = planPayment(account, state, { to, amount: 'all', feeRate });
  assert.deepEqual(all, { ok: false, reason: 'below-dust', maxSendable: 0n, dust: 294n });
  const over = planPayment(account, state, { to, amount: 10_000_000n, feeRate });
  assert.deepEqual(over, { ok: false, reason: 'too-much', maxSendable: 0n, dust: null });
  const half = planPayment(account, state, { to, amount: 50_000n, feeRate });
  assert.ok(half.ok);
  assert.deepEqual([half.amount, half.inputs.length, half.maxSendable], [50_000n, 1, 0n]);

  // So the two sentences name "nothing can be sent" as one case among
  // others, after an "if", and the way out they give first works here: a
  // smaller amount than too much, a larger one than "Send all" would deliver.
  const { en, es } = strings.errors;
  assert.match(en['plan_too-much'], /\. Send a smaller amount, .*\. If what is left after the fee is too small to send, get more/);
  assert.match(en['plan_below-dust'], /\. Send a larger amount\. If this wallet cannot send more once the fee is paid, get more/);
  assert.match(es['plan_too-much'], /\. Envía un monto menor, .*\. Si lo que queda después de la comisión es demasiado pequeño para enviarlo, pide/);
  assert.match(es['plan_below-dust'], /\. Envía un monto mayor\. Si esta billetera no puede enviar más después de pagar la comisión, pide/);
  // No sentence for a refused plan says flatly that the wallet can send
  // nothing. The Send screen's own line for maxSendable 0 must not either
  // (see the top of errors.ts): what it may say is that "Send all" cannot
  // be made at this fee rate.
  for (const reason of Object.keys(PLAN_FAILURES) as PlanFailure[]) {
    if (reason === 'nothing-spendable' || reason === 'unconfirmed-only') continue; // these two say what the wallet holds
    assert.doesNotMatch(en[`plan_${reason}`], /nothing can be sent|can send nothing|cannot send anything/i, reason);
    assert.doesNotMatch(es[`plan_${reason}`], /no (se )?puede enviar nada|nada (se )?puede enviar/i, reason);
  }
});

test('errors: a payment too small in bytes is not dust, and its way out works', () => {
  // The faucet's coin, sent in full to the shortest kind of address there
  // is. The amount is far above dust. It is the transaction that would be
  // too small: under 65 bytes, which no node relays.
  const { account, state } = walletWithOneCoin(100_000n);
  const anchor = 'bcrt1pfeesnyr2tx';
  const all = planPayment(account, state, { to: anchor, amount: 'all', feeRate: 2n });
  assert.ok(!all.ok);
  assert.equal(all.reason, 'too-small');
  const en = strings.errors.en[`plan_${all.reason}`];
  const es = strings.errors.es[`plan_${all.reason}`];
  // "Too small" is what the dust sentences say of an amount. This one says
  // what it is that is small, and never calls it dust.
  assert.match(en, /transaction too small, in bytes/);
  assert.match(es, /transacción demasiado pequeña, en bytes/);
  assert.doesNotMatch(en, /dust/);
  assert.doesNotMatch(es, /polvo|dust/);
  // Its first way out is the opposite of the one for dust, and here it
  // works: with less to the recipient, change comes back and the payment
  // can be made. (Where it cannot work is the next test.)
  assert.match(en, /Send a smaller amount, so that change comes back/);
  assert.match(es, /Envía un monto menor, para que vuelva cambio/);
  assert.match(strings.errors.en['plan_below-dust'], /Send a larger amount/);
  const less = planPayment(account, state, { to: anchor, amount: 99_000n, feeRate: 2n });
  assert.ok(less.ok && less.change !== null);
  // The address was a good one all along, so the sentence for a bad address is never shown for it.
  assert.notEqual(en, strings.errors.en['plan_bad-address']);
  assert.doesNotMatch(en, /bcrt1|Copy the address/);
});

test('errors: a payment too small in bytes has a way out where no smaller amount can be sent', () => {
  // "Send a smaller amount, so that change comes back" needs one coin to
  // cover the amount, 294 sats of change and the fee for two outputs. Where
  // a coin cannot, every amount is refused: under 240 sats as dust, from
  // there up as too small in bytes, and above what the coin holds after the
  // fee as too much. The sentence must not leave the reader there.
  const anchor = 'bcrt1pfeesnyr2tx';
  type Wallet = ReturnType<typeof walletWithCoins>;
  /** What the planner says of this payment to the short address: "ok", or its reason. */
  const answer = (wallet: Wallet, amount: bigint | 'all', feeRate: bigint): string => {
    const plan = planPayment(wallet.account, wallet.state, { to: anchor, amount, feeRate });
    return plan.ok ? 'ok' : plan.reason;
  };
  /** The payment as planned, which the test expects to go through. */
  const planned = (wallet: Wallet, amount: bigint | 'all', feeRate: bigint) => {
    const plan = planPayment(wallet.account, wallet.state, { to: anchor, amount, feeRate });
    assert.ok(plan.ok, `${amount} at ${feeRate} sat/vB`);
    return plan;
  };

  // The second way out, in both languages: a lower fee rate, or more coins and then a larger amount.
  const en = strings.errors.en['plan_too-small'];
  const es = strings.errors.es['plan_too-small'];
  assert.match(en, /\. Send a smaller amount, so that change comes back and the transaction is large enough\. If the fee leaves no room for change, /);
  assert.match(en, /, lower the fee rate, or get more practice coins on the Receive screen first and then send a larger amount\.$/);
  assert.match(es, /\. Envía un monto menor, para que vuelva cambio y la transacción tenga el tamaño suficiente\. Si la comisión no deja lugar para el cambio, /);
  assert.match(es, /, baja la tasa de comisión, o pide primero más monedas de práctica en la pantalla Recibir y después envía un monto mayor\.$/);

  // 1. The faucet's coin at 1,000 sat/vB, the highest rate the form takes.
  // Two outputs cost 123,000 sats there, more than the coin holds.
  const faucet = walletWithOneCoin(100_000n);
  assert.equal(answer(faucet, 'all', 1_000n), 'too-small');
  assert.deepEqual(
    [239n, 240n, 8_000n, 8_001n, 100_000n].map((amount) => answer(faucet, amount, 1_000n)),
    ['below-dust', 'too-small', 'too-small', 'too-much', 'too-much'],
  );
  // 240 sats is the least this address can be sent, so it leaves the most
  // room for change. With no change even there, no larger amount has any.
  for (let amount = 240n; amount <= 100_000n; amount += 500n) {
    assert.notEqual(answer(faucet, amount, 1_000n), 'ok', `${amount} sats`);
  }
  // It starts at 809 sat/vB: at 808 the coin just covers 240 sats, 294 of change and the fee.
  assert.equal(answer(faucet, 240n, 809n), 'too-small');
  const last = planned(faucet, 240n, 808n);
  assert.deepEqual([last.change, last.fee], [376n, 99_384n]);
  // "Lower the fee rate" works: at the form's own 2 sat/vB the amount that was refused goes through, with change.
  assert.equal(answer(faucet, 5_000n, 1_000n), 'too-small');
  assert.equal(planned(faucet, 5_000n, 2n).change, 94_754n);
  // "Get more practice coins, then send a larger amount" works too. More
  // coins alone do not: one coin is still enough for the small amount, so
  // the wallet pays it from one coin and no change comes back. A larger
  // amount takes both coins, and two coins are never too small.
  const twoCoins = walletWithCoins(100_000n, 100_000n);
  assert.equal(answer(twoCoins, 5_000n, 1_000n), 'too-small');
  assert.equal(planned(twoCoins, 20_000n, 1_000n).inputs.length, 2);
  assert.equal(planned(twoCoins, 'all', 1_000n).inputs.length, 2);

  // 2. A coin too small for it at any fee rate: 400 sats, here at 1 sat/vB.
  // Every amount there is, from 1 sat to all of it.
  const small = walletWithOneCoin(400n);
  assert.equal(answer(small, 'all', 1n), 'too-small');
  const answers = new Set<string>();
  for (let amount = 1n; amount <= 400n; amount++) answers.add(answer(small, amount, 1n));
  assert.deepEqual([...answers].sort(), ['below-dust', 'too-much', 'too-small']);
  // There is no lower fee rate to go to ...
  assert.equal(answer(small, 300n, 0n), 'bad-fee');
  // ... so what is left is more coins, and then a larger amount. With the
  // faucet's coin beside it the same 300 sats are still refused, because
  // the small coin alone is enough for them. 1,000 sats are more than it
  // holds: the large coin pays, and change comes back.
  const withFaucet = walletWithCoins(400n, 100_000n);
  assert.equal(answer(withFaucet, 300n, 1n), 'too-small');
  const larger = planned(withFaucet, 1_000n, 1n);
  assert.deepEqual([larger.inputs.map((coin) => coin.value), larger.change], [[100_000n], 98_877n]);
  assert.equal(planned(withFaucet, 'all', 1n).inputs.length, 2);
});

test('errors: "too_large" speaks of a payment that spends too many coins at once', () => {
  // A broadcast is the one request whose size depends on the reader: the
  // transaction of a payment that spends several hundred coins is longer
  // than the Worker takes in one request. broadcastFailure passes that code
  // on, so this sentence is read on the Send screen and nowhere else. No
  // bug is behind it and a reload changes nothing. What helps is to send
  // less at a time.
  const refusal = new ApiError(ERROR_STATUS.too_large, 'too_large');
  assert.deepEqual(broadcastFailure(refusal), { reason: 'too_large', detail: null });
  const { en, es } = strings.errors;
  assert.match(en.too_large, /^This payment spends so many coins at once/);
  assert.match(es.too_large, /^Este pago gasta tantas monedas a la vez/);
  assert.match(en.too_large, /send a smaller amount first, then send the rest\.$/);
  assert.match(es.too_large, /envía primero un monto menor, y después envía el resto\.$/);
  assert.doesNotMatch(en.too_large, /bug|on our side|[Rr]eload|This page/);
  assert.doesNotMatch(es.too_large, /error|nuestr[ao]|[Rr]ecarga|Esta página/);
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
  // The planner's own refusal of a fee rate under 1 does name the number,
  // and says whose limit it is: this wallet's, not the network's.
  const { account, state, to } = walletWithOneCoin(100_000n);
  const plan = planPayment(account, state, { to, amount: 5_000n, feeRate: 0n });
  assert.ok(!plan.ok);
  assert.equal(plan.reason, 'bad-fee');
  const en = strings.errors.en[`plan_${plan.reason}`];
  const es = strings.errors.es[`plan_${plan.reason}`];
  assert.match(en, /below 1 sat\/vB, the lowest this wallet takes/);
  assert.match(es, /menor que 1 sat\/vB, la más baja que acepta esta billetera/);
  assert.doesNotMatch(en, /network|node/);
  assert.doesNotMatch(es, /\bred\b|nodo/);
  // Its way out works: at 1 sat/vB the same payment is planned.
  assert.match(en, /Use a fee rate of 1 or more/);
  assert.match(es, /Usa una tasa de comisión de 1 o más/);
  assert.equal(planPayment(account, state, { to, amount: 5_000n, feeRate: 1n }).ok, true);
});
