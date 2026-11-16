// The check the journeys make on what a page's regular expressions
// remember (scenarios/journey-helpers.ts, assertNoWordsRemembered): what it
// lets pass, and what it does not.
//
// A pattern that has matched keeps the text it ran on, and parts of it,
// where every script of the page can read them. The journeys look there at
// the moments that matter (the 12 words taken off the screen, a check of
// three words) and hold that none of the wallet's words is lying about.
//
// The check has to tell a word of the wallet from the same word in a text
// that is public. The words of a wallet are ordinary English words, and the
// wallets of the journeys are made at random: "practice" and "screen" are
// on the word list, and the page fills every screen's title from the
// template "Practice: {screen} | LearnBitcoin". A check that took that
// template for a leak failed a scenario for about one wallet in 85, with
// nothing wrong in the app. So this file runs the check on what the
// patterns really remember after the title is filled, for wallets that
// hold those very words, and on the things it must still refuse.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENGLISH_WORDS } from '@learnbitcoin/practice-wallet';
import { fill } from '../../app/src/lib/format.ts';
import { strings } from '../../app/src/strings/index.ts';
import { NOTHING_REMEMBERED, assertNoWordsRemembered, type PatternMemory } from '../scenarios/journey-helpers.ts';

/** What this process's patterns remember right now, read as the journeys read it in a page. */
function remembered(): PatternMemory {
  const memory = RegExp as unknown as Record<string, unknown>;
  return {
    input: String(memory['input']),
    lastMatch: String(memory['lastMatch']),
    lastParen: String(memory['lastParen']),
    leftContext: String(memory['leftContext']),
    rightContext: String(memory['rightContext']),
    groups: ['$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9'].map((name) => String(memory[name])).join(' '),
  };
}

/** What the patterns remember after the page has filled a screen's title, as components/Page.svelte does. */
function afterTitle(lang: 'en' | 'es', screen: string): { title: string; memory: PatternMemory } {
  const title = fill(strings.common[lang].markerTitle, { screen });
  return { title, memory: remembered() };
}

/** Twelve words with `word` among them, and no two of them next to each other in any text used here. */
const walletWith = (word: string): string[] => ['zoo', 'vivid', 'tattoo', 'quantum', word, 'nephew', 'kangaroo', 'jaguar', 'hybrid', 'gadget', 'fabric', 'eagle'];

/** What a Backup screen shows once the words are off it again: the filled title, a heading, a button. Never the template. */
const shownBy = (title: string): string => `${title} Backup Show the 12 words\n<html><head><title>${title}</title></head><body><h1>Backup</h1><button>Show the 12 words</button></body></html>`;

test('once a screen\'s title is filled, its template is what the patterns remember, and it is no word of the wallet\'s, whichever 12 words the wallet has', () => {
  // The fact the check rests on, taken here as the page takes it: fill() runs a pattern over the template.
  const { title, memory } = afterTitle('en', 'Backup');
  assert.equal(title, 'Practice: Backup | LearnBitcoin');
  assert.deepEqual(memory, {
    input: 'Practice: {screen} | LearnBitcoin',
    lastMatch: '{screen}',
    lastParen: 'screen',
    leftContext: 'Practice: ',
    rightContext: ' | LearnBitcoin',
    groups: 'screen        ',
  });
  assert.equal(memory.input, strings.common.en.markerTitle);
  const shown = shownBy(title);
  assert.ok(!shown.includes(memory.input), 'the page shows the title filled, never the template');
  // Both words of the template are words a wallet can have.
  for (const word of ['practice', 'screen']) assert.ok(ENGLISH_WORDS.includes(word), word);

  // A wallet with one of them, with both, and with neither: nothing of the wallet's is remembered.
  for (const words of [walletWith('practice'), walletWith('screen'), ['practice', ...walletWith('screen').slice(1)], walletWith('abandon')]) {
    assert.doesNotThrow(() => assertNoWordsRemembered(memory, words, shown, 'as the words are hidden'), words.join(' '));
  }
  // The same in Spanish, where the template keeps the slot's English name.
  const spanish = afterTitle('es', 'Respaldo');
  assert.equal(spanish.memory.input, strings.common.es.markerTitle);
  assert.doesNotThrow(() => assertNoWordsRemembered(spanish.memory, walletWith('screen'), shownBy(spanish.title), 'as the words are hidden'));
  // And with no page text at all to fall back on: the template is public by itself.
  assert.doesNotThrow(() => assertNoWordsRemembered(memory, walletWith('practice'), '', 'as the words are hidden'));
  // Nothing remembered is nothing to object to.
  assert.doesNotThrow(() => assertNoWordsRemembered(NOTHING_REMEMBERED, walletWith('practice'), '', 'at once'));
});

