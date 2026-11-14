// How a component reaches the wallet.
//
// main.ts builds the wallet and hands it to App.svelte, which calls
// setWallet once. Every component and screen under it calls useWallet() and
// gets the same object, typed as WalletApi and nothing more. Nothing but
// main.ts imports wallet.svelte.ts. So the development gallery (app/dev) can
// mount the same App with a scripted stand-in and show any screen in any
// state.
//
// Call useWallet() while the component is being set up (at the top of its
// script), never inside a handler: that is when Svelte knows which
// component is asking.

import { createContext } from 'svelte';
import type { WalletApi } from './wallet-api.ts';

const [getWallet, putWallet] = createContext<WalletApi>();

/** Makes `api` the wallet of this component and everything inside it. App.svelte calls it; nothing else does. */
export function setWallet(api: WalletApi): WalletApi {
  return putWallet(api);
}

/** The wallet. Its properties are reactive: read them in markup or in $derived. Throws outside App.svelte. */
export function useWallet(): WalletApi {
  return getWallet();
}
