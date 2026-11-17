// The rules the Send screen's text keeps (src/strings/send.ts), beside the
// ones test/strings.test.ts holds every table to: the sentences the spec
// gives word for word, facts as slots, a fee text that never blames the
// network, and no key that the screen does not show.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import { satsText } from '../src/components/wallet/frame.ts';
import { DEFAULT_CONFIG } from '../src/lib/config.ts';
import { fill, formatSats, slotNames } from '../src/lib/format.ts';
import { FEE_RATE } from '../src/screens/send/form.ts';
import { strings } from '../src/strings/index.ts';

type Table = Readonly<Record<string, string>>;

/** The sentences of a text, each with its full stop. */
function sentencesOf(text: string): string[] {
  return text.split(/(?<=\.) (?=[A-ZÁÉÍÓÚÑ])/);
}

test('send text: the sentences the spec and the task give word for word', () => {
  const { en, es } = strings.send;
  assert.equal(en.toMainnet, "This is an address on Bitcoin's real network. Practice coins cannot be sent there.");
  assert.equal(
    en.toMainnetSparrow,
    "If they start bc1, Sparrow is on Bitcoin's real network. Delete that wallet in Sparrow and never send bitcoin to it.",
  );
  assert.equal(
    es.toMainnetSparrow,
    'Si empiezan por bc1, Sparrow está en la red real de Bitcoin. Elimina esa billetera en Sparrow y nunca le envíes bitcoin.',
  );
  assert.equal(en.reviewTitle, 'Signed, not sent yet');
  assert.equal(en.send, 'Send it');
  assert.equal(en.sending, 'Sending...');
  assert.equal(en.change, 'Change it');
  assert.equal(en.sentTitle, 'Payment sent');
  assert.equal(en.sentAnother, 'Send another');
  assert.equal(en.potButton, 'Pass it on');
  assert.equal(fill(en.sendAllWould, { amount: '99,780 practice sats' }), 'Send all would deliver 99,780 practice sats to this address at this fee rate.');
  // What the unlock step promises is the shared piece's own sentence, said once for the whole app.
  assert.equal(strings.wallet.en.unlockPromise, 'Unlocking sends nothing. You will check the payment first.');
});

test('send text: the Sparrow sentence is the one the Sparrow page says', () => {
  // SPEC section 12: the same sentence appears on the Sparrow page and in
  // Send's error for a real address. The Sparrow page is another engineer's
  // and may not be in this tree yet: once it is, the two must agree.
  for (const lang of LANGS) {
    const start = lang === 'en' ? 'If they start bc1' : 'Si empiezan por bc1';
    const theirs = Object.values(strings.sparrow[lang] as Table).filter((text) => text.includes(start));
    for (const text of theirs) assert.ok(text.includes(strings.send[lang].toMainnetSparrow), `${lang}: ${text}`);
  }
});

test('send text: facts are slots, never numbers written into a sentence', () => {
  for (const lang of LANGS) {
    const t = strings.send[lang];
    assert.deepEqual(slotNames(t.waitingNote), ['seconds'], lang);
    assert.deepEqual(slotNames(t.sentNext), ['seconds'], lang);
    assert.deepEqual(slotNames(t.sentConfirmed), ['height'], lang);
    assert.deepEqual(slotNames(t.feeRange), ['min', 'max'], lang);
    assert.deepEqual(slotNames(t.feeHigh), ['max'], lang);
    assert.deepEqual(slotNames(t.sendAllWould), ['amount'], lang);
    assert.deepEqual(slotNames(t.sendAllArrives), ['amount'], lang);
    // No block interval, no fee limit and no amount is written out anywhere in the table.
    for (const [key, text] of Object.entries(t)) assert.doesNotMatch(text, /[0-9]{2}/, `${lang}.${key}`);
  }
  // Filled as the screen fills them.
  const seconds = String(DEFAULT_CONFIG.blockSeconds);
  assert.match(fill(strings.send.en.sentNext, { seconds }), /A practice block comes about every 30 seconds, and the next one should take it in\.$/);
  assert.equal(fill(strings.send.en.sentConfirmed, { height: formatSats(5912) }), 'It is confirmed. Block 5,912 of the practice chain took it in.');
  assert.equal(
    fill(strings.send.es.sentConfirmed, { height: formatSats(5912) }),
    'Ya está confirmado. El bloque 5,912 de la cadena de práctica lo incluyó.',
  );
  assert.match(fill(strings.send.es.sentNext, { seconds }), /más o menos cada 30 segundos/);
  const limits = { min: formatSats(FEE_RATE.min), max: formatSats(FEE_RATE.max) };
  assert.equal(fill(strings.send.en.feeRange, limits), 'A fee rate here is a whole number from 1 to 1,000 sat/vB. Type digits only.');
  assert.equal(
    fill(strings.send.en.feeHigh, { max: limits.max }),
    'That fee rate is above 1,000 sat/vB, the highest this wallet takes. Use a fee rate of 1,000 or less.',
  );
  assert.equal(fill(strings.send.en.sendAllArrives, { amount: satsText(99_780n, 'en') }), '99,780 practice sats would arrive.');
  assert.equal(fill(strings.send.es.sendAllArrives, { amount: satsText(99_780n, 'es') }), 'Llegarían 99,780 sats de práctica.');
});

