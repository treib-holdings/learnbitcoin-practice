// The router's decisions: which clicks the app takes over and which it
// leaves to the browser, what a move does to the history, what Back and
// Forward mean, and the address of a screen in the other language.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGS, SCREENS } from '@learnbitcoin/practice-contract';
import {
  entryIndex,
  judgeClick,
  judgeMove,
  judgePop,
  pathInLang,
  type ClickFacts,
  type LinkFacts,
} from '../src/lib/navigation.ts';
import { parsePath, pathFor, type Route } from '../src/lib/router.ts';

const ORIGIN = 'https://practice.learnbitcoin.com';
const HERE = `${ORIGIN}/wallet`;
const TXID = '6c0443f5'.padEnd(64, 'a');

/** A plain single left click, with what a test changes laid over it. */
function click(changes: Partial<ClickFacts> = {}): ClickFacts {
  return { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, detail: 1, ...changes };
}

/** A plain link to `href`, with what a test changes laid over it. */
function link(href: string, changes: Partial<LinkFacts> = {}): LinkFacts {
  return { href: new URL(href, HERE).href, target: '', download: false, rel: '', ...changes };
}

// -- clicks -------------------------------------------------------------------

test('a plain left click on a link to a screen changes the screen', () => {
  assert.deepEqual(judgeClick(click(), link('/wallet/send'), HERE, false), {
    kind: 'go',
    to: `${ORIGIN}/wallet/send`,
  });
  // The other language, a transaction, and a path that is no screen: the app shows all of them itself.
  for (const path of ['/es/wallet', `/wallet/tx/${TXID}`, '/', '/es', '/nothing/here']) {
    assert.deepEqual(judgeClick(click(), link(path), HERE, false), { kind: 'go', to: ORIGIN + path }, path);
  }
  // A query string travels with the link.
  assert.deepEqual(judgeClick(click(), link('/wallet/send?step=2'), HERE, false), {
    kind: 'go',
    to: `${ORIGIN}/wallet/send?step=2`,
  });
});

test('a click with a key held down, or with another button, is left to the browser', () => {
  const to = link('/wallet/send');
  for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
    assert.deepEqual(judgeClick(click({ [key]: true }), to, HERE, false), { kind: 'leave' }, key);
  }
  // 1 is the middle button (a new tab), 2 the right one (the menu).
  for (const button of [1, 2]) {
    assert.deepEqual(judgeClick(click({ button }), to, HERE, false), { kind: 'leave' }, `button ${button}`);
  }
});

test('a click that something else already handled is left alone', () => {
  assert.deepEqual(judgeClick(click({ defaultPrevented: true }), link('/wallet/send'), HERE, false), { kind: 'leave' });
});

test('a click that is on no link is left alone', () => {
  assert.deepEqual(judgeClick(click(), null, HERE, false), { kind: 'leave' });
  // Also the second click of a double tap: a button's own handler decides about that one.
  assert.deepEqual(judgeClick(click({ detail: 2 }), null, HERE, false), { kind: 'leave' });
});

test('the second click of a double tap follows no link, whatever the link leads to', () => {
  // A double tap on a button that changes the screen: the first click changes it, and the second
  // lands on whatever the new screen has put there. Seen: "Remove it", then Home's "Restore".
  const drop = { kind: 'drop' };
  for (const detail of [2, 3, 7]) {
    // A screen of the app, in either language, and a transaction.
    for (const path of ['/restore', '/es/wallet', `/wallet/tx/${TXID}`, '/']) {
      assert.deepEqual(judgeClick(click({ detail }), link(path), HERE, false), drop, `${detail}: ${path}`);
    }
    // Another part of the screen that is showing.
    assert.deepEqual(judgeClick(click({ detail }), link('#main'), HERE, false), drop);
    // Links the router otherwise leaves to the browser: another site in a tab of its own, a file,
    // a fresh load. None of them is what the reader chose either.
    assert.deepEqual(judgeClick(click({ detail }), link('https://www.learnbitcoin.com/', { target: '_blank', rel: 'noopener noreferrer' }), HERE, false), drop);
    assert.deepEqual(judgeClick(click({ detail }), link('/logo.svg'), HERE, false), drop);
    assert.deepEqual(judgeClick(click({ detail }), link('/about', { rel: 'external' }), HERE, false), drop);
    // After the bot check, when every move loads a page: the same.
    assert.deepEqual(judgeClick(click({ detail }), link('/wallet/send'), HERE, true), drop);
    // With a key held down as well.
    assert.deepEqual(judgeClick(click({ detail, metaKey: true }), link('/wallet/send'), HERE, false), drop);
  }
  // A single click, and a press of Enter on a link (the browser says 0 for that), are followed as ever.
  assert.equal(judgeClick(click({ detail: 1 }), link('/restore'), HERE, false).kind, 'go');
  assert.equal(judgeClick(click({ detail: 0 }), link('/restore'), HERE, false).kind, 'go');
  // A click that the link's own handler has dealt with stays that handler's business.
  assert.deepEqual(judgeClick(click({ detail: 2, defaultPrevented: true }), link('/restore'), HERE, false), { kind: 'leave' });
});

