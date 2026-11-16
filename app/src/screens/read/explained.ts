// "What just happened", from keys to words. Plain functions, so that
// "node --test" can hold every sentence to the transaction it came from.
//
// lib/doit/explain.ts reads a transaction and answers with sentences as
// keys and slots: which sentence, and the amounts, counts and addresses
// that go into it. The string table (strings/doit.ts) holds each sentence
// in both languages. This file puts the two together: it writes each slot's
// value the way the app writes that kind of value, and says which glossary
// entries the sentences name.
//
// Nothing is worked out here that explain.ts has not worked out. A figure
// on screen is one that was computed there: no sum is done again, and no
// product is ever shown that does not multiply out (a fee rate that is not
// a whole number comes with a sentence that says "about").

import type { Lang } from '@learnbitcoin/practice-contract';
import type { TxView } from '@learnbitcoin/practice-wallet';
import { satsText } from '../../components/wallet/frame.ts';
import { feeRateText } from '../../components/wallet/tx-text.ts';
import { explain, type ExplainTerm, type Sentence } from '../../lib/doit/explain.ts';
import { formatSats } from '../../lib/format.ts';
import { strings } from '../../strings/index.ts';

/** One sentence, ready to draw: its text from the table, and a written value for each of its slots. */
export interface Said {
  key: Sentence['key'];
  /** The sentence in the page's language, with its slots still open. */
  text: string;
  /** What goes into each slot, as text. */
  slots: Record<string, string>;
}

/** The slot that holds an address: drawn apart from the words, in the monospace font. */
export const ADDRESS_SLOTS = ['address'] as const;

/**
 * A sentence's values as the app writes them:
 *   amount, fee   an amount with its unit: "282 practice sats"
 *   in, out       the two figures of the fee's sum, as bare numbers: the
 *                 sentence names the unit once, on what is left
 *   count, size, height   a number, with a comma between thousands
 *   rate          a fee rate: a whole number, or two decimal places at most
 *   address       as it is
 */
export function explainSlots(sentence: Sentence, lang: Lang): Record<string, string> {
  const { amount, in: went, out: came, fee, count, size, rate, height, address } = sentence.slots;
  const slots: Record<string, string> = {};
  if (amount !== undefined) slots.amount = satsText(amount, lang);
  if (fee !== undefined) slots.fee = satsText(fee, lang);
  if (went !== undefined) slots.in = formatSats(went);
  if (came !== undefined) slots.out = formatSats(came);
  if (count !== undefined) slots.count = formatSats(count);
  if (size !== undefined) slots.size = formatSats(size);
  if (rate !== undefined) slots.rate = feeRateText(rate);
  if (height !== undefined) slots.height = formatSats(height);
  if (address !== undefined) slots.address = address;
  return slots;
}

/** The sentences for one transaction, in the page's language. Empty for a transaction that does not touch this wallet. */
export function explained(view: TxView, lang: Lang): Said[] {
  const t = strings.doit[lang];
  return explain(view).map((sentence) => ({ key: sentence.key, text: t[sentence.key], slots: explainSlots(sentence, lang) }));
}

/** The glossary entries the sentences of one transaction name, each once, in the order they are first named. */
export function explainedTerms(view: TxView): ExplainTerm[] {
  const terms: ExplainTerm[] = [];
  for (const sentence of explain(view)) {
    for (const term of sentence.terms) if (!terms.includes(term)) terms.push(term);
  }
  return terms;
}
