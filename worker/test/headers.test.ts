import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ERROR_CODES, ERROR_STATUS } from '@learnbitcoin/practice-contract';
import { FIXED_HEADERS, answer, jsonAnswer, refusal } from '../src/headers.ts';

test('the fixed headers are the ones the spec lists', () => {
  assert.deepEqual(FIXED_HEADERS, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Strict-Transport-Security': 'max-age=31536000',
  });
});

test('every kind of answer carries the fixed headers and its own content type', async () => {
  const cases: Array<[Response, string | null]> = [
    [jsonAnswer(200, { a: 1 }), 'application/json; charset=utf-8'],
    [answer(200, 'text', 'abc'), 'text/plain; charset=utf-8'],
    [answer(200, 'json', new Response('[1]').body), 'application/json; charset=utf-8'],
    [answer(202, null, null), null],
    [refusal('not_found'), 'application/json; charset=utf-8'],
  ];
  for (const [response, type] of cases) {
    for (const [name, value] of Object.entries(FIXED_HEADERS)) assert.equal(response.headers.get(name), value, name);
    assert.equal(response.headers.get('Content-Type'), type);
  }
  assert.equal(await cases[2]![0].text(), '[1]', 'a stream is passed on as the body');
  assert.equal(await cases[3]![0].text(), '');
});

test('a route can add a header but cannot replace a fixed one', () => {
  const response = answer(405, 'json', '{}', {
    Allow: 'POST',
    'cache-control': 'public, max-age=3600',
    'Content-Type': 'text/html',
    'X-Robots-Tag': 'all',
  });
  assert.equal(response.headers.get('Allow'), 'POST');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex');
});

test('a refusal is the contract body with the contract status, for every code', async () => {
  for (const code of ERROR_CODES) {
    const response = refusal(code);
    assert.equal(response.status, ERROR_STATUS[code], code);
    assert.deepEqual(await response.json(), { error: code });
  }
  assert.deepEqual(await refusal('dust', 'the node said so').json(), { error: 'dust', detail: 'the node said so' });
  // The code comes first in the text. The app reads it from there even when
  // a long detail has been cut short on the way (app/src/lib/api.ts).
  assert.equal(await refusal('dust', 'the node said so').text(), '{"error":"dust","detail":"the node said so"}');
  assert.deepEqual(await refusal('refused', '').json(), { error: 'refused' }, 'an empty detail is left out');
});