test('a link that asks for another tab, a download or a fresh load is left to the browser', () => {
  const leave = { kind: 'leave' };
  assert.deepEqual(judgeClick(click(), link('/about', { target: '_blank' }), HERE, false), leave);
  assert.deepEqual(judgeClick(click(), link('/about', { target: 'lb-external' }), HERE, false), leave);
  assert.deepEqual(judgeClick(click(), link('/about', { download: true }), HERE, false), leave);
  assert.deepEqual(judgeClick(click(), link('/about', { rel: 'external' }), HERE, false), leave);
  assert.deepEqual(judgeClick(click(), link('/about', { rel: 'noopener External' }), HERE, false), leave);
  // target="_self" is this tab, which is where the app is. So is a rel that says something else.
  assert.equal(judgeClick(click(), link('/about', { target: '_self' }), HERE, false).kind, 'go');
  assert.equal(judgeClick(click(), link('/about', { rel: 'noopener noreferrer' }), HERE, false).kind, 'go');
});

test('a link to another site is left to the browser', () => {
  const leave = { kind: 'leave' };
  assert.deepEqual(judgeClick(click(), link('https://www.learnbitcoin.com/'), HERE, false), leave);
  // The same host on another port or scheme is another origin.
  assert.deepEqual(judgeClick(click(), link('http://practice.learnbitcoin.com/wallet'), HERE, false), leave);
  assert.deepEqual(judgeClick(click(), link('https://practice.learnbitcoin.com:8443/wallet'), HERE, false), leave);
  assert.deepEqual(judgeClick(click(), link('mailto:hello@example.com'), HERE, false), leave);
});

test('a link to a file or to the Worker is left to the browser', () => {
  for (const path of ['/logo.svg', '/robots.txt', '/assets/index-abc.js', '/api/config', '/p/event']) {
    assert.deepEqual(judgeClick(click(), link(path), HERE, false), { kind: 'leave' }, path);
  }
});

test('a link to another part of this screen moves there without a history entry', () => {
  assert.deepEqual(judgeClick(click(), link('/wallet#main'), HERE, false), { kind: 'part', id: 'main' });
  assert.deepEqual(judgeClick(click(), link('#main'), HERE, false), { kind: 'part', id: 'main' });
  // An escaped name is read back; one that cannot be read is left alone.
  assert.deepEqual(judgeClick(click(), link('#se%C3%B1al'), HERE, false), { kind: 'part', id: 'señal' });
  assert.deepEqual(judgeClick(click(), link('#%E0%A4%A'), HERE, false), { kind: 'leave' });
  // The same path with another query string is another screen state: a move.
  assert.equal(judgeClick(click(), link('/wallet?state=funded#main'), HERE, false).kind, 'go');
  // A part of another screen is a move to that screen.
  assert.deepEqual(judgeClick(click(), link('/about#stored'), HERE, false), {
    kind: 'go',
    to: `${ORIGIN}/about#stored`,
  });
});

test('once the bot check has loaded, links to screens are left to the browser, which loads the page', () => {
  assert.deepEqual(judgeClick(click(), link('/wallet/send'), HERE, true), { kind: 'leave' });
  assert.deepEqual(judgeClick(click(), link('/es/wallet'), HERE, true), { kind: 'leave' });
  // "Skip to content" is not a move between screens: it still works in the page.
  assert.deepEqual(judgeClick(click(), link('#main'), HERE, true), { kind: 'part', id: 'main' });
});

test('every screen of the app, in both languages, is taken over', () => {
  for (const lang of LANGS) {
    for (const name of SCREENS) {
      const route: Route = name === 'tx' ? { name, txid: TXID } : ({ name } as Route);
      const path = pathFor(route, lang);
      // Seen from About. Its own link is a "go" as well: navigate then finds there is nothing to do.
      const verdict = judgeClick(click(), link(path), `${ORIGIN}/about`, false);
      assert.deepEqual(verdict, { kind: 'go', to: ORIGIN + path }, path);
    }
  }
});

