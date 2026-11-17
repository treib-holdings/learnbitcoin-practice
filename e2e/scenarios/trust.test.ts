// What the app says about the faucet's bot check and about the record it
// keeps, held against what really happens when somebody else's code, or
// another tab, is in play.
//
// The bot check is the one piece of the page that is not the app's own. The
// app locks a passkey wallet before that script is let in, and says what
// the lock is good for: the script cannot read keys that were loaded before
// it. It does not say that the script is kept away from the keys, because
// it is not. A script in the page can ask the passkey itself: what a
// wallet's passkey is asked with is public, and the passkey's ID is in
// storage. The first scenario here runs such a script in the bot check's
// place and holds both halves: what it cannot do, and what it can. If a
// later change stops the second half, the scenario fails, and the sentences
// on Receive and About are due for a change with it.
//
// (A script could also open another window of the app and reach into it:
// two pages of one site, one opened by the other, share everything. The
// harness lets no scenario open a window, so that is not run here; the
// sentences name it all the same.)
//
// The other scenarios: a passkey prompt that is still open when coins are
// asked for; a stored record that was altered, met by an unlock with the 12
// words; and another tab that puts a different wallet in this browser while
// Receive is open.

import assert from 'node:assert/strict';
import { PRF_INPUT_V1, entropyFromPrf, mnemonicFromEntropy } from '@learnbitcoin/practice-wallet';
import { strings } from '../../app/src/strings/index.ts';
import { freshRecord, scenario, testRecord, type OpenedPage } from './helpers.ts';
import {
  RECORD_KEY,
  arrivesAt,
  countOf,
  createFrom,
  focusOf,
  hook,
  noticeOf,
  pairsOf,
  passkeyRecordOf,
  refuseNextGet,
  sleep,
  standBy,
  toSection,
  typeWords,
  until,
  untilPhase,
  usesOf,
  wordsOnScreen,
} from './journey-helpers.ts';

const common = strings.common.en;
const wallet = strings.wallet.en;
const receive = strings.receive.en;
const about = strings.about.en;

/** The lock line of an unlocked passkey wallet, with its button. */
const UNLOCKED = `${common.stateUnlocked} ${common.lock}`;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/**
 * Runs `code` in the page at the moment the bot check's script starts, in
 * every document the page loads from now on: where a script in the bot
 * check's place would run, and as early as it could. The script defines
 * window.turnstile as its first act, and `code` runs inside that line. Call
 * it before the app is loaded (standBy).
 *
 * `code` travels as text and is handed `given` (anything JSON can carry).
 * It is put into the page by the browser's tools, before any script of the
 * page: the page's own security policy would refuse to make a function from
 * text.
 */
async function inBotCheckPlace<A>(page: OpenedPage, code: (given: A) => void, given: A): Promise<void> {
  await page.page.evaluateOnNewDocument(`(() => {
    const run = ${code.toString()};
    const given = ${JSON.stringify(given)};
    let api;
    let ran = false;
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      get: () => api,
      set: (value) => {
        api = value;
        if (ran) return;
        ran = true;
        run(given);
      },
    });
  })();`);
}

/** What the script in the bot check's place found and did. */
interface Found {
  /** At its first line: the wallet's lock line, whether the Lock button is there, and everything it can read. */
  lockLine: string;
  lockButton: boolean;
  readable: string;
  /** The record as storage holds it. */
  record: string;
  /** Its own passkey prompt: the secret the passkey gave, as hex, or how it failed. */
  prf: string;
  done: boolean;
}

