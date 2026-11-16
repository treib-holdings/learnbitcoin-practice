// The pot's counts: one answer of the origin's for all the readers that one
// isolate of the Worker serves (src/pot-stats.ts).
//
// While it is switched on, GET /api/pot/stats is open to anybody, and what
// an answer costs the practice network can grow with something a stranger
// controls. So the Worker must not ask the origin once per request. Every
// test here goes through the real handler, by the route's own door, with
// the counts switched on, an origin that counts how often it is asked and
// a clock the test moves by hand. One handler over one holder is one
// isolate: "every reader" in a test's name is every reader of that isolate.
//
// Most of them fail against a handler that asks for every request. The
// tests of the clock hold the rule to its limits: they fail when counts
// are kept longer than they should be, when a failure or a question that
// is dated later than now is waited out, and when the origin is asked
// again before the pause after a failure is over.
//
// (What the route does while it is switched off is in handler.test.ts and
// index.test.ts: it is not there.)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API, ERROR_STATUS } from '@learnbitcoin/practice-contract';
import type { PotStats } from '@learnbitcoin/practice-contract';
import type { Fault, Handler, Limiter, OriginAnswer, PotStatsHolder } from '../src/deps.ts';
import { makeHandler } from '../src/handler.ts';
import { FIXED_HEADERS } from '../src/headers.ts';
import { ORIGIN_TIMEOUT_MS } from '../src/origin.ts';
import {
  POT_STATS_KEEP_MS,
  POT_STATS_LOOK_FIRST_MS,
  POT_STATS_LOOK_MAX_MS,
  POT_STATS_PAUSE_MS,
  POT_STATS_WAIT_MS,
  makePotStatsHolder,
} from '../src/pot-stats.ts';
import { readerKey } from '../src/reader-key.ts';
import { ADDRESS, APP, POT_COUNTS, TXID, errorOf, get, harness, noNetwork, post } from './fakes.ts';
import type { Harness } from './fakes.ts';

noNetwork();

/** Where the clock stands when a test begins. */
const T0 = 1_800_000_000_000;

/** A good answer of the origin's. */
const good = (stats: PotStats = POT_COUNTS): OriginAnswer<PotStats> => ({ ok: true, value: { ...stats }, upstream: 200 });
/** The counts with `passedOn` set, so that one answer can be told from the next. */
const counts = (passedOn: number): PotStats => ({ passedOn, waiting: 3, handedOn: 9 });
/** An answer that failed, as origin.ts reports one. */
const failed = (upstream: number | null, fault: Fault): OriginAnswer<PotStats> => ({ ok: false, code: 'unavailable', detail: null, upstream, fault });

/** One question the origin was asked, for the test to answer when it chooses. */
interface Question {
  answer(result: OriginAnswer<PotStats>): void;
  /** The question itself breaks: a mistake of ours, not an answer. */
  break(error: Error): void;
}

interface World {
  h: Harness;
  handler: Handler;
  /** The Worker's clock. It stands still until the test moves it. */
  clock: { ms: number };
  /** Every question the origin has been asked, in order. */
  questions: Question[];
  /** Answers every question at once from now on, with what `next` gives. */
  answerAtOnce(next: () => OriginAnswer<PotStats>): void;
  /** Leaves every question open from now on, for the test to answer. */
  holdAnswers(): void;
}

/**
 * A Worker that has just been started: nothing kept, an origin that answers
 * when the test lets it, and a clock that stands still at T0.
 */
function world(): World {
  const clock = { ms: T0 };
  const questions: Question[] = [];
  let atOnce: (() => OriginAnswer<PotStats>) | null = null;
  const h = harness({
    now: () => clock.ms,
    potStats: () =>
      new Promise<OriginAnswer<PotStats>>((resolve, reject) => {
        questions.push({ answer: resolve, break: reject });
        if (atOnce !== null) resolve(atOnce());
      }),
  });
  return {
    h,
    handler: makeHandler(h.deps),
    clock,
    questions,
    answerAtOnce: (next) => {
      atOnce = next;
    },
    holdAnswers: () => {
      atOnce = null;
    },
  };
}

/** A reader's address, from the ranges set aside for documentation: a different reader for each number. */
const reader = (n: number): string => (n < 250 ? `198.51.100.${n + 1}` : `2001:db8:${n.toString(16)}::1`);

/** A look at the counts by reader number `n`. */
const look = (n = 0, headers: Record<string, string> = {}): Request => get(API.potStats, { 'CF-Connecting-IP': reader(n), ...headers });

/** One turn of the event loop. (Never a timer: one test here takes the timers away.) */
const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Waits until the pot's limiter has been asked `total` times in all. A
 * request that has passed the limiter has by then gone as far as it can
 * without an answer: it has asked the origin, or it waits for the question
 * that is out.
 */
async function arrived(h: Harness, total: number): Promise<void> {
  for (let turns = 0; h.limiters.pot.keys.length < total; turns += 1) {
    assert.ok(turns < 10_000, `only ${h.limiters.pot.keys.length} of ${total} requests reached the limiter`);
    await turn();
  }
  await turn();
}

/** The status and the body of an answer. */
async function read(response: Response): Promise<[status: number, body: unknown]> {
  return [response.status, await response.json()];
}

/** How often the origin was asked, by the handler's own record of what it asked the outside. */
const originAsked = (h: Harness): number => h.trace.filter((step) => step === 'origin:potStats').length;

/** A holder with nothing in it: no counts, no question, no failure. */
const EMPTY: PotStatsHolder = { kept: null, asking: null, failed: null };

/** What a holder holds, by name. It holds one thing at a time, or nothing (deps.ts). */
function holds(holder: PotStatsHolder): 'counts' | 'question' | 'failure' | 'nothing' {
  const there = [holder.kept !== null ? 'counts' : null, holder.asking !== null ? 'question' : null, holder.failed !== null ? 'failure' : null].filter(
    (name) => name !== null,
  );
  assert.ok(there.length <= 1, `the holder holds more than one thing: ${JSON.stringify(holder)}`);
  return (there[0] ?? 'nothing') as 'counts' | 'question' | 'failure' | 'nothing';
}

/** The line a request writes when it was told "unavailable" in the pause after a failure: nobody was asked for it. */
const pausedLine = (fault: Fault, ms = 0) => ({ route: 'pot_stats', status: 502, upstream: null, ms, fault });

// -- many callers, one question ------------------------------------------------------------------

test('many readers, one question to the origin: each is counted first, and each is given the same three counts', async () => {
  const w = world();
  w.answerAtOnce(() => good());
  const readers = 300;
  for (let n = 0; n < readers; n += 1) {
    const response = await w.handler(look(n));
    assert.equal(response.status, 200, `reader ${n}`);
    assert.equal(await response.text(), '{"passedOn":12,"waiting":3,"handedOn":9}', `reader ${n}`);
  }
  assert.equal(w.questions.length, 1, 'the origin was asked once for the 300 of them');
  assert.equal(originAsked(w.h), 1);
  // Every one of them was counted at the pot's limiter, under a key of their own, before anything else.
  assert.equal(w.h.limiters.pot.keys.length, readers);
  assert.equal(new Set(w.h.limiters.pot.keys).size, readers, 'each reader has a count of their own');
  assert.deepEqual(w.h.trace.slice(0, 4), ['limit:pot', 'origin:potStats', 'limit:pot', 'limit:pot']);
  // One line for each request. The first asked the origin and says its status; the others asked nobody.
  assert.equal(w.h.lines.length, readers);
  assert.deepEqual(w.h.lines[0], { route: 'pot_stats', status: 200, upstream: 200, ms: 0, fault: null });
  for (const line of w.h.lines.slice(1)) assert.deepEqual(line, { route: 'pot_stats', status: 200, upstream: null, ms: 0, fault: null });
});

test('the same reader asking again and again makes the Worker ask no more often', async () => {
  const w = world();
  w.answerAtOnce(() => good());
  for (let n = 0; n < 200; n += 1) assert.equal((await w.handler(look(7))).status, 200);
  assert.equal(w.questions.length, 1);
});

// -- how long the answer is kept -------------------------------------------------------------------

