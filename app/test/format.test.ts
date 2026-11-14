// Amounts, dates, elapsed time, short IDs and filled-in text, in both languages.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import { fill, formatDate, formatElapsed, formatSats, parseSats, shortId, slotNames } from '../src/lib/format.ts';

/** English text is plain ASCII. Spanish adds only its accented letters and inverted marks. */
const ASCII = /^[\x20-\x7e]*$/;
const SPANISH = /^[\x20-\x7eáéíóúüñÁÉÍÓÚÜÑ¿¡]*$/;

// -- formatSats -----------------------------------------------------------------

test('formatSats groups thousands with commas', () => {
  const cases: [bigint, string][] = [
    [0n, '0'],
    [1n, '1'],
    [12n, '12'],
    [999n, '999'],
    [1000n, '1,000'],
    [1234n, '1,234'],
    [12345n, '12,345'],
    [100000n, '100,000'],
    [999999n, '999,999'],
    [1000000n, '1,000,000'],
    [100000000n, '100,000,000'],
    // Every bitcoin there will ever be, in sats.
    [2100000000000000n, '2,100,000,000,000,000'],
    // Larger than a number can hold exactly.
    [123456789012345678901234567890n, '123,456,789,012,345,678,901,234,567,890'],
  ];
  for (const [sats, text] of cases) {
    assert.equal(formatSats(sats), text);
    if (sats <= BigInt(Number.MAX_SAFE_INTEGER)) assert.equal(formatSats(Number(sats)), text);
  }
});

test('formatSats: an amount below zero keeps its sign, with a plain hyphen', () => {
  assert.equal(formatSats(-1n), '-1');
  assert.equal(formatSats(-999n), '-999');
  assert.equal(formatSats(-1000n), '-1,000');
  assert.equal(formatSats(-100000), '-100,000');
  assert.equal(formatSats(-0), '0');
});

test('formatSats refuses a fraction: sats are whole', () => {
  for (const bad of [0.5, 1.5, 100000.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => formatSats(bad), RangeError, String(bad));
  }
});

// -- parseSats ------------------------------------------------------------------

test('parseSats reads digits, with or without thousands commas', () => {
  const cases: [string, bigint][] = [
    ['0', 0n],
    ['1', 1n],
    ['294', 294n],
    ['1000', 1000n],
    ['1,000', 1000n],
    ['100000', 100000n],
    ['100,000', 100000n],
    ['12,345', 12345n],
    ['1,234,567', 1234567n],
    ['2,100,000,000,000,000', 2100000000000000n],
    ['123456789012345678901234567890', 123456789012345678901234567890n],
    // Leading zeros change nothing.
    ['007', 7n],
    ['000', 0n],
    // Space around the amount is not part of it.
    ['  20000 ', 20000n],
    ['\t20,000\n', 20000n],
  ];
  for (const [input, sats] of cases) assert.equal(parseSats(input), sats, JSON.stringify(input));
});

test('parseSats and formatSats agree', () => {
  for (const sats of [0n, 7n, 999n, 1000n, 54321n, 100000n, 2100000000000000n]) {
    assert.equal(parseSats(formatSats(sats)), sats);
    assert.equal(parseSats(sats.toString()), sats);
  }
});

test('parseSats: nothing typed is "empty"', () => {
  for (const input of ['', ' ', '   ', '\t', '\n']) assert.equal(parseSats(input), 'empty', JSON.stringify(input));
});

test('parseSats: any period is "period", so the screen can say why', () => {
  for (const input of ['1.5', '0.001', '100.000', '1,000.00', '.5', '5.', '.', '1.000.000', 'abc.', ' 2.5 ', '1,0.0']) {
    assert.equal(parseSats(input), 'period', JSON.stringify(input));
  }
});

test('parseSats: everything else is "invalid"', () => {
  const invalid = [
    // Commas that are not thousands separators.
    ',',
    '1,',
    ',1',
    ',000',
    '1,0',
    '1,00',
    '10,00',
    '1,0000',
    '1000,000',
    '1,,000',
    '1,000,',
    '1,000,00',
    '12,34,567',
    '0,100',
    '00,100',
    '01,000',
    // Signs, letters, units, other separators.
    '-5',
    '+5',
    '5 sats',
    'abc',
    '1e3',
    '0x10',
    '1 000',
    '1_000',
    "1'000",
    // A no-break space between the thousands.
    `1${String.fromCodePoint(0xa0)}000`,
    // Digits that are not 0 to 9: Arabic-Indic, full-width, and the one-half sign.
    String.fromCodePoint(0x661, 0x662, 0x663),
    String.fromCodePoint(0xff11, 0xff12, 0xff13),
    String.fromCodePoint(0xbd),
  ];
  for (const input of invalid) assert.equal(parseSats(input), 'invalid', JSON.stringify(input));
});

// -- formatDate -----------------------------------------------------------------

/** Unix seconds for noon UTC on a day. */
function noonUtc(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day, 12) / 1000;
}

