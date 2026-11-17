// How the wallet names a chapter of the main site's Journey.
//
// The main site can renumber and retitle its chapters. So a chapter's number
// and its title are written in one place, the table of chapters in
// src/lib/doit/steps.ts, and everything else takes them from there:
//
//   - a sentence of a string table names a chapter through slots that the
//     table fills ({number} and {title} for the chapter the sentence is
//     shown for, {keysNumber} and {keysTitle} for the keys chapter), and
//     holds no number of a chapter or of a section, no count of the
//     chapters, no chapter named by its neighbour, no title, and no place
//     inside the chapter it names;
//   - a screen draws such a sentence through withChapters(), or through the
//     values chapterSlots() gives, in the page's own language;
//   - a comment, a test's name and a name in the code call a chapter by its
//     key, in words: the bitcoin chapter, the payment chapter, the keys
//     chapter.
//
// This file holds the rule and every test of it. It keeps the rule itself:
// a sample that would break it is put together from its parts, and the
// table's titles are read from the table, never typed here.

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { test } from 'node:test';
import { LANGS, STEPS, type Lang } from '@learnbitcoin/practice-contract';
import { CHAPTERS, chapterOf, chapterSlots, stepDef, type Chapter, type StepId } from '../src/lib/doit/steps.ts';
import { fill, slotNames } from '../src/lib/format.ts';
import { ledeKey, withChapters } from '../src/screens/doit/view.ts';
import { strings, type Area } from '../src/strings/index.ts';
import { ROOT, repositoryFiles, textOf } from './repository-files.ts';

type Table = Readonly<Record<string, string>>;

// -- the rule ---------------------------------------------------------------------------------

const EN_CARDINAL = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';
const EN_ORDINAL = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth';
const ES_CARDINAL = 'uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce';
const ES_ORDINAL =
  'primer|primero|primera|segundo|segunda|tercer|tercero|tercera|cuarto|cuarta|quinto|quinta|sexto|sexta|s[ée]ptimo|s[ée]ptima|octavo|octava|noveno|novena|d[ée]cimo|d[ée]cima';
/** A mark for "number" that can stand between a unit and its digits, with or without its full stops. */
const MARK = String.raw`(?:number|no\.?|n[úu]mero|n[úu]m\.?|n\.?[º°]\.?|n\.o|#)`;
/** What may stand between a unit and its number: a space, a bracket, a colon, a hash, a hyphen, an opening quotation mark. */
const BETWEEN = String.raw`[\s(:#"'“‘«-]`;
/** A letter that a Spanish word could go on with: "\b" does not know the accented ones. */
const LETTER = '[a-záéíóúñ]';

/**
 * A unit named by a number. `en` and `es` are the words for the unit, `short`
 * its short forms, all as patterns. In order: the unit or a short form, then
 * at most a mark, then digits; the English unit and then a number word; an
 * English ordinal and then the unit; the Spanish unit and then a number word
 * or an ordinal; a Spanish ordinal and then the unit.
 */
function numberRules(en: string, es: string, short: string): RegExp[] {
  return [
    new RegExp(String.raw`\b(?:${en}|${es}|${short})${BETWEEN}*(?:${MARK}${BETWEEN}*)?[0-9]`, 'gi'),
    new RegExp(String.raw`\b(?:${en})\s+(?:(?:number|no\.?)\s+)?(?:${EN_CARDINAL})\b`, 'gi'),
    new RegExp(String.raw`\b(?:${EN_ORDINAL}|[0-9]+(?:st|nd|rd|th))\s+(?:${en})\b`, 'gi'),
    new RegExp(String.raw`\b(?:${es})\s+(?:(?:n[úu]mero|n[úu]m\.?)\s+)?(?:${ES_CARDINAL}|${ES_ORDINAL})(?!${LETTER})`, 'gi'),
    new RegExp(String.raw`(?<!${LETTER})(?:${ES_ORDINAL}|[0-9]+\.?[ºªoa])\s+(?:${es})(?!${LETTER})`, 'gi'),
  ];
}

/** A Roman numeral from two up to thirty-nine, in capitals. One capital I is left out: it is a word of its own. */
const ROMAN = /^(?:X{1,3}(?:IX|IV|V?I{0,3})|IX|IV|VI{0,3}|I{2,3})$/;

/**
 * A unit named by a Roman numeral. `unit` is the words for the unit, as a
 * pattern, in any case; the numeral counts only in capitals ("vi" and "mix"
 * are words).
 */
function romanHits(text: string, unit: string): string[] {
  const rule = new RegExp(String.raw`\b(?:${unit})${BETWEEN}*([ivx]+)(?![\p{L}\p{N}])`, 'giu');
  return [...text.matchAll(rule)].filter((hit) => ROMAN.test(hit[1] ?? '')).map((hit) => hit[0]);
}