test('a second question only when the kept counts are 15 seconds old, counted from the moment they came', async () => {
  assert.equal(POT_STATS_KEEP_MS, 15_000);
  const w = world();

  // The origin takes 3 seconds over its first answer.
  const first = w.handler(look(0));
  await arrived(w.h, 1);
  assert.equal(w.questions.length, 1);
  w.clock.ms = T0 + 3_000;
  w.questions[0]!.answer(good(counts(1)));
  assert.deepEqual(await read(await first), [200, counts(1)]);
  const came = T0 + 3_000;
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, kept: { stats: counts(1), at: came } });

  // Until 15 seconds after it came, everyone is given that answer and the origin is left alone.
  w.answerAtOnce(() => good(counts(2)));
  for (const later of [0, 1, 5_000, 12_000, 14_999]) {
    w.clock.ms = came + later;
    assert.deepEqual(await read(await w.handler(look(later))), [200, counts(1)], `${later} ms later`);
    assert.equal(w.questions.length, 1, `${later} ms later`);
  }

  // At 15 seconds it is too old: the next request asks, and is given the new answer.
  w.clock.ms = came + POT_STATS_KEEP_MS;
  assert.deepEqual(await read(await w.handler(look(1))), [200, counts(2)]);
  assert.equal(w.questions.length, 2);
  // And that one is kept in its turn, from the moment it came.
  w.clock.ms += 14_999;
  assert.deepEqual(await read(await w.handler(look(2))), [200, counts(2)]);
  assert.equal(w.questions.length, 2);
  w.clock.ms += 1;
  w.answerAtOnce(() => good(counts(3)));
  assert.deepEqual(await read(await w.handler(look(3))), [200, counts(3)]);
  assert.equal(w.questions.length, 3);
});

test('a clock that is set back does not make kept counts last longer, and cannot bring old ones back', async () => {
  const w = world();
  let asked = 0;
  w.answerAtOnce(() => good(counts((asked += 1))));
  assert.deepEqual(await read(await w.handler(look())), [200, counts(1)]);

  // The clock goes back an hour. Counts dated later than now are not trusted: the origin is asked.
  w.clock.ms = T0 - 3_600_000;
  assert.deepEqual(await read(await w.handler(look())), [200, counts(2)]);
  assert.equal(w.questions.length, 2);

  // Counts that have run out are thrown away then and there...
  w.clock.ms += POT_STATS_KEEP_MS;
  w.answerAtOnce(() => failed(502, 'origin_down'));
  assert.equal((await w.handler(look())).status, 502);
  assert.equal(w.h.deps.potStatsHolder.kept, null);
  // ...so a clock that then jumps back into their 15 seconds finds nothing to give.
  w.clock.ms -= POT_STATS_KEEP_MS;
  assert.equal((await w.handler(look())).status, 502);
  assert.equal(w.questions.length, 4);
});

// -- callers that arrive while the origin is being asked ---------------------------------------------

test('requests that arrive while the origin is being asked share that one question', async () => {
  const w = world();
  // 100 readers at the same moment, and nothing kept.
  const answers = Array.from({ length: 100 }, (_, n) => w.handler(look(n)));
  await arrived(w.h, 100);
  assert.equal(w.questions.length, 1, 'one question is out, not a hundred');

  // More arrive while it is out: two seconds on, and just before the origin's time is up.
  w.clock.ms = T0 + 2_000;
  for (let n = 100; n < 150; n += 1) answers.push(w.handler(look(n)));
  await arrived(w.h, 150);
  w.clock.ms = T0 + 7_900;
  for (let n = 150; n < 200; n += 1) answers.push(w.handler(look(n)));
  await arrived(w.h, 200);
  assert.equal(w.questions.length, 1);
  assert.equal(w.h.lines.length, 0, 'nobody has been answered yet');

  // The origin answers: every one of the 200 is given that answer.
  w.questions[0]!.answer(good({ ...POT_COUNTS, satsReceived: 180_000, address: ADDRESS, txid: TXID } as PotStats));
  for (const answer of answers) {
    const response = await answer;
    assert.equal(response.status, 200);
    // The three counts and nothing else, for those who waited as for the one that asked.
    assert.equal(await response.text(), '{"passedOn":12,"waiting":3,"handedOn":9}');
  }
  assert.equal(w.questions.length, 1);
  // Each wrote its own line. All of them waited for the origin's answer, and say its status.
  assert.equal(w.h.lines.length, 200);
  for (const line of w.h.lines) assert.deepEqual({ ...line, ms: 0 }, { route: 'pot_stats', status: 200, upstream: 200, ms: 0, fault: null });
  // How long each waited is its own: from its arrival to the answer.
  assert.deepEqual([...new Set(w.h.lines.map((line) => line.ms))].sort((a, b) => a - b), [0, 5_900, 7_900]);

  // The request that comes next is given the kept counts, and asks nobody.
  assert.deepEqual(await read(await w.handler(look(200))), [200, POT_COUNTS]);
  assert.equal(w.questions.length, 1);
  assert.deepEqual(w.h.lines.at(-1), { route: 'pot_stats', status: 200, upstream: null, ms: 0, fault: null });
});

test('when the kept counts run out, the many requests of that moment still share one question', async () => {
  const w = world();
  w.answerAtOnce(() => good(counts(1)));
  assert.deepEqual(await read(await w.handler(look())), [200, counts(1)]);

  // The very millisecond the counts are too old, 80 readers ask at once.
  w.holdAnswers();
  w.clock.ms = T0 + POT_STATS_KEEP_MS;
  const answers = Array.from({ length: 80 }, (_, n) => w.handler(look(n)));
  await arrived(w.h, 81);
  assert.equal(w.questions.length, 2, 'one new question, not eighty');
  w.questions[1]!.answer(good(counts(2)));
  for (const answer of answers) assert.deepEqual(await read(await answer), [200, counts(2)]);
  assert.equal(w.questions.length, 2);
});

// -- an answer that failed -----------------------------------------------------------------------------

test('an answer that failed is not kept: everyone who waited for it is told, the origin is left alone for 5 seconds, and then the next request asks again', async () => {
  const failures: Array<[what: string, upstream: number | null, fault: Fault]> = [
    ['the origin is down', 502, 'origin_down'],
    ['the origin did not answer in time', null, 'origin_timeout'],
    // What origin.ts makes of a 200 whose body is not the three counts.
    ['a body that is not the three counts', 200, 'origin_shape'],
    ['a refusal in the words of the faucet', 429, 'origin_shape'],
    ['the origin does not let the Worker in', 302, 'origin_auth'],
  ];
  for (const [what, upstream, fault] of failures) {
    const w = world();
    const answers = Array.from({ length: 10 }, (_, n) => w.handler(look(n)));
    await arrived(w.h, 10);
    assert.equal(w.questions.length, 1, what);
    w.questions[0]!.answer(failed(upstream, fault));
    for (const answer of answers) {
      const response = await answer;
      assert.equal(response.status, ERROR_STATUS.unavailable, what);
      assert.deepEqual(await errorOf(response), { error: 'unavailable' }, what);
    }
    // Every "unavailable" is in the log with its fault, for the one that asked and for those that waited.
    assert.equal(w.h.lines.length, 10, what);
    for (const line of w.h.lines) assert.deepEqual(line, { route: 'pot_stats', status: 502, upstream, ms: 0, fault }, what);
    // No counts are kept. What is noted is that a question failed, when, and with which fault.
    assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, failed: { at: T0, fault } }, `${what}: no counts were kept`);

    // For 5 seconds from that moment a request is told the same, and the origin is not asked: it could answer well by now.
    w.answerAtOnce(() => good());
    w.clock.ms = T0 + POT_STATS_PAUSE_MS - 1;
    const paused = await w.handler(look(10));
    assert.equal(paused.status, 502, what);
    assert.deepEqual(await errorOf(paused), { error: 'unavailable' }, what);
    assert.equal(w.questions.length, 1, what);
    assert.deepEqual(w.h.lines.at(-1), pausedLine(fault), what);
    // Then the next request asks again. The origin still fails: that is a new failure, with a pause of its own.
    w.answerAtOnce(() => failed(upstream, fault));
    w.clock.ms = T0 + POT_STATS_PAUSE_MS;
    assert.equal((await w.handler(look(11))).status, 502, what);
    assert.equal(w.questions.length, 2, what);
    assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, failed: { at: T0 + POT_STATS_PAUSE_MS, fault } }, what);
    // And when the origin answers well after that pause, the answer is kept like any other, and the failure is forgotten.
    w.answerAtOnce(() => good());
    w.clock.ms += POT_STATS_PAUSE_MS;
    assert.deepEqual(await read(await w.handler(look(12))), [200, POT_COUNTS], what);
    assert.deepEqual(await read(await w.handler(look(13))), [200, POT_COUNTS], what);
    assert.equal(w.questions.length, 3, what);
    assert.equal(holds(w.h.deps.potStatsHolder), 'counts', what);
  }
});

