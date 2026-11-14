// What the Receive screen decides and says (src/screens/receive/faucet.ts,
// src/screens/receive/view.ts, src/strings/receive.ts): the button in every
// phase of a faucet request, a sentence and a way out for every failure,
// when "Show a new address" is offered and when it waits, how an answer is
// brought on screen, and the rules the screen's words keep.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { ERROR_CODES, LANGS, type FaucetPayment } from '@learnbitcoin/practice-contract';
import { ACCOUNT_PATH, accountFromMnemonic, deriveAddress, watchOnlyAccount } from '@learnbitcoin/practice-wallet';
import { splitLead } from '../src/components/text.ts';
import { REQUEST_MS } from '../src/lib/chain-sync.ts';
import { fill, slotNames } from '../src/lib/format.ts';
import type { FaucetFailure, FaucetPhase, FaucetView } from '../src/lib/wallet-api.ts';
import { BOT_CHECK_WAIT_MS, type NoToken } from '../src/screens/receive/bot-check.ts';
import {
  BITCOIN_BLOCK_MINUTES,
  BOX_SAY_MS,
  FAUCET_ONCE_HOURS,
  SETTINGS_WAIT_MS,
  addressHeld,
  addressPath,
  arrivedText,
  askButton,
  boxWasWaiting,
  failedText,
  faucetRuns,
  offersMore,
  offersNewAddress,
  paidWithoutRecord,
  waitingSentence,
  waitingText,
  type Adds,
} from '../src/screens/receive/faucet.ts';
import { scrollBlock } from '../src/screens/receive/view.ts';
import { strings } from '../src/strings/index.ts';

// Written out as objects, so that the compiler refuses a missing or a
// misspelled value: a new phase or failure must get its line here.
const PHASES: Record<FaucetPhase, true> = {
  idle: true,
  checking: true,
  asking: true,
  waiting: true,
  'on-its-way': true,
  arrived: true,
  confirmed: true,
  failed: true,
};
const phases = Object.keys(PHASES) as FaucetPhase[];

const FAILURES: Record<FaucetFailure, true> = {
  ...(Object.fromEntries(ERROR_CODES.map((code) => [code, true])) as Record<(typeof ERROR_CODES)[number], true>),
  network: true,
  'no-token': true,
  'gave-up': true,
};
const failures = Object.keys(FAILURES) as FaucetFailure[];

const PAYMENT: FaucetPayment = { txid: 'ab'.repeat(32), amountSats: 100_000, potTxid: null };

function view(phase: FaucetPhase, rest: Partial<FaucetView> = {}): FaucetView {
  return { phase, payment: null, failure: null, retryAt: null, ...rest };
}

// -- a request to the faucet ----------------------------------------------------------

test('a request runs while the bot check runs, the faucet is asked, or the page waits to ask again', () => {
  assert.deepEqual(
    phases.filter((phase) => faucetRuns(phase)),
    ['checking', 'asking', 'waiting'],
  );
});

test('the button: ready before a request and after a failed one, busy while one runs, gone once the faucet has paid', () => {
  assert.deepEqual(
    phases.map((phase) => [phase, askButton(phase)]),
    [
      ['idle', 'ready'],
      ['checking', 'busy'],
      ['asking', 'busy'],
      ['waiting', 'busy'],
      ['on-its-way', 'done'],
      ['arrived', 'done'],
      ['confirmed', 'done'],
      ['failed', 'ready'],
    ],
  );
  // Busy is exactly "a request runs": the wallet would start no second one.
  for (const phase of phases) assert.equal(askButton(phase) === 'busy', faucetRuns(phase), phase);
});

test('while the page waits, the sentence is the cause the wallet names', () => {
  assert.equal(waitingSentence('limit'), 'limit');
  assert.equal(waitingSentence('busy'), 'busy');
  assert.equal(waitingSentence('refilling'), 'refilling');
  // Each of the three is true while the page waits: none tells the reader to ask again.
  for (const key of ['limit', 'busy', 'refilling'] as const) {
    assert.doesNotMatch(strings.errors.en[key], /\b(try|ask) again\b(?! by itself)/i, key);
  }
  // With no cause named, or one that no wait can have, it says only that the page will ask again.
  assert.equal(waitingSentence(null), 'busy');
  assert.equal(waitingSentence('network'), 'busy');
  assert.match(strings.errors.en.busy, /This page will ask again by itself/);
});

