// How the unlock step tells the wallet frame what an unlock changed.
//
// Two unlocks end well and still leave the reader something to be told:
// the saved details were wrong and have been rebuilt ("tampered"), and the
// reader switched this browser to another passkey's wallet ("switched").
// The step itself may be gone the moment the keys are loaded, because the
// screen moves on. So it hands the note to the frame around the screen,
// which stays, and the frame shows it above the screen's content until the
// reader has read it.
//
// The frame makes the holder and puts it in Svelte's context; the unlock
// step, somewhere inside the frame, picks it up.

import { createContext } from 'svelte';

export type FrameNote =
  | { kind: 'tampered' }
  | { kind: 'switched'; tag: string | null; fingerprint: string };

/** One note at a time. The frame makes this with $state, so that setting `note` redraws it. */
export interface FrameNotes {
  note: FrameNote | null;
}

const [getNotes, putNotes, hasNotes] = createContext<FrameNotes>();

/** The frame calls this once, while it is being set up. */
export function provideFrameNotes(notes: FrameNotes): FrameNotes {
  return putNotes(notes);
}

/** The frame's holder, or null outside a frame. Call it while the component is being set up. */
export function useFrameNotes(): FrameNotes | null {
  return hasNotes() ? getNotes() : null;
}
