// The plain helpers behind the pieces every wallet screen shares
// (src/components/wallet), and the rules their text keeps: how typed and
// pasted words land in the twelve fields, which fields hold a wrong word,
// what the frame says about the coins, what the unlock step offers after
// each answer, and how a transaction's parts are marked.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import {
  isValidMnemonic,
  normalizeMnemonic,
  unknownWords,
  type TxPart,
  type TxView,
} from '@learnbitcoin/practice-wallet';
import { splitLead } from '../src/components/text.ts';
import {
  SAFARI_KEEPS_DAYS,
  SECTIONS,
  chainFailureText,
  chainPhase,
  noteAnnouncement,
  noticeText,
  satsText,
} from '../src/components/wallet/frame.ts';
import { feeRateText, lacksChange, partMark, partPlace, txWhen } from '../src/components/wallet/tx-text.ts';
import {
  problemOfUnlock,
  problemOfWords,
  unlockOffers,
  type UnlockProblem,
  type UnlockRefusal,
} from '../src/components/wallet/unlock-flow.ts';
import { WORD_COUNT, checkFields, placeWords, splitWords } from '../src/components/wallet/words.ts';
import type { ApiFailure } from '../src/lib/api.ts';
import { fill, slotNames } from '../src/lib/format.ts';
import { needsWallet } from '../src/lib/router.ts';
import type { CeremonyFailure, Notice, UnlockResult, UnlockWordsResult, WordsCheck } from '../src/lib/wallet-api.ts';
import { strings } from '../src/strings/index.ts';
import { frameDemo, galleryPage } from '../dev/pages.ts';
import { parseSteps } from '../dev/play.ts';

/** WalletApi.checkWords, as the wallet package answers it. */
function checkWords(input: string): WordsCheck {
  const text = normalizeMnemonic(input);
  return { words: text === '' ? [] : text.split(' '), unknown: unknownWords(text), valid: isValidMnemonic(text) };
}

const GOOD = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
const empty = (): string[] => Array.from({ length: WORD_COUNT }, () => '');

// -- typed and pasted words -------------------------------------------------------

test('splitWords: words are told apart by white space, commas and semicolons', () => {
  assert.deepEqual(splitWords('abandon ability able'), ['abandon', 'ability', 'able']);
  assert.deepEqual(splitWords('  abandon\tability\n\nable  '), ['abandon', 'ability', 'able']);
  assert.deepEqual(splitWords('abandon, ability;able'), ['abandon', 'ability', 'able']);
  assert.deepEqual(splitWords(''), []);
  assert.deepEqual(splitWords('   '), []);
});

test('splitWords: capitals are lowered, and the numbers of a copied list are dropped', () => {
  assert.deepEqual(splitWords('Abandon ABILITY'), ['abandon', 'ability']);
  assert.deepEqual(splitWords('1. abandon\n2. ability\n3. able'), ['abandon', 'ability', 'able']);
  assert.deepEqual(splitWords('1.abandon 2)ability 3:able 12-zoo'), ['abandon', 'ability', 'able', 'zoo']);
  assert.deepEqual(splitWords('abandon. ability.'), ['abandon', 'ability']);
  // A word that is not English is kept as typed, so that the reader sees it called wrong.
  assert.deepEqual(splitWords('ábaco zzz'), ['ábaco', 'zzz']);
});

test('placeWords: one word typed with a space stays in its field, and the reader moves on', () => {
  const fields = empty();
  fields[3] = 'able ';
  const placed = placeWords(fields, 3, splitWords(fields[3]));
  assert.equal(placed.fields[3], 'able');
  assert.equal(placed.next, 4);
  assert.equal(placed.fields.filter((word) => word !== '').length, 1);
});

test('placeWords: pasted words are spread from the field they were pasted into', () => {
  const placed = placeWords(empty(), 4, ['able', 'about', 'above']);
  assert.deepEqual(placed.fields.slice(4, 7), ['able', 'about', 'above']);
  assert.equal(placed.fields[3], '');
  assert.equal(placed.fields[7], '');
  assert.equal(placed.next, 7);
});

test('placeWords: a whole phrase starts at the first field, wherever it was pasted', () => {
  const placed = placeWords(empty(), 5, GOOD);
  assert.deepEqual(placed.fields, GOOD);
  assert.equal(placed.next, WORD_COUNT - 1);
  // More than twelve: the rest is dropped.
  assert.deepEqual(placeWords(empty(), 0, [...GOOD, 'zoo']).fields, GOOD);
});

