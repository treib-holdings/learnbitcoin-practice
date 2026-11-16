// The pot's counts: one answer of the origin's for all the readers that one
// isolate of the Worker serves.
//
// While the settings switch it on (handler.ts, config.potCounts), GET
// /api/pot/stats is open to anybody. It is a plain GET, with no page of
// ours behind it and no bot check. Each reader has a budget for it
// (handler.ts, POT_STATS), but a budget for each reader is no cap for all
// readers together. And what one answer costs the practice network is not
// fixed: it can grow with the number of coins that wait in the pot, and
// anybody can add coins to the pot.
//
// The counts are the same for every reader, and they change only when a
// block comes or the faucet pays. So the Worker does not ask the origin for
// them once per request. An isolate of it asks once, and gives every
// request it answers that answer:
//
//   - A good answer is kept for 15 seconds from the moment it came
//     (POT_STATS_KEEP_MS). Until then every request is given it, and the
//     origin is not asked.
//   - While a question is out, every request that arrives waits for that
//     same question. However many arrive, the origin has one to answer.
//   - An answer that failed is never kept, and never given out as counts: a
//     refusal, a body that is not the three counts, no answer in time.
//     Those who waited for it are told "unavailable". So is every request
//     that arrives in the 5 seconds after it failed (POT_STATS_PAUSE_MS),
//     and the origin is not asked for any of them. Without that pause, an
//     origin that fails or is slow would be asked again the moment it had
//     failed, and again: it would get no rest in the one state in which
//     each question may cost it the most. (The same pause follows a
//     question that broke, which is a mistake of ours and not an answer.)
//
// The reader's own budget is counted before any of this (handler.ts), so a
// reader who is over it is refused, whatever is kept here.
//
// A count that is given may therefore be up to 15 seconds old, and as much
// older as the origin took to answer. Whatever shows one must say no more
// of it than that.
//
//
// Where the answer is kept, and what that bounds
//
// In a PotStatsHolder (deps.ts). The deployed Worker makes one at the top
// of index.ts, outside any request, and Cloudflare's documentation says
// what becomes of such a value (developers.cloudflare.com/workers/, under
// reference/how-workers-works and platform/limits):
//
//   - A Worker runs in an isolate, and one isolate answers many requests,
//     also at the same time. What a module holds at its top is still there
//     for the next request that the same isolate answers.
//   - An isolate is not promised a long life. Cloudflare may end one at
//     any time (when the machine runs short, say, or when the isolate
//     passes its memory limit) and starts a new one for the requests that
//     follow. A new isolate begins with nothing kept.
//   - No two requests are promised the same isolate, and there can be many
//     at once: the network is thousands of machines in hundreds of
//     locations, and a request is answered where it arrives.
//
// So the bound is one for each isolate, not one for each location and not
// one for the whole network. An isolate has at most one question out at a
// time. After a good answer it asks no other for 15 seconds, which is four
// questions a minute, whoever asks and however often. After an answer that
// failed it asks no other for 5 seconds: about twelve a minute when every
// question fails at once, and fewer the longer each takes to fail. Losing
// an isolate loses what it kept and nothing else, and costs one question.
//
// What this file cannot bound is how many isolates there are to ask. The
// looks of one caller are not promised the same isolate either: sent one
// after another, each over a connection of its own, they may each reach a
// different one, and each of those asks for itself. Nothing here measures
// that. So every figure above is a figure for one isolate, and none of
// them is a cap on what the practice network is asked in all. That is why
// the counts are switched off as the Worker ships (POT_COUNTS in
// wrangler.jsonc, which says when they may be switched on).
//
// The documentation warns against keeping state at the top of a module,
// for two reasons: what one request leaves there the next one sees, and
// what is there may be gone, or be in another isolate, when it is looked
// for. Neither does harm here. What is kept belongs to no request and to
// no reader: it is three counts that are the same for everybody. And the
// Worker counts on finding it again for nothing but saving a question.
//
// Cloudflare's cache (caches.default) would share a kept answer between the
// isolates of one location: the documentation says that an entry is kept
// under the address of a GET, that it stays in the location that put it
// there, and that it works on a custom domain such as this Worker's
// (runtime-apis/cache and reference/how-the-cache-works). It was not used,
// for three reasons.
//
//   - It cannot hold a question that is still out. That has to live in the
//     isolate's memory whatever keeps the answer, so the cache would be a
//     second holder beside this one, not one in its place.
//   - Each request would cost a read of the cache, which is a wait for
//     something outside the Worker. Here a request that is given the kept
//     answer waits for nothing.
//   - How long an entry lives would be Cloudflare's to decide, from a
//     Cache-Control header on a second copy of the answer that says the
//     opposite of the "no-store" every answer of this Worker carries
//     (headers.ts). No test could hold that to a clock. Here the rule is a
//     few lines that the tests run with a clock of their own.
//
// What the cache would give, and this holder does not, is one kept answer
// for all the isolates of a location. How much that is worth depends on
// how the looks arrive. When an entry runs out, every isolate that has a
// request in hand at that moment would still ask, each for itself. So
// under a flood, with every isolate busy, the cache comes to the same
// bound as this holder: one question for each isolate. It is the same
// bound only then. For looks that come a few at a time and are spread
// over many isolates, the first isolate's answer would serve the others
// of its location from the cache, and here each of them asks for itself.
// This file does not make up for that difference. The setting does: the
// counts stay switched off until it no longer matters (above).
//
//
// How a request waits for a question that another request asked
//
// The runtime ties everything a request reads or sends to that request.
// Cloudflare's documentation (workers/observability/errors) says that a
// Request, a Response or a body must not be kept for another request, and
// that plain data may. So what crosses from one request to another here is
// plain data and nothing else: the three counts, two times, and how a
// question ended. Never a Response (each request writes its own,
// handler.ts), and never a promise.
//
// A request that finds a question out does not wait for the other request's
// promise. It looks at the note of the question (PotStatsQuestion in
// deps.ts) with a timer of its own: after 25 ms, and then at growing
// intervals, at most a quarter of a second apart, until the note says how
// the question ended. So it is told a moment after the answer came, and at
// most a quarter of a second after.
//
// The runtime would let it wait for the promise itself. That is the
// compatibility flag handle_cross_request_promise_resolution, which is on
// by itself under a compatibility date as late as this Worker's
// (workers/configuration/compatibility-flags). It was tried in workerd, the
// runtime that wrangler runs on a developer's machine, and it worked. It
// was not used, for two things seen there that are not in the
// documentation:
//
//   - For every request that had waited and had ended before the question
//     did, the runtime wrote a warning into the log, with the advice to
//     switch that flag off. It was seen for requests that had given up
//     waiting. By the warning's own words it is written for a request that
//     was cancelled, too, which is what may become of a request whose
//     reader leaves. The log of this Worker is one line of our own for a
//     request (the end of handler.ts), and the app tells its readers so. A
//     second line, which a reader could cause, has no place in it.
//   - The runtime stops a request that waits for a promise of its own
//     which nothing will ever settle. It does not stop one that waits for
//     a promise another request made: such a request hangs for as long as
//     its reader stays.
//
// A timer has neither drawback. It is the request's own, and so is
// everything that follows from it.
//
// Two more things make the waiting safe.
//
//   - The request that asks hands its question to waitUntil. Work done for
//     a request may be stopped when its reader goes away; what was handed
//     to waitUntil goes on for up to 30 seconds more (workers/runtime-apis/context).
//     So a reader who leaves early does not take the answer away from
//     everybody who waits for it.
//   - Nobody waits without end. A request waits for a question that is not
//     its own until 10 seconds after the question was asked
//     (POT_STATS_WAIT_MS), and no longer. Then it is told "unavailable",
//     and the question is given up on: the next request asks anew.
//
//
// The four states, and the clock
//
// The holder is in one of four states, and never in two (deps.ts says
// why). In each, a request that has passed the limiter does one thing:
//
//   counts are kept       younger than 15 seconds: the request is given
//                         them. The origin is not asked.
//   a question is out     younger than 10 seconds: the request waits for
//                         it. The origin is not asked again.
//   a failure is noted    younger than 5 seconds: the request is told
//                         "unavailable". The origin is not asked.
//   none of these         the request asks, and notes its question.
//
// Whatever has grown too old is dropped where it is found, and the request
// then asks, as in the last line. So while the clock runs forward, the
// questions of one isolate are at least 5 seconds apart. The next one
// comes no sooner than 15 seconds after counts came, 5 seconds after a
// failure, or 10 seconds after a question was asked that never came back.
//
// All of this is timed by one clock (Deps.now), and a clock can be set.
// Set back, it leaves things in the holder dated later than now. Such a
// date says nothing about how old a thing is, so none of the three is
// trusted on the strength of it: counts dated later than now are thrown
// away, a question dated later than now counts as lost, and a failure
// dated later than now is forgotten. Each is dropped as if it had grown
// too old. Waited out instead, a question or a failure dated an hour
// ahead would keep readers from the counts for an hour: nobody would ask,
// and nothing would be kept.
//
// So a clock that jumps, forward or back, cannot keep readers from the
// counts for longer than a state's own time, counted from the jump: 5
// seconds after a failure, 10 seconds for a question that does not come
// back. And one jump can cost the origin one question that it would not
// have been asked yet, and no more than one: what follows that question
// is dated by the clock as it then runs. (A clock that went back at every
// look would have every look ask. The Worker has no second clock to tell
// that by.)