test('send text: the fee rate is this wallet\'s limit, and no text says the network refuses a lower one', () => {
  for (const lang of LANGS) {
    const t = strings.send[lang];
    for (const key of ['feeLabel', 'feeHint', 'feeRange', 'feeHigh'] as const) {
      // The node relays from 0.1 sat/vB: the limits of 1 and 1,000 are the form's own.
      assert.doesNotMatch(t[key], /network|node|relay|refus|reject|\bred\b|nodo|rechaz/i, `${lang}.${key}`);
    }
  }
  assert.match(strings.send.en.feeHigh, /the highest this wallet takes/);
  assert.match(strings.send.es.feeHigh, /la más alta que acepta esta billetera/);
  // The sentence the form shows for a rate under 1 is the planner's own, which says the same of the lowest.
  assert.match(strings.errors.en['plan_bad-fee'], /the lowest this wallet takes/);
  // One or two sentences on what a fee rate is.
  for (const lang of LANGS) assert.equal(sentencesOf(strings.send[lang].feeHint).length, 2, lang);
  assert.match(strings.send.en.feeHint, /size of the payment in virtual bytes \(vB\) times this rate/);
});

test('send text: sentences that stay true in every state they are shown in', () => {
  const { en, es } = strings.send;
  // The sent view's first sentence is still there after the next block if the look for the
  // transaction fails: it says where the payment went, never where it is "now".
  assert.match(en.sentNext, /^It went into the mempool, /);
  assert.doesNotMatch(en.sentNext, /\bnow\b|waits/);
  assert.match(es.sentNext, /^Entró al mempool, /);
  assert.doesNotMatch(es.sentNext, /\bahora\b|espera en/i);
  // In the plan's place whichever field is not good yet: it names all three and tells nobody to fill in what is filled in.
  assert.match(en.planWaiting, /^The plan shows here once the address, the amount and the fee rate are good: /);
  assert.doesNotMatch(en.planWaiting, /Fill in/);
  assert.match(es.planWaiting, /la dirección, el monto y la tasa de comisión/);
  assert.doesNotMatch(es.planWaiting, /Completa/);
  // "Send all" leaves a coin that is still unconfirmed where it is: not "every coin".
  assert.match(en.noChangeAll, /^Send all spends every coin this wallet can spend now, whole, /);
  assert.match(es.noChangeAll, /todas las monedas que esta billetera puede gastar ahora/);
  assert.match(en.sendAllNote, /^Every coin this wallet can spend now /);
  // What the status region says when "Pass it on" has filled the field.
  assert.equal(en.potFilled, 'A pot address is in the To field.');
  assert.match(es.potFilled, /fondo común/);
});

