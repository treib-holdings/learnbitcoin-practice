// What the three screens in front of the wallet decide (Home, Create and
// Restore): what stands in a screen's place, and what every answer of the
// wallet means on it. The functions are in src/screens/front/flow.ts; the
// lists of answers here are the wallet's own (src/lib/wallet-api.ts), every
// one of them.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import { fill } from '../src/lib/format.ts';
import type { CreateResult, KeepResult, RestoreResult, WalletStatus } from '../src/lib/wallet-api.ts';
import {
  chapterFourUrl,
  createView,
  frontGate,
  keepView,
  passkeyFace,
  passkeyNameStart,
  restoreHeldBy,
  restoreView,
  walletLine,
  wayIn,
  type Stop,
  type Way,
} from '../src/screens/front/flow.ts';
import { strings } from '../src/strings/index.ts';

const WAYS: Way[] = ['passkey', 'finish', 'words'];
const STOPS: (Stop | null)[] = [null, 'exists', 'no-storage', 'reload'];

// -- the gate ---------------------------------------------------------------------

test('gate: what is stored decides first, whatever else is true', () => {
  for (const canStore of [true, false]) {
    for (const stop of STOPS) {
      const where = `canStore ${canStore}, stop ${stop}`;
      // Something stored that cannot be used: the shared piece, never a way to make another wallet.
      for (const status of ['unreadable', 'newer', 'broken'] as const) assert.equal(frontGate(status, canStore, stop), 'trouble', `${status}, ${where}`);
      // A wallet is here: one browser keeps one.
      assert.equal(frontGate('ready', canStore, stop), 'here', where);
    }
  }
});

test('gate: with nothing stored, the screen is open unless the browser stores nothing or the last answer stopped it', () => {
  assert.equal(frontGate('none', true, null), 'open');
  // Storage refused: said before anything is made, and after an answer that found it out.
  assert.equal(frontGate('none', false, null), 'no-storage');
  assert.equal(frontGate('none', true, 'no-storage'), 'no-storage');
  assert.equal(frontGate('none', false, 'no-storage'), 'no-storage');
  // The bot check has loaded: reload.
  assert.equal(frontGate('none', true, 'reload'), 'reload');
  // The wallet said one arrived and shows none: the reader is told to reload, never left with a form that cannot work.
  assert.equal(frontGate('none', true, 'exists'), 'arrived');
  assert.equal(frontGate('none', false, 'exists'), 'arrived');
  // Storage refused comes before a reload: a fresh page would not help.
  assert.equal(frontGate('none', false, 'reload'), 'no-storage');
});

test('gate: every status has an answer', () => {
  const statuses: WalletStatus[] = ['none', 'ready', 'unreadable', 'newer', 'broken'];
  for (const status of statuses) assert.ok(typeof frontGate(status, true, null) === 'string', status);
});

// -- which wallet is here ---------------------------------------------------------

test('which wallet: a passkey wallet by the tag in its name; one made without a passkey says so', () => {
  assert.deepEqual(walletLine({ kind: 'passkey', tag: 'K7Q2' }), { key: 'herePasskeyTagged', tag: 'K7Q2' });
  // A record without a tag (the browser kept the passkey's name to itself): no made-up name.
  assert.deepEqual(walletLine({ kind: 'passkey' }), { key: 'herePasskey' });
  assert.deepEqual(walletLine({ kind: 'passkey', tag: '' }), { key: 'herePasskey' });
  assert.deepEqual(walletLine({ kind: 'words' }), { key: 'hereWords' });
  // The keys are the table's, in both languages, and the tagged line shows the tag.
  for (const lang of LANGS) {
    const t = strings.home[lang];
    assert.match(fill(t.herePasskeyTagged, { tag: 'K7Q2' }), /"K7Q2"/, lang);
    assert.match(t.herePasskey, /passkey/, lang);
    assert.match(t.hereWords, /12/, lang);
  }
});

