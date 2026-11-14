// passkey.ts against a fake browser.
//
// No real passkey is involved. A fake `navigator.credentials` answers each
// call from a script the test wrote, and records what it was asked. That
// proves the two things a unit test can prove here: the options the browser
// is given, and what each way a prompt can end is turned into. The real
// prompts are covered by the end-to-end run in headless Chrome.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { PRF_INPUT_V1, entropyFromPrf, mnemonicFromEntropy } from '@learnbitcoin/practice-wallet';
import { judgeUnlock, makeRecord } from '../src/lib/keystore.ts';
import {
  createPasskey,
  finishCreate,
  getPasskey,
  passkeyOffered,
  signalUnknown,
  tagFromUserId,
} from '../src/lib/passkey.ts';
import type { PasskeyEnv, PasskeyOutcome } from '../src/lib/passkey.ts';

interface Vectors {
  /** The input every practice passkey is asked to evaluate, as hex. */
  prfInputV1: string;
  prf: {
    /** What the passkey returned, as hex (32 bytes). */
    prfOutput: string;
    wallet: { mnemonic: string; masterFingerprint: string; xpub: string; receive: string[] };
  };
}

const vectors = JSON.parse(
  readFileSync(new URL('../../wallet/test/vectors.json', import.meta.url), 'utf8'),
) as Vectors;

// -- fixed values ---------------------------------------------------------------

/** The "random" user.id every fake browser hands out, and the tag it gives. */
const USER_ID = Uint8Array.from([
  0x7f, 0x3a, 0xc4, 0x09, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b,
]);
const TAG = '9F6D';

/** A credential ID whose base64 form has "+", "/" and padding, so the base64url spelling is really tested. */
const ID = Uint8Array.from([0xfb, 0xff, 0xfe, 0x3e]);
const ID_TEXT = '-__-Pg';

/** A passkey's 32 secret bytes. */
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + i);

const label = (tag: string): string => `Practice wallet ${tag} (no real money)`;

const BUSY: PasskeyOutcome = { kind: 'error', name: 'Busy' };

// -- the fake browser -----------------------------------------------------------

/** A copy of the bytes in a buffer of their own, the way a browser returns them. */
function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function hex(source: unknown): string {
  assert.ok(source instanceof ArrayBuffer || ArrayBuffer.isView(source), 'expected bytes');
  const bytes =
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  return Buffer.from(bytes).toString('hex');
}

/** How often any fake credential was turned into JSON. It must stay 0: that text would hold the secret. */
let toJsonCalls = 0;

afterEach(() => {
  assert.equal(toJsonCalls, 0, 'toJSON() was called on a credential');
});

interface CredentialSpec {
  id?: Uint8Array;
  /** What getClientExtensionResults() reports under "prf". Left out: no "prf" member at all. */
  prf?: { enabled?: boolean; first?: unknown };
  /** What response.userHandle holds. Left out: null, as when the browser keeps it to itself. */
  userHandle?: Uint8Array;
}

/** A stand-in for the PublicKeyCredential a browser returns. */
function credential(spec: CredentialSpec = {}): object {
  const prf =
    spec.prf === undefined
      ? undefined
      : {
          ...(spec.prf.enabled === undefined ? {} : { enabled: spec.prf.enabled }),
          ...(spec.prf.first === undefined ? {} : { results: { first: spec.prf.first } }),
        };
  return {
    type: 'public-key',
    id: 'the module reads rawId, never this',
    rawId: buffer(spec.id ?? ID),
    response: { userHandle: spec.userHandle ? buffer(spec.userHandle) : null },
    // Like the real method, this one works only when it is called on its credential.
    getClientExtensionResults(this: unknown) {
      if (typeof this !== 'object' || this === null || !('rawId' in this)) throw new TypeError('Illegal invocation');
      return prf === undefined ? {} : { prf };
    },
    toJSON() {
      toJsonCalls += 1;
      return {};
    },
  };
}

/** One scripted answer of the fake browser to create() or get(). It is handed the call's options. */
type Step = (options?: CredentialCreationOptions | CredentialRequestOptions) => Promise<unknown>;

const answers = (value: unknown): Step => () => Promise.resolve(value);

/** A refusal by the browser. The message is Chrome's; the module must never read it. */
const refuses = (name: string): Step => () =>
  Promise.reject(new DOMException('The operation either timed out or was not allowed.', name));

/** An answer that waits until the test settles it: a prompt that is still open. */
function openPrompt(): { step: Step; resolve: (value: unknown) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { step: () => promise, resolve, reject };
}

/** A prompt nobody answers, in a provider that never ends it and does not listen to the signal. */
const neverSettles: Step = () => new Promise(() => {});

/**
 * A prompt nobody answers, in a browser that keeps to the signal it was
 * given: when the signal is aborted, the call is rejected with the signal's
 * reason, at once.
 */
const waitsForAbort: Step = (options) =>
  new Promise((_, reject) => {
    const signal = options?.signal;
    assert.ok(signal instanceof AbortSignal);
    signal.addEventListener('abort', () => reject(signal.reason));
  });

type Call =
  | { method: 'create'; options: CredentialCreationOptions | undefined }
  | { method: 'get'; options: CredentialRequestOptions | undefined };

interface FakeBrowser {
  env: PasskeyEnv;
  /** Every call made to the fake navigator.credentials, in order. */
  calls: Call[];
  /** How many times random bytes were asked for. */
  randomCalls: () => number;
}

/**
 * A browser whose create() and get() answer from `script`, in order. A call
 * the script has no answer for throws, which the module reports as an error
 * outcome, so an unexpected call can never pass unnoticed.
 *
 * Like a real browser's, its methods work only when called on the object
 * they belong to. Taken off it and called bare, each fails with a TypeError
 * ("Illegal invocation" in Chrome), so a change to the module that loses
 * the object cannot pass these tests and then fail in a browser.
 */
function fakeBrowser(script: { create?: Step[]; get?: Step[] } = {}, userIds: Uint8Array[] = [USER_ID]): FakeBrowser {
  const calls: Call[] = [];
  let randomCalls = 0;
  let userIdsHandedOut = 0;
  const take = (method: 'create' | 'get', options: Call['options']): Promise<unknown> => {
    const step = script[method]?.shift();
    if (!step) throw new Error(`the test did not expect ${method}() here`);
    return step(options);
  };
  const illegal = (): TypeError => new TypeError('Illegal invocation');
  const credentials: NonNullable<PasskeyEnv['credentials']> = {
    create(this: unknown, options) {
      if (this !== credentials) return Promise.reject(illegal());
      calls.push({ method: 'create', options });
      return take('create', options);
    },
    get(this: unknown, options) {
      if (this !== credentials) return Promise.reject(illegal());
      calls.push({ method: 'get', options });
      return take('get', options);
    },
  };
  const crypto: PasskeyEnv['crypto'] = {
    // Fixed "random" bytes: a 16-byte request is a user.id, a 32-byte one a challenge.
    getRandomValues<T extends ArrayBufferView | null>(this: unknown, array: T): T {
      if (this !== crypto) throw illegal();
      randomCalls += 1;
      assert.ok(array instanceof Uint8Array);
      if (array.length === 16) {
        const userId = userIds[Math.min(userIdsHandedOut, userIds.length - 1)];
        assert.ok(userId);
        userIdsHandedOut += 1;
        array.set(userId);
      } else {
        array.fill(0xc0 + randomCalls);
      }
      return array;
    },
  };
  const env: PasskeyEnv = {
    credentials,
    PublicKeyCredential: {},
    crypto,
    isSecureContext: true,
    hostname: 'localhost',
  };
  return { env, calls, randomCalls: () => randomCalls };
}

