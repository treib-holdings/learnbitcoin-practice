// Which folder the harness will start a Chrome on, or change a setting of
// Chrome's in: a throwaway profile folder that it made itself, under the
// system's temporary folder, and no other.
//
// Two functions of src/browser.ts take a folder from their caller:
// launchChrome({ profile }) starts Chrome on it, and setSiteData() rewrites
// the cookie setting in its Preferences file. A person's own Chrome folder
// has that very file. Named by mistake in a scenario, it would have that
// person's Chrome switched to blocking all site data, without a word. So
// both look at the folder first, and this file holds them to it.
//
// No Chrome is started here, and nothing outside the temporary folder is
// written. "A folder that is not under the temporary folder" is made
// inside it all the same: for the length of a test the temporary folder is
// said to be one of two folders that stand side by side (TMPDIR), so the
// other one is outside it. That a made folder is taken, and that Chrome
// keeps what its pages store in it, is shown by the scenario that uses
// one (scenarios/storage-blocked.test.ts).

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, afterEach, beforeEach, test } from 'node:test';
import { launchChrome, makeProfile, setSiteData } from '../src/browser.ts';

/** Two folders side by side, in the real temporary folder: one to be "the temporary folder" of a test, one outside it. */
const base = realpathSync(mkdtempSync(join(tmpdir(), 'lbp-own-profile-test-')));
const inside = join(base, 'temporary');
const outside = join(base, 'elsewhere');
mkdirSync(inside);
mkdirSync(outside);
after(() => {
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const env = { TMPDIR: process.env.TMPDIR, CHROME_PATH: process.env.CHROME_PATH };
beforeEach(() => {
  process.env.TMPDIR = inside;
  // No Chrome can be started by these tests: the one that is named is not there. A folder that is taken gets as
  // far as looking for it, and a folder that is refused does not.
  process.env.CHROME_PATH = join(base, 'no-chrome-here');
});
afterEach(() => {
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** What Chrome keeps in a profile's Preferences file, as far as these tests go: somebody's settings. */
const SOMEBODY = JSON.stringify({ profile: { name: 'Somebody', default_content_setting_values: { cookies: 1 } }, browser: { has_seen_welcome_page: true } });

/** Puts a Preferences file where Chrome keeps one, and gives its path. */
function withPreferences(folder: string): string {
  mkdirSync(join(folder, 'Default'), { recursive: true });
  const file = join(folder, 'Default', 'Preferences');
  writeFileSync(file, SOMEBODY);
  return file;
}

/** Every file and folder under a folder, with each file's text: to see that nothing was added, changed or taken away. */
function contents(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return entry.isFile() ? `${path} = ${readFileSync(path, 'utf8')}` : path;
    })
    .sort();
}

/** What both functions say to a folder: the message each throws, or "taken" where the folder itself is no objection. */
async function asked(folder: string): Promise<{ launch: string; setting: string }> {
  let launch = 'taken';
  try {
    // (Should a Chrome ever be started here, it is closed again before the test says so.)
    await (await launchChrome({ profile: folder })).close();
    launch = 'Chrome was started';
  } catch (error) {
    const message = (error as Error).message;
    // Past the look at the folder: the next thing is the look for Chrome, which is not there in these tests.
    launch = message.startsWith('No Chrome at ') ? 'taken' : message;
  }
  let setting = 'taken';
  try {
    setSiteData(folder, 'block');
  } catch (error) {
    const message = (error as Error).message;
    setting = message.startsWith('setSiteData: no Preferences file in ') ? 'taken' : message;
  }
  return { launch, setting };
}

test('makeProfile makes a new, empty folder under the temporary folder each time, and both functions take it', async () => {
  const first = await makeProfile();
  const second = await makeProfile();
  assert.notEqual(first, second);
  for (const folder of [first, second]) {
    assert.equal(dirname(folder), inside);
    assert.match(basename(folder), /^lbp-own-profile-/);
    assert.equal(realpathSync(folder), folder, 'given by its real path');
    assert.deepEqual(readdirSync(folder), []);
  }
  // Taken by both: Chrome is looked for (and is not there), and the setting is looked for (no Chrome has run on it yet).
  assert.deepEqual(await asked(first), { launch: 'taken', setting: 'taken' });
  assert.deepEqual(readdirSync(first), [], 'and nothing was put into it by the asking');
  await assert.rejects(launchChrome({ profile: first }), /^Error: No Chrome at /);
  assert.throws(() => setSiteData(first, 'block'), /^Error: setSiteData: no Preferences file in .*\. Start Chrome on this profile once, and close it, first\.$/);

  // With the file Chrome leaves behind, the setting is written where Chrome reads it, and nothing else in the file changes.
  const file = withPreferences(first);
  setSiteData(first, 'block');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { profile: { name: 'Somebody', default_content_setting_values: { cookies: 2 } }, browser: { has_seen_welcome_page: true } });
  setSiteData(first, 'allow');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), JSON.parse(SOMEBODY));
  // By another spelling of its path it is the same folder, and taken.
  assert.deepEqual(await asked(join(first, '..', basename(first))), { launch: 'taken', setting: 'taken' });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).profile.default_content_setting_values, { cookies: 2 });
});

