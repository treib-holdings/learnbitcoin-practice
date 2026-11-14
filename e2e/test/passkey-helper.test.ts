// The virtual passkey provider, against a scratch page that does what the
// app's passkey code does: it makes a passkey with the PRF extension and
// asks it for its secret. The three kinds of provider a page can be given
// (browser.ts) must behave as the app's Create and Unlock flows expect of
// real ones, and the helper must count what a scenario wants to assert:
// how many passkeys there are, and how often each was used.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { launchChrome, openPage, type Chrome, type OpenOptions, type OpenedPage } from '../src/browser.ts';
import { scratchSite } from './scratch-site.ts';

/** What a ceremony on the scratch page gives back: plain data, never the credential itself. */
interface Made {
  id?: string;
  attachment?: string | null;
  /** What create() said about the secret: true, false, or null when it said nothing. */
  enabled?: boolean | null;
  /** The 32 secret bytes as hex, or null when the answer carried none. */
  secret?: string | null;
  /** The error's name, when the ceremony failed. */
  error?: string;
}

interface ScratchWindow {
  makePasskey(timeout?: number): Promise<Made>;
  usePasskey(id?: string, timeout?: number): Promise<Made>;
  hasPlatformAuthenticator(): Promise<boolean>;
}

const PAGE_JS = `
var SALT = new Uint8Array(32).fill(7);
function hex(buffer) {
  return buffer ? Array.from(new Uint8Array(buffer), function (byte) { return byte.toString(16).padStart(2, '0'); }).join('') : null;
}
function bytes(base64url) {
  var text = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(text, function (char) { return char.charCodeAt(0); });
}
window.makePasskey = async function (timeout) {
  try {
    var credential = await navigator.credentials.create({ publicKey: {
      rp: { name: 'scratch', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'scratch', displayName: 'scratch' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: timeout,
      extensions: { prf: { eval: { first: SALT } } },
    } });
    var prf = credential.getClientExtensionResults().prf || {};
    return {
      id: credential.id,
      attachment: credential.authenticatorAttachment,
      enabled: prf.enabled === undefined ? null : prf.enabled,
      secret: hex(prf.results && prf.results.first),
    };
  } catch (error) {
    return { error: error.name };
  }
};
window.usePasskey = async function (id, timeout) {
  try {
    var options = {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      userVerification: 'required',
      timeout: timeout,
      extensions: { prf: { eval: { first: SALT } } },
    };
    if (id) options.allowCredentials = [{ type: 'public-key', id: bytes(id) }];
    var credential = await navigator.credentials.get({ publicKey: options });
    var prf = credential.getClientExtensionResults().prf || {};
    return { id: credential.id, secret: hex(prf.results && prf.results.first) };
  } catch (error) {
    return { error: error.name };
  }
};
window.hasPlatformAuthenticator = function () {
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
};
`;

let chrome: Chrome;
let site: Awaited<ReturnType<typeof scratchSite>>;
before(async () => {
  chrome = await launchChrome();
  site = await scratchSite({ 'page.js': PAGE_JS });
});
after(async () => {
  await chrome?.close();
});

const make = (page: OpenedPage, timeout?: number) => page.page.evaluate((ms) => (window as unknown as ScratchWindow).makePasskey(ms), timeout);
const use = (page: OpenedPage, id?: string, timeout?: number) =>
  page.page.evaluate((credential, ms) => (window as unknown as ScratchWindow).usePasskey(credential, ms), id, timeout);
const SECRET = /^[0-9a-f]{64}$/;

async function onPage(options: OpenOptions, run: (page: OpenedPage) => Promise<void>): Promise<void> {
  const page = await openPage(chrome, site.url, options);
  try {
    await run(page);
    assert.deepEqual(page.problems(), []);
  } finally {
    await page.close();
  }
}

test('prf: the secret comes with create(), and every get() gives the same one', async () => {
  await onPage({ passkey: 'prf' }, async (page) => {
    assert.ok(page.passkey);
    assert.equal(page.passkey.kind, 'prf');
    assert.deepEqual(await page.passkey.credentials(), []);

    const made = await make(page);
    assert.equal(made.error, undefined);
    // The device's own authenticator, as the app asks for.
    assert.equal(made.attachment, 'platform');
    assert.equal(made.enabled, true);
    assert.match(made.secret ?? '', SECRET);
    // One passkey, named as the page names it (base64url), made for this host, not used yet.
    assert.deepEqual(await page.passkey.credentials(), [{ id: made.id, uses: 0, rpId: 'localhost' }]);

    const first = await use(page);
    const second = await use(page, made.id);
    assert.deepEqual([first.id, first.secret], [made.id, made.secret]);
    assert.deepEqual([second.id, second.secret], [made.id, made.secret]);
    assert.deepEqual(await page.passkey.credentials(), [{ id: made.id, uses: 2, rpId: 'localhost' }]);

    // The passkey outlives a reload: the provider belongs to the page, not to the document.
    await page.goto('/');
    assert.equal((await use(page, made.id)).secret, made.secret);
    assert.equal((await page.passkey.credentials())[0]?.uses, 3);
  });
});

