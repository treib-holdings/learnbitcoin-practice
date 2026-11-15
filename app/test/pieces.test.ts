// The plain helpers behind the shared pieces: how an error sentence is split
// into its cause and its way out, what a countdown shows, where a link that
// leaves the site goes and what it carries, which taps do not count, and the
// path that draws a QR code. And the rules the pieces' own markup keeps,
// read from their source: a browser is the place to see them, and
// e2e/scenarios and the gallery do that, but a rule that is written down
// here cannot be dropped by an edit that nobody looked at.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import decodeQR from 'qr/decode.js';
import { fill } from '../src/lib/format.ts';
import { QUIET_ZONE, pathOfSquares, qrShape } from '../src/components/qr-path.ts';
import { OUTSIDE } from '../src/components/styles.ts';
import { ANSWER_SETTLE_MS, answerCounts, isRepeatTap } from '../src/components/taps.ts';
import { siteHome, splitLead, timeLeft, timeLeftKey, withoutLastSentence } from '../src/components/text.ts';
import { DEFAULT_CONFIG } from '../src/lib/config.ts';
import * as keysTaps from '../src/screens/keys/taps.ts';
import { strings } from '../src/strings/index.ts';

/** A file of the app, as text. */
const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

/** The same without its comments, so that a rule about the code is not met by a sentence about it. */
const code = (path: string): string =>
  read(path)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** Every .svelte file under a folder of the app, with its code. */
function svelteFiles(folder: string): { name: string; text: string }[] {
  const root = new URL(`../src/${folder}/`, import.meta.url);
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.svelte'))
    .map((name) => ({ name: `${folder}/${name}`, text: code(`${folder}/${name}`) }));
}

// -- an error sentence: the cause, then the way out -------------------------------

test('splitLead: the first sentence is the cause, the rest is the way out', () => {
  assert.deepEqual(splitLead('The faucet is refilling. Try again in a minute.'), {
    lead: 'The faucet is refilling.',
    rest: 'Try again in a minute.',
  });
  assert.deepEqual(splitLead('One. Two. Three.'), { lead: 'One.', rest: 'Two. Three.' });
  // A full stop inside a sentence does not end it.
  assert.deepEqual(splitLead('The node relays from 0.1 sat/vB up. Raise the rate.'), {
    lead: 'The node relays from 0.1 sat/vB up.',
    rest: 'Raise the rate.',
  });
  // Spanish: an accented capital, or an inverted mark, starts a sentence too.
  assert.deepEqual(splitLead('No hubo respuesta. Él puede esperar.'), {
    lead: 'No hubo respuesta.',
    rest: 'Él puede esperar.',
  });
  assert.deepEqual(splitLead('No hubo respuesta. ¿Probar de nuevo?'), {
    lead: 'No hubo respuesta.',
    rest: '¿Probar de nuevo?',
  });
});

test('splitLead: one sentence, or none, comes back whole', () => {
  assert.deepEqual(splitLead('Only this.'), { lead: 'Only this.', rest: '' });
  assert.deepEqual(splitLead(''), { lead: '', rest: '' });
});

test('splitLead: every error sentence of the app splits in two, and nothing is lost', () => {
  for (const lang of LANGS) {
    for (const [key, text] of Object.entries(strings.errors[lang])) {
      const { lead, rest } = splitLead(text);
      assert.notEqual(rest, '', `${lang}.${key}`);
      assert.equal(`${lead} ${rest}`, text, `${lang}.${key}`);
      assert.ok(lead.endsWith('.'), `${lang}.${key}`);
    }
  }
});

test('withoutLastSentence: the last sentence goes, and a single sentence stays whole', () => {
  assert.equal(withoutLastSentence('One. Two. Three.'), 'One. Two.');
  assert.equal(withoutLastSentence('The faucet is refilling. Try again in a minute.'), 'The faucet is refilling.');
  assert.equal(withoutLastSentence('Only this.'), 'Only this.');
  assert.equal(withoutLastSentence(''), '');
  // A full stop inside a sentence does not end it.
  assert.equal(withoutLastSentence('The node relays from 0.1 sat/vB up. Raise the rate.'), 'The node relays from 0.1 sat/vB up.');
  // Spanish: an accented capital, or an inverted mark, starts a sentence too.
  assert.equal(withoutLastSentence('No hubo respuesta. Él puede esperar. ¿Probar de nuevo?'), 'No hubo respuesta. Él puede esperar.');
  // What is left is the start of the text, to the letter, and one sentence shorter.
  for (const lang of LANGS) {
    for (const [key, text] of Object.entries(strings.errors[lang])) {
      const kept = withoutLastSentence(text);
      assert.ok(text.startsWith(kept) && kept.length < text.length && kept.endsWith('.'), `${lang}.${key}`);
      assert.ok(kept.startsWith(splitLead(text).lead), `${lang}.${key}`);
    }
  }
});

