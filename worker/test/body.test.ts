import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRecord, readBytes, readText } from '../src/body.ts';

/** A body that arrives in the given pieces, and counts how many were taken. */
function pieces(parts: string[]): { body: ReadableStream<Uint8Array>; taken: () => number; cancelled: () => boolean } {
  let taken = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const part = parts[taken];
        if (part === undefined) return controller.close();
        taken += 1;
        controller.enqueue(new TextEncoder().encode(part));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, taken: () => taken, cancelled: () => cancelled };
}

test('a body under the cap is read whole', async () => {
  assert.deepEqual(await readText(pieces(['abc', 'def']).body, 10), { text: 'abcdef', over: false });
  assert.deepEqual(await readText(pieces(['abcde', 'fghij']).body, 10), { text: 'abcdefghij', over: false });
  assert.deepEqual(await readText(pieces([]).body, 10), { text: '', over: false });
  assert.deepEqual(await readText(null, 10), { text: '', over: false });
});

test('a body over the cap is cut at the cap and the rest is never read', async () => {
  const long = pieces(['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee']);
  assert.deepEqual(await readText(long.body, 6), { text: 'aaaabb', over: true });
  assert.equal(long.taken(), 2, 'reading stops at the piece that crosses the cap');
  assert.ok(long.cancelled(), 'the sender is told to stop');
  assert.deepEqual(await readText(pieces(['abc']).body, 0), { text: '', over: true });
});

test('a stream that fails throws, so the caller can tell it from an empty body', async () => {
  const broken = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error('gone'));
    },
  });
  await assert.rejects(readText(broken, 10));
});

test('the bytes of a body come back as they were sent, under the same cap', async () => {
  // Not text at all: nothing is decoded, replaced or dropped on the way.
  const odd = Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0xff, 0x00, 0xc3, 0x28, 0x7d);
  const whole = await readBytes(new Response(odd).body, 100);
  assert.deepEqual(whole, { bytes: odd, over: false });

  assert.deepEqual(await readBytes(null, 10), { bytes: new Uint8Array(0), over: false });
  assert.deepEqual(await readBytes(pieces([]).body, 10), { bytes: new Uint8Array(0), over: false });

  const long = pieces(['aaaa', 'bbbb', 'cccc', 'dddd']);
  assert.deepEqual(await readBytes(long.body, 6), { bytes: new TextEncoder().encode('aaaabb'), over: true });
  assert.equal(long.taken(), 2, 'reading stops at the piece that crosses the cap');
  assert.ok(long.cancelled(), 'the sender is told to stop');
  // Exactly the cap is not over it.
  assert.deepEqual(await readBytes(pieces(['aaaa', 'bb']).body, 6), { bytes: new TextEncoder().encode('aaaabb'), over: false });

  const broken = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error('gone'));
    },
  });
  await assert.rejects(readBytes(broken, 10), { message: 'gone' });
});

test('isRecord takes plain objects only', () => {
  assert.ok(isRecord({}));
  assert.ok(isRecord({ a: 1 }));
  for (const other of [null, undefined, [], [1], 'x', 1, true]) assert.equal(isRecord(other), false);
});
