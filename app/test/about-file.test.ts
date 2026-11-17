// The About page's string table as a file of the site: /about.txt.
//
// The About page says what the wallet keeps, sends and counts, and the app's
// script draws it. A reader who browses with scripts off gets the <noscript>
// lines of index.html instead, and those link a file: the table every
// sentence of the page is taken from (src/strings/about.ts), copied into the
// build byte for byte.
//
// So three things are held here:
//
//   - the table is fit to be published as it stands: it says so at its top,
//     it holds both languages, it is plain UTF-8, and nothing private is in
//     it, in a sentence or in a comment;
//   - the build ships that file and no other copy of it (vite.config.ts),
//     and the dist guard fails a build that lacks it or holds other bytes;
//   - where a build is present, dist/about.txt is the table, byte for byte,
//     as test/headers.test.ts holds dist/_headers to its source.
//
// The type the file is served with is the host's to decide. The scenarios
// hold their own server to it (e2e/scenarios/page.test.ts) and the live
// check the deployed site (tools/live-check/live-check.ts).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LANGS } from '@learnbitcoin/practice-contract';
import { applyChange, emptyProgress, type Progress } from '../src/lib/doit/progress.ts';
import { STEP_DEFS, partCount } from '../src/lib/doit/steps.ts';
import { strings } from '../src/strings/index.ts';

const SOURCE = new URL('../src/strings/about.ts', import.meta.url);
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const BUILT = join(DIST, 'about.txt');
const GUARD = fileURLToPath(new URL('../scripts/check-dist.mjs', import.meta.url));

/** A build is here: `pnpm build` made one, and it is of this version (it holds the file at all). */
const built = existsSync(join(DIST, 'index.html'));
const NO_BUILD = 'no build here yet (pnpm build makes one)';

const bytes = readFileSync(SOURCE);
const text = bytes.toString('utf8');

