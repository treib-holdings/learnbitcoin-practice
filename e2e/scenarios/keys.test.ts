// Backup and Settings: the 12 words on screen and off it again, the practice
// card on paper, the wallet's facts and descriptors, Remove, what another
// tab can do to both screens, and a passkey wallet's lock and unlock.
//
// A wallet kept with its 12 words can be put in a page's storage before the
// app starts. A passkey wallet cannot (a virtual authenticator's secret
// cannot be set from outside), and the Create screen is another part's. So
// the passkey scenarios here make a passkey themselves and open its wallet
// through the gate's "Open with my passkey" (openPasskeyWallet below): the
// wallet engine, the unlock step and both screens are then the real ones.
// What still waits for scenarios that start at the Create screen is the
// "Wallet made" step, which only a create leads to.

import assert from 'node:assert/strict';
import { accountDescriptor } from '@learnbitcoin/practice-wallet';
import { RECORD_KEY } from '../../app/src/lib/keystore.ts';
import { REMOVE_SETTLE_MS } from '../../app/src/screens/keys/taps.ts';
import { OTHER_WORDS, scenario, testRecord, type OpenedPage, type Scenario } from './helpers.ts';

const byTestId = (testid: string): string => `[data-testid="${testid}"]`;

/** True when an element with this test hook is in the page. */
const has = async (page: OpenedPage, testid: string): Promise<boolean> => (await page.page.$(byTestId(testid))) !== null;

/** Waits until the Remove question takes an answer: it takes none in the first moment after it opens. */
const untilAnswersCount = (): Promise<void> => new Promise((wake) => setTimeout(wake, REMOVE_SETTLE_MS + 150));

// Presses that must fall within the first moment after the Remove question opens are made inside the
// page, one after the other, with two frames between them for the page to draw what the last press set
// going. Made one by one from the scenario, they would depend on the machine: on a busy one the
// scenario's own trips to the page and back can take longer than that moment, and the press would count.

/**
 * True when the element with this test hook is whole on the screen and
 * nothing lies over it: its top and bottom edges are inside the window, and
 * a tap on either would reach it (not the sticky banner, say).
 */
const wholeOnScreen = (page: OpenedPage, testid: string): Promise<boolean> =>
  page.page.$eval(byTestId(testid), (element) => {
    const box = element.getBoundingClientRect();
    const middle = box.left + box.width / 2;
    const reached = (y: number): boolean => element.contains(document.elementFromPoint(middle, y));
    return box.top >= 0 && box.bottom <= window.innerHeight && reached(box.top + 2) && reached(box.bottom - 2);
  });

/** How many times the page's main part says "(passkey)", the English word a Spanish screen adds once. */
const glosses = (page: OpenedPage, within = 'main'): Promise<number> =>
  page.page.$eval(within, (element) => (element as HTMLElement).innerText.split('(passkey)').length - 1);

/**
 * Puts a passkey wallet in the page, on the real wallet engine. The page
 * must have been opened on a wallet route with `passkey: 'prf'` and nothing
 * stored, so that the gate stands there. The scenario makes a passkey as the
 * app's own Create would (kept by the device, with the secret a wallet is
 * made from, the reader verified), and the gate's "Open with my passkey"
 * then adopts its wallet: unlocked, and still empty.
 */
async function openPasskeyWallet(page: OpenedPage): Promise<{ tag: string; fingerprint: string; credentialId: string }> {
  // Chrome makes no passkey for a page that is not in front.
  await page.page.bringToFront();
  await page.waitFor('open-passkey');
  await page.page.evaluate(async () => {
    await navigator.credentials.create({
      publicKey: {
        rp: { id: location.hostname, name: 'scenario' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'a practice passkey', displayName: 'a practice passkey' },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        attestation: 'none',
        extensions: { prf: {} },
      },
    });
  });
  await page.click('open-passkey');
  await page.waitFor('lock');
  const stored = JSON.parse((await page.stored())!) as { kind: string; tag: string; fingerprint: string; credentialId: string; mnemonic?: string };
  assert.equal(stored.kind, 'passkey');
  assert.equal(stored.mnemonic, undefined, 'a passkey wallet stores no words');
  return stored;
}

/** The lock line of a passkey wallet, as the wallet frame words it. */
const LOCKED = /^Looking and receiving need no passkey\./;

/** The text of the screen's heading. */
const heading = (page: OpenedPage): Promise<string> =>
  page.page.$eval('main h1', (h1) => (h1.textContent ?? '').trim());

/** What a reader sees of the page: its text as drawn, without what is hidden. */
const seenText = (page: OpenedPage): Promise<string> => page.page.evaluate(() => document.body.innerText);

/** The test hook of the element that has keyboard focus, or its tag when it has none. */
const focused = (page: OpenedPage): Promise<string> =>
  page.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? '');

/**
 * What the last regular expression that matched in the page ran on. A
 * pattern keeps that text where every script in the page can read it, so
 * the 12 words must never be found there.
 *
 * What this can and cannot see: it reads the one text the page's latest
 * match ran on, at the moment it is asked. The page matches other texts all
 * the time (its own title, for one), so a pattern run over the words inside
 * a screen would be overwritten before a scenario could look. The rule that
 * no pattern meets the words in these screens is held by the source test in
 * app/test/keys-text.test.ts. Here it is a check on the moment only: nothing
 * has left the words lying there when the scenario looks.
 */
const lastMatched = (page: OpenedPage): Promise<string> => page.page.evaluate(() => String(RegExp.input));

/** A click on one of the wallet's section links: a move inside the app, with no page load. */
async function toSection(page: OpenedPage, path: string): Promise<void> {
  await page.page.locator(`main nav a[href="${path}"]`).click();
}

/** The events of one name that reached the Worker, once the page and the Worker have gone quiet. */
async function counted(s: Scenario, page: OpenedPage, name: string): Promise<unknown[]> {
  await page.settle();
  await s.stack.settled();
  return s.stack.events.map((recorded) => recorded.event).filter((event) => event.name === name);
}