/**
 * What a call has answered so far: its outcome, or "still open". Tests that
 * move the clock use it where they expect an outcome, so that a prompt the
 * module failed to end is a failed assertion and not a test that waits for ever.
 */
function soFar(running: Promise<PasskeyOutcome>): Promise<PasskeyOutcome | 'still open'> {
  // setImmediate runs once every promise that is ready has been handled.
  const later = new Promise<'still open'>((resolve) => setImmediate(() => resolve('still open')));
  return Promise.race([running, later]);
}

/** The signal a call was given: how the module ends a prompt that stays open too long. */
function signalOf(call: Call | undefined): AbortSignal {
  const signal = call?.options?.signal;
  assert.ok(signal instanceof AbortSignal, 'every call is given a signal');
  return signal;
}

/** The options of a create() call. */
function made(call: Call | undefined): PublicKeyCredentialCreationOptions {
  assert.ok(call && call.method === 'create', 'expected a create() call');
  assert.deepEqual(Object.keys(call.options ?? {}), ['publicKey', 'signal'], 'create() gets publicKey and a signal');
  signalOf(call);
  const publicKey = call.options?.publicKey;
  assert.ok(publicKey);
  return publicKey;
}

/** The options of a get() call. */
function asked(call: Call | undefined): PublicKeyCredentialRequestOptions {
  assert.ok(call && call.method === 'get', 'expected a get() call');
  assert.deepEqual(Object.keys(call.options ?? {}), ['publicKey', 'signal'], 'get() gets publicKey and a signal');
  signalOf(call);
  const publicKey = call.options?.publicKey;
  assert.ok(publicKey);
  return publicKey;
}

/** What every get() must carry, whoever it is for. */
function assertGetBasics(options: PublicKeyCredentialRequestOptions): void {
  assert.equal(options.rpId, 'localhost');
  assert.equal(options.userVerification, 'required');
  assert.equal(options.timeout, 300_000);
  assert.equal(hex(options.challenge).length, 64);
  assert.deepEqual(Object.keys(options.extensions ?? {}), ['prf']);
  assert.deepEqual(Object.keys(options.extensions?.prf ?? {}), ['eval'], 'eval, never evalByCredential');
  assert.equal(hex(options.extensions?.prf?.eval?.first), vectors.prfInputV1);
}

/** A get() for one passkey: its ID as bytes, and no transports hint. */
function assertAsksOnly(options: PublicKeyCredentialRequestOptions, id: Uint8Array): void {
  assert.equal(options.allowCredentials?.length, 1);
  const only = options.allowCredentials?.[0];
  assert.ok(only);
  assert.deepEqual(Object.keys(only).sort(), ['id', 'type'], 'no transports hint');
  assert.equal(only.type, 'public-key');
  assert.equal(hex(only.id), hex(id));
}

// -- the fakes -------------------------------------------------------------------

test('the fake browser, like a real one, refuses a method that is called without its object', async () => {
  const { env, calls, randomCalls } = fakeBrowser({ create: [answers(credential())], get: [answers(credential())] });
  assert.ok(env.credentials);
  const { create, get } = env.credentials;
  await assert.rejects(() => create({}), TypeError);
  await assert.rejects(() => get({}), TypeError);
  assert.equal(calls.length, 0);

  const { getRandomValues } = env.crypto;
  assert.throws(() => getRandomValues(new Uint8Array(16)), TypeError);
  assert.equal(randomCalls(), 0);

  const answer = credential({ prf: { enabled: true } }) as { getClientExtensionResults(): unknown };
  const { getClientExtensionResults } = answer;
  assert.throws(() => getClientExtensionResults(), TypeError);

  // Called on their objects, all four work.
  assert.deepEqual(answer.getClientExtensionResults(), { prf: { enabled: true } });
  assert.equal(env.crypto.getRandomValues(new Uint8Array(16)).length, 16);
  await env.credentials.create({});
  await env.credentials.get({});
  assert.deepEqual(
    calls.map((call) => call.method),
    ['create', 'get'],
  );
});

// -- the tag --------------------------------------------------------------------

test('tagFromUserId: the same bytes always give the same four characters (frozen)', () => {
  assert.equal(tagFromUserId(USER_ID), TAG);
  assert.equal(tagFromUserId(USER_ID.slice()), TAG);
  assert.equal(tagFromUserId(new Uint8Array(16)), '2222');
  assert.equal(tagFromUserId(new Uint8Array(16).fill(0xff)), 'NNNN');
  assert.equal(tagFromUserId(Uint8Array.from([23, 24, 25, 47, 99, 99])), 'Y23Y');
  // Other bytes, another tag.
  assert.notEqual(tagFromUserId(Uint8Array.from([0x7f, 0x3a, 0xc4, 0x0a])), TAG);
  // A user.id this app did not make (possible on localhost) still gets a tag, and no throw.
  assert.equal(tagFromUserId(Uint8Array.from([5])), '7222');
  assert.equal(tagFromUserId(new Uint8Array(0)), '2222');
});

test('tagFromUserId: an alphabet without look-alike characters or vowels', () => {
  const seen = new Set<string>();
  for (let byte = 0; byte < 256; byte++) {
    const tag = tagFromUserId(Uint8Array.from([byte, byte, byte, byte]));
    assert.match(tag, /^[2-9CDFHJKMNPQRTVWXY]{4}$/);
    assert.doesNotMatch(tag, /[01ILOBGSZAEU]/);
    seen.add(tag.charAt(0));
  }
  assert.equal(seen.size, 24, 'every character of the alphabet is used');
});

// -- create ---------------------------------------------------------------------

test('create: the secret comes with create(), in one prompt', async () => {
  const { env, calls } = fakeBrowser({
    create: [answers(credential({ prf: { enabled: true, first: buffer(SECRET) } }))],
  });
  const outcome = await createPasskey(env, label);

  assert.equal(outcome.kind, 'ok');
  assert.ok(outcome.kind === 'ok');
  assert.ok(outcome.prfOutput instanceof Uint8Array);
  assert.equal(hex(outcome.prfOutput), hex(SECRET));
  assert.deepEqual(
    { ...outcome, prfOutput: null },
    { kind: 'ok', prfOutput: null, credentialId: ID_TEXT, tag: TAG, prfAt: 'create', prfEnabled: true },
  );
  assert.equal(calls.length, 1, 'no second prompt to check a create() that already answered');
  assert.equal(signalOf(calls[0]).aborted, false, 'a prompt the browser ended is not aborted');
});