// -- moves --------------------------------------------------------------------

test('navigate: a screen of the app is a new history entry', () => {
  assert.deepEqual(judgeMove('/wallet/send', HERE, false, false), { kind: 'push', url: `${ORIGIN}/wallet/send` });
  assert.deepEqual(judgeMove(`${ORIGIN}/es/about`, HERE, false, false), { kind: 'push', url: `${ORIGIN}/es/about` });
  // A relative address is read against the page's own.
  assert.deepEqual(judgeMove('send', `${ORIGIN}/wallet/receive`, false, false), {
    kind: 'push',
    url: `${ORIGIN}/wallet/send`,
  });
});

test('navigate: with "replace" the current entry is swapped', () => {
  assert.deepEqual(judgeMove('/wallet/backup', HERE, true, false), { kind: 'replace', url: `${ORIGIN}/wallet/backup` });
  // Also for the address already showing: the screen is drawn again from the top.
  assert.deepEqual(judgeMove('/wallet', HERE, true, false), { kind: 'replace', url: `${ORIGIN}/wallet` });
});

test('navigate: the address already showing is no move', () => {
  assert.deepEqual(judgeMove('/wallet', HERE, false, false), { kind: 'stay' });
  assert.deepEqual(judgeMove('/wallet#main', HERE, false, false), { kind: 'stay' });
  assert.deepEqual(judgeMove('/wallet?state=funded', `${HERE}?state=funded`, false, false), { kind: 'stay' });
  // Another query string is a move.
  assert.equal(judgeMove('/wallet?state=none', `${HERE}?state=funded`, false, false).kind, 'push');
  // And it stays no move after the bot check: nothing is loaded again for it.
  assert.deepEqual(judgeMove('/wallet', HERE, false, true), { kind: 'stay' });
});

test('navigate: another site, a file and the Worker are loaded by the browser', () => {
  assert.deepEqual(judgeMove('https://www.learnbitcoin.com/', HERE, false, false), {
    kind: 'load',
    url: 'https://www.learnbitcoin.com/',
  });
  assert.deepEqual(judgeMove('/logo.svg', HERE, false, false), { kind: 'load', url: `${ORIGIN}/logo.svg` });
  assert.deepEqual(judgeMove('/api/config', HERE, false, false), { kind: 'load', url: `${ORIGIN}/api/config` });
  assert.deepEqual(judgeMove('https://www.learnbitcoin.com/', HERE, true, false), {
    kind: 'load-replace',
    url: 'https://www.learnbitcoin.com/',
  });
});

test('navigate: once the bot check has loaded, every move is a page load', () => {
  assert.deepEqual(judgeMove('/wallet/send', HERE, false, true), { kind: 'load', url: `${ORIGIN}/wallet/send` });
  assert.deepEqual(judgeMove('/wallet/send', HERE, true, true), { kind: 'load-replace', url: `${ORIGIN}/wallet/send` });
});

test('navigate: an address that cannot be read is no move', () => {
  assert.deepEqual(judgeMove('https://[', HERE, false, false), { kind: 'stay' });
});

// -- Back and Forward ---------------------------------------------------------

test('entryIndex: the place the router stored with a history entry, or null', () => {
  assert.equal(entryIndex({ index: 0 }), 0);
  assert.equal(entryIndex({ index: 7 }), 7);
  // An entry the browser made by itself for a "#part" has no state at all.
  assert.equal(entryIndex(null), null);
  assert.equal(entryIndex(undefined), null);
  // Anything that is not a whole number from 0 up is no place.
  for (const state of [{}, { index: '3' }, { index: -1 }, { index: 1.5 }, { index: Number.NaN }, 'index', 3]) {
    assert.equal(entryIndex(state), null, JSON.stringify(state));
  }
});

test('Back and Forward: another entry is shown, even when its address is the one already showing', () => {
  // Home, About, Home again, then two steps back: the same address, another entry.
  assert.deepEqual(judgePop(0, 2, true, false), { kind: 'show', index: 0 });
  // And forward again.
  assert.deepEqual(judgePop(2, 0, true, false), { kind: 'show', index: 2 });
  // The usual case: another address.
  assert.deepEqual(judgePop(1, 2, false, false), { kind: 'show', index: 1 });
});