test('placeWords: words past the last field are dropped, and only spaces empty the field', () => {
  const tail = placeWords(empty(), 10, ['able', 'about', 'above']);
  assert.deepEqual(tail.fields.slice(10), ['able', 'about']);
  assert.equal(tail.next, WORD_COUNT - 1);
  const fields = empty();
  fields[2] = '  ';
  const cleared = placeWords(fields, 2, []);
  assert.equal(cleared.fields[2], '');
  assert.equal(cleared.next, 2);
  // The fields handed in are never changed.
  assert.equal(fields[2], '  ');
});

// -- which fields are wrong -------------------------------------------------------

test('checkFields: twelve good words are valid, and come back as one text', () => {
  const found = checkFields(GOOD, checkWords);
  assert.deepEqual(found, { text: GOOD.join(' '), unknown: [], empty: [], valid: true });
});

test('checkFields: a wrong word is found in its own field, even after empty fields', () => {
  // Fields 0, 4 and 7 are filled; the wallet sees three words and calls its
  // third one unknown. That is field 7, not field 2.
  const fields = empty();
  fields[0] = 'abandon';
  fields[4] = 'ability';
  fields[7] = 'abandn';
  const found = checkFields(fields, checkWords);
  assert.deepEqual(found.unknown, [7]);
  assert.deepEqual(found.empty, [1, 2, 3, 5, 6, 8, 9, 10, 11]);
  assert.equal(found.valid, false);
  assert.equal(found.text, 'abandon ability abandn');
});

test('checkFields: twelve words on the list with a bad checksum are not valid, and none is unknown', () => {
  const found = checkFields(Array.from({ length: WORD_COUNT }, () => 'abandon'), checkWords);
  assert.deepEqual(found.unknown, []);
  assert.deepEqual(found.empty, []);
  assert.equal(found.valid, false);
});

test('checkFields: capitals and stray spaces do not make a word wrong; two words in one field do', () => {
  const fields = [...GOOD];
  fields[0] = ' Abandon ';
  assert.equal(checkFields(fields, checkWords).valid, true);
  fields[5] = 'abandon abandon';
  const found = checkFields(fields, checkWords);
  assert.deepEqual(found.unknown, [5]);
  assert.equal(found.valid, false);
});

test('checkFields: nothing typed is twelve empty fields', () => {
  const found = checkFields(empty(), checkWords);
  assert.equal(found.empty.length, WORD_COUNT);
  assert.equal(found.text, '');
  assert.equal(found.valid, false);
});

// -- the frame --------------------------------------------------------------------

test('the sections are the seven wallet routes, each with a name in both languages', () => {
  assert.deepEqual([...SECTIONS], ['wallet', 'coins', 'receive', 'send', 'activity', 'backup', 'settings']);
  for (const name of SECTIONS) {
    assert.ok(needsWallet({ name }), name);
    for (const lang of LANGS) assert.ok(strings.common[lang][`section_${name}`], `${lang}.${name}`);
  }
});

test('chainPhase: no total until the first look has worked, and old values stay after a later failure', () => {
  const state = {} as NonNullable<Parameters<typeof chainPhase>[0]['state']>;
  assert.equal(chainPhase({ state: null, error: null }), 'looking');
  assert.equal(chainPhase({ state: null, error: 'unavailable' }), 'failed');
  assert.equal(chainPhase({ state, error: null }), 'fresh');
  assert.equal(chainPhase({ state, error: 'network' }), 'stale');
});

test('noticeText: one sentence for each thing the wallet announces, in both languages', () => {
  const notices: Record<Notice['kind'], Notice> = {
    'coins-arrived': { id: 1, kind: 'coins-arrived', sats: 100_000n },
    confirmed: { id: 2, kind: 'confirmed' },
    'payment-sent': { id: 3, kind: 'payment-sent' },
    unlocked: { id: 4, kind: 'unlocked' },
    locked: { id: 5, kind: 'locked' },
  };
  for (const lang of LANGS) {
    const said = Object.values(notices).map((notice) => noticeText(notice, lang));
    assert.equal(new Set(said).size, said.length, lang);
    for (const sentence of said) {
      assert.ok(sentence.endsWith('.'), sentence);
      assert.ok(!sentence.includes('{'), sentence);
    }
  }
  assert.equal(noticeText(notices['coins-arrived'], 'en'), '100,000 practice sats arrived.');
  assert.equal(noticeText(notices['coins-arrived'], 'es'), 'Llegaron 100,000 sats de práctica.');
  // One sat is its own sentence: in Spanish the verb changes with the count.
  assert.equal(noticeText({ id: 6, kind: 'coins-arrived', sats: 1n }, 'en'), '1 practice sat arrived.');
  assert.equal(noticeText({ id: 6, kind: 'coins-arrived', sats: 1n }, 'es'), 'Llegó 1 sat de práctica.');
  assert.equal(noticeText(notices.confirmed, 'en'), '1 confirmation.');
});

