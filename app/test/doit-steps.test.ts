// The six "Do it" steps as data (src/lib/doit/steps.ts): which chapter each
// belongs to, its parts in order, and what kind of proof each part takes.
// Held to the table of the phase's spec, to the contract's list of steps,
// and to the site's own content where the chapter paths come from.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGS, STEPS } from '@learnbitcoin/practice-contract';
import { validFrom } from '../src/lib/doit/progress.ts';
import {
  CHAPTERS,
  STEP_DEFS,
  allSteps,
  nextStep,
  partCount,
  partDef,
  partKey,
  sendPart,
  stepDef,
  stepsOf,
  type Fact,
  type PartKind,
} from '../src/lib/doit/steps.ts';

test('the six steps of the contract, each under its chapter', () => {
  assert.deepEqual(Object.keys(STEP_DEFS), [...STEPS], 'the same steps, in the same order');
  assert.deepEqual(allSteps().map((step) => step.id), [...STEPS]);
  for (const id of STEPS) {
    assert.equal(stepDef(id).id, id);
    assert.equal(stepDef(id), STEP_DEFS[id]);
    assert.equal(stepDef(id).title, `title_${id}`, 'the title is a key of the string table, never a text');
  }
  // The table of the spec: one step for chapter 2, three for chapter 3, two for chapter 4.
  assert.deepEqual(
    STEPS.map((id) => [id, STEP_DEFS[id].chapter.number]),
    [
      ['hold-some', 2],
      ['pass-it-on', 3],
      ['no-balances', 3],
      ['waiting-room', 3],
      ['the-seed', 4],
      ['prove-the-backup', 4],
    ],
  );
  assert.deepEqual(stepsOf(2), ['hold-some']);
  assert.deepEqual(stepsOf(3), ['pass-it-on', 'no-balances', 'waiting-room']);
  assert.deepEqual(stepsOf(4), ['the-seed', 'prove-the-backup']);
  assert.deepEqual(CHAPTERS.map((chapter) => chapter.number), [2, 3, 4]);
});

test('the three chapter pages, in both languages, as the main site has them', () => {
  assert.deepEqual(
    CHAPTERS.map((chapter) => chapter.path),
    [
      { en: '/journey/what-bitcoin-actually-is', es: '/es/recorrido/que-es-bitcoin-en-realidad' },
      { en: '/journey/how-bitcoin-works', es: '/es/recorrido/como-funciona-bitcoin' },
      { en: '/journey/be-your-own-bank', es: '/es/recorrido/se-tu-propio-banco' },
    ],
  );
  for (const chapter of CHAPTERS) {
    for (const lang of LANGS) {
      const path = chapter.path[lang];
      // A plain path of the main site: it passes the very rule a way back has to pass.
      assert.equal(validFrom(path), path, path);
      assert.equal(path.startsWith('/es/'), lang === 'es', path);
    }
  }
  // Every step of a chapter shares the chapter itself.
  for (const id of STEPS) assert.ok(CHAPTERS.includes(STEP_DEFS[id].chapter), id);
});

test('each part: its kind, and the one fact it rests on', () => {
  const table: Record<string, [PartKind, Fact][]> = {
    'hold-some': [
      ['state', 'wallet-here'],
      ['state', 'coins-seen'],
      ['state', 'coin-confirmed'],
      ['ask', 'block-height'],
    ],
    'pass-it-on': [
      ['state', 'spendable'],
      ['event', 'sent-to-pot'],
      ['state', 'payment-confirmed'],
    ],
    'no-balances': [
      ['event', 'coins-opened'],
      ['ask', 'coin-count'],
      ['event', 'payment-read'],
    ],
    'waiting-room': [
      ['event', 'sent'],
      ['state', 'payment-confirmed'],
      ['state', 'six-blocks'],
    ],
    'the-seed': [
      ['event', 'words-shown'],
      ['say-so', 'written'],
      ['ask', 'three-words'],
    ],
    'prove-the-backup': [
      ['ask', 'three-words'],
      ['event', 'wallet-removed'],
      ['state', 'restored-from-words'],
      ['state', 'coins-found'],
    ],
  };
  for (const id of STEPS) {
    assert.deepEqual(STEP_DEFS[id].parts.map((part) => [part.kind, part.on]), table[id], id);
    assert.equal(partCount(id), table[id]?.length, id);
    // Parts are numbered from 1.
    assert.equal(partDef(id, 0), undefined);
    assert.equal(partDef(id, 1), STEP_DEFS[id].parts[0]);
    assert.equal(partDef(id, partCount(id)), STEP_DEFS[id].parts.at(-1));
    assert.equal(partDef(id, partCount(id) + 1), undefined);
    assert.equal(partDef(id, 1.5), undefined);
    assert.equal(partKey(id, 2), `part_${id}_2`);
  }
  // No step is all states: each has something only the reader can do.
  for (const id of STEPS) assert.ok(STEP_DEFS[id].parts.some((part) => part.kind !== 'state'), id);
});

test('the next step is offered only inside the same chapter', () => {
  assert.equal(nextStep('hold-some'), null, 'chapter 3 has not been read yet');
  assert.equal(nextStep('pass-it-on'), 'no-balances');
  assert.equal(nextStep('no-balances'), 'waiting-room');
  assert.equal(nextStep('waiting-room'), null);
  assert.equal(nextStep('the-seed'), 'prove-the-backup');
  assert.equal(nextStep('prove-the-backup'), null);
});

test('two steps note a payment of the wallet\'s own, each in the part that sends it', () => {
  assert.equal(sendPart('pass-it-on'), 2);
  assert.equal(sendPart('waiting-room'), 1);
  for (const id of ['hold-some', 'no-balances', 'the-seed', 'prove-the-backup'] as const) assert.equal(sendPart(id), null, id);
  // And the part after it waits for that very payment.
  for (const id of ['pass-it-on', 'waiting-room'] as const) {
    assert.equal(partDef(id, (sendPart(id) ?? 0) + 1)?.on, 'payment-confirmed', id);
  }
});