/** The words for a chapter and for a section, for a text a reader sees. */
const UNIT_EN = 'chapters?|sections?';
const UNIT_ES = 'cap[ií]tulos?|secci[oó]n|secciones';

/**
 * For a text a reader sees: chapters and sections by number, a count of
 * chapters (two or more), a chapter named by its neighbour, and a number
 * right before "of the Journey".
 */
const IN_STRINGS: RegExp[] = [
  ...numberRules(UNIT_EN, UNIT_ES, String.raw`chap\.?|ch\.?|sec\.|caps?\.`),
  new RegExp(String.raw`\b(?:[0-9]+|${EN_CARDINAL.replace('one|', '')})\s+(?:[a-z]+\s+)?chapters\b`, 'gi'),
  new RegExp(String.raw`(?<![a-záéíóúñ0-9])(?:[0-9]+|${ES_CARDINAL.replace('uno|', '')})\s+cap[ií]tulos(?!${LETTER})`, 'gi'),
  /\b(?:next|previous|last|final|following|preceding)\s+chapters?\b|\bchapters?\s+(?:before|after)\b/gi,
  /\bchapters?\s+that\s+(?:follows?|precedes?|comes?\s+(?:next|first|last|before|after))\b/gi,
  new RegExp(String.raw`(?<!${LETTER})(?:siguiente|anterior|pr[oó]ximo|[uú]ltimo)\s+cap[ií]tulos?(?!${LETTER})|\bcap[ií]tulos?\s+(?:siguiente|anterior|final)(?!${LETTER})`, 'gi'),
  new RegExp(String.raw`\bcap[ií]tulos?\s+que\s+(?:siguen?|vienen?|preceden?)(?!${LETTER})`, 'gi'),
  new RegExp(String.raw`\b(?:[0-9]+|${EN_CARDINAL.replace('one|', '')}|${EN_ORDINAL})\s+of\s+the\s+Journey\b`, 'gi'),
  new RegExp(String.raw`(?<![a-záéíóúñ0-9])(?:[0-9]+|${ES_CARDINAL.replace('uno|', '')}|${ES_ORDINAL})\s+del\s+Recorrido(?!${LETTER})`, 'gi'),
];

/**
 * For a text that names a chapter through a slot, on top of the rules above:
 * a place inside the chapter by a number (a part, a point, a rule, a page,
 * in either language), and a number typed beside a slot for a chapter's
 * number. The wallet's own steps have parts, so "Part 3" is not forbidden
 * everywhere: only where a chapter is named.
 */
const IN_NAMING: RegExp[] = [
  ...numberRules('parts?|points?|paragraphs?|pages?|headings?|rules?|items?', 'partes?|puntos?|apartados?|p[áa]rrafos?|p[áa]ginas?|reglas?', '(?!)'),
  /\{[A-Za-z]*[Nn]umber\}\s*(?:,|-|and|or|to|through|y|o|a|al)\s*[0-9]/g,
];

/** A title as the table writes it, capitals and all, where it stands as whole words. */
function holdsTitle(text: string, title: string): boolean {
  const literal = title.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${literal}(?![\p{L}\p{N}])`, 'u').test(text);
}

/** True for a text with a slot that the table of chapters fills: `names` are the slots it can fill. */
function namesChapter(text: string, names: readonly string[]): boolean {
  return slotNames(text).some((name) => names.includes(name));
}

/**
 * What a text holds that the rule forbids. An empty list is a pass. `titles`
 * are the table's, in both languages. `naming` is true for a text that names
 * a chapter through a slot, which is held to the rules for a place as well.
 */
function chapterNamesIn(text: string, titles: readonly string[], naming = false): string[] {
  const rules = naming ? [...IN_STRINGS, ...IN_NAMING] : IN_STRINGS;
  const found = rules.flatMap((rule) => [...text.matchAll(rule)].map((hit) => hit[0]));
  found.push(...romanHits(text, `${UNIT_EN}|${UNIT_ES}`));
  for (const title of titles) if (holdsTitle(text, title)) found.push(`the title "${title}"`);
  return found;
}

// -- the rule for a file of the repository: comments, test names and names in the code ------------

/** The one file that holds a chapter's number and its title. */
const TABLE_FILE = 'app/src/lib/doit/steps.ts';

/**
 * For any text file: a chapter by a number, in words or as part of a name.
 * Sections are left out, because comments name sections of the specs. So
 * are counts and neighbours: a comment may say what the code does about
 * the chapter that follows.
 */
const IN_FILES: RegExp[] = [
  ...numberRules('chapters?', 'cap[ií]tulos?', String.raw`chap\.?|ch\.|caps?\.`),
  /chapters?[_-]?[0-9]/gi,
  /chapters?[_-](?:one|two|three|four|five|six|seven|eight|nine|ten)(?![a-z])/gi,
  /[Cc]hapters?(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)(?![a-z])/g,
];

/**
 * A file's text with its lines joined, so that a sentence that runs over two
 * lines of a comment is read whole: a line break and the comment mark that
 * follows it count as one space.
 */
function joined(text: string): string {
  return text.replace(/\s*\n\s*(?:\/\/+|\*|#|<!--)?\s*/g, ' ');
}

/**
 * What a file holds that the rule forbids, each hit with the joined text
 * around it: in its text and in its own path. `titles` is empty for the
 * table's own file.
 */
function inFile(path: string, text: string, titles: readonly string[]): string[] {
  const whole = joined(text);
  const found: string[] = [];
  for (const rule of IN_FILES) {
    for (const hit of whole.matchAll(rule)) {
      found.push(`"${hit[0]}" in <<${whole.slice(Math.max(0, hit.index - 60), hit.index + hit[0].length + 40)}>>`);
    }
    for (const hit of path.matchAll(rule)) found.push(`"${hit[0]}" in the file's path`);
  }
  for (const hit of romanHits(whole, 'chapters?|cap[ií]tulos?')) found.push(`"${hit}", a chapter by a Roman numeral`);
  for (const title of titles) {
    if (holdsTitle(whole, title) || holdsTitle(text, title) || holdsTitle(path, title)) found.push(`the title "${title}"`);
  }
  return found;
}