test('counts that have run out are not given again when the origin then fails', async () => {
  const w = world();
  w.answerAtOnce(() => good());
  assert.equal((await w.handler(look())).status, 200);
  // While they are young, they are given, also with the origin down: it is not asked.
  w.answerAtOnce(() => failed(502, 'origin_down'));
  w.clock.ms = T0 + POT_STATS_KEEP_MS - 1;
  assert.deepEqual(await read(await w.handler(look())), [200, POT_COUNTS]);
  assert.equal(w.questions.length, 1);
  // Once they are too old, a reader is told "unavailable", not given the old counts. The first of
  // three asks, and the question fails. The other two are told so without the origin being asked.
  w.clock.ms = T0 + POT_STATS_KEEP_MS;
  for (let n = 0; n < 3; n += 1) {
    const response = await w.handler(look(n));
    assert.equal(response.status, 502);
    assert.deepEqual(await errorOf(response), { error: 'unavailable' });
  }
  assert.equal(w.questions.length, 2, 'one of the three asked');
  assert.deepEqual(w.h.lines.slice(-3), [{ route: 'pot_stats', status: 502, upstream: 502, ms: 0, fault: 'origin_down' }, pausedLine('origin_down'), pausedLine('origin_down')]);
  // The old counts are gone for good: not after the pause either, with the origin still down.
  w.clock.ms += POT_STATS_PAUSE_MS;
  assert.equal((await w.handler(look(3))).status, 502);
  assert.equal(w.questions.length, 3);
  assert.equal(w.h.deps.potStatsHolder.kept, null);
});

test('a question that breaks is our own mistake: everyone who waited is told "unavailable", the log says "handler", no counts and no question are left behind, and the origin is left alone for 5 seconds', async () => {
  const w = world();
  const answers = Array.from({ length: 5 }, (_, n) => w.handler(look(n)));
  await arrived(w.h, 5);
  assert.equal(w.questions.length, 1);
  w.questions[0]!.break(new Error(`could not reach ${ADDRESS}`));
  for (const answer of answers) {
    const response = await answer;
    assert.equal(response.status, 502);
    assert.deepEqual(await errorOf(response), { error: 'unavailable' });
    for (const [name, value] of Object.entries(FIXED_HEADERS)) assert.equal(response.headers.get(name), value);
  }
  for (const line of w.h.lines) assert.deepEqual(line, { route: 'pot_stats', status: 502, upstream: null, ms: 0, fault: 'handler' });
  assert.equal(w.h.lines.length, 5);
  // Nothing of the question is left, and nothing of the error: only that a question failed, and when.
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, failed: { at: T0, fault: 'handler' } });
  assert.ok(!JSON.stringify(w.h.deps.potStatsHolder).includes(ADDRESS));
  // What was handed to waitUntil does not reject, so the runtime has no stray failure to report.
  await Promise.all(w.h.pending);
  // A question that breaks may have reached the origin all the same. So the pause follows it as it follows an
  // answer that failed: for 5 seconds a request is told what those who waited were told, and nobody is asked.
  w.answerAtOnce(() => good());
  w.clock.ms = T0 + POT_STATS_PAUSE_MS - 1;
  const paused = await w.handler(look(5));
  assert.equal(paused.status, 502);
  assert.deepEqual(await errorOf(paused), { error: 'unavailable' });
  assert.deepEqual(w.h.lines.at(-1), pausedLine('handler'));
  assert.equal(w.questions.length, 1);
  // Then the next request is not held up by the broken question: it asks.
  w.clock.ms = T0 + POT_STATS_PAUSE_MS;
  assert.deepEqual(await read(await w.handler(look(6))), [200, POT_COUNTS]);
  assert.equal(w.questions.length, 2);
});

// -- a question that does not come back -------------------------------------------------------------------

test('nobody waits without end for a question that is not their own: 10 seconds after it was asked they are told "unavailable", and the next request asks anew', async (t) => {
  // The origin is given 8 seconds, so a question still out after 10 is not coming back.
  assert.equal(POT_STATS_WAIT_MS, 10_000);
  assert.ok(POT_STATS_WAIT_MS > ORIGIN_TIMEOUT_MS, 'nobody gives up on a question the origin may still answer');
  assert.ok(POT_STATS_WAIT_MS < 30_000, 'and gives up within the time a request is waited for at all');
  // A request that waits looks for the answer with timers of its own. The test owns the timers,
  // so that 10 seconds take no time. (One millisecond at a time: a timer that is set while the
  // time passes is then due when it should be.)
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pass = (ms: number): void => {
    for (let passed = 0; passed < ms; passed += 1) t.mock.timers.tick(1);
  };
  const w = world();

  // One request asks. Its question never comes back (its reader left, and the runtime stopped the work).
  const asker = w.handler(look(0));
  await arrived(w.h, 1);
  // Two more arrive while it is out: 4 seconds on, and a millisecond before the 10 seconds are up.
  w.clock.ms = T0 + 4_000;
  const early = w.handler(look(1));
  await arrived(w.h, 2);
  w.clock.ms = T0 + 9_999;
  const late = w.handler(look(2));
  await arrived(w.h, 3);
  assert.equal(w.questions.length, 1, 'both wait for the question that is out');
  let settled = 0;
  for (const answer of [early, late]) void answer.then(() => (settled += 1));

  // Each waits until 10 seconds after the question was asked, and no longer.
  pass(1);
  assert.deepEqual(await read(await late), [502, { error: 'unavailable' }]);
  await turn();
  assert.equal(settled, 1, 'the one that came early still waits');
  pass(5_998);
  await turn();
  assert.equal(settled, 1);
  pass(1);
  assert.deepEqual(await read(await early), [502, { error: 'unavailable' }]);
  // The owner is told, by both: no answer came from the origin in time.
  assert.deepEqual(w.h.lines, [
    { route: 'pot_stats', status: 502, upstream: null, ms: 0, fault: 'origin_timeout' },
    { route: 'pot_stats', status: 502, upstream: null, ms: 5_999, fault: 'origin_timeout' },
  ]);

  // From 10 seconds after it was asked the question is given up on: a request does not wait for it, it asks.
  w.clock.ms = T0 + POT_STATS_WAIT_MS;
  const next = w.handler(look(3));
  await arrived(w.h, 4);
  assert.equal(w.questions.length, 2);
  w.questions[1]!.answer(good(counts(7)));
  assert.deepEqual(await read(await next), [200, counts(7)]);
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, kept: { stats: counts(7), at: T0 + POT_STATS_WAIT_MS } });

  // Should the old question come back after all, its answer goes to the request that asked it and is not kept:
  // a newer answer is.
  w.questions[0]!.answer(good(counts(99)));
  assert.deepEqual(await read(await asker), [200, counts(99)]);
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, kept: { stats: counts(7), at: T0 + POT_STATS_WAIT_MS } });
  assert.deepEqual(await read(await w.handler(look(4))), [200, counts(7)]);
  assert.equal(w.questions.length, 2);
});

test('a question that was given up on does not take the place of the one that is out', async () => {
  const w = world();
  const asker = w.handler(look(0));
  await arrived(w.h, 1);
  // Given up on: the next request asks anew, and its question is the one that is out.
  w.clock.ms = T0 + POT_STATS_WAIT_MS;
  const second = w.handler(look(1));
  await arrived(w.h, 2);
  assert.equal(w.questions.length, 2);
  const out = { since: T0 + POT_STATS_WAIT_MS, ended: null };
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, asking: out });
  // The old question fails late. The one that is out stays out, and no failure is noted: the question
  // that failed is not the one anybody waits for. So no pause begins, and a third request waits.
  w.questions[0]!.answer(failed(null, 'origin_timeout'));
  assert.equal((await asker).status, 502);
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, asking: out });
  const third = w.handler(look(2));
  await arrived(w.h, 3);
  assert.equal(w.questions.length, 2, 'the third request waits for the second question');
  w.questions[1]!.answer(good(counts(4)));
  assert.deepEqual(await read(await second), [200, counts(4)]);
  assert.deepEqual(await read(await third), [200, counts(4)]);
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, kept: { stats: counts(4), at: T0 + POT_STATS_WAIT_MS } });
});