test('create: the options the browser is given', async () => {
  const { env, calls } = fakeBrowser({
    create: [answers(credential({ prf: { enabled: true, first: buffer(SECRET) } }))],
  });
  env.hostname = 'practice.learnbitcoin.com';
  await createPasskey(env, label);
  const options = made(calls[0]);

  // The passkey belongs to this host and no other.
  assert.equal(options.rp.id, 'practice.learnbitcoin.com');
  assert.equal(typeof options.rp.name, 'string');
  // 16 fresh random bytes, and the tag taken from them in the passkey's name.
  assert.equal(hex(options.user.id), hex(USER_ID));
  assert.equal(options.user.name, 'Practice wallet 9F6D (no real money)');
  assert.equal(options.user.displayName, options.user.name);
  assert.equal(hex(options.challenge).length, 64);
  assert.deepEqual(options.pubKeyCredParams, [
    { type: 'public-key', alg: -7 },
    { type: 'public-key', alg: -257 },
  ]);
  // Discoverable, and user verification required.
  assert.deepEqual(options.authenticatorSelection, {
    residentKey: 'required',
    requireResidentKey: true,
    userVerification: 'required',
  });
  assert.equal(options.attestation, 'none');
  assert.equal(options.timeout, 300_000);
  // The PRF extension, evaluated at creation with a copy of the frozen input.
  assert.deepEqual(Object.keys(options.extensions ?? {}), ['prf']);
  assert.deepEqual(Object.keys(options.extensions?.prf ?? {}), ['eval']);
  const first = options.extensions?.prf?.eval?.first;
  assert.equal(hex(first), vectors.prfInputV1);
  assert.equal(hex(PRF_INPUT_V1), vectors.prfInputV1);
  assert.notEqual(first, PRF_INPUT_V1, 'a copy, so nothing can alter the constant');
  // Nothing that narrows which passkey provider may be used.
  assert.equal(options.excludeCredentials, undefined);
  assert.equal(options.authenticatorSelection?.authenticatorAttachment, undefined);
});

test('create: every passkey gets its own user.id from the random number generator', async () => {
  const other = Uint8Array.from({ length: 16 }, (_, i) => 200 - i);
  const { env, calls } = fakeBrowser(
    {
      create: [
        answers(credential({ prf: { enabled: true, first: buffer(SECRET) } })),
        answers(credential({ prf: { enabled: true, first: buffer(SECRET) } })),
      ],
    },
    [USER_ID, other],
  );
  const a = await createPasskey(env, label);
  const b = await createPasskey(env, label);
  assert.equal(hex(made(calls[0]).user.id), hex(USER_ID));
  assert.equal(hex(made(calls[1]).user.id), hex(other));
  assert.ok(a.kind === 'ok' && b.kind === 'ok');
  assert.equal(a.tag, TAG);
  assert.equal(b.tag, tagFromUserId(other));
  assert.notEqual(a.tag, b.tag);
});

test('a PRF result counts as an ArrayBuffer or as any view, and only at exactly 32 bytes', async () => {
  const padded = new Uint8Array(40);
  padded.set(SECRET, 5);
  const shapes: [name: string, first: unknown][] = [
    ['ArrayBuffer', buffer(SECRET)],
    ['Uint8Array', SECRET.slice()],
    ['a view into a larger buffer', new Uint8Array(padded.buffer, 5, 32)],
    ['DataView', new DataView(padded.buffer, 5, 32)],
    ['Buffer', Buffer.from(SECRET)],
  ];
  for (const [name, first] of shapes) {
    const { env } = fakeBrowser({ create: [answers(credential({ prf: { enabled: true, first } }))] });
    const outcome = await createPasskey(env, label);
    assert.ok(outcome.kind === 'ok', name);
    assert.ok(outcome.prfOutput instanceof Uint8Array, name);
    assert.equal(hex(outcome.prfOutput), hex(SECRET), name);
  }

  // Not 32 bytes, or not bytes at all: no PRF output. The module then asks with get().
  const unusable: [name: string, first: unknown][] = [
    ['31 bytes', buffer(SECRET.slice(0, 31))],
    ['33 bytes', buffer(Uint8Array.from([...SECRET, 1]))],
    ['no bytes', new ArrayBuffer(0)],
    ['base64url text', Buffer.from(SECRET).toString('base64url')],
    ['a plain array', [...SECRET]],
    ['null', null],
  ];
  for (const [name, first] of unusable) {
    const { env, calls } = fakeBrowser({
      create: [answers(credential({ prf: { enabled: true, first } }))],
      get: [answers(credential({ prf: { first } }))],
    });
    const outcome = await createPasskey(env, label);
    assert.deepEqual(outcome, { kind: 'no-prf', credentialId: ID_TEXT, tag: TAG, prfEnabled: true }, name);
    assert.deepEqual(
      calls.map((call) => call.method),
      ['create', 'get'],
      name,
    );
  }
});

test('create: the secret comes only with the follow-up get()', async () => {
  const { env, calls } = fakeBrowser({
    create: [answers(credential({ prf: { enabled: true } }))],
    // The browser may keep the user.id to itself when a passkey is asked for by ID.
    get: [answers(credential({ prf: { first: buffer(SECRET) } }))],
  });
  const outcome = await createPasskey(env, label);

  assert.ok(outcome.kind === 'ok');
  assert.equal(hex(outcome.prfOutput), hex(SECRET));
  assert.deepEqual(
    { ...outcome, prfOutput: null },
    { kind: 'ok', prfOutput: null, credentialId: ID_TEXT, tag: TAG, prfAt: 'get', prfEnabled: true },
  );
  // Exactly one get(), for the passkey just made.
  assert.deepEqual(
    calls.map((call) => call.method),
    ['create', 'get'],
  );
  const options = asked(calls[1]);
  assertGetBasics(options);
  assertAsksOnly(options, ID);
});

test('create: a follow-up get() that is refused leaves the setup unfinished', async () => {
  // NotAllowedError is the usual refusal. Any other failure of that call
  // means the same thing: the passkey exists and has not been asked yet.
  for (const name of ['NotAllowedError', 'UnknownError']) {
    const { env, calls } = fakeBrowser({
      create: [answers(credential({ prf: { enabled: true } }))],
      get: [refuses(name)],
    });
    assert.deepEqual(
      await createPasskey(env, label),
      { kind: 'unfinished', credentialId: ID_TEXT, tag: TAG, prfEnabled: true },
      name,
    );
    assert.equal(calls.length, 2, 'no retry by itself');
  }
  // A get() that resolves with nothing is no answer either.
  const { env } = fakeBrowser({ create: [answers(credential({ prf: { enabled: true } }))], get: [answers(null)] });
  assert.deepEqual(await createPasskey(env, label), {
    kind: 'unfinished',
    credentialId: ID_TEXT,
    tag: TAG,
    prfEnabled: true,
  });
});

