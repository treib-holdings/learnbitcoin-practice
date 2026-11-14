// What About says of the 12 words (where they are stored, and whether the
// bot check's code could read them), held against the wallet engine itself.
//
// About sorts wallets by how this browser keeps them, never by how they
// were made. The engine is why: a wallet made with a passkey, removed and
// then restored in the same browser from its 12 words comes back with the
// words stored as plain text. A sentence that promised something of "a
// wallet made with a passkey" would be false of that wallet. These tests
// walk that reader's path through the real engine (on the stand-ins of
// engine-fakes.ts), and then read the sentences that reader is shown.

import assert from 'node:assert/strict';
import { LANGS } from '@learnbitcoin/practice-contract';
import { RECORD_KEY, loadRecord } from '../src/lib/keystore.ts';
import { KEPT_KEYS, keptNow, type KeptNow } from '../src/screens/info/facts.ts';
import { strings } from '../src/strings/index.ts';
import { test, testEngine, type TestEngine } from './engine-fakes.ts';

type Table = Readonly<Record<string, string>>;

/** What About's "In this browser right now" line is about, for this engine's wallet. */
function keptOf(t: TestEngine): KeptNow | null {
  const view = t.session.view();
  return keptNow(view.status, view.record);
}

/** The record as it is stored, or a failed test. */
function storedRecord(t: TestEngine) {
  const record = loadRecord(t.storage as Storage);
  assert.ok(record !== null && typeof record === 'object', `stored: ${String(record)}`);
  return record;
}

for (const history of [false, true]) {
  const how = history ? 'the practice network knows its history' : 'no history, and the reader keeps the words anyway';
  test(`a wallet made with a passkey, removed and restored here from its 12 words, is kept with the words (${how})`, async () => {
    const t = testEngine();
    assert.deepEqual(await t.session.createWithPasskey(), { kind: 'created' });
    await t.settle();

    // As made: a record with no words in it, and About says so.
    const made = storedRecord(t);
    assert.equal(made.kind, 'passkey');
    assert.equal(Object.hasOwn(made, 'mnemonic'), false);
    assert.equal(keptOf(t), 'passkey');
    const words = (t.session.revealWords() ?? []).join(' ');
    assert.equal(words.split(' ').length, 12);
    assert.ok(!(t.storage.getItem(RECORD_KEY) ?? '').includes(words), 'the words are in storage');

    // The drill the Remove text teaches: remove the wallet, then bring it back from the 12 words.
    if (history) t.net.pay(made.firstAddress, 50_000, { confirmed: true });
    assert.equal(t.session.removeWallet(), 'removed');
    assert.equal(keptOf(t), 'none');
    const answer = await t.session.restore(words);
    if (history) {
      assert.deepEqual(answer, { kind: 'restored' });
    } else {
      assert.deepEqual(answer, { kind: 'empty' });
      assert.equal(t.session.keepRestored(), 'restored');
    }
    await t.settle();

    // The same wallet, and now its 12 words are in this browser's storage as plain text.
    const now = storedRecord(t);
    assert.equal(now.fingerprint, made.fingerprint);
    assert.equal(now.kind, 'words');
    assert.equal(now.mnemonic, words);
    assert.ok((t.storage.getItem(RECORD_KEY) ?? '').includes(words), 'the words are not in storage');

    // What About tells this reader "right now" has to be true of this wallet, which was made with a passkey.
    assert.equal(keptOf(t), 'words');
    for (const lang of LANGS) {
      const said = strings.about[lang][KEPT_KEYS.words];
      assert.doesNotMatch(said, /without a passkey|sin llave de acceso/i, `${lang}: ${said}`);
    }
    assert.equal(strings.about.en[KEPT_KEYS.words], 'The record of a wallet kept with its 12 words, as plain text.');
    assert.equal(strings.about.es[KEPT_KEYS.words], 'El registro de una billetera guardada con sus 12 palabras, como texto simple.');
  });
}

