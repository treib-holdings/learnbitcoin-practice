// The "Do it" note in the browser's storage (src/lib/doit/progress.ts):
// what is read of it and what is not, the one function that writes, what a
// change may and may not do to what is already written, forgetting, the step
// a reader came for when a need sent them to another step first, and the way
// back to the chapter.
//
// "Another tab" is a second caller on the same storage, or a write made
// behind this one's back, as in the tests of the wallet's key store.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGS, STEPS, type StepId } from '@learnbitcoin/practice-contract';
import {
  DONE_LONGEST,
  DONE_MOST,
  PROGRESS_KEY,
  STRIP_MS,
  applyChange,
  cameByCard,
  cameFromChapter,
  chapterLink,
  doneWith,
  emptyProgress,
  endingIds,
  forgetProgress,
  fromOfSearch,
  ledBackTo,
  paidStep,
  parseProgress,
  readProgress,
  restartStep,
  roadStart,
  stripStep,
  validFrom,
  watchedScreen,
  writeProgress,
  type Change,
  type Progress,
  type StepNote,
} from '../src/lib/doit/progress.ts';
import { stepState } from '../src/lib/doit/judge.ts';
import { readsCoins, readsTransactions } from '../src/lib/router.ts';
import { STEP_DEFS, partCount, sendPart } from '../src/lib/doit/steps.ts';
import { RECORD_KEY } from '../src/lib/keystore.ts';
import { FP, NOW, OTHER_FP, frozen, note, started, ticks, txid } from './doit-worlds.ts';
import { BlockedStorage, FullStorage, MemoryStorage } from './engine-fakes.ts';

const SITE = 'https://www.learnbitcoin.com';
const TX = txid('a1');

/** The text stored under the note's key, or null. */
const stored = (storage: MemoryStorage): string | null => storage.map.get(PROGRESS_KEY) ?? null;

/** Puts a note in storage the way another tab would: behind the caller's back. */
function put(storage: MemoryStorage, value: unknown): void {
  storage.map.set(PROGRESS_KEY, typeof value === 'string' ? value : JSON.stringify(value));
}

/** One write, which must go through. Returns the note after it. */
function write(storage: MemoryStorage, change: Change): Progress {
  const result = writeProgress(storage as Storage, change);
  assert.ok(result.ok, JSON.stringify(change));
  return result.progress;
}

const open = (step: StepId, at = NOW, from: string | null = null): Change => ({ kind: 'open', step, at, from });
/** The press of a need's link that leads to `step`, on the screen of `cameFor`. */
const detour = (step: StepId, cameFor: StepId): Change => ({ kind: 'detour', step, cameFor });
/** A note that holds one step and nothing else, or no step at all: what chapterLink() is handed for a step by itself. */
const alone = (id: StepId, step?: StepNote): Progress => ({ v: 1, following: null, steps: step === undefined ? {} : { [id]: step } });
const tick = (step: StepId, part: number, at = NOW, extra: Partial<Extract<Change, { kind: 'tick' }>> = {}): Change => ({ kind: 'tick', step, part, at, ...extra });

// -- reading --------------------------------------------------------------------------

test('the note has a key of its own, beside the wallet\'s', () => {
  assert.equal(PROGRESS_KEY, 'lbp_progress_v1');
  assert.notEqual(PROGRESS_KEY, RECORD_KEY);
  assert.deepEqual(emptyProgress(), { v: 1, following: null, steps: {} });
  assert.notEqual(emptyProgress(), emptyProgress(), 'a fresh one each time');
});

test('nothing stored is no progress', () => {
  assert.deepEqual(parseProgress(null), { state: 'none', progress: emptyProgress() });
  const storage = new MemoryStorage();
  assert.deepEqual(readProgress(storage as Storage), { state: 'none', progress: emptyProgress() });
  assert.equal(storage.writes, 0, 'reading never writes');
});

test('a whole note is read back field for field', () => {
  const whole: Progress = {
    v: 1,
    following: 'waiting-room',
    followedAt: NOW,
    steps: {
      'hold-some': { started: true, doneAt: NOW - 5, from: '/journey/what-bitcoin-actually-is', parts: ticks(1, 2, 3, 4) },
      // Sent here by a need of "There are no balances", which is not done: the step the reader came for.
      'pass-it-on': { started: true, cameFor: 'no-balances', tx: TX, sentAt: NOW - 3, parts: ticks(1, 2) },
      'no-balances': { started: true, from: '/journey/how-bitcoin-works' },
      'waiting-room': { started: true },
      'the-seed': { started: true, doneAt: NOW - 1, wallet: FP, parts: ticks(1, 2, 3) },
      'prove-the-backup': { started: true, wallet: FP, was: 'passkey', parts: ticks(1) },
    },
  };
  assert.deepEqual(parseProgress(JSON.stringify(whole)), { state: 'kept', progress: whole });
  // And with nothing in it.
  assert.deepEqual(parseProgress('{"v":1}'), { state: 'kept', progress: emptyProgress() });
  assert.deepEqual(parseProgress('{"v":1,"following":null,"steps":{}}'), { state: 'kept', progress: emptyProgress() });
});

test('only the six steps and the listed fields are taken, each as an own property', () => {
  const text = JSON.stringify({
    v: 1,
    following: 'hold-some',
    followedAt: NOW,
    words: 'abandon abandon about',
    answer: '150',
    steps: {
      'hold-some': { started: true, parts: { 1: true }, answer: '150', words: ['abandon'], mnemonic: 'x', key: 'tprv', address: 'bcrt1q' },
      'first-payment': { started: true },
      toString: { started: true },
    },
  });
  assert.deepEqual(parseProgress(text).progress, { v: 1, following: 'hold-some', followedAt: NOW, steps: { 'hold-some': { started: true, parts: { 1: true } } } });

  // "__proto__" as a key of the stored text is an own property of what JSON.parse makes, and no step.
  const proto = parseProgress('{"v":1,"steps":{"__proto__":{"started":true},"hold-some":{"__proto__":{"started":true}}}}');
  assert.deepEqual(proto, { state: 'kept', progress: emptyProgress() });
  // A field that is only inherited is not the note's.
  const inherited = Object.create({ started: true, doneAt: NOW }) as object;
  const text2 = JSON.stringify({ v: 1, steps: { 'hold-some': inherited } });
  assert.deepEqual(parseProgress(text2).progress, emptyProgress(), 'nothing of it survives being written, and nothing is read');
});

test('a field that fails its check is dropped alone', () => {
  const good: StepNote = { started: true, doneAt: NOW, from: '/journey/how-bitcoin-works', cameFor: 'no-balances', wallet: FP, was: 'words', tx: TX, sentAt: NOW - 9, parts: ticks(1, 2, 3) };
  const bad: Record<keyof StepNote, unknown[]> = {
    started: [false, 1, 'true', null, {}],
    doneAt: [-1, 1.5, '1800000000000', null, Number.MAX_SAFE_INTEGER, 8_640_000_000_000_001, {}],
    // Anything but the step's own chapter page: a plain path of the main site that is another page, another
    // step's chapter, the right page written another way, another host, something that is no text.
    from: [
      '/newsletter',
      '/',
      '/journey',
      '/journey/what-bitcoin-actually-is',
      '/es/recorrido/se-tu-propio-banco',
      '/journey/how-bitcoin-works/',
      '/Journey/How-Bitcoin-Works',
      'journey/how-bitcoin-works',
      '//evil.example/x',
      'https://evil.example',
      '/a b',
      `/${'a'.repeat(200)}`,
      7,
      null,
      '',
    ],
    // Anything but one of the five other steps: this step itself, a text that is no step, a step's title, what is no text.
    cameFor: ['pass-it-on', 'first-payment', 'Hold some', 'HOLD-SOME', 'hold-some ', '/do/hold-some', 'toString', '', 7, null, true, ['hold-some'], { step: 'hold-some' }],
    wallet: ['73C5DA0A', '73c5da0', '73c5da0a0', 'zzzzzzzz', 7, null, FP.split('')],
    was: ['Passkey', 'seed', true, null, 0],
    tx: [TX.toUpperCase(), TX.slice(1), `${TX}0`, 'g'.repeat(64), 7, null],
    sentAt: [-1, 0.5, '1', null, Number.POSITIVE_INFINITY],
    parts: [true, 'all', [true, true], null, 3],
  };
  for (const field of Object.keys(bad) as (keyof StepNote)[]) {
    for (const value of bad[field]) {
      const text = JSON.stringify({ v: 1, steps: { 'pass-it-on': { ...good, [field]: value } } });
      const { [field]: _dropped, ...rest } = good;
      assert.deepEqual(parseProgress(text), { state: 'kept', progress: { v: 1, following: null, steps: { 'pass-it-on': rest } } }, `${field}: ${JSON.stringify(value)}`);
    }
  }
  // Each of the five other steps is taken as the step the reader came for, while it is not done.
  for (const other of STEPS) {
    const read = parseProgress(JSON.stringify({ v: 1, steps: { 'pass-it-on': { ...good, cameFor: other } } })).progress.steps['pass-it-on'];
    assert.equal(read?.cameFor, other === 'pass-it-on' ? undefined : other, other);
  }
  // A step that is done is no step to lead back to: the field goes, alone, and the done step's own note stands.
  const led = { v: 1, steps: { 'pass-it-on': good, 'no-balances': { started: true, doneAt: NOW - 1, parts: ticks(1, 2, 3) } } };
  const { cameFor: _led, ...unled } = good;
  assert.deepEqual(parseProgress(JSON.stringify(led)).progress.steps, { 'pass-it-on': unled, 'no-balances': { started: true, doneAt: NOW - 1, parts: ticks(1, 2, 3) } });
  // A note that held nothing but that field is not there any more. One that names a step with no note, or a step under way, keeps it.
  assert.deepEqual(parseProgress(JSON.stringify({ v: 1, steps: { 'hold-some': { cameFor: 'no-balances' }, 'no-balances': { started: true, doneAt: NOW } } })).progress.steps, { 'no-balances': { started: true, doneAt: NOW } });
  assert.deepEqual(parseProgress(JSON.stringify({ v: 1, steps: { 'hold-some': { cameFor: 'no-balances' } } })).progress.steps, { 'hold-some': { cameFor: 'no-balances' } });
  assert.deepEqual(parseProgress(JSON.stringify({ v: 1, steps: { 'hold-some': { cameFor: 'no-balances' }, 'no-balances': { started: true } } })).progress.steps, { 'hold-some': { cameFor: 'no-balances' }, 'no-balances': { started: true } });
  // Ticks: only the numbers the step has parts for, and only `true`.
  const odd = { 0: true, 1: true, 2: 'yes', 3: 1, 4: true, 5: true, '-1': true, '1.5': true, x: true };
  const read = parseProgress(JSON.stringify({ v: 1, steps: { 'pass-it-on': { started: true, parts: odd }, 'hold-some': { parts: odd } } }));
  assert.deepEqual(read.progress.steps, { 'hold-some': { parts: { 1: true, 4: true } }, 'pass-it-on': { started: true, parts: { 1: true } } });
  // The step followed is one of the six or nobody. A time that is none goes by itself.
  for (const following of ['first-payment', 'toString', 7, true, {}, ['hold-some']]) {
    assert.equal(parseProgress(JSON.stringify({ v: 1, following, followedAt: NOW })).progress.following, null, String(following));
  }
  assert.deepEqual(parseProgress(JSON.stringify({ v: 1, following: 'the-seed', followedAt: 'now' })).progress, { v: 1, following: 'the-seed', steps: {} });
  // A step that is not an object, or is left with nothing, is not there.
  for (const step of [true, 'done', 7, null, [], {}, { started: false }]) {
    assert.deepEqual(parseProgress(JSON.stringify({ v: 1, steps: { 'the-seed': step } })).progress.steps, {}, JSON.stringify(step));
  }
  for (const steps of [null, 'x', 7, [{ started: true }]]) {
    assert.deepEqual(parseProgress(JSON.stringify({ v: 1, steps })).progress, emptyProgress(), JSON.stringify(steps));
  }
});

test('unreadable: not JSON, not an object, or with no whole number for its version. It counts as no progress', () => {
  const texts = [
    '',
    'not json',
    '{"v":1',
    'null',
    'true',
    '7',
    '"v1"',
    '[]',
    '[{"v":1}]',
    '{}',
    '{"steps":{}}',
    '{"v":"1"}',
    '{"v":1.5}',
    '{"v":null}',
    '{"v":true}',
    '{"v":[1]}',
    // Whole numbers that no version of this page ever wrote.
    '{"v":0}',
    '{"v":-1}',
    // Too large to be a whole number a program can count with.
    '{"v":1e400}',
    '{"v":9007199254740993}',
  ];
  for (const text of texts) {
    assert.deepEqual(parseProgress(text), { state: 'unreadable', progress: emptyProgress() }, text);
  }
});

test('newer: a whole number above 1 for its version, whatever else it holds', () => {
  for (const text of ['{"v":2}', '{"v":3,"steps":{"hold-some":{"started":true,"parts":{"1":true}}}}', '{"v":2,"following":"the-seed"}', '{"v":900719925474099}']) {
    assert.deepEqual(parseProgress(text), { state: 'newer', progress: emptyProgress() }, text);
  }
});

test('a storage that cannot be read at all is "blocked", and nothing throws', () => {
  assert.deepEqual(readProgress(new BlockedStorage() as Storage), { state: 'blocked', progress: emptyProgress() });
  // A storage that hands out something that is no text.
  const odd = new MemoryStorage();
  odd.getItem = () => 7 as unknown as string;
  assert.deepEqual(readProgress(odd as Storage), { state: 'none', progress: emptyProgress() });
});

// -- the one write ------------------------------------------------------------------------

test('nothing is written until a step is opened, and then one value under one key', () => {
  const storage = new MemoryStorage();
  // Reading, and changes that have nothing to change, write nothing.
  readProgress(storage as Storage);
  for (const change of [tick('hold-some', 1), { kind: 'stop', step: 'hold-some' }, { kind: 'follow', step: 'hold-some', at: NOW }, { kind: 'send-another', step: 'pass-it-on' }, detour('hold-some', 'pass-it-on')] as Change[]) {
    assert.deepEqual(writeProgress(storage as Storage, change), { ok: true, read: emptyProgress(), progress: emptyProgress(), changed: false });
  }
  assert.equal(restartStep(storage as Storage, 'hold-some', NOW).ok, true);
  assert.equal(storage.writes, 0);
  assert.deepEqual([...storage.map.keys()], []);

  // The step's screen opens.
  const result = writeProgress(storage as Storage, open('hold-some', NOW, '/journey/what-bitcoin-actually-is'));
  const after: Progress = { v: 1, following: 'hold-some', followedAt: NOW, steps: { 'hold-some': { started: true, from: '/journey/what-bitcoin-actually-is' } } };
  assert.deepEqual(result, { ok: true, read: emptyProgress(), progress: after, changed: true });
  assert.deepEqual([...storage.map.keys()], [PROGRESS_KEY]);
  assert.equal(storage.writes, 1);
  // What is stored is the note, as plain JSON in one fixed order, and it reads back as itself.
  assert.equal(stored(storage), '{"v":1,"following":"hold-some","followedAt":1800000000000,"steps":{"hold-some":{"started":true,"from":"/journey/what-bitcoin-actually-is"}}}');
  assert.deepEqual(readProgress(storage as Storage), { state: 'kept', progress: after });
  // The same opening again changes only the time it was followed.
  const again = writeProgress(storage as Storage, open('hold-some', NOW, '/journey/what-bitcoin-actually-is'));
  assert.deepEqual(again, { ok: true, read: after, progress: after, changed: false });
  assert.equal(storage.writes, 1);
});