test('while the page waits, no sentence tells the reader to do the waiting: the countdown under it says for how long', () => {
  // "limit" is written for screens where the reader asks. Its last part, "Wait a minute, and it
  // will take requests again.", would stand right above "Asking again in 19 seconds."
  assert.match(strings.errors.en.limit, /Wait a minute/);
  assert.equal(waitingText('limit', 'en'), 'You are asking the practice network faster than it allows.');
  assert.equal(waitingText('limit', 'es'), 'Estás haciendo solicitudes a la red de práctica más rápido de lo que permite.');
  // The other two already say that the page asks again, and stay whole.
  for (const lang of LANGS) {
    assert.equal(waitingText('busy', lang), strings.errors[lang].busy, lang);
    assert.equal(waitingText('refilling', lang), strings.errors[lang].refilling, lang);
    assert.equal(waitingText(null, lang), strings.errors[lang].busy, lang);
    for (const failure of ['limit', 'busy', 'refilling'] as const) {
      // Nothing for the reader to do, and no wait of another length than the countdown's.
      assert.doesNotMatch(waitingText(failure, lang), /\bWait\b|\bEspera\b/, `${lang}.${failure}`);
    }
  }
});

test('every failure has a sentence, and the sentence has the way out', () => {
  assert.equal(failures.length, ERROR_CODES.length + 3);
  const added = new Set<Adds>();
  for (const failure of failures) {
    const { sentence, adds } = failedText(failure);
    added.add(adds);
    for (const lang of LANGS) {
      const text = strings.errors[lang][sentence];
      assert.ok(Object.hasOwn(strings.errors[lang], sentence), `${failure}: no sentence ${sentence}`);
      // The cause, then the way out: at least two sentences.
      assert.ok(text.split(/\. (?=[A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1])/).length >= 2, `${lang}.${failure}`);
    }
    const en = strings.errors.en[sentence];
    // A request that has stopped does not ask again by itself, so no sentence may say it will.
    assert.doesNotMatch(en, /ask again by itself/, failure);
    // None speaks of a payment the reader sent: on this screen the reader has sent nothing.
    assert.doesNotMatch(en, /this payment|Activity|fee rate/i, failure);
    // What to do is in the sentence: try or ask again (now, in a minute, later), reload, or show a new address.
    assert.match(en, /[Tt]ry again|[Aa]sk (for practice coins )?again|take requests again|Reload the page|Show a new address/, failure);
  }
  // All four things the screen can add are in use.
  assert.deepEqual([...added].sort(), ['new-address', 'nothing', 'other-cause', 'reload']);
  // No failure named reads as an answer that could not be given.
  assert.deepEqual(failedText(null), failedText('unavailable'));
});

test('each failure the faucet can really end with gets its own sentence', () => {
  const own: FaucetFailure[] = [
    'bad_request',
    'forbidden',
    'method',
    'limit',
    'unavailable',
    'closed',
    'bot_check',
    'bad_address',
    'own_address',
    'already_paid',
    'failed',
    'network',
    'no-token',
    'gave-up',
  ];
  for (const failure of own) assert.equal(failedText(failure).sentence, failure, failure);
});

test('the failures whose own sentence would be wrong here get one that is right', () => {
  // A faucet request that is too large is malformed: the sentence for "too_large" speaks of a payment.
  assert.deepEqual(failedText('too_large'), { sentence: 'bad_request', adds: 'reload' });
  // "This page will ask again by itself" is true only while it waits.
  for (const failure of ['busy', 'refilling'] as const) {
    assert.deepEqual(failedText(failure), { sentence: 'gave-up', adds: 'nothing' }, failure);
  }
  // Refusals of a payment and of a chain read are answers the faucet never gives.
  for (const failure of ['not_found', 'already_sent', 'coin_spent', 'fee_too_low', 'dust', 'refused'] as const) {
    assert.deepEqual(failedText(failure), { sentence: 'unavailable', adds: 'nothing' }, failure);
  }
});