test('what the check still refuses: a word of the wallet in a text that is neither on the page nor the app\'s own, and two of the words in a row anywhere', () => {
  const { title } = afterTitle('en', 'Backup');
  const shown = shownBy(title);
  const words = walletWith('practice');
  const holding = (input: string, more: Partial<PatternMemory> = {}): PatternMemory => ({ ...NOTHING_REMEMBERED, input, ...more });
  const refuses = (memory: PatternMemory, why: RegExp, what: string): void => {
    assert.throws(() => assertNoWordsRemembered(memory, words, shown, 'then'), why, what);
  };

  // A word of the wallet alone, as a pattern would leave it that ran over a typed word.
  refuses(holding('practice'), /RegExp\.input holds "practice", with "practice" of the 12 words in it/, 'a word alone');
  refuses(holding('zoo'), /RegExp\.input holds "zoo"/, 'another word alone');
  // The template with a word of the wallet filled in: that is no text of the app's own any more.
  refuses(holding('Practice: zoo | LearnBitcoin'), /RegExp\.input holds "Practice: zoo \| LearnBitcoin", with "zoo", "practice" of the 12 words in it/, 'a filled template');
  // The app's own text as a part only, under a text that is not: what the pattern ran on decides.
  refuses(holding('typed: practice', { lastMatch: 'practice', leftContext: 'typed: ' }), /RegExp\.input holds "typed: practice"/, 'a part of another text');
  refuses(holding('nothing of the wallet here', { lastMatch: 'Practice: {screen} | LearnBitcoin vivid' }), /RegExp\.lastMatch holds/, 'a word beside the template, in a part');
  // A text of the app's own with something added to it is not that text.
  refuses(holding('Practice: {screen} | LearnBitcoin '), /RegExp\.input holds/, 'the template and a space');
  // Two of the 12 words in a row are refused wherever they stand: in a text of the page, and in a part of any text.
  const pair = `${words[0]} ${words[1]}`;
  assert.throws(() => assertNoWordsRemembered(holding(`${title} ${pair}`), words, `${shown} ${title} ${pair}`, 'then'), /RegExp\.input holds two of the 12 words in a row/);
  refuses(holding(strings.common.en.markerTitle, { rightContext: pair }), /RegExp\.rightContext holds two of the 12 words in a row/, 'two words in a row beside the app\'s own text');

  // A text of the app's own that is nothing but one of the wallet's words is not taken for the app's own.
  // The tables hold bare words too, and a word that stands alone could as well be the wallet's: so it passes
  // only as before, where the page shows it.
  for (const bare of ['change', 'fee', 'address']) {
    assert.ok((Object.values(strings.doit.en) as string[]).includes(bare) && ENGLISH_WORDS.includes(bare), bare);
    const has = walletWith(bare);
    assert.throws(() => assertNoWordsRemembered(holding(bare), has, shown, 'then'), new RegExp(`RegExp\\.input holds "${bare}", with "${bare}" of the 12 words in it`), bare);
    assert.doesNotThrow(() => assertNoWordsRemembered(holding(bare), has, `${shown} the ${bare} is shown here`, 'then'), bare);
    // A wallet without that word has nothing to object to.
    assert.doesNotThrow(() => assertNoWordsRemembered(holding(bare), walletWith('zebra'), shown, 'then'), bare);
  }
  // The same for a label that is such a word with a capital: "Lock" is a button of the wallet's screens.
  assert.equal(strings.common.en.lock, 'Lock');
  assert.throws(() => assertNoWordsRemembered(holding('Lock'), walletWith('lock'), shown, 'then'), /RegExp\.input holds "Lock", with "lock" of the 12 words in it/);
  // Inside a sentence of the app's own the word is the sentence's: that text is public as it stands.
  const sentence = strings.doit.en.explain_noChange;
  assert.match(sentence, /^No change came back\./);
  assert.doesNotThrow(() => assertNoWordsRemembered(holding(sentence, { lastMatch: 'change' }), walletWith('change'), shown, 'then'));

  // What it lets pass, as before: a sentence the page shows, with a word of the wallet in it.
  const locked = strings.wallet.en.noticeLocked;
  assert.equal(locked, 'Wallet locked.');
  assert.doesNotThrow(() => assertNoWordsRemembered(holding(locked, { lastMatch: 'locked' }), walletWith('wallet'), `${shown} ${locked}`, 'after Lock'));
  // The same sentence when the page does not show it is still the app's own, and public.
  assert.doesNotThrow(() => assertNoWordsRemembered(holding(locked), walletWith('wallet'), shown, 'after Lock'));
});