test('chainFailureText: the frame does not tell the reader to wait a minute above its own countdown', () => {
  // The frame tries again by itself and counts down to it, with a "Try
  // again" button underneath. For the two failures that only waiting cures,
  // the sentence's own "wait and try again" is left out: the cause stays,
  // and so does the line that says the fault is ours.
  assert.equal(
    chainFailureText('unavailable', 'en'),
    'The practice network could not answer just now. The fault is on our side.',
  );
  assert.equal(chainFailureText('limit', 'en'), 'You are asking the practice network faster than it allows.');
  assert.equal(
    chainFailureText('unavailable', 'es'),
    'La red de práctica no pudo responder en este momento. La falla es nuestra.',
  );
  for (const lang of LANGS) {
    for (const failure of ['unavailable', 'limit'] as const) {
      const shown = chainFailureText(failure, lang);
      assert.doesNotMatch(shown, /minute|minuto/, `${lang}.${failure}`);
      assert.ok(strings.errors[lang][failure].startsWith(shown), `${lang}.${failure}`);
    }
  }
  // Every other failure keeps its whole sentence: its way out says something
  // the frame's own lines do not (check the connection, reload the page).
  const whole: ApiFailure[] = ['network', 'forbidden', 'bad_request', 'method', 'too_large', 'not_found'];
  for (const lang of LANGS) {
    for (const failure of whole) assert.equal(chainFailureText(failure, lang), strings.errors[lang][failure], failure);
  }
  assert.match(chainFailureText('network', 'en'), /Check your internet connection/);
  assert.match(chainFailureText('forbidden', 'en'), /Reload the page/);
});

test('noteAnnouncement: a switch to another wallet is said; a rebuilt record is an alert already', () => {
  const switched = { kind: 'switched', tag: 'M3XD', fingerprint: 'b8688df1' } as const;
  for (const lang of LANGS) {
    const said = noteAnnouncement(switched, lang);
    // The first sentence of the note the frame shows, and nothing made up beside it.
    assert.equal(said, splitLead(strings.wallet[lang].noteSwitched).lead, lang);
    assert.ok(said !== null && said.endsWith('.') && !said.includes('{'), lang);
    assert.equal(noteAnnouncement({ kind: 'tampered' }, lang), null, lang);
  }
  assert.match(noteAnnouncement(switched, 'en') ?? '', /^This browser now holds a different practice wallet/);
});

test('satsText: an amount with its unit, one sat in the singular', () => {
  assert.equal(satsText(25_000n, 'en'), '25,000 practice sats');
  assert.equal(satsText(1n, 'en'), '1 practice sat');
  assert.equal(satsText(0n, 'en'), '0 practice sats');
  assert.equal(satsText(25_000n, 'es'), '25,000 sats de práctica');
  assert.equal(satsText(1n, 'es'), '1 sat de práctica');
});

// -- the unlock step ----------------------------------------------------------------

// Written out as objects so that the compiler refuses a missing answer: add a
// kind to UnlockResult and its line must be added here.
const CEREMONY: Record<CeremonyFailure['kind'], CeremonyFailure> = {
  cancelled: { kind: 'cancelled', timedOut: false },
  'no-prf': { kind: 'no-prf', tag: 'K7Q2' },
  error: { kind: 'error', name: 'NotAllowedError' },
  busy: { kind: 'busy' },
  reload: { kind: 'reload' },
  broken: { kind: 'broken' },
};
const REFUSALS: Record<UnlockRefusal['kind'], UnlockRefusal> = {
  ...CEREMONY,
  changed: { kind: 'changed' },
  gone: { kind: 'gone' },
};
const OPENED: Record<Exclude<UnlockResult['kind'], UnlockRefusal['kind']>, true> = {
  unlocked: true,
  tampered: true,
  'other-passkey': true,
};
const WORD_REFUSALS: Record<Exclude<UnlockWordsResult, 'unlocked'>, UnlockProblem['kind']> = {
  invalid: 'words-invalid',
  'other-wallet': 'other-wallet',
  gone: 'gone',
  reload: 'passkey',
  broken: 'passkey',
};