test('a question that was given up on and then breaks does not take the newer question off, and starts no pause: when a question breaks, it is cleared only if it is still the one that is out', async () => {
  const w = world();
  const asker = w.handler(look(0));
  await arrived(w.h, 1);
  // Given up on: the next request asks anew, and its question is the one that is out.
  w.clock.ms = T0 + POT_STATS_WAIT_MS;
  const second = w.handler(look(1));
  await arrived(w.h, 2);
  assert.equal(w.questions.length, 2);
  const out = { since: T0 + POT_STATS_WAIT_MS, ended: null };
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, asking: out });

  // The old question breaks late: a mistake of ours, in work nobody waits for any more.
  w.questions[0]!.break(new Error(`broke late, on the way to ${ADDRESS}`));
  assert.equal((await asker).status, 502);
  // The newer question is still the one that is out, and no failure is noted: it is not the one that broke.
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, asking: out });

  // So a third request waits for the second question. It is not told "unavailable", and it does not ask.
  const third = w.handler(look(2));
  await arrived(w.h, 3);
  let told = false;
  void third.then(() => {
    told = true;
  });
  await turn();
  await turn();
  assert.equal(told, false, 'the third request waits');
  assert.equal(w.questions.length, 2, 'the origin has been asked twice, not three times');
  w.questions[1]!.answer(good(counts(4)));
  assert.deepEqual(await read(await second), [200, counts(4)]);
  assert.deepEqual(await read(await third), [200, counts(4)]);
  assert.deepEqual(
    w.h.lines.map((line) => [line.status, line.upstream, line.fault]),
    [
      [502, null, 'handler'],
      [200, 200, null],
      [200, 200, null],
    ],
  );
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, kept: { stats: counts(4), at: T0 + POT_STATS_WAIT_MS } });
  await Promise.all(w.h.pending);
});

test('the request that asks hands its question to waitUntil, so that a reader who leaves does not take the answer away from the rest', async () => {
  const w = world();
  // The asker, and four who wait.
  const answers = Array.from({ length: 5 }, (_, n) => w.handler(look(n)));
  await arrived(w.h, 5);
  assert.equal(w.h.pending.length, 1, 'handed over once, by the request that asked');
  w.questions[0]!.answer(good());
  for (const answer of answers) assert.equal((await answer).status, 200);
  // A request that is given the kept counts has nothing to hand over.
  assert.equal((await w.handler(look(5))).status, 200);
  assert.equal(w.h.pending.length, 1);
  // What was handed over ends when the question does, and never rejects: not for an answer that failed either.
  w.clock.ms = T0 + POT_STATS_KEEP_MS;
  w.answerAtOnce(() => failed(null, 'origin_timeout'));
  assert.equal((await w.handler(look(6))).status, 502);
  assert.equal(w.h.pending.length, 2);
  assert.deepEqual(await Promise.all(w.h.pending), [undefined, undefined]);
});

// -- the reader's own budget ---------------------------------------------------------------------------------

test("the reader's own budget is counted first, and a reader over it is refused: with counts kept, with a question out, with a failure noted, and with none of these", async () => {
  const over = `${await readerKey('pot', reader(9))}:stats`;
  /** A limiter that refuses reader 9's looks at the counts and nobody else's, and records every call. */
  const limiter = (h: Harness): Limiter => ({
    limit: async (options) => {
      h.trace.push(`limit:${options.key === over ? 'refused' : 'passed'}`);
      return { success: options.key !== over };
    },
  });
  const refused = async (response: Response): Promise<void> => {
    assert.equal(response.status, 429);
    assert.deepEqual(await errorOf(response), { error: 'limit' });
    for (const [name, value] of Object.entries(FIXED_HEADERS)) assert.equal(response.headers.get(name), value, name);
  };

  // Nothing kept and no question out: the refused reader does not make the Worker ask.
  const empty = world();
  empty.h.deps.limits = { ...empty.h.deps.limits, pot: limiter(empty.h) };
  await refused(await empty.handler(look(9)));
  assert.equal(empty.questions.length, 0);
  assert.deepEqual(empty.h.trace, ['limit:refused']);
  assert.deepEqual(empty.h.lines, [{ route: 'pot_stats', status: 429, upstream: null, ms: 0, fault: null }]);

  // A question is out: the refused reader is refused at once, and does not wait for it.
  empty.h.trace.length = 0;
  const waits = empty.handler(look(1));
  for (let turns = 0; empty.questions.length < 1; turns += 1) {
    assert.ok(turns < 10_000);
    await turn();
  }
  await refused(await empty.handler(look(9)));
  assert.equal(empty.questions.length, 1);
  empty.questions[0]!.answer(good());
  assert.equal((await waits).status, 200);

  // Counts are kept: everyone else is given them, and the refused reader is refused all the same.
  empty.h.trace.length = 0;
  assert.equal((await empty.handler(look(2))).status, 200);
  await refused(await empty.handler(look(9)));
  assert.equal((await empty.handler(look(3))).status, 200);
  assert.deepEqual(empty.h.trace, ['limit:passed', 'limit:refused', 'limit:passed'], 'the limiter is asked for every request, and nothing else is');
  assert.equal(empty.questions.length, 1);

  // A failure is noted: in the pause after it, the refused reader is refused all the same, and is not
  // told "unavailable". Everyone else is, and the limiter is asked for each of them.
  const down = world();
  down.h.deps.limits = { ...down.h.deps.limits, pot: limiter(down.h) };
  down.answerAtOnce(() => failed(502, 'origin_down'));
  assert.equal((await down.handler(look(1))).status, 502);
  assert.equal(holds(down.h.deps.potStatsHolder), 'failure');
  down.h.trace.length = 0;
  await refused(await down.handler(look(9)));
  assert.equal((await down.handler(look(2))).status, 502);
  await refused(await down.handler(look(9)));
  assert.deepEqual(down.h.trace, ['limit:refused', 'limit:passed', 'limit:refused']);
  assert.equal(down.questions.length, 1);
  assert.deepEqual(down.h.lines.slice(-3).map((line) => [line.status, line.fault]), [
    [429, null],
    [502, 'origin_down'],
    [429, null],
  ]);
});

// -- what the browser is told -----------------------------------------------------------------------------------

test('the answer is marked no-store, and is the same answer, whether the origin was asked for it, it was waited for, or it was kept', async () => {
  const w = world();
  const asked = w.handler(look(0));
  await arrived(w.h, 1);
  const waited = w.handler(look(1));
  await arrived(w.h, 2);
  w.questions[0]!.answer(good());
  const kept = w.handler(look(2));
  const answers: Array<[how: string, response: Response]> = [
    ['asked for', await asked],
    ['waited for', await waited],
    ['kept', await kept],
  ];
  assert.equal(w.questions.length, 1);
  // Two of them say the origin's status, and the one that was given the kept counts says none. (In
  // no fixed order: the request that waited is told at its next look, a moment after the answer came.)
  assert.deepEqual(w.h.lines.map((line) => String(line.upstream)).sort(), ['200', '200', 'null']);
  for (const [how, response] of answers) {
    assert.equal(response.status, 200, how);
    assert.equal(response.headers.get('Cache-Control'), 'no-store', how);
    for (const [name, value] of Object.entries(FIXED_HEADERS)) assert.equal(response.headers.get(name), value, `${how}: ${name}`);
    // These headers and no others: nothing that tells a browser or anything in between to keep the
    // answer, to check it again later, or how old it is.
    const names: string[] = [];
    response.headers.forEach((_value, name) => names.push(name));
    assert.deepEqual(names.sort(), [...Object.keys(FIXED_HEADERS).map((name) => name.toLowerCase()), 'content-type'].sort(), how);
    assert.equal(await response.text(), '{"passedOn":12,"waiting":3,"handedOn":9}', how);
  }
});

// -- ways round ------------------------------------------------------------------------------------------------------