// -- what the tests read ------------------------------------------------------------------------

const areas = Object.keys(strings) as Area[];

/** Every text of every table: where it is, and what it says. */
function everyText(): { area: Area; lang: Lang; key: string; where: string; text: string }[] {
  return areas.flatMap((area) =>
    LANGS.flatMap((lang) =>
      Object.entries(strings[area][lang] as Table).map(([key, text]) => ({ area, lang, key, where: `${area}.${lang}.${key}`, text })),
    ),
  );
}

/** The titles of the table, in both languages, read the one way there is. */
function tableTitles(): string[] {
  return LANGS.flatMap((lang) => CHAPTERS.map((chapter) => chapterSlots(lang, chapter).title ?? ''));
}

/** The .ts and .svelte files of the app and of its development gallery, the string tables aside. */
function codeFiles(): string[] {
  return repositoryFiles().files.filter(
    (file) => /^app\/(?:src|dev)\/.+\.(?:ts|svelte)$/.test(file) && !file.startsWith('app/src/strings/'),
  );
}

/** A file's text without its comment lines: the lines whose first mark is one of a comment's. */
function codeOf(file: string): string {
  return (textOf(file) ?? '')
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*|<!--)/.test(line))
    .join('\n');
}

/**
 * The arguments of every call of `name(` in a text, each call's list split
 * at the commas that stand inside no bracket. A name with a letter, a digit
 * or one full stop right before it is another name, and is left out; three
 * full stops are a spread, and count.
 */
function callsOf(code: string, name: string): string[][] {
  const calls: string[][] = [];
  for (const hit of code.matchAll(new RegExp(String.raw`(?:^|[^\w$.]|\.\.\.)${name}\(`, 'gm'))) {
    const args: string[] = [];
    let depth = 0;
    let piece = '';
    for (let at = hit.index + hit[0].length; at < code.length; at += 1) {
      const char = code[at] ?? '';
      if (char === ')' && depth === 0) break;
      if ('([{'.includes(char)) depth += 1;
      if (')]}'.includes(char)) depth -= 1;
      if (char === ',' && depth === 0) {
        args.push(piece.trim());
        piece = '';
      } else {
        piece += char;
      }
    }
    if (piece.trim() !== '') args.push(piece.trim());
    calls.push(args);
  }
  return calls;
}

/** Words with a space between them: how a sample that the rule would catch in this file is written. */
const say = (...words: (string | number)[]): string => words.join(' ');
/** The same with nothing between them, for a name. */
const glue = (...parts: (string | number)[]): string => parts.join('');

// -- 1 ------------------------------------------------------------------------------------------

