// The gallery's own pages. They exist in the gallery build only; in the app
// these addresses are "not found".

import { pathInLang } from '../src/lib/navigation.ts';

/** The list of every screen in every state. */
export const INDEX_PATH = '/gallery';
/** Every shared piece in every state. */
export const PIECES_PATH = '/gallery/pieces';
/** The gates that stand in for a wallet screen, and each way "Open with my passkey" can end. */
export const GATES_PATH = '/gallery/gates';
/** The unlock step after every answer the wallet can give. */
export const UNLOCK_PATH = '/gallery/unlock';
/** The pieces that show coins, transactions and the 12 words. */
export const WALLET_PATH = '/gallery/wallet';

/** The gallery's own pages, by address. */
const PAGES = {
  [INDEX_PATH]: 'index',
  [PIECES_PATH]: 'pieces',
  [GATES_PATH]: 'gates',
  [UNLOCK_PATH]: 'unlock',
  [WALLET_PATH]: 'wallet',
} as const;

export type GalleryPage = (typeof PAGES)[keyof typeof PAGES];

/** Which gallery page an address is, in either language, or null for a screen of the app. */
export function galleryPage(pathname: string): GalleryPage | null {
  // The address without its language.
  const path = pathInLang(pathname, 'en').replace(/(.)\/$/, '$1');
  return (PAGES as Record<string, GalleryPage>)[path] ?? null;
}

/**
 * What is written after an address to see the wallet frame on that route,
 * with a sample screen in it: "/wallet/receive?state=slow#frame". Steps to
 * play may follow a colon: "#frame:demo-keys,unlock" (play.ts).
 */
export const FRAME_HASH = '#frame';

/** The steps to play on the frame's sample screen, or null when the address does not ask for it. */
export function frameDemo(hash: string): string | null {
  if (hash === FRAME_HASH) return '';
  return hash.startsWith(`${FRAME_HASH}:`) ? decodeURIComponent(hash.slice(FRAME_HASH.length + 1)) : null;
}