test('what the screen adds under a failure is what its sentence leaves out', () => {
  const { en } = strings.errors;
  for (const failure of failures) {
    const { sentence, adds } = failedText(failure);
    const text = en[sentence];
    // A Reload button exactly where the sentence says to reload, and nowhere else.
    assert.equal(adds === 'reload', /Reload the page/.test(text), failure);
    // Where the button is, exactly where the sentence says to show a new address or that this address is paid.
    assert.equal(adds === 'new-address', /Show a new address|already got practice coins/.test(text), failure);
  }
  // Giving up says to come back in a few minutes, and the screen adds nothing to that.
  assert.match(en['gave-up'], /Ask again in a few minutes\.$/);
  assert.equal(failedText('gave-up').adds, 'nothing');
  // A bot check that gave no answer: the sentence names a content blocker, the screen another cause it can have.
  assert.equal(failedText('no-token').adds, 'other-cause');
  assert.match(en['no-token'], /^The bot check gave no answer/);
  assert.match(en['no-token'], /content blocker/);
  assert.match(strings.receive.en.failedOtherCause, /network that blocks Cloudflare/);
  assert.match(strings.receive.es.failedOtherCause, /red que bloquea a Cloudflare/);
  // It is one more cause, not "the other" one: a check can also fail for reasons nobody here can name.
  assert.match(strings.receive.en.failedOtherCause, /^Another cause can be /);
  assert.match(strings.receive.es.failedOtherCause, /^Otra causa puede ser /);
  // The Worker refusing a token is another thing, with its own sentence and nothing added.
  assert.deepEqual(failedText('bot_check'), { sentence: 'bot_check', adds: 'nothing' });
});

test('a bot check whose box was not ticked in time is told as that, and as nothing else', () => {
  const reasons: Record<NoToken, true> = { 'no-widget': true, error: true, unanswered: true, stopped: true };
  for (const why of Object.keys(reasons) as NoToken[]) {
    // Only a check that ran out of time with its widget on the page, and only when the widget took room on screen.
    assert.equal(boxWasWaiting(why, 149), why === 'unanswered', why);
    assert.equal(boxWasWaiting(why, 0), false, why);
  }
  // A widget that stayed out of sight for its whole minute was no box: that check went nowhere unseen.
  assert.equal(boxWasWaiting('unanswered', 0), false);
  assert.equal(boxWasWaiting('unanswered', Number.NaN), false);

  for (const lang of LANGS) {
    const text = strings.receive[lang].failedBoxWaited;
    // The cause, then the way out: two sentences, as in the error table.
    const { lead, rest } = splitLead(text);
    assert.ok(lead.endsWith('.') && rest.endsWith('.') && rest !== '', lang);
    // It takes the place of the sentence for "no-token", whose cause and way out are not what happened.
    assert.doesNotMatch(text, /blocker|bloqueador|Cloudflare|challenges\./i, lang);
    assert.ok(!strings.errors[lang]['no-token'].includes(lead), lang);
  }
  const { en, es } = strings.receive;
  assert.equal(splitLead(en.failedBoxWaited).lead, 'The bot check showed a box, and it was not ticked in time.');
  assert.match(en.failedBoxWaited, /Ask again, and tick the box/);
  assert.match(es.failedBoxWaited, /Vuelve a pedir, y marca la casilla/);
  // How long that is, is not typed into any sentence: the check's own limit can change.
  assert.equal(BOT_CHECK_WAIT_MS, 60_000);
  for (const lang of LANGS) {
    for (const key of ['failedBoxWaited', 'stateChecking', 'checkBoxShows'] as const) {
      assert.doesNotMatch(strings.receive[lang][key], /\b(60|minute|minuto)/, `${lang}.${key}`);
    }
  }
});

test('the box is said to a reader who cannot see it, a moment after it has appeared', () => {
  // Late enough that a check which passes by itself is over, early enough to leave most of the minute.
  assert.ok(BOX_SAY_MS >= 1_000 && BOX_SAY_MS <= 5_000, String(BOX_SAY_MS));
  assert.ok(BOX_SAY_MS * 10 < BOT_CHECK_WAIT_MS);
  assert.equal(strings.receive.en.checkBoxShows, 'The bot check is showing a box under the button. Tick it to go on.');
  assert.match(strings.receive.es.checkBoxShows, /muestra una casilla debajo del botón\. Márcala para continuar\.$/);
  // The line on screen says the same thing to do, in the same word.
  assert.match(strings.receive.en.stateChecking, /If it shows a box below, tick it\.$/);
  assert.match(strings.receive.es.stateChecking, /Si muestra una casilla aquí abajo, márcala\.$/);
});