test('Back and Forward: only the "#part" changed, so there is nothing to do', () => {
  // The browser followed a "#part" by itself: its entry has no place yet, and the screen is the same.
  assert.deepEqual(judgePop(null, 3, true, false), { kind: 'stay' });
  // The entry the router is already at.
  assert.deepEqual(judgePop(3, 3, true, false), { kind: 'stay' });
  // The same after the bot check: no page is loaded for a "#part".
  assert.deepEqual(judgePop(null, 3, true, true), { kind: 'stay' });
});

test('Back and Forward: an entry with no place in the count is shown all the same', () => {
  assert.deepEqual(judgePop(null, 3, false, false), { kind: 'show', index: null });
});

test('Back and Forward: once the bot check has loaded, they load a page', () => {
  assert.deepEqual(judgePop(1, 2, false, true), { kind: 'load' });
  assert.deepEqual(judgePop(null, 2, false, true), { kind: 'load' });
  // Also between two entries that have one address.
  assert.deepEqual(judgePop(0, 2, true, true), { kind: 'load' });
});

// -- languages ----------------------------------------------------------------

test('the language switch goes to the same screen in the other language', () => {
  for (const name of SCREENS) {
    if (name === 'not-found') continue;
    const route: Route = name === 'tx' ? { name, txid: TXID } : ({ name } as Route);
    const en = pathFor(route, 'en');
    const es = pathFor(route, 'es');
    assert.equal(pathInLang(en, 'es'), es, name);
    assert.equal(pathInLang(es, 'en'), en, name);
    // Asking for the language already showing changes nothing.
    assert.equal(pathInLang(en, 'en'), en, name);
    assert.equal(pathInLang(es, 'es'), es, name);
    // And the answer is the same screen.
    assert.deepEqual(parsePath(pathInLang(en, 'es')), { lang: 'es', route });
  }
  // A trailing slash is the same screen, and the answer is the tidy address.
  assert.equal(pathInLang('/wallet/', 'es'), '/es/wallet');
  assert.equal(pathInLang('/es/', 'en'), '/');
});

test('a path that is no screen keeps its text when the language changes', () => {
  assert.equal(pathInLang('/nothing/here', 'es'), '/es/nothing/here');
  assert.equal(pathInLang('/es/nothing/here', 'en'), '/nothing/here');
  assert.equal(pathInLang('/es/nothing/here', 'es'), '/es/nothing/here');
  assert.equal(pathInLang('/nothing/here', 'en'), '/nothing/here');
  // The paths kept for the guided steps of a later phase.
  assert.equal(pathInLang('/do/first-payment', 'es'), '/es/do/first-payment');
  assert.equal(pathInLang('/es/do/first-payment', 'en'), '/do/first-payment');
  // A path that only looks like Spanish is English.
  assert.equal(pathInLang('/essay', 'es'), '/es/essay');
  // Still not found, in the language asked for.
  assert.deepEqual(parsePath(pathInLang('/nothing/here', 'es')), { lang: 'es', route: { name: 'not-found' } });
  assert.deepEqual(parsePath(pathInLang('/es/nothing/here', 'en')), { lang: 'en', route: { name: 'not-found' } });
});

test('the language switch never leads off this site, whatever the address', () => {
  // What is left of "/es//example.org/claim" without its "/es" starts with
  // two slashes, and a browser reads a link that starts so as another site.
  assert.equal(pathInLang('/es//example.org/x', 'en'), '/example.org/x');
  assert.equal(pathInLang('/es//example.org/claim', 'en'), '/example.org/claim');
  assert.equal(pathInLang('/es///example.org/x', 'en'), '/example.org/x');
  // A slash and a backslash are read the same way.
  assert.equal(pathInLang('/es/\\example.org/x', 'en'), '/example.org/x');
  assert.equal(pathInLang('/es\\example.org/x', 'es'), '/es/es\\example.org/x');
  // From English to Spanish the prefix stands in front, and the rest is tidied the same way.
  assert.equal(pathInLang('//example.org/x', 'es'), '/es/example.org/x');
  assert.equal(pathInLang('//example.org/x', 'en'), '/example.org/x');
  // Nothing but slashes is Home.
  assert.equal(pathInLang('/es//', 'en'), '/');
  assert.equal(pathInLang('//', 'es'), '/es');
  // Whatever goes in, what comes out starts with exactly one slash.
  const odd = ['/es//a', '//a', '/es/\\a', '/\\a', '/es//', '///', '/es/%2F%2Fa', '', '/es', '/es/', '/nothing//here'];
  for (const path of odd) {
    for (const lang of LANGS) {
      const out = pathInLang(path, lang);
      assert.match(out, /^\/(?![/\\])/, `${path} -> ${lang}: ${out}`);
    }
  }
});
