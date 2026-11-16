// The "Do it" note in the browser's storage (src/lib/doit/progress.ts):
// what is read of it and what is not, the one function that writes, what a
// change may and may not do to what is already written, forgetting, and the
// way back to the chapter.
//
// "Another tab" is a second caller on the same storage, or a write made
// behind this one's back, as in the tests of the wallet's key store.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGS, STEPS, type StepId } from '@learnbitcoin/practice-contract';
import {
  PROGRESS_KEY,
  STRIP_MS,
  applyChange,
  chapterLink,
  emptyProgress,
  forgetProgress,
  fromOfSearch,
  parseProgress,
  readProgress,
  restartStep,
  stripStep,
  validFrom,
  watchedScreen,
  writeProgress,
  type Change,
  type Progress,
  type StepNote,
} from '../src/lib/doit/progress.ts';
import { readsCoins, readsTransactions } from '../src/lib/router.ts';
import { STEP_DEFS, partCount } from '../src/lib/doit/steps.ts';
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
      'pass-it-on': { started: true, tx: TX, sentAt: NOW - 3, parts: ticks(1, 2) },
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
  const good: StepNote = { started: true, doneAt: NOW, from: '/journey/how-bitcoin-works', wallet: FP, was: 'words', tx: TX, sentAt: NOW - 9, parts: ticks(1, 2, 3) };
  const bad: Record<keyof StepNote, unknown[]> = {
    started: [false, 1, 'true', null, {}],
    doneAt: [-1, 1.5, '1800000000000', null, Number.MAX_SAFE_INTEGER, 8_640_000_000_000_001, {}],
    from: ['journey/x', '//evil.example/x', 'https://evil.example', '/Journey', '/a b', `/${'a'.repeat(200)}`, 7, null, ''],
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
  for (const change of [tick('hold-some', 1), { kind: 'stop', step: 'hold-some' }, { kind: 'follow', step: 'hold-some', at: NOW }, { kind: 'send-another', step: 'pass-it-on' }] as Change[]) {
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
});

// -- what a change may do ------------------------------------------------------------------------

test('opening: started once, followed unless done, and the way back is the latest valid one', () => {
  let progress = applyChange(emptyProgress(), open('no-balances', NOW, '/journey/how-bitcoin-works'));
  assert.deepEqual(progress, { v: 1, following: 'no-balances', followedAt: NOW, steps: { 'no-balances': { started: true, from: '/journey/how-bitcoin-works' } } });
  // Opened again with no way back, or with one that is none: the earlier one stays.
  for (const from of [null, '//evil.example', 'https://evil.example/journey', '/Journey/X']) {
    progress = applyChange(progress, open('no-balances', NOW + 1, from));
    assert.equal(progress.steps['no-balances']?.from, '/journey/how-bitcoin-works', String(from));
  }
  // With another valid one: that one.
  progress = applyChange(progress, open('no-balances', NOW + 2, '/es/recorrido/como-funciona-bitcoin'));
  assert.equal(progress.steps['no-balances']?.from, '/es/recorrido/como-funciona-bitcoin');
  assert.equal(progress.followedAt, NOW + 2);

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
    changes.push(open(step, NOW, null), open(step, NOW, '/journey/x'), { kind: 'follow', step, at: NOW }, { kind: 'stop', step });
    changes.push({ kind: 'payment', step, tx: TX, sentAt: NOW }, { kind: 'send-another', step }, { kind: 'checked', step, wallet: OTHER_FP });
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
  write(storage, tick('hold-some', 4, NOW + 9));
  const text = stored(storage) ?? '';
  const value = JSON.parse(text) as { steps: Record<string, Record<string, unknown>> } & Record<string, unknown>;
  assert.deepEqual(Object.keys(value), ['v', 'following', 'followedAt', 'steps']);
  assert.deepEqual(Object.keys(value.steps), [...STEPS]);
  const listed = ['started', 'doneAt', 'from', 'wallet', 'was', 'tx', 'sentAt', 'parts'];
  for (const [id, step] of Object.entries(value.steps)) {
    for (const field of Object.keys(step)) assert.ok(listed.includes(field), `${id}.${field}`);
    // In one fixed order, so that two tabs that write the same note write the same text.
    assert.deepEqual(Object.keys(step), listed.filter((field) => field in step), id);
  }
  // Public things only: a fingerprint, an ID, paths, times and ticks. No address and no public key.
  assert.doesNotMatch(text, /bcrt1|tpub|tprv|mnemonic/);
});

