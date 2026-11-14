// What the Backup screen decides (src/screens/keys/backup-flow.ts): which
// step shows, what "Show the 12 words" leads to, what follows each way an
// unlock can end, when words on screen must leave it and whether the screen
// then says why, and the address of chapter 4.
//
// These are tests of the plain helpers. They say nothing about whether
// Backup.svelte calls them as it should: that is what the browser scenarios
// are for (e2e/scenarios/keys.test.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import type { Unlocked } from '../src/components/wallet/unlock-flow.ts';
import { DEFAULT_CONFIG } from '../src/lib/config.ts';
import {
  CHAPTER_PATH,
  afterUnlock,
  backupView,
  chapterUrl,
  mustDropWords,
  showPlan,
  takenByAnotherTab,
  type BackupState,
  type BackupView,
} from '../src/screens/keys/backup-flow.ts';

const NOTHING: BackupState = { created: null, locked: false, shown: false, unlocking: false };

// -- which step shows -------------------------------------------------------------

test('backupView: straight after a create the words are on screen, and the step is "Wallet made"', () => {
  for (const created of ['passkey', 'words'] as const) {
    assert.equal(backupView({ ...NOTHING, created, shown: true }), 'made', created);
  }
});

test('backupView: at any other time the screen asks first, and shows the words only once it holds them', () => {
  assert.equal(backupView(NOTHING), 'ask');
  assert.equal(backupView({ ...NOTHING, shown: true }), 'shown');
  // A passkey wallet that is locked asks too: the unlock step comes only once the reader has asked.
  assert.equal(backupView({ ...NOTHING, locked: true }), 'ask');
});

test('backupView: a wallet that says it was just created and cannot show its words gets the plain screen', () => {
  // It was locked on the way here: no words, so no "Wallet made" step without them.
  assert.equal(backupView({ created: 'passkey', locked: true, shown: false, unlocking: false }), 'ask');
  assert.equal(backupView({ created: 'words', locked: false, shown: false, unlocking: false }), 'ask');
});

test('backupView: the unlock step is for a locked wallet whose words were asked for, and for nothing else', () => {
  assert.equal(backupView({ ...NOTHING, locked: true, unlocking: true }), 'unlock');
  // Not locked (a wallet made without a passkey, or one unlocked meanwhile): there is nothing to unlock.
  assert.equal(backupView({ ...NOTHING, locked: false, unlocking: true }), 'ask');
  // The words on screen always win.
  assert.equal(backupView({ ...NOTHING, locked: false, unlocking: true, shown: true }), 'shown');
});

test('backupView: every combination lands on one of the four steps, and "made" and "shown" always hold words', () => {
  const steps = new Set<BackupView>();
  for (const created of ['passkey', 'words', null] as const) {
    for (const locked of [true, false]) {
      for (const shown of [true, false]) {
        for (const unlocking of [true, false]) {
          const view = backupView({ created, locked, shown, unlocking });
          steps.add(view);
          assert.equal(view === 'made' || view === 'shown', shown, JSON.stringify({ created, locked, shown, unlocking }));
          if (view === 'made') assert.notEqual(created, null);
          if (view === 'unlock') assert.ok(locked && unlocking);
        }
      }
    }
  }
  assert.deepEqual([...steps].sort(), ['ask', 'made', 'shown', 'unlock']);
});

// -- asking for the words -----------------------------------------------------------

test('showPlan: a locked passkey wallet is unlocked first; any other wallet shows its words at once', () => {
  assert.equal(showPlan(true), 'unlock');
  assert.equal(showPlan(false), 'reveal');
});

test('afterUnlock: the words of this wallet are shown; after a switch to another wallet the screen asks again', () => {
  const answers: Record<Unlocked, 'reveal' | 'ask'> = { same: 'reveal', tampered: 'reveal', switched: 'ask' };
  for (const [how, next] of Object.entries(answers) as [Unlocked, 'reveal' | 'ask'][]) {
    assert.equal(afterUnlock(how), next, how);
  }
});

// -- when the words leave the screen ----------------------------------------------------

test('mustDropWords: nothing to drop while no words are on screen', () => {
  assert.equal(mustDropWords({ shownFor: null, wallet: 'tpubA', unlocked: true }), false);
  assert.equal(mustDropWords({ shownFor: null, wallet: null, unlocked: false }), false);
});