test('prf-at-get: create() promises the secret and does not give it; a get() does', async () => {
  await onPage({ passkey: 'prf-at-get' }, async (page) => {
    const made = await make(page);
    assert.deepEqual([made.error, made.enabled, made.secret], [undefined, true, null]);
    assert.equal((await page.passkey!.credentials())[0]?.uses, 0);

    const first = await use(page, made.id);
    assert.match(first.secret ?? '', SECRET);
    assert.equal((await use(page, made.id)).secret, first.secret);
    assert.deepEqual(await page.passkey!.credentials(), [{ id: made.id, uses: 2, rpId: 'localhost' }]);
  });
});

test('no-prf: a passkey that never gives a secret', async () => {
  await onPage({ passkey: 'no-prf' }, async (page) => {
    const made = await make(page);
    assert.equal(made.error, undefined);
    assert.notEqual(made.enabled, true);
    assert.equal(made.secret, null);
    const used = await use(page, made.id);
    assert.deepEqual([used.error, used.id, used.secret], [undefined, made.id, null]);
    assert.equal((await page.passkey!.credentials())[0]?.uses, 1);
  });
});

test('a page given no provider sees a device without passkeys, and never this machine\'s own', async () => {
  await onPage({}, async (page) => {
    assert.equal(page.passkey, null);
    assert.equal(await page.page.evaluate(() => (window as unknown as ScratchWindow).hasPlatformAuthenticator()), false);
    // A prompt has nobody to answer it. It ends by its own timeout, not at the machine's Touch ID.
    const started = Date.now();
    assert.deepEqual(await make(page, 400), { error: 'NotAllowedError' });
    assert.ok(Date.now() - started < 5000);
  });
  await onPage({ passkey: 'prf' }, async (page) => {
    assert.equal(await page.page.evaluate(() => (window as unknown as ScratchWindow).hasPlatformAuthenticator()), true);
  });
});

test('each page has a provider of its own', async () => {
  await onPage({ passkey: 'prf' }, async (one) => {
    const made = await make(one);
    await onPage({ passkey: 'prf' }, async (two) => {
      assert.deepEqual(await two.passkey!.credentials(), []);
      // The other page's passkey is not here to be asked.
      assert.deepEqual(await use(two, made.id, 400), { error: 'NotAllowedError' });
      const other = await make(two);
      assert.notEqual(other.id, made.id);
      assert.notEqual(other.secret, made.secret);
    });
    assert.deepEqual((await one.passkey!.credentials()).map((credential) => credential.id), [made.id]);
  });
});

test('a passkey can be deleted behind the page\'s back, one or all', async () => {
  await onPage({ passkey: 'prf' }, async (page) => {
    const one = await make(page);
    const two = await make(page);
    assert.deepEqual((await page.passkey!.credentials()).map((credential) => credential.id).sort(), [one.id, two.id].sort());

    await page.passkey!.remove(one.id!);
    assert.deepEqual((await page.passkey!.credentials()).map((credential) => credential.id), [two.id]);
    assert.deepEqual(await use(page, one.id, 400), { error: 'NotAllowedError' });
    assert.equal((await use(page, two.id)).secret, two.secret);

    await page.passkey!.clear();
    assert.deepEqual(await page.passkey!.credentials(), []);
    assert.deepEqual(await use(page, two.id, 400), { error: 'NotAllowedError' });
  });
});

test('the provider holds three passkeys: a fourth create() fails', async () => {
  await onPage({ passkey: 'prf' }, async (page) => {
    for (let i = 0; i < 3; i += 1) assert.equal((await make(page)).error, undefined, `passkey ${i + 1}`);
    assert.deepEqual(await make(page), { error: 'NotAllowedError' });
    assert.equal((await page.passkey!.credentials()).length, 3);
  });
});

test('a prompt nobody answers waits for its timeout; refuse() ends every prompt at once', async () => {
  await onPage({ passkey: 'no-prf' }, async (page) => {
    const made = await make(page);
    await page.passkey!.setPresence(false);
    const started = Date.now();
    assert.deepEqual(await use(page, made.id, 500), { error: 'NotAllowedError' });
    assert.ok(Date.now() - started >= 400, 'it waited for the timeout');
    await page.passkey!.setPresence(true);
    assert.equal((await use(page, made.id)).id, made.id);
  });
  await onPage({ passkey: 'prf' }, async (page) => {
    const made = await make(page);
    await page.passkey!.refuse();
    const started = Date.now();
    assert.deepEqual(await use(page, made.id), { error: 'NotAllowedError' });
    assert.ok(Date.now() - started < 3000, 'refused at once, not at a timeout');
    // The passkey is still there; it was the reader who said no.
    assert.deepEqual((await page.passkey!.credentials()).map((credential) => [credential.id, credential.uses]), [[made.id, 0]]);
  });
});