test("the rule: what it catches, what it lets pass, and what it reads as a chapter's number", () => {
  const caught = [
    say('Chapter', 4, 'says the words are made from them'),
    say('chapter', "4's", 'drill'),
    say('chapters', 2, 'and', 3),
    say('chapters', '2-4'),
    say('chapter', 'four'),
    say('chapter', 'number', 'four'),
    say('the', 'fourth', 'chapter'),
    say('the', '4th', 'chapter'),
    say('chapter', '#4'),
    say('chapter', 'no.', 4),
    say('ch.', 4),
    say('chap.', 4),
    glue('chapter', '-', 4),
    say('chapter', '(4)'),
    say('Chapter:', 4),
    say('El', 'capítulo', 4),
    say('CAPÍTULO', 4),
    say('del', 'capítulo', 'cuatro'),
    say('capítulo', 'número', 'cuatro'),
    say('cap.', 4),
    say('el', 'cuarto', 'capítulo'),
    say('el', 'primer', 'capítulo'),
    say('capítulo', 'n.º', 4),
    say('section', 7),
    say('sec.', 7),
    say('sección', 7),
    say('section', 'seven'),
    say('la', 'sección', 'siete'),
    say('la', 'tercera', 'sección'),
    say("the Journey's", 'six', 'chapters'),
    say('all', 7, 'chapters'),
    say('seven', 'short', 'chapters'),
    say('los', 'siete', 'capítulos'),
    say('the', 'next', 'chapter'),
    say('the', 'last', 'chapter'),
    say('the', 'final', 'chapter'),
    say('the', 'chapter', 'after', 'this one'),
    say('the', 'chapter', 'before', 'it'),
    say('el', 'siguiente', 'capítulo'),
    say('el', 'último', 'capítulo'),
    say('el', 'capítulo', 'anterior'),
    say('el', 'próximo', 'capítulo'),
    // The same in other written forms: a Roman numeral, a short form with no full stop, a number in
    // quotation marks, a mark for "number" with no full stop, and a neighbour said with a verb.
    say('chapter', 'IV'),
    say('Chapter', 'XII', 'is about keys'),
    say('capítulo', 'IV'),
    say('section', 'III'),
    say('Ch', 4),
    glue('chapter "', 4, '"'),
    glue("chapter '", 4, "'"),
    say('capítulo', 'nº', 4),
    say('capítulo', 'n°', 4),
    say('part', 4, 'of the Journey'),
    say('The', 'fourth', "of the Journey's chapters has steps"),
    say('la', 'parte', 4, 'del Recorrido'),
    say('the', 'chapter', 'that follows'),
    say('the', 'chapter', 'that comes next'),
    say('el', 'capítulo', 'que sigue'),
    say('el', 'capítulo', 'que viene'),
  ];
  for (const text of caught) assert.notDeepEqual(chapterNamesIn(text, []), [], `not caught: ${text}`);

  const titles = tableTitles();
  const passes = [
    '12 words',
    'six confirmations',
    'chapter',
    '2 of 3',
    'a chapter of the Journey',
    'un capítulo del Recorrido',
    'This wallet has steps that go with some chapters of the Journey.',
    "one of the Journey's chapters",
    'the chapter you came from',
    say('the chapter', 'I', 'came from'),
    say('En el capítulo', 'vi', 'que no hay saldos'),
    'Back to the chapter',
    'Volver al capítulo',
    'Chapter {number}, "{title}"',
    'Steps of chapter {number}',
    "chapter {keysNumber}'s drill",
    'Capítulo {keysNumber} del Recorrido, "{keysTitle}"',
    'Chapter {number} says what bitcoin is.',
    'El capítulo {number} dice qué es bitcoin.',
    'Wallet sections',
    'Secciones de la billetera',
    'part {n} of {m}',
    'Part 3',
    'Three right words do not prove the other nine',
    'It waited 1 second',
    '6. Check that the addresses start bcrt1',
    'the other steps of that chapter',
    "which of a chapter's two pages",
    'There are no balances',
    'the next step of the same chapter',
    'Next step: {step}',
    'el paso siguiente',
  ];
  for (const text of passes) assert.deepEqual(chapterNamesIn(text, titles), [], `wrongly caught: ${text}`);

  // A sentence that names a chapter through a slot may not say where in the chapter a thing stands, by any
  // word, nor type another chapter's number beside the slot. Elsewhere "Part 3" is the wallet's own.
  const [first] = CHAPTERS;
  assert.ok(first !== undefined);
  const names = Object.keys(chapterSlots('en', first));
  const places = [
    '(chapter {keysNumber}, point 3)',
    '(chapter {keysNumber}, part 7)',
    'chapter {keysNumber}, rule 2',
    'the second point of chapter {keysNumber}',
    '(chapters {keysNumber} and 5)',
    'chapters {bitcoinNumber}, 3 and {keysNumber}',
    '(capítulo {keysNumber}, apartado 7)',
    '(capítulo {keysNumber}, punto tres)',
    'la segunda parte del capítulo {number}',
  ];
  for (const text of places) {
    assert.ok(namesChapter(text, names), text);
    assert.notDeepEqual(chapterNamesIn(text, [], true), [], `not caught: ${text}`);
  }
  for (const text of ['Part 3', 'part {n} of {m}', 'Parte 3', '12 words on this page']) {
    assert.ok(!namesChapter(text, names), text);
    assert.deepEqual(chapterNamesIn(text, [], false), [], `wrongly caught: ${text}`);
  }
  for (const text of ['Chapter {number}, "{title}"', 'This page, which shows 12 words, is named in chapter {keysNumber}.', 'El capítulo {number} dice qué es bitcoin.']) {
    assert.ok(namesChapter(text, names), text);
    assert.deepEqual(chapterNamesIn(text, titles, true), [], `wrongly caught: ${text}`);
  }

  // A number or an ordinal right beside the word is always read as the chapter's or the section's, also
  // where it counts something else. Such a sentence is reworded.
  const readAsNumber = [
    say('In this chapter', 12, 'words are shown'),
    say('A chapter', 'one', 'step long'),
    say('En este capítulo', 'dos', 'monedas cambian de manos'),
    say('In this section', 1, 'coin is shown'),
    say('The', 'first', 'section of this screen'),
  ];
  for (const text of readAsNumber) assert.notDeepEqual(chapterNamesIn(text, []), [], `not read as a number: ${text}`);

  // A title is found as the table writes it, where it stands as whole words: alone, in a heading, in
  // brackets and in quotation marks. Not in another case, and not inside a longer word.
  assert.equal(titles.length, CHAPTERS.length * LANGS.length);
  for (const title of titles) {
    const hit = [`the title "${title}"`];
    assert.deepEqual(chapterNamesIn(title, [title]), hit, title);
    assert.deepEqual(chapterNamesIn(`Chapter {number}, "${title}"`, [title]), hit, title);
    assert.deepEqual(chapterNamesIn(`(${title})`, [title]), hit, title);
    assert.deepEqual(chapterNamesIn(`"${title}".`, [title]), hit, title);
    for (const other of [title.toLowerCase(), title.toUpperCase()]) {
      if (other !== title) assert.deepEqual(chapterNamesIn(other, [title]), [], other);
    }
    for (const other of [`x${title}`, `${title}x`, `${title}9`, `9${title}`, `é${title}`, `${title}ñ`]) {
      assert.deepEqual(chapterNamesIn(other, [title]), [], other);
    }
  }
  // A short title is not found in a sentence that holds its word in another case.
  assert.deepEqual(chapterNamesIn('Checking three words needs the keys of this wallet, and your passkey loads them.', ['Keys']), []);
  assert.deepEqual(chapterNamesIn('Keys are made from the 12 words.', ['Keys']), ['the title "Keys"']);
  // A title that holds a mark of a pattern is taken as it is written.
  assert.deepEqual(chapterNamesIn('Read "Keys (and Words)?" first.', ['Keys (and Words)?']), ['the title "Keys (and Words)?"']);
  assert.deepEqual(chapterNamesIn('Keys and Words', ['Keys (and Words)?']), []);
});

