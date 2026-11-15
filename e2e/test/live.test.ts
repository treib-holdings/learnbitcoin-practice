// The live runner, run as the program it is.
//
// Without its two settings it runs nothing and says "not run". With the
// settings pointed at a second stand-in network on a socket of its own, the
// scenarios that can run anywhere run through the Worker's real way to an
// origin (makeOrigin), and the ones that drive the stand-in are reported as
// skipped. Nobody but the orchestrator points it at the real network.
//
// Here the runner is given the two small scenario files only (E2E_FILES):
// the chain through the page's own fetch, and the Worker's own answers.
// They are enough to show what this file is about, that scenarios reach a
// second network through the Worker and that local-only ones are skipped.
// With every screen's scenarios the two runs below took minutes, and grew
// with each screen.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeFakeOrigin } from '../src/fake-origin.ts';
import { buildApp } from '../src/smoke.ts';

const E2E = fileURLToPath(new URL('../', import.meta.url));

/** The scenario files the runs below are given. Their scenarios are counted at the end of the second test. */
const FILES = 'chain.test.ts,worker.test.ts';

/** A folder of this test's own for everything the runs write, so that what they leave behind can be counted. */
let temp: string;
/** The real app, built once: the scenarios run against it. */
let appDist: string;
before(async () => {
  temp = mkdtempSync(join(tmpdir(), 'lbp-live-test-'));
  appDist = join(temp, 'app-dist');
  assert.deepEqual(await buildApp(appDist), []);
});
after(() => {
  rmSync(temp, { recursive: true, force: true });
});

/** Runs the live runner with these settings and gives its exit code and everything it printed. */
function run(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, TMPDIR: temp, E2E_DIST: appDist, ...env };
  // This file runs under the test runner, which says so in the environment. The runner started here must not think it is inside a test.
  delete childEnv.NODE_TEST_CONTEXT;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(E2E, 'src', 'live.ts')], { cwd: E2E, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('live: without the two settings nothing is run, and that is not a pass', async () => {
  const none = await run({ ORIGIN_URL: '', BOTS_API_TOKEN: '' });
  assert.equal(none.code, 2);
  assert.match(none.output, /^not run: ORIGIN_URL and BOTS_API_TOKEN are not set\./);
  assert.doesNotMatch(none.output, /pass/);

  const half = await run({ ORIGIN_URL: 'http://127.0.0.1:9', BOTS_API_TOKEN: '' });
  assert.equal(half.code, 2);
  assert.match(half.output, /^not run: BOTS_API_TOKEN is not set\./);

  const nonsense = await run({ ORIGIN_URL: 'not a url', BOTS_API_TOKEN: 'x' });
  assert.equal(nonsense.code, 2);
  assert.match(nonsense.output, /^not run: ORIGIN_URL is not a URL\./);
});

test('live: E2E_FILES chooses scenario files by name, and a name that is no scenario file stops the run', async () => {
  const settings = { ORIGIN_URL: 'http://127.0.0.1:9', BOTS_API_TOKEN: 'x' };
  // Nothing is started for a name that is not there: no Chrome, no server.
  const wrong = await run({ ...settings, E2E_FILES: 'chain.test.ts,chian.test.ts' });
  assert.equal(wrong.code, 2);
  assert.match(wrong.output, /^not run: E2E_FILES names chian\.test\.ts, which is not in e2e\/scenarios\. There are: /);
  assert.match(wrong.output, /\bchain\.test\.ts\b.*\bworker\.test\.ts\b/);
  // No verdict of any kind: neither the runner's "passed" nor the reporter's "pass". As whole words:
  // the list of files above is part of this output, and a file of scenarios may be named for passkeys.
  assert.doesNotMatch(wrong.output, /\bpass(ed)?\b/);
  const two = await run({ ...settings, E2E_FILES: 'nothing.ts, also-nothing.test.ts' });
  assert.equal(two.code, 2);
  assert.match(two.output, /^not run: E2E_FILES names nothing\.ts, also-nothing\.test\.ts, which are not in e2e\/scenarios\./);
});

test('live: pointed at a second stand-in over HTTP, the scenarios run through the Worker\'s own way to an origin', async () => {
  // Two "real" networks, each known to its run by an address and a token and by nothing else.
  // They make their own blocks, as a real network does: nobody in a run can tell them to.
  const network = makeFakeOrigin({ seed: 'elsewhere', height: 700, token: 'the-token-of-the-second-network' });
  const other = makeFakeOrigin({ token: 'another-token' });
  const [listening, otherListening] = await Promise.all([network.listen(), other.listen()]);
  const mining = setInterval(() => {
    network.mine();
    other.mine();
  }, 400);
  try {
    const [ran, wrongToken] = await Promise.all([
      run({ ORIGIN_URL: listening.url, BOTS_API_TOKEN: 'the-token-of-the-second-network', E2E_FILES: FILES }),
      run({ ORIGIN_URL: otherListening.url, BOTS_API_TOKEN: 'not-that-token', E2E_FILES: FILES }),
    ]);

    assert.equal(ran.code, 0, ran.output);
    const summary = /^live run against 127\.0\.0\.1:[0-9]+: ([0-9]+) passed, ([0-9]+) failed, ([0-9]+) skipped \(local only\)$/m.exec(ran.output);
    assert.ok(summary, ran.output);
    const [passed, failed, skipped] = summary.slice(1).map(Number);
    assert.equal(failed, 0);
    // The two files hold seven scenarios. Five run anywhere: the chain through the page's own
    // fetch, and the Worker's four.
    assert.equal(passed, 5, ran.output);
    // The other two drive the stand-in, one from its first line and one by declaration, and are
    // reported as skipped: never as passed, and never left out.
    assert.equal(skipped, 2, ran.output);
    assert.match(ran.output, /a funded wallet.*# local only/);
    assert.match(ran.output, /a busy faucet.*# local only/);
    // A run of some of the files says that it is one, beside the count.
    assert.match(ran.output, /^only chain\.test\.ts, worker\.test\.ts: 2 of [0-9]+ scenario files \(E2E_FILES\)$/m);
    // And no scenario of any other file was run.
    assert.doesNotMatch(ran.output, /Home with no wallet|the faucet pays|Remove asks first/);

    // The second network was really asked, by the handler (the chain through the page's own fetch,
    // the pot's address with the token) and by the scenario's own second opinion.
    const asked = network.requests().map((request) => `${request.method} ${request.path}`);
    assert.ok(asked.filter((line) => line === 'GET /esplora/blocks/tip/height').length >= 4, asked.join('\n'));
    assert.ok(asked.some((line) => /^GET \/esplora\/address\/bcrt1[0-9a-z]+\/utxo$/.test(line)));
    assert.ok(asked.includes('GET /bots/pot/address'));
    // No scenario that ran asked the faucet of a network it does not own.
    assert.ok(!asked.includes('POST /bots/faucet'));

    // The wrong token: a scenario fails, and so does the run.
    assert.equal(wrongToken.code, 1, wrongToken.output);
    assert.match(wrongToken.output, /, [1-9][0-9]* failed, /);
  } finally {
    clearInterval(mining);
    await Promise.all([listening.close(), otherListening.close()]);
  }
  // Nothing of the runs is left: no browser profile.
  assert.deepEqual(readdirSync(temp), ['app-dist']);
});
