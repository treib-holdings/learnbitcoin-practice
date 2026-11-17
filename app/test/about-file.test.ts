// The About page's string table as a file of the site: /about.txt.
//
// The About page says what the wallet keeps, sends and counts, and the app's
// script draws it. A reader who browses with scripts off gets the <noscript>
// lines of index.html instead, and those link a file: the table every
// sentence of the page is taken from (src/strings/about.ts), copied into the
// build byte for byte, behind a byte order mark.
//
// So three things are held here:
//
//   - the table is fit to be published as it stands: it says so at its top,
//     it holds both languages, it is plain UTF-8 with no mark of its own,
//     and nothing private is in it, in a sentence or in a comment;
//   - the build ships that file and no other copy of it (vite.config.ts),
//     with the mark in front, and the dist guard fails a build that lacks
//     the file, lacks the mark, or holds other bytes behind the mark, and
//     a table that starts with a mark of its own;
//   - where a build is present, dist/about.txt is the mark and then the
//     table, byte for byte, as test/headers.test.ts holds dist/_headers to
//     its source.
//
// The type the file is served with is the host's to decide, and the deployed
// site names no charset with it: the mark is what tells a browser that the
// file is UTF-8. The scenarios open the file in a browser, served that way
// (e2e/scenarios/page.test.ts), and the live check holds the deployed site's
// file to the mark (tools/live-check/live-check.ts).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** A byte order mark: the three bytes the build puts in front of its copy of the table. */
const MARK = Buffer.from([0xef, 0xbb, 0xbf]);