// -- a countdown ------------------------------------------------------------------

test('timeLeft: seconds under a minute, rounded up', () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(timeLeft(now + 12_000, now), { unit: 'second', count: 12 });
  assert.deepEqual(timeLeft(now + 11_001, now), { unit: 'second', count: 12 });
  assert.deepEqual(timeLeft(now + 1, now), { unit: 'second', count: 1 });
  assert.deepEqual(timeLeft(now + 59_000, now), { unit: 'second', count: 59 });
});

test('timeLeft: minutes from one minute up, rounded up', () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(timeLeft(now + 60_000, now), { unit: 'minute', count: 1 });
  assert.deepEqual(timeLeft(now + 60_001, now), { unit: 'minute', count: 2 });
  assert.deepEqual(timeLeft(now + 180_000, now), { unit: 'minute', count: 3 });
});

test('timeLeft: at the time and after it, 0 seconds', () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(timeLeft(now, now), { unit: 'second', count: 0 });
  assert.deepEqual(timeLeft(now - 5_000, now), { unit: 'second', count: 0 });
});

test('timeLeftKey: one of something is singular, anything else plural, in both languages', () => {
  assert.equal(timeLeftKey({ unit: 'second', count: 1 }), 'timeSecond');
  assert.equal(timeLeftKey({ unit: 'second', count: 0 }), 'timeSeconds');
  assert.equal(timeLeftKey({ unit: 'second', count: 12 }), 'timeSeconds');
  assert.equal(timeLeftKey({ unit: 'minute', count: 1 }), 'timeMinute');
  assert.equal(timeLeftKey({ unit: 'minute', count: 3 }), 'timeMinutes');

  const say = (lang: 'en' | 'es', to: number): string => {
    const left = timeLeft(to, 0);
    return fill(strings.common[lang][timeLeftKey(left)], { count: String(left.count) });
  };
  assert.equal(say('en', 1_000), '1 second');
  assert.equal(say('en', 12_000), '12 seconds');
  assert.equal(say('en', 60_000), '1 minute');
  assert.equal(say('en', 90_000), '2 minutes');
  assert.equal(say('es', 1_000), '1 segundo');
  assert.equal(say('es', 12_000), '12 segundos');
  assert.equal(say('es', 60_000), '1 minuto');
  assert.equal(say('es', 90_000), '2 minutos');
});

// -- links that leave the site ----------------------------------------------------

test('a link that leaves the site opens a new tab and tells the other site nothing', () => {
  // "_blank", and not a tab's name: with noopener a browser never reuses a
  // named tab, so a name here would promise a shared tab that does not happen.
  assert.deepEqual(OUTSIDE, { target: '_blank', rel: 'noopener noreferrer' });
});

test("a Spanish page links to the main site's Spanish home page", () => {
  assert.equal(siteHome('https://www.learnbitcoin.com', 'en'), 'https://www.learnbitcoin.com');
  assert.equal(siteHome('https://www.learnbitcoin.com', 'es'), 'https://www.learnbitcoin.com/es');
  // The address the app is built with comes without a slash at its end, as the contract says.
  assert.doesNotMatch(DEFAULT_CONFIG.siteUrl, /\/$/);
  assert.equal(siteHome(DEFAULT_CONFIG.siteUrl, 'es'), `${DEFAULT_CONFIG.siteUrl}/es`);
});

test('a Spanish link to a page that exists in English only says so', () => {
  // The source code has no Spanish page. The main site's rule: the English
  // address, with "(en ingles)", accent and all, at the end of the link's text.
  assert.match(strings.common.es.linkSource, /\(en ingl\u00e9s\)$/);
  assert.equal(strings.common.en.linkSource, 'Source code');
});