test('nothing a request says can get round the kept counts or make the Worker ask again: no header, no query string, no slash, no other method', async () => {
  const w = world();
  let asked = 0;
  w.answerAtOnce(() => good(counts((asked += 1))));
  assert.deepEqual(await read(await w.handler(look())), [200, counts(1)]);

  // Headers that ask a cache for a fresh copy, or for a part, or that say who is asking.
  const headers: Array<Record<string, string>> = [
    { 'Cache-Control': 'no-cache' },
    { 'Cache-Control': 'no-store' },
    { 'Cache-Control': 'max-age=0, must-revalidate' },
    { Pragma: 'no-cache' },
    { 'If-None-Match': '*' },
    { 'If-None-Match': '"anything"' },
    { 'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT' },
    { 'If-Match': '*' },
    { Range: 'bytes=0-' },
    { Accept: 'text/html' },
    { 'Accept-Encoding': 'identity' },
    { Authorization: 'Bearer anything' },
    { Cookie: 'fresh=1' },
    { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: APP, 'Sec-Fetch-Site': 'same-origin' },
    { 'X-Forwarded-For': '192.0.2.99', 'X-Real-IP': '192.0.2.99', Forwarded: 'for=192.0.2.99' },
    { 'X-HTTP-Method-Override': 'POST' },
    { 'CF-Connecting-IP': '' },
    { 'CF-Connecting-IP': '192.0.2.77' },
    { 'User-Agent': 'curl/8.7.1' },
  ];
  for (const each of headers) {
    const response = await w.handler(look(0, each));
    assert.deepEqual(await read(response), [200, counts(1)], JSON.stringify(each));
    assert.equal(response.headers.get('Cache-Control'), 'no-store', JSON.stringify(each));
  }
  // The same path spelled another way is the same route, and is given the same kept counts.
  for (const path of [`${API.potStats}?`, '/api/pot/./stats', '/api/pot/x/../stats', '/x/../api/pot/stats']) {
    assert.deepEqual(await read(await w.handler(get(path))), [200, counts(1)], path);
  }
  assert.equal(w.questions.length, 1, 'none of those made the Worker ask again');

  // A query string, a slash at the end, or anything else added to the path makes it a path the
  // Worker does not know: 404, with no count spent and nobody asked.
  const limited = w.h.limiters.pot.keys.length;
  const paths = [
    `${API.potStats}?fresh=1`,
    `${API.potStats}?_=${T0}`,
    `${API.potStats}?cache=no`,
    `${API.potStats}?x`,
    `${API.potStats}??`,
    `${API.potStats}/`,
    `${API.potStats}//`,
    `${API.potStats}/.`,
    `${API.potStats}/x`,
    `${API.potStats}%2F`,
    `${API.potStats}%3Ffresh=1`,
    `${API.potStats};fresh`,
    `${API.potStats}.json`,
    '/api/pot//stats',
    '/api/pot/Stats',
    '/api/pot/stats%20',
  ];
  for (const path of paths) {
    const response = await w.handler(get(path));
    assert.equal(response.status, 404, path);
    assert.deepEqual(await errorOf(response), { error: 'not_found' }, path);
  }
  // Any other method is the wrong one, whoever sends it.
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const body = method === 'HEAD' ? undefined : 'x';
    const response = await w.handler(new Request(`${APP}${API.potStats}`, { method, headers: { Origin: APP, 'Cache-Control': 'no-cache' }, body }));
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('Allow'), 'GET', method);
  }
  assert.equal(w.h.limiters.pot.keys.length, limited, 'none of those was even counted');
  assert.equal(w.questions.length, 1, 'and none of them reached the origin');

  // With nothing kept, the same holds: what is refused starts no question.
  const fresh = world();
  for (const path of paths) assert.equal((await fresh.handler(get(path))).status, 404, path);
  assert.equal((await fresh.handler(post(API.potStats, null))).status, 405);
  assert.equal(fresh.questions.length, 0);
  assert.deepEqual(fresh.h.deps.potStatsHolder, EMPTY);
});

// -- what is kept, and where ----------------------------------------------------------------------------------------------

test('what is kept is three counts and the time they came: nothing of the request that asked, and nothing else the origin said', async () => {
  const w = world();
  const padded = { ...POT_COUNTS, satsReceived: 987_654_321, faucetPayments: 4, address: ADDRESS, txid: TXID } as PotStats;
  const asker = w.handler(
    look(0, { 'User-Agent': 'Mozilla/5.0 (a browser)', Authorization: 'Bearer a-readers-token', Cookie: 'session=a-readers-cookie', Referer: `${APP}/wallet` }),
  );
  await arrived(w.h, 1);
  // While the question is out: when it was asked and that it has not ended, and nothing else. Plain
  // data, with no promise in it: the question itself stays with the request that asked.
  const holder: PotStatsHolder = w.h.deps.potStatsHolder;
  assert.equal(JSON.stringify(holder), `{"kept":null,"asking":{"since":${T0},"ended":null},"failed":null}`);

  w.clock.ms = T0 + 250;
  w.questions[0]!.answer(good(padded));
  assert.equal((await asker).status, 200);
  assert.equal(JSON.stringify(holder), `{"kept":{"stats":{"passedOn":12,"waiting":3,"handedOn":9},"at":${T0 + 250}},"asking":null,"failed":null}`);
  assert.deepEqual(Object.keys(holder.kept!.stats), ['passedOn', 'waiting', 'handedOn']);
  assert.ok(Object.isFrozen(holder.kept!.stats), 'the kept counts cannot be changed by whoever is given them');
  const written = JSON.stringify(holder);
  for (const piece of [reader(0), 'Mozilla', 'a-readers-token', 'a-readers-cookie', '/wallet', ADDRESS, TXID, '987654321', 'faucetPayments']) {
    assert.ok(!written.includes(piece), `${piece} in ${written}`);
  }
  // A request that is given the kept counts is given the three counts too, written anew for it.
  assert.equal(await (await w.handler(look(1))).text(), '{"passedOn":12,"waiting":3,"handedOn":9}');
});

test('the counts are kept by the holder, not by the handler: a handler made anew for each request finds what the last one left, and another holder knows nothing of it', async () => {
  // As the deployed Worker has it (index.ts): a new Deps, a new origin and a new handler for every
  // request, and one holder that outlives them.
  assert.deepEqual(makePotStatsHolder(), { kept: null, asking: null, failed: null });
  assert.notEqual(makePotStatsHolder(), makePotStatsHolder(), 'each call makes a holder of its own');
  const holder = makePotStatsHolder();
  const requestWith = async (shared: typeof holder | null): Promise<[status: number, body: unknown, asked: number]> => {
    const h = harness({ now: () => T0 });
    if (shared !== null) h.deps.potStatsHolder = shared;
    const response = await makeHandler(h.deps)(look());
    return [response.status, await response.json(), originAsked(h)];
  };
  assert.deepEqual(await requestWith(holder), [200, POT_COUNTS, 1], 'the first request asks');
  for (let n = 0; n < 5; n += 1) assert.deepEqual(await requestWith(holder), [200, POT_COUNTS, 0], 'the next ones find the counts in the holder');
  // A holder of its own is another isolate: it has nothing, and asks for itself.
  assert.deepEqual(await requestWith(null), [200, POT_COUNTS, 1]);
  assert.deepEqual(await requestWith(makePotStatsHolder()), [200, POT_COUNTS, 1]);
});

test('requests that reach different handlers over one holder share one question too', async () => {
  const holder = makePotStatsHolder();
  const questions: Array<(result: OriginAnswer<PotStats>) => void> = [];
  const harnesses = Array.from({ length: 12 }, () => {
    const h = harness({ now: () => T0, potStats: () => new Promise<OriginAnswer<PotStats>>((resolve) => questions.push(resolve)) });
    h.deps.potStatsHolder = holder;
    return h;
  });
  const answers = harnesses.map((h, n) => makeHandler(h.deps)(look(n)));
  for (const h of harnesses) await arrived(h, 1);
  assert.equal(questions.length, 1);
  questions[0]!(good());
  for (const answer of answers) assert.deepEqual(await read(await answer), [200, POT_COUNTS]);
  assert.equal(harnesses.map(originAsked).reduce((sum, asked) => sum + asked, 0), 1, 'one of the twelve asked, for all of them');
});

// -- how a request that waits looks for the answer ------------------------------------------------------------------------

