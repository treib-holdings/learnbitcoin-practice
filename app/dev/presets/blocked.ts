// The one state of SPEC section 3 that the base presets do not reach: a
// browser that did not let the page read its storage.
//
//   blocked   the wallet says "blocked", and the stand-in's own storage
//             refuses every call, as a browser's does once it is told to
//             block a site's data. So the note of the "Do it" steps reads
//             "blocked" as well, as it does in such a browser.
//
// On every screen the page then says that it cannot tell, and never that
// nothing is here:
//
//   /?state=blocked, /new, /restore   the wallet's own piece, with Reload
//   /wallet?state=blocked             the gate, under a heading of its own
//   /about?state=blocked              "In this browser right now": not known
//   /sparrow?state=blocked            step 5: allow site data, and reload
//   /do?state=blocked                 the notice, and no state for any step
//   /do/hold-some?state=blocked       the notice, and the wallet's own piece in the open part
//
// (A file of its own, as the stand-in asks: nobody else's presets are touched.)

import type { Preset } from '../stand-in.svelte.ts';

export const presets: Record<string, Preset> = {
  blocked: (wallet) => {
    wallet.status = 'blocked';
    wallet.canStore = false;
    const refuse = (): never => {
      throw new DOMException("Failed to read the 'localStorage' property from 'Window': Access is denied for this document.", 'SecurityError');
    };
    Object.assign(wallet.storage, { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, key: refuse });
  },
};
