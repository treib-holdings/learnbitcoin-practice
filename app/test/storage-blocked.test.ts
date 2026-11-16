// A browser that will not let the page read its storage.
//
// A reader gets there with one ordinary setting: they make or restore a
// wallet, and then tell the browser not to let sites save data. The browser
// then refuses the page every look at its storage, and deletes nothing: the
// wallet's record (with the 12 words, for a wallet kept with them) and the
// note of the "Do it" steps are still on the disk, and are back the moment
// the block is lifted.
//
// So a page that could not look has not seen that nothing is kept. It has
// seen nothing. The rule these tests hold, from the key store up to the
// sentences: "could not read" is never told as "nothing is there". Every
// screen says that it cannot tell, or says nothing.
//
//   - the engine and the steps, run together over one storage that is
//     switched off and on again: what each publishes, what About's line is
//     made of, and that nothing is written or removed meanwhile;
//   - what each screen decides in that state: the gate of a wallet screen,
//     Home, Create and Restore, the list of steps and a step, the strip,
//     the Sparrow guide;
//   - the sentences themselves, in both languages, and the markup that
//     draws them.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGS, STEPS } from '@learnbitcoin/practice-contract';
import { stripText, stripView } from '../src/components/doit/strip.ts';
import { judge, troubleOf, walletFacts, type World } from '../src/lib/doit/judge.ts';
import { PROGRESS_KEY, readProgress } from '../src/lib/doit/progress.ts';
import { makeRunner, type Shown } from '../src/lib/doit/runner.ts';
import { RECORD_KEY, loadRecord } from '../src/lib/keystore.ts';
import type { WalletStatus } from '../src/lib/wallet-api.ts';
import { canRestart, progressKept } from '../src/screens/doit/view.ts';
import { frontGate } from '../src/screens/front/flow.ts';
import { KEPT_KEYS, keptNow, keptNowLines, notKnown, noteNow, type KeptNow, type NoteNow } from '../src/screens/info/facts.ts';
import { walletNote } from '../src/screens/info/sparrow-guide.ts';
import { strings } from '../src/strings/index.ts';
import { record as sampleRecord } from './doit-worlds.ts';
import { SwitchedStorage, VirtualAuthenticator, test, testEngine, type TestEngine } from './engine-fakes.ts';

type Table = Readonly<Record<string, string>>;