test('the About string table says at its top that it is published as it stands, and holds both languages', () => {
  // The header, before the first table: that the file is published, where, and what that asks of its comments.
  const header = text.slice(0, text.indexOf('export const en = {'));
  assert.ok(header.length > 0, 'the tables follow a header');
  assert.match(header, /^\/\/ THIS FILE IS PUBLISHED AS IT STANDS\./m);
  // Its sentences, with the comment's own line breaks taken out.
  const said = header.replace(/\n\/\/ ?/g, ' ');
  assert.match(said, /The build copies it into the site as \/about\.txt \(vite\.config\.ts\)\./);
  // What the copy is, said so that it is true of the copy: the mark the build puts in front, then this file.
  assert.match(said, /The copy starts with a byte order mark, three bytes that tell a browser the file is UTF-8, and behind the mark it is this file, byte for byte\./);
  assert.doesNotMatch(said, /copies it, byte for byte/);
  assert.match(said, /The page's <noscript> lines send a reader who browses without JavaScript there \(index\.html\)/);
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
  // Read as UTF-8 and written again, it is the same bytes: nothing in it is broken, and a browser that reads
  // the file as UTF-8 shows what the file holds.
  assert.ok(Buffer.from(text, 'utf8').equals(bytes));
  assert.doesNotMatch(text, /\uFFFD/);
  // No byte order mark in the source: the build adds the one mark, in front of its copy (vite.config.ts). A
  // mark here as well would make two there, and a browser takes only the first for a mark: the second
  // would be a character of the text.
  assert.equal(bytes.subarray(0, MARK.length).equals(MARK), false);
  // The English half and every comment above it are ASCII. The Spanish half is why it matters how a browser reads the file.
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

test('the build ships the table as about.txt behind a byte order mark, read as bytes and handed on as bytes, and the repository keeps no second copy', () => {
  const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.match(config, /const ABOUT_SOURCE = 'src\/strings\/about\.ts';/);
  assert.match(config, /const ABOUT_FILE = 'about\.txt';/);
  // The mark, as the three bytes it is.
  assert.match(config, /const UTF8_MARK = Uint8Array\.of\(0xef, 0xbb, 0xbf\);/);
  // A plugin of the build alone adds the file to what the build writes, under that name at the build's root:
  // the mark, and then the table's own bytes.
  assert.match(
    config,
    /function aboutText\(\): Plugin \{\s*let root = '';\s*return \{\s*name: 'practice-about-text',\s*apply: 'build',\s*configResolved\(config\) \{\s*root = config\.root;\s*\},\s*generateBundle\(\) \{\s*(\/\/[^\n]*\n\s*)*this\.emitFile\(\{ type: 'asset', fileName: ABOUT_FILE, source: Buffer\.concat\(\[UTF8_MARK, readFileSync\(join\(root, ABOUT_SOURCE\)\)\]\) \}\);\s*\},\s*\};\s*\}/,
  );
  assert.match(config, /plugins: \[tailwindcss\(\), svelte\(\), aboutText\(\)\],/);
  // Nothing reads the text on the way: no encoding is named, and nothing is replaced or trimmed.
  const plugin = config.slice(config.indexOf('function aboutText()'), config.indexOf('export default defineConfig'));
  assert.doesNotMatch(plugin, /'utf-?8'|\.toString\(|\.replace\(|\.trim\(|TextDecoder/);
  // The comment above the plugin says why the mark is there, and says of which file the browsers' misreading
  // was seen: the file without the mark. Of the file as the plugin makes it, that sentence would not be so.
  const why = config.slice(config.indexOf('/**\n * Ships the About page'), config.indexOf('function aboutText()')).replace(/\n \* ?/g, ' ');
  assert.match(why, /Chromium and WebKit have both been seen to read this one, without the mark, as windows-1252, and to show "prÃ¡ctica" where the file says "práctica"\. A browser that finds the mark reads the file as UTF-8 whatever the header says, and does not show the mark\./);
  // It is made at each build and never kept: a copy in the repository would drift from the table.
  assert.equal(existsSync(new URL('../public/about.txt', import.meta.url)), false);
  // The dist guard holds every build to it: the file is there, it starts with the mark, and behind the mark
  // it is the table. Each of the three has a message of its own. So has a table that starts with a mark
  // of its own: the copy of such a table would be the mark and then the table too, with two marks in front.
  const guard = readFileSync(GUARD, 'utf8');
  assert.match(guard, /const UTF8_MARK = Buffer\.from\(\[0xef, 0xbb, 0xbf\]\);/);
  assert.match(guard, /const sourceAbout = readFileSync\(join\(appDir, 'src', 'strings', 'about\.ts'\)\);/);
  assert.match(guard, /if \(sourceAbout\.subarray\(0, UTF8_MARK\.length\)\.equals\(UTF8_MARK\)\) \{\s*problems\.push\('src\/strings\/about\.ts starts with a byte order mark of its own: [^\n]*\);\s*\}/);
  assert.match(
    guard,
    /if \(!existsSync\(join\(dist, 'about\.txt'\)\)\) \{\s*problems\.push\('there is no about\.txt: [^\n]*\);\s*\} else \{\s*const builtAbout = readFileSync\(join\(dist, 'about\.txt'\)\);\s*if \(!builtAbout\.subarray\(0, UTF8_MARK\.length\)\.equals\(UTF8_MARK\)\) \{\s*problems\.push\('about\.txt does not start with a byte order mark [^\n]*\);\s*\} else if \(!builtAbout\.subarray\(UTF8_MARK\.length\)\.equals\(sourceAbout\)\) \{\s*problems\.push\('about\.txt differs from src\/strings\/about\.ts behind its byte order mark'\);\s*\}\s*\}/,
  );
  // And the build runs the guard: a build that lacks the file fails.
  const scripts = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }).scripts;
  assert.equal(scripts.build, 'vite build && node scripts/check-dist.mjs');
  // The repository's README says of the published file what is so: the table behind the mark.
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8').replace(/\s*\n\s*/g, ' ');
  assert.match(readme, /as `\/about\.txt`, byte for byte behind a byte order mark that tells a browser the file is UTF-8, and the page's `<noscript>` lines link it\./);
});

test('dist/about.txt: the built copy is a byte order mark and then the table, byte for byte, and the built page links it', { skip: built ? false : NO_BUILD }, () => {
  assert.ok(existsSync(BUILT), 'the build holds no about.txt');
  const shipped = readFileSync(BUILT);
  // The mark first: without it a browser that is told no charset may not read the Spanish half as UTF-8.
  assert.deepEqual([...shipped.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'dist/about.txt does not start with a byte order mark');
  // Then the table and nothing else: one mark, no second one, and not a byte more or less.
  assert.ok(shipped.subarray(3).equals(bytes), 'behind its byte order mark, dist/about.txt differs from src/strings/about.ts');
  assert.ok(shipped.equals(Buffer.concat([MARK, bytes])));
  // Read as UTF-8 the way a browser reads a file that starts with the mark, it is the table's text: the mark is no part of it.
  assert.equal(new TextDecoder('utf-8').decode(shipped), text);
  // The built page carries the lines that send a reader without JavaScript there.
  const page = readFileSync(join(DIST, 'index.html'), 'utf8');
  const block = /<noscript>([\s\S]*?)<\/noscript>/.exec(page)?.[1] ?? '';
  assert.deepEqual([...block.matchAll(/href="([^"]*)"/g)].map((match) => match[1]), ['/about.txt', '/about.txt']);
  // It is the one file the build adds at its root beside the page, the headers, the licenses and what public/ holds.
  assert.equal(existsSync(join(DIST, 'assets', 'about.txt')), false);
});

test('the dist guard passes the build as it is, and fails it without about.txt, without the mark in front, with one byte changed behind the mark, and with an empty file', { skip: built ? false : NO_BUILD }, () => {
  const guard = (folder: string): { code: number | null; said: string } => {
    const run = spawnSync(process.execPath, [GUARD, folder], { encoding: 'utf8' });
    return { code: run.status, said: `${run.stdout}${run.stderr}` };
  };
  const NO_MARK = /about\.txt does not start with a byte order mark \(the bytes EF BB BF\)/;
  const DIFFERS = /about\.txt differs from src\/strings\/about\.ts behind its byte order mark/;
  const copy = mkdtempSync(join(tmpdir(), 'practice-about-'));
  try {
    cpSync(DIST, copy, { recursive: true });
    const whole = guard(copy);
    assert.equal(whole.code, 0, whole.said);
    assert.match(whole.said, /^ok: .* passes the dist guard \(1 script file, 1 stylesheet, nothing inline, _headers, licenses\.md, about\.txt\)\s*$/);

    // One byte changed behind the mark, anywhere: an older copy of the table is not the table.
    const changed = Buffer.from(bytes);
    changed[changed.length - 2] = changed[changed.length - 2] === 0x7d ? 0x20 : 0x7d;
    writeFileSync(join(copy, 'about.txt'), Buffer.concat([MARK, changed]));
    const drifted = guard(copy);
    assert.equal(drifted.code, 1, drifted.said);
    assert.match(drifted.said, DIFFERS);
    assert.doesNotMatch(drifted.said, NO_MARK);
    // The right bytes without the mark in front: the table itself, which is not what the build ships. Told
    // no charset, a browser may not read that file as UTF-8. The message is the mark's own.
    writeFileSync(join(copy, 'about.txt'), bytes);
    const bare = guard(copy);
    assert.equal(bare.code, 1, bare.said);
    assert.match(bare.said, NO_MARK);
    assert.doesNotMatch(bare.said, DIFFERS);
    // Two of the mark's three bytes are no mark.
    writeFileSync(join(copy, 'about.txt'), Buffer.concat([MARK.subarray(0, 2), bytes]));
    assert.match(guard(copy).said, NO_MARK);
    // A second mark behind the first is other bytes than the table's, and so is a mark with nothing behind it.
    writeFileSync(join(copy, 'about.txt'), Buffer.concat([MARK, MARK, bytes]));
    const twice = guard(copy);
    assert.equal(twice.code, 1, twice.said);
    assert.match(twice.said, DIFFERS);
    writeFileSync(join(copy, 'about.txt'), MARK);
    const alone = guard(copy);
    assert.equal(alone.code, 1, alone.said);
    assert.match(alone.said, DIFFERS);
    // An empty file starts with no mark.
    writeFileSync(join(copy, 'about.txt'), '');
    const empty = guard(copy);
    assert.equal(empty.code, 1, empty.said);
    assert.match(empty.said, NO_MARK);

    // No file at all.
    rmSync(join(copy, 'about.txt'));
    const missing = guard(copy);
    assert.equal(missing.code, 1, missing.said);
    assert.match(missing.said, /there is no about\.txt/);
    assert.doesNotMatch(missing.said, NO_MARK);

    // Put back as the build made it, the build passes again: nothing else in the copy was the cause.
    writeFileSync(join(copy, 'about.txt'), Buffer.concat([MARK, bytes]));
    assert.equal(guard(copy).code, 0);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test('the dist guard fails a table that starts with a byte order mark of its own: its copy would be the mark and then the table, with two marks in front', { skip: built ? false : NO_BUILD }, () => {
  // The guard takes the table from beside its own script. So this runs a copy of the script in a folder
  // laid out as the app's: the script, the headers file, the build, and a table that the test writes.
  const app = mkdtempSync(join(tmpdir(), 'practice-about-app-'));
  const table = join(app, 'src', 'strings', 'about.ts');
  const guard = (): { code: number | null; said: string } => {
    const run = spawnSync(process.execPath, [join(app, 'scripts', 'check-dist.mjs')], { encoding: 'utf8' });
    return { code: run.status, said: `${run.stdout}${run.stderr}` };
  };
  const OWN_MARK = /src\/strings\/about\.ts starts with a byte order mark of its own: the build puts the one mark in front of its copy, and about\.txt would start with two/;
  const OTHER = /about\.txt does not start with a byte order mark|about\.txt differs from src\/strings\/about\.ts/;
  try {
    for (const folder of ['scripts', 'public', join('src', 'strings')]) mkdirSync(join(app, folder), { recursive: true });
    cpSync(GUARD, join(app, 'scripts', 'check-dist.mjs'));
    cpSync(fileURLToPath(new URL('../public/_headers', import.meta.url)), join(app, 'public', '_headers'));
    cpSync(DIST, join(app, 'dist'), { recursive: true });
    // The table as the repository has it: the copy of the script passes the build, as the script itself does.
    writeFileSync(table, bytes);
    const clean = guard();
    assert.equal(clean.code, 0, clean.said);

    // The table with a mark in front, and the build that the plugin makes of such a table: its own mark,
    // then the table, mark and all. That copy is the mark and then the table, to the byte, so the two
    // messages about the copy have nothing to say. The table's own message is the one that fails the build.
    writeFileSync(table, Buffer.concat([MARK, bytes]));
    writeFileSync(join(app, 'dist', 'about.txt'), Buffer.concat([MARK, MARK, bytes]));
    const twice = guard();
    assert.equal(twice.code, 1, twice.said);
    assert.match(twice.said, OWN_MARK);
    assert.doesNotMatch(twice.said, OTHER);
    // The same table beside a build that was made before it had the mark: both are said.
    writeFileSync(join(app, 'dist', 'about.txt'), Buffer.concat([MARK, bytes]));
    const older = guard();
    assert.equal(older.code, 1, older.said);
    assert.match(older.said, OWN_MARK);
    assert.match(older.said, /about\.txt differs from src\/strings\/about\.ts behind its byte order mark/);

    // With the table as it was, the build passes again: nothing else in the folder was the cause.
    writeFileSync(table, bytes);
    assert.equal(guard().code, 0);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});