// -- the way back -----------------------------------------------------------------------------

test('a way back counts only when it is a plain path of the main site', () => {
  const good = ['/', '/journey', '/journey/how-bitcoin-works', '/es/recorrido/como-funciona-bitcoin', '/a-b/c-d/0-9', '/journey/', `/${'a'.repeat(199)}`];
  for (const path of good) assert.equal(validFrom(path), path, path);
  const hostile: unknown[] = [
    // Another site, by every spelling a browser would follow there.
    '//evil.example',
    '//evil.example/journey/how-bitcoin-works',
    '/journey//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'https://evil.example/journey',
    'http://www.learnbitcoin.com/journey',
    'https://www.learnbitcoin.com/journey/how-bitcoin-works',
    '/journey@evil.example',
    '/.evil.example',
    '/journey/..',
    '/../etc',
    // A script, or data.
    'javascript:alert(1)',
    '/javascript:alert(1)',
    'data:text/html,x',
    // Not a path, or not a plain one.
    '',
    'journey/how-bitcoin-works',
    ' /journey',
    '/journey ',
    '/Journey',
    '/journey/How-Bitcoin-Works',
    '/journey/how_bitcoin_works',
    '/journey/how-bitcoin-works?x=1',
    '/journey/how-bitcoin-works#done=hold-some',
    '/journey/how-bitcoin-works.html',
    '/journey/%2e%2e',
    '/journey/%2F%2Fevil.example',
    '/journey\n/x',
    '/journey\t',
    '/journey\u0000',
    '/caf\u00e9',
    '/\u202ejourney',
    // Too long.
    `/${'a'.repeat(200)}`,
    `/${'a/'.repeat(150)}`,
    // Not a text at all.
    null,
    undefined,
    7,
    true,
    ['/journey'],
    { toString: () => '/journey' },
  ];
  for (const value of hostile) assert.equal(validFrom(value), null, JSON.stringify(value));
});

test('the way back in a step\'s address: the decoded value of the first "from", and nothing else', () => {
  assert.equal(fromOfSearch('?from=/journey/how-bitcoin-works'), '/journey/how-bitcoin-works');
  assert.equal(fromOfSearch('from=/journey/how-bitcoin-works'), '/journey/how-bitcoin-works');
  // As a browser writes it in a link: the slashes percent-encoded.
  assert.equal(fromOfSearch('?from=%2Fes%2Frecorrido%2Fse-tu-propio-banco'), '/es/recorrido/se-tu-propio-banco');
  assert.equal(fromOfSearch('?state=funded&from=%2Fjourney%2Fbe-your-own-bank&x=1'), '/journey/be-your-own-bank');
  // The first one decides: a good one after a bad one does not rescue it, and a bad one after a good one changes nothing.
  assert.equal(fromOfSearch('?from=//evil.example&from=/journey/how-bitcoin-works'), null);
  assert.equal(fromOfSearch('?from=/journey/how-bitcoin-works&from=//evil.example'), '/journey/how-bitcoin-works');
  const hostile = [
    '',
    '?',
    '?from',
    '?from=',
    '?From=/journey',
    '?from=//evil.example',
    '?from=%2F%2Fevil.example',
    '?from=https%3A%2F%2Fevil.example',
    '?from=https://evil.example',
    '?from=javascript%3Aalert(1)',
    '?from=/journey/%252e%252e',
    '?from=%2Fjourney%2F..%2F..',
    // A plus sign is a space once decoded.
    '?from=/journey+x',
    '?from=/journey%20x',
    '?from=/journey%0a',
    '?from=%',
    '?from=%E0%A4%A',
    '?from[]=/journey',
    '?from=/journey?x=1',
    '?from=/journey%23done%3Dhold-some',
  ];
  for (const search of hostile) assert.equal(fromOfSearch(search), null, search);
});