test('the About string table says at its top that it is published as it stands, and holds both languages', () => {
  // The header, before the first table: that the file is published, where, and what that asks of its comments.
  const header = text.slice(0, text.indexOf('export const en = {'));
  assert.ok(header.length > 0, 'the tables follow a header');
  assert.match(header, /^\/\/ THIS FILE IS PUBLISHED AS IT STANDS\./m);
  // Its sentences, with the comment's own line breaks taken out.
  const said = header.replace(/\n\/\/ ?/g, ' ');
  assert.match(said, /The build copies it, byte for byte, into the site as \/about\.txt \(vite\.config\.ts\)/);
  assert.match(said, /the page's <noscript> lines send a reader who browses without JavaScript there \(index\.html\)/);
  assert.match(said, /So every comment below is read by the public beside the sentences, and is held to the same rule as they are: it is true of the code, in every state\./);
  assert.match(said, /Nothing private goes into this file, in a sentence or in a comment\./);
  // Both tables, one after the other, in one file: the English one, then the Spanish one with the same keys.
  const english = text.indexOf('export const en = {');
  const spanish = text.indexOf('export const es: Record<keyof typeof en, string> = {');
  assert.ok(english > 0 && spanish > english);
  // Every key the page reads is a line of each table, and the sentence the page shows stands in the file:
  // word for word where it holds no quotation mark or apostrophe, which the file writes with a backslash.
  for (const lang of LANGS) {
    const table = lang === 'en' ? text.slice(english, spanish) : text.slice(spanish);
    for (const [key, sentence] of Object.entries(strings.about[lang] as Readonly<Record<string, string>>)) {
      assert.match(table, new RegExp(`^  ${key}:`, 'm'), `${lang}.${key}`);
      if (!/['"\\]/.test(sentence)) assert.ok(table.includes(sentence), `${lang}.${key}: the sentence is not in the file as the page shows it`);
    }
  }
  assert.ok(Object.keys(strings.about.en).length > 80, 'the whole table');
});

test('the file is plain UTF-8 with no mark in front, and its letters outside ASCII are all in its Spanish half', () => {
  // Read as UTF-8 and written again, it is the same bytes: nothing in it is broken, and a browser that is told
  // "charset=utf-8" shows what the file holds.
  assert.ok(Buffer.from(text, 'utf8').equals(bytes));
  assert.doesNotMatch(text, /\uFFFD/);
  // No byte order mark: the copy is the file as it is, and the host says which characters it holds.
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  // The English half and every comment above it are ASCII. The Spanish half is why the charset matters.
  const spanish = text.indexOf('export const es: Record<keyof typeof en, string> = {');
  assert.doesNotMatch(text.slice(0, spanish), /[^\x00-\x7f]/);
  const letters = text.slice(spanish).match(/[^\x00-\x7f]/g) ?? [];
  assert.ok(letters.length > 100, `${letters.length} characters outside ASCII`);
  // Each of them is a letter or a mark of Spanish: nothing a hand would not type there.
  for (const letter of new Set(letters)) assert.match(letter, /^[áéíóúüñÁÉÍÓÚÜÑ¿¡]$/, `U+${letter.codePointAt(0)?.toString(16)}`);
  // Line ends are plain: no carriage return for a browser to show or a comparison to trip over.
  assert.equal(bytes.includes(0x0d), false);
});

test('nothing private is in the file: it is read by the public, comments included', () => {
  // No path of anybody's machine, no address of a machine, no mail address, no token, no dated or signed remark.
  assert.doesNotMatch(text, /\/Users\/|\/home\/|\/private\/|~\//);
  assert.doesNotMatch(text, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  assert.doesNotMatch(text, /[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
  assert.doesNotMatch(text, /\b(TODO|FIXME|XXX|HACK)\b/);
  assert.doesNotMatch(text, /\b(19|20)\d{2}-\d{2}-\d{2}\b|\b(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d{2}\b/);
  assert.doesNotMatch(text, /\b(sk|pk|ghp|gho|xox[bap])[-_][A-Za-z0-9_-]{12,}\b|\b[0-9a-f]{32,}\b/);
  // No address of a site: host names are facts, and the page shows them from the wallet's settings.
  assert.doesNotMatch(text, /https?:\/\/|\bwww\./);
  // Every file a comment names is a file of the repository, so that a reader can hold the comment against it.
  const named = [...new Set([...text.matchAll(/(?:^|[\s(])((?:src|test|public|worker|wallet|contract|e2e)\/[A-Za-z0-9_./-]+\.[a-z]+)/gm)].map((match) => match[1] ?? ''))];
  assert.ok(named.length >= 15, `${named.length} files are named`);
  for (const name of named) {
    // A path that starts "src/", "test/" or "public/" is the app's own; the others are packages of the repository.
    const from = /^(src|test|public)\//.test(name) ? '../' : '../../';
    assert.ok(existsSync(new URL(`${from}${name}`, import.meta.url)), `the file names ${name}, and there is no such file`);
  }
});

test('no comment sends a reader of the file to a document that is not in the repository', () => {
  // Every file a comment names can be opened beside it (the test above). A build spec, or a note of the people
  // who wrote the page, is no such file: a reader of /about.txt cannot open it, so no comment may rest on one.
  assert.doesNotMatch(text, /\bSPEC\b/);
  assert.doesNotMatch(text, /\bnotes\/\d|\bspec(ification)? section\b|\bsection \d+ of the spec/i);
  // The paragraph on what the page may promise stands by itself.
  const header = text.slice(0, text.indexOf('export const en = {')).replace(/\n\/\/ ?/g, ' ');
  assert.match(header, /What the page may promise is short: no account, we set no cookies, the 12 words never leave this browser\./);
});

test('the comment on the step a reader came for says when that field is written, and the code writes it then: also for a step opened from the wallet\'s own list, once its card was pressed in this browser', () => {
  // The comment above the sentence, as one line of text.
  const from = text.indexOf('  // The field cameFor (src/lib/doit/progress.ts).');
  const to = text.indexOf('  keepNoteCameFor:');
  assert.ok(from > 0 && to > from, 'the comment stands straight above its sentence');
  const said = text.slice(from, to).replace(/\n {2}\/\/ ?/g, ' ').replace(/^\s*\/\/ /, '').trim();
  assert.match(said, /It is written when a step that is under way sends the reader to another step and the reader presses that link \(a tap or a click, the middle button, or the browser's own menu on the link, whether or not they then follow it\), if the step that sends them was itself reached from a chapter\./);
  assert.match(said, /A step counts as reached from a chapter when its note holds a way back, or a step that it was sent from in turn and that is not done\./);
  assert.match(said, /The note keeps a step's way back from the first press of its card in this browser until the progress is forgotten\./);
  assert.match(said, /So the field is also written on a later day, for a reader who opens from the wallet's own list a step whose card they once pressed here\./);
  assert.match(said, /It holds one of the six step IDs and nothing else, never the step's own, and it is taken out by the write that finishes the step it names\./);
  assert.match(said, /A later press takes it out sooner: the step's own card, or a link from a step that was not reached from a chapter, when the field names another step than that one\.$/);
  // What it said before, and what is not so: "never" for a reader who opened a step from the wallet's own list.
  assert.doesNotMatch(text, /never for a reader who opened a step from the wallet's own\s+(\/\/ )?list/);
  assert.doesNotMatch(text, /Written only on a road that began at a chapter's card/);

  // -- The code, state by state. --
  const DAY = 86_400_000;
  const AT = 1_800_000_000_000;
  const card = STEP_DEFS['no-balances'].chapter.path.en;
  const press = (note: Progress): Progress => applyChange(note, { kind: 'detour', step: 'pass-it-on', cameFor: 'no-balances' });
  // Day 1: the reader presses the card of "There are no balances". The note keeps the way back.
  const first = applyChange(emptyProgress(), { kind: 'open', step: 'no-balances', at: AT, from: card });
  assert.deepEqual(first.steps, { 'no-balances': { started: true, from: card } });
  // Day 3: the same step, opened from the wallet's own list (no way back in its address). The way back is still
  // in the note, so the press of the step's link to "Pass it on" writes the field.
  const later = applyChange(first, { kind: 'open', step: 'no-balances', at: AT + 2 * DAY, from: null });
  assert.deepEqual(later.steps, { 'no-balances': { started: true, from: card } });
  assert.deepEqual(press(later).steps['pass-it-on'], { cameFor: 'no-balances' });
  // A step whose card was never pressed in this browser: the same press writes nothing.
  const listed = applyChange(emptyProgress(), { kind: 'open', step: 'no-balances', at: AT, from: null });
  assert.equal(press(listed).steps['pass-it-on'], undefined);
  // Only a step that is under way sends anybody: one that was never opened, or is done, writes nothing.
  assert.equal(press(emptyProgress()).steps['pass-it-on'], undefined);
  // A step that was itself sent from a step that is not done counts as reached from a chapter, with no way back of its own.
  const chained: Progress = { v: 1, following: null, steps: { 'no-balances': { started: true, from: card }, 'pass-it-on': { started: true, cameFor: 'no-balances' } } };
  assert.deepEqual(applyChange(chained, { kind: 'detour', step: 'hold-some', cameFor: 'pass-it-on' }).steps['hold-some'], { cameFor: 'pass-it-on' });
  // Never the step's own ID, and nothing that is not one of the six.
  assert.equal(applyChange(later, { kind: 'detour', step: 'no-balances', cameFor: 'no-balances' }).steps['no-balances']?.cameFor, undefined);
  // Taken out by the write that finishes the step it names.
  let done = press(later);
  for (let part = 1; part <= partCount('no-balances'); part++) done = applyChange(done, { kind: 'tick', step: 'no-balances', part, at: AT + 2 * DAY + part });
  assert.ok(done.steps['no-balances']?.doneAt !== undefined);
  assert.equal(done.steps['pass-it-on'], undefined, 'the note that held nothing else is gone with the field');
  // Sooner, by the step's own card ...
  const own = applyChange(press(later), { kind: 'open', step: 'pass-it-on', at: AT + 3 * DAY, from: STEP_DEFS['pass-it-on'].chapter.path.en });
  assert.equal(own.steps['pass-it-on']?.cameFor, undefined);
  // ... and by a link from a step that was not reached from a chapter, when the field names another step.
  const stray: Progress = { v: 1, following: null, steps: { 'hold-some': { cameFor: 'pass-it-on' }, 'pass-it-on': { started: true }, 'the-seed': { started: true } } };
  assert.equal(applyChange(stray, { kind: 'detour', step: 'hold-some', cameFor: 'the-seed' }).steps['hold-some'], undefined);
  // When the field names that very step, the press leaves it.
  assert.deepEqual(applyChange(stray, { kind: 'detour', step: 'hold-some', cameFor: 'pass-it-on' }).steps['hold-some'], { cameFor: 'pass-it-on' });
});

test('the build ships the table as about.txt, read as bytes and handed on as bytes, and the repository keeps no second copy', () => {
  const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.match(config, /const ABOUT_SOURCE = 'src\/strings\/about\.ts';/);
  assert.match(config, /const ABOUT_FILE = 'about\.txt';/);
  // A plugin of the build alone adds the file to what the build writes, under that name at the build's root.
  assert.match(
    config,
    /function aboutText\(\): Plugin \{\s*let root = '';\s*return \{\s*name: 'practice-about-text',\s*apply: 'build',\s*configResolved\(config\) \{\s*root = config\.root;\s*\},\s*generateBundle\(\) \{\s*(\/\/[^\n]*\n\s*)*this\.emitFile\(\{ type: 'asset', fileName: ABOUT_FILE, source: readFileSync\(join\(root, ABOUT_SOURCE\)\) \}\);\s*\},\s*\};\s*\}/,
  );
  assert.match(config, /plugins: \[tailwindcss\(\), svelte\(\), aboutText\(\)\],/);
  // Nothing reads the text on the way: no encoding is named, and nothing is replaced or trimmed.
  const plugin = config.slice(config.indexOf('function aboutText()'), config.indexOf('export default defineConfig'));
  assert.doesNotMatch(plugin, /'utf-?8'|\.toString\(|\.replace\(|\.trim\(|TextDecoder/);
  // It is made at each build and never kept: a copy in the repository would drift from the table.
  assert.equal(existsSync(new URL('../public/about.txt', import.meta.url)), false);
  // The dist guard holds every build to it.
  const guard = readFileSync(GUARD, 'utf8');
  assert.match(guard, /const sourceAbout = readFileSync\(join\(appDir, 'src', 'strings', 'about\.ts'\)\);/);
  assert.match(guard, /if \(!existsSync\(join\(dist, 'about\.txt'\)\)\) \{[\s\S]*?\} else if \(!readFileSync\(join\(dist, 'about\.txt'\)\)\.equals\(sourceAbout\)\) \{/);
  // And the build runs the guard: a build that lacks the file fails.
  const scripts = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }).scripts;
  assert.equal(scripts.build, 'vite build && node scripts/check-dist.mjs');
});

test('dist/about.txt: the built copy is the table, byte for byte, and the built page links it', { skip: built ? false : NO_BUILD }, () => {
  assert.ok(existsSync(BUILT), 'the build holds no about.txt');
  assert.ok(readFileSync(BUILT).equals(bytes), 'dist/about.txt differs from src/strings/about.ts');
  // The built page carries the lines that send a reader without JavaScript there.
  const page = readFileSync(join(DIST, 'index.html'), 'utf8');
  const block = /<noscript>([\s\S]*?)<\/noscript>/.exec(page)?.[1] ?? '';
  assert.deepEqual([...block.matchAll(/href="([^"]*)"/g)].map((match) => match[1]), ['/about.txt', '/about.txt']);
  // It is the one file the build adds at its root beside the page, the headers, the licenses and what public/ holds.
  assert.equal(existsSync(join(DIST, 'assets', 'about.txt')), false);
});

test('the dist guard passes the build as it is, fails it without about.txt, and fails it with one byte changed', { skip: built ? false : NO_BUILD }, () => {
  const guard = (folder: string): { code: number | null; said: string } => {
    const run = spawnSync(process.execPath, [GUARD, folder], { encoding: 'utf8' });
    return { code: run.status, said: `${run.stdout}${run.stderr}` };
  };
  const copy = mkdtempSync(join(tmpdir(), 'practice-about-'));
  try {
    cpSync(DIST, copy, { recursive: true });
    const whole = guard(copy);
    assert.equal(whole.code, 0, whole.said);
    assert.match(whole.said, /^ok: .* passes the dist guard \(1 script file, 1 stylesheet, nothing inline, _headers, licenses\.md, about\.txt\)\s*$/);

    // One byte changed, anywhere: an older copy of the table is not the table.
    const changed = Buffer.from(bytes);
    changed[changed.length - 2] = changed[changed.length - 2] === 0x7d ? 0x20 : 0x7d;
    writeFileSync(join(copy, 'about.txt'), changed);
    const drifted = guard(copy);
    assert.equal(drifted.code, 1, drifted.said);
    assert.match(drifted.said, /about\.txt differs from src\/strings\/about\.ts/);
    // A mark in front of the right bytes is other bytes too.
    writeFileSync(join(copy, 'about.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]));
    assert.equal(guard(copy).code, 1);
    // An empty file.
    writeFileSync(join(copy, 'about.txt'), '');
    assert.equal(guard(copy).code, 1);

    // No file at all.
    rmSync(join(copy, 'about.txt'));
    const missing = guard(copy);
    assert.equal(missing.code, 1, missing.said);
    assert.match(missing.said, /there is no about\.txt/);

    // Put back as it was, the build passes again: nothing else in the copy was the cause.
    writeFileSync(join(copy, 'about.txt'), bytes);
    assert.equal(guard(copy).code, 0);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
