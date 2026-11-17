// The six "Do it" steps as data (src/lib/doit/steps.ts): which chapter each
// belongs to, its parts in order, and what kind of proof each part takes.
// Held to the table of the phase's spec, to the contract's list of steps,
// and to the site's own content where the chapter paths come from.
//
// And the table of chapters in the same file. A chapter's number and its
// title are written there and nowhere else, so no test here knows which
// they are: the tests hold their shape, and that a sentence can take them.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS, STEPS } from '@learnbitcoin/practice-contract';
import {
  CHAPTERS,
  STEP_DEFS,
  allSteps,
  chapterOf,
  chapterSlots,
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
  // The table of the spec: one step for the bitcoin chapter, three for the payment chapter, two for the keys
  // chapter. A chapter is known by its key, which is never shown and never changes.
  assert.deepEqual(
    STEPS.map((id) => [id, STEP_DEFS[id].chapter.key]),
    [
      ['hold-some', 'bitcoin'],
      ['pass-it-on', 'payment'],
      ['no-balances', 'payment'],
      ['waiting-room', 'payment'],
      ['the-seed', 'keys'],
      ['prove-the-backup', 'keys'],
    ],
  );
  assert.deepEqual(stepsOf('bitcoin'), ['hold-some']);
  assert.deepEqual(stepsOf('payment'), ['pass-it-on', 'no-balances', 'waiting-room']);
  assert.deepEqual(stepsOf('keys'), ['the-seed', 'prove-the-backup']);
  assert.deepEqual(CHAPTERS.map((chapter) => chapter.key), ['bitcoin', 'payment', 'keys']);
  for (const chapter of CHAPTERS) assert.equal(chapterOf(chapter.key), chapter, chapter.key);
  for (const id of STEPS) assert.ok(CHAPTERS.includes(STEP_DEFS[id].chapter), id);
});

/** Printable ASCII, and the same plus the letters and marks Spanish adds: the two alphabets of the string tables (test/strings.test.ts). */
const ALPHABET = { en: /^[\x20-\x7e]*$/, es: /^[\x20-\x7eáéíóúüñÁÉÍÓÚÜÑ¿¡]*$/ } as const;

test('the table of chapters: in each language the numbers rise and the titles are clean, and no test knows which they are', () => {
  for (const lang of LANGS) {
    let before = 0;
    const titles: string[] = [];
    for (const chapter of CHAPTERS) {
      const where = `${chapter.key}, ${lang}`;
      // The one way to read them: as the texts a sentence is given.
      const { number, title } = chapterSlots(lang, chapter);
      assert.ok(number !== undefined && title !== undefined, where);

      // A number as the main site prints it, and larger than the one before it: the table is in reading order.
      assert.match(number, /^[1-9][0-9]*$/, where);
      assert.ok(Number(number) > before, `${where}: ${number} does not come after ${before}`);
      before = Number(number);

      // A title that can stand in a sentence of a string table, and keeps that table's rules.
      assert.notEqual(title, '', where);
      assert.equal(title, title.trim(), where);
      assert.ok(!title.includes('  '), where);
      assert.ok(!/[{}!¡]/.test(title), where);
      assert.equal(title, title.normalize('NFC'), where);
      assert.match(title, ALPHABET[lang], where);
      assert.ok(!/^[0-9]/.test(title), where);
      titles.push(title);
    }
    assert.equal(new Set(titles).size, CHAPTERS.length, `${lang}: two chapters share a title`);
  }
});