test('a link that leaves the site: the hidden words keep their space, and the arrow stays with the last word', () => {
  const link = code('components/OutLink.svelte');
  // Svelte drops white space at the start of an element. Written as plain text, the space before
  // "(opens in a new tab)" was lost, and a screen reader ran the two together.
  assert.match(link, /<span class="sr-only">\{' '\}\{t\.opensNewTab\}<\/span>/);
  // With `text`: everything up to the last word, then the last word and the arrow as one piece that
  // does not break. So a line ends before that word or after the arrow, never between the two.
  assert.match(link, /let cut = \$derived\(text === undefined \? 0 : text\.lastIndexOf\(' '\) \+ 1\);/);
  assert.match(link, /\{text\.slice\(0, cut\)\}<span class="whitespace-nowrap">\{text\.slice\(cut\)\}\{@render arrow\(\)\}<\/span/);
  // The cut itself, on words as the screens hand them in.
  const parts = (text: string): [string, string] => {
    const cut = text.lastIndexOf(' ') + 1;
    return [text.slice(0, cut), text.slice(cut)];
  };
  assert.deepEqual(parts('Chapter 4 of the Journey'), ['Chapter 4 of the ', 'Journey']);
  assert.deepEqual(parts('LearnBitcoin.com'), ['', 'LearnBitcoin.com']);
  assert.deepEqual(parts('Código fuente (en inglés)'), ['Código fuente (en ', 'inglés)']);

  // Every such link in the app hands its words in as `text`. One does not, and may not: the
  // explorer's address on About, which is no run of words and has to break anywhere.
  const uses = [...svelteFiles('components'), ...svelteFiles('screens')].flatMap(({ name, text }) =>
    (text.match(/<OutLink\b[^>]*>/g) ?? []).map((tag) => ({ name, tag })),
  );
  assert.ok(uses.length >= 10, `${uses.length} links that leave the site`);
  const withoutText = uses.filter(({ tag }) => !/\btext=\{/.test(tag));
  assert.deepEqual(withoutText.map(({ name }) => name), ['screens/About.svelte']);
  assert.match(withoutText[0]!.tag, /href=\{wallet\.config\.explorerUrl\} class="break-all"/);
});

// -- boxes, cards and values --------------------------------------------------------

test('a notice breaks a word that is too long for it, and every card has the same room inside', () => {
  // errors.ts has a host name in a sentence, wider than a boxed sentence on the narrowest phone.
  const notice = code('components/Notice.svelte');
  const boxes = notice.slice(notice.indexOf('const BOX = {'), notice.indexOf('} as const;'));
  assert.equal(boxes.match(/\bbreak-words\b/g)?.length, 3, 'info, caution and problem');
  // Two cards one under the other start their text at one edge, whatever their tone.
  const card = code('components/Card.svelte');
  const looks = card.slice(card.indexOf('const BOX = {'), card.indexOf('} as const;'));
  assert.equal(looks.match(/\bp-5\b/g)?.length, 3, 'white, grey and dashed, on a phone');
  assert.equal(looks.match(/\bsm:p-6\b/g)?.length, 3, 'and from there up');
  assert.doesNotMatch(looks, /(^|\s)p-6\b/);
});

test('a value set in the monospace font breaks at a hyphen before it breaks inside a word', () => {
  // "break-all" cut a host name in the middle of a word ("...learnbitcoin.c" / "om") although it
  // has hyphens to break at. An address or a transaction ID has none, and still wraps anywhere.
  const mono = code('components/Mono.svelte');
  assert.doesNotMatch(mono, /\bbreak-all\b/);
  assert.equal(mono.match(/\[overflow-wrap:anywhere\]/g)?.length, 3, 'lead, plain and small');
});

test('a block of code that wraps is no stop for the Tab key, and one that scrolls is', () => {
  const block = code('components/CodeBlock.svelte');
  // A block that scrolls sideways takes focus, so that the arrow keys can scroll it, and has a name.
  // One that wraps never scrolls: focus there would be a Tab stop that does nothing.
  assert.match(block, /tabindex=\{wrap \? undefined : 0\}/);
  assert.match(block, /role=\{wrap \? undefined : 'region'\}/);
  assert.match(block, /aria-label=\{wrap \? undefined : label\}/);
  assert.match(block, /const SCROLLS = 'overflow-x-auto overscroll-x-contain';/);
  // Breaking as late as it can: "text-wrap" undoes the page's rule against a last line of one word.
  // And a word longer than the line (a path) is broken at the line's end: without that it stuck out
  // of the block and made the gallery's page 443 px wide on a 320 px screen.
  assert.match(block, /const WRAPS = 'whitespace-pre-wrap text-wrap \[overflow-wrap:anywhere\]';/);
  assert.match(block, /class=\{\[LOOK, wrap \? WRAPS : SCROLLS, !wrap && FOCUS, extra\]\}/);
  // The Sparrow guide's commands are typed by hand from a phone's screen: they wrap.
  assert.match(code('screens/info/CopyBlock.svelte'), /<CodeBlock \{text\} \{label\} \{wrap\} /);
});

test('a field has a place for what belongs to its error, inside what the control is described by', () => {
  const field = code('components/Field.svelte');
  // More than the one sentence (a second paragraph, a button, a link) goes in `after`. It is drawn
  // inside the element that carries the error's id, which the control names in aria-describedby:
  // a screen reader hears it with the error, and no caller wires an id by hand.
  assert.match(field, /after\?: Snippet;/);
  assert.match(
    field,
    /\{#if after\}\s*<div id="\{id\}-error" class="flex flex-col gap-2">\s*<p class=\{ERROR\}>\{error\}<\/p>\s*\{@render after\(\)\}\s*<\/div>/,
  );
  // Without it the error is the one paragraph it always was, under the same id.
  assert.match(field, /\{:else\}\s*<p id="\{id\}-error" class=\{ERROR\}>\{error\}<\/p>/);
  // And nothing of it is drawn while there is no error: both stand inside the error's own branch.
  const branch = /\{#if error !== ''\}([\s\S]*?)\n  \{\/if\}\n<\/div>/.exec(field)?.[1] ?? '';
  assert.match(branch, /\{@render after\(\)\}/);
  assert.equal(field.match(/\{@render after\(\)\}/g)?.length, 1);
});

test('the footer starts closer to the screen on a phone', () => {
  // A footer nearly as tall as a small phone's screen pushes the end of the screen's content up
  // under the PRACTICE banner when the page is scrolled to its end. Measured at 320 by 568 in
  // Spanish (a two-line banner): with 96 px above the footer the last button of Settings was 35 px
  // under the banner there, and with 48 px it stands clear of it.
  assert.match(code('components/Footer.svelte'), /<footer class="mt-12 border-t border-ink-100 bg-ink-50 md:mt-24">/);
});

test('the shell\'s table holds no text that nothing shows', () => {
  for (const lang of LANGS) {
    const table: Record<string, string> = strings.common[lang];
    // The placeholder's line went with the last placeholder, and Home's heading is the app's name.
    for (const key of ['notBuiltYet', 'screen_home']) assert.equal(table[key], undefined, `${lang}.${key}`);
    for (const key of ['screen_new', 'screen_restore', 'screen_tx']) assert.ok(table[key], `${lang}.${key}`);
  }
});

// -- taps that must not count -----------------------------------------------------------

test('isRepeatTap: the second click of a double tap, and any later one, by the count the browser gives', () => {
  assert.equal(isRepeatTap({ detail: 1 }), false);
  assert.equal(isRepeatTap({ detail: 0 }), false, 'a press from the keyboard');
  assert.equal(isRepeatTap({ detail: 2 }), true);
  assert.equal(isRepeatTap({ detail: 3 }), true);
});

test('answerCounts: a question that cannot be taken back takes no answer in its first moment, and never a double tap', () => {
  assert.equal(answerCounts(0, { detail: 1 }), false);
  assert.equal(answerCounts(ANSWER_SETTLE_MS - 1, { detail: 1 }), false);
  assert.equal(answerCounts(ANSWER_SETTLE_MS, { detail: 1 }), true);
  assert.equal(answerCounts(ANSWER_SETTLE_MS, { detail: 0 }), true, 'the keyboard, once the moment is over');
  assert.equal(answerCounts(60_000, { detail: 2 }), false, 'the second click of a double tap, however late');
  // Longer than a double tap (browsers count clicks up to about half a second apart), far shorter than reading.
  assert.ok(ANSWER_SETTLE_MS >= 500 && ANSWER_SETTLE_MS <= 1000, String(ANSWER_SETTLE_MS));
});

test('the Backup and Settings screens keep the app\'s tap rules, under their own names', () => {
  assert.equal(keysTaps.isRepeatTap, isRepeatTap);
  assert.equal(keysTaps.answerCounts, answerCounts);
  assert.equal(keysTaps.REMOVE_SETTLE_MS, ANSWER_SETTLE_MS);
});

// -- copying ------------------------------------------------------------------------

test('a refused copy is drawn where it happened, not only spoken', () => {
  // The status region is not drawn. A reader who sees the page and is told
  // nothing pastes whatever was copied before, an older address perhaps.
  const source = readFileSync(new URL('../src/components/CopyButton.svelte', import.meta.url), 'utf8');
  const markup = source.slice(source.indexOf('</script>'));
  assert.match(markup, /\{#if failed\}[^]*\{t\.copyFailed\}[^]*\{\/if\}/);
  // The sentence gives the cause and then the way out, in both languages.
  for (const lang of LANGS) assert.notEqual(splitLead(strings.common[lang].copyFailed).rest, '', lang);
  // Both of the button's words hold its width open, whichever one shows,
  // so the button beside it never slides under a finger.
  assert.match(markup, /data-own=\{label \?\? t\.copy\}/);
  assert.match(markup, /data-copied=\{t\.copied\}/);
  assert.match(source, /before:content-\[attr\(data-own\)\]/);
  assert.match(source, /after:content-\[attr\(data-copied\)\]/);
});

// -- a QR code --------------------------------------------------------------------

test('pathOfSquares: one rectangle for each run of dark squares in a row', () => {
  const T = true;
  const F = false;
  assert.equal(pathOfSquares([[F, F, F]]), '');
  assert.equal(pathOfSquares([[T]]), 'M0 0h1v1h-1z');
  assert.equal(
    pathOfSquares([
      [T, T, F, T],
      [F, F, F, F],
      [F, T, T, T],
    ]),
    'M0 0h2v1h-2zM3 0h1v1h-1zM1 2h3v1h-3z',
  );
});

/**
 * Paints a path made by pathOfSquares into an RGBA picture, `scale` pixels
 * to the square, dark on white: what a phone's camera would be shown.
 */
function paint(shape: { size: number; d: string }, scale: number): { width: number; height: number; data: Uint8Array } {
  const side = shape.size * scale;
  const data = new Uint8Array(side * side * 4).fill(255);
  const runs = [...shape.d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
  // The whole path is runs and nothing else.
  assert.equal(runs.map((run) => run[0]).join(''), shape.d);
  for (const [, x, y, run, back] of runs) {
    assert.equal(run, back);
    for (let py = Number(y) * scale; py < (Number(y) + 1) * scale; py++) {
      for (let px = Number(x) * scale; px < (Number(x) + Number(run)) * scale; px++) {
        data.fill(0, (py * side + px) * 4, (py * side + px) * 4 + 3);
      }
    }
  }
  return { width: side, height: side, data };
}

test('qrShape: the path, painted, reads back as the text', () => {
  const texts = [
    'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6',
    'bitcoin:BCRT1QP7TH3DVTKX9VRKTCRN5ERQ0DGJZGC4WJXZL8D6',
    'bcrt1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
  ];
  for (const text of texts) {
    const shape = qrShape(text);
    assert.equal(decodeQR(paint(shape, 6)), text);
    // Stays inside the square, on every side.
    assert.ok(shape.size >= 21 + 2 * QUIET_ZONE, 'the smallest code is 21 squares, plus the quiet zone');
    for (const [, x, y, run] of shape.d.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
      assert.ok(Number(x) >= QUIET_ZONE && Number(x) + Number(run) <= shape.size - QUIET_ZONE, text);
      assert.ok(Number(y) >= QUIET_ZONE && Number(y) < shape.size - QUIET_ZONE, text);
    }
  }
});

test('qrShape: nothing in the path but numbers and the letters of its four commands', () => {
  // It goes into the page as an attribute. No style, no script, no picture file.
  assert.match(qrShape('bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6').d, /^[Mhvz0-9 -]+$/);
});
