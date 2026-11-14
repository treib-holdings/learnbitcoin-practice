// What the shell tells a screen reader on a screen's behalf: what the one
// status region says, and whether <main> is busy.
//
// Every screen has exactly one role="status" region (Status.svelte, in the
// shell), there from the first render, so a screen reader announces every
// change to it. It speaks outcomes only: coins arrived, 1 confirmation,
// payment sent, copied, unlocked. Never progress, never the chain's height.
//
// A piece or a screen calls announce() with a whole sentence from the string
// tables. Do not add a second role="status" region to a screen.
//
// <main> carries aria-busy while a passkey prompt is open, while the first
// look at the wallet's coins runs and while a payment is being sent. The
// wallet itself says when the first look runs. The others start with a tap
// on a screen, and the piece that takes the tap says so here:
//
//   const result = await busyWhile(wallet.unlock(how));

import { tick } from 'svelte';

let message = $state('');

/** The sentence the status region holds now, or "". Reactive. */
export function statusText(): string {
  return message;
}

/** Says `text` through the status region. */
export function announce(text: string): void {
  if (message !== text) {
    message = text;
    return;
  }
  // The same sentence again ("Copied" twice): a region whose text does not
  // change is not read out again, so empty it first.
  message = '';
  void tick().then(() => {
    if (message === '') message = text;
  });
}

/** Empties the status region. The shell calls it when the screen changes. */
export function clearStatus(): void {
  message = '';
}

// -- work a screen is waiting for ---------------------------------------------------

/** How many things started with busyWhile() are still under way. */
let work = $state(0);

/** True while anything started with busyWhile() is still under way. The shell marks <main> busy from it. Reactive. */
export function working(): boolean {
  return work > 0;
}

/**
 * Marks <main> as busy for as long as `task` takes, and hands back its
 * answer. Wrap every wait that a tap starts and the wallet does not publish:
 * a passkey prompt (create, finish setting up, open, unlock), the look for
 * practice history that a restore begins with, and the sending of a
 * payment. test/shell.test.ts holds the pieces and screens to it. Two at
 * once are counted, so the first to end does not clear the mark for the
 * other.
 */
export async function busyWhile<T>(task: Promise<T>): Promise<T> {
  work += 1;
  try {
    return await task;
  } finally {
    work -= 1;
  }
}