test('a folder that is not a throwaway one of the harness\'s own making is refused by both, and nothing in it is read, written or started', async () => {
  const made = await makeProfile();
  withPreferences(made);

  // Somebody's own browser profile: a folder outside the temporary folder, with the file Chrome keeps there.
  const own = join(outside, 'Chrome');
  mkdirSync(own);
  // In the temporary folder, under the very name makeProfile gives, and not made by it.
  const lookalike = mkdtempSync(join(inside, 'lbp-own-profile-'));
  // A link in the temporary folder that leads out of it, to that profile.
  const link = join(inside, 'lbp-own-profile-link');
  symlinkSync(own, link);
  // A folder inside a made profile.
  const within = join(made, 'Default');
  // A made profile whose folder has been replaced by a link to somebody's profile.
  const swapped = await makeProfile();
  rmSync(swapped, { recursive: true });
  symlinkSync(own, swapped);
  for (const folder of [own, lookalike]) withPreferences(folder);

  const refused: [what: string, folder: string, why: RegExp][] = [
    ['a profile outside the temporary folder', own, /is not under the system's temporary folder\. Only a throwaway profile that makeProfile\(\) made is taken, never a browser profile of somebody's own\.$/],
    ['the folder above it', outside, /is not under the system's temporary folder\./],
    ['the temporary folder itself', inside, /is not under the system's temporary folder\./],
    ['a link in the temporary folder that leads out of it', link, /is not under the system's temporary folder\./],
    ['a made profile replaced by a link that leads out of the temporary folder', swapped, /is not under the system's temporary folder\./],
    ['a folder in the temporary folder that makeProfile did not make', lookalike, /is not a profile folder that makeProfile\(\) made in this run\. Only such a folder is taken\.$/],
    ['a folder inside a made profile', within, /is not a profile folder that makeProfile\(\) made in this run\./],
    ['a folder that is not there', join(inside, 'lbp-own-profile-nowhere'), /there is no folder .*\. A profile folder is made with makeProfile\(\)\.$/],
    // An empty name is read as the folder the run stands in: a folder of this repository, and no throwaway one.
    ['no name at all', '', /is not under the system's temporary folder\./],
  ];
  const before = contents(base);
  for (const [what, folder, why] of refused) {
    const said = await asked(folder);
    assert.match(said.launch, why, `launchChrome, ${what}: ${said.launch}`);
    assert.match(said.setting, why, `setSiteData, ${what}: ${said.setting}`);
    assert.ok(said.launch.startsWith('launchChrome: ') && said.setting.startsWith('setSiteData: '), what);
    // The same for the setting that puts things back.
    assert.throws(() => setSiteData(folder, 'allow'), why, what);
  }
  // Nothing was added, changed or taken away anywhere: not a file, not a folder, and the settings of the
  // profile that was somebody's own are what they were.
  assert.deepEqual(contents(base), before);
  assert.equal(readFileSync(join(own, 'Default', 'Preferences'), 'utf8'), SOMEBODY);
  assert.ok(!existsSync(join(inside, 'lbp-own-profile-nowhere')), 'a folder that was named and is not there is not made either');
  // The folder that was made is still taken, and its setting is written.
  assert.deepEqual(await asked(made), { launch: 'taken', setting: 'taken' });
  assert.deepEqual(JSON.parse(readFileSync(join(made, 'Default', 'Preferences'), 'utf8')).profile.default_content_setting_values, { cookies: 2 });
});

test('a folder is looked at before anything else: with a Chrome that could be started, a refused folder still starts none', async () => {
  // Whatever CHROME_PATH says, the answer for a refused folder is the folder's.
  const own = join(outside, 'Another');
  mkdirSync(own, { recursive: true });
  for (const chrome of [join(base, 'no-chrome-here'), process.execPath]) {
    process.env.CHROME_PATH = chrome;
    await assert.rejects(launchChrome({ profile: own }), /^Error: launchChrome: .* is not under the system's temporary folder\./, chrome === process.execPath ? 'a program that exists' : 'no program');
  }
  assert.deepEqual(readdirSync(own), []);
});