test('a request that waits looks for the answer with timers of its own: first after 25 ms, then at growing intervals of a quarter of a second at the most, and is told at its next look after the answer came', async (t) => {
  assert.deepEqual([POT_STATS_LOOK_FIRST_MS, POT_STATS_LOOK_MAX_MS], [25, 250]);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pass = (ms: number): void => {
    for (let passed = 0; passed < ms; passed += 1) t.mock.timers.tick(1);
  };
  /** Lets `ms` pass, and says whether the waiting request has its answer by then. */
  const answeredAfter = async (ms: number, waiter: { done: boolean }): Promise<boolean> => {
    pass(ms);
    await turn();
    await turn();
    return waiter.done;
  };

  const w = world();
  const asker = w.handler(look(0));
  await arrived(w.h, 1);
  const waiter = { done: false };
  const waits = w.handler(look(1)).then((response) => {
    waiter.done = true;
    return response;
  });
  await arrived(w.h, 2);

  // The answer comes 30 ms after the waiting request arrived. It looked at 25 ms, too early, and looks again at 75 ms.
  assert.equal(await answeredAfter(25, waiter), false);
  pass(5);
  w.questions[0]!.answer(good(counts(1)));
  assert.deepEqual(await read(await asker), [200, counts(1)], 'the request that asked is told at once');
  assert.equal(await answeredAfter(44, waiter), false, 'the request that waits is not told between its looks');
  assert.equal(await answeredAfter(1, waiter), true, 'it is told at its next look');
  assert.deepEqual(await read(await waits), [200, counts(1)]);
  assert.equal(w.questions.length, 1);

  // A slow answer. The looks come at 25, 75, 175, 375, 625, 875, 1125 ms and so on: never more than 250 ms apart.
  w.clock.ms = T0 + POT_STATS_KEEP_MS;
  const second = w.handler(look(2));
  await arrived(w.h, 3);
  const slow = { done: false };
  const waitsLong = w.handler(look(3)).then((response) => {
    slow.done = true;
    return response;
  });
  await arrived(w.h, 4);
  pass(880);
  w.questions[1]!.answer(good(counts(2)));
  assert.deepEqual(await read(await second), [200, counts(2)]);
  assert.equal(await answeredAfter(244, slow), false);
  assert.equal(await answeredAfter(1, slow), true, 'told at 1125 ms: 245 ms after the answer came');
  assert.deepEqual(await read(await waitsLong), [200, counts(2)]);
  assert.equal(w.questions.length, 2);
});

// -- the pause after a question that failed --------------------------------------------------------------------------------

test('after a question that failed the origin is left alone for 5 seconds from the moment it failed: every request in that time is told "unavailable" and none of them asks, however many they are; then one asks', async () => {
  assert.equal(POT_STATS_PAUSE_MS, 5_000);
  assert.ok(POT_STATS_PAUSE_MS < POT_STATS_WAIT_MS && POT_STATS_WAIT_MS < POT_STATS_KEEP_MS, 'a failure is waited out sooner than a question is given up on, and that sooner than counts run out');
  const w = world();
  // The origin takes 3 seconds to fail.
  const first = w.handler(look(0));
  await arrived(w.h, 1);
  w.clock.ms = T0 + 3_000;
  w.questions[0]!.answer(failed(502, 'origin_down'));
  assert.equal((await first).status, 502);
  const failedAt = T0 + 3_000;
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, failed: { at: failedAt, fault: 'origin_down' } });

  // The origin is well again at once. For 5 seconds nobody finds out: it is not asked.
  w.answerAtOnce(() => good(counts(2)));
  w.h.trace.length = 0;
  w.h.lines.length = 0;
  let looks = 0;
  for (const later of [0, 1, 1_000, 2_500, 4_998, 4_999]) {
    w.clock.ms = failedAt + later;
    // A crowd each time: 40 readers at the same moment.
    const answers = await Promise.all(Array.from({ length: 40 }, (_, n) => w.handler(look(100 + n))));
    looks += answers.length;
    for (const response of answers) {
      assert.equal(response.status, ERROR_STATUS.unavailable, `${later} ms after the failure`);
      // "Unavailable" and nothing else: a failure is never given out as counts.
      assert.equal(await response.text(), '{"error":"unavailable"}', `${later} ms after the failure`);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    assert.equal(w.questions.length, 1, `${later} ms after the failure`);
  }
  assert.equal(looks, 240);
  // Each of them was counted at the limiter first, and nothing else was asked for any of them.
  assert.deepEqual(w.h.trace, Array.from({ length: looks }, () => 'limit:pot'));
  // Each wrote its line: the fault of the question that failed, and no status of the origin's, which was not asked.
  assert.deepEqual(w.h.lines, Array.from({ length: looks }, () => pausedLine('origin_down')));
  assert.equal(w.h.pending.length, 1, 'nothing was handed to waitUntil in the pause');
  // The note is as it was: the pause does not begin again with each request that is turned away.
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, failed: { at: failedAt, fault: 'origin_down' } });

  // At 5 seconds the pause is over. Of the 40 readers of that moment one asks, and all are given its answer.
  w.holdAnswers();
  w.clock.ms = failedAt + POT_STATS_PAUSE_MS;
  const after = Array.from({ length: 40 }, (_, n) => w.handler(look(200 + n)));
  await arrived(w.h, 1 + looks + 40);
  assert.equal(w.questions.length, 2, 'one question, not forty');
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, asking: { since: failedAt + POT_STATS_PAUSE_MS, ended: null } });
  w.questions[1]!.answer(good(counts(2)));
  for (const answer of after) assert.deepEqual(await read(await answer), [200, counts(2)]);
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, kept: { stats: counts(2), at: failedAt + POT_STATS_PAUSE_MS } });
});

test('while the origin fails, an isolate asks once for each pause and no more often, whoever looks and however often: 12 questions for 600 looks in a minute', async () => {
  const w = world();
  w.answerAtOnce(() => failed(502, 'origin_down'));
  // A minute of looks, ten a second, each by another reader. The origin fails each question at once.
  const asked: number[] = [];
  for (let ms = 0; ms < 60_000; ms += 100) {
    w.clock.ms = T0 + ms;
    const before = w.questions.length;
    assert.equal((await w.handler(look(ms / 100))).status, 502, `${ms} ms`);
    if (w.questions.length > before) asked.push(ms);
  }
  assert.deepEqual(asked, [0, 5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000, 45_000, 50_000, 55_000]);
  assert.equal(w.h.lines.length, 600);
  // Every one of the 600 was told "unavailable", with the fault in its line: 12 of them had asked.
  assert.equal(w.h.lines.filter((line) => line.upstream === 502).length, 12);
  assert.equal(w.h.lines.filter((line) => line.upstream === null && line.fault === 'origin_down').length, 588);
  // The moment the origin is well, the next question says so, and the counts are kept from then on.
  w.answerAtOnce(() => good(counts(7)));
  w.clock.ms = T0 + 60_000;
  assert.deepEqual(await read(await w.handler(look(600))), [200, counts(7)]);
  assert.equal(w.questions.length, 13);
});

test('the pause begins when the question ends, not when it was asked: an origin that takes its 8 seconds to fail is asked once in 13', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pass = (ms: number): void => {
    for (let passed = 0; passed < ms; passed += 1) t.mock.timers.tick(1);
  };
  const w = world();
  // The origin does not answer. The Worker's own time limit ends the question after 8 seconds (origin.ts).
  const asker = w.handler(look(0));
  await arrived(w.h, 1);
  // A reader who arrives meanwhile waits for that question.
  w.clock.ms = T0 + 6_000;
  const waiter = w.handler(look(1));
  await arrived(w.h, 2);
  w.clock.ms = T0 + ORIGIN_TIMEOUT_MS;
  w.questions[0]!.answer(failed(null, 'origin_timeout'));
  assert.equal((await asker).status, 502);
  pass(POT_STATS_LOOK_MAX_MS);
  assert.equal((await waiter).status, 502);
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, failed: { at: T0 + ORIGIN_TIMEOUT_MS, fault: 'origin_timeout' } });

  // From then on, for 5 seconds, nobody waits and nobody asks: a request is told at once.
  w.answerAtOnce(() => good(counts(2)));
  for (const at of [ORIGIN_TIMEOUT_MS, 10_000, ORIGIN_TIMEOUT_MS + POT_STATS_PAUSE_MS - 1]) {
    w.clock.ms = T0 + at;
    assert.equal((await w.handler(look(2))).status, 502, `${at} ms`);
    assert.equal(w.questions.length, 1, `${at} ms`);
  }
  assert.deepEqual(w.h.lines.slice(-3), [pausedLine('origin_timeout'), pausedLine('origin_timeout'), pausedLine('origin_timeout')]);
  // 13 seconds after the first question, the second.
  w.clock.ms = T0 + ORIGIN_TIMEOUT_MS + POT_STATS_PAUSE_MS;
  assert.deepEqual(await read(await w.handler(look(3))), [200, counts(2)]);
  assert.equal(w.questions.length, 2);
});