test('"Back to the chapter": the card until the step is done, the stamp once it is', () => {
  for (const id of STEPS) {
    for (const lang of LANGS) {
      const own = STEP_DEFS[id].chapter.path[lang];
      // No way back was given: the step's own chapter, in the language of the page.
      assert.equal(chapterLink(SITE, id, lang, undefined), `${SITE}${own}#do-${id}`);
      assert.equal(chapterLink(SITE, id, lang, { started: true }), `${SITE}${own}#do-${id}`);
      assert.equal(chapterLink(SITE, id, lang, started(1)), `${SITE}${own}#do-${id}`, 'under way is not done');
      assert.equal(chapterLink(SITE, id, lang, { started: true, doneAt: NOW }), `${SITE}${own}#done=${id}`);
      // The page the reader came from, in both states.
      const from = '/journey/how-bitcoin-works';
      assert.equal(chapterLink(SITE, id, lang, { started: true, from }), `${SITE}${from}#do-${id}`);
      assert.equal(chapterLink(SITE, id, lang, { started: true, from, doneAt: NOW }), `${SITE}${from}#done=${id}`);
    }
  }
  // The rule is applied again when the link is built: a note that was written by hand does not get to choose the address.
  for (const from of ['//evil.example/x', 'https://evil.example', '/journey/../..', '/Journey', 'javascript:alert(1)']) {
    const link = chapterLink(SITE, 'the-seed', 'en', { started: true, from, doneAt: NOW });
    assert.equal(link, `${SITE}/journey/be-your-own-bank#done=the-seed`, from);
  }
  // The settings' address with a slash at its end, or with a path: still the main site.
  assert.equal(chapterLink(`${SITE}/`, 'hold-some', 'es', undefined), `${SITE}/es/recorrido/que-es-bitcoin-en-realidad#do-hold-some`);
  assert.equal(chapterLink('http://localhost:4321', 'hold-some', 'en', undefined), 'http://localhost:4321/journey/what-bitcoin-actually-is#do-hold-some');
  // Every link that comes out is on the main site's origin.
  for (const id of STEPS) {
    const link = chapterLink(SITE, id, 'en', { started: true, from: '/a/b', doneAt: NOW });
    assert.equal(new URL(link ?? '').origin, new URL(SITE).origin);
    assert.equal(new URL(link ?? '').hash, `#done=${id}`);
  }
  // Settings that name no web address give no link at all.
  for (const site of ['', 'not a url', 'javascript:alert(1)//', 'data:text/html,x', 'file:///etc', 'mailto:a@b.example', '//www.learnbitcoin.com']) {
    assert.equal(chapterLink(site, 'hold-some', 'en', { started: true, from: '/journey/x' }), null, site);
  }
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
  assert.equal(stripStep({ v: 1, following: 'hold-some', followedAt: NOW, steps: { 'hold-some': { from: '/journey/x' }, 'waiting-room': started(1) } }, NOW), null);
  // A done step is a started one: its strip stays, to say that it is done.
  assert.equal(stripStep({ v: 1, following: 'hold-some', followedAt: NOW, steps: { 'hold-some': { ...started(4), doneAt: NOW } } }, NOW), 'hold-some');
  // A tick of the followed step counts as following it: the day starts again.
  const ticked = applyChange(followed, tick('waiting-room', 2, NOW + STRIP_MS - 1));
  assert.equal(stripStep(ticked, NOW + STRIP_MS + 5), 'waiting-room');
});