scenario('Backup: the 12 words show only when asked for, are the stored wallet\'s, and leave the screen again', async (s) => {
  const record = testRecord();
  const words = record.mnemonic!.split(' ');
  // A passkey provider is there and stays unused: a wallet made without a passkey never asks for one.
  const page = await s.open('/wallet/backup', { record, width: 375, passkey: 'prf' });

  // Before anything is asked: no word on the page, and the reader is told why this page is the exception.
  await page.waitFor('reveal-words');
  assert.equal(await heading(page), 'Backup');
  assert.deepEqual(await page.texts('word'), []);
  assert.doesNotMatch(await seenText(page), /abandon/);
  assert.match(await page.text('backup-exception'), /This page is the one exception, because the 12 words here only guard play money/);
  assert.match(await page.text('spoken-aloud'), /A screen reader will read the 12 words aloud/);
  // Tab passes over that warning, so the button carries it as its description: a screen reader says it
  // when the button takes focus.
  assert.match(
    await page.page.$eval(byTestId('reveal-words'), (button) => document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ?? ''),
    /^A screen reader will read the 12 words aloud\./,
  );
  // The second click of a double tap never shows the words: its first click may have been on "Hide them".
  await page.page.$eval(byTestId('reveal-words'), (button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })));
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await heading(page), 'Backup');
  // No lock line: this wallet was made without a passkey.
  assert.equal(await page.page.$(byTestId('lock-state')), null);

  // Asked for, they are the words in the stored record, in order.
  await page.click('reveal-words');
  await page.waitFor('word');
  assert.deepEqual(await page.texts('word'), words);
  assert.deepEqual(await page.texts('word'), (JSON.parse((await page.stored())!) as { mnemonic: string }).mnemonic.split(' '));
  // The step swapped in place: its heading says so and has the focus.
  assert.equal(await heading(page), 'Your 12 words');
  assert.equal(await focused(page), 'H1');
  assert.match(await page.text('never-real-money'), /Never put real money on these 12 words/);
  // On a phone's width the words and everything around them fit the screen.
  assert.equal(await page.sidewaysScroll(), 0);
  // The PRACTICE stamp stands right above the words, so a picture of them carries the marker.
  assert.equal(
    await page.page.$eval(byTestId('word'), (item) => (item.closest('[data-print="never"]')?.previousElementSibling?.textContent ?? '').trim()),
    'Practice',
  );
  // The card's lines stand where the words do: on a phone both are two columns wide, and line 2 is at
  // the top right like word 2. A reader who copies by place writes the words in the right order.
  const places = await page.page.evaluate(() => {
    const columns = (selector: string): number[] => {
      const lefts = [...document.querySelectorAll(selector)].map((element) => Math.round(element.getBoundingClientRect().left));
      const order = [...new Set(lefts)].sort((a, b) => a - b);
      return lefts.map((left) => order.indexOf(left));
    };
    return { words: columns('[data-testid="word"]'), lines: columns('[data-testid="practice-card"] ol > li') };
  });
  assert.deepEqual(places.words, [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
  assert.deepEqual(places.lines, places.words);

  // The list as SPEC section 12 wants it: ordered, English, not to be translated, corrected, completed or kept.
  const list = await page.page.$eval(byTestId('word'), (item) => {
    const ol = item.parentElement!;
    const attribute = (name: string) => ol.getAttribute(name);
    return {
      tag: ol.tagName,
      items: ol.children.length,
      lang: attribute('lang'),
      translate: attribute('translate'),
      spellcheck: attribute('spellcheck'),
      autocomplete: attribute('autocomplete'),
      autocorrect: attribute('autocorrect'),
      autocapitalize: attribute('autocapitalize'),
      named: ol.hasAttribute('name') || item.hasAttribute('name'),
      inForm: ol.closest('form') !== null,
      // No control to copy or download the words, in the list or beside it.
      controls: document.querySelectorAll('[data-print="never"] button, [data-print="never"] a, main [download], main [data-testid^="copy"]').length,
    };
  });
  assert.deepEqual(list, {
    tag: 'OL',
    items: 12,
    lang: 'en',
    translate: 'no',
    spellcheck: 'false',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'none',
    named: false,
    inForm: false,
    controls: 0,
  });
  assert.doesNotMatch(await lastMatched(page), /abandon|about/);

  // The second click of a double tap does not hide them again: its first click was on "Show the 12 words".
  await page.page.$eval(byTestId('hide-words'), (button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })));
  assert.deepEqual(await page.texts('word'), words);

  // "Hide them" takes them off the page, not just out of sight.
  await page.click('hide-words');
  await page.waitForGone('word');
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await heading(page), 'Backup');
  assert.equal(await focused(page), 'H1');
  assert.doesNotMatch(await page.page.evaluate(() => document.body.textContent ?? ''), /abandon/);

  // From the keyboard, and a second time: the same words.
  await page.page.focus(byTestId('reveal-words'));
  await page.page.keyboard.press('Enter');
  await page.waitFor('word');
  assert.deepEqual(await page.texts('word'), words);

  // Leaving the screen drops them: back on Backup, nothing is shown until it is asked for again.
  await toSection(page, '/wallet/settings');
  await page.waitFor('wallet-fingerprint');
  assert.deepEqual(await page.texts('word'), []);
  assert.doesNotMatch(await page.page.evaluate(() => document.body.textContent ?? ''), /abandon/);
  await toSection(page, '/wallet/backup');
  await page.waitFor('reveal-words');
  assert.deepEqual(await page.texts('word'), []);
  assert.doesNotMatch(await lastMatched(page), /abandon|about/);

  // Shown twice, counted once: the event says which kind of wallet, and nothing else.
  assert.deepEqual(await counted(s, page, 'Words shown'), [{ name: 'Words shown', path: '/wallet/backup', value: 'words' }]);
  // Nothing was announced (the words are never spoken by the page itself), nothing was stored or changed,
  // and the passkey provider was never asked.
  assert.deepEqual(page.statusLog(), []);
  assert.equal(await page.stored(), JSON.stringify(record));
  assert.deepEqual(await page.passkey!.credentials(), []);
});