test('two tabs on the same step: each write starts from what is stored, so neither loses the other\'s tick', () => {
  const storage = new MemoryStorage();
  // Both tabs have the step open, and each remembers the note as it was then.
  const first = write(storage, open('hold-some'));
  const second = readProgress(storage as Storage).progress;
  assert.deepEqual(first, second);

  // The first tab ticks part 1. The second, which has not heard, ticks part 1 too, and then part 2.
  write(storage, tick('hold-some', 1, NOW + 1));
  const same = writeProgress(storage as Storage, tick('hold-some', 1, NOW + 2));
  assert.deepEqual([same.ok, same.ok && same.changed], [true, false], 'already ticked: nothing to write');
  write(storage, tick('hold-some', 2, NOW + 3));
  // The first tab, whose memory still says "only part 1", ticks part 3.
  write(storage, tick('hold-some', 3, NOW + 4));
  assert.deepEqual(readProgress(storage as Storage).progress.steps['hold-some'], started(3));

  // A tick out of turn does not jump the queue, whoever sends it.
  const pass = write(storage, open('pass-it-on'));
  assert.deepEqual(pass.steps['pass-it-on'], { started: true });
  const early = writeProgress(storage as Storage, tick('pass-it-on', 2, NOW, { tx: TX, sentAt: NOW }));
  assert.deepEqual([early.ok, early.ok && early.changed], [true, false]);

  // One tab starts the step again while the other still shows it three parts in. The other
  // tab's next tick is for a note that is no longer there: it is not written on top.
  assert.equal(restartStep(storage as Storage, 'hold-some', NOW + 5).ok, true);
  const stale = writeProgress(storage as Storage, tick('hold-some', 4, NOW + 6));
  assert.deepEqual([stale.ok, stale.ok && stale.changed], [true, false]);
  assert.deepEqual(readProgress(storage as Storage).progress.steps['hold-some'], { started: true });

  // Both finish the step in the same moment: the moment it was done is written once.
  for (const part of [1, 2, 3]) write(storage, tick('hold-some', part, NOW + 7));
  const one = writeProgress(storage as Storage, tick('hold-some', 4, NOW + 8));
  const two = writeProgress(storage as Storage, tick('hold-some', 4, NOW + 9));
  assert.ok(one.ok && two.ok);
  assert.deepEqual([one.read.steps['hold-some']?.doneAt, one.progress.steps['hold-some']?.doneAt], [undefined, NOW + 8]);
  assert.deepEqual([two.read.steps['hold-some']?.doneAt, two.changed], [NOW + 8, false], 'the second write read a note that was already done');
});

test('two tabs on different steps: each keeps its own, and the last one opened is the one followed', () => {
  const storage = new MemoryStorage();
  write(storage, open('pass-it-on', NOW, '/journey/how-bitcoin-works'));
  write(storage, open('the-seed', NOW + 1, '/es/recorrido/se-tu-propio-banco'));
  write(storage, tick('pass-it-on', 1, NOW + 2));
  write(storage, tick('the-seed', 1, NOW + 3));
  write(storage, tick('pass-it-on', 2, NOW + 4, { tx: TX, sentAt: NOW + 4 }));
  write(storage, tick('the-seed', 2, NOW + 5));
  assert.deepEqual(readProgress(storage as Storage).progress, {
    v: 1,
    following: 'the-seed',
    // A part of the followed step was ticked: it was followed just then. The other step's ticks do not move it.
    followedAt: NOW + 5,
    steps: {
      'pass-it-on': { started: true, from: '/journey/how-bitcoin-works', tx: TX, sentAt: NOW + 4, parts: ticks(1, 2) },
      'the-seed': { started: true, from: '/es/recorrido/se-tu-propio-banco', parts: ticks(1, 2) },
    },
  });
  // The steps are written in the contract's order, whatever order they were opened in.
  assert.deepEqual(Object.keys(JSON.parse(stored(storage) ?? '{}').steps as object), ['pass-it-on', 'the-seed']);
});

test('what is stored but cannot be read is replaced by the next write that has something to write', () => {
  for (const junk of ['not json', '[]', '{"v":"one"}', '{"v":0,"steps":{"hold-some":{"started":true}}}']) {
    const storage = new MemoryStorage();
    put(storage, junk);
    assert.equal(readProgress(storage as Storage).state, 'unreadable');
    // A change with nothing to change leaves it be.
    const idle = writeProgress(storage as Storage, tick('hold-some', 1));
    assert.deepEqual([idle.ok, idle.ok && idle.changed, stored(storage)], [true, false, junk]);
    // The first real one puts a note in its place, with nothing of what was there.
    assert.deepEqual(write(storage, open('hold-some')), { v: 1, following: 'hold-some', followedAt: NOW, steps: { 'hold-some': { started: true } } });
    assert.equal(readProgress(storage as Storage).state, 'kept');
  }
});

test('a newer version\'s note: nothing is written, nothing is deleted', () => {
  const storage = new MemoryStorage();
  const newer = '{"v":2,"following":"hold-some","steps":{"hold-some":{"began":1800000000000,"ticks":[1,2]}}}';
  put(storage, newer);
  const changes: Change[] = [
    open('hold-some'),
    tick('hold-some', 1),
    { kind: 'follow', step: 'hold-some', at: NOW },
    { kind: 'stop', step: 'hold-some' },
    { kind: 'payment', step: 'pass-it-on', tx: TX, sentAt: NOW },
    { kind: 'send-another', step: 'pass-it-on' },
    { kind: 'checked', step: 'the-seed', wallet: FP },
    { kind: 'restart', step: 'hold-some', at: NOW },
    detour('hold-some', 'pass-it-on'),
  ];
  for (const change of changes) assert.deepEqual(writeProgress(storage as Storage, change), { ok: false, why: 'newer' }, change.kind);
  assert.deepEqual(restartStep(storage as Storage, 'hold-some', NOW), { ok: false, why: 'newer' });
  assert.equal(forgetProgress(storage as Storage), false);
  assert.equal(stored(storage), newer, 'exactly as it was');
  assert.equal(storage.writes, 0);
});

test('a browser that refuses the write: "storage", and nothing half written', () => {
  // Reads work, writes throw: a private window of some browsers, or a full disk.
  const full = new FullStorage();
  assert.deepEqual(writeProgress(full as Storage, open('hold-some')), { ok: false, why: 'storage' });
  assert.equal(stored(full), null);
  // It had a note from better days: the note stands, and the new tick is not in it.
  full.full = false;
  write(full, open('hold-some'));
  full.full = true;
  const before = stored(full);
  assert.deepEqual(writeProgress(full as Storage, tick('hold-some', 1)), { ok: false, why: 'storage' });
  assert.equal(stored(full), before);
  assert.equal(forgetProgress(full as Storage), false, 'and it cannot be forgotten either');
  assert.equal(stored(full), before);

  // Every call throws: the browser has switched storage off for this page.
  const blocked = new BlockedStorage();
  assert.deepEqual(writeProgress(blocked as Storage, open('hold-some')), { ok: false, why: 'storage' });
  assert.equal(forgetProgress(blocked as Storage), false);

  // A storage that takes the write and keeps nothing has not kept it.
  const forgetful = new MemoryStorage();
  forgetful.setItem = () => {};
  assert.deepEqual(writeProgress(forgetful as Storage, open('hold-some')), { ok: false, why: 'storage' });
  // One that keeps something else than it was handed has not kept it either.
  const garbling = new MemoryStorage();
  garbling.setItem = (key: string, value: string) => void garbling.map.set(key, value.slice(0, 20));
  assert.deepEqual(writeProgress(garbling as Storage, open('hold-some')), { ok: false, why: 'storage' });
});

// -- forgetting, and starting a step again ----------------------------------------------------

test('"Forget my progress" deletes exactly the note', () => {
  const storage = new MemoryStorage();
  storage.map.set(RECORD_KEY, '{"the":"wallet"}');
  storage.map.set('someone-elses-key', 'kept');
  // Nothing to forget is forgotten.
  assert.equal(forgetProgress(storage as Storage), true);
  assert.equal(storage.writes, 0);
  write(storage, open('the-seed'));
  write(storage, tick('the-seed', 1));
  assert.equal(forgetProgress(storage as Storage), true);
  assert.deepEqual([...storage.map.keys()].sort(), [RECORD_KEY, 'someone-elses-key'].sort());
  assert.equal(storage.map.get(RECORD_KEY), '{"the":"wallet"}');
  assert.deepEqual(readProgress(storage as Storage), { state: 'none', progress: emptyProgress() });
  // Something under the key that is no note goes too: it is this page's own key.
  put(storage, 'not json');
  assert.equal(forgetProgress(storage as Storage), true);
  assert.equal(stored(storage), null);
  // After it, a step starts from nothing, and the count of "done" can start again.
  assert.deepEqual(write(storage, open('the-seed', NOW + 1)).steps, { 'the-seed': { started: true } });
});

test('"Start this step again" clears one step, and only a step that is started and not done', () => {
  const storage = new MemoryStorage();
  write(storage, open('waiting-room', NOW, '/journey/how-bitcoin-works'));
  write(storage, tick('waiting-room', 1, NOW + 1, { tx: TX, sentAt: NOW + 1 }));
  write(storage, tick('waiting-room', 2, NOW + 2));
  write(storage, open('the-seed', NOW + 3));
  write(storage, tick('the-seed', 1, NOW + 4));
  const other = readProgress(storage as Storage).progress.steps['the-seed'];

  const result = restartStep(storage as Storage, 'waiting-room', NOW + 9);
  assert.ok(result.ok && result.changed);
  // Its ticks and the payment it noted are gone. The reader is on its screen, so it is started and
  // followed again at once, with the way back it had.
  assert.deepEqual(result.progress, {
    v: 1,
    following: 'waiting-room',
    followedAt: NOW + 9,
    steps: { 'waiting-room': { started: true, from: '/journey/how-bitcoin-works' }, 'the-seed': other },
  });

  // A step that was never opened has nothing to start again.
  const never = restartStep(storage as Storage, 'hold-some', NOW);
  assert.deepEqual([never.ok, never.ok && never.changed], [true, false]);
  // A done step stays done.
  for (const part of [2, 3]) write(storage, tick('the-seed', part, NOW + 10, part === 3 ? { wallet: FP } : {}));
  const done = readProgress(storage as Storage).progress.steps['the-seed'];
  assert.equal(done?.doneAt, NOW + 10);
  const kept = restartStep(storage as Storage, 'the-seed', NOW + 11);
  assert.deepEqual([kept.ok, kept.ok && kept.changed], [true, false]);
  assert.deepEqual(readProgress(storage as Storage).progress.steps['the-seed'], done);

  // A step that a need sent the reader to keeps the step it leads back to, as a step keeps its way back:
  // started again, it is still on the road the reader came by.
  const sent = new MemoryStorage();
  write(sent, open('pass-it-on', NOW, '/journey/how-bitcoin-works'));
  write(sent, detour('hold-some', 'pass-it-on'));
  write(sent, open('hold-some', NOW + 1));
  write(sent, tick('hold-some', 1, NOW + 2));
  const again = restartStep(sent as Storage, 'hold-some', NOW + 3);
  assert.ok(again.ok && again.changed);
  assert.deepEqual(again.progress.steps['hold-some'], { started: true, cameFor: 'pass-it-on' });
  // With a way back of its own beside it: both stay.
  write(sent, open('hold-some', NOW + 4, '/journey/what-bitcoin-actually-is'));
  write(sent, detour('hold-some', 'pass-it-on'));
  const both = restartStep(sent as Storage, 'hold-some', NOW + 5);
  assert.ok(both.ok);
  assert.deepEqual(both.progress.steps['hold-some'], { started: true, from: '/journey/what-bitcoin-actually-is', cameFor: 'pass-it-on' });
  // And the step the reader came for, started again, is still the one the other step leads back to.
  const sender = restartStep(sent as Storage, 'pass-it-on', NOW + 6);
  assert.ok(sender.ok && sender.changed);
  assert.deepEqual(sender.progress.steps, {
    'hold-some': { started: true, from: '/journey/what-bitcoin-actually-is', cameFor: 'pass-it-on' },
    'pass-it-on': { started: true, from: '/journey/how-bitcoin-works' },
  });
});

// -- what a change may do ------------------------------------------------------------------------

test('opening: started once, followed unless done, and the way back is the latest valid one', () => {
  let progress = applyChange(emptyProgress(), open('no-balances', NOW, '/journey/how-bitcoin-works'));
  assert.deepEqual(progress, { v: 1, following: 'no-balances', followedAt: NOW, steps: { 'no-balances': { started: true, from: '/journey/how-bitcoin-works' } } });
  // Opened again with no way back, or with one that is none: the earlier one stays. Another step's chapter is
  // none, and neither is any other page of the main site.
  for (const from of [null, '//evil.example', 'https://evil.example/journey', '/Journey/X', '/journey/be-your-own-bank', '/es/recorrido/que-es-bitcoin-en-realidad', '/newsletter', '/journey/how-bitcoin-works/']) {
    progress = applyChange(progress, open('no-balances', NOW + 1, from));
    assert.equal(progress.steps['no-balances']?.from, '/journey/how-bitcoin-works', String(from));
  }
  // With the other valid one, the chapter's Spanish page: that one.
  progress = applyChange(progress, open('no-balances', NOW + 2, '/es/recorrido/como-funciona-bitcoin'));
  assert.equal(progress.steps['no-balances']?.from, '/es/recorrido/como-funciona-bitcoin');
  assert.equal(progress.followedAt, NOW + 2);
  // A first opening with a way back that is none keeps none: the note of the step holds nothing of what the address said.
  for (const from of ['/newsletter', '/journey/be-your-own-bank', '/', `/${'reader-4f1c9a7e/'.repeat(10)}campaign-77`]) {
    assert.deepEqual(applyChange(emptyProgress(), open('no-balances', NOW, from)).steps, { 'no-balances': { started: true } }, from);
  }

  // Another step's screen: that one is followed now, and the first keeps what it had.
  progress = applyChange(progress, open('the-seed', NOW + 3));
  assert.deepEqual([progress.following, progress.followedAt], ['the-seed', NOW + 3]);
  assert.deepEqual(progress.steps['no-balances'], { started: true, from: '/es/recorrido/como-funciona-bitcoin' });

  // A done step is not followed again by being opened. If it was still the one followed (the
  // strip had said it was done), opening it lets it go; another step that is followed stays.
  const done = note({ 'hold-some': started(4, { doneAt: NOW }), 'the-seed': started(1) }, 'hold-some');
  assert.deepEqual(applyChange(done, open('hold-some', NOW + 1)), { v: 1, following: null, steps: done.steps });
  const elsewhere = note({ 'hold-some': started(4, { doneAt: NOW }), 'the-seed': started(1) }, 'the-seed');
  assert.deepEqual(applyChange(elsewhere, open('hold-some', NOW + 1)), elsewhere);
  // And it can still take a new way back.
  assert.equal(applyChange(done, open('hold-some', NOW + 1, '/journey/what-bitcoin-actually-is')).steps['hold-some']?.from, '/journey/what-bitcoin-actually-is');

  // The step a reader came for. An opening with a way back that counts is an arrival by the step's own card:
  // that is the later road, and what the earlier one noted is deleted. An opening without one leaves it, and
  // so does one whose way back is none.
  const sent = note({ 'pass-it-on': started(0, { from: '/journey/how-bitcoin-works' }), 'hold-some': { cameFor: 'pass-it-on' } }, 'pass-it-on');
  for (const from of [null, '/journey/how-bitcoin-works', '/newsletter', '//evil.example', '/journey/what-bitcoin-actually-is/']) {
    assert.deepEqual(applyChange(sent, open('hold-some', NOW + 1, from)).steps['hold-some'], { started: true, cameFor: 'pass-it-on' }, String(from));
  }
  for (const from of ['/journey/what-bitcoin-actually-is', '/es/recorrido/que-es-bitcoin-en-realidad']) {
    assert.deepEqual(applyChange(sent, open('hold-some', NOW + 1, from)).steps['hold-some'], { started: true, from }, from);
  }
  // Only this step's own: the opening of another step, with a way back or without, touches nothing of it.
  assert.deepEqual(applyChange(sent, open('pass-it-on', NOW + 1, '/es/recorrido/como-funciona-bitcoin')).steps['hold-some'], { cameFor: 'pass-it-on' });
  assert.deepEqual(applyChange(sent, open('the-seed', NOW + 1, '/journey/be-your-own-bank')).steps['hold-some'], { cameFor: 'pass-it-on' });
});

test('following and stopping', () => {
  const two = note({ 'pass-it-on': started(1), 'the-seed': started(0), 'hold-some': started(4, { doneAt: NOW }) }, 'the-seed');
  // The tab of a step comes back into view, or its action link is used.
  assert.deepEqual(applyChange(two, { kind: 'follow', step: 'pass-it-on', at: NOW + 5 }), { ...two, following: 'pass-it-on', followedAt: NOW + 5 });
  // Not a done step, and not one that was never opened.
  assert.deepEqual(applyChange(two, { kind: 'follow', step: 'hold-some', at: NOW + 5 }), two);
  assert.deepEqual(applyChange(two, { kind: 'follow', step: 'waiting-room', at: NOW + 5 }), two);
  // "Stop following" names the step it was pressed for: if another one is followed by now, nothing changes.
  assert.deepEqual(applyChange(two, { kind: 'stop', step: 'the-seed' }), { v: 1, following: null, steps: two.steps });
  assert.deepEqual(applyChange(two, { kind: 'stop', step: 'pass-it-on' }), two);
  assert.deepEqual(applyChange(emptyProgress(), { kind: 'stop', step: 'the-seed' }), emptyProgress());
  // Nothing it touches is a tick or a start.
  assert.deepEqual(applyChange(two, { kind: 'stop', step: 'the-seed' }).steps, two.steps);
});

