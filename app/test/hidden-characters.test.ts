// No file of the repository holds a character that changes the direction
// of the text around it.
//
// Nine characters tell a screen to draw what follows them from right to
// left, or to stop doing so: the embeddings and overrides (U+202A to
// U+202E) and the isolates (U+2066 to U+2069). Written out in a file, they
// are invisible, and an editor or a code review then shows a line in
// another order than the one the program reads. That is how a change can
// be made to look like something it is not ("Trojan Source"). A site that
// shows the code puts a warning on every file that holds one.
//
// A test that needs such a character (a link back that carries one must be
// refused) writes it as an escape, a backslash, "u" and the four digits,
// which a reader can see and a tool cannot drop without a trace. This test
// holds every file to that. It is written the same way itself: the
// characters it looks for are made from their numbers, and none stands in
// this file.
//
// The files looked at are the ones the repository tracks, and the ones it
// would track once they are added (new files that no ignore rule covers).
// Where there is no git to ask, every file under the repository's folder
// is looked at, the folders that are never tracked aside
// (test/repository-files.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repositoryFiles, textOf } from './repository-files.ts';

/** The first and the last of each run of direction-changing characters, as numbers. */
const RANGES: readonly (readonly [number, number])[] = [
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];

/** True for a character (by its number) that changes the direction of text. */
export function changesDirection(code: number): boolean {
  return RANGES.some(([first, last]) => code >= first && code <= last);
}

/** How a character is written so that it can be seen: U+202E. */
const named = (code: number): string => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

/** Every such character in a text: the line it is on (from 1), its place in that line (from 1), and its name. */
export function hiddenIn(text: string): { line: number; column: number; name: string }[] {
  const found: { line: number; column: number; name: string }[] = [];
  let line = 1;
  let column = 0;
  for (const character of text) {
    column += 1;
    if (character === '\n') {
      line += 1;
      column = 0;
      continue;
    }
    const code = character.codePointAt(0) ?? 0;
    if (changesDirection(code)) found.push({ line, column, name: named(code) });
  }
  return found;
}

test('the check finds each of the nine characters, wherever it stands, and nothing else', () => {
  const codes = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
  for (const code of codes) {
    assert.equal(changesDirection(code), true, named(code));
    const text = `first line\nconst path = '/${String.fromCodePoint(code)}journey';\n`;
    assert.deepEqual(hiddenIn(text), [{ line: 2, column: 16, name: named(code) }], named(code));
  }
  // Their neighbours, and what a file of this repository does hold: Spanish letters, an arrow, a dash, a
  // no-break space, a zero-width space (another matter), an emoji, a Hebrew letter (text that runs from right
  // to left by itself is no hidden instruction).
  for (const code of [0x2029, 0x202f, 0x2065, 0x206a, 0xe9, 0xf1, 0x2192, 0x2014, 0xa0, 0x200b, 0x1f600, 0x5d0]) {
    assert.equal(changesDirection(code), false, named(code));
    assert.deepEqual(hiddenIn(`a${String.fromCodePoint(code)}b`), [], named(code));
  }
  assert.deepEqual(hiddenIn(''), []);
  // The escape is plain text: six ordinary characters, which is how a test writes such a character.
  assert.deepEqual(hiddenIn(`'/${String.fromCharCode(92)}u202ejourney'`), []);
  // Two in one file are both named, each by its own line.
  const two = `a${String.fromCodePoint(0x202e)}\n\n  ${String.fromCodePoint(0x2066)}b`;
  assert.deepEqual(hiddenIn(two), [
    { line: 1, column: 2, name: 'U+202E' },
    { line: 3, column: 3, name: 'U+2066' },
  ]);
});

test('no text file of the repository holds a character that changes the direction of text (U+202A to U+202E, U+2066 to U+2069)', () => {
  const { files, how } = repositoryFiles();
  // The list is the repository's: this file is on it, and so are the other packages.
  assert.ok(files.length > 300, `${how} found ${files.length} files`);
  for (const expected of ['app/test/hidden-characters.test.ts', 'app/src/main.ts', 'worker/src/handler.ts', 'contract/src/index.ts', 'e2e/src/browser.ts', 'README.md']) {
    assert.ok(files.includes(expected), `${how} did not list ${expected}`);
  }
  const problems: string[] = [];
  let read = 0;
  for (const file of files) {
    const text = textOf(file);
    if (text === null) continue;
    read += 1;
    for (const hit of hiddenIn(text)) problems.push(`${file}, line ${hit.line}, character ${hit.column}: ${hit.name}`);
  }
  assert.ok(read > 300, `${read} text files were read`);
  assert.deepEqual(problems, [], 'write the character as an escape (a backslash, "u" and its four digits), never as itself');
});