scenario('Backup: on paper the practice card shows alone, and no word does, shown or not', async (s) => {
  const page = await s.open('/wallet/backup', { record: testRecord(), width: 1280 });
  await page.waitFor('practice-card');

  /** What print media draws: which things take up room, and the text a sheet would carry. */
  const onPaper = async () => {
    await page.page.emulateMediaType('print');
    try {
      return await page.page.evaluate(() => {
        const drawn = (selector: string): number =>
          [...document.querySelectorAll(selector)].filter((element) => element.getClientRects().length > 0).length;
        return {
          card: drawn('[data-testid="practice-card"]'),
          lines: drawn('[data-testid="practice-card"] ol > li'),
          words: drawn('[data-testid="word"]'),
          wordsInPage: document.querySelectorAll('[data-testid="word"]').length,
          // The rest of the screen: the banner, the header, the heading, the section links, every button, the footer.
          around: drawn('[role="note"], header, main h1, main h2, main nav, main button, main a, footer'),
          text: document.body.innerText.replace(/\s+/g, ' ').trim(),
        };
      });
    } finally {
      await page.page.emulateMediaType();
    }
  };
  const CARD = /^The 12 words of a practice wallet PRACTICE 1\. 2\. 3\. 4\. 5\. 6\. 7\. 8\. 9\. 10\. 11\. 12\. Practice words only\. The words of a real wallet never go into a web page, this one included\. Restores only on the practice network\.$/i;

  // With the words hidden.
  const hidden = await onPaper();
  assert.deepEqual([hidden.card, hidden.lines, hidden.words, hidden.wordsInPage, hidden.around], [1, 12, 0, 0, 0]);
  assert.match(hidden.text, CARD);

  // With the words on screen: twelve in the page, none on paper, and the same card.
  await page.click('reveal-words');
  await page.waitFor('word');
  const shown = await onPaper();
  assert.deepEqual([shown.card, shown.lines, shown.words, shown.wordsInPage, shown.around], [1, 12, 0, 12, 0]);
  assert.match(shown.text, CARD);
  assert.doesNotMatch(shown.text, /abandon/);
  // Back on screen they are still there: only paper leaves them out.
  assert.equal((await page.texts('word')).length, 12);

  // The sheet itself: one page, as Chrome prints it.
  const pdf = Buffer.from(await page.page.pdf({ format: 'Letter' })).toString('latin1');
  assert.equal(pdf.match(/\/Type\s*\/Page\b/g)?.length, 1, 'the printout is one page');

  // "Print the card" asks the browser to print, once: also for a double click, which is two clicks.
  await page.page.evaluate(() => {
    const counter = window as unknown as { printed: number };
    counter.printed = 0;
    window.print = () => {
      counter.printed += 1;
    };
  });
  await page.click('print-card');
  assert.equal(await page.page.evaluate(() => (window as unknown as { printed: number }).printed), 1);
  await page.page.click(byTestId('print-card'), { count: 2 });
  assert.equal(await page.page.evaluate(() => (window as unknown as { printed: number }).printed), 2);
});