// -- the faucet is closed, or its settings are not here yet -------------------------------

test('the card waits for the settings a little longer than the wallet does, and then no longer', () => {
  // The wallet gives its one request for the settings REQUEST_MS. Until that has ended, an empty
  // site key is not yet a closed faucet.
  assert.ok(SETTINGS_WAIT_MS > REQUEST_MS, `${SETTINGS_WAIT_MS} > ${REQUEST_MS}`);
  assert.ok(SETTINGS_WAIT_MS <= REQUEST_MS + 10_000);
});

test('a closed faucet: the line under its sentence gives the other cause and the way to look again', () => {
  const { en, es } = strings.receive;
  // The sentence is the error table's, and its way out alone does not work on a page that is already open.
  assert.match(strings.errors.en.closed, /^The faucet is switched off right now\./);
  assert.match(strings.errors.en.closed, /Try again later\.$/);
  // So the screen adds: when the page learns it, what else an empty answer can mean, and Reload.
  assert.match(en.closedReload, /when it loads/);
  assert.match(en.closedReload, /If that answer did not arrive, the faucet shows as switched off as well\./);
  assert.match(en.closedReload, /Reload the page to check again\.$/);
  assert.match(es.closedReload, /cuando se carga/);
  assert.match(es.closedReload, /Si esa respuesta no llegó, el faucet también aparece como apagado\./);
  assert.match(es.closedReload, /Recarga la página para volver a comprobarlo\.$/);
});

// -- a new address ----------------------------------------------------------------------

test('a payment without a record: only after the faucet has answered, and only when it sent none', () => {
  for (const phase of phases) {
    const promised = phase === 'on-its-way' || phase === 'arrived' || phase === 'confirmed';
    assert.equal(paidWithoutRecord(view(phase)), promised, phase);
    assert.equal(paidWithoutRecord(view(phase, { payment: PAYMENT })), false, phase);
  }
});

test('"Show a new address" is offered once coins have arrived, whatever the faucet is doing', () => {
  for (const phase of phases) {
    assert.equal(offersNewAddress(1n, view(phase)), true, phase);
    assert.equal(offersNewAddress(100_000n, view(phase, { payment: PAYMENT })), true, phase);
  }
});

test('with no coins here it is offered only where this address will get none from the faucet', () => {
  // Nothing asked yet, a request under way, a payment on its way: the address is still waiting for its coins.
  for (const phase of ['idle', 'checking', 'asking', 'waiting'] as const) {
    assert.equal(offersNewAddress(0n, view(phase)), false, phase);
  }
  assert.equal(offersNewAddress(0n, view('on-its-way', { payment: PAYMENT })), false);
  // The faucet has paid this address before: asking again for it gets nothing.
  assert.equal(offersNewAddress(0n, view('on-its-way')), true);
  // The faucet refuses this address for good.
  assert.equal(offersNewAddress(0n, view('failed', { failure: 'own_address' })), true);
  assert.equal(offersNewAddress(0n, view('failed', { failure: 'already_paid' })), true);
  // Any other failure: the same address can be asked for again.
  for (const failure of ['network', 'no-token', 'gave-up', 'bot_check', 'unavailable', 'bad_address'] as const) {
    assert.equal(offersNewAddress(0n, view('failed', { failure })), false, failure);
  }
  // The button is on screen exactly where the screen says where it is.
  for (const failure of failures) {
    assert.equal(offersNewAddress(0n, view('failed', { failure })), failedText(failure).adds === 'new-address', failure);
  }
});