test('a sentence takes a chapter\'s number and title from the table', () => {
  const pairs = CHAPTERS.flatMap((chapter) => [`${chapter.key}Number`, `${chapter.key}Title`]);
  for (const lang of LANGS) {
    // With no chapter in hand: one pair for every chapter, and nothing else.
    const bare = chapterSlots(lang);
    assert.deepEqual(Object.keys(bare).sort(), [...pairs].sort(), lang);
    for (const [name, value] of Object.entries(bare)) {
      assert.equal(typeof value, 'string', `${lang} ${name}`);
      assert.notEqual(value, '', `${lang} ${name}`);
    }
    // With a chapter handed in: the same, and that chapter's own pair under the two plain names.
    for (const chapter of CHAPTERS) {
      const own = chapterSlots(lang, chapter);
      assert.deepEqual(Object.keys(own).sort(), [...pairs, 'number', 'title'].sort(), `${lang} ${chapter.key}`);
      assert.equal(own.number, own[`${chapter.key}Number`], `${lang} ${chapter.key}`);
      assert.equal(own.title, own[`${chapter.key}Title`], `${lang} ${chapter.key}`);
      for (const name of pairs) assert.equal(own[name], bare[name], `${lang} ${chapter.key} ${name}`);
      for (const value of Object.values(own)) assert.equal(typeof value, 'string');
    }
    // A new object each time: what one screen does with it reaches no other.
    assert.notEqual(chapterSlots(lang), chapterSlots(lang));
  }
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
      // A plain path, as the main site writes its own addresses: no slash at its end. (For the steps of a
      // chapter these two paths are the only ways back there are: test/doit-progress.test.ts.)
      assert.match(path, /^(\/[a-z0-9]+(-[a-z0-9]+)*)+$/, path);
      assert.equal(path.startsWith('/es/'), lang === 'es', path);
    }
  }
  // Every step of a chapter shares the chapter itself.
  for (const id of STEPS) assert.ok(CHAPTERS.includes(STEP_DEFS[id].chapter), id);
});

test('each part: its kind, and the one fact it rests on', () => {
  const table: Record<string, [PartKind, Fact][]> = {
    // Three states of the wallet and nothing else: nothing is asked, and the step is done when the coin has its block.
    'hold-some': [
      ['state', 'wallet-here'],
      ['state', 'coins-seen'],
      ['state', 'coin-confirmed'],
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
  // One step is all states, the first: "Hold some" asks nothing and is done by what the wallet sees. Every
  // other step has something only the reader can do.
  for (const id of STEPS) assert.equal(STEP_DEFS[id].parts.every((part) => part.kind === 'state'), id === 'hold-some', id);
  // And no part of any step rests on a block's number that the reader reads somewhere and types back.
  const facts: string[] = STEPS.flatMap((id) => STEP_DEFS[id].parts.map((part) => part.on));
  assert.equal(facts.includes('block-height'), false);
  assert.equal(facts.length, 19);
});

test('the short table of facts in the file lists every fact of the type once, in the type\'s order, each in the same column', () => {
  const file = readFileSync(new URL('../src/lib/doit/steps.ts', import.meta.url), 'utf8');
  // The type, as the file writes it: one fact to a line.
  const start = file.indexOf('export type Fact =');
  assert.ok(start > 0);
  const type = file.slice(start, file.indexOf(';', start));
  const facts = [...type.matchAll(/^ {2}\| '([a-z-]+)'$/gm)].map((match) => match[1] ?? '');
  assert.equal(facts.length, 17, 'seventeen facts');
  assert.equal(new Set(facts).size, facts.length);
  // Every fact a part rests on is one of them.
  for (const id of STEPS) for (const part of STEP_DEFS[id].parts) assert.ok(facts.includes(part.on), `${id}: ${part.on}`);
  // The comment above the type: one row for each fact, in the same order, and no row for a fact that is gone.
  const comment = file.slice(file.indexOf(' * The one fact a part rests on.'), file.indexOf('export type Fact ='));
  const rows = [...comment.matchAll(/^ \*   ([a-z-]+)( +)(\S.*)$/gm)].map((match) => ({ fact: match[1] ?? '', gap: (match[2] ?? '').length, says: match[3] ?? '' }));
  assert.deepEqual(rows.map((row) => row.fact), facts);
  // One column: what a fact comes to starts at the same place in every row, so the table reads as one.
  const column = (row: { fact: string; gap: number }): number => row.fact.length + row.gap;
  const columns = new Set(rows.map(column));
  assert.deepEqual([...columns], [21], rows.filter((row) => column(row) !== 21).map((row) => row.fact).join(', '));
  for (const row of rows) assert.ok(row.says.length > 10, row.fact);
});

test('the next step is offered only inside the same chapter', () => {
  assert.equal(nextStep('hold-some'), null, 'the chapter that follows has not been read yet');
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
