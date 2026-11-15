// What is left when a run that has Chrome open is ended from outside.
//
// A scenario run is interrupted all the time: Ctrl-C, a terminal that is
// closed, a tool that stops a run that took too long. Each run makes a
// Chrome profile of some two hundred files in the temporary folder and
// starts half a dozen Chrome processes. This file ends a run in every way
// and looks at what remains:
//
//   an interrupt, a "stop", a hangup    nothing: no profile, no Chrome
//   killed outright (kill -9)           the profile (no code of ours runs any
//                                       more), but Chrome ends by itself
//
// The program that is ended is test/hold-chrome.ts.

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOLDER = fileURLToPath(new URL('./hold-chrome.ts', import.meta.url));

/** A temporary folder of this test's own, so that what a run leaves in it can be counted. */
let temp: string;
before(() => {
  temp = mkdtempSync(join(tmpdir(), 'lbp-lifecycle-test-'));
});
after(() => {
  rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** How a program ended: with a number of its own, or by a signal. */
type End = { code: number | null; signal: NodeJS.Signals | null };

/** How long a program gets to end after it was told to, in ms. One that is still there is killed, and the test fails. */
const PATIENCE_MS = 20_000;

/** Starts the program and waits until its Chrome is up. Gives the program and Chrome's process number. */
async function holdChrome(): Promise<{ holder: ChildProcess; chromePid: number; ended: Promise<End> }> {
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: temp };
  // This file runs under the test runner, which says so in the environment. The program is not a test.
  delete env.NODE_TEST_CONTEXT;
  const holder = spawn(process.execPath, [HOLDER], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const ended = new Promise<End>((resolve) => {
    holder.on('close', (code, signal) => resolve({ code, signal }));
  });
  const chromePid = await new Promise<number>((resolve, reject) => {
    let said = '';
    holder.stdout!.on('data', (chunk: Buffer) => {
      said += chunk.toString();
      const up = /^up ([0-9]+)$/m.exec(said);
      if (up) resolve(Number(up[1]));
    });
    void ended.then(() => reject(new Error(`the program ended before Chrome was up: ${said}`)));
  });
  assert.ok(chromePid > 0, 'Chrome has a process number');
  return { holder, chromePid, ended };
}

/** The program's end. A program that does not end in time is killed, so that this test ends too, and that is said. */
async function endOf(holder: ChildProcess, ended: Promise<End>): Promise<End | 'still running'> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'still running'>((resolve) => {
    timer = setTimeout(() => resolve('still running'), PATIENCE_MS);
  });
  const end = await Promise.race([ended, late]);
  clearTimeout(timer);
  if (end === 'still running') {
    holder.kill('SIGKILL');
    await ended;
  }
  return end;
}

/** True while a process with this number exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits until `done` holds, for at most `ms`. Gives whether it came to hold. */
async function until(done: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) return false;
    await new Promise((wake) => setTimeout(wake, 25));
  }
  return true;
}

const profiles = () => readdirSync(temp).filter((name) => name.startsWith('lbp-chrome-'));

test('an interrupt, a "stop" or a hangup: the profile is removed and Chrome is gone', async () => {
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]] as const) {
    const { holder, chromePid, ended } = await holdChrome();
    assert.equal(profiles().length, 1, `${signal}: one profile while Chrome runs`);
    assert.ok(readdirSync(join(temp, profiles()[0]!)).length > 0, `${signal}: the profile holds files`);
    assert.equal(alive(chromePid), true, signal);

    holder.kill(signal);
    // Ended the ordinary way, through its exit hooks, with the number a shell gives for that signal.
    assert.deepEqual(await endOf(holder, ended), { code, signal: null }, signal);
    assert.deepEqual(readdirSync(temp), [], `${signal}: nothing is left in the temporary folder`);
    assert.equal(await until(() => !alive(chromePid), 30_000), true, `${signal}: Chrome is gone`);
    // And nothing comes back: no helper of Chrome's is still there to write into the folder.
    await new Promise((wake) => setTimeout(wake, 500));
    assert.deepEqual(readdirSync(temp), [], `${signal}: still nothing half a second later`);
  }
});

test('killed outright: no hook runs, so the profile stays, but Chrome ends by itself', async () => {
  const { holder, chromePid, ended } = await holdChrome();
  assert.equal(profiles().length, 1);

  holder.kill('SIGKILL');
  assert.deepEqual(await endOf(holder, ended), { code: null, signal: 'SIGKILL' });
  // Chrome is reached over a pipe: when the other end is gone, it stops. Over a socket it would run on for good.
  // It notices within a second or so. On a machine that is busy with other tests it has been seen to take
  // longer than ten, so it gets thirty: the wait ends the moment Chrome is gone.
  const gone = await until(() => !alive(chromePid), 30_000);
  if (!gone) {
    // Not left running because this test failed: Chrome leads a process group of its own.
    try {
      process.kill(-chromePid, 'SIGKILL');
    } catch {
      // Gone after all.
    }
  }
  assert.equal(gone, true, 'Chrome ended by itself');
  // The folder is what a kill -9 costs: nothing of ours was running to remove it.
  assert.equal(profiles().length, 1);
});