import type { PotStats } from '@learnbitcoin/practice-contract';
import type { Deps, Fault, Origin, OriginAnswer, PotStatsHolder, PotStatsQuestion } from './deps.ts';

/**
 * How long a good answer is given to every request, in milliseconds, from
 * the moment it came: half the time between two practice blocks.
 */
export const POT_STATS_KEEP_MS = 15_000;

/**
 * How long after it was asked a question is still waited for, in
 * milliseconds. The origin is given 8 seconds to answer (origin.ts), so a
 * question that is older than this is not coming back.
 */
export const POT_STATS_WAIT_MS = 10_000;

/**
 * How long the origin is left alone after a question that brought no
 * counts, in milliseconds, from the moment that question ended. Until then
 * every request is told "unavailable" and nobody is asked. Long enough to
 * space the questions to an origin that fails or is slow, and short enough
 * that readers have the counts again soon after it is well: a third of the
 * time that counts are kept.
 */
export const POT_STATS_PAUSE_MS = 5_000;

/**
 * How a request that waits looks for the answer: the first time after
 * POT_STATS_LOOK_FIRST_MS, then after twice as long each time, and never
 * after longer than POT_STATS_LOOK_MAX_MS. Looking more often at first tells
 * a quick answer on quickly. Looking less often later keeps a crowd that
 * waits for a slow answer from keeping the isolate busy with timers.
 */