// -- 2 ------------------------------------------------------------------------------------------

test("no text of a string table names a chapter or a section by a number, counts the chapters, names a chapter by its neighbour, or holds a chapter's title", () => {
  const titles = tableTitles();
  const texts = everyText();
  assert.ok(texts.length > 1000, `the walk found ${texts.length} texts`);
  const [first] = CHAPTERS;
  assert.ok(first !== undefined);
  const names = Object.keys(chapterSlots('en', first));
  const problems: string[] = [];
  let slotted = 0;
  for (const { where, text } of texts) {
    // A text that names a chapter through a slot is held to the rules for a place inside a chapter as well.
    const withSlot = namesChapter(text, names);
    if (withSlot) slotted += 1;
    for (const hit of chapterNamesIn(text, titles, withSlot)) problems.push(`${where}: ${hit}`);
  }
  assert.deepEqual(problems, [], 'a sentence names a chapter through the slots that the table of chapters fills (src/lib/doit/steps.ts)');
  assert.equal(slotted, NAMING.length * LANGS.length, 'the texts with a slot for a chapter are the ones the next test lists');

  // A title is a title and nothing more: one that was pasted with its number, or with the word for a
  // chapter in front of a number, is caught here.
  for (const title of titles) assert.deepEqual(chapterNamesIn(title, []), [], title);

  // The walk above is over the map of tables (strings/index.ts). So every table has to be in the map, and
  // no screen may take a text from a table's own file, past the map.
  const folder = 'app/src/strings';
  const tableFiles = readdirSync(join(ROOT, folder))
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
    .map((name) => name.slice(0, -'.ts'.length));
  assert.deepEqual(tableFiles.sort(), [...areas].sort(), 'every file of string tables is an area of the map, and the other way round');

  const files = codeFiles();
  assert.ok(files.length > 100, `${files.length} files of the app were read`);
  const past: string[] = [];
  const IMPORT = /\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g;
  for (const file of files) {
    for (const hit of (textOf(file) ?? '').matchAll(IMPORT)) {
      const named = hit[2] ?? hit[3] ?? '';
      if (!named.startsWith('.')) continue;
      const target = posix.normalize(posix.join(posix.dirname(file), named));
      if (!target.startsWith(`${folder}/`) || target === `${folder}/index.ts`) continue;
      // Only a type may be taken from a table's own file: a type carries no text.
      if (hit[1] === undefined) past.push(`${file} imports ${named}`);
    }
  }
  assert.deepEqual(past, [], 'a screen reads its texts through strings/index.ts');
});

// -- 3 ------------------------------------------------------------------------------------------

/** The step whose lede a key is, for the five ledes that name their chapter. */
const lede = (step: StepId): { area: Area; key: string; slots: readonly string[]; step: StepId } => ({
  area: 'doit',
  key: ledeKey(step),
  slots: ['number'],
  step,
});

