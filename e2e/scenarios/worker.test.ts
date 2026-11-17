// The Worker as a page meets it: its own answers under /api/ and /p/, with
// its own headers, and its refusal of a request that another site's page sends.

import assert from 'node:assert/strict';
import { ADDRESS_PATTERN } from '@learnbitcoin/practice-contract';
import { scenario } from './helpers.ts';

/** What every answer the Worker writes must carry (worker/src/headers.ts), typed out here a second time. */
const WORKER_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000',
};

/** A fetch made by the page's own script, with everything of the answer a test wants to see. */
interface Answer {
  status: number;
  headers: Record<string, string>;
  body: string;
}

scenario('an unknown /api/ path is the Worker\'s JSON 404, with the Worker\'s own headers', async (s) => {
  const page = await s.open('/');
  for (const path of ['/api/no-such-thing', '/p/no-such-thing', '/api/']) {
    const answer: Answer = await page.page.evaluate(async (asked) => {
      const response = await fetch(asked);
      return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
    }, path);
    assert.equal(answer.status, 404, path);
    assert.equal(answer.headers['content-type'], 'application/json; charset=utf-8', path);
    assert.deepEqual(JSON.parse(answer.body), { error: 'not_found' }, path);
    for (const [name, value] of Object.entries(WORKER_HEADERS)) assert.equal(answer.headers[name], value, `${path}: ${name}`);
    // The pages' headers are not laid over the Worker's answers.
    assert.equal(answer.headers['referrer-policy'], undefined, path);
    assert.equal(answer.headers['permissions-policy'], undefined, path);
  }
  // The app's own first requests (its settings, its page view) write lines too: look at these three only.
  assert.deepEqual(
    s.stack.lines.filter((line) => line.route === 'unknown').map((line) => [line.route, line.status]),
    [['unknown', 404], ['unknown', 404], ['unknown', 404]],
  );
  // "/api" without a slash is not the Worker's: it is a path of the app, like any other.
  const shell = await page.page.evaluate(async () => {
    const response = await fetch('/api');
    return { status: response.status, type: response.headers.get('content-type') };
  });
  assert.equal(shell.status, 200);
  // The page's type is held to its kind. What stands behind the kind is the local server's own, and the
  // deployed site has been seen to send the kind alone (e2e/src/serve.ts says so at its top).
  assert.match(shell.type ?? '', /^text\/html(;|$)/);
});

scenario('/api/config through the page\'s own fetch: the settings of this run, never cached', async (s) => {
  const page = await s.open('/');
  const answer: Answer = await page.page.evaluate(async () => {
    const response = await fetch('/api/config');
    return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
  });
  assert.equal(answer.status, 200);
  assert.equal(answer.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(answer.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(answer.body), s.stack.config);
  // A local page is on localhost, so that is where passkeys are offered; the faucet is open and events are on.
  assert.equal(s.stack.config.passkeyHost, 'localhost');
  assert.notEqual(s.stack.config.turnstileSiteKey, '');
  assert.equal(s.stack.config.events, true);
  // Two reads: the app's own when it started, and this one.
  assert.deepEqual(
    s.stack.lines.filter((line) => line.route === 'config').map((line) => [line.route, line.status]),
    [['config', 200], ['config', 200]],
  );
});

scenario('an event from the page reaches the recorder, and says nothing but its name and screen', async (s) => {
  const page = await s.open('/');
  // The app counts the screen it opened on, by itself, once its settings say events are on.
  await page.settle();
  await s.stack.settled();
  assert.deepEqual(s.stack.events.map((recorded) => recorded.event), [{ name: 'pageview', path: '/' }]);
  // A second one, sent by hand, is taken the same way.
  const status = await page.page.evaluate(async () => {
    const response = await fetch('/p/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'pageview', path: '/about' }),
    });
    return response.status;
  });
  assert.equal(status, 202);
  await s.stack.settled();
  assert.deepEqual(s.stack.events.map((recorded) => recorded.event), [{ name: 'pageview', path: '/' }, { name: 'pageview', path: '/about' }]);
  // An event with anything else in it is refused, and nothing is recorded.
  const refused = await page.page.evaluate(async () => {
    const response = await fetch('/p/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'pageview', path: '/', address: 'bcrt1qexample' }),
    });
    return response.status;
  });
  assert.equal(refused, 400);
  await s.stack.settled();
  assert.equal(s.stack.events.length, 2);
});

scenario('a POST from a page of another site is refused; the same POST from the app\'s own page is answered', async (s) => {
  // A browser lets any page send a plain POST to any address, and attaches
  // the sending page's origin. The Worker is what has to say no.
  const elsewhere = await s.openElsewhere();
  for (const path of ['/api/pot/address', '/p/event']) {
    const kind = await elsewhere.page.evaluate(
      async (url) => (await fetch(url, { method: 'POST', mode: 'no-cors', body: '{"name":"pageview","path":"/"}' })).type,
      `${s.url}${path}`,
    );
    // The foreign page is told nothing, not even the status.
    assert.equal(kind, 'opaque', path);
    const seen = elsewhere.responses.find((response) => response.url === `${s.url}${path}`);
    assert.equal(seen?.status, 403, path);
    assert.equal(seen?.headers['access-control-allow-origin'], undefined, path);
  }
  await s.stack.settled();
  // Refused before anybody was asked: no origin status in either line, and no event passed on.
  assert.deepEqual(
    s.stack.lines.map((line) => [line.route, line.status, line.upstream]),
    [['pot_address', 403, null], ['event', 403, null]],
  );
  assert.deepEqual(s.stack.events, []);

  // The control: the same request from one of the app's own pages goes through.
  const page = await s.open('/');
  const own = await page.page.evaluate(async () => {
    const response = await fetch('/api/pot/address', { method: 'POST' });
    return { status: response.status, body: (await response.json()) as { address?: string } };
  });
  assert.equal(own.status, 200);
  assert.match(own.body.address ?? '', ADDRESS_PATTERN);
});