test('the address is held while a request runs, and until a promised payment has arrived', () => {
  for (const phase of phases) {
    // A request under way: the wallet itself holds the address until the faucet has answered.
    assert.equal(addressHeld(view(phase)), faucetRuns(phase) ? 'answer' : null, phase);
    assert.equal(addressHeld(view(phase, { payment: PAYMENT })), faucetRuns(phase) ? 'answer' : phase === 'on-its-way' ? 'payment' : null, phase);
  }
  // Promised and not here yet: a new address now would wipe the promise from the screen.
  assert.equal(addressHeld(view('on-its-way', { payment: PAYMENT })), 'payment');
  // The faucet had paid before: there is no promise on screen to lose, and this address gets nothing more.
  assert.equal(addressHeld(view('on-its-way')), null);
  // Once the payment is here, the address is free again.
  assert.equal(addressHeld(view('arrived', { payment: PAYMENT })), null);
  assert.equal(addressHeld(view('confirmed', { payment: PAYMENT })), null);
  // Each cause has its own line under the button.
  for (const lang of LANGS) {
    const t = strings.receive[lang];
    assert.notEqual(t.newAddressWaits, t.newAddressWaitsPayment, lang);
  }
  assert.equal(strings.receive.en.newAddressWaits, 'The address stays as it is until the faucet has answered.');
  assert.equal(strings.receive.en.newAddressWaitsPayment, "The address stays as it is until the faucet's payment has arrived.");
  assert.match(strings.receive.es.newAddressWaitsPayment, /hasta que llegue el pago del faucet\.$/);
});

test('"show a new address and ask again" stands under a payment only while that button can be pressed', () => {
  // Coins from somewhere else are at the address, so the button is on screen in every phase.
  for (const phase of phases) {
    const paid = phase === 'on-its-way' || phase === 'arrived' || phase === 'confirmed';
    // With a record: not while the payment is still on its way, since the button is switched off then.
    assert.equal(offersMore(2_500n, view(phase, { payment: PAYMENT })), paid && phase !== 'on-its-way', phase);
    // Without one (the faucet had paid before): at once.
    assert.equal(offersMore(2_500n, view(phase)), paid, phase);
    // Whenever the line shows, the button it names is offered and not held.
    for (const faucet of [view(phase), view(phase, { payment: PAYMENT })]) {
      if (offersMore(2_500n, faucet)) {
        assert.equal(offersNewAddress(2_500n, faucet), true, phase);
        assert.equal(addressHeld(faucet), null, phase);
      }
    }
  }
  // No coins here yet and a payment promised: no button, so no line that names it.
  assert.equal(offersMore(0n, view('on-its-way', { payment: PAYMENT })), false);
  assert.equal(offersMore(0n, view('on-its-way')), true);
  assert.equal(offersMore(100_000n, view('arrived', { payment: PAYMENT })), true);
});

// -- bringing an answer on screen ---------------------------------------------------------

test('what fits the screen under the banner is scrolled to as little as needed, what does not from its first line', () => {
  // A phone 568 px tall with a 56 px banner has 512 px of room.
  assert.equal(scrollBlock(282, 568, 56), 'nearest');
  assert.equal(scrollBlock(512, 568, 56), 'nearest');
  assert.equal(scrollBlock(513, 568, 56), 'start');
  assert.equal(scrollBlock(900, 568, 0), 'start');
  // With no banner known, the whole screen is the room.
  assert.equal(scrollBlock(568, 568, 0), 'nearest');
});

// -- the address --------------------------------------------------------------------------

test('the path of a receive address is the one the wallet package derives it at', () => {
  assert.equal(addressPath(0), "m/84'/1'/0'/0/0");
  assert.equal(addressPath(7), "m/84'/1'/0'/0/7");
  assert.ok(addressPath(3).startsWith(`${ACCOUNT_PATH}/`));
  const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const watch = watchOnlyAccount(accountFromMnemonic(words).xpub);
  for (const index of [0, 1, 19]) assert.equal(addressPath(index), deriveAddress(watch, 0, index).path, String(index));
});

test('coins arrived: the amount with thousands grouped, and one sat in the singular', () => {
  assert.equal(arrivedText(100_000n, 'en'), '100,000 practice sats arrived at this address.');
  assert.equal(arrivedText(100_000n, 'es'), 'Llegaron 100,000 sats de práctica a esta dirección.');
  assert.equal(arrivedText(1n, 'en'), '1 practice sat arrived at this address.');
  assert.equal(arrivedText(1n, 'es'), 'Llegó 1 sat de práctica a esta dirección.');
  assert.equal(arrivedText(2n, 'en'), '2 practice sats arrived at this address.');
});