test('create and finish: a follow-up get() that another passkey answers is no answer', async () => {
  // An older practice passkey with a wallet of its own. A browser's own
  // passkeys keep to the one ID they are asked for; a password manager that
  // stands in for the browser might answer with a passkey of its choosing.
  const olderUser = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const olderSecret = Uint8Array.from({ length: 32 }, (_, i) => 0x10 + i);
  assert.notEqual(tagFromUserId(olderUser), TAG);
  const unfinished = { kind: 'unfinished', credentialId: ID_TEXT, tag: TAG, prfEnabled: true };

  const otherIds: [name: string, id: Uint8Array][] = [
    ['another ID altogether', Uint8Array.from([9, 9, 9, 9, 9, 9])],
    ['an ID of the same length', Uint8Array.from([9, 9, 9, 9])],
    ['an ID that differs in its last byte', Uint8Array.from([0xfb, 0xff, 0xfe, 0x3f])],
    ['an ID that differs in its first byte', Uint8Array.from([0xfa, 0xff, 0xfe, 0x3e])],
    ['the first bytes of the ID', ID.slice(0, 3)],
    ['the ID with one byte more', Uint8Array.from([...ID, 0])],
  ];
  for (const [name, id] of otherIds) {
    // The other passkey answers with its secret. Nothing of it comes back:
    // not its bytes, not its ID, not its tag.
    const withSecret = credential({ id, prf: { first: buffer(olderSecret) }, userHandle: olderUser });
    const creating = fakeBrowser({
      create: [answers(credential({ prf: { enabled: true } }))],
      get: [answers(withSecret)],
    });
    assert.deepEqual(await createPasskey(creating.env, label), unfinished, name);
    assertAsksOnly(asked(creating.calls[1]), ID);

    const finishing = fakeBrowser({ get: [answers(withSecret)] });
    const pending = { credentialId: ID_TEXT, tag: TAG, prfEnabled: true };
    assert.deepEqual(await finishCreate(finishing.env, pending), unfinished, name);

    // The tag of the new passkey is not known: it is not taken from the other one.
    const untagged = fakeBrowser({ get: [answers(withSecret)] });
    assert.deepEqual(
      await finishCreate(untagged.env, { credentialId: ID_TEXT, tag: null, prfEnabled: null }),
      { kind: 'unfinished', credentialId: ID_TEXT, tag: null, prfEnabled: null },
      name,
    );

    // The other passkey answers without PRF output. That says nothing about
    // the new one, so it is not "no-prf", and the other passkey is not named
    // as the one that cannot make a wallet.
    const without = credential({ id, prf: {}, userHandle: olderUser });
    const refusedByOther = fakeBrowser({
      create: [answers(credential({ prf: { enabled: false } }))],
      get: [answers(without)],
    });
    assert.deepEqual(await createPasskey(refusedByOther.env, label), { ...unfinished, prfEnabled: false }, name);
    assert.deepEqual(await finishCreate(fakeBrowser({ get: [answers(without)] }).env, pending), unfinished, name);
  }

  // The same bytes are the same passkey, however the browser hands them
  // back: here as a view on a larger buffer.
  const padded = new Uint8Array(12);
  padded.set(ID, 5);
  const view = new Uint8Array(padded.buffer, 5, ID.length);
  const sameId = { ...credential({ prf: { first: buffer(SECRET) } }), rawId: view };
  const same = await finishCreate(fakeBrowser({ get: [answers(sameId)] }).env, {
    credentialId: ID_TEXT,
    tag: TAG,
    prfEnabled: true,
  });
  assert.ok(same.kind === 'ok');
  assert.equal(hex(same.prfOutput), hex(SECRET));
  assert.equal(same.credentialId, ID_TEXT);
});

test('create: a passkey that answers without PRF output is no-prf, with what create() reported', async () => {
  // A provider without PRF: "enabled: false" at create, an empty "prf" at get.
  const without = fakeBrowser({
    create: [answers(credential({ prf: { enabled: false } }))],
    get: [answers(credential({ prf: {} }))],
  });
  assert.deepEqual(await createPasskey(without.env, label), {
    kind: 'no-prf',
    credentialId: ID_TEXT,
    tag: TAG,
    prfEnabled: false,
  });
  // "enabled: false" is not trusted as final: get() was still asked, once.
  assert.deepEqual(
    without.calls.map((call) => call.method),
    ['create', 'get'],
  );

  // No "prf" member at all: prfEnabled is null.
  const silent = fakeBrowser({ create: [answers(credential())], get: [answers(credential())] });
  assert.deepEqual(await createPasskey(silent.env, label), {
    kind: 'no-prf',
    credentialId: ID_TEXT,
    tag: TAG,
    prfEnabled: null,
  });

  // Extension results that cannot be read count as none.
  const broken = { ...credential(), getClientExtensionResults: () => { throw new Error('not today'); } };
  const missing = { ...credential(), getClientExtensionResults: undefined };
  for (const answer of [broken, missing]) {
    const { env } = fakeBrowser({ create: [answers(answer)], get: [answers(answer)] });
    assert.deepEqual(await createPasskey(env, label), {
      kind: 'no-prf',
      credentialId: ID_TEXT,
      tag: TAG,
      prfEnabled: null,
    });
  }
});

test('create: a refused create() is cancelled, and nothing more is asked', async () => {
  const { env, calls } = fakeBrowser({ create: [refuses('NotAllowedError')] });
  assert.deepEqual(await createPasskey(env, label), { kind: 'cancelled', timedOut: false });
  assert.equal(calls.length, 1);
});

// -- failures -------------------------------------------------------------------

test('failures are told apart by the name of the error alone', async () => {
  const cases: [reason: unknown, expected: PasskeyOutcome][] = [
    [new DOMException('whatever the browser says', 'NotAllowedError'), { kind: 'cancelled', timedOut: false }],
    // The name decides, even on a plain object and even with a misleading message.
    [{ name: 'NotAllowedError', message: 'SecurityError' }, { kind: 'cancelled', timedOut: false }],
    [new DOMException('NotAllowedError: timed out', 'SecurityError'), { kind: 'error', name: 'SecurityError' }],
    // An AbortError while the module's own signal is not aborted: a fault like any other.
    [new DOMException('signal is aborted without reason', 'AbortError'), { kind: 'error', name: 'AbortError' }],
    [new DOMException('A request is already pending.', 'OperationError'), { kind: 'error', name: 'OperationError' }],
    [new TypeError('challenge is missing'), { kind: 'error', name: 'TypeError' }],
    // Not an error object at all.
    ['leaving', { kind: 'error', name: 'Unknown' }],
    [undefined, { kind: 'error', name: 'Unknown' }],
    [{ name: 42 }, { kind: 'error', name: 'Unknown' }],
  ];
  for (const [reason, expected] of cases) {
    const viaCreate = fakeBrowser({ create: [() => Promise.reject(reason)] });
    assert.deepEqual(await createPasskey(viaCreate.env, label), expected);
    const viaGet = fakeBrowser({ get: [() => Promise.reject(reason)] });
    assert.deepEqual(await getPasskey(viaGet.env, ID_TEXT), expected);
    const viaPicker = fakeBrowser({ get: [() => Promise.reject(reason)] });
    assert.deepEqual(await getPasskey(viaPicker.env), expected);
  }
});