test('a failure does not bring counts back, and counts that are kept are not touched by a pause that is over', async () => {
  const w = world();
  w.answerAtOnce(() => good(counts(1)));
  assert.deepEqual(await read(await w.handler(look())), [200, counts(1)]);
  // The counts run out, and the question that follows fails.
  w.answerAtOnce(() => failed(502, 'origin_down'));
  w.clock.ms = T0 + POT_STATS_KEEP_MS;
  assert.equal((await w.handler(look())).status, 502);
  // In the pause: "unavailable". Not the counts from before, although the holder had them a moment ago.
  for (const later of [0, 2_000, POT_STATS_PAUSE_MS - 1]) {
    w.clock.ms = T0 + POT_STATS_KEEP_MS + later;
    const response = await w.handler(look());
    assert.deepEqual(await read(response), [502, { error: 'unavailable' }], `${later} ms`);
  }
  assert.equal(w.questions.length, 2);
  // After the pause the origin answers: those are the counts given, and the note of the failure is gone.
  w.answerAtOnce(() => good(counts(3)));
  w.clock.ms = T0 + POT_STATS_KEEP_MS + POT_STATS_PAUSE_MS;
  assert.deepEqual(await read(await w.handler(look())), [200, counts(3)]);
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, kept: { stats: counts(3), at: T0 + POT_STATS_KEEP_MS + POT_STATS_PAUSE_MS } });
  // They are kept for their 15 seconds like any others: the failure before them shortens nothing.
  w.answerAtOnce(() => failed(502, 'origin_down'));
  w.clock.ms += POT_STATS_KEEP_MS - 1;
  assert.deepEqual(await read(await w.handler(look())), [200, counts(3)]);
  assert.equal(w.questions.length, 3);
});

// -- a clock that was set back ---------------------------------------------------------------------------------------------

test('a question that is dated later than now counts as lost: the next request does not wait for it, it asks anew', async (t) => {
  // The timers are the test's, and it lets no time pass: a request that waited would never be answered here.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const back of [1, 1_000, POT_STATS_WAIT_MS, 3_600_000]) {
    const w = world();
    // A request asks. Its question never ends: the runtime stopped the request, and nothing wrote down how it ended.
    void w.handler(look(0));
    await arrived(w.h, 1);
    assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, asking: { since: T0, ended: null } });

    // The clock is set back. The question is now dated later than now, which says nothing about how long it
    // has been out. Taken for a question just asked, it would be waited for until the clock had caught up.
    w.clock.ms = T0 - back;
    const next = w.handler(look(1));
    await arrived(w.h, 2);
    assert.equal(w.questions.length, 2, `set back by ${back} ms: the request asked, and did not wait`);
    assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, asking: { since: T0 - back, ended: null } });
    w.questions[1]!.answer(good(counts(2)));
    assert.deepEqual(await read(await next), [200, counts(2)], `set back by ${back} ms`);
    // From then on the counts are kept by the clock as it now runs.
    assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, kept: { stats: counts(2), at: T0 - back } });
    assert.deepEqual(await read(await w.handler(look(2))), [200, counts(2)]);
    assert.equal(w.questions.length, 2);
    assert.deepEqual(
      w.h.lines.map((line) => [line.status, line.upstream, line.fault]),
      [
        [200, 200, null],
        [200, null, null],
      ],
      'nobody was told "unavailable"',
    );
  }
});

test('a question that is alive when the clock is set back costs the origin one more question and no more: its answer goes to those who asked and waited for it, and the newer answer is the one that is kept', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pass = (ms: number): void => {
    for (let passed = 0; passed < ms; passed += 1) t.mock.timers.tick(1);
  };
  const w = world();
  const asker = w.handler(look(0));
  await arrived(w.h, 1);
  const waiter = w.handler(look(1));
  await arrived(w.h, 2);
  assert.equal(w.questions.length, 1);

  // The clock is set back by a minute. The first request after that asks anew. Those that follow wait for its question.
  w.clock.ms = T0 - 60_000;
  const second = w.handler(look(2));
  await arrived(w.h, 3);
  const others = Array.from({ length: 30 }, (_, n) => w.handler(look(3 + n)));
  await arrived(w.h, 33);
  assert.equal(w.questions.length, 2, 'one more question for the jump, and none for the thirty that came after it');
  const newer = { since: T0 - 60_000, ended: null };
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, asking: newer });

  // The older question comes back. Its answer goes to the request that asked it and to the one that had
  // waited for it. It is not kept, and the newer question stays out.
  w.questions[0]!.answer(good(counts(1)));
  assert.deepEqual(await read(await asker), [200, counts(1)]);
  pass(POT_STATS_LOOK_FIRST_MS);
  assert.deepEqual(await read(await waiter), [200, counts(1)]);
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, asking: newer });

  // The newer one comes back: its answer is kept, dated by the clock as it now runs.
  w.questions[1]!.answer(good(counts(2)));
  assert.deepEqual(await read(await second), [200, counts(2)]);
  pass(POT_STATS_LOOK_MAX_MS);
  for (const each of others) assert.deepEqual(await read(await each), [200, counts(2)]);
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, kept: { stats: counts(2), at: T0 - 60_000 } });
  assert.equal(w.questions.length, 2);
});

test('a failure that is dated later than now is forgotten: the next request asks, and does not wait the pause out', async () => {
  for (const back of [1, POT_STATS_PAUSE_MS - 1, POT_STATS_PAUSE_MS, 3_600_000]) {
    const w = world();
    w.answerAtOnce(() => failed(502, 'origin_down'));
    assert.equal((await w.handler(look(0))).status, 502);
    assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, failed: { at: T0, fault: 'origin_down' } });
    // The clock is set back. Waited out, a failure dated an hour ahead would keep readers from the counts for an hour.
    w.clock.ms = T0 - back;
    w.answerAtOnce(() => good(counts(2)));
    assert.deepEqual(await read(await w.handler(look(1))), [200, counts(2)], `set back by ${back} ms`);
    assert.equal(w.questions.length, 2, `set back by ${back} ms`);
    assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, kept: { stats: counts(2), at: T0 - back } });
  }
});

test('a failure whose pause is over is forgotten then and there: a clock that jumps back into its 5 seconds finds no failure to wait out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  w.answerAtOnce(() => failed(502, 'origin_down'));
  assert.equal((await w.handler(look(0))).status, 502);
  // The pause is over. A request asks, and its question stays out.
  w.holdAnswers();
  w.clock.ms = T0 + POT_STATS_PAUSE_MS;
  void w.handler(look(1));
  await arrived(w.h, 2);
  assert.equal(w.questions.length, 2);
  assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, asking: { since: T0 + POT_STATS_PAUSE_MS, ended: null } });
  // The clock jumps back to a second after the old failure. The question is dated later than now and counts as
  // lost. Were the old failure still noted, it would look one second old, and the request would be turned away.
  w.clock.ms = T0 + 1_000;
  const next = w.handler(look(2));
  await arrived(w.h, 3);
  assert.equal(w.questions.length, 3, 'the request asked');
  w.questions[2]!.answer(good(counts(3)));
  assert.deepEqual(await read(await next), [200, counts(3)]);
});

// -- the four states, and a clock that jumps in each ------------------------------------------------------------------------