test('unlock: every answer that opens nothing is a problem to show', () => {
  assert.equal(Object.keys(REFUSALS).length + Object.keys(OPENED).length, 11);
  for (const [kind, result] of Object.entries(REFUSALS)) {
    const problem = problemOfUnlock(result);
    if (kind === 'changed' || kind === 'gone') assert.deepEqual(problem, { kind });
    else assert.deepEqual(problem, { kind: 'passkey', failure: result });
  }
  for (const [answer, kind] of Object.entries(WORD_REFUSALS)) {
    assert.equal(problemOfWords(answer as keyof typeof WORD_REFUSALS).kind, kind, answer);
  }
  // The two dead ends of the words are the passkey's, with the same sentences.
  assert.deepEqual(problemOfWords('reload'), { kind: 'passkey', failure: { kind: 'reload' } });
  assert.deepEqual(problemOfWords('broken'), { kind: 'passkey', failure: { kind: 'broken' } });
});

test('unlock: one button before any try; the picker and the words after a refusal', () => {
  assert.deepEqual(unlockOffers(null, false), { stored: true, picker: false, words: false });
  assert.deepEqual(unlockOffers(null, true), { stored: true, picker: true, words: true });
  const all = { stored: true, picker: true, words: true };
  for (const kind of ['cancelled', 'no-prf', 'error', 'busy'] as const) {
    assert.deepEqual(unlockOffers({ kind: 'passkey', failure: CEREMONY[kind] }, true), all, kind);
  }
  assert.deepEqual(unlockOffers({ kind: 'passkey', failure: { kind: 'cancelled', timedOut: true } }, true), all);
  for (const kind of ['words-invalid', 'other-wallet', 'no-storage'] as const) {
    assert.deepEqual(unlockOffers({ kind }, true), all, kind);
  }
});

test('unlock: after "changed" only the words; after "gone", "reload" and "broken" nothing', () => {
  const none = { stored: false, picker: false, words: false };
  // The same passkey would only give the same answer again.
  assert.deepEqual(unlockOffers({ kind: 'changed' }, true), { ...none, words: true });
  assert.deepEqual(unlockOffers({ kind: 'gone' }, true), none);
  assert.deepEqual(unlockOffers({ kind: 'passkey', failure: { kind: 'reload' } }, true), none);
  assert.deepEqual(unlockOffers({ kind: 'passkey', failure: { kind: 'broken' } }, true), none);
});

test('unlock: what went wrong is drawn under the word fields, right above the buttons', () => {
  // Drawn at the top of the step, the answer to typed words was a screenful
  // above the button that had been pressed, and on a phone the reader never
  // saw it. So in the step's markup the answer comes after the fields and
  // before either row of buttons.
  const source = readFileSync(new URL('../src/components/wallet/Unlock.svelte', import.meta.url), 'utf8');
  const markup = source.slice(source.indexOf('</script>'));
  const at = (text: string): number => {
    const index = markup.indexOf(text);
    assert.notEqual(index, -1, text);
    return index;
  };
  const fields = at('<WordsInput');
  const answer = at('data-testid="unlock-problem"');
  assert.ok(fields < answer, 'the answer comes after the fields');
  assert.ok(answer < at('data-testid="unlock-words-go"'), 'and before the button that sends the words');
  assert.ok(answer < at('data-testid="unlock"'), 'and before the passkey buttons');
  // Every answer is drawn there: none is left above the fields.
  assert.equal(markup.slice(0, fields).includes('data-testid="unlock-problem"'), false);
});

// -- coins and transactions ---------------------------------------------------------

