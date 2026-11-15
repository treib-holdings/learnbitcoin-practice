// What the shell promises about the page around every screen: the document
// title carries the PRACTICE marker, Home keeps the title index.html has,
// the wallet's bot check is joined to the router in one place, <main> is
// marked busy while a passkey prompt is open or a payment is being sent,
// and a screen is named to the counter before its own work begins.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { LANGS } from '@learnbitcoin/practice-contract';
import { screenNumber, screenPutOnPage } from '../src/components/screen-count.ts';
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

test('index.html leaves room for the sticky banner when a link jumps to a part of the page, and room at the foot', () => {
  // "Skip to content" and a focused field must land below the banner, which
  // is two lines tall on a narrow Spanish screen: 56 px of scroll padding.
  // And a link brought on screen from below must show its whole focus
  // outline (2 px, 2 px away from the link): 8 px at the foot.
  assert.match(indexHtml, /<html lang="en" class="scroll-pt-14 scroll-pb-2">/);
  // The gallery's page is the app's page in this.
  const gallery = readFileSync(new URL('../dev/index.html', import.meta.url), 'utf8');
  assert.match(gallery, /<html lang="en" class="scroll-pt-14 scroll-pb-2">/);
});

test('index.html tells a browser without JavaScript what is missing, in both of the app\'s languages', () => {
  // One file is served for every address, /es included, and without JavaScript nothing can pick a
  // language: so the line stands there in both, the Spanish one marked as Spanish.
  const line = /<noscript>([\s\S]*?)<\/noscript>/.exec(indexHtml)?.[1] ?? '';
  assert.match(line, /<p>The practice wallet needs JavaScript\.<\/p>/);
  assert.match(line, /<p lang="es">La billetera de práctica necesita JavaScript\.<\/p>/);
  // Nothing in it that the page's security policy would refuse.
  assert.doesNotMatch(line, /style=|<style|<script|\son[a-z]+=/);
});

// -- screen views ---------------------------------------------------------------------

test('a screen is named to the counter before its own script runs', () => {
  // What the wallet counts is filed under the screen that was named last (lib/events.ts). A screen
  // can have the wallet count something while it is being put on the page: Backup shows the 12
  // words straight after a create, and that is "Words shown". Named in a plain effect, which runs
  // after the page is redrawn, the new screen would come too late and the count would be filed
  // under the screen before it. $effect.pre runs before the redraw.
  const app = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8');
  assert.match(app, /\$effect\.pre\(\(\) => \{\s*const route = router\.route;\s*const lang = router\.lang;\s*if \(counting\) trackPage\(route, lang\);\s*\}\);/);
  // One place names screens, and it is that one.
  assert.equal(app.match(/trackPage\(/g)?.length, 1);
});

test('what a screen counts as it leaves is still filed under it', () => {
  // The other end of a change of screen. The old screen is taken off the page after the new one has
  // been named (and, as Svelte does it, after the new one has been put there). What it counts in
  // that moment is its own: Restore lets go of typed words, and "erased" belongs to Restore. A marker
  // stands first in the block that holds each screen, so that its parting word comes before the
  // screen's own and the next marker's "arrived" before the next screen's first work.
  const app = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8');
  assert.match(app, /\{#key Screen\}\s*<ScreenChange \/>\s*<WalletGate>\s*<Screen \/>\s*<\/WalletGate>\s*\{\/key\}/);
  const marker = readFileSync(new URL('../src/components/ScreenChange.svelte', import.meta.url), 'utf8');
  assert.match(marker, /onDestroy\(screenLeaving\);/);
  // It also counts the screens, for the pieces whose work can outlive their screen (the unlock step).
  assert.match(marker, /\n  screenPutOnPage\(\);\n/);
  assert.match(marker, /\$effect\(\(\) => \{\s*screenArrived\(\);\s*\}\);/);
  // It draws nothing: the file ends with its script.
  assert.match(marker.trimEnd(), /<\/script>$/);
  // Only the marker says when a screen leaves and arrives, and only the marker counts.
  for (const { name, text } of [...sources('src/components'), ...sources('src/screens')]) {
    if (name.endsWith('ScreenChange.svelte')) continue;
    assert.doesNotMatch(text, /screenLeaving|screenArrived/, name);
    if (!name.endsWith('screen-count.ts')) assert.doesNotMatch(text, /screenPutOnPage/, name);
  }
});

test('the count of screens goes up by one for each screen put on the page', () => {
  const before = screenNumber();
  assert.equal(screenNumber(), before, 'reading it changes nothing');
  screenPutOnPage();
  assert.equal(screenNumber(), before + 1);
  screenPutOnPage();
  assert.equal(screenNumber(), before + 2);
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