/**
 * The sentences that name a chapter, and the slots each does it through.
 * `each` marks the two that are shown once for every chapter, and `step`
 * the step whose own chapter a lede names.
 */
const NAMING: readonly { area: Area; key: string; slots: readonly string[]; each?: true; step?: StepId }[] = [
  { area: 'doit', key: 'chapterHeading', slots: ['number', 'title'], each: true },
  { area: 'doit', key: 'listSteps', slots: ['number'], each: true },
  lede('hold-some'),
  lede('pass-it-on'),
  lede('no-balances'),
  lede('the-seed'),
  lede('prove-the-backup'),
  { area: 'doit', key: 'guide_hold-some_1', slots: ['keysNumber'] },
  { area: 'doit', key: 'wordsOnce', slots: ['keysNumber'] },
  { area: 'doit', key: 'removeWarnFunded', slots: ['keysNumber'] },
  { area: 'settings', key: 'removeDrill', slots: ['keysNumber'] },
  { area: 'backup', key: 'exception', slots: ['keysNumber'] },
  { area: 'backup', key: 'chapterLink', slots: ['keysNumber'] },
  { area: 'restore', key: 'exception', slots: ['keysNumber'] },
  { area: 'restore', key: 'chapter', slots: ['keysNumber', 'keysTitle'] },
];

test('the sentences that name a chapter, and the slots each does it through; no other text has such a slot', () => {
  assert.equal(NAMING.length, 15);
  const [first] = CHAPTERS;
  assert.ok(first !== undefined);
  const bitcoin = chapterOf('bitcoin');

  for (const lang of LANGS) {
    // Every name the table can fill: one pair for each chapter, and the pair of the chapter in hand.
    const names: string[] = Object.keys(chapterSlots(lang, first));
    assert.ok(names.includes('number') && names.includes('title') && names.includes('keysNumber') && names.includes('keysTitle'), lang);

    const text = (area: Area, key: string): string => {
      const found = (strings[area][lang] as Table)[key];
      assert.ok(found !== undefined, `${area}.${lang}.${key}`);
      return found;
    };

    for (const { area, key, slots } of NAMING) {
      assert.deepEqual(slotNames(text(area, key)).sort(), [...slots].sort(), `${area}.${lang}.${key}`);
    }
    // A title stands in quotation marks, as a step's title does in a sentence, and the sentence puts no
    // colon of its own beside it: a title may hold a colon, and two in a row stutter.
    let titled = 0;
    for (const { area, key, slots } of NAMING) {
      for (const name of slots.filter((slot) => /[Tt]itle$/.test(slot))) {
        titled += 1;
        assert.ok(text(area, key).includes(`"{${name}}"`), `${area}.${lang}.${key}: {${name}} does not stand in quotation marks`);
        assert.ok(!text(area, key).includes(':'), `${area}.${lang}.${key}: a colon beside a title`);
      }
    }
    assert.equal(titled, 2, lang);
    const listed = new Set(NAMING.map(({ area, key }) => `${area}.${key}`));
    for (const { area, key, lang: its, where, text: other } of everyText()) {
      if (its !== lang || listed.has(`${area}.${key}`)) continue;
      assert.deepEqual(
        slotNames(other).filter((name) => names.includes(name)),
        [],
        `${where} has a slot of the table of chapters, and is not on the list of this test`,
      );
    }

    // Each is filled here, by fill() and the values the table gives for the slots the text names. The
    // result is whole, and it is what withChapters() gives.
    for (const { area, key, slots, each, step } of NAMING) {
      const template = text(area, key);
      const owns: (Chapter | undefined)[] = each === true ? [...CHAPTERS] : [step === undefined ? undefined : stepDef(step).chapter];
      for (const own of owns) {
        const where = `${area}.${lang}.${key}${own === undefined ? '' : `, for the ${own.key} chapter`}`;
        const all = chapterSlots(lang, own);
        const values: Record<string, string> = {};
        for (const name of slots) {
          const value = all[name];
          assert.ok(value !== undefined && value !== '', `${where}: {${name}}`);
          values[name] = value;
        }
        const filled = fill(template, values);
        assert.ok(!filled.includes('{') && !filled.includes('}'), where);
        assert.notEqual(filled, template, where);
        assert.equal(withChapters(template, lang, own), filled, where);
        // A sentence about the keys chapter says the same wherever it stands.
        if (slots.every((name) => name === 'keysNumber' || name === 'keysTitle')) {
          assert.equal(withChapters(template, lang, bitcoin), withChapters(template, lang), where);
        }
      }
    }

    // All six ledes are drawn the same way, the one with no slot too.
    for (const id of STEPS) {
      const filled = withChapters(text('doit', ledeKey(id)), lang, stepDef(id).chapter);
      assert.ok(filled !== '' && !filled.includes('{') && !filled.includes('}'), `${lang} ${id}`);
    }
  }
});