/** A file of the app, as text, without its comments (which may name anything). */
function code(path: string): string {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** The steps over an engine's wallet and storage, made as lib/doit/doit.svelte.ts makes them. */
function stepsOf(t: TestEngine, storage: SwitchedStorage) {
  const wallet = (): World['wallet'] => {
    const session = t.session.view();
    const chain = t.chain.view();
    return walletFacts({
      status: session.status,
      record: session.record,
      unlocked: session.unlocked,
      chain: chain.chain,
      history: chain.history,
      historyError: chain.historyError,
      lastSent: chain.lastSent,
      wordsShown: session.wordsShown,
    });
  };
  let shown: Shown | null = null;
  const runner = makeRunner({
    local: storage as unknown as Storage,
    wallet,
    canStore: () => t.session.view().canStore,
    now: () => t.clock.now(),
    visible: () => true,
    count: () => {},
    publish: (next) => {
      shown = next;
    },
  });
  return {
    runner,
    wallet,
    shown: (): Shown => shown ?? runner.shown(),
    /** What About's "In this browser right now" is made of, as About.svelte works it out. */
    about(): { kept: KeptNow | null; note: NoteNow; text: string; also: string | null } {
      const view = t.session.view();
      const kept = keptNow(view.status, view.record);
      const note = noteNow(runner.shown().read);
      assert.ok(kept !== null);
      return { kept, note, ...keptNowLines(kept, note) };
    },
  };
}

// -- the engine and the steps, over a storage that is switched off and on again -------------------

for (const kind of ['words', 'passkey'] as const) {
  const which = kind === 'words' ? 'a wallet kept with its 12 words' : 'a wallet opened with a passkey';
  test(`${which}, and then the browser stops letting the page read its storage: nothing is told as missing, nothing is written, and it is all there when the block is lifted`, async () => {
    // 1. A browser that stores: a wallet is made, and a step's screen is opened.
    const storage = new SwitchedStorage();
    const auth = new VirtualAuthenticator();
    const first = testEngine({ storage: storage as unknown as Storage, auth });
    assert.deepEqual(await (kind === 'words' ? first.session.createWithWords() : first.session.createWithPasskey()), { kind: 'created' });
    await first.settle();
    const words = (first.session.revealWords() ?? []).join(' ');
    assert.equal(words.split(' ').length, 12);
    const made = stepsOf(first, storage);
    made.runner.watch({ name: 'step', id: 'the-seed' }, '');
    assert.deepEqual([...storage.map.keys()].sort(), [PROGRESS_KEY, RECORD_KEY].sort());
    assert.equal((storage.map.get(RECORD_KEY) ?? '').includes(words), kind === 'words', 'only a wallet kept with its words has them in storage');
    assert.deepEqual(made.about(), { kept: kind, note: 'kept', text: KEPT_KEYS[kind], also: 'noteAlsoNow' });
    const before = [...storage.map.entries()];
    const writes = storage.writes;

    // 2. The reader tells the browser to block this site's data, and loads the page again.
    storage.blocked = true;
    const t = testEngine({ storage: storage as unknown as Storage, auth });
    await t.settle();
    const steps = stepsOf(t, storage);
    steps.runner.watch({ name: 'about' }, '');

    // The wallet: not "none". The page has seen nothing.
    const view = t.session.view();
    assert.deepEqual([view.status, view.record, view.unlocked, view.canStore], ['blocked', null, false, false]);
    assert.equal(loadRecord(storage as unknown as Storage), 'blocked');
    // The note: not "none" either, and no progress is read out of it.
    assert.deepEqual([steps.shown().read, steps.shown().kept, steps.shown().progress], ['blocked', 'no', { v: 1, following: null, steps: {} }]);
    assert.equal(readProgress(storage as unknown as Storage).state, 'blocked');

    // About, "In this browser right now": that the page cannot tell, and nothing else.
    assert.deepEqual(steps.about(), { kept: 'blocked', note: 'blocked', text: 'keepNowBlocked', also: null });
    for (const lang of LANGS) {
      const said = strings.about[lang].keepNowBlocked;
      assert.doesNotMatch(said, /\bnothing\b|\bnada\b|no practice wallet|no tiene billetera|ninguna billetera/i, `${lang}: ${said}`);
    }

    // What every other screen decides in this state.
    assert.equal(frontGate(view.status, view.canStore, null), 'trouble', 'Create and Restore: the wallet\'s own piece, never their own content');
    assert.equal(walletNote(view.status), 'blocked', 'the Sparrow guide');
    assert.equal(troubleOf(view.status), 'unread', 'a step');
    assert.equal(progressKept(steps.shown().read), false, 'Settings, Remove and Home say nothing of a note they could not look for');
    // A step's screen, opened in this state: its open part is the wallet's own trouble, whichever step it is.
    for (const id of STEPS) {
      steps.runner.watch({ name: 'step', id }, '');
      const step = judge(id, { wallet: steps.wallet(), note: steps.shown().progress, kept: steps.shown().kept, now: t.clock.now() });
      assert.equal(step.at, 1, id);
      assert.deepEqual(step.parts[0], { state: 'blocked', reason: 'unread' }, id);
      assert.equal(canRestart(step, steps.shown().kept, view.status), false, id);
    }
    // No step is followed (none could be read), so no screen carries a strip.
    assert.equal(steps.shown().progress.following, null);
    // Every way to change what is stored answers, and changes nothing.
    assert.equal(steps.runner.forget(), false, '"Forget my progress" forgets nothing it cannot see');
    assert.equal(steps.runner.restart('the-seed'), false);
    assert.equal(steps.runner.answer('the-seed'), false);
    assert.equal(t.session.removeWallet(), 'gone');
    assert.deepEqual(await t.session.createWithWords(), { kind: 'no-storage' });
    assert.deepEqual(await t.session.restore(words), { kind: 'no-storage' });
    assert.deepEqual([...storage.map.entries()], before, 'what the browser holds is what it held');
    assert.equal(storage.writes, writes, 'and nothing was written or removed');
    assert.deepEqual(t.events, [], 'nothing is counted');

    // 3. The block is lifted, and the page is told that it is back in view: everything is there, as it was.
    storage.blocked = false;
    t.session.backInView();
    steps.runner.visible();
    await t.settle();
    assert.deepEqual([t.session.view().status, t.session.view().record?.kind], ['ready', kind]);
    assert.deepEqual([steps.shown().read, steps.shown().progress.steps['the-seed']?.started], ['kept', true]);
    assert.deepEqual(steps.about(), { kept: kind, note: 'kept', text: KEPT_KEYS[kind], also: 'noteAlsoNow' });
    assert.equal(storage.map.get(RECORD_KEY), new Map(before).get(RECORD_KEY), 'the record is the one that was stored');
    if (kind === 'words') assert.deepEqual(t.session.revealWords(), words.split(' '), 'with its 12 words');
  });
}

// -- About's line, for every pair of what the two readers can say ---------------------------------

test('About, "In this browser right now": whenever one of the two readers was refused, the line says that the page cannot tell, and nothing else', () => {
  const kinds = Object.keys(KEPT_KEYS) as KeptNow[];
  const notes: NoteNow[] = ['none', 'kept', 'unreadable', 'blocked'];
  assert.ok(kinds.includes('blocked'));
  for (const kept of kinds) {
    for (const note of notes) {
      const lines = keptNowLines(kept, note);
      const unread = kept === 'blocked' || note === 'blocked';
      assert.equal(notKnown(kept, note), unread, `${kept}, ${note}`);
      // The wallet's reader and the note's reader look at one and the same storage, each at its own moments.
      // A refusal to either means that what is kept is not known now, whatever the other last saw.
      if (unread) assert.deepEqual(lines, { text: 'keepNowBlocked', also: null }, `${kept}, ${note}`);
      else assert.notEqual(lines.text, 'keepNowBlocked', `${kept}, ${note}`);
      for (const lang of LANGS) {
        const table: Table = strings.about[lang];
        const said = [table[lines.text], lines.also === null ? '' : table[lines.also]].join(' ');
        // "Nothing" is said in one case only: the storage was read, and holds neither a wallet nor a note.
        assert.equal(/\bnothing\b|\bnada\b/i.test(said), kept === 'none' && note === 'none', `${lang}, ${kept}, ${note}: ${said}`);
        // "No practice wallet" only of a storage that was read.
        if (unread) assert.doesNotMatch(said, /no practice wallet|ninguna billetera|no tiene billetera/i, `${lang}, ${kept}, ${note}`);
      }
    }
  }
  // What the two readers' answers come to: "blocked" is never folded into "none".
  assert.equal(noteNow('blocked'), 'blocked');
  assert.equal(noteNow('none'), 'none');
  assert.equal(keptNow('blocked', null), 'blocked');
  assert.equal(keptNow('none', null), 'none');
  // The sentence, word for word. It says what happened when the page looked, so that it stays true until the
  // page looks again; and it says that what was stored before may still be here.
  assert.equal(
    strings.about.en.keepNowBlocked,
    'Not known. This browser did not let this page read what it may have stored here, so the page cannot tell what is kept. A wallet or a note stored here before may still be kept.',
  );
  assert.equal(
    strings.about.es.keepNowBlocked,
    'No se sabe. Este navegador no dejó que esta página leyera lo que pueda tener guardado aquí, así que la página no puede saber qué hay guardado. Una billetera o una nota guardadas aquí antes pueden seguir guardadas.',
  );
  // The screen draws it for either refusal, and marks the line so for whoever reads the page by program.
  const about = code('screens/About.svelte');
  assert.match(about, /let unread = \$derived\(kept !== null && notKnown\(kept, note\)\);/);
  assert.match(about, /data-kept=\{unread \? 'blocked' : kept\}/);
  assert.match(about, /data-note=\{unread \? 'blocked' : note === 'kept' \? 'yes' : note === 'unreadable' \? 'unreadable' : 'no'\}/);
});

// -- the sentences, and the screens that draw them ------------------------------------------------

test('a storage the page could not read: every screen says that it cannot tell, or says nothing, in both languages', () => {
  const { en, es } = strings.wallet;
  // The gate of a wallet screen, Home's panel, and the piece Create, Restore and a step show: one set of words.
  assert.equal(en.blockedTitle, 'This page cannot tell whether this browser has a practice wallet.');
  assert.equal(es.blockedTitle, 'Esta página no puede saber si este navegador tiene una billetera de práctica.');
  assert.equal(
    en.blockedBody,
    'This browser did not let this page read what it may have stored here. That happens when site data is blocked. If you made a practice wallet in this browser before, it may still be stored.',
  );
  assert.equal(
    es.blockedBody,
    'Este navegador no dejó que esta página leyera lo que pueda tener guardado aquí. Pasa cuando los datos de los sitios están bloqueados. Si antes creaste una billetera de práctica en este navegador, puede que siga guardada.',
  );
  assert.equal(en.blockedWay, 'Allow site data for this page, then reload.');
  assert.equal(es.blockedWay, 'Permite los datos del sitio para esta página y recarga.');
  // The list of steps and a step's screen.
  assert.equal(
    strings.doit.en.noRead,
    'This browser did not let this page read what it may have stored here, so the page cannot tell whether you have "Do it" progress in this browser, and cannot keep any. That happens when site data is blocked. Allow site data for this page, then reload.',
  );
  assert.equal(
    strings.doit.es.noRead,
    'Este navegador no dejó que esta página leyera lo que pueda tener guardado aquí, así que la página no puede saber si tienes progreso de "Hazlo" en este navegador, y tampoco puede guardarlo. Pasa cuando los datos del sitio están bloqueados. Permite los datos del sitio para esta página y recarga.',
  );

  // Every sentence written for this state, in each language: it says what the browser did in the past tense
  // (true until the page looks again), and never that a wallet, a note or progress is missing.
  const said: Record<(typeof LANGS)[number], string[]> = {
    en: [en.blockedTitle, en.blockedBody, en.blockedWay, strings.about.en.keepNowBlocked, strings.doit.en.noRead, strings.sparrow.en.needBlocked, strings.doit.en.stripNeed_unread],
    es: [es.blockedTitle, es.blockedBody, es.blockedWay, strings.about.es.keepNowBlocked, strings.doit.es.noRead, strings.sparrow.es.needBlocked, strings.doit.es.stripNeed_unread],
  };
  for (const text of said.en) {
    assert.doesNotMatch(text, /\bno practice wallet\b|\bhas none\b|\bthere is none\b|\bNothing\b|\bNot started\b|\bno progress\b|\bno wallet\b/i, text);
    assert.doesNotMatch(text, /does not let|will not let|refuses to/, `present tense: ${text}`);
  }
  for (const text of said.es) {
    assert.doesNotMatch(text, /no tiene (ninguna )?billetera|no hay ninguna|\bNada\b|Sin empezar|ninguna billetera/i, text);
    assert.doesNotMatch(text, /no deja que|se niega a/, `present tense: ${text}`);
  }
  for (const key of ['blockedBody'] as const) {
    assert.match(en[key], /^This browser did not let this page read what it may have stored here\./);
    assert.match(es[key], /^Este navegador no dejó que esta página leyera lo que pueda tener guardado aquí\./);
    // The thing a reader of this state most needs to hear: blocking deleted nothing.
    assert.match(en[key], /it may still be stored\.$/);
    assert.match(es[key], /puede que siga guardada\.$/);
  }

  // -- the pieces --
  // The wallet's own piece draws the two sentences and Reload for "blocked", and offers no Remove there:
  // nothing is removed unseen.
  const piece = code('components/wallet/StoredTrouble.svelte');
  assert.match(piece, /status === 'blocked'\s*\?\s*t\.blockedTitle/);
  const markup = piece.slice(piece.indexOf('</script>'));
  const blocked = markup.slice(markup.indexOf("{:else if status === 'blocked'}"), markup.indexOf('{/if}', markup.indexOf("{:else if status === 'blocked'}")));
  assert.match(blocked, /<p>\{t\.blockedBody\}<\/p>\s*<p>\{t\.blockedWay\}<\/p>\s*<\/div>\s*<div><ReloadButton variant="primary" \/><\/div>/);
  assert.doesNotMatch(blocked, /remove-wallet|unreadableRemove/);
  assert.match(markup, /\{#if status === 'unreadable' \|\| status === 'newer' \|\| status === 'broken' \|\| status === 'blocked'\}/);

  // The gate of a wallet screen: its own heading for "blocked". The heading "This browser has no practice
  // wallet." and the three ways in stand only where the status is "none".
  const gate = code('components/wallet/WalletGate.svelte');
  assert.match(gate, /\{:else if gate === 'blocked'\}\s*<Page title=\{t\.blockedTitle\} titleName=\{t\.blockedName\}>\s*<StoredTrouble \/>\s*<\/Page>/);
  assert.match(gate, /\{:else if gate === 'none'\}\s*<Page title=\{t\.gateNoneTitle\} titleName=\{t\.gateNoneName\}>\s*<NoWallet \/>\s*<\/Page>/);
  assert.equal(gate.match(/gateNoneTitle/g)?.length, 1);
  assert.equal(gate.match(/<NoWallet \/>/g)?.length, 1);

  // Home: the ways in ("This browser has none right now...") only for "none"; the wallet's own piece for "blocked".
  const home = code('screens/Home.svelte');
  const none = home.slice(home.indexOf("{:else if status === 'none'}"), home.indexOf("{:else if status === 'unreadable'"));
  for (const hook of ['home-create', 'home-have', 'home-restore']) {
    assert.ok(none.includes(`data-testid="${hook}"`), hook);
    assert.equal(home.split(`data-testid="${hook}"`).length, 2, `${hook} is drawn in one place`);
  }
  assert.match(home, /\{:else if status === 'unreadable' \|\| status === 'newer' \|\| status === 'broken' \|\| status === 'blocked'\}\s*<StoredTrouble titled \/>/);

  // The list of steps and a step's screen: the notice, in front of "this browser refuses to store".
  const notice = code('screens/doit/ProgressNotice.svelte');
  assert.match(
    notice,
    /\{#if doit\.kept === 'newer'\}[\s\S]*?\{:else if doit\.read === 'blocked'\}\s*<Notice kind="problem" silent text=\{t\.noRead\} data-testid="do-no-read">\s*<ReloadButton \/>\s*<\/Notice>\s*\{:else if doit\.kept === 'no'\}/,
  );
  // And the list shows no state for any step: "Not started" would be said of a note nobody could look for.
  const list = code('screens/Do.svelte');
  assert.match(list, /let stated = \$derived\(doit\.kept !== 'newer' && doit\.read !== 'blocked'\);/);
  assert.match(list, /\{#if stated\}\s*<span class="text-sm">\s*<span[\s\S]*?data-testid="do-state"/);
  assert.equal(list.match(/data-testid="do-state"/g)?.length, 1, 'a step\'s state is drawn in one place, under that condition');
  assert.match(list, /let canForget = \$derived\(stated && /);

  // A step: the wallet's own piece for the wallet's own trouble, never the sentence "there is none".
  const part = code('screens/doit/OpenPart.svelte');
  assert.match(part, /\{#if isWalletTrouble\(view\.reason\)\}\s*<StoredTrouble titled \/>/);
  assert.match(part, /let need = \$derived\(view\.state === 'blocked' && !isWalletTrouble\(view\.reason\) \? needOf\(/);

  // The strip, should a step be followed while the wallet's reader was refused: neither "first: a practice
  // wallet" nor "the stored wallet".
  for (const id of STEPS) {
    const strip = stripView(judge(id, {
      wallet: { status: 'blocked', record: null, unlocked: false, chain: { state: null, scanning: false, error: null, checkedAt: null, retryAt: null, tip: null, slow: false }, history: null, historyError: null },
      note: { v: 1, following: id, followedAt: 0, steps: { [id]: { started: true } } },
      kept: 'yes',
      now: 0,
    }));
    assert.deepEqual(strip.says, { kind: 'need', reason: 'unread' }, id);
    assert.equal(stripText(strip, 'en', 0), 'this page could not look for a wallet here');
    assert.equal(stripText(strip, 'es', 0), 'esta página no pudo buscar una billetera aquí');
  }
});

test('"none" means that the storage was read and holds no wallet: no other status lets a screen say so', () => {
  // Written as an object, so that the compiler refuses a status that is missing here.
  const all: Record<WalletStatus, true> = { none: true, ready: true, unreadable: true, newer: true, broken: true, blocked: true };
  for (const status of Object.keys(all) as WalletStatus[]) {
    // About's "Nothing. This browser has no practice wallet."
    assert.equal(keptNow(status, null) === 'none', status === 'none', status);
    // The Sparrow guide's "This browser has no practice wallet yet".
    assert.equal(walletNote(status) === 'none', status === 'none', status);
    // Create and Restore open their own content.
    assert.equal(frontGate(status, true, null) === 'open', status === 'none', status);
    // A step's "This part needs a practice wallet in this browser, and there is none." (A wallet that is
    // here comes with its record: the wallet publishes one exactly when its status is "ready".)
    const held = status === 'ready' ? sampleRecord() : null;
    const seen = { wallet: { status, record: held, unlocked: false, chain: { state: null, scanning: false, error: null, checkedAt: null, retryAt: null, tip: null, slow: false }, history: null, historyError: null }, note: { v: 1 as const, following: null, steps: { 'pass-it-on': { started: true as const } } }, kept: 'yes' as const, now: 0 };
    const open = judge('pass-it-on', seen).parts[0];
    assert.equal(open?.state === 'blocked' && open.reason === 'no-wallet', status === 'none', status);
  }
  // The sentences that say "none", each drawn for that status alone.
  assert.equal(strings.about.en.keepNowNone, 'Nothing. This browser has no practice wallet.');
  assert.equal(strings.wallet.en.gateNoneTitle, 'This browser has no practice wallet.');
  assert.match(strings.home.en.haveWhy, /^This browser has none right now\./);
  assert.match(strings.doit.en['need_no-wallet'], /and there is none\.$/);
  // The engine gives that status only for a storage it has read (test/session.test.ts and test/keystore.test.ts
  // hold the other half: a storage that cannot be read is "blocked").
  const session = code('lib/session.ts');
  assert.match(session, /function read\(\): WalletRecord \| null \| 'unreadable' \| 'newer' \| 'blocked' \{\s*try \{\s*return loadRecord\(local\);\s*\} catch \{\s*return 'blocked';\s*\}\s*\}/);
  assert.match(code('lib/keystore.ts'), /const text = storedText\(local\);\s*if \(text === undefined\) return 'blocked';\s*if \(text === null\) return null;/);
});
