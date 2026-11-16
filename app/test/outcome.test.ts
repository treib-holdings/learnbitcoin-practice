// What a screen that has just closed leaves for the screen that opens next
// (src/components/outcome.ts): "the wallet was removed" for Home, "the
// wallet was restored" for the Overview. Said on one screen, for one visit.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import { leaveOutcome, takeOutcome } from '../src/components/outcome.ts';
import { screenPutOnPage } from '../src/components/screen-count.ts';
import { strings } from '../src/strings/index.ts';

const source = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('an outcome is taken by the very next screen, once, and by no other', () => {
  // Nothing was left.
  assert.equal(takeOutcome('removed'), false);

  // Left, and the next screen takes it: once.
  leaveOutcome('removed');
  screenPutOnPage();
  assert.equal(takeOutcome('removed'), true);
  assert.equal(takeOutcome('removed'), false);

  // The screen that left it is still the one on the page: nothing to take yet, and asking uses it up.
  leaveOutcome('restored');
  assert.equal(takeOutcome('restored'), false);
  screenPutOnPage();
  assert.equal(takeOutcome('restored'), false);

  // The next screen asks for the other outcome: not its word, and gone all the same.
  leaveOutcome('removed');
  screenPutOnPage();
  assert.equal(takeOutcome('restored'), false);
  assert.equal(takeOutcome('removed'), false);

  // The reader went somewhere else first: the screen after that one is told nothing stale.
  leaveOutcome('removed');
  screenPutOnPage();
  screenPutOnPage();
  assert.equal(takeOutcome('removed'), false);

  // The last word left is the one that counts.
  leaveOutcome('removed');
  leaveOutcome('restored');
  screenPutOnPage();
  assert.equal(takeOutcome('restored'), true);
});

test('"Remove it" and a restore each leave their word, and the screen they lead to shows it and has it read out', () => {
  // The two screens that leave.
  const remove = source('screens/keys/RemoveWallet.svelte');
  assert.match(remove, /leaveOutcome\('removed'\);\s*navigate\(router\.link\(\{ name: 'home' \}\)\);/);
  const restore = source('screens/Restore.svelte');
  const moves = restore.match(/navigate\(router\.link\(\{ name: 'wallet' \}\), \{ replace: true \}\);/g) ?? [];
  const told = restore.match(/leaveOutcome\('restored'\);\s*navigate\(router\.link\(\{ name: 'wallet' \}\), \{ replace: true \}\);/g) ?? [];
  assert.deepEqual([moves.length, told.length], [2, 2], 'history found, and "Keep them here anyway"');

  // The two screens that open: a line on the page for that visit, and the same sentence through the
  // status region a moment after the screen is drawn (the region is emptied when the screen changes).
  const home = source('screens/Home.svelte');
  assert.match(home, /const removed = takeOutcome\('removed'\);/);
  assert.match(home, /if \(removed\) void tick\(\)\.then\(\(\) => announce\(t\.removed\)\);/);
  // Under it, while this browser keeps a note of the "Do it" steps: that the note is still here (it is not
  // removed with the wallet). Then the way to a new wallet, as before.
  assert.match(
    home,
    /\{#if removed && progressKept\(doit\.read\)\}[\s\S]*?<Notice kind="info" text=\{t\.removed\} data-testid="home-removed" \/>\s*<Notice kind="info" text=\{d\.staysAfterRemove\} data-testid="home-progress-stays">[\s\S]*?\{:else if removed\}\s*<Notice kind="info" text=\{t\.removed\} data-testid="home-removed" \/>\s*\{\/if\}\s*<div>\s*<Button variant="primary"[^>]*data-testid="home-create"/,
  );
  const overview = source('screens/Overview.svelte');
  assert.match(overview, /const restoredNow = takeOutcome\('restored'\);/);
  assert.match(overview, /if \(restored\) void tick\(\)\.then\(\(\) => announce\(t\.restoredHere\)\);/);
  assert.match(overview, /\{#if restored\}\s*<Notice kind="info" text=\{t\.restoredHere\} data-testid="overview-restored" \/>/);
  // The Overview's line says what this browser keeps, in the present tense: "This browser now keeps them."
  // So it is not drawn from the outcome alone, which is read once and never changes while the screen stays
  // on the page (and a page the browser brings back from its memory stays as it was). It follows the wallet:
  // the one that was here when the screen opened, by its public key, and still kept with its words.
  assert.match(overview, /const restoredXpub = wallet\.record\?\.xpub \?\? null;/);
  assert.match(
    overview,
    /let restored = \$derived\(restoredNow && wallet\.record\?\.kind === 'words' && wallet\.record\.xpub === restoredXpub\);/,
  );
  // Nothing else on the screen is drawn from the outcome itself.
  assert.equal(overview.match(/restoredNow/g)?.length, 2, 'taken once, and used once: in the rule above');

  // The sentences: a wallet is "removed" from this browser, never "deleted", and its coins stay where they are.
  assert.equal(strings.home.en.removed, 'The wallet was removed from this browser. Its coins stay on the practice network.');
  assert.equal(strings.home.es.removed, 'La billetera se quitó de este navegador. Sus monedas siguen en la red de práctica.');
  assert.equal(strings.wallet.en.restoredHere, 'This wallet was restored from its 12 words. This browser now keeps them.');
  assert.equal(strings.wallet.es.restoredHere, 'Esta billetera se restauró con sus 12 palabras. Este navegador ahora las guarda.');
  for (const lang of LANGS) {
    assert.doesNotMatch(strings.home[lang].removed, /delet|borr|elimin/i, lang);
  }
});