export const POT_STATS_LOOK_FIRST_MS = 25;
export const POT_STATS_LOOK_MAX_MS = 250;

/**
 * The counts for one request, or why there are none. `upstream` is the
 * origin's status, and null when the origin was not asked for this request:
 * the counts are the kept ones then, or there are none because a question
 * failed a moment ago or never came back.
 */
export type PotStatsAnswer =
  | { ok: true; value: Readonly<PotStats>; upstream: number | null }
  | Extract<OriginAnswer<PotStats>, { ok: false }>;

/** A holder with nothing kept, no question out and no failure noted. Made once, where it outlives a request (deps.ts). */
export function makePotStatsHolder(): PotStatsHolder {
  return { kept: null, asking: null, failed: null };
}

/**
 * "Unavailable", for a request the origin was not asked for. The fault is
 * for the owner's log: why there are no counts to give.
 */
function unavailable(fault: Fault | null): PotStatsAnswer {
  return { ok: false, code: 'unavailable', detail: null, upstream: null, fault };
}

/** What a request is told when the question it waited for did not come back in time. */
const NO_ANSWER: PotStatsAnswer = unavailable('origin_timeout');

/**
 * One question to the origin. The three counts are taken out of its answer
 * here, into an object of their own that nothing can change afterwards:
 * whatever else the answer held beside them is neither kept nor passed on.
 */
async function askOrigin(origin: Origin): Promise<OriginAnswer<PotStats>> {
  const result = await origin.potStats();
  if (!result.ok) return result;
  const { passedOn, waiting, handedOn } = result.value;
  return { ok: true, value: Object.freeze({ passedOn, waiting, handedOn }), upstream: result.upstream };
}

/**
 * Waits for a question that another request asked, for `ms` at the most,
 * by looking at the note of it with a timer of this request's own (the top
 * of this file says why). Rejects if the question itself broke.
 */