test('timedOut goes by the clock: true from one second before the timeout the browser was given', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const refusal = (): DOMException => new DOMException('timed out or not allowed', 'NotAllowedError');

  // Refused just before that moment: a cancel.
  const early = openPrompt();
  const first = createPasskey(fakeBrowser({ create: [early.step] }).env, label);
  t.mock.timers.tick(298_999);
  early.reject(refusal());
  assert.deepEqual(await first, { kind: 'cancelled', timedOut: false });

  // Refused from then on: the prompt ran out of time.
  const late = openPrompt();
  const second = createPasskey(fakeBrowser({ create: [late.step] }).env, label);
  t.mock.timers.tick(299_000);
  late.reject(refusal());
  assert.deepEqual(await second, { kind: 'cancelled', timedOut: true });

  // The same for get(). Each prompt is timed from its own start: the time
  // the earlier prompts took does not count.
  const third = openPrompt();
  const unlock = getPasskey(fakeBrowser({ get: [third.step] }).env, ID_TEXT);
  t.mock.timers.tick(298_999);
  third.reject(refusal());
  assert.deepEqual(await unlock, { kind: 'cancelled', timedOut: false });

  const fourth = openPrompt();
  const picker = getPasskey(fakeBrowser({ get: [fourth.step] }).env);
  t.mock.timers.tick(300_000);
  fourth.reject(refusal());
  assert.deepEqual(await picker, { kind: 'cancelled', timedOut: true });

  // A late failure of another kind is still an error, not a timeout.
  const fifth = openPrompt();
  const failed = getPasskey(fakeBrowser({ get: [fifth.step] }).env);
  t.mock.timers.tick(300_000);
  fifth.reject(new DOMException('wrong host', 'SecurityError'));
  assert.deepEqual(await failed, { kind: 'error', name: 'SecurityError' });

  // A browser may cut the timeout it is given. Firefox and Safari allow two
  // minutes, so their own timeout is a refusal after 120 s. The module has
  // no way to know that one from a cancel: it is reported as a cancel.
  const sixth = openPrompt();
  const twoMinutes = getPasskey(fakeBrowser({ get: [sixth.step] }).env, ID_TEXT);
  t.mock.timers.tick(120_000);
  sixth.reject(new DOMException('Operation timed out.', 'NotAllowedError'));
  assert.deepEqual(await twoMinutes, { kind: 'cancelled', timedOut: false });

  // The clock decides, not a timer: a hidden tab runs its timers late. Here
  // five minutes pass on the clock while no timer callback runs at all.
  const seventh = openPrompt();
  const throttled = getPasskey(fakeBrowser({ get: [seventh.step] }).env);
  t.mock.timers.setTime(Date.now() + 300_007);
  seventh.reject(refusal());
  assert.deepEqual(await throttled, { kind: 'cancelled', timedOut: true });
  // ... and a refusal a moment after the prompt opened is still a cancel.
  const eighth = openPrompt();
  const quick = getPasskey(fakeBrowser({ get: [eighth.step] }).env);
  t.mock.timers.setTime(Date.now() + 10);
  eighth.reject(refusal());
  assert.deepEqual(await quick, { kind: 'cancelled', timedOut: false });
});

test('a prompt that never ends is ended by the module, two seconds after the timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  const timedOut: PasskeyOutcome = { kind: 'cancelled', timedOut: true };
  const pending = { credentialId: ID_TEXT, tag: TAG, prfEnabled: true };
  const withSecret = (): object => credential({ prf: { first: buffer(SECRET) } });
  try {
    // A provider that never answers and does not listen to the signal.
    const deaf = fakeBrowser({ get: [neverSettles] });
    const stuck = getPasskey(deaf.env);
    const signal = signalOf(deaf.calls[0]);
    t.mock.timers.tick(301_999);
    assert.equal(await soFar(stuck), 'still open', 'the browser has its five minutes, and two seconds more');
    assert.equal(signal.aborted, false);
    assert.deepEqual(await getPasskey(fakeBrowser().env), BUSY);
    t.mock.timers.tick(1);
    assert.deepEqual(await soFar(stuck), timedOut);
    // The browser was told to close the prompt, with no reason of the module's own ...
    assert.equal(signal.aborted, true);
    assert.ok(signal.reason instanceof DOMException);
    assert.equal(signal.reason.name, 'AbortError');
    // ... and the way is free again: no "Busy" until the page is reloaded.
    assert.equal((await getPasskey(fakeBrowser({ get: [answers(withSecret())] }).env, ID_TEXT)).kind, 'ok');

    // A browser that keeps to the signal rejects with an AbortError. That is
    // the module's own doing, so it is the same outcome and not a fault.
    const listening = fakeBrowser({ get: [waitsForAbort] });
    const waiting = getPasskey(listening.env, ID_TEXT);
    t.mock.timers.tick(302_000);
    assert.deepEqual(await soFar(waiting), timedOut);
    assert.equal(signalOf(listening.calls[0]).aborted, true);

    // The same for create(), with either kind of browser.
    for (const step of [neverSettles, waitsForAbort]) {
      const creating = fakeBrowser({ create: [step] });
      const making = createPasskey(creating.env, label);
      t.mock.timers.tick(302_000);
      assert.deepEqual(await soFar(making), timedOut);
      assert.equal(signalOf(creating.calls[0]).aborted, true);
      assert.equal(creating.calls.length, 1, 'nothing more is asked');
    }

    // The follow-up get() of a create: the passkey exists, so the setup is unfinished.
    for (const step of [neverSettles, waitsForAbort]) {
      const half = fakeBrowser({ create: [answers(credential({ prf: { enabled: true } }))], get: [step] });
      const making = createPasskey(half.env, label);
      assert.equal(await soFar(making), 'still open'); // create() has answered and the get() is open
      assert.equal(half.calls.length, 2);
      t.mock.timers.tick(302_000);
      assert.deepEqual(await soFar(making), { kind: 'unfinished', ...pending });
      assert.equal(signalOf(half.calls[0]).aborted, false, 'create() had answered');
      assert.equal(signalOf(half.calls[1]).aborted, true);

      const finishing = finishCreate(fakeBrowser({ get: [step] }).env, pending);
      t.mock.timers.tick(302_000);
      assert.deepEqual(await soFar(finishing), { kind: 'unfinished', ...pending });
    }

    // What an abandoned prompt does afterwards changes nothing, and is not
    // left unhandled: a late refusal, and a late answer with the secret.
    for (const settle of ['reject', 'resolve'] as const) {
      const late = openPrompt();
      const abandoned = getPasskey(fakeBrowser({ get: [late.step] }).env);
      t.mock.timers.tick(302_000);
      assert.deepEqual(await soFar(abandoned), timedOut);
      if (settle === 'reject') late.reject(new DOMException('too late', 'NotAllowedError'));
      else late.resolve(withSecret());
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(await abandoned, timedOut);
      assert.equal((await getPasskey(fakeBrowser({ get: [answers(withSecret())] }).env)).kind, 'ok');
    }

    // A prompt that the browser ended itself leaves no timer behind: its
    // signal is not aborted afterwards, however much time passes.
    const ended = fakeBrowser({ get: [answers(withSecret()), refuses('NotAllowedError')] });
    assert.equal((await getPasskey(ended.env)).kind, 'ok');
    assert.equal((await getPasskey(ended.env)).kind, 'cancelled');
    t.mock.timers.tick(600_000);
    assert.equal(signalOf(ended.calls[0]).aborted, false);
    assert.equal(signalOf(ended.calls[1]).aborted, false);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled, []);
});