test('About never sorts what is stored by how a wallet was made', () => {
  const madeWith = { en: /made with a passkey/i, es: /cread[ao]s? con (una )?llave de acceso/i };
  const madeWithout = { en: /made without a passkey/i, es: /cread[ao]s? sin (una )?llave de acceso/i };
  const never = { en: /words are never stored/i, es: /palabras nunca se guardan/i };
  for (const lang of LANGS) {
    const table: Table = strings.about[lang];
    for (const [key, text] of Object.entries(table)) {
      const where = `about.${lang}.${key}`;
      // Nothing is promised of "a wallet made with a passkey": such a wallet can be here with its words stored.
      assert.doesNotMatch(text, madeWith[lang], where);
      // No sentence says the words of some kind of wallet are never stored: a restore stores them.
      assert.doesNotMatch(text, never[lang], where);
      // "Made without a passkey" is one of the two ways the words come to be stored, and is named only
      // beside the other one.
      if (madeWithout[lang].test(text)) assert.equal(key, 'keepWords', where);
    }
  }
  const { en, es } = strings.about;
  assert.equal(
    en.keepPasskey,
    'For a wallet this browser opens with a passkey: which passkey to ask, and the tag in its name. Its 12 words are not stored.',
  );
  assert.equal(
    en.keepWords,
    'For a wallet made without a passkey, and for any wallet restored here from its 12 words: the 12 words, as plain text, not encrypted.',
  );
  assert.match(es.keepWords, /creada sin llave de acceso, y en cualquier billetera restaurada aquí desde sus 12 palabras: las 12 palabras, como texto simple, sin cifrar\.$/);
  assert.match(en.keepSo, /If its 12 words are stored here, they can also spend from it\.$/);
  assert.match(es.keepSo, /Si sus 12 palabras están guardadas aquí, también puede gastar sus monedas\.$/);
  // The section on passkeys says which wallets it is about, and names the other way such a wallet can be here.
  assert.equal(en.passkeyTitle, 'Wallets opened with a passkey');
  assert.match(en.passkeyBody, /^For a wallet that this browser opens with a passkey, this page stores the 12 words nowhere\./);
  assert.equal(en.passkeyRestored, 'A wallet restored here from its 12 words is kept with the words, whatever it was made with.');
  assert.match(es.passkeyBody, /^En una billetera que este navegador abre con llave de acceso, esta página no guarda las 12 palabras en ningún lado\./);
  assert.match(es.passkeyRestored, /restaurada aquí desde sus 12 palabras se guarda con las palabras/);
  // The two counts that carry the kind of wallet carry the kind of record, and say so.
  assert.match(en.count_wordsShown, /whether this browser opens the wallet with a passkey\./);
  assert.match(en.count_walletRemoved, /whether this browser opened it with a passkey\.$/);
});

test("About, the bot check: a wallet opened with a passkey is locked before the check loads and stays locked; stored words are not shielded", async () => {
  const { en, es } = strings.about;
  assert.match(en.botPasskey, /^A wallet opened with a passkey is locked before the check loads, so the check and the wallet's keys are never in the page together\. It stays locked until the page is loaded again\.$/);
  assert.match(es.botPasskey, /^Una billetera que se abre con llave de acceso se bloquea antes de que la comprobación se cargue/);
  assert.match(en.botWords, /^A wallet whose 12 words are stored here cannot be shielded that way\. The words are in this browser's storage, where the check's code could read them\.$/);
  assert.match(es.botWords, /^Una billetera cuyas 12 palabras están guardadas aquí no se puede proteger así\./);

  // A wallet this browser opens with a passkey: unlocked after it is made, locked by the step every
  // screen takes before it adds the check's script, and no unlock works in that page afterwards.
  const passkey = testEngine();
  assert.deepEqual(await passkey.session.createWithPasskey(), { kind: 'created' });
  await passkey.settle();
  assert.equal(passkey.session.view().unlocked, true);
  const words = (passkey.session.revealWords() ?? []).join(' ');
  passkey.session.beforeBotCheck();
  assert.equal(passkey.session.view().unlocked, false);
  assert.equal(passkey.session.revealWords(), null);
  assert.deepEqual(await passkey.session.unlock(), { kind: 'reload' });
  assert.equal(passkey.session.unlockWithWords(words), 'reload');
  // And storage, which the check's code can read, holds none of the words.
  assert.ok(!(passkey.storage.getItem(RECORD_KEY) ?? '').includes(words.split(' ')[0] ?? 'no words'));

  // A wallet whose words are stored: the same step cannot take them out of storage.
  const stored = testEngine();
  assert.deepEqual(await stored.session.createWithWords(), { kind: 'created' });
  await stored.settle();
  stored.session.beforeBotCheck();
  const kept = (stored.session.revealWords() ?? []).join(' ');
  assert.equal(kept.split(' ').length, 12);
  assert.ok((stored.storage.getItem(RECORD_KEY) ?? '').includes(kept));
});