test('feeRateText: whole rates as they are, others to two places, with thousands grouped', () => {
  assert.equal(feeRateText(2), '2');
  assert.equal(feeRateText(282 / 141), '2');
  assert.equal(feeRateText(283 / 141), '2.01');
  assert.equal(feeRateText(2.5), '2.5');
  assert.equal(feeRateText(2.05), '2.05');
  assert.equal(feeRateText(1.999), '2');
  assert.equal(feeRateText(0.1), '0.1');
  assert.equal(feeRateText(0), '0');
  assert.equal(feeRateText(1000), '1,000');
  assert.equal(feeRateText(1234.567), '1,234.57');
  // Never a comma for the decimal point, whatever the browser's language.
  assert.doesNotMatch(feeRateText(2.25), /,/);
  assert.equal(feeRateText(Number.NaN), '0');
});

test('txWhen: unconfirmed, then elapsed time for a day, then the date', () => {
  const now = 1_800_000_000_000;
  const seconds = now / 1000;
  assert.deepEqual(txWhen({ confirmed: false, time: null }, now), { kind: 'unconfirmed' });
  assert.deepEqual(txWhen({ confirmed: true, time: null }, now), { kind: 'confirmed' });
  assert.deepEqual(txWhen({ confirmed: true, time: seconds - 360 }, now), { kind: 'ago', seconds: 360 });
  assert.deepEqual(txWhen({ confirmed: true, time: seconds - 86_399 }, now), { kind: 'ago', seconds: 86_399 });
  assert.deepEqual(txWhen({ confirmed: true, time: seconds - 86_400 }, now), { kind: 'date', time: seconds - 86_400 });
  // A block whose time is ahead of the reader's clock happened just now.
  assert.deepEqual(txWhen({ confirmed: true, time: seconds + 40 }, now), { kind: 'ago', seconds: 0 });
});

const part = (address: string | null, value: bigint, mine = false, change = false): TxPart => ({
  address,
  value,
  mine,
  change,
});

test('partMark: change is an output coming back; a spent change coin is just this wallet', () => {
  assert.equal(partMark(part('a', 1n), 'output'), 'none');
  assert.equal(partMark(part('a', 1n, true), 'output'), 'mine');
  assert.equal(partMark(part('a', 1n, true, true), 'output'), 'change');
  assert.equal(partMark(part('a', 1n, true, true), 'input'), 'mine');
  assert.equal(partMark(part('a', 1n, true), 'input'), 'mine');
  assert.equal(partMark(part('a', 1n), 'input'), 'none');
});

test('partPlace: an input with no address and no value is a block making new coins', () => {
  assert.equal(partPlace(part('a', 5n), 'input'), 'address');
  assert.equal(partPlace(part(null, 0n), 'input'), 'new-coins');
  assert.equal(partPlace(part(null, 5n), 'input'), 'none');
  assert.equal(partPlace(part(null, 0n), 'output'), 'none');
});

test('lacksChange: only a transaction that spent this wallet coins owes a word about its change', () => {
  const view = (inputs: TxPart[], outputs: TxPart[]): Pick<TxView, 'inputs' | 'outputs'> => ({ inputs, outputs });
  // Sent, with change.
  assert.equal(lacksChange(view([part('a', 9n, true)], [part('x', 5n), part('c', 3n, true, true)])), false);
  // Sent, everything.
  assert.equal(lacksChange(view([part('a', 9n, true)], [part('x', 8n)])), true);
  // Received: the change is the sender's business.
  assert.equal(lacksChange(view([part('x', 9n)], [part('a', 5n, true), part('y', 3n)])), false);
  // The wallet paying one of its own receive addresses, nothing coming back as change.
  assert.equal(lacksChange(view([part('a', 9n, true)], [part('b', 8n, true)])), true);
});

// -- the text -----------------------------------------------------------------------

test('wallet text: the sentences SPEC section 3 and 4 give word for word', () => {
  const { en } = strings.wallet;
  assert.equal(en.gateNoneTitle, 'This browser has no practice wallet.');
  assert.equal(
    fill(en.gateNoneWhy, { days: String(SAFARI_KEEPS_DAYS) }),
    'If you made one before, the browser may have erased its copy (Safari does after 7 days without use), or you made it in another browser or inside another app.',
  );
  assert.equal(en.newerTitle, 'This page is out of date.');
  assert.equal(en.chainLooking, "Looking up this wallet's coins...");
  assert.equal(en.chainSlow, "The practice network is slow right now. That is our fault, not your wallet's.");
  assert.equal(en.unlockPromise, 'Unlocking sends nothing. You will check the payment first.');
  assert.equal(en.noCoins, 'No coins yet.');
  assert.equal(en.getCoins, 'Get practice coins');
  // The short form of the exception paragraph (notes/06 section 3.5), in both languages.
  assert.equal(en.wordsException, 'Practice words only. The words of a real wallet never go into a web page, this one included.');
  assert.match(strings.wallet.es.wordsException, /incluida esta\.$/);
});