// -- 4 ------------------------------------------------------------------------------------------

/** The keys that hold a chapter's slot and are read by name: the list above, without the ledes, the guide and restore.chapter. */
const BY_NAME = [...new Set(NAMING.map(({ key }) => key).filter((key) => !/^(?:lede|guide)_/.test(key) && key !== 'chapter'))];
/** A read of one of them: "withChapters(" if it is there, the path to the table, the key. */
const READ = new RegExp(String.raw`(withChapters\()?((?:\b[A-Za-z_$][\w$]*(?:\[[\w$.]+\])?\.)+)(${BY_NAME.join('|')})(?![\w$])`, 'g');
/** The link's words on Restore, whose key is a word the code uses for other things. */
const READ_CHAPTER = /(withChapters\()?\bt\.chapter(?![\w$])/g;

test('each of those sentences is drawn through the table', () => {
  assert.deepEqual(BY_NAME, ['chapterHeading', 'listSteps', 'wordsOnce', 'removeWarnFunded', 'removeDrill', 'exception', 'chapterLink']);
  const files = codeFiles();
  assert.ok(files.length > 100, `${files.length} files of the app were read`);
  const VIEW = 'app/src/screens/doit/view.ts';
  for (const expected of [VIEW, 'app/src/screens/Step.svelte', 'app/src/screens/doit/OpenPart.svelte', 'app/dev/Pieces.svelte']) {
    assert.ok(files.includes(expected), expected);
  }

  // (a) Read by name: each read stands as the first thing inside withChapters(.
  const bare: string[] = [];
  const read = new Map<string, number>();
  for (const file of files) {
    const code = codeOf(file);
    const hits = [...code.matchAll(READ)].map((hit) => ({ inside: hit[1] !== undefined, key: hit[3] ?? '', text: hit[0] }));
    if (file === 'app/src/screens/Restore.svelte') {
      for (const hit of code.matchAll(READ_CHAPTER)) hits.push({ inside: hit[1] !== undefined, key: 'chapter', text: hit[0] });
    }
    for (const { inside, key, text } of hits) {
      read.set(key, (read.get(key) ?? 0) + 1);
      if (!inside) bare.push(`${file}: ${text}`);
    }
  }
  assert.deepEqual(bare, [], 'a sentence that names a chapter is drawn as withChapters(<the sentence>, <the language>, ...)');
  for (const key of [...BY_NAME, 'chapter']) assert.ok((read.get(key) ?? 0) >= 1, `${key} is read by no screen`);

  // (b) The ledes: their key is built in one place outside view.ts, and what it finds goes through the table.
  const calls = (name: string): string[] => files.filter((file) => file !== VIEW && codeOf(file).includes(`${name}(`));
  const count = (file: string, piece: string): number => codeOf(file).split(piece).length - 1;
  assert.deepEqual(calls('ledeKey'), ['app/src/screens/Step.svelte']);
  assert.equal(count('app/src/screens/Step.svelte', 'ledeKey('), 1);
  assert.equal(count('app/src/screens/Step.svelte', 'withChapters(t[ledeKey(id)], router.lang, stepDef(id).chapter)'), 1);

  // (c) The guides: the same, and the values a guide is filled from begin with the table's.
  assert.deepEqual(calls('guideKey'), ['app/src/screens/doit/OpenPart.svelte']);
  assert.equal(count('app/src/screens/doit/OpenPart.svelte', 'guideKey('), 1);
  assert.equal(count('app/src/screens/doit/OpenPart.svelte', 'fillFrom(t[guideKey(id, part, blockSeconds)], values)'), 1);
  assert.match(codeOf('app/src/screens/doit/OpenPart.svelte'), /let values = \$derived\(\{\n\s*\.\.\.chapterSlots\(lang, stepDef\(id\)\.chapter\),\n/);

  // (d) The language handed to the table is the page's own. The two languages hold the same numbers until
  // the main site renumbers one of them alone, so a wrong language would show on no screen before that day.
  // Outside the two files that define them, every call of withChapters(), chapterSlots() and
  // chapterHeading() is handed `router.lang`, or `lang` in a file whose `lang` is `router.lang`: never a
  // language written out, and never another name.
  const handed: Record<string, number> = {};
  for (const file of files) {
    if (file === VIEW || file === TABLE_FILE) continue;
    const code = codeOf(file);
    for (const [name, place] of [
      ['withChapters', 1],
      ['chapterSlots', 0],
      ['chapterHeading', 1],
    ] as const) {
      for (const args of callsOf(code, name)) {
        const lang = args[place] ?? '';
        handed[name] = (handed[name] ?? 0) + 1;
        assert.ok(lang === 'router.lang' || lang === 'lang', `${file}: ${name}(${args.join(', ')}) is handed "${lang}" as its language`);
        if (lang === 'lang') assert.ok(code.includes('let lang = $derived(router.lang);'), `${file}: its "lang" is not the page's language`);
      }
    }
  }
  assert.deepEqual(handed, { withChapters: 10, chapterSlots: 1, chapterHeading: 3 }, 'every call was found');
  // The splitter itself: a call inside a call, a spread, and a method of the same name, which is another thing.
  assert.deepEqual(callsOf("a(t[key(id)], router.lang, stepDef(id).chapter) ...a(lang, b(c, d)) x.a('en')", 'a'), [
    ['t[key(id)]', 'router.lang', 'stepDef(id).chapter'],
    ['lang', 'b(c, d)'],
  ]);
});

// -- 5 ------------------------------------------------------------------------------------------

test("no text file of the repository names a chapter by a number, and none but the table holds a chapter's title", () => {
  const titles = tableTitles();

  // What the rule for files catches, and what it lets pass.
  const caught: [path: string, text: string][] = [
    ['a.ts', glue('const CHAPTER', '_', 4, ' = 1;')],
    ['a.ts', glue('const CHAPTER', '_', 'FOUR', ': Record<Lang, string> = {')],
    ['a.ts', glue('const CHAPTER', '_', 'FOUR', '_PATH = 1;')],
    ['a.ts', glue("const key = 'chapter", '_', "four';")],
    ['a.ts', glue('data-testid="chapter', '-', 'four"')],
    ['a.ts', glue('data-testid="chapter', '-', 4, '"')],
    ['a.ts', glue('export function chapter', 'Four', 'Url(siteUrl: string, lang: Lang): string {')],
    ['a.ts', glue('import Chapter', 'Four', 'Link from "./Link.svelte";')],
    ['a.ts', glue('const isChapter', 'Four', ' = true;')],
    ['a.ts', glue('en.chapter', '_', 2)],
    [glue('app/src/screens/chapter', '-', 4, '.ts'), 'export {};'],
    ['a.ts', glue('// the rule of chapter', '\n', '// 4 is answered here')],
    ['a.ts', glue('/**', '\n', ' * the rule of chapter', '\n', ' * 4 is answered here', '\n', ' */')],
    ['a.md', say('The site says so in chapter', 4, 'of its Journey.')],
    // The other written forms of a number count in a file as they do in a string.
    ['a.md', say('The site says so in chapter', 'IV', 'of its Journey.')],
    ['a.ts', say('// the rule of chapter', 'nº', 4)],
    ['a.ts', glue('// the rule of chapter "', 4, '"')],
  ];
  for (const [path, text] of caught) assert.notDeepEqual(inFile(path, text, titles), [], `not caught: ${text} in ${path}`);
  const passes = [
    say('// the chapter', 'I', 'came from'),
    '`chapter_${chapter.number}`',
    '<section aria-labelledby="{uid}-chapter-{chapter.key}">',
    "stepsOf('keys')",
    '// the keys chapter: the drill',
    '// has not read the next chapter yet',
    '// section 7 of the spec',
    '// The next step of each, where the chapter has one',
    '// what the bitcoin chapter says: what bitcoin is',
  ];
  for (const text of passes) assert.deepEqual(inFile('a.ts', text, titles), [], `wrongly caught: ${text}`);
  for (const title of titles) {
    assert.deepEqual(inFile('a.ts', `test('${title} is linked', () => {});`, titles), [`the title "${title}"`]);
    assert.deepEqual(inFile(`app/test/${title}.ts`, 'export {};', titles), [`the title "${title}"`]);
    // The table's own file is read with no titles to look for.
    assert.deepEqual(inFile(TABLE_FILE, `title: '${title}'`, []), []);
  }

  // Every text file of the repository.
  const { files, how } = repositoryFiles();
  assert.ok(files.length > 300, `${how} found ${files.length} files`);
  for (const expected of [TABLE_FILE, 'app/test/chapter-names.test.ts', 'app/src/strings/doit.ts', 'e2e/scenarios/doit-handover.test.ts', 'contract/src/index.ts', 'README.md']) {
    assert.ok(files.includes(expected), `${how} did not list ${expected}`);
  }
  const problems: string[] = [];
  let read = 0;
  for (const file of files) {
    const text = textOf(file);
    if (text === null) continue;
    read += 1;
    for (const hit of inFile(file, text, file === TABLE_FILE ? [] : titles)) problems.push(`${file}: ${hit}`);
  }
  assert.ok(read > 300, `${read} text files were read`);
  // The table's own file was read, and it does hold the titles: the search for them finds what it looks for.
  const table = textOf(TABLE_FILE) ?? '';
  for (const title of titles) assert.ok(holdsTitle(table, title), title);
  assert.deepEqual(
    problems,
    [],
    'a chapter is named by its key, in words (the bitcoin chapter, the payment chapter, the keys chapter); its number and its title are in the table of src/lib/doit/steps.ts and nowhere else',
  );
});
