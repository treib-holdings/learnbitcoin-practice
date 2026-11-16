// The pot's counts: one answer of the origin's for everyone (src/pot-stats.ts).
//
// GET /api/pot/stats is open to anybody, and what an answer costs the
// practice network can grow with something a stranger controls. So the
// Worker must not ask the origin once per request. Every test here goes
// through the real handler, by the route's own door, with an origin that
// counts how often it is asked and a clock the test moves by hand. All but
// one of them fail against a handler that asks for every request. The one
// that does not (a clock that is set back) holds the keeping to its limits:
// it fails when counts are kept longer, or kept when they should not be.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API, ERROR_STATUS } from '@learnbitcoin/practice-contract';
import type { PotStats } from '@learnbitcoin/practice-contract';
import type { Fault, Handler, Limiter, OriginAnswer, PotStatsHolder } from '../src/deps.ts';
import { makeHandler } from '../src/handler.ts';
import { FIXED_HEADERS } from '../src/headers.ts';
import { ORIGIN_TIMEOUT_MS } from '../src/origin.ts';
import { POT_STATS_KEEP_MS, POT_STATS_LOOK_FIRST_MS, POT_STATS_LOOK_MAX_MS, POT_STATS_WAIT_MS, makePotStatsHolder } from '../src/pot-stats.ts';
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
  assert.deepEqual(w.h.deps.potStatsHolder, { kept: { stats: counts(1), at: came }, asking: null });

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

test('an answer that failed is not kept: everyone who waited for it is told, and the next request asks again', async () => {
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
    assert.deepEqual(w.h.deps.potStatsHolder, { kept: null, asking: null }, `${what}: nothing was kept`);

    // The next request asks again, at once: there is nothing to wait out.
    w.answerAtOnce(() => failed(upstream, fault));
    assert.equal((await w.handler(look(10))).status, 502, what);
    assert.equal(w.questions.length, 2, what);
    // And when the origin answers well, that answer is kept like any other.
    w.answerAtOnce(() => good());
    assert.deepEqual(await read(await w.handler(look(11))), [200, POT_COUNTS], what);
    assert.deepEqual(await read(await w.handler(look(12))), [200, POT_COUNTS], what);
    assert.equal(w.questions.length, 3, what);
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
  // Once they are too old, a reader is told "unavailable", not given the old counts.
  w.clock.ms = T0 + POT_STATS_KEEP_MS;
  for (let n = 0; n < 3; n += 1) {
    const response = await w.handler(look(n));
    assert.equal(response.status, 502);
    assert.deepEqual(await errorOf(response), { error: 'unavailable' });
  }
  assert.equal(w.questions.length, 4, 'each of the three asked: a failure is not kept either');
  assert.deepEqual(w.h.lines.slice(-3), [0, 1, 2].map(() => ({ route: 'pot_stats', status: 502, upstream: 502, ms: 0, fault: 'origin_down' })));
});

test('a question that breaks is our own mistake: everyone who waited is told "unavailable", the log says "handler", and nothing is left behind', async () => {
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
  assert.deepEqual(w.h.deps.potStatsHolder, { kept: null, asking: null });
  // What was handed to waitUntil does not reject, so the runtime has no stray failure to report.
  await Promise.all(w.h.pending);
  // The next request is not held up by the broken question: it asks.
  w.answerAtOnce(() => good());
  assert.deepEqual(await read(await w.handler(look(5))), [200, POT_COUNTS]);
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
  assert.deepEqual(w.h.deps.potStatsHolder, { kept: { stats: counts(7), at: T0 + POT_STATS_WAIT_MS }, asking: null });

  // Should the old question come back after all, its answer goes to the request that asked it and is not kept:
  // a newer answer is.
  w.questions[0]!.answer(good(counts(99)));
  assert.deepEqual(await read(await asker), [200, counts(99)]);
  assert.deepEqual(w.h.deps.potStatsHolder, { kept: { stats: counts(7), at: T0 + POT_STATS_WAIT_MS }, asking: null });
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
  // The old question fails late. The one that is out stays out, and a third request waits for it.
  w.questions[0]!.answer(failed(null, 'origin_timeout'));
  assert.equal((await asker).status, 502);
  const third = w.handler(look(2));
  await arrived(w.h, 3);
  assert.equal(w.questions.length, 2, 'the third request waits for the second question');
  w.questions[1]!.answer(good(counts(4)));
  assert.deepEqual(await read(await second), [200, counts(4)]);
  assert.deepEqual(await read(await third), [200, counts(4)]);
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

test("the reader's own budget is counted first, and a reader over it is refused: with counts kept, with a question out, and with neither", async () => {
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
  assert.deepEqual(fresh.h.deps.potStatsHolder, { kept: null, asking: null });
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
  assert.equal(JSON.stringify(holder), `{"kept":null,"asking":{"since":${T0},"ended":null}}`);

  w.clock.ms = T0 + 250;
  w.questions[0]!.answer(good(padded));
  assert.equal((await asker).status, 200);
  assert.equal(JSON.stringify(holder), `{"kept":{"stats":{"passedOn":12,"waiting":3,"handedOn":9},"at":${T0 + 250}},"asking":null}`);
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
  assert.deepEqual(makePotStatsHolder(), { kept: null, asking: null });
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