test('ticks: in order, only for a step that is started and not done, and each with what its part notes', () => {
  const base = note({ 'pass-it-on': started(0) }, 'pass-it-on');
  // Out of turn, out of range, or for a step that is not under way: nothing.
  for (const part of [2, 3, 0, -1, 4, 1.5, Number.NaN]) assert.deepEqual(applyChange(base, tick('pass-it-on', part)), base, String(part));
  assert.deepEqual(applyChange(base, tick('waiting-room', 1)), base, 'never opened');
  assert.deepEqual(applyChange(emptyProgress(), tick('pass-it-on', 1)), emptyProgress());
  // A time that is none is no change at all: a tick could otherwise finish a step at no moment.
  for (const at of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) assert.deepEqual(applyChange(base, tick('pass-it-on', 1, at)), base, String(at));

  // Part 1, then part 2 with the payment it notes.
  let progress = applyChange(base, tick('pass-it-on', 1, NOW + 1));
  assert.deepEqual(progress, { ...base, followedAt: NOW + 1, steps: { 'pass-it-on': started(1) } });
  progress = applyChange(progress, tick('pass-it-on', 2, NOW + 2, { tx: TX, sentAt: NOW + 2 }));
  assert.deepEqual(progress.steps['pass-it-on'], started(2, { tx: TX, sentAt: NOW + 2 }));
  // The same tick again, with another payment: the tick is there, and the first payment stands.
  assert.deepEqual(applyChange(progress, tick('pass-it-on', 2, NOW + 3, { tx: txid('b2'), sentAt: NOW + 3 })), progress);
  // A payment is an ID and a moment, both or neither: half of one is not noted.
  const half = applyChange(applyChange(base, tick('pass-it-on', 1)), tick('pass-it-on', 2, NOW, { tx: TX }));
  assert.deepEqual(half.steps['pass-it-on'], started(2));
  const noId = applyChange(applyChange(base, tick('pass-it-on', 1)), tick('pass-it-on', 2, NOW, { tx: 'not-an-id', sentAt: NOW }));
  assert.deepEqual(noId.steps['pass-it-on'], started(2));

  // The wallet, and how this browser kept it.
  const drill = applyChange(note({ 'prove-the-backup': started(0) }), tick('prove-the-backup', 1, NOW, { wallet: FP, was: 'passkey' }));
  assert.deepEqual(drill.steps['prove-the-backup'], started(1, { wallet: FP, was: 'passkey' }));
  assert.equal(drill.followedAt, undefined, 'a step that is not the one followed does not move that time');
  // What is no fingerprint or no kind is not written.
  const odd = applyChange(note({ 'prove-the-backup': started(0) }), tick('prove-the-backup', 1, NOW, { wallet: 'abandon', was: 'seed' as 'words' }));
  assert.deepEqual(odd.steps['prove-the-backup'], started(1));
});

test('done: the moment of the last tick, written once, and what the step needed on its way is deleted', () => {
  // pass-it-on: the payment and its moment go.
  let progress = note({ 'pass-it-on': started(2, { tx: TX, sentAt: NOW - 30_000, from: '/journey/how-bitcoin-works' }) }, 'pass-it-on');
  progress = applyChange(progress, tick('pass-it-on', 3, NOW));
  assert.deepEqual(progress.steps['pass-it-on'], { started: true, doneAt: NOW, from: '/journey/how-bitcoin-works', parts: ticks(1, 2, 3) });
  // It stays the followed one until the reader has seen it (the glue's business), and stays done.
  assert.deepEqual([progress.following, progress.followedAt], ['pass-it-on', NOW]);
  for (const change of [tick('pass-it-on', 3, NOW + 5), tick('pass-it-on', 1, NOW + 5), { kind: 'send-another', step: 'pass-it-on' }, { kind: 'payment', step: 'pass-it-on', tx: TX, sentAt: NOW }, { kind: 'restart', step: 'pass-it-on', at: NOW + 5 }] as Change[]) {
    assert.deepEqual(applyChange(progress, change), progress, change.kind);
  }

  // the-seed keeps the wallet fingerprint its words were checked for.
  const seed = applyChange(note({ 'the-seed': started(2) }), tick('the-seed', 3, NOW, { wallet: FP }));
  assert.deepEqual(seed.steps['the-seed'], { started: true, doneAt: NOW, wallet: FP, parts: ticks(1, 2, 3) });
  // prove-the-backup lets go of the wallet it named, and keeps how that wallet was kept.
  const drill = applyChange(note({ 'prove-the-backup': started(3, { wallet: FP, was: 'passkey' }) }), tick('prove-the-backup', 4, NOW));
  assert.deepEqual(drill.steps['prove-the-backup'], { started: true, doneAt: NOW, was: 'passkey', parts: ticks(1, 2, 3, 4) });

  // Every step: ticked from the first part to the last, it is done at the last tick and not before.
  for (const id of STEPS) {
    let step = applyChange(emptyProgress(), open(id));
    for (let part = 1; part <= partCount(id); part++) {
      assert.equal(step.steps[id]?.doneAt, undefined, `${id} before part ${part}`);
      step = applyChange(step, tick(id, part, NOW + part));
    }
    assert.equal(step.steps[id]?.doneAt, NOW + partCount(id), id);
    assert.deepEqual(step.steps[id]?.parts, ticks(...STEP_DEFS[id].parts.map((_, at) => at + 1)), id);
  }

  // A note that has every tick and no moment (edited by hand): the last tick, again, marks it done.
  const edited = note({ 'the-seed': started(3) });
  assert.equal(applyChange(edited, tick('the-seed', 3, NOW + 1)).steps['the-seed']?.doneAt, NOW + 1);
});

test('what is written once is never cleared by a later change: started, each tick, the moment a step was done', () => {
  // Every kind of change but the two that are there to clear, thrown at a note in a fixed shuffled order.
  const steps: StepId[] = [...STEPS];
  const changes: Change[] = [];
  for (const step of steps) {
    changes.push(open(step, NOW, null), open(step, NOW, STEP_DEFS[step].chapter.path.es), open(step, NOW, '/journey/x'), { kind: 'follow', step, at: NOW }, { kind: 'stop', step });
    changes.push({ kind: 'payment', step, tx: TX, sentAt: NOW }, { kind: 'send-another', step }, { kind: 'checked', step, wallet: OTHER_FP });
    for (const cameFor of steps) changes.push(detour(step, cameFor));
    for (let part = 0; part <= 5; part++) changes.push(tick(step, part, NOW, { tx: TX, sentAt: NOW, wallet: FP, was: 'words' }));
  }
  // A small generator with a fixed start (mulberry32), so that the walk is the same walk every time.
  let seed = 7;
  const next = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (mixed ^ (mixed >>> 14)) >>> 0;
  };
  let progress = emptyProgress();
  for (let round = 0; round < 4000; round++) {
    const change = changes[next() % changes.length];
    assert.ok(change);
    const after = applyChange(progress, { ...change, ...('at' in change ? { at: NOW + round } : {}) } as Change);
    for (const id of STEPS) {
      const was = progress.steps[id];
      const is = after.steps[id];
      if (was?.started === true) assert.equal(is?.started, true, `${id}: started was cleared by ${change.kind}`);
      if (was?.doneAt !== undefined) assert.equal(is?.doneAt, was.doneAt, `${id}: the moment it was done changed with ${change.kind}`);
      for (const part of Object.keys(was?.parts ?? {})) assert.equal(is?.parts?.[Number(part)], true, `${id}: tick ${part} was cleared by ${change.kind}`);
      // And a done step has every tick, and no payment left in it.
      if (is?.doneAt !== undefined) {
        assert.deepEqual(is.parts, ticks(...STEP_DEFS[id].parts.map((_, at) => at + 1)), id);
        assert.deepEqual([is.tx, is.sentAt], [undefined, undefined], id);
      }
      // Ticks are always the first so many parts: none was ever written out of turn.
      const ticked = Object.keys(is?.parts ?? {}).map(Number).sort((a, b) => a - b);
      assert.deepEqual(ticked, ticked.map((_, at) => at + 1), `${id}: ${ticked.join(',')}`);
      // The way back is the step's own chapter page or it is not there: no change ever wrote another path.
      assert.ok(is?.from === undefined || is.from === STEP_DEFS[id].chapter.path.es, `${id}: the way back is ${String(is?.from)} after ${change.kind}`);
      // The step the reader came for is another of the six that is not done, or it is not there: no change ever
      // wrote this step itself, and none left a done step named.
      if (is?.cameFor !== undefined) {
        assert.ok(STEPS.includes(is.cameFor) && is.cameFor !== id, `${id}: came for ${is.cameFor} after ${change.kind}`);
        assert.equal(after.steps[is.cameFor]?.doneAt, undefined, `${id}: came for ${is.cameFor}, which is done, after ${change.kind}`);
      }
    }
    progress = after;
  }
  // The walk got somewhere: every step was started, and most were done.
  assert.equal(Object.keys(progress.steps).length, 6);
  assert.ok(STEPS.filter((id) => progress.steps[id]?.doneAt !== undefined).length >= 4);
});

test('"Send another" clears the noted payment and no tick, and the next payment takes its place', () => {
  const waiting = note({ 'waiting-room': started(2, { tx: TX, sentAt: NOW - 200_000 }) }, 'waiting-room');
  const cleared = applyChange(waiting, { kind: 'send-another', step: 'waiting-room' });
  assert.deepEqual(cleared.steps['waiting-room'], started(2));
  // Nothing to clear, or a step that waits for no payment: nothing.
  assert.deepEqual(applyChange(cleared, { kind: 'send-another', step: 'waiting-room' }), cleared);
  assert.deepEqual(applyChange(note({ 'the-seed': started(1) }), { kind: 'send-another', step: 'the-seed' }), note({ 'the-seed': started(1) }));

  // A new payment is noted only where the send part is ticked and no payment is.
  const again = applyChange(cleared, { kind: 'payment', step: 'waiting-room', tx: txid('b2'), sentAt: NOW });
  assert.deepEqual(again.steps['waiting-room'], started(2, { tx: txid('b2'), sentAt: NOW }));
  assert.deepEqual(applyChange(again, { kind: 'payment', step: 'waiting-room', tx: txid('c3'), sentAt: NOW + 1 }), again, 'the one that is noted stands');
  const unsent = note({ 'pass-it-on': started(1) });
  assert.deepEqual(applyChange(unsent, { kind: 'payment', step: 'pass-it-on', tx: TX, sentAt: NOW }), unsent, 'the send part is not ticked yet');
  assert.deepEqual(applyChange(note({ 'the-seed': started(1) }), { kind: 'payment', step: 'the-seed', tx: TX, sentAt: NOW }), note({ 'the-seed': started(1) }));
  for (const bad of [{ tx: 'x', sentAt: NOW }, { tx: TX, sentAt: -1 }]) {
    assert.deepEqual(applyChange(cleared, { kind: 'payment', step: 'waiting-room', ...bad }), cleared, JSON.stringify(bad));
  }
});

test('the-seed, checked again for another wallet: the fingerprint is the new one, and only there', () => {
  const done = note({ 'the-seed': started(3, { doneAt: NOW, wallet: FP }), 'prove-the-backup': started(1, { wallet: FP, was: 'words' }) });
  const again = applyChange(done, { kind: 'checked', step: 'the-seed', wallet: OTHER_FP });
  assert.equal(again.steps['the-seed']?.wallet, OTHER_FP);
  assert.deepEqual(again.steps['prove-the-backup'], done.steps['prove-the-backup']);
  assert.equal(again.steps['the-seed']?.doneAt, NOW);
  // Not before its words were checked at all, not for another step, and not with something that is no fingerprint.
  assert.deepEqual(applyChange(note({ 'the-seed': started(2) }), { kind: 'checked', step: 'the-seed', wallet: FP }), note({ 'the-seed': started(2) }));
  assert.deepEqual(applyChange(done, { kind: 'checked', step: 'prove-the-backup', wallet: OTHER_FP }), done);
  assert.equal(applyChange(done, { kind: 'checked', step: 'the-seed', wallet: 'abandon about' }).steps['the-seed']?.wallet, undefined);
});

test('a change never alters the note it is handed, and what it gives back holds only what a note may hold', () => {
  const before = frozen(note({ 'pass-it-on': started(1, { from: '/journey/how-bitcoin-works' }), 'the-seed': started(2) }, 'pass-it-on'));
  const changes: Change[] = [
    open('hold-some'),
    tick('pass-it-on', 2, NOW, { tx: TX, sentAt: NOW }),
    tick('the-seed', 3, NOW, { wallet: FP }),
    { kind: 'restart', step: 'pass-it-on', at: NOW },
    { kind: 'stop', step: 'pass-it-on' },
    detour('hold-some', 'pass-it-on'),
    detour('the-seed', 'pass-it-on'),
  ];
  for (const change of changes) {
    const after = applyChange(before, frozen(change));
    assert.notEqual(after, before);
    // What it gives back reads back as itself: nothing in it that a read would drop.
    assert.deepEqual(parseProgress(JSON.stringify(after)), { state: 'kept', progress: after }, change.kind);
  }
  // A change for something that is no step changes nothing. So does one whose extra fields are not the note's.
  const stray = { kind: 'open', step: 'first-payment', at: NOW, from: null } as unknown as Change;
  assert.deepEqual(applyChange(before, stray), before);
  const loud = { ...tick('pass-it-on', 2, NOW), words: 'abandon about', answer: '3', waited: { height: 1 } } as unknown as Change;
  const written = JSON.stringify(applyChange(before, loud));
  assert.doesNotMatch(written, /abandon|answer|waited|words/);
});

test('whatever is written, the stored text holds the listed fields and nothing else', () => {
  const storage = new MemoryStorage();
  for (const id of STEPS) {
    write(storage, open(id, NOW, STEP_DEFS[id].chapter.path.en));
    for (let part = 1; part <= partCount(id) - 1; part++) write(storage, tick(id, part, NOW + part, { tx: TX, sentAt: NOW, wallet: FP, was: 'passkey' }));
  }
  // A need of "Pass it on" sent the reader to "Hold some", and a need of the drill to "The seed".
  write(storage, detour('hold-some', 'pass-it-on'));
  write(storage, detour('the-seed', 'prove-the-backup'));
  write(storage, tick('hold-some', 4, NOW + 9));
  const text = stored(storage) ?? '';
  const value = JSON.parse(text) as { steps: Record<string, Record<string, unknown>> } & Record<string, unknown>;
  assert.deepEqual(Object.keys(value), ['v', 'following', 'followedAt', 'steps']);
  assert.deepEqual(Object.keys(value.steps), [...STEPS]);
  const listed = ['started', 'doneAt', 'from', 'cameFor', 'wallet', 'was', 'tx', 'sentAt', 'parts'];
  for (const [id, step] of Object.entries(value.steps)) {
    for (const field of Object.keys(step)) assert.ok(listed.includes(field), `${id}.${field}`);
    // In one fixed order, so that two tabs that write the same note write the same text.
    assert.deepEqual(Object.keys(step), listed.filter((field) => field in step), id);
  }
  // The step a reader came for stands straight after the way back, in the two notes that have one.
  assert.deepEqual(Object.keys(value.steps['hold-some'] ?? {}), ['started', 'doneAt', 'from', 'cameFor', 'wallet', 'was', 'parts']);
  assert.deepEqual([value.steps['hold-some']?.cameFor, value.steps['the-seed']?.cameFor], ['pass-it-on', 'prove-the-backup']);
  assert.deepEqual(STEPS.filter((id) => 'cameFor' in (value.steps[id] ?? {})), ['hold-some', 'the-seed']);
  // Public things only: a fingerprint, an ID, paths, step IDs, times and ticks. No address and no public key.
  assert.doesNotMatch(text, /bcrt1|tpub|tprv|mnemonic/);
});

// -- the way back -----------------------------------------------------------------------------

/**
 * The six pages a way back can name: for each step the English and the Spanish page of its own chapter, as the
 * main site writes its own addresses. Written out here, and not read from steps.ts, so that a change to a
 * chapter's path is a change somebody made on purpose in two places.
 */
const CHAPTER_PAGES: Record<StepId, readonly [en: string, es: string]> = {
  'hold-some': ['/journey/what-bitcoin-actually-is', '/es/recorrido/que-es-bitcoin-en-realidad'],
  'pass-it-on': ['/journey/how-bitcoin-works', '/es/recorrido/como-funciona-bitcoin'],
  'no-balances': ['/journey/how-bitcoin-works', '/es/recorrido/como-funciona-bitcoin'],
  'waiting-room': ['/journey/how-bitcoin-works', '/es/recorrido/como-funciona-bitcoin'],
  'the-seed': ['/journey/be-your-own-bank', '/es/recorrido/se-tu-propio-banco'],
  'prove-the-backup': ['/journey/be-your-own-bank', '/es/recorrido/se-tu-propio-banco'],
};