test('nothing is thrown: a browser without the API, a fault in the caller, an empty answer', async () => {
  const none = fakeBrowser();
  none.env.credentials = undefined;
  none.env.PublicKeyCredential = undefined;
  const pending = { credentialId: ID_TEXT, tag: TAG, prfEnabled: true };
  assert.deepEqual(await createPasskey(none.env, label), { kind: 'error', name: 'NotSupportedError' });
  assert.deepEqual(await finishCreate(none.env, pending), { kind: 'error', name: 'NotSupportedError' });
  assert.deepEqual(await getPasskey(none.env), { kind: 'error', name: 'NotSupportedError' });

  // The caller's label function throws: an outcome, and the browser is never asked.
  const mislabelled = fakeBrowser();
  const outcome = await createPasskey(mislabelled.env, () => {
    throw new RangeError('no such string');
  });
  assert.deepEqual(outcome, { kind: 'error', name: 'RangeError' });
  assert.equal(mislabelled.calls.length, 0);

  // The random number generator fails.
  const unlucky = fakeBrowser();
  unlucky.env.crypto = {
    getRandomValues: () => {
      throw new DOMException('no entropy', 'QuotaExceededError');
    },
  };
  assert.deepEqual(await createPasskey(unlucky.env, label), { kind: 'error', name: 'QuotaExceededError' });
  assert.deepEqual(await getPasskey(unlucky.env), { kind: 'error', name: 'QuotaExceededError' });

  // create() or get() throws instead of rejecting.
  const rude = fakeBrowser({ create: [() => { throw new DOMException('no', 'NotAllowedError'); }] });
  assert.deepEqual(await createPasskey(rude.env, label), { kind: 'cancelled', timedOut: false });

  // The call resolves with nothing, or with something that has no ID, or
  // with an ID longer than the 1023 bytes WebAuthn allows.
  const noId = [null, undefined, 'credential', {}, { rawId: 'text' }, { rawId: new ArrayBuffer(0) }];
  for (const answer of [...noId, { rawId: new ArrayBuffer(1024) }]) {
    const viaCreate = fakeBrowser({ create: [answers(answer)] });
    assert.deepEqual(await createPasskey(viaCreate.env, label), { kind: 'error', name: 'NoCredential' });
    const viaGet = fakeBrowser({ get: [answers(answer)] });
    assert.deepEqual(await getPasskey(viaGet.env), { kind: 'error', name: 'NoCredential' });
  }

  // A credential ID that is not base64url text never reaches the browser.
  for (const bad of ['', 'not base64url!', '+//+Pg==', 'A']) {
    const { env, calls } = fakeBrowser();
    assert.deepEqual(await getPasskey(env, bad), { kind: 'error', name: 'TypeError' }, bad);
    const unfinished = { ...pending, credentialId: bad };
    assert.deepEqual(await finishCreate(env, unfinished), { kind: 'error', name: 'TypeError' }, bad);
    assert.equal(calls.length, 0);
  }
});

// -- finish ---------------------------------------------------------------------

test('finish: the follow-up get() again, for a passkey whose setup was left unfinished', async () => {
  const pending = { credentialId: ID_TEXT, tag: TAG, prfEnabled: true };

  const done = fakeBrowser({ get: [answers(credential({ prf: { first: buffer(SECRET) } }))] });
  const outcome = await finishCreate(done.env, pending);
  assert.ok(outcome.kind === 'ok');
  assert.equal(hex(outcome.prfOutput), hex(SECRET));
  assert.deepEqual(
    { ...outcome, prfOutput: null },
    { kind: 'ok', prfOutput: null, credentialId: ID_TEXT, tag: TAG, prfAt: 'get', prfEnabled: true },
  );
  assert.equal(done.calls.length, 1);
  const options = asked(done.calls[0]);
  assertGetBasics(options);
  assertAsksOnly(options, ID);
  assert.equal(done.randomCalls(), 1, 'a challenge, and no new user.id');

  // Refused again: still unfinished, with everything needed for the next try.
  const refused = fakeBrowser({ get: [refuses('NotAllowedError')] });
  assert.deepEqual(await finishCreate(refused.env, pending), { kind: 'unfinished', ...pending });

  // Answered, without the secret: this passkey cannot make a wallet.
  const without = fakeBrowser({ get: [answers(credential({ prf: {} }))] });
  assert.deepEqual(await finishCreate(without.env, { ...pending, prfEnabled: false }), {
    kind: 'no-prf',
    credentialId: ID_TEXT,
    tag: TAG,
    prfEnabled: false,
  });

  // What the caller passes on is what comes back, an unknown tag included ...
  const untagged = fakeBrowser({ get: [answers(credential({ prf: {} }))] });
  assert.deepEqual(await finishCreate(untagged.env, { credentialId: ID_TEXT, tag: null, prfEnabled: null }), {
    kind: 'no-prf',
    credentialId: ID_TEXT,
    tag: null,
    prfEnabled: null,
  });
  // ... unless the browser hands the user.id back: then the tag is known again.
  const retagged = fakeBrowser({
    get: [answers(credential({ prf: { first: buffer(SECRET) }, userHandle: USER_ID }))],
  });
  const again = await finishCreate(retagged.env, { credentialId: ID_TEXT, tag: null, prfEnabled: null });
  assert.ok(again.kind === 'ok');
  assert.equal(again.tag, TAG);
});

// -- get ------------------------------------------------------------------------

test('get by ID: one passkey, no picker, no transports hint', async () => {
  const { env, calls } = fakeBrowser({
    get: [answers(credential({ prf: { first: buffer(SECRET) }, userHandle: USER_ID }))],
  });
  const outcome = await getPasskey(env, ID_TEXT);

  assert.ok(outcome.kind === 'ok');
  assert.equal(hex(outcome.prfOutput), hex(SECRET));
  assert.deepEqual(
    { ...outcome, prfOutput: null },
    { kind: 'ok', prfOutput: null, credentialId: ID_TEXT, tag: TAG, prfAt: 'get', prfEnabled: null },
  );
  assert.equal(calls.length, 1);
  const options = asked(calls[0]);
  assertGetBasics(options);
  assertAsksOnly(options, ID);
});

test('get with the picker: no allowCredentials at all, and the tag from the user handle', async () => {
  const other = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  const { env, calls } = fakeBrowser({
    get: [answers(credential({ id: other, prf: { first: buffer(SECRET) }, userHandle: USER_ID }))],
  });
  const outcome = await getPasskey(env);

  assert.ok(outcome.kind === 'ok');
  // The ID of the passkey that answered, as base64url text.
  assert.equal(outcome.credentialId, Buffer.from(other).toString('base64url'));
  assert.equal(outcome.tag, TAG);
  assert.equal(outcome.prfAt, 'get');
  assert.equal(outcome.prfEnabled, null);
  const options = asked(calls[0]);
  assertGetBasics(options);
  assert.ok(!('allowCredentials' in options), 'the browser shows its picker only when the list is absent');
});

