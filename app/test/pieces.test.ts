// The plain helpers behind the shared pieces: how an error sentence is split
// into its cause and its way out, what a countdown shows, where a link that
// leaves the site goes and what it carries, and the path that draws a QR code.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import decodeQR from 'qr/decode.js';
import { fill } from '../src/lib/format.ts';
import { QUIET_ZONE, pathOfSquares, qrShape } from '../src/components/qr-path.ts';
import { OUTSIDE } from '../src/components/styles.ts';
import { siteHome, splitLead, timeLeft, timeLeftKey, withoutLastSentence } from '../src/components/text.ts';
import { DEFAULT_CONFIG } from '../src/lib/config.ts';
import { strings } from '../src/strings/index.ts';

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