test('formatDate: the two house formats', () => {
  const at = noonUtc(2026, 11, 13);
  assert.equal(formatDate(at, 'en', 'utc'), 'November 13, 2026');
  assert.equal(formatDate(at, 'es', 'utc'), '13 de noviembre de 2026');
  // No leading zero on the day, in either language.
  assert.equal(formatDate(noonUtc(2026, 5, 5), 'en', 'utc'), 'May 5, 2026');
  assert.equal(formatDate(noonUtc(2026, 5, 5), 'es', 'utc'), '5 de mayo de 2026');
  // The first block of Bitcoin's chain: January 3, 2009, 18:15:05 UTC.
  assert.equal(formatDate(1231006505, 'en', 'utc'), 'January 3, 2009');
  assert.equal(formatDate(1231006505, 'es', 'utc'), '3 de enero de 2009');
  assert.equal(formatDate(0, 'en', 'utc'), 'January 1, 1970');
});

test('formatDate: every month, in both languages', () => {
  const months: [en: string, es: string][] = [
    ['January', 'enero'],
    ['February', 'febrero'],
    ['March', 'marzo'],
    ['April', 'abril'],
    ['May', 'mayo'],
    ['June', 'junio'],
    ['July', 'julio'],
    ['August', 'agosto'],
    ['September', 'septiembre'],
    ['October', 'octubre'],
    ['November', 'noviembre'],
    ['December', 'diciembre'],
  ];
  months.forEach(([en, es], index) => {
    const at = noonUtc(2027, index + 1, 28);
    assert.equal(formatDate(at, 'en', 'utc'), `${en} 28, 2027`);
    assert.equal(formatDate(at, 'es', 'utc'), `28 de ${es} de 2027`);
  });
});

test('formatDate: the day changes at midnight UTC when asked for UTC', () => {
  const lastSecond = Date.UTC(2026, 11, 31, 23, 59, 59) / 1000;
  assert.equal(formatDate(lastSecond, 'en', 'utc'), 'December 31, 2026');
  assert.equal(formatDate(lastSecond + 1, 'en', 'utc'), 'January 1, 2027');
  assert.equal(formatDate(lastSecond + 1, 'es', 'utc'), '1 de enero de 2027');
  // A leap day.
  assert.equal(formatDate(noonUtc(2028, 2, 29), 'en', 'utc'), 'February 29, 2028');
});

test('formatDate: by default the day is the one on the reader own calendar', () => {
  // Noon on the device's own clock is the same calendar day in every time zone.
  const localNoon = new Date(2026, 10, 13, 12, 0, 0).getTime() / 1000;
  assert.equal(formatDate(localNoon, 'en'), 'November 13, 2026');
  assert.equal(formatDate(localNoon, 'es'), '13 de noviembre de 2026');
  assert.equal(formatDate(localNoon, 'en', 'local'), 'November 13, 2026');
  // One minute before and after the device's own midnight are different days.
  const midnight = new Date(2026, 10, 14, 0, 0, 0).getTime() / 1000;
  assert.equal(formatDate(midnight - 60, 'en'), 'November 13, 2026');
  assert.equal(formatDate(midnight + 60, 'en'), 'November 14, 2026');
});

test('formatDate refuses a time that is not a number', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e20]) {
    assert.throws(() => formatDate(bad, 'en'), RangeError, String(bad));
    assert.throws(() => formatDate(bad, 'es', 'utc'), RangeError, String(bad));
  }
});

// -- formatElapsed ----------------------------------------------------------------

test('formatElapsed: the largest unit that fits, rounded down', () => {
  const cases: [seconds: number, en: string, es: string][] = [
    [1, '1 second ago', 'hace 1 segundo'],
    [2, '2 seconds ago', 'hace 2 segundos'],
    [30, '30 seconds ago', 'hace 30 segundos'],
    [59, '59 seconds ago', 'hace 59 segundos'],
    [59.9, '59 seconds ago', 'hace 59 segundos'],
    [60, '1 minute ago', 'hace 1 minuto'],
    [119, '1 minute ago', 'hace 1 minuto'],
    [120, '2 minutes ago', 'hace 2 minutos'],
    [180, '3 minutes ago', 'hace 3 minutos'],
    [3599, '59 minutes ago', 'hace 59 minutos'],
    [3600, '1 hour ago', 'hace 1 hora'],
    [7199, '1 hour ago', 'hace 1 hora'],
    [7200, '2 hours ago', 'hace 2 horas'],
    [86399, '23 hours ago', 'hace 23 horas'],
    [86400, '1 day ago', 'hace 1 día'],
    [172799, '1 day ago', 'hace 1 día'],
    [172800, '2 days ago', 'hace 2 días'],
    [86400 * 365, '365 days ago', 'hace 365 días'],
    [86400 * 1500, '1,500 days ago', 'hace 1,500 días'],
  ];
  for (const [seconds, en, es] of cases) {
    assert.equal(formatElapsed(seconds, 'en'), en, String(seconds));
    assert.equal(formatElapsed(seconds, 'es'), es, String(seconds));
  }
});

