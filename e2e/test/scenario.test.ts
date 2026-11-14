// scenario(), the wrapper every end-to-end scenario stands on: what it lets
// pass, and what it does not.
//
// A wrapper that passes a scenario it should have failed proves nothing, and
// nobody would notice. So the scenarios here are broken on purpose, each in
// one way, and the wrapper has to fail each of them and say why. They are
// written to a temporary file and run as a scenario file is run, by the test
// runner in a process of its own, against a small scratch site.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DUMMY_TOKEN, botCheckProblems, strayFiles } from '../scenarios/helpers.ts';
import type { StandInCall } from '../src/fake-turnstile.ts';
import { scratchDist } from './scratch-site.ts';

const E2E = fileURLToPath(new URL('../', import.meta.url));
const HELPERS = pathToFileURL(join(E2E, 'scenarios', 'helpers.ts')).href;

let temp: string;
before(() => {
  temp = mkdtempSync(join(tmpdir(), 'lbp-scenario-test-'));
});
after(() => {
  rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

// -- the folder's rule -------------------------------------------------------------------

test('a file in the scenarios folder that a run would pass over stops every run', () => {
  const folder = join(temp, 'scenarios');
  mkdirSync(join(folder, 'wallet'), { recursive: true });
  const write = (name: string) => writeFileSync(join(folder, name), '// a file\n');
  for (const name of ['helpers.ts', 'send.test.ts', 'wallet/receive.test.ts', 'wallet/steps-helpers.ts', 'notes.md', 'fixture.json']) write(name);
  // Scenario files, helpers, and files that are not code: nothing to say.
  assert.deepEqual(strayFiles(folder), []);
  assert.deepEqual(strayFiles(`${folder}/`), []);

  // Each of these holds scenarios that one run or the other would never run, and neither would say so:
  // the test runner passes over the first, and the live run over all four.
  for (const name of ['restore.ts', 'send-test.ts', 'test-faucet.ts', 'wallet/tabs.spec.ts']) write(name);
  assert.deepEqual(strayFiles(folder), [
    'restore.ts is neither a scenario file (*.test.ts) nor a helper (*helpers.ts): a run would pass over what is in it without a word',
    'send-test.ts is neither a scenario file (*.test.ts) nor a helper (*helpers.ts): a run would pass over what is in it without a word',
    'test-faucet.ts is neither a scenario file (*.test.ts) nor a helper (*helpers.ts): a run would pass over what is in it without a word',
    `${join('wallet', 'tabs.spec.ts')} is neither a scenario file (*.test.ts) nor a helper (*helpers.ts): a run would pass over what is in it without a word`,
  ]);
  // This repository's own folder is in order: helpers.ts checked it when this file loaded it, and would have thrown.
  assert.deepEqual(strayFiles(join(E2E, 'scenarios')), []);
});

// -- the bot check's widget against what the faucet was asked -----------------------------

test('what the bot check was drawn for is held against what the faucet was asked', () => {
  const A = 'bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk';
  const B = 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6';
  const render = (action: unknown, cData: unknown): StandInCall => ({ op: 'render', id: 'stand-in-1', options: { sitekey: 'x', action, cData }, callbacks: ['callback'] });
  const asked = (address: string, token = DUMMY_TOKEN) => ({ token, address });

  // As the app does it: a widget for the faucet and the address, then the faucet asked for that address.
  assert.deepEqual(botCheckProblems([render('faucet', A)], [asked(A)]), []);
  // The address changed ("Show a new address"), and a new widget was drawn for it.
  assert.deepEqual(botCheckProblems([render('faucet', A), { op: 'remove', id: 'stand-in-1' }, render('faucet', B)], [asked(A), asked(B)]), []);
  // A widget that was drawn and never used, and a faucet that was never asked.
  assert.deepEqual(botCheckProblems([render('faucet', A)], []), []);
  // No widget at all: a scenario that posts to the faucet by hand is left alone.
  assert.deepEqual(botCheckProblems([], [asked(A)]), []);
  assert.deepEqual(botCheckProblems([{ op: 'reset', id: 'stand-in-1' }], [asked(A)]), []);

  // The address changed and the widget did not: the deployed Worker would refuse the token.
  assert.deepEqual(botCheckProblems([render('faucet', A)], [asked(A), asked(B)]), [
    `the faucet was asked to pay ${B}, and no bot check widget was drawn for that address (cData): the deployed Worker would refuse the token`,
  ]);
  // A widget for another action, or for none.
  assert.deepEqual(botCheckProblems([render('login', A)], [asked(A)]), [
    'a bot check widget was drawn for the action "login": the deployed Worker takes a token made for "faucet" and no other',
  ]);
  assert.match(botCheckProblems([render(undefined, undefined)], [asked(A)]).join('\n'), /for the action undefined:[^]*no bot check widget was drawn for that address/);
  // A token that is not the dummy token is refused by the local bot check itself: nothing to add.
  assert.deepEqual(botCheckProblems([render('faucet', A)], [asked(B, 'not-the-dummy-token')]), []);
});

// -- scenarios that are broken on purpose --------------------------------------------------

/** The scratch scenarios. Each name starts with the word the test below knows it by. */
const SCENARIOS = `
import assert from 'node:assert/strict';
import { DUMMY_TOKEN, freshRecord, scenario, testRecord } from ${JSON.stringify(HELPERS)};

const later = (ms) => new Promise((wake) => setTimeout(wake, ms));
const height = (page) => page.page.evaluate(async () => (await fetch('/api/esplora/blocks/tip/height')).status);

scenario('clean: a page is opened and all is well', async (s) => {
  const page = await s.open('/');
  assert.equal(page.status, 200);
  assert.equal(await height(page), 200);
});

scenario('late-throw: the last step makes the page throw a moment later', async (s) => {
  const page = await s.open('/');
  await page.page.evaluate(() => {
    setTimeout(() => {
      throw new Error('thrown just after the last step');
    }, 0);
  });
});

scenario('late-answer: the last step starts a fetch whose answer makes the page throw', async (s) => {
  const page = await s.open('/');
  await page.page.evaluate(() => {
    void fetch('/api/config').then(() => {
      throw new Error('thrown when the answer came');
    });
  });
});

scenario('late-console: the last step logs an error 50 ms later', async (s) => {
  const page = await s.open('/');
  await page.page.evaluate(() => {
    setTimeout(() => console.error('said 50 ms after the last step'), 50);
  });
});

scenario('late-quiet: the same on a page that has long been quiet, 100 ms later', async (s) => {
  const page = await s.open('/');
  await later(700);
  await page.page.evaluate(() => {
    setTimeout(() => console.error('said 100 ms after the last step'), 100);
  });
});

scenario('no-page: a scenario that opens no page', async (s) => {
  assert.equal(typeof (await s.network.height()), 'number');
});

scenario('fault: the practice network is gone, and the page is told "unavailable"', async (s) => {
  const page = await s.open('/');
  await s.stack.close();
  assert.equal(await height(page), 502);
});

scenario('fault-expected: the same, and the scenario said so first', async (s) => {
  s.expectFault('origin_down');
  const page = await s.open('/');
  await s.stack.close();
  assert.equal(await height(page), 502);
});

scenario('fault-never: a fault is expected and never comes', async (s) => {
  s.expectFault('origin_timeout');
  const page = await s.open('/');
  assert.equal(await height(page), 200);
});

/** Draws the bot check's widget in a page, as a page's own code would, and gives the token it hands out. */
const drawWidget = (page, action, cData) =>
  page.page.evaluate(
    (options) =>
      new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.onerror = () => reject(new Error('the script did not load'));
        script.onload = () => {
          window.turnstile.render('#app', { sitekey: '1x00000000000000000000AA', ...options, callback: resolve, 'error-callback': () => true });
        };
        document.head.append(script);
      }),
    { action, cData },
  );
const askFaucet = (page, address, token) =>
  page.page.evaluate(
    async (body) => (await fetch('/api/faucet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status,
    JSON.stringify({ address, token }),
  );

scenario('widget-right: the widget is drawn for the faucet and the address, also across a reload', async (s) => {
  const address = testRecord().firstAddress;
  const page = await s.open('/wallet/receive', { record: testRecord() });
  const token = await drawWidget(page, 'faucet', address);
  assert.equal(token, DUMMY_TOKEN);
  assert.equal(await askFaucet(page, address, token), 200);
  // The page is loaded again: what it drew before is not forgotten when the scenario ends.
  await page.goto('/wallet');
});

scenario('widget-wrong: the widget is drawn for another action and another address, and the local faucet pays all the same', async (s) => {
  const address = testRecord().firstAddress;
  const page = await s.open('/wallet/receive', { record: testRecord() });
  const token = await drawWidget(page, 'login', freshRecord().firstAddress);
  assert.equal(await askFaucet(page, address, token), 200);
  // Loading the page again does not make the scenario's end forget what was drawn.
  await page.goto('/wallet');
});
`;

test('scenario(): a scenario that should fail does fail, and is told why', async () => {
  const file = join(temp, 'broken.test.ts');
  writeFileSync(file, SCENARIOS);
  const dist = scratchDist({ 'page.js': "document.getElementById('app').append(document.createElement('p'));\n" });

  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: temp, E2E_DIST: dist, E2E_LIVE: '' };
  // This file runs under the test runner, which says so in the environment. The run started here is one of its own.
  delete env.NODE_TEST_CONTEXT;
  const ran = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=spec', file], { cwd: E2E, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });

  // How each scenario ended, by the first word of its name. The reporter marks a line with a check mark or a cross.
  const PASSED = '\u2714';
  const FAILED = '\u2716';
  const ended = new Map<string, 'passed' | 'failed'>();
  for (const [, mark, word] of ran.output.matchAll(new RegExp(`^(${PASSED}|${FAILED}) ([a-z-]+): `, 'gm'))) ended.set(word!, mark === PASSED ? 'passed' : 'failed');
  assert.deepEqual(Object.fromEntries(ended), {
    clean: 'passed',
    // What the last step set going is still seen.
    'late-throw': 'failed',
    'late-answer': 'failed',
    'late-console': 'failed',
    'late-quiet': 'failed',
    // A scenario has to look at the app in a browser.
    'no-page': 'failed',
    // A fault in the Worker's log, unless the scenario said it would cause it; and one it said and did not cause.
    fault: 'failed',
    'fault-expected': 'passed',
    'fault-never': 'failed',
    // The widget against what the faucet was asked.
    'widget-right': 'passed',
    'widget-wrong': 'failed',
  }, ran.output);
  assert.equal(ran.code, 1);

  // Each failure is the wrapper's own, and says what was wrong.
  for (const reason of [
    /page 1: pageerror: [^\n]*thrown just after the last step/,
    /page 1: pageerror: [^\n]*thrown when the answer came/,
    /page 1: console: said 50 ms after the last step/,
    /page 1: console: said 100 ms after the last step/,
    /the scenario opened no page: it shows nothing about the app in a browser/,
    /the Worker logged a fault: esplora_read 502 origin_down/,
    /expected and never logged: the fault origin_timeout/,
    /a bot check widget was drawn for the action "login": the deployed Worker takes a token made for "faucet" and no other/,
    /the faucet was asked to pay bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk, and no bot check widget was drawn for that address/,
  ]) {
    assert.match(ran.output, reason);
  }
});