// -- the words ------------------------------------------------------------------------------

/** The screen's own files, with their text. */
function screenFiles(): { name: string; text: string }[] {
  const folder = new URL('../src/screens/receive/', import.meta.url);
  return [
    { name: 'Receive.svelte', text: readFileSync(new URL('../src/screens/Receive.svelte', import.meta.url), 'utf8') },
    ...readdirSync(folder).map((name) => ({ name: `receive/${name}`, text: readFileSync(new URL(name, folder), 'utf8') })),
  ];
}

test('every text of the table is used by the screen', () => {
  const files = screenFiles();
  assert.ok(files.length >= 5, 'the walk found the screen and its pieces');
  const code = files.map((file) => file.text).join('\n');
  for (const key of Object.keys(strings.receive.en)) {
    assert.match(code, new RegExp(`\\bt\\.${key}\\b`), `strings.receive.${key} is not used`);
  }
});

test('the sentences SPEC section 7 gives', () => {
  const { en } = strings.receive;
  assert.equal(fill(en.arrived, { amount: '100,000' }), '100,000 practice sats arrived at this address.');
  assert.equal(en.newAddress, 'Show a new address');
  assert.equal(en.newAddressWhy, 'A wallet uses a fresh address for each payment. The old one still works.');
  assert.equal(fill(en.stateRetryIn, { time: '18 seconds' }), 'Asking again in 18 seconds.');
  // The button says what the button that leads here says.
  for (const lang of LANGS) assert.equal(strings.receive[lang].faucetAsk, strings.wallet[lang].getCoins, lang);
});

test('facts are slots, never numbers written into a sentence', () => {
  const slots: Record<string, string[]> = {
    arrived: ['amount'],
    faucetPays: ['amount'],
    stateRetryIn: ['time'],
    statePromised: ['amount'],
    stateArrived: ['amount', 'minutes', 'seconds'],
    stateConfirmed: ['amount'],
    faucetOnce: ['hours'],
    failedNewAddress: ['button'],
  };
  for (const lang of LANGS) {
    for (const [key, text] of Object.entries(strings.receive[lang])) {
      assert.deepEqual(slotNames(text).sort(), slots[key] ?? [], `${lang}.${key}`);
      // What the faucet pays, how often a block comes, Bitcoin's block time, the faucet's rule: none is typed in.
      assert.doesNotMatch(text, /100,000|\b30 (seconds|segundos)\b|\b10 (minutes|minutos)\b|\b24 (hours|horas)\b/, `${lang}.${key}`);
      // No button's words are typed into a sentence either: they are filled in from the button's own text.
      if (key !== 'faucetAsk' && key !== 'newAddress') {
        assert.ok(!text.includes(strings.receive[lang].faucetAsk), `${lang}.${key}`);
        assert.ok(!text.includes(strings.receive[lang].newAddress), `${lang}.${key}`);
      }
    }
  }
  // The faucet's rule is the one the error table names, and Bitcoin's block time is Bitcoin's.
  assert.equal(FAUCET_ONCE_HOURS, 24);
  assert.match(strings.errors.en.already_paid, new RegExp(`once every ${FAUCET_ONCE_HOURS} hours`));
  assert.match(strings.errors.es.already_paid, new RegExp(`una vez cada ${FAUCET_ONCE_HOURS} horas`));
  assert.equal(BITCOIN_BLOCK_MINUTES, 10);
});

