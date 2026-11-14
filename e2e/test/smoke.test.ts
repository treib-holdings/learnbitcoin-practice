// The smoke command, run as the program it is.
//
// A clean page exits with 0; a page that breaks the rules (a console error,
// a style attribute, an uncaught error, a request to another host, a file
// that is missing, a window, nothing drawn, no policy) exits with 1 and says
// which rule; several runs at once do not disturb each other; and no run
// leaves a temporary folder behind, however it is ended.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { appPolicy, buildApp, parseSmokeArgs, pathIn, workerFaults } from '../src/smoke.ts';
import { APP_HEADERS, PAGE, scratchDist } from './scratch-site.ts';

const E2E = fileURLToPath(new URL('../', import.meta.url));

/** A folder of this test's own for everything the programs write, so that what they leave behind can be counted. */
let temp: string;
/** The real app, built once for the tests that need it. */
let appDist: string;
before(async () => {
  temp = mkdtempSync(join(tmpdir(), 'lbp-smoke-test-'));
  appDist = join(temp, 'app-dist');
  assert.deepEqual(await buildApp(appDist), []);
});
after(() => {
  rmSync(temp, { recursive: true, force: true });
});

/** Runs one of the package's programs and gives its exit code and everything it printed. */
function run(program: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; output: string }> {
  // TMPDIR: the programs make their temporary folders under ours. INIT_CWD: what pnpm would set.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, TMPDIR: temp, INIT_CWD: temp, ...env };
  // This file runs under the test runner, which says so in the environment. The programs are not tests.
  delete childEnv.NODE_TEST_CONTEXT;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(E2E, 'src', program), ...args], { cwd: E2E, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

/** What the programs left in our temporary folder, apart from what this test put there itself. */
const leftBehind = () => readdirSync(temp).filter((name) => !name.startsWith('app-dist') && name !== 'shots');

/** A scratch page's first line: it draws something, as an app that is well does. */
const DRAWS = "document.getElementById('app').append(document.createElement('p'));";

// -- the command's own words ------------------------------------------------------------

test('smoke: the command line', () => {
  const from = '/somewhere';
  assert.deepEqual(parseSmokeArgs(['/'], from), { path: '/', lang: 'en', wallet: 'none', width: 1280, shot: null, dist: null });
  assert.deepEqual(parseSmokeArgs(['/es/wallet', '--wallet', 'funded', '--width', '375', '--shot', 'shots/a.png'], from), {
    path: '/es/wallet',
    lang: 'en',
    wallet: 'funded',
    width: 375,
    shot: '/somewhere/shots/a.png',
    dist: null,
  });
  // Options before the path, "=" between a name and its value, a file named from the root.
  assert.deepEqual(parseSmokeArgs(['--lang=es', '--dist', '/tmp/build', '--shot=/tmp/a.png', '/wallet/send', '--wallet=passkey'], from), {
    path: '/wallet/send',
    lang: 'es',
    wallet: 'passkey',
    width: 1280,
    shot: '/tmp/a.png',
    dist: '/tmp/build',
  });
  const refused: [argv: string[], why: RegExp][] = [
    [[], /must start with a slash/],
    [['wallet'], /must start with a slash/],
    [['/', '/wallet'], /two paths/],
    [['/', '--lang', 'fr'], /--lang is one of: en, es/],
    [['/', '--wallet', 'rich'], /--wallet is one of: none, empty, funded, passkey/],
    [['/', '--width', 'wide'], /--width/],
    [['/', '--width', '50'], /--width/],
    [['/', '--width'], /--width needs a value/],
    [['/', '--shot='], /--shot needs a value/],
    [['/', '--verbose', 'yes'], /no such option: --verbose/],
  ];
  for (const [argv, why] of refused) {
    const result = parseSmokeArgs(argv, from);
    assert.ok('error' in result, argv.join(' '));
    assert.match(result.error, why, argv.join(' '));
  }
});

test('smoke: --lang es opens the Spanish address of the path', () => {
  assert.equal(pathIn('es', '/'), '/es');
  assert.equal(pathIn('es', '/wallet/receive'), '/es/wallet/receive');
  assert.equal(pathIn('es', '/wallet?x=1'), '/es/wallet?x=1');
  // Already Spanish: left alone.
  assert.equal(pathIn('es', '/es'), '/es');
  assert.equal(pathIn('es', '/es/wallet'), '/es/wallet');
  // A screen whose name only starts with "es" is not Spanish yet.
  assert.equal(pathIn('es', '/escrow'), '/es/escrow');
  assert.equal(pathIn('en', '/wallet'), '/wallet');
  assert.equal(pathIn('en', '/es/wallet'), '/es/wallet');
});

// -- the command, run --------------------------------------------------------------------

test('smoke: the placeholder app is clean, at any path, with any wallet, several runs at once', async () => {
  const shot = join(temp, 'shots', 'es-wallet.png');
  const runs = await Promise.all([
    run('smoke.ts', ['/', '--dist', appDist]),
    run('smoke.ts', ['/wallet', '--lang', 'es', '--wallet', 'funded', '--width', '375', '--shot', 'shots/es-wallet.png', '--dist', appDist]),
    run('smoke.ts', ['/new', '--wallet', 'passkey', '--dist', appDist]),
    run('smoke.ts', ['/wallet/receive', '--wallet=empty', `--dist=${appDist}`]),
  ]);
  for (const ran of runs) {
    assert.equal(ran.code, 0, ran.output);
    assert.match(ran.output, /^ok: no console error, no CSP violation, no uncaught error, no request to another host$/m);
  }
  // Each run had a server of its own.
  const ports = runs.map((ran) => /^smoke: http:\/\/localhost:([0-9]+)\//m.exec(ran.output)?.[1]);
  assert.equal(new Set(ports).size, 4, ports.join(' '));
  // --lang es opens the Spanish address; a file name is read against the folder the command was typed in.
  assert.match(runs[1]!.output, /^smoke: http:\/\/localhost:[0-9]+\/es\/wallet$/m);
  assert.match(runs[1]!.output, /width 375, browser language es, wallet: funded .*100,000 confirmed, 40,000 confirmed, 2,500 unconfirmed/);
  assert.deepEqual([...readFileSync(shot).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(readFileSync(shot).readUInt32BE(16), 375);
  // Nothing of the four runs is left: no build, no browser profile.
  assert.deepEqual(leftBehind(), []);
});

test('smoke: it builds the app itself when it is given no build, and leaves app/dist alone', async () => {
  const appIndex = join(E2E, '..', 'app', 'dist', 'index.html');
  const before = existsSync(appIndex) ? readFileSync(appIndex, 'utf8') : null;
  const ran = await run('smoke.ts', ['/about']);
  assert.equal(ran.code, 0, ran.output);
  assert.equal(existsSync(appIndex) ? readFileSync(appIndex, 'utf8') : null, before);
  assert.deepEqual(leftBehind(), []);
});

test('smoke: a page that breaks the rules fails the run, and the run says how', async () => {
  const broken: [what: string, script: string, says: RegExp][] = [
    ['a console error', "console.error('the app is not well');", /^ {2}console: the app is not well/m],
    ['a style attribute', "document.getElementById('app').innerHTML = '<p style=\"color:red\">styled in the markup</p>';", /^ {2}csp: Applying inline style violates the following Content Security Policy directive 'style-src 'self''/m],
    ['an uncaught error', "throw new Error('nobody caught this');", /^ {2}pageerror: .*nobody caught this/m],
    ['a file from another host', "var s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/other.js'; document.head.append(s);", /^ {2}request: a request to another host was refused: GET https:\/\/challenges\.cloudflare\.com\/other\.js/m],
    ['a request the policy blocks', "fetch('https://example.com/collect');", /^ {2}csp: Connecting to 'https:\/\/example\.com\/collect' violates/m],
    // A picture and an icon that are not in the build. The page itself notices nothing: no handler, no console line.
    // The server answers both with the app's page and status 200, and Chrome draws a broken picture without a word.
    ['a picture that is missing', "var i = document.createElement('img'); i.src = '/logo.svg'; i.alt = 'LearnBitcoin'; document.getElementById('app').append(i);", /^ {2}missing: a file of the app is missing: \/logo\.svg was answered with the app's page/m],
    ['an icon that is missing', "var l = document.createElement('link'); l.rel = 'icon'; l.href = '/favicon.png'; document.head.append(l);", /^ {2}missing: a file of the app is missing: \/favicon\.png was answered with the app's page/m],
    ['another window', "window.open('https://challenges.cloudflare.com/popup');", /^ {2}window: the page tried to open another window: https:\/\/challenges\.cloudflare\.com\/popup/m],
  ];
  const runs = await Promise.all(broken.map(([, script]) => run('smoke.ts', ['/', '--dist', scratchDist({ 'page.js': `${DRAWS}\n${script}` })])));
  runs.forEach((ran, index) => {
    const [what, , says] = broken[index]!;
    assert.equal(ran.code, 1, `${what}: ${ran.output}`);
    assert.match(ran.output, says, what);
    assert.match(ran.output, /^FAILED: [0-9]+ problems?$/m, what);
    assert.doesNotMatch(ran.output, /^ok:/m, what);
    // Each page did draw something: that is not what was wrong with it.
    assert.doesNotMatch(ran.output, /drew nothing/, what);
  });
  // A refusal by the Worker's side is not a broken rule: the app expects those.
  const refused = await run('smoke.ts', ['/', '--dist', scratchDist({ 'page.js': `${DRAWS}\nfetch('/api/no-such-path');` })]);
  assert.equal(refused.code, 0, refused.output);
  assert.match(refused.output, /^ {2}answer 404: GET \/api\/no-such-path$/m);
  assert.deepEqual(leftBehind(), []);
});

test('smoke: "nothing went wrong" only counts if something happened: a page that draws nothing, or comes without the policy, fails', async () => {
  const [nothing, noPolicy, otherPolicy] = await Promise.all([
    // The script loads, runs without an error, and mounts nothing.
    run('smoke.ts', ['/', '--dist', scratchDist({ 'page.js': 'var loaded = true;' })]),
    // No policy at all: an inline style and an inline script run, and nothing can be "violated".
    run('smoke.ts', [
      '/',
      '--dist',
      scratchDist({
        'page.js': DRAWS,
        _headers: '/*\n  X-Content-Type-Options: nosniff\n',
        'index.html': PAGE.replace('<div id="app"></div>', '<div id="app"></div><p style="color:red">styled in the markup</p><script>document.title = "an inline script ran";</script>'),
      }),
    ]),
    // A policy, but not the app's: one word looser.
    run('smoke.ts', ['/', '--dist', scratchDist({ 'page.js': DRAWS, _headers: APP_HEADERS.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'") })]),
  ]);
  assert.equal(nothing.code, 1, nothing.output);
  assert.match(nothing.output, /^ {2}the page drew nothing: #app is empty, or not there$/m);
  assert.match(nothing.output, /^FAILED: 1 problem$/m);

  assert.equal(noPolicy.code, 1, noPolicy.output);
  assert.match(noPolicy.output, /title "an inline script ran"/);
  assert.match(noPolicy.output, /^ {2}the page came with no Content-Security-Policy at all$/m);
  assert.match(noPolicy.output, /^FAILED: 1 problem$/m);

  assert.equal(otherPolicy.code, 1, otherPolicy.output);
  assert.match(otherPolicy.output, /^ {2}the page's Content-Security-Policy is not the one in app\/public\/_headers: default-src 'none'; .*style-src 'self' 'unsafe-inline';/m);
  assert.match(otherPolicy.output, /^FAILED: 1 problem$/m);

  // What it is compared with: the policy of the "/*" block, as the source has it.
  assert.equal(appPolicy(), /^ {2}Content-Security-Policy: (.+)$/m.exec(APP_HEADERS)?.[1]);
  assert.deepEqual(leftBehind(), []);
});

test('smoke: the real app with its fonts or its whole script gone fails, where it used to say "ok"', async () => {
  const without = (name: string, remove: (dist: string) => void): string => {
    const dist = join(temp, `app-dist-${name}`);
    cpSync(appDist, dist, { recursive: true });
    remove(dist);
    return dist;
  };
  const assets = (dist: string) => readdirSync(join(dist, 'assets')).map((file) => join(dist, 'assets', file));
  const noFonts = without('no-fonts', (dist) => {
    const fonts = assets(dist).filter((file) => file.endsWith('.woff2'));
    assert.ok(fonts.length > 0, 'the build holds fonts');
    for (const font of fonts) rmSync(font);
  });
  const emptyScript = without('empty-script', (dist) => {
    const scripts = assets(dist).filter((file) => file.endsWith('.js'));
    assert.equal(scripts.length, 1);
    writeFileSync(scripts[0]!, '');
  });
  const [fonts, script] = await Promise.all([run('smoke.ts', ['/', '--dist', noFonts]), run('smoke.ts', ['/', '--dist', emptyScript])]);

  // Chrome only warns about a font it cannot read, and the page looks the same wherever the font is installed.
  assert.equal(fonts.code, 1, fonts.output);
  assert.match(fonts.output, /^ {2}missing: a file of the app is missing: \/assets\/geist-[A-Za-z0-9_-]+\.woff2 was answered with the app's page/m);
  assert.doesNotMatch(fonts.output, /^ {2}(console|csp|pageerror|request): /m);

  // An empty script is no error to Chrome: the page is white, and that is all.
  assert.equal(script.code, 1, script.output);
  assert.match(script.output, /^ {2}the page drew nothing: #app is empty, or not there$/m);
  assert.match(script.output, /^FAILED: 1 problem$/m);
  assert.deepEqual(leftBehind(), []);
});

test('smoke: a fault in the Worker\'s own log is a problem; a refusal is not', () => {
  const line = (route: 'config' | 'esplora_read' | 'faucet', status: number, fault: 'origin_down' | 'handler' | null) => ({ route, status, upstream: null, ms: 1, fault });
  assert.deepEqual(workerFaults([]), []);
  // A busy faucet and an unknown transaction are refusals: no fault, no problem.
  assert.deepEqual(workerFaults([line('config', 200, null), line('faucet', 429, null), line('esplora_read', 404, null)]), []);
  assert.deepEqual(workerFaults([line('config', 200, null), line('esplora_read', 502, 'origin_down'), line('faucet', 500, 'handler')]), [
    'the Worker logged a fault: esplora_read 502 origin_down',
    'the Worker logged a fault: faucet 500 handler',
  ]);
});

test('smoke: ended by a hangup, a "stop" or an interrupt in the middle of its build, it leaves nothing behind', async () => {
  // No --dist: the command makes a build of its own, in a folder of its own. The signal comes while it does.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, TMPDIR: temp, INIT_CWD: temp };
  delete childEnv.NODE_TEST_CONTEXT;
  for (const [signal, code] of [['SIGHUP', 129], ['SIGTERM', 143], ['SIGINT', 130]] as const) {
    assert.deepEqual(leftBehind(), [], `before ${signal}`);
    const child = spawn(process.execPath, [join(E2E, 'src', 'smoke.ts'), '/'], { cwd: E2E, env: childEnv, stdio: 'ignore' });
    const ended = new Promise<number | null>((resolve) => child.on('close', (exit) => resolve(exit)));
    // Its folder is there: the run has started, its build is under way, and it has something to lose.
    const deadline = Date.now() + 20_000;
    while (leftBehind().length === 0 && Date.now() < deadline) await new Promise((wake) => setTimeout(wake, 10));
    assert.equal(leftBehind().filter((name) => name.startsWith('lbp-smoke-')).length, 1, signal);
    child.kill(signal);
    // A run that the signal does not end is killed after a while, so that this test ends too.
    const giveUp = setTimeout(() => child.kill('SIGKILL'), 20_000);
    const exit = await ended;
    clearTimeout(giveUp);
    assert.equal(exit, code, signal);
    assert.deepEqual(leftBehind(), [], signal);
    // And nothing comes back: a build left running would write its files a moment later, and the folder with them.
    await new Promise((wake) => setTimeout(wake, 1500));
    assert.deepEqual(leftBehind(), [], `a while after ${signal}`);
  }
});

test('smoke: a build that cannot be served, and a command line that cannot be read', async () => {
  const noPolicy = scratchDist();
  rmSync(join(noPolicy, '_headers'));
  const ran = await run('smoke.ts', ['/', '--dist', noPolicy]);
  assert.equal(ran.code, 1);
  assert.match(ran.output, /no _headers file/);

  const usage = await run('smoke.ts', ['wallet']);
  assert.equal(usage.code, 2);
  assert.match(usage.output, /^smoke: the path must start with a slash/);
  assert.match(usage.output, /^usage: pnpm smoke <path>/m);
  assert.deepEqual(leftBehind(), []);
});