scenario(
  'a script in the bot check\'s place finds no key that was loaded before it, and can still ask the passkey itself: both as Receive and About say',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    const page = await standBy(s, { passkey: 'prf', timeout: 30_000 });
    await inBotCheckPlace(
      page,
      (input: number[]) => {
        const found = { lockLine: '', lockButton: false, readable: '', record: '', prf: '', done: false };
        (window as unknown as { __found: unknown }).__found = found;
        // -- What it can read, at its first line. The patterns' memory first: nothing below may run one before it is read. --
        const memory = RegExp as unknown as Record<string, unknown>;
        const remembered = ['input', 'lastMatch', 'lastParen', 'leftContext', 'rightContext', '$1', '$2', '$3'].map((name) => String(memory[name]));
        const stored: string[] = [];
        for (const storage of [localStorage, sessionStorage]) {
          for (let index = 0; index < storage.length; index += 1) stored.push(storage.getItem(storage.key(index) ?? '') ?? '');
        }
        found.lockLine = document.querySelector('[data-testid="lock-state"] p')?.textContent ?? '';
        found.lockButton = document.querySelector('[data-testid="lock"]') !== null;
        found.record = localStorage.getItem('lbp_wallet_v1') ?? '';
        const fields = Array.from(document.querySelectorAll('input, textarea'), (field) => (field as HTMLInputElement).value);
        found.readable = [...remembered, ...stored, document.cookie, JSON.stringify(history.state), window.name, ...fields, document.documentElement.outerHTML].join('\n');
        // -- What it can do: ask the passkey itself, with the input every practice passkey is asked with and the ID that storage holds. --
        void (async () => {
          try {
            const id = (JSON.parse(found.record) as { credentialId: string }).credentialId.replace(/-/g, '+').replace(/_/g, '/');
            const credential = (await navigator.credentials.get({
              publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rpId: location.hostname,
                userVerification: 'required',
                allowCredentials: [{ type: 'public-key', id: Uint8Array.from(atob(id), (character) => character.charCodeAt(0)) }],
                extensions: { prf: { eval: { first: Uint8Array.from(input) } } },
              },
            })) as PublicKeyCredential;
            const first = (credential.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
            found.prf = first ? Array.from(new Uint8Array(first), (byte) => byte.toString(16).padStart(2, '0')).join('') : 'no secret';
          } catch (error) {
            found.prf = `failed: ${String(error)}`;
          }
          found.done = true;
        })();
      },
      Array.from(PRF_INPUT_V1),
    );

    // A wallet made with a passkey, with its keys still loaded: the worst moment for the script to come.
    await page.goto('/new');
    await page.waitFor('create-passkey');
    const made = await createFrom(page, 'create-passkey');
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    await toSection(page, '/wallet/receive');
    await page.waitFor('faucet-ask');
    assert.equal(await page.text('lock-state'), UNLOCKED);
    // What the card holds for the reader before the tap, behind its folded line about the check: what asking
    // does, how far that goes, and what to do about the rest.
    assert.equal(await page.text('faucet-locks'), receive.faucetLocks);
    assert.equal(await page.text('faucet-no-prompt'), receive.faucetNoPrompt);
    const usesBefore = await usesOf(page);

    await page.click('faucet-ask');
    await page.page.waitForFunction(() => (window as unknown as { __found?: { done: boolean } }).__found?.done === true, { timeout: 30_000 });
    const found = await page.page.evaluate(() => (window as unknown as { __found: Found }).__found);

    // -- "The bot check's code cannot read keys that were loaded before it." --
    // The wallet was locked before the script's first line, and nothing the script can read holds the words.
    assert.equal(found.lockLine, common.stateLocked);
    assert.equal(found.lockButton, false);
    const readable = found.readable.toLowerCase();
    for (const pair of pairsOf(made.words)) assert.ok(!readable.includes(pair), 'two of the 12 words in a row lie where the script can read them');
    // What it can read is the record: the public key, and so every address (About says so).
    assert.equal(found.record, JSON.stringify(passkeyRecordOf(made)));
    assert.ok(found.record.includes(made.record.xpub));
    assert.match(about.botReads, /could also read the record this browser keeps for the wallet/);

    // -- "The lock goes no further than that": its own prompt got the passkey's secret, and with it the wallet's 12 words. --
    // The harness's device approves every prompt by itself. A reader would see a prompt they did not ask
    // for, on a screen whose folded line says that it opens none: "cancel it".
    assert.match(found.prf, /^[0-9a-f]{64}$/, found.prf);
    assert.equal(mnemonicFromEntropy(entropyFromPrf(Uint8Array.from(Buffer.from(found.prf, 'hex')))), made.words.join(' '));
    assert.equal(await usesOf(page), usesBefore + 1, 'the one prompt after the tap was the script\'s own');
    assert.match(about.botPasskeyStill, /its code could ask your passkey itself/);
    assert.match(receive.faucetNoPrompt, /If a passkey prompt or a new window shows up while you are still here, cancel it or close it\.$/);

    // The app itself stayed as it said it would: locked, with no words on the page, and the faucet paid.
    await untilPhase(page, 'arrived');
    assert.equal(await page.text('lock-state'), common.stateLocked);
    assert.equal(await countOf(page, 'word'), 0);
    // And its own next move loads the page afresh, without the script: there the wallet can be unlocked again.
    await Promise.all([page.page.waitForNavigation({ waitUntil: 'load' }), page.page.locator('main nav a[href="/wallet/backup"]').click()]);
    assert.equal(await page.page.evaluate(() => typeof (window as { turnstile?: unknown }).turnstile), 'undefined');
    assert.equal(await page.page.$$eval('script[src^="https://challenges.cloudflare.com/"]', (scripts) => scripts.length), 0);
  },
);