/** Every one of the six, once. */
const ALL_PAGES = [...new Set(Object.values(CHAPTER_PAGES).flat())];

/**
 * The 17 endings a done step's link back can have: the step being left, then the other done steps of its
 * chapter in the contract's order. Written out here, and not worked out, so that a change to the rule is a
 * change somebody made on purpose in two places.
 */
const DONE_ENDINGS: Record<StepId, readonly string[]> = {
  'hold-some': ['#done=hold-some'],
  'pass-it-on': ['#done=pass-it-on', '#done=pass-it-on,no-balances', '#done=pass-it-on,waiting-room', '#done=pass-it-on,no-balances,waiting-room'],
  'no-balances': ['#done=no-balances', '#done=no-balances,pass-it-on', '#done=no-balances,waiting-room', '#done=no-balances,pass-it-on,waiting-room'],
  'waiting-room': ['#done=waiting-room', '#done=waiting-room,pass-it-on', '#done=waiting-room,no-balances', '#done=waiting-room,pass-it-on,no-balances'],
  'the-seed': ['#done=the-seed', '#done=the-seed,prove-the-backup'],
  'prove-the-backup': ['#done=prove-the-backup', '#done=prove-the-backup,the-seed'],
};

/** What the main site reads as a done ending: at most six step IDs after "#done=", with commas, in at most 200 characters. */
const MAIN_SITE_DONE = /^#done=([a-z0-9-]+(?:,[a-z0-9-]+){0,5})$/;

/**
 * Every address "Back to the chapter" can have, whatever the note holds: for each step its chapter's two pages,
 * each with the step's card ("#do-<step>") and with each of the step's done endings. 12 and 34: 46.
 */
const EVERY_LINK: readonly string[] = STEPS.flatMap((id) => CHAPTER_PAGES[id].flatMap((path) => [`${SITE}${path}#do-${id}`, ...DONE_ENDINGS[id].map((ending) => `${SITE}${path}${ending}`)]));

/** What is no way back for any step, though some of it is a plain path of the main site. */
const NO_WAY_BACK: unknown[] = [
  // Other pages of the main site: plain paths, each of them, and none of them the chapter of a step.
  '/',
  '/journey',
  '/journey/',
  '/newsletter',
  '/glossary/utxo-unspent-transaction-output',
  '/archive/t/2015/any-page-of-the-main-site',
  '/a-b/c-d/0-9',
  '/u/reader-4f1c9a7e-2b6d-4c1e-9d0a-7e5f3b2a1c0d/campaign-77',
  `/${'a'.repeat(199)}`,
  // A chapter that has no step, and a path that only starts like a chapter's.
  '/journey/the-problem-bitcoin-solves',
  '/journey/how-bitcoin-works-2',
  '/journey/how-bitcoin-works/extra',
  '/es/journey/how-bitcoin-works',
  '/recorrido/como-funciona-bitcoin',
  // A chapter's page, written another way. The main site's own address has no slash at its end.
  '/journey/how-bitcoin-works/',
  '/es/recorrido/como-funciona-bitcoin/',
  '/journey//how-bitcoin-works',
  '/journey/./how-bitcoin-works',
  '/journey/x/../how-bitcoin-works',
  '/Journey/How-Bitcoin-Works',
  '/JOURNEY/HOW-BITCOIN-WORKS',
  '/journey/how_bitcoin_works',
  '/journey/how-bitcoin-works.html',
  '/journey/how-bitcoin-works?x=1',
  '/journey/how-bitcoin-works#done=pass-it-on',
  '/journey/how%2Dbitcoin%2Dworks',
  '%2Fjourney%2Fhow-bitcoin-works',
  'journey/how-bitcoin-works',
  ' /journey/how-bitcoin-works',
  '/journey/how-bitcoin-works ',
  '/journey/how-bitcoin-works\n',
  '/journey/how-bitcoin-works\u0000',
  // Another site, by every spelling a browser would follow there.
  '//evil.example',
  '//evil.example/journey/how-bitcoin-works',
  '/journey//evil.example',
  '/\\evil.example',
  '\\\\evil.example',
  'https://evil.example/journey/how-bitcoin-works',
  'http://www.learnbitcoin.com/journey/how-bitcoin-works',
  'https://www.learnbitcoin.com/journey/how-bitcoin-works',
  '//www.learnbitcoin.com/journey/how-bitcoin-works',
  '/journey@evil.example',
  '/.evil.example',
  '/journey/..',
  '/../etc',
  // A script, or data.
  'javascript:alert(1)',
  '/javascript:alert(1)',
  'data:text/html,x',
  // Nothing, and letters that are not plain.
  '',
  '/café',
  '/\u202ejourney',
  // Too long for anything.
  `/${'a'.repeat(200)}`,
  `/${'a/'.repeat(150)}`,
  // Not a text at all, even where it would read as a chapter's page.
  null,
  undefined,
  7,
  true,
  ['/journey/how-bitcoin-works'],
  { toString: () => '/journey/how-bitcoin-works' },
  new String('/journey/how-bitcoin-works'),
];

test('the six chapter pages: the main site\'s own addresses, with no slash at the end', () => {
  assert.deepEqual(ALL_PAGES, [
    '/journey/what-bitcoin-actually-is',
    '/es/recorrido/que-es-bitcoin-en-realidad',
    '/journey/how-bitcoin-works',
    '/es/recorrido/como-funciona-bitcoin',
    '/journey/be-your-own-bank',
    '/es/recorrido/se-tu-propio-banco',
  ]);
  for (const id of STEPS) {
    assert.deepEqual([STEP_DEFS[id].chapter.path.en, STEP_DEFS[id].chapter.path.es], [...CHAPTER_PAGES[id]], id);
    assert.deepEqual(Object.keys(STEP_DEFS[id].chapter.path).sort(), [...LANGS].sort(), `${id}: one page for each language, and no third`);
  }
  const spanishPages = new Set(Object.values(CHAPTER_PAGES).map(([, spanish]) => spanish));
  for (const path of ALL_PAGES) {
    // One slash in front, lower-case names of letters, digits and hyphens, and nothing after the last name.
    assert.match(path, /^(\/[a-z0-9]+(-[a-z0-9]+)*)+$/, path);
    assert.ok(!path.endsWith('/'), `${path}: the main site's own address of a page has no slash at its end`);
    assert.equal(path.startsWith('/es/'), spanishPages.has(path), `${path}: the Spanish pages are the ones under /es/`);
  }
});

test('a way back counts only when it is the step\'s own chapter page, in English or in Spanish', () => {
  for (const id of STEPS) {
    const own = CHAPTER_PAGES[id];
    // The step's own chapter, in either language: kept, as it is.
    for (const path of own) assert.equal(validFrom(id, path), path, `${id}: ${path}`);
    // Another step's chapter is none: the reader would be sent to a page that has no card for this step.
    for (const path of ALL_PAGES) {
      if (!own.includes(path)) assert.equal(validFrom(id, path), null, `${id}: ${path}`);
    }
    // And nothing else is one, for any step.
    for (const value of NO_WAY_BACK) assert.equal(validFrom(id, value), null, `${id}: ${JSON.stringify(value)}`);
  }
  // So, over every step, the rule lets exactly two values through.
  const tried = [...ALL_PAGES, ...NO_WAY_BACK];
  for (const id of STEPS) {
    assert.deepEqual(tried.filter((value) => validFrom(id, value) !== null), [...CHAPTER_PAGES[id]], id);
  }
});

test('the way back in a step\'s address: the decoded value of the first "from", when it is the step\'s own chapter page', () => {
  assert.equal(fromOfSearch('pass-it-on', '?from=/journey/how-bitcoin-works'), '/journey/how-bitcoin-works');
  assert.equal(fromOfSearch('pass-it-on', 'from=/journey/how-bitcoin-works'), '/journey/how-bitcoin-works');
  assert.equal(fromOfSearch('pass-it-on', '?from=/es/recorrido/como-funciona-bitcoin'), '/es/recorrido/como-funciona-bitcoin');
  // As a browser writes it in a link: the slashes percent-encoded.
  assert.equal(fromOfSearch('the-seed', '?from=%2Fes%2Frecorrido%2Fse-tu-propio-banco'), '/es/recorrido/se-tu-propio-banco');
  assert.equal(fromOfSearch('prove-the-backup', '?state=funded&from=%2Fjourney%2Fbe-your-own-bank&x=1'), '/journey/be-your-own-bank');
  // The first one decides: a good one after a bad one does not rescue it, and a bad one after a good one changes nothing.
  assert.equal(fromOfSearch('pass-it-on', '?from=//evil.example&from=/journey/how-bitcoin-works'), null);
  assert.equal(fromOfSearch('pass-it-on', '?from=/newsletter&from=/journey/how-bitcoin-works'), null);
  assert.equal(fromOfSearch('pass-it-on', '?from=/journey/how-bitcoin-works&from=//evil.example'), '/journey/how-bitcoin-works');
  // The same address on another chapter's step names a page that is not that step's chapter: no way back.
  for (const id of ['hold-some', 'the-seed', 'prove-the-backup'] as const) {
    assert.equal(fromOfSearch(id, '?from=/journey/how-bitcoin-works'), null, id);
    assert.equal(fromOfSearch(id, '?from=%2Fes%2Frecorrido%2Fcomo-funciona-bitcoin'), null, id);
  }
  // Every step takes its own two pages from its address, and no other step's.
  for (const id of STEPS) {
    for (const path of ALL_PAGES) {
      const expected = CHAPTER_PAGES[id].includes(path) ? path : null;
      assert.equal(fromOfSearch(id, `?from=${path}`), expected, `${id}: ${path}`);
      assert.equal(fromOfSearch(id, `?from=${encodeURIComponent(path)}`), expected, `${id}: ${path}, encoded`);
    }
  }
  const hostile = [
    '',
    '?',
    '?from',
    '?from=',
    '?From=/journey/how-bitcoin-works',
    '?FROM=/journey/how-bitcoin-works',
    '?from=//evil.example',
    '?from=%2F%2Fevil.example',
    '?from=https%3A%2F%2Fevil.example',
    '?from=https://evil.example',
    '?from=javascript%3Aalert(1)',
    '?from=/journey/%252e%252e',
    '?from=%2Fjourney%2F..%2F..',
    // A plain path of the main site that is no chapter of this step.
    '?from=/',
    '?from=/journey',
    '?from=/newsletter',
    '?from=/glossary/utxo-unspent-transaction-output',
    '?from=/journey/what-bitcoin-actually-is',
    // The chapter's page, written another way.
    '?from=/journey/how-bitcoin-works/',
    '?from=/journey/how-bitcoin-works%2F',
    '?from=/Journey/How-Bitcoin-Works',
    '?from=%252Fjourney%252Fhow-bitcoin-works',
    // A plus sign is a space once decoded.
    '?from=/journey/how+bitcoin+works',
    '?from=/journey/how%20bitcoin%20works',
    '?from=/journey/how-bitcoin-works%0a',
    '?from=/journey/how-bitcoin-works%00',
    '?from=%',
    '?from=%E0%A4%A',
    '?from[]=/journey/how-bitcoin-works',
    '?from=/journey/how-bitcoin-works?x=1',
    '?from=/journey/how-bitcoin-works%23done%3Dpass-it-on',
  ];
  for (const search of hostile) assert.equal(fromOfSearch('pass-it-on', search), null, search);
});

test('"Back to the chapter" leads to the step\'s own chapter and nowhere else: the card until the step is done, and once it is done the step and the other done steps of its chapter', () => {
  for (const id of STEPS) {
    const [english, spanish] = CHAPTER_PAGES[id];
    for (const lang of LANGS) {
      const own = lang === 'en' ? english : spanish;
      // No way back was given: the step's own chapter, in the language of the page.
      assert.equal(chapterLink(SITE, id, lang, alone(id)), `${SITE}${own}#do-${id}`);
      assert.equal(chapterLink(SITE, id, lang, alone(id, { started: true })), `${SITE}${own}#do-${id}`);
      assert.equal(chapterLink(SITE, id, lang, alone(id, started(1))), `${SITE}${own}#do-${id}`, 'under way is not done');
      assert.equal(chapterLink(SITE, id, lang, alone(id, { started: true, doneAt: NOW })), `${SITE}${own}#done=${id}`);
      // The reader came from one of the chapter's two pages: that page, in both states, whatever language this page is in.
      for (const from of [english, spanish]) {
        assert.equal(chapterLink(SITE, id, lang, alone(id, { started: true, from })), `${SITE}${from}#do-${id}`);
        assert.equal(chapterLink(SITE, id, lang, alone(id, { started: true, from, doneAt: NOW })), `${SITE}${from}#done=${id}`);
      }
      // The rule is applied again when the link is built. A note that names any other page (written by hand, or
      // handed in by a caller that never read it through this file) does not get to choose the address: the link
      // is the step's own chapter in the page's language, as if the note named no page at all.
      const others = [...ALL_PAGES.filter((path) => path !== english && path !== spanish), ...NO_WAY_BACK.filter((value): value is string => typeof value === 'string')];
      for (const from of others) {
        assert.equal(chapterLink(SITE, id, lang, alone(id, { started: true, from })), `${SITE}${own}#do-${id}`, `${id} ${lang}: ${from}`);
        assert.equal(chapterLink(SITE, id, lang, alone(id, { started: true, from, doneAt: NOW })), `${SITE}${own}#done=${id}`, `${id} ${lang}: ${from}`);
      }
      // What the other steps' notes hold of a way back plays no part: only the step's own note chooses its page.
      const beside: Progress = { v: 1, following: null, steps: Object.fromEntries(STEPS.filter((other) => other !== id).map((other) => [other, { started: true, from: CHAPTER_PAGES[other][lang === 'en' ? 1 : 0] }])) };
      assert.equal(chapterLink(SITE, id, lang, beside), `${SITE}${own}#do-${id}`, `${id} ${lang}: the other steps came from their chapters' other pages`);
    }
  }

  // Every link there can be, for a step that no need sent the reader to: each of the 64 sets of done steps,
  // each step, both languages, and every kind of way back. The main site's address, a chapter's page, and the
  // ending. Nothing else is ever in it.
  const links = new Set<string>();
  for (let bits = 0; bits < 1 << STEPS.length; bits++) {
    const isDone = (id: StepId): boolean => ((bits >> STEPS.indexOf(id)) & 1) === 1;
    for (const id of STEPS) {
      for (const lang of LANGS) {
        for (const from of [undefined, ...ALL_PAGES, '/newsletter', '//evil.example']) {
          const steps: Progress['steps'] = {};
          for (const other of STEPS) {
            if (isDone(other)) steps[other] = { started: true, doneAt: NOW };
            else if (other === id) steps[other] = { started: true };
          }
          if (from !== undefined) steps[id] = { ...steps[id], from };
          const link = chapterLink(SITE, id, lang, { v: 1, following: null, steps });
          assert.ok(link !== null);
          links.add(link);
        }
      }
    }
  }
  assert.deepEqual([...links].sort(), [...EVERY_LINK].sort());
  assert.equal(EVERY_LINK.length, 46, '12 with the card of a step, and 34 with a done ending');

  // The settings' address with a slash at its end, or with a path: still the main site.
  assert.equal(chapterLink(`${SITE}/`, 'hold-some', 'es', alone('hold-some')), `${SITE}/es/recorrido/que-es-bitcoin-en-realidad#do-hold-some`);
  assert.equal(chapterLink('http://localhost:4321', 'hold-some', 'en', alone('hold-some')), 'http://localhost:4321/journey/what-bitcoin-actually-is#do-hold-some');
  // Every link that comes out is on the main site's origin.
  for (const id of STEPS) {
    const link = chapterLink(SITE, id, 'en', alone(id, { started: true, from: CHAPTER_PAGES[id][1], doneAt: NOW }));
    assert.equal(new URL(link ?? '').origin, new URL(SITE).origin);
    assert.equal(new URL(link ?? '').pathname, CHAPTER_PAGES[id][1]);
    assert.equal(new URL(link ?? '').hash, `#done=${id}`);
  }
  // Settings that name no web address give no link at all.
  for (const site of ['', 'not a url', 'javascript:alert(1)//', 'data:text/html,x', 'file:///etc', 'mailto:a@b.example', '//www.learnbitcoin.com']) {
    assert.equal(chapterLink(site, 'hold-some', 'en', alone('hold-some', { started: true, from: '/journey/what-bitcoin-actually-is' })), null, site);
    assert.equal(chapterLink(site, 'hold-some', 'en', alone('hold-some')), null, site);
  }
});

