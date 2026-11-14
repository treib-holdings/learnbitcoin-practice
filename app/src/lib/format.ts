// How amounts, dates, elapsed time and IDs are written, in both languages.
//
// All of it is written out by hand. The browser's own formatter (Intl) gives
// different text in different browsers and locales: asked for Spanish it can
// print one hundred thousand as "100.000", which a reader of this site would
// take for one hundred. The site writes the same digits in both languages,
// with a comma between thousands, and so does this file.

import type { Lang } from '@learnbitcoin/practice-contract';

/** "1234567" -> "1,234,567". */
function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** An amount in sats, the same in both languages: 100000 -> "100,000". Throws on a fraction: sats are whole. */
export function formatSats(sats: bigint | number): string {
  const text = BigInt(sats).toString();
  return text.startsWith('-') ? `-${groupThousands(text.slice(1))}` : groupThousands(text);
}

/**
 * Reads an amount typed into a field. Digits, with commas allowed only where
 * formatSats would put them: "100000" and "100,000" are both 100000n.
 *
 * "period": the text has a period in it. Sats are whole, and a period means
 *           two things (a decimal point to some readers, thousands to others),
 *           so it is refused, and the screen says why.
 * "empty":  nothing was typed.
 * "invalid": anything else.
 */
export function parseSats(input: string): bigint | 'empty' | 'period' | 'invalid' {
  const text = input.trim();
  if (text === '') return 'empty';
  if (text.includes('.')) return 'period';
  if (/^[0-9]+$/.test(text)) return BigInt(text);
  if (/^[1-9][0-9]{0,2}(,[0-9]{3})+$/.test(text)) return BigInt(text.replaceAll(',', ''));
  return 'invalid';
}

const MONTHS: Record<Lang, readonly string[]> = {
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  es: [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ],
};

const DATE: Record<Lang, (day: number, month: string, year: number) => string> = {
  en: (day, month, year) => `${month} ${day}, ${year}`,
  es: (day, month, year) => `${day} de ${month} de ${year}`,
};

/**
 * A day: "November 13, 2026" or "13 de noviembre de 2026". The day is the one
 * on the reader's own calendar (their device's time zone) unless `zone` is
 * "utc". Throws on a time that is not a number.
 */
export function formatDate(unixSeconds: number, lang: Lang, zone: 'local' | 'utc' = 'local'): string {
  const at = new Date(unixSeconds * 1000);
  if (Number.isNaN(at.getTime())) throw new RangeError('formatDate: not a time');
  const utc = zone === 'utc';
  const month = MONTHS[lang][utc ? at.getUTCMonth() : at.getMonth()] ?? '';
  return DATE[lang](utc ? at.getUTCDate() : at.getDate(), month, utc ? at.getUTCFullYear() : at.getFullYear());
}

/** The units of elapsed time, largest first, each with its name for one and for several. */
const UNITS: readonly { seconds: number; en: readonly [string, string]; es: readonly [string, string] }[] = [
  { seconds: 86400, en: ['day', 'days'], es: ['día', 'días'] },
  { seconds: 3600, en: ['hour', 'hours'], es: ['hora', 'horas'] },
  { seconds: 60, en: ['minute', 'minutes'], es: ['minuto', 'minutos'] },
  { seconds: 1, en: ['second', 'seconds'], es: ['segundo', 'segundos'] },
];

const JUST_NOW: Record<Lang, string> = { en: 'just now', es: 'hace un momento' };

const AGO: Record<Lang, (count: string, unit: string) => string> = {
  en: (count, unit) => `${count} ${unit} ago`,
  es: (count, unit) => `hace ${count} ${unit}`,
};

/**
 * How long ago something happened, in the largest unit that fits, rounded
 * down: "3 minutes ago" or "hace 3 minutos". Under a second, and for a time
 * slightly in the future (the reader's clock and a block's time never agree
 * exactly), it says "just now". Throws on a number that is not finite.
 */
export function formatElapsed(seconds: number, lang: Lang): string {
  if (!Number.isFinite(seconds)) throw new RangeError('formatElapsed: not a length of time');
  const whole = Math.floor(seconds);
  for (const unit of UNITS) {
    if (whole < unit.seconds) continue;
    const count = Math.floor(whole / unit.seconds);
    return AGO[lang](groupThousands(String(count)), unit[lang][count === 1 ? 0 : 1]);
  }
  return JUST_NOW[lang];
}

/** A long ID cut down to its two ends, enough to compare by eye: "6c0443f5...564c1d". */
export function shortId(hex: string): string {
  return hex.length <= 17 ? hex : `${hex.slice(0, 8)}...${hex.slice(-6)}`;
}

const SLOT = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** The names of the slots in a text, each once, in the order they first appear: "{a} of {b}" -> a, b. */
export function slotNames(template: string): string[] {
  return [...new Set([...template.matchAll(SLOT)].map((match) => match[1] ?? ''))];
}

/**
 * Puts values into a text from the string tables: fill("{count} coins",
 * { count: "3" }) is "3 coins". A slot with no value and a value with no
 * slot both throw. Either one means the screen and its text have drifted
 * apart, and a test should catch that before a reader sees "{count}".
 */
export function fill(template: string, slots: Record<string, string>): string {
  const names = slotNames(template);
  for (const name of names) {
    if (!Object.hasOwn(slots, name)) throw new Error(`fill: no value for {${name}} in "${template}"`);
  }
  for (const name of Object.keys(slots)) {
    if (!names.includes(name)) throw new Error(`fill: the text has no {${name}}: "${template}"`);
  }
  // A value is put in as it is: braces inside a value are not read as slots.
  return template.replace(SLOT, (_match, name: string) => slots[name] ?? '');
}
