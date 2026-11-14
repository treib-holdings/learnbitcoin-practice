// What the shell promises about the page around every screen: the document
// title carries the PRACTICE marker, Home keeps the title index.html has,
// the wallet's bot check is joined to the router in one place, and <main>
// is marked busy while a passkey prompt is open or a payment is being sent.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import { fill } from '../src/lib/format.ts';
import { strings } from '../src/strings/index.ts';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Home keeps the title index.html carries, so the one indexable page has one title', () => {
  const fixed = /<title>([^<]*)<\/title>/.exec(indexHtml)?.[1];
  assert.equal(fixed, 'Practice wallet | LearnBitcoin');
  assert.equal(strings.common.en.homeTitle, fixed);
});

test('every document title starts with the PRACTICE word, in both languages', () => {
  for (const lang of LANGS) {
    const t = strings.common[lang];
    const word = t.markerBadge;
    assert.ok(t.homeTitle.startsWith(word), `${lang}: ${t.homeTitle}`);
    assert.ok(fill(t.markerTitle, { screen: t.section_receive }).startsWith(`${word}: `), lang);
    // And both end with the site's name, as index.html's does.
    assert.ok(t.homeTitle.endsWith(` | ${t.siteName}`), lang);
    assert.ok(fill(t.markerTitle, { screen: t.section_receive }).endsWith(` | ${t.siteName}`), lang);
  }
});

test('index.html leaves room for the sticky banner when a link jumps to a part of the page', () => {
  // "Skip to content" and a focused field must land below the banner, which
  // is two lines tall on a narrow Spanish screen: 56 px of scroll padding.
  assert.match(indexHtml, /<html lang="en" class="scroll-pt-14">/);
});

// -- the bot check and the router ---------------------------------------------------

/** Every .ts and .svelte file under a folder of the app, with its text. */
function sources(folder: string): { name: string; text: string }[] {
  const root = new URL(`../${folder}/`, import.meta.url);
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') || name.endsWith('.svelte'))
    .map((name) => ({ name: `${folder}/${name}`, text: readFileSync(new URL(name, root), 'utf8') }));
}

test('main.ts joins the bot check to the router, and nothing else does', () => {
  // SPEC section 7: once the bot check's script has loaded, every move
  // between screens is a full page load. The wallet knows when (a screen
  // calls wallet.beforeBotCheck()), only the router can make it so, and
  // main.ts is the one file that sees both.
  for (const file of ['src/main.ts', 'dev/main.ts']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(text, /onBotCheck\(\(\) => router\.fullLoadsFromNowOn\(\)\)/, file);
  }
  // What main.ts imports it from stays in step with the real wallet module:
  // `wallet`, and `onBotCheck` beside it.
  const stub = readFileSync(new URL('../src/lib/wallet.svelte.ts', import.meta.url), 'utf8');
  assert.match(stub, /export const wallet\b/);
  assert.match(stub, /export function onBotCheck\(listener: \(\) => void\): void/);
  // One owner: no screen and no piece calls the router's switch itself. A
  // screen that did, and one that forgot, would both look right in review.
  const files = [...sources('src/components'), ...sources('src/screens')];
  assert.ok(files.length >= 60, 'the walk found the pieces and the screens');
  for (const { name, text } of files) assert.doesNotMatch(text, /fullLoadsFromNowOn/, name);
});

// -- <main aria-busy> ---------------------------------------------------------------

test('every wait for a passkey prompt, a restore or a broadcast marks <main> busy', () => {
  // SPEC section 13: <main> carries aria-busy while a ceremony, the first
  // scan or a broadcast runs. The wallet publishes only the first scan of a
  // wallet that is in this browser (chain.scanning). The others start with
  // a tap, and the piece that takes the tap says so by wrapping the call:
  // await busyWhile(wallet.unlock(how)). A bare "await wallet.unlock(how)"
  // leaves <main> unmarked. A restore is on the list because its scan runs
  // before there is a wallet here, so the wallet does not publish that one.
  const WAITS = /wallet\.(createWithPasskey|finishSetup|openWithPasskey|unlock|restore|broadcast)\(/;
  const calls: string[] = [];
  for (const { name, text } of [...sources('src/components'), ...sources('src/screens')]) {
    for (const line of text.split('\n')) {
      const code = line.trim();
      // Comments may name the calls as they like.
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*') || code.startsWith('<!--')) continue;
      if (!WAITS.test(code)) continue;
      calls.push(name);
      assert.match(code, /busyWhile\(\s*wallet\./, `${name}: ${code}`);
    }
  }
  // The walk found the two that exist so far: Open and Unlock.
  assert.ok(calls.some((name) => name.endsWith('OpenWithPasskey.svelte')), calls.join(', '));
  assert.ok(calls.some((name) => name.endsWith('Unlock.svelte')), calls.join(', '));
  // And the shell reads the mark.
  const shell = readFileSync(new URL('../src/components/Shell.svelte', import.meta.url), 'utf8');
  assert.match(shell, /aria-busy=\{busy \|\| working\(\) \? 'true' : undefined\}/);
});