scenario(
  'a passkey prompt that is still open when coins are asked for is ended before the bot check comes: answered afterwards, it gives the page nothing',
  { localOnly: true, timeout: 150_000 },
  async (s) => {
    const page = await standBy(s, { passkey: 'prf', timeout: 30_000 });
    // A reader who takes their time: from the moment the scenario says so, the device holds its answer
    // back until it is let go. (The prompt is open all that while, as far as the page can tell.)
    await page.page.evaluateOnNewDocument(() => {
      const container = navigator.credentials as CredentialsContainer | undefined;
      if (!container) return;
      const w = window as unknown as { __hold?: boolean; __letGo?: () => void; __held?: number };
      const get = container.get.bind(container);
      container.get = (options?: CredentialRequestOptions) => {
        if (!w.__hold) return get(options);
        w.__held = (w.__held ?? 0) + 1;
        return new Promise((resolve, reject) => {
          w.__letGo = () => get(options).then(resolve, reject);
        });
      };
    });
    // In the bot check's place: a script that asks for nothing and reads no storage. It only listens
    // where an answer of the passkey would pass: where the app reads the secret out of an answer, and
    // where any answer at all is handed to whoever waits for it.
    await inBotCheckPlace(
      page,
      () => {
        const heard = { reads: 0, answers: 0, secret: 0 };
        (window as unknown as { __heard: unknown }).__heard = heard;
        const proto = (window as unknown as { PublicKeyCredential?: { prototype: Record<string, unknown> } }).PublicKeyCredential?.prototype;
        if (!proto) return;
        const secretOf = (credential: PublicKeyCredential): number => {
          const first = (real.call(credential) as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
          return first ? first.byteLength : 0;
        };
        const real = proto['getClientExtensionResults'] as (this: PublicKeyCredential) => unknown;
        proto['getClientExtensionResults'] = function (this: PublicKeyCredential): unknown {
          heard.reads += 1;
          heard.secret = Math.max(heard.secret, secretOf(this));
          return real.call(this);
        };
        // A promise that is settled with an object looks for a "then" on it: a script can stand there
        // and be handed every answer of a passkey, whoever asked for it.
        Object.defineProperty(proto, 'then', {
          configurable: true,
          get(this: PublicKeyCredential) {
            heard.answers += 1;
            heard.secret = Math.max(heard.secret, secretOf(this));
            return undefined;
          },
        });
      },
      null,
    );

    await page.goto('/new');
    await page.waitFor('create-passkey');
    await createFrom(page, 'create-passkey');
    await page.click('words-written');
    await arrivesAt(page, '/wallet');
    await page.click('lock');
    await page.waitForGone('lock');

    // The reader asks for the 12 words, and the passkey prompt opens. They do not answer it.
    await toSection(page, '/wallet/backup');
    await page.click('reveal-words');
    await page.waitFor('unlock-step');
    await page.page.evaluate(() => {
      (window as unknown as { __hold?: boolean }).__hold = true;
    });
    const usesBefore = await usesOf(page);
    await page.click('unlock');
    await until(() => page.page.evaluate(() => (window as unknown as { __held?: number }).__held === 1), 'the prompt is open');
    assert.equal(await page.page.$eval(hook('unlock'), (button) => button.getAttribute('aria-busy')), 'true');
    assert.equal(await page.page.$eval('main', (main) => main.getAttribute('aria-busy')), 'true');

    // With the prompt still open they go to Receive and ask for coins.
    await toSection(page, '/wallet/receive');
    await page.waitFor('faucet-ask');
    await page.click('faucet-ask');
    await page.page.waitForFunction(() => (window as unknown as { __heard?: unknown }).__heard !== undefined, { timeout: 30_000 });
    assert.equal(await page.text('lock-state'), common.stateLocked);
    // Whether the page still waits for the prompt, a moment after the script came. (Held against the truth below.)
    await sleep(300);
    const stillWaiting = await page.page.$eval('main', (main) => main.getAttribute('aria-busy') === 'true');

    // Now the reader answers the prompt that was open all along, with the script in the page.
    await page.page.evaluate(() => (window as unknown as { __letGo?: () => void }).__letGo?.());
    await sleep(1500);
    const heard = await page.page.evaluate(() => (window as unknown as { __heard: { reads: number; answers: number; secret: number } }).__heard);
    // The browser was told to close that prompt, so it gives no answer: nothing for the script to hear,
    // and nothing the app read. The passkey was not used.
    assert.deepEqual(heard, { reads: 0, answers: 0, secret: 0 }, 'an answer of the passkey reached a page that holds the bot check');
    assert.equal(await usesOf(page), usesBefore, 'the passkey answered a prompt after the bot check came');
    // And the prompt was ended when the script came, not when the reader got round to it: the page had stopped waiting.
    assert.equal(stillWaiting, false, 'the page still waited for the passkey prompt after the bot check had come');
    assert.equal(await page.text('lock-state'), common.stateLocked);
    assert.equal(await countOf(page, 'word'), 0);
    // The faucet goes on as if nothing had been open.
    await untilPhase(page, 'arrived');
  },
);

// -- a stored record that was altered, and an unlock with the 12 words -------------------------------------

const alterations = [
  {
    what: 'wallet fingerprint',
    alter: (record: ReturnType<typeof passkeyRecordOf>) => ({ ...record, fingerprint: record.fingerprint === '00000000' ? '11111111' : '00000000' }),
  },
  {
    what: 'public key',
    alter: (record: ReturnType<typeof passkeyRecordOf>) => {
      const other = testRecord();
      return { ...record, xpub: other.xpub, firstAddress: other.firstAddress };
    },
  },
] as const;

for (const { what, alter } of alterations) {
  scenario(
    `the stored ${what} was changed, and the reader unlocks with the 12 words: it is noticed, the record is rebuilt with no words in it, and the reader is told`,
    { timeout: 150_000 },
    async (s) => {
      const page = await standBy(s, { passkey: 'prf', timeout: 30_000 });
      await page.goto('/new');
      await page.waitFor('create-passkey');
      const made = await createFrom(page, 'create-passkey');
      const { record, words } = made;
      const original = JSON.stringify(passkeyRecordOf(made));

      // Behind the page, between two loads of the app: the record reads as sound, and is not this wallet's own.
      const altered = alter(passkeyRecordOf(made));
      await page.goto('/robots.txt');
      await page.store(RECORD_KEY, JSON.stringify(altered));
      await page.goto('/wallet/settings');
      // Looking needs no key, so nothing can notice yet: Settings shows what is stored.
      assert.equal(await page.text('wallet-fingerprint'), altered.fingerprint);
      assert.equal(await page.text('first-address'), altered.firstAddress);

      // The passkey is not at hand (its prompt is closed), so the reader takes the 12 words from their paper copy.
      await toSection(page, '/wallet/backup');
      await page.click('reveal-words');
      await page.waitFor('unlock-step');
      await refuseNextGet(page);
      await page.click('unlock');
      await page.waitFor('unlock-problem');
      await page.click('unlock-words');
      await typeWords(page, words);
      await page.click('unlock-words-go');

      // Their own words are not turned away as another wallet's, and are not taken without a word either:
      // the wallet opens, and the frame says that what was saved here was wrong and has been replaced.
      assert.deepEqual(await wordsOnScreen(page), words);
      assert.equal(await noticeOf(page, 'unlock-note'), wallet.noteTampered);
      assert.equal(await page.page.$$eval(`${hook('unlock-note')}[role="alert"]`, (alerts) => alerts.length), 1, 'the note is read out');
      assert.equal(await countOf(page, 'unlock-problem'), 0);
      assert.equal(await page.text('lock-state'), UNLOCKED);
      // The record is what Create had stored: this wallet's own again, still a passkey wallet's, with no words in it.
      assert.equal(await page.stored(), original);
      for (const pair of pairsOf(words)) assert.ok(!(await page.stored())!.includes(pair));
      assert.equal(await usesOf(page), 0, 'the device answered no prompt');
      // Every screen shows this wallet's own details from here on.
      await toSection(page, '/wallet/settings');
      assert.equal(await page.text('wallet-fingerprint'), record.fingerprint);
      assert.equal(await page.text('first-address'), record.firstAddress);
      // Counted as what it was: an unlock that found the record altered.
      await until(() => s.stack.events.some((each) => each.event.name === 'Unlock' && each.event.value === 'tampered'), 'the unlock was counted as "tampered"');
    },
  );
}

// -- another tab ------------------------------------------------------------------------------------------

scenario(
  'another tab puts a different wallet in this browser while Receive is open: the screen says so, and goes on saying it until the reader has read it',
  async (s) => {
    // Two wallets nobody has seen before: on any network, each shows its first address.
    const mine = freshRecord();
    const theirs = freshRecord();
    const first = await s.open('/wallet/receive', { record: mine, width: 375 });
    await first.waitFor('receive-address');
    assert.equal(await first.text('receive-address'), mine.firstAddress);
    assert.equal(await countOf(first, 'replaced-note'), 0);

    // A second tab of the same browser, and the other wallet's record where this one's was.
    const second = await s.open('/robots.txt', { context: first.context });
    await second.store(RECORD_KEY, JSON.stringify(theirs));
    // Back to the first tab, as the reader would go: a tab that is not in front draws nothing.
    await first.page.bringToFront();

    // The first tab follows what is stored, as it must: the address on screen is the other wallet's now ...
    await first.page.waitForFunction(
      (address) => document.querySelector('[data-testid="receive-address"]')?.textContent?.replace(/\s+/g, '') === address,
      {},
      theirs.firstAddress,
    );
    // ... and it does not leave the reader to find that out. Said once, and shown above the address.
    await first.waitFor('replaced-note');
    assert.equal(await noticeOf(first, 'replaced-note'), wallet.noteReplaced);
    const said = 'The wallet in this browser was replaced in another tab.';
    assert.equal(await first.waitForStatus(said), said);
    const order = await first.page.$eval('main', (main) => {
      const note = main.querySelector('[data-testid="replaced-note"]');
      const address = main.querySelector('[data-testid="receive-address"]');
      return note !== null && address !== null && (note.compareDocumentPosition(address) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    assert.equal(order, true, 'the note stands above the address it is about');
    // It stays through the wallet's own look at its coins, until the reader presses OK. Focus then goes to the heading.
    await first.settle();
    assert.equal(await countOf(first, 'replaced-note'), 1);
    await first.page.locator(`${hook('replaced-note')} button`).click();
    await first.waitForGone('replaced-note');
    assert.equal(await focusOf(first), 'H1');

    // The same wallet written again is no replacement, and neither is a wallet that is taken away:
    // the sentence was said once, for the one time a different wallet took this one's place.
    await second.store(RECORD_KEY, JSON.stringify({ ...theirs, createdAt: theirs.createdAt + 1000 }));
    await second.store(RECORD_KEY, null);
    await first.page.waitForFunction(() => document.querySelector('main h1')?.textContent?.trim() === 'This browser has no practice wallet.');
    assert.equal(await countOf(first, 'replaced-note'), 0);
    assert.equal(first.statusLog().filter((line) => line.includes(said)).length, 1, first.statusLog().join(' | '));
  },
);