// -- create: the passkey's panel ----------------------------------------------------

test('create: the passkey button waits until the browser has answered, and a waiting passkey comes first', () => {
  assert.equal(passkeyFace(null, null), 'checking');
  assert.equal(passkeyFace(true, null), 'offer');
  assert.equal(passkeyFace(false, null), 'not-offered');
  // A passkey that was saved exists, whatever the browser says about passkeys now.
  for (const offered of [null, true, false]) {
    assert.equal(passkeyFace(offered, { tag: 'K7Q2' }), 'finish', String(offered));
    assert.equal(passkeyFace(offered, { tag: null }), 'finish', String(offered));
  }
});

test('create: the sentence about the prompt names the passkey as the wallet will name it', () => {
  assert.equal(passkeyNameStart(strings.common.en.passkeyName), 'Practice wallet');
  for (const lang of LANGS) {
    const name = strings.common[lang].passkeyName;
    const start = passkeyNameStart(name);
    // The start of the name, then the tag: what the reader will see in the prompt.
    assert.ok(start.length > 3 && !start.includes('{'), `${lang}: ${start}`);
    assert.ok(fill(name, { tag: 'K7Q2' }).startsWith(`${start} K7Q2`), lang);
    // The sentence has a place for it, and reads whole once filled.
    const said = fill(strings.create[lang].passkeyAsk, { name: start });
    assert.ok(said.includes(`"${start}"`), `${lang}: ${said}`);
  }
  // A name without a tag comes back whole.
  assert.equal(passkeyNameStart('Practice wallet'), 'Practice wallet');
});

// -- create: every answer, after every tap ------------------------------------------

/** Every way createWithPasskey, finishSetup and createWithWords can end. */
const CREATE_RESULTS: CreateResult[] = [
  { kind: 'created' },
  { kind: 'unfinished' },
  { kind: 'exists' },
  { kind: 'no-storage' },
  { kind: 'cancelled', timedOut: false },
  { kind: 'cancelled', timedOut: true },
  { kind: 'no-prf', tag: 'K7Q2' },
  { kind: 'no-prf', tag: null },
  { kind: 'error', name: 'NotAllowedError' },
  { kind: 'busy' },
  { kind: 'reload' },
  { kind: 'broken' },
];

test('create: the list of answers is the whole type', () => {
  // A new kind of answer makes this fail to compile until it is listed and given a text.
  const kinds: Record<CreateResult['kind'], true> = {
    created: true,
    unfinished: true,
    exists: true,
    'no-storage': true,
    cancelled: true,
    'no-prf': true,
    error: true,
    busy: true,
    reload: true,
    broken: true,
  };
  assert.deepEqual([...new Set(CREATE_RESULTS.map((result) => result.kind))].sort(), Object.keys(kinds).sort());
});

test('create: a wallet that was made goes on to the "Wallet made" step, whichever tap made it', () => {
  for (const way of WAYS) assert.deepEqual(createView({ kind: 'created' }, way), { kind: 'made' }, way);
});

test('create: a saved passkey that has not answered turns the panel to "Finish setting up"', () => {
  assert.deepEqual(createView({ kind: 'unfinished' }, 'passkey'), { kind: 'unfinished', again: false });
  // After "Finish setting up" itself, the reader is told that it did not finish.
  assert.deepEqual(createView({ kind: 'unfinished' }, 'finish'), { kind: 'unfinished', again: true });
});

test('create: a wallet from another tab, a browser that stores nothing and the bot check stop the whole screen', () => {
  for (const way of WAYS) {
    // After a passkey prompt, a passkey may have been saved that now has no wallet: the screen says how to delete it.
    const orphan = way !== 'words';
    assert.deepEqual(createView({ kind: 'exists' }, way), { kind: 'stopped', why: 'exists', orphan }, way);
    assert.deepEqual(createView({ kind: 'no-storage' }, way), { kind: 'stopped', why: 'no-storage', orphan }, way);
    assert.deepEqual(createView({ kind: 'reload' }, way), { kind: 'stopped', why: 'reload', orphan: false }, way);
  }
});