scenario('Settings: the wallet fingerprint the record holds, and the descriptors the wallet package gives for it', async (s) => {
  const record = testRecord();
  const page = await s.open('/wallet/settings', { record, width: 375 });
  await page.waitFor('wallet-fingerprint');
  assert.equal(await heading(page), 'Settings');

  // The wallet in this browser: how this browser opens it, its wallet fingerprint, the day it has been
  // here since, its first address. Nothing about how it was made: the record does not know (a wallet
  // made with a passkey and restored from its 12 words is stored exactly like this one).
  assert.equal(await page.text('wallet-kind'), 'Opens without a passkey');
  assert.equal(await page.text('wallet-fingerprint'), record.fingerprint);
  assert.equal(await page.text('wallet-fingerprint'), '73c5da0a');
  assert.equal(await page.text('wallet-since'), 'November 1, 2026');
  assert.equal(await page.page.$eval(byTestId('wallet-since'), (value) => value.closest('div')?.querySelector('dt')?.textContent), 'In this browser since');
  assert.doesNotMatch(await page.page.$eval('main', (main) => (main as HTMLElement).innerText), /Made (on|with|without)\b|has no passkey/);
  assert.equal(await page.text('first-address'), record.firstAddress);
  assert.match(await seenText(page), /A wallet fingerprint is eight characters worked out from a wallet's keys\./);
  // No passkey, so no tag and no lock line.
  assert.equal(await page.page.$(byTestId('passkey-tag')), null);
  assert.equal(await page.page.$(byTestId('lock-state')), null);
  // A long address and two long descriptors, and the page still fits a phone's width.
  assert.equal(await page.sidewaysScroll(), 0);

  // What this browser keeps: the public key, and for this kind of wallet the 12 words.
  assert.match(await page.text('keeps-public'), /public key.+anyone who uses this browser can see the wallet\./);
  assert.equal(await page.text('keeps-words'), 'The 12 words, not encrypted. So anyone who uses this browser can also spend its coins.');
  assert.equal(await page.page.$(byTestId('keeps-no-words')), null);
  // On a later visit the browser is not asked again whether it keeps this page's data, so the screen does not say.
  assert.equal(await page.page.$(byTestId('keeps-persisted')), null);
  assert.equal(await page.page.$(byTestId('keeps-not-persisted')), null);
  assert.equal(await page.text('keeps-promise'), 'There is no account, and we set no cookies. The 12 words never leave this browser.');
  // The words themselves are nowhere on this screen.
  assert.doesNotMatch(await page.page.evaluate(() => document.body.textContent ?? ''), /abandon/);

  // The descriptors are the wallet package's own for this record, never translated, with a link to the Sparrow page.
  const receive = accountDescriptor(record.fingerprint, record.xpub, 0);
  const change = accountDescriptor(record.fingerprint, record.xpub, 1);
  assert.equal(await page.text('descriptor-receive'), receive);
  assert.equal(await page.text('descriptor-change'), change);
  assert.match(receive, /^wpkh\(\[73c5da0a\/84h\/1h\/0h\]tpub[0-9A-Za-z]+\/0\/\*\)#[0-9a-z]{8}$/);
  assert.equal(await page.page.$eval(byTestId('descriptor-receive'), (block) => block.getAttribute('translate')), 'no');
  // Each is shown whole: it wraps onto several lines inside the screen and nothing of it is cut off or
  // scrolled out of sight. The two differ only near their ends, which are therefore on screen too.
  for (const hook of ['descriptor-receive', 'descriptor-change']) {
    const shown = await page.page.$eval(byTestId(hook), (value) => {
      const box = value.getBoundingClientRect();
      const frame = value.parentElement!;
      return {
        lines: Math.round(box.height / Number.parseFloat(getComputedStyle(value).lineHeight)),
        inside: box.left >= 0 && box.right <= window.innerWidth,
        cut: frame.scrollWidth > frame.clientWidth || value.scrollWidth > value.clientWidth,
      };
    });
    assert.ok(shown.lines >= 3, `${hook} wraps: ${shown.lines} lines`);
    assert.deepEqual([shown.inside, shown.cut], [true, false], hook);
  }
  // The two copy buttons say which descriptor each one copies.
  assert.equal(await page.text('copy-descriptor-receive'), 'Copy receive descriptor');
  assert.equal(await page.text('copy-descriptor-change'), 'Copy change descriptor');
  assert.equal(await page.page.$eval('main a[href="/sparrow"]', (link) => (link.textContent ?? '').trim()), 'Practice network in Sparrow');

  // Copy: the whole descriptor is handed to the clipboard, and the status region says which one. The
  // clipboard here is a stand-in that keeps what it is given, so a run never touches the clipboard of the
  // machine it runs on.
  await page.page.evaluate(() => {
    const kept: string[] = [];
    (window as unknown as { copies: string[] }).copies = kept;
    navigator.clipboard.writeText = async (text: string) => {
      if (text.includes('/1/*)')) throw new DOMException('Write permission denied.', 'NotAllowedError');
      kept.push(text);
    };
  });
  await page.click('copy-descriptor-receive');
  assert.equal(await page.waitForStatus('copied'), 'Receive descriptor copied');
  assert.deepEqual(await page.page.evaluate(() => (window as unknown as { copies: string[] }).copies), [receive]);
  assert.equal(await page.text('copy-descriptor-receive'), 'Copied');
  assert.equal(await page.page.$(byTestId('copy-failed')), null);
  // A browser that refuses (here: for the change descriptor) is not passed over in silence.
  await page.click('copy-descriptor-change');
  assert.match(await page.waitForStatus('did not let the page copy'), /Select the text and copy it by hand\.$/);
  assert.match(await page.text('copy-failed'), /^This browser did not let the page copy\./);
  assert.deepEqual(await page.page.evaluate(() => (window as unknown as { copies: string[] }).copies), [receive]);

  // Looking needed no keys and changed nothing.
  assert.equal(await page.stored(), JSON.stringify(record));
  assert.deepEqual(await counted(s, page, 'Words shown'), []);
});

scenario('Remove asks first; "Keep it" keeps; "Remove it" deletes the wallet\'s key and nothing else, and goes Home', async (s) => {
  const record = testRecord();
  const others = { lb_progress_v1: '{"chapters":[4]}', another_key: 'stays' };
  const page = await s.open('/wallet/settings', { record, storage: others, width: 375 });
  await page.waitFor('remove-wallet');
  const keys = (): Promise<string[]> => page.page.evaluate(() => Object.keys(localStorage).sort());
  assert.deepEqual(await keys(), ['another_key', 'lb_progress_v1', 'lbp_wallet_v1']);

  // The button alone removes nothing: it opens a question. And an answer given in the moment the
  // question opens does not count, "Remove it" or "Keep it": nobody can have read the question yet.
  assert.equal(await page.page.$(byTestId('remove-confirm')), null);
  assert.equal(await page.page.$eval(byTestId('remove-wallet'), (button) => button.getAttribute('aria-expanded')), 'false');
  const early = await page.page.evaluate(async () => {
    const drawn = (): Promise<void> => new Promise((frame) => requestAnimationFrame(() => requestAnimationFrame(() => frame())));
    const press = (hook: string): void => document.querySelector<HTMLElement>(`[data-testid="${hook}"]`)?.click();
    const there = (hook: string): boolean => document.querySelector(`[data-testid="${hook}"]`) !== null;
    press('remove-wallet');
    await drawn();
    const opened = there('remove-confirm');
    press('remove-confirm');
    await drawn();
    const afterRemoveIt = there('remove-confirm');
    press('remove-keep');
    await drawn();
    return { opened, afterRemoveIt, afterKeepIt: there('remove-confirm'), path: location.pathname };
  });
  assert.deepEqual(early, { opened: true, afterRemoveIt: true, afterKeepIt: true, path: '/wallet/settings' });
  await page.waitFor('remove-confirm');
  assert.equal(await page.page.$eval(byTestId('remove-wallet'), (button) => button.getAttribute('aria-expanded')), 'true');
  assert.equal(await page.stored(), JSON.stringify(record));
  // The question is read out (it has the focus), and names what brings this wallet back: its 12 words,
  // or its passkey if it was made with one, which this browser cannot know of a wallet it keeps this way.
  assert.equal(await page.page.evaluate(() => document.activeElement?.textContent), 'Remove this wallet from this browser?');
  assert.equal(
    await page.text('remove-back'),
    'This erases the 12 words from this browser. The wallet comes back with its 12 words, or with its passkey if it was made with one. Without the words on paper and without a passkey, its practice coins are out of reach for good.',
  );
  assert.equal(await page.text('remove-confirm'), 'Remove it');
  assert.equal(await page.text('remove-keep'), 'Keep it');
  // Tab passes over that paragraph, so "Remove it" carries it as its description.
  assert.equal(
    await page.page.$eval(byTestId('remove-confirm'), (button) => document.getElementById(button.getAttribute('aria-describedby') ?? '')?.getAttribute('data-testid')),
    'remove-back',
  );

  // Once the question has stood for a moment its answers count.
  await untilAnswersCount();

  // From the keyboard: the link to the words, "Remove it", then "Keep it", which keeps the wallet.
  await page.page.keyboard.press('Tab');
  assert.equal(await page.page.evaluate(() => document.activeElement?.getAttribute('href')), '/wallet/backup');
  await page.page.keyboard.press('Tab');
  assert.equal(await focused(page), 'remove-confirm');
  await page.page.keyboard.press('Tab');
  assert.equal(await focused(page), 'remove-keep');
  await page.page.keyboard.press('Enter');
  await page.waitForGone('remove-confirm');
  assert.equal(await focused(page), 'remove-wallet');
  assert.equal(await page.stored(), JSON.stringify(record));
  assert.deepEqual(await keys(), ['another_key', 'lb_progress_v1', 'lbp_wallet_v1']);
  assert.deepEqual(await counted(s, page, 'Wallet removed'), []);

  // Asked again and answered "Remove it": the wallet's key is gone, the other keys are as they were.
  await page.page.evaluate(() => {
    (window as unknown as { samePage: boolean }).samePage = true;
  });
  await page.click('remove-wallet');
  await page.waitFor('remove-confirm');
  await untilAnswersCount();
  await page.click('remove-confirm');
  await page.page.waitForFunction(() => location.pathname === '/');
  assert.equal(await page.stored(), null);
  assert.deepEqual(await keys(), ['another_key', 'lb_progress_v1']);
  assert.equal(await page.stored('lb_progress_v1'), others.lb_progress_v1);
  assert.equal(await page.stored('another_key'), others.another_key);
  // Home, reached inside the app: no page was loaded on the way.
  assert.equal(await page.page.evaluate(() => (window as unknown as { samePage?: boolean }).samePage), true);
  assert.equal(await page.page.title(), 'Practice wallet | LearnBitcoin');

  // Counted once, with the kind of wallet and nothing that says which wallet.
  assert.deepEqual(await counted(s, page, 'Wallet removed'), [{ name: 'Wallet removed', path: '/wallet/settings', value: 'words' }]);
  for (const { event } of s.stack.events) {
    assert.doesNotMatch(JSON.stringify(event), new RegExp(`${record.fingerprint}|${record.firstAddress}|tpub`));
  }

  // The wallet is out of this browser: a wallet screen now says so.
  await page.goto('/wallet/settings');
  assert.equal(await heading(page), 'This browser has no practice wallet.');
  assert.equal(await page.page.$(byTestId('remove-wallet')), null);
});

scenario('the Spanish routes: Backup and Settings in Spanish, with the 12 words still English', async (s) => {
  const record = testRecord();
  const page = await s.open('/es/wallet/backup', { record, lang: 'es', width: 375 });
  await page.waitFor('reveal-words');
  assert.equal(await page.page.evaluate(() => document.documentElement.lang), 'es');
  assert.equal(await heading(page), 'Respaldo');
  assert.equal(await page.page.title(), 'Práctica: Respaldo | LearnBitcoin');
  assert.equal(await page.text('reveal-words'), 'Mostrar las 12 palabras');
  assert.match(await page.text('backup-exception'), /Esta página es la única excepción, porque sus 12 palabras solo protegen dinero de juguete/);
  assert.match(await page.text('spoken-aloud'), /Un lector de pantalla va a leer las 12 palabras en voz alta/);
  // The chapter the paragraph answers is linked in its Spanish edition.
  assert.equal(
    await page.page.$eval(`${byTestId('backup-exception')} a`, (link) => link.getAttribute('href')),
    `${s.stack.config.siteUrl}/es/recorrido/se-tu-propio-banco`,
  );

  // The words are English on purpose, the list says it is English, and the page says to copy them exactly.
  await page.click('reveal-words');
  await page.waitFor('word');
  assert.equal(await heading(page), 'Tus 12 palabras');
  assert.deepEqual(await page.texts('word'), record.mnemonic!.split(' '));
  assert.equal(await page.page.$eval(byTestId('word'), (item) => item.parentElement!.getAttribute('lang')), 'en');
  assert.match(await seenText(page), /Las 12 palabras están en inglés a propósito: salen de una lista fija\. Cópialas tal como están, sin traducirlas\./);
  assert.equal(await page.text('hide-words'), 'Ocultarlas');
  // The card, in Spanish, with the marker's own Spanish word.
  assert.match(await page.text('practice-card'), /Las 12 palabras de una billetera de práctica\s*Práctica.+Solo se restaura en la red de práctica\./);
  assert.equal(await page.text('print-card'), 'Imprimir la tarjeta');

  // The section links stay in Spanish, and Settings follows.
  await toSection(page, '/es/wallet/settings');
  await page.waitFor('wallet-fingerprint');
  assert.equal(await heading(page), 'Configuración');
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await page.text('wallet-kind'), 'Se abre sin llave de acceso (passkey)');
  assert.equal(await page.text('wallet-fingerprint'), record.fingerprint);
  assert.equal(await page.text('wallet-since'), '1 de noviembre de 2026');
  assert.equal(await page.page.$eval(byTestId('wallet-since'), (value) => value.closest('div')?.querySelector('dt')?.textContent), 'En este navegador desde el');
  assert.match(await seenText(page), /La huella de la billetera son ocho caracteres/);
  // Descriptors are the same in every language.
  assert.equal(await page.text('descriptor-receive'), accountDescriptor(record.fingerprint, record.xpub, 0));
  assert.equal(await page.page.$eval('main a[href="/es/sparrow"]', (link) => (link.textContent ?? '').trim()), 'La red de práctica en Sparrow');

  // Remove asks in Spanish, and "Conservarla" keeps the wallet.
  await page.click('remove-wallet');
  await page.waitFor('remove-keep');
  assert.equal(await page.page.evaluate(() => document.activeElement?.textContent), '¿Quitar esta billetera de este navegador?');
  assert.match(await page.text('remove-back'), /La billetera vuelve con sus 12 palabras, o con su llave de acceso si se creó con una\./);
  assert.equal(await page.text('remove-confirm'), 'Quitarla');
  assert.equal(await page.text('remove-keep'), 'Conservarla');
  // The English word for a passkey stands once on the screen, at its first mention, with the question open too.
  assert.equal(await glosses(page), 1);
  assert.match(await page.text('wallet-kind'), /\(passkey\)$/);
  await untilAnswersCount();
  await page.click('remove-keep');
  await page.waitForGone('remove-keep');
  assert.equal(await page.stored(), JSON.stringify(record));

  // The language switch keeps the reader on the same screen, in English, with no page load.
  await page.click('lang-switch');
  await page.page.waitForFunction(() => location.pathname === '/wallet/settings');
  assert.equal(await heading(page), 'Settings');
  assert.equal(await page.text('wallet-since'), 'November 1, 2026');

  // What was counted is filed under the Spanish screens it happened on.
  assert.deepEqual(await counted(s, page, 'Words shown'), [{ name: 'Words shown', path: '/es/wallet/backup', value: 'words' }]);
  assert.deepEqual(await counted(s, page, 'Wallet removed'), []);
});

scenario('Remove on a phone: the question opens whole, with both answers on screen, and a double tap removes nothing', async (s) => {
  const record = testRecord();
  // A small phone. The button is brought to the foot of the screen, where the question has to open
  // below the fold: the place where it once came up with "Remove it" under the finger and "Keep it" cut off.
  const page = await s.open('/wallet/settings', { record, width: 375, height: 667 });
  await page.waitFor('remove-wallet');
  const point = await page.page.$eval(byTestId('remove-wallet'), (button) => {
    const before = button.getBoundingClientRect();
    window.scrollBy(0, before.bottom - (window.innerHeight - 16));
    const box = button.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, onScreen: box.top >= 0 && box.bottom <= window.innerHeight };
  });
  assert.equal(point.onScreen, true, 'the button stands at the foot of the screen');

  // Two taps at one point, with nothing between them but the page's own redrawing: the second lands on
  // whatever the opening question has put under the finger. (They are made inside the page, as above.)
  const taps = await page.page.evaluate(async ({ x, y }) => {
    const drawn = (): Promise<void> => new Promise((frame) => requestAnimationFrame(() => requestAnimationFrame(() => frame())));
    const under = (): HTMLElement | null => document.elementFromPoint(x, y)?.closest<HTMLElement>('button, a') ?? null;
    const first = under();
    first?.click();
    await drawn();
    const second = under();
    second?.click();
    await drawn();
    return { first: first?.getAttribute('data-testid') ?? null, second: second?.getAttribute('data-testid') ?? second?.tagName ?? null };
  }, point);
  assert.equal(taps.first, 'remove-wallet');
  await page.waitFor('remove-confirm');
  // The question has the focus, so it is read out.
  assert.equal(await page.page.evaluate(() => document.activeElement?.textContent), 'Remove this wallet from this browser?');

  // Nothing was removed, and the question still stands, whatever the second tap landed on.
  assert.equal(await page.stored(), JSON.stringify(record));
  assert.equal(await page.page.evaluate(() => location.pathname), '/wallet/settings');
  assert.equal(await has(page, 'remove-question'), true);
  assert.equal(await has(page, 'remove-gone'), false);
  // The whole question is on screen: what it asks, and both answers, each within reach. Taking the
  // focus did not carry it to the middle of the screen, or under the banner.
  assert.equal(await wholeOnScreen(page, 'remove-question'), true, 'the question');
  assert.equal(await wholeOnScreen(page, 'remove-confirm'), true, '"Remove it"');
  assert.equal(await wholeOnScreen(page, 'remove-keep'), true, '"Keep it"');

  // The same with a real double click (the browser counts it as one, and says so in the second click).
  await untilAnswersCount();
  await page.click('remove-keep');
  await page.waitForGone('remove-confirm');
  const again = await page.page.$eval(byTestId('remove-wallet'), (button) => {
    const before = button.getBoundingClientRect();
    window.scrollBy(0, before.bottom - (window.innerHeight - 16));
    const box = button.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await page.page.mouse.click(again.x, again.y, { count: 2 });
  await page.waitFor('remove-confirm');
  assert.equal(await page.stored(), JSON.stringify(record));
  assert.equal(await wholeOnScreen(page, 'remove-confirm'), true);
  assert.equal(await wholeOnScreen(page, 'remove-keep'), true);

  // Once the question has stood for a moment, "Remove it" removes.
  await untilAnswersCount();
  await page.click('remove-confirm');
  await page.page.waitForFunction(() => location.pathname === '/');
  assert.equal(await page.stored(), null);
});

scenario('Backup, two tabs: when another tab puts another wallet here, the words leave the screen and the page says why', async (s) => {
  const record = testRecord();
  const other = testRecord(OTHER_WORDS);
  const first = await s.open('/wallet/backup', { record, width: 375 });
  await first.click('reveal-words');
  await first.waitFor('word');
  assert.deepEqual(await first.texts('word'), record.mnemonic!.split(' '));

  // A second tab on the same storage replaces the wallet in one write.
  const second = await s.open('/wallet/settings', { context: first.context, width: 375 });
  await second.waitFor('wallet-fingerprint');
  await second.store(RECORD_KEY, JSON.stringify(other));
  // The reader comes back to the first tab. (A click waits for a tab that is in front.)
  await first.page.bringToFront();

  // In the first tab the words are gone from the page, not just out of sight, and the page says why:
  // on screen where the words were, and as an alert for a screen reader.
  await first.waitFor('words-withdrawn');
  assert.deepEqual(await first.texts('word'), []);
  assert.doesNotMatch(await first.page.evaluate(() => document.body.textContent ?? ''), /abandon/);
  assert.match(await first.text('words-withdrawn'), /^The wallet in this browser changed in another tab, so the 12 words were taken off the screen\./);
  assert.equal(await first.page.$eval(byTestId('words-withdrawn'), (notice) => notice.getAttribute('role')), 'alert');
  assert.equal(await heading(first), 'Backup');
  assert.equal(await focused(first), 'H1');
  // The words of the wallet that is here now are not shown unasked.
  assert.doesNotMatch(await first.page.evaluate(() => document.body.textContent ?? ''), /sausage/);

  // Asked again, the words are the new wallet's, and the notice has gone.
  await first.click('reveal-words');
  await first.waitFor('word');
  assert.deepEqual(await first.texts('word'), OTHER_WORDS.split(' '));
  assert.equal(await has(first, 'words-withdrawn'), false);
  assert.equal(await first.stored(), JSON.stringify(other));
});

scenario('Settings, two tabs: a Remove question that is open when another tab changes the wallet closes, and nothing is removed', async (s) => {
  const record = testRecord();
  const other = testRecord(OTHER_WORDS);
  const first = await s.open('/wallet/settings', { record, width: 375 });
  await first.click('remove-wallet');
  await first.waitFor('remove-confirm');
  assert.equal(await first.text('wallet-fingerprint'), record.fingerprint);

  const second = await s.open('/wallet/settings', { context: first.context, width: 375 });
  await second.waitFor('wallet-fingerprint');
  await second.store(RECORD_KEY, JSON.stringify(other));
  // The reader comes back to the first tab. (A click waits for a tab that is in front.)
  await first.page.bringToFront();

  // The reader said yes to nothing yet, and can no longer say yes to the wrong wallet.
  await first.waitFor('remove-gone');
  assert.equal(await has(first, 'remove-confirm'), false);
  assert.equal(await has(first, 'remove-question'), false);
  assert.match(await first.text('remove-gone'), /^The wallet in this browser changed in another tab while this page was open, so nothing was removed\./);
  assert.equal(await focused(first), 'remove-wallet');
  // The wallet the other tab put here is untouched, and it is the one this screen now shows.
  assert.equal(await first.stored(), JSON.stringify(other));
  assert.equal(await first.text('wallet-fingerprint'), other.fingerprint);
  assert.notEqual(other.fingerprint, record.fingerprint);
  assert.deepEqual(await counted(s, first, 'Wallet removed'), []);

  // Asked again, the question is about the wallet that is here, and "Remove it" removes that one.
  await first.click('remove-wallet');
  await first.waitFor('remove-confirm');
  assert.equal(await has(first, 'remove-gone'), false);
  await untilAnswersCount();
  await first.click('remove-confirm');
  await first.page.waitForFunction(() => location.pathname === '/');
  assert.equal(await first.stored(), null);
});

scenario('a passkey wallet: the words come only after the unlock step, Lock takes them off the screen, and Settings says what is kept', async (s) => {
  const page = await s.open('/wallet/backup', { width: 375, passkey: 'prf' });
  const wallet = await openPasskeyWallet(page);
  const uses = async (): Promise<number> => (await page.passkey!.credentials()).find((each) => each.id === wallet.credentialId)?.uses ?? -1;

  // Locked: looking needs no passkey, and no word is on the page.
  await page.click('lock');
  await page.page.waitForFunction((hook) => document.querySelector(hook)?.textContent?.startsWith('Looking and receiving'), {}, byTestId('lock-state'));
  assert.match(await page.text('lock-state'), LOCKED);
  await page.waitFor('reveal-words');
  assert.equal(await has(page, 'unlock-step'), false, 'the unlock step comes only when the words are asked for');
  const before = await uses();

  // Asked for, the words do not come: the unlock step does.
  await page.click('reveal-words');
  await page.waitFor('unlock-step');
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await uses(), before, 'no prompt yet');
  assert.match(await page.text('unlock-step'), /Showing the 12 words needs the keys of this wallet, and your passkey loads them\./);

  // One prompt, and the words are on screen under their own heading.
  await page.click('unlock');
  await page.waitFor('word');
  const words = await page.texts('word');
  assert.equal(words.length, 12);
  assert.equal(await uses(), before + 1, 'exactly one prompt');
  assert.equal(await heading(page), 'Your 12 words');
  assert.equal((await page.stored())!.includes(words[0]!), false, 'the words are not in storage');
  assert.doesNotMatch(await lastMatched(page), new RegExp(words.join('|')));

  // Lock takes them off the page at once, and the next ask goes through the unlock step again.
  // (From the top of the page, as a reader would: where the page stands now, the sticky PRACTICE
  // banner lies over the Lock button, and a click there would land on the banner.)
  await page.page.evaluate(() => window.scrollTo(0, 0));
  await page.click('lock');
  await page.waitForGone('word');
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await heading(page), 'Backup');
  assert.match(await page.text('lock-state'), LOCKED);
  assert.equal(await has(page, 'words-withdrawn'), false, 'a lock is the reader\'s own doing: nothing to explain');
  assert.equal((await page.page.evaluate(() => document.body.textContent ?? '')).includes(words[0]!), false);
  assert.doesNotMatch(await lastMatched(page), new RegExp(words.join('|')));
  await page.click('reveal-words');
  await page.waitFor('unlock-step');
  assert.deepEqual(await page.texts('word'), []);
  await page.click('unlock');
  await page.waitFor('word');
  assert.deepEqual(await page.texts('word'), words, 'the same passkey gives the same words');
  assert.equal(await uses(), before + 2);

  // Settings, with the wallet unlocked: how this browser opens it, the tag beside the wallet fingerprint,
  // and that the 12 words are not kept.
  await toSection(page, '/wallet/settings');
  await page.waitFor('wallet-fingerprint');
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await page.text('wallet-kind'), 'Opens with a passkey');
  assert.equal(await page.text('passkey-tag'), wallet.tag);
  assert.equal(await page.text('wallet-fingerprint'), wallet.fingerprint);
  assert.match(await page.text('keeps-no-words'), /^Not the 12 words\./);
  assert.equal(await has(page, 'keeps-words'), false);
  // Remove names the passkey and the 12 words, and promises no passkey.
  await page.click('remove-wallet');
  await page.waitFor('remove-confirm');
  assert.match(await page.text('remove-back'), /^This wallet can come back with its passkey, .+ A passkey can fail, so the 12 words are the sure way back\./);
  // In Spanish the English word for a passkey stands once in the screen's own text, at its first mention.
  await page.click('lang-switch');
  await page.page.waitForFunction(() => location.pathname === '/es/wallet/settings');
  assert.equal(await page.text('wallet-kind'), 'Se abre con llave de acceso (passkey)');
  assert.equal((await glosses(page)) - (await glosses(page, byTestId('lock-state'))), 1);
  await untilAnswersCount();
  await page.click('remove-keep');
  await page.waitForGone('remove-confirm');
  assert.equal(JSON.parse((await page.stored())!).fingerprint, wallet.fingerprint);

  // Shown twice, counted once, under the screen it happened on.
  assert.deepEqual(await counted(s, page, 'Words shown'), [{ name: 'Words shown', path: '/wallet/backup', value: 'passkey' }]);
});