test('get: an ID of 1023 bytes, the longest WebAuthn allows, is named in 1364 characters', async () => {
  const longest = Uint8Array.from({ length: 1023 }, (_, i) => i % 251);
  const text = Buffer.from(longest).toString('base64url');
  assert.equal(text.length, 1364);
  const picked = fakeBrowser({ get: [answers(credential({ id: longest, prf: { first: buffer(SECRET) } }))] });
  const outcome = await getPasskey(picked.env);
  assert.ok(outcome.kind === 'ok');
  assert.equal(outcome.credentialId, text);

  // Asked for by that text, the browser is handed the same 1023 bytes.
  const byId = fakeBrowser({ get: [answers(credential({ id: longest, prf: { first: buffer(SECRET) } }))] });
  assert.equal((await getPasskey(byId.env, text)).kind, 'ok');
  assertAsksOnly(asked(byId.calls[0]), longest);

  // One byte more is not a passkey ID: the answer cannot be named.
  const tooLong = credential({ id: new Uint8Array(1024), prf: { first: buffer(SECRET) } });
  assert.deepEqual(await getPasskey(fakeBrowser({ get: [answers(tooLong)] }).env), {
    kind: 'error',
    name: 'NoCredential',
  });
  // The same from create(): the passkey that was made cannot be named, and nothing more is asked.
  const { env, calls } = fakeBrowser({ create: [answers(tooLong)] });
  assert.deepEqual(await createPasskey(env, label), { kind: 'error', name: 'NoCredential' });
  assert.equal(calls.length, 1);
});

test('get: the tag is null when the browser hands back no user handle', async () => {
  const absent = fakeBrowser({ get: [answers(credential({ prf: { first: buffer(SECRET) } }))] });
  const a = await getPasskey(absent.env, ID_TEXT);
  assert.ok(a.kind === 'ok');
  assert.equal(a.tag, null);

  const empty = { ...credential({ prf: { first: buffer(SECRET) } }), response: { userHandle: new ArrayBuffer(0) } };
  const b = await getPasskey(fakeBrowser({ get: [answers(empty)] }).env, ID_TEXT);
  assert.ok(b.kind === 'ok');
  assert.equal(b.tag, null);

  const bare = { ...credential({ prf: { first: buffer(SECRET) } }), response: undefined };
  const c = await getPasskey(fakeBrowser({ get: [answers(bare)] }).env);
  assert.ok(c.kind === 'ok');
  assert.equal(c.tag, null);
});

test('get: a passkey that answers without PRF output is no-prf, with its ID and tag', async () => {
  const byId = fakeBrowser({ get: [answers(credential({ prf: {}, userHandle: USER_ID }))] });
  assert.deepEqual(await getPasskey(byId.env, ID_TEXT), {
    kind: 'no-prf',
    credentialId: ID_TEXT,
    tag: TAG,
    prfEnabled: null,
  });
  const picked = fakeBrowser({ get: [answers(credential())] });
  assert.deepEqual(await getPasskey(picked.env), {
    kind: 'no-prf',
    credentialId: ID_TEXT,
    tag: null,
    prfEnabled: null,
  });
  assert.equal(picked.calls.length, 1, 'one prompt: no second try');
});

// -- one at a time --------------------------------------------------------------

test('one ceremony at a time: a second call answers Busy and never reaches the browser', async () => {
  const open = openPrompt();
  const first = fakeBrowser({ get: [open.step] });
  const running = getPasskey(first.env);
  try {
    const second = fakeBrowser();
    const pending = { credentialId: ID_TEXT, tag: TAG, prfEnabled: true };
    assert.deepEqual(await createPasskey(second.env, label), BUSY);
    assert.deepEqual(await finishCreate(second.env, pending), BUSY);
    assert.deepEqual(await getPasskey(second.env), BUSY);
    assert.deepEqual(await getPasskey(second.env, ID_TEXT), BUSY);
    assert.deepEqual(await getPasskey(first.env, ID_TEXT), BUSY);
    assert.equal(second.calls.length, 0);
    assert.equal(second.randomCalls(), 0);
    assert.equal(first.calls.length, 1);
  } finally {
    open.resolve(credential({ prf: { first: buffer(SECRET) } }));
  }
  assert.equal((await running).kind, 'ok');

  // Both prompts of a create count as one ceremony.
  const followUp = openPrompt();
  const creating = fakeBrowser({ create: [answers(credential({ prf: { enabled: true } }))], get: [followUp.step] });
  const create = createPasskey(creating.env, label);
  try {
    await new Promise((resolve) => setImmediate(resolve)); // let create() answer and the get() start
    assert.equal(creating.calls.length, 2);
    assert.deepEqual(await getPasskey(fakeBrowser().env), BUSY);
  } finally {
    followUp.reject(new DOMException('no', 'NotAllowedError'));
  }
  assert.equal((await create).kind, 'unfinished');

  // The way is free again after an answer, after a refusal and after a fault.
  const refused = fakeBrowser({ get: [refuses('NotAllowedError')] });
  assert.equal((await getPasskey(refused.env)).kind, 'cancelled');
  const faulty = await createPasskey(fakeBrowser().env, () => {
    throw new Error('no label');
  });
  assert.equal(faulty.kind, 'error');
  const next = fakeBrowser({ get: [answers(credential({ prf: { first: buffer(SECRET) } }))] });
  assert.equal((await getPasskey(next.env, ID_TEXT)).kind, 'ok');
});

// -- signalUnknown --------------------------------------------------------------

test('signalUnknown: tells the provider when the browser can, and never throws or waits', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    // The call exists: it is made once, on PublicKeyCredential, with the ID as text.
    const seen: { self: unknown; options: unknown }[] = [];
    const pkc = {
      signalUnknownCredential(this: unknown, options: { rpId: string; credentialId: string }): Promise<void> {
        seen.push({ self: this, options });
        return new Promise(() => {}); // never settles: nothing may wait for it
      },
    };
    const { env, calls } = fakeBrowser();
    env.PublicKeyCredential = pkc;
    assert.equal(signalUnknown(env, ID_TEXT), undefined);
    assert.deepEqual(seen, [{ self: pkc, options: { rpId: 'localhost', credentialId: ID_TEXT } }]);
    assert.equal(calls.length, 0, 'no prompt');

    // The call is missing, or there is no PublicKeyCredential at all.
    env.PublicKeyCredential = {};
    signalUnknown(env, ID_TEXT);
    env.PublicKeyCredential = undefined;
    signalUnknown(env, ID_TEXT);

    // The call throws, rejects, or returns something that is not a promise.
    env.PublicKeyCredential = {
      signalUnknownCredential() {
        throw new TypeError('not here');
      },
    };
    signalUnknown(env, ID_TEXT);
    env.PublicKeyCredential = {
      signalUnknownCredential: () => Promise.reject(new DOMException('no', 'NotAllowedError')),
    };
    signalUnknown(env, ID_TEXT);
    env.PublicKeyCredential = { signalUnknownCredential: () => undefined as unknown as Promise<void> };
    signalUnknown(env, ID_TEXT);

    // Give a rejection that nobody handled the time to show itself.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled, []);
});

