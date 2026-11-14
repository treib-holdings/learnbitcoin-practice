// Reading a body without trusting its size.
//
// A Content-Length header is optional (HTTP/2 and HTTP/3 need none) and can
// lie, so the only cap that holds is the one applied while reading. The same
// function reads what readers send to the Worker and what the practice origin
// answers: neither may make the Worker hold more than it asked for.

/**
 * A body as bytes, but never more than `max` of them. `over` is true when the
 * body was longer; the bytes are then its first `max` and the rest is left
 * unread. Throws only if the stream itself fails: the sender went away, or
 * the time limit of the request it belongs to ran out while it was arriving.
 */
export async function readBytes(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; over: boolean }> {
  if (body === null) return { bytes: new Uint8Array(0), over: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let over = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > max) {
      chunks.push(value.subarray(0, max - size));
      size = max;
      over = true;
      try {
        await reader.cancel();
      } catch {
        // Nothing more is wanted from this stream either way.
      }
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, over };
}

/** The same, as text: for a body the Worker has to look inside. */
export async function readText(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<{ text: string; over: boolean }> {
  const { bytes, over } = await readBytes(body, max);
  // Bytes that are not UTF-8 become replacement characters. Every caller
  // checks the text against a strict pattern afterwards, so they get no further.
  return { text: new TextDecoder().decode(bytes), over };
}

/** Lets go of a response whose body is not needed. */
export async function drop(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The status already told us what we needed.
  }
}

/** True for a plain JSON object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