scenario('a passkey wallet: a prompt answered after the language was switched shows the words asked for, and leaves no unlock step waiting for the next lock', async (s) => {
  const page = await s.open('/wallet/backup', { width: 375, passkey: 'prf' });
  await openPasskeyWallet(page);
  await page.click('lock');
  await page.waitFor('reveal-words');

  // The reader asks for the words, and while the passkey prompt is open switches the page to Spanish.
  // The prompt's answer is held back here, as a device holds it until the reader has confirmed.
  await page.page.evaluate(() => {
    const real = navigator.credentials.get.bind(navigator.credentials);
    let release = (): void => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    (window as unknown as { answerPrompt: () => void }).answerPrompt = release;
    navigator.credentials.get = async (options) => {
      const answer = await real(options);
      await held;
      return answer;
    };
  });
  await page.click('reveal-words');
  await page.waitFor('unlock-step');
  await page.click('unlock');
  await page.page.waitForFunction((hook) => document.querySelector(hook)?.getAttribute('aria-busy') === 'true', {}, byTestId('unlock'));
  await page.click('lang-switch');
  await page.page.waitForFunction(() => location.pathname === '/es/wallet/backup');
  await page.page.evaluate(() => (window as unknown as { answerPrompt: () => void }).answerPrompt());

  // The keys are loaded, and the same screen is showing, in the other language: the reader asked it for
  // the words, and gets them, with no second press. (The unlock step once took the new address for
  // another screen, and the reader had to ask again.)
  await page.waitFor('word');
  assert.equal(await has(page, 'unlock-step'), false);
  assert.equal(await has(page, 'lock'), true);
  assert.equal((await page.texts('word')).length, 12);
  assert.equal(await heading(page), 'Tus 12 palabras');
  assert.equal(await page.text('hide-words'), 'Ocultarlas');
  // The step changed in place: its heading has focus, as after any unlock.
  assert.equal(await focused(page), 'H1');

  // Lock: the words leave with the keys, and the screen asks. The unlock step must not come up by
  // itself, from a wish made before.
  await page.click('lock');
  await page.waitForGone('lock');
  await page.waitFor('reveal-words');
  assert.equal(await page.text('reveal-words'), 'Mostrar las 12 palabras');
  assert.equal(await has(page, 'unlock-step'), false, 'nobody asked for the words since the lock');
  assert.deepEqual(await page.texts('word'), []);

  // Asked for now, it does come, and the words follow the unlock.
  await page.click('reveal-words');
  await page.waitFor('unlock-step');
  await page.click('unlock');
  await page.waitFor('word');
  assert.equal((await page.texts('word')).length, 12);
  // The button that was pressed went with the step (this screen shows the step only for a locked
  // wallet), and focus with it: the heading takes it, and is not left on the page itself.
  await page.page.waitForFunction(() => document.activeElement?.tagName === 'H1');
});