test('mustDropWords: the words stay while their wallet is here and unlocked', () => {
  assert.equal(mustDropWords({ shownFor: 'tpubA', wallet: 'tpubA', unlocked: true }), false);
});

test('mustDropWords: they go when the wallet is locked, replaced or removed', () => {
  // Lock: the keys are gone, and the words with them.
  assert.equal(mustDropWords({ shownFor: 'tpubA', wallet: 'tpubA', unlocked: false }), true);
  // Another tab put another wallet here. A wallet made without a passkey is "unlocked" too, so the key decides.
  assert.equal(mustDropWords({ shownFor: 'tpubA', wallet: 'tpubB', unlocked: true }), true);
  // Another tab removed the wallet.
  assert.equal(mustDropWords({ shownFor: 'tpubA', wallet: null, unlocked: false }), true);
  assert.equal(mustDropWords({ shownFor: 'tpubA', wallet: null, unlocked: true }), true);
});

test('takenByAnotherTab: the screen says why only when the wallet in this browser is no longer the words\' own', () => {
  // Nothing on screen: nothing was taken away.
  assert.equal(takenByAnotherTab({ shownFor: null, wallet: 'tpubB', unlocked: true }), false);
  // A lock is the reader's own doing: the words go, and the wallet frame says "locked".
  assert.equal(takenByAnotherTab({ shownFor: 'tpubA', wallet: 'tpubA', unlocked: false }), false);
  assert.equal(takenByAnotherTab({ shownFor: 'tpubA', wallet: 'tpubA', unlocked: true }), false);
  // Replaced or removed in another tab, whether the wallet now here is locked or not.
  assert.equal(takenByAnotherTab({ shownFor: 'tpubA', wallet: 'tpubB', unlocked: true }), true);
  assert.equal(takenByAnotherTab({ shownFor: 'tpubA', wallet: 'tpubB', unlocked: false }), true);
  assert.equal(takenByAnotherTab({ shownFor: 'tpubA', wallet: null, unlocked: false }), true);
  // Whenever it is true the words must go as well.
  for (const wallet of ['tpubA', 'tpubB', null]) {
    for (const unlocked of [true, false]) {
      const owner = { shownFor: 'tpubA', wallet, unlocked };
      if (takenByAnotherTab(owner)) assert.equal(mustDropWords(owner), true, JSON.stringify(owner));
    }
  }
});

// -- the helpers taken together, along the passkey paths ------------------------------------
//
// A model, not the screen: screen() below is written here, after the way
// Backup.svelte is meant to use the helpers, and it cannot fail when the
// screen itself is wired wrongly. What it shows is that the helpers fit
// together: followed in this order they never leave words on screen that
// should be gone, and never show a step out of turn.

/**
 * A model of the screen's state and the wallet's, moved along by the
 * helpers. Each method is one thing the reader or the wallet does.
 */
function screen(start: { kind: 'passkey' | 'words'; unlocked: boolean; created?: 'passkey' | 'words' }) {
  const wallet = { xpub: 'tpubA' as string | null, unlocked: start.unlocked, created: start.created ?? null };
  let shownFor: string | null = null;
  let unlocking = false;
  const locked = (): boolean => start.kind === 'passkey' && !wallet.unlocked;
  const take = (): void => {
    if (wallet.unlocked) shownFor = wallet.xpub;
  };
  /** What the screen is meant to do after every change. */
  const follow = (): void => {
    if (!mustDropWords({ shownFor, wallet: wallet.xpub, unlocked: wallet.unlocked })) return;
    shownFor = null;
    unlocking = false;
    wallet.created = null;
  };
  // Straight after a create the words are taken at once.
  if (wallet.created !== null) take();
  return {
    wallet,
    view: (): BackupView => backupView({ created: wallet.created, locked: locked(), shown: shownFor !== null, unlocking }),
    show(): void {
      if (showPlan(locked()) === 'unlock') unlocking = true;
      else take();
    },
    unlocked(how: Unlocked): void {
      wallet.unlocked = true;
      if (how === 'switched') wallet.xpub = 'tpubB';
      unlocking = false;
      if (afterUnlock(how) === 'reveal') take();
      follow();
    },
    hide(): void {
      shownFor = null;
    },
    lock(): void {
      wallet.unlocked = false;
      follow();
    },
    written(): void {
      shownFor = null;
      wallet.created = null;
    },
    shownFor: (): string | null => shownFor,
  };
}