test('the way back, walked from the address to the link: from the English chapter, with no "from", and from another step\'s chapter', () => {
  /** Opens a step's screen with this query string, as the runner does, and gives the step's note. */
  const arrive = (progress: Progress, id: StepId, search: string, at = NOW): Progress => applyChange(progress, open(id, at, fromOfSearch(id, search)));

  // 1. A reader arrives from the English chapter, and then switches the wallet to Spanish. The switch keeps the
  //    address's query string and opens no step anew, so the note is as it was: the way back is the English
  //    chapter still, on the Spanish page as on the English one, before the step is done and after.
  let progress = arrive(emptyProgress(), 'pass-it-on', '?from=/journey/how-bitcoin-works');
  assert.equal(progress.steps['pass-it-on']?.from, '/journey/how-bitcoin-works');
  for (const lang of LANGS) {
    assert.equal(chapterLink(SITE, 'pass-it-on', lang, progress), `${SITE}/journey/how-bitcoin-works#do-pass-it-on`, lang);
  }
  // The Spanish page loaded again with the same address is an opening, and reads the same way back from it.
  progress = arrive(progress, 'pass-it-on', '?from=/journey/how-bitcoin-works', NOW + 1);
  for (const part of [1, 2, 3]) progress = applyChange(progress, tick('pass-it-on', part, NOW + 2, part === 2 ? { tx: TX, sentAt: NOW + 2 } : {}));
  assert.equal(progress.steps['pass-it-on']?.doneAt, NOW + 2);
  for (const lang of LANGS) {
    assert.equal(chapterLink(SITE, 'pass-it-on', lang, progress), `${SITE}/journey/how-bitcoin-works#done=pass-it-on`, lang);
  }
  // The other way round: from the Spanish chapter, read in English.
  const spanish = arrive(emptyProgress(), 'the-seed', '?from=%2Fes%2Frecorrido%2Fse-tu-propio-banco');
  for (const lang of LANGS) {
    assert.equal(chapterLink(SITE, 'the-seed', lang, spanish), `${SITE}/es/recorrido/se-tu-propio-banco#do-the-seed`, lang);
  }

  // 2. A reader arrives with no "from" (a bookmark, the list of steps): the note keeps no way back, and the link
  //    is the step's chapter in the language of the page that shows it.
  const plain = arrive(emptyProgress(), 'pass-it-on', '');
  assert.deepEqual(plain.steps['pass-it-on'], { started: true });
  assert.equal(chapterLink(SITE, 'pass-it-on', 'en', plain), `${SITE}/journey/how-bitcoin-works#do-pass-it-on`);
  assert.equal(chapterLink(SITE, 'pass-it-on', 'es', plain), `${SITE}/es/recorrido/como-funciona-bitcoin#do-pass-it-on`);

  // 3. A "from" that names another step's chapter is refused: nothing of it is kept, and the link is this
  //    step's own chapter. So is one that names any other page.
  for (const search of ['?from=/journey/be-your-own-bank', '?from=/es/recorrido/que-es-bitcoin-en-realidad', '?from=/newsletter', '?from=/', '?from=//evil.example']) {
    const refused = arrive(emptyProgress(), 'pass-it-on', search);
    assert.deepEqual(refused.steps['pass-it-on'], { started: true }, search);
    assert.equal(chapterLink(SITE, 'pass-it-on', 'en', refused), `${SITE}/journey/how-bitcoin-works#do-pass-it-on`, search);
    assert.equal(chapterLink(SITE, 'pass-it-on', 'es', refused), `${SITE}/es/recorrido/como-funciona-bitcoin#do-pass-it-on`, search);
    // And it does not take the place of a way back the note already has.
    const kept = arrive(progress, 'pass-it-on', search, NOW + 3);
    assert.equal(kept.steps['pass-it-on']?.from, '/journey/how-bitcoin-works', search);
  }
});

test('a stored note that names any other page loses that field when it is read, the next write of any kind takes it out of the storage, and no write puts it back', () => {
  const storage = new MemoryStorage();
  // As a hand, another program or an earlier build of this page might have left it: free text, and another step's chapter.
  const planted = {
    v: 1,
    following: 'pass-it-on',
    followedAt: NOW,
    steps: {
      'hold-some': { started: true, doneAt: NOW - 9, from: '/es/recorrido/que-es-bitcoin-en-realidad', parts: ticks(1, 2, 3, 4) },
      'pass-it-on': { started: true, from: '/u/reader-4f1c9a7e-2b6d-4c1e-9d0a-7e5f3b2a1c0d/campaign-77', parts: ticks(1) },
      'waiting-room': { started: true, from: '/journey/be-your-own-bank' },
      'the-seed': { from: '/newsletter' },
    },
  };
  put(storage, planted);
  const text = stored(storage);

  // Read: the field is gone where it is not the step's own chapter, and stands where it is. A step that held
  // nothing else is not there at all. Reading writes nothing.
  const read = readProgress(storage as Storage);
  assert.equal(read.state, 'kept');
  assert.deepEqual(read.progress.steps, {
    'hold-some': { started: true, doneAt: NOW - 9, from: '/es/recorrido/que-es-bitcoin-en-realidad', parts: ticks(1, 2, 3, 4) },
    'pass-it-on': { started: true, parts: ticks(1) },
    'waiting-room': { started: true },
  });
  assert.equal(storage.writes, 0);
  assert.equal(stored(storage), text);
  // The links built from what was read lead to each step's own chapter.
  assert.equal(chapterLink(SITE, 'pass-it-on', 'en', read.progress), `${SITE}/journey/how-bitcoin-works#do-pass-it-on`);
  assert.equal(chapterLink(SITE, 'waiting-room', 'es', read.progress), `${SITE}/es/recorrido/como-funciona-bitcoin#do-waiting-room`);
  assert.equal(chapterLink(SITE, 'hold-some', 'en', read.progress), `${SITE}/es/recorrido/que-es-bitcoin-en-realidad#done=hold-some`);

  // The next write stores the note as it was read: without the three fields. Whatever that write is for: here
  // it is a change that changes nothing ("Stop following" for a step that is not followed).
  const idle = writeProgress(storage as Storage, { kind: 'stop', step: 'the-seed' });
  assert.ok(idle.ok);
  assert.deepEqual([idle.changed, idle.read, idle.progress], [true, read.progress, read.progress], 'written, and nothing of the note changed');
  const tidied = stored(storage) ?? '';
  assert.notEqual(tidied, text);
  assert.doesNotMatch(tidied, /reader-4f1c9a7e|campaign|newsletter|be-your-own-bank/);
  assert.deepEqual(JSON.parse(tidied), read.progress, 'the stored note is the note as it was read');
  assert.equal(storage.writes, 1);
  // From then on the stored text is what this page writes, and a change with nothing to change writes nothing.
  const again = writeProgress(storage as Storage, { kind: 'stop', step: 'the-seed' });
  assert.deepEqual([again.ok, again.ok && again.changed, stored(storage), storage.writes], [true, false, tidied, 1]);
  // A write that has something to write goes on from there.
  const after = write(storage, tick('pass-it-on', 2, NOW + 1, { tx: TX, sentAt: NOW + 1 }));
  assert.deepEqual(after.steps, {
    'hold-some': { started: true, doneAt: NOW - 9, from: '/es/recorrido/que-es-bitcoin-en-realidad', parts: ticks(1, 2, 3, 4) },
    'pass-it-on': { started: true, tx: TX, sentAt: NOW + 1, parts: ticks(1, 2) },
    'waiting-room': { started: true },
  });
  const written = stored(storage) ?? '';
  assert.doesNotMatch(written, /reader-4f1c9a7e|campaign|newsletter|be-your-own-bank/);
  assert.deepEqual(JSON.parse(written), after);

  // Whatever is done to a note that was handed in with such a field (never read through this file), what comes
  // back holds no such field: every change ends in the same checks a read makes.
  const handed: Progress = { v: 1, following: 'pass-it-on', followedAt: NOW, steps: { 'pass-it-on': { started: true, from: '/newsletter', parts: ticks(1) } } };
  const changes: Change[] = [
    open('pass-it-on', NOW + 1),
    open('pass-it-on', NOW + 1, '/newsletter'),
    { kind: 'follow', step: 'pass-it-on', at: NOW + 1 },
    { kind: 'stop', step: 'pass-it-on' },
    tick('pass-it-on', 2, NOW + 1, { tx: TX, sentAt: NOW + 1 }),
    { kind: 'send-another', step: 'pass-it-on' },
    // "Start this step again" keeps the way back the step has: only one that is its own chapter.
    { kind: 'restart', step: 'pass-it-on', at: NOW + 1 },
    // A change for another step, and one that does not apply.
    open('the-seed', NOW + 1),
    tick('pass-it-on', 3, NOW + 1),
  ];
  for (const change of changes) {
    assert.equal(applyChange(handed, change).steps['pass-it-on']?.from, undefined, change.kind);
  }
  assert.equal(handed.steps['pass-it-on']?.from, '/newsletter', 'the note that was handed in is left as it was');
  // "Start this step again" on a step that has a way back of its own keeps it.
  const own: Progress = { v: 1, following: null, steps: { 'pass-it-on': { started: true, from: '/es/recorrido/como-funciona-bitcoin', parts: ticks(1) } } };
  assert.deepEqual(applyChange(own, { kind: 'restart', step: 'pass-it-on', at: NOW }).steps['pass-it-on'], { started: true, from: '/es/recorrido/como-funciona-bitcoin' });
});

test('what a read dropped leaves the storage at the next write, whatever that write is for; reading never writes', () => {
  // A browser in which every started step is done and none is followed. No visit to the list, to Home, to About
  // or to a wallet screen writes anything there, and before this rule nothing a done step's screen does wrote
  // either: so text that a read drops stayed in the storage for good.
  const done = (parts: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ started: true, doneAt: NOW - 9, parts: ticks(...Array.from({ length: parts }, (_, at) => at + 1)), ...extra });
  const planted = {
    v: 1,
    following: null,
    // A field no note has, at the top.
    campaign: 'spring-77',
    steps: {
      // Ways back that are not the step's own chapter: free text, and another step's chapter.
      'hold-some': done(4, { from: '/u/reader-4f1c9a7e/campaign-77' }),
      'pass-it-on': done(3, { from: '/newsletter' }),
      // A field no step's note has, a wallet fingerprint that is none, and a tick for a part the step has not.
      'the-seed': done(3, { wallet: FP, remark: 'typed by somebody', parts: { 1: true, 2: true, 3: true, 9: true } }),
      'waiting-room': done(3, { wallet: 'not-a-fingerprint' }),
      // A step this page does not have.
      'steal-the-seed': { started: true, from: '/elsewhere' },
    },
  };
  const hostile = /reader-4f1c9a7e|campaign|newsletter|typed by somebody|not-a-fingerprint|steal-the-seed|elsewhere|spring-77|"9"/;
  /** What a read makes of it: the six steps and the listed fields, each under its check. */
  const sound: Progress = {
    v: 1,
    following: null,
    steps: {
      'hold-some': { started: true, doneAt: NOW - 9, parts: ticks(1, 2, 3, 4) },
      'pass-it-on': { started: true, doneAt: NOW - 9, parts: ticks(1, 2, 3) },
      'waiting-room': { started: true, doneAt: NOW - 9, parts: ticks(1, 2, 3) },
      'the-seed': { started: true, doneAt: NOW - 9, wallet: FP, parts: ticks(1, 2, 3) },
    },
  };

  // Reading, as often and in as many ways as a page reads: nothing is written, and the text stays as planted.
  const looked = new MemoryStorage();
  put(looked, planted);
  const text = stored(looked) ?? '';
  assert.match(text, hostile);
  for (let look = 0; look < 5; look++) {
    const read = readProgress(looked as Storage);
    assert.deepEqual([read.state, read.progress], ['kept', sound]);
    for (const id of STEPS) chapterLink(SITE, id, 'en', read.progress);
    stripStep(read.progress, NOW);
    watchedScreen({ name: 'step', id: 'hold-some' }, read.progress);
  }
  assert.deepEqual([looked.writes, stored(looked)], [0, text], 'a look is no change');

  // Every kind of change a page can hand in, each on a storage of its own. None of them changes anything in
  // this note (every step is done, none is followed). Each is a write all the same, and after it the stored
  // text is the note as it was read: nothing that the read dropped is left.
  const changes: Change[] = [
    // A done step's screen is opened: what a visit to a finished step does.
    open('hold-some', NOW + 1),
    open('pass-it-on', NOW + 1, '/newsletter'),
    { kind: 'follow', step: 'hold-some', at: NOW + 1 },
    { kind: 'stop', step: 'pass-it-on' },
    tick('the-seed', 3, NOW + 1),
    tick('no-balances', 1, NOW + 1),
    { kind: 'payment', step: 'pass-it-on', tx: TX, sentAt: NOW + 1 },
    { kind: 'send-another', step: 'waiting-room' },
    { kind: 'restart', step: 'hold-some', at: NOW + 1 },
    // A change that names no step of this page at all.
    { kind: 'stop', step: 'steal-the-seed' as StepId },
  ];
  for (const change of changes) {
    const storage = new MemoryStorage();
    put(storage, planted);
    const result = writeProgress(storage as Storage, change);
    assert.ok(result.ok, change.kind);
    assert.deepEqual(result.read, sound, change.kind);
    assert.deepEqual(result.progress, sound, `${change.kind}: the note itself is as it was read`);
    assert.equal(result.changed, true, `${change.kind}: something was written`);
    assert.equal(storage.writes, 1, change.kind);
    const after = stored(storage) ?? '';
    assert.doesNotMatch(after, hostile, change.kind);
    assert.equal(after, JSON.stringify(sound), `${change.kind}: the stored text is exactly what this page writes`);
    // Once: the next change that changes nothing writes nothing.
    const again = writeProgress(storage as Storage, change);
    assert.deepEqual([again.ok, again.ok && again.changed, storage.writes, stored(storage)], [true, false, 1, after], change.kind);
  }

  // The same when the change does apply: what is written is the note as read, with the change, and nothing else.
  const opened = new MemoryStorage();
  put(opened, planted);
  const first = write(opened, open('no-balances', NOW + 1, '/journey/how-bitcoin-works'));
  assert.deepEqual(first.steps['no-balances'], { started: true, from: '/journey/how-bitcoin-works' });
  assert.doesNotMatch(stored(opened) ?? '', hostile);

  // What this rule does not do. A note this page wrote is left alone by a change that changes nothing (the
  // stored text is already what this page writes)...
  const clean = new MemoryStorage();
  put(clean, JSON.stringify(sound));
  for (const change of changes) {
    const result = writeProgress(clean as Storage, change);
    assert.deepEqual([result.ok, result.ok && result.changed], [true, false], change.kind);
  }
  assert.equal(clean.writes, 0);
  // ...something that is no note at all stays until there is a change to write (the list offers "Forget my
  // progress" for it)...
  for (const junk of ['not json {', '[1]', '"text"', '{"v":0}', '']) {
    const storage = new MemoryStorage();
    put(storage, junk);
    const result = writeProgress(storage as Storage, { kind: 'stop', step: 'hold-some' });
    assert.deepEqual([result.ok, result.ok && result.changed, storage.writes, stored(storage)], [true, false, 0, junk], junk);
  }
  // ...a newer version's note is never written over, whatever is in it...
  const newer = new MemoryStorage();
  put(newer, { ...planted, v: 2 });
  const kept = stored(newer);
  assert.deepEqual(writeProgress(newer as Storage, open('hold-some', NOW + 1)), { ok: false, why: 'newer' });
  assert.deepEqual([newer.writes, stored(newer)], [0, kept]);
  // ...and where nothing is stored, a change that changes nothing still stores nothing.
  const empty = new MemoryStorage();
  assert.deepEqual(writeProgress(empty as Storage, { kind: 'stop', step: 'hold-some' }), { ok: true, read: emptyProgress(), progress: emptyProgress(), changed: false });
  assert.deepEqual([empty.writes, stored(empty)], [0, null]);
  // A browser that refuses the write: "storage", and the planted text is still what is stored.
  const full = new FullStorage();
  put(full, planted);
  assert.deepEqual(writeProgress(full as Storage, { kind: 'stop', step: 'hold-some' }), { ok: false, why: 'storage' });
  assert.equal(stored(full), text);
});

// -- the step a reader came for ----------------------------------------------------------------

/**
 * The seven pairs the app's own needs can make: the step a need leads to, and the step whose need it is. "Hold
 * some" gives a wallet and coins to each of the other five, "Pass it on" the payment that "There are no
 * balances" reads, and "The seed" the paper copy that the drill starts from.
 */
const NEED_PAIRS: readonly (readonly [to: StepId, cameFor: StepId])[] = [
  ['hold-some', 'pass-it-on'],
  ['hold-some', 'no-balances'],
  ['hold-some', 'waiting-room'],
  ['hold-some', 'the-seed'],
  ['hold-some', 'prove-the-backup'],
  ['pass-it-on', 'no-balances'],
  ['the-seed', 'prove-the-backup'],
];