test('in each of the four states, with the clock as it was, set forward and set back: the first look is answered as the state says, at most one question follows a jump, and the looks after it cost the origin nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pass = (ms: number): void => {
    for (let passed = 0; passed < ms; passed += 1) t.mock.timers.tick(1);
  };
  const HOUR = 3_600_000;
  const states = ['counts', 'question', 'failure', 'nothing'] as const;
  const jumps = [
    ['as it was', 1],
    ['set forward', HOUR],
    ['set back', -HOUR],
  ] as const;
  type State = (typeof states)[number];
  type Jump = (typeof jumps)[number][0];
  const unavailable = { error: 'unavailable' };
  /**
   * What the first look after the jump is told, and how many questions it costs the origin. The counts of
   * the state are counts(1). A question asked after the jump is answered with counts(2).
   */
  const expected: Record<State, Record<Jump, [status: number, body: unknown, questions: number]>> = {
    // Kept counts are given while they are young. Too old, or dated later than now, they are thrown away.
    counts: { 'as it was': [200, counts(1), 0], 'set forward': [200, counts(2), 1], 'set back': [200, counts(2), 1] },
    // A question is waited for while it is young. Out too long, or dated later than now, it is given up on.
    question: { 'as it was': [200, counts(1), 0], 'set forward': [200, counts(2), 1], 'set back': [200, counts(2), 1] },
    // After a failure the origin is left alone for 5 seconds. A failure dated later than now is forgotten.
    failure: { 'as it was': [502, unavailable, 0], 'set forward': [200, counts(2), 1], 'set back': [200, counts(2), 1] },
    // With nothing in the holder a request asks, whatever the clock says.
    nothing: { 'as it was': [200, counts(2), 1], 'set forward': [200, counts(2), 1], 'set back': [200, counts(2), 1] },
  };

  let cases = 0;
  for (const state of states) {
    for (const [jump, by] of jumps) {
      const what = `${state}, the clock ${jump}`;
      const w = world();
      // -- the state, at T0 --
      let first: Promise<Response> | null = null;
      if (state === 'counts') {
        w.answerAtOnce(() => good(counts(1)));
        assert.equal((await w.handler(look(0))).status, 200);
      } else if (state === 'failure') {
        w.answerAtOnce(() => failed(502, 'origin_down'));
        assert.equal((await w.handler(look(0))).status, 502);
      } else if (state === 'question') {
        first = w.handler(look(0));
        await arrived(w.h, 1);
      }
      w.holdAnswers();
      assert.equal(holds(w.h.deps.potStatsHolder), state, what);
      const before = w.questions.length;
      const arrivals = state === 'nothing' ? 0 : 1;

      // -- the jump, and one look --
      w.clock.ms = T0 + by;
      const answer = w.handler(look(1));
      await arrived(w.h, arrivals + 1);
      const [status, body, cost] = expected[state][jump];
      assert.equal(w.questions.length - before, cost, `${what}: questions`);
      // Whatever is out comes back now: the state's own question with counts(1), a newer one with counts(2).
      if (state === 'question') w.questions[0]!.answer(good(counts(1)));
      if (cost === 1) w.questions[before]!.answer(good(counts(2)));
      // First the end of each question is written down, then a request that waits takes its next look.
      await turn();
      pass(POT_STATS_LOOK_MAX_MS);
      assert.deepEqual(await read(await answer), [status, body], what);
      if (first !== null) assert.deepEqual(await read(await first), [200, counts(1)], `${what}: the request that had asked`);
      holds(w.h.deps.potStatsHolder);

      // -- twenty more looks at that moment: the same answer, and no question --
      const asked = w.questions.length;
      for (let n = 0; n < 20; n += 1) assert.deepEqual(await read(await w.handler(look(2 + n))), [status, body], `${what}: look ${n} after it`);
      assert.equal(w.questions.length, asked, `${what}: the looks that follow cost the origin nothing`);
      if (status === 200) {
        // What is kept is what the look was given, dated by the clock as it runs after the jump.
        assert.deepEqual(w.h.deps.potStatsHolder, { ...EMPTY, kept: { stats: body, at: state === 'counts' && cost === 0 ? T0 : T0 + by } }, what);
      } else {
        // The one state that keeps a reader from the counts. It does so until 5 seconds after the failure, and no longer.
        w.answerAtOnce(() => good(counts(3)));
        w.clock.ms = T0 + POT_STATS_PAUSE_MS - 1;
        assert.equal((await w.handler(look(30))).status, 502, what);
        w.clock.ms = T0 + POT_STATS_PAUSE_MS;
        assert.deepEqual(await read(await w.handler(look(31))), [200, counts(3)], what);
      }
      cases += 1;
    }
  }
  assert.equal(cases, 12);
});

// -- many made-up histories ------------------------------------------------------------------------------------------------

/** Numbers that look random and are the same in every run of the tests ("mulberry32"). Each is from 0 up to, not including, 1. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

test('in 250 made-up histories of looks, answers, failures and jumps of the clock: the holder never holds two things, nothing is given or waited out past its time, the origin is asked no more often than the pause and the jumps allow, and the counts are back within 10 seconds of the origin being well', async (t) => {
  // A request that waits does so with timers. They are the test's, and no time passes on them: such a
  // request stays open, as one does whose reader waits. Everything else is answered at once.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const random = seeded(7);
  const seen = { given: 0, paused: 0, waited: 0, asked: 0, lost: 0, givenUp: 0, back: 0, broke: 0, failed: 0 };

  for (let run = 0; run < 250; run += 1) {
    const w = world();
    const holder = w.h.deps.potStatsHolder;
    /** When each good answer came, by the Worker's clock: answer number n carries passedOn n. */
    const cameAt = new Map<number, number>();
    /** How many of the questions the origin has been asked have come to an end, one way or another. */
    let ended = 0;
    let looked = 0;
    let questions = 0;
    let backSteps = 0;
    let forward = 0;

    for (let step = 0; step < 40; step += 1) {
      const roll = random();
      const now = w.clock.ms;
      if (roll < 0.55) {
        // -- a look, by a reader of its own --
        const before = w.questions.length;
        const out = holder.asking;
        const answer = w.handler(look(looked));
        looked += 1;
        await arrived(w.h, looked);
        if (w.questions.length > before) {
          // It asked. Then there was nothing to give and nothing to wait for: a question that was out was too old, or dated later than now.
          questions += 1;
          seen.asked += 1;
          if (out !== null) {
            const age = now - out.since;
            assert.ok(age < 0 || age >= POT_STATS_WAIT_MS, `run ${run}: a question ${age} ms old was given up on`);
            if (age < 0) seen.lost += 1;
            else seen.givenUp += 1;
          }
        } else if (out !== null) {
          // It waits for the question that is out, which is under 10 seconds old and not dated later than now.
          const age = now - out.since;
          assert.ok(age >= 0 && age < POT_STATS_WAIT_MS, `run ${run}: a request waits for a question ${age} ms old`);
          seen.waited += 1;
        } else {
          // It was answered from what the holder had: counts that are kept, or the note of a failure.
          const [status, body] = await read(await answer);
          if (status === 200) {
            const age = now - (cameAt.get((body as PotStats).passedOn) ?? Number.NaN);
            assert.ok(age >= 0 && age < POT_STATS_KEEP_MS, `run ${run}: counts ${age} ms old were given`);
            seen.given += 1;
          } else {
            assert.deepEqual([status, body], [502, { error: 'unavailable' }], `run ${run}`);
            const age = now - (holder.failed?.at ?? Number.NaN);
            assert.ok(age >= 0 && age < POT_STATS_PAUSE_MS, `run ${run}: a request was turned away for a failure ${age} ms old`);
            seen.paused += 1;
          }
        }
      } else if (roll < 0.8) {
        // -- the oldest question that is still open comes to an end: well, badly, by breaking, or never --
        const question = w.questions[ended];
        if (question !== undefined) {
          ended += 1;
          const how = random();
          if (how < 0.45) {
            cameAt.set(ended, now);
            question.answer(good(counts(ended)));
          } else if (how < 0.75) {
            question.answer(failed(502, 'origin_down'));
            seen.failed += 1;
          } else if (how < 0.9) {
            question.break(new Error('a question that broke'));
            seen.broke += 1;
          }
          await turn();
        }
      } else if (roll < 0.95) {
        // -- time passes: up to 20 seconds --
        const by = Math.floor(random() * 20_000);
        w.clock.ms += by;
        forward += by;
      } else {
        // -- the clock is set back: by up to a minute, or by up to an hour --
        w.clock.ms -= 1 + Math.floor(random() * (random() < 0.5 ? 60_000 : 3_600_000));
        backSteps += 1;
        seen.back += 1;
      }
      // One thing at a time, or nothing.
      holds(holder);
    }

    // The origin was asked no more often than this: once at first, and then once for every 5 seconds the
    // clock moved forward or for every time it was set back. (A question can follow an earlier one only
    // when counts, a failure or the question itself has run out, which takes 5 seconds at the least, or
    // when it is dated later than now, which takes a clock that was set back.)
    const allowed = 1 + backSteps + Math.floor(forward / POT_STATS_PAUSE_MS);
    assert.equal(w.questions.length, questions, `run ${run}`);
    assert.ok(questions <= allowed, `run ${run}: ${questions} questions, and ${allowed} allowed`);

    // From here on the origin is well. What can still keep a reader from the counts is a failure or a
    // question that is not dated later than now and has time left: 10 seconds at the most. Once that
    // time is up, the next look is given counts.
    w.answerAtOnce(() => good(counts(9_000)));
    const now = w.clock.ms;
    let until = now;
    if (holder.failed !== null && holder.failed.at <= now) until = Math.max(until, holder.failed.at + POT_STATS_PAUSE_MS);
    if (holder.asking !== null && holder.asking.since <= now) until = Math.max(until, holder.asking.since + POT_STATS_WAIT_MS);
    assert.ok(until - now <= POT_STATS_WAIT_MS, `run ${run}: ${until - now} ms`);
    w.clock.ms = until;
    const last = await w.handler(look(looked));
    assert.equal(last.status, 200, `run ${run}: the counts are back`);
    holds(holder);
  }

  // The histories went through every state and every way out of one, many times over.
  t.diagnostic(`what the 250 histories held: ${JSON.stringify(seen)}`);
  for (const [what, times] of Object.entries(seen)) assert.ok(times >= 25, `${what}: ${times}`);
});