test('the helpers together, a locked passkey wallet: ask, unlock, the words, hide, and the words again with no second unlock', () => {
  const s = screen({ kind: 'passkey', unlocked: false });
  assert.equal(s.view(), 'ask');
  s.show();
  assert.equal(s.view(), 'unlock');
  s.unlocked('same');
  assert.equal(s.view(), 'shown');
  s.hide();
  assert.equal(s.view(), 'ask');
  // The keys are still loaded: no unlock step this time.
  s.show();
  assert.equal(s.view(), 'shown');
});

test('the helpers together: a passkey wallet whose saved details were rebuilt at the unlock still shows its own words', () => {
  const s = screen({ kind: 'passkey', unlocked: false });
  s.show();
  s.unlocked('tampered');
  assert.equal(s.view(), 'shown');
  assert.equal(s.shownFor(), 'tpubA');
});

test('the helpers together: after a switch to another passkey\'s wallet nothing is shown until the reader asks again', () => {
  const s = screen({ kind: 'passkey', unlocked: false });
  s.show();
  s.unlocked('switched');
  assert.equal(s.view(), 'ask');
  assert.equal(s.shownFor(), null);
  // Asked again, the words are the new wallet's.
  s.show();
  assert.equal(s.view(), 'shown');
  assert.equal(s.shownFor(), 'tpubB');
});

test('the helpers together: a lock takes the words away at once, and the next ask goes through the unlock step', () => {
  const s = screen({ kind: 'passkey', unlocked: true });
  s.show();
  assert.equal(s.view(), 'shown');
  s.lock();
  assert.equal(s.view(), 'ask');
  assert.equal(s.shownFor(), null);
  s.show();
  assert.equal(s.view(), 'unlock');
});

test('the helpers together, "Wallet made" with a passkey: the words at once; "I have written them down" ends the step', () => {
  const s = screen({ kind: 'passkey', unlocked: true, created: 'passkey' });
  assert.equal(s.view(), 'made');
  assert.equal(s.shownFor(), 'tpubA');
  s.written();
  assert.equal(s.view(), 'ask');
  assert.equal(s.wallet.created, null);
});

test('the helpers together, "Wallet made" with a passkey: a lock ends the step too, and the words are gone with it', () => {
  const s = screen({ kind: 'passkey', unlocked: true, created: 'passkey' });
  s.lock();
  assert.equal(s.view(), 'ask');
  assert.equal(s.wallet.created, null, 'the step is over for good');
  // Unlocking again shows the words as at any other time, not as "Wallet made".
  s.show();
  s.unlocked('same');
  assert.equal(s.view(), 'shown');
});

test('the helpers together, "Wallet made" without a passkey: the words at once, and never an unlock step', () => {
  const s = screen({ kind: 'words', unlocked: true, created: 'words' });
  assert.equal(s.view(), 'made');
  s.written();
  s.show();
  assert.equal(s.view(), 'shown');
});

// -- the address of chapter 4 ----------------------------------------------------------------

test('chapterUrl: chapter 4 on the main site, in the page\'s language', () => {
  assert.equal(chapterUrl(DEFAULT_CONFIG.siteUrl, 'en'), 'https://www.learnbitcoin.com/journey/be-your-own-bank');
  assert.equal(chapterUrl(DEFAULT_CONFIG.siteUrl, 'es'), 'https://www.learnbitcoin.com/es/recorrido/se-tu-propio-banco');
  for (const lang of LANGS) {
    // The site's addresses carry no slash at their end, and the host is never written here.
    assert.ok(CHAPTER_PATH[lang].startsWith('/') && !CHAPTER_PATH[lang].endsWith('/'), lang);
    assert.doesNotMatch(CHAPTER_PATH[lang], /learnbitcoin|https?:/, lang);
    assert.equal(chapterUrl('http://localhost:1', lang), `http://localhost:1${CHAPTER_PATH[lang]}`);
  }
});