test('send text: the review says to check the whole address', () => {
  // Look-alike addresses are made to share their first and last characters with the one a reader means to
  // pay. So the check is of the whole address, which stands right under the sentence, never cut short.
  assert.equal(
    strings.send.en.reviewCheck,
    'Check the whole address, every character of it, before you send. A payment cannot be called back once it is sent, here or on Bitcoin.',
  );
  assert.equal(
    strings.send.es.reviewCheck,
    'Revisa la dirección completa, cada uno de sus caracteres, antes de enviar. Un pago enviado no se puede deshacer, ni aquí ni en Bitcoin.',
  );
  // The sentence names no address the reader "was given". The review shows it for every payment: for an
  // address they typed or pasted, for one from a payment link, for an address of their own wallet, and for the
  // pot's address, which the wallet's own button fills in. Nobody gave the reader that last one, and under it
  // the review says whose it is. So the sentence asks for the address to be checked, and holds in every case.
  for (const lang of LANGS) {
    assert.doesNotMatch(strings.send[lang].reviewCheck, /\bwere given\b|\bgave you\b|\bthe one you\b|\bte dieron\b|\bque te (dio|pasaron)\b|\bcon la que\b/i, lang);
    assert.doesNotMatch(strings.send[lang].reviewCheck, /\bcompare\b|\bcompara\b/i, lang);
    assert.equal(sentencesOf(strings.send[lang].reviewCheck).length, 2, lang);
    assert.deepEqual(slotNames(strings.send[lang].reviewCheck), [], lang);
  }
  assert.match(strings.send.en.reviewCheck, /^Check the whole address, every character of it, before you send\. /);
  assert.match(strings.send.es.reviewCheck, /^Revisa la dirección completa, cada uno de sus caracteres, antes de enviar\. /);
  assert.deepEqual([strings.send.en.toPot, strings.send.es.toPot], ['This is an address of the pot.', 'Esta es una dirección del fondo común.']);
  const review = readFileSync(new URL('../src/screens/send/Review.svelte', import.meta.url), 'utf8');
  assert.match(review, /<p>\{t\.reviewCheck\}<\/p>/);
  assert.match(review, /<Row name=\{t\.planTo\} data-testid="review-to">\s*<Mono value=\{facts\.to\} \/>/);
  // Under the address, where the wallet filled it in or it is the wallet's own: whose it is.
  assert.match(review, /\{#if pot\}<p class="[^"]*">\{t\.toPot\}<\/p>\{\/if\}/);
  // On the first review of a signed payment, and not after a refusal: there the reason stands in its place.
  assert.match(review, /\{#if refusal !== null\}[\s\S]*?\{:else\}\s*<Prose>\s*<p>\{t\.reviewLead\}<\/p>\s*<p>\{t\.reviewCheck\}<\/p>\s*<\/Prose>\s*\{\/if\}/);
  assert.equal(review.match(/t\.reviewCheck\b/g)?.length, 1);
  // And no text of any table gives the old advice.
  let texts = 0;
  for (const [area, tables] of Object.entries(strings)) {
    for (const lang of LANGS) {
      for (const [key, text] of Object.entries(tables[lang] as Table)) {
        texts += 1;
        assert.doesNotMatch(text, /first and last characters|primeros y los últimos caracteres|primeros y sus últimos caracteres/i, `${area}.${lang}.${key}`);
      }
    }
  }
  assert.ok(texts > 1000, `${texts} texts were read`);
});

test('send text: the pot is said in two sentences, and they say whose coins the faucet hands on', () => {
  for (const lang of LANGS) assert.equal(sentencesOf(strings.send[lang].potAbout).length, 2, lang);
  assert.match(strings.send.en.potAbout, /Coins sent there are what the faucet hands to the next learner\.$/);
  assert.match(strings.send.es.potAbout, /fondo común/);
  assert.match(strings.send.es.potAbout, /el faucet/);
});

test('send text: what is wrong with a field gives the cause, then the way out', () => {
  for (const lang of LANGS) {
    const t = strings.send[lang];
    for (const key of ['amountPeriod', 'amountInvalid', 'feeHigh', 'feeRange', 'keysProblem', 'toOtherNetSparrow'] as const) {
      assert.ok(sentencesOf(t[key]).length >= 2, `${lang}.${key}`);
      assert.ok(t[key].endsWith('.'), `${lang}.${key}`);
    }
  }
  // A period is refused with the reason: sats are whole.
  assert.match(strings.send.en.amountPeriod, /^There are no fractions of a sat, so an amount cannot have a period in it\./);
  assert.match(strings.send.es.amountPeriod, /^No hay fracciones de un sat, así que un monto no puede llevar punto\./);
  // A tb1 address is explained, not just refused.
  assert.match(strings.send.en.toOtherNet, /another test network \(it starts with tb1\)/);
});

test('send text: the house words', () => {
  for (const [key, text] of Object.entries(strings.send.en)) {
    // "Unconfirmed" is the word, never "pending". Amounts are practice sats: no bitcoin unit, no price.
    assert.doesNotMatch(text, /\bpending\b/i, key);
    assert.doesNotMatch(text, /\bBTC\b|\$|€|\bUSD\b/, key);
    assert.doesNotMatch(text, /\b(sign in|log in|account|password)\b/i, key);
  }
  for (const [key, text] of Object.entries(strings.send.es)) {
    assert.doesNotMatch(text, /\bpendiente/i, key);
    // The Spanish terms of notes/06 section 2: comisión, monto, billetera, dirección; never these.
    assert.doesNotMatch(text, /\b(tarifa|cuota|fee|cartera|monedero|importe|contraseña)\b/i, key);
  }
  const { es } = strings.send;
  assert.equal(es.feeLabel, 'Tasa de comisión, sat/vB');
  assert.equal(es.amountLabel, 'Monto, sats de práctica');
  assert.equal(es.toLabel, 'Dirección de destino');
  assert.equal(es.sentTitle, 'Pago enviado');
  // Buttons are infinitives.
  for (const key of ['continue', 'send', 'change', 'sentAnother', 'toOtherNetUse', 'backToForm', 'sendAgain'] as const) {
    assert.match(es[key], /^[A-ZÁÉÍÓÚ][a-záéíóú]*(ar|er|ir)(lo)?\b/, key);
  }
});

test('send text: every key is shown by the screen', () => {
  // A key nobody reads is text a translator would still have to keep right.
  const folder = new URL('../src/screens/', import.meta.url);
  const files = ['Send.svelte', ...readdirSync(new URL('send/', folder)).map((name) => `send/${name}`)];
  const source = files.map((name) => readFileSync(new URL(name, folder), 'utf8')).join('\n');
  assert.ok(files.length >= 4, 'the walk found the screen and its pieces');
  for (const key of Object.keys(strings.send.en)) {
    assert.match(source, new RegExp(`\\bt\\.${key}\\b`), `strings.send.${key} is not used`);
  }
});

test('send screen: it reaches the wallet through useWallet() alone, and marks its waits', () => {
  const folder = new URL('../src/screens/', import.meta.url);
  const files = ['Send.svelte', ...readdirSync(new URL('send/', folder)).map((name) => `send/${name}`)];
  for (const name of files) {
    const text = readFileSync(new URL(name, folder), 'utf8');
    for (const banned of [/localStorage/, /sessionStorage/, /indexedDB/, /navigator\.credentials/, /\bfetch\s*\(/, /XMLHttpRequest/, /wallet\.svelte/]) {
      assert.doesNotMatch(text, banned, name);
    }
    // What the page's security policy would refuse.
    for (const banned of [/\sstyle=/, /<style/, /\{@html/]) assert.doesNotMatch(text, banned, name);
    // English source is plain ASCII.
    assert.match(text, /^[\x09\x0a\x20-\x7e]*$/, name);
    // The legacy declaration tag (NOTES/05 section 3.18): "{const x = $derived(...)}" is its replacement.
    assert.doesNotMatch(text, /\{@const\b/, name);
  }
  // The three waits a tap starts on this screen are marked on <main>: the
  // pot's address, keys that load without a prompt, and the broadcast.
  const screen = readFileSync(new URL('Send.svelte', folder), 'utf8');
  for (const call of ['potAddress', 'unlock', 'broadcast']) {
    assert.match(screen, new RegExp(`await busyWhile\\(wallet\\.${call}\\(`), call);
  }
  // The look for a payment that got no answer is the wallet's own, inside broadcast() (after no
  // answer at all, and after "could not answer": test/chain-sync.test.ts). The screen makes no
  // second look of its own, which would only repeat the wallet's and double the wait.
  assert.doesNotMatch(screen, /wallet\.lookupTx\(/);
  // The way back out of the unlock step is off while a passkey prompt is open (the unlock step
  // must stay until its prompt is answered), and as wide as the step's own buttons on a phone.
  assert.match(screen, /<Button class="w-full sm:w-auto" data-testid="send-unlock-back" disabled=\{working\(\)\} onclick=\{leaveUnlock\}>/);
  // The plan's coins are no links: a tap there would leave the screen and lose the form.
  const plan = readFileSync(new URL('send/Plan.svelte', folder), 'utf8');
  assert.doesNotMatch(plan, /CoinList|CoinRow|TextLink|href=/);
});