test('the step a reader came for is written by the press of a need\'s link, and only on a road from a chapter', () => {
  // The reader pressed the card of "Pass it on" in chapter 3 and has no wallet: the need leads to "Hold some".
  const byCard = note({ 'pass-it-on': started(0, { from: '/journey/how-bitcoin-works' }) }, 'pass-it-on');
  const sent = applyChange(byCard, detour('hold-some', 'pass-it-on'));
  // The one field, in a note that is made for it. Nothing else changes: not who is followed, no time, and
  // nothing in the note of the step the reader is on.
  assert.deepEqual(sent, { ...byCard, steps: { 'hold-some': { cameFor: 'pass-it-on' }, 'pass-it-on': byCard.steps['pass-it-on'] } });
  // "Hold some" is not started by it: the list still says "Not started", it gets no strip, and nothing ticks for it.
  assert.equal(stepState(sent.steps['hold-some']), 'not-started');
  assert.equal(stripStep({ ...sent, following: 'hold-some', followedAt: NOW }, NOW), null);
  assert.deepEqual(applyChange(sent, tick('hold-some', 1)), sent);
  // The same press again changes nothing.
  assert.deepEqual(applyChange(sent, detour('hold-some', 'pass-it-on')), sent);

  // Each of the seven pairs, for a reader who pressed the card of the step they came for, in either language.
  for (const [to, cameFor] of NEED_PAIRS) {
    for (const from of CHAPTER_PAGES[cameFor]) {
      const pressed = applyChange(note({ [cameFor]: started(0, { from }) }, cameFor), detour(to, cameFor));
      assert.deepEqual(pressed.steps[to], { cameFor }, `${to} from ${cameFor}`);
      assert.deepEqual(pressed.steps[cameFor], { started: true, from }, `${to} from ${cameFor}`);
    }
  }

  // The step the reader came for was itself reached by a need: a road of three. "There are no balances" by
  // its card; its need (nothing sent) leads to "Pass it on", whose need (no coins) leads on to "Hold some".
  let road = note({ 'no-balances': started(0, { from: '/es/recorrido/como-funciona-bitcoin' }) }, 'no-balances');
  road = applyChange(road, detour('pass-it-on', 'no-balances'));
  road = applyChange(road, open('pass-it-on', NOW + 1));
  road = applyChange(road, detour('hold-some', 'pass-it-on'));
  assert.deepEqual(road.steps, {
    'hold-some': { cameFor: 'pass-it-on' },
    'pass-it-on': { started: true, cameFor: 'no-balances' },
    'no-balances': { started: true, from: '/es/recorrido/como-funciona-bitcoin' },
  });

  // -- Where it is not written: the note is unchanged in content. --
  // The step the press is on was opened from the wallet's own list: it has no way back and no step of its own to lead back to.
  const fromList = note({ 'pass-it-on': started(1) }, 'pass-it-on');
  assert.deepEqual(applyChange(fromList, detour('hold-some', 'pass-it-on')), fromList);
  // It is done: a done step sends nobody anywhere.
  const finished = note({ 'pass-it-on': started(3, { doneAt: NOW, from: '/journey/how-bitcoin-works' }) });
  assert.deepEqual(applyChange(finished, detour('hold-some', 'pass-it-on')), finished);
  // It was never started: a note that holds a way back and no start (made by hand), and no note at all.
  const unstarted = note({ 'pass-it-on': { from: '/journey/how-bitcoin-works' } });
  assert.deepEqual(applyChange(unstarted, detour('hold-some', 'pass-it-on')), unstarted);
  assert.deepEqual(applyChange(emptyProgress(), detour('hold-some', 'pass-it-on')), emptyProgress());
  // It is the step the link leads to, or no step at all; or the link leads to what is no step.
  assert.deepEqual(applyChange(byCard, detour('pass-it-on', 'pass-it-on')), byCard);
  for (const stray of ['first-payment', 'toString', '', 'Pass it on', 7, null, undefined, ['pass-it-on']]) {
    assert.deepEqual(applyChange(byCard, { kind: 'detour', step: 'hold-some', cameFor: stray as StepId }), byCard, String(stray));
  }
  assert.deepEqual(applyChange(byCard, { kind: 'detour', step: 'first-payment' as StepId, cameFor: 'pass-it-on' }), byCard);
  // Its way back is none (a note handed in with another page, which no read lets through): then it did not come by its card.
  const elsewhere: Progress = { v: 1, following: null, steps: { 'pass-it-on': { started: true, from: '/journey/be-your-own-bank' } } };
  assert.deepEqual(applyChange(elsewhere, detour('hold-some', 'pass-it-on')).steps, { 'pass-it-on': { started: true } });
  // Its own memory names a done step, so it no longer counts: then it did not come by a need either.
  const stale: Progress = { v: 1, following: null, steps: { 'pass-it-on': { started: true, cameFor: 'no-balances' }, 'no-balances': { started: true, doneAt: NOW } } };
  assert.deepEqual(applyChange(stale, detour('hold-some', 'pass-it-on')).steps, { 'pass-it-on': { started: true }, 'no-balances': { started: true, doneAt: NOW } });

  // -- What the note of the step it leads to already holds stays, and a later press takes an earlier one's place. --
  const under = note({ 'pass-it-on': started(0, { from: '/journey/how-bitcoin-works' }), 'hold-some': started(2, { from: '/journey/what-bitcoin-actually-is' }) }, 'pass-it-on');
  assert.deepEqual(applyChange(under, detour('hold-some', 'pass-it-on')).steps['hold-some'], { started: true, from: '/journey/what-bitcoin-actually-is', cameFor: 'pass-it-on', parts: ticks(1, 2) });
  let twice = applyChange(sent, open('the-seed', NOW + 1, '/journey/be-your-own-bank'));
  twice = applyChange(twice, detour('hold-some', 'the-seed'));
  assert.deepEqual(twice.steps['hold-some'], { cameFor: 'the-seed' });
  assert.deepEqual([twice.following, twice.followedAt], ['the-seed', NOW + 1], 'the press itself follows nothing');

  // -- A later press that is not remembered ends what an earlier road left. The reader pressed the card of "The
  //    seed" in chapter 4 with no wallet, was sent to "Hold some", made a wallet and gave up. On a later day they
  //    open "Pass it on" from the wallet's own list, and its need (no coins) sends them to "Hold some" as well. --
  let earlier = note({ 'the-seed': started(0, { from: '/journey/be-your-own-bank' }) }, 'the-seed');
  earlier = applyChange(earlier, detour('hold-some', 'the-seed'));
  earlier = applyChange(earlier, open('hold-some', NOW + 1));
  earlier = applyChange(earlier, tick('hold-some', 1, NOW + 2));
  earlier = applyChange(earlier, open('pass-it-on', NOW + 3));
  assert.deepEqual([ledBackTo(earlier, 'hold-some'), cameFromChapter(earlier, 'pass-it-on')], ['the-seed', false]);
  const later = applyChange(earlier, detour('hold-some', 'pass-it-on'));
  // The step they gave up is not named any more, and this road leaves no name in its place.
  assert.deepEqual(later.steps, {
    'hold-some': { started: true, parts: ticks(1) },
    'pass-it-on': { started: true },
    'the-seed': { started: true, from: '/journey/be-your-own-bank' },
  });
  assert.deepEqual([later.following, later.followedAt], [earlier.following, earlier.followedAt], 'nothing else changes');
  // So "Hold some" leads back to no step, and its link back leads to its own chapter: the screens of a reader from the list.
  assert.deepEqual([ledBackTo(later, 'hold-some'), roadStart(later, 'hold-some'), cameFromChapter(later, 'hold-some')], [null, 'hold-some', false]);
  assert.equal(chapterLink(SITE, 'hold-some', 'en', later), `${SITE}/journey/what-bitcoin-actually-is#do-hold-some`);
  assert.equal(chapterLink(SITE, 'hold-some', 'en', earlier), `${SITE}/journey/be-your-own-bank#do-the-seed`, 'where it led before the press');
  // The same press again changes nothing.
  assert.deepEqual(applyChange(later, detour('hold-some', 'pass-it-on')), later);
  // A note of "Hold some" that held the memory and nothing else (the step was never opened) is gone with it.
  let unopened = note({ 'the-seed': started(0, { from: '/journey/be-your-own-bank' }) }, 'the-seed');
  unopened = applyChange(unopened, detour('hold-some', 'the-seed'));
  unopened = applyChange(unopened, open('pass-it-on', NOW + 1));
  assert.deepEqual(Object.keys(applyChange(unopened, detour('hold-some', 'pass-it-on')).steps), ['pass-it-on', 'the-seed']);
  // A way back of the step's own stays: only the name of the other step goes.
  const own = applyChange(
    note({ 'hold-some': started(1, { from: '/journey/what-bitcoin-actually-is', cameFor: 'the-seed' }), 'the-seed': started(0, { from: '/journey/be-your-own-bank' }), 'pass-it-on': started(0) }, 'pass-it-on'),
    detour('hold-some', 'pass-it-on'),
  );
  assert.deepEqual(own.steps['hold-some'], { started: true, from: '/journey/what-bitcoin-actually-is', parts: ticks(1) });
  // The earlier memory stays where the press is none of a step under way: a step that is done or was never
  // started sends nobody anywhere, and what is no step is nothing.
  const standing = note({ 'hold-some': started(1, { cameFor: 'the-seed' }), 'the-seed': started(0, { from: '/journey/be-your-own-bank' }) }, 'hold-some');
  assert.deepEqual(applyChange(standing, detour('hold-some', 'pass-it-on')), standing, 'never started');
  const doneSender: Progress = { ...standing, steps: { ...standing.steps, 'pass-it-on': started(3, { doneAt: NOW }) } };
  assert.deepEqual(applyChange(doneSender, detour('hold-some', 'pass-it-on')), doneSender, 'done');
  for (const stray of ['first-payment', 'toString', '', 7, null, undefined]) {
    assert.deepEqual(applyChange(standing, { kind: 'detour', step: 'hold-some', cameFor: stray as StepId }), standing, String(stray));
  }
  assert.deepEqual(applyChange(standing, detour('hold-some', 'hold-some')), standing, 'the step itself');
  // And where the press is on the very step the memory names. "There are no balances" by its card sent the reader
  // to "Pass it on", which sent them on to "Hold some"; then "There are no balances" was done another way. "Pass
  // it on" has lost the step it led back to, and is the step "Hold some" leads back to all the same: a second
  // press of its need changes nothing.
  let three = note({ 'no-balances': started(0, { from: '/journey/how-bitcoin-works' }) }, 'no-balances');
  three = applyChange(three, detour('pass-it-on', 'no-balances'));
  three = applyChange(three, open('pass-it-on', NOW + 1));
  three = applyChange(three, detour('hold-some', 'pass-it-on'));
  for (const part of [1, 2, 3]) three = applyChange(three, tick('no-balances', part, NOW + 2));
  assert.deepEqual([three.steps['pass-it-on']?.cameFor, three.steps['hold-some']?.cameFor, cameFromChapter(three, 'pass-it-on')], [undefined, 'pass-it-on', false]);
  assert.deepEqual(applyChange(three, detour('hold-some', 'pass-it-on')), three);
  // Through the one write: the stored text, without the field.
  const gaveUp = new MemoryStorage();
  write(gaveUp, open('the-seed', NOW, '/journey/be-your-own-bank'));
  write(gaveUp, detour('hold-some', 'the-seed'));
  write(gaveUp, open('hold-some', NOW + 1));
  write(gaveUp, open('pass-it-on', NOW + 2));
  assert.match(stored(gaveUp) ?? '', /"hold-some":\{"started":true,"cameFor":"the-seed"\}/);
  const cleared = writeProgress(gaveUp as Storage, detour('hold-some', 'pass-it-on'));
  assert.ok(cleared.ok && cleared.changed);
  assert.equal(
    stored(gaveUp),
    '{"v":1,"following":"pass-it-on","followedAt":1800000000002,"steps":{"hold-some":{"started":true},"pass-it-on":{"started":true},"the-seed":{"started":true,"from":"/journey/be-your-own-bank"}}}',
  );

  // -- Through the one write: the stored text, with the field after the way back. --
  const storage = new MemoryStorage();
  write(storage, open('pass-it-on', NOW, '/journey/how-bitcoin-works'));
  const pressed = writeProgress(storage as Storage, detour('hold-some', 'pass-it-on'));
  assert.ok(pressed.ok && pressed.changed);
  assert.equal(
    stored(storage),
    '{"v":1,"following":"pass-it-on","followedAt":1800000000000,"steps":{"hold-some":{"cameFor":"pass-it-on"},"pass-it-on":{"started":true,"from":"/journey/how-bitcoin-works"}}}',
  );
  const again = writeProgress(storage as Storage, detour('hold-some', 'pass-it-on'));
  assert.deepEqual([again.ok, again.ok && again.changed, storage.writes], [true, false, 2], 'the same press again writes nothing');
  // The link is followed: "Hold some" opens with no way back of its own, and keeps the field.
  write(storage, open('hold-some', NOW + 1));
  assert.equal(
    stored(storage),
    '{"v":1,"following":"hold-some","followedAt":1800000000001,"steps":{"hold-some":{"started":true,"cameFor":"pass-it-on"},"pass-it-on":{"started":true,"from":"/journey/how-bitcoin-works"}}}',
  );
  // A step that has a way back of its own from an earlier day, and is sent to by a need now: both, in that order.
  const both = new MemoryStorage();
  write(both, open('hold-some', NOW, '/es/recorrido/que-es-bitcoin-en-realidad'));
  write(both, open('waiting-room', NOW + 1, '/journey/how-bitcoin-works'));
  write(both, detour('hold-some', 'waiting-room'));
  assert.equal(
    stored(both),
    '{"v":1,"following":"waiting-room","followedAt":1800000000001,"steps":{"hold-some":{"started":true,"from":"/es/recorrido/que-es-bitcoin-en-realidad","cameFor":"waiting-room"},"waiting-room":{"started":true,"from":"/journey/how-bitcoin-works"}}}',
  );
  // A browser that refuses the write: "storage", and nothing of the press is kept.
  const full = new FullStorage();
  full.full = false;
  write(full, open('pass-it-on', NOW, '/journey/how-bitcoin-works'));
  full.full = true;
  const kept = stored(full);
  assert.deepEqual(writeProgress(full as Storage, detour('hold-some', 'pass-it-on')), { ok: false, why: 'storage' });
  assert.equal(stored(full), kept);
});

