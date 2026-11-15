// "pnpm e2e:live": the scenarios against a real practice network.
//
// The same files as "pnpm e2e" (e2e/scenarios/), with one thing changed: the
// Worker's handler is put in front of the origin named by two settings
// instead of the stand-in.
//
//   ORIGIN_URL       the practice network's origin: Esplora under /esplora/, the bots under /bots/
//   BOTS_API_TOKEN   the bearer token the bots ask for
//   ACCESS_CLIENT_ID, ACCESS_CLIENT_SECRET   optional: the Access service token, when the origin is behind one
//   E2E_FILES        optional: run only these scenario files, named as they stand in e2e/scenarios/
//                    and separated by commas ("chain.test.ts,worker.test.ts"). Without it, every file.
//                    A name that is no scenario file there stops the run: a typing mistake must
//                    never pass for a run of fewer scenarios.
//
// Everything else stays local: the app is served from this machine, the bot
// check is the stand-in, events go to the recorder. Scenarios that drive the
// stand-in network cannot run here and are reported as skipped.
//
// Without both settings nothing is run, and that is said: "not run" is not
// a pass, so the exit code is 2. The same when the settings are there and
// yet no scenario ran to the end.
//
// Only the orchestrator runs this against the real network (BRIEF rule 2).

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { fileURLToPath } from 'node:url';

const { ORIGIN_URL, BOTS_API_TOKEN } = process.env;
if (!ORIGIN_URL || !BOTS_API_TOKEN) {
  const missing = [!ORIGIN_URL && 'ORIGIN_URL', !BOTS_API_TOKEN && 'BOTS_API_TOKEN'].filter(Boolean).join(' and ');
  console.log(`not run: ${missing} ${ORIGIN_URL || BOTS_API_TOKEN ? 'is' : 'are'} not set. The live run needs a real practice origin and its bots token.`);
  process.exit(2);
}

let originHost: string;
try {
  originHost = new URL(ORIGIN_URL).host;
} catch {
  console.log('not run: ORIGIN_URL is not a URL.');
  process.exit(2);
}

// The scenario files read this (scenarios/helpers.ts). Each runs in a process of its own and inherits it.
process.env.E2E_LIVE = '1';

// The files "pnpm e2e" runs: every *.test.ts, in the folders inside the folder too. (scenarios/helpers.ts
// stops every run on a file of any other name, so the two commands cannot come to run different sets.)
const folder = fileURLToPath(new URL('../scenarios/', import.meta.url));
const every = readdirSync(folder, { recursive: true, encoding: 'utf8' })
  .filter((name) => name.endsWith('.test.ts'))
  .sort();

// E2E_FILES names some of them: for a run that is meant to be short, such as the test of this very
// program, which only has to see that the scenarios reach an origin through the Worker.
const asked = (process.env.E2E_FILES ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name !== '');
const unknown = asked.filter((name) => !every.includes(name));
if (unknown.length > 0) {
  console.log(`not run: E2E_FILES names ${unknown.join(', ')}, which ${unknown.length === 1 ? 'is' : 'are'} not in e2e/scenarios. There are: ${every.join(', ')}.`);
  process.exit(2);
}
const chosen = asked.length === 0 ? every : every.filter((name) => asked.includes(name));
const files = chosen.map((name) => join(folder, name));

let passed = 0;
let failed = 0;
let skipped = 0;
const tests = run({ files });
tests.on('test:pass', (event) => {
  if (event.details.type !== 'test') return;
  if (event.skip !== undefined || event.todo !== undefined) skipped += 1;
  else passed += 1;
});
tests.on('test:fail', () => {
  failed += 1;
});
tests.compose(spec).pipe(process.stdout);
tests.on('end', () => {
  // The reporter's last lines are still on their way out.
  setImmediate(() => {
    // A run of some of the files says so, where the count is read: it is not the whole live run.
    if (chosen.length < every.length) console.log(`only ${chosen.join(', ')}: ${chosen.length} of ${every.length} scenario files (E2E_FILES)`);
    console.log(`live run against ${originHost}: ${passed} passed, ${failed} failed, ${skipped} skipped (local only)`);
    if (failed > 0) process.exitCode = 1;
    else if (passed === 0) {
      console.log('not run: no scenario ran to the end against the origin.');
      process.exitCode = 2;
    }
  });
});