test('create: a closed prompt left nothing behind when it made the passkey, and a passkey waiting when it finished one', () => {
  for (const timedOut of [false, true]) {
    const cancelled = { kind: 'cancelled', timedOut } as const;
    assert.deepEqual(createView(cancelled, 'passkey'), { kind: 'problem', failure: cancelled, advice: 'nothing-saved' });
    assert.deepEqual(createView(cancelled, 'finish'), { kind: 'problem', failure: cancelled, advice: 'still-waiting' });
  }
});

test('create: a passkey that can never make a wallet comes with how to delete it, by its tag when known', () => {
  for (const tag of ['K7Q2', null]) {
    const failure = { kind: 'no-prf', tag } as const;
    for (const way of ['passkey', 'finish'] as const) {
      assert.deepEqual(createView(failure, way), { kind: 'problem', failure, advice: 'delete-passkey' }, way);
    }
  }
  // The two sentences have the places the screen fills: the site, and the tag when there is one.
  for (const lang of LANGS) {
    const t = strings.create[lang];
    const tagged = fill(t.noPrfDeleteTagged, { host: 'practice.example', tag: 'K7Q2' });
    assert.ok(tagged.includes('practice.example') && tagged.includes('"K7Q2"'), lang);
    assert.ok(fill(t.noPrfDelete, { host: 'practice.example' }).includes('practice.example'), lang);
  }
});

test('create: the browser name of an error, a prompt still open and a failed self-test get the error table sentence alone', () => {
  const error = { kind: 'error', name: 'NotAllowedError' } as const;
  for (const way of ['passkey', 'finish'] as const) {
    assert.deepEqual(createView(error, way), { kind: 'problem', failure: error, advice: 'none' }, way);
  }
  for (const way of WAYS) {
    assert.deepEqual(createView({ kind: 'busy' }, way), { kind: 'problem', failure: { kind: 'busy' }, advice: 'none' }, way);
    assert.deepEqual(createView({ kind: 'broken' }, way), { kind: 'problem', failure: { kind: 'broken' }, advice: 'none' }, way);
  }
});

test('create: without a passkey there is no prompt, so an answer about one is a fault of ours and says so', () => {
  // "The browser could not finish the passkey step" would be untrue here: nothing was asked of a passkey.
  assert.deepEqual(createView({ kind: 'error', name: 'NoWords' }, 'words'), { kind: 'fault', name: 'NoWords' });
  assert.deepEqual(createView({ kind: 'unfinished' }, 'words'), { kind: 'fault', name: 'unfinished' });
  assert.deepEqual(createView({ kind: 'cancelled', timedOut: false }, 'words'), { kind: 'fault', name: 'cancelled' });
  assert.deepEqual(createView({ kind: 'no-prf', tag: null }, 'words'), { kind: 'fault', name: 'no-prf' });
  for (const lang of LANGS) {
    assert.match(strings.create[lang].wordsFailed, lang === 'en' ? /bug on our side/ : /error nuestro/, lang);
  }
});

test('create: every answer after every tap has a view, and no passkey sentence follows a tap that asked no passkey', () => {
  for (const way of WAYS) {
    for (const result of CREATE_RESULTS) {
      const view = createView(result, way);
      const where = `${result.kind} after ${way}`;
      assert.ok(['made', 'unfinished', 'stopped', 'problem', 'fault'].includes(view.kind), where);
      if (view.kind === 'problem') {
        // The error table has the sentence for it.
        for (const lang of LANGS) assert.ok(strings.errors[lang][`passkey_${view.failure.kind}`].length > 20, where);
        if (way === 'words') assert.ok(view.failure.kind === 'busy' || view.failure.kind === 'broken', where);
      }
      if (view.kind === 'unfinished') assert.notEqual(way, 'words', where);
    }
  }
});