test('wallet text: facts are slots, never numbers written into a sentence', () => {
  for (const lang of LANGS) {
    const t = strings.wallet[lang];
    assert.deepEqual(slotNames(t.gateNoneWhy), ['days'], lang);
    assert.doesNotMatch(t.gateNoneWhy, /7/, lang);
    assert.deepEqual(slotNames(t.chainRetryIn), ['time'], lang);
    assert.deepEqual(slotNames(t.chainStale), ['when'], lang);
    assert.deepEqual(slotNames(t.wordsUnknown), ['n'], lang);
    assert.deepEqual(slotNames(t.totalUnconfirmed), ['amount'], lang);
    // No block interval and no faucet amount is written out anywhere in the table.
    for (const [key, text] of Object.entries(t)) {
      assert.doesNotMatch(text, /\b30 (seconds|segundos)\b|100,000/, `${lang}.${key}`);
    }
  }
});

test('wallet text: "unconfirmed" is the word, and a fingerprint is always a wallet fingerprint', () => {
  for (const [key, text] of Object.entries(strings.wallet.en)) {
    assert.doesNotMatch(text, /\bpending\b/i, key);
    // Every "fingerprint" has "wallet" right in front of it.
    for (const hit of text.matchAll(/\S*\s?fingerprints?/gi)) assert.match(hit[0], /^wallet fingerprints?$/i, key);
    // A wallet is removed from this browser, not deleted: its coins stay on the practice network.
    assert.doesNotMatch(text, /\bdelet/i, key);
  }
  for (const [key, text] of Object.entries(strings.wallet.es)) {
    assert.doesNotMatch(text, /\bpendiente/i, key);
    for (const hit of text.matchAll(/huellas?(\s+\S+){0,3}/gi)) assert.match(hit[0], /^huellas? de la billetera/i, key);
  }
  assert.equal(strings.common.en.unconfirmed, 'Unconfirmed');
});