scenario('a passkey wallet: a prompt answered after the reader left the screen and came back shows no words and counts none as shown', async (s) => {
  const page = await s.open('/wallet/backup', { width: 375, passkey: 'prf' });
  await openPasskeyWallet(page);
  await page.click('lock');
  await page.waitFor('reveal-words');

  // The reader asks for the words. The prompt's answer is held back, as a device holds it.
  await page.page.evaluate(() => {
    const real = navigator.credentials.get.bind(navigator.credentials);
    let release = (): void => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    (window as unknown as { answerPrompt: () => void }).answerPrompt = release;
    navigator.credentials.get = async (options) => {
      const answer = await real(options);
      await held;
      return answer;
    };
  });
  await page.click('reveal-words');
  await page.waitFor('unlock-step');
  await page.click('unlock');
  await page.page.waitForFunction((hook) => document.querySelector(hook)?.getAttribute('aria-busy') === 'true', {}, byTestId('unlock'));

  // With the prompt open: away to Send and back to Backup, by the wallet's own links. The address is
  // the one the reader asked at, but this is a new screen, and nobody has asked it for anything.
  await page.page.evaluate(() => document.querySelector<HTMLAnchorElement>('a[href="/wallet/send"]')!.click());
  await page.page.waitForFunction(() => location.pathname === '/wallet/send');
  await page.page.evaluate(() => document.querySelector<HTMLAnchorElement>('a[href="/wallet/backup"]')!.click());
  await page.page.waitForFunction(() => location.pathname === '/wallet/backup');
  await page.waitFor('reveal-words');
  assert.equal(await has(page, 'unlock-step'), false);
  await page.page.focus(byTestId('reveal-words'));

  // Now the prompt is approved. The keys are loaded, and that is all: the screen that asked is gone.
  await page.page.evaluate(() => (window as unknown as { answerPrompt: () => void }).answerPrompt());
  await page.waitFor('lock');
  await page.settle();
  assert.deepEqual(await page.texts('word'), []);
  assert.equal(await has(page, 'reveal-words'), true);
  assert.equal(await focused(page), 'reveal-words', 'focus stays where the reader is');
  // The old screen was not handed the words behind the reader's back: the wallet counted nothing as shown.
  assert.deepEqual(await counted(s, page, 'Words shown'), []);

  // Asked for now, the words come at once: the keys are there.
  await page.click('reveal-words');
  await page.waitFor('word');
  assert.deepEqual(await counted(s, page, 'Words shown'), [{ name: 'Words shown', path: '/wallet/backup', value: 'passkey' }]);
});