test('the memory goes when the step it names is done, when the reader arrives by the step\'s own card, and with the note; it stays through every other opening, a restart and a stop', () => {
  /** A storage in which "Pass it on", reached by its card, has sent the reader to "Hold some", which is open. */
  const detoured = (): MemoryStorage => {
    const storage = new MemoryStorage();
    write(storage, open('pass-it-on', NOW, '/journey/how-bitcoin-works'));
    write(storage, detour('hold-some', 'pass-it-on'));
    write(storage, open('hold-some', NOW + 1));
    return storage;
  };
  const cameFor = (storage: MemoryStorage): StepId | undefined => readProgress(storage as Storage).progress.steps['hold-some']?.cameFor;

  // -- It stays. --
  const storage = detoured();
  const stays: [what: string, change: Change][] = [
    ['an opening of the step with no way back', open('hold-some', NOW + 2)],
    ['an opening of the step with a way back that is none', open('hold-some', NOW + 2, '/journey/how-bitcoin-works')],
    ['a tick of the step', tick('hold-some', 1, NOW + 3)],
    ['"Start this step again" on the step', { kind: 'restart', step: 'hold-some', at: NOW + 4 }],
    ['"Stop following"', { kind: 'stop', step: 'hold-some' }],
    ['an opening of the step the reader came for', open('pass-it-on', NOW + 5)],
    ['that step\'s own card, pressed again', open('pass-it-on', NOW + 5, '/es/recorrido/como-funciona-bitcoin')],
    ['a tick of the step the reader came for', tick('pass-it-on', 1, NOW + 6)],
    ['"Start this step again" on the step the reader came for', { kind: 'restart', step: 'pass-it-on', at: NOW + 7 }],
    ['the step followed again', { kind: 'follow', step: 'hold-some', at: NOW + 8 }],
    ['an opening of a third step', open('the-seed', NOW + 9, '/journey/be-your-own-bank')],
  ];
  for (const [what, change] of stays) {
    const result = writeProgress(storage as Storage, change);
    assert.ok(result.ok, what);
    assert.equal(cameFor(storage), 'pass-it-on', what);
  }
  // The step itself is done: it still leads back, and from now on its card says so. The browser's Back from the
  // step the reader came for shows the same card, because opening that step's screen takes nothing away.
  for (const part of [1, 2, 3, 4]) write(storage, tick('hold-some', part, NOW + 10));
  assert.ok(readProgress(storage as Storage).progress.steps['hold-some']?.doneAt !== undefined);
  assert.equal(cameFor(storage), 'pass-it-on');
  for (const change of [open('pass-it-on', NOW + 11), open('hold-some', NOW + 12), open('pass-it-on', NOW + 13), open('hold-some', NOW + 14)]) {
    write(storage, change);
    assert.equal(cameFor(storage), 'pass-it-on', `${change.step} opened`);
    assert.equal(ledBackTo(readProgress(storage as Storage).progress, 'hold-some'), 'pass-it-on');
  }

  // -- It goes with the write that finishes the step it names: the road it was kept for is over. --
  write(storage, tick('pass-it-on', 1, NOW + 15));
  write(storage, tick('pass-it-on', 2, NOW + 16, { tx: TX, sentAt: NOW + 16 }));
  assert.equal(cameFor(storage), 'pass-it-on', 'not before the last part');
  const last = writeProgress(storage as Storage, tick('pass-it-on', 3, NOW + 17));
  assert.ok(last.ok && last.changed);
  assert.equal(last.read.steps['hold-some']?.cameFor, 'pass-it-on');
  assert.equal(last.progress.steps['hold-some']?.cameFor, undefined);
  assert.equal(last.progress.steps['pass-it-on']?.doneAt, NOW + 17);
  assert.doesNotMatch(stored(storage) ?? '', /cameFor/);
  assert.equal(ledBackTo(last.progress, 'hold-some'), null);
  // A note that held nothing but the field (the step was never opened) is gone with it.
  const unopened = new MemoryStorage();
  write(unopened, open('pass-it-on', NOW, '/journey/how-bitcoin-works'));
  write(unopened, detour('hold-some', 'pass-it-on'));
  for (const part of [1, 2, 3]) write(unopened, tick('pass-it-on', part, NOW + part, part === 2 ? { tx: TX, sentAt: NOW } : {}));
  assert.deepEqual(Object.keys(readProgress(unopened as Storage).progress.steps), ['pass-it-on']);

  // -- It goes when the reader arrives on the step by the step's own card: that is the later road. --
  const byCard = detoured();
  write(byCard, open('hold-some', NOW + 2, '/journey/what-bitcoin-actually-is'));
  assert.deepEqual(readProgress(byCard as Storage).progress.steps['hold-some'], { started: true, from: '/journey/what-bitcoin-actually-is' });
  assert.deepEqual(readProgress(byCard as Storage).progress.steps['pass-it-on'], { started: true, from: '/journey/how-bitcoin-works' });
  // And a need pressed after that is the later road again.
  write(byCard, detour('hold-some', 'pass-it-on'));
  assert.deepEqual(readProgress(byCard as Storage).progress.steps['hold-some'], { started: true, from: '/journey/what-bitcoin-actually-is', cameFor: 'pass-it-on' });

  // -- It goes with the note. --
  const forgotten = detoured();
  assert.equal(forgetProgress(forgotten as Storage), true);
  assert.equal(stored(forgotten), null);
  assert.deepEqual(write(forgotten, open('hold-some', NOW + 20)).steps, { 'hold-some': { started: true } });
});

test('the note\'s version is 1 with the new field, and a note without it is stored as before', () => {
  assert.equal(emptyProgress().v, 1);
  // A note that holds the field is a note of version 1, and is read as one.
  const storage = new MemoryStorage();
  write(storage, open('pass-it-on', NOW, '/journey/how-bitcoin-works'));
  write(storage, detour('hold-some', 'pass-it-on'));
  const text = stored(storage) ?? '';
  assert.ok(text.startsWith('{"v":1,'), text);
  assert.match(text, /"cameFor":"pass-it-on"/);
  assert.deepEqual(parseProgress(text).state, 'kept');
  // A higher number is still a newer version's note: this page reads none of it, with the field or without.
  for (const newer of ['{"v":2}', text.replace('{"v":1,', '{"v":2,')]) {
    assert.deepEqual(parseProgress(newer), { state: 'newer', progress: emptyProgress() }, newer);
    const kept = new MemoryStorage();
    put(kept, newer);
    assert.deepEqual(writeProgress(kept as Storage, detour('hold-some', 'pass-it-on')), { ok: false, why: 'newer' });
    assert.equal(stored(kept), newer);
  }
  // A note without the field is stored character for character as it was before the field existed: a first
  // opening from a chapter, and a step done after it.
  const plain = new MemoryStorage();
  write(plain, open('hold-some', NOW, '/journey/what-bitcoin-actually-is'));
  assert.equal(stored(plain), '{"v":1,"following":"hold-some","followedAt":1800000000000,"steps":{"hold-some":{"started":true,"from":"/journey/what-bitcoin-actually-is"}}}');
  for (const part of [1, 2, 3, 4]) write(plain, tick('hold-some', part, NOW + part));
  assert.equal(
    stored(plain),
    '{"v":1,"following":"hold-some","followedAt":1800000000004,"steps":{"hold-some":{"started":true,"doneAt":1800000000004,"from":"/journey/what-bitcoin-actually-is","parts":{"1":true,"2":true,"3":true,"4":true}}}}',
  );
  // The field holds one of a few fixed values, never text of anybody's choosing: whatever else is stored there is not read.
  for (const value of ['anything a reader typed', '/journey/how-bitcoin-works', 'bcrt1qexample', 'pass-it-on,no-balances']) {
    assert.equal(parseProgress(JSON.stringify({ v: 1, steps: { 'hold-some': { started: true, cameFor: value } } })).progress.steps['hold-some']?.cameFor, undefined, value);
  }
});

test('the start of a step\'s road: the step itself when no need sent the reader there, and else the step whose card they pressed', () => {
  // No memory: every step is the start of its own road, came from nowhere, and leads back to nothing.
  for (const id of STEPS) {
    for (const progress of [emptyProgress(), alone(id, { started: true }), alone(id, { started: true, doneAt: NOW })]) {
      assert.equal(roadStart(progress, id), id);
      assert.equal(ledBackTo(progress, id), null);
      assert.deepEqual([cameByCard(progress, id), cameFromChapter(progress, id)], [false, false]);
    }
    // By its card: from a chapter, with no step to lead back to.
    const byCard = alone(id, { started: true, from: CHAPTER_PAGES[id][0] });
    assert.deepEqual([cameByCard(byCard, id), cameFromChapter(byCard, id), ledBackTo(byCard, id), roadStart(byCard, id)], [true, true, null, id]);
    // A way back that is none is no card.
    assert.equal(cameByCard(alone(id, { started: true, from: '/newsletter' }), id), false);
  }

  // A road of two, for each of the seven pairs: the step the reader came for.
  for (const [to, cameFor] of NEED_PAIRS) {
    const progress = note({ [to]: started(0, { cameFor }), [cameFor]: started(0, { from: CHAPTER_PAGES[cameFor][0] }) }, to);
    assert.equal(ledBackTo(progress, to), cameFor);
    assert.equal(roadStart(progress, to), cameFor);
    assert.deepEqual([cameByCard(progress, to), cameFromChapter(progress, to)], [false, true], `${to}: by a need, not by its card`);
    assert.equal(roadStart(progress, cameFor), cameFor);
    // With a way back of its own beside the memory: by card too, and still led back.
    const both = note({ [to]: started(0, { from: CHAPTER_PAGES[to][1], cameFor }), [cameFor]: started(0, { from: CHAPTER_PAGES[cameFor][0] }) }, to);
    assert.deepEqual([cameByCard(both, to), cameFromChapter(both, to), ledBackTo(both, to), roadStart(both, to)], [true, true, cameFor, cameFor]);
  }

  // A road of three: the step whose card the reader pressed, from each step on it.
  const three = note({
    'hold-some': started(1, { cameFor: 'pass-it-on' }),
    'pass-it-on': started(0, { cameFor: 'no-balances' }),
    'no-balances': started(0, { from: '/journey/how-bitcoin-works' }),
  });
  assert.deepEqual((['hold-some', 'pass-it-on', 'no-balances'] as const).map((id) => roadStart(three, id)), ['no-balances', 'no-balances', 'no-balances']);
  assert.deepEqual((['hold-some', 'pass-it-on', 'no-balances'] as const).map((id) => ledBackTo(three, id)), ['pass-it-on', 'no-balances', null]);

  // A memory that names a done step is not followed. A note read from storage never holds one; a note handed
  // in from anywhere else is held to the same rule when a link or a button is built from it.
  const over: Progress = { v: 1, following: null, steps: { 'hold-some': { started: true, cameFor: 'pass-it-on' }, 'pass-it-on': { started: true, doneAt: NOW, from: '/journey/how-bitcoin-works' } } };
  assert.deepEqual([ledBackTo(over, 'hold-some'), roadStart(over, 'hold-some'), cameFromChapter(over, 'hold-some')], [null, 'hold-some', false]);
  // The middle of a road done by another way: the road starts one step short of it.
  const short: Progress = { v: 1, following: null, steps: { ...three.steps, 'no-balances': { started: true, doneAt: NOW, from: '/journey/how-bitcoin-works' } } };
  assert.deepEqual([roadStart(short, 'hold-some'), roadStart(short, 'pass-it-on')], ['pass-it-on', 'pass-it-on']);
  // And one that names the step itself, or what is no step, is none.
  for (const value of ['hold-some', 'first-payment', '', 7, null]) {
    const odd = { v: 1, following: null, steps: { 'hold-some': { started: true, cameFor: value } } } as unknown as Progress;
    assert.deepEqual([ledBackTo(odd, 'hold-some'), roadStart(odd, 'hold-some')], [null, 'hold-some'], String(value));
  }

  // A ring of three, made by hand (this page writes none: a press is remembered only on a road that began at
  // a card). The walk ends, and each step of the ring gets a step of the ring.
  const ring: Progress = {
    v: 1,
    following: null,
    steps: { 'hold-some': { started: true, cameFor: 'pass-it-on' }, 'pass-it-on': { started: true, cameFor: 'no-balances' }, 'no-balances': { started: true, cameFor: 'hold-some' } },
  };
  assert.deepEqual((['hold-some', 'pass-it-on', 'no-balances'] as const).map((id) => roadStart(ring, id)), ['no-balances', 'hold-some', 'pass-it-on']);
  // A ring of two, and a ring of all six.
  const pair: Progress = { v: 1, following: null, steps: { 'the-seed': { started: true, cameFor: 'prove-the-backup' }, 'prove-the-backup': { started: true, cameFor: 'the-seed' } } };
  assert.deepEqual([roadStart(pair, 'the-seed'), roadStart(pair, 'prove-the-backup')], ['prove-the-backup', 'the-seed']);
  const all: Progress = { v: 1, following: null, steps: Object.fromEntries(STEPS.map((id, at) => [id, { started: true, cameFor: STEPS[(at + 1) % STEPS.length] }])) };
  for (const [at, id] of STEPS.entries()) assert.equal(roadStart(all, id), STEPS[(at + STEPS.length - 1) % STEPS.length], id);
});

test('the link back leads to the page the reader left: during a detour to the card they pressed, and a done step is marked wherever that page holds its card', () => {
  const chapterOf = (id: StepId): number => STEP_DEFS[id].chapter.number;

  for (const [to, cameFor] of NEED_PAIRS) {
    const sameChapter = chapterOf(to) === chapterOf(cameFor);
    for (const lang of LANGS) {
      const own = CHAPTER_PAGES[cameFor][lang === 'en' ? 0 : 1];
      // The page the road began on: the one the reader came from, or with no way back noted (a note made by
      // hand: this page remembers a press only on a road from a chapter) that step's chapter in the page's language.
      for (const from of [undefined, ...CHAPTER_PAGES[cameFor]]) {
        const page = from ?? own;
        const sender: StepNote = from === undefined ? { started: true } : { started: true, from };
        const what = `${to} from ${cameFor}, ${lang}, ${String(from)}`;

        // In a detour, not done: the card the reader pressed. The step they came for leads there too.
        const under: Progress = { v: 1, following: to, followedAt: NOW, steps: { [to]: { started: true, cameFor }, [cameFor]: sender } };
        assert.equal(chapterLink(SITE, to, lang, under), `${SITE}${page}#do-${cameFor}`, what);
        assert.equal(chapterLink(SITE, cameFor, lang, under), `${SITE}${page}#do-${cameFor}`, what);
        // The same while the step has not been opened yet: the press alone is enough.
        const pressed: Progress = { v: 1, following: cameFor, followedAt: NOW, steps: { [to]: { cameFor }, [cameFor]: sender } };
        assert.equal(chapterLink(SITE, to, lang, pressed), `${SITE}${page}#do-${cameFor}`, what);

        // In a detour, done. Where the reader's page holds this step's card too (both are steps of one chapter),
        // the ending marks it. Where it does not ("Hold some", sent from chapter 3 or 4), a done ending would
        // mark nothing there: the ending stays the card the reader pressed.
        const done: Progress = { v: 1, following: null, steps: { [to]: { started: true, doneAt: NOW, cameFor }, [cameFor]: sender } };
        assert.equal(chapterLink(SITE, to, lang, done), sameChapter ? `${SITE}${page}#done=${to}` : `${SITE}${page}#do-${cameFor}`, what);
        // And the step the reader came for is not done: its own link is its card.
        assert.equal(chapterLink(SITE, cameFor, lang, done), `${SITE}${page}#do-${cameFor}`, what);

        // With a way back of the step's own beside the memory (its card was pressed on an earlier day): the
        // detour is the later road, and the link never leads to the step's own chapter while it lasts.
        for (const ownFrom of CHAPTER_PAGES[to]) {
          for (const doneAt of [undefined, NOW]) {
            const mixed: Progress = {
              v: 1,
              following: null,
              steps: { [to]: doneAt === undefined ? { started: true, from: ownFrom, cameFor } : { started: true, doneAt, from: ownFrom, cameFor }, [cameFor]: sender },
            };
            const link = chapterLink(SITE, to, lang, mixed) ?? '';
            assert.equal(link, doneAt !== undefined && sameChapter ? `${SITE}${page}#done=${to}` : `${SITE}${page}#do-${cameFor}`, `${what}, own ${ownFrom}`);
            assert.ok(CHAPTER_PAGES[cameFor].includes(new URL(link).pathname), `${what}: the page is one of the two the reader's step belongs to`);
            if (!sameChapter) assert.ok(!CHAPTER_PAGES[to].includes(new URL(link).pathname), `${what}: ${link} names the chapter of the step the reader was sent to`);
          }
        }

        // The detour is over once the step the reader came for is done. From then on the step that was the
        // detour is a done step like any other: its own chapter, and its own done ending.
        const sent = from === undefined ? started(STEP_DEFS[cameFor].parts.length - 1) : started(STEP_DEFS[cameFor].parts.length - 1, { from });
        const before: Progress = { v: 1, following: cameFor, followedAt: NOW, steps: { [to]: { started: true, doneAt: NOW, cameFor }, [cameFor]: sent } };
        const after = applyChange(before, tick(cameFor, STEP_DEFS[cameFor].parts.length, NOW + 1));
        assert.equal(after.steps[cameFor]?.doneAt, NOW + 1, what);
        assert.equal(after.steps[to]?.cameFor, undefined, what);
        const ownPage = CHAPTER_PAGES[to][lang === 'en' ? 0 : 1];
        assert.equal(chapterLink(SITE, to, lang, after), sameChapter ? `${SITE}${ownPage}#done=${to},${cameFor}` : `${SITE}${ownPage}#done=${to}`, what);
        assert.equal(chapterLink(SITE, cameFor, lang, after), sameChapter ? `${SITE}${page}#done=${cameFor},${to}` : `${SITE}${page}#done=${cameFor}`, what);
      }
    }
  }

  // A done step in a detour inside one chapter names the other done steps of that chapter after itself.
  const inside: Progress = {
    v: 1,
    following: null,
    steps: {
      'pass-it-on': { started: true, doneAt: NOW, cameFor: 'no-balances' },
      'no-balances': { started: true, from: '/es/recorrido/como-funciona-bitcoin' },
      'waiting-room': { started: true, doneAt: NOW - 5 },
      'hold-some': { started: true, doneAt: NOW - 9 },
    },
  };
  assert.equal(chapterLink(SITE, 'pass-it-on', 'en', inside), `${SITE}/es/recorrido/como-funciona-bitcoin#done=pass-it-on,waiting-room`);

  // A road of three, walked as the app writes it. No wallet has sent anything, and it holds no coins: the
  // reader presses the card of "There are no balances", is sent to "Pass it on", and from there to "Hold some".
  let road = applyChange(emptyProgress(), open('no-balances', NOW, '/journey/how-bitcoin-works'));
  road = applyChange(road, detour('pass-it-on', 'no-balances'));
  road = applyChange(road, open('pass-it-on', NOW + 1));
  road = applyChange(road, detour('hold-some', 'pass-it-on'));
  road = applyChange(road, open('hold-some', NOW + 2));
  const card = `${SITE}/journey/how-bitcoin-works#do-no-balances`;
  for (const lang of LANGS) {
    // On all three steps, in either language of the wallet: the card the reader pressed.
    for (const id of ['hold-some', 'pass-it-on', 'no-balances'] as const) assert.equal(chapterLink(SITE, id, lang, road), card, `${id}, ${lang}`);
  }
  // "Hold some" done: it leads back to "Pass it on" first, and its link back still to the card.
  for (const part of [1, 2, 3, 4]) road = applyChange(road, tick('hold-some', part, NOW + 3));
  assert.deepEqual([ledBackTo(road, 'hold-some'), chapterLink(SITE, 'hold-some', 'en', road)], ['pass-it-on', card]);
  // "Pass it on" done: it leads back to "There are no balances" first, and is marked on the same page. The
  // done "Hold some" is in no detour any more: chapter 2, and its own ending.
  for (const part of [1, 2, 3]) road = applyChange(road, tick('pass-it-on', part, NOW + 4, part === 2 ? { tx: TX, sentAt: NOW + 4 } : {}));
  assert.equal(ledBackTo(road, 'pass-it-on'), 'no-balances');
  assert.equal(chapterLink(SITE, 'pass-it-on', 'en', road), `${SITE}/journey/how-bitcoin-works#done=pass-it-on`);
  assert.deepEqual([ledBackTo(road, 'hold-some'), road.steps['hold-some']?.cameFor], [null, undefined]);
  assert.equal(chapterLink(SITE, 'hold-some', 'es', road), `${SITE}/es/recorrido/que-es-bitcoin-en-realidad#done=hold-some`);
  // "There are no balances" done: both steps of chapter 3 are named, the one being left first.
  for (const part of [1, 2, 3]) road = applyChange(road, tick('no-balances', part, NOW + 5));
  assert.equal(chapterLink(SITE, 'no-balances', 'es', road), `${SITE}/journey/how-bitcoin-works#done=no-balances,pass-it-on`);
  assert.equal(chapterLink(SITE, 'pass-it-on', 'es', road), `${SITE}/es/recorrido/como-funciona-bitcoin#done=pass-it-on,no-balances`);
  assert.doesNotMatch(JSON.stringify(road), /cameFor/);

  // Over notes of every kind, also ones that no page writes (a small generator with a fixed start, so that a
  // failure can be found again): every link is one of the 46, its page is one of the two pages of the chapter
  // the road began in, and a done ending names this step first and then only done steps of that same chapter.
  let seed = 46;
  const next = (below: number): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) % below;
  };
  const every = new Set(EVERY_LINK);
  const met = new Set<string>();
  for (let round = 0; round < 2000; round++) {
    const steps: Record<string, Record<string, unknown>> = {};
    for (const id of STEPS) {
      const kind = next(4);
      if (kind === 0) continue;
      const step: Record<string, unknown> = kind === 1 ? {} : { started: true };
      if (kind === 3) step.doneAt = NOW;
      const from = next(4);
      if (from === 1) step.from = CHAPTER_PAGES[id][0];
      if (from === 2) step.from = CHAPTER_PAGES[id][1];
      if (from === 3) step.from = ALL_PAGES[next(ALL_PAGES.length)];
      const names = next(8);
      if (names < STEPS.length) step.cameFor = STEPS[names];
      if (names === 6) step.cameFor = 'first-payment';
      if (Object.keys(step).length > 0) steps[id] = step;
    }
    // Once as it was made (a note handed in from anywhere), and once as a read would hand it on.
    const made = { v: 1, following: null, steps } as unknown as Progress;
    for (const progress of [made, parseProgress(JSON.stringify(made)).progress]) {
      for (const id of STEPS) {
        const start = roadStart(progress, id);
        for (const lang of LANGS) {
          const link = chapterLink(SITE, id, lang, progress) ?? '';
          assert.ok(every.has(link), `${link} for ${id} in ${JSON.stringify(progress.steps)}`);
          met.add(link);
          const hash = link.slice(link.indexOf('#'));
          const path = link.slice(SITE.length, link.indexOf('#'));
          assert.ok(CHAPTER_PAGES[start].includes(path), `${link}: not a page of the chapter the road began in (${start})`);
          if (hash.startsWith('#done=')) {
            const ids = hash.slice('#done='.length).split(',') as StepId[];
            assert.equal(ids[0], id, link);
            for (const each of ids) assert.ok(progress.steps[each]?.doneAt !== undefined && chapterOf(each) === chapterOf(start), `${link}: ${each}`);
          } else {
            assert.equal(hash, `#do-${start}`, link);
            // A plain ending for a done step only where the page it leads to cannot hold that step's card.
            if (progress.steps[id]?.doneAt !== undefined) assert.notEqual(chapterOf(id), chapterOf(start), link);
          }
        }
      }
    }
  }
  // And the walk met every one of the 46 on its way.
  assert.deepEqual([...met].sort(), [...EVERY_LINK].sort());
});