test('the state line, filled in as the screen fills it', () => {
  const { en, es } = strings.receive;
  assert.equal(
    fill(en.statePromised, { amount: '100,000 practice sats' }),
    'The faucet has sent 100,000 practice sats to this address. The payment is on its way and shows here in a moment.',
  );
  assert.equal(
    fill(en.stateArrived, { amount: '100,000 practice sats', seconds: '30', minutes: '10' }),
    "The faucet's payment of 100,000 practice sats has arrived. It is unconfirmed until the next block. Here a block comes every 30 seconds. On Bitcoin the average is 10 minutes.",
  );
  assert.equal(
    fill(es.stateArrived, { amount: '100,000 sats de práctica', seconds: '30', minutes: '10' }),
    'Llegó el pago del faucet, de 100,000 sats de práctica. Está sin confirmar hasta el próximo bloque. Aquí llega un bloque cada 30 segundos. En Bitcoin, el promedio es de 10 minutos.',
  );
  assert.equal(
    fill(en.faucetOnce, { hours: String(FAUCET_ONCE_HOURS) }),
    'The faucet pays an address once, and then not again for 24 hours. For more practice coins, show a new address and ask again.',
  );
  // Without a payment record: the faucet has paid before, and the coins are on their way or already here.
  assert.equal(en.statePaidBefore, 'The faucet has paid this address before. The coins are on their way or already here.');
  assert.match(es.statePaidBefore, /ya le había pagado a esta dirección\. Las monedas están en camino o ya llegaron\.$/);
});