test('formatElapsed: under a second, and a time slightly ahead, is "just now"', () => {
  for (const seconds of [0, 0.4, 0.999, -0, -1, -30, -86400]) {
    assert.equal(formatElapsed(seconds, 'en'), 'just now', String(seconds));
    assert.equal(formatElapsed(seconds, 'es'), 'hace un momento', String(seconds));
  }
});

test('formatElapsed refuses a number that is not finite', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => formatElapsed(bad, 'en'), RangeError, String(bad));
  }
});

test('everything the formatters write keeps to the character rule', () => {
  const dates = Array.from({ length: 12 }, (_, month) => noonUtc(2026, month + 1, 9));
  const spans = [0, 1, 5, 60, 300, 3600, 7200, 86400, 259200];
  for (const lang of LANGS) {
    const texts = [
      ...dates.map((at) => formatDate(at, lang, 'utc')),
      ...spans.map((seconds) => formatElapsed(seconds, lang)),
    ];
    for (const text of texts) {
      assert.match(text, lang === 'en' ? ASCII : SPANISH, text);
      assert.equal(text, text.normalize('NFC'));
      assert.ok(!text.includes('!') && !text.includes('¡'), text);
    }
  }
  // Numbers and IDs are the same plain characters in both languages.
  assert.match(formatSats(-1234567n), /^[-0-9,]+$/);
});

// -- shortId ----------------------------------------------------------------------

test('shortId keeps the two ends of a long ID', () => {
  const txid = '6c0443f5b1a2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829564c1d';
  assert.equal(txid.length, 64);
  assert.equal(shortId(txid), '6c0443f5...564c1d');
  assert.equal(shortId('0123456789abcdef01'), '01234567...cdef01');
});

test('shortId leaves alone what it could not make shorter', () => {
  for (const id of ['', 'abc', '0123456789abcdef', '0123456789abcdef0']) assert.equal(shortId(id), id);
});

// -- fill and slotNames -------------------------------------------------------------

test('fill puts values into slots', () => {
  assert.equal(fill('{count} coins', { count: '3' }), '3 coins');
  assert.equal(
    fill('{sats} practice sats arrived at this address', { sats: formatSats(100000n) }),
    '100,000 practice sats arrived at this address',
  );
  assert.equal(fill('Llegaron {sats} sats de práctica.', { sats: '100,000' }), 'Llegaron 100,000 sats de práctica.');
  assert.equal(fill('{a}{b}', { a: '1', b: '2' }), '12');
  assert.equal(
    fill('{fee} sats ({size} vB at {rate} sat/vB)', { fee: '282', size: '141', rate: '2' }),
    '282 sats (141 vB at 2 sat/vB)',
  );
  // The same slot twice is filled twice.
  assert.equal(fill('{n} and {n} again', { n: 'this' }), 'this and this again');
  // An empty value is still a value.
  assert.equal(fill('[{x}]', { x: '' }), '[]');
  // A text with no slots needs no values.
  assert.equal(fill('No coins yet', {}), 'No coins yet');
});

test('fill puts a value in as it is', () => {
  // Braces, dollar signs and slot-like text inside a value are not read again.
  assert.equal(fill('{a} then {b}', { a: '{b}', b: 'x' }), '{b} then x');
  assert.equal(fill('{a}', { a: '$& $1 $$ {a}' }), '$& $1 $$ {a}');
});

test('fill throws on a slot with no value', () => {
  assert.throws(() => fill('{count} coins', {}), /no value for \{count\}/);
  assert.throws(() => fill('{a} and {b}', { a: '1' }), /no value for \{b\}/);
  // A name that only exists further up the chain is no value.
  assert.throws(() => fill('{toString}', {}), /no value for \{toString\}/);
  assert.throws(() => fill('{constructor} {x}', { x: '1' }), /no value for \{constructor\}/);
});

test('fill throws on a value with no slot', () => {
  assert.throws(() => fill('No coins yet', { count: '3' }), /no \{count\}/);
  assert.throws(() => fill('{a}', { a: '1', b: '2' }), /no \{b\}/);
  // What is not written as a slot is not one.
  assert.throws(() => fill('{ count } coins', { count: '3' }), /no \{count\}/);
  assert.throws(() => fill('{{count}} coins', { other: '3' }), /no value for \{count\}/);
});

test('slotNames: each name once, in order', () => {
  assert.deepEqual(slotNames('No coins yet'), []);
  assert.deepEqual(slotNames('{count} of {total}'), ['count', 'total']);
  assert.deepEqual(slotNames('{b} {a} {b}'), ['b', 'a']);
  assert.deepEqual(slotNames('{tag2} {Tag}'), ['tag2', 'Tag']);
  // Not slots: empty, spaced, starting with a digit, or with other characters inside.
  assert.deepEqual(slotNames('{} { a } {1a} {a-b} {a.b} {'), []);
  // Calling it twice gives the same answer (the pattern keeps no position between calls).
  assert.deepEqual(slotNames('{count} of {total}'), ['count', 'total']);
});