test('a done ending names the step being left first, then the other done steps of its chapter in the contract\'s order', () => {
  const chapterOf = (id: StepId): number => STEP_DEFS[id].chapter.number;
  const endings = new Set<string>();
  // Each of the 64 sets of done steps, and each step of the six.
  for (let bits = 0; bits < 1 << STEPS.length; bits++) {
    const progress: Progress = { v: 1, following: null, steps: {} };
    for (const [at, id] of STEPS.entries()) if ((bits >> at) & 1) progress.steps[id] = { started: true, doneAt: NOW };
    for (const id of STEPS) {
      const link = chapterLink(SITE, id, 'en', progress) ?? '';
      const ending = link.slice(link.indexOf('#'));
      // A step that is not done names its card, whatever else is done.
      if (progress.steps[id] === undefined) {
        assert.equal(ending, `#do-${id}`);
        continue;
      }
      assert.ok(DONE_ENDINGS[id].includes(ending), `${ending} is not one of the endings of ${id}`);
      // As the main site reads it: the pattern, and the two limits.
      assert.match(ending, MAIN_SITE_DONE);
      assert.ok(ending.length <= DONE_LONGEST, ending);
      const ids = ending.slice('#done='.length).split(',') as StepId[];
      assert.ok(ids.length <= DONE_MOST, ending);
      assert.deepEqual(ids, doneWith(progress, id));
      assert.equal(ids[0], id, 'the step being left comes first: the main site brings the first card named into view');
      assert.equal(new Set(ids).size, ids.length, `${ending}: no step twice`);
      for (const each of ids) {
        assert.ok(progress.steps[each]?.doneAt !== undefined, `${ending}: ${each} is not done`);
        assert.equal(chapterOf(each), chapterOf(id), `${ending}: ${each} is a step of another chapter`);
      }
      // Every done step of the chapter is named, and the ones after the first stand in the contract's order.
      const others = STEPS.filter((each) => each !== id && chapterOf(each) === chapterOf(id) && progress.steps[each] !== undefined);
      assert.deepEqual(ids.slice(1), others, ending);
      endings.add(ending);
    }
  }
  // The rule gives these 17 endings, and no other.
  assert.deepEqual([...endings].sort(), Object.values(DONE_ENDINGS).flat().sort());
  assert.equal(endings.size, 17);
  assert.equal(Math.max(...[...endings].map((ending) => ending.length)), 41, 'the longest of them');
  assert.equal(Math.max(...[...endings].map((ending) => ending.split(',').length)), 3, 'three steps to a chapter at the most');
  // Three steps of chapter 3 done by "Next step", and the link back taken from the second of them: all three
  // are named, and the one being left first.
  const three = note({ 'pass-it-on': started(3, { doneAt: NOW }), 'no-balances': started(3, { doneAt: NOW + 1 }), 'waiting-room': started(3, { doneAt: NOW + 2 }) });
  assert.equal(chapterLink(SITE, 'no-balances', 'en', three), `${SITE}/journey/how-bitcoin-works#done=no-balances,pass-it-on,waiting-room`);
  assert.deepEqual(doneWith(three, 'waiting-room'), ['waiting-room', 'pass-it-on', 'no-balances']);
  // A step of another chapter that is done is never named.
  assert.deepEqual(doneWith(note({ 'hold-some': started(4, { doneAt: NOW }), 'the-seed': started(3, { doneAt: NOW }) }), 'the-seed'), ['the-seed']);
});

test('the two limits of an ending: at most six steps, and at most 200 characters, with the first always kept', () => {
  assert.deepEqual([DONE_MOST, DONE_LONGEST], [6, 200]);
  // Six of nine: the first six, in their order.
  const nine = Array.from({ length: 9 }, (_, at) => `step-${at}`);
  assert.deepEqual(endingIds(nine), nine.slice(0, 6));
  assert.deepEqual(endingIds(nine.slice(0, 6)), nine.slice(0, 6));
  assert.deepEqual(endingIds(nine.slice(0, 2)), nine.slice(0, 2));
  assert.deepEqual(endingIds([]), []);
  // Six IDs of 32 characters would make 203 characters with "#done=" and their commas: five stay, which make 170.
  const long = Array.from({ length: 6 }, (_, at) => `${'x'.repeat(31)}${at}`);
  assert.equal(`#done=${long.join(',')}`.length, 203);
  assert.deepEqual(endingIds(long), long.slice(0, 5));
  assert.equal(`#done=${endingIds(long).join(',')}`.length, 170);
  // Just within: six IDs that make exactly 200 characters all stay, and one character more costs the last of them.
  const fits = [...Array.from({ length: 5 }, (_, at) => `${'y'.repeat(30)}${at}`), 'z'.repeat(34)];
  assert.equal(`#done=${fits.join(',')}`.length, 200);
  assert.deepEqual(endingIds(fits), fits);
  assert.deepEqual(endingIds([...fits.slice(0, 5), 'z'.repeat(35)]), fits.slice(0, 5));
  // The first always stays, however long it is: it is the step being left.
  assert.deepEqual(endingIds(['x'.repeat(300)]), ['x'.repeat(300)]);
  assert.deepEqual(endingIds(['x'.repeat(300), 'short']), ['x'.repeat(300)]);
  // It never changes the list it is handed.
  const handed = frozen([...nine]);
  endingIds(handed);
  assert.deepEqual(handed, nine);
  // Today's IDs reach neither limit: six of the contract's longest make 107 characters.
  const widest = Math.max(...STEPS.map((id) => id.length));
  assert.equal(widest, 16);
  assert.equal('#done='.length + 6 * widest + 5, 107);
});

// -- the result of a payment ---------------------------------------------------------------------

test('the step that a payment\'s result leads back to: the followed step, once its payment part is ticked', () => {
  // The two steps with a part that sends a payment, and the part's number.
  assert.deepEqual(
    STEPS.map((id) => [id, sendPart(id)]),
    [
      ['hold-some', null],
      ['pass-it-on', 2],
      ['no-balances', null],
      ['waiting-room', 1],
      ['the-seed', null],
      ['prove-the-backup', null],
    ],
  );
  // The payment part is ticked: the followed step.
  const paid = note({ 'pass-it-on': started(2, { tx: TX, sentAt: NOW - 5_000 }) }, 'pass-it-on');
  assert.equal(paidStep(paid, NOW), 'pass-it-on');
  assert.equal(paidStep(note({ 'waiting-room': started(1, { tx: TX, sentAt: NOW }) }, 'waiting-room'), NOW), 'waiting-room');
  // Also once the step is done, while it is still followed: the payment's block can come on that very screen.
  const done = applyChange(paid, tick('pass-it-on', 3, NOW));
  assert.ok(done.steps['pass-it-on']?.doneAt !== undefined && done.following === 'pass-it-on');
  assert.equal(paidStep(done, NOW), 'pass-it-on');
  // And after "Send another", when the note holds no payment: the part is ticked all the same.
  assert.equal(paidStep(applyChange(paid, { kind: 'send-another', step: 'pass-it-on' }), NOW), 'pass-it-on');

  // The part is not ticked yet: null, until the tick is written.
  const before = note({ 'pass-it-on': started(1) }, 'pass-it-on');
  assert.equal(paidStep(before, NOW), null);
  assert.equal(paidStep(applyChange(before, tick('pass-it-on', 2, NOW, { tx: TX, sentAt: NOW })), NOW), 'pass-it-on');
  assert.equal(paidStep(note({ 'waiting-room': started(0) }, 'waiting-room'), NOW), null);
  // A followed step that takes no payment: a payment is not that step's part.
  for (const id of ['hold-some', 'no-balances', 'the-seed', 'prove-the-backup'] as const) {
    assert.equal(paidStep(note({ [id]: started(STEP_DEFS[id].parts.length - 1) }, id), NOW), null, id);
  }
  // A step with a ticked payment part that is not the one followed.
  assert.equal(paidStep(note({ 'pass-it-on': started(2), 'the-seed': started(1) }, 'the-seed'), NOW), null);
  // Nothing followed, and a step followed more than 24 hours ago (it gets no strip either).
  assert.equal(paidStep(note({ 'pass-it-on': started(2) }), NOW), null);
  assert.equal(paidStep(emptyProgress(), NOW), null);
  assert.equal(paidStep(paid, NOW - 10_000 + STRIP_MS - 1), 'pass-it-on');
  assert.equal(paidStep(paid, NOW - 10_000 + STRIP_MS), null);
});

// -- what the wallet is told -------------------------------------------------------------------

test('the wallet is told the screen the address names, and a done step\'s screen as the list of steps', () => {
  const progress: Progress = { v: 1, following: null, steps: { 'waiting-room': started(1), 'pass-it-on': { ...started(3), doneAt: NOW } } };
  // A step under way reads the chain: its parts are ticked from it.
  assert.equal(watchedScreen({ name: 'step', id: 'waiting-room' }, progress), 'step');
  // A step never opened is about to be started by its own screen.
  assert.equal(watchedScreen({ name: 'step', id: 'hold-some' }, progress), 'step');
  // A done one has nothing left to tick: nothing is read for it, as for the list.
  assert.equal(watchedScreen({ name: 'step', id: 'pass-it-on' }, progress), 'do');
  assert.equal(readsCoins('do') || readsTransactions('do'), false);
  assert.equal(readsCoins('step') && readsTransactions('step'), true);
  // Every other screen is itself.
  assert.equal(watchedScreen({ name: 'wallet' }, progress), 'wallet');
  assert.equal(watchedScreen({ name: 'tx', txid: 'ab'.repeat(32) }, progress), 'tx');
  assert.equal(watchedScreen({ name: 'do' }, progress), 'do');
  assert.equal(watchedScreen({ name: 'home' }, emptyProgress()), 'home');
});

// -- the strip --------------------------------------------------------------------------------

test('the strip shows the followed step for 24 hours after it was last followed', () => {
  assert.equal(STRIP_MS, 24 * 60 * 60 * 1000);
  const followed: Progress = { v: 1, following: 'waiting-room', followedAt: NOW, steps: { 'waiting-room': started(1) } };
  assert.equal(stripStep(followed, NOW), 'waiting-room');
  assert.equal(stripStep(followed, NOW + STRIP_MS - 1), 'waiting-room');
  assert.equal(stripStep(followed, NOW + STRIP_MS), null);
  assert.equal(stripStep(followed, NOW + 10 * STRIP_MS), null);
  // The note still says which step it was: an event still counts for it.
  assert.equal(followed.following, 'waiting-room');
  // Nothing followed, or no time to count from.
  assert.equal(stripStep(emptyProgress(), NOW), null);
  assert.equal(stripStep({ v: 1, following: 'waiting-room', steps: {} }, NOW), null);
  // A note that follows a step it does not hold as started (edited by hand: this page never writes one) gets no strip.
  assert.equal(stripStep({ v: 1, following: 'hold-some', followedAt: NOW, steps: {} }, NOW), null);
  assert.equal(stripStep({ v: 1, following: 'hold-some', followedAt: NOW, steps: { 'hold-some': { from: '/journey/what-bitcoin-actually-is' }, 'waiting-room': started(1) } }, NOW), null);
  // A done step is a started one: its strip stays, to say that it is done.
  assert.equal(stripStep({ v: 1, following: 'hold-some', followedAt: NOW, steps: { 'hold-some': { ...started(4), doneAt: NOW } } }, NOW), 'hold-some');
  // A tick of the followed step counts as following it: the day starts again.
  const ticked = applyChange(followed, tick('waiting-room', 2, NOW + STRIP_MS - 1));
  assert.equal(stripStep(ticked, NOW + STRIP_MS + 5), 'waiting-room');
});