test('what the screen says of the bot check, and nothing more', () => {
  const { en, es } = strings.receive;
  // Before the tap: whose it is, and that it is given the address. That paragraph stays above the
  // button while the check runs, so the line under the button does not say it a second time.
  assert.match(en.faucetCheck, /Cloudflare's/);
  assert.match(en.faucetCheck, /given this address/);
  assert.match(es.faucetCheck, /de Cloudflare/);
  assert.match(es.faucetCheck, /recibe esta dirección/);
  assert.doesNotMatch(en.stateChecking, /Cloudflare|address/);
  assert.doesNotMatch(es.stateChecking, /Cloudflare|dirección/);
  assert.match(en.stateChecking, /^Checking that you are not a bot\. This takes a moment\./);
  assert.match(es.stateChecking, /^Comprobando que no eres un bot\. Tarda un momento\./);
  // Before the tap: when it loads, and that it looks at the browser (SPEC section 12).
  assert.match(en.faucetCheck, /loads only when you ask for coins/);
  assert.match(en.faucetCheck, /examines your browser/);
  assert.match(es.faucetCheck, /se carga solo cuando pides monedas/);
  assert.match(es.faucetCheck, /examina tu navegador/);
  // A passkey wallet: asking locks it, and the next move to another screen loads the page afresh.
  assert.match(en.faucetLocks, /^Asking for coins locks this wallet, and your next move to another screen loads the page afresh\./);
  assert.match(es.faucetLocks, /^Pedir monedas bloquea esta billetera, y tu próximo paso a otra pantalla carga la página de nuevo\./);
  // No promise the page cannot keep (notes/06 section 4.2), in any text of the screen.
  for (const lang of LANGS) {
    for (const [key, text] of Object.entries(strings.receive[lang])) {
      const where = `${lang}.${key}`;
      assert.doesNotMatch(text, /nothing leaves|never leaves|anonymous|\bprivate\b|\bsafe\b|\bsecure\b|collects? nothing/i, where);
      assert.doesNotMatch(text, /nada sale|nunca sale|an[oó]nim|\bprivad[oa]\b|\bsegur[oa]\b/i, where);
    }
  }
});

test('the words the app holds to', () => {
  for (const [key, text] of Object.entries(strings.receive.en)) {
    // Not in a block yet is "unconfirmed"; the faucet is asked, and gives no rewards.
    assert.doesNotMatch(text, /\bpending\b|\bclaim|\bearn|\breward|\bfree\b|\bredeem/i, key);
    // There is no account here, and practice coins are never test coins or tokens.
    assert.doesNotMatch(text, /\baccount\b|\bsign in\b|\blog in\b|\btest coins?\b|\btokens?\b|\btestnet\b/i, key);
    // Amounts are practice sats: no other unit and no price.
    assert.doesNotMatch(text, /\bBTC\b|\$|\bUSD\b/, key);
  }
  for (const [key, text] of Object.entries(strings.receive.es)) {
    assert.doesNotMatch(text, /\bpendiente|\bgratis\b|\bcuenta\b|\bcartera\b|\bmonedero\b|\bgrifo\b|\btarifa\b/i, key);
    // A Bitcoin key is a "clave"; "llave" is only ever a passkey.
    assert.doesNotMatch(text, /\bllaves?\b(?! de acceso)/i, key);
  }
  const { en, es } = strings.receive;
  assert.match(en.stateArrived, /unconfirmed until the next block/);
  assert.match(es.stateArrived, /sin confirmar hasta el próximo bloque/);
  // The Spanish names the faucet by its loanword, and says what it is where it is first met.
  assert.match(es.lede, /el faucet, que reparte monedas de práctica a quien las pide/);
  assert.match(es.faucetCheck, /comprobación contra bots/);
  // The address is a practice address, and real bitcoin never goes to it.
  assert.match(en.addressFor, /practice address: never send real bitcoin to it\.$/);
  assert.match(es.addressFor, /dirección de práctica: nunca le envíes bitcoin de verdad\.$/);
});

test('a line that follows a failure adds to its sentence and never repeats it', () => {
  for (const lang of LANGS) {
    const t = strings.receive[lang];
    for (const key of ['failedOtherCause', 'failedNewAddress', 'closedReload'] as const) {
      assert.ok(t[key].endsWith('.'), `${lang}.${key}`);
      for (const sentence of Object.values(strings.errors[lang])) assert.ok(!sentence.includes(t[key]), `${lang}.${key}`);
    }
  }
});

// -- the screen's files ---------------------------------------------------------------------

test('the screen goes through the wallet and the page\'s security policy', () => {
  for (const { name, text } of screenFiles()) {
    for (const banned of [/localStorage/, /sessionStorage/, /indexedDB/, /navigator\.credentials/, /\bfetch\s*\(/, /XMLHttpRequest/]) {
      assert.doesNotMatch(text, banned, name);
    }
    // What the page's security policy would refuse, and what Svelte 5 has replaced.
    for (const banned of [/\sstyle=/, /<style/, /\{@html/, /\son:[a-z]+=/, /export let /, /<slot/]) {
      assert.doesNotMatch(text, banned, name);
    }
    // A second status region would be announced on top of the shell's one.
    assert.doesNotMatch(text, /role="status"|aria-live/, name);
    // English source is plain ASCII.
    assert.match(text, /^[\x09\x0a\x20-\x7e]*$/, name);
  }
});

test('the bot check\'s script is named in one place, and only the token source adds a script to the page', () => {
  const files = screenFiles();
  const adds = files.filter((file) => /createElement\(\s*'script'\s*\)/.test(file.text)).map((file) => file.name);
  assert.deepEqual(adds, ['receive/bot-check.ts']);
  const names = files.filter((file) => /TURNSTILE_SCRIPT|challenges\.cloudflare/.test(file.text)).map((file) => file.name);
  assert.deepEqual(names, ['receive/bot-check.ts']);
  // The token source is built when the screen opens and does nothing until it is asked: the screen
  // calls it from the faucet button's handler alone.
  const card = files.find((file) => file.name === 'receive/FaucetCard.svelte')!.text;
  assert.equal(card.match(/botCheck\.token\(/g)?.length, 1);
  assert.match(card, /wallet\.askFaucet\(source\)/);
  assert.match(card, /before: \(\) => wallet\.beforeBotCheck\(\)/);
  assert.match(card, /await busyWhile\(start\)/);
});

test('the pieces keep to the forms the app writes', () => {
  for (const { name, text } of screenFiles()) {
    // A value worked out inside markup is "{const x = $derived(...)}": "{@const}" is the old form.
    assert.doesNotMatch(text, /\{@const\b/, name);
  }
  const card = screenFiles().find((file) => file.name === 'receive/FaucetCard.svelte')!.text;
  // What the tap sets going stands above the button, and the button names it as its description.
  assert.match(card, /<div id=\{about\}/);
  assert.match(card, /aria-describedby=\{about\}/);
  // The countdown is no part of the alert above it: an alert is read out whole.
  const state = screenFiles().find((file) => file.name === 'receive/FaucetState.svelte')!.text;
  const waiting = state.slice(state.indexOf("view.phase === 'waiting'"), state.indexOf("view.phase === 'on-its-way'"));
  assert.match(waiting, /<Notice [^>]*\/>\s*(<!--[\s\S]*?-->\s*)?\{#if view\.retryAt !== null\}\s*<Countdown /);
});