// -- restore --------------------------------------------------------------------------

/** Every way restore() can end. */
const RESTORE_RESULTS: RestoreResult[] = [
  { kind: 'restored' },
  { kind: 'empty' },
  { kind: 'invalid' },
  { kind: 'exists' },
  { kind: 'no-storage' },
  { kind: 'failed', reason: 'unavailable' },
  { kind: 'reload' },
  { kind: 'broken' },
];

test('restore: every answer has its view', () => {
  const kinds: Record<RestoreResult['kind'], true> = {
    restored: true,
    empty: true,
    invalid: true,
    exists: true,
    'no-storage': true,
    failed: true,
    reload: true,
    broken: true,
  };
  assert.deepEqual(RESTORE_RESULTS.map((result) => result.kind).sort(), Object.keys(kinds).sort());

  assert.deepEqual(restoreView({ kind: 'restored' }), { kind: 'restored' });
  // No history: nothing is stored, and the reader chooses.
  assert.deepEqual(restoreView({ kind: 'empty' }), { kind: 'empty' });
  assert.deepEqual(restoreView({ kind: 'invalid' }), { kind: 'invalid' });
  assert.deepEqual(restoreView({ kind: 'broken' }), { kind: 'broken' });
  // The three that stop the whole screen, as on Create.
  for (const why of ['exists', 'no-storage', 'reload'] as const) {
    assert.deepEqual(restoreView({ kind: why }), { kind: 'stopped', why });
  }
});

test('restore: a failed look keeps its cause, and the error table has a sentence for every cause', () => {
  for (const reason of ['network', 'unavailable', 'limit', 'forbidden', 'bad_request'] as const) {
    assert.deepEqual(restoreView({ kind: 'failed', reason }), { kind: 'failed', reason });
    for (const lang of LANGS) assert.ok(strings.errors[lang][reason].length > 20, `${lang}.${reason}`);
  }
});

test('restore: "Keep them here anyway" goes to the wallet, and a refusal leaves the choice open', () => {
  const results: Record<KeepResult, ReturnType<typeof keepView>> = {
    restored: { kind: 'restored' },
    exists: { kind: 'stopped', why: 'exists' },
    // The browser would not store the words: they go on waiting, and the reader may choose again or erase them.
    'no-storage': { kind: 'refused' },
    // Nothing was waiting any more: back to the empty fields.
    'nothing-pending': { kind: 'lost' },
  };
  for (const [result, view] of Object.entries(results)) assert.deepEqual(keepView(result as KeepResult), view, result);
});

test('restore: the button works only with twelve good words and the box ticked', () => {
  assert.equal(restoreHeldBy(true, true), null);
  // The fields say what is wrong and take focus, so they come first.
  assert.equal(restoreHeldBy(false, true), 'words');
  assert.equal(restoreHeldBy(false, false), 'words');
  assert.equal(restoreHeldBy(true, false), 'box');
});

// -- the way in -----------------------------------------------------------------------

test('the way in leads to the "Wallet made" step until that step has been seen, and to the overview after', () => {
  // `created` is what the wallet publishes: set by a create, cleared when the reader has moved on from the step.
  assert.equal(wayIn('passkey'), 'backup');
  assert.equal(wayIn('words'), 'backup');
  assert.equal(wayIn(null), 'wallet');
});

// -- chapter 4 ------------------------------------------------------------------------

test('chapter 4 is linked in the language of the page, with no slash at the end', () => {
  const site = 'https://www.learnbitcoin.com';
  assert.equal(chapterFourUrl(site, 'en'), 'https://www.learnbitcoin.com/journey/be-your-own-bank');
  assert.equal(chapterFourUrl(site, 'es'), 'https://www.learnbitcoin.com/es/recorrido/se-tu-propio-banco');
  for (const lang of LANGS) assert.ok(!chapterFourUrl(site, lang).endsWith('/'), lang);
});
