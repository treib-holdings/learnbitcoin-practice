// The files of the repository, for the tests that hold every one of them to
// a rule (test/hidden-characters.test.ts, test/chapter-names.test.ts).
//
// The files looked at are the ones the repository tracks, and the ones it
// would track once they are added (new files that no ignore rule covers).
// Where there is no git to ask, every file under the repository's folder
// is looked at, the folders that are never tracked aside.
//
// Not a test file: it holds no test, as test/doit-worlds.ts holds none.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository's own folder: the one that holds app/, worker/ and the rest. */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Folders that are never tracked: what is installed, what is built, and git's own. */
const SKIPPED = new Set(['node_modules', 'dist', '.git', '.wrangler', 'coverage', '__pycache__', '.venv', '.pytest_cache']);

/** Every file under a folder, by its path from the repository's folder. */
function walk(folder: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(relative(ROOT, path));
  }
  return files;
}

/**
 * The files to look at: the ones git tracks, and the new ones it would
 * track (not ignored). Without git, or outside a checkout, every file
 * under the repository's folder.
 */
export function repositoryFiles(): { files: string[]; how: 'git' | 'walk' } {
  try {
    const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files = listed.split('\0').filter((name) => name !== '');
    if (files.length > 0) return { files, how: 'git' };
  } catch {
    // No git here, or no checkout: the folder itself is walked.
  }
  return { files: walk(ROOT), how: 'walk' };
}

/** A file's text, or null for a file that is no text (it holds a zero byte) or is not there any more. */
export function textOf(path: string): string | null {
  let bytes: Buffer;
  try {
    const full = join(ROOT, path);
    if (!statSync(full).isFile()) return null;
    bytes = readFileSync(full);
  } catch {
    return null;
  }
  return bytes.includes(0) ? null : bytes.toString('utf8');
}