test('wallet text: a refusal gives the cause and then the way out, and "changed" allows for both causes', () => {
  const problems = [
    'openExists',
    'noStorage',
    'passkeyTimedOut',
    'unreadableGone',
    'unlockChanged',
    'unlockGone',
    'unlockOtherWallet',
    'switchNoStorage',
    'wordsInvalid',
    'noteTampered',
  ] as const;
  for (const lang of LANGS) {
    for (const key of problems) {
      const text = strings.wallet[lang][key];
      assert.ok(text.split(/\. (?=[A-ZÁÉÍÓÚÑ])/).length >= 2, `${lang}.${key}`);
      assert.ok(text.endsWith('.'), `${lang}.${key}`);
    }
  }
  const { en, es } = strings.wallet;
  // Either the passkey gives another wallet now, or the saved record was replaced.
  assert.match(en.unlockChanged, /Either .+, or .+ was replaced\./);
  assert.match(es.unlockChanged, /O la llave de acceso .+, o lo que .+ fue reemplazado\./);
  // It never says the addresses shown so far were this wallet's, and it names both ways on.
  const changed = [en.unlockChanged, en.unlockChangedWarn, en.unlockChangedWords, en.unlockChangedRemove];
  for (const part of changed) assert.doesNotMatch(part, /your addresses|this wallet's addresses/i);
  assert.match(en.unlockChangedWords, /12 words/);
  assert.match(en.unlockChangedRemove, /remove the wallet .+ open it again with the passkey/i);
  // Remove names what brings a wallet back, and promises no passkey for what cannot be read.
  assert.match(en.unreadableWarn, /12 words/);
  assert.match(en.unreadableWarn, /cannot be undone/);
});

test('wallet text: the gravest answer comes in short parts, the warning by itself', () => {
  // "The passkey gave a wallet that fits nothing saved" was one paragraph of
  // six sentences, 22 lines on a small phone, with the warning in its
  // middle. Now: what happened, the warning, and each way out, each its own
  // paragraph.
  for (const lang of LANGS) {
    const t = strings.wallet[lang];
    // What happened: the cause, the two things it can mean, and that nothing was done.
    assert.equal(t.unlockChanged.split(/\. (?=[A-ZÁÉÍÓÚÑ])/).length, 3, lang);
    // The warning and the two ways out are one sentence each.
    for (const key of ['unlockChangedWarn', 'unlockChangedWords', 'unlockChangedRemove'] as const) {
      assert.equal(splitLead(t[key]).rest, '', `${lang}.${key}`);
      assert.ok(t[key].endsWith('.'), `${lang}.${key}`);
    }
  }
  assert.match(strings.wallet.en.unlockChangedWarn, /do not have coins sent to an address shown here/);
  assert.match(strings.wallet.es.unlockChangedWarn, /no pidas que te envíen monedas a una dirección/);
  assert.match(strings.wallet.en.unlockChanged, /Nothing was opened and nothing was changed\.$/);
});

test('wallet text: a passkey is pointed out by the tag in its name, never by a whole name made up here', () => {
  // The name was written when the passkey was made, in the language of that
  // page, and this browser keeps only the tag. So a piece can say that the
  // tag is in the name, and nothing more.
  for (const lang of LANGS) {
    const t = strings.wallet[lang];
    assert.deepEqual(slotNames(t.passkeyNamed), ['tag'], lang);
    assert.deepEqual(slotNames(t.switchPasskeyTagged), ['tag'], lang);
  }
  assert.equal(
    fill(strings.wallet.en.passkeyNamed, { tag: 'K7Q2' }),
    'The passkey that answered has "K7Q2" in its name.',
  );
  assert.equal(
    fill(strings.wallet.es.passkeyNamed, { tag: 'K7Q2' }),
    'La llave de acceso que respondió tiene "K7Q2" en su nombre.',
  );
  // No shared piece builds the name from the tag: the only text that may is
  // the one that names a new passkey, in the wallet's own module.
  const folder = new URL('../src/components/wallet/', import.meta.url);
  for (const name of readdirSync(folder)) {
    assert.doesNotMatch(readFileSync(new URL(name, folder), 'utf8'), /passkeyName\b/, name);
  }
});

// -- the pieces themselves ------------------------------------------------------------

test('no piece reaches around the wallet: no storage, no passkey call, no request of its own', () => {
  const folder = new URL('../src/components/wallet/', import.meta.url);
  const files = readdirSync(folder).filter((name) => name.endsWith('.svelte') || name.endsWith('.ts'));
  assert.ok(files.length >= 20, 'the walk found the pieces');
  for (const name of files) {
    const text = readFileSync(new URL(name, folder), 'utf8');
    for (const banned of [/localStorage/, /sessionStorage/, /indexedDB/, /navigator\.credentials/, /\bfetch\s*\(/, /XMLHttpRequest/]) {
      assert.doesNotMatch(text, banned, name);
    }
    // What the page's security policy would refuse, and what Svelte 5 has replaced.
    for (const banned of [/\sstyle=/, /<style/, /\{@html/, /\son:[a-z]+=/, /export let /, /<slot/]) {
      assert.doesNotMatch(text, banned, name);
    }
    // English source is plain ASCII.
    assert.match(text, /^[\x09\x0a\x20-\x7e]*$/, name);
  }
});

// -- the gallery ----------------------------------------------------------------------

test('gallery: its own pages have their addresses in both languages, and "#frame" asks for the sample screen', () => {
  assert.equal(galleryPage('/gallery/gates'), 'gates');
  assert.equal(galleryPage('/es/gallery/unlock'), 'unlock');
  assert.equal(galleryPage('/gallery/wallet/'), 'wallet');
  assert.equal(galleryPage('/gallery/pieces'), 'pieces');
  assert.equal(galleryPage('/gallery'), 'index');
  assert.equal(galleryPage('/wallet'), null);
  assert.equal(frameDemo(''), null);
  assert.equal(frameDemo('#frame'), '');
  assert.equal(frameDemo('#frame:demo-keys,unlock'), 'demo-keys,unlock');
  assert.equal(frameDemo('#framed'), null);
});

test('gallery: steps written at the end of an address', () => {
  assert.deepEqual(parseSteps(''), []);
  assert.deepEqual(parseSteps('demo-keys, unlock'), [{ tap: 'demo-keys' }, { tap: 'unlock' }]);
  assert.deepEqual(parseSteps('unlock,wait=300,words=abandon+ability,leave=2'), [
    { tap: 'unlock' },
    { wait: 300 },
    { words: 'abandon ability' },
    { leave: 2 },
  ]);
});