function waitFor(question: PotStatsQuestion, ms: number): Promise<PotStatsAnswer> {
  return new Promise((resolve, reject) => {
    let waited = 0;
    let step = POT_STATS_LOOK_FIRST_MS;
    const look = (): void => {
      const { ended } = question;
      // The error itself stays with the request it was thrown in. This one names nothing.
      if (ended === 'broke') return reject(new Error('the question for the pot counts broke'));
      if (ended !== null) return resolve(ended);
      if (waited >= ms) return resolve(NO_ANSWER);
      const next = Math.min(step, ms - waited);
      waited += next;
      step = Math.min(step * 2, POT_STATS_LOOK_MAX_MS);
      setTimeout(look, next);
    };
    look();
  });
}

/**
 * The pot's counts for one request: the kept ones while they are young
 * enough, or else the origin's, asked for once for every request that
 * waits. For a short time after a question that brought no counts it is
 * "unavailable", and the origin is not asked.
 *
 * It rejects only when the question itself threw, which is a mistake of
 * ours: the handler answers that as it answers every such mistake.
 */
export async function potStatsForAll(deps: Pick<Deps, 'origin' | 'potStatsHolder' | 'waitUntil' | 'now'>): Promise<PotStatsAnswer> {
  const holder = deps.potStatsHolder;
  const now = deps.now();

  // From here to the line that notes the new question nothing is waited
  // for, so no other request can come in between: of all the requests that
  // find no counts to give and no failure to wait out, exactly one asks.
  //
  // Each of the three things the holder can hold is good for its own time,
  // counted from its date. One that is dated later than now (a clock that
  // was set back) is no better than one that is too old: both are dropped.

  if (holder.kept !== null) {
    const age = now - holder.kept.at;
    if (age >= 0 && age < POT_STATS_KEEP_MS) return { ok: true, value: holder.kept.stats, upstream: null };
    // Too old, or dated later than now. It is thrown away here, so that
    // nothing can make it young again.
    holder.kept = null;
  }

  const out = holder.asking;
  if (out !== null) {
    // A question is out: wait for it, as every request that arrives
    // meanwhile does, until 10 seconds after it was asked.
    const age = now - out.since;
    if (age >= 0 && age < POT_STATS_WAIT_MS) return waitFor(out, POT_STATS_WAIT_MS - age);
    // It has been out for longer than the origin is given, or it is dated
    // later than now, which says nothing about how long it has been out.
    // Either way it is given up on, and the question asked below takes
    // its place. (Taken for a question just asked, one dated an hour
    // ahead would be waited for by every request for an hour.)
  }

  if (holder.failed !== null) {
    // A question brought no counts a moment ago. The origin is left alone
    // for 5 seconds from that moment, and this request is told what those
    // who waited for that question were told: "unavailable", with its fault.
    const age = now - holder.failed.at;
    if (age >= 0 && age < POT_STATS_PAUSE_MS) return unavailable(holder.failed.fault);
    // The pause is over, or the failure is dated later than now. It is
    // forgotten here, so that nothing can make it recent again.
    holder.failed = null;
  }

  const asking: PotStatsQuestion = { since: now, ended: null };
  holder.asking = asking;
  const question = askOrigin(deps.origin);
  // What becomes of the answer is settled here, before the request that
  // asked goes on: this is the first thing to follow the question. It is
  // handed to waitUntil, so that the question is seen through, and its end
  // written down for those who wait, even if the reader of this request
  // goes away. (It never rejects.)
  deps.waitUntil(
    question.then(
      (answer) => {
        asking.ended = answer;
        // A question that was given up on meanwhile keeps nothing and
        // starts no pause: a newer one is out, and what that one brings is
        // what counts.
        if (holder.asking !== asking) return;
        holder.asking = null;
        // Counts are kept. Anything else is a failure: it is never kept as
        // an answer, and the origin is not asked again until 5 seconds on.
        if (answer.ok) holder.kept = { stats: answer.value, at: deps.now() };
        else holder.failed = { at: deps.now(), fault: answer.fault };
      },
      () => {
        asking.ended = 'broke';
        // The same for a question that broke: only the one that is out is
        // taken off, and only that one starts a pause. One that was given
        // up on, and breaks later, leaves the newer question where it is.
        if (holder.asking !== asking) return;
        holder.asking = null;
        holder.failed = { at: deps.now(), fault: 'handler' };
      },
    ),
  );
  return question;
}
