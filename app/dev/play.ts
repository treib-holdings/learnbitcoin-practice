// Plays a few taps on a piece of the gallery, so that a state which only
// shows after the reader has done something can be looked at, and
// photographed, without anybody doing it: the unlock step after a refused
// passkey, the word fields with a wrong word in them.
//
// A step is one of:
//   { tap: 'unlock' }               click the element with that data-testid
//   { words: 'abandon ability' }    type these words into the word fields, one each
//   { leave: 3 }                    move focus out of word field 3 (counted from 1)
//   { wait: 500 }                   wait this many milliseconds
//
// The taps are real clicks on the real pieces, so what shows afterwards is
// what a reader would see. The stand-in wallet answers them as its script
// says (stand-in.svelte.ts).

export type Step = { tap: string } | { words: string } | { leave: number } | { wait: number };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** How long a step waits for the thing it acts on to appear, in milliseconds. */
const PATIENCE = 4000;

/** The element inside `node` with this test hook, once it is there and can be used. */
async function find(node: HTMLElement, hook: string): Promise<HTMLElement> {
  const until = Date.now() + PATIENCE;
  for (;;) {
    const found = node.querySelector<HTMLElement>(`[data-testid="${hook}"]`);
    const ready =
      found !== null && !(found as HTMLButtonElement).disabled && found.getAttribute('aria-busy') !== 'true';
    if (found !== null && ready) return found;
    if (Date.now() > until) throw new Error(`gallery play: nothing to use with data-testid="${hook}"`);
    await sleep(25);
  }
}

/** Types `text` into a field the way a reader does: the field's value changes, and it says so. */
function type(field: HTMLInputElement, text: string): void {
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Plays `steps`, in order, on what is inside `node`. An element that never shows up is an error on the page. */
export async function play(node: HTMLElement, steps: readonly Step[]): Promise<void> {
  for (const step of steps) {
    if ('tap' in step) {
      (await find(node, step.tap)).click();
    } else if ('words' in step) {
      await find(node, 'word-input');
      const fields = node.querySelectorAll<HTMLInputElement>('[data-testid="word-input"]');
      step.words.split(' ').forEach((word, index) => {
        const field = fields[index];
        if (field) type(field, word);
      });
    } else if ('leave' in step) {
      await find(node, 'word-input');
      const field = node.querySelectorAll<HTMLInputElement>('[data-testid="word-input"]')[step.leave - 1];
      field?.focus();
      field?.blur();
    } else {
      await sleep(step.wait);
    }
    // Let the page follow before the next step.
    await sleep(0);
  }
  // A step can leave focus, and the page, far down a long gallery page. A
  // picture of the page is taken from the top.
  await sleep(50);
  window.scrollTo(0, 0);
}

/**
 * Steps written as text, for the end of an address:
 * "demo-keys,unlock,wait=300,words=abandon+ability" is a tap on demo-keys, a
 * tap on unlock, a wait of 300 ms, and two words typed into the fields.
 */
export function parseSteps(text: string): Step[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .map((item): Step => {
      if (item.startsWith('wait=')) return { wait: Number(item.slice(5)) || 0 };
      if (item.startsWith('leave=')) return { leave: Number(item.slice(6)) || 1 };
      if (item.startsWith('words=')) return { words: item.slice(6).replaceAll('+', ' ') };
      return { tap: item };
    });
}