// -- passkeyOffered -------------------------------------------------------------

const HOST = 'practice.learnbitcoin.com';

/** A browser on the configured host that reports `capabilities` about itself. */
function reporting(capabilities: unknown): PasskeyEnv {
  const { env } = fakeBrowser();
  env.hostname = HOST;
  env.PublicKeyCredential = {
    getClientCapabilities: () => Promise.resolve(capabilities as Record<string, unknown>),
  };
  return env;
}

/** A browser in which all four conditions hold. */
const offering = (): PasskeyEnv => reporting({ 'extension:prf': true });

test('passkeyOffered: yes only when all four conditions hold', async () => {
  assert.equal(await passkeyOffered(offering(), HOST), true);
  // localhost is always allowed, whatever the configured host.
  assert.equal(await passkeyOffered({ ...offering(), hostname: 'localhost' }, HOST), true);
  assert.equal(await passkeyOffered({ ...offering(), hostname: 'localhost' }, ''), true);

  // 1. Not a secure context.
  assert.equal(await passkeyOffered({ ...offering(), isSecureContext: false }, HOST), false);
  // 2. No WebAuthn.
  assert.equal(await passkeyOffered({ ...offering(), PublicKeyCredential: undefined }, HOST), false);
  assert.equal(await passkeyOffered({ ...offering(), credentials: undefined }, HOST), false);
  // 3. The browser does not say "extension:prf: true".
  const notTrue = [
    { 'extension:prf': false },
    {},
    { 'extension:prf': 'true' },
    { 'extension:prf': 1 },
    null,
    undefined,
  ];
  for (const capabilities of notTrue) {
    const offered = await passkeyOffered(reporting(capabilities), HOST);
    assert.equal(offered, false, `reported: ${JSON.stringify(capabilities)}`);
  }
  // 4. Another host: a passkey made there could never open the wallet here.
  const elsewhere = ['learnbitcoin.com', `${HOST}.example.com`, 'preview.example.workers.dev', '127.0.0.1', ''];
  for (const hostname of elsewhere) {
    assert.equal(await passkeyOffered({ ...offering(), hostname }, HOST), false, `host: "${hostname}"`);
  }
  // An empty host is never the configured one, even if the configuration is empty too.
  assert.equal(await passkeyOffered({ ...offering(), hostname: '' }, ''), false);
});

test('passkeyOffered: a missing or failing API means no, never a throw', async () => {
  assert.equal(await passkeyOffered({ ...offering(), PublicKeyCredential: {} }, HOST), false);
  const rejecting = { getClientCapabilities: () => Promise.reject(new DOMException('no', 'SecurityError')) };
  assert.equal(await passkeyOffered({ ...offering(), PublicKeyCredential: rejecting }, HOST), false);
  const throwing = {
    getClientCapabilities(): Promise<Record<string, unknown>> {
      throw new TypeError('not a function today');
    },
  };
  assert.equal(await passkeyOffered({ ...offering(), PublicKeyCredential: throwing }, HOST), false);
  const half = { create: undefined, get: undefined } as unknown as PasskeyEnv['credentials'];
  assert.equal(await passkeyOffered({ ...offering(), credentials: half }, HOST), false);
  // Asking is not a prompt: nothing is created or fetched.
  const { env, calls } = fakeBrowser();
  env.PublicKeyCredential = { getClientCapabilities: () => Promise.resolve({ 'extension:prf': true }) };
  assert.equal(await passkeyOffered(env, HOST), true);
  assert.equal(calls.length, 0);
});

// -- secrets --------------------------------------------------------------------

test('nothing is logged, whatever the outcome', async (t) => {
  const logged: unknown[][] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table'] as const) {
    t.mock.method(console, method, (...args: unknown[]) => {
      logged.push([method, ...args]);
    });
  }
  const withSecret = (): object => credential({ prf: { enabled: true, first: buffer(SECRET) }, userHandle: USER_ID });
  const pending = { credentialId: ID_TEXT, tag: TAG, prfEnabled: true };

  const bare = answers(credential());
  const outcomes = [
    await createPasskey(fakeBrowser({ create: [answers(withSecret())] }).env, label),
    await createPasskey(fakeBrowser({ create: [bare], get: [answers(withSecret())] }).env, label),
    await createPasskey(fakeBrowser({ create: [bare], get: [refuses('NotAllowedError')] }).env, label),
    await createPasskey(fakeBrowser({ create: [bare], get: [bare] }).env, label),
    await createPasskey(fakeBrowser({ create: [refuses('NotAllowedError')] }).env, label),
    await createPasskey(fakeBrowser({ create: [refuses('SecurityError')] }).env, label),
    await finishCreate(fakeBrowser({ get: [answers(withSecret())] }).env, pending),
    await getPasskey(fakeBrowser({ get: [answers(withSecret())] }).env, ID_TEXT),
    await getPasskey(fakeBrowser({ get: [answers(withSecret())] }).env),
    await getPasskey(fakeBrowser({ get: [answers(null)] }).env),
  ];
  signalUnknown(fakeBrowser().env, ID_TEXT);
  await passkeyOffered(offering(), HOST);

  assert.deepEqual(
    outcomes.map((outcome) => outcome.kind),
    ['ok', 'ok', 'unfinished', 'no-prf', 'cancelled', 'error', 'ok', 'ok', 'ok', 'error'],
  );
  assert.deepEqual(logged, []);
});

// -- end to end -----------------------------------------------------------------

test('end to end: the frozen passkey secret gives the frozen wallet, through makeRecord', async () => {
  const secret = Uint8Array.from(Buffer.from(vectors.prf.prfOutput, 'hex'));
  const { env } = fakeBrowser({ create: [answers(credential({ prf: { enabled: true, first: buffer(secret) } }))] });

  const outcome = await createPasskey(env, label);
  assert.ok(outcome.kind === 'ok');
  const words = mnemonicFromEntropy(entropyFromPrf(outcome.prfOutput));
  assert.equal(words, vectors.prf.wallet.mnemonic);

  const record = makeRecord('passkey', words, 1_700_000_000_000, {
    credentialId: outcome.credentialId,
    tag: outcome.tag,
  });
  assert.equal(record.firstAddress, vectors.prf.wallet.receive[0]);
  assert.equal(record.firstAddress, 'bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6');
  assert.equal(record.fingerprint, vectors.prf.wallet.masterFingerprint);
  assert.equal(record.xpub, vectors.prf.wallet.xpub);
  assert.equal(record.credentialId, ID_TEXT);
  assert.equal(record.tag, TAG);
  assert.equal(record.mnemonic, undefined, 'a passkey wallet never keeps its words');

  // A later unlock with the same passkey gives the same wallet.
  const later = fakeBrowser({ get: [answers(credential({ prf: { first: buffer(secret) } }))] });
  const unlocked = await getPasskey(later.env, record.credentialId);
  assert.ok(unlocked.kind === 'ok');
  const again = mnemonicFromEntropy(entropyFromPrf(unlocked.prfOutput));
  assert.equal(judgeUnlock(record, unlocked.credentialId, again), 'same');
});
