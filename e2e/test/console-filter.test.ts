// Which console lines fail a browser run (SPEC section 14).
//
// Chrome writes "Failed to load resource" by itself for every 4xx and 5xx
// answer. The app expects such answers from its Worker (a transaction not
// found yet, a busy faucet) and shows its own text for them, so those lines
// do not count when the answer came from /api/ or /p/. Everything else does.
// The rule is one function with no browser in it, so it is tested here
// against lines copied from Chrome 157.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countsAsError } from '../src/browser.ts';

const APP = 'http://localhost:50123';
const LOCAL = [APP];
const failed = (status: number, words: string) => `Failed to load resource: the server responded with a status of ${status} (${words})`;

test('Chrome\'s own line for a refused /api/ or /p/ answer does not count', () => {
  const lines: [status: number, words: string, path: string][] = [
    [404, 'Not Found', '/api/esplora/tx/2bfbd6c40dbd2ed74b3b180fb96a83a0c0c97cfc4b5d4fe788b99347127a2287'],
    [429, 'Too Many Requests', '/api/faucet'],
    [403, 'Forbidden', '/api/faucet'],
    [400, 'Bad Request', '/api/esplora/tx'],
    [502, 'Bad Gateway', '/api/esplora/blocks/tip/height'],
    [503, 'Service Unavailable', '/api/faucet'],
    [500, 'Internal Server Error', '/api/faucet'],
    [404, 'Not Found', '/api/no-such-path'],
    [400, 'Bad Request', '/p/event'],
    [404, 'Not Found', '/api/esplora/address/bcrt1qp7th3dvtkx9vrktcrn5erq0dgjzgc4wjxzl8d6/utxo?x=1'],
    // HTTP/2 answers carry no reason phrase.
    [404, '', '/api/config'],
  ];
  for (const [status, words, path] of lines) {
    assert.equal(countsAsError({ type: 'error', text: failed(status, words), url: `${APP}${path}` }, LOCAL), false, `${status} ${path}`);
  }
});

test('the same line for any other address counts', () => {
  const urls = [
    `${APP}/assets/index-abc123.js`, // a file of the app that is missing
    `${APP}/favicon.ico`,
    `${APP}/api`, // not under /api/
    `${APP}/apiary/x`,
    `${APP}/public/x`,
    `${APP}/wallet/api/config`,
    'http://localhost:50124/api/config', // another port is another server
    'http://127.0.0.1:50123/api/config', // and so is another name for this one
    'https://localhost:50123/api/config',
    'https://example.com/api/config',
    'not a url',
  ];
  for (const url of urls) {
    assert.equal(countsAsError({ type: 'error', text: failed(404, 'Not Found'), url }, LOCAL), true, url);
  }
  // No address at all: nothing says it was the Worker's answer.
  assert.equal(countsAsError({ type: 'error', text: failed(404, 'Not Found') }, LOCAL), true);
  // A page of another site may be allowed to call the app: then the app's origin is one of the local ones.
  const fromElsewhere = { type: 'error', text: failed(403, 'Forbidden'), url: `${APP}/api/pot/address` };
  assert.equal(countsAsError(fromElsewhere, ['http://elsewhere.test:50200']), true);
  assert.equal(countsAsError(fromElsewhere, ['http://elsewhere.test:50200', APP]), false);
});

test('only an answer is forgiven: a request under /api/ that got none counts', () => {
  for (const text of [
    'Failed to load resource: net::ERR_FAILED',
    'Failed to load resource: net::ERR_CONNECTION_REFUSED',
    'Failed to load resource: net::ERR_INTERNET_DISCONNECTED',
    'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT',
    // Not Chrome's line, only one that starts like it.
    'Failed to load resource',
    'Failed to load resource: the server responded with a status of 200 (OK)',
    'Failed to load resource: the server responded with a status of 302 (Found)',
    'failed to load resource: the server responded with a status of 404 (Not Found)',
    'The app says: Failed to load resource: the server responded with a status of 404 (Not Found)',
  ]) {
    assert.equal(countsAsError({ type: 'error', text, url: `${APP}/api/faucet` }, LOCAL), true, text);
  }
});

test('every other error counts, whatever address it names', () => {
  const lines = [
    // The page's security policy at work.
    "Applying inline style violates the following Content Security Policy directive 'style-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-NerDAUWfwD31YdZHveMrq0GLjsNFMwxLpZl0dPUeCcw='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.",
    'Connecting to \'https://example.com/\' violates the following Content Security Policy directive: "connect-src \'self\'". The action has been blocked.',
    "Fetch API cannot load https://example.com/. Refused to connect because it violates the document's Content Security Policy.",
    "Access to fetch at 'http://localhost:50123/api/pot/address' from origin 'http://elsewhere.test:50200' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
    'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
    'boom',
    '',
  ];
  for (const text of lines) {
    assert.equal(countsAsError({ type: 'error', text, url: `${APP}/api/faucet` }, LOCAL), true, text);
    assert.equal(countsAsError({ type: 'error', text }, LOCAL), true, text);
  }
  // A failed console.assert is an error too.
  assert.equal(countsAsError({ type: 'assert', text: 'Assertion failed' }, LOCAL), true);
});

test('what is not an error does not count', () => {
  for (const type of ['log', 'info', 'warn', 'debug', 'trace', 'table', 'startGroup', 'endGroup', 'verbose']) {
    assert.equal(countsAsError({ type, text: 'boom' }, LOCAL), false, type);
    assert.equal(countsAsError({ type, text: failed(404, 'Not Found'), url: `${APP}/missing.js` }, LOCAL), false, type);
  }
});
